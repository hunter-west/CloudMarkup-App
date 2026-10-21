import {
  applyGraphCommand,
  getArchitectureDocumentContentHash,
  type ArchitectureConfiguration,
  type ArchitectureDocument,
  type ArchitectureEdge,
  type ArchitectureNode,
} from "@cloudmarkup/domain";
import {
  parseGraphCommandV1,
  configurationValueSchema,
  serializeCanonicalJson,
  type GraphCommandBatchV1,
  type GraphResourceReferenceV1,
} from "@cloudmarkup/schemas";

import type { EditorCatalogRelationship } from "./editor-catalog.js";
import {
  findProjectedPolicy,
  projectOwnedPolicyConfigurations,
  projectOwnedPolicyConfigurationsForEditing,
  type ExactPolicyChildRelationshipDescriptor,
  type ExactPolicyNodeKindDescriptor,
  type ExactPolicyResourceScopeDescriptor,
  type OwnedPolicyGraphDescriptorSet,
  type ProjectedOwnedConfiguration,
  type ProjectedOwnedPolicy,
  type ProjectedPolicyStatement,
} from "./owned-configuration-policy-model.js";

export interface GraphCommandOperationIdentity {
  readonly commandId: string;
  readonly inverseCommandId: string;
}

export interface GraphCommandBatchOperationIdentities {
  readonly batch: GraphCommandOperationIdentity;
  readonly actions: readonly GraphCommandOperationIdentity[];
}

export interface StablePolicyNodeIdentity {
  readonly nodeId: string;
  readonly deploymentKey: string;
  readonly label: string;
  readonly position: {
    readonly x: number;
    readonly y: number;
  };
}

export type StableOwnedConfigurationNodeIdentity = StablePolicyNodeIdentity;

export type OwnedPolicyCommandIssueCode =
  | "cardinality-violation"
  | "descriptor-mismatch"
  | "generated-descendant"
  | "identity-conflict"
  | "invalid-command"
  | "invalid-operation-identities"
  | "invalid-projection"
  | "no-change"
  | "stable-identity-mapping-mismatch"
  | "target-not-found"
  | "unexpected-reference"
  | "user-owned-policy-required"
  | "user-owned-configuration-required";

export interface OwnedPolicyCommandIssue {
  readonly code: OwnedPolicyCommandIssueCode;
  readonly message: string;
  readonly path: string;
}

export type OwnedPolicyCommandPreparationResult =
  | {
      readonly status: "ready";
      readonly command: GraphCommandBatchV1;
      readonly previewDocument: ArchitectureDocument;
      readonly baseContentHash: string;
      readonly previewContentHash: string;
    }
  | {
      readonly status: "adopt-before-customize";
      readonly resource: GraphResourceReferenceV1;
      readonly reason: string;
    }
  | {
      readonly status: "invalid";
      readonly issues: readonly OwnedPolicyCommandIssue[];
    };

export type OwnedConfigurationCommandPreparationResult =
  OwnedPolicyCommandPreparationResult;

interface CommandActionPayload {
  readonly kind: string;
  readonly [key: string]: unknown;
}

interface CommonCommandInput {
  readonly document: ArchitectureDocument;
  readonly descriptors: OwnedPolicyGraphDescriptorSet;
  readonly operationIdentities: GraphCommandBatchOperationIdentities;
}

export interface PrepareUserOwnedConfigurationCreateInput extends CommonCommandInput {
  readonly ownerNodeId: string;
  readonly slotId: string;
  readonly ownedKindId: string;
  readonly ownedConfiguration: StableOwnedConfigurationNodeIdentity & {
    readonly configuration: ArchitectureConfiguration;
  };
  readonly ownerBindingEdgeId: string;
}

export interface PrepareUserOwnedConfigurationEditInput extends CommonCommandInput {
  readonly configurationNodeId: string;
  readonly configuration: ArchitectureConfiguration;
}

export interface PrepareUserOwnedConfigurationRemoveInput extends CommonCommandInput {
  readonly associationRelationships?: readonly EditorCatalogRelationship[];
  readonly configurationNodeId: string;
}

export type OwnedConfigurationAssociationCleanupKind =
  "blocked" | "release-generated-direct-edge" | "remove-user-edge";

export interface OwnedConfigurationAssociationInspection {
  readonly cleanupKind: OwnedConfigurationAssociationCleanupKind;
  readonly edge: ArchitectureEdge;
  readonly reason: string | null;
  readonly relatedNode: ArchitectureNode | null;
  readonly relationship: EditorCatalogRelationship | null;
}

export interface InspectOwnedConfigurationAssociationsInput {
  readonly associationRelationships?: readonly EditorCatalogRelationship[];
  readonly configurationNodeId: string;
  readonly document: ArchitectureDocument;
  readonly ownerBindingEdgeId: string;
}

export interface PrepareUserPolicyCreationInput extends CommonCommandInput {
  readonly ownerNodeId: string;
  readonly slotId: string;
  readonly policyOwnedKindId: string;
  readonly policy: StablePolicyNodeIdentity & {
    readonly configuration: ArchitectureConfiguration;
  };
  readonly initialStatement: StablePolicyNodeIdentity & {
    readonly configuration: ArchitectureConfiguration;
  };
  readonly ownerBindingEdgeId: string;
  readonly statementMembershipEdgeId: string;
}

export interface PreparePolicyStatementAddInput extends CommonCommandInput {
  readonly policyNodeId: string;
  readonly statement: StablePolicyNodeIdentity & {
    readonly configuration: ArchitectureConfiguration;
  };
  readonly membershipEdgeId: string;
}

export interface PreparePolicyStatementEditInput extends CommonCommandInput {
  readonly policyNodeId: string;
  readonly statementNodeId: string;
  readonly configuration: ArchitectureConfiguration;
}

export interface PreparePolicyStatementDuplicateInput extends CommonCommandInput {
  readonly policyNodeId: string;
  readonly statementNodeId: string;
  readonly duplicateStatement: StablePolicyNodeIdentity;
  readonly membershipEdgeId: string;
  readonly conditions: readonly {
    readonly sourceConditionNodeId: string;
    readonly duplicateCondition: StablePolicyNodeIdentity;
    readonly membershipEdgeId: string;
  }[];
  readonly resourceScopes: readonly {
    readonly sourceScopeEdgeId: string;
    readonly duplicateScopeEdgeId: string;
  }[];
}

export interface PreparePolicyStatementRemoveInput extends CommonCommandInput {
  readonly policyNodeId: string;
  readonly statementNodeId: string;
}

export interface PreparePolicyConditionAddInput extends CommonCommandInput {
  readonly policyNodeId: string;
  readonly statementNodeId: string;
  readonly condition: StablePolicyNodeIdentity & {
    readonly configuration: ArchitectureConfiguration;
  };
  readonly membershipEdgeId: string;
}

export interface PreparePolicyConditionRemoveInput extends CommonCommandInput {
  readonly policyNodeId: string;
  readonly statementNodeId: string;
  readonly conditionNodeId: string;
}

export interface PreparePolicyResourceScopeSetInput extends CommonCommandInput {
  readonly policyNodeId: string;
  readonly statementNodeId: string;
  /** Existing exact scope-edge IDs are reused; new IDs are caller supplied. */
  readonly scopeEdgeId: string;
  readonly resourceScopeDescriptorId: string;
  readonly resourceNodeId: string;
}

export interface PrepareUserPolicyRemoveInput extends CommonCommandInput {
  readonly policyNodeId: string;
}

