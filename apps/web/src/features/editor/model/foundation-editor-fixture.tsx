import { parseArchitectureDocument } from "@cloudmarkup/domain";
import {
  createIconRegistry,
  NeutralProviderIcon,
  type IconRegistry,
} from "@cloudmarkup/ui";
import { createElement, type ReactNode } from "react";

import type {
  EditorCatalog,
  EditorCatalogConfiguration,
  EditorCatalogService,
} from "./editor-catalog.js";

const ZERO_DIGEST =
  "sha256:0000000000000000000000000000000000000000000000000000000000000000";
const ONE_DIGEST =
  "sha256:1111111111111111111111111111111111111111111111111111111111111111";
const TWO_DIGEST =
  "sha256:2222222222222222222222222222222222222222222222222222222222222222";
const THREE_DIGEST =
  "sha256:3333333333333333333333333333333333333333333333333333333333333333";

const foundationArchitectureTemplate = {
  kind: "cloudmarkup.architecture-document",
  schemaVersion: 1,
  documentId: "doc_manual_canvas_foundation",
  architectureId: "architecture_manual_canvas_foundation",
  revision: {
    revisionId: "revision_manual_canvas_0001",
    revisionNumber: 1,
    createdAt: "2026-07-27T00:00:00.000Z",
    createdBy: "actor_fixture",
    sourceDraftId: "draft_manual_canvas_0001",
  },
  provider: {
    id: "example.cloud",
    region: "example-region-1",
  },
  catalog: {
    id: "example.cloud.catalog",
    version: "1.0.0",
    digest: ZERO_DIGEST,
  },
  compilerCompatibility: {
    inputContractVersion: 1,
    minimumCompilerVersion: "1.0.0",
    maximumCompilerVersionExclusive: "2.0.0",
  },
  metadata: {
    source: "template",
    serialization: {
      mediaType: "application/json",
      encoding: "utf-8",
      canonicalization: "cloudmarkup.canonical-json.v1",
    },
  },
  nodes: [
    {
      id: "node_network",
      semantic: {
        deploymentKey: "network",
        serviceType: "example.network",
        resourceType: "example.network.boundary",
        configuration: {
          schemaId: "example.network.boundary-config",
          schemaVersion: "1.0.0",
          values: {
            addressRange: {
              kind: "string",
              value: "10.0.0.0/16",
            },
          },
        },
        lifecycle: {
          ownership: "user",
          origin: "template",
        },
      },
      presentation: {
        label: "Application network",
        position: {
          x: 80,
          y: 40,
        },
      },
    },
    {
      id: "node_zone",
      semantic: {
        deploymentKey: "zone",
        serviceType: "example.zone",
        resourceType: "example.zone.boundary",
        configuration: {
          schemaId: "example.zone.boundary-config",
          schemaVersion: "1.0.0",
          values: {},
        },
        parent: {
          nodeId: "node_network",
          relationshipType: "example.relationship.contained-by",
        },
        lifecycle: {
          ownership: "user",
          origin: "template",
        },
      },
      presentation: {
        label: "Application zone",
        position: {
          x: 40,
          y: 160,
        },
      },
    },
    {
      id: "node_application",
      semantic: {
        deploymentKey: "application",
        serviceType: "example.compute",
        resourceType: "example.compute.application",
        configuration: {
          schemaId: "example.compute.application-config",
          schemaVersion: "1.0.0",
          values: {
            instanceCount: {
              kind: "integer",
              value: 2,
            },
          },
        },
        parent: {
          nodeId: "node_zone",
          relationshipType: "example.relationship.contained-by",
        },
        lifecycle: {
          ownership: "user",
          origin: "template",
        },
      },
      presentation: {
        label: "Application",
        position: {
          x: 40,
          y: 160,
        },
      },
    },
    {
      id: "node_unknown",
      semantic: {
        deploymentKey: "unknown_resource",
        serviceType: "example.mystery",
        resourceType: "example.mystery.resource",
        configuration: {
          schemaId: "example.mystery.resource-config",
          schemaVersion: "1.0.0",
          values: {},
        },
        lifecycle: {
          ownership: "user",
          origin: "template",
        },
      },
      presentation: {
        label: "Imported resource",
        position: {
          x: 860,
          y: 170,
        },
      },
    },
    {
      id: "node_unsupported",
      semantic: {
        deploymentKey: "unsupported_resource",
        serviceType: "example.legacy",
        resourceType: "example.legacy.resource",
        configuration: {
          schemaId: "example.legacy.resource-config",
          schemaVersion: "1.0.0",
          values: {},
        },
        lifecycle: {
          ownership: "user",
          origin: "template",
        },
      },
      presentation: {
        label: "Legacy resource",
        position: {
          x: 520,
          y: 520,
        },
      },
    },
  ],
  edges: [
    {
      id: "edge_application_network",
      semantic: {
        source: {
          nodeId: "node_application",
          port: "example.port.network-client",
        },
        target: {
          nodeId: "node_network",
          port: "example.port.network-segment",
        },
        relationshipType: "example.relationship.network-attachment",
        configuration: {
          schemaId: "example.relationship.network-attachment-config",
          schemaVersion: "1.0.0",
          values: {},
        },
        lifecycle: {
          ownership: "user",
          origin: "template",
        },
      },
    },
    {
      id: "edge_unknown_application",
      semantic: {
        source: {
          nodeId: "node_unknown",
          port: "example.port.mystery-output",
        },
        target: {
          nodeId: "node_application",
          port: "example.port.request",
        },
        relationshipType: "example.relationship.unspecified",
        configuration: {
          schemaId: "example.relationship.unspecified-config",
          schemaVersion: "1.0.0",
          values: {},
        },
        lifecycle: {
          ownership: "user",
          origin: "template",
        },
      },
    },
  ],
  variables: [],
  outputs: [],
  assumptions: [],
  unresolvedRequirements: [],
} as const;

