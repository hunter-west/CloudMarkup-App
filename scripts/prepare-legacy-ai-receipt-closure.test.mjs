import {
  createLegacyClockAdapterV2,
  rebaseLegacySyntheticClockWindow,
  LEGACY_CLOCK_V1_WINDOW,
  LEGACY_CLOCK_V2_WINDOW,
} from "./legacy-ai-receipt-clock.mjs";
import assert from "node:assert/strict";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { basename, dirname, resolve } from "node:path";
import test from "node:test";
import {
  LEGACY_AI_SOURCE_COMMIT,
  LEGACY_AI_CAPTURE_REQUIRE_BANNER,
  parseLegacyPreparationArguments,
  prepareLegacyAiReceiptClosure,
  requireLegacyOwnedPath,
  validateLegacyCaptureContract,
  validateLegacyCaptureMetafile,
} from "./prepare-legacy-ai-receipt-closure.mjs";

const contract = JSON.parse(
  await readFile(
    new URL("./fixtures/legacy-ai-receipt-closure-v1.json", import.meta.url),
    "utf8",
  ),
);
const source = resolve(".cache/legacy-ai-a979e325"),
  entry = resolve(source, "apps/api/.cache/legacy-ai-capture/capture.mjs");
function metafile() {
  return {
    inputs: {
      "apps/api/.cache/legacy-ai-capture/capture.mjs": {},
      "apps/api/dist/model-live-repository-case-assessment.js": {},
    },
    outputs: {
      "capture.mjs": {
        imports: [
          { path: "vitest", external: true },
          { path: "node:crypto", external: true },
          { path: "events", external: true },
        ],
      },
    },
  };
}
test("historical fetching is explicit and cannot bypass the admitted byte pins", async () => {
  assert.deepEqual(parseLegacyPreparationArguments([]), {
    captureCandidate: false,
    fetchDependencies: false,
  });
  assert.deepEqual(parseLegacyPreparationArguments(["--fetch-dependencies"]), {
    captureCandidate: false,
    fetchDependencies: true,
  });
  assert.deepEqual(parseLegacyPreparationArguments(["--capture-candidate"]), {
    captureCandidate: true,
    fetchDependencies: false,
  });
  for (const args of [
    ["--fetch-dependencies", "--capture-candidate"],
    ["--fetch-dependencies", "--fetch-dependencies"],
    ["--fetch-dependencies=main"],
    ["--ignore-integrity"],
  ])
    assert.throws(() => parseLegacyPreparationArguments(args), /Unknown/u);
  await assert.rejects(
    prepareLegacyAiReceiptClosure({
      fetchDependencies: true,
      captureCandidate: true,
    }),
    /admitted historical pins/u,
  );
});

test("admits exact local legacy capture metadata without claiming an unbuilt bundle", () => {
  assert.equal(
    validateLegacyCaptureContract(contract).sourceCommit,
    LEGACY_AI_SOURCE_COMMIT,
  );
  assert.deepEqual(validateLegacyCaptureMetafile(metafile(), source, entry), [
    "apps/api/.cache/legacy-ai-capture/capture.mjs",
    "apps/api/dist/model-live-repository-case-assessment.js",
  ]);
});
for (const [key, value] of [
  ["sourceCommit", "0".repeat(40)],
  ["sourceDirectory", "../current"],
  ["outputDirectory", "apps/api/dist"],
  ["bundleFile", "../outside.mjs"],
  ["sourceLockSha256", "0".repeat(64)],
  ["captureEntry", "scripts/customer-code.mjs"],
  ["captureEntrySha256", "unverified"],
  ["bundleSha256", "unverified"],
  ["maximumBundleBytes", Number.MAX_SAFE_INTEGER],
  ["maximumManifestBytes", Number.MAX_SAFE_INTEGER],
]) {
  test(`denies altered historical ${key}=${String(value).slice(0, 20)}`, () => {
    assert.throws(
      () => validateLegacyCaptureContract({ ...contract, [key]: value }),
      /exact historical/u,
    );
  });
}
for (const target of [
  source,
  resolve(source, ".."),
  resolve(source, "../current/apps/api/dist/index.js"),
])
  test(`rejects source path escape ${target.split(/[\\/]/u).at(-1)}`, () => {
    assert.throws(() => requireLegacyOwnedPath(source, target), /exact owned/u);
  });
