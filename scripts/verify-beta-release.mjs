import { createHash } from "node:crypto";
import { lstat, readdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  BETA_DEPLOYMENT_WORKFLOW_PATH,
  validateBetaDeploymentWorkflowText,
} from "./beta-deployment-workflow-policy.mjs";
import {
  validateBetaAssembly,
  validateBetaReleaseEnvironment,
} from "./beta-release-gate-core.mjs";
import { serializeBetaServiceProfile } from "./beta-sandbox-delivery-admission.mjs";

const maximumFiles = 2_048;
const maximumTextBytes = 32 * 1024 * 1024;
const maximumDeployableAssetBytes = 64 * 1024 * 1024;
const verificationModes = new Set([
  "--all",
  "--artifacts-only",
  "--policy-only",
]);
const platformRequire = createRequire(
  resolve("infra", "platform", "package.json"),
);
const { FileSystem } = platformRequire("aws-cdk-lib");

export function validateBetaReleaseVerificationEnvironment(environment, mode) {
  if (!verificationModes.has(mode)) {
    throw new TypeError("The beta release verification mode is invalid.");
  }
  return validateBetaReleaseEnvironment(environment, {
    requireActivation: false,
  });
}

function within(root, path) {
  const local = relative(root, path);
  return (
    local !== "" && !local.startsWith("..") && resolve(root, local) === path
  );
}

async function regularText(path, label) {
  let metadata;
  try {
    metadata = await lstat(path);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(`${label} is missing.`);
    }
    throw error;
  }
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`${label} must be a regular file.`);
  }
  if (metadata.size > 10 * 1024 * 1024) {
    throw new Error(`${label} exceeds the reviewed 10 MiB per-file limit.`);
  }
  return readFile(path, "utf8");
}

async function regularDirectory(path, label) {
  let metadata;
  try {
    metadata = await lstat(path);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(`${label} is missing.`);
    }
    throw error;
  }
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(`${label} must be a real directory.`);
  }
}

function localReference(root, directory, reference, label) {
  if (
    typeof reference !== "string" ||
    reference.length === 0 ||
    isAbsolute(reference)
  ) {
    throw new Error(`${label} must be a non-empty relative path.`);
  }
  const path = resolve(directory, reference);
  if (!within(root, path)) {
    throw new Error(`${label} must stay inside the beta assembly root.`);
  }
  return path;
}

async function collectFiles(root, directory = root, files = []) {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (!within(root, path)) {
      throw new Error("Release artifact traversal escaped its reviewed root.");
    }
    if (entry.isSymbolicLink()) {
      throw new Error("Release artifacts cannot contain symbolic links.");
    }
    if (entry.isDirectory()) {
      await collectFiles(root, path, files);
    } else if (entry.isFile()) {
      files.push(path);
      if (files.length > maximumFiles) {
        throw new Error(
          "Release artifact file count exceeds the reviewed limit.",
        );
      }
    } else {
      throw new Error(
        "Release artifacts must contain regular files or directories.",
      );
    }
  }
  return files;
}

async function readDeployableAssetFiles(root, label) {
  const metadata = await lstat(root);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(`${label} must be a real directory.`);
  }
  const files = await collectFiles(root);
  const deployableFiles = [];
  let aggregateBytes = 0;
  let textBytes = 0;
  for (const path of files) {
    const fileMetadata = await lstat(path);
    if (!fileMetadata.isFile() || fileMetadata.isSymbolicLink()) {
      throw new Error(`${label} must contain only regular files.`);
    }
    if (fileMetadata.size > 10 * 1024 * 1024) {
      throw new Error(`${label} exceeds the reviewed 10 MiB per-file limit.`);
    }
    const bytes = await readFile(path);
    aggregateBytes += bytes.length;
    if (aggregateBytes > maximumDeployableAssetBytes) {
      throw new Error(
        `${label} exceeds the reviewed 64 MiB aggregate file limit.`,
      );
    }
    const entry = {
      byteLength: bytes.length,
      path: relative(root, path).replaceAll("\\", "/"),
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
    if (
      entry.path === "cloudmarkup-iac-import" ||
      entry.path === "cloudmarkup-export/cloudmarkup-iac" ||
      entry.path ===
        "nodejs/node_modules/@resvg/resvg-js-linux-arm64-gnu/resvgjs.linux-arm64-gnu.node"
    )
      entry.headerHex = bytes.subarray(0, 20).toString("hex");
    if (/\.(?:css|html|m?js|json|map|txt|webmanifest)$/u.test(path)) {
      textBytes += bytes.length;
      entry.text = bytes.toString("utf8");
    }
    if (textBytes > maximumTextBytes) {
      throw new Error(`${label} text exceeds the reviewed 32 MiB scan limit.`);
    }
    deployableFiles.push(entry);
  }
  return deployableFiles;
}

