"use client";

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { SERVICE_HISTORY, VEHICLE } from "@/lib/domain/fixtures";
import { DispatchStore } from "@/lib/domain/dispatch-machine";
import { DispatchDomainError } from "@/lib/domain/types";
import { getNativeWebMcpAdapter } from "@/lib/webmcp/native-adapter";
import {
  COMMIT_TOOL_NAME,
  ToolRegistry,
  executeToolSequence,
} from "@/lib/webmcp/tool-registry";
import type { RegisteredTool, WebMcpAdapter } from "@/lib/webmcp/types";

import { AuditLog } from "./audit-log";
import { CapabilityPanel } from "./capability-panel";
import { ProviderComparison } from "./provider-comparison";

const DEMO_PROMPT =
  "Find a qualified detailer for this vehicle, available before Friday, under ¥60,000. Check its previous service history and draft the job. Don't submit anything until I approve.";

interface DispatchDemoProps {
  adapterFactory?: () => WebMcpAdapter | null;
  storeFactory?: () => DispatchStore;
}

type Availability = "checking" | "unavailable" | "native" | "test" | "error";

function formatYen(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function useCapabilities(adapter: WebMcpAdapter | null) {
  const [tools, setTools] = useState<RegisteredTool[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!adapter) {
      return;
    }

    let active = true;
    let refreshGeneration = 0;
    const refresh = async () => {
      const generation = ++refreshGeneration;
      try {
        const next = await adapter.getTools();
        if (active && generation === refreshGeneration) {
          setTools(next);
          setError(null);
        }
      } catch (cause) {
        if (active && generation === refreshGeneration) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not read the WebMCP tool surface.",
          );
        }
      }
    };
    const onToolChange: EventListener = () => {
      void refresh();
    };

    adapter.addEventListener("toolchange", onToolChange);
    void refresh();
    return () => {
      active = false;
      adapter.removeEventListener("toolchange", onToolChange);
    };
  }, [adapter]);

  return { tools, error };
}

