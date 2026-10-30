import {
  createProviderCatalogAccessorsV1,
  createProviderServiceExtensionAccessorsV1,
  providerCatalogArtifactV1Schema,
  providerServiceExtensionArtifactV1Schema,
} from "@cloudmarkup/provider-sdk";
import { digestCanonicalValue } from "@cloudmarkup/schemas";

import historicalCatalogJson from "./model-evaluation-source/catalog-71-v1.json" with { type: "json" };
import historicalExtensionJson from "./model-evaluation-source/service-extension-71-v1.json" with { type: "json" };
import regionalWafCatalogJson from "./model-evaluation-source/catalog-73-v1.json" with { type: "json" };
import regionalWafExtensionJson from "./model-evaluation-source/service-extension-73-v1.json" with { type: "json" };
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
/** Exact source retained for the separately frozen regional WAF 1.8 input. */
export const AWS_FROZEN_WAF_MODEL_CATALOG_BINDING_V1 = Object.freeze({
  id: "aws.cloudmarkup.notes-api-catalog",
  version: "0.30.0",
  digest:
    "sha256:8e9b1b23bbcdf723352044baddd8e79468d70ed5a719af914036992daf91fb94",
});
const regionalWafExtensionDigest =
  "sha256:f6e84fdf8253117361ba1ca6dcd18f7183f2cdbf693b5ea95d7b0c562337b5e1";
const same = (left: AwsCatalogBindingV1, right: AwsCatalogBindingV1) =>
  left.id === right.id &&
  left.version === right.version &&
  left.digest === right.digest;

const frozen = new Map<string, ReturnType<typeof resolveAwsCurrentCatalogV1>>();

function frozenSource(regionalWaf = false) {
  const binding = regionalWaf
    ? AWS_FROZEN_WAF_MODEL_CATALOG_BINDING_V1
    : AWS_FROZEN_MODEL_CATALOG_BINDING_V1;
  const cached = frozen.get(binding.digest);
  if (cached) return cached;
  // Keep large retained JSON inputs opaque until their integrity and schema
  // checks run; consumers need the validated contract, not inferred JSON unions.
  const sourceCatalog: {
    readonly digest: string;
    readonly [key: string]: unknown;
  } = regionalWaf ? regionalWafCatalogJson : historicalCatalogJson;
  const sourceExtension: {
    readonly digest: string;
    readonly [key: string]: unknown;
  } = regionalWaf ? regionalWafExtensionJson : historicalExtensionJson;
  for (const [artifact, expected] of [
    [sourceCatalog, binding.digest],
    [
      sourceExtension,
      regionalWaf ? regionalWafExtensionDigest : historicalExtensionDigest,
    ],
  ] as const) {
    const { digest, ...content } = artifact;
    if (digest !== expected || digestCanonicalValue(content) !== expected)
      throw Error("The frozen model catalog source integrity check failed.");
  }
  const catalog = createProviderCatalogAccessorsV1(
    providerCatalogArtifactV1Schema.parse(sourceCatalog),
  );
  const extension =
    providerServiceExtensionArtifactV1Schema.parse(sourceExtension);
  if (!same(extension.catalog, binding))
    throw Error("The frozen model catalog extension binding is unavailable.");
  const resolved = Object.freeze({
    catalog,
    serviceExtension: createProviderServiceExtensionAccessorsV1(extension),
  });
  frozen.set(binding.digest, resolved);
  return resolved;
}

/** Read-only model context for exact immutable source bindings. The default is
 * current; only the separately frozen evaluation sources are additionally readable.
 * This is not compiler, mutation, model-quality, invocation or promotion admission.
 * Unknown and relabeled identities fail closed; no historical data are rehashed
 * into a new catalog, and no current service/validator leaks into old grounding. */
export function resolveAwsModelCatalogV1(
  binding: AwsCatalogBindingV1 = AWS_CURRENT_CATALOG_BINDING_V1,
) {
  if (same(binding, AWS_FROZEN_MODEL_CATALOG_BINDING_V1)) return frozenSource();
  if (same(binding, AWS_FROZEN_WAF_MODEL_CATALOG_BINDING_V1))
    return frozenSource(true);
  return resolveAwsCurrentCatalogV1(binding);
}
