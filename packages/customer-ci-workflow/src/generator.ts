import { stringify as stringifyYaml } from "yaml";

import { CUSTOMER_CI_ACTION_PINS_V1, pinnedAction } from "./action-pins.js";
import {
  CUSTOMER_CI_WORKFLOW_PATHS,
  customerCiWorkflowConfigV1Schema,
  customerCiWorkflowResultV1Schema,
  type CustomerCiIssueV1,
  type CustomerCiWorkflowConfigV1,
  type CustomerCiWorkflowFileV1,
  type CustomerCiWorkflowKindV1,
  type CustomerCiWorkflowResultV1,
} from "./contracts.js";
import {
  canonicalJson,
  containsCredentialShape,
  safeIssue,
  sha256,
} from "./security.js";
import {
  branchAdmissionScriptV1 as branchAdmissionScript,
  conformanceDeploymentRecordScriptV1 as conformanceDeploymentRecordScript,
  conformanceDriftRecordScriptV1 as conformanceDriftRecordScript,
  conformancePlanRecordScriptV1 as conformancePlanRecordScript,
  deployReceiptScriptV1 as deployReceiptScript,
  deployIntegrityScriptV1 as deployIntegrityScript,
  deploymentReceiptInspectionScriptV1 as deploymentReceiptInspectionScript,
  generatedSourceSecurityVerificationScriptV1 as generatedSourceSecurityVerificationScript,
  githubRunInspectionScriptV1 as githubRunInspectionScript,
  packageVerificationScriptV1 as packageVerificationScript,
  planManifestScriptV1 as planManifestScript,
  planDecryptionScriptV1 as planDecryptionScript,
  planEncryptionScriptV1 as planEncryptionScript,
  planSanitizerScriptV1 as planSanitizerScript,
  predecessorReceiptInspectionScriptV1 as predecessorReceiptInspectionScript,
  predecessorSmokeReceiptInspectionScriptV1 as predecessorSmokeReceiptInspectionScript,
  smokeTestExtensionVerificationScriptV1 as smokeTestExtensionVerificationScript,
  promotionAdmissionScriptV1 as promotionAdmissionScript,
  roleAdmissionScriptV1 as roleAdmissionScript,
  savedPlanExpiryAdmissionScriptV1 as savedPlanExpiryAdmissionScript,
  savedPlanManifestInspectionScriptV1 as manifestInspectionScript,
  workflowCommitAdmissionScriptV1 as workflowCommitAdmissionScript,
  terraformCliVerificationScriptV1 as terraformCliVerificationScript,
} from "./workflow-scripts.js";

const GENERATOR_VERSION = "1.0.0";
const GENERATOR_ID = "cloudmarkup.customer-ci-workflow";

const CUSTOMER_CI_POLICY_V1 = Object.freeze({
  actions: CUSTOMER_CI_ACTION_PINS_V1,
  authority: "customer-owned",
  credentialMode: "github-oidc-only",
  oidcAudience: "sts.amazonaws.com",
  oidcSubject:
    "explicit-exact-prefix-pre-token-repository-and-owner-id-admission",
  deploy: "exact-saved-plan-only-final-manifest-and-plan-rehash",
  drift: "exact-deployment-receipt-refresh-only-no-apply",
  ephemeralSmoke: "unsupported-no-oidc-authority",
  environments: ["dev", "staging", "production"],
  environmentPolicyVerification: "unavailable-hard-block",
  forbiddenEvents: ["pull_request_target"],
  nodeRuntime:
    "github-hosted-runner-node-for-pre-action-admission-then-actions-setup-node-pinned-24.18.0",
  executionCommit: "workflow-sha-and-run-sha-exact-reviewed-commit",
  generatedSourceScan:
    "manifest-checksum-bound-static-secret-and-execution-primitive-scan-no-network-no-credentials",
  handlerValidation:
    "manifest-bound-deterministic-build-test-security-evidence-no-repository-command-execution",
  packageTree: "manifest-complete-no-symlinks-no-unmanifested-files",
  smokeExtensions:
    "checksum-bound-declarative-json-metadata-only-no-customer-command-execution",
  planRunProvenance: "github-runs-api-exact-repository-workflow-ref-sha",
  planArtifactEncryption: "rsa-oaep-sha256-aes-256-gcm-private-repository",
  providerSources: "exact-reviewed-lock-and-hashicorp-aws-only",
  terraformCli: "reviewed-linux-amd64-sha256-before-execution",
  terraformBackend: "aws-s3-encrypted-native-lockfile-workspace-prefix",
  resolvedRoles: "exact-account-arns-pairwise-distinct-pre-oidc",
  planSanitization: "bounded-strict-structural-sanitized-only",
  promotion: "dev-to-staging-to-production-receipt-chain",
  prompt33bDistribution: "unavailable-hard-block",
  forbiddenSecrets: ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"],
  profile: "github-actions-aws-terraform-v1",
  smoke: "exact-deployment-receipt-dns-pinned-public-https-no-cloud-role",
});

export const CUSTOMER_CI_POLICY_DIGEST_V1 = sha256(
  canonicalJson(CUSTOMER_CI_POLICY_V1),
);
export const CUSTOMER_CI_PIN_REGISTRY_DIGEST_V1 = sha256(
  canonicalJson(CUSTOMER_CI_ACTION_PINS_V1),
);
export const CUSTOMER_CI_GENERATOR_DIGEST_V1 = sha256(
  canonicalJson({
    id: GENERATOR_ID,
    policyDigest: CUSTOMER_CI_POLICY_DIGEST_V1,
    version: GENERATOR_VERSION,
  }),
);

function expression(value: string): string {
  return "${{ " + value + " }}";
}

function selectedEnvironmentExpression(
  config: CustomerCiWorkflowConfigV1,
  selector: string,
): string {
  const entries = config.environments;
  return expression(
    entries
      .map(
        ({ id, githubEnvironment }) =>
          `((${selector}) == '${id}' && '${githubEnvironment}')`,
      )
      .join(" || ") + ` || '${entries[0]?.githubEnvironment ?? "dev"}'`,
  );
}

function selectedWorkspaceExpression(
  config: CustomerCiWorkflowConfigV1,
  selector: string,
): string {
  return expression(
    config.environments
      .map(
        ({ id, workspace }) => `((${selector}) == '${id}' && '${workspace}')`,
      )
      .join(" || ") + ` || '${config.environments[0]?.workspace ?? "dev"}'`,
  );
}

function packageFilePath(
  config: CustomerCiWorkflowConfigV1,
  path: string,
): string {
  return config.repository.destinationFolder === ""
    ? path
    : `${config.repository.destinationFolder}/${path}`;
}
function workflowHeader(kind: CustomerCiWorkflowKindV1): string {
  return [
    "# Generated by CloudMarkup customer CI workflow policy v1.",
    `# Purpose: ${kind}. Customer repository controls execution and credentials.`,
    "# Regenerate and review instead of editing this file in place.",
    "",
  ].join("\n");
}

function yamlWorkflow(
  kind: CustomerCiWorkflowKindV1,
  value: Record<string, unknown>,
): string {
  return (
    workflowHeader(kind) +
    stringifyYaml(value, { lineWidth: 0, sortMapEntries: true })
  );
}

function nodeSetupStep(): Record<string, unknown> {
  return {
    name: "Set up the exact Node.js runtime",
    uses: pinnedAction("actions/setup-node"),
    with: {
      "check-latest": false,
      "node-version": "24.18.0",
    },
  };
}

function resolvedRoleAdmissionStep(
  config: CustomerCiWorkflowConfigV1,
): Record<string, unknown> {
  return {
    name: "Validate resolved account and distinct role bindings",
    shell: "bash",
    env: {
      CLOUDMARKUP_AWS_ACCOUNT_ID: expression(
        `vars.${config.variables.awsAccountId}`,
      ),
      CLOUDMARKUP_DEPLOY_ROLE_ARN: expression(
        `vars.${config.variables.deployRoleArn}`,
      ),
      CLOUDMARKUP_DRIFT_ROLE_ARN: expression(
        `vars.${config.variables.driftRoleArn}`,
      ),
      CLOUDMARKUP_PLAN_ROLE_ARN: expression(
        `vars.${config.variables.planRoleArn}`,
      ),
    },
    run: roleAdmissionScript(),
  };
}
function workflowCommitAdmissionStep(
  expectedCommit: string,
): Record<string, unknown> {
  return {
    name: "Bind this workflow and run to the exact reviewed commit",
    shell: "bash",
    env: {
      CLOUDMARKUP_EXPECTED_EXECUTION_COMMIT: expectedCommit,
      CLOUDMARKUP_EXECUTION_RUN_SHA: expression("github.sha"),
      CLOUDMARKUP_EXECUTION_WORKFLOW_SHA: expression("github.workflow_sha"),
    },
    run: workflowCommitAdmissionScript(),
  };
}

function oidcSubjectContextAdmissionStep(
  config: CustomerCiWorkflowConfigV1,
): Record<string, unknown> {
  const oidcSubject = config.repository.oidcSubject;
  const expected = {
    environments: Object.fromEntries(
      config.environments.map(({ githubEnvironment, id }) => [
        id,
        githubEnvironment,
      ]),
    ),
    mode: oidcSubject.mode,
    name: config.repository.name,
    owner: config.repository.owner,
    repositoryId: oidcSubject.repositoryId,
    repositoryOwnerId: oidcSubject.repositoryOwnerId,
    subjectPrefix: oidcSubject.subjectPrefix,
  };
  return {
    name: "Admit the reviewed GitHub OIDC subject context",
    shell: "bash",
    env: {
      CLOUDMARKUP_AWS_REGION: expression(`vars.${config.variables.awsRegion}`),
    },
    run: [
      "node --input-type=module <<'CLOUDMARKUP_OIDC_CONTEXT'",
      `const expected = ${canonicalJson(expected)};`,
      "const fail = () => { throw new Error('The GitHub OIDC subject context or AWS Region does not match the reviewed target.'); };",
      "const idPattern = /^[1-9][0-9]{0,19}$/; const regionPattern = /^[a-z]{2,8}(?:-[a-z0-9]{1,16}){1,4}-[1-9][0-9]?$/;",
      "const repository = process.env.GITHUB_REPOSITORY || ''; const owner = process.env.GITHUB_REPOSITORY_OWNER || ''; const repositoryId = process.env.GITHUB_REPOSITORY_ID || ''; const repositoryOwnerId = process.env.GITHUB_REPOSITORY_OWNER_ID || '';",
      "const parts = repository.split('/'); if (parts.length !== 2) fail(); const repositoryName = parts[1] || '';",
      "if (process.env.GITHUB_ACTIONS !== 'true' || process.env.GITHUB_SERVER_URL !== 'https://github.com' || repository !== `${expected.owner}/${expected.name}` || owner !== expected.owner || repositoryName !== expected.name || !idPattern.test(repositoryId) || !idPattern.test(repositoryOwnerId) || repositoryId !== expected.repositoryId || repositoryOwnerId !== expected.repositoryOwnerId) fail();",
      "const environment = process.env.CLOUDMARKUP_ENVIRONMENT || ''; const githubEnvironment = expected.environments[environment]; if (typeof githubEnvironment !== 'string') fail();",
      "const actualPrefix = expected.mode === 'immutable-owner-and-repository-ids' ? `repo:${owner}@${repositoryOwnerId}/${repositoryName}@${repositoryId}:environment:` : expected.mode === 'legacy-name-based-explicit' ? `repo:${repository}:environment:` : ''; if (!actualPrefix || actualPrefix !== expected.subjectPrefix || !(`${actualPrefix}${githubEnvironment}`).startsWith(expected.subjectPrefix)) fail();",
      "const region = process.env.CLOUDMARKUP_AWS_REGION || ''; if (!regionPattern.test(region) || region.length > 63) fail();",
      "console.log('The reviewed GitHub OIDC context and AWS Region passed pre-token admission.');",
      "CLOUDMARKUP_OIDC_CONTEXT",
    ].join("\n"),
  };
}

