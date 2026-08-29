import { sha256Hex } from "./canonical-json";
import type {
  ApprovalRecord,
  DispatchDraft,
  IdFactory,
} from "./types";

export const APPROVAL_TTL_MS = 120_000;

interface CreateApprovalOptions {
  draft: DispatchDraft;
  now: () => number;
  generation: number;
  nextId: IdFactory;
}

export async function createApprovalRecord({
  draft,
  now,
  generation,
  nextId,
}: CreateApprovalOptions): Promise<ApprovalRecord> {
  const draftHash = await sha256Hex(draft);
  const approvedAt = now();
  const approvalId = `approval-${nextId()}`;
  const oneTimeNonce = nextId();

  return {
    approval_id: approvalId,
    draft_id: draft.draft_id,
    draft_hash: draftHash,
    approved_at: new Date(approvedAt).toISOString(),
    expires_at: new Date(approvedAt + APPROVAL_TTL_MS).toISOString(),
    one_time_nonce: oneTimeNonce,
    idempotency_key: `dispatch:${draft.draft_id}:${oneTimeNonce}`,
    used_at: null,
    generation,
    status: "approved",
    invalidation_reason: null,
  };
}

export function isApprovalExpired(
  approval: ApprovalRecord,
  now: number,
): boolean {
  return now >= Date.parse(approval.expires_at);
}

export function hasValidApprovalWindow(
  approval: ApprovalRecord,
  now: number,
): boolean {
  const approvedAt = Date.parse(approval.approved_at);
  const expiresAt = Date.parse(approval.expires_at);
  return (
    Number.isFinite(approvedAt) &&
    Number.isFinite(expiresAt) &&
    expiresAt - approvedAt === APPROVAL_TTL_MS &&
    approvedAt <= now
  );
}

export function remainingApprovalSeconds(
  approval: ApprovalRecord | null,
  now: number,
): number {
  if (
    !approval ||
    approval.status !== "approved" ||
    !hasValidApprovalWindow(approval, now)
  ) {
    return 0;
  }

  return Math.max(0, Math.ceil((Date.parse(approval.expires_at) - now) / 1000));
}
