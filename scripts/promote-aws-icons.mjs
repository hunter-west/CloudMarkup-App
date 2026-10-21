import path from "node:path";
import { fileURLToPath } from "node:url";

import { awsCatalogV1 } from "@cloudmarkup/provider-aws/catalog";

import { resolveSafeExternalReviewDirectory } from "./provider-icons/import-core.mjs";
import { promoteReviewedProviderIcons } from "./provider-icons/promotion-core.mjs";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function usage() {
  return [
    "Usage: pnpm icons:promote:aws --staging <external-candidate-directory> [--write]",
    "",
    "Dry-run is the default. SOURCE_REVIEW.md is the checked owner-approval evidence.",
  ].join("\n");
}

function parseArguments(arguments_) {
  const values = new Map();
  let write = false;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--write") {
      if (write) {
        throw new TypeError("Duplicate argument --write.");
      }
      write = true;
      continue;
    }
    if (!argument?.startsWith("--")) {
      throw new TypeError("Arguments must use named flags.");
    }
    const value = arguments_[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new TypeError(`Missing value for ${argument}.`);
    }
    if (values.has(argument)) {
      throw new TypeError(`Duplicate argument ${argument}.`);
    }
    values.set(argument, value);
    index += 1;
  }
  if (!values.has("--staging")) {
    throw new TypeError("Missing required argument --staging.");
  }
  for (const flag of values.keys()) {
    if (flag !== "--staging") {
      throw new TypeError(`Unknown argument ${flag}.`);
    }
  }
  return { values, write };
}

async function main() {
  const { values, write } = parseArguments(process.argv.slice(2));
  const artifact = awsCatalogV1.artifact;
  const result = await promoteReviewedProviderIcons({
    assetRoot: path.join(repositoryRoot, "packages", "provider-aws", "assets"),
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
    registrationFile: path.join(
      repositoryRoot,
      "apps",
      "web",
      "src",
      "provider-icons",
      "aws-assets.generated.ts",
    ),
    repositoryRoot,
    stagingDirectory: await resolveSafeExternalReviewDirectory(
      repositoryRoot,
      values.get("--staging"),
    ),
    write,
  });
  process.stdout.write(
    `${JSON.stringify({ ...result, mode: write ? "write" : "dry-run" }, null, 2)}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Provider icon promotion failed."}\n${usage()}\n`,
  );
  process.exitCode = 1;
});
