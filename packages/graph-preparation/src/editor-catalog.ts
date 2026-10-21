import type { ArchitectureDocument } from "@cloudmarkup/domain";
import type { PreparedResourceRepair } from "./resource-repair-command.js";
import type { ConfigurationValue } from "@cloudmarkup/schemas";

export type EditorNodeKind = "resource" | "boundary";
export type EditorSupportState = "available" | "unsupported";
export type EditorPortDirection = "input" | "output";
export type EditorConnectionCategory =
  | "receives-events-from"
  | "reads-or-writes-data"
  | "sends-messages-or-events"
  | "invokes-another-workload"
  | "uses-secrets-or-configuration"
  | "network-and-security"
  | "observability"
  | "other";
export type EditorPortConnectionSupport = "supported" | "unsupported";
export type EditorConnectionDockSide = "bottom" | "left" | "right" | "top";
export type EditorConnectionGroupDirection = "input" | "mixed" | "output";
export type EditorConnectionGroupCategory =
  | "triggers"
  | "data"
  | "messaging"
  | "invocation"
  | "identity"
  | "networking"
  | "observability"
  | "other";
export type EditorCatalogSupportLevel =
  "proof" | "production-oriented" | "curated";
export type EditorCatalogRootPlacement = "allowed" | "required" | "forbidden";
export type EditorCatalogRegionConstraint =
  "same-region" | "provider-defined" | "not-applicable";
export type EditorCatalogMappingStatus = "metadata-only" | "implemented";

/**
 * The canvas consumes this deliberately narrow, provider-neutral projection.
 * It does not interpret service, resource, port, relationship, or icon IDs.
 */
export interface EditorCatalogPort {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
  readonly direction: EditorPortDirection;
  readonly capability: string;
  readonly category: EditorConnectionCategory;
  readonly cardinality: "one" | "many";
  readonly required: boolean;
  /** Derived from implemented rule endpoints; service declarations are facts, not compatibility. */
  readonly connectionSupport: EditorPortConnectionSupport;
}

export interface EditorConnectionGroupCardinality {
  readonly enforcement: "provider-rule" | "semantic-port";
  readonly maximum: 1 | "many";
  readonly minimum: 0 | 1;
}

export type EditorTargetReadinessStatus =
  "supported" | "pending" | "unsupported" | "not-applicable";

export interface EditorTargetReadinessEntry {
  readonly status: EditorTargetReadinessStatus;
  readonly reason: string;
}

/** Exact six-part provider target readiness; no status is inferred from IaC metadata. */
export interface EditorTargetReadiness {
  readonly modeling: EditorTargetReadinessEntry;
  readonly configuration: EditorTargetReadinessEntry;
  readonly validation: EditorTargetReadinessEntry;
  readonly terraform: EditorTargetReadinessEntry;
  readonly cloudformation: EditorTargetReadinessEntry;
  readonly generatedCode: EditorTargetReadinessEntry;
}

export interface EditorOwnedConfigurationSlot {
  readonly id: string;
  readonly slotVersion: string;
  readonly configurationKind: string;
  readonly displayName: string;
  readonly description: string;
  readonly graphBinding: {
    readonly configurationServiceType: string;
    readonly ownershipRelationshipType: string;
    readonly configurationEndpoint: "source" | "target";
    readonly configurationPortId: string;
    readonly ownerPortId: string;
  };
  readonly cardinality: EditorConnectionGroupCardinality;
  readonly allowedOwnership: readonly ("user" | "generated")[];
  readonly generatedAdoption: "allowed" | "forbidden" | "not-applicable";
  readonly policyKinds: readonly (
    | "identity-inline"
    | "trust"
    | "managed-policy-attachment"
    | "permissions-boundary"
    | "resource"
    | "generated-permission"
    | "service-grant"
  )[];
  readonly targetReadiness: EditorTargetReadiness;
  readonly guidedExplanation: string;
  readonly professionalExplanation: string;
}

