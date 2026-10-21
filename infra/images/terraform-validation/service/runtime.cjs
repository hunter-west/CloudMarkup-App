"use strict";

const { createHash } = require("node:crypto");
const {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
} = require("node:fs");
const { createReadStream } = require("node:fs");
const { spawn } = require("node:child_process");
const { relative, resolve, sep } = require("node:path");
const { TextDecoder } = require("node:util");

const CONTRACT_VERSION = 1;
const WORKSPACE_ROOT = "/workspace/infrastructure";
const POLICY_ROOT = "/opt/cloudmarkup/policy";
const TOOLS_ROOT = "/opt/cloudmarkup/tools";
const PROVIDER_MIRROR_ROOT = "/opt/cloudmarkup/provider-mirror";
const TRIVY_CACHE_ROOT = "/opt/cloudmarkup/trivy-cache";

const INPUT_LIMITS = Object.freeze({
  maxFileBytes: 4 * 1024 * 1024,
  maxFiles: 512,
  maxTotalFileBytes: 16 * 1024 * 1024,
});

const GENERATED_LIMITS = Object.freeze({
  maxFileBytes: 1024 * 1024 * 1024,
  maxFiles: 512,
  maxTotalFileBytes: 2 * 1024 * 1024 * 1024,
});

const APPROVED_COMMANDS = Object.freeze([
  Object.freeze({
    args: Object.freeze(["fmt", "-check", "-recursive", "-no-color", "."]),
    executable: "terraform",
    path: `${TOOLS_ROOT}/terraform`,
  }),
  Object.freeze({
    args: Object.freeze([
      "init",
      "-backend=false",
      "-get=false",
      "-input=false",
      "-lockfile=readonly",
      "-no-color",
    ]),
    executable: "terraform",
    path: `${TOOLS_ROOT}/terraform`,
  }),
  Object.freeze({
    args: Object.freeze(["validate", "-json", "-no-color"]),
    executable: "terraform",
    path: `${TOOLS_ROOT}/terraform`,
  }),
  Object.freeze({
    args: Object.freeze([
      "--chdir=.",
      "--format=json",
      "--no-color",
      "--force",
    ]),
    executable: "tflint",
    path: `${TOOLS_ROOT}/tflint`,
  }),
  Object.freeze({
    args: Object.freeze([
      "config",
      "--format",
      "json",
      "--exit-code",
      "0",
      "--quiet",
      "--disable-telemetry",
      "--skip-version-check",
      "--skip-check-update",
      ".",
    ]),
    executable: "trivy",
    path: `${TOOLS_ROOT}/trivy`,
  }),
]);

const ERROR_MESSAGES = Object.freeze({
  "credential-environment-forbidden":
    "Credential and proxy environment variables are not accepted.",
  "input-content-forbidden":
    "Terraform input contains a forbidden authority or sensitive assignment.",
  "input-limit-exceeded": "Terraform input exceeds its bounded limits.",
  "input-path-forbidden":
    "Terraform input contains an unsafe path or file type.",
  "invocation-forbidden":
    "Only the fixed static-validation commands are accepted.",
  "lock-mismatch":
    "The workspace provider lock does not match the reviewed image lock.",
  "runtime-integrity-failed":
    "A pinned offline runtime input failed integrity verification.",
  "runtime-user-forbidden": "The validation service must run as UID 65532.",
  "tool-unavailable": "A required pinned validation tool could not be started.",
  "workspace-forbidden": "Validation must run in the exact bounded workspace.",
});

class ServiceError extends Error {
  constructor(code, exitCode) {
    super(ERROR_MESSAGES[code]);
    this.name = "ServiceError";
    this.code = code;
    this.exitCode = exitCode;
  }
}

function serviceErrorRecord(error) {
  return {
    code: error.code,
    contractVersion: CONTRACT_VERSION,
    kind: "cloudmarkup.terraform-validation-service-error",
    message: ERROR_MESSAGES[error.code],
  };
}

function canonicalServiceError(error) {
  const record = serviceErrorRecord(error);
  return `${JSON.stringify({
    code: record.code,
    contractVersion: record.contractVersion,
    kind: record.kind,
    message: record.message,
  })}\n`;
}

