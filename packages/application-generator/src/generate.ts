import { emitHttpNoContentSource } from "./http-no-content-source-emitter.js";
import {
  isHttpNoContentWorkload,
  type ResolvedApplicationWorkload,
} from "./http-no-content-types.js";
import {
  getApplicationContractRecordContentHash,
  getApplicationContractsContentHash,
  getArchitectureDocumentContentHash,
  getSolutionRevisionManifestContentHash,
  getWorkloadBehaviorContentHash,
} from "@cloudmarkup/domain";

import {
  APPLICATION_GENERATION_V1_LIMITS,
  applicationGenerationRequestV1Schema,
  applicationGenerationResultV1Schema,
  applicationSourceFileV1Schema,
  prompt32ABuildArtifactEnvelopeV1Schema,
  type ApplicationGenerationRequestV1,
  type ApplicationGenerationResultV1,
  type ApplicationGenerationSourceReferenceV1,
  type ApplicationSourceFileV1,
  type ExistingApplicationFileV1,
  type Prompt32ABuildArtifactEnvelopeV1,
  type WorkloadV2,
} from "@cloudmarkup/schemas";

import {
  APPLICATION_RUNTIME_DIGEST,
  APPLICATION_RUNTIME_ID,
  APPLICATION_RUNTIME_VERSION,
  EVENT_APPLICATION_GENERATOR_ID,
  LAMBDA_HANDLER,
  LAMBDA_RUNTIME,
  NODE_RUNTIME_FAMILY,
  TYPESCRIPT_LANGUAGE_FAMILY,
  canonicalJson,
  portableArtifactSegment,
  sha256Digest,
} from "./constants.js";
import { emitEventApplicationSource } from "./event-source-emitter.js";
import {
  implementationModeDiagnostics,
  resolveApplicationInput,
  type ApplicationGenerationInput,
  type GenerationDiagnostic,
} from "./resolver.js";
import {
  emitApplicationSource,
  emitDeterministicFile,
  sourceDescriptor,
  type EmittedSourceFile,
  type SourceProvenance,
  type ResolvedWorkload,
} from "./source-emitter.js";

const BUILD_DEPENDENCIES = Object.freeze([
  { name: "@aws-sdk/client-dynamodb", version: "3.1101.0", kind: "runtime" },
  { name: "@types/node", version: "24.13.3", kind: "development" },
  { name: "typescript", version: "6.0.3", kind: "development" },
  { name: "vitest", version: "4.1.10", kind: "development" },
] as const);

const BUILD_TOOLCHAIN = Object.freeze([
  { id: "runtime.nodejs", version: "24.18.0", role: "runtime" },
  { id: "package-manager.pnpm", version: "11.16.0", role: "package-manager" },
  { id: "compiler.typescript", version: "6.0.3", role: "compiler" },
  { id: "test-runner.vitest", version: "4.1.10", role: "test-runner" },
  { id: "packager.cloudmarkup-lambda-zip", version: "1.0.0", role: "packager" },
] as const);

type GenerationRequirement =
  | "structural-validity"
  | "provider-architecture-validity"
  | "deterministic-infrastructure-compilation"
  | "deterministic-application-generation"
  | "ai-extension-parse-static-validity"
  | "application-build-and-tests"
  | "application-security-checks";

interface MaterializedFiles {
  readonly sourceFiles: readonly ApplicationSourceFileV1[];
  readonly diffFiles: readonly Record<string, unknown>[];
  readonly diagnostics: readonly GenerationDiagnostic[];
  readonly conflictedPaths: ReadonlySet<string>;
}

function compareUtf16(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function coordinateDigest(id: string, version: string): `sha256:${string}` {
  return sha256Digest(canonicalJson({ id, version }));
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function projectedSourceBounds(
  drafts: readonly EmittedSourceFile[],
  existingFiles: readonly ExistingApplicationFileV1[],
): { readonly bytes: number; readonly files: number } {
  const draftsByPath = new Map(
    drafts.map((draft) => [draft.path, draft] as const),
  );
  const existingByPath = new Map<string, ExistingApplicationFileV1>(
    existingFiles.map((file) => [file.path, file] as const),
  );
  const paths = new Set<string>([
    ...draftsByPath.keys(),
    ...existingFiles.map((file) => file.path),
  ]);
  let bytes = 0;
  for (const path of paths) {
    const draft = draftsByPath.get(path);
    const existing = existingByPath.get(path);
    const draftBytes = draft === undefined ? 0 : byteLength(draft.content);
    bytes +=
      existing === undefined
        ? draftBytes
        : Math.max(draftBytes, existing.sizeBytes);
  }
  return { bytes, files: paths.size };
}

function sourceBoundsExceeded(
  drafts: readonly EmittedSourceFile[],
  existingFiles: readonly ExistingApplicationFileV1[],
): boolean {
  const bounds = projectedSourceBounds(drafts, existingFiles);
  return (
    bounds.files > APPLICATION_GENERATION_V1_LIMITS.files ||
    bounds.bytes > APPLICATION_GENERATION_V1_LIMITS.artifactBytes
  );
}
function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareUtf16);
}

function sortCanonicalRecords<T>(values: readonly T[]): T[] {
  return [...values].sort((left, right) =>
    compareUtf16(canonicalJson(left), canonicalJson(right)),
  );
}

function normalizedSolutionInputDigest(
  request: ApplicationGenerationRequestV1,
): `sha256:${string}` {
  const solution = request.normalizedSolution;
  const workloads = solution.workloads.map((workload) => ({
    ...workload,
    artifactInputs: sortCanonicalRecords(workload.artifactInputs),
    artifactOutputs: sortCanonicalRecords(workload.artifactOutputs),
    downstreamActions: sortCanonicalRecords(workload.downstreamActions),
    environment: sortCanonicalRecords(workload.environment),
    extensionPoints: sortCanonicalRecords(
      workload.extensionPoints.map((point) => ({
        ...point,
        permittedOwnership: uniqueSorted(point.permittedOwnership),
      })),
    ),
    generatorReadiness: {
      ...workload.generatorReadiness,
      reasons: uniqueSorted(workload.generatorReadiness.reasons),
    },
    operations: sortCanonicalRecords(workload.operations),
    sourceOwnership: sortCanonicalRecords(workload.sourceOwnership),
    specification: {
      workloadContentHash: request.solutionRevision.workload.contentHash,
      workloadId: workload.id,
    },
    triggers: sortCanonicalRecords(workload.triggers),
  }));
  const projection = {
    ...solution,
    connections: sortCanonicalRecords(solution.connections),
    externalResources: sortCanonicalRecords(
      solution.externalResources.map((resource) => ({
        ...resource,
        addresses: sortCanonicalRecords(resource.addresses),
        architectureNodes: sortCanonicalRecords(resource.architectureNodes),
        targets: sortCanonicalRecords(resource.targets),
      })),
    ),
    outputs: sortCanonicalRecords(solution.outputs),
    policyAttachments: sortCanonicalRecords(
      solution.policyAttachments.map((attachment) => ({
        ...attachment,
        ownerReferences: sortCanonicalRecords(attachment.ownerReferences),
      })),
    ),
    provenance: {
      ...solution.provenance,
      architectureDocumentHash: solution.provenance.architectureContentHash,
      architectureVisualHash: solution.provenance.architectureContentHash,
    },
    resources: sortCanonicalRecords(
      solution.resources.map((resource) => ({
        ...resource,
        workloadIds: uniqueSorted(resource.workloadIds),
      })),
    ),
    target: {
      ...solution.target,
      reasons: uniqueSorted(solution.target.reasons),
    },
    variables: sortCanonicalRecords(solution.variables),
    workloads: sortCanonicalRecords(workloads),
  };
  return sha256Digest(canonicalJson(projection));
}

