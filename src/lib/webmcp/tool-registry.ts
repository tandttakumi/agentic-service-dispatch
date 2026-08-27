import { DRAFT_INPUT, PROVIDERS, REQUEST_CONDITIONS } from "@/lib/domain/fixtures";
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

function assertRecord(
  input: Record<string, unknown>,
  keys: string[],
): void {
  const actual = Object.keys(input).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new DispatchDomainError(
      "INVALID_INPUT",
      `Expected only: ${expected.join(", ") || "no properties"}.`,
    );
  }
}

function baseToolDefinitions(store: DispatchStore): ToolDefinition[] {
  return [
    {
      name: "get_active_vehicle",
      title: "Get active vehicle",
      description:
        "Return the active fictional vehicle and its exact dispatch constraints.",
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
        "Review past service and finish-repair notes before selecting a provider.",
      inputSchema: {
        type: "object",
        properties: {
          vehicle_id: { type: "string", const: "vehicle-001" },
        },
        required: ["vehicle_id"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute: (input) => {
        assertRecord(input, ["vehicle_id"]);
        return toolResult(
          store.reviewServiceHistory(String(input.vehicle_id)),
        );
      },
    },
    {
      name: "search_qualified_providers",
      title: "Search qualified providers",
      description:
        "Compare all three fictional providers and explain every match or exclusion.",
      inputSchema: {
        type: "object",
        properties: {
          service_type: { type: "string", const: "ceramic-coating" },
          max_price_jpy: { type: "integer", const: 60000 },
          certification_required: { type: "boolean", const: true },
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
          input.service_type !== "ceramic-coating" ||
          input.max_price_jpy !== 60_000 ||
          input.certification_required !== true
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
        "Check the compared providers against the exact Friday deadline.",
      inputSchema: {
        type: "object",
        properties: {
          provider_ids: {
            type: "array",
            const: ["provider-001", "provider-002", "provider-003"],
            items: { type: "string" },
          },
          before: {
            type: "string",
            const: "2026-08-28T00:00:00+09:00",
          },
        },
        required: ["provider_ids", "before"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute: (input) => {
        assertRecord(input, ["provider_ids", "before"]);
        if (!Array.isArray(input.provider_ids)) {
          throw new DispatchDomainError(
            "INVALID_INPUT",
            "provider_ids must be an array.",
          );
        }
        return toolResult(
          store.checkAvailability(
            input.provider_ids.map(String),
            String(input.before),
          ),
        );
      },
    },
    {
      name: "create_dispatch_draft",
      title: "Create dispatch draft",
      description:
        "Stage the exact qualified dispatch in the UI without submitting it.",
      inputSchema: {
        type: "object",
        properties: {
          provider_id: { type: "string", const: "provider-001" },
          slot_id: { type: "string", const: "slot-001" },
          quoted_price_jpy: { type: "integer", const: 58000 },
          rationale: {
            type: "string",
            const:
              "Certified, within budget, and available before the deadline.",
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
  onCommitted: () => void,
  onRejected: () => Promise<void>,
): ToolDefinition {
  return {
    name: COMMIT_TOOL_NAME,
    title: "Commit approved dispatch",
    description:
      "Commit the one exact dispatch approved by the human. One-time use; no dispatch fields are accepted.",
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
    execute: async (input) => {
      try {
        assertRecord(input, ["approval_id"]);
        if (input.approval_id !== approvalId) {
          throw new DispatchDomainError(
            "APPROVAL_NOT_FOUND",
            "The supplied approval ID does not match this temporary capability.",
          );
        }
        const committed = await store.commitApprovedDispatch(
          approvalId,
          generation,
        );
        onCommitted();
        return toolResult(committed);
      } catch (error) {
        await onRejected();
        throw error;
      }
    },
  };
}

export class ToolRegistry {
  private readonly baseControllers = new Map<string, AbortController>();
  private temporaryController: AbortController | null = null;
  private temporaryGeneration: number | null = null;
  private temporaryRevocationTimer: ReturnType<
    typeof globalThis.setTimeout
  > | null = null;
  private unsubscribeStore: (() => void) | null = null;
  private serial: Promise<void> = Promise.resolve();
  private desiredStarted = false;
  private started = false;

  constructor(
    readonly adapter: WebMcpAdapter,
    readonly store: DispatchStore,
  ) {}

  private enqueue(task: () => Promise<void>): Promise<void> {
    const run = this.serial.then(task, task);
    this.serial = run.catch(() => undefined);
    return run;
  }

  start(): Promise<void> {
    this.desiredStarted = true;
    return this.enqueue(async () => {
      if (!this.desiredStarted || this.started) {
        return;
      }

      try {
        for (const definition of baseToolDefinitions(this.store)) {
          const controller = new AbortController();
          this.baseControllers.set(definition.name, controller);
          await this.adapter.registerTool(definition, {
            signal: controller.signal,
          });
        }
        if (!this.desiredStarted) {
          this.abortBaseControllers();
          return;
        }

        this.started = true;
        this.unsubscribeStore = this.store.subscribe(() => {
          void this.enqueue(() => this.syncTemporaryCapability());
        });
        await this.verifyBaselineCapabilities();
        this.store.recordBaselineCapabilitiesVerified();
        await this.syncTemporaryCapability();
      } catch (error) {
        this.abortBaseControllers();
        this.started = false;
        throw error;
      }
    });
  }

  stop(): Promise<void> {
    this.desiredStarted = false;
    return this.enqueue(async () => {
      if (this.desiredStarted) {
        return;
      }
      this.unsubscribeStore?.();
      this.unsubscribeStore = null;
      this.abortTemporaryController();
      this.abortBaseControllers();
      this.started = false;
    });
  }

  reset(): Promise<void> {
    return this.enqueue(async () => {
      if (this.temporaryController && this.temporaryGeneration !== null) {
        const generation = this.temporaryGeneration;
        this.abortTemporaryController();
        this.store.markTemporaryCapabilityRevoked(generation, "reset");
      }
      this.store.reset();
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
    const tools = await this.adapter.getTools();
    const tool = tools.find((item) => item.name === name);
    if (!tool) {
      throw new DispatchDomainError(
        "CAPABILITY_NOT_AVAILABLE",
        `WebMCP capability "${name}" is not available.`,
      );
    }
    return this.adapter.executeTool(tool, input as Record<string, unknown>);
  }

  private async verifyBaselineCapabilities(): Promise<void> {
    const names = (await this.adapter.getTools())
      .map((tool) => tool.name)
      .sort();
    const expected = [...BASE_TOOL_NAMES].sort();
    if (
      names.length !== expected.length ||
      names.some((name, index) => name !== expected[index])
    ) {
      throw new DispatchDomainError(
        "CAPABILITY_NOT_AVAILABLE",
        `Expected exactly the five baseline capabilities; received: ${names.join(", ") || "none"}.`,
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

  private scheduleUsedCapabilityRevocation(): void {
    if (this.temporaryRevocationTimer !== null) {
      return;
    }

    // Affected Chrome builds reject a pending executeTool() with UnknownError
    // if its tool is unregistered before the successful callback result
    // crosses the native boundary. Revoke after that result has settled.
    this.temporaryRevocationTimer = globalThis.setTimeout(() => {
      this.temporaryRevocationTimer = null;
      void this.enqueue(() => this.revokeTemporaryCapability("used"));
    }, 0);
  }

  private async revokeTemporaryCapability(
    reason: "used" | "expired" | "changed",
  ): Promise<void> {
    if (!this.temporaryController || this.temporaryGeneration === null) {
      return;
    }
    const generation = this.temporaryGeneration;
    this.abortTemporaryController();
    const names = (await this.adapter.getTools()).map((tool) => tool.name);
    if (names.includes(COMMIT_TOOL_NAME)) {
      throw new DispatchDomainError(
        "CAPABILITY_NOT_AVAILABLE",
        "The temporary commit capability did not revoke.",
      );
    }
    this.store.markTemporaryCapabilityRevoked(generation, reason);
  }

  private async syncTemporaryCapability(): Promise<void> {
    if (!this.started) {
      return;
    }

    const state = this.store.getSnapshot();
    const approval = state.approval;
    const shouldExist =
      state.phase === "approved" &&
      approval?.status === "approved" &&
      !this.store.expireApprovalIfNeeded();

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
        await this.revokeTemporaryCapability(reason);
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
      await this.revokeTemporaryCapability("changed");
    }

    const controller = new AbortController();
    const generation = approval.generation;
    const definition = commitToolDefinition(
      this.store,
      approval.approval_id,
      generation,
      () => this.scheduleUsedCapabilityRevocation(),
      () => this.enqueue(() => this.syncTemporaryCapability()),
    );

    try {
      await this.adapter.registerTool(definition, {
        signal: controller.signal,
      });
    } catch (error) {
      controller.abort();
      this.store.invalidateApprovalAfterRegistrationFailure(
        generation,
        error instanceof Error
          ? error.message
          : "Temporary capability registration failed.",
      );
      return;
    }

    const current = this.store.getSnapshot();
    if (
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
    input: { vehicle_id: "vehicle-001" },
  },
  {
    name: "search_qualified_providers",
    input: {
      service_type: "ceramic-coating",
      max_price_jpy: REQUEST_CONDITIONS.max_price_jpy,
      certification_required: true,
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
