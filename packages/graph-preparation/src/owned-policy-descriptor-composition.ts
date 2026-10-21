import type {
  ArchitectureConfiguration,
  OwnedConfigurationDescriptorSet,
  OwnedConfigurationKindDescriptor,
  OwnedConfigurationOwnership,
  OwnedConfigurationSlotDescriptor,
} from "@cloudmarkup/domain";

import {
  configurationSchemaIdSchema,
  configurationKeySchema,
  configurationValueSchema,
  portTypeSchema,
  relationshipTypeSchema,
  resourceTypeSchema,
  semanticVersionSchema,
  serviceTypeSchema,
} from "@cloudmarkup/schemas";
import type {
  EditorCatalog,
  EditorCatalogRelationship,
  EditorCatalogService,
  EditorOwnedConfigurationSlot,
} from "./editor-catalog.js";
import type {
  ExactPolicyChildRelationshipDescriptor,
  ExactPolicyNodeKindDescriptor,
  ExactPolicyResourceScopeDescriptor,
  OwnedPolicyGraphDescriptorSet,
} from "./owned-configuration-policy-model.js";

export interface OwnedPolicyChildBindingSource {
  readonly id: string;
  readonly relationshipType: string;
  readonly childPort: string;
  readonly parentPort: string;
}

export interface OwnedPolicyResourceScopeSource {
  readonly id: string;
  readonly relationshipType: string;
  readonly statementPort: string;
  readonly resourceServiceType: string;
  readonly resourceResourceType: string;
  readonly resourcePort: string;
  readonly statementReferenceBinding?: {
    readonly property: string;
    readonly attribute: string;
  };
}

export interface OwnedPolicyDescriptorSource {
  readonly statementMembership: OwnedPolicyChildBindingSource;
  readonly conditionMembership: OwnedPolicyChildBindingSource;
  readonly resourceScopes: readonly OwnedPolicyResourceScopeSource[];
  readonly resourceScopeCardinality: {
    readonly minimum: number;
    readonly maximum: number | null;
  };
}

export class OwnedPolicyDescriptorCompositionError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "OwnedPolicyDescriptorCompositionError";
  }
}

function compareText(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const entry of Object.values(
      value as Readonly<Record<string, unknown>>,
    )) {
      deepFreeze(entry);
    }
  }
  return value;
}

function exactService(
  catalog: EditorCatalog,
  serviceType: string,
): EditorCatalogService {
  const services = catalog.services.filter(
    (service) => service.serviceType === serviceType,
  );
  if (services.length !== 1 || services[0] === undefined) {
    throw new OwnedPolicyDescriptorCompositionError(
      "An owned-policy descriptor endpoint must resolve to one exact catalog service.",
    );
  }
  return services[0];
}

function exactRelationship(
  catalog: EditorCatalog,
  relationshipType: string,
): EditorCatalogRelationship {
  const relationships = (catalog.relationships ?? []).filter(
    (relationship) => relationship.id === relationshipType,
  );
  if (relationships.length !== 1 || relationships[0] === undefined) {
    throw new OwnedPolicyDescriptorCompositionError(
      "An owned-policy descriptor must resolve to one exact catalog relationship.",
    );
  }
  return relationships[0];
}

function emptyEdgeConfiguration(
  relationship: EditorCatalogRelationship,
): ArchitectureConfiguration {
  if (
    relationship.configuration.defaults.kind !== "ready" ||
    Object.keys(relationship.configuration.defaults.values).length !== 0
  ) {
    throw new OwnedPolicyDescriptorCompositionError(
      "Owned-policy membership relationships require exact empty default configuration.",
    );
  }
  return {
    schemaId: configurationSchemaIdSchema.parse(
      relationship.configuration.schemaId,
    ),
    schemaVersion: semanticVersionSchema.parse(
      relationship.configuration.schemaVersion,
    ),
    values: relationship.configuration.defaults.values,
  };
}

function nodeKindDescriptor(
  service: EditorCatalogService,
): ExactPolicyNodeKindDescriptor {
  if (service.deployable) {
    throw new OwnedPolicyDescriptorCompositionError(
      "Owned-policy child kinds must be non-deployable graph configuration.",
    );
  }
  return {
    configurationSchemaId: configurationSchemaIdSchema.parse(
      service.configuration.schemaId,
    ),
    configurationSchemaVersion: semanticVersionSchema.parse(
      service.configuration.schemaVersion,
    ),
    id: service.serviceType,
    resourceType: resourceTypeSchema.parse(service.resourceType),
    serviceType: serviceTypeSchema.parse(service.serviceType),
  };
}

