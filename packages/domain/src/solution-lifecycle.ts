import {
  activeIssueV1Schema,
  aiAuthoredExtensionV1Schema,
  evidenceCollectionV1Schema,
  generationCoverageEvidenceLevelByRequirement,
  normalizeActiveIssueV1,
  type ActiveIssueV1,
  type AiAuthoredExtensionV1,
  type EvidenceCollectionV1,
  type EvidenceRecordV1,
  type GenerationCoverageRequirement,
  type SolutionRevisionManifestV1,
} from "@cloudmarkup/schemas";

import {
  getAiAuthoredExtensionContentHash,
  hashCanonicalValue,
} from "./document-hashing.js";
import {
  SolutionLifecycleValidationError,
  findDuplicateValues,
  validateSolutionRevisionManifestIntrinsicV1,
  type SolutionLifecycleIssue,
} from "./solution-coverage-validation.js";

export {
  SolutionLifecycleValidationError,
  validateSolutionGenerationCoverageV1,
  validateSolutionRevisionManifestIntrinsicV1,
  type SolutionLifecycleIssue,
  type SolutionLifecycleIssueCode,
} from "./solution-coverage-validation.js";
export function validateEvidenceCollectionV1(
  input: unknown,
): EvidenceCollectionV1 {
  const collection = evidenceCollectionV1Schema.parse(input);
  const duplicates = findDuplicateValues(
    collection.records.map((record) => record.id),
  );
  if (duplicates.length > 0) {
    throw new SolutionLifecycleValidationError(
      duplicates.map((id) => ({
        code: "duplicate-evidence-id",
        message: `Evidence ID ${id} is duplicated.`,
        path: "$.records",
      })),
    );
  }
  return collection;
}
export interface ValidatedSolutionRevisionManifestWithEvidenceV1 {
  readonly evidenceCollection: EvidenceCollectionV1;
  readonly manifest: SolutionRevisionManifestV1;
}

interface CoverageEvidenceReference {
  readonly evidenceId: EvidenceRecordV1["id"];
  readonly path: string;
  readonly requirement: GenerationCoverageRequirement;
}

function getCoverageEvidenceReferences(
  manifest: SolutionRevisionManifestV1,
): readonly CoverageEvidenceReference[] {
  return [
    ...manifest.generationCoverage.evidence.map((entry, index) => ({
      evidenceId: entry.evidenceId,
      path: `$.manifest.generationCoverage.evidence[${String(index)}]`,
      requirement: entry.requirement,
    })),
    ...manifest.generationCoverage.workloads.flatMap(
      (workload, workloadIndex) =>
        workload.evidence.map((entry, evidenceIndex) => ({
          evidenceId: entry.evidenceId,
          path: `$.manifest.generationCoverage.workloads[${String(
            workloadIndex,
          )}].evidence[${String(evidenceIndex)}]`,
          requirement: entry.requirement,
        })),
    ),
  ];
}

/**
 * Validates manifest-contained invariants and every frozen or coverage Evidence
 * reference against one external collection. This is the completeness authority;
 * intrinsic manifest validation and content hashing do not resolve records.
 */
