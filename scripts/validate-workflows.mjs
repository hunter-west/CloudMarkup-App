import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { parse } from "yaml";

import {
  BETA_DEPLOYMENT_WORKFLOW_PATH,
  assertHistoricalAiReceiptPreparation,
  validateBetaDeploymentWorkflowText,
} from "./beta-deployment-workflow-policy.mjs";

const workflowDirectory = resolve(".github", "workflows");
const reviewedCiPostgresImage =
  "postgres@sha256:18cfe3ef5e6815560c98237d6216d1e5119702fb0f3894c8785dd58b8bbe5d73";
const reviewedCiPostgresEnvironment = Object.freeze({
  POSTGRES_DB: "cloudmarkup",
  POSTGRES_PASSWORD: "cloudmarkup-local-only",
  POSTGRES_USER: "cloudmarkup",
});
const reviewedCiPostgresPort = "127.0.0.1:55432:5432";
const reviewedCiPostgresOptions =
  '--health-cmd "pg_isready -U cloudmarkup -d cloudmarkup" --health-interval 2s --health-timeout 5s --health-retries 30';
const reviewedCiDatabaseUrl =
  "postgresql://cloudmarkup:cloudmarkup-local-only@127.0.0.1:55432/cloudmarkup";
const workflowFiles = [
  ...(await readdir(workflowDirectory))
    .filter((fileName) => /\.ya?ml$/u.test(fileName))
    .sort()
    .map((fileName) => ({
      displayName: fileName,
      path: resolve(workflowDirectory, fileName),
    })),
  {
    displayName: "packages/architecture-cli/templates/cloudmarkup-validate.yml",
    path: resolve(
      "packages",
      "architecture-cli",
      "templates",
      "cloudmarkup-validate.yml",
    ),
  },
];

if (workflowFiles.length === 0) {
  throw new Error("No GitHub Actions workflow files were found.");
}

function assertReadOnlyPermissions(permissions, location) {
  if (
    typeof permissions !== "object" ||
    permissions === null ||
    Array.isArray(permissions)
  ) {
    throw new Error(`${location} permissions must be an explicit mapping.`);
  }

  for (const [permission, access] of Object.entries(permissions)) {
    if (access !== "read" && access !== "none") {
      throw new Error(
        `${location} grants ${permission}: ${String(access)}; only read or none is allowed.`,
      );
    }
  }
}

function isExactStringMapping(value, expected) {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === Object.keys(expected).length &&
    Object.entries(expected).every(([key, expectedValue]) => {
      return value[key] === expectedValue;
    })
  );
}