function sameArguments(left, right) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function selectApprovedCommand(argv) {
  const [executable, ...args] = argv;
  const selected = APPROVED_COMMANDS.find(
    (candidate) =>
      candidate.executable === executable &&
      sameArguments(candidate.args, args),
  );
  if (selected === undefined)
    throw new ServiceError("invocation-forbidden", 64);
  return selected;
}

function containsCredentialEnvironment(environment) {
  const exact = new Set([
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "NO_PROXY",
    "TF_CLI_ARGS",
    "TF_PLUGIN_CACHE_DIR",
  ]);
  const prefixes = [
    "AWS_",
    "ARM_",
    "AZURE_",
    "CLOUDSDK_",
    "GOOGLE_",
    "HCLOUD_",
    "KUBE_",
    "TF_CLI_ARGS_",
    "TF_TOKEN_",
    "TF_VAR_",
  ];
  return Object.keys(environment).some((name) => {
    const normalized = name.toUpperCase();
    return (
      exact.has(normalized) ||
      prefixes.some((prefix) => normalized.startsWith(prefix))
    );
  });
}

function safeChildEnvironment() {
  return {
    AWS_EC2_METADATA_DISABLED: "true",
    CHECKPOINT_DISABLE: "1",
    HOME: "/tmp",
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    PATH: TOOLS_ROOT,
    TF_CLI_CONFIG_FILE: `${POLICY_ROOT}/terraform.rc`,
    TF_DATA_DIR: "/workspace/terraform-data",
    TF_IN_AUTOMATION: "1",
    TRIVY_CACHE_DIR: TRIVY_CACHE_ROOT,
    TZ: "UTC",
    XDG_CACHE_HOME: "/tmp/cache",
  };
}

function assertWithin(root, candidate) {
  const local = relative(root, candidate);
  if (local === "" || local.startsWith(`..${sep}`) || local === "..") {
    throw new ServiceError("input-path-forbidden", 65);
  }
}

function portablePath(value) {
  return value.split(sep).join("/").normalize("NFC");
}

function hclTokensOutsideComments(source) {
  const tokens = [];
  let current = "";
  let stringValue = "";
  let state = "code";
  const flush = () => {
    if (current.length > 0) {
      tokens.push({ kind: "identifier", value: current.toLowerCase() });
    }
    current = "";
  };
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (state === "line-comment") {
      if (character === "\n") state = "code";
      continue;
    }
    if (state === "block-comment") {
      if (character === "*" && next === "/") {
        state = "code";
        index += 1;
      }
      continue;
    }
    if (state === "string") {
      if (character === "\\") {
        index += 1;
      } else if (character === '"') {
        tokens.push({ kind: "string", value: stringValue.toLowerCase() });
        stringValue = "";
        state = "code";
      } else {
        stringValue += character;
      }
      continue;
    }
    if (character === "#" || (character === "/" && next === "/")) {
      flush();
      state = "line-comment";
      if (character === "/") index += 1;
      continue;
    }
    if (character === "/" && next === "*") {
      flush();
      state = "block-comment";
      index += 1;
      continue;
    }
    if (character === '"') {
      flush();
      state = "string";
      continue;
    }
    if (/[A-Za-z0-9_-]/u.test(character)) current += character;
    else flush();
  }
  flush();
  return tokens;
}

function identifiersOutsideStringsAndComments(source) {
  return hclTokensOutsideComments(source)
    .filter(({ kind }) => kind === "identifier")
    .map(({ value }) => value);
}

function inspectHclContent(content) {
  const tokens = hclTokensOutsideComments(content);
  const identifiers = new Set(
    tokens
      .filter(({ kind }) => kind === "identifier")
      .map(({ value }) => value),
  );
  const forbidden = [
    "access_key",
    "backend",
    "client_secret",
    "external",
    "local-exec",
    "password",
    "private_key",
    "provisioner",
    "remote-exec",
    "secret_key",
    "terraform_remote_state",
    "token",
  ];
  if (forbidden.some((identifier) => identifiers.has(identifier))) {
    throw new ServiceError("input-content-forbidden", 65);
  }
  for (let index = 0; index < tokens.length - 1; index += 1) {
    if (
      tokens[index]?.kind === "identifier" &&
      tokens[index]?.value === "data" &&
      tokens[index + 1]?.kind === "string" &&
      ["external", "terraform_remote_state"].includes(tokens[index + 1]?.value)
    ) {
      throw new ServiceError("input-content-forbidden", 65);
    }
  }
}

