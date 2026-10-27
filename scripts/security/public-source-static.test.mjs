import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "yaml";

import {
  verifyGeneratedSourceSecurity,
  verifyIacSourceSecurity,
  verifyWorkflowSecurity,
} from "./static-verifier-core.mjs";

const templatePath =
  "packages/architecture-cli/templates/cloudmarkup-validate.yml";

test("public CI, native proof and the repository template have bounded read-only authority", () => {
  for (const path of [
    templatePath,
    ".github/workflows/public-ci.yml",
    ".github/workflows/public-native.yml",
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
  const scripts = JSON.parse(readFileSync("package.json", "utf8")).scripts;
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