function compareUtf16(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

function clone<T>(value: T): T {
  return JSON.parse(serializeCanonicalJson(value)) as T;
}

function invalid(
  code: OwnedPolicyCommandIssueCode,
  path: string,
  message: string,
): OwnedPolicyCommandPreparationResult {
  return Object.freeze({
    status: "invalid",
    issues: Object.freeze([{ code, message, path }]),
  });
}

function generated(
  resource: GraphResourceReferenceV1,
): OwnedPolicyCommandPreparationResult {
  return Object.freeze({
    status: "adopt-before-customize",
    resource: clone(resource),
    reason:
      "This generated policy resource is read-only. Adopt it through the reviewed lifecycle workflow before customizing it.",
  });
}

function allOperationIdentitiesAreValid(
  identities: GraphCommandBatchOperationIdentities,
  actionCount: number,
): boolean {
  if (identities.actions.length !== actionCount) {
    return false;
  }
  const values = [
    identities.batch.commandId,
    identities.batch.inverseCommandId,
    ...identities.actions.flatMap((identity) => [
      identity.commandId,
      identity.inverseCommandId,
    ]),
  ];
  return (
    values.every((value) => value.length > 0) &&
    new Set(values).size === values.length
  );
}

function target(document: ArchitectureDocument) {
  return {
    documentId: document.documentId,
    architectureId: document.architectureId,
    revisionId: document.revision.revisionId,
  };
}

function finalizeBatch(
  document: ArchitectureDocument,
  descriptors: OwnedPolicyGraphDescriptorSet,
  operationIdentities: GraphCommandBatchOperationIdentities,
  payloads: readonly CommandActionPayload[],
): OwnedPolicyCommandPreparationResult {
  if (!allOperationIdentitiesAreValid(operationIdentities, payloads.length)) {
    return invalid(
      "invalid-operation-identities",
      "$.operationIdentities",
      "The caller must supply one distinct command/inverse identity pair for the batch and every atomic action.",
    );
  }
  const commandTarget = target(document);
  try {
    const parsed = parseGraphCommandV1({
      schemaVersion: 1,
      commandId: operationIdentities.batch.commandId,
      inverseCommandId: operationIdentities.batch.inverseCommandId,
      origin: "user",
      target: commandTarget,
      kind: "batch",
      commands: payloads.map((payload, index) => ({
        schemaVersion: 1,
        commandId: operationIdentities.actions[index]?.commandId,
        inverseCommandId: operationIdentities.actions[index]?.inverseCommandId,
        origin: "user",
        target: commandTarget,
        ...payload,
      })),
    });
    if (parsed.kind !== "batch") {
      return invalid(
        "invalid-command",
        "$.kind",
        "The Graph Command v1 parser did not return an atomic batch.",
      );
    }
    const application = applyGraphCommand(document, parsed);
    const projected = projectOwnedPolicyConfigurations(
      application.document,
      descriptors,
    );
    if (!projected.success) {
      const before = projectOwnedPolicyConfigurationsForEditing(
        document,
        descriptors,
      );
      const after = projectOwnedPolicyConfigurationsForEditing(
        application.document,
        descriptors,
      );
      const requirementsPreserved =
        before.success &&
        after.success &&
        descriptors.ownedConfigurations.slots.every((slot) =>
          application.document.nodes
            .filter(
              (owner) =>
                owner.semantic.serviceType === slot.ownerServiceType &&
                owner.semantic.resourceType === slot.ownerResourceType,
            )
            .every((owner) => {
              const priorOwner = document.nodes.some(
                (node) =>
                  node.id === owner.id &&
                  node.semantic.serviceType === slot.ownerServiceType &&
                  node.semantic.resourceType === slot.ownerResourceType,
              );
              const count = (projection: typeof before) =>
                projection.configurations.filter(
                  (entry) =>
                    entry.ownerNodeId === owner.id && entry.slotId === slot.id,
                ).length;
              const priorDeficit = priorOwner
                ? Math.max(0, slot.cardinality.minimum - count(before))
                : 0;
              return (
                Math.max(0, slot.cardinality.minimum - count(after)) <=
                priorDeficit
              );
            }),
        );
      if (!requirementsPreserved) {
        const findings = !before.success
          ? before.findings
          : !after.success
            ? after.findings
            : projected.findings;
        return Object.freeze({
          status: "invalid",
          issues: Object.freeze(
            findings.map((entry) => ({
              code: "invalid-projection" as const,
              message: entry.message,
              path: entry.path,
            })),
          ),
        });
      }
    }
    return Object.freeze({
      status: "ready",
      command: parsed,
      previewDocument: application.document,
      baseContentHash: getArchitectureDocumentContentHash(document),
      previewContentHash: getArchitectureDocumentContentHash(
        application.document,
      ),
    });
  } catch {
    return invalid(
      "invalid-command",
      "$.command",
      "The proposed atomic batch was rejected by the Graph Command v1 contract or domain invariants.",
    );
  }
}

function userLifecycle() {
  return { ownership: "user" as const, origin: "user" as const };
}

function configurationMatches(
  configuration: ArchitectureConfiguration,
  descriptor: ExactPolicyNodeKindDescriptor,
): boolean {
  return (
    configuration.schemaId === descriptor.configurationSchemaId &&
    configuration.schemaVersion === descriptor.configurationSchemaVersion
  );
}

function userNode(
  descriptor: ExactPolicyNodeKindDescriptor,
  identity: StablePolicyNodeIdentity,
  configuration: ArchitectureConfiguration,
  parent:
    | {
        readonly nodeId: string;
        readonly relationshipType: string;
      }
    | undefined,
): CommandActionPayload {
  return {
    kind: "add-node",
    node: {
      id: identity.nodeId,
      semantic: {
        deploymentKey: identity.deploymentKey,
        serviceType: descriptor.serviceType,
        resourceType: descriptor.resourceType,
        configuration: clone(configuration),
        ...(parent === undefined ? {} : { parent }),
        lifecycle: userLifecycle(),
      },
      presentation: {
        label: identity.label,
        position: clone(identity.position),
      },
    },
  };
}

function relationshipEndpoints(
  childNodeId: string,
  parentNodeId: string,
  descriptor: ExactPolicyChildRelationshipDescriptor,
) {
  const child = { nodeId: childNodeId, port: descriptor.childPort };
  const parent = { nodeId: parentNodeId, port: descriptor.parentPort };
  return descriptor.childEndpoint === "source"
    ? { source: child, target: parent }
    : { source: parent, target: child };
}

function userChildEdge(
  edgeId: string,
  childNodeId: string,
  parentNodeId: string,
  descriptor: ExactPolicyChildRelationshipDescriptor,
): CommandActionPayload {
  return {
    kind: "add-edge",
    edge: {
      id: edgeId,
      semantic: {
        ...relationshipEndpoints(childNodeId, parentNodeId, descriptor),
        relationshipType: descriptor.relationshipType,
        configuration: clone(descriptor.edgeConfiguration),
        lifecycle: userLifecycle(),
      },
    },
  };
}

function duplicateUserChildEdge(
  sourceEdge: ArchitectureEdge,
  edgeId: string,
  childNodeId: string,
  parentNodeId: string,
  descriptor: ExactPolicyChildRelationshipDescriptor,
): CommandActionPayload {
  const edge = clone(sourceEdge);
  return {
    kind: "add-edge",
    edge: {
      ...edge,
      id: edgeId,
      semantic: {
        ...edge.semantic,
        ...relationshipEndpoints(childNodeId, parentNodeId, descriptor),
        lifecycle: userLifecycle(),
      },
    },
  };
}

function ownedSlotEndpoints(
  configurationNodeId: string,
  ownerNodeId: string,
  slot: OwnedPolicyGraphDescriptorSet["ownedConfigurations"]["slots"][number],
) {
  const configuration = {
    nodeId: configurationNodeId,
    port: slot.configurationPort,
  };
  const owner = { nodeId: ownerNodeId, port: slot.ownerPort };
  return slot.configurationEndpoint === "source"
    ? { source: configuration, target: owner }
    : { source: owner, target: configuration };
}

function resolvePolicy(
  document: ArchitectureDocument,
  descriptors: OwnedPolicyGraphDescriptorSet,
  policyNodeId: string,
):
  | { readonly status: "found"; readonly policy: ProjectedOwnedPolicy }
  | OwnedPolicyCommandPreparationResult {
  const projection = projectOwnedPolicyConfigurationsForEditing(
    document,
    descriptors,
  );
  if (!projection.success) {
    return Object.freeze({
      status: "invalid",
      issues: Object.freeze(
        projection.findings.map((entry) => ({
          code: "invalid-projection" as const,
          message: entry.message,
          path: entry.path,
        })),
      ),
    });
  }
  const policy = findProjectedPolicy(projection, policyNodeId);
  if (policy === undefined) {
    return invalid(
      "target-not-found",
      "$.policyNodeId",
      "The exact graph-backed policy is not available in the current document.",
    );
  }
  return { status: "found", policy };
}

function resolveOwnedConfiguration(
  document: ArchitectureDocument,
  descriptors: OwnedPolicyGraphDescriptorSet,
  configurationNodeId: string,
):
  | {
      readonly status: "found";
      readonly configuration: ProjectedOwnedConfiguration;
    }
  | OwnedPolicyCommandPreparationResult {
  const projection = projectOwnedPolicyConfigurationsForEditing(
    document,
    descriptors,
  );
  if (!projection.success) {
    return Object.freeze({
      status: "invalid",
      issues: Object.freeze(
        projection.findings.map((entry) => ({
          code: "invalid-projection" as const,
          message: entry.message,
          path: entry.path,
        })),
      ),
    });
  }
  const configuration = projection.configurations.find(
    (candidate) => candidate.configurationNode.id === configurationNodeId,
  );
  if (configuration === undefined) {
    return invalid(
      "target-not-found",
      "$.configurationNodeId",
      "The exact graph-backed owned configuration is not available in the current document.",
    );
  }
  return { status: "found", configuration };
}

function resolveStatement(
  policy: ProjectedOwnedPolicy,
  statementNodeId: string,
): ProjectedPolicyStatement | undefined {
  return policy.statements.find(
    (statement) => statement.node.id === statementNodeId,
  );
}

function generatedNodeResult(
  node: ArchitectureNode,
): OwnedPolicyCommandPreparationResult | undefined {
  return node.semantic.lifecycle.ownership === "generated"
    ? generated({ kind: "node", nodeId: node.id })
    : undefined;
}

function generatedEdgeResult(
  edge: ArchitectureEdge,
): OwnedPolicyCommandPreparationResult | undefined {
  return edge.semantic.lifecycle.ownership === "generated"
    ? generated({ kind: "edge", edgeId: edge.id })
    : undefined;
}

function newIdentityConflicts(
  document: ArchitectureDocument,
  nodeIdentities: readonly StablePolicyNodeIdentity[],
  edgeIds: readonly string[],
): boolean {
  const existingNodeIds = new Set<string>(
    document.nodes.map((node) => node.id),
  );
  const existingDeploymentKeys = new Set<string>(
    document.nodes.map((node) => node.semantic.deploymentKey),
  );
  const existingEdgeIds = new Set<string>(
    document.edges.map((edge) => edge.id),
  );
  const nodeIds = nodeIdentities.map((identity) => identity.nodeId);
  const deploymentKeys = nodeIdentities.map(
    (identity) => identity.deploymentKey,
  );
  return (
    nodeIds.some((id) => existingNodeIds.has(id)) ||
    deploymentKeys.some((key) => existingDeploymentKeys.has(key)) ||
    edgeIds.some((id) => existingEdgeIds.has(id)) ||
    new Set(nodeIds).size !== nodeIds.length ||
    new Set(deploymentKeys).size !== deploymentKeys.length ||
    new Set(edgeIds).size !== edgeIds.length
  );
}

export function prepareUserOwnedConfigurationCreate(
  input: PrepareUserOwnedConfigurationCreateInput,
): OwnedConfigurationCommandPreparationResult {
  const owner = input.document.nodes.find(
    (node) => node.id === input.ownerNodeId,
  );
  const slot = input.descriptors.ownedConfigurations.slots.find(
    (candidate) => candidate.id === input.slotId,
  );
  const kind = input.descriptors.ownedConfigurations.kinds.find(
    (candidate) => candidate.id === input.ownedKindId,
  );
  const slotBinding = input.descriptors.slotBindings.find(
    (candidate) => candidate.slotId === input.slotId,
  );
  if (owner === undefined) {
    return invalid(
      "target-not-found",
      "$.ownerNodeId",
      "The exact owned-configuration owner is not available in the current document.",
    );
  }
  if (
    slot === undefined ||
    kind === undefined ||
    slotBinding === undefined ||
    !kind.allowedOwnership.includes("user") ||
    !slot.configurationKindIds.includes(kind.id) ||
    owner.semantic.serviceType !== slot.ownerServiceType ||
    owner.semantic.resourceType !== slot.ownerResourceType
  ) {
    return invalid(
      "descriptor-mismatch",
      "$.slotId",
      "The selected owner, kind, and exact owned-configuration slot do not match or do not permit user ownership.",
    );
  }
  const nodeDescriptor: ExactPolicyNodeKindDescriptor = {
    id: kind.id,
    serviceType: kind.nodeServiceType,
    resourceType: kind.nodeResourceType,
    configurationSchemaId: kind.configurationSchemaId,
    configurationSchemaVersion: kind.configurationSchemaVersion,
  };
  if (
    !configurationMatches(
      input.ownedConfiguration.configuration,
      nodeDescriptor,
    )
  ) {
    return invalid(
      "descriptor-mismatch",
      "$.ownedConfiguration.configuration",
      "The owned configuration must match its exact versioned kind descriptor.",
    );
  }
  const currentProjection = projectOwnedPolicyConfigurationsForEditing(
    input.document,
    input.descriptors,
  );
  if (!currentProjection.success) {
    return Object.freeze({
      status: "invalid",
      issues: Object.freeze(
        currentProjection.findings.map((entry) => ({
          code: "invalid-projection" as const,
          message: entry.message,
          path: entry.path,
        })),
      ),
    });
  }
  const currentCount = currentProjection.configurations.filter(
    (configuration) =>
      configuration.ownerNodeId === owner.id &&
      configuration.slotId === slot.id,
  ).length;
  if (
    slot.cardinality.maximum !== null &&
    currentCount >= slot.cardinality.maximum
  ) {
    return invalid(
      "cardinality-violation",
      "$.slotId",
      "The selected owner slot already has the maximum number of owned configurations permitted by its exact descriptor.",
    );
  }
  if (
    newIdentityConflicts(
      input.document,
      [input.ownedConfiguration],
      [input.ownerBindingEdgeId],
    )
  ) {
    return invalid(
      "identity-conflict",
      "$.ownedConfiguration",
      "Caller-supplied owned-configuration, deployment, and owner-edge identities must be new and unique.",
    );
  }
  const parent =
    slot.parentBinding === "required"
      ? { nodeId: owner.id, relationshipType: slot.relationshipType }
      : undefined;
  return finalizeBatch(
    input.document,
    input.descriptors,
    input.operationIdentities,
    [
      userNode(
        nodeDescriptor,
        input.ownedConfiguration,
        input.ownedConfiguration.configuration,
        parent,
      ),
      {
        kind: "add-edge",
        edge: {
          id: input.ownerBindingEdgeId,
          semantic: {
            ...ownedSlotEndpoints(
              input.ownedConfiguration.nodeId,
              owner.id,
              slot,
            ),
            relationshipType: slot.relationshipType,
            configuration: clone(slotBinding.edgeConfiguration),
            lifecycle: userLifecycle(),
          },
        },
      },
    ],
  );
}

export function prepareUserOwnedConfigurationEdit(
  input: PrepareUserOwnedConfigurationEditInput,
): OwnedConfigurationCommandPreparationResult {
  const resolved = resolveOwnedConfiguration(
    input.document,
    input.descriptors,
    input.configurationNodeId,
  );
  if (resolved.status !== "found") {
    return resolved;
  }
  const node = resolved.configuration.configurationNode;
  const blocked = generatedNodeResult(node);
  if (blocked !== undefined) {
    return blocked;
  }
  if (node.semantic.lifecycle.ownership !== "user") {
    return invalid(
      "user-owned-configuration-required",
      "$.configurationNodeId",
      "This command edits only explicitly user-owned configurations.",
    );
  }
  const kind = input.descriptors.ownedConfigurations.kinds.find(
    (candidate) => candidate.id === resolved.configuration.kindId,
  );
  if (
    kind === undefined ||
    !configurationMatches(input.configuration, {
      id: kind.id,
      serviceType: kind.nodeServiceType,
      resourceType: kind.nodeResourceType,
      configurationSchemaId: kind.configurationSchemaId,
      configurationSchemaVersion: kind.configurationSchemaVersion,
    })
  ) {
    return invalid(
      "descriptor-mismatch",
      "$.configuration",
      "The replacement configuration must match the owned configuration's exact versioned kind descriptor.",
    );
  }
  if (
    serializeCanonicalJson(node.semantic.configuration) ===
    serializeCanonicalJson(input.configuration)
  ) {
    return invalid(
      "no-change",
      "$.configuration",
      "The proposed owned configuration does not change semantic graph content.",
    );
  }
  return finalizeBatch(
    input.document,
    input.descriptors,
    input.operationIdentities,
    [
      {
        kind: "update-node-configuration",
        nodeId: node.id,
        expectedConfiguration: clone(node.semantic.configuration),
        configuration: clone(input.configuration),
      },
    ],
  );
}

function relationshipMatchesAssociation(
  document: ArchitectureDocument,
  edge: ArchitectureEdge,
  relationship: EditorCatalogRelationship,
): boolean {
  const sourceNode = document.nodes.find(
    (node) => node.id === edge.semantic.source.nodeId,
  );
  const targetNode = document.nodes.find(
    (node) => node.id === edge.semantic.target.nodeId,
  );
  return (
    sourceNode !== undefined &&
    targetNode !== undefined &&
    edge.semantic.relationshipType === relationship.id &&
    edge.semantic.source.port === relationship.sourcePortId &&
    edge.semantic.target.port === relationship.targetPortId &&
    sourceNode.semantic.serviceType === relationship.sourceServiceType &&
    targetNode.semantic.serviceType === relationship.targetServiceType &&
    edge.semantic.configuration.schemaId ===
      relationship.configuration.schemaId &&
    edge.semantic.configuration.schemaVersion ===
      relationship.configuration.schemaVersion
  );
}

function lifecycleUsesGeneratedOperation(
  lifecycle: ArchitectureNode["semantic"]["lifecycle"],
  expected: Exclude<
    ArchitectureEdge["semantic"]["lifecycle"],
    { readonly ownership: "user" }
  >,
): boolean {
  return (
    lifecycle.ownership !== "user" &&
    lifecycle.origin === expected.origin &&
    lifecycle.provenance.generatorKind === expected.provenance.generatorKind &&
    lifecycle.provenance.generatorId === expected.provenance.generatorId &&
    lifecycle.provenance.generatorVersion ===
      expected.provenance.generatorVersion &&
    lifecycle.provenance.operationId === expected.provenance.operationId
  );
}

function edgeHasLiveReference(
  document: ArchitectureDocument,
  edge: ArchitectureEdge,
): boolean {
  return (
    document.nodes.some(
      (node) =>
        node.semantic.lifecycle.ownership !== "user" &&
        node.semantic.lifecycle.provenance.dependentEdgeIds.includes(edge.id),
    ) ||
    document.edges.some(
      (candidate) =>
        candidate.id !== edge.id &&
        candidate.semantic.lifecycle.ownership !== "user" &&
        candidate.semantic.lifecycle.provenance.dependentEdgeIds.includes(
          edge.id,
        ),
    ) ||
    document.workloadBehavior.workloads.some(
      (workload) =>
        workload.triggers.some((binding) => binding.edgeId === edge.id) ||
        workload.downstreamActions.some(
          (binding) => binding.edgeId === edge.id,
        ),
    )
  );
}

function directGeneratedAssociationIsAuthorized(
  document: ArchitectureDocument,
  edge: ArchitectureEdge,
  relationship: EditorCatalogRelationship,
): boolean {
  const lifecycle = edge.semantic.lifecycle;
  if (
    lifecycle.ownership !== "generated" ||
    lifecycle.origin !== "connection-rule" ||
    lifecycle.provenance.generatorKind !== "connection-rule" ||
    lifecycle.provenance.generatorId !== relationship.descriptorId ||
    lifecycle.provenance.generatorVersion !== relationship.ruleVersion ||
    edge.id !== `${String(lifecycle.provenance.operationId)}.edge.connection` ||
    relationship.implementation.status !== "implemented" ||
    relationship.supportingChanges.length !== 0 ||
    lifecycle.provenance.dependentEdgeIds.length !== 0 ||
    serializeCanonicalJson(
      [...lifecycle.provenance.dependentNodeIds].sort(compareUtf16),
    ) !==
      serializeCanonicalJson(
        [edge.semantic.source.nodeId, edge.semantic.target.nodeId].sort(
          compareUtf16,
        ),
      ) ||
    edgeHasLiveReference(document, edge)
  ) {
    return false;
  }
  const sameOperationResources = [
    ...document.nodes.filter((node) =>
      lifecycleUsesGeneratedOperation(node.semantic.lifecycle, lifecycle),
    ),
    ...document.edges.filter(
      (candidate) =>
        candidate.id !== edge.id &&
        lifecycleUsesGeneratedOperation(
          candidate.semantic.lifecycle,
          lifecycle,
        ),
    ),
  ];
  return sameOperationResources.length === 0;
}

/**
 * Inspects non-owner incident edges without inferring provider meaning. Exact
 * current-catalog relationships authorize a direct user disconnect or a
 * provenance-bound generated-edge release; every other edge blocks removal.
 */
export function inspectOwnedConfigurationAssociations({
  associationRelationships = [],
  configurationNodeId,
  document,
  ownerBindingEdgeId,
}: InspectOwnedConfigurationAssociationsInput): readonly OwnedConfigurationAssociationInspection[] {
  return Object.freeze(
    document.edges
      .filter(
        (edge) =>
          edge.id !== ownerBindingEdgeId &&
          (edge.semantic.source.nodeId === configurationNodeId ||
            edge.semantic.target.nodeId === configurationNodeId),
      )
      .sort((left, right) => compareUtf16(left.id, right.id))
      .map((edge) => {
        const matches = associationRelationships.filter((relationship) =>
          relationshipMatchesAssociation(document, edge, relationship),
        );
        const relationship = matches.length === 1 ? (matches[0] ?? null) : null;
        const relatedNodeId =
          edge.semantic.source.nodeId === configurationNodeId
            ? edge.semantic.target.nodeId
            : edge.semantic.source.nodeId;
        const relatedNode =
          document.nodes.find((node) => node.id === relatedNodeId) ?? null;
        if (relationship === null) {
          return Object.freeze({
            cleanupKind: "blocked" as const,
            edge,
            reason:
              matches.length > 1
                ? "This incident edge matches more than one current-catalog relationship and cannot be disconnected safely."
                : "This incident edge is not an exact current-catalog association and cannot be disconnected safely.",
            relatedNode,
            relationship,
          });
        }
        if (edgeHasLiveReference(document, edge)) {
          return Object.freeze({
            cleanupKind: "blocked" as const,
            edge,
            reason:
              "This association is referenced by generated or workload behavior and requires its separate reviewed cleanup workflow.",
            relatedNode,
            relationship,
          });
        }
        if (edge.semantic.lifecycle.ownership === "user") {
          return Object.freeze({
            cleanupKind: "remove-user-edge" as const,
            edge,
            reason: null,
            relatedNode,
            relationship,
          });
        }
        if (
          directGeneratedAssociationIsAuthorized(document, edge, relationship)
        ) {
          return Object.freeze({
            cleanupKind: "release-generated-direct-edge" as const,
            edge,
            reason: null,
            relatedNode,
            relationship,
          });
        }
        return Object.freeze({
          cleanupKind: "blocked" as const,
          edge,
          reason:
            edge.semantic.lifecycle.ownership === "adopted"
              ? "This adopted association is customized and must be disconnected explicitly before removing the configuration."
              : "This generated association is not an exact direct connection with an isolated reviewed cleanup path.",
          relatedNode,
          relationship,
        });
      }),
  );
}

function releaseGeneratedAssociationPayload(
  edge: ArchitectureEdge,
): CommandActionPayload {
  const lifecycle = edge.semantic.lifecycle;
  if (lifecycle.ownership !== "generated") {
    throw new TypeError(
      "Only an exact generated association can use generated-resource release.",
    );
  }
  return {
    kind: "release-generated-resource",
    origin: "connection-rule",
    resource: { kind: "edge", edgeId: edge.id },
    expectedLifecycle: clone(lifecycle),
    dependencies: [
      ...lifecycle.provenance.dependentNodeIds.map((nodeId) => ({
        kind: "node" as const,
        nodeId,
      })),
      ...lifecycle.provenance.dependentEdgeIds.map((edgeId) => ({
        kind: "edge" as const,
        edgeId,
      })),
    ],
    requiredDisposition: "removed",
  };
}
export function prepareUserOwnedConfigurationRemove(
  input: PrepareUserOwnedConfigurationRemoveInput,
): OwnedConfigurationCommandPreparationResult {
  const resolved = resolveOwnedConfiguration(
    input.document,
    input.descriptors,
    input.configurationNodeId,
  );
  if (resolved.status !== "found") {
    return resolved;
  }
  const configuration = resolved.configuration;
  const node = configuration.configurationNode;
  const blocked =
    generatedNodeResult(node) ?? generatedEdgeResult(configuration.bindingEdge);
  if (blocked !== undefined) {
    return blocked;
  }
  if (
    node.semantic.lifecycle.ownership !== "user" ||
    configuration.bindingEdge.semantic.lifecycle.ownership !== "user"
  ) {
    return invalid(
      "user-owned-configuration-required",
      "$.configurationNodeId",
      "Whole owned-configuration removal requires an explicitly user-owned node and owner edge.",
    );
  }
  if (input.descriptors.policyOwnedKindIds.includes(configuration.kindId)) {
    return invalid(
      "descriptor-mismatch",
      "$.configurationNodeId",
      "Structured policies require their policy-subtree removal workflow.",
    );
  }
  const slot = input.descriptors.ownedConfigurations.slots.find(
    (candidate) => candidate.id === configuration.slotId,
  );
  if (slot === undefined) {
    return invalid(
      "descriptor-mismatch",
      "$.configurationNodeId",
      "The owned configuration no longer resolves to an exact slot descriptor.",
    );
  }
  const projection = projectOwnedPolicyConfigurationsForEditing(
    input.document,
    input.descriptors,
  );
  if (!projection.success) {
    return invalid(
      "invalid-projection",
      "$.configurationNodeId",
      "The owned-configuration graph is invalid and cannot be removed safely.",
    );
  }
  const currentCount = projection.configurations.filter(
    (candidate) =>
      candidate.ownerNodeId === configuration.ownerNodeId &&
      candidate.slotId === configuration.slotId,
  ).length;
  if (currentCount - 1 < slot.cardinality.minimum) {
    return invalid(
      "cardinality-violation",
      "$.configurationNodeId",
      "Removing this owned configuration would violate the exact slot minimum.",
    );
  }
  const associations = inspectOwnedConfigurationAssociations({
    ...(input.associationRelationships === undefined
      ? {}
      : { associationRelationships: input.associationRelationships }),
    configurationNodeId: node.id,
    document: input.document,
    ownerBindingEdgeId: configuration.bindingEdge.id,
  });
  const blockedAssociation = associations.find(
    (association) => association.cleanupKind === "blocked",
  );
  if (blockedAssociation !== undefined) {
    return invalid(
      "unexpected-reference",
      `$.document.edges[${JSON.stringify(blockedAssociation.edge.id)}]`,
      blockedAssociation.reason ??
        "The owned configuration has an incident association without an authorized cleanup path.",
    );
  }
  const associationPayloads = associations.map((association) =>
    association.cleanupKind === "release-generated-direct-edge"
      ? releaseGeneratedAssociationPayload(association.edge)
      : removeEdgePayload(association.edge),
  );
  return finalizeBatch(
    input.document,
    input.descriptors,
    input.operationIdentities,
    [
      ...associationPayloads,
      removeEdgePayload(configuration.bindingEdge),
      removeNodePayload(node),
    ],
  );
}

export function prepareUserPolicyCreation(
  input: PrepareUserPolicyCreationInput,
): OwnedPolicyCommandPreparationResult {
  const owner = input.document.nodes.find(
    (node) => node.id === input.ownerNodeId,
  );
  const slot = input.descriptors.ownedConfigurations.slots.find(
    (candidate) => candidate.id === input.slotId,
  );
  const kind = input.descriptors.ownedConfigurations.kinds.find(
    (candidate) => candidate.id === input.policyOwnedKindId,
  );
  const slotBinding = input.descriptors.slotBindings.find(
    (candidate) => candidate.slotId === input.slotId,
  );
  if (owner === undefined) {
    return invalid(
      "target-not-found",
      "$.ownerNodeId",
      "The exact policy owner is not available in the current document.",
    );
  }
  if (
    slot === undefined ||
    kind === undefined ||
    slotBinding === undefined ||
    !input.descriptors.policyOwnedKindIds.includes(kind.id) ||
    !slot.configurationKindIds.includes(kind.id) ||
    owner.semantic.serviceType !== slot.ownerServiceType ||
    owner.semantic.resourceType !== slot.ownerResourceType
  ) {
    return invalid(
      "descriptor-mismatch",
      "$.slotId",
      "The selected owner, policy kind, and exact owned-configuration slot do not match.",
    );
  }
  if (
    !configurationMatches(input.policy.configuration, {
      id: kind.id,
      serviceType: kind.nodeServiceType,
      resourceType: kind.nodeResourceType,
      configurationSchemaId: kind.configurationSchemaId,
      configurationSchemaVersion: kind.configurationSchemaVersion,
    }) ||
    !configurationMatches(
      input.initialStatement.configuration,
      input.descriptors.statementKind,
    )
  ) {
    return invalid(
      "descriptor-mismatch",
      "$.configuration",
      "The policy and initial statement configurations must match their exact versioned node descriptors.",
    );
  }
  if (
    newIdentityConflicts(
      input.document,
      [input.policy, input.initialStatement],
      [input.ownerBindingEdgeId, input.statementMembershipEdgeId],
    )
  ) {
    return invalid(
      "identity-conflict",
      "$.policy",
      "Caller-supplied node, deployment, and edge identities must be new and unique.",
    );
  }

  const policyParent =
    slot.parentBinding === "required"
      ? { nodeId: owner.id, relationshipType: slot.relationshipType }
      : undefined;
  const statementParent =
    input.descriptors.statementMembership.childParentBinding === "required"
      ? {
          nodeId: input.policy.nodeId,
          relationshipType:
            input.descriptors.statementMembership.relationshipType,
        }
      : undefined;
  const policyDescriptor: ExactPolicyNodeKindDescriptor = {
    id: kind.id,
    serviceType: kind.nodeServiceType,
    resourceType: kind.nodeResourceType,
    configurationSchemaId: kind.configurationSchemaId,
    configurationSchemaVersion: kind.configurationSchemaVersion,
  };
  const payloads: CommandActionPayload[] = [
    userNode(
      policyDescriptor,
      input.policy,
      input.policy.configuration,
      policyParent,
    ),
    userNode(
      input.descriptors.statementKind,
      input.initialStatement,
      input.initialStatement.configuration,
      statementParent,
    ),
    {
      kind: "add-edge",
      edge: {
        id: input.ownerBindingEdgeId,
        semantic: {
          ...ownedSlotEndpoints(input.policy.nodeId, owner.id, slot),
          relationshipType: slot.relationshipType,
          configuration: clone(slotBinding.edgeConfiguration),
          lifecycle: userLifecycle(),
        },
      },
    },
    userChildEdge(
      input.statementMembershipEdgeId,
      input.initialStatement.nodeId,
      input.policy.nodeId,
      input.descriptors.statementMembership,
    ),
  ];
  return finalizeBatch(
    input.document,
    input.descriptors,
    input.operationIdentities,
    payloads,
  );
}

export function preparePolicyStatementAdd(
  input: PreparePolicyStatementAddInput,
): OwnedPolicyCommandPreparationResult {
  const resolved = resolvePolicy(
    input.document,
    input.descriptors,
    input.policyNodeId,
  );
  if (resolved.status !== "found") {
    return resolved;
  }
  const generatedPolicy = generatedNodeResult(
    resolved.policy.configurationNode,
  );
  if (generatedPolicy !== undefined) {
    return generatedPolicy;
  }
  if (
    !configurationMatches(
      input.statement.configuration,
      input.descriptors.statementKind,
    )
  ) {
    return invalid(
      "descriptor-mismatch",
      "$.statement.configuration",
      "The statement configuration must match the exact versioned statement descriptor.",
    );
  }
  const maximum = input.descriptors.statementMembership.cardinality.maximum;
  if (maximum !== null && resolved.policy.statements.length >= maximum) {
    return invalid(
      "cardinality-violation",
      "$.statement",
      "The policy already has the maximum number of statements allowed by the exact descriptor.",
    );
  }
  if (
    newIdentityConflicts(
      input.document,
      [input.statement],
      [input.membershipEdgeId],
    )
  ) {
    return invalid(
      "identity-conflict",
      "$.statement",
      "Caller-supplied statement, deployment, and membership identities must be new and unique.",
    );
  }
  const parent =
    input.descriptors.statementMembership.childParentBinding === "required"
      ? {
          nodeId: resolved.policy.configurationNode.id,
          relationshipType:
            input.descriptors.statementMembership.relationshipType,
        }
      : undefined;
  return finalizeBatch(
    input.document,
    input.descriptors,
    input.operationIdentities,
    [
      userNode(
        input.descriptors.statementKind,
        input.statement,
        input.statement.configuration,
        parent,
      ),
      userChildEdge(
        input.membershipEdgeId,
        input.statement.nodeId,
        resolved.policy.configurationNode.id,
        input.descriptors.statementMembership,
      ),
    ],
  );
}

export function preparePolicyStatementEdit(
  input: PreparePolicyStatementEditInput,
): OwnedPolicyCommandPreparationResult {
  const resolved = resolvePolicy(
    input.document,
    input.descriptors,
    input.policyNodeId,
  );
  if (resolved.status !== "found") {
    return resolved;
  }
  const generatedPolicy = generatedNodeResult(
    resolved.policy.configurationNode,
  );
  if (generatedPolicy !== undefined) {
    return generatedPolicy;
  }
  const statement = resolveStatement(resolved.policy, input.statementNodeId);
  if (statement === undefined) {
    return invalid(
      "target-not-found",
      "$.statementNodeId",
      "The exact policy statement is not available in the selected policy.",
    );
  }
  const generatedStatement = generatedNodeResult(statement.node);
  if (generatedStatement !== undefined) {
    return generatedStatement;
  }
  if (
    !configurationMatches(input.configuration, input.descriptors.statementKind)
  ) {
    return invalid(
      "descriptor-mismatch",
      "$.configuration",
      "The replacement configuration must match the exact versioned statement descriptor.",
    );
  }
  if (
    serializeCanonicalJson(statement.node.semantic.configuration) ===
    serializeCanonicalJson(input.configuration)
  ) {
    return invalid(
      "no-change",
      "$.configuration",
      "The proposed statement configuration does not change semantic graph content.",
    );
  }
  return finalizeBatch(
    input.document,
    input.descriptors,
    input.operationIdentities,
    [
      {
        kind: "update-node-configuration",
        nodeId: statement.node.id,
        expectedConfiguration: clone(statement.node.semantic.configuration),
        configuration: clone(input.configuration),
      },
    ],
  );
}

function exactStringSet(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    [...left]
      .sort(compareUtf16)
      .every((value, index) => value === [...right].sort(compareUtf16)[index])
  );
}