function inspectTree(root, limits, generated) {
  const seen = new Set();
  let entryCount = 0;
  let fileCount = 0;
  let totalBytes = 0;
  const visit = (directory) => {
    const entries = readdirSync(directory, { withFileTypes: true }).sort(
      (left, right) =>
        left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
    );
    for (const entry of entries) {
      entryCount += 1;
      if (entryCount > (limits.maxFiles + 1) * 4) {
        throw new ServiceError("input-limit-exceeded", 65);
      }
      const path = resolve(directory, entry.name);
      assertWithin(root, path);
      const stats = lstatSync(path);
      if (stats.isSymbolicLink() || (!stats.isDirectory() && !stats.isFile())) {
        throw new ServiceError("input-path-forbidden", 65);
      }
      const local = portablePath(relative(root, path));
      const key = local.toLowerCase();
      if (seen.has(key)) throw new ServiceError("input-path-forbidden", 65);
      seen.add(key);
      if (!/^[A-Za-z0-9._/-]+$/u.test(local)) {
        throw new ServiceError("input-path-forbidden", 65);
      }
      if (process.platform !== "win32" && (stats.mode & 0o6002) !== 0) {
        throw new ServiceError("input-path-forbidden", 65);
      }
      if (stats.isDirectory()) {
        visit(path);
        continue;
      }
      if (stats.nlink !== 1 || (stats.mode & 0o6000) !== 0) {
        throw new ServiceError("input-path-forbidden", 65);
      }
      fileCount += 1;
      totalBytes += stats.size;
      if (
        fileCount > limits.maxFiles ||
        stats.size > limits.maxFileBytes ||
        totalBytes > limits.maxTotalFileBytes
      ) {
        throw new ServiceError("input-limit-exceeded", 65);
      }
      if (!generated) {
        if (local !== ".terraform.lock.hcl" && !local.endsWith(".tf")) {
          throw new ServiceError("input-path-forbidden", 65);
        }
        if (local.endsWith(".tf")) {
          const bytes = readFileSync(path);
          let content;
          try {
            content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
          } catch {
            throw new ServiceError("input-content-forbidden", 65);
          }
          inspectHclContent(content);
        }
      }
    }
  };
  visit(root);
  return { fileCount, totalBytes };
}

function inspectWorkspace(root = WORKSPACE_ROOT, reviewedLockPath) {
  let canonicalRoot;
  try {
    canonicalRoot = realpathSync(root);
  } catch {
    throw new ServiceError("workspace-forbidden", 65);
  }
  if (canonicalRoot !== root) throw new ServiceError("workspace-forbidden", 65);
  const terraformDirectory = resolve(root, ".terraform");
  const entries = readdirSync(root, { withFileTypes: true });
  const inputRootEntries = entries.filter(
    (entry) => entry.name !== ".terraform",
  );
  const temporaryRoot = resolve(root, ".cloudmarkup-input-view");
  if (
    inputRootEntries.some((entry) => entry.name === ".cloudmarkup-input-view")
  ) {
    throw new ServiceError("input-path-forbidden", 65);
  }

  // Inspect admitted input directly without copying or following any link.
  let inputFiles = 0;
  let inputBytes = 0;
  let inputEntries = 0;
  const seen = new Set();
  const visitInput = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort(
      (left, right) =>
        left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
    )) {
      if (directory === root && entry.name === ".terraform") continue;
      inputEntries += 1;
      if (inputEntries > (INPUT_LIMITS.maxFiles + 1) * 4) {
        throw new ServiceError("input-limit-exceeded", 65);
      }
      const path = resolve(directory, entry.name);
      assertWithin(root, path);
      const stats = lstatSync(path);
      if (stats.isSymbolicLink() || (!stats.isDirectory() && !stats.isFile())) {
        throw new ServiceError("input-path-forbidden", 65);
      }
      const local = portablePath(relative(root, path));
      const key = local.toLowerCase();
      if (seen.has(key) || !/^[A-Za-z0-9._/-]+$/u.test(local)) {
        throw new ServiceError("input-path-forbidden", 65);
      }
      seen.add(key);
      if (process.platform !== "win32" && (stats.mode & 0o6002) !== 0) {
        throw new ServiceError("input-path-forbidden", 65);
      }
      if (stats.isDirectory()) {
        visitInput(path);
        continue;
      }
      if (stats.nlink !== 1) throw new ServiceError("input-path-forbidden", 65);
      inputFiles += 1;
      inputBytes += stats.size;
      if (
        inputFiles > INPUT_LIMITS.maxFiles + 1 ||
        stats.size > INPUT_LIMITS.maxFileBytes ||
        inputBytes > INPUT_LIMITS.maxTotalFileBytes + INPUT_LIMITS.maxFileBytes
      ) {
        throw new ServiceError("input-limit-exceeded", 65);
      }
      if (local !== ".terraform.lock.hcl" && !local.endsWith(".tf")) {
        throw new ServiceError("input-path-forbidden", 65);
      }
      if (local.endsWith(".tf")) {
        let content;
        try {
          content = new TextDecoder("utf-8", { fatal: true }).decode(
            readFileSync(path),
          );
        } catch {
          throw new ServiceError("input-content-forbidden", 65);
        }
        inspectHclContent(content);
      }
    }
  };
  visitInput(root);

  const workspaceLockPath = resolve(root, ".terraform.lock.hcl");
  try {
    if (
      !readFileSync(workspaceLockPath).equals(readFileSync(reviewedLockPath))
    ) {
      throw new ServiceError("lock-mismatch", 65);
    }
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    throw new ServiceError("lock-mismatch", 65);
  }

  if (entries.some((entry) => entry.name === ".terraform")) {
    inspectTree(terraformDirectory, GENERATED_LIMITS, true);
  }
  return { inputBytes, inputFiles, temporaryRoot };
}

