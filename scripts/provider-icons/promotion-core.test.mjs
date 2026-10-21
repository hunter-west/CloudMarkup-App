import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { canonicalJson, sha256 } from "./canonical-json.mjs";
import { importProviderIcons } from "./import-core.mjs";
import { promoteReviewedProviderIcons } from "./promotion-core.mjs";
import { generateProviderIconSourceReview } from "./source-review.mjs";
import {
  createPlaceholderManifest,
  createTestMapping,
  safeSvg,
  testCatalog,
  testImportMetadata,
  withCalculatedAssetSetDigest,
} from "./test-helpers.mjs";

async function temporaryDirectory() {
  return mkdtemp(path.join(tmpdir(), "cloudmarkup-icon-promotion-"));
}

async function prepareCandidate(root, mappings = [createTestMapping()]) {
  const sourceDirectory = path.join(root, "source");
  const stagingDirectory = path.join(root, "staging");
  await mkdir(sourceDirectory);
  await writeFile(path.join(sourceDirectory, "compute.svg"), safeSvg);
  const imported = await importProviderIcons({
    catalog: testCatalog,
    destinationDirectory: path.join(stagingDirectory, "icons"),
    manifestFile: path.join(stagingDirectory, "provider-icons.manifest.json"),
    mapping: { contractVersion: 2, mappings },
    metadata: testImportMetadata,
    registrationFile: path.join(stagingDirectory, "aws-assets.generated.ts"),
    sourceDirectory,
    write: true,
  });
  return { candidate: imported.manifest, stagingDirectory };
}

function currentManifestFor(candidate, version = "0.0.0-placeholder.1") {
  const placeholder = createPlaceholderManifest();
  return withCalculatedAssetSetDigest({
    ...placeholder,
    approval: {
      ...placeholder.approval,
      recordId: "CM-TEST-PROVIDER-ICONS-PRIOR",
    },
    assetSet: {
      ...placeholder.assetSet,
      id: candidate.assetSet.id,
      providerId: candidate.assetSet.providerId,
      version,
    },
  });
}

function finalManifestFor(candidate) {
  return withCalculatedAssetSetDigest({
    ...candidate,
    entries: candidate.entries.map((entry) =>
      entry.state === "candidate" ? { ...entry, state: "approved" } : entry,
    ),
  });
}

function withLegacyAssetSetDigest(manifest) {
  const digest = sha256(
    canonicalJson({
      ...manifest,
      assetSet: {
        compatibilityNotes: manifest.assetSet.compatibilityNotes,
        id: manifest.assetSet.id,
        providerId: manifest.assetSet.providerId,
        version: manifest.assetSet.version,
        withdrawalNotes: manifest.assetSet.withdrawalNotes,
      },
    }),
  );
  return {
    ...manifest,
    assetSet: { ...manifest.assetSet, digest },
  };
}

function legacyPlaceholderCurrent(candidate, services = testCatalog.services) {
  const manifest = {
    assetSet: {
      compatibilityNotes: null,
      digest:
        "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      id: candidate.assetSet.id,
      providerId: candidate.assetSet.providerId,
      version: "0.0.0-placeholder.4",
      withdrawalNotes: null,
    },
    catalogs: structuredClone(candidate.catalogs),
    contractVersion: 1,
    entries: services.map((service) => ({
      admittedBytes: null,
      admittedSha256: null,
      approvalState: "pending",
      fallbackId: "cloudmarkup.provider-icons.neutral-placeholder",
      file: null,
      iconId: service.iconId,
      mediaType: null,
      permittedSurfaces: [],
      sourceBytes: null,
      sourceMember: null,
      sourceSha256: null,
      state: "pending-approval",
      transformationSteps: [],
      usageNoteReference: null,
      viewBox: null,
    })),
    kind: "cloudmarkup.provider-icon-asset-set",
    legal: {
      attributionReference: null,
      licenseReference: null,
      trademarkReference: null,
      usageGuidanceReference: null,
    },
    reviews: Object.fromEntries(
      ["accessibility", "brand", "legalTrademark", "product", "security"].map(
        (area) => [area, { reference: null, status: "pending" }],
      ),
    ),
    source: {
      canonicalReference: null,
      importedAt: null,
      name: null,
      releaseIdentifier: null,
      selectedSourceSha256: null,
      sha256: null,
      sourcePackage: null,
      sourcePackageVersion: null,
      sourcePathCategory: "not-supplied",
      status: "not-supplied",
    },
    transformation: {
      steps: [
        "remove-unused-root-xlink-namespace-v1",
        "validate-svg-v2",
        "normalize-svg-text-v1",
        "verify-selected-source-v1",
      ],
      tool: "cloudmarkup-provider-icon-import",
      version: "1.3.0",
    },
  };
  return withLegacyAssetSetDigest(manifest);
}

