import { describe, expect, it, vi } from "vitest";

import { APPROVAL_TTL_MS } from "@/lib/domain/approval";
import { DispatchStore } from "@/lib/domain/dispatch-machine";
import type { Clock } from "@/lib/domain/types";

import { FakeWebMcpAdapter } from "./fake-adapter";
import {
  COMMIT_TOOL_NAME,
  TOOL_SEQUENCE,
  ToolRegistry,
} from "./tool-registry";

type Preparation = 0 | 1 | 2 | 3 | 4;

interface AgentCallScenario {
  name: string;
  preparation: Preparation;
  tool: string;
  input: unknown;
}

function setup(clock?: Clock) {
  let id = 0;
  const store = new DispatchStore(clock, () => `agent-${++id}`);
  const adapter = new FakeWebMcpAdapter();
  const registry = new ToolRegistry(adapter, store);
  return { adapter, registry, store };
}

async function prepare(registry: ToolRegistry, count: Preparation) {
  await registry.start();
  for (const step of TOOL_SEQUENCE.slice(0, count)) {
    await registry.executeNamedTool(step.name, step.input);
  }
}

async function waitForCommitTool(
  adapter: FakeWebMcpAdapter,
  present: boolean,
) {
  await vi.waitFor(async () => {
    const names = (await adapter.getTools()).map((tool) => tool.name);
    expect(names.includes(COMMIT_TOOL_NAME)).toBe(present);
  });
}

