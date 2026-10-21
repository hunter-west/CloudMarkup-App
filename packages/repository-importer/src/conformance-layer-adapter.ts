import { hashCanonicalValue } from "@cloudmarkup/domain";
import {
  conformanceLayerInputV1Schema,
  solutionRevisionManifestV1Schema,
  type ConformanceLayerInputV1,
} from "@cloudmarkup/schemas";

import {
  repositoryImportResultV1Schema,
  type RepositoryImportResultV1,
  type RepositoryImportedFactV1,
} from "./contracts.js";

function stableId(prefix: string, digest: string): string {
  return prefix + "." + digest.slice("sha256:".length, 31);
}

function subjectKind(fact: RepositoryImportedFactV1) {
  return fact.kind === "resource"
    ? fact.external
      ? ("external-resource" as const)
      : ("resource" as const)
    : fact.kind === "connection"
      ? ("connection" as const)
      : fact.kind === "policy"
        ? ("iam-policy" as const)
        : fact.kind === "workload-binding"
          ? ("application-contract" as const)
          : fact.kind === "generated-file"
            ? ("repository-file" as const)
            : ("configuration" as const);
}

function mappedReference(fact: RepositoryImportedFactV1) {
  if (
    fact.kind === "resource" &&
    fact.logicalKey.startsWith("cloudmarkup.node.")
  ) {
    return {
      kind: "architecture-node" as const,
      nodeId: fact.logicalKey.slice("cloudmarkup.node.".length),
    };
  }
  if (
    fact.kind === "connection" &&
    fact.logicalKey.startsWith("cloudmarkup.edge.")
  ) {
    return {
      edgeId: fact.logicalKey.slice("cloudmarkup.edge.".length),
      kind: "architecture-edge" as const,
    };
  }
  if (fact.kind === "workload-binding" && fact.workloadId !== undefined) {
    return { kind: "workload" as const, workloadId: fact.workloadId };
  }
  if (fact.kind === "generated-file") {
    return {
      kind: "repository-location" as const,
      location: {
        path: fact.path,
        startColumn: fact.source.column,
        startLine: fact.source.line,
      },
    };
  }
  return undefined;
}

function subjectStableKey(fact: RepositoryImportedFactV1): string {
  const mapped = mappedReference(fact);
  if (mapped?.kind === "architecture-node") return mapped.nodeId;
  if (mapped?.kind === "architecture-edge") return mapped.edgeId;
  if (mapped?.kind === "workload" && fact.target === "cloudmarkup") {
    return `workload:${mapped.workloadId}`;
  }
  if (fact.target === "cloudmarkup" && fact.kind === "variable") {
    return `variable:${fact.logicalKey.slice("cloudmarkup.variable.".length)}`;
  }
  if (fact.target === "cloudmarkup" && fact.kind === "output") {
    return `output:${fact.logicalKey.slice("cloudmarkup.output.".length)}`;
  }
  if (fact.kind === "generated-file")
    return stableId("repository-file", hashCanonicalValue(fact.path));
  return stableId("imported-subject", fact.digest);
}

function semanticDigest(fact: RepositoryImportedFactV1) {
  if (fact.semanticIntentDigest !== undefined) return fact.semanticIntentDigest;
  if (fact.kind === "resource" || fact.kind === "connection") {
    return fact.configurationDigest;
  }
  if (fact.kind === "generated-file") {
    return fact.actualChecksum ?? fact.expectedChecksum;
  }
  return fact.digest;
}

function semanticComparison(fact: RepositoryImportedFactV1) {
  if (fact.kind === "generated-file") {
    return {
      basis: "repository-file-bytes" as const,
      contractVersion: 1 as const,
      coverage: "complete" as const,
    };
  }
  if (
    fact.target === "cloudmarkup" &&
    fact.confidence === "confirmed" &&
    fact.semanticIntentDigest !== undefined
  ) {
    const basis =
      fact.kind === "resource"
        ? fact.external
          ? ("external-resource-intent" as const)
          : ("resource-intent" as const)
        : fact.kind === "connection"
          ? ("connection-intent" as const)
          : fact.kind === "workload-binding"
            ? ("application-contract-intent" as const)
            : fact.kind === "variable" || fact.kind === "output"
              ? ("configuration-intent" as const)
              : undefined;
    if (basis !== undefined) {
      return {
        basis,
        contractVersion: 1 as const,
        coverage: "complete" as const,
      };
    }
  }
  return {
    basis: "opaque" as const,
    contractVersion: 1 as const,
    coverage: "partial" as const,
  };
}

