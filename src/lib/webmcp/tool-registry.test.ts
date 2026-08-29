import { describe, expect, it, vi } from "vitest";

import { APPROVAL_TTL_MS } from "@/lib/domain/approval";
import { DispatchStore } from "@/lib/domain/dispatch-machine";
import { DispatchDomainError, type Clock } from "@/lib/domain/types";

import { FakeWebMcpAdapter } from "./fake-adapter";
import type { RegisteredTool, ToolDefinition } from "./types";
import {
  BASE_TOOL_NAMES,
  COMMIT_TOOL_NAME,
  TOOL_SEQUENCE,
  ToolRegistry,
  executeToolSequence,
} from "./tool-registry";

const foreignTool: ToolDefinition = {
  name: "foreign_tool",
  description: "Test-only registry contamination.",
  execute: () => ({ ok: true }),
};

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

class StickyCommitAdapter extends FakeWebMcpAdapter {
  private lastCommitTool: RegisteredTool | null = null;

  override async getTools(): Promise<RegisteredTool[]> {
    const tools = await super.getTools();
    const commitTool = tools.find((tool) => tool.name === COMMIT_TOOL_NAME);
    if (commitTool) {
      this.lastCommitTool = commitTool;
      return tools;
    }
    return this.lastCommitTool ? [...tools, this.lastCommitTool] : tools;
  }
}

class RetainedCallbackSurfaceAdapter extends FakeWebMcpAdapter {
  private commitDefinition: ToolDefinition | null = null;
  private retainedSurface: RegisteredTool[] | null = null;

  override async registerTool(
    tool: ToolDefinition,
    options: { signal?: AbortSignal } = {},
  ): Promise<void> {
    if (tool.name === COMMIT_TOOL_NAME) {
      this.commitDefinition = tool;
    }
    await super.registerTool(tool, options);
  }

  override async getTools(): Promise<RegisteredTool[]> {
    return this.retainedSurface ?? super.getTools();
  }

  async retainCurrentSurface(): Promise<void> {
    this.retainedSurface = await super.getTools();
  }

  executeCapturedCommit(input: Record<string, unknown>): Promise<unknown> {
    if (!this.commitDefinition) {
      throw new Error("No temporary callback was captured.");
    }
    return Promise.resolve(
      this.commitDefinition.execute(input, {
        signal: new AbortController().signal,
      }),
    );
  }
}

class ExecutionSurfaceReadAdapter extends FakeWebMcpAdapter {
  private failuresRemaining = 0;
  private hideCommit = false;

  override async getTools(): Promise<RegisteredTool[]> {
    const tools = await super.getTools();
    if (this.failuresRemaining > 0) {
      this.failuresRemaining -= 1;
      throw new Error("Execution registry read failed.");
    }
    if (this.hideCommit) {
      this.hideCommit = false;
      return tools.filter((tool) => tool.name !== COMMIT_TOOL_NAME);
    }
    return tools;
  }

  failNextReads(count: number): void {
    this.failuresRemaining = count;
  }

  hideCommitOnce(): void {
    this.hideCommit = true;
  }
}

class AbortAwarePausedCommitRegistrationAdapter extends FakeWebMcpAdapter {
  private releaseRegistration: (() => void) | null = null;
  private announceRegistration: (() => void) | null = null;
  private shouldPause = true;
  registrationSignal: AbortSignal | null = null;
  readonly commitRegistrationStarted = new Promise<void>((resolve) => {
    this.announceRegistration = resolve;
  });

  override async registerTool(
    ...parameters: Parameters<FakeWebMcpAdapter["registerTool"]>
  ): Promise<void> {
    if (parameters[0].name === COMMIT_TOOL_NAME && this.shouldPause) {
      this.shouldPause = false;
      this.registrationSignal = parameters[1]?.signal ?? null;
      this.announceRegistration?.();
      await new Promise<void>((resolve, reject) => {
        this.releaseRegistration = resolve;
        this.registrationSignal?.addEventListener(
          "abort",
          () =>
            reject(
              this.registrationSignal?.reason ??
                new DOMException("Registration cancelled.", "AbortError"),
            ),
          { once: true },
        );
      });
    }
    return super.registerTool(...parameters);
  }

  releaseCommitRegistration(): void {
    this.releaseRegistration?.();
  }
}

class PausedTemporaryVerificationAdapter extends FakeWebMcpAdapter {
  private releaseVerification: (() => void) | null = null;
  private announceVerification: (() => void) | null = null;
  private shouldPause = true;
  readonly temporaryVerificationStarted = new Promise<void>((resolve) => {
    this.announceVerification = resolve;
  });

  override async getTools(): Promise<RegisteredTool[]> {
    const tools = await super.getTools();
    if (
      this.shouldPause &&
      tools.some((tool) => tool.name === COMMIT_TOOL_NAME)
    ) {
      this.shouldPause = false;
      this.announceVerification?.();
      await new Promise<void>((resolve) => {
        this.releaseVerification = resolve;
      });
    }
    return tools;
  }

  releaseTemporaryVerification(): void {
    this.releaseVerification?.();
  }
}

class RejectablePausedTemporaryVerificationAdapter extends FakeWebMcpAdapter {
  private rejectVerification: (() => void) | null = null;
  private announceVerification: (() => void) | null = null;
  private shouldPause = true;
  readCount = 0;
  readonly temporaryVerificationStarted = new Promise<void>((resolve) => {
    this.announceVerification = resolve;
  });

  override async getTools(): Promise<RegisteredTool[]> {
    this.readCount += 1;
    const tools = await super.getTools();
    if (
      this.shouldPause &&
      tools.some((tool) => tool.name === COMMIT_TOOL_NAME)
    ) {
      this.shouldPause = false;
      this.announceVerification?.();
      await new Promise<void>((_resolve, reject) => {
        this.rejectVerification = () =>
          reject(new Error("Paused temporary verification failed."));
      });
    }
    return tools;
  }

  rejectTemporaryVerification(): void {
    this.rejectVerification?.();
  }
}

class RetryDelayTemporaryVerificationAdapter extends FakeWebMcpAdapter {
  private rejectNextTemporaryRead = true;
  private announceRejectedRead: (() => void) | null = null;
  readCount = 0;
  readonly temporaryReadRejected = new Promise<void>((resolve) => {
    this.announceRejectedRead = resolve;
  });

  override async getTools(): Promise<RegisteredTool[]> {
    this.readCount += 1;
    const tools = await super.getTools();
    if (
      this.rejectNextTemporaryRead &&
      tools.some((tool) => tool.name === COMMIT_TOOL_NAME)
    ) {
      this.rejectNextTemporaryRead = false;
      this.announceRejectedRead?.();
      throw new Error("Temporary verification entered its retry delay.");
    }
    return tools;
  }
}

class RejectableArmedTemporaryVerificationAdapter extends FakeWebMcpAdapter {
  private rejectVerification: (() => void) | null = null;
  private announceVerification: (() => void) | null = null;
  private shouldPause = false;
  readCount = 0;

  armTemporaryVerification(): Promise<void> {
    this.shouldPause = true;
    return new Promise<void>((resolve) => {
      this.announceVerification = resolve;
    });
  }

  override async getTools(): Promise<RegisteredTool[]> {
    this.readCount += 1;
    const tools = await super.getTools();
    if (
      this.shouldPause &&
      tools.some((tool) => tool.name === COMMIT_TOOL_NAME)
    ) {
      this.shouldPause = false;
      this.announceVerification?.();
      await new Promise<void>((_resolve, reject) => {
        this.rejectVerification = () =>
          reject(new Error("Paused execution verification failed."));
      });
    }
    return tools;
  }

  rejectTemporaryVerification(): void {
    this.rejectVerification?.();
  }
}

