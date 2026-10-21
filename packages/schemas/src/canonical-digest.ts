import {
  sha256DigestSchema,
  type Sha256Digest,
} from "./architecture-document-v1.js";
import { serializeCanonicalJson } from "./canonical-json.js";

const sha256RoundConstants = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
] as const;

const sha256InitialHash = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
  0x1f83d9ab, 0x5be0cd19,
] as const;

function rotateRight(value: number, count: number): number {
  return (value >>> count) | (value << (32 - count));
}

/** Browser-neutral UTF-8 encoding with replacement for lone surrogates. */
export function encodeUtf8(value: string): Uint8Array {
  let byteLength = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x7f) {
      byteLength += 1;
    } else if (code <= 0x7ff) {
      byteLength += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        byteLength += 4;
        index += 1;
      } else {
        byteLength += 3;
      }
    } else {
      byteLength += 3;
    }
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (let index = 0; index < value.length; index += 1) {
    let codePoint = value.charCodeAt(index);
    if (codePoint <= 0x7f) {
      bytes[offset] = codePoint;
      offset += 1;
      continue;
    }
    if (codePoint <= 0x7ff) {
      bytes[offset] = 0xc0 | (codePoint >>> 6);
      bytes[offset + 1] = 0x80 | (codePoint & 0x3f);
      offset += 2;
      continue;
    }
    if (codePoint >= 0xd800 && codePoint <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        codePoint = 0x1_0000 + ((codePoint - 0xd800) << 10) + (next - 0xdc00);
        bytes[offset] = 0xf0 | (codePoint >>> 18);
        bytes[offset + 1] = 0x80 | ((codePoint >>> 12) & 0x3f);
        bytes[offset + 2] = 0x80 | ((codePoint >>> 6) & 0x3f);
        bytes[offset + 3] = 0x80 | (codePoint & 0x3f);
        offset += 4;
        index += 1;
        continue;
      }
      codePoint = 0xfffd;
    } else if (codePoint >= 0xdc00 && codePoint <= 0xdfff) {
      codePoint = 0xfffd;
    }
    bytes[offset] = 0xe0 | (codePoint >>> 12);
    bytes[offset + 1] = 0x80 | ((codePoint >>> 6) & 0x3f);
    bytes[offset + 2] = 0x80 | (codePoint & 0x3f);
    offset += 3;
  }
  return bytes;
}

function sha256Hex(bytes: Uint8Array): string {
  const totalLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const message = new Uint8Array(totalLength);
  message.set(bytes);
  message[bytes.length] = 0x80;
  const bitLength = bytes.length * 8;
  const high = Math.floor(bitLength / 0x1_0000_0000);
  const low = bitLength >>> 0;
  for (let index = 0; index < 4; index += 1) {
    message[totalLength - 8 + index] = (high >>> (24 - index * 8)) & 0xff;
    message[totalLength - 4 + index] = (low >>> (24 - index * 8)) & 0xff;
  }

  const hash: number[] = [...sha256InitialHash];
  const words = new Uint32Array(64);
  for (
    let messageOffset = 0;
    messageOffset < message.length;
    messageOffset += 64
  ) {
    for (let index = 0; index < 16; index += 1) {
      const wordOffset = messageOffset + index * 4;
      words[index] =
        ((message[wordOffset] ?? 0) << 24) |
        ((message[wordOffset + 1] ?? 0) << 16) |
        ((message[wordOffset + 2] ?? 0) << 8) |
        (message[wordOffset + 3] ?? 0);
    }
    for (let index = 16; index < 64; index += 1) {
      const previous15 = words[index - 15] ?? 0;
      const previous2 = words[index - 2] ?? 0;
      const sigma0 =
        rotateRight(previous15, 7) ^
        rotateRight(previous15, 18) ^
        (previous15 >>> 3);
      const sigma1 =
        rotateRight(previous2, 17) ^
        rotateRight(previous2, 19) ^
        (previous2 >>> 10);
      words[index] =
        ((words[index - 16] ?? 0) +
          sigma0 +
          (words[index - 7] ?? 0) +
          sigma1) >>>
        0;
    }

    let a = hash[0] ?? 0;
    let b = hash[1] ?? 0;
    let c = hash[2] ?? 0;
    let d = hash[3] ?? 0;
    let e = hash[4] ?? 0;
    let f = hash[5] ?? 0;
    let g = hash[6] ?? 0;
    let h = hash[7] ?? 0;
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temporary1 =
        (h +
          sum1 +
          choice +
          (sha256RoundConstants[index] ?? 0) +
          (words[index] ?? 0)) >>>
        0;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temporary2 = (sum0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temporary1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temporary1 + temporary2) >>> 0;
    }
    hash[0] = ((hash[0] ?? 0) + a) >>> 0;
    hash[1] = ((hash[1] ?? 0) + b) >>> 0;
    hash[2] = ((hash[2] ?? 0) + c) >>> 0;
    hash[3] = ((hash[3] ?? 0) + d) >>> 0;
    hash[4] = ((hash[4] ?? 0) + e) >>> 0;
    hash[5] = ((hash[5] ?? 0) + f) >>> 0;
    hash[6] = ((hash[6] ?? 0) + g) >>> 0;
    hash[7] = ((hash[7] ?? 0) + h) >>> 0;
  }
  return hash.map((word) => word.toString(16).padStart(8, "0")).join("");
}

/** Deterministic SHA-256 without Node or Web Crypto runtime authority. */
export function sha256Bytes(value: Uint8Array): Sha256Digest {
  return sha256DigestSchema.parse(`sha256:${sha256Hex(value)}`);
}

export function sha256Text(value: string): Sha256Digest {
  return sha256Bytes(encodeUtf8(value));
}

export function digestCanonicalValue(value: unknown): Sha256Digest {
  return sha256Text(serializeCanonicalJson(value));
}
