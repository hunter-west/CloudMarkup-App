import { describe, expect, it } from "vitest";
import {
  digestStructuredValue,
  validateModelRequestAuthority,
  validateModelResponseAuthority,
} from "@cloudmarkup/model-gateway";
import { projectRepositoryInterpretationReviewV1 } from "@cloudmarkup/schemas";
import { prepareModelLiveRepositoryInput } from "./model-live-repository-input.js";
import { syntheticRepositoryCase } from "./model-live-repository-test-helpers.js";
import { createProductionModelLiveRepositoryRequest } from "./production-model-live-repository-request.js";
const executablePath = process.env["CLOUDMARKUP_TEST_COMPILER_EXECUTABLE"],
  executableSha256 = process.env["CLOUDMARKUP_TEST_COMPILER_SHA256"];
const integration =
  executablePath && executableSha256 ? describe : describe.skip;
integration("real repository source and shared interpretation review", () => {
  it.each([
    "deterministic-repository-import",
    "ambiguous-source-code-inference",
    "designed-observed-mismatch",
  ] as const)("binds and preserves the actual %s import", async (caseKind) => {
    if (!executablePath || !executableSha256)
      throw Error("Actual pinned parser required");
    const source = await prepareModelLiveRepositoryInput({
      caseKind,
      compiler: { executablePath, executableSha256 },
    });
    const sample = syntheticRepositoryCase(caseKind);
    expect(sample.request.repositorySnapshotDigest).toBe(
      source.result.snapshot.snapshotDigest,
    );
    expect(sample.request.commitSha).toBe(
      source.result.snapshot.revision.commitSha,
    );
    validateModelRequestAuthority(sample.request);
    expect(() => {
      validateModelResponseAuthority({
        ...sample,
        allowedApprovalPathIds: new Set(),
      });
    }).not.toThrow();
    const input = {
      request: sample.request,
      response: sample.response,
      snapshot: source.result.snapshot,
      observedSolution: source.result.observedSolution,
    };
    const before = digestStructuredValue(input);
    const guided = projectRepositoryInterpretationReviewV1({
      ...input,
      requestedMode: "guided",
    });
    const professional = projectRepositoryInterpretationReviewV1({
      ...input,
      requestedMode: "professional",
    });
    expect(guided.semantic).toEqual(professional.semantic);
    expect(guided.semantic.observations).toEqual(
      source.result.observedSolution,
    );
    expect(guided.semantic.parseFindings).toEqual(
      source.result.snapshot.parseFindings,
    );
    expect(guided.semantic.writeAuthority).toBe("none");
    expect(
      guided.semantic.claims.every((c) =>
        c.citations.every((e) => e.source !== null),
      ),
    ).toBe(true);
    expect(guided.semantic.claims.map((c) => c.status)).toEqual(
      sample.response.claims.map(() => "unverified-model-claim"),
    );
    expect(digestStructuredValue(input)).toBe(before);
    for (const part of ["snapshot", "observedSolution"] as const) {
      const changed = structuredClone(input);
      if (part === "snapshot")
        changed.snapshot.snapshotDigest = sample.outputDigest;
      else
        changed.observedSolution.provenance.commitSha = "0".repeat(
          40,
        ) as typeof changed.observedSolution.provenance.commitSha;
      expect(() =>
        projectRepositoryInterpretationReviewV1({
          ...changed,
          requestedMode: "guided",
        }),
      ).toThrow("exact imported source");
    }
    const substituted = structuredClone(input);
    const claim = substituted.response.claims[0];
    if (!claim) throw Error("Missing synthetic claim");
    delete claim.evidenceReferences[0]?.location;
    const review = projectRepositoryInterpretationReviewV1({
      ...substituted,
      requestedMode: "guided",
    });
    expect(review.semantic.claims[0]?.citations[0]?.source).toBeNull();
    expect(() => {
      validateModelResponseAuthority({
        request: sample.request,
        descriptor: sample.descriptor,
        response: substituted.response,
        allowedApprovalPathIds: new Set(),
      });
    }).toThrow();
  });
});
it.each([
  "evaluation_unknown",
  "evaluation_case_external_existing_resource_full_beta_v1",
])("rejects unsupported repository interpretation %s", (caseId) => {
  expect(() =>
    createProductionModelLiveRepositoryRequest({
      caseId,
      requestedMode: "guided",
    }),
  ).toThrow("unavailable");
});
