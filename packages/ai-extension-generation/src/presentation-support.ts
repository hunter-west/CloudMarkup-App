import { digestCanonicalValue, sha256Text } from "@cloudmarkup/schemas";

export { digestCanonicalValue, sha256Text };

/** Compare schema-validated UTC instants without discarding fractional precision. */
export function compareUtcInstants(left: string, right: string): number {
  const key = (value: string): string =>
    `${value.slice(0, 19)}.${value.slice(20, -1).replace(/0+$/u, "")}`;
  const leftKey = key(left);
  const rightKey = key(right);
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}

export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function portablePathKey(path: string): string {
  return path.normalize("NFC").toLowerCase();
}
