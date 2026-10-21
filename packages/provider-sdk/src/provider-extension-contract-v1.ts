import {
  elementLifecycleSchema,
  namespacedIdentifierSchema,
  nodeIdSchema,
  relationshipTypeSchema,
  semanticVersionSchema,
  serviceTypeSchema,
  variableIdSchema,
} from "@cloudmarkup/schemas";
import { z } from "zod";

export const PROVIDER_EXTENSION_CONTRACT_VERSION = 1 as const;

const shortTextSchema = z.string().trim().min(1).max(256);
const longTextSchema = z.string().trim().min(1).max(4_096);
const providerOwnedConfigurationSlotIdSchema =
  namespacedIdentifierSchema.brand<"ProviderOwnedConfigurationSlotId">();
const providerOwnedConfigurationKindSchema =
  namespacedIdentifierSchema.brand<"ProviderOwnedConfigurationKind">();

export const providerCardinalityRangeV1Schema = z
  .object({
    minimum: z.union([z.literal(0), z.literal(1)]),
    maximum: z.union([z.literal(1), z.literal("many")]),
    enforcement: z.enum(["semantic-port", "provider-rule"]),
  })
  .strict();

export const providerTargetReadinessStatusV1Schema = z.enum([
  "supported",
  "pending",
  "unsupported",
  "not-applicable",
]);

export const providerTargetReadinessEntryV1Schema = z
  .object({
    status: providerTargetReadinessStatusV1Schema,
    reason: longTextSchema,
  })
  .strict();

export const providerTargetReadinessV1Schema = z
  .object({
    modeling: providerTargetReadinessEntryV1Schema,
    configuration: providerTargetReadinessEntryV1Schema,
    validation: providerTargetReadinessEntryV1Schema,
    terraform: providerTargetReadinessEntryV1Schema,
    cloudformation: providerTargetReadinessEntryV1Schema,
    generatedCode: providerTargetReadinessEntryV1Schema,
  })
  .strict();

export const providerPolicyKindV1Schema = z.enum([
  "identity-inline",
  "trust",
  "managed-policy-attachment",
  "permissions-boundary",
  "resource",
  "generated-permission",
  "service-grant",
]);

export const providerPolicyDocumentKindV1Schema = z.enum([
  "identity-inline",
  "trust",
  "resource",
  "generated-permission",
  "service-grant",
]);

export const providerPolicyEffectV1Schema = z.enum(["allow", "deny"]);

export const providerPolicyActionV1Schema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("provider-action"),
      action: z
        .string()
        .regex(
          /^[a-z][a-z0-9-]*:[A-Za-z][A-Za-z0-9*?]*$/u,
          "Provider policy actions must use service:Action syntax; an unrestricted wildcard uses the explicit all-actions variant.",
        )
        .max(256),
    })
    .strict(),
  z.object({ kind: z.literal("all-actions") }).strict(),
]);

export const providerPolicyResourceV1Schema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("architecture-node"),
      nodeId: nodeIdSchema,
      attribute: namespacedIdentifierSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("variable"),
      variableId: variableIdSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("provider-resource"),
      value: z.string().trim().min(1).max(2_048),
    })
    .strict(),
  z.object({ kind: z.literal("all-resources") }).strict(),
]);

export const providerPolicyPrincipalV1Schema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("service"),
      service: namespacedIdentifierSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("architecture-node"),
      nodeId: nodeIdSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("provider-identity"),
      value: z.string().trim().min(1).max(2_048),
    })
    .strict(),
  z
    .object({
      kind: z.literal("federated"),
      value: z.string().trim().min(1).max(2_048),
    })
    .strict(),
  z.object({ kind: z.literal("all-principals") }).strict(),
]);

export const providerPolicyConditionValueV1Schema = z.discriminatedUnion(
  "kind",
  [
    z
      .object({ kind: z.literal("string"), value: z.string().max(2_048) })
      .strict(),
    z.object({ kind: z.literal("number"), value: z.number() }).strict(),
    z.object({ kind: z.literal("boolean"), value: z.boolean() }).strict(),
    z
      .object({
        kind: z.literal("architecture-node"),
        nodeId: nodeIdSchema,
        attribute: namespacedIdentifierSchema,
      })
      .strict(),
    z
      .object({
        kind: z.literal("variable"),
        variableId: variableIdSchema,
      })
      .strict(),
  ],
);

