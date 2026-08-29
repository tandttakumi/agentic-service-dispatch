import type {
  RegisteredTool,
  RegisterToolOptions,
  ToolDefinition,
  WebMcpAdapter,
} from "./types";

const NATIVE_GET_TOOLS_TIMEOUT_MS = 1_000;

export class NativeWebMcpAdapter implements WebMcpAdapter {
  readonly kind = "native" as const;

  constructor(private readonly context: WebMcpModelContext) {}

  registerTool(
    tool: ToolDefinition,
    options?: RegisterToolOptions,
  ): Promise<void> {
    return this.context.registerTool(
      tool as WebMcpModelContextTool,
      options as WebMcpRegisterToolOptions,
    );
  }

  async getTools(): Promise<RegisteredTool[]> {
    let timeout: ReturnType<typeof globalThis.setTimeout> | null = null;
    let tools: unknown;
    try {
      tools = await Promise.race([
        this.context.getTools(),
        new Promise<never>((_resolve, reject) => {
          timeout = globalThis.setTimeout(
            () => reject(new Error("Native WebMCP getTools() timed out.")),
            NATIVE_GET_TOOLS_TIMEOUT_MS,
          );
        }),
      ]);
    } finally {
      if (timeout !== null) {
        globalThis.clearTimeout(timeout);
      }
    }
    if (!Array.isArray(tools)) {
      throw new TypeError("Native WebMCP getTools() must return a tool array.");
    }
    if (
      tools.some(
        (tool) =>
          tool === null ||
          typeof tool !== "object" ||
          typeof (tool as { name?: unknown }).name !== "string" ||
          (tool as { name: string }).name.length === 0,
      )
    ) {
      throw new TypeError(
        "Native WebMCP getTools() must return named tool records.",
      );
    }
    return tools as RegisteredTool[];
  }

  executeTool(
    tool: RegisteredTool,
    input: Record<string, unknown>,
    options?: { signal?: AbortSignal },
  ): Promise<unknown> {
    // Chrome's current testing implementation still exposes string schemas
    // and a DOMString executeTool input. The current specification exposes
    // both as objects. Preserve the standard path while bridging that native
    // implementation without a failing probe call.
    const nativeInput =
      typeof tool.inputSchema === "string" ? JSON.stringify(input) : input;

    return this.context.executeTool(
      tool as WebMcpRegisteredTool,
      nativeInput,
      options,
    );
  }

  addEventListener(type: "toolchange", listener: EventListener): void {
    this.context.addEventListener(type, listener);
  }

  removeEventListener(type: "toolchange", listener: EventListener): void {
    this.context.removeEventListener(type, listener);
  }
}

export function getNativeWebMcpAdapter(
  targetDocument: Document = document,
): NativeWebMcpAdapter | null {
  try {
    const context = targetDocument.modelContext;
    if (
      !context ||
      typeof context.registerTool !== "function" ||
      typeof context.getTools !== "function" ||
      typeof context.executeTool !== "function" ||
      typeof context.addEventListener !== "function" ||
      typeof context.removeEventListener !== "function"
    ) {
      return null;
    }
    return new NativeWebMcpAdapter(context);
  } catch {
    return null;
  }
}
