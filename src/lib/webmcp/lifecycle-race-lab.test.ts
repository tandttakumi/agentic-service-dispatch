import { describe, expect, it, vi } from "vitest";

import { APPROVAL_TTL_MS } from "@/lib/domain/approval";
import { DispatchStore } from "@/lib/domain/dispatch-machine";
import { DRAFT_INPUT } from "@/lib/domain/fixtures";
import type { Clock } from "@/lib/domain/types";

import { FakeWebMcpAdapter } from "./fake-adapter";
import type { RegisteredTool } from "./types";
import {
  BASE_TOOL_NAMES,
  COMMIT_TOOL_NAME,
  ToolRegistry,
  executeToolSequence,
} from "./tool-registry";

const baseline = [...BASE_TOOL_NAMES].sort();
const approved = [...BASE_TOOL_NAMES, COMMIT_TOOL_NAME].sort();

function setup(clock?: Clock) {
  let id = 0;
  const store = new DispatchStore(clock, () => `race-${++id}`);
  const adapter = new FakeWebMcpAdapter();
  const registry = new ToolRegistry(adapter, store);
  return { adapter, registry, store };
}

async function waitForTools(
  adapter: FakeWebMcpAdapter,
  expected: string[],
) {
  await vi.waitFor(async () => {
    expect((await adapter.getTools()).map((tool) => tool.name)).toEqual(expected);
  });
}

async function stageApproved(
  registry: ToolRegistry,
  store: DispatchStore,
  adapter: FakeWebMcpAdapter,
) {
  await executeToolSequence(registry);
  const approval = await store.approveDraft();
  await waitForTools(adapter, approved);
  await vi.waitFor(() => {
    expect(
      store.getSnapshot().audit_log.some(
        (entry) => entry.message === "Temporary commit capability registered",
      ),
    ).toBe(true);
  });
  return approval;
}

class PausedReadAdapter extends FakeWebMcpAdapter {
  private pauseNext = false;
  private releaseRead: (() => void) | null = null;
  private announceRead: (() => void) | null = null;
  private readStarted = Promise.resolve();

  armNextRead() {
    this.pauseNext = true;
    this.readStarted = new Promise<void>((resolve) => {
      this.announceRead = resolve;
    });
  }

  waitForReadStart() {
    return this.readStarted;
  }

  release() {
    this.releaseRead?.();
  }

  liveTools(): Promise<RegisteredTool[]> {
    return super.getTools();
  }

  override async getTools() {
    const snapshot = await super.getTools();
    if (this.pauseNext) {
      this.pauseNext = false;
      this.announceRead?.();
      await new Promise<void>((resolve) => {
        this.releaseRead = resolve;
      });
    }
    return snapshot;
  }
}

function seededRandom(seed: number) {
  let value = seed >>> 0;
  return () => {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    return (value >>> 0) / 0x1_0000_0000;
  };
}

const seeds = [
  0x0000_0001,
  0x0000_0011,
  0x0000_0101,
  0x0000_1001,
  0x0001_0001,
  0x0010_0001,
  0x0100_0001,
  0x1000_0001,
  0x1357_9bdf,
  0x2468_ace0,
  0x3141_5926,
  0x5a65_2026,
  0x6c8e_9cf5,
  0x7f4a_7c15,
  0x8bad_f00d,
  0x9e37_79b9,
  0xaaaa_5555,
  0xc001_d00d,
  0xdead_beef,
  0xffff_fffb,
];

const adversarialSeeds = [
  0x0f0f_0f0f,
  0x1020_3040,
  0x1234_abcd,
  0x1bad_b002,
  0x2233_4455,
  0x2f6e_2b1d,
  0x3366_99cc,
  0x4242_4242,
  0x4d3c_2b1a,
  0x55aa_33cc,
  0x600d_f00d,
  0x71c3_9a5e,
  0x8128_0192,
  0x89ab_cdef,
  0x9630_741e,
  0xa11c_e551,
  0xb16b_00b5,
  0xcaf4_babe,
  0xd15c_a7c0,
  0xe5ca_1ade,
];

