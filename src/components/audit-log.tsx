import { formatAuditTime } from "@/lib/domain/audit-log";
import type { AuditEntry } from "@/lib/domain/types";

interface AuditLogProps {
  entries: AuditEntry[];
}

export function AuditLog({ entries }: AuditLogProps) {
  return (
    <section className="audit-section" aria-labelledby="audit-heading">
      <div className="section-heading-row">
        <div>
          <p className="eyebrow">Trace</p>
          <h2 id="audit-heading">Audit Log</h2>
        </div>
        <span className="count-badge" aria-label={`${entries.length} audit events`}>
          {entries.length.toString().padStart(2, "0")}
        </span>
      </div>

      <ol className="audit-list" aria-live="polite" aria-relevant="additions">
        {entries.length === 0 ? (
          <li className="audit-empty">
            Tool-backed events will appear here in execution order.
          </li>
        ) : (
          entries.map((entry) => (
            <li className={`audit-entry audit-${entry.tone}`} key={entry.id}>
              <span className="audit-marker" aria-hidden="true" />
              <div>
                <p>{entry.message}</p>
                <time dateTime={entry.at}>{formatAuditTime(entry)} UTC</time>
              </div>
            </li>
          ))
        )}
      </ol>
    </section>
  );
}

