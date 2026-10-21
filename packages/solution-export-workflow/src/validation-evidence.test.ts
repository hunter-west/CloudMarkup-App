import {
  evidenceRecordV1Schema,
  serializeCanonicalJson,
} from "@cloudmarkup/schemas";
import { sha256Digest } from "@cloudmarkup/solution-export";
import { describe, expect, it } from "vitest";

import { terraformValidationEvidenceSupplementalFiles } from "./validation-evidence.js";
import {
  TEST_ENVIRONMENT,
  TEST_COMPILER,
  validationResult,
  workflowFixture,
} from "./workflow.test-support.js";

describe("Terraform validation Evidence export projection", () => {
  it("emits canonical Evidence JSON with exact checksums and provenance", () => {
    const fixture = workflowFixture();
    const evidence = validationResult(fixture).evidenceRecords[0];
    if (evidence === undefined)
      throw new TypeError("Missing Evidence fixture.");

    const files = terraformValidationEvidenceSupplementalFiles([evidence]);

    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({
      checksum: sha256Digest(serializeCanonicalJson(evidence)),
      mediaType: "application/json",
      ownership: "evidence-artifact",
      path: `evidence/terraform-validation/evidence-${evidence.id}.json`,
      provenance: {
        solutionRevisionId: evidence.solutionRevisionId,
        sourceReferences: [{ id: evidence.id, kind: "evidence" }],
      },
    });
  });

  it("fails closed on portable filename collisions and non-tool Evidence", () => {
    const fixture = workflowFixture();
    const evidence = validationResult(fixture).evidenceRecords[0];
    if (evidence === undefined)
      throw new TypeError("Missing Evidence fixture.");
    const upper = evidenceRecordV1Schema.parse({
      ...evidence,
      id: "Evidence.Collision",
    });
    const lower = evidenceRecordV1Schema.parse({
      ...evidence,
      id: "evidence.collision",
    });
    const human = evidenceRecordV1Schema.parse({
      ...evidence,
      id: "evidence.human",
      provenance: {
        ...evidence.provenance,
        actor: { actorId: "actor.reviewer", kind: "user" },
      },
      tools: [TEST_COMPILER],
    });

    expect(() =>
      terraformValidationEvidenceSupplementalFiles([upper, lower]),
    ).toThrow(/collide/u);
    expect(() => terraformValidationEvidenceSupplementalFiles([human])).toThrow(
      /deterministic tool pin/u,
    );
    expect(human.environment).toEqual(TEST_ENVIRONMENT);
  });
});
