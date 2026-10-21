import { serializeCanonicalJson } from "@cloudmarkup/schemas";
import { sha256Digest } from "@cloudmarkup/solution-export";

import {
  architectureCliSemanticSnapshotV1Schema,
  type ArchitectureCliDiagnosticV1,
  type ArchitectureCliRepositoryProfileV1,
  type ArchitectureCliSemanticSnapshotV1,
} from "./contracts.js";
import { semanticSnapshotDigest } from "./semantic-diff.js";
import type {
  ArchitectureCliPipelineResultV1,
  ArchitectureCliPipelineV1,
} from "./service.js";

export interface ArchitectureCliPipelineRegistrationV1 {
  readonly digest: ArchitectureCliRepositoryProfileV1["pipelineProfile"]["digest"];
  readonly id: ArchitectureCliRepositoryProfileV1["pipelineProfile"]["id"];
  readonly pipeline: ArchitectureCliPipelineV1;
  readonly version: ArchitectureCliRepositoryProfileV1["pipelineProfile"]["version"];
}

export interface ArchitectureCliPipelineRegistryV1 {
  resolve(
    profile: ArchitectureCliRepositoryProfileV1["pipelineProfile"],
  ): ArchitectureCliPipelineV1 | undefined;
}

function compareUtf16(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

export function createArchitectureCliPipelineRegistry(
  registrations: readonly ArchitectureCliPipelineRegistrationV1[],
): ArchitectureCliPipelineRegistryV1 {
  const ordered = [...registrations].sort((left, right) =>
    compareUtf16(
      `${left.id}\u0000${left.version}\u0000${left.digest}`,
      `${right.id}\u0000${right.version}\u0000${right.digest}`,
    ),
  );
  const byKey = new Map<string, ArchitectureCliPipelineV1>();
  for (const registration of ordered) {
    const key = serializeCanonicalJson({
      digest: registration.digest,
      id: registration.id,
      version: registration.version,
    });
    if (byKey.has(key)) {
      throw new TypeError(
        "CLI pipeline registrations must be exact and unique.",
      );
    }
    byKey.set(key, registration.pipeline);
  }
  return Object.freeze({
    resolve(profile: ArchitectureCliRepositoryProfileV1["pipelineProfile"]) {
      return byKey.get(serializeCanonicalJson(profile));
    },
  });
}

function unavailableSnapshot(
  repository: Parameters<ArchitectureCliPipelineV1["inspect"]>[0]["repository"],
): ArchitectureCliSemanticSnapshotV1 {
  const revision = repository.solutionRevision;
  const projection = {
    connections: [],
    contracts: [],
    contractVersion: 1 as const,
    coverage: {
      evidenceIds: revision.generationCoverage.evidence.map(
        ({ evidenceId }) => evidenceId,
      ),
      missingRequirements: revision.generationCoverage.missingRequirements,
      state: revision.generationCoverage.state,
      unresolvedRequirementIds: revision.generationCoverage.workloads.flatMap(
        ({ unresolvedRequirementIds }) => unresolvedRequirementIds,
      ),
    },
    events: [],
    kind: "cloudmarkup.repository-semantic-snapshot" as const,
    permissions: [],
    readiness: {
      reasons: ["cloudmarkup.pipeline-profile-unavailable"],
      state: "blocked" as const,
    },
    routes: [],
    services: [],
    solutionRevision: {
      digest: sha256Digest(serializeCanonicalJson(revision)),
      id: revision.solutionRevisionId,
    },
    unresolvedRequirements: revision.generationCoverage.workloads.flatMap(
      ({ unresolvedRequirementIds }) => unresolvedRequirementIds,
    ),
    workloadOperations: [],
  };
  return architectureCliSemanticSnapshotV1Schema.parse({
    ...projection,
    snapshotDigest: semanticSnapshotDigest(projection),
  });
}

function unavailableResult(
  repository: Parameters<ArchitectureCliPipelineV1["inspect"]>[0]["repository"],
): ArchitectureCliPipelineResultV1 {
  const diagnostic: ArchitectureCliDiagnosticV1 = {
    code: "cloudmarkup.cli.pipeline-profile-unavailable",
    message:
      "The exact locked local pipeline profile is not installed in this CLI distribution.",
    severity: "error",
  };
  return {
    diagnostics: [diagnostic],
    evidence: {
      current: 0,
      failed: 0,
      stale: 0,
      unavailableLevels: [1, 2, 3, 4, 5, 6, 7, 8, 9],
    },
    semanticSnapshot: unavailableSnapshot(repository),
    state: "failed",
  };
}

export function createProfileBoundArchitectureCliPipeline(
  registry: ArchitectureCliPipelineRegistryV1,
): ArchitectureCliPipelineV1 {
  function resolve(
    repository: Parameters<
      ArchitectureCliPipelineV1["inspect"]
    >[0]["repository"],
  ): ArchitectureCliPipelineV1 | undefined {
    return registry.resolve(repository.profile.pipelineProfile);
  }
  return {
    inspect(input) {
      const pipeline = resolve(input.repository);
      return pipeline === undefined
        ? Promise.resolve(unavailableResult(input.repository))
        : pipeline.inspect(input);
    },
    run(input) {
      const pipeline = resolve(input.repository);
      return pipeline === undefined
        ? Promise.resolve(unavailableResult(input.repository))
        : pipeline.run(input);
    },
  };
}
