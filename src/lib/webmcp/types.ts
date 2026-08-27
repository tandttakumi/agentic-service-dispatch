export type JsonSchema = Record<string, unknown>;
export type RegisteredJsonSchema = JsonSchema | string;

export interface ToolAnnotations {
  readOnlyHint?: boolean;
  untrustedContentHint?: boolean;
}

export interface ToolExecuteOptions {
  signal: AbortSignal;
}

export interface ToolDefinition {
  name: string;
  title?: string;
  description: string;
  inputSchema?: JsonSchema;
  annotations?: ToolAnnotations;
  execute(
    input: Record<string, unknown>,
    options: ToolExecuteOptions,
  ): unknown | Promise<unknown>;
}

export interface RegisterToolOptions {
  signal?: AbortSignal;
  exposedTo?: string[];
}

export interface RegisteredTool {
  name: string;
  title: string;
  description: string;
  inputSchema?: RegisteredJsonSchema;
  origin?: string;
  window?: Window;
  annotations?: ToolAnnotations;
}

export interface WebMcpAdapter {
  readonly kind: "native" | "test";
  registerTool(
    tool: ToolDefinition,
    options?: RegisterToolOptions,
  ): Promise<void>;
  getTools(): Promise<RegisteredTool[]>;
  executeTool(
    tool: RegisteredTool,
    input: Record<string, unknown>,
    options?: { signal?: AbortSignal },
  ): Promise<unknown>;
  addEventListener(type: "toolchange", listener: EventListener): void;
  removeEventListener(type: "toolchange", listener: EventListener): void;
}

export interface WebMcpToolResult<T> {
  content: Array<{ type: "text"; text: string }>;
  structuredContent: T;
}

export function toolResult<T>(value: T): WebMcpToolResult<T> {
  return {
    content: [{ type: "text", text: JSON.stringify(value) }],
    structuredContent: value,
  };
}
