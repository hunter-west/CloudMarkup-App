import { describe, expect, it } from "vitest";

import {
  SOLUTION_EXPORT_STAGES_V1,
  solutionExportStagesForTargetProfile,
  solutionExportFilePreviewV1Schema,
  createSolutionExportJobV1Schema,
  solutionExportApplicationVerificationV1Schema,
  solutionExportArtifactDiffV1Schema,
  solutionExportArtifactV1Schema,
  solutionExportDownloadResponseHeadersV1Schema,
  solutionExportJobV1Schema,
} from "./solution-exports.js";

const NOW = "2026-08-18T12:00:00.000Z";
const LATER = "2026-09-18T12:00:00.000Z";
const DIGEST_B = `sha256:${"b".repeat(64)}`;
const DIGEST = `sha256:${"a".repeat(64)}`;

function coverage() {
  return {
    contractVersion: 1 as const,
    evidence: [],
    missingRequirements: ["deterministic-application-generation" as const],
    solutionRevisionId: "solution_main",
    state: "infrastructure-only" as const,
    workloads: [],
  };
}

function job() {
  return {
    cancellation: { state: "none" as const },
    contractVersion: 1 as const,
    createdAt: NOW,
    diagnostics: [
      {
        code: "APPLICATION_CODE_REQUIRED",
        message: "Application code is required.",
        severity: "warning" as const,
        stage: "application-generation" as const,
      },
    ],
    evidence: [],
    generationCoverage: coverage(),
    id: "solutionexport_main",
    pollAfterMilliseconds: 1_000,
    progress: {
      completedStages: 1,
      currentStage: "compilation" as const,
      message: "The export is queued.",
      totalStages: 8 as const,
    },
    projectId: "project_main",
    requestDigest: DIGEST,
    runSequence: 1,
    solutionRevision: {
      manifestDigest: DIGEST,
      manifestRecordId: "record.solution.main",
      solutionRevisionId: "solution_main",
    },
    stages: SOLUTION_EXPORT_STAGES_V1.map((stage) => ({
      stage,
      status:
        stage === "authorization"
          ? ("succeeded" as const)
          : ("pending" as const),
    })),
    state: "queued" as const,
    target: {
      diagram: {
        background: "opaque-light" as const,
        includeStableDeploymentIdentifiers: false,
        maxHeight: 4_096,
        maxWidth: 4_096,
        profile: "presentation" as const,
        scale: 2,
      },
      environment: { environmentType: "development" as const },
      exportName: "Notes API",
      profileId: "cloudmarkup.export.terraform-nodejs24-v1" as const,
      settingsDigest: DIGEST,
    },
    updatedAt: NOW,
    warnings: [],
  };
}

