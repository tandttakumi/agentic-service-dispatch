import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { DispatchStore } from "@/lib/domain/dispatch-machine";
import type { Clock } from "@/lib/domain/types";
import { FakeWebMcpAdapter } from "@/lib/webmcp/fake-adapter";
import { BASE_TOOL_NAMES, COMMIT_TOOL_NAME } from "@/lib/webmcp/tool-registry";
import type { ToolDefinition, WebMcpAdapter } from "@/lib/webmcp/types";

import { DispatchDemo } from "./dispatch-demo";

class OutOfOrderReadAdapter extends FakeWebMcpAdapter {
  private firstRead = true;
  private releaseFirstRead: (() => void) | null = null;

  override async getTools() {
    const snapshot = await super.getTools();
    if (this.firstRead) {
      this.firstRead = false;
      await new Promise<void>((resolve) => {
        this.releaseFirstRead = resolve;
      });
    }
    return snapshot;
  }

  releaseStaleRead(): void {
    this.releaseFirstRead?.();
  }
}

class BlockingExecutionAdapter extends FakeWebMcpAdapter {
  executionCount = 0;
  private releaseFirstExecution: (() => void) | null = null;

  override async executeTool(
    ...parameters: Parameters<FakeWebMcpAdapter["executeTool"]>
  ): Promise<unknown> {
    this.executionCount += 1;
    if (this.executionCount === 1) {
      await new Promise<void>((resolve) => {
        this.releaseFirstExecution = resolve;
      });
    }
    return super.executeTool(...parameters);
  }

  releaseExecution(): void {
    this.releaseFirstExecution?.();
  }
}

class CommitExecutionFailureAdapter extends FakeWebMcpAdapter {
  constructor(private readonly failAfterDomainCommit: boolean) {
    super();
  }

  override async executeTool(
    ...parameters: Parameters<FakeWebMcpAdapter["executeTool"]>
  ): Promise<unknown> {
    const [tool] = parameters;
    if (tool.name !== COMMIT_TOOL_NAME) {
      return super.executeTool(...parameters);
    }
    if (!this.failAfterDomainCommit) {
      throw new DOMException("Browser rejected the invocation.", "UnknownError");
    }
    await super.executeTool(...parameters);
    throw new DOMException(
      "Browser settlement failed after callback completion.",
      "UnknownError",
    );
  }
}

class PreparationFailureAdapter extends FakeWebMcpAdapter {
  override async executeTool(
    ...parameters: Parameters<FakeWebMcpAdapter["executeTool"]>
  ): Promise<unknown> {
    if (parameters[0].name === "search_qualified_providers") {
      throw new DOMException(
        "Browser rejected the provider-search invocation.",
        "UnknownError",
      );
    }
    return super.executeTool(...parameters);
  }
}

class ReadFailureAdapter extends FakeWebMcpAdapter {
  private shouldFail = false;

  failReads(): void {
    this.shouldFail = true;
  }

  recoverReads(): void {
    this.shouldFail = false;
  }

  override async getTools() {
    if (this.shouldFail) {
      throw new Error("Registry read failed.");
    }
    return super.getTools();
  }
}

class TransientReadFailureAdapter extends FakeWebMcpAdapter {
  private failuresRemaining = 0;
  private readonly observedListeners = new Set<EventListener>();
  readCount = 0;

  override async getTools() {
    this.readCount += 1;
    if (this.failuresRemaining > 0) {
      this.failuresRemaining -= 1;
      throw new Error("Transient registry read failed.");
    }
    return super.getTools();
  }

  override addEventListener(type: "toolchange", listener: EventListener): void {
    this.observedListeners.add(listener);
    super.addEventListener(type, listener);
  }

  override removeEventListener(
    type: "toolchange",
    listener: EventListener,
  ): void {
    this.observedListeners.delete(listener);
    super.removeEventListener(type, listener);
  }

  failAndNotify(attempts = 1): void {
    this.failuresRemaining = attempts;
    for (const listener of this.observedListeners) {
      listener(new Event("toolchange"));
    }
  }

  recoverWithoutNotification(): void {
    this.failuresRemaining = 0;
  }
}

class SlowSilentRegistrationAdapter extends FakeWebMcpAdapter {
  override async registerTool(
    ...parameters: Parameters<FakeWebMcpAdapter["registerTool"]>
  ): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 45));
    await super.registerTool(...parameters);
  }

  override addEventListener(): void {
    // Reproduce a host that completes registration without a UI notification.
  }

  override removeEventListener(): void {
    // No listener was installed by this diagnostic adapter.
  }
}

