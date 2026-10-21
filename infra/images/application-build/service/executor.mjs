import { spawn } from "node:child_process";
import { readdir, lstat, readFile, rm } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

import { canonicalJson, sanitizeToolText, sha256 } from "./contract.mjs";

// Exact large files from the reviewed offline packages. Source and
// arbitrary dependency files retain the request limit; total workspace limits
// and subsequent byte-for-byte step guards still include these files.
const oversizedDependencyFiles = Object.freeze({
  "application/node_modules/@rolldown/binding-linux-x64-musl/rolldown-binding.linux-x64-musl.node":
    {
      sizeBytes: 19178416,
      sha256:
        "86bcac6023952131364d45bce9d4e3312b733044e8567f81d90ffe7587898797",
    },
  "application/node_modules/lightningcss-linux-x64-musl/lightningcss.linux-x64-musl.node":
    {
      sizeBytes: 10032056,
      sha256:
        "a5cf77ba1e47a5539987d569d973bc9389f8c2bb1522d36a3adf22c82afaa86d",
    },
  "application/node_modules/typescript/lib/typescript.js": {
    sizeBytes: 9144216,
    sha256: "569177652966bd528c319171c7dd22860dbf72bde116cbc4f644f1d02bb12e39",
  },
  "application/node_modules/typescript/lib/_tsc.js": {
    sizeBytes: 6239091,
    sha256: "1c59e77a54b186ec43fa7f3e0d3c4bb15ca5eb5ba43e96b1d3a267139eddd3e3",
  },
});

const TOOL_BIN = "/opt/cloudmarkup/bin";

export const FIXED_COMMANDS = Object.freeze({
  install: Object.freeze({
    args: Object.freeze([
      "install",
      "--dir",
      "application",
      "--offline",
      "--frozen-lockfile",
      "--ignore-scripts",
      "--strict-peer-dependencies",
      "--store-dir",
      "/opt/cloudmarkup/pnpm-store",
      "--ignore-workspace",
      "--ignore-pnpmfile",
      "--trust-lockfile",
      "--frozen-store",
      "--no-runtime",
      "--config.node-linker=hoisted",
      "--config.package-import-method=copy",
      "--config.bin-links=false",
      "--config.prefer-symlinked-executables=false",
      "--config.symlink=false",
    ]),
    executable: "pnpm",
  }),
  lint: Object.freeze({
    args: Object.freeze([
      "--config",
      "/opt/cloudmarkup/config/eslint.generated.mjs",
      "--no-cache",
      "--max-warnings",
      "0",
      "application/src",
      "application/tests",
    ]),
    executable: "eslint",
  }),
  typecheck: Object.freeze({
    args: Object.freeze(["--project", "application/tsconfig.json", "--noEmit"]),
    executable: "tsc",
  }),
  "unit-tests": Object.freeze({
    args: Object.freeze([
      "run",
      "unit.test.ts",
      "--reporter=json",
      "--no-cache",
      "--maxWorkers=1",
      "--no-file-parallelism",
      "--passWithNoTests=false",
    ]),
    executable: "vitest",
  }),
  "contract-tests": Object.freeze({
    args: Object.freeze([
      "run",
      "contracts.test.ts",
      "--reporter=json",
      "--no-cache",
      "--maxWorkers=1",
      "--no-file-parallelism",
      "--passWithNoTests=false",
    ]),
    executable: "vitest",
  }),
  "dependency-scan": Object.freeze({
    args: Object.freeze([
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
    ]),
    executable: "trivy",
  }),
  "secret-scan": Object.freeze({
    args: Object.freeze([
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
    ]),
    executable: "trivy",
  }),
  compile: Object.freeze({
    args: Object.freeze([
      "--project",
      "application/tsconfig.json",
      "--noEmit",
      "false",
      "--sourceMap",
      "false",
      "--declaration",
      "false",
    ]),
    executable: "tsc",
  }),
  "production-prune": Object.freeze({
    args: Object.freeze([
      "install",
      "--prod",
      "--dir",
      "application",
      "--offline",
      "--frozen-lockfile",
      "--ignore-scripts",
      "--strict-peer-dependencies",
      "--store-dir",
      "/opt/cloudmarkup/pnpm-store",
      "--ignore-workspace",
      "--ignore-pnpmfile",
      "--trust-lockfile",
      "--frozen-store",
      "--no-runtime",
      "--config.node-linker=hoisted",
      "--config.package-import-method=copy",
      "--config.bin-links=false",
      "--config.prefer-symlinked-executables=false",
      "--config.symlink=false",
    ]),
    executable: "pnpm",
  }),
});

