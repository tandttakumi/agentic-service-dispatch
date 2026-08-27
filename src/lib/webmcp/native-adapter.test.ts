import { describe, expect, it, vi } from "vitest";

import { NativeWebMcpAdapter } from "./native-adapter";
import type { RegisteredTool } from "./types";

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

    await expect(adapter.executeTool(tool, input)).resolves.toBe(input);
    expect(executeTool).toHaveBeenCalledWith(tool, input, undefined);
  });
});
