import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { sha256Text } from "@cloudmarkup/schemas";
import { fullBetaRepositorySourcesV1 } from "./full-beta-repository-sources.js";
import { frozenFullBetaEvaluationDatasetV1 } from "./full-beta-evaluation-dataset.js";

function objectId(kind: string, bytes: Buffer | string): Buffer {
  // Git computes its actual object identity, independently of the source authoring script.
  return Buffer.from(
    execFileSync("git", ["hash-object", "-t", kind, "--stdin"], {
      input: bytes,
      encoding: "utf8",
      windowsHide: true,
    }).trim(),
    "hex",
  );
}
describe("frozen repository inputs", () => {
  it.each(fullBetaRepositorySourcesV1)(
    "binds real bytes and Git objects for $caseKind",
    (source) => {
      const bytes = readFileSync(
        new URL(
          `../../../evals/datasets-full-beta-v1/repositories/${source.caseKind}/${source.path}`,
          import.meta.url,
        ),
      );
      expect(bytes.toString("utf8")).toBe(source.content);
      expect(sha256Text(source.content)).toBe(source.contentDigest);
      const [directory, filename] = source.path.split("/");
      if (!directory || !filename) throw Error("Missing frozen path");
      const tree = objectId(
        "tree",
        Buffer.concat([
          Buffer.from(`100644 ${filename}\0`),
          objectId("blob", bytes),
        ]),
      );
      const root = objectId(
        "tree",
        Buffer.concat([Buffer.from(`40000 ${directory}\0`), tree]),
      );
      const commit = objectId(
        "commit",
        `tree ${root.toString("hex")}\nauthor Cloud Markup Evaluation <evaluation@cloudmarkup.invalid> 1789084800 +0000\ncommitter Cloud Markup Evaluation <evaluation@cloudmarkup.invalid> 1789084800 +0000\n\nFrozen synthetic ${source.caseKind} input\n`,
      );
      expect(commit.toString("hex")).toBe(source.commitSha);
      expect(
        frozenFullBetaEvaluationDatasetV1.cases.find(
          (c) => c.caseKind === source.caseKind,
        )?.input.repositoryFixtures,
      ).toEqual([
        {
          contentDigest: source.contentDigest,
          evidenceId: source.evidenceId,
          path: source.path,
          sourceMode: source.sourceMode,
        },
      ]);
      expect(Object.isFrozen(source)).toBe(true);
    },
  );
});
