import type {
  RegisteredTool,
  RegisterToolOptions,
  ToolDefinition,
  WebMcpAdapter,
} from "./types";

interface FakeRegistration {
  definition: ToolDefinition;
  abort: () => void;
}

function cloneSchema(
  schema: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  return schema ? JSON.parse(JSON.stringify(schema)) : undefined;
}

export class FakeWebMcpAdapter implements WebMcpAdapter {
  readonly kind = "test" as const;
  private readonly registrations = new Map<string, FakeRegistration>();
  private readonly events = new EventTarget();
  private abortCount = 0;
  private registerCount = 0;

  async registerTool(
    tool: ToolDefinition,
    options: RegisterToolOptions = {},
  ): Promise<void> {
    if (options.signal?.aborted) {
      throw options.signal.reason;
    }
    if (this.registrations.has(tool.name)) {
      throw new DOMException(
        `Tool "${tool.name}" is already registered.`,
        "InvalidStateError",
      );
    }

    const abort = () => {
      const current = this.registrations.get(tool.name);
      if (current?.definition === tool) {
        this.registrations.delete(tool.name);
        this.abortCount += 1;
        this.events.dispatchEvent(new Event("toolchange"));
      }
    };

    options.signal?.addEventListener("abort", abort, { once: true });
    this.registrations.set(tool.name, { definition: tool, abort });
    this.registerCount += 1;
    this.events.dispatchEvent(new Event("toolchange"));
  }

  async getTools(): Promise<RegisteredTool[]> {
    return [...this.registrations.values()]
      .map(({ definition }) => ({
        name: definition.name,
        title: definition.title ?? "",
        description: definition.description,
        inputSchema: cloneSchema(definition.inputSchema),
        origin: "https://webmcp-test.invalid",
        window: globalThis.window,
        annotations: definition.annotations
          ? { ...definition.annotations }
          : undefined,
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  async executeTool(
    tool: RegisteredTool,
    input: Record<string, unknown>,
    options: { signal?: AbortSignal } = {},
  ): Promise<unknown> {
    const registration = this.registrations.get(tool.name);
    if (!registration) {
      throw new DOMException(
        `Tool "${tool.name}" is not registered.`,
        "InvalidStateError",
      );
    }
    const controller = new AbortController();
    if (options.signal) {
      if (options.signal.aborted) {
        controller.abort(options.signal.reason);
      } else {
        options.signal.addEventListener(
          "abort",
          () => controller.abort(options.signal?.reason),
          { once: true },
        );
      }
    }
    return registration.definition.execute(input, {
      signal: controller.signal,
    });
  }

  addEventListener(type: "toolchange", listener: EventListener): void {
    this.events.addEventListener(type, listener);
  }

  removeEventListener(type: "toolchange", listener: EventListener): void {
    this.events.removeEventListener(type, listener);
  }

  getAbortCount(): number {
    return this.abortCount;
  }

  getRegisterCount(): number {
    return this.registerCount;
  }
}

