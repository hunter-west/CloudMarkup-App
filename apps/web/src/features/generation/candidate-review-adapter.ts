import {
  candidateInspectionV1Schema,
  candidateArtifactLifecycleV1Schema,
  candidateReviewRecordV1Schema,
  candidateValidationReplayV1Schema,
  digestCanonicalValue,
  getCandidateReviewDigest,
  sha256Text,
  utf8ByteLength,
  type CandidateArtifactLifecycleV1,
  type CandidateInspectionV1,
  type CandidateReviewRecordV1,
  type CandidateValidationReplayV1,
} from "@cloudmarkup/ai-extension-generation/presentation";

import type {
  CandidateFixReference,
  CandidateProgressState,
  CandidateReviewFile,
  CandidateReviewIssue,
  CandidateReviewSurfaceProps,
  CandidateRevalidationState,
  CandidateToolDiagnostic,
} from "./CandidateReviewSurface.js";

export interface AuthorizedCandidateReviewPresentationV1 {
  readonly inspection: CandidateInspectionV1;
  readonly artifactLifecycle: CandidateArtifactLifecycleV1;
  readonly replay: CandidateValidationReplayV1;
  readonly review: CandidateReviewRecordV1;
}

export interface CandidateReviewHostInputV1 extends AuthorizedCandidateReviewPresentationV1 {
  readonly onAccept: CandidateReviewSurfaceProps["onAccept"];
  readonly onFileChange: CandidateReviewSurfaceProps["onFileChange"];
  readonly revalidationState?: CandidateRevalidationState;
}

export interface CandidateReviewPresentationV1 {
  readonly authority: {
    readonly artifactId: string;
    readonly artifactLifecycle: CandidateArtifactLifecycleV1;
    readonly authorizationDecisionId: string;
    readonly principalId: string;
    readonly organizationId: string;
    readonly projectId: string;
  };
  readonly surfaceProps: CandidateReviewSurfaceProps;
}

const presentationAuthorityError =
  "Candidate review presentation authority is inconsistent.";

function parsedPresentationAuthority(
  input: AuthorizedCandidateReviewPresentationV1,
): AuthorizedCandidateReviewPresentationV1 {
  try {
    const review = candidateReviewRecordV1Schema.parse(input.review);
    const inspection = candidateInspectionV1Schema.parse(input.inspection);
    const artifactLifecycle = candidateArtifactLifecycleV1Schema.parse(
      input.artifactLifecycle,
    );
    const replay = candidateValidationReplayV1Schema.parse(input.replay);
    const inspectionProjection: Partial<CandidateInspectionV1> = {
      ...inspection,
    };
    delete inspectionProjection.inspectionDigest;
    const finalAttempt = review.attempts[review.attempts.length - 1];
    const scopedSolutionRevisionId = replay.descriptor.scope.solutionRevisionId;
    if (
      getCandidateReviewDigest(review) !== review.reviewDigest ||
      digestCanonicalValue(inspectionProjection) !==
        inspection.inspectionDigest ||
      digestCanonicalValue(replay) !== review.artifact.validationReplayDigest ||
      inspection.reviewId !== review.reviewId ||
      inspection.reviewDigest !== review.reviewDigest ||
      inspection.artifactId !== review.artifact.artifactId ||
      inspection.artifactDigest !== review.artifact.artifactDigest ||
      inspection.scope.organizationId !== review.scope.organizationId ||
      inspection.scope.projectId !== review.scope.projectId ||
      replay.bundleDigest !== review.artifact.bundleDigest ||
      replay.solutionRevision.solutionRevisionId !==
        review.artifact.solutionRevisionId ||
      replay.generationContext.extensionId !== review.extension.id ||
      replay.descriptor.scope.organizationId !== review.scope.organizationId ||
      replay.descriptor.scope.projectId !== review.scope.projectId ||
      (scopedSolutionRevisionId !== undefined &&
        scopedSolutionRevisionId !== review.artifact.solutionRevisionId) ||
      finalAttempt?.invocationId !== replay.descriptor.invocationId ||
      finalAttempt.idempotencyKeyDigest !==
        replay.descriptor.idempotencyKeyDigest ||
      finalAttempt.model.modelId !== replay.descriptor.modelId ||
      finalAttempt.model.modelVersion !== replay.descriptor.modelVersion ||
      finalAttempt.model.promptDigest !== replay.descriptor.promptDigest ||
      finalAttempt.model.promptTemplateId !==
        replay.descriptor.promptTemplateId ||
      finalAttempt.model.promptVersion !== replay.descriptor.promptVersion ||
      finalAttempt.model.providerId !== replay.descriptor.providerId ||
      inspection.files.length !== review.artifact.files.length
    ) {
      throw new Error(presentationAuthorityError);
    }

    const artifactFiles = new Map(
      review.artifact.files.map((file) => [file.path, file]),
    );
    for (const file of inspection.files) {
      const artifactFile = artifactFiles.get(file.path);
      if (
        artifactFile?.digest !== file.digest ||
        artifactFile.ownership !== file.ownership ||
        artifactFile.sizeBytes !== file.sizeBytes ||
        artifactFile.sourceKind !== file.sourceKind ||
        sha256Text(file.content) !== file.digest ||
        utf8ByteLength(file.content) !== file.sizeBytes
      ) {
        throw new Error(presentationAuthorityError);
      }
    }
    return { artifactLifecycle, inspection, replay, review };
  } catch {
    throw new Error(presentationAuthorityError);
  }
}

