import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  compileProviderCatalogV1,
  compileProviderConnectionPresentationV1,
  compileProviderServiceExtensionV1,
  renderProviderCatalogAccessorModuleV1,
  renderProviderConnectionPresentationAccessorModuleV1,
  renderProviderServiceExtensionAccessorModuleV1,
} from "@cloudmarkup/provider-sdk/compiler";

import { createAwsConnectionPresentationSourceV1 } from "../dist/catalog/connection-presentation.js";
import { createAwsProviderServiceExtensionSourceV1 } from "../dist/catalog/service-extension.js";
import { awsCatalogSourceV1 } from "../dist/catalog/source.js";

const mode = process.argv[2];
if (mode !== "--check" && mode !== "--write") {
  throw new Error("Usage: generate-catalog.mjs --check|--write");
}

// The unregistered 0.9 snapshot has no runtime, export, or evaluation consumer.
// Keep the separately consumed frozen networking evaluation catalog intact.
const retiredArtifact = new URL(
  "../src/compiled/catalog-v0-9-0.json",
  import.meta.url,
);

const catalogCompilation = compileProviderCatalogV1(awsCatalogSourceV1);
const presentationCompilation = compileProviderConnectionPresentationV1(
  createAwsConnectionPresentationSourceV1(catalogCompilation.artifact),
  catalogCompilation.artifact,
);
const serviceExtensionCompilation = compileProviderServiceExtensionV1(
  createAwsProviderServiceExtensionSourceV1(catalogCompilation.artifact),
  catalogCompilation.artifact,
);
const outputs = new Map([
  [
    fileURLToPath(new URL("../src/compiled/catalog-v1.json", import.meta.url)),
    catalogCompilation.canonicalJson,
  ],
  [
    fileURLToPath(
      new URL("../src/compiled/catalog-v1.sha256", import.meta.url),
    ),
    `${catalogCompilation.hash}\n`,
  ],
  [
    fileURLToPath(new URL("../src/catalog-v1-accessors.ts", import.meta.url)),
    renderProviderCatalogAccessorModuleV1(catalogCompilation, {
      artifactImportPath: "./compiled/catalog-v1.json",
      artifactExportName: "awsCatalogArtifactV1",
      accessorsExportName: "awsCatalogV1",
      digestExportName: "AWS_CATALOG_DIGEST_V1",
    }),
  ],
  [
    fileURLToPath(
      new URL(
        "../src/compiled/connection-presentation-v1.json",
        import.meta.url,
      ),
    ),
    presentationCompilation.canonicalJson,
  ],
  [
    fileURLToPath(
      new URL(
        "../src/compiled/connection-presentation-v1.sha256",
        import.meta.url,
      ),
    ),
    `${presentationCompilation.hash}\n`,
  ],
  [
    fileURLToPath(
      new URL(
        "../src/connection-presentation-v1-accessors.ts",
        import.meta.url,
      ),
    ),
    renderProviderConnectionPresentationAccessorModuleV1(
      presentationCompilation,
      {
        artifactImportPath: "./compiled/connection-presentation-v1.json",
        artifactExportName: "awsConnectionPresentationArtifactV1",
        accessorsExportName: "awsConnectionPresentationV1",
        digestExportName: "AWS_CONNECTION_PRESENTATION_DIGEST_V1",
      },
    ),
  ],
  [
    fileURLToPath(
      new URL("../src/compiled/service-extension-v1.json", import.meta.url),
    ),
    serviceExtensionCompilation.canonicalJson,
  ],
  [
    fileURLToPath(
      new URL("../src/compiled/service-extension-v1.sha256", import.meta.url),
    ),
    `${serviceExtensionCompilation.hash}\n`,
  ],
  [
    fileURLToPath(
      new URL("../src/service-extension-v1-accessors.ts", import.meta.url),
    ),
    renderProviderServiceExtensionAccessorModuleV1(
      serviceExtensionCompilation,
      {
        artifactImportPath: "./compiled/service-extension-v1.json",
        artifactExportName: "awsServiceExtensionArtifactV1",
        accessorsExportName: "awsServiceExtensionV1",
        digestExportName: "AWS_SERVICE_EXTENSION_DIGEST_V1",
      },
    ),
  ],
]);

if (mode === "--write") {
  for (const [path, contents] of outputs) {
    await mkdir(fileURLToPath(new URL("../src/compiled/", import.meta.url)), {
      recursive: true,
    });
    await writeFile(path, contents, "utf8");
  }
  await rm(retiredArtifact, { force: true });
} else {
  const mismatches = [];
  for (const [path, expected] of outputs) {
    let actual;
    try {
      actual = await readFile(path, "utf8");
    } catch {
      mismatches.push(path);
      continue;
    }
    if (actual !== expected) {
      mismatches.push(path);
    }
  }

  try {
    await access(retiredArtifact);
    mismatches.push(fileURLToPath(retiredArtifact));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  if (mismatches.length > 0) {
    throw new Error(`Provider artifacts are stale: ${mismatches.join(", ")}`);
  }
}
