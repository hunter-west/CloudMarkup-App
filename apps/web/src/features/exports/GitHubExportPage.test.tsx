import {
  ApiClientError,
  githubBranchV1Schema,
  githubExportPreviewV1Schema,
  githubExportReceiptV1Schema,
  githubExportRepositoryWorkflowsV1Schema,
  githubInstallationLinkIntentV1Schema,
  githubInstallationV1Schema,
  githubRepositoryV1Schema,
  solutionExportArtifactDiffV1Schema,
  solutionExportArtifactV1Schema,
  solutionExportJobV1Schema,
  type ApiErrorCode,
  type CloudMarkupClient,
  type CurrentPrincipalV1,
  type GithubExportPreviewV1,
  type SolutionExportArtifactV1,
  type SolutionExportJobV1,
} from "@cloudmarkup/api-contract";
import { QueryClient } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CloudMarkupQueryProvider } from "../../api/index.js";
import { NotificationProvider } from "../../notifications/index.js";
import { ModePreferenceProvider } from "../../preferences/ModePreferenceProvider.js";
import { ModeSwitch } from "../../preferences/ModeSwitch.js";
import { RouterProvider } from "../../routing/index.js";
import { GitHubExportPage } from "./GitHubExportPage.js";

const NOW = "2026-08-24T12:00:00.000Z";
const LATER = "2099-08-24T12:00:00.000Z";
const ORGANIZATION_ID = "org_notes";
const PROJECT_ID = "project_notes";
const REVISION_ID = "solution_notes_v1";
const JOB_ID = "solutionexport_notes_v1";
const ARTIFACT_ID = "solutionartifact_notes_v1";
const INTEGRATION_ID = "integration_notes";
const REPOSITORY_ID = 42;
const DIGEST_A = `sha256:${"a".repeat(64)}`;
const DIGEST_B = `sha256:${"b".repeat(64)}`;
const DIGEST_C = `sha256:${"c".repeat(64)}`;
const DIGEST_D = `sha256:${"d".repeat(64)}`;
const COMMIT_SHA = "e".repeat(40);
const WORKFLOW_PATH = ".github/workflows/cloudmarkup-validate.yml";
const LINK_STATE = "A".repeat(43);
const LINK_RECEIPT = `receipt.${"r".repeat(40)}`;
const LINK_INTENT_ID = "githublink_test";