function childRelationshipDescriptor(
  catalog: EditorCatalog,
  source: OwnedPolicyChildBindingSource,
): {
  readonly childKind: ExactPolicyNodeKindDescriptor;
  readonly descriptor: ExactPolicyChildRelationshipDescriptor;
} {
  const relationship = exactRelationship(catalog, source.relationshipType);
  const childIsSource =
    relationship.sourcePortId === source.childPort &&
    relationship.targetPortId === source.parentPort;
  const childIsTarget =
    relationship.targetPortId === source.childPort &&
    relationship.sourcePortId === source.parentPort;
  if (childIsSource === childIsTarget) {
    throw new OwnedPolicyDescriptorCompositionError(
      "An owned-policy child relationship must have one exact child endpoint.",
    );
  }
  const childEndpoint = childIsSource
    ? ("source" as const)
    : ("target" as const);
  const childServiceType = childIsSource
    ? relationship.sourceServiceType
    : relationship.targetServiceType;
  const parentServiceType = childIsSource
    ? relationship.targetServiceType
    : relationship.sourceServiceType;
  const childService = exactService(catalog, childServiceType);
  const parentService = exactService(catalog, parentServiceType);
  const parentPort = parentService.ports.find(
    (port) => port.id === source.parentPort,
  );
  if (
    childService.ports.filter((port) => port.id === source.childPort).length !==
      1 ||
    parentPort === undefined
  ) {
    throw new OwnedPolicyDescriptorCompositionError(
      "Owned-policy child ports must resolve exactly in the catalog.",
    );
  }
  const maximum = childIsSource
    ? relationship.maximumConnectionsPerTarget
    : relationship.maximumConnectionsPerSource;

  return {
    childKind: nodeKindDescriptor(childService),
    descriptor: {
      cardinality: {
        maximum,
        minimum: parentPort.required ? 1 : 0,
      },
      childEndpoint,
      childParentBinding: "required",
      childPort: portTypeSchema.parse(source.childPort),
      edgeConfiguration: emptyEdgeConfiguration(relationship),
      id: source.id,
      parentPort: portTypeSchema.parse(source.parentPort),
      relationshipType: relationshipTypeSchema.parse(source.relationshipType),
    },
  };
}

function ownershipForSlots(
  slots: readonly EditorOwnedConfigurationSlot[],
): readonly OwnedConfigurationOwnership[] {
  const ownership = new Set<OwnedConfigurationOwnership>();
  slots.forEach((slot) => {
    slot.allowedOwnership.forEach((value) => ownership.add(value));
    if (slot.generatedAdoption === "allowed") {
      ownership.add("adopted");
    }
  });
  return [...ownership].sort(compareText);
}

function ownedConfigurationDescriptors(catalog: EditorCatalog): {
  readonly descriptors: OwnedConfigurationDescriptorSet;
  readonly policyOwnedKindIds: readonly string[];
  readonly slotBindings: OwnedPolicyGraphDescriptorSet["slotBindings"];
} {
  const slotEntries = catalog.services.flatMap((owner) =>
    (owner.ownedConfigurationSlots ?? []).map((slot) => ({ owner, slot })),
  );
  if (slotEntries.length === 0) {
    throw new OwnedPolicyDescriptorCompositionError(
      "The exact editor catalog does not expose owned-configuration slots.",
    );
  }
  const entriesByConfigurationService = new Map<string, typeof slotEntries>();
  slotEntries.forEach((entry) => {
    const key = entry.slot.graphBinding.configurationServiceType;
    const current = entriesByConfigurationService.get(key) ?? [];
    current.push(entry);
    entriesByConfigurationService.set(key, current);
  });

  const kinds: OwnedConfigurationKindDescriptor[] = [
    ...entriesByConfigurationService.entries(),
  ]
    .map(([serviceType, entries]) => {
      const service = exactService(catalog, serviceType);
      if (service.deployable) {
        throw new OwnedPolicyDescriptorCompositionError(
          "Owned configuration must resolve to non-deployable graph nodes.",
        );
      }
      return {
        allowedOwnership: ownershipForSlots(entries.map((entry) => entry.slot)),
        configurationSchemaId: configurationSchemaIdSchema.parse(
          service.configuration.schemaId,
        ),
        configurationSchemaVersion: semanticVersionSchema.parse(
          service.configuration.schemaVersion,
        ),
        id: serviceType,
        nodeResourceType: resourceTypeSchema.parse(service.resourceType),
        nodeServiceType: serviceTypeSchema.parse(service.serviceType),
      };
    })
    .sort((left, right) => compareText(left.id, right.id));

  const slots: OwnedConfigurationSlotDescriptor[] = slotEntries
    .map(({ owner, slot }) => ({
      cardinality: {
        maximum:
          slot.cardinality.maximum === "many" ? null : slot.cardinality.maximum,
        minimum: slot.cardinality.minimum,
      },
      configurationEndpoint: slot.graphBinding.configurationEndpoint,
      configurationKindIds: [slot.graphBinding.configurationServiceType],
      configurationPort: portTypeSchema.parse(
        slot.graphBinding.configurationPortId,
      ),
      id: slot.id,
      ownerPort: portTypeSchema.parse(slot.graphBinding.ownerPortId),
      ownerResourceType: resourceTypeSchema.parse(owner.resourceType),
      ownerServiceType: serviceTypeSchema.parse(owner.serviceType),
      parentBinding: "required" as const,
      relationshipType: relationshipTypeSchema.parse(
        slot.graphBinding.ownershipRelationshipType,
      ),
    }))
    .sort((left, right) => compareText(left.id, right.id));

  const documentPolicyKinds = new Set([
    "identity-inline",
    "trust",
    "resource",
    "generated-permission",
    "service-grant",
  ]);
  const policyOwnedKindIds = [
    ...new Set(
      slotEntries.flatMap(({ slot }) =>
        slot.policyKinds.some((kind) => documentPolicyKinds.has(kind))
          ? [slot.graphBinding.configurationServiceType]
          : [],
      ),
    ),
  ].sort(compareText);
  const slotBindings = slotEntries
    .map(({ slot }) => ({
      edgeConfiguration: emptyEdgeConfiguration(
        exactRelationship(catalog, slot.graphBinding.ownershipRelationshipType),
      ),
      slotId: slot.id,
    }))
    .sort((left, right) => compareText(left.slotId, right.slotId));

  return {
    descriptors: { kinds, slots },
    policyOwnedKindIds,
    slotBindings,
  };
}

