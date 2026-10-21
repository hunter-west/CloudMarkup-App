import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { checkProviderIconBundle } from "./bundle-check-core.mjs";
import { importProviderIcons } from "./import-core.mjs";
import {
  createApprovedEntry,
  createPlaceholderManifest,
  createTestMapping,
  safeSvg,
  testCatalog,
  testImportMetadata,
  withCalculatedAssetSetDigest,
} from "./test-helpers.mjs";

async function temporaryDirectory() {
  return mkdtemp(path.join(tmpdir(), "cloudmarkup-provider-bundle-"));
}

test("placeholder-only production output contains zero official provider asset bytes", async () => {
  const root = await temporaryDirectory();
  try {
    const distDirectory = path.join(root, "dist");
    await mkdir(distDirectory);
    await writeFile(
      path.join(distDirectory, "index.html"),
      "<main>Shell</main>",
    );
    const result = await checkProviderIconBundle({
      assetDirectory: path.join(root, "assets", "icons"),
      distDirectory,
      manifest: createPlaceholderManifest(),
    });

    assert.deepEqual(result.issues, []);
    assert.equal(result.stats.admittedProviderAssetCount, 0);
    assert.equal(result.stats.bundledApprovedProviderAssetCount, 0);
    assert.equal(result.stats.officialProviderAssetBytes, 0);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("production output rejects development-gallery content", async () => {
  const root = await temporaryDirectory();
  try {
    const distDirectory = path.join(root, "dist");
    await mkdir(distDirectory);
    await writeFile(
      path.join(distDirectory, "app.js"),
      'console.log("Development visual gallery");',
    );
    const result = await checkProviderIconBundle({
      assetDirectory: path.join(root, "assets", "icons"),
      distDirectory,
      manifest: createPlaceholderManifest(),
    });
    assert(
      result.issues.some((issue) =>
        issue.includes("Development-only visual gallery marker"),
      ),
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("production output requires exactly one copy of each approved product icon", async () => {
  const root = await temporaryDirectory();
  try {
    const sourceDirectory = path.join(root, "source");
    const assetDirectory = path.join(root, "assets", "icons");
    const distDirectory = path.join(root, "dist");
    await mkdir(sourceDirectory);
    await mkdir(assetDirectory, { recursive: true });
    await mkdir(distDirectory);
    await writeFile(path.join(sourceDirectory, "compute.svg"), safeSvg);
    await writeFile(path.join(assetDirectory, "compute.svg"), safeSvg);
    const imported = await importProviderIcons({
      catalog: testCatalog,
      destinationDirectory: assetDirectory,
      manifestFile: path.join(root, "assets", "manifest.json"),
      mapping: {
        contractVersion: 2,
        mappings: [createTestMapping()],
      },
      metadata: testImportMetadata,
      registrationFile: path.join(root, "registration.ts"),
      sourceDirectory,
    });
    await writeFile(path.join(distDirectory, "app.js"), safeSvg);
    await assert.rejects(
      checkProviderIconBundle({
        assetDirectory,
        distDirectory,
        manifest: imported.manifest,
      }),
      /entries\[0\]\.state is invalid/u,
    );

    const approvedManifest = withCalculatedAssetSetDigest({
      ...imported.manifest,
      entries: imported.manifest.entries.map((entry) =>
        entry.state === "candidate" ? { ...entry, state: "approved" } : entry,
      ),
    });

    await writeFile(path.join(distDirectory, "app.js"), "<main>Shell</main>");
    const missingResult = await checkProviderIconBundle({
      assetDirectory,
      distDirectory,
      manifest: approvedManifest,
    });
    assert(
      missingResult.issues.some((issue) =>
        issue.includes("Approved provider icon is missing"),
      ),
    );

    await writeFile(path.join(distDirectory, "app.js"), safeSvg);
    const exactOnceResult = await checkProviderIconBundle({
      assetDirectory,
      distDirectory,
      manifest: approvedManifest,
    });
    assert.deepEqual(exactOnceResult.issues, []);
    assert.equal(exactOnceResult.stats.approvedProductUiAssetCount, 1);
    assert.equal(exactOnceResult.stats.bundledApprovedProviderAssetCount, 1);
    assert.equal(
      exactOnceResult.stats.bundledApprovedProviderAssetBytes,
      Buffer.byteLength(safeSvg),
    );

    await writeFile(path.join(distDirectory, "app.js"), `${safeSvg}${safeSvg}`);

    const result = await checkProviderIconBundle({
      assetDirectory,
      distDirectory,
      manifest: approvedManifest,
    });
    assert(
      result.issues.some((issue) =>
        issue.includes("duplicated in the web bundle"),
      ),
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

function cognitoEntry(iconId, serviceName, overrides = {}) {
  return createApprovedEntry({
    awsServiceFamily: "Amazon Cognito",
    destinationAssetId: "aws.architecture.cognito",
    file: "cognito.svg",
    iconId,
    mappingType: "service-family",
    serviceName,
    sourceMember:
      "Architecture-Service-Icons/Arch_Security-Identity-Compliance/48/Arch_Amazon-Cognito_48.svg",
    ...overrides,
  });
}

function approvedAliasManifest(entries) {
  const placeholderManifest = createPlaceholderManifest();
  return withCalculatedAssetSetDigest({
    ...placeholderManifest,
    assetSet: {
      ...placeholderManifest.assetSet,
      version: "1.0.0",
    },
    entries: [...entries].sort((left, right) =>
      left.iconId < right.iconId ? -1 : left.iconId > right.iconId ? 1 : 0,
    ),
  });
}

test("canonical aliases require one physical and one bundled SVG copy", async () => {
  const root = await temporaryDirectory();
  try {
    const assetDirectory = path.join(root, "assets", "icons");
    const distDirectory = path.join(root, "dist");
    await mkdir(assetDirectory, { recursive: true });
    await mkdir(distDirectory);
    await writeFile(path.join(assetDirectory, "cognito.svg"), safeSvg);
    await writeFile(path.join(distDirectory, "app.js"), safeSvg);
    const manifest = approvedAliasManifest([
      cognitoEntry("aws.cloudmarkup.icons.cognito", "Cognito user pool"),
      cognitoEntry(
        "aws.cloudmarkup.icons.cognito-app-client",
        "Cognito app client",
      ),
    ]);

    const exactOnce = await checkProviderIconBundle({
      assetDirectory,
      distDirectory,
      manifest,
    });
    assert.deepEqual(exactOnce.issues, []);
    assert.equal(exactOnce.stats.admittedProviderAssetCount, 1);
    assert.equal(exactOnce.stats.approvedProductUiAssetCount, 1);
    assert.equal(exactOnce.stats.bundledApprovedProviderAssetCount, 1);
    assert.equal(
      exactOnce.stats.bundledApprovedProviderAssetBytes,
      Buffer.byteLength(safeSvg),
    );

    await writeFile(path.join(distDirectory, "app.js"), `${safeSvg}${safeSvg}`);
    const duplicatedBundle = await checkProviderIconBundle({
      assetDirectory,
      distDirectory,
      manifest,
    });
    assert(
      duplicatedBundle.issues.some((issue) =>
        issue.includes("duplicated in the web bundle"),
      ),
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("bundle validation rejects identical physical bytes under different files", async () => {
  const root = await temporaryDirectory();
  try {
    const assetDirectory = path.join(root, "assets", "icons");
    const distDirectory = path.join(root, "dist");
    await mkdir(assetDirectory, { recursive: true });
    await mkdir(distDirectory);
    await writeFile(path.join(assetDirectory, "cognito.svg"), safeSvg);
    await writeFile(path.join(assetDirectory, "cognito-copy.svg"), safeSvg);
    await writeFile(path.join(distDirectory, "app.js"), safeSvg);
    const manifest = approvedAliasManifest([
      cognitoEntry("aws.cloudmarkup.icons.cognito", "Cognito user pool"),
      cognitoEntry(
        "aws.cloudmarkup.icons.cognito-app-client",
        "Cognito app client",
        {
          destinationAssetId: "aws.architecture.cognito-copy",
          file: "cognito-copy.svg",
          normalizedSha256:
            "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
          sourceMember:
            "Architecture-Service-Icons/Arch_Security-Identity-Compliance/64/Arch_Amazon-Cognito_64.svg",
          sourceSha256:
            "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
        },
      ),
    ]);

    const result = await checkProviderIconBundle({
      assetDirectory,
      distDirectory,
      manifest,
    });
    assert(
      result.issues.some((issue) =>
        issue.includes("duplicated across physical files"),
      ),
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
