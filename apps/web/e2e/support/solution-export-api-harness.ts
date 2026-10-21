import { createHash } from "node:crypto";

import type { BrowserContext, Request, Route } from "@playwright/test";
import {
  createSolutionExportJobV1Schema,
  solutionExportApplicationVerificationV1Schema,
  solutionExportArtifactDiffV1Schema,
  solutionExportArtifactV1Schema,
  solutionExportDownloadGrantV1Schema,
  solutionExportFilePreviewV1Schema,
  solutionExportJobV1Schema,
  type SolutionExportArtifactV1,
  type SolutionExportJobV1,
} from "@cloudmarkup/api-contract";

import {
  TYPED_BACKEND_API_PREFIX,
  TYPED_BACKEND_INFRASTRUCTURE_PROJECT_ID,
  TYPED_BACKEND_NOTES_PROJECT_ID,
  TYPED_BACKEND_ORGANIZATION_ID,
  TypedBackendApiHarness,
} from "./typed-backend-api-harness.js";

export const SOLUTION_EXPORT_ORGANIZATION_ID = TYPED_BACKEND_ORGANIZATION_ID;
export const SOLUTION_EXPORT_NOTES_PROJECT_ID = TYPED_BACKEND_NOTES_PROJECT_ID;
export const SOLUTION_EXPORT_INFRASTRUCTURE_PROJECT_ID =
  TYPED_BACKEND_INFRASTRUCTURE_PROJECT_ID;
export const SOLUTION_EXPORT_SOLUTION_REVISION_ID =
  "solution_typed_backend_1" as const;
export const SOLUTION_EXPORT_EXPORT_JOB_ID =
  "solutionexport_solution_export" as const;
export const SOLUTION_EXPORT_ARTIFACT_ID =
  "solutionartifact_solution_export" as const;
export const SOLUTION_EXPORT_ARCHIVE_DIGEST =
  "sha256:4b9a4ac59f3c3aa32273260df6cf4bf358d1c46f8415126aa35b6380d0abb8f7" as const;
export const SOLUTION_EXPORT_TARGET_SETTINGS_DIGEST =
  `sha256:${"c".repeat(64)}` as const;
export const SOLUTION_EXPORT_BUILD_REQUEST_DIGEST =
  `sha256:${"d".repeat(64)}` as const;
export const SOLUTION_EXPORT_GENERATION_ARTIFACT_DIGEST =
  `sha256:${"e".repeat(64)}` as const;
export const SOLUTION_EXPORT_BUILD_EVIDENCE_ID =
  "evidence_solution_export_application_build" as const;
export const SOLUTION_EXPORT_DOWNGRADE_REASON =
  "Build, tests, security checks, packaging, or reproducibility did not pass." as const;

const NOW = "2026-08-18T12:00:00.000Z" as const;
const RETENTION_EXPIRY = "2026-09-18T12:00:00.000Z" as const;
const DIGEST_A = `sha256:${"a".repeat(64)}` as const;
const DIGEST_B = `sha256:${"b".repeat(64)}` as const;
const BUILD_EVIDENCE_DIGEST = `sha256:${"f".repeat(64)}` as const;
const TERRAFORM_EVIDENCE_DIGEST = `sha256:${"7".repeat(64)}` as const;
const TERRAFORM_EVIDENCE_ID = "evidence_solution_export_terraform" as const;
const PREVIOUS_ARTIFACT_ID =
  "solutionartifact_solution_export_previous" as const;
const DOWNLOAD_GRANT_ID = "downloadgrant_solution_export" as const;
const ARCHIVE_CONTENT = "zip-bytes";
const EXPORT_STAGES = [
  "authorization",
  "compilation",
  "application-generation",
  "application-build",
  "terraform-validation",
  "diagram-rendering",
  "packaging",
  "publication",
] as const;

export type SolutionExportScenario =
  | "infrastructure-only"
  | "generated-starter"
  | "complete-supported"
  | "compiler-error"
  | "application-generation-error"
  | "application-build-error"
  | "application-test-error"
  | "terraform-validation-error"
  | "retry-cancel"
  | "expired-artifact"
  | "reproducible-rerun";

export interface SolutionExportRecordedRequest {
  readonly body: unknown;
  readonly headers: Readonly<Record<string, string>>;
  readonly method: string;
  readonly path: string;
}

interface FailureDescription {
  readonly code: string;
  readonly message: string;
  readonly stage: (typeof EXPORT_STAGES)[number];
}