export function preparePolicyStatementDuplicate(
  input: PreparePolicyStatementDuplicateInput,
): OwnedPolicyCommandPreparationResult {
  const resolved = resolvePolicy(
    input.document,
    input.descriptors,
    input.policyNodeId,
  );
  if (resolved.status !== "found") {
    return resolved;
  }
  const generatedPolicy = generatedNodeResult(
    resolved.policy.configurationNode,
  );
  if (generatedPolicy !== undefined) {
    return generatedPolicy;
  }
  const source = resolveStatement(resolved.policy, input.statementNodeId);
  if (source === undefined) {
    return invalid(
      "target-not-found",
      "$.statementNodeId",
      "The exact source statement is not available in the selected policy.",
    );
  }
  const generatedSource =
    generatedNodeResult(source.node) ??
    generatedEdgeResult(source.membershipEdge);
  if (generatedSource !== undefined) {
    return generatedSource;
  }
  for (const condition of source.conditions) {
    const blocked =
      generatedNodeResult(condition.node) ??
      generatedEdgeResult(condition.membershipEdge);
    if (blocked !== undefined) {
      return blocked;
    }
  }
  for (const scope of source.resourceScopes) {
    const blocked = generatedEdgeResult(scope.edge);
    if (blocked !== undefined) {
      return blocked;
    }
  }
  const maximum = input.descriptors.statementMembership.cardinality.maximum;
  if (maximum !== null && resolved.policy.statements.length >= maximum) {
    return invalid(
      "cardinality-violation",
      "$.duplicateStatement",
      "The policy already has the maximum number of statements allowed by the exact descriptor.",
    );
  }
  if (
    !exactStringSet(
      source.conditions.map((condition) => condition.node.id),
      input.conditions.map((condition) => condition.sourceConditionNodeId),
    ) ||
    !exactStringSet(
      source.resourceScopes.map((scope) => scope.edge.id),
      input.resourceScopes.map((scope) => scope.sourceScopeEdgeId),
    )
  ) {
    return invalid(
      "stable-identity-mapping-mismatch",
      "$.conditions",
      "Duplication must supply exactly one stable identity mapping for every condition and resource-scope edge in the source subtree.",
    );
  }
  const sortedConditions = [...input.conditions].sort((left, right) =>
    compareUtf16(left.sourceConditionNodeId, right.sourceConditionNodeId),
  );
  const sortedScopes = [...input.resourceScopes].sort((left, right) =>
    compareUtf16(left.sourceScopeEdgeId, right.sourceScopeEdgeId),
  );
  const nodeIdentities = [
    input.duplicateStatement,
    ...sortedConditions.map((condition) => condition.duplicateCondition),
  ];
  const edgeIds = [
    input.membershipEdgeId,
    ...sortedConditions.map((condition) => condition.membershipEdgeId),
    ...sortedScopes.map((scope) => scope.duplicateScopeEdgeId),
  ];
  if (newIdentityConflicts(input.document, nodeIdentities, edgeIds)) {
    return invalid(
      "identity-conflict",
      "$.duplicateStatement",
      "All duplicate subtree node, deployment, and edge identities must be new and unique.",
    );
  }

  const statementParent =
    input.descriptors.statementMembership.childParentBinding === "required"
      ? {
          nodeId: resolved.policy.configurationNode.id,
          relationshipType:
            input.descriptors.statementMembership.relationshipType,
        }
      : undefined;
  const nodePayloads: CommandActionPayload[] = [
    userNode(
      input.descriptors.statementKind,
      input.duplicateStatement,
      source.node.semantic.configuration,
      statementParent,
    ),
  ];
  sortedConditions.forEach((mapping) => {
    const sourceCondition = source.conditions.find(
      (condition) => condition.node.id === mapping.sourceConditionNodeId,
    );
    if (sourceCondition !== undefined) {
      const conditionParent =
        input.descriptors.conditionMembership.childParentBinding === "required"
          ? {
              nodeId: input.duplicateStatement.nodeId,
              relationshipType:
                input.descriptors.conditionMembership.relationshipType,
            }
          : undefined;
      nodePayloads.push(
        userNode(
          input.descriptors.conditionKind,
          mapping.duplicateCondition,
          sourceCondition.node.semantic.configuration,
          conditionParent,
        ),
      );
    }
  });
  const edgePayloads: CommandActionPayload[] = [
    duplicateUserChildEdge(
      source.membershipEdge,
      input.membershipEdgeId,
      input.duplicateStatement.nodeId,
      resolved.policy.configurationNode.id,
      input.descriptors.statementMembership,
    ),
  ];
  sortedConditions.forEach((mapping) => {
    const sourceCondition = source.conditions.find(
      (condition) => condition.node.id === mapping.sourceConditionNodeId,
    );
    if (sourceCondition !== undefined) {
      edgePayloads.push(
        duplicateUserChildEdge(
          sourceCondition.membershipEdge,
          mapping.membershipEdgeId,
          mapping.duplicateCondition.nodeId,
          input.duplicateStatement.nodeId,
          input.descriptors.conditionMembership,
        ),
      );
    }
  });
  sortedScopes.forEach((mapping) => {
    const sourceScope = source.resourceScopes.find(
      (scope) => scope.edge.id === mapping.sourceScopeEdgeId,
    );
    if (sourceScope !== undefined) {
      const descriptor = input.descriptors.resourceScopes.find(
        (candidate) => candidate.id === sourceScope.descriptorId,
      );
      if (descriptor !== undefined) {
        const edge = clone(sourceScope.edge);
        const statementEndpoint = {
          ...edge.semantic[descriptor.statementEndpoint],
          nodeId: input.duplicateStatement.nodeId,
        };
        edgePayloads.push({
          kind: "add-edge",
          edge: {
            ...edge,
            id: mapping.duplicateScopeEdgeId,
            semantic: {
              ...edge.semantic,
              [descriptor.statementEndpoint]: statementEndpoint,
              lifecycle: userLifecycle(),
            },
          },
        });
      }
    }
  });
  return finalizeBatch(
    input.document,
    input.descriptors,
    input.operationIdentities,
    [...nodePayloads, ...edgePayloads],
  );
}

