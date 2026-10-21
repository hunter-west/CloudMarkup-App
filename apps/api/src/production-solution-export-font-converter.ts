import { inflateSync } from "node:zlib";

const MAXIMUM_WOFF_BYTES = 1024 * 1024;
const MAXIMUM_SFNT_BYTES = 2 * 1024 * 1024;
const MAXIMUM_TABLES = 64;
const aligned = (length: number) => Math.ceil(length / 4) * 4;
function requireFont(value: boolean): asserts value {
  if (!value)
    throw new TypeError("The pinned WOFF1 font is invalid or unsupported.");
}
function checksum(bytes: Uint8Array, head = false): number {
  let sum = 0;
  for (let offset = 0; offset < bytes.byteLength; offset += 4) {
    if (head && offset === 8) continue;
    let word = 0;
    for (let index = 0; index < 4; index += 1)
      word = word * 256 + (bytes[offset + index] ?? 0);
    sum = (sum + word) >>> 0;
  }
  return sum;
}
function inflateTable(bytes: Uint8Array, length: number): Buffer {
  // Node's declarations omit the documented info:true result shape. Validate
  // that shape rather than trusting a type assertion or unbounded inflate.
  const result: unknown = inflateSync(bytes, {
    maxOutputLength: length,
    info: true,
  });
  requireFont(
    typeof result === "object" &&
      result !== null &&
      "buffer" in result &&
      Buffer.isBuffer(result.buffer) &&
      "engine" in result &&
      typeof result.engine === "object" &&
      result.engine !== null &&
      "bytesWritten" in result.engine &&
      result.engine.bytesWritten === bytes.byteLength,
  );
  return result.buffer;
}

/** Pure build-time decoding for the separately hash-pinned Inter WOFF1 assets.
 * WOFF 1.0 (https://www.w3.org/TR/WOFF/), not WOFF2 or a general font importer.
 * Only reviewed TrueType flavor / font package version 1.1, without optional
 * metadata/private blocks, is admitted. The caller verifies input/output SHA.
 * Preserve every validated table, emit canonical tag order, and recompute the
 * derived head checksumAdjustment for the reconstructed SFNT directory. The
 * source WOFF checksumAdjustment is not a checksum of this new layout. Signed
 * fonts are rejected; no glyphs, layout features or names are modified.
 */
export function convertPinnedWoff1ToSfnt(input: Uint8Array): Uint8Array {
  requireFont(input.byteLength >= 44 && input.byteLength <= MAXIMUM_WOFF_BYTES);
  const source = Buffer.from(input);
  const count = source.readUInt16BE(12);
  const totalSize = source.readUInt32BE(16);
  requireFont(
    source.readUInt32BE(0) === 0x774f4646 &&
      source.readUInt32BE(4) === 0x00010000 &&
      source.readUInt32BE(8) === source.byteLength &&
      source.readUInt16BE(14) === 0 &&
      source.readUInt16BE(20) === 1 &&
      source.readUInt16BE(22) === 1 &&
      count > 0 &&
      count <= MAXIMUM_TABLES &&
      44 + count * 20 <= source.byteLength &&
      totalSize <= MAXIMUM_SFNT_BYTES &&
      totalSize % 4 === 0,
  );
  for (let offset = 24; offset < 44; offset += 4)
    requireFont(source.readUInt32BE(offset) === 0);
  const tables: {
    tag: number;
    name: string;
    offset: number;
    compressedLength: number;
    originalLength: number;
    originalChecksum: number;
    index: number;
  }[] = [];
  let expectedSize = 12 + count * 16;
  let previousTag = -1;
  for (let index = 0; index < count; index += 1) {
    const entry = 44 + index * 20;
    const tag = source.readUInt32BE(entry);
    const name = source.toString("latin1", entry, entry + 4);
    const offset = source.readUInt32BE(entry + 4);
    const compressedLength = source.readUInt32BE(entry + 8);
    const originalLength = source.readUInt32BE(entry + 12);
    requireFont(
      /^[\x21-\x7e]{1,4} *$/u.test(name) &&
        tag > previousTag &&
        name !== "DSIG" &&
        offset % 4 === 0 &&
        offset >= 44 + count * 20 &&
        compressedLength > 0 &&
        compressedLength <= originalLength &&
        originalLength <= MAXIMUM_SFNT_BYTES &&
        offset + aligned(compressedLength) <= source.byteLength,
    );
    previousTag = tag;
    expectedSize += aligned(originalLength);
    requireFont(expectedSize <= MAXIMUM_SFNT_BYTES);
    tables.push({
      tag,
      name,
      offset,
      compressedLength,
      originalLength,
      originalChecksum: source.readUInt32BE(entry + 16),
      index,
    });
  }
  requireFont(
    expectedSize === totalSize && tables.some((table) => table.name === "head"),
  );
  const physical = [...tables].sort(
    (left, right) => left.offset - right.offset,
  );
  let sourceOffset = 44 + count * 20;
  for (const table of physical) {
    requireFont(table.offset === sourceOffset);
    sourceOffset += aligned(table.compressedLength);
    for (
      let offset = table.offset + table.compressedLength;
      offset < sourceOffset;
      offset += 1
    )
      requireFont(source[offset] === 0);
  }
  requireFont(sourceOffset === source.byteLength);
  const output = Buffer.alloc(totalSize);
  output.writeUInt32BE(0x00010000, 0);
  output.writeUInt16BE(count, 4);
  const selector = Math.floor(Math.log2(count));
  const searchRange = 2 ** selector * 16;
  output.writeUInt16BE(searchRange, 6);
  output.writeUInt16BE(selector, 8);
  output.writeUInt16BE(count * 16 - searchRange, 10);
  let targetOffset = 12 + count * 16;
  let headOffset = -1;
  for (const table of tables) {
    const packed = source.subarray(
      table.offset,
      table.offset + table.compressedLength,
    );
    const bytes =
      table.compressedLength === table.originalLength
        ? packed
        : inflateTable(packed, table.originalLength);
    requireFont(bytes.byteLength === table.originalLength);
    if (table.name === "head")
      requireFont(
        bytes.byteLength === 54 &&
          bytes.readUInt32BE(0) === 0x00010000 &&
          bytes.readUInt32BE(12) === 0x5f0f3cf5,
      );
    requireFont(
      checksum(bytes, table.name === "head") === table.originalChecksum,
    );
    const entry = 12 + table.index * 16;
    output.writeUInt32BE(table.tag, entry);
    output.writeUInt32BE(table.originalChecksum, entry + 4);
    output.writeUInt32BE(targetOffset, entry + 8);
    output.writeUInt32BE(table.originalLength, entry + 12);
    bytes.copy(output, targetOffset);
    if (table.name === "head") {
      headOffset = targetOffset;
      output.writeUInt32BE(0, headOffset + 8);
    }
    targetOffset += aligned(table.originalLength);
  }
  requireFont(targetOffset === totalSize && headOffset >= 0);
  output.writeUInt32BE((0xb1b0afba - checksum(output)) >>> 0, headOffset + 8);
  requireFont(checksum(output) === 0xb1b0afba);
  return output;
}
