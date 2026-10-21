import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { generateOpenApiDocumentV1 } from "../dist/openapi.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = resolve(
  packageRoot,
  "openapi",
  "cloudmarkup-v1.openapi.json",
);
const serialized = `${JSON.stringify(generateOpenApiDocumentV1())}\n`;
const mode = process.argv[2];

if (mode === "--write") {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, serialized, "utf8");
  process.stdout.write(`Wrote ${outputPath}\n`);
  process.exit(0);
}

if (mode !== "--check") {
  process.stderr.write("Use --write or --check.\n");
  process.exit(2);
}

let existing;
try {
  existing = await readFile(outputPath, "utf8");
} catch {
  process.stderr.write(
    "OpenAPI artifact is missing. Run pnpm --filter @cloudmarkup/api-contract generate:openapi.\n",
  );
  process.exit(1);
}

if (existing !== serialized) {
  process.stderr.write(
    "OpenAPI artifact drift detected. Regenerate and review the contract.\n",
  );
  process.exit(1);
}

process.stdout.write("OpenAPI artifact is current.\n");
