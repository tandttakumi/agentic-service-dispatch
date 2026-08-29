import { describe, expect, it, vi } from "vitest";

import { APPROVAL_TTL_MS } from "./approval";
import { canonicalJson } from "./canonical-json";
import { DRAFT_INPUT, PROVIDERS, REQUEST_CONDITIONS } from "./fixtures";
import { DispatchStore, transitionPhase } from "./dispatch-machine";
import type { ApprovalRecord, Clock, DispatchState } from "./types";

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

function mutationProbeInternals(store: DispatchStore) {
  return store as unknown as {
    state: DispatchState;
    approvalCanonicalBinding: string | null;
  };
}

describe("dispatch state machine", () => {
  it("follows the required linear path and reuses an identical ready draft", () => {
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
    const draft = store.createDraft(DRAFT_INPUT);
    expect(store.getSnapshot().phase).toBe("draft_ready");
    const readySnapshot = store.getSnapshot();

    expect(store.createDraft(DRAFT_INPUT)).toBe(draft);
    expect(store.getSnapshot()).toBe(readySnapshot);
    expect(
      store
        .getSnapshot()
        .audit_log.filter((entry) => entry.message === "Dispatch draft created"),
    ).toHaveLength(1);
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
      idempotency_key: "dispatch:D-1042:test-2",
      used_at: null,
      generation: 1,
      status: "approved",
    });
    expect(Date.parse(approval.expires_at) - now()).toBe(APPROVAL_TTL_MS);
    expect(approval.draft_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("starts the full approval lifetime after asynchronous hash binding", async () => {
    const { advance, now, store } = harness();
    stageDraft(store);

    const pendingApproval = store.approveDraft();
    advance(APPROVAL_TTL_MS);
    const approval = await pendingApproval;

    expect(Date.parse(approval.approved_at)).toBe(now());
    expect(Date.parse(approval.expires_at) - now()).toBe(APPROVAL_TTL_MS);
  });

  it("fails approval closed when secure UUID generation is unavailable", async () => {
    const clock: Clock = {
      now: () => Date.parse("2026-08-26T03:00:00.000Z"),
    };
    const store = new DispatchStore(clock);
    const actualCrypto = globalThis.crypto;
    stageDraft(store);
    vi.stubGlobal("crypto", { subtle: actualCrypto.subtle });

    try {
      await expect(store.approveDraft()).rejects.toThrow(
        /Secure UUID generation is unavailable/i,
      );
      expect(store.getSnapshot()).toMatchObject({
        phase: "draft_ready",
        approval: null,
        committed_dispatch: null,
      });
    } finally {
      vi.unstubAllGlobals();
    }

    await expect(store.approveDraft()).resolves.toMatchObject({
      status: "approved",
    });
  });

  it("rejects a draft changed after qualification but before approval", async () => {
    const { store } = harness();
    const draft = stageDraft(store);
    draft.provider.certified = false;

    await expect(store.approveDraft()).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    expect(store.getSnapshot()).toMatchObject({
      phase: "draft_ready",
      approval: null,
      committed_dispatch: null,
    });
  });

  it("rejects direct draft mutation while approval hashing is pending", async () => {
    const { store } = harness();
    const draft = stageDraft(store);
    const actualDigest = globalThis.crypto.subtle.digest.bind(
      globalThis.crypto.subtle,
    );
    let releaseDigest = () => {};
    const digest = vi
      .spyOn(globalThis.crypto.subtle, "digest")
      .mockImplementation(
        (algorithm, data) =>
          new Promise<ArrayBuffer>((resolve, reject) => {
            let released = false;
            releaseDigest = () => {
              if (released) return;
              released = true;
              void actualDigest(algorithm, data).then(resolve, reject);
            };
          }),
      );

    try {
      const pendingApproval = store.approveDraft();
      expect(digest).toHaveBeenCalledTimes(1);
      draft.provider.name = "Mutated while approval hash was pending";
      releaseDigest();

      await expect(pendingApproval).rejects.toMatchObject({
        code: "DRAFT_CHANGED_AFTER_APPROVAL",
      });
      expect(store.getSnapshot()).toMatchObject({
        phase: "draft_ready",
        approval: null,
        committed_dispatch: null,
      });
    } finally {
      releaseDigest();
      digest.mockRestore();
    }
  });

  it("rejects a corrupted nonce/idempotency binding at execution", async () => {
    const { store } = harness();
    stageDraft(store);
    const approval = await store.approveDraft();
    approval.idempotency_key = `dispatch:${approval.draft_id}:tampered`;

    await expect(
      store.commitApprovedDispatch(
        approval.approval_id,
        approval.generation,
      ),
    ).rejects.toMatchObject({ code: "CAPABILITY_NOT_AVAILABLE" });
    expect(store.getSnapshot()).toMatchObject({
      phase: "draft_ready",
      approval: { status: "invalidated" },
      committed_dispatch: null,
    });
  });

  it("independently enforces nonce-bound idempotency after canonical integrity passes", async () => {
    const { store } = harness();
    stageDraft(store);
    const approval = await store.approveDraft();
    approval.one_time_nonce = "tampered-nonce";

    const internals = mutationProbeInternals(store);
    internals.approvalCanonicalBinding = canonicalJson(approval);

    await expect(
      store.commitApprovedDispatch(
        approval.approval_id,
        approval.generation,
      ),
    ).rejects.toMatchObject({ code: "CAPABILITY_NOT_AVAILABLE" });
    expect(store.getSnapshot()).toMatchObject({
      phase: "draft_ready",
      approval: { status: "invalidated" },
      committed_dispatch: null,
    });
  });

  it("rejects an approval window extended after human approval", async () => {
    const { store } = harness();
    stageDraft(store);
    const approval = await store.approveDraft();
    approval.expires_at = new Date(
      Date.parse(approval.expires_at) + 1_000,
    ).toISOString();

    expect(store.getRemainingApprovalSeconds()).toBe(0);
    await expect(
      store.commitApprovedDispatch(
        approval.approval_id,
        approval.generation,
      ),
    ).rejects.toMatchObject({ code: "CAPABILITY_NOT_AVAILABLE" });
    expect(store.getSnapshot().committed_dispatch).toBeNull();
  });

  it("invalidates approval if the clock rolls behind the bound approval instant", async () => {
    const { advance, store } = harness();
    stageDraft(store);
    await store.approveDraft();
    advance(-1);

    expect(store.getRemainingApprovalSeconds()).toBe(0);
    expect(store.expireApprovalIfNeeded()).toBe(true);
    expect(store.getSnapshot()).toMatchObject({
      phase: "draft_ready",
      approval: {
        status: "invalidated",
        invalidation_reason:
          "The approval record failed its exact lifetime binding check.",
      },
      error_code: "CAPABILITY_NOT_AVAILABLE",
      committed_dispatch: null,
    });
  });

  it("reconciles accessor-backed approval state without invoking it", async () => {
    const { store } = harness();
    stageDraft(store);
    const approval = await store.approveDraft();
    const statusAccessor = vi.fn(() => {
      throw new Error("Approval accessor must not execute.");
    });
    Object.defineProperty(approval, "status", {
      enumerable: true,
      get: statusAccessor,
    });

    expect(store.getRemainingApprovalSeconds()).toBe(0);
    expect(() => store.createDraft(DRAFT_INPUT)).not.toThrow();
    expect(statusAccessor).not.toHaveBeenCalled();
    expect(store.getSnapshot()).toMatchObject({
      phase: "draft_ready",
      approval: { status: "invalidated" },
      committed_dispatch: null,
    });

    const nextApproval = await store.approveDraft();
    const idAccessor = vi.fn(() => {
      throw new Error("Approval ID accessor must not execute.");
    });
    Object.defineProperty(nextApproval, "approval_id", {
      enumerable: true,
      get: idAccessor,
    });

    expect(store.expireApprovalIfNeeded()).toBe(true);
    expect(idAccessor).not.toHaveBeenCalled();
    expect(store.getSnapshot()).toMatchObject({
      phase: "draft_ready",
      approval: { status: "invalidated" },
      error_code: "CAPABILITY_NOT_AVAILABLE",
      committed_dispatch: null,
    });
  });

  it("rejects expiry reached while the final draft digest is pending", async () => {
    const { advance, store } = harness();
    stageDraft(store);
    const approval = await store.approveDraft();

    const pendingCommit = store.commitApprovedDispatch(
      approval.approval_id,
      approval.generation,
    );
    advance(APPROVAL_TTL_MS);

    await expect(pendingCommit).rejects.toMatchObject({
      code: "APPROVAL_EXPIRED",
    });
    expect(store.getSnapshot()).toMatchObject({
      phase: "draft_ready",
      approval: { status: "expired" },
      committed_dispatch: null,
    });
  });

  it("rejects a clock rollback while the final draft digest is pending", async () => {
    const { advance, store } = harness();
    stageDraft(store);
    const approval = await store.approveDraft();

    const pendingCommit = store.commitApprovedDispatch(
      approval.approval_id,
      approval.generation,
    );
    advance(-1);

    await expect(pendingCommit).rejects.toMatchObject({
      code: "CAPABILITY_NOT_AVAILABLE",
    });
    expect(store.getSnapshot()).toMatchObject({
      phase: "draft_ready",
      approval: {
        status: "invalidated",
        invalidation_reason:
          "The approval record failed its exact lifetime binding check.",
      },
      error_code: "CAPABILITY_NOT_AVAILABLE",
      committed_dispatch: null,
    });
  });

  it("rejects direct nested draft mutation while the final digest is pending", async () => {
    const { store } = harness();
    const draft = stageDraft(store);
    const approval = await store.approveDraft();

    const pendingCommit = store.commitApprovedDispatch(
      approval.approval_id,
      approval.generation,
    );
    draft.provider.name = "Mutated after canonical bytes were captured";

    await expect(pendingCommit).rejects.toMatchObject({
      code: "DRAFT_CHANGED_AFTER_APPROVAL",
    });
    expect(store.getSnapshot()).toMatchObject({
      phase: "draft_ready",
      approval: { status: "invalidated" },
      committed_dispatch: null,
    });
  });

  it("rejects direct approval mutation while the final digest is pending", async () => {
    const { store } = harness();
    stageDraft(store);
    const approval = await store.approveDraft();

    const pendingCommit = store.commitApprovedDispatch(
      approval.approval_id,
      approval.generation,
    );
    approval.one_time_nonce = "mutated-while-commit-hash-was-pending";

    await expect(pendingCommit).rejects.toMatchObject({
      code: "CAPABILITY_NOT_AVAILABLE",
    });
    expect(store.getSnapshot()).toMatchObject({
      phase: "draft_ready",
      approval: { status: "invalidated", used_at: null },
      committed_dispatch: null,
    });
  });

  it("rejects direct draft mutation or removal before commit validation starts", async () => {
    const { store } = harness();
    const draft = stageDraft(store);
    const approval = await store.approveDraft();

    draft.provider.name = "Mutated before commit validation";

    await expect(
      store.commitApprovedDispatch(
        approval.approval_id,
        approval.generation,
      ),
    ).rejects.toMatchObject({
      code: "DRAFT_CHANGED_AFTER_APPROVAL",
    });
    expect(store.getSnapshot()).toMatchObject({
      phase: "draft_ready",
      approval: { status: "invalidated" },
      committed_dispatch: null,
    });

    const { store: missingDraftStore } = harness();
    stageDraft(missingDraftStore);
    const missingDraftApproval = await missingDraftStore.approveDraft();
    missingDraftStore.getSnapshot().draft = null;

    await expect(
      missingDraftStore.commitApprovedDispatch(
        missingDraftApproval.approval_id,
        missingDraftApproval.generation,
      ),
    ).rejects.toMatchObject({
      code: "DRAFT_CHANGED_AFTER_APPROVAL",
    });
    expect(missingDraftStore.getSnapshot()).toMatchObject({
      phase: "draft_ready",
      approval: {
        status: "invalidated",
        invalidation_reason: "The approved draft no longer exists.",
      },
      committed_dispatch: null,
    });
  });

  it("records the exact instant that passed final lifetime validation", async () => {
    const base = Date.parse("2026-08-26T03:00:00.000Z");
    let finalValidation = false;
    let finalReads = 0;
    let expiresAt = Number.NaN;
    const clock: Clock = {
      now: () => {
        if (!finalValidation) return base;
        finalReads += 1;
        return finalReads <= 2 ? expiresAt - 1 : expiresAt;
      },
    };
    const store = new DispatchStore(clock, () => "boundary-id");
    stageDraft(store);
    const approval = await store.approveDraft();

    expiresAt = Date.parse(approval.expires_at);
    finalValidation = true;
    const committed = await store.commitApprovedDispatch(
      approval.approval_id,
      approval.generation,
    );

    expect(committed.committed_at).toBe(
      new Date(Date.parse(approval.expires_at) - 1).toISOString(),
    );
  });

  it("rejects the wrong approval ID", async () => {
    const { store } = harness();
    stageDraft(store);
    const approval = await store.approveDraft();

    await expect(
      store.commitApprovedDispatch("approval-wrong", approval.generation),
    ).rejects.toMatchObject({ code: "APPROVAL_NOT_FOUND" });
    expect(store.getSnapshot().phase).toBe("approved");

    const originalApprovalId = approval.approval_id;
    approval.approval_id = "approval-record-mutated";
    await expect(
      store.commitApprovedDispatch(originalApprovalId, approval.generation),
    ).rejects.toMatchObject({ code: "CAPABILITY_NOT_AVAILABLE" });
    expect(store.getSnapshot()).toMatchObject({
      phase: "draft_ready",
      approval: { status: "invalidated" },
      committed_dispatch: null,
    });
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

  it("keeps consumed idempotency as a rollback backstop", async () => {
    const { store } = harness();
    stageDraft(store);
    const approval = await store.approveDraft();
    await store.commitApprovedDispatch(
      approval.approval_id,
      approval.generation,
    );

    const internals = mutationProbeInternals(store);
    const rolledBackApproval: ApprovalRecord = {
      ...approval,
      status: "approved",
      used_at: null,
    };
    internals.state = {
      ...internals.state,
      phase: "approved",
      approval: rolledBackApproval,
      committed_dispatch: null,
    };
    internals.approvalCanonicalBinding = canonicalJson(rolledBackApproval);

    await expect(
      store.commitApprovedDispatch(
        approval.approval_id,
        approval.generation,
      ),
    ).rejects.toMatchObject({ code: "APPROVAL_ALREADY_USED" });
    expect(store.getSnapshot().committed_dispatch).toBeNull();
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

  it("rotates repeated lifecycle failures and clears only a handed-off token", () => {
    const { store } = harness();
    store.recordCapabilityLifecycleFailure("First registry read failed.");
    const first = store.getActiveCapabilityLifecycleFailureToken();
    store.recordCapabilityLifecycleFailure("First registry read failed.");
    const repeated = store.getActiveCapabilityLifecycleFailureToken();

    expect(repeated).not.toBe(first);
    expect(store.clearCapabilityLifecycleFailure(first)).toBe(false);
    expect(store.clearCapabilityLifecycleFailure(repeated)).toBe(false);

    store.recordCapabilityLifecycleFailure("New registry read failed.");

    expect(store.markCapabilityLifecycleFailureRecoverable(repeated)).toBe(
      false,
    );
    expect(store.getSnapshot()).toMatchObject({
      error_code: "CAPABILITY_NOT_AVAILABLE",
      error_message: "New registry read failed.",
    });

    const current = store.getActiveCapabilityLifecycleFailureToken();
    expect(store.markCapabilityLifecycleFailureRecoverable(current)).toBe(
      true,
    );
    expect(store.clearCapabilityLifecycleFailure(current)).toBe(true);
    expect(store.getSnapshot()).toMatchObject({
      error_code: null,
      error_message: null,
    });
    expect(store.getSnapshot().audit_log.at(-1)?.message).toBe(
      "WebMCP capability lifecycle recovered",
    );
  });
});
