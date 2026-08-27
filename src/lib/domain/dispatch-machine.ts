import {
  createApprovalRecord,
  isApprovalExpired,
  remainingApprovalSeconds,
} from "./approval";
import { sha256Hex } from "./canonical-json";
import {
  DRAFT_INPUT,
  PROVIDERS,
  REQUEST_CONDITIONS,
  SERVICE_HISTORY,
  VEHICLE,
  buildDispatchDraft,
  evaluateProviders,
} from "./fixtures";
import type {
  ApprovalRecord,
  AuditEntry,
  Clock,
  CreateDraftInput,
  DispatchDraft,
  DispatchPhase,
  DispatchState,
  IdFactory,
} from "./types";
import { DispatchDomainError } from "./types";

const PHASE_TRANSITIONS: Record<DispatchPhase, DispatchPhase[]> = {
  idle: ["context_loaded"],
  context_loaded: ["providers_compared"],
  providers_compared: ["draft_ready"],
  draft_ready: ["approved"],
  approved: ["draft_ready", "committed"],
  committed: [],
};

const systemClock: Clock = {
  now: () => Date.now(),
};

const randomId: IdFactory = () => {
  if (!globalThis.crypto?.randomUUID) {
    throw new Error("Secure UUID generation is unavailable.");
  }
  return globalThis.crypto.randomUUID();
};

export function transitionPhase(
  from: DispatchPhase,
  to: DispatchPhase,
): DispatchPhase {
  if (!PHASE_TRANSITIONS[from].includes(to)) {
    throw new DispatchDomainError(
      "INVALID_TRANSITION",
      `Dispatch cannot transition from ${from} to ${to}.`,
    );
  }
  return to;
}

function createInitialState(revision = 0): DispatchState {
  return {
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
    revision,
  };
}

function validateDraftInput(input: CreateDraftInput): void {
  if (
    input.provider_id !== DRAFT_INPUT.provider_id ||
    input.slot_id !== DRAFT_INPUT.slot_id ||
    input.quoted_price_jpy !== DRAFT_INPUT.quoted_price_jpy ||
    input.rationale !== DRAFT_INPUT.rationale
  ) {
    throw new DispatchDomainError(
      "INVALID_INPUT",
      "The draft must use the qualified provider, approved slot, quoted price, and recorded rationale.",
    );
  }
}

export class DispatchStore {
  private state: DispatchState = createInitialState();
  private readonly listeners = new Set<() => void>();
  private readonly usedIdempotencyKeys = new Set<string>();
  private readonly revokedGenerations = new Set<number>();
  private auditSequence = 0;
  private approvalGeneration = 0;
  private approvalInFlight = false;

  constructor(
    private readonly clock: Clock = systemClock,
    private readonly nextId: IdFactory = randomId,
  ) {}

  readonly getSnapshot = (): DispatchState => this.state;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  private audit(
    message: string,
    tone: AuditEntry["tone"] = "neutral",
  ): AuditEntry {
    this.auditSequence += 1;
    return {
      id: `audit-${this.auditSequence}`,
      message,
      at: new Date(this.clock.now()).toISOString(),
      tone,
    };
  }

  private update(
    patch: Partial<DispatchState>,
    auditEntries: AuditEntry[] = [],
  ): void {
    this.state = {
      ...this.state,
      ...patch,
      audit_log: [...this.state.audit_log, ...auditEntries],
      revision: this.state.revision + 1,
    };
    this.emit();
  }

  recordBaselineCapabilitiesVerified(): void {
    const message = "Five baseline capabilities verified";
    if (this.state.audit_log.at(-1)?.message === message) {
      return;
    }
    this.update({}, [this.audit(message, "capability")]);
  }

  loadVehicleContext(): {
    vehicle: typeof VEHICLE;
    request_conditions: typeof REQUEST_CONDITIONS;
  } {
    if (this.state.phase === "idle") {
      this.update(
        { phase: transitionPhase("idle", "context_loaded") },
        [this.audit("Vehicle context retrieved")],
      );
    }

    return {
      vehicle: VEHICLE,
      request_conditions: REQUEST_CONDITIONS,
    };
  }

