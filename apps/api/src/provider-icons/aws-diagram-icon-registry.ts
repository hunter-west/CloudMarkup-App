import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { createDiagramIconSetV1 } from "@cloudmarkup/diagram-export";
import { awsCatalogArtifactV1 } from "@cloudmarkup/provider-aws/catalog";
import { serializeCanonicalJson } from "@cloudmarkup/schemas";

import { productionSolutionExportIconBundleSchema } from "../production-solution-export-profile.js";

/** Build-time composition boundary for exact approved local diagram assets.
 * Only manifest-declared package exports are read; opaque catalog icon IDs never
 * become file paths. The strict renderer registry checks catalog, approval,
 * sanitized bytes and integrity before a bundle can be staged. */
export function collectAwsDiagramIconRegistryBundle() {
  const ownRequire = createRequire(import.meta.url);
  const manifest = JSON.parse(
    readFileSync(
      ownRequire.resolve(
        "@cloudmarkup/provider-aws/assets/provider-icons.manifest.json",
      ),
      "utf8",
    ),
  ) as { entries: readonly { state: string; file: string | null }[] };
  const assetsByFile: Record<string, string> = {};
  for (const entry of manifest.entries) {
    if (entry.state !== "approved" || entry.file === null) continue;
    if (!/^[a-z0-9][a-z0-9.-]{0,95}\.svg$/u.test(entry.file))
      throw new TypeError("Unreviewed icon asset path.");
    assetsByFile[entry.file] = readFileSync(
      ownRequire.resolve(
        "@cloudmarkup/provider-aws/assets/icons/" + entry.file,
      ),
      "utf8",
    );
  }
  const bundle = productionSolutionExportIconBundleSchema.parse({
    contractVersion: 1,
    catalogDigest: awsCatalogArtifactV1.digest,
    manifest,
    assetsByFile,
  });
  createDiagramIconSetV1({ ...bundle, catalog: awsCatalogArtifactV1 });
  const bytes = Buffer.from(serializeCanonicalJson(bundle));
  if (bytes.byteLength > 4 * 1024 * 1024)
    throw new TypeError("The icon bundle exceeds the admitted runtime limit.");
  return {
    path: "cloudmarkup-export/diagram-icons.json",
    bytes,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}
