import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  importProviderIcons,
  isNonLocalFilesystemPath,
  resolveExternalReviewDirectory,
  resolveSafeExternalReviewDirectory,
} from "./import-core.mjs";
import {
  calculateSelectedSourceSha256,
  validateProviderIconManifest,
  validateProviderIconStagingManifest,
} from "./manifest-contract.mjs";
import {
  MAX_PROVIDER_SVG_BYTES,
  MAX_PROVIDER_SVG_PATH_COMMANDS,
} from "./svg-policy.mjs";
import { safeSvg, testCatalog, testImportMetadata } from "./test-helpers.mjs";
import {
  BASE_PROVIDER_ICON_TRANSFORMATION_STEPS,
  PROVIDER_ICON_TRANSFORMATION_STEPS,
  REMOVE_UNUSED_ROOT_XLINK_NAMESPACE_STEP,
} from "./transformation-steps.mjs";
import { generateWebAssetModule } from "./web-registration.mjs";

async function temporaryDirectory() {
  return mkdtemp(path.join(tmpdir(), "cloudmarkup-provider-icons-"));
}

function toV2Mapping(mapping) {
  return {
    contractVersion: 2,
    mappings: mapping.mappings.map((entry) => {
      const outputStem = entry.outputFile
        .replace(/\.svg$/u, "")
        .replace(/[^a-z0-9]+/gu, "-")
        .replace(/^-|-$/gu, "");
      return {
        awsServiceFamily: "Example service family",
        destinationAssetId: `example.provider.assets.${
          outputStem === "" ? "candidate" : outputStem
        }`,
        mappingType: "exact-resource",
        ...entry,
      };
    }),
  };
}

function importOptions(root, sourceDirectory, mapping) {
  return {
    catalog: testCatalog,
    destinationDirectory: path.join(root, "assets", "icons"),
    manifestFile: path.join(root, "assets", "provider-icons.manifest.json"),
    mapping: toV2Mapping(mapping),
    metadata: testImportMetadata,
    registrationFile: path.join(root, "web", "aws-assets.generated.ts"),
    sourceDirectory,
  };
}

test("imports are deterministic and report catalog assets not supplied", async () => {
  const firstRoot = await temporaryDirectory();
  const secondRoot = await temporaryDirectory();
  try {
    const firstSource = path.join(firstRoot, "source");
    const secondSource = path.join(secondRoot, "different-local-source");
    await mkdir(firstSource);
    await mkdir(secondSource);
    await writeFile(path.join(firstSource, "compute.svg"), safeSvg);
    await writeFile(path.join(secondSource, "compute.svg"), safeSvg);
    const mapping = {
      contractVersion: 1,
      mappings: [
        {
          iconId: "example.icons.compute",
          outputFile: "compute.svg",
          sourceFile: "compute.svg",
        },
      ],
    };

    const first = await importProviderIcons(
      importOptions(firstRoot, firstSource, mapping),
    );
    const second = await importProviderIcons(
      importOptions(secondRoot, secondSource, mapping),
    );
    const discovery = await importProviderIcons({
      ...importOptions(firstRoot, firstSource, mapping),
      metadata: { ...testImportMetadata, selectedSourceSha256: undefined },
    });

    assert.equal(first.manifestBytes, second.manifestBytes);
    assert.equal(first.registrationBytes, second.registrationBytes);
    assert.deepEqual(first.importedIconIds, ["example.icons.compute"]);
    assert.deepEqual(first.missingIconIds, ["example.icons.database"]);
    assert.equal(
      discovery.selectedSourceSha256,
      testImportMetadata.selectedSourceSha256,
    );
    assert.equal(first.manifest.source.origin, testImportMetadata.sourceOrigin);
    assert.equal(
      first.manifest.entries[0].state,
      "candidate",
      "local import must not self-approve provider artwork",
    );
    assert.equal(first.manifest.entries[0].serviceName, "Example compute");
    assert.deepEqual(
      first.manifest.entries[0].transformationSteps,
      BASE_PROVIDER_ICON_TRANSFORMATION_STEPS,
    );
    assert.deepEqual(
      first.manifest.transformation.steps,
      PROVIDER_ICON_TRANSFORMATION_STEPS,
    );
    assert.doesNotThrow(() =>
      validateProviderIconStagingManifest(first.manifest),
    );
    assert.throws(
      () => validateProviderIconManifest(first.manifest),
      /state is invalid/u,
    );
  } finally {
    await rm(firstRoot, { force: true, recursive: true });
    await rm(secondRoot, { force: true, recursive: true });
  }
});

