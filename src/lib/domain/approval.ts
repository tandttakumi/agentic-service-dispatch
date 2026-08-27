import { sha256Hex } from "./canonical-json";
import type {
  ApprovalRecord,
  DispatchDraft,
  IdFactory,
} from "./types";

export const APPROVAL_TTL_MS = 120_000;

interface CreateApprovalOptions {
  draft: DispatchDraft;
  now: number;
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

  return {
    approval_id: `approval-${nextId()}`,
    draft_id: draft.draft_id,
    draft_hash: draftHash,
    approved_at: new Date(now).toISOString(),
    expires_at: new Date(now + APPROVAL_TTL_MS).toISOString(),
    one_time_nonce: nextId(),
    idempotency_key: `dispatch:${draft.draft_id}:${nextId()}`,
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

export function remainingApprovalSeconds(
  approval: ApprovalRecord | null,
  now: number,
): number {
  if (!approval || approval.status !== "approved") {
    return 0;
  }

  return Math.max(0, Math.ceil((Date.parse(approval.expires_at) - now) / 1000));
}