function factDifferences(result: RepositoryImportResultV1, factId: string) {
  return result.differences.filter((difference) =>
    difference.observedFactIds.includes(factId),
  );
}

function repositoryFileState(
  result: RepositoryImportResultV1,
  fact: RepositoryImportedFactV1,
) {
  if (fact.kind !== "generated-file" || fact.ownership !== "generated")
    return undefined;
  if (
    factDifferences(result, fact.factId).some(
      ({ kind }) => kind === "generated-file-drift",
    )
  )
    return "generated-file-drift" as const;
  if (fact.actualChecksum === undefined) return "unknown" as const;
  return fact.actualChecksum === fact.expectedChecksum
    ? ("matching" as const)
    : ("unknown" as const);
}

function applicationBinding(
  result: RepositoryImportResultV1,
  fact: RepositoryImportedFactV1,
) {
  if (fact.kind !== "workload-binding") return "not-applicable" as const;
  const differences = factDifferences(result, fact.factId);
  return differences.some(({ kind }) => kind === "application-binding-mismatch")
    ? ("mismatch" as const)
    : differences.some(({ kind }) => kind === "matches")
      ? ("matching" as const)
      : ("unknown" as const);
}

function iamAccess(
  result: RepositoryImportResultV1,
  fact: RepositoryImportedFactV1,
) {
  const differences = factDifferences(result, fact.factId);
  return differences.some(({ kind }) => kind === "iam-expansion")
    ? ("expanded" as const)
    : differences.some(({ kind }) => kind === "iam-reduction")
      ? ("reduced" as const)
      : fact.kind === "policy"
        ? ("unknown" as const)
        : ("not-applicable" as const);
}

function management(fact: RepositoryImportedFactV1) {
  return fact.kind === "resource" && fact.external
    ? ("external" as const)
    : fact.ownership === "external"
      ? ("external" as const)
      : fact.ownership === "unknown"
        ? ("unmanaged" as const)
        : ("managed" as const);
}

function factOwnership(
  fact: RepositoryImportedFactV1,
  approvedExtensionPaths: ReadonlySet<string>,
) {
  return fact.kind === "generated-file" &&
    fact.ownership === "user-owned" &&
    approvedExtensionPaths.has(fact.path)
    ? ("user-extension" as const)
    : fact.ownership === "generated"
      ? ("generated" as const)
      : fact.ownership === "user-owned"
        ? ("user-owned" as const)
        : fact.ownership === "unknown"
          ? ("unmanaged" as const)
          : ("imported" as const);
}

function iamPermissions(fact: RepositoryImportedFactV1) {
  if (
    fact.kind !== "policy" ||
    (fact.effect !== "allow" && fact.effect !== "deny")
  ) {
    return [];
  }
  const resourceDigest = hashCanonicalValue({ scope: fact.resourceScope });
  return [...new Set(fact.actions)].map((action) => ({
    actionDigest: hashCanonicalValue(action),
    effect: fact.effect as "allow" | "deny",
    resourceDigest,
  }));
}

