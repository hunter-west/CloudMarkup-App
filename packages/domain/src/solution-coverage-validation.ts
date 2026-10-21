import {
  solutionGenerationCoverageV1Schema,
  solutionRevisionManifestV1Schema,
  type GenerationCoverageRequirement,
  type GenerationCoverageState,
  type SolutionGenerationCoverageV1,
  type SolutionRevisionManifestV1,
  type WorkloadGenerationCoverageV1,
} from "@cloudmarkup/schemas";

export type SolutionLifecycleIssueCode =
  | "coverage-evidence-and-missing-overlap"
  | "coverage-evidence-not-frozen"
  | "coverage-required-evidence-missing"
  | "coverage-requirement-check-missing"
  | "coverage-unexpected-complete-state"
  | "duplicate-coverage-evidence"
  | "duplicate-evidence-id"
  | "duplicate-frozen-evidence-id"
  | "duplicate-issue-resolution-evidence-id"
  | "duplicate-workload-coverage"
  | "evidence-check-not-passed"
  | "evidence-level-kind-mismatch"
  | "evidence-record-missing"
  | "evidence-revision-mismatch"
  | "evidence-stale"
  | "issue-closure-requirement-unsatisfied"
  | "issue-closure-requirements-mismatch"
  | "issue-digest-mismatch"
  | "issue-resolution-evidence-collection-required"
  | "issue-resolution-evidence-not-linked"
  | "issue-identity-mismatch"
  | "issue-previous-digest-mismatch"
  | "issue-record-version-mismatch"
  | "issue-transition-not-allowed";

export interface SolutionLifecycleIssue {
  readonly code: SolutionLifecycleIssueCode;
  readonly message: string;
  readonly path: string;
}

export class SolutionLifecycleValidationError extends Error {
  public readonly issues: readonly SolutionLifecycleIssue[];

  public constructor(issues: readonly SolutionLifecycleIssue[]) {
    super("Solution lifecycle validation failed.");
    this.name = "SolutionLifecycleValidationError";
    this.issues = issues;
  }
}

const completeStateRequirements: Readonly<
  Partial<
    Record<GenerationCoverageState, readonly GenerationCoverageRequirement[]>
  >
> = Object.freeze({
  "starter-application": Object.freeze([
    "deterministic-application-generation",
  ] as const),
  "complete-supported-pattern": Object.freeze([
    "structural-validity",
    "provider-architecture-validity",
    "deterministic-application-generation",
    "application-build-and-tests",
    "application-security-checks",
  ] as const),
  "ai-assisted-custom-validated": Object.freeze([
    "structural-validity",
    "provider-architecture-validity",
    "ai-extension-parse-static-validity",
    "application-build-and-tests",
    "application-security-checks",
  ] as const),
});

function compareUtf16(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

export function findDuplicateValues(
  values: readonly string[],
): readonly string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  values.forEach((value) => {
    if (seen.has(value)) {
      duplicates.add(value);
    }
    seen.add(value);
  });
  return [...duplicates].sort(compareUtf16);
}