const invalidCallScenarios: AgentCallScenario[] = [
  { name: "active/null container", preparation: 0, tool: "get_active_vehicle", input: null },
  { name: "active/array container", preparation: 0, tool: "get_active_vehicle", input: [] },
  { name: "active/string container", preparation: 0, tool: "get_active_vehicle", input: "" },
  { name: "active/number container", preparation: 0, tool: "get_active_vehicle", input: 0 },
  { name: "active/non-JSON object container", preparation: 0, tool: "get_active_vehicle", input: new Date(0) },
  { name: "active/symbol property", preparation: 0, tool: "get_active_vehicle", input: { [Symbol("extra")]: true } },
  { name: "history/null container", preparation: 1, tool: "get_service_history", input: null },
  { name: "history/array container", preparation: 1, tool: "get_service_history", input: [] },
  { name: "search/null container", preparation: 2, tool: "search_qualified_providers", input: null },
  { name: "search/array container", preparation: 2, tool: "search_qualified_providers", input: [] },
  { name: "availability/null container", preparation: 3, tool: "check_provider_availability", input: null },
  { name: "availability/string container", preparation: 3, tool: "check_provider_availability", input: "providers" },
  { name: "draft/null container", preparation: 4, tool: "create_dispatch_draft", input: null },
  { name: "draft/array container", preparation: 4, tool: "create_dispatch_draft", input: [] },

  { name: "active/unknown property", preparation: 0, tool: "get_active_vehicle", input: { vehicle_id: "vehicle-001" } },
  { name: "active/prototype-looking property", preparation: 0, tool: "get_active_vehicle", input: { constructor: "override" } },
  { name: "active/multiple unknown properties", preparation: 0, tool: "get_active_vehicle", input: { a: 1, b: 2 } },

  { name: "history/missing vehicle", preparation: 1, tool: "get_service_history", input: {} },
  { name: "history/extra property", preparation: 1, tool: "get_service_history", input: { vehicle_id: "vehicle-001", extra: true } },
  { name: "history/wrong vehicle", preparation: 1, tool: "get_service_history", input: { vehicle_id: "vehicle-999" } },
  { name: "history/numeric vehicle", preparation: 1, tool: "get_service_history", input: { vehicle_id: 1 } },
  { name: "history/coercible vehicle", preparation: 1, tool: "get_service_history", input: { vehicle_id: { toString: () => "vehicle-001" } } },
  { name: "history/accessor vehicle", preparation: 1, tool: "get_service_history", input: { get vehicle_id() { return "vehicle-001"; } } },
  { name: "history/case-mismatched vehicle", preparation: 1, tool: "get_service_history", input: { vehicle_id: "VEHICLE-001" } },
  { name: "history/double-encoded JSON", preparation: 1, tool: "get_service_history", input: JSON.stringify(JSON.stringify({ vehicle_id: "vehicle-001" })) },
  { name: "history/custom prototype pollution shape", preparation: 1, tool: "get_service_history", input: Object.assign(Object.create({ polluted: true }), { vehicle_id: "vehicle-001" }) },
  { name: "history/hidden property", preparation: 1, tool: "get_service_history", input: Object.defineProperty({ vehicle_id: "vehicle-001" }, "hidden", { value: true }) },

  { name: "search/missing service", preparation: 2, tool: "search_qualified_providers", input: { max_price_jpy: 60000, certification_required: true } },
  { name: "search/missing budget", preparation: 2, tool: "search_qualified_providers", input: { service_type: "ceramic-coating", certification_required: true } },
  { name: "search/missing certification", preparation: 2, tool: "search_qualified_providers", input: { service_type: "ceramic-coating", max_price_jpy: 60000 } },
  { name: "search/extra property", preparation: 2, tool: "search_qualified_providers", input: { service_type: "ceramic-coating", max_price_jpy: 60000, certification_required: true, provider_id: "provider-001" } },
  { name: "search/wrong service", preparation: 2, tool: "search_qualified_providers", input: { service_type: "paint", max_price_jpy: 60000, certification_required: true } },
  { name: "search/budget over limit", preparation: 2, tool: "search_qualified_providers", input: { service_type: "ceramic-coating", max_price_jpy: 60001, certification_required: true } },
  { name: "search/budget under limit", preparation: 2, tool: "search_qualified_providers", input: { service_type: "ceramic-coating", max_price_jpy: 59000, certification_required: true } },
  { name: "search/string budget", preparation: 2, tool: "search_qualified_providers", input: { service_type: "ceramic-coating", max_price_jpy: "60000", certification_required: true } },
  { name: "search/certification disabled", preparation: 2, tool: "search_qualified_providers", input: { service_type: "ceramic-coating", max_price_jpy: 60000, certification_required: false } },
  { name: "search/string certification", preparation: 2, tool: "search_qualified_providers", input: { service_type: "ceramic-coating", max_price_jpy: 60000, certification_required: "true" } },

  { name: "availability/missing providers", preparation: 3, tool: "check_provider_availability", input: { before: "2026-08-28T00:00:00+09:00" } },
  { name: "availability/missing deadline", preparation: 3, tool: "check_provider_availability", input: { provider_ids: ["provider-001", "provider-002", "provider-003"] } },
  { name: "availability/extra property", preparation: 3, tool: "check_provider_availability", input: { provider_ids: ["provider-001", "provider-002", "provider-003"], before: "2026-08-28T00:00:00+09:00", timezone: "JST" } },
  { name: "availability/providers not array", preparation: 3, tool: "check_provider_availability", input: { provider_ids: "provider-001", before: "2026-08-28T00:00:00+09:00" } },
  { name: "availability/coercible providers", preparation: 3, tool: "check_provider_availability", input: { provider_ids: [new String("provider-001"), new String("provider-002"), new String("provider-003")], before: "2026-08-28T00:00:00+09:00" } },
  { name: "availability/coercible deadline", preparation: 3, tool: "check_provider_availability", input: { provider_ids: ["provider-001", "provider-002", "provider-003"], before: new String("2026-08-28T00:00:00+09:00") } },
  { name: "availability/sparse providers", preparation: 3, tool: "check_provider_availability", input: { provider_ids: Array(3), before: "2026-08-28T00:00:00+09:00" } },
  { name: "availability/missing provider", preparation: 3, tool: "check_provider_availability", input: { provider_ids: ["provider-001", "provider-002"], before: "2026-08-28T00:00:00+09:00" } },
  { name: "availability/reordered providers", preparation: 3, tool: "check_provider_availability", input: { provider_ids: ["provider-002", "provider-001", "provider-003"], before: "2026-08-28T00:00:00+09:00" } },
  { name: "availability/duplicate provider", preparation: 3, tool: "check_provider_availability", input: { provider_ids: ["provider-001", "provider-001", "provider-003"], before: "2026-08-28T00:00:00+09:00" } },
  { name: "availability/unknown provider", preparation: 3, tool: "check_provider_availability", input: { provider_ids: ["provider-001", "provider-002", "provider-999"], before: "2026-08-28T00:00:00+09:00" } },
  { name: "availability/later deadline", preparation: 3, tool: "check_provider_availability", input: { provider_ids: ["provider-001", "provider-002", "provider-003"], before: "2026-08-30T00:00:00+09:00" } },
  { name: "availability/numeric deadline", preparation: 3, tool: "check_provider_availability", input: { provider_ids: ["provider-001", "provider-002", "provider-003"], before: 1787842800000 } },

  { name: "draft/missing provider", preparation: 4, tool: "create_dispatch_draft", input: { slot_id: "slot-001", quoted_price_jpy: 58000, rationale: "Certified, within budget, and can complete before the deadline." } },
  { name: "draft/missing slot", preparation: 4, tool: "create_dispatch_draft", input: { provider_id: "provider-001", quoted_price_jpy: 58000, rationale: "Certified, within budget, and can complete before the deadline." } },
  { name: "draft/missing price", preparation: 4, tool: "create_dispatch_draft", input: { provider_id: "provider-001", slot_id: "slot-001", rationale: "Certified, within budget, and can complete before the deadline." } },
  { name: "draft/missing rationale", preparation: 4, tool: "create_dispatch_draft", input: { provider_id: "provider-001", slot_id: "slot-001", quoted_price_jpy: 58000 } },
  { name: "draft/extra property", preparation: 4, tool: "create_dispatch_draft", input: { provider_id: "provider-001", slot_id: "slot-001", quoted_price_jpy: 58000, rationale: "Certified, within budget, and can complete before the deadline.", submit: true } },
  { name: "draft/unknown provider", preparation: 4, tool: "create_dispatch_draft", input: { provider_id: "provider-999", slot_id: "slot-001", quoted_price_jpy: 58000, rationale: "Certified, within budget, and can complete before the deadline." } },
  { name: "draft/uncertified provider", preparation: 4, tool: "create_dispatch_draft", input: { provider_id: "provider-002", slot_id: "slot-002", quoted_price_jpy: 48000, rationale: "Certified, within budget, and can complete before the deadline." } },
  { name: "draft/unavailable provider slot", preparation: 4, tool: "create_dispatch_draft", input: { provider_id: "provider-003", slot_id: "slot-003", quoted_price_jpy: 55000, rationale: "Certified, within budget, and can complete before the deadline." } },
  { name: "draft/wrong slot", preparation: 4, tool: "create_dispatch_draft", input: { provider_id: "provider-001", slot_id: "slot-002", quoted_price_jpy: 58000, rationale: "Certified, within budget, and can complete before the deadline." } },
  { name: "draft/price over budget", preparation: 4, tool: "create_dispatch_draft", input: { provider_id: "provider-001", slot_id: "slot-001", quoted_price_jpy: 61000, rationale: "Certified, within budget, and can complete before the deadline." } },
  { name: "draft/altered lower price", preparation: 4, tool: "create_dispatch_draft", input: { provider_id: "provider-001", slot_id: "slot-001", quoted_price_jpy: 57000, rationale: "Certified, within budget, and can complete before the deadline." } },
  { name: "draft/altered rationale", preparation: 4, tool: "create_dispatch_draft", input: { provider_id: "provider-001", slot_id: "slot-001", quoted_price_jpy: 58000, rationale: "Cheapest option." } },
  { name: "draft/numeric rationale", preparation: 4, tool: "create_dispatch_draft", input: { provider_id: "provider-001", slot_id: "slot-001", quoted_price_jpy: 58000, rationale: 1 } },
];

