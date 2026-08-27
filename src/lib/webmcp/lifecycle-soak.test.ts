import { describe, expect, it } from "vitest";

import { DispatchStore } from "@/lib/domain/dispatch-machine";

import { FakeWebMcpAdapter } from "./fake-adapter";
import {
  BASE_TOOL_NAMES,
  COMMIT_TOOL_NAME,
  ToolRegistry,
  executeToolSequence,
} from "./tool-registry";

const BASELINE = [...BASE_TOOL_NAMES].sort();
const APPROVED = [...BASE_TOOL_NAMES, COMMIT_TOOL_NAME].sort();

async function waitForTools(
  adapter: FakeWebMcpAdapter,
  expected: string[],
): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const names = (await adapter.getTools()).map((tool) => tool.name);
    if (JSON.stringify(names) === JSON.stringify(expected)) {
      return;
    }
    await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
  }

  expect((await adapter.getTools()).map((tool) => tool.name)).toEqual(expected);
}

function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

describe("WebMCP lifecycle soak", () => {
  it("sustains 100 complete 5→6→5 lifecycles with reset and no leaked tools", async () => {
    const adapter = new FakeWebMcpAdapter();
    const store = new DispatchStore();
    const registry = new ToolRegistry(adapter, store);
    await registry.start();

    for (let cycle = 0; cycle < 100; cycle += 1) {
      await executeToolSequence(registry);
      const approval = await store.approveDraft();
      await waitForTools(adapter, APPROVED);

      await registry.executeNamedTool(COMMIT_TOOL_NAME, {
        approval_id: approval.approval_id,
      });
      await waitForTools(adapter, BASELINE);
      expect(store.getSnapshot().phase).toBe("committed");

      await registry.reset();
      await waitForTools(adapter, BASELINE);
      expect(store.getSnapshot()).toMatchObject({
        phase: "idle",
        approval: null,
        draft: null,
        committed_dispatch: null,
      });
    }

    await registry.stop();
    expect(await adapter.getTools()).toEqual([]);
    expect(adapter.getRegisterCount()).toBe(105);
    expect(adapter.getAbortCount()).toBe(105);
  });

  it("keeps 100 consecutive resets idempotent after revoking an approval", async () => {
    const adapter = new FakeWebMcpAdapter();
    const store = new DispatchStore();
    const registry = new ToolRegistry(adapter, store);
    await registry.start();
    await executeToolSequence(registry);
    await store.approveDraft();
    await waitForTools(adapter, APPROVED);

    for (let cycle = 0; cycle < 100; cycle += 1) {
      await registry.reset();
      await waitForTools(adapter, BASELINE);
      expect(store.getSnapshot().phase).toBe("idle");
    }

    await registry.stop();
    expect(await adapter.getTools()).toEqual([]);
    expect(adapter.getRegisterCount()).toBe(6);
    expect(adapter.getAbortCount()).toBe(6);
  });

  it("survives 100 repeated mount and cleanup cycles without duplicate registration", async () => {
    const adapter = new FakeWebMcpAdapter();
    const registry = new ToolRegistry(adapter, new DispatchStore());

    for (let cycle = 0; cycle < 100; cycle += 1) {
      await registry.start();
      await waitForTools(adapter, BASELINE);
      await registry.stop();
      expect(await adapter.getTools()).toEqual([]);
    }

    expect(adapter.getRegisterCount()).toBe(500);
    expect(adapter.getAbortCount()).toBe(500);
  });

  it("preserves the registry invariant across a seeded randomized action order", async () => {
    const adapter = new FakeWebMcpAdapter();
    const store = new DispatchStore();
    const registry = new ToolRegistry(adapter, store);
    const random = createSeededRandom(0x5a65_2026);
    await registry.start();

    for (let step = 0; step < 256; step += 1) {
      const phase = store.getSnapshot().phase;
      if (phase === "idle") {
        if (random() < 0.2) {
          await registry.reset();
        } else {
          await executeToolSequence(registry);
        }
      } else if (phase === "draft_ready") {
        if (random() < 0.2) {
          await registry.reset();
        } else {
          await store.approveDraft();
        }
      } else if (phase === "approved") {
        if (random() < 0.2) {
          await registry.reset();
        } else {
          const approvalId = store.getSnapshot().approval?.approval_id;
          expect(approvalId).toBeDefined();
          await waitForTools(adapter, APPROVED);
          await registry.executeNamedTool(COMMIT_TOOL_NAME, {
            approval_id: approvalId,
          });
        }
      } else {
        await registry.reset();
      }

      const nextPhase = store.getSnapshot().phase;
      await waitForTools(
        adapter,
        nextPhase === "approved" ? APPROVED : BASELINE,
      );
    }

    await registry.reset();
    await waitForTools(adapter, BASELINE);
    await registry.stop();
    expect(await adapter.getTools()).toEqual([]);
  });
});