/** Provider-neutral presentation metadata for one stable boundary dock. */
export interface EditorConnectionGroup {
  readonly allowsMultipleEdges: boolean;
  readonly cardinality: EditorConnectionGroupCardinality;
  readonly category: EditorConnectionGroupCategory;
  readonly containsExclusiveRelationships: boolean;
  readonly description: string;
  readonly direction: EditorConnectionGroupDirection;
  readonly exclusivePortIds: readonly string[];
  readonly guidedAssistance: string;
  readonly id: string;
  readonly label: string;
  readonly order: number;
  readonly portIds: readonly string[];
  readonly professionalMetadata: string;
  readonly side: EditorConnectionDockSide;
}

export const EDITOR_CONNECTION_CATEGORY_ORDER = [
  "receives-events-from",
  "reads-or-writes-data",
  "sends-messages-or-events",
  "invokes-another-workload",
  "uses-secrets-or-configuration",
  "network-and-security",
  "observability",
  "other",
] as const satisfies readonly EditorConnectionCategory[];

export function editorConnectionCategoryLabel(
  category: EditorConnectionCategory,
): string {
  switch (category) {
    case "receives-events-from":
      return "Receives events from";
    case "reads-or-writes-data":
      return "Reads or writes data";
    case "sends-messages-or-events":
      return "Sends messages or events";
    case "invokes-another-workload":
      return "Invokes another workload";
    case "uses-secrets-or-configuration":
      return "Uses secrets or configuration";
    case "network-and-security":
      return "Network and security";
    case "observability":
      return "Observability";
    case "other":
      return "Other";
  }
}

export interface EditorCatalogCategory {
  readonly id: "parent-required" | "root-placeable";
  readonly guidedLabel: string;
  readonly professionalLabel: string;
}

export interface EditorCatalogAllowedParent {
  readonly relationshipType: string;
  readonly serviceType: string;
}

export interface EditorCatalogPlacement {
  readonly allowedParents: readonly EditorCatalogAllowedParent[];
  readonly maximumDepth?: number;
  readonly regionConstraint: EditorCatalogRegionConstraint;
  readonly rootPlacement: EditorCatalogRootPlacement;
}

export type EditorCatalogDefaultConfiguration =
  | {
      readonly kind: "ready";
      readonly values: Readonly<Record<string, Readonly<ConfigurationValue>>>;
    }
  | {
      readonly kind: "unavailable";
      readonly reason: string;
    };

export type EditorCatalogConfigurationControl =
  "text" | "textarea" | "number" | "checkbox" | "select" | "multi-select";

export type EditorCatalogConfigurationValueSource =
  | "literal"
  | "node-reference"
  | "secret-reference"
  | "sensitive-variable-reference";

export type EditorCatalogConfigurationFieldSchema =
  | {
      readonly kind: "string";
      readonly default?: string;
      readonly enum?: readonly string[];
      readonly minimumLength?: number;
      readonly maximumLength?: number;
      readonly pattern?: string;
    }
  | {
      readonly kind: "number" | "integer";
      readonly default?: number;
      readonly enum?: readonly number[];
      readonly minimum?: number;
      readonly maximum?: number;
    }
  | {
      readonly kind: "boolean";
      readonly default?: boolean;
      readonly const?: boolean;
    }
  | {
      readonly kind: "string-list";
      readonly default?: readonly string[];
      readonly enum?: readonly string[];
      readonly minimumItems?: number;
      readonly maximumItems?: number;
      readonly uniqueItems: boolean;
    }
  | {
      readonly kind: "number-list" | "integer-list";
      readonly default?: readonly number[];
      readonly enum?: readonly number[];
      readonly minimumItems?: number;
      readonly maximumItems?: number;
      readonly uniqueItems: boolean;
    };

export interface EditorCatalogConfigurationField {
  readonly advanced: boolean;
  readonly control: EditorCatalogConfigurationControl;
  readonly costImpact: "none" | "cost-sensitive";
  readonly helpText?: string;
  readonly label: string;
  readonly order: number;
  readonly property: string;
  readonly required: boolean;
  readonly schema: EditorCatalogConfigurationFieldSchema;
  readonly securityImpact: "none" | "security-sensitive" | "secret-reference";
  readonly valueSource: EditorCatalogConfigurationValueSource;
}

export type EditorCatalogConfigurationValidationIssueCode =
  | "invalid-configuration-record"
  | "invalid-value"
  | "invalid-value-kind"
  | "missing-required-property"
  | "unknown-property"
  | "validation-unavailable";

