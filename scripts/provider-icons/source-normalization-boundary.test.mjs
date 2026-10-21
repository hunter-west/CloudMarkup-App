import assert from "node:assert/strict";
import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { importProviderIcons } from "./import-core.mjs";
import { validateProviderIconStagingManifest } from "./manifest-contract.mjs";
import { normalizeImportedProviderSvgSource } from "./source-normalization.mjs";
import { validateAndNormalizeSvg } from "./svg-policy.mjs";
import {
  createTestMapping,
  safeSvg,
  testCatalog,
  testImportMetadata,
} from "./test-helpers.mjs";
import {
  BASE_PROVIDER_ICON_TRANSFORMATION_STEPS,
  PROVIDER_ICON_TRANSFORMATION_STEPS,
} from "./transformation-steps.mjs";

const declaration = ' xmlns:xlink="http://www.w3.org/1999/xlink"';
const svgNamespace = ' xmlns="http://www.w3.org/2000/svg"';

async function temporaryDirectory() {
  return mkdtemp(path.join(tmpdir(), "cloudmarkup-icon-normalization-"));
}

async function pathExists(file) {
  return (await lstat(file).catch(() => undefined)) !== undefined;
}

function assertUnchangedAndRejected(source) {
  const bytes = Buffer.from(source);
  const normalized = normalizeImportedProviderSvgSource(bytes);

  assert.equal(normalized.removedUnusedRootXlinkNamespaceDeclaration, false);
  assert.deepEqual(normalized.bytes, bytes);
  assert.throws(
    () => validateAndNormalizeSvg(normalized.bytes),
    /Unsafe provider SVG/u,
  );
}