class WellFormedStaleSnapshotAdapter extends FakeWebMcpAdapter {
  private readonly observedListeners = new Set<EventListener>();
  private staleSnapshot: Awaited<
    ReturnType<FakeWebMcpAdapter["getTools"]>
  > | null = null;
  readCount = 0;

  override async getTools() {
    this.readCount += 1;
    if (this.staleSnapshot) {
      const snapshot = this.staleSnapshot;
      this.staleSnapshot = null;
      return snapshot;
    }
    return super.getTools();
  }

  override addEventListener(type: "toolchange", listener: EventListener): void {
    this.observedListeners.add(listener);
    super.addEventListener(type, listener);
  }

  override removeEventListener(
    type: "toolchange",
    listener: EventListener,
  ): void {
    this.observedListeners.delete(listener);
    super.removeEventListener(type, listener);
  }

  emitStaleSnapshot(
    snapshot: Awaited<ReturnType<FakeWebMcpAdapter["getTools"]>>,
  ): void {
    this.staleSnapshot = snapshot;
    for (const listener of this.observedListeners) {
      listener(new Event("toolchange"));
    }
  }
}

class PausedRefreshAdapter extends FakeWebMcpAdapter {
  private readonly observedListeners = new Set<EventListener>();
  private releaseRead: (() => void) | null = null;
  private announceRead: (() => void) | null = null;
  private pauseNextRead = false;
  private activeReads = 0;
  readCount = 0;
  maxConcurrentReads = 0;
  pausedReadStarted: Promise<void> = Promise.resolve();

  armPausedRead(): void {
    this.pauseNextRead = true;
    this.pausedReadStarted = new Promise<void>((resolve) => {
      this.announceRead = resolve;
    });
  }

  override async getTools() {
    this.readCount += 1;
    this.activeReads += 1;
    this.maxConcurrentReads = Math.max(
      this.maxConcurrentReads,
      this.activeReads,
    );
    try {
      const tools = await super.getTools();
      if (this.pauseNextRead) {
        this.pauseNextRead = false;
        this.announceRead?.();
        await new Promise<void>((resolve) => {
          this.releaseRead = resolve;
        });
      }
      return tools;
    } finally {
      this.activeReads -= 1;
    }
  }

  override addEventListener(type: "toolchange", listener: EventListener): void {
    this.observedListeners.add(listener);
    super.addEventListener(type, listener);
  }

  override removeEventListener(
    type: "toolchange",
    listener: EventListener,
  ): void {
    this.observedListeners.delete(listener);
    super.removeEventListener(type, listener);
  }

  emitToolchangeStorm(count: number): void {
    for (let index = 0; index < count; index += 1) {
      for (const listener of this.observedListeners) {
        listener(new Event("toolchange"));
      }
    }
  }

  releasePausedRead(): void {
    this.releaseRead?.();
  }

  resetReadStats(): void {
    this.readCount = 0;
    this.maxConcurrentReads = this.activeReads;
  }

  getListenerCount(): number {
    return this.observedListeners.size;
  }
}

class StickyCommitAdapter extends FakeWebMcpAdapter {
  private lastCommitTool: Awaited<
    ReturnType<FakeWebMcpAdapter["getTools"]>
  >[number] | null = null;

  override async getTools() {
    const tools = await super.getTools();
    const commitTool = tools.find((tool) => tool.name === COMMIT_TOOL_NAME);
    if (commitTool) {
      this.lastCommitTool = commitTool;
      return tools;
    }
    return this.lastCommitTool ? [...tools, this.lastCommitTool] : tools;
  }
}

class PartialSubscriptionFailureAdapter extends FakeWebMcpAdapter {
  listenerPresent = false;

  override addEventListener(
    type: "toolchange",
    listener: EventListener,
  ): void {
    super.addEventListener(type, listener);
    this.listenerPresent = true;
    throw new Error("Toolchange subscription denied after registration");
  }

  override removeEventListener(
    type: "toolchange",
    listener: EventListener,
  ): void {
    super.removeEventListener(type, listener);
    this.listenerPresent = false;
  }
}

const foreignTool: ToolDefinition = {
  name: "foreign_tool",
  description: "Test-only registry change.",
  execute: () => ({ ok: true }),
};

function withNativeKind(adapter: FakeWebMcpAdapter): WebMcpAdapter {
  return {
    kind: "native",
    registerTool: (tool, options) => adapter.registerTool(tool, options),
    getTools: () => adapter.getTools(),
    executeTool: (tool, input, options) =>
      adapter.executeTool(tool, input, options),
    addEventListener: (type, listener) =>
      adapter.addEventListener(type, listener),
    removeEventListener: (type, listener) =>
      adapter.removeEventListener(type, listener),
  };
}

