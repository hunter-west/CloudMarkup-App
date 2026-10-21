import assert from "node:assert/strict";
import {
  link,
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { readTarArchive } from "./archive.mjs";
import {
  canonicalJson,
  EXACT_RUNTIME,
  MAXIMA,
  sanitizeToolText,
  sha256,
  validateRequest,
} from "./contract.mjs";
import { fixedEnvironment, FIXED_COMMANDS } from "./executor.mjs";
import { runApplicationBuildService } from "./application-build-service.mjs";

const packageJson = canonicalJson({
  dependencies: { "@aws-sdk/client-dynamodb": "3.1101.0" },
  devDependencies: {
    "@types/node": "24.13.3",
    typescript: "6.0.3",
    vitest: "4.1.10",
  },
  name: "cloudmarkup-generated-application",
  private: true,
  type: "module",
  version: "0.0.0",
});
const lockfile =
  "lockfileVersion: '9.0'\nsettings:\n  autoInstallPeers: false\n";
const source = "export const handler = async () => ({ statusCode: 200 });\n";
const unit =
  "import { test, expect } from 'vitest'; test('unit', () => expect(true).toBe(true));\n";
const contract =
  "import { test, expect } from 'vitest'; test('contract', () => expect(true).toBe(true));\n";
const tsconfig = canonicalJson({
  compilerOptions: {
    module: "NodeNext",
    moduleResolution: "NodeNext",
    outDir: "dist",
    strict: true,
    target: "ES2022",
  },
  include: ["src/**/*.ts", "tests/**/*.ts"],
});
const cleanTrivyReport = Object.freeze({
  ArtifactName: "application",
  ArtifactType: "filesystem",
  CreatedAt: "2026-09-02T01:57:12.779040484Z",
  ReportID: "01a05fd5-a7cb-7092-bf8d-234fe1e22631",
  SchemaVersion: 2,
  Trivy: Object.freeze({ Version: "0.74.0" }),
});

function writeOctal(buffer, offset, length, value) {
  const text = value.toString(8).padStart(length - 1, "0");
  buffer.write(text, offset, length - 1, "ascii");
  buffer[offset + length - 1] = 0;
}

function tar(entries) {
  const blocks = [];
  for (const entry of entries) {
    const bytes = Buffer.from(entry.content ?? "", "utf8");
    const header = Buffer.alloc(512);
    header.write(entry.path, 0, 100, "utf8");
    writeOctal(header, 100, 8, entry.mode ?? 0o600);
    writeOctal(header, 108, 8, 0);
    writeOctal(header, 116, 8, 0);
    writeOctal(header, 124, 12, bytes.length);
    writeOctal(header, 136, 12, 0);
    header.fill(32, 148, 156);
    header[156] = (entry.type ?? "0").codePointAt(0);
    header.write("ustar\0", 257, 6, "ascii");
    header.write("00", 263, 2, "ascii");
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    writeOctal(header, 148, 8, checksum);
    blocks.push(
      header,
      bytes,
      Buffer.alloc((512 - (bytes.length % 512)) % 512),
    );
  }
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}

function mediaType(path) {
  if (path.endsWith(".json")) return "application/json";
  if (path.endsWith(".ts")) return "text/typescript";
  return "text/yaml";
}

function fixture(overrides = {}) {
  const fixturePackageJson = overrides.packageContent ?? packageJson;
  const entries = overrides.entries ?? [
    { content: fixturePackageJson, path: "application/package.json" },
    { content: lockfile, path: "application/pnpm-lock.yaml" },
    { content: source, path: "application/src/index.ts" },
    { content: contract, path: "application/tests/contracts.test.ts" },
    { content: unit, path: "application/tests/unit.test.ts" },
    { content: tsconfig, path: "application/tsconfig.json" },
  ];
  const archive = tar(entries);
  const sourceFiles = entries
    .map((entry) => {
      const bytes = Buffer.from(entry.content ?? "", "utf8");
      return {
        mediaType: mediaType(entry.path),
        ownership: entry.ownership ?? "generated",
        path: entry.path,
        sha256: sha256(bytes),
        sizeBytes: bytes.length,
      };
    })
    .sort((left, right) => (left.path < right.path ? -1 : 1));
  const request = {
    contractVersion: 1,
    dependencyLock: {
      cacheDigest: sha256("offline-store"),
      lifecycleScripts: "deny",
      lockfilePath: "application/pnpm-lock.yaml",
      lockfileSha256: sha256(lockfile),
      network: "deny",
      packageManifestPath: "application/package.json",
      packageManifestSha256: sha256(fixturePackageJson),
    },
    kind: "cloudmarkup.application-build-executor-request",
    limits: {
      cpuSeconds: 60,
      maxFileBytes: 1024 * 1024,
      maxFiles: 1_000,
      maxOutputBytes: 64 * 1024,
      maxProcesses: 32,
      maxTotalFileBytes: 32 * 1024 * 1024,
      memoryMiB: 512,
      wallTimeMilliseconds: 30_000,
    },
    profileId: "cloudmarkup.application-build.generated-nodejs24",
    requestDigest: sha256("request"),
    runtime: { ...EXACT_RUNTIME },
    solutionRevisionDigest: sha256("revision"),
    solutionRevisionId: "revision_test",
    sourceArchive: {
      path: "application.tar",
      sha256: sha256(archive),
      sizeBytes: archive.length,
    },
    sourceFiles,
    workloadId: "workload_test",
    ...overrides.request,
  };
  return { archive, request };
}

function fakeRunner(failure, mutation) {
  return async ({ step, workspaceRoot }) => {
    if (failure?.step === step) {
      return {
        exitCode: failure.exitCode ?? 1,
        outputBytes: 16,
        stderr: failure.stderr ?? `${step} rejected the fixture`,
        stdout: failure.stdout ?? "",
        termination: failure.termination ?? "completed",
      };
    }
    const stdout =
      step === "unit-tests" || step === "contract-tests"
        ? JSON.stringify({ numFailedTests: 0, numPassedTests: 1 })
        : step === "dependency-scan" || step === "secret-scan"
          ? JSON.stringify({ ...cleanTrivyReport, Results: [] })
          : "";
    if (step === "production-prune") {
      await assert.rejects(lstat(workspaceRoot + "/application/node_modules"));
    }
    if (step === "install" || step === "production-prune") {
      await mkdir(`${workspaceRoot}/application/node_modules/runtime`, {
        recursive: true,
      });
      await writeFile(
        `${workspaceRoot}/application/node_modules/runtime/index.js`,
        "export const runtime = true;\n",
      );
    }
    if (
      step === "install" &&
      ["oversized-known", "oversized-unknown"].includes(mutation)
    ) {
      const directory =
        mutation === "oversized-known" ? "typescript/lib" : "runtime";
      await mkdir(workspaceRoot + "/application/node_modules/" + directory, {
        recursive: true,
      });
      await writeFile(
        workspaceRoot +
          "/application/node_modules/" +
          directory +
          "/typescript.js",
        Buffer.alloc(9144216, 120),
      );
    }
    if (step === "compile") {
      await mkdir(`${workspaceRoot}/application/dist`, { recursive: true });
      await writeFile(
        `${workspaceRoot}/application/dist/index.js`,
        "export const compiled = true;\n",
      );
    }
    if (
      new Set(["source", "failed-source"]).has(mutation) &&
      step === "unit-tests"
    ) {
      const path = `${workspaceRoot}/application/src/index.ts`;
      const bytes = await readFile(path);
      bytes[0] = (bytes[0] ?? 0) ^ 1;
      await writeFile(path, bytes);
    }
    if (mutation === "runtime" && step === "contract-tests") {
      await writeFile(
        `${workspaceRoot}/application/node_modules/runtime/index.js`,
        "export const runtime = 'unreviewed';\n",
      );
    }
    if (mutation === "unexpected" && step === "unit-tests") {
      await writeFile(
        `${workspaceRoot}/application/src/unreviewed.ts`,
        "export const unreviewed = true;\n",
      );
    }
    if (mutation === "hard-link" && step === "unit-tests") {
      await link(
        `${workspaceRoot}/application/src/index.ts`,
        `${workspaceRoot}/application/src/unreviewed-hard-link.ts`,
      );
    }
    if (mutation === "compiled" && step === "production-prune") {
      await writeFile(
        `${workspaceRoot}/application/dist/index.js`,
        "export const compiled = 'unreviewed';\n",
      );
    }
    if (mutation === "failed-source" && step === "unit-tests") {
      return {
        exitCode: 1,
        outputBytes: 0,
        stderr: "unit-tests rejected the fixture",
        stdout: "",
        termination: "completed",
      };
    }
    return {
      exitCode: 0,
      outputBytes: Buffer.byteLength(stdout),
      stderr: "",
      stdout,
      termination: "completed",
    };
  };
}

async function runFixture(overrides = {}, failure, mutation) {
  const root = await mkdtemp(join(tmpdir(), "cloudmarkup-app-image-test-"));
  const paths = {
    archive: join(root, "input", "application.tar"),
    input: join(root, "input", "application-build-request-v1.json"),
    output: join(root, "output", "application-build-result-v1.json"),
    outputRoot: join(root, "output"),
    workspace: join(root, "work"),
  };
  try {
    await mkdir(join(root, "input"));
    const value = fixture(overrides);
    await writeFile(paths.archive, value.archive);
    await writeFile(paths.input, canonicalJson(value.request));
    const outcome = await runApplicationBuildService({
      paths,
      runCommand: fakeRunner(failure, mutation),
      runtimeVersion: EXACT_RUNTIME.node,
    });
    let workspaceExists = true;
    try {
      await lstat(paths.workspace);
    } catch (error) {
      if (error?.code === "ENOENT") workspaceExists = false;
      else throw error;
    }
    return { ...outcome, workspaceExists };
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

test("accepts and executes the complete generated application sequence", async () => {
  const outcome = await runFixture();
  assert.equal(outcome.exitCode, 0, JSON.stringify(outcome.result));
  assert.equal(outcome.result.state, "passed");
  assert.equal(outcome.workspaceExists, false);
  assert.deepEqual(
    outcome.result.steps.map(({ step }) => step),
    Object.keys(FIXED_COMMANDS),
  );
});

for (const mutation of [
  "oversized-known",
  "oversized-unknown",
  "source",
  "runtime",
  "unexpected",
  "hard-link",
  "compiled",
]) {
  test(`fails closed on ${mutation} workspace authority mutation`, async () => {
    const outcome = await runFixture({}, undefined, mutation);
    assert.equal(outcome.exitCode, 2);
    assert.equal(outcome.result.state, "failed");
    assert.equal(outcome.result.steps.at(-1).state, "failed");
  });
}

test("inspects a failed-step mutation and removes the workspace", async () => {
  const outcome = await runFixture({}, undefined, "failed-source");
  assert.equal(outcome.exitCode, 2);
  assert.equal(outcome.result.state, "failed");
  assert.equal(outcome.result.steps.at(-1).step, "unit-tests");
  assert.equal(outcome.workspaceExists, false);
});

for (const [name, step] of [
  ["lint failure", "lint"],
  ["type failure", "typecheck"],
  ["unit test failure", "unit-tests"],
  ["contract test failure", "contract-tests"],
  ["compile failure", "compile"],
]) {
  test(`returns nonzero for ${name}`, async () => {
    const outcome = await runFixture({}, { step });
    assert.equal(outcome.exitCode, 2);
    assert.equal(outcome.result.state, "failed");
    assert.equal(outcome.result.steps.at(-1).step, step);
    assert.equal(
      outcome.result.diagnostics.at(-1).detail,
      `The fixed ${step} command exited with a non-zero status; raw tool output is not included.`,
    );
    assert.equal(
      canonicalJson(outcome.result).includes(`${step} rejected the fixture`),
      false,
    );
  });
}

test("does not persist a user-owned sibling sentinel emitted by an AI-authored test", async () => {
  const sentinel = "USER_OWNED_SIBLING_SENTINEL_6f3a";
  const outcome = await runFixture(
    {
      entries: [
        { content: packageJson, path: "application/package.json" },
        { content: lockfile, path: "application/pnpm-lock.yaml" },
        {
          content: `export const sibling = ${JSON.stringify(sentinel)};\n`,
          ownership: "user-owned",
          path: "application/src/sibling.ts",
        },
        { content: source, path: "application/src/index.ts" },
        { content: contract, path: "application/tests/contracts.test.ts" },
        {
          content: unit,
          ownership: "ai-authored",
          path: "application/tests/unit.test.ts",
        },
        { content: tsconfig, path: "application/tsconfig.json" },
      ],
      request: {
        profileId: "cloudmarkup.application-build.ai-assisted-custom-nodejs24",
      },
    },
    {
      exitCode: 1,
      stderr: `AI-authored test emitted ${sentinel}`,
      stdout: JSON.stringify({
        emitted: sentinel,
        numFailedTests: 1,
        numPassedTests: 0,
      }),
      step: "unit-tests",
    },
  );

  assert.equal(outcome.exitCode, 2);
  assert.equal(outcome.result.state, "failed");
  assert.equal(
    outcome.result.diagnostics.at(-1).detail,
    "The fixed unit-tests command exited with a non-zero status; raw tool output is not included.",
  );
  assert.equal(canonicalJson(outcome.result).includes(sentinel), false);
});

test("rejects path traversal and malicious filenames", () => {
  for (const path of [
    "application/../escape.ts",
    "application/run.sh",
    "application/.env",
  ]) {
    const value = fixture();
    value.request.sourceFiles[0] = { ...value.request.sourceFiles[0], path };
    assert.throws(
      () => validateRequest(value.request),
      /path|file type|forbidden/iu,
    );
  }
});

test("rejects archive traversal and symlink members", () => {
  const limits = fixture().request.limits;
  assert.throws(
    () =>
      readTarArchive(
        tar([{ content: "bad", path: "application/../escape.ts" }]),
        limits,
      ),
    /root|path/iu,
  );
  assert.throws(
    () =>
      readTarArchive(
        tar([
          {
            content: "target",
            path: "application/link.ts",
            type: "2",
          },
        ]),
        limits,
      ),
    /link|special/iu,
  );
});

test("rejects oversized and malformed manifests", () => {
  const oversized = fixture();
  oversized.request.sourceFiles[0].sizeBytes = MAXIMA.fileBytes + 1;
  assert.throws(() => validateRequest(oversized.request), /range/iu);
  assert.throws(() => validateRequest({ kind: "bad" }), /fields/iu);
});

test("rejects unsupported runtime and command-injection attempts", () => {
  const unsupported = fixture({
    request: { runtime: { ...EXACT_RUNTIME, node: "25.0.0" } },
  });
  assert.throws(() => validateRequest(unsupported.request), /unsupported/iu);
  const injected = fixture({
    request: { profileId: "generated-nodejs24; id" },
  });
  assert.throws(() => validateRequest(injected.request), /profileId/iu);
  assert.equal(FIXED_COMMANDS.install.args.includes("--offline"), true);
  for (const step of ["dependency-scan", "secret-scan"]) {
    assert.equal(FIXED_COMMANDS[step].args.includes("--offline-scan"), true);
    assert.equal(FIXED_COMMANDS[step].args.includes("--skip-db-update"), true);
    assert.equal(
      FIXED_COMMANDS[step].args.includes("--disable-telemetry"),
      true,
    );
    assert.equal(
      FIXED_COMMANDS[step].args.includes("--skip-version-check"),
      true,
    );
  }
  assert.equal(
    FIXED_COMMANDS.install.args.some((value) => /[;&|`$]/u.test(value)),
    false,
  );
});

test("fails closed when the offline dependency tool is unavailable", async () => {
  const outcome = await runFixture(
    {},
    {
      exitCode: null,
      step: "install",
      termination: "unavailable",
    },
  );
  assert.equal(outcome.exitCode, 2);
  assert.equal(outcome.result.steps[0].state, "unavailable");
});

test("rejects a missing required dependency", async () => {
  const missingDependency = canonicalJson({
    dependencies: {},
    devDependencies: {
      "@types/node": "24.13.3",
      typescript: "6.0.3",
      vitest: "4.1.10",
    },
    name: "cloudmarkup-generated-application",
    private: true,
    type: "module",
    version: "0.0.0",
  });
  const outcome = await runFixture({ packageContent: missingDependency });
  assert.equal(outcome.exitCode, 2);
  assert.match(outcome.result.diagnostics[0].detail, /dependencies/iu);
});

test("rejects scanner findings even when the scanner exits zero", async () => {
  const high = await runFixture(
    {},
    {
      exitCode: 0,
      step: "dependency-scan",
      stdout: JSON.stringify({
        ...cleanTrivyReport,
        Results: [
          {
            Vulnerabilities: [
              {
                Severity: "HIGH",
                VulnerabilityID: "CVE-2026-0001",
              },
            ],
          },
        ],
      }),
    },
  );
  assert.equal(high.exitCode, 2);
  assert.equal(high.result.steps.at(-1).state, "failed");
  const secret = await runFixture(
    {},
    {
      exitCode: 0,
      step: "secret-scan",
      stdout: JSON.stringify({
        ...cleanTrivyReport,
        Results: [{ Secrets: [{ RuleID: "fixture", Severity: "HIGH" }] }],
      }),
    },
  );
  assert.equal(secret.exitCode, 2);
  assert.equal(secret.result.steps.at(-1).state, "failed");
});

test("accepts valid nonblocking dependency findings", async () => {
  const outcome = await runFixture(
    {},
    {
      exitCode: 0,
      step: "dependency-scan",
      stdout: JSON.stringify({
        ...cleanTrivyReport,
        Results: [
          {
            Vulnerabilities: [
              {
                Severity: "LOW",
                VulnerabilityID: "CVE-2026-0002",
              },
            ],
          },
        ],
      }),
    },
  );
  assert.equal(outcome.exitCode, 0, JSON.stringify(outcome.result));
  assert.equal(outcome.result.state, "passed");
});

const cleanPnpmInventory = Object.freeze({
  Target: "pnpm-lock.yaml",
  Class: "lang-pkgs",
  Type: "pnpm",
  Packages: [
    {
      Name: "typescript",
      Version: "6.0.3",
      ID: "typescript@6.0.3",
      AnalyzedBy: "pnpm",
    },
  ],
});
for (const [name, report] of [
  [
    "clean pnpm inventory",
    { ...cleanTrivyReport, Results: [cleanPnpmInventory] },
  ],
  ["absent Results", cleanTrivyReport],
  ["null Results", { ...cleanTrivyReport, Results: null }],
]) {
  test(`accepts the exact pinned clean Trivy envelope with ${name}`, async () => {
    for (const step of ["dependency-scan", "secret-scan"]) {
      const outcome = await runFixture(
        {},
        {
          exitCode: 0,
          step,
          stdout: JSON.stringify(report),
        },
      );
      assert.equal(outcome.exitCode, 0, JSON.stringify(outcome.result));
      assert.equal(outcome.result.state, "passed");
    }
  });
}

for (const step of ["dependency-scan", "secret-scan"]) {
  const collection = step === "dependency-scan" ? "Vulnerabilities" : "Secrets";
  const identifier = step === "dependency-scan" ? "VulnerabilityID" : "RuleID";
  const malformedFinding =
    step === "dependency-scan"
      ? { Severity: "LOW" }
      : { RuleID: "fixture-without-severity" };
  for (const [name, stdout] of [
    ...[
      { ...cleanPnpmInventory, Target: "another-lock.yaml" },
      { ...cleanPnpmInventory, Packages: [] },
      { ...cleanPnpmInventory, Packages: [{}] },
      { ...cleanPnpmInventory, [collection]: null },
      { ...cleanPnpmInventory, [collection]: {} },
    ].map((result, index) => [
      "invalid clean inventory " + index,
      JSON.stringify({ ...cleanTrivyReport, Results: [result] }),
    ]),
    ["empty output", ""],
    ["empty object", JSON.stringify({})],
    [
      "wrong Results type",
      JSON.stringify({ ...cleanTrivyReport, Results: {} }),
    ],
    ["unbound null Results", JSON.stringify({ Results: null })],
    [
      "unexpected top-level field",
      JSON.stringify({
        ...cleanTrivyReport,
        Results: [],
        Unexpected: true,
      }),
    ],
    [
      "malformed result",
      JSON.stringify({ ...cleanTrivyReport, Results: [null] }),
    ],
    [
      "absent finding collection",
      JSON.stringify({ ...cleanTrivyReport, Results: [{}] }),
    ],
    [
      "wrong finding collection type",
      JSON.stringify({
        ...cleanTrivyReport,
        Results: [{ [collection]: {} }],
      }),
    ],
    [
      "non-object finding",
      JSON.stringify({
        ...cleanTrivyReport,
        Results: [{ [collection]: [null] }],
      }),
    ],
    [
      "malformed finding fields",
      JSON.stringify({
        ...cleanTrivyReport,
        Results: [{ [collection]: [malformedFinding] }],
      }),
    ],
  ]) {
    test(`fails closed on ${step} ${name}`, async () => {
      const outcome = await runFixture(
        {},
        {
          exitCode: 0,
          step,
          stdout,
        },
      );
      assert.equal(outcome.exitCode, 2);
      assert.equal(outcome.result.state, "failed");
      assert.equal(outcome.result.steps.at(-1).step, step);
      assert.equal(outcome.result.steps.at(-1).state, "failed");
      assert.match(outcome.result.diagnostics.at(-1).detail, /Trivy returned/u);
    });
  }

  const envelopePrefix = JSON.stringify(cleanTrivyReport).slice(0, -1);
  const collectionKey = JSON.stringify(collection);
  const finding = JSON.stringify({
    [identifier]: "fixture-duplicate-key",
    Severity: "CRITICAL",
  });
  const duplicateSeverityFinding = `{${JSON.stringify(identifier)}:"fixture-duplicate-key","Severity":"CRITICAL","Severity":"LOW"}`;
  for (const [name, stdout] of [
    [
      "duplicate Results key",
      `${envelopePrefix},"Results":[{${collectionKey}:[${finding}]}],"Results":[]}`,
    ],
    [
      `duplicate ${collection} key`,
      `${envelopePrefix},"Results":[{${collectionKey}:[${finding}],${collectionKey}:[]}]}`,
    ],
    [
      "duplicate Severity key",
      `${envelopePrefix},"Results":[{${collectionKey}:[${duplicateSeverityFinding}]}]}`,
    ],
  ]) {
    test(`fails closed on ${step} ${name}`, async () => {
      const outcome = await runFixture(
        {},
        {
          exitCode: 0,
          step,
          stdout,
        },
      );
      assert.equal(outcome.exitCode, 2);
      assert.equal(outcome.result.state, "failed");
      assert.equal(outcome.result.steps.at(-1).step, step);
      assert.equal(outcome.result.steps.at(-1).state, "failed");
      assert.equal(
        outcome.result.diagnostics.at(-1).detail,
        "Trivy returned malformed JSON.",
      );
    });
  }
}

test("network-denied install is fixed and cannot be selected by input", () => {
  assert.equal(FIXED_COMMANDS.install.args.includes("--trust-lockfile"), true);
  assert.deepEqual(
    FIXED_COMMANDS.install.args.filter(
      (value) => value.includes("offline") || value.includes("store"),
    ),
    [
      "--offline",
      "--store-dir",
      "/opt/cloudmarkup/pnpm-store",
      "--frozen-store",
    ],
  );
});

test("tool environment is fixed, scrubbed, and binds the frozen scanner database", () => {
  const environment = fixedEnvironment("/workspace/work");
  assert.equal(environment.TRIVY_CACHE_DIR, "/tmp/cloudmarkup-trivy-cache");
  assert.equal(environment.HOME, "/tmp/cloudmarkup-application-build-home");
  assert.equal(
    environment.PNPM_HOME,
    "/tmp/cloudmarkup-application-build-pnpm-home",
  );
  for (const name of [
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "HTTPS_PROXY",
    "NODE_OPTIONS",
  ]) {
    assert.equal(name in environment, false);
  }
});

test("redacts secret-shaped diagnostics without embedding a fixture secret", () => {
  const token = ["sk", "live", "abcdefghijklmno"].join("_");
  const output = sanitizeToolText(
    `failure ${token} C:\\Users\\person\\source.ts`,
  );
  assert.equal(output.includes(token), false);
  assert.match(output, /\[redacted-secret\]/u);
  assert.match(output, /\[redacted-path\]/u);
});

test("rejects a secret-shaped source value", () => {
  const accessKey = `AKIA${"A".repeat(16)}`;
  const value = fixture({
    entries: [
      {
        content: `export const value = ${JSON.stringify(accessKey)};`,
        path: "application/src/index.ts",
      },
    ],
  });
  assert.throws(
    () => readTarArchive(value.archive, value.request.limits),
    /secret/iu,
  );
});

test("returns byte-identical canonical results for repeated execution", async () => {
  const first = await runFixture();
  const second = await runFixture();
  assert.equal(canonicalJson(first.result), canonicalJson(second.result));
  assert.equal(first.result.reportDigest, second.result.reportDigest);
});

function paxPathRecord(path) {
  const body = ` path=${path}\n`;
  let size = Buffer.byteLength(body) + 1;
  while (String(size).length + Buffer.byteLength(body) !== size)
    size = String(size).length + Buffer.byteLength(body);
  return `${size}${body}`;
}
const longContractPath = `application/contracts/contract-${"a".repeat(160)}.json`;
const paxPlaceholder = (path) => `application/pax/${sha256(path).slice(7)}.txt`;
function extendedArchive(path, content = "{}", metadata = paxPathRecord(path)) {
  return tar([
    { path: paxPlaceholder(path), type: "x", content: metadata },
    { path: paxPlaceholder(path), content },
  ]);
}
test("preserves complete generated contract filenames through bounded path metadata", () => {
  const value = fixture();
  const files = readTarArchive(
    extendedArchive(longContractPath),
    value.request.limits,
  );
  assert.equal(files.length, 1);
  assert.equal(files[0].path, longContractPath);
  assert.equal(files[0].bytes.toString("utf8"), "{}");
  assert.equal(files[0].sha256, sha256("{}"));
});
for (const [name, metadata] of [
  ["wrong length", "1 path=" + longContractPath + "\n"],
  ["duplicate path", paxPathRecord(longContractPath).repeat(2)],
  ["size override", paxPathRecord(longContractPath) + "10 size=0\n"],
  ["link override", "19 linkpath=/etc/a\n"],
  ["traversal", paxPathRecord("application/../escape.json")],
  ["absolute", paxPathRecord("/application/escape.json")],
  ["nul", paxPathRecord(longContractPath + "\0extra")],
  ["oversize", "a".repeat(1025)],
])
  test(`rejects extended archive ${name}`, () => {
    assert.throws(() =>
      readTarArchive(
        extendedArchive(longContractPath, "{}", metadata),
        fixture().request.limits,
      ),
    );
  });
for (const type of ["x", "g", "5", "1", "2", "L", "S"])
  test(`rejects extended path followed by type ${type}`, () => {
    const path = paxPlaceholder(longContractPath);
    assert.throws(() =>
      readTarArchive(
        tar([
          { path, type: "x", content: paxPathRecord(longContractPath) },
          { path, type, content: "{}" },
        ]),
        fixture().request.limits,
      ),
    );
  });
test("rejects dangling, mismatched and colliding extended paths", () => {
  const path = paxPlaceholder(longContractPath);
  const metadata = {
    path,
    type: "x",
    content: paxPathRecord(longContractPath),
  };
  const limits = fixture().request.limits;
  assert.throws(() => readTarArchive(tar([metadata]), limits));
  assert.throws(() =>
    readTarArchive(
      tar([metadata, { path: "application/wrong.json", content: "{}" }]),
      limits,
    ),
  );
  assert.throws(() =>
    readTarArchive(
      tar([
        metadata,
        { path, content: "{}" },
        metadata,
        { path, content: "{}" },
      ]),
      limits,
    ),
  );
  const bad = extendedArchive(longContractPath);
  bad[512 + Buffer.byteLength(metadata.content)] = 1;
  assert.throws(() => readTarArchive(bad, limits));
});
