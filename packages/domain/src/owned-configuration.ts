import {
  configurationSchemaIdSchema,
  namespacedIdentifierSchema,
  normalizeArchitectureDocumentV3,
  portTypeSchema,
  relationshipTypeSchema,
  resourceTypeSchema,
  semanticVersionSchema,
  serializeCanonicalJson,
  serviceTypeSchema,
  type ElementLifecycle,
} from "@cloudmarkup/schemas";

import {
  parseArchitectureDocument,
  type ArchitectureConfiguration,
  type ArchitectureDocument,
  type ArchitectureEdge,
  type ArchitectureEdgeId,
  type ArchitectureNode,
  type ArchitectureNodeId,
  type VersionedArchitectureDocument,
} from "./architecture-document.js";

const maximumOwnedConfigurationsPerSlot = 10_000;

type UserLifecycle = Extract<ElementLifecycle, { readonly ownership: "user" }>;
type GeneratedLifecycle = Extract<
  ElementLifecycle,
  { readonly ownership: "generated" }
>;
type AdoptedLifecycle = Extract<
  ElementLifecycle,
  { readonly ownership: "adopted" }
>;

export type OwnedConfigurationOwnership = ElementLifecycle["ownership"];

export type OwnedConfigurationLifecycleSemanticFacts =
  UserLifecycle | GeneratedLifecycle | Omit<AdoptedLifecycle, "adoptedAt">;

export interface OwnedConfigurationKindDescriptor {
  readonly id: string;
  readonly nodeServiceType: ArchitectureNode["semantic"]["serviceType"];
  readonly nodeResourceType: ArchitectureNode["semantic"]["resourceType"];
  readonly configurationSchemaId: ArchitectureConfiguration["schemaId"];
  readonly configurationSchemaVersion: ArchitectureConfiguration["schemaVersion"];
  readonly allowedOwnership: readonly OwnedConfigurationOwnership[];
}

export interface OwnedConfigurationCardinality {
  readonly minimum: number;
  readonly maximum: number | null;
}

export interface OwnedConfigurationSlotDescriptor {
  readonly id: string;
  readonly ownerServiceType: ArchitectureNode["semantic"]["serviceType"];
  readonly ownerResourceType: ArchitectureNode["semantic"]["resourceType"];
  readonly relationshipType: ArchitectureEdge["semantic"]["relationshipType"];
  readonly configurationEndpoint: "source" | "target";
  readonly configurationPort: ArchitectureEdge["semantic"]["source"]["port"];
  readonly ownerPort: ArchitectureEdge["semantic"]["source"]["port"];
  readonly parentBinding: "required" | "forbidden";
  readonly configurationKindIds: readonly string[];
  readonly cardinality: OwnedConfigurationCardinality;
}

export interface OwnedConfigurationDescriptorSet {
  readonly kinds: readonly OwnedConfigurationKindDescriptor[];
  readonly slots: readonly OwnedConfigurationSlotDescriptor[];
}

export type OwnedConfigurationClassificationIssueCode =
  | "ambiguous_binding"
  | "ambiguous_slot_descriptor"
  | "cardinality_above_maximum"
  | "cardinality_below_minimum"
  | "configuration_kind_not_allowed"
  | "duplicate_descriptor_value"
  | "duplicate_kind_descriptor"
  | "duplicate_slot_descriptor"
  | "invalid_cardinality"
  | "invalid_descriptor"
  | "kind_without_slot"
  | "lifecycle_mismatch"
  | "missing_binding"
  | "owner_kind_mismatch"
  | "ownership_not_allowed"
  | "parent_binding_mismatch"
  | "unknown_configuration_kind"
  | "unknown_kind_descriptor";

export interface OwnedConfigurationClassificationIssue {
  readonly code: OwnedConfigurationClassificationIssueCode;
  readonly message: string;
  readonly path: string;
}

export interface OwnedConfigurationNodeSemanticFacts {
  readonly deploymentKey: ArchitectureNode["semantic"]["deploymentKey"];
  readonly serviceType: ArchitectureNode["semantic"]["serviceType"];
  readonly resourceType: ArchitectureNode["semantic"]["resourceType"];
  readonly configuration: ArchitectureConfiguration;
  readonly parent?: ArchitectureNode["semantic"]["parent"];
  readonly lifecycle: OwnedConfigurationLifecycleSemanticFacts;
}