function strictObject(value, requiredKeys) {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return false;
  const keys = Object.keys(value).sort();
  return (
    keys.length === requiredKeys.length &&
    requiredKeys
      .slice()
      .sort()
      .every((key, index) => key === keys[index])
  );
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new ServiceError("runtime-integrity-failed", 70);
  }
}

async function sha256File(path) {
  const digest = createHash("sha256");
  await new Promise((resolvePromise, rejectPromise) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => digest.update(chunk));
    stream.once("error", rejectPromise);
    stream.once("end", resolvePromise);
  });
  return digest.digest("hex");
}

async function verifyPinnedFile(root, record) {
  if (
    !strictObject(record, [
      "executable",
      "path",
      "role",
      "sha256",
      "sizeBytes",
    ]) ||
    typeof record.path !== "string" ||
    typeof record.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(record.sha256) ||
    !Number.isSafeInteger(record.sizeBytes) ||
    record.sizeBytes <= 0
  ) {
    throw new ServiceError("runtime-integrity-failed", 70);
  }
  const path = resolve(root, record.path);
  assertWithin(root, path);
  let stats;
  try {
    stats = lstatSync(path);
  } catch {
    throw new ServiceError("runtime-integrity-failed", 70);
  }
  if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1) {
    throw new ServiceError("runtime-integrity-failed", 70);
  }
  if (
    stats.size !== record.sizeBytes ||
    (await sha256File(path)) !== record.sha256
  ) {
    throw new ServiceError("runtime-integrity-failed", 70);
  }
}

