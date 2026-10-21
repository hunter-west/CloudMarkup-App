import {
  acceptedIntentV1Schema,
  type AcceptedIntentV1,
  solutionRevisionV1Schema,
  type RevisionV1,
  type SolutionRevisionV1,
} from "@cloudmarkup/api-contract";
import {
  getApplicationContractRecordContentHash,
  getApplicationContractsContentHash,
  getArchitectureDocumentCanonicalHash,
  getArchitectureDocumentContentHash,
  getArchitectureDocumentVisualHash,
  getExternalResourceReferenceContentHash,
  getWorkloadBehaviorContentHash,
  validateSolutionRevisionManifestIntrinsicV1,
} from "@cloudmarkup/domain";
import {
  digestCanonicalValue,
  solutionRevisionVersionsV1Schema,
} from "@cloudmarkup/schemas";
import type {
  GenerationCoverageRequirement,
  GenerationCoverageState,
  WorkloadV2,
} from "@cloudmarkup/schemas";

const APP_BUILD_REQUIREMENTS = Object.freeze([
  "application-build-and-tests",
  "application-security-checks",
] as const satisfies readonly GenerationCoverageRequirement[]);

function compareUtf16(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareUtf16);
}

type WorkloadSourceOwnership = WorkloadV2["sourceOwnership"][number];

function solutionConflictBehavior(
  ownership: WorkloadSourceOwnership,
):
  | "fail"
  | "semantic-diff-and-review"
  | "preserve-user-content"
  | "replace-exact-owned-content" {
  if (ownership.regeneration === "replace-when-baseline-matches") {
    return "replace-exact-owned-content";
  }
  switch (ownership.conflictBehavior) {
    case "fail-closed":
      return "fail";
    case "preserve-user-content":
      return "preserve-user-content";
    case "require-reviewed-resolution":
      return "semantic-diff-and-review";
  }
}

function solutionSourceOwnership(workloads: readonly WorkloadV2[]): readonly {
  readonly contentHash?: WorkloadSourceOwnership["baselineDigest"];
  readonly conflictBehavior:
    | "fail"
    | "semantic-diff-and-review"
    | "preserve-user-content"
    | "replace-exact-owned-content";
  readonly ownerId: WorkloadSourceOwnership["ownerId"];
  readonly ownership: WorkloadSourceOwnership["ownership"];
  readonly path: WorkloadSourceOwnership["path"];
}[] {
  return (
    workloads
      .flatMap((workload) => workload.sourceOwnership)
      // Solution Revision v1 has exact-path authority and cannot faithfully
      // represent a directory or subtree scope.
      .filter((ownership) => ownership.pathKind === "file")
      .map((ownership) => ({
        ...(ownership.baselineDigest === undefined
          ? {}
          : { contentHash: ownership.baselineDigest }),
        conflictBehavior: solutionConflictBehavior(ownership),
        ownerId: ownership.ownerId,
        ownership: ownership.ownership,
        path: ownership.path,
      }))
      .sort((left, right) => compareUtf16(left.path, right.path))
  );
}

function missingRequirementsForWorkload(
  workload: WorkloadV2,
): readonly GenerationCoverageRequirement[] {
  switch (workload.implementation.mode) {
    case "infrastructure-only":
      return [];
    case "user-provided":
    case "external-artifact":
      return APP_BUILD_REQUIREMENTS;
    case "generated-starter":
      return [
        "deterministic-application-generation",
        ...APP_BUILD_REQUIREMENTS,
      ];
    case "complete-supported-pattern":
      return [
        "structural-validity",
        "provider-architecture-validity",
        "deterministic-application-generation",
        ...APP_BUILD_REQUIREMENTS,
      ];
    case "ai-assisted-custom":
      return [
        "structural-validity",
        "provider-architecture-validity",
        "ai-extension-parse-static-validity",
        ...APP_BUILD_REQUIREMENTS,
      ];
  }
}

function coverageStateForWorkload(
  workload: WorkloadV2,
): GenerationCoverageState {
  return workload.implementation.mode === "infrastructure-only"
    ? "infrastructure-only"
    : "custom-implementation-required";
}

export type SolutionRevisionToolSelectionsV1 = Pick<
  SolutionRevisionV1["manifest"]["versions"],
  "compiler" | "diagramRenderer"
>;

export const solutionRevisionToolSelectionsV1Schema =
  solutionRevisionVersionsV1Schema.pick({
    compiler: true,
    diagramRenderer: true,
  });

export interface BuildSolutionRevisionV1Input {
  readonly acceptedIntent?: AcceptedIntentV1;
  readonly name: string;
  readonly revision: RevisionV1;
  readonly solutionRevisionId: string;
  readonly selectedTools?: SolutionRevisionToolSelectionsV1;
}

/**
 * Builds an immutable Solution Revision only from a previously published,
 * exact Architecture Revision. Design-time implementation modes are not proof
 * that source was generated, built, or validated, so this builder deliberately
 * records missing evidence instead of overstating application coverage.
 */
