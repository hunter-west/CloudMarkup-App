import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { parse } from "yaml";

import {
  verifyGeneratedSourceSecurity,
  verifyIacSourceSecurity,
  verifyWorkflowSecurity,
} from "./static-verifier-core.mjs";

const templatePath =
  "packages/architecture-cli/templates/cloudmarkup-validate.yml";
// In a hosted composition the root package is an intentional private override.
// Check the intake's original public commands, and fail if that source is absent.
const publicScripts = JSON.parse(
  readFileSync(
    existsSync(".github/workflows/ci.yml")
      ? ".cache/application-source-intake/source/package.json"
      : "package.json",
    "utf8",
  ),
).scripts;

test("public CI, native proof and the repository template have bounded read-only authority", () => {
  for (const path of [
    templatePath,
    ".github/workflows/public-ci.yml",
    ".github/workflows/public-native.yml",
    ".github/workflows/public-diagnostics.yml",
  ]) {
    const template = readFileSync(path, "utf8");
    assert.deepEqual(verifyWorkflowSecurity(path, template), []);
    const unpinned = template.replace(
      /actions\/checkout@[a-f0-9]{40}/u,
      "actions/checkout@v6",
    );
    assert.notEqual(unpinned, template);
    assert.ok(
      verifyWorkflowSecurity(path, unpinned).some(
        ({ code }) => code === "WORKFLOW_ACTION_NOT_PINNED",
      ),
    );
  }
});

test("native proofs run only for the published public main revision", () => {
  const source = readFileSync(".github/workflows/public-native.yml", "utf8");
  const workflow = parse(source);
  assert.deepEqual(workflow.on, { push: { branches: ["main"] } });
  assert.deepEqual(Object.keys(workflow.jobs), [
    "normalization",
    "memory",
    "package",
  ]);
  for (const job of Object.values(workflow.jobs)) {
    assert.equal(
      job.if,
      "github.repository == 'hunter-west/CloudMarkup-App' && github.ref == 'refs/heads/main' && github.event_name == 'push'",
    );
  }
  assert.doesNotMatch(
    source,
    /beta-application-source-intake\.mjs|GH_TOKEN|secrets\./u,
  );
});