  reviewServiceHistory(vehicleId: string): {
    vehicle_id: string;
    history: typeof SERVICE_HISTORY;
  } {
    if (vehicleId !== VEHICLE.id) {
      throw new DispatchDomainError(
        "INVALID_INPUT",
        "Service history is available only for vehicle-001.",
      );
    }
    if (this.state.phase === "idle") {
      throw new DispatchDomainError(
        "INVALID_TRANSITION",
        "Load the active vehicle before reading service history.",
      );
    }

    if (!this.state.service_history_reviewed) {
      this.update(
        { service_history_reviewed: true },
        [this.audit("Service history reviewed")],
      );
    }

    return { vehicle_id: vehicleId, history: SERVICE_HISTORY };
  }

  compareProviders(): {
    conditions: typeof REQUEST_CONDITIONS;
    providers: ReturnType<typeof evaluateProviders>;
  } {
    if (
      this.state.phase === "idle" ||
      !this.state.service_history_reviewed
    ) {
      throw new DispatchDomainError(
        "INVALID_TRANSITION",
        "Vehicle context and service history must be reviewed before provider comparison.",
      );
    }

    const evaluations = evaluateProviders();
    if (this.state.phase === "context_loaded") {
      this.update(
        {
          phase: transitionPhase("context_loaded", "providers_compared"),
          providers_evaluated: true,
          provider_evaluations: evaluations,
        },
        [this.audit("Three providers evaluated")],
      );
    } else if (!this.state.providers_evaluated) {
      this.update({
        providers_evaluated: true,
        provider_evaluations: evaluations,
      });
    }

    return { conditions: REQUEST_CONDITIONS, providers: evaluations };
  }

  checkAvailability(providerIds: string[], before: string): {
    before: string;
    providers: Array<{
      provider_id: string;
      slot: (typeof PROVIDERS)[number]["slot"];
      deadline_matches: boolean;
    }>;
  } {
    const expectedIds = PROVIDERS.map((provider) => provider.id);
    if (
      before !== REQUEST_CONDITIONS.completion_before ||
      providerIds.length !== expectedIds.length ||
      providerIds.some((id, index) => id !== expectedIds[index])
    ) {
      throw new DispatchDomainError(
        "INVALID_INPUT",
        "Availability must be checked for the three compared providers and the stated deadline.",
      );
    }
    if (!this.state.providers_evaluated) {
      throw new DispatchDomainError(
        "INVALID_TRANSITION",
        "Compare providers before checking availability.",
      );
    }

    if (!this.state.availability_checked) {
      this.update(
        { availability_checked: true },
        [this.audit("Availability checked against the Friday deadline")],
      );
    }

    return {
      before,
      providers: PROVIDERS.map((provider) => ({
        provider_id: provider.id,
        slot: provider.slot,
        deadline_matches:
          Date.parse(provider.slot.starts_at) < Date.parse(before),
      })),
    };
  }

  createDraft(input: CreateDraftInput): DispatchDraft {
    validateDraftInput(input);
    if (this.state.committed_dispatch) {
      throw new DispatchDomainError(
        "DISPATCH_ALREADY_COMMITTED",
        "Reset the demo before creating another dispatch.",
      );
    }
    if (
      !this.state.providers_evaluated ||
      !this.state.availability_checked ||
      !this.state.service_history_reviewed
    ) {
      throw new DispatchDomainError(
        "INVALID_TRANSITION",
        "History, provider comparison, and availability must be checked before drafting.",
      );
    }

    const draft = buildDispatchDraft(input);
    const approval =
      this.state.phase === "approved" && this.state.approval
        ? {
            ...this.state.approval,
            status: "invalidated" as const,
            invalidation_reason: "A replacement draft was created.",
          }
        : this.state.approval;

    const phase =
      this.state.phase === "providers_compared"
        ? transitionPhase("providers_compared", "draft_ready")
        : this.state.phase === "approved"
          ? transitionPhase("approved", "draft_ready")
          : "draft_ready";

    this.update(
      {
        phase,
        draft,
        approval,
        error_code: null,
        error_message: null,
      },
      [this.audit("Dispatch draft created")],
    );
    return draft;
  }

