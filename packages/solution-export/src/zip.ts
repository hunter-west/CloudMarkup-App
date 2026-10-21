import { SOLUTION_EXPORT_V1_MAXIMA } from "./contracts.js";
import {
  compareUtf16,
  decodeUtf8,
  encodeUtf8,
  inspectExportPath,
} from "./security.js";

const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const UTF8_FLAG = 0x0800;
const STORE_METHOD = 0;
const DOS_TIME = 0;
const DOS_DATE = 0x0021;
const VERSION_NEEDED = 20;
const VERSION_MADE_BY_UNIX = 0x0314;
const REGULAR_FILE_MODE = 0o100644;

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
  for (const byte of bytes) {
    const tableIndex = (crc ^ byte) & 0xff;
    crc = (crcTable[tableIndex] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function concatenate(chunks: readonly Uint8Array[]): Uint8Array {
  const size = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function uint32Size(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) {
    throw new RangeError(`${label} exceeds the deterministic ZIP32 bound.`);
  }
  return value;
}

export interface DeterministicZipInputEntry {
  readonly bytes: Uint8Array;
  readonly path: string;
}

export interface DeterministicZipEntry {
  readonly bytes: Uint8Array;
  readonly checksumCrc32: number;
  readonly path: string;
}

interface CentralRecord {
  readonly bytes: Uint8Array;
  readonly localOffset: number;
  readonly pathBytes: Uint8Array;
  readonly crc: number;
}

export function createDeterministicZip(
  entries: readonly DeterministicZipInputEntry[],
): Uint8Array {
  if (entries.length > 0xffff) {
    throw new RangeError("Deterministic ZIP entry count exceeds ZIP32.");
  }

  const localChunks: Uint8Array[] = [];
  const records: CentralRecord[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const pathBytes = encodeUtf8(entry.path);
    if (pathBytes.byteLength > 0xffff) {
      throw new RangeError("Deterministic ZIP path exceeds ZIP32.");
    }
    const size = uint32Size(entry.bytes.byteLength, "Entry size");
    const crc = crc32(entry.bytes);
    const header = new Uint8Array(30);
    const view = new DataView(header.buffer);
    view.setUint32(0, LOCAL_FILE_HEADER_SIGNATURE, true);
    view.setUint16(4, VERSION_NEEDED, true);
    view.setUint16(6, UTF8_FLAG, true);
    view.setUint16(8, STORE_METHOD, true);
    view.setUint16(10, DOS_TIME, true);
    view.setUint16(12, DOS_DATE, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, size, true);
    view.setUint32(22, size, true);
    view.setUint16(26, pathBytes.byteLength, true);
    view.setUint16(28, 0, true);
    localChunks.push(header, pathBytes, entry.bytes);
    records.push({ bytes: entry.bytes, crc, localOffset, pathBytes });
    localOffset = uint32Size(
      localOffset + header.byteLength + pathBytes.byteLength + size,
      "Archive offset",
    );
  }

  const centralChunks: Uint8Array[] = [];
  for (const record of records) {
    const size = record.bytes.byteLength;
    const header = new Uint8Array(46);
    const view = new DataView(header.buffer);
    view.setUint32(0, CENTRAL_DIRECTORY_SIGNATURE, true);
    view.setUint16(4, VERSION_MADE_BY_UNIX, true);
    view.setUint16(6, VERSION_NEEDED, true);
    view.setUint16(8, UTF8_FLAG, true);
    view.setUint16(10, STORE_METHOD, true);
    view.setUint16(12, DOS_TIME, true);
    view.setUint16(14, DOS_DATE, true);
    view.setUint32(16, record.crc, true);
    view.setUint32(20, size, true);
    view.setUint32(24, size, true);
    view.setUint16(28, record.pathBytes.byteLength, true);
    view.setUint16(30, 0, true);
    view.setUint16(32, 0, true);
    view.setUint16(34, 0, true);
    view.setUint16(36, 0, true);
    view.setUint32(38, (REGULAR_FILE_MODE * 65_536) >>> 0, true);
    view.setUint32(42, record.localOffset, true);
    centralChunks.push(header, record.pathBytes);
  }

  const centralDirectory = concatenate(centralChunks);
  const centralOffset = uint32Size(localOffset, "Central-directory offset");
  const centralSize = uint32Size(
    centralDirectory.byteLength,
    "Central-directory size",
  );
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, END_OF_CENTRAL_DIRECTORY_SIGNATURE, true);
  endView.setUint16(4, 0, true);
  endView.setUint16(6, 0, true);
  endView.setUint16(8, records.length, true);
  endView.setUint16(10, records.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, centralOffset, true);
  endView.setUint16(20, 0, true);
  return concatenate([...localChunks, centralDirectory, end]);
}

function requireRange(
  bytes: Uint8Array,
  offset: number,
  length: number,
  label: string,
): void {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    offset < 0 ||
    length < 0 ||
    offset + length > bytes.byteLength
  ) {
    throw new TypeError(`Corrupt deterministic ZIP ${label}.`);
  }
}

