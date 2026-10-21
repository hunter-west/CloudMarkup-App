import {
  evidenceRecordV1Schema,
  serializeCanonicalJson,
} from "@cloudmarkup/schemas";
import { sha256Digest } from "@cloudmarkup/solution-export";
import {
  solutionExportWorkflowDiagnosticV1Schema,
  solutionExportWorkflowStageReportV1Schema,
} from "@cloudmarkup/solution-export-workflow";
import {
  evidenceReference,
  validationResult,
  workflowFixture,
} from "@cloudmarkup/solution-export-workflow/testing";
import { describe, expect, it } from "vitest";

import {
  projectSolutionExportWorkflowDiagnostics,
  projectSolutionExportWorkflowEvidence,
} from "./solution-export-projection.js";

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new TypeError("Expected fixture value.");
  return value;
}

describe("solution export public workflow projection", () => {
  it("explains known compiler findings without copying process messages", () => {
    const input = [
      "CLOUDFORMATION_LAMBDA_WORKLOAD_REQUIRED",
      "CLOUDFORMATION_NETWORK_PARENT_EDGE_INVALID",
      "COMPAT_SOLUTION_COMPILER_MISMATCH",
    ].map((code) =>
      solutionExportWorkflowDiagnosticV1Schema.parse({
        code,
        nodeId: "node.synthetic",
        origin: "compiler",
        severity: "error",
        stage: "compile-infrastructure",
      }),
    );
    const result = projectSolutionExportWorkflowDiagnostics(input);
    expect(result[0]?.message).toContain(
      "Add workload settings for this Lambda",
    );
    expect(result[1]?.message).toContain("region or VPC placement");
    expect(result[2]?.message).toContain("Save a new revision");
    expect(
      result.every((diagnostic) => diagnostic.nodeId === "node.synthetic"),
    ).toBe(true);
    expect(
      projectSolutionExportWorkflowDiagnostics([
        { ...required(input[0]), origin: "workflow" },
      ])[0]?.message,
    ).toBe(
      "This export step needs review. Check the affected items and recorded checks before trying again.",
    );
  });

  it("projects safe diagnostic provenance with only a generic public message", () => {
    const diagnostics = projectSolutionExportWorkflowDiagnostics([
      solutionExportWorkflowDiagnosticV1Schema.parse({
        code: "terraform.validation.reviewed-check-failed",
        edgeId: "edge_notes_table",
        nodeId: "node_notes_lambda",
        origin: "terraform-validation",
        ownedPolicyId: "policy_notes_read",
        recoveryReferences: {
          contractVersion: 1,
          locations: [
            {
              kind: "node",
              id: "node_notes_lambda",
              fieldPath: ["timeoutSeconds"],
            },
            { kind: "edge", id: "edge_notes_table" },
          ],
        },
        path: "infrastructure/main.tf",
        severity: "error",
        stage: "validate-infrastructure",
        workloadId: "workload_notes_api",
      }),
    ]);

    expect(diagnostics).toEqual([
      {
        code: "terraform.validation.reviewed-check-failed",
        edgeId: "edge_notes_table",
        message:
          "Infrastructure validation needs review. Check the affected items and recorded checks before exporting again.",
        nodeId: "node_notes_lambda",
        ownedPolicyId: "policy_notes_read",
        recoveryReferences: {
          contractVersion: 1,
          locations: [
            {
              kind: "node",
              id: "node_notes_lambda",
              fieldPath: ["timeoutSeconds"],
            },
            { kind: "edge", id: "edge_notes_table" },
          ],
        },
        path: "infrastructure/main.tf",
        severity: "error",
        stage: "terraform-validation",
        workloadId: "workload_notes_api",
      },
    ]);
    expect(serializeCanonicalJson(diagnostics)).not.toContain("C:\\Users");
    expect(serializeCanonicalJson(diagnostics)).not.toContain("secret");
  });

  it("projects canonical Evidence kind/status independently of stage failure", () => {
    const fixture = workflowFixture();
    const validation = validationResult(fixture, "failed");
    const staticValidation = required(validation.evidenceRecords[0]);
    const compilation = evidenceRecordV1Schema.parse({
      ...staticValidation,
      checks: [
        {
          artifactDigests: required(staticValidation.checks[0]).artifactDigests,
          checkId:
            "cloudmarkup.evidence.deterministic-infrastructure-compilation",
          generationCoverageRequirement:
            "deterministic-infrastructure-compilation",
          issueIds: [],
          status: "passed",
          summary: "The deterministic infrastructure compilation check passed.",
        },
      ],
      id: "evidence_iac_compilation_failed_validation_1",
    });
    const references = [
      evidenceReference(compilation, fixture.request.environment),
      evidenceReference(staticValidation, fixture.request.environment),
    ].sort((left, right) =>
      left.evidenceId < right.evidenceId
        ? -1
        : left.evidenceId > right.evidenceId
          ? 1
          : 0,
    );
    const reportSize = new TextEncoder().encode(
      serializeCanonicalJson(validation),
    ).byteLength;
    const report = solutionExportWorkflowStageReportV1Schema.parse({
      artifact: {
        artifactId: "artifact.terraform-validation-report.1",
        digest: validation.reportDigest,
        kind: "terraform-validation-report",
        mediaType: "application/json",
        object: {
          contractVersion: 1,
          digest: validation.reportDigest,
          mediaType: "application/json",
          objectId: "object.terraform-validation-report.1",
          purpose: "validation-report",
          sizeBytes: reportSize,
        },
        sizeBytes: reportSize,
      },
      evidenceRecords: references,
      stage: "validate-infrastructure",
    });

    expect(
      projectSolutionExportWorkflowEvidence({
        evidenceRecords: references,
        evidenceSemantics: [
          {
            evidenceId: compilation.id,
            kind: "infrastructure-compilation",
            status: "passed",
          },
          {
            evidenceId: staticValidation.id,
            kind: "terraform-validation",
            status: "failed",
          },
        ],
        stageReports: [report],
      }).map(({ evidenceId, kind, stage, status }) => ({
        evidenceId,
        kind,
        stage,
        status,
      })),
    ).toEqual([
      {
        evidenceId: "evidence_iac_compilation_failed_validation_1",
        kind: "infrastructure-compilation",
        stage: "compilation",
        status: "passed",
      },
      {
        evidenceId: "evidence_terraform_validation_failed_1",
        kind: "terraform-validation",
        stage: "terraform-validation",
        status: "failed",
      },
    ]);
    expect(sha256Digest(serializeCanonicalJson(compilation))).toBe(
      references[0]?.record.digest,
    );
  });
});