const successfulCallScenarios: AgentCallScenario[] = TOOL_SEQUENCE.map(
  (step, index) => ({
    name: `${step.name}/exact schema call`,
    preparation: index as Preparation,
    tool: step.name,
    input: step.input,
  }),
);

describe("synthetic agent-call readiness", () => {
  it("enumerates at least 60 explicit schema and callback scenarios", () => {
    expect(invalidCallScenarios.length + successfulCallScenarios.length).toBeGreaterThanOrEqual(60);
  });

  it.each(invalidCallScenarios)("rejects $name", async (scenario) => {
    const { registry } = setup();
    await prepare(registry, scenario.preparation);

    await expect(
      registry.executeNamedTool(
        scenario.tool,
        scenario.input as object,
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });

    await registry.stop();
  });

  it.each(successfulCallScenarios)("accepts $name", async (scenario) => {
    const { registry } = setup();
    await prepare(registry, scenario.preparation);

    await expect(
      registry.executeNamedTool(scenario.tool, scenario.input as object),
    ).resolves.toHaveProperty("structuredContent");

    await registry.stop();
  });

  it("rejects commit before approval because the capability does not exist", async () => {
    const { registry } = setup();
    await prepare(registry, 0);

    await expect(
      registry.executeNamedTool(COMMIT_TOOL_NAME, { approval_id: "none" }),
    ).rejects.toMatchObject({ code: "CAPABILITY_NOT_AVAILABLE" });
    await registry.stop();
  });

  it("rejects an incorrect approval ID without widening commit authority", async () => {
    const { adapter, registry, store } = setup();
    await prepare(registry, 4);
    await registry.executeNamedTool(TOOL_SEQUENCE[4].name, TOOL_SEQUENCE[4].input);
    await store.approveDraft();
    await waitForCommitTool(adapter, true);

    await expect(
      registry.executeNamedTool(COMMIT_TOOL_NAME, { approval_id: "approval-forged" }),
    ).rejects.toMatchObject({ code: "APPROVAL_NOT_FOUND" });
    expect(store.getSnapshot().phase).toBe("approved");
    await registry.stop();
  });

  it("rejects an expired approval and revokes its stale capability", async () => {
    let now = Date.parse("2026-08-26T03:00:00.000Z");
    const clock: Clock = { now: () => now };
    const { adapter, registry, store } = setup(clock);
    await prepare(registry, 4);
    await registry.executeNamedTool(TOOL_SEQUENCE[4].name, TOOL_SEQUENCE[4].input);
    const approval = await store.approveDraft();
    await waitForCommitTool(adapter, true);
    now += APPROVAL_TTL_MS;

    const outcome = await Promise.allSettled([
      registry.executeNamedTool(COMMIT_TOOL_NAME, {
        approval_id: approval.approval_id,
      }),
    ]);
    expect(outcome[0]?.status).toBe("rejected");
    if (outcome[0]?.status === "rejected") {
      const reason = outcome[0].reason as { code?: string; name?: string };
      expect([reason.code, reason.name]).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/CAPABILITY_NOT_AVAILABLE|InvalidStateError/),
        ]),
      );
    }
    expect(store.getSnapshot()).toMatchObject({
      phase: "draft_ready",
      approval: { status: "expired", used_at: null },
      committed_dispatch: null,
    });
    await waitForCommitTool(adapter, false);
    await registry.stop();
  });

  it("rejects an altered approved price and removes the capability", async () => {
    const { adapter, registry, store } = setup();
    await prepare(registry, 4);
    await registry.executeNamedTool(TOOL_SEQUENCE[4].name, TOOL_SEQUENCE[4].input);
    const approval = await store.approveDraft();
    await waitForCommitTool(adapter, true);
    store.mutateDraft({ quoted_price_jpy: 57_000 });

    await expect(
      store.commitApprovedDispatch(approval.approval_id, approval.generation),
    ).rejects.toMatchObject({ code: "DRAFT_CHANGED_AFTER_APPROVAL" });
    await waitForCommitTool(adapter, false);
    await registry.stop();
  });

  it("rejects replay after one successful exact commit", async () => {
    const { adapter, registry, store } = setup();
    await prepare(registry, 4);
    await registry.executeNamedTool(TOOL_SEQUENCE[4].name, TOOL_SEQUENCE[4].input);
    const approval = await store.approveDraft();
    await waitForCommitTool(adapter, true);
    await registry.executeNamedTool(COMMIT_TOOL_NAME, { approval_id: approval.approval_id });
    await waitForCommitTool(adapter, false);

    await expect(
      store.commitApprovedDispatch(approval.approval_id, approval.generation),
    ).rejects.toMatchObject({ code: "APPROVAL_ALREADY_USED" });
    await registry.stop();
  });

  it("rejects a captured commit tool after Reset", async () => {
    const { adapter, registry, store } = setup();
    await prepare(registry, 4);
    await registry.executeNamedTool(TOOL_SEQUENCE[4].name, TOOL_SEQUENCE[4].input);
    const approval = await store.approveDraft();
    await waitForCommitTool(adapter, true);
    const staleTool = (await adapter.getTools()).find(
      (tool) => tool.name === COMMIT_TOOL_NAME,
    )!;
    await registry.reset();

    await expect(
      adapter.executeTool(staleTool, { approval_id: approval.approval_id }),
    ).rejects.toMatchObject({ name: "InvalidStateError" });
    await registry.stop();
  });
});