describe("concurrency and race laboratory", () => {
  it("allows one winner across a same-tick triple approval", async () => {
    const { adapter, registry, store } = setup();
    await registry.start();
    await executeToolSequence(registry);

    const outcomes = await Promise.allSettled([
      store.approveDraft(),
      store.approveDraft(),
      store.approveDraft(),
    ]);

    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(2);
    expect(store.getSnapshot().phase).toBe("approved");
    await waitForTools(adapter, approved);
    await registry.reset();
    await registry.stop();
  });

  it("allows one winner across a same-tick triple commit", async () => {
    const { adapter, registry, store } = setup();
    await registry.start();
    const approval = await stageApproved(registry, store, adapter);
    const input = { approval_id: approval.approval_id };

    const outcomes = await Promise.allSettled([
      registry.executeNamedTool(COMMIT_TOOL_NAME, input),
      registry.executeNamedTool(COMMIT_TOOL_NAME, input),
      registry.executeNamedTool(COMMIT_TOOL_NAME, input),
    ]);

    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(2);
    await waitForTools(adapter, baseline);
    expect(store.getSnapshot().phase).toBe("committed");
    await registry.reset();
    await registry.stop();
  });

  it("lets expiry win safely against a same-tick commit", async () => {
    let now = Date.parse("2026-08-26T03:00:00.000Z");
    const clock: Clock = { now: () => now };
    const { adapter, registry, store } = setup(clock);
    await registry.start();
    const approval = await stageApproved(registry, store, adapter);
    now += APPROVAL_TTL_MS;

    const outcomes = await Promise.allSettled([
      registry.executeNamedTool(COMMIT_TOOL_NAME, {
        approval_id: approval.approval_id,
      }),
      Promise.resolve(store.expireApprovalIfNeeded()),
    ]);

    expect(outcomes[0]).toMatchObject({ status: "rejected" });
    expect(store.getSnapshot()).toMatchObject({
      phase: "draft_ready",
      approval: { status: "expired" },
      committed_dispatch: null,
    });
    await waitForTools(adapter, baseline);
    await registry.stop();
  });

  it("lets an exact-draft mutation invalidate a same-tick commit", async () => {
    const store = new DispatchStore();
    const adapter = new PausedReadAdapter();
    const registry = new ToolRegistry(adapter, store);
    await registry.start();
    const approval = await stageApproved(registry, store, adapter);

    adapter.armNextRead();
    const commit = registry.executeNamedTool(COMMIT_TOOL_NAME, {
      approval_id: approval.approval_id,
    });
    await adapter.waitForReadStart();
    store.mutateDraft({ quoted_price_jpy: 57_000 });
    expect((await adapter.liveTools()).map((tool) => tool.name)).toEqual(approved);
    adapter.release();

    await expect(commit).rejects.toMatchObject({ name: "InvalidStateError" });
    expect(store.getSnapshot().committed_dispatch).toBeNull();
    await waitForTools(adapter, baseline);
    await registry.reset();
    await registry.stop();
  });

  it("keeps the capability absent while getTools is paused during revoke", async () => {
    const store = new DispatchStore();
    const adapter = new PausedReadAdapter();
    const registry = new ToolRegistry(adapter, store);
    await registry.start();
    const approval = await stageApproved(registry, store, adapter);

    await registry.executeNamedTool(COMMIT_TOOL_NAME, {
      approval_id: approval.approval_id,
    });
    adapter.armNextRead();
    await adapter.waitForReadStart();

    expect((await adapter.liveTools()).map((tool) => tool.name)).toEqual(baseline);
    adapter.release();
    await waitForTools(adapter, baseline);
    await registry.reset();
    await registry.stop();
  });

  it("emits one actual toolchange when Reset revokes an approval", async () => {
    const { adapter, registry, store } = setup();
    await registry.start();
    await stageApproved(registry, store, adapter);
    const listener = vi.fn();
    adapter.addEventListener("toolchange", listener);

    await registry.reset();

    expect(listener).toHaveBeenCalledTimes(1);
    await waitForTools(adapter, baseline);
    adapter.removeEventListener("toolchange", listener);
    await registry.stop();
  });

  it("prevents a temporary registration when unmount wins during approval hashing", async () => {
    const { adapter, registry, store } = setup();
    await registry.start();
    await executeToolSequence(registry);

    const approval = store.approveDraft();
    const cleanup = registry.stop();
    const outcomes = await Promise.allSettled([approval, cleanup]);

    expect(outcomes[0]).toMatchObject({ status: "fulfilled" });
    expect(await adapter.getTools()).toEqual([]);
    expect(adapter.getRegisterCount()).toBe(5);
  });

  it("sustains 100 rapid approval and Reset cycles", async () => {
    const { adapter, registry, store } = setup();
    await registry.start();

    for (let cycle = 0; cycle < 100; cycle += 1) {
      await executeToolSequence(registry);
      await store.approveDraft();
      await waitForTools(adapter, approved);
      await registry.reset();
      await waitForTools(adapter, baseline);
    }

    expect(store.getSnapshot().phase).toBe("idle");
    await registry.stop();
    expect(await adapter.getTools()).toEqual([]);
  });

  it.each(seeds)("preserves 5/6 lifecycle invariants for seed %i", async (seed) => {
    const { adapter, registry, store } = setup();
    const random = seededRandom(seed);
    await registry.start();

    for (let step = 0; step < 128; step += 1) {
      const phase = store.getSnapshot().phase;
      const choice = random();

      if (phase === "idle") {
        if (choice < 0.25) {
          await registry.reset();
        } else {
          await executeToolSequence(registry);
        }
      } else if (phase === "draft_ready") {
        if (choice < 0.2) {
          await registry.reset();
        } else if (choice < 0.4) {
          store.createDraft(DRAFT_INPUT);
        } else {
          await store.approveDraft();
        }
      } else if (phase === "approved") {
        const approval = store.getSnapshot().approval!;
        if (choice < 0.15) {
          await expect(
            registry.executeNamedTool(COMMIT_TOOL_NAME, {
              approval_id: "approval-forged",
            }),
          ).rejects.toMatchObject({ code: "APPROVAL_NOT_FOUND" });
        } else if (choice < 0.3) {
          store.mutateDraft({ rationale: "Seeded mutation" });
          store.createDraft(DRAFT_INPUT);
        } else if (choice < 0.45) {
          await registry.reset();
        } else {
          await registry.executeNamedTool(COMMIT_TOOL_NAME, {
            approval_id: approval.approval_id,
          });
        }
      } else {
        if (choice < 0.25) {
          const approval = store.getSnapshot().approval!;
          await expect(
            store.commitApprovedDispatch(
              approval.approval_id,
              approval.generation,
            ),
          ).rejects.toMatchObject({ code: "APPROVAL_ALREADY_USED" });
        }
        await registry.reset();
      }

      await waitForTools(
        adapter,
        store.getSnapshot().phase === "approved" ? approved : baseline,
      );
    }

    await registry.reset();
    await waitForTools(adapter, baseline);
    await registry.stop();
    expect(await adapter.getTools()).toEqual([]);
  });

  it.each(adversarialSeeds)(
    "preserves expiry, stale-tool, and replay invariants for seed %i",
    async (seed) => {
      let now = Date.parse("2026-08-26T03:00:00.000Z");
      const clock: Clock = { now: () => now };
      const { adapter, registry, store } = setup(clock);
      const random = seededRandom(seed);
      await registry.start();

      for (let step = 0; step < 192; step += 1) {
        const phase = store.getSnapshot().phase;
        const choice = random();
        now += Math.floor(random() * 5_000);

        if (phase === "idle") {
          if (choice < 0.2) {
            await registry.reset();
          } else {
            await executeToolSequence(registry);
          }
        } else if (phase === "draft_ready") {
          if (choice < 0.15) {
            await registry.reset();
          } else if (choice < 0.3) {
            store.createDraft(DRAFT_INPUT);
          } else {
            await store.approveDraft();
          }
        } else if (phase === "approved") {
          const approval = store.getSnapshot().approval!;
          if (choice < 0.15) {
            now = Date.parse(approval.expires_at);
            expect(store.expireApprovalIfNeeded()).toBe(true);
          } else if (choice < 0.3) {
            const temporaryTool = (await adapter.getTools()).find(
              (tool) => tool.name === COMMIT_TOOL_NAME,
            );
            expect(temporaryTool).toBeDefined();
            await registry.reset();
            await expect(
              adapter.executeTool(temporaryTool!, {
                approval_id: approval.approval_id,
              }),
            ).rejects.toMatchObject({ name: "InvalidStateError" });
          } else if (choice < 0.45) {
            store.mutateDraft({ rationale: "Adversarial seeded mutation" });
            store.createDraft(DRAFT_INPUT);
          } else if (choice < 0.6) {
            await registry.reset();
          } else {
            await registry.executeNamedTool(COMMIT_TOOL_NAME, {
              approval_id: approval.approval_id,
            });
          }
        } else {
          const usedApproval = store.getSnapshot().approval!;
          if (choice < 0.5) {
            await expect(
              store.commitApprovedDispatch(
                usedApproval.approval_id,
                usedApproval.generation,
              ),
            ).rejects.toMatchObject({ code: "APPROVAL_ALREADY_USED" });
          }
          await registry.reset();
        }

        await waitForTools(
          adapter,
          store.getSnapshot().phase === "approved" ? approved : baseline,
        );
      }

      await registry.reset();
      await waitForTools(adapter, baseline);
      await registry.stop();
      expect(await adapter.getTools()).toEqual([]);
      expect(adapter.getRegisterCount()).toBe(adapter.getAbortCount());
    },
  );
});