const failures: Readonly<
  Partial<Record<SolutionExportScenario, FailureDescription>>
> = {
  "compiler-error": {
    code: "COMPILER.INVALID_SOLUTION_REVISION",
    message: "The immutable Solution Revision could not be compiled.",
    stage: "compilation",
  },
  "application-generation-error": {
    code: "APPLICATION_GENERATION.UNSUPPORTED_OPERATION",
    message:
      "A workload operation is outside deterministic generation coverage.",
    stage: "application-generation",
  },
  "application-build-error": {
    code: "APPLICATION_BUILD.TYPECHECK_FAILED",
    message: "Generated application source did not type-check.",
    stage: "application-build",
  },
  "application-test-error": {
    code: "APPLICATION_TEST.CONTRACT_FAILED",
    message: "Generated application contract tests did not pass.",
    stage: "application-build",
  },
  "terraform-validation-error": {
    code: "TERRAFORM_VALIDATION.INVALID_CONFIGURATION",
    message: "Terraform static validation did not pass.",
    stage: "terraform-validation",
  },
};

function requestBody(request: Request): unknown {
  const text = request.postData();
  if (text === null || text.length === 0) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

const DEFAULT_DIAGRAM = {
  background: "opaque-light" as const,
  includeStableDeploymentIdentifiers: false,
  maxHeight: 4_096,
  maxWidth: 4_096,
  profile: "presentation" as const,
  scale: 2,
};

function requestHeaders(request: Request): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(request.headers()).map(([name, value]) => [
      name.toLowerCase(),
      value,
    ]),
  );
}

function data<T>(value: T) {
  return { apiVersion: "v1" as const, data: value };
}

function errorEnvelope(
  code: "access_denied" | "authentication_required" | "not_found",
  message: string,
) {
  return {
    apiVersion: "v1" as const,
    error: {
      code,
      correlationId: "correlation-solution_export-e2e",
      message,
    },
  };
}

async function fulfillJson(
  route: Route,
  status: number,
  json: unknown,
): Promise<void> {
  await route.fulfill({
    headers: { "content-type": "application/json; charset=utf-8" },
    json,
    status,
  });
}

function coverageState(scenario: SolutionExportScenario) {
  if (scenario === "infrastructure-only") return "infrastructure-only";
  if (
    scenario === "generated-starter" ||
    scenario === "application-build-error" ||
    scenario === "application-test-error"
  ) {
    return "starter-application";
  }
  if (scenario === "application-generation-error") {
    return "custom-implementation-required";
  }
  if (scenario === "compiler-error") return "target-unsupported";
  return "complete-supported-pattern";
}

function missingRequirements(scenario: SolutionExportScenario) {
  if (
    scenario === "infrastructure-only" ||
    scenario === "application-generation-error"
  ) {
    return ["deterministic-application-generation" as const];
  }
  if (
    scenario === "generated-starter" ||
    scenario === "application-build-error" ||
    scenario === "application-test-error"
  ) {
    return ["application-build-and-tests" as const];
  }
  if (scenario === "compiler-error") {
    return ["deterministic-infrastructure-compilation" as const];
  }
  return [];
}

function buildCoverage(scenario: SolutionExportScenario) {
  const state = coverageState(scenario);
  const missing = missingRequirements(scenario);
  return {
    contractVersion: 1 as const,
    evidence: [],
    missingRequirements: missing,
    solutionRevisionId: SOLUTION_EXPORT_SOLUTION_REVISION_ID,
    state,
    workloads:
      scenario === "infrastructure-only"
        ? []
        : [
            {
              evidence: [],
              missingRequirements: missing,
              state,
              unresolvedRequirementIds: [],
              workloadId: "workload_notes_api",
            },
          ],
  };
}

function buildApplicationVerification(scenario: SolutionExportScenario) {
  if (scenario === "retry-cancel") return undefined;
  const inputState = coverageState(scenario);
  if (
    inputState !== "starter-application" &&
    inputState !== "complete-supported-pattern"
  ) {
    return undefined;
  }
  const binding = {
    buildRequestDigest: SOLUTION_EXPORT_BUILD_REQUEST_DIGEST,
    generationArtifactDigest: SOLUTION_EXPORT_GENERATION_ARTIFACT_DIGEST,
    inputState,
    solutionRevisionDigest: DIGEST_B,
    solutionRevisionId: SOLUTION_EXPORT_SOLUTION_REVISION_ID,
    workloadId: "workload_notes_api",
  } as const;
  if (
    scenario === "application-build-error" ||
    scenario === "application-test-error"
  ) {
    return solutionExportApplicationVerificationV1Schema.parse({
      ...binding,
      confirmedState: "custom-implementation-required",
      downgradeReason: SOLUTION_EXPORT_DOWNGRADE_REASON,
    });
  }
  return solutionExportApplicationVerificationV1Schema.parse({
    ...binding,
    confirmedState: inputState,
    evidenceId: SOLUTION_EXPORT_BUILD_EVIDENCE_ID,
  });
}

