import { sha256Bytes } from "@cloudmarkup/schemas";

// Preserve the domain's existing encoding of lone UTF-16 surrogates.
function encodeUtf8(value: string): Uint8Array {
  const bytes: number[] = [];

  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) {
      continue;
    }

    if (codePoint <= 0x7f) {
      bytes.push(codePoint);
    } else if (codePoint <= 0x7ff) {
      bytes.push(0xc0 | (codePoint >>> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint <= 0xffff) {
      bytes.push(
        0xe0 | (codePoint >>> 12),
        0x80 | ((codePoint >>> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    } else {
      bytes.push(
        0xf0 | (codePoint >>> 18),
        0x80 | ((codePoint >>> 12) & 0x3f),
        0x80 | ((codePoint >>> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }

  return Uint8Array.from(bytes);
}

export function sha256Hex(value: string): string {
  return sha256Bytes(encodeUtf8(value)).slice("sha256:".length);
}
