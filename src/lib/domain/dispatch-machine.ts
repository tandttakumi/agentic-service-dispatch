import {
  createApprovalRecord,
  hasValidApprovalWindow,
  isApprovalExpired,
  remainingApprovalSeconds,
} from "./approval";
import { canonicalJson, sha256Hex } from "./canonical-json";
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
  DomainErrorCode,
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

function throwIfExecutionAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw (
      signal.reason ??
      new DOMException("Tool execution was cancelled.", "AbortError")
    );
  }
}

const QUALIFIED_DRAFT_CANONICAL = canonicalJson(
  buildDispatchDraft(DRAFT_INPUT),
);

export class DispatchStore {
  private state: DispatchState = createInitialState();
  private readonly listeners = new Set<() => void>();
  private readonly usedIdempotencyKeys = new Set<string>();
  private latestRevokedGeneration = 0;
  private auditSequence = 0;
  private approvalGeneration = 0;
  private approvalInFlight = false;
  private approvalCanonicalBinding: string | null = null;
  private lifecycleFailureSequence = 0;
  private activeLifecycleFailureToken: number | null = null;
  private recoverableLifecycleFailureToken: number | null = null;

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
    lifecycleFailureToken?: number,
  ): void {
    if ("error_code" in patch || "error_message" in patch) {
      this.activeLifecycleFailureToken = lifecycleFailureToken ?? null;
      this.recoverableLifecycleFailureToken = null;
    }
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
          Date.parse(provider.slot.ends_at) <= Date.parse(before),
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
    this.expireApprovalIfNeeded();

    if (
      this.state.phase === "draft_ready" &&
      this.state.draft &&
      this.state.error_code === null &&
      this.state.error_message === null
    ) {
      try {
        if (canonicalJson(this.state.draft) === QUALIFIED_DRAFT_CANONICAL) {
          return this.state.draft;
        }
      } catch {
        // Replace hostile or unstable draft data with the qualified fixture.
      }
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
    if (this.state.phase === "approved") {
      this.approvalCanonicalBinding = null;
    }

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
      let canonicalDraftBeforeHash: string;
      try {
        canonicalDraftBeforeHash = canonicalJson(draft);
      } catch {
        throw new DispatchDomainError(
          "DRAFT_CHANGED_AFTER_APPROVAL",
          "The draft cannot be represented as stable canonical data for approval.",
        );
      }
      if (canonicalDraftBeforeHash !== QUALIFIED_DRAFT_CANONICAL) {
        throw new DispatchDomainError(
          "INVALID_INPUT",
          "The draft no longer matches the qualified dispatch that was created.",
        );
      }
      const approval = await createApprovalRecord({
        draft,
        now: () => this.clock.now(),
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
      let canonicalDraftAfterHash: string;
      try {
        canonicalDraftAfterHash = canonicalJson(draft);
      } catch {
        throw new DispatchDomainError(
          "DRAFT_CHANGED_AFTER_APPROVAL",
          "The draft changed to unstable canonical data while approval was being bound.",
        );
      }
      if (canonicalDraftAfterHash !== canonicalDraftBeforeHash) {
        throw new DispatchDomainError(
          "DRAFT_CHANGED_AFTER_APPROVAL",
          "The draft changed during approval hash validation.",
        );
      }

      this.approvalCanonicalBinding = canonicalJson(approval);

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
      if (this.approvalGeneration === generation) {
        this.approvalInFlight = false;
      }
    }
  }

  expireApprovalIfNeeded(): boolean {
    const approval = this.state.approval;
    if (this.state.phase !== "approved" || !approval) {
      return false;
    }

    if (!this.approvalMatchesCanonicalBinding(approval)) {
      this.invalidateApprovalState(
        approval,
        "Approval record changed. Approve the exact draft again.",
      );
      return true;
    }
    if (approval.status !== "approved") {
      return false;
    }

    const now = this.clock.now();
    if (!hasValidApprovalWindow(approval, now)) {
      const message =
        "The approval record failed its exact lifetime binding check.";
      this.approvalCanonicalBinding = null;
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
        [this.audit("Approval invalidated by lifetime check", "danger")],
      );
      return true;
    }
    if (!isApprovalExpired(approval, now)) {
      return false;
    }

    this.approvalCanonicalBinding = null;
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
    this.expireApprovalIfNeeded();

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
    if (wasApproved) {
      this.approvalCanonicalBinding = null;
    }

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
    executionSignal?: AbortSignal,
  ) {
    throwIfExecutionAborted(executionSignal);
    let approval = this.state.approval;

    if (!approval) {
      throw new DispatchDomainError(
        "APPROVAL_NOT_FOUND",
        "No approval exists for this dispatch.",
      );
    }
    let canonicalApprovalBeforeHash = "";
    if (this.state.phase === "approved") {
      try {
        canonicalApprovalBeforeHash = canonicalJson(approval);
      } catch {
        this.invalidateApprovalIntegrity(
          approval,
          "The approval record cannot be represented as stable canonical data.",
        );
      }
      if (canonicalApprovalBeforeHash !== this.approvalCanonicalBinding) {
        this.invalidateApprovalIntegrity(
          approval,
          "The approval record no longer matches the exact human approval.",
        );
      }
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
      this.invalidateApprovalIntegrity(
        approval,
        "The approved draft no longer exists.",
        "DRAFT_CHANGED_AFTER_APPROVAL",
      );
    }
    if (
      approval.draft_id !== this.state.draft.draft_id ||
      approval.idempotency_key !==
        `dispatch:${approval.draft_id}:${approval.one_time_nonce}`
    ) {
      this.invalidateApprovalIntegrity(
        approval,
        "The approval record failed its one-time nonce binding check.",
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
    let canonicalDraftBeforeHash: string;
    try {
      canonicalDraftBeforeHash = canonicalJson(draft);
    } catch {
      this.invalidateApprovalIntegrity(
        approval,
        "The current draft cannot be represented as stable canonical data.",
        "DRAFT_CHANGED_AFTER_APPROVAL",
      );
    }
    const currentHash = await sha256Hex(draft);
    throwIfExecutionAborted(executionSignal);
    const currentApproval = this.state.approval;

    if (
      this.state.revision !== revision ||
      this.state.phase !== "approved" ||
      this.state.draft !== draft ||
      !currentApproval ||
      currentApproval.generation !== registeredGeneration
    ) {
      if (currentApproval?.status === "used" || currentApproval?.used_at) {
        throw new DispatchDomainError(
          "APPROVAL_ALREADY_USED",
          "This one-time approval was consumed during validation.",
        );
      }
      throw new DispatchDomainError(
        "DRAFT_CHANGED_AFTER_APPROVAL",
        "The dispatch changed during commit validation.",
      );
    }
    let canonicalApprovalAfterHash: string;
    try {
      canonicalApprovalAfterHash = canonicalJson(currentApproval);
    } catch {
      this.invalidateApprovalIntegrity(
        currentApproval,
        "The approval record changed to unstable canonical data during validation.",
      );
    }
    if (
      canonicalApprovalAfterHash !== canonicalApprovalBeforeHash ||
      canonicalApprovalAfterHash !== this.approvalCanonicalBinding
    ) {
      this.invalidateApprovalIntegrity(
        currentApproval,
        "The approval record changed during commit validation.",
      );
    }
    let canonicalDraftAfterHash: string;
    try {
      canonicalDraftAfterHash = canonicalJson(draft);
    } catch {
      this.invalidateApprovalIntegrity(
        currentApproval,
        "The current draft changed to unstable canonical data during validation.",
        "DRAFT_CHANGED_AFTER_APPROVAL",
      );
    }
    if (canonicalDraftAfterHash !== canonicalDraftBeforeHash) {
      this.invalidateApprovalIntegrity(
        currentApproval,
        "The current draft changed during hash validation.",
        "DRAFT_CHANGED_AFTER_APPROVAL",
      );
    }
    if (currentHash !== currentApproval.draft_hash) {
      this.invalidateApprovalIntegrity(
        currentApproval,
        "The current draft hash does not match the approved hash.",
        "DRAFT_CHANGED_AFTER_APPROVAL",
      );
    }
    const consumptionNow = this.clock.now();
    if (!hasValidApprovalWindow(currentApproval, consumptionNow)) {
      this.invalidateApprovalIntegrity(
        currentApproval,
        "The approval record failed its exact lifetime binding check.",
      );
    }
    if (isApprovalExpired(currentApproval, consumptionNow)) {
      this.expireApprovalIfNeeded();
      throw new DispatchDomainError(
        "APPROVAL_EXPIRED",
        "This approval expired during commit validation.",
      );
    }

    const committedAt = new Date(consumptionNow).toISOString();
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
      [this.audit("Approved dispatch committed through tool", "success")],
    );

    return committedDispatch;
  }

  private invalidateApprovalIntegrity(
    approval: ApprovalRecord,
    message: string,
    code: DomainErrorCode = "CAPABILITY_NOT_AVAILABLE",
  ): never {
    this.invalidateApprovalState(approval, message, code);
    throw new DispatchDomainError(code, message);
  }

  private approvalMatchesCanonicalBinding(approval: ApprovalRecord): boolean {
    try {
      return canonicalJson(approval) === this.approvalCanonicalBinding;
    } catch {
      return false;
    }
  }

  private invalidateApprovalState(
    approval: ApprovalRecord,
    message: string,
    code: DomainErrorCode = "CAPABILITY_NOT_AVAILABLE",
  ): void {
    if (this.state.phase === "approved" && this.state.approval === approval) {
      const canonicalBinding = this.approvalCanonicalBinding;
      this.approvalCanonicalBinding = null;
      let invalidatedApproval: ApprovalRecord;
      try {
        if (canonicalBinding === null) throw new TypeError("Missing binding.");
        invalidatedApproval = {
          ...(JSON.parse(canonicalBinding) as ApprovalRecord),
          status: "invalidated",
          invalidation_reason: message,
        };
      } catch {
        const invalidatedAt = new Date(this.clock.now()).toISOString();
        invalidatedApproval = {
          approval_id: "approval-invalidated",
          draft_id: "D-invalidated",
          draft_hash: "",
          approved_at: invalidatedAt,
          expires_at: invalidatedAt,
          one_time_nonce: "",
          idempotency_key: "",
          used_at: null,
          generation: this.approvalGeneration,
          status: "invalidated",
          invalidation_reason: message,
        };
      }
      this.update(
        {
          phase: transitionPhase("approved", "draft_ready"),
          approval: invalidatedApproval,
          error_code: code,
          error_message: message,
        },
        [this.audit("Approval invalidated by integrity check", "danger")],
      );
    }
  }

  markTemporaryCapabilityRegistered(generation: number): void {
    if (this.expireApprovalIfNeeded()) {
      return;
    }
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
    if (generation <= this.latestRevokedGeneration) {
      return;
    }
    this.latestRevokedGeneration = generation;
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
    if (this.expireApprovalIfNeeded()) {
      return;
    }
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

  recordCapabilityLifecycleFailure(message: string): number {
    const duplicateMessage =
      this.state.error_code === "CAPABILITY_NOT_AVAILABLE" &&
      this.state.error_message === message &&
      this.activeLifecycleFailureToken !== null;
    const token = ++this.lifecycleFailureSequence;
    this.update(
      {
        error_code: "CAPABILITY_NOT_AVAILABLE",
        error_message: message,
      },
      duplicateMessage
        ? []
        : [
            this.audit(
              "WebMCP capability lifecycle verification failed",
              "danger",
            ),
          ],
      token,
    );
    return token;
  }

  getActiveCapabilityLifecycleFailureToken(): number | null {
    return this.activeLifecycleFailureToken;
  }

  markCapabilityLifecycleFailureRecoverable(token: number | null): boolean {
    if (
      token === null ||
      token !== this.activeLifecycleFailureToken ||
      this.state.error_code !== "CAPABILITY_NOT_AVAILABLE"
    ) {
      return false;
    }
    this.recoverableLifecycleFailureToken = token;
    return true;
  }

  getRecoverableCapabilityLifecycleFailureToken(): number | null {
    return this.recoverableLifecycleFailureToken;
  }

  clearCapabilityLifecycleFailure(token: number | null): boolean {
    if (
      token === null ||
      token !== this.activeLifecycleFailureToken ||
      token !== this.recoverableLifecycleFailureToken ||
      this.state.error_code !== "CAPABILITY_NOT_AVAILABLE"
    ) {
      return false;
    }
    this.update(
      { error_code: null, error_message: null },
      [this.audit("WebMCP capability lifecycle recovered", "capability")],
    );
    return true;
  }

  reset(): void {
    this.approvalGeneration += 1;
    this.approvalInFlight = false;
    this.approvalCanonicalBinding = null;
    this.activeLifecycleFailureToken = null;
    this.recoverableLifecycleFailureToken = null;
    this.usedIdempotencyKeys.clear();
    this.state = createInitialState(this.state.revision + 1);
    this.emit();
  }

  getRemainingApprovalSeconds(): number {
    if (
      this.state.approval &&
      !this.approvalMatchesCanonicalBinding(this.state.approval)
    ) {
      return 0;
    }
    return remainingApprovalSeconds(this.state.approval, this.clock.now());
  }
}
