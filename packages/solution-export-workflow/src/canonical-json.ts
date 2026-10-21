import { serializeCanonicalJson } from "@cloudmarkup/schemas";
import { sha256Digest } from "@cloudmarkup/solution-export";

export function canonicalEqual(left: unknown, right: unknown): boolean {
  try {
    return serializeCanonicalJson(left) === serializeCanonicalJson(right);
  } catch {
    return false;
  }
}

export function resolvedJsonMatchesReference(
  value: unknown,
  reference: {
    readonly digest: string;
    readonly sizeBytes: number;
  },
): boolean {
  try {
    const bytes = new TextEncoder().encode(serializeCanonicalJson(value));
    return (
      bytes.byteLength === reference.sizeBytes &&
      sha256Digest(bytes) === reference.digest
    );
  } catch {
    return false;
  }
}
