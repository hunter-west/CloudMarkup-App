import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { canonicalJson, sha256 } from "./canonical-json.mjs";
import {
  checkProviderIconAssets,
  parseCanonicalProviderIconManifest,
} from "./check-core.mjs";
import { generateProviderIconSourceReview } from "./source-review.mjs";
import { MAX_PROVIDER_SVG_BYTES } from "./svg-policy.mjs";
import {
  createApprovedEntry,
  createPlaceholderManifest,
  prepareAssetRoot,
  safeSvg,
  testCatalog,
  withCalculatedAssetSetDigest,
} from "./test-helpers.mjs";

async function temporaryRepository() {
  return mkdtemp(path.join(tmpdir(), "cloudmarkup-provider-check-"));
}

function finalManifest(entries) {
  return withCalculatedAssetSetDigest({
    ...createPlaceholderManifest(),
    assetSet: {
      ...createPlaceholderManifest().assetSet,
      version: "1.0.0",
    },
    entries: [...entries].sort((left, right) =>
      left.iconId.localeCompare(right.iconId),
    ),
  });
}

function approvedManifest() {
  return finalManifest([
    createApprovedEntry(),
    createPlaceholderManifest().entries.find(
      (entry) => entry.iconId === "example.icons.database",
    ),
  ]);
}

async function prepareCheckedRoot(
  repositoryRoot,
  manifest,
  assets = new Map(),
) {
  const prepared = await prepareAssetRoot(repositoryRoot, manifest);
  await writeFile(
    path.join(prepared.assetRoot, "SOURCE_REVIEW.md"),
    generateProviderIconSourceReview(manifest),
  );
  if (assets.size > 0) {
    const iconDirectory = path.join(prepared.assetRoot, "icons");
    await mkdir(iconDirectory, { recursive: true });
    for (const [file, bytes] of assets) {
      await writeFile(path.join(iconDirectory, file), bytes);
    }
  }
  return prepared;
}

async function runCheck(repositoryRoot, manifest, prepared) {
  return checkProviderIconAssets({
    assetRoot: prepared.assetRoot,
    catalog: testCatalog,
    manifest,
    registrationFile: prepared.registrationFile,
    repositoryRoot,
  });
}

test("final placeholder catalog passes without an icons directory", async () => {
  const repositoryRoot = await temporaryRepository();
  try {
    const manifest = createPlaceholderManifest();
    const canonicalManifest = canonicalJson(manifest);
    assert.deepEqual(
      parseCanonicalProviderIconManifest(Buffer.from(canonicalManifest)),
      manifest,
    );
    for (const invalid of [
      Buffer.from(JSON.stringify(manifest)),
      Buffer.from(
        canonicalManifest.replace("{\n", '{\n  "contractVersion": 2,\n'),
      ),
      Buffer.from([0xff]),
      Buffer.concat([Buffer.from(canonicalManifest), Buffer.from([0])]),
    ]) {
      assert.throws(
        () => parseCanonicalProviderIconManifest(invalid),
        /Checked provider icon manifest/u,
      );
    }
    const prepared = await prepareCheckedRoot(repositoryRoot, manifest);
    const result = await runCheck(repositoryRoot, manifest, prepared);
    assert.deepEqual(result.issues, []);
    assert.deepEqual(result.stats, {
      admittedFileCount: 0,
      catalogIconCount: 2,
      largestAssetBytes: 0,
      placeholderCount: 2,
      totalAssetBytes: 0,
    });
  } finally {
    await rm(repositoryRoot, { force: true, recursive: true });
  }
});