function repositoryWorkflowsFixture(
  destinationFolder = `cloudmarkup/${REVISION_ID}`,
) {
  return githubExportRepositoryWorkflowsV1Schema.parse({
    configDigest: DIGEST_A,
    contractVersion: 1,
    dependencyLockDigests: [{ digest: DIGEST_B, id: "pnpm-lock" }],
    files: [
      {
        checksum: DIGEST_B,
        mediaType: "application/yaml",
        ownership: "generated-replaceable",
        path: WORKFLOW_PATH,
        provenance: {
          producer: {
            digest: DIGEST_B,
            id: "cloudmarkup.customer-ci-workflow",
            version: "1.0.0",
          },
          solutionRevisionId: REVISION_ID,
          sourceReferences: [{ id: REVISION_ID, kind: "solution-revision" }],
        },
        semanticChecksum: DIGEST_C,
        sizeBytes: 360,
      },
    ],
    generator: {
      digest: DIGEST_B,
      id: "cloudmarkup.customer-ci-workflow",
      version: "1.0.0",
    },
    inclusionPolicy: "explicit-workflow-permission-and-confirmation-required",
    kind: "cloudmarkup.reviewed-repository-workflows",
    pinRegistryDigest: DIGEST_C,
    policyDigest: DIGEST_D,
    repository: {
      defaultBranch: "main",
      destinationFolder,
      name: "notes-api",
      owner: "cloudmarkup",
      repositoryId: String(REPOSITORY_ID),
      repositoryOwnerId: "22",
      state: "bound",
    },
    requiredPackageTrees: [
      {
        files: [
          {
            checksum: DIGEST_A,
            path: "infrastructure/main.tf",
          },
        ],
        root: "infrastructure",
      },
    ],
    resultDigest: DIGEST_D,
    review: {
      environments: [
        {
          approvedRefs: ["refs/heads/main"],
          githubEnvironment: "development",
          id: "dev",
          protected: true,
          requiredApprovals: 1,
          smokeBaseUrlDigest: DIGEST_A,
          workspace: "dev",
        },
      ],
      permissions: [
        {
          access: "read",
          explanation: "Reads only the exact reviewed package.",
          scope: "contents",
          workflowPath: WORKFLOW_PATH,
        },
      ],
      roles: [
        {
          audience: "sts.amazonaws.com",
          environment: "dev",
          purpose: "plan",
          reference: "vars.CLOUDMARKUP_PLAN_ROLE_ARN",
          subject: "repo:cloudmarkup/notes-api:environment:development",
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
          events: ["pull_request", "workflow_dispatch"],
          workflowPath: WORKFLOW_PATH,
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
          path: WORKFLOW_PATH,
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
      digest: DIGEST_A,
      id: REVISION_ID,
    },
    validator: {
      digest: DIGEST_C,
      id: "cloudmarkup.customer-ci-workflow-validator",
      version: "1.0.0",
    },
  });
}

const principal: CurrentPrincipalV1 = {
  displayName: "GitHub Export Editor",
  id: "principal_github_export_editor",
  organizationContexts: [
    {
      capabilities: [
        "projects.read",
        "artifacts.read",
        "exports.run",
        "integrations.read",
        "integrations.manage",
      ],
      isOwner: false,
      membershipId: "membership_github_export_editor",
      organizationId: ORGANIZATION_ID,
      role: "administrator",
    },
  ],
  resourceVersion: 1,
};

function artifactFixture(): SolutionExportArtifactV1 {
  const files = [
    {
      checksum: DIGEST_A,
      id: "solutionfile_architecture",
      mediaType: "application/json",
      ownership: "architecture-as-code-source",
      path: "cloudmarkup/architecture.json",
      previewAvailable: true,
      semanticChecksum: DIGEST_A,
      sizeBytes: 180,
    },
    {
      checksum: DIGEST_B,
      id: "solutionfile_manifest",
      mediaType: "application/json",
      ownership: "generated-replaceable",
      path: "cloudmarkup/cloudmarkup.manifest.json",
      previewAvailable: true,
      semanticChecksum: DIGEST_B,
      sizeBytes: 240,
    },
    {
      checksum: DIGEST_C,
      id: "solutionfile_readme",
      mediaType: "text/markdown",
      ownership: "generated-replaceable",
      path: "README.md",
      previewAvailable: true,
      semanticChecksum: DIGEST_C,
      sizeBytes: 120,
    },
    {
      checksum: DIGEST_A,
      id: "solutionfile_application",
      mediaType: "text/typescript",
      ownership: "generated-replaceable",
      path: "application/src/handler.ts",
      previewAvailable: true,
      semanticChecksum: DIGEST_A,
      sizeBytes: 220,
    },
    {
      checksum: DIGEST_B,
      id: "solutionfile_application_test",
      mediaType: "text/typescript",
      ownership: "generated-replaceable",
      path: "application/test/handler.test.ts",
      previewAvailable: true,
      semanticChecksum: DIGEST_B,
      sizeBytes: 210,
    },
    {
      checksum: DIGEST_C,
      id: "solutionfile_customer_extension",
      mediaType: "text/typescript",
      ownership: "user-owned-extension",
      path: "application/extensions/customer.ts",
      previewAvailable: true,
      semanticChecksum: DIGEST_C,
      sizeBytes: 90,
    },
    {
      checksum: DIGEST_A,
      id: "solutionfile_terraform",
      mediaType: "application/vnd.hashicorp.terraform",
      ownership: "generated-replaceable",
      path: "infrastructure/main.tf",
      previewAvailable: true,
      semanticChecksum: DIGEST_A,
      sizeBytes: 480,
    },
    {
      checksum: DIGEST_B,
      id: "solutionfile_diagram_svg",
      mediaType: "image/svg+xml",
      ownership: "generated-replaceable",
      path: "diagram/architecture.svg",
      previewAvailable: true,
      semanticChecksum: DIGEST_B,
      sizeBytes: 1_024,
    },
    {
      checksum: DIGEST_C,
      id: "solutionfile_diagram_png",
      mediaType: "image/png",
      ownership: "generated-replaceable",
      path: "diagram/architecture.png",
      previewAvailable: false,
      semanticChecksum: DIGEST_C,
      sizeBytes: 6_291_456,
    },
    {
      checksum: DIGEST_D,
      id: "solutionfile_workload_contract",
      mediaType: "application/json",
      ownership: "generated-replaceable",
      path: "contracts/workload.json",
      previewAvailable: true,
      semanticChecksum: DIGEST_D,
      sizeBytes: 300,
    },
    {
      checksum: DIGEST_A,
      id: "solutionfile_validation_evidence",
      mediaType: "application/json",
      ownership: "evidence-artifact",
      path: "evidence/validation.json",
      previewAvailable: true,
      semanticChecksum: DIGEST_A,
      sizeBytes: 280,
    },
    {
      checksum: DIGEST_B,
      id: "solutionfile_workflow",
      mediaType: "application/yaml",
      ownership: "generated-replaceable",
      path: WORKFLOW_PATH,
      previewAvailable: true,
      semanticChecksum: DIGEST_B,
      sizeBytes: 360,
    },
  ].sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
  return solutionExportArtifactV1Schema.parse({
    archiveFileName: "notes-api.zip",
    contractVersion: 1,
    createdAt: NOW,
    digest: DIGEST_D,
    downloadAvailability: { expiresAt: LATER, state: "available" },
    fileCount: files.length,
    files,
    id: ARTIFACT_ID,
    jobId: JOB_ID,
    manifestDigest: DIGEST_B,
    previousArtifactId: "solutionartifact_notes_previous",
    projectId: PROJECT_ID,
    sizeBytes: 6_295_000,
    solutionRevisionId: REVISION_ID,
    warnings: [
      {
        code: "DIAGRAM.LARGE",
        message: "The PNG diagram is large and may exceed repository policy.",
      },
    ],
  });
}

function jobFixture(artifact: SolutionExportArtifactV1): SolutionExportJobV1 {
  const stageNames = [
    "authorization",
    "compilation",
    "application-generation",
    "application-build",
    "terraform-validation",
    "diagram-rendering",
    "packaging",
    "publication",
  ] as const;
  return solutionExportJobV1Schema.parse({
    applicationVerification: {
      buildRequestDigest: DIGEST_C,
      confirmedState: "complete-supported-pattern",
      evidenceId: "evidence_application_build",
      generationArtifactDigest: DIGEST_A,
      inputState: "complete-supported-pattern",
      solutionRevisionDigest: DIGEST_B,
      solutionRevisionId: REVISION_ID,
      workloadId: "workload_notes",
    },
    artifact: {
      artifactId: ARTIFACT_ID,
      digest: artifact.digest,
      downloadAvailability: artifact.downloadAvailability,
      fileCount: artifact.fileCount,
      manifestDigest: artifact.manifestDigest,
      sizeBytes: artifact.sizeBytes,
    },
    cancellation: { state: "none" },
    completedAt: NOW,
    contractVersion: 1,
    createdAt: NOW,
    diagnostics: [],
    evidence: [
      {
        digest: DIGEST_A,
        evidenceId: "evidence_compiler",
        kind: "infrastructure-compilation",
        stage: "compilation",
        status: "passed",
      },
      {
        digest: DIGEST_C,
        evidenceId: "evidence_application_build",
        kind: "application-build",
        reference: {
          environment: { environmentType: "development" },
          evidenceId: "evidence_application_build",
          record: {
            contractVersion: 1,
            digest: DIGEST_C,
            mediaType: "application/json",
            objectId: "object.evidence.application-build",
            purpose: "evidence",
            sizeBytes: 320,
          },
          solutionRevisionId: REVISION_ID,
        },
        stage: "application-build",
        status: "passed",
      },
      {
        digest: DIGEST_B,
        evidenceId: "evidence_application_test",
        kind: "application-test",
        stage: "application-build",
        status: "passed",
      },
      {
        digest: DIGEST_D,
        evidenceId: "evidence_terraform_validation",
        kind: "terraform-validation",
        reference: {
          environment: { environmentType: "development" },
          evidenceId: "evidence_terraform_validation",
          record: {
            contractVersion: 1,
            digest: DIGEST_D,
            mediaType: "application/json",
            objectId: "object.evidence.terraform-validation",
            purpose: "evidence",
            sizeBytes: 280,
          },
          solutionRevisionId: REVISION_ID,
        },
        stage: "terraform-validation",
        status: "passed",
      },
    ],
    generationCoverage: {
      contractVersion: 1,
      evidence: [],
      missingRequirements: [],
      solutionRevisionId: REVISION_ID,
      state: "complete-supported-pattern",
      workloads: [
        {
          evidence: [],
          missingRequirements: [],
          state: "complete-supported-pattern",
          unresolvedRequirementIds: [],
          workloadId: "workload_notes",
        },
      ],
    },
    id: JOB_ID,
    progress: {
      completedStages: stageNames.length,
      message: "All blocking checks passed.",
      totalStages: stageNames.length,
    },
    projectId: PROJECT_ID,
    requestDigest: DIGEST_A,
    runSequence: 1,
    solutionRevision: {
      manifestDigest: DIGEST_B,
      manifestRecordId: "manifest_notes_v1",
      solutionRevisionId: REVISION_ID,
    },
    stages: stageNames.map((stage) => ({
      completedAt: NOW,
      stage,
      startedAt: NOW,
      status: "succeeded",
    })),
    state: "succeeded",
    target: {
      diagram: {
        background: "opaque-light",
        includeStableDeploymentIdentifiers: false,
        maxHeight: 4_096,
        maxWidth: 4_096,
        profile: "presentation",
        scale: 2,
      },
      environment: { environmentType: "development" },
      exportName: "notes-api",
      profileId: "cloudmarkup.export.terraform-nodejs24-v1",
      settingsDigest: DIGEST_C,
    },
    updatedAt: NOW,
    warnings: [
      {
        code: "EVIDENCE.STALE",
        message: "One optional repository comparison has stale Evidence.",
      },
    ],
  });
}

const installationFixture = githubInstallationV1Schema.parse({
  accountId: 22,
  accountLogin: "cloudmarkup",
  accountType: "Organization",
  createdAt: NOW,
  installationId: 11,
  integrationId: INTEGRATION_ID,
  organizationId: ORGANIZATION_ID,
  permissions: {
    contents: "write",
    metadata: "read",
    pullRequests: "write",
    workflows: "write",
  },
  repositorySelection: "selected",
  status: "connected",
  updatedAt: NOW,
});

const installationLinkIntentFixture =
  githubInstallationLinkIntentV1Schema.parse({
    expiresAt: LATER,
    installationUrl: `https://github.com/apps/cloudmarkup/installations/new?state=${LINK_STATE}`,
    intentId: LINK_INTENT_ID,
    state: LINK_STATE,
  });

const repositoryFixture = githubRepositoryV1Schema.parse({
  archived: false,
  defaultBranch: "main",
  disabled: false,
  installationId: 11,
  integrationId: INTEGRATION_ID,
  name: "notes-api",
  nodeId: "R_notes",
  organizationId: ORGANIZATION_ID,
  owner: "cloudmarkup",
  private: true,
  pushedAt: NOW,
  repositoryId: REPOSITORY_ID,
  updatedAt: NOW,
});

const branchFixture = githubBranchV1Schema.parse({
  name: "main",
  protected: true,
  sha: COMMIT_SHA,
});

const artifact = artifactFixture();
const job = jobFixture(artifact);
const previousDiff = solutionExportArtifactDiffV1Schema.parse({
  artifactId: ARTIFACT_ID,
  contractVersion: 1,
  files: [
    {
      after: {
        checksum: DIGEST_A,
        mediaType: "application/vnd.hashicorp.terraform",
        ownership: "generated-replaceable",
        path: "infrastructure/main.tf",
        semanticChecksum: DIGEST_A,
        sizeBytes: 480,
      },
      before: {
        checksum: DIGEST_B,
        mediaType: "application/vnd.hashicorp.terraform",
        ownership: "generated-replaceable",
        path: "infrastructure/main.tf",
        semanticChecksum: DIGEST_C,
        sizeBytes: 470,
      },
      change: "modified",
      path: "infrastructure/main.tf",
      semanticChange: "changed",
    },
  ],
  previousArtifactId: artifact.previousArtifactId,
  state: "available",
});

interface FixtureOptions {
  readonly executeFailureCount?: number;
  readonly iacTarget?: "cloudformation" | "terraform";
  readonly installationStatus?: "connected" | "reauthorization-required";
  readonly previewFailure?: ApiErrorCode;
  readonly previewIssues?: GithubExportPreviewV1["issues"];
  readonly previewReady?: boolean;
  readonly startWithoutInstallation?: boolean;
  readonly workflows?: "none" | "write";
}

function clientError(code: ApiErrorCode): ApiClientError {
  const status =
    code === "access_denied" ? 403 : code === "rate_limited" ? 429 : 503;
  return new ApiClientError(status, {
    apiVersion: "v1",
    error: {
      code,
      correlationId: "correlation_github_export_ui",
      message: "A safe backend failure occurred.",
    },
  });
}

function requestedObject(
  input: unknown,
  key: string,
): Readonly<Record<string, unknown>> | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const value = (input as Readonly<Record<string, unknown>>)[key];
  return typeof value === "object" && value !== null
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function requestedPath(input: unknown, key: string): string | undefined {
  const value = requestedObject(input, "path")?.[key];
  return typeof value === "string" ? value : undefined;
}

function fakeClient(options: FixtureOptions = {}) {
  let executeAttempts = 0;
  let installationCompleted = false;
  const selectedJob =
    options.iacTarget === "cloudformation"
      ? {
          ...job,
          target: {
            ...job.target,
            profileId: "cloudmarkup.export.cloudformation-nodejs24-v1",
          },
        }
      : job;
  let currentPreview = githubExportPreviewV1Schema.parse({
    artifactDigest: artifact.digest,
    artifactId: ARTIFACT_ID,
    baseBranch: "main",
    baseCommitSha: COMMIT_SHA,
    changes: [],
    createdAt: NOW,
    destinationFolder: `cloudmarkup/${REVISION_ID}`,
    expiresAt: LATER,
    featureBranch: `cloudmarkup/${REVISION_ID}`,
    includeWorkflows: false,
    integrationId: INTEGRATION_ID,
    issues: [],
    organizationId: ORGANIZATION_ID,
    previewDigest: DIGEST_C,
    previewId: "githubpreview_notes",
    projectId: PROJECT_ID,
    ready: true,
    repositoryId: REPOSITORY_ID,
    repositoryName: repositoryFixture.name,
    repositoryWorkflows: repositoryWorkflowsFixture(),
    repositoryOwner: repositoryFixture.owner,
    semanticDiff: {
      applicationChanged: true,
      architectureChanged: true,
      diagramChanged: true,
      evidenceChanged: true,
      externalResourcesChanged: false,
      generatorChanged: false,
      infrastructureChanged: true,
      lockChanged: true,
      solutionRevisionChanged: true,
      workloadChanged: true,
    },
    snapshotDigest: DIGEST_D,
    workflowFiles: [],
  });
  const request = vi.fn((operationId: string, input: unknown) => {
    switch (operationId) {
      case "solution-export-artifacts.get":
        return { apiVersion: "v1", data: artifact };
      case "solution-export-jobs.get":
        return { apiVersion: "v1", data: selectedJob };
      case "solution-export-artifacts.diff":
        return { apiVersion: "v1", data: previousDiff };
      case "solution-export-artifacts.file-preview": {
        const fileId = requestedPath(input, "solutionExportArtifactFileId");
        const file = artifact.files.find(
          (candidate) => candidate.id === fileId,
        );
        if (file === undefined)
          throw new Error("Unknown file preview fixture.");
        const content =
          file.path === "README.md"
            ? "# Notes API\n\n![Architecture](diagram/architecture.svg)\n"
            : file.path.endsWith(".svg")
              ? '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360"><title>Notes architecture</title></svg>'
              : file.path === WORKFLOW_PATH
                ? "name: CloudMarkup PR validation\non: [pull_request]\n"
                : file.path.endsWith(".tf")
                  ? 'resource "aws_lambda_function" "notes" {}\n'
                  : `fixture for ${file.path}`;
        return {
          apiVersion: "v1",
          data: {
            artifactId: ARTIFACT_ID,
            checksum: file.checksum,
            content,
            contractVersion: 1,
            fileId: file.id,
            mediaType: file.mediaType,
            path: file.path,
            sizeBytes: file.sizeBytes,
            truncated: false,
          },
        };
      }
      case "github-installations.list": {
        const installationIsLinked =
          !options.startWithoutInstallation || installationCompleted;
        return {
          apiVersion: "v1",
          data: installationIsLinked
            ? [
                {
                  ...installationFixture,
                  permissions: {
                    ...installationFixture.permissions,
                    workflows: options.workflows ?? "write",
                  },
                  status: options.installationStatus ?? "connected",
                },
              ]
            : [],
          page: { hasMore: false },
        };
      }
      case "github-installation-link-intents.create":
        return { apiVersion: "v1", data: installationLinkIntentFixture };
      case "github-installation-link-completions.create":
        installationCompleted = true;
        return { apiVersion: "v1", data: installationFixture };
      case "github-repositories.list":
        return {
          apiVersion: "v1",
          data: [repositoryFixture],
          page: { hasMore: false },
        };
      case "github-repository-branches.list":
        return {
          apiVersion: "v1",
          data: [branchFixture],
          page: { hasMore: false },
        };
      case "github-export-previews.create": {
        if (options.previewFailure !== undefined) {
          throw clientError(options.previewFailure);
        }
        const body = requestedObject(input, "body");
        const includeWorkflows = body?.["includeWorkflows"] === true;
        const destinationValue = body?.["destinationFolder"];
        const destinationFolder =
          typeof destinationValue === "string" ? destinationValue : "";
        const featureValue = body?.["featureBranch"];
        const featureBranch =
          typeof featureValue === "string" ? featureValue : "";
        const workflowFiles = includeWorkflows
          ? [{ digest: DIGEST_B, path: WORKFLOW_PATH }]
          : [];
        currentPreview = githubExportPreviewV1Schema.parse({
          ...currentPreview,
          changes: [
            {
              action: "add",
              binary: false,
              ownership: "architecture-as-code-source",
              path: `${destinationFolder}/cloudmarkup/architecture.json`,
              proposedDigest: DIGEST_A,
              reason: "Approved architecture-as-code source.",
              sizeBytes: 180,
              workflow: false,
            },
            {
              action: "modify",
              binary: false,
              currentDigest: DIGEST_B,
              ownership: "generated-replaceable",
              path: `${destinationFolder}/application/src/handler.ts`,
              proposedDigest: DIGEST_A,
              reason: "Generated baseline matches.",
              sizeBytes: 220,
              workflow: false,
            },
            {
              action: "add",
              binary: false,
              ownership: "generated-replaceable",
              path: `${destinationFolder}/infrastructure/main.tf`,
              proposedDigest: DIGEST_A,
              reason: "Deterministic Terraform output.",
              sizeBytes: 480,
              workflow: false,
            },
            {
              action: "add",
              binary: true,
              ownership: "generated-replaceable",
              path: `${destinationFolder}/diagram/architecture.png`,
              proposedDigest: DIGEST_C,
              reason: "Large diagram requires review.",
              sizeBytes: 6_291_456,
              workflow: false,
            },
            {
              action: "preserve",
              binary: false,
              currentDigest: DIGEST_D,
              ownership: "user-owned-extension",
              path: `${destinationFolder}/application/extensions/customer.ts`,
              reason: "User-owned file is preserved.",
              sizeBytes: 90,
              workflow: false,
            },
            ...workflowFiles.map((file) => ({
              action: "add" as const,
              binary: false,
              ownership: "generated-replaceable" as const,
              path: file.path,
              proposedDigest: file.digest,
              reason: "Explicitly selected pull-request validation workflow.",
              sizeBytes: 360,
              workflow: true,
            })),
          ],
          destinationFolder,
          featureBranch,
          includeWorkflows,
          issues:
            options.previewIssues ??
            (includeWorkflows
              ? []
              : [
                  {
                    code: "workflow-files-omitted",
                    message: "Workflow files are omitted from this export.",
                    severity: "warning",
                  },
                ]),
          ready: options.previewReady ?? true,
          repositoryWorkflows: repositoryWorkflowsFixture(destinationFolder),
          workflowFiles,
        });
        return { apiVersion: "v1", data: currentPreview };
      }
      case "github-exports.create": {
        executeAttempts += 1;
        if (executeAttempts <= (options.executeFailureCount ?? 0)) {
          throw clientError("service_unavailable");
        }
        return {
          apiVersion: "v1",
          data: githubExportReceiptV1Schema.parse({
            branch: currentPreview.featureBranch,
            commitSha: COMMIT_SHA,
            completedAt: NOW,
            executionId: "githubexport_notes",
            organizationId: ORGANIZATION_ID,
            previewDigest: currentPreview.previewDigest,
            projectId: PROJECT_ID,
            pullRequestNumber: 7,
            pullRequestUrl: "https://github.com/cloudmarkup/notes-api/pull/7",
            repositoryId: REPOSITORY_ID,
          }),
        };
      }
      default:
        throw new Error(`Unexpected operation ${operationId}`);
    }
  });
  return {
    client: {
      request,
      requestWithMetadata: vi.fn(),
    } as unknown as CloudMarkupClient,
    request,
  };
}

function renderAuthenticated(
  child: ReactNode,
  client: CloudMarkupClient,
  strict = false,
) {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });
  const content = (
    <NotificationProvider>
      <ModePreferenceProvider actorId={principal.id}>
        <CloudMarkupQueryProvider client={client} queryClient={queryClient}>
          <RouterProvider>
            <ModeSwitch />
            {child}
          </RouterProvider>
        </CloudMarkupQueryProvider>
      </ModePreferenceProvider>
    </NotificationProvider>
  );
  return render(strict ? <StrictMode>{content}</StrictMode> : content);
}

