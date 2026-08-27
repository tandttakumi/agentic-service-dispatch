import type {
  RegisteredTool,
  RegisterToolOptions,
  ToolDefinition,
  WebMcpAdapter,
} from "./types";

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
    return (await this.context.getTools()) as RegisteredTool[];
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
  const context = targetDocument.modelContext;
  return context ? new NativeWebMcpAdapter(context) : null;
}
