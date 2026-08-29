import { describe, expect, it, vi } from "vitest";

import { DispatchStore } from "@/lib/domain/dispatch-machine";
import { VEHICLE } from "@/lib/domain/fixtures";

import { FakeWebMcpAdapter } from "./fake-adapter";
import {
  BASE_TOOL_NAMES,
  COMMIT_TOOL_NAME,
  TOOL_SEQUENCE,
  ToolRegistry,
  executeToolSequence,
} from "./tool-registry";
import type {
  RegisterToolOptions,
  ToolDefinition,
} from "./types";

const noopTool: ToolDefinition = {
  name: "noop",
  description: "A no-op test tool.",
  execute: (_input, { signal }) => ({ aborted: signal.aborted }),
};

class FailingAdapter extends FakeWebMcpAdapter {
  constructor(private readonly failedName: string) {
    super();
  }

  override async registerTool(
    tool: ToolDefinition,
    options?: RegisterToolOptions,
  ): Promise<void> {
    if (tool.name === this.failedName) {
      throw new Error(`Rejected ${tool.name}`);
    }
    return super.registerTool(tool, options);
  }
}

class SilentCommitRegistrationAdapter extends FakeWebMcpAdapter {
  override async registerTool(
    tool: ToolDefinition,
    options?: RegisterToolOptions,
  ): Promise<void> {
    if (tool.name === COMMIT_TOOL_NAME) {
      return;
    }
    return super.registerTool(tool, options);
  }
}

