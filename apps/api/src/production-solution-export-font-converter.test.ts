import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { convertPinnedWoff1ToSfnt } from "./production-solution-export-font-converter.js";

const diagramRequire = createRequire(
  import.meta.resolve("@cloudmarkup/diagram-export"),
);
const source = (weight = 400) =>
  readFileSync(
    diagramRequire.resolve(
      "@fontsource/inter/files/inter-latin-" + String(weight) + "-normal.woff",
    ),
  );
const hash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const aligned = (length: number) => Math.ceil(length / 4) * 4;
function tables() {
  const bytes = source();
  return Array.from({ length: bytes.readUInt16BE(12) }, (_, index) => {
    const entry = 44 + index * 20;
    const offset = bytes.readUInt32BE(entry + 4);
    const stored = bytes.subarray(
      offset,
      offset + bytes.readUInt32BE(entry + 8),
    );
    const length = bytes.readUInt32BE(entry + 12);
    const data =
      stored.length === length ? Buffer.from(stored) : inflateSync(stored);
    return {
      tag: bytes.toString("ascii", entry, entry + 4),
      data,
      length,
      checksum: bytes.readUInt32BE(entry + 16),
      stored: Buffer.from(data),
    };
  });
}
function repack(entries: ReturnType<typeof tables>, reverse = false): Buffer {
  const headerSize = 44 + entries.length * 20;
  const output = Buffer.alloc(
    headerSize +
      entries.reduce((sum, table) => sum + aligned(table.stored.length), 0),
  );
  source().copy(output, 0, 0, 44);
  output.writeUInt32BE(output.length, 8);
  output.writeUInt16BE(entries.length, 12);
  output.writeUInt32BE(
    12 +
      entries.length * 16 +
      entries.reduce((sum, table) => sum + aligned(table.length), 0),
    16,
  );
  let offset = headerSize;
  for (const table of reverse ? [...entries].reverse() : entries) {
    const entry = 44 + entries.indexOf(table) * 20;
    output.write(table.tag, entry, "ascii");
    output.writeUInt32BE(offset, entry + 4);
    output.writeUInt32BE(table.stored.length, entry + 8);
    output.writeUInt32BE(table.length, entry + 12);
    output.writeUInt32BE(table.checksum, entry + 16);
    table.stored.copy(output, offset);
    offset += aligned(table.stored.length);
  }
  return output;
}
function table(entries: ReturnType<typeof tables>, tag: string) {
  const found = entries.find((entry) => entry.tag === tag);
  if (!found) throw new Error("Missing actual pinned font table.");
  return found;
}

