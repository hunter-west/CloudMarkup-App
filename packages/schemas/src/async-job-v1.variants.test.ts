import { describe, expect, it } from "vitest";

import {
  asyncJobInputV1Schema,
  asyncJobOutputV1Schema,
  asyncJobRecordV1Schema,
} from "./async-job-v1.js";

const digestA = `sha256:${"a".repeat(64)}`;
const digestB = `sha256:${"b".repeat(64)}`;
const at = "2026-08-15T12:00:00Z";
const environment = { environmentType: "development" as const };
const draftSubject = {
  contentDigest: digestA,
  draftId: "draft.1",
  draftVersion: 3,
  etag: '"etag.3"',
  kind: "draft" as const,
};
const revisionSubject = {
  kind: "solution-revision" as const,
  manifestDigest: digestA,
  manifestRecordId: "manifest-record.1",
  solutionRevisionId: "solution-revision.1",
};
const inputReference = {
  contractVersion: 1 as const,
  digest: digestA,
  mediaType: "application/json",
  objectId: "object.input",
  purpose: "input-payload" as const,
  sizeBytes: 10,
};

const inputs: readonly [string, unknown][] = [
  [
    "intent-extraction",
    {
      contractVersion: 1,
      family: "intent-extraction",
      source: inputReference,
      subject: draftSubject,
    },
  ],
  [
    "architecture-proposal",
    {
      contractVersion: 1,
      family: "architecture-proposal",
      intentDocument: inputReference,
      subject: draftSubject,
    },
  ],
  [
    "workload-contract-proposal",
    {
      architecture: inputReference,
      contractVersion: 1,
      family: "workload-contract-proposal",
      subject: draftSubject,
    },
  ],
  [
    "graph-workload-operation-proposal",
    {
      architecture: inputReference,
      contractVersion: 1,
      family: "graph-workload-operation-proposal",
      request: inputReference,
      subject: draftSubject,
    },
  ],
  [
    "iac-compilation",
    {
      compilerTargetId: "compiler.terraform",
      contractVersion: 1,
      environment,
      family: "iac-compilation",
      subject: revisionSubject,
    },
  ],
  [
    "application-source-generation",
    {
      contractVersion: 1,
      environment,
      family: "application-source-generation",
      generatorTargetId: "generator.application",
      subject: revisionSubject,
    },
  ],
  [
    "application-build-test-package",
    {
      buildProfileId: "build.standard",
      contractVersion: 1,
      environment,
      family: "application-build-test-package",
      source: inputReference,
      subject: revisionSubject,
    },
  ],
  [
    "static-validation draft",
    {
      contractVersion: 1,
      environment,
      family: "static-validation",
      inputs: [inputReference],
      subject: draftSubject,
      validationProfileId: "validation.standard",
    },
  ],
  [
    "static-validation revision",
    {
      contractVersion: 1,
      environment,
      family: "static-validation",
      inputs: [inputReference],
      subject: revisionSubject,
      validationProfileId: "validation.standard",
    },
  ],
  [
    "diagram-rendering",
    {
      contractVersion: 1,
      family: "diagram-rendering",
      format: "svg",
      rendererTargetId: "renderer.diagram",
      subject: revisionSubject,
    },
  ],
  [
    "combined-export-packaging",
    {
      artifacts: [inputReference],
      contractVersion: 1,
      family: "combined-export-packaging",
      packageFormat: "zip",
      subject: revisionSubject,
    },
  ],
  [
    "solution-export-orchestration",
    {
      contractVersion: 1,
      environment,
      family: "solution-export-orchestration",
      request: inputReference,
      subject: revisionSubject,
      targetProfileId: "export.standard",
      targetSettingsDigest: digestB,
    },
  ],
  [
    "github-repository-export",
    {
      contractVersion: 1,
      environment,
      family: "github-repository-export",
      package: inputReference,
      subject: revisionSubject,
      target: {
        branch: "cloudmarkup/export",
        integrationId: "integration.1",
        name: "example",
        owner: "customer",
      },
    },
  ],
  [
    "customer-owned-plan-evidence",
    {
      contractVersion: 1,
      environment,
      family: "customer-owned-plan-evidence",
      subject: revisionSubject,
      targetId: "target.customer",
    },
  ],
  [
    "deployment-evidence",
    {
      contractVersion: 1,
      environment,
      family: "deployment-evidence",
      planEvidenceId: "evidence.plan",
      subject: revisionSubject,
      targetId: "target.customer",
    },
  ],
  [
    "smoke-integration-evidence",
    {
      contractVersion: 1,
      environment,
      family: "smoke-integration-evidence",
      subject: revisionSubject,
      suiteIds: ["suite.smoke"],
      targetId: "target.customer",
    },
  ],
  [
    "drift-evidence",
    {
      contractVersion: 1,
      environment,
      family: "drift-evidence",
      subject: revisionSubject,
      targetId: "target.customer",
    },
  ],
  [
    "billing-usage-reconciliation",
    {
      batch: inputReference,
      contractVersion: 1,
      family: "billing-usage-reconciliation",
      periodEnd: "2026-08-15T13:00:00Z",
      periodStart: at,
      subject: { kind: "organization" },
    },
  ],
];

