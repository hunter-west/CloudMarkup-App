"use strict";

const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const {
  chmodSync,
  copyFileSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const test = require("node:test");

const runtime = require("../service/runtime.cjs");

const contextRoot = join(__dirname, "..");
const reviewedLock = join(contextRoot, "offline", ".terraform.lock.hcl");

function fixtureRoot(
  content = 'terraform { required_version = ">= 1.13.0, < 2.0.0" }\n',
) {
  const root = mkdtempSync(join(tmpdir(), "cloudmarkup-tf-image-test-"));
  writeFileSync(join(root, "main.tf"), content, {
    encoding: "utf8",
    mode: 0o600,
  });
  copyFileSync(reviewedLock, join(root, ".terraform.lock.hcl"));
  return root;
}

function cleanup(root) {
  chmodSync(root, 0o700);
  rmSync(root, { force: true, recursive: true });
}

test("admits only the package runner's five exact command arrays", () => {
  assert.deepEqual(runtime.APPROVED_COMMANDS[3], {
    args: ["--chdir=.", "--format=json", "--no-color", "--force"],
    executable: "tflint",
    path: "/opt/cloudmarkup/tools/tflint",
  });
  assert.deepEqual(runtime.APPROVED_COMMANDS[4], {
    args: [
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
    ],
    executable: "trivy",
    path: "/opt/cloudmarkup/tools/trivy",
  });
  for (const command of runtime.APPROVED_COMMANDS) {
    assert.equal(
      runtime.selectApprovedCommand([command.executable, ...command.args]),
      command,
    );
  }
  for (const argv of [
    ["terraform", "apply"],
    ["terraform", "destroy"],
    ["terraform", "import", "x", "y"],
    ["terraform", "fmt;apply"],
    ["tflint", "--format=json", "--no-color", "--force", "."],
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
    ["sh", "-c", "terraform validate"],
  ]) {
    assert.throws(
      () => runtime.selectApprovedCommand(argv),
      (error) =>
        error instanceof runtime.ServiceError &&
        error.code === "invocation-forbidden",
    );
  }
  for (const requiredSafetyArgument of [
    "--disable-telemetry",
    "--skip-version-check",
    "--skip-check-update",
  ]) {
    const approved = runtime.APPROVED_COMMANDS[4];
    assert.throws(
      () =>
        runtime.selectApprovedCommand([
          approved.executable,
          ...approved.args.filter(
            (argument) => argument !== requiredSafetyArgument,
          ),
        ]),
      (error) =>
        error instanceof runtime.ServiceError &&
        error.code === "invocation-forbidden",
    );
  }
});

test("binds the exact Alpine runtime, signed offline packages, and package-manager removal", () => {
  const dockerfile = readFileSync(join(contextRoot, "Dockerfile"), "utf8");
  const apkInstallLines = dockerfile
    .replaceAll(/\\\r?\n/gu, " ")
    .split(/\r?\n/gu)
    .map((line) => line.trim().replaceAll(/\s+/gu, " "))
    .filter((line) => /(?:^|\s)(?:\S*\/)?apk add(?:\s|$)/u.test(line));
  for (const authority of [
    "COPY --chmod=0555 offline/bin/trivy /opt/cloudmarkup/tools/trivy",
    "node:24.18.0-alpine3.24@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd",
    '/sbin/apk info -e "libcrypto3=3.5.9-r0"',
    '/sbin/apk info -e "libssl3=3.5.9-r0"',
    "find /opt/cloudmarkup -xdev -type d -exec chmod 0555 {} +",
    'test "$(stat -c \'%a\' /opt/cloudmarkup)" = "555"',
    "test ! -e /usr/local/lib/node_modules/npm",
    "test ! -e /usr/local/bin/npm",
    "test ! -e /usr/local/bin/npx",
    "test ! -e /opt/yarn-v1.22.22",
    "test ! -e /usr/local/bin/yarn",
    "test ! -e /usr/local/bin/yarnpkg",
    "test ! -e /usr/local/bin/docker-entrypoint.sh",
  ]) {
    assert.ok(dockerfile.includes(authority));
  }
  assert.equal(apkInstallLines.length, 1);
  assert.match(
    apkInstallLines[0],
    /^RUN \/sbin\/apk add --no-network --no-cache --repositories-file \/dev\/null --no-scripts --upgrade \/tmp\/cloudmarkup-apk\/libcrypto3-3\.5\.9-r0\.apk \/tmp\/cloudmarkup-apk\/libssl3-3\.5\.9-r0\.apk(?=\s+&&)/u,
  );
  assert.doesNotMatch(dockerfile, /^FROM\s+--platform=/imu);
  assert.ok(!dockerfile.includes("--allow-untrusted"));

  const acquisition = JSON.parse(
    readFileSync(join(contextRoot, "offline", "acquisition-v1.json"), "utf8"),
  );
  assert.deepEqual(
    acquisition.artifacts.filter(
      ({ role }) => role === "alpine-runtime-package",
    ),
    [
      {
        type: "https-file",
        url: "https://dl-cdn.alpinelinux.org/alpine/v3.24/main/x86_64/libcrypto3-3.5.9-r0.apk",
        sha256:
          "6632d758d8f5e9ea3b650fe966f23bbf9a202f8b8dceecac93da135dec5e3689",
        sizeBytes: 1980198,
        destination: "offline/apk/libcrypto3-3.5.9-r0.apk",
        role: "alpine-runtime-package",
        executable: false,
      },
      {
        type: "https-file",
        url: "https://dl-cdn.alpinelinux.org/alpine/v3.24/main/x86_64/libssl3-3.5.9-r0.apk",
        sha256:
          "05e3393fb95aa5751ca2f9d242f659f6cff82c1cc7767cc2df4a086f7ad01877",
        sizeBytes: 381860,
        destination: "offline/apk/libssl3-3.5.9-r0.apk",
        role: "alpine-runtime-package",
        executable: false,
      },
    ],
  );
});

test("binds the reviewed provider package to exact h1 and zh lock hashes", () => {
  const index = JSON.parse(
    readFileSync(
      join(contextRoot, "offline", "provider-mirror", "index-v1.json"),
      "utf8",
    ),
  );
  const expectedHashes = [
    "h1:9cre7jh1lSs/9igpgAcENMUAUlYW3HCtkav3up4oit0=",
    "zh:4b357dfe4b820e3e4acd2881cff8288b2186491e63416751f0d12692ba478ceb",
  ];
  assert.deepEqual(index.providers[0].lockHashes, expectedHashes);
  const lock = readFileSync(reviewedLock, "utf8");
  for (const hash of expectedHashes) assert.ok(lock.includes(`"${hash}"`));
});

test("inspects an exact lock-bound regular Terraform tree", () => {
  const root = fixtureRoot();
  try {
    assert.deepEqual(runtime.inspectWorkspace(root, reviewedLock), {
      inputBytes:
        readFileSync(join(root, "main.tf")).byteLength +
        readFileSync(join(root, ".terraform.lock.hcl")).byteLength,
      inputFiles: 2,
      temporaryRoot: join(root, ".cloudmarkup-input-view"),
    });
  } finally {
    cleanup(root);
  }
});

test("rejects lock drift, unsafe names, links, hard links, and oversized input", () => {
  const cases = [];

  const drift = fixtureRoot();
  writeFileSync(join(drift, ".terraform.lock.hcl"), "changed\n");
  cases.push([drift, "lock-mismatch"]);

  const unsafe = fixtureRoot();
  writeFileSync(join(unsafe, "unsafe name.tf"), "terraform {}\n");
  cases.push([unsafe, "input-path-forbidden"]);

  const linked = fixtureRoot();
  try {
    symlinkSync(join(linked, "main.tf"), join(linked, "escape.tf"));
    cases.push([linked, "input-path-forbidden"]);
  } catch {
    cleanup(linked);
  }

  const hardLinked = fixtureRoot();
  try {
    linkSync(join(hardLinked, "main.tf"), join(hardLinked, "duplicate.tf"));
    cases.push([hardLinked, "input-path-forbidden"]);
  } catch {
    cleanup(hardLinked);
  }

  if (process.platform !== "win32") {
    const setId = fixtureRoot();
    chmodSync(join(setId, "main.tf"), 0o4600);
    cases.push([setId, "input-path-forbidden"]);
  }

  const oversized = fixtureRoot(
    "x".repeat(runtime.INPUT_LIMITS.maxFileBytes + 1),
  );
  cases.push([oversized, "input-limit-exceeded"]);

  for (const [root, code] of cases) {
    try {
      assert.throws(
        () => runtime.inspectWorkspace(root, reviewedLock),
        (error) => error instanceof runtime.ServiceError && error.code === code,
      );
    } finally {
      cleanup(root);
    }
  }
});

test("bounds generated directory entries independently of provider bytes", () => {
  const root = mkdtempSync(join(tmpdir(), "cloudmarkup-tf-entry-test-"));
  try {
    for (let index = 0; index < 9; index += 1) {
      mkdirSync(join(root, `directory-${String(index)}`));
    }
    assert.throws(
      () =>
        runtime.inspectTree(
          root,
          { maxFileBytes: 1, maxFiles: 1, maxTotalFileBytes: 1 },
          true,
        ),
      (error) =>
        error instanceof runtime.ServiceError &&
        error.code === "input-limit-exceeded",
    );
  } finally {
    cleanup(root);
  }
});

test("rejects backend, remote state, external execution, and credential assignment authority", () => {
  for (const content of [
    'terraform { backend "s3" {} }\n',
    'data "external" "command" { program = ["ignored"] }\n',
    'data "terraform_remote_state" "shared" { backend = "local" }\n',
    'provider "aws" { access_key = "constructed-at-runtime" }\n',
  ]) {
    const root = fixtureRoot(content);
    try {
      assert.throws(
        () => runtime.inspectWorkspace(root, reviewedLock),
        (error) =>
          error instanceof runtime.ServiceError &&
          error.code === "input-content-forbidden",
      );
    } finally {
      cleanup(root);
    }
  }
});

test("drops inherited environment and rejects credential or proxy names", () => {
  assert.equal(runtime.containsCredentialEnvironment({ PATH: "/safe" }), false);
  assert.equal(
    runtime.containsCredentialEnvironment({ AWS_PROFILE: "fixture" }),
    true,
  );
  assert.equal(
    runtime.containsCredentialEnvironment({ HTTPS_PROXY: "fixture" }),
    true,
  );
  assert.equal(
    runtime.containsCredentialEnvironment({ https_proxy: "fixture" }),
    true,
  );
  assert.equal(
    runtime.containsCredentialEnvironment({ TF_VAR_secret: "fixture" }),
    true,
  );
  const child = runtime.safeChildEnvironment();
  assert.equal(child.AWS_EC2_METADATA_DISABLED, "true");
  assert.equal(child.CHECKPOINT_DISABLE, "1");
  assert.equal(
    child.TF_CLI_CONFIG_FILE,
    "/opt/cloudmarkup/policy/terraform.rc",
  );
  assert.equal(child.TRIVY_CACHE_DIR, "/opt/cloudmarkup/trivy-cache");
  assert.equal(Object.hasOwn(child, "TRIVY_NO_PROGRESS"), false);
  assert.equal(Object.hasOwn(child, "TRIVY_SKIP_DB_UPDATE"), false);
  assert.equal(Object.hasOwn(child, "AWS_PROFILE"), false);
});

test("verifies exact file size, checksum, regularity, and link count", async () => {
  const root = mkdtempSync(join(tmpdir(), "cloudmarkup-tf-pin-test-"));
  const path = join(root, "tool");
  const bytes = Buffer.from("reviewed-bytes", "utf8");
  writeFileSync(path, bytes);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const record = {
    executable: true,
    path: "tool",
    role: "fixture",
    sha256,
    sizeBytes: bytes.length,
  };
  try {
    await runtime.verifyPinnedFile(root, record);
    writeFileSync(path, "changed");
    await assert.rejects(
      runtime.verifyPinnedFile(root, record),
      (error) =>
        error instanceof runtime.ServiceError &&
        error.code === "runtime-integrity-failed",
    );
  } finally {
    cleanup(root);
  }
});

test("structured errors are deterministic and do not echo untrusted values", () => {
  const first = runtime.canonicalServiceError(
    new runtime.ServiceError("credential-environment-forbidden", 65),
  );
  const second = runtime.canonicalServiceError(
    new runtime.ServiceError("credential-environment-forbidden", 65),
  );
  assert.equal(first, second);
  assert.deepEqual(JSON.parse(first), {
    code: "credential-environment-forbidden",
    contractVersion: 1,
    kind: "cloudmarkup.terraform-validation-service-error",
    message: "Credential and proxy environment variables are not accepted.",
  });
});

test("separates exact provider scratch from bounded customer input", () => {
  const providerExecutableBytes = 873_230_498;
  assert.ok(runtime.GENERATED_LIMITS.maxFileBytes >= providerExecutableBytes);
  assert.ok(
    runtime.GENERATED_LIMITS.maxTotalFileBytes > providerExecutableBytes,
  );
  assert.ok(runtime.INPUT_LIMITS.maxFileBytes < providerExecutableBytes);

  const root = mkdtempSync(join(tmpdir(), "cloudmarkup-tf-provider-test-"));
  try {
    const provider = join(root, "terraform-provider-aws_v6.63.0_x5");
    writeFileSync(provider, "");
    truncateSync(provider, providerExecutableBytes);
    assert.deepEqual(
      runtime.inspectTree(root, runtime.GENERATED_LIMITS, true),
      { fileCount: 1, totalBytes: providerExecutableBytes },
    );
  } finally {
    cleanup(root);
  }
});
