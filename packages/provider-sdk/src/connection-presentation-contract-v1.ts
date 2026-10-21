import {
  catalogIdSchema,
  namespacedIdentifierSchema,
  portTypeSchema,
  semanticVersionSchema,
  serviceTypeSchema,
  sha256DigestSchema,
} from "@cloudmarkup/schemas";
import { z } from "zod";

import { providerCardinalityRangeV1Schema } from "./provider-extension-contract-v1.js";

export const PROVIDER_CONNECTION_PRESENTATION_CONTRACT_VERSION = 1 as const;
export const PROVIDER_CONNECTION_PRESENTATION_ARTIFACT_KIND =
  "cloudmarkup.provider-connection-presentation" as const;
export const PROVIDER_CONNECTION_PRESENTATION_CANONICALIZATION =
  "cloudmarkup.provider-connection-presentation.canonical-json.v1" as const;

const shortTextSchema = z.string().trim().min(1).max(256);
const longTextSchema = z.string().trim().min(1).max(4_096);
const connectionDockIdSchema =
  namespacedIdentifierSchema.brand<"ProviderConnectionDockId">();
const connectionRuleIdSchema =
  namespacedIdentifierSchema.brand<"ProviderConnectionPresentationRuleId">();

export const providerConnectionPresentationCatalogBindingV1Schema = z
  .object({
    id: catalogIdSchema,
    version: semanticVersionSchema,
    digest: sha256DigestSchema,
  })
  .strict();

export const providerConnectionDockCategoryV1Schema = z.enum([
  "triggers",
  "data",
  "messaging",
  "invocation",
  "identity",
  "networking",
  "observability",
  "other",
]);

export const providerConnectionDockPlacementV1Schema = z.enum([
  "left",
  "right",
  "top",
  "bottom",
]);

export const providerConnectionDockDirectionPolicyV1Schema = z.enum([
  "input-only",
  "output-only",
  "mixed",
]);

export const providerConnectionDockV1Schema = z
  .object({
    id: connectionDockIdSchema,
    category: providerConnectionDockCategoryV1Schema,
    label: shortTextSchema,
    description: longTextSchema,
    placement: providerConnectionDockPlacementV1Schema,
    order: z.number().int().nonnegative().max(1_024),
    directionPolicy: providerConnectionDockDirectionPolicyV1Schema,
    portIds: z.array(portTypeSchema).min(1).max(256),
    cardinality: providerCardinalityRangeV1Schema,
    allowsMultipleEdges: z.boolean(),
    containsExclusiveRelationships: z.boolean(),
    guidedExplanation: longTextSchema,
    professionalExplanation: longTextSchema,
  })
  .strict();

export const providerServiceConnectionPresentationV1Schema = z
  .object({
    serviceId: serviceTypeSchema,
    docks: z.array(providerConnectionDockV1Schema).max(256),
  })
  .strict();

export const providerConnectionRelationshipLabelV1Schema = z
  .object({
    ruleId: connectionRuleIdSchema,
    label: shortTextSchema,
  })
  .strict();

export const providerConnectionPresentationSourceV1Schema = z
  .object({
    contractVersion: z.literal(
      PROVIDER_CONNECTION_PRESENTATION_CONTRACT_VERSION,
    ),
    catalog: providerConnectionPresentationCatalogBindingV1Schema,
    services: z.array(providerServiceConnectionPresentationV1Schema).max(2_048),
    relationshipLabels: z
      .array(providerConnectionRelationshipLabelV1Schema)
      .max(4_096),
  })
  .strict();

export const providerConnectionPresentationArtifactContentV1Schema =
  providerConnectionPresentationSourceV1Schema
    .extend({
      kind: z.literal(PROVIDER_CONNECTION_PRESENTATION_ARTIFACT_KIND),
      canonicalization: z.literal(
        PROVIDER_CONNECTION_PRESENTATION_CANONICALIZATION,
      ),
    })
    .strict();

export const providerConnectionPresentationArtifactV1Schema =
  providerConnectionPresentationArtifactContentV1Schema
    .extend({
      digest: sha256DigestSchema,
    })
    .strict();

export type ProviderConnectionPresentationCatalogBindingV1 = z.output<
  typeof providerConnectionPresentationCatalogBindingV1Schema
>;
export type ProviderConnectionDockCategoryV1 = z.output<
  typeof providerConnectionDockCategoryV1Schema
>;
export type ProviderConnectionDockPlacementV1 = z.output<
  typeof providerConnectionDockPlacementV1Schema
>;
export type ProviderConnectionDockDirectionPolicyV1 = z.output<
  typeof providerConnectionDockDirectionPolicyV1Schema
>;
export type ProviderConnectionDockV1 = z.output<
  typeof providerConnectionDockV1Schema
>;
export type ProviderServiceConnectionPresentationV1 = z.output<
  typeof providerServiceConnectionPresentationV1Schema
>;
export type ProviderConnectionRelationshipLabelV1 = z.output<
  typeof providerConnectionRelationshipLabelV1Schema
>;
export type ProviderConnectionPresentationSourceV1 = z.output<
  typeof providerConnectionPresentationSourceV1Schema
>;
export type ProviderConnectionPresentationArtifactContentV1 = z.output<
  typeof providerConnectionPresentationArtifactContentV1Schema
>;
export type ProviderConnectionPresentationArtifactV1 = z.output<
  typeof providerConnectionPresentationArtifactV1Schema
>;
export type ProviderConnectionPresentationSourceV1Input = z.input<
  typeof providerConnectionPresentationSourceV1Schema
>;
export type ProviderServiceConnectionPresentationV1Input = z.input<
  typeof providerServiceConnectionPresentationV1Schema
>;
export type ProviderConnectionRelationshipLabelV1Input = z.input<
  typeof providerConnectionRelationshipLabelV1Schema
>;

export function defineProviderConnectionPresentationSourceV1(
  source: ProviderConnectionPresentationSourceV1Input,
): ProviderConnectionPresentationSourceV1 {
  return providerConnectionPresentationSourceV1Schema.parse(source);
}

export function defineProviderServiceConnectionPresentationV1(
  presentation: ProviderServiceConnectionPresentationV1Input,
): ProviderServiceConnectionPresentationV1 {
  return providerServiceConnectionPresentationV1Schema.parse(presentation);
}

export function defineProviderConnectionRelationshipLabelV1(
  label: ProviderConnectionRelationshipLabelV1Input,
): ProviderConnectionRelationshipLabelV1 {
  return providerConnectionRelationshipLabelV1Schema.parse(label);
}