function repositoryVisibilityAdmissionStep(
  config: CustomerCiWorkflowConfigV1,
): Record<string, unknown> {
  const expected = {
    fullName: `${config.repository.owner}/${config.repository.name}`,
    name: config.repository.name,
    owner: config.repository.owner,
    repositoryId: config.repository.oidcSubject.repositoryId,
    repositoryOwnerId: config.repository.oidcSubject.repositoryOwnerId,
  };
  const requestUrl = `https://api.github.com/repos/${config.repository.owner}/${config.repository.name}`;
  return {
    name: "Confirm the reviewed repository is still private",
    shell: "bash",
    env: { GITHUB_TOKEN: expression("github.token") },
    run: [
      "node --input-type=module <<'CLOUDMARKUP_REPOSITORY_VISIBILITY'",
      `const expected = ${canonicalJson(expected)}; const requestUrl = ${JSON.stringify(requestUrl)};`,
      "const fail = () => { throw new Error('The reviewed private GitHub repository identity or visibility could not be confirmed.'); }; const token = process.env.GITHUB_TOKEN || ''; if (!token || token.length > 4096 || /[\\u0000-\\u0020\\u007f]/.test(token)) fail();",
      "let response; try { response = await fetch(requestUrl, { headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'User-Agent': 'CloudMarkup-customer-ci-v1', 'X-GitHub-Api-Version': '2022-11-28' }, redirect: 'error', signal: AbortSignal.timeout(10_000) }); } catch { fail(); }",
      "if (!response.ok || response.redirected || response.url !== requestUrl) fail(); const declaredLength = Number(response.headers.get('content-length') || '0'); if (!Number.isSafeInteger(declaredLength) || declaredLength < 0 || declaredLength > 262144) fail();",
      "let raw; let repository; try { raw = await response.text(); if (Buffer.byteLength(raw, 'utf8') > 262144) fail(); repository = JSON.parse(raw); } catch { fail(); }",
      "if (repository === null || typeof repository !== 'object' || Array.isArray(repository) || repository.private !== true || repository.visibility !== 'private' || repository.full_name !== expected.fullName || repository.name !== expected.name || repository.owner?.login !== expected.owner || !Number.isSafeInteger(repository.id) || !Number.isSafeInteger(repository.owner?.id) || String(repository.id) !== expected.repositoryId || String(repository.owner.id) !== expected.repositoryOwnerId) fail();",
      "console.log('The exact reviewed GitHub repository is still private.');",
      "CLOUDMARKUP_REPOSITORY_VISIBILITY",
    ].join("\n"),
  };
}

function packageVerificationSteps(
  config: CustomerCiWorkflowConfigV1,
  includeNodeSetup = true,
  extensionPhase: "validate" | "plan" | "deploy" | "smoke" = "validate",
): Record<string, unknown>[] {
  return [
    {
      name: "Check out the reviewed commit",
      uses: pinnedAction("actions/checkout"),
      with: { "persist-credentials": false },
    },
    ...(includeNodeSetup ? [nodeSetupStep()] : []),
    {
      name: "Verify the immutable Solution package and generated handler build/test Evidence",
      shell: "bash",
      run: packageVerificationScript(config),
    },
    ...(extensionPhase === "validate"
      ? [
          {
            name: "Scan exact manifest-bound application source without credentials",
            shell: "bash",
            run: generatedSourceSecurityVerificationScript(config),
          },
        ]
      : []),
    smokeTestExtensionVerificationStep(config, extensionPhase),
  ];
}

function smokeTestExtensionVerificationStep(
  config: CustomerCiWorkflowConfigV1,
  phase: "validate" | "plan" | "deploy" | "smoke",
): Record<string, unknown> {
  return {
    name: `Validate declarative smoke-test extension metadata for ${phase}`,
    shell: "bash",
    run: smokeTestExtensionVerificationScript(config, phase),
  };
}

function terraformRuntimeValidationSteps(
  config: CustomerCiWorkflowConfigV1,
): Record<string, unknown>[] {
  return [
    {
      name: "Set up the pinned Terraform CLI",
      uses: pinnedAction("hashicorp/setup-terraform"),
      with: {
        terraform_version: config.terraform.version,
        terraform_wrapper: false,
      },
    },
    {
      name: "Verify the Terraform CLI checksum before execution",
      shell: "bash",
      run: terraformCliVerificationScript(config),
    },
    {
      name: "Check Terraform formatting",
      shell: "bash",
      run: `terraform -chdir="${config.terraform.rootDirectory}" fmt -check -recursive`,
    },
    {
      name: "Validate Terraform without a backend or cloud credentials",
      shell: "bash",
      run: [
        `terraform -chdir="${config.terraform.rootDirectory}" init -backend=false -get=false -input=false -lockfile=readonly`,
        `terraform -chdir="${config.terraform.rootDirectory}" validate -no-color`,
      ].join("\n"),
    },
  ];
}

function validationWorkflow(
  config: CustomerCiWorkflowConfigV1,
): Record<string, unknown> {
  const branches = [
    ...new Set(
      config.environments.flatMap(({ approvedBranches }) => approvedBranches),
    ),
  ].sort((left, right) => left.localeCompare(right, "en"));
  return {
    name: "CloudMarkup package validation",
    on: {
      pull_request: {},
      push: { branches },
      workflow_dispatch: {},
    },
    permissions: { contents: "read" },
    jobs: {
      validate: {
        name: "Verify reviewed package without credentials",
        "runs-on": "ubuntu-latest",
        "timeout-minutes": 12,
        steps: packageVerificationSteps(config),
      },
    },
  };
}

function planWorkflow(
  config: CustomerCiWorkflowConfigV1,
): Record<string, unknown> {
  const dev = config.environments.find(({ id }) => id === "dev");
  const environment = expression("inputs.environment || 'dev'");
  const activationGate = [
    "node --input-type=module <<'CLOUDMARKUP_PROMPT33B_GATE'",
    "const distributionState = 'unavailable';",
    "const environmentPolicyState = 'unverified';",
    "if (distributionState !== 'reviewed-installed-verified' || environmentPolicyState !== 'authoritatively-verified') throw new Error('Planning is blocked until the reviewed Prompt 33B CLI distribution and authoritative GitHub Environment policy verification are both available.');",
    "CLOUDMARKUP_PROMPT33B_GATE",
  ].join("\n");
  return {
    name: "CloudMarkup Terraform plan",
    on: {
      push: {
        branches: dev?.approvedBranches ?? [config.repository.defaultBranch],
      },
      workflow_dispatch: {
        inputs: {
          environment: {
            description: "Customer-owned target environment",
            options: ["dev", "staging", "production"],
            required: true,
            type: "choice",
          },
        },
      },
    },
    permissions: { contents: "read" },
    jobs: {
      validate: {
        name: "Verify without cloud or OIDC credentials",
        "runs-on": "ubuntu-latest",
        "timeout-minutes": 12,
        permissions: { contents: "read" },
        env: { CLOUDMARKUP_ENVIRONMENT: environment },
        steps: [
          nodeSetupStep(),
          {
            name: "Admit the repository and branch",
            shell: "bash",
            run: branchAdmissionScript(config, "plan"),
          },
          ...packageVerificationSteps(config, false, "plan"),
          {
            name: "Enforce distribution and environment-policy activation holds",
            shell: "bash",
            run: activationGate,
          },
          ...terraformRuntimeValidationSteps(config),
        ],
      },
      plan: {
        name: "Create a restricted saved plan",
        needs: ["validate"],
        "runs-on": "ubuntu-latest",
        "timeout-minutes": 25,
        environment: {
          name: selectedEnvironmentExpression(
            config,
            "inputs.environment || 'dev'",
          ),
        },
        concurrency: {
          "cancel-in-progress": false,
          group: `cloudmarkup-plan-${expression("inputs.environment || 'dev'")}`,
        },
        permissions: { contents: "read", "id-token": "write" },
        env: {
          CLOUDMARKUP_BACKEND_CONFIG: config.terraform.backend.configPath,
          CLOUDMARKUP_AWS_ACCOUNT_ID: expression(
            `vars.${config.variables.awsAccountId}`,
          ),
          CLOUDMARKUP_AWS_REGION: expression(
            `vars.${config.variables.awsRegion}`,
          ),
          CLOUDMARKUP_DEPLOY_ROLE_ARN: expression(
            `vars.${config.variables.deployRoleArn}`,
          ),
          CLOUDMARKUP_DRIFT_ROLE_ARN: expression(
            `vars.${config.variables.driftRoleArn}`,
          ),
          CLOUDMARKUP_PLAN_ROLE_ARN: expression(
            `vars.${config.variables.planRoleArn}`,
          ),
          CLOUDMARKUP_ENVIRONMENT: environment,
          CLOUDMARKUP_PROVIDER_LOCK: config.terraform.providerLockPath,
          CLOUDMARKUP_TERRAFORM_VERSION: config.terraform.version,
          CLOUDMARKUP_WORKSPACE: selectedWorkspaceExpression(
            config,
            "inputs.environment || 'dev'",
          ),
          TF_IN_AUTOMATION: "true",
          TF_INPUT: "false",
        },
        steps: [
          {
            name: "Admit the repository and branch",
            shell: "bash",
            run: branchAdmissionScript(config, "plan"),
          },
          workflowCommitAdmissionStep(expression("github.sha")),
          repositoryVisibilityAdmissionStep(config),
          oidcSubjectContextAdmissionStep(config),
          resolvedRoleAdmissionStep(config),
          {
            name: "Check out the reviewed commit",
            uses: pinnedAction("actions/checkout"),
            with: { "persist-credentials": false },
          },
          nodeSetupStep(),
          {
            name: "Verify the immutable Solution package tree",
            shell: "bash",
            run: packageVerificationScript(config),
          },
          smokeTestExtensionVerificationStep(config, "plan"),
          {
            name: "Set up the pinned Terraform CLI",
            uses: pinnedAction("hashicorp/setup-terraform"),
            with: {
              terraform_version: config.terraform.version,
              terraform_wrapper: false,
            },
          },
          {
            name: "Verify the Terraform CLI checksum before execution",
            shell: "bash",
            run: terraformCliVerificationScript(config),
          },
          {
            name: "Acquire the customer-owned planning role through OIDC",
            uses: pinnedAction("aws-actions/configure-aws-credentials"),
            with: {
              "allowed-account-ids": expression(
                `vars.${config.variables.awsAccountId}`,
              ),
              audience: "sts.amazonaws.com",
              "aws-region": expression(`vars.${config.variables.awsRegion}`),
              "mask-aws-account-id": true,
              "role-session-name": `cloudmarkup-plan-${expression("github.run_id")}`,
              "role-to-assume": expression(
                `vars.${config.variables.planRoleArn}`,
              ),
              "unset-current-credentials": true,
            },
          },
          {
            name: "Initialize the approved backend and locked providers",
            shell: "bash",
            run: [
              `terraform -chdir="${config.terraform.rootDirectory}" init -backend-config="$GITHUB_WORKSPACE/${config.terraform.backend.configPath}" -get=false -input=false -lockfile=readonly`,
              `terraform -chdir="${config.terraform.rootDirectory}" workspace select "$CLOUDMARKUP_WORKSPACE"`,
            ].join("\n"),
          },
          {
            name: "Create the saved plan; never apply",
            shell: "bash",
            run: [
              "umask 077",
              "set +e",
              `terraform -chdir="${config.terraform.rootDirectory}" plan -input=false -lock-timeout=5m -out="$GITHUB_WORKSPACE/cloudmarkup.tfplan" > "$RUNNER_TEMP/cloudmarkup-plan.log" 2>&1`,
              "status=$?",
              'rm -f "$RUNNER_TEMP/cloudmarkup-plan.log"',
              "set -e",
              'if [ "$status" -ne 0 ]; then echo "::error::Terraform planning failed. Review the customer-owned backend, role, and state outside workflow logs."; exit "$status"; fi',
              'chmod 600 "$GITHUB_WORKSPACE/cloudmarkup.tfplan"',
              "echo 'Terraform produced the restricted saved plan.'",
            ].join("\n"),
          },
          {
            name: "Sanitize and analyze the machine-readable plan",
            shell: "bash",
            run: [
              "umask 077",
              'rm -f cloudmarkup-plan.raw.json cloudmarkup-plan.sanitized.json cloudmarkup-plan.analysis.json "$RUNNER_TEMP/cloudmarkup-show.log"',
              "trap 'rm -f cloudmarkup-plan.raw.json \"$RUNNER_TEMP/cloudmarkup-show.log\"' EXIT INT TERM",
              `if ! terraform -chdir="${config.terraform.rootDirectory}" show -json "$GITHUB_WORKSPACE/cloudmarkup.tfplan" > cloudmarkup-plan.raw.json 2> "$RUNNER_TEMP/cloudmarkup-show.log"; then echo "::error::Terraform plan projection failed; raw output was not logged."; exit 1; fi`,
              'rm -f "$RUNNER_TEMP/cloudmarkup-show.log"',
              planSanitizerScript(),
              "trap - EXIT INT TERM",
            ].join("\n"),
          },
          {
            name: "Encrypt the saved plan with the reviewed customer public key",
            shell: "bash",
            run: planEncryptionScript(config),
          },
          {
            name: "Bind encrypted plan integrity and planning Evidence",
            shell: "bash",
            run: planManifestScript(config, CUSTOMER_CI_POLICY_DIGEST_V1),
          },
          {
            name: "Emit the bounded normalized conformance plan record",
            shell: "bash",
            run: conformancePlanRecordScript(),
          },
          {
            name: "Remove the plaintext saved plan before upload",
            shell: "bash",
            run: "rm -f cloudmarkup.tfplan && test ! -e cloudmarkup.tfplan",
          },
          {
            name: "Upload the restricted saved-plan package",
            uses: pinnedAction("actions/upload-artifact"),
            with: {
              "compression-level": 0,
              "if-no-files-found": "error",
              name: `cloudmarkup-plan-${expression("inputs.environment || 'dev'")}`,
              path: [
                "cloudmarkup.tfplan.encrypted",
                "cloudmarkup-conformance.plan.json",
                "cloudmarkup-plan.manifest.json",
                "cloudmarkup-plan.receipt.json",
                "cloudmarkup-plan.sanitized.json",
                "cloudmarkup-plan.analysis.json",
                "cloudmarkup-plan.evidence.json",
              ].join("\n"),
              "retention-days": config.plan.artifactRetentionDays,
            },
          },
          {
            name: "Publish a sanitized summary",
            shell: "bash",
            run: "node --input-type=module -e \"import { lstatSync, readFileSync } from 'node:fs'; const s=lstatSync('cloudmarkup-plan.analysis.json'); if(s.isSymbolicLink()||!s.isFile()||s.size>8388608) throw new Error('The sanitized plan summary is invalid.'); const b=readFileSync('cloudmarkup-plan.analysis.json'); if(b.byteLength>8388608) throw new Error('The sanitized plan summary is invalid.'); let a; try { a=JSON.parse(b); } catch { throw new Error('The sanitized plan summary is invalid.'); } console.log('### Terraform plan\\n\\n' + Object.entries(a.counts).map(([k,v]) => '- '+k+': '+v).join('\\n'))\" >> \"$GITHUB_STEP_SUMMARY\"",
          },
          {
            if: "always()",
            name: "Remove plaintext and raw plan material from the runner",
            shell: "bash",
            run: 'rm -f cloudmarkup.tfplan cloudmarkup-plan.raw.json "$RUNNER_TEMP/cloudmarkup-plan.log" "$RUNNER_TEMP/cloudmarkup-show.log"',
          },
        ],
      },
    },
  };
}