export interface OwnedConfigurationBindingSemanticFacts {
  readonly source: ArchitectureEdge["semantic"]["source"];
  readonly target: ArchitectureEdge["semantic"]["target"];
  readonly relationshipType: ArchitectureEdge["semantic"]["relationshipType"];
  readonly configuration: ArchitectureConfiguration;
  readonly lifecycle: OwnedConfigurationLifecycleSemanticFacts;
}

export interface OwnedConfigurationInstance {
  readonly configurationNodeId: ArchitectureNodeId;
  readonly bindingEdgeId: ArchitectureEdgeId;
  readonly ownerNodeId: ArchitectureNodeId;
  readonly kindId: string;
  readonly slotId: string;
  readonly ownership: OwnedConfigurationOwnership;
  readonly node: OwnedConfigurationNodeSemanticFacts;
  readonly binding: OwnedConfigurationBindingSemanticFacts;
}

export type OwnedConfigurationClassificationResult =
  | {
      readonly success: true;
      readonly instances: readonly OwnedConfigurationInstance[];
    }
  | {
      readonly success: false;
      readonly issues: readonly OwnedConfigurationClassificationIssue[];
    };

interface ValidBinding {
  readonly edge: ArchitectureEdge;
  readonly kind: OwnedConfigurationKindDescriptor;
  readonly node: ArchitectureNode;
  readonly owner: ArchitectureNode;
  readonly slot: OwnedConfigurationSlotDescriptor;
}

function compareUtf16(left: string, right: string): number {
  if (left === right) {
    return 0;
  }

  return left < right ? -1 : 1;
}

function compareIssues(
  left: OwnedConfigurationClassificationIssue,
  right: OwnedConfigurationClassificationIssue,
): number {
  return (
    compareUtf16(left.path, right.path) ||
    compareUtf16(left.code, right.code) ||
    compareUtf16(left.message, right.message)
  );
}

function compareInstances(
  left: OwnedConfigurationInstance,
  right: OwnedConfigurationInstance,
): number {
  return (
    compareUtf16(left.ownerNodeId, right.ownerNodeId) ||
    compareUtf16(left.slotId, right.slotId) ||
    compareUtf16(left.configurationNodeId, right.configurationNodeId) ||
    compareUtf16(left.bindingEdgeId, right.bindingEdgeId)
  );
}

function issue(
  code: OwnedConfigurationClassificationIssueCode,
  path: string,
  message: string,
): OwnedConfigurationClassificationIssue {
  return Object.freeze({ code, path, message });
}