function solutionRevisionInputDigest(request: ApplicationGenerationRequestV1) {
  const semanticArchitectureHash =
    request.solutionRevision.architecture.contentHash;
  return getSolutionRevisionManifestContentHash({
    ...request.solutionRevision,
    architecture: {
      ...request.solutionRevision.architecture,
      documentHash: semanticArchitectureHash,
      visualHash: semanticArchitectureHash,
    },
  });
}

function duplicateDraftPaths(
  drafts: readonly EmittedSourceFile[],
): readonly string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const draft of drafts) {
    if (seen.has(draft.path)) duplicates.add(draft.path);
    seen.add(draft.path);
  }
  return [...duplicates].sort(compareUtf16);
}

function runtimePin() {
  return {
    id: APPLICATION_RUNTIME_ID,
    version: APPLICATION_RUNTIME_VERSION,
    digest: APPLICATION_RUNTIME_DIGEST,
    runtimeFamily: NODE_RUNTIME_FAMILY,
    languageFamily: TYPESCRIPT_LANGUAGE_FAMILY,
    runtime: LAMBDA_RUNTIME,
    handler: LAMBDA_HANDLER,
    moduleFormat: "esm" as const,
  };
}

function parsedSourceFile(value: unknown): ApplicationSourceFileV1 {
  return applicationSourceFileV1Schema.parse(value);
}

function semanticChecksum(file: EmittedSourceFile): `sha256:${string}` {
  if (file.mediaType !== "application/json") return file.digest;
  try {
    return sha256Digest(canonicalJson(JSON.parse(file.content) as unknown));
  } catch {
    return file.digest;
  }
}

function pinProvenance(
  request: ApplicationGenerationRequestV1,
  provenance: SourceProvenance,
) {
  return {
    solutionRevisionId: request.solutionRevision.solutionRevisionId,
    generator: request.generator,
    template: request.template,
    pattern: request.pattern,
    runtime: request.runtime,
    workloadIds: uniqueSorted(provenance.workloadIds),
    operationIds: uniqueSorted(provenance.operationIds),
    contractIds: uniqueSorted(provenance.contractIds),
    edgeIds: uniqueSorted(provenance.edgeIds),
    environmentBindingIds: uniqueSorted(provenance.environmentBindingIds),
    resourceTargetKeys: uniqueSorted(provenance.resourceTargetKeys),
    extensionPointIds: uniqueSorted(provenance.extensionPointIds),
  };
}

function provenanceSourceReferences(
  provenance: SourceProvenance,
): ApplicationGenerationSourceReferenceV1[] {
  const references: ApplicationGenerationSourceReferenceV1[] = [];
  for (const workloadId of uniqueSorted(provenance.workloadIds)) {
    references.push({ document: "workload", workloadId });
  }
  for (const operationId of uniqueSorted(provenance.operationIds)) {
    references.push({ document: "workload", operationId });
  }
  for (const contractId of uniqueSorted(provenance.contractIds)) {
    references.push({ document: "architecture", contractId });
  }
  for (const edgeId of uniqueSorted(provenance.edgeIds)) {
    references.push({ document: "architecture", edgeId });
  }
  if (provenance.resourceTargetKeys.length > 0) {
    references.push({ document: "normalized-solution", path: "$.resources" });
  }
  return references.slice(0, 64);
}

function sourceReferences(
  file: EmittedSourceFile,
): ApplicationGenerationSourceReferenceV1[] {
  return provenanceSourceReferences(file.provenance);
}

function diagnosticSource(
  diagnostic: GenerationDiagnostic,
): ApplicationGenerationSourceReferenceV1 {
  const document =
    diagnostic.source.document === "normalized-model"
      ? "normalized-solution"
      : diagnostic.source.document === "application-source"
        ? "repository"
        : diagnostic.source.document;
  return {
    document,
    path: diagnostic.source.path,
    ...(diagnostic.source.nodeId === undefined
      ? {}
      : { nodeId: diagnostic.source.nodeId }),
    ...(diagnostic.source.edgeId === undefined
      ? {}
      : { edgeId: diagnostic.source.edgeId }),
    ...(diagnostic.source.workloadId === undefined
      ? {}
      : { workloadId: diagnostic.source.workloadId }),
    ...(diagnostic.source.operationId === undefined
      ? {}
      : { operationId: diagnostic.source.operationId }),
  };
}

function publicDiagnostics(diagnostics: readonly GenerationDiagnostic[]) {
  const limit = APPLICATION_GENERATION_V1_LIMITS.diagnostics;
  const selected =
    diagnostics.length <= limit
      ? diagnostics
      : [
          ...diagnostics.slice(0, limit - 1),
          {
            code: "APPLICATION_DIAGNOSTICS_TRUNCATED",
            severity: "info" as const,
            message: `Only the first ${String(limit - 1)} of ${String(diagnostics.length)} deterministic diagnostics are included.`,
            source: {
              document: "application-source" as const,
              path: "application",
            },
          },
        ];
  return selected.map((diagnostic) => ({
    code: diagnostic.code,
    severity: diagnostic.severity,
    message: diagnostic.message,
    source: diagnosticSource(diagnostic),
    related: [],
  }));
}

function preservationReferences(
  path: string,
): ApplicationGenerationSourceReferenceV1[] {
  return [{ document: "repository", path }];
}