class ArmedTemporaryVerificationAdapter extends FakeWebMcpAdapter {
  private releaseVerification: (() => void) | null = null;
  private announceVerification: (() => void) | null = null;
  private shouldPause = false;
  private commitReadsBeforePause = 0;

  armTemporaryVerification(commitRead = 1): Promise<void> {
    this.shouldPause = true;
    this.commitReadsBeforePause = commitRead;
    return new Promise<void>((resolve) => {
      this.announceVerification = resolve;
    });
  }

  override async getTools(): Promise<RegisteredTool[]> {
    const tools = await super.getTools();
    if (
      this.shouldPause &&
      tools.some((tool) => tool.name === COMMIT_TOOL_NAME)
    ) {
      this.commitReadsBeforePause -= 1;
      if (this.commitReadsBeforePause > 0) {
        return tools;
      }
      this.shouldPause = false;
      this.announceVerification?.();
      await new Promise<void>((resolve) => {
        this.releaseVerification = resolve;
      });
    }
    return tools;
  }

  releaseTemporaryVerification(): void {
    this.releaseVerification?.();
  }
}

class CallbackOnTemporaryReadAdapter extends FakeWebMcpAdapter {
  private onNextTemporaryRead: (() => void) | null = null;

  armTemporaryRead(callback: () => void): void {
    this.onNextTemporaryRead = callback;
  }

  override async getTools(): Promise<RegisteredTool[]> {
    const tools = await super.getTools();
    if (
      this.onNextTemporaryRead &&
      tools.some((tool) => tool.name === COMMIT_TOOL_NAME)
    ) {
      const callback = this.onNextTemporaryRead;
      this.onNextTemporaryRead = null;
      callback();
    }
    return tools;
  }
}

class PausedFirstRegistrationAdapter extends FakeWebMcpAdapter {
  private releaseRegistration: (() => void) | null = null;
  private announceRegistration: (() => void) | null = null;
  private registrationCount = 0;
  registrationSignal: AbortSignal | null = null;
  readonly firstRegistrationStarted = new Promise<void>((resolve) => {
    this.announceRegistration = resolve;
  });

  override async registerTool(
    ...parameters: Parameters<FakeWebMcpAdapter["registerTool"]>
  ): Promise<void> {
    this.registrationCount += 1;
    if (this.registrationCount === 1) {
      this.registrationSignal = parameters[1]?.signal ?? null;
      this.announceRegistration?.();
      await new Promise<void>((resolve) => {
        this.releaseRegistration = resolve;
      });
    }
    return super.registerTool(...parameters);
  }

  releaseFirstRegistration(): void {
    this.releaseRegistration?.();
  }
}

class PausedFirstReadAdapter extends FakeWebMcpAdapter {
  private releaseRead: (() => void) | null = null;
  private announceRead: (() => void) | null = null;
  private shouldPause = true;
  readonly firstReadStarted = new Promise<void>((resolve) => {
    this.announceRead = resolve;
  });

  override async getTools(): Promise<RegisteredTool[]> {
    const tools = await super.getTools();
    if (this.shouldPause) {
      this.shouldPause = false;
      this.announceRead?.();
      await new Promise<void>((resolve) => {
        this.releaseRead = resolve;
      });
    }
    return tools;
  }

  releaseFirstRead(): void {
    this.releaseRead?.();
  }
}

class TransientVerificationReadAdapter extends FakeWebMcpAdapter {
  private initialFailuresRemaining: number;
  private failTemporaryRead = false;
  private failRevocationRead = false;
  private temporarySeen = false;
  readCount = 0;

  constructor(initialFailures = 1) {
    super();
    this.initialFailuresRemaining = initialFailures;
  }

  override async getTools(): Promise<RegisteredTool[]> {
    this.readCount += 1;
    const tools = await super.getTools();
    const hasTemporary = tools.some((tool) => tool.name === COMMIT_TOOL_NAME);
    if (hasTemporary) {
      this.temporarySeen = true;
    }
    if (this.initialFailuresRemaining > 0) {
      this.initialFailuresRemaining -= 1;
      throw new Error("Transient verification read failed.");
    }
    if (
      this.failTemporaryRead &&
      hasTemporary
    ) {
      this.failTemporaryRead = false;
      throw new Error("Transient temporary verification read failed.");
    }
    if (this.failRevocationRead && this.temporarySeen && !hasTemporary) {
      this.failRevocationRead = false;
      throw new Error("Transient revocation verification read failed.");
    }
    return tools;
  }

  failTemporaryVerificationOnce(): void {
    this.failTemporaryRead = true;
  }

  failRevocationVerificationOnce(): void {
    this.failRevocationRead = true;
  }
}

class OneReadLaggingVisibilityAdapter extends FakeWebMcpAdapter {
  private staleTemporaryRead = false;
  private staleRevocationRead = false;
  private commitTool: RegisteredTool | null = null;

  override async registerTool(
    ...parameters: Parameters<FakeWebMcpAdapter["registerTool"]>
  ): Promise<void> {
    await super.registerTool(...parameters);
    if (parameters[0].name !== COMMIT_TOOL_NAME) return;

    this.commitTool = (await super.getTools()).find(
      (tool) => tool.name === COMMIT_TOOL_NAME,
    )!;
    this.staleTemporaryRead = true;
    parameters[1]?.signal?.addEventListener(
      "abort",
      () => {
        this.staleRevocationRead = true;
      },
      { once: true },
    );
  }

  override async getTools(): Promise<RegisteredTool[]> {
    const actualTools = await super.getTools();
    if (this.staleTemporaryRead) {
      this.staleTemporaryRead = false;
      return actualTools.filter((tool) => tool.name !== COMMIT_TOOL_NAME);
    }
    if (this.staleRevocationRead && this.commitTool) {
      this.staleRevocationRead = false;
      return [...actualTools, this.commitTool].sort((left, right) =>
        left.name.localeCompare(right.name),
      );
    }
    return actualTools;
  }
}

class PausedRevocationVerificationAdapter extends FakeWebMcpAdapter {
  private releaseRead: (() => void) | null = null;
  private announceRead: (() => void) | null = null;
  private pauseRevocation = false;
  private sawCommitTool = false;
  private failuresRemaining = 0;
  revocationReadStarted: Promise<void> = Promise.resolve();

  armRevocationRead(failAfterRelease: boolean): void {
    this.pauseRevocation = true;
    this.failuresRemaining = failAfterRelease ? 3 : 0;
    this.revocationReadStarted = new Promise<void>((resolve) => {
      this.announceRead = resolve;
    });
  }

  override async getTools(): Promise<RegisteredTool[]> {
    const tools = await super.getTools();
    const hasCommitTool = tools.some(
      (tool) => tool.name === COMMIT_TOOL_NAME,
    );
    if (hasCommitTool) {
      this.sawCommitTool = true;
    }
    if (this.sawCommitTool && !hasCommitTool && this.pauseRevocation) {
      this.pauseRevocation = false;
      this.announceRead?.();
      await new Promise<void>((resolve) => {
        this.releaseRead = resolve;
      });
    }
    if (
      this.sawCommitTool &&
      !hasCommitTool &&
      this.failuresRemaining > 0
    ) {
      this.failuresRemaining -= 1;
      throw new Error("Paused stale revocation verification failed.");
    }
    return tools;
  }

  releaseRevocationRead(): void {
    this.releaseRead?.();
  }
}

class RejectablePausedRevocationVerificationAdapter extends FakeWebMcpAdapter {
  private rejectRead: (() => void) | null = null;
  private announceRead: (() => void) | null = null;
  private pauseRevocation = false;
  private sawCommitTool = false;
  readCount = 0;
  revocationReadStarted: Promise<void> = Promise.resolve();