function object(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return value;
}

function exactObject(value, expectedKeys, label) {
  const candidate = object(value, label);
  const actualKeys = Object.keys(candidate).sort();
  const reviewedKeys = [...expectedKeys].sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify(reviewedKeys)) {
    throw new Error(
      label + " must contain exactly " + reviewedKeys.join(", ") + ".",
    );
  }
  return candidate;
}

function rejectLegacyAssetMetadata(value) {
  const pending = [value];
  while (pending.length > 0) {
    const candidate = pending.pop();
    if (candidate === null || typeof candidate !== "object") continue;
    if (!Array.isArray(candidate) && candidate.type === "aws:cdk:asset") {
      throw new Error(
        "CDK stack metadata cannot contain legacy aws:cdk:asset entries.",
      );
    }
    pending.push(...Object.values(candidate));
  }
}

export async function readBetaAssembly(rootDirectory) {
  const root = resolve(
    rootDirectory ??
      process.env["CLOUDMARKUP_BETA_ASSEMBLY_DIR"] ??
      resolve("artifacts", "platform", "cdk.out"),
  );
  await regularDirectory(root, "The beta CDK assembly root");
  const files = await collectFiles(root);
  const manifests = files.filter((path) => basename(path) === "manifest.json");
  const rootManifestPath = resolve(root, "manifest.json");
  if (!manifests.includes(rootManifestPath)) {
    throw new Error("The beta CDK assembly root manifest.json is missing.");
  }
  const stacks = [];
  const deployableAssets = [];
  const activeManifests = new Set();
  const seenManifests = new Set();
  const seenAssetManifests = new Set();
  const seenTemplates = new Set();

  const visitManifest = async (manifestPath) => {
    if (activeManifests.has(manifestPath)) {
      throw new Error("CDK cloud-assembly references cannot contain a cycle.");
    }
    if (seenManifests.has(manifestPath)) {
      throw new Error("CDK cloud-assembly references must be unique.");
    }
    activeManifests.add(manifestPath);
    seenManifests.add(manifestPath);
    const manifest = object(
      JSON.parse(await regularText(manifestPath, "CDK manifest")),
      "CDK manifest",
    );
    const artifacts = object(manifest.artifacts ?? {}, "CDK artifacts");
    for (const artifact of Object.values(artifacts)) {
      if (
        artifact === null ||
        typeof artifact !== "object" ||
        Array.isArray(artifact)
      ) {
        continue;
      }
      if (artifact.type === "cdk:cloud-assembly") {
        const properties = object(
          artifact.properties,
          "CDK cloud-assembly properties",
        );
        const assemblyDirectory = localReference(
          root,
          dirname(manifestPath),
          properties.directoryName,
          "CDK cloud-assembly directoryName",
        );
        await regularDirectory(
          assemblyDirectory,
          "Referenced CDK cloud-assembly directory",
        );
        const childManifestPath = resolve(assemblyDirectory, "manifest.json");
        if (!within(root, childManifestPath)) {
          throw new Error(
            "Referenced CDK manifest must stay inside the beta assembly root.",
          );
        }
        await visitManifest(childManifestPath);
        continue;
      }
      if (artifact.type === "cdk:asset-manifest") {
        const properties = object(
          artifact.properties,
          "CDK asset-manifest properties",
        );
        const assetManifestPath = localReference(
          root,
          dirname(manifestPath),
          properties.file,
          "CDK asset-manifest file",
        );
        if (seenAssetManifests.has(assetManifestPath)) {
          throw new Error(
            "CDK asset-manifest references must be unique and local.",
          );
        }
        seenAssetManifests.add(assetManifestPath);
        const assetManifest = object(
          JSON.parse(
            await regularText(assetManifestPath, "CDK asset manifest"),
          ),
          "CDK asset manifest",
        );
        const reviewedAssetManifest = exactObject(
          assetManifest,
          ["dockerImages", "files", "version"],
          "CDK asset manifest",
        );
        if (reviewedAssetManifest.version !== "54.0.0") {
          throw new Error(
            "CDK asset manifest version must match the reviewed schema.",
          );
        }
        const dockerImages = object(
          reviewedAssetManifest.dockerImages,
          "CDK Docker-image assets",
        );
        if (Object.keys(dockerImages).length !== 0) {
          throw new Error(
            "The beta deployment assembly cannot contain Docker-image assets.",
          );
        }
        for (const [assetId, asset] of Object.entries(
          object(reviewedAssetManifest.files, "CDK file assets"),
        )) {
          const fileAsset = object(asset, "CDK file asset");
          const displayName = fileAsset.displayName;
          const source = exactObject(
            fileAsset.source,
            ["packaging", "path"],
            "CDK file-asset source",
          );
          if (source.packaging !== "file" && source.packaging !== "zip") {
            throw new Error(
              "CDK file-asset packaging must be exactly file or zip.",
            );
          }
          const sourcePath = localReference(
            root,
            dirname(assetManifestPath),
            source.path,
            "CDK file-asset source path",
          );
          const sourceMetadata = await lstat(sourcePath);
          if (
            sourceMetadata.isSymbolicLink() ||
            (!sourceMetadata.isFile() && !sourceMetadata.isDirectory())
          ) {
            throw new Error(
              "CDK file-asset source must be a regular file or real directory.",
            );
          }
          if (
            displayName !== "ApiFunction/Code" &&
            displayName !== "ProjectContentCleanup/WorkerFunction/Code" &&
            displayName !== "RepositoryImportParser/Code" &&
            displayName !== "SolutionExport/SolutionExportRuntime/Code" &&
            displayName !== "SolutionExport/WorkerFunction/Code" &&
            displayName !== "DeployWebAssets/Asset1" &&
            displayName !== "SandboxBillingDelivery/WebhookFunction/Code" &&
            displayName !== "SandboxBillingDelivery/WorkerFunction/Code"
          ) {
            continue;
          }
          deployableAssets.push({
            displayName,
            fingerprint: FileSystem.fingerprint(sourcePath),
            files: await readDeployableAssetFiles(
              sourcePath,
              `${displayName} deployable asset file`,
            ),
            id: assetId,
            packaging: source.packaging,
            path: relative(root, sourcePath).replaceAll("\\", "/"),
          });
        }
        continue;
      }
      if (
        artifact.type === "cdk:tree" ||
        artifact.type === "cdk:feature-flag-report"
      ) {
        continue;
      }
      if (artifact.type !== "aws:cloudformation:stack") {
        throw new Error(
          "The beta assembly contains an unreviewed CDK artifact type.",
        );
      }
      rejectLegacyAssetMetadata(artifact.metadata);
      const properties = object(artifact.properties, "CDK stack properties");
      if (typeof properties.stackName !== "string") {
        throw new Error(
          "CDK stack artifacts require stackName and templateFile.",
        );
      }
      const templatePath = localReference(
        root,
        dirname(manifestPath),
        properties.templateFile,
        "CDK stack templateFile",
      );
      if (seenTemplates.has(templatePath)) {
        throw new Error(
          "CDK stack template references must be unique and local.",
        );
      }
      seenTemplates.add(templatePath);
      stacks.push({
        path: relative(root, templatePath).replaceAll("\\", "/"),
        stackName: properties.stackName,
        template: object(
          JSON.parse(await regularText(templatePath, "CDK stack template")),
          "CDK stack template",
        ),
      });
    }
    activeManifests.delete(manifestPath);
  };

  await visitManifest(rootManifestPath);
  const orphanManifests = manifests.filter(
    (manifestPath) => !seenManifests.has(manifestPath),
  );
  if (orphanManifests.length > 0) {
    throw new Error("The beta assembly contains an unreferenced CDK manifest.");
  }
  const unreferenced = files.filter(
    (path) => path.endsWith(".template.json") && !seenTemplates.has(path),
  );
  if (unreferenced.length > 0) {
    throw new Error(
      "The beta assembly contains an unreferenced stack template.",
    );
  }
  return { deployableAssets, stacks };
}

