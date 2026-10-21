import {
  activeIssueIdSchema,
  activeIssueV1Schema,
  aiExtensionIdSchema,
  evidenceRecordV1Schema,
  utcTimestampSchema,
  type ActiveIssueAffectedReferenceV1,
  type ActiveIssueV1,
  type EvidenceLevel,
  type EvidenceRecordV1,
  type Sha256Digest,
} from "@cloudmarkup/schemas";
import {
  getActiveIssueRecordHash,
  validateActiveIssueTransitionV1,
} from "@cloudmarkup/domain";
import { z } from "zod";

import {
  AI_EXTENSION_GENERATION_COORDINATOR_ID,
  AI_EXTENSION_GENERATION_COORDINATOR_VERSION,
  type CandidateDiagnosticV1,
} from "./contracts.js";
import { digestCanonicalValue, stableRecordId } from "./security.js";

function issueCategory(
  diagnostic: CandidateDiagnosticV1,
): ActiveIssueV1["category"] {
  switch (diagnostic.category) {
    case "ownership":
      return "source-ownership";
    case "security":
      return "security";
    case "dependency":
    case "provenance":
      return "compatibility";
    case "target-readiness":
      return "provider";
    case "parse":
    case "format":
    case "static-analysis":
      return "generation";
    case "build":
    case "unit-test":
    case "integration-test":
    case "contract-test":
      return "verification";
    case "admission":
    case "repair":
      return "generation";
  }
}

function issueSeverity(
  diagnostic: CandidateDiagnosticV1,
): ActiveIssueV1["severity"] {
  if (diagnostic.category === "security" && diagnostic.severity === "error") {
    return "security-error";
  }
  if (diagnostic.severity === "error") return "error";
  if (diagnostic.severity === "warning") return "warning";
  return "educational-note";
}

export function createCandidateIssues(input: {
  readonly affected?: readonly ActiveIssueAffectedReferenceV1[];
  readonly assessedAt: string;
  readonly bundleDigest: Sha256Digest;
  readonly diagnostics: readonly CandidateDiagnosticV1[];
  readonly evidenceLevel?: EvidenceLevel;
  readonly extensionId: string;
  readonly inputDigests: readonly Sha256Digest[];
  readonly solutionRevisionId: string;
  readonly source: ActiveIssueV1["source"];
}): readonly ActiveIssueV1[] {
  const evidenceLevel = input.evidenceLevel ?? {
    kind: "ai-extension-parse-static-validity",
    rank: 4,
  };
  return Object.freeze(
    input.diagnostics.map((diagnostic) => {
      const identity = {
        bundleDigest: input.bundleDigest,
        category: diagnostic.category,
        checkId: diagnostic.checkId,
        code: diagnostic.code,
        extensionId: input.extensionId,
        path: diagnostic.path,
        solutionRevisionId: input.solutionRevisionId,
        source: input.source,
      };
      const issueId = stableRecordId("issue-ai-extension", identity);
      const placeholder = {
        affected:
          input.affected === undefined || input.affected.length === 0
            ? [
                {
                  kind: "solution-revision" as const,
                  solutionRevisionId: input.solutionRevisionId,
                },
              ]
            : [...input.affected],
        category: issueCategory(diagnostic),
        closureRequirements: [
          {
            description:
              "Re-run the exact deterministic candidate validation check successfully.",
            evidenceCheckId: diagnostic.checkId,
            evidenceLevel,
          },
        ],
        contractVersion: 1 as const,
        currentRecordDigest: input.bundleDigest,
        id: issueId,
        lifecycle: { state: "current" as const },
        provenance: {
          actor: {
            kind: "deterministic-tool" as const,
            tool: {
              id: AI_EXTENSION_GENERATION_COORDINATOR_ID,
              version: AI_EXTENSION_GENERATION_COORDINATOR_VERSION,
            },
          },
          createdAt: input.assessedAt,
          inputDigests: [
            ...new Set([input.bundleDigest, ...input.inputDigests]),
          ].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)),
        },
        recordVersion: 1,
        severity: issueSeverity(diagnostic),
        solutionRevisionId: input.solutionRevisionId,
        source: input.source,
        sourceRecordId: stableRecordId("candidate-finding", identity),
        summary: diagnostic.summary,
        technicalDetail: diagnostic.technicalDetail,
      };
      return activeIssueV1Schema.parse({
        ...placeholder,
        currentRecordDigest: getActiveIssueRecordHash(placeholder),
      });
    }),
  );
}

