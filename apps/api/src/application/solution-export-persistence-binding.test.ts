import {
  serializeCanonicalJson,
  sha256DigestSchema,
} from "@cloudmarkup/schemas";
import {
  solutionExportWorkflowRequestDigest,
  solutionExportWorkflowRequestV1Schema,
} from "@cloudmarkup/solution-export-workflow";
import { describe, expect, it } from "vitest";

import { createInMemoryApprovedTargetSettings } from "../testing/in-memory-solution-exports.js";
import {
  createSolutionExportRunInsertionBindingV1,
  validateSolutionExportRunInsertionBindingV1,
  sha256DigestToSqlHex,
  sqlHexToSha256Digest,
} from "./solution-export-persistence-binding.js";
import {
  solutionExportPrimaryInputDigest,
  type SolutionExportWorkflowEnqueueV1,
} from "./solution-exports.js";

const DIGEST = sha256DigestSchema.parse(`sha256:${"a".repeat(64)}`);

function submission(): SolutionExportWorkflowEnqueueV1 {
  const targetSettings = createInMemoryApprovedTargetSettings();
  const value: SolutionExportWorkflowEnqueueV1 = {
    createdByPrincipalId: "principal_owner",
    entitlementDecisionReference: "entitlement.export.main.v1",
    jobId: "solutionexport_main",
    organizationId: "org_main",
    primaryInputDigest: DIGEST,
    projectId: "project_main",
    request: solutionExportWorkflowRequestV1Schema.parse({
      contractVersion: 1,
      environment: { environmentType: "development" },
      diagram: {
        layout: {
          algorithm: {
            id: "cloudmarkup.diagram-layout",
            version: "1.0.0",
          },
          strategy: "deterministic",
        },
        output: {
          format: "svg-and-png",
          maxHeight: 4_096,
          maxWidth: 4_096,
          scale: 2,
        },
        profile: {
          architectureTitle: "Notes API",
          includeStableDeploymentIdentifiers: false,
          kind: "presentation",
          projectTitle: "CloudMarkup Notes",
        },
        theme: { background: "opaque-light" },
      },
      exportName: "Notes API",
      kind: "cloudmarkup.solution-export-workflow-request",
      sources: {
        architectureDocument: {
          contractVersion: 1,
          digest: DIGEST,
          mediaType: "application/json",
          objectId: "object.architecture.main",
          purpose: "input-payload",
          sizeBytes: 1,
        },
        solutionRevision: {
          contractVersion: 1,
          digest: DIGEST,
          mediaType: "application/json",
          objectId: "object.solution.content.main",
          purpose: "input-payload",
          sizeBytes: 1,
        },
        workloadBehavior: {
          contractVersion: 1,
          digest: DIGEST,
          mediaType: "application/json",
          objectId: "object.workload.main",
          purpose: "input-payload",
          sizeBytes: 1,
        },
      },
      subject: {
        kind: "solution-revision",
        manifestDigest: DIGEST,
        manifestRecordId: "record.solution.main",
        solutionRevisionId: "solution_main",
      },
      targetProfileId: "cloudmarkup.export.terraform-nodejs24-v1",
      targetSettings,
    }),
    requestDigest: DIGEST,
  };
  return {
    ...value,
    primaryInputDigest: solutionExportPrimaryInputDigest({
      organizationId: value.organizationId,
      projectId: value.projectId,
      request: value.request,
    }),
    requestDigest: solutionExportWorkflowRequestDigest(value.request),
  };
}

describe("solution export durable insertion binding", () => {
  it("keeps the orchestration envelope and referenced workflow request distinct", () => {
    const candidate = submission();
    const binding = createSolutionExportRunInsertionBindingV1(candidate);
    expect(binding.orchestrationInputObjectId).not.toBe(
      binding.workflowRequestObjectId,
    );
    expect(binding.orchestrationInput.request.objectId).toBe(
      binding.workflowRequestObjectId,
    );
    expect(binding.targetSettingsSha256).toBe(
      candidate.request.targetSettings.digest,
    );
    expect(binding.sqlDigests).toEqual({
      orchestrationInputSha256: binding.orchestrationInputSha256.slice(7),
      primaryInputSha256: binding.primaryInputSha256.slice(7),
      requestSha256: binding.requestSha256.slice(7),
      targetSettingsSha256: binding.targetSettingsSha256.slice(7),
    });
    expect(sqlHexToSha256Digest(binding.sqlDigests.requestSha256)).toBe(
      binding.requestSha256,
    );
    expect(sha256DigestToSqlHex(binding.requestSha256)).not.toContain(
      "sha256:",
    );
  });
  it("commits every immutable source reference while excluding only the previous-package baseline", () => {
    const candidate = submission();
    const baselineDigest = candidate.primaryInputDigest;
    const changedRequest = solutionExportWorkflowRequestV1Schema.parse({
      ...candidate.request,
      sources: {
        ...candidate.request.sources,
        architectureDocument: {
          ...candidate.request.sources.architectureDocument,
          objectId: "object.architecture.changed",
        },
      },
    });
    expect(
      solutionExportPrimaryInputDigest({
        organizationId: candidate.organizationId,
        projectId: candidate.projectId,
        request: changedRequest,
      }),
    ).not.toBe(baselineDigest);
    const withPrevious = solutionExportWorkflowRequestV1Schema.parse({
      ...candidate.request,
      previousPackage: {
        artifactId: "solutionartifact_previous",
        availability: { state: "available" },
        object: {
          contractVersion: 1,
          digest: DIGEST,
          mediaType: "application/zip",
          objectId: "object.solutionartifact.previous",
          purpose: "export-package",
          sizeBytes: 1,
        },
      },
    });
    expect(
      solutionExportPrimaryInputDigest({
        organizationId: candidate.organizationId,
        projectId: candidate.projectId,
        request: withPrevious,
      }),
    ).toBe(baselineDigest);
  });

  it("rejects a workflow request reference not bound by the envelope", () => {
    const candidate = submission();
    const binding = createSolutionExportRunInsertionBindingV1(candidate);
    expect(() =>
      validateSolutionExportRunInsertionBindingV1({
        organizationId: candidate.organizationId,
        orchestrationInput: binding.orchestrationInput,
        orchestrationInputReference: {
          contractVersion: 1,
          digest: binding.orchestrationInputSha256,
          mediaType: "application/json",
          objectId: binding.orchestrationInputObjectId,
          purpose: "input-payload",
          sizeBytes: new TextEncoder().encode(
            serializeCanonicalJson(binding.orchestrationInput),
          ).byteLength,
        },
        primaryInputSha256: candidate.primaryInputDigest,
        projectId: candidate.projectId,
        workflowRequest: binding.workflowRequest,
        workflowRequestReference: {
          ...binding.orchestrationInput.request,
          objectId: "object.solution-export-request.other",
        },
      }),
    ).toThrow(/does not match/iu);
  });

  it("rejects prefixed, uppercase, short, and non-hex SQL digests", () => {
    for (const malformed of [
      DIGEST,
      "A".repeat(64),
      "a".repeat(63),
      "g".repeat(64),
    ]) {
      expect(() => sqlHexToSha256Digest(malformed)).toThrow(
        /64 lowercase hex/iu,
      );
    }
  });
});
