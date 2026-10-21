import {
  aiAuthoredExtensionV1Schema,
  modelCandidateBundleV1Schema,
  safeRelativePathSchema,
  sha256DigestSchema,
  solutionStableIdSchema,
  utcTimestampSchema,
  type AiAuthoredExtensionV1,
  type EvidenceRecordV1,
  type ModelCandidateBundleV1,
  type ModelGenerationContextV1,
} from "@cloudmarkup/schemas";
import { z } from "zod";

import {
  candidateArtifactReviewBindingV1Schema,
  createCandidateArtifactReference,
  getCandidateArtifactDigest,
  type CandidateArtifactStore,
  type StoredCandidateArtifactV1,
} from "./artifact-store.js";
import {
  requireCandidateReviewAuthorization,
  type CandidateReviewAllowedAuthorizationDecisionV1,
  type CandidateReviewAuthorizationPort,
} from "./authorization.js";
import {
  candidateDiagnosticV1Schema,
  candidateEditRevalidationFinalizationV1Schema,
  candidateInspectionV1Schema,
  candidateReviewRecordV1Schema,
  candidateScopeV1Schema,
  candidateValidationReplayV1Schema,
  getCandidateEditRevalidationFinalizationDigest,
  getCandidateReviewDigest,
  type CandidateArtifactReferenceV1,
  type CandidateDiagnosticV1,
  type CandidateInspectionV1,
  type CandidateReviewRecordV1,
  type CandidateScopeV1,
  type CandidateUserModificationV1,
} from "./presentation-contracts.js";
import { createCandidateStaticEvidence } from "./evidence.js";
import { reconcileCandidateIssueAssessment } from "./issues.js";
import {
  candidateContentSafetyDiagnostics,
  digestCanonicalValue,
  portablePathKey,
  sha256Text,
  stableRecordId,
  utf8ByteLength,
  validatePortableCandidatePath,
} from "./security.js";
import {
  candidateTargetValidationResultV1Schema,
  type CandidateTargetValidationPort,
  type CandidateTargetValidationResultV1,
  type CandidateValidationOutcomeV1,
} from "./validation.js";

export const candidateEditFileV1Schema = z
  .object({
    content: z.string().max(4 * 1024 * 1024),
    expectedDigest: sha256DigestSchema,
    path: safeRelativePathSchema,
  })
  .strict();

export const candidateEditRequestV1Schema = z
  .object({
    editedAt: utcTimestampSchema,
    editedBy: solutionStableIdSchema,
    edits: z.array(candidateEditFileV1Schema).min(1).max(1_000),
    expectedArtifactDigest: sha256DigestSchema,
    expectedReviewDigest: sha256DigestSchema,
    reviewId: solutionStableIdSchema,
    scope: candidateScopeV1Schema,
  })
  .strict()
  .superRefine((value, context) => {
    const paths = new Set<string>();
    value.edits.forEach((edit, index) => {
      const key = portablePathKey(edit.path);
      if (paths.has(key)) {
        context.addIssue({
          code: "custom",
          message: "Candidate edit paths must be portably unique.",
          path: ["edits", index, "path"],
        });
      }
      paths.add(key);
    });
  });

export type CandidateEditRequestV1 = z.output<
  typeof candidateEditRequestV1Schema
>;
export {
  candidateInspectionV1Schema,
  type CandidateInspectionV1,
} from "./presentation-contracts.js";

