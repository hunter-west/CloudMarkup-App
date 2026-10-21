import { z } from "zod";
import { architectureDocumentV3Schema } from "./architecture-document-v3.js";
import { sha256DigestSchema } from "./architecture-document-v1.js";
const key = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/u);
const settings = z.record(
  z.string().min(1).max(80),
  z.union([z.string().max(256), z.number(), z.boolean()]),
);
/** Beta suggestions are data. Only the ordinary domain command engine may apply them. */
const proposalBaseSchema = z
  .object({
    contractVersion: z.literal(1),
    summary: z.string().trim().min(1).max(1500),
    resources: z
      .array(
        z
          .object({
            key,
            serviceType: z.string().min(1).max(160),
            label: z.string().trim().min(1).max(100),
            parentKey: key.nullable(),
          })
          .strict(),
      )
      .min(1)
      .max(12),
    connections: z
      .array(
        z
          .object({
            ruleId: z.string().min(1).max(180),
            sourceKey: key,
            targetKey: key,
            configuration: settings,
          })
          .strict(),
      )
      .max(24),
    limitations: z.array(z.string().trim().min(1).max(400)).max(8),
  })
  .strict();
function validateReferences(
  value: {
    resources: { key: string; parentKey: string | null }[];
    connections: { sourceKey: string; targetKey: string }[];
    existingResources?: { key: string; nodeId: string }[];
  },
  context: z.RefinementCtx,
) {
  const existing = value.existingResources ?? [];
  const keys = new Set(
    [...value.resources, ...existing].map((resource) => resource.key),
  );
  if (
    keys.size !== value.resources.length + existing.length ||
    new Set(existing.map((r) => r.nodeId)).size !== existing.length
  )
    context.addIssue({
      code: "custom",
      message: "Resource keys and existing node references must be unique.",
    });
  const seen = new Set(existing.map((resource) => resource.key));
  for (const resource of value.resources) {
    if (resource.parentKey !== null && !seen.has(resource.parentKey))
      context.addIssue({
        code: "custom",
        message: "Parents must precede children in the proposal.",
      });
    seen.add(resource.key);
  }
  for (const connection of value.connections) {
    if (
      !keys.has(connection.sourceKey) ||
      !keys.has(connection.targetKey) ||
      connection.sourceKey === connection.targetKey
    )
      context.addIssue({
        code: "custom",
        message: "Connections must reference distinct declared resources.",
      });
  }
}
export const betaInfrastructureProposalV1Schema =
  proposalBaseSchema.superRefine(validateReferences);
/** V2 adds explicit existing-resource references; V1 keeps its add-only meaning. */
export const betaInfrastructureProposalV2Schema = proposalBaseSchema
  .extend({
    contractVersion: z.literal(2),
    resources: z
      .array(
        proposalBaseSchema.shape.resources.element.extend({
          purpose: z.string().trim().min(1).max(1500).optional(),
        }),
      )
      .max(12),
    existingResources: z
      .array(z.object({ key, nodeId: z.string().min(1).max(160) }).strict())
      .max(100),
  })
  .superRefine((value, context) => {
    validateReferences(value, context);
    if (value.resources.length === 0 && value.connections.length === 0)
      context.addIssue({
        code: "custom",
        message: "A proposal must contain an addition.",
      });
  });
/** V3 adds bounded, catalog-validated literal configuration for new resources. */
const configuredProposalSchema = proposalBaseSchema.extend({
  contractVersion: z.literal(3),
  resources: z
    .array(
      proposalBaseSchema.shape.resources.element.extend({
        purpose: z.string().trim().min(1).max(1500).optional(),
        configuration: settings.optional(),
      }),
    )
    .max(24),
  existingResources: z
    .array(z.object({ key, nodeId: z.string().min(1).max(160) }).strict())
    .max(100),
  connections: proposalBaseSchema.shape.connections.max(64),
});
export const betaInfrastructureProposalV3Schema =
  configuredProposalSchema.superRefine((value, context) => {
    validateReferences(value, context);
    if (value.resources.length === 0 && value.connections.length === 0)
      context.addIssue({
        code: "custom",
        message: "A proposal must contain an addition.",
      });
  });

/** V4 allows catalog-checked edits to explicitly referenced user-owned resources.
 * Blocking questions return without changes. Model data has no command authority. */
