import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
  generateApplicationHostRepairSuccessorV2JsonSchema,
  generateApplicationHostRepairSeedV1JsonSchema,
  generateApplicationHostRepairCandidateV1JsonSchema,
} from "../dist/host-repair-seed.js";

const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== "--check")) {
  throw new Error("Only the explicit schema check option is supported.");
}
const root = new URL("../json-schema/", import.meta.url);
for (const [name, generate] of [
  [
    "application-host-repair-successor-v2.schema.json",
    generateApplicationHostRepairSuccessorV2JsonSchema,
  ],
  [
    "application-host-repair-seed-v1.schema.json",
    generateApplicationHostRepairSeedV1JsonSchema,
  ],
  [
    "application-host-repair-candidate-v1.schema.json",
    generateApplicationHostRepairCandidateV1JsonSchema,
  ],
]) {
  const target = new URL(name, root);
  const bytes = JSON.stringify(generate()) + "\n";
  if (args[0] === "--check") {
    if ((await readFile(target, "utf8")) !== bytes)
      throw new Error("Host repair schema artifact drift: " + name);
  } else {
    await mkdir(root, { recursive: true });
    await writeFile(target, bytes, "utf8");
  }
}
