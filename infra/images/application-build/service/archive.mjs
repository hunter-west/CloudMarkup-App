import { lstat, mkdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";

import { safeApplicationPath, secretKind, sha256 } from "./contract.mjs";

const BLOCK = 512;

function fail(message) {
  throw new TypeError(message);
}

function zeroBlock(buffer, offset) {
  for (let index = offset; index < offset + BLOCK; index += 1) {
    if (buffer[index] !== 0) return false;
  }
  return true;
}

function field(buffer, offset, length) {
  const slice = buffer.subarray(offset, offset + length);
  const end = slice.indexOf(0);
  return slice.subarray(0, end < 0 ? slice.length : end).toString("utf8");
}

function octal(buffer, offset, length, label) {
  const text = field(buffer, offset, length).trim();
  if (!/^[0-7]+$/u.test(text)) fail(`Archive ${label} is not canonical octal.`);
  const value = Number.parseInt(text, 8);
  if (!Number.isSafeInteger(value)) fail(`Archive ${label} is out of range.`);
  return value;
}

function headerChecksum(buffer, offset) {
  let sum = 0;
  for (let index = 0; index < BLOCK; index += 1) {
    sum += index >= 148 && index < 156 ? 32 : (buffer[offset + index] ?? 0);
  }
  return sum;
}

function memberPath(buffer, offset) {
  const name = field(buffer, offset, 100);
  const prefix = field(buffer, offset + 345, 155);
  const path = prefix.length === 0 ? name : `${prefix}/${name}`;
  return safeApplicationPath(path.replace(/\/$/u, ""));
}

// Closed POSIX per-file extended header: only one bounded path record. Other
// PAX authority (size, links, ownership, global state, sparse files) is denied.
function extendedPath(bytes) {
  if (bytes.length === 0 || bytes.length > 1024)
    fail("Extended path metadata exceeds its bound.");
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const record = /^([1-9][0-9]*) path=([^\n\r\0]+)\n$/u.exec(text);
  if (record === null || Number(record[1]) !== bytes.length)
    fail("Extended path metadata must contain one exact length-bound path.");
  return safeApplicationPath(record[2]);
}
function extendedPlaceholder(path) {
  return `application/pax/${sha256(path).slice(7)}.txt`;
}

export function readTarArchive(buffer, limits) {
  if (
    !Buffer.isBuffer(buffer) ||
    buffer.length === 0 ||
    buffer.length % BLOCK !== 0
  ) {
    fail("Source archive must be a non-empty block-aligned tar file.");
  }
  const files = [];
  const identities = new Set();
  let total = 0;
  let offset = 0;
  let endBlocks = 0;
  let pendingPath;
  while (offset < buffer.length) {
    if (zeroBlock(buffer, offset)) {
      if (pendingPath !== undefined)
        fail("Extended path lacks its regular file.");
      endBlocks += 1;
      offset += BLOCK;
      if (endBlocks === 2) break;
      continue;
    }
    if (endBlocks > 0) fail("Tar archive has data after an end marker.");
    const storedChecksum = octal(buffer, offset + 148, 8, "checksum");
    if (headerChecksum(buffer, offset) !== storedChecksum) {
      fail("Tar archive header checksum is invalid.");
    }
    const type = String.fromCodePoint(buffer[offset + 156] ?? 0);
    if (type !== "\0" && type !== "0" && type !== "5" && type !== "x") {
      fail("Tar archive contains a link, extension, or special member.");
    }
    const headerPath = memberPath(buffer, offset);
    const path = pendingPath ?? headerPath;
    const mode = octal(buffer, offset + 100, 8, "mode");
    const size = octal(buffer, offset + 124, 12, "size");
    if ((mode & 0o111) !== 0)
      fail("Application source files cannot be executable.");
    offset += BLOCK;
    if (pendingPath !== undefined && type !== "0" && type !== "\0")
      fail("Extended path must immediately precede one regular file.");
    if (type === "5") {
      if (size !== 0) fail("Tar directory member must have zero size.");
      continue;
    }
    if (type === "x") {
      if (
        size > 1024 ||
        offset + Math.ceil(size / BLOCK) * BLOCK > buffer.length
      )
        fail("Extended path metadata exceeds the archive bounds.");
      pendingPath = extendedPath(buffer.subarray(offset, offset + size));
      if (headerPath !== extendedPlaceholder(pendingPath))
        fail("Extended path header does not bind its exact path.");
      const paddedSize = Math.ceil(size / BLOCK) * BLOCK;
      for (let index = offset + size; index < offset + paddedSize; index += 1)
        if (buffer[index] !== 0) fail("Extended path padding is not zero.");
      offset += paddedSize;
      continue;
    }
    if (pendingPath !== undefined) {
      if (headerPath !== extendedPlaceholder(pendingPath))
        fail("Extended path regular file does not match its header.");
      pendingPath = undefined;
    }
    if (size > limits.maxFileBytes)
      fail("Tar member exceeds the file byte limit.");
    if (offset + size > buffer.length)
      fail("Tar member extends beyond the archive.");
    const identity = path.toLowerCase();
    if (identities.has(identity))
      fail("Tar archive contains a duplicate portable path.");
    identities.add(identity);
    const bytes = Buffer.from(buffer.subarray(offset, offset + size));
    const content = bytes.toString("utf8");
    if (!Buffer.from(content, "utf8").equals(bytes)) {
      fail("Application source must be valid UTF-8 text.");
    }
    if (secretKind(content) !== undefined) {
      fail("Application source contains a secret-shaped value.");
    }
    total += size;
    if (
      files.length + 1 > limits.maxFiles ||
      total > limits.maxTotalFileBytes
    ) {
      fail("Tar archive exceeds the workspace limits.");
    }
    files.push({ bytes, path, sha256: sha256(bytes), sizeBytes: size });
    const paddedSize = Math.ceil(size / BLOCK) * BLOCK;
    for (let index = offset + size; index < offset + paddedSize; index += 1) {
      if (buffer[index] !== 0)
        fail("Tar member padding is not canonical zero data.");
    }
    offset += paddedSize;
  }
  if (pendingPath !== undefined) fail("Extended path lacks its regular file.");
  if (endBlocks !== 2)
    fail("Tar archive is missing its canonical end markers.");
  while (offset < buffer.length) {
    if (!zeroBlock(buffer, offset))
      fail("Tar archive has trailing nonzero data.");
    offset += BLOCK;
  }
  return files.sort((left, right) =>
    left.path < right.path ? -1 : left.path === right.path ? 0 : 1,
  );
}

export function verifyArchiveManifest(files, manifest) {
  if (files.length !== manifest.length)
    fail("Archive membership differs from sourceFiles.");
  for (let index = 0; index < manifest.length; index += 1) {
    const actual = files[index];
    const expected = manifest[index];
    if (
      actual.path !== expected.path ||
      actual.sha256 !== expected.sha256 ||
      actual.sizeBytes !== expected.sizeBytes
    ) {
      fail("Archive path, size, or checksum differs from sourceFiles.");
    }
  }
}

function ensureWithin(root, target) {
  const local = relative(root, target);
  if (
    local === "" ||
    local.startsWith("..") ||
    resolve(root, local) !== target
  ) {
    fail("Workspace target escapes its exact root.");
  }
}

async function ensureRegularParents(root, target) {
  const localSegments = relative(root, dirname(target))
    .split(sep)
    .filter(Boolean);
  let current = root;
  for (const segment of localSegments) {
    current = resolve(current, segment);
    ensureWithin(root, current);
    await mkdir(current, { mode: 0o700, recursive: true });
    const stats = await lstat(current);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      fail("Workspace parent is not a regular directory.");
    }
  }
}

export async function materializeArchive(files, workspaceRoot) {
  await mkdir(workspaceRoot, { mode: 0o700 });
  const rootStats = await lstat(workspaceRoot);
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    fail("Workspace root is not a regular directory.");
  }
  const output = new Map();
  for (const file of files) {
    const target = resolve(workspaceRoot, ...file.path.split("/"));
    ensureWithin(workspaceRoot, target);
    await ensureRegularParents(workspaceRoot, target);
    await writeFile(target, file.bytes, { flag: "wx", mode: 0o600 });
    const stats = await lstat(target);
    if (!stats.isFile() || stats.isSymbolicLink()) {
      fail("Materialized source is not a regular file.");
    }
    output.set(file.path, file.bytes);
  }
  return output;
}