function unexpectedIncidentEdge(
  document: ArchitectureDocument,
  nodeIds: ReadonlySet<string>,
  expectedEdgeIds: ReadonlySet<string>,
): ArchitectureEdge | undefined {
  return document.edges.find(
    (edge) =>
      (nodeIds.has(edge.semantic.source.nodeId) ||
        nodeIds.has(edge.semantic.target.nodeId)) &&
      !expectedEdgeIds.has(edge.id),
  );
}

function removeEdgePayload(edge: ArchitectureEdge): CommandActionPayload {
  return {
    kind: "remove-edge",
    edgeId: edge.id,
    expectedEdge: clone(edge),
  };
}

function removeNodePayload(node: ArchitectureNode): CommandActionPayload {
  return {
    kind: "remove-node",
    nodeId: node.id,
    expectedNode: clone(node),
  };
}

export function preparePolicyStatementRemove(
  input: PreparePolicyStatementRemoveInput,
): OwnedPolicyCommandPreparationResult {
  const resolved = resolvePolicy(
    input.document,
    input.descriptors,
    input.policyNodeId,
  );
  if (resolved.status !== "found") {
    return resolved;
  }
  const generatedPolicy = generatedNodeResult(
    resolved.policy.configurationNode,
  );
  if (generatedPolicy !== undefined) {
    return generatedPolicy;
  }
  const statement = resolveStatement(resolved.policy, input.statementNodeId);
  if (statement === undefined) {
    return invalid(
      "target-not-found",
      "$.statementNodeId",
      "The exact policy statement is not available in the selected policy.",
    );
  }
  const minimum = input.descriptors.statementMembership.cardinality.minimum;
  if (resolved.policy.statements.length - 1 < minimum) {
    return invalid(
      "cardinality-violation",
      "$.statementNodeId",
      "Removing this statement would violate the policy's exact minimum cardinality.",
    );
  }
  const guarded = [
    generatedNodeResult(statement.node),
    generatedEdgeResult(statement.membershipEdge),
    ...statement.conditions.flatMap((condition) => [
      generatedNodeResult(condition.node),
      generatedEdgeResult(condition.membershipEdge),
    ]),
    ...statement.resourceScopes.map((scope) => generatedEdgeResult(scope.edge)),
  ].find((entry) => entry !== undefined);
  if (guarded !== undefined) {
    return guarded;
  }
  const childNodes = statement.conditions.map((condition) => condition.node);
  const edges = [
    statement.membershipEdge,
    ...statement.conditions.map((condition) => condition.membershipEdge),
    ...statement.resourceScopes.map((scope) => scope.edge),
  ].sort((left, right) => compareUtf16(left.id, right.id));
  const nodeIds = new Set([
    statement.node.id,
    ...childNodes.map((node) => node.id),
  ]);
  const expectedEdgeIds = new Set(edges.map((edge) => edge.id));
  const unexpected = unexpectedIncidentEdge(
    input.document,
    nodeIds,
    expectedEdgeIds,
  );
  if (unexpected !== undefined) {
    return invalid(
      "unexpected-reference",
      "$.statementNodeId",
      "The statement subtree has an incident edge outside the exact policy descriptors and cannot be removed safely.",
    );
  }
  const nodes = [
    ...childNodes.sort((left, right) => compareUtf16(left.id, right.id)),
    statement.node,
  ];
  return finalizeBatch(
    input.document,
    input.descriptors,
    input.operationIdentities,
    [...edges.map(removeEdgePayload), ...nodes.map(removeNodePayload)],
  );
}

