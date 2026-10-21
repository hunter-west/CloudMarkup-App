import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TextDecoder } from "node:util";

import { awsCatalogV1 } from "@cloudmarkup/provider-aws/catalog";

import {
  importProviderIcons,
  isNonLocalFilesystemPath,
  resolveSafeExternalReviewDirectory,
} from "./provider-icons/import-core.mjs";
import {
  PROVIDER_ICON_ACCESSIBILITY_CONTRACT,
  PROVIDER_ICON_APPROVED_SURFACES,
  PROVIDER_ICON_TRADEMARK_ACKNOWLEDGMENT,
} from "./provider-icons/manifest-contract.mjs";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const MAX_MAPPING_BYTES = 1024 * 1024;

function usage() {
  return [
    "Usage: pnpm icons:import:aws --source <local-directory> --mapping <mapping.json>",
    "  --source-origin <official https URL>",
    "  --package-label <official package/archive name>",
    "  --package-version <exact version or release identifier>",
    "  --package-sha256 <recorded official sha256:...>",
    "  --asset-set-version <semantic version>",
    "  --imported-at <explicit UTC timestamp>",
    "  --approval-record <human approval record ID>",
    "  --reviewer-name <human reviewer name>",
    "  --reviewer-role <human reviewer role>",
    "  --reviewer-relationship <reviewer relationship to provider>",
    "  --approval-date <YYYY-MM-DD>",
    "  [--selected-source-sha256 <sha256:...>]",
    "  [--write --staging <external local review directory>]",
  ].join("\n");
}

function parseArguments(arguments_) {
  const values = new Map();
  let write = false;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--write") {
      if (write) {
        throw new TypeError("Duplicate argument --write.");
      }
      write = true;
      continue;
    }
    if (!argument?.startsWith("--")) {
      throw new TypeError("Arguments must use named flags.");
    }
    const value = arguments_[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new TypeError(`Missing value for ${argument}.`);
    }
    if (values.has(argument)) {
      throw new TypeError(`Duplicate argument ${argument}.`);
    }
    values.set(argument, value);
    index += 1;
  }

  const required = [
    "--approval-date",
    "--approval-record",
    "--asset-set-version",
    "--imported-at",
    "--mapping",
    "--package-label",
    "--package-sha256",
    "--package-version",
    "--reviewer-name",
    "--reviewer-relationship",
    "--reviewer-role",
    "--source",
    "--source-origin",
  ];
  for (const flag of required) {
    if (!values.has(flag)) {
      throw new TypeError(`Missing required argument ${flag}.`);
    }
  }
  if (write && !values.has("--staging")) {
    throw new TypeError("--write requires --staging.");
  }
  if (write && !values.has("--selected-source-sha256")) {
    throw new TypeError("--write requires --selected-source-sha256.");
  }
  const allowed = new Set([
    ...required,
    "--selected-source-sha256",
    "--staging",
  ]);
  for (const flag of values.keys()) {
    if (!allowed.has(flag)) {
      throw new TypeError(`Unknown argument ${flag}.`);
    }
  }

  return { values, write };
}

async function readMapping(file) {
  if (isNonLocalFilesystemPath(file)) {
    throw new TypeError("Mapping must be a local file.");
  }
  const metadata = await lstat(file);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new TypeError("Mapping must be a regular, non-symlink file.");
  }
  if (metadata.size > MAX_MAPPING_BYTES) {
    throw new TypeError(`Mapping cannot exceed ${MAX_MAPPING_BYTES} bytes.`);
  }
  const canonicalFile = await realpath(file);
  if (isNonLocalFilesystemPath(canonicalFile)) {
    throw new TypeError("Mapping resolves to a non-local file.");
  }
  let source;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(
      await readFile(canonicalFile),
    );
  } catch {
    throw new TypeError("Mapping must be valid UTF-8.");
  }
  if (source.includes("\0")) {
    throw new TypeError("Mapping cannot contain NUL bytes.");
  }
  return JSON.parse(source);
}

async function main() {
  const { values, write } = parseArguments(process.argv.slice(2));
  const mappingFile = values.get("--mapping");
  const sourceDirectory = values.get("--source");
  const stagingValue = values.get("--staging");
  const reviewDirectory =
    stagingValue === undefined
      ? undefined
      : await resolveSafeExternalReviewDirectory(repositoryRoot, stagingValue);
  const outputRoot =
    reviewDirectory ??
    path.join(repositoryRoot, ".provider-icon-dry-run-output-not-written");
  const catalogArtifact = awsCatalogV1.artifact;
  const result = await importProviderIcons({
    catalog: {
      catalogDigest: String(catalogArtifact.digest),
      catalogId: String(catalogArtifact.catalog.id),
      catalogVersion: String(catalogArtifact.catalog.version),
      providerId: String(catalogArtifact.provider.id),
      services: awsCatalogV1
        .listServices()
        .filter((service) => service.iconId !== null)
        .map((service) => ({
          iconId: String(service.iconId),
          serviceName: String(service.displayName),
        })),
    },
    destinationDirectory: path.join(outputRoot, "icons"),
    manifestFile: path.join(outputRoot, "provider-icons.manifest.json"),
    mapping: await readMapping(mappingFile),
    metadata: {
      approval: {
        accessibilityContract: PROVIDER_ICON_ACCESSIBILITY_CONTRACT,
        approvalDate: values.get("--approval-date"),
        approvedSurfaces: PROVIDER_ICON_APPROVED_SURFACES,
        recordId: values.get("--approval-record"),
        reviewerName: values.get("--reviewer-name"),
        reviewerRelationship: values.get("--reviewer-relationship"),
        reviewerRole: values.get("--reviewer-role"),
        trademarkUseAcknowledgment: PROVIDER_ICON_TRADEMARK_ACKNOWLEDGMENT,
      },
      assetSetVersion: values.get("--asset-set-version"),
      importedAt: values.get("--imported-at"),
      packageLabel: values.get("--package-label"),
      packageSha256: values.get("--package-sha256"),
      packageVersion: values.get("--package-version"),
      selectedSourceSha256: values.get("--selected-source-sha256"),
      sourceOrigin: values.get("--source-origin"),
    },
    registrationFile: path.join(outputRoot, "aws-assets.generated.ts"),
    sourceDirectory,
    write,
  });

  process.stdout.write(
    `${JSON.stringify(
      {
        importedIconIds: result.importedIconIds,
        missingIconIds: result.missingIconIds,
        mode: write ? "write" : "dry-run",
        orphanedFiles: result.orphanedFiles,
        selectedSourceSha256: result.selectedSourceSha256,
      },
      null,
      2,
    )}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Provider icon import failed."}\n${usage()}\n`,
  );
  process.exitCode = 1;
});