function canonicalClone<T>(value: T): T {
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

function lifecycleSemanticFacts(
  lifecycle: ElementLifecycle,
): OwnedConfigurationLifecycleSemanticFacts {
  if (lifecycle.ownership !== "adopted") {
    return canonicalClone(lifecycle);
  }

  return canonicalClone({
    ownership: lifecycle.ownership,
    origin: lifecycle.origin,
    provenance: lifecycle.provenance,
    adoptedBy: lifecycle.adoptedBy,
  });
}

function kindMatchKey(kind: OwnedConfigurationKindDescriptor): string {
  return [
    kind.nodeServiceType,
    kind.nodeResourceType,
    kind.configurationSchemaId,
    kind.configurationSchemaVersion,
  ].join("\u0000");
}

function nodeKindMatchKey(node: ArchitectureNode): string {
  return [
    node.semantic.serviceType,
    node.semantic.resourceType,
    node.semantic.configuration.schemaId,
    node.semantic.configuration.schemaVersion,
  ].join("\u0000");
}

function slotShapeKey(slot: OwnedConfigurationSlotDescriptor): string {
  return [
    slot.ownerServiceType,
    slot.ownerResourceType,
    slot.relationshipType,
    slot.configurationEndpoint,
    slot.configurationPort,
    slot.ownerPort,
  ].join("\u0000");
}

function duplicateValueIssues(
  values: readonly string[],
  path: string,
): readonly OwnedConfigurationClassificationIssue[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  const issues: OwnedConfigurationClassificationIssue[] = [];

  values.forEach((value) => {
    if (seen.has(value)) {
      duplicates.add(value);
    } else {
      seen.add(value);
    }
  });
  values.forEach((value, index) => {
    if (duplicates.has(value)) {
      issues.push(
        issue(
          "duplicate_descriptor_value",
          `${path}[${String(index)}]`,
          "Descriptor collection values must be unique.",
        ),
      );
    }
  });

  return issues;
}

function validateDescriptors(
  descriptors: OwnedConfigurationDescriptorSet,
): readonly OwnedConfigurationClassificationIssue[] {
  const issues: OwnedConfigurationClassificationIssue[] = [];
  const kindById = new Map<string, OwnedConfigurationKindDescriptor>();
  const kindByMatch = new Map<string, OwnedConfigurationKindDescriptor>();
  const slotById = new Map<string, OwnedConfigurationSlotDescriptor>();

  descriptors.kinds.forEach((kind, index) => {
    const path = `$.descriptors.kinds[${String(index)}]`;
    if (
      !namespacedIdentifierSchema.safeParse(kind.id).success ||
      !serviceTypeSchema.safeParse(kind.nodeServiceType).success ||
      !resourceTypeSchema.safeParse(kind.nodeResourceType).success ||
      !configurationSchemaIdSchema.safeParse(kind.configurationSchemaId)
        .success ||
      !semanticVersionSchema.safeParse(kind.configurationSchemaVersion).success
    ) {
      issues.push(
        issue(
          "invalid_descriptor",
          path,
          "Owned-configuration kind identifiers must satisfy the architecture identifier contracts.",
        ),
      );
    }
    if (
      kind.allowedOwnership.length === 0 ||
      kind.allowedOwnership.some(
        (ownership: unknown) =>
          ownership !== "user" &&
          ownership !== "generated" &&
          ownership !== "adopted",
      )
    ) {
      issues.push(
        issue(
          "invalid_descriptor",
          `${path}.allowedOwnership`,
          "Owned-configuration kinds must allow at least one known lifecycle ownership state.",
        ),
      );
    }
    issues.push(
      ...duplicateValueIssues(
        kind.allowedOwnership,
        `${path}.allowedOwnership`,
      ),
    );

    if (kindById.has(kind.id)) {
      issues.push(
        issue(
          "duplicate_kind_descriptor",
          `${path}.id`,
          "Owned-configuration kind IDs must be unique.",
        ),
      );
    } else {
      kindById.set(kind.id, kind);
    }
    const matchKey = kindMatchKey(kind);
    if (kindByMatch.has(matchKey)) {
      issues.push(
        issue(
          "duplicate_kind_descriptor",
          path,
          "A versioned architecture node shape must resolve to exactly one owned-configuration kind.",
        ),
      );
    } else {
      kindByMatch.set(matchKey, kind);
    }
  });

  descriptors.slots.forEach((slot, index) => {
    const path = `$.descriptors.slots[${String(index)}]`;
    const configurationEndpoint: unknown = slot.configurationEndpoint;
    const parentBinding: unknown = slot.parentBinding;
    if (
      !namespacedIdentifierSchema.safeParse(slot.id).success ||
      !serviceTypeSchema.safeParse(slot.ownerServiceType).success ||
      !resourceTypeSchema.safeParse(slot.ownerResourceType).success ||
      !relationshipTypeSchema.safeParse(slot.relationshipType).success ||
      !portTypeSchema.safeParse(slot.configurationPort).success ||
      !portTypeSchema.safeParse(slot.ownerPort).success ||
      (configurationEndpoint !== "source" &&
        configurationEndpoint !== "target") ||
      (parentBinding !== "required" && parentBinding !== "forbidden")
    ) {
      issues.push(
        issue(
          "invalid_descriptor",
          path,
          "Owned-configuration slot identities and binding fields must satisfy the architecture contracts.",
        ),
      );
    }
    if (slotById.has(slot.id)) {
      issues.push(
        issue(
          "duplicate_slot_descriptor",
          `${path}.id`,
          "Owned-configuration slot IDs must be unique.",
        ),
      );
    } else {
      slotById.set(slot.id, slot);
    }
    if (slot.configurationKindIds.length === 0) {
      issues.push(
        issue(
          "invalid_descriptor",
          `${path}.configurationKindIds`,
          "Owned-configuration slots must allow at least one declared kind.",
        ),
      );
    }
    issues.push(
      ...duplicateValueIssues(
        slot.configurationKindIds,
        `${path}.configurationKindIds`,
      ),
    );
    slot.configurationKindIds.forEach((kindId, kindIndex) => {
      if (!kindById.has(kindId)) {
        issues.push(
          issue(
            "unknown_kind_descriptor",
            `${path}.configurationKindIds[${String(kindIndex)}]`,
            "Owned-configuration slots may reference only declared kinds.",
          ),
        );
      }
    });

    const { minimum, maximum } = slot.cardinality;
    if (
      !Number.isSafeInteger(minimum) ||
      minimum < 0 ||
      minimum > maximumOwnedConfigurationsPerSlot ||
      (maximum !== null &&
        (!Number.isSafeInteger(maximum) ||
          maximum < minimum ||
          maximum > maximumOwnedConfigurationsPerSlot))
    ) {
      issues.push(
        issue(
          "invalid_cardinality",
          `${path}.cardinality`,
          "Slot cardinality must use a non-negative minimum and a null or bounded maximum no smaller than the minimum.",
        ),
      );
    }
  });

  descriptors.kinds.forEach((kind, index) => {
    if (
      !descriptors.slots.some((slot) =>
        slot.configurationKindIds.includes(kind.id),
      )
    ) {
      issues.push(
        issue(
          "kind_without_slot",
          `$.descriptors.kinds[${String(index)}].id`,
          "Every owned-configuration kind must be accepted by at least one slot.",
        ),
      );
    }
  });

  descriptors.slots.forEach((left, leftIndex) => {
    descriptors.slots.slice(leftIndex + 1).forEach((right, offset) => {
      if (
        slotShapeKey(left) === slotShapeKey(right) &&
        left.configurationKindIds.some((kindId) =>
          right.configurationKindIds.includes(kindId),
        )
      ) {
        issues.push(
          issue(
            "ambiguous_slot_descriptor",
            `$.descriptors.slots[${String(leftIndex + offset + 1)}]`,
            "Overlapping kinds cannot share an indistinguishable owner binding shape.",
          ),
        );
      }
    });
  });

  return issues.sort(compareIssues);
}

function endpointFor(
  edge: ArchitectureEdge,
  endpoint: "source" | "target",
): ArchitectureEdge["semantic"]["source"] {
  return edge.semantic[endpoint];
}

function bindingShapeMatches(
  edge: ArchitectureEdge,
  slot: OwnedConfigurationSlotDescriptor,
): boolean {
  const ownerEndpoint =
    slot.configurationEndpoint === "source" ? "target" : "source";
  return (
    edge.semantic.relationshipType === slot.relationshipType &&
    endpointFor(edge, slot.configurationEndpoint).port ===
      slot.configurationPort &&
    endpointFor(edge, ownerEndpoint).port === slot.ownerPort
  );
}

function lifecycleMatches(
  left: ElementLifecycle,
  right: ElementLifecycle,
): boolean {
  return serializeCanonicalJson(left) === serializeCanonicalJson(right);
}

function toInstance(binding: ValidBinding): OwnedConfigurationInstance {
  const { edge, kind, node, owner, slot } = binding;
  return deepFreeze(
    canonicalClone({
      configurationNodeId: node.id,
      bindingEdgeId: edge.id,
      ownerNodeId: owner.id,
      kindId: kind.id,
      slotId: slot.id,
      ownership: node.semantic.lifecycle.ownership,
      node: {
        deploymentKey: node.semantic.deploymentKey,
        serviceType: node.semantic.serviceType,
        resourceType: node.semantic.resourceType,
        configuration: node.semantic.configuration,
        ...(node.semantic.parent === undefined
          ? {}
          : { parent: node.semantic.parent }),
        lifecycle: lifecycleSemanticFacts(node.semantic.lifecycle),
      },
      binding: {
        source: edge.semantic.source,
        target: edge.semantic.target,
        relationshipType: edge.semantic.relationshipType,
        configuration: edge.semantic.configuration,
        lifecycle: lifecycleSemanticFacts(edge.semantic.lifecycle),
      },
    }),
  );
}

/**
 * Classifies existing architecture nodes without creating another persisted
 * configuration collection. Descriptor metadata is an exact, read-only lens;
 * the returned projection excludes node presentation and adoption audit time.
 */
export function classifyOwnedConfigurationNodes(
  documentInput: VersionedArchitectureDocument,
  descriptors: OwnedConfigurationDescriptorSet,
): OwnedConfigurationClassificationResult {
  const descriptorIssues = validateDescriptors(descriptors);
  if (descriptorIssues.length > 0) {
    return Object.freeze({
      success: false,
      issues: Object.freeze([...descriptorIssues]),
    });
  }

  const document: ArchitectureDocument = normalizeArchitectureDocumentV3(
    parseArchitectureDocument(documentInput),
  );
  const nodeById = new Map(
    document.nodes.map((node) => [node.id, node] as const),
  );
  const nodeIndexById = new Map(
    document.nodes.map((node, index) => [node.id, index] as const),
  );
  const edgeIndexById = new Map(
    document.edges.map((edge, index) => [edge.id, index] as const),
  );
  const kindByMatch = new Map(
    descriptors.kinds.map((kind) => [kindMatchKey(kind), kind] as const),
  );
  const kindByNodeId = new Map<
    ArchitectureNodeId,
    OwnedConfigurationKindDescriptor
  >();
  document.nodes.forEach((node) => {
    const kind = kindByMatch.get(nodeKindMatchKey(node));
    if (kind !== undefined) {
      kindByNodeId.set(node.id, kind);
    }
  });

  const issues: OwnedConfigurationClassificationIssue[] = [];
  const bindingsByNodeId = new Map<ArchitectureNodeId, ValidBinding[]>();
  const nodesWithInvalidBinding = new Set<ArchitectureNodeId>();

  document.edges.forEach((edge) => {
    const structuralSlots = descriptors.slots.filter((slot) =>
      bindingShapeMatches(edge, slot),
    );
    if (structuralSlots.length === 0) {
      return;
    }

    const possibleBindings = structuralSlots.map((slot) => {
      const ownerEndpoint =
        slot.configurationEndpoint === "source" ? "target" : "source";
      const configurationEndpoint = endpointFor(
        edge,
        slot.configurationEndpoint,
      );
      const ownerEndpointValue = endpointFor(edge, ownerEndpoint);
      return {
        edge,
        kind: kindByNodeId.get(configurationEndpoint.nodeId),
        node: nodeById.get(configurationEndpoint.nodeId),
        owner: nodeById.get(ownerEndpointValue.nodeId),
        slot,
      };
    });
    const completeBindings = possibleBindings.filter(
      (
        binding,
      ): binding is ValidBinding & {
        readonly kind: OwnedConfigurationKindDescriptor;
        readonly node: ArchitectureNode;
        readonly owner: ArchitectureNode;
      } =>
        binding.kind !== undefined &&
        binding.node !== undefined &&
        binding.owner !== undefined &&
        binding.slot.configurationKindIds.includes(binding.kind.id) &&
        binding.owner.semantic.serviceType === binding.slot.ownerServiceType &&
        binding.owner.semantic.resourceType === binding.slot.ownerResourceType,
    );

    if (completeBindings.length > 0) {
      completeBindings.forEach((binding) => {
        const current = bindingsByNodeId.get(binding.node.id) ?? [];
        current.push(binding);
        bindingsByNodeId.set(binding.node.id, current);
      });
      return;
    }

    const first = possibleBindings[0];
    if (first?.node === undefined) {
      return;
    }
    nodesWithInvalidBinding.add(first.node.id);
    const edgeIndex = edgeIndexById.get(edge.id) ?? 0;
    if (first.kind === undefined) {
      issues.push(
        issue(
          "unknown_configuration_kind",
          `$.edges[${String(edgeIndex)}].semantic`,
          "A declared owned-configuration slot is bound to a node whose versioned kind is not declared.",
        ),
      );
    } else if (
      !possibleBindings.some((binding) =>
        binding.slot.configurationKindIds.includes(first.kind?.id ?? ""),
      )
    ) {
      issues.push(
        issue(
          "configuration_kind_not_allowed",
          `$.edges[${String(edgeIndex)}].semantic`,
          "The owned-configuration kind is not allowed by the bound slot.",
        ),
      );
    } else {
      issues.push(
        issue(
          "owner_kind_mismatch",
          `$.edges[${String(edgeIndex)}].semantic`,
          "The owned-configuration binding does not target the slot's exact owner kind.",
        ),
      );
    }
  });

  const validBindings: ValidBinding[] = [];
  kindByNodeId.forEach((kind, nodeId) => {
    const node = nodeById.get(nodeId);
    if (node === undefined) {
      return;
    }
    const nodeIndex = nodeIndexById.get(node.id) ?? 0;
    const bindings = bindingsByNodeId.get(node.id) ?? [];
    if (bindings.length === 0) {
      if (!nodesWithInvalidBinding.has(node.id)) {
        issues.push(
          issue(
            "missing_binding",
            `$.nodes[${String(nodeIndex)}].semantic`,
            "An owned-configuration node must have exactly one declared owner-slot binding edge.",
          ),
        );
      }
      return;
    }
    if (bindings.length !== 1) {
      issues.push(
        issue(
          "ambiguous_binding",
          `$.nodes[${String(nodeIndex)}].semantic`,
          "An owned-configuration node cannot bind to multiple owner slots or owners.",
        ),
      );
      return;
    }

    const binding = bindings[0];
    if (binding === undefined) {
      return;
    }
    if (!kind.allowedOwnership.includes(node.semantic.lifecycle.ownership)) {
      issues.push(
        issue(
          "ownership_not_allowed",
          `$.nodes[${String(nodeIndex)}].semantic.lifecycle.ownership`,
          "The owned-configuration lifecycle is not allowed by its exact kind descriptor.",
        ),
      );
    }
    const parentMatches =
      node.semantic.parent?.nodeId === binding.owner.id &&
      node.semantic.parent.relationshipType === binding.slot.relationshipType;
    if (
      (binding.slot.parentBinding === "required" && !parentMatches) ||
      (binding.slot.parentBinding === "forbidden" &&
        node.semantic.parent !== undefined)
    ) {
      issues.push(
        issue(
          "parent_binding_mismatch",
          `$.nodes[${String(nodeIndex)}].semantic.parent`,
          "The owned-configuration parent must match the slot's explicit parent-binding policy.",
        ),
      );
    }
    if (
      !lifecycleMatches(
        node.semantic.lifecycle,
        binding.edge.semantic.lifecycle,
      )
    ) {
      const edgeIndex = edgeIndexById.get(binding.edge.id) ?? 0;
      issues.push(
        issue(
          "lifecycle_mismatch",
          `$.edges[${String(edgeIndex)}].semantic.lifecycle`,
          "The owned-configuration node and its owner-slot binding edge must have the same lifecycle and provenance.",
        ),
      );
    }
    validBindings.push(binding);
  });

  if (issues.length === 0) {
    descriptors.slots.forEach((slot) => {
      document.nodes
        .filter(
          (owner) =>
            owner.semantic.serviceType === slot.ownerServiceType &&
            owner.semantic.resourceType === slot.ownerResourceType,
        )
        .forEach((owner) => {
          const count = validBindings.filter(
            (binding) =>
              binding.owner.id === owner.id && binding.slot.id === slot.id,
          ).length;
          const ownerIndex = nodeIndexById.get(owner.id) ?? 0;
          if (count < slot.cardinality.minimum) {
            issues.push(
              issue(
                "cardinality_below_minimum",
                `$.nodes[${String(ownerIndex)}].semantic`,
                "The owner has fewer configurations in this slot than its exact minimum permits.",
              ),
            );
          }
          if (
            slot.cardinality.maximum !== null &&
            count > slot.cardinality.maximum
          ) {
            issues.push(
              issue(
                "cardinality_above_maximum",
                `$.nodes[${String(ownerIndex)}].semantic`,
                "The owner has more configurations in this slot than its exact maximum permits.",
              ),
            );
          }
        });
    });
  }

  if (issues.length > 0) {
    return Object.freeze({
      success: false,
      issues: Object.freeze(issues.sort(compareIssues)),
    });
  }

  return Object.freeze({
    success: true,
    instances: Object.freeze(
      validBindings.map(toInstance).sort(compareInstances),
    ),
  });
}