function exactStoredCandidate(
  stored: StoredCandidateArtifactV1,
  review: CandidateReviewRecordV1,
): StoredCandidateArtifactV1 {
  if (
    stored.lifecycle.state !== "current" ||
    digestCanonicalValue(stored.reference) !==
      digestCanonicalValue(review.artifact) ||
    stored.reference.artifactDigest !== review.artifact.artifactDigest ||
    stored.files.length !== review.artifact.files.length
  ) {
    throw new Error(
      "Candidate operation failed because the stored artifact reference is stale.",
    );
  }
  const reviewBinding =
    stored.reviewBinding === undefined
      ? undefined
      : candidateArtifactReviewBindingV1Schema.parse(stored.reviewBinding);
  if (
    reviewBinding?.artifactDigest !== review.artifact.artifactDigest ||
    reviewBinding.artifactId !== review.artifact.artifactId ||
    reviewBinding.boundAt !== review.artifact.storedAt ||
    reviewBinding.reviewDigest !== review.reviewDigest ||
    reviewBinding.reviewId !== review.reviewId ||
    reviewBinding.scope.organizationId !== review.scope.organizationId ||
    reviewBinding.scope.projectId !== review.scope.projectId ||
    reviewBinding.solutionRevisionId !== review.artifact.solutionRevisionId
  ) {
    throw new Error(
      "Candidate operation requires the exact immutable stored review binding.",
    );
  }
  const metadataByPath = new Map<
    string,
    (typeof review.artifact.files)[number]
  >(review.artifact.files.map((file) => [file.path, file]));
  for (const file of stored.files) {
    const metadata = metadataByPath.get(file.path);
    if (
      metadata?.digest !== file.digest ||
      metadata.sizeBytes !== file.sizeBytes ||
      metadata.ownership !== file.ownership ||
      metadata.sourceKind !== file.sourceKind ||
      sha256Text(file.content) !== file.digest ||
      utf8ByteLength(file.content) !== file.sizeBytes
    ) {
      throw new Error(
        "Candidate operation failed because stored file bytes or metadata changed.",
      );
    }
  }
  const replay = stored.validationReplay;
  if (
    replay !== undefined &&
    digestCanonicalValue(replay) !== review.artifact.validationReplayDigest
  ) {
    throw new Error(
      "Candidate operation failed because validation replay authority changed.",
    );
  }
  if (
    getCandidateArtifactDigest({
      bundleDigest: review.artifact.bundleDigest,
      extensionId: review.artifact.extensionId,
      files: stored.files,
      origin: review.artifact.origin,
      ...(replay === undefined ? {} : { validationReplay: replay }),
      scope: review.artifact.scope,
      solutionRevisionId: review.artifact.solutionRevisionId,
      targetKind: stored.targetKind,
    }) !== review.artifact.artifactDigest
  ) {
    throw new Error(
      "Candidate operation failed because its content address is invalid.",
    );
  }
  return stored;
}

function exactCurrentCandidateReview(input: {
  readonly expectedArtifactDigest: string;
  readonly expectedReviewDigest: string;
  readonly review: unknown;
  readonly reviewId: string;
  readonly scope: CandidateScopeV1;
}): CandidateReviewRecordV1 {
  const review = candidateReviewRecordV1Schema.parse(input.review);
  if (
    review.reviewId !== input.reviewId ||
    review.reviewDigest !== input.expectedReviewDigest ||
    getCandidateReviewDigest(review) !== input.expectedReviewDigest ||
    review.artifact.artifactDigest !== input.expectedArtifactDigest ||
    digestCanonicalValue(review.scope) !== digestCanonicalValue(input.scope)
  ) {
    throw new Error(
      "Candidate operation failed because review or artifact authority is stale.",
    );
  }
  return review;
}

async function readCurrentCandidate(input: {
  readonly artifactStore: CandidateArtifactStore;
  readonly expectedArtifactDigest: string;
  readonly expectedReviewDigest: string;
  readonly review: unknown;
  readonly reviewId: string;
  readonly scope: CandidateScopeV1;
}) {
  const review = exactCurrentCandidateReview(input);
  const stored = await input.artifactStore.read({
    artifactId: review.artifact.artifactId,
    expectedArtifactDigest: review.artifact.artifactDigest,
    scope: input.scope,
  });
  return { review, stored: exactStoredCandidate(stored, review) };
}

async function inspectCandidateReview(input: {
  readonly artifactStore: CandidateArtifactStore;
  readonly authorization: CandidateReviewAllowedAuthorizationDecisionV1;
  readonly expectedArtifactDigest: string;
  readonly expectedReviewDigest: string;
  readonly review: unknown;
  readonly reviewId: string;
  readonly scope: CandidateScopeV1;
}): Promise<CandidateInspectionV1> {
  const { review, stored } = await readCurrentCandidate(input);
  const projection = {
    artifactDigest: review.artifact.artifactDigest,
    artifactId: review.artifact.artifactId,
    authorization: {
      action: "inspect" as const,
      authorizationDecisionId: input.authorization.decisionId,
      principalId: input.authorization.principalId,
    },
    editAuthority: "reviewed-user-modifications-only" as const,
    files: stored.files.map((file) => ({
      content: file.content,
      digest: file.digest,
      ownership: file.ownership,
      path: file.path,
      sizeBytes: file.sizeBytes,
      sourceKind: file.sourceKind,
    })),
    repositoryWriteAuthority: "none" as const,
    reviewDigest: review.reviewDigest,
    reviewId: review.reviewId,
    scope: review.scope,
  };
  return candidateInspectionV1Schema.parse({
    ...projection,
    inspectionDigest: digestCanonicalValue(projection),
  });
}

