import {
  DRAFT_INPUT,
  PROVIDERS,
  REQUEST_CONDITIONS,
  VEHICLE,
} from "@/lib/domain/fixtures";
import { DispatchStore } from "@/lib/domain/dispatch-machine";
import {
  DispatchDomainError,
  type CreateDraftInput,
} from "@/lib/domain/types";

import type {
  RegisteredTool,
  ToolDefinition,
  WebMcpAdapter,
} from "./types";
import { toolResult } from "./types";

export const BASE_TOOL_NAMES = [
  "get_active_vehicle",
  "get_service_history",
  "search_qualified_providers",
  "check_provider_availability",
  "create_dispatch_draft",
] as const;

export const COMMIT_TOOL_NAME = "commit_approved_dispatch";

const VERIFICATION_READ_RETRY_DELAYS_MS = [25, 50] as const;
const SERVICE_TYPE = "ceramic-coating";

function abortReason(signal: AbortSignal): unknown {
  return (
    signal.reason ??
    new DOMException("WebMCP operation was cancelled.", "AbortError")
  );
}

function waitForOperationOrAbort<T>(
  operation: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!signal) {
    return operation;
  }
  if (signal.aborted) {
    return Promise.reject(abortReason(signal));
  }

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortReason(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function waitForRetryDelay(
  delayMs: number,
  signal?: AbortSignal,
): Promise<void> {
  if (!signal) {
    return new Promise<void>((resolve) => {
      globalThis.setTimeout(resolve, delayMs);
    });
  }
  if (signal.aborted) {
    return Promise.reject(abortReason(signal));
  }

  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      globalThis.clearTimeout(timer);
      reject(abortReason(signal));
    };
    const timer = globalThis.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function combineAbortSignals(
  first?: AbortSignal,
  second?: AbortSignal,
): { signal?: AbortSignal; cleanup: () => void } {
  if (!first) {
    return { signal: second, cleanup: () => undefined };
  }
  if (!second || first === second) {
    return { signal: first, cleanup: () => undefined };
  }

  const controller = new AbortController();
  const abortFrom = (signal: AbortSignal) => {
    if (!controller.signal.aborted) {
      controller.abort(abortReason(signal));
    }
  };
  const onFirstAbort = () => abortFrom(first);
  const onSecondAbort = () => abortFrom(second);
  const cleanup = () => {
    first.removeEventListener("abort", onFirstAbort);
    second.removeEventListener("abort", onSecondAbort);
  };

  if (first.aborted) {
    abortFrom(first);
  } else if (second.aborted) {
    abortFrom(second);
  } else {
    first.addEventListener("abort", onFirstAbort, { once: true });
    second.addEventListener("abort", onSecondAbort, { once: true });
  }

  return { signal: controller.signal, cleanup };
}

function assertRecord(
  input: Record<string, unknown>,
  keys: string[],
): void {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new DispatchDomainError(
      "INVALID_INPUT",
      "Tool input must be a JSON object.",
    );
  }
  const prototype = Object.getPrototypeOf(input);
  if (
    (prototype !== Object.prototype && prototype !== null) ||
    Object.getOwnPropertySymbols(input).length > 0
  ) {
    throw new DispatchDomainError(
      "INVALID_INPUT",
      "Tool input must be a plain JSON object.",
    );
  }
  const actual = Object.getOwnPropertyNames(input).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index]) ||
    actual.some((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      return !descriptor || !("value" in descriptor) || !descriptor.enumerable;
    })
  ) {
    throw new DispatchDomainError(
      "INVALID_INPUT",
      `Expected only: ${expected.join(", ") || "no properties"}.`,
    );
  }
}

