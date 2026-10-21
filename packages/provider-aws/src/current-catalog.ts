import { awsCatalogV1 } from "./catalog-v1-accessors.js";
import { awsServiceExtensionV1 } from "./service-extension-v1-accessors.js";

export interface AwsCatalogBindingV1 {
  readonly id: string;
  readonly version: string;
  readonly digest: string;
}

export const AWS_CURRENT_CATALOG_BINDING_V1 = Object.freeze({
  id: awsCatalogV1.artifact.catalog.id,
  version: awsCatalogV1.artifact.catalog.version,
  digest: awsCatalogV1.artifact.digest,
});

const current = Object.freeze({
  catalog: awsCatalogV1,
  serviceExtension: awsServiceExtensionV1,
});

/** Immutable consumers require the installed exact binding. Mutable drafts may
 * prepare a lossless catalog-opening candidate before saving a new revision. */
export function resolveAwsCurrentCatalogV1(
  binding: AwsCatalogBindingV1 = AWS_CURRENT_CATALOG_BINDING_V1,
) {
  if (
    binding.id !== AWS_CURRENT_CATALOG_BINDING_V1.id ||
    binding.version !== AWS_CURRENT_CATALOG_BINDING_V1.version ||
    binding.digest !== AWS_CURRENT_CATALOG_BINDING_V1.digest
  ) {
    throw new Error(
      "This revision uses an unsupported AWS catalog. Open the project in the editor to review catalog compatibility and save a new revision; the original revision is retained.",
    );
  }
  return current;
}