function preservedFile(
  existing: ExistingApplicationFileV1,
  request: ApplicationGenerationRequestV1,
  draft?: EmittedSourceFile,
): ApplicationSourceFileV1 {
  return {
    path: existing.path,
    mediaType: existing.mediaType,
    checksum: existing.currentChecksum,
    semanticChecksum: existing.semanticChecksum,
    sizeBytes: existing.sizeBytes,
    disposition: "preserve",
    ownership: existing.ownership as
      "user-owned" | "ai-authored" | "approved-extension",
    provenance:
      draft === undefined
        ? {
            solutionRevisionId: request.solutionRevision.solutionRevisionId,
            generator: request.generator,
            template: request.template,
            pattern: request.pattern,
            runtime: request.runtime,
            workloadIds: [],
            operationIds: [],
            contractIds: [],
            edgeIds: [],
            environmentBindingIds: [],
            resourceTargetKeys: [],
            extensionPointIds: [],
          }
        : pinProvenance(request, draft.provenance),
    sourceReferences:
      draft === undefined
        ? preservationReferences(existing.path)
        : [
            ...sourceReferences(draft),
            ...preservationReferences(existing.path),
          ].slice(0, 64),
  };
}

function materialize(
  drafts: readonly EmittedSourceFile[],
  existingFiles: readonly ExistingApplicationFileV1[],
  request: ApplicationGenerationRequestV1,
  includeOrphans: boolean,
): MaterializedFiles {
  const existingByPath = new Map<string, ExistingApplicationFileV1>(
    existingFiles.map((file) => [file.path, file]),
  );
  const draftPaths = new Set(drafts.map((file) => file.path));
  const sourceFiles: ApplicationSourceFileV1[] = [];
  const diffFiles: Record<string, unknown>[] = [];
  const diagnostics: GenerationDiagnostic[] = [];
  const conflictedPaths = new Set<string>();

  for (const draft of [...drafts].sort((left, right) =>
    compareUtf16(left.path, right.path),
  )) {
    const existing = existingByPath.get(draft.path);
    const references = sourceReferences(draft);
    const common = {
      path: draft.path,
      mediaType: draft.mediaType,
      checksum: draft.digest,
      semanticChecksum: semanticChecksum(draft),
      sizeBytes: byteLength(draft.content),
      provenance: pinProvenance(request, draft.provenance),
      sourceReferences: references,
    };
    if (existing === undefined) {
      sourceFiles.push(
        parsedSourceFile({
          ...common,
          disposition: "create",
          ownership: draft.ownership,
          content: draft.content,
        }),
      );
      diffFiles.push({
        path: draft.path,
        change: "create",
        ownership: draft.ownership,
        afterChecksum: draft.digest,
        reason:
          "The deterministic path does not exist in the supplied repository inventory.",
        sourceReferences: references,
      });
      continue;
    }
    if (draft.ownership === "user-owned") {
      if (
        existing.ownership === "generated" ||
        existing.ownership === "ai-authored"
      ) {
        conflictedPaths.add(draft.path);
        diffFiles.push({
          path: draft.path,
          change: "conflict",
          ownership: existing.ownership,
          beforeChecksum: existing.currentChecksum,
          reason:
            "An ownership-incompatible file already occupies the user-owned extension path.",
          sourceReferences: references,
        });
      } else {
        sourceFiles.push(preservedFile(existing, request, draft));
        diffFiles.push({
          path: draft.path,
          change: "preserve",
          ownership: existing.ownership,
          beforeChecksum: existing.currentChecksum,
          afterChecksum: existing.currentChecksum,
          reason:
            "User or approved extension content is preserved without inspection or replacement.",
          sourceReferences: references,
        });
      }
      continue;
    }
    if (existing.ownership !== "generated") {
      conflictedPaths.add(draft.path);
      diffFiles.push({
        path: draft.path,
        change: "conflict",
        ownership: existing.ownership,
        beforeChecksum: existing.currentChecksum,
        reason: "A non-generated file occupies a deterministic generated path.",
        sourceReferences: references,
      });
      continue;
    }
    if (existing.baselineChecksum !== existing.currentChecksum) {
      conflictedPaths.add(draft.path);
      diffFiles.push({
        path: draft.path,
        change: "conflict",
        ownership: existing.ownership,
        beforeChecksum: existing.currentChecksum,
        reason:
          "Generated content changed after its exact baseline and cannot be overwritten silently.",
        sourceReferences: references,
      });
      continue;
    }
    if (existing.currentChecksum === draft.digest) {
      sourceFiles.push(
        parsedSourceFile({
          ...common,
          disposition: "unchanged",
          ownership: "generated",
        }),
      );
      diffFiles.push({
        path: draft.path,
        change: "unchanged",
        ownership: "generated",
        beforeChecksum: existing.currentChecksum,
        afterChecksum: existing.currentChecksum,
        reason:
          "Current generated bytes already equal the deterministic output.",
        sourceReferences: references,
      });
    } else {
      sourceFiles.push(
        parsedSourceFile({
          ...common,
          disposition: "replace",
          ownership: "generated",
          content: draft.content,
          previousChecksum: existing.currentChecksum,
          baselineChecksum: existing.baselineChecksum,
        }),
      );
      diffFiles.push({
        path: draft.path,
        change: "replace",
        ownership: "generated",
        beforeChecksum: existing.currentChecksum,
        afterChecksum: draft.digest,
        reason:
          "The exact generated baseline is unchanged and may be replaced deterministically.",
        sourceReferences: references,
      });
    }
  }

  if (includeOrphans) {
    for (const existing of [...existingFiles].sort((left, right) =>
      compareUtf16(left.path, right.path),
    )) {
      if (draftPaths.has(existing.path)) continue;
      const references = preservationReferences(existing.path);
      if (existing.ownership === "generated") {
        conflictedPaths.add(existing.path);
        diffFiles.push({
          path: existing.path,
          change: "conflict",
          ownership: existing.ownership,
          beforeChecksum: existing.currentChecksum,
          reason:
            "An orphaned generated path is retained for reviewed resolution; generation never deletes it.",
          sourceReferences: references,
        });
      } else {
        sourceFiles.push(preservedFile(existing, request));
        diffFiles.push({
          path: existing.path,
          change: "preserve",
          ownership: existing.ownership,
          beforeChecksum: existing.currentChecksum,
          afterChecksum: existing.currentChecksum,
          reason:
            "An unclaimed non-generated path is preserved without inspection or deletion.",
          sourceReferences: references,
        });
      }
    }
  }

  for (const path of conflictedPaths) {
    diagnostics.push({
      code: "APPLICATION_SOURCE_CONFLICT",
      severity: "error",
      message:
        "Repository ownership or baseline metadata blocks safe materialization for this path.",
      source: { document: "application-source", path, filePath: path },
    });
  }
  return {
    sourceFiles: sourceFiles.sort((left, right) =>
      compareUtf16(left.path, right.path),
    ),
    diffFiles: diffFiles.sort((left, right) =>
      compareUtf16(String(left["path"]), String(right["path"])),
    ),
    diagnostics,
    conflictedPaths,
  };
}