test("rejects current-workspace modules even when the capture entry itself is valid", () => {
  const value = metafile();
  value.inputs["../../apps/api/dist/model-live-repository-case-assessment.js"] =
    {};
  assert.throws(
    () => validateLegacyCaptureMetafile(value, source, entry),
    /exact owned/u,
  );
});
test("requires the single source-owned capture entry", () => {
  const value = metafile();
  delete value.inputs["apps/api/.cache/legacy-ai-capture/capture.mjs"];
  assert.throws(
    () => validateLegacyCaptureMetafile(value, source, entry),
    /entry is missing/u,
  );
});
for (const specifier of [
  "@cloudmarkup/model-gateway",
  "pg",
  "./current.mjs",
  "https://example.invalid/loader.mjs",
]) {
  test(`rejects external resolution of ${specifier}`, () => {
    const value = metafile();
    value.outputs["capture.mjs"].imports.push({
      path: specifier,
      external: true,
    });
    assert.throws(
      () => validateLegacyCaptureMetafile(value, source, entry),
      /closed bundle/u,
    );
  });
}
test("rejects unknown contract fields and malformed manifest pin", () => {
  assert.throws(
    () =>
      validateLegacyCaptureContract({
        ...contract,
        currentSourceFallback: true,
      }),
    /exact historical/u,
  );
  assert.throws(
    () =>
      validateLegacyCaptureContract({
        ...contract,
        manifestSha256: "unverified",
      }),
    /exact historical/u,
  );
});
test("requires one closed output rather than an unverified split dependency", () => {
  assert.throws(
    () =>
      validateLegacyCaptureMetafile(
        { ...metafile(), outputs: {} },
        source,
        entry,
      ),
    /one closed output/u,
  );
  const value = metafile();
  value.outputs["chunk.mjs"] = { imports: [] };
  assert.throws(
    () => validateLegacyCaptureMetafile(value, source, entry),
    /one closed output/u,
  );
});

test("records only the exact unavailable pg-native static require without granting runtime resolution", () => {
  const value = metafile();
  value.outputs["capture.mjs"].imports.push({
    path: "pg-native",
    external: true,
    kind: "require-call",
  });
  assert.doesNotThrow(() =>
    validateLegacyCaptureMetafile(value, source, entry),
  );
});
for (const extra of [
  { external: true, kind: "import-statement" },
  { external: true, kind: "dynamic-import" },
  { external: true, kind: "require-resolve" },
  { external: false, kind: "require-call" },
  { external: "true", kind: "require-call" },
])
  test(
    "denies pg-native external=" +
      String(extra.external) +
      " kind=" +
      extra.kind,
    () => {
      const value = metafile();
      value.outputs["capture.mjs"].imports.push({
        path: "pg-native",
        ...extra,
      });
      assert.throws(
        () => validateLegacyCaptureMetafile(value, source, entry),
        /closed bundle/u,
      );
    },
  );