function splitCanonicalLines(value: string) {
  if (value.includes("\r")) {
    throw new Error("Candidate edits require LF line endings.");
  }
  const trailingNewline = value.endsWith("\n");
  const lines = value.length === 0 ? [] : value.split("\n");
  if (trailingNewline) lines.pop();
  return { lines, trailingNewline };
}

function fullReplacementPatch(input: {
  readonly baseContent: string;
  readonly nextContent: string;
  readonly path: string;
}): string {
  const base = splitCanonicalLines(input.baseContent);
  const next = splitCanonicalLines(input.nextContent);
  if (base.trailingNewline !== next.trailingNewline) {
    throw new Error(
      "Candidate edits cannot change final-newline state for a patch-owned file.",
    );
  }
  const oldStart = base.lines.length === 0 ? 0 : 1;
  const newStart = next.lines.length === 0 ? 0 : 1;
  return [
    `--- a/${input.path}`,
    `+++ b/${input.path}`,
    `@@ -${String(oldStart)},${String(base.lines.length)} +${String(
      newStart,
    )},${String(next.lines.length)} @@`,
    ...base.lines.map((line) => `-${line}`),
    ...next.lines.map((line) => `+${line}`),
    "",
  ].join("\n");
}

function deriveEditedBundle(input: {
  readonly bundle: ModelCandidateBundleV1;
  readonly edits: ReadonlyMap<string, { readonly content: string }>;
  readonly replay: StoredCandidateArtifactV1["validationReplay"] &
    NonNullable<unknown>;
}): ModelCandidateBundleV1 {
  const candidates = input.bundle.candidates.map((candidate) => {
    const edit = input.edits.get(candidate.path);
    if (edit === undefined) return candidate;
    if (candidate.kind === "file") {
      return {
        ...candidate,
        content: edit.content,
        contentDigest: sha256Text(edit.content),
      };
    }
    const existing = input.replay.generationContext.existingFiles.find(
      (file) => file.path === candidate.path,
    );
    if (sha256Text(existing?.content ?? "") !== existing?.contentDigest) {
      throw new Error(
        "Candidate patch edit is missing its exact sanitized base content.",
      );
    }
    return {
      ...candidate,
      baseDigest: existing.contentDigest,
      proposedResultDigest: sha256Text(edit.content),
      unifiedDiff: fullReplacementPatch({
        baseContent: existing.content,
        nextContent: edit.content,
        path: candidate.path,
      }),
    };
  });
  return modelCandidateBundleV1Schema.parse({
    ...input.bundle,
    candidates,
  });
}

const categoriesByKind = {
  build: ["build"],
  "contract-test": ["contract-test"],
  format: ["format"],
  "integration-test": ["integration-test"],
  parse: ["admission", "parse"],
  security: ["security"],
  "static-analysis": [
    "dependency",
    "ownership",
    "provenance",
    "static-analysis",
    "target-readiness",
  ],
  "unit-test": ["unit-test"],
} as const;

function validationChecks(input: {
  readonly diagnostics: readonly CandidateDiagnosticV1[];
  readonly extension: AiAuthoredExtensionV1;
  readonly outcomes: readonly CandidateValidationOutcomeV1[];
}): AiAuthoredExtensionV1["validation"] {
  return input.extension.validation.map((expectation) => {
    const outcome = input.outcomes.find(
      ({ kind }) => kind === expectation.kind,
    );
    const categories: readonly CandidateDiagnosticV1["category"][] =
      categoriesByKind[expectation.kind];
    const failed = input.diagnostics.some(
      (entry) =>
        entry.severity === "error" && categories.includes(entry.category),
    );
    return {
      checkId: expectation.checkId,
      kind: expectation.kind,
      required: expectation.required,
      result: failed ? "failed" : (outcome?.result ?? "not-run"),
      ...(outcome?.toolVersion === undefined
        ? {}
        : { toolVersion: outcome.toolVersion }),
    };
  });
}

function targetKind(extension: AiAuthoredExtensionV1) {
  return extension.target.kind === "application"
    ? "application"
    : extension.target.targetFormat;
}