export interface EditorCatalogConfigurationValidationIssue {
  readonly code: EditorCatalogConfigurationValidationIssueCode;
  readonly message: string;
  readonly path: string;
  readonly property: string | undefined;
}

export type EditorCatalogConfigurationValidationResult =
  | {
      readonly success: true;
      readonly values: Readonly<Record<string, Readonly<ConfigurationValue>>>;
    }
  | {
      readonly success: false;
      readonly issues: readonly EditorCatalogConfigurationValidationIssue[];
    };

export interface EditorCatalogConfiguration {
  /** Trusted provider composition binds this field to the document Region. */
  readonly documentRegionProperty?: string;
  readonly defaults: EditorCatalogDefaultConfiguration;
  readonly fields: readonly EditorCatalogConfigurationField[];
  readonly schemaId: string;
  readonly schemaVersion: string;
  readonly hasCostSensitiveFields: boolean;
  readonly hasSecuritySensitiveFields: boolean;
  readonly propertyLabels: readonly string[];
  validate(values: unknown): EditorCatalogConfigurationValidationResult;
}

export type EditorCatalogDocumentationReference =
  | {
      readonly kind: "official";
      readonly title: string;
      readonly href: string;
    }
  | {
      readonly kind: "cloudmarkup";
      readonly title: string;
      readonly path: string;
    };

export interface EditorCatalogEducation {
  readonly considerations: readonly string[];
  readonly documentation: readonly EditorCatalogDocumentationReference[];
  readonly guidedExplanation: string;
  readonly professionalExplanation: string;
  readonly summary: string;
}

export interface EditorCatalogMapping {
  readonly configurationBindings: readonly {
    readonly property: string;
    readonly targetName: string;
  }[];
  readonly implementationStatus: EditorCatalogMappingStatus;
  readonly mappingId: string;
  readonly portBindings: readonly {
    readonly portId: string;
    readonly targetAttribute: string;
  }[];
  readonly target: string;
  readonly targetResourceType: string;
  readonly targetResourceTypeLabel: string;
}

export type EditorCatalogRegionAvailability =
  | {
      readonly state: "unknown";
      readonly reason: string;
    }
  | {
      readonly state: "known";
      readonly coverage: "complete" | "partial";
      readonly regions: readonly {
        readonly availability: "available" | "unavailable";
        readonly region: string;
      }[];
    };

export interface EditorCatalogUnsupportedCapability {
  readonly explanation: string;
  readonly id: string;
  readonly title: string;
}

export interface EditorCatalogService {
  /** Provider-owned product grouping; does not change the bound resource definition. */
  readonly catalogGroup?: {
    readonly id: string;
    readonly displayName: string;
    readonly primaryServiceType: string;
    readonly variantLabel: string;
    readonly summary: string;
  };
  readonly catalogVisibility?: "configuration";
  readonly relatedServiceTypes?: readonly string[];
  /** Composition-owned infrastructure workload default; does not generate application code. */
  readonly defaultWorkload?: "infrastructure-only";
  readonly advancedSearchTerms: readonly string[];
  readonly category: EditorCatalogCategory;
  readonly configuration: EditorCatalogConfiguration;
  /**
   * Stable presentation groups for boundary docks. Older catalog adapters may
   * omit this field; the editor derives the same grouping from exact ports.
   */
  readonly connectionGroups?: readonly EditorConnectionGroup[];
  readonly education: EditorCatalogEducation;
  /** False only for graph-backed configuration nodes that are owner-surfaced. */
  readonly deployable: boolean;
  readonly serviceType: string;
  readonly resourceType: string;
  readonly displayName: string;
  readonly description: string;
  readonly nodeKind: EditorNodeKind;
  /** Present only when an exact catalog-bound service extension was accepted. */
  readonly ownedConfigurationSlots?: readonly EditorOwnedConfigurationSlot[];
  /**
   * Canvas renderability only. Provider maturity and product support are
   * separate explicit fields and must not be inferred from this value.
   */
  readonly supportState: EditorSupportState;
  readonly supportDetail: string;
  readonly supportLabel: string;
  readonly supportLevel: EditorCatalogSupportLevel;
  readonly iconId: string | null;
  readonly mappings: readonly EditorCatalogMapping[];
  readonly placement: EditorCatalogPlacement;
  readonly ports: readonly EditorCatalogPort[];
  readonly regionAvailability: EditorCatalogRegionAvailability;
  readonly searchText: string;
  readonly unsupportedCapabilities: readonly EditorCatalogUnsupportedCapability[];
  /** Present only when an exact catalog-bound service extension was accepted. */
  readonly targetReadiness?: EditorTargetReadiness;
}

