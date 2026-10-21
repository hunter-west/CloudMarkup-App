import { z } from "zod";

import {
  edgeIdSchema,
  namespacedIdentifierSchema,
  nodeIdSchema,
  requirementIdSchema,
  semanticVersionSchema,
  sha256DigestSchema,
  variableIdSchema,
} from "./architecture-document-v1.js";

const opaqueIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const environmentNamePattern = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const handlerPattern = /^[A-Za-z0-9_.$/:#-]{1,256}$/;

const workloadOpaqueIdSchema = z
  .string()
  .regex(opaqueIdPattern, "Must be a stable opaque identifier.");

export const workloadIdSchema = workloadOpaqueIdSchema.brand<"WorkloadId">();
export const workloadOperationIdSchema =
  workloadOpaqueIdSchema.brand<"WorkloadOperationId">();
export const workloadTriggerBindingIdSchema =
  workloadOpaqueIdSchema.brand<"WorkloadTriggerBindingId">();
export const workloadDownstreamActionBindingIdSchema =
  workloadOpaqueIdSchema.brand<"WorkloadDownstreamActionBindingId">();
export const workloadEnvironmentBindingIdSchema =
  workloadOpaqueIdSchema.brand<"WorkloadEnvironmentBindingId">();
export const workloadArtifactIdSchema =
  workloadOpaqueIdSchema.brand<"WorkloadArtifactId">();
export const workloadSecretReferenceSchema =
  workloadOpaqueIdSchema.brand<"WorkloadSecretReference">();

export const workloadRuntimeFamilySchema =
  namespacedIdentifierSchema.brand<"WorkloadRuntimeFamily">();
export const workloadOperationCapabilitySchema =
  namespacedIdentifierSchema.brand<"WorkloadOperationCapability">();
export const workloadContractIdSchema =
  namespacedIdentifierSchema.brand<"WorkloadContractId">();
export const workloadDispatcherIdSchema =
  namespacedIdentifierSchema.brand<"WorkloadDispatcherId">();
export const workloadEnvironmentNameSchema = z
  .string()
  .regex(
    environmentNamePattern,
    "Must be a portable environment variable name.",
  )
  .brand<"WorkloadEnvironmentName">();
export const workloadHandlerSchema = z
  .string()
  .regex(
    handlerPattern,
    "Must be a bounded handler identifier without whitespace or executable syntax.",
  )
  .brand<"WorkloadHandler">();

export const workloadContractReferenceV1Schema = z
  .object({
    contractId: workloadContractIdSchema,
    contractVersion: semanticVersionSchema,
    digest: sha256DigestSchema,
  })
  .strict();

export const workloadIoContractV1Schema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }).strict(),
  z
    .object({
      kind: z.literal("contract-reference"),
      reference: workloadContractReferenceV1Schema,
    })
    .strict(),
]);

export const workloadOperationV1Schema = z
  .object({
    id: workloadOperationIdSchema,
    capability: workloadOperationCapabilitySchema,
    inputContract: workloadIoContractV1Schema,
    outputContract: workloadIoContractV1Schema,
  })
  .strict();

export const workloadTriggerBindingV1Schema = z
  .object({
    id: workloadTriggerBindingIdSchema,
    edgeId: edgeIdSchema,
    targetOperationId: workloadOperationIdSchema,
  })
  .strict();

export const workloadDownstreamActionBindingV1Schema = z
  .object({
    id: workloadDownstreamActionBindingIdSchema,
    edgeId: edgeIdSchema,
    sourceOperationId: workloadOperationIdSchema,
  })
  .strict();

export const workloadEnvironmentValueV1Schema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("variable-reference"),
      variableId: variableIdSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("node-attribute-reference"),
      nodeId: nodeIdSchema,
      attribute: namespacedIdentifierSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("secret-reference"),
      reference: workloadSecretReferenceSchema,
    })
    .strict(),
]);

export const workloadEnvironmentBindingV1Schema = z
  .object({
    id: workloadEnvironmentBindingIdSchema,
    name: workloadEnvironmentNameSchema,
    value: workloadEnvironmentValueV1Schema,
  })
  .strict();

export const workloadImplementationV1Schema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("infrastructure-only") }).strict(),
  z
    .object({
      mode: z.literal("user-provided"),
      runtimeFamily: workloadRuntimeFamilySchema,
      handler: workloadHandlerSchema,
      sourceOwnership: z.literal("user"),
    })
    .strict(),
  z
    .object({
      mode: z.literal("generated-starter"),
      runtimeFamily: workloadRuntimeFamilySchema,
      handler: workloadHandlerSchema,
      sourceOwnership: z.literal("cloudmarkup"),
    })
    .strict(),
  z
    .object({
      mode: z.literal("external-artifact"),
      runtimeFamily: workloadRuntimeFamilySchema,
      handler: workloadHandlerSchema,
      sourceOwnership: z.literal("external"),
      artifact: z
        .object({
          artifactId: workloadArtifactIdSchema,
          digest: sha256DigestSchema,
        })
        .strict(),
    })
    .strict(),
]);

