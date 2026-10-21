import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { TextDecoder } from "node:util";

import { canonicalJson, compareText, sha256 } from "./canonical-json.mjs";
import { isNonLocalFilesystemPath } from "./import-core.mjs";
import {
  calculateAssetSetDigest,
  validateProviderIconManifest,
  validateProviderIconStagingManifest,
} from "./manifest-contract.mjs";
import { compareSemanticVersions } from "./semantic-version.mjs";
import { validateProviderIconSourceReview } from "./source-review.mjs";
import {
  MAX_PROVIDER_SVG_BYTES,
  validateAndNormalizeSvg,
} from "./svg-policy.mjs";
import { generateWebAssetModule } from "./web-registration.mjs";

const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_SOURCE_REVIEW_BYTES = 64 * 1024;
const ICON_ID_PATTERN = /^[a-z][a-z0-9.-]*$/u;
const ZERO_DIGEST =
  "sha256:0000000000000000000000000000000000000000000000000000000000000000";

function fail(message) {
  throw new TypeError(`Provider icon promotion rejected: ${message}`);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function readRegularFile(file, maximumBytes, label) {
  if (isNonLocalFilesystemPath(file)) {
    fail(`${label} must name a local file.`);
  }
  const metadata = await lstat(file).catch(() => undefined);
  if (
    metadata === undefined ||
    !metadata.isFile() ||
    metadata.isSymbolicLink()
  ) {
    fail(`${label} must be a regular, non-symlink file.`);
  }
  if (metadata.size > maximumBytes) {
    fail(`${label} exceeds ${maximumBytes} bytes.`);
  }
  const canonicalFile = await realpath(file);
  if (isNonLocalFilesystemPath(canonicalFile)) {
    fail(`${label} resolves to a non-local path.`);
  }
  return readFile(canonicalFile);
}

function decodeUtf8(bytes, label) {
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    fail(`${label} must be valid UTF-8.`);
  }
  if (text.includes("\0")) {
    fail(`${label} cannot contain NUL bytes.`);
  }
  return text;
}

function assertVersionProgression(current, candidate) {
  if (
    candidate.assetSet.id !== current.assetSet.id ||
    candidate.assetSet.providerId !== current.assetSet.providerId
  ) {
    fail("asset-set identity must remain stable across promotion.");
  }
  if (candidate.assetSet.version === current.assetSet.version) {
    if (candidate.assetSet.digest !== current.assetSet.digest) {
      fail("an existing asset-set version is immutable.");
    }
    return;
  }
  if (
    compareSemanticVersions(
      candidate.assetSet.version,
      current.assetSet.version,
    ) <= 0
  ) {
    fail("asset-set promotion requires an intentional version increase.");
  }
}

async function assertSafeRepositoryTargets(repositoryRoot, targets) {
  const rootMetadata = await lstat(repositoryRoot).catch(() => undefined);
  if (
    rootMetadata === undefined ||
    !rootMetadata.isDirectory() ||
    rootMetadata.isSymbolicLink()
  ) {
    fail("repository root must be a real directory.");
  }
  const canonicalRoot = await realpath(repositoryRoot);
  for (const target of targets) {
    const lexicalRelative = path.relative(repositoryRoot, target);
    if (
      lexicalRelative === "" ||
      path.isAbsolute(lexicalRelative) ||
      lexicalRelative === ".." ||
      lexicalRelative.startsWith(`..${path.sep}`)
    ) {
      fail("promotion destination must remain inside the repository.");
    }

    let existingParent = path.dirname(target);
    let metadata = await lstat(existingParent).catch(() => undefined);
    while (metadata === undefined) {
      const next = path.dirname(existingParent);
      if (next === existingParent) {
        fail("promotion destination has no existing parent.");
      }
      existingParent = next;
      metadata = await lstat(existingParent).catch(() => undefined);
    }
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      fail("promotion destination parent must be a real directory.");
    }
    const canonicalParent = await realpath(existingParent);
    const canonicalRelative = path.relative(canonicalRoot, canonicalParent);
    if (
      canonicalRelative === "" ||
      (!path.isAbsolute(canonicalRelative) &&
        canonicalRelative !== ".." &&
        !canonicalRelative.startsWith(`..${path.sep}`))
    ) {
      continue;
    }
    fail("promotion destination resolves outside the repository.");
  }
}