async function prepareRepository(root, candidate, current) {
  const repositoryRoot = path.join(root, "repository");
  const assetRoot = path.join(
    repositoryRoot,
    "packages",
    "provider-aws",
    "assets",
  );
  const registrationFile = path.join(
    repositoryRoot,
    "apps",
    "web",
    "src",
    "provider-icons",
    "aws-assets.generated.ts",
  );
  await mkdir(assetRoot, { recursive: true });
  await mkdir(path.dirname(registrationFile), { recursive: true });
  await writeFile(
    path.join(assetRoot, "provider-icons.manifest.json"),
    canonicalJson(current ?? currentManifestFor(candidate)),
  );
  await writeFile(
    path.join(assetRoot, "SOURCE_REVIEW.md"),
    generateProviderIconSourceReview(candidate),
  );
  return { assetRoot, registrationFile, repositoryRoot };
}

function options(repository, stagingDirectory) {
  return {
    ...repository,
    catalog: testCatalog,
    stagingDirectory,
  };
}

async function writeCandidate(stagingDirectory, candidate) {
  await writeFile(
    path.join(stagingDirectory, "provider-icons.manifest.json"),
    canonicalJson(candidate),
  );
}

test("promotion changes candidate to approved without a manual digest input", async () => {
  const root = await temporaryDirectory();
  try {
    const { candidate, stagingDirectory } = await prepareCandidate(root);
    const repository = await prepareRepository(root, candidate);
    const expected = finalManifestFor(candidate);
    const result = await promoteReviewedProviderIcons({
      ...options(repository, stagingDirectory),
      write: true,
    });

    assert.deepEqual(result.approvedIconIds, ["example.icons.compute"]);
    assert.deepEqual(result.placeholderIconIds, ["example.icons.database"]);
    assert.equal(result.assetSetDigest, expected.assetSet.digest);
    assert.equal(result.promotedAssetCount, 1);
    assert.equal(
      await readFile(
        path.join(repository.assetRoot, "icons", "compute.svg"),
        "utf8",
      ),
      safeSvg,
    );
    assert.equal(
      await readFile(
        path.join(repository.assetRoot, "provider-icons.manifest.json"),
        "utf8",
      ),
      canonicalJson(expected),
    );
    assert.match(
      await readFile(repository.registrationFile, "utf8"),
      /assets\/icons\/compute\.svg/u,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("promotion preserves checked historical catalog bindings", async () => {
  const root = await temporaryDirectory();
  try {
    const { candidate, stagingDirectory } = await prepareCandidate(root);
    const historicalCatalog = {
      digest:
        "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      id: testCatalog.catalogId,
      version: "0.9.0",
    };
    const current = withCalculatedAssetSetDigest({
      ...currentManifestFor(candidate),
      catalogs: [historicalCatalog, ...candidate.catalogs].sort((left, right) =>
        `${left.id}@${left.version}`.localeCompare(
          `${right.id}@${right.version}`,
        ),
      ),
    });
    const repository = await prepareRepository(root, candidate, current);
    await promoteReviewedProviderIcons({
      ...options(repository, stagingDirectory),
      write: true,
    });

    const promoted = JSON.parse(
      await readFile(
        path.join(repository.assetRoot, "provider-icons.manifest.json"),
        "utf8",
      ),
    );
    assert.deepEqual(promoted.catalogs, current.catalogs);
    assert.deepEqual(promoted.entries, finalManifestFor(candidate).entries);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("promotion rejects changed digests for an existing catalog identity", async () => {
  const root = await temporaryDirectory();
  try {
    const { candidate, stagingDirectory } = await prepareCandidate(root);
    const current = withCalculatedAssetSetDigest({
      ...currentManifestFor(candidate),
      catalogs: candidate.catalogs.map((catalog) => ({
        ...catalog,
        digest:
          "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
      })),
    });
    const repository = await prepareRepository(root, candidate, current);

    await assert.rejects(
      promoteReviewedProviderIcons(options(repository, stagingDirectory)),
      /catalog binding digest changed across promotion/u,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("promotion reads a shared staged alias once and promotes one canonical file", async () => {
  const root = await temporaryDirectory();
  try {
    const aliasMappings = [
      createTestMapping(),
      createTestMapping({
        iconId: "example.icons.database",
        mappingType: "service-family",
      }),
    ];
    const { candidate, stagingDirectory } = await prepareCandidate(
      root,
      aliasMappings,
    );
    const repository = await prepareRepository(root, candidate);
    const result = await promoteReviewedProviderIcons({
      ...options(repository, stagingDirectory),
      write: true,
    });
    assert.deepEqual(result.approvedIconIds, [
      "example.icons.compute",
      "example.icons.database",
    ]);
    assert.equal(result.promotedAssetCount, 1);
    assert.deepEqual(
      await readFile(path.join(repository.assetRoot, "icons")).catch(
        () => undefined,
      ),
      undefined,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("promotion rejects noncanonical and security-invalid staged SVG bytes", async () => {
  const root = await temporaryDirectory();
  try {
    const { candidate, stagingDirectory } = await prepareCandidate(root);
    const repository = await prepareRepository(root, candidate);
    const entry = candidate.entries.find((item) => item.state === "candidate");
    for (const [bytes, expected] of [
      [
        Buffer.from(safeSvg.replace("<path", "<!--review edit-->\n<path")),
        /not canonical normalized SVG/u,
      ],
      [
        Buffer.from(
          safeSvg.replace(
            " viewBox=",
            ' xmlns:xlink="http://www.w3.org/1999/xlink" viewBox=',
          ),
        ),
        /not a valid safe SVG/u,
      ],
    ]) {
      const changed = structuredClone(candidate);
      const changedEntry = changed.entries.find(
        (item) => item.iconId === entry.iconId,
      );
      changedEntry.normalizedBytes = bytes.byteLength;
      changedEntry.normalizedSha256 = sha256(bytes);
      const withDigest = withCalculatedAssetSetDigest(changed);
      await writeCandidate(stagingDirectory, withDigest);
      await writeFile(path.join(stagingDirectory, "icons", entry.file), bytes);
      await assert.rejects(
        promoteReviewedProviderIcons(options(repository, stagingDirectory)),
        expected,
      );
    }
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("promotion rejects reused owner-record drift and invalid checked source evidence", async () => {
  const root = await temporaryDirectory();
  try {
    const { candidate, stagingDirectory } = await prepareCandidate(root);
    const current = withCalculatedAssetSetDigest({
      ...finalManifestFor(candidate),
      assetSet: {
        ...candidate.assetSet,
        version: "0.9.0",
      },
    });
    const repository = await prepareRepository(root, candidate, current);
    const changedSource = {
      ...candidate,
      source: { ...candidate.source, packageVersion: "different" },
    };
    const changedApproval = {
      ...candidate,
      approval: {
        ...candidate.approval,
        reviewerRelationship: "Different provider relationship",
      },
    };
    const changedMapping = structuredClone(candidate);
    changedMapping.entries.find(
      (entry) => entry.state === "candidate",
    ).awsServiceFamily = "Different service family";
    for (const changed of [changedSource, changedApproval, changedMapping]) {
      await writeCandidate(
        stagingDirectory,
        withCalculatedAssetSetDigest(changed),
      );
      await assert.rejects(
        promoteReviewedProviderIcons(options(repository, stagingDirectory)),
        /require a new product-owner approval record/u,
      );
    }
    await writeCandidate(stagingDirectory, candidate);
    const sourceReviewFile = path.join(
      repository.assetRoot,
      "SOURCE_REVIEW.md",
    );
    await writeFile(
      sourceReviewFile,
      generateProviderIconSourceReview({
        ...candidate,
        source: { ...candidate.source, packageVersion: "different" },
      }),
    );
    await assert.rejects(
      promoteReviewedProviderIcons(options(repository, stagingDirectory)),
      /does not exactly bind/u,
    );
    await rm(sourceReviewFile);
    await assert.rejects(
      promoteReviewedProviderIcons(options(repository, stagingDirectory)),
      /must be a regular, non-symlink file/u,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("promotion rejects staging encoding, orphan, failed security, and v1 drift", async () => {
  const root = await temporaryDirectory();
  try {
    const { candidate, stagingDirectory } = await prepareCandidate(root);
    const repository = await prepareRepository(root, candidate);
    const manifestFile = path.join(
      stagingDirectory,
      "provider-icons.manifest.json",
    );
    await writeFile(manifestFile, Buffer.from([0xff]));
    await assert.rejects(
      promoteReviewedProviderIcons(options(repository, stagingDirectory)),
      /candidate manifest must be valid UTF-8/u,
    );

    await writeFile(manifestFile, JSON.stringify(candidate));
    await assert.rejects(
      promoteReviewedProviderIcons(options(repository, stagingDirectory)),
      /canonical JSON serialization/u,
    );

    const failed = structuredClone(candidate);
    failed.entries.find(
      (entry) => entry.state === "candidate",
    ).automatedSecurityResult = "failed";
    await writeCandidate(
      stagingDirectory,
      withCalculatedAssetSetDigest(failed),
    );
    await assert.rejects(
      promoteReviewedProviderIcons(options(repository, stagingDirectory)),
      /valid v2 staging manifest/u,
    );

    await writeCandidate(stagingDirectory, candidate);
    await writeFile(path.join(stagingDirectory, "icons", "stale.svg"), safeSvg);
    await assert.rejects(
      promoteReviewedProviderIcons(options(repository, stagingDirectory)),
      /orphaned icon file/u,
    );
    await rm(path.join(stagingDirectory, "icons", "stale.svg"));

    await writeCandidate(stagingDirectory, legacyPlaceholderCurrent(candidate));
    await assert.rejects(
      promoteReviewedProviderIcons(options(repository, stagingDirectory)),
      /valid v2 staging manifest/u,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("promotion rejects a contract-v1 current placeholder manifest", async () => {
  const root = await temporaryDirectory();
  try {
    const { candidate, stagingDirectory } = await prepareCandidate(root);
    const legacy = legacyPlaceholderCurrent(candidate);
    const repository = await prepareRepository(root, candidate, legacy);
    await assert.rejects(
      promoteReviewedProviderIcons(options(repository, stagingDirectory)),
      /current manifest is invalid/u,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("promotion rejects the exact CloudMarkup AWS v1 placeholder digest", async () => {
  const root = await temporaryDirectory();
  try {
    const { candidate, stagingDirectory } = await prepareCandidate(root);
    const services = [
      "aws.cloudmarkup.icons.apigateway",
      "aws.cloudmarkup.icons.cloudwatch-alarm",
      "aws.cloudmarkup.icons.cloudwatch-logs",
      "aws.cloudmarkup.icons.cognito",
      "aws.cloudmarkup.icons.cognito-app-client",
      "aws.cloudmarkup.icons.dynamodb",
      "aws.cloudmarkup.icons.iam-policy",
      "aws.cloudmarkup.icons.iam-role",
      "aws.cloudmarkup.icons.lambda",
    ].map((iconId) => ({ iconId, serviceName: iconId }));
    const catalog = {
      catalogDigest:
        "sha256:7a4549dfcadb0c9208572a9d97a7a5417e3652faeb912096b3525b67032978a4",
      catalogId: "aws.cloudmarkup.notes-api-catalog",
      catalogVersion: "0.5.0",
      providerId: "aws.cloudmarkup",
      services,
    };
    const legacy = legacyPlaceholderCurrent(
      {
        assetSet: {
          id: "aws.cloudmarkup.provider-icons",
          providerId: catalog.providerId,
        },
        catalogs: [
          {
            digest: catalog.catalogDigest,
            id: catalog.catalogId,
            version: catalog.catalogVersion,
          },
        ],
      },
      services,
    );
    assert.equal(
      legacy.assetSet.digest,
      "sha256:e4758e276ca16169059517e2aaf13148a20336905a98a55eaf4c17cb862cd7c2",
    );

    const repository = await prepareRepository(root, candidate, legacy);
    await assert.rejects(
      promoteReviewedProviderIcons({
        ...options(repository, stagingDirectory),
        catalog,
      }),
      /current manifest is invalid/u,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
test("promotion rejects immutable versions and precise large-version downgrades", async () => {
  const root = await temporaryDirectory();

  try {
    const { candidate, stagingDirectory } = await prepareCandidate(root);
    const immutableCurrent = currentManifestFor(
      candidate,
      candidate.assetSet.version,
    );
    const repository = await prepareRepository(
      root,
      candidate,
      immutableCurrent,
    );
    await assert.rejects(
      promoteReviewedProviderIcons(options(repository, stagingDirectory)),
      /existing asset-set version is immutable/u,
    );

    const lowerCandidate = withCalculatedAssetSetDigest({
      ...candidate,
      assetSet: { ...candidate.assetSet, version: "9007199254740992.1.0" },
    });
    await writeCandidate(stagingDirectory, lowerCandidate);
    await writeFile(
      path.join(repository.assetRoot, "SOURCE_REVIEW.md"),
      generateProviderIconSourceReview(lowerCandidate),
    );
    await writeFile(
      path.join(repository.assetRoot, "provider-icons.manifest.json"),
      canonicalJson(currentManifestFor(lowerCandidate, "9007199254740993.0.0")),
    );
    await assert.rejects(
      promoteReviewedProviderIcons(options(repository, stagingDirectory)),
      /intentional version increase/u,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("promotion blocks recovery artifacts and rolls back a partial replacement", async () => {
  const root = await temporaryDirectory();
  try {
    const { candidate, stagingDirectory } = await prepareCandidate(root);
    const repository = await prepareRepository(root, candidate);
    const manifestFile = path.join(
      repository.assetRoot,
      "provider-icons.manifest.json",
    );
    const originalManifest = await readFile(manifestFile, "utf8");
    await writeFile(
      `${manifestFile}.cloudmarkup-promotion-previous.backup`,
      "recovery evidence",
    );
    await assert.rejects(
      promoteReviewedProviderIcons({
        ...options(repository, stagingDirectory),
        write: true,
      }),
      /stale promotion temporary or backup/u,
    );
    await rm(`${manifestFile}.cloudmarkup-promotion-previous.backup`);

    await mkdir(repository.registrationFile);
    await assert.rejects(
      promoteReviewedProviderIcons({
        ...options(repository, stagingDirectory),
        write: true,
      }),
      /unexpected type/u,
    );
    assert.equal(await readFile(manifestFile, "utf8"), originalManifest);
    assert.equal(
      await readFile(path.join(repository.assetRoot, "icons")).catch(
        () => undefined,
      ),
      undefined,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("promotion rejects a repository destination redirected by a parent link", async (context) => {
  const root = await temporaryDirectory();
  try {
    const { candidate, stagingDirectory } = await prepareCandidate(root);
    const repositoryRoot = path.join(root, "repository");
    const outsideAssets = path.join(root, "outside-assets");
    const assetRoot = path.join(
      repositoryRoot,
      "packages",
      "provider-aws",
      "assets",
    );
    await mkdir(path.dirname(assetRoot), { recursive: true });
    await mkdir(outsideAssets);
    await writeFile(
      path.join(outsideAssets, "provider-icons.manifest.json"),
      canonicalJson(currentManifestFor(candidate)),
    );
    await writeFile(
      path.join(outsideAssets, "SOURCE_REVIEW.md"),
      generateProviderIconSourceReview(candidate),
    );
    try {
      await symlink(
        outsideAssets,
        assetRoot,
        process.platform === "win32" ? "junction" : "dir",
      );
    } catch (error) {
      context.skip(
        `This host cannot create the destination link: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      );
      return;
    }
    await assert.rejects(
      promoteReviewedProviderIcons({
        assetRoot,
        catalog: testCatalog,
        registrationFile: path.join(
          repositoryRoot,
          "apps",
          "web",
          "src",
          "provider-icons",
          "aws-assets.generated.ts",
        ),
        repositoryRoot,
        stagingDirectory,
      }),
      /destination parent must be a real directory/u,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