export function validateSolutionRevisionManifestWithEvidenceV1(
  manifestInput: unknown,
  evidenceCollectionInput: unknown,
): ValidatedSolutionRevisionManifestWithEvidenceV1 {
  const manifest = validateSolutionRevisionManifestIntrinsicV1(manifestInput);
  const evidenceCollection = validateEvidenceCollectionV1(
    evidenceCollectionInput,
  );
  const issues: SolutionLifecycleIssue[] = [];
  const evidenceRecordsById = new Map(
    evidenceCollection.records.map((record, index) => [
      record.id,
      { index, record },
    ]),
  );

  manifest.evidenceIdsAtFreeze.forEach((evidenceId, referenceIndex) => {
    const indexedRecord = evidenceRecordsById.get(evidenceId);
    if (indexedRecord === undefined) {
      issues.push({
        code: "evidence-record-missing",
        message: `Frozen Evidence record ${evidenceId} is missing from the collection.`,
        path: `$.manifest.evidenceIdsAtFreeze[${String(referenceIndex)}]`,
      });
      return;
    }

    const recordPath = `$.evidenceCollection.records[${String(
      indexedRecord.index,
    )}]`;
    if (
      indexedRecord.record.solutionRevisionId !== manifest.solutionRevisionId
    ) {
      issues.push({
        code: "evidence-revision-mismatch",
        message: `Evidence record ${evidenceId} does not bind Solution Revision ${manifest.solutionRevisionId}.`,
        path: `${recordPath}.solutionRevisionId`,
      });
    }
    if (indexedRecord.record.staleness.state !== "current") {
      issues.push({
        code: "evidence-stale",
        message: `Evidence record ${evidenceId} is stale.`,
        path: `${recordPath}.staleness.state`,
      });
    }
    indexedRecord.record.checks.forEach((check, checkIndex) => {
      if (check.status !== "passed") {
        issues.push({
          code: "evidence-check-not-passed",
          message: `Evidence record ${evidenceId} check ${check.checkId} has status ${check.status}.`,
          path: `${recordPath}.checks[${String(checkIndex)}].status`,
        });
      }
    });
  });

  getCoverageEvidenceReferences(manifest).forEach((reference) => {
    const expectedLevel =
      generationCoverageEvidenceLevelByRequirement[reference.requirement];
    const indexedRecord = evidenceRecordsById.get(reference.evidenceId);
    if (indexedRecord === undefined) {
      return;
    }

    if (
      indexedRecord.record.level.kind !== expectedLevel.kind ||
      indexedRecord.record.level.rank !== expectedLevel.rank
    ) {
      issues.push({
        code: "evidence-level-kind-mismatch",
        message: `Coverage requirement ${reference.requirement} requires exact Evidence level ${String(expectedLevel.rank)} (${expectedLevel.kind}), but record ${reference.evidenceId} has level ${String(indexedRecord.record.level.rank)} (${indexedRecord.record.level.kind}).`,
        path: `$.evidenceCollection.records[${String(
          indexedRecord.index,
        )}].level.kind`,
      });
    }

    const matchingCheck = indexedRecord.record.checks.find(
      (check) =>
        check.generationCoverageRequirement === reference.requirement &&
        check.status === "passed",
    );
    if (matchingCheck === undefined) {
      issues.push({
        code: "coverage-requirement-check-missing",
        message: `Evidence record ${reference.evidenceId} has no passed check claiming coverage requirement ${reference.requirement}.`,
        path: `$.evidenceCollection.records[${String(
          indexedRecord.index,
        )}].checks`,
      });
    }
  });

  if (issues.length > 0) {
    throw new SolutionLifecycleValidationError(issues);
  }
  return { evidenceCollection, manifest };
}

export function hasCurrentEvidenceAtExactLevel(
  records: readonly EvidenceRecordV1[],
  solutionRevisionId: string,
  rank: EvidenceRecordV1["level"]["rank"],
): boolean {
  return records.some(
    (record) =>
      record.solutionRevisionId === solutionRevisionId &&
      record.level.rank === rank &&
      record.staleness.state === "current" &&
      record.checks.every((check) => check.status === "passed"),
  );
}

export function getActiveIssueRecordHash(issueInput: unknown) {
  const issue = normalizeActiveIssueV1(activeIssueV1Schema.parse(issueInput));
  const projection: Partial<ActiveIssueV1> = { ...issue };
  delete projection.currentRecordDigest;
  return hashCanonicalValue(projection);
}

function getActiveIssueOriginHash(issueInput: ActiveIssueV1) {
  const issue = normalizeActiveIssueV1(issueInput);
  return hashCanonicalValue({
    affected: issue.affected,
    category: issue.category,
    source: issue.source,
    sourceRecordId: issue.sourceRecordId,
  });
}