async function assertExternalStaging(repositoryRoot, stagingDirectory) {
  const metadata = await lstat(stagingDirectory).catch(() => undefined);
  if (
    metadata === undefined ||
    !metadata.isDirectory() ||
    metadata.isSymbolicLink()
  ) {
    fail("staging must be a real, non-symlink directory.");
  }
  const [canonicalRepository, canonicalStaging] = await Promise.all([
    realpath(repositoryRoot),
    realpath(stagingDirectory),
  ]);
  const relative = path.relative(canonicalRepository, canonicalStaging);
  if (
    relative === "" ||
    (!path.isAbsolute(relative) &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`))
  ) {
    fail("staging must remain outside the repository.");
  }
}

function catalogServices(catalog) {
  if (
    !isObject(catalog) ||
    typeof catalog.catalogDigest !== "string" ||
    typeof catalog.catalogId !== "string" ||
    typeof catalog.catalogVersion !== "string" ||
    typeof catalog.providerId !== "string" ||
    !Array.isArray(catalog.services)
  ) {
    fail("catalog descriptor is malformed.");
  }
  const services = catalog.services.map((service) => {
    if (
      !isObject(service) ||
      typeof service.iconId !== "string" ||
      !ICON_ID_PATTERN.test(service.iconId) ||
      typeof service.serviceName !== "string" ||
      service.serviceName.trim() === ""
    ) {
      fail("catalog service descriptor is malformed.");
    }
    return { iconId: service.iconId, serviceName: service.serviceName };
  });
  if (
    new Set(services.map((service) => service.iconId)).size !== services.length
  ) {
    fail("catalog repeats an icon ID.");
  }
  return services.sort((left, right) => compareText(left.iconId, right.iconId));
}

function assertCatalogBinding(manifest, catalog) {
  if (manifest.assetSet.providerId !== catalog.providerId) {
    fail("manifest provider ID does not match the current catalog.");
  }
  if (
    !manifest.catalogs.some(
      (entry) =>
        entry.id === catalog.catalogId &&
        entry.version === catalog.catalogVersion &&
        entry.digest === catalog.catalogDigest,
    )
  ) {
    fail("manifest does not pin the exact current catalog.");
  }
  const services = catalogServices(catalog);
  if (
    !same(
      services.map((service) => service.iconId),
      manifest.entries.map((entry) => entry.iconId),
    )
  ) {
    fail("manifest entries do not exactly cover current catalog icon IDs.");
  }
  for (const [index, service] of services.entries()) {
    if (manifest.entries[index].serviceName !== service.serviceName) {
      fail(
        `manifest serviceName does not match the catalog for ${service.iconId}.`,
      );
    }
  }
}

function validateCurrentManifest(manifest) {
  try {
    validateProviderIconManifest(manifest);
  } catch {
    fail("current manifest is invalid.");
  }
  return manifest;
}

function ownerDecisionProjection(manifest) {
  return {
    approval: manifest.approval,
    entries: manifest.entries.map((entry) =>
      entry.state === "placeholder"
        ? {
            iconId: entry.iconId,
            placeholderReason: entry.placeholderReason,
            serviceName: entry.serviceName,
            state: "placeholder",
          }
        : {
            awsServiceFamily: entry.awsServiceFamily,
            destinationAssetId: entry.destinationAssetId,
            iconId: entry.iconId,
            mappingType: entry.mappingType,
            serviceName: entry.serviceName,
            sourceMember: entry.sourceMember,
            sourceSha256: entry.sourceSha256,
          },
    ),
    sourcePackage: {
      origin: manifest.source.origin,
      packageLabel: manifest.source.packageLabel,
      packageSha256: manifest.source.packageSha256,
      packageVersion: manifest.source.packageVersion,
    },
  };
}

function assertApprovalRecordReuse(current, candidate) {
  if (current.approval.recordId !== candidate.approval.recordId) {
    return;
  }
  if (
    !same(ownerDecisionProjection(current), ownerDecisionProjection(candidate))
  ) {
    fail(
      "changes to approved source, surfaces, or mappings require a new product-owner approval record.",
    );
  }
}

function mergeCatalogBindings(current, candidate) {
  const catalogsByIdentity = new Map();
  for (const catalog of [...current.catalogs, ...candidate.catalogs]) {
    const identity = `${catalog.id}@${catalog.version}`;
    const existing = catalogsByIdentity.get(identity);
    if (existing !== undefined && existing.digest !== catalog.digest) {
      fail("catalog binding digest changed across promotion.");
    }
    catalogsByIdentity.set(identity, catalog);
  }
  return [...catalogsByIdentity.entries()]
    .sort(([left], [right]) => compareText(left, right))
    .map(([, catalog]) => structuredClone(catalog));
}

function createApprovedManifest(current, candidate) {
  if (!candidate.entries.some((entry) => entry.state === "candidate")) {
    fail("staging contains no candidate assets to promote.");
  }
  const withoutDigest = {
    ...candidate,
    assetSet: { ...candidate.assetSet, digest: ZERO_DIGEST },
    catalogs: mergeCatalogBindings(current, candidate),
    entries: candidate.entries.map((entry) =>
      entry.state === "candidate" ? { ...entry, state: "approved" } : entry,
    ),
  };
  const manifest = {
    ...withoutDigest,
    assetSet: {
      ...withoutDigest.assetSet,
      digest: calculateAssetSetDigest(withoutDigest),
    },
  };
  try {
    validateProviderIconManifest(manifest);
  } catch {
    fail("candidate manifest cannot produce a valid final manifest.");
  }
  return manifest;
}

async function readCandidateAssets(stagingDirectory, candidate) {
  const iconDirectory = path.join(stagingDirectory, "icons");
  const metadata = await lstat(iconDirectory).catch(() => undefined);
  if (
    metadata === undefined ||
    !metadata.isDirectory() ||
    metadata.isSymbolicLink()
  ) {
    fail("staging icons must be a real directory.");
  }

  const candidatesByFile = new Map();
  for (const entry of candidate.entries.filter(
    (candidateEntry) => candidateEntry.state === "candidate",
  )) {
    const aliases = candidatesByFile.get(entry.file) ?? [];
    aliases.push(entry);
    candidatesByFile.set(entry.file, aliases);
  }
  const expectedFiles = new Set(candidatesByFile.keys());
  const directoryEntries = await readdir(iconDirectory, {
    withFileTypes: true,
  });
  directoryEntries.sort((left, right) => compareText(left.name, right.name));
  const actualFiles = new Set();
  for (const entry of directoryEntries) {
    if (entry.isSymbolicLink() || !entry.isFile()) {
      fail(`staging icon is not a regular file: ${entry.name}.`);
    }
    if (!expectedFiles.has(entry.name)) {
      fail(`staging contains orphaned icon file: ${entry.name}.`);
    }
    actualFiles.add(entry.name);
  }

  const assets = new Map();
  const destinationByDigest = new Map();
  for (const file of [...expectedFiles].sort(compareText)) {
    if (!actualFiles.has(file)) {
      fail(`staging asset is missing: ${file}.`);
    }
    if (
      path.basename(file) !== file ||
      path.extname(file).toLowerCase() !== ".svg"
    ) {
      fail(`staging asset path is unsafe: ${file}.`);
    }
    const aliases = candidatesByFile.get(file);
    const bytes = await readRegularFile(
      path.join(iconDirectory, file),
      MAX_PROVIDER_SVG_BYTES,
      `staging asset ${file}`,
    );
    let normalized;
    try {
      normalized = validateAndNormalizeSvg(bytes);
    } catch {
      fail(`staging asset is not a valid safe SVG: ${file}.`);
    }
    if (!normalized.bytes.equals(bytes)) {
      fail(`staging asset is not canonical normalized SVG: ${file}.`);
    }
    const digest = sha256(bytes);
    for (const entry of aliases) {
      if (
        entry.automatedSecurityResult !== "passed" ||
        digest !== entry.normalizedSha256 ||
        bytes.byteLength !== entry.normalizedBytes ||
        normalized.viewBox !== entry.viewBox
      ) {
        fail(`staging asset integrity does not match the manifest: ${file}.`);
      }
    }
    const destinationAssetId = aliases[0].destinationAssetId;
    const priorDestination = destinationByDigest.get(digest);
    if (
      priorDestination !== undefined &&
      priorDestination !== destinationAssetId
    ) {
      fail(
        `identical normalized bytes use multiple destination assets: ${file}.`,
      );
    }
    destinationByDigest.set(digest, destinationAssetId);
    assets.set(file, bytes);
  }
  return assets;
}

async function assertNoPromotionRecoveryArtifacts(target) {
  const directory = path.dirname(target);
  await mkdir(directory, { recursive: true });
  const prefix = `${path.basename(target)}.cloudmarkup-promotion-`;
  const entries = await readdir(directory, { withFileTypes: true });
  if (
    entries.some(
      (entry) =>
        entry.name.startsWith(prefix) &&
        (entry.name.endsWith(".tmp") || entry.name.endsWith(".backup")),
    )
  ) {
    fail("a stale promotion temporary or backup path blocks the update.");
  }
}

async function prepareReplacement(target, bytes, kind) {
  const suffix = `.cloudmarkup-promotion-${process.pid}`;
  const temporary = `${target}${suffix}.tmp`;
  const backup = `${target}${suffix}.backup`;
  await assertNoPromotionRecoveryArtifacts(target);
  try {
    if (kind === "directory") {
      await mkdir(temporary);
      for (const [file, fileBytes] of bytes) {
        await writeFile(path.join(temporary, file), fileBytes, { flag: "wx" });
      }
    } else {
      await writeFile(temporary, bytes, { flag: "wx" });
    }
  } catch (error) {
    await rm(temporary, {
      force: true,
      recursive: kind === "directory",
    }).catch(() => undefined);
    throw error;
  }
  return { backup, kind, target, temporary };
}

async function replaceWithRollback(replacements) {
  const prepared = [];
  try {
    for (const replacement of replacements) {
      await assertNoPromotionRecoveryArtifacts(replacement.target);
    }
    for (const replacement of replacements) {
      prepared.push(
        await prepareReplacement(
          replacement.target,
          replacement.bytes,
          replacement.kind,
        ),
      );
    }
    for (const item of prepared) {
      const existing = await lstat(item.target).catch(() => undefined);
      if (existing !== undefined) {
        if (
          existing.isSymbolicLink() ||
          (item.kind === "directory" && !existing.isDirectory()) ||
          (item.kind === "file" && !existing.isFile())
        ) {
          fail("a promotion destination has an unexpected type.");
        }
        await rename(item.target, item.backup);
        item.hasBackup = true;
      }
      await rename(item.temporary, item.target);
      item.hasReplacement = true;
    }
  } catch (error) {
    for (const item of [...prepared].reverse()) {
      if (item.hasReplacement === true) {
        await rm(item.target, {
          force: true,
          recursive: item.kind === "directory",
        }).catch(() => undefined);
      }
      if (item.hasBackup === true) {
        await rename(item.backup, item.target).catch(() => undefined);
      }
      await rm(item.temporary, {
        force: true,
        recursive: item.kind === "directory",
      }).catch(() => undefined);
    }
    throw error;
  }
  for (const item of prepared) {
    if (item.hasBackup === true) {
      await rm(item.backup, {
        force: true,
        recursive: item.kind === "directory",
      });
    }
  }
}

export async function promoteReviewedProviderIcons({
  assetRoot,
  catalog,
  registrationFile,
  repositoryRoot,
  stagingDirectory,
  write = false,
}) {
  await assertExternalStaging(repositoryRoot, stagingDirectory);
  const sourceReviewFile = path.join(assetRoot, "SOURCE_REVIEW.md");
  const targets = [
    path.join(assetRoot, "icons"),
    path.join(assetRoot, "provider-icons.manifest.json"),
    sourceReviewFile,
    registrationFile,
  ];
  await assertSafeRepositoryTargets(repositoryRoot, targets);

  const currentBytes = await readRegularFile(
    path.join(assetRoot, "provider-icons.manifest.json"),
    MAX_MANIFEST_BYTES,
    "current manifest",
  );
  let currentManifest;
  try {
    const currentText = decodeUtf8(currentBytes, "current manifest");
    currentManifest = JSON.parse(currentText);
    if (currentText !== canonicalJson(currentManifest)) {
      fail("current manifest must use canonical JSON serialization.");
    }
  } catch (error) {
    if (
      error instanceof TypeError &&
      error.message.startsWith("Provider icon promotion rejected:")
    ) {
      throw error;
    }
    fail("current manifest is invalid JSON.");
  }
  validateCurrentManifest(currentManifest);

  const candidateBytes = await readRegularFile(
    path.join(stagingDirectory, "provider-icons.manifest.json"),
    MAX_MANIFEST_BYTES,
    "candidate manifest",
  );
  const candidateText = decodeUtf8(candidateBytes, "candidate manifest");
  let candidate;
  try {
    candidate = JSON.parse(candidateText);
    validateProviderIconStagingManifest(candidate);
    if (candidateText !== canonicalJson(candidate)) {
      fail("candidate manifest must use canonical JSON serialization.");
    }
  } catch (error) {
    if (
      error instanceof TypeError &&
      error.message.startsWith("Provider icon promotion rejected:")
    ) {
      throw error;
    }
    fail("candidate manifest must be a valid v2 staging manifest.");
  }
  assertCatalogBinding(candidate, catalog);
  assertApprovalRecordReuse(currentManifest, candidate);

  const sourceReviewBytes = await readRegularFile(
    sourceReviewFile,
    MAX_SOURCE_REVIEW_BYTES,
    "checked SOURCE_REVIEW.md",
  );
  try {
    validateProviderIconSourceReview(
      decodeUtf8(sourceReviewBytes, "checked SOURCE_REVIEW.md"),
      candidate,
    );
  } catch {
    fail(
      "checked SOURCE_REVIEW.md does not exactly bind the staged source and owner approval.",
    );
  }

  const manifest = createApprovedManifest(currentManifest, candidate);
  assertVersionProgression(currentManifest, manifest);
  assertCatalogBinding(manifest, catalog);
  const assets = await readCandidateAssets(stagingDirectory, candidate);
  const registrationBytes = Buffer.from(
    generateWebAssetModule(manifest),
    "utf8",
  );
  if (write) {
    await replaceWithRollback([
      {
        bytes: assets,
        kind: "directory",
        target: path.join(assetRoot, "icons"),
      },
      {
        bytes: Buffer.from(canonicalJson(manifest), "utf8"),
        kind: "file",
        target: path.join(assetRoot, "provider-icons.manifest.json"),
      },
      { bytes: registrationBytes, kind: "file", target: registrationFile },
    ]);
  }

  return Object.freeze({
    approvedIconIds: Object.freeze(
      manifest.entries
        .filter((entry) => entry.state === "approved")
        .map((entry) => entry.iconId)
        .sort(compareText),
    ),
    assetSetDigest: manifest.assetSet.digest,
    placeholderIconIds: Object.freeze(
      manifest.entries
        .filter((entry) => entry.state === "placeholder")
        .map((entry) => entry.iconId)
        .sort(compareText),
    ),
    promotedAssetBytes: [...assets.values()].reduce(
      (total, bytes) => total + bytes.byteLength,
      0,
    ),
    promotedAssetCount: assets.size,
  });
}