describe("WebMCP adapter and registry defensive branches", () => {
  it("rejects pre-aborted and duplicate registrations", async () => {
    const adapter = new FakeWebMcpAdapter();
    const aborted = new AbortController();
    aborted.abort(new Error("cancelled"));

    await expect(
      adapter.registerTool(noopTool, { signal: aborted.signal }),
    ).rejects.toThrow("cancelled");
    await adapter.registerTool(noopTool);
    await expect(adapter.registerTool(noopTool)).rejects.toMatchObject({
      name: "InvalidStateError",
    });
    expect((await adapter.getTools())[0]).toMatchObject({
      name: "noop",
      inputSchema: undefined,
      annotations: undefined,
    });
  });

  it("rejects execution after revocation and forwards execution abort state", async () => {
    const adapter = new FakeWebMcpAdapter();
    const registration = new AbortController();
    await adapter.registerTool(noopTool, { signal: registration.signal });
    const tool = (await adapter.getTools())[0];
    const execution = new AbortController();
    execution.abort("stop");

    await expect(
      adapter.executeTool(tool, {}, { signal: execution.signal }),
    ).resolves.toEqual({ aborted: true });
    registration.abort();
    await expect(adapter.executeTool(tool, {})).rejects.toMatchObject({
      name: "InvalidStateError",
    });
  });

  it("forwards caller abort only while the callback is pending", async () => {
    const adapter = new FakeWebMcpAdapter();
    let observedSignal: AbortSignal | null = null;
    let release: (() => void) | null = null;
    await adapter.registerTool({
      ...noopTool,
      name: "observe-abort",
      execute: async (_input, { signal }) => {
        observedSignal = signal;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return "observed";
      },
    });
    const tool = (await adapter.getTools())[0];
    const execution = new AbortController();

    const pending = adapter.executeTool(tool, {}, { signal: execution.signal });
    execution.abort();
    expect((observedSignal as AbortSignal | null)?.aborted).toBe(true);
    (release as (() => void) | null)?.();
    await expect(pending).resolves.toBe("observed");
  });

  it("detaches caller abort forwarding after callback settlement", async () => {
    const adapter = new FakeWebMcpAdapter();
    let observedSignal: AbortSignal | null = null;
    await adapter.registerTool({
      ...noopTool,
      name: "observe-settlement",
      execute: (_input, { signal }) => {
        observedSignal = signal;
        return "settled";
      },
    });
    const tool = (await adapter.getTools())[0];
    const execution = new AbortController();

    await expect(
      adapter.executeTool(tool, {}, { signal: execution.signal }),
    ).resolves.toBe("settled");
    expect((observedSignal as AbortSignal | null)?.aborted).toBe(false);
    execution.abort();
    expect((observedSignal as AbortSignal | null)?.aborted).toBe(false);
  });

  it("rejects missing capabilities and malformed baseline tool inputs", async () => {
    const adapter = new FakeWebMcpAdapter();
    const store = new DispatchStore();
    const registry = new ToolRegistry(adapter, store);
    await registry.start();

    await expect(registry.executeNamedTool("missing", {})).rejects.toMatchObject({
      code: "CAPABILITY_NOT_AVAILABLE",
    });
    await expect(
      registry.executeNamedTool("get_active_vehicle", { extra: true }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await registry.executeNamedTool("get_active_vehicle", {});
    await expect(
      registry.executeNamedTool("get_service_history", {
        vehicle_id: "vehicle-wrong",
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await registry.executeNamedTool("get_service_history", {
      vehicle_id: "vehicle-001",
    });
    await expect(
      registry.executeNamedTool("search_qualified_providers", {
        service_type: "paint",
        max_price_jpy: 60_000,
        certification_required: true,
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await registry.executeNamedTool("search_qualified_providers", {
      service_type: "ceramic-coating",
      max_price_jpy: 60_000,
      certification_required: true,
    });
    await expect(
      registry.executeNamedTool("check_provider_availability", {
        provider_ids: "not-an-array",
        before: "2026-08-28T00:00:00+09:00",
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await registry.executeNamedTool("check_provider_availability", {
      provider_ids: ["provider-001", "provider-002", "provider-003"],
      before: "2026-08-28T00:00:00+09:00",
    });
    await expect(
      registry.executeNamedTool("create_dispatch_draft", {
        provider_id: "provider-001",
        slot_id: "slot-001",
        quoted_price_jpy: 57_000,
        rationale:
          "Certified, within budget, and can complete before the deadline.",
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("rejects non-object callback inputs with the stable domain error", async () => {
    const adapter = new FakeWebMcpAdapter();
    const registry = new ToolRegistry(adapter, new DispatchStore());
    await registry.start();

    await expect(
      registry.executeNamedTool(
        "get_active_vehicle",
        null as unknown as object,
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      registry.executeNamedTool(
        "get_active_vehicle",
        [] as unknown as object,
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("rejects an oversized sparse provider array before allocating by length", async () => {
    const adapter = new FakeWebMcpAdapter();
    const registry = new ToolRegistry(adapter, new DispatchStore());
    await registry.start();
    for (const step of TOOL_SEQUENCE.slice(0, 3)) {
      await registry.executeNamedTool(step.name, step.input);
    }
    const providerIds: string[] = [];
    providerIds.length = 100_000;
    const allocationTrap = vi
      .spyOn(Array, "from")
      .mockImplementationOnce(() => {
        throw new Error("Unsafe length-based allocation reached");
      });

    try {
      await expect(
        registry.executeNamedTool("check_provider_availability", {
          provider_ids: providerIds,
          before: "2026-08-28T00:00:00+09:00",
        }),
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
      expect(allocationTrap).not.toHaveBeenCalled();
    } finally {
      allocationTrap.mockRestore();
    }
  });

  it.each([
    { prefixLength: 0, attemptedIndex: 1 },
    { prefixLength: 0, attemptedIndex: 2 },
    { prefixLength: 0, attemptedIndex: 3 },
    { prefixLength: 0, attemptedIndex: 4 },
    { prefixLength: 1, attemptedIndex: 2 },
    { prefixLength: 1, attemptedIndex: 3 },
    { prefixLength: 1, attemptedIndex: 4 },
    { prefixLength: 2, attemptedIndex: 3 },
    { prefixLength: 2, attemptedIndex: 4 },
    { prefixLength: 3, attemptedIndex: 4 },
  ])(
    "fails closed for registered tool $attemptedIndex after only $prefixLength prerequisite calls",
    async ({ prefixLength, attemptedIndex }) => {
      const adapter = new FakeWebMcpAdapter();
      const store = new DispatchStore();
      const registry = new ToolRegistry(adapter, store);
      await registry.start();
      for (const step of TOOL_SEQUENCE.slice(0, prefixLength)) {
        await registry.executeNamedTool(step.name, step.input);
      }
      const before = store.getSnapshot();
      const attempted = TOOL_SEQUENCE[attemptedIndex];

      await expect(
        registry.executeNamedTool(attempted.name, attempted.input),
      ).rejects.toMatchObject({ code: "INVALID_TRANSITION" });

      const after = store.getSnapshot();
      expect(after.phase).toBe(before.phase);
      expect(after.revision).toBe(before.revision);
      expect(after.audit_log).toHaveLength(before.audit_log.length);
      expect((await adapter.getTools()).map((tool) => tool.name)).toEqual(
        [...BASE_TOOL_NAMES].sort(),
      );
    },
  );

  it("rejects coercible and accessor-backed callback values without executing them", async () => {
    const adapter = new FakeWebMcpAdapter();
    const registry = new ToolRegistry(adapter, new DispatchStore());
    await registry.start();
    await registry.executeNamedTool("get_active_vehicle", {});

    const coercion = vi.fn(() => "vehicle-001");
    await expect(
      registry.executeNamedTool("get_service_history", {
        vehicle_id: { toString: coercion },
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(coercion).not.toHaveBeenCalled();

    const accessor = vi.fn(() => "vehicle-001");
    const accessorInput = {} as Record<string, unknown>;
    Object.defineProperty(accessorInput, "vehicle_id", {
      enumerable: true,
      get: accessor,
    });
    await expect(
      registry.executeNamedTool("get_service_history", accessorInput),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(accessor).not.toHaveBeenCalled();
  });

  it("detaches structured tool results from fixed domain data", async () => {
    const adapter = new FakeWebMcpAdapter();
    const registry = new ToolRegistry(adapter, new DispatchStore());
    await registry.start();

    const result = (await registry.executeNamedTool(
      "get_active_vehicle",
      {},
    )) as { structuredContent: { vehicle: { name: string } } };
    result.structuredContent.vehicle.name = "Caller mutation";

    expect(VEHICLE.name).toBe("2024 Calystren Veo");
  });

  it("cleans partial base registrations when startup fails", async () => {
    const adapter = new FailingAdapter("search_qualified_providers");
    const registry = new ToolRegistry(adapter, new DispatchStore());

    await expect(registry.start()).rejects.toThrow(
      "Rejected search_qualified_providers",
    );
    expect(await adapter.getTools()).toEqual([]);
  });

  it("rejects an unexpected stale capability instead of claiming a five-tool baseline", async () => {
    const adapter = new FakeWebMcpAdapter();
    await adapter.registerTool(noopTool);
    const registry = new ToolRegistry(adapter, new DispatchStore());

    await expect(registry.start()).rejects.toThrow(
      "Expected exactly the five baseline capabilities",
    );
    expect((await adapter.getTools()).map((tool) => tool.name)).toEqual([
      "noop",
    ]);
  });

  it("removes its store subscription when startup verification fails", async () => {
    const store = new DispatchStore();
    const adapter = new FakeWebMcpAdapter();
    await adapter.registerTool(noopTool);
    const registry = new ToolRegistry(adapter, store);

    await expect(registry.start()).rejects.toMatchObject({
      code: "CAPABILITY_NOT_AVAILABLE",
    });

    const listeners = (
      store as unknown as { listeners: Set<() => void> }
    ).listeners;
    expect(listeners.size).toBe(0);
    expect((await adapter.getTools()).map((tool) => tool.name)).toEqual([
      "noop",
    ]);
  });

  it("invalidates approval if temporary capability registration fails", async () => {
    const adapter = new FailingAdapter(COMMIT_TOOL_NAME);
    const store = new DispatchStore();
    const registry = new ToolRegistry(adapter, store);
    await registry.start();
    await executeToolSequence(registry);

    await store.approveDraft();
    await vi.waitFor(() => {
      expect(store.getSnapshot()).toMatchObject({
        phase: "draft_ready",
        error_code: "CAPABILITY_NOT_AVAILABLE",
        approval: { status: "invalidated" },
      });
    });
    expect((await adapter.getTools()).map((tool) => tool.name)).not.toContain(
      COMMIT_TOOL_NAME,
    );
  });

  it("invalidates approval if temporary registration resolves without a tool", async () => {
    const adapter = new SilentCommitRegistrationAdapter();
    const store = new DispatchStore();
    const registry = new ToolRegistry(adapter, store);
    await registry.start();
    await executeToolSequence(registry);

    await store.approveDraft();
    await vi.waitFor(() => {
      expect(store.getSnapshot()).toMatchObject({
        phase: "draft_ready",
        error_code: "CAPABILITY_NOT_AVAILABLE",
        approval: { status: "invalidated" },
      });
    });
    expect((await adapter.getTools()).map((tool) => tool.name)).toEqual(
      [...BASE_TOOL_NAMES].sort(),
    );
  });

  it("treats repeated start and stopped reset as idempotent", async () => {
    const adapter = new FakeWebMcpAdapter();
    const store = new DispatchStore();
    const registry = new ToolRegistry(adapter, store);

    await registry.start();
    await registry.start();
    expect(adapter.getRegisterCount()).toBe(5);
    await registry.stop();
    await registry.reset();
    expect(await adapter.getTools()).toEqual([]);
    expect(store.getSnapshot().phase).toBe("idle");
  });
});