function languageForPath(path: string, fallback: string): string {
  const extension = path.split(".").pop()?.toLowerCase();
  switch (extension) {
    case "ts":
    case "tsx":
      return "TypeScript";
    case "js":
    case "jsx":
      return "JavaScript";
    case "tf":
      return "HCL";
    case "json":
      return "JSON";
    case "yaml":
    case "yml":
      return "YAML";
    default:
      return fallback;
  }
}

function presentationFile(
  file: CandidateInspectionV1["files"][number],
  fallbackLanguage: string,
): CandidateReviewFile {
  return {
    content: file.content,
    contentDigest: file.digest,
    language: languageForPath(file.path, fallbackLanguage),
    ownership:
      file.ownership === "user-owned-preserved"
        ? "user-owned"
        : "generated-candidate",
    path: file.path,
    sizeBytes: file.sizeBytes,
  };
}

function issueState(
  state: CandidateReviewRecordV1["issues"][number]["lifecycle"]["state"],
): CandidateReviewIssue["state"] {
  switch (state) {
    case "stale":
      return "stale";
    case "accepted":
    case "resolved":
      return "resolved";
    case "current":
    case "deferred":
      return "active";
  }
}

function issueSeverity(
  severity: CandidateReviewRecordV1["issues"][number]["severity"],
): CandidateReviewIssue["severity"] {
  switch (severity) {
    case "error":
    case "security-error":
      return "error";
    case "cost-warning":
    case "warning":
      return "warning";
    case "educational-note":
    case "recommendation":
      return "information";
  }
}

function issueNextAction(
  issue: CandidateReviewRecordV1["issues"][number],
): string {
  if (issue.lifecycle.state === "stale") {
    return "Confirm whether this retained issue still applies to the current candidate.";
  }
  if (
    issue.lifecycle.state === "resolved" ||
    issue.lifecycle.state === "accepted"
  ) {
    return "No action is needed unless the candidate or its evidence changes.";
  }
  return (
    issue.closureRequirements[0]?.description ??
    "Review this issue and provide the required evidence before acceptance."
  );
}

function presentationIssue(
  issue: CandidateReviewRecordV1["issues"][number],
): CandidateReviewIssue {
  return {
    issueId: issue.id,
    nextAction: issueNextAction(issue),
    severity: issueSeverity(issue.severity),
    state: issueState(issue.lifecycle.state),
    summary: issue.summary,
  };
}

function presentationEvidence(
  review: CandidateReviewRecordV1,
): CandidateReviewSurfaceProps["candidate"]["evidence"] {
  return review.evidence.map((record) => {
    const checkCounts = { error: 0, failed: 0, passed: 0, skipped: 0 };
    for (const check of record.checks) {
      checkCounts[check.status] += 1;
    }
    return {
      checkCounts,
      environmentType: record.environment.environmentType,
      evidenceId: record.id,
      layer: record.layer,
      levelKind: record.level.kind,
      levelRank: record.level.rank,
      stalenessState: record.staleness.state,
    };
  });
}