export function preparePolicyConditionAdd(
  input: PreparePolicyConditionAddInput,
): OwnedPolicyCommandPreparationResult {
  const resolved = resolvePolicy(
    input.document,
    input.descriptors,
    input.policyNodeId,
  );
  if (resolved.status !== "found") {
    return resolved;
  }
  const generatedPolicy = generatedNodeResult(
    resolved.policy.configurationNode,
  );
  if (generatedPolicy !== undefined) {
    return generatedPolicy;
  }
  const statement = resolveStatement(resolved.policy, input.statementNodeId);
  if (statement === undefined) {
    return invalid(
      "target-not-found",
      "$.statementNodeId",
      "The exact policy statement is not available in the selected policy.",
    );
  }
  const blocked = generatedNodeResult(statement.node);
  if (blocked !== undefined) {
    return blocked;
  }
  const maximum = input.descriptors.conditionMembership.cardinality.maximum;
  if (maximum !== null && statement.conditions.length >= maximum) {
    return invalid(
      "cardinality-violation",
      "$.condition",
      "The statement already has the maximum number of conditions allowed by the exact descriptor.",
    );
  }
  if (
    !configurationMatches(
      input.condition.configuration,
      input.descriptors.conditionKind,
    )
  ) {
    return invalid(
      "descriptor-mismatch",
      "$.condition.configuration",
      "The condition configuration must match the exact versioned condition descriptor.",
    );
  }
  if (
    newIdentityConflicts(
      input.document,
      [input.condition],
      [input.membershipEdgeId],
    )
  ) {
    return invalid(
      "identity-conflict",
      "$.condition",
      "Caller-supplied condition, deployment, and membership identities must be new and unique.",
    );
  }
  const parent =
    input.descriptors.conditionMembership.childParentBinding === "required"
      ? {
          nodeId: statement.node.id,
          relationshipType:
            input.descriptors.conditionMembership.relationshipType,
        }
      : undefined;
  return finalizeBatch(
    input.document,
    input.descriptors,
    input.operationIdentities,
    [
      userNode(
        input.descriptors.conditionKind,
        input.condition,
        input.condition.configuration,
        parent,
      ),
      userChildEdge(
        input.membershipEdgeId,
        input.condition.nodeId,
        statement.node.id,
        input.descriptors.conditionMembership,
      ),
    ],
  );
}

