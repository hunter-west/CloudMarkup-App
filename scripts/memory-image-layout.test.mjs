import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { extractMemoryImageLayout } from "./memory-image-layout.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const manifest = Buffer.from(
  '{"schemaVersion":2,"mediaType":"application/vnd.oci.image.manifest.v1+json"}',
);
const digest = hash(manifest);
const reference = "memory-base@sha256:" + digest;
function member(name, bytes, type = "0") {
  const header = Buffer.alloc(512);
  header.write(name, 0, "ascii");
  header.write("0000444\0", 100, "ascii");
  header.write("0000000\0", 108, "ascii");
  header.write("0000000\0", 116, "ascii");
  header.write(bytes.length.toString(8).padStart(11, "0") + "\0", 124, "ascii");
  header.write("00000000000\0", 136, "ascii");
  header.fill(32, 148, 156);
  header.write(type, 156, "ascii");
  header.write("ustar\0", 257, "ascii");
  header.write("00", 263, "ascii");
  const sum = header.reduce((total, byte) => total + byte, 0);
  header.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, "ascii");
  return Buffer.concat([
    header,
    bytes,
    Buffer.alloc((512 - (bytes.length % 512)) % 512),
  ]);
}
const entries = () => [
  ["blobs/", Buffer.alloc(0), "5"],
  ["blobs/sha256/", Buffer.alloc(0), "5"],
  ["blobs/sha256/" + digest, manifest],
  ["oci-layout", Buffer.from('{"imageLayoutVersion":"1.0.0"}')],
  [
    "index.json",
    Buffer.from(
      JSON.stringify({
        schemaVersion: 2,
        manifests: [{ digest: "sha256:" + digest }],
      }),
    ),
  ],
];
const tar = (files) =>
  Buffer.concat([...files.map((file) => member(...file)), Buffer.alloc(1024)]);
async function fixture(t, bytes) {
  const root = await mkdtemp(resolve(tmpdir(), "cloudmarkup-memory-oci-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const archive = resolve(root, "image.tar");
  await writeFile(archive, bytes);
  return { archive, destination: resolve(root, "layout") };
}
test("materializes verified OCI blobs and binds the inspected manifest digest", async (t) => {
  const { archive, destination } = await fixture(t, tar(entries()));
  assert.equal(
    await extractMemoryImageLayout(archive, destination, reference),
    "oci-layout://" + destination + "@sha256:" + digest,
  );
  assert.deepEqual(
    await readFile(resolve(destination, "blobs/sha256/" + digest)),
    manifest,
  );
  await assert.rejects(
    extractMemoryImageLayout(archive, destination, reference),
  );
});
for (const [name, mutate] of [
  [
    "traversal",
    (files) => {
      files.push(["../escape", Buffer.from("private")]);
    },
  ],
  [
    "absolute path",
    (files) => {
      files.push(["/escape", Buffer.from("private")]);
    },
  ],
  [
    "symlink",
    (files) => {
      files.push(["blobs/sha256/" + "a".repeat(64), Buffer.alloc(0), "2"]);
    },
  ],
  [
    "hardlink",
    (files) => {
      files.push(["blobs/sha256/" + "a".repeat(64), Buffer.alloc(0), "1"]);
    },
  ],
  [
    "pax extension",
    (files) => {
      files.push(["index.json", Buffer.alloc(0), "x"]);
    },
  ],
  [
    "duplicate path",
    (files) => {
      files.push(files[2]);
    },
  ],
  [
    "corrupt blob",
    (files) => {
      files[2][1] = Buffer.from("different");
    },
  ],
  [
    "missing blob",
    (files) => {
      files.splice(2, 1);
    },
  ],
  [
    "missing layout",
    (files) => {
      files.splice(3, 1);
    },
  ],
  [
    "wrong manifest",
    (files) => {
      files[4][1] = Buffer.from(
        JSON.stringify({
          schemaVersion: 2,
          manifests: [{ digest: "sha256:" + "a".repeat(64) }],
        }),
      );
    },
  ],
  [
    "ambiguous manifest",
    (files) => {
      files[4][1] = Buffer.from(
        JSON.stringify({
          schemaVersion: 2,
          manifests: [
            { digest: "sha256:" + digest },
            { digest: "sha256:" + digest },
          ],
        }),
      );
    },
  ],
  [
    "wrong layout version",
    (files) => {
      files[3][1] = Buffer.from('{"imageLayoutVersion":"2.0.0"}');
    },
  ],
]) {
  test("rejects " + name + " before build-context admission", async (t) => {
    const files = entries();
    mutate(files);
    const { archive, destination } = await fixture(t, tar(files));
    await assert.rejects(
      extractMemoryImageLayout(archive, destination, reference),
    );
  });
}
for (const [name, mutate] of [
  [
    "invalid checksum",
    (bytes) => {
      bytes[100] = 49;
      return bytes;
    },
  ],
  ["truncated member", (bytes) => bytes.subarray(0, 1536)],
  ["missing terminator", (bytes) => bytes.subarray(0, bytes.length - 1024)],
  [
    "content after terminator",
    (bytes) => Buffer.concat([bytes, member("index.json", Buffer.from("{}"))]),
  ],
]) {
  test("rejects archive " + name, async (t) => {
    const { archive, destination } = await fixture(t, mutate(tar(entries())));
    await assert.rejects(
      extractMemoryImageLayout(archive, destination, reference),
    );
  });
}
test("rejects mutable base identity before creating a layout", async (t) => {
  const { archive, destination } = await fixture(t, tar(entries()));
  await assert.rejects(
    extractMemoryImageLayout(archive, destination, "memory-base:candidate"),
  );
});