function deployWorkflow(
  config: CustomerCiWorkflowConfigV1,
): Record<string, unknown> {
  const input = (name: string): string => expression(`inputs.${name}`);
  const savedPlanDirectory = `${expression("runner.temp")}/saved-plan`;
  const predecessorDirectory = `${expression("runner.temp")}/predecessor-deployment`;
  const predecessorSmokeDirectory = `${expression("runner.temp")}/predecessor-smoke`;
  const decryptedPlan = `${expression("runner.temp")}/cloudmarkup-decrypted/cloudmarkup.tfplan`;
  return {
    name: "CloudMarkup exact saved-plan deployment",
    on: {
      workflow_dispatch: {
        inputs: {
          environment: {
            options: ["dev", "staging", "production"],
            required: true,
            type: "choice",
          },
          expected_commit: { required: true, type: "string" },
          expected_manifest_checksum: { required: true, type: "string" },
          expected_plan_checksum: { required: true, type: "string" },
          expected_plan_event: {
            options: ["push", "workflow_dispatch"],
            required: true,
            type: "choice",
          },
          expected_plan_ref: { required: true, type: "string" },
          expected_plan_run_attempt: { required: true, type: "string" },
          expected_revision_digest: { required: true, type: "string" },
          expected_revision_id: { required: true, type: "string" },
          plan_run_id: { required: true, type: "string" },
          predecessor_smoke_receipt_checksum: {
            default: "",
            required: false,
            type: "string",
          },
          predecessor_smoke_run_id: {
            default: "",
            required: false,
            type: "string",
          },
          predecessor_receipt_checksum: {
            default: "",
            required: false,
            type: "string",
          },
          predecessor_run_id: {
            default: "",
            required: false,
            type: "string",
          },
        },
      },
    },
    permissions: { actions: "read", contents: "read", "id-token": "write" },
    jobs: {
      deploy: {
        name: "Apply the exact approved saved plan",
        "runs-on": "ubuntu-latest",
        "timeout-minutes": 30,
        environment: {
          name: selectedEnvironmentExpression(config, "inputs.environment"),
        },
        concurrency: {
          "cancel-in-progress": false,
          group: `cloudmarkup-deploy-${input("environment")}`,
        },
        env: {
          CLOUDMARKUP_BACKEND_CONFIG: config.terraform.backend.configPath,
          CLOUDMARKUP_AWS_ACCOUNT_ID: expression(
            `vars.${config.variables.awsAccountId}`,
          ),
          CLOUDMARKUP_AWS_REGION: expression(
            `vars.${config.variables.awsRegion}`,
          ),
          CLOUDMARKUP_DECRYPTED_PLAN: decryptedPlan,
          CLOUDMARKUP_DEPLOY_ROLE_ARN: expression(
            `vars.${config.variables.deployRoleArn}`,
          ),
          CLOUDMARKUP_DRIFT_ROLE_ARN: expression(
            `vars.${config.variables.driftRoleArn}`,
          ),
          CLOUDMARKUP_PLAN_ROLE_ARN: expression(
            `vars.${config.variables.planRoleArn}`,
          ),
          CLOUDMARKUP_DEPLOY_ENABLED: expression(
            `vars.${config.variables.deployEnabled}`,
          ),
          CLOUDMARKUP_ENVIRONMENT: input("environment"),
          CLOUDMARKUP_PROVIDER_LOCK: config.terraform.providerLockPath,
          CLOUDMARKUP_WORKSPACE: selectedWorkspaceExpression(
            config,
            "inputs.environment",
          ),
          EXPECTED_COMMIT: input("expected_commit"),
          EXPECTED_MANIFEST_CHECKSUM: input("expected_manifest_checksum"),
          EXPECTED_PLAN_CHECKSUM: input("expected_plan_checksum"),
          EXPECTED_REVISION_DIGEST: input("expected_revision_digest"),
          EXPECTED_REVISION_ID: input("expected_revision_id"),
          PREDECESSOR_RECEIPT_DIGEST: input("predecessor_receipt_checksum"),
          PREDECESSOR_RUN_ID: input("predecessor_run_id"),
          PREDECESSOR_SMOKE_RECEIPT_DIGEST: input(
            "predecessor_smoke_receipt_checksum",
          ),
          PREDECESSOR_SMOKE_RUN_ID: input("predecessor_smoke_run_id"),
          SAVED_PLAN_DIRECTORY: savedPlanDirectory,
          TF_IN_AUTOMATION: "true",
          TF_INPUT: "false",
        },
        steps: [
          {
            name: "Admit the repository and branch",
            shell: "bash",
            run: branchAdmissionScript(config, "deploy"),
          },
          workflowCommitAdmissionStep(input("expected_commit")),
          {
            name: "Admit the customer deployment kill switch before any external action",
            shell: "bash",
            run: 'if [ "$CLOUDMARKUP_DEPLOY_ENABLED" != "true" ]; then echo "::error::Customer deployment is disabled by the environment kill switch."; exit 1; fi',
          },
          repositoryVisibilityAdmissionStep(config),
          oidcSubjectContextAdmissionStep(config),
          resolvedRoleAdmissionStep(config),
          nodeSetupStep(),
          {
            id: "promotion",
            name: "Admit the exact promotion predecessor",
            shell: "bash",
            run: promotionAdmissionScript(),
          },
          {
            id: "plan_run",
            name: "Verify the exact successful planning workflow run",
            shell: "bash",
            env: {
              EXPECTED_RUN_ATTEMPT: input("expected_plan_run_attempt"),
              EXPECTED_RUN_COMMIT: input("expected_commit"),
              EXPECTED_RUN_ENVIRONMENT: input("environment"),
              EXPECTED_RUN_EVENT: input("expected_plan_event"),
              EXPECTED_RUN_ID: input("plan_run_id"),
              EXPECTED_RUN_REF: input("expected_plan_ref"),
              GITHUB_TOKEN: expression("github.token"),
            },
            run: githubRunInspectionScript(config, "plan"),
          },
          {
            id: "predecessor_run",
            if: "inputs.environment != 'dev'",
            name: "Verify the exact successful predecessor deployment run",
            shell: "bash",
            env: {
              EXPECTED_RUN_COMMIT: input("expected_commit"),
              EXPECTED_RUN_ENVIRONMENT: expression(
                "steps.promotion.outputs.predecessor_environment",
              ),
              EXPECTED_RUN_EVENT: "workflow_dispatch",
              EXPECTED_RUN_ID: input("predecessor_run_id"),
              GITHUB_TOKEN: expression("github.token"),
            },
            run: githubRunInspectionScript(config, "deploy"),
          },
          {
            id: "predecessor_smoke_run",
            if: "inputs.environment != 'dev'",
            name: "Verify the exact successful predecessor smoke workflow run",
            shell: "bash",
            env: {
              EXPECTED_RUN_COMMIT: input("expected_commit"),
              EXPECTED_RUN_ENVIRONMENT: expression(
                "steps.promotion.outputs.predecessor_environment",
              ),
              EXPECTED_RUN_EVENT: "workflow_dispatch",
              EXPECTED_RUN_ID: input("predecessor_smoke_run_id"),
              GITHUB_TOKEN: expression("github.token"),
            },
            run: githubRunInspectionScript(config, "smoke"),
          },
          {
            name: "Check out the exact planned commit",
            uses: pinnedAction("actions/checkout"),
            with: {
              "persist-credentials": false,
              ref: input("expected_commit"),
            },
          },
          {
            name: "Verify the immutable Solution package tree",
            shell: "bash",
            run: packageVerificationScript(config),
          },
          smokeTestExtensionVerificationStep(config, "deploy"),
          {
            name: "Download the exact saved-plan package",
            uses: pinnedAction("actions/download-artifact"),
            with: {
              "github-token": expression("github.token"),
              name: `cloudmarkup-plan-${input("environment")}`,
              path: savedPlanDirectory,
              "run-id": input("plan_run_id"),
            },
          },
          {
            id: "manifest",
            name: "Inspect the exact downloaded saved-plan manifest",
            shell: "bash",
            env: {
              EXPECTED_PLAN_RUN_ATTEMPT: expression(
                "steps.plan_run.outputs.attempt",
              ),
              EXPECTED_PLAN_RUN_EVENT: expression(
                "steps.plan_run.outputs.event",
              ),
              EXPECTED_PLAN_RUN_ID: expression("steps.plan_run.outputs.run_id"),
              EXPECTED_PLAN_RUN_PATH: expression("steps.plan_run.outputs.path"),
              EXPECTED_PLAN_RUN_REF: expression("steps.plan_run.outputs.ref"),
            },
            run: manifestInspectionScript(config, CUSTOMER_CI_POLICY_DIGEST_V1),
          },
          {
            if: "inputs.environment != 'dev'",
            name: "Download the exact predecessor deployment receipt",
            uses: pinnedAction("actions/download-artifact"),
            with: {
              "github-token": expression("github.token"),
              name: `cloudmarkup-deployment-receipt-${expression("steps.promotion.outputs.predecessor_environment")}`,
              path: predecessorDirectory,
              "run-id": input("predecessor_run_id"),
            },
          },
          {
            id: "predecessor",
            if: "inputs.environment != 'dev'",
            name: "Verify the exact predecessor receipt and promotion chain",
            shell: "bash",
            env: {
              PREDECESSOR_DIRECTORY: predecessorDirectory,
              PREDECESSOR_ENVIRONMENT: expression(
                "steps.promotion.outputs.predecessor_environment",
              ),
            },
            run: predecessorReceiptInspectionScript(config),
          },
          {
            if: "inputs.environment != 'dev'",
            name: "Download the exact passing predecessor smoke artifacts",
            uses: pinnedAction("actions/download-artifact"),
            with: {
              "github-token": expression("github.token"),
              name: `cloudmarkup-smoke-evidence-${expression("steps.promotion.outputs.predecessor_environment")}`,
              path: predecessorSmokeDirectory,
              "run-id": input("predecessor_smoke_run_id"),
            },
          },
          {
            id: "predecessor_smoke",
            if: "inputs.environment != 'dev'",
            name: "Verify the exact passing predecessor smoke receipt",
            shell: "bash",
            env: {
              PREDECESSOR_ENVIRONMENT: expression(
                "steps.promotion.outputs.predecessor_environment",
              ),
              PREDECESSOR_SMOKE_DIRECTORY: predecessorSmokeDirectory,
              PREDECESSOR_TARGET_AUTHORITY_DIGEST: expression(
                "steps.predecessor.outputs.target_authority_digest",
              ),
            },
            run: predecessorSmokeReceiptInspectionScript(config),
          },
          {
            name: "Set up the exact Terraform version",
            uses: pinnedAction("hashicorp/setup-terraform"),
            with: {
              terraform_version: config.terraform.version,
              terraform_wrapper: false,
            },
          },
          {
            name: "Verify the Terraform CLI checksum before execution",
            shell: "bash",
            run: terraformCliVerificationScript(config),
          },
          {
            name: "Decrypt the exact saved plan only inside the approved environment job",
            shell: "bash",
            env: {
              CLOUDMARKUP_PLAN_DECRYPTION_PRIVATE_KEY: expression(
                `secrets.${config.plan.artifactEncryption.privateKeySecretName}`,
              ),
            },
            run: planDecryptionScript(config),
          },
          {
            name: "Verify every saved-plan binding and kill switch",
            shell: "bash",
            run: deployIntegrityScript(config, CUSTOMER_CI_POLICY_DIGEST_V1),
          },
          {
            name: "Acquire the customer-owned deployment role through OIDC",
            uses: pinnedAction("aws-actions/configure-aws-credentials"),
            with: {
              "allowed-account-ids": expression(
                `vars.${config.variables.awsAccountId}`,
              ),
              audience: "sts.amazonaws.com",
              "aws-region": expression(`vars.${config.variables.awsRegion}`),
              "mask-aws-account-id": true,
              "role-session-name": `cloudmarkup-deploy-${expression("github.run_id")}`,
              "role-to-assume": expression(
                `vars.${config.variables.deployRoleArn}`,
              ),
              "unset-current-credentials": true,
            },
          },
          {
            name: "Initialize only the approved backend and workspace",
            shell: "bash",
            run: [
              `terraform -chdir="${config.terraform.rootDirectory}" init -backend-config="$GITHUB_WORKSPACE/${config.terraform.backend.configPath}" -get=false -input=false -lockfile=readonly`,
              `terraform -chdir="${config.terraform.rootDirectory}" workspace select "$CLOUDMARKUP_WORKSPACE"`,
            ].join("\n"),
          },
          {
            name: "Apply the exact saved plan; no fresh plan is allowed",
            shell: "bash",
            run: [
              "umask 077",
              "set -euo pipefail",
              savedPlanExpiryAdmissionScript(),
              "set +e",
              `terraform -chdir="${config.terraform.rootDirectory}" apply -input=false -lock-timeout=5m "$CLOUDMARKUP_DECRYPTED_PLAN" > "$RUNNER_TEMP/cloudmarkup-apply.log" 2>&1`,
              "status=$?",
              'rm -f "$RUNNER_TEMP/cloudmarkup-apply.log"',
              "set -e",
              'if [ "$status" -ne 0 ]; then echo "::error::Applying the approved saved plan failed. Use the customer incident and target-specific recovery procedure."; exit "$status"; fi',
              "echo 'Terraform applied the exact approved saved plan.'",
            ].join("\n"),
          },
          {
            name: "Record the deployment receipt",
            shell: "bash",
            env: {
              PREDECESSOR_RECEIPT_DIGEST: expression(
                "steps.predecessor.outputs.receipt_digest",
              ),
              PROMOTION_PREDECESSOR_SMOKE_RECEIPT_DIGEST: expression(
                "steps.predecessor_smoke.outputs.receipt_digest",
              ),
            },
            run: deployReceiptScript(),
          },
          {
            name: "Emit the bounded normalized deployment conformance record",
            shell: "bash",
            run: conformanceDeploymentRecordScript(),
          },
          {
            name: "Upload only the deployment receipt and bounded conformance record",
            uses: pinnedAction("actions/upload-artifact"),
            with: {
              "if-no-files-found": "error",
              name: `cloudmarkup-deployment-receipt-${input("environment")}`,
              path: [
                "cloudmarkup-deployment.receipt.json",
                "cloudmarkup-conformance.deployment.json",
              ].join("\n"),
              "retention-days": config.plan.artifactRetentionDays,
            },
          },
          {
            if: "always()",
            name: "Remove the decrypted plan and apply log from the runner",
            shell: "bash",
            run: 'rm -f "$CLOUDMARKUP_DECRYPTED_PLAN" "$RUNNER_TEMP/cloudmarkup-apply.log"',
          },
        ],
      },
    },
  };
}

