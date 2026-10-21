import {
  ApiClientError,
  ApiGatewayError,
  solutionExportArtifactDiffV1Schema,
  solutionExportArtifactV1Schema,
  solutionExportDownloadGrantV1Schema,
  solutionExportJobV1Schema,
  type CloudMarkupClient,
  type CurrentPrincipalV1,
  type SolutionExportArtifactDiffV1,
  type SolutionExportArtifactV1,
  type SolutionExportDownloadGrantV1,
  type SolutionExportJobV1,
  type RuntimeAiCapabilitiesV1,
} from "@cloudmarkup/api-contract";
import { QueryClient } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CloudMarkupQueryProvider,
  cloudMarkupQueryKeys,
  type AuthenticatedBinaryDownloader,
  type ExportCapabilitiesLoader,
} from "../../api/index.js";
import { NotificationProvider } from "../../notifications/index.js";
import { ModePreferenceProvider } from "../../preferences/ModePreferenceProvider.js";
import { ModeSwitch } from "../../preferences/ModeSwitch.js";
import { RouterProvider } from "../../routing/index.js";
import { readExportDiagnosticRequest } from "./diagnostic-recovery.js";
import {
  SolutionExportCreatePanel,
  SolutionExportPage,
  type SolutionExportPageProps,
} from "./SolutionExportPage.js";

const NOW = "2026-08-18T12:00:00.000Z";
const LATER = "2026-08-19T12:00:00.000Z";
const GRANT_EXPIRY = "2099-08-19T12:00:00.000Z";
const DIGEST_A = `sha256:${"a".repeat(64)}`;
const DIGEST_B = `sha256:${"b".repeat(64)}`;
const DIGEST_C = `sha256:${"c".repeat(64)}`;
const DIGEST_D = `sha256:${"d".repeat(64)}`;
const DIGEST_E = `sha256:${"e".repeat(64)}`;
const DIGEST_F = `sha256:${"f".repeat(64)}`;
const BUILD_EVIDENCE_ID = "evidence_application_build";
const TERRAFORM_EVIDENCE_ID = "evidence_terraform_validation";
const DOWNGRADE_REASON =
  "Build, tests, security checks, packaging, or reproducibility did not pass.";
const ARCHIVE_DIGEST =
  "sha256:4b9a4ac59f3c3aa32273260df6cf4bf358d1c46f8415126aa35b6380d0abb8f7";
const PROJECT_ID = "project_notes";
const REVISION_ID = "solution_notes_v1";
const JOB_ID = "solutionexport_notes_v1";
const ARTIFACT_ID = "solutionartifact_notes_v1";
const ORGANIZATION_ID = "org_notes";
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

const principal: CurrentPrincipalV1 = {
  displayName: "Export Reviewer",
  id: "principal_export_reviewer",
  organizationContexts: [
    {
      capabilities: ["projects.read", "exports.run", "artifacts.read"],
      isOwner: true,
      membershipId: "membership_export_reviewer",
      organizationId: ORGANIZATION_ID,
      role: "owner",
    },
  ],
  resourceVersion: 1,
};

type JobState = SolutionExportJobV1["state"];

function jobFixture(
  state: JobState,
  coverageState: SolutionExportJobV1["generationCoverage"]["state"] = "complete-supported-pattern",
): SolutionExportJobV1 {
  const active = state === "queued" || state === "running";
  const failed = state === "failed";
  const succeeded = state === "succeeded";
  const generatedCoverage =
    coverageState === "starter-application" ||
    coverageState === "complete-supported-pattern";
  const stages = stageNames.map((stage, index) => {
    const status = succeeded
      ? !generatedCoverage &&
        (stage === "application-generation" || stage === "application-build")
        ? ("skipped" as const)
        : ("succeeded" as const)
      : failed
        ? index < 3
          ? ("succeeded" as const)
          : index === 3
            ? ("failed" as const)
            : ("skipped" as const)
        : index === 0
          ? ("succeeded" as const)
          : index === 1
            ? ("running" as const)
            : ("pending" as const);
    return {
      ...(status === "succeeded" || status === "failed"
        ? { completedAt: NOW, startedAt: NOW }
        : status === "running"
          ? { startedAt: NOW }
          : {}),
      stage,
      status,
    };
  });
  const applicationVerification =
    (succeeded || failed) &&
    (coverageState === "starter-application" ||
      coverageState === "complete-supported-pattern")
      ? {
          buildRequestDigest: DIGEST_D,
          confirmedState: failed
            ? ("custom-implementation-required" as const)
            : coverageState,
          ...(failed
            ? { downgradeReason: DOWNGRADE_REASON }
            : { evidenceId: BUILD_EVIDENCE_ID }),
          generationArtifactDigest: DIGEST_E,
          inputState: coverageState,
          solutionRevisionDigest: DIGEST_B,
          solutionRevisionId: REVISION_ID,
          workloadId: "workload_notes",
        }
      : undefined;
  return solutionExportJobV1Schema.parse({
    ...(succeeded
      ? {
          artifact: {
            artifactId: ARTIFACT_ID,
            digest: ARCHIVE_DIGEST,
            downloadAvailability: { expiresAt: LATER, state: "available" },
            fileCount: artifactFixture().fileCount,
            manifestDigest: DIGEST_B,
            sizeBytes: 9,
          },
          completedAt: NOW,
        }
      : {}),
    ...(failed ? { completedAt: NOW } : {}),
    ...(applicationVerification === undefined
      ? {}
      : { applicationVerification }),
    cancellation: { state: "none" },
    contractVersion: 1,
    createdAt: NOW,
    diagnostics: failed
      ? [
          {
            code: "APPLICATION_BUILD.FAILED",
            message: "Generated application tests did not pass.",
            path: "application/evidence/build.log",
            severity: "error",
            stage: "application-build",
            workloadId: "workload_notes",
          },
        ]
      : [],
    evidence: [
      {
        digest: DIGEST_A,
        evidenceId: "evidence_compiler",
        kind: "infrastructure-compilation",
        stage: "compilation",
        status: failed ? "incomplete" : "passed",
      },
      ...(applicationVerification === undefined
        ? []
        : [
            {
              digest: DIGEST_D,
              evidenceId: BUILD_EVIDENCE_ID,
              kind: "application-build" as const,
              reference: {
                environment: { environmentType: "development" as const },
                evidenceId: BUILD_EVIDENCE_ID,
                record: {
                  contractVersion: 1 as const,
                  digest: DIGEST_D,
                  mediaType: "application/json",
                  objectId: "object.evidence.application-build",
                  purpose: "evidence" as const,
                  sizeBytes: 320,
                },
                solutionRevisionId: REVISION_ID,
              },
              stage: "application-build" as const,
              status: failed ? ("failed" as const) : ("passed" as const),
            },
          ]),
      ...(applicationVerification === undefined
        ? []
        : [
            {
              digest: DIGEST_B,
              evidenceId: "evidence_tests",
              kind: "application-test" as const,
              stage: "application-build" as const,
              status: failed ? ("failed" as const) : ("passed" as const),
            },
          ]),
      ...(succeeded
        ? [
            {
              digest: DIGEST_F,
              evidenceId: TERRAFORM_EVIDENCE_ID,
              kind: "terraform-validation" as const,
              reference: {
                environment: { environmentType: "development" as const },
                evidenceId: TERRAFORM_EVIDENCE_ID,
                record: {
                  contractVersion: 1 as const,
                  digest: DIGEST_F,
                  mediaType: "application/json",
                  objectId: "object.evidence.terraform-validation",
                  purpose: "evidence" as const,
                  sizeBytes: 280,
                },
                solutionRevisionId: REVISION_ID,
              },
              stage: "terraform-validation" as const,
              status: "passed" as const,
            },
          ]
        : []),
    ],
    generationCoverage: {
      contractVersion: 1,
      evidence: [],
      missingRequirements: [],
      solutionRevisionId: REVISION_ID,
      state: coverageState,
      workloads:
        coverageState === "infrastructure-only"
          ? []
          : [
              {
                evidence: [],
                missingRequirements: [],
                state: coverageState,
                unresolvedRequirementIds: [],
                workloadId: "workload_notes",
              },
            ],
    },
    id: JOB_ID,
    ...(active ? { pollAfterMilliseconds: 30_000 } : {}),
    progress: {
      completedStages: succeeded ? 8 : failed ? 3 : 1,
      ...(active ? { currentStage: "compilation" as const } : {}),
      message: failed
        ? "Application build failed."
        : succeeded
          ? "All blocking checks passed."
          : "Compiling deterministic infrastructure.",
      totalStages: 8,
    },
    projectId: PROJECT_ID,
    requestDigest: DIGEST_A,
    runSequence: 1,
    solutionRevision: {
      manifestDigest: DIGEST_B,
      manifestRecordId: "manifest_notes_v1",
      solutionRevisionId: REVISION_ID,
    },
    stages,
    state,
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
      exportName: "notes-api-export",
      profileId: "cloudmarkup.export.terraform-nodejs24-v1",
      settingsDigest: DIGEST_C,
    },
    updatedAt: NOW,
    warnings:
      coverageState === "infrastructure-only"
        ? [
            {
              code: "APPLICATION.CODE_REQUIRED",
              message: "Application code is required before deployment.",
            },
          ]
        : [],
  });
}

