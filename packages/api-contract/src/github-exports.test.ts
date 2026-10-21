import { describe, expect, it } from "vitest";

import {
  createGithubExportPreviewV1Schema,
  completeGithubAppInstallationLinkV1Schema,
  createGithubAppInstallationLinkIntentV1Schema,
  executeGithubExportV1Schema,
  githubExportPreviewV1Schema,
  githubExportRepositoryWorkflowsV1Schema,
  githubInstallationLinkIntentV1Schema,
} from "./github-exports.js";

const digest = `sha256:${"a".repeat(64)}`;
const commitSha = "b".repeat(40);

const repositoryWorkflows = githubExportRepositoryWorkflowsV1Schema.parse({
  configDigest: digest,
  contractVersion: 1,
  dependencyLockDigests: [{ digest, id: "pnpm-lock" }],
  files: [
    {
      checksum: digest,
      mediaType: "application/yaml",
      ownership: "generated-replaceable",
      path: ".github/workflows/cloudmarkup-validate.yml",
      provenance: {
        producer: {
          digest,
          id: "cloudmarkup.customer-ci-workflow",
          version: "1.0.0",
        },
        solutionRevisionId: "solution-revision-0040a",
        sourceReferences: [
          { id: "solution-revision-0040a", kind: "solution-revision" },
        ],
      },
      semanticChecksum: digest,
      sizeBytes: 360,
    },
  ],
  generator: {
    digest,
    id: "cloudmarkup.customer-ci-workflow",
    version: "1.0.0",
  },
  inclusionPolicy: "explicit-workflow-permission-and-confirmation-required",
  kind: "cloudmarkup.reviewed-repository-workflows",
  pinRegistryDigest: digest,
  policyDigest: digest,
  repository: {
    defaultBranch: "main",
    destinationFolder: "solutions/notes",
    name: "customer-repository",
    owner: "example-org",
    repositoryId: "900",
    repositoryOwnerId: "500",
    state: "bound",
  },
  requiredPackageTrees: [
    {
      files: [{ checksum: digest, path: "infrastructure/main.tf" }],
      root: "infrastructure",
    },
  ],
  resultDigest: digest,
  review: {
    environments: [
      {
        approvedRefs: ["refs/heads/main"],
        githubEnvironment: "development",
        id: "dev",
        protected: true,
        requiredApprovals: 1,
        smokeBaseUrlDigest: digest,
        workspace: "dev",
      },
    ],
    permissions: [
      {
        access: "read",
        explanation: "Reads only the exact reviewed package.",
        scope: "contents",
        workflowPath: ".github/workflows/cloudmarkup-validate.yml",
      },
    ],
    roles: [
      {
        audience: "sts.amazonaws.com",
        environment: "dev",
        purpose: "plan",
        reference: "vars.CLOUDMARKUP_PLAN_ROLE_ARN",
        subject: "repo:example-org/customer-repository:environment:development",
        variable: "CLOUDMARKUP_PLAN_ROLE_ARN",
      },
    ],
    secrets: [
      {
        name: "CUSTOMER_APPROVAL_TOKEN",
        purpose: "Customer-owned approval integration.",
      },
    ],
    triggers: [
      {
        events: ["pull_request"],
        workflowPath: ".github/workflows/cloudmarkup-validate.yml",
      },
    ],
    variables: [
      {
        name: "AWS_ACCOUNT_ID",
        purpose: "Expected customer account.",
      },
    ],
    workflows: [
      {
        environmentScoped: true,
        path: ".github/workflows/cloudmarkup-validate.yml",
        purpose: "Validate the reviewed package without credentials.",
      },
    ],
    warnings: [
      {
        code: "no-deployment-authority",
        message:
          "The workflow does not authorize CloudMarkup to merge or deploy.",
      },
    ],
  },
  solutionRevision: {
    digest,
    id: "solution-revision-0040a",
  },
  validator: {
    digest,
    id: "cloudmarkup.customer-ci-workflow-validator",
    version: "1.0.0",
  },
});

