import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { canonicalJson, compareText, sha256 } from "./canonical-json.mjs";
import {
  calculateAssetSetDigest,
  calculateSelectedSourceSha256,
  createPlaceholderEntry,
  IMPORT_TOOL_ID,
  IMPORT_TOOL_VERSION,
  PROVIDER_ICON_MANIFEST_CONTRACT_VERSION,
  PROVIDER_ICON_MANIFEST_KIND,
  validateProviderIconStagingManifest,
} from "./manifest-contract.mjs";
import { normalizeImportedProviderSvgSource } from "./source-normalization.mjs";
import {
  BASE_PROVIDER_ICON_TRANSFORMATION_STEPS,
  PROVIDER_ICON_TRANSFORMATION_STEPS,
  REMOVE_UNUSED_ROOT_XLINK_NAMESPACE_STEP,
} from "./transformation-steps.mjs";
import {
  MAX_PROVIDER_SVG_BYTES,
  validateAndNormalizeSvg,
} from "./svg-policy.mjs";
import { generateWebAssetModule } from "./web-registration.mjs";

const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const OUTPUT_FILE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*\.svg$/u;
const ASSET_ID_PATTERN = /^[a-z][a-z0-9.-]*$/u;
const EXPLICIT_UTC_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const URI_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/iu;
const WINDOWS_DRIVE_PATH_PATTERN = /^[A-Za-z]:[\\/]/u;
const NETWORK_OR_DEVICE_PATH_PATTERN =
  /^(?:[\\/]{2}|[\\/](?:\?\?|device|globalroot)(?:[\\/]|$))/iu;

export function isNonLocalFilesystemPath(value) {
  return (
    typeof value === "string" &&
    (NETWORK_OR_DEVICE_PATH_PATTERN.test(value) ||
      (URI_SCHEME_PATTERN.test(value) &&
        !WINDOWS_DRIVE_PATH_PATTERN.test(value)))
  );
}

export function resolveExternalReviewDirectory(repositoryRoot, value) {
  if (
    typeof value !== "string" ||
    value.trim() === "" ||
    isNonLocalFilesystemPath(value)
  ) {
    fail("review staging must name a local directory.");
  }

  const resolvedRepositoryRoot = path.resolve(repositoryRoot);
  const resolvedReviewDirectory = path.resolve(value);
  const relative = path.relative(
    resolvedRepositoryRoot,
    resolvedReviewDirectory,
  );
  const isInsideRepository =
    relative === "" ||
    (!path.isAbsolute(relative) &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`));
  if (isInsideRepository) {
    fail("review staging must remain outside the repository.");
  }

  return resolvedReviewDirectory;
}

export async function resolveSafeExternalReviewDirectory(
  repositoryRoot,
  value,
) {
  const resolvedReviewDirectory = resolveExternalReviewDirectory(
    repositoryRoot,
    value,
  );
  const metadata = await lstat(resolvedReviewDirectory).catch(() => undefined);
  if (
    metadata === undefined ||
    !metadata.isDirectory() ||
    metadata.isSymbolicLink()
  ) {
    fail("review staging must be an existing real directory.");
  }

  const canonicalRepositoryRoot = await realpath(repositoryRoot);
  const canonicalReviewDirectory = await realpath(resolvedReviewDirectory);
  const relative = path.relative(
    canonicalRepositoryRoot,
    canonicalReviewDirectory,
  );
  if (
    relative === "" ||
    (!path.isAbsolute(relative) &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`))
  ) {
    fail("review staging resolves inside the repository.");
  }
  return canonicalReviewDirectory;
}

function fail(message) {
  throw new TypeError(`Provider icon import rejected: ${message}`);
}

function assertNonEmpty(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    fail(`${field} is required.`);
  }
}

function assertExactKeys(value, keys, field) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(`${field} must be an object.`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`${field} must contain exactly: ${expected.join(", ")}.`);
  }
}

