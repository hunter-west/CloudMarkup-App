import {
  CUSTOMER_CI_WORKFLOW_PATHS,
  customerCiWorkflowConfigV1Schema,
  savedTerraformPlanExpectedV1Schema,
  savedTerraformPlanManifestV1Schema,
  type CustomerCiWorkflowConfigV1,
  type SavedTerraformPlanExpectedV1,
  type SavedTerraformPlanManifestV1,
} from "./contracts.js";
import { sha256 } from "./security.js";

const TEST_PLAN_ENCRYPTION_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBojANBgkqhkiG9w0BAQEFAAOCAY8AMIIBigKCAYEA1oagDgvmyZ3XW1AH1HBb
QLYeRjM71VGB9tue/y7Yp9vXDFCv6PhDVAu1hK+oYunCrdECyIRnQ/23xItqwfFa
EkO3ZgDqiO6Auvxo7aq13bLq6NT93+Qh6TV6hM1509ZgVEYk6LmbFJhyVS7n+YfH
0KBbprs1CEMQdVvOHjtZlWXFLWlmQ9E6xso86oNvtirl0FganVuzaAMlIP+AdwFI
BgLaFqa5gp8j+6zuuA1M07GWwmUdBC5shNEM7pZpBhXeF8h4pOD9HWt+AHVfpdZ8
VT30M4oXQOrqMaZmMRRASFzWFCQW4wrLxJnF6NwjF/hdaZZ94L7+I5NU8+LbEsXH
sD+woH/+y0iW/fcoIZiSlToQj3NUJwkfZvc/8BXYdFBMgM7+jp6MuyYJ8GL6je8U
hs+kEjLK2HGcOJGGJZQOefGJZbUoBETQ4FE5PlTXmlquuLszLLEVgkpxRJnDxw/D
H/qwUm5Zp3jKDpza57St34SoUc7C5Z+60P3N2kTxX0uxAgMBAAE=
-----END PUBLIC KEY-----
`;

export const CUSTOMER_CI_TEST_BACKEND_CONFIG_V1 = [
  'bucket = "cloudmarkup-customer-state"',
  'key = "solutions/notes/terraform.tfstate"',
  'region = "us-east-1"',
  "encrypt = true",
  "use_lockfile = true",
  'workspace_key_prefix = "cloudmarkup/notes"',
  "",
].join("\n");

export function createCustomerCiWorkflowTestConfigV1(): CustomerCiWorkflowConfigV1 {
  return customerCiWorkflowConfigV1Schema.parse({
    contractVersion: 1,
    drift: {
      cron: "17 4 * * 1",
      evidencePolicy: "artifact-only",
    },
    environments: [
      {
        approvedBranches: ["main", "feature/review"],
        githubEnvironment: "cloudmarkup-dev",
        id: "dev",
        protected: false,
        requiredApprovals: 0,
        smokeBaseUrlDigest: sha256("https://dev.example.test"),
        workspace: "notes_dev",
      },
      {
        approvedBranches: ["main", "release/staging"],
        githubEnvironment: "cloudmarkup-staging",
        id: "staging",
        protected: true,
        requiredApprovals: 1,
        smokeBaseUrlDigest: sha256("https://staging.example.test"),
        workspace: "notes_staging",
      },
      {
        approvedBranches: ["main"],
        githubEnvironment: "cloudmarkup-production",
        id: "production",
        protected: true,
        requiredApprovals: 2,
        smokeBaseUrlDigest: sha256("https://production.example.test"),
        workspace: "notes_production",
      },
    ],
    generatorProfile: "github-actions-aws-terraform-v1",
    plan: {
      artifactEncryption: {
        algorithm: "rsa-oaep-sha256-aes-256-gcm-v1",
        privateKeySecretName: "CLOUDMARKUP_PLAN_DECRYPTION_PRIVATE_KEY",
        publicKeyPem: TEST_PLAN_ENCRYPTION_PUBLIC_KEY,
      },
      artifactRetentionDays: 7,
      expiresAfterMinutes: 60,
    },
    repository: {
      defaultBranch: "main",
      destinationFolder: "solutions/notes",
      name: "customer-repository",
      oidcSubject: {
        mode: "immutable-owner-and-repository-ids",
        repositoryId: "987654321",
        repositoryOwnerId: "1234567",
        subjectPrefix:
          "repo:customer-organization@1234567/customer-repository@987654321:environment:",
      },
      owner: "customer-organization",
      visibility: "private",
    },
    smoke: {
      allowEphemeral: false,
      healthPath: "/healthz",
      maxAttempts: 4,
      requestTimeoutSeconds: 5,
    },
    solutionRevision: {
      digest: sha256("solution-revision"),
      id: "solution-revision-0040a",
    },
    terraform: {
      allowedProviderSources: ["hashicorp/aws"],
      backend: {
        configPath: "solutions/notes/infrastructure/terraform/backend.hcl",
        contractVersion: 1,
        encryption: "required",
        locking: "s3-native-lockfile",
        type: "aws-s3",
        workspaceIsolation: "workspace-key-prefix",
      },
      cliSha256LinuxAmd64: sha256("terraform-linux-amd64-1.15.8"),
      packageTreeDigest: sha256("reviewed-terraform-package-tree"),
      providerLockPath:
        "solutions/notes/infrastructure/terraform/.terraform.lock.hcl",
      rootDirectory: "solutions/notes/infrastructure/terraform",
      version: "1.15.8",
    },
    variables: {
      awsAccountId: "CLOUDMARKUP_AWS_ACCOUNT_ID",
      awsRegion: "CLOUDMARKUP_AWS_REGION",
      deployEnabled: "CLOUDMARKUP_DEPLOY_ENABLED",
      deployedCommit: "CLOUDMARKUP_DEPLOYED_COMMIT",
      deployedRevisionDigest: "CLOUDMARKUP_DEPLOYED_REVISION_DIGEST",
      deploymentReceiptDigest: "CLOUDMARKUP_DEPLOYMENT_RECEIPT_DIGEST",
      deploymentRunId: "CLOUDMARKUP_DEPLOYMENT_RUN_ID",
      deployRoleArn: "CLOUDMARKUP_DEPLOY_ROLE_ARN",
      driftRoleArn: "CLOUDMARKUP_DRIFT_ROLE_ARN",
      planRoleArn: "CLOUDMARKUP_PLAN_ROLE_ARN",
      smokeBaseUrl: "CLOUDMARKUP_SMOKE_BASE_URL",
    },
  });
}

export function createSavedTerraformPlanTestPairV1(): Readonly<{
  expected: SavedTerraformPlanExpectedV1;
  manifest: SavedTerraformPlanManifestV1;
}> {
  const config = createCustomerCiWorkflowTestConfigV1();
  const shared = {
    backendConfigDigest: sha256("backend-config"),
    commitSha: "0123456789abcdef0123456789abcdef01234567",
    encryptedPlanChecksum: sha256("encrypted-saved-terraform-plan"),
    environment: "dev" as const,
    environmentConfigDigest: sha256("dev-environment-config"),
    infrastructureArtifactDigest: sha256("infrastructure-artifact"),
    planChecksum: sha256("saved-terraform-plan"),
    planRunAttempt: 1,
    planRunEvent: "workflow_dispatch" as const,
    planRunId: "400100",
    planRunPath: CUSTOMER_CI_WORKFLOW_PATHS.plan,
    planRunRef: "refs/heads/main",
    planEncryption: {
      algorithm: "rsa-oaep-sha256-aes-256-gcm-v1" as const,
      publicKeyDigest: sha256("plan-encryption-public-key"),
    },
    providerLockHash: sha256("terraform-provider-lock"),
    sanitizedPlanChecksum: sha256("sanitized-terraform-plan"),
    semanticAnalysisChecksum: sha256("semantic-plan-analysis"),
    solutionExportManifestDigest: sha256("solution-export-manifest"),
    solutionRepositoryLockDigest: sha256("solution-repository-lock"),
    solutionRevision: config.solutionRevision,
    targetAuthority: {
      accountId: "123456789012",
      deployRoleArnDigest: sha256("deploy-role"),
      driftRoleArnDigest: sha256("drift-role"),
      oidcSubject:
        "repo:customer-organization@1234567/customer-repository@987654321:environment:cloudmarkup-dev",
      partition: "aws" as const,
      planRoleArnDigest: sha256("plan-role"),
      region: "us-east-1",
    },
    terraformVersion: config.terraform.version,
    workflowConfigDigest: sha256("customer-ci-workflow-config"),
    workflowPolicyDigest: sha256("customer-ci-workflow-policy"),
    workspace: "notes_dev",
  };
  return {
    expected: savedTerraformPlanExpectedV1Schema.parse({
      ...shared,
      artifactName: "cloudmarkup-plan-dev",
      now: "2026-08-24T12:15:00.000Z",
    }),
    manifest: savedTerraformPlanManifestV1Schema.parse({
      ...shared,
      artifactName: "cloudmarkup-plan-dev",
      contractVersion: 1,
      createdAt: "2026-08-24T12:00:00.000Z",
      expiresAt: "2026-08-24T13:00:00.000Z",
      kind: "cloudmarkup.saved-terraform-plan",
    }),
  };
}