interface ContractUsageIdentity {
  readonly contractId: string;
  readonly contractVersion: string;
  readonly digest: string;
}

function contractUsageKey(identity: ContractUsageIdentity): string {
  return `${identity.contractId}\u0000${identity.contractVersion}\u0000${identity.digest}`;
}

function addContractUsage(
  usage: Map<string, SourceProvenance>,
  identity: ContractUsageIdentity,
  workload: ResolvedApplicationWorkload,
  operationIds: readonly string[],
  edgeIds: readonly string[],
): void {
  const key = contractUsageKey(identity);
  const previous = usage.get(key);
  usage.set(key, {
    workloadIds: uniqueSorted([
      ...(previous?.workloadIds ?? []),
      workload.workloadId,
    ]),
    operationIds: uniqueSorted([
      ...(previous?.operationIds ?? []),
      ...operationIds,
    ]),
    contractIds: [identity.contractId],
    edgeIds: uniqueSorted([...(previous?.edgeIds ?? []), ...edgeIds]),
    environmentBindingIds: uniqueSorted([
      ...(previous?.environmentBindingIds ?? []),
      ...workload.environment.map((binding) => binding.bindingId),
    ]),
    resourceTargetKeys: uniqueSorted([
      ...(previous?.resourceTargetKeys ?? []),
      ...workload.environment.flatMap((binding) =>
        binding.targetKey === undefined ? [] : [binding.targetKey],
      ),
    ]),
    extensionPointIds: uniqueSorted([
      ...(previous?.extensionPointIds ?? []),
      ...workload.extensionPointIds,
    ]),
  });
}

function contractUsage(
  workloads: readonly ResolvedApplicationWorkload[],
): ReadonlyMap<string, SourceProvenance> {
  const usage = new Map<string, SourceProvenance>();
  for (const workload of workloads) {
    for (const operation of workload.operations) {
      const edges = [
        operation.triggerEdgeId,
        ...("dataEdgeId" in operation ? [operation.dataEdgeId] : []),
        ...(isHttpNoContentWorkload(workload)
          ? workload.authenticationEdgeIds
          : []),
      ];
      for (const identity of [
        {
          contractId: operation.routeContractId,
          contractVersion: operation.routeContractVersion,
          digest: operation.routeContractDigest,
        },
        ...("entity" in operation ? [operation.entity] : []),
        {
          contractId: operation.behaviorContractId,
          contractVersion: operation.behaviorContractVersion,
          digest: operation.behaviorContractDigest,
        },
      ]) {
        addContractUsage(usage, identity, workload, [operation.id], edges);
      }
    }
    if (workload.auth !== undefined) {
      addContractUsage(
        usage,
        workload.auth,
        workload,
        workload.operations.map((operation) => operation.id),
        [
          ...workload.operations.map((operation) => operation.triggerEdgeId),
          ...(isHttpNoContentWorkload(workload)
            ? workload.authenticationEdgeIds
            : []),
        ],
      );
    }
    for (const test of workload.tests) {
      const operation = workload.operations.find(
        (candidate) => candidate.id === test.operationId,
      );
      addContractUsage(
        usage,
        {
          contractId: test.testCaseContractId,
          contractVersion: test.testCaseContractVersion,
          digest: test.testCaseContractDigest,
        },
        workload,
        [test.operationId],
        operation === undefined
          ? []
          : [
              operation.triggerEdgeId,
              ...("dataEdgeId" in operation ? [operation.dataEdgeId] : []),
              ...(isHttpNoContentWorkload(workload)
                ? workload.authenticationEdgeIds
                : []),
            ],
      );
    }
  }
  return usage;
}

function contractFiles(
  request: ApplicationGenerationRequestV1,
  workloads: readonly ResolvedApplicationWorkload[],
): readonly EmittedSourceFile[] {
  const usage = contractUsage(workloads);
  return request.architectureDocument.applicationContracts.contracts.flatMap(
    (contract) => {
      const recordDigest = getApplicationContractRecordContentHash(contract);
      const provenance = usage.get(
        contractUsageKey({
          contractId: contract.contractId,
          contractVersion: contract.contractVersion,
          digest: recordDigest,
        }),
      );
      if (provenance === undefined) return [];
      return [
        emitDeterministicFile({
          path: `application/contracts/${portableArtifactSegment(contract.contractId)}-${recordDigest.slice(7)}.json`,
          mediaType: "application/json",
          content: canonicalJson(contract),
          ownership: "generated",
          semanticDiff: "canonical-json",
          provenance,
        }),
      ];
    },
  );
}

function filesForWorkload(
  files: readonly ApplicationSourceFileV1[],
  workloadId: string,
): ApplicationSourceFileV1[] {
  return files.filter((file) =>
    file.provenance.workloadIds.includes(workloadId),
  );
}

function diagnosticBlocksWorkload(
  diagnostic: GenerationDiagnostic,
  workloadId: string,
): boolean {
  return (
    diagnostic.severity === "error" &&
    (diagnostic.source.workloadId === undefined ||
      diagnostic.source.workloadId === workloadId)
  );
}

function buildContractPath(workload: ResolvedApplicationWorkload): string {
  return `application/build-contracts/${portableArtifactSegment(workload.workloadId)}.json`;
}

function sourceReadyForBuild(
  workload: ResolvedApplicationWorkload,
  drafts: readonly EmittedSourceFile[],
  materialized: MaterializedFiles,
  diagnostics: readonly GenerationDiagnostic[],
): boolean {
  if (workload.mode === "ai-assisted-custom") return false;
  if (
    diagnostics.some((diagnostic) =>
      diagnosticBlocksWorkload(diagnostic, workload.workloadId),
    )
  ) {
    return false;
  }
  const expectedDrafts = drafts.filter((draft) =>
    draft.provenance.workloadIds.includes(workload.workloadId),
  );
  const availablePaths = new Set<string>(
    filesForWorkload(materialized.sourceFiles, workload.workloadId)
      .filter((file) => "content" in file && typeof file.content === "string")
      .map((file) => file.path),
  );
  if (
    expectedDrafts.length === 0 ||
    expectedDrafts.some((draft) => !availablePaths.has(draft.path))
  ) {
    return false;
  }
  return [
    "application/package.json",
    "application/tsconfig.json",
    "application/lockfile.contract.json",
    `application/src/functions/${workload.deploymentKey}/index.ts`,
    `application/tests/functions/${workload.deploymentKey}/unit.test.ts`,
    `application/tests/functions/${workload.deploymentKey}/contracts.test.ts`,
  ].every((path) => availablePaths.has(path));
}

