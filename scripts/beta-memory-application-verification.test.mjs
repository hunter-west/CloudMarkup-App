import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { parse } from "yaml";
import {
  exactMemoryImageReference,
  memoryProofArtifactPaths,
  requireMemoryProofObservation,
} from "./beta-memory-application-verification.mjs";

const digest = (value) => "sha256:" + value.repeat(64);
const expected = {
  requestDigest: digest("1"),
  solutionRevisionDigest: digest("2"),
  image: "memory-proof@" + digest("3"),
  helperDigest: digest("4"),
  artifactPaths: memoryProofArtifactPaths(
    "application/artifacts/notes/function.zip",
  ),
};
const observation = () => ({
  kind: "cloudmarkup.application-memory-runner-observation.v1",
  requestDigest: expected.requestDigest,
  solutionRevisionDigest: expected.solutionRevisionDigest,
  image: expected.image,
  helperDigest: expected.helperDigest,
  candidateBundleDigest: null,
  sourceTreeDigest: null,
  reports: [digest("5"), digest("6")],
  artifacts: expected.artifactPaths.map((path) => ({
    path,
    checksum: digest("7"),
    sizeBytes: 1234,
  })),
  exactCleanupVerified: true,
  reproducibleArtifactBytes: true,
});

test("local image IDs and mutable or ambiguous references cannot stand in for manifest identity", () => {
  const reference = "memory-proof@" + digest("a");
  assert.equal(
    exactMemoryImageReference(
      [{ Id: digest("b"), RepoDigests: [reference] }],
      "memory-proof",
    ),
    reference,
  );
  for (const RepoDigests of [
    [],
    ["memory-proof:latest"],
    ["wrong@" + digest("a")],
    [reference, reference],
    [42],
  ]) {
    assert.throws(() =>
      exactMemoryImageReference(
        [{ Id: digest("a"), RepoDigests }],
        "memory-proof",
      ),
    );
  }
  assert.throws(() =>
    exactMemoryImageReference([{ Id: digest("a") }], "memory-proof"),
  );
});

test("retained observations require both actual results, exact source bindings and verified cleanup", () => {
  assert.deepEqual(
    requireMemoryProofObservation(observation(), expected),
    observation(),
  );
  for (const field of [
    "requestDigest",
    "solutionRevisionDigest",
    "image",
    "helperDigest",
  ]) {
    assert.throws(() =>
      requireMemoryProofObservation(
        { ...observation(), [field]: digest("e") },
        expected,
      ),
    );
  }
  for (const patch of [
    { reports: [digest("5")] },
    { reports: [digest("5"), "unknown"] },
    { exactCleanupVerified: false },
    { reproducibleArtifactBytes: false },
    { artifacts: [] },
    { candidateBundleDigest: digest("a") },
    { sourceTreeDigest: digest("a") },
  ]) {
    assert.throws(() =>
      requireMemoryProofObservation({ ...observation(), ...patch }, expected),
    );
  }
});

test("source, package content, extra metadata and unsafe artifact paths are refused before retention", () => {
  for (const patch of [
    { prompt: "synthetic private prompt" },
    { stdout: "source body" },
    { files: [] },
  ]) {
    assert.throws(() =>
      requireMemoryProofObservation({ ...observation(), ...patch }, expected),
    );
  }
  for (const patch of [
    { bytesBase64: "c291cmNl" },
    { path: "../notes.zip" },
    { path: "a//notes.zip" },
    { path: "/notes.zip" },
    { path: "notes.ts" },
    { sizeBytes: 0 },
    { sizeBytes: 67108865 },
    { sizeBytes: 1.5 },
    { checksum: "unknown" },
  ]) {
    const value = observation();
    value.artifacts[0] = { ...value.artifacts[0], ...patch };
    assert.throws(() => requireMemoryProofObservation(value, expected));
  }
  const duplicate = observation();
  duplicate.artifacts.push({ ...duplicate.artifacts[0] });
  assert.throws(() => requireMemoryProofObservation(duplicate, expected));
});

