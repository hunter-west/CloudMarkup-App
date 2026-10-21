import { spawnSync } from "node:child_process";

import { parse as parseYaml } from "yaml";
import { describe, expect, it } from "vitest";

import { CUSTOMER_CI_ACTION_PINS_V1 } from "./action-pins.js";
import {
  CUSTOMER_CI_LEGACY_OIDC_RISK_ACKNOWLEDGEMENT_V1,
  CUSTOMER_CI_WORKFLOW_PATHS,
  expectedCustomerCiOidcSubjectPrefixV1,
  type CustomerCiWorkflowConfigV1,
  type CustomerCiWorkflowResultV1,
} from "./contracts.js";
import {
  generateCustomerCiWorkflowSetV1,
  validateCustomerCiWorkflowSetV1,
} from "./generator.js";
import { containsCredentialShape, sha256 } from "./security.js";
import { validateResolvedCustomerCiRolesV1 } from "./workflow-scripts.js";
import { createCustomerCiWorkflowTestConfigV1 } from "./testing.js";

function copyConfig(): CustomerCiWorkflowConfigV1 {
  return structuredClone(createCustomerCiWorkflowTestConfigV1());
}

function copyResult(): CustomerCiWorkflowResultV1 {
  return structuredClone(generateCustomerCiWorkflowSetV1(copyConfig()));
}

function replaceWorkflow(
  result: CustomerCiWorkflowResultV1,
  kind: CustomerCiWorkflowResultV1["manifest"]["files"][number]["workflowKind"],
  append: string,
): void {
  const file = result.manifest.files.find(
    (candidate) => candidate.workflowKind === kind,
  );
  if (file === undefined) throw new Error(`Missing ${kind} workflow fixture.`);
  file.content += append;
  file.checksum = sha256(file.content);
  file.semanticChecksum = sha256(file.content.replaceAll("\r\n", "\n"));
}

function oidcAdmissionScript(
  result: CustomerCiWorkflowResultV1,
  kind: "plan" | "deploy" | "drift",
): string {
  const content =
    result.manifest.files.find(({ workflowKind }) => workflowKind === kind)
      ?.content ?? "";
  const workflow = parseYaml(content) as {
    jobs: Record<string, { steps: { name: string; run?: string }[] }>;
  };
  const script = workflow.jobs[kind]?.steps.find(
    ({ name }) => name === "Admit the reviewed GitHub OIDC subject context",
  )?.run;
  if (script === undefined) {
    throw new Error(`Missing ${kind} OIDC subject admission fixture.`);
  }
  return script;
}

function executeOidcAdmission(
  script: string,
  overrides: Readonly<Record<string, string>> = {},
) {
  const lines = script.split("\n");
  if (
    lines[0] !== "node --input-type=module <<'CLOUDMARKUP_OIDC_CONTEXT'" ||
    lines.at(-1) !== "CLOUDMARKUP_OIDC_CONTEXT"
  ) {
    throw new Error("Malformed OIDC admission test fixture.");
  }
  return spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", lines.slice(1, -1).join("\n")],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        CLOUDMARKUP_AWS_REGION: "us-east-1",
        CLOUDMARKUP_ENVIRONMENT: "dev",
        GITHUB_ACTIONS: "true",
        GITHUB_REPOSITORY: "customer-organization/customer-repository",
        GITHUB_REPOSITORY_ID: "987654321",
        GITHUB_REPOSITORY_OWNER: "customer-organization",
        GITHUB_REPOSITORY_OWNER_ID: "1234567",
        GITHUB_SERVER_URL: "https://github.com",
        ...overrides,
      },
    },
  );
}

