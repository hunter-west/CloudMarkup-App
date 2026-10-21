import { z } from "zod";

import {
  actorIdSchema,
  architectureIdSchema,
  documentIdSchema,
  namespacedIdentifierSchema,
  nodeIdSchema,
  providerIdSchema,
  regionIdentifierSchema,
  revisionIdSchema,
  semanticVersionSchema,
  sha256DigestSchema,
  utcTimestampSchema,
} from "./architecture-document-v1.js";
import {
  applicationContractReferenceV1Schema,
  contractFieldPathSchema,
} from "./application-contracts-v1.js";
import { workloadSecretReferenceSchema } from "./workload-behavior-v1.js";

const opaqueIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const safeReferencePattern = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,1023}$/;
const hostPattern =
  /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)*[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;

const shortTextSchema = z.string().trim().min(1).max(512);
const longTextSchema = z.string().trim().min(1).max(8_000);
const boundedOpaqueIdSchema = z
  .string()
  .regex(opaqueIdPattern, "Must be a stable opaque identifier.");

const safeUrlSchema = z
  .string()
  .max(2_048)
  .regex(
    /^https:\/\/[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?(?::[0-9]{1,5})?(?:\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*)?$/,
  );

export const externalResourceIdSchema =
  boundedOpaqueIdSchema.brand<"ExternalResourceId">();
export const externalResourceInterfaceIdSchema =
  boundedOpaqueIdSchema.brand<"ExternalResourceInterfaceId">();
export const externalResourceAddressIdSchema =
  boundedOpaqueIdSchema.brand<"ExternalResourceAddressId">();
export const externalResourceEvidenceIdSchema =
  boundedOpaqueIdSchema.brand<"ExternalResourceEvidenceId">();
export const externalResourceCandidateIdSchema =
  boundedOpaqueIdSchema.brand<"ExternalResourceCandidateId">();
export const externalResourceUnresolvedInformationIdSchema =
  boundedOpaqueIdSchema.brand<"ExternalResourceUnresolvedInformationId">();

export const externalResourceDocumentReferenceV1Schema = z
  .object({
    documentId: documentIdSchema,
    revisionId: revisionIdSchema,
    digest: sha256DigestSchema,
  })
  .strict();

export const externalResourceReferenceV1Schema = z
  .object({
    externalResourceId: externalResourceIdSchema,
    document: externalResourceDocumentReferenceV1Schema,
  })
  .strict();

export const externalResourceOwnershipStateV1Schema = z.enum([
  "managed-by-generated-iac",
  "existing-cloud-managed-elsewhere",
  "imported-current-iac-lifecycle",
  "third-party-service-api",
  "on-premises-network-endpoint",
  "repository-defined-external-dependency",
  "unknown-unresolved",
]);

export const externalResourceAddressV1Schema = z.discriminatedUnion("kind", [
  z
    .object({
      addressId: externalResourceAddressIdSchema,
      kind: z.literal("cloud-arn"),
      value: z
        .string()
        .max(2_048)
        .regex(
          /^arn:[a-z0-9-]+:[a-z0-9-]*:[a-z0-9-]*:[0-9]{0,12}:[A-Za-z0-9][A-Za-z0-9._:/+=,@-]{0,1535}$/,
        ),
    })
    .strict(),
  z
    .object({
      addressId: externalResourceAddressIdSchema,
      kind: z.literal("provider-resource-id"),
      value: z.string().regex(safeReferencePattern),
    })
    .strict(),
  z
    .object({
      addressId: externalResourceAddressIdSchema,
      kind: z.literal("url"),
      value: safeUrlSchema,
    })
    .strict(),
  z
    .object({
      addressId: externalResourceAddressIdSchema,
      kind: z.literal("network-endpoint"),
      host: z.string().max(253).regex(hostPattern),
      port: z.number().int().min(1).max(65_535),
    })
    .strict(),
  z
    .object({
      addressId: externalResourceAddressIdSchema,
      kind: z.literal("repository-dependency"),
      ecosystem: namespacedIdentifierSchema,
      packageReference: z.string().regex(safeReferencePattern),
    })
    .strict(),
]);

export const externalResourceProviderV1Schema = z.discriminatedUnion("state", [
  z
    .object({
      state: z.literal("known"),
      providerId: providerIdSchema,
      serviceFamily: namespacedIdentifierSchema,
    })
    .strict(),
  z
    .object({
      state: z.literal("unknown"),
      reason: shortTextSchema,
    })
    .strict(),
]);

export const externalResourceScopeV1Schema = z
  .object({
    accountReference: z.string().regex(safeReferencePattern).optional(),
    subscriptionReference: z.string().regex(safeReferencePattern).optional(),
    projectReference: z.string().regex(safeReferencePattern).optional(),
    region: regionIdentifierSchema.optional(),
    location: z.string().min(1).max(128).optional(),
  })
  .strict();

export const externalResourceAuthenticationV1Schema = z.discriminatedUnion(
  "method",
  [
    z.object({ method: z.literal("none") }).strict(),
    z.object({ method: z.literal("runtime-identity") }).strict(),
    z
      .object({
        method: z.enum([
          "api-key-reference",
          "basic-reference",
          "oauth2-reference",
          "oidc-reference",
          "mutual-tls-reference",
          "signed-request-reference",
        ]),
        secretReferences: z.array(workloadSecretReferenceSchema).min(1).max(16),
      })
      .strict(),
  ],
);

export const externalResourceInterfaceV1Schema = z
  .object({
    interfaceId: externalResourceInterfaceIdSchema,
    direction: z.enum(["input", "output", "bidirectional"]),
    protocol: namespacedIdentifierSchema,
    contracts: z.array(applicationContractReferenceV1Schema).max(64),
    authentication: externalResourceAuthenticationV1Schema,
  })
  .strict();

const externalResourceIacTargetSchema = <
  TReadiness extends readonly [string, ...string[]],
>(
  readiness: TReadiness,
) =>
  z
    .object({
      target: z.enum(["terraform", "cloudformation"]),
      readiness: z.enum(readiness),
      mappingId: namespacedIdentifierSchema.optional(),
      mappingVersion: semanticVersionSchema.optional(),
    })
    .strict();

const managedIacTargetSchema = externalResourceIacTargetSchema([
  "managed-create-ready",
  "unsupported",
  "unresolved",
] as const);
const externalCloudIacTargetSchema = externalResourceIacTargetSchema([
  "reference-ready",
  "import-candidate",
  "unsupported",
  "unresolved",
] as const);
const importedIacTargetSchema = externalResourceIacTargetSchema([
  "import-ready",
  "reference-ready",
  "unsupported",
  "unresolved",
] as const);
const referenceOnlyIacTargetSchema = externalResourceIacTargetSchema([
  "reference-ready",
  "data-source-ready",
  "unsupported",
  "unresolved",
] as const);
const unresolvedIacTargetSchema = externalResourceIacTargetSchema([
  "unsupported",
  "unresolved",
] as const);

export const externalResourceLifecycleV1Schema = z.discriminatedUnion(
  "ownershipState",
  [
    z
      .object({
        ownershipState: z.literal("managed-by-generated-iac"),
        lifecycleAuthority: z.literal("cloudmarkup-generated-iac"),
        behavior: z
          .object({
            create: z.literal("generated-iac-required"),
            reference: z.literal("allowed"),
            import: z.literal("not-applicable"),
            dataSource: z.literal("optional"),
          })
          .strict(),
        iacTargets: z.array(managedIacTargetSchema).max(2),
      })
      .strict(),
    z
      .object({
        ownershipState: z.literal("existing-cloud-managed-elsewhere"),
        lifecycleAuthority: z.literal("external-owner"),
        behavior: z
          .object({
            create: z.literal("forbidden"),
            reference: z.literal("required"),
            import: z.literal("review-optional"),
            dataSource: z.literal("allowed"),
          })
          .strict(),
        iacTargets: z.array(externalCloudIacTargetSchema).max(2),
      })
      .strict(),
    z
      .object({
        ownershipState: z.literal("imported-current-iac-lifecycle"),
        lifecycleAuthority: z.literal("current-customer-iac"),
        behavior: z
          .object({
            create: z.literal("forbidden"),
            reference: z.literal("required"),
            import: z.literal("reviewed-required"),
            dataSource: z.literal("optional"),
            importAddressId: externalResourceAddressIdSchema,
          })
          .strict(),
        iacTargets: z.array(importedIacTargetSchema).max(2),
      })
      .strict(),
    z
      .object({
        ownershipState: z.literal("third-party-service-api"),
        lifecycleAuthority: z.literal("third-party-owner"),
        behavior: z
          .object({
            create: z.literal("forbidden"),
            reference: z.literal("required"),
            import: z.literal("unsupported"),
            dataSource: z.literal("allowed"),
          })
          .strict(),
        iacTargets: z.array(referenceOnlyIacTargetSchema).max(2),
      })
      .strict(),
    z
      .object({
        ownershipState: z.literal("on-premises-network-endpoint"),
        lifecycleAuthority: z.literal("external-owner"),
        behavior: z
          .object({
            create: z.literal("forbidden"),
            reference: z.literal("required"),
            import: z.literal("unsupported"),
            dataSource: z.literal("allowed"),
          })
          .strict(),
        iacTargets: z.array(referenceOnlyIacTargetSchema).max(2),
      })
      .strict(),
    z
      .object({
        ownershipState: z.literal("repository-defined-external-dependency"),
        lifecycleAuthority: z.literal("repository-owner"),
        behavior: z
          .object({
            create: z.literal("forbidden"),
            reference: z.literal("required"),
            import: z.literal("unsupported"),
            dataSource: z.literal("allowed"),
          })
          .strict(),
        iacTargets: z.array(referenceOnlyIacTargetSchema).max(2),
      })
      .strict(),
    z
      .object({
        ownershipState: z.literal("unknown-unresolved"),
        lifecycleAuthority: z.literal("unresolved"),
        behavior: z
          .object({
            create: z.literal("forbidden"),
            reference: z.literal("unresolved"),
            import: z.literal("unresolved"),
            dataSource: z.literal("unresolved"),
          })
          .strict(),
        iacTargets: z.array(unresolvedIacTargetSchema).max(2),
      })
      .strict(),
  ],
);

export const externalResourceEvidenceReferenceV1Schema = z
  .object({
    evidenceId: externalResourceEvidenceIdSchema,
    source: z.enum([
      "repository",
      "deployment",
      "plan",
      "drift",
      "user-attestation",
    ]),
    digest: sha256DigestSchema,
    observedAt: utcTimestampSchema,
  })
  .strict();

const deterministicCandidateProvenanceSchema = z
  .object({
    source: z.literal("deterministic-parser"),
    importerId: namespacedIdentifierSchema,
    importerVersion: semanticVersionSchema,
    repositorySnapshotId: boundedOpaqueIdSchema,
    sourceFileDigest: sha256DigestSchema,
    sourceLocation: z
      .object({
        startLine: z.number().int().positive(),
        endLine: z.number().int().positive(),
      })
      .strict()
      .superRefine((value, context) => {
        if (value.endLine < value.startLine) {
          context.addIssue({
            code: "custom",
            path: ["endLine"],
            message: "endLine cannot be before startLine.",
          });
        }
      })
      .optional(),
  })
  .strict();

const aiCandidateProvenanceSchema = z
  .object({
    source: z.literal("ai-extraction"),
    modelGatewayId: namespacedIdentifierSchema,
    modelId: z.string().regex(safeReferencePattern),
    promptTemplateId: namespacedIdentifierSchema,
    promptVersion: semanticVersionSchema,
    promptDigest: sha256DigestSchema,
    outputDigest: sha256DigestSchema,
  })
  .strict();

export const externalResourceCandidateValueV1Schema = z.discriminatedUnion(
  "kind",
  [
    z
      .object({
        kind: z.literal("namespaced-identifier"),
        value: namespacedIdentifierSchema,
      })
      .strict(),
    z
      .object({
        kind: z.literal("resource-address"),
        value: externalResourceAddressV1Schema,
      })
      .strict(),
    z
      .object({
        kind: z.literal("ownership-state"),
        value: externalResourceOwnershipStateV1Schema,
      })
      .strict(),
    z
      .object({
        kind: z.literal("redacted"),
        redactedLabel: z.string().min(1).max(128),
        valueDigest: sha256DigestSchema,
      })
      .strict(),
  ],
);

export const externalResourceCandidateFieldV1Schema = z
  .object({
    candidateId: externalResourceCandidateIdSchema,
    fieldPath: contractFieldPathSchema,
    candidateValue: externalResourceCandidateValueV1Schema,
    confidenceBasisPoints: z.number().int().min(0).max(10_000),
    provenance: z.discriminatedUnion("source", [
      deterministicCandidateProvenanceSchema,
      aiCandidateProvenanceSchema,
    ]),
  })
  .strict();

export const externalResourceUnresolvedInformationV1Schema = z
  .object({
    unresolvedInformationId: externalResourceUnresolvedInformationIdSchema,
    fieldPath: contractFieldPathSchema,
    summary: shortTextSchema,
    blocking: z.boolean(),
  })
  .strict();

export const externalResourceV1Schema = z
  .object({
    id: externalResourceIdSchema,
    displayName: shortTextSchema,
    capability: namespacedIdentifierSchema,
    resourceType: namespacedIdentifierSchema.optional(),
    architectureNodeIds: z.array(nodeIdSchema).max(64),
    provider: externalResourceProviderV1Schema,
    scope: externalResourceScopeV1Schema,
    addresses: z.array(externalResourceAddressV1Schema).max(32),
    lifecycle: externalResourceLifecycleV1Schema,
    interfaces: z.array(externalResourceInterfaceV1Schema).max(128),
    dataClassifications: z
      .array(
        z.enum([
          "public",
          "internal",
          "confidential",
          "restricted",
          "regulated",
        ]),
      )
      .max(8),
    trustBoundary: z.enum([
      "same-runtime",
      "same-network",
      "cross-network",
      "cross-account-or-project",
      "public-internet",
      "on-premises-boundary",
      "unknown",
    ]),
    availability: z
      .object({
        assumption: z.enum([
          "best-effort",
          "provider-published",
          "contracted",
          "user-attested",
          "unknown",
        ]),
        targetBasisPoints: z.number().int().min(0).max(10_000).optional(),
        recoveryTimeSeconds: z
          .number()
          .int()
          .nonnegative()
          .max(31_536_000)
          .optional(),
        recoveryPointSeconds: z
          .number()
          .int()
          .nonnegative()
          .max(31_536_000)
          .optional(),
      })
      .strict(),
    evidence: z.array(externalResourceEvidenceReferenceV1Schema).max(256),
    description: longTextSchema.optional(),
    extractedCandidates: z
      .array(externalResourceCandidateFieldV1Schema)
      .max(256),
    unresolvedInformation: z
      .array(externalResourceUnresolvedInformationV1Schema)
      .max(256),
  })
  .strict()
  .superRefine((resource, context) => {
    if (
      resource.lifecycle.ownershipState === "imported-current-iac-lifecycle"
    ) {
      const { importAddressId } = resource.lifecycle.behavior;
      if (
        !resource.addresses.some(
          ({ addressId }) => addressId === importAddressId,
        )
      ) {
        context.addIssue({
          code: "custom",
          path: ["lifecycle", "behavior", "importAddressId"],
          message:
            "Imported resources must reference an address declared by the resource.",
        });
      }
    }
  });

export const externalResourceReferenceDocumentV1Schema = z
  .object({
    kind: z.literal("cloudmarkup.external-resource-reference-document"),
    schemaVersion: z.literal(1),
    documentId: documentIdSchema,
    architectureId: architectureIdSchema,
    revision: z
      .object({
        revisionId: revisionIdSchema,
        revisionNumber: z.number().int().positive(),
        createdAt: utcTimestampSchema,
        createdBy: actorIdSchema,
        previousRevisionId: revisionIdSchema.optional(),
      })
      .strict(),
    resources: z.array(externalResourceV1Schema).max(2_048),
  })
  .strict();

export type ExternalResourceReferenceDocumentV1 = z.output<
  typeof externalResourceReferenceDocumentV1Schema
>;
export type ExternalResourceV1 = z.output<typeof externalResourceV1Schema>;
export type ExternalResourceReferenceV1 = z.output<
  typeof externalResourceReferenceV1Schema
>;
export type ExternalResourceLifecycleV1 = z.output<
  typeof externalResourceLifecycleV1Schema
>;
export type ExternalResourceInterfaceV1 = z.output<
  typeof externalResourceInterfaceV1Schema
>;

export function generateExternalResourceReferenceDocumentV1JsonSchema() {
  const generated = z.toJSONSchema(externalResourceReferenceDocumentV1Schema, {
    io: "input",
    target: "draft-2020-12",
  });

  return {
    ...generated,
    $id: "https://schemas.cloudmarkup.com/external-resource-reference-document/v1.schema.json",
    title: "Cloud Markup External Resource Reference Document v1",
  };
}
