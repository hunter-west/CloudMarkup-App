import { describe, expect, it } from "vitest";
import { getArchitectureDocumentCanonicalHash } from "@cloudmarkup/domain";
import { fullBetaRepositorySourcesV1 } from "@cloudmarkup/model-gateway";
import {
  createModelLiveRepositoryDesign,
  prepareModelLiveRepositoryInput,
} from "./model-live-repository-input.js";
const executablePath = process.env["CLOUDMARKUP_TEST_COMPILER_EXECUTABLE"];
const executableSha256 = process.env["CLOUDMARKUP_TEST_COMPILER_SHA256"];
const integration =
  executablePath && executableSha256 ? describe : describe.skip;
function compiler() {
  if (!executablePath || !executableSha256)
    throw Error("The real pinned parser is required.");
  return { executablePath, executableSha256 };
}
integration("real frozen repository input importer", () => {
  it.each(fullBetaRepositorySourcesV1)(
    "parses $caseKind without changing source or design",
    async (source) => {
      const design = createModelLiveRepositoryDesign(source.caseKind);
      const before = getArchitectureDocumentCanonicalHash(
        design.revision.architectureDocument,
      );
      const prepared = await prepareModelLiveRepositoryInput({
        caseKind: source.caseKind,
        compiler: compiler(),
      });
      expect(prepared.result.snapshot.files).toHaveLength(1);
      expect(prepared.result.snapshot.files[0]).toMatchObject({
        path: source.path,
        checksum: source.contentDigest,
      });
      expect(prepared.result.snapshot.revision.commitSha).toBe(
        source.commitSha,
      );
      expect(
        getArchitectureDocumentCanonicalHash(
          prepared.design.revision.architectureDocument,
        ),
      ).toBe(before);
      expect(prepared.design.manifest.repositoryObservations).toEqual([]);
      expect(prepared.result.snapshot.redaction.status).toBe("not-required");
      if (source.caseKind === "ambiguous-source-code-inference") {
        expect(prepared.result.facts.some((f) => f.kind === "resource")).toBe(
          false,
        );
        expect(prepared.result.snapshot.inferredRelationships).toEqual([]);
      } else {
        expect(prepared.result.facts).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              kind: "resource",
              confidence: "unresolved",
              parser: {
                id: "cloudmarkup.terraform-hcl-inspector",
                version: "1.0.2",
              },
            }),
          ]),
        );
        expect(
          prepared.result.diagnostics.some(
            (d) => d.code === "cloudmarkup.import.hcl-parse-invalid",
          ),
        ).toBe(false);
        if (source.caseKind === "external-existing-resource") {
          expect(prepared.result.facts).toEqual(
            expect.arrayContaining([
              expect.objectContaining({ kind: "resource", external: true }),
            ]),
          );
        }
        if (source.caseKind === "designed-observed-mismatch") {
          expect(
            prepared.result.differences.some((d) => d.kind !== "matches"),
          ).toBe(true);
          expect(
            prepared.design.revision.architectureDocument.nodes[0]?.semantic
              .serviceType,
          ).toBe("aws.dynamodb.table");
          expect(prepared.result.facts).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                kind: "resource",
                resourceType: "aws.s3.bucket",
              }),
            ]),
          );
        }
      }
    },
  );
  it("reproduces actual import digests across independent temporary directories", async () => {
    const input = {
      caseKind: "deterministic-repository-import" as const,
      compiler: compiler(),
    };
    const first = await prepareModelLiveRepositoryInput(input);
    const second = await prepareModelLiveRepositoryInput(input);
    expect(second.result).toEqual(first.result);
  });
  it("rejects a substituted parser before accepting import output", async () => {
    await expect(
      prepareModelLiveRepositoryInput({
        caseKind: "deterministic-repository-import",
        compiler: { ...compiler(), executableSha256: "0".repeat(64) },
      }),
    ).rejects.toThrow("pinned export compiler");
  });
});
