import path from "node:path";
import { mkdirSync } from "node:fs";

import { expect, test, type Locator, type Page } from "@playwright/test";

import { SCENARIO_NOW } from "../src/lib/domain/fixtures";

const workspace = process.cwd();
const artifacts = path.join(
  workspace,
  "artifacts",
  "final-candidate",
  "playwright",
);
const updateEvidence = process.env.UPDATE_EVIDENCE === "1";
if (updateEvidence) {
  mkdirSync(artifacts, { recursive: true });
}
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

async function expectInInitialViewport(page: Page, locator: Locator) {
  const [box, viewport] = await Promise.all([
    locator.boundingBox(),
    page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight })),
  ]);
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
}

async function expectVisibleButtonsAtLeast44px(page: Page) {
  const heights = await page.locator(".app-shell button").evaluateAll((buttons) =>
    buttons
      .filter((button) => {
        const style = getComputedStyle(button);
        return style.visibility !== "hidden" && style.display !== "none";
      })
      .map((button) => button.getBoundingClientRect().height),
  );
  expect(heights.length).toBeGreaterThan(0);
  expect(Math.min(...heights)).toBeGreaterThanOrEqual(44);
}

async function tabToButton(page: Page, name: string): Promise<void> {
  const button = page.getByRole("button", { name });
  for (let index = 0; index < 12; index += 1) {
    if (await button.evaluate((element) => element === document.activeElement)) {
      return;
    }
    await page.keyboard.press("Tab");
  }
  throw new Error(`Keyboard focus did not reach button: ${name}`);
}

async function captureEvidence(
  page: Page,
  filename: string,
  fullPage = false,
): Promise<void> {
  if (!updateEvidence) {
    return;
  }
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.allSettled(
      document.getAnimations().map((animation) => animation.finished),
    );
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
  });
  await page.screenshot({
    path: path.join(artifacts, filename),
    fullPage,
  });
}