/** Preparation only. There is deliberately no validator override: receipt
 * creation is inseparable from full admission of these exact copied assets. */
export async function bindBetaServiceProfile(
  environment,
  bundleDirectory = resolve("artifacts", "platform", "deployment-bundle"),
) {
  const snapshot = Object.freeze({ ...environment });
  const inputFindings = validateBetaReleaseVerificationEnvironment(
    snapshot,
    "--artifacts-only",
  );
  if (inputFindings.length > 0) {
    throw new Error(
      "Beta service profile binding failed: " +
        inputFindings.map(({ code }) => code).join(", "),
    );
  }
  const bundle = resolve(bundleDirectory);
  await regularDirectory(bundle, "The copied beta deployment bundle");
  const { deployableAssets, stacks } = await readBetaAssembly(
    resolve(bundle, "cdk.out"),
  );
  const findings = validateBetaAssembly(stacks, snapshot, deployableAssets);
  if (findings.length > 0) {
    throw new Error(
      "Beta service profile binding failed: " +
        findings.map(({ code }) => code).join(", "),
    );
  }
  await writeFile(
    resolve(bundle, "SERVICE_PROFILE.json"),
    serializeBetaServiceProfile(snapshot),
    { encoding: "utf8", flag: "wx" },
  );
}

async function main() {
  const mode = process.argv[2] ?? "--all";
  if (mode === "--bind-service-profile") {
    if (process.argv.length !== 3)
      throw new TypeError(
        "Beta service profile binding accepts no path or validation overrides.",
      );
    await bindBetaServiceProfile(process.env);
    process.stdout.write(
      "beta:release-gate: copied assembly and service profile admitted together; canonical receipt written without credentials.\n",
    );
    return;
  }
  if (!verificationModes.has(mode)) {
    throw new Error(
      "Usage: node scripts/verify-beta-release.mjs [--all|--artifacts-only|--policy-only|--bind-service-profile]",
    );
  }
  const findings = [
    ...validateBetaReleaseVerificationEnvironment(process.env, mode),
  ];
  if (mode !== "--artifacts-only") {
    const workflowText = await regularText(
      resolve(BETA_DEPLOYMENT_WORKFLOW_PATH),
      "Beta deployment workflow",
    );
    findings.push(
      ...validateBetaDeploymentWorkflowText(workflowText).map((entry) => ({
        ...entry,
        path: BETA_DEPLOYMENT_WORKFLOW_PATH,
      })),
    );
  }
  if (mode !== "--policy-only") {
    const { deployableAssets, stacks } = await readBetaAssembly();
    findings.push(
      ...validateBetaAssembly(stacks, process.env, deployableAssets),
    );
  }

  const unique = [
    ...new Map(
      findings.map((entry) => [
        `${entry.code}\u0000${entry.path}\u0000${entry.detail}`,
        entry,
      ]),
    ).values(),
  ].sort((left, right) =>
    `${left.path}:${left.code}`.localeCompare(
      `${right.path}:${right.code}`,
      "en",
    ),
  );
  if (unique.length > 0) {
    process.stderr.write(
      `beta:release-gate failed with ${String(unique.length)} finding(s):\n${unique
        .map(({ code, detail, path }) => `${path}: ${code}: ${detail}`)
        .join("\n")}\n`,
    );
    process.exitCode = 1;
  } else {
    process.stdout.write(
      mode === "--policy-only"
        ? "beta:release-gate: workflow policy and stable beta inputs passed without credentials.\n"
        : mode === "--artifacts-only"
          ? "beta:release-gate: stable beta inputs, exact deployable web/API composition assets, and the beta assembly passed without credentials.\n"
          : "beta:release-gate: workflow policy, stable beta inputs, exact deployable web/API composition assets, and the beta assembly passed without credentials.\n",
    );
  }
}

const entryPoint = process.argv[1];
if (
  entryPoint !== undefined &&
  import.meta.url === pathToFileURL(resolve(entryPoint)).href
) {
  await main();
}
