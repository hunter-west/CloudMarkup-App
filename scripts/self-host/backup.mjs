import { createWriteStream } from "node:fs";
import { lstat, open, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { finished } from "node:stream/promises";
import {
  cli,
  compose,
  containerVersion,
  doctor,
  exclusive,
  fail,
  isMain,
  imageId,
  outsideRepository,
  sha256,
  stopAndVerify,
  validateImagePins,
  validatePrivateLocations,
} from "./self-host.mjs";

export function assertInstalledBackupProfile(value, expected) {
  if (
    !expected ||
    expected.profileId !== "cloudmarkup-standalone-pg17-v1" ||
    expected.profileVersion !== 1 ||
    expected.engineMajor !== 17 ||
    expected.owner !== "cloudmarkup_admin" ||
    expected.bootstrapGrantor !== "cloudmarkup_owner" ||
    ["identityChecksumSha256", "privateReceiptChecksumSha256"].some(
      (key) =>
        typeof expected[key] !== "string" ||
        !/^[a-f0-9]{64}$/.test(expected[key]),
    ) ||
    !value ||
    [
      "profileId",
      "profileVersion",
      "engineMajor",
      "owner",
      "bootstrapGrantor",
      "identityChecksumSha256",
      "privateReceiptChecksumSha256",
    ].some((key) => value[key] !== expected[key])
  )
    fail("Database installation profile does not match the backup image.");
}
export async function readBackupInstallationProfile(exec = compose) {
  return JSON.parse(
    await exec([
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
      "--command=SELECT json_build_object('profileId',p.profile_id,'profileVersion',p.profile_version,'engineMajor',p.engine_major,'owner',p.schema_owner,'bootstrapGrantor',p.bootstrap_grantor,'identityChecksumSha256',(SELECT trim(checksum_sha256) FROM public.cloudmarkup_schema_migrations WHERE version='0000'),'privateReceiptChecksumSha256',(SELECT trim(checksum_sha256) FROM public.cloudmarkup_schema_migrations WHERE version='0127')) FROM public.cloudmarkup_installation_profile p WHERE p.singleton",
    ]),
  );
}

export async function capture(path, command, exec = compose) {
  const output = createWriteStream(path, { flags: "wx", mode: 0o600 });
  const completion = finished(output);
  completion.catch(() => undefined);
  try {
    await exec(command, { output });
    output.end();
    await completion;
    const handle = await open(path, "r+");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } finally {
    output.destroy();
    await completion.catch(() => undefined);
  }
}
export async function backup(
  destination,
  { exec = compose, drain = stopAndVerify, version = containerVersion } = {},
) {
  const final = await outsideRepository(destination);
  // A new directory is created exclusively. The receipt is the completion
  // marker; failures retain files without a final receipt for investigation.
  const staging = final;
  try {
    await lstat(final);
    fail("Backup destination already exists.");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await mkdir(staging, { mode: 0o700 });
  const drainReceipt = await drain();
  const packaged = await version();
  if (imageId(drainReceipt.runtimeImageId) !== packaged.imageId)
    fail(
      "The maintenance image differs from the drained runtime; restore the old image pin before backup.",
    );
  const installationProfile = await readBackupInstallationProfile(exec);
  assertInstalledBackupProfile(
    installationProfile,
    packaged.packagedVersion.installationProfile,
  );
  const inventory = JSON.parse(
    await exec([
      "run",
      "--rm",
      "--no-deps",
      "-T",
      "--entrypoint",
      "node",
      "app",
      "scripts/self-host/self-host.mjs",
      "storage-audit",
    ]),
  );
  const images = {
    app: packaged.imageId,
    postgres: imageId(await exec(["images", "--quiet", "postgres"])),
  };
  await capture(
    join(staging, "database.dump"),
    [
      "exec",
      "-T",
      "postgres",
      "pg_dump",
      "--username=cloudmarkup_owner",
      "--dbname=cloudmarkup",
      "--format=custom",
    ],
    exec,
  );
  await capture(
    join(staging, "objects.tar"),
    [
      "run",
      "--rm",
      "--no-deps",
      "-T",
      "--entrypoint",
      "tar",
      "app",
      "--format=pax",
      "--pax-option=exthdr.name=objects/PaxHeaders/entry,delete=atime,delete=ctime,delete=mtime",
      "--numeric-owner",
      "--owner=10001",
      "--group=10001",
      "--mode=u=rwX,go=",
      "--hard-dereference",
      "-C",
      "/data/cloudmarkup",
      "-cpf",
      "-",
      "objects",
    ],
    exec,
  );
  const { validateObjectTar } = await import("./restore.mjs");
  await validateObjectTar(join(staging, "objects.tar"));
  const receipt = {
    backupContractVersion: 2,
    installationProfile,
    ...drainReceipt,
    packagedVersion: packaged.packagedVersion,
    images,
    inventory,
    files: {
      "database.dump": await sha256(join(staging, "database.dump")),
      "objects.tar": await sha256(join(staging, "objects.tar")),
    },
    archiveDirectoryDurability:
      process.platform === "linux"
        ? "linux-directory-fsync-at-successful-command-completion"
        : "staging-only-not-qualified-for-power-loss",
  };
  const handle = await open(join(staging, "receipt.json"), "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(receipt, null, 2)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
  if (process.platform === "linux") {
    await syncDirectory(staging);
    await syncDirectory(join(final, ".."));
  }
  return receipt;
}
async function syncDirectory(path) {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
export async function main(destination = process.argv[2]) {
  await doctor();
  validateImagePins();
  await validatePrivateLocations();
  const receipt = await exclusive(() => backup(destination));
  process.stdout.write(
    `${JSON.stringify(receipt, null, 2)}\nRuntime remains stopped. Protect and verify an independent archive copy before restarting.\n`,
  );
}
if (isMain(import.meta.url)) void cli(() => main());
