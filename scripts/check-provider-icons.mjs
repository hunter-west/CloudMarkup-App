import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { awsCatalogV1 } from "@cloudmarkup/provider-aws/catalog";

import {
  checkProviderIconAssets,
  parseCanonicalProviderIconManifest,
} from "./provider-icons/check-core.mjs";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const assetRoot = path.join(
  repositoryRoot,
  "packages",
  "provider-aws",
  "assets",
);

async function main() {
  const artifact = awsCatalogV1.artifact;
  const manifestBytes = await readFile(
    path.join(assetRoot, "provider-icons.manifest.json"),
  );
  const manifest = parseCanonicalProviderIconManifest(manifestBytes);
  const result = await checkProviderIconAssets({
    assetRoot,
    catalog: {
      catalogDigest: String(artifact.digest),
      catalogId: String(artifact.catalog.id),
      catalogVersion: String(artifact.catalog.version),
      providerId: String(artifact.provider.id),
      services: awsCatalogV1
        .listServices()
        .filter((service) => service.iconId !== null)
        .map((service) => ({
          iconId: String(service.iconId),
          serviceName: String(service.displayName),
        })),
    },
    manifest,
    repositoryRoot,
  });

  if (result.issues.length > 0) {
    for (const issue of result.issues) {
      process.stderr.write(`- ${issue}\n`);
    }
    process.exitCode = 1;
    return;
  }

  process.stdout.write(
    `Provider icon assets pass: ${JSON.stringify(result.stats)}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Provider icon checks failed."}\n`,
  );
  process.exitCode = 1;
});