test.beforeEach(async ({ page }) => {
  // Keep application evidence before the selected 13:00 JST fixture slot.
  await page.clock.setFixedTime(new Date(SCENARIO_NOW));
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
  await expect(
    page.getByText(/Fetched from the injected test harness via/),
  ).toBeVisible();
  await expect(page.locator("nextjs-portal")).toBeHidden();
  await expect(page.getByText("Live WebMCP runner")).toBeVisible();
  await expect(
    page.getByText("DETERMINISTIC · INVOKES REGISTERED TOOLS"),
  ).toBeVisible();
  await expect(page.getByText("PREPARE", { exact: true }).locator("..")).toHaveAttribute(
    "aria-current",
    "step",
  );
  await expect.poll(() => actualToolNames(page)).toEqual(baselineTools);
  await expect(page.getByText("Provider decision pending")).toBeVisible();
  await expect(
    page.getByText(
      "Frozen Aug 27, 2026 scenario · fictional vehicle, companies, history, pricing, and dispatch.",
    ),
  ).toBeVisible();
  await expect(page.getByText("MATCH")).toHaveCount(0);
  await expect(page.locator('.sr-only[role="status"]')).toHaveText(
    "WebMCP registry verified: 5 tools. Commit capability absent.",
  );
  await expect(
    page.locator('.capability-section [aria-live="polite"]'),
  ).toHaveCount(1);
  await expect(page.getByLabel("1 audit event")).toBeVisible();
  await expect(page.locator(".tool-list")).not.toHaveAttribute("aria-live");
  await captureEvidence(page, "desktop-initial.png");
  const copyButton = page.getByRole("button", { name: "Copy demo prompt" });
  await copyButton.click();
  await expect(copyButton).toHaveText("Copied");
  await expect(copyButton).toHaveText("Copy", { timeout: 3_000 });

  await page.getByRole("button", { name: "Run live 5-tool sequence" }).click();
  await expect(page.getByText("DRAFT — NOT SUBMITTED")).toBeVisible();
  await expect(page.getByText("Service history reviewed")).toBeVisible();
  await expect(page.getByText("Thu, Aug 27 · 10:00–15:00")).toBeVisible();
  await captureEvidence(page, "desktop-draft.png");
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
  await expect(page.getByText("APPROVE", { exact: true }).locator("..")).toHaveAttribute(
    "aria-current",
    "step",
  );
  await expect.poll(() => actualToolNames(page)).toEqual([
    "check_provider_availability",
    "commit_approved_dispatch",
    "create_dispatch_draft",
    "get_active_vehicle",
    "get_service_history",
    "search_qualified_providers",
  ]);
  await expect(page.locator('.sr-only[role="status"]')).toHaveText(
    "WebMCP registry verified: 6 tools. Human approval created the one-time commit capability.",
  );
  const auditEvents = page.getByRole("list", {
    name: "WebMCP audit events",
  });
  await expect(auditEvents).toHaveAttribute("tabindex", "0");
  await auditEvents.focus();
  await expect(auditEvents).toBeFocused();
  await page.getByTestId("temporary-tool").evaluate(async (element) => {
    await Promise.all(
      element.getAnimations().map((animation) => animation.finished),
    );
  });
  await captureEvidence(page, "desktop-approved.png");

  await page.getByRole("button", { name: "Invoke one-time commit tool" }).click();
  await expect(page.getByText("One exact action committed")).toBeVisible();
  await expect(page.getByText("commit_approved_dispatch revoked")).toBeVisible();
  await expect(page.getByText("CONSUME", { exact: true }).locator("..")).toHaveAttribute(
    "aria-current",
    "step",
  );
  await expect.poll(() => actualToolNames(page)).toEqual(baselineTools);
  await expect(page.locator('.sr-only[role="status"]')).toHaveText(
    "WebMCP registry verified: 5 tools. One-time commit capability revoked after use.",
  );
  await captureEvidence(page, "desktop-committed.png");

  await page.getByRole("button", { name: "Reset Demo" }).click();
  await expect(page.getByText("No dispatch draft yet")).toBeVisible();
  await expect.poll(() => actualToolNames(page)).toEqual(baselineTools);
  await captureEvidence(page, "desktop-reset.png");
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
  await expectInInitialViewport(
    page,
    page.getByRole("heading", { name: "Vehicle" }),
  );
  await expectInInitialViewport(
    page,
    page.getByText("DRAFT — NOT SUBMITTED"),
  );
  await expectInInitialViewport(
    page,
    page.getByRole("heading", { name: "Live WebMCP Capabilities" }),
  );
  await expectInInitialViewport(
    page,
    page.getByRole("button", { name: "Approve this exact dispatch" }),
  );
  await expectNoHorizontalScroll(page);
  await captureEvidence(page, "desktop-1280-draft.png", true);
  await page.getByRole("button", { name: "Approve this exact dispatch" }).click();
  await expect(page.getByTestId("temporary-tool")).toBeVisible();
  expect(
    await page
      .getByTestId("temporary-tool")
      .evaluate((element) => getComputedStyle(element).animationName),
  ).toBe("none");
  expect(errors).toEqual([]);
});

test("320 by 800 completes 5 to 6 to 5 and Reset without overflow", async ({
  page,
}) => {
  const errors = collectRuntimeErrors(page);
  await installWebMcpHarness(page);
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/");
  await expect.poll(() => actualToolNames(page)).toEqual(baselineTools);
  await expectInInitialViewport(
    page,
    page.getByRole("heading", { name: "Live WebMCP Capabilities" }),
  );
  await expectInInitialViewport(page, page.getByLabel("5 live tools"));
  await expectVisibleButtonsAtLeast44px(page);

  await page.getByRole("button", { name: "Run live 5-tool sequence" }).click();
  await expect(page.getByText("DRAFT — NOT SUBMITTED")).toBeVisible();
  await expect(page.getByRole("table")).toBeVisible();
  await expect(page.getByRole("row")).toHaveCount(4);
  await expect(
    page.getByRole("columnheader", { name: "Decision" }),
  ).toHaveCount(1);
  await expectVisibleButtonsAtLeast44px(page);
  await expectNoHorizontalScroll(page);
  await captureEvidence(page, "mobile-320-draft.png", true);

  await page.getByRole("button", { name: "Approve this exact dispatch" }).click();
  await expect.poll(() => actualToolNames(page)).toHaveLength(6);
  await expect(page.getByTestId("temporary-tool")).toBeVisible();
  await expectVisibleButtonsAtLeast44px(page);
  await page.getByRole("button", { name: "Invoke one-time commit tool" }).click();
  await expect(page.getByText("One exact action committed")).toBeVisible();
  await expect.poll(() => actualToolNames(page)).toEqual(baselineTools);

  await page.getByRole("button", { name: "Reset Demo" }).click();
  await expect(page.getByText("No dispatch draft yet")).toBeVisible();
  await expect.poll(() => actualToolNames(page)).toEqual(baselineTools);
  await expectNoHorizontalScroll(page);
  expect(errors).toEqual([]);
});

