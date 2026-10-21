import { parse } from "yaml";

const fullCommitAction = /^[^/\s]+\/[^@\s]+@[0-9a-f]{40}$/u;
const forbiddenText =
  /(?:pull_request_target|workflow_run|configure-aws-credentials|aws-access-key-id|aws-secret-access-key|secrets\.|terraform\s+(?:plan|apply)|cdk\s+deploy|pnpm\s+deploy|npm\s+run\s+deploy|\beval\b|\bcurl\b|\bwget\b)/iu;
const allowedCommands = Object.freeze([
  "pnpm install --frozen-lockfile --ignore-scripts",
  "mkdir -p .cloudmarkup-tools && pnpm --filter @cloudmarkup/architecture-cli build && go build -trimpath -o .cloudmarkup-tools/cloudmarkup-iac ./services/iac-compiler/cmd/cloudmarkup-iac",
  "pnpm exec cloudmarkup validate --format json",
  "pnpm exec cloudmarkup verify --format json",
  "pnpm exec cloudmarkup test --format json",
  "pnpm exec cloudmarkup render --format json",
  "mkdir -p evidence/repository-verification && pnpm exec cloudmarkup diff --format json > evidence/repository-verification/semantic-diff.json",
  "pnpm exec cloudmarkup evidence --format json > evidence/repository-verification/evidence-summary.json",
] as const);

interface WorkflowStep {
  readonly if?: unknown;
  readonly run?: unknown;
  readonly uses?: unknown;
  readonly with?: unknown;
}

function mapping(input: unknown): Record<string, unknown> | undefined {
  return typeof input === "object" && input !== null && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : undefined;
}

function assertReadOnlyPermissions(input: unknown): void {
  const permissions = mapping(input);
  if (
    permissions === undefined ||
    Object.keys(permissions).length !== 1 ||
    permissions["contents"] !== "read"
  ) {
    throw new TypeError("Workflow permissions must be exactly contents: read.");
  }
}

export function assertCloudMarkupWorkflowTemplate(input: string): void {
  if (input.length > 64 * 1024 || forbiddenText.test(input)) {
    throw new TypeError(
      "Workflow contains a forbidden event, credential, network, or deployment capability.",
    );
  }
  const workflow = mapping(parse(input));
  const events = mapping(workflow?.["on"]);
  const jobs = mapping(workflow?.["jobs"]);
  if (
    workflow === undefined ||
    events === undefined ||
    !("pull_request" in events) ||
    !("push" in events) ||
    jobs === undefined ||
    Object.keys(jobs).length !== 1
  ) {
    throw new TypeError(
      "Workflow must use only the reviewed pull-request and trusted-push structure.",
    );
  }
  assertReadOnlyPermissions(workflow["permissions"]);
  const job = mapping(jobs["verify"]);
  if (
    job?.["runs-on"] !== "ubuntu-latest" ||
    job["timeout-minutes"] !== 20 ||
    !Array.isArray(job["steps"]) ||
    job["steps"].length > 16
  ) {
    throw new TypeError(
      "Workflow verify job exceeds the reviewed runner, time, or step contract.",
    );
  }
  const observedCommands: string[] = [];
  let uploadCount = 0;
  for (const candidate of job["steps"]) {
    const step = mapping(candidate) as WorkflowStep | undefined;
    if (step === undefined)
      throw new TypeError("Workflow steps must be mappings.");
    if (step.uses !== undefined) {
      if (typeof step.uses !== "string" || !fullCommitAction.test(step.uses)) {
        throw new TypeError(
          "External workflow actions must use reviewed full commit SHAs.",
        );
      }
      const values = mapping(step.with);
      if (
        step.uses.startsWith("actions/checkout@") &&
        values?.["persist-credentials"] !== false
      ) {
        throw new TypeError("Checkout credentials must not persist.");
      }
      if (step.uses.startsWith("actions/upload-artifact@")) {
        uploadCount += 1;
        if (
          values?.["name"] !== "cloudmarkup-repository-evidence" ||
          values["path"] !== "evidence/repository-verification/" ||
          values["include-hidden-files"] !== false ||
          values["retention-days"] !== 7
        ) {
          throw new TypeError(
            "Evidence upload must use the bounded reviewed artifact contract.",
          );
        }
      }
    }
    if (step.run !== undefined) {
      if (
        typeof step.run !== "string" ||
        !allowedCommands.includes(step.run as never)
      ) {
        throw new TypeError("Workflow contains an unreviewed command line.");
      }
      observedCommands.push(step.run);
    }
  }
  if (
    uploadCount !== 1 ||
    observedCommands.length !== allowedCommands.length ||
    allowedCommands.some((command) => !observedCommands.includes(command))
  ) {
    throw new TypeError(
      "Workflow must include every reviewed verification command exactly once.",
    );
  }
}
