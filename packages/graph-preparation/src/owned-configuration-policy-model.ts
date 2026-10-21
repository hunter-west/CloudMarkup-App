import {
  classifyOwnedConfigurationNodes,
  type ArchitectureConfiguration,
  type ArchitectureDocument,
  type ArchitectureEdge,
  type ArchitectureNode,
  type OwnedConfigurationClassificationIssueCode,
  type OwnedConfigurationDescriptorSet,
} from "@cloudmarkup/domain";
import { serializeCanonicalJson } from "@cloudmarkup/schemas";

export interface ExactPolicyNodeKindDescriptor {
  readonly id: string;
  readonly serviceType: ArchitectureNode["semantic"]["serviceType"];
  readonly resourceType: ArchitectureNode["semantic"]["resourceType"];
  readonly configurationSchemaId: ArchitectureConfiguration["schemaId"];
  readonly configurationSchemaVersion: ArchitectureConfiguration["schemaVersion"];
}

export interface ExactPolicyChildRelationshipDescriptor {
  readonly id: string;
  readonly relationshipType: ArchitectureEdge["semantic"]["relationshipType"];
  readonly childEndpoint: "source" | "target";
  readonly childPort: ArchitectureEdge["semantic"]["source"]["port"];
  readonly parentPort: ArchitectureEdge["semantic"]["source"]["port"];
  readonly childParentBinding: "required" | "forbidden";
  readonly edgeConfiguration: ArchitectureConfiguration;
  readonly cardinality: {
    readonly minimum: number;
    readonly maximum: number | null;
  };
}

export interface ExactPolicyResourceScopeDescriptor {
  readonly id: string;
  readonly relationshipType: ArchitectureEdge["semantic"]["relationshipType"];
  readonly statementEndpoint: "source" | "target";
  readonly statementPort: ArchitectureEdge["semantic"]["source"]["port"];
  readonly resourcePort: ArchitectureEdge["semantic"]["source"]["port"];
  readonly resourceServiceType: ArchitectureNode["semantic"]["serviceType"];
  readonly resourceResourceType: ArchitectureNode["semantic"]["resourceType"];
  readonly edgeConfiguration: ArchitectureConfiguration;
  readonly statementReferenceBinding?: {
    readonly property: string;
    readonly attribute: string;
  };
}

export interface OwnedPolicySlotBindingDescriptor {
  readonly slotId: string;
  readonly edgeConfiguration: ArchitectureConfiguration;
}

/**
 * All provider behavior is supplied as exact, catalog-bound descriptors. The
 * editor model contains no provider identifiers or policy-shape assumptions.
 */
export interface OwnedPolicyGraphDescriptorSet {
  readonly ownedConfigurations: OwnedConfigurationDescriptorSet;
  readonly policyOwnedKindIds: readonly string[];
  readonly slotBindings: readonly OwnedPolicySlotBindingDescriptor[];
  readonly statementKind: ExactPolicyNodeKindDescriptor;
  readonly statementMembership: ExactPolicyChildRelationshipDescriptor;
  readonly conditionKind: ExactPolicyNodeKindDescriptor;
  readonly conditionMembership: ExactPolicyChildRelationshipDescriptor;
  readonly resourceScopes: readonly ExactPolicyResourceScopeDescriptor[];
  readonly resourceScopeCardinality: {
    readonly minimum: number;
    readonly maximum: number | null;
  };
}

export type OwnedPolicyProjectionFindingCode =
  | OwnedConfigurationClassificationIssueCode
  | "ambiguous_condition_binding"
  | "ambiguous_policy_descriptor"
  | "ambiguous_resource_scope_descriptor"
  | "ambiguous_statement_binding"
  | "child_cardinality_above_maximum"
  | "child_cardinality_below_minimum"
  | "child_lifecycle_mismatch"
  | "child_parent_mismatch"
  | "duplicate_policy_descriptor"
  | "invalid_policy_descriptor"
  | "missing_condition_binding"
  | "missing_statement_binding"
  | "resource_scope_cardinality_above_maximum"
  | "resource_scope_cardinality_below_minimum"
  | "resource_scope_lifecycle_mismatch"
  | "resource_scope_target_mismatch"
  | "unknown_policy_kind";

export interface OwnedPolicyProjectionFinding {
  readonly code: OwnedPolicyProjectionFindingCode;
  readonly message: string;
  readonly path: string;
}