export function readDeterministicZip(
  bytes: Uint8Array,
): readonly DeterministicZipEntry[] {
  if (bytes.byteLength < 22) {
    throw new TypeError("Corrupt deterministic ZIP end record.");
  }
  const endOffset = bytes.byteLength - 22;
  const end = new DataView(bytes.buffer, bytes.byteOffset + endOffset, 22);
  if (end.getUint32(0, true) !== END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
    throw new TypeError("Corrupt deterministic ZIP end signature.");
  }
  const entryCount = end.getUint16(10, true);
  if (
    end.getUint16(4, true) !== 0 ||
    end.getUint16(6, true) !== 0 ||
    end.getUint16(8, true) !== entryCount ||
    end.getUint16(20, true) !== 0
  ) {
    throw new TypeError(
      "Deterministic ZIP cannot span disks or carry comments.",
    );
  }
  const centralSize = end.getUint32(12, true);
  const centralOffset = end.getUint32(16, true);
  if (centralOffset + centralSize !== endOffset) {
    throw new TypeError("Corrupt deterministic ZIP central-directory bounds.");
  }

  const output: DeterministicZipEntry[] = [];
  let offset = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    requireRange(bytes, offset, 46, "central header");
    const central = new DataView(bytes.buffer, bytes.byteOffset + offset, 46);
    if (
      central.getUint32(0, true) !== CENTRAL_DIRECTORY_SIGNATURE ||
      central.getUint16(4, true) !== VERSION_MADE_BY_UNIX ||
      central.getUint16(6, true) !== VERSION_NEEDED ||
      central.getUint16(8, true) !== UTF8_FLAG ||
      central.getUint16(10, true) !== STORE_METHOD ||
      central.getUint16(12, true) !== DOS_TIME ||
      central.getUint16(14, true) !== DOS_DATE ||
      central.getUint16(30, true) !== 0 ||
      central.getUint16(32, true) !== 0 ||
      central.getUint16(34, true) !== 0 ||
      central.getUint16(36, true) !== 0 ||
      central.getUint32(38, true) !== (REGULAR_FILE_MODE * 65_536) >>> 0
    ) {
      throw new TypeError(
        "ZIP entry metadata is not deterministic and regular.",
      );
    }
    const crc = central.getUint32(16, true);
    const compressedSize = central.getUint32(20, true);
    const size = central.getUint32(24, true);
    const pathLength = central.getUint16(28, true);
    const localOffset = central.getUint32(42, true);
    if (compressedSize !== size) {
      throw new TypeError("Deterministic ZIP entries must use store mode.");
    }
    requireRange(bytes, offset + 46, pathLength, "central path");
    const pathBytes = bytes.slice(offset + 46, offset + 46 + pathLength);
    const path = decodeUtf8(pathBytes);
    const pathIssue = inspectExportPath(
      path,
      SOLUTION_EXPORT_V1_MAXIMA.pathBytes,
    );
    if (pathIssue !== undefined) {
      throw new TypeError(`Unsafe deterministic ZIP path: ${pathIssue.code}.`);
    }
    const previous = output.at(-1);
    if (previous !== undefined && compareUtf16(previous.path, path) >= 0) {
      throw new TypeError(
        "Deterministic ZIP entries must be uniquely UTF-16 sorted.",
      );
    }
    if (
      output.some(
        (entry) =>
          entry.path.normalize("NFC").toLowerCase() ===
          path.normalize("NFC").toLowerCase(),
      )
    ) {
      throw new TypeError(
        "Deterministic ZIP contains a duplicate portable path.",
      );
    }

    requireRange(bytes, localOffset, 30 + pathLength + size, "local entry");
    const local = new DataView(
      bytes.buffer,
      bytes.byteOffset + localOffset,
      30,
    );
    if (
      local.getUint32(0, true) !== LOCAL_FILE_HEADER_SIGNATURE ||
      local.getUint16(4, true) !== VERSION_NEEDED ||
      local.getUint16(6, true) !== UTF8_FLAG ||
      local.getUint16(8, true) !== STORE_METHOD ||
      local.getUint16(10, true) !== DOS_TIME ||
      local.getUint16(12, true) !== DOS_DATE ||
      local.getUint32(14, true) !== crc ||
      local.getUint32(18, true) !== size ||
      local.getUint32(22, true) !== size ||
      local.getUint16(26, true) !== pathLength ||
      local.getUint16(28, true) !== 0
    ) {
      throw new TypeError("Corrupt deterministic ZIP local header.");
    }
    const localPath = bytes.slice(
      localOffset + 30,
      localOffset + 30 + pathLength,
    );
    if (
      !localPath.every((value, byteIndex) => value === pathBytes[byteIndex])
    ) {
      throw new TypeError("ZIP central and local paths differ.");
    }
    const entryBytes = bytes.slice(
      localOffset + 30 + pathLength,
      localOffset + 30 + pathLength + size,
    );
    if (crc32(entryBytes) !== crc) {
      throw new TypeError("ZIP entry CRC does not match its bytes.");
    }
    output.push({ bytes: entryBytes, checksumCrc32: crc, path });
    offset += 46 + pathLength;
  }
  if (offset !== endOffset) {
    throw new TypeError("Corrupt deterministic ZIP central-directory size.");
  }
  return output;
}