function baseRecord() {
  return {
    attempts: [],
    cancellation: { state: "none" },
    checkpoints: [],
    contractVersion: 1,
    correlationId: "correlation.1",
    createdAt: at,
    family: "intent-extraction",
    idempotency: {
      actorId: "actor.1",
      keyDigest: digestA,
      operationId: "jobs.create",
      requestDigest: digestB,
    },
    input: inputs[0]?.[1],
    inputDigest: digestB,
    interaction: { state: "none" },
    inputSizeBytes: 128,
    jobId: "job.1",
    limits: {
      artifactCount: 8,
      attemptCount: 3,
      checkpointBytes: 1_024,
      checkpointCount: 4,
      contractVersion: 1,
      inlineInputBytes: 1_024,
      outputBytes: 4_096,
      referencedInputBytes: 1_024,
      runtimeSeconds: 100,
    },
    orchestration: {
      dependencyJobIds: [],
      expectedChildJobIds: [],
      failurePolicy: "fail-parent",
      rootJobId: "job.1",
    },
    ownership: {
      organizationId: "organization.1",
      projectId: "project.1",
    },
    queuedAt: at,
    recordVersion: 1,
    reservation: { state: "none" },
    state: "queued",
    updatedAt: at,
  };
}

const transientFailure = {
  classification: "transient" as const,
  code: "jobs.transient",
  publicMessage: "job-temporarily-unavailable" as const,
};

