import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

const root = `/tmp/cloudmarkup-tool-self-test-${process.pid}`;
const application = join(root, "application");
const bin = "/opt/cloudmarkup/bin";
const reportIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const timestampPattern =
  /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{1,9}Z$/u;

const environment = Object.freeze({
  CI: "1",
  HOME: "/tmp",
  LANG: "C.UTF-8",
  LC_ALL: "C.UTF-8",
  NO_COLOR: "1",
  NPM_CONFIG_AUDIT: "false",
  NPM_CONFIG_FUND: "false",
  NPM_CONFIG_IGNORE_SCRIPTS: "true",
  PATH: `${bin}:/usr/local/bin:/usr/bin:/bin`,
  SOURCE_DATE_EPOCH: "0",
  TZ: "UTC",
  TRIVY_CACHE_DIR: "/tmp/cloudmarkup-trivy-cache",
});

function run(executable, args) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(executable, args, {
      cwd: root,
      env: environment,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let bytes = 0;
    const append = (stream, chunk) => {
      bytes += chunk.byteLength;
      if (bytes > 2 * 1024 * 1024) {
        child.kill("SIGKILL");
        reject(new RangeError("Tool self-test output exceeded 2 MiB."));
        return;
      }
      if (stream === "stdout") stdout += chunk.toString("utf8");
      else stderr += chunk.toString("utf8");
    };
    child.stdout.on("data", (chunk) => append("stdout", chunk));
    child.stderr.on("data", (chunk) => append("stderr", chunk));
    child.once("error", reject);
    child.once("close", (exitCode) =>
      resolveResult({ exitCode, stderr, stdout }),
    );
  });
}

async function expectExit(executable, args, expected, label) {
  const result = await run(executable, args);
  assert.equal(
    result.exitCode,
    expected,
    `${label}: ${result.stderr || result.stdout}`,
  );
  return result;
}

function assertEmptyTrivyReport(report, findingCollection) {
  assert.equal(report.SchemaVersion, 2);
  assert.deepEqual(Object.keys(report.Trivy), ["Version"]);
  assert.equal(report.Trivy.Version, "0.74.0");
  assert.match(report.ReportID, reportIdPattern);
  assert.match(report.CreatedAt, timestampPattern);
  assert.equal(Number.isFinite(Date.parse(report.CreatedAt)), true);
  assert.equal(report.ArtifactName, "application");
  assert.equal(report.ArtifactType, "filesystem");
  const hasResults = Object.hasOwn(report, "Results");
  assert.deepEqual(
    Object.keys(report).sort(),
    [
      "ArtifactName",
      "ArtifactType",
      "CreatedAt",
      "ReportID",
      "SchemaVersion",
      "Trivy",
      ...(hasResults ? ["Results"] : []),
    ].sort(),
  );
  if (!hasResults || report.Results === null) return;
  assert.equal(Array.isArray(report.Results), true);
  for (const result of report.Results) {
    assert.equal(
      typeof result === "object" && result !== null && !Array.isArray(result),
      true,
    );
    assert.equal(Array.isArray(result[findingCollection]), true);
    assert.equal(result[findingCollection].length, 0);
  }
}