export interface CandidateReviewValidators {
  readonly application: CandidateTargetValidationPort;
  readonly cloudformation: CandidateTargetValidationPort;
  readonly terraform: CandidateTargetValidationPort;
}

export interface CandidateReviewServiceDependencies {
  readonly artifactStore: CandidateArtifactStore;
  readonly authorization: CandidateReviewAuthorizationPort;
  readonly validators: CandidateReviewValidators;
}

export interface CandidateReviewInspectionInput {
  readonly expectedArtifactDigest: string;
  readonly expectedReviewDigest: string;
  readonly review: unknown;
  readonly reviewId: string;
  readonly scope: CandidateScopeV1;
}

export interface CandidateReviewEditInput {
  readonly request: unknown;
  readonly review: unknown;
  readonly signal?: AbortSignal;
}

export interface CandidateReviewService {
  inspect(
    input: CandidateReviewInspectionInput,
  ): Promise<CandidateInspectionV1>;
  editAndRevalidate(
    input: CandidateReviewEditInput,
  ): Promise<CandidateReviewRecordV1>;
}

function configuredTargetValidator(
  validators: CandidateReviewValidators,
  kind: unknown,
): CandidateTargetValidationPort {
  if (kind === "application") return validators.application;
  if (kind === "terraform") return validators.terraform;
  if (kind === "cloudformation") return validators.cloudformation;
  throw new Error("Candidate target validation is not configured.");
}

const revalidatedCoordinatorDiagnosticCodes = new Set([
  "cloudmarkup.ai-extension.candidate-content-invalid",
  "cloudmarkup.ai-extension.required-evidence-cardinality",
  "cloudmarkup.ai-extension.target-validator-error",
  "cloudmarkup.ai-extension.total-bytes-exceeded",
  "cloudmarkup.ai-extension.validation-evidence-ungrounded",
]);

function coordinatorDiagnosticsPreservedAcrossEdit(input: {
  readonly changedPaths: ReadonlySet<string>;
  readonly review: CandidateReviewRecordV1;
}): CandidateDiagnosticV1[] {
  return input.review.diagnostics.filter((entry) => {
    const coordinatorOwned =
      entry.checkId === `cloudmarkup.ai-extension.${entry.category}`;
    if (!coordinatorOwned) return false;
    if (entry.code === "cloudmarkup.ai-extension.candidate-content-invalid") {
      return (
        entry.path === undefined ||
        !input.changedPaths.has(portablePathKey(entry.path))
      );
    }
    return !revalidatedCoordinatorDiagnosticCodes.has(entry.code);
  });
}

function candidateEvidenceDiagnostics(input: {
  readonly artifact: CandidateArtifactReferenceV1;
  readonly context: ModelGenerationContextV1;
  readonly result: CandidateTargetValidationResultV1;
  readonly solutionRevisionId: string;
}): CandidateDiagnosticV1[] {
  const diagnostics: CandidateDiagnosticV1[] = [];
  const artifactSizeBytes = input.artifact.files.reduce(
    (total, file) => total + file.sizeBytes,
    0,
  );
  const requiredLevel =
    input.context.kind === "application"
      ? ({ kind: "application-build-and-tests", rank: 5 } as const)
      : ({ kind: "ai-extension-parse-static-validity", rank: 4 } as const);
  const requiredCoverage =
    input.context.kind === "application"
      ? ([
          "application-build-and-tests",
          "application-security-checks",
        ] as const)
      : (["ai-extension-parse-static-validity"] as const);
  const bindsCandidate = (
    record: CandidateTargetValidationResultV1["evidence"][number],
  ): boolean => {
    const candidateArtifacts = record.artifacts.filter(
      ({ digest }) => digest === input.artifact.artifactDigest,
    );
    const passedCoverage = new Set(
      record.checks.flatMap(({ generationCoverageRequirement, status }) =>
        status === "passed" && generationCoverageRequirement !== undefined
          ? [generationCoverageRequirement]
          : [],
      ),
    );
    return (
      record.solutionRevisionId === input.solutionRevisionId &&
      record.staleness.state === "current" &&
      record.level.kind === requiredLevel.kind &&
      record.level.rank === requiredLevel.rank &&
      record.provenance.inputDigests.includes(input.artifact.artifactDigest) &&
      candidateArtifacts.length === 1 &&
      candidateArtifacts[0]?.mediaType ===
        "application/vnd.cloudmarkup.ai-extension-candidate.v1+json" &&
      candidateArtifacts[0].sizeBytes === artifactSizeBytes &&
      record.checks.every(
        (check) =>
          check.status === "passed" &&
          check.artifactDigests.includes(input.artifact.artifactDigest),
      ) &&
      requiredCoverage.every((requirement) => passedCoverage.has(requirement))
    );
  };
  for (const record of input.result.evidence) {
    if (!bindsCandidate(record)) {
      diagnostics.push(
        candidateDiagnosticV1Schema.parse({
          category: "provenance",
          checkId: "cloudmarkup.ai-extension.provenance",
          code: "cloudmarkup.ai-extension.validation-evidence-ungrounded",
          repairable: false,
          severity: "error",
          summary: "Candidate validation Evidence is not grounded.",
          technicalDetail:
            "Target validation Evidence does not bind the exact edited artifact, passing checks, required level, required coverage, and Solution Revision.",
        }),
      );
    }
  }
  if (
    input.result.evidence.filter((record) => bindsCandidate(record)).length !==
    1
  ) {
    diagnostics.push(
      candidateDiagnosticV1Schema.parse({
        category: "provenance",
        checkId: "cloudmarkup.ai-extension.provenance",
        code: "cloudmarkup.ai-extension.required-evidence-cardinality",
        repairable: false,
        severity: "error",
        summary: "Candidate is missing required validation Evidence.",
        technicalDetail:
          "The configured target validator must emit exactly one candidate-bound Evidence record for every required coverage claim.",
      }),
    );
  }
  return diagnostics;
}