const hostedPreparation =
  'set -euo pipefail\ntest "${GITHUB_ACTIONS:-}" = "true"\ntest "${RUNNER_ENVIRONMENT:-}" = "github-hosted"\ntest "${RUNNER_OS:-}" = "Linux"\ntest "${GITHUB_REPOSITORY:-}" = "hunter-west/CloudMarkup"\nsudo -n swapoff --all\nsudo -n sysctl -w kernel.core_pattern=core\nulimit -c 0\nnode --input-type=module -e "import { assertMemoryApplicationBuildHost } from \'./packages/application-build-runner/dist/index.js\'; await assertMemoryApplicationBuildHost();"\n';
function assertHostedPreparation(job) {
  assert.equal(job["runs-on"], "ubuntu-latest");
  assert.equal(job.env, undefined);
  assert.equal(job.container, undefined);
  const steps = job.steps.filter(
    (step) =>
      step.name === "Admit native Linux before public context acquisition",
  );
  assert.equal(steps.length, 1);
  assert.equal(steps[0].shell, "bash");
  assert.equal(steps[0].env, undefined);
  assert.equal(steps[0].if, undefined);
  assert.equal(steps[0]["continue-on-error"], undefined);
  assert.equal(steps[0].run, hostedPreparation);
  const index = job.steps.indexOf(steps[0]);
  for (const name of [
    "Enable local manifest references on the disposable runner",
    "Materialize verified public tool contexts",
    "Execute actual memory and fixed-host proofs",
  ])
    assert.ok(job.steps.findIndex((step) => step.name === name) > index);
  for (const step of job.steps)
    if (step !== steps[0])
      assert.doesNotMatch(
        JSON.stringify(step),
        /swapoff|swapon|sysctl|core_pattern|hibernat/iu,
      );
}

