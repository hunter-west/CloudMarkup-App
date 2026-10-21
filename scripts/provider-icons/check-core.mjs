import { lstat, readFile, readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { TextDecoder } from "node:util";

import { canonicalJson, compareText, sha256 } from "./canonical-json.mjs";
import { validateProviderIconManifest } from "./manifest-contract.mjs";
import { validateProviderIconSourceReview } from "./source-review.mjs";
import {
  MAX_PROVIDER_SVG_BYTES,
  validateAndNormalizeSvg,
} from "./svg-policy.mjs";
import { generateWebAssetModule } from "./web-registration.mjs";

const ARCHIVE_EXTENSION_PATTERN = /\.(?:7z|bz2|gz|rar|tar|tgz|txz|xz|zip)$/iu;
const RASTER_EXTENSION_PATTERN =
  /\.(?:avif|bmp|gif|ico|jpe?g|png|tiff?|webp)$/iu;
const SOURCE_EXTENSION_PATTERN = /\.(?:css|jsx?|mjs|tsx?)$/iu;

export function parseCanonicalProviderIconManifest(bytes) {
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (text.includes("\0")) {
      throw new TypeError("NUL bytes are forbidden.");
    }
  } catch {
    throw new TypeError(
      "Checked provider icon manifest must be valid UTF-8 text without NUL bytes.",
    );
  }

  let manifest;
  try {
    manifest = JSON.parse(text);
  } catch {
    throw new TypeError("Checked provider icon manifest must be valid JSON.");
  }
  if (text !== canonicalJson(manifest)) {
    throw new TypeError(
      "Checked provider icon manifest must use canonical JSON serialization.",
    );
  }
  return manifest;
}

const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".turbo",
  "coverage",
  "dist",
  "node_modules",
]);
const DIRECT_PROVIDER_ASSET_REFERENCE_PATTERN =
  /(?:@cloudmarkup\/provider-[a-z0-9-]+\/(?:assets|icons)|packages[\\/]provider-[a-z0-9-]+[\\/]assets|provider-[a-z0-9-]+[\\/]assets)/giu;
