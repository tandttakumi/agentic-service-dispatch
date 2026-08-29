import { describe, expect, it, vi } from "vitest";

import { APPROVAL_TTL_MS, remainingApprovalSeconds } from "./approval";
import { hasAuditMessage } from "./audit-log";
import { DispatchStore, transitionPhase } from "./dispatch-machine";
import { DRAFT_INPUT, PROVIDERS, REQUEST_CONDITIONS } from "./fixtures";
import type { Clock, CreateDraftInput, DispatchPhase } from "./types";

function setup() {
  let now = Date.parse("2026-08-26T03:00:00.000Z");
  let id = 0;
  const clock: Clock = { now: () => now };
  const store = new DispatchStore(clock, () => `edge-${++id}`);
  return {
    store,
    advance: (amount: number) => {
      now += amount;
    },
    now: () => now,
  };
}

function prepareComparison(store: DispatchStore) {
  store.loadVehicleContext();
  store.reviewServiceHistory("vehicle-001");
  store.compareProviders();
}

function prepareDraft(store: DispatchStore) {
  prepareComparison(store);
  store.checkAvailability(
    PROVIDERS.map((provider) => provider.id),
    REQUEST_CONDITIONS.completion_before,
  );
  store.createDraft(DRAFT_INPUT);
}

describe("dispatch defensive branches", () => {
  it("matches the complete six-phase transition matrix", () => {
    const phases: DispatchPhase[] = [
      "idle",
      "context_loaded",
      "providers_compared",
      "draft_ready",
      "approved",
      "committed",
    ];
    const allowed = new Set([
      "idle:context_loaded",
      "context_loaded:providers_compared",
      "providers_compared:draft_ready",
      "draft_ready:approved",
      "approved:draft_ready",
      "approved:committed",
    ]);

    for (const from of phases) {
      for (const to of phases) {
        if (allowed.has(`${from}:${to}`)) {
          expect(transitionPhase(from, to)).toBe(to);
        } else {
          expect(() => transitionPhase(from, to)).toThrowError(
            expect.objectContaining({ code: "INVALID_TRANSITION" }),
          );
        }
      }
    }
  });

  it("returns every reachable phase to the same idle Reset postcondition", async () => {
    const phases: DispatchPhase[] = [
      "idle",
      "context_loaded",
      "providers_compared",
      "draft_ready",
      "approved",
      "committed",
    ];

    for (const phase of phases) {
      const { store } = setup();
      if (phase !== "idle") {
        store.loadVehicleContext();
      }
      if (
        phase === "providers_compared" ||
        phase === "draft_ready" ||
        phase === "approved" ||
        phase === "committed"
      ) {
        store.reviewServiceHistory("vehicle-001");
        store.compareProviders();
      }
      if (
        phase === "draft_ready" ||
        phase === "approved" ||
        phase === "committed"
      ) {
        store.checkAvailability(
          PROVIDERS.map((provider) => provider.id),
          REQUEST_CONDITIONS.completion_before,
        );
        store.createDraft(DRAFT_INPUT);
      }
      if (phase === "approved" || phase === "committed") {
        const approval = await store.approveDraft();
        if (phase === "committed") {
          await store.commitApprovedDispatch(
            approval.approval_id,
            approval.generation,
          );
        }
      }
      expect(store.getSnapshot().phase).toBe(phase);

      store.reset();

      expect(store.getSnapshot()).toMatchObject({
        phase: "idle",
        service_history_reviewed: false,
        providers_evaluated: false,
        availability_checked: false,
        provider_evaluations: [],
        draft: null,
        approval: null,
        committed_dispatch: null,
        audit_log: [],
        error_code: null,
        error_message: null,
      });
    }
  });

  it("keeps repeated read operations idempotent", () => {
    const { store } = setup();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    store.recordBaselineCapabilitiesVerified();
    store.recordBaselineCapabilitiesVerified();
    store.loadVehicleContext();
    store.loadVehicleContext();
    store.reviewServiceHistory("vehicle-001");
    store.reviewServiceHistory("vehicle-001");
    store.compareProviders();
    store.compareProviders();
    store.checkAvailability(
      PROVIDERS.map((provider) => provider.id),
      REQUEST_CONDITIONS.completion_before,
    );
    store.checkAvailability(
      PROVIDERS.map((provider) => provider.id),
      REQUEST_CONDITIONS.completion_before,
    );
    unsubscribe();

    expect(
      store.getSnapshot().audit_log.filter(
        (entry) => entry.message === "Five baseline capabilities verified",
      ),
    ).toHaveLength(1);
    expect(hasAuditMessage(store.getSnapshot().audit_log, "Three providers evaluated")).toBe(
      true,
    );
    expect(listener).toHaveBeenCalled();
  });

  it("rejects incorrect history, comparison, and availability inputs", () => {
    const { store } = setup();

    expect(() => store.reviewServiceHistory("vehicle-wrong")).toThrowError(
      expect.objectContaining({ code: "INVALID_INPUT" }),
    );
    store.loadVehicleContext();
    expect(() => store.compareProviders()).toThrowError(
      expect.objectContaining({ code: "INVALID_TRANSITION" }),
    );
    store.reviewServiceHistory("vehicle-001");
    expect(() =>
      store.checkAvailability(
        PROVIDERS.map((provider) => provider.id),
        REQUEST_CONDITIONS.completion_before,
      ),
    ).toThrowError(expect.objectContaining({ code: "INVALID_TRANSITION" }));
    store.compareProviders();
    expect(() =>
      store.checkAvailability(
        ["provider-001"],
        REQUEST_CONDITIONS.completion_before,
      ),
    ).toThrowError(expect.objectContaining({ code: "INVALID_INPUT" }));
    expect(() =>
      store.checkAvailability(
        ["provider-002", "provider-001", "provider-003"],
        REQUEST_CONDITIONS.completion_before,
      ),
    ).toThrowError(expect.objectContaining({ code: "INVALID_INPUT" }));
    expect(() =>
      store.checkAvailability(
        PROVIDERS.map((provider) => provider.id),
        "2026-08-30T00:00:00+09:00",
      ),
    ).toThrowError(expect.objectContaining({ code: "INVALID_INPUT" }));
  });

  it.each([
    { field: "provider_id", patch: { provider_id: "provider-wrong" } },
    { field: "slot_id", patch: { slot_id: "slot-wrong" } },
    { field: "quoted_price_jpy", patch: { quoted_price_jpy: 57_000 } },
    { field: "rationale", patch: { rationale: "A different rationale." } },
  ])("rejects an inexact draft field: $field", ({ patch }) => {
    const { store } = setup();
    prepareComparison(store);
    store.checkAvailability(
      PROVIDERS.map((provider) => provider.id),
      REQUEST_CONDITIONS.completion_before,
    );

    expect(() =>
      store.createDraft({ ...DRAFT_INPUT, ...patch } as CreateDraftInput),
    ).toThrowError(expect.objectContaining({ code: "INVALID_INPUT" }));
  });

  it("rejects draft creation before all checks", () => {
    const { store } = setup();
    store.loadVehicleContext();
    store.reviewServiceHistory("vehicle-001");

    expect(() => store.createDraft(DRAFT_INPUT)).toThrowError(
      expect.objectContaining({ code: "INVALID_TRANSITION" }),
    );
  });

  it("replacing an approved draft invalidates its approval", async () => {
    const { store } = setup();
    prepareDraft(store);
    await store.approveDraft();

    store.createDraft(DRAFT_INPUT);

    expect(store.getSnapshot()).toMatchObject({
      phase: "draft_ready",
      approval: {
        status: "invalidated",
        invalidation_reason: "A replacement draft was created.",
      },
    });
  });

  it("rejects approval without a ready draft and double-click approval races", async () => {
    const { store } = setup();
    await expect(store.approveDraft()).rejects.toMatchObject({
      code: "INVALID_TRANSITION",
    });
    prepareDraft(store);

    const first = store.approveDraft();
    await expect(store.approveDraft()).rejects.toMatchObject({
      code: "CAPABILITY_NOT_AVAILABLE",
    });
    await expect(first).resolves.toMatchObject({ status: "approved" });
  });

  it("keeps a new approval locked when an older reset approval settles", async () => {
    const { store } = setup();
    const actualDigest = globalThis.crypto.subtle.digest.bind(
      globalThis.crypto.subtle,
    );
    const releases: Array<() => void> = [];
    const digest = vi
      .spyOn(globalThis.crypto.subtle, "digest")
      .mockImplementation(
        (algorithm, data) =>
          new Promise<ArrayBuffer>((resolve, reject) => {
            releases.push(() => {
              void actualDigest(algorithm, data).then(resolve, reject);
            });
          }),
      );

    try {
      prepareDraft(store);
      const oldApproval = store.approveDraft();
      expect(releases).toHaveLength(1);

      store.reset();
      prepareDraft(store);
      const currentApproval = store.approveDraft();
      expect(releases).toHaveLength(2);

      releases[0]();
      await expect(oldApproval).rejects.toMatchObject({
        code: "DRAFT_CHANGED_AFTER_APPROVAL",
      });

      const overlappingApproval = store.approveDraft();
      void overlappingApproval.catch(() => undefined);
      expect(releases).toHaveLength(2);
      await expect(overlappingApproval).rejects.toMatchObject({
        code: "CAPABILITY_NOT_AVAILABLE",
      });

      releases[1]();
      await expect(currentApproval).resolves.toMatchObject({
        status: "approved",
      });
    } finally {
      for (const release of releases) release();
      digest.mockRestore();
    }
  });

  it("returns zero countdown outside approval and a live countdown inside it", async () => {
    const { store, now, advance } = setup();
    expect(store.getRemainingApprovalSeconds()).toBe(0);
    expect(remainingApprovalSeconds(null, now())).toBe(0);
    prepareDraft(store);
    const approval = await store.approveDraft();
    expect(remainingApprovalSeconds(approval, now())).toBe(120);
    advance(60_001);
    expect(store.getRemainingApprovalSeconds()).toBe(60);
  });

  it("fails the countdown closed for malformed, extended, or future windows", async () => {
    const { store, now } = setup();
    prepareDraft(store);
    const approval = await store.approveDraft();

    expect(
      remainingApprovalSeconds(
        { ...approval, expires_at: "not-a-date" },
        now(),
      ),
    ).toBe(0);
    expect(
      remainingApprovalSeconds(
        {
          ...approval,
          expires_at: new Date(
            Date.parse(approval.expires_at) + 1_000,
          ).toISOString(),
        },
        now(),
      ),
    ).toBe(0);
    expect(
      remainingApprovalSeconds(
        {
          ...approval,
          approved_at: new Date(now() + 1_000).toISOString(),
          expires_at: new Date(now() + APPROVAL_TTL_MS + 1_000).toISOString(),
        },
        now(),
      ),
    ).toBe(0);
  });

  it("rejects mutation without a draft and after commit", async () => {
    const { store } = setup();
    expect(() => store.mutateDraft({ rationale: "none" })).toThrowError(
      expect.objectContaining({ code: "INVALID_TRANSITION" }),
    );
    prepareDraft(store);
    store.mutateDraft({ rationale: "Pre-approval operator note." });
    const recreated = store.createDraft(DRAFT_INPUT);
    expect(recreated.rationale).toBe(DRAFT_INPUT.rationale);
    Object.defineProperty(recreated, "rationale", {
      configurable: true,
      enumerable: true,
      get: () => {
        throw new Error("Hostile draft accessor must be replaced.");
      },
    });
    const repaired = store.createDraft(DRAFT_INPUT);
    expect(Object.is(repaired, recreated)).toBe(false);
    expect(repaired.rationale).toBe(DRAFT_INPUT.rationale);
    const approval = await store.approveDraft();
    await store.commitApprovedDispatch(
      approval.approval_id,
      approval.generation,
    );
    expect(() => store.mutateDraft({ quoted_price_jpy: 1 })).toThrowError(
      expect.objectContaining({ code: "DISPATCH_ALREADY_COMMITTED" }),
    );
    expect(() => store.createDraft(DRAFT_INPUT)).toThrowError(
      expect.objectContaining({ code: "DISPATCH_ALREADY_COMMITTED" }),
    );
  });

  it("covers inactive expiry and registration-generation guards", async () => {
    const { store, advance } = setup();
    expect(store.expireApprovalIfNeeded()).toBe(false);
    store.markTemporaryCapabilityRegistered(1);
    store.invalidateApprovalAfterRegistrationFailure(1, "not active");
    prepareDraft(store);
    const approval = await store.approveDraft();
    expect(store.expireApprovalIfNeeded()).toBe(false);
    store.markTemporaryCapabilityRegistered(approval.generation + 1);
    store.invalidateApprovalAfterRegistrationFailure(
      approval.generation + 1,
      "stale",
    );
    expect(store.getSnapshot().phase).toBe("approved");

    store.invalidateApprovalAfterRegistrationFailure(
      approval.generation,
      "Native registration rejected.",
    );
    expect(store.getSnapshot()).toMatchObject({
      phase: "draft_ready",
      error_code: "CAPABILITY_NOT_AVAILABLE",
    });
    advance(APPROVAL_TTL_MS);
    expect(store.expireApprovalIfNeeded()).toBe(false);
  });

  it("records each revocation reason once per generation", () => {
    const { store } = setup();

    store.markTemporaryCapabilityRevoked(1, "used");
    store.markTemporaryCapabilityRevoked(1, "used");
    store.markTemporaryCapabilityRevoked(2, "expired");
    store.markTemporaryCapabilityRevoked(3, "changed");
    store.markTemporaryCapabilityRevoked(4, "reset");

    expect(store.getSnapshot().audit_log.map((entry) => entry.message)).toEqual([
      "Temporary capability revoked after one exact action",
      "Temporary capability revoked after approval expiry",
      "Temporary capability revoked after draft change",
      "Temporary capability revoked by reset",
    ]);
  });

  it("deduplicates revocations with constant-size generation state", () => {
    const { store } = setup();

    for (let generation = 1; generation <= 1_000; generation += 1) {
      store.markTemporaryCapabilityRevoked(generation, "reset");
      store.reset();
    }

    const internals = store as unknown as {
      latestRevokedGeneration: number;
      revokedGenerations?: Set<number>;
    };
    expect(internals.latestRevokedGeneration).toBe(1_000);
    expect(internals.revokedGenerations).toBeUndefined();

    store.markTemporaryCapabilityRevoked(999, "changed");
    store.markTemporaryCapabilityRevoked(1_000, "used");
    expect(store.getSnapshot().audit_log).toEqual([]);

    store.markTemporaryCapabilityRevoked(1_001, "used");
    expect(store.getSnapshot().audit_log.map((entry) => entry.message)).toEqual([
      "Temporary capability revoked after one exact action",
    ]);
  });
});