export function projectRepositoryImportToConformanceLayerInputV1(input: {
  readonly result: unknown;
  readonly solutionRevision: unknown;
}): ConformanceLayerInputV1 {
  const result = repositoryImportResultV1Schema.parse(input.result);
  const solutionRevision = solutionRevisionManifestV1Schema.parse(
    input.solutionRevision,
  );
  const approvedExtensionPaths = new Set(
    solutionRevision.sourceOwnership
      .filter(({ ownership }) => ownership === "approved-extension")
      .map(({ path }) => path),
  );
  const solutionRevisionReference = {
    digest: hashCanonicalValue(solutionRevision),
    id: solutionRevision.solutionRevisionId,
  };
  const { resultDigest, ...resultProjection } = result;
  const digestValid = hashCanonicalValue(resultProjection) === resultDigest;
  const revisionValid =
    result.evidence.solutionRevisionId === solutionRevision.solutionRevisionId;
  const approvedObservationValid = solutionRevision.repositoryObservations.some(
    (observation) =>
      observation.repositorySnapshotId === result.snapshot.snapshotId &&
      observation.snapshotContentHash === result.snapshot.snapshotDigest &&
      observation.observedSolutionId ===
        result.observedSolution.observedSolutionId &&
      observation.observedContentHash ===
        result.observedSolution.observedContentHash,
  );
  const integrityValid =
    digestValid && revisionValid && approvedObservationValid;
  const sourceId = result.snapshot.snapshotId;
  const evidenceId = result.evidence.id;
  const fullSelection =
    result.snapshot.selectedPaths.length === 1 &&
    result.snapshot.selectedPaths[0]?.path === ".";
  const complete =
    fullSelection &&
    result.snapshot.sizeLimits.status === "within-limits" &&
    result.snapshot.unsupportedFiles.length === 0 &&
    result.diagnostics.every(({ severity }) => severity !== "error") &&
    result.facts.every(({ confidence }) => confidence === "confirmed");
  const unknown =
    result.snapshot.sizeLimits.status === "rejected" ||
    result.snapshot.redaction.status === "rejected";

  return conformanceLayerInputV1Schema.parse({
    availability: "available",
    boundSolutionRevision: solutionRevisionReference,
    completeness: unknown ? "unknown" : complete ? "complete" : "partial",
    declaredFreshness:
      result.evidence.staleness.state === "current" ? "current" : "stale",
    evidenceIds: [evidenceId],
    evidenceType: "repository-snapshot",
    facts: result.facts.flatMap((fact) => {
      const ownership = factOwnership(fact, approvedExtensionPaths);
      const mapped = mappedReference(fact);
      const stableKey = subjectStableKey(fact);
      const kind = subjectKind(fact);
      const projected = {
        applicationBinding: applicationBinding(result, fact),
        evidenceIds: [evidenceId],
        extensionPoint: ownership === "user-extension",
        factId: stableId(
          "imported-fact",
          hashCanonicalValue({ kind, stableKey }),
        ),
        iamAccess: iamAccess(result, fact),
        iamPermissions: iamPermissions(fact),
        layer: "imported",
        management: management(fact),
        operation: "none",
        ownership,
        publicExposure: "unknown",
        semanticComparison: semanticComparison(fact),
        ...(repositoryFileState(result, fact) === undefined
          ? {}
          : { repositoryFileState: repositoryFileState(result, fact) }),
        semanticDigest: semanticDigest(fact),
        sourceIds: [sourceId],
        sourceLocations: [
          {
            path: fact.source.path,
            startColumn: fact.source.column,
            startLine: fact.source.line,
          },
        ],
        subject: {
          kind,
          ...(mapped === undefined ? {} : { mappedReference: mapped }),
          stableKey,
        },
      };
      if (
        fact.kind !== "resource" ||
        fact.target !== "cloudmarkup" ||
        fact.semanticIntentDigest === undefined ||
        fact.reviewedPublicExposure === undefined
      ) {
        return [projected];
      }
      const networkStableKey = `${stableKey}.network`;
      return [
        projected,
        {
          ...projected,
          applicationBinding: "not-applicable" as const,
          factId: stableId(
            "imported-fact",
            hashCanonicalValue({
              kind: "network-exposure",
              stableKey: networkStableKey,
            }),
          ),
          publicExposure: fact.reviewedPublicExposure,
          semanticComparison: {
            basis: "network-exposure-intent" as const,
            contractVersion: 1 as const,
            coverage: "complete" as const,
          },
          semanticDigest: hashCanonicalValue({
            publicExposure: fact.reviewedPublicExposure,
          }),
          subject: {
            kind: "network-exposure" as const,
            ...(mapped === undefined ? {} : { mappedReference: mapped }),
            stableKey: networkStableKey,
          },
        },
      ];
    }),
    integrity: integrityValid ? "verified" : "invalid",
    ...(integrityValid
      ? {}
      : {
          invalidReason:
            "Repository evidence failed exact result-digest, Solution Revision, or approved repository-observation verification.",
        }),
    layer: "imported",
    sources: [
      {
        digest: result.snapshot.snapshotDigest,
        kind: "repository-snapshot",
        observedAt: result.snapshot.importedAt,
        repositoryCommit: result.snapshot.revision.commitSha,
        solutionRevisionId: solutionRevision.solutionRevisionId,
        sourceId,
        tool: {
          id: result.snapshot.importer.importerId,
          version: result.snapshot.importer.importerVersion,
        },
      },
    ],
    verifiedAt: result.snapshot.importedAt,
  });
}
