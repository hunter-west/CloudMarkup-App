import { z } from "zod";

import {
  actorIdSchema,
  edgeIdSchema,
  generatorIdSchema,
  namespacedIdentifierSchema,
  requirementIdSchema,
  semanticVersionSchema,
  sha256DigestSchema,
  utcTimestampSchema,
} from "./architecture-document-v1.js";
import {
  applicationContractReferenceV1Schema,
  authContractReferenceV1Schema,
  authRoleIdSchema,
  behaviorOperationContractReferenceV1Schema,
  dataEntityContractReferenceV1Schema,
  testCaseContractReferenceV1Schema,
} from "./application-contracts-v1.js";
import {
  repositoryPathOwnershipV1Schema,
  repositoryRelativePathSchema,
} from "./repository-ownership-v1.js";
import {
  workloadDownstreamActionBindingV1Schema,
  workloadEnvironmentBindingV1Schema,
  workloadHandlerSchema,
  workloadImplementationV1Schema,
  workloadOperationIdSchema,
  workloadOperationV1Schema,
  workloadRuntimeFamilySchema,
  workloadTriggerBindingV1Schema,
  workloadV1Schema,
} from "./workload-behavior-v1.js";

const opaqueIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const safeReferencePattern = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,1023}$/;
const httpPathPattern = /^\/[A-Za-z0-9._~!$&'()*+,;=:@%/{}-]*$/;
const utcTimePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

const shortTextSchema = z.string().trim().min(1).max(512);
const boundedOpaqueIdSchema = z
  .string()
  .regex(opaqueIdPattern, "Must be a stable opaque identifier.");

export const workloadEntrypointIdSchema =
  boundedOpaqueIdSchema.brand<"WorkloadEntrypointId">();
export const workloadHttpRouteIdSchema =
  boundedOpaqueIdSchema.brand<"WorkloadHttpRouteId">();
export const workloadEventBindingIdSchema =
  boundedOpaqueIdSchema.brand<"WorkloadEventBindingId">();
export const workloadScheduleBindingIdSchema =
  boundedOpaqueIdSchema.brand<"WorkloadScheduleBindingId">();
export const workloadDataBindingIdSchema =
  boundedOpaqueIdSchema.brand<"WorkloadDataBindingId">();
export const workloadAuthorizationBindingIdSchema =
  boundedOpaqueIdSchema.brand<"WorkloadAuthorizationBindingId">();
export const workloadIdempotencyPolicyIdSchema =
  boundedOpaqueIdSchema.brand<"WorkloadIdempotencyPolicyId">();
export const workloadHealthCheckIdSchema =
  boundedOpaqueIdSchema.brand<"WorkloadHealthCheckId">();
export const workloadTestBindingIdSchema =
  boundedOpaqueIdSchema.brand<"WorkloadTestBindingId">();
export const workloadExtensionIdSchema =
  boundedOpaqueIdSchema.brand<"WorkloadExtensionId">();
export const workloadImplementationRequirementIdSchema =
  boundedOpaqueIdSchema.brand<"WorkloadImplementationRequirementId">();

export const workloadLanguageFamilySchema =
  namespacedIdentifierSchema.brand<"WorkloadLanguageFamily">();

export const workloadSupportedPatternReferenceV2Schema = z
  .object({
    patternId: namespacedIdentifierSchema,
    patternVersion: semanticVersionSchema,
    digest: sha256DigestSchema,
  })
  .strict();

export const workloadExtensionReferenceV2Schema = z
  .object({
    extensionId: workloadExtensionIdSchema,
    extensionContractVersion: z.literal(1),
    digest: sha256DigestSchema,
    ownership: z.enum(["ai-authored", "approved-extension"]),
    validationEvidenceIds: z.array(boundedOpaqueIdSchema).min(1).max(64),
  })
  .strict();

export const workloadImplementationV2Schema = z.discriminatedUnion("mode", [
  ...workloadImplementationV1Schema.options,
  z
    .object({
      mode: z.literal("complete-supported-pattern"),
      runtimeFamily: workloadRuntimeFamilySchema,
      handler: workloadHandlerSchema,
      sourceOwnership: z.literal("cloudmarkup"),
      supportedPattern: workloadSupportedPatternReferenceV2Schema,
    })
    .strict(),
  z
    .object({
      mode: z.literal("ai-assisted-custom"),
      runtimeFamily: workloadRuntimeFamilySchema,
      handler: workloadHandlerSchema,
      sourceOwnership: z.literal("ai-authored"),
      extension: workloadExtensionReferenceV2Schema,
    })
    .strict(),
]);

export const workloadEntrypointV2Schema = z
  .object({
    entrypointId: workloadEntrypointIdSchema,
    kind: z.enum([
      "request-handler",
      "event-handler",
      "message-handler",
      "schedule-handler",
      "background-worker",
    ]),
    operationId: workloadOperationIdSchema,
    handler: workloadHandlerSchema,
  })
  .strict();

const httpApiContractReferenceV1Schema = applicationContractReferenceV1Schema
  .extend({ contractKind: z.literal("http-api") })
  .strict();
const eventMessageContractReferenceV1Schema =
  applicationContractReferenceV1Schema
    .extend({ contractKind: z.literal("event-message") })
    .strict();

export const workloadHttpRouteV2Schema = z
  .object({
    routeId: workloadHttpRouteIdSchema,
    method: z.enum([
      "GET",
      "HEAD",
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
      "OPTIONS",
    ]),
    pathTemplate: z.string().max(512).regex(httpPathPattern),
    operationId: workloadOperationIdSchema,
    triggerEdgeId: edgeIdSchema,
    contract: httpApiContractReferenceV1Schema,
  })
  .strict();

export const workloadEventBindingV2Schema = z
  .object({
    bindingId: workloadEventBindingIdSchema,
    direction: z.enum(["inbound", "outbound"]),
    transportKind: z.enum(["event", "message"]),
    operationId: workloadOperationIdSchema,
    edgeId: edgeIdSchema,
    contract: eventMessageContractReferenceV1Schema,
  })
  .strict();

export const workloadScheduleV2Schema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("interval"),
      seconds: z.number().int().positive().max(31_536_000),
    })
    .strict(),
  z
    .object({
      kind: z.literal("daily"),
      utcTime: z.string().regex(utcTimePattern),
    })
    .strict(),
  z
    .object({
      kind: z.literal("weekly"),
      days: z
        .array(
          z.enum([
            "monday",
            "tuesday",
            "wednesday",
            "thursday",
            "friday",
            "saturday",
            "sunday",
          ]),
        )
        .min(1)
        .max(7),
      utcTime: z.string().regex(utcTimePattern),
    })
    .strict(),
]);

