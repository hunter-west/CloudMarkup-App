import { parse } from "yaml";

import {
  BETA_DEPLOYMENT_WORKFLOW_PATH,
  validateBetaDeploymentWorkflowText,
} from "../beta-deployment-workflow-policy.mjs";
import { findSecretPatterns } from "./secret-scan-core.mjs";

export const STATIC_SECURITY_LIMITS = Object.freeze({
  maximumFindings: 128,
  maximumGeneratedSourceBytes: 8 * 1024 * 1024,
  maximumGeneratedSourceFiles: 2_048,
  maximumIacSourceBytes: 2 * 1024 * 1024,
  maximumIacSourceFiles: 2_048,
  maximumJobs: 64,
  maximumReportedFindings: 512,
  maximumStepsPerJob: 256,
  maximumTraversalEntries: 10_000,
  maximumWorkflowBytes: 256 * 1024,
  maximumWorkflowFiles: 64,
});

const forbiddenTriggers = new Set(["pull_request_target", "workflow_run"]);
const ROOT_CI_WORKFLOW_PATH = ".github/workflows/ci.yml";
const allowedActionReferences = new Set([
  "actions/cache@cdf6c1fa76f9f475f3d7449005a359c84ca0f306",
  "actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd",
  "actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c",
  "actions/setup-go@4a3601121dd01d1626a1e23e37211e3254c1c06c",
  "actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e",
  "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
  "pnpm/action-setup@d15e628ca66d93ee5f352c71671a7bc6a97af5c9",
]);
const deploymentCommandPatterns = [
  /\bterraform(?:\s+-chdir=\S+)?\s+(?:apply|destroy|import)\b/iu,
  /\b(?:cdk|sam)\s+(?:deploy|destroy)\b/iu,
  /\baws\s+cloudformation\s+(?:create-change-set|deploy|execute-change-set)\b/iu,
  /\bpulumi\s+(?:destroy|up)\b/iu,
];
const dangerousDownloadPattern =
  /\b(?:curl|wget)\b[^\n|]*(?:\||\|&)\s*(?:ba|z|k)?sh\b/iu;