const maximumCandidateIssueDiagnostics = 1_000;
const maximumCandidateIssueEvidenceRecords = 256;
const maximumCandidateIssueHistoryRecords = 10_000;
const maximumCandidateRepairIssueIds = 256;
const maximumCandidateIssueInputDigests = 256;
const candidateIssueRepairValidationStatusV1Schema = z.enum([
  "validation-pending",
  "rejected",
  "validated-for-review",
]);

export interface CandidateIssueRepairReferenceV1 {
  readonly description: string;
  readonly issueIds: readonly string[];
  readonly proposedPatchDigest: Sha256Digest;
  readonly validationStatus: z.output<
    typeof candidateIssueRepairValidationStatusV1Schema
  >;
}
interface ParsedCandidateIssueRepairReferenceV1 extends Omit<
  CandidateIssueRepairReferenceV1,
  "issueIds"
> {
  readonly issueIds: readonly ActiveIssueV1["id"][];
}

export interface CandidateIssueReconciliationInputV1 {
  readonly affected?: readonly ActiveIssueAffectedReferenceV1[];
  readonly assessedAt: string;
  readonly bundleDigest: Sha256Digest;
  readonly diagnostics: readonly CandidateDiagnosticV1[];
  readonly evidence?: readonly EvidenceRecordV1[];
  readonly evidenceLevel?: EvidenceLevel;
  readonly extensionId: string;
  readonly inputDigests: readonly Sha256Digest[];
  readonly markMissingAsStale: boolean;
  readonly previousRecords?: readonly ActiveIssueV1[];
  readonly repairReference?: CandidateIssueRepairReferenceV1;
  readonly solutionRevisionId: string;
  readonly source: ActiveIssueV1["source"];
}

export interface CandidateIssueReconciliationV1 {
  readonly appendedRecords: readonly ActiveIssueV1[];
  readonly currentIssues: readonly ActiveIssueV1[];
  readonly history: readonly ActiveIssueV1[];
  readonly latestRecords: readonly ActiveIssueV1[];
  readonly resolvedIssueIds: readonly string[];
  readonly staleIssueIds: readonly string[];
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function distinctSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareText);
}

function assertBoundedLength(
  name: string,
  actual: number,
  maximum: number,
): void {
  if (actual > maximum) {
    throw new Error(
      name + " exceeds the bounded candidate issue reconciliation limit.",
    );
  }
}

function parseEvidenceRecords(
  records: readonly EvidenceRecordV1[],
): EvidenceRecordV1[] {
  assertBoundedLength(
    "Candidate issue Evidence",
    records.length,
    maximumCandidateIssueEvidenceRecords,
  );
  return records.map((record) => evidenceRecordV1Schema.parse(record));
}

function evidenceCollection(records: readonly EvidenceRecordV1[]) {
  return {
    contractVersion: 1 as const,
    records: [...records],
  };
}