describe("bounded pinned WOFF1 to SFNT conversion", () => {
  it.each([
    [
      400,
      30696,
      "e20fa0b4fd2dd26e4d14b3ac3cc922509c3a63fa5e910e90c614544aa042dd45",
      67952,
      "27396a89e10048c8e76096b1b4a5500bdc54d3b04d200f267ed6bf0d5466b2ba",
    ],
    [
      600,
      31260,
      "6a9cb3a509b4eeaf12b7dda6c4aacac3e85d07f4201bf4dd716e332e692b87bd",
      68060,
      "85c5903688f4329aaeebfc050fe6c3cb373f75ef1ff0a6f68d2640a870573584",
    ],
  ] as const)(
    "reproduces the pinned Inter %i font without mutating its source",
    (weight, size, digest, outputSize, outputDigest) => {
      const bytes = source(weight);
      expect(bytes.length).toBe(size);
      expect(hash(bytes)).toBe(digest);
      const output = Buffer.from(convertPinnedWoff1ToSfnt(bytes));
      expect(output.length).toBe(outputSize);
      expect(hash(output)).toBe(outputDigest);
      expect(convertPinnedWoff1ToSfnt(bytes)).toEqual(output);
      expect(hash(bytes)).toBe(digest);
      expect(output.readUInt32BE(0)).toBe(0x00010000);
      expect(
        [...Array(4).keys()].map((index) => output.readUInt16BE(4 + index * 2)),
      ).toEqual([15, 128, 3, 112]);
      let checksum = 0;
      for (let offset = 0; offset < output.length; offset += 4)
        checksum = (checksum + output.readUInt32BE(offset)) >>> 0;
      expect(checksum).toBe(0xb1b0afba);
    },
  );
  it("canonicalizes actual uncompressed tables and arbitrary physical table order", () => {
    const expected = convertPinnedWoff1ToSfnt(source());
    expect(convertPinnedWoff1ToSfnt(repack(tables()))).toEqual(expected);
    expect(convertPinnedWoff1ToSfnt(repack(tables(), true))).toEqual(expected);
  });
  it("recomputes only the derived head adjustment for the canonical layout", () => {
    const entries = tables();
    const head = table(entries, "head");
    head.stored.writeUInt32BE(0, 8);
    expect(convertPinnedWoff1ToSfnt(repack(entries))).toEqual(
      convertPinnedWoff1ToSfnt(source()),
    );
  });
  const mutations: readonly [string, (bytes: Buffer) => void][] = [
    [
      "WOFF2 signature",
      (b) => {
        b.write("wOF2", 0);
      },
    ],
    [
      "unreviewed flavor",
      (b) => {
        b.write("OTTO", 4);
      },
    ],
    [
      "mismatched length",
      (b) => {
        b.writeUInt32BE(b.length - 4, 8);
      },
    ],
    [
      "reserved field",
      (b) => {
        b.writeUInt16BE(1, 14);
      },
    ],
    [
      "unreviewed major version",
      (b) => {
        b.writeUInt16BE(2, 20);
      },
    ],
    [
      "unreviewed minor version",
      (b) => {
        b.writeUInt16BE(2, 22);
      },
    ],
    [
      "zero table count",
      (b) => {
        b.writeUInt16BE(0, 12);
      },
    ],
    [
      "excessive table count",
      (b) => {
        b.writeUInt16BE(65, 12);
      },
    ],
    [
      "wrong reconstructed length",
      (b) => {
        b.writeUInt32BE(b.readUInt32BE(16) + 4, 16);
      },
    ],
    [
      "excessive reconstructed length",
      (b) => {
        b.writeUInt32BE(2 * 1024 * 1024 + 4, 16);
      },
    ],
    [
      "optional metadata",
      (b) => {
        b.writeUInt32BE(1, 24);
      },
    ],
    [
      "optional private block",
      (b) => {
        b.writeUInt32BE(1, 36);
      },
    ],
    [
      "duplicate tag",
      (b) => {
        b.copy(b, 64, 44, 48);
      },
    ],
    [
      "invalid tag",
      (b) => {
        b[44] = 0;
      },
    ],
    [
      "directory overlap",
      (b) => {
        b.writeUInt32BE(44, 48);
      },
    ],
    [
      "table overlap",
      (b) => {
        b.writeUInt32BE(b.readUInt32BE(48), 68);
      },
    ],
    [
      "unaligned table",
      (b) => {
        b.writeUInt32BE(b.readUInt32BE(48) + 1, 48);
      },
    ],
    [
      "table gap",
      (b) => {
        b.writeUInt32BE(b.readUInt32BE(48) + 4, 48);
      },
    ],
    [
      "out-of-range table",
      (b) => {
        b.writeUInt32BE(0xfffffffc, 48);
      },
    ],
    [
      "zero length",
      (b) => {
        b.writeUInt32BE(0, 52);
      },
    ],
    [
      "compressed length exceeds original",
      (b) => {
        b.writeUInt32BE(b.readUInt32BE(56) + 1, 52);
      },
    ],
    [
      "nonzero padding",
      (b) => {
        b[b.readUInt32BE(48) + b.readUInt32BE(52)] = 1;
      },
    ],
    [
      "table checksum mismatch",
      (b) => {
        b.writeUInt32BE(0, 60);
      },
    ],
    [
      "invalid zlib stream",
      (b) => {
        b[b.readUInt32BE(48)] = 0;
      },
    ],
  ];
  it.each(
    mutations.filter(
      ([name]) =>
        ![
          "reserved field",
          "unreviewed major version",
          "unreviewed minor version",
          "optional metadata",
          "optional private block",
          "table gap",
          "WOFF2 signature",
          "unreviewed flavor",
          "zero table count",
          "invalid tag",
          "unaligned table",
        ].includes(name),
    ),
  )("rejects %s", (_name, mutate) => {
    const bytes = source();
    mutate(bytes);
    expect(() => convertPinnedWoff1ToSfnt(bytes)).toThrow();
  });
  it.each([43, 1024 * 1024 + 1])(
    "rejects input of %i bytes before allocation",
    (length) => {
      expect(() => convertPinnedWoff1ToSfnt(new Uint8Array(length))).toThrow();
    },
  );
  it.each([-4, 4])(
    "rejects zlib output not matching declared size (%i)",
    (delta) => {
      const entries = tables();
      const first = table(entries, "GDEF");
      const bytes = source();
      first.stored = Buffer.from(
        bytes.subarray(
          bytes.readUInt32BE(48),
          bytes.readUInt32BE(48) + bytes.readUInt32BE(52),
        ),
      );
      first.length += delta;
      expect(() => convertPinnedWoff1ToSfnt(repack(entries))).toThrow();
    },
  );
  it("rejects bytes trailing the end of a compressed table", () => {
    const entries = tables();
    const bytes = source();
    table(entries, "GDEF").stored = Buffer.concat([
      bytes.subarray(
        bytes.readUInt32BE(48),
        bytes.readUInt32BE(48) + bytes.readUInt32BE(52),
      ),
      Buffer.from([0]),
    ]);
    expect(() => convertPinnedWoff1ToSfnt(repack(entries))).toThrow();
  });
  it("rejects extraneous bytes after the final table", () => {
    const bytes = Buffer.concat([source(), Buffer.alloc(4)]);
    bytes.writeUInt32BE(bytes.length, 8);
    expect(() => convertPinnedWoff1ToSfnt(bytes)).toThrow();
  });
  it("rejects a digital signature instead of invalidating it during reconstruction", () => {
    const entries = tables();
    table(entries, "GDEF").tag = "DSIG";
    expect(() => convertPinnedWoff1ToSfnt(repack(entries))).toThrow();
  });
  it.each([0, 12])(
    "rejects unsupported head version/magic at offset %i",
    (offset) => {
      const entries = tables();
      table(entries, "head").stored.writeUInt32BE(0, offset);
      expect(() => convertPinnedWoff1ToSfnt(repack(entries))).toThrow();
    },
  );
});