test("records deterministic source-only normalization evidence for shared files", async () => {
  const root = await temporaryDirectory();
  try {
    const sourceDirectory = path.join(root, "source");
    await mkdir(sourceDirectory);
    const declaration = ' xmlns:xlink="http://www.w3.org/1999/xlink"';
    const source = safeSvg.replace(" viewBox=", `${declaration} viewBox=`);
    await writeFile(path.join(sourceDirectory, "shared.svg"), source);
    const mapping = {
      contractVersion: 1,
      mappings: [
        {
          iconId: "example.icons.compute",
          outputFile: "shared.svg",
          sourceFile: "shared.svg",
        },
        {
          iconId: "example.icons.database",
          outputFile: "shared.svg",
          sourceFile: "shared.svg",
        },
      ],
    };
    const options = {
      ...importOptions(root, sourceDirectory, mapping),
      metadata: {
        ...testImportMetadata,
        selectedSourceSha256: undefined,
      },
    };

    const first = await importProviderIcons(options);
    const repeated = await importProviderIcons(options);
    const admittedEntries = first.manifest.entries.filter(
      (entry) => entry.file !== null,
    );
    const expectedSteps = [
      REMOVE_UNUSED_ROOT_XLINK_NAMESPACE_STEP,
      ...BASE_PROVIDER_ICON_TRANSFORMATION_STEPS,
    ];

    assert.equal(first.manifestBytes, repeated.manifestBytes);
    assert.deepEqual(
      first.manifest.transformation.steps,
      PROVIDER_ICON_TRANSFORMATION_STEPS,
    );
    assert.equal(admittedEntries.length, 2);
    for (const entry of admittedEntries) {
      assert.deepEqual(entry.transformationSteps, expectedSteps);
      assert.equal(entry.file, "shared.svg");
      assert.equal(
        entry.sourceBytes - entry.normalizedBytes,
        Buffer.byteLength(declaration),
      );
      assert.notEqual(entry.sourceSha256, entry.normalizedSha256);
    }
    for (const key of [
      "normalizedBytes",
      "normalizedSha256",
      "sourceBytes",
      "sourceMember",
      "sourceSha256",
      "viewBox",
    ]) {
      assert.equal(admittedEntries[0][key], admittedEntries[1][key], key);
    }

    const driftedManifest = structuredClone(first.manifest);
    driftedManifest.entries[1].transformationSteps = [
      ...BASE_PROVIDER_ICON_TRANSFORMATION_STEPS,
    ];
    assert.throws(
      () => validateProviderIconStagingManifest(driftedManifest),
      /entries disagree about destination asset/u,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("rejects network, extended, and device filesystem paths lexically", () => {
  for (const value of [
    String.raw`\\server\share\icons`,
    String.raw`\\?\UNC\server\share\icons`,
    String.raw`\\.\pipe\icons`,
    String.raw`\??\UNC\server\share\icons`,
    String.raw`\Device\HarddiskVolume1\icons`,
    "//server/share/icons",
    "file:///tmp/icons",
    "https://example.invalid/icons",
  ]) {
    assert.equal(
      isNonLocalFilesystemPath(value),
      true,
      `expected a non-local path: ${value}`,
    );
  }

  for (const value of [
    String.raw`C:\local\icons`,
    "/local/icons",
    "relative/icons",
  ]) {
    assert.equal(
      isNonLocalFilesystemPath(value),
      false,
      `expected a local filesystem path: ${value}`,
    );
  }
});

test("requires review staging to remain canonically outside the repository", async (context) => {
  const repositoryRoot = await temporaryDirectory();
  let sibling;
  let linkContainer;
  try {
    assert.throws(
      () =>
        resolveExternalReviewDirectory(
          repositoryRoot,
          path.join(repositoryRoot, "review"),
        ),
      /outside the repository/u,
    );
    assert.throws(
      () =>
        resolveExternalReviewDirectory(
          repositoryRoot,
          String.raw`\\server\share\review`,
        ),
      /local directory/u,
    );

    sibling = path.join(
      path.dirname(repositoryRoot),
      `${path.basename(repositoryRoot)}-review`,
    );
    await mkdir(sibling);
    assert.equal(
      resolveExternalReviewDirectory(repositoryRoot, sibling),
      path.resolve(sibling),
    );
    assert.equal(
      await resolveSafeExternalReviewDirectory(repositoryRoot, sibling),
      await realpath(sibling),
    );

    linkContainer = await temporaryDirectory();
    const linkedRepository = path.join(linkContainer, "linked-repository");
    await mkdir(path.join(repositoryRoot, "redirected-review"));
    try {
      await symlink(
        repositoryRoot,
        linkedRepository,
        process.platform === "win32" ? "junction" : "dir",
      );
      await assert.rejects(
        resolveSafeExternalReviewDirectory(
          repositoryRoot,
          path.join(linkedRepository, "redirected-review"),
        ),
        /resolves inside the repository/u,
      );
    } catch (error) {
      if (
        error instanceof Error &&
        !/resolves inside the repository/u.test(error.message)
      ) {
        context.diagnostic(
          `Parent-symlink assertion skipped on this host: ${error.message}`,
        );
      } else {
        throw error;
      }
    }
  } finally {
    await rm(repositoryRoot, { force: true, recursive: true });
    if (sibling !== undefined) {
      await rm(sibling, { force: true, recursive: true });
    }
    if (linkContainer !== undefined) {
      await rm(linkContainer, { force: true, recursive: true });
    }
  }
});

test("candidate staging never generates runtime imports", () => {
  const generated = generateWebAssetModule({
    approval: testImportMetadata.approval,
    entries: [
      {
        file: "candidate.svg",
        iconId: "example.icons.candidate",
        state: "candidate",
      },
    ],
  });

  assert.doesNotMatch(generated, /candidate\.svg/u);
  assert.doesNotMatch(generated, /example\.icons\.candidate/u);
});

test("write mode creates deterministic admitted bytes, manifest, and static registration", async () => {
  const root = await temporaryDirectory();
  try {
    const source = path.join(root, "source");
    await mkdir(source);
    await writeFile(path.join(source, "compute.svg"), safeSvg);
    const options = importOptions(root, source, {
      contractVersion: 1,
      mappings: [
        {
          iconId: "example.icons.compute",
          outputFile: "compute.svg",
          sourceFile: "compute.svg",
        },
      ],
    });
    const result = await importProviderIcons({ ...options, write: true });
    await writeFile(
      path.join(options.destinationDirectory, "stale.svg"),
      safeSvg,
    );
    const repeatedResult = await importProviderIcons({
      ...options,
      write: true,
    });

    const { readFile } = await import("node:fs/promises");
    assert.equal(repeatedResult.manifestBytes, result.manifestBytes);
    assert.deepEqual(result.orphanedFiles, []);
    assert.deepEqual(repeatedResult.orphanedFiles, ["stale.svg"]);
    assert.equal(
      await readFile(options.manifestFile, "utf8"),
      result.manifestBytes,
    );
    assert.equal(
      await readFile(options.registrationFile, "utf8"),
      result.registrationBytes,
    );
    assert.equal(
      await readFile(
        path.join(options.destinationDirectory, "compute.svg"),
        "utf8",
      ),
      safeSvg,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("write mode blocks staging recovery artifacts left by an earlier process", async () => {
  const root = await temporaryDirectory();
  try {
    const source = path.join(root, "source");
    await mkdir(source);
    await writeFile(path.join(source, "compute.svg"), safeSvg);
    const options = importOptions(root, source, {
      contractVersion: 1,
      mappings: [
        {
          iconId: "example.icons.compute",
          outputFile: "compute.svg",
          sourceFile: "compute.svg",
        },
      ],
    });
    await importProviderIcons({ ...options, write: true });
    const admittedFile = path.join(options.destinationDirectory, "compute.svg");
    await writeFile(admittedFile, "existing admitted bytes");
    await writeFile(
      `${options.manifestFile}.cloudmarkup-import-previous-process.backup`,
      "recovery evidence",
    );

    await assert.rejects(
      importProviderIcons({ ...options, write: true }),
      /stale provider-icon import temporary or backup/u,
    );
    assert.equal(
      await readFile(admittedFile, "utf8"),
      "existing admitted bytes",
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("write mode preflights every target before replacing an earlier asset", async () => {
  const root = await temporaryDirectory();
  try {
    const source = path.join(root, "source");
    await mkdir(source);
    await writeFile(path.join(source, "compute.svg"), safeSvg);
    const options = importOptions(root, source, {
      contractVersion: 1,
      mappings: [
        {
          iconId: "example.icons.compute",
          outputFile: "compute.svg",
          sourceFile: "compute.svg",
        },
      ],
    });
    await mkdir(options.destinationDirectory, { recursive: true });
    const admittedFile = path.join(options.destinationDirectory, "compute.svg");
    await writeFile(admittedFile, "existing admitted bytes");
    await mkdir(options.manifestFile, { recursive: true });

    await assert.rejects(
      importProviderIcons({ ...options, write: true }),
      /manifest destination must be absent or a regular file/u,
    );
    assert.equal(
      await readFile(admittedFile, "utf8"),
      "existing admitted bytes",
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("rejects traversal, unsupported files, missing members, and malicious SVG", async () => {
  const root = await temporaryDirectory();
  try {
    const source = path.join(root, "source");
    await mkdir(source);
    await writeFile(
      path.join(source, "malicious.svg"),
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><script>alert(1)</script></svg>',
    );
    await writeFile(
      path.join(source, "namespaced-script.svg"),
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:s="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><s:script>alert(1)</s:script></svg>',
    );
    await writeFile(
      path.join(source, "escaped-style.svg"),
      String.raw`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><style>rect{fill:u\72l(https\3a\2f\2f example.invalid/x)}</style><rect width="1" height="1"/></svg>`,
    );
    await writeFile(
      path.join(source, "inline-style.svg"),
      String.raw`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect style="fill:u\72l(https\3a\2f\2f example.invalid/x)" width="1" height="1"/></svg>`,
    );
    await writeFile(
      path.join(source, "malformed-nesting.svg"),
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><g></svg>',
    );
    await writeFile(
      path.join(source, "duplicate-attribute.svg"),
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" width="2"/></svg>',
    );
    await writeFile(
      path.join(source, "multiple-roots.svg"),
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"></svg><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"></svg>',
    );
    await writeFile(
      path.join(source, "encoded-remote.svg"),
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect fill="&#x75;&#x72;&#x6c;(&#x68;&#x74;&#x74;&#x70;&#x73;&#x3a;&#x2f;&#x2f;example.invalid/x)" width="1" height="1"/></svg>',
    );
    await writeFile(
      path.join(source, "encoded-href.svg"),
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><use href="&#x68;ttps://example.invalid/x"/></svg>',
    );
    await writeFile(
      path.join(source, "encoded-path-command.svg"),
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><path d="&#77;0 0h1v1z"/></svg>',
    );
    await writeFile(
      path.join(source, "encoded-transform.svg"),
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect transform="translate(&#49; 1)" width="1" height="1"/></svg>',
    );
    await writeFile(
      path.join(source, "css-escaped-remote.svg"),
      String.raw`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect fill="u\72l(https\3a\2f\2f example.invalid/x)" width="1" height="1"/></svg>`,
    );
    await writeFile(
      path.join(source, "animate-color.svg"),
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1"><animateColor attributeName="fill" values="red;blue"/></rect></svg>',
    );
    await writeFile(
      path.join(source, "discard.svg"),
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1"><discard begin="1s"/></rect></svg>',
    );
    await writeFile(
      path.join(source, "script-presentation.svg"),
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect fill="javascript:alert(1)" width="1" height="1"/></svg>',
    );
    await writeFile(
      path.join(source, "duplicate-id.svg"),
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><path id="shape" d="M0 0"/><path id="shape" d="M1 1"/></svg>',
    );
    await writeFile(
      path.join(source, "unresolved-use.svg"),
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><use href="#missing"/></svg>',
    );
    await writeFile(
      path.join(source, "recursive-use.svg"),
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><g id="loop"><use href="#loop"/></g></svg>',
    );
    await writeFile(
      path.join(source, "implicit-path-complexity.svg"),
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><path d="M0 0 ${"0 0 ".repeat(
        MAX_PROVIDER_SVG_PATH_COMMANDS + 1,
      )}"/></svg>`,
    );
    await writeFile(
      path.join(source, "oversized.svg"),
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1">${" ".repeat(
        MAX_PROVIDER_SVG_BYTES,
      )}</svg>`,
    );
    await writeFile(path.join(source, "compute.svg"), safeSvg);

    const cases = [
      {
        expected: /traversal/u,
        sourceFile: "../outside.svg",
      },
      {
        expected: /only SVG/u,
        sourceFile: "asset.png",
      },
      {
        expected: /local relative path/u,
        sourceFile: "https://example.invalid/icon.svg",
      },
      {
        expected: /missing/u,
        sourceFile: "missing.svg",
      },
      {
        expected: /exceeds/u,
        sourceFile: "oversized.svg",
      },
      {
        expected: /Unsafe provider SVG/u,
        sourceFile: "malicious.svg",
      },
      {
        expected: /namespace-prefixed/u,
        sourceFile: "namespaced-script.svg",
      },
      {
        expected: /Unsafe provider SVG/u,
        sourceFile: "escaped-style.svg",
      },
      {
        expected: /(?:inline style|backslash escapes)/u,
        sourceFile: "inline-style.svg",
      },
      {
        expected: /well-formed XML/u,
        sourceFile: "malformed-nesting.svg",
      },
      {
        expected: /well-formed XML/u,
        sourceFile: "duplicate-attribute.svg",
      },
      {
        expected: /well-formed XML/u,
        sourceFile: "multiple-roots.svg",
      },
      {
        expected: /character and entity references/u,
        sourceFile: "encoded-remote.svg",
      },
      {
        expected: /character and entity references/u,
        sourceFile: "encoded-href.svg",
      },
      {
        expected: /character and entity references/u,
        sourceFile: "encoded-path-command.svg",
      },
      {
        expected: /character and entity references/u,
        sourceFile: "encoded-transform.svg",
      },
      {
        expected: /backslash escapes/u,
        sourceFile: "css-escaped-remote.svg",
      },
      {
        expected: /Unsafe provider SVG/u,
        sourceFile: "animate-color.svg",
      },
      {
        expected: /Unsafe provider SVG/u,
        sourceFile: "discard.svg",
      },
      {
        expected: /decoded attributes/u,
        sourceFile: "script-presentation.svg",
      },
      {
        expected: /duplicate local fragment ID/u,
        sourceFile: "duplicate-id.svg",
      },
      {
        expected: /does not resolve/u,
        sourceFile: "unresolved-use.svg",
      },
      {
        expected: /cannot be recursive/u,
        sourceFile: "recursive-use.svg",
      },
      {
        expected: /path commands/u,
        sourceFile: "implicit-path-complexity.svg",
      },
    ];

    for (const testCase of cases) {
      await assert.rejects(
        importProviderIcons(
          importOptions(root, source, {
            contractVersion: 1,
            mappings: [
              {
                iconId: "example.icons.compute",
                outputFile: "compute.svg",
                sourceFile: testCase.sourceFile,
              },
            ],
          }),
        ),
        testCase.expected,
      );
    }
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("rejects symlinked local source roots", async (context) => {
  const root = await temporaryDirectory();
  try {
    const realSource = path.join(root, "real-source");
    const linkedSource = path.join(root, "linked-source");
    await mkdir(realSource);
    await writeFile(path.join(realSource, "compute.svg"), safeSvg);
    try {
      await symlink(
        realSource,
        linkedSource,
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

    await assert.rejects(
      importProviderIcons(
        importOptions(root, linkedSource, {
          contractVersion: 1,
          mappings: [
            {
              iconId: "example.icons.compute",
              outputFile: "compute.svg",
              sourceFile: "compute.svg",
            },
          ],
        }),
      ),
      /symbolic link/u,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("requires an explicit valid timestamp and rejects non-catalog mappings", async () => {
  const root = await temporaryDirectory();
  try {
    const source = path.join(root, "source");
    await mkdir(source);
    await writeFile(path.join(source, "compute.svg"), safeSvg);
    const mapping = {
      contractVersion: 1,
      mappings: [
        {
          iconId: "not.in.catalog",
          outputFile: "compute.svg",
          sourceFile: "compute.svg",
        },
      ],
    };
    await assert.rejects(
      importProviderIcons(importOptions(root, source, mapping)),
      /non-catalog icon ID/u,
    );
    await assert.rejects(
      importProviderIcons({
        ...importOptions(root, source, {
          ...mapping,
          mappings: [
            {
              ...mapping.mappings[0],
              iconId: "example.icons.compute",
            },
          ],
        }),
        metadata: { ...testImportMetadata, importedAt: "now" },
      }),
      /explicit UTC timestamp/u,
    );
    await assert.rejects(
      importProviderIcons({
        ...importOptions(root, source, {
          ...mapping,
          mappings: [
            {
              ...mapping.mappings[0],
              iconId: "example.icons.compute",
            },
          ],
        }),
        metadata: {
          ...testImportMetadata,
          selectedSourceSha256:
            "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        },
        write: true,
      }),
      /selected source checksum/u,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("selected-source evidence is derived from exact candidate members", async () => {
  const root = await temporaryDirectory();
  try {
    const source = path.join(root, "source");
    await mkdir(source);
    await writeFile(path.join(source, "compute.svg"), safeSvg);
    const imported = await importProviderIcons(
      importOptions(root, source, {
        contractVersion: 1,
        mappings: [
          {
            iconId: "example.icons.compute",
            outputFile: "compute.svg",
            sourceFile: "compute.svg",
          },
        ],
      }),
    );

    assert.equal(
      calculateSelectedSourceSha256(imported.manifest.entries),
      imported.selectedSourceSha256,
    );

    const compute = imported.manifest.entries.find(
      (entry) => entry.iconId === "example.icons.compute",
    );
    assert.throws(
      () =>
        calculateSelectedSourceSha256([
          compute,
          {
            ...compute,
            iconId: "example.icons.database",
            sourceSha256:
              "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
          },
        ]),
      /disagree about selected source member/u,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("rejects legacy mapping contracts and duplicate normalized assets", async () => {
  const root = await temporaryDirectory();
  try {
    const source = path.join(root, "source");
    await mkdir(source);
    await writeFile(path.join(source, "compute.svg"), safeSvg);
    await writeFile(path.join(source, "database.svg"), safeSvg);

    const legacyOptions = importOptions(root, source, {
      contractVersion: 2,
      mappings: [
        {
          iconId: "example.icons.compute",
          outputFile: "compute.svg",
          sourceFile: "compute.svg",
        },
      ],
    });
    legacyOptions.mapping = {
      ...legacyOptions.mapping,
      contractVersion: 1,
    };
    await assert.rejects(
      importProviderIcons(legacyOptions),
      /mapping contractVersion/u,
    );

    const duplicateOptions = importOptions(root, source, {
      contractVersion: 2,
      mappings: [
        {
          iconId: "example.icons.compute",
          outputFile: "compute.svg",
          sourceFile: "compute.svg",
        },
        {
          iconId: "example.icons.database",
          outputFile: "database.svg",
          sourceFile: "database.svg",
        },
      ],
    });
    await assert.rejects(
      importProviderIcons({
        ...duplicateOptions,
        metadata: {
          ...testImportMetadata,
          selectedSourceSha256: undefined,
        },
        write: true,
      }),
      /normalized bytes .* map to multiple assets/u,
    );
    await assert.rejects(readFile(duplicateOptions.manifestFile), /ENOENT/u);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
