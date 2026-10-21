import type { ArchitectureDocumentV1 } from "./architecture-document-v1.js";
import type { ArchitectureDocumentV2 } from "./architecture-document-v2.js";
import type { ArchitectureDocumentV3 } from "./architecture-document-v3.js";
import {
  normalizeArchitectureDocumentV1,
  normalizeArchitectureDocumentV2,
  normalizeArchitectureDocumentV3,
} from "./architecture-normalization.js";
import type { IntentDocumentV1 } from "./intent-document-v1.js";
import { normalizeIntentDocumentV1 } from "./intent-normalization.js";

type CanonicalJsonPrimitive = boolean | number | string | null;
type CanonicalJsonValue =
  | CanonicalJsonPrimitive
  | readonly CanonicalJsonValue[]
  | { readonly [key: string]: CanonicalJsonValue };

function compareUtf16(left: string, right: string): number {
  if (left === right) {
    return 0;
  }

  return left < right ? -1 : 1;
}

function canonicalizeJsonValue(value: unknown): CanonicalJsonValue {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(
        "Canonical JSON does not support non-finite numbers.",
      );
    }

    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeJsonValue(item));
  }

  if (typeof value === "object") {
    const entries = Object.entries(value)
      .filter((entry) => entry[1] !== undefined)
      .sort(([left], [right]) => compareUtf16(left, right));

    return Object.fromEntries(
      entries.map(([key, entryValue]) => [
        key,
        canonicalizeJsonValue(entryValue),
      ]),
    );
  }

  throw new TypeError(`Unsupported canonical JSON value: ${typeof value}.`);
}

export function serializeCanonicalJson(value: unknown): string {
  return `${JSON.stringify(canonicalizeJsonValue(value), null, 2)}\n`;
}

export function serializeArchitectureDocumentV1(
  document: ArchitectureDocumentV1,
): string {
  return serializeCanonicalJson(normalizeArchitectureDocumentV1(document));
}

export function serializeArchitectureDocumentV2(
  document: ArchitectureDocumentV2,
): string {
  return serializeCanonicalJson(normalizeArchitectureDocumentV2(document));
}

export function serializeArchitectureDocumentV3(
  document: ArchitectureDocumentV3,
): string {
  return serializeCanonicalJson(normalizeArchitectureDocumentV3(document));
}

export function serializeIntentDocumentV1(document: IntentDocumentV1): string {
  return serializeCanonicalJson(normalizeIntentDocumentV1(document));
}