export function assertPullRequestQualityGate(workflow, fileName) {
  if (fileName !== "ci.yml") return;

  const triggers = workflow.on;
  if (
    typeof triggers !== "object" ||
    triggers === null ||
    Array.isArray(triggers) ||
    !("pull_request" in triggers)
  ) {
    throw new Error(
      "ci.yml must run the ordered repository quality gate on pull requests.",
    );
  }

  const qualityJob = workflow.jobs.quality;
  if (
    typeof qualityJob !== "object" ||
    qualityJob === null ||
    Array.isArray(qualityJob) ||
    !Array.isArray(qualityJob.steps)
  ) {
    throw new Error("ci.yml must define the ordered repository quality job.");
  }

  assertHistoricalAiReceiptPreparation(workflow, "quality");
  assertHistoricalAiReceiptPreparation(workflow, "tests");

  const postgresService = qualityJob.services?.postgres;
  if (
    typeof qualityJob.services !== "object" ||
    qualityJob.services === null ||
    Array.isArray(qualityJob.services) ||
    Object.keys(qualityJob.services).length !== 1 ||
    typeof postgresService !== "object" ||
    postgresService === null ||
    Array.isArray(postgresService) ||
    Object.keys(postgresService).length !== 4 ||
    postgresService.image !== reviewedCiPostgresImage ||
    !isExactStringMapping(postgresService.env, reviewedCiPostgresEnvironment) ||
    !Array.isArray(postgresService.ports) ||
    postgresService.ports.length !== 1 ||
    postgresService.ports[0] !== reviewedCiPostgresPort ||
    postgresService.options !== reviewedCiPostgresOptions
  ) {
    throw new Error(
      "ci.yml quality gate must use only the reviewed digest-pinned loopback PostgreSQL service with ephemeral test credentials and a bounded health check.",
    );
  }

  const command = "pnpm check:ci:quality";
  const matchingSteps = qualityJob.steps.filter(
    (step) =>
      typeof step === "object" &&
      step !== null &&
      !Array.isArray(step) &&
      step.run === command,
  );
  if (matchingSteps.length !== 1) {
    throw new Error(
      "ci.yml must run the exact ordered repository quality gate once.",
    );
  }

  const [qualityStep] = matchingSteps;
  if (
    qualityStep.id !== "quality" ||
    "uses" in qualityStep ||
    typeof qualityStep.env !== "object" ||
    qualityStep.env === null ||
    Array.isArray(qualityStep.env) ||
    !isExactStringMapping(qualityStep.env, {
      CLOUDMARKUP_TEST_DATABASE_URL: reviewedCiDatabaseUrl,
      NODE_OPTIONS: "--max-old-space-size=4096",
    })
  ) {
    throw new Error(
      "ci.yml ordered quality gate must be a local command with only the reviewed Node.js heap and loopback PostgreSQL test settings.",
    );
  }

  const equal = assert.deepEqual;
  equal(Object.keys(triggers).sort(), [
    "pull_request",
    "schedule",
    "workflow_call",
    "workflow_dispatch",
  ]);
  equal(triggers.pull_request, {
    types: [
      "opened",
      "synchronize",
      "reopened",
      "ready_for_review",
      "converted_to_draft",
    ],
  });
  equal(triggers.schedule, [{ cron: "0 5 * * 1" }]);
  equal(triggers.workflow_dispatch, null);
  equal(triggers.workflow_call, {
    inputs: {
      functional_beta: {
        description:
          "Require complete beta verification with bounded accounting checks and separate model composition tests.",
        type: "boolean",
        default: false,
      },
    },
  });
  equal(Object.keys(workflow.jobs).sort(), [
    "browser",
    "build",
    "changes",
    "documentation",
    "gate",
    "lint",
    "quality",
    "security",
    "tests",
  ]);
  const {
    tests,
    gate,
    browser,
    security,
    changes,
    documentation,
    lint,
    build,
  } = workflow.jobs;
  const scripts = JSON.parse(readFileSync("package.json", "utf8")).scripts;
  equal(scripts["check:ci"], "pnpm check:beta");
  equal(
    scripts["test:coverage"],
    "pnpm build && vitest run --coverage --maxWorkers=1 --testTimeout=30000 --hookTimeout=120000",
  );
  equal(tests.services, qualityJob.services);
  equal(tests.strategy, {
    "fail-fast": true,
    matrix: { shard: [1, 2, 3, 4, 5, 6, 7, 8] },
  });
  equal(tests["timeout-minutes"], 120);
  equal(
    tests.steps
      .slice(0, -4)
      .filter(
        (step) =>
          ![
            "Restore only this run's build cache",
            "Determine historical preparation for the selected shard",
            "Check out the exact historical AI receipt source",
            "Prepare the closed historical AI receipt bundle",
          ].includes(step.name),
      ),
    qualityJob.steps
      .filter(
        (step) => step.name !== "Verify affected self-host operator tooling",
      )
      .slice(0, -3)
      .filter(
        (step) =>
          ![
            "Restore only this run's build cache",
            "Materialize this run's production build outputs",
          ].includes(step.name),
      ),
  );
  equal(qualityJob.steps.at(-2), {
    name: "Run real-time SQL and SDK contracts without coverage",
    env: { CLOUDMARKUP_TEST_DATABASE_URL: reviewedCiDatabaseUrl },
    run: "pnpm test:beta:runtime",
  });
  equal(qualityJob.steps.at(-1), {
    name: "Collect scheduled build and performance diagnostics",
    if: "github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'",
    run: "pnpm storybook:build && pnpm performance:beta",
  });
  const expr = (value) => "$" + "{{ " + value + " }}";
  equal(
    scripts["test:self-host:tooling"],
    "node --test scripts/self-host/*.test.mjs",
  );
  equal(
    qualityJob.steps.filter(
      (step) => step.name === "Verify affected self-host operator tooling",
    ),
    [
      {
        name: "Verify affected self-host operator tooling",
        if: "needs.changes.outputs.self-host-tooling != 'false'",
        run: "pnpm test:self-host:tooling",
      },
    ],
  );
  equal(
    qualityJob.steps.at(-3).name,
    "Verify affected self-host operator tooling",
  );
  const onNormal =
    "github.event_name != 'schedule' && github.event_name != 'workflow_dispatch'";
  const onCoverage =
    "github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'";
  equal(tests.steps.at(-4).run, "pnpm build");
  equal(tests.steps.at(-3), {
    name: "Run selected tests without coverage instrumentation",
    if: onNormal,
    env: {
      NODE_OPTIONS: "--max-old-space-size=4096",
      CLOUDMARKUP_TEST_DATABASE_URL: reviewedCiDatabaseUrl,
      CLOUDMARKUP_TEST_PROJECTS: expr("needs.changes.outputs.test-projects"),
    },
    run:
      "node scripts/run-beta-tests.mjs suite --shard=" +
      expr("matrix.shard") +
      "/8",
  });
  equal(tests.steps.at(-2), {
    name: "Run the selected coverage profile in this isolated shard",
    if: onCoverage,
    id: "coverage",
    env: { ...qualityStep.env },
    run:
      "node scripts/run-beta-tests.mjs coverage --shard=" +
      expr("matrix.shard") +
      "/8",
  });
  equal(tests.steps.at(-1).if, onCoverage);
  equal(tests.steps.at(-1).with, {
    name: "coverage-shard-" + expr("matrix.shard"),
    path: ".cache/vitest-shards/",
    "if-no-files-found": "error",
    "retention-days": 7,
    "include-hidden-files": true,
    overwrite: true,
  });
  equal(gate.needs, [
    "changes",
    "documentation",
    "build",
    "lint",
    "quality",
    "tests",
    "browser",
    "security",
  ]);
  equal(gate.if, expr("!cancelled()"));
  for (const step of gate.steps.slice(2)) assert.equal(step.if, onCoverage);
  equal(gate.steps[0], qualityJob.steps[0]);
  equal(gate.steps[1], {
    name: "Require the complete selected verification profile",
    env: {
      RESULTS: expr("toJSON(needs)"),
      PULL_REQUEST_DRAFT: expr(
        "github.event_name == 'pull_request' && toJSON(github.event.pull_request.draft) || 'false'",
      ),
    },
    run: "node scripts/ci-change-scope.mjs gate",
  });
  const readyVerificationGuard =
    "github.event_name != 'pull_request' || toJSON(github.event.pull_request.draft) == 'false'";
  equal(changes, {
    name: "Classify verification scope",
    if: readyVerificationGuard,
    "runs-on": "ubuntu-latest",
    "timeout-minutes": 5,
    outputs: {
      "documentation-only": expr("steps.classify.outputs.documentation-only"),
      "test-projects": expr("steps.classify.outputs.test-projects"),
      "self-host-tooling": expr("steps.classify.outputs.self-host-tooling"),
    },
    steps: [
      {
        name: "Check out the exact candidate and history",
        uses: qualityJob.steps[0].uses,
        with: { "persist-credentials": false, "fetch-depth": 0 },
      },
      {
        name: "Classify complete candidate diff",
        id: "classify",
        env: {
          CLOUDMARKUP_FUNCTIONAL_BETA: expr(
            "inputs.functional_beta && 'true' || 'false'",
          ),
          BASE_SHA: expr(
            "github.event.pull_request.base.sha || github.event.before",
          ),
        },
        run: "node scripts/ci-change-scope.mjs",
      },
    ],
  });
  equal(scripts["check:ci:quality"], "pnpm check:beta:quality");
  equal(scripts["test:beta"], "node scripts/run-beta-tests.mjs suite");
  equal(
    scripts["test:beta:runtime"],
    "node scripts/run-beta-tests.mjs runtime",
  );
  const qualityCommands = scripts["check:beta:quality"].split(" && ");
  for (const required of [
    "pnpm type-check",
    "pnpm schema:check",
    "pnpm catalog:check",
    "pnpm eval:model:deterministic",
    "pnpm icons:test",
    "node scripts/check-provider-icons.mjs",
    "pnpm icons:check:bundle",
    "pnpm go:check",
    "pnpm cdk:synth",
    "pnpm ci:validate",
    "pnpm ci:validate:customer",
    "pnpm --filter @cloudmarkup/api-contract verify:openapi",
    "pnpm deployment-inputs:validate",
    "node --test scripts/update-generation-goldens.test.mjs",
  ])
    assert.ok(qualityCommands.includes(required), required);
  assert.equal(new Set(qualityCommands).size, qualityCommands.length);
  assert.equal(
    qualityCommands.includes("pnpm test:live-counted-execution"),
    false,
  );
  assert.equal(qualityCommands.includes("pnpm storybook:build"), false);
  equal(scripts.check, "pnpm check:beta");
  const betaCommands = scripts["check:beta"].split(" && ");
  for (const required of [
    "pnpm build",
    "pnpm format:check",
    "pnpm lint",
    "pnpm check:beta:quality",
    "pnpm test:beta",
    "pnpm test:beta:runtime",
    "pnpm test:e2e",
    "pnpm test:e2e:typed-backend",
    "pnpm test:e2e:solution-export",
    "pnpm security:check",
  ])
    assert.ok(betaCommands.includes(required), required);
  assert.equal(new Set(betaCommands).size, betaCommands.length);
  assert.equal(betaCommands.includes("pnpm test:coverage"), false);
  equal(
    lint.steps.slice(0, 4),
    qualityJob.steps.slice(0, 3).concat(qualityJob.steps[4]),
  );
  equal(lint.steps.slice(4), [
    {
      name: "Check formatting and all typed lint rules",
      env: { NODE_OPTIONS: "--max-old-space-size=4096" },
      run: "pnpm format:check && pnpm lint",
    },
  ]);
  equal(build.steps.slice(0, 4), lint.steps.slice(0, 4));
  equal(build["timeout-minutes"], 20);
  equal(build.steps.slice(4), [
    {
      name: "Build all workspace dependencies once",
      run: "pnpm build",
    },
    {
      name: "Share this run's source-bound build cache",
      uses: "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
      with: {
        name: "ci-build-cache",
        path: ".turbo/cache/",
        "if-no-files-found": "error",
        "retention-days": 1,
        "include-hidden-files": true,
        "compression-level": 0,
        overwrite: true,
      },
    },
  ]);
  for (const consumer of [tests, browser, qualityJob]) {
    equal(
      consumer.steps.filter(
        (step) => step.name === "Restore only this run's build cache",
      ).length,
      1,
    );
    const index = consumer.steps.findIndex(
      (step) => step.name === "Restore only this run's build cache",
    );
    equal(consumer.steps[index], {
      name: "Restore only this run's build cache",
      uses: "actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c",
      with: { name: "ci-build-cache", path: ".turbo/cache/" },
    });
    if (consumer === qualityJob) {
      equal(
        consumer.steps.filter(
          (step) =>
            step.name === "Materialize this run's production build outputs",
        ).length,
        1,
      );
      equal(consumer.steps[index + 1], {
        name: "Materialize this run's production build outputs",
        run: "pnpm build",
      });
      equal(consumer.steps[index + 2].run, "pnpm check:ci:quality");
    } else {
      assert.match(
        consumer.steps[index + 1].run,
        /^(?:pnpm build|pnpm exec turbo run build)/u,
      );
    }
  }
  equal(documentation.steps.slice(0, 3), security.steps.slice(0, 3));
  equal(documentation.steps.slice(3), [
    {
      name: "Install check dependencies without lifecycle scripts",
      run: "pnpm install --frozen-lockfile --ignore-scripts",
    },
    {
      name: "Verify documentation and workflow policy",
      run: "pnpm format:check && pnpm docs:links:check && pnpm ci:validate",
    },
  ]);
  equal(gate.steps.at(-4).with, {
    pattern: "coverage-shard-*",
    path: ".cache/vitest-shards",
    "merge-multiple": true,
  });
  equal(
    gate.steps.at(-3).run,
    'node -e \'const fs=require("node:fs");for(const n of [1,2,3,4,5,6,7,8])fs.accessSync(".cache/vitest-shards/report-"+n+".json")\'',
  );
  equal(
    gate.steps.at(-2).run,
    "pnpm exec vitest --merge-reports=.cache/vitest-shards --coverage --reporter=default",
  );
  equal(
    browser.steps.filter(
      (step) =>
        step.run ===
        "pnpm test:e2e && pnpm test:e2e:typed-backend && pnpm test:e2e:solution-export",
    ).length,
    1,
  );
  equal(
    security.steps.filter((step) => step.run === "pnpm security:check").length,
    1,
  );
  for (const [name, job] of Object.entries(workflow.jobs)) {
    assert.ok(!Object.hasOwn(job, "continue-on-error"));
    assert.ok(!Object.hasOwn(job, "environment"));
    assert.ok(!Object.hasOwn(job, "env"));
    if (
      [
        "quality",
        "tests",
        "browser",
        "documentation",
        "lint",
        "build",
      ].includes(name)
    ) {
      equal(
        job.needs,
        ["tests", "browser", "quality"].includes(name)
          ? ["changes", "build"]
          : "changes",
      );
      equal(
        job.if,
        "(" +
          readyVerificationGuard +
          ") && " +
          "needs.changes.outputs.documentation-only == '" +
          (name === "documentation" ? "true" : "false") +
          "'",
      );
    } else if (name !== "gate") equal(job.if, readyVerificationGuard);
    for (const step of job.steps) {
      assert.ok(!Object.hasOwn(step, "continue-on-error"));
      if (
        name === "tests" &&
        [tests.steps.at(-3), tests.steps.at(-2), tests.steps.at(-1)].includes(
          step,
        )
      )
        continue;
      if (name === "gate" && gate.steps.indexOf(step) >= 2) continue;
      if (
        name === "tests" &&
        [
          "Check out the exact historical AI receipt source",
          "Prepare the closed historical AI receipt bundle",
        ].includes(step.name)
      )
        continue;
      if (
        step.name !== "Upload browser failure evidence" &&
        !(name === "quality" && step === qualityJob.steps.at(-3)) &&
        !(name === "quality" && step === qualityJob.steps.at(-1))
      )
        assert.ok(!Object.hasOwn(step, "if"));
    }
  }
}

