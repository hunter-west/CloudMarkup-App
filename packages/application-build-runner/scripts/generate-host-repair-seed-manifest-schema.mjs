import { mkdir, readFile, writeFile } from "node:fs/promises";
import { generateApplicationHostRepairSeedManifestV1JsonSchema } from "../dist/host-repair-seed.js";

const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== "--check")) {
  throw new Error("Only the explicit schema check option is supported.");
}
const root = new URL("../json-schema/", import.meta.url);
const target = new URL(
  "application-host-repair-seed-manifest-v1.schema.json",
  root,
);
const bytes = `${JSON.stringify(generateApplicationHostRepairSeedManifestV1JsonSchema())}\n`;
if (args[0] === "--check") {
  if ((await readFile(target, "utf8")) !== bytes)
    throw new Error("Host repair seed manifest schema artifact drift.");
} else {
  await mkdir(root, { recursive: true });
  await writeFile(target, bytes, "utf8");
}