export function preparePolicyConditionRemove(
  input: PreparePolicyConditionRemoveInput,
): OwnedPolicyCommandPreparationResult {
  const resolved = resolvePolicy(
    input.document,
    input.descriptors,
    input.policyNodeId,
  );
  if (resolved.status !== "found") {
    return resolved;
  }
  const generatedPolicy = generatedNodeResult(
    resolved.policy.configurationNode,
  );
  if (generatedPolicy !== undefined) {
    return generatedPolicy;
  }
  const statement = resolveStatement(resolved.policy, input.statementNodeId);
  const condition = statement?.conditions.find(
    (candidate) => candidate.node.id === input.conditionNodeId,
  );
  if (statement === undefined || condition === undefined) {
    return invalid(
      "target-not-found",
      "$.conditionNodeId",
      "The exact condition is not available in the selected statement.",
    );
  }
  if (
    statement.conditions.length - 1 <
    input.descriptors.conditionMembership.cardinality.minimum
  ) {
    return invalid(
      "cardinality-violation",
      "$.conditionNodeId",
      "Removing this condition would violate the statement's exact minimum cardinality.",
    );
  }
  const blocked =
    generatedNodeResult(condition.node) ??
    generatedEdgeResult(condition.membershipEdge);
  if (blocked !== undefined) {
    return blocked;
  }
  const unexpected = unexpectedIncidentEdge(
    input.document,
    new Set([condition.node.id]),
    new Set([condition.membershipEdge.id]),
  );
  if (unexpected !== undefined) {
    return invalid(
      "unexpected-reference",
      "$.conditionNodeId",
      "The condition has an incident edge outside the exact membership descriptor and cannot be removed safely.",
    );
  }
  return finalizeBatch(
    input.document,
    input.descriptors,
    input.operationIdentities,
    [
      removeEdgePayload(condition.membershipEdge),
      removeNodePayload(condition.node),
    ],
  );
}

