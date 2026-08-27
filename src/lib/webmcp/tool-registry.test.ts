import { describe, expect, it, vi } from "vitest";

import { APPROVAL_TTL_MS } from "@/lib/domain/approval";
import { DispatchStore } from "@/lib/domain/dispatch-machine";
import type { Clock } from "@/lib/domain/types";

import { FakeWebMcpAdapter } from "./fake-adapter";
import type { RegisteredTool } from "./types";
import {
  BASE_TOOL_NAMES,
  COMMIT_TOOL_NAME,
  ToolRegistry,
  executeToolSequence,
} from "./tool-registry";

class UnregistrationSensitiveAdapter extends FakeWebMcpAdapter {
  override async executeTool(
    tool: RegisteredTool,
    input: Record<string, unknown>,
    options: { signal?: AbortSignal } = {},
  ): Promise<unknown> {
    const result = await super.executeTool(tool, input, options);
    const isStillRegistered = (await this.getTools()).some(
      (registered) => registered.name === tool.name,
    );
    if (!isStillRegistered) {
      throw new DOMException(
        "The tool was unregistered while execution was pending.",
        "UnknownError",
      );
    }
    return result;
  }
}

class PausedCommitStore extends DispatchStore {
  private releasePendingCommit: (() => void) | null = null;
  private announceCommitStart: (() => void) | null = null;
  readonly commitStarted = new Promise<void>((resolve) => {
    this.announceCommitStart = resolve;
  });

  override async commitApprovedDispatch(
    approvalId: string,
    registeredGeneration: number,
  ) {
    this.announceCommitStart?.();
    await new Promise<void>((resolve) => {
      this.releasePendingCommit = resolve;
    });
    return super.commitApprovedDispatch(approvalId, registeredGeneration);
  }

  releaseCommit(): void {
    this.releasePendingCommit?.();
  }
}

function setup() {
  let now = Date.parse("2026-08-26T03:00:00.000Z");
  let id = 0;
  const clock: Clock = { now: () => now };
  const store = new DispatchStore(clock, () => `lifecycle-${++id}`);
  const adapter = new FakeWebMcpAdapter();
  const registry = new ToolRegistry(adapter, store);
  return {
    adapter,
    registry,
    store,
    advance: (milliseconds: number) => {
      now += milliseconds;
    },
  };
}

async function waitForTool(
  adapter: FakeWebMcpAdapter,
  name: string,
  present: boolean,
) {
  await vi.waitFor(async () => {
    const names = (await adapter.getTools()).map((tool) => tool.name);
    expect(names.includes(name)).toBe(present);
  });
}