function smokeResultScript(config: CustomerCiWorkflowConfigV1): string {
  return [
    "node --input-type=module <<'CLOUDMARKUP_SMOKE_RESULT'",
    "import { createHash } from 'node:crypto';",
    "import { lstat, readFile, writeFile } from 'node:fs/promises';",
    "import { resolve } from 'node:path';",
    "const digest = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;",
    "const ordered = (value) => Array.isArray(value) ? value.map(ordered) : value !== null && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, ordered(value[key])])) : value; const canonical = (value) => `${JSON.stringify(ordered(value), null, 2)}\\n`; const readBounded = async (path, maximum) => { const stat = await lstat(path); if (stat.isSymbolicLink() || !stat.isFile() || stat.size > maximum) throw new Error('The deployment conformance predecessor is invalid.'); const bytes = await readFile(path); if (bytes.byteLength > maximum) throw new Error('The deployment conformance predecessor is invalid.'); return bytes; };",
    "const requiredDigest = (label, value) => { if (!/^sha256:[a-f0-9]{64}$/.test(value || '')) throw new Error(`${label} is not a valid content digest.`); return value; };",
    "const deploymentReceiptDigest = requiredDigest('The deployment receipt digest', process.env.DEPLOYMENT_RECEIPT_DIGEST);",
    "const revisionDigest = requiredDigest('The deployed revision digest', process.env.DEPLOYED_REVISION_DIGEST); const targetAuthorityDigest = requiredDigest('The target authority digest', process.env.TARGET_AUTHORITY_DIGEST);",
    "const deployedCommit = process.env.DEPLOYED_COMMIT || ''; const environment = process.env.CLOUDMARKUP_ENVIRONMENT || ''; const revisionId = process.env.DEPLOYED_REVISION_ID || '';",
    "if (!/^[a-f0-9]{40}$/.test(deployedCommit) || !['dev', 'staging', 'production'].includes(environment) || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(revisionId)) throw new Error('The verified deployment binding is malformed.');",
    "const targetMode = process.env.SMOKE_TARGET_MODE; if (targetMode !== 'read-only') throw new Error('The smoke target mode is unsupported.');",
    "const passed = process.env.SMOKE_OUTCOME === 'success'; const status = passed ? 'passed' : 'failed'; const now = new Date().toISOString(); const solutionRevision = { digest: revisionDigest, id: revisionId };",
    `const result = { attemptLimit: ${String(config.smoke.maxAttempts)}, contractVersion: 1, deployedCommit, deploymentReceiptDigest, deploymentRunId: process.env.DEPLOYMENT_RUN_ID, environment, kind: 'cloudmarkup.customer-ci-sanitized-smoke-result', rawResponseRetained: false, requestTimeoutSeconds: ${String(config.smoke.requestTimeoutSeconds)}, resourceLifecycle: 'none', solutionRevision, status, targetAuthorityDigest, targetMode };`,
    "const resultBytes = Buffer.from(JSON.stringify(result) + '\\n'); if (resultBytes.byteLength > 8388608) throw new Error('The sanitized smoke result exceeds its artifact limit.'); const resultDigest = digest(resultBytes); await writeFile('cloudmarkup-smoke.result.json', resultBytes, { flag: 'wx' });",
    "const receipt = { commitSha: deployedCommit, contractVersion: 1, createdAt: now, environment, idempotencyKey: `smoke-${deploymentReceiptDigest.slice(7, 39)}-${environment}-${targetMode}`, inputDigests: [deploymentReceiptDigest, targetAuthorityDigest], kind: 'cloudmarkup.customer-ci-stage-receipt', outputDigests: [resultDigest], predecessorReceiptDigest: deploymentReceiptDigest, receiptId: `receipt-smoke-${process.env.GITHUB_RUN_ID}-${environment}`, solutionRevision, stage: 'smoke', status, targetAuthorityDigest };",
    "const receiptBytes = Buffer.from(JSON.stringify(receipt) + '\\n'); if (receiptBytes.byteLength > 131072) throw new Error('The smoke receipt exceeds its artifact limit.'); const receiptDigest = digest(receiptBytes); await writeFile('cloudmarkup-smoke.receipt.json', receiptBytes, { flag: 'wx' });",
    "const evidence = { artifacts: [{ digest: resultDigest, mediaType: 'application/json', sizeBytes: resultBytes.byteLength }, { digest: receiptDigest, mediaType: 'application/json', sizeBytes: receiptBytes.byteLength }], checks: [{ artifactDigests: [resultDigest, receiptDigest], checkId: 'customer-ci.bounded-smoke', issueIds: [], status, summary: passed ? 'The approved bounded smoke check passed against the exact deployed revision.' : 'The approved bounded smoke check failed against the exact deployed revision.', ...(passed ? {} : { redactedFailure: 'The bounded endpoint check failed; raw response data was not retained.' }) }], ciIdentity: `github:${process.env.GITHUB_REPOSITORY}:run:${process.env.GITHUB_RUN_ID}`, contractVersion: 1, environment: { environmentId: environment, environmentType: environment === 'dev' ? 'development' : environment }, id: `evidence-smoke-${process.env.GITHUB_RUN_ID}-${environment}`, layer: 'deployed', level: { kind: 'deployment-smoke-integration', rank: 7 }, models: [], provenance: { actor: { ciIdentity: `github:${process.env.GITHUB_REPOSITORY}:run:${process.env.GITHUB_RUN_ID}`, kind: 'ci' }, createdAt: now, inputDigests: [deploymentReceiptDigest, resultDigest, receiptDigest] }, solutionRevisionId: revisionId, staleness: { assessedAt: now, state: 'current' }, tools: [] };",
    "const evidenceBytes = Buffer.from(JSON.stringify(evidence) + '\\n'); if (evidenceBytes.byteLength > 8388608) throw new Error('The smoke Evidence exceeds its artifact limit.'); await writeFile('cloudmarkup-smoke.evidence.json', evidenceBytes, { flag: 'wx' });",
    "const deploymentDirectory = resolve(process.env.DEPLOYMENT_DIRECTORY || ''); const deploymentReceiptBytes = await readBounded(resolve(deploymentDirectory, 'cloudmarkup-deployment.receipt.json'), 131072); const predecessorBytes = await readBounded(resolve(deploymentDirectory, 'cloudmarkup-conformance.deployment.json'), 8388608); let predecessor; try { predecessor = JSON.parse(predecessorBytes); } catch { throw new Error('The deployment conformance predecessor is invalid.'); } const { evidenceChecksum: predecessorEvidenceChecksum, ...predecessorProjection } = predecessor;",
    "const predecessorChecks = { checksum: digest(Buffer.from(canonical(predecessorProjection))) === predecessorEvidenceChecksum, commit: predecessor.commitSha === deployedCommit, completeness: predecessor.completeness === 'partial', environment: predecessor.environmentId === environment, issues: Array.isArray(predecessor.issues), kind: predecessor.kind === 'cloudmarkup.normalized-deployment-conformance', receipt: digest(deploymentReceiptBytes) === deploymentReceiptDigest, revision: predecessor.solutionRevision?.id === revisionId && predecessor.solutionRevision?.digest === revisionDigest, smoke: predecessor.smoke?.state === 'not-run' }; const failedPredecessorChecks = Object.entries(predecessorChecks).filter(([, valid]) => !valid).map(([name]) => name); if (failedPredecessorChecks.length > 0) throw new Error(`The deployment conformance predecessor is invalid: ${failedPredecessorChecks.join(',')}.`);",
    "const successorProjection = { ...predecessorProjection, issues: predecessor.issues.filter((issue) => issue.code !== 'CONFORMANCE_DEPLOYMENT_SMOKE_MISSING'), observedAt: now, smoke: { evidenceDigest: digest(evidenceBytes), state: status } }; const successor = { ...successorProjection, evidenceChecksum: digest(Buffer.from(canonical(successorProjection))) }; const successorBytes = Buffer.from(canonical(successor)); if (successorBytes.byteLength > 8388608) throw new Error('The smoke-complete deployment conformance record exceeds its artifact limit.'); await writeFile('cloudmarkup-conformance.deployment.smoke.json', successorBytes, { flag: 'wx', mode: 0o600 });",
    "CLOUDMARKUP_SMOKE_RESULT",
  ].join("\n");
}