test("approved canonical assets and aliases pass with one physical file", async () => {
  const repositoryRoot = await temporaryRepository();
  try {
    const manifest = approvedManifest();
    const prepared = await prepareCheckedRoot(
      repositoryRoot,
      manifest,
      new Map([["compute.svg", safeSvg]]),
    );
    const result = await runCheck(repositoryRoot, manifest, prepared);
    assert.deepEqual(result.issues, []);
    assert.equal(result.stats.admittedFileCount, 1);
    assert.equal(result.stats.placeholderCount, 1);

    const aliasManifest = finalManifest([
      createApprovedEntry(),
      createApprovedEntry({
        iconId: "example.icons.database",
        mappingType: "service-family",
        serviceName: "Example database",
      }),
    ]);
    const aliasPrepared = await prepareCheckedRoot(
      repositoryRoot,
      aliasManifest,
      new Map([["compute.svg", safeSvg]]),
    );
    const aliasResult = await runCheck(
      repositoryRoot,
      aliasManifest,
      aliasPrepared,
    );
    assert.deepEqual(aliasResult.issues, []);
    assert.equal(aliasResult.stats.admittedFileCount, 1);
    assert.equal(aliasResult.stats.placeholderCount, 0);
  } finally {
    await rm(repositoryRoot, { force: true, recursive: true });
  }
});

test("check rejects missing, modified, invalid, and machine-local source evidence", async () => {
  const repositoryRoot = await temporaryRepository();
  try {
    const manifest = createPlaceholderManifest();
    const prepared = await prepareCheckedRoot(repositoryRoot, manifest);
    const sourceReviewFile = path.join(prepared.assetRoot, "SOURCE_REVIEW.md");

    await writeFile(
      sourceReviewFile,
      generateProviderIconSourceReview({
        ...manifest,
        source: { ...manifest.source, packageVersion: "different" },
      }),
    );
    let result = await runCheck(repositoryRoot, manifest, prepared);
    assert(result.issues.some((issue) => issue.includes("must exactly match")));

    await writeFile(sourceReviewFile, Buffer.from([0xff]));
    result = await runCheck(repositoryRoot, manifest, prepared);
    assert(result.issues.some((issue) => issue.includes("valid UTF-8")));

    const machineLocal = withCalculatedAssetSetDigest({
      ...manifest,
      approval: {
        ...manifest.approval,
        reviewerRelationship: String.raw`C:\Users\developer\evidence`,
      },
    });
    const machinePrepared = await prepareCheckedRoot(
      repositoryRoot,
      machineLocal,
    );
    result = await runCheck(repositoryRoot, machineLocal, machinePrepared);
    assert(result.issues.some((issue) => issue.includes("machine path")));

    await rm(sourceReviewFile);
    result = await runCheck(repositoryRoot, manifest, prepared);
    assert(
      result.issues.some((issue) =>
        issue.includes("documentation is missing: SOURCE_REVIEW.md"),
      ),
    );
  } finally {
    await rm(repositoryRoot, { force: true, recursive: true });
  }
});

test("check enforces catalog icon IDs and visible service names", async () => {
  const repositoryRoot = await temporaryRepository();
  try {
    const mismatchedName = createPlaceholderManifest();
    mismatchedName.entries[0].serviceName = "Wrong visible name";
    const namedManifest = withCalculatedAssetSetDigest(mismatchedName);
    let prepared = await prepareCheckedRoot(repositoryRoot, namedManifest);
    let result = await runCheck(repositoryRoot, namedManifest, prepared);
    assert(
      result.issues.some((issue) =>
        issue.includes("serviceName does not match"),
      ),
    );

    const orphanServices = [
      testCatalog.services[0],
      { iconId: "example.icons.orphan", serviceName: "Example orphan" },
    ];
    const orphanManifest = createPlaceholderManifest(orphanServices);
    prepared = await prepareCheckedRoot(repositoryRoot, orphanManifest);
    result = await runCheck(repositoryRoot, orphanManifest, prepared);
    assert(
      result.issues.some((issue) =>
        issue.includes("missing from the manifest: example.icons.database"),
      ),
    );
    assert(
      result.issues.some((issue) =>
        issue.includes("orphaned icon ID: example.icons.orphan"),
      ),
    );
  } finally {
    await rm(repositoryRoot, { force: true, recursive: true });
  }
});