function normalizeRelativeMember(member) {
  assertNonEmpty(member, "Mapping sourceFile");
  if (
    isNonLocalFilesystemPath(member) ||
    path.isAbsolute(member) ||
    /^[A-Za-z]:[\\/]/u.test(member)
  ) {
    fail("mapping sourceFile must be a local relative path.");
  }

  const normalized = member.replaceAll("\\", "/");
  const segments = normalized.split("/");
  if (
    segments.some(
      (segment) => segment === "" || segment === "." || segment === "..",
    )
  ) {
    fail("mapping sourceFile contains an empty or traversal segment.");
  }
  if (path.posix.extname(normalized).toLowerCase() !== ".svg") {
    fail("only SVG source files are supported.");
  }

  return normalized;
}

function validateMapping(mapping, services) {
  assertExactKeys(mapping, ["contractVersion", "mappings"], "mapping");
  if (mapping.contractVersion !== 2 || !Array.isArray(mapping.mappings)) {
    fail("mapping contractVersion or mappings is invalid.");
  }

  const serviceByIconId = new Map(
    services.map((service) => [service.iconId, service]),
  );
  const seenIds = new Set();
  const evidenceByDestinationAssetId = new Map();
  const evidenceByOutputFile = new Map();
  const normalizedMappings = mapping.mappings.map((entry, index) => {
    assertExactKeys(
      entry,
      [
        "awsServiceFamily",
        "destinationAssetId",
        "iconId",
        "mappingType",
        "outputFile",
        "sourceFile",
      ],
      `mapping.mappings[${index}]`,
    );
    assertNonEmpty(entry.iconId, `mapping.mappings[${index}].iconId`);
    const service = serviceByIconId.get(entry.iconId);
    if (service === undefined) {
      fail(`mapping contains non-catalog icon ID ${entry.iconId}.`);
    }
    if (seenIds.has(entry.iconId)) {
      fail(`mapping repeats icon ID ${entry.iconId}.`);
    }
    seenIds.add(entry.iconId);
    assertNonEmpty(
      entry.awsServiceFamily,
      `mapping.mappings[${index}].awsServiceFamily`,
    );
    if (!ASSET_ID_PATTERN.test(entry.destinationAssetId)) {
      fail(
        `mapping destinationAssetId for ${entry.iconId} must be an explicit stable asset ID.`,
      );
    }
    if (!["exact-resource", "service-family"].includes(entry.mappingType)) {
      fail(
        `mapping mappingType for ${entry.iconId} must be exact-resource or service-family.`,
      );
    }

    const sourceFile = normalizeRelativeMember(entry.sourceFile);
    if (
      typeof entry.outputFile !== "string" ||
      !OUTPUT_FILE_PATTERN.test(entry.outputFile)
    ) {
      fail(
        `mapping outputFile for ${entry.iconId} must be an explicit deterministic SVG filename.`,
      );
    }

    const canonicalEvidence = JSON.stringify({
      destinationAssetId: entry.destinationAssetId,
      outputFile: entry.outputFile,
      sourceFile,
    });
    const existingOutputEvidence = evidenceByOutputFile.get(entry.outputFile);
    if (
      existingOutputEvidence !== undefined &&
      existingOutputEvidence !== canonicalEvidence
    ) {
      fail(`output filename ${entry.outputFile} maps to multiple assets.`);
    }
    evidenceByOutputFile.set(entry.outputFile, canonicalEvidence);
    const existingDestinationEvidence = evidenceByDestinationAssetId.get(
      entry.destinationAssetId,
    );
    if (
      existingDestinationEvidence !== undefined &&
      existingDestinationEvidence !== canonicalEvidence
    ) {
      fail(
        `destination asset ${entry.destinationAssetId} maps to multiple files or sources.`,
      );
    }
    evidenceByDestinationAssetId.set(
      entry.destinationAssetId,
      canonicalEvidence,
    );

    return Object.freeze({
      awsServiceFamily: entry.awsServiceFamily,
      destinationAssetId: entry.destinationAssetId,
      iconId: entry.iconId,
      mappingType: entry.mappingType,
      outputFile: entry.outputFile,
      serviceName: service.serviceName,
      sourceFile,
    });
  });

  return normalizedMappings.sort((left, right) =>
    compareText(left.iconId, right.iconId),
  );
}