function smokeWorkflow(
  config: CustomerCiWorkflowConfigV1,
): Record<string, unknown> {
  const input = (name: string): string => expression(`inputs.${name}`);
  const deploymentDirectory = `${expression("runner.temp")}/deployment`;
  const inputs: Record<string, unknown> = {
    environment: {
      options: ["dev", "staging", "production"],
      required: true,
      type: "choice",
    },
  };
  return {
    name: "CloudMarkup bounded smoke checks",
    on: { workflow_dispatch: { inputs } },
    permissions: {
      actions: "read",
      contents: "read",
    },
    jobs: {
      smoke: {
        name: "Run production-safe read-only smoke checks",
        "runs-on": "ubuntu-latest",
        "timeout-minutes": 8,
        environment: {
          name: selectedEnvironmentExpression(config, "inputs.environment"),
        },
        concurrency: {
          "cancel-in-progress": false,
          group: `cloudmarkup-smoke-${input("environment")}`,
        },
        permissions: {
          actions: "read",
          contents: "read",
        },
        env: {
          CLOUDMARKUP_AWS_ACCOUNT_ID: expression(
            `vars.${config.variables.awsAccountId}`,
          ),
          CLOUDMARKUP_AWS_REGION: expression(
            `vars.${config.variables.awsRegion}`,
          ),
          CLOUDMARKUP_DEPLOY_ROLE_ARN: expression(
            `vars.${config.variables.deployRoleArn}`,
          ),
          CLOUDMARKUP_DRIFT_ROLE_ARN: expression(
            `vars.${config.variables.driftRoleArn}`,
          ),
          CLOUDMARKUP_PLAN_ROLE_ARN: expression(
            `vars.${config.variables.planRoleArn}`,
          ),
          CLOUDMARKUP_ENVIRONMENT: input("environment"),
          CLOUDMARKUP_SMOKE_BASE_URL: expression(
            `vars.${config.variables.smokeBaseUrl}`,
          ),
          CLOUDMARKUP_SMOKE_HEALTH_PATH: config.smoke.healthPath,
          DEPLOYMENT_DIRECTORY: deploymentDirectory,
          DEPLOYMENT_RUN_ID: expression(
            `vars.${config.variables.deploymentRunId}`,
          ),
          EXPECTED_DEPLOYED_COMMIT: expression(
            `vars.${config.variables.deployedCommit}`,
          ),
          EXPECTED_DEPLOYED_REVISION_DIGEST: expression(
            `vars.${config.variables.deployedRevisionDigest}`,
          ),
          EXPECTED_DEPLOYMENT_RECEIPT_DIGEST: expression(
            `vars.${config.variables.deploymentReceiptDigest}`,
          ),
          EXPECTED_DEPLOYMENT_RUN_ID: expression(
            `vars.${config.variables.deploymentRunId}`,
          ),
          SMOKE_TARGET_MODE: "read-only",
        },
        steps: [
          {
            name: "Admit the repository and branch",
            shell: "bash",
            run: branchAdmissionScript(config, "smoke"),
          },
          workflowCommitAdmissionStep(
            expression(`vars.${config.variables.deployedCommit}`),
          ),
          repositoryVisibilityAdmissionStep(config),
          nodeSetupStep(),
          {
            id: "deployment_run",
            name: "Verify the exact successful deployment workflow run",
            shell: "bash",
            env: {
              EXPECTED_RUN_COMMIT: expression(
                `vars.${config.variables.deployedCommit}`,
              ),
              EXPECTED_RUN_ENVIRONMENT: input("environment"),
              EXPECTED_RUN_EVENT: "workflow_dispatch",
              EXPECTED_RUN_ID: expression(
                `vars.${config.variables.deploymentRunId}`,
              ),
              GITHUB_TOKEN: expression("github.token"),
            },
            run: githubRunInspectionScript(config, "deploy"),
          },
          {
            name: "Check out the exact deployed commit",
            uses: pinnedAction("actions/checkout"),
            with: {
              "persist-credentials": false,
              ref: expression(`vars.${config.variables.deployedCommit}`),
            },
          },
          {
            name: "Verify the immutable deployed Solution package tree",
            shell: "bash",
            run: packageVerificationScript(config),
          },
          smokeTestExtensionVerificationStep(config, "smoke"),
          {
            name: "Download the exact deployment receipt",
            uses: pinnedAction("actions/download-artifact"),
            with: {
              "github-token": expression("github.token"),
              name: `cloudmarkup-deployment-receipt-${input("environment")}`,
              path: deploymentDirectory,
              "run-id": expression(`vars.${config.variables.deploymentRunId}`),
            },
          },
          {
            id: "deployment",
            name: "Verify the exact deployment receipt and revision",
            shell: "bash",
            run: deploymentReceiptInspectionScript(config),
          },
          {
            id: "smoke",
            name: "Probe only the approved HTTPS health endpoint",
            shell: "bash",
            run: [
              "set -euo pipefail",
              'resolve_file="$RUNNER_TEMP/cloudmarkup-smoke-resolve"',
              'rm -f "$resolve_file"',
              "trap 'rm -f \"$resolve_file\"' EXIT INT TERM",
              'export CLOUDMARKUP_SMOKE_RESOLVE_FILE="$resolve_file"',
              "node --input-type=module <<'CLOUDMARKUP_ENDPOINT'",
              "import { createHash } from 'node:crypto';",
              "import { Resolver } from 'node:dns/promises';",
              "import { writeFile } from 'node:fs/promises';",
              "import { isIP } from 'node:net';",
              "import { isAbsolute, relative, resolve, sep } from 'node:path';",
              `const expectedDigests = ${canonicalJson(Object.fromEntries(config.environments.map(({ id, smokeBaseUrlDigest }) => [id, smokeBaseUrlDigest])))};`,
              "const raw = process.env.CLOUDMARKUP_SMOKE_BASE_URL || ''; const environment = process.env.CLOUDMARKUP_ENVIRONMENT || ''; const expectedDigest = expectedDigests[environment];",
              "if (Buffer.byteLength(raw, 'utf8') > 2048 || raw.trim() !== raw || /[\\u0000-\\u0020\\u007f]/.test(raw)) throw new Error('The approved smoke base URL is malformed.');",
              "const actualDigest = `sha256:${createHash('sha256').update(Buffer.from(raw)).digest('hex')}`; if (!/^sha256:[a-f0-9]{64}$/.test(expectedDigest || '') || actualDigest !== expectedDigest) throw new Error('The smoke target does not match the reviewed environment configuration.');",
              "let url; try { url = new URL(raw); } catch { throw new Error('The approved smoke base URL is malformed.'); }",
              "const hostname = url.hostname.toLowerCase(); const labels = hostname.split('.'); const ipLiteral = /^\\d{1,3}(?:\\.\\d{1,3}){3}$/.test(hostname) || hostname.includes(':'); const publicDnsName = !ipLiteral && labels.length >= 2 && labels.every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));",
              "if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || (url.port && url.port !== '443') || !publicDnsName || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname.endsWith('.internal')) throw new Error('The approved smoke base URL must use public DNS over HTTPS port 443 with no credentials, query, or fragment.');",
              "if (!/^\\/[A-Za-z0-9._~!&'()*+,;=:@%/-]*$/.test(url.pathname) || url.pathname.includes('..') || url.pathname.includes('//') || (url.pathname !== '/' && url.pathname.endsWith('/'))) throw new Error('The approved smoke base URL path is unsupported.');",
              "const dnsFail = () => { throw new Error('The approved smoke hostname did not resolve exclusively to global addresses.'); };",
              "const globalIpv4 = (address) => { if (isIP(address) !== 4) return false; const [a, b, c] = address.split('.').map(Number); if (a === undefined || b === undefined || c === undefined || a === 0 || a === 10 || a === 127 || a >= 224) return false; if (a === 100 && b >= 64 && b <= 127) return false; if (a === 169 && b === 254) return false; if (a === 172 && b >= 16 && b <= 31) return false; if (a === 192 && b === 0 && c === 0) return false; if (a === 192 && b === 0 && c === 2) return false; if (a === 192 && b === 88 && c === 99) return false; if (a === 192 && b === 168) return false; if (a === 198 && (b === 18 || b === 19)) return false; if (a === 198 && b === 51 && c === 100) return false; if (a === 203 && b === 0 && c === 113) return false; return true; };",
              "const ipv6Parts = (address) => { if (isIP(address) !== 6 || address.includes('.') || address.includes('%')) return undefined; const halves = address.toLowerCase().split('::'); if (halves.length > 2) return undefined; const left = halves[0] ? halves[0].split(':') : []; const right = halves.length === 2 && halves[1] ? halves[1].split(':') : []; const missing = 8 - left.length - right.length; if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return undefined; const parts = [...left, ...Array.from({ length: missing }, () => '0'), ...right].map((part) => Number.parseInt(part, 16)); return parts.length === 8 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 0xffff) ? parts : undefined; };",
              "const globalIpv6 = (address) => { const parts = ipv6Parts(address); if (!parts) return false; const first = parts[0]; const second = parts[1]; if (first === undefined || second === undefined || (first & 0xe000) !== 0x2000) return false; if (first === 0x2001 && (second <= 0x01ff || second === 0x0db8)) return false; if (first === 0x2002 || first === 0x3ffe) return false; if (first === 0x3fff && (second & 0xf000) === 0) return false; return true; };",
              "const resolver = new Resolver(); const absentCodes = new Set(['ENODATA', 'ENOTFOUND']); const query = async (family) => { try { const values = family === 4 ? await resolver.resolve4(hostname) : await resolver.resolve6(hostname); if (!Array.isArray(values)) dnsFail(); return values; } catch (error) { if (error && typeof error === 'object' && absentCodes.has(error.code)) return []; dnsFail(); } };",
              "const timer = setTimeout(() => resolver.cancel(), 5_000); timer.unref(); let ipv4; let ipv6; try { [ipv4, ipv6] = await Promise.all([query(4), query(6)]); } finally { clearTimeout(timer); }",
              "const records = [...ipv4.map((address) => ({ address, family: 4 })), ...ipv6.map((address) => ({ address, family: 6 }))]; if (records.length < 1 || records.length > 32 || records.some(({ address, family }) => family === 4 ? !globalIpv4(address) : !globalIpv6(address))) dnsFail();",
              "const unique = [...new Map(records.map((record) => [`${record.family}:${record.address}`, record])).values()].sort((left, right) => left.family - right.family || left.address.localeCompare(right.address, 'en')); const selected = unique[0]; if (!selected) dnsFail();",
              "const output = resolve(process.env.CLOUDMARKUP_SMOKE_RESOLVE_FILE || ''); const runnerTemp = resolve(process.env.RUNNER_TEMP || ''); const outputRelation = relative(runnerTemp, output); if (!process.env.RUNNER_TEMP || !process.env.CLOUDMARKUP_SMOKE_RESOLVE_FILE || !outputRelation || outputRelation.startsWith(`..${sep}`) || isAbsolute(outputRelation)) dnsFail();",
              "const curlAddress = selected.family === 6 ? `[${selected.address}]` : selected.address; await writeFile(output, `${hostname}:443:${curlAddress}\\n`, { flag: 'wx', mode: 0o600 });",
              "console.log('The exact reviewed public HTTPS smoke target passed admission.');",
              "CLOUDMARKUP_ENDPOINT",
              'resolve_entry="$(< "$resolve_file")"',
              'rm -f "$resolve_file"',
              "trap - EXIT INT TERM",
              'if [ -z "$resolve_entry" ]; then echo "::error::The bounded smoke check failed; target and response details were not logged."; exit 1; fi',
              `if ! code="$(curl --disable --silent --output /dev/null --write-out '%{http_code}' --proto '=https' --proto-redir '=https' --max-redirs 0 --noproxy '*' --proxy '' --resolve "$resolve_entry" --connect-timeout ${String(config.smoke.requestTimeoutSeconds)} --max-time ${String(config.smoke.requestTimeoutSeconds)} --retry ${String(config.smoke.maxAttempts - 1)} --retry-all-errors "$CLOUDMARKUP_SMOKE_BASE_URL$CLOUDMARKUP_SMOKE_HEALTH_PATH" 2> /dev/null)"; then echo "::error::The bounded smoke check failed; target and response details were not logged."; exit 1; fi`,
              'case "$code" in 2??) ;; *) echo "::error::The bounded smoke check failed; target and response details were not logged."; exit 1 ;; esac',
            ].join("\n"),
          },
          {
            name: "Record sanitized smoke result, stage receipt, and Evidence",
            if: "always() && steps.deployment.outcome == 'success' && steps.smoke.outcome != 'skipped'",
            shell: "bash",
            run: smokeResultScript(config),
            env: {
              DEPLOYED_COMMIT: expression("steps.deployment.outputs.commit"),
              DEPLOYED_REVISION_DIGEST: expression(
                "steps.deployment.outputs.revision_digest",
              ),
              DEPLOYED_REVISION_ID: expression(
                "steps.deployment.outputs.revision_id",
              ),
              DEPLOYMENT_RECEIPT_DIGEST: expression(
                "steps.deployment.outputs.receipt_digest",
              ),
              SMOKE_OUTCOME: expression("steps.smoke.outcome"),
              TARGET_AUTHORITY_DIGEST: expression(
                "steps.deployment.outputs.target_authority_digest",
              ),
            },
          },
          {
            name: "Upload only sanitized smoke artifacts",
            if: "always() && steps.deployment.outcome == 'success' && steps.smoke.outcome != 'skipped'",
            uses: pinnedAction("actions/upload-artifact"),
            with: {
              "if-no-files-found": "error",
              name: `cloudmarkup-smoke-evidence-${input("environment")}`,
              path: [
                "cloudmarkup-smoke.result.json",
                "cloudmarkup-smoke.receipt.json",
                "cloudmarkup-smoke.evidence.json",
                "cloudmarkup-conformance.deployment.smoke.json",
              ].join("\n"),
              "retention-days": config.plan.artifactRetentionDays,
            },
          },
        ],
      },
    },
  };
}

