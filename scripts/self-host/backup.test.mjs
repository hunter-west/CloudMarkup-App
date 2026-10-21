import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { backup, assertInstalledBackupProfile } from "./backup.mjs";
const installationProfile = {
  profileId: "cloudmarkup-standalone-pg17-v1",
  profileVersion: 1,
  engineMajor: 17,
  owner: "cloudmarkup_admin",
  bootstrapGrantor: "cloudmarkup_owner",
  identityChecksumSha256: "d".repeat(64),
  privateReceiptChecksumSha256: "e".repeat(64),
};
for (const change of [
  { profileId: "hosted" },
  { profileVersion: 2 },
  { engineMajor: 16 },
  { owner: "cloudmarkup_owner" },
  { privateReceiptChecksumSha256: "f".repeat(64) },
])
  test(`backup refuses different installation profile ${JSON.stringify(change)}`, () => {
    assert.throws(
      () =>
        assertInstalledBackupProfile(
          { ...installationProfile, ...change },
          installationProfile,
        ),
      /installation profile/,
    );
  });
// Literal tar/V2 wire fixtures remain independent of the filesystem adapter.
function tarMember(name, contents = Buffer.alloc(0), type = "0") {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, "utf8");
  for (const [offset, length, value] of [
    [100, 8, 0o700],
    [108, 8, 10001],
    [116, 8, 10001],
    [124, 12, contents.length],
    [136, 12, 0],
  ])
    header.write(
      `${value.toString(8).padStart(length - 1, "0")}\0`,
      offset,
      length,
    );
  header.fill(32, 148, 156);
  header.write(type, 156);
  header.write("ustar\0", 257);
  header.write("00", 263);
  header.write(
    `${header
      .reduce((sum, byte) => sum + byte, 0)
      .toString(8)
      .padStart(6, "0")}\0 `,
    148,
    8,
  );
  return Buffer.concat([
    header,
    contents,
    Buffer.alloc((512 - (contents.length % 512)) % 512),
  ]);
}
function longObjectTar() {
  const payload = Buffer.from("nonempty synthetic V2 backup payload"),
    digest = createHash("sha256").update(payload).digest("hex"),
    organizationId = "a".repeat(128),
    projectId = "b".repeat(128),
    objectId = "c".repeat(128),
    storageKey = `v1/organizations/${organizationId}/projects/${projectId}/export-package/${objectId}/${digest}`;
  const reference = {
    contentSha256: digest,
    entityTag: `"${digest}"`,
    mediaType: "application/octet-stream",
    objectId,
    objectVersion: `sha256-${digest}`,
    owner: { organizationId, projectId },
    purpose: "export-package",
    sizeBytes: payload.length,
    storageKey,
    storageProvider: "filesystem",
  };
  const header = Buffer.from(
      JSON.stringify({ reference, state: "staged", storageContractVersion: 2 }),
    ),
    size = Buffer.alloc(4);
  size.writeUInt32BE(header.length);
  const body = Buffer.concat([
      Buffer.from("CloudMarkupObject2\n"),
      size,
      header,
      payload,
    ]),
    path = `objects/${storageKey}.object-v2`,
    parts = path.split("/"),
    records = [];
  function member(name, contents, type) {
    if (Buffer.byteLength(name) > 100) {
      const value = `path=${name}\n`;
      let length = Buffer.byteLength(value) + 2;
      while (Buffer.byteLength(`${length} ${value}`) !== length)
        length = Buffer.byteLength(`${length} ${value}`);
      records.push(
        tarMember(
          "objects/PaxHeaders/entry",
          Buffer.from(`${length} ${value}`),
          "x",
        ),
      );
    }
    records.push(tarMember(name, contents, type));
  }
  for (let count = 1; count < parts.length; count++)
    member(`${parts.slice(0, count).join("/")}/`, Buffer.alloc(0), "5");
  member(path, body, "0");
  records.push(Buffer.alloc(1024));
  return Buffer.concat(records);
}
test("an upgraded maintenance image is refused before any database/object capture", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cm-backup-test-"));
  try {
    let captured = false;
    await assert.rejects(
      backup(join(directory, "archive"), {
        drain: async () => ({
          cleanRuntimeExit: true,
          runtimeImageId: `sha256:${"a".repeat(64)}`,
        }),
        version: async () => ({
          imageId: `sha256:${"b".repeat(64)}`,
          packagedVersion: {},
        }),
        exec: async () => {
          captured = true;
          return "";
        },
      }),
      /differs from the drained runtime/,
    );
    assert.equal(captured, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
for (const failure of ["drain", "dump", "archive", "none"])
  test(`backup ${failure}: captures only after drain and never restarts`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "cm-backup-test-")),
      destination = join(directory, "archive"),
      order = [];
    try {
      const drain = async () => {
        order.push("drain");
        if (failure === "drain") throw Error("synthetic drain timeout");
        return {
          cleanRuntimeExit: true,
          runtimeImageId: `sha256:${"a".repeat(64)}`,
        };
      };
      const exec = async (args, options) => {
        const command = args.join(" ");
        order.push(command);
        if (args.includes("storage-audit"))
          return JSON.stringify({ files: 1, directories: 8, v1Candidates: 0 });
        if (args[0] === "images") return "a".repeat(64);
        if (args.includes("psql")) return JSON.stringify(installationProfile);
        if (args.includes("pg_dump")) {
          if (failure === "dump") throw Error("synthetic dump failure");
          options.output.write("synthetic database dump");
          return "";
        }
        if (args.includes("tar")) {
          if (failure === "archive") throw Error("synthetic tar failure");
          assert.ok(args.includes("--format=pax"));
          assert.ok(
            args.includes(
              "--pax-option=exthdr.name=objects/PaxHeaders/entry,delete=atime,delete=ctime,delete=mtime",
            ),
          );
          assert.ok(args.includes("--mode=u=rwX,go="));
          options.output.write(longObjectTar());
          return "";
        }
        throw Error("unexpected command");
      };
      const action = backup(destination, {
        exec,
        drain,
        version: async () => ({
          imageId: `sha256:${"a".repeat(64)}`,
          packagedVersion: { synthetic: true, installationProfile },
        }),
      });
      if (failure === "none") {
        const receipt = await action;
        assert.equal(receipt.cleanRuntimeExit, true);
        assert.equal(receipt.backupContractVersion, 2);
        assert.deepEqual(receipt.installationProfile, installationProfile);
        assert.equal(Object.keys(receipt.files).length, 2);
        assert.ok(
          (await readFile(join(destination, "objects.tar"))).includes(
            Buffer.from("nonempty synthetic V2 backup payload"),
          ),
        );
        assert.match(
          await readFile(join(destination, "receipt.json"), "utf8"),
          /backupContractVersion/,
        );
        if (process.platform === "win32")
          assert.match(receipt.archiveDirectoryDurability, /not-qualified/);
        await assert.rejects(stat(join(destination, "receipt.partial.json")));
        await assert.rejects(
          backup(destination, { exec, drain }),
          /already exists/,
        );
      } else {
        await assert.rejects(action);
        assert.equal((await stat(destination)).isDirectory(), true);
        await assert.rejects(stat(join(destination, "receipt.json")));
      }
      assert.equal(order[0], "drain");
      assert.equal(
        order.some((command) => command.startsWith("up ")),
        false,
      );
      if (failure === "drain") assert.equal(order.length, 1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
