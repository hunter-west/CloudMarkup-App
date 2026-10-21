import { z } from "zod";

import {
  actorIdSchema,
  namespacedIdentifierSchema,
  semanticVersionSchema,
  sha256DigestSchema,
  utcTimestampSchema,
} from "./architecture-document-v1.js";

const opaqueIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const geographyIdentifierPattern =
  /^(?:global|[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+)$/;
const currencyCodePattern = /^[A-Z]{3}$/;

const shortTextSchema = z.string().min(1).max(512);
const longTextSchema = z.string().min(1).max(8_000);
const opaqueIntentIdSchema = z
  .string()
  .regex(opaqueIdPattern, "Must be a stable opaque identifier.");

export const intentDocumentIdSchema =
  opaqueIntentIdSchema.brand<"IntentDocumentId">();
export const intentIdSchema = opaqueIntentIdSchema.brand<"IntentId">();
export const intentRevisionIdSchema =
  opaqueIntentIdSchema.brand<"IntentRevisionId">();
export const capabilityRequirementIdSchema =
  opaqueIntentIdSchema.brand<"CapabilityRequirementId">();
export const connectivityRequirementIdSchema =
  opaqueIntentIdSchema.brand<"ConnectivityRequirementId">();
export const dataCategoryIdSchema =
  opaqueIntentIdSchema.brand<"DataCategoryId">();
export const workflowRequirementIdSchema =
  opaqueIntentIdSchema.brand<"WorkflowRequirementId">();
export const complianceConstraintIdSchema =
  opaqueIntentIdSchema.brand<"ComplianceConstraintId">();
export const intentAssumptionIdSchema =
  opaqueIntentIdSchema.brand<"IntentAssumptionId">();
export const unresolvedQuestionIdSchema =
  opaqueIntentIdSchema.brand<"UnresolvedQuestionId">();
export const userDecisionIdSchema =
  opaqueIntentIdSchema.brand<"UserDecisionId">();
export const candidateAlternativeIdSchema =
  opaqueIntentIdSchema.brand<"CandidateAlternativeId">();
export const promptInteractionIdSchema =
  opaqueIntentIdSchema.brand<"PromptInteractionId">();

export const intentSubjectSchema =
  namespacedIdentifierSchema.brand<"IntentSubject">();
export const geographyIdentifierSchema = z
  .string()
  .regex(
    geographyIdentifierPattern,
    "Must be a provider-neutral geography identifier.",
  )
  .brand<"GeographyIdentifier">();
export const currencyCodeSchema = z
  .string()
  .regex(currencyCodePattern, "Must be a three-letter ISO currency code.")
  .brand<"CurrencyCode">();

export const workloadCapabilitySchema = z.enum([
  "http-api",
  "web-application",
  "background-worker",
  "scheduled-job",
  "object-storage",
  "relational-data",
  "key-value-data",
  "document-data",
  "event-queue",
  "event-stream",
  "pub-sub-messaging",
  "file-transfer",
  "content-delivery",
  "batch-processing",
  "cache",
]);

export const requirementImportanceSchema = z.enum([
  "required",
  "preferred",
  "optional",
]);

export const unknownIntentValueSchema = z
  .object({
    state: z.literal("unknown"),
    questionId: unresolvedQuestionIdSchema,
    details: shortTextSchema.optional(),
  })
  .strict();

export const notRequiredIntentValueSchema = z
  .object({
    state: z.literal("not-required"),
    rationale: shortTextSchema,
  })
  .strict();

export const capabilityRequirementV1Schema = z
  .object({
    id: capabilityRequirementIdSchema,
    capability: workloadCapabilitySchema,
    importance: requirementImportanceSchema,
    description: shortTextSchema,
    rationale: shortTextSchema.optional(),
  })
  .strict();

export const workloadCapabilitiesV1Schema = z.discriminatedUnion("state", [
  z
    .object({
      state: z.literal("known"),
      items: z.array(capabilityRequirementV1Schema).min(1).max(128),
    })
    .strict(),
  unknownIntentValueSchema,
]);

export const connectivityChannelSchema = z.enum([
  "http",
  "websocket",
  "grpc",
  "tcp",
  "udp",
  "event",
  "message",
  "file-transfer",
  "administrative",
]);

export const connectivityExposureSchema = z.enum([
  "public",
  "private",
  "partner",
  "internal",
]);

export const connectivityRequirementV1Schema = z
  .object({
    id: connectivityRequirementIdSchema,
    channel: connectivityChannelSchema,
    exposure: connectivityExposureSchema,
    description: shortTextSchema,
    capabilityIds: z.array(capabilityRequirementIdSchema).max(64),
  })
  .strict();

const connectivityCollectionV1Schema = z.discriminatedUnion("state", [
  z
    .object({
      state: z.literal("known"),
      items: z.array(connectivityRequirementV1Schema).min(1).max(128),
    })
    .strict(),
  z
    .object({
      state: z.literal("none"),
      rationale: shortTextSchema,
    })
    .strict(),
  unknownIntentValueSchema,
]);

export const principalTypeSchema = z.enum([
  "human-user",
  "organization-administrator",
  "workload",
  "external-system",
]);

export const authenticationMethodSchema = z.enum([
  "federated",
  "passwordless",
  "multi-factor",
  "machine-identity",
  "api-credential",
]);

export const authorizationModelSchema = z.enum([
  "role-based",
  "attribute-based",
  "resource-based",
  "policy-based",
  "ownership-based",
]);

export const authenticationNeedsV1Schema = z.discriminatedUnion("state", [
  z
    .object({
      state: z.literal("known"),
      principals: z.array(principalTypeSchema).min(1).max(16),
      methods: z.array(authenticationMethodSchema).min(1).max(16),
      requirements: z.array(shortTextSchema).max(32),
    })
    .strict(),
  notRequiredIntentValueSchema,
  unknownIntentValueSchema,
]);

export const authorizationNeedsV1Schema = z.discriminatedUnion("state", [
  z
    .object({
      state: z.literal("known"),
      models: z.array(authorizationModelSchema).min(1).max(16),
      requirements: z.array(shortTextSchema).min(1).max(32),
    })
    .strict(),
  notRequiredIntentValueSchema,
  unknownIntentValueSchema,
]);

export const dataCategoryTypeSchema = z.enum([
  "user-profile",
  "authentication-data",
  "financial",
  "health",
  "telemetry",
  "content",
  "configuration",
  "business-record",
  "other",
]);

export const dataSensitivitySchema = z.enum([
  "public",
  "internal",
  "confidential",
  "restricted",
  "regulated",
]);

export const dataSensitivityRequirementV1Schema = z.discriminatedUnion(
  "state",
  [
    z
      .object({
        state: z.literal("known"),
        value: dataSensitivitySchema,
      })
      .strict(),
    unknownIntentValueSchema,
  ],
);

export const dataRetentionRequirementV1Schema = z.discriminatedUnion("state", [
  z
    .object({
      state: z.literal("known"),
      minimumDays: z.number().int().nonnegative().max(3_650_000),
      maximumDays: z.number().int().nonnegative().max(3_650_000).optional(),
      legalHoldRequired: z.boolean(),
    })
    .strict(),
  notRequiredIntentValueSchema,
  unknownIntentValueSchema,
]);

export const dataResidencyRequirementV1Schema = z.discriminatedUnion("state", [
  z
    .object({
      state: z.literal("known"),
      locations: z.array(geographyIdentifierSchema).min(1).max(64),
      strict: z.boolean(),
    })
    .strict(),
  notRequiredIntentValueSchema,
  unknownIntentValueSchema,
]);

export const dataCategoryV1Schema = z
  .object({
    id: dataCategoryIdSchema,
    name: shortTextSchema,
    category: dataCategoryTypeSchema,
    description: shortTextSchema,
    sensitivity: dataSensitivityRequirementV1Schema,
    retention: dataRetentionRequirementV1Schema,
    residency: dataResidencyRequirementV1Schema,
    capabilityIds: z.array(capabilityRequirementIdSchema).max(64),
  })
  .strict();

export const dataCategoriesV1Schema = z.discriminatedUnion("state", [
  z
    .object({
      state: z.literal("known"),
      items: z.array(dataCategoryV1Schema).min(1).max(128),
    })
    .strict(),
  z
    .object({
      state: z.literal("none"),
      rationale: shortTextSchema,
    })
    .strict(),
  unknownIntentValueSchema,
]);

export const workflowModeSchema = z.enum(["synchronous", "asynchronous"]);
export const workflowTriggerSchema = z.enum([
  "user-request",
  "schedule",
  "event",
  "message",
  "data-change",
  "external-system",
]);

export const workflowExecutionV1Schema = z.discriminatedUnion("state", [
  z
    .object({
      state: z.literal("known"),
      mode: workflowModeSchema,
    })
    .strict(),
  unknownIntentValueSchema,
]);

export const workflowTriggerRequirementV1Schema = z.discriminatedUnion(
  "state",
  [
    z
      .object({
        state: z.literal("known"),
        value: workflowTriggerSchema,
      })
      .strict(),
    unknownIntentValueSchema,
  ],
);

export const workflowRequirementV1Schema = z
  .object({
    id: workflowRequirementIdSchema,
    name: shortTextSchema,
    description: longTextSchema,
    execution: workflowExecutionV1Schema,
    trigger: workflowTriggerRequirementV1Schema,
    capabilityIds: z.array(capabilityRequirementIdSchema).min(1).max(64),
  })
  .strict();

export const workflowRequirementsV1Schema = z.discriminatedUnion("state", [
  z
    .object({
      state: z.literal("known"),
      items: z.array(workflowRequirementV1Schema).min(1).max(128),
    })
    .strict(),
  z
    .object({
      state: z.literal("none"),
      rationale: shortTextSchema,
    })
    .strict(),
  unknownIntentValueSchema,
]);

export const availabilityWindowSchema = z.enum([
  "monthly",
  "quarterly",
  "annual",
]);

export const availabilityExpectationV1Schema = z.discriminatedUnion("state", [
  z
    .object({
      state: z.literal("known"),
      targetPercent: z.number().min(0).max(100),
      measurementWindow: availabilityWindowSchema,
      scope: shortTextSchema,
    })
    .strict(),
  unknownIntentValueSchema,
]);

export const durabilityExpectationV1Schema = z.discriminatedUnion("state", [
  z
    .object({
      state: z.literal("known"),
      targetPercent: z.number().min(0).max(100),
      scope: shortTextSchema,
    })
    .strict(),
  unknownIntentValueSchema,
]);

export const recoveryExpectationV1Schema = z.discriminatedUnion("state", [
  z
    .object({
      state: z.literal("known"),
      recoveryTimeObjectiveSeconds: z
        .number()
        .int()
        .nonnegative()
        .max(315_360_000),
      recoveryPointObjectiveSeconds: z
        .number()
        .int()
        .nonnegative()
        .max(315_360_000),
      scope: shortTextSchema,
    })
    .strict(),
  notRequiredIntentValueSchema,
  unknownIntentValueSchema,
]);

export const latencyPercentileSchema = z.enum(["p50", "p95", "p99"]);
export const latencyTargetV1Schema = z
  .object({
    percentile: latencyPercentileSchema,
    milliseconds: z.number().nonnegative().max(86_400_000),
  })
  .strict();

export const latencyExpectationV1Schema = z.discriminatedUnion("state", [
  z
    .object({
      state: z.literal("known"),
      scope: shortTextSchema,
      targets: z.array(latencyTargetV1Schema).min(1).max(3),
    })
    .strict(),
  notRequiredIntentValueSchema,
  unknownIntentValueSchema,
]);

export const scaleMetricSchema = z.enum([
  "annual-growth-percent",
  "concurrent-users",
  "events-per-second",
  "peak-requests-per-second",
  "steady-requests-per-second",
  "stored-data-gib",
]);

export const scaleMetricValueV1Schema = z
  .object({
    metric: scaleMetricSchema,
    value: z.number().nonnegative().max(Number.MAX_SAFE_INTEGER),
  })
  .strict();

export const scaleExpectationV1Schema = z.discriminatedUnion("state", [
  z
    .object({
      state: z.literal("known"),
      metrics: z.array(scaleMetricValueV1Schema).min(1).max(16),
      scope: shortTextSchema,
    })
    .strict(),
  unknownIntentValueSchema,
]);

export const environmentTypeSchema = z.enum([
  "development",
  "test",
  "staging",
  "production",
  "disaster-recovery",
  "multi-environment",
]);

export const environmentRequirementV1Schema = z.discriminatedUnion("state", [
  z
    .object({
      state: z.literal("known"),
      value: environmentTypeSchema,
    })
    .strict(),
  unknownIntentValueSchema,
]);

export const operationalOverheadPreferenceSchema = z.enum([
  "minimize",
  "balanced",
  "control-prioritized",
]);

export const operationalOverheadRequirementV1Schema = z.discriminatedUnion(
  "state",
  [
    z
      .object({
        state: z.literal("known"),
        preference: operationalOverheadPreferenceSchema,
        rationale: shortTextSchema,
      })
      .strict(),
    unknownIntentValueSchema,
  ],
);

export const costPrioritySchema = z.enum([
  "minimize",
  "balanced",
  "performance-prioritized",
  "predictability-prioritized",
]);

export const budgetPeriodSchema = z.enum(["monthly", "annual", "one-time"]);
export const budgetRequirementV1Schema = z.discriminatedUnion("state", [
  z
    .object({
      state: z.literal("known"),
      amount: z.number().positive().max(Number.MAX_SAFE_INTEGER),
      currency: currencyCodeSchema,
      period: budgetPeriodSchema,
    })
    .strict(),
  notRequiredIntentValueSchema,
  unknownIntentValueSchema,
]);

export const costPreferenceV1Schema = z.discriminatedUnion("state", [
  z
    .object({
      state: z.literal("known"),
      priority: costPrioritySchema,
      budget: budgetRequirementV1Schema,
      rationale: shortTextSchema,
    })
    .strict(),
  unknownIntentValueSchema,
]);

export const complianceFrameworkSchema = z.enum([
  "gdpr",
  "hipaa",
  "pci-dss",
  "soc-2",
  "iso-27001",
  "fedramp",
  "organization-policy",
  "other",
]);

export const complianceConstraintV1Schema = z
  .object({
    id: complianceConstraintIdSchema,
    framework: complianceFrameworkSchema,
    requirement: shortTextSchema,
    importance: z.enum(["mandatory", "preferred"]),
    jurisdictions: z.array(geographyIdentifierSchema).max(64),
  })
  .strict();

export const complianceRequirementsV1Schema = z.discriminatedUnion("state", [
  z
    .object({
      state: z.literal("known"),
      items: z.array(complianceConstraintV1Schema).min(1).max(128),
    })
    .strict(),
  z
    .object({
      state: z.literal("none"),
      rationale: shortTextSchema,
    })
    .strict(),
  unknownIntentValueSchema,
]);

export const intentOriginSchema = z.enum([
  "user",
  "template",
  "prompt-assisted",
  "imported",
]);

export const intentAssumptionV1Schema = z
  .object({
    id: intentAssumptionIdSchema,
    subject: intentSubjectSchema,
    statement: shortTextSchema,
    status: z.enum(["active", "confirmed", "rejected"]),
    origin: intentOriginSchema,
  })
  .strict();

export const unresolvedQuestionV1Schema = z
  .object({
    id: unresolvedQuestionIdSchema,
    subject: intentSubjectSchema,
    question: shortTextSchema,
    classification: z.enum(["blocking", "non-blocking"]),
    rationale: shortTextSchema.optional(),
  })
  .strict();

export const rationaleConsiderationV1Schema = z
  .object({
    kind: z.enum(["benefit", "risk", "tradeoff", "constraint"]),
    statement: shortTextSchema,
    source: z.enum(["user", "domain-rule", "template", "prompt-assisted"]),
  })
  .strict();

export const rationaleMetadataV1Schema = z
  .object({
    summary: shortTextSchema,
    considerations: z.array(rationaleConsiderationV1Schema).max(64),
  })
  .strict();

export const candidateAlternativeV1Schema = z
  .object({
    id: candidateAlternativeIdSchema,
    subject: intentSubjectSchema,
    title: shortTextSchema,
    description: longTextSchema,
    status: z.enum(["candidate", "selected", "rejected"]),
    rationale: rationaleMetadataV1Schema,
  })
  .strict();

export const userDecisionV1Schema = z
  .object({
    id: userDecisionIdSchema,
    subject: intentSubjectSchema,
    statement: shortTextSchema,
    status: z.enum(["active", "superseded"]),
    selectedAlternativeId: candidateAlternativeIdSchema.optional(),
    supersedesDecisionId: userDecisionIdSchema.optional(),
    rationale: rationaleMetadataV1Schema,
    decidedBy: actorIdSchema,
    decidedAt: utcTimestampSchema,
  })
  .strict();

export const promptProvenanceV1Schema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("not-applicable") }).strict(),
  z
    .object({
      kind: z.literal("prompt-reference"),
      interactionId: promptInteractionIdSchema,
      templateId:
        namespacedIdentifierSchema.brand<"PromptTemplateIdentifier">(),
      templateVersion: semanticVersionSchema,
      inputDigest: sha256DigestSchema,
      outputDigest: sha256DigestSchema.optional(),
      capturedAt: utcTimestampSchema,
    })
    .strict(),
]);