function buildStages(
  scenario: SolutionExportScenario,
  cancellationRequested: boolean,
) {
  const failure = failures[scenario];
  if (scenario === "retry-cancel") {
    return EXPORT_STAGES.map((stage, index) => ({
      ...(index < 2 ? { startedAt: NOW } : {}),
      ...(index === 0 ? { completedAt: NOW } : {}),
      stage,
      status:
        index === 0
          ? ("succeeded" as const)
          : index === 1
            ? cancellationRequested
              ? ("canceled" as const)
              : ("running" as const)
            : cancellationRequested
              ? ("canceled" as const)
              : ("pending" as const),
    }));
  }
  if (failure !== undefined) {
    const failureIndex = EXPORT_STAGES.indexOf(failure.stage);
    return EXPORT_STAGES.map((stage, index) => ({
      ...(index <= failureIndex ? { startedAt: NOW } : {}),
      ...(index <= failureIndex ? { completedAt: NOW } : {}),
      stage,
      status:
        index < failureIndex
          ? ("succeeded" as const)
          : index === failureIndex
            ? ("failed" as const)
            : ("skipped" as const),
    }));
  }
  const generatedCoverage =
    coverageState(scenario) === "starter-application" ||
    coverageState(scenario) === "complete-supported-pattern";
  return EXPORT_STAGES.map((stage) => {
    const status =
      !generatedCoverage &&
      (stage === "application-generation" || stage === "application-build")
        ? ("skipped" as const)
        : ("succeeded" as const);
    return {
      ...(status === "succeeded" ? { completedAt: NOW, startedAt: NOW } : {}),
      stage,
      status,
    };
  });
}

function compareFilePaths(
  left: Readonly<{ path: string }>,
  right: Readonly<{ path: string }>,
): number {
  return left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
}

function buildFiles(scenario: SolutionExportScenario) {
  const sourceFiles = [
    {
      checksum: DIGEST_A,
      id: "solutionfile_architecture",
      mediaType: "application/json" as const,
      ownership: "architecture-as-code-source" as const,
      path: "cloudmarkup/architecture.json",
      previewAvailable: true,
      semanticChecksum: DIGEST_A,
      sizeBytes: 128,
    },
    {
      checksum: DIGEST_A,
      id: "solutionfile_workload",
      mediaType: "application/json" as const,
      ownership: "architecture-as-code-source" as const,
      path: "cloudmarkup/workload.json",
      previewAvailable: true,
      semanticChecksum: DIGEST_A,
      sizeBytes: 96,
    },
    {
      checksum: DIGEST_B,
      id: "solutionfile_iac",
      mediaType: "application/vnd.hashicorp.terraform" as const,
      ownership: "generated-replaceable" as const,
      path: "infrastructure/main.tf",
      previewAvailable: true,
      semanticChecksum: DIGEST_B,
      sizeBytes: 180,
    },
    {
      checksum: DIGEST_A,
      id: "solutionfile_diagram_svg",
      mediaType: "image/svg+xml" as const,
      ownership: "generated-replaceable" as const,
      path: "diagram/architecture.svg",
      previewAvailable: true,
      semanticChecksum: DIGEST_A,
      sizeBytes: 256,
    },
    {
      checksum: DIGEST_B,
      id: "solutionfile_diagram_png",
      mediaType: "image/png" as const,
      ownership: "generated-replaceable" as const,
      path: "diagram/architecture.png",
      previewAvailable: false,
      semanticChecksum: DIGEST_B,
      sizeBytes: 512,
    },
    {
      checksum: DIGEST_A,
      id: "solutionfile_diagram_readme",
      mediaType: "text/markdown" as const,
      ownership: "generated-replaceable" as const,
      path: "diagram/README.md",
      previewAvailable: true,
      semanticChecksum: DIGEST_A,
      sizeBytes: 128,
    },
    {
      checksum: DIGEST_B,
      id: "solutionfile_manifest",
      mediaType: "application/json" as const,
      ownership: "generated-replaceable" as const,
      path: "cloudmarkup/cloudmarkup.manifest.json",
      previewAvailable: true,
      semanticChecksum: DIGEST_B,
      sizeBytes: 320,
    },
  ];
  if (scenario === "infrastructure-only") {
    return sourceFiles.sort(compareFilePaths);
  }
  return [
    ...sourceFiles,
    {
      checksum: DIGEST_A,
      id: "solutionfile_application",
      mediaType: "text/typescript" as const,
      ownership: "generated-replaceable" as const,
      path: "application/src/handler.ts",
      previewAvailable: true,
      semanticChecksum: DIGEST_A,
      sizeBytes: 164,
    },
    {
      checksum: DIGEST_A,
      id: "solutionfile_test",
      mediaType: "text/typescript" as const,
      ownership: "generated-replaceable" as const,
      path: "application/test/handler.test.ts",
      previewAvailable: true,
      semanticChecksum: DIGEST_A,
      sizeBytes: 156,
    },
    {
      checksum: SOLUTION_EXPORT_ARCHIVE_DIGEST,
      id: "solutionfile_lambda_zip",
      mediaType: "application/zip" as const,
      ownership: "generated-build-artifact" as const,
      path: "application/artifacts/workload_notes_api/function.zip",
      previewAvailable: false,
      semanticChecksum: SOLUTION_EXPORT_ARCHIVE_DIGEST,
      sizeBytes: ARCHIVE_CONTENT.length,
    },
  ].sort(compareFilePaths);
}