export interface ProjectedOwnedConfiguration {
  readonly kindId: string;
  readonly slotId: string;
  readonly ownerNodeId: ArchitectureNode["id"];
  readonly configurationNode: ArchitectureNode;
  readonly bindingEdge: ArchitectureEdge;
}

export interface ProjectedPolicyCondition {
  readonly node: ArchitectureNode;
  readonly membershipEdge: ArchitectureEdge;
}

export interface ProjectedPolicyResourceScope {
  readonly descriptorId: string;
  readonly edge: ArchitectureEdge;
  readonly resourceNodeId: ArchitectureNode["id"];
}

export interface ProjectedPolicyStatement {
  readonly node: ArchitectureNode;
  readonly membershipEdge: ArchitectureEdge;
  readonly conditions: readonly ProjectedPolicyCondition[];
  readonly resourceScopes: readonly ProjectedPolicyResourceScope[];
}

export interface ProjectedOwnedPolicy extends ProjectedOwnedConfiguration {
  readonly statements: readonly ProjectedPolicyStatement[];
}

export type OwnedPolicyProjectionResult =
  | {
      readonly success: true;
      readonly findings: readonly [];
      readonly configurations: readonly ProjectedOwnedConfiguration[];
      readonly policies: readonly ProjectedOwnedPolicy[];
    }
  | {
      readonly success: false;
      readonly findings: readonly OwnedPolicyProjectionFinding[];
      readonly configurations: readonly ProjectedOwnedConfiguration[];
      readonly policies: readonly ProjectedOwnedPolicy[];
    };

function compareUtf16(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

function compareFindings(
  left: OwnedPolicyProjectionFinding,
  right: OwnedPolicyProjectionFinding,
): number {
  return (
    compareUtf16(left.path, right.path) ||
    compareUtf16(left.code, right.code) ||
    compareUtf16(left.message, right.message)
  );
}

function clone<T>(value: T): T {
  return JSON.parse(serializeCanonicalJson(value)) as T;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach((entry) => {
      deepFreeze(entry);
    });
  }
  return value;
}

function finding(
  code: OwnedPolicyProjectionFindingCode,
  path: string,
  message: string,
): OwnedPolicyProjectionFinding {
  return Object.freeze({ code, message, path });
}

function nodeMatches(
  node: ArchitectureNode,
  descriptor: ExactPolicyNodeKindDescriptor,
): boolean {
  return (
    node.semantic.serviceType === descriptor.serviceType &&
    node.semantic.resourceType === descriptor.resourceType &&
    node.semantic.configuration.schemaId === descriptor.configurationSchemaId &&
    node.semantic.configuration.schemaVersion ===
      descriptor.configurationSchemaVersion
  );
}

function opposite(endpoint: "source" | "target"): "source" | "target" {
  return endpoint === "source" ? "target" : "source";
}

function childRelationshipMatches(
  edge: ArchitectureEdge,
  descriptor: ExactPolicyChildRelationshipDescriptor,
): boolean {
  return (
    edge.semantic.relationshipType === descriptor.relationshipType &&
    edge.semantic[descriptor.childEndpoint].port === descriptor.childPort &&
    edge.semantic[opposite(descriptor.childEndpoint)].port ===
      descriptor.parentPort &&
    edge.semantic.configuration.schemaId ===
      descriptor.edgeConfiguration.schemaId &&
    edge.semantic.configuration.schemaVersion ===
      descriptor.edgeConfiguration.schemaVersion
  );
}

function resourceRelationshipMatches(
  edge: ArchitectureEdge,
  descriptor: ExactPolicyResourceScopeDescriptor,
): boolean {
  return (
    edge.semantic.relationshipType === descriptor.relationshipType &&
    edge.semantic[descriptor.statementEndpoint].port ===
      descriptor.statementPort &&
    edge.semantic[opposite(descriptor.statementEndpoint)].port ===
      descriptor.resourcePort &&
    edge.semantic.configuration.schemaId ===
      descriptor.edgeConfiguration.schemaId &&
    edge.semantic.configuration.schemaVersion ===
      descriptor.edgeConfiguration.schemaVersion
  );
}

function sameLifecycle(
  left: ArchitectureNode["semantic"]["lifecycle"],
  right: ArchitectureEdge["semantic"]["lifecycle"],
): boolean {
  return serializeCanonicalJson(left) === serializeCanonicalJson(right);
}

