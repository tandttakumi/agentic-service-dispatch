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
  BASE_TOOL_NAMES,
  COMMIT_TOOL_NAME,
  ToolRegistry,
  executeToolSequence,
} from "@/lib/webmcp/tool-registry";
import type { RegisteredTool, WebMcpAdapter } from "@/lib/webmcp/types";

import { AuditLog } from "./audit-log";
import { CapabilityPanel } from "./capability-panel";
import { ProviderComparison } from "./provider-comparison";

const DEMO_PROMPT =
  "Find a qualified detailer for this vehicle who can complete the job before Friday for under ¥60,000. Check its previous service history and draft the job. Don't submit anything until I approve.";

interface DispatchDemoProps {
  adapterFactory?: () => WebMcpAdapter | null;
  storeFactory?: () => DispatchStore;
}

type Availability = "checking" | "unavailable" | "native" | "test" | "error";
type RuntimeAction =
  | "startup"
  | "run"
  | "approve"
  | "commit"
  | "reset"
  | "copy";

interface RuntimeFailure {
  action: RuntimeAction;
  code: string;
  message: string;
}

interface AlertPresentation {
  code: string;
  headline: string;
  message: string;
}

function formatYen(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

const REGISTRY_SHAPE_ERROR =
  "Unexpected WebMCP registry shape. Authority actions are disabled.";
const SHAPE_RETRY_DELAYS_MS = [25, 50] as const;

function runtimeFailure(
  action: RuntimeAction,
  cause: unknown,
  fallback: string,
): RuntimeFailure {
  return {
    action,
    code:
      cause instanceof DispatchDomainError ? cause.code : "RUNTIME_ERROR",
    message: cause instanceof Error ? cause.message : fallback,
  };
}

function presentAlert(
  failure: RuntimeFailure | null,
  phase: string,
  stateCode: string | null,
  stateMessage: string | null,
): AlertPresentation | null {
  const code = failure?.code ?? stateCode;
  const message = failure?.message ?? stateMessage;
  if (!code || !message) {
    return null;
  }

  if (phase === "committed" && failure?.action === "commit") {
    return {
      code,
      headline: "Commit succeeded — verify the registry",
      message: `The domain committed, but the browser call reported an error. Confirm the registry returned to five; otherwise stop and Reset. ${message}`,
    };
  }
  if (
    phase === "committed" &&
    !failure &&
    code === "CAPABILITY_NOT_AVAILABLE"
  ) {
    return {
      code,
      headline: "Commit succeeded — revocation unverified",
      message: `Stop and Reset before continuing. ${message}`,
    };
  }
  if (failure?.action === "commit") {
    return {
      code,
      headline: "Commit blocked",
      message: `${message} The page did not confirm a commit; verify the registry before retrying.`,
    };
  }
  if (failure?.action === "startup") {
    return { code, headline: "WebMCP unavailable", message };
  }
  if (failure?.action === "reset") {
    return {
      code,
      headline: "Reset did not settle",
      message: `${message} Stop before continuing.`,
    };
  }
  if (failure?.action === "run") {
    return {
      code,
      headline: "Preparation stopped",
      message: `${message} Reset before running the full sequence again.`,
    };
  }
  if (failure?.action === "approve") {
    return {
      code,
      headline: "Approval blocked",
      message: `${message} Do not assume tool 06 exists; verify the registry before retrying.`,
    };
  }
  if (failure?.action === "copy") {
    return { code, headline: "Copy failed", message };
  }
  if (code === "CAPABILITY_NOT_AVAILABLE") {
    return {
      code,
      headline: "Commit authority blocked",
      message: `${message} Reset and retry only after the registry is healthy.`,
    };
  }
  if (code === "APPROVAL_EXPIRED") {
    return { code, headline: "Approval expired", message };
  }
  if (code === "DRAFT_CHANGED_AFTER_APPROVAL") {
    return {
      code,
      headline: "Approval revoked",
      message: `${message} Review the exact draft and approve again.`,
    };
  }
  return { code, headline: "Action blocked", message };
}

function hasExpectedCapabilityShape(
  tools: RegisteredTool[],
  expectTemporary: boolean,
): boolean {
  const names = new Set(tools.map((tool) => tool.name));
  const expectedCount = BASE_TOOL_NAMES.length + (expectTemporary ? 1 : 0);
  return (
    tools.length === expectedCount &&
    names.size === tools.length &&
    BASE_TOOL_NAMES.every((name) => names.has(name)) &&
    names.has(COMMIT_TOOL_NAME) === expectTemporary
  );
}

function useCapabilities(
  adapter: WebMcpAdapter | null,
  expectTemporary: boolean,
  refreshKey: number,
) {
  const [tools, setTools] = useState<RegisteredTool[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [hasSnapshot, setHasSnapshot] = useState(false);
  const capabilityReadRef = useRef<{
    adapter: WebMcpAdapter;
    promise: Promise<RegisteredTool[]>;
  } | null>(null);

  useEffect(() => {
    if (!adapter) {
      return;
    }

    let active = true;
    let mounted = true;
    let refreshGeneration = 0;
    let retryTimer: number | null = null;
    let readInFlight = false;
    let trailingAttempt: number | null = null;

    const readCapabilities = (): Promise<RegisteredTool[]> => {
      const current = capabilityReadRef.current;
      if (current?.adapter === adapter) {
        return current.promise;
      }

      const promise = Promise.resolve().then(() => adapter.getTools());
      const entry = { adapter, promise };
      capabilityReadRef.current = entry;
      const release = () => {
        if (capabilityReadRef.current === entry) {
          capabilityReadRef.current = null;
        }
      };
      void promise.then(release, release);
      return promise;
    };

    const runRefresh = async (attempt = 0) => {
      readInFlight = true;
      const generation = ++refreshGeneration;
      try {
        const next = await readCapabilities();
        if (active && generation === refreshGeneration) {
          if (hasExpectedCapabilityShape(next, expectTemporary)) {
            setTools(next);
            setError(null);
            setHasSnapshot(true);
          } else {
            setTools([]);
            setHasSnapshot(false);
            const delay = SHAPE_RETRY_DELAYS_MS[attempt];
            if (delay === undefined) {
              setError(REGISTRY_SHAPE_ERROR);
            } else {
              setError(null);
              retryTimer = window.setTimeout(() => {
                retryTimer = null;
                requestRefresh(attempt + 1);
              }, delay);
            }
          }
        }
      } catch (cause) {
        if (active && generation === refreshGeneration) {
          setTools([]);
          setHasSnapshot(false);
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not read the WebMCP tool surface.",
          );
          if (attempt < 2) {
            retryTimer = window.setTimeout(() => {
              retryTimer = null;
              requestRefresh(attempt + 1);
            }, 250 * (attempt + 1));
          }
        }
      } finally {
        readInFlight = false;
        if (active && trailingAttempt !== null) {
          const nextAttempt = trailingAttempt;
          trailingAttempt = null;
          if (retryTimer !== null) {
            window.clearTimeout(retryTimer);
            retryTimer = null;
          }
          requestRefresh(nextAttempt);
        }
      }
    };
    const requestRefresh = (attempt = 0) => {
      if (!active) {
        return;
      }
      if (retryTimer !== null) {
        window.clearTimeout(retryTimer);
        retryTimer = null;
      }
      if (readInFlight) {
        trailingAttempt =
          trailingAttempt === null
            ? attempt
            : Math.min(trailingAttempt, attempt);
        return;
      }
      void runRefresh(attempt);
    };
    const onToolChange: EventListener = () => {
      if (!active) {
        return;
      }
      requestRefresh();
    };

    try {
      adapter.addEventListener("toolchange", onToolChange);
    } catch (cause) {
      active = false;
      const message =
        cause instanceof Error
          ? cause.message
          : "Could not subscribe to WebMCP tool changes.";
      queueMicrotask(() => {
        if (!mounted) {
          return;
        }
        setTools([]);
        setHasSnapshot(false);
        setError(message);
      });
      return () => {
        mounted = false;
        try {
          adapter.removeEventListener("toolchange", onToolChange);
        } catch {
          // A partial experimental subscription may also reject cleanup.
        }
      };
    }
    requestRefresh();
    return () => {
      active = false;
      mounted = false;
      trailingAttempt = null;
      if (retryTimer !== null) {
        window.clearTimeout(retryTimer);
      }
      try {
        adapter.removeEventListener("toolchange", onToolChange);
      } catch {
        // Experimental cleanup failures must not escape React unmount.
      }
    };
  }, [adapter, expectTemporary, refreshKey]);

  return { tools, error, hasSnapshot };
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
  const [runtimeError, setRuntimeError] = useState<RuntimeFailure | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [capabilityRefreshKey, setCapabilityRefreshKey] = useState(0);
  const expectsTemporaryCapability =
    state.phase === "approved" && state.approval?.status === "approved";
  const {
    tools,
    error: capabilityError,
    hasSnapshot: hasCapabilitySnapshot,
  } = useCapabilities(
    adapter,
    expectsTemporaryCapability,
    capabilityRefreshKey,
  );

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
        setCapabilityRefreshKey((key) => key + 1);
      })
      .catch((cause) => {
        if (!active) return;
        setAvailability("error");
        setRuntimeError(
          runtimeFailure(
            "startup",
            cause,
            "WebMCP registration failed.",
          ),
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

  const withAction = async (
    name: RuntimeAction,
    action: () => Promise<void>,
  ) => {
    if (actionInFlightRef.current) {
      return;
    }
    actionInFlightRef.current = true;
    setBusyAction(name);
    setRuntimeError(null);
    try {
      await action();
    } catch (cause) {
      setRuntimeError(
        runtimeFailure(name, cause, "The requested action failed."),
      );
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
      setCapabilityRefreshKey((key) => key + 1);
      setRemainingSeconds(0);
    });

  const handleCopy = async () => {
    try {
      try {
        await navigator.clipboard.writeText(DEMO_PROMPT);
      } catch {
        const textArea = document.createElement("textarea");
        textArea.value = DEMO_PROMPT;
        textArea.setAttribute("readonly", "");
        textArea.style.position = "fixed";
        textArea.style.opacity = "0";
        document.body.appendChild(textArea);
        try {
          textArea.select();
          if (!document.execCommand("copy")) {
            throw new Error("The demo prompt could not be copied.");
          }
        } finally {
          textArea.remove();
        }
      }
    } catch (cause) {
      setCopied(false);
      setRuntimeError(
        runtimeFailure(
          "copy",
          cause,
          "The demo prompt could not be copied.",
        ),
      );
      return;
    }
    setRuntimeError(null);
    setCopied(true);
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopied(false), 1_500);
  };

  const toolNames = new Set(tools.map((tool) => tool.name));
  const isWebMcpReady = availability === "native" || availability === "test";
  const commitVisible = toolNames.has(COMMIT_TOOL_NAME);
  const expectedCount =
    BASE_TOOL_NAMES.length + (expectsTemporaryCapability ? 1 : 0);
  const registryShapeValid =
    tools.length === expectedCount &&
    toolNames.size === tools.length &&
    BASE_TOOL_NAMES.every((name) => toolNames.has(name)) &&
    commitVisible === expectsTemporaryCapability;
  const registryShapeError =
    isWebMcpReady &&
    hasCapabilitySnapshot &&
    capabilityError === null &&
    !registryShapeValid
      ? REGISTRY_SHAPE_ERROR
      : null;
  const alert = presentAlert(
    runtimeError,
    state.phase,
    state.error_code,
    state.error_message,
  );
  const registryVerified =
    isWebMcpReady &&
    hasCapabilitySnapshot &&
    capabilityError === null &&
    registryShapeError === null;
  const commitAvailable = registryVerified && commitVisible;
  const lifecycleStep = !registryVerified
    ? null
    : commitAvailable
      ? "approve"
      : state.phase === "committed"
        ? "consume"
        : "prepare";
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

        <div
          className="thesis"
          aria-label="Capability lifecycle: 5 prepare, 6 approve, 5 consume"
        >
          <p>Approval creates the sixth tool. One use removes it.</p>
          <ol className="lifecycle-rail">
            <li
              className={lifecycleStep === "prepare" ? "is-current" : ""}
              aria-current={lifecycleStep === "prepare" ? "step" : undefined}
            >
              <strong>5</strong><span>PREPARE</span>
            </li>
            <li aria-hidden="true">→</li>
            <li
              className={lifecycleStep === "approve" ? "is-current" : ""}
              aria-current={lifecycleStep === "approve" ? "step" : undefined}
            >
              <strong>6</strong><span>APPROVE</span>
            </li>
            <li aria-hidden="true">→</li>
            <li
              className={lifecycleStep === "consume" ? "is-current" : ""}
              aria-current={lifecycleStep === "consume" ? "step" : undefined}
            >
              <strong>5</strong><span>CONSUME</span>
            </li>
          </ol>
        </div>

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
            <p id="prompt-heading">Live WebMCP runner</p>
            <span>DETERMINISTIC · INVOKES REGISTERED TOOLS</span>
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
              !registryVerified ||
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
                        No commit capability is registered. Approval will create
                        one for this hash only.
                      </p>
                      <button
                        className="button button-approve"
                        onClick={() => void handleApprove()}
                        disabled={!registryVerified || busyAction !== null}
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
                        {commitAvailable
                          ? "Approval created tool 06"
                          : "Approval bound · tool 06 not yet verified"}{" "}
                        · expires in{" "}
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
                        <strong>One exact action committed</strong>
                        <p>
                          {state.committed_dispatch.dispatch_id} · {registryVerified && !commitVisible
                            ? "temporary capability revoked"
                            : "revocation pending verification"}
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
            hasSnapshot={hasCapabilitySnapshot}
            error={capabilityError}
            shapeError={registryShapeError}
          />
          <AuditLog entries={state.audit_log} />
        </aside>
      </div>

      {alert && (
        <div className="global-alert" role="alert">
          <div className="global-alert-heading">
            <strong>{alert.headline}</strong>
            <span className="global-alert-code">{alert.code}</span>
          </div>
          <span className="global-alert-message">{alert.message}</span>
          {runtimeError ? (
            <button
              type="button"
              onClick={() => setRuntimeError(null)}
              aria-label="Dismiss error"
            >
              Dismiss
            </button>
          ) : null}
        </div>
      )}

      <p className="data-notice">
        Frozen Aug 27, 2026 scenario · fictional vehicle, companies, history,
        pricing, and dispatch.
      </p>
    </main>
  );
}
