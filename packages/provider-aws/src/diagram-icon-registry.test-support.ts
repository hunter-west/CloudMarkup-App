import awsIconManifest from "../assets/provider-icons.manifest.json" with { type: "json" };
import { awsCatalogArtifactV1 } from "./catalog-v1-accessors.js";

/**
 * Provider-owned test boundary for exact reviewed local diagram icon assets.
 * Product renderers remain provider-neutral and receive bytes through their
 * strict icon-set contract; only tests resolve these repository-local URLs.
 */
export function createAwsDiagramIconRegistryTestInput() {
  const files = [
    ...new Set(
      awsIconManifest.entries.flatMap(({ file }) =>
        typeof file === "string" ? [file] : [],
      ),
    ),
  ];
  return {
    assetSpecifiersByFile: Object.fromEntries(
      files.map((file) => [
        file,
        `@cloudmarkup/provider-aws/assets/icons/${file}`,
      ]),
    ),
    catalog: awsCatalogArtifactV1,
    manifest: awsIconManifest,
  };
}