export const intentDocumentV1Schema = z
  .object({
    kind: z.literal("cloudmarkup.intent-document"),
    schemaVersion: z.literal(1),
    documentId: intentDocumentIdSchema,
    intentId: intentIdSchema,
    revision: z
      .object({
        revisionId: intentRevisionIdSchema,
        revisionNumber: z.number().int().positive(),
        createdAt: utcTimestampSchema,
        createdBy: actorIdSchema,
        previousRevisionId: intentRevisionIdSchema.optional(),
      })
      .strict(),
    application: z
      .object({
        summary: longTextSchema,
        capabilities: workloadCapabilitiesV1Schema,
      })
      .strict(),
    connectivity: z
      .object({
        ingress: connectivityCollectionV1Schema,
        egress: connectivityCollectionV1Schema,
      })
      .strict(),
    identity: z
      .object({
        authentication: authenticationNeedsV1Schema,
        authorization: authorizationNeedsV1Schema,
      })
      .strict(),
    data: dataCategoriesV1Schema,
    workflows: workflowRequirementsV1Schema,
    quality: z
      .object({
        availability: availabilityExpectationV1Schema,
        durability: durabilityExpectationV1Schema,
        recovery: recoveryExpectationV1Schema,
        latency: latencyExpectationV1Schema,
        scale: scaleExpectationV1Schema,
      })
      .strict(),
    environment: environmentRequirementV1Schema,
    preferences: z
      .object({
        operationalOverhead: operationalOverheadRequirementV1Schema,
        cost: costPreferenceV1Schema,
      })
      .strict(),
    compliance: complianceRequirementsV1Schema,
    assumptions: z.array(intentAssumptionV1Schema).max(256),
    unresolvedQuestions: z.array(unresolvedQuestionV1Schema).max(256),
    decisions: z.array(userDecisionV1Schema).max(256),
    alternatives: z.array(candidateAlternativeV1Schema).max(256),
    metadata: z
      .object({
        source: intentOriginSchema,
        provenance: z
          .object({
            schema: z
              .object({
                contractId: z.literal("cloudmarkup.intent-document"),
                schemaVersion: z.literal(1),
              })
              .strict(),
            prompt: promptProvenanceV1Schema,
          })
          .strict(),
        serialization: z
          .object({
            mediaType: z.literal("application/json"),
            encoding: z.literal("utf-8"),
            canonicalization: z.literal(
              "cloudmarkup.intent-normalized-json.v1",
            ),
          })
          .strict(),
      })
      .strict(),
  })
  .strict();