function validatePreviousHistory(input: {
  readonly evidence: readonly EvidenceRecordV1[];
  readonly previousRecords: readonly ActiveIssueV1[];
  readonly solutionRevisionId: string;
}): ActiveIssueV1[] {
  assertBoundedLength(
    "Candidate issue history",
    input.previousRecords.length,
    maximumCandidateIssueHistoryRecords,
  );
  const parsed = input.previousRecords.map((record) =>
    activeIssueV1Schema.parse(record),
  );
  const identities = new Set<string>();
  const recordsByIssue = new Map<ActiveIssueV1["id"], ActiveIssueV1[]>();
  for (const record of parsed) {
    if (record.solutionRevisionId !== input.solutionRevisionId) {
      throw new Error(
        "Candidate issue history must bind the exact Solution Revision.",
      );
    }
    if (getActiveIssueRecordHash(record) !== record.currentRecordDigest) {
      throw new Error(
        "Candidate issue history contains an invalid immutable record digest.",
      );
    }
    const identity = record.id + "\u0000" + String(record.recordVersion);
    if (identities.has(identity)) {
      throw new Error(
        "Candidate issue history contains a duplicate record version.",
      );
    }
    identities.add(identity);
    const issueRecords = recordsByIssue.get(record.id) ?? [];
    issueRecords.push(record);
    recordsByIssue.set(record.id, issueRecords);
  }

  const collection = evidenceCollection(input.evidence);
  for (const records of recordsByIssue.values()) {
    const ordered = [...records].sort(
      (left, right) => left.recordVersion - right.recordVersion,
    );
    if (ordered[0]?.recordVersion !== 1) {
      throw new Error(
        "Candidate issue history must retain the first immutable record.",
      );
    }
    for (let index = 1; index < ordered.length; index += 1) {
      const previous = ordered[index - 1];
      const next = ordered[index];
      if (previous === undefined || next === undefined) {
        throw new Error("Candidate issue history is incomplete.");
      }
      validateActiveIssueTransitionV1(previous, next, collection);
    }
  }
  return parsed;
}

function latestIssueRecords(
  history: readonly ActiveIssueV1[],
): Map<ActiveIssueV1["id"], ActiveIssueV1> {
  const latest = new Map<ActiveIssueV1["id"], ActiveIssueV1>();
  for (const record of history) {
    const existing = latest.get(record.id);
    if (
      existing === undefined ||
      record.recordVersion > existing.recordVersion
    ) {
      latest.set(record.id, record);
    }
  }
  return latest;
}

function parseRepairReference(
  input: CandidateIssueRepairReferenceV1 | undefined,
): ParsedCandidateIssueRepairReferenceV1 | undefined {
  if (input === undefined) return undefined;
  const description = input.description.trim();
  if (description.length === 0 || description.length > 500) {
    throw new Error(
      "Candidate repair references require a bounded plain-language description.",
    );
  }
  assertBoundedLength(
    "Candidate repair issue references",
    input.issueIds.length,
    maximumCandidateRepairIssueIds,
  );
  if (input.issueIds.length === 0) {
    throw new Error(
      "An actual candidate repair reference must name at least one existing issue.",
    );
  }
  if (new Set(input.issueIds).size !== input.issueIds.length) {
    throw new Error("Candidate repair issue references must be unique.");
  }
  if (!/^sha256:[a-f0-9]{64}$/u.test(input.proposedPatchDigest)) {
    throw new Error(
      "Candidate repair references require an exact SHA-256 proposal digest.",
    );
  }
  const validationStatus = candidateIssueRepairValidationStatusV1Schema.parse(
    input.validationStatus,
  );
  return Object.freeze({
    description,
    issueIds: Object.freeze(
      input.issueIds.map((issueId) => activeIssueIdSchema.parse(issueId)),
    ),
    proposedPatchDigest: input.proposedPatchDigest,
    validationStatus,
  });
}

function closureEvidenceForIssue(
  issue: ActiveIssueV1,
  records: readonly EvidenceRecordV1[],
): readonly EvidenceRecordV1[] {
  if (issue.closureRequirements.length === 0) return [];
  const eligible = records
    .filter(
      (record) =>
        record.solutionRevisionId === issue.solutionRevisionId &&
        record.staleness.state === "current" &&
        record.checks.every((check) => check.status === "passed"),
    )
    .sort((left, right) => compareText(left.id, right.id));
  const selected: EvidenceRecordV1[] = [];
  for (const requirement of issue.closureRequirements) {
    const record = eligible.find(
      (candidate) =>
        candidate.level.kind === requirement.evidenceLevel.kind &&
        candidate.level.rank === requirement.evidenceLevel.rank &&
        candidate.checks.some(
          (check) =>
            check.checkId === requirement.evidenceCheckId &&
            check.status === "passed" &&
            check.issueIds.includes(issue.id),
        ),
    );
    if (record === undefined) return [];
    if (!selected.some(({ id }) => id === record.id)) selected.push(record);
  }
  return selected;
}

