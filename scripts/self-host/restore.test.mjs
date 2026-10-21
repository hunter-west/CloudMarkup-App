import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
const installationProfile = {
  profileId: "cloudmarkup-standalone-pg17-v1",
  profileVersion: 1,
  engineMajor: 17,
  owner: "cloudmarkup_admin",
  bootstrapGrantor: "cloudmarkup_owner",
  identityChecksumSha256: "d".repeat(64),
  privateReceiptChecksumSha256: "e".repeat(64),
};
import { restore, validateObjectTar, verifyBackup } from "./restore.mjs";
import { sha256 } from "./self-host.mjs";

export function tarMember(
  name,
  contents = Buffer.alloc(0),
  type = "0",
  mode = 0o700,
) {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, "utf8");
  for (const [offset, length, value] of [
    [100, 8, mode],
    [108, 8, 10001],
    [116, 8, 10001],
    [124, 12, contents.length],
    [136, 12, 0],
  ])
    header.write(
      `${value.toString(8).padStart(length - 1, "0")}\0`,
      offset,
      length,
      "ascii",
    );
  header.fill(32, 148, 156);
  header.write(type, 156, 1);
  header.write("ustar\0", 257);
  header.write("00", 263);
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");
  return Buffer.concat([
    header,
    contents,
    Buffer.alloc((512 - (contents.length % 512)) % 512),
  ]);
}
export function validTar() {
  return Buffer.concat([
    tarMember("objects/", Buffer.alloc(0), "5"),
    tarMember(
      "objects/.ambiguous-v2",
      Buffer.from("synthetic retained envelope"),
    ),
    tarMember("objects/legacy", Buffer.from("synthetic V1 pair data")),
    tarMember(
      "objects/legacy.metadata.json",
      Buffer.from("synthetic V1 pair metadata"),
    ),
    Buffer.alloc(1024),
  ]);
}

function paxRecord(value) {
  let size = Buffer.byteLength(value) + 2;
  while (Buffer.byteLength(`${size} ${value}`) !== size)
    size = Buffer.byteLength(`${size} ${value}`);
  return Buffer.from(`${size} ${value}`);
}
function paxMember(path, contents = Buffer.alloc(0), type = "0") {
  return Buffer.concat([
    tarMember("objects/PaxHeaders/entry", paxRecord(`path=${path}\n`), "x"),
    tarMember(path, contents, type),
  ]);
}
function longObjectFixture() {
  const payload = Buffer.from("nonempty synthetic V2 object payload"),
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
    records = [],
    parts = path.split("/");
  for (let count = 1; count < parts.length; count++) {
    const parent = `${parts.slice(0, count).join("/")}/`;
    records.push(
      Buffer.byteLength(parent) > 100
        ? paxMember(parent, Buffer.alloc(0), "5")
        : tarMember(parent, Buffer.alloc(0), "5"),
    );
  }
  records.push(paxMember(path, body), Buffer.alloc(1024));
  return { bytes: Buffer.concat(records), path, body, members: parts.length };
}