function resourceEndpoints(
  statementNodeId: string,
  resourceNodeId: string,
  descriptor: ExactPolicyResourceScopeDescriptor,
) {
  const statement = { nodeId: statementNodeId, port: descriptor.statementPort };
  const resource = { nodeId: resourceNodeId, port: descriptor.resourcePort };
  return descriptor.statementEndpoint === "source"
    ? { source: statement, target: resource }
    : { source: resource, target: statement };
}

function resourceScopeSetPayloads(input: {
  readonly statement: ProjectedPolicyStatement;
  readonly descriptor: ExactPolicyResourceScopeDescriptor;
  readonly scopeEdgeId: string;
  readonly resourceNodeId: string;
}): CommandActionPayload[] {
  const existing = input.statement.resourceScopes.find(
    (scope) => scope.edge.id === input.scopeEdgeId,
  );
  const replacement: ArchitectureEdge = {
    id: input.scopeEdgeId as ArchitectureEdge["id"],
    semantic: {
      ...resourceEndpoints(
        input.statement.node.id,
        input.resourceNodeId,
        input.descriptor,
      ),
      relationshipType: input.descriptor.relationshipType,
      configuration: clone(input.descriptor.edgeConfiguration),
      lifecycle: userLifecycle(),
    },
  } as ArchitectureEdge;
  const payloads: CommandActionPayload[] = [];
  if (
    existing === undefined ||
    serializeCanonicalJson(existing.edge) !==
      serializeCanonicalJson(replacement)
  ) {
    if (existing !== undefined) payloads.push(removeEdgePayload(existing.edge));
    payloads.push({ kind: "add-edge", edge: replacement });
  }
  const binding = input.descriptor.statementReferenceBinding;
  if (binding !== undefined) {
    const reference = configurationValueSchema.parse({
      kind: "node-reference",
      nodeId: input.resourceNodeId,
      attribute: binding.attribute,
    });
    const before = input.statement.node.semantic.configuration;
    if (
      serializeCanonicalJson(
        before.values[binding.property as keyof typeof before.values] ?? null,
      ) !== serializeCanonicalJson(reference)
    ) {
      payloads.push({
        kind: "update-node-configuration",
        nodeId: input.statement.node.id,
        expectedConfiguration: clone(before),
        configuration: {
          ...clone(before),
          values: { ...clone(before.values), [binding.property]: reference },
        },
      });
    }
  }
  return payloads;
}

