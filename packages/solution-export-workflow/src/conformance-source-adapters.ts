import { generateApplication } from "@cloudmarkup/application-generator";
import {
  getApplicationContractRecordContentHash,
  getApplicationContractsContentHash,
  getArchitectureDocumentCanonicalHash,
  getArchitectureDocumentHashes,
  getExternalResourceReferenceContentHash,
  getReviewedPublicExposureV1,
  getWorkloadBehaviorContentHash,
  hashCanonicalValue,
  assignConformanceTargetKeysV1,
  projectArchitectureConnectionIntentV1,
  projectArchitectureOutputIntentV1,
  projectArchitectureResourceIntentV1,
  projectArchitectureVariableIntentV1,
} from "@cloudmarkup/domain";
import {
  applicationContractsV1Schema,
  applicationGenerationRequestV1Schema,
  applicationGenerationResultV1Schema,
  architectureDocumentV3Schema,
  conformanceFactV1Schema,
  conformanceLayerInputV1Schema,
  evidenceIdSchema,
  externalResourceReferenceDocumentV1Schema,
  serializeCanonicalJson,
  solutionRevisionManifestV1Schema,
  utcTimestampSchema,
  workloadBehaviorV2Schema,
  type ApplicationContractRecordV1,
  type ConformanceFactV1,
  type ConformanceLayerInputV1,
  type NormalizedSolutionV1,
  type Sha256Digest,
  type SolutionRevisionManifestV1,
  type WorkloadV2,
} from "@cloudmarkup/schemas";
import { z } from "zod";

import {
  goCompilationResultV1Schema,
  type GoCompilationResultV1,
} from "./compiler-projection.js";

const conformanceSourceBundleV1Schema = z
  .object({
    applicationContracts: applicationContractsV1Schema,
    architectureDocument: architectureDocumentV3Schema,
    externalResources: externalResourceReferenceDocumentV1Schema,
    solutionRevision: solutionRevisionManifestV1Schema,
    workloadBehavior: workloadBehaviorV2Schema,
  })
  .strict();

export const designedConformanceSourceInputV1Schema = z
  .object({
    evidenceId: evidenceIdSchema,
    sources: conformanceSourceBundleV1Schema,
    verifiedAt: utcTimestampSchema,
  })
  .strict();

export const generatedConformanceSourceInputV1Schema = z
  .object({
    applicationEvidenceId: evidenceIdSchema,
    applicationGeneration: z
      .object({
        request: applicationGenerationRequestV1Schema,
        result: applicationGenerationResultV1Schema,
      })
      .strict(),
    compilation: goCompilationResultV1Schema,
    compilerEvidenceId: evidenceIdSchema,
    sources: conformanceSourceBundleV1Schema,
    verifiedAt: utcTimestampSchema,
  })
  .strict();

type ConformanceSourceBundleV1 = z.output<
  typeof conformanceSourceBundleV1Schema
>;
type DesignedConformanceSourceInputV1 = z.output<
  typeof designedConformanceSourceInputV1Schema
>;
type GeneratedConformanceSourceInputV1 = z.output<
  typeof generatedConformanceSourceInputV1Schema
>;
type NormalizedResourceV1 = NormalizedSolutionV1["resources"][number];
type NormalizedConnectionV1 = NormalizedSolutionV1["connections"][number];
type NormalizedExternalResourceV1 =
  NormalizedSolutionV1["externalResources"][number];

export class SolutionConformanceSourceProjectionError extends Error {
  public readonly code: string;

  public constructor(code: string) {
    super("Conformance source evidence could not be projected safely.");
    this.name = "SolutionConformanceSourceProjectionError";
    this.code = code;
  }
}

function fail(code: string): never {
  throw new SolutionConformanceSourceProjectionError(code);
}

