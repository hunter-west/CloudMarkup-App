import { createHash } from "node:crypto";

export function compareText(left, right) {
  return left === right ? 0 : left < right ? -1 : 1;
}

function normalizeForCanonicalJson(value) {
  if (Array.isArray(value)) {
    return value.map(normalizeForCanonicalJson);
  }

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => compareText(left, right))
        .map(([key, nested]) => [key, normalizeForCanonicalJson(nested)]),
    );
  }

  return value;
}

export function canonicalJson(value) {
  return `${JSON.stringify(normalizeForCanonicalJson(value), null, 2)}\n`;
}

export function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
