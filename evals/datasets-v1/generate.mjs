import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { format } from "prettier";

import { frozenModelEvaluationDatasetV1 } from "../../packages/model-gateway/dist/index.js";

const outputUrl = new URL("./model-evaluation-v1.json", import.meta.url);
const rendered = await format(JSON.stringify(frozenModelEvaluationDatasetV1), {
  filepath: fileURLToPath(outputUrl),
});

if (process.argv[2] === "--write") {
  await mkdir(fileURLToPath(new URL(".", outputUrl)), { recursive: true });
  await writeFile(outputUrl, rendered, "utf8");
} else if (process.argv[2] === "--check") {
  const current = await readFile(outputUrl, "utf8");
  if (current !== rendered) {
    throw new Error(
      "Frozen Prompt 38 evaluation dataset is stale relative to the canonical harness fixture.",
    );
  }
} else {
  throw new Error("Expected --write or --check.");
}