async function editAndRevalidateCandidate(input: {
  readonly artifactStore: CandidateArtifactStore;
  readonly authorization: CandidateReviewAllowedAuthorizationDecisionV1;
  readonly request: unknown;
  readonly review: unknown;
  readonly validators: CandidateReviewValidators;
  readonly signal?: AbortSignal;
}): Promise<CandidateReviewRecordV1> {
  const request = candidateEditRequestV1Schema.parse(input.request);
  const { review, stored } = await readCurrentCandidate({
    artifactStore: input.artifactStore,
    expectedArtifactDigest: request.expectedArtifactDigest,
    expectedReviewDigest: request.expectedReviewDigest,
    review: input.review,
    reviewId: request.reviewId,
    scope: request.scope,
  });
  const replay =
    stored.validationReplay === undefined
      ? undefined
      : candidateValidationReplayV1Schema.parse(stored.validationReplay);
  if (replay === undefined) {
    throw new Error(
      "Candidate cannot be edited because exact validation replay authority is unavailable.",
    );
  }
  if (
    stored.targetKind !== targetKind(review.extension) ||
    replay.solutionRevision.solutionRevisionId !==
      review.artifact.solutionRevisionId ||
    replay.generationContext.extensionId !== review.extension.id
  ) {
    throw new Error(
      "Candidate edit failed because target validation authority changed.",
    );
  }

  const currentByPath = new Map<string, (typeof stored.files)[number]>(
    stored.files.map((file) => [file.path, file]),
  );
  const editByPath = new Map<string, { readonly content: string }>();
  const modifications: CandidateUserModificationV1[] = [];
  for (const edit of request.edits) {
    const path = validatePortableCandidatePath(edit.path);
    const current = currentByPath.get(path);
    if (
      current?.digest !== edit.expectedDigest ||
      !replay.generationContext.ownedPaths.includes(path) ||
      replay.generationContext.protectedPaths.includes(path)
    ) {
      throw new Error(
        "Candidate edit failed because path ownership or base digest is stale.",
      );
    }
    if (
      utf8ByteLength(edit.content) >
        replay.generationContext.limits.maximumCandidateFileBytes ||
      candidateContentSafetyDiagnostics(edit.content, stored.targetKind)
        .length > 0
    ) {
      throw new Error(
        "Candidate edit failed deterministic path, size, content, or secret safety checks.",
      );
    }
    const resultDigest = sha256Text(edit.content);
    if (resultDigest === current.digest) {
      throw new Error("Candidate edit must change at least one exact file.");
    }
    editByPath.set(path, { content: edit.content });
    modifications.push({
      authorizationDecisionId: input.authorization.decisionId,
      editId: stableRecordId("candidate-edit", {
        authorizationDecisionId: input.authorization.decisionId,
        editedAt: request.editedAt,
        editedBy: input.authorization.principalId,
        path,
        priorDigest: current.digest,
        resultDigest,
      }),
      editedAt: request.editedAt,
      editedBy: input.authorization.principalId,
      path,
      priorDigest: current.digest,
      resultDigest,
    });
  }

  const files = stored.files.map((file) => {
    const edit = editByPath.get(file.path);
    if (edit === undefined) return file;
    return Object.freeze({
      ...file,
      content: edit.content,
      digest: sha256Text(edit.content),
      sizeBytes: utf8ByteLength(edit.content),
    });
  });
  if (
    files.length > replay.generationContext.limits.maximumCandidateFiles ||
    files.some(
      (file) =>
        file.sizeBytes >
        replay.generationContext.limits.maximumCandidateFileBytes,
    ) ||
    files.reduce((total, file) => total + file.sizeBytes, 0) >
      replay.generationContext.limits.maximumCandidateTotalBytes
  ) {
    throw new Error(
      "Candidate edit failed the exact aggregate file-count or byte limits.",
    );
  }
  const bundle = deriveEditedBundle({
    bundle: replay.bundle,
    edits: editByPath,
    replay,
  });
  const bundleDigest = digestCanonicalValue(bundle);
  const nextReplay = candidateValidationReplayV1Schema.parse({
    ...replay,
    bundle,
    bundleDigest,
  });
  const previousEdits =
    review.artifact.origin.kind === "user-modified"
      ? review.artifact.origin.edits
      : [];
  const origin = {
    baseArtifactDigest:
      review.artifact.origin.kind === "user-modified"
        ? review.artifact.origin.baseArtifactDigest
        : review.artifact.artifactDigest,
    baseArtifactId:
      review.artifact.origin.kind === "user-modified"
        ? review.artifact.origin.baseArtifactId
        : review.artifact.artifactId,
    edits: [...previousEdits, ...modifications],
    kind: "user-modified" as const,
    modelOutputDigest: review.artifact.origin.modelOutputDigest,
    parentArtifactDigest: review.artifact.artifactDigest,
    parentArtifactId: review.artifact.artifactId,
  };
  const provisionalArtifact = createCandidateArtifactReference({
    bundleDigest,
    extensionId: review.extension.id,
    files,
    origin,
    scope: review.scope,
    solutionRevisionId: review.artifact.solutionRevisionId,
    storedAt: request.editedAt,
    targetKind: stored.targetKind,
    validationReplay: nextReplay,
  });

  const preservedDiagnostics = coordinatorDiagnosticsPreservedAcrossEdit({
    changedPaths: new Set([...editByPath.keys()].map(portablePathKey)),
    review,
  });
  let diagnostics: CandidateDiagnosticV1[];
  let evidence: EvidenceRecordV1[] = [];
  let outcomes: readonly CandidateValidationOutcomeV1[];
  try {
    const result = candidateTargetValidationResultV1Schema.parse(
      await configuredTargetValidator(
        input.validators,
        stored.targetKind,
      ).validate(
        {
          artifact: provisionalArtifact,
          assessedAt: request.editedAt,
          bundle,
          descriptor: replay.descriptor,
          files,
          generationContext: replay.generationContext,
          solutionRevision: replay.solutionRevision,
        },
        input.signal,
      ),
    );
    diagnostics = [
      ...preservedDiagnostics,
      ...result.diagnostics,
      ...candidateEvidenceDiagnostics({
        artifact: provisionalArtifact,
        context: replay.generationContext,
        result,
        solutionRevisionId: replay.solutionRevision.solutionRevisionId,
      }),
    ].filter(
      (entry, index, entries) =>
        entries.findIndex(
          (candidate) =>
            digestCanonicalValue(candidate) === digestCanonicalValue(entry),
        ) === index,
    );
    outcomes = result.outcomes;
    evidence = result.evidence.filter(
      (record) =>
        record.solutionRevisionId ===
          replay.solutionRevision.solutionRevisionId &&
        record.staleness.state === "current" &&
        record.provenance.inputDigests.includes(
          provisionalArtifact.artifactDigest,
        ),
    );
  } catch {
    throw new Error(
      "Candidate edit revalidation did not complete; the original candidate remains current.",
    );
  }

  const artifact = provisionalArtifact;
  const checks = validationChecks({
    diagnostics,
    extension: review.extension,
    outcomes,
  });
  const staticEvidence = createCandidateStaticEvidence({
    artifact,
    assessedAt: request.editedAt,
    claimsCoverageRequirement: replay.generationContext.kind === "application",
    descriptor: replay.descriptor,
    diagnostics,
    generationContextDigest: replay.generationContextDigest,
    outcomes,
    solutionRevisionDigest: replay.solutionRevisionDigest,
    solutionRevisionId: replay.solutionRevision.solutionRevisionId,
  });
  const admittedEvidence = [
    ...review.evidence,
    staticEvidence,
    ...evidence,
  ].filter(
    (record, index, records) =>
      records.findIndex(({ id }) => id === record.id) === index,
  );
  const issueAssessment = reconcileCandidateIssueAssessment({
    applicationBuildIssues: replay.generationContext.kind === "application",
    assessedAt: request.editedAt,
    bundleDigest,
    diagnostics,
    evidence: admittedEvidence,
    extensionId: review.extension.id,
    inputDigests: [
      artifact.artifactDigest,
      review.artifact.artifactDigest,
      replay.generationContextDigest,
    ],
    markMissingAsStale: true,
    previousRecords: review.issueHistory,
    solutionRevisionId: replay.solutionRevision.solutionRevisionId,
  });
  const issues = issueAssessment.latestRecords;
  const ready =
    diagnostics.every(({ severity }) => severity !== "error") &&
    checks.every((check) => !check.required || check.result === "passed") &&
    review.unresolvedItems.length === 0;
  const missingEvidenceKinds = [
    "cloudmarkup.user-acceptance",
    ...checks
      .filter((check) => check.required && check.result !== "passed")
      .map(({ checkId }) => checkId),
  ].filter((entry, index, entries) => entries.indexOf(entry) === index);
  const extension = aiAuthoredExtensionV1Schema.parse({
    ...review.extension,
    acceptance: { state: "pending" },
    exportSafety: {
      missingEvidenceKinds:
        missingEvidenceKinds.length <= 64
          ? missingEvidenceKinds
          : [
              ...missingEvidenceKinds.slice(0, 63),
              "cloudmarkup.ai-extension.additional-required-evidence",
            ],
      state: "not-safe",
    },
    issueIds: issues.map(({ id }) => id),
    outputs: artifact.files.map((file) => ({
      digest: file.digest,
      kind: file.sourceKind,
      path: file.path,
      sizeBytes: file.sizeBytes,
    })),
    validation: checks,
  });
  const priorEditRevalidations = review.editRevalidations;
  const parentProgressFinalization =
    priorEditRevalidations.at(-1) ?? review.generationProgress;
  const editRevalidationProjection = {
    artifactDigest: artifact.artifactDigest,
    artifactId: artifact.artifactId,
    artifactStoredAt: artifact.storedAt,
    authorityKind: "candidate-edit-revalidation" as const,
    authorizationDecision: input.authorization,
    contractVersion: 1 as const,
    editCount: origin.edits.length,
    editLineageDigest: digestCanonicalValue(origin.edits),
    evidenceCount: admittedEvidence.length,
    evidenceDigest: digestCanonicalValue(admittedEvidence),
    issueHistoryCount: issueAssessment.history.length,
    finalIssueHistoryDigest: digestCanonicalValue(issueAssessment.history),
    finalIssuesCount: issues.length,
    finalIssuesDigest: digestCanonicalValue(issues),
    parentArtifactDigest: review.artifact.artifactDigest,
    parentArtifactId: review.artifact.artifactId,
    parentProgressFinalizationDigest: digestCanonicalValue(
      parentProgressFinalization,
    ),
    parentReviewDigest: review.reviewDigest,
    parentReviewId: review.reviewId,
    priorEditCount: previousEdits.length,
    priorEditLineageDigest: digestCanonicalValue(previousEdits),
    revalidatedAt: request.editedAt,
    scope: review.scope,
    solutionRevisionId: review.artifact.solutionRevisionId,
    state: "finalized" as const,
    terminalPhase: "edit-revalidated" as const,
    terminalResultKind: "candidate-review" as const,
    validationDigest: digestCanonicalValue(checks),
  };
  const editRevalidation = candidateEditRevalidationFinalizationV1Schema.parse({
    ...editRevalidationProjection,
    finalizationDigest: getCandidateEditRevalidationFinalizationDigest(
      editRevalidationProjection,
    ),
  });
  const projection = {
    ...review,
    artifact,
    diagnostics,
    editRevalidations: [...priorEditRevalidations, editRevalidation],
    evidence: admittedEvidence,
    extension,
    issueHistory: [...issueAssessment.history],
    issues: [...issues],
    progress: [
      { stage: "generate" as const, state: "complete" as const },
      {
        stage: "check" as const,
        state: ready ? ("complete" as const) : ("failed" as const),
      },
      {
        stage: "fix-automatically-where-safe" as const,
        state: "not-needed" as const,
      },
      {
        stage: "review-remaining-issues" as const,
        state: ready ? ("complete" as const) : ("blocked" as const),
      },
      {
        stage: "accept-candidate" as const,
        state: ready ? ("ready" as const) : ("pending" as const),
      },
    ],
    reviewId: stableRecordId("candidate-review", {
      artifactDigest: artifact.artifactDigest,
      priorReviewDigest: review.reviewDigest,
    }),
    state: ready
      ? ("ready-for-acceptance" as const)
      : ("review-with-issues" as const),
    validation: checks,
  };
  const candidateReview = candidateReviewRecordV1Schema.parse({
    ...projection,
    reviewDigest: getCandidateReviewDigest(projection),
  });
  if (input.artifactStore.supersede === undefined) {
    throw new Error(
      "Candidate edit storage does not support atomic stale-safe supersession.",
    );
  }
  const storedArtifact = await input.artifactStore.supersede({
    bundleDigest,
    expectedSupersededArtifactDigest: review.artifact.artifactDigest,
    expectedSupersededReview: {
      reviewDigest: review.reviewDigest,
      reviewId: review.reviewId,
    },
    extensionId: review.extension.id,
    files,
    origin,
    scope: review.scope,
    solutionRevisionId: review.artifact.solutionRevisionId,
    storedAt: request.editedAt,
    supersededArtifactId: review.artifact.artifactId,
    supersededAt: request.editedAt,
    successorReview: {
      boundAt: request.editedAt,
      reviewDigest: candidateReview.reviewDigest,
      reviewId: candidateReview.reviewId,
    },
    targetKind: stored.targetKind,
    validationReplay: nextReplay,
  });
  if (digestCanonicalValue(storedArtifact) !== digestCanonicalValue(artifact)) {
    throw new Error("Candidate store changed the edited content address.");
  }
  const storedSuccessor = await input.artifactStore.read({
    artifactId: candidateReview.artifact.artifactId,
    expectedArtifactDigest: candidateReview.artifact.artifactDigest,
    scope: candidateReview.scope,
  });
  exactStoredCandidate(storedSuccessor, candidateReview);
  return candidateReview;
}

