import {
  GraphCommandApplicationError,
  applyGraphCommand,
  parseArchitectureDocument,
  type GraphChangeSummary,
  type ArchitectureDocument,
} from "@cloudmarkup/domain";
import {
  actorIdSchema,
  edgeIdSchema,
  generatorIdSchema,
  graphCommandBatchV1Schema,
  graphResourceReferenceV1Schema,
  nodeIdSchema,
  operationIdSchema,
  serializeCanonicalJson,
  utcTimestampSchema,
  type ArchitectureEdgeV1,
  type ArchitectureNodeV1,
  type ConfigurationValue,
  type EdgeId,
  type GeneratedDependencyReferenceV1,
  type GeneratedElementLifecycle,
  type GraphCommandActionV1,
  type GraphCommandBatchV1,
  type GraphCommandTargetV1,
  type GraphResourceReferenceV1,
  type NodeId,
  type ServiceConfigurationRecord,
  type VersionedArchitectureDocument,
} from "@cloudmarkup/schemas";

import { deepFreeze } from "./accessors.js";
import { z } from "zod";

import {
  providerCatalogArtifactV1Schema,
  type ProviderCatalogArtifactV1,
  type ProviderConnectionIamEffectV1,
  type ProviderConnectionMissingInformationFindingV1,
  type ProviderConnectionRuleDescriptorV1,
  type ProviderServiceDefinitionV1,
} from "./catalog-contract-v1.js";
import {
  validateProviderConfigurationV1,
  type ProviderValidatedConfigurationV1,
} from "./configuration-validation.js";

const connectionOperationIdPattern = /^[a-z][a-z0-9_]{0,31}$/u;
const implementationIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/u);
const ruleIdSchema = implementationIdSchema;

export interface ProviderConnectionEndpointSelectionV1 {
  readonly nodeId: string;
  readonly portId: string;
}

export interface ProviderConnectionResolutionRequestV1 {
  readonly document: VersionedArchitectureDocument;
  readonly ruleId: string;
  readonly source: ProviderConnectionEndpointSelectionV1;
  readonly target: ProviderConnectionEndpointSelectionV1;
  readonly configuration: unknown;
  readonly operationId: string;
}

export interface ProviderConnectionCompatibilityEndpointFilterV1 {
  readonly nodeId: string;
  readonly portId?: string;
}

export interface ProviderConnectionCompatibilityRequestV1 {
  readonly document: VersionedArchitectureDocument;
  readonly anchor: ProviderConnectionCompatibilityEndpointFilterV1;
  readonly anchorRole: "source" | "target" | "either";
  readonly counterpart?: ProviderConnectionCompatibilityEndpointFilterV1;
  readonly excludingConnectionEdgeId?: string;
}

export interface ProviderConnectionEditRequestV1 extends ProviderConnectionResolutionRequestV1 {
  readonly connectionEdgeId: string;
}

export interface ProviderConnectionCleanupRequestV1 {
  readonly document: VersionedArchitectureDocument;
  readonly connectionEdgeId: string;
  readonly operationId: string;
}

export interface ProviderGeneratedResourceAdoptionRequestV1 {
  readonly document: VersionedArchitectureDocument;
  readonly resource: GraphResourceReferenceV1;
  readonly adoptedBy: string;
  readonly adoptedAt: string;
  readonly operationId: string;
}

export interface ProviderConnectionResolutionFindingV1 {
  readonly code: string;
  readonly severity: "error" | "warning";
  readonly path: string;
  readonly guidedMessage: string;
  readonly professionalMessage: string;
}

export interface ProviderConnectionCompatibilityCandidateV1 {
  readonly rule: ProviderConnectionRuleDescriptorV1;
  readonly source: ProviderConnectionEndpointSelectionV1;
  readonly target: ProviderConnectionEndpointSelectionV1;
  readonly findings: readonly ProviderConnectionResolutionFindingV1[];
}

export interface ProviderConnectionCompatibilityResultV1 {
  readonly candidates: readonly ProviderConnectionCompatibilityCandidateV1[];
  readonly findings: readonly ProviderConnectionResolutionFindingV1[];
}

export interface ProviderConnectionCommandEnvelopeV1 {
  readonly schemaVersion: 1;
  readonly commandId: ReturnType<typeof operationIdSchema.parse>;
  readonly inverseCommandId: ReturnType<typeof operationIdSchema.parse>;
  readonly origin: "connection-rule";
  readonly target: GraphCommandTargetV1;
}

export interface ProviderConnectionRecipeContextV1 {
  readonly catalog: ProviderCatalogArtifactV1;
  readonly rule: ProviderConnectionRuleDescriptorV1;
  readonly document: ArchitectureDocument;
  readonly sourceNode: ArchitectureNodeV1;
  readonly targetNode: ArchitectureNodeV1;
  readonly configuration: ProviderValidatedConfigurationV1;
  readonly operationId: string;
  readonly connectionEdgeId: EdgeId;
  commandEnvelope(key: string): ProviderConnectionCommandEnvelopeV1;
  nodeId(key: string): NodeId;
  edgeId(key: string): EdgeId;
  generatedLifecycle(
    dependencies: readonly GeneratedDependencyReferenceV1[],
  ): GeneratedElementLifecycle;
  serviceConfiguration(
    serviceId: string,
    values: unknown,
  ): ServiceConfigurationRecord;
  connectionConfiguration(
    ruleId: string,
    values: unknown,
  ): ServiceConfigurationRecord;
}

export type ProviderConnectionRecipeResultV1 =
  | {
      readonly success: true;
      readonly commands: readonly unknown[];
      readonly generatedResources: readonly GraphResourceReferenceV1[];
      readonly findings?: readonly ProviderConnectionResolutionFindingV1[];
    }
  | {
      readonly success: false;
      readonly findings: readonly ProviderConnectionResolutionFindingV1[];
    };

export interface ProviderConnectionRuleRegistrationV1 {
  readonly interfaceVersion: 1;
  readonly ruleId: string;
  readonly ruleVersion: string;
  readonly implementationId: string;
  resolve(
    context: ProviderConnectionRecipeContextV1,
  ): ProviderConnectionRecipeResultV1;
}

export interface ProviderConnectionRuleRegistrationV1Input {
  readonly interfaceVersion: 1;
  readonly ruleId: string;
  readonly ruleVersion: string;
  readonly implementationId: string;
  resolve(
    context: ProviderConnectionRecipeContextV1,
  ): ProviderConnectionRecipeResultV1;
}

export type ProviderConnectionResolutionResultV1 =
  | {
      readonly success: true;
      readonly rule: ProviderConnectionRuleDescriptorV1;
      readonly configuration: ProviderValidatedConfigurationV1;
      readonly batch: GraphCommandBatchV1;
      readonly preview: {
        readonly document: ArchitectureDocument;
        readonly changes: readonly GraphChangeSummary[];
      };
      readonly iamEffects: readonly ProviderConnectionIamEffectV1[];
      readonly iamRequirements: readonly ProviderConnectionIamRequirementV1[];
      readonly generatedResources: readonly GraphResourceReferenceV1[];
      readonly findings: readonly ProviderConnectionResolutionFindingV1[];
    }
  | {
      readonly success: false;
      readonly findings: readonly ProviderConnectionResolutionFindingV1[];
    };

export interface ProviderConnectionIamRequirementV1 {
  readonly sourceEdgeId: string;
  readonly ruleId: string;
  readonly effectId: string;
  readonly effect: ProviderConnectionIamEffectV1["effect"];
  readonly actions: readonly string[];
  readonly resource:
    | {
        readonly scope: "source-node" | "target-node" | "connected-target";
        readonly nodeId: string;
      }
    | {
        readonly scope: "supporting-node";
      };
  readonly principal?: string;
  readonly when?: Readonly<NonNullable<ProviderConnectionIamEffectV1["when"]>>;
  readonly qualifier: {
    readonly kind: "connection-edge";
    readonly edgeId: string;
    readonly configurationSchemaId: string;
    readonly configurationSchemaVersion: string;
  };
  readonly readiness: "preview-only";
}

export type ProviderConnectionIamCompositionResultV1 =
  | {
      readonly success: true;
      readonly requirements: readonly ProviderConnectionIamRequirementV1[];
      readonly findings: readonly ProviderConnectionResolutionFindingV1[];
    }
  | {
      readonly success: false;
      readonly findings: readonly ProviderConnectionResolutionFindingV1[];
    };

export type ProviderConnectionLifecyclePreviewResultV1 =
  | {
      readonly success: true;
      readonly batch: GraphCommandBatchV1;
      readonly preview: {
        readonly document: ArchitectureDocument;
        readonly changes: readonly GraphChangeSummary[];
      };
      readonly findings: readonly ProviderConnectionResolutionFindingV1[];
    }
  | {
      readonly success: false;
      readonly findings: readonly ProviderConnectionResolutionFindingV1[];
    };

export interface ProviderConnectionResolverV1 {
  listCompatible(
    request: ProviderConnectionCompatibilityRequestV1,
  ): ProviderConnectionCompatibilityResultV1;
  resolve(
    request: ProviderConnectionResolutionRequestV1,
  ): ProviderConnectionResolutionResultV1;
  edit(
    request: ProviderConnectionEditRequestV1,
  ): ProviderConnectionResolutionResultV1;
  cleanup(
    request: ProviderConnectionCleanupRequestV1,
  ): ProviderConnectionLifecyclePreviewResultV1;
  adopt(
    request: ProviderGeneratedResourceAdoptionRequestV1,
  ): ProviderConnectionLifecyclePreviewResultV1;
}

function finding(
  code: string,
  severity: "error" | "warning",
  path: string,
  guidedMessage: string,
  professionalMessage: string,
): ProviderConnectionResolutionFindingV1 {
  return Object.freeze({
    code,
    severity,
    path,
    guidedMessage,
    professionalMessage,
  });
}

function failure(
  item: ProviderConnectionResolutionFindingV1,
): ProviderConnectionResolutionResultV1 {
  return Object.freeze({
    success: false,
    findings: Object.freeze([item]),
  });
}

function failures(
  items: readonly ProviderConnectionResolutionFindingV1[],
): ProviderConnectionResolutionResultV1 {
  return Object.freeze({
    success: false,
    findings: Object.freeze([...items]),
  });
}

function lifecycleFailure(
  item: ProviderConnectionResolutionFindingV1,
): ProviderConnectionLifecyclePreviewResultV1 {
  return Object.freeze({
    success: false,
    findings: Object.freeze([item]),
  });
}

function compatibilityResult(
  candidates: readonly ProviderConnectionCompatibilityCandidateV1[],
  findings: readonly ProviderConnectionResolutionFindingV1[] = [],
): ProviderConnectionCompatibilityResultV1 {
  return Object.freeze({
    candidates: Object.freeze([...candidates]),
    findings: Object.freeze([...findings]),
  });
}

