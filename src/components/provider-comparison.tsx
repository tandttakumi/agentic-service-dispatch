import type { ProviderEvaluation } from "@/lib/domain/types";

interface ProviderComparisonProps {
  evaluations: ProviderEvaluation[];
  isEvaluated: boolean;
}

function yen(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

export function ProviderComparison({
  evaluations,
  isEvaluated,
}: ProviderComparisonProps) {
  return (
    <section
      className={`provider-section ${isEvaluated ? "is-evaluated" : "is-pending"}`}
      aria-labelledby="providers-heading"
    >
      <div className="section-heading-row compact">
        <div>
          <p className="eyebrow">Constraint resolution</p>
          <h2 id="providers-heading">Provider comparison</h2>
        </div>
        <span className={`status-chip ${isEvaluated ? "status-cyan" : ""}`}>
          {isEvaluated ? "Evaluated by tool" : "Preview"}
        </span>
      </div>

      {isEvaluated ? (
        <div className="provider-table-wrap">
          <table className="provider-table">
          <thead>
            <tr>
              <th scope="col">Provider</th>
              <th scope="col">Certified</th>
              <th scope="col">Price</th>
              <th scope="col">Availability</th>
              <th scope="col">Decision</th>
            </tr>
          </thead>
          <tbody>
            {evaluations.map((evaluation) => (
              <tr
                key={evaluation.provider.id}
                className={evaluation.matches ? "provider-match" : ""}
              >
                <th scope="row">
                  <span>{evaluation.provider.name}</span>
                  <small>{evaluation.provider.distance_km.toFixed(1)} km</small>
                </th>
                <td data-label="Certified">
                  <span className="binary-label">
                    {evaluation.provider.certified ? "Yes" : "No"}
                  </span>
                </td>
                <td data-label="Price">
                  ¥{yen(evaluation.provider.price_jpy)}
                </td>
                <td data-label="Availability">
                  {evaluation.provider.slot.label}
                </td>
                <td data-label="Decision">
                  <span
                    className={`decision-label ${
                      evaluation.matches ? "decision-match" : "decision-excluded"
                    }`}
                  >
                    {evaluation.matches ? "MATCH" : "EXCLUDED"}
                  </span>
                  <small>{evaluation.reason}</small>
                </td>
              </tr>
            ))}
          </tbody>
          </table>
        </div>
      ) : (
        <div className="provider-pending" role="status">
          <strong>Provider decision pending</strong>
          <p>
            Awaiting live <code>search_qualified_providers</code> results.
          </p>
        </div>
      )}
    </section>
  );
}
