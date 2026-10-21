import { serializeCanonicalJson } from "@cloudmarkup/schemas";
import { sha256Digest } from "@cloudmarkup/solution-export";
import { describe, expect, it } from "vitest";

import {
  solutionExportRepositoryWorkflowReviewV1Schema,
  solutionExportWorkflowCheckpointIdentity,
  solutionExportWorkflowReadModelV1Schema,
  solutionExportWorkflowRequestV1Schema,
  solutionExportWorkflowRequestDigest,
} from "./contracts.js";
import {
  canonicalBytes,
  evidenceReference,
  failedBuildResult,
  workflowTargetSettings,
  workflowFixture,
} from "./workflow.test-support.js";

describe("solution export workflow contracts", () => {
  it("accepts explicit source-v3 with a distinct immutable request digest and retains old source choices", () => {
    const request = workflowFixture().request;
    const digests = [
      "ai-source-draft-v1",
      "ai-source-draft-v2",
      "ai-source-draft-v3",
    ].map((applicationSource) =>
      solutionExportWorkflowRequestDigest(
        solutionExportWorkflowRequestV1Schema.parse({
          ...request,
          applicationSource,
        }),
      ),
    );
    expect(new Set(digests).size).toBe(3);
  });
  it("binds explicit infrastructure delivery and rejects unknown, AI, build, and target combinations", () => {
    const request = workflowFixture(
      "infrastructure-only",
      "cloudformation",
    ).request;
    const selected = {
      ...request,
      applicationDelivery: "infrastructure-only-v1",
    };
    expect(solutionExportWorkflowRequestV1Schema.parse(request)).toEqual(
      request,
    );
    const parsed = solutionExportWorkflowRequestV1Schema.parse(selected);
    expect(solutionExportWorkflowRequestDigest(parsed)).not.toBe(
      solutionExportWorkflowRequestDigest(request),
    );
    for (const value of [
      { ...selected, applicationDelivery: "infrastructure-only-v2" },
      { ...selected, applicationSource: "ai-source-draft-v2" },
      { ...selected, applicationSource: "ai-source-draft-v3" },
      {
        ...selected,
        sources: {
          ...selected.sources,
          applicationBuildInputs: request.sources.architectureDocument,
        },
      },
      {
        ...selected,
        targetProfileId: "cloudmarkup.export.terraform-nodejs24-v1",
      },
    ])
      expect(
        solutionExportWorkflowRequestV1Schema.safeParse(value).success,
      ).toBe(false);
  });
  it("distinguishes the immutable manifest record ID from its content object", () => {
    const fixture = workflowFixture();

    expect(fixture.request.subject.manifestRecordId).toBe(
      "record.solution-revision.1",
    );
    expect(fixture.request.sources.solutionRevision.objectId).toBe(
      "object.solution-revision-content.1",
    );
    expect(fixture.request.subject.manifestRecordId).not.toBe(
      fixture.request.sources.solutionRevision.objectId,
    );
    expect(
      solutionExportWorkflowRequestV1Schema.safeParse(fixture.request).success,
    ).toBe(true);
  });

  it("requires the exact Solution Revision content digest and durable JSON sources", () => {
    const fixture = workflowFixture();

    expect(
      solutionExportWorkflowRequestV1Schema.safeParse({
        ...fixture.request,
        sources: {
          ...fixture.request.sources,
          solutionRevision: {
            ...fixture.request.sources.solutionRevision,
            digest: sha256Digest("different-revision"),
          },
        },
      }).success,
    ).toBe(false);
    expect(
      solutionExportWorkflowRequestV1Schema.safeParse({
        ...fixture.request,
        sources: {
          ...fixture.request.sources,
          architectureDocument: {
            ...fixture.request.sources.architectureDocument,
            mediaType: "application/octet-stream",
          },
        },
      }).success,
    ).toBe(false);
  });

  it("requires exact immutable approval configuration digests while admitting explicit denial", () => {
    const fixture = workflowFixture();
    const configuration = {
      contractVersion: 1,
      generatorProfile: "github-actions-aws-terraform-v1",
    };
    const shared = {
      contractVersion: 1 as const,
      kind: "cloudmarkup.solution-export-repository-workflow-review" as const,
      solutionRevision: {
        digest: fixture.request.subject.manifestDigest,
        id: fixture.request.subject.solutionRevisionId,
      },
    };
    const approved = {
      ...shared,
      configuration,
      configurationDigest: sha256Digest(serializeCanonicalJson(configuration)),
      decision: "approved" as const,
    };

    expect(
      solutionExportRepositoryWorkflowReviewV1Schema.safeParse(approved)
        .success,
    ).toBe(true);
    expect(
      solutionExportRepositoryWorkflowReviewV1Schema.safeParse({
        ...approved,
        configurationDigest: sha256Digest("substituted-configuration"),
      }).success,
    ).toBe(false);
    expect(
      solutionExportRepositoryWorkflowReviewV1Schema.safeParse({
        ...shared,
        decision: "denied",
        reason: "policy-denied",
      }).success,
    ).toBe(true);
  });

  it("rejects forged target settings digests and incomplete stage commitments", () => {
    const fixture = workflowFixture();

    expect(
      solutionExportWorkflowRequestV1Schema.safeParse({
        ...fixture.request,
        targetSettings: {
          ...fixture.request.targetSettings,
          digest: sha256Digest("forged-target-settings"),
        },
      }).success,
    ).toBe(false);

    const stageDescriptors = fixture.request.targetSettings.stageDescriptors;
    if (!("terraformValidation" in stageDescriptors)) {
      throw new TypeError("Expected Terraform workflow fixture.");
    }
    const { adapter, limitsDigest, profileDigest, profileId } =
      stageDescriptors.terraformValidation;
    const incompleteValidation = {
      adapter,
      limitsDigest,
      profileDigest,
      profileId,
    };
    expect(
      solutionExportWorkflowRequestV1Schema.safeParse({
        ...fixture.request,
        targetSettings: {
          ...fixture.request.targetSettings,
          stageDescriptors: {
            ...stageDescriptors,
            terraformValidation: incompleteValidation,
          },
        },
      }).success,
    ).toBe(false);
  });

  it("seals CloudFormation as a distinct reviewed target-settings projection", () => {
    const fixture = workflowFixture();
    const targetSettings = workflowTargetSettings("cloudformation");
    const cloudFormationFixture = workflowFixture(
      "infrastructure-only",
      "cloudformation",
    );

    expect(targetSettings.target).toBe("cloudformation");
    expect(targetSettings.digest).not.toBe(
      fixture.request.targetSettings.digest,
    );
    expect(cloudFormationFixture.request.targetSettings).toEqual(
      targetSettings,
    );
    expect(cloudFormationFixture.request.targetProfileId).toBe(
      "cloudmarkup.export.cloudformation-nodejs24-v1",
    );
  });

  it.each(["unit", "contract"] as const)(
    "retains the exact %s-test coverage downgrade with its failed build report",
    (testKind) => {
      const fixture = workflowFixture("complete-supported-pattern");
      const build = failedBuildResult(fixture, testKind);
      const evidence = evidenceReference(
        build.evidence,
        fixture.request.environment,
      );
      const reportBytes = canonicalBytes(build);
      const report = {
        artifact: {
          artifactId: `artifact.build-report.${testKind}`,
          digest: build.reportDigest,
          kind: "application-build-report" as const,
          mediaType: "application/json",
          object: {
            contractVersion: 1 as const,
            digest: build.reportDigest,
            mediaType: "application/json",
            objectId: `object.build-report.${testKind}`,
            purpose: "build-output" as const,
            sizeBytes: reportBytes.byteLength,
          },
          sizeBytes: reportBytes.byteLength,
        },
        evidenceRecords: [evidence],
        stage: "build-application" as const,
      };
      const failure = {
        classification: "permanent" as const,
        code: "cloudmarkup.export.build-failed",
        publicMessage: "export-build-failed" as const,
        stage: "build-application" as const,
      };
      const readModel = {
        applicationVerification: build.coverage,
        contractVersion: 1 as const,
        diagnostics: [
          {
            code: `application.build.${testKind}-tests-failed`,
            origin: "application-build" as const,
            severity: "error" as const,
            stage: "build-application" as const,
          },
          {
            code: "cloudmarkup.export.build-failed",
            origin: "workflow" as const,
            severity: "error" as const,
            stage: "build-application" as const,
          },
        ],
        downloadPolicy: {
          reason: "stage-failed" as const,
          state: "blocked" as const,
        },
        environment: fixture.request.environment,
        evidenceRecords: [evidence],
        evidenceSemantics: [
          {
            evidenceId: evidence.evidenceId,
            kind: "application-build" as const,
            status: "failed" as const,
          },
        ],
        failure,
        jobId: fixture.record.jobId,
        requestDigest: sha256Digest(serializeCanonicalJson(fixture.request)),
        stageReports: [report],
        stages: [
          { stage: "resolve-request" as const, state: "succeeded" as const },
          {
            stage: "compile-infrastructure" as const,
            state: "succeeded" as const,
          },
          {
            stage: "generate-application" as const,
            artifact: {
              digest: build.coverage.generationArtifactDigest,
              kind: "application-source" as const,
              mediaType: "application/json",
              sizeBytes: 1,
            },
            state: "succeeded" as const,
          },
          {
            failure,
            stage: "build-application" as const,
            state: "failed" as const,
          },
        ],
        state: "failed" as const,
        subject: fixture.request.subject,
        targetProfileId: fixture.request.targetProfileId,
        targetSettingsDigest: fixture.request.targetSettings.digest,
        warnings: [],
      };

      expect(
        solutionExportWorkflowReadModelV1Schema.parse(readModel),
      ).toMatchObject({
        applicationVerification: {
          confirmedState: "custom-implementation-required",
          inputState: "complete-supported-pattern",
          workloadId: "workload_notes_api",
        },
        downloadPolicy: { reason: "stage-failed", state: "blocked" },
      });
      expect(
        solutionExportWorkflowReadModelV1Schema.safeParse({
          ...readModel,
          applicationVerification: undefined,
        }).success,
      ).toBe(false);
      expect(
        solutionExportWorkflowReadModelV1Schema.safeParse({
          ...readModel,
          applicationVerification: {
            ...readModel.applicationVerification,
            confirmedState: "complete-supported-pattern",
            evidenceId: evidence.evidenceId,
          },
        }).success,
      ).toBe(false);
      const foreignBuildEvidence = {
        ...evidence,
        evidenceId: "evidence_terraform_validation_foreign",
        record: {
          ...evidence.record,
          objectId: "object.evidence.terraform-validation-foreign",
        },
      };
      expect(
        solutionExportWorkflowReadModelV1Schema.safeParse({
          ...readModel,
          applicationVerification: {
            ...readModel.applicationVerification,
            evidenceId: evidence.evidenceId,
          },
          evidenceRecords: [evidence, foreignBuildEvidence],
          stageReports: [
            {
              ...report,
              evidenceRecords: [foreignBuildEvidence],
            },
          ],
        }).success,
      ).toBe(false);
      expect(
        solutionExportWorkflowReadModelV1Schema.safeParse({
          ...readModel,
          stageReports: [],
        }).success,
      ).toBe(false);
    },
  );

  it("derives a deterministic retry checkpoint identity from immutable inputs", () => {
    const fixture = workflowFixture();
    const checkpoint = {
      completedStage: "compile-infrastructure" as const,
      contractVersion: 1 as const,
      environment: fixture.request.environment,
      inputDigest: fixture.record.inputDigest,
      kind: "cloudmarkup.solution-export-workflow-checkpoint" as const,
      requestDigest: sha256Digest(serializeCanonicalJson(fixture.request)),
      stages: [
        { stage: "resolve-request" as const, state: "succeeded" as const },
        {
          stage: "compile-infrastructure" as const,
          state: "succeeded" as const,
        },
      ],
      subject: fixture.request.subject,
      targetProfileId: fixture.request.targetProfileId,
      targetSettingsDigest: fixture.request.targetSettings.digest,
      warnings: [],
    };

    expect(solutionExportWorkflowCheckpointIdentity(checkpoint)).toBe(
      solutionExportWorkflowCheckpointIdentity(structuredClone(checkpoint)),
    );
  });
});