function aiFixForRepair(
  extensionId: string,
  repair: CandidateIssueRepairReferenceV1,
): NonNullable<ActiveIssueV1["aiProposedFix"]> {
  return {
    description: repair.description,
    extensionId: aiExtensionIdSchema.parse(extensionId),
    proposedPatchDigest: repair.proposedPatchDigest,
    validationStatus: repair.validationStatus,
  };
}

function transitionIssue(input: {
  readonly assessedAt: string;
  readonly bundleDigest: Sha256Digest;
  readonly evidence: readonly EvidenceRecordV1[];
  readonly extensionId: string;
  readonly inputDigests: readonly Sha256Digest[];
  readonly lifecycle: ActiveIssueV1["lifecycle"];
  readonly previous: ActiveIssueV1;
  readonly repair?: CandidateIssueRepairReferenceV1;
  readonly replacementCopy?: ActiveIssueV1;
}): ActiveIssueV1 {
  const evidenceDigests = input.evidence.map((record) =>
    digestCanonicalValue(record),
  );
  const provenanceInputDigests = distinctSorted([
    input.previous.currentRecordDigest,
    input.bundleDigest,
    ...input.inputDigests,
    ...evidenceDigests,
  ]);
  assertBoundedLength(
    "Candidate issue transition provenance",
    provenanceInputDigests.length,
    maximumCandidateIssueInputDigests,
  );
  const placeholder = activeIssueV1Schema.parse({
    ...input.previous,
    ...(input.replacementCopy === undefined
      ? {}
      : {
          severity: input.replacementCopy.severity,
          summary: input.replacementCopy.summary,
          technicalDetail: input.replacementCopy.technicalDetail,
        }),
    ...(input.repair === undefined
      ? {}
      : { aiProposedFix: aiFixForRepair(input.extensionId, input.repair) }),
    currentRecordDigest: input.bundleDigest,
    lifecycle: input.lifecycle,
    previousRecordDigest: input.previous.currentRecordDigest,
    provenance: {
      actor: {
        kind: "deterministic-tool",
        tool: {
          id: AI_EXTENSION_GENERATION_COORDINATOR_ID,
          version: AI_EXTENSION_GENERATION_COORDINATOR_VERSION,
        },
      },
      createdAt: input.assessedAt,
      inputDigests: provenanceInputDigests,
    },
    recordVersion: input.previous.recordVersion + 1,
  });
  const next = activeIssueV1Schema.parse({
    ...placeholder,
    currentRecordDigest: getActiveIssueRecordHash(placeholder),
  });
  return validateActiveIssueTransitionV1(
    input.previous,
    next,
    evidenceCollection(input.evidence),
  );
}