function assertJsonStringArray(
  value: unknown,
  fieldName: string,
  expectedLength: number,
): asserts value is string[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    throw new DispatchDomainError(
      "INVALID_INPUT",
      `${fieldName} must be a plain JSON string array.`,
    );
  }
  if (value.length !== expectedLength) {
    throw new DispatchDomainError(
      "INVALID_INPUT",
      `${fieldName} must contain exactly ${expectedLength} items.`,
    );
  }
  const actualKeys = Object.getOwnPropertyNames(value).sort();
  const expectedKeys = [
    ...Array.from({ length: value.length }, (_, index) => String(index)),
    "length",
  ].sort();
  if (
    Object.getOwnPropertySymbols(value).length > 0 ||
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, index) => key !== expectedKeys[index]) ||
    Array.from({ length: value.length }, (_, index) => index).some((index) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, index);
      return (
        !descriptor ||
        !("value" in descriptor) ||
        typeof descriptor.value !== "string"
      );
    })
  ) {
    throw new DispatchDomainError(
      "INVALID_INPUT",
      `${fieldName} must contain only dense string data properties.`,
    );
  }
}

function baseToolDefinitions(store: DispatchStore): ToolDefinition[] {
  return [
    {
      name: "get_active_vehicle",
      title: "Get active vehicle",
      description:
        "Start here. Return the active fictional vehicle and its exact dispatch constraints.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute: (input) => {
        assertRecord(input, []);
        return toolResult(store.loadVehicleContext());
      },
    },
    {
      name: "get_service_history",
      title: "Get service history",
      description:
        "After get_active_vehicle, review past service and finish-repair notes before selecting a provider.",
      inputSchema: {
        type: "object",
        properties: {
          vehicle_id: { type: "string", const: VEHICLE.id },
        },
        required: ["vehicle_id"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute: (input) => {
        assertRecord(input, ["vehicle_id"]);
        if (typeof input.vehicle_id !== "string") {
          throw new DispatchDomainError(
            "INVALID_INPUT",
            "vehicle_id must be a string.",
          );
        }
        return toolResult(
          store.reviewServiceHistory(input.vehicle_id),
        );
      },
    },
    {
      name: "search_qualified_providers",
      title: "Search qualified providers",
      description:
        "After get_service_history, compare all three fictional providers and explain every match or exclusion.",
      inputSchema: {
        type: "object",
        properties: {
          service_type: { type: "string", const: SERVICE_TYPE },
          max_price_jpy: {
            type: "integer",
            const: REQUEST_CONDITIONS.max_price_jpy,
          },
          certification_required: {
            type: "boolean",
            const: REQUEST_CONDITIONS.certification_required,
          },
        },
        required: [
          "service_type",
          "max_price_jpy",
          "certification_required",
        ],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute: (input) => {
        assertRecord(input, [
          "service_type",
          "max_price_jpy",
          "certification_required",
        ]);
        if (
          input.service_type !== SERVICE_TYPE ||
          input.max_price_jpy !== REQUEST_CONDITIONS.max_price_jpy ||
          input.certification_required !==
            REQUEST_CONDITIONS.certification_required
        ) {
          throw new DispatchDomainError(
            "INVALID_INPUT",
            "Provider search arguments must match the active request.",
          );
        }
        return toolResult(store.compareProviders());
      },
    },
    {
      name: "check_provider_availability",
      title: "Check provider availability",
      description:
        "After search_qualified_providers, check those providers against the exact Friday deadline.",
      inputSchema: {
        type: "object",
        properties: {
          provider_ids: {
            type: "array",
            const: PROVIDERS.map((provider) => provider.id),
            items: { type: "string" },
          },
          before: {
            type: "string",
            const: REQUEST_CONDITIONS.completion_before,
          },
        },
        required: ["provider_ids", "before"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute: (input) => {
        assertRecord(input, ["provider_ids", "before"]);
        assertJsonStringArray(
          input.provider_ids,
          "provider_ids",
          PROVIDERS.length,
        );
        if (typeof input.before !== "string") {
          throw new DispatchDomainError(
            "INVALID_INPUT",
            "before must be a string.",
          );
        }
        return toolResult(
          store.checkAvailability(
            input.provider_ids,
            input.before,
          ),
        );
      },
    },
    {
      name: "create_dispatch_draft",
      title: "Create dispatch draft",
      description:
        "After availability is checked, stage the exact qualified dispatch in the UI. This does not submit it.",
      inputSchema: {
        type: "object",
        properties: {
          provider_id: { type: "string", const: DRAFT_INPUT.provider_id },
          slot_id: { type: "string", const: DRAFT_INPUT.slot_id },
          quoted_price_jpy: {
            type: "integer",
            const: DRAFT_INPUT.quoted_price_jpy,
          },
          rationale: {
            type: "string",
            const: DRAFT_INPUT.rationale,
          },
        },
        required: [
          "provider_id",
          "slot_id",
          "quoted_price_jpy",
          "rationale",
        ],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false },
      execute: (input) => {
        assertRecord(input, [
          "provider_id",
          "slot_id",
          "quoted_price_jpy",
          "rationale",
        ]);
        const draftInput = {
          provider_id: input.provider_id,
          slot_id: input.slot_id,
          quoted_price_jpy: input.quoted_price_jpy,
          rationale: input.rationale,
        } as CreateDraftInput;
        return toolResult(store.createDraft(draftInput));
      },
    },
  ];
}

function commitToolDefinition(
  store: DispatchStore,
  approvalId: string,
  generation: number,
  registrationSignal: AbortSignal,
  waitForRegistrationVerification: (
    signal?: AbortSignal,
  ) => Promise<void>,
  verifyExecutionCapabilitySurface: (
    signal?: AbortSignal,
  ) => Promise<void>,
  onCommitted: () => void,
  onRejected: () => Promise<void>,
): ToolDefinition {
  return {
    name: COMMIT_TOOL_NAME,
    title: "Commit approved dispatch",
    description:
      "Available only after human approval. Commit that one exact dispatch once; no dispatch fields are accepted.",
    inputSchema: {
      type: "object",
      properties: {
        approval_id: {
          type: "string",
          const: approvalId,
        },
      },
      required: ["approval_id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false },
    execute: async (input, options) => {
      const execution = combineAbortSignals(
        options?.signal,
        registrationSignal,
      );
      try {
        assertRecord(input, ["approval_id"]);
        if (input.approval_id !== approvalId) {
          throw new DispatchDomainError(
            "APPROVAL_NOT_FOUND",
            "The supplied approval ID does not match this temporary capability.",
          );
        }
        if (store.expireApprovalIfNeeded()) {
          const state = store.getSnapshot();
          throw new DispatchDomainError(
            state.error_code ?? "CAPABILITY_NOT_AVAILABLE",
            state.error_message ??
              "The approval is no longer valid for this temporary capability.",
          );
        }
        await waitForRegistrationVerification(execution.signal);
        await verifyExecutionCapabilitySurface(execution.signal);
        const committed = await store.commitApprovedDispatch(
          approvalId,
          generation,
          execution.signal,
        );
        onCommitted();
        return toolResult(committed);
      } catch (error) {
        await onRejected();
        throw error;
      } finally {
        execution.cleanup();
      }
    },
  };
}

export class ToolRegistry {
  private readonly baseControllers = new Map<string, AbortController>();
  private temporaryController: AbortController | null = null;
  private temporaryGeneration: number | null = null;
  private pendingTemporaryController: AbortController | null = null;
  private pendingTemporaryGeneration: number | null = null;
  private temporaryRevocationTimer: ReturnType<
    typeof globalThis.setTimeout
  > | null = null;
  private revocationVerificationController: AbortController | null = null;
  private unsubscribeStore: (() => void) | null = null;
  private serial: Promise<void> = Promise.resolve();
  private desiredStarted = false;
  private started = false;
  private suppressStoreSync = false;
  private lifecycleEpoch = 0;
  private ownedLifecycleFailureToken: number | null = null;

  constructor(
    readonly adapter: WebMcpAdapter,
    readonly store: DispatchStore,
  ) {}

  private enqueue(task: () => Promise<void>): Promise<void> {
    const run = this.serial.then(task, task);
    this.serial = run.catch(() => undefined);
    return run;
  }

  private enqueueBackground(task: () => Promise<void>): void {
    const lifecycleEpoch = this.lifecycleEpoch;
    void this.enqueue(async () => {
      if (lifecycleEpoch !== this.lifecycleEpoch) {
        return;
      }
      await task();
    }).catch((error) => {
      if (lifecycleEpoch !== this.lifecycleEpoch) {
        return;
      }
      this.ownedLifecycleFailureToken =
        this.store.recordCapabilityLifecycleFailure(
          error instanceof Error
            ? error.message
            : "WebMCP capability lifecycle verification failed.",
        );
    });
  }

  start(): Promise<void> {
    this.desiredStarted = true;
    return this.enqueue(async () => {
      if (!this.desiredStarted || this.started) {
        return;
      }
      const recoverableFailure =
        this.store.getRecoverableCapabilityLifecycleFailureToken();

      try {
        for (const definition of baseToolDefinitions(this.store)) {
          const controller = new AbortController();
          this.baseControllers.set(definition.name, controller);
          await waitForOperationOrAbort(
            this.adapter.registerTool(definition, {
              signal: controller.signal,
            }),
            controller.signal,
          );
          if (!this.desiredStarted) {
            this.abortBaseControllers();
            return;
          }
        }
        if (!this.desiredStarted) {
          this.abortBaseControllers();
          return;
        }

        this.started = true;
        this.unsubscribeStore = this.store.subscribe(() => {
          if (this.suppressStoreSync) {
            return;
          }
          this.store.expireApprovalIfNeeded();
          const current = this.store.getSnapshot();
          if (
            this.pendingTemporaryController &&
            (current.phase !== "approved" ||
              current.approval?.status !== "approved" ||
              current.approval.generation !==
                this.pendingTemporaryGeneration)
          ) {
            this.abortPendingTemporaryController();
          }
          this.enqueueBackground(() => this.syncTemporaryCapability());
        });
        await this.verifyBaselineCapabilities();
        if (!this.desiredStarted) {
          return;
        }
        this.store.recordBaselineCapabilitiesVerified();
        await this.syncTemporaryCapability();
        await this.clearRecoveredLifecycleFailureAfterProof(
          recoverableFailure,
        );
      } catch (error) {
        this.unsubscribeStore?.();
        this.unsubscribeStore = null;
        this.abortTemporaryController();
        this.abortBaseControllers();
        this.started = false;
        throw error;
      }
    });
  }

  stop(): Promise<void> {
    this.desiredStarted = false;
    this.abortPendingTemporaryController();
    if (!this.started) {
      this.abortBaseControllers();
    }
    return this.enqueue(async () => {
      if (this.desiredStarted) {
        return;
      }
      this.unsubscribeStore?.();
      this.unsubscribeStore = null;
      this.abortTemporaryController();
      this.abortBaseControllers();
      this.started = false;
      this.store.markCapabilityLifecycleFailureRecoverable(
        this.ownedLifecycleFailureToken,
      );
      this.ownedLifecycleFailureToken = null;
    });
  }

  reset(): Promise<void> {
    this.lifecycleEpoch += 1;
    this.abortRevocationVerification();
    this.abortPendingTemporaryController();
    this.suppressStoreSync = true;
    try {
      this.store.reset();
    } finally {
      this.suppressStoreSync = false;
    }
    return this.enqueue(async () => {
      if (this.temporaryController && this.temporaryGeneration !== null) {
        this.abortTemporaryController();
      }
      if (this.started) {
        await this.verifyBaselineCapabilities();
        this.store.recordBaselineCapabilitiesVerified();
      }
    });
  }

  async executeNamedTool(
    name: string,
    input: object,
  ): Promise<unknown> {
    const tool = await this.readNamedTool(name);
    return this.adapter.executeTool(tool, input as Record<string, unknown>);
  }

  private async readNamedTool(
    name: string,
    attempt = 0,
  ): Promise<RegisteredTool> {
    try {
      const tool = findTool(await this.adapter.getTools(), name);
      if (!tool) {
        throw new DispatchDomainError(
          "CAPABILITY_NOT_AVAILABLE",
          `WebMCP capability "${name}" is not available.`,
        );
      }
      return tool;
    } catch (error) {
      const delay = VERIFICATION_READ_RETRY_DELAYS_MS[attempt];
      if (delay === undefined) {
        throw error;
      }
      await new Promise<void>((resolve) => globalThis.setTimeout(resolve, delay));
      return this.readNamedTool(name, attempt + 1);
    }
  }

  private async verifyBaselineCapabilities(
    signal?: AbortSignal,
  ): Promise<void> {
    const expected = [...BASE_TOOL_NAMES].sort();
    await this.verifyCapabilityNames(
      expected,
      (names) =>
        new DispatchDomainError(
          "CAPABILITY_NOT_AVAILABLE",
          `Expected exactly the five baseline capabilities; received: ${names.join(", ") || "none"}.`,
        ),
      signal,
    );
  }

  private async verifyTemporaryCapabilities(
    signal?: AbortSignal,
  ): Promise<void> {
    const expected = [...BASE_TOOL_NAMES, COMMIT_TOOL_NAME].sort();
    await this.verifyCapabilityNames(
      expected,
      (names) =>
        new DispatchDomainError(
          "CAPABILITY_NOT_AVAILABLE",
          `Expected the five baseline capabilities and one temporary commit capability; received: ${names.join(", ") || "none"}.`,
        ),
      signal,
    );
  }

  private async clearRecoveredLifecycleFailureAfterProof(
    token: number | null,
  ): Promise<void> {
    if (token === null || !this.started || !this.desiredStarted) {
      return;
    }

    this.store.expireApprovalIfNeeded();
    const before = this.store.getSnapshot();
    const expectedTemporary =
      before.phase === "approved" &&
      before.approval?.status === "approved";
    const expectedGeneration = expectedTemporary
      ? before.approval?.generation ?? null
      : null;

    if (
      (!expectedTemporary && this.temporaryController) ||
      (expectedTemporary &&
        (!this.temporaryController ||
          this.temporaryGeneration !== expectedGeneration))
    ) {
      return;
    }

    if (expectedTemporary) {
      await this.verifyTemporaryCapabilities();
    } else {
      await this.verifyBaselineCapabilities();
    }

    if (!this.started || !this.desiredStarted) {
      return;
    }

    this.store.expireApprovalIfNeeded();
    const after = this.store.getSnapshot();
    const stillExpectsTemporary =
      after.phase === "approved" &&
      after.approval?.status === "approved";
    const currentGeneration = stillExpectsTemporary
      ? after.approval?.generation ?? null
      : null;

    if (
      stillExpectsTemporary !== expectedTemporary ||
      currentGeneration !== expectedGeneration ||
      (stillExpectsTemporary &&
        (!this.temporaryController ||
          this.temporaryGeneration !== currentGeneration))
    ) {
      return;
    }

    this.store.clearCapabilityLifecycleFailure(token);
  }

  private async verifyCapabilityNames(
    expected: string[],
    createMismatchError: (names: string[]) => Error,
    signal?: AbortSignal,
    attempt = 0,
  ): Promise<void> {
    if (signal?.aborted) {
      throw abortReason(signal);
    }
    try {
      const names = (
        await waitForOperationOrAbort(this.adapter.getTools(), signal)
      )
        .map((tool) => tool.name)
        .sort();
      if (
        names.length !== expected.length ||
        names.some((name, index) => name !== expected[index])
      ) {
        throw createMismatchError(names);
      }
    } catch (error) {
      if (signal?.aborted) {
        throw abortReason(signal);
      }
      const delay = VERIFICATION_READ_RETRY_DELAYS_MS[attempt];
      if (delay === undefined) {
        throw error;
      }
      await waitForRetryDelay(delay, signal);
      await this.verifyCapabilityNames(
        expected,
        createMismatchError,
        signal,
        attempt + 1,
      );
    }
  }

  private abortBaseControllers(): void {
    for (const controller of this.baseControllers.values()) {
      controller.abort();
    }
    this.baseControllers.clear();
  }

  private abortTemporaryController(): void {
    if (this.temporaryRevocationTimer !== null) {
      globalThis.clearTimeout(this.temporaryRevocationTimer);
      this.temporaryRevocationTimer = null;
    }
    this.temporaryController?.abort();
    this.temporaryController = null;
    this.temporaryGeneration = null;
  }

  private abortPendingTemporaryController(): void {
    this.pendingTemporaryController?.abort();
    this.pendingTemporaryController = null;
    this.pendingTemporaryGeneration = null;
  }

  private abortRevocationVerification(): void {
    this.revocationVerificationController?.abort();
    this.revocationVerificationController = null;
  }

  private scheduleUsedCapabilityRevocation(): void {
    if (this.temporaryRevocationTimer !== null) {
      return;
    }
    const lifecycleEpoch = this.lifecycleEpoch;

    // Affected Chrome builds reject a pending executeTool() with UnknownError
    // if its tool is unregistered before the successful callback result
    // crosses the native boundary. Revoke after that result has settled.
    this.temporaryRevocationTimer = globalThis.setTimeout(() => {
      this.temporaryRevocationTimer = null;
      if (lifecycleEpoch !== this.lifecycleEpoch) {
        return;
      }
      this.enqueueBackground(() =>
        this.revokeTemporaryCapability("used", lifecycleEpoch),
      );
    }, 0);
  }

  private async revokeTemporaryCapability(
    reason: "used" | "expired" | "changed",
    lifecycleEpoch = this.lifecycleEpoch,
  ): Promise<void> {
    if (!this.temporaryController || this.temporaryGeneration === null) {
      return;
    }
    const generation = this.temporaryGeneration;
    this.abortTemporaryController();
    const verificationController = new AbortController();
    this.revocationVerificationController = verificationController;
    try {
      await this.verifyCapabilityNames(
        [...BASE_TOOL_NAMES].sort(),
        () =>
          new DispatchDomainError(
            "CAPABILITY_NOT_AVAILABLE",
            "The temporary commit capability did not revoke.",
          ),
        verificationController.signal,
      );
    } finally {
      if (this.revocationVerificationController === verificationController) {
        this.revocationVerificationController = null;
      }
    }
    if (lifecycleEpoch !== this.lifecycleEpoch) {
      return;
    }
    this.store.markTemporaryCapabilityRevoked(generation, reason);
  }

  private async syncTemporaryCapability(): Promise<void> {
    if (!this.started) {
      return;
    }
    const lifecycleEpoch = this.lifecycleEpoch;

    this.store.expireApprovalIfNeeded();
    const state = this.store.getSnapshot();
    const approval = state.approval;
    const shouldExist =
      state.phase === "approved" &&
      approval?.status === "approved";

    if (!shouldExist || !approval) {
      if (this.temporaryController) {
        const reason =
          approval?.status === "expired"
            ? "expired"
            : approval?.status === "invalidated"
              ? "changed"
              : state.phase === "committed"
                ? "used"
                : "changed";
        if (reason === "used") {
          this.scheduleUsedCapabilityRevocation();
          return;
        }
        await this.revokeTemporaryCapability(reason, lifecycleEpoch);
      }
      return;
    }

    if (
      this.temporaryController &&
      this.temporaryGeneration === approval.generation
    ) {
      return;
    }
    if (this.temporaryController) {
      await this.revokeTemporaryCapability("changed", lifecycleEpoch);
    }

    const controller = new AbortController();
    const generation = approval.generation;
    let verificationError: Error | null = null;
    let verificationSettled = false;
    let releaseVerification!: () => void;
    const verification = new Promise<void>((resolve) => {
      releaseVerification = resolve;
    });
    const settleVerification = (error: Error | null = null) => {
      if (verificationSettled) return;
      verificationSettled = true;
      verificationError = error;
      releaseVerification();
    };
    const waitForRegistrationVerification = async (
      signal?: AbortSignal,
    ) => {
      await waitForOperationOrAbort(verification, signal);
      if (verificationError) throw verificationError;
    };
    const definition = commitToolDefinition(
      this.store,
      approval.approval_id,
      generation,
      controller.signal,
      waitForRegistrationVerification,
      (signal) => this.verifyTemporaryCapabilities(signal),
      () => this.scheduleUsedCapabilityRevocation(),
      () => this.enqueue(() => this.syncTemporaryCapability()),
    );
    this.pendingTemporaryController = controller;
    this.pendingTemporaryGeneration = generation;

    try {
      await waitForOperationOrAbort(
        this.adapter.registerTool(definition, {
          signal: controller.signal,
        }),
        controller.signal,
      );
      await this.verifyTemporaryCapabilities(controller.signal);
      settleVerification();
    } catch (error) {
      const failure =
        error instanceof Error
          ? error
          : new Error("Temporary capability registration failed.");
      settleVerification(failure);
      const wasCancelled = controller.signal.aborted;
      controller.abort();
      if (!wasCancelled) {
        this.store.invalidateApprovalAfterRegistrationFailure(
          generation,
          failure.message,
        );
      } else if (this.desiredStarted && this.started) {
        this.enqueueBackground(() => this.syncTemporaryCapability());
      }
      return;
    } finally {
      if (this.pendingTemporaryController === controller) {
        this.pendingTemporaryController = null;
        this.pendingTemporaryGeneration = null;
      }
    }

    this.store.expireApprovalIfNeeded();
    const current = this.store.getSnapshot();
    if (
      !this.started ||
      !this.desiredStarted ||
      controller.signal.aborted ||
      current.phase !== "approved" ||
      current.approval?.generation !== generation ||
      current.approval.status !== "approved"
    ) {
      controller.abort();
      return;
    }

    this.temporaryController = controller;
    this.temporaryGeneration = generation;
    this.store.markTemporaryCapabilityRegistered(generation);
  }
}

export const TOOL_SEQUENCE = [
  { name: "get_active_vehicle", input: {} },
  {
    name: "get_service_history",
    input: { vehicle_id: VEHICLE.id },
  },
  {
    name: "search_qualified_providers",
    input: {
      service_type: SERVICE_TYPE,
      max_price_jpy: REQUEST_CONDITIONS.max_price_jpy,
      certification_required: REQUEST_CONDITIONS.certification_required,
    },
  },
  {
    name: "check_provider_availability",
    input: {
      provider_ids: PROVIDERS.map((provider) => provider.id),
      before: REQUEST_CONDITIONS.completion_before,
    },
  },
  {
    name: "create_dispatch_draft",
    input: DRAFT_INPUT,
  },
] as const;

export async function executeToolSequence(
  registry: ToolRegistry,
): Promise<void> {
  for (const step of TOOL_SEQUENCE) {
    await registry.executeNamedTool(step.name, step.input);
  }
}

export function findTool(
  tools: RegisteredTool[],
  name: string,
): RegisteredTool | undefined {
  return tools.find((tool) => tool.name === name);
}