test("390 by 844 remains operable without horizontal overflow", async ({
  page,
}) => {
  const errors = collectRuntimeErrors(page);
  await installWebMcpHarness(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expectInInitialViewport(
    page,
    page.getByRole("heading", { name: "Live WebMCP Capabilities" }),
  );
  await expectInInitialViewport(page, page.getByLabel("5 live tools"));
  await expectVisibleButtonsAtLeast44px(page);
  await page.getByRole("button", { name: "Run live 5-tool sequence" }).click();

  await expect(page.getByText("DRAFT — NOT SUBMITTED")).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve this exact dispatch" })).toBeEnabled();
  await expect(page.getByRole("heading", { name: "Live WebMCP Capabilities" })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await captureEvidence(page, "mobile.png", true);
  await page.getByRole("button", { name: "Reset Demo" }).click();
  await expect(page.getByText("No dispatch draft yet")).toBeVisible();
  expect(errors).toEqual([]);
});

test("post-commit revoke failure gives state-specific safety guidance", async ({
  page,
}) => {
  const errors = collectRuntimeErrors(page);
  await installWebMcpHarness(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Run live 5-tool sequence" }).click();
  await page.getByRole("button", { name: "Approve this exact dispatch" }).click();
  await expect.poll(() => actualToolNames(page)).toHaveLength(6);

  await page.evaluate(async () => {
    const context = document.modelContext!;
    const readActualTools = context.getTools.bind(context);
    const commitTool = (await readActualTools()).find(
      (tool) => tool.name === "commit_approved_dispatch",
    );
    if (!commitTool) {
      throw new Error("Test harness could not capture tool 06.");
    }
    Object.defineProperty(context, "getTools", {
      configurable: true,
      value: async () => {
        const tools = await readActualTools();
        return tools.some((tool) => tool.name === commitTool.name)
          ? tools
          : [...tools, commitTool].sort((left, right) =>
              left.name.localeCompare(right.name),
            );
      },
    });
  });

  await page
    .getByRole("button", { name: "Invoke one-time commit tool" })
    .click();
  await expect(page.getByText("One exact action committed")).toBeVisible();
  const alert = page.locator(".global-alert");
  await expect(alert).toContainText(
    "Commit succeeded — revocation unverified",
  );
  await expect(alert).toContainText("Stop and Reset before continuing");
  await expect(alert).toContainText("CAPABILITY_NOT_AVAILABLE");
  await expectInInitialViewport(page, alert);
  await expectNoHorizontalScroll(page);
  const alertClips = await alert.evaluate(
    (element) => element.scrollWidth > element.clientWidth,
  );
  expect(alertClips).toBe(false);
  expect(errors).toEqual([]);
});

test("320px long provider, rationale, and error text wraps instead of clipping", async ({
  page,
}) => {
  const errors = collectRuntimeErrors(page);
  await installWebMcpHarness(page);
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/");
  await page.getByRole("button", { name: "Run live 5-tool sequence" }).click();
  await expect(page.getByText("DRAFT — NOT SUBMITTED")).toBeVisible();

  const longToken = "FictionalProviderQualificationAndSchedulingEvidence".repeat(5);
  await page.locator(".provider-table tbody th span").first().evaluate(
    (element, value) => {
      element.textContent = value;
    },
    longToken,
  );
  await page.locator(".provider-table tbody td small").first().evaluate(
    (element, value) => {
      element.textContent = value;
    },
    longToken,
  );
  await page.locator(".draft-details dd").last().evaluate(
    (element, value) => {
      element.textContent = value;
    },
    longToken,
  );
  await page.evaluate((message) => {
    const context = document.modelContext!;
    Object.defineProperty(context, "getTools", {
      configurable: true,
      value: async () => {
        throw new Error(message);
      },
    });
    (context as unknown as EventTarget).dispatchEvent(new Event("toolchange"));
  }, longToken);
  await expect(page.locator(".runtime-error")).toContainText(longToken);

  const clipped = await page
    .locator(
      ".provider-table tbody th span, .provider-table tbody td small, .draft-details dd, .runtime-error span",
    )
    .evaluateAll((elements) =>
      elements.some((element) => element.scrollWidth > element.clientWidth),
    );
  expect(clipped).toBe(false);
  await expectNoHorizontalScroll(page);
  expect(errors).toEqual([]);
});

test("eight-width viewport sweep preserves the draft and five-tool evidence", async ({
  page,
}) => {
  const errors = collectRuntimeErrors(page);
  await installWebMcpHarness(page);
  const viewports = [
    { width: 320, height: 800 },
    { width: 360, height: 800 },
    { width: 390, height: 844 },
    { width: 768, height: 900 },
    { width: 1024, height: 768 },
    { width: 1280, height: 720 },
    { width: 1440, height: 900 },
    { width: 1920, height: 1080 },
  ];

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await expect.poll(() => actualToolNames(page)).toEqual(baselineTools);
    await page.getByRole("button", { name: "Run live 5-tool sequence" }).click();
    await expect(page.getByText("DRAFT — NOT SUBMITTED")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Vehicle" })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Live WebMCP Capabilities" }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Audit Log" })).toBeVisible();
    await expectNoHorizontalScroll(page);
  }

  expect(errors).toEqual([]);
});

test("keyboard-only operation completes the full capability lifecycle", async ({
  page,
}) => {
  const errors = collectRuntimeErrors(page);
  await installWebMcpHarness(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/");
  await expect.poll(() => actualToolNames(page)).toEqual(baselineTools);

  await tabToButton(page, "Run live 5-tool sequence");
  await page.keyboard.press("Enter");
  await expect(page.getByText("DRAFT — NOT SUBMITTED")).toBeVisible();

  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Approve this exact dispatch" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect.poll(() => actualToolNames(page)).toHaveLength(6);

  await tabToButton(page, "Invoke one-time commit tool");
  await page.keyboard.press("Enter");
  await expect(page.getByText("One exact action committed")).toBeVisible();
  await expect.poll(() => actualToolNames(page)).toEqual(baselineTools);

  await tabToButton(page, "Reset Demo");
  await page.keyboard.press("Enter");
  await expect(page.getByText("No dispatch draft yet")).toBeVisible();
  await expect.poll(() => actualToolNames(page)).toEqual(baselineTools);
  expect(errors).toEqual([]);
});

test("forced colors and a 200 percent page-scale check preserve the core proof", async ({
  page,
}) => {
  const errors = collectRuntimeErrors(page);
  await installWebMcpHarness(page);
  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1280, height: 720 });
  const session = await page.context().newCDPSession(page);
  await session.send("Emulation.setPageScaleFactor", { pageScaleFactor: 2 });
  await page.goto("/");

  await expect.poll(() => actualToolNames(page)).toEqual(baselineTools);
  await expect(page.getByLabel("5 live tools")).toBeVisible();
  const runButton = page.getByRole("button", {
    name: "Run live 5-tool sequence",
  });
  await runButton.focus();
  await expect(runButton).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByText("DRAFT — NOT SUBMITTED")).toBeVisible();
  await expectNoHorizontalScroll(page);
  expect(errors).toEqual([]);
});
