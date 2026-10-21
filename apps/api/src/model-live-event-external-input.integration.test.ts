import { describe, expect, it } from "vitest";
import {
  digestStructuredValue,
  frozenFullBetaEvaluationDatasetV1,
  fullBetaRepositorySourcesV1,
  validateModelRequestAuthority,
} from "@cloudmarkup/model-gateway";
import { createProductionModelLiveCaseRequest } from "./production-model-live-case-request.js";
import { prepareModelLiveRepositoryInput } from "./model-live-repository-input.js";
const kinds = [
  "event-driven-image-processing",
  "external-existing-resource",
] as const;
describe("executable event and external-resource request inputs", () => {
  it.each(kinds)(
    "binds %s to exact requirements and actual command catalog in both preferences",
    (caseKind) => {
      const c = frozenFullBetaEvaluationDatasetV1.cases.find(
        (c) => c.caseKind === caseKind,
      );
      if (!c) throw Error("Missing case");
      const request = createProductionModelLiveCaseRequest({
        caseId: c.caseId,
        requestedMode: "guided",
      });
      if (request.operation !== "operations.propose")
        throw Error("Wrong operation");
      validateModelRequestAuthority(request);
      expect(request.planningContext?.approvedIntent.application.summary).toBe(
        c.input.requirements,
      );
      expect(request.catalogGrounding.nodes).toHaveLength(71);
      expect(request.planningContext?.validationRules).toHaveLength(33);
      expect(request.architecture.nodes).toHaveLength(1);
      expect(request.architecture.externalResources.resources).toEqual([]);
      expect(request.architecture.workloadBehavior.workloads).toEqual([]);
      const other = createProductionModelLiveCaseRequest({
        caseId: c.caseId,
        requestedMode: "professional",
      });
      expect({ ...other, requestedMode: "guided" }).toEqual(request);
      if (caseKind === "external-existing-resource") {
        const source = fullBetaRepositorySourcesV1.find(
          (s) => s.caseKind === caseKind,
        );
        expect(
          request.planningContext?.approvedRepositoryEvidence?.commitSha,
        ).toBe(source?.commitSha);
        expect(
          request.planningContext?.approvedRepositoryEvidence?.evidence[0]
            ?.content,
        ).toBe(source?.content);
        expect(
          request.planningContext?.allowedAssistantOperationKinds,
        ).toContain("add-external-resource");
      } else
        expect(
          request.planningContext?.approvedRepositoryEvidence,
        ).toBeUndefined();
      expect(digestStructuredValue(request)).toMatch(/^sha256:[a-f0-9]{64}$/u);
    },
  );
});
const executablePath = process.env["CLOUDMARKUP_TEST_COMPILER_EXECUTABLE"],
  executableSha256 = process.env["CLOUDMARKUP_TEST_COMPILER_SHA256"];
it.skipIf(!executablePath || !executableSha256)(
  "binds the external request to the actual pinned import and preserves observed ownership",
  async () => {
    if (!executablePath || !executableSha256)
      throw Error("Real compiler required");
    const imported = await prepareModelLiveRepositoryInput({
      caseKind: "external-existing-resource",
      compiler: { executablePath, executableSha256 },
    });
    const request = createProductionModelLiveCaseRequest({
      caseId: imported.evaluationCase.caseId,
      requestedMode: "guided",
    });
    if (request.operation !== "operations.propose")
      throw Error("Wrong operation");
    expect(
      request.planningContext?.approvedRepositoryEvidence
        ?.repositorySnapshotDigest,
    ).toBe(imported.result.snapshot.snapshotDigest);
    expect(imported.result.facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "resource",
          external: true,
          ownership: "external",
        }),
      ]),
    );
    expect(
      imported.design.revision.architectureDocument.externalResources.resources,
    ).toEqual([]);
  },
);