export interface EditorCatalogRelationship {
  readonly category: EditorConnectionCategory;
  readonly configuration: EditorCatalogConfiguration;
  readonly descriptorId: string;
  readonly id: string;
  readonly sourceServiceType: string;
  readonly sourcePortId: string;
  readonly targetServiceType: string;
  readonly targetPortId: string;
  readonly displayName: string;
  /** Authoritative concise label from an exact connection-presentation artifact. */
  readonly presentationLabel?: string;
  readonly description: string;
  readonly education: EditorCatalogEducation;
  readonly iamEffects: readonly {
    readonly actions: readonly string[];
    readonly effect: "allow" | "trust";
    readonly explanation: string;
    readonly id: string;
    readonly principal?: string;
    readonly resourceScope:
      "source-node" | "target-node" | "connected-target" | "supporting-node";
    readonly when?: {
      readonly equals: string | number | boolean;
      readonly property: string;
    };
  }[];
  readonly implementation:
    | {
        readonly status: "not-implemented";
        readonly reason: string;
      }
    | {
        readonly status: "implemented";
        readonly implementationId: string;
        readonly interfaceVersion: number;
      };
  readonly lifecycle: {
    readonly adoption: "required-before-customization";
    readonly deletion: "release-generated-resources";
    readonly provenance: "connection-rule";
    readonly sharedResource: "retain-while-referenced";
  };
  readonly maximumConnectionsPerSource: number;
  readonly maximumConnectionsPerTarget: number;
  readonly maximumConnectionsPerEndpointPair: number;
  readonly missingInformation: readonly {
    readonly code: string;
    readonly configurationProperties: readonly string[];
    readonly guidedMessage: string;
    readonly professionalMessage: string;
    readonly trigger:
      | "missing-configuration"
      | "missing-prerequisite"
      | "ambiguous-prerequisite";
  }[];
  readonly questions: readonly {
    readonly answer:
      | {
          readonly kind: "catalog-default";
        }
      | {
          readonly kind: "required-user-input";
          readonly reason: string;
        };
    readonly explanation: string;
    readonly id: string;
    readonly prompt: string;
    readonly property: string;
  }[];
  readonly ruleVersion: string;
  readonly supportingChanges: readonly (
    | {
        readonly id: string;
        readonly kind: "node";
        readonly ownership: "generated";
        readonly purpose: string;
        readonly serviceType: string;
      }
    | {
        readonly id: string;
        readonly kind: "edge";
        readonly ownership: "generated";
        readonly purpose: string;
        readonly relationshipType: string;
      }
  )[];
  readonly validationRuleIds: readonly string[];
}

export interface EditorCatalogInvalidEntry {
  readonly id: string;
  readonly reason: string;
  readonly title: string;
}

export interface EditorCatalog {
  readonly prepareRelatedService?: (input: {
    readonly document: ArchitectureDocument;
    readonly catalog: EditorCatalog;
    readonly ownerNodeId: string;
    readonly serviceId: string;
    readonly configurationValues: Readonly<
      Record<string, Readonly<ConfigurationValue>>
    >;
    readonly createId: () => string;
  }) => PreparedResourceRepair;
  /** Exact parent metadata also requires its catalog-declared typed edge. */
  readonly parentEdges?: "catalog";
  readonly catalogDescription: string;
  readonly catalogMaturity: EditorCatalogSupportLevel;
  readonly invalidEntries: readonly EditorCatalogInvalidEntry[];
  readonly providerId: string;
  readonly providerName: string;
  readonly identity: {
    readonly id: string;
    readonly version: string;
    readonly digest: string;
  };
  readonly serviceListState:
    | {
        readonly kind: "ready";
      }
    | {
        readonly kind: "failed";
        readonly reason: string;
      };
  readonly services: readonly EditorCatalogService[];
  readonly relationships?: readonly EditorCatalogRelationship[];
}