function validateCoverageRecord(
  record: Pick<
    WorkloadGenerationCoverageV1,
    "evidence" | "missingRequirements" | "state"
  >,
  path: string,
): readonly SolutionLifecycleIssue[] {
  const issues: SolutionLifecycleIssue[] = [];
  const evidenceRequirements = record.evidence.map(
    (entry) => entry.requirement,
  );

  findDuplicateValues(evidenceRequirements).forEach((requirement) => {
    issues.push({
      code: "duplicate-coverage-evidence",
      message: `Coverage requirement ${requirement} has duplicate evidence.`,
      path: `${path}.evidence`,
    });
  });
  findDuplicateValues(record.missingRequirements).forEach((requirement) => {
    issues.push({
      code: "duplicate-coverage-evidence",
      message: `Missing coverage requirement ${requirement} is duplicated.`,
      path: `${path}.missingRequirements`,
    });
  });

  const evidenceSet = new Set(evidenceRequirements);
  const missingSet = new Set(record.missingRequirements);
  [...evidenceSet]
    .filter((requirement) => missingSet.has(requirement))
    .sort(compareUtf16)
    .forEach((requirement) => {
      issues.push({
        code: "coverage-evidence-and-missing-overlap",
        message: `Coverage requirement ${requirement} cannot be both satisfied and missing.`,
        path,
      });
    });

  const required = completeStateRequirements[record.state] ?? [];
  required.forEach((requirement) => {
    if (!evidenceSet.has(requirement)) {
      issues.push({
        code: "coverage-required-evidence-missing",
        message: `Coverage state ${record.state} requires exact ${requirement} evidence.`,
        path: `${path}.evidence`,
      });
    }
  });

  if (required.length > 0 && record.missingRequirements.length > 0) {
    issues.push({
      code: "coverage-unexpected-complete-state",
      message: `Coverage state ${record.state} cannot be claimed while requirements are missing.`,
      path: `${path}.state`,
    });
  }

  return issues;
}

export function validateSolutionGenerationCoverageV1(
  input: unknown,
): SolutionGenerationCoverageV1 {
  const coverage = solutionGenerationCoverageV1Schema.parse(input);
  const issues: SolutionLifecycleIssue[] = [
    ...validateCoverageRecord(coverage, "$"),
  ];

  findDuplicateValues(
    coverage.workloads.map((workload) => workload.workloadId),
  ).forEach((workloadId) => {
    issues.push({
      code: "duplicate-workload-coverage",
      message: `Workload ${workloadId} has duplicate coverage records.`,
      path: "$.workloads",
    });
  });

  coverage.workloads.forEach((workload, index) => {
    issues.push(
      ...validateCoverageRecord(workload, `$.workloads[${String(index)}]`),
    );
  });

  if (issues.length > 0) {
    throw new SolutionLifecycleValidationError(issues);
  }
  return coverage;
}

/**
 * Validates only invariants contained in the manifest itself.
 * External Evidence records are intentionally not resolved by this function.
 */
export function validateSolutionRevisionManifestIntrinsicV1(
  input: unknown,
): SolutionRevisionManifestV1 {
  const manifest = solutionRevisionManifestV1Schema.parse(input);
  const coverage = validateSolutionGenerationCoverageV1(
    manifest.generationCoverage,
  );
  const issues: SolutionLifecycleIssue[] = [];

  findDuplicateValues(manifest.evidenceIdsAtFreeze).forEach((evidenceId) => {
    issues.push({
      code: "duplicate-frozen-evidence-id",
      message: `Evidence ID ${evidenceId} is duplicated in the freeze-time snapshot.`,
      path: "$.evidenceIdsAtFreeze",
    });
  });

  const frozenEvidenceIds = new Set(manifest.evidenceIdsAtFreeze);
  const coverageEvidence = [
    ...coverage.evidence.map((entry, index) => ({
      evidenceId: entry.evidenceId,
      path: `$.generationCoverage.evidence[${String(index)}].evidenceId`,
    })),
    ...coverage.workloads.flatMap((workload, workloadIndex) =>
      workload.evidence.map((entry, evidenceIndex) => ({
        evidenceId: entry.evidenceId,
        path: `$.generationCoverage.workloads[${String(
          workloadIndex,
        )}].evidence[${String(evidenceIndex)}].evidenceId`,
      })),
    ),
  ];
  coverageEvidence.forEach(({ evidenceId, path }) => {
    if (!frozenEvidenceIds.has(evidenceId)) {
      issues.push({
        code: "coverage-evidence-not-frozen",
        message: `Coverage evidence ${evidenceId} is not present in the freeze-time evidence snapshot.`,
        path,
      });
    }
  });

  if (issues.length > 0) {
    throw new SolutionLifecycleValidationError(issues);
  }
  return { ...manifest, generationCoverage: coverage };
}