test("public source checks retain PostgreSQL-backed model SQL and SDK contracts", () => {
  const workflow = parse(
    readFileSync(".github/workflows/public-ci.yml", "utf8"),
  );
  const scripts = publicScripts;
  const verify = workflow.jobs.verify;
  assert.match(verify.env.CLOUDMARKUP_TEST_DATABASE_URL, /^postgresql:\/\//u);
  assert.match(
    verify.services.postgres.image,
    /^postgres@sha256:[a-f0-9]{64}$/u,
  );
  assert.ok(
    verify.steps.some((step) =>
      String(step.run ?? "").includes("go -C services/iac-compiler build"),
    ),
  );
  assert.ok(verify.steps.some((step) => step.run === "pnpm check:public"));
  assert.ok(scripts["check:public:quality"].includes("pnpm security:audit"));
  assert.ok(scripts["check:public"].includes("pnpm test:public:backend"));
  assert.ok(scripts["test:public:backend"].startsWith("pnpm test:backend"));
  assert.ok(scripts["test:backend"].includes("--project=api"));
  for (const file of [
    "apps/api/src/production-model-live-execution-postgres.integration.test.ts",
    "apps/api/src/adapters/persistence/model-live-seed-stage-postgres.integration.test.ts",
  ]) {
    assert.doesNotMatch(
      scripts["test:public:backend"],
      new RegExp(file.replaceAll(".", "\\."), "u"),
    );
    assert.match(readFileSync(file, "utf8"), /(?:describe|it)\(/u);
  }
});

test("scheduled public coverage retains complete selection and run-bound diagnostic reports", () => {
  const path = ".github/workflows/public-diagnostics.yml";
  const original = parse(readFileSync(path, "utf8"));
  const scripts = publicScripts;
  const validate = (workflow, commands) => {
    assert.deepEqual(workflow.on, {
      schedule: [{ cron: "0 5 * * 1" }],
      workflow_dispatch: null,
    });
    assert.deepEqual(workflow.permissions, { contents: "read" });
    assert.deepEqual(Object.keys(workflow.jobs), ["coverage"]);
    const job = workflow.jobs.coverage;
    assert.equal(
      job.if,
      "github.repository == 'hunter-west/CloudMarkup-App' && github.ref == 'refs/heads/main' && (github.event_name == 'schedule' || github.event_name == 'workflow_dispatch')",
    );
    assert.equal(job["timeout-minutes"], 120);
    assert.equal(job["runs-on"], "ubuntu-latest");
    assert.equal(Object.hasOwn(job, "continue-on-error"), false);
    assert.equal(
      job.env.CLOUDMARKUP_TEST_DATABASE_URL,
      "postgresql://cloudmarkup:cloudmarkup-local-only@127.0.0.1:55432/cloudmarkup",
    );
    assert.match(
      job.services.postgres.image,
      /^postgres@sha256:[a-f0-9]{64}$/u,
    );
    assert.equal(
      Object.keys(job.env).some((key) => /DEFER|PROJECTS|EXCLUDE/u.test(key)),
      false,
    );
    assert.equal(
      commands["test:coverage"],
      "pnpm build && vitest run --coverage --maxWorkers=1 --testTimeout=30000 --hookTimeout=120000",
    );
    assert.equal(
      commands["test:public:coverage"],
      "pnpm test:coverage --exclude=**/beta-setup.test.ts --exclude=**/model-evaluation.e2e.test.ts --exclude=**/model-live-historical-importer-upgrade-postgres.integration.test.ts",
    );
    assert.equal(job.steps.length, 9);
    for (const step of job.steps)
      assert.equal(Object.hasOwn(step, "continue-on-error"), false);
    assert.equal(job.steps[0].with["persist-credentials"], false);
    const compiler = job.steps[5];
    assert.match(compiler.run, /go -C services\/iac-compiler build/u);
    assert.match(compiler.run, /CLOUDMARKUP_TEST_COMPILER_SHA256/u);
    const execution = job.steps[6];
    assert.equal(execution.id, "coverage");
    assert.equal(execution.run, "pnpm test:public:coverage");
    assert.equal(Object.hasOwn(execution, "if"), false);
    const bind = job.steps[7];
    assert.equal(bind.if, "always()");
    assert.deepEqual(bind.env, {
      SOURCE_REVISION: "${{ github.sha }}",
      RUN_ID: "${{ github.run_id }}",
      RUN_ATTEMPT: "${{ github.run_attempt }}",
      COVERAGE_OUTCOME: "${{ steps.coverage.outcome }}",
    });
    assert.match(bind.run, /coverage\/coverage-summary\.json/u);
    assert.match(bind.run, /createHash\("sha256"\)/u);
    assert.ok(bind.run.includes('COVERAGE_OUTCOME==="success")throw error'));
    const artifact = job.steps[8];
    assert.equal(artifact.if, "always()");
    assert.equal(
      artifact.with.name,
      "public-coverage-${{ github.sha }}-${{ github.run_id }}-${{ github.run_attempt }}",
    );
    assert.equal(
      artifact.with.path,
      "coverage/SOURCE.json\ncoverage/coverage-summary.json\n",
    );
    assert.equal(artifact.with["if-no-files-found"], "error");
    assert.equal(artifact.with["retention-days"], 7);
  };
  validate(original, scripts);
  const mutations = [
    (workflow) => {
      workflow.on.pull_request = null;
    },
    (workflow) => {
      workflow.jobs.coverage.if = "true";
    },
    (workflow) => {
      workflow.jobs.coverage.permissions = { contents: "write" };
    },
    (workflow) => {
      workflow.jobs.coverage.env.CLOUDMARKUP_TEST_DATABASE_URL = "";
    },
    (workflow) => {
      workflow.jobs.coverage.steps[5].run = "echo compiler omitted";
    },
    (workflow) => {
      workflow.jobs.coverage.steps[6].if = "false";
    },
    (workflow) => {
      workflow.jobs.coverage.steps[6]["continue-on-error"] = true;
    },
    (workflow) => {
      workflow.jobs.coverage.steps[7].env.RUN_ID = "previous-run";
    },
    (workflow) => {
      workflow.jobs.coverage.steps[8].with.name = "latest-coverage";
    },
    (workflow) => {
      workflow.jobs.coverage.steps[8].with["if-no-files-found"] = "ignore";
    },
  ];
  for (const mutate of mutations) {
    const workflow = structuredClone(original);
    mutate(workflow);
    assert.throws(() => {
      validate(workflow, scripts);
      assert.deepEqual(
        verifyWorkflowSecurity(path, JSON.stringify(workflow)),
        [],
      );
    });
  }
  for (const command of [
    "pnpm test:web --coverage",
    scripts["test:coverage"] + " --project=web",
    scripts["test:coverage"] + " || true",
  ]) {
    assert.throws(() =>
      validate(original, { ...scripts, "test:coverage": command }),
    );
  }
  const binding = original.jobs.coverage.steps[7].run.match(
    /node --input-type=module -e '([\s\S]+)'/u,
  )?.[1];
  assert.ok(binding);
  const directory = mkdtempSync(join(tmpdir(), "cloudmarkup-coverage-policy-"));
  const source = {
    SOURCE_REVISION: "a".repeat(40),
    RUN_ID: "123",
    RUN_ATTEMPT: "2",
  };
  const runBinding = (outcome) =>
    spawnSync(process.execPath, ["--input-type=module", "-e", binding], {
      cwd: directory,
      env: { ...process.env, ...source, COVERAGE_OUTCOME: outcome },
      encoding: "utf8",
    });
  try {
    assert.notEqual(runBinding("success").status, 0);
    assert.equal(existsSync(join(directory, "coverage/SOURCE.json")), false);
    assert.equal(runBinding("failure").status, 0);
    assert.equal(
      JSON.parse(readFileSync(join(directory, "coverage/SOURCE.json"))).outcome,
      "failure",
    );
    mkdirSync(join(directory, "coverage"), { recursive: true });
    const bytes = Buffer.from(
      JSON.stringify({ total: { lines: { total: 1, covered: 1 } } }),
    );
    writeFileSync(join(directory, "coverage/coverage-summary.json"), bytes);
    assert.equal(runBinding("success").status, 0);
    assert.deepEqual(
      JSON.parse(readFileSync(join(directory, "coverage/SOURCE.json"))),
      {
        format: "cloudmarkup-public-coverage-v1",
        sourceRevision: source.SOURCE_REVISION,
        runId: source.RUN_ID,
        runAttempt: source.RUN_ATTEMPT,
        outcome: "success",
        reportSha256: createHash("sha256").update(bytes).digest("hex"),
      },
    );
  } finally {
    assert.equal(dirname(directory), resolve(tmpdir()));
    assert.ok(
      directory.startsWith(
        join(resolve(tmpdir()), "cloudmarkup-coverage-policy-"),
      ),
    );
    rmSync(directory, { recursive: true, force: true });
  }
});

test("generated source still rejects command execution and hides secrets", () => {
  const secret = ["whsec", "C".repeat(24)].join("_");
  const findings = verifyGeneratedSourceSecurity(
    "generated/handler.ts",
    `import { exec } from "node:child_process";\nconst value = "${secret}";\n`,
  );
  assert.deepEqual(findings.map(({ code }) => code).sort(), [
    "GENERATED_SOURCE_PROCESS_EXECUTION",
    "GENERATED_SOURCE_SECRET_PATTERN",
  ]);
  assert.doesNotMatch(JSON.stringify(findings), new RegExp(secret, "u"));
});

test("generated Terraform still rejects arbitrary execution and credentials", () => {
  const findings = verifyIacSourceSecurity(
    "generated/main.tf",
    'provisioner "local-exec" { command = "echo unsafe" }\npassword = "embedded-value"\n',
  );
  assert.deepEqual(findings.map(({ code }) => code).sort(), [
    "IAC_ARBITRARY_EXECUTION_BLOCK",
    "IAC_EMBEDDED_CREDENTIAL",
  ]);
});
