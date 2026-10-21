import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { checkProviderIconBundle } from "./bundle-check-core.mjs";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const assetRoot = path.join(
  repositoryRoot,
  "packages",
  "provider-aws",
  "assets",
);

async function main() {
  const manifest = JSON.parse(
    await readFile(
      path.join(assetRoot, "provider-icons.manifest.json"),
      "utf8",
    ),
  );
  const result = await checkProviderIconBundle({
    assetDirectory: path.join(assetRoot, "icons"),
    distDirectory: path.join(repositoryRoot, "apps", "web", "dist"),
    manifest,
  });
  if (result.issues.length > 0) {
    for (const issue of result.issues) {
      process.stderr.write(`- ${issue}\n`);
    }
    process.exitCode = 1;
    return;
  }
  process.stdout.write(
    `Provider icon web bundle passes: ${JSON.stringify(result.stats)}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Provider icon bundle check failed."}\n`,
  );
  process.exitCode = 1;
});