const REMOTE_PATH_PATTERN = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/iu;
const LOCAL_PATH_PATTERN =
  /(?:file:\/{2}|(?:^|[\s`("'=])(?:[A-Za-z]:[\\/]|\\\\[^\\])|(?:^|[\s`("'=])\/(?:Users|Volumes|home|mnt|private|tmp)(?:\/|$))/imu;

function relativeDisplayPath(repositoryRoot, file) {
  return path.relative(repositoryRoot, file).replaceAll("\\", "/");
}

async function walk(directory, options = {}, depth = 0) {
  const results = [];
  const metadata = await lstat(directory).catch(() => undefined);
  if (metadata === undefined) {
    return results;
  }
  if (metadata.isSymbolicLink()) {
    results.push({ kind: "symlink", path: directory });
    return results;
  }
  if (!metadata.isDirectory()) {
    return [{ kind: "file", path: directory, size: metadata.size }];
  }

  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => compareText(left.name, right.name));
  for (const entry of entries) {
    if (
      entry.isDirectory() &&
      options.ignoreDirectories?.has(entry.name) === true
    ) {
      continue;
    }
    if (options.maxDepth !== undefined && depth >= options.maxDepth) {
      continue;
    }
    const child = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      results.push({ kind: "symlink", path: child });
    } else if (entry.isDirectory()) {
      for (const descendant of await walk(child, options, depth + 1)) {
        results.push(descendant);
      }
    } else if (entry.isFile()) {
      const childMetadata = await lstat(child);
      results.push({ kind: "file", path: child, size: childMetadata.size });
    }
  }
  return results;
}

function validateCatalog(catalog, issues) {
  if (
    catalog === null ||
    typeof catalog !== "object" ||
    !Array.isArray(catalog.services)
  ) {
    issues.push("Catalog descriptor is malformed.");
    return [];
  }
  const services = [];
  const seen = new Set();
  for (const service of catalog.services) {
    if (
      service === null ||
      typeof service !== "object" ||
      typeof service.iconId !== "string" ||
      typeof service.serviceName !== "string" ||
      service.serviceName.trim() === ""
    ) {
      issues.push("Catalog service descriptor is malformed.");
      continue;
    }
    if (seen.has(service.iconId)) {
      issues.push(`Catalog repeats icon ID ${service.iconId}.`);
      continue;
    }
    seen.add(service.iconId);
    services.push({
      iconId: service.iconId,
      serviceName: service.serviceName,
    });
  }
  return services.sort((left, right) => compareText(left.iconId, right.iconId));
}

function checkCatalogConsistency(manifest, catalog, services, issues) {
  const manifestById = new Map(
    manifest.entries.map((entry) => [entry.iconId, entry]),
  );
  const catalogById = new Map(
    services.map((service) => [service.iconId, service]),
  );
  for (const service of services) {
    const entry = manifestById.get(service.iconId);
    if (entry === undefined) {
      issues.push(
        `Catalog icon ID is missing from the manifest: ${service.iconId}.`,
      );
    } else if (entry.serviceName !== service.serviceName) {
      issues.push(
        `Manifest serviceName does not match the catalog for ${service.iconId}.`,
      );
    }
  }
  for (const iconId of manifestById.keys()) {
    if (!catalogById.has(iconId)) {
      issues.push(`Manifest contains orphaned icon ID: ${iconId}.`);
    }
  }
  if (manifest.assetSet.providerId !== catalog.providerId) {
    issues.push("Manifest provider ID does not match the catalog.");
  }
  if (
    !manifest.catalogs.some(
      (entry) =>
        entry.id === catalog.catalogId &&
        entry.version === catalog.catalogVersion &&
        entry.digest === catalog.catalogDigest,
    )
  ) {
    issues.push("Manifest does not pin the exact current catalog identity.");
  }
}

function emptyAssetStats() {
  return {
    admittedFileCount: 0,
    largestAssetBytes: 0,
    totalAssetBytes: 0,
  };
}

async function checkPhysicalAssets({
  assetDirectory,
  manifest,
  repositoryRoot,
  issues,
}) {
  const directoryMetadata = await lstat(assetDirectory).catch(() => undefined);
  if (directoryMetadata?.isSymbolicLink() === true) {
    issues.push(
      `Provider asset path is a symbolic link: ${relativeDisplayPath(
        repositoryRoot,
        assetDirectory,
      )}.`,
    );
    return emptyAssetStats();
  }
  if (directoryMetadata !== undefined && !directoryMetadata.isDirectory()) {
    issues.push(
      `Provider asset path is not a directory: ${relativeDisplayPath(
        repositoryRoot,
        assetDirectory,
      )}.`,
    );
    return emptyAssetStats();
  }

  const records = await walk(assetDirectory);
  const assetFiles = records.filter((record) => record.kind === "file");
  for (const record of records.filter((item) => item.kind === "symlink")) {
    issues.push(
      `Provider asset path is a symbolic link: ${relativeDisplayPath(
        repositoryRoot,
        record.path,
      )}.`,
    );
  }

  const approvedEntries = manifest.entries.filter(
    (entry) => entry.state === "approved",
  );
  const approvedFiles = new Set(approvedEntries.map((entry) => entry.file));
  for (const record of assetFiles) {
    const relative = relativeDisplayPath(assetDirectory, record.path);
    if (RASTER_EXTENSION_PATTERN.test(relative)) {
      issues.push(`Unexpected raster provider asset: ${relative}.`);
      continue;
    }
    if (ARCHIVE_EXTENSION_PATTERN.test(relative)) {
      issues.push(`Provider archive is forbidden: ${relative}.`);
      continue;
    }
    if (path.extname(relative).toLowerCase() !== ".svg") {
      issues.push(`Unsupported provider asset type: ${relative}.`);
      continue;
    }
    if (relative.includes("/")) {
      issues.push(
        `Provider icon files must use the flat manifest namespace: ${relative}.`,
      );
    }
    if (!approvedFiles.has(relative)) {
      issues.push(`Orphaned or unapproved provider icon file: ${relative}.`);
    }
    if (record.size > MAX_PROVIDER_SVG_BYTES) {
      issues.push(`Oversized provider icon file: ${relative}.`);
    }
  }

  const aliasesByFile = new Map();
  for (const entry of approvedEntries) {
    const aliases = aliasesByFile.get(entry.file) ?? [];
    aliases.push(entry);
    aliasesByFile.set(entry.file, aliases);
  }
  const destinationByPhysicalDigest = new Map();
  for (const [fileName, aliases] of [...aliasesByFile.entries()].sort(
    ([left], [right]) => compareText(left, right),
  )) {
    if (
      REMOTE_PATH_PATTERN.test(fileName) ||
      path.isAbsolute(fileName) ||
      path.basename(fileName) !== fileName ||
      path.extname(fileName).toLowerCase() !== ".svg"
    ) {
      issues.push(`Manifest icon file path is unsafe: ${fileName}.`);
      continue;
    }
    const file = path.join(assetDirectory, fileName);
    const metadata = await lstat(file).catch(() => undefined);
    if (metadata === undefined) {
      issues.push(`Manifest asset is missing: ${fileName}.`);
      continue;
    }
    if (metadata.isSymbolicLink()) {
      issues.push(`Manifest asset is a symbolic link: ${fileName}.`);
      continue;
    }
    if (!metadata.isFile()) {
      issues.push(`Manifest asset is missing: ${fileName}.`);
      continue;
    }
    if (metadata.size > MAX_PROVIDER_SVG_BYTES) {
      const issue = `Oversized provider icon file: ${fileName}.`;
      if (!issues.includes(issue)) {
        issues.push(issue);
      }
      continue;
    }

    const bytes = await readFile(file);
    let normalized;
    try {
      normalized = validateAndNormalizeSvg(bytes);
    } catch (error) {
      issues.push(
        `Invalid SVG ${fileName}: ${
          error instanceof Error ? error.message : "validation failed"
        }`,
      );
      continue;
    }
    if (!normalized.bytes.equals(bytes)) {
      issues.push(
        `Admitted SVG is not canonical normalized output: ${fileName}.`,
      );
    }
    const digest = sha256(bytes);
    for (const entry of aliases) {
      if (entry.automatedSecurityResult !== "passed") {
        issues.push(
          `Automated SVG security result is not passed for ${entry.iconId}.`,
        );
      }
      if (entry.normalizedSha256 !== digest) {
        issues.push(`Normalized checksum mismatch for ${fileName}.`);
      }
      if (entry.normalizedBytes !== bytes.byteLength) {
        issues.push(`Normalized byte-size mismatch for ${fileName}.`);
      }
      if (entry.viewBox !== normalized.viewBox) {
        issues.push(`Recorded viewBox mismatch for ${fileName}.`);
      }
    }
    const destinationAssetId = aliases[0].destinationAssetId;
    const prior = destinationByPhysicalDigest.get(digest);
    if (prior !== undefined && prior !== destinationAssetId) {
      issues.push(
        `Identical icon bytes are duplicated across destination assets (${digest}): ${prior}, ${destinationAssetId}.`,
      );
    }
    destinationByPhysicalDigest.set(digest, destinationAssetId);
  }

  return {
    admittedFileCount: approvedFiles.size,
    largestAssetBytes: assetFiles.reduce(
      (maximum, record) => Math.max(maximum, record.size),
      0,
    ),
    totalAssetBytes: assetFiles.reduce(
      (total, record) => total + record.size,
      0,
    ),
  };
}

/** Git does not report tracked files as ignored, including force-added files.
 * Missing Git or an unreadable index retains the conservative archive rejection. */
function isIgnoredLocalFile(repositoryRoot, relative) {
  const result = spawnSync("git", ["check-ignore", "--quiet", "--", relative], {
    cwd: repositoryRoot,
    shell: false,
    stdio: "ignore",
    timeout: 10_000,
    windowsHide: true,
  });
  return result.status === 0;
}

async function listRelevantCacheRecords(repositoryRoot) {
  const result = spawnSync(
    "git",
    [
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "-z",
      "--",
      ".cache",
    ],
    {
      cwd: repositoryRoot,
      shell: false,
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 10_000,
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true,
    },
  );
  if (result.status !== 0 || result.error !== undefined) {
    return null;
  }

  const records = [];
  for (const relative of result.stdout.toString("utf8").split("\0")) {
    if (relative === "") {
      continue;
    }
    if (!relative.startsWith(".cache/")) {
      return null;
    }
    const file = path.resolve(repositoryRoot, relative);
    const metadata = await lstat(file).catch(() => undefined);
    if (metadata?.isSymbolicLink()) {
      records.push({ kind: "symlink", path: file });
    } else if (metadata?.isFile()) {
      records.push({ kind: "file", path: file, size: metadata.size });
    }
  }
  return records;
}

async function checkRepositoryBoundaries(repositoryRoot, issues) {
  const allowedRegistryAssetReferences = new Set([
    "apps/api/src/provider-icons/aws-diagram-icon-registry.ts",
    "apps/web/src/provider-icons/aws-assets.generated.ts",
    "apps/web/src/provider-icons/aws-icon-registry.ts",
    "packages/provider-aws/src/diagram-icon-registry.test-support.ts",
  ]);
  const cacheRecords = await listRelevantCacheRecords(repositoryRoot);
  const ignoredDirectories =
    cacheRecords === null
      ? IGNORED_DIRECTORIES
      : new Set([...IGNORED_DIRECTORIES, ".cache"]);
  const records = await walk(repositoryRoot, {
    ignoreDirectories: ignoredDirectories,
  });
  if (cacheRecords !== null) {
    for (const record of cacheRecords) {
      records.push(record);
    }
  }
  for (const record of records) {
    const relative = relativeDisplayPath(repositoryRoot, record.path);
    if (
      ARCHIVE_EXTENSION_PATTERN.test(relative) &&
      !isIgnoredLocalFile(repositoryRoot, relative)
    ) {
      issues.push(
        `Provider/source archive must not be committed: ${relative}.`,
      );
    }
    if (record.kind !== "file" || !SOURCE_EXTENSION_PATTERN.test(relative)) {
      continue;
    }
    if (
      allowedRegistryAssetReferences.has(relative) ||
      relative.startsWith("scripts/provider-icons/") ||
      relative === "scripts/check-provider-icons.mjs" ||
      relative === "scripts/import-aws-icons.mjs" ||
      relative === "scripts/promote-aws-icons.mjs"
    ) {
      continue;
    }
    const source = await readFile(record.path, "utf8");
    // Ignored historical checkouts are local evidence, not product source. Git
    // still exposes force-added files here; failed ignore checks reject them.
    if (
      DIRECT_PROVIDER_ASSET_REFERENCE_PATTERN.test(source) &&
      !(
        relative.startsWith(".cache/") &&
        isIgnoredLocalFile(repositoryRoot, relative)
      )
    ) {
      issues.push(
        `Direct provider-asset import outside registry: ${relative}.`,
      );
    }
    DIRECT_PROVIDER_ASSET_REFERENCE_PATTERN.lastIndex = 0;
  }
}

async function checkGeneratedRegistration(registrationFile, manifest, issues) {
  const actual = await readFile(registrationFile, "utf8").catch(
    () => undefined,
  );
  if (actual === undefined) {
    issues.push("Generated web provider-icon registration is missing.");
    return;
  }
  if (actual !== generateWebAssetModule(manifest)) {
    issues.push(
      "Generated web provider-icon registration has drifted from the manifest.",
    );
  }
}

async function checkRequiredDocumentation(assetRoot, manifest, issues) {
  for (const file of ["README.md", "SOURCE_REVIEW.md"]) {
    const bytes = await readFile(path.join(assetRoot, file)).catch(
      () => undefined,
    );
    if (bytes === undefined) {
      issues.push(`Required provider asset documentation is missing: ${file}.`);
      continue;
    }
    let content;
    try {
      content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      if (content.includes("\0")) {
        throw new TypeError("NUL bytes are forbidden.");
      }
    } catch {
      issues.push(
        `Required provider asset documentation must be valid UTF-8 text without NUL bytes: ${file}.`,
      );
      continue;
    }
    if (file !== "SOURCE_REVIEW.md") {
      continue;
    }
    if (LOCAL_PATH_PATTERN.test(content)) {
      issues.push(
        "SOURCE_REVIEW.md must not contain a developer machine path.",
      );
      continue;
    }
    try {
      validateProviderIconSourceReview(content, manifest);
    } catch {
      issues.push(
        "SOURCE_REVIEW.md must exactly match manifest source and product-owner approval evidence.",
      );
    }
  }
}

export async function checkProviderIconAssets({
  assetRoot,
  catalog,
  manifest,
  repositoryRoot,
  registrationFile = path.join(
    repositoryRoot,
    "apps",
    "web",
    "src",
    "provider-icons",
    "aws-assets.generated.ts",
  ),
}) {
  const issues = [];
  const services = validateCatalog(catalog, issues);
  try {
    validateProviderIconManifest(manifest);
  } catch (error) {
    issues.push(
      error instanceof Error ? error.message : "Manifest validation failed.",
    );
    return Object.freeze({
      issues: Object.freeze(issues),
      stats: Object.freeze({
        ...emptyAssetStats(),
        catalogIconCount: services.length,
        placeholderCount: 0,
      }),
    });
  }

  checkCatalogConsistency(manifest, catalog, services, issues);
  const assetStats = await checkPhysicalAssets({
    assetDirectory: path.join(assetRoot, "icons"),
    issues,
    manifest,
    repositoryRoot,
  });
  await checkRepositoryBoundaries(repositoryRoot, issues);
  await checkRequiredDocumentation(assetRoot, manifest, issues);
  await checkGeneratedRegistration(registrationFile, manifest, issues);

  return Object.freeze({
    issues: Object.freeze(issues.sort(compareText)),
    stats: Object.freeze({
      ...assetStats,
      catalogIconCount: services.length,
      placeholderCount: manifest.entries.filter(
        (entry) => entry.state === "placeholder",
      ).length,
    }),
  });
}
