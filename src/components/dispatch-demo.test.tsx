import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { DispatchStore } from "@/lib/domain/dispatch-machine";
import { FakeWebMcpAdapter } from "@/lib/webmcp/fake-adapter";
import { BASE_TOOL_NAMES, COMMIT_TOOL_NAME } from "@/lib/webmcp/tool-registry";

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

async function renderSupported(store = new DispatchStore()) {
  const adapter = new FakeWebMcpAdapter();
  const user = userEvent.setup();
  render(
    <DispatchDemo
      adapterFactory={() => adapter}
      storeFactory={() => store}
    />,
  );
  await screen.findByText("WebMCP test adapter");
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

  it("renders a draft and approval control after the five-tool sequence", async () => {
    const { user } = await renderSupported();
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
    expect(screen.getByText(/Human approval active · expires in/)).toBeVisible();
    expect(
      (await adapter.getTools()).map((tool) => tool.name),
    ).toContain(COMMIT_TOOL_NAME);

    await user.click(commitButton);

    expect(await screen.findByText("Dispatch committed once")).toBeVisible();
    expect(
      await screen.findByText("commit_approved_dispatch revoked"),
    ).toBeVisible();
    await waitFor(async () => {
      expect((await adapter.getTools()).map((tool) => tool.name)).toEqual(
        [...BASE_TOOL_NAMES].sort(),
      );
    });
    expect(screen.getByText("Agent committed approved dispatch")).toBeVisible();
    expect(
      screen.getByText("Temporary capability revoked after one exact action"),
    ).toBeVisible();
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

    store.mutateDraft({ quoted_price_jpy: 57_000 });

    expect(
      await screen.findByText("DRAFT_CHANGED_AFTER_APPROVAL"),
    ).toBeVisible();
    await waitFor(async () => {
      expect((await adapter.getTools()).map((tool) => tool.name)).not.toContain(
        COMMIT_TOOL_NAME,
      );
    });
  });

  it("supports keyboard execution and repeatable reset", async () => {
    const { adapter, user } = await renderSupported();
    const runButton = screen.getByRole("button", { name: "Run live 5-tool sequence" });
    runButton.focus();
    await user.keyboard("{Enter}");
    expect(await screen.findByText("DRAFT — NOT SUBMITTED")).toBeVisible();

    const reset = screen.getByRole("button", { name: "Reset Demo" });
    await user.click(reset);
    await user.click(reset);

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

  it("ignores a stale getTools response that resolves after the live surface", async () => {
    const adapter = new OutOfOrderReadAdapter();
    render(<DispatchDemo adapterFactory={() => adapter} />);

    await screen.findByText("WebMCP test adapter");
    expect(await screen.findByLabelText("5 live tools")).toBeVisible();

    await act(async () => {
      adapter.releaseStaleRead();
      await Promise.resolve();
    });

    expect(screen.getByLabelText("5 live tools")).toBeVisible();
    expect(screen.queryByLabelText("1 live tools")).not.toBeInTheDocument();
  });

  it("admits only one UI action before React paints the busy state", async () => {
    const adapter = new BlockingExecutionAdapter();
    render(<DispatchDemo adapterFactory={() => adapter} />);
    await screen.findByText("WebMCP test adapter");
    expect(
      screen.getByText(
        "CALLS LIVE TOOLS · 5 PREPARE → 6 APPROVE → 5 CONSUME",
      ),
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