async function main() {
  for (const directory of [
    "/opt/cloudmarkup",
    bin,
    "/opt/cloudmarkup/config",
    "/opt/cloudmarkup/pnpm-store",
    "/opt/cloudmarkup/service",
    "/opt/cloudmarkup/toolchain",
    "/opt/cloudmarkup/toolchain/bin",
    "/opt/cloudmarkup/toolchain/node_modules",
    "/opt/cloudmarkup/toolchain/pnpm-runtime",
    "/opt/cloudmarkup/trivy-cache",
    "/opt/cloudmarkup/trivy-cache/db",
  ]) {
    const metadata = await stat(directory);
    assert.equal(metadata.isDirectory(), true, directory);
    assert.equal(metadata.mode & 0o777, 0o555, directory);
  }
  await rm(root, { force: true, recursive: true });
  await mkdir(join(application, "src"), { recursive: true, mode: 0o700 });
  await mkdir(join(application, "tests"), { recursive: true, mode: 0o700 });
  await symlink(
    "/opt/cloudmarkup/toolchain/node_modules",
    join(application, "node_modules"),
    "dir",
  );
  await writeFile(
    join(application, "package.json"),
    `${JSON.stringify(
      {
        name: "cloudmarkup-application-image-self-test",
        private: true,
        type: "module",
        version: "0.0.0",
      },
      undefined,
      2,
    )}\n`,
  );
  await writeFile(
    join(application, "tsconfig.json"),
    `${JSON.stringify(
      {
        compilerOptions: {
          module: "NodeNext",
          moduleResolution: "NodeNext",
          outDir: "dist",
          strict: true,
          target: "ES2022",
          types: ["node"],
        },
        include: ["src/**/*.ts", "tests/**/*.ts"],
      },
      undefined,
      2,
    )}\n`,
  );
  const validSource =
    "export function add(left: number, right: number): number { return left + right; }\n";
  const validUnit =
    'import { expect, test } from "vitest"; import { add } from "../src/index.js"; test("unit", () => { expect(add(1, 2)).toBe(3); });\n';
  const validContract =
    'import { expect, test } from "vitest"; import { add } from "../src/index.js"; test("contract", () => { expect(add(2, 3)).toBe(5); });\n';
  const sourcePath = join(application, "src", "index.ts");
  const unitPath = join(application, "tests", "unit.test.ts");
  await writeFile(sourcePath, validSource);
  await writeFile(unitPath, validUnit);
  await writeFile(
    join(application, "tests", "contracts.test.ts"),
    validContract,
  );

  const pnpm = await expectExit(join(bin, "pnpm"), ["--version"], 0, "pnpm");
  assert.equal(pnpm.stdout.trim(), "11.16.0");
  await expectExit(
    join(bin, "eslint"),
    [
      "--config",
      "/opt/cloudmarkup/config/eslint.generated.mjs",
      "--no-cache",
      "--max-warnings",
      "0",
      "application/src",
      "application/tests",
    ],
    0,
    "eslint accepted fixture",
  );
  await expectExit(
    join(bin, "tsc"),
    ["--project", "application/tsconfig.json", "--noEmit"],
    0,
    "TypeScript accepted fixture",
  );
  await expectExit(
    join(bin, "vitest"),
    [
      "run",
      "unit.test.ts",
      "--reporter=json",
      "--maxWorkers=1",
      "--no-file-parallelism",
      "--passWithNoTests=false",
    ],
    0,
    "Vitest unit fixture",
  );
  await expectExit(
    join(bin, "vitest"),
    [
      "run",
      "contracts.test.ts",
      "--reporter=json",
      "--maxWorkers=1",
      "--no-file-parallelism",
      "--passWithNoTests=false",
    ],
    0,
    "Vitest contract fixture",
  );

  await writeFile(sourcePath, `${validSource}const unused = 1;\n`);
  await expectExit(
    join(bin, "eslint"),
    [
      "--config",
      "/opt/cloudmarkup/config/eslint.generated.mjs",
      "--no-cache",
      "--max-warnings",
      "0",
      "application/src",
      "application/tests",
    ],
    1,
    "ESLint negative fixture",
  );
  await writeFile(sourcePath, "export const value: string = 1;\n");
  await expectExit(
    join(bin, "tsc"),
    ["--project", "application/tsconfig.json", "--noEmit"],
    2,
    "TypeScript negative fixture",
  );
  await writeFile(sourcePath, validSource);
  await writeFile(
    unitPath,
    'import { expect, test } from "vitest"; test("failure", () => expect(false).toBe(true));\n',
  );
  await expectExit(
    join(bin, "vitest"),
    [
      "run",
      "unit.test.ts",
      "--reporter=json",
      "--maxWorkers=1",
      "--no-file-parallelism",
      "--passWithNoTests=false",
    ],
    1,
    "Vitest negative fixture",
  );
  await writeFile(unitPath, validUnit);
  await expectExit(
    join(bin, "tsc"),
    [
      "--project",
      "application/tsconfig.json",
      "--noEmit",
      "false",
      "--sourceMap",
      "false",
      "--declaration",
      "false",
    ],
    0,
    "TypeScript compile fixture",
  );
  const scan = await expectExit(
    join(bin, "trivy"),
    [
      "fs",
      "--scanners",
      "secret",
      "--offline-scan",
      "--skip-db-update",
      "--disable-telemetry",
      "--skip-version-check",
      "--format",
      "json",
      "--exit-code",
      "0",
      "--no-progress",
      "application",
    ],
    0,
    "Trivy offline fixture",
  );
  const scanResult = JSON.parse(scan.stdout);
  assertEmptyTrivyReport(scanResult, "Secrets");
  const vulnerabilityScan = await expectExit(
    join(bin, "trivy"),
    [
      "fs",
      "--scanners",
      "vuln",
      "--offline-scan",
      "--skip-db-update",
      "--disable-telemetry",
      "--skip-version-check",
      "--format",
      "json",
      "--exit-code",
      "0",
      "--no-progress",
      "application",
    ],
    0,
    "Trivy frozen vulnerability database fixture",
  );
  const vulnerabilityResult = JSON.parse(vulnerabilityScan.stdout);
  assertEmptyTrivyReport(vulnerabilityResult, "Vulnerabilities");
  await rm(root, { force: true, recursive: true });
}

await main();