test("check rejects noncanonical and restored namespace SVG bytes", async () => {
  const repositoryRoot = await temporaryRepository();
  try {
    for (const [bytes, expected] of [
      [
        Buffer.from(safeSvg.replace("<path", "<!--review edit-->\n<path")),
        "not canonical normalized output",
      ],
      [
        Buffer.from(
          safeSvg.replace(
            " viewBox=",
            ' xmlns:xlink="http://www.w3.org/1999/xlink" viewBox=',
          ),
        ),
        "namespace-prefixed",
      ],
    ]) {
      const entry = createApprovedEntry({
        normalizedBytes: bytes.byteLength,
        normalizedSha256: sha256(bytes),
      });
      const manifest = finalManifest([
        entry,
        createPlaceholderManifest().entries[1],
      ]);
      const prepared = await prepareCheckedRoot(
        repositoryRoot,
        manifest,
        new Map([["compute.svg", bytes]]),
      );
      const result = await runCheck(repositoryRoot, manifest, prepared);
      assert(result.issues.some((issue) => issue.includes(expected)));
      await rm(path.join(prepared.assetRoot, "icons"), {
        force: true,
        recursive: true,
      });
    }
  } finally {
    await rm(repositoryRoot, { force: true, recursive: true });
  }
});

test("check reports raster, archive, direct import, and registration drift", async () => {
  const repositoryRoot = await temporaryRepository();
  try {
    const manifest = createPlaceholderManifest();
    const prepared = await prepareCheckedRoot(repositoryRoot, manifest);
    await mkdir(path.join(prepared.assetRoot, "icons"));
    await writeFile(
      path.join(prepared.assetRoot, "icons", "unexpected.png"),
      "not png",
    );
    await writeFile(path.join(repositoryRoot, "aws-icons.zip"), "archive");
    await writeFile(path.join(repositoryRoot, "notazip"), "not an archive");
    const featureDirectory = path.join(
      repositoryRoot,
      "apps",
      "web",
      "src",
      "features",
    );
    await mkdir(featureDirectory, { recursive: true });
    await writeFile(
      path.join(featureDirectory, "bad.tsx"),
      'import icon from "@cloudmarkup/provider-aws/assets/icons/bad.svg";\n',
    );
    await writeFile(prepared.registrationFile, "// drift\n");

    const result = await runCheck(repositoryRoot, manifest, prepared);
    for (const expected of [
      "Unexpected raster provider asset",
      "Provider/source archive must not be committed",
      "Direct provider-asset import outside registry",
      "registration has drifted",
    ]) {
      assert(
        result.issues.some((issue) => issue.includes(expected)),
        `expected issue containing: ${expected}`,
      );
    }
    assert.equal(
      result.issues.some((issue) => issue.includes("notazip")),
      false,
    );
  } finally {
    await rm(repositoryRoot, { force: true, recursive: true });
  }
});

test("check ignores local build archives but rejects force-added archives", async () => {
  const repositoryRoot = await temporaryRepository();
  try {
    const git = (...args) =>
      execFileSync("git", args, {
        cwd: repositoryRoot,
        stdio: "ignore",
        windowsHide: true,
      });
    git("init", "--quiet");
    const manifest = createPlaceholderManifest();
    const prepared = await prepareCheckedRoot(repositoryRoot, manifest);
    await writeFile(
      path.join(repositoryRoot, ".gitignore"),
      "test-results/\n.cache/\n",
    );
    for (const directory of ["test-results", ".cache"]) {
      await mkdir(path.join(repositoryRoot, directory));
      await writeFile(
        path.join(repositoryRoot, directory, "trace.zip"),
        "archive",
      );
    }
    let result = await runCheck(repositoryRoot, manifest, prepared);
    assert.equal(
      result.issues.some((issue) =>
        issue.includes("archive must not be committed"),
      ),
      false,
    );
    git("add", "--force", "--", "test-results/trace.zip");
    result = await runCheck(repositoryRoot, manifest, prepared);
    assert(
      result.issues.some((issue) =>
        issue.includes("archive must not be committed: test-results/trace.zip"),
      ),
    );
    assert.equal(
      result.issues.some((issue) =>
        issue.includes("archive must not be committed: .cache/trace.zip"),
      ),
      false,
    );
    git("add", "--force", "--", ".cache/trace.zip");
    result = await runCheck(repositoryRoot, manifest, prepared);
    assert(
      result.issues.some((issue) =>
        issue.includes("archive must not be committed: .cache/trace.zip"),
      ),
    );
  } finally {
    await rm(repositoryRoot, { force: true, recursive: true });
  }
});

