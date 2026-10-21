import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { cli, fail, isMain } from "./self-host.mjs";

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
/** Build-time staging only. Reuse the hosted asset collector and source-defined
 * profile, including its exact reconstructed SFNT fonts. No downloaded assets,
 * credentials or second catalog/renderer implementation are introduced. */
export async function stageNativeExportAssets({
  api,
  profile,
  compilerPath,
  outputDirectory,
}) {
  const compiler = await readFile(compilerPath);
  if (compiler.length < 1 || compiler.length > 64 * 1024 * 1024)
    fail("Compiler bytes are unavailable.");
  const assets = api.collectProductionSolutionExportAssets();
  const fonts = assets.runtimeFiles.filter((file) =>
    file.path.startsWith("cloudmarkup-export/fonts/"),
  );
  if (
    fonts.length !== 2 ||
    fonts.some(
      (file) =>
        !/^cloudmarkup-export\/fonts\/[A-Za-z0-9._-]+$/u.test(file.path),
    )
  )
    fail("Pinned diagram fonts are unavailable.");
  if (
    [assets.iconBundle, ...fonts].some(
      (file) => sha(file.bytes) !== file.sha256,
    )
  )
    fail("Native asset checksum refused.");
  const executableSha256 = sha(compiler);
  const targetSettings = profile.createProductionSolutionExportTargetSettings({
    compilerExecutableSha256: executableSha256,
    iconBundleSha256: assets.iconBundle.sha256,
  });
  // No replacement of previously staged image artifacts.
  await mkdir(outputDirectory, { mode: 0o755 });
  await mkdir(join(outputDirectory, "fonts"), { mode: 0o755 });
  await writeFile(
    join(outputDirectory, "diagram-icons.json"),
    assets.iconBundle.bytes,
    { flag: "wx", mode: 0o444 },
  );
  for (const font of fonts)
    await writeFile(
      join(outputDirectory, "fonts", font.path.split("/").at(-1)),
      font.bytes,
      { flag: "wx", mode: 0o444 },
    );
  const settings = {
    schemaVersion: 1,
    compiler: { executablePath: compilerPath, executableSha256 },
    iconBundlePath: join(outputDirectory, "diagram-icons.json"),
    iconBundleSha256: assets.iconBundle.sha256,
    targetSettingsDigest: targetSettings.digest,
    pollIntervalMilliseconds: 1000,
  };
  await writeFile(
    join(outputDirectory, "native-export-settings.json"),
    JSON.stringify(settings) + "\n",
    { flag: "wx", mode: 0o444 },
  );
  return Object.freeze({
    compilerSha256: executableSha256,
    iconBundleSha256: assets.iconBundle.sha256,
    targetSettingsDigest: targetSettings.digest,
    fonts: fonts.map((font) => ({ path: font.path, sha256: font.sha256 })),
  });
}
export async function main(command = process.argv[2]) {
  if (command !== "stage" || process.platform !== "linux")
    fail("Native assets are staged only during the shared Linux image build.");
  // Exact compiled entries declared by the API's public export map.
  const api =
    await import("../../apps/api/dist/production-solution-export-assets.js");
  const profile =
    await import("../../apps/api/dist/production-solution-export-profile.js");
  const receipt = await stageNativeExportAssets({
    api,
    profile,
    compilerPath: "/opt/cloudmarkup/bin/cloudmarkup-iac",
    outputDirectory: "/opt/cloudmarkup/export",
  });
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
}
if (isMain(import.meta.url)) void cli(() => main());