export function createCandidateReviewService(
  dependencies: CandidateReviewServiceDependencies,
): CandidateReviewService {
  return Object.freeze({
    async inspect(
      input: CandidateReviewInspectionInput,
    ): Promise<CandidateInspectionV1> {
      const review = exactCurrentCandidateReview(input);
      const authorization = await requireCandidateReviewAuthorization({
        action: "inspect",
        artifactDigest: review.artifact.artifactDigest,
        authorization: dependencies.authorization,
        reviewDigest: review.reviewDigest,
        reviewId: review.reviewId,
        scope: review.scope,
        solutionRevisionId: review.artifact.solutionRevisionId,
      });
      return inspectCandidateReview({
        ...input,
        artifactStore: dependencies.artifactStore,
        authorization,
        review,
      });
    },

    async editAndRevalidate(
      input: CandidateReviewEditInput,
    ): Promise<CandidateReviewRecordV1> {
      const request = candidateEditRequestV1Schema.parse(input.request);
      const review = exactCurrentCandidateReview({
        expectedArtifactDigest: request.expectedArtifactDigest,
        expectedReviewDigest: request.expectedReviewDigest,
        review: input.review,
        reviewId: request.reviewId,
        scope: request.scope,
      });
      const authorization = await requireCandidateReviewAuthorization({
        action: "edit",
        artifactDigest: review.artifact.artifactDigest,
        authorization: dependencies.authorization,
        expectedPrincipalId: request.editedBy,
        reviewDigest: review.reviewDigest,
        reviewId: review.reviewId,
        scope: review.scope,
        solutionRevisionId: review.artifact.solutionRevisionId,
      });
      return editAndRevalidateCandidate({
        artifactStore: dependencies.artifactStore,
        authorization,
        request,
        review,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
        validators: dependencies.validators,
      });
    },
  });
}
