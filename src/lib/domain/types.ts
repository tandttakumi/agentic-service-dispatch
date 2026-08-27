export type DispatchPhase =
  | "idle"
  | "context_loaded"
  | "providers_compared"
  | "draft_ready"
  | "approved"
  | "committed";

export type ApprovalStatus = "approved" | "expired" | "invalidated" | "used";

export type DomainErrorCode =
  | "INVALID_INPUT"
  | "INVALID_TRANSITION"
  | "APPROVAL_NOT_FOUND"
  | "APPROVAL_EXPIRED"
  | "APPROVAL_ALREADY_USED"
  | "DRAFT_CHANGED_AFTER_APPROVAL"
  | "CAPABILITY_NOT_AVAILABLE"
  | "DISPATCH_ALREADY_COMMITTED";

export interface Vehicle {
  id: "vehicle-001";
  name: "2024 Calystren Veo";
  customer: "Northstar Auto Gallery";
  finish: "Deep graphite";
  current_request: "Exterior correction and ceramic coating";
}

export interface RequestConditions {
  certification_required: true;
  completion_before: "2026-08-28T00:00:00+09:00";
  max_price_jpy: 60000;
  previous_service_history_required: true;
  human_approval_required: true;
}

export interface ServiceHistoryEntry {
  id: string;
  completed_at: string;
  service: string;
  provider: string;
  note: string;
}

export interface ProviderSlot {
  id: string;
  starts_at: string;
  ends_at: string;
  label: string;
}

export interface Provider {
  id: string;
  name: string;
  certified: boolean;
  price_jpy: number;
  distance_km: number;
  services: string[];
  slot: ProviderSlot;
}

export interface ProviderEvaluation {
  provider: Provider;
  matches: boolean;
  certification_matches: boolean;
  budget_matches: boolean;
  deadline_matches: boolean;
  reason: string;
}

export interface CreateDraftInput {
  provider_id: "provider-001";
  slot_id: "slot-001";
  quoted_price_jpy: 58000;
  rationale: "Certified, within budget, and available before the deadline.";
}

export interface DispatchDraft {
  draft_id: string;
  vehicle: Vehicle;
  provider: Provider;
  slot: ProviderSlot;
  quoted_price_jpy: number;
  work_scope: string;
  rationale: string;
}

export interface ApprovalRecord {
  approval_id: string;
  draft_id: string;
  draft_hash: string;
  approved_at: string;
  expires_at: string;
  one_time_nonce: string;
  idempotency_key: string;
  used_at: string | null;
  generation: number;
  status: ApprovalStatus;
  invalidation_reason: string | null;
}

export interface CommittedDispatch {
  dispatch_id: string;
  draft: DispatchDraft;
  approval_id: string;
  idempotency_key: string;
  committed_at: string;
}

export interface AuditEntry {
  id: string;
  message: string;
  at: string;
  tone: "neutral" | "approval" | "capability" | "success" | "danger";
}

export interface DispatchState {
  phase: DispatchPhase;
  service_history_reviewed: boolean;
  providers_evaluated: boolean;
  availability_checked: boolean;
  provider_evaluations: ProviderEvaluation[];
  draft: DispatchDraft | null;
  approval: ApprovalRecord | null;
  committed_dispatch: CommittedDispatch | null;
  audit_log: AuditEntry[];
  error_code: DomainErrorCode | null;
  error_message: string | null;
  revision: number;
}

export interface Clock {
  now(): number;
}

export type IdFactory = () => string;

export class DispatchDomainError extends Error {
  readonly code: DomainErrorCode;

  constructor(code: DomainErrorCode, message: string) {
    super(message);
    this.name = "DispatchDomainError";
    this.code = code;
  }
}
