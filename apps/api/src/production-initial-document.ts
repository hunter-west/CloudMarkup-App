import { parseArchitectureDocument } from "@cloudmarkup/domain";
import { awsCatalogArtifactV1 } from "@cloudmarkup/provider-aws/catalog";
import { createInitialArchitectureDocument } from "./application/architecture-document-storage.js";

/** The hosted blank canvas uses the exact bundled AWS catalog; no sample nodes. */
export const createProductionInitialDocument: typeof createInitialArchitectureDocument =
  (input) =>
    parseArchitectureDocument({
      ...createInitialArchitectureDocument({
        ...input,
        blank: true,
        infrastructureOnly: true,
      }),
      provider: { id: awsCatalogArtifactV1.provider.id, region: "us-east-1" },
      catalog: {
        id: awsCatalogArtifactV1.catalog.id,
        version: awsCatalogArtifactV1.catalog.version,
        digest: awsCatalogArtifactV1.digest,
      },
    });
