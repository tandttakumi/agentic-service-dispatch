import type { ApprovalRecord, DispatchPhase } from "@/lib/domain/types";
import {
  BASE_TOOL_NAMES,
  COMMIT_TOOL_NAME,
} from "@/lib/webmcp/tool-registry";
import type { RegisteredTool } from "@/lib/webmcp/types";

interface CapabilityPanelProps {
  tools: RegisteredTool[];
  availability: "checking" | "unavailable" | "native" | "test" | "error";
  approval: ApprovalRecord | null;
  phase: DispatchPhase;
  remainingSeconds: number;
  error: string | null;
}

function formatRemaining(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${remainder.toString().padStart(2, "0")}`;
}

export function CapabilityPanel({
  tools,
  availability,
  approval,
  phase,
  remainingSeconds,
  error,
}: CapabilityPanelProps) {
  const toolNames = new Set(tools.map((tool) => tool.name));
  const commitVisible = toolNames.has(COMMIT_TOOL_NAME);
  const baseCount = BASE_TOOL_NAMES.filter((name) => toolNames.has(name)).length;
  const toolOrder = new Map<string, number>([
    ...BASE_TOOL_NAMES.map((name, index) => [name, index] as const),
    [COMMIT_TOOL_NAME, BASE_TOOL_NAMES.length],
  ]);
  const displayedTools = [...tools].sort((left, right) => {
    const leftOrder = toolOrder.get(left.name) ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = toolOrder.get(right.name) ?? Number.MAX_SAFE_INTEGER;
    return leftOrder - rightOrder || left.name.localeCompare(right.name);
  });

  return (
    <section className="capability-section" aria-labelledby="capabilities-heading">
      <div className="section-heading-row">
        <div>
          <p className="eyebrow">Actual browser state</p>
          <h2 id="capabilities-heading">Live WebMCP Capabilities</h2>
        </div>
        <span className="capability-count" aria-label={`${tools.length} live tools`}>
          {tools.length}
        </span>
      </div>

      {availability === "checking" ? (
        <p className="capability-message">Checking document.modelContext…</p>
      ) : null}

      {availability === "unavailable" ? (
        <div className="unsupported-notice" role="status">
          <strong>Native WebMCP is unavailable in this browser.</strong>
          <span>No tool registration is being simulated.</span>
        </div>
      ) : null}

      {availability === "error" || error ? (
        <div className="runtime-error" role="alert">
          <strong>WebMCP lifecycle error</strong>
          <span>{error ?? "The native capability surface could not be verified."}</span>
        </div>
      ) : null}

      {availability === "native" || availability === "test" ? (
        <>
          <p className="source-proof">
            <span aria-hidden="true" />
            Fetched from <code>await document.modelContext.getTools()</code>
          </p>

          <ul
            className="tool-list"
            aria-live="polite"
            aria-label="Currently registered WebMCP tools"
          >
            {displayedTools.map((tool, index) => {
              const temporary = tool.name === COMMIT_TOOL_NAME;
              return (
                <li
                  className={temporary ? "tool-temporary" : "tool-live"}
                  data-testid={temporary ? "temporary-tool" : undefined}
                  key={tool.name}
                >
                  <span className="tool-index">{String(index + 1).padStart(2, "0")}</span>
                  {temporary ? (
                    <div>
                      <code>{tool.name}</code>
                      <span>Approved for this exact draft · One-time use</span>
                    </div>
                  ) : (
                    <code>{tool.name}</code>
                  )}
                  {temporary ? (
                    <strong>{formatRemaining(remainingSeconds)}</strong>
                  ) : (
                    <span className="tool-state">LIVE</span>
                  )}
                </li>
              );
            })}
          </ul>

          <div className="capability-foot">
            <span>{baseCount}/5 baseline tools verified</span>
            {phase === "committed" && !commitVisible ? (
              <strong className="revoked-proof">
                {COMMIT_TOOL_NAME} revoked
              </strong>
            ) : approval?.status === "expired" && !commitVisible ? (
              <strong className="expired-proof">
                Temporary capability expired and revoked
              </strong>
            ) : (
              <span>
                {commitVisible
                  ? "Approval expanded the tool surface"
                  : "Write capability absent"}
              </span>
            )}
          </div>
        </>
      ) : null}
    </section>
  );
}