test("failed write-mode imports leave no staging or recovery artifact", async () => {
  for (const [label, body] of [
    ["script", "<script>alert(1)</script>"],
    ["event", '<path d="M0 0" onclick="alert(1)"/>'],
    ["remote", '<path d="M0 0" fill="url(https://example.invalid/x)"/>'],
  ]) {
    const root = await temporaryDirectory();
    try {
      const sourceDirectory = path.join(root, "source");
      const destinationDirectory = path.join(root, "review", "icons");
      const manifestFile = path.join(
        root,
        "review",
        "provider-icons.manifest.json",
      );
      const registrationFile = path.join(
        root,
        "web",
        "aws-assets.generated.ts",
      );
      await mkdir(sourceDirectory);
      await writeFile(
        path.join(sourceDirectory, "unsafe.svg"),
        `<svg${svgNamespace}${declaration} viewBox="0 0 1 1">${body}</svg>`,
      );

      await assert.rejects(
        importProviderIcons({
          catalog: testCatalog,
          destinationDirectory,
          manifestFile,
          mapping: {
            contractVersion: 2,
            mappings: [
              createTestMapping({
                outputFile: "compute.svg",
                sourceFile: "unsafe.svg",
              }),
            ],
          },
          metadata: testImportMetadata,
          registrationFile,
          sourceDirectory,
          write: true,
        }),
        /Unsafe provider SVG/u,
        label,
      );

      assert.equal(await pathExists(destinationDirectory), false, label);
      assert.equal(await pathExists(manifestFile), false, label);
      assert.equal(await pathExists(registrationFile), false, label);
      const remaining = await readdir(root, { recursive: true });
      assert.equal(
        remaining.some(
          (entry) =>
            entry.includes(".cloudmarkup-import-") ||
            entry.endsWith(".tmp") ||
            entry.endsWith(".backup"),
        ),
        false,
        label,
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  }
});

test("preserves multibyte source bytes around the exact root declaration", () => {
  const source = `\uFEFF<?xml version="1.0" encoding="UTF-8"?>\r\n<!-- \u{1f600} -->\r\n<svg${svgNamespace} data-label="\u8d44\u6e90"${declaration} viewBox="0 0 1 1"><path d="M0 0"/></svg>`;
  const expected = Buffer.from(source.replace(declaration, ""));
  const normalized = normalizeImportedProviderSvgSource(Buffer.from(source));

  assert.equal(normalized.removedUnusedRootXlinkNamespaceDeclaration, true);
  assert.deepEqual(normalized.bytes, expected);
  assert.doesNotThrow(() => validateAndNormalizeSvg(normalized.bytes));
});

test("keeps unsupported namespace shapes and deceptive exact tokens rejected", () => {
  for (const source of [
    `<svg${declaration} viewBox="0 0 1 1"><path d="M0 0"/></svg>`,
    `<svg xmlns="https://example.invalid/svg"${declaration} viewBox="0 0 1 1"><path d="M0 0"/></svg>`,
    `<svg${svgNamespace}${declaration} viewBox="0 0 1 1"><g xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></g></svg>`,
    `<svg${svgNamespace}${declaration} viewBox="0 0 1 1"><g xmlns=""><path d="M0 0"/></g></svg>`,
    `<svg${svgNamespace}${declaration} xmlns:xlink='http://www.w3.org/1999/xlink' viewBox="0 0 1 1"><path d="M0 0"/></svg>`,
    `<svg${svgNamespace}${declaration} viewBox="0 0 1 1"><text><![CDATA[${declaration}]]></text></svg>`,
    `<svg${svgNamespace}${declaration} data-note='${declaration}' viewBox="0 0 1 1"><path d="M0 0"/></svg>`,
    `<svg${svgNamespace}${declaration} viewBox="0 0 1 1"><text>${declaration}</text></svg>`,
  ]) {
    assertUnchangedAndRejected(source);
  }
});

test("rejects unsupported XML declaration versions", () => {
  const body = `<svg${svgNamespace} viewBox="0 0 1 1"><path d="M0 0"/></svg>`;
  for (const version of ["1.2", "1.01"]) {
    assert.throws(
      () =>
        validateAndNormalizeSvg(
          Buffer.from(`<?xml version="${version}"?>${body}`),
        ),
      /processing-instruction/u,
      version,
    );
  }
});

test("requires exact top-level and per-entry transformation sequences", async () => {
  const root = await temporaryDirectory();
  try {
    const sourceDirectory = path.join(root, "source");
    await mkdir(sourceDirectory);
    await writeFile(path.join(sourceDirectory, "compute.svg"), safeSvg);
    const imported = await importProviderIcons({
      catalog: testCatalog,
      destinationDirectory: path.join(root, "review", "icons"),
      manifestFile: path.join(root, "review", "provider-icons.manifest.json"),
      mapping: {
        contractVersion: 2,
        mappings: [createTestMapping()],
      },
      metadata: testImportMetadata,
      registrationFile: path.join(root, "web", "aws-assets.generated.ts"),
      sourceDirectory,
    });

    const topLevelCases = [
      ["unknown-step", ...PROVIDER_ICON_TRANSFORMATION_STEPS.slice(1)],
      [
        PROVIDER_ICON_TRANSFORMATION_STEPS[1],
        PROVIDER_ICON_TRANSFORMATION_STEPS[0],
        ...PROVIDER_ICON_TRANSFORMATION_STEPS.slice(2),
      ],
      [
        ...PROVIDER_ICON_TRANSFORMATION_STEPS,
        PROVIDER_ICON_TRANSFORMATION_STEPS[0],
      ],
      PROVIDER_ICON_TRANSFORMATION_STEPS.slice(1),
      [...PROVIDER_ICON_TRANSFORMATION_STEPS, "extra-step"],
    ];
    for (const steps of topLevelCases) {
      const manifest = structuredClone(imported.manifest);
      manifest.transformation.steps = [...steps];
      assert.throws(
        () => validateProviderIconStagingManifest(manifest),
        /transformation.steps is invalid/u,
      );
    }

    const perEntryCases = [
      ["unknown-step", ...BASE_PROVIDER_ICON_TRANSFORMATION_STEPS.slice(1)],
      [
        BASE_PROVIDER_ICON_TRANSFORMATION_STEPS[1],
        BASE_PROVIDER_ICON_TRANSFORMATION_STEPS[0],
        ...BASE_PROVIDER_ICON_TRANSFORMATION_STEPS.slice(2),
      ],
    ];
    for (const steps of perEntryCases) {
      const manifest = structuredClone(imported.manifest);
      manifest.entries[0].transformationSteps = steps;
      assert.throws(
        () => validateProviderIconStagingManifest(manifest),
        /entries\[0\]\.transformationSteps is invalid/u,
      );
    }
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