function buildEnvelope(
  workload: ResolvedApplicationWorkload,
  files: readonly ApplicationSourceFileV1[],
): Prompt32ABuildArtifactEnvelopeV1 {
  const contract = {
    contractVersion: 1 as const,
    workloadId: workload.workloadId,
    implementationMode: workload.mode,
    runtime: runtimePin(),
    toolchain: BUILD_TOOLCHAIN.map((tool) => ({
      ...tool,
      digest: coordinateDigest(tool.id, tool.version),
      digestKind: "canonical-coordinate" as const,
    })),
    dependencies: BUILD_DEPENDENCIES.filter(
      (dependency) =>
        !isHttpNoContentWorkload(workload) || dependency.kind !== "runtime",
    ).map((dependency) => ({
      ...dependency,
      digest: coordinateDigest(dependency.name, dependency.version),
      digestKind: "canonical-coordinate" as const,
    })),
    entrypoint: `application/src/functions/${workload.deploymentKey}/index.ts`,
    compiledEntrypoint: `application/dist/src/functions/${workload.deploymentKey}/index.js`,
    packageManifestPath: "application/package.json",
    lockfilePath: "application/lockfile.contract.json",
    sourceManifestPath: "application/manifest.json" as const,
    sourceInputs: filesForWorkload(files, workload.workloadId)
      .map((file) => ({ path: file.path, checksum: file.checksum }))
      .sort((left, right) => compareUtf16(left.path, right.path)),
    executionPolicy: {
      credentials: "deny" as const,
      filesystem: "isolated" as const,
      network: "deny" as const,
      packageScripts: "deny" as const,
      reproducible: true as const,
    },
    requiredChecks: [
      "compile" as const,
      "unit-tests" as const,
      "contract-tests" as const,
      "security" as const,
      "reproducibility" as const,
    ],
    expectedArtifact: {
      artifactId: `artifact_${portableArtifactSegment(workload.workloadId)}`,
      kind: "aws-lambda-zip" as const,
      mediaType: "application/zip" as const,
      path: `application/artifacts/${portableArtifactSegment(workload.workloadId)}/function.zip`,
      archiveEntrypoint: "index.js" as const,
      handler: LAMBDA_HANDLER,
      digestAlgorithm: "sha256" as const,
    },
  };
  return prompt32ABuildArtifactEnvelopeV1Schema.parse({
    contract,
    contractDigest: sha256Digest(canonicalJson(contract)),
  });
}

function buildContractFile(
  envelope: Prompt32ABuildArtifactEnvelopeV1,
  workload: ResolvedApplicationWorkload,
): EmittedSourceFile {
  return emitDeterministicFile({
    path: buildContractPath(workload),
    mediaType: "application/json",
    content: canonicalJson(envelope),
    ownership: "generated",
    semanticDiff: "canonical-json",
    provenance: {
      workloadIds: [workload.workloadId],
      operationIds: workload.operations
        .map((operation) => operation.id)
        .sort(compareUtf16),
      contractIds: uniqueSorted(
        workload.operations.flatMap((operation) => [
          operation.routeContractId,
          ...("entity" in operation ? [operation.entity.contractId] : []),
        ]),
      ),
      edgeIds: uniqueSorted(
        workload.operations.flatMap((operation) => [
          operation.triggerEdgeId,
          ...("dataEdgeId" in operation ? [operation.dataEdgeId] : []),
          ...(isHttpNoContentWorkload(workload)
            ? workload.authenticationEdgeIds
            : []),
        ]),
      ),
      environmentBindingIds: workload.environment
        .map((binding) => binding.bindingId)
        .sort(compareUtf16),
      resourceTargetKeys: workload.environment.flatMap((binding) =>
        binding.targetKey === undefined ? [] : [binding.targetKey],
      ),
      extensionPointIds: workload.extensionPointIds,
    },
  });
}

function missingRequirements(
  workload: WorkloadV2,
  eligibleComplete: boolean,
  requiresBuildConfirmation: boolean,
): GenerationRequirement[] {
  switch (workload.implementation.mode) {
    case "infrastructure-only":
      return [
        "deterministic-application-generation",
        "application-build-and-tests",
        "application-security-checks",
      ];
    case "user-provided":
    case "external-artifact":
      return ["application-build-and-tests", "application-security-checks"];
    case "generated-starter":
      return ["application-build-and-tests", "application-security-checks"];
    case "complete-supported-pattern":
      return eligibleComplete && requiresBuildConfirmation
        ? ["application-build-and-tests", "application-security-checks"]
        : eligibleComplete
          ? []
          : [
              "deterministic-application-generation",
              "application-build-and-tests",
              "application-security-checks",
            ];
    case "ai-assisted-custom":
      return [
        "ai-extension-parse-static-validity",
        "application-build-and-tests",
        "application-security-checks",
      ];
  }
}

function workloadCoverage(
  workload: WorkloadV2,
  resolved: ResolvedApplicationWorkload | undefined,
  files: readonly ApplicationSourceFileV1[],
  diagnostics: readonly GenerationDiagnostic[],
) {
  const hasError = diagnostics.some(
    (diagnostic) =>
      diagnostic.severity === "error" &&
      (diagnostic.source.workloadId === undefined ||
        diagnostic.source.workloadId === workload.id),
  );
  const relevantFiles = filesForWorkload(files, workload.id);
  const hasUnmaterializedUserExtension = relevantFiles.some(
    (file) =>
      file.ownership === "user-owned" &&
      file.disposition === "preserve" &&
      !("content" in file),
  );
  const representedTests =
    resolved === undefined
      ? []
      : workload.tests
          .filter((binding) => binding.requiredForCoverage)
          .map((binding) => binding.bindingId)
          .sort(compareUtf16);
  const eligibleComplete =
    workload.implementation.mode === "complete-supported-pattern" &&
    !hasError &&
    resolved?.operations.length === workload.operations.length &&
    representedTests.length > 0 &&
    resolved.unresolvedRequirementIds.length === 0 &&
    relevantFiles.some((file) => file.path.startsWith("application/src/")) &&
    relevantFiles.some((file) => file.path.startsWith("application/tests/"));
  const requiresBuildConfirmation =
    eligibleComplete &&
    (resolved.eventPattern !== undefined || isHttpNoContentWorkload(resolved));
  const state = (() => {
    switch (workload.implementation.mode) {
      case "infrastructure-only":
        return "infrastructure-only" as const;
      case "generated-starter":
        return resolved === undefined || hasError
          ? ("target-unsupported" as const)
          : ("starter-application" as const);
      case "complete-supported-pattern":
        return hasUnmaterializedUserExtension
          ? ("custom-implementation-required" as const)
          : eligibleComplete && requiresBuildConfirmation
            ? ("starter-application" as const)
            : eligibleComplete
              ? ("complete-supported-pattern" as const)
              : ("target-unsupported" as const);
      default:
        return "custom-implementation-required" as const;
    }
  })();
  return {
    workloadId: workload.id,
    implementationMode: workload.implementation.mode,
    state,
    representedOperationIds:
      resolved?.operations
        .map((operation) => operation.id)
        .sort(compareUtf16) ?? [],
    representedTestIds: representedTests,
    unresolvedBehaviorIds: uniqueSorted([
      ...workload.unresolvedRequirementIds,
      ...workload.implementationRequirements.map(
        (requirement) => requirement.implementationRequirementId,
      ),
    ]),
    missingRequirements: missingRequirements(
      workload,
      eligibleComplete,
      requiresBuildConfirmation,
    ),
    sourceFilePaths: relevantFiles.map((file) => file.path).sort(compareUtf16),
  };
}