test("check rejects invalid final state and duplicate physical destinations", async () => {
  const repositoryRoot = await temporaryRepository();
  try {
    const candidate = approvedManifest();
    candidate.entries[0].state = "candidate";
    const candidateManifest = withCalculatedAssetSetDigest(candidate);
    let prepared = await prepareAssetRoot(repositoryRoot, candidateManifest);
    let result = await runCheck(repositoryRoot, candidateManifest, prepared);
    assert(
      result.issues.some((issue) =>
        issue.includes("entries[0].state is invalid"),
      ),
    );

    const duplicated = finalManifest([
      createApprovedEntry(),
      createApprovedEntry({
        destinationAssetId: "example.provider.assets.database",
        file: "database.svg",
        iconId: "example.icons.database",
        serviceName: "Example database",
        sourceMember: "database.svg",
      }),
    ]);
    prepared = {
      assetRoot: path.join(
        repositoryRoot,
        "packages",
        "provider-aws",
        "assets",
      ),
      registrationFile: path.join(repositoryRoot, "unused-registration.ts"),
    };
    result = await runCheck(repositoryRoot, duplicated, prepared);
    assert(
      result.issues.some((issue) =>
        issue.includes("identify multiple destination assets"),
      ),
    );

    const contradictorySource = finalManifest([
      createApprovedEntry(),
      createApprovedEntry({
        destinationAssetId: "example.provider.assets.database",
        file: "database.svg",
        iconId: "example.icons.database",
        normalizedSha256:
          "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        serviceName: "Example database",
        sourceBytes: Buffer.byteLength(safeSvg) + 1,
        sourceSha256:
          "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
      }),
    ]);
    result = await runCheck(repositoryRoot, contradictorySource, prepared);
    assert(
      result.issues.some((issue) =>
        issue.includes("disagree about selected source member compute.svg"),
      ),
    );
  } finally {
    await rm(repositoryRoot, { force: true, recursive: true });
  }
});

test("check reports but does not parse an oversized approved asset", async () => {
  const repositoryRoot = await temporaryRepository();
  try {
    const manifest = approvedManifest();
    const oversized = Buffer.alloc(MAX_PROVIDER_SVG_BYTES + 1, 0xff);
    const prepared = await prepareCheckedRoot(
      repositoryRoot,
      manifest,
      new Map([["compute.svg", oversized]]),
    );
    const result = await runCheck(repositoryRoot, manifest, prepared);
    assert(
      result.issues.some((issue) =>
        issue.includes("Oversized provider icon file"),
      ),
    );
    assert.equal(
      result.issues.some((issue) => issue.includes("Invalid SVG")),
      false,
    );
  } finally {
    await rm(repositoryRoot, { force: true, recursive: true });
  }
});

test("check rejects orphan runtime bytes and missing approved bytes", async () => {
  const repositoryRoot = await temporaryRepository();
  try {
    const placeholder = createPlaceholderManifest();
    let prepared = await prepareCheckedRoot(
      repositoryRoot,
      placeholder,
      new Map([["compute.svg", safeSvg]]),
    );
    let result = await runCheck(repositoryRoot, placeholder, prepared);
    assert(
      result.issues.some((issue) =>
        issue.includes("Orphaned or unapproved provider icon file"),
      ),
    );

    await rm(path.join(prepared.assetRoot, "icons"), {
      force: true,
      recursive: true,
    });
    const approved = approvedManifest();
    prepared = await prepareCheckedRoot(repositoryRoot, approved);
    result = await runCheck(repositoryRoot, approved, prepared);
    assert(result.issues.some((issue) => issue.includes("asset is missing")));
  } finally {
    await rm(repositoryRoot, { force: true, recursive: true });
  }
});

test("check stops when the provider asset root is not a directory", async () => {
  const repositoryRoot = await temporaryRepository();
  try {
    const manifest = approvedManifest();
    const prepared = await prepareCheckedRoot(repositoryRoot, manifest);
    await writeFile(path.join(prepared.assetRoot, "icons"), "not a directory");
    const result = await runCheck(repositoryRoot, manifest, prepared);
    assert(result.issues.some((issue) => issue.includes("is not a directory")));
    assert.equal(
      result.issues.some((issue) => issue.includes("Invalid SVG")),
      false,
    );
    assert.equal(result.stats.admittedFileCount, 0);
  } finally {
    await rm(repositoryRoot, { force: true, recursive: true });
  }
});

