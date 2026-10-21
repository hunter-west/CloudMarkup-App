import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const runtime = require("/opt/cloudmarkup/bin/runtime.cjs");
const service = "/opt/cloudmarkup/bin/terraform-validation-service";
const policyLock = "/opt/cloudmarkup/policy/.terraform.lock.hcl";
const fixtureRoot = "/opt/cloudmarkup/self-test/fixtures";
const workspace = "/workspace/infrastructure";
const tests = [];

const runtimeDirectories = [
  "/opt/cloudmarkup",
  "/opt/cloudmarkup/bin",
  "/opt/cloudmarkup/licenses",
  "/opt/cloudmarkup/policy",
  "/opt/cloudmarkup/provider-mirror",
  "/opt/cloudmarkup/schemas",
  "/opt/cloudmarkup/self-test",
  "/opt/cloudmarkup/tools",
  "/opt/cloudmarkup/trivy-cache",
];

function record(name, passed) {
  tests.push({ name, state: passed ? "passed" : "failed" });
}

function reset(name) {
  rmSync(workspace, { force: true, recursive: true });
  rmSync("/workspace/terraform-data", { force: true, recursive: true });
  mkdirSync(workspace, { recursive: true, mode: 0o700 });
  mkdirSync("/workspace/terraform-data", { recursive: true, mode: 0o700 });
  cpSync(join(fixtureRoot, name), workspace, { recursive: true });
  copyFileSync(policyLock, join(workspace, ".terraform.lock.hcl"));
}

record(
  "runtime-directories-traversable",
  runtimeDirectories.every((directory) => {
    try {
      const metadata = statSync(directory);
      return metadata.isDirectory() && (metadata.mode & 0o777) === 0o555;
    } catch {
      return false;
    }
  }),
);

function invoke(args, environment = process.env) {
  return spawnSync(service, args, {
    cwd: workspace,
    encoding: "utf8",
    env: environment,
    maxBuffer: 2 * 1024 * 1024,
    shell: false,
  });
}

const exactToolVersions = [
  ["/usr/local/bin/node", ["--version"], "v24.18.0"],
  ["/opt/cloudmarkup/tools/terraform", ["version"], "Terraform v1.16.2"],
  ["/opt/cloudmarkup/tools/tflint", ["--version"], "TFLint version 0.64.0"],
  ["/opt/cloudmarkup/tools/trivy", ["--version"], "Version: 0.74.0"],
].map(([executable, args, expected]) => {
  const result = spawnSync(executable, args, {
    encoding: "utf8",
    env: process.env,
    maxBuffer: 1024 * 1024,
    shell: false,
  });
  return (
    result.status === 0 &&
    result.stderr === "" &&
    result.stdout.trim().split(/\r?\n/u)[0] === expected
  );
});
record("exact-tool-versions", exactToolVersions.every(Boolean));

const exactAlpinePackages = [
  ["libcrypto3", "3.5.9-r0"],
  ["libssl3", "3.5.9-r0"],
].map(([name, version]) => {
  const result = spawnSync("/sbin/apk", ["info", "-e", `${name}=${version}`], {
    encoding: "utf8",
    env: process.env,
    maxBuffer: 1024 * 1024,
    shell: false,
  });
  return (
    result.status === 0 && result.stderr === "" && result.stdout.trim() === name
  );
});
record("exact-alpine-runtime-packages", exactAlpinePackages.every(Boolean));

record(
  "bundled-package-managers-removed",
  !existsSync("/usr/local/lib/node_modules/npm") &&
    !existsSync("/usr/local/bin/npm") &&
    !existsSync("/usr/local/bin/npx") &&
    !existsSync("/opt/yarn-v1.22.22") &&
    !existsSync("/usr/local/bin/yarn") &&
    !existsSync("/usr/local/bin/yarnpkg") &&
    !existsSync("/usr/local/bin/docker-entrypoint.sh"),
);

reset("accepted");
const acceptedTerraform = [
  ["terraform", "fmt", "-check", "-recursive", "-no-color", "."],
  [
    "terraform",
    "init",
    "-backend=false",
    "-get=false",
    "-input=false",
    "-lockfile=readonly",
    "-no-color",
  ],
  ["terraform", "validate", "-json", "-no-color"],
].map((args) => invoke(args));
record(
  "accepted-terraform",
  acceptedTerraform.every(({ status }) => status === 0),
);

const tflintResult = invoke([
  "tflint",
  "--chdir=.",
  "--format=json",
  "--no-color",
  "--force",
]);
let tflintOutput;
try {
  tflintOutput = JSON.parse(tflintResult.stdout);
} catch {
  tflintOutput = undefined;
}
record(
  "accepted-tflint",
  tflintResult.status === 0 &&
    tflintResult.stderr === "" &&
    Array.isArray(tflintOutput?.issues) &&
    tflintOutput.issues.length === 0 &&
    Array.isArray(tflintOutput?.errors) &&
    tflintOutput.errors.length === 0,
);