describe("GitHub App repository export API contract", () => {
  it("requires a state-bound intent and callback receipt without accepting an installation selector", () => {
    expect(
      createGithubAppInstallationLinkIntentV1Schema.parse({
        contractVersion: 1,
      }),
    ).toEqual({ contractVersion: 1 });
    expect(
      completeGithubAppInstallationLinkV1Schema.parse({
        callbackReceipt: `callback.receipt.${"r".repeat(32)}`,
        contractVersion: 1,
        intentId: "githublink_test",
      }),
    ).toMatchObject({ intentId: "githublink_test" });
    expect(
      completeGithubAppInstallationLinkV1Schema.safeParse({
        callbackReceipt: `callback.receipt.${"r".repeat(32)}`,
        contractVersion: 1,
        installationId: 77,
        intentId: "githublink_test",
      }).success,
    ).toBe(false);

    const state = "s".repeat(43);
    expect(
      githubInstallationLinkIntentV1Schema.parse({
        expiresAt: "2026-08-24T12:10:00.000Z",
        installationUrl: `https://github.com/apps/cloudmarkup-test/installations/new?state=${state}`,
        intentId: "githublink_test",
        state,
      }),
    ).toMatchObject({ state });
    expect(
      githubInstallationLinkIntentV1Schema.safeParse({
        expiresAt: "2026-08-24T12:10:00.000Z",
        installationUrl: `https://attacker.example/apps/cloudmarkup-test/installations/new?state=${state}`,
        intentId: "githublink_test",
        state,
      }).success,
    ).toBe(false);
  });

  it.each([
    "../escape",
    "/absolute",
    "C:/drive",
    "safe\\windows",
    "safe/%2e%2e/escape",
    ".git/hooks",
  ])("rejects destination attack %s", (destinationFolder) => {
    expect(
      createGithubExportPreviewV1Schema.safeParse({
        artifactId: "solutionartifact_test",
        baseBranch: "main",
        contractVersion: 1,
        destinationFolder,
        featureBranch: "cloudmarkup/export-test",
        includeWorkflows: false,
        integrationId: "integration_test",
        repositoryId: 900,
      }).success,
    ).toBe(false);
  });

  it("binds execution to the exact preview and workflow path/digest list", () => {
    expect(
      executeGithubExportV1Schema.parse({
        confirmedWorkflowFiles: [
          {
            digest,
            path: ".github/workflows/cloudmarkup-validate.yml",
          },
        ],
        contractVersion: 1,
        previewDigest: digest,
        previewId: "githubpreview_test",
      }),
    ).toMatchObject({ previewDigest: digest });
    expect(
      executeGithubExportV1Schema.safeParse({
        confirmedWorkflowFiles: [],
        contractVersion: 1,
        installationToken: "forbidden",
        previewDigest: digest,
        previewId: "githubpreview_test",
      }).success,
    ).toBe(false);
  });

  it("represents plain-language issues with optional exact technical paths", () => {
    const parsed = githubExportPreviewV1Schema.parse({
      artifactDigest: digest,
      artifactId: "solutionartifact_test",
      baseBranch: "main",
      baseCommitSha: commitSha,
      changes: [],
      createdAt: "2026-08-24T00:00:00.000Z",
      destinationFolder: "solutions/notes",
      expiresAt: "2026-08-24T00:30:00.000Z",
      featureBranch: "cloudmarkup/notes",
      includeWorkflows: false,
      integrationId: "integration_test",
      issues: [
        {
          code: "workflow-files-omitted",
          message:
            "Pull-request validation is not ready because workflow files were omitted.",
          path: ".github/workflows/cloudmarkup-validate.yml",
          severity: "warning",
        },
      ],
      organizationId: "org_test",
      previousExportAuthority: {
        authorityDigest: digest,
        authorityId: "githubexport_previous",
        inventoryDigest: digest,
      },
      previewDigest: digest,
      previewId: "githubpreview_test",
      projectId: "project_test",
      ready: true,
      repositoryId: 900,
      repositoryWorkflows,
      repositoryName: "customer-repository",
      repositoryOwner: "example-org",
      semanticDiff: {
        applicationChanged: false,
        architectureChanged: true,
        diagramChanged: true,
        evidenceChanged: true,
        externalResourcesChanged: true,
        generatorChanged: false,
        infrastructureChanged: true,
        lockChanged: true,
        solutionRevisionChanged: true,
        workloadChanged: true,
      },
      snapshotDigest: digest,
      workflowFiles: [],
    });

    expect(parsed.issues[0]).toMatchObject({
      code: "workflow-files-omitted",
      severity: "warning",
    });
    expect(parsed.repositoryWorkflows).toEqual(repositoryWorkflows);
    expect(parsed.repositoryWorkflows?.repository).toMatchObject({
      repositoryId: "900",
      repositoryOwnerId: "500",
    });
    expect(parsed.previousExportAuthority).toEqual({
      authorityDigest: digest,
      authorityId: "githubexport_previous",
      inventoryDigest: digest,
    });
  });

  it("strictly exposes reviewed workflow safeguards without secret values", () => {
    expect(repositoryWorkflows.review.environments[0]).toMatchObject({
      protected: true,
      requiredApprovals: 1,
    });
    expect(repositoryWorkflows.review.roles[0]).toMatchObject({
      audience: "sts.amazonaws.com",
      purpose: "plan",
      reference: "vars.CLOUDMARKUP_PLAN_ROLE_ARN",
    });
    expect(repositoryWorkflows.review.secrets).toEqual([
      {
        name: "CUSTOMER_APPROVAL_TOKEN",
        purpose: "Customer-owned approval integration.",
      },
    ]);

    expect(
      githubExportRepositoryWorkflowsV1Schema.safeParse({
        ...repositoryWorkflows,
        review: {
          ...repositoryWorkflows.review,
          secrets: [
            {
              name: "CUSTOMER_APPROVAL_TOKEN",
              purpose: "Customer-owned approval integration.",
              value: "not-exposed",
            },
          ],
        },
      }).success,
    ).toBe(false);
    expect(
      githubExportRepositoryWorkflowsV1Schema.safeParse({
        ...repositoryWorkflows,
        review: {
          ...repositoryWorkflows.review,
          roles: [
            {
              ...repositoryWorkflows.review.roles[0],
              environment: "undeclared",
            },
          ],
        },
      }).success,
    ).toBe(false);
  });
});
