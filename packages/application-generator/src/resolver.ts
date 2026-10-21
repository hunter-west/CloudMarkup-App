import {
  getApplicationContractRecordContentHash,
  getApplicationContractsContentHash,
  getArchitectureDocumentCanonicalHash,
  getArchitectureDocumentContentHash,
  getArchitectureDocumentVisualHash,
  getExternalResourceReferenceContentHash,
  getWorkloadBehaviorContentHash,
  validateArchitectureDocumentSemantics,
} from "@cloudmarkup/domain";
import type {
  ApplicationContractRecordV1,
  ArchitectureDocumentV3,
  BehaviorOperationContractV1,
  DataEntityContractV1,
  HttpApiContractV1,
  SolutionRevisionManifestV1,
  WorkloadBehaviorV2,
  WorkloadV2,
} from "@cloudmarkup/schemas";
import {
  HTTP_NO_CONTENT_CAPABILITY,
  HTTP_NO_CONTENT_RELEASE_V1,
} from "./http-no-content-release.js";
import type {
  ResolvedApplicationWorkload,
  ResolvedHttpNoContentWorkload,
} from "./http-no-content-types.js";
import { sourceDescriptor } from "./source-emitter.js";

import {
  APPLICATION_RUNTIME_DIGEST,
  APPLICATION_RUNTIME_ID,
  APPLICATION_RUNTIME_VERSION,
  CURRENT_APPLICATION_CATALOG,
  EVENT_APPLICATION_GENERATOR_DIGEST,
  EVENT_APPLICATION_GENERATOR_ID,
  EVENT_APPLICATION_GENERATOR_VERSION,
  EVENT_APPLICATION_PATTERN_DIGEST,
  EVENT_APPLICATION_PATTERN_ID,
  EVENT_APPLICATION_PATTERN_VERSION,
  EVENT_APPLICATION_TEMPLATE_DIGEST,
  EVENT_APPLICATION_TEMPLATE_ID,
  EVENT_APPLICATION_TEMPLATE_VERSION,
  EVENT_S3_METADATA_PAYLOAD_CONTRACT,
  EVENT_SCHEDULED_PAYLOAD_CONTRACT,
  EVENT_SNS_SQS_RAW_DELIVERY_PREREQUISITE,
  EVENT_TRIGGER_DISPATCHER_ID,
  EVENT_TRIGGER_DISPATCHER_VERSION,
  LAMBDA_HANDLER,
  LAMBDA_RUNTIME,
  NODE_RUNTIME_FAMILY,
  SUPPORTED_EVENT_RELATIONSHIPS,
  SUPPORTED_RELATIONSHIPS,
  TYPESCRIPT_LANGUAGE_FAMILY,
  canonicalJson,
  sha256Digest,
} from "./constants.js";
import type {
  ResolvedAuth,
  ResolvedEntity,
  ResolvedEnvironmentBinding,
  ResolvedField,
  ResolvedOperation,
  ResolvedTest,
  ResolvedWorkload,
  SupportedDataOperation,
  SupportedEventPattern,
} from "./source-emitter.js";

interface ConfigurationValue {
  readonly kind: string;
  readonly value?: unknown;
  readonly nodeId?: string;
  readonly attribute?: string;
  readonly variableId?: string;
  readonly reference?: string;
}

interface NormalizedReference {
  readonly nodeId: string;
  readonly targetKey: string;
  readonly attribute?: string;
  readonly port?: string;
}

interface NormalizedResource {
  readonly id: string;
  readonly targetKey: string;
  readonly deploymentKey: string;
  readonly serviceType: string;
  readonly resourceType: string;
  readonly parent?: NormalizedReference & {
    readonly relationshipType?: string;
  };
  readonly configuration: {
    readonly schemaId: string;
    readonly schemaVersion: string;
    readonly values: Readonly<Record<string, ConfigurationValue>>;
  };
  readonly lifecycle: unknown;
  readonly workloadIds: readonly string[];
}

interface NormalizedConnection {
  readonly id: string;
  readonly source: NormalizedReference;
  readonly target: NormalizedReference;
  readonly relationshipType: string;
  readonly configuration: {
    readonly schemaId: string;
    readonly schemaVersion: string;
    readonly values: Readonly<Record<string, ConfigurationValue>>;
  };
  readonly lifecycle: unknown;
}

interface NormalizedEnvironmentBinding {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly variableId?: string;
  readonly resource?: NormalizedReference;
  readonly secretReference?: string;
}

interface NormalizedSourceOwnership {
  readonly declarationId: string;
  readonly path: string;
  readonly pathKind: string;
  readonly ownership: string;
  readonly ownerId: string;
  readonly regeneration: string;
  readonly conflictBehavior: string;
  readonly semanticDiff: string;
  readonly extensionPointId?: string;
}

interface NormalizedExtensionPoint {
  readonly id: string;
  readonly path: string;
  readonly kind: string;
  readonly permittedOwnership: readonly string[];
  readonly conflictBehavior: string;
}

interface NormalizedWorkload {
  readonly id: string;
  readonly owningResource: NormalizedReference;
  readonly implementationMode: string;
  readonly runtimeFamily?: string;
  readonly languageFamily?: string;
  readonly handler?: string;
  readonly environment: readonly NormalizedEnvironmentBinding[];
  readonly sourceOwnership: readonly NormalizedSourceOwnership[];
  readonly extensionPoints: readonly NormalizedExtensionPoint[];
  readonly specification: unknown;
}

export interface NormalizedSolutionInput {
  readonly contractVersion: number;
  readonly provenance: {
    readonly architectureDocumentId: string;
    readonly architectureId: string;
    readonly architectureRevisionId: string;
    readonly architectureContentHash: string;
    readonly architectureDocumentHash: string;
    readonly architectureVisualHash: string;
    readonly workloadContentHash: string;
    readonly solutionRevisionId?: string;
    readonly catalog: {
      readonly id: string;
      readonly version: string;
      readonly digest: string;
    };
  };
  readonly resources: readonly NormalizedResource[];
  readonly connections: readonly NormalizedConnection[];
  readonly workloads: readonly NormalizedWorkload[];
}

export interface ApplicationGenerationInput {
  readonly architectureDocument: ArchitectureDocumentV3;
  readonly workloadBehavior: WorkloadBehaviorV2;
  readonly solutionRevision: SolutionRevisionManifestV1;
  readonly normalizedSolution: NormalizedSolutionInput;
  readonly generator: {
    readonly id: string;
    readonly version: string;
    readonly digest: string;
  };
  readonly template: {
    readonly id: string;
    readonly version: string;
    readonly digest: string;
  };
  readonly runtime: {
    readonly id: string;
    readonly version: string;
    readonly digest: string;
    readonly runtimeFamily: string;
    readonly languageFamily: string;
    readonly runtime: string;
    readonly handler: string;
    readonly moduleFormat: string;
  };
  readonly pattern: {
    readonly id: string;
    readonly version: string;
    readonly digest: string;
  };
}

export interface GenerationDiagnostic {
  readonly code: string;
  readonly severity: "error" | "warning" | "info";
  readonly message: string;
  readonly source: {
    readonly document:
      | "architecture"
      | "workload"
      | "solution-revision"
      | "normalized-model"
      | "application-source";
    readonly path: string;
    readonly workloadId?: string;
    readonly operationId?: string;
    readonly nodeId?: string;
    readonly edgeId?: string;
    readonly filePath?: string;
  };
}

export interface ResolutionResult {
  readonly workloads: readonly ResolvedApplicationWorkload[];
  readonly diagnostics: readonly GenerationDiagnostic[];
  readonly contracts: readonly ApplicationContractRecordV1[];
}