function getActiveIssueClosureRequirementsHash(issueInput: ActiveIssueV1) {
  return hashCanonicalValue(
    normalizeActiveIssueV1(issueInput).closureRequirements,
  );
}

function validateActiveIssueResolutionEvidenceV1(
  next: ActiveIssueV1,
  evidenceCollectionInput: unknown,
): readonly SolutionLifecycleIssue[] {
  if (next.lifecycle.state !== "resolved") {
    return [];
  }
  if (evidenceCollectionInput === undefined) {
    return [
      {
        code: "issue-resolution-evidence-collection-required",
        message:
          "Resolving an issue requires the referenced Evidence collection.",
        path: "$.evidenceCollection",
      },
    ];
  }

  const evidenceCollection = validateEvidenceCollectionV1(
    evidenceCollectionInput,
  );
  const issues: SolutionLifecycleIssue[] = [];
  const recordsById = new Map(
    evidenceCollection.records.map((record, index) => [
      record.id,
      { index, record },
    ]),
  );
  const referencedRecords: {
    readonly index: number;
    readonly record: EvidenceRecordV1;
  }[] = [];

  findDuplicateValues(next.lifecycle.evidenceIds).forEach((evidenceId) => {
    issues.push({
      code: "duplicate-issue-resolution-evidence-id",
      message: `Issue resolution Evidence ID ${evidenceId} is duplicated.`,
      path: "$.next.lifecycle.evidenceIds",
    });
  });

  next.lifecycle.evidenceIds.forEach((evidenceId, referenceIndex) => {
    const indexedRecord = recordsById.get(evidenceId);
    if (indexedRecord === undefined) {
      issues.push({
        code: "evidence-record-missing",
        message: `Issue resolution Evidence record ${evidenceId} is missing from the collection.`,
        path: `$.next.lifecycle.evidenceIds[${String(referenceIndex)}]`,
      });
      return;
    }
    referencedRecords.push(indexedRecord);

    const recordPath = `$.evidenceCollection.records[${String(
      indexedRecord.index,
    )}]`;
    if (indexedRecord.record.solutionRevisionId !== next.solutionRevisionId) {
      issues.push({
        code: "evidence-revision-mismatch",
        message: `Issue resolution Evidence record ${evidenceId} does not bind Solution Revision ${next.solutionRevisionId}.`,
        path: `${recordPath}.solutionRevisionId`,
      });
    }
    if (indexedRecord.record.staleness.state !== "current") {
      issues.push({
        code: "evidence-stale",
        message: `Issue resolution Evidence record ${evidenceId} is stale.`,
        path: `${recordPath}.staleness.state`,
      });
    }
    indexedRecord.record.checks.forEach((check, checkIndex) => {
      if (check.status !== "passed") {
        issues.push({
          code: "evidence-check-not-passed",
          message: `Issue resolution Evidence record ${evidenceId} check ${check.checkId} has status ${check.status}.`,
          path: `${recordPath}.checks[${String(checkIndex)}].status`,
        });
      }
    });
    if (
      !indexedRecord.record.checks.some((check) =>
        check.issueIds.includes(next.id),
      )
    ) {
      issues.push({
        code: "issue-resolution-evidence-not-linked",
        message: `Issue resolution Evidence record ${evidenceId} has no check linked to issue ${next.id}.`,
        path: `${recordPath}.checks`,
      });
    }
  });

  next.closureRequirements.forEach((requirement, requirementIndex) => {
    const satisfied = referencedRecords.some(
      ({ record }) =>
        record.level.kind === requirement.evidenceLevel.kind &&
        record.level.rank === requirement.evidenceLevel.rank &&
        record.checks.some(
          (check) =>
            check.checkId === requirement.evidenceCheckId &&
            check.status === "passed" &&
            check.issueIds.includes(next.id),
        ),
    );
    if (!satisfied) {
      issues.push({
        code: "issue-closure-requirement-unsatisfied",
        message: `No referenced Evidence record satisfies closure check ${requirement.evidenceCheckId} at exact level ${String(requirement.evidenceLevel.rank)} (${requirement.evidenceLevel.kind}).`,
        path: `$.next.closureRequirements[${String(requirementIndex)}]`,
      });
    }
  });

  return issues;
}
const allowedIssueTransitions: Readonly<Record<string, readonly string[]>> =
  Object.freeze({
    current: Object.freeze(["accepted", "deferred", "resolved", "stale"]),
    stale: Object.freeze(["accepted", "current", "deferred", "resolved"]),
    deferred: Object.freeze(["accepted", "current", "resolved", "stale"]),
    accepted: Object.freeze(["current", "resolved", "stale"]),
    resolved: Object.freeze(["current"]),
  });