export const workloadScheduleBindingV2Schema = z
  .object({
    bindingId: workloadScheduleBindingIdSchema,
    operationId: workloadOperationIdSchema,
    triggerEdgeId: edgeIdSchema.optional(),
    schedule: workloadScheduleV2Schema,
  })
  .strict();

export const workloadDataBindingV2Schema = z
  .object({
    bindingId: workloadDataBindingIdSchema,
    operationId: workloadOperationIdSchema,
    entity: dataEntityContractReferenceV1Schema,
    dataOperation: z.enum([
      "create",
      "read",
      "update",
      "delete",
      "list",
      "query",
      "publish",
      "consume",
    ]),
    edgeId: edgeIdSchema.optional(),
  })
  .strict();

export const workloadAuthorizationBindingV2Schema = z
  .object({
    bindingId: workloadAuthorizationBindingIdSchema,
    authContract: authContractReferenceV1Schema,
    operationIds: z.array(workloadOperationIdSchema).min(1).max(256),
    permittedRoleIds: z.array(authRoleIdSchema).max(64),
    deniedBehavior: z.enum(["reject", "hide-resource", "return-empty"]),
  })
  .strict();

export const workloadIdempotencyKeySourceV2Schema = z.discriminatedUnion(
  "kind",
  [
    z
      .object({
        kind: z.literal("request-header"),
        headerName: z
          .string()
          .min(1)
          .max(127)
          .regex(/^[A-Za-z0-9][A-Za-z0-9-]*$/),
      })
      .strict(),
    z
      .object({
        kind: z.literal("contract-field"),
        contract: applicationContractReferenceV1Schema,
        fieldPath: z
          .string()
          .min(1)
          .max(512)
          .regex(/^\$(?:\.[A-Za-z_][A-Za-z0-9_-]*)*$/),
      })
      .strict(),
    z.object({ kind: z.literal("trigger-identity") }).strict(),
  ],
);

export const workloadIdempotencyPolicyV2Schema = z.discriminatedUnion("mode", [
  z
    .object({
      policyId: workloadIdempotencyPolicyIdSchema,
      mode: z.literal("not-required"),
      operationIds: z.array(workloadOperationIdSchema).min(1).max(256),
    })
    .strict(),
  z
    .object({
      policyId: workloadIdempotencyPolicyIdSchema,
      mode: z.literal("required"),
      operationIds: z.array(workloadOperationIdSchema).min(1).max(256),
      keySource: workloadIdempotencyKeySourceV2Schema,
      retentionSeconds: z.number().int().positive().max(31_536_000),
      concurrentDuplicateBehavior: z.enum([
        "reject",
        "join",
        "return-recorded",
      ]),
    })
    .strict(),
]);