export const foundationArchitectureInput = structuredClone(
  foundationArchitectureTemplate,
);

function createEmptyFoundationConfiguration(
  schemaId: string,
): EditorCatalogConfiguration {
  const validate: EditorCatalogConfiguration["validate"] = (values) => {
    if (
      typeof values !== "object" ||
      values === null ||
      Array.isArray(values)
    ) {
      return Object.freeze({
        issues: Object.freeze([
          Object.freeze({
            code: "invalid-configuration-record" as const,
            message: "Configuration values must be a strict object record.",
            path: "$.values",
            property: undefined,
          }),
        ]),
        success: false as const,
      });
    }
    const properties = Object.keys(values);
    if (properties.length > 0) {
      const property = properties.sort()[0] ?? "";
      return Object.freeze({
        issues: Object.freeze([
          Object.freeze({
            code: "unknown-property" as const,
            message:
              "The configuration property is not declared by this service.",
            path: `$.values.${property}`,
            property,
          }),
        ]),
        success: false as const,
      });
    }
    return Object.freeze({
      success: true as const,
      values: Object.freeze({}),
    });
  };

  return Object.freeze({
    defaults: Object.freeze({
      kind: "ready",
      values: Object.freeze({}),
    }),
    fields: Object.freeze([]),
    hasCostSensitiveFields: false,
    hasSecuritySensitiveFields: false,
    propertyLabels: Object.freeze([]),
    schemaId,
    schemaVersion: "1.0.0",
    validate,
  });
}

