import { serializeCanonicalJson } from "@cloudmarkup/schemas";
import { encodeUtf8, sha256Digest } from "@cloudmarkup/solution-export";
import { describe, expect, it } from "vitest";

import { projectGoCompilationResultToSolutionExportInfrastructure } from "./compiler-projection.js";
import { solutionExportWorkflowEvidenceSemantics } from "./evidence-semantics.js";
import { validateCloudFormationInfrastructure } from "./infrastructure-validation.js";
import { workflowFixture } from "./workflow.test-support.js";

describe("CloudFormation infrastructure validation", () => {
  it("validates structured compiler JSON reproducibly with target-specific Evidence", () => {
    const fixture = workflowFixture("infrastructure-only", "cloudformation");
    const infrastructure =
      projectGoCompilationResultToSolutionExportInfrastructure(
        fixture.compilation,
      );
    if (fixture.request.targetSettings.target !== "cloudformation") {
      throw new TypeError("Expected CloudFormation target settings.");
    }
    const input = {
      infrastructure,
      now: "2026-08-18T12:00:00.000Z",
      request: fixture.request,
      settings:
        fixture.request.targetSettings.stageDescriptors
          .cloudFormationValidation,
    };

    const first = validateCloudFormationInfrastructure(input);
    const second = validateCloudFormationInfrastructure(input);

    expect(serializeCanonicalJson(second)).toBe(serializeCanonicalJson(first));
    expect(first.validation).toMatchObject({
      artifactDigest: infrastructure.artifactDigest,
      localValidation: "cloudmarkup-structured-template-v1",
      resourceCount: 0,
      templateSpecificationVersion: "2010-09-09",
    });
    const evidence = first.evidenceRecords[0];
    if (evidence === undefined) {
      throw new TypeError("CloudFormation validation Evidence is missing.");
    }
    expect(solutionExportWorkflowEvidenceSemantics(evidence)).toEqual({
      evidenceId: evidence.id,
      kind: "cloudformation-validation",
      status: "passed",
    });
  });

  it("fails closed when the compiler template is not a structured Resources map", () => {
    const fixture = workflowFixture("infrastructure-only", "cloudformation");
    const infrastructure =
      projectGoCompilationResultToSolutionExportInfrastructure(
        fixture.compilation,
      );
    if (
      infrastructure.target !== "cloudformation" ||
      fixture.request.targetSettings.target !== "cloudformation"
    ) {
      throw new TypeError("Expected CloudFormation validation fixtures.");
    }
    const template = infrastructure.files.find((file) =>
      file.path.endsWith("template.json"),
    );
    if (template === undefined)
      throw new TypeError("Template fixture missing.");
    const content = serializeCanonicalJson({
      AWSTemplateFormatVersion: "2010-09-09",
      Resources: [],
    });
    const stageDescriptors = fixture.request.targetSettings.stageDescriptors;
    if (!("cloudFormationValidation" in stageDescriptors)) {
      throw new TypeError("Expected CloudFormation validation settings.");
    }
    const malformed: typeof infrastructure = {
      ...infrastructure,
      files: infrastructure.files.map((file) =>
        file.path === template.path
          ? {
              ...file,
              checksum: sha256Digest(encodeUtf8(content)),
              content,
            }
          : file,
      ),
    };

    expect(() =>
      validateCloudFormationInfrastructure({
        infrastructure: malformed,
        now: "2026-08-18T12:00:00.000Z",
        request: fixture.request,
        settings: stageDescriptors.cloudFormationValidation,
      }),
    ).toThrow(/Resources object/u);
  });
});