const FULL_SEQUENCE = Object.freeze([
  "install",
  "lint",
  "typecheck",
  "unit-tests",
  "contract-tests",
  "dependency-scan",
  "secret-scan",
  "compile",
  "production-prune",
]);
const STATIC_SEQUENCE = Object.freeze([
  "lint",
  "typecheck",
  "dependency-scan",
  "secret-scan",
]);
const TRIVY_FINDING_SEVERITIES = new Set([
  "UNKNOWN",
  "LOW",
  "MEDIUM",
  "HIGH",
  "CRITICAL",
]);
const TRIVY_REPORT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const TRIVY_TIMESTAMP_PATTERN =
  /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{1,9}Z$/u;

function commandPath(executable) {
  return { argsPrefix: [], executable: `${TOOL_BIN}/${executable}` };
}

export function fixedEnvironment() {
  return Object.freeze({
    CI: "1",
    COREPACK_ENABLE_DOWNLOAD_PROMPT: "0",
    HOME: "/tmp/cloudmarkup-application-build-home",
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    NO_COLOR: "1",
    NPM_CONFIG_AUDIT: "false",
    NPM_CONFIG_FUND: "false",
    NPM_CONFIG_IGNORE_SCRIPTS: "true",
    PATH: "/opt/cloudmarkup/bin:/usr/local/bin:/usr/bin:/bin",
    PNPM_HOME: "/tmp/cloudmarkup-application-build-pnpm-home",
    SOURCE_DATE_EPOCH: "0",
    TZ: "UTC",
    TRIVY_CACHE_DIR: "/tmp/cloudmarkup-trivy-cache",
  });
}

async function liveContainerProcessIds() {
  if (process.platform !== "linux" || process.pid !== 1) {
    throw new TypeError(
      "Application build process supervision requires the isolated Linux container PID namespace.",
    );
  }
  const entries = await readdir("/proc", { withFileTypes: true });
  const output = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^[1-9][0-9]*$/u.test(entry.name)) continue;
    const pid = Number(entry.name);
    if (pid === process.pid) continue;
    try {
      const stat = await readFile(`/proc/${entry.name}/stat`, "utf8");
      const commandEnd = stat.lastIndexOf(")");
      const state =
        commandEnd < 0 ? "" : stat.slice(commandEnd + 2, commandEnd + 3);
      if (state !== "Z" && state !== "X") output.push(pid);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return output;
}

async function reapContainerProcesses() {
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const pids = await liveContainerProcessIds();
    if (pids.length === 0) return;
    for (const pid of pids) {
      try {
        process.kill(pid, "SIGKILL");
      } catch (error) {
        if (error?.code !== "ESRCH") throw error;
      }
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 5));
  }
  throw new TypeError(
    "Application build tool left a live process in the isolated container.",
  );
}

/** @internal Built-image PID-namespace regression seam. */
export async function reapContainerProcessesForTesting() {
  await reapContainerProcesses();
}