describe("customer-owned CI workflow generation", () => {
  it("produces the exact five deterministic, schema-valid workflow files", () => {
    const config = copyConfig();
    const first = generateCustomerCiWorkflowSetV1(config);
    const second = generateCustomerCiWorkflowSetV1(structuredClone(config));

    expect(second).toEqual(first);
    expect(first.manifest.files.map(({ path }) => path)).toEqual(
      Object.values(CUSTOMER_CI_WORKFLOW_PATHS).sort((left, right) =>
        left.localeCompare(right, "en"),
      ),
    );
    expect(first.manifest.files).toHaveLength(5);
    for (const file of first.manifest.files) {
      expect(() => {
        void parseYaml(file.content);
      }).not.toThrow();
      expect(file.checksum).toBe(sha256(file.content));
      expect(file.semanticChecksum).toBe(
        sha256(file.content.replaceAll("\r\n", "\n")),
      );
    }
    expect(validateCustomerCiWorkflowSetV1(config, first)).toEqual({
      issues: [],
      valid: true,
    });
  });

  it(
    "emits syntactically valid embedded ESM scripts",
    { timeout: 30_000 },
    () => {
      const result = copyResult();
      let scriptCount = 0;
      for (const file of result.manifest.files) {
        const workflow = parseYaml(file.content) as {
          jobs: Record<string, { steps: { name: string; run?: string }[] }>;
        };
        for (const job of Object.values(workflow.jobs)) {
          for (const step of job.steps) {
            if (step.run === undefined) continue;
            const scripts = step.run.matchAll(
              /node --input-type=module <<'([A-Z0-9_]+)'\n([\s\S]*?)\n\1(?=\n|$)/gu,
            );
            for (const match of scripts) {
              const script = match[2];
              if (script === undefined) {
                throw new Error("Missing generated ESM script body.");
              }
              scriptCount += 1;
              const checked = spawnSync(
                process.execPath,
                ["--input-type=module", "--check"],
                {
                  encoding: "utf8",
                  input: script,
                },
              );
              expect(
                checked.status,
                `${file.path}: ${step.name}\n${checked.stderr}`,
              ).toBe(0);
            }
          }
        }
      }
      expect(scriptCount).toBeGreaterThan(20);
    },
  );

  it("uses only the reviewed action registry pinned to full commit SHAs", () => {
    const result = copyResult();
    const allowed = new Set(
      CUSTOMER_CI_ACTION_PINS_V1.map(
        ({ action, commit }) => `${action}@${commit}`,
      ),
    );
    const actionReferences = result.manifest.files.flatMap(({ content }) =>
      [...content.matchAll(/uses:\s+([^\s#]+)/g)].map((match) => match[1]),
    );

    expect(actionReferences.length).toBeGreaterThan(0);
    expect(
      actionReferences.every((reference) => allowed.has(reference ?? "")),
    ).toBe(true);
    expect(result.manifest.actionPins).toEqual(CUSTOMER_CI_ACTION_PINS_V1);
    expect(
      result.manifest.actionPins.every(({ commit }) =>
        /^[a-f0-9]{40}$/.test(commit),
      ),
    ).toBe(true);
  });

  it("keeps pull-request validation credentialless and grants OIDC only to environment jobs", () => {
    const result = copyResult();
    const byKind = new Map(
      result.manifest.files.map((file) => [file.workflowKind, file.content]),
    );
    const validate = byKind.get("validate") ?? "";

    expect(validate).toContain("pull_request:");
    expect(validate).not.toContain("id-token: write");
    expect(validate).not.toContain("configure-aws-credentials");
    expect(validate).not.toContain("secrets.");
    expect(containsCredentialShape(validate)).toBe(false);
    for (const kind of ["plan", "deploy", "drift"] as const) {
      expect(byKind.get(kind)).toContain("id-token: write");
      expect(byKind.get(kind)).toContain(
        "aws-actions/configure-aws-credentials@",
      );
    }
    expect(byKind.get("smoke")).not.toContain("id-token: write");
    expect(byKind.get("smoke")).not.toContain(
      "aws-actions/configure-aws-credentials@",
    );
    expect(
      result.manifest.files.every(
        ({ content }) => !content.includes("pull_request_target"),
      ),
    ).toBe(true);
    expect(
      result.manifest.files.every(
        ({ content }) => !containsCredentialShape(content),
      ),
    ).toBe(true);
  });

  it("checks the exact reviewed GitHub subject context and AWS Region before requesting OIDC", () => {
    const config = copyConfig();
    const result = generateCustomerCiWorkflowSetV1(config);

    for (const kind of ["plan", "deploy", "drift"] as const) {
      const content =
        result.manifest.files.find(({ workflowKind }) => workflowKind === kind)
          ?.content ?? "";
      const workflow = parseYaml(content) as {
        jobs: Record<
          string,
          {
            steps: {
              name: string;
              run?: string;
              uses?: string;
              with?: Record<string, unknown>;
            }[];
          }
        >;
      };
      const steps = workflow.jobs[kind]?.steps ?? [];
      const subjectAdmission = steps.findIndex(
        ({ name }) => name === "Admit the reviewed GitHub OIDC subject context",
      );
      const roleAdmission = steps.findIndex(
        ({ name }) =>
          name === "Validate resolved account and distinct role bindings",
      );
      const configure = steps.findIndex(({ uses }) =>
        uses?.startsWith("aws-actions/configure-aws-credentials@"),
      );

      expect(subjectAdmission).toBeGreaterThanOrEqual(0);
      expect(subjectAdmission).toBeLessThan(roleAdmission);
      expect(roleAdmission).toBeLessThan(configure);
      expect(steps[configure]?.with?.["audience"]).toBe("sts.amazonaws.com");
    }

    const requiredBeforeAnyAction = {
      deploy: [
        "Admit the repository and branch",
        "Bind this workflow and run to the exact reviewed commit",
        "Admit the reviewed GitHub OIDC subject context",
        "Validate resolved account and distinct role bindings",
        "Admit the customer deployment kill switch before any external action",
        "Confirm the reviewed repository is still private",
      ],
      drift: [
        "Admit the exact repository and scheduled or manual ref",
        "Bind this workflow and run to the exact reviewed commit",
        "Admit the reviewed GitHub OIDC subject context",
        "Validate resolved account and distinct role bindings",
        "Confirm the reviewed repository is still private",
      ],
      plan: [
        "Admit the repository and branch",
        "Bind this workflow and run to the exact reviewed commit",
        "Admit the reviewed GitHub OIDC subject context",
        "Validate resolved account and distinct role bindings",
        "Confirm the reviewed repository is still private",
      ],
    } as const;
    for (const kind of ["plan", "deploy", "drift"] as const) {
      const content =
        result.manifest.files.find(({ workflowKind }) => workflowKind === kind)
          ?.content ?? "";
      const workflow = parseYaml(content) as {
        permissions?: Record<string, string>;
        jobs: Record<
          string,
          {
            permissions?: Record<string, string>;
            steps: { name: string; uses?: string }[];
          }
        >;
      };
      const job = workflow.jobs[kind];
      const effectivePermissions = job?.permissions ?? workflow.permissions;
      expect(effectivePermissions?.["id-token"]).toBe("write");
      const steps = job?.steps ?? [];
      const firstExternalAction = steps.findIndex(
        ({ uses }) => uses !== undefined,
      );
      expect(
        firstExternalAction,
        `${kind} must contain a pinned external action`,
      ).toBeGreaterThanOrEqual(0);
      for (const admissionName of requiredBeforeAnyAction[kind]) {
        const admissionIndex = steps.findIndex(
          ({ name }) => name === admissionName,
        );
        expect(
          admissionIndex,
          `${kind} is missing ${admissionName}`,
        ).toBeGreaterThanOrEqual(0);
        expect(
          admissionIndex,
          `${kind} must run ${admissionName} before every uses step`,
        ).toBeLessThan(firstExternalAction);
      }
    }

    const script = oidcAdmissionScript(result, "plan");
    expect(script).toContain("GITHUB_REPOSITORY_ID");
    expect(script).toContain("GITHUB_REPOSITORY_OWNER_ID");
    expect(script).toContain("GITHUB_SERVER_URL");
    expect(script).not.toContain("ACTIONS_ID_TOKEN_REQUEST");
    expect(script).not.toContain("fetch(");
    expect(executeOidcAdmission(script).status).toBe(0);

    const rejectedContexts = [
      { GITHUB_REPOSITORY_ID: "987654322" },
      { GITHUB_REPOSITORY_OWNER_ID: "1234568" },
      {
        GITHUB_REPOSITORY: "customer-organization/renamed-repository",
      },
      { GITHUB_SERVER_URL: "https://github.example.invalid" },
      { CLOUDMARKUP_ENVIRONMENT: "unreviewed" },
      { CLOUDMARKUP_AWS_REGION: "us-east-1;env" },
    ] as const;
    for (const rejected of rejectedContexts) {
      const execution = executeOidcAdmission(script, rejected);
      expect(execution.status).not.toBe(0);
      expect(execution.stderr).toContain(
        "The GitHub OIDC subject context or AWS Region does not match the reviewed target.",
      );
    }
  });

  it("requires an explicit acknowledged legacy mode and warns about name reuse", () => {
    const config = copyConfig();
    config.repository.oidcSubject = {
      legacyRiskAcknowledgement:
        CUSTOMER_CI_LEGACY_OIDC_RISK_ACKNOWLEDGEMENT_V1,
      mode: "legacy-name-based-explicit",
      repositoryId: "987654321",
      repositoryOwnerId: "1234567",
      subjectPrefix:
        "repo:customer-organization/customer-repository:environment:",
    };

    const result = generateCustomerCiWorkflowSetV1(config);

    expect(result.preview.oidcSubject).toMatchObject({
      mode: "legacy-name-based-explicit",
      subjectPrefix:
        "repo:customer-organization/customer-repository:environment:",
    });
    expect(
      result.preview.warnings.some((warning) =>
        warning.includes("rename, transfer, or name reuse"),
      ),
    ).toBe(true);
    expect(oidcAdmissionScript(result, "plan")).toContain(
      "legacy-name-based-explicit",
    );
    expect(
      executeOidcAdmission(oidcAdmissionScript(result, "plan")).status,
    ).toBe(0);
  });

  it("maps manual plan inputs to the configured GitHub Environment and workspace", () => {
    const result = copyResult();
    const plan =
      result.manifest.files.find(({ workflowKind }) => workflowKind === "plan")
        ?.content ?? "";

    expect(plan).toContain(
      "((inputs.environment || 'dev') == 'staging' && 'cloudmarkup-staging')",
    );
    expect(plan).toContain(
      "((inputs.environment || 'dev') == 'production' && 'cloudmarkup-production')",
    );
    expect(plan).toContain(
      "((inputs.environment || 'dev') == 'staging' && 'notes_staging')",
    );
    expect(plan).not.toContain("(inputs.environment || 'dev' == ");
  });

  it("keeps planning, deployment, and read-only drift roles distinct while smoke has no cloud role", () => {
    const config = copyConfig();
    const result = generateCustomerCiWorkflowSetV1(config);
    const byKind = new Map(
      result.manifest.files.map((file) => [file.workflowKind, file.content]),
    );

    const plan = byKind.get("plan") ?? "";
    const deploy = byKind.get("deploy") ?? "";
    const drift = byKind.get("drift") ?? "";
    expect(plan.match(/role-to-assume:/g)).toHaveLength(1);
    expect(plan).toContain(
      `role-to-assume: \${{ vars.${config.variables.planRoleArn} }}`,
    );
    expect(deploy.match(/role-to-assume:/g)).toHaveLength(1);
    expect(deploy).toContain(
      `role-to-assume: \${{ vars.${config.variables.deployRoleArn} }}`,
    );
    expect(drift.match(/role-to-assume:/g)).toHaveLength(1);
    expect(drift).toContain(
      `role-to-assume: \${{ vars.${config.variables.driftRoleArn} }}`,
    );
    expect(byKind.get("smoke")).not.toContain("role-to-assume");
    expect(
      new Set(result.preview.roles.map(({ variable }) => variable)).size,
    ).toBe(3);
    expect(result.preview.roles).toHaveLength(9);
    expect(result.preview.warnings).toContain(
      "Ephemeral smoke mode is unsupported in v1 until a separately reviewed authenticated, account-bound, and budgeted target contract exists.",
    );
    const accountId = "123456789012";
    const roles: [string, string, string] = [
      `arn:aws:iam::${accountId}:role/cloudmarkup-plan`,
      `arn:aws:iam::${accountId}:role/cloudmarkup-deploy`,
      `arn:aws:iam::${accountId}:role/cloudmarkup-drift`,
    ];
    expect(() => {
      validateResolvedCustomerCiRolesV1({ accountId, roles });
    }).not.toThrow();
    expect(() => {
      validateResolvedCustomerCiRolesV1({
        accountId,
        roles: [roles[0], roles[0], roles[2]],
      });
    }).toThrow("Resolved customer CI role bindings are invalid");
    expect(() => {
      validateResolvedCustomerCiRolesV1({
        accountId,
        roles: [
          roles[0],
          roles[1],
          "arn:aws:iam::999999999999:role/cloudmarkup-drift",
        ],
      });
    }).toThrow("Resolved customer CI role bindings are invalid");
    for (const kind of ["plan", "deploy", "drift"] as const) {
      const workflow = byKind.get(kind) ?? "";
      expect(
        workflow.indexOf("Resolved customer CI role bindings are invalid"),
      ).toBeLessThan(
        workflow.indexOf("aws-actions/configure-aws-credentials@"),
      );
    }
  });

  it("previews protected production approval, exact trust subjects, variables, permissions, and triggers", () => {
    const config = copyConfig();
    const result = generateCustomerCiWorkflowSetV1(config);
    const production = result.preview.environments.find(
      ({ id }) => id === "production",
    );
    const configuredVariables = Object.values(config.variables).sort(
      (left, right) => left.localeCompare(right, "en"),
    );

    expect(production).toMatchObject({
      approvedRefs: ["refs/heads/main"],
      protected: true,
      requiredApprovals: 2,
      workspace: "notes_production",
    });
    expect(result.preview.requiredSecrets).toEqual([
      config.plan.artifactEncryption.privateKeySecretName,
    ]);
    expect(result.preview.requiredVariables).toEqual(configuredVariables);
    expect(result.preview.workflowPermissionRequired).toBe(true);
    expect(result.preview.workflows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "validate",
          permissions: ["contents: read"],
          triggers: ["pull_request", "push", "workflow_dispatch"],
        }),
        expect.objectContaining({
          kind: "deploy",
          permissions: ["actions: read", "contents: read", "id-token: write"],
          triggers: ["workflow_dispatch"],
        }),
      ]),
    );
    expect(result.preview.oidcSubject).toEqual({
      audience: "sts.amazonaws.com",
      issuer: "https://token.actions.githubusercontent.com",
      mode: "immutable-owner-and-repository-ids",
      repositoryId: "987654321",
      repositoryOwnerId: "1234567",
      subjectPrefix:
        "repo:customer-organization@1234567/customer-repository@987654321:environment:",
      trustConditionOperator: "StringEquals",
    });
    expect(
      expectedCustomerCiOidcSubjectPrefixV1({
        ...config.repository,
        ...config.repository.oidcSubject,
      }),
    ).toBe(config.repository.oidcSubject.subjectPrefix);
    expect(
      result.preview.roles.every(({ subject }) =>
        subject.startsWith(
          "repo:customer-organization@1234567/customer-repository@987654321:environment:",
        ),
      ),
    ).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/arn:aws:iam::[0-9]{12}:role/iu);
    expect(JSON.stringify(result)).not.toMatch(/\b\d{12}\b/);
  });

  it("binds deploy, smoke, and drift to reviewed receipts without broadening authority", () => {
    const config = copyConfig();
    const result = generateCustomerCiWorkflowSetV1(config);
    const byKind = new Map(
      result.manifest.files.map((file) => [file.workflowKind, file.content]),
    );
    const plan = byKind.get("plan") ?? "";
    const deploy = byKind.get("deploy") ?? "";
    const smoke = byKind.get("smoke") ?? "";
    const drift = byKind.get("drift") ?? "";
    const executableApply =
      /(?:^|\n)\s*(?:run:\s*)?terraform(?:\s+-chdir=\S+)?\s+apply(?:\s|$)/;
    const executablePlan =
      /(?:^|\n)\s*(?:run:\s*)?terraform(?:\s+-chdir=\S+)?\s+plan(?:\s|$)/;

    expect(executableApply.test(plan)).toBe(false);
    expect(executablePlan.test(deploy)).toBe(false);
    expect(deploy).toContain("cloudmarkup.tfplan.encrypted");
    expect(deploy).toContain("$CLOUDMARKUP_DECRYPTED_PLAN");
    expect(deploy).toContain(
      `secrets.${config.plan.artifactEncryption.privateKeySecretName}`,
    );
    expect(deploy).toContain(config.variables.deployEnabled);
    expect(deploy).toContain("cancel-in-progress: false");
    expect(plan).toContain("$RUNNER_TEMP/cloudmarkup-plan.log");
    expect(deploy).toContain("$RUNNER_TEMP/cloudmarkup-apply.log");
    expect(plan).toContain("outside workflow logs");
    expect(deploy).toContain("target-specific recovery procedure");

    for (const workflow of [smoke, drift]) {
      expect(workflow).toContain("actions/download-artifact@");
      expect(workflow).toContain(config.variables.deploymentRunId);
      expect(workflow).toContain(config.variables.deploymentReceiptDigest);
      expect(workflow).toContain(config.variables.deployedCommit);
      expect(workflow).toContain(config.variables.deployedRevisionDigest);
      expect(workflow).toContain("actions: read");
      expect(workflow).toContain("cancel-in-progress: false");
    }
    expect(smoke).toContain("cloudmarkup-smoke.receipt.json");
    expect(smoke).toContain("CLOUDMARKUP_SMOKE_HEALTH_PATH");
    expect(smoke).toContain(config.smoke.healthPath);
    expect(smoke).not.toContain(
      `$CLOUDMARKUP_SMOKE_BASE_URL${config.smoke.healthPath}`,
    );
    expect(smoke).toContain("target and response details were not logged");
    expect(drift).toContain("-refresh-only");
    expect(executableApply.test(drift)).toBe(false);
    expect(drift).toContain("cloudmarkup-drift.receipt.json");
    expect(drift).toContain("$RUNNER_TEMP/cloudmarkup-drift.log");
    expect(drift).toContain("rawPlanRetained: false");
    expect(drift).toContain("rm('cloudmarkup-drift.tfplan')");
  });
  it("exposes the exact reviewed workflow manifest files directly", () => {
    const result = copyResult();
    const files = result.manifest.files;

    expect(files).toHaveLength(5);
    expect(files.every(({ content }) => typeof content === "string")).toBe(
      true,
    );
    expect(files.map(({ path }) => path)).toEqual(
      Object.values(CUSTOMER_CI_WORKFLOW_PATHS).sort((left, right) =>
        left.localeCompare(right, "en"),
      ),
    );
  });

  it("keeps the unavailable Prompt 33B distribution as a hard credentialless activation hold", () => {
    const result = copyResult();
    const plan =
      result.manifest.files.find(({ workflowKind }) => workflowKind === "plan")
        ?.content ?? "";
    const workflow = parseYaml(plan) as {
      jobs: {
        plan: {
          needs: string[];
          permissions: Record<string, string>;
        };
        validate: {
          permissions: Record<string, string>;
          steps: { name: string; run?: string }[];
        };
      };
      permissions: Record<string, string>;
    };

    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(workflow.jobs.validate.permissions).toEqual({ contents: "read" });
    expect(workflow.jobs.plan.needs).toEqual(["validate"]);
    expect(workflow.jobs.plan.permissions).toEqual({
      contents: "read",
      "id-token": "write",
    });
    expect(JSON.stringify(workflow.jobs.validate)).not.toContain(
      "id-token: write",
    );
    const activationStep = workflow.jobs.validate.steps.find(
      ({ name }) =>
        name === "Enforce distribution and environment-policy activation holds",
    );
    expect(activationStep?.run).toContain("distributionState = 'unavailable'");
    expect(activationStep?.run).toContain(
      "environmentPolicyState = 'unverified'",
    );
    expect(activationStep?.run).toContain(
      "reviewed Prompt 33B CLI distribution and authoritative GitHub Environment policy verification are both available",
    );
    const stepNames = workflow.jobs.validate.steps.map(({ name }) => name);
    expect(
      stepNames.indexOf(
        "Enforce distribution and environment-policy activation holds",
      ),
    ).toBeLessThan(stepNames.indexOf("Set up the pinned Terraform CLI"));
    expect(plan).not.toContain("PROMPT33B_CLI_READY");
  });

  it("binds artifact downloads to exact successful workflow-run provenance before OIDC", () => {
    const result = copyResult();
    const byKind = new Map(
      result.manifest.files.map((file) => [file.workflowKind, file.content]),
    );
    const deploy = byKind.get("deploy") ?? "";
    const smoke = byKind.get("smoke") ?? "";
    const drift = byKind.get("drift") ?? "";

    for (const workflow of [deploy, smoke, drift]) {
      expect(workflow).toContain(
        "api.github.com/repos/customer-organization/customer-repository/actions/runs/",
      );
      expect(workflow).toContain("AbortSignal.timeout(10_000)");
      expect(workflow).toContain("total > 262144");
      expect(workflow).toContain("run.status !== 'completed'");
      expect(workflow).toContain("run.conclusion !== 'success'");
      expect(workflow).toContain("!Array.isArray(run.pull_requests)");
      expect(workflow).not.toContain("run.pull_requests.length !== 0");
      expect(workflow).toContain(
        "run.head_repository.id !== run.repository.id",
      );
      expect(workflow).toContain("response.redirected");
      expect(workflow).toContain(
        "artifactsUrl.searchParams.set('name', artifactName)",
      );
      expect(workflow).toContain(
        "artifact.size_in_bytes > artifactMaximumBytes",
      );
      expect(workflow).not.toContain("console.log(response");
    }

    expect(deploy).toContain("expected_plan_event");
    expect(deploy).toContain("expected_plan_ref");
    expect(deploy).toContain("expected_plan_run_attempt");
    expect(deploy).toContain("cloudmarkup-plan.yml");
    expect(smoke).toContain("cloudmarkup-deploy.yml");
    expect(drift).toContain("cloudmarkup-deploy.yml");
  });

  it("enforces exact promotion receipts and all artifact inspection before OIDC/apply", () => {
    const deploy =
      copyResult().manifest.files.find(
        ({ workflowKind }) => workflowKind === "deploy",
      )?.content ?? "";
    const workflow = parseYaml(deploy) as {
      jobs: {
        deploy: {
          steps: { name: string; run?: string; uses?: string }[];
        };
      };
    };
    const steps = workflow.jobs.deploy.steps;
    const names = steps.map(({ name }) => name);
    const position = (name: string) => names.indexOf(name);
    const applyScript =
      steps.find(
        ({ name }) =>
          name === "Apply the exact saved plan; no fresh plan is allowed",
      )?.run ?? "";

    expect(deploy).toContain("predecessor_receipt_checksum");
    expect(deploy).toContain("predecessor_run_id");
    expect(deploy).toContain("staging: 'dev'");
    expect(deploy).toContain("production: 'staging'");
    expect(deploy).toContain("predecessorReceiptDigest");
    expect(deploy).toContain("promotionPredecessorReceiptDigest");
    expect(deploy).toContain("cloudmarkup-plan.receipt.json");
    expect(deploy).toContain("receipt-deploy-${runId}");
    expect(
      position("Verify the exact successful planning workflow run"),
    ).toBeLessThan(position("Check out the exact planned commit"));
    expect(position("Check out the exact planned commit")).toBeLessThan(
      position("Verify the immutable Solution package tree"),
    );
    expect(position("Verify the immutable Solution package tree")).toBeLessThan(
      position("Download the exact saved-plan package"),
    );
    expect(
      position("Verify the exact predecessor receipt and promotion chain"),
    ).toBeLessThan(
      position("Acquire the customer-owned deployment role through OIDC"),
    );
    expect(
      position("Acquire the customer-owned deployment role through OIDC"),
    ).toBeLessThan(
      position("Apply the exact saved plan; no fresh plan is allowed"),
    );
    expect(applyScript).toContain("CLOUDMARKUP_EXPIRY");
    expect(applyScript.indexOf("expires <= Date.now()")).toBeGreaterThanOrEqual(
      0,
    );
    expect(applyScript.indexOf("expires <= Date.now()")).toBeLessThan(
      applyScript.indexOf("terraform -chdir="),
    );
    expect(applyScript).toContain(
      "manifest?.planChecksum !== expectedPlanChecksum",
    );
    expect(applyScript).toContain("digest(planBytes) !== expectedPlanChecksum");
    expect(
      applyScript.indexOf("digest(planBytes) !== expectedPlanChecksum"),
    ).toBeLessThan(applyScript.indexOf("terraform -chdir="));
    expect(applyScript).toContain("set -euo pipefail");
    expect(applyScript.indexOf("CLOUDMARKUP_EXPIRY")).toBeLessThan(
      applyScript.indexOf("terraform -chdir="),
    );
    expect(deploy).toContain("${{ runner.temp }}/saved-plan");
    expect(deploy).toContain("${{ runner.temp }}/predecessor-deployment");
  });

  it("emits strict bounded manifest, package-tree, sanitizer, drift, and smoke controls", () => {
    const result = copyResult();
    const byKind = new Map(
      result.manifest.files.map((file) => [file.workflowKind, file.content]),
    );
    const plan = byKind.get("plan") ?? "";
    const deploy = byKind.get("deploy") ?? "";
    const smoke = byKind.get("smoke") ?? "";
    const drift = byKind.get("drift") ?? "";

    expect(plan).toContain("rawStat.size > 8388608");
    expect(plan).toContain("cloudmarkup.tfplan', 268435456");
    expect(plan).toContain("evidenceBytes.byteLength > 8388608");
    expect(plan).toContain("resource_changes.length > 2000");
    expect(plan).toContain("PLAN_SECURITY_REVIEW_OVERFLOW");
    expect(plan).toContain("finally { await rm(rawPath, { force: true }); }");
    expect(plan).toContain(
      "Terraform plan actions are malformed or unsupported",
    );
    expect(plan).toContain(
      'cloudmarkup-plan.raw.json 2> "$RUNNER_TEMP/cloudmarkup-show.log"',
    );
    expect(deploy).toContain("stat.size > 131072");
    expect(deploy).toContain("'cloudmarkup.tfplan.encrypted': 268500992");
    expect(deploy).not.toContain("'cloudmarkup.tfplan': 268435456");
    expect(deploy).toContain("'cloudmarkup-plan.evidence.json': 8388608");
    expect(deploy).toContain("cloudmarkup-plan.evidence.json");
    expect(deploy).toContain("Number.isFinite(parsed)");
    expect(deploy).not.toContain("workspace=${manifest.workspace}");

    for (const workflow of [plan, deploy, smoke, drift]) {
      expect(workflow).toContain("The reviewed Solution package tree");
      expect(workflow).toContain("lstat");
      expect(workflow).toContain("readdir");
      expect(workflow).toContain("declaredTerraform");
      expect(workflow).toContain("actualTerraform");
      expect(workflow).toContain("normalize('NFC')");
      expect(workflow).toContain("manifest.repositoryWorkflows.files");
      expect(workflow).toContain("expectedWorkflowPaths");
    }

    const smokeNames = (
      parseYaml(smoke) as {
        jobs: { smoke: { steps: { name: string }[] } };
      }
    ).jobs.smoke.steps.map(({ name }) => name);
    expect(
      smokeNames.indexOf("Verify the exact successful deployment workflow run"),
    ).toBeLessThan(smokeNames.indexOf("Download the exact deployment receipt"));
    expect(smoke).toContain("curl --disable --silent");
    expect(smoke).toContain("--write-out '%{http_code}'");
    expect(smoke).toContain('--resolve "$resolve_entry"');
    expect(smoke).toContain("--noproxy '*'");
    expect(smoke).toContain("--proxy ''");
    expect(smoke).toContain("--max-redirs 0");
    expect(smoke).toContain('case "$code" in 2??)');
    expect(smoke).not.toContain("curl --fail");
    expect(smoke).toContain("Buffer.byteLength(raw, 'utf8') > 2048");
    expect(smoke).toContain("evidenceBytes.byteLength > 8388608");
    expect(smoke).toContain("raw.trim() !== raw");

    const driftNames = (
      parseYaml(drift) as {
        jobs: { drift: { steps: { name: string }[] } };
      }
    ).jobs.drift.steps.map(({ name }) => name);
    expect(driftNames.slice(0, 6)).toEqual([
      "Admit the exact repository and scheduled or manual ref",
      "Bind this workflow and run to the exact reviewed commit",
      "Confirm the reviewed repository is still private",
      "Admit the reviewed GitHub OIDC subject context",
      "Validate resolved account and distinct role bindings",
      "Set up the exact Node.js runtime",
    ]);
    expect(
      driftNames.indexOf("Verify the immutable deployed Solution package tree"),
    ).toBeLessThan(
      driftNames.indexOf(
        "Acquire the customer-owned read-only drift role through OIDC",
      ),
    );
    expect(drift).toContain(
      "Terraform drift projection failed; raw output was not logged",
    );
    expect(smoke).toContain(
      "predecessorReceiptDigest: deploymentReceiptDigest",
    );
    expect(drift).toContain(
      "predecessorReceiptDigest: deploymentReceiptDigest",
    );
  });

  it("uses runner-native Node only for the closed pre-action admission set", () => {
    const result = copyResult();
    const runnerNativeAdmissions = new Set([
      "Admit the repository and branch",
      "Admit the exact repository and scheduled or manual ref",
      "Bind this workflow and run to the exact reviewed commit",
      "Admit the reviewed GitHub OIDC subject context",
      "Validate resolved account and distinct role bindings",
      "Confirm the reviewed repository is still private",
    ]);
    for (const file of result.manifest.files) {
      const workflow = parseYaml(file.content) as {
        jobs: Record<
          string,
          {
            steps: {
              name: string;
              run?: string;
              uses?: string;
              with?: Record<string, unknown>;
            }[];
          }
        >;
      };
      for (const job of Object.values(workflow.jobs)) {
        const setupIndex = job.steps.findIndex(({ uses }) =>
          uses?.startsWith("actions/setup-node@"),
        );
        const nodeScriptIndexes = job.steps
          .map((step, index) => ({ index, step }))
          .filter(
            ({ step }) =>
              step.run?.includes("node --input-type=module") === true,
          )
          .map(({ index }) => index);
        if (nodeScriptIndexes.length > 0) {
          expect(setupIndex).toBeGreaterThanOrEqual(0);
          expect(job.steps[setupIndex]?.with?.["node-version"]).toBe("24.18.0");
          for (const scriptIndex of nodeScriptIndexes) {
            if (scriptIndex < setupIndex) {
              expect(
                runnerNativeAdmissions.has(job.steps[scriptIndex]?.name ?? ""),
                `${file.workflowKind} has an unreviewed runner-native Node script`,
              ).toBe(true);
            } else {
              expect(setupIndex).toBeLessThan(scriptIndex);
            }
          }
        }
      }
    }
  });
});

