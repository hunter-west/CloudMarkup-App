import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { format } from "prettier";
import {
  assertFullBetaEvaluationCatalogV1,
  frozenTypedPlanningFullBetaEvaluationDatasetV1,
  typedPlanningFullBetaEvaluationSourceDigestV1,
  frozenAuthenticatedFullBetaEvaluationDatasetV1,
  authenticatedFullBetaEvaluationSourceDigestV1,
  frozenFullBetaEvaluationDatasetV1,
  fullBetaEvaluationCatalogV1,
  fullBetaEvaluationSourceDigestV1,
  fullBetaRepositorySourcesV1,
} from "../../packages/model-gateway/dist/index.js";
const mode = process.argv[2];
if (process.argv.length !== 3 || !["--write", "--check"].includes(mode))
  throw Error("Expected --write or --check.");
assertFullBetaEvaluationCatalogV1(
  JSON.parse(
    await readFile(
      new URL(
        "../../packages/provider-aws/src/compiled/catalog-v1.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ),
);
for (const source of fullBetaRepositorySourcesV1) {
  const path = new URL(
    `./repositories/${source.caseKind}/${source.path}`,
    import.meta.url,
  );
  if ((await readFile(path, "utf8")) !== source.content)
    throw Error("A reviewed repository input differs from its frozen bytes.");
}

for (const source of [
  {
    path: "./typed-planning-full-beta-evaluation-source-v1.json",
    dataset: frozenTypedPlanningFullBetaEvaluationDatasetV1,
    sourceDigest: typedPlanningFullBetaEvaluationSourceDigestV1,
  },
  {
    path: "./full-beta-evaluation-source-v1.json",
    dataset: frozenFullBetaEvaluationDatasetV1,
    sourceDigest: fullBetaEvaluationSourceDigestV1,
  },
  {
    path: "./authenticated-full-beta-evaluation-source-v1.json",
    dataset: frozenAuthenticatedFullBetaEvaluationDatasetV1,
    sourceDigest: authenticatedFullBetaEvaluationSourceDigestV1,
  },
]) {
  const output = new URL(source.path, import.meta.url);
  const rendered = await format(
    JSON.stringify({
      sourceDigest: source.sourceDigest,
      catalog: fullBetaEvaluationCatalogV1,
      dataset: source.dataset,
    }),
    { filepath: fileURLToPath(output) },
  );
  if (mode === "--write") await writeFile(output, rendered, "utf8");
  else if ((await readFile(output, "utf8")) !== rendered)
    throw Error("The frozen full beta source mirror is stale: " + source.path);
}