function buildArtifact(
  scenario: SolutionExportScenario,
): SolutionExportArtifactV1 {
  const files = buildFiles(scenario);
  return solutionExportArtifactV1Schema.parse({
    archiveFileName: "notes-api.zip",
    contractVersion: 1,
    createdAt: NOW,
    digest: SOLUTION_EXPORT_ARCHIVE_DIGEST,
    downloadAvailability:
      scenario === "expired-artifact"
        ? { expiredAt: NOW, state: "expired" }
        : { expiresAt: RETENTION_EXPIRY, state: "available" },
    fileCount: files.length,
    files,
    id: SOLUTION_EXPORT_ARTIFACT_ID,
    jobId: SOLUTION_EXPORT_EXPORT_JOB_ID,
    manifestDigest: DIGEST_B,
    previousArtifactId: PREVIOUS_ARTIFACT_ID,
    projectId:
      scenario === "infrastructure-only"
        ? SOLUTION_EXPORT_INFRASTRUCTURE_PROJECT_ID
        : SOLUTION_EXPORT_NOTES_PROJECT_ID,
    sizeBytes: ARCHIVE_CONTENT.length,
    solutionRevisionId: SOLUTION_EXPORT_SOLUTION_REVISION_ID,
    warnings: [],
  });
}

function buildJob(
  scenario: SolutionExportScenario,
  target: {
    readonly environment: {
      readonly environmentId?: string | undefined;
      readonly environmentType:
        "development" | "test" | "staging" | "production";
    };
    readonly exportName: string;
    readonly diagram: {
      readonly background: "opaque-light" | "canvas-light" | "transparent";
      readonly includeStableDeploymentIdentifiers: boolean;
      readonly maxHeight: number;
      readonly maxWidth: number;
      readonly profile: "presentation" | "technical";
      readonly scale: number;
    };
  },
  cancellationRequested: boolean,
): SolutionExportJobV1 {
  const failure = failures[scenario];
  const applicationVerification = buildApplicationVerification(scenario);
  const active = scenario === "retry-cancel";
  const artifact =
    active || failure !== undefined ? undefined : buildArtifact(scenario);
  const completedStages =
    failure === undefined
      ? active
        ? 1
        : 8
      : EXPORT_STAGES.indexOf(failure.stage);
  const state = active
    ? cancellationRequested
      ? "cancellation-requested"
      : "running"
    : failure === undefined
      ? "succeeded"
      : "failed";
  return solutionExportJobV1Schema.parse({
    ...(artifact === undefined
      ? {}
      : {
          artifact: {
            artifactId: artifact.id,
            digest: artifact.digest,
            downloadAvailability: artifact.downloadAvailability,
            fileCount: artifact.fileCount,
            manifestDigest: artifact.manifestDigest,
            sizeBytes: artifact.sizeBytes,
          },
          completedAt: NOW,
          previousArtifactId: PREVIOUS_ARTIFACT_ID,
        }),
    ...(failure === undefined ? {} : { completedAt: NOW }),
    ...(applicationVerification === undefined
      ? {}
      : { applicationVerification }),
    cancellation: cancellationRequested
      ? { requestedAt: NOW, state: "requested" }
      : { state: "none" },
    contractVersion: 1,
    createdAt: NOW,
    diagnostics:
      failure === undefined
        ? []
        : [
            {
              code: failure.code,
              message: failure.message,
              path: "application/evidence/validation.json",
              severity: "error",
              stage: failure.stage,
              workloadId: "workload_notes_api",
            },
          ],
    evidence: [
      {
        digest: DIGEST_A,
        evidenceId: "evidence_solution_export_compilation",
        kind: "infrastructure-compilation",
        stage: "compilation",
        status:
          failure?.stage === "compilation"
            ? "failed"
            : active
              ? "incomplete"
              : "passed",
      },
      ...(applicationVerification === undefined
        ? []
        : [
            {
              digest: BUILD_EVIDENCE_DIGEST,
              evidenceId: SOLUTION_EXPORT_BUILD_EVIDENCE_ID,
              kind: "application-build" as const,
              reference: {
                environment: target.environment,
                evidenceId: SOLUTION_EXPORT_BUILD_EVIDENCE_ID,
                record: {
                  contractVersion: 1 as const,
                  digest: BUILD_EVIDENCE_DIGEST,
                  mediaType: "application/json",
                  objectId: "object.evidence.solution_export-application-build",
                  purpose: "evidence" as const,
                  sizeBytes: 512,
                },
                solutionRevisionId: SOLUTION_EXPORT_SOLUTION_REVISION_ID,
              },
              stage: "application-build" as const,
              status:
                applicationVerification.confirmedState ===
                "custom-implementation-required"
                  ? ("failed" as const)
                  : ("passed" as const),
            },
            {
              digest: DIGEST_B,
              evidenceId: "evidence_solution_export_application_test",
              kind: "application-test" as const,
              stage: "application-build" as const,
              status:
                applicationVerification.confirmedState ===
                "custom-implementation-required"
                  ? ("failed" as const)
                  : ("passed" as const),
            },
          ]),
      ...(failure === undefined && !active
        ? [
            {
              digest: TERRAFORM_EVIDENCE_DIGEST,
              evidenceId: TERRAFORM_EVIDENCE_ID,
              kind: "terraform-validation" as const,
              reference: {
                environment: target.environment,
                evidenceId: TERRAFORM_EVIDENCE_ID,
                record: {
                  contractVersion: 1 as const,
                  digest: TERRAFORM_EVIDENCE_DIGEST,
                  mediaType: "application/json",
                  objectId:
                    "object.evidence.solution_export-terraform-validation",
                  purpose: "evidence" as const,
                  sizeBytes: 384,
                },
                solutionRevisionId: SOLUTION_EXPORT_SOLUTION_REVISION_ID,
              },
              stage: "terraform-validation" as const,
              status: "passed" as const,
            },
          ]
        : []),
    ],
    generationCoverage: buildCoverage(scenario),
    id: SOLUTION_EXPORT_EXPORT_JOB_ID,
    ...(active ? { pollAfterMilliseconds: 30_000 } : {}),
    progress: {
      completedStages,
      ...(active ? { currentStage: "compilation" as const } : {}),
      message: cancellationRequested
        ? "Cancellation is awaiting worker acknowledgement."
        : active
          ? "A retriable worker interruption was recorded; the exact revision remains bound."
          : (failure?.message ?? "All blocking checks passed."),
      totalStages: 8,
    },
    projectId:
      scenario === "infrastructure-only"
        ? SOLUTION_EXPORT_INFRASTRUCTURE_PROJECT_ID
        : SOLUTION_EXPORT_NOTES_PROJECT_ID,
    requestDigest: DIGEST_A,
    runSequence: 1,
    solutionRevision: {
      manifestDigest: DIGEST_B,
      manifestRecordId: "manifest.solution_export.solution",
      solutionRevisionId: SOLUTION_EXPORT_SOLUTION_REVISION_ID,
    },
    stages: buildStages(scenario, cancellationRequested),
    state,
    target: {
      environment: target.environment,
      exportName: target.exportName,
      profileId: "cloudmarkup.export.terraform-nodejs24-v1",
      settingsDigest: SOLUTION_EXPORT_TARGET_SETTINGS_DIGEST,
      diagram: target.diagram,
    },
    updatedAt: NOW,
    warnings: [
      ...(scenario === "infrastructure-only"
        ? [
            {
              code: "APPLICATION_CODE_REQUIRED",
              message: "Application code is required before deployment.",
            },
          ]
        : []),
      ...(scenario === "retry-cancel"
        ? [
            {
              code: "WORKER_RETRY_SCHEDULED",
              message:
                "A safe retry will continue with the same immutable revision.",
            },
          ]
        : []),
    ],
  });
}