describe("customer-owned CI configuration rejection", () => {
  const invalidCases: readonly (readonly [
    string,
    (config: CustomerCiWorkflowConfigV1) => void,
  ])[] = [
    [
      "missing reviewed OIDC subject mode",
      (config) => {
        Reflect.deleteProperty(config.repository, "oidcSubject");
      },
    ],
    [
      "noncanonical GitHub repository ID",
      (config) => {
        config.repository.oidcSubject.repositoryId = "0987654321";
      },
    ],
    [
      "OIDC subject prefix with a different repository ID",
      (config) => {
        config.repository.oidcSubject.subjectPrefix =
          "repo:customer-organization@1234567/customer-repository@111111111:environment:";
      },
    ],
    [
      "legacy prefix under immutable mode",
      (config) => {
        config.repository.oidcSubject.subjectPrefix =
          "repo:customer-organization/customer-repository:environment:";
      },
    ],
    [
      "legacy mode without exact risk acknowledgement",
      (config) => {
        Reflect.set(config.repository, "oidcSubject", {
          mode: "legacy-name-based-explicit",
          repositoryId: "987654321",
          repositoryOwnerId: "1234567",
          subjectPrefix:
            "repo:customer-organization/customer-repository:environment:",
        });
      },
    ],
    [
      "ambiguous immutable mode with legacy acknowledgement",
      (config) => {
        Reflect.set(
          config.repository.oidcSubject,
          "legacyRiskAcknowledgement",
          CUSTOMER_CI_LEGACY_OIDC_RISK_ACKNOWLEDGEMENT_V1,
        );
      },
    ],
    [
      "template expression in repository owner",
      (config) => {
        config.repository.owner = "evil-${{github.actor}}";
      },
    ],
    [
      "malicious branch ref",
      (config) => {
        const environment = config.environments.find(({ id }) => id === "dev");
        if (environment === undefined) throw new Error("Missing dev fixture.");
        environment.approvedBranches = ["main..production"];
      },
    ],
    [
      "path traversal",
      (config) => {
        config.repository.destinationFolder = "../escaped";
      },
    ],
    [
      "Terraform path outside destination",
      (config) => {
        config.terraform.rootDirectory = "infrastructure/terraform";
      },
    ],
    [
      "decoy backend configuration below the reviewed root",
      (config) => {
        config.terraform.backend.configPath =
          "solutions/notes/infrastructure/terraform/decoy/backend.hcl";
      },
    ],
    [
      "weakened backend locking descriptor",
      (config) => {
        Reflect.set(config.terraform.backend, "locking", "disabled");
      },
    ],
    [
      "unknown backend credential field",
      (config) => {
        Reflect.set(config.terraform.backend, "accessKey", "forbidden");
      },
    ],
    [
      "decoy provider lock beside the reviewed root",
      (config) => {
        config.terraform.providerLockPath =
          "solutions/notes/infrastructure/.terraform.lock.hcl";
      },
    ],
    [
      "reordered environments",
      (config) => {
        const [development, staging, production] = config.environments;
        if (
          development === undefined ||
          staging === undefined ||
          production === undefined
        ) {
          throw new Error("Missing environment fixtures.");
        }
        config.environments = [staging, development, production];
      },
    ],
    [
      "case-insensitive duplicate GitHub environments",
      (config) => {
        const [development, staging] = config.environments;
        if (development === undefined || staging === undefined) {
          throw new Error("Missing environment fixtures.");
        }
        staging.githubEnvironment = development.githubEnvironment.toUpperCase();
      },
    ],
    [
      "impossible weekly cron",
      (config) => {
        config.drift.cron = "99 99 * * 1";
      },
    ],
    [
      "URL-shaped smoke path",
      (config) => {
        config.smoke.healthPath = "https://attacker.invalid/collect";
      },
    ],
    [
      "shell expansion in smoke path",
      (config) => {
        config.smoke.healthPath = "/$AWS_SECRET_ACCESS_KEY";
      },
    ],
    [
      "command substitution in smoke path",
      (config) => {
        config.smoke.healthPath = "/$(env)";
      },
    ],
    [
      "encoded traversal in smoke path",
      (config) => {
        config.smoke.healthPath = "/%2e%2e/admin";
      },
    ],
    [
      "unsupported ephemeral smoke authority",
      (config) => {
        Reflect.set(config.smoke, "allowEphemeral", true);
      },
    ],
    [
      "shared cloud role",
      (config) => {
        config.variables.deployRoleArn = config.variables.planRoleArn;
      },
    ],
    [
      "unprotected production",
      (config) => {
        const environment = config.environments.find(
          ({ id }) => id === "production",
        );
        if (environment === undefined) {
          throw new Error("Missing production fixture.");
        }
        environment.protected = false;
      },
    ],
    [
      "unknown input field",
      (config) => {
        Object.assign(config, { arbitraryCommand: "terraform apply" });
      },
    ],
  ];

  it.each(invalidCases)("rejects %s", (_name, mutate) => {
    const config = copyConfig();
    mutate(config);

    expect(() => generateCustomerCiWorkflowSetV1(config)).toThrow();
    expect(validateCustomerCiWorkflowSetV1(config, {})).toMatchObject({
      issues: [expect.objectContaining({ code: "CUSTOMER_CI_CONFIG_INVALID" })],
      valid: false,
    });
  });
});