for (const { displayName: fileName, path } of workflowFiles) {
  const text = await readFile(path, "utf8");
  const workflow = parse(text);

  if (
    typeof workflow !== "object" ||
    workflow === null ||
    Array.isArray(workflow)
  ) {
    throw new Error(`${fileName} must contain a workflow mapping.`);
  }

  if (`.github/workflows/${fileName}` === BETA_DEPLOYMENT_WORKFLOW_PATH) {
    const findings = validateBetaDeploymentWorkflowText(text);
    if (findings.length > 0) {
      throw new Error(
        `${fileName} failed controlled-beta deployment policy:\n${findings
          .map(({ code, detail }) => `${code}: ${detail}`)
          .join("\n")}`,
      );
    }
    continue;
  }
  assertReadOnlyPermissions(workflow.permissions, fileName);

  if (
    typeof workflow.jobs !== "object" ||
    workflow.jobs === null ||
    Array.isArray(workflow.jobs)
  ) {
    throw new Error(`${fileName} must define at least one job.`);
  }

  assertPullRequestQualityGate(workflow, fileName);

  if (
    [
      "beta-memory-runner-verification.yml",
      "beta-runner-verification.yml",
      "beta-native-normalization-verification.yml",
    ].includes(fileName)
  ) {
    assert.deepEqual(workflow.on.pull_request.types, [
      "opened",
      "synchronize",
      "reopened",
      "ready_for_review",
      "converted_to_draft",
    ]);
    for (const job of Object.values(workflow.jobs)) {
      assert.equal(
        job.if.replace(/\s+/gu, " ").trim(),
        "github.repository == 'hunter-west/CloudMarkup' && (github.event_name == 'workflow_dispatch' || (toJSON(github.event.pull_request.draft) == 'false' && github.event.pull_request.head.repo.full_name == github.repository))",
      );
    }
  }

  for (const [jobName, job] of Object.entries(workflow.jobs)) {
    if (typeof job !== "object" || job === null || Array.isArray(job)) {
      throw new Error(`${fileName} job ${jobName} must be a mapping.`);
    }

    if ("permissions" in job) {
      assertReadOnlyPermissions(job.permissions, `${fileName} job ${jobName}`);
    }

    if (!Array.isArray(job.steps)) {
      throw new Error(`${fileName} job ${jobName} must define steps.`);
    }

    for (const step of job.steps) {
      if (
        typeof step === "object" &&
        step !== null &&
        !Array.isArray(step) &&
        "uses" in step &&
        (typeof step.uses !== "string" ||
          !/^[^/\s]+\/[^@\s]+@[0-9a-f]{40}$/u.test(step.uses))
      ) {
        throw new Error(
          `${fileName} job ${jobName} must pin external actions to a full commit SHA.`,
        );
      }
    }
  }

  if (
    /\b(?:cdk\s+deploy|terraform\s+apply|pnpm\s+deploy|npm\s+run\s+deploy)\b/iu.test(
      text,
    )
  ) {
    throw new Error(`${fileName} contains a deployment command.`);
  }

  if (
    /(?:configure-aws-credentials|aws-access-key-id|secrets\.AWS_)/iu.test(text)
  ) {
    throw new Error(`${fileName} contains an AWS credential reference.`);
  }
}

console.log(
  `ci:validate: parsed ${String(workflowFiles.length)} credentialless or explicitly gated least-privilege workflow file(s).`,
);