export const workloadTimeoutAssumptionV2Schema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("unresolved") }).strict(),
  z
    .object({
      kind: z.literal("duration"),
      milliseconds: z.number().int().positive(),
    })
    .strict(),
]);

export const workloadRetryAssumptionV2Schema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("unresolved") }).strict(),
  z.object({ kind: z.literal("none") }).strict(),
  z
    .object({
      kind: z.literal("bounded"),
      maximumAttempts: z.number().int().positive(),
    })
    .strict(),
]);

export const workloadExecutionAssumptionsV2Schema = z
  .object({
    timeout: workloadTimeoutAssumptionV2Schema,
    retry: workloadRetryAssumptionV2Schema,
  })
  .strict();

export const workloadHealthCheckV2Schema = z
  .object({
    healthCheckId: workloadHealthCheckIdSchema,
    kind: z.enum(["liveness", "readiness", "dependency"]),
    operationId: workloadOperationIdSchema.optional(),
    timeoutMilliseconds: z.number().int().positive().max(300_000),
    failureState: z.enum(["degraded", "unhealthy"]),
  })
  .strict();

export const workloadObservabilityV2Schema = z
  .object({
    signals: z.array(z.enum(["logs", "metrics", "traces"])).max(3),
    healthChecks: z.array(workloadHealthCheckV2Schema).max(64),
    smokeTests: z.array(testCaseContractReferenceV1Schema).max(64),
  })
  .strict();

export const workloadTestBindingV2Schema = z
  .object({
    bindingId: workloadTestBindingIdSchema,
    level: z.enum(["unit", "contract", "integration", "smoke"]),
    testCase: testCaseContractReferenceV1Schema,
    requiredForCoverage: z.boolean(),
  })
  .strict();

export const workloadExtensionPointV2Schema = z
  .object({
    extensionPointId: namespacedIdentifierSchema,
    path: repositoryRelativePathSchema,
    kind: z.enum(["module", "handler", "adapter", "configuration", "test"]),
    permittedOwnership: z
      .array(z.enum(["user-owned", "ai-authored", "approved-extension"]))
      .min(1)
      .max(3),
    conflictBehavior: z.literal("require-reviewed-resolution"),
  })
  .strict();

export const workloadImplementationRequirementV2Schema = z
  .object({
    implementationRequirementId: workloadImplementationRequirementIdSchema,
    architectureRequirementId: requirementIdSchema.optional(),
    summary: shortTextSchema,
    blocking: z.boolean(),
    affectedContractReferences: z
      .array(applicationContractReferenceV1Schema)
      .max(64),
  })
  .strict();

export const workloadGeneratorCompatibilityV2Schema = z
  .object({
    generatorId: generatorIdSchema,
    minimumVersion: semanticVersionSchema,
    maximumVersionExclusive: semanticVersionSchema.optional(),
    templateId: namespacedIdentifierSchema,
    templateVersion: semanticVersionSchema,
    supportedModes: z
      .array(z.enum(["generated-starter", "complete-supported-pattern"]))
      .min(1)
      .max(2),
  })
  .strict();

export const workloadModelCompatibilityV2Schema = z
  .object({
    modelGatewayContractVersion: semanticVersionSchema,
    modelFamily: namespacedIdentifierSchema,
    promptTemplateId: namespacedIdentifierSchema,
    promptVersion: semanticVersionSchema,
    promptDigest: sha256DigestSchema,
    supportedMode: z.literal("ai-assisted-custom"),
    requiredValidation: z
      .array(
        z.enum([
          "parse",
          "static-analysis",
          "format",
          "build",
          "unit-test",
          "contract-test",
          "integration-test",
          "security",
        ]),
      )
      .min(1)
      .max(8),
  })
  .strict();

const workloadManualProvenanceV2Schema = z
  .object({
    source: z.literal("manual"),
    recordedAt: utcTimestampSchema,
    recordedBy: actorIdSchema,
  })
  .strict();
const workloadMigrationProvenanceV2Schema = z
  .object({
    source: z.literal("deterministic-migration"),
    migrationId: namespacedIdentifierSchema,
    migrationVersion: semanticVersionSchema,
  })
  .strict();
const workloadGeneratorProvenanceV2Schema = z
  .object({
    source: z.literal("deterministic-generator"),
    generatorId: generatorIdSchema,
    generatorVersion: semanticVersionSchema,
    inputDigest: sha256DigestSchema,
  })
  .strict();