test("check stops when the provider asset root is a symlink", async (context) => {
  const repositoryRoot = await temporaryRepository();
  try {
    const manifest = approvedManifest();
    const prepared = await prepareCheckedRoot(repositoryRoot, manifest);
    const externalDirectory = path.join(repositoryRoot, "external-icons");
    await mkdir(externalDirectory);
    await writeFile(
      path.join(externalDirectory, "compute.svg"),
      "<svg>unsafe target</svg>",
    );
    try {
      await symlink(
        externalDirectory,
        path.join(prepared.assetRoot, "icons"),
        process.platform === "win32" ? "junction" : "dir",
      );
    } catch (error) {
      context.skip(
        `This host cannot create the test symlink: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      );
      return;
    }
    const result = await runCheck(repositoryRoot, manifest, prepared);
    assert(result.issues.some((issue) => issue.includes("is a symbolic link")));
    assert.equal(
      result.issues.some((issue) => issue.includes("Invalid SVG")),
      false,
    );
    assert.equal(result.stats.admittedFileCount, 0);
  } finally {
    await rm(repositoryRoot, { force: true, recursive: true });
  }
});

test("only the exact API diagram registry may read provider assets", async () => {
  const repositoryRoot = await temporaryRepository();
  try {
    const manifest = createPlaceholderManifest();
    const prepared = await prepareCheckedRoot(repositoryRoot, manifest);
    const registry = "apps/api/src/provider-icons/aws-diagram-icon-registry.ts";
    const rejected = [
      "apps/api/src/production-solution-export-assets.ts",
      "apps/api/src/provider-icons/another-registry.ts",
      "apps/api/src/provider-icons/aws-diagram-icon-registry.test.ts",
      "apps/api/src/provider-icons/nested/aws-diagram-icon-registry.ts",
    ];
    for (const file of [registry, ...rejected]) {
      const destination = path.join(repositoryRoot, file);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(
        destination,
        'const file = "@cloudmarkup/provider-aws/assets/icons/compute.svg";\n',
      );
    }
    const result = await runCheck(repositoryRoot, manifest, prepared);
    assert.deepEqual(
      result.issues
        .filter((issue) =>
          issue.startsWith("Direct provider-asset import outside registry:"),
        )
        .sort(),
      rejected
        .map(
          (file) =>
            "Direct provider-asset import outside registry: " + file + ".",
        )
        .sort(),
    );
  } finally {
    await rm(repositoryRoot, { force: true, recursive: true });
  }
});

test("cache copies require Git-ignore evidence and cannot hide tracked or application imports", async () => {
  const repositoryRoot = await temporaryRepository();
  try {
    const manifest = createPlaceholderManifest();
    const prepared = await prepareCheckedRoot(repositoryRoot, manifest);
    const copied = ".cache/historical/registry.ts";
    const tracked = ".cache/copied-worker.ts";
    const application = "apps/api/src/direct.ts";
    for (const file of [copied, tracked, application]) {
      const destination = path.join(repositoryRoot, file);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(
        destination,
        'import "@cloudmarkup/provider-aws/assets/icons/compute.svg";\n',
      );
    }
    const imports = async () =>
      (await runCheck(repositoryRoot, manifest, prepared)).issues
        .filter((issue) =>
          issue.startsWith("Direct provider-asset import outside registry:"),
        )
        .sort();
    const expected = (files) =>
      files
        .map(
          (file) =>
            "Direct provider-asset import outside registry: " + file + ".",
        )
        .sort();
    assert.deepEqual(await imports(), expected([copied, tracked, application]));
    const git = (...args) =>
      execFileSync("git", args, {
        cwd: repositoryRoot,
        stdio: "ignore",
        windowsHide: true,
      });
    git("init", "--quiet");
    await writeFile(
      path.join(repositoryRoot, ".gitignore"),
      ".cache/\napps/api/src/direct.ts\n",
    );
    assert.deepEqual(await imports(), expected([application]));
    git("add", "--force", "--", tracked);
    assert.deepEqual(await imports(), expected([tracked, application]));
  } finally {
    await rm(repositoryRoot, { force: true, recursive: true });
  }
});