function compareUtf16(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function sortedStrings(values: readonly string[]): string[] {
  return [...values].sort(compareUtf16);
}

function sortedRecords(values: readonly unknown[]): unknown[] {
  return [...values].sort((left, right) =>
    compareUtf16(serializeCanonicalJson(left), serializeCanonicalJson(right)),
  );
}

function canonicalEqual(left: unknown, right: unknown): boolean {
  return serializeCanonicalJson(left) === serializeCanonicalJson(right);
}

function stableId(prefix: string, digest: string): string {
  return `${prefix}.${digest.slice("sha256:".length, 31)}`;
}

function revisionDigest(revision: SolutionRevisionManifestV1): Sha256Digest {
  return hashCanonicalValue(revision);
}

function lifecycleProjection(value: {
  readonly adoptedBy?: string | undefined;
  readonly origin: string;
  readonly ownership: string;
  readonly provenance?:
    | {
        readonly dependentEdgeIds: readonly string[];
        readonly dependentNodeIds: readonly string[];
        readonly generatorId: string;
        readonly generatorKind: string;
        readonly generatorVersion: string;
        readonly operationId: string;
      }
    | undefined;
}) {
  return {
    ...(value.adoptedBy === undefined ? {} : { adoptedBy: value.adoptedBy }),
    origin: value.origin,
    ownership: value.ownership,
    ...(value.provenance === undefined
      ? {}
      : {
          provenance: {
            dependentEdgeIds: sortedStrings(value.provenance.dependentEdgeIds),
            dependentNodeIds: sortedStrings(value.provenance.dependentNodeIds),
            generatorId: value.provenance.generatorId,
            generatorKind: value.provenance.generatorKind,
            generatorVersion: value.provenance.generatorVersion,
            operationId: value.provenance.operationId,
          },
        }),
  };
}

function assignStableTargetKeys(
  sources: ConformanceSourceBundleV1,
): ReadonlyMap<string, string> {
  return assignConformanceTargetKeysV1(sources);
}

function architectureResourceProjection(
  sources: ConformanceSourceBundleV1,
  node: ConformanceSourceBundleV1["architectureDocument"]["nodes"][number],
  targetKeys: ReadonlyMap<string, string>,
) {
  return projectArchitectureResourceIntentV1(sources, node, targetKeys);
}

function normalizedResourceProjection(resource: NormalizedResourceV1) {
  return {
    configuration: resource.configuration,
    deploymentKey: resource.deploymentKey,
    lifecycle: lifecycleProjection(resource.lifecycle),
    ...(resource.parent === undefined
      ? {}
      : {
          parent: {
            nodeId: resource.parent.nodeId,
            ...(resource.parent.port === undefined
              ? {}
              : { port: resource.parent.port }),
            targetKey: resource.parent.targetKey,
          },
        }),
    resourceType: resource.resourceType,
    serviceType: resource.serviceType,
    targetKey: resource.targetKey,
    workloadIds: sortedStrings(resource.workloadIds),
  };
}

function architectureConnectionProjection(
  edge: ConformanceSourceBundleV1["architectureDocument"]["edges"][number],
  targetKeys: ReadonlyMap<string, string>,
) {
  return projectArchitectureConnectionIntentV1(edge, targetKeys);
}

function normalizedConnectionProjection(connection: NormalizedConnectionV1) {
  return {
    configuration: connection.configuration,
    lifecycle: lifecycleProjection(connection.lifecycle),
    relationshipType: connection.relationshipType,
    source: {
      nodeId: connection.source.nodeId,
      ...(connection.source.port === undefined
        ? {}
        : { port: connection.source.port }),
      targetKey: connection.source.targetKey,
    },
    target: {
      nodeId: connection.target.nodeId,
      ...(connection.target.port === undefined
        ? {}
        : { port: connection.target.port }),
      targetKey: connection.target.targetKey,
    },
  };
}

function architectureVariableProjection(
  variable: ConformanceSourceBundleV1["architectureDocument"]["variables"][number],
) {
  return projectArchitectureVariableIntentV1(variable);
}

function normalizedVariableProjection(
  variable: NormalizedSolutionV1["variables"][number],
) {
  return {
    ...(variable.defaultValue === undefined
      ? {}
      : { defaultValue: variable.defaultValue }),
    key: variable.key,
    required: variable.required,
    valueType: variable.valueType,
  };
}

function architectureOutputProjection(
  output: ConformanceSourceBundleV1["architectureDocument"]["outputs"][number],
  targetKeys: ReadonlyMap<string, string>,
) {
  return projectArchitectureOutputIntentV1(output, targetKeys);
}

function normalizedOutputProjection(
  output: NormalizedSolutionV1["outputs"][number],
) {
  return {
    key: output.key,
    sensitive: output.sensitive,
    source:
      output.variableId === undefined
        ? {
            ...(output.resource?.attribute === undefined
              ? {}
              : { attribute: output.resource.attribute }),
            kind: output.kind,
            ...(output.resource === undefined
              ? {}
              : {
                  nodeId: output.resource.nodeId,
                  targetKey: output.resource.targetKey,
                }),
          }
        : { kind: output.kind, variableId: output.variableId },
  };
}

function sourceExternalAddress(
  address: ConformanceSourceBundleV1["externalResources"]["resources"][number]["addresses"][number],
) {
  if (address.kind === "network-endpoint") {
    return {
      id: address.addressId,
      kind: address.kind,
      value: `${address.host}:${String(address.port)}`,
    };
  }
  if (address.kind === "repository-dependency") {
    return {
      id: address.addressId,
      kind: address.kind,
      value: address.packageReference,
    };
  }
  return { id: address.addressId, kind: address.kind, value: address.value };
}

function sourceExternalProjection(
  resource: ConformanceSourceBundleV1["externalResources"]["resources"][number],
  targetKeys: ReadonlyMap<string, string>,
) {
  return {
    addresses: sortedRecords(resource.addresses.map(sourceExternalAddress)),
    architectureNodes: sortedRecords(
      resource.architectureNodeIds.map((nodeId) => ({
        nodeId,
        targetKey: targetKeys.get(nodeId),
      })),
    ),
    behavior: resource.lifecycle.behavior,
    id: resource.id,
    lifecycleAuthority: resource.lifecycle.lifecycleAuthority,
    ownershipState: resource.lifecycle.ownershipState,
    ...(resource.resourceType === undefined
      ? {}
      : { resourceType: resource.resourceType }),
    targets: sortedRecords(resource.lifecycle.iacTargets),
  };
}

function normalizedExternalProjection(resource: NormalizedExternalResourceV1) {
  return {
    addresses: sortedRecords(resource.addresses),
    architectureNodes: sortedRecords(
      resource.architectureNodes.map(({ nodeId, targetKey }) => ({
        nodeId,
        targetKey,
      })),
    ),
    behavior: resource.behavior,
    id: resource.id,
    lifecycleAuthority: resource.lifecycleAuthority,
    ownershipState: resource.ownershipState,
    ...(resource.resourceType.length === 0
      ? {}
      : { resourceType: resource.resourceType }),
    targets: sortedRecords(resource.targets),
  };
}

function sourceOwnershipProjection(
  declaration: WorkloadV2["sourceOwnership"][number],
) {
  return {
    ...(declaration.baselineDigest === undefined
      ? {}
      : { baselineDigest: declaration.baselineDigest }),
    conflictBehavior: declaration.conflictBehavior,
    declarationId: declaration.declarationId,
    ...(declaration.extensionPointId === undefined
      ? {}
      : { extensionPointId: declaration.extensionPointId }),
    ...(declaration.semanticDiff.normalizerId === undefined
      ? {}
      : {
          normalizerId: declaration.semanticDiff.normalizerId,
          normalizerVersion: declaration.semanticDiff.normalizerVersion,
        }),
    ownerId: declaration.ownerId,
    ownership: declaration.ownership,
    path: declaration.path,
    pathKind: declaration.pathKind,
    regeneration: declaration.regeneration,
    semanticDiff: declaration.semanticDiff.strategy,
  };
}

function normalizedOwnershipProjection(
  declaration: NormalizedSolutionV1["workloads"][number]["sourceOwnership"][number],
) {
  return {
    ...(declaration.baselineDigest === undefined
      ? {}
      : { baselineDigest: declaration.baselineDigest }),
    conflictBehavior: declaration.conflictBehavior,
    declarationId: declaration.declarationId,
    ...(declaration.extensionPointId === undefined
      ? {}
      : { extensionPointId: declaration.extensionPointId }),
    ...(declaration.normalizerId === undefined
      ? {}
      : {
          normalizerId: declaration.normalizerId,
          normalizerVersion: declaration.normalizerVersion,
        }),
    ownerId: declaration.ownerId,
    ownership: declaration.ownership,
    path: declaration.path,
    pathKind: declaration.pathKind,
    regeneration: declaration.regeneration,
    semanticDiff: declaration.semanticDiff,
  };
}

function elementOwnership(value: string): ConformanceFactV1["ownership"] {
  return value === "generated" || value === "cloudmarkup"
    ? "generated"
    : value === "approved-extension"
      ? "user-extension"
      : value === "external" || value === "external-artifact"
        ? "imported"
        : value === "unknown-unresolved"
          ? "unknown"
          : "user-owned";
}

function externalManagement(value: string): ConformanceFactV1["management"] {
  return value === "managed-by-generated-iac"
    ? "managed"
    : value === "unknown-unresolved"
      ? "unknown"
      : "external";
}

function externalOwnership(value: string): ConformanceFactV1["ownership"] {
  return value === "managed-by-generated-iac"
    ? "generated"
    : value === "unknown-unresolved"
      ? "unknown"
      : "imported";
}

const semanticBasisByKind = {
  artifact: "artifact-binding",
  "application-contract": "application-contract-intent",
  configuration: "configuration-intent",
  connection: "connection-intent",
  "external-resource": "external-resource-intent",
  "iam-policy": "iam-policy-intent",
  "network-exposure": "network-exposure-intent",
  "repository-file": "repository-file-bytes",
  resource: "resource-intent",
  "source-ownership": "source-ownership-intent",
} as const;

function fact(input: {
  readonly applicationBinding?: ConformanceFactV1["applicationBinding"];
  readonly applicationBindingDigest?: string | undefined;
  readonly applicationContractDigest?: string | undefined;
  readonly evidenceIds: readonly string[];
  readonly extensionPoint?: boolean;
  readonly iamAccess?: ConformanceFactV1["iamAccess"];
  readonly iamPermissions?: ConformanceFactV1["iamPermissions"];
  readonly kind: ConformanceFactV1["subject"]["kind"];
  readonly layer: "designed" | "generated";
  readonly management?: ConformanceFactV1["management"];
  readonly mappedReference?: unknown;
  readonly ownership?: ConformanceFactV1["ownership"];
  readonly publicExposure?: ConformanceFactV1["publicExposure"];
  readonly semanticCoverage?: ConformanceFactV1["semanticComparison"]["coverage"];
  readonly semanticDigest: string;
  readonly sourceIds: readonly string[];
  readonly sourceLocations?: readonly { readonly path: string }[];
  readonly stableKey: string;
}): ConformanceFactV1 {
  return conformanceFactV1Schema.parse({
    applicationBinding: input.applicationBinding ?? "not-applicable",
    ...(input.applicationBindingDigest === undefined
      ? {}
      : { applicationBindingDigest: input.applicationBindingDigest }),
    ...(input.applicationContractDigest === undefined
      ? {}
      : { applicationContractDigest: input.applicationContractDigest }),
    evidenceIds: input.evidenceIds,
    extensionPoint: input.extensionPoint ?? false,
    factId: stableId(
      `${input.layer}-fact`,
      hashCanonicalValue({ kind: input.kind, stableKey: input.stableKey }),
    ),
    iamAccess: input.iamAccess ?? "not-applicable",
    iamPermissions: input.iamPermissions ?? [],
    layer: input.layer,
    management: input.management ?? "managed",
    operation: "none",
    ownership: input.ownership ?? "unknown",
    publicExposure: input.publicExposure ?? "unknown",
    semanticComparison: {
      basis: semanticBasisByKind[input.kind],
      contractVersion: 1,
      coverage: input.semanticCoverage ?? "complete",
    },
    semanticDigest: input.semanticDigest,
    sourceIds: input.sourceIds,
    sourceLocations: input.sourceLocations ?? [],
    subject: {
      kind: input.kind,
      ...(input.mappedReference === undefined
        ? {}
        : { mappedReference: input.mappedReference }),
      stableKey: input.stableKey,
    },
  });
}

function explicitConfigurationExposure(configuration: {
  readonly values: Readonly<Record<string, unknown>>;
}): ConformanceFactV1["publicExposure"] | undefined {
  return getReviewedPublicExposureV1(configuration);
}

function networkExposureFact(input: {
  readonly evidenceId: string;
  readonly layer: "designed" | "generated";
  readonly mappedReference: unknown;
  readonly ownership: ConformanceFactV1["ownership"];
  readonly resourceId: string;
  readonly sourceId: string;
  readonly configuration: {
    readonly values: Readonly<Record<string, unknown>>;
  };
}): ConformanceFactV1 | undefined {
  const publicExposure = explicitConfigurationExposure(input.configuration);
  if (publicExposure === undefined) return undefined;
  return fact({
    evidenceIds: [input.evidenceId],
    kind: "network-exposure",
    layer: input.layer,
    mappedReference: input.mappedReference,
    ownership: input.ownership,
    publicExposure,
    semanticDigest: hashCanonicalValue({ publicExposure }),
    sourceIds: [input.sourceId],
    stableKey: `${input.resourceId}.network`,
  });
}

function generatedPolicyFacts(
  input: GeneratedConformanceSourceInputV1,
  compilation: ReturnType<typeof validateGeneratedBindings>["compilation"],
  compilerSourceId: string,
): ConformanceFactV1[] {
  const policies = compilation.artifact.policyArtifacts ?? [];
  const groups = new Map<string, typeof policies>();
  for (const policy of policies) {
    const attachment = compilation.model.policyAttachments.find(
      ({ resourceId }) => resourceId === policy.policyDocumentId,
    );
    if (attachment === undefined)
      fail("policy-artifact-model-binding-mismatch");
    const existing = groups.get(policy.ownerNodeId) ?? [];
    groups.set(policy.ownerNodeId, [...existing, policy]);
  }
  return [...groups.entries()].map(([ownerNodeId, records]) => {
    const projection = sortedRecords(
      records.map((policy) => ({
        ownerNodeId: policy.ownerNodeId,
        ownership: policy.ownership,
        policyDocumentId: policy.policyDocumentId,
        policyKind: policy.policyKind,
        ...(policy.provenance === undefined
          ? {}
          : {
              provenance: {
                dependentEdgeIds: sortedStrings(
                  policy.provenance.dependentEdgeIds,
                ),
                dependentNodeIds: sortedStrings(
                  policy.provenance.dependentNodeIds ?? [],
                ),
                generatorId: policy.provenance.generatorId,
                generatorKind: policy.provenance.generatorKind,
                generatorVersion: policy.provenance.generatorVersion,
                operationId: policy.provenance.operationId,
              },
            }),
      })),
    );
    return fact({
      evidenceIds: [input.compilerEvidenceId],
      iamAccess: "unknown",
      kind: "iam-policy",
      layer: "generated",
      mappedReference: { kind: "architecture-node", nodeId: ownerNodeId },
      ownership: "generated",
      publicExposure: "none",
      semanticDigest: hashCanonicalValue(projection),
      sourceIds: [compilerSourceId],
      stableKey: `${ownerNodeId}.iam`,
    });
  });
}

function contractReferences(
  workloads: readonly WorkloadV2[],
): ReadonlyMap<string, ReadonlySet<string>> {
  const workloadIdsByContract = new Map<string, Set<string>>();
  const visit = (value: unknown, workloadId: string): void => {
    if (Array.isArray(value)) {
      value.forEach((entry) => {
        visit(entry, workloadId);
      });
      return;
    }
    if (typeof value !== "object" || value === null) return;
    const record = value as Record<string, unknown>;
    if (
      typeof record["contractId"] === "string" &&
      typeof record["contractVersion"] === "string" &&
      typeof record["digest"] === "string"
    ) {
      const key = `${record["contractId"]}:${record["contractVersion"]}`;
      const existing = workloadIdsByContract.get(key) ?? new Set<string>();
      existing.add(workloadId);
      workloadIdsByContract.set(key, existing);
    }
    Object.values(record).forEach((entry) => {
      visit(entry, workloadId);
    });
  };
  workloads.forEach((workload) => {
    visit(workload, workload.id);
  });
  return workloadIdsByContract;
}

function contractBindingDigest(
  record: ApplicationContractRecordV1,
  references: ReadonlyMap<string, ReadonlySet<string>>,
) {
  return hashCanonicalValue({
    contractId: record.contractId,
    contractVersion: record.contractVersion,
    workloadIds: sortedStrings([
      ...(references.get(`${record.contractId}:${record.contractVersion}`) ??
        new Set<string>()),
    ]),
  });
}

function applicationArtifactBindingProjection(workload: WorkloadV2) {
  return {
    implementation: workload.implementation,
    workloadId: workload.id,
  };
}

function validateSourceBindings(sources: ConformanceSourceBundleV1): void {
  const architecture = sources.architectureDocument;
  const revision = sources.solutionRevision;
  if (
    !canonicalEqual(architecture.workloadBehavior, sources.workloadBehavior) ||
    !canonicalEqual(
      architecture.applicationContracts,
      sources.applicationContracts,
    ) ||
    !canonicalEqual(architecture.externalResources, sources.externalResources)
  ) {
    fail("source-envelope-mismatch");
  }
  const architectureHashes = getArchitectureDocumentHashes(architecture);
  const recordHashes = architecture.applicationContracts.contracts
    .map(getApplicationContractRecordContentHash)
    .sort(compareUtf16);
  if (
    revision.architecture.revisionId !== architecture.revision.revisionId ||
    revision.architecture.contentHash !== architectureHashes.contentHash ||
    revision.architecture.documentHash !==
      getArchitectureDocumentCanonicalHash(architecture) ||
    revision.architecture.visualHash !== architectureHashes.visualHash ||
    revision.workload.contentHash !==
      getWorkloadBehaviorContentHash(sources.workloadBehavior) ||
    revision.contracts.contentHash !==
      getApplicationContractsContentHash(sources.applicationContracts) ||
    revision.externalResources.contentHash !==
      getExternalResourceReferenceContentHash(sources.externalResources) ||
    !canonicalEqual(
      sortedStrings(revision.contracts.recordHashes),
      recordHashes,
    ) ||
    revision.versions.catalog.id !== architecture.catalog.id ||
    revision.versions.catalog.version !== architecture.catalog.version ||
    revision.versions.catalog.digest !== architecture.catalog.digest
  ) {
    fail("solution-revision-source-binding-mismatch");
  }
}

function validateUniqueIds(values: readonly string[], code: string): void {
  if (new Set(values).size !== values.length) fail(code);
}
function validateUniquePortablePaths(
  values: readonly string[],
  code: string,
): void {
  const keys = values.map((value) => value.normalize("NFC").toLowerCase());
  if (new Set(keys).size !== keys.length) fail(code);
}

function validateGeneratedBindings(input: GeneratedConformanceSourceInputV1): {
  readonly compilation: GoCompilationResultV1 & {
    readonly artifact: NonNullable<GoCompilationResultV1["artifact"]>;
    readonly model: NonNullable<GoCompilationResultV1["model"]>;
  };
} {
  const { compilation, sources } = input;
  const compilerPin = sources.solutionRevision.versions.compiler;
  if (
    compilation.artifact === undefined ||
    compilation.model === undefined ||
    compilation.diagnostics?.some(({ severity }) => severity === "error") ===
      true ||
    compilerPin.state !== "pinned" ||
    !canonicalEqual(compilation.compiler, compilerPin.tool)
  ) {
    fail("compiler-binding-mismatch");
  }
  const model = compilation.model;
  const artifact = compilation.artifact;
  if (
    model.target.target !== artifact.target ||
    !model.target.renderingAvailable
  ) {
    fail("compiler-target-binding-mismatch");
  }
  const expectedProvenance = {
    architectureContentHash: sources.solutionRevision.architecture.contentHash,
    architectureDocumentHash:
      sources.solutionRevision.architecture.documentHash,
    architectureDocumentId: sources.architectureDocument.documentId,
    architectureId: sources.architectureDocument.architectureId,
    architectureRevisionId: sources.architectureDocument.revision.revisionId,
    architectureVisualHash: sources.solutionRevision.architecture.visualHash,
    catalog: sources.architectureDocument.catalog,
    providerId: sources.architectureDocument.provider.id,
    region: sources.architectureDocument.provider.region,
    solutionRevisionId: sources.solutionRevision.solutionRevisionId,
    workloadContentHash: sources.solutionRevision.workload.contentHash,
  };
  if (
    !canonicalEqual(model.provenance, expectedProvenance) ||
    !canonicalEqual(artifact.provenance, expectedProvenance)
  ) {
    fail("compiler-source-binding-mismatch");
  }
  const request = input.applicationGeneration.request;
  if (
    !canonicalEqual(
      request.architectureDocument,
      sources.architectureDocument,
    ) ||
    !canonicalEqual(request.workloadBehavior, sources.workloadBehavior) ||
    !canonicalEqual(request.solutionRevision, sources.solutionRevision) ||
    !canonicalEqual(request.normalizedSolution, model)
  ) {
    fail("application-request-source-binding-mismatch");
  }
  const regenerated = generateApplication(request);
  if (!canonicalEqual(regenerated, input.applicationGeneration.result)) {
    fail("application-generation-binding-mismatch");
  }
  if (
    regenerated.artifact.diagnostics.some(
      ({ severity }) => severity === "error",
    )
  ) {
    fail("application-generation-unsuccessful");
  }

  const targetKeys = assignStableTargetKeys(sources);
  validateUniquePortablePaths(
    artifact.files?.map(({ path }) => path) ?? [],
    "compiler-artifact-path-duplicate",
  );
  validateUniquePortablePaths(
    regenerated.artifact.sourceFiles.map(({ path }) => path),
    "application-source-path-duplicate",
  );
  validateUniquePortablePaths(
    [
      ...(artifact.files?.map(({ path }) => path) ?? []),
      ...regenerated.artifact.sourceFiles
        .filter(({ ownership }) => ownership === "generated")
        .map(({ path }) => path),
    ],
    "generated-repository-file-path-collision",
  );
  validateUniquePortablePaths(
    (artifact.applicationArtifacts ?? []).flatMap((application) =>
      application.contractVersion === 2
        ? [application.expectedArtifact.path]
        : [],
    ),
    "application-artifact-path-duplicate",
  );

  const resourcesById = new Map(
    model.resources.map((value) => [value.id, value]),
  );
  const connectionsById = new Map(
    model.connections.map((value) => [value.id, value]),
  );
  const workloadsById = new Map(
    model.workloads.map((value) => [value.id, value]),
  );
  const variablesById = new Map(
    model.variables.map((value) => [value.id, value]),
  );
  const outputsById = new Map(model.outputs.map((value) => [value.id, value]));
  const externalById = new Map(
    model.externalResources.map((value) => [value.id, value]),
  );
  validateUniqueIds(
    model.resources.map(({ id }) => id),
    "compiler-resource-id-duplicate",
  );
  validateUniqueIds(
    model.connections.map(({ id }) => id),
    "compiler-connection-id-duplicate",
  );
  validateUniqueIds(
    model.workloads.map(({ id }) => id),
    "compiler-workload-id-duplicate",
  );
  validateUniqueIds(
    model.variables.map(({ id }) => id),
    "compiler-variable-id-duplicate",
  );
  validateUniqueIds(
    model.outputs.map(({ id }) => id),
    "compiler-output-id-duplicate",
  );
  validateUniqueIds(
    model.externalResources.map(({ id }) => id),
    "compiler-external-id-duplicate",
  );
  if (
    resourcesById.size !== sources.architectureDocument.nodes.length ||
    connectionsById.size !== sources.architectureDocument.edges.length ||
    workloadsById.size !== sources.workloadBehavior.workloads.length ||
    variablesById.size !== sources.architectureDocument.variables.length ||
    outputsById.size !== sources.architectureDocument.outputs.length ||
    externalById.size !== sources.externalResources.resources.length
  ) {
    fail("compiler-source-set-mismatch");
  }
  for (const node of sources.architectureDocument.nodes) {
    const normalized = resourcesById.get(node.id);
    if (
      normalized === undefined ||
      !canonicalEqual(
        architectureResourceProjection(sources, node, targetKeys),
        normalizedResourceProjection(normalized),
      )
    ) {
      fail("compiler-resource-binding-mismatch");
    }
  }
  for (const edge of sources.architectureDocument.edges) {
    const normalized = connectionsById.get(edge.id);
    if (
      normalized === undefined ||
      !canonicalEqual(
        architectureConnectionProjection(edge, targetKeys),
        normalizedConnectionProjection(normalized),
      )
    ) {
      fail("compiler-connection-binding-mismatch");
    }
  }
  for (const workload of sources.workloadBehavior.workloads) {
    const normalized = workloadsById.get(workload.id);
    if (
      normalized === undefined ||
      !canonicalEqual(normalized.specification, workload)
    ) {
      fail("compiler-workload-binding-mismatch");
    }
    const expectedOwnership = sortedRecords(
      workload.sourceOwnership.map(sourceOwnershipProjection),
    );
    if (
      !canonicalEqual(
        expectedOwnership,
        sortedRecords(
          normalized.sourceOwnership.map(normalizedOwnershipProjection),
        ),
      )
    ) {
      fail("compiler-ownership-binding-mismatch");
    }
  }
  for (const variable of sources.architectureDocument.variables) {
    const normalized = variablesById.get(variable.id);
    if (
      normalized === undefined ||
      !canonicalEqual(
        architectureVariableProjection(variable),
        normalizedVariableProjection(normalized),
      )
    ) {
      fail("compiler-variable-binding-mismatch");
    }
  }
  for (const output of sources.architectureDocument.outputs) {
    const normalized = outputsById.get(output.id);
    if (
      normalized === undefined ||
      !canonicalEqual(
        architectureOutputProjection(output, targetKeys),
        normalizedOutputProjection(normalized),
      )
    ) {
      fail("compiler-output-binding-mismatch");
    }
  }
  for (const external of sources.externalResources.resources) {
    const normalized = externalById.get(external.id);
    if (
      normalized === undefined ||
      !canonicalEqual(
        sourceExternalProjection(external, targetKeys),
        normalizedExternalProjection(normalized),
      )
    ) {
      fail("compiler-external-binding-mismatch");
    }
  }
  const compilerApplications = artifact.applicationArtifacts ?? [];
  validateUniqueIds(
    compilerApplications.map(({ workloadId }) => workloadId),
    "compiler-application-workload-id-duplicate",
  );
  if (compilerApplications.length !== model.workloads.length) {
    fail("compiler-application-workload-set-mismatch");
  }
  for (const workload of model.workloads) {
    const application = compilerApplications.find(
      ({ workloadId }) => workloadId === workload.id,
    );
    if (application === undefined) {
      fail("compiler-application-binding-mismatch");
    }
    if (
      application.implementationMode !== workload.implementationMode ||
      (application.inputs ?? []).some(
        ({ workloadId }) => !workloadsById.has(workloadId),
      )
    ) {
      fail("compiler-application-binding-mismatch");
    }
  }

  const policyArtifacts = artifact.policyArtifacts ?? [];
  validateUniqueIds(
    policyArtifacts.map(({ policyDocumentId }) => policyDocumentId),
    "compiler-policy-artifact-id-duplicate",
  );
  validateUniqueIds(
    model.policyAttachments.map(({ resourceId }) => resourceId),
    "compiler-policy-attachment-id-duplicate",
  );
  if (policyArtifacts.length !== model.policyAttachments.length) {
    fail("compiler-policy-artifact-set-mismatch");
  }
  for (const attachment of model.policyAttachments) {
    const policy = policyArtifacts.find(
      ({ policyDocumentId }) => policyDocumentId === attachment.resourceId,
    );
    if (policy === undefined) {
      fail("compiler-policy-artifact-binding-mismatch");
    }
    if (
      policy.ownership !== attachment.ownership ||
      !attachment.ownerReferences.some(
        ({ nodeId }) => nodeId === policy.ownerNodeId,
      ) ||
      !resourcesById.has(policy.ownerNodeId)
    ) {
      fail("compiler-policy-artifact-binding-mismatch");
    }
  }

  const appContracts = regenerated.artifact.workloadContracts;
  const appCoverage = regenerated.artifact.coverage.workloads;
  validateUniqueIds(
    appContracts.map(({ workloadId }) => workloadId),
    "application-workload-contract-id-duplicate",
  );
  if (
    appContracts.length !== sources.workloadBehavior.workloads.length ||
    appCoverage.length !== sources.workloadBehavior.workloads.length
  ) {
    fail("application-workload-set-mismatch");
  }
  for (const workload of sources.workloadBehavior.workloads) {
    const contract = appContracts.find(
      ({ workloadId }) => workloadId === workload.id,
    );
    const coverage = appCoverage.find(
      ({ workloadId }) => workloadId === workload.id,
    );
    if (
      contract === undefined ||
      coverage === undefined ||
      contract.implementationMode !== workload.implementation.mode ||
      ("handler" in contract &&
        (!("handler" in workload.implementation) ||
          contract.handler !== workload.implementation.handler)) ||
      ("runtimeFamily" in contract &&
        (!("runtimeFamily" in workload.implementation) ||
          contract.runtimeFamily !== workload.implementation.runtimeFamily))
    ) {
      fail("application-workload-binding-mismatch");
    }
  }
  const knownContractIds = new Set<string>(
    sources.applicationContracts.contracts.map(({ contractId }) => contractId),
  );
  if (
    regenerated.artifact.sourceFiles.some((file) =>
      file.provenance.contractIds.some(
        (contractId) => !knownContractIds.has(contractId),
      ),
    )
  ) {
    fail("application-contract-binding-mismatch");
  }
  return {
    compilation: {
      ...compilation,
      artifact,
      model,
    },
  };
}

function designedSources(input: DesignedConformanceSourceInputV1) {
  const { sources } = input;
  return {
    applicationSourceId: stableId(
      "designed-source.architecture",
      sources.solutionRevision.architecture.documentHash,
    ),
    architectureSourceId: stableId(
      "designed-source.architecture",
      sources.solutionRevision.architecture.documentHash,
    ),
    externalSourceId: stableId(
      "designed-source.external",
      sources.solutionRevision.externalResources.contentHash,
    ),
    workloadSourceId: stableId(
      "designed-source.workload",
      sources.solutionRevision.workload.contentHash,
    ),
  };
}

function generatedSemanticProjections(
  input: GeneratedConformanceSourceInputV1,
  compilation: ReturnType<typeof validateGeneratedBindings>["compilation"],
) {
  const targetKeys = assignStableTargetKeys(input.sources);
  const model = compilation.model;
  const application = input.applicationGeneration.result.artifact;
  const compilerProjection = {
    artifact: {
      digest: compilation.artifact.digest,
      files: sortedRecords(
        (compilation.artifact.files ?? []).map((file) => ({
          digest: file.digest,
          ownership: file.ownership,
          path: file.path,
        })),
      ),
      policyArtifacts: sortedRecords(
        (compilation.artifact.policyArtifacts ?? []).map((policy) => ({
          ownerNodeId: policy.ownerNodeId,
          ownership: policy.ownership,
          policyDocumentId: policy.policyDocumentId,
          policyKind: policy.policyKind,
          provenance: policy.provenance,
        })),
      ),
      target: compilation.artifact.target,
    },
    connections: sortedRecords(
      model.connections.map(normalizedConnectionProjection),
    ),
    externalResources: sortedRecords(
      model.externalResources.map(normalizedExternalProjection),
    ),
    outputs: sortedRecords(model.outputs.map(normalizedOutputProjection)),
    provenance: model.provenance,
    resources: sortedRecords(model.resources.map(normalizedResourceProjection)),
    variables: sortedRecords(model.variables.map(normalizedVariableProjection)),
    workloads: sortedRecords(
      model.workloads.map((workload) => ({
        id: workload.id,
        sourceOwnership: sortedRecords(
          workload.sourceOwnership.map(normalizedOwnershipProjection),
        ),
        specification: workload.specification,
      })),
    ),
  };
  const applicationProjection = {
    buildContracts: sortedRecords(application.buildContracts),
    coverage: application.coverage,
    generator: application.generator,
    pattern: application.pattern,
    runtime: application.runtime,
    sourceFiles: sortedRecords(
      application.sourceFiles.map((file) => ({
        checksum: file.checksum,
        disposition: file.disposition,
        ownership: file.ownership,
        path: file.path,
        provenance: file.provenance,
        semanticChecksum: file.semanticChecksum,
      })),
    ),
    template: application.template,
    workloadContracts: sortedRecords(application.workloadContracts),
  };
  return {
    applicationDigest: hashCanonicalValue(applicationProjection),
    applicationProjection,
    compilerDigest: hashCanonicalValue(compilerProjection),
    compilerProjection,
    targetKeys,
  };
}

function designedFacts(
  input: DesignedConformanceSourceInputV1,
): ConformanceFactV1[] {
  const { evidenceId, sources } = input;
  const sourceIds = designedSources(input);
  const targetKeys = assignStableTargetKeys(sources);
  const references = contractReferences(sources.workloadBehavior.workloads);
  const facts: ConformanceFactV1[] = [];
  sources.architectureDocument.nodes.forEach((node) => {
    facts.push(
      fact({
        evidenceIds: [evidenceId],
        kind: "resource",
        layer: "designed",
        mappedReference: { kind: "architecture-node", nodeId: node.id },
        ownership: elementOwnership(node.semantic.lifecycle.ownership),
        semanticDigest: hashCanonicalValue(
          architectureResourceProjection(sources, node, targetKeys),
        ),
        sourceIds: [sourceIds.architectureSourceId],
        stableKey: node.id,
      }),
    );
    const exposure = networkExposureFact({
      configuration: node.semantic.configuration,
      evidenceId,
      layer: "designed",
      mappedReference: { kind: "architecture-node", nodeId: node.id },
      ownership: elementOwnership(node.semantic.lifecycle.ownership),
      resourceId: node.id,
      sourceId: sourceIds.architectureSourceId,
    });
    if (exposure !== undefined) facts.push(exposure);
  });
  sources.architectureDocument.edges.forEach((edge) => {
    facts.push(
      fact({
        evidenceIds: [evidenceId],
        kind: "connection",
        layer: "designed",
        mappedReference: { edgeId: edge.id, kind: "architecture-edge" },
        ownership: elementOwnership(edge.semantic.lifecycle.ownership),
        semanticDigest: hashCanonicalValue(
          architectureConnectionProjection(edge, targetKeys),
        ),
        sourceIds: [sourceIds.architectureSourceId],
        stableKey: edge.id,
      }),
    );
  });
  sources.architectureDocument.variables.forEach((variable) => {
    facts.push(
      fact({
        evidenceIds: [evidenceId],
        kind: "configuration",
        layer: "designed",
        ownership: "user-owned",
        semanticDigest: hashCanonicalValue(
          architectureVariableProjection(variable),
        ),
        sourceIds: [sourceIds.architectureSourceId],
        stableKey: `variable:${variable.id}`,
      }),
    );
  });
  sources.architectureDocument.outputs.forEach((output) => {
    facts.push(
      fact({
        evidenceIds: [evidenceId],
        kind: "configuration",
        layer: "designed",
        ownership: "user-owned",
        semanticDigest: hashCanonicalValue(
          architectureOutputProjection(output, targetKeys),
        ),
        sourceIds: [sourceIds.architectureSourceId],
        stableKey: `output:${output.id}`,
      }),
    );
  });
  sources.workloadBehavior.workloads.forEach((workload) => {
    const bindingProjection = applicationArtifactBindingProjection(workload);
    const referencedContracts = [...references.entries()]
      .filter(([, workloadIds]) => workloadIds.has(workload.id))
      .map(([key]) => key)
      .sort(compareUtf16);
    facts.push(
      fact({
        evidenceIds: [evidenceId],
        kind: "application-contract",
        layer: "designed",
        mappedReference: { kind: "workload", workloadId: workload.id },
        ownership: elementOwnership(
          "sourceOwnership" in workload.implementation
            ? workload.implementation.sourceOwnership
            : workload.implementation.mode,
        ),
        semanticDigest: hashCanonicalValue(workload),
        sourceIds: [sourceIds.workloadSourceId],
        stableKey: `workload:${workload.id}`,
      }),
      fact({
        applicationBindingDigest: hashCanonicalValue(bindingProjection),
        applicationContractDigest: hashCanonicalValue(referencedContracts),
        evidenceIds: [evidenceId],
        kind: "artifact",
        layer: "designed",
        ownership: elementOwnership(
          "sourceOwnership" in workload.implementation
            ? workload.implementation.sourceOwnership
            : workload.implementation.mode,
        ),
        semanticDigest: hashCanonicalValue(bindingProjection),
        sourceIds: [sourceIds.workloadSourceId, sourceIds.applicationSourceId],
        stableKey: `application:${workload.id}`,
      }),
    );
    workload.sourceOwnership.forEach((declaration) => {
      const ownership = elementOwnership(declaration.ownership);
      facts.push(
        fact({
          evidenceIds: [evidenceId],
          extensionPoint: ownership === "user-extension",
          kind: "source-ownership",
          layer: "designed",
          mappedReference: {
            kind: "repository-location",
            location: { path: declaration.path },
          },
          ownership,
          semanticDigest: hashCanonicalValue(
            sourceOwnershipProjection(declaration),
          ),
          sourceIds: [sourceIds.workloadSourceId],
          sourceLocations: [{ path: declaration.path }],
          stableKey: `ownership:${declaration.declarationId}`,
        }),
      );
    });
  });
  sources.applicationContracts.contracts.forEach((record) => {
    const contentHash = getApplicationContractRecordContentHash(record);
    facts.push(
      fact({
        applicationBindingDigest: contractBindingDigest(record, references),
        applicationContractDigest: contentHash,
        evidenceIds: [evidenceId],
        kind: "application-contract",
        layer: "designed",
        ownership:
          record.provenance.source === "deterministic-generator"
            ? "generated"
            : "user-owned",
        semanticDigest: contentHash,
        sourceIds: [sourceIds.applicationSourceId],
        stableKey: `${record.contractId}:${record.contractVersion}`,
      }),
    );
  });
  sources.externalResources.resources.forEach((resource) => {
    facts.push(
      fact({
        evidenceIds: [evidenceId],
        kind: "external-resource",
        layer: "designed",
        management: externalManagement(resource.lifecycle.ownershipState),
        mappedReference: {
          externalResourceId: resource.id,
          kind: "external-resource",
        },
        ownership: externalOwnership(resource.lifecycle.ownershipState),
        semanticDigest: hashCanonicalValue(
          sourceExternalProjection(resource, targetKeys),
        ),
        sourceIds: [sourceIds.externalSourceId],
        stableKey: resource.id,
      }),
    );
  });
  return facts.sort((left, right) =>
    compareUtf16(
      `${left.subject.kind}\u0000${left.subject.stableKey}`,
      `${right.subject.kind}\u0000${right.subject.stableKey}`,
    ),
  );
}

function applicationBindingState(
  workload: WorkloadV2,
  input: GeneratedConformanceSourceInputV1,
): ConformanceFactV1["applicationBinding"] {
  if (workload.implementation.mode === "infrastructure-only") {
    return "not-applicable";
  }
  const contract =
    input.applicationGeneration.result.artifact.workloadContracts.find(
      ({ workloadId }) => workloadId === workload.id,
    );
  const coverage =
    input.applicationGeneration.result.artifact.coverage.workloads.find(
      ({ workloadId }) => workloadId === workload.id,
    );
  if (
    contract === undefined ||
    coverage === undefined ||
    ("readiness" in contract && contract.readiness === "generation-blocked") ||
    coverage.state === "target-unsupported"
  ) {
    return "mismatch";
  }
  return workload.implementation.mode === "user-provided" ||
    workload.implementation.mode === "ai-assisted-custom" ||
    workload.implementation.mode === "external-artifact"
    ? "unknown"
    : "matching";
}

function generatedFacts(
  input: GeneratedConformanceSourceInputV1,
  compilation: ReturnType<typeof validateGeneratedBindings>["compilation"],
  projections: ReturnType<typeof generatedSemanticProjections>,
): ConformanceFactV1[] {
  const { sources } = input;
  const model = compilation.model;
  const compilerSourceId = stableId(
    "generated-source.compiler",
    projections.compilerDigest,
  );
  const applicationSourceId = stableId(
    "generated-source.application",
    projections.applicationDigest,
  );
  const references = contractReferences(sources.workloadBehavior.workloads);
  const facts: ConformanceFactV1[] = [];
  model.resources.forEach((resource) => {
    facts.push(
      fact({
        evidenceIds: [input.compilerEvidenceId],
        kind: "resource",
        layer: "generated",
        mappedReference: { kind: "architecture-node", nodeId: resource.id },
        ownership: elementOwnership(resource.lifecycle.ownership),
        semanticDigest: hashCanonicalValue(
          normalizedResourceProjection(resource),
        ),
        sourceIds: [compilerSourceId],
        stableKey: resource.id,
      }),
    );
    const exposure = networkExposureFact({
      configuration: resource.configuration,
      evidenceId: input.compilerEvidenceId,
      layer: "generated",
      mappedReference: { kind: "architecture-node", nodeId: resource.id },
      ownership: elementOwnership(resource.lifecycle.ownership),
      resourceId: resource.id,
      sourceId: compilerSourceId,
    });
    if (exposure !== undefined) facts.push(exposure);
  });
  facts.push(...generatedPolicyFacts(input, compilation, compilerSourceId));
  model.connections.forEach((connection) => {
    facts.push(
      fact({
        evidenceIds: [input.compilerEvidenceId],
        kind: "connection",
        layer: "generated",
        mappedReference: {
          edgeId: connection.id,
          kind: "architecture-edge",
        },
        ownership: elementOwnership(connection.lifecycle.ownership),
        semanticDigest: hashCanonicalValue(
          normalizedConnectionProjection(connection),
        ),
        sourceIds: [compilerSourceId],
        stableKey: connection.id,
      }),
    );
  });
  model.variables.forEach((variable) => {
    facts.push(
      fact({
        evidenceIds: [input.compilerEvidenceId],
        kind: "configuration",
        layer: "generated",
        ownership: "generated",
        semanticDigest: hashCanonicalValue(
          normalizedVariableProjection(variable),
        ),
        sourceIds: [compilerSourceId],
        stableKey: `variable:${variable.id}`,
      }),
    );
  });
  model.outputs.forEach((output) => {
    facts.push(
      fact({
        evidenceIds: [input.compilerEvidenceId],
        kind: "configuration",
        layer: "generated",
        ownership: "generated",
        semanticDigest: hashCanonicalValue(normalizedOutputProjection(output)),
        sourceIds: [compilerSourceId],
        stableKey: `output:${output.id}`,
      }),
    );
  });
  model.workloads.forEach((normalized) => {
    const workload = sources.workloadBehavior.workloads.find(
      ({ id }) => id === normalized.id,
    );
    if (workload === undefined) fail("generated-workload-source-missing");
    const bindingProjection = applicationArtifactBindingProjection(workload);
    const bindingState = applicationBindingState(workload, input);
    const referencedContracts = [...references.entries()]
      .filter(([, workloadIds]) => workloadIds.has(workload.id))
      .map(([key]) => key)
      .sort(compareUtf16);
    const applicationContract =
      input.applicationGeneration.result.artifact.workloadContracts.find(
        ({ workloadId }) => workloadId === workload.id,
      );
    const artifactId =
      applicationContract === undefined
        ? undefined
        : "expectedArtifact" in applicationContract
          ? applicationContract.expectedArtifact.path
          : "artifact" in applicationContract
            ? applicationContract.artifact.artifactId
            : undefined;
    facts.push(
      fact({
        evidenceIds: [input.compilerEvidenceId],
        kind: "application-contract",
        layer: "generated",
        mappedReference: { kind: "workload", workloadId: normalized.id },
        ownership: elementOwnership(
          normalized.sourceOwner ?? normalized.implementationMode,
        ),
        semanticDigest: hashCanonicalValue(normalized.specification),
        sourceIds: [compilerSourceId],
        stableKey: `workload:${normalized.id}`,
      }),
      fact({
        applicationBinding: bindingState,
        applicationBindingDigest: hashCanonicalValue(bindingProjection),
        applicationContractDigest: hashCanonicalValue(referencedContracts),
        evidenceIds: [input.applicationEvidenceId],
        kind: "artifact",
        layer: "generated",
        ...(artifactId === undefined
          ? {}
          : {
              mappedReference: {
                artifactId: stableId(
                  "application-artifact",
                  hashCanonicalValue(artifactId),
                ),
                kind: "artifact",
              },
            }),
        ownership: elementOwnership(
          normalized.sourceOwner ?? normalized.implementationMode,
        ),
        semanticCoverage: bindingState === "unknown" ? "partial" : "complete",
        semanticDigest: hashCanonicalValue(bindingProjection),
        sourceIds: [applicationSourceId],
        stableKey: `application:${normalized.id}`,
      }),
    );
    normalized.sourceOwnership.forEach((declaration) => {
      const ownership = elementOwnership(declaration.ownership);
      facts.push(
        fact({
          evidenceIds: [input.compilerEvidenceId],
          extensionPoint: ownership === "user-extension",
          kind: "source-ownership",
          layer: "generated",
          mappedReference: {
            kind: "repository-location",
            location: { path: declaration.path },
          },
          ownership,
          semanticDigest: hashCanonicalValue(
            normalizedOwnershipProjection(declaration),
          ),
          sourceIds: [compilerSourceId],
          sourceLocations: [{ path: declaration.path }],
          stableKey: `ownership:${declaration.declarationId}`,
        }),
      );
    });
  });
  sources.applicationContracts.contracts.forEach((record) => {
    const contentHash = getApplicationContractRecordContentHash(record);
    const referenced = references.has(
      `${record.contractId}:${record.contractVersion}`,
    );
    facts.push(
      fact({
        applicationBinding: referenced ? "matching" : "not-applicable",
        applicationBindingDigest: contractBindingDigest(record, references),
        applicationContractDigest: contentHash,
        evidenceIds: [input.applicationEvidenceId],
        kind: "application-contract",
        layer: "generated",
        ownership: "generated",
        semanticDigest: contentHash,
        sourceIds: [applicationSourceId],
        stableKey: `${record.contractId}:${record.contractVersion}`,
      }),
    );
  });
  model.externalResources.forEach((resource) => {
    facts.push(
      fact({
        evidenceIds: [input.compilerEvidenceId],
        kind: "external-resource",
        layer: "generated",
        management: externalManagement(resource.ownershipState),
        mappedReference: {
          externalResourceId: resource.id,
          kind: "external-resource",
        },
        ownership: externalOwnership(resource.ownershipState),
        semanticDigest: hashCanonicalValue(
          normalizedExternalProjection(resource),
        ),
        sourceIds: [compilerSourceId],
        stableKey: resource.id,
      }),
    );
  });
  const repositoryFiles = new Map<
    string,
    {
      readonly checksum: string;
      readonly evidenceId: string;
      readonly sourceId: string;
    }
  >();
  const registerRepositoryFile = (
    path: string,
    checksum: string,
    evidenceId: string,
    sourceId: string,
  ): void => {
    if (repositoryFiles.has(path)) {
      fail("generated-repository-file-path-collision");
    }
    repositoryFiles.set(path, { checksum, evidenceId, sourceId });
  };
  input.applicationGeneration.result.artifact.sourceFiles
    .filter(({ ownership }) => ownership === "generated")
    .forEach((file) => {
      registerRepositoryFile(
        file.path,
        file.checksum,
        input.applicationEvidenceId,
        applicationSourceId,
      );
    });
  (compilation.artifact.files ?? []).forEach((file) => {
    registerRepositoryFile(
      file.path,
      file.digest,
      input.compilerEvidenceId,
      compilerSourceId,
    );
  });
  [...repositoryFiles.entries()]
    .sort(([left], [right]) => compareUtf16(left, right))
    .forEach(([path, file]) => {
      const stableKey = stableId("repository-file", hashCanonicalValue(path));
      facts.push(
        fact({
          evidenceIds: [file.evidenceId],
          kind: "repository-file",
          layer: "generated",
          mappedReference: {
            kind: "repository-location",
            location: { path },
          },
          ownership: "generated",
          semanticDigest: file.checksum,
          sourceIds: [file.sourceId],
          sourceLocations: [{ path }],
          stableKey,
        }),
      );
    });
  return facts.sort((left, right) =>
    compareUtf16(
      `${left.subject.kind}\u0000${left.subject.stableKey}`,
      `${right.subject.kind}\u0000${right.subject.stableKey}`,
    ),
  );
}

export function projectApprovedDesignToConformanceLayerInputV1(
  value: unknown,
): ConformanceLayerInputV1 {
  const parsed = designedConformanceSourceInputV1Schema.safeParse(value);
  if (!parsed.success) fail("designed-source-input-invalid");
  const input = parsed.data;
  validateSourceBindings(input.sources);
  const sourceIds = designedSources(input);
  const revision = input.sources.solutionRevision;
  return conformanceLayerInputV1Schema.parse({
    availability: "available",
    boundSolutionRevision: {
      digest: revisionDigest(revision),
      id: revision.solutionRevisionId,
    },
    completeness: "complete",
    declaredFreshness: "current",
    evidenceIds: [input.evidenceId],
    evidenceType: "approved-documents",
    facts: designedFacts(input),
    integrity: "verified",
    layer: "designed",
    sources: [
      {
        digest: revision.architecture.documentHash,
        kind: "architecture-document",
        observedAt: input.sources.architectureDocument.revision.createdAt,
        solutionRevisionId: revision.solutionRevisionId,
        sourceId: sourceIds.architectureSourceId,
      },
      {
        digest: revision.externalResources.contentHash,
        kind: "external-resource-document",
        observedAt: input.sources.externalResources.revision.createdAt,
        solutionRevisionId: revision.solutionRevisionId,
        sourceId: sourceIds.externalSourceId,
      },
      {
        digest: revision.workload.contentHash,
        kind: "workload-document",
        observedAt: input.sources.architectureDocument.revision.createdAt,
        solutionRevisionId: revision.solutionRevisionId,
        sourceId: sourceIds.workloadSourceId,
      },
    ],
    verifiedAt: input.verifiedAt,
  });
}

export function projectGeneratedSolutionToConformanceLayerInputV1(
  value: unknown,
): ConformanceLayerInputV1 {
  const parsed = generatedConformanceSourceInputV1Schema.safeParse(value);
  if (!parsed.success) fail("generated-source-input-invalid");
  const input = parsed.data;
  validateSourceBindings(input.sources);
  const { compilation } = validateGeneratedBindings(input);
  const projections = generatedSemanticProjections(input, compilation);
  const compilerSourceId = stableId(
    "generated-source.compiler",
    projections.compilerDigest,
  );
  const applicationSourceId = stableId(
    "generated-source.application",
    projections.applicationDigest,
  );
  const revision = input.sources.solutionRevision;
  return conformanceLayerInputV1Schema.parse({
    availability: "available",
    boundSolutionRevision: {
      digest: revisionDigest(revision),
      id: revision.solutionRevisionId,
    },
    completeness: "complete",
    declaredFreshness: "current",
    evidenceIds: [input.applicationEvidenceId, input.compilerEvidenceId],
    evidenceType: "generated-manifest",
    facts: generatedFacts(input, compilation, projections),
    integrity: "verified",
    layer: "generated",
    sources: [
      {
        digest: projections.applicationDigest,
        kind: "generated-manifest",
        observedAt: input.verifiedAt,
        solutionRevisionId: revision.solutionRevisionId,
        sourceId: applicationSourceId,
        tool: input.applicationGeneration.result.artifact.generator,
      },
      {
        digest: projections.compilerDigest,
        kind: "generated-manifest",
        observedAt: input.verifiedAt,
        solutionRevisionId: revision.solutionRevisionId,
        sourceId: compilerSourceId,
        tool: compilation.compiler,
      },
    ],
    verifiedAt: input.verifiedAt,
  });
}

export type {
  DesignedConformanceSourceInputV1,
  GeneratedConformanceSourceInputV1,
};