async function requireRealDirectory(directory) {
  if (
    typeof directory !== "string" ||
    directory.trim() === "" ||
    isNonLocalFilesystemPath(directory)
  ) {
    fail("source must name a local directory.");
  }
  const metadata = await lstat(directory).catch(() => undefined);
  if (metadata?.isSymbolicLink() === true) {
    fail("source directory cannot be a symbolic link.");
  }
  if (metadata === undefined || !metadata.isDirectory()) {
    fail("source directory does not exist or is not a directory.");
  }
  const canonicalDirectory = await realpath(directory);
  if (isNonLocalFilesystemPath(canonicalDirectory)) {
    fail("source directory resolves to a non-local path.");
  }
  return canonicalDirectory;
}

async function readSafeSourceMember(sourceDirectory, member) {
  const sourceRoot = path.resolve(sourceDirectory);
  const segments = member.split("/");
  let current = sourceRoot;

  for (const segment of segments) {
    current = path.join(current, segment);
    const metadata = await lstat(current).catch(() => undefined);
    if (metadata === undefined) {
      fail(`mapped source member is missing: ${member}.`);
    }
    if (metadata.isSymbolicLink()) {
      fail(`mapped source member traverses a symbolic link: ${member}.`);
    }
  }

  const relative = path.relative(sourceRoot, current);
  if (
    relative === "" ||
    relative.startsWith(`..${path.sep}`) ||
    relative === ".." ||
    path.isAbsolute(relative)
  ) {
    fail("mapped source member escapes the source directory.");
  }

  const metadata = await lstat(current);
  if (!metadata.isFile()) {
    fail(`mapped source member is not a regular file: ${member}.`);
  }
  if (metadata.size > MAX_PROVIDER_SVG_BYTES) {
    fail(
      `mapped source member exceeds ${MAX_PROVIDER_SVG_BYTES} bytes: ${member}.`,
    );
  }
  return readFile(current);
}

function validateCatalog(catalog) {
  assertExactKeys(
    catalog,
    ["catalogDigest", "catalogId", "catalogVersion", "providerId", "services"],
    "catalog descriptor",
  );
  for (const key of [
    "catalogDigest",
    "catalogId",
    "catalogVersion",
    "providerId",
  ]) {
    assertNonEmpty(catalog[key], `catalog descriptor ${key}`);
  }
  if (!DIGEST_PATTERN.test(catalog.catalogDigest)) {
    fail("catalog descriptor digest is invalid.");
  }
  if (!Array.isArray(catalog.services) || catalog.services.length === 0) {
    fail("catalog descriptor services is invalid.");
  }
  const services = catalog.services.map((service, index) => {
    assertExactKeys(
      service,
      ["iconId", "serviceName"],
      `catalog descriptor services[${index}]`,
    );
    assertNonEmpty(
      service.iconId,
      `catalog descriptor services[${index}].iconId`,
    );
    assertNonEmpty(
      service.serviceName,
      `catalog descriptor services[${index}].serviceName`,
    );
    return Object.freeze({
      iconId: service.iconId,
      serviceName: service.serviceName,
    });
  });
  if (
    new Set(services.map((service) => service.iconId)).size !== services.length
  ) {
    fail("catalog contains duplicate icon IDs.");
  }
  return services.sort((left, right) => compareText(left.iconId, right.iconId));
}