export function runFixedProcess({ command, limits, signal, workspaceRoot }) {
  return new Promise((resolveResult) => {
    const selected = commandPath(command.executable);
    const child = spawn(
      selected.executable,
      [...selected.argsPrefix, ...command.args],
      {
        cwd: workspaceRoot,
        detached: true,
        env: fixedEnvironment(),
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let outputBytes = 0;
    let stdout = "";
    let stderr = "";
    let termination = "completed";
    let settled = false;
    const finish = (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      resolveResult({ exitCode, outputBytes, stderr, stdout, termination });
    };
    const stop = (reason) => {
      if (settled) return;
      termination = reason;
      try {
        if (child.pid !== undefined) process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    };
    const append = (stream, chunk) => {
      outputBytes += chunk.byteLength;
      if (outputBytes > limits.maxOutputBytes) {
        stop("output-limit");
        return;
      }
      if (stream === "stdout") stdout += chunk.toString("utf8");
      else stderr += chunk.toString("utf8");
    };
    child.stdout.on("data", (chunk) => append("stdout", chunk));
    child.stderr.on("data", (chunk) => append("stderr", chunk));
    child.once("error", () => {
      termination = "unavailable";
      finish(null);
    });
    child.once("close", (code) => {
      void (async () => {
        try {
          if (child.pid !== undefined) process.kill(-child.pid, "SIGKILL");
        } catch {
          // The original process group is already gone.
        }
        try {
          await reapContainerProcesses();
          finish(code);
        } catch {
          termination = "unavailable";
          finish(null);
        }
      })();
    });
    const abort = () => stop("cancelled");
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted === true) abort();
    const timer = setTimeout(
      () => stop("timeout"),
      limits.wallTimeMilliseconds,
    );
    timer.unref();
  });
}

function within(root, candidate) {
  const local = relative(root, candidate);
  if (
    local === "" ||
    local.startsWith("..") ||
    resolve(root, local) !== candidate
  ) {
    throw new TypeError("Workspace path escaped its exact root.");
  }
  return local.split(sep).join("/");
}

function generatedPath(path, roots) {
  return roots.some((root) => path === root || path.startsWith(`${root}/`));
}

async function inspectWorkspace(root, limits) {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  if (entries.length > limits.maxFiles * 3) {
    throw new RangeError("Workspace entry limit exceeded.");
  }
  let files = 0;
  let bytes = 0;
  const directories = new Map();
  const authority = new Map();
  const identities = new Set();
  for (const entry of entries) {
    const path = resolve(entry.parentPath, entry.name);
    const relativePath = within(root, path);
    const portableIdentity = relativePath.normalize("NFC").toLowerCase();
    if (identities.has(portableIdentity)) {
      throw new TypeError("Workspace contains a portable path collision.");
    }
    identities.add(portableIdentity);
    const stats = await lstat(path);
    if (stats.isSymbolicLink() || (!stats.isFile() && !stats.isDirectory())) {
      throw new TypeError("Workspace contains a link or special file.");
    }
    if (
      process.platform !== "win32" &&
      (stats.mode & (stats.isFile() ? 0o6002 : 0o0002)) !== 0
    ) {
      throw new TypeError("Workspace contains an unsafe file mode.");
    }
    if (stats.isFile()) {
      if (stats.nlink !== 1) {
        throw new TypeError("Workspace contains a multiply linked file.");
      }
      files += 1;
      bytes += stats.size;
      const oversized = stats.size > limits.maxFileBytes;
      const pin = Object.hasOwn(oversizedDependencyFiles, relativePath)
        ? oversizedDependencyFiles[relativePath]
        : undefined;
      if (oversized && (pin === undefined || pin.sizeBytes !== stats.size))
        throw new RangeError("Workspace file byte limit exceeded.");
      const digest = sha256(await readFile(path));
      if (oversized && digest !== "sha256:" + pin.sha256)
        throw new TypeError(
          "Reviewed oversized dependency bytes do not match.",
        );
      authority.set(relativePath, {
        digest,
        mode: stats.mode & 0o7777,
        sizeBytes: stats.size,
      });
    } else {
      directories.set(relativePath, stats.mode & 0o7777);
    }
  }
  if (files > limits.maxFiles || bytes > limits.maxTotalFileBytes) {
    throw new RangeError("Workspace total size limit exceeded.");
  }
  return { directories, files: authority };
}

function assertFileAuthority(actual, expected) {
  if (
    actual?.digest !== expected.digest ||
    actual.mode !== expected.mode ||
    actual.sizeBytes !== expected.sizeBytes
  ) {
    throw new TypeError("Workspace changed an authority-bound file.");
  }
}

function assertWorkspaceAuthority(actual, source, generatedRoots) {
  for (const [path, mode] of source.directories) {
    if (actual.directories.get(path) !== mode) {
      throw new TypeError("Workspace changed an authority-bound directory.");
    }
  }
  for (const [path, expected] of source.files) {
    assertFileAuthority(actual.files.get(path), expected);
  }
  for (const path of actual.directories.keys()) {
    if (!source.directories.has(path) && !generatedPath(path, generatedRoots)) {
      throw new TypeError("Workspace added an unauthorized directory.");
    }
  }
  for (const path of actual.files.keys()) {
    if (!source.files.has(path) && !generatedPath(path, generatedRoots)) {
      throw new TypeError("Workspace added an unauthorized file.");
    }
  }
}

function subtreeAuthority(source, root) {
  return {
    directories: new Map(
      [...source.directories].filter(([path]) => generatedPath(path, [root])),
    ),
    files: new Map(
      [...source.files].filter(([path]) => generatedPath(path, [root])),
    ),
  };
}

function assertExactAuthority(actual, expected, root) {
  const current = subtreeAuthority(actual, root);
  if (
    current.directories.size !== expected.directories.size ||
    current.files.size !== expected.files.size
  ) {
    throw new TypeError("Generated tree changed outside its approved step.");
  }
  for (const [path, mode] of expected.directories) {
    if (current.directories.get(path) !== mode) {
      throw new TypeError(
        "Generated directory changed outside its approved step.",
      );
    }
  }
  for (const [path, entry] of expected.files) {
    assertFileAuthority(current.files.get(path), entry);
  }
}

function rejectDuplicateJsonKeys(value) {
  let index = 0;

  function skipWhitespace() {
    while (/\s/u.test(value[index] ?? "")) index += 1;
  }

  function parseString() {
    const start = index;
    index += 1;
    while (index < value.length) {
      if (value[index] === "\\") {
        index += 2;
        continue;
      }
      if (value[index] === '"') {
        index += 1;
        return JSON.parse(value.slice(start, index));
      }
      index += 1;
    }
    throw new TypeError();
  }

  function parseValue() {
    skipWhitespace();
    if (value[index] === "{") {
      parseObject();
      return;
    }
    if (value[index] === "[") {
      parseArray();
      return;
    }
    if (value[index] === '"') {
      parseString();
      return;
    }
    while (index < value.length && !/[\s,\]}]/u.test(value[index] ?? "")) {
      index += 1;
    }
  }

  function parseObject() {
    index += 1;
    skipWhitespace();
    if (value[index] === "}") {
      index += 1;
      return;
    }
    const keys = new Set();
    while (index < value.length) {
      skipWhitespace();
      if (value[index] !== '"') throw new TypeError();
      const key = parseString();
      if (keys.has(key)) throw new TypeError();
      keys.add(key);
      skipWhitespace();
      if (value[index] !== ":") throw new TypeError();
      index += 1;
      parseValue();
      skipWhitespace();
      if (value[index] === "}") {
        index += 1;
        return;
      }
      if (value[index] !== ",") throw new TypeError();
      index += 1;
    }
    throw new TypeError();
  }

  function parseArray() {
    index += 1;
    skipWhitespace();
    if (value[index] === "]") {
      index += 1;
      return;
    }
    while (index < value.length) {
      parseValue();
      skipWhitespace();
      if (value[index] === "]") {
        index += 1;
        return;
      }
      if (value[index] !== ",") throw new TypeError();
      index += 1;
    }
    throw new TypeError();
  }

  parseValue();
  skipWhitespace();
  if (index !== value.length) throw new TypeError();
}

