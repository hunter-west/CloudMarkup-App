import { compareUtf16, utf8Bytes } from "./security.js";

const crcTable = new Uint32Array(256);
for (let index = 0; index < crcTable.length; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  crcTable[index] = value >>> 0;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes)
    crc = (crcTable[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function concat(chunks: readonly Uint8Array[]): Uint8Array {
  const output = new Uint8Array(
    chunks.reduce((total, chunk) => total + chunk.byteLength, 0),
  );
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

export interface ApplicationZipEntry {
  readonly bytes: Uint8Array;
  readonly path: string;
}

export function createDeterministicLambdaZip(
  rawEntries: readonly ApplicationZipEntry[],
): Uint8Array {
  const entries = [...rawEntries].sort((left, right) =>
    compareUtf16(left.path, right.path),
  );
  if (entries.length === 0 || entries.length > 0xffff)
    throw new RangeError("Lambda ZIP entry count is invalid.");
  const portable = new Set<string>();
  const locals: Uint8Array[] = [];
  const records: {
    crc: number;
    offset: number;
    path: Uint8Array;
    size: number;
  }[] = [];
  let offset = 0;
  for (const entry of entries) {
    if (
      !/^[A-Za-z0-9@._/-]+$/u.test(entry.path) ||
      entry.path.startsWith("/") ||
      entry.path
        .split("/")
        .some((part) => part === "" || part === "." || part === "..")
    ) {
      throw new TypeError("Lambda ZIP path is unsafe.");
    }
    const key = entry.path.normalize("NFC").toLowerCase();
    if (portable.has(key))
      throw new TypeError("Lambda ZIP paths are not unique.");
    portable.add(key);
    const path = utf8Bytes(entry.path);
    const size = entry.bytes.byteLength;
    if (path.byteLength > 0xffff || size > 0xffffffff)
      throw new RangeError("Lambda ZIP32 bound exceeded.");
    const crc = crc32(entry.bytes);
    const header = new Uint8Array(30);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0x0800, true);
    view.setUint16(8, 0, true);
    view.setUint16(10, 0, true);
    view.setUint16(12, 0x0021, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, size, true);
    view.setUint32(22, size, true);
    view.setUint16(26, path.byteLength, true);
    locals.push(header, path, entry.bytes);
    records.push({ crc, offset, path, size });
    offset += 30 + path.byteLength + size;
  }
  const centrals: Uint8Array[] = [];
  for (const record of records) {
    const header = new Uint8Array(46);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x02014b50, true);
    view.setUint16(4, 0x0314, true);
    view.setUint16(6, 20, true);
    view.setUint16(8, 0x0800, true);
    view.setUint16(10, 0, true);
    view.setUint16(12, 0, true);
    view.setUint16(14, 0x0021, true);
    view.setUint32(16, record.crc, true);
    view.setUint32(20, record.size, true);
    view.setUint32(24, record.size, true);
    view.setUint16(28, record.path.byteLength, true);
    view.setUint32(38, (0o100644 * 65_536) >>> 0, true);
    view.setUint32(42, record.offset, true);
    centrals.push(header, record.path);
  }
  const central = concat(centrals);
  const end = new Uint8Array(22);
  const view = new DataView(end.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(8, records.length, true);
  view.setUint16(10, records.length, true);
  view.setUint32(12, central.byteLength, true);
  view.setUint32(16, offset, true);
  return concat([...locals, central, end]);
}
