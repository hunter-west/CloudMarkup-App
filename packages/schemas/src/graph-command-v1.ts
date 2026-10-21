import { z } from "zod";

import { applicationContractsV1Schema } from "./application-contracts-v1.js";
import {
  actorIdSchema,
  architectureDocumentV1Schema,
  architectureEdgeV1Schema,
  architectureIdSchema,
  architectureNodeV1Schema,
  documentIdSchema,
  edgeIdSchema,
  elementOriginSchema,
  generatedElementLifecycleSchema,
  nodeIdSchema,
  nodeParentV1Schema,
  operationIdSchema,
  revisionIdSchema,
  serviceConfigurationRecordSchema,
  utcTimestampSchema,
  visualPositionSchema,
} from "./architecture-document-v1.js";
import { workloadBehaviorV2Schema } from "./workload-behavior-v2.js";

export const graphCommandTargetV1Schema = z
  .object({
    documentId: documentIdSchema,
    architectureId: architectureIdSchema,
    revisionId: revisionIdSchema,
  })
  .strict();

const graphCommandEnvelopeShape = {
  schemaVersion: z.literal(1),
  commandId: operationIdSchema,
  inverseCommandId: operationIdSchema,
  origin: elementOriginSchema,
  target: graphCommandTargetV1Schema,
} as const;

export const graphResourceReferenceV1Schema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("node"),
      nodeId: nodeIdSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("edge"),
      edgeId: edgeIdSchema,
    })
    .strict(),
]);

export const generatedDependencyReferenceV1Schema = z.discriminatedUnion(
  "kind",
  [
    z
      .object({
        kind: z.literal("node"),
        nodeId: nodeIdSchema,
      })
      .strict(),
    z
      .object({
        kind: z.literal("edge"),
        edgeId: edgeIdSchema,
      })
      .strict(),
  ],
);

export const generatedResourceReleaseDispositionV1Schema = z.enum([
  "removed",
  "retained",
]);

export const addNodeCommandV1Schema = z
  .object({
    ...graphCommandEnvelopeShape,
    kind: z.literal("add-node"),
    node: architectureNodeV1Schema,
  })
  .strict();

export const removeNodeCommandV1Schema = z
  .object({
    ...graphCommandEnvelopeShape,
    kind: z.literal("remove-node"),
    nodeId: nodeIdSchema,
    expectedNode: architectureNodeV1Schema,
  })
  .strict();

export const updateNodeConfigurationCommandV1Schema = z
  .object({
    ...graphCommandEnvelopeShape,
    kind: z.literal("update-node-configuration"),
    nodeId: nodeIdSchema,
    expectedConfiguration: serviceConfigurationRecordSchema,
    configuration: serviceConfigurationRecordSchema,
  })
  .strict();

export const moveNodeCommandV1Schema = z
  .object({
    ...graphCommandEnvelopeShape,
    kind: z.literal("move-node"),
    nodeId: nodeIdSchema,
    expectedPosition: visualPositionSchema,
    position: visualPositionSchema,
  })
  .strict();

export const reparentNodeCommandV1Schema = z
  .object({
    ...graphCommandEnvelopeShape,
    kind: z.literal("reparent-node"),
    nodeId: nodeIdSchema,
    expectedParent: nodeParentV1Schema.nullable(),
    parent: nodeParentV1Schema.nullable(),
  })
  .strict();

export const addEdgeCommandV1Schema = z
  .object({
    ...graphCommandEnvelopeShape,
    kind: z.literal("add-edge"),
    edge: architectureEdgeV1Schema,
  })
  .strict();

export const removeEdgeCommandV1Schema = z
  .object({
    ...graphCommandEnvelopeShape,
    kind: z.literal("remove-edge"),
    edgeId: edgeIdSchema,
    expectedEdge: architectureEdgeV1Schema,
  })
  .strict();

export const updateEdgeConfigurationCommandV1Schema = z
  .object({
    ...graphCommandEnvelopeShape,
    kind: z.literal("update-edge-configuration"),
    edgeId: edgeIdSchema,
    expectedConfiguration: serviceConfigurationRecordSchema,
    configuration: serviceConfigurationRecordSchema,
  })
  .strict();

export const replaceCatalogBindingCommandV1Schema = z
  .object({
    ...graphCommandEnvelopeShape,
    kind: z.literal("replace-catalog-binding"),
    expectedCatalog: architectureDocumentV1Schema.shape.catalog,
    catalog: architectureDocumentV1Schema.shape.catalog,
  })
  .strict();