export function reconcileCandidateIssues(
  input: CandidateIssueReconciliationInputV1,
): CandidateIssueReconciliationV1 {
  assertBoundedLength(
    "Candidate issue diagnostics",
    input.diagnostics.length,
    maximumCandidateIssueDiagnostics,
  );
  assertBoundedLength(
    "Candidate issue input digests",
    input.inputDigests.length + 1,
    maximumCandidateIssueInputDigests,
  );
  const evidence = parseEvidenceRecords(input.evidence ?? []);
  const previousHistory = validatePreviousHistory({
    evidence,
    previousRecords: input.previousRecords ?? [],
    solutionRevisionId: input.solutionRevisionId,
  });
  const previousLatest = latestIssueRecords(previousHistory);
  const latest = new Map(previousLatest);
  const repair = parseRepairReference(input.repairReference);
  const repairByIssueId = new Map(
    (repair?.issueIds ?? []).map((issueId) => [issueId, repair] as const),
  );
  for (const issueId of repairByIssueId.keys()) {
    if (previousLatest.get(issueId)?.lifecycle.state !== "current") {
      throw new Error(
        "An actual candidate repair may reference only an exact current issue.",
      );
    }
  }

  const currentCandidates = [...createCandidateIssues(input)].sort(
    (left, right) => compareText(left.id, right.id),
  );
  const currentCandidateIds = new Set(currentCandidates.map(({ id }) => id));
  const appended: ActiveIssueV1[] = [];
  const consumedRepairIssueIds = new Set<string>();
  const append = (record: ActiveIssueV1): void => {
    if (
      previousHistory.length + appended.length >=
      maximumCandidateIssueHistoryRecords
    ) {
      throw new Error(
        "Candidate issue history cannot discard records to satisfy its bound.",
      );
    }
    appended.push(record);
    latest.set(record.id, record);
  };

  for (const candidate of currentCandidates) {
    const previous = latest.get(candidate.id);
    const candidateRepair = repairByIssueId.get(candidate.id);
    if (previous === undefined) {
      append(candidate);
      continue;
    }
    if (previous.lifecycle.state === "current") {
      if (candidateRepair?.validationStatus === "validation-pending") {
        const pending = transitionIssue({
          assessedAt: input.assessedAt,
          bundleDigest: input.bundleDigest,
          evidence: [],
          extensionId: input.extensionId,
          inputDigests: input.inputDigests,
          lifecycle: {
            reason:
              "The AI repair proposal is awaiting the full deterministic validation pipeline.",
            staleAt: utcTimestampSchema.parse(input.assessedAt),
            state: "stale",
          },
          previous,
          repair: candidateRepair,
        });
        append(pending);
        append(
          transitionIssue({
            assessedAt: input.assessedAt,
            bundleDigest: input.bundleDigest,
            evidence: [],
            extensionId: input.extensionId,
            inputDigests: input.inputDigests,
            lifecycle: { state: "current" },
            previous: pending,
            replacementCopy: candidate,
          }),
        );
        consumedRepairIssueIds.add(candidate.id);
        continue;
      }
      if (candidateRepair?.validationStatus === "validated-for-review") {
        throw new Error(
          "A validated AI repair cannot retain the exact issue as current.",
        );
      }
      if (candidateRepair?.validationStatus === "rejected") {
        const stale = transitionIssue({
          assessedAt: input.assessedAt,
          bundleDigest: input.bundleDigest,
          evidence: [],
          extensionId: input.extensionId,
          inputDigests: input.inputDigests,
          lifecycle: {
            reason:
              "The actual AI repair was rejected and this diagnostic record was superseded.",
            staleAt: utcTimestampSchema.parse(input.assessedAt),
            state: "stale",
          },
          previous,
          repair: candidateRepair,
        });
        append(stale);
        consumedRepairIssueIds.add(candidate.id);
        append(
          transitionIssue({
            assessedAt: input.assessedAt,
            bundleDigest: input.bundleDigest,
            evidence: [],
            extensionId: input.extensionId,
            inputDigests: input.inputDigests,
            lifecycle: { state: "current" },
            previous: stale,
            replacementCopy: candidate,
          }),
        );
      }
      continue;
    }
    append(
      transitionIssue({
        assessedAt: input.assessedAt,
        bundleDigest: input.bundleDigest,
        evidence: [],
        extensionId: input.extensionId,
        inputDigests: input.inputDigests,
        lifecycle: { state: "current" },
        previous,
        replacementCopy: candidate,
      }),
    );
  }

  for (const [issueId, previous] of [...previousLatest.entries()].sort(
    ([left], [right]) => compareText(left, right),
  )) {
    if (
      previous.lifecycle.state !== "current" ||
      currentCandidateIds.has(issueId)
    ) {
      continue;
    }
    const issueRepair = repairByIssueId.get(issueId);
    if (issueRepair?.validationStatus === "validation-pending") {
      const pending = transitionIssue({
        assessedAt: input.assessedAt,
        bundleDigest: input.bundleDigest,
        evidence: [],
        extensionId: input.extensionId,
        inputDigests: input.inputDigests,
        lifecycle: {
          reason:
            "The AI repair proposal is awaiting the full deterministic validation pipeline.",
          staleAt: utcTimestampSchema.parse(input.assessedAt),
          state: "stale",
        },
        previous,
        repair: issueRepair,
      });
      append(pending);
      append(
        transitionIssue({
          assessedAt: input.assessedAt,
          bundleDigest: input.bundleDigest,
          evidence: [],
          extensionId: input.extensionId,
          inputDigests: input.inputDigests,
          lifecycle: { state: "current" },
          previous: pending,
        }),
      );
      consumedRepairIssueIds.add(issueId);
      continue;
    }
    const closureEvidence = closureEvidenceForIssue(previous, evidence);
    if (closureEvidence.length > 0) {
      if (issueRepair?.validationStatus === "rejected") {
        throw new Error(
          "A rejected AI repair cannot also resolve the same issue with passing Evidence.",
        );
      }
      append(
        transitionIssue({
          assessedAt: input.assessedAt,
          bundleDigest: input.bundleDigest,
          evidence: closureEvidence,
          extensionId: input.extensionId,
          inputDigests: input.inputDigests,
          lifecycle: {
            evidenceIds: closureEvidence.map(({ id }) => id),
            reason:
              "Exact current passing candidate validation Evidence proves this issue is resolved.",
            resolvedAt: utcTimestampSchema.parse(input.assessedAt),
            resolvedBy: AI_EXTENSION_GENERATION_COORDINATOR_ID,
            state: "resolved",
          },
          previous,
          ...(issueRepair === undefined ? {} : { repair: issueRepair }),
        }),
      );
      if (issueRepair !== undefined) consumedRepairIssueIds.add(issueId);
      continue;
    }
    if (issueRepair?.validationStatus === "validated-for-review") {
      throw new Error(
        "A validated-for-review AI repair requires exact passing closure Evidence linked to the issue.",
      );
    }
    if (input.markMissingAsStale || issueRepair !== undefined) {
      append(
        transitionIssue({
          assessedAt: input.assessedAt,
          bundleDigest: input.bundleDigest,
          evidence: [],
          extensionId: input.extensionId,
          inputDigests: input.inputDigests,
          lifecycle: {
            reason:
              issueRepair === undefined
                ? "A complete superseding candidate assessment no longer reports this issue."
                : "The actual AI repair was rejected and did not produce passing closure Evidence.",
            staleAt: utcTimestampSchema.parse(input.assessedAt),
            state: "stale",
          },
          previous,
          ...(issueRepair === undefined ? {} : { repair: issueRepair }),
        }),
      );
      if (issueRepair !== undefined) consumedRepairIssueIds.add(issueId);
    }
  }

  for (const issueId of repairByIssueId.keys()) {
    if (!consumedRepairIssueIds.has(issueId)) {
      throw new Error(
        "Every actual candidate repair reference must produce an auditable issue transition.",
      );
    }
  }

  const latestRecords = [...latest.values()].sort((left, right) =>
    compareText(left.id, right.id),
  );
  const currentIssues = latestRecords.filter(
    ({ lifecycle }) => lifecycle.state === "current",
  );
  return Object.freeze({
    appendedRecords: Object.freeze(appended),
    currentIssues: Object.freeze(currentIssues),
    history: Object.freeze([...previousHistory, ...appended]),
    latestRecords: Object.freeze(latestRecords),
    resolvedIssueIds: Object.freeze(
      latestRecords
        .filter(({ lifecycle }) => lifecycle.state === "resolved")
        .map(({ id }) => id),
    ),
    staleIssueIds: Object.freeze(
      latestRecords
        .filter(({ lifecycle }) => lifecycle.state === "stale")
        .map(({ id }) => id),
    ),
  });
}