export const providerPolicyConditionV1Schema = z
  .object({
    id: nodeIdSchema,
    operator: z
      .string()
      .regex(
        /^[A-Za-z][A-Za-z0-9]*(?::[A-Za-z][A-Za-z0-9]*)?$/u,
        "Policy condition operators must be one or two stable identifier segments.",
      )
      .max(128),
    key: z
      .string()
      .regex(
        /^[A-Za-z0-9][A-Za-z0-9_./:${}*-]*$/u,
        "Policy condition keys must be stable provider identifiers.",
      )
      .max(256),
    values: z.array(providerPolicyConditionValueV1Schema).min(1).max(128),
  })
  .strict();

export const providerCanonicalPolicyStatementV1Schema = z
  .object({
    id: nodeIdSchema,
    statementIdentifier: z
      .string()
      .regex(
        /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u,
        "Policy statement identifiers must be stable identifiers.",
      )
      .optional(),
    effect: providerPolicyEffectV1Schema,
    actions: z.array(providerPolicyActionV1Schema).min(1).max(256),
    resources: z.array(providerPolicyResourceV1Schema).max(256),
    principals: z.array(providerPolicyPrincipalV1Schema).max(128),
    conditions: z.array(providerPolicyConditionV1Schema).max(128),
    lifecycle: elementLifecycleSchema,
  })
  .strict();

export const providerCanonicalPolicyDocumentV1Schema = z
  .object({
    contractVersion: z.literal(PROVIDER_EXTENSION_CONTRACT_VERSION),
    id: nodeIdSchema,
    ownerNodeId: nodeIdSchema,
    slotId: providerOwnedConfigurationSlotIdSchema,
    schemaVersion: semanticVersionSchema,
    displayName: shortTextSchema,
    policyKind: providerPolicyDocumentKindV1Schema,
    lifecycle: elementLifecycleSchema,
    statements: z
      .array(providerCanonicalPolicyStatementV1Schema)
      .min(1)
      .max(256),
    targetReadiness: providerTargetReadinessV1Schema,
  })
  .strict()
  .superRefine((document, context) => {
    const statementIds = new Set<string>();
    const statementIdentifiers = new Set<string>();
    const forbidsPrincipals =
      document.policyKind === "identity-inline" ||
      document.policyKind === "generated-permission";
    const requiresPrincipals =
      document.policyKind === "trust" ||
      document.policyKind === "resource" ||
      document.policyKind === "service-grant";

    document.statements.forEach((statement, index) => {
      const statementId = String(statement.id);
      if (statementIds.has(statementId)) {
        context.addIssue({
          code: "custom",
          path: ["statements", index, "id"],
          message: "Canonical policy statement node IDs must be unique.",
        });
      }
      statementIds.add(statementId);

      if (statement.statementIdentifier !== undefined) {
        if (statementIdentifiers.has(statement.statementIdentifier)) {
          context.addIssue({
            code: "custom",
            path: ["statements", index, "statementIdentifier"],
            message: "Canonical policy statement identifiers must be unique.",
          });
        }
        statementIdentifiers.add(statement.statementIdentifier);
      }

      if (forbidsPrincipals && statement.principals.length > 0) {
        context.addIssue({
          code: "custom",
          path: ["statements", index, "principals"],
          message:
            "Identity and generated-permission policy statements cannot declare principals.",
        });
      }
      if (requiresPrincipals && statement.principals.length === 0) {
        context.addIssue({
          code: "custom",
          path: ["statements", index, "principals"],
          message:
            "Trust, resource, and service-grant policy statements require a principal.",
        });
      }
      if (document.policyKind !== "trust" && statement.resources.length === 0) {
        context.addIssue({
          code: "custom",
          path: ["statements", index, "resources"],
          message: "Non-trust policy statements require a resource scope.",
        });
      }
    });
  });

