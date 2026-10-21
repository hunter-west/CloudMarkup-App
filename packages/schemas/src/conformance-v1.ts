import { z } from "zod";

import {
  namespacedIdentifierSchema,
  sha256DigestSchema,
  utcTimestampSchema,
} from "./architecture-document-v1.js";
import {
  activeIssueAffectedReferenceV1Schema,
  activeIssueV1Schema,
} from "./active-issue-v1.js";
import { environmentTypeSchema } from "./intent-document-v1.js";
import {
  evidenceIdSchema,
  solutionRevisionIdSchema,
  solutionStableIdSchema,
  sourceLocationV1Schema,
  versionedToolReferenceV1Schema,
} from "./solution-contract-common-v1.js";

export const CONFORMANCE_V1_LIMITS = Object.freeze({
  differenceEvidenceReferences: 1_000,
  differenceSourceReferences: 512,
  factEvidenceReferences: 256,
  factSourceReferences: 64,
  layerEvidenceReferences: 1_000,
  layerSourceReferences: 256,
  reportEntries: 100_000,
  reportInputDigests: 1_538,
  reportSourceReferences: 1_536,
} as const);

const safeSummarySchema = z
  .string()
  .min(1)
  .max(512)
  .superRefine((value, context) => {
    let hasControlCharacter = false;
    for (const character of value) {
      const codePoint = character.codePointAt(0) ?? 0;
      hasControlCharacter ||= codePoint <= 31 || codePoint === 127;
    }
    if (value !== value.trim() || hasControlCharacter) {
      context.addIssue({
        code: "custom",
        message: "Conformance text must be trimmed single-line text.",
      });
    }
    if (
      /(?:[A-Za-z]:\\|\\\\|file:\/\/|https?:\/\/|-----BEGIN [^-]*PRIVATE KEY-----|\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|\bBearer\s+\S+|\b(?:api[_-]?key|authorization|password|secret|token)\s*[:=])/iu.test(
        value,
      )
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Conformance text cannot expose URLs, machine paths, credentials, or secret-like values.",
      });
    }
  });

export const conformanceViewLayerV1Schema = z.enum([
  "designed",
  "imported",
  "generated",
  "planned",
  "deployed",
  "current-drift",
]);

export const conformanceEvidenceTypeV1Schema = z.enum([
  "approved-documents",
  "repository-snapshot",
  "generated-manifest",
  "cloud-plan-change-set",
  "deployment-smoke-integration",
  "read-only-drift",
]);

export const conformanceEvidenceTypeByLayerV1 = Object.freeze({
  designed: "approved-documents",
  imported: "repository-snapshot",
  generated: "generated-manifest",
  planned: "cloud-plan-change-set",
  deployed: "deployment-smoke-integration",
  "current-drift": "read-only-drift",
} as const);

export const conformanceEvidenceCompletenessV1Schema = z.enum([
  "complete",
  "partial",
  "unknown",
]);

export const conformanceEvidenceFreshnessV1Schema = z.enum([
  "current",
  "stale",
  "expired",
  "invalid",
]);

export const conformanceFreshnessReasonV1Schema = z.enum([
  "source-declared-stale",
  "source-integrity-invalid",
  "source-integrity-unknown",
  "evidence-unavailable",
  "explicit-expiry-reached",
  "policy-max-age-reached",
  "policy-rule-missing",
  "explicit-expiry-required",
  "solution-revision-mismatch",
  "newer-solution-revision",
]);

const conformanceInvalidFreshnessReasonsV1 = new Set<
  z.output<typeof conformanceFreshnessReasonV1Schema>
>([
  "evidence-unavailable",
  "explicit-expiry-required",
  "newer-solution-revision",
  "policy-rule-missing",
  "solution-revision-mismatch",
  "source-integrity-invalid",
  "source-integrity-unknown",
]);

function expectedConformanceEvidenceFreshnessV1(
  reasons: readonly z.output<typeof conformanceFreshnessReasonV1Schema>[],
): z.output<typeof conformanceEvidenceFreshnessV1Schema> {
  if (
    reasons.some((reason) => conformanceInvalidFreshnessReasonsV1.has(reason))
  )
    return "invalid";
  if (reasons.includes("explicit-expiry-reached")) return "expired";
  if (
    reasons.includes("policy-max-age-reached") ||
    reasons.includes("source-declared-stale")
  )
    return "stale";
  return "current";
}

export const conformanceLayerAvailabilityV1Schema = z.enum([
  "available",
  "unavailable",
]);

export const conformanceIntegrityV1Schema = z.enum([
  "verified",
  "invalid",
  "unknown",
]);

export const conformanceStalenessRuleV1Schema = z
  .object({
    environmentType: z.union([
      environmentTypeSchema,
      z.literal("unknown"),
      z.literal("any"),
    ]),
    evidenceType: conformanceEvidenceTypeV1Schema,
    expiration: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("revision-bound") }).strict(),
      z
        .object({
          kind: z.literal("max-age"),
          maxAgeSeconds: z.number().int().positive().max(31_536_000),
        })
        .strict(),
      z.object({ kind: z.literal("explicit-expiry-required") }).strict(),
    ]),
    invalidatedByNewerRevision: z.boolean(),
  })
  .strict();