  armRevocationRead(): void {
    this.pauseRevocation = true;
    this.revocationReadStarted = new Promise<void>((resolve) => {
      this.announceRead = resolve;
    });
  }

  override async getTools(): Promise<RegisteredTool[]> {
    this.readCount += 1;
    const tools = await super.getTools();
    const hasCommitTool = tools.some(
      (tool) => tool.name === COMMIT_TOOL_NAME,
    );
    if (hasCommitTool) {
      this.sawCommitTool = true;
    }
    if (this.sawCommitTool && !hasCommitTool && this.pauseRevocation) {
      this.pauseRevocation = false;
      this.announceRead?.();
      await new Promise<void>((_resolve, reject) => {
        this.rejectRead = () =>
          reject(new Error("Obsolete revocation verification failed."));
      });
    }
    return tools;
  }

  rejectRevocationRead(): void {
    this.rejectRead?.();
  }
}

class TransientNamedToolReadAdapter extends FakeWebMcpAdapter {
  private nextRead: "reject" | "hide-commit" | null = null;

  rejectNextRead(): void {
    this.nextRead = "reject";
  }

  hideCommitOnNextRead(): void {
    this.nextRead = "hide-commit";
  }

  override async getTools(): Promise<RegisteredTool[]> {
    const tools = await super.getTools();
    const mode = this.nextRead;
    this.nextRead = null;
    if (mode === "reject") {
      throw new Error("Transient named-tool read failed.");
    }
    return mode === "hide-commit"
      ? tools.filter((tool) => tool.name !== COMMIT_TOOL_NAME)
      : tools;
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

class TrackingCommitStore extends DispatchStore {
  commitCallCount = 0;

  override async commitApprovedDispatch(
    ...parameters: Parameters<DispatchStore["commitApprovedDispatch"]>
  ) {
    this.commitCallCount += 1;
    return super.commitApprovedDispatch(...parameters);
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
    expect(
      tools.find((tool) => tool.name === "create_dispatch_draft")?.annotations
        ?.readOnlyHint,
    ).toBe(false);
  });

  it("keeps every deterministic runner input aligned with its native JSON Schema", async () => {
    const { adapter, registry } = setup();
    await registry.start();
    const tools = await adapter.getTools();

    for (const step of TOOL_SEQUENCE) {
      const tool = tools.find((candidate) => candidate.name === step.name);
      const schema = tool?.inputSchema as
        | {
            additionalProperties?: unknown;
            properties?: Record<string, { const?: unknown }>;
            required?: string[];
            type?: unknown;
          }
        | undefined;
      const input = step.input as Record<string, unknown>;

      expect(schema).toBeDefined();
      expect(schema?.type).toBe("object");
      expect(schema?.additionalProperties).toBe(false);
      expect([...(schema?.required ?? [])].sort()).toEqual(
        Object.keys(input).sort(),
      );
      expect(Object.keys(schema?.properties ?? {}).sort()).toEqual(
        Object.keys(input).sort(),
      );
      for (const [key, value] of Object.entries(input)) {
        expect(schema?.properties?.[key]?.const).toEqual(value);
      }
    }

    await registry.stop();
  });

  it("recovers one-shot baseline and temporary verification reads", async () => {
    const adapter = new TransientVerificationReadAdapter();
    const store = new DispatchStore();
    const registry = new ToolRegistry(adapter, store);

    await registry.start();
    expect((await adapter.getTools()).map((tool) => tool.name)).toEqual(
      [...BASE_TOOL_NAMES].sort(),
    );

    await executeToolSequence(registry);
    adapter.failTemporaryVerificationOnce();
    await store.approveDraft();
    await waitForTool(adapter, COMMIT_TOOL_NAME, true);

    expect(store.getSnapshot()).toMatchObject({
      phase: "approved",
      approval: { status: "approved" },
      error_code: null,
    });

    const approvalId = store.getSnapshot().approval!.approval_id;
    adapter.failRevocationVerificationOnce();
    await registry.executeNamedTool(COMMIT_TOOL_NAME, {
      approval_id: approvalId,
    });
    await vi.waitFor(() => {
      expect(store.getSnapshot().audit_log.at(-1)?.message).toBe(
        "Temporary capability revoked after one exact action",
      );
    });
    expect(store.getSnapshot().error_code).toBeNull();
    expect((await adapter.getTools()).map((tool) => tool.name)).toEqual(
      [...BASE_TOOL_NAMES].sort(),
    );
    await registry.stop();

    const persistentAdapter = new TransientVerificationReadAdapter(3);
    const persistentRegistry = new ToolRegistry(
      persistentAdapter,
      new DispatchStore(),
    );
    await expect(persistentRegistry.start()).rejects.toThrow(
      "Transient verification read failed.",
    );
    expect(persistentAdapter.readCount).toBe(3);
    expect(await persistentAdapter.getTools()).toEqual([]);
  });

  it("recovers a one-read registry visibility lag across registration and revocation", async () => {
    const adapter = new OneReadLaggingVisibilityAdapter();
    const store = new DispatchStore();
    const registry = new ToolRegistry(adapter, store);

    await registry.start();
    await executeToolSequence(registry);
    const approval = await store.approveDraft();
    await waitForTool(adapter, COMMIT_TOOL_NAME, true);

    expect(store.getSnapshot()).toMatchObject({
      phase: "approved",
      approval: { status: "approved" },
      error_code: null,
    });

    await registry.executeNamedTool(COMMIT_TOOL_NAME, {
      approval_id: approval.approval_id,
    });
    await vi.waitFor(() => {
      expect(store.getSnapshot().audit_log.at(-1)?.message).toBe(
        "Temporary capability revoked after one exact action",
      );
    });
    expect(store.getSnapshot().error_code).toBeNull();
    expect((await adapter.getTools()).map((tool) => tool.name)).toEqual(
      [...BASE_TOOL_NAMES].sort(),
    );
  });

  it("recovers transient named-tool reads before preparation and commit execution", async () => {
    const adapter = new TransientNamedToolReadAdapter();
    const store = new DispatchStore();
    const registry = new ToolRegistry(adapter, store);

    await registry.start();
    adapter.rejectNextRead();
    await registry.executeNamedTool("get_active_vehicle", {});
    await executeToolSequence(registry);
    const approval = await store.approveDraft();
    await waitForTool(adapter, COMMIT_TOOL_NAME, true);

    adapter.hideCommitOnNextRead();
    await registry.executeNamedTool(COMMIT_TOOL_NAME, {
      approval_id: approval.approval_id,
    });
    await waitForTool(adapter, COMMIT_TOOL_NAME, false);
    expect(store.getSnapshot().phase).toBe("committed");
  });

  it("rechecks the exact six-tool surface before a native-direct commit", async () => {
    const adapter = new ExecutionSurfaceReadAdapter();
    const store = new DispatchStore();
    const registry = new ToolRegistry(adapter, store);
    const foreignController = new AbortController();

    await registry.start();
    await executeToolSequence(registry);
    const approval = await store.approveDraft();
    await waitForTool(adapter, COMMIT_TOOL_NAME, true);
    const commitTool = (await adapter.getTools()).find(
      (tool) => tool.name === COMMIT_TOOL_NAME,
    )!;
    await adapter.registerTool(foreignTool, {
      signal: foreignController.signal,
    });

    await expect(
      adapter.executeTool(commitTool, {
        approval_id: approval.approval_id,
      }),
    ).rejects.toThrow(
      "Expected the five baseline capabilities and one temporary commit capability",
    );
    expect(store.getSnapshot()).toMatchObject({
      phase: "approved",
      approval: { status: "approved", used_at: null },
      committed_dispatch: null,
    });

    foreignController.abort();
    adapter.failNextReads(3);
    await expect(
      adapter.executeTool(commitTool, {
        approval_id: approval.approval_id,
      }),
    ).rejects.toThrow("Execution registry read failed.");
    expect(store.getSnapshot()).toMatchObject({
      phase: "approved",
      approval: { status: "approved", used_at: null },
      committed_dispatch: null,
    });

    adapter.hideCommitOnce();
    await adapter.executeTool(commitTool, {
      approval_id: approval.approval_id,
    });
    expect(store.getSnapshot().phase).toBe("committed");
    await registry.stop();
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
    expect(commitTool?.annotations?.readOnlyHint).toBe(false);
  });

  it("reconciles hostile approval accessors before registry status reads", async () => {
    const { adapter, registry, store } = setup();
    await registry.start();
    await executeToolSequence(registry);
    const approval = await store.approveDraft();
    await waitForTool(adapter, COMMIT_TOOL_NAME, true);
    const accessor = vi.fn(() => {
      throw new Error("Approval status accessor must not execute.");
    });
    Object.defineProperty(approval, "status", {
      enumerable: true,
      get: accessor,
    });

    expect(() =>
      store.recordCapabilityLifecycleFailure("Trigger registry reconciliation."),
    ).not.toThrow();
    await waitForTool(adapter, COMMIT_TOOL_NAME, false);

    expect(accessor).not.toHaveBeenCalled();
    expect(store.getSnapshot()).toMatchObject({
      phase: "draft_ready",
      approval: { status: "invalidated" },
      error_code: "CAPABILITY_NOT_AVAILABLE",
      committed_dispatch: null,
    });
    await registry.stop();
  });

  it("does not execute tool 06 before its six-tool registry read-back succeeds", async () => {
    const adapter = new PausedTemporaryVerificationAdapter();
    const store = new TrackingCommitStore();
    const registry = new ToolRegistry(adapter, store);
    await registry.start();
    await executeToolSequence(registry);
    const approval = await store.approveDraft();
    await adapter.temporaryVerificationStarted;
    const commitTool = (await adapter.getTools()).find(
      (tool) => tool.name === COMMIT_TOOL_NAME,
    )!;

    const execution = adapter.executeTool(commitTool, {
      approval_id: approval.approval_id,
    });
    await Promise.resolve();

    try {
      expect(store.commitCallCount).toBe(0);
      expect(store.getSnapshot()).toMatchObject({
        phase: "approved",
        committed_dispatch: null,
      });
    } finally {
      adapter.releaseTemporaryVerification();
      await Promise.allSettled([execution]);
      await registry.stop();
    }

    expect(store.commitCallCount).toBe(1);
    expect(store.getSnapshot().phase).toBe("committed");
  });

  it("cancels an invocation waiting on tool-06 verification when Reset wins", async () => {
    const adapter = new PausedTemporaryVerificationAdapter();
    const store = new TrackingCommitStore();
    const registry = new ToolRegistry(adapter, store);
    await registry.start();
    await executeToolSequence(registry);
    const approval = await store.approveDraft();
    await adapter.temporaryVerificationStarted;
    const commitTool = (await adapter.getTools()).find(
      (tool) => tool.name === COMMIT_TOOL_NAME,
    )!;
    const execution = adapter.executeTool(commitTool, {
      approval_id: approval.approval_id,
    });

    const reset = registry.reset();
    const [executionOutcome, resetOutcome] = await Promise.allSettled([
      execution,
      reset,
    ]);

    try {
      expect(executionOutcome).toMatchObject({
        status: "rejected",
        reason: { name: "AbortError" },
      });
      expect(resetOutcome).toMatchObject({ status: "fulfilled" });
      expect(store.commitCallCount).toBe(0);
      expect(store.getSnapshot().phase).toBe("idle");
      expect((await adapter.getTools()).map((tool) => tool.name)).toEqual(
        [...BASE_TOOL_NAMES].sort(),
      );
    } finally {
      adapter.releaseTemporaryVerification();
      await registry.stop();
    }
  });

  it("does not retry an exact-surface read after Reset aborts verification", async () => {
    const adapter = new RejectablePausedTemporaryVerificationAdapter();
    const store = new TrackingCommitStore();
    const registry = new ToolRegistry(adapter, store);
    await registry.start();
    await executeToolSequence(registry);
    await store.approveDraft();
    await adapter.temporaryVerificationStarted;

    const reset = registry.reset();
    await expect(reset).resolves.toBeUndefined();
    const readsAfterReset = adapter.readCount;
    adapter.rejectTemporaryVerification();
    await new Promise<void>((resolve) => {
      globalThis.setTimeout(resolve, 100);
    });

    expect(adapter.readCount).toBe(readsAfterReset);
    expect(store.getSnapshot()).toMatchObject({
      phase: "idle",
      approval: null,
      committed_dispatch: null,
    });
    expect((await adapter.getTools()).map((tool) => tool.name)).toEqual(
      [...BASE_TOOL_NAMES].sort(),
    );
    await registry.stop();
  });

  it("cancels a scheduled exact-surface retry delay when Reset wins", async () => {
    vi.useFakeTimers();
    const adapter = new RetryDelayTemporaryVerificationAdapter();
    const store = new DispatchStore();
    const registry = new ToolRegistry(adapter, store);

    try {
      await registry.start();
      await executeToolSequence(registry);
      await store.approveDraft();
      await adapter.temporaryReadRejected;
      await Promise.resolve();
      await Promise.resolve();

      expect(vi.getTimerCount()).toBe(1);
      const readsBeforeReset = adapter.readCount;
      await expect(registry.reset()).resolves.toBeUndefined();

      expect(vi.getTimerCount()).toBe(0);
      expect(adapter.readCount).toBe(readsBeforeReset + 1);
      await vi.advanceTimersByTimeAsync(100);
      expect(adapter.readCount).toBe(readsBeforeReset + 1);
      expect(store.getSnapshot()).toMatchObject({
        phase: "idle",
        approval: null,
        committed_dispatch: null,
        error_code: null,
        error_message: null,
      });
    } finally {
      await registry.stop();
      vi.useRealTimers();
    }
  });

  it("does not retry a callback surface read after Reset revokes its registration", async () => {
    const adapter = new RejectableArmedTemporaryVerificationAdapter();
    const store = new DispatchStore();
    const registry = new ToolRegistry(adapter, store);
    await registry.start();
    await executeToolSequence(registry);
    const approval = await store.approveDraft();
    await waitForTool(adapter, COMMIT_TOOL_NAME, true);
    const commitTool = (await adapter.getTools()).find(
      (tool) => tool.name === COMMIT_TOOL_NAME,
    )!;
    const verificationStarted = adapter.armTemporaryVerification();

    const execution = adapter.executeTool(commitTool, {
      approval_id: approval.approval_id,
    });
    await verificationStarted;
    const reset = registry.reset();
    await expect(reset).resolves.toBeUndefined();
    await expect(execution).rejects.toMatchObject({ name: "AbortError" });
    const readsAfterReset = adapter.readCount;

    adapter.rejectTemporaryVerification();
    await new Promise<void>((resolve) => {
      globalThis.setTimeout(resolve, 100);
    });

    expect(adapter.readCount).toBe(readsAfterReset);
    expect(store.getSnapshot()).toMatchObject({
      phase: "idle",
      approval: null,
      committed_dispatch: null,
    });
    expect((await adapter.getTools()).map((tool) => tool.name)).toEqual(
      [...BASE_TOOL_NAMES].sort(),
    );
    await registry.stop();
  });

  it("invalidates Reset authority synchronously while verification cleanup waits", async () => {
    const adapter = new PausedTemporaryVerificationAdapter();
    const store = new DispatchStore();
    const registry = new ToolRegistry(adapter, store);
    await registry.start();
    await executeToolSequence(registry);
    const approval = await store.approveDraft();
    await adapter.temporaryVerificationStarted;
    const capturedTool = (await adapter.getTools()).find(
      (tool) => tool.name === COMMIT_TOOL_NAME,
    )!;

    const reset = registry.reset();
    expect(store.getSnapshot()).toMatchObject({
      phase: "idle",
      approval: null,
      committed_dispatch: null,
    });
    await expect(
      adapter.executeTool(capturedTool, {
        approval_id: approval.approval_id,
      }),
    ).rejects.toMatchObject({ name: "InvalidStateError" });

    adapter.releaseTemporaryVerification();
    await expect(reset).resolves.toBeUndefined();
    expect((await adapter.getTools()).map((tool) => tool.name)).toEqual(
      [...BASE_TOOL_NAMES].sort(),
    );
    await registry.stop();
  });

  it("rejects an active captured tool immediately after synchronous Reset", async () => {
    const { adapter, registry, store } = setup();
    await registry.start();
    await executeToolSequence(registry);
    const approval = await store.approveDraft();
    await waitForTool(adapter, COMMIT_TOOL_NAME, true);
    await vi.waitFor(() => {
      expect(
        store
          .getSnapshot()
          .audit_log.some(
            (entry) =>
              entry.message === "Temporary commit capability registered",
          ),
      ).toBe(true);
    });
    const capturedTool = (await adapter.getTools()).find(
      (tool) => tool.name === COMMIT_TOOL_NAME,
    )!;

    const reset = registry.reset();
    expect(store.getSnapshot().phase).toBe("idle");
    const outcome = await Promise.allSettled([
      adapter.executeTool(capturedTool, {
        approval_id: approval.approval_id,
      }),
    ]);
    expect(outcome[0]?.status).toBe("rejected");
    if (outcome[0]?.status === "rejected") {
      const reason = outcome[0].reason as { code?: string; name?: string };
      expect([reason.code, reason.name]).toEqual(
        expect.arrayContaining([
          expect.stringMatching(
            /AbortError|CAPABILITY_NOT_AVAILABLE|InvalidStateError/,
          ),
        ]),
      );
    }
    await reset;

    expect(store.getSnapshot()).toMatchObject({
      phase: "idle",
      approval: null,
      committed_dispatch: null,
    });
    expect((await adapter.getTools()).map((tool) => tool.name)).toEqual(
      [...BASE_TOOL_NAMES].sort(),
    );
    await registry.stop();
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

  it("does not consume approval for execution cancelled before or during validation", async () => {
    const { adapter, registry, store } = setup();
    await registry.start();
    await executeToolSequence(registry);
    const approval = await store.approveDraft();
    await waitForTool(adapter, COMMIT_TOOL_NAME, true);
    const commitTool = (await adapter.getTools()).find(
      (tool) => tool.name === COMMIT_TOOL_NAME,
    )!;
    const execution = new AbortController();
    execution.abort(new DOMException("Commit cancelled.", "AbortError"));

    await expect(
      adapter.executeTool(
        commitTool,
        { approval_id: approval.approval_id },
        { signal: execution.signal },
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(store.getSnapshot()).toMatchObject({
      phase: "approved",
      approval: { status: "approved", used_at: null },
      committed_dispatch: null,
    });

    const actualDigest = globalThis.crypto.subtle.digest.bind(
      globalThis.crypto.subtle,
    );
    let announceDigest!: () => void;
    const digestStarted = new Promise<void>((resolve) => {
      announceDigest = resolve;
    });
    const digestControl: { release: (() => void) | null } = {
      release: null,
    };
    const digest = vi
      .spyOn(globalThis.crypto.subtle, "digest")
      .mockImplementation(
        (algorithm, data) =>
          new Promise<ArrayBuffer>((resolve, reject) => {
            let released = false;
            announceDigest();
            digestControl.release = () => {
              if (released) return;
              released = true;
              void actualDigest(algorithm, data).then(resolve, reject);
            };
          }),
      );

    try {
      const pendingExecution = new AbortController();
      const pending = adapter.executeTool(
        commitTool,
        { approval_id: approval.approval_id },
        { signal: pendingExecution.signal },
      );
      await digestStarted;
      pendingExecution.abort(
        new DOMException("Commit cancelled during validation.", "AbortError"),
      );
      digestControl.release?.();

      await expect(pending).rejects.toMatchObject({ name: "AbortError" });
      expect(store.getSnapshot()).toMatchObject({
        phase: "approved",
        approval: { status: "approved", used_at: null },
        committed_dispatch: null,
      });
    } finally {
      digestControl.release?.();
      digest.mockRestore();
      await registry.stop();
    }
  });

  it("cancels an in-flight digest when registration cleanup wins without a host abort", async () => {
    const { adapter, registry, store } = setup();
    await registry.start();
    await executeToolSequence(registry);
    const approval = await store.approveDraft();
    await waitForTool(adapter, COMMIT_TOOL_NAME, true);
    const commitTool = (await adapter.getTools()).find(
      (tool) => tool.name === COMMIT_TOOL_NAME,
    )!;
    const actualDigest = globalThis.crypto.subtle.digest.bind(
      globalThis.crypto.subtle,
    );
    let announceDigest!: () => void;
    const digestStarted = new Promise<void>((resolve) => {
      announceDigest = resolve;
    });
    const digestControl: { release: (() => void) | null } = {
      release: null,
    };
    const digest = vi
      .spyOn(globalThis.crypto.subtle, "digest")
      .mockImplementation(
        (algorithm, data) =>
          new Promise<ArrayBuffer>((resolve, reject) => {
            let released = false;
            announceDigest();
            digestControl.release = () => {
              if (released) return;
              released = true;
              void actualDigest(algorithm, data).then(resolve, reject);
            };
          }),
      );

    try {
      const pending = adapter.executeTool(commitTool, {
        approval_id: approval.approval_id,
      });
      await digestStarted;
      await registry.stop();
      digestControl.release?.();

      await expect(pending).rejects.toMatchObject({ name: "AbortError" });
      expect(store.getSnapshot()).toMatchObject({
        phase: "approved",
        approval: { status: "approved", used_at: null },
        committed_dispatch: null,
      });
      expect(await adapter.getTools()).toEqual([]);

      await registry.start();
      await waitForTool(adapter, COMMIT_TOOL_NAME, true);
      expect(store.getSnapshot()).toMatchObject({
        phase: "approved",
        approval: { status: "approved", used_at: null },
      });
    } finally {
      digestControl.release?.();
      digest.mockRestore();
      await registry.stop();
    }
  });

  it("rejects a callback delivered after stop even when the engine retains the old six-tool surface", async () => {
    const adapter = new RetainedCallbackSurfaceAdapter();
    const store = new DispatchStore();
    const registry = new ToolRegistry(adapter, store);
    await registry.start();
    await executeToolSequence(registry);
    const approval = await store.approveDraft();
    await waitForTool(adapter, COMMIT_TOOL_NAME, true);
    await adapter.retainCurrentSurface();

    await registry.stop();

    await expect(
      adapter.executeCapturedCommit({ approval_id: approval.approval_id }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(store.getSnapshot()).toMatchObject({
      phase: "approved",
      approval: { status: "approved", used_at: null },
      committed_dispatch: null,
    });
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

  it("restores baseline if approval expires during pending registration", async () => {
    let now = Date.parse("2026-08-26T03:00:00.000Z");
    let id = 0;
    const store = new DispatchStore(
      { now: () => now },
      () => `registration-expiry-${++id}`,
    );
    const adapter = new AbortAwarePausedCommitRegistrationAdapter();
    const registry = new ToolRegistry(adapter, store);
    await registry.start();
    await executeToolSequence(registry);

    await store.approveDraft();
    await adapter.commitRegistrationStarted;
    now += APPROVAL_TTL_MS;
    expect(store.expireApprovalIfNeeded()).toBe(true);
    expect(adapter.registrationSignal?.aborted).toBe(true);

    await vi.waitFor(async () => {
      expect(store.getSnapshot()).toMatchObject({
        phase: "draft_ready",
        approval: { status: "expired" },
      });
      expect((await adapter.getTools()).map((tool) => tool.name)).toEqual(
        [...BASE_TOOL_NAMES].sort(),
      );
    });
    await registry.stop();
  });

  it("aborts a pending temporary registration when Reset must take over", async () => {
    const adapter = new AbortAwarePausedCommitRegistrationAdapter();
    const store = new DispatchStore();
    const registry = new ToolRegistry(adapter, store);
    await registry.start();
    await executeToolSequence(registry);

    await store.approveDraft();
    await adapter.commitRegistrationStarted;
    const reset = registry.reset();

    try {
      expect(adapter.registrationSignal?.aborted).toBe(true);
      await reset;
    } finally {
      adapter.releaseCommitRegistration();
      await Promise.allSettled([reset, registry.stop()]);
    }

    expect(store.getSnapshot().phase).toBe("idle");
    expect((await adapter.getTools()).map((tool) => tool.name)).toEqual([]);
  });

  it("aborts a pending temporary registration on cleanup without changing the domain", async () => {
    const adapter = new AbortAwarePausedCommitRegistrationAdapter();
    const store = new DispatchStore();
    const registry = new ToolRegistry(adapter, store);
    await registry.start();
    await executeToolSequence(registry);

    await store.approveDraft();
    await adapter.commitRegistrationStarted;
    const stop = registry.stop();

    try {
      expect(adapter.registrationSignal?.aborted).toBe(true);
      await stop;
    } finally {
      adapter.releaseCommitRegistration();
      await Promise.allSettled([stop]);
    }

    expect(store.getSnapshot()).toMatchObject({
      phase: "approved",
      approval: { status: "approved" },
    });
    expect(await adapter.getTools()).toEqual([]);

    await registry.start();
    await waitForTool(adapter, COMMIT_TOOL_NAME, true);
    expect(store.getSnapshot()).toMatchObject({
      phase: "approved",
      approval: { status: "approved" },
    });
    await registry.stop();
    expect(await adapter.getTools()).toEqual([]);
  });

  it("re-registers an aborted pending tool after immediate cleanup and remount", async () => {
    const adapter = new AbortAwarePausedCommitRegistrationAdapter();
    const store = new DispatchStore();
    const registry = new ToolRegistry(adapter, store);
    await registry.start();
    await executeToolSequence(registry);
    await store.approveDraft();
    await adapter.commitRegistrationStarted;

    const cleanup = registry.stop();
    const remount = registry.start();

    try {
      await Promise.all([cleanup, remount]);
      expect(store.getSnapshot()).toMatchObject({
        phase: "approved",
        approval: { status: "approved" },
      });
      expect((await adapter.getTools()).map((tool) => tool.name)).toEqual(
        [...BASE_TOOL_NAMES, COMMIT_TOOL_NAME].sort(),
      );
    } finally {
      adapter.releaseCommitRegistration();
      await registry.stop();
    }
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
    const outcome = await Promise.allSettled([
      adapter.executeTool(commitTool, {
        approval_id: approval.approval_id,
      }),
    ]);
    expect(outcome[0]?.status).toBe("rejected");
    if (outcome[0]?.status === "rejected") {
      const reason = outcome[0].reason as { code?: string; name?: string };
      expect([reason.code, reason.name]).toEqual(
        expect.arrayContaining([
          expect.stringMatching(
            /DRAFT_CHANGED_AFTER_APPROVAL|InvalidStateError/,
          ),
        ]),
      );
    }
    await waitForTool(adapter, COMMIT_TOOL_NAME, false);
  });

  it("commits once, revokes after settlement, and rejects double execution", async () => {
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

  it.each([false, true])(
    "drops pre-Reset revocation completion state (verification fails: %s)",
    async (failAfterRelease) => {
      const adapter = new PausedRevocationVerificationAdapter();
      const store = new DispatchStore();
      const registry = new ToolRegistry(adapter, store);
      await registry.start();
      await executeToolSequence(registry);
      const approval = await store.approveDraft();
      await waitForTool(adapter, COMMIT_TOOL_NAME, true);
      adapter.armRevocationRead(failAfterRelease);

      await registry.executeNamedTool(COMMIT_TOOL_NAME, {
        approval_id: approval.approval_id,
      });
      await adapter.revocationReadStarted;

      const reset = registry.reset();
      expect(store.getSnapshot()).toMatchObject({
        phase: "idle",
        approval: null,
        committed_dispatch: null,
      });
      adapter.releaseRevocationRead();
      await expect(reset).resolves.toBeUndefined();

      const snapshot = store.getSnapshot();
      expect(snapshot.phase).toBe("idle");
      expect(snapshot.error_code).toBeNull();
      expect(snapshot.error_message).toBeNull();
      expect(
        snapshot.audit_log.some((entry) =>
          entry.message.startsWith("Temporary capability revoked"),
        ),
      ).toBe(false);
      expect((await adapter.getTools()).map((tool) => tool.name)).toEqual(
        [...BASE_TOOL_NAMES].sort(),
      );
      await registry.stop();
    },
  );

  it("lets Reset supersede a paused revoke proof without obsolete retries", async () => {
    const adapter = new RejectablePausedRevocationVerificationAdapter();
    const store = new DispatchStore();
    const registry = new ToolRegistry(adapter, store);
    await registry.start();
    await executeToolSequence(registry);
    const approval = await store.approveDraft();
    await waitForTool(adapter, COMMIT_TOOL_NAME, true);
    adapter.armRevocationRead();

    await registry.executeNamedTool(COMMIT_TOOL_NAME, {
      approval_id: approval.approval_id,
    });
    await adapter.revocationReadStarted;
    const readsAtPause = adapter.readCount;
    const reset = registry.reset();

    try {
      await expect(reset).resolves.toBeUndefined();
      expect(adapter.readCount).toBe(readsAtPause + 1);
      expect(store.getSnapshot()).toMatchObject({
        phase: "idle",
        approval: null,
        committed_dispatch: null,
        error_code: null,
        error_message: null,
      });
      expect((await adapter.getTools()).map((tool) => tool.name)).toEqual(
        [...BASE_TOOL_NAMES].sort(),
      );
      const readsAfterReset = adapter.readCount;

      adapter.rejectRevocationRead();
      await new Promise<void>((resolve) => {
        globalThis.setTimeout(resolve, 100);
      });

      expect(adapter.readCount).toBe(readsAfterReset);
      expect(
        store.getSnapshot().audit_log.some((entry) =>
          entry.message.startsWith("Temporary capability revoked"),
        ),
      ).toBe(false);
    } finally {
      adapter.rejectRevocationRead();
      await reset.catch(() => undefined);
      await registry.stop();
    }
  });

  it("clears a pre-stop revoke failure only after a full remount proves the registry", async () => {
    const adapter = new PausedRevocationVerificationAdapter();
    const store = new DispatchStore();
    const registry = new ToolRegistry(adapter, store);
    await registry.start();
    await executeToolSequence(registry);
    const approval = await store.approveDraft();
    await waitForTool(adapter, COMMIT_TOOL_NAME, true);
    adapter.armRevocationRead(true);

    await registry.executeNamedTool(COMMIT_TOOL_NAME, {
      approval_id: approval.approval_id,
    });
    await adapter.revocationReadStarted;
    const stop = registry.stop();
    adapter.releaseRevocationRead();
    await stop;

    expect(store.getSnapshot()).toMatchObject({
      phase: "committed",
      error_code: "CAPABILITY_NOT_AVAILABLE",
      error_message: "Paused stale revocation verification failed.",
    });
    expect(await adapter.getTools()).toEqual([]);

    const remountedRegistry = new ToolRegistry(adapter, store);
    await remountedRegistry.start();

    expect((await adapter.getTools()).map((tool) => tool.name)).toEqual(
      [...BASE_TOOL_NAMES].sort(),
    );
    expect(store.getSnapshot()).toMatchObject({
      phase: "committed",
      error_code: null,
      error_message: null,
    });
    expect(store.getSnapshot().audit_log.at(-1)?.message).toBe(
      "WebMCP capability lifecycle recovered",
    );
    await remountedRegistry.stop();
  });

  it("clears a handed-off failure only after remount proves the same approval", async () => {
    const adapter = new ArmedTemporaryVerificationAdapter();
    const store = new DispatchStore();
    const registry = new ToolRegistry(adapter, store);
    await registry.start();
    await executeToolSequence(registry);
    const approval = await store.approveDraft();
    await waitForTool(adapter, COMMIT_TOOL_NAME, true);
    store.recordCapabilityLifecycleFailure("Pre-unmount registry failure.");
    const failure = store.getActiveCapabilityLifecycleFailureToken();
    expect(store.markCapabilityLifecycleFailureRecoverable(failure)).toBe(
      true,
    );

    await registry.stop();
    expect(await adapter.getTools()).toEqual([]);
    expect(store.getSnapshot().approval).toMatchObject({
      approval_id: approval.approval_id,
      draft_hash: approval.draft_hash,
      generation: approval.generation,
      status: "approved",
    });

    const verificationStarted = adapter.armTemporaryVerification(2);
    const remountedRegistry = new ToolRegistry(adapter, store);
    const remount = remountedRegistry.start();
    await verificationStarted;

    expect(store.getSnapshot()).toMatchObject({
      phase: "approved",
      error_code: "CAPABILITY_NOT_AVAILABLE",
      error_message: "Pre-unmount registry failure.",
    });

    adapter.releaseTemporaryVerification();
    await remount;

    expect((await adapter.getTools()).map((tool) => tool.name)).toEqual(
      [...BASE_TOOL_NAMES, COMMIT_TOOL_NAME].sort(),
    );
    expect(store.getSnapshot()).toMatchObject({
      phase: "approved",
      error_code: null,
      error_message: null,
      approval: {
        approval_id: approval.approval_id,
        draft_hash: approval.draft_hash,
        generation: approval.generation,
        status: "approved",
      },
    });
    await remountedRegistry.stop();
  });

  it("does not recover an unhanded lifecycle failure from another registry", async () => {
    const adapter = new FakeWebMcpAdapter();
    const store = new DispatchStore();
    store.recordCapabilityLifecycleFailure("Unowned registry failure.");
    const registry = new ToolRegistry(adapter, store);

    await registry.start();

    expect((await adapter.getTools()).map((tool) => tool.name)).toEqual(
      [...BASE_TOOL_NAMES].sort(),
    );
    expect(store.getSnapshot()).toMatchObject({
      error_code: "CAPABILITY_NOT_AVAILABLE",
      error_message: "Unowned registry failure.",
    });
    await registry.stop();
  });

  it("keeps a handed-off failure when stop interrupts remount proof", async () => {
    const adapter = new ArmedTemporaryVerificationAdapter();
    const store = new DispatchStore();
    const registry = new ToolRegistry(adapter, store);
    await registry.start();
    await executeToolSequence(registry);
    await store.approveDraft();
    await waitForTool(adapter, COMMIT_TOOL_NAME, true);
    store.recordCapabilityLifecycleFailure("Recovery must finish first.");
    const failure = store.getActiveCapabilityLifecycleFailureToken();
    expect(store.markCapabilityLifecycleFailureRecoverable(failure)).toBe(
      true,
    );
    await registry.stop();

    const verificationStarted = adapter.armTemporaryVerification(2);
    const remountedRegistry = new ToolRegistry(adapter, store);
    const remount = remountedRegistry.start();
    await verificationStarted;
    const stop = remountedRegistry.stop();
    adapter.releaseTemporaryVerification();
    await Promise.allSettled([remount, stop]);

    expect(await adapter.getTools()).toEqual([]);
    expect(store.getSnapshot()).toMatchObject({
      phase: "approved",
      error_code: "CAPABILITY_NOT_AVAILABLE",
      error_message: "Recovery must finish first.",
    });
  });

  it("does not resurrect a handed-off failure when Reset wins during remount proof", async () => {
    const adapter = new ArmedTemporaryVerificationAdapter();
    const store = new DispatchStore();
    const registry = new ToolRegistry(adapter, store);
    await registry.start();
    await executeToolSequence(registry);
    await store.approveDraft();
    await waitForTool(adapter, COMMIT_TOOL_NAME, true);
    store.recordCapabilityLifecycleFailure("Reset must replace this failure.");
    const failure = store.getActiveCapabilityLifecycleFailureToken();
    expect(store.markCapabilityLifecycleFailureRecoverable(failure)).toBe(
      true,
    );
    await registry.stop();

    const verificationStarted = adapter.armTemporaryVerification(2);
    const remountedRegistry = new ToolRegistry(adapter, store);
    const remount = remountedRegistry.start();
    await verificationStarted;
    const reset = remountedRegistry.reset();

    expect(store.getSnapshot()).toMatchObject({
      phase: "idle",
      approval: null,
      committed_dispatch: null,
      error_code: null,
      error_message: null,
    });

    adapter.releaseTemporaryVerification();
    await expect(Promise.all([remount, reset])).resolves.toBeDefined();

    expect((await adapter.getTools()).map((tool) => tool.name)).toEqual(
      [...BASE_TOOL_NAMES].sort(),
    );
    expect(store.getSnapshot()).toMatchObject({
      phase: "idle",
      approval: null,
      committed_dispatch: null,
      error_code: null,
      error_message: null,
    });
    expect(
      store.getSnapshot().audit_log.some(
        (entry) =>
          entry.message === "WebMCP capability lifecycle recovered",
      ),
    ).toBe(false);
    await remountedRegistry.stop();
  });

  it("keeps a newer expiry error when approval changes during recovery proof", async () => {
    let now = Date.parse("2026-08-26T03:00:00.000Z");
    let id = 0;
    const store = new DispatchStore(
      { now: () => now },
      () => `recovery-expiry-${++id}`,
    );
    const adapter = new ArmedTemporaryVerificationAdapter();
    const registry = new ToolRegistry(adapter, store);
    await registry.start();
    await executeToolSequence(registry);
    await store.approveDraft();
    await waitForTool(adapter, COMMIT_TOOL_NAME, true);
    store.recordCapabilityLifecycleFailure("Old registry read failed.");
    const failure = store.getActiveCapabilityLifecycleFailureToken();
    expect(store.markCapabilityLifecycleFailureRecoverable(failure)).toBe(
      true,
    );
    await registry.stop();

    const verificationStarted = adapter.armTemporaryVerification(2);
    const remountedRegistry = new ToolRegistry(adapter, store);
    const remount = remountedRegistry.start();
    await verificationStarted;
    now += APPROVAL_TTL_MS + 1;
    store.expireApprovalIfNeeded();
    adapter.releaseTemporaryVerification();
    await remount;
    await waitForTool(adapter, COMMIT_TOOL_NAME, false);

    expect((await adapter.getTools()).map((tool) => tool.name)).toEqual(
      [...BASE_TOOL_NAMES].sort(),
    );
    expect(store.getSnapshot()).toMatchObject({
      phase: "draft_ready",
      approval: { status: "expired" },
      error_code: "APPROVAL_EXPIRED",
    });
    await remountedRegistry.stop();
  });

  it("lets queued reconciliation remove tool 06 when approval expires before recovery proof", async () => {
    const initialNow = Date.parse("2026-08-26T03:00:00.000Z");
    let clockMode: "stable" | "crossing" | "expired" = "stable";
    let id = 0;
    const clock: Clock = {
      now: () => {
        if (clockMode === "stable") return initialNow;
        if (clockMode === "crossing") {
          clockMode = "expired";
          return initialNow;
        }
        return initialNow + APPROVAL_TTL_MS + 1;
      },
    };
    const store = new DispatchStore(
      clock,
      () => `recovery-boundary-${++id}`,
    );
    const adapter = new CallbackOnTemporaryReadAdapter();
    const registry = new ToolRegistry(adapter, store);
    await registry.start();
    await executeToolSequence(registry);
    await store.approveDraft();
    await waitForTool(adapter, COMMIT_TOOL_NAME, true);
    store.recordCapabilityLifecycleFailure("Old registry read failed.");
    const failure = store.getActiveCapabilityLifecycleFailureToken();
    expect(store.markCapabilityLifecycleFailureRecoverable(failure)).toBe(
      true,
    );
    await registry.stop();

    adapter.armTemporaryRead(() => {
      clockMode = "crossing";
    });
    const remountedRegistry = new ToolRegistry(adapter, store);
    await expect(remountedRegistry.start()).resolves.toBeUndefined();
    await waitForTool(adapter, COMMIT_TOOL_NAME, false);

    expect((await adapter.getTools()).map((tool) => tool.name)).toEqual(
      [...BASE_TOOL_NAMES].sort(),
    );
    expect(store.getSnapshot()).toMatchObject({
      phase: "draft_ready",
      approval: { status: "expired" },
      committed_dispatch: null,
      error_code: "APPROVAL_EXPIRED",
    });
    await remountedRegistry.stop();
  });

  it("surfaces a failed background revoke without an unhandled rejection", async () => {
    const store = new DispatchStore();
    const adapter = new StickyCommitAdapter();
    const registry = new ToolRegistry(adapter, store);
    await registry.start();
    await executeToolSequence(registry);
    const approval = await store.approveDraft();
    await waitForTool(adapter, COMMIT_TOOL_NAME, true);

    await registry.executeNamedTool(COMMIT_TOOL_NAME, {
      approval_id: approval.approval_id,
    });

    await vi.waitFor(() => {
      expect(store.getSnapshot()).toMatchObject({
        phase: "committed",
        error_code: "CAPABILITY_NOT_AVAILABLE",
        error_message: "The temporary commit capability did not revoke.",
      });
    });
    expect(store.getSnapshot().audit_log.at(-1)?.message).toBe(
      "WebMCP capability lifecycle verification failed",
    );
    await registry.stop();
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
    const rejected = outcomes.find((outcome) => outcome.status === "rejected");
    expect(rejected).toBeDefined();
    if (rejected?.status === "rejected") {
      // The loser either reaches the consumed domain state or observes the
      // winner's settlement-safe registration abort first. Both are closed
      // outcomes; instrumentation can legitimately change that ordering.
      expect(
        rejected.reason instanceof DispatchDomainError
          ? rejected.reason.code
          : (rejected.reason as { name?: unknown }).name,
      ).toMatch(/^(APPROVAL_ALREADY_USED|AbortError)$/);
    }
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

  it("rejects a captured temporary tool handle after Reset", async () => {
    const { adapter, registry, store } = setup();
    await registry.start();
    await executeToolSequence(registry);
    const approval = await store.approveDraft();
    await waitForTool(adapter, COMMIT_TOOL_NAME, true);
    const capturedTool = (await adapter.getTools()).find(
      (tool) => tool.name === COMMIT_TOOL_NAME,
    )!;

    await registry.reset();

    await expect(
      adapter.executeTool(capturedTool, {
        approval_id: approval.approval_id,
      }),
    ).rejects.toMatchObject({ name: "InvalidStateError" });
    expect(store.getSnapshot()).toMatchObject({
      phase: "idle",
      approval: null,
      committed_dispatch: null,
    });
    expect((await adapter.getTools()).map((tool) => tool.name)).toEqual(
      [...BASE_TOOL_NAMES].sort(),
    );
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

  it("still revokes after a committed callback crosses a cancelled Strict stop/start", async () => {
    const { adapter, registry, store } = setup();
    await registry.start();
    await executeToolSequence(registry);
    const approval = await store.approveDraft();
    await waitForTool(adapter, COMMIT_TOOL_NAME, true);
    await registry.executeNamedTool(COMMIT_TOOL_NAME, {
      approval_id: approval.approval_id,
    });

    const stop = registry.stop();
    const restart = registry.start();
    await Promise.all([stop, restart]);
    await waitForTool(adapter, COMMIT_TOOL_NAME, false);

    expect((await adapter.getTools()).map((tool) => tool.name)).toEqual(
      [...BASE_TOOL_NAMES].sort(),
    );
    expect(store.getSnapshot()).toMatchObject({
      phase: "committed",
      error_code: null,
      error_message: null,
    });
    await registry.stop();
  });

  it("does not clear a lifecycle failure when Strict stop/start cancels full proof", async () => {
    const { adapter, registry, store } = setup();
    await registry.start();
    store.recordCapabilityLifecycleFailure("Existing registry failure.");
    const failure = store.getActiveCapabilityLifecycleFailureToken();
    expect(store.markCapabilityLifecycleFailureRecoverable(failure)).toBe(
      true,
    );

    const stop = registry.stop();
    const restart = registry.start();
    await Promise.all([stop, restart]);

    expect((await adapter.getTools()).map((tool) => tool.name)).toEqual(
      [...BASE_TOOL_NAMES].sort(),
    );
    expect(store.getSnapshot()).toMatchObject({
      error_code: "CAPABILITY_NOT_AVAILABLE",
      error_message: "Existing registry failure.",
    });
    await registry.stop();
  });

  it("stops base registration immediately when unmount wins", async () => {
    const adapter = new PausedFirstRegistrationAdapter();
    const registry = new ToolRegistry(adapter, new DispatchStore());

    const start = registry.start();
    await adapter.firstRegistrationStarted;
    const stop = registry.stop();
    let stopSettled = false;
    void stop.then(
      () => {
        stopSettled = true;
      },
      () => {
        stopSettled = true;
      },
    );

    try {
      expect(adapter.registrationSignal?.aborted).toBe(true);
      await vi.waitFor(() => expect(stopSettled).toBe(true), {
        timeout: 100,
      });
    } finally {
      adapter.releaseFirstRegistration();
      await Promise.allSettled([start, stop]);
    }

    expect(adapter.getRegisterCount()).toBe(0);
    expect(adapter.getAbortCount()).toBe(0);
    expect(await adapter.getTools()).toEqual([]);
  });

  it("skips stale startup side effects when unmount wins during verification", async () => {
    const adapter = new PausedFirstReadAdapter();
    const store = new DispatchStore();
    const registry = new ToolRegistry(adapter, store);

    const start = registry.start();
    await adapter.firstReadStarted;
    const stop = registry.stop();
    adapter.releaseFirstRead();
    await Promise.all([start, stop]);

    expect(store.getSnapshot().audit_log).toEqual([]);
    expect(await adapter.getTools()).toEqual([]);
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