function driftResultScript(config: CustomerCiWorkflowConfigV1): string {
  return [
    "node --input-type=module <<'CLOUDMARKUP_DRIFT_RESULT'",
    "import { createHash } from 'node:crypto';",
    "import { lstat, readFile, rm, writeFile } from 'node:fs/promises';",
    "const digest = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`; const readBounded = async (path, maximum) => { const stat = await lstat(path); if (stat.isSymbolicLink() || !stat.isFile() || stat.size > maximum) throw new Error('The sanitized drift artifact exceeds its limit.'); const bytes = await readFile(path); if (bytes.byteLength > maximum) throw new Error('The sanitized drift artifact exceeds its limit.'); return bytes; };",
    "const requiredDigest = (label, value) => { if (!/^sha256:[a-f0-9]{64}$/.test(value || '')) throw new Error(`${label} is not a valid content digest.`); return value; };",
    "const deploymentReceiptDigest = requiredDigest('The deployment receipt digest', process.env.DEPLOYMENT_RECEIPT_DIGEST); const revisionDigest = requiredDigest('The deployed revision digest', process.env.DEPLOYED_REVISION_DIGEST); const targetAuthorityDigest = requiredDigest('The target authority digest', process.env.TARGET_AUTHORITY_DIGEST);",
    "const deployedCommit = process.env.DEPLOYED_COMMIT || ''; const environment = process.env.CLOUDMARKUP_ENVIRONMENT || ''; const revisionId = process.env.DEPLOYED_REVISION_ID || '';",
    "if (!/^[a-f0-9]{40}$/.test(deployedCommit) || !['dev', 'staging', 'production'].includes(environment) || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(revisionId)) throw new Error('The verified deployment binding is malformed.');",
    "const sanitizedBytes = await readBounded('cloudmarkup-plan.sanitized.json', 8388608); const analysisBytes = await readBounded('cloudmarkup-plan.analysis.json', 8388608); let analysis; try { analysis = JSON.parse(analysisBytes); } catch { throw new Error('The sanitized drift analysis is unsupported.'); }",
    "if (analysis.contractVersion !== 1 || analysis.kind !== 'cloudmarkup.terraform-semantic-plan-analysis') throw new Error('The sanitized drift analysis is unsupported.');",
    "const sanitizedPlanDigest = digest(sanitizedBytes); const analysisDigest = digest(analysisBytes); const now = new Date().toISOString(); const driftDetected = process.env.DRIFT_EXIT_CODE === '2'; const solutionRevision = { digest: revisionDigest, id: revisionId };",
    "const result = { analysisDigest, contractVersion: 1, deployedCommit, deploymentReceiptDigest, deploymentRunId: process.env.DEPLOYMENT_RUN_ID, driftDetected, environment, kind: 'cloudmarkup.customer-ci-sanitized-drift-result', rawPlanRetained: false, sanitizedPlanDigest, solutionRevision, status: 'passed', summary: analysis.counts, targetAuthorityDigest };",
    "const resultBytes = Buffer.from(JSON.stringify(result) + '\\n'); if (resultBytes.byteLength > 8388608) throw new Error('The sanitized drift result exceeds its artifact limit.'); const resultDigest = digest(resultBytes); await writeFile('cloudmarkup-drift.result.json', resultBytes, { flag: 'wx' });",
    "const receipt = { commitSha: deployedCommit, contractVersion: 1, createdAt: now, environment, idempotencyKey: `drift-${deploymentReceiptDigest.slice(7, 39)}-${environment}-${process.env.GITHUB_RUN_ID}`, inputDigests: [deploymentReceiptDigest, targetAuthorityDigest], kind: 'cloudmarkup.customer-ci-stage-receipt', outputDigests: [analysisDigest, sanitizedPlanDigest, resultDigest], predecessorReceiptDigest: deploymentReceiptDigest, receiptId: `receipt-drift-${process.env.GITHUB_RUN_ID}-${environment}`, solutionRevision, stage: 'drift', status: 'passed', targetAuthorityDigest };",
    "const receiptBytes = Buffer.from(JSON.stringify(receipt) + '\\n'); if (receiptBytes.byteLength > 131072) throw new Error('The drift receipt exceeds its artifact limit.'); const receiptDigest = digest(receiptBytes); await writeFile('cloudmarkup-drift.receipt.json', receiptBytes, { flag: 'wx' });",
    `let lock; try { lock = JSON.parse(await readBounded(${JSON.stringify(packageFilePath(config, "cloudmarkup/cloudmarkup.lock.json"))}, 131072)); } catch { throw new Error('The drift result, deployed receipt, and Solution package do not match.'); } if (lock.solutionRevision?.id !== revisionId || lock.solutionRevision?.digest !== revisionDigest) throw new Error('The drift result, deployed receipt, and Solution package do not match.');`,
    "const evidence = { artifacts: [{ digest: sanitizedPlanDigest, mediaType: 'application/json', sizeBytes: sanitizedBytes.byteLength }, { digest: analysisDigest, mediaType: 'application/json', sizeBytes: analysisBytes.byteLength }, { digest: resultDigest, mediaType: 'application/json', sizeBytes: resultBytes.byteLength }, { digest: receiptDigest, mediaType: 'application/json', sizeBytes: receiptBytes.byteLength }], checks: [{ artifactDigests: [sanitizedPlanDigest, analysisDigest, resultDigest, receiptDigest], checkId: 'customer-ci.read-only-drift', issueIds: [], status: 'passed', summary: driftDetected ? 'Read-only refresh found drift that needs review.' : 'Read-only refresh found no drift.' }], ciIdentity: `github:${process.env.GITHUB_REPOSITORY}:run:${process.env.GITHUB_RUN_ID}`, contractVersion: 1, environment: { environmentId: environment, environmentType: environment === 'dev' ? 'development' : environment }, id: `evidence-drift-${process.env.GITHUB_RUN_ID}-${environment}`, layer: 'deployed', level: { kind: 'deployed-drift', rank: 9 }, models: [], provenance: { actor: { ciIdentity: `github:${process.env.GITHUB_REPOSITORY}:run:${process.env.GITHUB_RUN_ID}`, kind: 'ci' }, createdAt: now, inputDigests: [deploymentReceiptDigest, sanitizedPlanDigest, analysisDigest, resultDigest, receiptDigest] }, solutionRevisionId: revisionId, staleness: { assessedAt: now, state: 'current' }, tools: [{ id: 'hashicorp.terraform', version: " +
      JSON.stringify(config.terraform.version) +
      " }] };",
    "const evidenceBytes = Buffer.from(JSON.stringify(evidence) + '\\n'); if (evidenceBytes.byteLength > 8388608) throw new Error('The drift Evidence exceeds its artifact limit.'); await writeFile('cloudmarkup-drift.evidence.json', evidenceBytes, { flag: 'wx' }); await rm('cloudmarkup-drift.tfplan');",
    "CLOUDMARKUP_DRIFT_RESULT",
  ].join("\n");
}