function createFoundationService(
  service: Pick<
    EditorCatalogService,
    | "description"
    | "displayName"
    | "iconId"
    | "nodeKind"
    | "ports"
    | "placement"
    | "resourceType"
    | "serviceType"
    | "supportState"
  > & {
    readonly deployable?: boolean;
  },
): EditorCatalogService {
  return Object.freeze({
    ...service,
    advancedSearchTerms: Object.freeze([
      service.serviceType,
      service.resourceType,
    ]),
    category:
      service.placement.rootPlacement === "forbidden"
        ? Object.freeze({
            guidedLabel: "Add inside a boundary",
            id: "parent-required",
            professionalLabel: "Parent required",
          })
        : Object.freeze({
            guidedLabel: "Add directly",
            id: "root-placeable",
            professionalLabel: "Root-placeable",
          }),
    configuration: createEmptyFoundationConfiguration(
      `${service.resourceType}-config`,
    ),
    education: Object.freeze({
      considerations: Object.freeze([]),
      documentation: Object.freeze([]),
      guidedExplanation: service.description,
      professionalExplanation: service.description,
      summary: service.description,
    }),
    deployable: service.deployable ?? true,
    mappings: Object.freeze([]),
    placement: Object.freeze({
      ...service.placement,
      allowedParents: Object.freeze(
        service.placement.allowedParents.map((parent) =>
          Object.freeze({ ...parent }),
        ),
      ),
    }),
    regionAvailability: Object.freeze({
      reason: "The synthetic fixture has no Region availability claim.",
      state: "unknown",
    }),
    searchText: [
      service.displayName,
      service.description,
      service.serviceType,
      service.resourceType,
    ]
      .join(" ")
      .toLocaleLowerCase("en-US"),
    supportDetail:
      service.supportState === "available"
        ? "This synthetic definition is available to the editor fixture."
        : "This synthetic definition is intentionally unsupported.",
    supportLabel:
      service.supportState === "available" ? "Available" : "Unsupported",
    supportLevel: "proof",
    unsupportedCapabilities: Object.freeze([]),
  });
}