export const replaceWorkloadAndApplicationContractsCommandV1Schema = z
  .object({
    ...graphCommandEnvelopeShape,
    kind: z.literal("replace-workload-and-application-contracts"),
    expectedWorkloadBehavior: workloadBehaviorV2Schema,
    workloadBehavior: workloadBehaviorV2Schema,
    expectedApplicationContracts: applicationContractsV1Schema,
    applicationContracts: applicationContractsV1Schema,
  })
  .strict();

export const adoptGeneratedResourceCommandV1Schema = z
  .object({
    ...graphCommandEnvelopeShape,
    kind: z.literal("adopt-generated-resource"),
    resource: graphResourceReferenceV1Schema,
    expectedLifecycle: generatedElementLifecycleSchema,
    adoptedBy: actorIdSchema,
    adoptedAt: utcTimestampSchema,
  })
  .strict();

export const releaseGeneratedResourceCommandV1Schema = z
  .object({
    ...graphCommandEnvelopeShape,
    kind: z.literal("release-generated-resource"),
    resource: graphResourceReferenceV1Schema,
    expectedLifecycle: generatedElementLifecycleSchema,
    dependencies: z.array(generatedDependencyReferenceV1Schema).max(256),
    requiredDisposition: generatedResourceReleaseDispositionV1Schema,
  })
  .strict();

export const graphCommandActionV1Schema = z.discriminatedUnion("kind", [
  addNodeCommandV1Schema,
  removeNodeCommandV1Schema,
  updateNodeConfigurationCommandV1Schema,
  moveNodeCommandV1Schema,
  reparentNodeCommandV1Schema,
  addEdgeCommandV1Schema,
  removeEdgeCommandV1Schema,
  updateEdgeConfigurationCommandV1Schema,
  replaceWorkloadAndApplicationContractsCommandV1Schema,
  replaceCatalogBindingCommandV1Schema,
  adoptGeneratedResourceCommandV1Schema,
  releaseGeneratedResourceCommandV1Schema,
]);

export const graphCommandBatchV1Schema = z
  .object({
    ...graphCommandEnvelopeShape,
    kind: z.literal("batch"),
    commands: z.array(graphCommandActionV1Schema).min(1).max(256),
  })
  .strict();

export const graphCommandV1Schema = z.discriminatedUnion("kind", [
  ...graphCommandActionV1Schema.options,
  graphCommandBatchV1Schema,
]);

export type GraphResourceReferenceV1 = z.output<
  typeof graphResourceReferenceV1Schema
>;
export type GraphCommandTargetV1 = z.output<typeof graphCommandTargetV1Schema>;
export type GeneratedDependencyReferenceV1 = z.output<
  typeof generatedDependencyReferenceV1Schema
>;
export type GeneratedResourceReleaseDispositionV1 = z.output<
  typeof generatedResourceReleaseDispositionV1Schema
>;
export type AddNodeCommandV1 = z.output<typeof addNodeCommandV1Schema>;
export type RemoveNodeCommandV1 = z.output<typeof removeNodeCommandV1Schema>;
export type UpdateNodeConfigurationCommandV1 = z.output<
  typeof updateNodeConfigurationCommandV1Schema
>;
export type MoveNodeCommandV1 = z.output<typeof moveNodeCommandV1Schema>;
export type ReparentNodeCommandV1 = z.output<
  typeof reparentNodeCommandV1Schema
>;
export type AddEdgeCommandV1 = z.output<typeof addEdgeCommandV1Schema>;
export type RemoveEdgeCommandV1 = z.output<typeof removeEdgeCommandV1Schema>;
export type UpdateEdgeConfigurationCommandV1 = z.output<
  typeof updateEdgeConfigurationCommandV1Schema
>;
export type ReplaceCatalogBindingCommandV1 = z.output<
  typeof replaceCatalogBindingCommandV1Schema
>;
export type ReplaceWorkloadAndApplicationContractsCommandV1 = z.output<
  typeof replaceWorkloadAndApplicationContractsCommandV1Schema
>;
export type AdoptGeneratedResourceCommandV1 = z.output<
  typeof adoptGeneratedResourceCommandV1Schema
>;
export type ReleaseGeneratedResourceCommandV1 = z.output<
  typeof releaseGeneratedResourceCommandV1Schema
>;
export type GraphCommandActionV1 = z.output<typeof graphCommandActionV1Schema>;
export type GraphCommandBatchV1 = z.output<typeof graphCommandBatchV1Schema>;
export type GraphCommandV1 = z.output<typeof graphCommandV1Schema>;

export function generateGraphCommandV1JsonSchema() {
  const generated = z.toJSONSchema(graphCommandV1Schema, {
    io: "input",
    target: "draft-2020-12",
  });

  return {
    ...generated,
    $id: "https://schemas.cloudmarkup.com/graph-command/v1.schema.json",
    title: "Cloud Markup Graph Command v1",
  };
}