const reviewedProposalSchema = configuredProposalSchema.extend({
  contractVersion: z.literal(4),
  updates: z
    .array(
      z
        .object({
          resourceKey: key,
          configuration: settings,
          reason: z.string().trim().min(1).max(600),
        })
        .strict(),
    )
    .max(12),
  review: z
    .object({
      intent: z.string().trim().min(1).max(1000),
      assumptions: z.array(z.string().trim().min(1).max(400)).max(8),
      checks: z.array(z.string().trim().min(1).max(400)).max(8),
      questions: z.array(z.string().trim().min(1).max(400)).max(8),
    })
    .strict(),
});
function validateReviewedProposal(
  value: {
    resources: { key: string; parentKey: string | null }[];
    connections: { sourceKey: string; targetKey: string }[];
    existingResources: { key: string; nodeId: string }[];
    updates: { resourceKey: string; configuration: Record<string, unknown> }[];
    review: { questions: string[]; checks: string[] };
  },
  context: z.RefinementCtx,
) {
  validateReferences(value, context);
  const existing = new Set(value.existingResources.map((r) => r.key));
  if (
    new Set(value.updates.map((u) => u.resourceKey)).size !==
      value.updates.length ||
    value.updates.some(
      (u) =>
        !existing.has(u.resourceKey) ||
        Object.keys(u.configuration).length === 0 ||
        Object.keys(u.configuration).length > 32,
    )
  )
    context.addIssue({
      code: "custom",
      message:
        "Updates require unique existing resources and bounded nonempty settings.",
    });
  const changes =
    value.resources.length + value.connections.length + value.updates.length;
  if (
    changes === 0 &&
    value.review.questions.length === 0 &&
    value.review.checks.length === 0
  )
    context.addIssue({
      code: "custom",
      message:
        "A proposal requires changes, a substantive assessment or a question to resolve.",
    });
  if (value.review.questions.length > 0 && changes > 0)
    context.addIssue({
      code: "custom",
      message: "Resolve blocking questions before proposing changes.",
    });
}
export const betaInfrastructureProposalV4Schema =
  reviewedProposalSchema.superRefine(validateReviewedProposal);

/** V5 adds bounded literal string lists. Catalog constraints still govern each
 * field; released scalar-only schemas above retain their original meaning. */
const listSettings = z.record(
  z.string().min(1).max(80),
  z.union([
    z.string().max(256),
    z.number(),
    z.boolean(),
    z.array(z.string().max(256)).max(16),
  ]),
);
const listReviewedProposalSchema = reviewedProposalSchema.extend({
  contractVersion: z.literal(5),
  resources: z
    .array(
      configuredProposalSchema.shape.resources.element.extend({
        configuration: listSettings.optional(),
      }),
    )
    .max(24),
  connections: z
    .array(
      proposalBaseSchema.shape.connections.element.extend({
        configuration: listSettings,
      }),
    )
    .max(64),
  updates: z
    .array(
      reviewedProposalSchema.shape.updates.element.extend({
        configuration: listSettings,
      }),
    )
    .max(12),
});
export const betaInfrastructureProposalV5Schema =
  listReviewedProposalSchema.superRefine(validateReviewedProposal);
/** V6 expands read context only; its mutation schema has exactly V5 authority. */
export const betaInfrastructureProposalV6Schema = listReviewedProposalSchema
  .extend({ contractVersion: z.literal(6) })
  .superRefine(validateReviewedProposal);

export const betaInfrastructureProposalSchema = z.union([
  betaInfrastructureProposalV1Schema,
  betaInfrastructureProposalV2Schema,
  betaInfrastructureProposalV3Schema,
  betaInfrastructureProposalV4Schema,
  betaInfrastructureProposalV5Schema,
  betaInfrastructureProposalV6Schema,
]);
export const betaInfrastructureSelectedIssueV1Schema = z
  .object({
    code: z.string().min(1).max(128),
    affected: z
      .array(
        z
          .object({
            nodeId: z.string().min(1).max(128).optional(),
            edgeId: z.string().min(1).max(128).optional(),
            fieldPath: z.string().max(512),
          })
          .strict()
          .refine(
            (item) =>
              (item.nodeId === undefined) !== (item.edgeId === undefined),
          ),
      )
      .min(1)
      .max(20),
  })
  .strict();
export const betaProposalApplicabilityReceiptV1Schema = z
  .object({
    contractVersion: z.literal(1),
    validatorVersion: z.literal("beta-applicability-v1"),
    architectureDigest: sha256DigestSchema,
    catalogDigest: sha256DigestSchema,
    proposalDigest: sha256DigestSchema,
    resultDigest: sha256DigestSchema,
    commandDigest: sha256DigestSchema.nullable(),
    kind: z.enum(["mutation", "questions-or-assessment"]),
  })
  .strict();
export type BetaInfrastructureProposal = z.output<
  typeof betaInfrastructureProposalSchema
>;
export const createBetaInfrastructureProposalV1Schema = z
  .object({
    contractVersion: z.literal(1),
    proposalVersion: z
      .union([
        z.literal(1),
        z.literal(2),
        z.literal(3),
        z.literal(4),
        z.literal(5),
        z.literal(6),
      ])
      .optional(),
    requirements: z.string().trim().min(5).max(8000),
    architectureDocument: architectureDocumentV3Schema,
    selectedIssue: betaInfrastructureSelectedIssueV1Schema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.selectedIssue && value.proposalVersion !== 6)
      context.addIssue({
        code: "custom",
        message: "Typed selected issues require proposal version 6.",
      });
  });
export type BetaInfrastructureProposalV1 = z.output<
  typeof betaInfrastructureProposalV1Schema
>;
export type CreateBetaInfrastructureProposalV1 = z.output<
  typeof createBetaInfrastructureProposalV1Schema
>;