function compareUtf16(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function sameCanonical(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function valueOf(
  configuration: {
    readonly values: Readonly<Record<string, ConfigurationValue>>;
  },
  key: string,
): unknown {
  return configuration.values[key]?.value;
}

function stringValueOf(
  configuration: NormalizedConnection["configuration"],
  key: string,
): string | undefined {
  const value = valueOf(configuration, key);
  return typeof value === "string" ? value : undefined;
}
function portableSegment(value: string): string {
  const segment = value.replace(/[^A-Za-z0-9_-]/g, "_");
  return segment.length > 0 ? segment : sha256Digest(value).slice(7, 19);
}

function isSupportedDataOperation(
  value: string,
): value is SupportedDataOperation {
  return (
    value === "create" ||
    value === "read" ||
    value === "update" ||
    value === "delete"
  );
}

function methodSupportsOperation(
  method: string,
  operation: SupportedDataOperation,
): boolean {
  switch (operation) {
    case "create":
      return method === "POST";
    case "read":
      return method === "GET";
    case "update":
      return method === "PUT" || method === "PATCH";
    case "delete":
      return method === "DELETE";
  }
}
function referenceIdentity(reference: {
  readonly contractId: string;
  readonly contractVersion: string;
  readonly digest: string;
}): Readonly<Record<string, string>> {
  return {
    contractId: reference.contractId,
    contractVersion: reference.contractVersion,
    digest: reference.digest,
  };
}

function sameReference(
  left: {
    readonly contractId: string;
    readonly contractVersion: string;
    readonly digest: string;
  },
  right: {
    readonly contractId: string;
    readonly contractVersion: string;
    readonly digest: string;
  },
): boolean {
  return sameCanonical(referenceIdentity(left), referenceIdentity(right));
}

function stableKeyFromNodeId(nodeId: string): string {
  let value = nodeId
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!/^[a-z]/.test(value)) {
    value = `r_${value}`;
  }
  return value.slice(0, 63);
}

function assignStableTargetKeys(
  nodes: ArchitectureDocumentV3["nodes"],
): ReadonlyMap<string, string> {
  const groups = new Map<string, ArchitectureDocumentV3["nodes"][number][]>();
  for (const node of nodes) {
    const base =
      node.semantic.deploymentKey.length > 0
        ? node.semantic.deploymentKey
        : stableKeyFromNodeId(node.id);
    const group = groups.get(base) ?? [];
    group.push(node);
    groups.set(base, group);
  }
  const result = new Map<string, string>();
  for (const [base, group] of groups) {
    const sorted = [...group].sort((left, right) =>
      compareUtf16(left.id, right.id),
    );
    if (sorted.length === 1) {
      const only = sorted[0];
      if (only !== undefined) result.set(only.id, base);
      continue;
    }
    const used = new Set<string>();
    sorted.forEach((node, index) => {
      const prefix = base.slice(0, 52);
      let candidate = `${prefix}_${sha256Digest(node.id).slice(7, 17)}`;
      if (used.has(candidate)) {
        candidate = `${prefix.slice(0, 49)}_${String(index).padStart(2, "0")}`;
      }
      used.add(candidate);
      result.set(node.id, candidate);
    });
  }
  return result;
}
function scalarField(
  field: DataEntityContractV1["fields"][number],
): ResolvedField | undefined {
  if (field.fieldType.kind === "entity-reference") return undefined;
  const scalarType =
    field.fieldType.kind === "scalar-list"
      ? (`${field.fieldType.itemType}-list` as ResolvedField["scalarType"])
      : field.fieldType.scalarType;
  return {
    name: field.name,
    required: field.required,
    nullable: field.nullable,
    ...(field.fieldType.kind !== "scalar-list" ||
    field.fieldType.minimumItems === undefined
      ? {}
      : { minimumItems: field.fieldType.minimumItems }),
    ...(field.fieldType.kind !== "scalar-list" ||
    field.fieldType.maximumItems === undefined
      ? {}
      : { maximumItems: field.fieldType.maximumItems }),
    scalarType,
  };
}

function source(
  document: GenerationDiagnostic["source"]["document"],
  path: string,
  identifiers: Partial<
    Omit<GenerationDiagnostic["source"], "document" | "path">
  > = {},
): GenerationDiagnostic["source"] {
  return { document, path, ...identifiers };
}

class ResolutionContext {
  public readonly diagnostics: GenerationDiagnostic[] = [];

  public add(
    code: string,
    severity: GenerationDiagnostic["severity"],
    message: string,
    diagnosticSource: GenerationDiagnostic["source"],
  ): void {
    this.diagnostics.push({
      code,
      severity,
      message,
      source: diagnosticSource,
    });
  }

  public error(
    code: string,
    message: string,
    diagnosticSource: GenerationDiagnostic["source"],
  ): void {
    this.add(code, "error", message, diagnosticSource);
  }

  public warning(
    code: string,
    message: string,
    diagnosticSource: GenerationDiagnostic["source"],
  ): void {
    this.add(code, "warning", message, diagnosticSource);
  }
}

function exactRecord<T extends ApplicationContractRecordV1["contractKind"]>(
  contracts: readonly ApplicationContractRecordV1[],
  reference: {
    readonly contractId: string;
    readonly contractVersion: string;
    readonly digest: string;
  },
  kind: T,
  context: ResolutionContext,
  diagnosticSource: GenerationDiagnostic["source"],
):
  | Extract<ApplicationContractRecordV1, { readonly contractKind: T }>
  | undefined {
  const matches = contracts.filter(
    (contract) =>
      contract.contractId === reference.contractId &&
      contract.contractVersion === reference.contractVersion &&
      contract.contractKind === kind,
  );
  if (matches.length !== 1) {
    context.error(
      "APPLICATION_CONTRACT_UNAVAILABLE",
      "The exact referenced Application Contract record is unavailable or ambiguous.",
      diagnosticSource,
    );
    return undefined;
  }
  const contract = matches[0];
  if (
    contract === undefined ||
    getApplicationContractRecordContentHash(contract) !== reference.digest
  ) {
    context.error(
      "APPLICATION_CONTRACT_DIGEST_MISMATCH",
      "The referenced Application Contract digest does not match its canonical record.",
      diagnosticSource,
    );
    return undefined;
  }
  return contract as Extract<
    ApplicationContractRecordV1,
    { readonly contractKind: T }
  >;
}

function validateDescriptors(
  input: ApplicationGenerationInput,
  context: ResolutionContext,
): void {
  const descriptor = sourceDescriptor(
    input.generator.id,
    input.generator.version,
  );
  const eventGenerator = input.generator.id === EVENT_APPLICATION_GENERATOR_ID;
  const exact = [
    [
      input.generator.id,
      eventGenerator ? EVENT_APPLICATION_GENERATOR_ID : descriptor.generator.id,
    ],
    [
      input.generator.version,
      eventGenerator
        ? EVENT_APPLICATION_GENERATOR_VERSION
        : descriptor.generator.version,
    ],
    [
      input.generator.digest,
      eventGenerator
        ? EVENT_APPLICATION_GENERATOR_DIGEST
        : descriptor.generator.digest,
    ],
    [
      input.template.id,
      eventGenerator ? EVENT_APPLICATION_TEMPLATE_ID : descriptor.template.id,
    ],
    [
      input.template.version,
      eventGenerator
        ? EVENT_APPLICATION_TEMPLATE_VERSION
        : descriptor.template.version,
    ],
    [
      input.template.digest,
      eventGenerator
        ? EVENT_APPLICATION_TEMPLATE_DIGEST
        : descriptor.template.digest,
    ],
    [
      input.pattern.id,
      eventGenerator ? EVENT_APPLICATION_PATTERN_ID : descriptor.pattern.id,
    ],
    [
      input.pattern.version,
      eventGenerator
        ? EVENT_APPLICATION_PATTERN_VERSION
        : descriptor.pattern.version,
    ],
    [
      input.pattern.digest,
      eventGenerator
        ? EVENT_APPLICATION_PATTERN_DIGEST
        : descriptor.pattern.digest,
    ],
    [input.runtime.id, APPLICATION_RUNTIME_ID],
    [input.runtime.version, APPLICATION_RUNTIME_VERSION],
    [input.runtime.digest, APPLICATION_RUNTIME_DIGEST],
    [input.runtime.runtimeFamily, NODE_RUNTIME_FAMILY],
    [input.runtime.languageFamily, TYPESCRIPT_LANGUAGE_FAMILY],
    [input.runtime.runtime, LAMBDA_RUNTIME],
    [input.runtime.handler, LAMBDA_HANDLER],
    [input.runtime.moduleFormat, "esm"],
  ] as const;
  if (exact.some(([actual, expected]) => actual !== expected)) {
    context.error(
      "APPLICATION_DESCRIPTOR_UNSUPPORTED",
      "Generator, template, pattern, runtime, language, handler, and module descriptors must match the exact reviewed matrix.",
      source("solution-revision", "$.versions.applicationGenerator"),
    );
  }

  const catalog = input.architectureDocument.catalog;
  const catalogSupported =
    catalog.id === CURRENT_APPLICATION_CATALOG.id &&
    catalog.version === CURRENT_APPLICATION_CATALOG.version &&
    catalog.digest === CURRENT_APPLICATION_CATALOG.digest;
  if (!catalogSupported) {
    context.error(
      "APPLICATION_CATALOG_UNSUPPORTED",
      "Application generation requires the installed current catalog. Create a new project for an older catalog.",
      source("architecture", "$.catalog"),
    );
  }
  const supportedGenerator = eventGenerator
    ? {
        id: EVENT_APPLICATION_GENERATOR_ID,
        version: EVENT_APPLICATION_GENERATOR_VERSION,
        digest: EVENT_APPLICATION_GENERATOR_DIGEST,
      }
    : {
        id: descriptor.generator.id,
        version: descriptor.generator.version,
        digest: descriptor.generator.digest,
      };
  const generatorBinding = input.solutionRevision.versions.applicationGenerator;
  if (
    generatorBinding.state !== "pinned" ||
    generatorBinding.tool.id !== supportedGenerator.id ||
    generatorBinding.tool.version !== supportedGenerator.version ||
    generatorBinding.tool.digest !== supportedGenerator.digest
  ) {
    context.error(
      "APPLICATION_GENERATOR_PIN_REQUIRED",
      "The immutable Solution Revision must pin the exact generator ID, version, and digest.",
      source("solution-revision", "$.versions.applicationGenerator"),
    );
  }
}

function validateRevision(
  input: ApplicationGenerationInput,
  context: ResolutionContext,
): void {
  const architecture = input.architectureDocument;
  const revision = input.solutionRevision;
  if (!sameCanonical(architecture.workloadBehavior, input.workloadBehavior)) {
    context.error(
      "APPLICATION_WORKLOAD_ENVELOPE_MISMATCH",
      "The supplied Workload Behavior must exactly match the Architecture Document envelope.",
      source("workload", "$"),
    );
  }
  const checks: readonly [string, string, string][] = [
    [
      revision.architecture.contentHash,
      getArchitectureDocumentContentHash(architecture),
      "$.architecture.contentHash",
    ],
    [
      revision.architecture.documentHash,
      getArchitectureDocumentCanonicalHash(architecture),
      "$.architecture.documentHash",
    ],
    [
      revision.architecture.visualHash,
      getArchitectureDocumentVisualHash(architecture),
      "$.architecture.visualHash",
    ],
    [
      revision.workload.contentHash,
      getWorkloadBehaviorContentHash(input.workloadBehavior),
      "$.workload.contentHash",
    ],
    [
      revision.contracts.contentHash,
      getApplicationContractsContentHash(architecture.applicationContracts),
      "$.contracts.contentHash",
    ],
    [
      revision.externalResources.contentHash,
      getExternalResourceReferenceContentHash(architecture.externalResources),
      "$.externalResources.contentHash",
    ],
  ];
  for (const [actual, expected, path] of checks) {
    if (actual !== expected) {
      context.error(
        "APPLICATION_REVISION_HASH_MISMATCH",
        "A canonical input does not match its immutable Solution Revision binding.",
        source("solution-revision", path),
      );
    }
  }
  if (
    revision.architecture.revisionId !== architecture.revision.revisionId ||
    revision.versions.catalog.id !== architecture.catalog.id ||
    revision.versions.catalog.version !== architecture.catalog.version ||
    revision.versions.catalog.digest !== architecture.catalog.digest
  ) {
    context.error(
      "APPLICATION_REVISION_IDENTITY_MISMATCH",
      "Architecture revision or catalog identity differs from the immutable Solution Revision.",
      source("solution-revision", "$.architecture"),
    );
  }
  const expectedRecordHashes = architecture.applicationContracts.contracts
    .map((contract) => getApplicationContractRecordContentHash(contract))
    .sort(compareUtf16);
  if (
    canonicalJson([...revision.contracts.recordHashes].sort(compareUtf16)) !==
    canonicalJson(expectedRecordHashes)
  ) {
    context.error(
      "APPLICATION_CONTRACT_SET_MISMATCH",
      "Application Contract record hashes differ from the frozen Solution Revision.",
      source("solution-revision", "$.contracts.recordHashes"),
    );
  }
  for (const issue of validateArchitectureDocumentSemantics(architecture)) {
    context.error(
      "APPLICATION_CANONICAL_SEMANTICS_INVALID",
      "Canonical Architecture, Workload, or cross-document semantics are invalid.",
      source("architecture", issue.path),
    );
  }
}

function validateNormalized(
  input: ApplicationGenerationInput,
  context: ResolutionContext,
): void {
  const architecture = input.architectureDocument;
  const normalized = input.normalizedSolution;
  const expected = {
    architectureDocumentId: architecture.documentId,
    architectureId: architecture.architectureId,
    architectureRevisionId: architecture.revision.revisionId,
    architectureContentHash: getArchitectureDocumentContentHash(architecture),
    architectureDocumentHash:
      getArchitectureDocumentCanonicalHash(architecture),
    architectureVisualHash: getArchitectureDocumentVisualHash(architecture),
    workloadContentHash: getWorkloadBehaviorContentHash(input.workloadBehavior),
    solutionRevisionId: input.solutionRevision.solutionRevisionId,
    providerId: architecture.provider.id,
    region: architecture.provider.region,
    catalog: architecture.catalog,
  };
  if (
    normalized.contractVersion !== 1 ||
    !sameCanonical(normalized.provenance, expected)
  ) {
    context.error(
      "APPLICATION_NORMALIZED_PROVENANCE_MISMATCH",
      "Compiler normalized-model provenance must bind the exact immutable request.",
      source("normalized-model", "$.provenance"),
    );
  }

  const normalizedResources = new Map(
    normalized.resources.map((resource) => [resource.id, resource]),
  );
  const expectedTargetKeys = assignStableTargetKeys(architecture.nodes);
  const normalizedTargetKeys = new Set(
    normalized.resources.map((resource) => resource.targetKey),
  );
  if (
    normalized.resources.length !== architecture.nodes.length ||
    normalizedResources.size !== normalized.resources.length ||
    normalizedTargetKeys.size !== normalized.resources.length
  ) {
    context.error(
      "APPLICATION_NORMALIZED_RESOURCE_SET_MISMATCH",
      "Normalized resources must be a one-to-one projection of canonical Architecture nodes.",
      source("normalized-model", "$.resources"),
    );
  }
  for (const node of architecture.nodes) {
    const resource = normalizedResources.get(node.id);
    const expectedParent =
      node.semantic.parent === undefined
        ? undefined
        : {
            nodeId: node.semantic.parent.nodeId,
            targetKey: expectedTargetKeys.get(node.semantic.parent.nodeId),
            ...(resource?.parent?.relationshipType === undefined
              ? {}
              : { relationshipType: node.semantic.parent.relationshipType }),
          };
    const expectedWorkloadIds = input.workloadBehavior.workloads
      .filter((workload) => workload.owningNodeId === node.id)
      .map((workload) => String(workload.id))
      .sort(compareUtf16);
    if (
      resource?.targetKey !== expectedTargetKeys.get(node.id) ||
      resource?.deploymentKey !== node.semantic.deploymentKey ||
      resource.resourceType !== node.semantic.resourceType ||
      resource.serviceType !== node.semantic.serviceType ||
      !sameCanonical(resource.parent, expectedParent) ||
      !sameCanonical(resource.configuration, node.semantic.configuration) ||
      !sameCanonical(resource.lifecycle, node.semantic.lifecycle) ||
      !sameCanonical(
        [...resource.workloadIds].sort(compareUtf16),
        expectedWorkloadIds,
      )
    ) {
      context.error(
        "APPLICATION_NORMALIZED_RESOURCE_MISMATCH",
        "A normalized resource must exactly match its canonical node lifecycle, parent, configuration, and workload ownership projection.",
        source("normalized-model", "$.resources", { nodeId: node.id }),
      );
    }
  }
  const normalizedConnections = new Map(
    normalized.connections.map((connection) => [connection.id, connection]),
  );
  if (
    normalized.connections.length !== architecture.edges.length ||
    normalizedConnections.size !== normalized.connections.length
  ) {
    context.error(
      "APPLICATION_NORMALIZED_EDGE_SET_MISMATCH",
      "Normalized connections must be a one-to-one projection of canonical Architecture edges.",
      source("normalized-model", "$.connections"),
    );
  }
  for (const edge of architecture.edges) {
    const connection = normalizedConnections.get(edge.id);
    const expectedSource = {
      nodeId: edge.semantic.source.nodeId,
      targetKey: expectedTargetKeys.get(edge.semantic.source.nodeId),
      port: edge.semantic.source.port,
    };
    const expectedTarget = {
      nodeId: edge.semantic.target.nodeId,
      targetKey: expectedTargetKeys.get(edge.semantic.target.nodeId),
      port: edge.semantic.target.port,
    };
    if (
      !sameCanonical(connection?.source, expectedSource) ||
      !sameCanonical(connection?.target, expectedTarget) ||
      connection?.relationshipType !== edge.semantic.relationshipType ||
      !sameCanonical(connection.configuration, edge.semantic.configuration) ||
      !sameCanonical(connection.lifecycle, edge.semantic.lifecycle)
    ) {
      context.error(
        "APPLICATION_NORMALIZED_EDGE_MISMATCH",
        "A normalized connection must exactly match its canonical endpoints, lifecycle, relationship, and configuration.",
        source("normalized-model", "$.connections", { edgeId: edge.id }),
      );
    }
  }
  const normalizedWorkloads = new Map(
    normalized.workloads.map((workload) => [workload.id, workload]),
  );
  if (
    normalized.workloads.length !== input.workloadBehavior.workloads.length ||
    normalizedWorkloads.size !== normalized.workloads.length
  ) {
    context.error(
      "APPLICATION_NORMALIZED_WORKLOAD_SET_MISMATCH",
      "Normalized workloads must be a one-to-one projection of the canonical Workload Document.",
      source("normalized-model", "$.workloads"),
    );
  }
  for (const canonicalWorkload of input.workloadBehavior.workloads) {
    const normalizedWorkload = normalizedWorkloads.get(canonicalWorkload.id);
    if (!sameCanonical(normalizedWorkload?.specification, canonicalWorkload)) {
      context.error(
        "APPLICATION_NORMALIZED_WORKLOAD_MISMATCH",
        "A normalized workload specification does not match its canonical workload.",
        source("normalized-model", "$.workloads.specification", {
          workloadId: canonicalWorkload.id,
        }),
      );
    }
  }
}

function resolveEntity(
  contract: DataEntityContractV1,
  table: NormalizedResource,
  context: ResolutionContext,
  diagnosticSource: GenerationDiagnostic["source"],
): ResolvedEntity | undefined {
  const primaryIndexes = contract.indexes.filter(
    (index) => index.kind === "primary",
  );
  const primary = primaryIndexes[0];
  const configuredPartitionKey = valueOf(
    table.configuration,
    "partitionKeyName",
  );
  if (
    primaryIndexes.length !== 1 ||
    primary?.partitionFields.length !== 1 ||
    primary.sortFields.length !== 0 ||
    primary.partitionFields[0] !== configuredPartitionKey ||
    valueOf(table.configuration, "partitionKeyType") !== "S"
  ) {
    context.error(
      "APPLICATION_DATA_KEY_UNSUPPORTED",
      "The data entity and DynamoDB table must share one string partition key and no sort key.",
      diagnosticSource,
    );
    return undefined;
  }
  const fields = contract.fields.map(scalarField);
  if (fields.some((field) => field === undefined)) {
    context.error(
      "APPLICATION_ENTITY_FIELD_UNSUPPORTED",
      "The initial notes template supports only canonical scalar and scalar-list fields.",
      diagnosticSource,
    );
    return undefined;
  }
  const partitionField = fields.find(
    (field) => field?.name === configuredPartitionKey,
  );
  if (
    partitionField?.scalarType !== "string" ||
    !partitionField.required ||
    partitionField.nullable
  ) {
    context.error(
      "APPLICATION_DATA_KEY_TYPE_UNSUPPORTED",
      "The DynamoDB partition field must be a required non-null string.",
      diagnosticSource,
    );
    return undefined;
  }
  return {
    contractId: contract.contractId,
    contractVersion: contract.contractVersion,
    digest: getApplicationContractRecordContentHash(contract),
    typeName: `Entity_${portableSegment(contract.contractId)}`,
    partitionKey: String(configuredPartitionKey),
    fields: fields as ResolvedField[],
  };
}

function resolveAuth(
  workload: WorkloadV2,
  operationId: string,
  routeContract: HttpApiContractV1,
  contracts: readonly ApplicationContractRecordV1[],
  context: ResolutionContext,
):
  | {
      readonly auth: ResolvedAuth;
      readonly permittedRoleIds: readonly string[];
    }
  | undefined {
  if (routeContract.authentication === undefined) {
    context.error(
      "APPLICATION_AUTH_REQUIRED",
      "The authenticated notes template requires an exact route auth contract.",
      source("workload", "$.httpRoutes.contract", {
        workloadId: workload.id,
        operationId,
      }),
    );
    return undefined;
  }
  const auth = exactRecord(
    contracts,
    routeContract.authentication,
    "auth",
    context,
    source("workload", "$.httpRoutes.contract.authentication", {
      workloadId: workload.id,
      operationId,
    }),
  );
  const binding = workload.authorization.filter((candidate) =>
    candidate.operationIds.includes(operationId as never),
  );
  const authorization = binding[0];
  if (
    auth === undefined ||
    binding.length !== 1 ||
    authorization?.operationIds.length !== 1 ||
    authorization.deniedBehavior !== "reject" ||
    !sameReference(authorization.authContract, routeContract.authentication)
  ) {
    context.error(
      "APPLICATION_AUTH_BINDING_UNSUPPORTED",
      "Each operation requires one exact matching reject-on-denied authorization binding.",
      source("workload", "$.authorization", {
        workloadId: workload.id,
        operationId,
      }),
    );
    return undefined;
  }
  const claimNames = auth.claims.map((claim) => String(claim.name));
  if (
    auth.authenticationMethod !== "oidc" ||
    new Set(claimNames).size !== claimNames.length ||
    auth.claims.some(
      (claim) =>
        (claim.source !== "identity-token" &&
          claim.source !== "access-token") ||
        claim.valueType !== "string" ||
        !claim.required,
    )
  ) {
    context.error(
      "APPLICATION_AUTH_CLAIMS_UNSUPPORTED",
      "The initial template supports unique required string JWT claims from OIDC identity or access tokens.",
      source("architecture", "$.applicationContracts.contracts", {
        workloadId: workload.id,
        operationId,
      }),
    );
    return undefined;
  }
  const knownClaims = new Set(claimNames);
  const roleIds = auth.roles.map((role) => String(role.roleId));
  const supportedRoles =
    new Set(roleIds).size === roleIds.length &&
    auth.roles.every(
      (role) =>
        role.claimRequirements.length > 0 &&
        role.claimRequirements.every(
          (requirement) =>
            requirement.match === "present" &&
            requirement.expectedValue === undefined &&
            knownClaims.has(requirement.claimName),
        ),
    );
  if (!supportedRoles) {
    context.error(
      "APPLICATION_AUTH_ROLE_RULE_UNSUPPORTED",
      "Authorization roles must use non-empty present-only requirements over declared JWT claims; equals and contains rules are not emitted by v1.",
      source("architecture", "$.applicationContracts.contracts", {
        workloadId: workload.id,
        operationId,
      }),
    );
    return undefined;
  }
  const permittedRoleIds = authorization.permittedRoleIds
    .map(String)
    .sort(compareUtf16);
  if (
    permittedRoleIds.length === 0 ||
    new Set(permittedRoleIds).size !== permittedRoleIds.length ||
    permittedRoleIds.some((roleId) => !roleIds.includes(roleId))
  ) {
    context.error(
      "APPLICATION_AUTH_PERMITTED_ROLES_UNSUPPORTED",
      "Each generated operation must name one or more unique roles declared by the exact auth contract.",
      source("workload", "$.authorization.permittedRoleIds", {
        workloadId: workload.id,
        operationId,
      }),
    );
    return undefined;
  }
  return {
    auth: {
      contractId: auth.contractId,
      contractVersion: auth.contractVersion,
      digest: getApplicationContractRecordContentHash(auth),
      claimNames: claimNames.sort(compareUtf16),
      roles: auth.roles
        .map((role) => ({
          roleId: String(role.roleId),
          claimRequirements: role.claimRequirements
            .map((requirement) => ({
              claimName: String(requirement.claimName),
              match: "present" as const,
            }))
            .sort((left, right) =>
              compareUtf16(left.claimName, right.claimName),
            ),
        }))
        .sort((left, right) => compareUtf16(left.roleId, right.roleId)),
    },
    permittedRoleIds,
  };
}

function matchingBehaviorContract(
  workload: WorkloadV2,
  capability: string,
  contracts: readonly ApplicationContractRecordV1[],
  context: ResolutionContext,
  operationId: string,
): BehaviorOperationContractV1 | undefined {
  const resolved = workload.behaviorContracts.flatMap((reference) => {
    const contract = exactRecord(
      contracts,
      reference,
      "behavior-operation",
      context,
      source("workload", "$.behaviorContracts", {
        workloadId: workload.id,
        operationId,
      }),
    );
    return contract === undefined ? [] : [contract];
  });
  const matches = resolved.filter(
    (contract) => contract.capability === capability,
  );
  if (matches.length !== 1) {
    context.error(
      "APPLICATION_BEHAVIOR_CONTRACT_REQUIRED",
      "Each generated operation requires exactly one matching canonical behavior-operation contract.",
      source("workload", "$.behaviorContracts", {
        workloadId: workload.id,
        operationId,
      }),
    );
    return undefined;
  }
  return matches[0];
}

function behaviorIoMatches(
  workloadIo: WorkloadV2["operations"][number]["inputContract"],
  behaviorIo: BehaviorOperationContractV1["input"],
): boolean {
  if (workloadIo.kind === "none" || behaviorIo.kind === "none") {
    return workloadIo.kind === behaviorIo.kind;
  }
  return (
    behaviorIo.reference.contractKind === "data-entity" &&
    sameReference(workloadIo.reference, behaviorIo.reference)
  );
}

function validateBehaviorSemantics(
  workload: WorkloadV2,
  operation: WorkloadV2["operations"][number],
  behavior: BehaviorOperationContractV1,
  auth: ResolvedAuth,
  permittedRoleIds: readonly string[],
  dataOperation: SupportedDataOperation,
  context: ResolutionContext,
): boolean {
  const expectedFailureCategories = [
    "application.authorization",
    "application.validation",
    ...(dataOperation === "create" ? [] : ["application.not-found"]),
  ].sort(compareUtf16);
  const actualFailureOutcomes = behavior.failureOutcomes
    .map((outcome) => ({
      category: String(outcome.category),
      retryable: outcome.retryable,
    }))
    .sort((left, right) => compareUtf16(left.category, right.category));
  const expectedFailureOutcomes = expectedFailureCategories.map((category) => ({
    category,
    retryable: false,
  }));
  const authorization = behavior.authorization;
  const valid =
    behavior.capability === operation.capability &&
    behaviorIoMatches(operation.inputContract, behavior.input) &&
    behaviorIoMatches(operation.outputContract, behavior.output) &&
    authorization !== undefined &&
    sameReference(authorization.authContract, auth) &&
    sameCanonical(
      authorization.permittedRoleIds.map(String).sort(compareUtf16),
      permittedRoleIds,
    ) &&
    sameCanonical(actualFailureOutcomes, expectedFailureOutcomes);
  if (!valid) {
    context.error(
      "APPLICATION_BEHAVIOR_SEMANTICS_UNSUPPORTED",
      "The behavior-operation contract must exactly match operation IO, authorization roles, and the emitted non-retryable failure outcomes.",
      source("architecture", "$.applicationContracts.contracts", {
        workloadId: workload.id,
        operationId: operation.id,
      }),
    );
  }
  return valid;
}

function validateRouteShape(
  workload: WorkloadV2,
  operationId: string,
  routeContract: HttpApiContractV1,
  entityContract: DataEntityContractV1,
  dataOperation: SupportedDataOperation,
  context: ResolutionContext,
):
  | {
      readonly successStatus: number;
      readonly validationStatus: number;
      readonly authorizationStatus: number;
      readonly notFoundStatus?: number;
    }
  | undefined {
  const entityReference = {
    contractKind: "data-entity" as const,
    contractId: entityContract.contractId,
    contractVersion: entityContract.contractVersion,
    digest: getApplicationContractRecordContentHash(entityContract),
  };
  const needsPath = dataOperation !== "create";
  const needsBody = dataOperation === "create" || dataOperation === "update";
  const parameterProjection = routeContract.request.parameters
    .map((parameter) => ({
      location: parameter.location,
      name: String(parameter.name),
      required: parameter.required,
      sensitive: parameter.sensitive,
      valueType: parameter.valueType,
    }))
    .sort((left, right) =>
      compareUtf16(
        `${left.location}:\0${left.name}`,
        `${right.location}:\0${right.name}`,
      ),
    );
  const expectedParameters = [
    ...(needsPath
      ? [
          {
            location: "path" as const,
            name: String(
              entityContract.indexes.find((index) => index.kind === "primary")
                ?.partitionFields[0],
            ),
            required: true,
            sensitive: false,
            valueType: "string" as const,
          },
        ]
      : []),
    {
      location: "header" as const,
      name: "x-correlation-id",
      required: false,
      sensitive: false,
      valueType: "string" as const,
    },
  ].sort((left, right) =>
    compareUtf16(
      `${left.location}:\0${left.name}`,
      `${right.location}:\0${right.name}`,
    ),
  );
  const bodyValid = needsBody
    ? routeContract.request.body?.required === true &&
      routeContract.request.body.mediaType === "application/json" &&
      sameCanonical(routeContract.request.body.entity, entityReference)
    : routeContract.request.body === undefined;

  const successStatus =
    dataOperation === "create" ? 201 : dataOperation === "delete" ? 204 : 200;
  const responseHeader = {
    name: "x-correlation-id",
    required: true,
    valueType: "string" as const,
  };
  const expectedResponses = [
    {
      statusCode: successStatus,
      ...(dataOperation === "delete"
        ? {}
        : { mediaType: "application/json", entity: entityReference }),
      headers: [responseHeader],
    },
    {
      statusCode: 400,
      mediaType: "application/json",
      headers: [responseHeader],
    },
    {
      statusCode: 403,
      mediaType: "application/json",
      headers: [responseHeader],
    },
    ...(dataOperation === "create"
      ? []
      : [
          {
            statusCode: 404,
            mediaType: "application/json",
            headers: [responseHeader],
          },
        ]),
  ].sort((left, right) => left.statusCode - right.statusCode);
  const actualResponses = routeContract.responses
    .map((response) => ({
      statusCode: response.statusCode,
      ...(response.mediaType === undefined
        ? {}
        : { mediaType: response.mediaType }),
      ...(response.entity === undefined ? {} : { entity: response.entity }),
      headers: response.headers
        .map((header) => ({
          name: header.name.toLowerCase(),
          required: header.required,
          valueType: header.valueType,
        }))
        .sort((left, right) => compareUtf16(left.name, right.name)),
    }))
    .sort((left, right) => left.statusCode - right.statusCode);
  if (
    !sameCanonical(parameterProjection, expectedParameters) ||
    !bodyValid ||
    !sameCanonical(actualResponses, expectedResponses)
  ) {
    context.error(
      "APPLICATION_ROUTE_SHAPE_UNSUPPORTED",
      "The HTTP contract must exactly declare the reviewed body, partition path, correlation header, and 2xx/400/403/404 response shapes.",
      source("architecture", "$.applicationContracts.contracts", {
        workloadId: workload.id,
        operationId,
      }),
    );
    return undefined;
  }
  return {
    successStatus,
    validationStatus: 400,
    authorizationStatus: 403,
    ...(dataOperation === "create" ? {} : { notFoundStatus: 404 }),
  };
}
function resolveOperation(
  workload: WorkloadV2,
  normalizedWorkload: NormalizedWorkload,
  operation: WorkloadV2["operations"][number],
  input: ApplicationGenerationInput,
  context: ResolutionContext,
): { readonly operation?: ResolvedOperation; readonly auth?: ResolvedAuth } {
  const identifiers = { workloadId: workload.id, operationId: operation.id };
  const dataBindings = workload.dataBindings.filter(
    (binding) => binding.operationId === operation.id,
  );
  const routes = workload.httpRoutes.filter(
    (route) => route.operationId === operation.id,
  );
  const triggers = workload.triggers.filter(
    (trigger) => trigger.targetOperationId === operation.id,
  );
  if (
    dataBindings.length !== 1 ||
    routes.length !== 1 ||
    triggers.length !== 1
  ) {
    context.error(
      "APPLICATION_OPERATION_BINDING_INCOMPLETE",
      "A generated notes operation requires exactly one route, trigger, and data binding.",
      source("workload", "$.operations", identifiers),
    );
    return {};
  }
  const dataBinding = dataBindings[0];
  const route = routes[0];
  const trigger = triggers[0];
  if (dataBinding === undefined || route === undefined || trigger === undefined)
    return {};
  if (!isSupportedDataOperation(dataBinding.dataOperation)) {
    context.error(
      "APPLICATION_DATA_OPERATION_UNSUPPORTED",
      "The initial notes template supports only create, read, update, and delete data operations.",
      source("workload", "$.dataBindings.dataOperation", identifiers),
    );
    return {};
  }
  if (!methodSupportsOperation(route.method, dataBinding.dataOperation)) {
    context.error(
      "APPLICATION_ROUTE_OPERATION_MISMATCH",
      "HTTP method and explicit data operation do not form a reviewed notes operation.",
      source("workload", "$.httpRoutes.method", identifiers),
    );
    return {};
  }
  if (
    trigger.edgeId !== route.triggerEdgeId ||
    dataBinding.edgeId === undefined
  ) {
    context.error(
      "APPLICATION_OPERATION_EDGE_MISMATCH",
      "Route/trigger and data bindings must identify exact Architecture edges.",
      source("workload", "$.httpRoutes.triggerEdgeId", identifiers),
    );
    return {};
  }
  const downstream = workload.downstreamActions.filter(
    (binding) =>
      binding.sourceOperationId === operation.id &&
      binding.edgeId === dataBinding.edgeId,
  );
  if (downstream.length !== 1) {
    context.error(
      "APPLICATION_DOWNSTREAM_ACTION_REQUIRED",
      "The data operation requires one matching Workload downstream action.",
      source("workload", "$.downstreamActions", identifiers),
    );
    return {};
  }
  const triggerConnection = input.normalizedSolution.connections.find(
    (connection) => connection.id === route.triggerEdgeId,
  );
  const dataConnection = input.normalizedSolution.connections.find(
    (connection) => connection.id === dataBinding.edgeId,
  );
  const expectedDataRelationship =
    dataBinding.dataOperation === "read"
      ? SUPPORTED_RELATIONSHIPS.lambdaReadsDynamoDb
      : SUPPORTED_RELATIONSHIPS.lambdaWritesDynamoDb;
  if (
    triggerConnection?.relationshipType !==
      SUPPORTED_RELATIONSHIPS.apiInvokesLambda ||
    triggerConnection.target.nodeId !== workload.owningNodeId ||
    valueOf(triggerConnection.configuration, "payloadFormatVersion") !==
      "2.0" ||
    valueOf(triggerConnection.configuration, "routeKey") !==
      `${route.method} ${route.pathTemplate}` ||
    dataConnection?.relationshipType !== expectedDataRelationship ||
    dataConnection.source.nodeId !== workload.owningNodeId
  ) {
    context.error(
      "APPLICATION_TYPED_EDGE_UNSUPPORTED",
      "Operation edges, payload version, and route key must match the exact reviewed API/Lambda/DynamoDB relationships.",
      source("normalized-model", "$.connections", {
        ...identifiers,
        edgeId: route.triggerEdgeId,
      }),
    );
    return {};
  }
  let consistentRead: boolean | undefined;
  if (dataBinding.dataOperation === "read") {
    const configuredConsistentRead = valueOf(
      dataConnection.configuration,
      "consistentRead",
    );
    if (typeof configuredConsistentRead !== "boolean") {
      context.error(
        "APPLICATION_READ_CONFIGURATION_UNSUPPORTED",
        "A DynamoDB read edge must carry the reviewed explicit consistentRead boolean.",
        source(
          "normalized-model",
          "$.connections.configuration.values.consistentRead",
          {
            ...identifiers,
            edgeId: dataConnection.id,
          },
        ),
      );
      return {};
    }
    consistentRead = configuredConsistentRead;
  }
  const routeContract = exactRecord(
    input.architectureDocument.applicationContracts.contracts,
    route.contract,
    "http-api",
    context,
    source("workload", "$.httpRoutes.contract", identifiers),
  );
  const entityContract = exactRecord(
    input.architectureDocument.applicationContracts.contracts,
    dataBinding.entity,
    "data-entity",
    context,
    source("workload", "$.dataBindings.entity", identifiers),
  );
  if (routeContract === undefined || entityContract === undefined) return {};
  if (
    routeContract.method !== route.method ||
    routeContract.pathTemplate !== route.pathTemplate ||
    !entityContract.supportedOperations.includes(dataBinding.dataOperation)
  ) {
    context.error(
      "APPLICATION_CANONICAL_OPERATION_MISMATCH",
      "Route and data contracts must explicitly represent the selected Workload operation.",
      source("architecture", "$.applicationContracts.contracts", identifiers),
    );
    return {};
  }
  const table = input.normalizedSolution.resources.find(
    (resource) =>
      resource.id === dataConnection.target.nodeId &&
      resource.resourceType === "aws.dynamodb.table",
  );
  if (table === undefined) {
    context.error(
      "APPLICATION_DATA_RESOURCE_UNSUPPORTED",
      "The data edge must target one normalized DynamoDB table.",
      source("normalized-model", "$.resources", {
        ...identifiers,
        edgeId: dataConnection.id,
      }),
    );
    return {};
  }
  const entity = resolveEntity(
    entityContract,
    table,
    context,
    source("architecture", "$.applicationContracts.contracts", identifiers),
  );
  if (entity === undefined) return {};
  const tableEnvironment = normalizedWorkload.environment.filter(
    (binding) =>
      binding.resource?.nodeId === table.id &&
      [
        "name",
        "id",
        "aws.dynamodb.table.name",
        "aws.dynamodb.table.id",
      ].includes(binding.resource.attribute ?? ""),
  );
  if (tableEnvironment.length !== 1) {
    context.error(
      "APPLICATION_TABLE_BINDING_REQUIRED",
      "Each DynamoDB operation requires one unambiguous table-name environment binding.",
      source("normalized-model", "$.workloads.environment", identifiers),
    );
    return {};
  }
  const behavior = matchingBehaviorContract(
    workload,
    operation.capability,
    input.architectureDocument.applicationContracts.contracts,
    context,
    operation.id,
  );
  if (behavior === undefined) return {};
  const resolvedAuthorization = resolveAuth(
    workload,
    operation.id,
    routeContract,
    input.architectureDocument.applicationContracts.contracts,
    context,
  );
  if (resolvedAuthorization === undefined) return {};
  if (
    !validateBehaviorSemantics(
      workload,
      operation,
      behavior,
      resolvedAuthorization.auth,
      resolvedAuthorization.permittedRoleIds,
      dataBinding.dataOperation,
      context,
    )
  ) {
    return {};
  }
  const routeShape = validateRouteShape(
    workload,
    operation.id,
    routeContract,
    entityContract,
    dataBinding.dataOperation,
    context,
  );
  if (routeShape === undefined) return {};
  return {
    auth: resolvedAuthorization.auth,
    operation: {
      id: operation.id,
      pathKey: portableSegment(operation.id),
      capability: operation.capability,
      dataOperation: dataBinding.dataOperation,
      method: route.method as ResolvedOperation["method"],
      pathTemplate: route.pathTemplate,
      routeKey: `${route.method} ${route.pathTemplate}`,
      routeContractId: routeContract.contractId,
      routeContractVersion: routeContract.contractVersion,
      routeContractDigest:
        getApplicationContractRecordContentHash(routeContract),
      behaviorContractId: behavior.contractId,
      behaviorContractVersion: behavior.contractVersion,
      behaviorContractDigest: getApplicationContractRecordContentHash(behavior),
      permittedRoleIds: resolvedAuthorization.permittedRoleIds,
      triggerEdgeId: route.triggerEdgeId,
      dataEdgeId: dataBinding.edgeId,
      ...(consistentRead === undefined ? {} : { consistentRead }),
      tableEnvironmentName: tableEnvironment[0]?.name ?? "",
      entity,
      successStatus: routeShape.successStatus,
      validationStatus: routeShape.validationStatus,
      authorizationStatus: routeShape.authorizationStatus,
      ...(routeShape.notFoundStatus === undefined
        ? {}
        : { notFoundStatus: routeShape.notFoundStatus }),
    },
  };
}

function resolveEnvironment(
  workload: WorkloadV2,
  normalized: NormalizedWorkload,
  context: ResolutionContext,
): readonly ResolvedEnvironmentBinding[] {
  const results: ResolvedEnvironmentBinding[] = [];
  const names = new Set<string>();
  const reportMismatch = (): void => {
    context.error(
      "APPLICATION_ENVIRONMENT_BINDING_MISMATCH",
      "Environment bindings must map one-to-one by stable ID, name, kind, and reference.",
      source("normalized-model", "$.workloads.environment", {
        workloadId: workload.id,
      }),
    );
  };
  if (normalized.environment.length !== workload.environment.length)
    reportMismatch();
  for (const canonical of workload.environment) {
    const matches = normalized.environment.filter(
      (binding) =>
        binding.id === canonical.id && binding.name === canonical.name,
    );
    const match = matches[0];
    if (
      matches.length !== 1 ||
      match === undefined ||
      names.has(canonical.name)
    ) {
      reportMismatch();
      continue;
    }
    let exactValue = match.kind === canonical.value.kind;
    if (canonical.value.kind === "secret-reference") {
      exactValue =
        exactValue &&
        match.secretReference === canonical.value.reference &&
        match.variableId === undefined &&
        match.resource === undefined;
    } else if (canonical.value.kind === "variable-reference") {
      exactValue =
        exactValue &&
        match.variableId === canonical.value.variableId &&
        match.secretReference === undefined &&
        match.resource === undefined;
    } else {
      exactValue =
        exactValue &&
        match.resource?.nodeId === canonical.value.nodeId &&
        match.resource.attribute === canonical.value.attribute &&
        match.variableId === undefined &&
        match.secretReference === undefined;
    }
    if (!exactValue) {
      reportMismatch();
      continue;
    }
    names.add(canonical.name);
    if (canonical.value.kind === "secret-reference") {
      results.push({
        bindingId: canonical.id,
        name: canonical.name,
        kind: "secret",
      });
    } else if (canonical.value.kind === "variable-reference") {
      results.push({
        bindingId: canonical.id,
        name: canonical.name,
        kind: "variable",
        variableId: canonical.value.variableId,
      });
    } else {
      results.push({
        bindingId: canonical.id,
        name: canonical.name,
        kind: "resource",
        nodeId: canonical.value.nodeId,
        attribute: canonical.value.attribute,
        ...(match.resource?.targetKey === undefined
          ? {}
          : { targetKey: match.resource.targetKey }),
      });
    }
  }
  return results.sort((left, right) =>
    compareUtf16(left.bindingId, right.bindingId),
  );
}

interface ResolvedExtensionBoundary {
  readonly extensionPointIds: readonly string[];
  readonly path?: string;
}

function resolveExtensionBoundary(
  workload: WorkloadV2,
  normalized: NormalizedWorkload,
  deploymentKey: string,
  context: ResolutionContext,
): ResolvedExtensionBoundary | undefined {
  const expectedNormalizedPoints = workload.extensionPoints
    .map((point) => ({
      id: point.extensionPointId,
      path: point.path,
      kind: point.kind,
      permittedOwnership: point.permittedOwnership,
      conflictBehavior: point.conflictBehavior,
    }))
    .sort((left, right) => compareUtf16(left.id, right.id));
  const actualNormalizedPoints = [...normalized.extensionPoints].sort(
    (left, right) => compareUtf16(left.id, right.id),
  );
  const expectedNormalizedOwnership = workload.sourceOwnership
    .map((ownership) => ({
      declarationId: ownership.declarationId,
      path: ownership.path,
      pathKind: ownership.pathKind,
      ownership: ownership.ownership,
      ownerId: ownership.ownerId,
      regeneration: ownership.regeneration,
      conflictBehavior: ownership.conflictBehavior,
      semanticDiff: ownership.semanticDiff.strategy,
      ...(ownership.semanticDiff.normalizerId === undefined
        ? {}
        : {
            normalizerId: ownership.semanticDiff.normalizerId,
            normalizerVersion: ownership.semanticDiff.normalizerVersion,
          }),
      ...(ownership.baselineDigest === undefined
        ? {}
        : { baselineDigest: ownership.baselineDigest }),
      ...(ownership.extensionPointId === undefined
        ? {}
        : { extensionPointId: ownership.extensionPointId }),
    }))
    .sort((left, right) =>
      compareUtf16(left.declarationId, right.declarationId),
    );
  const actualNormalizedOwnership = [...normalized.sourceOwnership].sort(
    (left, right) => compareUtf16(left.declarationId, right.declarationId),
  );
  if (
    !sameCanonical(actualNormalizedPoints, expectedNormalizedPoints) ||
    !sameCanonical(actualNormalizedOwnership, expectedNormalizedOwnership)
  ) {
    context.error(
      "APPLICATION_EXTENSION_NORMALIZATION_MISMATCH",
      "Normalized extension and source-ownership projections must match the canonical Workload Document exactly.",
      source("normalized-model", "$.workloads.extensionPoints", {
        workloadId: workload.id,
      }),
    );
    return undefined;
  }

  const requiresBoundary =
    workload.implementation.mode === "generated-starter" ||
    workload.implementation.mode === "ai-assisted-custom";
  if (workload.extensionPoints.length === 0) {
    if (requiresBoundary) {
      context.error(
        "APPLICATION_EXTENSION_BOUNDARY_REQUIRED",
        "Starter and AI-assisted scaffolding require one explicit user-owned extension boundary.",
        source("workload", "$.extensionPoints", { workloadId: workload.id }),
      );
      return undefined;
    }
    return { extensionPointIds: [] };
  }
  const point = workload.extensionPoints[0];
  const expectedPath = `application/src/functions/${deploymentKey}/extensions/custom.ts`;
  const ownership = workload.sourceOwnership.filter(
    (declaration) => declaration.path === expectedPath,
  );
  if (
    workload.extensionPoints.length !== 1 ||
    point?.path !== expectedPath ||
    point.kind !== "module" ||
    !point.permittedOwnership.includes("user-owned") ||
    !sameCanonical(point.conflictBehavior, "require-reviewed-resolution") ||
    ownership.length !== 1 ||
    ownership[0]?.pathKind !== "file" ||
    ownership[0].ownership !== "user-owned" ||
    ownership[0].regeneration !== "never" ||
    ownership[0].conflictBehavior !== "preserve-user-content" ||
    ownership[0].semanticDiff.strategy !== "structured-language"
  ) {
    context.error(
      "APPLICATION_EXTENSION_BOUNDARY_UNSUPPORTED",
      "The initial template requires one exact stable user-owned module path with never-regenerate ownership.",
      source("workload", "$.extensionPoints", { workloadId: workload.id }),
    );
    return undefined;
  }
  return {
    extensionPointIds: [point.extensionPointId],
    path: point.path,
  };
}

function validateReviewedWorkloadShape(
  workload: WorkloadV2,
  input: ApplicationGenerationInput,
  context: ResolutionContext,
): boolean {
  const operationIds = workload.operations
    .map((operation) => String(operation.id))
    .sort(compareUtf16);
  const entrypointOperationIds = workload.entrypoints
    .map((entrypoint) => String(entrypoint.operationId))
    .sort(compareUtf16);
  const entrypointsValid =
    workload.entrypoints.length === workload.operations.length &&
    sameCanonical(entrypointOperationIds, operationIds) &&
    workload.entrypoints.every(
      (entrypoint) =>
        entrypoint.kind === "request-handler" &&
        entrypoint.handler === LAMBDA_HANDLER,
    );

  const idempotencyOperationIds = workload.idempotency
    .flatMap((policy) => policy.operationIds.map(String))
    .sort(compareUtf16);
  const idempotencyValid =
    workload.idempotency.length === workload.operations.length &&
    sameCanonical(idempotencyOperationIds, operationIds) &&
    workload.idempotency.every(
      (policy) =>
        policy.mode === "not-required" && policy.operationIds.length === 1,
    );

  const logConnections = input.normalizedSolution.connections.filter(
    (connection) =>
      connection.source.nodeId === workload.owningNodeId &&
      connection.relationshipType === SUPPORTED_RELATIONSHIPS.lambdaWritesLogs,
  );
  const logTarget = logConnections[0]?.target.nodeId;
  const observabilityValid =
    sameCanonical([...workload.observability.signals].sort(compareUtf16), [
      "logs",
    ]) &&
    workload.observability.healthChecks.length === 0 &&
    workload.observability.smokeTests.length === 0 &&
    logConnections.length === 1 &&
    input.normalizedSolution.resources.find(
      (resource) => resource.id === logTarget,
    )?.resourceType === "aws.cloudwatch.log-group";

  const valid =
    workload.errorBehavior.mode === "fail-invocation" &&
    workload.executionAssumptions.timeout.kind === "duration" &&
    workload.executionAssumptions.retry.kind === "none" &&
    workload.triggerDispatch.mode === "single" &&
    workload.extensions.length === 0 &&
    entrypointsValid &&
    idempotencyValid &&
    observabilityValid;
  if (!valid) {
    context.error(
      "APPLICATION_WORKLOAD_SHAPE_UNSUPPORTED",
      "The reviewed notes pattern requires exact request-handler entrypoints, fail-invocation errors, no retries, per-operation non-idempotent policies, log-only observability, and one typed log edge.",
      source("workload", "$", { workloadId: workload.id }),
    );
  }
  return valid;
}
function validateCompleteTests(
  workload: WorkloadV2,
  contracts: readonly ApplicationContractRecordV1[],
  operations: readonly ResolvedOperation[],
  context: ResolutionContext,
): readonly ResolvedTest[] | undefined {
  const resolvedTests: ResolvedTest[] = [];
  const coverageKeys: string[] = [];
  let valid =
    workload.tests.length === operations.length * 2 &&
    workload.tests.every(
      (binding) =>
        binding.requiredForCoverage &&
        (binding.level === "unit" || binding.level === "contract"),
    );

  for (const binding of workload.tests) {
    const testCase = exactRecord(
      contracts,
      binding.testCase,
      "test-case",
      context,
      source("workload", "$.tests", { workloadId: workload.id }),
    );
    const operation = operations.find(
      (candidate) =>
        testCase?.target.contractKind === "behavior-operation" &&
        testCase.target.contractId === candidate.behaviorContractId &&
        testCase.target.contractVersion === candidate.behaviorContractVersion &&
        testCase.target.digest === candidate.behaviorContractDigest,
    );
    if (
      testCase === undefined ||
      operation === undefined ||
      testCase.level !== binding.level ||
      (binding.level !== "unit" && binding.level !== "contract") ||
      testCase.fixtureReferences.length > 0 ||
      testCase.preconditions.some(
        (precondition) => precondition.kind === "fixture-available",
      )
    ) {
      valid = false;
      continue;
    }

    const entityReference = {
      contractKind: "data-entity" as const,
      contractId: operation.entity.contractId,
      contractVersion: operation.entity.contractVersion,
      digest: operation.entity.digest,
    };
    const routeReference = {
      contractKind: "http-api" as const,
      contractId: operation.routeContractId,
      contractVersion: operation.routeContractVersion,
      digest: operation.routeContractDigest,
    };
    const authReference = workload.authorization.find((authorization) =>
      authorization.operationIds.includes(operation.id as never),
    )?.authContract;
    const expectedPreconditions =
      binding.level === "unit"
        ? [{ kind: "contract-available", contract: entityReference }]
        : [
            { kind: "contract-available", contract: routeReference },
            {
              kind: "authenticated-role",
              authContract: authReference,
              roleId: operation.permittedRoleIds[0],
            },
          ];
    const actualPreconditions = [...testCase.preconditions].sort(
      (left, right) => compareUtf16(canonicalJson(left), canonicalJson(right)),
    );
    const sortedExpectedPreconditions = expectedPreconditions.sort(
      (left, right) => compareUtf16(canonicalJson(left), canonicalJson(right)),
    );
    const actualExpectationSemantics = testCase.expectations
      .map(({ expectationId, ...expectation }) => {
        void expectationId;
        return expectation;
      })
      .sort((left, right) =>
        compareUtf16(canonicalJson(left), canonicalJson(right)),
      );
    const expectedExpectationSemantics =
      binding.level === "unit"
        ? [{ kind: "error-category", category: "application.validation" }]
        : [
            { kind: "error-category", category: "application.validation" },
            { kind: "http-status", statusCode: operation.validationStatus },
          ];
    expectedExpectationSemantics.sort((left, right) =>
      compareUtf16(canonicalJson(left), canonicalJson(right)),
    );

    if (
      authReference === undefined ||
      operation.permittedRoleIds.length !== 1 ||
      !sameCanonical(actualPreconditions, sortedExpectedPreconditions) ||
      !sameCanonical(actualExpectationSemantics, expectedExpectationSemantics)
    ) {
      valid = false;
      continue;
    }

    coverageKeys.push(`${operation.id}:\0${binding.level}`);
    resolvedTests.push({
      bindingId: String(binding.bindingId),
      level: binding.level,
      testCaseContractId: testCase.contractId,
      testCaseContractVersion: testCase.contractVersion,
      testCaseContractDigest: getApplicationContractRecordContentHash(testCase),
      targetBehaviorContractId: operation.behaviorContractId,
      targetBehaviorContractVersion: operation.behaviorContractVersion,
      targetBehaviorContractDigest: operation.behaviorContractDigest,
      operationId: operation.id,
      preconditions: actualPreconditions,
      expectations: [...testCase.expectations].sort((left, right) =>
        compareUtf16(left.expectationId, right.expectationId),
      ),
    });
  }

  const expectedCoverageKeys = operations
    .flatMap((operation) => [
      `${operation.id}:\0contract`,
      `${operation.id}:\0unit`,
    ])
    .sort(compareUtf16);
  if (
    !sameCanonical(coverageKeys.sort(compareUtf16), expectedCoverageKeys) ||
    resolvedTests.length !== workload.tests.length
  ) {
    valid = false;
  }
  if (!valid) {
    context.error(
      "APPLICATION_COMPLETE_TESTS_INCOMPLETE",
      "Complete-pattern generation requires one exact fixture-free unit test and contract test per behavior, with canonical targets, preconditions, and emitted expectations.",
      source("workload", "$.tests", { workloadId: workload.id }),
    );
    return undefined;
  }
  return resolvedTests.sort((left, right) =>
    compareUtf16(left.bindingId, right.bindingId),
  );
}

function compatibilityMatches(
  workload: WorkloadV2,
  input: ApplicationGenerationInput,
): number {
  const descriptor = sourceDescriptor(
    input.generator.id,
    input.generator.version,
  );
  const eventGenerator = input.generator.id === EVENT_APPLICATION_GENERATOR_ID;
  return workload.compatibility.applicationGenerators.filter(
    (compatibility) =>
      compatibility.generatorId ===
        (eventGenerator
          ? EVENT_APPLICATION_GENERATOR_ID
          : descriptor.generator.id) &&
      compatibility.minimumVersion ===
        (eventGenerator
          ? EVENT_APPLICATION_GENERATOR_VERSION
          : descriptor.generator.version) &&
      compatibility.maximumVersionExclusive === undefined &&
      compatibility.templateId ===
        (eventGenerator
          ? EVENT_APPLICATION_TEMPLATE_ID
          : descriptor.template.id) &&
      compatibility.templateVersion ===
        (eventGenerator
          ? EVENT_APPLICATION_TEMPLATE_VERSION
          : descriptor.template.version) &&
      compatibility.supportedModes.includes(
        workload.implementation.mode as
          "generated-starter" | "complete-supported-pattern",
      ),
  ).length;
}

function eventPatternFor(
  relationshipType: string,
  scheduled: boolean,
): SupportedEventPattern | undefined {
  if (relationshipType === SUPPORTED_EVENT_RELATIONSHIPS.s3NotifiesLambda)
    return "s3-image-metadata";
  if (relationshipType === SUPPORTED_EVENT_RELATIONSHIPS.sqsTriggersLambda)
    return "sqs-consumer-dlq";
  if (relationshipType === SUPPORTED_EVENT_RELATIONSHIPS.snsInvokesLambda)
    return "sns-fanout-consumer";
  if (
    relationshipType === SUPPORTED_EVENT_RELATIONSHIPS.eventBridgeInvokesLambda
  ) {
    return scheduled ? "eventbridge-scheduled" : "eventbridge-target";
  }
  if (
    relationshipType ===
    SUPPORTED_EVENT_RELATIONSHIPS.stepFunctionsInvokesLambda
  ) {
    return "step-functions-task";
  }
  return undefined;
}

function eventCapability(pattern: SupportedEventPattern): string {
  switch (pattern) {
    case "s3-image-metadata":
      return "cloudmarkup.event.s3-record-metadata";
    case "sqs-consumer-dlq":
      return "cloudmarkup.event.sqs-consume";
    case "sns-fanout-consumer":
      return "cloudmarkup.event.sns-consume";
    case "eventbridge-scheduled":
      return "cloudmarkup.event.schedule-run";
    case "eventbridge-target":
      return "cloudmarkup.event.eventbridge-consume";
    case "step-functions-task":
      return "cloudmarkup.event.step-functions-task";
  }
}

function eventConfigurationValid(
  pattern: SupportedEventPattern,
  configuration: NormalizedConnection["configuration"],
): boolean {
  const keys = Object.keys(configuration.values).sort(compareUtf16);
  switch (pattern) {
    case "s3-image-metadata":
      return (
        sameCanonical(keys, [
          "deliverySemantics",
          "eventType",
          "filterPrefix",
          "filterSuffix",
        ]) &&
        valueOf(configuration, "eventType") === "OBJECT_CREATED" &&
        valueOf(configuration, "deliverySemantics") ===
          "AT_LEAST_ONCE_UNORDERED" &&
        typeof valueOf(configuration, "filterPrefix") === "string" &&
        typeof valueOf(configuration, "filterSuffix") === "string"
      );
    case "sqs-consumer-dlq":
      return (
        sameCanonical(keys, [
          "batchSize",
          "batchingWindowSeconds",
          "deliverySemantics",
          "maximumConcurrency",
          "partialBatchResponse",
        ]) &&
        [1, 5, 10].includes(Number(valueOf(configuration, "batchSize"))) &&
        [0, 1, 5, 10].includes(
          Number(valueOf(configuration, "batchingWindowSeconds")),
        ) &&
        [2, 5, 10, 50].includes(
          Number(valueOf(configuration, "maximumConcurrency")),
        ) &&
        valueOf(configuration, "partialBatchResponse") === true &&
        valueOf(configuration, "deliverySemantics") === "AT_LEAST_ONCE"
      );
    case "sns-fanout-consumer":
    case "eventbridge-scheduled":
    case "eventbridge-target":
      return (
        sameCanonical(keys, ["deliverySemantics"]) &&
        valueOf(configuration, "deliverySemantics") === "AT_LEAST_ONCE"
      );
    case "step-functions-task":
      return (
        sameCanonical(keys, [
          "maximumAttempts",
          "retryMode",
          "taskTimeoutSeconds",
        ]) &&
        [1, 2, 3, 5].includes(
          Number(valueOf(configuration, "maximumAttempts")),
        ) &&
        [30, 60, 120, 300, 900].includes(
          Number(valueOf(configuration, "taskTimeoutSeconds")),
        ) &&
        ((valueOf(configuration, "retryMode") === "NONE" &&
          valueOf(configuration, "maximumAttempts") === 1) ||
          (valueOf(configuration, "retryMode") === "BOUNDED_EXPONENTIAL" &&
            Number(valueOf(configuration, "maximumAttempts")) > 1))
      );
  }
}

function eventPayloadEntity(
  contract: DataEntityContractV1,
  context: ResolutionContext,
  diagnosticSource: GenerationDiagnostic["source"],
): ResolvedEntity | undefined {
  const fields = contract.fields.map(scalarField);
  const primary = contract.indexes.filter((index) => index.kind === "primary");
  const primaryIndex = primary.at(0);
  const partitionKey = primaryIndex?.partitionFields.at(0);
  if (
    fields.some((field) => field === undefined) ||
    primary.length !== 1 ||
    primaryIndex === undefined ||
    partitionKey === undefined ||
    primaryIndex.partitionFields.length !== 1 ||
    primaryIndex.sortFields.length !== 0
  ) {
    context.error(
      "APPLICATION_EVENT_PAYLOAD_UNSUPPORTED",
      "Curated event payloads require scalar fields and one stable single-field primary identity.",
      diagnosticSource,
    );
    return undefined;
  }
  return {
    contractId: contract.contractId,
    contractVersion: contract.contractVersion,
    digest: getApplicationContractRecordContentHash(contract),
    typeName: `EventPayload_${portableSegment(contract.contractId)}`,
    partitionKey,
    fields: fields as ResolvedField[],
  };
}

interface ExactCuratedEventPayload {
  readonly fields: readonly {
    readonly classification: DataEntityContractV1["fields"][number]["classification"];
    readonly name: string;
    readonly required: boolean;
    readonly scalarType: string;
  }[];
  readonly partitionKey: string;
  readonly storageIntent: DataEntityContractV1["storageIntent"];
  readonly supportedOperations: readonly DataEntityContractV1["supportedOperations"][number][];
}

function exactCuratedEventPayload(
  contract: DataEntityContractV1,
  expected: ExactCuratedEventPayload,
): boolean {
  const fields = contract.fields
    .map((field) => ({
      classification: field.classification,
      name: field.name,
      nullable: field.nullable,
      required: field.required,
      scalarType:
        field.fieldType.kind === "scalar"
          ? field.fieldType.scalarType
          : "unsupported",
    }))
    .sort((left, right) => compareUtf16(left.name, right.name));
  const expectedFields = expected.fields
    .map((field) => ({ ...field, nullable: false }))
    .sort((left, right) => compareUtf16(left.name, right.name));
  const primary = contract.indexes[0];
  return (
    sameCanonical(fields, expectedFields) &&
    contract.storageIntent === expected.storageIntent &&
    sameCanonical(
      [...contract.supportedOperations].sort(compareUtf16),
      [...expected.supportedOperations].sort(compareUtf16),
    ) &&
    contract.indexes.length === 1 &&
    primary?.kind === "primary" &&
    sameCanonical(primary.partitionFields, [expected.partitionKey]) &&
    primary.sortFields.length === 0
  );
}

function scheduleExpression(
  schedule: WorkloadV2["schedules"][number]["schedule"],
): string {
  switch (schedule.kind) {
    case "interval":
      return `rate(${String(schedule.seconds)} seconds)`;
    case "daily":
      return `cron(${schedule.utcTime} daily UTC)`;
    case "weekly":
      return `cron(${[...schedule.days].sort(compareUtf16).join(",")} ${schedule.utcTime} UTC)`;
  }
}

function resolveEventTests(
  workload: WorkloadV2,
  contracts: readonly ApplicationContractRecordV1[],
  operation: ResolvedOperation,
  context: ResolutionContext,
): readonly ResolvedTest[] | undefined {
  const event = operation.event;
  if (event === undefined) return undefined;
  const resolved: ResolvedTest[] = [];
  const keys: string[] = [];
  let valid =
    workload.tests.length === 2 &&
    workload.tests.every(
      (binding) =>
        binding.requiredForCoverage &&
        (binding.level === "unit" || binding.level === "contract"),
    );
  for (const binding of workload.tests) {
    const testCase = exactRecord(
      contracts,
      binding.testCase,
      "test-case",
      context,
      source("workload", "$.tests", {
        workloadId: workload.id,
        operationId: operation.id,
      }),
    );
    const expectedContract =
      binding.level === "unit"
        ? {
            contractKind: "data-entity" as const,
            contractId: operation.entity.contractId,
            contractVersion: operation.entity.contractVersion,
            digest: operation.entity.digest,
          }
        : {
            contractKind: "event-message" as const,
            contractId: event.eventContractId,
            contractVersion: event.eventContractVersion,
            digest: event.eventContractDigest,
          };
    const expectations =
      testCase?.expectations.map(({ expectationId, ...expectation }) => {
        void expectationId;
        return expectation;
      }) ?? [];
    const expectedExpectations =
      binding.level === "unit"
        ? [
            {
              kind: "contract-conformance",
              contract: expectedContract,
            },
          ]
        : [{ kind: "error-category", category: "application.validation" }];
    if (
      testCase?.level !== binding.level ||
      testCase.target.contractKind !== "behavior-operation" ||
      !sameReference(testCase.target, {
        contractId: operation.behaviorContractId,
        contractVersion: operation.behaviorContractVersion,
        digest: operation.behaviorContractDigest,
      }) ||
      testCase.fixtureReferences.length !== 0 ||
      !sameCanonical(testCase.preconditions, [
        { kind: "contract-available", contract: expectedContract },
      ]) ||
      !sameCanonical(expectations, expectedExpectations)
    ) {
      valid = false;
      continue;
    }
    keys.push(binding.level);
    resolved.push({
      bindingId: String(binding.bindingId),
      level: binding.level as "unit" | "contract",
      testCaseContractId: testCase.contractId,
      testCaseContractVersion: testCase.contractVersion,
      testCaseContractDigest: getApplicationContractRecordContentHash(testCase),
      targetBehaviorContractId: operation.behaviorContractId,
      targetBehaviorContractVersion: operation.behaviorContractVersion,
      targetBehaviorContractDigest: operation.behaviorContractDigest,
      operationId: operation.id,
      preconditions: testCase.preconditions,
      expectations: testCase.expectations,
    });
  }
  if (!valid || !sameCanonical(keys.sort(compareUtf16), ["contract", "unit"])) {
    context.error(
      "APPLICATION_EVENT_TESTS_INCOMPLETE",
      "Complete event generation requires exact unit and contract tests bound to the payload, envelope, and behavior contracts.",
      source("workload", "$.tests", { workloadId: workload.id }),
    );
    return undefined;
  }
  return resolved.sort((left, right) =>
    compareUtf16(left.bindingId, right.bindingId),
  );
}

function resolveEventWorkload(
  workload: WorkloadV2,
  normalized: NormalizedWorkload,
  input: ApplicationGenerationInput,
  environment: readonly ResolvedEnvironmentBinding[],
  extensionBoundary: ResolvedExtensionBoundary,
  deploymentKey: string,
  context: ResolutionContext,
): ResolvedWorkload | undefined {
  const implementation = workload.implementation;
  if (
    implementation.mode !== "generated-starter" &&
    implementation.mode !== "complete-supported-pattern"
  ) {
    return undefined;
  }
  const operation = workload.operations[0];
  const binding = workload.eventBindings[0];
  if (
    workload.operations.length !== 1 ||
    operation === undefined ||
    workload.eventBindings.length !== 1 ||
    binding?.direction !== "inbound" ||
    binding.operationId !== operation.id ||
    workload.httpRoutes.length !== 0 ||
    workload.authorization.length !== 0
  ) {
    context.error(
      "APPLICATION_EVENT_BINDING_UNSUPPORTED",
      "A curated event workload requires one explicit inbound typed event binding for one operation and no inferred HTTP/auth shape.",
      source("workload", "$.eventBindings", { workloadId: workload.id }),
    );
    return undefined;
  }
  const connection = input.normalizedSolution.connections.find(
    (candidate) => candidate.id === binding.edgeId,
  );
  const configuredSchedule = workload.schedules.at(0);
  const scheduled =
    workload.schedules.length === 1 &&
    configuredSchedule?.operationId === operation.id &&
    configuredSchedule.triggerEdgeId === binding.edgeId;
  const pattern =
    connection === undefined
      ? undefined
      : eventPatternFor(connection.relationshipType, scheduled);
  if (
    connection?.target.nodeId !== workload.owningNodeId ||
    pattern === undefined ||
    (pattern === "eventbridge-scheduled"
      ? !scheduled
      : workload.schedules.length !== 0)
  ) {
    context.error(
      "APPLICATION_EVENT_EDGE_UNSUPPORTED",
      "The event binding must reference one exact supported source-to-Lambda typed edge; event kind is never guessed from labels or prose.",
      source("normalized-model", "$.connections", {
        workloadId: workload.id,
        operationId: operation.id,
        edgeId: binding.edgeId,
      }),
    );
    return undefined;
  }
  if (!eventConfigurationValid(pattern, connection.configuration)) {
    context.error(
      "APPLICATION_EVENT_CONFIGURATION_UNSUPPORTED",
      "The exact typed event edge contains an unsupported filter, batch, retry, delivery, or target mode.",
      source("normalized-model", "$.connections.configuration", {
        workloadId: workload.id,
        operationId: operation.id,
        edgeId: binding.edgeId,
      }),
    );
    return undefined;
  }
  const sourceResource = input.normalizedSolution.resources.find(
    (candidate) => candidate.id === connection.source.nodeId,
  );
  if (
    pattern === "sqs-consumer-dlq" &&
    (sourceResource?.resourceType !== "aws.sqs.queue" ||
      valueOf(sourceResource.configuration, "queueType") !== "STANDARD")
  ) {
    context.error(
      "APPLICATION_EVENT_FIFO_UNSUPPORTED",
      "The curated SQS partial-batch consumer supports only a Standard source queue; FIFO dispatch requires ordered batch semantics that are not generated.",
      source("normalized-model", "$.resources.configuration.values.queueType", {
        workloadId: workload.id,
        operationId: operation.id,
        nodeId: connection.source.nodeId,
        edgeId: binding.edgeId,
      }),
    );
    return undefined;
  }
  const incompatibleSnsSubscription =
    pattern === "sqs-consumer-dlq"
      ? input.normalizedSolution.connections
          .filter(
            (candidate) =>
              candidate.target.nodeId === connection.source.nodeId &&
              candidate.relationshipType ===
                EVENT_SNS_SQS_RAW_DELIVERY_PREREQUISITE.relationshipType,
          )
          .sort((left, right) => compareUtf16(left.id, right.id))
          .map((candidate) => ({
            connection: candidate,
            subscription: input.normalizedSolution.resources.find(
              (resource) => resource.id === candidate.source.nodeId,
            ),
          }))
          .find(
            ({ subscription }) =>
              subscription?.serviceType !==
                EVENT_SNS_SQS_RAW_DELIVERY_PREREQUISITE.sourceServiceType ||
              subscription.resourceType !==
                EVENT_SNS_SQS_RAW_DELIVERY_PREREQUISITE.sourceResourceType ||
              valueOf(subscription.configuration, "rawMessageDelivery") !==
                EVENT_SNS_SQS_RAW_DELIVERY_PREREQUISITE.requiredConfiguration
                  .rawMessageDelivery,
          )
      : undefined;
  if (incompatibleSnsSubscription !== undefined) {
    context.error(
      "APPLICATION_EVENT_SNS_SQS_ENVELOPE_UNSUPPORTED",
      "The curated SQS consumer requires an upstream SNS subscription to use rawMessageDelivery=true so the queue body is the exact bound payload rather than an unmodeled SNS envelope.",
      source(
        "normalized-model",
        "$.resources.configuration.values.rawMessageDelivery",
        {
          workloadId: workload.id,
          operationId: operation.id,
          nodeId: incompatibleSnsSubscription.connection.source.nodeId,
          edgeId: incompatibleSnsSubscription.connection.id,
        },
      ),
    );
    return undefined;
  }
  const resolvedScheduleExpression =
    pattern === "eventbridge-scheduled" && configuredSchedule !== undefined
      ? scheduleExpression(configuredSchedule.schedule)
      : undefined;

  if (operation.capability !== eventCapability(pattern)) {
    context.error(
      "APPLICATION_EVENT_CAPABILITY_UNSUPPORTED",
      "The operation capability must exactly match the reviewed typed-edge event pattern.",
      source("workload", "$.operations", {
        workloadId: workload.id,
        operationId: operation.id,
      }),
    );
    return undefined;
  }
  const contracts = input.architectureDocument.applicationContracts.contracts;
  const eventContract = exactRecord(
    contracts,
    binding.contract,
    "event-message",
    context,
    source("workload", "$.eventBindings.contract", {
      workloadId: workload.id,
      operationId: operation.id,
      edgeId: binding.edgeId,
    }),
  );
  if (
    eventContract?.transportKind !== binding.transportKind ||
    !sameReference(
      operation.inputContract.kind === "contract-reference"
        ? operation.inputContract.reference
        : { contractId: "", contractVersion: "", digest: "" },
      binding.contract,
    )
  ) {
    context.error(
      "APPLICATION_EVENT_CONTRACT_MISMATCH",
      "The operation input, event binding, transport, and canonical event-message contract must be the same exact identity.",
      source("workload", "$.operations.inputContract", {
        workloadId: workload.id,
        operationId: operation.id,
      }),
    );
    return undefined;
  }
  if (
    eventContract.delivery.delivery !== "at-least-once" ||
    eventContract.delivery.duplicates !== "possible" ||
    eventContract.delivery.ordering !== "not-guaranteed"
  ) {
    context.error(
      "APPLICATION_EVENT_DELIVERY_UNSUPPORTED",
      "Curated event contracts must state at-least-once, duplicate-possible, non-guaranteed ordering explicitly.",
      source("architecture", "$.applicationContracts.contracts", {
        workloadId: workload.id,
        operationId: operation.id,
      }),
    );
    return undefined;
  }
  const payloadContract = exactRecord(
    contracts,
    eventContract.payload,
    "data-entity",
    context,
    source("architecture", "$.applicationContracts.contracts", {
      workloadId: workload.id,
      operationId: operation.id,
    }),
  );
  if (
    payloadContract !== undefined &&
    pattern === "s3-image-metadata" &&
    !exactCuratedEventPayload(
      payloadContract,
      EVENT_S3_METADATA_PAYLOAD_CONTRACT,
    )
  ) {
    context.error(
      "APPLICATION_EVENT_S3_METADATA_CONTRACT_UNSUPPORTED",
      "The complete S3 metadata pattern requires the exact persistent bucket/key/eTag/size/versionId/sequencer payload, key primary identity, and create/consume operations.",
      source("architecture", "$.applicationContracts.contracts", {
        workloadId: workload.id,
        operationId: operation.id,
      }),
    );
    return undefined;
  }
  if (
    payloadContract !== undefined &&
    pattern === "eventbridge-scheduled" &&
    !exactCuratedEventPayload(payloadContract, EVENT_SCHEDULED_PAYLOAD_CONTRACT)
  ) {
    context.error(
      "APPLICATION_EVENT_SCHEDULE_PAYLOAD_UNSUPPORTED",
      "The complete scheduled pattern requires the exact transient eventId/correlationId payload and eventId primary identity derivable from the typed EventBridge envelope.",
      source("architecture", "$.applicationContracts.contracts", {
        workloadId: workload.id,
        operationId: operation.id,
      }),
    );
    return undefined;
  }

  const behavior = matchingBehaviorContract(
    workload,
    operation.capability,
    contracts,
    context,
    operation.id,
  );
  if (
    payloadContract === undefined ||
    behavior?.input.kind !== "contract-reference" ||
    !sameReference(behavior.input.reference, binding.contract) ||
    (pattern === "step-functions-task"
      ? operation.outputContract.kind !== "contract-reference" ||
        behavior.output.kind !== "contract-reference" ||
        !sameReference(
          operation.outputContract.reference,
          eventContract.payload,
        ) ||
        !sameReference(behavior.output.reference, eventContract.payload)
      : operation.outputContract.kind !== "none" ||
        behavior.output.kind !== "none") ||
    behavior.authorization !== undefined ||
    !behavior.failureOutcomes.some(
      (outcome) =>
        outcome.category === "application.validation" && !outcome.retryable,
    )
  ) {
    context.error(
      "APPLICATION_EVENT_BEHAVIOR_UNSUPPORTED",
      "The behavior contract must consume the exact event envelope, expose only the reviewed task output, and fail closed on validation.",
      source("workload", "$.behaviorContracts", {
        workloadId: workload.id,
        operationId: operation.id,
      }),
    );
    return undefined;
  }
  const entrypointKind =
    pattern === "sqs-consumer-dlq"
      ? "message-handler"
      : pattern === "eventbridge-scheduled"
        ? "schedule-handler"
        : pattern === "step-functions-task"
          ? "background-worker"
          : "event-handler";
  const entrypoint = workload.entrypoints[0];
  const trigger = workload.triggers[0];
  const idempotency = workload.idempotency[0];
  const logEdges = input.normalizedSolution.connections.filter(
    (candidate) =>
      candidate.source.nodeId === workload.owningNodeId &&
      candidate.relationshipType ===
        SUPPORTED_EVENT_RELATIONSHIPS.lambdaWritesLogs,
  );
  const retry = workload.executionAssumptions.retry;
  const owningResource = input.normalizedSolution.resources.find(
    (candidate) => candidate.id === workload.owningNodeId,
  );
  const lambdaTimeoutSeconds = Number(
    valueOf(owningResource?.configuration ?? { values: {} }, "timeoutSeconds"),
  );
  const timeout = workload.executionAssumptions.timeout;
  if (
    workload.entrypoints.length !== 1 ||
    entrypoint?.kind !== entrypointKind ||
    entrypoint.operationId !== operation.id ||
    entrypoint.handler !== LAMBDA_HANDLER ||
    workload.triggers.length !== 1 ||
    trigger?.edgeId !== binding.edgeId ||
    trigger.targetOperationId !== operation.id ||
    workload.triggerDispatch.mode !== "generated-supported" ||
    workload.triggerDispatch.dispatcherId !== EVENT_TRIGGER_DISPATCHER_ID ||
    workload.triggerDispatch.dispatcherVersion !==
      EVENT_TRIGGER_DISPATCHER_VERSION ||
    workload.triggerDispatch.dispatcherOperationId !== operation.id ||
    workload.idempotency.length !== 1 ||
    idempotency?.operationIds.length !== 1 ||
    idempotency.operationIds[0] !== operation.id ||
    idempotency.mode !== "not-required" ||
    timeout.kind !== "duration" ||
    !Number.isInteger(timeout.milliseconds) ||
    timeout.milliseconds % 1_000 !== 0 ||
    timeout.milliseconds < 1_000 ||
    timeout.milliseconds > 30_000 ||
    !Number.isInteger(lambdaTimeoutSeconds) ||
    lambdaTimeoutSeconds < 1 ||
    lambdaTimeoutSeconds > 30 ||
    timeout.milliseconds !== lambdaTimeoutSeconds * 1_000 ||
    (pattern === "step-functions-task" &&
      Number(valueOf(connection.configuration, "taskTimeoutSeconds")) <
        lambdaTimeoutSeconds) ||
    retry.kind !== "bounded" ||
    retry.maximumAttempts > 10 ||
    (pattern === "step-functions-task" &&
      Number(valueOf(connection.configuration, "maximumAttempts")) !==
        retry.maximumAttempts) ||
    logEdges.length !== 1 ||
    !sameCanonical([...workload.observability.signals].sort(compareUtf16), [
      "logs",
    ]) ||
    workload.observability.healthChecks.length !== 0
  ) {
    context.error(
      "APPLICATION_EVENT_WORKLOAD_SHAPE_UNSUPPORTED",
      "Curated events require an exact typed entrypoint, generated dispatcher, matched bounded Lambda/Workload timeout, bounded retry, non-required generated idempotency with an explicit extension hook, and one graph-backed log signal.",
      source("workload", "$", { workloadId: workload.id }),
    );
    return undefined;
  }
  const partialBatchFailure =
    valueOf(connection.configuration, "partialBatchResponse") === true;
  if (
    (pattern === "sqs-consumer-dlq" &&
      (workload.errorBehavior.mode !== "continue" || !partialBatchFailure)) ||
    (pattern !== "sqs-consumer-dlq" &&
      workload.errorBehavior.mode !== "fail-invocation")
  ) {
    context.error(
      "APPLICATION_EVENT_FAILURE_MODE_UNSUPPORTED",
      "SQS requires explicit partial batch continuation; other curated event handlers fail the invocation for service-managed retry.",
      source("workload", "$.errorBehavior", { workloadId: workload.id }),
    );
    return undefined;
  }
  let deadLetterTargetKey: string | undefined;
  if (pattern === "sqs-consumer-dlq") {
    const dlqEdges = input.normalizedSolution.connections.filter(
      (candidate) =>
        candidate.source.nodeId === connection.source.nodeId &&
        candidate.relationshipType ===
          SUPPORTED_EVENT_RELATIONSHIPS.sqsUsesDeadLetterQueue,
    );
    const maximumReceiveCount = Number(
      valueOf(
        dlqEdges[0]?.configuration ?? { values: {} },
        "maximumReceiveCount",
      ),
    );
    if (
      dlqEdges.length !== 1 ||
      !Number.isInteger(maximumReceiveCount) ||
      maximumReceiveCount !== retry.maximumAttempts
    ) {
      context.error(
        "APPLICATION_EVENT_DLQ_UNSUPPORTED",
        "The SQS consumer requires one exact compatible DLQ edge whose bounded receive count matches the Workload retry contract.",
        source("normalized-model", "$.connections", {
          workloadId: workload.id,
          edgeId: binding.edgeId,
        }),
      );
      return undefined;
    }
    deadLetterTargetKey = dlqEdges[0]?.target.targetKey;
  }
  let entity = eventPayloadEntity(
    payloadContract,
    context,
    source("architecture", "$.applicationContracts.contracts", {
      workloadId: workload.id,
      operationId: operation.id,
    }),
  );
  let dataEdgeId = binding.edgeId;
  let tableEnvironmentName = "";
  if (pattern === "s3-image-metadata") {
    const dataBinding = workload.dataBindings[0];
    const dataConnection = input.normalizedSolution.connections.find(
      (candidate) => candidate.id === dataBinding?.edgeId,
    );
    const table = input.normalizedSolution.resources.find(
      (candidate) =>
        candidate.id === dataConnection?.target.nodeId &&
        candidate.resourceType === "aws.dynamodb.table",
    );
    const tableBinding = normalized.environment.filter(
      (candidate) =>
        candidate.resource?.nodeId === table?.id &&
        ["name", "id", "aws.dynamodb.table.name"].includes(
          candidate.resource?.attribute ?? "",
        ),
    );
    if (
      workload.dataBindings.length !== 1 ||
      dataBinding?.operationId !== operation.id ||
      dataBinding.dataOperation !== "create" ||
      !sameReference(dataBinding.entity, eventContract.payload) ||
      dataConnection?.source.nodeId !== workload.owningNodeId ||
      dataConnection.relationshipType !==
        SUPPORTED_EVENT_RELATIONSHIPS.lambdaWritesDynamoDb ||
      table === undefined ||
      tableBinding.length !== 1
    ) {
      context.error(
        "APPLICATION_EVENT_METADATA_BINDING_UNSUPPORTED",
        "The S3 image pattern requires one exact graph-derived DynamoDB metadata write and table-name environment binding.",
        source("workload", "$.dataBindings", {
          workloadId: workload.id,
          operationId: operation.id,
        }),
      );
      return undefined;
    }
    entity = resolveEntity(
      payloadContract,
      table,
      context,
      source("workload", "$.dataBindings.entity", {
        workloadId: workload.id,
        operationId: operation.id,
      }),
    );
    dataEdgeId = dataBinding.edgeId ?? binding.edgeId;
    tableEnvironmentName = tableBinding[0]?.name ?? "";
  } else if (
    workload.dataBindings.length !== 0 ||
    workload.downstreamActions.length !== 0
  ) {
    context.error(
      "APPLICATION_EVENT_DOWNSTREAM_UNSUPPORTED",
      "This curated consumer has no generated business transform or inferred downstream action.",
      source("workload", "$.dataBindings", { workloadId: workload.id }),
    );
    return undefined;
  }
  if (entity === undefined) return undefined;
  const resolvedOperation: ResolvedOperation = {
    id: operation.id,
    pathKey: portableSegment(operation.id),
    capability: operation.capability,
    dataOperation: pattern === "s3-image-metadata" ? "create" : "read",
    method: "POST",
    pathTemplate: `/events/${pattern}`,
    routeKey: connection.relationshipType,
    routeContractId: eventContract.contractId,
    routeContractVersion: eventContract.contractVersion,
    routeContractDigest: getApplicationContractRecordContentHash(eventContract),
    triggerEdgeId: binding.edgeId,
    dataEdgeId,
    tableEnvironmentName,
    entity,
    successStatus: 200,
    validationStatus: 400,
    authorizationStatus: 403,
    behaviorContractId: behavior.contractId,
    behaviorContractVersion: behavior.contractVersion,
    behaviorContractDigest: getApplicationContractRecordContentHash(behavior),
    permittedRoleIds: [],
    event: {
      pattern,
      bindingId: String(binding.bindingId),
      transportKind: binding.transportKind,
      eventContractId: eventContract.contractId,
      eventContractVersion: eventContract.contractVersion,
      eventContractDigest:
        getApplicationContractRecordContentHash(eventContract),
      delivery: eventContract.delivery,
      batchSize:
        pattern === "sqs-consumer-dlq"
          ? Number(valueOf(connection.configuration, "batchSize"))
          : 1,
      partialBatchFailure,
      maximumAttempts: retry.maximumAttempts,
      timeoutMilliseconds: timeout.milliseconds,
      ...(deadLetterTargetKey === undefined ? {} : { deadLetterTargetKey }),
      ...(pattern !== "s3-image-metadata"
        ? {}
        : {
            filterPrefix:
              stringValueOf(connection.configuration, "filterPrefix") ?? "",
            filterSuffix:
              stringValueOf(connection.configuration, "filterSuffix") ?? "",
          }),
      ...(resolvedScheduleExpression === undefined
        ? {}
        : {
            scheduleExpression: resolvedScheduleExpression,
          }),
      idempotency: { mode: "not-required" },
    },
  };
  const tests =
    implementation.mode === "complete-supported-pattern"
      ? resolveEventTests(workload, contracts, resolvedOperation, context)
      : [];
  const unresolved = [
    ...workload.unresolvedRequirementIds,
    ...workload.implementationRequirements.map(
      (requirement) => requirement.implementationRequirementId,
    ),
  ].sort(compareUtf16);
  if (
    implementation.mode === "complete-supported-pattern" &&
    (tests === undefined || unresolved.length > 0)
  ) {
    context.error(
      "APPLICATION_EVENT_COMPLETE_UNRESOLVED",
      "Complete event generation requires all exact contracts, tests, and behavior to resolve.",
      source("workload", "$.implementation", { workloadId: workload.id }),
    );
  }
  return {
    workloadId: workload.id,
    deploymentKey,
    mode: implementation.mode,
    operations: [resolvedOperation],
    eventPattern: pattern,
    environment,
    tests: tests ?? [],
    unresolvedRequirementIds: unresolved,
    extensionPointIds: extensionBoundary.extensionPointIds,
    ...(extensionBoundary.path === undefined
      ? {}
      : { extensionPath: extensionBoundary.path }),
  };
}

function resolveHttpNoContentWorkload(
  workload: WorkloadV2,
  input: ApplicationGenerationInput,
  deploymentKey: string,
  context: ResolutionContext,
): ResolvedHttpNoContentWorkload | undefined {
  const reject = (message: string): undefined => {
    context.error(
      "APPLICATION_HTTP_NO_CONTENT_UNSUPPORTED",
      message,
      source("workload", "$", { workloadId: workload.id }),
    );
    return undefined;
  };
  if (
    workload.implementation.mode !== "complete-supported-pattern" ||
    workload.operations.length !== 1 ||
    workload.httpRoutes.length !== 1 ||
    workload.triggers.length !== 1 ||
    workload.authorization.length !== 1 ||
    workload.behaviorContracts.length !== 1 ||
    workload.dataBindings.length !== 0 ||
    workload.downstreamActions.length !== 0 ||
    workload.environment.length !== 0 ||
    workload.eventBindings.length !== 0 ||
    workload.schedules.length !== 0 ||
    workload.implementationRequirements.length !== 0 ||
    workload.unresolvedRequirementIds.length !== 0 ||
    workload.extensionPoints.length !== 0 ||
    workload.sourceOwnership.length !== 0 ||
    !validateReviewedWorkloadShape(workload, input, context)
  ) {
    reject(
      "The no-content pattern requires one explicit authenticated HTTP operation, no data or external actions, no unresolved behavior, and the reviewed request-handler lifecycle.",
    );
    return;
  }
  const operation = workload.operations[0];
  const route = workload.httpRoutes[0];
  const trigger = workload.triggers[0];
  const authBinding = workload.authorization[0];
  const behaviorReference = workload.behaviorContracts[0];
  if (authBinding === undefined || behaviorReference === undefined) {
    reject("Exact auth and behavior bindings are required.");
    return;
  }
  if (
    operation === undefined ||
    route === undefined ||
    trigger === undefined ||
    operation.capability !== HTTP_NO_CONTENT_CAPABILITY ||
    operation.inputContract.kind !== "none" ||
    operation.outputContract.kind !== "none" ||
    route.operationId !== operation.id ||
    trigger.targetOperationId !== operation.id ||
    route.triggerEdgeId !== trigger.edgeId ||
    route.method !== "GET" ||
    !/^\/[A-Za-z0-9/_-]*$/u.test(route.pathTemplate)
  ) {
    reject(
      "The reviewed operation is an explicit GET with no business input or output and one exact route and trigger.",
    );
    return;
  }
  const connection = input.normalizedSolution.connections.find(
    (edge) => edge.id === trigger.edgeId,
  );
  const api = input.normalizedSolution.resources.find(
    (resource) => resource.id === connection?.source.nodeId,
  );
  if (
    connection?.relationshipType !== SUPPORTED_RELATIONSHIPS.apiInvokesLambda ||
    connection.target.nodeId !== workload.owningNodeId ||
    valueOf(connection.configuration, "payloadFormatVersion") !== "2.0" ||
    valueOf(connection.configuration, "routeKey") !==
      `GET ${route.pathTemplate}` ||
    api?.resourceType !== "aws.apigateway.http-api" ||
    valueOf(api.configuration, "jwtAuthorizationRequired") !== true ||
    valueOf(api.configuration, "corsEnabled") !== false
  ) {
    reject(
      "The route must use the exact payload-v2 API Gateway integration with required managed JWT authorization.",
    );
    return;
  }
  const issuers = input.normalizedSolution.connections.filter(
    (edge) =>
      edge.target.nodeId === api.id &&
      edge.relationshipType === "aws.cognito.provides-jwt-issuer",
  );
  const audiences = input.normalizedSolution.connections.filter(
    (edge) =>
      edge.target.nodeId === api.id &&
      edge.relationshipType === "aws.cognito.provides-jwt-audience",
  );
  const issuer = issuers[0];
  const audience = audiences[0];
  if (
    issuers.length !== 1 ||
    audiences.length !== 1 ||
    issuer === undefined ||
    audience === undefined ||
    valueOf(issuer.configuration, "identitySource") !==
      "$request.header.Authorization" ||
    input.normalizedSolution.resources.find(
      (resource) => resource.id === issuer.source.nodeId,
    )?.resourceType !== "aws.cognito.user-pool" ||
    input.normalizedSolution.resources.find(
      (resource) => resource.id === audience.source.nodeId,
    )?.resourceType !== "aws.cognito.user-pool-client"
  ) {
    reject(
      "The route requires one exact Cognito JWT issuer and audience; token validation remains owned by the managed authorizer and compiler.",
    );
    return;
  }
  const contracts = input.architectureDocument.applicationContracts.contracts;
  const routeContract = exactRecord(
    contracts,
    route.contract,
    "http-api",
    context,
    source("workload", "$.httpRoutes.contract", { workloadId: workload.id }),
  );
  if (
    routeContract?.method !== "GET" ||
    routeContract.pathTemplate !== route.pathTemplate ||
    routeContract.request.parameters.length !== 0 ||
    routeContract.request.body !== undefined ||
    !sameCanonical(
      routeContract.responses
        .map((response) => response.statusCode)
        .sort((a, b) => a - b),
      [204, 400, 401, 403, 404],
    ) ||
    routeContract.responses.some(
      (response) =>
        response.entity !== undefined ||
        response.mediaType !== undefined ||
        response.headers.length !== 0,
    )
  ) {
    reject(
      "The no-content route declares only empty 204, 400, 401, 403 and 404 responses and no request parameters or body.",
    );
    return;
  }
  const authorization = resolveAuth(
    workload,
    operation.id,
    routeContract,
    contracts,
    context,
  );
  const behavior = matchingBehaviorContract(
    workload,
    operation.capability,
    contracts,
    context,
    operation.id,
  );
  if (
    authorization === undefined ||
    !authorization.auth.claimNames.includes("sub") ||
    behavior?.input.kind !== "none" ||
    behavior.output.kind !== "none" ||
    behavior.authorization === undefined ||
    !sameReference(
      behavior.authorization.authContract,
      authBinding.authContract,
    ) ||
    !sameCanonical(
      [...behavior.authorization.permittedRoleIds].sort(compareUtf16),
      authorization.permittedRoleIds,
    ) ||
    !sameCanonical(
      behavior.failureOutcomes
        .map((failure) => failure.category)
        .sort(compareUtf16),
      [
        "application.authorization",
        "application.not-found",
        "application.validation",
      ],
    ) ||
    behavior.failureOutcomes.some((failure) => failure.retryable)
  ) {
    reject(
      "The explicit no-content behavior must match the exact required subject and role contract, with only nonretryable authorization, validation and route failures.",
    );
    return;
  }
  const tests: ResolvedTest[] = [];
  for (const binding of workload.tests) {
    const test = exactRecord(
      contracts,
      binding.testCase,
      "test-case",
      context,
      source("workload", "$.tests", { workloadId: workload.id }),
    );
    const expectedPreconditions =
      binding.level === "unit"
        ? []
        : [
            { kind: "contract-available", contract: route.contract },
            {
              kind: "authenticated-role",
              authContract: authBinding.authContract,
              roleId: authorization.permittedRoleIds[0],
            },
          ];
    const expectedExpectations =
      binding.level === "unit"
        ? [{ kind: "error-category", category: "application.authorization" }]
        : [{ kind: "http-status", statusCode: 204 }];
    if (
      test === undefined ||
      !binding.requiredForCoverage ||
      (binding.level !== "unit" && binding.level !== "contract") ||
      test.level !== binding.level ||
      test.fixtureReferences.length !== 0 ||
      !sameReference(test.target, behaviorReference) ||
      !sameCanonical(
        [...test.preconditions].sort((a, b) =>
          compareUtf16(canonicalJson(a), canonicalJson(b)),
        ),
        expectedPreconditions.sort((a, b) =>
          compareUtf16(canonicalJson(a), canonicalJson(b)),
        ),
      ) ||
      !sameCanonical(
        test.expectations.map(({ expectationId, ...expectation }) => {
          void expectationId;
          return expectation;
        }),
        expectedExpectations,
      )
    ) {
      reject(
        "Complete no-content generation requires exact unit denial and authenticated 204 contract tests linked to the behavior.",
      );
      return;
    }
    tests.push({
      bindingId: binding.bindingId,
      level: binding.level,
      testCaseContractId: test.contractId,
      testCaseContractVersion: test.contractVersion,
      testCaseContractDigest: binding.testCase.digest,
      targetBehaviorContractId: behavior.contractId,
      targetBehaviorContractVersion: behavior.contractVersion,
      targetBehaviorContractDigest: behaviorReference.digest,
      operationId: operation.id,
      preconditions: test.preconditions,
      expectations: test.expectations,
    });
  }
  if (
    tests.length !== 2 ||
    new Set(tests.map((test) => test.level)).size !== 2
  ) {
    reject("One exact unit test and one exact contract test are required.");
    return;
  }
  return {
    patternKind: "http-no-content",
    workloadId: workload.id,
    deploymentKey,
    mode: "complete-supported-pattern",
    environment: [],
    auth: authorization.auth,
    tests,
    unresolvedRequirementIds: [],
    extensionPointIds: [],
    authenticationEdgeIds: [issuer.id, audience.id],
    operations: [
      {
        id: operation.id,
        pathKey: portableSegment(operation.id),
        capability: operation.capability,
        dataOperation: "none",
        method: "GET",
        pathTemplate: route.pathTemplate,
        routeKey: `GET ${route.pathTemplate}`,
        routeContractId: routeContract.contractId,
        routeContractVersion: routeContract.contractVersion,
        routeContractDigest: route.contract.digest,
        triggerEdgeId: trigger.edgeId,
        behaviorContractId: behavior.contractId,
        behaviorContractVersion: behavior.contractVersion,
        behaviorContractDigest: behaviorReference.digest,
        permittedRoleIds: authorization.permittedRoleIds,
        successStatus: 204,
        validationStatus: 400,
        authorizationStatus: 403,
      },
    ],
  };
}

function resolveWorkload(
  workload: WorkloadV2,
  input: ApplicationGenerationInput,
  context: ResolutionContext,
): ResolvedApplicationWorkload | undefined {
  const normalizedMatches = input.normalizedSolution.workloads.filter(
    (candidate) => candidate.id === workload.id,
  );
  const normalized = normalizedMatches[0];
  if (
    normalizedMatches.length !== 1 ||
    normalized === undefined ||
    !sameCanonical(normalized.specification, workload)
  ) {
    context.error(
      "APPLICATION_NORMALIZED_WORKLOAD_MISMATCH",
      "The exact canonical workload must appear once in normalized-model specification.",
      source("normalized-model", "$.workloads", { workloadId: workload.id }),
    );
    return undefined;
  }
  const resource = input.normalizedSolution.resources.find(
    (candidate) => candidate.id === workload.owningNodeId,
  );
  if (
    resource?.resourceType !== "aws.lambda.function" ||
    normalized.owningResource.targetKey !== resource.targetKey
  ) {
    context.error(
      "APPLICATION_LAMBDA_OWNER_REQUIRED",
      "A source-emitting workload must own one normalized AWS Lambda function.",
      source("normalized-model", "$.workloads.owningResource", {
        workloadId: workload.id,
      }),
    );
    return undefined;
  }
  const descriptor = sourceDescriptor(
    input.generator.id,
    input.generator.version,
  );
  const implementation = workload.implementation;
  const sourceMode =
    implementation.mode === "generated-starter" ||
    implementation.mode === "complete-supported-pattern" ||
    implementation.mode === "ai-assisted-custom";
  if (!sourceMode) return undefined;
  if (
    implementation.runtimeFamily !== NODE_RUNTIME_FAMILY ||
    implementation.handler !== LAMBDA_HANDLER ||
    workload.languageFamily !== TYPESCRIPT_LANGUAGE_FAMILY ||
    valueOf(resource.configuration, "runtime") !== LAMBDA_RUNTIME ||
    valueOf(resource.configuration, "handler") !== LAMBDA_HANDLER
  ) {
    context.error(
      "APPLICATION_RUNTIME_UNSUPPORTED",
      "Workload and owning Lambda runtime/language/handler must match the exact Node.js 24 TypeScript template.",
      source("workload", "$.implementation", { workloadId: workload.id }),
    );
    return undefined;
  }
  if (
    implementation.mode !== "ai-assisted-custom" &&
    compatibilityMatches(workload, input) !== 1
  ) {
    context.error(
      "APPLICATION_TEMPLATE_COMPATIBILITY_AMBIGUOUS",
      "Generated workloads require exactly one exact generator/template compatibility declaration.",
      source("workload", "$.compatibility.applicationGenerators", {
        workloadId: workload.id,
      }),
    );
    return undefined;
  }
  if (
    implementation.mode === "complete-supported-pattern" &&
    (implementation.supportedPattern.patternId !==
      (input.generator.id === EVENT_APPLICATION_GENERATOR_ID
        ? EVENT_APPLICATION_PATTERN_ID
        : descriptor.pattern.id) ||
      implementation.supportedPattern.patternVersion !==
        (input.generator.id === EVENT_APPLICATION_GENERATOR_ID
          ? EVENT_APPLICATION_PATTERN_VERSION
          : descriptor.pattern.version) ||
      implementation.supportedPattern.digest !==
        (input.generator.id === EVENT_APPLICATION_GENERATOR_ID
          ? EVENT_APPLICATION_PATTERN_DIGEST
          : descriptor.pattern.digest))
  ) {
    context.error(
      "APPLICATION_PATTERN_UNSUPPORTED",
      "Complete generation requires the exact reviewed supported-pattern digest.",
      source("workload", "$.implementation.supportedPattern", {
        workloadId: workload.id,
      }),
    );
    return undefined;
  }
  if (
    input.generator.id === HTTP_NO_CONTENT_RELEASE_V1.generator.id &&
    (normalized.environment.length !== 0 ||
      normalized.sourceOwnership.length !== 0 ||
      normalized.extensionPoints.length !== 0)
  ) {
    context.error(
      "APPLICATION_HTTP_NO_CONTENT_UNSUPPORTED",
      "The no-content normalized workload must not add environment or source ownership bindings.",
      source("normalized-model", "$.workloads", { workloadId: workload.id }),
    );
    return undefined;
  }
  if (input.generator.id === HTTP_NO_CONTENT_RELEASE_V1.generator.id)
    return resolveHttpNoContentWorkload(
      workload,
      input,
      resource.deploymentKey,
      context,
    );
  const environment = resolveEnvironment(workload, normalized, context);
  const extensionBoundary = resolveExtensionBoundary(
    workload,
    normalized,
    resource.deploymentKey,
    context,
  );
  if (extensionBoundary === undefined) return undefined;
  if (input.generator.id === EVENT_APPLICATION_GENERATOR_ID) {
    return resolveEventWorkload(
      workload,
      normalized,
      input,
      environment,
      extensionBoundary,
      resource.deploymentKey,
      context,
    );
  }

  if (implementation.mode === "ai-assisted-custom") {
    context.warning(
      "APPLICATION_AI_CANDIDATE_REQUIRED",
      "Deterministic scaffolding is ready; Prompt 36A owns AI-authored candidate source and validation.",
      source("workload", "$.implementation", { workloadId: workload.id }),
    );
    return {
      workloadId: workload.id,
      deploymentKey: resource.deploymentKey,
      mode: implementation.mode,
      operations: [],
      environment,
      tests: [],
      unresolvedRequirementIds: [
        ...workload.unresolvedRequirementIds,
        ...workload.implementationRequirements.map(
          (requirement) => requirement.implementationRequirementId,
        ),
      ].sort(compareUtf16),
      extensionPointIds: extensionBoundary.extensionPointIds,
      ...(extensionBoundary.path === undefined
        ? {}
        : { extensionPath: extensionBoundary.path }),
    };
  }
  const workloadShapeStart = context.diagnostics.length;
  let reviewedWorkloadShape = validateReviewedWorkloadShape(
    workload,
    input,
    context,
  );
  if (workload.eventBindings.length > 0 || workload.schedules.length > 0) {
    context.error(
      "APPLICATION_EVENT_SHAPE_UNSUPPORTED",
      "The initial template accepts only explicit API Gateway HTTP API payload-v2 triggers; use separate functions for other event shapes.",
      source("workload", "$.eventBindings", { workloadId: workload.id }),
    );
    reviewedWorkloadShape = false;
  }
  if (!reviewedWorkloadShape && implementation.mode === "generated-starter") {
    for (
      let index = workloadShapeStart;
      index < context.diagnostics.length;
      index += 1
    ) {
      const diagnostic = context.diagnostics[index];
      if (diagnostic?.severity === "error") {
        context.diagnostics[index] = { ...diagnostic, severity: "warning" };
      }
    }
  }
  const operations: ResolvedOperation[] = [];
  let resolvedAuth: ResolvedAuth | undefined;
  if (
    reviewedWorkloadShape ||
    implementation.mode === "complete-supported-pattern"
  ) {
    for (const operation of [...workload.operations].sort((left, right) =>
      compareUtf16(left.id, right.id),
    )) {
      const before = context.diagnostics.length;
      const resolved = resolveOperation(
        workload,
        normalized,
        operation,
        input,
        context,
      );
      if (resolved.operation !== undefined) {
        operations.push(resolved.operation);
        if (
          resolvedAuth !== undefined &&
          !sameCanonical(resolvedAuth, resolved.auth)
        ) {
          context.error(
            "APPLICATION_AUTH_SHAPE_INCOMPATIBLE",
            "One generated handler requires the same exact auth claim contract for every route.",
            source("workload", "$.authorization", {
              workloadId: workload.id,
              operationId: operation.id,
            }),
          );
        } else {
          resolvedAuth = resolved.auth;
        }
      } else if (implementation.mode === "generated-starter") {
        for (
          let index = before;
          index < context.diagnostics.length;
          index += 1
        ) {
          const diagnostic = context.diagnostics[index];
          if (diagnostic?.severity === "error") {
            context.diagnostics[index] = { ...diagnostic, severity: "warning" };
          }
        }
      }
    }
  }
  const routeKeys = operations.map((operation) => operation.routeKey);
  const operationPathKeys = operations.map((operation) => operation.pathKey);
  if (
    new Set(routeKeys).size !== routeKeys.length ||
    new Set(operationPathKeys).size !== operationPathKeys.length
  ) {
    const diagnosticSource = source("workload", "$.httpRoutes", {
      workloadId: workload.id,
    });
    if (implementation.mode === "generated-starter") {
      context.warning(
        "APPLICATION_DISPATCH_KEY_COLLISION",
        "Colliding route or operation path keys were withheld from starter source.",
        diagnosticSource,
      );
      operations.splice(0);
      resolvedAuth = undefined;
    } else {
      context.error(
        "APPLICATION_DISPATCH_KEY_COLLISION",
        "Generated route keys and stable operation path keys must be unique.",
        diagnosticSource,
      );
    }
  }
  if (operations.length > 1) {
    const inputIdentities = workload.operations.map((operation) =>
      operation.inputContract.kind === "contract-reference"
        ? canonicalJson(operation.inputContract.reference)
        : "none",
    );
    if (new Set(inputIdentities).size !== 1 || inputIdentities[0] === "none") {
      context.error(
        "APPLICATION_MULTIPLE_TRIGGER_INCOMPATIBLE",
        "Multiple API routes require the same exact non-empty API Gateway v2 event-contract identity; otherwise use separate functions.",
        source("workload", "$.triggers", { workloadId: workload.id }),
      );
    }
  }
  const unresolved = [
    ...workload.unresolvedRequirementIds,
    ...workload.implementationRequirements.map(
      (requirement) => requirement.implementationRequirementId,
    ),
  ].sort(compareUtf16);
  let resolvedTests: readonly ResolvedTest[] = [];
  if (implementation.mode === "complete-supported-pattern") {
    const tests =
      operations.length === workload.operations.length && operations.length > 0
        ? validateCompleteTests(
            workload,
            input.architectureDocument.applicationContracts.contracts,
            operations,
            context,
          )
        : undefined;
    if (tests !== undefined) resolvedTests = tests;
    if (operations.length === 0) {
      context.error(
        "APPLICATION_COMPLETE_OPERATION_REQUIRED",
        "Complete-pattern source requires at least one exactly represented operation.",
        source("workload", "$.operations", { workloadId: workload.id }),
      );
    }
    if (
      unresolved.length > 0 ||
      operations.length !== workload.operations.length ||
      tests === undefined
    ) {
      context.error(
        "APPLICATION_COMPLETE_BEHAVIOR_UNRESOLVED",
        "Complete-pattern source cannot be emitted while behavior, tests, or any implementation requirement remains unresolved.",
        source("workload", "$.implementation", { workloadId: workload.id }),
      );
    }
  } else if (
    unresolved.length > 0 ||
    operations.length !== workload.operations.length
  ) {
    context.warning(
      "APPLICATION_STARTER_BEHAVIOR_REQUIRED",
      "Starter source contains only represented supported operations; unresolved business behavior remains user-owned.",
      source("workload", "$.implementationRequirements", {
        workloadId: workload.id,
      }),
    );
  }
  if (operations.length === 0 && implementation.mode === "generated-starter") {
    context.warning(
      "APPLICATION_STARTER_NO_SUPPORTED_OPERATION",
      "No supported operation was complete enough to emit business source.",
      source("workload", "$.operations", { workloadId: workload.id }),
    );
  }
  return {
    workloadId: workload.id,
    deploymentKey: resource.deploymentKey,
    mode: implementation.mode,
    operations,
    environment,
    ...(resolvedAuth === undefined ? {} : { auth: resolvedAuth }),
    tests: resolvedTests,
    unresolvedRequirementIds: unresolved,
    extensionPointIds: extensionBoundary.extensionPointIds,
    ...(extensionBoundary.path === undefined
      ? {}
      : { extensionPath: extensionBoundary.path }),
  };
}

export function resolveApplicationInput(
  input: ApplicationGenerationInput,
): ResolutionResult {
  const context = new ResolutionContext();
  validateDescriptors(input, context);
  validateRevision(input, context);
  validateNormalized(input, context);
  const workloads = input.workloadBehavior.workloads.flatMap((workload) => {
    const resolved = resolveWorkload(workload, input, context);
    return resolved === undefined ? [] : [resolved];
  });
  const completeWorkloadIds = new Set<string>(
    input.workloadBehavior.workloads
      .filter(
        (workload) =>
          workload.implementation.mode === "complete-supported-pattern",
      )
      .map((workload) => workload.id),
  );
  const completeHasError = context.diagnostics.some(
    (diagnostic) =>
      diagnostic.severity === "error" &&
      (diagnostic.source.workloadId === undefined ||
        completeWorkloadIds.has(diagnostic.source.workloadId)),
  );
  const filteredWorkloads = completeHasError
    ? workloads.filter(
        (workload) => workload.mode !== "complete-supported-pattern",
      )
    : workloads;
  return {
    workloads: filteredWorkloads.sort((left, right) =>
      compareUtf16(left.deploymentKey, right.deploymentKey),
    ),
    diagnostics: context.diagnostics.sort((left, right) => {
      const sourceOrder = compareUtf16(
        canonicalJson(left.source),
        canonicalJson(right.source),
      );
      return sourceOrder === 0
        ? compareUtf16(left.code, right.code)
        : sourceOrder;
    }),
    contracts: [
      ...input.architectureDocument.applicationContracts.contracts,
    ].sort((left, right) => compareUtf16(left.contractId, right.contractId)),
  };
}

export function implementationModeDiagnostics(
  workload: WorkloadV2,
): readonly GenerationDiagnostic[] {
  const identifiers = { workloadId: workload.id };
  switch (workload.implementation.mode) {
    case "infrastructure-only":
      return [
        {
          code: "APPLICATION_CODE_REQUIRED",
          severity: "warning",
          message:
            "Infrastructure is representable, but application code is required before packaging.",
          source: source("workload", "$.implementation", identifiers),
        },
      ];
    case "user-provided":
      return [
        {
          code: "APPLICATION_USER_PACKAGE_REQUIRED",
          severity: "info",
          message:
            "User-provided source must satisfy the pinned runtime, handler, package, and artifact contract.",
          source: source("workload", "$.implementation", identifiers),
        },
      ];
    case "external-artifact":
      return [
        {
          code: "APPLICATION_EXTERNAL_ARTIFACT_NOT_FETCHED",
          severity: "info",
          message:
            "The digest-bearing external artifact reference was retained without fetching or inspecting it.",
          source: source("workload", "$.implementation.artifact", identifiers),
        },
      ];
    default:
      return [];
  }
}