const applicationBuildIssueCategories = new Set<
  CandidateDiagnosticV1["category"]
>(["build", "unit-test", "contract-test", "integration-test", "security"]);

/**
 * Reconciles one complete candidate assessment while retaining a single
 * append-only history across the generation and application-build issue
 * sources. The source split is deterministic and shared by generation,
 * repairs, and user edit revalidation.
 */
export function reconcileCandidateIssueAssessment(input: {
  readonly applicationBuildIssues: boolean;
  readonly assessedAt: string;
  readonly bundleDigest: Sha256Digest;
  readonly diagnostics: readonly CandidateDiagnosticV1[];
  readonly evidence?: readonly EvidenceRecordV1[];
  readonly extensionId: string;
  readonly inputDigests: readonly Sha256Digest[];
  readonly markMissingAsStale: boolean;
  readonly previousRecords?: readonly ActiveIssueV1[];
  readonly repairReference?: CandidateIssueRepairReferenceV1;
  readonly solutionRevisionId: string;
}): CandidateIssueReconciliationV1 {
  const previousRecords = input.previousRecords ?? [];
  const latestPrevious = latestIssueRecords(previousRecords);
  const run = (
    source: ActiveIssueV1["source"],
    diagnostics: readonly CandidateDiagnosticV1[],
    evidenceLevel: EvidenceLevel,
  ): CandidateIssueReconciliationV1 => {
    const sourcePrevious = previousRecords.filter(
      (record) => record.source === source,
    );
    const repairIssueIds = (input.repairReference?.issueIds ?? []).filter(
      (issueId) =>
        latestPrevious.get(activeIssueIdSchema.parse(issueId))?.source ===
        source,
    );
    return reconcileCandidateIssues({
      assessedAt: input.assessedAt,
      bundleDigest: input.bundleDigest,
      diagnostics,
      evidence: input.evidence ?? [],
      evidenceLevel,
      extensionId: input.extensionId,
      inputDigests: input.inputDigests,
      markMissingAsStale: input.markMissingAsStale,
      previousRecords: sourcePrevious,
      ...(input.repairReference === undefined || repairIssueIds.length === 0
        ? {}
        : {
            repairReference: {
              ...input.repairReference,
              issueIds: repairIssueIds,
            },
          }),
      solutionRevisionId: input.solutionRevisionId,
      source,
    });
  };

  const buildDiagnostics = input.applicationBuildIssues
    ? input.diagnostics.filter(({ category }) =>
        applicationBuildIssueCategories.has(category),
      )
    : [];
  const generationDiagnostics = input.applicationBuildIssues
    ? input.diagnostics.filter(
        ({ category }) => !applicationBuildIssueCategories.has(category),
      )
    : input.diagnostics;
  const generation = run("ai-generation-repair", generationDiagnostics, {
    kind: "ai-extension-parse-static-validity",
    rank: 4,
  });
  const build = run("application-build-test-security", buildDiagnostics, {
    kind: "application-build-and-tests",
    rank: 5,
  });
  const appendedRecords = [
    ...generation.appendedRecords,
    ...build.appendedRecords,
  ];
  const history = [...previousRecords, ...appendedRecords];
  const latestRecords = [...latestIssueRecords(history).values()].sort(
    (left, right) => compareText(left.id, right.id),
  );
  return Object.freeze({
    appendedRecords: Object.freeze(appendedRecords),
    currentIssues: Object.freeze(
      latestRecords.filter(({ lifecycle }) => lifecycle.state === "current"),
    ),
    history: Object.freeze(history),
    latestRecords: Object.freeze(latestRecords),
    resolvedIssueIds: Object.freeze(
      latestRecords
        .filter(({ lifecycle }) => lifecycle.state === "resolved")
        .map(({ id }) => id),
    ),
    staleIssueIds: Object.freeze(
      latestRecords
        .filter(({ lifecycle }) => lifecycle.state === "stale")
        .map(({ id }) => id),
    ),
  });
}