export function DispatchDemo({
  adapterFactory,
  storeFactory,
}: DispatchDemoProps = {}) {
  const [store] = useState(
    () => storeFactory?.() ?? new DispatchStore(),
  );
  const state = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );

  const [{ adapter, registry }] = useState(() => {
    const nextAdapter =
      adapterFactory?.() ??
      (typeof document === "undefined"
        ? null
        : getNativeWebMcpAdapter(document));
    return {
      adapter: nextAdapter,
      registry: nextAdapter ? new ToolRegistry(nextAdapter, store) : null,
    };
  });
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const actionInFlightRef = useRef(false);
  const [availability, setAvailability] =
    useState<Availability>("checking");
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const { tools, error: capabilityError } = useCapabilities(adapter);

  useEffect(() => {
    if (!adapter || !registry) {
      const timer = window.setTimeout(
        () => setAvailability("unavailable"),
        0,
      );
      return () => window.clearTimeout(timer);
    }

    let active = true;
    void registry
      .start()
      .then(() => {
        if (!active) return;
        const isInjectedTest =
          adapter.kind === "test" || window.__WEBMCP_TEST_MODE__ === true;
        setAvailability(isInjectedTest ? "test" : "native");
        setRuntimeError(null);
      })
      .catch((cause) => {
        if (!active) return;
        setAvailability("error");
        setRuntimeError(
          cause instanceof Error
            ? cause.message
            : "WebMCP registration failed.",
        );
      });

    return () => {
      active = false;
      void registry.stop();
    };
  }, [adapter, registry]);

  useEffect(() => {
    if (
      state.phase !== "approved" ||
      state.approval?.status !== "approved"
    ) {
      return;
    }

    const tick = () => {
      setRemainingSeconds(store.getRemainingApprovalSeconds());
      store.expireApprovalIfNeeded();
    };
    const timer = window.setInterval(tick, 250);
    return () => window.clearInterval(timer);
  }, [state.approval, state.phase, store]);

  useEffect(
    () => () => {
      if (copyTimerRef.current) {
        clearTimeout(copyTimerRef.current);
      }
    },
    [],
  );

  const withAction = async (name: string, action: () => Promise<void>) => {
    if (actionInFlightRef.current) {
      return;
    }
    actionInFlightRef.current = true;
    setBusyAction(name);
    setRuntimeError(null);
    try {
      await action();
    } catch (cause) {
      const message =
        cause instanceof DispatchDomainError
          ? `${cause.code}: ${cause.message}`
          : cause instanceof Error
            ? cause.message
            : "The requested action failed.";
      setRuntimeError(message);
    } finally {
      actionInFlightRef.current = false;
      setBusyAction(null);
    }
  };

  const handleRunAgent = () =>
    withAction("run", async () => {
      if (!registry) return;
      await executeToolSequence(registry);
    });

  const handleApprove = () =>
    withAction("approve", async () => {
      await store.approveDraft();
      setRemainingSeconds(store.getRemainingApprovalSeconds());
    });

  const handleCommit = () =>
    withAction("commit", async () => {
      const approvalId = store.getSnapshot().approval?.approval_id;
      if (!approvalId || !registry) {
        throw new DispatchDomainError(
          "CAPABILITY_NOT_AVAILABLE",
          "No exact approval is available for commit.",
        );
      }
      await registry.executeNamedTool(COMMIT_TOOL_NAME, {
        approval_id: approvalId,
      });
    });

  const handleReset = () =>
    withAction("reset", async () => {
      if (registry) {
        await registry.reset();
      } else {
        store.reset();
      }
      setRemainingSeconds(0);
    });

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(DEMO_PROMPT);
    } catch {
      const textArea = document.createElement("textarea");
      textArea.value = DEMO_PROMPT;
      textArea.setAttribute("readonly", "");
      textArea.style.position = "fixed";
      textArea.style.opacity = "0";
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand("copy");
      textArea.remove();
    }
    setCopied(true);
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopied(false), 1_500);
  };

  const toolNames = new Set(tools.map((tool) => tool.name));
  const commitAvailable = toolNames.has(COMMIT_TOOL_NAME);
  const isWebMcpReady = availability === "native" || availability === "test";
  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            AS
          </span>
          <div>
            <p className="eyebrow">WebMCP control surface · fictional demo</p>
            <h1>Agentic Service Dispatch</h1>
          </div>
        </div>

        <p className="thesis">
          Approval changes what the agent can do
          <span>—not merely what it is told to do.</span>
        </p>

        <div className="header-actions">
          <span
            className={`native-badge native-${availability}`}
            data-testid="availability-badge"
          >
            <span aria-hidden="true" />
            {availability === "native"
              ? "Native WebMCP available"
              : availability === "test"
                ? "WebMCP test adapter"
                : availability === "unavailable"
                  ? "Native WebMCP unavailable"
                  : availability === "error"
                    ? "WebMCP error"
                    : "Checking WebMCP"}
          </span>
          <button
            className="button button-secondary"
            onClick={() => void handleReset()}
            disabled={busyAction !== null}
            type="button"
          >
            {busyAction === "reset" ? "Resetting…" : "Reset Demo"}
          </button>
        </div>
      </header>

      <section className="prompt-strip" aria-labelledby="prompt-heading">
        <div className="prompt-label">
          <span aria-hidden="true">›_</span>
          <div>
            <p id="prompt-heading">Deterministic WebMCP runner</p>
            <span>CALLS LIVE TOOLS · 5 PREPARE → 6 APPROVE → 5 CONSUME</span>
          </div>
        </div>
        <blockquote>{DEMO_PROMPT}</blockquote>
        <div className="prompt-actions">
          <button
            className="button button-ghost"
            onClick={() => void handleCopy()}
            type="button"
            aria-label="Copy demo prompt"
          >
            {copied ? "Copied" : "Copy"}
          </button>
          <button
            className="button button-primary"
            onClick={() => void handleRunAgent()}
            disabled={
              !isWebMcpReady ||
              state.phase !== "idle" ||
              busyAction !== null
            }
            type="button"
          >
            {busyAction === "run"
              ? "Running live tools…"
              : "Run live 5-tool sequence"}
          </button>
        </div>
      </section>

      <div className="workspace-grid">
        <aside className="panel context-panel" aria-label="Dispatch context">
          <section aria-labelledby="vehicle-heading">
            <div className="section-heading-row compact">
              <div>
                <p className="eyebrow">Active asset</p>
                <h2 id="vehicle-heading">Vehicle</h2>
              </div>
              <code className="record-id">{VEHICLE.id}</code>
            </div>
            <div className="vehicle-card">
              <div className="vehicle-swatch" aria-hidden="true">
                <span>AV</span>
              </div>
              <div>
                <h3>{VEHICLE.name}</h3>
                <p>{VEHICLE.customer}</p>
                <dl>
                  <div>
                    <dt>Finish</dt>
                    <dd>{VEHICLE.finish}</dd>
                  </div>
                  <div>
                    <dt>Request</dt>
                    <dd>{VEHICLE.current_request}</dd>
                  </div>
                </dl>
              </div>
            </div>
          </section>

          <section className="conditions-section" aria-labelledby="conditions-heading">
            <div className="section-heading-row compact">
              <div>
                <p className="eyebrow">Hard constraints</p>
                <h2 id="conditions-heading">Request conditions</h2>
              </div>
            </div>
            <ul className="condition-list">
              <li><span>Certification</span><strong>Required</strong></li>
              <li><span>Complete before</span><strong>Fri · Aug 28</strong></li>
              <li><span>Budget ceiling</span><strong>¥60,000</strong></li>
              <li><span>History check</span><strong>Required</strong></li>
              <li className="condition-approval"><span>Submission</span><strong>Human approval only</strong></li>
            </ul>
          </section>

          <section className="history-section" aria-labelledby="history-heading">
            <div className="section-heading-row compact">
              <div>
                <p className="eyebrow">Prior work</p>
                <h2 id="history-heading">Service history</h2>
              </div>
              <span className={`status-chip ${state.service_history_reviewed ? "status-cyan" : ""}`}>
                {state.service_history_reviewed ? "Reviewed" : "Pending"}
              </span>
            </div>
            {state.service_history_reviewed ? (
              <ol className="history-list">
                {SERVICE_HISTORY.map((entry) => (
                  <li key={entry.id}>
                    <time dateTime={entry.completed_at}>{entry.completed_at}</time>
                    <strong>{entry.service}</strong>
                    <p>{entry.note}</p>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="empty-state">
                Awaiting <code>get_service_history</code>.
              </p>
            )}
          </section>
        </aside>

        <section className="panel decision-panel" aria-label="Dispatch decision">
          <div className="decision-header">
            <div>
              <p className="eyebrow">Agent decision plane</p>
              <h2>Draft first. Authority later.</h2>
            </div>
            <span className="phase-indicator">
              State <strong>{state.phase.replaceAll("_", " ")}</strong>
            </span>
          </div>

          <ProviderComparison
            evaluations={state.provider_evaluations}
            isEvaluated={state.providers_evaluated}
          />

          <section className="draft-section" aria-labelledby="draft-heading">
            {!state.draft ? (
              <div className="draft-empty">
                <span aria-hidden="true">⌁</span>
                <div>
                  <h2 id="draft-heading">No dispatch draft yet</h2>
                  <p>
                    The agent can inspect and compare. It cannot submit anything
                    until an exact draft exists and a human approves it.
                  </p>
                </div>
              </div>
            ) : (
              <div
                className={`draft-card ${
                  state.phase === "committed" ? "draft-committed" : ""
                }`}
              >
                <div className="draft-title-row">
                  <div>
                    <p className="draft-kicker">
                      {state.phase === "committed"
                        ? "COMMITTED — ONE EXACT ACTION"
                        : "DRAFT — NOT SUBMITTED"}
                    </p>
                    <h2 id="draft-heading">
                      {state.draft.provider.name}
                      <span>{state.draft.draft_id}</span>
                    </h2>
                  </div>
                  <strong>¥{formatYen(state.draft.quoted_price_jpy)}</strong>
                </div>

                <dl className="draft-details">
                  <div><dt>Vehicle</dt><dd>{state.draft.vehicle.name}</dd></div>
                  <div><dt>Slot</dt><dd>{state.draft.slot.label}</dd></div>
                  <div><dt>Scope</dt><dd>{state.draft.work_scope}</dd></div>
                  <div><dt>Rationale</dt><dd>{state.draft.rationale}</dd></div>
                </dl>

                {state.approval ? (
                  <div className="hash-binding">
                    <span>Exact draft binding</span>
                    <code>{state.approval.draft_hash.slice(0, 20)}…</code>
                  </div>
                ) : null}

                <div className="draft-action-row">
                  {state.phase === "draft_ready" ? (
                    <>
                      <p>
                        No write capability is registered. Approval will create
                        one for this hash only.
                      </p>
                      <button
                        className="button button-approve"
                        onClick={() => void handleApprove()}
                        disabled={busyAction !== null}
                        type="button"
                      >
                        {busyAction === "approve"
                          ? "Binding approval…"
                          : "Approve this exact dispatch"}
                      </button>
                    </>
                  ) : null}

                  {state.phase === "approved" ? (
                    <>
                      <p className="approval-live">
                        <span aria-hidden="true" />
                        Human approval active · expires in{" "}
                        <strong>{remainingSeconds}s</strong>
                      </p>
                      <button
                        className="button button-commit"
                        onClick={() => void handleCommit()}
                        disabled={!commitAvailable || busyAction !== null}
                        type="button"
                      >
                        {busyAction === "commit"
                          ? "Executing once…"
                          : commitAvailable
                            ? "Invoke one-time commit tool"
                            : "Registering temporary tool…"}
                      </button>
                    </>
                  ) : null}

                  {state.phase === "committed" && state.committed_dispatch ? (
                    <div className="committed-result" role="status">
                      <span aria-hidden="true">✓</span>
                      <div>
                        <strong>Dispatch committed once</strong>
                        <p>
                          {state.committed_dispatch.dispatch_id} · temporary
                          capability revoked
                        </p>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            )}
          </section>
        </section>

        <aside className="panel capability-panel" aria-label="WebMCP evidence">
          <CapabilityPanel
            tools={tools}
            availability={availability}
            approval={state.approval}
            phase={state.phase}
            remainingSeconds={remainingSeconds}
            error={capabilityError}
          />
          <AuditLog entries={state.audit_log} />
        </aside>
      </div>

      {(runtimeError || state.error_message) && (
        <div className="global-alert" role="alert">
          <strong>{state.error_code ?? "RUNTIME_ERROR"}</strong>
          <span>{runtimeError ?? state.error_message}</span>
          <button
            type="button"
            onClick={() => setRuntimeError(null)}
            aria-label="Dismiss error"
          >
            Dismiss
          </button>
        </div>
      )}

      <p className="data-notice">
        Fictional vehicle, companies, history, pricing, and dispatch only.
      </p>
    </main>
  );
}