  async approveDraft(): Promise<ApprovalRecord> {
    if (this.approvalInFlight) {
      throw new DispatchDomainError(
        "CAPABILITY_NOT_AVAILABLE",
        "Approval creation is already in progress.",
      );
    }
    if (this.state.phase !== "draft_ready" || !this.state.draft) {
      throw new DispatchDomainError(
        "INVALID_TRANSITION",
        "Only a ready draft can be approved.",
      );
    }

    this.approvalInFlight = true;
    const draft = this.state.draft;
    const revision = this.state.revision;
    const generation = ++this.approvalGeneration;

    try {
      const approval = await createApprovalRecord({
        draft,
        now: this.clock.now(),
        generation,
        nextId: this.nextId,
      });

      if (
        this.state.phase !== "draft_ready" ||
        this.state.draft !== draft ||
        this.state.revision !== revision
      ) {
        throw new DispatchDomainError(
          "DRAFT_CHANGED_AFTER_APPROVAL",
          "The draft changed while approval was being bound.",
        );
      }

      this.update(
        {
          phase: transitionPhase("draft_ready", "approved"),
          approval,
          error_code: null,
          error_message: null,
        },
        [this.audit(`Human approved draft ${draft.draft_id}`, "approval")],
      );
      return approval;
    } finally {
      this.approvalInFlight = false;
    }
  }

  expireApprovalIfNeeded(): boolean {
    const approval = this.state.approval;
    if (
      this.state.phase !== "approved" ||
      !approval ||
      approval.status !== "approved" ||
      !isApprovalExpired(approval, this.clock.now())
    ) {
      return false;
    }

    this.update(
      {
        phase: transitionPhase("approved", "draft_ready"),
        approval: {
          ...approval,
          status: "expired",
          invalidation_reason: "The 120-second approval window expired.",
        },
        error_code: "APPROVAL_EXPIRED",
        error_message: "Approval expired. Approve the exact draft again.",
      },
      [this.audit("Approval expired after 120 seconds", "danger")],
    );
    return true;
  }

  mutateDraft(patch: Partial<DispatchDraft>): DispatchDraft {
    if (!this.state.draft) {
      throw new DispatchDomainError(
        "INVALID_TRANSITION",
        "There is no draft to change.",
      );
    }
    if (this.state.phase === "committed") {
      throw new DispatchDomainError(
        "DISPATCH_ALREADY_COMMITTED",
        "A committed dispatch cannot be changed.",
      );
    }

    const draft = { ...this.state.draft, ...patch };
    const wasApproved =
      this.state.phase === "approved" &&
      this.state.approval?.status === "approved";
    const approval =
      wasApproved && this.state.approval
        ? {
            ...this.state.approval,
            status: "invalidated" as const,
            invalidation_reason: "The exact draft changed after approval.",
          }
        : this.state.approval;

    this.update(
      {
        phase: wasApproved
          ? transitionPhase("approved", "draft_ready")
          : this.state.phase,
        draft,
        approval,
        error_code: wasApproved ? "DRAFT_CHANGED_AFTER_APPROVAL" : null,
        error_message: wasApproved
          ? "Draft changed after approval. The temporary capability was revoked."
          : null,
      },
      wasApproved
        ? [this.audit("Approval invalidated by a draft change", "danger")]
        : [],
    );
    return draft;
  }

