import { evidenceRecordV1Schema } from "@cloudmarkup/schemas";
import { describe, expect, it } from "vitest";

import {
  solutionExportWorkflowEvidenceSemantics,
  sortSolutionExportWorkflowEvidenceSemantics,
} from "./evidence-semantics.js";
import { validationResult, workflowFixture } from "./workflow.test-support.js";

function compilationEvidence() {
  const fixture = workflowFixture();
  const validation = validationResult(fixture, "failed");
  const basis = validation.evidenceRecords[0];
  if (basis === undefined)
    throw new TypeError("Validation Evidence is required.");
  return evidenceRecordV1Schema.parse({
    ...basis,
    checks: [
      {
        artifactDigests: basis.checks[0]?.artifactDigests ?? [],
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
}

function applicationBuildEvidence() {
  const basis = compilationEvidence();
  const artifactDigest =
    "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  return evidenceRecordV1Schema.parse({
    ...basis,
    artifacts: [
      {
        digest: artifactDigest,
        mediaType: "application/zip",
        sizeBytes: 4,
      },
    ],
    checks: [
      {
        artifactDigests: [artifactDigest],
        checkId: "cloudmarkup.evidence.application-build-and-tests",
        generationCoverageRequirement: "application-build-and-tests",
        issueIds: [],
        status: "passed",
        summary: "The deterministic build and generated tests passed.",
      },
      {
        artifactDigests: [artifactDigest],
        checkId: "cloudmarkup.evidence.application-security-checks",
        generationCoverageRequirement: "application-security-checks",
        issueIds: [],
        status: "passed",
        summary: "The dependency and secret scans passed.",
      },
    ],
    id: "evidence_application_build_complete_1",
    layer: "generated",
    level: { kind: "application-build-and-tests", rank: 5 },
  });
}

describe("solution export workflow Evidence semantics", () => {
  it("keeps compilation passed while Terraform static validation failed", () => {
    const fixture = workflowFixture();
    const staticValidation = validationResult(fixture, "failed")
      .evidenceRecords[0];
    if (staticValidation === undefined) {
      throw new TypeError("Static validation Evidence is required.");
    }

    expect(
      sortSolutionExportWorkflowEvidenceSemantics([
        solutionExportWorkflowEvidenceSemantics(staticValidation),
        solutionExportWorkflowEvidenceSemantics(compilationEvidence()),
      ]),
    ).toEqual([
      {
        evidenceId: "evidence_iac_compilation_failed_validation_1",
        kind: "infrastructure-compilation",
        status: "passed",
      },
      {
        evidenceId: "evidence_terraform_validation_failed_1",
        kind: "terraform-validation",
        status: "failed",
      },
    ]);
  });

  it("rejects Evidence whose checks do not match an approved workflow family", () => {
    const unsupported = evidenceRecordV1Schema.parse({
      ...compilationEvidence(),
      checks: [
        {
          artifactDigests: [],
          checkId: "cloudmarkup.evidence.unrelated-check",
          issueIds: [],
          status: "passed",
          summary: "An unrelated check passed.",
        },
      ],
      id: "evidence_unrelated_1",
    });

    expect(() => solutionExportWorkflowEvidenceSemantics(unsupported)).toThrow(
      /approved workflow check family/u,
    );
  });

  it("accepts only the exact complete passing application-build check family", () => {
    const exact = applicationBuildEvidence();
    expect(solutionExportWorkflowEvidenceSemantics(exact)).toEqual({
      evidenceId: exact.id,
      kind: "application-build",
      status: "passed",
    });

    const buildCheck = exact.checks[0];
    const securityCheck = exact.checks[1];
    if (buildCheck === undefined || securityCheck === undefined) {
      throw new TypeError("Application build Evidence checks are required.");
    }
    const incomplete = evidenceRecordV1Schema.parse({
      ...exact,
      checks: [buildCheck],
      id: "evidence_application_build_incomplete_1",
    });
    expect(solutionExportWorkflowEvidenceSemantics(incomplete)).toEqual({
      evidenceId: incomplete.id,
      kind: "application-build",
      status: "incomplete",
    });

    const invalidCheckFamilies = [
      {
        checks: [
          buildCheck,
          securityCheck,
          {
            ...buildCheck,
            checkId: "cloudmarkup.evidence.unrelated-check",
          },
        ],
        label: "extra check",
      },
      {
        checks: [
          buildCheck,
          {
            ...securityCheck,
            generationCoverageRequirement: "application-build-and-tests",
          },
        ],
        label: "mismatched coverage requirement",
      },
      {
        checks: [
          buildCheck,
          {
            ...securityCheck,
            artifactDigests: [],
          },
        ],
        label: "incomplete artifact commitment",
      },
      {
        checks: [
          buildCheck,
          {
            ...securityCheck,
            issueIds: ["application.build.security-findings"],
          },
        ],
        label: "passing check with issues",
      },
    ];
    for (const invalid of invalidCheckFamilies) {
      const candidate = evidenceRecordV1Schema.parse({
        ...exact,
        checks: invalid.checks,
      });
      expect(
        () => solutionExportWorkflowEvidenceSemantics(candidate),
        invalid.label,
      ).toThrow(/approved workflow check family/u);
    }
    expect(
      evidenceRecordV1Schema.safeParse({
        ...exact,
        checks: [buildCheck, securityCheck, { ...securityCheck }],
      }).success,
    ).toBe(false);
  });

  it("retains failed semantics for an exact application-build check family", () => {
    const exact = applicationBuildEvidence();
    const buildCheck = exact.checks[0];
    const securityCheck = exact.checks[1];
    if (buildCheck === undefined || securityCheck === undefined) {
      throw new TypeError("Application build Evidence checks are required.");
    }
    const failed = evidenceRecordV1Schema.parse({
      ...exact,
      checks: [
        buildCheck,
        {
          ...securityCheck,
          issueIds: ["application.build.security-findings"],
          redactedFailure: "The bounded security check did not pass.",
          status: "failed",
        },
      ],
      id: "evidence_application_build_failed_1",
    });
    expect(solutionExportWorkflowEvidenceSemantics(failed)).toEqual({
      evidenceId: failed.id,
      kind: "application-build",
      status: "failed",
    });
    const partialFailure = evidenceRecordV1Schema.parse({
      ...failed,
      checks: [
        {
          ...buildCheck,
          issueIds: ["application.build.tests-failed"],
          redactedFailure: "The bounded build/test check did not pass.",
          status: "failed",
        },
      ],
      id: "evidence_application_build_partial_failure_1",
    });
    expect(solutionExportWorkflowEvidenceSemantics(partialFailure)).toEqual({
      evidenceId: partialFailure.id,
      kind: "application-build",
      status: "failed",
    });
  });
});