function targetOf(document: ArchitectureDocument): GraphCommandTargetV1 {
  return {
    documentId: document.documentId,
    architectureId: document.architectureId,
    revisionId: document.revision.revisionId,
  };
}

function validateOperationId(
  operationId: string,
): ReturnType<typeof operationIdSchema.parse> | undefined {
  if (!connectionOperationIdPattern.test(operationId)) {
    return undefined;
  }
  return operationIdSchema.parse(operationId);
}

function compareStrings(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function configurationPropertyFromPath(path: string): string | undefined {
  const dotMatch = /^\$\.values\.([A-Za-z_$][A-Za-z0-9_$]*)$/u.exec(path);
  if (dotMatch?.[1] !== undefined) {
    return dotMatch[1];
  }
  const bracketMatch = /^\$\.values\[("(?:[^"\\]|\\.)*")\]$/u.exec(path);
  if (bracketMatch?.[1] === undefined) {
    return undefined;
  }
  try {
    return JSON.parse(bracketMatch[1]) as string;
  } catch {
    return undefined;
  }
}

function findingFromDescriptor(
  descriptor: ProviderConnectionMissingInformationFindingV1,
  property?: string,
): ProviderConnectionResolutionFindingV1 {
  return finding(
    descriptor.code,
    "error",
    property === undefined ? "$.document" : `$.configuration.${property}`,
    descriptor.guidedMessage,
    descriptor.professionalMessage,
  );
}

function literalConfigurationValue(
  value: Readonly<ConfigurationValue> | undefined,
): string | number | boolean | undefined {
  if (
    value === undefined ||
    !("value" in value) ||
    Array.isArray(value.value)
  ) {
    return undefined;
  }
  return value.value;
}

function selectIamEffects(
  rule: ProviderConnectionRuleDescriptorV1,
  configuration: ProviderValidatedConfigurationV1,
): readonly ProviderConnectionIamEffectV1[] {
  return Object.freeze(
    rule.iamEffects.filter((effect) => {
      if (effect.when === undefined) {
        return true;
      }
      return (
        literalConfigurationValue(configuration[effect.when.property]) ===
        effect.when.equals
      );
    }),
  );
}

function documentBindingMatches(
  document: ArchitectureDocument,
  catalog: ProviderCatalogArtifactV1,
): boolean {
  return (
    document.catalog.id === catalog.catalog.id &&
    document.catalog.version === catalog.catalog.version &&
    document.catalog.digest === catalog.digest &&
    document.provider.id === catalog.provider.id
  );
}

function resourceLifecycle(
  document: ArchitectureDocument,
  resource: GraphResourceReferenceV1,
) {
  return resource.kind === "node"
    ? document.nodes.find((node) => node.id === resource.nodeId)?.semantic
        .lifecycle
    : document.edges.find((edge) => edge.id === resource.edgeId)?.semantic
        .lifecycle;
}

function resourceSemantic(
  document: ArchitectureDocument,
  resource: GraphResourceReferenceV1,
) {
  return resource.kind === "node"
    ? document.nodes.find((node) => node.id === resource.nodeId)?.semantic
    : document.edges.find((edge) => edge.id === resource.edgeId)?.semantic;
}

function compareResourceReferences(
  left: GraphResourceReferenceV1,
  right: GraphResourceReferenceV1,
): number {
  if (left.kind !== right.kind) {
    return left.kind === "edge" ? -1 : 1;
  }
  return compareStrings(
    left.kind === "edge" ? left.edgeId : left.nodeId,
    right.kind === "edge" ? right.edgeId : right.nodeId,
  );
}

function resourceReferenceKey(resource: GraphResourceReferenceV1): string {
  return resource.kind === "node"
    ? `node:${resource.nodeId}`
    : `edge:${resource.edgeId}`;
}

function uniqueSortedResourceReferences(
  resources: readonly GraphResourceReferenceV1[],
): readonly GraphResourceReferenceV1[] {
  const byKey = new Map<string, GraphResourceReferenceV1>();
  for (const resource of resources) {
    byKey.set(resourceReferenceKey(resource), resource);
  }
  return [...byKey.values()].sort(compareResourceReferences);
}

function resourceReferencesFrom(
  document: ArchitectureDocument,
  resource: GraphResourceReferenceV1,
): readonly GraphResourceReferenceV1[] {
  const references: GraphResourceReferenceV1[] = [];
  const addLifecycleReferences = (
    lifecycle: ArchitectureNodeV1["semantic"]["lifecycle"],
  ) => {
    if (lifecycle.ownership === "user") {
      return;
    }
    references.push(
      ...lifecycle.provenance.dependentNodeIds.map((nodeId) => ({
        kind: "node" as const,
        nodeId,
      })),
      ...lifecycle.provenance.dependentEdgeIds.map((edgeId) => ({
        kind: "edge" as const,
        edgeId,
      })),
    );
  };
  const addConfigurationReferences = (
    values: Readonly<ServiceConfigurationRecord["values"]>,
  ) => {
    for (const value of Object.values(values)) {
      if (value.kind === "node-reference") {
        references.push({ kind: "node", nodeId: value.nodeId });
      }
    }
  };

  if (resource.kind === "node") {
    const node = document.nodes.find(
      (candidate) => candidate.id === resource.nodeId,
    );
    if (node === undefined) {
      return Object.freeze([]);
    }
    addLifecycleReferences(node.semantic.lifecycle);
    addConfigurationReferences(node.semantic.configuration.values);
    if (node.semantic.parent !== undefined) {
      references.push({
        kind: "node",
        nodeId: node.semantic.parent.nodeId,
      });
    }
  } else {
    const edge = document.edges.find(
      (candidate) => candidate.id === resource.edgeId,
    );
    if (edge === undefined) {
      return Object.freeze([]);
    }
    addLifecycleReferences(edge.semantic.lifecycle);
    addConfigurationReferences(edge.semantic.configuration.values);
    references.push(
      { kind: "node", nodeId: edge.semantic.source.nodeId },
      { kind: "node", nodeId: edge.semantic.target.nodeId },
    );
  }

  return Object.freeze(uniqueSortedResourceReferences(references));
}

function parseDocument(
  input: unknown,
): ArchitectureDocument | ProviderConnectionResolutionFindingV1 {
  try {
    return deepFreeze(parseArchitectureDocument(input));
  } catch {
    return finding(
      "cloudmarkup.connection.invalid-document",
      "error",
      "$.document",
      "The architecture could not be read safely.",
      "The input is not a valid supported Architecture Document v1 or v2.",
    );
  }
}

function connectionRuleMatchesEdge(
  rule: ProviderConnectionRuleDescriptorV1,
  edge: ArchitectureEdgeV1,
  sourceNode: ArchitectureNodeV1 | undefined,
  targetNode: ArchitectureNodeV1 | undefined,
): boolean {
  return (
    sourceNode?.semantic.serviceType === rule.source.serviceId &&
    targetNode?.semantic.serviceType === rule.target.serviceId &&
    edge.semantic.relationshipType === rule.relationshipType &&
    edge.semantic.source.port === rule.source.portId &&
    edge.semantic.target.port === rule.target.portId
  );
}

export function composeProviderConnectionIamRequirementsV1(
  catalogInput: ProviderCatalogArtifactV1,
  documentInput: VersionedArchitectureDocument,
): ProviderConnectionIamCompositionResultV1 {
  const catalog = deepFreeze(
    providerCatalogArtifactV1Schema.parse(catalogInput),
  );
  const parsedDocument = parseDocument(documentInput);
  if (!("kind" in parsedDocument)) {
    return Object.freeze({
      success: false,
      findings: Object.freeze([parsedDocument]),
    });
  }
  const document = parsedDocument;
  if (!documentBindingMatches(document, catalog)) {
    return Object.freeze({
      success: false,
      findings: Object.freeze([
        finding(
          "cloudmarkup.connection.catalog-mismatch",
          "error",
          "$.document.catalog",
          "Open this architecture with the provider catalog version it was created with.",
          "IAM requirement composition fails closed unless provider, catalog ID, version, and digest match exactly.",
        ),
      ]),
    });
  }

  const nodeById = new Map(document.nodes.map((node) => [node.id, node]));
  const requirements: ProviderConnectionIamRequirementV1[] = [];
  for (const edge of [...document.edges].sort((left, right) =>
    compareStrings(left.id, right.id),
  )) {
    const sourceNode = nodeById.get(edge.semantic.source.nodeId);
    const targetNode = nodeById.get(edge.semantic.target.nodeId);
    const matchingRules = catalog.connectionRules.filter((rule) =>
      connectionRuleMatchesEdge(rule, edge, sourceNode, targetNode),
    );
    if (matchingRules.length === 0) {
      continue;
    }
    if (matchingRules.length !== 1) {
      return Object.freeze({
        success: false,
        findings: Object.freeze([
          finding(
            "cloudmarkup.connection.ambiguous-rule-binding",
            "error",
            "$.document.edges",
            "This connection does not have one unambiguous catalog rule.",
            "IAM requirement composition found multiple exact rule descriptors for one edge.",
          ),
        ]),
      });
    }
    const rule = matchingRules[0];
    if (
      rule === undefined ||
      sourceNode === undefined ||
      targetNode === undefined
    ) {
      continue;
    }
    const configuration = validateProviderConfigurationV1(
      rule.configuration,
      edge.semantic.configuration.values,
    );
    if (!configuration.success) {
      return Object.freeze({
        success: false,
        findings: Object.freeze([
          finding(
            "cloudmarkup.connection.invalid-edge-configuration",
            "error",
            "$.document.edges",
            "Complete the connection settings before reviewing permissions.",
            "IAM requirement composition rejected an edge whose tagged values do not satisfy its exact rule schema.",
          ),
        ]),
      });
    }
    for (const effect of selectIamEffects(rule, configuration.values)) {
      const resource =
        effect.resourceScope === "supporting-node"
          ? ({ scope: "supporting-node" } as const)
          : ({
              scope: effect.resourceScope,
              nodeId:
                effect.resourceScope === "source-node"
                  ? sourceNode.id
                  : targetNode.id,
            } as const);
      requirements.push(
        Object.freeze({
          sourceEdgeId: edge.id,
          ruleId: rule.id,
          effectId: effect.id,
          effect: effect.effect,
          actions: Object.freeze([...effect.actions]),
          resource,
          ...(effect.principal === undefined
            ? {}
            : { principal: effect.principal }),
          ...(effect.when === undefined
            ? {}
            : { when: Object.freeze({ ...effect.when }) }),
          qualifier: Object.freeze({
            kind: "connection-edge" as const,
            edgeId: edge.id,
            configurationSchemaId: edge.semantic.configuration.schemaId,
            configurationSchemaVersion:
              edge.semantic.configuration.schemaVersion,
          }),
          readiness: "preview-only" as const,
        }),
      );
    }
  }

  requirements.sort((left, right) => {
    for (const [leftValue, rightValue] of [
      [left.sourceEdgeId, right.sourceEdgeId],
      [left.ruleId, right.ruleId],
      [left.effectId, right.effectId],
    ] as const) {
      const compared = compareStrings(leftValue, rightValue);
      if (compared !== 0) {
        return compared;
      }
    }
    return compareStrings(
      serializeCanonicalJson(left),
      serializeCanonicalJson(right),
    );
  });
  const deduplicated = requirements.filter(
    (requirement, index) =>
      index === 0 ||
      serializeCanonicalJson(requirement) !==
        serializeCanonicalJson(requirements[index - 1]),
  );
  return Object.freeze({
    success: true,
    requirements: Object.freeze(deduplicated),
    findings: Object.freeze([]),
  });
}

export function defineProviderConnectionRuleRegistrationV1(
  input: ProviderConnectionRuleRegistrationV1Input,
): ProviderConnectionRuleRegistrationV1 {
  if (
    !ruleIdSchema.safeParse(input.ruleId).success ||
    !implementationIdSchema.safeParse(input.implementationId).success ||
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.test(input.ruleVersion)
  ) {
    throw new TypeError(
      "Provider connection registration metadata is invalid.",
    );
  }
  return Object.freeze({
    interfaceVersion: input.interfaceVersion,
    ruleId: input.ruleId,
    ruleVersion: input.ruleVersion,
    implementationId: input.implementationId,
    resolve: (context: ProviderConnectionRecipeContextV1) =>
      input.resolve(context),
  });
}

export function createProviderConnectionResolverV1(
  catalogInput: ProviderCatalogArtifactV1,
  registrationsInput: readonly ProviderConnectionRuleRegistrationV1[],
): ProviderConnectionResolverV1 {
  const catalog = deepFreeze(
    providerCatalogArtifactV1Schema.parse(catalogInput),
  );
  const ruleById = new Map(
    catalog.connectionRules.map((rule) => [String(rule.id), rule]),
  );
  const serviceById = new Map(
    catalog.services.map((service) => [String(service.id), service]),
  );
  const registrationByRuleId = new Map<
    string,
    ProviderConnectionRuleRegistrationV1
  >();

  for (const registration of registrationsInput) {
    const rule = ruleById.get(registration.ruleId);
    if (
      registrationByRuleId.has(registration.ruleId) ||
      rule?.implementation.status !== "implemented" ||
      rule.ruleVersion !== registration.ruleVersion ||
      rule.implementation.implementationId !== registration.implementationId
    ) {
      throw new TypeError(
        "Provider connection registration does not match the catalog.",
      );
    }
    registrationByRuleId.set(registration.ruleId, registration);
  }

  for (const rule of catalog.connectionRules) {
    if (
      rule.implementation.status === "implemented" &&
      !registrationByRuleId.has(rule.id)
    ) {
      throw new TypeError(
        "Every implemented provider connection rule must be registered.",
      );
    }
  }

  type ConnectionOwnedLifecycle = Exclude<
    ArchitectureEdgeV1["semantic"]["lifecycle"],
    { readonly ownership: "user" }
  >;

  interface BoundDirectConnectionEdge {
    readonly connectionEdge: ArchitectureEdgeV1;
    readonly lifecycle: ConnectionOwnedLifecycle;
    readonly rule: ProviderConnectionRuleDescriptorV1;
    readonly identityOperationId: NonNullable<
      ReturnType<typeof validateOperationId>
    >;
    readonly sourceNode: ArchitectureNodeV1;
    readonly targetNode: ArchitectureNodeV1;
  }

  function bindDirectConnectionEdge(
    document: ArchitectureDocument,
    connectionEdgeId: string,
  ): BoundDirectConnectionEdge | undefined {
    const connectionEdge = document.edges.find(
      (edge) => edge.id === connectionEdgeId,
    );
    const lifecycle = connectionEdge?.semantic.lifecycle;
    if (
      connectionEdge === undefined ||
      lifecycle === undefined ||
      lifecycle.ownership === "user" ||
      lifecycle.origin !== "connection-rule" ||
      lifecycle.provenance.generatorKind !== "connection-rule"
    ) {
      return undefined;
    }
    const rule = ruleById.get(lifecycle.provenance.generatorId);
    const identityOperationId = validateOperationId(
      lifecycle.provenance.operationId,
    );
    const sourceNode = document.nodes.find(
      (node) => node.id === connectionEdge.semantic.source.nodeId,
    );
    const targetNode = document.nodes.find(
      (node) => node.id === connectionEdge.semantic.target.nodeId,
    );
    if (
      rule === undefined ||
      identityOperationId === undefined ||
      sourceNode === undefined ||
      targetNode === undefined ||
      lifecycle.provenance.generatorVersion !== rule.ruleVersion ||
      connectionEdge.id !== String(identityOperationId) + ".edge.connection" ||
      connectionEdge.semantic.relationshipType !== rule.relationshipType ||
      connectionEdge.semantic.source.port !== rule.source.portId ||
      connectionEdge.semantic.target.port !== rule.target.portId ||
      connectionEdge.semantic.configuration.schemaId !==
        rule.configuration.schemaId ||
      connectionEdge.semantic.configuration.schemaVersion !==
        rule.configuration.schemaVersion ||
      sourceNode.semantic.serviceType !== rule.source.serviceId ||
      targetNode.semantic.serviceType !== rule.target.serviceId
    ) {
      return undefined;
    }
    return Object.freeze({
      connectionEdge,
      lifecycle,
      rule,
      identityOperationId,
      sourceNode,
      targetNode,
    });
  }

  interface BoundCompatibilityEndpoint {
    readonly node: ArchitectureNodeV1;
    readonly service: ProviderServiceDefinitionV1;
    readonly portId?: string;
  }

  function bindCompatibilityEndpoint(
    document: ArchitectureDocument,
    endpoint: ProviderConnectionCompatibilityEndpointFilterV1,
    path: "$.anchor" | "$.counterpart",
  ): BoundCompatibilityEndpoint | ProviderConnectionResolutionFindingV1 {
    const node = document.nodes.find(
      (candidate) => candidate.id === endpoint.nodeId,
    );
    if (node === undefined) {
      return finding(
        "cloudmarkup.connection.endpoint-not-found",
        "error",
        `${path}.nodeId`,
        "Select a node that still exists in this architecture.",
        "The requested compatibility endpoint is absent from the bound document revision.",
      );
    }
    const service = serviceById.get(node.semantic.serviceType);
    if (service === undefined) {
      return finding(
        "cloudmarkup.connection.incompatible-service",
        "error",
        `${path}.nodeId`,
        "This node type has no connection rules in the selected catalog.",
        "The endpoint service type is absent from the exact version-bound provider catalog.",
      );
    }
    if (
      endpoint.portId !== undefined &&
      !service.ports.some((port) => port.id === endpoint.portId)
    ) {
      return finding(
        "cloudmarkup.connection.invalid-port",
        "error",
        `${path}.portId`,
        "Choose a port declared for this node type.",
        "The requested port ID is not declared by the endpoint's exact catalog service.",
      );
    }
    return Object.freeze({
      node,
      service,
      ...(endpoint.portId === undefined ? {} : { portId: endpoint.portId }),
    });
  }

  function bindExcludedConnectionEdge(
    document: ArchitectureDocument,
    connectionEdgeId: string | undefined,
  ): ArchitectureEdgeV1 | ProviderConnectionResolutionFindingV1 | undefined {
    if (connectionEdgeId === undefined) {
      return undefined;
    }
    const parsedEdgeId = edgeIdSchema.safeParse(connectionEdgeId);
    if (!parsedEdgeId.success) {
      return finding(
        "cloudmarkup.connection.invalid-resource-id",
        "error",
        "$.excludingConnectionEdgeId",
        "Select an existing generated connection to edit.",
        "The excluded connection edge ID is invalid.",
      );
    }
    const edge = document.edges.find(
      (candidate) => candidate.id === parsedEdgeId.data,
    );
    const lifecycle = edge?.semantic.lifecycle;
    const rule =
      lifecycle?.ownership === "generated" &&
      lifecycle.provenance.generatorKind === "connection-rule"
        ? ruleById.get(lifecycle.provenance.generatorId)
        : undefined;
    if (
      edge === undefined ||
      lifecycle?.ownership !== "generated" ||
      edge.semantic.relationshipType !== rule?.relationshipType ||
      edge.semantic.source.port !== rule.source.portId ||
      edge.semantic.target.port !== rule.target.portId
    ) {
      return finding(
        "cloudmarkup.connection.cleanup-not-generated",
        "error",
        "$.excludingConnectionEdgeId",
        "Only an uncustomized generated connection can be excluded while editing.",
        "Compatibility discovery cannot exclude an edge without exact connection-rule generated provenance.",
      );
    }
    return edge;
  }

  function candidateAvailabilityFindings(
    document: ArchitectureDocument,
    rule: ProviderConnectionRuleDescriptorV1,
    source: ProviderConnectionEndpointSelectionV1,
    target: ProviderConnectionEndpointSelectionV1,
    excludingConnectionEdgeId: string | undefined,
  ): readonly ProviderConnectionResolutionFindingV1[] {
    if (rule.implementation.status !== "implemented") {
      return Object.freeze([
        finding(
          "cloudmarkup.connection.rule-not-implemented",
          "error",
          "$.ruleId",
          "This catalog relationship is descriptive only and cannot be added automatically.",
          "The connection descriptor intentionally has no registered resolver implementation.",
        ),
      ]);
    }
    const sourceService = serviceById.get(rule.source.serviceId);
    const targetService = serviceById.get(rule.target.serviceId);
    const sourcePort = sourceService?.ports.find(
      (port) => port.id === rule.source.portId,
    );
    const targetPort = targetService?.ports.find(
      (port) => port.id === rule.target.portId,
    );
    if (sourcePort === undefined || targetPort === undefined) {
      return Object.freeze([
        finding(
          "cloudmarkup.connection.invalid-port",
          "error",
          "$.ruleId",
          "This catalog relationship references a port that is not available.",
          "Cardinality evaluation failed closed because the rule endpoint is absent from its service definition.",
        ),
      ]);
    }

    const consideredEdges = document.edges.filter(
      (edge) => edge.id !== excludingConnectionEdgeId,
    );
    const nodeById = new Map(document.nodes.map((node) => [node.id, node]));
    const matchingEdges = consideredEdges.filter((edge) =>
      connectionRuleMatchesEdge(
        rule,
        edge,
        nodeById.get(edge.semantic.source.nodeId),
        nodeById.get(edge.semantic.target.nodeId),
      ),
    );
    const sourcePortCount = consideredEdges.filter(
      (edge) =>
        edge.semantic.source.nodeId === source.nodeId &&
        edge.semantic.source.port === source.portId,
    ).length;
    const targetPortCount = consideredEdges.filter(
      (edge) =>
        edge.semantic.target.nodeId === target.nodeId &&
        edge.semantic.target.port === target.portId,
    ).length;
    const sourceCount = matchingEdges.filter(
      (edge) => edge.semantic.source.nodeId === source.nodeId,
    ).length;
    const targetCount = matchingEdges.filter(
      (edge) => edge.semantic.target.nodeId === target.nodeId,
    ).length;
    const endpointPairCount = matchingEdges.filter(
      (edge) =>
        edge.semantic.source.nodeId === source.nodeId &&
        edge.semantic.target.nodeId === target.nodeId,
    ).length;
    const findings: ProviderConnectionResolutionFindingV1[] = [];
    if (sourcePort.cardinality === "one" && sourcePortCount >= 1) {
      findings.push(
        finding(
          "cloudmarkup.connection.source-port-cardinality-exceeded",
          "error",
          "$.document.edges",
          "This output already has its one allowed connection.",
          "The requested edge would exceed the source port's aggregate catalog cardinality across connection rules.",
        ),
      );
    }
    if (targetPort.cardinality === "one" && targetPortCount >= 1) {
      findings.push(
        finding(
          "cloudmarkup.connection.target-port-cardinality-exceeded",
          "error",
          "$.document.edges",
          "This input already has its one allowed connection.",
          "The requested edge would exceed the target port's aggregate catalog cardinality across connection rules.",
        ),
      );
    }
    if (sourceCount >= rule.maximumConnectionsPerSource) {
      findings.push(
        finding(
          "cloudmarkup.connection.source-cardinality-exceeded",
          "error",
          "$.document.edges",
          "This resource already has the maximum number of this relationship.",
          "The requested edge would exceed the connection rule's per-source cardinality.",
        ),
      );
    }
    if (targetCount >= rule.maximumConnectionsPerTarget) {
      findings.push(
        finding(
          "cloudmarkup.connection.target-cardinality-exceeded",
          "error",
          "$.document.edges",
          "The destination already has the maximum number of this relationship.",
          "The requested edge would exceed the connection rule's per-target cardinality.",
        ),
      );
    }
    if (endpointPairCount >= rule.maximumConnectionsPerEndpointPair) {
      findings.push(
        finding(
          "cloudmarkup.connection.endpoint-pair-cardinality-exceeded",
          "error",
          "$.document.edges",
          "These two resources already have the maximum number of this relationship.",
          "The requested edge would exceed the connection rule's per-endpoint-pair cardinality.",
        ),
      );
    }
    return Object.freeze(findings);
  }

  function compareCompatibilityCandidates(
    left: ProviderConnectionCompatibilityCandidateV1,
    right: ProviderConnectionCompatibilityCandidateV1,
  ): number {
    for (const [leftValue, rightValue] of [
      [left.rule.id, right.rule.id],
      [left.source.nodeId, right.source.nodeId],
      [left.source.portId, right.source.portId],
      [left.target.nodeId, right.target.nodeId],
      [left.target.portId, right.target.portId],
    ] as const) {
      const compared = compareStrings(leftValue, rightValue);
      if (compared !== 0) {
        return compared;
      }
    }
    return 0;
  }

  function listCompatible(
    request: ProviderConnectionCompatibilityRequestV1,
  ): ProviderConnectionCompatibilityResultV1 {
    const parsedDocument = parseDocument(request.document);
    if (!("kind" in parsedDocument)) {
      return compatibilityResult([], [parsedDocument]);
    }
    const document = parsedDocument;
    if (!documentBindingMatches(document, catalog)) {
      return compatibilityResult(
        [],
        [
          finding(
            "cloudmarkup.connection.catalog-mismatch",
            "error",
            "$.document.catalog",
            "Open this architecture with the provider catalog version it was created with.",
            "Compatibility discovery fails closed unless provider, catalog ID, version, and digest match exactly.",
          ),
        ],
      );
    }
    const anchorRole: unknown = request.anchorRole;
    if (
      anchorRole !== "source" &&
      anchorRole !== "target" &&
      anchorRole !== "either"
    ) {
      return compatibilityResult(
        [],
        [
          finding(
            "cloudmarkup.connection.invalid-anchor-role",
            "error",
            "$.anchorRole",
            "Start from a declared output, input, or resource connection action.",
            "Compatibility discovery requires anchorRole to be source, target, or either.",
          ),
        ],
      );
    }
    const anchor = bindCompatibilityEndpoint(
      document,
      request.anchor,
      "$.anchor",
    );
    if ("code" in anchor) {
      return compatibilityResult([], [anchor]);
    }
    const counterpart =
      request.counterpart === undefined
        ? undefined
        : bindCompatibilityEndpoint(
            document,
            request.counterpart,
            "$.counterpart",
          );
    if (counterpart !== undefined && "code" in counterpart) {
      return compatibilityResult([], [counterpart]);
    }
    const excludedEdge = bindExcludedConnectionEdge(
      document,
      request.excludingConnectionEdgeId,
    );
    if (excludedEdge !== undefined && "code" in excludedEdge) {
      return compatibilityResult([], [excludedEdge]);
    }
    const excludingConnectionEdgeId = excludedEdge?.id;

    const candidates: ProviderConnectionCompatibilityCandidateV1[] = [];
    const candidateKeys = new Set<string>();
    const collect = (anchorRole: "source" | "target") => {
      for (const rule of catalog.connectionRules) {
        const anchorDescriptor =
          anchorRole === "source" ? rule.source : rule.target;
        const counterpartDescriptor =
          anchorRole === "source" ? rule.target : rule.source;
        if (
          anchor.node.semantic.serviceType !== anchorDescriptor.serviceId ||
          (anchor.portId !== undefined &&
            anchor.portId !== anchorDescriptor.portId)
        ) {
          continue;
        }
        const counterpartNodes =
          counterpart === undefined ? document.nodes : [counterpart.node];
        for (const counterpartNode of counterpartNodes) {
          if (
            counterpartNode.semantic.serviceType !==
              counterpartDescriptor.serviceId ||
            (counterpart?.portId !== undefined &&
              counterpart.portId !== counterpartDescriptor.portId)
          ) {
            continue;
          }
          const source =
            anchorRole === "source"
              ? {
                  nodeId: anchor.node.id,
                  portId: rule.source.portId,
                }
              : {
                  nodeId: counterpartNode.id,
                  portId: rule.source.portId,
                };
          const target =
            anchorRole === "source"
              ? {
                  nodeId: counterpartNode.id,
                  portId: rule.target.portId,
                }
              : {
                  nodeId: anchor.node.id,
                  portId: rule.target.portId,
                };
          const key = [
            rule.id,
            source.nodeId,
            source.portId,
            target.nodeId,
            target.portId,
          ].join("\u0000");
          if (candidateKeys.has(key)) {
            continue;
          }
          candidateKeys.add(key);
          candidates.push(
            Object.freeze({
              rule,
              source: Object.freeze(source),
              target: Object.freeze(target),
              findings: candidateAvailabilityFindings(
                document,
                rule,
                source,
                target,
                excludingConnectionEdgeId,
              ),
            }),
          );
        }
      }
    };

    if (request.anchorRole !== "target") {
      collect("source");
    }
    if (request.anchorRole !== "source") {
      collect("target");
    }
    candidates.sort(compareCompatibilityCandidates);
    if (candidates.length > 0) {
      return compatibilityResult(candidates);
    }

    if (request.anchorRole !== "either") {
      const reverseCandidates: ProviderConnectionCompatibilityCandidateV1[] =
        [];
      const originalCandidatesLength = candidates.length;
      const originalKeys = new Set(candidateKeys);
      collect(request.anchorRole === "source" ? "target" : "source");
      reverseCandidates.push(...candidates.slice(originalCandidatesLength));
      candidates.length = originalCandidatesLength;
      candidateKeys.clear();
      for (const key of originalKeys) {
        candidateKeys.add(key);
      }
      if (reverseCandidates.length > 0) {
        return compatibilityResult(
          [],
          [
            finding(
              "cloudmarkup.connection.unsupported-direction",
              "error",
              "$.anchor",
              "Start the connection from the output side shown by the catalog.",
              "The selected endpoints match only in the reverse canonical direction.",
            ),
          ],
        );
      }
    }

    const requestedPairRules =
      counterpart === undefined
        ? []
        : catalog.connectionRules.flatMap((rule) => {
            const roles =
              request.anchorRole === "either"
                ? (["source", "target"] as const)
                : ([request.anchorRole] as const);
            return roles.flatMap((role) => {
              const anchorDescriptor =
                role === "source" ? rule.source : rule.target;
              const counterpartDescriptor =
                role === "source" ? rule.target : rule.source;
              return anchor.node.semantic.serviceType ===
                anchorDescriptor.serviceId &&
                counterpart.node.semantic.serviceType ===
                  counterpartDescriptor.serviceId
                ? [{ anchorDescriptor, counterpartDescriptor }]
                : [];
            });
          });
    const anchorPortCompatibleRules = requestedPairRules.filter(
      ({ anchorDescriptor }) =>
        anchor.portId === undefined ||
        anchor.portId === anchorDescriptor.portId,
    );
    const invalidPortPath =
      anchor.portId !== undefined && anchorPortCompatibleRules.length === 0
        ? "$.anchor.portId"
        : counterpart?.portId !== undefined &&
            !anchorPortCompatibleRules.some(
              ({ counterpartDescriptor }) =>
                counterpart.portId === counterpartDescriptor.portId,
            )
          ? "$.counterpart.portId"
          : "$.anchor.portId";
    const requestedPairHasRule = requestedPairRules.length > 0;
    return compatibilityResult(
      [],
      [
        finding(
          requestedPairHasRule
            ? "cloudmarkup.connection.invalid-port"
            : "cloudmarkup.connection.incompatible-service",
          "error",
          requestedPairHasRule ? invalidPortPath : "$.anchor.nodeId",
          requestedPairHasRule
            ? "Use the compatible output and input ports shown for this connection."
            : "These node types do not have a compatible catalog connection.",
          requestedPairHasRule
            ? "The selected service types have a rule, but the requested ports do not match its exact endpoints."
            : "No version-bound connection descriptor matches the requested endpoint filters.",
        ),
      ],
    );
  }

  function resolve(
    request: ProviderConnectionResolutionRequestV1,
  ): ProviderConnectionResolutionResultV1 {
    const parsedDocument = parseDocument(request.document);
    if (!("kind" in parsedDocument)) {
      return failure(parsedDocument);
    }
    const document = parsedDocument;
    if (!documentBindingMatches(document, catalog)) {
      return failure(
        finding(
          "cloudmarkup.connection.catalog-mismatch",
          "error",
          "$.document.catalog",
          "Open this architecture with the provider catalog version it was created with.",
          "Connection resolution fails closed unless provider, catalog ID, version, and digest match exactly.",
        ),
      );
    }
    const operationId = validateOperationId(request.operationId);
    if (operationId === undefined) {
      return failure(
        finding(
          "cloudmarkup.connection.invalid-operation-id",
          "error",
          "$.operationId",
          "Use a short, stable operation name made from lowercase letters, numbers, and underscores.",
          "Connection operation IDs must be deployment-safe deterministic seeds of at most 32 characters.",
        ),
      );
    }
    const rule = ruleById.get(request.ruleId);
    if (rule === undefined) {
      return failure(
        finding(
          "cloudmarkup.connection.rule-not-found",
          "error",
          "$.ruleId",
          "This connection is not available in the selected catalog.",
          "No version-bound connection descriptor matches the requested rule ID.",
        ),
      );
    }
    if (rule.implementation.status !== "implemented") {
      return failure(
        finding(
          "cloudmarkup.connection.rule-not-implemented",
          "error",
          "$.ruleId",
          "This catalog relationship is descriptive only and cannot be added automatically.",
          "The connection descriptor intentionally has no registered resolver implementation.",
        ),
      );
    }
    const registration = registrationByRuleId.get(rule.id);
    if (registration === undefined) {
      return failure(
        finding(
          "cloudmarkup.connection.registration-missing",
          "error",
          "$.ruleId",
          "The connection resolver is not available.",
          "The reviewed implementation registration is missing for this catalog rule.",
        ),
      );
    }

    const sourceNode = document.nodes.find(
      (node) => node.id === request.source.nodeId,
    );
    const targetNode = document.nodes.find(
      (node) => node.id === request.target.nodeId,
    );
    if (sourceNode === undefined || targetNode === undefined) {
      return failure(
        finding(
          "cloudmarkup.connection.endpoint-not-found",
          "error",
          sourceNode === undefined ? "$.source.nodeId" : "$.target.nodeId",
          "Select nodes that still exist in this architecture.",
          "A requested connection endpoint is absent from the bound document revision.",
        ),
      );
    }
    if (
      (sourceNode.semantic.serviceType !== rule.source.serviceId ||
        targetNode.semantic.serviceType !== rule.target.serviceId) &&
      sourceNode.semantic.serviceType === rule.target.serviceId &&
      targetNode.semantic.serviceType === rule.source.serviceId
    ) {
      return failure(
        finding(
          "cloudmarkup.connection.unsupported-direction",
          "error",
          "$.source",
          "Start the connection from the output side shown by the catalog.",
          "The selected services match this rule only in the reverse direction.",
        ),
      );
    }
    if (
      sourceNode.semantic.serviceType !== rule.source.serviceId ||
      targetNode.semantic.serviceType !== rule.target.serviceId
    ) {
      return failure(
        finding(
          "cloudmarkup.connection.incompatible-service",
          "error",
          "$.source",
          "These node types cannot use this connection.",
          "The endpoint service types do not match the versioned rule descriptor.",
        ),
      );
    }
    if (
      request.source.portId !== rule.source.portId ||
      request.target.portId !== rule.target.portId
    ) {
      return failure(
        finding(
          "cloudmarkup.connection.invalid-port",
          "error",
          request.source.portId !== rule.source.portId
            ? "$.source.portId"
            : "$.target.portId",
          "Use the compatible output and input ports shown for this connection.",
          "The requested port IDs do not exactly match the versioned connection descriptor.",
        ),
      );
    }

    const availabilityFindings = candidateAvailabilityFindings(
      document,
      rule,
      request.source,
      request.target,
      undefined,
    );
    if (availabilityFindings.length > 0) {
      return failures(availabilityFindings);
    }

    const configurationResult = validateProviderConfigurationV1(
      rule.configuration,
      request.configuration,
    );
    if (!configurationResult.success) {
      const firstIssue = configurationResult.issues[0];
      const property =
        firstIssue === undefined
          ? undefined
          : configurationPropertyFromPath(firstIssue.path);
      const describedFinding = rule.missingInformationFindings.find(
        (candidate) =>
          candidate.trigger === "missing-configuration" &&
          property !== undefined &&
          candidate.configurationProperties.some(
            (candidateProperty) => candidateProperty === property,
          ),
      );
      return failure(
        describedFinding === undefined
          ? finding(
              "cloudmarkup.connection.invalid-configuration",
              "error",
              firstIssue?.path ?? "$.configuration",
              "Complete the required connection settings using the supported values.",
              "Connection configuration failed the strict version-bound schema.",
            )
          : findingFromDescriptor(describedFinding, property),
      );
    }

    const connectionEdgeId = edgeIdSchema.parse(
      `${operationId}.edge.connection`,
    );
    const commandTarget = targetOf(document);
    const commandEnvelope = (
      key: string,
    ): ProviderConnectionCommandEnvelopeV1 => {
      if (!/^[a-z][a-z0-9-]{0,31}$/u.test(key)) {
        throw new TypeError("Connection command keys must be stable slugs.");
      }
      return {
        schemaVersion: 1,
        commandId: operationIdSchema.parse(`${operationId}.do.${key}`),
        inverseCommandId: operationIdSchema.parse(`${operationId}.undo.${key}`),
        origin: "connection-rule",
        target: commandTarget,
      };
    };
    const generatedLifecycle = (
      dependencies: readonly GeneratedDependencyReferenceV1[],
    ): GeneratedElementLifecycle => ({
      ownership: "generated",
      origin: "connection-rule",
      provenance: {
        generatorKind: "connection-rule",
        generatorId: generatorIdSchema.parse(rule.id),
        generatorVersion: rule.ruleVersion,
        operationId,
        dependentNodeIds: dependencies
          .filter(
            (
              dependency,
            ): dependency is Extract<
              GeneratedDependencyReferenceV1,
              { kind: "node" }
            > => dependency.kind === "node",
          )
          .map((dependency) => dependency.nodeId)
          .sort(compareStrings),
        dependentEdgeIds: dependencies
          .filter(
            (
              dependency,
            ): dependency is Extract<
              GeneratedDependencyReferenceV1,
              { kind: "edge" }
            > => dependency.kind === "edge",
          )
          .map((dependency) => dependency.edgeId)
          .sort(compareStrings),
      },
    });
    const validatedConfiguration = (
      definition:
        ProviderServiceDefinitionV1 | ProviderConnectionRuleDescriptorV1,
      values: unknown,
    ): ServiceConfigurationRecord => {
      const result = validateProviderConfigurationV1(
        definition.configuration,
        values,
      );
      if (!result.success) {
        throw new TypeError(
          "A reviewed connection recipe produced invalid configuration.",
        );
      }
      return {
        schemaId: definition.configuration.schemaId,
        schemaVersion: definition.configuration.schemaVersion,
        values: result.values,
      };
    };
    const context: ProviderConnectionRecipeContextV1 = Object.freeze({
      catalog,
      rule,
      document,
      sourceNode,
      targetNode,
      configuration: configurationResult.values,
      operationId,
      connectionEdgeId,
      commandEnvelope,
      nodeId: (key: string) => nodeIdSchema.parse(`${operationId}.node.${key}`),
      edgeId: (key: string) => edgeIdSchema.parse(`${operationId}.edge.${key}`),
      generatedLifecycle,
      serviceConfiguration: (serviceId: string, values: unknown) => {
        const service = serviceById.get(serviceId);
        if (service === undefined) {
          throw new TypeError(
            "A reviewed connection recipe referenced an unknown service.",
          );
        }
        return validatedConfiguration(service, values);
      },
      connectionConfiguration: (ruleId: string, values: unknown) => {
        const supportingRule = ruleById.get(ruleId);
        if (supportingRule === undefined) {
          throw new TypeError(
            "A reviewed connection recipe referenced an unknown connection rule.",
          );
        }
        return validatedConfiguration(supportingRule, values);
      },
    });

    let recipeResult: ProviderConnectionRecipeResultV1;
    try {
      recipeResult = registration.resolve(context);
    } catch {
      return failure(
        finding(
          "cloudmarkup.connection.recipe-failed",
          "error",
          "$.ruleId",
          "The connection could not be prepared safely.",
          "The reviewed resolver rejected its inputs or produced an invalid internal plan.",
        ),
      );
    }
    if (!recipeResult.success) {
      return Object.freeze({
        success: false,
        findings: Object.freeze([...recipeResult.findings]),
      });
    }
    const recipeFindings = Object.freeze([...(recipeResult.findings ?? [])]);
    if (recipeFindings.some((item) => item.severity === "error")) {
      return Object.freeze({
        success: false,
        findings: recipeFindings,
      });
    }
    const generatedResourcesResult = z
      .array(graphResourceReferenceV1Schema)
      .safeParse([
        { kind: "edge" as const, edgeId: connectionEdgeId },
        ...recipeResult.generatedResources,
      ]);
    if (!generatedResourcesResult.success) {
      return failure(
        finding(
          "cloudmarkup.connection.invalid-generated-resource-preview",
          "error",
          "$.generatedResources",
          "The connection could not prepare a complete generated-resource preview.",
          "The reviewed recipe returned an invalid generated-resource reference.",
        ),
      );
    }
    const generatedResources = Object.freeze([
      ...generatedResourcesResult.data,
    ]);

    const directEdge: ArchitectureEdgeV1 = {
      id: connectionEdgeId,
      semantic: {
        source: {
          nodeId: sourceNode.id,
          port: rule.source.portId,
        },
        target: {
          nodeId: targetNode.id,
          port: rule.target.portId,
        },
        relationshipType: rule.relationshipType,
        configuration: {
          schemaId: rule.configuration.schemaId,
          schemaVersion: rule.configuration.schemaVersion,
          values: configurationResult.values,
        },
        lifecycle: generatedLifecycle([
          { kind: "node", nodeId: sourceNode.id },
          { kind: "node", nodeId: targetNode.id },
        ]),
      },
    };
    const batchResult = graphCommandBatchV1Schema.safeParse({
      ...commandEnvelope("batch"),
      kind: "batch",
      commands: [
        {
          ...commandEnvelope("add-connection"),
          kind: "add-edge",
          edge: directEdge,
        },
        ...recipeResult.commands,
      ],
    });
    if (!batchResult.success) {
      return failure(
        finding(
          "cloudmarkup.connection.invalid-command-batch",
          "error",
          "$.ruleId",
          "The connection could not be previewed safely.",
          "The reviewed recipe did not produce a valid Graph Command v1 atomic batch.",
        ),
      );
    }

    const createdResources = batchResult.data.commands
      .flatMap((command): readonly GraphResourceReferenceV1[] => {
        if (command.kind === "add-node") {
          return [{ kind: "node", nodeId: command.node.id }];
        }
        if (command.kind === "add-edge") {
          return [{ kind: "edge", edgeId: command.edge.id }];
        }
        return [];
      })
      .sort(compareResourceReferences);
    const declaredGeneratedResources = [...generatedResources].sort(
      compareResourceReferences,
    );
    if (
      serializeCanonicalJson(createdResources) !==
      serializeCanonicalJson(declaredGeneratedResources)
    ) {
      return failure(
        finding(
          "cloudmarkup.connection.invalid-generated-resource-preview",
          "error",
          "$.generatedResources",
          "The connection could not prepare a complete generated-resource preview.",
          "Every node or edge created by the connection batch must appear exactly once in the generated-resource preview.",
        ),
      );
    }

    try {
      const preview = applyGraphCommand(document, batchResult.data);
      const generatedResourceKeys = new Set<string>();
      const invalidGeneratedResourceIndex = generatedResources.findIndex(
        (resource) => {
          const key = resourceReferenceKey(resource);
          if (generatedResourceKeys.has(key)) {
            return true;
          }
          generatedResourceKeys.add(key);
          const lifecycle = resourceLifecycle(preview.document, resource);
          return (
            lifecycle?.ownership !== "generated" ||
            lifecycle.provenance.generatorKind !== "connection-rule" ||
            String(lifecycle.provenance.generatorId) !== String(rule.id) ||
            lifecycle.provenance.generatorVersion !== rule.ruleVersion ||
            lifecycle.provenance.operationId !== operationId
          );
        },
      );
      if (invalidGeneratedResourceIndex >= 0) {
        return failure(
          finding(
            "cloudmarkup.connection.invalid-generated-resource-preview",
            "error",
            `$.generatedResources[${String(invalidGeneratedResourceIndex)}]`,
            "The connection could not prepare a complete generated-resource preview.",
            "Every generated-resource reference must resolve uniquely to an element created by this exact rule and operation.",
          ),
        );
      }
      const iamComposition = composeProviderConnectionIamRequirementsV1(
        catalog,
        preview.document,
      );
      if (!iamComposition.success) {
        return failures(iamComposition.findings);
      }
      return Object.freeze({
        success: true,
        rule,
        configuration: configurationResult.values,
        batch: batchResult.data,
        preview: Object.freeze({
          document: preview.document,
          changes: Object.freeze([...preview.changes]),
        }),
        iamEffects: selectIamEffects(rule, configurationResult.values),
        iamRequirements: iamComposition.requirements,
        generatedResources,
        findings: Object.freeze([
          ...recipeFindings,
          ...iamComposition.findings,
        ]),
      });
    } catch (error) {
      const path =
        error instanceof GraphCommandApplicationError
          ? (error.issues[0]?.path ?? "$.batch")
          : "$.batch";
      return failure(
        finding(
          "cloudmarkup.connection.preview-rejected",
          "error",
          path,
          "The connection preview conflicts with the current architecture.",
          "Graph Command v1 rejected the proposed atomic batch without mutating the document.",
        ),
      );
    }
  }

  function cleanup(
    request: ProviderConnectionCleanupRequestV1,
  ): ProviderConnectionLifecyclePreviewResultV1 {
    const parsedDocument = parseDocument(request.document);
    if (!("kind" in parsedDocument)) {
      return lifecycleFailure(parsedDocument);
    }
    const document = parsedDocument;
    if (!documentBindingMatches(document, catalog)) {
      return lifecycleFailure(
        finding(
          "cloudmarkup.connection.catalog-mismatch",
          "error",
          "$.document.catalog",
          "Open this architecture with its exact provider catalog before removing generated resources.",
          "Cleanup is version-bound to the document's provider catalog digest.",
        ),
      );
    }
    const operationId = validateOperationId(request.operationId);
    if (operationId === undefined) {
      return lifecycleFailure(
        finding(
          "cloudmarkup.connection.invalid-operation-id",
          "error",
          "$.operationId",
          "Use a short, stable cleanup operation name.",
          "Cleanup operation IDs must be deployment-safe deterministic seeds.",
        ),
      );
    }
    const connectionEdgeIdResult = edgeIdSchema.safeParse(
      request.connectionEdgeId,
    );
    if (!connectionEdgeIdResult.success) {
      return lifecycleFailure(
        finding(
          "cloudmarkup.connection.invalid-resource-id",
          "error",
          "$.connectionEdgeId",
          "Select a generated connection edge from this architecture.",
          "The requested connection edge ID is invalid.",
        ),
      );
    }
    const directConnection = bindDirectConnectionEdge(
      document,
      connectionEdgeIdResult.data,
    );
    if (directConnection === undefined) {
      return lifecycleFailure(
        finding(
          "cloudmarkup.connection.cleanup-not-generated",
          "error",
          "$.connectionEdgeId",
          "Only a generated connection can be removed with automatic cleanup.",
          "The requested edge is not the exact direct edge produced by its current connection rule and operation provenance.",
        ),
      );
    }
    const { connectionEdge, identityOperationId, lifecycle, rule } =
      directConnection;
    const hasWorkloadBinding = document.workloadBehavior.workloads.some(
      (workload) =>
        workload.triggers.some(
          (binding) => binding.edgeId === connectionEdge.id,
        ) ||
        workload.downstreamActions.some(
          (binding) => binding.edgeId === connectionEdge.id,
        ),
    );
    if (hasWorkloadBinding) {
      return lifecycleFailure(
        finding(
          "cloudmarkup.connection.workload-binding-blocks-cleanup",
          "error",
          "$.connectionEdgeId",
          "Remove this connection from the workload's triggers or downstream actions before disconnecting it.",
          "Automatic cleanup cannot release a direct connection edge referenced by Workload Behavior; the batch is withheld before dependent resources are released.",
        ),
      );
    }

    const matchesConnectionOperation = (
      candidateLifecycle: ArchitectureNodeV1["semantic"]["lifecycle"],
    ) =>
      candidateLifecycle.ownership !== "user" &&
      candidateLifecycle.origin === "connection-rule" &&
      candidateLifecycle.provenance.generatorKind === "connection-rule" &&
      String(candidateLifecycle.provenance.generatorId) === String(rule.id) &&
      candidateLifecycle.provenance.generatorVersion === rule.ruleVersion &&
      candidateLifecycle.provenance.operationId === identityOperationId;
    const operationResources = uniqueSortedResourceReferences([
      ...document.edges
        .filter((edge) => matchesConnectionOperation(edge.semantic.lifecycle))
        .map((edge) => ({ kind: "edge" as const, edgeId: edge.id })),
      ...document.nodes
        .filter((node) => matchesConnectionOperation(node.semantic.lifecycle))
        .map((node) => ({ kind: "node" as const, nodeId: node.id })),
    ]);
    const directDependents = uniqueSortedResourceReferences([
      ...document.edges
        .filter(
          (edge) =>
            edge.id !== connectionEdge.id &&
            edge.semantic.lifecycle.ownership !== "user" &&
            edge.semantic.lifecycle.provenance.dependentEdgeIds.includes(
              connectionEdge.id,
            ),
        )
        .map((edge) => ({ kind: "edge" as const, edgeId: edge.id })),
      ...document.nodes
        .filter(
          (node) =>
            node.semantic.lifecycle.ownership !== "user" &&
            node.semantic.lifecycle.provenance.dependentEdgeIds.includes(
              connectionEdge.id,
            ),
        )
        .map((node) => ({ kind: "node" as const, nodeId: node.id })),
    ]);
    const operationResourceKeys = new Set(
      operationResources.map(resourceReferenceKey),
    );
    const connectionResource = {
      kind: "edge" as const,
      edgeId: connectionEdge.id,
    };
    const cleanupCandidates = uniqueSortedResourceReferences([
      ...operationResources.filter(
        (resource) =>
          resourceReferenceKey(resource) !==
          resourceReferenceKey(connectionResource),
      ),
      ...directDependents,
    ]);
    const adopted = [connectionResource, ...cleanupCandidates].find(
      (resource) =>
        resourceLifecycle(document, resource)?.ownership === "adopted",
    );
    if (adopted !== undefined) {
      return lifecycleFailure(
        finding(
          "cloudmarkup.connection.adopted-resource-blocks-cleanup",
          "error",
          "$.connectionEdgeId",
          "This connection has a customized generated resource. Remove or reconnect it explicitly.",
          "Automatic cleanup cannot release adopted resources or their provenance dependency; the batch is withheld.",
        ),
      );
    }

    const commandTarget = targetOf(document);
    const envelope = (
      key: string,
      index: number,
    ): ProviderConnectionCommandEnvelopeV1 => ({
      schemaVersion: 1,
      commandId: operationIdSchema.parse(
        `${operationId}.do.${String(index)}-${key}`,
      ),
      inverseCommandId: operationIdSchema.parse(
        `${operationId}.undo.${String(index)}-${key}`,
      ),
      origin: "connection-rule",
      target: commandTarget,
    });
    const candidateByKey = new Map(
      cleanupCandidates.map((resource) => [
        resourceReferenceKey(resource),
        resource,
      ]),
    );
    const outgoingByKey = new Map<string, Set<string>>(
      cleanupCandidates.map((resource) => [
        resourceReferenceKey(resource),
        new Set<string>(),
      ]),
    );
    const incomingCountByKey = new Map<string, number>(
      cleanupCandidates.map((resource) => [resourceReferenceKey(resource), 0]),
    );
    for (const resource of cleanupCandidates) {
      const sourceKey = resourceReferenceKey(resource);
      const outgoing = outgoingByKey.get(sourceKey);
      if (outgoing === undefined) {
        continue;
      }
      for (const referencedResource of resourceReferencesFrom(
        document,
        resource,
      )) {
        const targetKey = resourceReferenceKey(referencedResource);
        if (!candidateByKey.has(targetKey) || outgoing.has(targetKey)) {
          continue;
        }
        outgoing.add(targetKey);
        incomingCountByKey.set(
          targetKey,
          (incomingCountByKey.get(targetKey) ?? 0) + 1,
        );
      }
    }
    const ready = cleanupCandidates
      .filter(
        (resource) =>
          incomingCountByKey.get(resourceReferenceKey(resource)) === 0,
      )
      .sort(compareResourceReferences);
    const plannedResources: GraphResourceReferenceV1[] = [];
    while (ready.length > 0) {
      const resource = ready.shift();
      if (resource === undefined) {
        break;
      }
      plannedResources.push(resource);
      const targetKeys = [
        ...(outgoingByKey.get(resourceReferenceKey(resource)) ?? []),
      ].sort(compareStrings);
      for (const targetKey of targetKeys) {
        const nextCount = (incomingCountByKey.get(targetKey) ?? 0) - 1;
        incomingCountByKey.set(targetKey, nextCount);
        if (nextCount === 0) {
          const target = candidateByKey.get(targetKey);
          if (target !== undefined) {
            ready.push(target);
            ready.sort(compareResourceReferences);
          }
        }
      }
    }
    if (plannedResources.length !== cleanupCandidates.length) {
      return lifecycleFailure(
        finding(
          "cloudmarkup.connection.cleanup-dependency-cycle",
          "error",
          "$.connectionEdgeId",
          "This connection's generated resources reference each other in a cycle. Adopt or remove them explicitly.",
          "Automatic cleanup cannot derive a dependency-safe order for the complete connection-operation provenance closure; the batch is withheld.",
        ),
      );
    }

    const dependenciesFor = (
      resource: GraphResourceReferenceV1,
      expectedLifecycle: GeneratedElementLifecycle,
    ): readonly GeneratedDependencyReferenceV1[] => {
      if (!operationResourceKeys.has(resourceReferenceKey(resource))) {
        return Object.freeze([
          { kind: "edge" as const, edgeId: connectionEdge.id },
        ]);
      }
      return Object.freeze(
        uniqueSortedResourceReferences([
          ...expectedLifecycle.provenance.dependentNodeIds.map((nodeId) => ({
            kind: "node" as const,
            nodeId,
          })),
          ...expectedLifecycle.provenance.dependentEdgeIds.map((edgeId) => ({
            kind: "edge" as const,
            edgeId,
          })),
        ]).filter((dependency) => {
          const dependencyLifecycle = resourceLifecycle(document, dependency);
          return (
            dependencyLifecycle === undefined ||
            dependencyLifecycle.ownership === "user" ||
            matchesConnectionOperation(dependencyLifecycle)
          );
        }),
      );
    };
    const commands: GraphCommandActionV1[] = [];
    let planningDocument = document;
    const dispositionMismatch = (error: unknown) =>
      error instanceof GraphCommandApplicationError &&
      error.issues.some(
        (issue) =>
          issue.code === "precondition_failed" &&
          issue.path === "$.requiredDisposition",
      );
    const planRelease = (
      resource: GraphResourceReferenceV1,
      dependencies: readonly GeneratedDependencyReferenceV1[],
      requireRemoval: boolean,
    ): boolean => {
      const expectedLifecycle = resourceLifecycle(planningDocument, resource);
      if (expectedLifecycle?.ownership !== "generated") {
        return false;
      }
      const dispositions = requireRemoval
        ? (["removed"] as const)
        : (["removed", "retained"] as const);
      for (const requiredDisposition of dispositions) {
        const command: Extract<
          GraphCommandActionV1,
          { readonly kind: "release-generated-resource" }
        > = {
          ...envelope(
            resource.kind === "edge" ? "edge" : "node",
            commands.length,
          ),
          kind: "release-generated-resource",
          resource,
          expectedLifecycle,
          dependencies: [...dependencies],
          requiredDisposition,
        };
        try {
          const planned = applyGraphCommand(planningDocument, command);
          planningDocument = planned.document;
          commands.push(command);
          return true;
        } catch (error) {
          if (
            requiredDisposition === "removed" &&
            !requireRemoval &&
            dispositionMismatch(error)
          ) {
            continue;
          }
          return false;
        }
      }
      return false;
    };
    for (const resource of plannedResources) {
      const expectedLifecycle = resourceLifecycle(planningDocument, resource);
      if (
        expectedLifecycle?.ownership !== "generated" ||
        !planRelease(
          resource,
          dependenciesFor(resource, expectedLifecycle),
          false,
        )
      ) {
        return lifecycleFailure(
          finding(
            "cloudmarkup.connection.cleanup-preview-rejected",
            "error",
            "$.connectionEdgeId",
            "The generated connection could not be removed safely.",
            "Graph Command v1 rejected a dependency-safe generated-resource release while planning the atomic cleanup batch.",
          ),
        );
      }
    }
    if (
      lifecycle.ownership !== "generated" ||
      !planRelease(
        connectionResource,
        uniqueSortedResourceReferences([
          ...lifecycle.provenance.dependentNodeIds.map((nodeId) => ({
            kind: "node" as const,
            nodeId,
          })),
          ...lifecycle.provenance.dependentEdgeIds.map((edgeId) => ({
            kind: "edge" as const,
            edgeId,
          })),
        ]),
        true,
      )
    ) {
      return lifecycleFailure(
        finding(
          "cloudmarkup.connection.cleanup-preview-rejected",
          "error",
          "$.connectionEdgeId",
          "The generated connection could not be removed safely.",
          "The direct connection edge could not satisfy its required removed disposition; the cleanup batch is withheld.",
        ),
      );
    }
    const remainingOperationResources = operationResources.filter(
      (resource) => resourceLifecycle(planningDocument, resource) !== undefined,
    );
    if (remainingOperationResources.length > 0) {
      const remainingKeys = new Set(
        remainingOperationResources.map(resourceReferenceKey),
      );
      const externallySharedKeys = new Set<string>();
      for (const resource of remainingOperationResources) {
        const remainingLifecycle = resourceLifecycle(
          planningDocument,
          resource,
        );
        if (
          remainingLifecycle !== undefined &&
          remainingLifecycle.ownership !== "user"
        ) {
          const hasExternalProvenance = [
            ...remainingLifecycle.provenance.dependentNodeIds.map((nodeId) => ({
              kind: "node" as const,
              nodeId,
            })),
            ...remainingLifecycle.provenance.dependentEdgeIds.map((edgeId) => ({
              kind: "edge" as const,
              edgeId,
            })),
          ].some(
            (dependency) =>
              !operationResourceKeys.has(resourceReferenceKey(dependency)),
          );
          if (hasExternalProvenance) {
            externallySharedKeys.add(resourceReferenceKey(resource));
          }
        }
      }

      const finalResources = [
        ...planningDocument.edges.map((edge) => ({
          kind: "edge" as const,
          edgeId: edge.id,
        })),
        ...planningDocument.nodes.map((node) => ({
          kind: "node" as const,
          nodeId: node.id,
        })),
      ];
      for (const source of finalResources) {
        if (operationResourceKeys.has(resourceReferenceKey(source))) {
          continue;
        }
        for (const target of resourceReferencesFrom(planningDocument, source)) {
          const targetKey = resourceReferenceKey(target);
          if (remainingKeys.has(targetKey)) {
            externallySharedKeys.add(targetKey);
          }
        }
      }
      for (const output of planningDocument.outputs) {
        if (output.source.kind === "node-attribute") {
          const key = resourceReferenceKey({
            kind: "node",
            nodeId: output.source.nodeId,
          });
          if (remainingKeys.has(key)) {
            externallySharedKeys.add(key);
          }
        }
      }
      for (const workload of planningDocument.workloadBehavior.workloads) {
        const workloadNodeKeys = [
          resourceReferenceKey({
            kind: "node",
            nodeId: workload.owningNodeId,
          }),
          ...workload.environment.flatMap((binding) =>
            binding.value.kind === "node-attribute-reference"
              ? [
                  resourceReferenceKey({
                    kind: "node" as const,
                    nodeId: binding.value.nodeId,
                  }),
                ]
              : [],
          ),
        ];
        for (const key of workloadNodeKeys) {
          if (remainingKeys.has(key)) {
            externallySharedKeys.add(key);
          }
        }
        for (const edgeId of [
          ...workload.triggers.map((binding) => binding.edgeId),
          ...workload.downstreamActions.map((binding) => binding.edgeId),
        ]) {
          const key = resourceReferenceKey({ kind: "edge", edgeId });
          if (remainingKeys.has(key)) {
            externallySharedKeys.add(key);
          }
        }
      }

      const sharedQueue = remainingOperationResources
        .filter((resource) =>
          externallySharedKeys.has(resourceReferenceKey(resource)),
        )
        .sort(compareResourceReferences);
      while (sharedQueue.length > 0) {
        const shared = sharedQueue.shift();
        if (shared === undefined) {
          break;
        }
        for (const target of resourceReferencesFrom(planningDocument, shared)) {
          const targetKey = resourceReferenceKey(target);
          if (
            remainingKeys.has(targetKey) &&
            !externallySharedKeys.has(targetKey)
          ) {
            externallySharedKeys.add(targetKey);
            const targetResource = remainingOperationResources.find(
              (resource) => resourceReferenceKey(resource) === targetKey,
            );
            if (targetResource !== undefined) {
              sharedQueue.push(targetResource);
              sharedQueue.sort(compareResourceReferences);
            }
          }
        }
      }
      const orphaned = remainingOperationResources.find(
        (resource) => !externallySharedKeys.has(resourceReferenceKey(resource)),
      );
      if (orphaned !== undefined) {
        return lifecycleFailure(
          finding(
            "cloudmarkup.connection.cleanup-would-orphan-resource",
            "error",
            "$.connectionEdgeId",
            "This connection has a generated resource that cannot be removed or retained safely.",
            "The complete cleanup preview would leave a same-operation resource without external provenance or a live graph reference; the batch is withheld.",
          ),
        );
      }
    }
    const batchResult = graphCommandBatchV1Schema.safeParse({
      schemaVersion: 1,
      commandId: operationIdSchema.parse(`${operationId}.do.batch`),
      inverseCommandId: operationIdSchema.parse(`${operationId}.undo.batch`),
      origin: "connection-rule",
      target: commandTarget,
      kind: "batch",
      commands,
    });
    if (!batchResult.success) {
      return lifecycleFailure(
        finding(
          "cloudmarkup.connection.cleanup-preview-rejected",
          "error",
          "$.connectionEdgeId",
          "The generated connection could not be removed safely.",
          "The deterministic cleanup closure exceeds or violates the bounded Graph Command v1 batch contract.",
        ),
      );
    }
    const batch = batchResult.data;
    try {
      const preview = applyGraphCommand(document, batch);
      return Object.freeze({
        success: true,
        batch,
        preview: Object.freeze({
          document: preview.document,
          changes: Object.freeze([...preview.changes]),
        }),
        findings: Object.freeze([]),
      });
    } catch {
      return lifecycleFailure(
        finding(
          "cloudmarkup.connection.cleanup-preview-rejected",
          "error",
          "$.connectionEdgeId",
          "The generated connection could not be removed safely.",
          "Graph Command v1 rejected the atomic release batch; no caller-owned document was mutated.",
        ),
      );
    }
  }

  function edit(
    request: ProviderConnectionEditRequestV1,
  ): ProviderConnectionResolutionResultV1 {
    const parsedDocument = parseDocument(request.document);
    if (!("kind" in parsedDocument)) {
      return failure(parsedDocument);
    }
    const document = parsedDocument;
    if (!documentBindingMatches(document, catalog)) {
      return failure(
        finding(
          "cloudmarkup.connection.catalog-mismatch",
          "error",
          "$.document.catalog",
          "Open this architecture with the provider catalog version it was created with.",
          "Connection editing fails closed unless provider, catalog ID, version, and digest match exactly.",
        ),
      );
    }
    const editOperationId = validateOperationId(request.operationId);
    if (editOperationId === undefined) {
      return failure(
        finding(
          "cloudmarkup.connection.invalid-operation-id",
          "error",
          "$.operationId",
          "Use a short, stable edit operation name.",
          "Edit operation IDs must be deployment-safe deterministic seeds.",
        ),
      );
    }
    const connectionEdgeIdResult = edgeIdSchema.safeParse(
      request.connectionEdgeId,
    );
    if (!connectionEdgeIdResult.success) {
      return failure(
        finding(
          "cloudmarkup.connection.invalid-resource-id",
          "error",
          "$.connectionEdgeId",
          "Select a generated connection edge from this architecture.",
          "The requested connection edge ID is invalid.",
        ),
      );
    }
    const directConnection = bindDirectConnectionEdge(
      document,
      connectionEdgeIdResult.data,
    );
    if (directConnection?.lifecycle.ownership !== "generated") {
      return failure(
        finding(
          "cloudmarkup.connection.edit-not-generated",
          "error",
          "$.connectionEdgeId",
          "Only an uncustomized generated connection can be edited automatically.",
          "The requested edge does not have an exact resolver-generated connection identity and provenance record.",
        ),
      );
    }
    const {
      connectionEdge,
      identityOperationId,
      rule: existingRule,
    } = directConnection;
    if (request.ruleId !== existingRule.id) {
      return failure(
        finding(
          "cloudmarkup.connection.edit-rule-mismatch",
          "error",
          "$.ruleId",
          "Keep the existing relationship type while editing this connection.",
          "Atomic edit v1 preserves one connection rule identity; changing relationship type requires an explicit remove-and-connect workflow.",
        ),
      );
    }

    const cleanupResult = cleanup({
      document,
      connectionEdgeId: connectionEdge.id,
      operationId: editOperationId,
    });
    if (!cleanupResult.success) {
      return Object.freeze({
        success: false,
        findings: Object.freeze([...cleanupResult.findings]),
      });
    }
    if (
      cleanupResult.preview.changes.some(
        (change) =>
          change.kind === "generated-resource-released" &&
          change.disposition === "retained",
      )
    ) {
      return failure(
        finding(
          "cloudmarkup.connection.shared-resource-blocks-edit",
          "error",
          "$.connectionEdgeId",
          "This connection shares a generated resource that cannot be replaced automatically.",
          "Atomic edit cannot replace a generated identity retained by another provenance or graph reference.",
        ),
      );
    }

    const currentRecipe = resolve({
      document: cleanupResult.preview.document,
      ruleId: existingRule.id,
      source: {
        nodeId: connectionEdge.semantic.source.nodeId,
        portId: connectionEdge.semantic.source.port,
      },
      target: {
        nodeId: connectionEdge.semantic.target.nodeId,
        portId: connectionEdge.semantic.target.port,
      },
      configuration: connectionEdge.semantic.configuration.values,
      operationId: identityOperationId,
    });
    const releasedResources = cleanupResult.batch.commands
      .flatMap((command) =>
        command.kind === "release-generated-resource" ? [command.resource] : [],
      )
      .sort(compareResourceReferences);
    const provenanceResources = [
      ...document.edges.flatMap((edge) => {
        const resourceLifecycle = edge.semantic.lifecycle;
        return resourceLifecycle.ownership !== "user" &&
          resourceLifecycle.provenance.generatorKind === "connection-rule" &&
          ruleById.get(resourceLifecycle.provenance.generatorId) ===
            existingRule &&
          resourceLifecycle.provenance.operationId === identityOperationId
          ? [{ kind: "edge" as const, edgeId: edge.id }]
          : [];
      }),
      ...document.nodes.flatMap((node) => {
        const resourceLifecycle = node.semantic.lifecycle;
        return resourceLifecycle.ownership !== "user" &&
          resourceLifecycle.provenance.generatorKind === "connection-rule" &&
          ruleById.get(resourceLifecycle.provenance.generatorId) ===
            existingRule &&
          resourceLifecycle.provenance.operationId === identityOperationId
          ? [{ kind: "node" as const, nodeId: node.id }]
          : [];
      }),
    ].sort(compareResourceReferences);
    const expectedResources = currentRecipe.success
      ? [...currentRecipe.generatedResources].sort(compareResourceReferences)
      : [];
    const resourceSetsMatch =
      currentRecipe.success &&
      serializeCanonicalJson(releasedResources) ===
        serializeCanonicalJson(expectedResources) &&
      serializeCanonicalJson(provenanceResources) ===
        serializeCanonicalJson(expectedResources);
    const resourceSemanticsMatch =
      resourceSetsMatch &&
      expectedResources.every((resource) => {
        const actualSemantic = resourceSemantic(document, resource);
        const expectedSemantic = resourceSemantic(
          currentRecipe.preview.document,
          resource,
        );
        return (
          actualSemantic !== undefined &&
          expectedSemantic !== undefined &&
          serializeCanonicalJson(actualSemantic) ===
            serializeCanonicalJson(expectedSemantic)
        );
      });
    if (!currentRecipe.success || !resourceSemanticsMatch) {
      return failure(
        finding(
          "cloudmarkup.connection.customized-resource-blocks-edit",
          "error",
          "$.connectionEdgeId",
          "This connection has generated changes that no longer match its reviewed recipe.",
          "Atomic edit fails closed because the existing generated resource set or semantic content differs from the exact connection-rule preview.",
        ),
      );
    }

    const replacement = resolve({
      document: cleanupResult.preview.document,
      ruleId: request.ruleId,
      source: request.source,
      target: request.target,
      configuration: request.configuration,
      operationId: identityOperationId,
    });
    if (!replacement.success) {
      return replacement;
    }
    if (
      !replacement.generatedResources.some(
        (resource) =>
          resource.kind === "edge" && resource.edgeId === connectionEdge.id,
      )
    ) {
      return failure(
        finding(
          "cloudmarkup.connection.edit-identity-mismatch",
          "error",
          "$.connectionEdgeId",
          "The connection could not keep its stable identity.",
          "The replacement recipe did not reproduce the existing generated connection edge ID.",
        ),
      );
    }

    const batchResult = graphCommandBatchV1Schema.safeParse({
      schemaVersion: 1,
      commandId: operationIdSchema.parse(`${editOperationId}.do.batch`),
      inverseCommandId: operationIdSchema.parse(
        `${editOperationId}.undo.batch`,
      ),
      origin: "connection-rule",
      target: targetOf(document),
      kind: "batch",
      commands: [
        ...cleanupResult.batch.commands,
        ...replacement.batch.commands,
      ],
    });
    if (!batchResult.success) {
      return failure(
        finding(
          "cloudmarkup.connection.invalid-command-batch",
          "error",
          "$.connectionEdgeId",
          "The edited connection could not be previewed safely.",
          "The provider-owned cleanup and replacement recipes did not compose into one valid Graph Command v1 batch.",
        ),
      );
    }
    try {
      const preview = applyGraphCommand(document, batchResult.data);
      const iamComposition = composeProviderConnectionIamRequirementsV1(
        catalog,
        preview.document,
      );
      if (!iamComposition.success) {
        return failures(iamComposition.findings);
      }
      return Object.freeze({
        success: true,
        rule: replacement.rule,
        configuration: replacement.configuration,
        batch: batchResult.data,
        preview: Object.freeze({
          document: preview.document,
          changes: Object.freeze([...preview.changes]),
        }),
        iamEffects: replacement.iamEffects,
        iamRequirements: iamComposition.requirements,
        generatedResources: replacement.generatedResources,
        findings: Object.freeze([
          ...replacement.findings,
          ...iamComposition.findings,
        ]),
      });
    } catch (error) {
      const path =
        error instanceof GraphCommandApplicationError
          ? (error.issues[0]?.path ?? "$.batch")
          : "$.batch";
      return failure(
        finding(
          "cloudmarkup.connection.edit-preview-rejected",
          "error",
          path,
          "The edited connection conflicts with the current architecture.",
          "Graph Command v1 rejected the provider-owned atomic edit batch without mutating the document.",
        ),
      );
    }
  }

  function adopt(
    request: ProviderGeneratedResourceAdoptionRequestV1,
  ): ProviderConnectionLifecyclePreviewResultV1 {
    const parsedDocument = parseDocument(request.document);
    if (!("kind" in parsedDocument)) {
      return lifecycleFailure(parsedDocument);
    }
    const document = parsedDocument;
    if (!documentBindingMatches(document, catalog)) {
      return lifecycleFailure(
        finding(
          "cloudmarkup.connection.catalog-mismatch",
          "error",
          "$.document.catalog",
          "Open this architecture with its exact provider catalog before adopting a generated resource.",
          "Adoption is version-bound to the document's provider catalog digest.",
        ),
      );
    }
    const operationId = validateOperationId(request.operationId);
    const resourceResult = graphResourceReferenceV1Schema.safeParse(
      request.resource,
    );
    const actorResult = actorIdSchema.safeParse(request.adoptedBy);
    const timestampResult = utcTimestampSchema.safeParse(request.adoptedAt);
    if (
      operationId === undefined ||
      !resourceResult.success ||
      !actorResult.success ||
      !timestampResult.success
    ) {
      return lifecycleFailure(
        finding(
          "cloudmarkup.connection.invalid-adoption-request",
          "error",
          "$.resource",
          "Provide a valid generated resource, actor, time, and stable operation name.",
          "The adoption request failed its strict identity or timestamp contract.",
        ),
      );
    }
    const lifecycle = resourceLifecycle(document, resourceResult.data);
    if (
      lifecycle?.ownership !== "generated" ||
      lifecycle.provenance.generatorKind !== "connection-rule" ||
      !ruleById.has(lifecycle.provenance.generatorId)
    ) {
      return lifecycleFailure(
        finding(
          "cloudmarkup.connection.adoption-not-generated",
          "error",
          "$.resource",
          "Only an uncustomized generated connection resource can be adopted.",
          "The selected resource is not owned by a connection-rule generator.",
        ),
      );
    }
    const commandTarget = targetOf(document);
    const batch = graphCommandBatchV1Schema.parse({
      schemaVersion: 1,
      commandId: operationIdSchema.parse(`${operationId}.do.batch`),
      inverseCommandId: operationIdSchema.parse(`${operationId}.undo.batch`),
      origin: "connection-rule",
      target: commandTarget,
      kind: "batch",
      commands: [
        {
          schemaVersion: 1,
          commandId: operationIdSchema.parse(`${operationId}.do.adopt`),
          inverseCommandId: operationIdSchema.parse(
            `${operationId}.undo.adopt`,
          ),
          origin: "connection-rule",
          target: commandTarget,
          kind: "adopt-generated-resource",
          resource: resourceResult.data,
          expectedLifecycle: lifecycle,
          adoptedBy: actorResult.data,
          adoptedAt: timestampResult.data,
        },
      ],
    });
    try {
      const preview = applyGraphCommand(document, batch);
      return Object.freeze({
        success: true,
        batch,
        preview: Object.freeze({
          document: preview.document,
          changes: Object.freeze([...preview.changes]),
        }),
        findings: Object.freeze([]),
      });
    } catch {
      return lifecycleFailure(
        finding(
          "cloudmarkup.connection.adoption-preview-rejected",
          "error",
          "$.resource",
          "The generated resource could not be adopted safely.",
          "Graph Command v1 rejected the adoption batch without mutating the input.",
        ),
      );
    }
  }

  return Object.freeze({ listCompatible, resolve, edit, cleanup, adopt });
}