function validCardinality(cardinality: {
  readonly minimum: number;
  readonly maximum: number | null;
}): boolean {
  return (
    Number.isSafeInteger(cardinality.minimum) &&
    cardinality.minimum >= 0 &&
    (cardinality.maximum === null ||
      (Number.isSafeInteger(cardinality.maximum) &&
        cardinality.maximum >= cardinality.minimum))
  );
}

function childDescriptorShape(
  descriptor: ExactPolicyChildRelationshipDescriptor,
): string {
  return [
    descriptor.relationshipType,
    descriptor.childEndpoint,
    descriptor.childPort,
    descriptor.parentPort,
    descriptor.edgeConfiguration.schemaId,
    descriptor.edgeConfiguration.schemaVersion,
  ].join("\u0000");
}

function resourceDescriptorShape(
  descriptor: ExactPolicyResourceScopeDescriptor,
): string {
  return [
    descriptor.relationshipType,
    descriptor.statementEndpoint,
    descriptor.statementPort,
    descriptor.resourcePort,
    descriptor.edgeConfiguration.schemaId,
    descriptor.edgeConfiguration.schemaVersion,
  ].join("\u0000");
}

function descriptorFindings(
  descriptors: OwnedPolicyGraphDescriptorSet,
): readonly OwnedPolicyProjectionFinding[] {
  const findings: OwnedPolicyProjectionFinding[] = [];
  const ownedKindIds = new Set(
    descriptors.ownedConfigurations.kinds.map((kind) => kind.id),
  );
  const policyKindIds = new Set<string>();
  descriptors.policyOwnedKindIds.forEach((kindId, index) => {
    if (policyKindIds.has(kindId)) {
      findings.push(
        finding(
          "duplicate_policy_descriptor",
          `$.descriptors.policyOwnedKindIds[${String(index)}]`,
          "Policy owned-kind IDs must be unique.",
        ),
      );
    }
    policyKindIds.add(kindId);
    if (!ownedKindIds.has(kindId)) {
      findings.push(
        finding(
          "unknown_policy_kind",
          `$.descriptors.policyOwnedKindIds[${String(index)}]`,
          "A policy owned-kind ID must reference an exact declared owned-configuration kind.",
        ),
      );
    }
  });

  const slotIds = new Set<string>();
  descriptors.slotBindings.forEach((binding, index) => {
    if (slotIds.has(binding.slotId)) {
      findings.push(
        finding(
          "duplicate_policy_descriptor",
          `$.descriptors.slotBindings[${String(index)}].slotId`,
          "Policy slot command bindings must be unique by exact slot ID.",
        ),
      );
    }
    slotIds.add(binding.slotId);
    if (
      !descriptors.ownedConfigurations.slots.some(
        (slot) => slot.id === binding.slotId,
      )
    ) {
      findings.push(
        finding(
          "invalid_policy_descriptor",
          `$.descriptors.slotBindings[${String(index)}].slotId`,
          "A policy slot command binding must reference a declared owned-configuration slot.",
        ),
      );
    }
  });

  if (
    descriptors.statementKind.serviceType ===
      descriptors.conditionKind.serviceType &&
    descriptors.statementKind.resourceType ===
      descriptors.conditionKind.resourceType &&
    descriptors.statementKind.configurationSchemaId ===
      descriptors.conditionKind.configurationSchemaId &&
    descriptors.statementKind.configurationSchemaVersion ===
      descriptors.conditionKind.configurationSchemaVersion
  ) {
    findings.push(
      finding(
        "ambiguous_policy_descriptor",
        "$.descriptors.conditionKind",
        "Statement and condition node shapes must be distinguishable.",
      ),
    );
  }
  if (
    childDescriptorShape(descriptors.statementMembership) ===
    childDescriptorShape(descriptors.conditionMembership)
  ) {
    findings.push(
      finding(
        "ambiguous_policy_descriptor",
        "$.descriptors.conditionMembership",
        "Statement and condition membership shapes must be distinguishable.",
      ),
    );
  }
  const childDescriptors: readonly (readonly [
    string,
    ExactPolicyChildRelationshipDescriptor,
  ])[] = [
    ["statementMembership", descriptors.statementMembership],
    ["conditionMembership", descriptors.conditionMembership],
  ];
  childDescriptors.forEach(([key, descriptor]) => {
    if (!validCardinality(descriptor.cardinality)) {
      findings.push(
        finding(
          "invalid_policy_descriptor",
          `$.descriptors.${key}.cardinality`,
          "Child cardinality must use a non-negative integer minimum and a null or integer maximum no smaller than the minimum.",
        ),
      );
    }
  });
  if (!validCardinality(descriptors.resourceScopeCardinality)) {
    findings.push(
      finding(
        "invalid_policy_descriptor",
        "$.descriptors.resourceScopeCardinality",
        "Resource-scope cardinality must use a non-negative integer minimum and a null or integer maximum no smaller than the minimum.",
      ),
    );
  }

  const resourceIds = new Set<string>();
  const resourceShapes = new Set<string>();
  descriptors.resourceScopes.forEach((descriptor, index) => {
    if (resourceIds.has(descriptor.id)) {
      findings.push(
        finding(
          "duplicate_policy_descriptor",
          `$.descriptors.resourceScopes[${String(index)}].id`,
          "Resource-scope descriptor IDs must be unique.",
        ),
      );
    }
    resourceIds.add(descriptor.id);
    const shape = resourceDescriptorShape(descriptor);
    if (resourceShapes.has(shape)) {
      findings.push(
        finding(
          "ambiguous_resource_scope_descriptor",
          `$.descriptors.resourceScopes[${String(index)}]`,
          "A resource-scope edge shape must resolve to exactly one descriptor.",
        ),
      );
    }
    resourceShapes.add(shape);
  });

  return findings.sort(compareFindings);
}