function validateImportMetadata(metadata) {
  assertExactKeys(
    metadata,
    [
      "approval",
      "assetSetVersion",
      "importedAt",
      "packageLabel",
      "packageSha256",
      "packageVersion",
      "selectedSourceSha256",
      "sourceOrigin",
    ],
    "import metadata",
  );
  for (const key of [
    "assetSetVersion",
    "importedAt",
    "packageLabel",
    "packageSha256",
    "packageVersion",
    "sourceOrigin",
  ]) {
    assertNonEmpty(metadata[key], `import metadata ${key}`);
  }
  assertExactKeys(
    metadata.approval,
    [
      "accessibilityContract",
      "approvalDate",
      "approvedSurfaces",
      "recordId",
      "reviewerName",
      "reviewerRelationship",
      "reviewerRole",
      "trademarkUseAcknowledgment",
    ],
    "import metadata approval",
  );
  if (!metadata.sourceOrigin.startsWith("https://")) {
    fail("sourceOrigin must be the reviewed official HTTPS location.");
  }
  if (
    metadata.selectedSourceSha256 !== undefined &&
    !DIGEST_PATTERN.test(metadata.selectedSourceSha256)
  ) {
    fail("selectedSourceSha256 must be omitted or a lowercase SHA-256 digest.");
  }
  if (!DIGEST_PATTERN.test(metadata.packageSha256)) {
    fail("packageSha256 must be a lowercase SHA-256 digest.");
  }
  if (!EXPLICIT_UTC_TIMESTAMP_PATTERN.test(metadata.importedAt)) {
    fail("importedAt must be an explicit UTC timestamp.");
  }
  const timestamp = new Date(metadata.importedAt);
  if (Number.isNaN(timestamp.getTime())) {
    fail("importedAt is not a valid timestamp.");
  }
}

async function assertNoImportRecoveryArtifacts(file) {
  const recoveryPrefix = `${path.basename(file)}.cloudmarkup-import-`;
  const directoryEntries = await readdir(path.dirname(file), {
    withFileTypes: true,
  });
  if (
    directoryEntries.some(
      (entry) =>
        entry.name.startsWith(recoveryPrefix) &&
        (entry.name.endsWith(".tmp") || entry.name.endsWith(".backup")),
    )
  ) {
    fail("a stale provider-icon import temporary or backup blocks the update.");
  }
}

async function assertSafeImportTarget(file, label) {
  const existing = await lstat(file).catch(() => undefined);
  if (
    existing !== undefined &&
    (!existing.isFile() || existing.isSymbolicLink())
  ) {
    fail(`${label} must be absent or a regular file.`);
  }
}

async function writeAtomic(file, bytes) {
  const temporaryFile = `${file}.cloudmarkup-import-${process.pid}.tmp`;
  const backupFile = `${file}.cloudmarkup-import-${process.pid}.backup`;
  let movedExistingFile = false;
  try {
    await assertNoImportRecoveryArtifacts(file);
    await writeFile(temporaryFile, bytes, { flag: "wx" });
    const existingFile = await lstat(file).catch(() => undefined);
    if (existingFile !== undefined) {
      if (!existingFile.isFile() || existingFile.isSymbolicLink()) {
        fail("an import destination is not a regular file.");
      }
      await rename(file, backupFile);
      movedExistingFile = true;
    }
    await rename(temporaryFile, file);
    if (movedExistingFile) {
      await unlink(backupFile);
    }
  } catch (error) {
    await unlink(temporaryFile).catch(() => undefined);
    if (movedExistingFile) {
      const replacement = await lstat(file).catch(() => undefined);
      if (replacement !== undefined) {
        await unlink(file).catch(() => undefined);
      }
      await rename(backupFile, file).catch(() => undefined);
    }
    throw error;
  }
}

async function ensureSafeDestination(directory) {
  await mkdir(directory, { recursive: true });
  const metadata = await lstat(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    fail("destination icon directory must be a real directory.");
  }
}