export const foundationEditorCatalog: EditorCatalog = Object.freeze({
  catalogDescription:
    "A synthetic provider-neutral catalog for the manual canvas regression fixture.",
  catalogMaturity: "proof",
  invalidEntries: Object.freeze([]),
  providerId: "example.cloud",
  providerName: "Example Cloud",
  identity: Object.freeze({
    id: "example.cloud.catalog",
    version: "1.0.0",
    digest: ZERO_DIGEST,
  }),
  serviceListState: Object.freeze({ kind: "ready" }),
  services: Object.freeze([
    createFoundationService({
      serviceType: "example.network",
      resourceType: "example.network.boundary",
      displayName: "Network boundary",
      description:
        "A provider-neutral fixture boundary for contained application resources.",
      nodeKind: "boundary",
      supportState: "available",
      iconId: "example.icon.network",
      placement: Object.freeze({
        allowedParents: Object.freeze([]),
        maximumDepth: 1,
        regionConstraint: "not-applicable",
        rootPlacement: "required",
      }),
      ports: Object.freeze([
        Object.freeze({
          id: "example.port.network-segment",
          displayName: "Network segment",
          description: "Accepts a resource attachment to this network.",
          direction: "input",
          capability: "example.capability.network-attachment",
          category: "network-and-security",
          cardinality: "many",
          connectionSupport: "supported",
          required: false,
        }),
      ]),
    }),
    createFoundationService({
      serviceType: "example.zone",
      resourceType: "example.zone.boundary",
      displayName: "Nested boundary",
      description:
        "A provider-neutral nested boundary used to verify deterministic containment.",
      nodeKind: "boundary",
      supportState: "available",
      iconId: "example.icon.network",
      placement: Object.freeze({
        allowedParents: Object.freeze([
          Object.freeze({
            relationshipType: "example.relationship.contained-by",
            serviceType: "example.network",
          }),
        ]),
        maximumDepth: 2,
        regionConstraint: "not-applicable",
        rootPlacement: "forbidden",
      }),
      ports: Object.freeze([]),
    }),
    createFoundationService({
      serviceType: "example.compute",
      resourceType: "example.compute.application",
      displayName: "Application resource",
      description:
        "A provider-neutral fixture resource that represents application compute.",
      nodeKind: "resource",
      supportState: "available",
      iconId: "example.icon.compute",
      placement: Object.freeze({
        allowedParents: Object.freeze([
          Object.freeze({
            relationshipType: "example.relationship.contained-by",
            serviceType: "example.zone",
          }),
        ]),
        maximumDepth: 3,
        regionConstraint: "not-applicable",
        rootPlacement: "allowed",
      }),
      ports: Object.freeze([
        Object.freeze({
          id: "example.port.network-client",
          displayName: "Network client",
          description: "Connects the resource to a network boundary.",
          direction: "output",
          capability: "example.capability.network-client",
          category: "network-and-security",
          cardinality: "one",
          connectionSupport: "supported",
          required: false,
        }),
        Object.freeze({
          id: "example.port.request",
          displayName: "Request input",
          description: "Accepts a generic request relationship.",
          direction: "input",
          capability: "example.capability.request",
          category: "invokes-another-workload",
          cardinality: "many",
          connectionSupport: "unsupported",
          required: false,
        }),
      ]),
    }),
    createFoundationService({
      serviceType: "example.legacy",
      resourceType: "example.legacy.resource",
      displayName: "Legacy resource",
      description:
        "A known provider-neutral fixture resource that this editor does not support.",
      nodeKind: "resource",
      supportState: "unsupported",
      iconId: "example.icon.legacy",
      placement: Object.freeze({
        allowedParents: Object.freeze([]),
        maximumDepth: 1,
        regionConstraint: "not-applicable",
        rootPlacement: "allowed",
      }),
      ports: Object.freeze([]),
    }),
  ]),
  relationships: Object.freeze([
    Object.freeze({
      category: "network-and-security",
      configuration: createEmptyFoundationConfiguration(
        "example.relationship.network-attachment-config",
      ),
      descriptorId: "example.connection.network-attachment",
      id: "example.relationship.network-attachment",
      sourceServiceType: "example.compute",
      sourcePortId: "example.port.network-client",
      targetServiceType: "example.network",
      targetPortId: "example.port.network-segment",
      displayName: "Network attachment",
      description: "Attaches an application resource to a network boundary.",
      education: Object.freeze({
        considerations: Object.freeze([]),
        documentation: Object.freeze([]),
        guidedExplanation:
          "Connects an application resource to a network boundary.",
        professionalExplanation:
          "Creates a typed application-to-network attachment.",
        summary: "Attaches an application resource to a network boundary.",
      }),
      iamEffects: Object.freeze([]),
      implementation: Object.freeze({
        status: "not-implemented",
        reason: "The synthetic fixture has no connection resolver.",
      }),
      lifecycle: Object.freeze({
        adoption: "required-before-customization",
        deletion: "release-generated-resources",
        provenance: "connection-rule",
        sharedResource: "retain-while-referenced",
      }),
      maximumConnectionsPerSource: 1,
      maximumConnectionsPerTarget: 100,
      maximumConnectionsPerEndpointPair: 1,
      missingInformation: Object.freeze([]),
      questions: Object.freeze([]),
      ruleVersion: "1.0.0",
      supportingChanges: Object.freeze([]),
      validationRuleIds: Object.freeze([]),
    }),
  ]),
});

export function loadFoundationArchitectureDocument() {
  return parseArchitectureDocument(
    structuredClone(foundationArchitectureTemplate),
  );
}

const placeholderIcon = createElement(NeutralProviderIcon, {
  decorative: true,
  className: "cm-fixture-icon--placeholder",
});

export const foundationIconRegistry: IconRegistry<ReactNode> =
  createIconRegistry<ReactNode>({
    assetSet: {
      id: "example.cloud.fixture-icons",
      providerId: "example.cloud",
      version: "1.0.0",
      digest: THREE_DIGEST,
    },
    placeholderAsset: placeholderIcon,
    registrations: [
      {
        kind: "approved",
        iconId: "example.icon.network",
        asset: createElement(NeutralProviderIcon, {
          decorative: true,
          className: "cm-fixture-icon--network",
        }),
        sourceDigest: ONE_DIGEST,
      },
      {
        kind: "approved",
        iconId: "example.icon.compute",
        asset: createElement(NeutralProviderIcon, {
          decorative: true,
          className: "cm-fixture-icon--compute",
        }),
        sourceDigest: TWO_DIGEST,
      },
      {
        kind: "placeholder",
        iconId: "example.icon.legacy",
        reason: "pending-approval",
      },
    ],
  });
