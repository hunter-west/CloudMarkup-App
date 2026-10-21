import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { compareText, sha256 } from "./canonical-json.mjs";
import { validateProviderIconManifest } from "./manifest-contract.mjs";
import { collectCanonicalProviderIconAssets } from "./web-registration.mjs";

const DEVELOPMENT_GALLERY_MARKERS = [
  "CloudMarkupDevelopmentGallery",
  "Development visual gallery",
  "development-gallery__",
];

async function listFiles(directory) {
  const metadata = await lstat(directory).catch(() => undefined);
  if (metadata === undefined) {
    throw new TypeError("Production web build directory does not exist.");
  }
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new TypeError("Production web build path must be a real directory.");
  }

  const files = [];
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => compareText(left.name, right.name));
  for (const entry of entries) {
    const child = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new TypeError("Production web build cannot contain symlinks.");
    }
    if (entry.isDirectory()) {
      files.push(...(await listFiles(child)));
    } else if (entry.isFile()) {
      files.push(child);
    }
  }
  return files;
}

function countBufferOccurrences(haystack, needle) {
  if (needle.length === 0) {
    return 0;
  }
  let count = 0;
  let offset = 0;
  while (offset <= haystack.length - needle.length) {
    const match = haystack.indexOf(needle, offset);
    if (match === -1) {
      break;
    }
    count += 1;
    offset = match + needle.length;
  }
  return count;
}

export async function checkProviderIconBundle({
  assetDirectory,
  distDirectory,
  manifest,
}) {
  validateProviderIconManifest(manifest);
  const canonicalAssets = collectCanonicalProviderIconAssets(manifest);
  const issues = [];
  const bundleFiles = await listFiles(distDirectory);
  const bundleBuffers = await Promise.all(
    bundleFiles.map((file) => readFile(file)),
  );
  const searchableBundle = Buffer.concat(bundleBuffers).toString("utf8");

  for (const marker of DEVELOPMENT_GALLERY_MARKERS) {
    if (searchableBundle.includes(marker)) {
      issues.push(
        `Development-only visual gallery marker reached production: ${marker}.`,
      );
    }
  }

  const entriesByFile = new Map(
    canonicalAssets.map((asset) => [asset.file, asset.aliases]),
  );
  const admittedFiles = canonicalAssets.map((asset) => asset.file);
  const assetsByFile = new Map(
    canonicalAssets.map((asset) => [asset.file, asset]),
  );
  const filesByPhysicalDigest = new Map();
  let officialProviderAssetBytes = 0;
  let bundledApprovedProviderAssetCount = 0;
  let bundledApprovedProviderAssetBytes = 0;
  let approvedProductUiAssetCount = 0;
  for (const file of admittedFiles) {
    const bytes = await readFile(path.join(assetDirectory, file));
    officialProviderAssetBytes += bytes.byteLength;
    const asset = assetsByFile.get(file);
    const physicalDigest = sha256(bytes);
    if (physicalDigest !== asset.normalizedSha256) {
      issues.push(`Normalized checksum mismatch for bundled asset ${file}.`);
    }
    if (bytes.byteLength !== asset.normalizedBytes) {
      issues.push(`Normalized byte-size mismatch for bundled asset ${file}.`);
    }
    const filesForDigest =
      filesByPhysicalDigest.get(physicalDigest) ?? new Set();
    filesForDigest.add(file);
    filesByPhysicalDigest.set(physicalDigest, filesForDigest);

    const base64 = Buffer.from(bytes.toString("base64"), "utf8");
    const percentEncoded = Buffer.from(
      encodeURIComponent(bytes.toString("utf8")),
      "utf8",
    );
    const representationCounts = bundleBuffers.reduce(
      (count, bundle) =>
        count +
        countBufferOccurrences(bundle, bytes) +
        countBufferOccurrences(bundle, base64) +
        countBufferOccurrences(bundle, percentEncoded),
      0,
    );
    const approvedForProductUi =
      manifest.approval.approvedSurfaces.includes("product-ui") &&
      entriesByFile
        .get(file)
        ?.every((entry) => entry.automatedSecurityResult === "passed") === true;

    if (!approvedForProductUi && representationCounts > 0) {
      issues.push(
        `Unapproved provider icon reached the production web bundle: ${file}.`,
      );
    } else if (approvedForProductUi && representationCounts === 0) {
      issues.push(
        `Approved provider icon is missing from the web bundle: ${file}.`,
      );
    } else if (approvedForProductUi && representationCounts > 1) {
      issues.push(
        `Admitted provider icon is duplicated in the web bundle: ${file} (${representationCounts} copies).`,
      );
    }
    if (approvedForProductUi) {
      approvedProductUiAssetCount += 1;
      if (representationCounts === 1) {
        bundledApprovedProviderAssetCount += 1;
        bundledApprovedProviderAssetBytes += bytes.byteLength;
      }
    }
  }

  for (const [digest, files] of filesByPhysicalDigest) {
    if (files.size > 1) {
      issues.push(
        `Identical provider icon bytes are duplicated across physical files (${digest}): ${[
          ...files,
        ]
          .sort(compareText)
          .join(", ")}.`,
      );
    }
  }

  return Object.freeze({
    issues: Object.freeze(issues.sort()),
    stats: Object.freeze({
      admittedProviderAssetCount: admittedFiles.length,
      approvedProductUiAssetCount,
      bundleFileCount: bundleFiles.length,
      bundledApprovedProviderAssetBytes,
      bundledApprovedProviderAssetCount,
      officialProviderAssetBytes,
    }),
  });
}
