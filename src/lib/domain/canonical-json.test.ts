import { describe, expect, it } from "vitest";

import { buildDispatchDraft } from "./fixtures";
import { canonicalJson, sha256Hex } from "./canonical-json";

describe("canonical JSON and draft hashing", () => {
  it("is independent of object key insertion order", () => {
    const left = {
      provider: { id: "provider-001", price: 58_000 },
      slot: ["slot-001", { starts: "Thursday" }],
    };
    const right = {
      slot: ["slot-001", { starts: "Thursday" }],
      provider: { price: 58_000, id: "provider-001" },
    };

    expect(canonicalJson(left)).toBe(canonicalJson(right));
  });

  it("produces the same SHA-256 hash for the same exact draft", async () => {
    const first = buildDispatchDraft();
    const second = JSON.parse(JSON.stringify(first));

    await expect(sha256Hex(first)).resolves.toBe(await sha256Hex(second));
  });

  it("produces a different hash when any approved draft field changes", async () => {
    const draft = buildDispatchDraft();
    const changed = { ...draft, quoted_price_jpy: 57_999 };

    expect(await sha256Hex(draft)).not.toBe(await sha256Hex(changed));
  });

  it("rejects circular and non-finite data instead of hashing ambiguity", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(() => canonicalJson(circular)).toThrow(/circular/i);
    expect(() => canonicalJson({ value: Number.NaN })).toThrow(/non-finite/i);
  });
});