function failProjection(
  findings: readonly OwnedPolicyProjectionFinding[],
): OwnedPolicyProjectionResult {
  return Object.freeze({
    success: false,
    findings: Object.freeze([...findings].sort(compareFindings)),
    configurations: Object.freeze([]),
    policies: Object.freeze([]),
  });
}

/**
 * Projects graph-backed owned configurations and their exact structured policy
 * subtrees. Invalid or ambiguous bindings expose deterministic findings and no
 * partial policy model.
 */
export function projectOwnedPolicyConfigurations(
  document: ArchitectureDocument,
  descriptors: OwnedPolicyGraphDescriptorSet,
): OwnedPolicyProjectionResult {
  const initialFindings = descriptorFindings(descriptors);
  if (initialFindings.length > 0) {
    return failProjection(initialFindings);
  }

  const classification = classifyOwnedConfigurationNodes(
    document,
    descriptors.ownedConfigurations,
  );
  if (!classification.success) {
    return failProjection(
      classification.issues.map((issue) => ({
        code: issue.code,
        message: issue.message,
        path: issue.path,
      })),
    );
  }

  const nodeById = new Map(
    document.nodes.map((node) => [node.id, node] as const),
  );
  const edgeById = new Map(
    document.edges.map((edge) => [edge.id, edge] as const),
  );
  const nodeIndexById = new Map(
    document.nodes.map((node, index) => [node.id, index] as const),
  );
  const edgeIndexById = new Map(
    document.edges.map((edge, index) => [edge.id, index] as const),
  );
  const findings: OwnedPolicyProjectionFinding[] = [];
  const configurations: ProjectedOwnedConfiguration[] = [];

  classification.instances.forEach((instance) => {
    const node = nodeById.get(instance.configurationNodeId);
    const edge = edgeById.get(instance.bindingEdgeId);
    if (node !== undefined && edge !== undefined) {
      configurations.push({
        kindId: instance.kindId,
        slotId: instance.slotId,
        ownerNodeId: instance.ownerNodeId,
        configurationNode: clone(node),
        bindingEdge: clone(edge),
      });
    }
  });
  configurations.sort(
    (left, right) =>
      compareUtf16(left.ownerNodeId, right.ownerNodeId) ||
      compareUtf16(left.slotId, right.slotId) ||
      compareUtf16(left.configurationNode.id, right.configurationNode.id) ||
      compareUtf16(left.bindingEdge.id, right.bindingEdge.id),
  );

  const policyKindIds = new Set(descriptors.policyOwnedKindIds);
  const policyConfigurations = configurations.filter((configuration) =>
    policyKindIds.has(configuration.kindId),
  );
  const policyNodeIds = new Set(
    policyConfigurations.map(
      (configuration) => configuration.configurationNode.id,
    ),
  );
  const statementNodes = document.nodes.filter((node) =>
    nodeMatches(node, descriptors.statementKind),
  );
  const statementMembershipByNodeId = new Map<
    ArchitectureNode["id"],
    ArchitectureEdge
  >();

  statementNodes.forEach((statement) => {
    const memberships = document.edges.filter(
      (edge) =>
        childRelationshipMatches(edge, descriptors.statementMembership) &&
        edge.semantic[descriptors.statementMembership.childEndpoint].nodeId ===
          statement.id &&
        policyNodeIds.has(
          edge.semantic[opposite(descriptors.statementMembership.childEndpoint)]
            .nodeId,
        ),
    );
    const nodePath = `$.nodes[${String(nodeIndexById.get(statement.id) ?? 0)}].semantic`;
    if (memberships.length === 0) {
      findings.push(
        finding(
          "missing_statement_binding",
          nodePath,
          "A policy statement must have exactly one exact policy-document membership edge.",
        ),
      );
      return;
    }
    if (memberships.length > 1) {
      findings.push(
        finding(
          "ambiguous_statement_binding",
          nodePath,
          "A policy statement cannot belong to multiple policy documents.",
        ),
      );
      return;
    }
    const membership = memberships[0];
    if (membership === undefined) {
      return;
    }
    const parentId =
      membership.semantic[
        opposite(descriptors.statementMembership.childEndpoint)
      ].nodeId;
    const parentMatches =
      statement.semantic.parent?.nodeId === parentId &&
      statement.semantic.parent.relationshipType ===
        descriptors.statementMembership.relationshipType;
    if (
      (descriptors.statementMembership.childParentBinding === "required" &&
        !parentMatches) ||
      (descriptors.statementMembership.childParentBinding === "forbidden" &&
        statement.semantic.parent !== undefined)
    ) {
      findings.push(
        finding(
          "child_parent_mismatch",
          `${nodePath}.parent`,
          "The statement parent must match its exact policy membership descriptor.",
        ),
      );
    }
    if (
      !sameLifecycle(
        statement.semantic.lifecycle,
        membership.semantic.lifecycle,
      )
    ) {
      findings.push(
        finding(
          "child_lifecycle_mismatch",
          `$.edges[${String(edgeIndexById.get(membership.id) ?? 0)}].semantic.lifecycle`,
          "A statement and its membership edge must have the same lifecycle and provenance.",
        ),
      );
    }
    statementMembershipByNodeId.set(statement.id, membership);
  });

  const validStatementIds = new Set(statementMembershipByNodeId.keys());
  const conditionNodes = document.nodes.filter((node) =>
    nodeMatches(node, descriptors.conditionKind),
  );
  const conditionsByStatementId = new Map<
    ArchitectureNode["id"],
    ProjectedPolicyCondition[]
  >();
  conditionNodes.forEach((condition) => {
    const memberships = document.edges.filter(
      (edge) =>
        childRelationshipMatches(edge, descriptors.conditionMembership) &&
        edge.semantic[descriptors.conditionMembership.childEndpoint].nodeId ===
          condition.id &&
        validStatementIds.has(
          edge.semantic[opposite(descriptors.conditionMembership.childEndpoint)]
            .nodeId,
        ),
    );
    const nodePath = `$.nodes[${String(nodeIndexById.get(condition.id) ?? 0)}].semantic`;
    if (memberships.length === 0) {
      findings.push(
        finding(
          "missing_condition_binding",
          nodePath,
          "A policy condition must have exactly one exact statement membership edge.",
        ),
      );
      return;
    }
    if (memberships.length > 1) {
      findings.push(
        finding(
          "ambiguous_condition_binding",
          nodePath,
          "A policy condition cannot belong to multiple statements.",
        ),
      );
      return;
    }
    const membership = memberships[0];
    if (membership === undefined) {
      return;
    }
    const statementId =
      membership.semantic[
        opposite(descriptors.conditionMembership.childEndpoint)
      ].nodeId;
    const parentMatches =
      condition.semantic.parent?.nodeId === statementId &&
      condition.semantic.parent.relationshipType ===
        descriptors.conditionMembership.relationshipType;
    if (
      (descriptors.conditionMembership.childParentBinding === "required" &&
        !parentMatches) ||
      (descriptors.conditionMembership.childParentBinding === "forbidden" &&
        condition.semantic.parent !== undefined)
    ) {
      findings.push(
        finding(
          "child_parent_mismatch",
          `${nodePath}.parent`,
          "The condition parent must match its exact statement membership descriptor.",
        ),
      );
    }
    if (
      !sameLifecycle(
        condition.semantic.lifecycle,
        membership.semantic.lifecycle,
      )
    ) {
      findings.push(
        finding(
          "child_lifecycle_mismatch",
          `$.edges[${String(edgeIndexById.get(membership.id) ?? 0)}].semantic.lifecycle`,
          "A condition and its membership edge must have the same lifecycle and provenance.",
        ),
      );
    }
    const current = conditionsByStatementId.get(statementId) ?? [];
    current.push({ node: clone(condition), membershipEdge: clone(membership) });
    conditionsByStatementId.set(statementId, current);
  });

  const scopesByStatementId = new Map<
    ArchitectureNode["id"],
    ProjectedPolicyResourceScope[]
  >();
  document.edges.forEach((edge) => {
    const matchingDescriptors = descriptors.resourceScopes.filter(
      (descriptor) => resourceRelationshipMatches(edge, descriptor),
    );
    if (matchingDescriptors.length === 0) {
      return;
    }
    const edgePath = `$.edges[${String(edgeIndexById.get(edge.id) ?? 0)}].semantic`;
    if (matchingDescriptors.length > 1) {
      findings.push(
        finding(
          "ambiguous_resource_scope_descriptor",
          edgePath,
          "A resource-scope edge cannot match multiple exact descriptors.",
        ),
      );
      return;
    }
    const descriptor = matchingDescriptors[0];
    if (descriptor === undefined) {
      return;
    }
    const statementId = edge.semantic[descriptor.statementEndpoint].nodeId;
    const resourceId =
      edge.semantic[opposite(descriptor.statementEndpoint)].nodeId;
    const resource = nodeById.get(resourceId);
    if (
      !validStatementIds.has(statementId) ||
      resource?.semantic.serviceType !== descriptor.resourceServiceType ||
      resource.semantic.resourceType !== descriptor.resourceResourceType
    ) {
      findings.push(
        finding(
          "resource_scope_target_mismatch",
          edgePath,
          "A policy resource scope must bind an exact statement to the descriptor's exact resource kind.",
        ),
      );
      return;
    }
    const statement = nodeById.get(statementId);
    if (
      statement === undefined ||
      !sameLifecycle(statement.semantic.lifecycle, edge.semantic.lifecycle)
    ) {
      findings.push(
        finding(
          "resource_scope_lifecycle_mismatch",
          `${edgePath}.lifecycle`,
          "A resource-scope edge must have the same lifecycle and provenance as its statement.",
        ),
      );
      return;
    }
    const current = scopesByStatementId.get(statementId) ?? [];
    current.push({
      descriptorId: descriptor.id,
      edge: clone(edge),
      resourceNodeId: resourceId,
    });
    scopesByStatementId.set(statementId, current);
  });

  const structuralBindingsValid = findings.length === 0;
  const statementProjectionsByPolicyId = new Map<
    ArchitectureNode["id"],
    ProjectedPolicyStatement[]
  >();
  statementMembershipByNodeId.forEach((membership, statementId) => {
    const statement = nodeById.get(statementId);
    if (statement === undefined) {
      return;
    }
    const policyId =
      membership.semantic[
        opposite(descriptors.statementMembership.childEndpoint)
      ].nodeId;
    const conditions = [
      ...(conditionsByStatementId.get(statementId) ?? []),
    ].sort((left, right) => compareUtf16(left.node.id, right.node.id));
    const resourceScopes = [
      ...(scopesByStatementId.get(statementId) ?? []),
    ].sort((left, right) => compareUtf16(left.edge.id, right.edge.id));
    if (
      structuralBindingsValid &&
      conditions.length < descriptors.conditionMembership.cardinality.minimum
    ) {
      findings.push(
        finding(
          "child_cardinality_below_minimum",
          `$.nodes[${String(nodeIndexById.get(statementId) ?? 0)}].semantic`,
          "The statement has fewer conditions than the exact descriptor permits.",
        ),
      );
    }
    if (
      structuralBindingsValid &&
      descriptors.conditionMembership.cardinality.maximum !== null &&
      conditions.length > descriptors.conditionMembership.cardinality.maximum
    ) {
      findings.push(
        finding(
          "child_cardinality_above_maximum",
          `$.nodes[${String(nodeIndexById.get(statementId) ?? 0)}].semantic`,
          "The statement has more conditions than the exact descriptor permits.",
        ),
      );
    }
    if (
      structuralBindingsValid &&
      resourceScopes.length < descriptors.resourceScopeCardinality.minimum
    ) {
      findings.push(
        finding(
          "resource_scope_cardinality_below_minimum",
          `$.nodes[${String(nodeIndexById.get(statementId) ?? 0)}].semantic`,
          "The statement has fewer graph resource scopes than the exact descriptor permits.",
        ),
      );
    }
    if (
      structuralBindingsValid &&
      descriptors.resourceScopeCardinality.maximum !== null &&
      resourceScopes.length > descriptors.resourceScopeCardinality.maximum
    ) {
      findings.push(
        finding(
          "resource_scope_cardinality_above_maximum",
          `$.nodes[${String(nodeIndexById.get(statementId) ?? 0)}].semantic`,
          "The statement has more graph resource scopes than the exact descriptor permits.",
        ),
      );
    }
    const current = statementProjectionsByPolicyId.get(policyId) ?? [];
    current.push({
      node: clone(statement),
      membershipEdge: clone(membership),
      conditions,
      resourceScopes,
    });
    statementProjectionsByPolicyId.set(policyId, current);
  });

  policyConfigurations.forEach((policy) => {
    const statements =
      statementProjectionsByPolicyId.get(policy.configurationNode.id) ?? [];
    if (
      structuralBindingsValid &&
      statements.length < descriptors.statementMembership.cardinality.minimum
    ) {
      findings.push(
        finding(
          "child_cardinality_below_minimum",
          `$.nodes[${String(nodeIndexById.get(policy.configurationNode.id) ?? 0)}].semantic`,
          "The policy has fewer statements than the exact descriptor permits.",
        ),
      );
    }
    if (
      structuralBindingsValid &&
      descriptors.statementMembership.cardinality.maximum !== null &&
      statements.length > descriptors.statementMembership.cardinality.maximum
    ) {
      findings.push(
        finding(
          "child_cardinality_above_maximum",
          `$.nodes[${String(nodeIndexById.get(policy.configurationNode.id) ?? 0)}].semantic`,
          "The policy has more statements than the exact descriptor permits.",
        ),
      );
    }
  });

  if (findings.length > 0) {
    return failProjection(findings);
  }

  const policies: ProjectedOwnedPolicy[] = policyConfigurations.map(
    (policy) => ({
      ...clone(policy),
      statements: Object.freeze(
        [
          ...(statementProjectionsByPolicyId.get(policy.configurationNode.id) ??
            []),
        ]
          .sort((left, right) => compareUtf16(left.node.id, right.node.id))
          .map((statement) => deepFreeze(clone(statement))),
      ),
    }),
  );
  policies.sort(
    (left, right) =>
      compareUtf16(left.ownerNodeId, right.ownerNodeId) ||
      compareUtf16(left.slotId, right.slotId) ||
      compareUtf16(left.configurationNode.id, right.configurationNode.id),
  );

  return deepFreeze({
    success: true,
    findings: [],
    configurations: configurations.map((configuration) => clone(configuration)),
    policies,
  });
}

/**
 * Editing may complete missing owner slots incrementally. This projection still
 * rejects every descriptor, binding, ownership, maximum and policy-child error.
 * It is not readiness: callers must use the strict projection for that purpose.
 */
export function projectOwnedPolicyConfigurationsForEditing(
  document: ArchitectureDocument,
  descriptors: OwnedPolicyGraphDescriptorSet,
): OwnedPolicyProjectionResult {
  const strict = projectOwnedPolicyConfigurations(document, descriptors);
  if (
    strict.success ||
    strict.findings.some((entry) => entry.code !== "cardinality_below_minimum")
  ) {
    return strict;
  }
  return projectOwnedPolicyConfigurations(document, {
    ...descriptors,
    ownedConfigurations: {
      ...descriptors.ownedConfigurations,
      slots: descriptors.ownedConfigurations.slots.map((slot) => ({
        ...slot,
        cardinality: { ...slot.cardinality, minimum: 0 },
      })),
    },
  });
}

export function findProjectedPolicy(
  projection: Extract<OwnedPolicyProjectionResult, { readonly success: true }>,
  policyNodeId: string,
): ProjectedOwnedPolicy | undefined {
  return projection.policies.find(
    (policy) => policy.configurationNode.id === policyNodeId,
  );
}
