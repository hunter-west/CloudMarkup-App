import { actualRepositoryParserMetadataFixture } from "./model-live-parser-input-test-helpers.js";
import { describe, expect, it } from "vitest";
import { digestStructuredValue } from "@cloudmarkup/model-gateway";
import {
  assessModelLiveRepositoryCaseV2_9,
  modelLiveRepositoryCaseAssessmentV2_9Schema,
} from "./model-live-repository-case-assessment-v2-9.js";
import { syntheticRepositoryCase } from "./model-live-repository-test-helpers.js";
const executablePath = process.env["CLOUDMARKUP_TEST_COMPILER_EXECUTABLE"],
  executableSha256 = process.env["CLOUDMARKUP_TEST_COMPILER_SHA256"];
const integration =
  executablePath && executableSha256 ? describe : describe.skip;
function compiler() {
  if (!executablePath || !executableSha256) throw Error("Real parser required");
  return { executablePath, executableSha256 };
}
integration("actual repository case measurements", () => {
  it.each([
    "deterministic-repository-import",
    "ambiguous-source-code-inference",
    "designed-observed-mismatch",
  ] as const)(
    "measures the real %s parser and both reviews",
    async (caseKind) => {
      const sample = syntheticRepositoryCase(caseKind),
        before = digestStructuredValue(sample);
      const value = await assessModelLiveRepositoryCaseV2_9({
        ...sample,
        compiler: compiler(),
        repositoryInput: await actualRepositoryParserMetadataFixture(
          sample,
          compiler(),
        ),
      });
      expect(value.validatorVersion).toBe("2.9.0");
      expect(value.repositoryParser.importerVersion).toBe("1.0.2");
      expect(value.repositoryParser.snapshotDigest).toBe(
        sample.request.repositorySnapshotDigest,
      );
      expect(value.repositoryParser.compilerExecutableDigest).toBe(
        "sha256:" + compiler().executableSha256,
      );
      expect(value.measurements).toHaveLength(
        caseKind === "deterministic-repository-import" ? 8 : 7,
      );
      const measurement = (dimension: string) =>
        value.measurements.find((m) => m.dimension === dimension)?.numerator;
      expect(measurement("grounded-repository-evidence-rate")).toBe(1);
      expect(measurement("stable-id-user-owned-file-preservation")).toBe(1);
      expect(
        measurement("same-ui-semantics-across-assistance-preferences"),
      ).toBe(1);
      expect(measurement("deterministic-compiler-preference")).toBe(
        caseKind === "deterministic-repository-import" ? 1 : undefined,
      );
      // The current deterministic-import expectation says no issues, but the real
      // parser retains unresolved warnings. Preserve this quality failure.
      expect(measurement("issue-clarity-correct-severity")).toBe(
        caseKind === "deterministic-repository-import" ? 0 : 1,
      );
      expect(digestStructuredValue(sample)).toBe(before);
      expect(JSON.stringify(value)).not.toContain(
        sample.response.claims[0]?.summary,
      );
      // A metadata schema alone cannot authenticate an issued parser row.
      const unissuedMetadata = {
        ...value,
        caseDigest: digestStructuredValue("historical source"),
        sourceInputDigest: digestStructuredValue("historical input"),
      };
      const { assessmentDigest, ...body } = unissuedMetadata;
      void assessmentDigest;
      expect(
        modelLiveRepositoryCaseAssessmentV2_9Schema.safeParse({
          ...body,
          assessmentDigest: digestStructuredValue(body),
        }).success,
      ).toBe(true);
    },
  );
  it.each(["no-citations", "no-question", "false-certainty"] as const)(
    "records negative quality for %s",
    async (kind) => {
      const sample = syntheticRepositoryCase("ambiguous-source-code-inference");
      if (kind === "no-citations") sample.response.claims = [];
      else if (kind === "no-question")
        sample.response.proposalContext.unknowns = [];
      else {
        const claim = sample.response.claims[0];
        if (!claim) throw Error("Missing claim");
        claim.confidence.basisPoints = 10000;
      }
      const value = await assessModelLiveRepositoryCaseV2_9({
        ...sample,
        outputDigest: digestStructuredValue(sample.response),
        compiler: compiler(),
        repositoryInput: await actualRepositoryParserMetadataFixture(
          sample,
          compiler(),
        ),
      });
      expect(
        value.measurements.find(
          (m) =>
            m.dimension ===
            (kind === "no-citations"
              ? "grounded-repository-evidence-rate"
              : "unresolved-behavior-honesty"),
        )?.numerator,
      ).toBe(0);
    },
  );
  it.each(["source", "scope", "output", "case"] as const)(
    "rejects substituted %s authority",
    async (kind) => {
      const sample = syntheticRepositoryCase("ambiguous-source-code-inference");
      const repositoryInput = await actualRepositoryParserMetadataFixture(
        sample,
        compiler(),
      );
      if (kind === "source") {
        const evidence = sample.request.evidence[0];
        if (!evidence) throw Error("Missing input");
        evidence.content += "unrelated";
      } else if (kind === "scope")
        delete sample.descriptor.scope.repositorySnapshotId;
      else if (kind === "output")
        sample.outputDigest = digestStructuredValue("unrelated");
      else
        sample.evaluationCase = {
          ...sample.evaluationCase,
          caseDigest: digestStructuredValue("unrelated"),
        };
      await expect(
        assessModelLiveRepositoryCaseV2_9({
          ...sample,
          compiler: compiler(),
          repositoryInput,
        }),
      ).rejects.toThrow();
    },
  );
});