test("Linux proof workflow has read-only authority, preflight and one metadata-only artifact", async () => {
  const workflow = parse(
    await readFile(
      new URL(
        "../.github/workflows/beta-memory-runner-verification.yml",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.deepEqual(workflow.permissions, { contents: "read" });
  assert.equal(workflow.on.pull_request_target, undefined);
  assert.deepEqual(
    workflow.on.pull_request.paths.filter((path) => path.startsWith("!")),
    ["!packages/*/README.md", "!packages/*/AGENTS.md"],
  );
  assert.equal(workflow.on.workflow_run, undefined);
  const job = workflow.jobs.proof;
  assertHostedPreparation(job);
  assert.equal(job["timeout-minutes"], 45);
  assert.equal(job["runs-on"], "ubuntu-latest");
  assert.equal(job.environment, undefined);
  const cache = job.steps.find(
    (step) => step.name === "Restore hash-verified public Go tools",
  );
  assert.equal(
    cache.uses,
    "actions/cache@cdf6c1fa76f9f475f3d7449005a359c84ca0f306",
  );
  assert.deepEqual(Object.keys(cache.with).sort(), ["key", "path"]);
  assert.equal(cache.with.path, ".cache/reviewed-go-tools");
  assert.ok(
    cache.with.key.includes(
      "hashFiles('infra/images/go-tools/**', 'scripts/beta-go-tool-builds.mjs')",
    ),
  );

  assert.match(
    job.if,
    /github.event.pull_request.head.repo.full_name == github.repository/,
  );
  assert.equal(job.steps[0].with["persist-credentials"], false);
  for (const step of job.steps) {
    if (step.uses) assert.match(step.uses, /@[a-f0-9]{40}$/u);
    assert.doesNotMatch(
      JSON.stringify(step),
      /secrets\.|id-token|docker.sock|cdk deploy|aws-actions/iu,
    );
  }
  const preflight = job.steps.findIndex(
    (step) =>
      step.name === "Admit native Linux before public context acquisition",
  );
  const acquisition = job.steps.findIndex(
    (step) => step.name === "Materialize verified public tool contexts",
  );
  const execution = job.steps.findIndex(
    (step) => step.name === "Execute actual memory and fixed-host proofs",
  );
  assert.ok(
    preflight >= 0 && acquisition > preflight && execution > acquisition,
  );
  assert.match(
    job.steps[acquisition].run,
    /pnpm beta:image-contexts:archive:application /,
  );
  assert.match(
    job.steps[preflight].run,
    /ulimit -c 0[\s\S]*assertMemoryApplicationBuildHost/u,
  );
  assert.match(
    job.steps[execution].run,
    /ulimit -c 0[\s\S]*beta-host-repair-seed-verification.mjs/u,
  );
  const retention = job.steps.filter((step) =>
    step.uses?.startsWith("actions/upload-artifact@"),
  );
  assert.equal(retention.length, 1);
  assert.equal(retention[0].if, "${{ success() }}");
  assert.equal(
    retention[0].with.path,
    ".cache/beta-memory-proof/memory-application-observation.json\n.cache/beta-memory-proof/host-repair-observation.json\n",
  );
  assert.equal(retention[0].with["if-no-files-found"], "error");
});

test("exact runner sidecars are admitted but omissions and renamed or extra files are denied", () => {
  assert.deepEqual(expected.artifactPaths, [
    "application/artifacts/notes/function.zip",
    "application/artifacts/notes/artifact-manifest.json",
    "application/evidence/notes/sbom.cdx.json",
  ]);
  assert.deepEqual(
    requireMemoryProofObservation(observation(), expected),
    observation(),
  );
  const missing = observation();
  missing.artifacts.pop();
  assert.throws(() => requireMemoryProofObservation(missing, expected));
  const extra = observation();
  extra.artifacts.push({
    path: "application/source.ts",
    checksum: digest("8"),
    sizeBytes: 1,
  });
  assert.throws(() => requireMemoryProofObservation(extra, expected));
  for (const path of [
    "../function.zip",
    "application/artifacts/../notes/function.zip",
    "application/artifacts/notes/source.ts",
  ])
    assert.throws(() => memoryProofArtifactPaths(path));
});

test("failed real child process cannot echo captured stdout or stderr before sanitized failure", () => {
  const moduleUrl = new URL(
    "./beta-memory-application-verification.mjs",
    import.meta.url,
  ).href;
  const child =
    'process.stdout.write("PRIVATE_STDOUT_MARKER");process.stderr.write("PRIVATE_STDERR_MARKER");process.exit(7)';
  const source =
    "import { runMemoryProofCommand } from " +
    JSON.stringify(moduleUrl) +
    ';try {runMemoryProofCommand(process.execPath,["-e",' +
    JSON.stringify(child) +
    "]);process.exitCode=2;}catch(error){process.stdout.write(error.message)}";
  const actual = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", source],
    {
      encoding: "utf8",
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 10000,
    },
  );
  assert.equal(actual.status, 0);
  assert.equal(actual.stdout, "Native memory proof command failed.");
  assert.equal(actual.stderr, "");
  assert.doesNotMatch(
    actual.stdout + actual.stderr,
    /PRIVATE_(?:STDOUT|STDERR)_MARKER/u,
  );
});

test("host preparation rejects other machines, altered commands and late or bypassed admission", async () => {
  const workflow = parse(
    await readFile(
      new URL(
        "../.github/workflows/beta-memory-runner-verification.yml",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const base = workflow.jobs.proof;
  const mutations = [
    (job) => {
      job["runs-on"] = ["self-hosted", "linux"];
    },
    (job) => {
      job.env = { RUNNER_ENVIRONMENT: "github-hosted" };
    },
    (job) => {
      job.container = "ubuntu:latest";
    },
    (job, step) => {
      step.env = { GITHUB_ACTIONS: "true" };
    },
    (job, step) => {
      step.if = "always()";
    },
    (job, step) => {
      step["continue-on-error"] = true;
    },
    (job, step) => {
      step.run = step.run.replace(/test.*RUNNER_ENVIRONMENT.*\n/u, "");
    },
    (job, step) => {
      step.run = step.run.replace(
        "sudo -n swapoff --all",
        "sudo -n swapoff /swapfile",
      );
    },
    (job, step) => {
      step.run = step.run.replace(
        "kernel.core_pattern=core",
        "kernel.core_pattern=|capture",
      );
    },
    (job, step) => {
      step.run += "sudo -n swapon --all\n";
    },
    (job, step) => {
      step.run += "true || true\n";
    },
    (job, step) => {
      job.steps.push(structuredClone(step));
    },
    (job, step) => {
      job.steps.splice(job.steps.indexOf(step), 1);
      job.steps.push(step);
    },
    (job) => {
      job.steps.push({ name: "other", run: "sudo -n swapoff --all" });
    },
  ];
  for (const mutate of mutations) {
    const job = structuredClone(base);
    const step = job.steps.find(
      (value) =>
        value.name === "Admit native Linux before public context acquisition",
    );
    mutate(job, step);
    assert.throws(() => assertHostedPreparation(job));
  }
});