function page(currentPrincipal: CurrentPrincipalV1 = principal) {
  return (
    <GitHubExportPage
      artifactId={ARTIFACT_ID}
      organizationId={ORGANIZATION_ID}
      principal={currentPrincipal}
      projectId={PROJECT_ID}
    />
  );
}

async function waitForDestinationReady() {
  const preview = await screen.findByRole("button", {
    name: "Preview repository changes",
  });
  await waitFor(() => expect(preview).toBeEnabled());
  return preview;
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  window.history.replaceState({}, "", "/");
  vi.restoreAllMocks();
});

describe("GitHub export experience", () => {
  it("creates a short-lived installation intent without accepting a bare installation ID or opening GitHub automatically", async () => {
    const fixture = fakeClient();
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    renderAuthenticated(page(), fixture.client);

    const connect = await screen.findByRole("button", {
      name: "Connect GitHub App",
    });
    expect(screen.queryByLabelText(/installation ID/u)).not.toBeInTheDocument();
    fireEvent.click(connect);

    const continueOnGitHub = await screen.findByRole("link", {
      name: "Continue on GitHub",
    });
    expect(continueOnGitHub).toHaveAttribute(
      "href",
      installationLinkIntentFixture.installationUrl,
    );
    expect(continueOnGitHub).toHaveAttribute("target", "_blank");
    expect(continueOnGitHub).toHaveAttribute("rel", "noreferrer noopener");
    expect(
      screen.getByText(/Installation link ready\. It expires/u),
    ).toBeVisible();
    expect(document.querySelector(`time[datetime="${LATER}"]`)).toBeVisible();
    expect(openSpy).not.toHaveBeenCalled();

    const intentCalls = fixture.request.mock.calls.filter(
      ([operation]) => operation === "github-installation-link-intents.create",
    );
    expect(intentCalls).toHaveLength(1);
    expect(requestedObject(intentCalls[0]?.[1], "body")).toEqual({
      contractVersion: 1,
    });
    expect(
      fixture.request.mock.calls.some(
        ([operation]) => operation === "github-installations.link",
      ),
    ).toBe(false);
  });

  it("consumes a valid callback once, removes its opaque values, completes the link, and refetches installations", async () => {
    window.history.replaceState(
      {},
      "",
      `/github-export?keep=visible&github_link_intent=${LINK_INTENT_ID}&github_link_receipt=${LINK_RECEIPT}#review`,
    );
    const fixture = fakeClient({ startWithoutInstallation: true });
    renderAuthenticated(page(), fixture.client);

    expect(window.location.search).toBe("?keep=visible");
    expect(window.location.hash).toBe("#review");
    expect(window.location.href).not.toContain(LINK_RECEIPT);
    expect(screen.queryByText(LINK_RECEIPT)).not.toBeInTheDocument();

    await waitFor(() => {
      expect(
        fixture.request.mock.calls.filter(
          ([operation]) =>
            operation === "github-installation-link-completions.create",
        ),
      ).toHaveLength(1);
    });
    expect(
      await screen.findByText(
        "GitHub App connection verified. Linked installations were refreshed.",
      ),
    ).toBeVisible();
    expect(
      await screen.findByRole("option", { name: /cloudmarkup.*connected/u }),
    ).toBeVisible();

    const completionCalls = fixture.request.mock.calls.filter(
      ([operation]) =>
        operation === "github-installation-link-completions.create",
    );
    expect(completionCalls).toHaveLength(1);
    expect(requestedObject(completionCalls[0]?.[1], "body")).toEqual({
      callbackReceipt: LINK_RECEIPT,
      contractVersion: 1,
      intentId: LINK_INTENT_ID,
    });
    expect(
      fixture.request.mock.calls.filter(
        ([operation]) => operation === "github-installations.list",
      ).length,
    ).toBeGreaterThanOrEqual(2);
  });

  it("claims and completes the callback exactly once under React StrictMode", async () => {
    window.history.replaceState(
      {},
      "",
      `/github-export?github_link_intent=${LINK_INTENT_ID}&github_link_receipt=${LINK_RECEIPT}`,
    );
    const fixture = fakeClient({ startWithoutInstallation: true });
    renderAuthenticated(page(), fixture.client, true);

    expect(window.location.search).toBe("");
    await waitFor(() => {
      expect(
        fixture.request.mock.calls.filter(
          ([operation]) =>
            operation === "github-installation-link-completions.create",
        ),
      ).toHaveLength(1);
    });
    await waitFor(() => {
      expect(
        fixture.request.mock.calls.filter(
          ([operation]) => operation === "github-installations.list",
        ).length,
      ).toBeGreaterThanOrEqual(2);
    });
    expect(
      fixture.request.mock.calls.filter(
        ([operation]) =>
          operation === "github-installation-link-completions.create",
      ),
    ).toHaveLength(1);
    expect(window.location.href).not.toContain(LINK_RECEIPT);
    expect(screen.queryByText(LINK_RECEIPT)).not.toBeInTheDocument();
  });

  it.each([
    ["missing receipt", `?github_link_intent=${LINK_INTENT_ID}`],
    ["missing intent", `?github_link_receipt=${LINK_RECEIPT}`],
    [
      "malformed pair",
      "?github_link_intent=not-an-intent&github_link_receipt=short",
    ],
  ] as const)(
    "removes and safely ignores a %s callback",
    async (_label, callbackQuery) => {
      window.history.replaceState(
        {},
        "",
        `/github-export${callbackQuery}&keep=visible`,
      );
      const fixture = fakeClient();
      renderAuthenticated(page(), fixture.client);

      expect(window.location.search).toBe("?keep=visible");
      expect(
        await screen.findByText("Everything proposed for GitHub"),
      ).toBeVisible();
      expect(
        fixture.request.mock.calls.some(
          ([operation]) =>
            operation === "github-installation-link-completions.create",
        ),
      ).toBe(false);
    },
  );

  it("reviews every package area, preserves relative diagram links, previews a complete diff, and opens one pull request", async () => {
    const fixture = fakeClient();
    renderAuthenticated(page(), fixture.client);

    expect(
      await screen.findByText("Everything proposed for GitHub"),
    ).toBeVisible();
    for (const [tab, path] of [
      ["Application", "application/src/handler.ts"],
      ["Infrastructure", "infrastructure/main.tf"],
      ["Diagrams", "diagram/architecture.svg"],
      ["Contracts", "contracts/workload.json"],
      ["Validation & Evidence", "evidence/validation.json"],
      ["CI workflows", WORKFLOW_PATH],
    ] as const) {
      fireEvent.click(screen.getByRole("tab", { name: tab }));
      expect(
        await screen.findByRole("button", {
          name: new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u"),
        }),
      ).toBeVisible();
    }
    fireEvent.click(screen.getByRole("tab", { name: "Manifest & lock" }));
    fireEvent.click(await screen.findByRole("button", { name: /README\.md/u }));
    expect(
      await screen.findByText(
        /!\[Architecture\]\(diagram\/architecture\.svg\)/u,
      ),
    ).toBeVisible();

    const workflowChoice = screen.getByRole("checkbox", {
      name: /Include approved pull-request validation workflow files/u,
    });
    expect(workflowChoice).toBeEnabled();
    fireEvent.click(workflowChoice);
    fireEvent.click(await waitForDestinationReady());

    expect(
      await screen.findByRole("heading", {
        level: 3,
        name: "cloudmarkup/notes-api",
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("option", { name: /main.*protected/u }),
    ).toBeVisible();
    expect(
      screen.getByText(
        "cloudmarkup/solution_notes_v1/application/src/handler.ts",
      ),
    ).toBeVisible();
    expect(
      screen.getByText(
        "cloudmarkup/solution_notes_v1/diagram/architecture.png",
      ),
    ).toBeVisible();
    expect(
      screen.getByText("cloudmarkup/solution_notes_v1/infrastructure/main.tf"),
    ).toBeVisible();
    expect(screen.getByText("Previous-export diff")).toBeVisible();

    const workflowReview = screen.getByRole("region", {
      name: "Reviewed workflow access and safeguards",
    });
    const environmentReview = within(workflowReview).getByRole("region", {
      name: "Environment protection",
    });
    expect(within(environmentReview).getByText("development")).toBeVisible();
    expect(environmentReview).toHaveTextContent(
      "is protected and requires 1 approval.",
    );
    expect(environmentReview).toHaveTextContent("refs/heads/main");

    const roleReview = within(workflowReview).getByRole("region", {
      name: "OIDC role boundaries",
    });
    expect(
      within(roleReview).getByText("vars.CLOUDMARKUP_PLAN_ROLE_ARN"),
    ).toBeVisible();
    expect(
      within(roleReview).getByText(
        "repo:cloudmarkup/notes-api:environment:development",
      ),
    ).toBeVisible();
    expect(within(roleReview).getByText("sts.amazonaws.com")).toBeVisible();

    const permissionReview = within(workflowReview).getByRole("region", {
      name: "Repository permissions",
    });
    expect(permissionReview).toHaveTextContent("contents");
    expect(permissionReview).toHaveTextContent("read");
    expect(permissionReview).toHaveTextContent(
      "Reads only the exact reviewed package.",
    );
    expect(
      within(
        within(workflowReview).getByRole("region", { name: "Triggers" }),
      ).getByText("Runs for pull_request, workflow_dispatch."),
    ).toBeVisible();
    expect(within(workflowReview).getByText("AWS_ACCOUNT_ID")).toBeVisible();
    expect(
      within(workflowReview).getByText("CUSTOMER_APPROVAL_TOKEN"),
    ).toBeVisible();
    expect(workflowReview).toHaveTextContent(
      "Only secret names are shown. Secret values are never returned.",
    );
    expect(workflowReview).toHaveTextContent(
      "The workflow does not authorize CloudMarkup to merge or deploy.",
    );

    const technicalSummary = within(workflowReview).getByText(
      "Workflow technical details",
    );
    fireEvent.click(technicalSummary);
    const technicalDetails = technicalSummary.closest("details");
    expect(technicalDetails).not.toBeNull();
    expect(technicalDetails).toHaveAttribute("open");
    const technical = within(technicalDetails as HTMLElement);
    expect(technical.getByText(WORKFLOW_PATH)).toBeVisible();
    expect(
      technical.getAllByText("cloudmarkup.customer-ci-workflow@1.0.0").length,
    ).toBeGreaterThan(0);
    expect(
      technical.getByText("cloudmarkup.customer-ci-workflow-validator@1.0.0"),
    ).toBeVisible();
    expect(technical.getByText("cloudmarkup/notes-api")).toBeVisible();
    expect(technical.getAllByText(REVISION_ID).length).toBeGreaterThan(0);
    expect(technical.getByText("infrastructure")).toBeVisible();
    expect(technical.getByText("infrastructure/main.tf")).toBeVisible();
    expect(technical.getAllByText(DIGEST_D).length).toBeGreaterThan(0);

    fireEvent.click(
      screen.getByRole("checkbox", {
        name: new RegExp(
          WORKFLOW_PATH.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
          "u",
        ),
      }),
    );
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /I reviewed the complete file and semantic diff/u,
      }),
    );
    const confirm = screen.getByRole("button", { name: "Confirm export" });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);

    expect(
      await screen.findByText("Feature branch export complete"),
    ).toBeVisible();
    const pullRequest = screen.getByRole("link", { name: "Open pull request" });
    expect(pullRequest).toHaveAttribute(
      "href",
      "https://github.com/cloudmarkup/notes-api/pull/7",
    );
    expect(screen.getByText(/Nothing was merged or deployed/u)).toBeVisible();
  });

  it("keeps the same selectors, workflow review, and actions when assistance wording changes", async () => {
    const fixture = fakeClient();
    renderAuthenticated(page(), fixture.client);

    const preview = await waitForDestinationReady();
    const connect = screen.getByRole("button", {
      name: "Connect GitHub App",
    });
    const repository = screen.getByRole("combobox", { name: "Repository" });
    const base = screen.getByRole("combobox", { name: "Base branch" });
    expect(repository).toHaveValue(String(REPOSITORY_ID));
    await waitFor(() => expect(base).toHaveValue("main"));
    expect(
      screen.getByText(/A feature branch keeps these files separate/u),
    ).toBeVisible();

    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /Include approved pull-request validation workflow files/u,
      }),
    );
    fireEvent.click(preview);

    const workflowReview = await screen.findByRole("region", {
      name: "Reviewed workflow access and safeguards",
    });
    const workflowConfirmation = screen.getByRole("checkbox", {
      name: new RegExp(
        WORKFLOW_PATH.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        "u",
      ),
    });
    fireEvent.click(workflowConfirmation);
    const technicalSummary = within(workflowReview).getByText(
      "Workflow technical details",
    );
    fireEvent.click(technicalSummary);
    const technicalDetails = technicalSummary.closest("details");
    expect(technicalDetails).toHaveAttribute("open");

    fireEvent.click(screen.getByRole("button", { name: "Professional" }));

    expect(repository).toHaveValue(String(REPOSITORY_ID));
    expect(base).toHaveValue("main");
    expect(preview).toBeEnabled();
    expect(screen.getByRole("button", { name: "Connect GitHub App" })).toBe(
      connect,
    );
    expect(
      screen.getByText(/Publication is bound to the selected base SHA/u),
    ).toBeVisible();
    expect(
      screen.getByRole("region", {
        name: "Reviewed workflow access and safeguards",
      }),
    ).toBe(workflowReview);
    expect(
      screen.getByRole("checkbox", {
        name: new RegExp(
          WORKFLOW_PATH.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
          "u",
        ),
      }),
    ).toBe(workflowConfirmation);
    expect(workflowConfirmation).toBeChecked();
    expect(within(workflowReview).getByText("Workflow technical details")).toBe(
      technicalSummary,
    );
    expect(technicalDetails).toHaveAttribute("open");
    expect(
      within(workflowReview).getByText("CUSTOMER_APPROVAL_TOKEN"),
    ).toBeVisible();
  });

  it("keeps installation linking unavailable to editors and drops callback proof without invoking completion", async () => {
    window.history.replaceState(
      {},
      "",
      `/github-export?github_link_intent=${LINK_INTENT_ID}&github_link_receipt=${LINK_RECEIPT}`,
    );
    const fixture = fakeClient();
    const editor: CurrentPrincipalV1 = {
      ...principal,
      organizationContexts: [
        {
          capabilities: [
            "projects.read",
            "artifacts.read",
            "exports.run",
            "integrations.read",
          ],
          isOwner: false,
          membershipId: "membership_github_export_editor",
          organizationId: ORGANIZATION_ID,
          role: "editor",
        },
      ],
    };
    renderAuthenticated(page(editor), fixture.client);

    expect(window.location.search).toBe("");
    expect(
      await screen.findByText("Everything proposed for GitHub"),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Connect GitHub App" }),
    ).not.toBeInTheDocument();
    expect(
      fixture.request.mock.calls.some(
        ([operation]) =>
          operation === "github-installation-link-completions.create",
      ),
    ).toBe(false);
  });

  it("lets viewers inspect the immutable package but never queries GitHub authority", async () => {
    const fixture = fakeClient();
    const viewer: CurrentPrincipalV1 = {
      ...principal,
      organizationContexts: [
        {
          capabilities: ["projects.read", "artifacts.read"],
          isOwner: false,
          membershipId: "membership_github_export_viewer",
          organizationId: ORGANIZATION_ID,
          role: "viewer",
        },
      ],
    };
    renderAuthenticated(page(viewer), fixture.client);

    expect(await screen.findByText("Export permission required")).toBeVisible();
    expect(screen.getByText("Everything proposed for GitHub")).toBeVisible();
    expect(
      fixture.request.mock.calls.some(
        ([operation]) => operation === "github-installations.list",
      ),
    ).toBe(false);
  });

  it("shows revoked installation and missing workflow permission without expanding App authority", async () => {
    const revoked = fakeClient({
      installationStatus: "reauthorization-required",
    });
    const firstRender = renderAuthenticated(page(), revoked.client);
    expect(
      await screen.findByRole("option", { name: /reauthorization required/u }),
    ).toBeVisible();
    expect(screen.getByRole("combobox", { name: "Repository" })).toBeDisabled();
    expect(
      revoked.request.mock.calls.some(
        ([operation]) => operation === "github-repositories.list",
      ),
    ).toBe(false);
    firstRender.unmount();
    localStorage.clear();

    const noWorkflow = fakeClient({ workflows: "none" });
    renderAuthenticated(page(), noWorkflow.client);
    const workflow = await screen.findByRole("checkbox", {
      name: /Include approved pull-request validation workflow files/u,
    });
    expect(workflow).toBeDisabled();
    expect(
      screen.getByText(/Export can continue without workflow files/u),
    ).toBeVisible();
    fireEvent.click(await waitForDestinationReady());
    expect(
      await screen.findByText(/Workflow files are omitted/u),
    ).toBeVisible();
  });

  it("keeps user-owned conflicts, large diagrams, and stale Evidence visible as blocking review facts", async () => {
    const fixture = fakeClient({
      previewIssues: [
        {
          code: "user-owned-file-conflict",
          message:
            "A user-owned extension differs and will not be overwritten.",
          path: "cloudmarkup/solution_notes_v1/application/extensions/customer.ts",
          severity: "error",
        },
        {
          code: "large-diagram",
          message: "The PNG diagram exceeds the recommended repository size.",
          path: "cloudmarkup/solution_notes_v1/diagram/architecture.png",
          severity: "warning",
        },
        {
          code: "stale-evidence",
          message: "Validation Evidence is stale for this repository snapshot.",
          severity: "warning",
        },
      ],
      previewReady: false,
    });
    renderAuthenticated(page(), fixture.client);
    fireEvent.click(await waitForDestinationReady());

    expect(await screen.findByText(/will not be overwritten/u)).toBeVisible();
    expect(
      screen.getByText(/exceeds the recommended repository size/u),
    ).toBeVisible();
    expect(screen.getByText(/Evidence is stale/u)).toBeVisible();
    expect(screen.getByText("Blocked")).toBeVisible();
    expect(
      screen.getByRole("checkbox", {
        name: /I reviewed the complete file and semantic diff/u,
      }),
    ).toBeDisabled();
  });

  it.each([
    [
      "permission denial",
      "access_denied",
      /role, organization policy, or current plan/u,
    ],
    [
      "entitlement denial",
      "access_denied",
      /role, organization policy, or current plan/u,
    ],
    ["rate limit", "rate_limited", /rate limiting this installation/u],
  ] as const)(
    "presents %s in plain language without leaking backend details",
    async (_name, code, message) => {
      const fixture = fakeClient({ previewFailure: code });
      renderAuthenticated(page(), fixture.client);
      fireEvent.click(await waitForDestinationReady());

      expect(await screen.findByText(message)).toBeVisible();
      expect(
        screen.queryByText("A safe backend failure occurred."),
      ).not.toBeInTheDocument();
    },
  );

  it("retries a commit-success/PR-failure safely with the same idempotency key", async () => {
    const fixture = fakeClient({ executeFailureCount: 1 });
    renderAuthenticated(page(), fixture.client);
    fireEvent.click(await waitForDestinationReady());
    fireEvent.click(
      await screen.findByRole("checkbox", {
        name: /I reviewed the complete file and semantic diff/u,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Confirm export" }));

    expect(
      await screen.findByText("GitHub export did not complete"),
    ).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "Retry export safely" }),
    );
    expect(
      await screen.findByText("Feature branch export complete"),
    ).toBeVisible();

    const calls = fixture.request.mock.calls.filter(
      ([operation]) => operation === "github-exports.create",
    );
    expect(calls).toHaveLength(2);
    const firstHeaders = requestedObject(calls[0]?.[1], "headers");
    const secondHeaders = requestedObject(calls[1]?.[1], "headers");
    expect(firstHeaders?.["idempotency-key"]).toBeDefined();
    expect(secondHeaders?.["idempotency-key"]).toBe(
      firstHeaders?.["idempotency-key"],
    );
  });
});