async function findOrphanedStagingFiles(directory, expectedFiles) {
  const metadata = await lstat(directory).catch(() => undefined);
  if (metadata === undefined) {
    return [];
  }
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    fail("destination icon directory must be a real directory.");
  }

  const orphanedFiles = [];
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => compareText(left.name, right.name));
  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      fail(`destination asset is a symbolic link: ${entry.name}.`);
    }
    if (!entry.isFile()) {
      fail(`destination icon directory contains a non-file: ${entry.name}.`);
    }
    if (!expectedFiles.has(entry.name)) {
      orphanedFiles.push(entry.name);
    }
  }
  return orphanedFiles;
}

export async function importProviderIcons({
  catalog,
  destinationDirectory,
  manifestFile,
  mapping,
  metadata,
  registrationFile,
  sourceDirectory,
  write = false,
}) {
  const services = validateCatalog(catalog);
  validateImportMetadata(metadata);
  const mappings = validateMapping(mapping, services);
  const canonicalSourceDirectory = await requireRealDirectory(sourceDirectory);

  const admittedByOutputFile = new Map();
  const assetIdentityByNormalizedDigest = new Map();
  const importedEntries = new Map();
  for (const entry of mappings) {
    const sourceBytes = await readSafeSourceMember(
      canonicalSourceDirectory,
      entry.sourceFile,
    );
    const sourceNormalization = normalizeImportedProviderSvgSource(sourceBytes);
    const normalized = validateAndNormalizeSvg(sourceNormalization.bytes);
    const sourceDigest = sha256(sourceBytes);
    const admittedDigest = sha256(normalized.bytes);
    const transformationSteps = [
      ...(sourceNormalization.removedUnusedRootXlinkNamespaceDeclaration
        ? [REMOVE_UNUSED_ROOT_XLINK_NAMESPACE_STEP]
        : []),
      ...BASE_PROVIDER_ICON_TRANSFORMATION_STEPS,
    ];
    const existing = admittedByOutputFile.get(entry.outputFile);
    if (
      existing !== undefined &&
      (existing.admittedDigest !== admittedDigest ||
        existing.sourceDigest !== sourceDigest ||
        JSON.stringify(existing.transformationSteps) !==
          JSON.stringify(transformationSteps))
    ) {
      fail(`output filename ${entry.outputFile} does not identify one asset.`);
    }
    admittedByOutputFile.set(entry.outputFile, {
      admittedDigest,
      bytes: normalized.bytes,
      sourceDigest,
      transformationSteps,
    });
    const normalizedAssetIdentity = JSON.stringify({
      destinationAssetId: entry.destinationAssetId,
      file: entry.outputFile,
    });
    const priorNormalizedAssetIdentity =
      assetIdentityByNormalizedDigest.get(admittedDigest);
    if (
      priorNormalizedAssetIdentity !== undefined &&
      priorNormalizedAssetIdentity !== normalizedAssetIdentity
    ) {
      fail(`normalized bytes ${admittedDigest} map to multiple assets.`);
    }
    assetIdentityByNormalizedDigest.set(
      admittedDigest,
      normalizedAssetIdentity,
    );
    importedEntries.set(entry.iconId, {
      automatedSecurityResult: "passed",
      awsServiceFamily: entry.awsServiceFamily,
      destinationAssetId: entry.destinationAssetId,
      file: entry.outputFile,
      iconId: entry.iconId,
      mappingType: entry.mappingType,
      mediaType: "image/svg+xml",
      normalizedBytes: normalized.bytes.byteLength,
      normalizedSha256: admittedDigest,
      serviceName: entry.serviceName,
      sourceBytes: sourceBytes.byteLength,
      sourceMember: entry.sourceFile,
      sourceSha256: sourceDigest,
      state: "candidate",
      transformationSteps,
      viewBox: normalized.viewBox,
    });
  }
  const entries = services.map(
    (service) =>
      importedEntries.get(service.iconId) ??
      createPlaceholderEntry(service.iconId, service.serviceName),
  );
  const selectedSourceSha256 = calculateSelectedSourceSha256(entries);
  if (write && metadata.selectedSourceSha256 === undefined) {
    fail("write mode requires the reviewed selectedSourceSha256.");
  }
  if (
    metadata.selectedSourceSha256 !== undefined &&
    selectedSourceSha256 !== metadata.selectedSourceSha256
  ) {
    fail(
      "selected source checksum does not match the mapped canonical source members.",
    );
  }

  const manifestWithoutDigest = {
    approval: structuredClone(metadata.approval),
    assetSet: {
      digest:
        "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      id: "aws.cloudmarkup.provider-icons",
      providerId: catalog.providerId,
      version: metadata.assetSetVersion,
    },
    catalogs: [
      {
        digest: catalog.catalogDigest,
        id: catalog.catalogId,
        version: catalog.catalogVersion,
      },
    ],
    contractVersion: PROVIDER_ICON_MANIFEST_CONTRACT_VERSION,
    entries,
    kind: PROVIDER_ICON_MANIFEST_KIND,
    source: {
      importedAt: metadata.importedAt,
      origin: metadata.sourceOrigin,
      packageLabel: metadata.packageLabel,
      packageSha256: metadata.packageSha256,
      packageVersion: metadata.packageVersion,
    },
    transformation: {
      steps: [...PROVIDER_ICON_TRANSFORMATION_STEPS],
      tool: IMPORT_TOOL_ID,
      version: IMPORT_TOOL_VERSION,
    },
  };
  const manifest = {
    ...manifestWithoutDigest,
    assetSet: {
      ...manifestWithoutDigest.assetSet,
      digest: calculateAssetSetDigest(manifestWithoutDigest),
    },
  };
  validateProviderIconStagingManifest(manifest);
  const orphanedFiles = await findOrphanedStagingFiles(
    destinationDirectory,
    new Set(admittedByOutputFile.keys()),
  );

  if (write) {
    await ensureSafeDestination(destinationDirectory);
    const plannedWrites = [];
    for (const [file, asset] of [...admittedByOutputFile.entries()].sort(
      ([left], [right]) => compareText(left, right),
    )) {
      const destination = path.join(destinationDirectory, file);
      await assertSafeImportTarget(destination, `destination asset ${file}`);
      plannedWrites.push([destination, asset.bytes]);
    }

    const manifestDirectory = path.dirname(manifestFile);
    await mkdir(manifestDirectory, { recursive: true });
    const manifestDirectoryMetadata = await lstat(manifestDirectory);
    if (
      !manifestDirectoryMetadata.isDirectory() ||
      manifestDirectoryMetadata.isSymbolicLink()
    ) {
      fail("manifest destination must be a real directory.");
    }
    await assertSafeImportTarget(manifestFile, "manifest destination");
    plannedWrites.push([manifestFile, canonicalJson(manifest)]);
    if (registrationFile !== undefined) {
      const registrationDirectory = path.dirname(registrationFile);
      await mkdir(registrationDirectory, { recursive: true });
      const registrationDirectoryMetadata = await lstat(registrationDirectory);
      if (
        !registrationDirectoryMetadata.isDirectory() ||
        registrationDirectoryMetadata.isSymbolicLink()
      ) {
        fail("web registration destination must be a real directory.");
      }
      await assertSafeImportTarget(
        registrationFile,
        "web registration destination",
      );
      plannedWrites.push([registrationFile, generateWebAssetModule(manifest)]);
    }
    for (const [file] of plannedWrites) {
      await assertNoImportRecoveryArtifacts(file);
    }
    for (const [file, bytes] of plannedWrites) {
      await writeAtomic(file, bytes);
    }
  }

  return Object.freeze({
    importedIconIds: Object.freeze([...importedEntries.keys()].sort()),
    manifest,
    manifestBytes: canonicalJson(manifest),
    missingIconIds: Object.freeze(
      services
        .map((service) => service.iconId)
        .filter((iconId) => !importedEntries.has(iconId)),
    ),
    orphanedFiles: Object.freeze(orphanedFiles),
    registrationBytes: generateWebAssetModule(manifest),
    selectedSourceSha256,
  });
}