export const providerOwnedConfigurationSlotV1Schema = z
  .object({
    id: providerOwnedConfigurationSlotIdSchema,
    slotVersion: semanticVersionSchema,
    configurationKind: providerOwnedConfigurationKindSchema,
    displayName: shortTextSchema,
    description: longTextSchema,
    graphBinding: z
      .object({
        configurationServiceId: serviceTypeSchema,
        ownershipRelationshipType: relationshipTypeSchema,
      })
      .strict(),
    cardinality: providerCardinalityRangeV1Schema,
    allowedOwnership: z
      .array(z.enum(["user", "generated"]))
      .min(1)
      .max(2),
    generatedAdoption: z.enum(["allowed", "forbidden", "not-applicable"]),
    policyKinds: z.array(providerPolicyKindV1Schema).max(7),
    targetReadiness: providerTargetReadinessV1Schema,
    guidedExplanation: longTextSchema,
    professionalExplanation: longTextSchema,
  })
  .strict()
  .superRefine((slot, context) => {
    if (new Set(slot.allowedOwnership).size !== slot.allowedOwnership.length) {
      context.addIssue({
        code: "custom",
        path: ["allowedOwnership"],
        message: "Owned-configuration ownership modes must be unique.",
      });
    }
    if (new Set(slot.policyKinds).size !== slot.policyKinds.length) {
      context.addIssue({
        code: "custom",
        path: ["policyKinds"],
        message: "Owned-configuration policy kinds must be unique.",
      });
    }
    if (
      slot.generatedAdoption !== "not-applicable" &&
      !slot.allowedOwnership.includes("generated")
    ) {
      context.addIssue({
        code: "custom",
        path: ["generatedAdoption"],
        message:
          "Generated adoption policy is applicable only when generated ownership is allowed.",
      });
    }
  });

export type ProviderCardinalityRangeV1 = z.output<
  typeof providerCardinalityRangeV1Schema
>;
export type ProviderTargetReadinessStatusV1 = z.output<
  typeof providerTargetReadinessStatusV1Schema
>;
export type ProviderTargetReadinessEntryV1 = z.output<
  typeof providerTargetReadinessEntryV1Schema
>;
export type ProviderTargetReadinessV1 = z.output<
  typeof providerTargetReadinessV1Schema
>;
export type ProviderPolicyKindV1 = z.output<typeof providerPolicyKindV1Schema>;
export type ProviderPolicyDocumentKindV1 = z.output<
  typeof providerPolicyDocumentKindV1Schema
>;
export type ProviderPolicyEffectV1 = z.output<
  typeof providerPolicyEffectV1Schema
>;
export type ProviderPolicyActionV1 = z.output<
  typeof providerPolicyActionV1Schema
>;
export type ProviderPolicyResourceV1 = z.output<
  typeof providerPolicyResourceV1Schema
>;
export type ProviderPolicyPrincipalV1 = z.output<
  typeof providerPolicyPrincipalV1Schema
>;
export type ProviderPolicyConditionValueV1 = z.output<
  typeof providerPolicyConditionValueV1Schema
>;
export type ProviderPolicyConditionV1 = z.output<
  typeof providerPolicyConditionV1Schema
>;
export type ProviderCanonicalPolicyStatementV1 = z.output<
  typeof providerCanonicalPolicyStatementV1Schema
>;
export type ProviderCanonicalPolicyDocumentV1 = z.output<
  typeof providerCanonicalPolicyDocumentV1Schema
>;
export type ProviderOwnedConfigurationSlotV1 = z.output<
  typeof providerOwnedConfigurationSlotV1Schema
>;
export type ProviderCanonicalPolicyDocumentV1Input = z.input<
  typeof providerCanonicalPolicyDocumentV1Schema
>;
export type ProviderOwnedConfigurationSlotV1Input = z.input<
  typeof providerOwnedConfigurationSlotV1Schema
>;

export function defineProviderCanonicalPolicyDocumentV1(
  document: ProviderCanonicalPolicyDocumentV1Input,
): ProviderCanonicalPolicyDocumentV1 {
  return providerCanonicalPolicyDocumentV1Schema.parse(document);
}

export function defineProviderOwnedConfigurationSlotV1(
  slot: ProviderOwnedConfigurationSlotV1Input,
): ProviderOwnedConfigurationSlotV1 {
  return providerOwnedConfigurationSlotV1Schema.parse(slot);
}