export function validateActiveIssueTransitionV1(
  previousInput: unknown,
  nextInput: unknown,
  evidenceCollectionInput?: unknown,
): ActiveIssueV1 {
  const previous = activeIssueV1Schema.parse(previousInput);
  const next = activeIssueV1Schema.parse(nextInput);
  const issues: SolutionLifecycleIssue[] = [];

  if (previous.currentRecordDigest !== getActiveIssueRecordHash(previous)) {
    issues.push({
      code: "issue-digest-mismatch",
      message: "The previous issue record digest does not match its content.",
      path: "$.previous.currentRecordDigest",
    });
  }
  if (next.currentRecordDigest !== getActiveIssueRecordHash(next)) {
    issues.push({
      code: "issue-digest-mismatch",
      message: "The next issue record digest does not match its content.",
      path: "$.next.currentRecordDigest",
    });
  }
  if (
    previous.id !== next.id ||
    previous.solutionRevisionId !== next.solutionRevisionId
  ) {
    issues.push({
      code: "issue-identity-mismatch",
      message: "Issue identity and Solution Revision binding cannot change.",
      path: "$.next.id",
    });
  }
  if (getActiveIssueOriginHash(previous) !== getActiveIssueOriginHash(next)) {
    issues.push({
      code: "issue-identity-mismatch",
      message:
        "Issue source, source record, category, and affected lineage cannot change.",
      path: "$.next.source",
    });
  }
  if (
    getActiveIssueClosureRequirementsHash(previous) !==
    getActiveIssueClosureRequirementsHash(next)
  ) {
    issues.push({
      code: "issue-closure-requirements-mismatch",
      message:
        "Issue closure requirements cannot change across lifecycle records.",
      path: "$.next.closureRequirements",
    });
  }
  if (next.recordVersion !== previous.recordVersion + 1) {
    issues.push({
      code: "issue-record-version-mismatch",
      message: "The next issue record version must increment by one.",
      path: "$.next.recordVersion",
    });
  }
  if (next.previousRecordDigest !== previous.currentRecordDigest) {
    issues.push({
      code: "issue-previous-digest-mismatch",
      message: "The next issue record must bind the previous immutable digest.",
      path: "$.next.previousRecordDigest",
    });
  }
  if (
    !(allowedIssueTransitions[previous.lifecycle.state] ?? []).includes(
      next.lifecycle.state,
    )
  ) {
    issues.push({
      code: "issue-transition-not-allowed",
      message: `Issue state ${previous.lifecycle.state} cannot transition to ${next.lifecycle.state}.`,
      path: "$.next.lifecycle.state",
    });
  }

  issues.push(
    ...validateActiveIssueResolutionEvidenceV1(next, evidenceCollectionInput),
  );

  if (issues.length > 0) {
    throw new SolutionLifecycleValidationError(issues);
  }
  return next;
}

export function getAiAuthoredExtensionHash(input: unknown) {
  return getAiAuthoredExtensionContentHash(input);
}

export function parseAiAuthoredExtensionV1(
  input: unknown,
): AiAuthoredExtensionV1 {
  return aiAuthoredExtensionV1Schema.parse(input);
}
