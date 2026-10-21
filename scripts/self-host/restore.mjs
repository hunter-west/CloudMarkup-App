import { createReadStream } from "node:fs";
import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  assertStopped,
  cli,
  compose,
  containerVersion,
  doctor,
  exclusive,
  fail,
  isMain,
  imageId,
  outsideRepository,
  privateDirectory,
  privateFile,
  sha256,
  stateDirectory,
  validateImagePins,
  validatePrivateLocations,
} from "./self-host.mjs";
import {
  assertInstalledBackupProfile,
  readBackupInstallationProfile,
} from "./backup.mjs";

function octal(bytes) {
  const text = bytes
    .toString("ascii")
    .replace(/[\0 ]+$/g, "")
    .replace(/^ +/g, "");
  if (!/^[0-7]+$/.test(text)) fail("Invalid tar numeric field.");
  const number = Number.parseInt(text, 8);
  if (!Number.isSafeInteger(number) || number < 0) fail("Invalid tar bound.");
  return number;
}
function text(bytes) {
  const end = bytes.indexOf(0);
  return new TextDecoder("utf-8", { fatal: true }).decode(
    end < 0 ? bytes : bytes.subarray(0, end),
  );
}
function hasControlCharacter(value) {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });
}
function paxPath(bytes) {
  const space = bytes.indexOf(32);
  if (space < 1) fail("Invalid object pax record.");
  const length = bytes.subarray(0, space).toString("ascii");
  if (!/^[1-9][0-9]{0,4}$/.test(length) || Number(length) !== bytes.length)
    fail("Invalid object pax length.");
  const record = new TextDecoder("utf-8", { fatal: true }).decode(
    bytes.subarray(space + 1),
  );
  if (!record.startsWith("path=") || !record.endsWith("\n"))
    fail("Unsupported object pax attribute.");
  const path = record.slice(5, -1);
  if (Buffer.byteLength(path, "utf8") > 4096 || hasControlCharacter(path))
    fail("Invalid object pax path.");
  return path;
}
// Accept ustar and one bounded path-only pax record for the next regular member.
// Reject links, devices, all other extensions, traversal, duplicate/trailing data.
// Validation streams all bytes before any restore mutation occurs.
export async function validateObjectTar(path) {
  const iterator = createReadStream(path)[Symbol.asyncIterator]();
  let pending = Buffer.alloc(0),
    ended = false;
  async function take(size, allowEOF = false) {
    while (pending.length < size && !ended) {
      const next = await iterator.next();
      if (next.done) ended = true;
      else pending = Buffer.concat([pending, next.value]);
    }
    if (allowEOF && ended && !pending.length) return null;
    if (pending.length < size) fail("Truncated object tar.");
    const value = pending.subarray(0, size);
    pending = pending.subarray(size);
    return value;
  }
  const seen = new Map();
  let zeroBlocks = 0,
    extendedPath;
  try {
    while (true) {
      const header = await take(512, true);
      if (header === null) break;
      if (header.every((byte) => byte === 0)) {
        if (extendedPath !== undefined) fail("Dangling object pax record.");
        zeroBlocks++;
        continue;
      }
      if (zeroBlocks) fail("Trailing archive content.");
      if (
        header.subarray(257, 263).toString("ascii") !== "ustar\0" ||
        header.subarray(263, 265).toString("ascii") !== "00"
      )
        fail("Unsupported object tar format.");
      const sum = header.reduce(
        (value, byte, index) =>
          value + (index >= 148 && index < 156 ? 32 : byte),
        0,
      );
      if (sum !== octal(header.subarray(148, 156)))
        fail("Invalid object tar checksum.");
      const type = header[156];
      const size = octal(header.subarray(124, 136));
      const prefix = text(header.subarray(345, 500));
      const headerName = `${prefix ? `${prefix}/` : ""}${text(header.subarray(0, 100))}`;
      if (type === 120) {
        if (
          extendedPath !== undefined ||
          headerName !== "objects/PaxHeaders/entry" ||
          size < 1 ||
          size > 8192
        )
          fail("Unsupported object pax header.");
        extendedPath = paxPath(await take(size));
        const padding = await take((512 - (size % 512)) % 512);
        if (padding.some((byte) => byte !== 0))
          fail("Invalid object pax padding.");
        continue;
      }
      if (type !== 0 && type !== 48 && type !== 53)
        fail("Nonregular archive member.");
      const directory = type === 53;
      let name = extendedPath ?? headerName;
      extendedPath = undefined;
      if (directory && name.endsWith("/")) name = name.slice(0, -1);
      const parts = name.split("/");
      if (
        parts[0] !== "objects" ||
        parts.some((part) => !part || part === "." || part === "..") ||
        name.includes("\\") ||
        hasControlCharacter(name) ||
        Buffer.byteLength(name, "utf8") > 4096 ||
        seen.has(name) ||
        (name === "objects" && !directory)
      )
        fail("Unsafe object archive path.");
      const parent = name.slice(0, name.lastIndexOf("/"));
      if (name !== "objects" && seen.get(parent) !== "directory")
        fail("Invalid archive ancestry.");
      if ((octal(header.subarray(100, 108)) & 0o7077) !== 0)
        fail("Object archive permissions must remain private.");
      if (directory && size !== 0) fail("Invalid tar directory.");
      seen.set(name, directory ? "directory" : "file");
      if (seen.size > 1000000) fail("Archive inventory exceeded its bound.");
      let remaining = Math.ceil(size / 512) * 512;
      while (remaining > 0) {
        const step = Math.min(remaining, 65536);
        await take(step);
        remaining -= step;
      }
    }
    if (zeroBlocks < 2 || seen.get("objects") !== "directory")
      fail("Incomplete object tar.");
    return { members: seen.size };
  } finally {
    await iterator.return?.();
  }
}
export async function verifyBackup(source, currentVersion, currentImageId) {
  if (currentVersion === undefined) {
    const packaged = await containerVersion();
    currentVersion = packaged.packagedVersion;
    currentImageId = packaged.imageId;
  }
  const directory = await outsideRepository(source);
  await privateDirectory(directory);
  const receipt = JSON.parse(
    await readFile(await privateFile(join(directory, "receipt.json")), "utf8"),
  );
  if (
    receipt.backupContractVersion !== 2 ||
    receipt.cleanRuntimeExit !== true ||
    !receipt.images ||
    (currentImageId && receipt.images.app !== currentImageId) ||
    !receipt.files ||
    Object.keys(receipt.files).sort().join(",") !==
      "database.dump,objects.tar" ||
    JSON.stringify(receipt.packagedVersion) !== JSON.stringify(currentVersion)
  )
    fail("Backup version does not match this restore image.");
  assertInstalledBackupProfile(
    receipt.installationProfile,
    currentVersion.installationProfile,
  );
  for (const name of ["database.dump", "objects.tar"]) {
    if (
      !/^[a-f0-9]{64}$/.test(receipt.files[name]) ||
      (await sha256(await privateFile(join(directory, name)))) !==
        receipt.files[name]
    )
      fail("Archive checksum mismatch.");
  }
  await validateObjectTar(join(directory, "objects.tar"));
  return receipt;
}
export async function restore(
  source,
  {
    exec = compose,
    stopped = assertStopped,
    verify = verifyBackup,
    marker = join(stateDirectory(), "restore-incomplete"),
  } = {},
) {
  const receipt = await verify(source);
  await stopped();
  if (
    receipt.images.postgres !==
    imageId(await exec(["images", "--quiet", "postgres"]))
  )
    fail("Restore requires the backup's exact PostgreSQL image.");
  // Never clean/reuse an existing data root. Operators provision the matching
  // reviewed roles separately; pg_restore retains original ACLs/ownership.
  await exec([
    "run",
    "--rm",
    "--no-deps",
    "-T",
    "--entrypoint",
    "node",
    "app",
    "scripts/self-host/self-host.mjs",
    "storage-empty",
  ]);
  const tables = await exec([
    "exec",
    "-T",
    "postgres",
    "psql",
    "--username=cloudmarkup_owner",
    "--dbname=cloudmarkup",
    "--no-psqlrc",
    "--set=ON_ERROR_STOP=1",
    "--tuples-only",
    "--no-align",
    "--command=SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname !~ '^pg_toast' AND c.relkind IN ('r','p','v','m','S','f')",
  ]);
  if (tables.trim() !== "0") fail("Restore requires an empty database.");
  await mkdir(dirname(marker), { recursive: true });
  const handle = await open(marker, "wx", 0o600);
  try {
    await handle.writeFile(
      "Restore incomplete; do not start runtime. Preserve partial volumes for investigation.\n",
    );
    await handle.sync();
  } finally {
    await handle.close();
  }
  await exec([
    "run",
    "--rm",
    "--no-deps",
    "-T",
    "--entrypoint",
    "node",
    "app",
    "scripts/self-host/self-host.mjs",
    "storage-restore-begin",
  ]);
  await exec(
    [
      "exec",
      "-T",
      "postgres",
      "pg_restore",
      "--username=cloudmarkup_owner",
      "--dbname=cloudmarkup",
      "--exit-on-error",
      "--single-transaction",
    ],
    { input: createReadStream(join(source, "database.dump")) },
  );
  await exec(
    [
      "run",
      "--rm",
      "--no-deps",
      "-T",
      "--entrypoint",
      "tar",
      "app",
      "--no-same-owner",
      "--no-same-permissions",
      "-xf",
      "-",
      "-C",
      "/data/cloudmarkup",
    ],
    { input: createReadStream(join(source, "objects.tar")) },
  );
  // Confirm actual Linux file AND directory fsync, including ancestry. No
  // Windows directory-sync surrogate or swallowed fsync error exists here.
  await exec([
    "run",
    "--rm",
    "--no-deps",
    "-T",
    "--entrypoint",
    "node",
    "app",
    "scripts/self-host/self-host.mjs",
    "storage-sync",
  ]);
  await exec([
    "exec",
    "-T",
    "postgres",
    "psql",
    "--username=cloudmarkup_owner",
    "--dbname=cloudmarkup",
    "--no-psqlrc",
    "--set=ON_ERROR_STOP=1",
    "--command=CHECKPOINT",
  ]);
  const restoredProfile = await readBackupInstallationProfile(exec);
  assertInstalledBackupProfile(restoredProfile, receipt.installationProfile);
  await exec([
    "run",
    "--rm",
    "--no-deps",
    "-T",
    "--entrypoint",
    "node",
    "app",
    "scripts/self-host/self-host.mjs",
    "storage-restore-complete",
  ]);
  await unlink(marker);
  return { restored: true, runtimeStarted: false };
}
export async function main(source = process.argv[2]) {
  await doctor();
  validateImagePins();
  await validatePrivateLocations();
  process.stdout.write(
    `${JSON.stringify(await exclusive(() => restore(source)))}\nVerify D readiness and exact data/export checks before normal use.\n`,
  );
}
if (isMain(import.meta.url)) void cli(() => main());