export const conformanceStalenessPolicyV1Schema = z
  .object({
    contractVersion: z.literal(1),
    policyId: namespacedIdentifierSchema,
    rules: z.array(conformanceStalenessRuleV1Schema).min(6).max(48),
  })
  .strict()
  .superRefine((value, context) => {
    const keys = new Set<string>();
    const fallbackTypes = new Set<string>();
    value.rules.forEach((rule, index) => {
      const key = `${rule.environmentType}:${rule.evidenceType}`;
      if (keys.has(key)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate conformance staleness rule ${key}.`,
          path: ["rules", index],
        });
      }
      keys.add(key);
      if (rule.environmentType === "any") {
        fallbackTypes.add(rule.evidenceType);
      }
    });
    for (const evidenceType of conformanceEvidenceTypeV1Schema.options) {
      if (!fallbackTypes.has(evidenceType)) {
        context.addIssue({
          code: "custom",
          message: `Evidence type ${evidenceType} requires one environment-independent fallback rule.`,
          path: ["rules"],
        });
      }
    }
  });

export const defaultConformanceStalenessPolicyV1 =
  conformanceStalenessPolicyV1Schema.parse({
    contractVersion: 1,
    policyId: "cloudmarkup.conformance.default-v1",
    rules: [
      {
        environmentType: "any",
        evidenceType: "approved-documents",
        expiration: { kind: "revision-bound" },
        invalidatedByNewerRevision: false,
      },
      {
        environmentType: "any",
        evidenceType: "repository-snapshot",
        expiration: { kind: "max-age", maxAgeSeconds: 86_400 },
        invalidatedByNewerRevision: false,
      },
      {
        environmentType: "any",
        evidenceType: "generated-manifest",
        expiration: { kind: "revision-bound" },
        invalidatedByNewerRevision: true,
      },
      {
        environmentType: "any",
        evidenceType: "cloud-plan-change-set",
        expiration: { kind: "explicit-expiry-required" },
        invalidatedByNewerRevision: true,
      },
      {
        environmentType: "any",
        evidenceType: "deployment-smoke-integration",
        expiration: { kind: "max-age", maxAgeSeconds: 86_400 },
        invalidatedByNewerRevision: true,
      },
      {
        environmentType: "any",
        evidenceType: "read-only-drift",
        expiration: { kind: "explicit-expiry-required" },
        invalidatedByNewerRevision: true,
      },
    ],
  });

export const conformanceMappedReferenceV1Schema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("architecture-node"),
      nodeId: solutionStableIdSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("architecture-edge"),
      edgeId: solutionStableIdSchema,
    })
    .strict(),
  z
    .object({ kind: z.literal("workload"), workloadId: solutionStableIdSchema })
    .strict(),
  z
    .object({
      externalResourceId: solutionStableIdSchema,
      kind: z.literal("external-resource"),
    })
    .strict(),
  z
    .object({ artifactId: solutionStableIdSchema, kind: z.literal("artifact") })
    .strict(),
  z
    .object({
      kind: z.literal("repository-location"),
      location: sourceLocationV1Schema,
    })
    .strict(),
]);

export const conformanceSubjectV1Schema = z
  .object({
    kind: z.enum([
      "resource",
      "connection",
      "configuration",
      "iam-policy",
      "network-exposure",
      "external-resource",
      "source-ownership",
      "application-contract",
      "artifact",
      "repository-file",
    ]),
    mappedReference: conformanceMappedReferenceV1Schema.optional(),
    stableKey: solutionStableIdSchema,
  })
  .strict();

export const conformanceDriftClassificationV1Schema = z.enum([
  "managed-drift",
  "unmanaged-resource",
  "permission-drift",
  "network-drift",
  "application-binding-drift",
  "external-resource",
  "unknown",
]);

export const conformanceSemanticComparisonBasisV1Schema = z.enum([
  "resource-intent",
  "connection-intent",
  "configuration-intent",
  "iam-policy-intent",
  "network-exposure-intent",
  "external-resource-intent",
  "source-ownership-intent",
  "application-contract-intent",
  "artifact-binding",
  "repository-file-bytes",
  "opaque",
]);

export const conformanceSemanticComparisonV1Schema = z
  .object({
    basis: conformanceSemanticComparisonBasisV1Schema,
    contractVersion: z.literal(1),
    coverage: z.enum(["complete", "partial", "operation-only"]),
  })
  .strict();

const semanticBasisBySubjectKindV1 = {
  artifact: "artifact-binding",
  "application-contract": "application-contract-intent",
  configuration: "configuration-intent",
  connection: "connection-intent",
  "external-resource": "external-resource-intent",
  "iam-policy": "iam-policy-intent",
  "network-exposure": "network-exposure-intent",
  "repository-file": "repository-file-bytes",
  resource: "resource-intent",
  "source-ownership": "source-ownership-intent",
} as const;

export const conformanceFactV1Schema = z
  .object({
    applicationBinding: z
      .enum(["matching", "mismatch", "unknown", "not-applicable"])
      .default("not-applicable"),
    applicationBindingDigest: sha256DigestSchema.optional(),
    applicationContractDigest: sha256DigestSchema.optional(),
    driftClassification: conformanceDriftClassificationV1Schema.optional(),
    evidenceIds: z
      .array(evidenceIdSchema)
      .max(CONFORMANCE_V1_LIMITS.factEvidenceReferences),
    extensionPoint: z.boolean().default(false),
    factId: solutionStableIdSchema,
    iamAccess: z
      .enum(["equivalent", "expanded", "reduced", "unknown", "not-applicable"])
      .default("not-applicable"),
    iamPermissions: z
      .array(
        z
          .object({
            actionDigest: sha256DigestSchema,
            effect: z.enum(["allow", "deny"]),
            resourceDigest: sha256DigestSchema,
          })
          .strict(),
      )
      .max(2_000)
      .default([]),
    layer: conformanceViewLayerV1Schema,
    management: z
      .enum(["managed", "external", "unmanaged", "unknown"])
      .default("managed"),
    operation: z
      .enum(["none", "create", "update", "delete", "replace", "unknown"])
      .default("none"),
    ownership: z
      .enum([
        "generated",
        "user-extension",
        "user-owned",
        "imported",
        "unmanaged",
        "unknown",
      ])
      .default("unknown"),
    publicExposure: z
      .enum(["none", "private", "public", "unknown"])
      .default("unknown"),
    repositoryFileState: z
      .enum(["matching", "generated-file-drift", "unknown"])
      .optional(),
    semanticComparison: conformanceSemanticComparisonV1Schema.default({
      basis: "opaque",
      contractVersion: 1,
      coverage: "partial",
    }),
    semanticDigest: sha256DigestSchema,
    sourceIds: z
      .array(solutionStableIdSchema)
      .min(1)
      .max(CONFORMANCE_V1_LIMITS.factSourceReferences),
    sourceLocations: z.array(sourceLocationV1Schema).max(256),
    subject: conformanceSubjectV1Schema,
  })
  .strict()
  .superRefine((value, context) => {
    const expectedBasis = semanticBasisBySubjectKindV1[value.subject.kind];
    if (
      value.semanticComparison.coverage === "complete" &&
      value.semanticComparison.basis !== expectedBasis
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Complete semantic comparison must use the versioned basis for the fact subject kind.",
        path: ["semanticComparison", "basis"],
      });
    }
    if (
      value.semanticComparison.coverage === "operation-only" &&
      value.layer !== "planned"
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Operation-only semantic comparison is valid only for planned Evidence.",
        path: ["semanticComparison", "coverage"],
      });
    }
    if (
      (value.layer === "current-drift") !==
      (value.driftClassification !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Current-drift facts require an explicit drift classification, and other layers cannot carry one.",
        path: ["driftClassification"],
      });
    }
    if (
      value.repositoryFileState !== undefined &&
      (value.layer !== "imported" || value.subject.kind !== "repository-file")
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Repository file state is valid only for imported repository-file facts.",
        path: ["repositoryFileState"],
      });
    }
    if (value.extensionPoint && value.ownership !== "user-extension") {
      context.addIssue({
        code: "custom",
        message: "Only user-extension facts may be approved extension points.",
        path: ["extensionPoint"],
      });
    }
    if (
      value.operation !== "none" &&
      value.layer !== "planned" &&
      value.layer !== "current-drift"
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Only planned or current-drift facts may carry change actions.",
        path: ["operation"],
      });
    }
    if (value.operation === "unknown" && value.layer !== "current-drift") {
      context.addIssue({
        code: "custom",
        message: "Only current-drift facts may have an unknown change action.",
        path: ["operation"],
      });
    }
    const permissionKeys = value.iamPermissions.map(
      (permission) =>
        `${permission.effect}:${permission.actionDigest}:${permission.resourceDigest}`,
    );
    if (new Set(permissionKeys).size !== permissionKeys.length) {
      context.addIssue({
        code: "custom",
        message: "IAM permission facts must be unique.",
        path: ["iamPermissions"],
      });
    }
  });

export const conformanceProvenanceSourceV1Schema = z
  .object({
    digest: sha256DigestSchema,
    kind: z.enum([
      "architecture-document",
      "workload-document",
      "external-resource-document",
      "repository-snapshot",
      "generated-manifest",
      "terraform-plan",
      "cloudformation-change-set",
      "deployment-attestation",
      "smoke-integration-result",
      "read-only-drift-result",
    ]),
    observedAt: utcTimestampSchema,
    repositoryCommit: z
      .string()
      .regex(/^[a-f0-9]{40}$/)
      .optional(),
    solutionRevisionId: solutionRevisionIdSchema,
    sourceId: solutionStableIdSchema,
    tool: versionedToolReferenceV1Schema.optional(),
  })
  .strict();

function isConformanceSourceKindForLayer(
  layer: z.output<typeof conformanceViewLayerV1Schema>,
  kind: z.output<typeof conformanceProvenanceSourceV1Schema>["kind"],
): boolean {
  switch (layer) {
    case "designed":
      return (
        kind === "architecture-document" ||
        kind === "workload-document" ||
        kind === "external-resource-document"
      );
    case "imported":
      return kind === "repository-snapshot";
    case "generated":
      return kind === "generated-manifest";
    case "planned":
      return kind === "terraform-plan" || kind === "cloudformation-change-set";
    case "deployed":
      return (
        kind === "deployment-attestation" || kind === "smoke-integration-result"
      );
    case "current-drift":
      return kind === "read-only-drift-result";
  }
}

export const conformanceLayerInputV1Schema = z
  .object({
    availability: conformanceLayerAvailabilityV1Schema,
    boundSolutionRevision: z
      .object({ digest: sha256DigestSchema, id: solutionRevisionIdSchema })
      .strict()
      .optional(),
    completeness: conformanceEvidenceCompletenessV1Schema,
    declaredFreshness: z.enum(["current", "stale"]).default("current"),
    evidenceIds: z
      .array(evidenceIdSchema)
      .max(CONFORMANCE_V1_LIMITS.layerEvidenceReferences),
    evidenceType: conformanceEvidenceTypeV1Schema,
    environmentId: solutionStableIdSchema.optional(),
    explicitExpiresAt: utcTimestampSchema.optional(),
    facts: z.array(conformanceFactV1Schema).max(50_000),
    integrity: conformanceIntegrityV1Schema,
    invalidReason: safeSummarySchema.optional(),
    layer: conformanceViewLayerV1Schema,
    sources: z
      .array(conformanceProvenanceSourceV1Schema)
      .max(CONFORMANCE_V1_LIMITS.layerSourceReferences),
    verifiedAt: utcTimestampSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const environmentBound =
      value.layer === "planned" ||
      value.layer === "deployed" ||
      value.layer === "current-drift";
    if (environmentBound !== (value.environmentId !== undefined)) {
      context.addIssue({
        code: "custom",
        message:
          "Planned, deployed, and current-drift layers require an environment binding; source layers cannot claim one.",
        path: ["environmentId"],
      });
    }
    if (
      value.availability === "unavailable" &&
      (value.facts.length > 0 ||
        value.evidenceIds.length > 0 ||
        value.sources.length > 0)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "An unavailable layer cannot claim facts, Evidence, or provenance sources.",
        path: ["availability"],
      });
    }
    if (
      value.availability === "unavailable" &&
      (value.completeness !== "unknown" ||
        value.boundSolutionRevision !== undefined ||
        value.verifiedAt !== undefined ||
        value.explicitExpiresAt !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Unavailable evidence must remain unknown and cannot claim revision or time validity.",
        path: ["availability"],
      });
    }
    if (
      value.availability === "available" &&
      (value.boundSolutionRevision === undefined ||
        value.verifiedAt === undefined ||
        value.sources.length === 0)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Available evidence requires exact revision binding, verification time, and provenance.",
        path: ["availability"],
      });
    }
    if (value.integrity === "invalid" && value.invalidReason === undefined) {
      context.addIssue({
        code: "custom",
        message: "Invalid evidence requires a redacted reason.",
        path: ["invalidReason"],
      });
    }
    if (value.integrity !== "invalid" && value.invalidReason !== undefined) {
      context.addIssue({
        code: "custom",
        message: "Only invalid evidence may include an invalid reason.",
        path: ["invalidReason"],
      });
    }
    const sourceIds = new Set<string>();
    value.sources.forEach((source, index) => {
      if (!isConformanceSourceKindForLayer(value.layer, source.kind)) {
        context.addIssue({
          code: "custom",
          message:
            "A provenance source kind is not valid for its conformance layer.",
          path: ["sources", index, "kind"],
        });
      }
      if (sourceIds.has(source.sourceId)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate conformance source ${source.sourceId}.`,
          path: ["sources", index, "sourceId"],
        });
      }
      sourceIds.add(source.sourceId);
      if (
        value.boundSolutionRevision !== undefined &&
        source.solutionRevisionId !== value.boundSolutionRevision.id
      ) {
        context.addIssue({
          code: "custom",
          message: "Every source must bind the layer Solution Revision.",
          path: ["sources", index, "solutionRevisionId"],
        });
      }
    });
    const evidenceIds = new Set(value.evidenceIds);
    const factKeys = new Set<string>();
    const factIds = new Set<string>();
    value.facts.forEach((fact, index) => {
      if (fact.layer !== value.layer) {
        context.addIssue({
          code: "custom",
          message: "Every fact must name its containing layer.",
          path: ["facts", index, "layer"],
        });
      }
      if (factIds.has(fact.factId)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate conformance fact ID ${fact.factId}.`,
          path: ["facts", index, "factId"],
        });
      }
      factIds.add(fact.factId);
      const factKey = `${fact.subject.kind}:${fact.subject.stableKey}`;
      if (factKeys.has(factKey)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate conformance fact subject ${factKey}.`,
          path: ["facts", index, "subject"],
        });
      }
      factKeys.add(factKey);
      fact.sourceIds.forEach((sourceId) => {
        if (!sourceIds.has(sourceId)) {
          context.addIssue({
            code: "custom",
            message: `Fact references unknown source ${sourceId}.`,
            path: ["facts", index, "sourceIds"],
          });
        }
      });
      fact.evidenceIds.forEach((evidenceId) => {
        if (!evidenceIds.has(evidenceId)) {
          context.addIssue({
            code: "custom",
            message: `Fact references unknown Evidence ${evidenceId}.`,
            path: ["facts", index, "evidenceIds"],
          });
        }
      });
    });
  });

