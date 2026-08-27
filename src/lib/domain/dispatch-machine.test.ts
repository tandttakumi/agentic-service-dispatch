import { describe, expect, it } from "vitest";

import { APPROVAL_TTL_MS } from "./approval";
import { DRAFT_INPUT, PROVIDERS, REQUEST_CONDITIONS } from "./fixtures";
import { DispatchStore, transitionPhase } from "./dispatch-machine";
import type { Clock } from "./types";

function harness() {
  let now = Date.parse("2026-08-26T03:00:00.000Z");
  let id = 0;
  const clock: Clock = { now: () => now };
  const store = new DispatchStore(clock, () => `test-${++id}`);
  return {
    store,
    advance: (milliseconds: number) => {
      now += milliseconds;
    },
    now: () => now,
  };
}

function stageDraft(store: DispatchStore) {
  store.loadVehicleContext();
  store.reviewServiceHistory("vehicle-001");
  store.compareProviders();
  store.checkAvailability(
    PROVIDERS.map((provider) => provider.id),
    REQUEST_CONDITIONS.completion_before,
  );
  return store.createDraft(DRAFT_INPUT);
}

describe("dispatch state machine", () => {
  it("follows the required linear path to a ready draft", () => {
    const { store } = harness();

    expect(store.getSnapshot().phase).toBe("idle");
    store.loadVehicleContext();
    expect(store.getSnapshot().phase).toBe("context_loaded");
    store.reviewServiceHistory("vehicle-001");
    store.compareProviders();
    expect(store.getSnapshot().phase).toBe("providers_compared");
    store.checkAvailability(
      PROVIDERS.map((provider) => provider.id),
      REQUEST_CONDITIONS.completion_before,
    );
    store.createDraft(DRAFT_INPUT);
    expect(store.getSnapshot().phase).toBe("draft_ready");
  });

  it("rejects an invalid transition", () => {
    const { store } = harness();

    expect(() => store.reviewServiceHistory("vehicle-001")).toThrowError(
      expect.objectContaining({ code: "INVALID_TRANSITION" }),
    );
    expect(() => transitionPhase("idle", "approved")).toThrowError(
      expect.objectContaining({ code: "INVALID_TRANSITION" }),
    );
  });

  it("binds all approval fields to the exact draft for 120 seconds", async () => {
    const { store, now } = harness();
    const draft = stageDraft(store);
    const approval = await store.approveDraft();

    expect(store.getSnapshot().phase).toBe("approved");
    expect(approval).toMatchObject({
      approval_id: "approval-test-1",
      draft_id: draft.draft_id,
      one_time_nonce: "test-2",
      idempotency_key: "dispatch:D-1042:test-3",
      used_at: null,
      generation: 1,
      status: "approved",
    });
    expect(Date.parse(approval.expires_at) - now()).toBe(APPROVAL_TTL_MS);
    expect(approval.draft_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects the wrong approval ID", async () => {
    const { store } = harness();
    stageDraft(store);
    const approval = await store.approveDraft();

    await expect(
      store.commitApprovedDispatch("approval-wrong", approval.generation),
    ).rejects.toMatchObject({ code: "APPROVAL_NOT_FOUND" });
  });

  it("expires approval and returns to draft_ready", async () => {
    const { store, advance } = harness();
    stageDraft(store);
    const approval = await store.approveDraft();
    advance(APPROVAL_TTL_MS + 1);

    await expect(
      store.commitApprovedDispatch(
        approval.approval_id,
        approval.generation,
      ),
    ).rejects.toMatchObject({ code: "APPROVAL_EXPIRED" });
    expect(store.getSnapshot()).toMatchObject({
      phase: "draft_ready",
      error_code: "APPROVAL_EXPIRED",
      approval: { status: "expired" },
    });
  });

  it("invalidates approval immediately when the exact draft changes", async () => {
    const { store } = harness();
    stageDraft(store);
    const approval = await store.approveDraft();

    store.mutateDraft({ quoted_price_jpy: 57_000 });

    expect(store.getSnapshot()).toMatchObject({
      phase: "draft_ready",
      error_code: "DRAFT_CHANGED_AFTER_APPROVAL",
      approval: { status: "invalidated" },
    });
    await expect(
      store.commitApprovedDispatch(
        approval.approval_id,
        approval.generation,
      ),
    ).rejects.toMatchObject({ code: "DRAFT_CHANGED_AFTER_APPROVAL" });
  });

  it("commits exactly once and consumes the idempotency key", async () => {
    const { store } = harness();
    stageDraft(store);
    const approval = await store.approveDraft();
    const committed = await store.commitApprovedDispatch(
      approval.approval_id,
      approval.generation,
    );

    expect(store.getSnapshot()).toMatchObject({
      phase: "committed",
      approval: { status: "used" },
      committed_dispatch: {
        dispatch_id: "dispatch-d-1042",
        idempotency_key: approval.idempotency_key,
      },
    });
    expect(committed.draft.quoted_price_jpy).toBe(58_000);
    await expect(
      store.commitApprovedDispatch(
        approval.approval_id,
        approval.generation,
      ),
    ).rejects.toMatchObject({ code: "APPROVAL_ALREADY_USED" });
  });

  it("rejects a stale tool registration generation", async () => {
    const { store } = harness();
    stageDraft(store);
    const approval = await store.approveDraft();

    await expect(
      store.commitApprovedDispatch(
        approval.approval_id,
        approval.generation + 1,
      ),
    ).rejects.toMatchObject({ code: "CAPABILITY_NOT_AVAILABLE" });
  });

  it("reset clears timers' domain state, approval, commit, and audit", async () => {
    const { store } = harness();
    stageDraft(store);
    await store.approveDraft();
    store.recordBaselineCapabilitiesVerified();

    store.reset();

    expect(store.getSnapshot()).toMatchObject({
      phase: "idle",
      approval: null,
      draft: null,
      committed_dispatch: null,
      audit_log: [],
      error_code: null,
    });
  });
});