function driftWorkflow(
  config: CustomerCiWorkflowConfigV1,
): Record<string, unknown> {
  const deploymentDirectory = `${expression("runner.temp")}/deployment`;
  return {
    name: "CloudMarkup read-only drift inspection",
    on: { schedule: [{ cron: config.drift.cron }], workflow_dispatch: {} },
    permissions: {
      actions: "read",
      contents: "read",
      "id-token": "write",
    },
    jobs: {
      drift: {
        name: "Inspect refresh-only drift from the exact deployed revision",
        "runs-on": "ubuntu-latest",
        "timeout-minutes": 25,
        strategy: {
          "fail-fast": false,
          matrix: { environment: ["dev", "staging", "production"] },
          "max-parallel": 1,
        },
        environment: {
          name: selectedEnvironmentExpression(config, "matrix.environment"),
        },
        concurrency: {
          "cancel-in-progress": false,
          group: `cloudmarkup-drift-${expression("matrix.environment")}`,
        },
        permissions: {
          actions: "read",
          contents: "read",
          "id-token": "write",
        },
        env: {
          CLOUDMARKUP_AWS_ACCOUNT_ID: expression(
            `vars.${config.variables.awsAccountId}`,
          ),
          CLOUDMARKUP_AWS_REGION: expression(
            `vars.${config.variables.awsRegion}`,
          ),
          CLOUDMARKUP_DEPLOY_ROLE_ARN: expression(
            `vars.${config.variables.deployRoleArn}`,
          ),
          CLOUDMARKUP_DRIFT_ROLE_ARN: expression(
            `vars.${config.variables.driftRoleArn}`,
          ),
          CLOUDMARKUP_PLAN_ROLE_ARN: expression(
            `vars.${config.variables.planRoleArn}`,
          ),
          CLOUDMARKUP_ENVIRONMENT: expression("matrix.environment"),
          CLOUDMARKUP_WORKSPACE: selectedWorkspaceExpression(
            config,
            "matrix.environment",
          ),
          DEPLOYMENT_DIRECTORY: deploymentDirectory,
          DEPLOYMENT_RUN_ID: expression(
            `vars.${config.variables.deploymentRunId}`,
          ),
          EXPECTED_DEPLOYED_COMMIT: expression(
            `vars.${config.variables.deployedCommit}`,
          ),
          EXPECTED_DEPLOYED_REVISION_DIGEST: expression(
            `vars.${config.variables.deployedRevisionDigest}`,
          ),
          EXPECTED_DEPLOYMENT_RECEIPT_DIGEST: expression(
            `vars.${config.variables.deploymentReceiptDigest}`,
          ),
          EXPECTED_DEPLOYMENT_RUN_ID: expression(
            `vars.${config.variables.deploymentRunId}`,
          ),
          TF_IN_AUTOMATION: "true",
          TF_INPUT: "false",
        },
        steps: [
          {
            name: "Admit the exact repository and scheduled or manual ref",
            shell: "bash",
            run: branchAdmissionScript(config, "drift"),
          },
          workflowCommitAdmissionStep(
            expression(`vars.${config.variables.deployedCommit}`),
          ),
          repositoryVisibilityAdmissionStep(config),
          oidcSubjectContextAdmissionStep(config),
          resolvedRoleAdmissionStep(config),
          nodeSetupStep(),
          {
            id: "deployment_run",
            name: "Verify the exact successful deployment workflow run",
            shell: "bash",
            env: {
              EXPECTED_RUN_COMMIT: expression(
                `vars.${config.variables.deployedCommit}`,
              ),
              EXPECTED_RUN_ENVIRONMENT: expression("matrix.environment"),
              EXPECTED_RUN_EVENT: "workflow_dispatch",
              EXPECTED_RUN_ID: expression(
                `vars.${config.variables.deploymentRunId}`,
              ),
              GITHUB_TOKEN: expression("github.token"),
            },
            run: githubRunInspectionScript(config, "deploy"),
          },
          {
            name: "Check out the exact deployed commit",
            uses: pinnedAction("actions/checkout"),
            with: {
              "persist-credentials": false,
              ref: expression(`vars.${config.variables.deployedCommit}`),
            },
          },
          {
            name: "Verify the immutable deployed Solution package tree",
            shell: "bash",
            run: packageVerificationScript(config),
          },
          {
            name: "Download the environment-scoped deployment receipt",
            uses: pinnedAction("actions/download-artifact"),
            with: {
              "github-token": expression("github.token"),
              name: `cloudmarkup-deployment-receipt-${expression("matrix.environment")}`,
              path: deploymentDirectory,
              "run-id": expression(`vars.${config.variables.deploymentRunId}`),
            },
          },
          {
            id: "deployment",
            name: "Verify the exact deployed receipt, commit, and revision",
            shell: "bash",
            run: deploymentReceiptInspectionScript(config),
          },
          {
            name: "Set up the pinned Terraform CLI",
            uses: pinnedAction("hashicorp/setup-terraform"),
            with: {
              terraform_version: config.terraform.version,
              terraform_wrapper: false,
            },
          },
          {
            name: "Verify the Terraform CLI checksum before execution",
            shell: "bash",
            run: terraformCliVerificationScript(config),
          },
          {
            name: "Acquire the customer-owned read-only drift role through OIDC",
            uses: pinnedAction("aws-actions/configure-aws-credentials"),
            with: {
              "allowed-account-ids": expression(
                `vars.${config.variables.awsAccountId}`,
              ),
              audience: "sts.amazonaws.com",
              "aws-region": expression(`vars.${config.variables.awsRegion}`),
              "mask-aws-account-id": true,
              "role-session-name": `cloudmarkup-drift-${expression("github.run_id")}`,
              "role-to-assume": expression(
                `vars.${config.variables.driftRoleArn}`,
              ),
              "unset-current-credentials": true,
            },
          },
          {
            name: "Initialize the approved backend and workspace",
            shell: "bash",
            run: [
              `terraform -chdir="${config.terraform.rootDirectory}" init -backend-config="$GITHUB_WORKSPACE/${config.terraform.backend.configPath}" -get=false -input=false -lockfile=readonly`,
              `terraform -chdir="${config.terraform.rootDirectory}" workspace select "$CLOUDMARKUP_WORKSPACE"`,
            ].join("\n"),
          },
          {
            id: "drift",
            name: "Inspect refresh-only drift; never apply",
            shell: "bash",
            run: [
              "umask 077",
              "set +e",
              `terraform -chdir="${config.terraform.rootDirectory}" plan -refresh-only -detailed-exitcode -input=false -lock-timeout=5m -out="$GITHUB_WORKSPACE/cloudmarkup-drift.tfplan" > "$RUNNER_TEMP/cloudmarkup-drift.log" 2>&1`,
              "status=$?",
              'rm -f "$RUNNER_TEMP/cloudmarkup-drift.log"',
              "set -e",
              'if [ "$status" -ne 0 ] && [ "$status" -ne 2 ]; then echo "::error::Read-only drift inspection failed; raw Terraform output was not logged."; exit "$status"; fi',
              'chmod 600 "$GITHUB_WORKSPACE/cloudmarkup-drift.tfplan"',
              'rm -f cloudmarkup-plan.raw.json cloudmarkup-plan.sanitized.json cloudmarkup-plan.analysis.json "$RUNNER_TEMP/cloudmarkup-show.log"',
              "trap 'rm -f cloudmarkup-plan.raw.json \"$RUNNER_TEMP/cloudmarkup-show.log\"' EXIT INT TERM",
              `if ! terraform -chdir="${config.terraform.rootDirectory}" show -json "$GITHUB_WORKSPACE/cloudmarkup-drift.tfplan" > cloudmarkup-plan.raw.json 2> "$RUNNER_TEMP/cloudmarkup-show.log"; then echo "::error::Terraform drift projection failed; raw output was not logged."; exit 1; fi`,
              'rm -f "$RUNNER_TEMP/cloudmarkup-show.log"',
              planSanitizerScript(),
              "trap - EXIT INT TERM",
              'echo "exit_code=$status" >> "$GITHUB_OUTPUT"',
            ].join("\n"),
          },
          {
            name: "Create sanitized drift result, stage receipt, and Evidence",
            shell: "bash",
            env: {
              DEPLOYED_COMMIT: expression("steps.deployment.outputs.commit"),
              DEPLOYED_REVISION_DIGEST: expression(
                "steps.deployment.outputs.revision_digest",
              ),
              DEPLOYED_REVISION_ID: expression(
                "steps.deployment.outputs.revision_id",
              ),
              DEPLOYMENT_RECEIPT_DIGEST: expression(
                "steps.deployment.outputs.receipt_digest",
              ),
              DRIFT_EXIT_CODE: expression("steps.drift.outputs.exit_code"),
              TARGET_AUTHORITY_DIGEST: expression(
                "steps.deployment.outputs.target_authority_digest",
              ),
            },
            run: driftResultScript(config),
          },
          {
            name: "Emit the bounded normalized drift conformance record",
            shell: "bash",
            env: {
              DEPLOYMENT_EVIDENCE_CHECKSUM: expression(
                "steps.deployment.outputs.conformance_evidence_checksum",
              ),
            },
            run: conformanceDriftRecordScript(),
          },
          {
            name: "Upload only sanitized drift artifacts",
            uses: pinnedAction("actions/upload-artifact"),
            with: {
              "if-no-files-found": "error",
              name: `cloudmarkup-drift-${expression("matrix.environment")}`,
              path: [
                "cloudmarkup-conformance.drift.json",
                "cloudmarkup-plan.sanitized.json",
                "cloudmarkup-plan.analysis.json",
                "cloudmarkup-drift.result.json",
                "cloudmarkup-drift.receipt.json",
                "cloudmarkup-drift.evidence.json",
              ].join("\n"),
              "retention-days": config.plan.artifactRetentionDays,
            },
          },
          {
            if: "always()",
            name: "Remove drift plan and raw material from the runner",
            shell: "bash",
            run: 'rm -f cloudmarkup-drift.tfplan cloudmarkup-plan.raw.json "$RUNNER_TEMP/cloudmarkup-drift.log" "$RUNNER_TEMP/cloudmarkup-show.log"',
          },
        ],
      },
    },
  };
}
function workflowFile(
  kind: CustomerCiWorkflowKindV1,
  content: string,
): CustomerCiWorkflowFileV1 {
  return {
    checksum: sha256(content),
    content,
    mediaType: "application/yaml",
    path: CUSTOMER_CI_WORKFLOW_PATHS[kind],
    semanticChecksum: sha256(content.replaceAll("\r\n", "\n")),
    workflowKind: kind,
  };
}