function artifactFixture(
  expired = false,
  infrastructureOnly = false,
): SolutionExportArtifactV1 {
  const allFiles = [
    {
      checksum: DIGEST_A,
      id: "solutionfile_architecture",
      mediaType: "application/json",
      ownership: "architecture-as-code-source",
      path: "cloudmarkup/architecture.json",
      previewAvailable: true,
      semanticChecksum: DIGEST_A,
      sizeBytes: 80,
    },
    {
      checksum: DIGEST_C,
      id: "solutionfile_diagram_svg",
      mediaType: "image/svg+xml",
      ownership: "generated-replaceable",
      path: "diagram/architecture.svg",
      previewAvailable: true,
      semanticChecksum: DIGEST_C,
      sizeBytes: 180,
    },
    {
      checksum: DIGEST_D,
      id: "solutionfile_diagram_png",
      mediaType: "image/png",
      ownership: "generated-replaceable",
      path: "diagram/architecture.png",
      previewAvailable: false,
      semanticChecksum: DIGEST_D,
      sizeBytes: 1_024,
    },
    {
      checksum: DIGEST_E,
      id: "solutionfile_diagram_readme",
      mediaType: "text/markdown",
      ownership: "generated-replaceable",
      path: "diagram/README.md",
      previewAvailable: true,
      semanticChecksum: DIGEST_E,
      sizeBytes: 120,
    },
    {
      checksum: DIGEST_A,
      id: "solutionfile_iac",
      mediaType: "application/vnd.hashicorp.terraform",
      ownership: "generated-replaceable",
      path: "infrastructure/main.tf",
      previewAvailable: true,
      semanticChecksum: DIGEST_B,
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
      sizeBytes: 140,
    },
    {
      checksum: DIGEST_A,
      id: "solutionfile_test",
      mediaType: "text/typescript",
      ownership: "generated-replaceable",
      path: "application/test/handler.test.ts",
      previewAvailable: true,
      semanticChecksum: DIGEST_A,
      sizeBytes: 100,
    },
    {
      checksum: ARCHIVE_DIGEST,
      id: "solutionfile_lambda_zip",
      mediaType: "application/zip",
      ownership: "generated-build-artifact",
      path: "application/artifacts/workload_notes/function.zip",
      previewAvailable: false,
      semanticChecksum: ARCHIVE_DIGEST,
      sizeBytes: 9,
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
  ];
  const files = (
    infrastructureOnly
      ? allFiles.filter((file) => !file.path.startsWith("application/"))
      : allFiles
  ).sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
  return solutionExportArtifactV1Schema.parse({
    archiveFileName: "notes-api.zip",
    contractVersion: 1,
    createdAt: NOW,
    digest: ARCHIVE_DIGEST,
    downloadAvailability: expired
      ? { expiredAt: NOW, state: "expired" }
      : { expiresAt: LATER, state: "available" },
    fileCount: files.length,
    files,
    id: ARTIFACT_ID,
    jobId: JOB_ID,
    manifestDigest: DIGEST_B,
    previousArtifactId: "solutionartifact_notes_previous",
    projectId: PROJECT_ID,
    sizeBytes: 9,
    solutionRevisionId: REVISION_ID,
    warnings: [],
  });
}

const diffFixture: SolutionExportArtifactDiffV1 =
  solutionExportArtifactDiffV1Schema.parse({
    artifactId: ARTIFACT_ID,
    contractVersion: 1,
    files: [
      {
        after: {
          checksum: DIGEST_A,
          mediaType: "application/vnd.hashicorp.terraform",
          ownership: "generated-replaceable",
          path: "infrastructure/main.tf",
          semanticChecksum: DIGEST_B,
          sizeBytes: 120,
        },
        before: {
          checksum: DIGEST_C,
          mediaType: "application/vnd.hashicorp.terraform",
          ownership: "generated-replaceable",
          path: "infrastructure/main.tf",
          semanticChecksum: DIGEST_D,
          sizeBytes: 118,
        },
        change: "modified",
        path: "infrastructure/main.tf",
        semanticChange: "changed",
      },
    ],
    previousArtifactId: "solutionartifact_notes_previous",
    state: "available",
  });

const grantFixture: SolutionExportDownloadGrantV1 =
  solutionExportDownloadGrantV1Schema.parse({
    artifactId: ARTIFACT_ID,
    contractVersion: 1,
    digest: ARCHIVE_DIGEST,
    expiresAt: GRANT_EXPIRY,
    fileName: "notes-api.zip",
    id: "downloadgrant_notes",
    mediaType: "application/zip",
    sizeBytes: 9,
    url: `/v1/projects/${PROJECT_ID}/solution-export-artifacts/${ARTIFACT_ID}/download-grants/downloadgrant_notes/content`,
  });

interface JobEnvelope {
  readonly apiVersion: "v1";
  readonly data: SolutionExportJobV1;
}

interface ClientFixtureOptions {
  readonly artifact?: SolutionExportArtifactV1;
  readonly createResponse?: Promise<JobEnvelope>;
  readonly grantResponse?: () => Promise<{
    readonly apiVersion: "v1";
    readonly data: SolutionExportDownloadGrantV1;
  }>;
  readonly job: SolutionExportJobV1;
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

function clientFixture(options: ClientFixtureOptions) {
  const request = vi.fn((operationId: string, input: unknown) => {
    switch (operationId) {
      case "solution-export-jobs.create":
        return (
          options.createResponse ?? { apiVersion: "v1", data: options.job }
        );
      case "solution-export-jobs.get":
        return { apiVersion: "v1", data: options.job };
      case "solution-export-jobs.cancel":
        return {
          apiVersion: "v1",
          data: {
            ...options.job,
            cancellation: { requestedAt: NOW, state: "requested" },
            pollAfterMilliseconds: 30_000,
            state: "cancellation-requested",
          },
        };
      case "solution-export-artifacts.get":
        return { apiVersion: "v1", data: options.artifact };
      case "solution-export-artifacts.file-preview": {
        const fileId = requestedPath(input, "solutionExportArtifactFileId");
        const file = options.artifact?.files.find(
          (candidate) => candidate.id === fileId,
        );
        if (file === undefined) throw new Error("Unknown preview fixture.");
        return {
          apiVersion: "v1",
          data: {
            artifactId: ARTIFACT_ID,
            checksum: file.checksum,
            content:
              file.mediaType === "application/vnd.hashicorp.terraform"
                ? 'resource "aws_lambda_function" "notes" {}'
                : file.mediaType === "image/svg+xml"
                  ? '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360"><title>Notes architecture</title><desc>Immutable solution diagram</desc><rect width="640" height="360" fill="#fff"/></svg>'
                  : file.mediaType === "text/markdown"
                    ? "# Architecture diagram"
                    : '{"fixture":true}',
            contractVersion: 1,
            fileId: file.id,
            mediaType: file.mediaType,
            path: file.path,
            sizeBytes: file.sizeBytes,
            truncated: false,
          },
        };
      }
      case "solution-export-artifacts.diff":
        return { apiVersion: "v1", data: diffFixture };
      case "solution-export-download-grants.create":
        return (
          options.grantResponse?.() ?? { apiVersion: "v1", data: grantFixture }
        );
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
  options: {
    readonly downloadBinary?: AuthenticatedBinaryDownloader;
    readonly loadExportCapabilities?: ExportCapabilitiesLoader;
    readonly loadAiCapabilities?: import("../../api/ai-capabilities-loader.js").AiCapabilitiesLoader;
    readonly queryClient?: QueryClient;
  } = {},
) {
  const queryClient =
    options.queryClient ??
    new QueryClient({
      defaultOptions: {
        mutations: { retry: false },
        queries: { retry: false },
      },
    });
  const wrap = (content: ReactNode) => (
    <NotificationProvider>
      <ModePreferenceProvider actorId="principal_export_reviewer">
        <CloudMarkupQueryProvider
          client={client}
          queryClient={queryClient}
          {...(options.loadAiCapabilities === undefined
            ? {}
            : { loadAiCapabilities: options.loadAiCapabilities })}
          {...(options.loadExportCapabilities === undefined
            ? {}
            : { loadExportCapabilities: options.loadExportCapabilities })}
          {...(options.downloadBinary === undefined
            ? {}
            : { downloadBinary: options.downloadBinary })}
        >
          <RouterProvider>
            <ModeSwitch />
            {content}
          </RouterProvider>
        </CloudMarkupQueryProvider>
      </ModePreferenceProvider>
    </NotificationProvider>
  );
  const view = render(wrap(child));
  return {
    queryClient,
    ...view,
    rerender: (content: ReactNode) => {
      view.rerender(wrap(content));
    },
  };
}

function exportPage(
  exportJobId = JOB_ID,
  overrides: Partial<SolutionExportPageProps> = {},
) {
  return (
    <SolutionExportPage
      exportJobId={exportJobId}
      organizationId={ORGANIZATION_ID}
      principal={principal}
      projectId={PROJECT_ID}
      {...overrides}
    />
  );
}

function readOnlyPrincipal(): CurrentPrincipalV1 {
  return {
    ...principal,
    organizationContexts: principal.organizationContexts.map((context) => ({
      ...context,
      capabilities: context.capabilities.filter(
        (permission) => permission !== "exports.run",
      ),
    })),
  };
}

function unavailableDownload(
  issue = "solution-export.download-streaming-required.v1",
  path: readonly string[] = ["artifact", "download"],
) {
  return new ApiClientError(503, {
    apiVersion: "v1",
    error: {
      code: "service_unavailable",
      correlationId: "correlation_export_fixture",
      message: "Arbitrary server prose must not select permanent UI state.",
      fieldIssues: [
        { code: issue, path: [...path], message: "Synthetic issue." },
      ],
    },
  });
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("Solution Export workflow UI", () => {
  it("resumes a gateway interruption automatically with the exact original request and key", async () => {
    const fixture = clientFixture({ job: jobFixture("queued") });
    fixture.request.mockRejectedValueOnce(new ApiGatewayError(504));
    renderAuthenticated(
      <SolutionExportCreatePanel
        organizationId={ORGANIZATION_ID}
        principal={principal}
        projectId={PROJECT_ID}
        revisionId={REVISION_ID}
        revisionName="Notes API"
      />,
      fixture.client,
    );
    fireEvent.click(screen.getByRole("button", { name: "Generate export" }));
    await waitFor(
      () => {
        expect(fixture.request).toHaveBeenCalledTimes(2);
      },
      {
        timeout: 3000,
      },
    );
    expect(fixture.request.mock.calls[1]).toEqual(
      fixture.request.mock.calls[0],
    );
    expect(
      screen.queryByRole("heading", { name: "Export job was not created" }),
    ).not.toBeInTheDocument();
  });
  it("stops 504 recovery after one retry and describes its uncertain result", async () => {
    const fixture = clientFixture({ job: jobFixture("queued") });
    fixture.request.mockRejectedValue(new ApiGatewayError(504));
    renderAuthenticated(
      <SolutionExportCreatePanel
        organizationId={ORGANIZATION_ID}
        principal={principal}
        projectId={PROJECT_ID}
        revisionId={REVISION_ID}
        revisionName="Notes API"
      />,
      fixture.client,
    );
    fireEvent.click(screen.getByRole("button", { name: "Generate export" }));
    expect(
      await screen.findByRole(
        "heading",
        { name: "Export request timed out" },
        { timeout: 4500 },
      ),
    ).toBeVisible();
    expect(fixture.request).toHaveBeenCalledTimes(2);
    expect(fixture.request.mock.calls[1]).toEqual(
      fixture.request.mock.calls[0],
    );
    expect(
      screen.getByText(/The server may have accepted this export/u),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Retry original export request" }),
    ).toBeVisible();
  });
  it("retries the exact original export after a gateway timeout", async () => {
    const fixture = clientFixture({ job: jobFixture("queued") });
    fixture.request
      .mockRejectedValueOnce(new ApiGatewayError(504))
      .mockRejectedValueOnce(new ApiGatewayError(504));
    renderAuthenticated(
      <SolutionExportCreatePanel
        organizationId={ORGANIZATION_ID}
        principal={principal}
        projectId={PROJECT_ID}
        revisionId={REVISION_ID}
        revisionName="Notes API"
      />,
      fixture.client,
    );
    fireEvent.click(screen.getByRole("button", { name: "Generate export" }));
    fireEvent.click(
      await screen.findByRole(
        "button",
        { name: "Retry original export request" },
        { timeout: 4500 },
      ),
    );
    await waitFor(() => {
      expect(fixture.request).toHaveBeenCalledTimes(3);
    });
    expect(fixture.request.mock.calls[2]).toEqual(
      fixture.request.mock.calls[0],
    );
    expect(
      screen.queryByRole("heading", { name: "Export request timed out" }),
    ).toBeNull();
  });
  it("does not retry an export after leaving its canvas/revision scope", async () => {
    const fixture = clientFixture({ job: jobFixture("queued") });
    fixture.request.mockRejectedValue(new ApiGatewayError(504));
    const view = renderAuthenticated(
      <SolutionExportCreatePanel
        organizationId={ORGANIZATION_ID}
        principal={principal}
        projectId={PROJECT_ID}
        revisionId={REVISION_ID}
        revisionName="Notes API"
      />,
      fixture.client,
    );
    fireEvent.click(screen.getByRole("button", { name: "Generate export" }));
    await waitFor(() => {
      expect(fixture.request).toHaveBeenCalledOnce();
    });
    view.unmount();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1200));
    });
    expect(fixture.request).toHaveBeenCalledOnce();
  });

  it("offers a new revision only after the exact hosted tool-compatibility denial and preserves export choices", async () => {
    const fixture = clientFixture({ job: jobFixture("running") });
    fixture.request.mockRejectedValue(
      new ApiClientError(422, {
        apiVersion: "v1",
        error: {
          code: "unsupported_version",
          correlationId: "correlation_export_fixture",
          message:
            "Private server details must not become recovery instructions.",
          fieldIssues: [
            {
              code: "solution-export.revision-tools-unavailable.v1",
              path: ["solutionRevisionId"],
              message: "Synthetic exact tool selection denial.",
            },
          ],
        },
      }),
    );
    renderAuthenticated(
      <SolutionExportCreatePanel
        organizationId={ORGANIZATION_ID}
        principal={principal}
        projectId={PROJECT_ID}
        revisionId={REVISION_ID}
        revisionName="Notes API"
      />,
      fixture.client,
    );
    fireEvent.change(screen.getByLabelText("Environment type"), {
      target: { value: "staging" },
    });
    fireEvent.change(screen.getByLabelText("Infrastructure target"), {
      target: { value: "cloudformation" },
    });
    fireEvent.change(screen.getByLabelText("Export name"), {
      target: { value: "my-reviewed-infrastructure" },
    });
    fireEvent.click(screen.getByText("Diagram options (optional)"));
    fireEvent.change(screen.getByLabelText("Diagram profile"), {
      target: { value: "technical" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Generate export" }));
    expect(
      await screen.findByRole("heading", {
        name: "Save a new revision to export",
      }),
    ).toBeVisible();
    expect(
      screen.getByText(/This saved revision stays unchanged/u),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Open canvas to save a new revision" }),
    ).toHaveAttribute(
      "href",
      "/organizations/" +
        ORGANIZATION_ID +
        "/projects/" +
        PROJECT_ID +
        "/editor",
    );
    expect(screen.getByLabelText("Environment type")).toHaveValue("staging");
    expect(screen.getByLabelText("Infrastructure target")).toHaveValue(
      "cloudformation",
    );
    expect(screen.getByLabelText("Export name")).toHaveValue(
      "my-reviewed-infrastructure",
    );
    expect(screen.getByLabelText("Diagram profile")).toHaveValue("technical");
    expect(
      screen.queryByText(/Private server details/u),
    ).not.toBeInTheDocument();
    expect(fixture.request).toHaveBeenCalledTimes(1);
    expect(fixture.request.mock.calls[0]?.[0]).toBe(
      "solution-export-jobs.create",
    );
    expect(
      requestedObject(fixture.request.mock.calls[0]?.[1], "body"),
    ).toMatchObject({
      solutionRevisionId: REVISION_ID,
      targetProfileId: "cloudmarkup.export.cloudformation-nodejs24-v1",
      exportName: "my-reviewed-infrastructure",
      environment: { environmentType: "staging" },
      diagram: { profile: "technical" },
    });
  });
  it.each([
    [
      "same field on a service failure",
      503,
      "service_unavailable",
      "solution-export.revision-tools-unavailable.v1",
      ["solutionRevisionId"],
    ],
    [
      "wrong HTTP status",
      400,
      "unsupported_version",
      "solution-export.revision-tools-unavailable.v1",
      ["solutionRevisionId"],
    ],
    [
      "different issue",
      422,
      "unsupported_version",
      "solution-export.other.v1",
      ["solutionRevisionId"],
    ],
    [
      "different field",
      422,
      "unsupported_version",
      "solution-export.revision-tools-unavailable.v1",
      ["targetProfileId"],
    ],
    [
      "nested field",
      422,
      "unsupported_version",
      "solution-export.revision-tools-unavailable.v1",
      ["solutionRevisionId", "compiler"],
    ],
  ] as const)(
    "does not infer new-revision recovery from %s",
    async (_name, status, code, issue, path) => {
      const fixture = clientFixture({ job: jobFixture("running") });
      fixture.request.mockRejectedValue(
        new ApiClientError(status, {
          apiVersion: "v1",
          error: {
            code,
            correlationId: "correlation_export_fixture",
            message:
              "Save a new revision. solution-export.revision-tools-unavailable.v1",
            fieldIssues: [
              {
                code: issue,
                path: [...path],
                message: "Synthetic issue.",
              },
            ],
          },
        }),
      );
      renderAuthenticated(
        <SolutionExportCreatePanel
          organizationId={ORGANIZATION_ID}
          principal={principal}
          projectId={PROJECT_ID}
          revisionId={REVISION_ID}
          revisionName="Notes API"
        />,
        fixture.client,
      );
      fireEvent.click(screen.getByRole("button", { name: "Generate export" }));
      expect(
        await screen.findByRole("heading", {
          name: "Export job was not created",
        }),
      ).toBeVisible();
      expect(
        screen.queryByRole("heading", {
          name: "Save a new revision to export",
        }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("link", {
          name: "Open canvas to save a new revision",
        }),
      ).not.toBeInTheDocument();
      if (code === "service_unavailable")
        expect(
          screen.getByText("The export service is temporarily unavailable."),
        ).toBeVisible();
      expect(
        screen.getByRole("button", { name: "Generate export" }),
      ).toBeEnabled();
      expect(fixture.request).toHaveBeenCalledTimes(1);
    },
  );

  it("explains inactive subscription policy absence without an automatic export retry", async () => {
    const fixture = clientFixture({ job: jobFixture("running") });
    fixture.request.mockRejectedValue(
      new ApiClientError(503, {
        apiVersion: "v1",
        error: {
          code: "service_unavailable",
          correlationId: "correlation_export_fixture",
          message: "The export service is temporarily unavailable.",
          fieldIssues: [
            {
              code: "solution-export.inactive-subscription-policy-unavailable.v1",
              path: ["targetProfileId"],
              message:
                "Export access after subscription changes is not configured.",
            },
          ],
        },
      }),
    );
    renderAuthenticated(
      <SolutionExportCreatePanel
        organizationId={ORGANIZATION_ID}
        principal={principal}
        projectId={PROJECT_ID}
        revisionId={REVISION_ID}
        revisionName="Notes API"
      />,
      fixture.client,
    );
    fireEvent.click(screen.getByRole("button", { name: "Generate export" }));
    expect(
      await screen.findByText(
        "Your subscription is inactive and export access after subscription changes is not configured. Review Billing or contact support before trying again.",
      ),
    ).toBeVisible();
    expect(
      screen.queryByText("The export service is temporarily unavailable."),
    ).not.toBeInTheDocument();
    expect(fixture.request).toHaveBeenCalledTimes(1);
  });
  it("explains that Credits only funds AI without implying export access", async () => {
    const fixture = clientFixture({ job: jobFixture("running") });
    fixture.request.mockRejectedValue(
      new ApiClientError(403, {
        apiVersion: "v1",
        error: {
          code: "access_denied",
          correlationId: "correlation_export_staff_credits",
          message: "Complimentary credits fund AI workflows, not exports.",
          fieldIssues: [
            {
              code: "solution-export.staff-credits-ai-only.v1",
              path: ["targetProfileId"],
              message: "Exports require an eligible paid plan or trial.",
            },
          ],
        },
      }),
    );
    renderAuthenticated(
      <SolutionExportCreatePanel
        organizationId={ORGANIZATION_ID}
        principal={principal}
        projectId={PROJECT_ID}
        revisionId={REVISION_ID}
        revisionName="Notes API"
      />,
      fixture.client,
    );
    fireEvent.click(screen.getByRole("button", { name: "Generate export" }));
    expect(
      await screen.findByText(
        "Complimentary credits fund AI workflows, not exports. Exports require an eligible paid plan or trial.",
      ),
    ).toBeVisible();
    expect(
      screen.queryByText(/subscription is inactive/iu),
    ).not.toBeInTheDocument();
    expect(fixture.request).toHaveBeenCalledTimes(1);
  });
  it("waits for hosted availability, defaults to CloudFormation and sends only the supported target", async () => {
    let release: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const loadExportCapabilities: ExportCapabilitiesLoader = async () => {
      await pending;
      return {
        schemaVersion: 1,
        exports: {
          targets: ["cloudformation"],
          workload: "infrastructure-only",
          maximumBytes: 4_194_304,
        },
      };
    };
    const fixture = clientFixture({ job: jobFixture("running") });
    renderAuthenticated(
      <SolutionExportCreatePanel
        organizationId={ORGANIZATION_ID}
        principal={principal}
        projectId={PROJECT_ID}
        revisionId={REVISION_ID}
        revisionName="Notes API"
      />,
      fixture.client,
      { loadExportCapabilities },
    );
    expect(
      screen.getByRole("status", { name: "Export availability" }),
    ).toHaveTextContent("Checking available export formats");
    expect(
      screen.getByRole("button", { name: "Generate export" }),
    ).toBeDisabled();
    expect(screen.getByLabelText("Infrastructure target")).toHaveValue(
      "cloudformation",
    );
    if (release === undefined)
      throw new Error("Deferred capability response is missing.");
    const releaseCapabilities = release;
    await act(async () => {
      releaseCapabilities();
      await pending;
    });
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Generate export" }),
      ).toBeEnabled();
    });
    expect(screen.getByRole("option", { name: "Terraform" })).toBeDisabled();
    expect(
      screen.getByRole("option", { name: "CloudFormation" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("status", { name: "Export availability" }),
    ).toHaveTextContent(
      "infrastructure-only revisions with an eligible active Professional plan",
    );
    expect(
      screen.getByRole("status", { name: "Export availability" }),
    ).toHaveTextContent("4 MiB");
    fireEvent.click(screen.getByRole("button", { name: "Generate export" }));
    await waitFor(() => {
      expect(fixture.request).toHaveBeenCalledOnce();
    });
    expect(fixture.request.mock.calls[0]?.[0]).toBe(
      "solution-export-jobs.create",
    );
    expect(
      requestedObject(fixture.request.mock.calls[0]?.[1], "body"),
    ).toMatchObject({
      targetProfileId: "cloudmarkup.export.cloudformation-nodejs24-v1",
      solutionRevisionId: REVISION_ID,
    });
  });
  it.each(["disabled", "failed", "unknown"] as const)(
    "prevents submission when hosted capabilities are %s",
    async (state) => {
      const fixture = clientFixture({ job: jobFixture("running") });
      const loadExportCapabilities = vi.fn(() =>
        state === "failed"
          ? Promise.reject(new Error("Private server detail"))
          : Promise.resolve(
              state === "disabled"
                ? {
                    schemaVersion: 1,
                    exports: {
                      targets: [],
                      workload: null,
                      maximumBytes: 4_194_304,
                    },
                  }
                : {
                    schemaVersion: 1,
                    exports: {
                      targets: ["terraform"],
                      workload: "infrastructure-only",
                      maximumBytes: 4_194_304,
                    },
                  },
            ),
      ) as unknown as ExportCapabilitiesLoader;
      renderAuthenticated(
        <SolutionExportCreatePanel
          organizationId={ORGANIZATION_ID}
          principal={principal}
          projectId={PROJECT_ID}
          revisionId={REVISION_ID}
          revisionName="Notes API"
        />,
        fixture.client,
        { loadExportCapabilities },
      );
      await waitFor(() => {
        expect(
          screen.getByRole("status", { name: "Export availability" }),
        ).toHaveTextContent(
          state === "disabled"
            ? "Hosted exports are not available"
            : "We couldn't check export availability",
        );
      });
      expect(
        screen.getByRole("button", { name: "Generate export" }),
      ).toBeDisabled();
      expect(screen.getByRole("option", { name: "Terraform" })).toBeDisabled();
      expect(
        screen.getByRole("option", { name: "CloudFormation" }),
      ).toBeDisabled();
      const form = screen
        .getByRole("button", { name: "Generate export" })
        .closest("form");
      if (form === null) throw new Error("Expected export form.");
      fireEvent.submit(form);
      expect(fixture.request).not.toHaveBeenCalled();
      expect(
        screen.queryByText("Private server detail"),
      ).not.toBeInTheDocument();
    },
  );
  it("rechecks an unavailable service inline and offers only the newly confirmed target", async () => {
    const fixture = clientFixture({ job: jobFixture("running") });
    const loadExportCapabilities = vi
      .fn<ExportCapabilitiesLoader>()
      .mockRejectedValueOnce(new Error("Temporary failure"))
      .mockResolvedValueOnce({
        schemaVersion: 1,
        exports: {
          targets: ["cloudformation"],
          workload: "infrastructure-only",
          maximumBytes: 4_194_304,
        },
      });
    renderAuthenticated(
      <SolutionExportCreatePanel
        organizationId={ORGANIZATION_ID}
        principal={principal}
        projectId={PROJECT_ID}
        revisionId={REVISION_ID}
        revisionName="Notes API"
      />,
      fixture.client,
      { loadExportCapabilities },
    );
    fireEvent.click(await screen.findByRole("button", { name: "Check again" }));
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Generate export" }),
      ).toBeEnabled();
    });
    expect(
      screen.queryByRole("button", { name: "Check again" }),
    ).not.toBeInTheDocument();
    expect(loadExportCapabilities).toHaveBeenCalledTimes(2);
    expect(fixture.request).not.toHaveBeenCalled();
  });
  it("keeps the same IaC target selector across assistance modes", () => {
    const fixture = clientFixture({ job: jobFixture("running") });
    renderAuthenticated(
      <SolutionExportCreatePanel
        organizationId={ORGANIZATION_ID}
        principal={principal}
        projectId={PROJECT_ID}
        revisionId={REVISION_ID}
        revisionName="Notes API"
      />,
      fixture.client,
    );

    const guidedTarget = screen.getByLabelText("Infrastructure target");
    expect(guidedTarget).toHaveValue("terraform");
    expect(
      within(guidedTarget)
        .getAllByRole("option")
        .map(({ textContent }) => textContent),
    ).toEqual(["Terraform", "CloudFormation"]);

    fireEvent.click(screen.getByRole("button", { name: "Professional" }));

    const professionalTarget = screen.getByLabelText("Infrastructure target");
    expect(professionalTarget).toBe(guidedTarget);
    expect(professionalTarget).toHaveValue("terraform");
    expect(
      within(professionalTarget)
        .getAllByRole("option")
        .map(({ textContent }) => textContent),
    ).toEqual(["Terraform", "CloudFormation"]);
  });

  it("creates a job from only the exact revision and approved settings with a retained idempotency key", async () => {
    window.history.replaceState(
      null,
      "",
      `/organizations/${ORGANIZATION_ID}/projects/${PROJECT_ID}/revisions/${REVISION_ID}`,
    );
    let releaseCreate: ((response: JobEnvelope) => void) | undefined;
    const createResponse = new Promise<JobEnvelope>((resolve) => {
      releaseCreate = resolve;
    });
    const runningJob = jobFixture("running");
    const responseJob: SolutionExportJobV1 = {
      ...runningJob,
      target: {
        ...runningJob.target,
        environment: { environmentType: "staging" },
        exportName: "notes-api-reviewed",
        profileId: "cloudmarkup.export.cloudformation-nodejs24-v1",
        diagram: {
          background: "transparent",
          includeStableDeploymentIdentifiers: true,
          maxHeight: 3_072,
          maxWidth: 3_072,
          profile: "technical",
          scale: 3,
        },
      },
    };
    const fixture = clientFixture({ createResponse, job: responseJob });
    renderAuthenticated(
      <SolutionExportCreatePanel
        organizationId={ORGANIZATION_ID}
        principal={principal}
        projectId={PROJECT_ID}
        revisionId={REVISION_ID}
        revisionName="Notes API"
      />,
      fixture.client,
    );

    const environment = screen.getByLabelText("Environment type");
    const infrastructureTarget = screen.getByLabelText("Infrastructure target");
    const exportName = screen.getByLabelText("Export name");
    fireEvent.change(environment, {
      target: { value: "staging" },
    });
    fireEvent.change(infrastructureTarget, {
      target: { value: "cloudformation" },
    });
    const diagramOptions = screen.getByText("Diagram options (optional)");
    expect(diagramOptions.closest("details")).not.toHaveAttribute("open");
    fireEvent.click(diagramOptions);
    const diagramProfile = screen.getByLabelText("Diagram profile");
    expect(diagramProfile).toBeVisible();
    const diagramBackground = screen.getByLabelText("Diagram background");
    const diagramScale = screen.getByLabelText("PNG scale");
    const diagramWidth = screen.getByLabelText("Maximum diagram width");
    const diagramHeight = screen.getByLabelText("Maximum diagram height");
    fireEvent.change(exportName, {
      target: { value: "notes-api-reviewed" },
    });
    fireEvent.change(diagramProfile, { target: { value: "technical" } });
    fireEvent.change(diagramBackground, { target: { value: "transparent" } });
    fireEvent.change(diagramScale, { target: { value: "3" } });
    fireEvent.change(diagramWidth, { target: { value: "3072" } });
    fireEvent.change(diagramHeight, { target: { value: "3072" } });
    fireEvent.click(
      screen.getByLabelText("Include stable deployment identifiers"),
    );
    fireEvent.click(diagramOptions);
    expect(diagramProfile).not.toBeVisible();
    fireEvent.click(diagramOptions);
    expect(diagramProfile).toHaveValue("technical");
    expect(diagramBackground).toHaveValue("transparent");
    expect(diagramScale).toHaveValue("3");
    fireEvent.click(screen.getByRole("button", { name: "Generate export" }));
    await waitFor(() => {
      expect(environment).toBeDisabled();
      expect(infrastructureTarget).toBeDisabled();
      expect(exportName).toBeDisabled();
      expect(diagramProfile).toBeDisabled();
      expect(diagramBackground).toBeDisabled();
      expect(diagramScale).toBeDisabled();
      expect(diagramWidth).toBeDisabled();
      expect(diagramHeight).toBeDisabled();
    });
    if (releaseCreate === undefined)
      throw new Error("The deferred create response was not initialized.");
    releaseCreate({ apiVersion: "v1", data: responseJob });

    await waitFor(() => {
      expect(window.location.pathname).toBe(
        `/organizations/${ORGANIZATION_ID}/projects/${PROJECT_ID}/exports/${JOB_ID}`,
      );
    });
    const call = fixture.request.mock.calls.find(
      ([operationId]) => operationId === "solution-export-jobs.create",
    );
    const body = requestedObject(call?.[1], "body");
    expect(body).toEqual({
      contractVersion: 1,
      environment: { environmentType: "staging" },
      exportName: "notes-api-reviewed",
      diagram: {
        background: "transparent",
        includeStableDeploymentIdentifiers: true,
        maxHeight: 3_072,
        maxWidth: 3_072,
        profile: "technical",
        scale: 3,
      },
      solutionRevisionId: REVISION_ID,
      targetProfileId: "cloudmarkup.export.cloudformation-nodejs24-v1",
    });
    expect(requestedObject(call?.[1], "headers")?.["idempotency-key"]).toMatch(
      /^solution-export:/u,
    );
    expect(requestedObject(call?.[1], "path")).toEqual({
      projectId: PROJECT_ID,
    });
    expect(body).not.toHaveProperty("organizationId");
  });

  it("shows a queued export without claiming execution progress or restarting it", async () => {
    const fixture = clientFixture({ job: jobFixture("queued") });
    renderAuthenticated(exportPage(), fixture.client);
    expect(
      await screen.findByRole("heading", { name: "Waiting to start export" }),
    ).toBeVisible();
    expect(
      screen.getByText(/Your export is saved and waiting for a worker/u),
    ).toBeVisible();
    const progress = screen.queryByRole("progressbar", {
      name: "Export stage progress",
    });
    if (progress !== null) expect(progress).not.toHaveAttribute("value");
    expect(screen.getByRole("button", { name: "Cancel export" })).toBeEnabled();
    expect(
      fixture.request.mock.calls.some(
        ([operation]) => operation === "solution-export-jobs.create",
      ),
    ).toBe(false);
  });

  it("uses server-paced progress and preserves explicit cancellation", async () => {
    const fixture = clientFixture({ job: jobFixture("running") });
    renderAuthenticated(exportPage(), fixture.client);

    expect(
      await screen.findByRole("heading", { name: "Export checks in progress" }),
    ).toBeInTheDocument();
    const settingsDigestLabel = screen.getByText("Target settings digest");
    expect(settingsDigestLabel.nextElementSibling).toHaveTextContent(DIGEST_C);
    expect(
      screen.getByRole("progressbar", { name: "Export stage progress" }),
    ).toHaveAttribute("value", "13");
    fireEvent.click(screen.getByRole("button", { name: "Cancel export" }));
    expect(
      screen.getByRole("dialog", { name: "Cancel this export job?" }),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Request cancellation" }),
    );
    expect(
      await screen.findByRole("heading", { name: "Cancellation requested" }),
    ).toBeInTheDocument();
    expect(
      fixture.request.mock.calls.some(
        ([operationId]) => operationId === "solution-export-jobs.cancel",
      ),
    ).toBe(true);
  });

  it.each(["queued", "running"] as const)(
    "keeps a read-only %s export visible without offering cancellation",
    async (state) => {
      const fixture = clientFixture({ job: jobFixture(state) });
      renderAuthenticated(
        exportPage(JOB_ID, { principal: readOnlyPrincipal() }),
        fixture.client,
      );
      expect(
        await screen.findByRole("heading", {
          name:
            state === "queued"
              ? "Waiting to start export"
              : "Export checks in progress",
        }),
      ).toBeVisible();
      fireEvent.click(
        screen.getByText("Application coverage and build details"),
      );
      expect(screen.getByText("Exact revision assessment")).toBeVisible();
      expect(
        screen.queryByRole("button", { name: "Cancel export" }),
      ).toBeNull();
      expect(
        fixture.request.mock.calls.some(
          ([operation]) => operation === "solution-export-jobs.cancel",
        ),
      ).toBe(false);
    },
  );

  it("withdraws an open cancellation confirmation when export permission is lost", async () => {
    const fixture = clientFixture({ job: jobFixture("running") });
    const view = renderAuthenticated(exportPage(), fixture.client);
    fireEvent.click(
      await screen.findByRole("button", { name: "Cancel export" }),
    );
    expect(
      screen.getByRole("dialog", { name: "Cancel this export job?" }),
    ).toBeVisible();
    view.rerender(exportPage(JOB_ID, { principal: readOnlyPrincipal() }));
    expect(
      screen.queryByRole("dialog", { name: "Cancel this export job?" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancel export" })).toBeNull();
    expect(
      fixture.request.mock.calls.some(
        ([operation]) => operation === "solution-export-jobs.cancel",
      ),
    ).toBe(false);
  });

  it("keeps blocking failures, sanitized diagnostics, and blocked download visible", async () => {
    const job = jobFixture("failed");
    const diagnostic = job.diagnostics[0];
    if (diagnostic === undefined) throw Error("Missing failed diagnostic");
    diagnostic.recoveryReferences = {
      contractVersion: 1,
      locations: [
        { kind: "node", id: "node_api", fieldPath: ["memorySize"] },
        { kind: "edge", id: "edge_api_database" },
      ],
    };
    const fixture = clientFixture({ job });
    renderAuthenticated(exportPage(), fixture.client);

    expect(
      await screen.findByRole("heading", { name: "Export checks failed" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Download blocked" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Exact revision assessment")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: /^Complete supported pattern$/u,
      }),
    ).toBeInTheDocument();
    const verification = screen.getByRole("region", {
      name: "Custom implementation required",
    });
    expect(
      within(verification).getByText(DOWNGRADE_REASON),
    ).toBeInTheDocument();
    expect(
      within(verification).getByText("No passing build Evidence"),
    ).toBeInTheDocument();
    expect(within(verification).getByText(DIGEST_D)).toBeInTheDocument();
    expect(within(verification).getByText(DIGEST_E)).toBeInTheDocument();
    expect(screen.getByText("APPLICATION_BUILD.FAILED")).toBeInTheDocument();
    const affected = screen.getByRole("list", {
      name: "Affected export items",
    });
    const links = within(affected).getAllByRole("link");
    expect(links).toHaveLength(2);
    for (const [index, link] of links.entries()) {
      const target = new URL(
        link.getAttribute("href") ?? "",
        "https://app.test",
      );
      expect(readExportDiagnosticRequest(target.search)).toEqual({
        contractVersion: 1,
        jobId: job.id,
        solutionRevisionId: job.solutionRevision.solutionRevisionId,
        manifestDigest: job.solutionRevision.manifestDigest,
        code: diagnostic.code,
        reference: diagnostic.recoveryReferences.locations[index],
      });
    }
    expect(screen.queryByText(/C:\\Users/u)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Download ZIP" }),
    ).not.toBeInTheDocument();
  });

  it("uses the same review structure for independently verified multi-handler builds", async () => {
    const baseline = jobFixture("succeeded");
    const first = baseline.applicationVerification;
    if (first === undefined) {
      throw new TypeError("Expected generated build verification fixture.");
    }
    const secondEvidenceId = "evidence_application_build_audit";
    const job = solutionExportJobV1Schema.parse({
      ...baseline,
      applicationVerification: undefined,
      applicationVerifications: [
        first,
        {
          ...first,
          buildRequestDigest: DIGEST_C,
          evidenceId: secondEvidenceId,
          workloadId: "workload_secondary_consumer",
        },
      ],
      evidence: [
        ...baseline.evidence,
        {
          digest: DIGEST_C,
          evidenceId: secondEvidenceId,
          kind: "application-build",
          reference: {
            environment: { environmentType: "development" },
            evidenceId: secondEvidenceId,
            record: {
              contractVersion: 1,
              digest: DIGEST_C,
              mediaType: "application/json",
              objectId: "object.evidence.application-build-audit",
              purpose: "evidence",
              sizeBytes: 320,
            },
            solutionRevisionId: REVISION_ID,
          },
          stage: "application-build",
          status: "passed",
        },
      ],
    });
    const fixture = clientFixture({ artifact: artifactFixture(), job });
    renderAuthenticated(exportPage(), fixture.client);

    fireEvent.click(
      await screen.findByText("Application coverage and build details"),
    );
    const verification = await screen.findByRole("region", {
      name: "2 application builds confirmed",
    });
    expect(within(verification).getByText("workload_notes")).toBeVisible();
    expect(
      within(verification).getByText("workload_secondary_consumer"),
    ).toBeVisible();
  });

  it("marks successful infrastructure-only output as requiring application code", async () => {
    const job = jobFixture("succeeded", "infrastructure-only");
    const artifact = artifactFixture(false, true);
    const fixture = clientFixture({ artifact, job });
    renderAuthenticated(exportPage(), fixture.client);

    expect(
      await screen.findByText("Application code is required."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "No application verification recorded",
      }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("tab", { name: "Application" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Application" }));
    expect(
      screen.getByText(
        "Application source is not included for this coverage state.",
      ),
    ).toBeInTheDocument();
  });

  it("does not call failed infrastructure-only work a successful package", async () => {
    const job = jobFixture("failed", "infrastructure-only");
    const fixture = clientFixture({ job });
    renderAuthenticated(exportPage(), fixture.client);

    expect(
      await screen.findByText(
        "This revision assessment covers infrastructure only; no successful package, application source, or Lambda build is claimed.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/This successful package/u),
    ).not.toBeInTheDocument();
  });

  it("shows CloudFormation validation failures without claiming Terraform ran or offering a download", async () => {
    const baseline = jobFixture("failed", "infrastructure-only");
    const job = solutionExportJobV1Schema.parse({
      ...baseline,
      diagnostics: [
        {
          code: "CLOUDFORMATION_VALIDATION.FAILED",
          message: "The generated template did not pass validation.",
          severity: "error",
          stage: "cloudformation-validation",
        },
      ],
      evidence: [
        { ...baseline.evidence[0], status: "passed" },
        {
          digest: DIGEST_F,
          evidenceId: "evidence_cloudformation_validation",
          kind: "cloudformation-validation",
          stage: "cloudformation-validation",
          status: "failed",
        },
      ],
      progress: {
        completedStages: 2,
        message: "CloudFormation validation failed.",
        totalStages: 8,
      },
      stages: stageNames.map((stage, index) => ({
        ...(index < 2 || index === 4
          ? { completedAt: NOW, startedAt: NOW }
          : {}),
        stage:
          stage === "terraform-validation"
            ? "cloudformation-validation"
            : stage,
        status: index < 2 ? "succeeded" : index === 4 ? "failed" : "skipped",
      })),
      target: {
        ...baseline.target,
        profileId: "cloudmarkup.export.cloudformation-nodejs24-v1",
      },
    });
    const fixture = clientFixture({ job });
    renderAuthenticated(exportPage(), fixture.client);

    expect(
      await screen.findByRole("heading", { name: "Download blocked" }),
    ).toBeVisible();
    const stages = screen.getByRole("list", { name: "Export stages" });
    expect(
      within(stages).getByText("cloudformation validation — failed"),
    ).toBeVisible();
    expect(within(stages).queryByText(/terraform/iu)).not.toBeInTheDocument();
    const evidence = screen.getByRole("region", {
      name: "Recorded validation evidence",
    });
    expect(
      within(evidence).getByText("cloudformation validation — failed"),
    ).toBeVisible();
    expect(within(evidence).queryByText(/terraform/iu)).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "We couldn't finish this export. Review the failed checks above, make any needed changes, and try again. No download was created.",
      ),
    ).toBeVisible();
    expect(screen.queryByText(/Terraform validation/u)).not.toBeInTheDocument();
    expect(
      screen.getByText("CLOUDFORMATION_VALIDATION.FAILED"),
    ).not.toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Download ZIP" }),
    ).not.toBeInTheDocument();
  });

  it("shows exact coverage requirements, unresolved behavior, and Evidence", async () => {
    const baseline = jobFixture("succeeded", "custom-implementation-required");
    const job = solutionExportJobV1Schema.parse({
      ...baseline,
      generationCoverage: {
        ...baseline.generationCoverage,
        evidence: [
          {
            evidenceId: "evidence_solution_structural",
            requirement: "structural-validity",
          },
        ],
        missingRequirements: ["application-build-and-tests"],
        workloads: [
          {
            evidence: [
              {
                evidenceId: "evidence_workload_provider",
                requirement: "provider-architecture-validity",
              },
            ],
            missingRequirements: ["deterministic-application-generation"],
            state: "custom-implementation-required",
            unresolvedRequirementIds: ["requirement.notes.retention-policy"],
            workloadId: "workload_notes",
          },
        ],
      },
    });
    const fixture = clientFixture({ artifact: artifactFixture(), job });
    renderAuthenticated(exportPage(), fixture.client);

    expect(
      await screen.findByText("application-build-and-tests"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("deterministic-application-generation"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("requirement.notes.retention-policy"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("evidence_solution_structural"),
    ).toBeInTheDocument();
    expect(screen.getByText("evidence_workload_provider")).toBeInTheDocument();
  });

  it("reviews source, IaC, tests, previous diff, manifest, and performs an authenticated verified download", async () => {
    const artifact = artifactFixture();
    const fixture = clientFixture({ artifact, job: jobFixture("succeeded") });
    const binary = new TextEncoder().encode("zip-bytes").buffer;
    const downloadBinary = vi
      .fn<AuthenticatedBinaryDownloader>()
      .mockResolvedValue({
        bytes: binary,
        digest: ARCHIVE_DIGEST,
        fileName: "notes-api.zip",
        mediaType: "application/zip",
        sizeBytes: 9,
      });
    const createObjectUrl = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:https://app.test/verified");
    const revokeObjectUrl = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
      () => undefined,
    );
    renderAuthenticated(exportPage(), fixture.client, { downloadBinary });

    expect(await screen.findByRole("tab", { name: "IaC" })).toBeInTheDocument();
    expect(screen.getByText("Exact revision assessment")).toBeInTheDocument();
    const verification = screen.getByRole("region", {
      name: "Complete supported pattern confirmed",
    });
    expect(
      within(verification).getByText(BUILD_EVIDENCE_ID),
    ).toBeInTheDocument();
    expect(within(verification).getByText(DIGEST_D)).toBeInTheDocument();
    expect(within(verification).getByText(DIGEST_E)).toBeInTheDocument();
    expect(
      within(verification).queryByText(/Downgrade reason:/u),
    ).not.toBeInTheDocument();
    const orderedTabs = screen
      .getAllByRole("tab")
      .map((tab) => tab.textContent);
    expect(orderedTabs).toEqual([
      "Sources",
      "Diagram",
      "IaC",
      "Application",
      "Built artifacts",
      "Tests",
      "Diff",
      "Manifest",
    ]);
    fireEvent.click(screen.getByRole("tab", { name: "Diagram" }));
    expect(
      await screen.findByAltText(
        "SVG architecture diagram for notes-api-export",
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "PNG preview" }));
    expect(
      screen.getByAltText("PNG architecture diagram for notes-api-export"),
    ).toBeInTheDocument();
    expect(screen.getAllByText(DIGEST_D).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("tab", { name: "IaC" }));
    expect(
      await screen.findByText('resource "aws_lambda_function" "notes" {}'),
    ).toBeInTheDocument();
    const selectedIaC = screen.getByRole("button", {
      name: /infrastructure\/main\.tf/u,
    });
    expect(selectedIaC).toHaveAttribute("aria-current", "true");

    fireEvent.click(screen.getByRole("button", { name: "Professional" }));
    expect(screen.getByRole("tab", { name: "IaC" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(selectedIaC).toHaveAttribute("aria-current", "true");

    fireEvent.click(screen.getByRole("tab", { name: "Tests" }));
    const testsPanel = screen.getByRole("tabpanel", { name: "Tests" });
    expect(
      within(testsPanel).getByRole("heading", {
        name: "Application build/test Evidence",
      }),
    ).toBeInTheDocument();
    expect(within(testsPanel).getByText(BUILD_EVIDENCE_ID)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Diff" }));
    expect(await screen.findByText("Semantic: changed")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Manifest" }));
    expect(
      screen.getByRole("heading", { name: "Complete file tree" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText(ARCHIVE_DIGEST).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Download ZIP" }));
    expect(
      await screen.findByText("Verified ZIP download started."),
    ).toBeInTheDocument();
    expect(downloadBinary).toHaveBeenCalledWith(grantFixture.url);
    expect(createObjectUrl).toHaveBeenCalledTimes(1);
    expect(revokeObjectUrl).toHaveBeenCalledWith(
      "blob:https://app.test/verified",
    );
    expect(
      screen.queryByRole("link", { name: "Download ZIP" }),
    ).not.toBeInTheDocument();
  });

  it.each(["grant", "content"] as const)(
    "keeps the exact streaming-required %s denial clear without a repeat action",
    async (phase) => {
      const grantResponse = vi.fn(() =>
        Promise.resolve({ apiVersion: "v1" as const, data: grantFixture }),
      );
      if (phase === "grant")
        grantResponse.mockRejectedValueOnce(unavailableDownload());
      const downloadBinary = vi
        .fn<AuthenticatedBinaryDownloader>()
        .mockRejectedValue(unavailableDownload());
      const fixture = clientFixture({
        artifact: artifactFixture(),
        job: jobFixture("succeeded"),
        grantResponse,
      });
      const view = renderAuthenticated(exportPage(), fixture.client, {
        downloadBinary,
      });
      fireEvent.click(
        await screen.findByRole("button", { name: "Download ZIP" }),
      );
      expect(
        await screen.findByRole("heading", {
          name: "Archive requires streaming",
        }),
      ).toBeVisible();
      expect(
        screen.getByText(
          /Retrying or creating a new link will not resolve this limit/u,
        ),
      ).toBeVisible();
      expect(screen.queryByText(/Arbitrary server prose/u)).toBeNull();
      expect(screen.queryByRole("button", { name: "Download ZIP" })).toBeNull();
      fireEvent.click(screen.getByRole("tab", { name: "Manifest" }));
      expect(
        screen.getByRole("heading", { name: "Complete file tree" }),
      ).toBeVisible();
      view.rerender(exportPage());
      expect(
        screen.getByRole("heading", { name: "Archive requires streaming" }),
      ).toBeVisible();
      expect(grantResponse).toHaveBeenCalledTimes(1);
      expect(downloadBinary).toHaveBeenCalledTimes(phase === "content" ? 1 : 0);
    },
  );

  it.each([
    ["network", new Error("Synthetic network failure")],
    [
      "generic service denial",
      new ApiClientError(503, {
        apiVersion: "v1",
        error: {
          code: "service_unavailable",
          correlationId: "correlation_export_fixture",
          message:
            "Archive requires streaming. solution-export.download-streaming-required.v1",
        },
      }),
    ],
    ["different issue code", unavailableDownload("solution-export.other.v1")],
    [
      "different issue path",
      unavailableDownload(undefined, ["artifact", "preview"]),
    ],
  ] as const)(
    "keeps a %s retryable without interpreting arbitrary server messages",
    async (_name, error) => {
      const grantResponse = vi
        .fn(() =>
          Promise.resolve({ apiVersion: "v1" as const, data: grantFixture }),
        )
        .mockRejectedValueOnce(error);
      const fixture = clientFixture({
        artifact: artifactFixture(),
        job: jobFixture("succeeded"),
        grantResponse,
      });
      renderAuthenticated(exportPage(), fixture.client);
      fireEvent.click(
        await screen.findByRole("button", { name: "Download ZIP" }),
      );
      await screen.findByRole("heading", {
        name: "Download authorization failed",
      });
      expect(
        screen.queryByRole("heading", { name: "Archive requires streaming" }),
      ).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Download ZIP" }));
      expect(
        await screen.findByRole("button", { name: "Download ZIP" }),
      ).toBeEnabled();
      const calls = fixture.request.mock.calls.filter(
        ([operation]) => operation === "solution-export-download-grants.create",
      );
      expect(calls).toHaveLength(2);
      expect(calls[0]?.[1]).toEqual(calls[1]?.[1]);
    },
  );

  it("keeps an interrupted content download retryable under the same valid grant", async () => {
    const downloadBinary = vi
      .fn<AuthenticatedBinaryDownloader>()
      .mockRejectedValue(new Error("Synthetic connection loss"));
    const fixture = clientFixture({
      artifact: artifactFixture(),
      job: jobFixture("succeeded"),
    });
    renderAuthenticated(exportPage(), fixture.client, { downloadBinary });
    fireEvent.click(
      await screen.findByRole("button", { name: "Download ZIP" }),
    );
    await screen.findByRole("heading", { name: "Verified download failed" });
    expect(
      screen.queryByRole("heading", { name: "Archive requires streaming" }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Download ZIP" }));
    await waitFor(() => {
      expect(downloadBinary).toHaveBeenCalledTimes(2);
    });
    expect(downloadBinary.mock.calls[0]).toEqual(downloadBinary.mock.calls[1]);
  });

  it.each([
    "artifact",
    "digest",
    "principal",
    "organization",
    "project",
  ] as const)(
    "does not carry a permanent denial to another %s binding",
    async (change) => {
      const artifact = artifactFixture();
      const job = jobFixture("succeeded");
      if (job.artifact === undefined)
        throw new Error("Missing artifact fixture.");
      const grantResponse = vi.fn(() => Promise.reject(unavailableDownload()));
      const fixture = clientFixture({ artifact, job, grantResponse });
      const queryClient = new QueryClient({
        defaultOptions: {
          queries: { retry: false, staleTime: Infinity },
          mutations: { retry: false },
        },
      });
      const view = renderAuthenticated(exportPage(), fixture.client, {
        queryClient,
      });
      fireEvent.click(
        await screen.findByRole("button", { name: "Download ZIP" }),
      );
      await screen.findByRole("heading", {
        name: "Archive requires streaming",
      });
      const nextProject = change === "project" ? "project_other" : PROJECT_ID;
      const nextOrganization =
        change === "organization" ? "org_other" : ORGANIZATION_ID;
      const nextPrincipal: CurrentPrincipalV1 = {
        ...principal,
        id: change === "principal" ? "principal_other" : principal.id,
        organizationContexts: principal.organizationContexts.map((context) => ({
          ...context,
          organizationId: nextOrganization,
        })),
      };
      const nextArtifact = {
        ...artifact,
        id: change === "artifact" ? "solutionartifact_other" : ARTIFACT_ID,
        digest: change === "digest" ? DIGEST_F : artifact.digest,
        projectId: nextProject,
      };
      const nextJob = {
        ...job,
        projectId: nextProject,
        artifact: {
          ...job.artifact,
          artifactId: nextArtifact.id,
          digest: nextArtifact.digest,
        },
      };
      act(() => {
        queryClient.setQueryData(
          cloudMarkupQueryKeys.solutionExportJob(
            nextPrincipal.id,
            nextOrganization,
            nextProject,
            JOB_ID,
          ),
          nextJob,
        );
        queryClient.setQueryData(
          cloudMarkupQueryKeys.solutionExportArtifact(
            nextPrincipal.id,
            nextOrganization,
            nextProject,
            nextArtifact.id,
          ),
          nextArtifact,
        );
        view.rerender(
          exportPage(JOB_ID, {
            principal: nextPrincipal,
            organizationId: nextOrganization,
            projectId: nextProject,
          }),
        );
      });
      expect(
        await screen.findByRole("button", { name: "Download ZIP" }),
      ).toBeEnabled();
      expect(
        screen.queryByRole("heading", { name: "Archive requires streaming" }),
      ).toBeNull();
      expect(grantResponse).toHaveBeenCalledTimes(1);
    },
  );

  it("keeps expired artifact review visible without a grant action", async () => {
    const succeededJob = jobFixture("succeeded");
    if (succeededJob.artifact === undefined)
      throw new Error("The successful job fixture must include an artifact.");
    const fixture = clientFixture({
      artifact: artifactFixture(true),
      job: {
        ...succeededJob,
        artifact: {
          ...succeededJob.artifact,
          downloadAvailability: { expiredAt: NOW, state: "expired" },
        },
      },
    });
    renderAuthenticated(exportPage(), fixture.client);

    expect(
      await screen.findByRole("heading", { name: "Artifact download expired" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Manifest" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Download ZIP" }),
    ).not.toBeInTheDocument();
  });

  it("rejects a cross-project job response before caching or disclosure", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const fixture = clientFixture({
      job: { ...jobFixture("failed"), projectId: "project_other" },
    });
    renderAuthenticated(exportPage(), fixture.client, { queryClient });

    expect(
      await screen.findByRole("heading", { name: "Export job unavailable" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Generated application tests did not pass."),
    ).not.toBeInTheDocument();
    expect(
      queryClient.getQueryData(
        cloudMarkupQueryKeys.solutionExportJob(
          principal.id,
          ORGANIZATION_ID,
          PROJECT_ID,
          JOB_ID,
        ),
      ),
    ).toBeUndefined();
  });
});

it("requires an explicit application-source choice and binds the returned job to that choice", async () => {
  const job = jobFixture("queued");
  const fixture = clientFixture({
    job: {
      ...job,
      target: { ...job.target, applicationSource: "ai-source-draft-v3" },
    },
  });
  renderAuthenticated(
    <SolutionExportCreatePanel
      organizationId={ORGANIZATION_ID}
      principal={principal}
      projectId={PROJECT_ID}
      revisionId={REVISION_ID}
      revisionName="Notes API"
    />,
    fixture.client,
    {
      loadAiCapabilities: () =>
        Promise.resolve({
          schemaVersion: 1,
          proposalVersions: [6],
          applicationSources: ["ai-source-draft-v3"],
        }),
    },
  );
  const option = screen.getByRole("checkbox", {
    name: "Generate application source with AI",
  });
  await waitFor(() => expect(option).toBeEnabled());
  expect(option).not.toBeChecked();
  fireEvent.click(option);
  fireEvent.click(screen.getByRole("button", { name: "Generate export" }));
  await waitFor(() => {
    expect(
      fixture.request.mock.calls.some(
        ([operation, args]) =>
          operation === "solution-export-jobs.create" &&
          requestedObject(args, "body")?.["applicationSource"] ===
            "ai-source-draft-v3",
      ),
    ).toBe(true);
  });
});

it("preserves infrastructure-only exports and disables unadvertised source-v3 consent", async () => {
  const fixture = clientFixture({ job: jobFixture("queued") });
  renderAuthenticated(
    <SolutionExportCreatePanel
      organizationId={ORGANIZATION_ID}
      principal={principal}
      projectId={PROJECT_ID}
      revisionId={REVISION_ID}
      revisionName="Notes API"
    />,
    fixture.client,
    {
      loadAiCapabilities: () =>
        Promise.resolve({
          schemaVersion: 1,
          proposalVersions: [],
          applicationSources: [],
        }),
    },
  );
  await screen.findByText(/Reviewed application-source AI is unavailable/u);
  expect(
    screen.getByRole("checkbox", {
      name: "Generate application source with AI",
    }),
  ).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Generate export" }));
  await waitFor(() => {
    expect(
      fixture.request.mock.calls.some(
        ([op]) => op === "solution-export-jobs.create",
      ),
    ).toBe(true);
  });
  const call = fixture.request.mock.calls.find(
    ([op]) => op === "solution-export-jobs.create",
  );
  expect(requestedObject(call?.[1], "body")).not.toHaveProperty(
    "applicationSource",
  );
});
it("does not submit source-v3 when support changes before admission", async () => {
  const fixture = clientFixture({ job: jobFixture("queued") });
  const loader = vi
    .fn()
    .mockResolvedValueOnce({
      schemaVersion: 1,
      proposalVersions: [6],
      applicationSources: ["ai-source-draft-v3"],
    })
    .mockResolvedValue({
      schemaVersion: 1,
      proposalVersions: [],
      applicationSources: [],
    });
  renderAuthenticated(
    <SolutionExportCreatePanel
      organizationId={ORGANIZATION_ID}
      principal={principal}
      projectId={PROJECT_ID}
      revisionId={REVISION_ID}
      revisionName="Notes API"
    />,
    fixture.client,
    { loadAiCapabilities: loader },
  );
  const option = screen.getByRole("checkbox", {
    name: "Generate application source with AI",
  });
  await waitFor(() => expect(option).toBeEnabled());
  fireEvent.click(option);
  fireEvent.click(screen.getByRole("button", { name: "Generate export" }));
  await screen.findByRole("heading", { name: "Export job was not created" });
  expect(
    fixture.request.mock.calls.filter(
      ([op]) => op === "solution-export-jobs.create",
    ),
  ).toHaveLength(0);
  expect(loader).toHaveBeenCalledTimes(2);
});

it("allows infrastructure export when AI becomes unavailable after consent", async () => {
  const fixture = clientFixture({ job: jobFixture("queued") });
  const loader = vi
    .fn()
    .mockResolvedValueOnce({
      schemaVersion: 1,
      proposalVersions: [6],
      applicationSources: ["ai-source-draft-v3"],
    })
    .mockResolvedValue({
      schemaVersion: 1,
      proposalVersions: [],
      applicationSources: [],
    });
  renderAuthenticated(
    <SolutionExportCreatePanel
      organizationId={ORGANIZATION_ID}
      principal={principal}
      projectId={PROJECT_ID}
      revisionId={REVISION_ID}
      revisionName="Notes API"
    />,
    fixture.client,
    { loadAiCapabilities: loader },
  );
  const option = screen.getByRole("checkbox", {
    name: "Generate application source with AI",
  });
  await waitFor(() => expect(option).toBeEnabled());
  fireEvent.click(option);
  fireEvent.click(
    screen.getByRole("button", { name: "Check AI availability" }),
  );
  await screen.findByText(/Reviewed application-source AI is unavailable/u);
  expect(screen.getByText(/AI availability checked\./u)).toBeVisible();
  expect(option).toBeEnabled();
  expect(option).toBeChecked();
  fireEvent.click(option);
  fireEvent.click(screen.getByRole("button", { name: "Generate export" }));
  await waitFor(() => {
    expect(
      fixture.request.mock.calls.filter(
        ([operation]) => operation === "solution-export-jobs.create",
      ),
    ).toHaveLength(1);
  });
  const call = fixture.request.mock.calls.find(
    ([operation]) => operation === "solution-export-jobs.create",
  );
  expect(requestedObject(call?.[1], "body")).not.toHaveProperty(
    "applicationSource",
  );
});

it("does not submit after navigation during AI support admission", async () => {
  const available: RuntimeAiCapabilitiesV1 = {
    schemaVersion: 1,
    proposalVersions: [6],
    applicationSources: ["ai-source-draft-v3"],
  };
  let finishSupport: ((value: RuntimeAiCapabilitiesV1) => void) | undefined;
  const support = new Promise<RuntimeAiCapabilitiesV1>((resolve) => {
    finishSupport = resolve;
  });
  const loader = vi
    .fn()
    .mockResolvedValueOnce(available)
    .mockImplementationOnce(() => support);
  const job = jobFixture("queued");
  const fixture = clientFixture({
    job: {
      ...job,
      target: { ...job.target, applicationSource: "ai-source-draft-v3" },
    },
  });
  const view = renderAuthenticated(
    <SolutionExportCreatePanel
      organizationId={ORGANIZATION_ID}
      principal={principal}
      projectId={PROJECT_ID}
      revisionId={REVISION_ID}
      revisionName="Notes API"
    />,
    fixture.client,
    { loadAiCapabilities: loader },
  );
  const option = screen.getByRole("checkbox", {
    name: "Generate application source with AI",
  });
  await waitFor(() => expect(option).toBeEnabled());
  fireEvent.click(option);
  fireEvent.click(screen.getByRole("button", { name: "Generate export" }));
  await waitFor(() => {
    expect(loader).toHaveBeenCalledTimes(2);
  });
  view.unmount();
  await act(async () => {
    if (!finishSupport) throw new Error("Support fixture was not started.");
    finishSupport(available);
    await support;
  });
  expect(
    fixture.request.mock.calls.filter(
      ([operation]) => operation === "solution-export-jobs.create",
    ),
  ).toHaveLength(0);
});
