import { describe, expect, it, vi } from "vitest";

import { DispatchStore } from "@/lib/domain/dispatch-machine";

import {
  NativeWebMcpAdapter,
  getNativeWebMcpAdapter,
} from "./native-adapter";
import {
  BASE_TOOL_NAMES,
  COMMIT_TOOL_NAME,
  ToolRegistry,
  executeToolSequence,
} from "./tool-registry";
import type { RegisteredTool, ToolDefinition } from "./types";

function createContext(
  executeTool: WebMcpModelContext["executeTool"],
): WebMcpModelContext {
  const target = new EventTarget();
  return Object.assign(target, {
    registerTool: vi.fn(),
    getTools: vi.fn(),
    executeTool,
    ontoolchange: null,
  });
}

function registeredTool(inputSchema: RegisteredTool["inputSchema"]): RegisteredTool {
  return {
    name: "get_active_vehicle",
    title: "Get active vehicle",
    description: "Return the active vehicle.",
    inputSchema,
  };
}

describe("NativeWebMcpAdapter", () => {
  it("delegates registration, discovery, and toolchange subscription", async () => {
    const context = createContext(vi.fn());
    const adapter = new NativeWebMcpAdapter(context);
    const controller = new AbortController();
    const definition: ToolDefinition = {
      name: "get_active_vehicle",
      description: "Return the active vehicle.",
      inputSchema: { type: "object", properties: {} },
      execute: () => ({ ok: true }),
    };
    const tools = [registeredTool(definition.inputSchema)];
    vi.mocked(context.registerTool).mockResolvedValue(undefined);
    vi.mocked(context.getTools).mockResolvedValue(
      tools as WebMcpRegisteredTool[],
    );

    await adapter.registerTool(definition, { signal: controller.signal });
    await expect(adapter.getTools()).resolves.toBe(tools);
    expect(context.registerTool).toHaveBeenCalledWith(definition, {
      signal: controller.signal,
    });

    const listener = vi.fn();
    adapter.addEventListener("toolchange", listener);
    context.dispatchEvent(new Event("toolchange"));
    expect(listener).toHaveBeenCalledTimes(1);
    adapter.removeEventListener("toolchange", listener);
    context.dispatchEvent(new Event("toolchange"));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed native registry results", async () => {
    const context = createContext(vi.fn());
    const adapter = new NativeWebMcpAdapter(context);

    vi.mocked(context.getTools).mockResolvedValueOnce(
      null as unknown as WebMcpRegisteredTool[],
    );
    await expect(adapter.getTools()).rejects.toThrow(/tool array/i);
    vi.mocked(context.getTools).mockResolvedValueOnce([
      null as unknown as WebMcpRegisteredTool,
    ]);
    await expect(adapter.getTools()).rejects.toThrow(/named tool records/i);
  });

  it("fails closed when a native registry read never settles", async () => {
    vi.useFakeTimers();
    const context = createContext(vi.fn());
    const adapter = new NativeWebMcpAdapter(context);
    vi.mocked(context.getTools).mockImplementation(
      () => new Promise<WebMcpRegisteredTool[]>(() => undefined),
    );

    try {
      const outcome = Promise.race([
        adapter.getTools().then(
          () => "resolved",
          () => "rejected",
        ),
        new Promise<string>((resolve) => {
          globalThis.setTimeout(() => resolve("still-pending"), 1_001);
        }),
      ]);
      await vi.advanceTimersByTimeAsync(1_001);

      await expect(outcome).resolves.toBe("rejected");
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("requires a complete, non-throwing native surface", () => {
    const context = createContext(vi.fn());
    const throwingDocument = {} as Document;
    Object.defineProperty(throwingDocument, "modelContext", {
      get: () => {
        throw new Error("Experimental API getter failed.");
      },
    });

    expect(
      getNativeWebMcpAdapter({ modelContext: context } as Document),
    ).toBeInstanceOf(NativeWebMcpAdapter);
    expect(
      getNativeWebMcpAdapter({ modelContext: {} } as unknown as Document),
    ).toBeNull();
    expect(() => getNativeWebMcpAdapter(throwingDocument)).not.toThrow();
    expect(getNativeWebMcpAdapter(throwingDocument)).toBeNull();
  });

  it("serializes input for the current Chrome DOMString bridge", async () => {
    const executeTool = vi.fn(async (_tool, input) => {
      expect(typeof input).toBe("string");
      return JSON.parse(input as string);
    });
    const adapter = new NativeWebMcpAdapter(createContext(executeTool));
    const tool = registeredTool(
      JSON.stringify({ type: "object", properties: {} }),
    );

    await expect(adapter.executeTool(tool, {})).resolves.toEqual({});
    expect(executeTool).toHaveBeenCalledWith(tool, "{}", undefined);
  });

  it("keeps object input for implementations aligned with the current spec", async () => {
    const executeTool = vi.fn(async (_tool, input) => input);
    const adapter = new NativeWebMcpAdapter(createContext(executeTool));
    const tool = registeredTool({ type: "object", properties: {} });
    const input = { vehicle_id: "vehicle-001" };
    const controller = new AbortController();

    await expect(
      adapter.executeTool(tool, input, { signal: controller.signal }),
    ).resolves.toBe(input);
    expect(executeTool).toHaveBeenCalledWith(tool, input, {
      signal: controller.signal,
    });
  });

  it("completes 5 to 6 to 5 through the Chrome string-schema input bridge", async () => {
    const target = new EventTarget();
    const definitions = new Map<string, ToolDefinition>();
    const context = Object.assign(target, {
      ontoolchange: null,
      async registerTool(
        definition: WebMcpModelContextTool,
        options: WebMcpRegisterToolOptions = {},
      ) {
        const tool = definition as ToolDefinition;
        definitions.set(tool.name, tool);
        options.signal?.addEventListener(
          "abort",
          () => {
            if (definitions.get(tool.name) === tool) {
              definitions.delete(tool.name);
              target.dispatchEvent(new Event("toolchange"));
            }
          },
          { once: true },
        );
        target.dispatchEvent(new Event("toolchange"));
      },
      async getTools() {
        return [...definitions.values()].map((definition) => ({
          name: definition.name,
          title: definition.title ?? "",
          description: definition.description,
          inputSchema: JSON.stringify(definition.inputSchema),
          origin: "https://native-bridge.test",
          window,
          annotations: definition.annotations,
        }));
      },
      async executeTool(
        tool: WebMcpRegisteredTool,
        input: Record<string, unknown> | string,
        options: { signal?: AbortSignal } = {},
      ) {
        expect(typeof input).toBe("string");
        const definition = definitions.get(tool.name)!;
        return definition.execute(JSON.parse(input as string), {
          signal: options.signal ?? new AbortController().signal,
        });
      },
    }) as WebMcpModelContext;
    const adapter = new NativeWebMcpAdapter(context);
    const store = new DispatchStore();
    const registry = new ToolRegistry(adapter, store);

    await registry.start();
    expect((await adapter.getTools()).map((tool) => tool.name).sort()).toEqual(
      [...BASE_TOOL_NAMES].sort(),
    );
    await executeToolSequence(registry);
    const approval = await store.approveDraft();
    await vi.waitFor(async () => {
      expect((await adapter.getTools()).map((tool) => tool.name)).toContain(
        COMMIT_TOOL_NAME,
      );
    });
    await registry.executeNamedTool(COMMIT_TOOL_NAME, {
      approval_id: approval.approval_id,
    });
    await vi.waitFor(async () => {
      expect((await adapter.getTools()).map((tool) => tool.name).sort()).toEqual(
        [...BASE_TOOL_NAMES].sort(),
      );
    });
    expect(store.getSnapshot().phase).toBe("committed");
    await registry.stop();
  });
});
