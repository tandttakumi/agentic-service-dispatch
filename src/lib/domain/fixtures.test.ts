import { describe, expect, it } from "vitest";

import {
  DRAFT_INPUT,
  PROVIDERS,
  REQUEST_CONDITIONS,
  SCENARIO_NOW,
  SERVICE_HISTORY,
  buildDispatchDraft,
  evaluateProviders,
} from "./fixtures";

describe("fictional provider qualification", () => {
  it("selects only Kairo Detail Works", () => {
    const matches = evaluateProviders().filter((evaluation) => evaluation.matches);

    expect(matches).toHaveLength(1);
    expect(matches[0].provider.name).toBe("Kairo Detail Works");
    expect(matches[0].provider.price_jpy).toBe(58_000);
  });

  it("explains the certification exclusion", () => {
    const brightlane = evaluateProviders().find(
      (evaluation) => evaluation.provider.id === "provider-002",
    );

    expect(brightlane).toMatchObject({
      matches: false,
      certification_matches: false,
      deadline_matches: true,
    });
    expect(brightlane?.reason).toMatch(/certification is missing/i);
  });

  it("explains the deadline exclusion", () => {
    const lumen = evaluateProviders().find(
      (evaluation) => evaluation.provider.id === "provider-003",
    );

    expect(lumen).toMatchObject({
      matches: false,
      certification_matches: true,
      deadline_matches: false,
    });
    expect(lumen?.reason).toMatch(/completed by the deadline/i);

    const overBudget = {
      ...PROVIDERS[0],
      price_jpy: REQUEST_CONDITIONS.max_price_jpy + 1,
    };
    expect(evaluateProviders([overBudget])[0]).toMatchObject({
      matches: false,
      certification_matches: true,
      budget_matches: false,
      deadline_matches: true,
      reason: "Excluded — quoted price exceeds the approved budget.",
    });
  });

  it("rejects a slot that starts before but finishes after the deadline", () => {
    const crossingDeadline = {
      ...PROVIDERS[0],
      slot: {
        ...PROVIDERS[0].slot,
        starts_at: "2026-08-27T23:30:00+09:00",
        ends_at: "2026-08-28T00:30:00+09:00",
      },
    };

    expect(evaluateProviders([crossingDeadline])[0]).toMatchObject({
      matches: false,
      deadline_matches: false,
    });
  });

  it("contains exactly three fictional providers available at scenario time", () => {
    expect(PROVIDERS.map((provider) => provider.name)).toEqual([
      "Kairo Detail Works",
      "Brightlane Auto Care",
      "Lumen Finish Studio",
    ]);
    const scenarioNow = Date.parse(SCENARIO_NOW);

    expect(Date.parse(REQUEST_CONDITIONS.completion_before)).toBeGreaterThan(
      scenarioNow,
    );
    for (const history of SERVICE_HISTORY) {
      expect(Date.parse(history.completed_at)).toBeLessThan(scenarioNow);
    }

    for (const provider of PROVIDERS) {
      expect(Date.parse(provider.slot.starts_at)).toBeGreaterThanOrEqual(
        scenarioNow,
      );
      expect(Date.parse(provider.slot.ends_at)).toBeGreaterThan(
        Date.parse(provider.slot.starts_at),
      );
    }

    const selected = PROVIDERS[0];
    expect(Date.parse(selected.slot.ends_at)).toBeLessThanOrEqual(
      Date.parse(REQUEST_CONDITIONS.completion_before),
    );
    expect(() =>
      buildDispatchDraft({
        ...DRAFT_INPUT,
        slot_id: "slot-002" as typeof DRAFT_INPUT.slot_id,
      }),
    ).toThrow(/provider or slot does not exist/i);
  });
});