/** Allocate identities for the same exact atomic changes used by preparation. */
export function policyResourceScopeSetCommandCount(
  input: Parameters<typeof resourceScopeSetPayloads>[0],
): number {
  return resourceScopeSetPayloads(input).length;
}

export function preparePolicyResourceScopeSet(
  input: PreparePolicyResourceScopeSetInput,
): OwnedPolicyCommandPreparationResult {
  const resolved = resolvePolicy(
    input.document,
    input.descriptors,
    input.policyNodeId,
  );
  if (resolved.status !== "found") {
    return resolved;
  }
  const generatedPolicy = generatedNodeResult(
    resolved.policy.configurationNode,
  );
  if (generatedPolicy !== undefined) {
    return generatedPolicy;
  }
  const statement = resolveStatement(resolved.policy, input.statementNodeId);
  const descriptor = input.descriptors.resourceScopes.find(
    (candidate) => candidate.id === input.resourceScopeDescriptorId,
  );
  const resource = input.document.nodes.find(
    (node) => node.id === input.resourceNodeId,
  );
  if (statement === undefined || resource === undefined) {
    return invalid(
      "target-not-found",
      "$.resourceNodeId",
      "The exact statement or resource node is not available in the current document.",
    );
  }
  const blocked = generatedNodeResult(statement.node);
  if (blocked !== undefined) {
    return blocked;
  }
  if (
    resource.semantic.serviceType !== descriptor?.resourceServiceType ||
    resource.semantic.resourceType !== descriptor.resourceResourceType
  ) {
    return invalid(
      "descriptor-mismatch",
      "$.resourceScopeDescriptorId",
      "The selected resource does not match the exact resource-scope descriptor.",
    );
  }
  const existing = input.document.edges.find(
    (edge) => edge.id === input.scopeEdgeId,
  );
  const projectedExisting = statement.resourceScopes.find(
    (scope) => scope.edge.id === input.scopeEdgeId,
  );
  if (existing !== undefined && projectedExisting === undefined) {
    return invalid(
      "identity-conflict",
      "$.scopeEdgeId",
      "The requested stable scope-edge ID is already used outside this statement.",
    );
  }
  if (projectedExisting !== undefined) {
    const blockedEdge = generatedEdgeResult(projectedExisting.edge);
    if (blockedEdge !== undefined) {
      return blockedEdge;
    }
  } else {
    const maximum = input.descriptors.resourceScopeCardinality.maximum;
    if (maximum !== null && statement.resourceScopes.length >= maximum) {
      return invalid(
        "cardinality-violation",
        "$.scopeEdgeId",
        "The statement already has the maximum number of graph resource scopes allowed by the exact descriptor.",
      );
    }
  }
  const payloads = resourceScopeSetPayloads({
    statement,
    descriptor,
    resourceNodeId: resource.id,
    scopeEdgeId: input.scopeEdgeId,
  });
  if (payloads.length === 0) {
    return invalid(
      "no-change",
      "$.resourceNodeId",
      "The selected graph resource scope is already attached to this statement.",
    );
  }
  return finalizeBatch(
    input.document,
    input.descriptors,
    input.operationIdentities,
    payloads,
  );
}

export function prepareUserPolicyRemove(
  input: PrepareUserPolicyRemoveInput,
): OwnedPolicyCommandPreparationResult {
  const resolved = resolvePolicy(
    input.document,
    input.descriptors,
    input.policyNodeId,
  );
  if (resolved.status !== "found") {
    return resolved;
  }
  const policy = resolved.policy;
  if (policy.configurationNode.semantic.lifecycle.ownership === "generated") {
    return (
      generatedNodeResult(policy.configurationNode) ??
      invalid(
        "generated-descendant",
        "$.policyNodeId",
        "The generated policy requires adoption before removal.",
      )
    );
  }
  if (policy.configurationNode.semantic.lifecycle.ownership !== "user") {
    return invalid(
      "user-owned-policy-required",
      "$.policyNodeId",
      "Whole-policy removal through this command is limited to explicitly user-owned policies.",
    );
  }
  const nodes = [
    policy.configurationNode,
    ...policy.statements.map((statement) => statement.node),
    ...policy.statements.flatMap((statement) =>
      statement.conditions.map((condition) => condition.node),
    ),
  ];
  const edges = [
    policy.bindingEdge,
    ...policy.statements.map((statement) => statement.membershipEdge),
    ...policy.statements.flatMap((statement) =>
      statement.conditions.map((condition) => condition.membershipEdge),
    ),
    ...policy.statements.flatMap((statement) =>
      statement.resourceScopes.map((scope) => scope.edge),
    ),
  ];
  const generatedResource = [
    ...nodes
      .filter((node) => node.semantic.lifecycle.ownership === "generated")
      .map((node) => ({ kind: "node" as const, nodeId: node.id })),
    ...edges
      .filter((edge) => edge.semantic.lifecycle.ownership === "generated")
      .map((edge) => ({ kind: "edge" as const, edgeId: edge.id })),
  ].sort((left, right) =>
    compareUtf16(
      left.kind === "node" ? left.nodeId : left.edgeId,
      right.kind === "node" ? right.nodeId : right.edgeId,
    ),
  )[0];
  if (generatedResource !== undefined) {
    return generated(generatedResource);
  }
  if (
    nodes.some((node) => node.semantic.lifecycle.ownership !== "user") ||
    edges.some((edge) => edge.semantic.lifecycle.ownership !== "user")
  ) {
    return invalid(
      "user-owned-policy-required",
      "$.policyNodeId",
      "Whole-policy removal requires a completely user-owned policy subtree.",
    );
  }
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edgeIds = new Set(edges.map((edge) => edge.id));
  const unexpected = unexpectedIncidentEdge(input.document, nodeIds, edgeIds);
  if (unexpected !== undefined) {
    return invalid(
      "unexpected-reference",
      "$.policyNodeId",
      "The policy subtree has an incident edge outside the exact policy descriptors and cannot be removed safely.",
    );
  }
  const sortedEdges = [...edges].sort((left, right) =>
    compareUtf16(left.id, right.id),
  );
  const conditions = policy.statements
    .flatMap((statement) =>
      statement.conditions.map((condition) => condition.node),
    )
    .sort((left, right) => compareUtf16(left.id, right.id));
  const statements = policy.statements
    .map((statement) => statement.node)
    .sort((left, right) => compareUtf16(left.id, right.id));
  return finalizeBatch(
    input.document,
    input.descriptors,
    input.operationIdentities,
    [
      ...sortedEdges.map(removeEdgePayload),
      ...conditions.map(removeNodePayload),
      ...statements.map(removeNodePayload),
      removeNodePayload(policy.configurationNode),
    ],
  );
}
