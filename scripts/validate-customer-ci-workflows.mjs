import assert from "node:assert/strict";

import {
  CUSTOMER_CI_ACTION_PINS_V1,
  CUSTOMER_CI_WORKFLOW_PATHS,
  generateCustomerCiWorkflowSetV1,
  validateCustomerCiWorkflowSetV1,
} from "../packages/customer-ci-workflow/dist/index.js";
import { createCustomerCiWorkflowTestConfigV1 } from "../packages/customer-ci-workflow/dist/testing.js";
import { parse } from "yaml";

const config = createCustomerCiWorkflowTestConfigV1();
const result = generateCustomerCiWorkflowSetV1(config);
assert.deepEqual(validateCustomerCiWorkflowSetV1(config, result), {
  issues: [],
  valid: true,
});

const expectedPaths = Object.values(CUSTOMER_CI_WORKFLOW_PATHS).sort();
assert.deepEqual(
  result.manifest.files.map(({ path }) => path).sort(),
  expectedPaths,
);

const approvedActions = new Set(
  CUSTOMER_CI_ACTION_PINS_V1.map(({ action, commit }) => `${action}@${commit}`),
);
const parsed = new Map();
for (const file of result.manifest.files) {
  const workflow = parse(file.content);
  assert.ok(
    workflow !== null &&
      typeof workflow === "object" &&
      !Array.isArray(workflow),
    `${file.path} must parse to a workflow mapping.`,
  );
  assert.ok(
    workflow.on !== null &&
      typeof workflow.on === "object" &&
      !Array.isArray(workflow.on),
    `${file.path} must have explicit triggers.`,
  );
  assert.ok(
    workflow.permissions !== null &&
      typeof workflow.permissions === "object" &&
      !Array.isArray(workflow.permissions),
    `${file.path} must have explicit workflow permissions.`,
  );
  assert.ok(
    workflow.jobs !== null &&
      typeof workflow.jobs === "object" &&
      !Array.isArray(workflow.jobs) &&
      Object.keys(workflow.jobs).length > 0,
    `${file.path} must have at least one job.`,
  );
  for (const [jobName, job] of Object.entries(workflow.jobs)) {
    assert.ok(
      job !== null && typeof job === "object" && !Array.isArray(job),
      `${file.path} job ${jobName} must be a mapping.`,
    );
    assert.equal(job["runs-on"], "ubuntu-latest");
    assert.ok(
      Number.isInteger(job["timeout-minutes"]) &&
        job["timeout-minutes"] > 0 &&
        job["timeout-minutes"] <= 30,
      `${file.path} job ${jobName} needs a bounded timeout.`,
    );
    assert.ok(Array.isArray(job.steps) && job.steps.length > 0);
  }
  const references = [...file.content.matchAll(/uses:\s+([^\s#]+)/gu)].map(
    (match) => match[1],
  );
  assert.ok(
    references.every((reference) => approvedActions.has(reference)),
    `${file.path} contains an unreviewed or unpinned action.`,
  );
  assert.doesNotMatch(
    file.content,
    /pull_request_target|^\s*AWS_(?:ACCESS_KEY_ID|SECRET_ACCESS_KEY|SESSION_TOKEN)\s*:/imu,
  );
  const secretReferences = [
    ...file.content.matchAll(/\$\{\{\s*secrets\.([A-Z][A-Z0-9_]*)\s*\}\}/gu),
  ].map((match) => match[1]);
  assert.deepEqual(
    secretReferences,
    file.workflowKind === "deploy"
      ? [config.plan.artifactEncryption.privateKeySecretName]
      : [],
    `${file.path} must reference only its reviewed Environment secret.`,
  );
  parsed.set(file.workflowKind, workflow);
}

const mappedExpression = (selector, field) =>
  "${{ " +
  config.environments
    .map(
      (environment) =>
        `((${selector}) == '${environment.id}' && '${environment[field]}')`,
    )
    .join(" || ") +
  ` || '${config.environments[0][field]}' }}`;

const validate = parsed.get("validate");
assert.deepEqual(validate.permissions, { contents: "read" });
assert.ok("pull_request" in validate.on);
const validateContent = result.manifest.files.find(
  ({ workflowKind }) => workflowKind === "validate",
).content;
const generatedSourceScan = validate.jobs.validate.steps.find(
  ({ name }) =>
    name === "Scan exact manifest-bound application source without credentials",
);
assert.equal(typeof generatedSourceScan?.run, "string");
assert.match(generatedSourceScan.run, /CLOUDMARKUP_GENERATED_SOURCE_SECURITY/u);
assert.match(generatedSourceScan.run, /generated-replaceable/u);
assert.doesNotMatch(
  validateContent,
  /id-token:\s*write|configure-aws-credentials/iu,
);
assert.doesNotMatch(
  validateContent,
  /hashicorp\/setup-terraform|terraform\s+-chdir=/iu,
);

const plan = parsed.get("plan");
assert.equal(
  plan.jobs.plan.environment.name,
  mappedExpression("inputs.environment || 'dev'", "githubEnvironment"),
);
assert.equal(
  plan.jobs.plan.env.CLOUDMARKUP_WORKSPACE,
  mappedExpression("inputs.environment || 'dev'", "workspace"),
);
assert.deepEqual(plan.jobs.plan.needs, ["validate"]);
assert.deepEqual(plan.jobs.validate.permissions, { contents: "read" });
const activationGateIndex = plan.jobs.validate.steps.findIndex(
  ({ name }) =>
    name === "Enforce distribution and environment-policy activation holds",
);
assert.ok(
  activationGateIndex >= 0,
  "Plan preflight must include both activation holds.",
);
const activationGate = plan.jobs.validate.steps[activationGateIndex];
assert.match(activationGate.run, /distributionState = 'unavailable'/u);
assert.match(activationGate.run, /environmentPolicyState = 'unverified'/u);
const terraformSetupIndex = plan.jobs.validate.steps.findIndex(({ uses }) =>
  String(uses ?? "").startsWith("hashicorp/setup-terraform@"),
);
assert.ok(activationGateIndex < terraformSetupIndex);
const planOidcStep = plan.jobs.plan.steps.findIndex(({ uses }) =>
  String(uses ?? "").startsWith("aws-actions/configure-aws-credentials@"),
);
assert.ok(
  planOidcStep > 0,
  "OIDC role assumption must occur only in the dependent cloud-authorized job.",
);
assert.doesNotMatch(
  result.manifest.files.find(({ workflowKind }) => workflowKind === "plan")
    .content,
  /terraform(?:\s+-chdir=[^\s]+)?\s+apply/iu,
);

const deploy = parsed.get("deploy");
assert.deepEqual(Object.keys(deploy.on), ["workflow_dispatch"]);
assert.equal(
  deploy.jobs.deploy.environment.name,
  mappedExpression("inputs.environment", "githubEnvironment"),
);
assert.ok("predecessor_run_id" in deploy.on.workflow_dispatch.inputs);
assert.ok("predecessor_receipt_checksum" in deploy.on.workflow_dispatch.inputs);
assert.match(
  result.manifest.files.find(({ workflowKind }) => workflowKind === "deploy")
    .content,
  /exact approved saved plan/iu,
);
assert.doesNotMatch(
  result.manifest.files.find(({ workflowKind }) => workflowKind === "deploy")
    .content,
  /terraform(?:\s+-chdir=[^\s]+)?\s+plan/iu,
);

const smoke = result.manifest.files.find(
  ({ workflowKind }) => workflowKind === "smoke",
).content;
assert.match(smoke, /CLOUDMARKUP_SMOKE_HEALTH_PATH/iu);
assert.doesNotMatch(smoke, /\$CLOUDMARKUP_SMOKE_BASE_URL\/healthz/iu);
assert.match(smoke, /cloudmarkup-deploy\.yml/iu);

const drift = result.manifest.files.find(
  ({ workflowKind }) => workflowKind === "drift",
).content;
assert.match(drift, /-refresh-only/iu);
assert.match(drift, /umask 077/u);
assert.match(
  drift,
  /chmod 600 "\$GITHUB_WORKSPACE\/cloudmarkup-drift\.tfplan"/u,
);
assert.match(drift, /cloudmarkup-deploy\.yml/iu);
assert.match(
  drift,
  /Repository, branch, environment, or commit admission failed/iu,
);
assert.doesNotMatch(drift, /terraform(?:\s+-chdir=[^\s]+)?\s+apply/iu);
const driftWorkflow = parsed.get("drift");
const driftCleanup = driftWorkflow.jobs.drift.steps.find(
  ({ name }) => name === "Remove drift plan and raw material from the runner",
);
assert.equal(driftCleanup?.if, "always()");
assert.match(driftCleanup.run, /cloudmarkup-drift\.tfplan/u);
assert.match(driftCleanup.run, /cloudmarkup-plan\.raw\.json/u);

console.log(
  `ci:validate:customer: parsed and policy-validated ${String(result.manifest.files.length)} generated workflow files.`,
);