const trivyResult = invoke([
  "trivy",
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
]);
let trivyOutput;
try {
  trivyOutput = JSON.parse(trivyResult.stdout);
} catch {
  trivyOutput = undefined;
}
const trivyFinding = trivyOutput?.Results?.[0];
record(
  "accepted-trivy-offline",
  trivyResult.status === 0 &&
    trivyResult.stderr === "" &&
    trivyOutput?.SchemaVersion === 2 &&
    typeof trivyOutput?.CreatedAt === "string" &&
    trivyOutput.ArtifactName === "." &&
    trivyOutput.ArtifactType === "filesystem" &&
    Array.isArray(trivyOutput.Results) &&
    trivyOutput.Results.length === 1 &&
    trivyFinding?.Target === "." &&
    trivyFinding.Class === "config" &&
    trivyFinding.Type === "terraform" &&
    trivyFinding.MisconfSummary?.Successes === 51 &&
    trivyFinding.MisconfSummary?.Failures === 0,
);

const firstValidation = acceptedTerraform[2]?.stdout ?? "";
const repeatedValidation = invoke([
  "terraform",
  "validate",
  "-json",
  "-no-color",
]);
record(
  "reproducibility",
  repeatedValidation.status === 0 &&
    repeatedValidation.stdout === firstValidation,
);

reset("syntax-failure");
record(
  "syntax-failure",
  invoke(["terraform", "fmt", "-check", "-recursive", "-no-color", "."])
    .status !== 0,
);

reset("missing-provider");
record(
  "missing-provider-offline",
  invoke([
    "terraform",
    "init",
    "-backend=false",
    "-get=false",
    "-input=false",
    "-lockfile=readonly",
    "-no-color",
  ]).status !== 0,
);

reset("accepted");
for (const [name, args] of [
  ["apply-forbidden", ["terraform", "apply"]],
  ["destroy-forbidden", ["terraform", "destroy"]],
  ["import-forbidden", ["terraform", "import", "x", "y"]],
  ["command-injection-forbidden", ["terraform", "fmt;apply"]],
  [
    "legacy-tflint-invocation-forbidden",
    ["tflint", "--format=json", "--no-color", "--force", "."],
  ],
  [
    "legacy-trivy-invocation-forbidden",
    [
      "trivy",
      "config",
      "--format",
      "json",
      "--offline-scan",
      "--skip-db-update",
      "--exit-code",
      "0",
      "--no-progress",
      ".",
    ],
  ],
]) {
  const result = invoke(args);
  record(
    name,
    result.status === 64 && result.stderr.includes("invocation-forbidden"),
  );
}

reset("accepted");
writeFileSync(join(workspace, "backend.tf"), 'terraform { backend "s3" {} }\n');
record(
  "backend-authority-forbidden",
  invoke(["terraform", "fmt", "-check", "-recursive", "-no-color", "."])
    .status === 65,
);

reset("accepted");
writeFileSync(
  join(workspace, "remote-state.tf"),
  'data "terraform_remote_state" "shared" { backend = "local" }\n',
);
record(
  "remote-state-authority-forbidden",
  invoke(["terraform", "fmt", "-check", "-recursive", "-no-color", "."])
    .status === 65,
);

reset("accepted");
writeFileSync(join(workspace, "archive.zip"), "not-an-accepted-input");
record(
  "archive-input-forbidden",
  invoke(["terraform", "fmt", "-check", "-recursive", "-no-color", "."])
    .status === 65,
);

reset("accepted");
writeFileSync(join(workspace, "unsafe name.tf"), "terraform {}\n");
record(
  "malicious-filename",
  invoke(["terraform", "fmt", "-check", "-recursive", "-no-color", "."])
    .status === 65,
);

reset("accepted");
try {
  symlinkSync("/etc/passwd", join(workspace, "escape.tf"));
  record(
    "symlink-escape",
    invoke(["terraform", "fmt", "-check", "-recursive", "-no-color", "."])
      .status === 65,
  );
} catch {
  record("symlink-escape", false);
}

reset("accepted");
writeFileSync(
  join(workspace, "large.tf"),
  Buffer.alloc(runtime.INPUT_LIMITS.maxFileBytes + 1),
);
record(
  "oversized-input",
  invoke(["terraform", "fmt", "-check", "-recursive", "-no-color", "."])
    .status === 65,
);

reset("accepted");
rmSync(join(workspace, ".terraform.lock.hcl"));
writeFileSync(join(workspace, ".terraform.lock.hcl"), "drift\n");
record(
  "provider-lock-mismatch",
  invoke(["terraform", "fmt", "-check", "-recursive", "-no-color", "."])
    .status === 65,
);

reset("accepted");
const secretName = ["AWS", "ACCESS", "KEY", "ID"].join("_");
const secretValue = ["AK", "IA", "EXAMPLE", "ONLY"].join("");
const secretResult = invoke(
  ["terraform", "fmt", "-check", "-recursive", "-no-color", "."],
  { ...process.env, [secretName]: secretValue },
);
record(
  "credential-redaction",
  secretResult.status === 65 &&
    secretResult.stderr.includes("credential-environment-forbidden") &&
    !secretResult.stderr.includes(secretValue),
);

const state = tests.every(({ state: testState }) => testState === "passed")
  ? "passed"
  : "failed";
process.stdout.write(
  `${JSON.stringify({
    contractVersion: 1,
    kind: "cloudmarkup.terraform-validation-image-self-test-result",
    state,
    tests,
  })}\n`,
);
process.exitCode = state === "passed" ? 0 : 1;