function parseJsonOutput(value, label) {
  try {
    rejectDuplicateJsonKeys(value);
    const parsed = JSON.parse(value);
    if (parsed === null || typeof parsed !== "object") throw new TypeError();
    return parsed;
  } catch {
    throw new TypeError(`${label} returned malformed JSON.`);
  }
}

function validateTestOutput(value) {
  const parsed = parseJsonOutput(value, "Vitest");
  if (
    !Number.isSafeInteger(parsed.numPassedTests) ||
    parsed.numPassedTests < 1 ||
    !Number.isSafeInteger(parsed.numFailedTests) ||
    parsed.numFailedTests !== 0
  ) {
    throw new TypeError(
      "Vitest did not report a passing non-empty test suite.",
    );
  }
}

function jsonRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
  const actual = Object.keys(value);
  return (
    actual.length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function validPinnedTrivyReportEnvelope(value, hasResults) {
  const expectedKeys = [
    "ArtifactName",
    "ArtifactType",
    "CreatedAt",
    "ReportID",
    "SchemaVersion",
    "Trivy",
    ...(hasResults ? ["Results"] : []),
  ];
  return (
    jsonRecord(value) &&
    hasExactKeys(value, expectedKeys) &&
    value.SchemaVersion === 2 &&
    value.ArtifactName === "application" &&
    value.ArtifactType === "filesystem" &&
    typeof value.ReportID === "string" &&
    TRIVY_REPORT_ID_PATTERN.test(value.ReportID) &&
    typeof value.CreatedAt === "string" &&
    TRIVY_TIMESTAMP_PATTERN.test(value.CreatedAt) &&
    Number.isFinite(Date.parse(value.CreatedAt)) &&
    jsonRecord(value.Trivy) &&
    hasExactKeys(value.Trivy, ["Version"]) &&
    value.Trivy.Version === "0.74.0"
  );
}

function validateTrivyFinding(value, step) {
  if (!jsonRecord(value)) {
    throw new TypeError("Trivy returned a malformed finding entry.");
  }
  const identifier =
    step === "dependency-scan" ? value.VulnerabilityID : value.RuleID;
  const severity =
    typeof value.Severity === "string" ? value.Severity.toUpperCase() : "";
  if (
    typeof identifier !== "string" ||
    identifier.trim().length === 0 ||
    identifier.length > 512 ||
    !TRIVY_FINDING_SEVERITIES.has(severity)
  ) {
    throw new TypeError("Trivy returned a malformed finding entry.");
  }
  return severity;
}

function validateTrivyOutput(value, step) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError("Trivy returned empty JSON output.");
  }
  const parsed = parseJsonOutput(value, "Trivy");
  if (!jsonRecord(parsed)) {
    throw new TypeError("Trivy returned an invalid report object.");
  }
  const hasResults = Object.hasOwn(parsed, "Results");
  if (!validPinnedTrivyReportEnvelope(parsed, hasResults)) {
    throw new TypeError("Trivy returned an invalid report envelope.");
  }
  if (!hasResults || parsed.Results === null) {
    return;
  }
  if (!Array.isArray(parsed.Results)) {
    throw new TypeError("Trivy returned an invalid Results collection.");
  }
  const resultKey = step === "dependency-scan" ? "Vulnerabilities" : "Secrets";
  let blocking = false;
  for (const result of parsed.Results) {
    if (!jsonRecord(result)) {
      throw new TypeError("Trivy returned a malformed result entry.");
    }
    // The pinned pnpm analyzer omits empty finding lists while retaining its
    // nonempty package inventory. Admit only that observed report shape.
    if (
      !Object.hasOwn(result, resultKey) &&
      hasExactKeys(result, ["Target", "Class", "Type", "Packages"]) &&
      result.Target === "pnpm-lock.yaml" &&
      result.Class === "lang-pkgs" &&
      result.Type === "pnpm" &&
      Array.isArray(result.Packages) &&
      result.Packages.length > 0 &&
      result.Packages.every(
        (entry) =>
          jsonRecord(entry) &&
          typeof entry.Name === "string" &&
          entry.Name.length > 0 &&
          typeof entry.Version === "string" &&
          entry.Version.length > 0 &&
          entry.ID === entry.Name + "@" + entry.Version &&
          entry.AnalyzedBy === "pnpm",
      )
    )
      continue;
    const findings = result[resultKey];
    if (!Array.isArray(findings)) {
      throw new TypeError(`Trivy returned an invalid ${resultKey} collection.`);
    }
    for (const finding of findings) {
      const severity = validateTrivyFinding(finding, step);
      blocking ||=
        step === "secret-scan" ||
        severity === "HIGH" ||
        severity === "CRITICAL";
    }
  }
  if (step === "dependency-scan") {
    if (blocking)
      throw new TypeError("Trivy reported a high or critical vulnerability.");
    return;
  }
  if (blocking) throw new TypeError("Trivy reported a secret finding.");
}

