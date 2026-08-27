import type { AuditEntry } from "./types";

export function formatAuditTime(entry: AuditEntry): string {
  return entry.at.slice(11, 19);
}

export function hasAuditMessage(
  entries: AuditEntry[],
  message: string,
): boolean {
  return entries.some((entry) => entry.message === message);
}

