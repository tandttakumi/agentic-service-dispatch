import { describe, expect, it, vi } from "vitest";

import { DispatchStore } from "@/lib/domain/dispatch-machine";

import { FakeWebMcpAdapter } from "./fake-adapter";
import {
  COMMIT_TOOL_NAME,
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

  it("forwards a later caller abort to the execute callback", async () => {
    const adapter = new FakeWebMcpAdapter();
    let observedSignal: AbortSignal | null = null;
    await adapter.registerTool({
      ...noopTool,
      name: "observe-abort",
      execute: (_input, { signal }) => {
        observedSignal = signal;
        return "observed";
      },
    });
    const tool = (await adapter.getTools())[0];
    const execution = new AbortController();

    await adapter.executeTool(tool, {}, { signal: execution.signal });
    execution.abort();

    expect((observedSignal as AbortSignal | null)?.aborted).toBe(true);
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
          "Certified, within budget, and available before the deadline.",
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
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