function packageShape(workload: WorkloadV2) {
  if (
    workload.implementation.mode === "infrastructure-only" ||
    workload.implementation.mode === "external-artifact"
  ) {
    return {};
  }
  return {
    runtimeFamily: workload.implementation.runtimeFamily,
    handler: workload.implementation.handler,
    packageRoot: "application",
    packageManifestPath: "application/package.json",
    expectedArtifact: {
      kind: "aws-lambda-zip",
      mediaType: "application/zip",
      path: `application/artifacts/${portableArtifactSegment(workload.id)}/function.zip`,
    },
  };
}

function workloadContracts(
  request: ApplicationGenerationRequestV1,
  resolvedWorkloads: readonly ResolvedApplicationWorkload[],
  files: readonly ApplicationSourceFileV1[],
  diagnostics: readonly GenerationDiagnostic[],
): readonly Record<string, unknown>[] {
  return request.workloadBehavior.workloads.map((workload) => {
    const resolved = resolvedWorkloads.find(
      (candidate) => candidate.workloadId === workload.id,
    );
    const relevantFiles = filesForWorkload(files, workload.id).map((file) => ({
      path: file.path,
      ownership: file.ownership,
    }));
    const hasError = diagnostics.some(
      (diagnostic) =>
        diagnostic.severity === "error" &&
        (diagnostic.source.workloadId === undefined ||
          diagnostic.source.workloadId === workload.id),
    );
    switch (workload.implementation.mode) {
      case "infrastructure-only":
        return {
          workloadId: workload.id,
          implementationMode: workload.implementation.mode,
          readiness: "application-code-required",
          ownershipReadiness: "not-applicable",
        };
      case "user-provided":
        return {
          workloadId: workload.id,
          implementationMode: workload.implementation.mode,
          readiness: "user-source-required",
          ownershipReadiness: "user-source-preserved",
          ...packageShape(workload),
        };
      case "external-artifact":
        return {
          workloadId: workload.id,
          implementationMode: workload.implementation.mode,
          readiness: "external-artifact-reference-ready",
          ownershipReadiness: "not-applicable",
          artifact: {
            artifactId: workload.implementation.artifact.artifactId,
            digest: workload.implementation.artifact.digest,
            resolution: "reference-only",
          },
        };
      case "generated-starter":
        return {
          workloadId: workload.id,
          implementationMode: workload.implementation.mode,
          readiness:
            hasError || relevantFiles.length === 0
              ? "generation-blocked"
              : "starter-source-ready",
          ownershipReadiness:
            hasError || relevantFiles.length === 0
              ? "not-safe-to-materialize"
              : "safe-to-materialize",
          sourceFiles: relevantFiles,
          ...packageShape(workload),
        };
      case "complete-supported-pattern":
        return {
          workloadId: workload.id,
          implementationMode: workload.implementation.mode,
          readiness:
            hasError || resolved === undefined
              ? "generation-blocked"
              : "complete-source-ready",
          ownershipReadiness:
            hasError || resolved === undefined
              ? "not-safe-to-materialize"
              : "safe-to-materialize",
          sourceFiles: relevantFiles,
          ...packageShape(workload),
        };
      case "ai-assisted-custom":
        return {
          workloadId: workload.id,
          implementationMode: workload.implementation.mode,
          readiness: hasError ? "generation-blocked" : "custom-source-required",
          ownershipReadiness: hasError
            ? "not-safe-to-materialize"
            : "extension-boundary-ready",
          sourceFiles: relevantFiles,
          validationRequirements: [
            "parse",
            "static-analysis",
            "build",
            "unit-tests",
            "contract-tests",
            "security",
          ],
          ...packageShape(workload),
        };
    }
  });
}

