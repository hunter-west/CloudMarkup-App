import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, sep } from "node:path";

import { collectProductionSolutionExportAssets } from "@cloudmarkup/api/solution-export-assets";
import { createProductionSolutionExportTargetSettings } from "@cloudmarkup/api/solution-export-profile";
import { aws_lambda as lambda, AssetHashType } from "aws-cdk-lib";
import type { Construct } from "constructs";
import { buildSync } from "esbuild";

import { buildRepositoryImportParser } from "./repository-import-parser-asset.js";

/** CDK's single outfile cannot preserve lazy chunks. Use the same fixed-entry,
 * output-hashed ESM packaging as the beta API, with names and maps retained. */
export function createSolutionExportWorkerCode(): lambda.Code {
  const source = fileURLToPath(new URL("../runtime/", import.meta.url));
  return lambda.Code.fromAsset(source, {
    assetHashType: AssetHashType.OUTPUT,
    bundling: {
      image: lambda.Runtime.NODEJS_24_X.bundlingImage,
      command: ["false"],
      local: {
        tryBundle(outputDirectory) {
          buildSolutionExportWorkerRuntime(outputDirectory);
          return true;
        },
      },
    },
  });
}

export function buildSolutionExportWorkerRuntime(outputDirectory: string) {
  return buildSync({
    absWorkingDir: fileURLToPath(new URL("../../../", import.meta.url)),
    entryPoints: {
      index: fileURLToPath(
        new URL("../runtime/solution-export-worker.ts", import.meta.url),
      ),
    },
    outdir: outputDirectory,
    outExtension: { ".js": ".mjs" },
    bundle: true,
    format: "esm",
    splitting: true,
    platform: "node",
    target: "node24",
    minify: true,
    keepNames: true,
    sourcemap: true,
    sourcesContent: false,
    external: ["@resvg/resvg-js"],
    banner: {
      js: "import { createRequire as cloudmarkupCreateRequire } from 'node:module'; const require = cloudmarkupCreateRequire(import.meta.url);",
    },
    logLevel: "error",
    metafile: true,
  });
}

/** Export execution has its own layer and selector. Building the same offline
 * compiler source does not enable repository inspection or share its policy. */
export function createSolutionExportRuntimeLayer(scope: Construct): {
  readonly layer: lambda.LayerVersion;
  readonly environment: Readonly<Record<string, string>>;
} {
  const compiler = buildRepositoryImportParser();
  const assets = collectProductionSolutionExportAssets();
  const settings = createProductionSolutionExportTargetSettings({
    compilerExecutableSha256: compiler.sha256,
    iconBundleSha256: assets.iconBundle.sha256,
  });
  const files = [
    {
      path: "cloudmarkup-export/cloudmarkup-iac",
      bytes: compiler.bytes,
      sha256: compiler.sha256,
    },
    assets.iconBundle,
    ...assets.runtimeFiles,
  ].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const parent = resolve(tmpdir());
  const directory = mkdtempSync(join(parent, "cloudmarkup-export-layer-"));
  const root = resolve(directory);
  if (
    !root.startsWith(parent + sep) ||
    !root.includes("cloudmarkup-export-layer-")
  )
    throw new TypeError("Invalid export layer staging directory.");
  try {
    for (const file of files) {
      const path = resolve(root, file.path);
      if (
        !path.startsWith(root + sep) ||
        createHash("sha256").update(file.bytes).digest("hex") !== file.sha256
      )
        throw new TypeError(
          "Export layer file escaped its admitted byte/path boundary.",
        );
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, file.bytes);
      if (file.path === "cloudmarkup-export/cloudmarkup-iac")
        chmodSync(path, 0o755);
    }
    writeFileSync(
      join(root, "cloudmarkup-export", "asset-manifest.json"),
      JSON.stringify({
        contractVersion: 1,
        profile: "cloudformation-infrastructure-only-v1",
        targetSettingsDigest: settings.digest,
        files: files.map(({ path, sha256, bytes }) => ({
          path,
          sha256,
          sizeBytes: bytes.byteLength,
        })),
      }) + "\n",
    );
    const layer = new lambda.LayerVersion(scope, "SolutionExportRuntime", {
      code: lambda.Code.fromAsset(root),
      layerVersionName: "cloudmarkup-beta-solution-export-runtime",
      compatibleArchitectures: [lambda.Architecture.ARM_64],
      compatibleRuntimes: [lambda.Runtime.NODEJS_24_X],
      description:
        "Pinned offline CloudFormation compiler, reviewed catalog icons and native diagram renderer.",
    });
    return {
      layer,
      environment: {
        CLOUDMARKUP_SOLUTION_EXPORTS_ENABLED: "true",
        CLOUDMARKUP_SOLUTION_EXPORT_PROFILE:
          "cloudformation-infrastructure-only-v1",
        CLOUDMARKUP_SOLUTION_EXPORT_COMPILER_PATH:
          "/opt/cloudmarkup-export/cloudmarkup-iac",
        CLOUDMARKUP_SOLUTION_EXPORT_COMPILER_SHA256: compiler.sha256,
        CLOUDMARKUP_SOLUTION_EXPORT_ICON_BUNDLE_PATH:
          "/opt/cloudmarkup-export/diagram-icons.json",
        CLOUDMARKUP_SOLUTION_EXPORT_ICON_BUNDLE_SHA256:
          assets.iconBundle.sha256,
        CLOUDMARKUP_SOLUTION_EXPORT_TARGET_SETTINGS_DIGEST: settings.digest,
      },
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
