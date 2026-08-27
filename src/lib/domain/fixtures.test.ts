import { describe, expect, it } from "vitest";

import { PROVIDERS, evaluateProviders } from "./fixtures";

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
    expect(lumen?.reason).toMatch(/after the deadline/i);
  });

  it("contains exactly three fictional providers", () => {
    expect(PROVIDERS.map((provider) => provider.name)).toEqual([
      "Kairo Detail Works",
      "Brightlane Auto Care",
      "Lumen Finish Studio",
    ]);
  });
});