function presentationFixes(
  review: CandidateReviewRecordV1,
  replay: CandidateValidationReplayV1,
): readonly CandidateFixReference[] {
  return review.issues.flatMap((issue) => {
    const fixes: CandidateFixReference[] = [];
    if (issue.deterministicFix !== undefined) {
      fixes.push({
        description: issue.deterministicFix.description,
        exactReference: `graph-command:${issue.deterministicFix.graphCommand.commandId}`,
        kind: "deterministic-operation",
        afterContentHash: issue.deterministicFix.resultingContentHash,
        afterVisualHash: issue.deterministicFix.resultingVisualHash,
        beforeContentHash: replay.solutionRevision.architecture.contentHash,
        beforeVisualHash: replay.solutionRevision.architecture.visualHash,
        commandBatchDigest: digestCanonicalValue(
          issue.deterministicFix.graphCommand,
        ),
        status: "available",
      });
    }
    if (issue.aiProposedFix !== undefined) {
      const validationStatus = issue.aiProposedFix.validationStatus;
      fixes.push({
        description: issue.aiProposedFix.description,
        exactReference: issue.aiProposedFix.proposedPatchDigest,
        kind: "ai-proposal",
        status:
          validationStatus === "rejected"
            ? "rejected"
            : validationStatus === "accepted"
              ? "applied"
              : "proposed",
      });
    }
    return fixes;
  });
}

function validationMessage(
  kind: CandidateReviewRecordV1["validation"][number]["kind"],
  result: CandidateReviewRecordV1["validation"][number]["result"],
): string {
  const checkName = kind.replaceAll("-", " ");
  switch (result) {
    case "passed":
      return `The ${checkName} check passed.`;
    case "failed":
      return `The ${checkName} check failed.`;
    case "error":
      return `The ${checkName} check could not complete.`;
    case "not-run":
      return `The ${checkName} check has not run.`;
  }
}

function presentationToolDiagnostics(
  review: CandidateReviewRecordV1,
  replay: CandidateValidationReplayV1,
): readonly CandidateToolDiagnostic[] {
  const diagnosticsByCheck = new Map<
    string,
    CandidateReviewRecordV1["diagnostics"]
  >();
  for (const diagnostic of review.diagnostics) {
    const current = diagnosticsByCheck.get(diagnostic.checkId) ?? [];
    diagnosticsByCheck.set(diagnostic.checkId, [...current, diagnostic]);
  }

  const mappedCheckIds = new Set<string>();
  const mapped = review.validation.flatMap((check) => {
    mappedCheckIds.add(check.checkId);
    const expectation = replay.generationContext.validationExpectations.find(
      ({ checkId }) => checkId === check.checkId,
    );
    const toolName = expectation?.toolProfileId ?? check.checkId;
    const toolVersion = check.toolVersion ?? "version not reported";
    const diagnostics = diagnosticsByCheck.get(check.checkId) ?? [];
    if (diagnostics.length === 0) {
      return [
        {
          checkId: check.checkId,
          code: `validation.${check.result}`,
          message: validationMessage(check.kind, check.result),
          toolName,
          toolVersion,
        },
      ];
    }
    return diagnostics.map((diagnostic) => ({
      checkId: diagnostic.checkId,
      code: diagnostic.code,
      message: diagnostic.technicalDetail,
      ...(diagnostic.path === undefined ? {} : { path: diagnostic.path }),
      toolName,
      toolVersion,
    }));
  });

  for (const diagnostic of review.diagnostics) {
    if (!mappedCheckIds.has(diagnostic.checkId)) {
      mapped.push({
        checkId: diagnostic.checkId,
        code: diagnostic.code,
        message: diagnostic.technicalDetail,
        ...(diagnostic.path === undefined ? {} : { path: diagnostic.path }),
        toolName: diagnostic.checkId,
        toolVersion: "version not reported",
      });
    }
  }
  return mapped;
}

function progressState(
  state: CandidateReviewRecordV1["progress"][number]["state"],
): CandidateProgressState {
  switch (state) {
    case "complete":
    case "not-needed":
      return "complete";
    case "ready":
      return "current";
    case "blocked":
    case "exhausted":
    case "failed":
      return "blocked";
    case "pending":
      return "pending";
  }
}

function presentationProgress(
  review: CandidateReviewRecordV1,
): CandidateReviewSurfaceProps["candidate"]["progress"] {
  const progress: Record<
    keyof CandidateReviewSurfaceProps["candidate"]["progress"],
    CandidateProgressState
  > = {
    accept: "pending",
    check: "pending",
    fix: "pending",
    generate: "pending",
    review: "pending",
  };
  for (const stage of review.progress) {
    const state = progressState(stage.state);
    switch (stage.stage) {
      case "generate":
        progress.generate = state;
        break;
      case "check":
        progress.check = state;
        break;
      case "fix-automatically-where-safe":
        progress.fix = state;
        break;
      case "review-remaining-issues":
        progress.review = state;
        break;
      case "accept-candidate":
        progress.accept = state;
        break;
    }
  }
  return progress;
}