export class SolutionExportExportApiHarness {
  readonly #base: TypedBackendApiHarness;
  readonly #projectId: string;
  readonly #scenario: SolutionExportScenario;
  #cancellationRequested = false;
  #target: {
    readonly environment: {
      readonly environmentId?: string | undefined;
      readonly environmentType:
        "development" | "test" | "staging" | "production";
    };
    readonly exportName: string;
    readonly diagram: {
      readonly background: "opaque-light" | "canvas-light" | "transparent";
      readonly includeStableDeploymentIdentifiers: boolean;
      readonly maxHeight: number;
      readonly maxWidth: number;
      readonly profile: "presentation" | "technical";
      readonly scale: number;
    };
  } = {
    diagram: DEFAULT_DIAGRAM,
    environment: { environmentType: "development" as const },
    exportName: "notes-api-export",
  };
  readonly requests: SolutionExportRecordedRequest[] = [];

  constructor(scenario: SolutionExportScenario = "complete-supported") {
    this.#scenario = scenario;
    this.#projectId =
      scenario === "infrastructure-only"
        ? SOLUTION_EXPORT_INFRASTRUCTURE_PROJECT_ID
        : SOLUTION_EXPORT_NOTES_PROJECT_ID;
    this.#base = new TypedBackendApiHarness();
    this.#base.seedSolutionRevision(
      SOLUTION_EXPORT_NOTES_PROJECT_ID,
      "Prompt 33 Notes API",
    );
    this.#base.seedSolutionRevision(
      SOLUTION_EXPORT_INFRASTRUCTURE_PROJECT_ID,
      "Prompt 33 Infrastructure",
    );
  }

  get projectId(): string {
    return this.#projectId;
  }

  async install(context: BrowserContext): Promise<void> {
    await this.#base.install(context);
    await context.route(`**${TYPED_BACKEND_API_PREFIX}/v1/**`, (route) =>
      this.#handle(route),
    );
  }

  requestCount(method: string, path: string): number {
    return this.requests.filter(
      (request) => request.method === method && request.path === path,
    ).length;
  }

  async #handle(route: Route): Promise<void> {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.slice(TYPED_BACKEND_API_PREFIX.length);
    if (!path.includes("/solution-export-")) {
      await route.fallback();
      return;
    }
    const method = request.method();
    const body = requestBody(request);
    const headers = requestHeaders(request);
    this.requests.push({ body, headers, method, path });

    const jobCollectionMatch =
      /^\/v1\/projects\/([^/]+)\/solution-export-jobs$/u.exec(path);
    if (jobCollectionMatch !== null && method === "POST") {
      const projectId = decodeURIComponent(jobCollectionMatch[1] ?? "");
      if (!(await this.#authorizeProject(route, projectId))) return;
      const parsed = createSolutionExportJobV1Schema.safeParse(body);
      if (!parsed.success || headers["idempotency-key"] === undefined) {
        await fulfillJson(
          route,
          404,
          errorEnvelope("not_found", "The export request is unavailable."),
        );
        return;
      }
      this.#target = {
        diagram: parsed.data.diagram ?? DEFAULT_DIAGRAM,
        environment: parsed.data.environment,
        exportName: parsed.data.exportName,
      };
      await fulfillJson(
        route,
        202,
        data(buildJob(this.#scenario, this.#target, false)),
      );
      return;
    }

    const jobMatch =
      /^\/v1\/projects\/([^/]+)\/solution-export-jobs\/([^/]+)(?:\/(cancel))?$/u.exec(
        path,
      );
    if (jobMatch !== null) {
      const projectId = decodeURIComponent(jobMatch[1] ?? "");
      const jobId = decodeURIComponent(jobMatch[2] ?? "");
      if (
        !(await this.#authorizeProject(route, projectId)) ||
        jobId !== SOLUTION_EXPORT_EXPORT_JOB_ID
      ) {
        if (jobId !== SOLUTION_EXPORT_EXPORT_JOB_ID) {
          await fulfillJson(
            route,
            404,
            errorEnvelope("not_found", "The export job is unavailable."),
          );
        }
        return;
      }
      if (jobMatch[3] === "cancel" && method === "POST") {
        this.#cancellationRequested = true;
        await fulfillJson(
          route,
          200,
          data(buildJob(this.#scenario, this.#target, true)),
        );
        return;
      }
      if (method === "GET") {
        await fulfillJson(
          route,
          200,
          data(
            buildJob(this.#scenario, this.#target, this.#cancellationRequested),
          ),
        );
        return;
      }
    }

    const contentMatch =
      /^\/v1\/projects\/([^/]+)\/solution-export-artifacts\/([^/]+)\/download-grants\/([^/]+)\/content$/u.exec(
        path,
      );
    if (contentMatch !== null && method === "GET") {
      const projectId = decodeURIComponent(contentMatch[1] ?? "");
      const artifactId = decodeURIComponent(contentMatch[2] ?? "");
      const grantId = decodeURIComponent(contentMatch[3] ?? "");
      if (!(await this.#authorizeProject(route, projectId))) return;
      if (
        artifactId !== SOLUTION_EXPORT_ARTIFACT_ID ||
        grantId !== DOWNLOAD_GRANT_ID ||
        headers["authorization"] !==
          "Bearer local-development:solution_export-e2e"
      ) {
        await fulfillJson(
          route,
          401,
          errorEnvelope(
            "authentication_required",
            "Authentication is required.",
          ),
        );
        return;
      }
      await route.fulfill({
        body: ARCHIVE_CONTENT,
        headers: {
          "cache-control": "private, no-store",
          "content-disposition": 'attachment; filename="notes-api.zip"',
          "content-length": String(ARCHIVE_CONTENT.length),
          "content-security-policy": "sandbox",
          "content-type": "application/zip",
          "referrer-policy": "no-referrer",
          "x-cloudmarkup-content-sha256": SOLUTION_EXPORT_ARCHIVE_DIGEST,
          "x-content-type-options": "nosniff",
        },
        status: 200,
      });
      return;
    }

    const previewMatch =
      /^\/v1\/projects\/([^/]+)\/solution-export-artifacts\/([^/]+)\/files\/([^/]+)\/preview$/u.exec(
        path,
      );
    if (previewMatch !== null && method === "GET") {
      const projectId = decodeURIComponent(previewMatch[1] ?? "");
      const artifactId = decodeURIComponent(previewMatch[2] ?? "");
      const fileId = decodeURIComponent(previewMatch[3] ?? "");
      if (!(await this.#authorizeProject(route, projectId))) return;
      const artifact = buildArtifact(this.#scenario);
      const file = artifact.files.find((candidate) => candidate.id === fileId);
      if (artifactId !== artifact.id || !file?.previewAvailable) {
        await fulfillJson(
          route,
          404,
          errorEnvelope("not_found", "The file preview is unavailable."),
        );
        return;
      }
      const content =
        file.mediaType === "application/vnd.hashicorp.terraform"
          ? 'resource "aws_lambda_function" "notes" {}'
          : file.mediaType === "image/svg+xml"
            ? '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360"><title>Prompt 33 architecture</title><desc>Immutable Solution Revision diagram</desc><rect width="640" height="360" fill="#fff"/></svg>'
            : file.mediaType === "text/typescript"
              ? "export const handler = async () => ({ statusCode: 200 });"
              : file.mediaType === "text/markdown"
                ? "# Architecture diagram\n\n[SVG](./architecture.svg) · [PNG](./architecture.png)\n"
                : '{"contractVersion":1,"source":"immutable-solution-revision"}';
      const preview = solutionExportFilePreviewV1Schema.parse({
        artifactId: artifact.id,
        checksum: file.checksum,
        content,
        contractVersion: 1,
        fileId: file.id,
        mediaType: file.mediaType,
        path: file.path,
        sizeBytes: file.sizeBytes,
        truncated: false,
      });
      await fulfillJson(route, 200, data(preview));
      return;
    }

    const diffMatch =
      /^\/v1\/projects\/([^/]+)\/solution-export-artifacts\/([^/]+)\/diff$/u.exec(
        path,
      );
    if (diffMatch !== null && method === "GET") {
      const projectId = decodeURIComponent(diffMatch[1] ?? "");
      const artifactId = decodeURIComponent(diffMatch[2] ?? "");
      if (!(await this.#authorizeProject(route, projectId))) return;
      const diff = solutionExportArtifactDiffV1Schema.parse({
        artifactId,
        contractVersion: 1,
        files: [
          {
            after: {
              checksum: SOLUTION_EXPORT_BUILD_REQUEST_DIGEST,
              mediaType: "text/markdown",
              ownership: "generated-replaceable",
              path: "cloudmarkup/README.md",
              semanticChecksum: SOLUTION_EXPORT_GENERATION_ARTIFACT_DIGEST,
              sizeBytes: 84,
            },
            before: {
              checksum: SOLUTION_EXPORT_TARGET_SETTINGS_DIGEST,
              mediaType: "text/markdown",
              ownership: "generated-replaceable",
              path: "cloudmarkup/README.md",
              semanticChecksum: SOLUTION_EXPORT_GENERATION_ARTIFACT_DIGEST,
              sizeBytes: 80,
            },
            change: "modified",
            path: "cloudmarkup/README.md",
            semanticChange: "formatting-only",
          },
          {
            after: {
              checksum: DIGEST_B,
              mediaType: "application/vnd.hashicorp.terraform",
              ownership: "generated-replaceable",
              path: "infrastructure/main.tf",
              semanticChecksum: DIGEST_B,
              sizeBytes: 180,
            },
            before: {
              checksum: SOLUTION_EXPORT_TARGET_SETTINGS_DIGEST,
              mediaType: "application/vnd.hashicorp.terraform",
              ownership: "generated-replaceable",
              path: "infrastructure/main.tf",
              semanticChecksum: DIGEST_A,
              sizeBytes: 176,
            },
            change: "modified",
            path: "infrastructure/main.tf",
            semanticChange: "changed",
          },
        ],
        previousArtifactId: PREVIOUS_ARTIFACT_ID,
        state: "available",
      });
      await fulfillJson(route, 200, data(diff));
      return;
    }

    const grantMatch =
      /^\/v1\/projects\/([^/]+)\/solution-export-artifacts\/([^/]+)\/download-grants$/u.exec(
        path,
      );
    if (grantMatch !== null && method === "POST") {
      const projectId = decodeURIComponent(grantMatch[1] ?? "");
      const artifactId = decodeURIComponent(grantMatch[2] ?? "");
      if (!(await this.#authorizeProject(route, projectId))) return;
      if (
        this.#scenario === "expired-artifact" ||
        artifactId !== SOLUTION_EXPORT_ARTIFACT_ID ||
        headers["idempotency-key"] === undefined
      ) {
        await fulfillJson(
          route,
          404,
          errorEnvelope("not_found", "The artifact download is unavailable."),
        );
        return;
      }
      const grant = solutionExportDownloadGrantV1Schema.parse({
        artifactId,
        contractVersion: 1,
        digest: SOLUTION_EXPORT_ARCHIVE_DIGEST,
        expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
        fileName: "notes-api.zip",
        id: DOWNLOAD_GRANT_ID,
        mediaType: "application/zip",
        sizeBytes: ARCHIVE_CONTENT.length,
        url: `/v1/projects/${projectId}/solution-export-artifacts/${artifactId}/download-grants/${DOWNLOAD_GRANT_ID}/content`,
      });
      await fulfillJson(route, 201, data(grant));
      return;
    }

    const artifactMatch =
      /^\/v1\/projects\/([^/]+)\/solution-export-artifacts\/([^/]+)$/u.exec(
        path,
      );
    if (artifactMatch !== null && method === "GET") {
      const projectId = decodeURIComponent(artifactMatch[1] ?? "");
      const artifactId = decodeURIComponent(artifactMatch[2] ?? "");
      if (!(await this.#authorizeProject(route, projectId))) return;
      const artifact = buildArtifact(this.#scenario);
      if (artifactId !== artifact.id) {
        await fulfillJson(
          route,
          404,
          errorEnvelope("not_found", "The export artifact is unavailable."),
        );
        return;
      }
      await fulfillJson(route, 200, data(artifact));
      return;
    }

    await fulfillJson(
      route,
      404,
      errorEnvelope("not_found", "The export resource is unavailable."),
    );
  }

  async #authorizeProject(route: Route, projectId: string): Promise<boolean> {
    if (projectId === this.#projectId) return true;
    await fulfillJson(
      route,
      404,
      errorEnvelope("not_found", "The export resource is unavailable."),
    );
    return false;
  }
}

export function solution_exportArchiveSha256(): string {
  return `sha256:${createHash("sha256").update(ARCHIVE_CONTENT, "utf8").digest("hex")}`;
}
