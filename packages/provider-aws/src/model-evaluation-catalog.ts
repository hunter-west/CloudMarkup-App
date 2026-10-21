import {
  createProviderCatalogAccessorsV1,
  createProviderServiceExtensionAccessorsV1,
  providerCatalogArtifactV1Schema,
  providerServiceExtensionArtifactV1Schema,
} from "@cloudmarkup/provider-sdk";
import { digestCanonicalValue } from "@cloudmarkup/schemas";

import historicalCatalogJson from "./model-evaluation-source/catalog-71-v1.json" with { type: "json" };
import historicalExtensionJson from "./model-evaluation-source/service-extension-71-v1.json" with { type: "json" };
import {
  AWS_CURRENT_CATALOG_BINDING_V1,
  resolveAwsCurrentCatalogV1,
  type AwsCatalogBindingV1,
} from "./current-catalog.js";

/** Exact source used by frozen full-beta 1.5/1.6/1.7 input authorities.
 * It is not installed in the editor or native compiler compatibility registry. */
export const AWS_FROZEN_MODEL_CATALOG_BINDING_V1 = Object.freeze({
  id: "aws.cloudmarkup.notes-api-catalog",
  version: "0.30.0",
  digest:
    "sha256:7bc6db32a69c5dd33ef85e02e2ebd38bb47333670259696165149ce39bcca682",
});
const historicalExtensionDigest =
  "sha256:fb4ba434f0dbaaa63543d16a886778109eb69bec730d1b2ca384d2acb32db341";
const same = (left: AwsCatalogBindingV1, right: AwsCatalogBindingV1) =>
  left.id === right.id &&
  left.version === right.version &&
  left.digest === right.digest;

let historical: ReturnType<typeof resolveAwsCurrentCatalogV1> | undefined;

function frozenSource() {
  if (historical) return historical;
  for (const [artifact, expected] of [
    [historicalCatalogJson, AWS_FROZEN_MODEL_CATALOG_BINDING_V1.digest],
    [historicalExtensionJson, historicalExtensionDigest],
  ] as const) {
    const { digest, ...content } = artifact;
    if (digest !== expected || digestCanonicalValue(content) !== expected)
      throw Error("The frozen model catalog source integrity check failed.");
  }
  const catalog = createProviderCatalogAccessorsV1(
    providerCatalogArtifactV1Schema.parse(historicalCatalogJson),
  );
  const extension = providerServiceExtensionArtifactV1Schema.parse(
    historicalExtensionJson,
  );
  if (!same(extension.catalog, AWS_FROZEN_MODEL_CATALOG_BINDING_V1))
    throw Error("The frozen model catalog extension binding is unavailable.");
  historical = Object.freeze({
    catalog,
    serviceExtension: createProviderServiceExtensionAccessorsV1(extension),
  });
  return historical;
}

/** Read-only model context for exact immutable source bindings. The default is
 * current; only the separately frozen evaluation source is additionally readable.
 * This is not compiler, mutation, model-quality, invocation or promotion admission.
 * Unknown and relabeled identities fail closed; no historical data are rehashed
 * into a new catalog, and no current service/validator leaks into old grounding. */
export function resolveAwsModelCatalogV1(
  binding: AwsCatalogBindingV1 = AWS_CURRENT_CATALOG_BINDING_V1,
) {
  if (same(binding, AWS_FROZEN_MODEL_CATALOG_BINDING_V1)) return frozenSource();
  return resolveAwsCurrentCatalogV1(binding);
}
