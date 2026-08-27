export {};

declare global {
  interface WebMcpToolAnnotations {
    readOnlyHint?: boolean;
    untrustedContentHint?: boolean;
  }

  interface WebMcpToolExecuteOptions {
    signal: AbortSignal;
  }

  interface WebMcpModelContextTool {
    name: string;
    title?: string;
    description: string;
    inputSchema?: Record<string, unknown>;
    annotations?: WebMcpToolAnnotations;
    execute(
      input: Record<string, unknown>,
      options: WebMcpToolExecuteOptions,
    ): unknown | Promise<unknown>;
  }

  interface WebMcpRegisterToolOptions {
    signal?: AbortSignal;
    exposedTo?: string[];
  }

  interface WebMcpRegisteredTool {
    name: string;
    title: string;
    description: string;
    inputSchema?: Record<string, unknown> | string;
    window: Window;
    origin: string;
    annotations?: WebMcpToolAnnotations;
  }

  interface WebMcpModelContext extends EventTarget {
    registerTool(
      tool: WebMcpModelContextTool,
      options?: WebMcpRegisterToolOptions,
    ): Promise<void>;
    getTools(options?: { fromOrigins?: string[] }): Promise<WebMcpRegisteredTool[]>;
    executeTool(
      tool: WebMcpRegisteredTool,
      input: Record<string, unknown> | string,
      options?: { signal?: AbortSignal },
    ): Promise<unknown>;
    ontoolchange: ((event: Event) => void) | null;
  }

  interface Document {
    readonly modelContext?: WebMcpModelContext;
  }

  interface Window {
    __WEBMCP_TEST_MODE__?: boolean;
  }
}