export const conformanceEvaluationRequestV1Schema = z
  .object({
    contractVersion: z.literal(1),
    currentSolutionRevision: z
      .object({ digest: sha256DigestSchema, id: solutionRevisionIdSchema })
      .strict(),
    environment: z
      .object({
        environmentId: solutionStableIdSchema,
        environmentType: z.union([environmentTypeSchema, z.literal("unknown")]),
      })
      .strict(),
    evaluatedAt: utcTimestampSchema,
    evaluatedSolutionRevision: z
      .object({ digest: sha256DigestSchema, id: solutionRevisionIdSchema })
      .strict(),
    evaluator: versionedToolReferenceV1Schema,
    layers: z.array(conformanceLayerInputV1Schema).length(6),
    projectId: solutionStableIdSchema,
    stalenessPolicy: conformanceStalenessPolicyV1Schema,
  })
  .strict()
  .superRefine((value, context) => {
    const seen = new Set<string>();
    const sourceIds = new Set<string>();
    const evidenceIds = new Set<string>();
    value.layers.forEach((layer, index) => {
      if (seen.has(layer.layer)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate conformance layer ${layer.layer}.`,
          path: ["layers", index, "layer"],
        });
      }
      seen.add(layer.layer);
      layer.sources.forEach((source, sourceIndex) => {
        if (sourceIds.has(source.sourceId)) {
          context.addIssue({
            code: "custom",
            message: "A conformance source cannot be reused across layers.",
            path: ["layers", index, "sources", sourceIndex, "sourceId"],
          });
        }
        sourceIds.add(source.sourceId);
      });
      layer.evidenceIds.forEach((evidenceId, evidenceIndex) => {
        if (evidenceIds.has(evidenceId)) {
          context.addIssue({
            code: "custom",
            message: "Evidence cannot be reused across conformance layers.",
            path: ["layers", index, "evidenceIds", evidenceIndex],
          });
        }
        evidenceIds.add(evidenceId);
      });
      if (
        conformanceEvidenceTypeByLayerV1[layer.layer] !== layer.evidenceType
      ) {
        context.addIssue({
          code: "custom",
          message: `Layer ${layer.layer} has the wrong evidence type.`,
          path: ["layers", index, "evidenceType"],
        });
      }
      if (
        layer.environmentId !== undefined &&
        layer.environmentId !== value.environment.environmentId
      ) {
        context.addIssue({
          code: "custom",
          message: `Layer ${layer.layer} is bound to a different environment.`,
          path: ["layers", index, "environmentId"],
        });
      }
    });
  });

export const conformanceDifferenceKindV1Schema = z.enum([
  "matching-resource",
  "matching-connection",
  "matching-configuration",
  "resource-mismatch",
  "designed-missing-from-repository",
  "designed-missing-from-plan",
  "designed-missing-from-deployment",
  "observed-but-not-designed",
  "configuration-mismatch",
  "connection-mismatch",
  "generated-drift-from-source",
  "plan-create",
  "plan-update",
  "plan-delete",
  "plan-replace",
  "iam-expansion",
  "iam-reduction",
  "network-public-exposure-change",
  "external-unmanaged-resource",
  "ownership-import-mismatch",
  "application-contract-binding-mismatch",
  "stale-evidence",
  "expired-evidence",
  "partial-evidence",
  "unknown-evidence",
  "invalid-evidence",
  "managed-drift",
  "unmanaged-resource-drift",
  "permission-drift",
  "network-drift",
  "application-binding-drift",
  "unknown-drift",
]);

export const conformanceDifferenceV1Schema = z
  .object({
    comparedWithLayer: conformanceViewLayerV1Schema.optional(),
    differenceDigest: sha256DigestSchema,
    differenceId: solutionStableIdSchema,
    environmentId: solutionStableIdSchema,
    evidenceIds: z
      .array(evidenceIdSchema)
      .max(CONFORMANCE_V1_LIMITS.differenceEvidenceReferences),
    kind: conformanceDifferenceKindV1Schema,
    layer: conformanceViewLayerV1Schema,
    leftFactId: solutionStableIdSchema.optional(),
    remediation: z
      .object({
        automatic: z.literal(false),
        disposition: z.enum(["none", "review-required"]),
      })
      .strict(),
    rightFactId: solutionStableIdSchema.optional(),
    severity: z.enum(["information", "warning", "error", "security-error"]),
    solutionRevisionId: solutionRevisionIdSchema,
    sourceIds: z
      .array(solutionStableIdSchema)
      .max(CONFORMANCE_V1_LIMITS.differenceSourceReferences),
    subject: conformanceSubjectV1Schema.optional(),
    summary: safeSummarySchema,
  })
  .strict()
  .superRefine((value, context) => {
    const matching = value.kind.startsWith("matching-");
    if (
      matching &&
      (value.severity !== "information" ||
        value.remediation.disposition !== "none")
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Matching differences are informational and require no review.",
        path: ["remediation"],
      });
    }
    if (!matching && value.remediation.disposition !== "review-required") {
      context.addIssue({
        code: "custom",
        message: "Every non-matching difference requires review.",
        path: ["remediation", "disposition"],
      });
    }
  });

export const conformanceLayerResultV1Schema = z
  .object({
    authority: z.enum(["approved-design", "evidence-only"]),
    availability: conformanceLayerAvailabilityV1Schema,
    boundSolutionRevision: z
      .object({ digest: sha256DigestSchema, id: solutionRevisionIdSchema })
      .strict()
      .optional(),
    evidenceIds: z
      .array(evidenceIdSchema)
      .max(CONFORMANCE_V1_LIMITS.layerEvidenceReferences),
    evidenceType: conformanceEvidenceTypeV1Schema,
    environmentId: solutionStableIdSchema.optional(),
    facts: z.array(conformanceFactV1Schema).max(50_000),
    layer: conformanceViewLayerV1Schema,
    quality: z
      .object({
        completeness: conformanceEvidenceCompletenessV1Schema,
        expiresAt: utcTimestampSchema.optional(),
        freshness: conformanceEvidenceFreshnessV1Schema,
        freshnessReasons: z.array(conformanceFreshnessReasonV1Schema).max(16),
        lastVerifiedAt: utcTimestampSchema.optional(),
      })
      .strict(),
    sources: z
      .array(conformanceProvenanceSourceV1Schema)
      .max(CONFORMANCE_V1_LIMITS.layerSourceReferences),
  })
  .strict()
  .superRefine((value, context) => {
    const environmentBound =
      value.layer === "planned" ||
      value.layer === "deployed" ||
      value.layer === "current-drift";
    if (environmentBound !== (value.environmentId !== undefined)) {
      context.addIssue({
        code: "custom",
        message:
          "Planned, deployed, and current-drift results require an environment binding; source results cannot claim one.",
        path: ["environmentId"],
      });
    }
    if (conformanceEvidenceTypeByLayerV1[value.layer] !== value.evidenceType) {
      context.addIssue({
        code: "custom",
        message: "A result layer has the wrong evidence type.",
        path: ["evidenceType"],
      });
    }
    if (
      (value.layer === "designed") !==
      (value.authority === "approved-design")
    ) {
      context.addIssue({
        code: "custom",
        message: "Only the designed layer is approved design authority.",
        path: ["authority"],
      });
    }
    if (
      value.availability === "unavailable" &&
      (value.facts.length > 0 ||
        value.evidenceIds.length > 0 ||
        value.sources.length > 0)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "An unavailable result cannot claim facts, Evidence, or provenance sources.",
        path: ["availability"],
      });
    }
    if (
      value.availability === "unavailable" &&
      (value.quality.completeness !== "unknown" ||
        value.boundSolutionRevision !== undefined ||
        value.quality.lastVerifiedAt !== undefined ||
        value.quality.expiresAt !== undefined ||
        value.quality.freshness !== "invalid" ||
        value.quality.freshnessReasons.length !== 1 ||
        value.quality.freshnessReasons[0] !== "evidence-unavailable")
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Unavailable results must remain unknown, invalid, unbound, and carry only the evidence-unavailable reason.",
        path: ["availability"],
      });
    }
    if (
      value.availability === "available" &&
      (value.boundSolutionRevision === undefined ||
        value.quality.lastVerifiedAt === undefined ||
        value.sources.length === 0 ||
        value.quality.freshnessReasons.includes("evidence-unavailable"))
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Available results require exact revision binding, verification time, provenance, and cannot claim evidence unavailability.",
        path: ["availability"],
      });
    }
    if (
      value.quality.freshness !==
      expectedConformanceEvidenceFreshnessV1(value.quality.freshnessReasons)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Evidence freshness must follow invalid, expired, stale, then current reason precedence.",
        path: ["quality", "freshness"],
      });
    }
    const sourceIds = new Set<string>();
    value.sources.forEach((source, index) => {
      if (!isConformanceSourceKindForLayer(value.layer, source.kind)) {
        context.addIssue({
          code: "custom",
          message:
            "A provenance source kind is not valid for its conformance layer.",
          path: ["sources", index, "kind"],
        });
      }
      if (sourceIds.has(source.sourceId)) {
        context.addIssue({
          code: "custom",
          message: "A conformance result cannot contain duplicate sources.",
          path: ["sources", index, "sourceId"],
        });
      }
      sourceIds.add(source.sourceId);
      if (
        value.boundSolutionRevision !== undefined &&
        source.solutionRevisionId !== value.boundSolutionRevision.id
      ) {
        context.addIssue({
          code: "custom",
          message: "Every source must bind the result Solution Revision.",
          path: ["sources", index, "solutionRevisionId"],
        });
      }
    });
    const evidenceIds = new Set<string>();
    value.evidenceIds.forEach((evidenceId, index) => {
      if (evidenceIds.has(evidenceId)) {
        context.addIssue({
          code: "custom",
          message: "A conformance result cannot contain duplicate Evidence.",
          path: ["evidenceIds", index],
        });
      }
      evidenceIds.add(evidenceId);
    });
    const factIds = new Set<string>();
    const factSubjects = new Set<string>();
    value.facts.forEach((fact, index) => {
      if (fact.layer !== value.layer) {
        context.addIssue({
          code: "custom",
          message: "Every fact must name its containing result layer.",
          path: ["facts", index, "layer"],
        });
      }
      if (factIds.has(fact.factId)) {
        context.addIssue({
          code: "custom",
          message: "A conformance result cannot contain duplicate fact IDs.",
          path: ["facts", index, "factId"],
        });
      }
      factIds.add(fact.factId);
      const subjectKey = fact.subject.kind + ":" + fact.subject.stableKey;
      if (factSubjects.has(subjectKey)) {
        context.addIssue({
          code: "custom",
          message:
            "A conformance result cannot contain duplicate fact subjects.",
          path: ["facts", index, "subject"],
        });
      }
      factSubjects.add(subjectKey);
      fact.sourceIds.forEach((sourceId) => {
        if (!sourceIds.has(sourceId)) {
          context.addIssue({
            code: "custom",
            message: "A fact references an unknown result source.",
            path: ["facts", index, "sourceIds"],
          });
        }
      });
      fact.evidenceIds.forEach((evidenceId) => {
        if (!evidenceIds.has(evidenceId)) {
          context.addIssue({
            code: "custom",
            message: "A fact references unknown result Evidence.",
            path: ["facts", index, "evidenceIds"],
          });
        }
      });
    });
  });

function compareConformanceStrings(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function uniqueSortedConformanceStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareConformanceStrings);
}

function sameConformanceStrings(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}
function sameConformanceSubject(
  left: z.output<typeof conformanceSubjectV1Schema>,
  right: z.output<typeof conformanceSubjectV1Schema>,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameConformanceSubjectIdentity(
  left: z.output<typeof conformanceSubjectV1Schema>,
  right: z.output<typeof conformanceSubjectV1Schema>,
): boolean {
  return left.kind === right.kind && left.stableKey === right.stableKey;
}

function conformanceIssueSourceForLayer(
  layer: z.output<typeof conformanceViewLayerV1Schema>,
): z.output<typeof activeIssueV1Schema>["source"] {
  return layer === "imported"
    ? "repository-import-mismatch"
    : layer === "planned"
      ? "cloud-plan-change-set"
      : layer === "deployed"
        ? "deployment-smoke-integration"
        : layer === "current-drift"
          ? "deployed-drift"
          : layer === "generated"
            ? "compiler-parser-diagnostic"
            : "provider-architecture-validation";
}

function conformanceIssueSeverityForDifference(
  severity: z.output<typeof conformanceDifferenceV1Schema>["severity"],
): z.output<typeof activeIssueV1Schema>["severity"] {
  return severity === "security-error"
    ? "security-error"
    : severity === "error"
      ? "error"
      : severity === "information"
        ? "recommendation"
        : "warning";
}

function conformanceAffectedReferenceKey(
  reference: z.output<typeof activeIssueV1Schema>["affected"][number],
): string {
  return JSON.stringify(reference);
}

export const conformanceReportV1Schema = z
  .object({
    comparisonAuthority: z.literal("non-mutating-multi-layer"),
    contractVersion: z.literal(1),
    currentSolutionRevision: z
      .object({ digest: sha256DigestSchema, id: solutionRevisionIdSchema })
      .strict(),
    differences: z
      .array(conformanceDifferenceV1Schema)
      .max(CONFORMANCE_V1_LIMITS.reportEntries),
    environment: z
      .object({
        environmentId: solutionStableIdSchema,
        environmentType: z.union([environmentTypeSchema, z.literal("unknown")]),
      })
      .strict(),
    evaluatedAt: utcTimestampSchema,
    evaluatedSolutionRevision: z
      .object({ digest: sha256DigestSchema, id: solutionRevisionIdSchema })
      .strict(),
    evaluator: versionedToolReferenceV1Schema,
    issues: z
      .array(activeIssueV1Schema)
      .max(CONFORMANCE_V1_LIMITS.reportEntries),
    kind: z.literal("cloudmarkup.continuous-conformance-report"),
    layers: z.array(conformanceLayerResultV1Schema).length(6),
    mutationPolicy: z.literal("review-only-no-auto-remediation"),
    projectId: solutionStableIdSchema,
    provenance: z
      .object({
        inputDigests: z
          .array(sha256DigestSchema)
          .max(CONFORMANCE_V1_LIMITS.reportInputDigests),
        sourceIds: z
          .array(solutionStableIdSchema)
          .max(CONFORMANCE_V1_LIMITS.reportSourceReferences),
      })
      .strict(),
    reportDigest: sha256DigestSchema,
    reportId: solutionStableIdSchema,
    stalenessPolicy: z
      .object({ digest: sha256DigestSchema, id: namespacedIdentifierSchema })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    const expectedLayerOrder = conformanceViewLayerV1Schema.options;
    if (
      new Set(value.layers.map(({ layer }) => layer)).size !== 6 ||
      !value.layers.every(
        ({ layer }, index) => layer === expectedLayerOrder[index],
      )
    ) {
      context.addIssue({
        code: "custom",
        message:
          "A conformance report requires every distinct view layer in canonical order.",
        path: ["layers"],
      });
    }
    const layers = new Map(
      value.layers.map((layer) => [layer.layer, layer] as const),
    );
    const allSourceIds = new Set<string>();
    const allEvidenceIds = new Set<string>();
    value.layers.forEach((layer, layerIndex) => {
      if (
        layer.environmentId !== undefined &&
        layer.environmentId !== value.environment.environmentId
      ) {
        context.addIssue({
          code: "custom",
          message: "A result layer is bound to a different report environment.",
          path: ["layers", layerIndex, "environmentId"],
        });
      }
      if (layer.availability === "available") {
        const revisionMatches =
          layer.boundSolutionRevision?.id ===
            value.evaluatedSolutionRevision.id &&
          layer.boundSolutionRevision.digest ===
            value.evaluatedSolutionRevision.digest;
        const reportsRevisionMismatch =
          layer.quality.freshness === "invalid" &&
          layer.quality.freshnessReasons.includes("solution-revision-mismatch");
        if (revisionMatches === reportsRevisionMismatch) {
          context.addIssue({
            code: "custom",
            message:
              "Layer revision binding and revision-mismatch quality must agree.",
            path: ["layers", layerIndex, "quality"],
          });
        }
      }
      if (
        layer.availability === "available" &&
        layer.quality.lastVerifiedAt !== undefined
      ) {
        const evaluatedAt = Date.parse(value.evaluatedAt);
        const lastVerifiedAt = Date.parse(layer.quality.lastVerifiedAt);
        if (
          lastVerifiedAt > evaluatedAt ||
          layer.sources.some(
            (source) => Date.parse(source.observedAt) > lastVerifiedAt,
          )
        ) {
          context.addIssue({
            code: "custom",
            message:
              "Available result sources must be observed no later than verification, and verification cannot follow evaluation.",
            path: ["layers", layerIndex, "quality", "lastVerifiedAt"],
          });
        }
        if (layer.quality.expiresAt !== undefined) {
          const expiresAt = Date.parse(layer.quality.expiresAt);
          const expiryReached = expiresAt <= evaluatedAt;
          const expiryReachedReason =
            layer.quality.freshnessReasons.includes(
              "explicit-expiry-reached",
            ) ||
            layer.quality.freshnessReasons.includes("policy-max-age-reached");
          if (
            layer.sources.some(
              (source) => expiresAt <= Date.parse(source.observedAt),
            ) ||
            expiryReached !== expiryReachedReason
          ) {
            context.addIssue({
              code: "custom",
              message:
                "Result expiry must follow source observation and agree with evaluation-time expiry reasons.",
              path: ["layers", layerIndex, "quality", "expiresAt"],
            });
          }
        } else if (
          layer.quality.freshnessReasons.includes("explicit-expiry-reached") ||
          layer.quality.freshnessReasons.includes("policy-max-age-reached")
        ) {
          context.addIssue({
            code: "custom",
            message: "Expiry-reached evidence requires an exact expiry time.",
            path: ["layers", layerIndex, "quality", "expiresAt"],
          });
        }
      }
      layer.sources.forEach((source, sourceIndex) => {
        if (allSourceIds.has(source.sourceId)) {
          context.addIssue({
            code: "custom",
            message:
              "A conformance source cannot be reused across report layers.",
            path: ["layers", layerIndex, "sources", sourceIndex, "sourceId"],
          });
        }
        allSourceIds.add(source.sourceId);
      });
      layer.evidenceIds.forEach((evidenceId, evidenceIndex) => {
        if (allEvidenceIds.has(evidenceId)) {
          context.addIssue({
            code: "custom",
            message: "Evidence cannot be reused across report layers.",
            path: ["layers", layerIndex, "evidenceIds", evidenceIndex],
          });
        }
        allEvidenceIds.add(evidenceId);
      });
    });
    const expectedSourceIds = uniqueSortedConformanceStrings(
      value.layers.flatMap((layer) =>
        layer.sources.map((source) => source.sourceId),
      ),
    );
    const expectedInputDigests = uniqueSortedConformanceStrings([
      value.currentSolutionRevision.digest,
      value.evaluatedSolutionRevision.digest,
      ...value.layers.flatMap((layer) =>
        layer.sources.map((source) => source.digest),
      ),
    ]);
    if (
      !sameConformanceStrings(value.provenance.sourceIds, expectedSourceIds) ||
      !sameConformanceStrings(
        value.provenance.inputDigests,
        expectedInputDigests,
      )
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Report provenance must exactly and canonically bind every layer source and input digest.",
        path: ["provenance"],
      });
    }
    const differenceIds = new Set<string>();
    const differenceDigests = new Set<string>();
    const nonMatchingDifferenceIds = new Set<string>();
    value.differences.forEach((difference, index) => {
      if (
        difference.solutionRevisionId !== value.evaluatedSolutionRevision.id ||
        difference.environmentId !== value.environment.environmentId
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Every difference must bind the report revision and environment.",
          path: ["differences", index],
        });
      }
      if (
        differenceIds.has(difference.differenceId) ||
        differenceDigests.has(difference.differenceDigest)
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Conformance difference identities and digests must be unique.",
          path: ["differences", index],
        });
      }
      differenceIds.add(difference.differenceId);
      differenceDigests.add(difference.differenceDigest);
      if (!difference.kind.startsWith("matching-")) {
        nonMatchingDifferenceIds.add(difference.differenceId);
      }
      const relatedLayers = [
        layers.get(difference.layer),
        difference.comparedWithLayer === undefined
          ? undefined
          : layers.get(difference.comparedWithLayer),
      ].filter(
        (layer): layer is z.output<typeof conformanceLayerResultV1Schema> =>
          layer !== undefined,
      );
      const relatedSourceIds = new Set(
        relatedLayers.flatMap((layer) =>
          layer.sources.map((source) => source.sourceId),
        ),
      );
      const relatedEvidenceIds = new Set(
        relatedLayers.flatMap((layer) => layer.evidenceIds),
      );
      if (
        difference.sourceIds.some(
          (sourceId) => !relatedSourceIds.has(sourceId),
        ) ||
        difference.evidenceIds.some(
          (evidenceId) => !relatedEvidenceIds.has(evidenceId),
        )
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Every difference source and Evidence reference must belong to its related report layers.",
          path: ["differences", index],
        });
      }
      const relatedFacts = relatedLayers.flatMap((layer) => layer.facts);
      const differenceSubject = difference.subject;
      const referencedFacts = [
        ["leftFactId", difference.leftFactId],
        ["rightFactId", difference.rightFactId],
      ] as const;
      referencedFacts.forEach(([field, factId]) => {
        if (factId === undefined) return;
        const resolvedFacts = relatedFacts.filter(
          (fact) => fact.factId === factId,
        );
        if (resolvedFacts.length === 0) {
          context.addIssue({
            code: "custom",
            message:
              "Every difference fact reference must resolve in its related report layers.",
            path: ["differences", index, field],
          });
        } else if (
          differenceSubject !== undefined &&
          !resolvedFacts.some((fact) =>
            sameConformanceSubjectIdentity(fact.subject, differenceSubject),
          )
        ) {
          context.addIssue({
            code: "custom",
            message:
              "A referenced difference fact must resolve to the difference subject identity.",
            path: ["differences", index, field],
          });
        }
      });
      if (
        differenceSubject !== undefined &&
        !relatedFacts.some((fact) =>
          sameConformanceSubject(fact.subject, differenceSubject),
        )
      ) {
        context.addIssue({
          code: "custom",
          message:
            "A difference subject must resolve exactly to a fact in its related report layers.",
          path: ["differences", index, "subject"],
        });
      }
    });
    const issueIds = new Set<string>();
    const issueSourceRecordIds = new Set<string>();
    value.issues.forEach((issue, index) => {
      if (
        issue.solutionRevisionId !== value.evaluatedSolutionRevision.id ||
        issue.deterministicFix !== undefined ||
        issue.aiProposedFix !== undefined
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Conformance issues must bind the report revision and cannot auto-remediate.",
          path: ["issues", index],
        });
      }
      if (issueIds.has(issue.id)) {
        context.addIssue({
          code: "custom",
          message: "Conformance issue identities must be unique.",
          path: ["issues", index, "id"],
        });
      }
      issueIds.add(issue.id);
      if (
        !nonMatchingDifferenceIds.has(issue.sourceRecordId) ||
        issueSourceRecordIds.has(issue.sourceRecordId)
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Every conformance issue must uniquely bind one non-matching difference.",
          path: ["issues", index, "sourceRecordId"],
        });
      }
      issueSourceRecordIds.add(issue.sourceRecordId);
      const sourceDifference = value.differences.find(
        (difference) => difference.differenceId === issue.sourceRecordId,
      );
      if (sourceDifference === undefined) return;
      if (
        issue.lifecycle.state !== "current" ||
        issue.source !==
          conformanceIssueSourceForLayer(sourceDifference.layer) ||
        issue.severity !==
          conformanceIssueSeverityForDifference(sourceDifference.severity) ||
        issue.summary !== sourceDifference.summary
      ) {
        context.addIssue({
          code: "custom",
          message:
            "A current conformance issue must retain its evaluator-derived lifecycle, source, severity, and summary.",
          path: ["issues", index],
        });
      }
      const expectedAffected: z.output<typeof activeIssueV1Schema>["affected"] =
        [
          {
            kind: "solution-revision",
            solutionRevisionId: value.evaluatedSolutionRevision.id,
          },
        ];
      if (sourceDifference.subject?.mappedReference !== undefined) {
        expectedAffected.push(
          activeIssueAffectedReferenceV1Schema.parse(
            sourceDifference.subject.mappedReference,
          ),
        );
      }
      if (
        sourceDifference.layer === "planned" ||
        sourceDifference.layer === "deployed" ||
        sourceDifference.layer === "current-drift"
      ) {
        expectedAffected.push({
          environmentId: value.environment.environmentId,
          kind: "environment",
        });
      }
      sourceDifference.evidenceIds.forEach((evidenceId) => {
        expectedAffected.push({ evidenceId, kind: "evidence" });
      });
      const actualAffectedKeys = uniqueSortedConformanceStrings(
        issue.affected.map(conformanceAffectedReferenceKey),
      );
      const expectedAffectedKeys = uniqueSortedConformanceStrings(
        expectedAffected.map(conformanceAffectedReferenceKey),
      );
      if (
        actualAffectedKeys.length !== issue.affected.length ||
        !sameConformanceStrings(actualAffectedKeys, expectedAffectedKeys)
      ) {
        context.addIssue({
          code: "custom",
          message:
            "A conformance issue must exactly bind the report revision, mapped subject, difference Evidence, and relevant environment.",
          path: ["issues", index, "affected"],
        });
      }
    });
    if (
      issueSourceRecordIds.size !== nonMatchingDifferenceIds.size ||
      [...nonMatchingDifferenceIds].some(
        (differenceId) => !issueSourceRecordIds.has(differenceId),
      )
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Conformance issues must cover every non-matching difference exactly once.",
        path: ["issues"],
      });
    }
  });

export type ConformanceDifferenceV1 = z.output<
  typeof conformanceDifferenceV1Schema
>;
export type ConformanceEvaluationRequestV1 = z.output<
  typeof conformanceEvaluationRequestV1Schema
>;
export type ConformanceFactV1 = z.output<typeof conformanceFactV1Schema>;
export type ConformanceSemanticComparisonV1 = z.output<
  typeof conformanceSemanticComparisonV1Schema
>;
export type ConformanceLayerInputV1 = z.output<
  typeof conformanceLayerInputV1Schema
>;
export type ConformanceReportV1 = z.output<typeof conformanceReportV1Schema>;
export type ConformanceStalenessPolicyV1 = z.output<
  typeof conformanceStalenessPolicyV1Schema
>;
export type ConformanceViewLayerV1 = z.output<
  typeof conformanceViewLayerV1Schema
>;