function stateFor(result) {
  if (result.termination === "timeout") return "timeout";
  if (result.termination === "cancelled") return "cancelled";
  if (result.termination === "output-limit") return "output-limit";
  if (result.termination === "unavailable") return "unavailable";
  return result.exitCode === 0 ? "passed" : "failed";
}

function commandFailureDetail(step, result) {
  if (result.termination === "completed") {
    return `The fixed ${step} command exited with a non-zero status; raw tool output is not included.`;
  }
  return `The fixed ${step} command ended with ${result.termination}.`;
}

function diagnostic(step, result, detail) {
  return {
    code: `cloudmarkup.application-build.${step}-failed`,
    detail: sanitizeToolText(detail ?? commandFailureDetail(step, result)),
    source: step,
    summary: `The fixed ${step} validation step did not pass.`,
  };
}

export async function executeFixedSequence({
  request,
  runCommand = runFixedProcess,
  signal,
  workspaceRoot,
}) {
  const staticOnly = request.profileId.endsWith("user-source-static-nodejs24");
  const sequence = staticOnly ? STATIC_SEQUENCE : FULL_SEQUENCE;
  const steps = [];
  const diagnostics = [];
  const sourceAuthority = await inspectWorkspace(workspaceRoot, request.limits);
  let compiledAuthority;
  let installedAuthority;
  for (const step of sequence) {
    const command = FIXED_COMMANDS[step];
    if (step === "production-prune") {
      if (installedAuthority === undefined || compiledAuthority === undefined)
        throw new TypeError(
          "Production dependencies require a completed build.",
        );
      const current = await inspectWorkspace(workspaceRoot, request.limits);
      assertWorkspaceAuthority(current, sourceAuthority, [
        "application/node_modules",
        "application/dist",
      ]);
      assertExactAuthority(
        current,
        installedAuthority,
        "application/node_modules",
      );
      assertExactAuthority(current, compiledAuthority, "application/dist");
      // Reinstall the frozen production closure into an empty owned tree.
      // pnpm's incremental hoisted prune retains stale development shims.
      await rm(resolve(workspaceRoot, "application/node_modules"), {
        recursive: true,
        force: true,
      });
    }
    const result = await runCommand({
      command,
      limits: request.limits,
      signal,
      step,
      workspaceRoot,
    });
    const state = stateFor(result);
    steps.push({
      executable: command.executable,
      outputBytes: result.outputBytes,
      state,
      step,
    });
    try {
      if (
        state === "passed" &&
        (step === "unit-tests" || step === "contract-tests")
      ) {
        validateTestOutput(result.stdout);
      }
      if (
        state === "passed" &&
        (step === "dependency-scan" || step === "secret-scan")
      ) {
        validateTrivyOutput(result.stdout, step);
      }
      const workspace = await inspectWorkspace(workspaceRoot, request.limits);
      const generatedRoots = [
        ...(installedAuthority === undefined
          ? step === "install"
            ? ["application/node_modules"]
            : []
          : ["application/node_modules"]),
        ...(step === "compile" || compiledAuthority !== undefined
          ? ["application/dist"]
          : []),
      ];
      assertWorkspaceAuthority(workspace, sourceAuthority, generatedRoots);
      if (installedAuthority !== undefined && step !== "production-prune") {
        assertExactAuthority(
          workspace,
          installedAuthority,
          "application/node_modules",
        );
      }
      if (compiledAuthority !== undefined) {
        assertExactAuthority(workspace, compiledAuthority, "application/dist");
      }
      if (state === "passed" && step === "install") {
        installedAuthority = subtreeAuthority(
          workspace,
          "application/node_modules",
        );
        if (!installedAuthority.directories.has("application/node_modules")) {
          throw new TypeError(
            "Dependency installation produced no node_modules tree.",
          );
        }
      }
      if (
        state === "passed" &&
        step === "production-prune" &&
        !workspace.directories.has("application/node_modules")
      ) {
        throw new TypeError(
          "Production installation produced no node_modules tree.",
        );
      }
      if (state === "passed" && step === "compile") {
        compiledAuthority = subtreeAuthority(workspace, "application/dist");
        if (!compiledAuthority.directories.has("application/dist")) {
          throw new TypeError("Compilation produced no dist tree.");
        }
      }
    } catch (error) {
      diagnostics.push(
        diagnostic(
          step,
          result,
          error instanceof Error ? error.message : String(error),
        ),
      );
      steps[steps.length - 1] = { ...steps.at(-1), state: "failed" };
      return { diagnostics, state: "failed", steps };
    }
    if (state !== "passed") {
      diagnostics.push(diagnostic(step, result));
      return {
        diagnostics,
        state: state === "cancelled" ? "cancelled" : "failed",
        steps,
      };
    }
  }
  return { diagnostics, state: "passed", steps };
}

export function buildResult(request, execution) {
  const projection = {
    contractVersion: 1,
    diagnostics: execution.diagnostics,
    kind: "cloudmarkup.application-build-executor-result",
    profileId: request.profileId,
    requestDigest: request.requestDigest,
    solutionRevisionDigest: request.solutionRevisionDigest,
    state: execution.state,
    steps: execution.steps,
    workloadId: request.workloadId,
  };
  return { ...projection, reportDigest: sha256(canonicalJson(projection)) };
}