function buildPreview(config: CustomerCiWorkflowConfigV1) {
  const rolePurposes = [
    ["plan", config.variables.planRoleArn],
    ["deploy", config.variables.deployRoleArn],
    ["drift-read-only", config.variables.driftRoleArn],
  ] as const;
  const roles = config.environments.flatMap((environment) =>
    rolePurposes.map(([purpose, variable]) => ({
      audience: "sts.amazonaws.com" as const,
      environment: environment.id,
      purpose,
      subject: `${config.repository.oidcSubject.subjectPrefix}${environment.githubEnvironment}`,
      variable,
    })),
  );
  return {
    environments: config.environments.map((environment) => ({
      approvedRefs: environment.approvedBranches.map(
        (branch) => `refs/heads/${branch}`,
      ),
      githubEnvironment: environment.githubEnvironment,
      id: environment.id,
      protected: environment.protected,
      requiredApprovals: environment.requiredApprovals,
      smokeBaseUrlDigest: environment.smokeBaseUrlDigest,
      workspace: environment.workspace,
    })),
    permissionExplanation:
      "GitHub requires Workflows write permission only to add these reviewed files. CloudMarkup does not request AWS credentials, run the workflows, merge the pull request, or deploy.",
    oidcSubject: {
      audience: "sts.amazonaws.com" as const,
      issuer: "https://token.actions.githubusercontent.com" as const,
      mode: config.repository.oidcSubject.mode,
      repositoryId: config.repository.oidcSubject.repositoryId,
      repositoryOwnerId: config.repository.oidcSubject.repositoryOwnerId,
      subjectPrefix: config.repository.oidcSubject.subjectPrefix,
      trustConditionOperator: "StringEquals" as const,
    },
    requiredSecrets: [config.plan.artifactEncryption.privateKeySecretName],
    smokeTestExtensions: config.smoke.extensions,
    requiredVariables: [
      config.variables.awsAccountId,
      config.variables.awsRegion,
      config.variables.deployEnabled,
      config.variables.deployRoleArn,
      config.variables.deployedCommit,
      config.variables.deployedRevisionDigest,
      config.variables.deploymentReceiptDigest,
      config.variables.deploymentRunId,
      config.variables.driftRoleArn,
      config.variables.planRoleArn,
      config.variables.smokeBaseUrl,
    ].sort((left, right) => left.localeCompare(right, "en")),
    roles,
    warnings: [
      "Before requesting an OIDC token, credentialed jobs verify GitHub.com, the reviewed repository and owner names, immutable repository and owner IDs, environment mapping, AWS Region, account, and all three distinct role ARNs. They cannot inspect the token subject or repository OIDC setting before token issuance.",
      "Configure every AWS role trust policy with StringEquals for token.actions.githubusercontent.com:aud and the exact reviewed token.actions.githubusercontent.com:sub shown here. Custom GitHub subject templates are unsupported.",
      ...(config.repository.oidcSubject.mode ===
      "immutable-owner-and-repository-ids"
        ? [
            "Confirm this GitHub repository uses immutable subject claims. New repositories and repositories renamed or transferred after July 15, 2026 use the owner-ID and repository-ID format; older repositories must explicitly opt in before these roles can be assumed.",
          ]
        : [
            "Legacy name-based OIDC subjects were explicitly selected. A repository rename, transfer, or name reuse can invalidate or reassign name-based trust; stop the workflows and re-review the GitHub OIDC setting, repository identity, and every AWS trust policy before continuing.",
          ]),
      "Role ARNs and account IDs are non-secret GitHub Environment variables; use placeholders until the customer approves exact values.",
      "Terraform state, locks, approvals, artifact access, retention, and workflow execution remain customer-controlled.",
      "Saved plans can contain sensitive values. This profile requires a private repository, uploads only an encrypted envelope, and uses the named environment secret only to decrypt inside an approved deployment job.",
      "Keep the plan decryption private key only in protected GitHub Environments; never expose it to pull requests, planning jobs, logs, summaries, or CloudMarkup.",
      "Promotion creates and approves a separate environment-bound plan; plan artifacts are never reused across environments.",
      "Each environment's smoke URL variable must exactly match its reviewed digest. This v1 profile permits only public DNS over HTTPS port 443, performs no discovery, follows no redirects, and retains no response body.",
      "Declarative smoke-test extension specifications are checksum-bound metadata. Generated workflows validate their identity and bytes but never execute repository-selected commands; the customer must implement and review the application-specific probe.",
      "There is no generic rollback. Recovery is an application- and infrastructure-specific customer procedure.",
      "Ephemeral smoke mode is unsupported in v1 until a separately reviewed authenticated, account-bound, and budgeted target contract exists.",
      "Beta and production activation remain blocked until both the Prompt 33B CLI distribution and authoritative GitHub Environment policy verification are implemented and reviewed.",
    ],
    workflowPermissionRequired: true as const,
    workflows: [
      {
        environmentScoped: false,
        kind: "validate" as const,
        path: CUSTOMER_CI_WORKFLOW_PATHS.validate,
        permissions: ["contents: read"],
        purpose:
          "Verify the exact package inventory, generated handler build/test Evidence, and declarative smoke-test metadata without credentials or repository-selected commands on pull requests.",
        triggers: ["pull_request", "push", "workflow_dispatch"],
      },
      {
        environmentScoped: true,
        kind: "plan" as const,
        path: CUSTOMER_CI_WORKFLOW_PATHS.plan,
        permissions: ["contents: read", "id-token: write"],
        purpose:
          "Validate checksum-bound smoke-test extension metadata, assume a planning-only OIDC role, and publish a sanitized revision-bound saved plan.",
        triggers: ["push: approved dev branches", "workflow_dispatch"],
      },
      {
        environmentScoped: true,
        kind: "deploy" as const,
        path: CUSTOMER_CI_WORKFLOW_PATHS.deploy,
        permissions: ["actions: read", "contents: read", "id-token: write"],
        purpose:
          "After environment approval, validate checksum-bound smoke-test extension metadata and apply only the exact unexpired saved plan.",
        triggers: ["workflow_dispatch"],
      },
      {
        environmentScoped: true,
        kind: "smoke" as const,
        path: CUSTOMER_CI_WORKFLOW_PATHS.smoke,
        permissions: ["actions: read", "contents: read"],
        purpose:
          "Verify the exact deployed receipt and commit, then perform a bounded unauthenticated HTTPS health check without cloud credentials.",
        triggers: ["workflow_dispatch"],
      },
      {
        environmentScoped: true,
        kind: "drift" as const,
        path: CUSTOMER_CI_WORKFLOW_PATHS.drift,
        permissions: ["actions: read", "contents: read", "id-token: write"],
        purpose:
          "Verify the environment-scoped deployed receipt and commit, then use a read-only role for refresh-only drift inspection and sanitized Evidence.",
        triggers: ["schedule", "workflow_dispatch"],
      },
    ],
  };
}

export function generateCustomerCiWorkflowSetV1(
  input: unknown,
): CustomerCiWorkflowResultV1 {
  const config = customerCiWorkflowConfigV1Schema.parse(input);
  const files = [
    workflowFile(
      "validate",
      yamlWorkflow("validate", validationWorkflow(config)),
    ),
    workflowFile("plan", yamlWorkflow("plan", planWorkflow(config))),
    workflowFile("deploy", yamlWorkflow("deploy", deployWorkflow(config))),
    workflowFile("smoke", yamlWorkflow("smoke", smokeWorkflow(config))),
    workflowFile("drift", yamlWorkflow("drift", driftWorkflow(config))),
  ].sort((left, right) => left.path.localeCompare(right.path, "en"));
  return customerCiWorkflowResultV1Schema.parse({
    contractVersion: 1,
    manifest: {
      actionPins: CUSTOMER_CI_ACTION_PINS_V1,
      configDigest: sha256(canonicalJson(config)),
      contractVersion: 1,
      files,
      generator: {
        digest: CUSTOMER_CI_GENERATOR_DIGEST_V1,
        id: GENERATOR_ID,
        version: GENERATOR_VERSION,
      },
      kind: "cloudmarkup.customer-ci-workflow-manifest",
      pinRegistryDigest: CUSTOMER_CI_PIN_REGISTRY_DIGEST_V1,
      policyDigest: CUSTOMER_CI_POLICY_DIGEST_V1,
      solutionRevision: config.solutionRevision,
    },
    preview: buildPreview(config),
  });
}

export function validateCustomerCiWorkflowSetV1(
  configInput: unknown,
  resultInput: unknown,
): { readonly issues: readonly CustomerCiIssueV1[]; readonly valid: boolean } {
  const config = customerCiWorkflowConfigV1Schema.safeParse(configInput);
  if (!config.success) {
    return {
      issues: [
        safeIssue(
          "CUSTOMER_CI_CONFIG_INVALID",
          "The workflow configuration is invalid and no reviewed workflow set can be established.",
        ),
      ],
      valid: false,
    };
  }
  const candidate = customerCiWorkflowResultV1Schema.safeParse(resultInput);
  if (!candidate.success) {
    return {
      issues: [
        safeIssue(
          "CUSTOMER_CI_OUTPUT_MALFORMED",
          "The workflow output is malformed or exceeds a supported limit.",
        ),
      ],
      valid: false,
    };
  }
  const expected = generateCustomerCiWorkflowSetV1(config.data);
  const issues: CustomerCiIssueV1[] = [];
  if (canonicalJson(candidate.data) !== canonicalJson(expected)) {
    issues.push(
      safeIssue(
        "CUSTOMER_CI_RESULT_BINDING_INVALID",
        "The workflow result differs from the exact deterministic regeneration for this configuration and Solution Revision.",
      ),
    );
  }
  const expectedByPath = new Map(
    expected.manifest.files.map((file) => [file.path, file]),
  );
  for (const file of candidate.data.manifest.files) {
    const reviewed = expectedByPath.get(file.path);
    if (
      reviewed?.content !== file.content ||
      reviewed.checksum !== file.checksum ||
      reviewed.semanticChecksum !== file.semanticChecksum
    ) {
      issues.push(
        safeIssue(
          "CUSTOMER_CI_WORKFLOW_CHANGED",
          "This workflow no longer matches the reviewed deterministic template. Regenerate it before export.",
          file.path,
        ),
      );
    }
    if (containsCredentialShape(file.content)) {
      issues.push(
        safeIssue(
          "CUSTOMER_CI_CREDENTIAL_REJECTED",
          "A workflow contains a long-lived credential shape. Use the environment-scoped OIDC role instead.",
          file.path,
        ),
      );
    }
    if (/pull_request_target\s*:/.test(file.content)) {
      issues.push(
        safeIssue(
          "CUSTOMER_CI_UNTRUSTED_TRIGGER_REJECTED",
          "The workflow cannot use pull_request_target because untrusted pull requests must never receive credentials.",
          file.path,
        ),
      );
    }
    const secretPattern = /\$\{\{\s*secrets\.([A-Z][A-Z0-9_]{2,63})\s*\}\}/gu;
    const secretReferences = [...file.content.matchAll(secretPattern)].map(
      (match) => match[1],
    );
    const remainingSecretSyntax = file.content.replace(secretPattern, "");
    const expectedSecret =
      config.data.plan.artifactEncryption.privateKeySecretName;
    if (
      /secrets\./iu.test(remainingSecretSyntax) ||
      (file.workflowKind === "deploy"
        ? secretReferences.length !== 1 ||
          secretReferences[0] !== expectedSecret
        : secretReferences.length !== 0)
    ) {
      issues.push(
        safeIssue(
          "CUSTOMER_CI_SECRET_REFERENCE_REJECTED",
          "Only the reviewed environment-scoped saved-plan decryption key may be read, and only by the deployment workflow.",
          file.path,
        ),
      );
    }
    const actionReferences = [
      ...file.content.matchAll(/uses:\s+([^\s#]+)/g),
    ].map((match) => match[1]);
    const approved = new Set(
      CUSTOMER_CI_ACTION_PINS_V1.map(
        ({ action, commit }) => `${action}@${commit}`,
      ),
    );
    if (actionReferences.some((reference) => !approved.has(reference ?? ""))) {
      issues.push(
        safeIssue(
          "CUSTOMER_CI_ACTION_PIN_REJECTED",
          "The workflow references an action that is not pinned to the reviewed commit registry.",
          file.path,
        ),
      );
    }
    if (
      file.workflowKind === "plan" &&
      /(?:^|\n)\s*(?:run:\s*)?terraform(?:\s+-chdir=\S+)?\s+apply(?:\s|$)/.test(
        file.content,
      )
    ) {
      issues.push(
        safeIssue(
          "CUSTOMER_CI_PLAN_APPLY_REJECTED",
          "The planning workflow may create a plan but can never apply it.",
          file.path,
        ),
      );
    }
    if (
      file.workflowKind === "deploy" &&
      /(?:^|\n)\s*(?:run:\s*)?terraform(?:\s+-chdir=\S+)?\s+plan(?:\s|$)/.test(
        file.content,
      )
    ) {
      issues.push(
        safeIssue(
          "CUSTOMER_CI_DEPLOY_REPLAN_REJECTED",
          "The deployment workflow must consume the approved saved plan and cannot create a fresh plan.",
          file.path,
        ),
      );
    }
    if (
      file.workflowKind === "drift" &&
      (!file.content.includes("-refresh-only") ||
        /(?:^|\n)\s*(?:run:\s*)?terraform(?:\s+-chdir=\S+)?\s+apply(?:\s|$)/.test(
          file.content,
        ))
    ) {
      issues.push(
        safeIssue(
          "CUSTOMER_CI_DRIFT_AUTHORITY_REJECTED",
          "Drift inspection must remain refresh-only and can never apply changes.",
          file.path,
        ),
      );
    }
    if (
      file.workflowKind === "validate" &&
      (file.content.includes("id-token: write") ||
        file.content.includes("configure-aws-credentials"))
    ) {
      issues.push(
        safeIssue(
          "CUSTOMER_CI_PR_CREDENTIAL_REJECTED",
          "Pull-request validation must run without OIDC or cloud credentials.",
          file.path,
        ),
      );
    }
  }
  if (
    candidate.data.manifest.policyDigest !== CUSTOMER_CI_POLICY_DIGEST_V1 ||
    candidate.data.manifest.pinRegistryDigest !==
      CUSTOMER_CI_PIN_REGISTRY_DIGEST_V1 ||
    candidate.data.manifest.configDigest !== expected.manifest.configDigest
  ) {
    issues.push(
      safeIssue(
        "CUSTOMER_CI_MANIFEST_BINDING_INVALID",
        "The workflow manifest does not bind the current configuration, policy, and action registry.",
      ),
    );
  }
  return { issues, valid: issues.length === 0 };
}