export function buildSolutionRevisionV1({
  acceptedIntent,
  name,
  revision,
  solutionRevisionId,
  selectedTools,
}: BuildSolutionRevisionV1Input): SolutionRevisionV1 {
  const tools =
    selectedTools === undefined
      ? undefined
      : solutionRevisionToolSelectionsV1Schema.parse(selectedTools);
  const approved =
    acceptedIntent === undefined
      ? undefined
      : acceptedIntentV1Schema.parse(acceptedIntent);
  if (
    approved !== undefined &&
    (approved.projectId !== revision.projectId ||
      approved.sourceDraftId !== revision.sourceDraftId ||
      approved.sourceDraftVersion > revision.sourceDraftVersion ||
      approved.intentDigest !== digestCanonicalValue(approved.intentDocument))
  )
    throw new TypeError(
      "The accepted Intent does not match this immutable revision.",
    );
  const document = revision.architectureDocument;
  const workloadCoverage = document.workloadBehavior.workloads.map(
    (workload) => ({
      evidence: [],
      missingRequirements: [...missingRequirementsForWorkload(workload)],
      state: coverageStateForWorkload(workload),
      unresolvedRequirementIds: uniqueSorted([
        ...workload.unresolvedRequirementIds,
        ...workload.implementationRequirements.map(
          (requirement) => requirement.implementationRequirementId,
        ),
      ]),
      workloadId: workload.id,
    }),
  );
  const hasApplicationWorkload = workloadCoverage.some(
    (coverage) => coverage.state !== "infrastructure-only",
  );
  const generationCoverage = {
    contractVersion: 1 as const,
    evidence: [],
    missingRequirements: uniqueSorted(
      workloadCoverage.flatMap((coverage) => coverage.missingRequirements),
    ),
    solutionRevisionId,
    state: hasApplicationWorkload
      ? ("custom-implementation-required" as const)
      : ("infrastructure-only" as const),
    workloads: workloadCoverage,
  };
  const architectureContentHash = getArchitectureDocumentContentHash(document);
  const architectureDocumentHash =
    getArchitectureDocumentCanonicalHash(document);
  const architectureVisualHash = getArchitectureDocumentVisualHash(document);
  const manifest = validateSolutionRevisionManifestIntrinsicV1({
    aiExtensionIds: [],
    architecture: {
      contentHash: architectureContentHash,
      documentHash: architectureDocumentHash,
      documentKind: "cloudmarkup.architecture-document",
      revisionId: revision.id,
      schemaVersion: 3,
      visualHash: architectureVisualHash,
    },
    assumptions: uniqueSorted(
      document.assumptions.map((assumption) => assumption.id),
    ),
    contractVersion: 1,
    contracts: {
      contentHash: getApplicationContractsContentHash(
        document.applicationContracts,
      ),
      contractVersion: 1,
      recordHashes: document.applicationContracts.contracts
        .map(getApplicationContractRecordContentHash)
        .sort(compareUtf16),
    },
    createdAt: revision.createdAt,
    createdBy: revision.createdBy.id,
    evidenceIdsAtFreeze: [],
    externalResources: {
      contentHash: getExternalResourceReferenceContentHash(
        document.externalResources,
      ),
      contractVersion: 1,
    },
    generationCoverage,
    intent:
      approved === undefined
        ? {
            reason:
              "No separately versioned Intent Document is bound to this Architecture Revision.",
            state: "not-applicable",
          }
        : {
            state: "included",
            id: approved.acceptedIntentId,
            version: approved.contractVersion,
            contentHash: approved.intentDigest,
          },
    issueIdsAtFreeze: [],
    kind: "cloudmarkup.solution-revision-manifest",
    repositoryObservations: [],
    solutionRevisionId,
    sourceOwnership: solutionSourceOwnership(
      document.workloadBehavior.workloads,
    ),
    unresolvedDecisionIds: uniqueSorted([
      ...document.unresolvedRequirements.map((requirement) => requirement.id),
      ...workloadCoverage.flatMap(
        (coverage) => coverage.unresolvedRequirementIds,
      ),
    ]),
    versions: {
      applicationGenerator: {
        reason: "Application generation has not run for this revision.",
        state: "not-applicable",
      },
      catalog: document.catalog,
      compiler: tools?.compiler ?? {
        reason: "Infrastructure compilation has not run for this revision.",
        state: "not-applicable",
      },
      diagramRenderer: tools?.diagramRenderer ?? {
        reason: "Diagram rendering has not run for this revision.",
        state: "not-applicable",
      },
      importer: {
        reason: "No repository import is bound to this revision.",
        state: "not-applicable",
      },
      modelPrompt: {
        reason: "No model invocation is bound to this revision.",
        state: "not-applicable",
      },
      policy: [],
    },
    workload: {
      contentHash: getWorkloadBehaviorContentHash(document.workloadBehavior),
      contractVersion: 2,
    },
  });

  return solutionRevisionV1Schema.parse({
    manifest,
    revision,
    summary: {
      architectureRevisionId: revision.id,
      contentDigest: architectureContentHash,
      createdAt: revision.createdAt,
      createdBy: revision.createdBy,
      documentDigest: architectureDocumentHash,
      generationCoverage,
      name,
      projectId: revision.projectId,
      semanticDigest: architectureContentHash,
      solutionRevisionId,
      sourceDraftId: revision.sourceDraftId,
      sourceDraftVersion: revision.sourceDraftVersion,
      visualDigest: architectureVisualHash,
    },
  });
}