function blockedReason(
  review: CandidateReviewRecordV1,
  artifactLifecycle: CandidateArtifactLifecycleV1,
): string | undefined {
  if (artifactLifecycle.state === "superseded") {
    return "A newer candidate superseded this record. Open the current candidate before acceptance.";
  }
  if (review.state === "ready-for-acceptance") {
    return undefined;
  }
  if (review.state === "rejected") {
    return "The candidate did not pass the required checks.";
  }
  if (review.unresolvedItems.some(({ blocking }) => blocking)) {
    return "A required behavior decision is still unresolved.";
  }
  if (
    review.issues.some(
      (issue) =>
        issue.lifecycle.state === "current" &&
        (issue.severity === "error" || issue.severity === "security-error"),
    )
  ) {
    return "One or more blocking issues need review.";
  }
  if (
    review.validation.some(
      (check) => check.required && check.result !== "passed",
    )
  ) {
    return "One or more required checks have not passed.";
  }
  return "The candidate needs review before acceptance.";
}

function inferredRevalidationState(
  review: CandidateReviewRecordV1,
  artifactLifecycle: CandidateArtifactLifecycleV1,
): CandidateRevalidationState {
  if (artifactLifecycle.state === "superseded") {
    return "failed";
  }
  if (review.state === "ready-for-acceptance") {
    return "current";
  }
  return review.validation.some(
    (check) => check.required && check.result === "not-run",
  )
    ? "required"
    : "failed";
}

export function createCandidateReviewPresentation(
  input: CandidateReviewHostInputV1,
): CandidateReviewPresentationV1 {
  const { artifactLifecycle, inspection, replay, review } =
    parsedPresentationAuthority(input);
  const finalAttempt = review.attempts[review.attempts.length - 1];
  if (finalAttempt === undefined) {
    throw new Error(presentationAuthorityError);
  }
  const acceptanceBlockedReason = blockedReason(review, artifactLifecycle);
  const surfaceProps: CandidateReviewSurfaceProps = {
    candidate: {
      ...(acceptanceBlockedReason === undefined
        ? {}
        : { acceptanceBlockedReason }),
      acceptanceReady:
        artifactLifecycle.state === "current" &&
        review.state === "ready-for-acceptance",
      assumptions: review.assumptions.map((assumption) => ({
        assumptionId: assumption.assumptionId,
        sourceReferenceIds: [...assumption.sourceReferenceIds],
        statement: assumption.statement,
      })),
      candidateId: review.reviewId,
      evidence: presentationEvidence(review),
      expectedTests: review.expectedTests.map((test) => ({
        description: test.description,
        expectedTestId: test.expectedTestId,
        kind: test.kind,
        sourceReferenceIds: [...test.sourceReferenceIds],
        targetPaths: [...test.targetPaths],
        validationCheckId: test.validationCheckId,
      })),
      files: inspection.files.map((file) =>
        presentationFile(file, replay.generationContext.language),
      ),
      fixes: presentationFixes(review, replay),
      issues: review.issues.map(presentationIssue),
      modelProvenance: {
        modelId: finalAttempt.model.modelId,
        modelVersion: finalAttempt.model.modelVersion,
        promptDigest: finalAttempt.model.promptDigest,
        promptVersion: finalAttempt.model.promptVersion,
        providerId: finalAttempt.model.providerId,
      },
      progress: presentationProgress(review),
      revalidationState:
        artifactLifecycle.state === "superseded"
          ? "failed"
          : (input.revalidationState ??
            inferredRevalidationState(review, artifactLifecycle)),
      schemaReferences: replay.generationContext.officialSchemas.map(
        (schema) => ({
          digest: schema.schemaDigest,
          schemaId: schema.schemaId,
          version: schema.schemaVersion,
        }),
      ),
      toolDiagnostics: presentationToolDiagnostics(review, replay),
      unresolvedItems: review.unresolvedItems.map((item) => ({
        blocking: item.blocking,
        detail: item.detail,
        question: item.question,
        sourceReferenceIds: [...item.sourceReferenceIds],
        unresolvedItemId: item.unresolvedItemId,
      })),
      validatedCandidateDigest: review.artifact.artifactDigest,
    },
    onAccept: input.onAccept,
    onFileChange: input.onFileChange,
  };
  return {
    authority: {
      artifactId: inspection.artifactId,
      organizationId: review.scope.organizationId,
      artifactLifecycle,
      authorizationDecisionId: inspection.authorization.authorizationDecisionId,
      principalId: inspection.authorization.principalId,
      projectId: review.scope.projectId,
    },
    surfaceProps,
  };
}

export function createCandidateReviewSurfaceProps(
  input: CandidateReviewHostInputV1,
): CandidateReviewSurfaceProps {
  return createCandidateReviewPresentation(input).surfaceProps;
}