async function removeRuntimeGuardFixture(root) {
  const actual = await realpath(root),
    stat = await lstat(root);
  if (
    actual !== root ||
    dirname(actual) !== (await realpath(tmpdir())) ||
    !basename(actual).startsWith("cm-legacy-runtime-denial-") ||
    !stat.isDirectory() ||
    stat.isSymbolicLink()
  )
    throw new Error(
      "Runtime guard fixture cleanup escaped its owned directory.",
    );
  await rm(actual, { recursive: true });
}
test("actual bundle runtime rejects pg-native even when an ancestor offers that package", async () => {
  const fixture = await mkdtemp(resolve(tmpdir(), "cm-legacy-runtime-denial-"));
  try {
    const packageRoot = resolve(fixture, "node_modules/pg-native"),
      child = resolve(fixture, "child");
    await mkdir(packageRoot, { recursive: true });
    await mkdir(child);
    const marker = resolve(fixture, "native-loaded.txt"),
      modulePath = resolve(child, "capture.mjs");
    await writeFile(
      resolve(packageRoot, "package.json"),
      JSON.stringify({
        name: "pg-native",
        version: "0.0.0",
        main: "index.cjs",
      }),
    );
    await writeFile(
      resolve(packageRoot, "index.cjs"),
      'require("node:fs").writeFileSync(' +
        JSON.stringify(marker) +
        ',"unexpected native load"); module.exports="unreviewed native";',
    );
    await writeFile(
      modulePath,
      LEGACY_AI_CAPTURE_REQUIRE_BANNER +
        "\nexport const probe = (specifier) => require(specifier);\n",
    );
    assert.equal(
      createRequire(modulePath).resolve("pg-native"),
      resolve(packageRoot, "index.cjs"),
    );
    const runtime = await import(pathToFileURL(modulePath).href);
    assert.equal(typeof runtime.probe("node:crypto").createHash, "function");
    assert.equal(typeof runtime.probe("crypto").createHash, "function");
    assert.throws(
      () => runtime.probe("pg-native"),
      /escaped its closed bundle/u,
    );
    assert.throws(() => runtime.probe("vitest"), /escaped its closed bundle/u);
    assert.equal(existsSync(marker), false);
  } finally {
    await removeRuntimeGuardFixture(fixture);
  }
});

const syntheticClockModule =
  "// apps/api/dist/adapters/persistence/model-live-runtime-host-evidence-test-helpers.js\n" +
  "function liveHostInputFixture() {\n" +
  LEGACY_CLOCK_V1_WINDOW +
  "\n}\n// original-production-module.js\nconst unchanged = true;\n";
test("calendar adapter changes only the exact synthetic fixture window", () => {
  const adapted = rebaseLegacySyntheticClockWindow(syntheticClockModule);
  assert.equal(
    adapted.replace(LEGACY_CLOCK_V2_WINDOW, LEGACY_CLOCK_V1_WINDOW),
    syntheticClockModule,
  );
  assert.ok(adapted.includes("Date.parse(original.now) - 86400000"));
  assert.ok(adapted.includes("Date.parse(original.now) + 86400000"));
});
for (const [name, value] of [
  ["missing", syntheticClockModule.replace(LEGACY_CLOCK_V1_WINDOW, "")],
  ["duplicate", syntheticClockModule + LEGACY_CLOCK_V1_WINDOW],
  [
    "wrong module",
    syntheticClockModule.replace(
      "model-live-runtime-host-evidence-test-helpers.js",
      "production.js",
    ),
  ],
  [
    "later production module",
    syntheticClockModule.replace(LEGACY_CLOCK_V1_WINDOW, "") +
      LEGACY_CLOCK_V1_WINDOW,
  ],
  [
    "unterminated module",
    syntheticClockModule.replace("\n// original-production-module.js", ""),
  ],
  ["duplicate module", syntheticClockModule + syntheticClockModule],
])
  test("calendar adapter rejects " + name + " fixture window", () => {
    assert.throws(() => rebaseLegacySyntheticClockWindow(value), /not exact/u);
  });
test("a plausible fixture window never replaces exact whole-bundle admission", () => {
  assert.throws(
    () => createLegacyClockAdapterV2(Buffer.from(syntheticClockModule)),
    /exact V1 bytes/u,
  );
  assert.throws(
    () => createLegacyClockAdapterV2(new Uint8Array()),
    /exact V1 bytes/u,
  );
});