const workloadAiProvenanceV2Schema = z
  .object({
    source: z.literal("ai-assisted"),
    modelGatewayId: namespacedIdentifierSchema,
    modelProviderId: namespacedIdentifierSchema,
    modelId: z.string().regex(safeReferencePattern),
    promptTemplateId: namespacedIdentifierSchema,
    promptVersion: semanticVersionSchema,
    promptDigest: sha256DigestSchema,
    outputDigest: sha256DigestSchema,
    acceptedAt: utcTimestampSchema,
    acceptedBy: actorIdSchema,
  })
  .strict();

export const workloadProvenanceV2Schema = z.discriminatedUnion("source", [
  workloadManualProvenanceV2Schema,
  workloadMigrationProvenanceV2Schema,
  workloadGeneratorProvenanceV2Schema,
  workloadAiProvenanceV2Schema,
]);

export const workloadV2Schema = workloadV1Schema
  .extend({
    implementation: workloadImplementationV2Schema,
    operations: z.array(workloadOperationV1Schema),
    behaviorContracts: z
      .array(behaviorOperationContractReferenceV1Schema)
      .max(256),
    triggers: z.array(workloadTriggerBindingV1Schema),
    downstreamActions: z.array(workloadDownstreamActionBindingV1Schema),
    environment: z.array(workloadEnvironmentBindingV1Schema),
    executionAssumptions: workloadExecutionAssumptionsV2Schema,
    unresolvedRequirementIds: z.array(requirementIdSchema),
    languageFamily: workloadLanguageFamilySchema.optional(),
    entrypoints: z.array(workloadEntrypointV2Schema).max(256),
    httpRoutes: z.array(workloadHttpRouteV2Schema).max(256),
    eventBindings: z.array(workloadEventBindingV2Schema).max(256),
    schedules: z.array(workloadScheduleBindingV2Schema).max(256),
    dataBindings: z.array(workloadDataBindingV2Schema).max(256),
    authorization: z.array(workloadAuthorizationBindingV2Schema).max(256),
    idempotency: z.array(workloadIdempotencyPolicyV2Schema).max(256),
    observability: workloadObservabilityV2Schema,
    tests: z.array(workloadTestBindingV2Schema).max(256),
    sourceOwnership: z.array(repositoryPathOwnershipV1Schema).max(512),
    extensionPoints: z.array(workloadExtensionPointV2Schema).max(128),
    extensions: z.array(workloadExtensionReferenceV2Schema).max(128),
    implementationRequirements: z
      .array(workloadImplementationRequirementV2Schema)
      .max(256),
    compatibility: z
      .object({
        applicationGenerators: z
          .array(workloadGeneratorCompatibilityV2Schema)
          .max(64),
        modelGateways: z.array(workloadModelCompatibilityV2Schema).max(64),
      })
      .strict(),
    provenance: workloadProvenanceV2Schema,
  })
  .strict();

export const workloadBehaviorV2Schema = z
  .object({
    contractVersion: z.literal(2),
    workloads: z.array(workloadV2Schema),
  })
  .strict();

export type WorkloadBehaviorV2 = z.output<typeof workloadBehaviorV2Schema>;
export type WorkloadV2 = z.output<typeof workloadV2Schema>;
export type WorkloadImplementationV2 = z.output<
  typeof workloadImplementationV2Schema
>;
export type WorkloadEntrypointV2 = z.output<typeof workloadEntrypointV2Schema>;
export type WorkloadHttpRouteV2 = z.output<typeof workloadHttpRouteV2Schema>;
export type WorkloadEventBindingV2 = z.output<
  typeof workloadEventBindingV2Schema
>;
export type WorkloadScheduleBindingV2 = z.output<
  typeof workloadScheduleBindingV2Schema
>;
export type WorkloadDataBindingV2 = z.output<
  typeof workloadDataBindingV2Schema
>;
export type WorkloadAuthorizationBindingV2 = z.output<
  typeof workloadAuthorizationBindingV2Schema
>;
export type WorkloadIdempotencyPolicyV2 = z.output<
  typeof workloadIdempotencyPolicyV2Schema
>;
export type WorkloadProvenanceV2 = z.output<typeof workloadProvenanceV2Schema>;

export function generateWorkloadBehaviorV2JsonSchema() {
  const generated = z.toJSONSchema(workloadBehaviorV2Schema, {
    io: "input",
    target: "draft-2020-12",
  });

  return {
    ...generated,
    $id: "https://schemas.cloudmarkup.com/workload-behavior/v2.schema.json",
    title: "Cloud Markup Workload Behavior v2",
  };
}