async function renderSupported(
  store = new DispatchStore(),
  reportedKind: "test" | "native" = "test",
  adapter: FakeWebMcpAdapter = new FakeWebMcpAdapter(),
) {
  const user = userEvent.setup();
  render(
    <DispatchDemo
      adapterFactory={() =>
        reportedKind === "native" ? withNativeKind(adapter) : adapter
      }
      storeFactory={() => store}
    />,
  );
  if (reportedKind === "native") {
    await screen.findByText("Native WebMCP available");
    expect(
      await screen.findByText("await document.modelContext.getTools()"),
    ).toBeVisible();
    expect(
      screen.queryByText(/Fetched from the injected test harness via/),
    ).not.toBeInTheDocument();
  } else {
    await screen.findByText("WebMCP test adapter");
    expect(
      screen.getByText(/Fetched from the injected test harness via/),
    ).toBeVisible();
    expect(
      screen.queryByText("await document.modelContext.getTools()"),
    ).not.toBeInTheDocument();
  }
  await waitFor(async () => {
    expect(await adapter.getTools()).toHaveLength(5);
  });
  return { adapter, store, user };
}

describe("DispatchDemo", () => {
  it("shows an honest unsupported-browser fallback", async () => {
    render(<DispatchDemo adapterFactory={() => null} />);

    expect(
      await screen.findByText(
        "Native WebMCP is unavailable in this browser.",
      ),
    ).toBeVisible();
    expect(screen.getByText("No tool registration is being simulated.")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Run live 5-tool sequence" }),
    ).toBeDisabled();
  });

  it("renders native source attribution, a draft, and its approval control", async () => {
    const { user } = await renderSupported(
      new DispatchStore(),
      "native",
      new SlowSilentRegistrationAdapter(),
    );
    expect(screen.getByText("Provider decision pending")).toBeVisible();
    expect(screen.queryByText("MATCH")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Run live 5-tool sequence" }));

    expect(await screen.findByText("DRAFT — NOT SUBMITTED")).toBeVisible();
    expect(screen.getByRole("heading", { name: /Kairo Detail Works.*D-1042/ })).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Approve this exact dispatch" }),
    ).toBeEnabled();
    expect(screen.getByText("Service history reviewed")).toBeVisible();
    expect(screen.getByText("Three providers evaluated")).toBeVisible();
  });

  it("shows countdown, commits once, revokes the tool, and updates audit", async () => {
    const { adapter, user } = await renderSupported();
    expect(
      screen.getByText(
        "WebMCP registry verified: 5 tools. Commit capability absent.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("PREPARE").closest("li")).toHaveAttribute(
      "aria-current",
      "step",
    );
    await user.click(screen.getByRole("button", { name: "Run live 5-tool sequence" }));
    await user.click(
      await screen.findByRole("button", {
        name: "Approve this exact dispatch",
      }),
    );

    const commitButton = await screen.findByRole("button", {
      name: "Invoke one-time commit tool",
    });
    expect(screen.getByTestId("temporary-tool")).toBeVisible();
    expect(
      screen.getByText(
        "WebMCP registry verified: 6 tools. Human approval created the one-time commit capability.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("APPROVE").closest("li")).toHaveAttribute(
      "aria-current",
      "step",
    );
    expect(screen.getByText(/Approval created tool 06.*expires in/)).toBeVisible();
    expect(
      (await adapter.getTools()).map((tool) => tool.name),
    ).toContain(COMMIT_TOOL_NAME);

    await user.click(commitButton);

    expect(await screen.findByText("One exact action committed")).toBeVisible();
    expect(
      await screen.findByText(
        "WebMCP registry verified: 5 tools. One-time commit capability revoked after use.",
      ),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("commit_approved_dispatch revoked"),
    ).toBeVisible();
    expect(screen.getByText("CONSUME").closest("li")).toHaveAttribute(
      "aria-current",
      "step",
    );
    await waitFor(async () => {
      expect((await adapter.getTools()).map((tool) => tool.name)).toEqual(
        [...BASE_TOOL_NAMES].sort(),
      );
    });
    expect(
      screen.getByText("Approved dispatch committed through tool"),
    ).toBeVisible();
    expect(
      screen.getByText("Temporary capability revoked after one exact action"),
    ).toBeVisible();
  });

  it("does not claim physical revocation while commit remains in getTools", async () => {
    const adapter = new StickyCommitAdapter();
    const user = userEvent.setup();
    render(<DispatchDemo adapterFactory={() => adapter} />);
    await screen.findByText("WebMCP test adapter");
    await user.click(
      await screen.findByRole("button", { name: "Run live 5-tool sequence" }),
    );
    await user.click(
      await screen.findByRole("button", {
        name: "Approve this exact dispatch",
      }),
    );
    await user.click(
      await screen.findByRole("button", {
        name: "Invoke one-time commit tool",
      }),
    );

    expect(await screen.findByText("One exact action committed")).toBeVisible();
    expect(
      screen.getByText(/revocation pending verification/),
    ).toBeVisible();
    expect(screen.queryByTestId("temporary-tool")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Tool count unavailable")).toBeVisible();
    expect(
      await screen.findByText(
        "Unexpected WebMCP registry shape. Authority actions are disabled.",
      ),
    ).toBeVisible();
    expect(
      await screen.findByText(/The temporary commit capability did not revoke/),
    ).toBeVisible();
    expect(
      screen.getByText("Commit succeeded — revocation unverified"),
    ).toBeVisible();
    expect(
      screen.getByText(/Stop and Reset before continuing/),
    ).toBeVisible();
    expect(screen.getByText("CAPABILITY_NOT_AVAILABLE")).toBeVisible();
  });

  it("distinguishes browser settlement failure after the domain committed", async () => {
    const adapter = new CommitExecutionFailureAdapter(true);
    const user = userEvent.setup();
    render(<DispatchDemo adapterFactory={() => adapter} />);
    await screen.findByText("WebMCP test adapter");
    await user.click(
      await screen.findByRole("button", { name: "Run live 5-tool sequence" }),
    );
    await user.click(
      await screen.findByRole("button", {
        name: "Approve this exact dispatch",
      }),
    );
    await user.click(
      await screen.findByRole("button", {
        name: "Invoke one-time commit tool",
      }),
    );

    expect(await screen.findByText("One exact action committed")).toBeVisible();
    expect(
      screen.getByText("Commit succeeded — verify the registry"),
    ).toBeVisible();
    expect(
      screen.getByText(/The domain committed, but the browser call reported an error/),
    ).toBeVisible();
    expect(screen.getByText("RUNTIME_ERROR")).toBeVisible();
    expect(screen.queryByText("Commit blocked")).not.toBeInTheDocument();
  });

  it("does not claim success when commit execution fails before the callback", async () => {
    const adapter = new CommitExecutionFailureAdapter(false);
    const store = new DispatchStore();
    const user = userEvent.setup();
    render(
      <DispatchDemo
        adapterFactory={() => adapter}
        storeFactory={() => store}
      />,
    );
    await screen.findByText("WebMCP test adapter");
    await user.click(
      await screen.findByRole("button", { name: "Run live 5-tool sequence" }),
    );
    await user.click(
      await screen.findByRole("button", {
        name: "Approve this exact dispatch",
      }),
    );
    await user.click(
      await screen.findByRole("button", {
        name: "Invoke one-time commit tool",
      }),
    );

    expect(await screen.findByText("Commit blocked")).toBeVisible();
    expect(screen.getByText("RUNTIME_ERROR")).toBeVisible();
    expect(store.getSnapshot()).toMatchObject({
      phase: "approved",
      committed_dispatch: null,
      approval: { status: "approved", used_at: null },
    });
    expect(
      screen.queryByText("Commit succeeded — verify the registry"),
    ).not.toBeInTheDocument();
  });

  it("keeps startup, Reset, Run, and Approve failures action-specific", async () => {
    const startupAdapter = new FakeWebMcpAdapter();
    const startupForeignController = new AbortController();
    await startupAdapter.registerTool(foreignTool, {
      signal: startupForeignController.signal,
    });
    const first = render(
      <DispatchDemo adapterFactory={() => startupAdapter} />,
    );

    expect(await screen.findByText("WebMCP unavailable")).toBeVisible();
    expect(screen.getByText("CAPABILITY_NOT_AVAILABLE")).toBeVisible();
    expect(screen.queryByText("Commit authority blocked")).not.toBeInTheDocument();
    await act(async () => {
      first.unmount();
      startupForeignController.abort();
      await Promise.resolve();
    });

    const resetAdapter = new FakeWebMcpAdapter();
    const user = userEvent.setup();
    const second = render(
      <DispatchDemo adapterFactory={() => resetAdapter} />,
    );
    await screen.findByText("WebMCP test adapter");
    await screen.findByLabelText("5 live tools");
    const resetForeignController = new AbortController();
    await act(async () => {
      await resetAdapter.registerTool(foreignTool, {
        signal: resetForeignController.signal,
      });
    });
    await user.click(screen.getByRole("button", { name: "Reset Demo" }));

    expect(await screen.findByText("Reset did not settle")).toBeVisible();
    expect(screen.getByText("CAPABILITY_NOT_AVAILABLE")).toBeVisible();
    expect(screen.queryByText("Commit authority blocked")).not.toBeInTheDocument();
    act(() => resetForeignController.abort());
    expect(await screen.findByLabelText("5 live tools")).toBeVisible();
    second.unmount();

    const preparationAdapter = new PreparationFailureAdapter();
    const third = render(
      <DispatchDemo adapterFactory={() => preparationAdapter} />,
    );
    const runUser = userEvent.setup();
    await screen.findByText("WebMCP test adapter");
    await screen.findByLabelText("5 live tools");
    await runUser.click(
      screen.getByRole("button", { name: "Run live 5-tool sequence" }),
    );
    expect(await screen.findByText("Preparation stopped")).toBeVisible();
    expect(
      screen.getByText(/Reset before running the full sequence again/),
    ).toBeVisible();
    expect(screen.queryByText("Commit authority blocked")).not.toBeInTheDocument();
    third.unmount();

    const approvalStore = new DispatchStore();
    const approvalFailure = vi
      .spyOn(approvalStore, "approveDraft")
      .mockRejectedValueOnce(new Error("Secure approval ID unavailable."));
    try {
      const approvalAdapter = new FakeWebMcpAdapter();
      const approvalUser = userEvent.setup();
      render(
        <DispatchDemo
          adapterFactory={() => approvalAdapter}
          storeFactory={() => approvalStore}
        />,
      );
      await screen.findByText("WebMCP test adapter");
      await screen.findByLabelText("5 live tools");
      await approvalUser.click(
        screen.getByRole("button", { name: "Run live 5-tool sequence" }),
      );
      await approvalUser.click(
        await screen.findByRole("button", {
          name: "Approve this exact dispatch",
        }),
      );
      expect(await screen.findByText("Approval blocked")).toBeVisible();
      expect(screen.getByText(/Do not assume tool 06 exists/)).toBeVisible();
      expect(
        screen.queryByText("Commit authority blocked"),
      ).not.toBeInTheDocument();
    } finally {
      approvalFailure.mockRestore();
    }
  });

  it("hides stale capability evidence and disables commit after a registry read failure", async () => {
    const adapter = new ReadFailureAdapter();
    const user = userEvent.setup();
    render(<DispatchDemo adapterFactory={() => adapter} />);
    await screen.findByText("WebMCP test adapter");
    await user.click(
      await screen.findByRole("button", { name: "Run live 5-tool sequence" }),
    );
    await user.click(
      await screen.findByRole("button", {
        name: "Approve this exact dispatch",
      }),
    );
    const commitButton = await screen.findByRole("button", {
      name: "Invoke one-time commit tool",
    });
    expect(screen.getByTestId("temporary-tool")).toBeVisible();

    adapter.failReads();
    const foreignController = new AbortController();
    await act(async () => {
      await adapter.registerTool(foreignTool, {
        signal: foreignController.signal,
      });
    });

    expect(await screen.findByText("Registry read failed.")).toBeVisible();
    expect(
      screen.getByLabelText("Tool count unavailable"),
    ).toHaveTextContent("—");
    expect(screen.queryByTestId("temporary-tool")).not.toBeInTheDocument();
    expect(commitButton).toBeDisabled();
    adapter.recoverReads();
    act(() => foreignController.abort());
    expect(await screen.findByLabelText("6 live tools")).toBeVisible();
  });

  it("recovers from a one-shot getTools failure without another toolchange", async () => {
    const adapter = new TransientReadFailureAdapter();
    const user = userEvent.setup();
    render(<DispatchDemo adapterFactory={() => adapter} />);
    await screen.findByText("WebMCP test adapter");
    expect(await screen.findByLabelText("5 live tools")).toBeVisible();

    act(() => adapter.failAndNotify());
    expect(
      await screen.findByText("Transient registry read failed."),
    ).toBeVisible();
    expect(screen.getByLabelText("Tool count unavailable")).toBeVisible();

    expect(await screen.findByLabelText("5 live tools")).toBeVisible();
    expect(
      screen.queryByText("Transient registry read failed."),
    ).not.toBeInTheDocument();

    const readsBeforePersistentFailure = adapter.readCount;
    act(() => adapter.failAndNotify(10));
    expect(
      await screen.findByText("Transient registry read failed."),
    ).toBeVisible();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 900));
    });
    expect(adapter.readCount - readsBeforePersistentFailure).toBe(3);
    expect(screen.getByLabelText("Tool count unavailable")).toBeVisible();

    adapter.recoverWithoutNotification();
    const readsBeforeReset = adapter.readCount;
    await user.click(screen.getByRole("button", { name: "Reset Demo" }));

    expect(await screen.findByLabelText("5 live tools")).toBeVisible();
    expect(adapter.readCount - readsBeforeReset).toBeGreaterThanOrEqual(2);
    expect(
      screen.getByRole("button", { name: "Run live 5-tool sequence" }),
    ).toBeEnabled();
    expect(
      screen.queryByText("Transient registry read failed."),
    ).not.toBeInTheDocument();
  });

  it("converges after the last toolchange returns a well-formed stale snapshot", async () => {
    const adapter = new WellFormedStaleSnapshotAdapter();
    const user = userEvent.setup();
    render(<DispatchDemo adapterFactory={() => adapter} />);
    await screen.findByText("WebMCP test adapter");
    await screen.findByLabelText("5 live tools");

    const baselineTools = await adapter.getTools();
    let readsBefore = adapter.readCount;
    act(() => adapter.emitStaleSnapshot(baselineTools.slice(0, 4)));
    await waitFor(() =>
      expect(adapter.readCount - readsBefore).toBeGreaterThan(1),
    );
    expect(await screen.findByLabelText("5 live tools")).toBeVisible();

    await user.click(
      screen.getByRole("button", { name: "Run live 5-tool sequence" }),
    );
    await user.click(
      await screen.findByRole("button", {
        name: "Approve this exact dispatch",
      }),
    );
    await screen.findByLabelText("6 live tools");
    const approvedTools = await adapter.getTools();

    readsBefore = adapter.readCount;
    act(() => adapter.emitStaleSnapshot(baselineTools));
    await waitFor(() =>
      expect(adapter.readCount - readsBefore).toBeGreaterThan(1),
    );
    expect(await screen.findByLabelText("6 live tools")).toBeVisible();

    await user.click(
      screen.getByRole("button", { name: "Invoke one-time commit tool" }),
    );
    await screen.findByText("One exact action committed");
    await screen.findByLabelText("5 live tools");

    readsBefore = adapter.readCount;
    act(() => adapter.emitStaleSnapshot(approvedTools));
    await waitFor(() =>
      expect(adapter.readCount - readsBefore).toBeGreaterThan(1),
    );
    expect(await screen.findByLabelText("5 live tools")).toBeVisible();
  });

  it("coalesces a toolchange storm into one in-flight and one trailing read", async () => {
    const adapter = new PausedRefreshAdapter();
    render(<DispatchDemo adapterFactory={() => adapter} />);
    await screen.findByText("WebMCP test adapter");
    await screen.findByLabelText("5 live tools");

    adapter.resetReadStats();
    adapter.armPausedRead();
    act(() => adapter.emitToolchangeStorm(1));
    await adapter.pausedReadStarted;

    act(() => adapter.emitToolchangeStorm(99));
    expect(adapter.readCount).toBe(1);
    expect(adapter.maxConcurrentReads).toBe(1);

    await act(async () => {
      adapter.releasePausedRead();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(adapter.readCount).toBe(2);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 75));
    });

    expect(adapter.readCount).toBe(2);
    expect(adapter.maxConcurrentReads).toBe(1);
    expect(await screen.findByLabelText("5 live tools")).toBeVisible();
  });

  it("drops a queued trailing refresh when unmounted during a paused read", async () => {
    const adapter = new PausedRefreshAdapter();
    const { unmount } = render(
      <DispatchDemo adapterFactory={() => adapter} />,
    );
    await screen.findByText("WebMCP test adapter");
    await screen.findByLabelText("5 live tools");

    adapter.resetReadStats();
    adapter.armPausedRead();
    act(() => adapter.emitToolchangeStorm(1));
    await adapter.pausedReadStarted;
    act(() => adapter.emitToolchangeStorm(25));
    expect(adapter.readCount).toBe(1);
    expect(adapter.getListenerCount()).toBe(1);

    unmount();
    adapter.releasePausedRead();
    await new Promise((resolve) => setTimeout(resolve, 75));

    expect(adapter.readCount).toBe(1);
    expect(adapter.getListenerCount()).toBe(0);
    expect(adapter.maxConcurrentReads).toBe(1);
  });

  it("converges when approval changes the expected surface during a paused read", async () => {
    const adapter = new PausedRefreshAdapter();
    const user = userEvent.setup();
    render(<DispatchDemo adapterFactory={() => adapter} />);
    await screen.findByText("WebMCP test adapter");
    await screen.findByLabelText("5 live tools");

    adapter.armPausedRead();
    act(() => adapter.emitToolchangeStorm(1));
    await adapter.pausedReadStarted;

    await user.click(
      screen.getByRole("button", { name: "Run live 5-tool sequence" }),
    );
    await user.click(
      await screen.findByRole("button", {
        name: "Approve this exact dispatch",
      }),
    );
    await waitFor(async () => {
      expect((await adapter.getTools()).map((tool) => tool.name)).toContain(
        COMMIT_TOOL_NAME,
      );
    });
    expect(screen.queryByLabelText("6 live tools")).not.toBeInTheDocument();

    await act(async () => {
      adapter.releasePausedRead();
      await Promise.resolve();
    });

    expect(await screen.findByLabelText("6 live tools")).toBeVisible();
    expect(screen.getByTestId("temporary-tool")).toBeVisible();
  });

  it("rejects a contaminated registry as live capability evidence", async () => {
    const adapter = new FakeWebMcpAdapter();
    const user = userEvent.setup();
    render(<DispatchDemo adapterFactory={() => adapter} />);
    await screen.findByText("WebMCP test adapter");
    await screen.findByLabelText("5 live tools");

    const foreignController = new AbortController();
    await act(async () => {
      await adapter.registerTool(foreignTool, {
        signal: foreignController.signal,
      });
    });

    expect(
      await screen.findByText(
        "Unexpected WebMCP registry shape. Authority actions are disabled.",
      ),
    ).toBeVisible();
    expect(screen.getByLabelText("Tool count unavailable")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Run live 5-tool sequence" }),
    ).toBeDisabled();
    act(() => foreignController.abort());
    await user.click(screen.getByRole("button", { name: "Reset Demo" }));
  });

  it("rejects a stale commit capability before human approval", async () => {
    const adapter = new FakeWebMcpAdapter();
    render(<DispatchDemo adapterFactory={() => adapter} />);
    await screen.findByText("WebMCP test adapter");
    await screen.findByLabelText("5 live tools");

    const staleController = new AbortController();
    await act(async () => {
      await adapter.registerTool(
        { ...foreignTool, name: COMMIT_TOOL_NAME },
        { signal: staleController.signal },
      );
    });

    expect(
      await screen.findByText(
        "Unexpected WebMCP registry shape. Authority actions are disabled.",
      ),
    ).toBeVisible();
    expect(screen.getByLabelText("Tool count unavailable")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Run live 5-tool sequence" }),
    ).toBeDisabled();
    act(() => staleController.abort());
    expect(await screen.findByLabelText("5 live tools")).toBeVisible();
  });

  it("surfaces draft-change failure and removes approval capability", async () => {
    const store = new DispatchStore();
    const { adapter, user } = await renderSupported(store);
    await user.click(screen.getByRole("button", { name: "Run live 5-tool sequence" }));
    await user.click(
      await screen.findByRole("button", {
        name: "Approve this exact dispatch",
      }),
    );
    await screen.findByTestId("temporary-tool");

    act(() => {
      store.mutateDraft({ quoted_price_jpy: 57_000 });
    });

    expect(
      await screen.findByText("DRAFT_CHANGED_AFTER_APPROVAL"),
    ).toBeVisible();
    expect(screen.getByText("Approval revoked")).toBeVisible();
    await waitFor(async () => {
      expect((await adapter.getTools()).map((tool) => tool.name)).not.toContain(
        COMMIT_TOOL_NAME,
      );
    });
  });

  it("automatically expires approval through the mounted countdown timer", async () => {
    let now = Date.parse("2026-08-27T00:00:00.000Z");
    const clock: Clock = { now: () => now };
    const store = new DispatchStore(clock, () => "expiry-test-id");
    const { adapter, user } = await renderSupported(store);
    await user.click(
      screen.getByRole("button", { name: "Run live 5-tool sequence" }),
    );
    await user.click(
      await screen.findByRole("button", {
        name: "Approve this exact dispatch",
      }),
    );
    await screen.findByTestId("temporary-tool");
    now += 120_001;

    expect(await screen.findByText("Approval expired")).toBeVisible();
    expect(screen.getByText("APPROVAL_EXPIRED")).toBeVisible();
    expect(screen.queryByText("Commit blocked")).not.toBeInTheDocument();
    await waitFor(async () => {
      expect((await adapter.getTools()).map((tool) => tool.name)).toEqual(
        [...BASE_TOOL_NAMES].sort(),
      );
    });
    expect(
      await screen.findByText("Temporary capability expired and revoked"),
    ).toBeVisible();
  });

  it("supports keyboard execution and repeatable reset", async () => {
    const adapter = new PausedRefreshAdapter();
    const { user } = await renderSupported(
      new DispatchStore(),
      "test",
      adapter,
    );
    const runButton = screen.getByRole("button", { name: "Run live 5-tool sequence" });
    runButton.focus();
    await user.keyboard("{Enter}");
    expect(await screen.findByText("DRAFT — NOT SUBMITTED")).toBeVisible();

    const reset = screen.getByRole("button", { name: "Reset Demo" });
    adapter.resetReadStats();
    await user.click(reset);
    await waitFor(() => expect(adapter.readCount).toBeGreaterThanOrEqual(2));
    expect(adapter.getListenerCount()).toBe(1);

    adapter.resetReadStats();
    await user.click(reset);
    await waitFor(() => expect(adapter.readCount).toBeGreaterThanOrEqual(2));
    expect(adapter.getListenerCount()).toBe(1);

    expect(await screen.findByText("No dispatch draft yet")).toBeVisible();
    expect((await adapter.getTools()).map((tool) => tool.name)).toEqual(
      [...BASE_TOOL_NAMES].sort(),
    );
  });

  it("copies the exact prompt", async () => {
    const { user } = await renderSupported();

    await user.click(screen.getByRole("button", { name: "Copy demo prompt" }));

    expect(await screen.findByRole("button", { name: "Copy demo prompt" })).toHaveTextContent(
      "Copied",
    );
  });

  it("reports copy failure without false success or a leaked textarea", async () => {
    const { store, user } = await renderSupported();
    act(() => {
      store.recordCapabilityLifecycleFailure("Earlier registry failure.");
    });
    expect(screen.getByText("CAPABILITY_NOT_AVAILABLE")).toBeVisible();
    expect(screen.getByText("Commit authority blocked")).toBeVisible();
    const writeText = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockRejectedValueOnce(new Error("Clipboard denied"));
    const originalExecCommand = Object.getOwnPropertyDescriptor(
      document,
      "execCommand",
    );
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: vi.fn(() => false),
    });

    try {
      await user.click(screen.getByRole("button", { name: "Copy demo prompt" }));

      expect(
        await screen.findByText("The demo prompt could not be copied."),
      ).toBeVisible();
      expect(screen.getByText("Copy failed")).toBeVisible();
      expect(screen.getByText("RUNTIME_ERROR")).toBeVisible();
      expect(screen.queryByText("CAPABILITY_NOT_AVAILABLE")).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Copy demo prompt" }),
      ).toHaveTextContent("Copy");
      expect(document.querySelector("textarea")).toBeNull();
      await user.click(screen.getByRole("button", { name: "Dismiss error" }));
      expect(screen.queryByText("Copy failed")).not.toBeInTheDocument();
      expect(screen.queryByText("RUNTIME_ERROR")).not.toBeInTheDocument();
      expect(screen.getByText("Commit authority blocked")).toBeVisible();
      expect(screen.getByText("CAPABILITY_NOT_AVAILABLE")).toBeVisible();
    } finally {
      writeText.mockRestore();
      if (originalExecCommand) {
        Object.defineProperty(document, "execCommand", originalExecCommand);
      } else {
        Reflect.deleteProperty(document, "execCommand");
      }
    }
  });

  it("cleans a toolchange listener when subscription partially succeeds", async () => {
    const adapter = new PartialSubscriptionFailureAdapter();
    const { unmount } = render(
      <DispatchDemo adapterFactory={() => adapter} />,
    );

    expect(
      await screen.findByText(
        "Toolchange subscription denied after registration",
      ),
    ).toBeVisible();
    expect(screen.getByLabelText("Tool count unavailable")).toBeVisible();
    expect(adapter.listenerPresent).toBe(true);

    unmount();
    expect(adapter.listenerPresent).toBe(false);
  });

  it("converges after a stale single-flight getTools response settles", async () => {
    const adapter = new OutOfOrderReadAdapter();
    render(<DispatchDemo adapterFactory={() => adapter} />);

    await screen.findByText("WebMCP test adapter");
    expect(screen.getByLabelText("Tool count unavailable")).toBeVisible();

    await act(async () => {
      adapter.releaseStaleRead();
      await Promise.resolve();
    });

    expect(await screen.findByLabelText("5 live tools")).toBeVisible();
    expect(screen.queryByLabelText("1 live tools")).not.toBeInTheDocument();
  });

  it("admits only one UI action before React paints the busy state", async () => {
    const adapter = new BlockingExecutionAdapter();
    render(<DispatchDemo adapterFactory={() => adapter} />);
    await screen.findByText("WebMCP test adapter");
    expect(
      screen.getByText("DETERMINISTIC · INVOKES REGISTERED TOOLS"),
    ).toBeVisible();
    const runButton = screen.getByRole("button", {
      name: "Run live 5-tool sequence",
    });

    act(() => {
      runButton.click();
      runButton.click();
    });

    await waitFor(() => expect(adapter.executionCount).toBe(1));
    adapter.releaseExecution();
    expect(await screen.findByText("DRAFT — NOT SUBMITTED")).toBeVisible();
  });
});