function semanticDiff(
  request: ApplicationGenerationRequestV1,
  resolvedWorkloads: readonly ResolvedApplicationWorkload[],
  sourceFiles: readonly ApplicationSourceFileV1[],
  buildContracts: readonly Prompt32ABuildArtifactEnvelopeV1[],
): readonly Record<string, unknown>[] {
  const entries: Record<string, unknown>[] = [];
  const materializedWorkloads = resolvedWorkloads.filter(
    (workload) => filesForWorkload(sourceFiles, workload.workloadId).length > 0,
  );
  const canonicalWorkloads = new Map<string, WorkloadV2>(
    request.workloadBehavior.workloads.map(
      (workload) => [workload.id, workload] as const,
    ),
  );

  for (const workload of materializedWorkloads) {
    const canonicalWorkload = canonicalWorkloads.get(workload.workloadId);
    const representedOperationIds = new Set(
      filesForWorkload(sourceFiles, workload.workloadId).flatMap(
        (file) => file.provenance.operationIds,
      ),
    );
    for (const operation of workload.operations.filter((candidate) =>
      representedOperationIds.has(candidate.id),
    )) {
      const canonicalOperation = canonicalWorkload?.operations.find(
        (candidate) => candidate.id === operation.id,
      );
      entries.push({
        semanticId: `operation:${portableArtifactSegment(
          `${workload.workloadId}\u0000${operation.id}`,
        )}`,
        kind: "operation",
        afterDigest: sha256Digest(
          canonicalJson({
            canonicalOperation: canonicalOperation ?? null,
            resolvedOperation: operation,
          }),
        ),
        summary:
          "Canonical Workload operation and resolved bindings represented in emitted source.",
        sourceReferences: [
          {
            document: "workload",
            workloadId: workload.workloadId,
            operationId: operation.id,
          },
        ],
      });
    }

    for (const binding of workload.environment) {
      entries.push({
        semanticId: `binding:${portableArtifactSegment(
          `${workload.workloadId}\u0000${binding.bindingId}`,
        )}`,
        kind: "binding",
        afterDigest: sha256Digest(canonicalJson(binding)),
        summary:
          "Validated environment binding represented without resolving secret values.",
        sourceReferences: [
          {
            document: "normalized-solution",
            path: "$.workloads.environment",
            workloadId: workload.workloadId,
          },
        ],
      });
    }

    for (const test of workload.tests) {
      entries.push({
        semanticId: `test:${portableArtifactSegment(
          `${workload.workloadId}\u0000${test.bindingId}`,
        )}`,
        kind: "test",
        afterDigest: sha256Digest(canonicalJson(test)),
        summary:
          "Canonical required test metadata represented in generated tests.",
        sourceReferences: [
          {
            document: "workload",
            workloadId: workload.workloadId,
            operationId: test.operationId,
          },
          { document: "architecture", contractId: test.testCaseContractId },
        ],
      });
    }

    entries.push({
      semanticId: `ownership:${portableArtifactSegment(workload.workloadId)}`,
      kind: "ownership",
      afterDigest: sha256Digest(
        canonicalJson({
          extensionPoints: canonicalWorkload?.extensionPoints ?? [],
          sourceOwnership: canonicalWorkload?.sourceOwnership ?? [],
        }),
      ),
      summary:
        "Validated source-ownership and extension boundaries applied during materialization.",
      sourceReferences: [
        {
          document: "workload",
          path: "$.sourceOwnership",
          workloadId: workload.workloadId,
        },
      ],
    });
  }

  const usage = contractUsage(materializedWorkloads);
  for (const contract of request.architectureDocument.applicationContracts
    .contracts) {
    const recordDigest = getApplicationContractRecordContentHash(contract);
    const provenance = usage.get(
      contractUsageKey({
        contractId: contract.contractId,
        contractVersion: contract.contractVersion,
        digest: recordDigest,
      }),
    );
    if (provenance === undefined) continue;
    entries.push({
      semanticId: `contract:${portableArtifactSegment(
        `${contract.contractId}\u0000${contract.contractVersion}\u0000${recordDigest}`,
      )}`,
      kind: "contract",
      afterDigest: recordDigest,
      summary:
        "Exact canonical Application Contract represented in generated source.",
      sourceReferences: provenanceSourceReferences(provenance),
    });
  }

  for (const envelope of buildContracts) {
    entries.push({
      semanticId: `build:${portableArtifactSegment(envelope.contract.workloadId)}`,
      kind: "build-contract",
      afterDigest: envelope.contractDigest,
      summary: "Prompt 32A build and artifact handoff contract.",
      sourceReferences: [
        { document: "workload", workloadId: envelope.contract.workloadId },
      ],
    });
  }
  return entries.sort((left, right) =>
    compareUtf16(String(left["semanticId"]), String(right["semanticId"])),
  );
}

function globalCoverageState(workloads: readonly Record<string, unknown>[]) {
  const states = workloads.map((workload) => workload["state"]);
  if (
    states.length > 0 &&
    states.every((state) => state === "complete-supported-pattern")
  ) {
    return "complete-supported-pattern" as const;
  }
  if (states.some((state) => state === "target-unsupported"))
    return "target-unsupported" as const;
  if (states.some((state) => state === "starter-application"))
    return "starter-application" as const;
  if (
    states.length > 0 &&
    states.every((state) => state === "infrastructure-only")
  ) {
    return "infrastructure-only" as const;
  }
  return "custom-implementation-required" as const;
}

function emitResolvedApplicationSource(
  workloads: readonly ResolvedApplicationWorkload[],
  generatorId: string,
  metadata: Parameters<typeof emitApplicationSource>[1],
): readonly EmittedSourceFile[] {
  const stateless = workloads.filter(isHttpNoContentWorkload);
  if (stateless.length > 0) {
    if (stateless.length !== workloads.length)
      throw new TypeError("Mixed generator patterns are not supported.");
    return emitHttpNoContentSource(stateless, metadata);
  }
  const legacy = workloads.filter(
    (workload): workload is ResolvedWorkload =>
      !isHttpNoContentWorkload(workload),
  );
  return (
    generatorId === EVENT_APPLICATION_GENERATOR_ID
      ? emitEventApplicationSource
      : emitApplicationSource
  )(legacy, metadata);
}

