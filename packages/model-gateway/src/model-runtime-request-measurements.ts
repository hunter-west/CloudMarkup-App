import { z } from "zod";
import {
  modelGatewayRequestV1Schema,
  modelHostSeedRepairRequestV2Schema,
  modelHostRepairSuccessorRequestV3Schema,
  modelRuntimeRequestedResourcesV1Schema,
  type ArchitectureDocumentV3,
  type ModelGatewayRequestV1,
  type ModelGenerationContextV1,
  type ModelRuntimeRequestedResourcesV1,
  type Sha256Digest,
} from "@cloudmarkup/schemas";
import {
  ModelGatewayValidationError,
  digestStructuredValue,
  inspectModelValueForSecretCandidatesV1,
  validateModelRequestAuthority,
} from "./security.js";

export interface ModelRuntimeRequestMeasurementsV1 {
  /** Request-derived limits only. The host must measure its actual provider
   * wire body and take output bounds from the exact prepared invocation. */
  readonly requested: Omit<
    ModelRuntimeRequestedResourcesV1,
    "outputBytes" | "outputTokens" | "promptBytes"
  >;
  /** Digests of validated candidate-boundary data, not issued ownership
   * evidence. The host must authenticate the exact frozen source and scope. */
  readonly sourceOwnershipBindingDigests: readonly Sha256Digest[];
}

const measuredResourcesShape = modelRuntimeRequestedResourcesV1Schema.shape;
const measuredResourcesSchema = z
  .object({
    dependencyNames: measuredResourcesShape.dependencyNames,
    edgeCount: measuredResourcesShape.edgeCount,
    fileCount: measuredResourcesShape.fileCount,
    moduleSources: measuredResourcesShape.moduleSources,
    nodeCount: measuredResourcesShape.nodeCount,
    providerSources: measuredResourcesShape.providerSources,
    repairAttempts: measuredResourcesShape.repairAttempts,
    repositoryBytes: measuredResourcesShape.repositoryBytes,
    repositoryFiles: measuredResourcesShape.repositoryFiles,
  })
  .strict();

/**
 * Pure measurements from a strict, sanitized request. This cannot authenticate
 * a tenant, plan, ownership, provider route or validator, or issue Evidence.
 *
 * Repository bytes count every supplied source body in UTF-8 (including repeat
 * excerpts and repair patches); repository files count distinct supplied paths.
 * Neither value claims to measure unavailable full repository contents.
 * File count covers distinct declared/supplied paths and explicit candidate
 * capacity. Graph counts cover supplied graph nodes/edges and explicit planning
 * ceilings; generation resource capacity is additional to supplied graph nodes.
 * Repair limits are never clamped to the runtime contract's two-attempt ceiling.
 */