test("path-only pax preserves a nonempty V2 envelope with three valid 128-character IDs", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cm-long-key-"));
  try {
    const file = join(directory, "objects.tar"),
      fixture = longObjectFixture();
    assert.ok(Buffer.byteLength(fixture.path) > 255);
    assert.ok(fixture.body.length > 0);
    await writeFile(file, fixture.bytes);
    assert.equal((await validateObjectTar(file)).members, fixture.members);
    assert.ok((await readFile(file)).includes(fixture.body));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

for (const [label, records] of [
  ["traversal", [paxMember("objects/../escape")]],
  ["absolute", [paxMember("/objects/escape")]],
  ["link", [paxMember("objects/link", Buffer.alloc(0), "2")]],
  [
    "size override",
    [
      tarMember("objects/PaxHeaders/entry", paxRecord("size=1\n"), "x"),
      tarMember("objects/file"),
    ],
  ],
  [
    "global",
    [
      tarMember(
        "objects/PaxHeaders/entry",
        paxRecord("path=objects/file\n"),
        "g",
      ),
      tarMember("objects/file"),
    ],
  ],
  [
    "chained",
    [
      tarMember(
        "objects/PaxHeaders/entry",
        paxRecord("path=objects/first\n"),
        "x",
      ),
      paxMember("objects/second"),
    ],
  ],
  [
    "dangling",
    [
      tarMember(
        "objects/PaxHeaders/entry",
        paxRecord("path=objects/file\n"),
        "x",
      ),
    ],
  ],
  [
    "bad byte length",
    [
      tarMember(
        "objects/PaxHeaders/entry",
        Buffer.from("1 path=objects/file\n"),
        "x",
      ),
      tarMember("objects/file"),
    ],
  ],
  [
    "multiple attributes",
    [
      tarMember(
        "objects/PaxHeaders/entry",
        Buffer.concat([
          paxRecord("path=objects/file\n"),
          paxRecord("size=1\n"),
        ]),
        "x",
      ),
      tarMember("objects/file"),
    ],
  ],
  ["oversized path", [paxMember(`objects/${"a".repeat(4097)}`)]],
  [
    "duplicate effective path",
    [paxMember("objects/file"), tarMember("objects/file")],
  ],
])
  test(`pax refuses ${label} before extraction`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "cm-pax-refusal-"));
    try {
      const file = join(directory, "objects.tar");
      await writeFile(
        file,
        Buffer.concat([
          tarMember("objects/", Buffer.alloc(0), "5"),
          ...records,
          Buffer.alloc(1024),
        ]),
      );
      await assert.rejects(validateObjectTar(file));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
test("safe tar retains immutable, ambiguous and V1 members", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cm-tar-test-"));
  try {
    const file = join(directory, "objects.tar");
    await writeFile(file, validTar());
    assert.equal((await validateObjectTar(file)).members, 4);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

for (const mode of [0o755, 0o4755])
  test(`archive refuses public or special object mode ${mode.toString(8)}`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "cm-tar-mode-"));
    try {
      const file = join(directory, "objects.tar");
      await writeFile(
        file,
        Buffer.concat([
          tarMember("objects/", Buffer.alloc(0), "5"),
          tarMember("objects/file", Buffer.from("data"), "0", mode),
          Buffer.alloc(1024),
        ]),
      );
      await assert.rejects(validateObjectTar(file), /permissions/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
for (const [name, type] of [
  ["objects/../../escape", "0"],
  ["/objects/absolute", "0"],
  ["objects/back\\slash", "0"],
  ["objects/link", "2"],
  ["objects/hardlink", "1"],
  ["objects/device", "3"],
  ["objects/pax", "x"],
  ["objects/missing-parent/file", "0"],
])
  test(`tar refuses ${name} type ${type}`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "cm-tar-test-"));
    try {
      const file = join(directory, "objects.tar");
      await writeFile(
        file,
        Buffer.concat([
          tarMember("objects/", Buffer.alloc(0), "5"),
          tarMember(name, Buffer.alloc(0), type),
          Buffer.alloc(1024),
        ]),
      );
      await assert.rejects(validateObjectTar(file));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
test("duplicate, checksum, truncation and trailing-content failures are rejected", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cm-tar-test-"));
  try {
    const file = join(directory, "objects.tar"),
      root = tarMember("objects/", Buffer.alloc(0), "5"),
      badChecksum = validTar();
    badChecksum[10] ^= 1;
    for (const bytes of [
      Buffer.concat([root, root, Buffer.alloc(1024)]),
      badChecksum,
      validTar().subarray(0, 600),
      Buffer.concat([validTar(), root]),
      validTar().subarray(0, validTar().length - 512),
    ]) {
      await writeFile(file, bytes);
      await assert.rejects(validateObjectTar(file));
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("checksum and package mismatch are verified before restore writes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cm-restore-test-"));
  try {
    const version = {
      migrations: { count: 119 },
      lockfileSha256: "synthetic",
      installationProfile,
    };
    await writeFile(join(directory, "objects.tar"), validTar());
    await writeFile(join(directory, "database.dump"), "synthetic dump");
    const receipt = {
      backupContractVersion: 2,
      installationProfile,
      cleanRuntimeExit: true,
      images: {
        app: `sha256:${"a".repeat(64)}`,
        postgres: `sha256:${"a".repeat(64)}`,
      },
      packagedVersion: version,
      files: {
        "objects.tar": await sha256(join(directory, "objects.tar")),
        "database.dump": await sha256(join(directory, "database.dump")),
      },
    };
    await writeFile(join(directory, "receipt.json"), JSON.stringify(receipt));
    await verifyBackup(directory, version);
    await writeFile(
      join(directory, "receipt.json"),
      JSON.stringify({ ...receipt, backupContractVersion: 1 }),
    );
    await assert.rejects(verifyBackup(directory, version), /version/);
    await writeFile(
      join(directory, "receipt.json"),
      JSON.stringify({
        ...receipt,
        installationProfile: { ...installationProfile, profileVersion: 2 },
      }),
    );
    await assert.rejects(
      verifyBackup(directory, version),
      /installation profile/,
    );
    await writeFile(join(directory, "receipt.json"), JSON.stringify(receipt));
    await assert.rejects(
      verifyBackup(directory, version, `sha256:${"b".repeat(64)}`),
      /version/,
    );
    await assert.rejects(verifyBackup(directory, { other: true }), /version/);
    await writeFile(join(directory, "database.dump"), "corrupt synthetic dump");
    await assert.rejects(verifyBackup(directory, version), /checksum/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("a different PostgreSQL image cannot create a restore marker or write data", async () => {
  let writes = false;
  await assert.rejects(
    restore("synthetic unused path", {
      verify: async () => ({
        images: { postgres: `sha256:${"a".repeat(64)}` },
      }),
      stopped: async () => undefined,
      exec: async (args) => {
        if (args[0] === "images") return "b".repeat(64);
        writes = true;
        return "";
      },
    }),
    /exact PostgreSQL image/,
  );
  assert.equal(writes, false);
});
for (const failure of ["nonempty", "database", "objects", "fsync", "none"])
  test(`restore ${failure} never starts runtime and retains interruption marker`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "cm-restore-test-")),
      marker = join(directory, "state/restore-incomplete"),
      order = [];
    try {
      await writeFile(join(directory, "database.dump"), "synthetic");
      await writeFile(join(directory, "objects.tar"), validTar());
      const exec = async (args, options) => {
        const command = args.join(" ");
        order.push(command);
        if (args[0] === "images") return "a".repeat(64);
        if (options?.input) options.input.destroy();
        if (command.includes("SELECT count"))
          return failure === "nonempty" ? "1" : "0";
        if (args.includes("psql") && command.includes("json_build_object"))
          return JSON.stringify(installationProfile);
        if (
          (failure === "database" && args.includes("pg_restore")) ||
          (failure === "objects" && args.includes("tar")) ||
          (failure === "fsync" && args.includes("storage-sync"))
        )
          throw Error("synthetic injected failure");
        return "";
      };
      const action = restore(directory, {
        exec,
        marker,
        verify: async () => {
          order.push("verify");
          return {
            images: { postgres: `sha256:${"a".repeat(64)}` },
            installationProfile,
          };
        },
        stopped: async () => {
          order.push("stopped");
        },
      });
      if (failure === "none") {
        assert.equal((await action).runtimeStarted, false);
        await assert.rejects(readFile(marker));
        const extraction = order.find((command) =>
          command.includes("--no-same-owner"),
        );
        assert.ok(extraction.includes("--no-same-permissions -xf"));
        assert.equal(extraction.includes("-xpf"), false);
      } else {
        await assert.rejects(action);
        if (failure !== "nonempty")
          assert.match(await readFile(marker, "utf8"), /Restore incomplete/);
      }
      assert.deepEqual(order.slice(0, 2), ["verify", "stopped"]);
      assert.equal(
        order.some((command) => command.startsWith("up ")),
        false,
      );
      if (failure === "nonempty")
        assert.equal(
          order.some((command) => command.includes("pg_restore")),
          false,
        );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