export function generateApplication(
  input: unknown,
): ApplicationGenerationResultV1 {
  const request = applicationGenerationRequestV1Schema.parse(input);
  const resolution = resolveApplicationInput(
    request as ApplicationGenerationInput,
  );
  const modeDiagnostics = request.workloadBehavior.workloads.flatMap(
    (workload) => implementationModeDiagnostics(workload),
  );
  const globalErrors = resolution.diagnostics.some(
    (diagnostic) =>
      diagnostic.severity === "error" &&
      diagnostic.source.workloadId === undefined,
  );
  const resolvedWorkloads = globalErrors
    ? []
    : resolution.workloads.filter(
        (workload) =>
          !resolution.diagnostics.some((diagnostic) =>
            diagnosticBlocksWorkload(diagnostic, workload.workloadId),
          ),
      );
  const emittedBaseDrafts = [
    ...(resolvedWorkloads.length === 0
      ? []
      : emitResolvedApplicationSource(resolvedWorkloads, request.generator.id, {
          solutionRevisionId: request.solutionRevision.solutionRevisionId,
          catalog: request.normalizedSolution.provenance.catalog,
          generator: request.generator,
          template: request.template,
          runtime: request.runtime,
          pattern: request.pattern,
        })),
    ...contractFiles(request, resolvedWorkloads),
  ];
  const generationBoundaryDiagnostics: GenerationDiagnostic[] = [];
  const duplicateBasePaths = duplicateDraftPaths(emittedBaseDrafts);
  const baseBoundsExceeded = sourceBoundsExceeded(
    emittedBaseDrafts,
    request.existingFiles,
  );
  if (duplicateBasePaths.length > 0) {
    generationBoundaryDiagnostics.push({
      code: "APPLICATION_SOURCE_PATH_COLLISION",
      severity: "error",
      message:
        "Multiple deterministic source records resolved to the same repository path and were withheld.",
      source: {
        document: "application-source",
        path: duplicateBasePaths[0] ?? "application",
      },
    });
  }
  if (baseBoundsExceeded) {
    generationBoundaryDiagnostics.push({
      code: "APPLICATION_SOURCE_BOUND_EXCEEDED",
      severity: "error",
      message:
        "The deterministic source projection exceeds the reviewed file-count or byte bound and was not materialized.",
      source: { document: "application-source", path: "application" },
    });
  }
  const baseDrafts =
    baseBoundsExceeded || duplicateBasePaths.length > 0
      ? []
      : emittedBaseDrafts;
  const baseMaterialized = materialize(
    baseDrafts,
    request.existingFiles,
    request,
    false,
  );
  const proposedBuildArtifacts = resolvedWorkloads
    .filter((workload) =>
      sourceReadyForBuild(
        workload,
        baseDrafts,
        baseMaterialized,
        resolution.diagnostics,
      ),
    )
    .map((workload) => ({
      envelope: buildEnvelope(workload, baseMaterialized.sourceFiles),
      workload,
    }));
  const proposedDrafts = [
    ...baseDrafts,
    ...proposedBuildArtifacts.map(({ envelope, workload }) =>
      buildContractFile(envelope, workload),
    ),
  ];
  const buildBoundsExceeded = sourceBoundsExceeded(
    proposedDrafts,
    request.existingFiles,
  );
  if (buildBoundsExceeded && proposedBuildArtifacts.length > 0) {
    generationBoundaryDiagnostics.push({
      code: "APPLICATION_BUILD_HANDOFF_BOUND_EXCEEDED",
      severity: "error",
      message:
        "Prompt 32A handoff files would exceed the reviewed source artifact bound and were not emitted.",
      source: {
        document: "application-source",
        path: "application/build-contracts",
      },
    });
  }
  const candidateBuildArtifacts = buildBoundsExceeded
    ? []
    : proposedBuildArtifacts;
  const candidateDrafts = buildBoundsExceeded ? baseDrafts : proposedDrafts;
  const candidateMaterialized = materialize(
    candidateDrafts,
    request.existingFiles,
    request,
    true,
  );
  const buildArtifacts = candidateBuildArtifacts.filter(({ workload }) =>
    candidateDrafts
      .filter((draft) =>
        draft.provenance.workloadIds.includes(workload.workloadId),
      )
      .every((draft) => !candidateMaterialized.conflictedPaths.has(draft.path)),
  );
  const blockedBuildDiagnostics: GenerationDiagnostic[] =
    candidateBuildArtifacts
      .filter(
        ({ workload }) =>
          !buildArtifacts.some(
            (entry) => entry.workload.workloadId === workload.workloadId,
          ),
      )
      .map(({ workload }) => ({
        code: "APPLICATION_BUILD_HANDOFF_CONFLICT",
        severity: "error",
        message:
          "A repository conflict blocks the exact Prompt 32A build handoff for this workload.",
        source: {
          document: "application-source",
          path: buildContractPath(workload),
          filePath: buildContractPath(workload),
          workloadId: workload.workloadId,
        },
      }));
  const buildContracts = buildArtifacts.map(({ envelope }) => envelope);
  const allDrafts = [
    ...baseDrafts,
    ...buildArtifacts.map(({ envelope, workload }) =>
      buildContractFile(envelope, workload),
    ),
  ];
  const materialized =
    buildArtifacts.length === candidateBuildArtifacts.length
      ? candidateMaterialized
      : materialize(allDrafts, request.existingFiles, request, true);
  const allDiagnostics = [
    ...resolution.diagnostics,
    ...modeDiagnostics,
    ...generationBoundaryDiagnostics,
    ...blockedBuildDiagnostics,
    ...materialized.diagnostics,
  ].sort((left, right) => {
    const pathOrder = compareUtf16(left.source.path, right.source.path);
    return pathOrder === 0 ? compareUtf16(left.code, right.code) : pathOrder;
  });
  const coverageWorkloads = request.workloadBehavior.workloads.map((workload) =>
    workloadCoverage(
      workload,
      resolvedWorkloads.find(
        (candidate) => candidate.workloadId === workload.id,
      ),
      materialized.sourceFiles,
      allDiagnostics,
    ),
  );
  const coverage = {
    contractVersion: 1 as const,
    solutionRevisionId: request.solutionRevision.solutionRevisionId,
    state: globalCoverageState(coverageWorkloads),
    missingRequirements: uniqueSorted(
      coverageWorkloads.flatMap((workload) => workload.missingRequirements),
    ) as GenerationRequirement[],
    workloads: coverageWorkloads,
  };
  const coverageDigest = sha256Digest(canonicalJson(coverage));
  const descriptor = sourceDescriptor(
    request.generator.id,
    request.generator.version,
  );
  const sourceManifest = {
    contractVersion: 1 as const,
    kind: "cloudmarkup.application-source-manifest" as const,
    manifestPath: "application/manifest.json" as const,
    solutionRevisionId: request.solutionRevision.solutionRevisionId,
    architectureRevisionId: request.architectureDocument.revision.revisionId,
    catalog: request.normalizedSolution.provenance.catalog,
    inputDigests: {
      applicationContracts: getApplicationContractsContentHash(
        request.architectureDocument.applicationContracts,
      ),
      architectureDocument: getArchitectureDocumentContentHash(
        request.architectureDocument,
      ),
      normalizedSolution: normalizedSolutionInputDigest(request),
      solutionRevision: solutionRevisionInputDigest(request),
      workloadBehavior: getWorkloadBehaviorContentHash(
        request.workloadBehavior,
      ),
    },
    generator: descriptor.generator,
    template: descriptor.template,
    pattern: descriptor.pattern,
    runtime: descriptor.runtime,
    coverageDigest,
    buildContracts: buildContracts
      .map((envelope) => ({
        workloadId: envelope.contract.workloadId,
        contractDigest: envelope.contractDigest,
      }))
      .sort((left, right) => compareUtf16(left.workloadId, right.workloadId)),
    files: materialized.sourceFiles.map((file) => ({
      path: file.path,
      checksum: file.checksum,
      semanticChecksum: file.semanticChecksum,
      mediaType: file.mediaType,
      sizeBytes: file.sizeBytes,
      ownership: file.ownership,
    })),
  };
  const sourceManifestDigest = sha256Digest(canonicalJson(sourceManifest));
  const artifact = {
    contractVersion: 1 as const,
    kind: "cloudmarkup.application-source-artifact" as const,
    solutionRevisionId: request.solutionRevision.solutionRevisionId,
    generator: descriptor.generator,
    template: descriptor.template,
    pattern: descriptor.pattern,
    runtime: descriptor.runtime,
    diagnostics: publicDiagnostics(allDiagnostics),
    sourceFiles: materialized.sourceFiles,
    diff: {
      files: materialized.diffFiles,
      semantic: semanticDiff(
        request,
        resolvedWorkloads,
        materialized.sourceFiles,
        buildContracts,
      ),
    },
    coverage,
    coverageDigest,
    buildContracts,
    workloadContracts: workloadContracts(
      request,
      resolvedWorkloads,
      materialized.sourceFiles,
      allDiagnostics,
    ),
    sourceManifest,
    sourceManifestDigest,
  };
  return applicationGenerationResultV1Schema.parse({
    contractVersion: 1,
    artifact,
    artifactDigest: sha256Digest(canonicalJson(artifact)),
  });
}