describe("Async Job v1 family and aggregate invariants", () => {
  it.each(inputs)("accepts the %s input contract", (_name, input) => {
    expect(asyncJobInputV1Schema.safeParse(input).success).toBe(true);
  });

  it.each([
    "iac-compilation",
    "application-source-generation",
    "application-build-test-package",
    "static-validation",
    "solution-export-orchestration",
    "github-repository-export",
    "customer-owned-plan-evidence",
  ])("requires an explicit Evidence environment for %s", (family) => {
    const input = inputs
      .map(([, candidate]) => candidate)
      .find(
        (candidate): candidate is Record<string, unknown> =>
          candidate !== null &&
          typeof candidate === "object" &&
          (candidate as Record<string, unknown>)["family"] === family,
      );
    if (input === undefined) {
      throw new Error(`missing fixture for ${family}`);
    }
    const withoutEnvironment = Object.fromEntries(
      Object.entries(input).filter(([key]) => key !== "environment"),
    );
    expect(asyncJobInputV1Schema.safeParse(withoutEnvironment).success).toBe(
      false,
    );
    expect(
      asyncJobInputV1Schema.safeParse({
        ...input,
        environment: { environmentType: "unknown" },
      }).success,
    ).toBe(true);
  });

  it("requires a durable orchestration request reference", () => {
    expect(
      asyncJobInputV1Schema.safeParse({
        contractVersion: 1,
        environment,
        family: "solution-export-orchestration",
        request: { ...inputReference, expiresAt: at },
        subject: revisionSubject,
        targetProfileId: "export.standard",
        targetSettingsDigest: digestB,
      }).success,
    ).toBe(false);
    expect(
      asyncJobInputV1Schema.safeParse({
        contractVersion: 1,
        environment,
        family: "solution-export-orchestration",
        request: { ...inputReference, purpose: "export-package" },
        subject: revisionSubject,
        targetProfileId: "export.standard",
        targetSettingsDigest: digestB,
      }).success,
    ).toBe(false);
    expect(
      asyncJobInputV1Schema.safeParse({
        contractVersion: 1,
        environment,
        family: "solution-export-orchestration",
        request: { ...inputReference, mediaType: "application/octet-stream" },
        subject: revisionSubject,
        targetProfileId: "export.standard",
        targetSettingsDigest: digestB,
      }).success,
    ).toBe(false);
    expect(
      asyncJobInputV1Schema.safeParse({
        contractVersion: 1,
        environment,
        family: "solution-export-orchestration",
        request: inputReference,
        subject: revisionSubject,
        targetProfileId: "export.standard",
        targetSettingsDigest: "not-a-sha256-digest",
      }).success,
    ).toBe(false);
  });

  it("accepts only a verified export package purpose and bounded Evidence", () => {
    const evidence = {
      environment,
      evidenceId: "evidence.export.1",
      record: {
        ...inputReference,
        objectId: "object.evidence.export.1",
        purpose: "evidence" as const,
      },
      solutionRevisionId: revisionSubject.solutionRevisionId,
    };
    const output = {
      contractVersion: 1,
      evidenceRecords: [evidence],
      family: "solution-export-orchestration",
      verifiedPackage: {
        artifactId: "artifact.export.1",
        availability: { state: "available" },
        object: {
          ...inputReference,
          mediaType: "application/zip",
          objectId: "object.export.1",
          purpose: "export-package",
        },
      },
    };
    expect(asyncJobOutputV1Schema.safeParse(output).success).toBe(true);
    expect(
      asyncJobOutputV1Schema.safeParse({
        ...output,
        verifiedPackage: {
          ...output.verifiedPackage,
          object: {
            ...output.verifiedPackage.object,
            purpose: "build-output",
          },
        },
      }).success,
    ).toBe(false);
    expect(
      asyncJobOutputV1Schema.safeParse({
        ...output,
        evidenceRecords: Array.from({ length: 33 }, (_, index) => ({
          ...evidence,
          evidenceId: `evidence.export.${String(index)}`,
          record: {
            ...evidence.record,
            objectId: `object.evidence.export.${String(index)}`,
          },
        })),
      }).success,
    ).toBe(false);
  });

  it("bounds cumulative runtime across retries", () => {
    const result = asyncJobRecordV1Schema.safeParse({
      ...baseRecord(),
      attempts: [1, 2].map((attemptNumber) => ({
        attemptId: `attempt.${String(attemptNumber)}`,
        attemptNumber,
        completedAt: at,
        failure: transientFailure,
        retryDisposition: { kind: "do-not-retry" as const },
        runtimeSeconds: 60,
        startedAt: at,
        state: "failed",
      })),
    });
    expect(result.success).toBe(false);
  });

  it("rejects measured output beyond the configured limit", () => {
    const result = asyncJobRecordV1Schema.safeParse({
      ...baseRecord(),
      completedAt: at,
      output: {
        contractVersion: 1,
        evidenceRecords: [],
        family: "intent-extraction",
        proposal: {
          contractVersion: 1,
          digest: digestA,
          mediaType: "application/json",
          objectId: "object.proposal",
          purpose: "proposal",
          sizeBytes: 100,
        },
      },
      outputSizeBytes: 4_097,
      state: "succeeded",
    });
    expect(result.success).toBe(false);
  });

  it("rejects output byte measurements below aggregate referenced output", () => {
    const result = asyncJobRecordV1Schema.safeParse({
      ...baseRecord(),
      completedAt: at,
      output: {
        contractVersion: 1,
        evidenceRecords: [],
        family: "intent-extraction",
        proposal: {
          contractVersion: 1,
          digest: digestA,
          mediaType: "application/json",
          objectId: "object.proposal",
          purpose: "proposal",
          sizeBytes: 100,
        },
      },
      outputSizeBytes: 99,
      state: "succeeded",
    });
    expect(result.success).toBe(false);
  });

  it("rejects duplicate Evidence identities in aggregate output", () => {
    const evidence = (objectId: string) => ({
      environment,
      evidenceId: "evidence.duplicate",
      record: {
        contractVersion: 1,
        digest: digestA,
        mediaType: "application/json",
        objectId,
        purpose: "evidence",
        sizeBytes: 100,
      },
      solutionRevisionId: revisionSubject.solutionRevisionId,
    });
    const result = asyncJobRecordV1Schema.safeParse({
      ...baseRecord(),
      completedAt: at,
      family: "static-validation",
      input: {
        contractVersion: 1,
        environment,
        family: "static-validation",
        inputs: [inputReference],
        subject: revisionSubject,
        validationProfileId: "validation.standard",
      },
      output: {
        contractVersion: 1,
        evidenceRecords: [
          evidence("object.evidence.1"),
          evidence("object.evidence.2"),
        ],
        family: "static-validation",
        report: {
          artifactId: "artifact.report",
          availability: { state: "available" },
          object: {
            contractVersion: 1,
            digest: digestA,
            mediaType: "application/json",
            objectId: "object.report",
            purpose: "validation-report",
            sizeBytes: 100,
          },
        },
      },
      outputSizeBytes: 300,
      state: "succeeded",
    });
    expect(result.success).toBe(false);
  });

  it("rejects Evidence for a different Solution Revision", () => {
    const result = asyncJobRecordV1Schema.safeParse({
      ...baseRecord(),
      completedAt: at,
      family: "static-validation",
      input: {
        contractVersion: 1,
        environment,
        family: "static-validation",
        inputs: [inputReference],
        subject: revisionSubject,
        validationProfileId: "validation.standard",
      },
      output: {
        contractVersion: 1,
        evidenceRecords: [
          {
            environment,
            evidenceId: "evidence.1",
            record: {
              contractVersion: 1,
              digest: digestA,
              mediaType: "application/json",
              objectId: "object.evidence",
              purpose: "evidence",
              sizeBytes: 100,
            },
            solutionRevisionId: "solution-revision.different",
          },
        ],
        family: "static-validation",
        report: {
          artifactId: "artifact.report",
          availability: { state: "available" },
          object: {
            contractVersion: 1,
            digest: digestA,
            mediaType: "application/json",
            objectId: "object.report",
            purpose: "validation-report",
            sizeBytes: 100,
          },
        },
      },
      outputSizeBytes: 200,
      state: "succeeded",
    });
    expect(result.success).toBe(false);
  });
});
