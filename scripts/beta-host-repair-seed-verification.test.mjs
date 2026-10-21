import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { parse } from "yaml";
import {
  closedHostRepairFailure,
  projectHostRepairObservation,
} from "./beta-host-repair-seed-verification.mjs";
const digest = (bytes) =>
  "sha256:" + createHash("sha256").update(bytes).digest("hex");
const bindings = {
  requestDigest: digest("request"),
  recipeDigest: digest("recipe"),
};
function invalid() {
  return {
    state: "failed",
    bindings,
    cleanup: "verified",
    reportDigest: digest("invalid"),
    steps: ["install", "lint", "typecheck"].map((step) => ({
      step,
      state: step === "typecheck" ? "failed" : "passed",
    })),
    artifacts: [],
    tests: [],
    findings: [],
    reproducibility: { state: "not-established" },
    diagnostics: [
      {
        code: "application.host-repair-seed.observed-ts2322",
        source: "typecheck",
        detail: "PRIVATE_TOOL_OUTPUT",
      },
    ],
  };
}
function positive() {
  return {
    state: "passed",
    bindings,
    cleanup: "verified",
    reportDigest: digest("positive"),
    steps: [
      "install",
      "lint",
      "typecheck",
      "unit-tests",
      "contract-tests",
      "dependency-scan",
      "secret-scan",
      "compile",
      "production-prune",
    ].map((step) => ({ step, state: "passed" })),
    artifacts: ["function.zip", "artifact-manifest.json", "sbom.cdx.json"].map(
      (path) => ({
        path,
        ownership: "host-synthetic-validation-artifact",
        checksum: digest("PRIVATE_ARTIFACT"),
        sizeBytes: Buffer.byteLength("PRIVATE_ARTIFACT"),
        bytesBase64: Buffer.from("PRIVATE_ARTIFACT").toString("base64"),
      }),
    ),
    tests: ["unit", "contract"].map((kind) => ({
      kind,
      state: "passed",
      passed: 1,
      failed: 0,
      skipped: 0,
    })),
    findings: [],
    diagnostics: [],
    reproducibility: {
      state: "verified",
      firstArchiveChecksum: digest("PRIVATE_ARTIFACT"),
      secondArchiveChecksum: digest("PRIVATE_ARTIFACT"),
    },
  };
}
test("observed fixed failure retains metadata and discards tool detail", () => {
  const result = projectHostRepairObservation(
    invalid(),
    bindings,
    "invalid-seed",
  );
  assert.equal(result.observedDefect, "TS2322");
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|diagnostics|detail/u);
});
test("only the exact observed defect after successful install and lint is admitted", () => {
  for (const mutate of [
    (r) => {
      r.diagnostics[0].code = "application.host-repair-seed.command-failed";
    },
    (r) => {
      r.steps[0].state = "failed";
    },
    (r) => {
      r.steps[2].state = "passed";
    },
    (r) => {
      r.state = "error";
    },
    (r) => {
      r.cleanup = "not-established";
    },
    (r) => {
      r.diagnostics.push(r.diagnostics[0]);
    },
    (r) => {
      r.bindings = { ...bindings, requestDigest: digest("different") };
    },
  ]) {
    const result = invalid();
    mutate(result);
    assert.throws(() =>
      projectHostRepairObservation(result, bindings, "invalid-seed"),
    );
  }
});
test("positive control retains actual byte commitments but no artifact content", () => {
  const raw = positive();
  const result = projectHostRepairObservation(
    raw,
    bindings,
    "positive-control",
  );
  assert.equal(result.artifacts.length, 3);
  assert.equal(result.tests.length, 2);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|bytesBase64/u);
});
test("incomplete execution, unequal output, corruption and scan failures cannot yield proof", () => {
  for (const mutate of [
    (r) => {
      r.steps[5].state = "skipped";
    },
    (r) => {
      r.tests[0].skipped = 1;
    },
    (r) => {
      r.tests[1].passed = 0;
    },
    (r) => {
      r.cleanup = "not-established";
    },
    (r) => {
      r.reproducibility.secondArchiveChecksum = digest("different");
    },
    (r) => {
      r.artifacts[0].bytesBase64 = Buffer.from("corrupt").toString("base64");
    },
    (r) => {
      r.artifacts[0].ownership = "generated";
    },
    (r) => {
      r.findings.push({ source: "dependency", severity: "high" });
    },
    (r) => {
      r.findings.push({ source: "secret", severity: "low" });
    },
    (r) => {
      r.diagnostics.push({ code: "PRIVATE" });
    },
  ]) {
    const result = positive();
    mutate(result);
    assert.throws(() =>
      projectHostRepairObservation(result, bindings, "positive-control"),
    );
  }
});
test("unknown failure payloads remain closed and cannot leak content", () => {
  assert.equal(
    JSON.parse(closedHostRepairFailure("invalid-seed")).phase,
    "invalid-seed",
  );
  for (const value of [
    "PRIVATE_TOOL_OUTPUT",
    { secret: "PRIVATE" },
    null,
    undefined,
  ]) {
    assert.equal(
      JSON.parse(closedHostRepairFailure(value)).phase,
      "public-preparation",
    );
    assert.doesNotMatch(closedHostRepairFailure(value), /PRIVATE|secret/u);
  }
});
test("native repair follows admission and actual memory proof and retains only its closed record", async () => {
  const workflow = parse(
    await readFile(
      new URL(
        "../.github/workflows/beta-memory-runner-verification.yml",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const steps = workflow.jobs.proof.steps;
  const bindings = steps.findIndex(
    (step) => step.name === "Validate image context bindings before builds",
  );
  const build = steps.findIndex(
    (step) => step.name === "Build the actual runner and fixed generator",
  );
  assert.ok(bindings >= 0 && bindings < build);
  assert.equal(
    steps[bindings].run,
    "node scripts/beta-image-contexts.mjs check",
  );
  assert.equal(steps[bindings].if, undefined);
  assert.equal(steps[bindings]["continue-on-error"], undefined);
  const memory = steps.findIndex(
    (step) => step.name === "Materialize verified public tool contexts",
  );
  const repair = steps.findIndex(
    (step) => step.name === "Execute actual memory and fixed-host proofs",
  );
  const upload = steps.findIndex((step) =>
    step.uses?.startsWith("actions/upload-artifact@"),
  );
  assert.ok(memory >= 0 && repair > memory && upload > repair);
  assert.equal(steps[repair].if, undefined);
  assert.equal(steps[repair]["continue-on-error"], undefined);
  assert.match(
    steps[repair].run,
    /ulimit -c 0[\s\S]*beta-host-repair-seed-verification.mjs/u,
  );
  assert.deepEqual(steps[upload].with.path.trim().split("\n"), [
    ".cache/beta-memory-proof/memory-application-observation.json",
    ".cache/beta-memory-proof/host-repair-observation.json",
  ]);
  assert.ok(
    workflow.on.pull_request.paths.includes(
      "scripts/beta-host-repair-seed-verification*.mjs",
    ),
  );
  assert.ok(
    workflow.on.pull_request.paths.includes(
      "apps/api/src/production-model-live-repair-seed*.ts",
    ),
  );
  assert.match(
    steps.find(
      (step) => step.name === "Build the actual runner and fixed generator",
    ).run,
    /@cloudmarkup\/api\.\.\./u,
  );
});

test("native failures distinguish admission, execution and projection with finite metadata", () => {
  for (const phase of [
    "request-admission",
    "execution",
    "result-admission",
    "observation",
  ]) {
    const name = "invalid-seed." + phase;
    assert.equal(JSON.parse(closedHostRepairFailure(name)).phase, name);
  }
  const raw = {
    state: "failed",
    cleanup: "verified",
    step: "typecheck",
    stepState: "failed",
    diagnostic: "application.host-repair-seed.command-failed",
    stdout: "PRIVATE_OUTPUT",
    files: [{ content: "PRIVATE_SOURCE" }],
  };
  const rendered = closedHostRepairFailure("invalid-seed.observation", raw);
  assert.deepEqual(JSON.parse(rendered).observation, {
    state: "failed",
    cleanup: "verified",
    step: "typecheck",
    stepState: "failed",
    diagnostic: "application.host-repair-seed.command-failed",
  });
  assert.doesNotMatch(rendered, /PRIVATE|stdout|files|content/u);
  // The CLI revalidates the closed record rather than trusting exception text.
  const parsed = JSON.parse(rendered);
  assert.equal(
    closedHostRepairFailure(parsed.phase, parsed.observation),
    rendered,
  );
});
test("arbitrary metadata and nested content cannot leave a failed native proof", () => {
  for (const raw of [
    null,
    "PRIVATE",
    {
      state: "PRIVATE",
      cleanup: { secret: "PRIVATE" },
      step: "PRIVATE",
      stepState: "PRIVATE",
      diagnostic: "PRIVATE",
    },
  ]) {
    const result = closedHostRepairFailure("PRIVATE", raw);
    assert.doesNotMatch(result, /PRIVATE|secret/u);
    assert.deepEqual(JSON.parse(result).observation, {
      state: "unclassified",
      cleanup: "unclassified",
      step: "unclassified",
      stepState: "unclassified",
      diagnostic: "unclassified",
    });
  }
});
