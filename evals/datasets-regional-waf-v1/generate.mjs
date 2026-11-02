import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { format } from "prettier";
import {
  assertRegionalWafEvaluationCatalogV1,
  frozenRegionalWafEvaluationDatasetV1,
  regionalWafEvaluationCatalogV1,
  regionalWafEvaluationSourceDigestV1,
} from "../../packages/model-gateway/dist/index.js";

const mode = process.argv[2];
if (process.argv.length !== 3 || !["--write", "--check"].includes(mode))
  throw Error("Expected --write or --check.");

assertRegionalWafEvaluationCatalogV1(
  JSON.parse(
    await readFile(
      new URL(
        "../../packages/provider-aws/src/model-evaluation-source/catalog-73-v1.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ),
);
const output = new URL(
  "./regional-waf-evaluation-source-v1.json",
  import.meta.url,
);
const rendered = await format(
  JSON.stringify({
    sourceDigest: regionalWafEvaluationSourceDigestV1,
    catalog: regionalWafEvaluationCatalogV1,
    dataset: frozenRegionalWafEvaluationDatasetV1,
  }),
  { filepath: fileURLToPath(output) },
);
if (mode === "--write") await writeFile(output, rendered, "utf8");
else if ((await readFile(output, "utf8")) !== rendered)
  throw Error("The regional WAF evaluation input mirror is stale.");
