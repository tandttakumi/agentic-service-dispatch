import { describe, expect, it, vi } from "vitest";

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

  it("rejects accessor and hidden properties without evaluating them", () => {
    const value = {} as Record<string, unknown>;
    const accessor = vi.fn(() => 58_000);
    Object.defineProperty(value, "price", {
      enumerable: false,
      get: accessor,
    });

    expect(() => canonicalJson(value)).toThrow(/data property "price"/i);
    expect(accessor).not.toHaveBeenCalled();
  });

  it("rejects symbol keys and ambiguous array shapes", () => {
    const symbolBacked = { provider: "provider-001" } as Record<
      string | symbol,
      unknown
    >;
    symbolBacked[Symbol("price")] = 58_000;
    const sparse = Array(1) as unknown[];

    expect(() => canonicalJson(symbolBacked)).toThrow(/symbol keys/i);
    expect(() => canonicalJson(sparse)).toThrow(/sparse arrays/i);
  });

  it("rejects unsupported root and property value types", () => {
    expect(() => canonicalJson(undefined)).toThrow(/undefined values/i);
    expect(() => canonicalJson(() => undefined)).toThrow(/function values/i);
    expect(() => canonicalJson(Symbol("draft"))).toThrow(/symbol values/i);
    expect(() => canonicalJson({ value: undefined })).toThrow(
      /cannot encode property "value"/i,
    );
    expect(() => canonicalJson({ value: () => undefined })).toThrow(
      /cannot encode property "value"/i,
    );
    expect(() => canonicalJson({ value: Symbol("draft") })).toThrow(
      /cannot encode property "value"/i,
    );
  });

  it("rejects non-plain objects and extended arrays", () => {
    class DraftRecord {
      provider = "provider-001";
    }
    class DraftArray extends Array<string> {}
    const extended = ["provider-001"] as string[] & { extra?: string };
    extended.extra = "slot-001";

    expect(() => canonicalJson(new Date(0))).toThrow(/plain objects/i);
    expect(() => canonicalJson(new Map())).toThrow(/plain objects/i);
    expect(() => canonicalJson(new DraftRecord())).toThrow(/plain objects/i);
    expect(() => canonicalJson(new DraftArray("provider-001"))).toThrow(
      /plain arrays/i,
    );
    expect(() => canonicalJson(extended)).toThrow(/plain arrays/i);
  });

  it("treats an own __proto__ key as data without prototype mutation", () => {
    const value = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(value, "__proto__", {
      enumerable: true,
      value: { polluted: true },
    });

    const parsed = JSON.parse(canonicalJson(value)) as Record<string, unknown>;

    expect(Object.hasOwn(parsed, "__proto__")).toBe(true);
    expect(parsed["__proto__"]).toEqual({ polluted: true });
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it("fails closed when SHA-256 is unavailable", async () => {
    vi.stubGlobal("crypto", undefined);
    try {
      await expect(sha256Hex({ draft_id: "D-1042" })).rejects.toThrow(
        /SHA-256 is unavailable/i,
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
