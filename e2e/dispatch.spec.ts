import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

const workspace = process.cwd();
const artifacts = path.join(workspace, "artifacts");
const baselineTools = [
  "check_provider_availability",
  "create_dispatch_draft",
  "get_active_vehicle",
  "get_service_history",
  "search_qualified_providers",
];

async function installWebMcpHarness(page: Page) {
  await page.addInitScript(() => {
    class DeterministicModelContext extends EventTarget {
      tools = new Map<string, WebMcpModelContextTool>();

      async registerTool(
        tool: WebMcpModelContextTool,
        options: WebMcpRegisterToolOptions = {},
      ) {
        if (options.signal?.aborted) {
          throw options.signal.reason;
        }
        if (this.tools.has(tool.name)) {
          throw new DOMException("Duplicate WebMCP tool.", "InvalidStateError");
        }
        this.tools.set(tool.name, tool);
        options.signal?.addEventListener(
          "abort",
          () => {
            if (this.tools.get(tool.name) === tool) {
              this.tools.delete(tool.name);
              this.dispatchEvent(new Event("toolchange"));
            }
          },
          { once: true },
        );
        this.dispatchEvent(new Event("toolchange"));
      }

      async getTools() {
        return [...this.tools.values()]
          .map((tool) => ({
            name: tool.name,
            title: tool.title ?? "",
            description: tool.description,
            inputSchema: tool.inputSchema
              ? structuredClone(tool.inputSchema)
              : undefined,
            annotations: tool.annotations
              ? { ...tool.annotations }
              : undefined,
            origin: window.location.origin,
            window,
          }))
          .sort((left, right) => left.name.localeCompare(right.name));
      }

      async executeTool(
        tool: WebMcpRegisteredTool,
        input: Record<string, unknown>,
        options: { signal?: AbortSignal } = {},
      ) {
        const definition = this.tools.get(tool.name);
        if (!definition) {
          throw new DOMException("WebMCP tool is unavailable.", "InvalidStateError");
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
        return definition.execute(input, { signal: controller.signal });
      }
    }

    const modelContext = new DeterministicModelContext();
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: modelContext,
    });
    window.__WEBMCP_TEST_MODE__ = true;
  });
}

function collectRuntimeErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(`console: ${message.text()}`);
    }
    if (/hydration|uncaught/i.test(message.text())) {
      errors.push(`runtime: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => {
    errors.push(`pageerror: ${error.message}`);
  });
  return errors;
}

async function actualToolNames(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const tools = await document.modelContext!.getTools();
    return tools.map((tool) => tool.name).sort();
  });
}

async function expectNoHorizontalScroll(page: Page) {
  const sizes = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(sizes.document).toBeLessThanOrEqual(sizes.viewport);
  expect(sizes.body).toBeLessThanOrEqual(sizes.viewport);
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-08-27T07:00:00.000Z"));
});

test("unsupported browser is honest and stable", async ({ page }) => {
  const errors = collectRuntimeErrors(page);
  await page.goto("/");

  await expect(
    page.getByText("Native WebMCP is unavailable in this browser."),
  ).toBeVisible();
  await expect(page.getByText("No tool registration is being simulated.")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Run live 5-tool sequence" }),
  ).toBeDisabled();
  await expectNoHorizontalScroll(page);
  expect(errors).toEqual([]);
});

test("desktop hero lifecycle appears and revokes for one exact action", async ({
  page,
}) => {
  const errors = collectRuntimeErrors(page);
  await installWebMcpHarness(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  await expect(page.getByText("WebMCP test adapter")).toBeVisible();
  await expect(page.getByText("Deterministic WebMCP runner")).toBeVisible();
  await expect(
    page.getByText("CALLS LIVE TOOLS · 5 PREPARE → 6 APPROVE → 5 CONSUME"),
  ).toBeVisible();
  await expect.poll(() => actualToolNames(page)).toEqual(baselineTools);
  await expect(page.getByText("Provider decision pending")).toBeVisible();
  await expect(page.getByText("MATCH")).toHaveCount(0);
  await page.screenshot({
    path: path.join(artifacts, "desktop-initial.png"),
    fullPage: false,
  });
  await page.getByRole("button", { name: "Copy demo prompt" }).click();
  await expect(page.getByRole("button", { name: "Copy demo prompt" })).toHaveText(
    "Copied",
  );

  await page.getByRole("button", { name: "Run live 5-tool sequence" }).click();
  await expect(page.getByText("DRAFT — NOT SUBMITTED")).toBeVisible();
  await expect(page.getByText("Service history reviewed")).toBeVisible();
  await expectNoHorizontalScroll(page);
  const desktopScroll = await page.evaluate(() => ({
    height: document.documentElement.scrollHeight,
    viewport: window.innerHeight,
  }));
  expect(desktopScroll.height).toBeLessThanOrEqual(desktopScroll.viewport);
  await page.getByRole("button", { name: "Approve this exact dispatch" }).click();
  await expect(page.getByTestId("temporary-tool")).toContainText(
    "commit_approved_dispatch",
  );
  await expect.poll(() => actualToolNames(page)).toEqual([
    "check_provider_availability",
    "commit_approved_dispatch",
    "create_dispatch_draft",
    "get_active_vehicle",
    "get_service_history",
    "search_qualified_providers",
  ]);
  await page.getByTestId("temporary-tool").evaluate(async (element) => {
    await Promise.all(
      element.getAnimations().map((animation) => animation.finished),
    );
  });
  await page.screenshot({
    path: path.join(artifacts, "desktop-approved.png"),
    fullPage: false,
  });

  await page.getByRole("button", { name: "Invoke one-time commit tool" }).click();
  await expect(page.getByText("Dispatch committed once")).toBeVisible();
  await expect(page.getByText("commit_approved_dispatch revoked")).toBeVisible();
  await expect.poll(() => actualToolNames(page)).toEqual(baselineTools);
  await page.screenshot({
    path: path.join(artifacts, "desktop-committed.png"),
    fullPage: false,
  });

  await page.getByRole("button", { name: "Reset Demo" }).click();
  await expect(page.getByText("No dispatch draft yet")).toBeVisible();
  await expect.poll(() => actualToolNames(page)).toEqual(baselineTools);
  await page.screenshot({
    path: path.join(artifacts, "desktop-reset.png"),
    fullPage: false,
  });
  expect(errors).toEqual([]);
});

test("1280 by 720 keeps every primary region and no horizontal scroll", async ({
  page,
}) => {
  const errors = collectRuntimeErrors(page);
  await installWebMcpHarness(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/");
  const runButton = page.getByRole("button", { name: "Run live 5-tool sequence" });
  await runButton.focus();
  expect(
    await runButton.evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).outlineWidth),
    ),
  ).toBeGreaterThanOrEqual(2);
  await runButton.click();

  await expect(page.getByRole("heading", { name: "Agentic Service Dispatch" })).toBeVisible();
  await expect(page.getByText("DRAFT — NOT SUBMITTED")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Live WebMCP Capabilities" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Audit Log" })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await page.getByRole("button", { name: "Approve this exact dispatch" }).click();
  await expect(page.getByTestId("temporary-tool")).toBeVisible();
  expect(
    await page
      .getByTestId("temporary-tool")
      .evaluate((element) => getComputedStyle(element).animationName),
  ).toBe("none");
  expect(errors).toEqual([]);
});

test("390 by 844 remains operable without horizontal overflow", async ({
  page,
}) => {
  const errors = collectRuntimeErrors(page);
  await installWebMcpHarness(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Run live 5-tool sequence" }).click();

  await expect(page.getByText("DRAFT — NOT SUBMITTED")).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve this exact dispatch" })).toBeEnabled();
  await expect(page.getByRole("heading", { name: "Live WebMCP Capabilities" })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await page.screenshot({
    path: path.join(artifacts, "mobile.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Reset Demo" }).click();
  await expect(page.getByText("No dispatch draft yet")).toBeVisible();
  expect(errors).toEqual([]);
});