describe("WebMCP tool lifecycle", () => {
  it("registers exactly the five baseline tools and no commit tool", async () => {
    const { adapter, registry } = setup();
    await registry.start();

    const tools = await adapter.getTools();
    expect(tools.map((tool) => tool.name)).toEqual([...BASE_TOOL_NAMES].sort());
    expect(tools.find((tool) => tool.name === COMMIT_TOOL_NAME)).toBeUndefined();
    expect(
      tools
        .filter((tool) => tool.name !== "create_dispatch_draft")
        .every((tool) => tool.annotations?.readOnlyHint === true),
    ).toBe(true);
  });

  it("registers the commit tool only after approval with a const ID schema", async () => {
    const { adapter, registry, store } = setup();
    await registry.start();
    await executeToolSequence(registry);
    expect((await adapter.getTools()).map((tool) => tool.name)).not.toContain(
      COMMIT_TOOL_NAME,
    );

    const approval = await store.approveDraft();
    await waitForTool(adapter, COMMIT_TOOL_NAME, true);
    const commitTool = (await adapter.getTools()).find(
      (tool) => tool.name === COMMIT_TOOL_NAME,
    );

    expect(commitTool?.inputSchema).toMatchObject({
      type: "object",
      properties: {
        approval_id: { type: "string", const: approval.approval_id },
      },
      required: ["approval_id"],
      additionalProperties: false,
    });
  });

  it("rejects an incorrect approval ID at the temporary tool boundary", async () => {
    const { adapter, registry, store } = setup();
    await registry.start();
    await executeToolSequence(registry);
    await store.approveDraft();
    await waitForTool(adapter, COMMIT_TOOL_NAME, true);
    const commitTool = (await adapter.getTools()).find(
      (tool) => tool.name === COMMIT_TOOL_NAME,
    )!;

    await expect(
      adapter.executeTool(commitTool, { approval_id: "approval-wrong" }),
    ).rejects.toMatchObject({ code: "APPROVAL_NOT_FOUND" });
    expect(store.getSnapshot().phase).toBe("approved");
  });

  it("rejects expiry and revokes the temporary tool", async () => {
    const { adapter, registry, store, advance } = setup();
    await registry.start();
    await executeToolSequence(registry);
    const approval = await store.approveDraft();
    await waitForTool(adapter, COMMIT_TOOL_NAME, true);
    const commitTool = (await adapter.getTools()).find(
      (tool) => tool.name === COMMIT_TOOL_NAME,
    )!;
    advance(APPROVAL_TTL_MS + 1);

    await expect(
      adapter.executeTool(commitTool, {
        approval_id: approval.approval_id,
      }),
    ).rejects.toMatchObject({ code: "APPROVAL_EXPIRED" });
    await waitForTool(adapter, COMMIT_TOOL_NAME, false);
  });

  it("rejects a draft change and revokes the temporary tool", async () => {
    const { adapter, registry, store } = setup();
    await registry.start();
    await executeToolSequence(registry);
    const approval = await store.approveDraft();
    await waitForTool(adapter, COMMIT_TOOL_NAME, true);
    const commitTool = (await adapter.getTools()).find(
      (tool) => tool.name === COMMIT_TOOL_NAME,
    )!;

    store.mutateDraft({ rationale: "A human changed the selection reason." });
    await expect(
      adapter.executeTool(commitTool, {
        approval_id: approval.approval_id,
      }),
    ).rejects.toMatchObject({ code: "DRAFT_CHANGED_AFTER_APPROVAL" });
    await waitForTool(adapter, COMMIT_TOOL_NAME, false);
  });

  it("commits once, revokes immediately, and rejects double execution", async () => {
    const { adapter, registry, store } = setup();
    await registry.start();
    await executeToolSequence(registry);
    const approval = await store.approveDraft();
    await waitForTool(adapter, COMMIT_TOOL_NAME, true);

    await registry.executeNamedTool(COMMIT_TOOL_NAME, {
      approval_id: approval.approval_id,
    });

    await waitForTool(adapter, COMMIT_TOOL_NAME, false);
    expect((await adapter.getTools()).map((tool) => tool.name)).toEqual(
      [...BASE_TOOL_NAMES].sort(),
    );
    expect(store.getSnapshot().phase).toBe("committed");
    await expect(
      store.commitApprovedDispatch(
        approval.approval_id,
        approval.generation,
      ),
    ).rejects.toMatchObject({ code: "APPROVAL_ALREADY_USED" });
  });

  it("returns a native commit result before revoking its temporary tool", async () => {
    const store = new DispatchStore();
    const adapter = new UnregistrationSensitiveAdapter();
    const registry = new ToolRegistry(adapter, store);
    await registry.start();
    await executeToolSequence(registry);
    const approval = await store.approveDraft();
    await waitForTool(adapter, COMMIT_TOOL_NAME, true);

    await expect(
      registry.executeNamedTool(COMMIT_TOOL_NAME, {
        approval_id: approval.approval_id,
      }),
    ).resolves.toMatchObject({
      structuredContent: { approval_id: approval.approval_id },
    });

    await waitForTool(adapter, COMMIT_TOOL_NAME, false);
    expect(store.getSnapshot().phase).toBe("committed");
  });

  it("allows only one concurrent commit and revokes after the winner", async () => {
    const { adapter, registry, store } = setup();
    await registry.start();
    await executeToolSequence(registry);
    const approval = await store.approveDraft();
    await waitForTool(adapter, COMMIT_TOOL_NAME, true);
    const input = { approval_id: approval.approval_id };

    const outcomes = await Promise.allSettled([
      registry.executeNamedTool(COMMIT_TOOL_NAME, input),
      registry.executeNamedTool(COMMIT_TOOL_NAME, input),
    ]);

    expect(
      outcomes.filter((outcome) => outcome.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      outcomes.filter((outcome) => outcome.status === "rejected"),
    ).toHaveLength(1);
    await waitForTool(adapter, COMMIT_TOOL_NAME, false);
    expect(store.getSnapshot().phase).toBe("committed");
  });

  it("keeps baseline tools and no commit if Reset wins during commit validation", async () => {
    const adapter = new FakeWebMcpAdapter();
    const store = new PausedCommitStore();
    const registry = new ToolRegistry(adapter, store);
    await registry.start();
    await executeToolSequence(registry);
    const approval = await store.approveDraft();
    await waitForTool(adapter, COMMIT_TOOL_NAME, true);

    const commit = registry.executeNamedTool(COMMIT_TOOL_NAME, {
      approval_id: approval.approval_id,
    });
    await store.commitStarted;
    await registry.reset();
    store.releaseCommit();

    await expect(commit).rejects.toMatchObject({ code: "APPROVAL_NOT_FOUND" });
    expect((await adapter.getTools()).map((tool) => tool.name)).toEqual(
      [...BASE_TOOL_NAMES].sort(),
    );
    expect(store.getSnapshot().phase).toBe("idle");
  });

  it("reset is repeatable and leaves only the baseline tools", async () => {
    const { adapter, registry, store } = setup();
    await registry.start();
    await executeToolSequence(registry);
    await store.approveDraft();
    await waitForTool(adapter, COMMIT_TOOL_NAME, true);

    await registry.reset();
    await registry.reset();

    expect((await adapter.getTools()).map((tool) => tool.name)).toEqual(
      [...BASE_TOOL_NAMES].sort(),
    );
    expect(store.getSnapshot()).toMatchObject({
      phase: "idle",
      approval: null,
      draft: null,
      committed_dispatch: null,
    });
  });

  it("avoids duplicate registration across Strict Mode-style start/stop/start", async () => {
    const { adapter, registry } = setup();

    const first = registry.start();
    const cleanup = registry.stop();
    const remount = registry.start();
    await Promise.all([first, cleanup, remount]);

    const names = (await adapter.getTools()).map((tool) => tool.name);
    expect(names).toEqual([...BASE_TOOL_NAMES].sort());
    expect(new Set(names).size).toBe(names.length);
    expect(adapter.getRegisterCount()).toBe(5);
  });

  it("aborts every controller during final cleanup", async () => {
    const { adapter, registry, store } = setup();
    await registry.start();
    await executeToolSequence(registry);
    await store.approveDraft();
    await waitForTool(adapter, COMMIT_TOOL_NAME, true);

    await registry.stop();

    expect(await adapter.getTools()).toEqual([]);
    expect(adapter.getAbortCount()).toBe(6);
  });

  it("emits toolchange so consumers can refresh actual tools", async () => {
    const { adapter, registry, store } = setup();
    const listener = vi.fn();
    adapter.addEventListener("toolchange", listener);
    await registry.start();
    await executeToolSequence(registry);
    await store.approveDraft();
    await waitForTool(adapter, COMMIT_TOOL_NAME, true);

    expect(listener).toHaveBeenCalledTimes(6);
  });
});