describe("customer-owned CI workflow tamper rejection", () => {
  const tamperCases: readonly (readonly [
    string,
    Parameters<typeof replaceWorkflow>[1],
    string,
    string,
  ])[] = [
    [
      "long-lived credential shape",
      "validate",
      "\n# aws_access_key_id=forbidden\n",
      "CUSTOMER_CI_CREDENTIAL_REJECTED",
    ],
    [
      "untrusted privileged event",
      "plan",
      "\npull_request_target:\n",
      "CUSTOMER_CI_UNTRUSTED_TRIGGER_REJECTED",
    ],
    [
      "repository secret reference",
      "plan",
      "\n# ${{ secrets.AWS_SECRET_ACCESS_KEY }}\n",
      "CUSTOMER_CI_SECRET_REFERENCE_REJECTED",
    ],
    [
      "unpinned action",
      "validate",
      "\n# uses: actions/checkout@v6\n",
      "CUSTOMER_CI_ACTION_PIN_REJECTED",
    ],
    [
      "apply in planning",
      "plan",
      "\nmalicious:\n  run: terraform apply forbidden.tfplan\n",
      "CUSTOMER_CI_PLAN_APPLY_REJECTED",
    ],
    [
      "re-plan during deployment",
      "deploy",
      "\nmalicious:\n  run: terraform plan -out=fresh.tfplan\n",
      "CUSTOMER_CI_DEPLOY_REPLAN_REJECTED",
    ],
    [
      "apply during drift inspection",
      "drift",
      "\nmalicious:\n  run: terraform apply cloudmarkup-drift.tfplan\n",
      "CUSTOMER_CI_DRIFT_AUTHORITY_REJECTED",
    ],
    [
      "OIDC in pull-request validation",
      "validate",
      "\n# id-token: write\n",
      "CUSTOMER_CI_PR_CREDENTIAL_REJECTED",
    ],
  ];

  it.each(tamperCases)("rejects %s", (_name, kind, append, issueCode) => {
    const config = copyConfig();
    const candidate = copyResult();
    replaceWorkflow(candidate, kind, append);

    const validation = validateCustomerCiWorkflowSetV1(config, candidate);
    expect(validation.valid).toBe(false);
    expect(validation.issues.map(({ code }) => code)).toContain(issueCode);
    expect(validation.issues.map(({ code }) => code)).toContain(
      "CUSTOMER_CI_WORKFLOW_CHANGED",
    );
  });

  it("rejects every full-result binding mutation, including order and preview", () => {
    const config = copyConfig();
    const mutations: ((candidate: CustomerCiWorkflowResultV1) => void)[] = [
      (candidate) => {
        candidate.preview.warnings[0] = "Substituted preview.";
      },
      (candidate) => {
        const actionPin = candidate.manifest.actionPins[0];
        if (actionPin === undefined) {
          throw new Error("Missing action-pin fixture.");
        }
        actionPin.commit = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
      },
      (candidate) => {
        candidate.manifest.generator.digest = sha256("forged-generator");
      },
      (candidate) => {
        candidate.manifest.solutionRevision.digest = sha256(
          "forged-solution-revision",
        );
      },
      (candidate) => {
        candidate.manifest.files.reverse();
      },
    ];

    for (const mutate of mutations) {
      const candidate = copyResult();
      mutate(candidate);
      const validation = validateCustomerCiWorkflowSetV1(config, candidate);
      expect(validation.valid).toBe(false);
      expect(validation.issues.map(({ code }) => code)).toContain(
        "CUSTOMER_CI_RESULT_BINDING_INVALID",
      );
    }
  });

  it("rejects malformed output and manifest-binding changes", () => {
    const config = copyConfig();
    const malformed = copyResult();
    malformed.manifest.files.pop();
    expect(validateCustomerCiWorkflowSetV1(config, malformed)).toMatchObject({
      issues: [
        expect.objectContaining({ code: "CUSTOMER_CI_OUTPUT_MALFORMED" }),
      ],
      valid: false,
    });

    const rebound = copyResult();
    rebound.manifest.configDigest = sha256("attacker-config");
    expect(
      validateCustomerCiWorkflowSetV1(config, rebound).issues.map(
        ({ code }) => code,
      ),
    ).toContain("CUSTOMER_CI_MANIFEST_BINDING_INVALID");
  });
});
