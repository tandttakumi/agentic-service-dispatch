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
    if (Object.getPrototypeOf(value) !== Array.prototype) {
      throw new TypeError("Canonical JSON supports only plain arrays.");
    }
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    if (!lengthDescriptor || !("value" in lengthDescriptor)) {
      throw new TypeError("Canonical JSON supports only plain arrays.");
    }
    const length = lengthDescriptor.value as number;
    const ownNames = Object.getOwnPropertyNames(value);
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new TypeError("Canonical JSON supports only plain arrays.");
    }
    seen.add(value);
    const normalized: JsonValue[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, index);
      if (!descriptor) {
        throw new TypeError("Canonical JSON does not support sparse arrays.");
      }
      if (!("value" in descriptor)) {
        throw new TypeError(
          `Canonical JSON supports only data index "${index}".`,
        );
      }
      normalized.push(normalizeJson(descriptor.value, seen));
    }
    if (ownNames.length !== length + 1) {
      throw new TypeError("Canonical JSON supports only plain arrays.");
    }
    seen.delete(value);
    return normalized;
  }

  if (typeof value === "object") {
    if (seen.has(value)) {
      throw new TypeError("Canonical JSON does not support circular values.");
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Canonical JSON supports only plain objects.");
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new TypeError("Canonical JSON does not support symbol keys.");
    }
    seen.add(value);

    const record = value as Record<string, unknown>;
    const normalized: Record<string, JsonValue> = Object.create(null) as Record<
      string,
      JsonValue
    >;
    for (const key of Object.getOwnPropertyNames(record).sort()) {
      const descriptor = Object.getOwnPropertyDescriptor(record, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        throw new TypeError(
          `Canonical JSON supports only data property "${key}".`,
        );
      }
      const item = descriptor.value;
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