export function measureModelRuntimeRequestV1(
  input: unknown,
): ModelRuntimeRequestMeasurementsV1 {
  try {
    const request = modelGatewayRequestV1Schema.parse(input);
    validateModelRequestAuthority(request);
    if (
      inspectModelValueForSecretCandidatesV1(request).detectedValueCount > 0
    ) {
      throw new Error("Unsanitized request.");
    }

    const files = new Set<string>();
    const repositoryFiles = new Set<string>();
    const dependencies = new Set<string>();
    const providers = new Set<string>();
    const modules = new Set<string>();
    const ownership = new Set<Sha256Digest>();
    let repositoryBytes = 0;
    let nodeCount = 0;
    let edgeCount = 0;
    let candidateCapacity = 0;
    let repairAttempts = 0;
    const addPaths = (paths: readonly string[]) => {
      for (const path of paths) files.add(path);
    };
    const addBody = (file: {
      readonly path: string;
      readonly content: string;
    }) => {
      files.add(file.path);
      repositoryFiles.add(file.path);
      repositoryBytes += new TextEncoder().encode(file.content).byteLength;
    };
    const addArchitecture = (architecture: ArchitectureDocumentV3) => {
      nodeCount = architecture.nodes.length;
      edgeCount = architecture.edges.length;
    };
    const addGenerationContext = (
      context: ModelGenerationContextV1 | undefined,
    ) => {
      if (context === undefined) return;
      context.existingFiles.forEach(addBody);
      addPaths(context.ownedPaths);
      addPaths(context.protectedPaths);
      candidateCapacity = context.limits.maximumCandidateFiles;
      nodeCount += context.limits.maximumResourceCount;
      repairAttempts = Math.max(
        repairAttempts,
        context.limits.maximumRepairAttempts,
      );
      for (const dependency of context.allowedDependencies) {
        switch (dependency.kind) {
          case "package":
            dependencies.add(dependency.name);
            break;
          case "module":
            modules.add(dependency.name);
            break;
          case "provider":
            providers.add(dependency.name);
            break;
        }
      }
      for (const provider of context.allowedProviders)
        providers.add(provider.source);
    };
    const addBoundary = (
      candidate: Extract<ModelGatewayRequestV1, { boundary: unknown }>,
    ) => {
      addPaths(candidate.boundary.ownedPaths);
      ownership.add(digestStructuredValue(candidate.boundary));
    };

    switch (request.operation) {
      case "intent.extract":
      case "requirements.blocking-questions":
      case "issue.explain":
      case "deterministic-fix.explain":
      case "summary.plain-language":
      case "summary.technical":
        break;
      case "architecture.propose":
        if (request.currentArchitecture !== undefined)
          addArchitecture(request.currentArchitecture);
        break;
      case "workload.propose":
        addArchitecture(request.architecture);
        addPaths(
          request.solutionRevision?.sourceOwnership.map(
            (entry) => entry.path,
          ) ?? [],
        );
        break;
      case "external-resource.propose":
        addArchitecture(request.architecture);
        request.repositoryExcerpts.forEach(addBody);
        break;
      case "operations.propose":
        addArchitecture(request.architecture);
        if (request.planningContext !== undefined) {
          nodeCount = Math.max(
            nodeCount,
            request.planningContext.limits.maximumNodes,
          );
          edgeCount = Math.max(
            edgeCount,
            request.planningContext.limits.maximumEdges,
          );
          request.planningContext.approvedRepositoryEvidence?.evidence.forEach(
            addBody,
          );
        }
        repairAttempts = request.repairContext?.attempt ?? 0;
        break;
      case "repository.interpret":
        request.evidence.forEach(addBody);
        break;
      case "fix.propose":
        addBoundary(request);
        ownership.add(request.issue.currentRecordDigest);
        break;
      case "application-source.generate":
      case "iac-extension.generate":
        addArchitecture(request.architecture);
        addBoundary(request);
        addPaths(
          request.solutionRevision.sourceOwnership.map((entry) => entry.path),
        );
        ownership.add(digestStructuredValue(request.sourceOwnershipAuthority));
        addGenerationContext(request.generationContext);
        break;
      case "candidate.repair":
        addBoundary(request);
        ownership.add(request.failedOutputDigest);
        request.failedCandidates.forEach((candidate) => {
          addBody({
            path: candidate.path,
            content:
              candidate.kind === "file"
                ? candidate.content
                : candidate.unifiedDiff,
          });
        });
        repairAttempts = request.maximumRepairAttempts;
        addGenerationContext(request.generationContext);
        break;
      default: {
        const exhaustive: never = request;
        throw new Error(String(exhaustive));
      }
    }

    return {
      requested: measuredResourcesSchema.parse({
        dependencyNames: [...dependencies].sort(),
        edgeCount,
        fileCount: Math.max(files.size, candidateCapacity),
        moduleSources: [...modules].sort(),
        nodeCount,
        providerSources: [...providers].sort(),
        repairAttempts,
        repositoryBytes,
        repositoryFiles: repositoryFiles.size,
      }),
      sourceOwnershipBindingDigests: [...ownership].sort(),
    };
  } catch {
    throw new ModelGatewayValidationError(
      "model-gateway.runtime-input-invalid",
      "Runtime input measurements require exact, sanitized and supported request data.",
    );
  }
}

/** Explicit V2 fixed-host measurements. These are request-derived bounds only;
 * the authenticated host must bind the actual source/seed and full provider body.
 * V1 parsing and behavior remain separate. Ownership hashes are metadata, not
 * issued ownership authority, and the declared repair ceiling is never clamped. */
export function measureModelHostSeedRuntimeRequestV2(
  input: unknown,
): ModelRuntimeRequestMeasurementsV1 {
  return measureHostRepairRequest(input, false);
}

/** Explicit successor measurements retain the original ownership and two-call
 * ceiling while counting the actual unaccepted prior-model source. Pure request
 * validation does not authenticate the predecessor or authorize a second send. */
export function measureModelHostRepairSuccessorRuntimeRequestV3(
  input: unknown,
): ModelRuntimeRequestMeasurementsV1 {
  return measureHostRepairRequest(input, true);
}

function measureHostRepairRequest(
  input: unknown,
  successor: boolean,
): ModelRuntimeRequestMeasurementsV1 {
  try {
    const request = successor
      ? modelHostRepairSuccessorRequestV3Schema.parse(input)
      : modelHostSeedRepairRequestV2Schema.parse(input);
    if (inspectModelValueForSecretCandidatesV1(request).detectedValueCount > 0)
      throw new Error("Unsanitized fixed-host request.");
    const supplied = new Set(request.failedCandidates.map((file) => file.path));
    const paths = new Set([...supplied, ...request.boundary.ownedPaths]);
    const repositoryBytes = request.failedCandidates.reduce(
      (total, file) =>
        total + new TextEncoder().encode(file.content).byteLength,
      0,
    );
    return {
      requested: measuredResourcesSchema.parse({
        dependencyNames: [],
        edgeCount: 0,
        fileCount: paths.size,
        moduleSources: [],
        nodeCount: 0,
        providerSources: [],
        repairAttempts: request.maximumRepairAttempts,
        repositoryBytes,
        repositoryFiles: supplied.size,
      }),
      sourceOwnershipBindingDigests: [
        digestStructuredValue(request.boundary),
        digestStructuredValue(request.hostSeed),
      ].sort(),
    };
  } catch {
    throw new ModelGatewayValidationError(
      "model-gateway.runtime-input-invalid",
      "Runtime input measurements require exact, sanitized and supported request data.",
    );
  }
}