describe("Solution Export API v1", () => {
  it("accepts truthful CloudFormation stages and local evidence without changing Terraform response shapes", () => {
    const existing = job();
    expect(solutionExportJobV1Schema.parse(existing)).toEqual(existing);
    const profileId = "cloudmarkup.export.cloudformation-nodejs24-v1";
    const reference = {
      environment: existing.target.environment,
      evidenceId: "evidence.cfn",
      solutionRevisionId: existing.solutionRevision.solutionRevisionId,
      record: {
        contractVersion: 1,
        objectId: "object.evidence.cfn",
        digest: DIGEST,
        mediaType: "application/json",
        purpose: "evidence",
        sizeBytes: 1,
      },
    };
    const cfn = {
      ...existing,
      target: { ...existing.target, profileId },
      stages: solutionExportStagesForTargetProfile(profileId).map((stage) => ({
        stage,
        status:
          stage === "application-generation" || stage === "application-build"
            ? "skipped"
            : "succeeded",
      })),
      state: "succeeded",
      completedAt: LATER,
      updatedAt: LATER,
      pollAfterMilliseconds: undefined,
      progress: {
        completedStages: 8,
        totalStages: 8,
        message: "The verified infrastructure package is ready.",
      },
      evidence: [
        {
          evidenceId: reference.evidenceId,
          digest: DIGEST,
          reference,
          kind: "cloudformation-validation",
          stage: "cloudformation-validation",
          status: "passed",
        },
      ],
      artifact: {
        artifactId: "solutionartifact_main",
        digest: DIGEST,
        manifestDigest: DIGEST,
        fileCount: 1,
        sizeBytes: 1,
        downloadAvailability: { expiresAt: LATER, state: "available" },
      },
    };
    expect(solutionExportJobV1Schema.safeParse(cfn).success).toBe(true);
    expect(
      solutionExportJobV1Schema.safeParse({
        ...cfn,
        evidence: cfn.evidence.map((entry) => ({
          ...entry,
          kind: "terraform-validation",
          stage: "terraform-validation",
        })),
      }).success,
    ).toBe(false);
    expect(
      solutionExportJobV1Schema.safeParse({ ...cfn, target: existing.target })
        .success,
    ).toBe(false);
    expect(
      solutionExportJobV1Schema.safeParse({ ...cfn, stages: existing.stages })
        .success,
    ).toBe(false);
    expect(
      solutionExportJobV1Schema.safeParse({
        ...existing,
        target: { ...existing.target, profileId },
      }).success,
    ).toBe(false);
    for (const base of [
      existing,
      {
        ...existing,
        target: { ...existing.target, profileId },
        stages: solutionExportStagesForTargetProfile(profileId).map(
          (stage, index) => ({
            stage,
            status: index === 0 ? "succeeded" : "pending",
          }),
        ),
      },
    ]) {
      const opposite =
        base.target.profileId === profileId
          ? "terraform-validation"
          : "cloudformation-validation";
      expect(
        solutionExportJobV1Schema.safeParse({
          ...base,
          progress: { ...base.progress, currentStage: opposite },
        }).success,
      ).toBe(false);
      expect(
        solutionExportJobV1Schema.safeParse({
          ...base,
          diagnostics: [
            {
              code: "validation.synthetic",
              message: "Synthetic diagnostic.",
              severity: "info",
              stage: opposite,
            },
          ],
        }).success,
      ).toBe(false);
      expect(
        solutionExportJobV1Schema.safeParse({
          ...base,
          evidence: [
            {
              evidenceId: reference.evidenceId,
              digest: DIGEST,
              reference,
              kind: opposite,
              stage: opposite,
              status: "passed",
            },
          ],
        }).success,
      ).toBe(false);
    }
    const preview = {
      artifactId: "solutionartifact_main",
      checksum: DIGEST,
      content: "{}",
      contractVersion: 1,
      fileId: "solutionfile_template",
      mediaType: "application/vnd.amazon.cloudformation.template+json",
      path: "infrastructure/template.json",
      sizeBytes: 2,
      truncated: false,
    };
    expect(solutionExportFilePreviewV1Schema.parse(preview)).toEqual(preview);
  });
  it("accepts selectors only and rejects browser-supplied authority or hashes", () => {
    const valid = {
      contractVersion: 1,
      environment: { environmentType: "development" },
      exportName: "Notes API",
      solutionRevisionId: "solution_main",
      targetProfileId: "cloudmarkup.export.terraform-nodejs24-v1",
    };
    expect(createSolutionExportJobV1Schema.parse(valid)).toEqual(valid);
    expect(
      createSolutionExportJobV1Schema.parse({
        ...valid,
        targetProfileId: "cloudmarkup.export.cloudformation-nodejs24-v1",
      }).targetProfileId,
    ).toBe("cloudmarkup.export.cloudformation-nodejs24-v1");
    expect(
      createSolutionExportJobV1Schema.parse({
        ...valid,
        diagram: job().target.diagram,
      }).diagram,
    ).toEqual(job().target.diagram);
    expect(
      createSolutionExportJobV1Schema.safeParse({
        ...valid,
        diagram: {
          ...job().target.diagram,
          includeStableDeploymentIdentifiers: true,
        },
      }).success,
    ).toBe(false);
    expect(
      createSolutionExportJobV1Schema.safeParse({
        ...valid,
        organizationId: "org_other",
      }).success,
    ).toBe(false);
    expect(
      createSolutionExportJobV1Schema.safeParse({
        ...valid,
        manifestDigest: DIGEST,
      }).success,
    ).toBe(false);
    for (const exportName of [
      "../notes",
      "notes/api",
      "notes\\api",
      "<b>notes</b>",
    ]) {
      expect(
        createSolutionExportJobV1Schema.safeParse({ ...valid, exportName })
          .success,
      ).toBe(false);
    }
  });

  it("binds application verification to revision, generation, and durable Evidence", () => {
    const reference = {
      environment: { environmentType: "development" as const },
      evidenceId: "evidence.application-build.main",
      record: {
        contractVersion: 1 as const,
        digest: DIGEST,
        mediaType: "application/json",
        objectId: "object.evidence.application-build.main",
        purpose: "evidence" as const,
        sizeBytes: 1,
      },
      solutionRevisionId: "solution_main",
    };
    const applicationVerification = {
      buildRequestDigest: DIGEST,
      confirmedState: "complete-supported-pattern" as const,
      evidenceId: reference.evidenceId,
      generationArtifactDigest: DIGEST,
      inputState: "complete-supported-pattern" as const,
      solutionRevisionDigest: DIGEST,
      solutionRevisionId: "solution_main",
      workloadId: "workload_notes_api",
    };
    const evidence = {
      digest: DIGEST,
      evidenceId: reference.evidenceId,
      kind: "application-build" as const,
      reference,
      stage: "application-build" as const,
      status: "passed" as const,
    };
    const terraformReference = {
      ...reference,
      evidenceId: "evidence.terraform-validation.main",
      record: {
        ...reference.record,
        objectId: "object.evidence.terraform-validation.main",
      },
    };
    const terraformEvidence = {
      digest: DIGEST,
      evidenceId: terraformReference.evidenceId,
      kind: "terraform-validation" as const,
      reference: terraformReference,
      stage: "terraform-validation" as const,
      status: "passed" as const,
    };
    const running = {
      ...job(),
      applicationVerification,
      evidence: [evidence],
      generationCoverage: {
        ...coverage(),
        missingRequirements: [],
        state: "complete-supported-pattern" as const,
      },
      progress: {
        completedStages: 4,
        currentStage: "terraform-validation" as const,
        message: "The generated application passed isolated verification.",
        totalStages: 8 as const,
      },
      stages: SOLUTION_EXPORT_STAGES_V1.map((stage, index) => ({
        stage,
        status:
          index < 4
            ? ("succeeded" as const)
            : index === 4
              ? ("running" as const)
              : ("pending" as const),
      })),
      state: "running" as const,
    };
    expect(solutionExportJobV1Schema.safeParse(running).success).toBe(true);
    const succeeded = {
      ...running,
      artifact: {
        artifactId: "solutionartifact_main",
        digest: DIGEST,
        downloadAvailability: { expiresAt: LATER, state: "available" as const },
        fileCount: 0,
        manifestDigest: DIGEST,
        sizeBytes: 0,
      },
      completedAt: LATER,
      evidence: [evidence, terraformEvidence],
      pollAfterMilliseconds: undefined,
      progress: {
        completedStages: 8,
        message: "The verified export is ready.",
        totalStages: 8 as const,
      },
      stages: SOLUTION_EXPORT_STAGES_V1.map((stage) => ({
        stage,
        status: "succeeded" as const,
      })),
      state: "succeeded" as const,
    };
    expect(solutionExportJobV1Schema.safeParse(succeeded).success).toBe(true);
    const secondReference = {
      ...reference,
      evidenceId: "evidence.application-build.secondary",
      record: {
        ...reference.record,
        digest: DIGEST_B,
        objectId: "object.evidence.application-build.secondary",
      },
    };
    const secondVerification = {
      ...applicationVerification,
      buildRequestDigest: DIGEST_B,
      evidenceId: secondReference.evidenceId,
      workloadId: "workload_secondary",
    };
    const secondEvidence = {
      ...evidence,
      digest: DIGEST_B,
      evidenceId: secondReference.evidenceId,
      reference: secondReference,
    };
    const batch = {
      ...succeeded,
      applicationVerification: undefined,
      applicationVerifications: [applicationVerification, secondVerification],
      evidence: [evidence, secondEvidence, terraformEvidence],
    };
    expect(solutionExportJobV1Schema.safeParse(batch).success).toBe(true);
    expect(
      solutionExportJobV1Schema.safeParse({
        ...batch,
        applicationVerification,
      }).success,
    ).toBe(false);
    expect(
      solutionExportJobV1Schema.safeParse({
        ...batch,
        applicationVerifications: [...batch.applicationVerifications].reverse(),
      }).success,
    ).toBe(false);
    expect(
      solutionExportJobV1Schema.safeParse({
        ...batch,
        applicationVerifications: [
          applicationVerification,
          {
            ...secondVerification,
            workloadId: applicationVerification.workloadId,
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      solutionExportJobV1Schema.safeParse({
        ...batch,
        applicationVerifications: [
          applicationVerification,
          {
            ...secondVerification,
            evidenceId: applicationVerification.evidenceId,
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      solutionExportJobV1Schema.safeParse({
        ...batch,
        evidence: [evidence, terraformEvidence],
      }).success,
    ).toBe(false);
    expect(
      solutionExportJobV1Schema.safeParse({
        ...batch,
        applicationVerifications: [applicationVerification],
      }).success,
    ).toBe(false);
    expect(
      solutionExportJobV1Schema.safeParse({
        ...succeeded,
        evidence: [evidence],
      }).success,
    ).toBe(false);
    for (const stage of SOLUTION_EXPORT_STAGES_V1) {
      expect(
        solutionExportJobV1Schema.safeParse({
          ...succeeded,
          stages: succeeded.stages.map((entry) =>
            entry.stage === stage
              ? { ...entry, status: "skipped" as const }
              : entry,
          ),
        }).success,
      ).toBe(false);
    }
    expect(
      solutionExportJobV1Schema.safeParse({
        ...succeeded,
        applicationVerification: undefined,
      }).success,
    ).toBe(false);
    expect(
      solutionExportJobV1Schema.safeParse({
        ...succeeded,
        generationCoverage: coverage(),
      }).success,
    ).toBe(false);
    expect(
      solutionExportJobV1Schema.safeParse({
        ...succeeded,
        applicationVerification: undefined,
        evidence: [terraformEvidence],
        generationCoverage: coverage(),
        stages: succeeded.stages.map((entry) => ({
          ...entry,
          status:
            entry.stage === "application-generation" ||
            entry.stage === "application-build"
              ? ("skipped" as const)
              : entry.status,
        })),
      }).success,
    ).toBe(true);
    expect(
      solutionExportJobV1Schema.safeParse({
        ...succeeded,
        applicationVerification: undefined,
        evidence: [terraformEvidence],
        generationCoverage: coverage(),
        stages: succeeded.stages.map((entry) => ({
          ...entry,
          status:
            entry.stage === "application-build"
              ? ("skipped" as const)
              : entry.status,
        })),
      }).success,
    ).toBe(true);
    expect(
      solutionExportJobV1Schema.safeParse({
        ...succeeded,
        applicationVerification: undefined,
        evidence: [terraformEvidence],
        generationCoverage: coverage(),
        stages: succeeded.stages.map((entry) => ({
          ...entry,
          status:
            entry.stage === "application-generation"
              ? ("skipped" as const)
              : entry.status,
        })),
      }).success,
    ).toBe(false);
    expect(
      solutionExportJobV1Schema.safeParse({
        ...running,
        applicationVerification: {
          ...applicationVerification,
          solutionRevisionDigest: `sha256:${"b".repeat(64)}`,
        },
      }).success,
    ).toBe(false);
    expect(
      solutionExportJobV1Schema.safeParse({
        ...running,
        applicationVerification: {
          ...applicationVerification,
          inputState: "starter-application",
        },
      }).success,
    ).toBe(false);
    expect(
      solutionExportJobV1Schema.safeParse({ ...running, evidence: [] }).success,
    ).toBe(false);
    expect(
      solutionExportApplicationVerificationV1Schema.safeParse({
        ...applicationVerification,
        confirmedState: "custom-implementation-required",
      }).success,
    ).toBe(false);
    expect(
      solutionExportApplicationVerificationV1Schema.safeParse({
        ...applicationVerification,
        confirmedState: "custom-implementation-required",
        downgradeReason: "Application verification did not pass.",
        evidenceId: undefined,
      }).success,
    ).toBe(true);
    expect(
      solutionExportApplicationVerificationV1Schema.safeParse({
        ...applicationVerification,
        generationArtifactDigest: undefined,
      }).success,
    ).toBe(false);
  });

  it("retains exact upstream diagnostic codes and enforces canonical progress", () => {
    const parsed = solutionExportJobV1Schema.parse(job());
    const metadata = {
      contractVersion: 1,
      locations: [
        { kind: "node", id: "node_worker", fieldPath: ["timeoutSeconds"] },
        { kind: "edge", id: "edge_database" },
      ],
    };
    const withMetadata = (recoveryReferences: unknown) => ({
      ...job(),
      diagnostics: job().diagnostics.map((diagnostic) => ({
        ...diagnostic,
        recoveryReferences,
      })),
    });
    expect(
      solutionExportJobV1Schema.parse(withMetadata(metadata)).diagnostics[0]
        ?.recoveryReferences,
    ).toEqual(metadata);
    expect(parsed.diagnostics[0]?.recoveryReferences).toBeUndefined();
    for (const invalid of [
      { ...metadata, contractVersion: 2 },
      { ...metadata, apply: true },
      {
        ...metadata,
        locations: Array.from({ length: 33 }, () => metadata.locations[0]),
      },
      {
        ...metadata,
        locations: [
          { kind: "node", id: "node_worker", fieldPath: ["__proto__"] },
        ],
      },
      {
        ...metadata,
        locations: [{ kind: "repository", path: "../private.pem" }],
      },
      {
        ...metadata,
        locations: [{ kind: "node", id: "<script>secret</script>" }],
      },
    ])
      expect(
        solutionExportJobV1Schema.safeParse(withMetadata(invalid)).success,
      ).toBe(false);
    expect(parsed.runSequence).toBe(1);
    expect(
      solutionExportJobV1Schema.safeParse({
        ...job(),
        runSequence: undefined,
      }).success,
    ).toBe(false);
    expect(
      solutionExportJobV1Schema.safeParse({
        ...job(),
        rerunOfJobId: "solutionexport_previous",
      }).success,
    ).toBe(false);
    expect(
      solutionExportJobV1Schema.safeParse({
        ...job(),
        rerunOfJobId: job().id,
        runSequence: 2,
      }).success,
    ).toBe(true);
    expect(
      solutionExportJobV1Schema.safeParse({ ...job(), runSequence: 2 }).success,
    ).toBe(false);
    expect(parsed.diagnostics[0]?.code).toBe("APPLICATION_CODE_REQUIRED");
    expect(
      solutionExportJobV1Schema.safeParse({
        ...job(),
        generationCoverage: {
          ...job().generationCoverage,
          solutionRevisionId: "solution_other",
        },
      }).success,
    ).toBe(false);
    expect(
      solutionExportJobV1Schema.safeParse({
        ...job(),
        progress: { ...job().progress, completedStages: 9 },
      }).success,
    ).toBe(false);
    expect(
      solutionExportJobV1Schema.safeParse({
        ...job(),
        stages: [...job().stages].reverse(),
      }).success,
    ).toBe(false);
    expect(
      solutionExportJobV1Schema.safeParse({
        ...job(),
        completedAt: LATER,
        pollAfterMilliseconds: undefined,
        state: "succeeded",
      }).success,
    ).toBe(false);
    expect(
      solutionExportJobV1Schema.safeParse({
        ...job(),
        pollAfterMilliseconds: undefined,
        state: "failed",
      }).success,
    ).toBe(false);
  });

  it("binds durable Evidence and retains truthful terminal failure state", () => {
    const reference = {
      environment: { environmentType: "development" as const },
      evidenceId: "evidence.main",
      record: {
        contractVersion: 1 as const,
        digest: DIGEST,
        mediaType: "application/json",
        objectId: "object.evidence.main",
        purpose: "evidence" as const,
        sizeBytes: 1,
      },
      solutionRevisionId: "solution_main",
    };
    const evidenceJob = {
      ...job(),
      evidence: [
        {
          digest: DIGEST,
          evidenceId: "evidence.main",
          kind: "terraform-validation" as const,
          reference,
          stage: "terraform-validation" as const,
          status: "passed" as const,
        },
      ],
    };
    expect(solutionExportJobV1Schema.safeParse(evidenceJob).success).toBe(true);
    expect(
      solutionExportJobV1Schema.safeParse({
        ...evidenceJob,
        evidence: [
          {
            ...evidenceJob.evidence[0],
            reference: {
              ...reference,
              solutionRevisionId: "solution_other",
            },
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      solutionExportJobV1Schema.safeParse({
        ...evidenceJob,
        evidence: [
          {
            ...evidenceJob.evidence[0],
            reference: {
              ...reference,
              evidenceId: "evidence.other",
            },
          },
        ],
      }).success,
    ).toBe(false);

    const failedWithoutReviewTruth = {
      ...job(),
      completedAt: LATER,
      pollAfterMilliseconds: undefined,
      progress: {
        completedStages: 2,
        message: "The export failed.",
        totalStages: 7 as const,
      },
      state: "failed" as const,
    };
    expect(
      solutionExportJobV1Schema.safeParse(failedWithoutReviewTruth).success,
    ).toBe(false);
    expect(
      solutionExportJobV1Schema.safeParse({
        ...job(),
        cancellation: { requestedAt: NOW, state: "requested" },
        completedAt: LATER,
        pollAfterMilliseconds: undefined,
        progress: {
          completedStages: 2,
          message: "The export was canceled.",
          totalStages: 7 as const,
        },
        stages: job().stages.map((stage, index) => ({
          ...stage,
          status: index === 1 ? ("canceled" as const) : stage.status,
        })),
        state: "canceled",
      }).success,
    ).toBe(false);
  });

  it("keeps expired artifact review metadata while making availability explicit", () => {
    const base = {
      archiveFileName: "notes-api.zip",
      contractVersion: 1,
      createdAt: NOW,
      digest: DIGEST,
      fileCount: 0,
      files: [],
      id: "solutionartifact_main",
      jobId: "solutionexport_main",
      manifestDigest: DIGEST,
      projectId: "project_main",
      sizeBytes: 0,
      solutionRevisionId: "solution_main",
      warnings: [],
    };
    expect(
      solutionExportArtifactV1Schema.parse({
        ...base,
        downloadAvailability: { expiresAt: LATER, state: "available" },
      }).downloadAvailability.state,
    ).toBe("available");
    expect(
      solutionExportArtifactV1Schema.parse({
        ...base,
        downloadAvailability: { expiredAt: LATER, state: "expired" },
      }).downloadAvailability.state,
    ).toBe("expired");
  });

  it("enforces portable artifact paths, unique file IDs, and canonical order", () => {
    const file = {
      checksum: DIGEST,
      id: "solutionfile_a",
      mediaType: "text/plain" as const,
      ownership: "generated-replaceable" as const,
      path: "a.txt",
      previewAvailable: true,
      semanticChecksum: DIGEST,
      sizeBytes: 1,
    };
    const artifact = {
      archiveFileName: "notes-api.zip",
      contractVersion: 1 as const,
      createdAt: NOW,
      digest: DIGEST,
      downloadAvailability: { expiresAt: LATER, state: "available" as const },
      fileCount: 2,
      files: [file, { ...file, id: "solutionfile_b", path: "b.txt" }],
      id: "solutionartifact_main",
      jobId: "solutionexport_main",
      manifestDigest: DIGEST,
      projectId: "project_main",
      sizeBytes: 2,
      solutionRevisionId: "solution_main",
      warnings: [],
    };
    expect(solutionExportArtifactV1Schema.safeParse(artifact).success).toBe(
      true,
    );
    expect(
      solutionExportArtifactV1Schema.safeParse({
        ...artifact,
        files: [
          { ...file, path: "A.txt" },
          { ...file, id: "solutionfile_b", path: "a.txt" },
        ],
      }).success,
    ).toBe(false);
    expect(
      solutionExportArtifactV1Schema.safeParse({
        ...artifact,
        files: [file, { ...file, path: "b.txt" }],
      }).success,
    ).toBe(false);
    expect(
      solutionExportArtifactV1Schema.safeParse({
        ...artifact,
        files: [...artifact.files].reverse(),
      }).success,
    ).toBe(false);
  });

  it("binds diff availability and classifies ownership-only changes", () => {
    const before = {
      checksum: DIGEST,
      mediaType: "text/plain" as const,
      ownership: "generated-replaceable" as const,
      path: "a.txt",
      semanticChecksum: DIGEST,
      sizeBytes: 1,
    };
    const ownershipChange = {
      after: { ...before, ownership: "user-provided" as const },
      before,
      change: "modified" as const,
      path: "a.txt",
      semanticChange: "changed" as const,
    };
    const unchanged = {
      after: { ...before, path: "b.txt" },
      before: { ...before, path: "b.txt" },
      change: "unchanged" as const,
      path: "b.txt",
      semanticChange: "unchanged" as const,
    };
    const available = {
      artifactId: "solutionartifact_main",
      contractVersion: 1 as const,
      files: [ownershipChange, unchanged],
      previousArtifactId: "solutionartifact_previous",
      state: "available" as const,
    };
    expect(
      solutionExportArtifactDiffV1Schema.safeParse(available).success,
    ).toBe(true);
    expect(
      solutionExportArtifactDiffV1Schema.safeParse({
        ...available,
        files: [
          { ...ownershipChange, semanticChange: "formatting-only" },
          unchanged,
        ],
      }).success,
    ).toBe(false);
    expect(
      solutionExportArtifactDiffV1Schema.safeParse({
        ...available,
        files: [...available.files].reverse(),
      }).success,
    ).toBe(false);
    expect(
      solutionExportArtifactDiffV1Schema.safeParse({
        ...available,
        files: [
          {
            after: { ...before, path: "A.txt" },
            change: "added",
            path: "A.txt",
            semanticChange: "added",
          },
          {
            after: before,
            change: "added",
            path: "a.txt",
            semanticChange: "added",
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      solutionExportArtifactDiffV1Schema.safeParse({
        artifactId: "solutionartifact_main",
        contractVersion: 1,
        files: [],
        previousArtifactId: "solutionartifact_previous",
        state: "unavailable",
      }).success,
    ).toBe(false);
    expect(
      solutionExportArtifactDiffV1Schema.safeParse({
        artifactId: "solutionartifact_main",
        contractVersion: 1,
        files: [],
        state: "available",
      }).success,
    ).toBe(false);
  });

  it("accepts only safe deterministic ZIP response headers", () => {
    const headers = {
      "cache-control": "private, no-store",
      "content-disposition": 'attachment; filename="notes-api.zip"',
      "content-length": "1024",
      "content-security-policy": "sandbox",
      "content-type": "application/zip",
      "referrer-policy": "no-referrer",
      "x-cloudmarkup-content-sha256": DIGEST,
      "x-content-type-options": "nosniff",
    } as const;
    expect(
      solutionExportDownloadResponseHeadersV1Schema.safeParse(headers).success,
    ).toBe(true);
    expect(
      solutionExportDownloadResponseHeadersV1Schema.safeParse({
        ...headers,
        "content-disposition":
          'attachment; filename="notes-api.zip"\r\nX-Injected: true',
      }).success,
    ).toBe(false);
    expect(
      solutionExportDownloadResponseHeadersV1Schema.safeParse({
        ...headers,
        "content-type": "text/html",
      }).success,
    ).toBe(false);
  });
});