function resourceScopeDescriptor(
  catalog: EditorCatalog,
  source: OwnedPolicyResourceScopeSource,
  statementKind: ExactPolicyNodeKindDescriptor,
): ExactPolicyResourceScopeDescriptor {
  const relationship = exactRelationship(catalog, source.relationshipType);
  const statementIsSource =
    relationship.sourceServiceType === statementKind.serviceType &&
    relationship.sourcePortId === source.statementPort &&
    relationship.targetServiceType === source.resourceServiceType &&
    relationship.targetPortId === source.resourcePort;
  const statementIsTarget =
    relationship.targetServiceType === statementKind.serviceType &&
    relationship.targetPortId === source.statementPort &&
    relationship.sourceServiceType === source.resourceServiceType &&
    relationship.sourcePortId === source.resourcePort;
  const resourceService = exactService(catalog, source.resourceServiceType);
  if (
    statementIsSource === statementIsTarget ||
    resourceService.resourceType !== source.resourceResourceType
  ) {
    throw new OwnedPolicyDescriptorCompositionError(
      "A policy resource scope must resolve to one exact statement-resource relationship.",
    );
  }

  const binding = source.statementReferenceBinding;
  if (binding !== undefined) {
    const field = exactService(
      catalog,
      statementKind.serviceType,
    ).configuration.fields.find((field) => field.property === binding.property);
    if (field?.valueSource !== "node-reference")
      throw new OwnedPolicyDescriptorCompositionError(
        "A policy scope reference requires an exact catalog node-reference field.",
      );
    configurationKeySchema.parse(binding.property);
    configurationValueSchema.parse({
      kind: "node-reference",
      nodeId: "node_descriptor_validation",
      attribute: binding.attribute,
    });
  }

  return {
    edgeConfiguration: emptyEdgeConfiguration(relationship),
    id: source.id,
    relationshipType: relationshipTypeSchema.parse(source.relationshipType),
    resourcePort: portTypeSchema.parse(source.resourcePort),
    resourceResourceType: resourceTypeSchema.parse(source.resourceResourceType),
    resourceServiceType: serviceTypeSchema.parse(source.resourceServiceType),
    statementEndpoint: statementIsSource ? "source" : "target",
    statementPort: portTypeSchema.parse(source.statementPort),
    ...(binding === undefined ? {} : { statementReferenceBinding: binding }),
  };
}

/**
 * Composes provider-neutral policy graph descriptors only from an exact editor
 * catalog plus versioned provider composition metadata.
 */
export function createOwnedPolicyGraphDescriptorSet(
  catalog: EditorCatalog,
  source: OwnedPolicyDescriptorSource,
): OwnedPolicyGraphDescriptorSet {
  const owned = ownedConfigurationDescriptors(catalog);
  const statement = childRelationshipDescriptor(
    catalog,
    source.statementMembership,
  );
  const condition = childRelationshipDescriptor(
    catalog,
    source.conditionMembership,
  );
  const descriptors: OwnedPolicyGraphDescriptorSet = {
    conditionKind: condition.childKind,
    conditionMembership: condition.descriptor,
    ownedConfigurations: owned.descriptors,
    policyOwnedKindIds: owned.policyOwnedKindIds,
    resourceScopeCardinality: source.resourceScopeCardinality,
    resourceScopes: source.resourceScopes
      .map((scope) =>
        resourceScopeDescriptor(catalog, scope, statement.childKind),
      )
      .sort((left, right) => compareText(left.id, right.id)),
    slotBindings: owned.slotBindings,
    statementKind: statement.childKind,
    statementMembership: statement.descriptor,
  };
  return deepFreeze(descriptors);
}