const generatedSourcePatterns = [
  {
    code: "GENERATED_SOURCE_PROCESS_EXECUTION",
    pattern:
      /(?:\bnode:child_process\b|\bfrom\s+["']child_process["']|\brequire\s*\(\s*["']child_process["']\s*\))/u,
  },
  {
    code: "GENERATED_SOURCE_DYNAMIC_EVALUATION",
    pattern: /\b(?:eval|Function)\s*\(/u,
  },
  {
    code: "GENERATED_SOURCE_RUNTIME_PROCESS_EXECUTION",
    pattern: /\b(?:Bun\.spawn|Deno\.Command)\b/u,
  },
];
const iacSourcePatterns = [
  {
    code: "IAC_ARBITRARY_EXECUTION_BLOCK",
    pattern:
      /(?:^\s*(?:module|provisioner)\s+"|\b(?:local-exec|remote-exec)\b|"(?:module|provisioner)"\s*:)/mu,
  },
  {
    code: "IAC_EXTERNAL_EXECUTION_SOURCE",
    pattern:
      /(?:^\s*data\s+"(?:external|terraform_remote_state)"\s+"|"(?:external|terraform_remote_state)"\s*:)/mu,
  },
  {
    code: "IAC_EMBEDDED_CREDENTIAL",
    pattern:
      /\b(?:access_key|secret_key|token|password)\s*=\s*"(?!\$\{)[^"\r\n]{1,512}"/iu,
  },
];

function plain(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function finding(code, path, detail) {
  return { code, detail, path };
}

function boundedPush(findings, value) {
  if (findings.length < STATIC_SECURITY_LIMITS.maximumFindings) {
    findings.push(value);
  }
}

function verifyPermissions(permissions, path, findings) {
  if (!plain(permissions)) {
    boundedPush(
      findings,
      finding(
        "WORKFLOW_PERMISSIONS_NOT_EXPLICIT",
        path,
        "Permissions must be an explicit read-only mapping.",
      ),
    );
    return;
  }
  for (const [scope, access] of Object.entries(permissions)) {
    if (access !== "read" && access !== "none") {
      boundedPush(
        findings,
        finding(
          "WORKFLOW_PERMISSION_WRITE",
          path,
          `${scope} grants unsupported ${String(access)} access.`,
        ),
      );
    }
  }
}

export function verifyWorkflowSecurity(path, text) {
  const findings = [];
  if (
    Buffer.byteLength(text, "utf8") >
    STATIC_SECURITY_LIMITS.maximumWorkflowBytes
  ) {
    return [
      finding(
        "WORKFLOW_TOO_LARGE",
        path,
        "Workflow bytes exceed the reviewed static-verification limit.",
      ),
    ];
  }
  if (path === BETA_DEPLOYMENT_WORKFLOW_PATH) {
    for (const entry of validateBetaDeploymentWorkflowText(text)) {
      boundedPush(findings, finding(entry.code, path, entry.detail));
    }
    for (const secret of findSecretPatterns(text, path)) {
      boundedPush(
        findings,
        finding(
          "WORKFLOW_SECRET_PATTERN",
          `${secret.path}:${String(secret.line)}`,
          secret.label,
        ),
      );
    }
    return findings;
  }
  let workflow;
  try {
    workflow = parse(text);
  } catch {
    return [
      finding("WORKFLOW_YAML_INVALID", path, "Workflow YAML is invalid."),
    ];
  }
  if (!plain(workflow)) {
    return [finding("WORKFLOW_INVALID", path, "Workflow must be a mapping.")];
  }
  const triggers = workflow.on;
  if (!plain(triggers)) {
    boundedPush(
      findings,
      finding(
        "WORKFLOW_TRIGGERS_NOT_EXPLICIT",
        path,
        "Workflow triggers must be an explicit mapping.",
      ),
    );
  }
  const triggerNames = plain(triggers) ? Object.keys(triggers) : [];
  for (const trigger of triggerNames) {
    if (forbiddenTriggers.has(trigger)) {
      boundedPush(
        findings,
        finding(
          "WORKFLOW_UNTRUSTED_PRIVILEGED_TRIGGER",
          path,
          `The ${trigger} trigger is not admitted.`,
        ),
      );
    }
  }
  verifyPermissions(workflow.permissions, path, findings);
  if (!plain(workflow.jobs)) {
    boundedPush(
      findings,
      finding(
        "WORKFLOW_JOBS_INVALID",
        path,
        "Workflow jobs must be a mapping.",
      ),
    );
    return findings;
  }
  const jobs = Object.entries(workflow.jobs);
  if (jobs.length < 1 || jobs.length > STATIC_SECURITY_LIMITS.maximumJobs) {
    boundedPush(
      findings,
      finding(
        "WORKFLOW_JOB_COUNT_INVALID",
        path,
        "Workflow job count is outside the reviewed bound.",
      ),
    );
  }
  const pullRequestWorkflow = triggerNames.includes("pull_request");
  for (const [jobName, job] of jobs) {
    const jobPath = `${path}#${jobName}`;
    if (!plain(job)) {
      boundedPush(
        findings,
        finding("WORKFLOW_JOB_INVALID", jobPath, "Job must be a mapping."),
      );
      continue;
    }
    if (job["runs-on"] !== "ubuntu-latest") {
      boundedPush(
        findings,
        finding(
          "WORKFLOW_RUNNER_NOT_ALLOWLISTED",
          jobPath,
          "Verification jobs must use the reviewed GitHub-hosted runner.",
        ),
      );
    }
    const maximumTimeoutMinutes =
      (path === ROOT_CI_WORKFLOW_PATH && jobName === "quality") ||
      (path === ".github/workflows/public-ci.yml" && jobName === "verify") ||
      (path === ".github/workflows/public-diagnostics.yml" &&
        jobName === "coverage")
        ? 120
        : path === ROOT_CI_WORKFLOW_PATH && jobName === "tests"
          ? 120
          : (path === ".github/workflows/beta-runner-verification.yml" &&
                jobName === "package") ||
              (path ===
                ".github/workflows/beta-memory-runner-verification.yml" &&
                jobName === "proof")
            ? 45
            : 30;
    if (
      !Number.isInteger(job["timeout-minutes"]) ||
      job["timeout-minutes"] < 1 ||
      job["timeout-minutes"] > maximumTimeoutMinutes
    ) {
      boundedPush(
        findings,
        finding(
          "WORKFLOW_TIMEOUT_UNBOUNDED",
          jobPath,
          `Job timeout must be between 1 and ${String(maximumTimeoutMinutes)} minutes.`,
        ),
      );
    }
    if (Object.hasOwn(job, "permissions")) {
      verifyPermissions(job.permissions, jobPath, findings);
    }
    if (!Array.isArray(job.steps) || job.steps.length < 1) {
      boundedPush(
        findings,
        finding(
          "WORKFLOW_STEPS_INVALID",
          jobPath,
          "Job steps must be non-empty.",
        ),
      );
      continue;
    }
    if (job.steps.length > STATIC_SECURITY_LIMITS.maximumStepsPerJob) {
      boundedPush(
        findings,
        finding(
          "WORKFLOW_STEP_COUNT_INVALID",
          jobPath,
          "Job step count exceeds the reviewed bound.",
        ),
      );
    }
    for (const [index, step] of job.steps.entries()) {
      const stepPath = `${jobPath}/steps/${String(index)}`;
      if (!plain(step)) {
        boundedPush(
          findings,
          finding("WORKFLOW_STEP_INVALID", stepPath, "Step must be a mapping."),
        );
        continue;
      }
      if (Object.hasOwn(step, "uses")) {
        const reference = step.uses;
        if (
          typeof reference !== "string" ||
          !/^[^/\s]+\/[^@\s]+@[0-9a-f]{40}$/u.test(reference)
        ) {
          boundedPush(
            findings,
            finding(
              "WORKFLOW_ACTION_NOT_PINNED",
              stepPath,
              "External actions must use a full commit SHA.",
            ),
          );
        } else if (!allowedActionReferences.has(reference)) {
          boundedPush(
            findings,
            finding(
              "WORKFLOW_ACTION_NOT_ALLOWLISTED",
              stepPath,
              "External actions must match the reviewed action registry.",
            ),
          );
        }
        if (
          typeof reference === "string" &&
          reference.startsWith("actions/checkout@") &&
          (!plain(step.with) || step.with["persist-credentials"] !== false)
        ) {
          boundedPush(
            findings,
            finding(
              "WORKFLOW_CHECKOUT_CREDENTIALS_PERSISTED",
              stepPath,
              "Checkout must explicitly disable persisted credentials.",
            ),
          );
        }
      }
      if (typeof step.run === "string") {
        if (dangerousDownloadPattern.test(step.run)) {
          boundedPush(
            findings,
            finding(
              "WORKFLOW_REMOTE_SCRIPT_EXECUTION",
              stepPath,
              "Downloaded content cannot be piped to a shell.",
            ),
          );
        }
        for (const pattern of deploymentCommandPatterns) {
          if (pattern.test(step.run)) {
            boundedPush(
              findings,
              finding(
                "WORKFLOW_DEPLOYMENT_COMMAND",
                stepPath,
                "Repository verification workflows cannot mutate infrastructure.",
              ),
            );
          }
        }
      }
    }
  }
  if (path === ROOT_CI_WORKFLOW_PATH) {
    const securityJob = workflow.jobs.security;
    const securitySteps =
      plain(securityJob) && Array.isArray(securityJob.steps)
        ? securityJob.steps
        : [];
    const gateIndexes = securitySteps.flatMap((step, index) =>
      plain(step) && step.run === "pnpm security:check" ? [index] : [],
    );
    const installIndexes = securitySteps.flatMap((step, index) =>
      plain(step) &&
      step.run === "pnpm install --frozen-lockfile --ignore-scripts"
        ? [index]
        : [],
    );
    if (gateIndexes.length !== 1) {
      boundedPush(
        findings,
        finding(
          "REPOSITORY_SECURITY_GATE_MISSING",
          path,
          "CI must run the exact local static, secret, and external dependency security gate once.",
        ),
      );
    }
    if (
      installIndexes.length !== 1 ||
      (gateIndexes.length === 1 && installIndexes[0] > gateIndexes[0])
    ) {
      boundedPush(
        findings,
        finding(
          "REPOSITORY_SECURITY_INSTALL_MISSING",
          path,
          "CI must install the frozen scanner dependencies without lifecycle scripts before the security gate.",
        ),
      );
    }
  }
  if (pullRequestWorkflow) {
    if (
      /\bid-token\s*:\s*write\b/iu.test(text) ||
      /\$\{\{\s*secrets\./u.test(text) ||
      /configure-aws-credentials/iu.test(text)
    ) {
      boundedPush(
        findings,
        finding(
          "WORKFLOW_PULL_REQUEST_CREDENTIAL",
          path,
          "Pull-request workflows cannot request cloud credentials, OIDC, or secrets.",
        ),
      );
    }
  }
  for (const secret of findSecretPatterns(text, path)) {
    boundedPush(
      findings,
      finding(
        "WORKFLOW_SECRET_PATTERN",
        `${secret.path}:${String(secret.line)}`,
        secret.label,
      ),
    );
  }
  return findings;
}

export function verifyGeneratedSourceSecurity(path, text) {
  const findings = [];
  if (
    Buffer.byteLength(text, "utf8") >
    STATIC_SECURITY_LIMITS.maximumGeneratedSourceBytes
  ) {
    return [
      finding(
        "GENERATED_SOURCE_TOO_LARGE",
        path,
        "Generated source exceeds the reviewed static-verification limit.",
      ),
    ];
  }
  for (const secret of findSecretPatterns(text, path)) {
    boundedPush(
      findings,
      finding(
        "GENERATED_SOURCE_SECRET_PATTERN",
        `${secret.path}:${String(secret.line)}`,
        secret.label,
      ),
    );
  }
  for (const rule of generatedSourcePatterns) {
    if (rule.pattern.test(text)) {
      boundedPush(
        findings,
        finding(
          rule.code,
          path,
          "Generated source contains a forbidden execution primitive.",
        ),
      );
    }
  }
  return findings;
}

export function verifyIacSourceSecurity(path, text) {
  const findings = [];
  if (
    Buffer.byteLength(text, "utf8") >
    STATIC_SECURITY_LIMITS.maximumIacSourceBytes
  ) {
    return [
      finding(
        "IAC_SOURCE_TOO_LARGE",
        path,
        "IaC source exceeds the reviewed static-verification limit.",
      ),
    ];
  }
  for (const secret of findSecretPatterns(text, path)) {
    boundedPush(
      findings,
      finding(
        "IAC_SECRET_PATTERN",
        `${secret.path}:${String(secret.line)}`,
        secret.label,
      ),
    );
  }
  for (const rule of iacSourcePatterns) {
    if (rule.pattern.test(text)) {
      boundedPush(
        findings,
        finding(
          rule.code,
          path,
          "IaC source contains a forbidden execution or credential boundary.",
        ),
      );
    }
  }
  return findings;
}

export function sortStaticSecurityFindings(findings) {
  return [...findings].sort((left, right) => {
    const leftKey = `${left.path}\u0000${left.code}\u0000${left.detail}`;
    const rightKey = `${right.path}\u0000${right.code}\u0000${right.detail}`;
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
}