  async commitApprovedDispatch(
    approvalId: string,
    registeredGeneration: number,
  ) {
    let approval = this.state.approval;

    if (!approval) {
      throw new DispatchDomainError(
        "APPROVAL_NOT_FOUND",
        "No approval exists for this dispatch.",
      );
    }
    if (approval.approval_id !== approvalId) {
      throw new DispatchDomainError(
        "APPROVAL_NOT_FOUND",
        "The supplied approval ID does not match the active approval.",
      );
    }
    if (approval.status === "used" || approval.used_at) {
      throw new DispatchDomainError(
        "APPROVAL_ALREADY_USED",
        "This one-time approval has already been used.",
      );
    }
    if (approval.status === "expired") {
      throw new DispatchDomainError(
        "APPROVAL_EXPIRED",
        "This approval has expired.",
      );
    }
    if (approval.status === "invalidated") {
      throw new DispatchDomainError(
        "DRAFT_CHANGED_AFTER_APPROVAL",
        "The draft changed after this approval was created.",
      );
    }
    if (this.expireApprovalIfNeeded()) {
      throw new DispatchDomainError(
        "APPROVAL_EXPIRED",
        "This approval expired before execution.",
      );
    }

    approval = this.state.approval;
    if (
      !approval ||
      this.state.phase !== "approved" ||
      registeredGeneration !== approval.generation
    ) {
      throw new DispatchDomainError(
        "CAPABILITY_NOT_AVAILABLE",
        "The temporary capability does not match the current approval generation.",
      );
    }
    if (!this.state.draft) {
      throw new DispatchDomainError(
        "DRAFT_CHANGED_AFTER_APPROVAL",
        "The approved draft no longer exists.",
      );
    }
    if (this.state.committed_dispatch) {
      throw new DispatchDomainError(
        "DISPATCH_ALREADY_COMMITTED",
        "This dispatch is already committed.",
      );
    }
    if (this.usedIdempotencyKeys.has(approval.idempotency_key)) {
      throw new DispatchDomainError(
        "APPROVAL_ALREADY_USED",
        "The approval idempotency key has already been consumed.",
      );
    }

    const draft = this.state.draft;
    const revision = this.state.revision;
    const currentHash = await sha256Hex(draft);
    const currentApproval = this.state.approval;

    if (
      this.state.revision !== revision ||
      this.state.phase !== "approved" ||
      this.state.draft !== draft ||
      !currentApproval ||
      currentApproval.generation !== registeredGeneration
    ) {
      throw new DispatchDomainError(
        "DRAFT_CHANGED_AFTER_APPROVAL",
        "The dispatch changed during commit validation.",
      );
    }
    if (currentHash !== currentApproval.draft_hash) {
      throw new DispatchDomainError(
        "DRAFT_CHANGED_AFTER_APPROVAL",
        "The current draft hash does not match the approved hash.",
      );
    }
    if (isApprovalExpired(currentApproval, this.clock.now())) {
      this.expireApprovalIfNeeded();
      throw new DispatchDomainError(
        "APPROVAL_EXPIRED",
        "This approval expired during validation.",
      );
    }

    const committedAt = new Date(this.clock.now()).toISOString();
    const committedDispatch = {
      dispatch_id: `dispatch-${draft.draft_id.toLowerCase()}`,
      draft,
      approval_id: currentApproval.approval_id,
      idempotency_key: currentApproval.idempotency_key,
      committed_at: committedAt,
    };

    this.usedIdempotencyKeys.add(currentApproval.idempotency_key);
    this.update(
      {
        phase: transitionPhase("approved", "committed"),
        approval: {
          ...currentApproval,
          status: "used",
          used_at: committedAt,
        },
        committed_dispatch: committedDispatch,
        error_code: null,
        error_message: null,
      },
      [this.audit("Agent committed approved dispatch", "success")],
    );

    return committedDispatch;
  }

  markTemporaryCapabilityRegistered(generation: number): void {
    const approval = this.state.approval;
    if (
      this.state.phase !== "approved" ||
      !approval ||
      approval.generation !== generation ||
      approval.status !== "approved"
    ) {
      return;
    }

    this.update(
      {},
      [this.audit("Temporary commit capability registered", "capability")],
    );
  }

  markTemporaryCapabilityRevoked(
    generation: number,
    reason: "used" | "expired" | "changed" | "reset",
  ): void {
    if (this.revokedGenerations.has(generation)) {
      return;
    }
    this.revokedGenerations.add(generation);
    const label =
      reason === "used"
        ? "Temporary capability revoked after one exact action"
        : reason === "expired"
          ? "Temporary capability revoked after approval expiry"
          : reason === "changed"
            ? "Temporary capability revoked after draft change"
            : "Temporary capability revoked by reset";
    this.update({}, [this.audit(label, "capability")]);
  }

  invalidateApprovalAfterRegistrationFailure(
    generation: number,
    message: string,
  ): void {
    const approval = this.state.approval;
    if (
      this.state.phase !== "approved" ||
      !approval ||
      approval.generation !== generation
    ) {
      return;
    }

    this.update(
      {
        phase: transitionPhase("approved", "draft_ready"),
        approval: {
          ...approval,
          status: "invalidated",
          invalidation_reason: message,
        },
        error_code: "CAPABILITY_NOT_AVAILABLE",
        error_message: message,
      },
      [this.audit("Temporary capability registration failed", "danger")],
    );
  }

  reset(): void {
    this.approvalGeneration += 1;
    this.approvalInFlight = false;
    this.usedIdempotencyKeys.clear();
    this.state = createInitialState(this.state.revision + 1);
    this.emit();
  }

  getRemainingApprovalSeconds(): number {
    return remainingApprovalSeconds(this.state.approval, this.clock.now());
  }
}

