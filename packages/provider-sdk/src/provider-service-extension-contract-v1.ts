import {
  catalogIdSchema,
  semanticVersionSchema,
  serviceTypeSchema,
  sha256DigestSchema,
} from "@cloudmarkup/schemas";
import { z } from "zod";

import {
  providerOwnedConfigurationSlotV1Schema,
  providerTargetReadinessV1Schema,
} from "./provider-extension-contract-v1.js";

export const PROVIDER_SERVICE_EXTENSION_CONTRACT_VERSION = 1 as const;
export const PROVIDER_SERVICE_EXTENSION_ARTIFACT_KIND =
  "cloudmarkup.provider-service-extension" as const;
export const PROVIDER_SERVICE_EXTENSION_CANONICALIZATION =
  "cloudmarkup.provider-service-extension.canonical-json.v1" as const;

export const providerServiceExtensionCatalogBindingV1Schema = z
  .object({
    id: catalogIdSchema,
    version: semanticVersionSchema,
    digest: sha256DigestSchema,
  })
  .strict();

export const providerServiceExtensionDefinitionV1Schema = z
  .object({
    serviceId: serviceTypeSchema,
    targetReadiness: providerTargetReadinessV1Schema,
    ownedConfigurationSlots: z
      .array(providerOwnedConfigurationSlotV1Schema)
      .max(256),
  })
  .strict();

export const providerServiceExtensionSourceV1Schema = z
  .object({
    contractVersion: z.literal(PROVIDER_SERVICE_EXTENSION_CONTRACT_VERSION),
    catalog: providerServiceExtensionCatalogBindingV1Schema,
    services: z.array(providerServiceExtensionDefinitionV1Schema).max(2_048),
  })
  .strict();

export const providerServiceExtensionArtifactContentV1Schema =
  providerServiceExtensionSourceV1Schema
    .extend({
      kind: z.literal(PROVIDER_SERVICE_EXTENSION_ARTIFACT_KIND),
      canonicalization: z.literal(PROVIDER_SERVICE_EXTENSION_CANONICALIZATION),
    })
    .strict();

export const providerServiceExtensionArtifactV1Schema =
  providerServiceExtensionArtifactContentV1Schema
    .extend({
      digest: sha256DigestSchema,
    })
    .strict();

export type ProviderServiceExtensionCatalogBindingV1 = z.output<
  typeof providerServiceExtensionCatalogBindingV1Schema
>;
export type ProviderServiceExtensionDefinitionV1 = z.output<
  typeof providerServiceExtensionDefinitionV1Schema
>;
export type ProviderServiceExtensionSourceV1 = z.output<
  typeof providerServiceExtensionSourceV1Schema
>;
export type ProviderServiceExtensionArtifactContentV1 = z.output<
  typeof providerServiceExtensionArtifactContentV1Schema
>;
export type ProviderServiceExtensionArtifactV1 = z.output<
  typeof providerServiceExtensionArtifactV1Schema
>;
export type ProviderServiceExtensionDefinitionV1Input = z.input<
  typeof providerServiceExtensionDefinitionV1Schema
>;
export type ProviderServiceExtensionSourceV1Input = z.input<
  typeof providerServiceExtensionSourceV1Schema
>;

export function defineProviderServiceExtensionV1(
  extension: ProviderServiceExtensionDefinitionV1Input,
): ProviderServiceExtensionDefinitionV1 {
  return providerServiceExtensionDefinitionV1Schema.parse(extension);
}

export function defineProviderServiceExtensionSourceV1(
  source: ProviderServiceExtensionSourceV1Input,
): ProviderServiceExtensionSourceV1 {
  return providerServiceExtensionSourceV1Schema.parse(source);
}
