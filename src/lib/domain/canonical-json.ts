type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

function normalizeJson(value: unknown, seen: WeakSet<object>): JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Canonical JSON does not support non-finite numbers.");
    }
    return value;
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      throw new TypeError("Canonical JSON does not support circular values.");
    }
    seen.add(value);
    const normalized = value.map((item) => normalizeJson(item, seen));
    seen.delete(value);
    return normalized;
  }

  if (typeof value === "object") {
    if (seen.has(value)) {
      throw new TypeError("Canonical JSON does not support circular values.");
    }
    seen.add(value);

    const record = value as Record<string, unknown>;
    const normalized: Record<string, JsonValue> = {};
    for (const key of Object.keys(record).sort()) {
      const item = record[key];
      if (item === undefined || typeof item === "function" || typeof item === "symbol") {
        throw new TypeError(`Canonical JSON cannot encode property "${key}".`);
      }
      normalized[key] = normalizeJson(item, seen);
    }

    seen.delete(value);
    return normalized;
  }

  throw new TypeError(`Canonical JSON cannot encode ${typeof value} values.`);
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalizeJson(value, new WeakSet()));
}

export async function sha256Hex(value: unknown): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error("SHA-256 is unavailable in this runtime.");
  }

  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