export const workloadErrorBehaviorV1Schema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("fail-invocation") }).strict(),
  z
    .object({
      mode: z.literal("return-error"),
      errorContract: workloadContractReferenceV1Schema,
    })
    .strict(),
  z.object({ mode: z.literal("continue") }).strict(),
]);

export const workloadTimeoutAssumptionV1Schema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("unresolved") }).strict(),
  z
    .object({
      kind: z.literal("duration"),
      milliseconds: z.number().int().positive(),
    })
    .strict(),
]);

export const workloadRetryAssumptionV1Schema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("unresolved") }).strict(),
  z.object({ kind: z.literal("none") }).strict(),
  z
    .object({
      kind: z.literal("bounded"),
      maximumAttempts: z.number().int().positive(),
    })
    .strict(),
]);

export const workloadExecutionAssumptionsV1Schema = z
  .object({
    timeout: workloadTimeoutAssumptionV1Schema,
    retry: workloadRetryAssumptionV1Schema,
  })
  .strict();

export const workloadTriggerDispatchPolicyV1Schema = z.discriminatedUnion(
  "mode",
  [
    z.object({ mode: z.literal("single") }).strict(),
    z
      .object({
        mode: z.literal("user-provided"),
        dispatcherOperationId: workloadOperationIdSchema,
      })
      .strict(),
    z
      .object({
        mode: z.literal("generated-supported"),
        dispatcherId: workloadDispatcherIdSchema,
        dispatcherVersion: semanticVersionSchema,
        dispatcherOperationId: workloadOperationIdSchema,
      })
      .strict(),
  ],
);

export const workloadV1Schema = z
  .object({
    id: workloadIdSchema,
    owningNodeId: nodeIdSchema,
    implementation: workloadImplementationV1Schema,
    operations: z.array(workloadOperationV1Schema),
    triggers: z.array(workloadTriggerBindingV1Schema),
    downstreamActions: z.array(workloadDownstreamActionBindingV1Schema),
    environment: z.array(workloadEnvironmentBindingV1Schema),
    errorBehavior: workloadErrorBehaviorV1Schema,
    executionAssumptions: workloadExecutionAssumptionsV1Schema,
    triggerDispatch: workloadTriggerDispatchPolicyV1Schema,
    unresolvedRequirementIds: z.array(requirementIdSchema),
  })
  .strict();

export const workloadBehaviorV1Schema = z
  .object({
    contractVersion: z.literal(1),
    workloads: z.array(workloadV1Schema),
  })
  .strict();

export type WorkloadBehaviorV1 = z.output<typeof workloadBehaviorV1Schema>;
export type WorkloadV1 = z.output<typeof workloadV1Schema>;
export type WorkloadContractReferenceV1 = z.output<
  typeof workloadContractReferenceV1Schema
>;
export type WorkloadIoContractV1 = z.output<typeof workloadIoContractV1Schema>;
export type WorkloadImplementationV1 = z.output<
  typeof workloadImplementationV1Schema
>;
export type WorkloadOperationV1 = z.output<typeof workloadOperationV1Schema>;
export type WorkloadTriggerBindingV1 = z.output<
  typeof workloadTriggerBindingV1Schema
>;
export type WorkloadDownstreamActionBindingV1 = z.output<
  typeof workloadDownstreamActionBindingV1Schema
>;
export type WorkloadEnvironmentBindingV1 = z.output<
  typeof workloadEnvironmentBindingV1Schema
>;
export type WorkloadEnvironmentValueV1 = z.output<
  typeof workloadEnvironmentValueV1Schema
>;
export type WorkloadErrorBehaviorV1 = z.output<
  typeof workloadErrorBehaviorV1Schema
>;
export type WorkloadExecutionAssumptionsV1 = z.output<
  typeof workloadExecutionAssumptionsV1Schema
>;
export type WorkloadTimeoutAssumptionV1 = z.output<
  typeof workloadTimeoutAssumptionV1Schema
>;
export type WorkloadRetryAssumptionV1 = z.output<
  typeof workloadRetryAssumptionV1Schema
>;
export type WorkloadTriggerDispatchPolicyV1 = z.output<
  typeof workloadTriggerDispatchPolicyV1Schema
>;
export type WorkloadId = z.output<typeof workloadIdSchema>;
export type WorkloadOperationId = z.output<typeof workloadOperationIdSchema>;
export type WorkloadTriggerBindingId = z.output<
  typeof workloadTriggerBindingIdSchema
>;
export type WorkloadDownstreamActionBindingId = z.output<
  typeof workloadDownstreamActionBindingIdSchema
>;
export type WorkloadEnvironmentBindingId = z.output<
  typeof workloadEnvironmentBindingIdSchema
>;