async function verifyRuntimeIntegrity(options = {}) {
  const policyRoot = options.policyRoot ?? POLICY_ROOT;
  const toolsRoot = options.toolsRoot ?? TOOLS_ROOT;
  const mirrorRoot = options.mirrorRoot ?? PROVIDER_MIRROR_ROOT;
  const tools = readJson(resolve(policyRoot, "tool-binaries-v1.json"));
  const mirror = readJson(resolve(policyRoot, "provider-mirror-index-v1.json"));
  if (
    !strictObject(tools, ["contextId", "kind", "schemaVersion", "tools"]) ||
    tools.schemaVersion !== 1 ||
    tools.kind !== "cloudmarkup.terraform-validation-tools" ||
    tools.contextId !== "terraform-validation" ||
    !Array.isArray(tools.tools)
  ) {
    throw new ServiceError("runtime-integrity-failed", 70);
  }
  if (
    !strictObject(mirror, [
      "contextId",
      "kind",
      "lock",
      "providers",
      "schemaVersion",
      "terraformVersion",
    ]) ||
    mirror.schemaVersion !== 1 ||
    mirror.kind !== "cloudmarkup.terraform-provider-mirror" ||
    mirror.contextId !== "terraform-validation" ||
    mirror.terraformVersion !== "1.16.2" ||
    !Array.isArray(mirror.providers) ||
    mirror.providers.length !== 1
  ) {
    throw new ServiceError("runtime-integrity-failed", 70);
  }
  for (const tool of tools.tools) await verifyPinnedFile(toolsRoot, tool);
  const provider = mirror.providers[0];
  if (
    !strictObject(provider, [
      "lockHashes",
      "packagePath",
      "platform",
      "sha256",
      "sizeBytes",
      "source",
      "version",
    ]) ||
    provider.source !== "registry.terraform.io/hashicorp/aws" ||
    provider.version !== "6.63.0" ||
    provider.platform !== "linux_amd64" ||
    !Array.isArray(provider.lockHashes) ||
    JSON.stringify(provider.lockHashes) !==
      JSON.stringify([
        "h1:9cre7jh1lSs/9igpgAcENMUAUlYW3HCtkav3up4oit0=",
        `zh:${provider.sha256}`,
      ])
  ) {
    throw new ServiceError("runtime-integrity-failed", 70);
  }
  await verifyPinnedFile(mirrorRoot, {
    executable: false,
    path: provider.packagePath,
    role: "terraform-provider-package",
    sha256: provider.sha256,
    sizeBytes: provider.sizeBytes,
  });
}

function spawnApproved(command, options = {}) {
  const spawnImplementation = options.spawnImplementation ?? spawn;
  return new Promise((resolvePromise, rejectPromise) => {
    let child;
    try {
      child = spawnImplementation(command.path, command.args, {
        cwd: options.workspaceRoot ?? WORKSPACE_ROOT,
        env: safeChildEnvironment(),
        shell: false,
        stdio: "inherit",
      });
    } catch {
      rejectPromise(new ServiceError("tool-unavailable", 70));
      return;
    }
    const forward = (signal) => {
      if (child.exitCode === null && child.signalCode === null)
        child.kill(signal);
    };
    const terminate = () => forward("SIGTERM");
    const interrupt = () => forward("SIGINT");
    process.once("SIGTERM", terminate);
    process.once("SIGINT", interrupt);
    child.once("error", () => {
      process.removeListener("SIGTERM", terminate);
      process.removeListener("SIGINT", interrupt);
      rejectPromise(new ServiceError("tool-unavailable", 70));
    });
    child.once("exit", (code, signal) => {
      process.removeListener("SIGTERM", terminate);
      process.removeListener("SIGINT", interrupt);
      if (signal !== null) resolvePromise(70);
      else resolvePromise(code ?? 70);
    });
  });
}

async function run(options = {}) {
  const argv = options.argv ?? process.argv.slice(2);
  const command = selectApprovedCommand(argv);
  const uid =
    options.uid ??
    (typeof process.getuid === "function" ? process.getuid() : -1);
  if (uid !== 65532) throw new ServiceError("runtime-user-forbidden", 77);
  const environment = options.environment ?? process.env;
  if (containsCredentialEnvironment(environment)) {
    throw new ServiceError("credential-environment-forbidden", 65);
  }
  const workspaceRoot = options.workspaceRoot ?? WORKSPACE_ROOT;
  inspectWorkspace(
    workspaceRoot,
    options.reviewedLockPath ?? `${POLICY_ROOT}/.terraform.lock.hcl`,
  );
  const terraformDataRoot =
    options.terraformDataRoot ?? "/workspace/terraform-data";
  if (existsSync(terraformDataRoot)) {
    inspectTree(terraformDataRoot, GENERATED_LIMITS, true);
  }
  await verifyRuntimeIntegrity(options);
  return spawnApproved(command, { ...options, workspaceRoot });
}

module.exports = {
  APPROVED_COMMANDS,
  ERROR_MESSAGES,
  GENERATED_LIMITS,
  INPUT_LIMITS,
  ServiceError,
  canonicalServiceError,
  containsCredentialEnvironment,
  hclTokensOutsideComments,
  identifiersOutsideStringsAndComments,
  inspectHclContent,
  inspectTree,
  inspectWorkspace,
  run,
  safeChildEnvironment,
  selectApprovedCommand,
  serviceErrorRecord,
  sha256File,
  spawnApproved,
  strictObject,
  verifyPinnedFile,
  verifyRuntimeIntegrity,
};
