// Materialize trusted public image bytes before any candidate exists.
import { createHash } from "node:crypto";
import { lstat, mkdir, open, readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";

const maximumArchiveBytes = 8 * 1024 * 1024 * 1024;
const blobPath = /^blobs\/sha256\/[a-f0-9]{64}$/u;
function requireLayout(value) {
  if (!value) throw new TypeError("Exact local OCI image layout required.");
}
function octal(bytes) {
  const value = bytes.toString("ascii").replaceAll("\0", "").trim();
  requireLayout(/^[0-7]+$/u.test(value));
  return Number.parseInt(value, 8);
}
export async function extractMemoryImageLayout(
  archive,
  destination,
  baseImage,
) {
  requireLayout(
    isAbsolute(archive) &&
      isAbsolute(destination) &&
      /^[a-z0-9][a-z0-9._-]{1,100}@sha256:[a-f0-9]{64}$/u.test(baseImage),
  );
  const stat = await lstat(archive);
  requireLayout(
    stat.isFile() &&
      stat.size >= 1024 &&
      stat.size <= maximumArchiveBytes &&
      stat.size % 512 === 0,
  );
  await mkdir(destination, { recursive: false });
  const input = await open(archive, "r");
  const seen = new Set();
  const buffer = Buffer.alloc(1024 * 1024);
  let offset = 0;
  let ended = false;
  try {
    while (offset < stat.size) {
      const header = Buffer.alloc(512);
      requireLayout(
        (await input.read(header, 0, 512, offset)).bytesRead === 512,
      );
      offset += 512;
      if (header.every((byte) => byte === 0)) {
        requireLayout(stat.size - offset >= 512);
        while (offset < stat.size) {
          const length = Math.min(buffer.length, stat.size - offset);
          requireLayout(
            (await input.read(buffer, 0, length, offset)).bytesRead ===
              length && buffer.subarray(0, length).every((byte) => byte === 0),
          );
          offset += length;
        }
        ended = true;
        break;
      }
      const checksum = octal(header.subarray(148, 156));
      const checkedHeader = Buffer.from(header);
      checkedHeader.fill(32, 148, 156);
      requireLayout(
        checkedHeader.reduce((sum, byte) => sum + byte, 0) === checksum,
      );
      const nameBytes = header.subarray(0, 100);
      const end = nameBytes.indexOf(0);
      requireLayout(
        end > 0 && nameBytes.subarray(end).every((byte) => byte === 0),
      );
      const name = nameBytes.subarray(0, end).toString("ascii");
      const directory = header[156] === 53;
      const size = octal(header.subarray(124, 136));
      requireLayout(
        seen.size < 2048 &&
          !seen.has(name) &&
          header.subarray(157, 257).every((byte) => byte === 0) &&
          header.subarray(345, 500).every((byte) => byte === 0) &&
          (directory
            ? ["blobs/", "blobs/sha256/"].includes(name) && size === 0
            : [0, 48].includes(header[156]) &&
              (blobPath.test(name) ||
                ["oci-layout", "index.json", "manifest.json"].includes(
                  name,
                ))) &&
          offset + Math.ceil(size / 512) * 512 <= stat.size,
      );
      seen.add(name);
      if (directory) continue;
      requireLayout(blobPath.test(name) || size <= 1024 * 1024);
      const path = resolve(destination, name);
      await mkdir(dirname(path), { recursive: true });
      const output = await open(path, "wx", 0o444);
      const hash = createHash("sha256");
      try {
        let remaining = size;
        while (remaining > 0) {
          const length = Math.min(buffer.length, remaining);
          requireLayout(
            (await input.read(buffer, 0, length, offset)).bytesRead === length,
          );
          const bytes = buffer.subarray(0, length);
          hash.update(bytes);
          await output.writeFile(bytes);
          offset += length;
          remaining -= length;
        }
      } finally {
        await output.close();
      }
      requireLayout(
        !blobPath.test(name) || name === "blobs/sha256/" + hash.digest("hex"),
      );
      offset += (512 - (size % 512)) % 512;
    }
  } finally {
    await input.close();
  }
  const digest = baseImage.split("@")[1];
  requireLayout(
    ended &&
      seen.has("blobs/sha256/" + digest.slice(7)) &&
      seen.has("oci-layout") &&
      seen.has("index.json"),
  );
  const layout = JSON.parse(
    await readFile(resolve(destination, "oci-layout"), "utf8"),
  );
  const index = JSON.parse(
    await readFile(resolve(destination, "index.json"), "utf8"),
  );
  requireLayout(
    layout.imageLayoutVersion === "1.0.0" &&
      index.schemaVersion === 2 &&
      Array.isArray(index.manifests) &&
      index.manifests.filter((entry) => entry.digest === digest).length === 1,
  );
  return "oci-layout://" + destination + "@" + digest;
}