export type IntentDocumentV1 = z.output<typeof intentDocumentV1Schema>;
export type CapabilityRequirementV1 = z.output<
  typeof capabilityRequirementV1Schema
>;
export type DataCategoryV1 = z.output<typeof dataCategoryV1Schema>;
export type EnvironmentType = z.output<typeof environmentTypeSchema>;
export type WorkflowRequirementV1 = z.output<
  typeof workflowRequirementV1Schema
>;
export type UnresolvedQuestionV1 = z.output<typeof unresolvedQuestionV1Schema>;
export type UserDecisionV1 = z.output<typeof userDecisionV1Schema>;
export type CandidateAlternativeV1 = z.output<
  typeof candidateAlternativeV1Schema
>;
export type CapabilityRequirementId = z.output<
  typeof capabilityRequirementIdSchema
>;
export type UnresolvedQuestionId = z.output<typeof unresolvedQuestionIdSchema>;

export function generateIntentDocumentV1JsonSchema() {
  const generated = z.toJSONSchema(intentDocumentV1Schema, {
    io: "input",
    target: "draft-2020-12",
  });

  return {
    ...generated,
    $id: "https://schemas.cloudmarkup.com/intent-document/v1.schema.json",
    title: "Cloud Markup Intent Document v1",
  };
}
