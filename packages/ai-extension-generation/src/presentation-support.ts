import { digestCanonicalValue, sha256Text } from "@cloudmarkup/schemas";

export { digestCanonicalValue, sha256Text };

export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function portablePathKey(path: string): string {
  return path.normalize("NFC").toLowerCase();
}
