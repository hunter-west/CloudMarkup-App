import {
  activeIssueIdSchema,
  activeIssueV1Schema,
  aiAuthoredExtensionV1Schema,
  evidenceCollectionV1Schema,
  aiExtensionValidationCheckV1Schema,
  evidenceRecordV1Schema,
  modelCandidateBundleV1Schema,
  modelGenerationContextV1Schema,
  modelInvocationDescriptorV1Schema,
  namespacedIdentifierSchema,
  normalizedModelUsageV1Schema,
  semanticVersionSchema,
  safeRelativePathSchema,
  sha256DigestSchema,
  solutionRevisionIdSchema,
  solutionRevisionManifestV1Schema,
  solutionStableIdSchema,
  utcTimestampSchema,
  type ActiveIssueV1,
  type AiAuthoredExtensionV1,
  type EvidenceRecordV1,
  type Sha256Digest,
} from "@cloudmarkup/schemas";
import {
  getActiveIssueRecordHash,
  validateActiveIssueTransitionV1,
  validateSolutionRevisionManifestWithEvidenceV1,
} from "@cloudmarkup/domain";
import { z } from "zod";

import {
  digestCanonicalValue,
  portablePathKey,
} from "./presentation-support.js";

export const AI_EXTENSION_GENERATION_COORDINATOR_ID =
  "cloudmarkup.ai-extension-generation" as const;
export const AI_EXTENSION_GENERATION_COORDINATOR_VERSION = "1.1.0" as const;

export const candidateScopeV1Schema = z
  .object({
    organizationId: solutionStableIdSchema,
    projectId: solutionStableIdSchema,
  })
  .strict();

export const candidateReviewActionV1Schema = z.enum([
  "inspect",
  "edit",
  "accept",
  "reject",
  "apply-deterministic-fix",
]);

export const candidateReviewAuthorizationRequestV1Schema = z
  .object({
    action: candidateReviewActionV1Schema,
    artifactDigest: sha256DigestSchema,
    contractVersion: z.literal(1),
    operationDigest: sha256DigestSchema.optional(),
    reviewDigest: sha256DigestSchema,
    reviewId: solutionStableIdSchema,
    scope: candidateScopeV1Schema,
    solutionRevisionId: solutionRevisionIdSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const requiresOperationDigest = value.action === "apply-deterministic-fix";
    if (requiresOperationDigest !== (value.operationDigest !== undefined)) {
      context.addIssue({
        code: "custom",
        message:
          "Only a reviewed deterministic-fix authorization may carry, and must carry, an exact operation digest.",
        path: ["operationDigest"],
      });
    }
  });

const candidateReviewAuthorizationDecisionBaseV1Schema = z.object({
  action: candidateReviewActionV1Schema,
  authoritySource: z.literal("verified-authentication-context"),
  contractVersion: z.literal(1),
  decidedAt: utcTimestampSchema,
  decisionId: solutionStableIdSchema,
  requestDigest: sha256DigestSchema,
});

export const candidateReviewAllowedAuthorizationDecisionV1Schema =
  candidateReviewAuthorizationDecisionBaseV1Schema
    .extend({
      allowed: z.literal(true),
      principalId: solutionStableIdSchema,
    })
    .strict();

export const candidateReviewAuthorizationDecisionV1Schema =
  z.discriminatedUnion("allowed", [
    candidateReviewAllowedAuthorizationDecisionV1Schema,
    candidateReviewAuthorizationDecisionBaseV1Schema
      .extend({
        allowed: z.literal(false),
        reason: z.string().trim().min(1).max(1_000),
      })
      .strict(),
  ]);

export function getCandidateReviewAuthorizationRequestDigest(
  request: CandidateReviewAuthorizationRequestV1,
): Sha256Digest {
  return digestCanonicalValue(request);
}

export const candidateReviewAuthorizationProofV1Schema = z
  .object({
    allowedDecision: candidateReviewAllowedAuthorizationDecisionV1Schema,
    request: candidateReviewAuthorizationRequestV1Schema,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.allowedDecision.action !== value.request.action ||
      value.allowedDecision.requestDigest !==
        getCandidateReviewAuthorizationRequestDigest(value.request)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Candidate authorization proof must bind the exact allowed decision to its canonical request.",
        path: ["allowedDecision"],
      });
    }
  });

export type CandidateReviewActionV1 = z.output<
  typeof candidateReviewActionV1Schema
>;
export type CandidateReviewAuthorizationRequestV1 = z.output<
  typeof candidateReviewAuthorizationRequestV1Schema
>;
export type CandidateReviewAuthorizationDecisionV1 = z.output<
  typeof candidateReviewAuthorizationDecisionV1Schema
>;
export type CandidateReviewAllowedAuthorizationDecisionV1 = z.output<
  typeof candidateReviewAllowedAuthorizationDecisionV1Schema
>;
export type CandidateReviewAuthorizationProofV1 = z.output<
  typeof candidateReviewAuthorizationProofV1Schema
>;

function hasExactCandidateAuthorizationProof(input: {
  readonly action: CandidateReviewActionV1;
  readonly artifactDigest: Sha256Digest;
  readonly completedAt: string;
  readonly principalId: string;
  readonly proof: CandidateReviewAuthorizationProofV1;
  readonly reviewDigest: Sha256Digest;
  readonly reviewId: string;
  readonly scope: CandidateScopeV1;
  readonly solutionRevisionId: string;
}): boolean {
  const request = input.proof.request;
  const decision = input.proof.allowedDecision;
  return (
    request.action === input.action &&
    request.artifactDigest === input.artifactDigest &&
    request.operationDigest === undefined &&
    request.reviewDigest === input.reviewDigest &&
    request.reviewId === input.reviewId &&
    digestCanonicalValue(request.scope) === digestCanonicalValue(input.scope) &&
    request.solutionRevisionId === input.solutionRevisionId &&
    decision.action === input.action &&
    decision.requestDigest ===
      getCandidateReviewAuthorizationRequestDigest(request) &&
    decision.principalId === input.principalId &&
    Date.parse(decision.decidedAt) <= Date.parse(input.completedAt)
  );
}

export const candidateDiagnosticV1Schema = z
  .object({
    category: z.enum([
      "admission",
      "ownership",
      "dependency",
      "parse",
      "format",
      "static-analysis",
      "build",
      "unit-test",
      "contract-test",
      "integration-test",
      "security",
      "target-readiness",
      "provenance",
      "repair",
    ]),
    checkId: namespacedIdentifierSchema,
    code: namespacedIdentifierSchema,
    path: safeRelativePathSchema.optional(),
    repairable: z.boolean(),
    severity: z.enum(["error", "warning", "information"]),
    summary: z.string().trim().min(1).max(500),
    technicalDetail: z.string().trim().min(1).max(2_000),
  })
  .strict();

export const candidateUserModificationV1Schema = z
  .object({
    authorizationDecisionId: solutionStableIdSchema,
    editId: solutionStableIdSchema,
    editedAt: utcTimestampSchema,
    editedBy: solutionStableIdSchema,
    path: safeRelativePathSchema,
    priorDigest: sha256DigestSchema,
    resultDigest: sha256DigestSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.priorDigest === value.resultDigest) {
      context.addIssue({
        code: "custom",
        message: "A candidate edit must change the exact file digest.",
        path: ["resultDigest"],
      });
    }
  });

export const candidateArtifactOriginV1Schema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("model-output"),
      modelOutputDigest: sha256DigestSchema,
    })
    .strict(),
  z
    .object({
      baseArtifactDigest: sha256DigestSchema,
      baseArtifactId: solutionStableIdSchema,
      edits: z.array(candidateUserModificationV1Schema).min(1).max(1_000),
      kind: z.literal("user-modified"),
      modelOutputDigest: sha256DigestSchema,
      parentArtifactDigest: sha256DigestSchema,
      parentArtifactId: solutionStableIdSchema,
    })
    .strict()
    .superRefine((value, context) => {
      const editIds = new Set<string>();
      const latestByPath = new Map<string, (typeof value.edits)[number]>();
      let priorEditedAt: string | undefined;
      value.edits.forEach((edit, index) => {
        if (editIds.has(edit.editId)) {
          context.addIssue({
            code: "custom",
            message: "User modification IDs must be unique and append-only.",
            path: ["edits", index, "editId"],
          });
        }
        editIds.add(edit.editId);
        if (priorEditedAt !== undefined && edit.editedAt < priorEditedAt) {
          context.addIssue({
            code: "custom",
            message: "User modifications must remain in chronological order.",
            path: ["edits", index, "editedAt"],
          });
        }
        priorEditedAt = edit.editedAt;
        const key = portablePathKey(edit.path);
        const priorForPath = latestByPath.get(key);
        if (
          priorForPath !== undefined &&
          edit.priorDigest !== priorForPath.resultDigest
        ) {
          context.addIssue({
            code: "custom",
            message:
              "Repeated user modifications must preserve the exact per-path digest chain.",
            path: ["edits", index, "priorDigest"],
          });
        }
        latestByPath.set(key, edit);
      });
    }),
]);

export const candidateAttemptModelProvenanceV1Schema = z
  .object({
    modelId: namespacedIdentifierSchema,
    modelVersion: z.string().min(1).max(128),
    promptDigest: sha256DigestSchema,
    promptTemplateId: namespacedIdentifierSchema,
    promptVersion: semanticVersionSchema,
    providerId: namespacedIdentifierSchema,
  })
  .strict();

export const candidateArtifactFileReferenceV1Schema = z
  .object({
    digest: sha256DigestSchema,
    ownership: z.enum(["ai-authored-candidate", "user-owned-preserved"]),
    path: safeRelativePathSchema,
    sizeBytes: z
      .number()
      .int()
      .nonnegative()
      .max(4 * 1024 * 1024),
    sourceKind: z.enum(["file", "patch"]),
  })
  .strict();

export const candidateArtifactReferenceV1Schema = z
  .object({
    artifactDigest: sha256DigestSchema,
    artifactId: solutionStableIdSchema,
    attemptAuthorityDigest: sha256DigestSchema,
    bundleDigest: sha256DigestSchema,
    classification: z.literal("restricted-ai-authored-candidate"),
    contractVersion: z.literal(1),
    extensionId: solutionStableIdSchema,
    files: z.array(candidateArtifactFileReferenceV1Schema).min(1).max(1_000),
    origin: candidateArtifactOriginV1Schema,
    validationReplayDigest: sha256DigestSchema,
    scope: candidateScopeV1Schema,
    solutionRevisionId: solutionRevisionIdSchema,
    storedAt: utcTimestampSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const paths = new Set<string>();
    value.files.forEach((file, index) => {
      const key = portablePathKey(file.path);
      if (paths.has(key)) {
        context.addIssue({
          code: "custom",
          message: "Candidate artifact paths must be portably unique.",
          path: ["files", index, "path"],
        });
      }
      paths.add(key);
    });
    if (
      value.origin.kind === "model-output" &&
      value.origin.modelOutputDigest !== value.bundleDigest
    ) {
      context.addIssue({
        code: "custom",
        message:
          "An unedited candidate artifact must bind the exact model output bundle.",
        path: ["origin", "modelOutputDigest"],
      });
    }
    if (value.origin.kind === "user-modified") {
      if (
        value.origin.baseArtifactDigest === value.artifactDigest ||
        value.origin.baseArtifactId === value.artifactId ||
        value.origin.parentArtifactDigest === value.artifactDigest ||
        value.origin.parentArtifactId === value.artifactId
      ) {
        context.addIssue({
          code: "custom",
          message:
            "A user-modified artifact cannot be its own base or immediate parent.",
          path: ["origin", "parentArtifactDigest"],
        });
      }
      const filesByPath = new Map(value.files.map((file) => [file.path, file]));
      const finalEditByPath = new Map<
        string,
        {
          readonly edit: (typeof value.origin.edits)[number];
          readonly index: number;
        }
      >();
      value.origin.edits.forEach((edit, index) => {
        finalEditByPath.set(portablePathKey(edit.path), { edit, index });
      });
      for (const { edit, index } of finalEditByPath.values()) {
        if (filesByPath.get(edit.path)?.digest !== edit.resultDigest) {
          context.addIssue({
            code: "custom",
            message:
              "The final user modification for every path must bind the exact resulting artifact file.",
            path: ["origin", "edits", index, "resultDigest"],
          });
        }
      }
    }
  });

export const invalidCandidateArtifactReferenceV1Schema = z
  .object({
    artifactDigest: sha256DigestSchema,
    artifactId: solutionStableIdSchema,
    bundleDigest: sha256DigestSchema,
    classification: z.literal("restricted-invalid-ai-authored-candidate"),
    contractVersion: z.literal(1),
    diagnosticCodes: z.array(namespacedIdentifierSchema).min(1).max(1_000),
    extensionId: solutionStableIdSchema,
    scope: candidateScopeV1Schema,
    solutionRevisionId: solutionRevisionIdSchema,
    storedAt: utcTimestampSchema,
  })
  .strict();

export const candidateGenerationProgressFinalizationV1Schema = z
  .object({
    contractVersion: z.literal(1),
    finalEvidenceCount: z.number().int().min(0).max(128),
    finalEvidenceDigest: sha256DigestSchema,
    finalIssueHistoryCount: z.number().int().min(0).max(10_000),
    finalIssueHistoryDigest: sha256DigestSchema,
    finalIssuesCount: z.number().int().min(0).max(1_000),
    finalIssuesDigest: sha256DigestSchema,
    finalSequence: z.number().int().min(1).max(10),
    finalSnapshotDigest: sha256DigestSchema,
    generationRunId: solutionStableIdSchema,
    state: z.literal("finalized"),
    streamDigest: sha256DigestSchema,
    terminalPhase: z.enum([
      "generation-complete",
      "generation-rejected",
      "validation-assessed",
      "repair-complete",
      "repair-proposed",
      "repair-validated",
      "repair-rejected",
    ]),
    terminalResultKind: z.enum([
      "candidate-review",
      "candidate-generation-failure",
    ]),
  })
  .strict();

export type CandidateGenerationProgressFinalizationV1 = z.output<
  typeof candidateGenerationProgressFinalizationV1Schema
>;

const candidateEditRevalidationFinalizationBaseV1Schema = z
  .object({
    artifactDigest: sha256DigestSchema,
    artifactId: solutionStableIdSchema,
    artifactStoredAt: utcTimestampSchema,
    authorityKind: z.literal("candidate-edit-revalidation"),
    authorizationDecision: candidateReviewAllowedAuthorizationDecisionV1Schema,
    contractVersion: z.literal(1),
    editCount: z.number().int().min(1).max(1_000),
    editLineageDigest: sha256DigestSchema,
    evidenceCount: z.number().int().min(0).max(128),
    evidenceDigest: sha256DigestSchema,
    issueHistoryCount: z.number().int().min(0).max(10_000),
    finalIssueHistoryDigest: sha256DigestSchema,
    finalIssuesCount: z.number().int().min(0).max(1_000),
    finalIssuesDigest: sha256DigestSchema,
    finalizationDigest: sha256DigestSchema,
    parentArtifactDigest: sha256DigestSchema,
    parentArtifactId: solutionStableIdSchema,
    parentProgressFinalizationDigest: sha256DigestSchema,
    parentReviewDigest: sha256DigestSchema,
    parentReviewId: solutionStableIdSchema,
    priorEditCount: z.number().int().min(0).max(999),
    priorEditLineageDigest: sha256DigestSchema,
    revalidatedAt: utcTimestampSchema,
    scope: candidateScopeV1Schema,
    solutionRevisionId: solutionRevisionIdSchema,
    state: z.literal("finalized"),
    terminalPhase: z.literal("edit-revalidated"),
    terminalResultKind: z.literal("candidate-review"),
    validationDigest: sha256DigestSchema,
  })
  .strict();

export type CandidateEditRevalidationFinalizationV1 = z.output<
  typeof candidateEditRevalidationFinalizationBaseV1Schema
>;

export function getCandidateEditRevalidationFinalizationDigest(
  input:
    | Omit<CandidateEditRevalidationFinalizationV1, "finalizationDigest">
    | CandidateEditRevalidationFinalizationV1,
): Sha256Digest {
  const projection = {
    ...input,
  } as Partial<CandidateEditRevalidationFinalizationV1>;
  delete projection.finalizationDigest;
  return digestCanonicalValue(projection);
}

export const candidateEditRevalidationFinalizationV1Schema =
  candidateEditRevalidationFinalizationBaseV1Schema.superRefine(
    (value, context) => {
      if (
        value.authorizationDecision.action !== "edit" ||
        Date.parse(value.authorizationDecision.decidedAt) >
          Date.parse(value.revalidatedAt) ||
        value.artifactStoredAt !== value.revalidatedAt ||
        value.finalizationDigest !==
          getCandidateEditRevalidationFinalizationDigest(value)
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Candidate edit revalidation must bind one exact prior allowed edit decision and immutable finalization digest.",
          path: ["finalizationDigest"],
        });
      }
    },
  );

export const candidateProgressStageV1Schema = z
  .object({
    stage: z.enum([
      "generate",
      "check",
      "fix-automatically-where-safe",
      "review-remaining-issues",
      "accept-candidate",
    ]),
    state: z.enum([
      "complete",
      "failed",
      "not-needed",
      "exhausted",
      "ready",
      "blocked",
      "pending",
    ]),
  })
  .strict();

export const candidateAttemptV1Schema = z
  .object({
    attemptNumber: z.number().int().min(0).max(2),
    bundleDigest: sha256DigestSchema,
    idempotencyKeyDigest: sha256DigestSchema,
    invocationId: solutionStableIdSchema,
    kind: z.enum(["generation", "repair"]),
    model: candidateAttemptModelProvenanceV1Schema,
    mergedBundleDigest: sha256DigestSchema,
    metered: z.literal(true),
    usageRecordId: solutionStableIdSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.kind === "generation" &&
      value.bundleDigest !== value.mergedBundleDigest
    ) {
      context.addIssue({
        code: "custom",
        message:
          "The initial generation response and deterministically merged bundle must have the same digest.",
        path: ["mergedBundleDigest"],
      });
    }
  });

export const candidateAttemptReplayAuthorityV1Schema = z
  .object({
    attemptNumber: z.number().int().min(0).max(2),
    descriptor: modelInvocationDescriptorV1Schema,
    kind: z.enum(["generation", "repair"]),
    mergedBundleDigest: sha256DigestSchema,
    rawBundleDigest: sha256DigestSchema,
    usage: normalizedModelUsageV1Schema,
  })
  .strict()
  .superRefine((value, context) => {
    const descriptor = value.descriptor;
    const usage = value.usage;
    const expectedFeature =
      value.kind === "repair"
        ? "candidate.repair"
        : descriptor.feature === "application-source.generate" ||
            descriptor.feature === "iac-extension.generate"
          ? descriptor.feature
          : undefined;
    if (
      expectedFeature === undefined ||
      descriptor.feature !== expectedFeature ||
      usage.feature !== descriptor.feature ||
      usage.idempotencyKeyDigest !== descriptor.idempotencyKeyDigest ||
      usage.inputDigest !== descriptor.inputDigest ||
      usage.invocationId !== descriptor.invocationId ||
      usage.modelId !== descriptor.modelId ||
      usage.modelVersion !== descriptor.modelVersion ||
      usage.promptTemplateId !== descriptor.promptTemplateId ||
      usage.promptVersion !== descriptor.promptVersion ||
      usage.providerId !== descriptor.providerId ||
      usage.inferenceProfileId !== descriptor.inferenceProfileId ||
      digestCanonicalValue(usage.routing ?? null) !==
        digestCanonicalValue(descriptor.routing ?? null) ||
      digestCanonicalValue(usage.scope) !==
        digestCanonicalValue(descriptor.scope) ||
      usage.result !== "succeeded"
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Replay attempt authority must bind one exact successful descriptor and normalized usage record.",
        path: ["usage"],
      });
    }
    if (
      value.kind === "generation" &&
      value.rawBundleDigest !== value.mergedBundleDigest
    ) {
      context.addIssue({
        code: "custom",
        message:
          "The initial replay attempt raw and deterministically merged bundle digests must match.",
        path: ["mergedBundleDigest"],
      });
    }
  });

export type CandidateAttemptReplayAuthorityV1 = z.output<
  typeof candidateAttemptReplayAuthorityV1Schema
>;

function candidateAttemptFromReplayAuthority(
  authority: CandidateAttemptReplayAuthorityV1,
): CandidateAttemptAuthorityV1 {
  return {
    attemptNumber: authority.attemptNumber,
    bundleDigest: authority.rawBundleDigest,
    idempotencyKeyDigest: authority.descriptor.idempotencyKeyDigest,
    invocationId: authority.descriptor.invocationId,
    kind: authority.kind,
    mergedBundleDigest: authority.mergedBundleDigest,
    metered: true,
    model: {
      modelId: authority.descriptor.modelId,
      modelVersion: authority.descriptor.modelVersion,
      promptDigest: authority.descriptor.promptDigest,
      promptTemplateId: authority.descriptor.promptTemplateId,
      promptVersion: authority.descriptor.promptVersion,
      providerId: authority.descriptor.providerId,
    },
    usageRecordId: authority.usage.usageRecordId,
  };
}

export function hasExactCandidateAttemptReplayAuthority(
  attempts: readonly CandidateAttemptAuthorityV1[],
  authority: readonly CandidateAttemptReplayAuthorityV1[],
): boolean {
  return (
    attempts.length === authority.length &&
    attempts.every((attempt, index) => {
      const replayAttempt = authority[index];
      return (
        replayAttempt !== undefined &&
        digestCanonicalValue(attempt) ===
          digestCanonicalValue(
            candidateAttemptFromReplayAuthority(replayAttempt),
          )
      );
    })
  );
}
type CandidateArtifactAuthorityV1 = z.output<
  typeof candidateArtifactReferenceV1Schema
>;
type CandidateAttemptAuthorityV1 = z.output<typeof candidateAttemptV1Schema>;

function canonicalCandidateOutputs(
  artifact: CandidateArtifactAuthorityV1,
  extension: AiAuthoredExtensionV1,
) {
  const artifactOutputs = artifact.files
    .map((file) => ({
      digest: file.digest,
      kind: file.sourceKind,
      path: file.path,
      sizeBytes: file.sizeBytes,
    }))
    .sort((left, right) => {
      const leftKey = portablePathKey(left.path);
      const rightKey = portablePathKey(right.path);
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    });
  const outputKeys = extension.outputs.map(({ path }) => portablePathKey(path));
  if (new Set(outputKeys).size !== outputKeys.length) return undefined;
  const extensionOutputs = [...extension.outputs].sort((left, right) => {
    const leftKey = portablePathKey(left.path);
    const rightKey = portablePathKey(right.path);
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
  return { artifactOutputs, extensionOutputs };
}

function getCandidateArtifactReferenceDigest(input: {
  readonly artifact: CandidateArtifactAuthorityV1;
  readonly extension: AiAuthoredExtensionV1;
}): Sha256Digest {
  const targetKind =
    input.extension.target.kind === "application"
      ? "application"
      : input.extension.target.targetFormat;
  return digestCanonicalValue({
    attemptAuthorityDigest: input.artifact.attemptAuthorityDigest,
    bundleDigest: input.artifact.bundleDigest,
    extensionId: input.artifact.extensionId,
    files: [...input.artifact.files].sort((left, right) => {
      const leftKey = portablePathKey(left.path);
      const rightKey = portablePathKey(right.path);
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    }),
    origin: input.artifact.origin,
    scope: input.artifact.scope,
    solutionRevisionId: input.artifact.solutionRevisionId,
    targetKind,
    validationReplayDigest: input.artifact.validationReplayDigest,
  });
}

function hasExactArtifactExtensionAuthority(input: {
  readonly artifact: CandidateArtifactAuthorityV1;
  readonly extension: AiAuthoredExtensionV1;
}): boolean {
  const outputs = canonicalCandidateOutputs(input.artifact, input.extension);
  const artifactDigest = getCandidateArtifactReferenceDigest(input);
  const artifactId =
    "candidate-" +
    digestCanonicalValue({
      artifactDigest,
      scope: input.artifact.scope,
    }).slice("sha256:".length, 38);
  return (
    outputs !== undefined &&
    input.artifact.artifactDigest === artifactDigest &&
    input.artifact.artifactId === artifactId &&
    input.artifact.extensionId === input.extension.id &&
    input.artifact.origin.modelOutputDigest ===
      input.extension.model.outputDigest &&
    digestCanonicalValue(outputs.artifactOutputs) ===
      digestCanonicalValue(outputs.extensionOutputs)
  );
}

function hasExactAttemptModelAuthority(input: {
  readonly artifact: CandidateArtifactAuthorityV1;
  readonly attempts: readonly CandidateAttemptAuthorityV1[];
  readonly extension: AiAuthoredExtensionV1;
}): boolean {
  const finalAttempt = input.attempts[input.attempts.length - 1];
  const attemptUsageIds = input.attempts.map(
    ({ usageRecordId }) => usageRecordId,
  );
  return (
    finalAttempt?.mergedBundleDigest ===
      input.artifact.origin.modelOutputDigest &&
    input.extension.model.outputDigest ===
      input.artifact.origin.modelOutputDigest &&
    finalAttempt.model.modelId === input.extension.model.modelId &&
    finalAttempt.model.modelVersion === input.extension.model.modelVersion &&
    finalAttempt.model.promptDigest === input.extension.model.promptDigest &&
    finalAttempt.model.promptVersion === input.extension.model.promptVersion &&
    finalAttempt.model.providerId === input.extension.model.providerId &&
    digestCanonicalValue(input.extension.model.usageEventIds) ===
      digestCanonicalValue(attemptUsageIds)
  );
}

function hasExactExtensionIssueIds(
  extension: AiAuthoredExtensionV1,
  issues: readonly ActiveIssueV1[],
): boolean {
  const expected = [...new Set(issues.map(({ id }) => id))].sort();
  return (
    digestCanonicalValue(extension.issueIds) === digestCanonicalValue(expected)
  );
}

export const candidateReviewAssumptionV1Schema = z
  .object({
    assumptionId: solutionStableIdSchema,
    sourceReferenceIds: z.array(solutionStableIdSchema).max(256),
    statement: z.string().trim().min(1).max(500),
  })
  .strict();

export const candidateReviewUnresolvedItemV1Schema = z
  .object({
    blocking: z.boolean(),
    detail: z.string().trim().min(1).max(2_000),
    question: z.string().trim().min(1).max(500),
    sourceReferenceIds: z.array(solutionStableIdSchema).max(256),
    unresolvedItemId: solutionStableIdSchema,
  })
  .strict();

export const candidateExpectedTestV1Schema = z
  .object({
    description: z.string().trim().min(1).max(500),
    expectedTestId: solutionStableIdSchema,
    kind: z.enum(["unit-test", "contract-test", "integration-test"]),
    sourceReferenceIds: z.array(solutionStableIdSchema).min(1).max(256),
    targetPaths: z.array(safeRelativePathSchema).min(1).max(64),
    validationCheckId: namespacedIdentifierSchema,
  })
  .strict();

const expectedProgressOrder = [
  "generate",
  "check",
  "fix-automatically-where-safe",
  "review-remaining-issues",
  "accept-candidate",
] as const;

export function assertCandidateIssueHistoryV1(input: {
  readonly evidence: readonly EvidenceRecordV1[];
  readonly history: readonly ActiveIssueV1[];
  readonly latest: readonly ActiveIssueV1[];
  readonly solutionRevisionId: string;
}): void {
  const collection = evidenceCollectionV1Schema.parse({
    contractVersion: 1,
    records: input.evidence,
  });
  const recordsByIssue = new Map<string, ActiveIssueV1[]>();
  const identities = new Set<string>();
  for (const record of input.history) {
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
        "Candidate issue history contains a duplicate immutable record version.",
      );
    }
    identities.add(identity);
    const records = recordsByIssue.get(record.id) ?? [];
    records.push(record);
    recordsByIssue.set(record.id, records);
  }

  const expectedLatest: ActiveIssueV1[] = [];
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
    const latest = ordered[ordered.length - 1];
    if (latest !== undefined) expectedLatest.push(latest);
  }
  expectedLatest.sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
  );
  if (
    digestCanonicalValue(expectedLatest) !== digestCanonicalValue(input.latest)
  ) {
    throw new Error(
      "Candidate issues must be the exact latest records from append-only history.",
    );
  }
}

function latestCandidateIssuesFromHistory(
  history: readonly ActiveIssueV1[],
): ActiveIssueV1[] {
  const latestById = new Map<string, ActiveIssueV1>();
  for (const record of history) {
    const previous = latestById.get(record.id);
    if (
      previous === undefined ||
      record.recordVersion > previous.recordVersion
    ) {
      latestById.set(record.id, record);
    }
  }
  return [...latestById.values()].sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
  );
}

const candidateReviewRecordBaseV1Schema = z
  .object({
    artifact: candidateArtifactReferenceV1Schema,
    assumptions: z.array(candidateReviewAssumptionV1Schema).max(256),
    attempts: z.array(candidateAttemptV1Schema).min(1).max(3),
    attemptAuthority: z
      .array(candidateAttemptReplayAuthorityV1Schema)
      .min(1)
      .max(3),
    contractVersion: z.literal(1),
    diagnostics: z.array(candidateDiagnosticV1Schema).max(1_000),
    editRevalidations: z
      .array(candidateEditRevalidationFinalizationV1Schema)
      .max(1_000),
    evidence: z.array(evidenceRecordV1Schema).max(128),
    expectedTests: z.array(candidateExpectedTestV1Schema).max(256),
    generationProgress: candidateGenerationProgressFinalizationV1Schema,
    extension: aiAuthoredExtensionV1Schema,
    issueHistory: z.array(activeIssueV1Schema).max(10_000),
    issues: z.array(activeIssueV1Schema).max(1_000),
    progress: z.array(candidateProgressStageV1Schema).length(5),
    reviewDigest: sha256DigestSchema,
    reviewId: solutionStableIdSchema,
    scope: candidateScopeV1Schema,
    state: z.enum(["ready-for-acceptance", "review-with-issues", "rejected"]),
    unresolvedItems: z.array(candidateReviewUnresolvedItemV1Schema).max(256),
    validation: z.array(aiExtensionValidationCheckV1Schema).min(1).max(128),
    writeAuthority: z.literal("none"),
  })
  .strict();

export type CandidateReviewRecordV1 = z.output<
  typeof candidateReviewRecordBaseV1Schema
>;

export function getCandidateReviewDigest(
  input:
    Omit<CandidateReviewRecordV1, "reviewDigest"> | CandidateReviewRecordV1,
): Sha256Digest {
  const projection = { ...input } as Partial<CandidateReviewRecordV1>;
  delete projection.reviewDigest;
  return digestCanonicalValue(projection);
}

export const candidateReviewRecordV1Schema =
  candidateReviewRecordBaseV1Schema.superRefine((value, context) => {
    try {
      assertCandidateIssueHistoryV1({
        evidence: value.evidence,
        history: value.issueHistory,
        latest: value.issues,
        solutionRevisionId: value.artifact.solutionRevisionId,
      });
    } catch (error) {
      context.addIssue({
        code: "custom",
        message:
          error instanceof Error
            ? error.message
            : "Candidate issue history is invalid.",
        path: ["issueHistory"],
      });
    }
    const generationProgress = value.generationProgress;
    const generationEvidence = value.evidence.slice(
      0,
      generationProgress.finalEvidenceCount,
    );
    const generationIssueHistory = value.issueHistory.slice(
      0,
      generationProgress.finalIssueHistoryCount,
    );
    const generationIssues = latestCandidateIssuesFromHistory(
      generationIssueHistory,
    );
    let progressAuthorityIsExact =
      generationProgress.terminalResultKind === "candidate-review" &&
      generationProgress.terminalPhase === "validation-assessed" &&
      generationProgress.finalEvidenceCount <= value.evidence.length &&
      generationProgress.finalEvidenceDigest ===
        digestCanonicalValue(generationEvidence) &&
      generationProgress.finalIssueHistoryCount <= value.issueHistory.length &&
      generationProgress.finalIssueHistoryDigest ===
        digestCanonicalValue(generationIssueHistory) &&
      generationProgress.finalIssuesCount === generationIssues.length &&
      generationProgress.finalIssuesDigest ===
        digestCanonicalValue(generationIssues);
    try {
      assertCandidateIssueHistoryV1({
        evidence: generationEvidence,
        history: generationIssueHistory,
        latest: generationIssues,
        solutionRevisionId: value.artifact.solutionRevisionId,
      });
    } catch {
      progressAuthorityIsExact = false;
    }

    const editRevalidations = value.editRevalidations;
    const origin = value.artifact.origin;
    if (editRevalidations.length === 0) {
      progressAuthorityIsExact =
        progressAuthorityIsExact &&
        origin.kind === "model-output" &&
        generationProgress.finalEvidenceCount === value.evidence.length &&
        generationProgress.finalIssueHistoryCount ===
          value.issueHistory.length &&
        generationProgress.finalIssuesCount === value.issues.length &&
        generationProgress.finalIssuesDigest ===
          digestCanonicalValue(value.issues);
    } else if (origin.kind !== "user-modified") {
      progressAuthorityIsExact = false;
    } else {
      let expectedPriorEditCount = 0;
      let minimumEvidenceCount = generationProgress.finalEvidenceCount;
      let minimumIssueHistoryCount = generationProgress.finalIssueHistoryCount;
      let expectedParentProgressFinalizationDigest =
        digestCanonicalValue(generationProgress);
      let expectedParentArtifactDigest = origin.baseArtifactDigest;
      let expectedParentArtifactId = origin.baseArtifactId;
      let expectedParentReviewId = `candidate-review-${digestCanonicalValue({
        artifactDigest: origin.baseArtifactDigest,
        extensionId: value.extension.id,
        solutionRevisionId: value.artifact.solutionRevisionId,
      }).slice("sha256:".length, 38)}`;
      let previousRevalidatedAt: string | undefined;

      editRevalidations.forEach((revalidation) => {
        const evidencePrefix = value.evidence.slice(
          0,
          revalidation.evidenceCount,
        );
        const issueHistoryPrefix = value.issueHistory.slice(
          0,
          revalidation.issueHistoryCount,
        );
        const latestIssues =
          latestCandidateIssuesFromHistory(issueHistoryPrefix);
        const appendedEdits = origin.edits.slice(
          revalidation.priorEditCount,
          revalidation.editCount,
        );
        const expectedAuthorizationRequest = {
          action: "edit" as const,
          artifactDigest: revalidation.parentArtifactDigest,
          contractVersion: 1 as const,
          reviewDigest: revalidation.parentReviewDigest,
          reviewId: revalidation.parentReviewId,
          scope: value.scope,
          solutionRevisionId: value.artifact.solutionRevisionId,
        };
        const resultReviewId = `candidate-review-${digestCanonicalValue({
          artifactDigest: revalidation.artifactDigest,
          priorReviewDigest: revalidation.parentReviewDigest,
        }).slice("sha256:".length, 38)}`;
        const exactRevalidation =
          revalidation.priorEditCount === expectedPriorEditCount &&
          revalidation.editCount > revalidation.priorEditCount &&
          revalidation.editCount <= origin.edits.length &&
          revalidation.priorEditLineageDigest ===
            digestCanonicalValue(
              origin.edits.slice(0, revalidation.priorEditCount),
            ) &&
          revalidation.editLineageDigest ===
            digestCanonicalValue(
              origin.edits.slice(0, revalidation.editCount),
            ) &&
          revalidation.evidenceCount >= minimumEvidenceCount &&
          revalidation.evidenceCount <= value.evidence.length &&
          revalidation.evidenceDigest ===
            digestCanonicalValue(evidencePrefix) &&
          revalidation.issueHistoryCount >= minimumIssueHistoryCount &&
          revalidation.issueHistoryCount <= value.issueHistory.length &&
          revalidation.finalIssueHistoryDigest ===
            digestCanonicalValue(issueHistoryPrefix) &&
          revalidation.finalIssuesCount === latestIssues.length &&
          revalidation.finalIssuesDigest ===
            digestCanonicalValue(latestIssues) &&
          revalidation.parentProgressFinalizationDigest ===
            expectedParentProgressFinalizationDigest &&
          revalidation.parentArtifactDigest === expectedParentArtifactDigest &&
          revalidation.parentArtifactId === expectedParentArtifactId &&
          revalidation.parentReviewId === expectedParentReviewId &&
          revalidation.authorizationDecision.requestDigest ===
            getCandidateReviewAuthorizationRequestDigest(
              expectedAuthorizationRequest,
            ) &&
          revalidation.scope.organizationId === value.scope.organizationId &&
          revalidation.scope.projectId === value.scope.projectId &&
          revalidation.solutionRevisionId ===
            value.artifact.solutionRevisionId &&
          appendedEdits.length > 0 &&
          appendedEdits.every(
            (edit) =>
              edit.authorizationDecisionId ===
                revalidation.authorizationDecision.decisionId &&
              edit.editedAt === revalidation.revalidatedAt &&
              edit.editedBy === revalidation.authorizationDecision.principalId,
          ) &&
          (previousRevalidatedAt === undefined ||
            Date.parse(revalidation.revalidatedAt) >
              Date.parse(previousRevalidatedAt));
        if (!exactRevalidation) progressAuthorityIsExact = false;
        try {
          assertCandidateIssueHistoryV1({
            evidence: evidencePrefix,
            history: issueHistoryPrefix,
            latest: latestIssues,
            solutionRevisionId: value.artifact.solutionRevisionId,
          });
        } catch {
          progressAuthorityIsExact = false;
        }
        expectedPriorEditCount = revalidation.editCount;
        minimumEvidenceCount = revalidation.evidenceCount;
        minimumIssueHistoryCount = revalidation.issueHistoryCount;
        expectedParentProgressFinalizationDigest =
          digestCanonicalValue(revalidation);
        expectedParentArtifactDigest = revalidation.artifactDigest;
        expectedParentArtifactId = revalidation.artifactId;
        expectedParentReviewId = resultReviewId;
        previousRevalidatedAt = revalidation.revalidatedAt;
      });

      const latestRevalidation = editRevalidations.at(-1);
      progressAuthorityIsExact =
        progressAuthorityIsExact &&
        expectedPriorEditCount === origin.edits.length &&
        minimumEvidenceCount === value.evidence.length &&
        minimumIssueHistoryCount === value.issueHistory.length &&
        latestRevalidation?.artifactDigest === value.artifact.artifactDigest &&
        latestRevalidation.artifactId === value.artifact.artifactId &&
        latestRevalidation.artifactStoredAt === value.artifact.storedAt &&
        latestRevalidation.parentArtifactDigest ===
          origin.parentArtifactDigest &&
        latestRevalidation.parentArtifactId === origin.parentArtifactId &&
        latestRevalidation.validationDigest ===
          digestCanonicalValue(value.validation) &&
        latestRevalidation.finalIssuesCount === value.issues.length &&
        latestRevalidation.finalIssuesDigest ===
          digestCanonicalValue(value.issues) &&
        expectedParentReviewId === value.reviewId;
    }

    if (!progressAuthorityIsExact) {
      context.addIssue({
        code: "custom",
        message:
          "Candidate review must retain its exact generation seal and every prefix-verifiable edit revalidation authority.",
        path: ["editRevalidations"],
      });
    }
    if (
      digestCanonicalValue(value.extension.validation) !==
      digestCanonicalValue(value.validation)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Candidate review and Prompt 24D extension validation must match exactly.",
        path: ["extension", "validation"],
      });
    }
    if (!hasExactExtensionIssueIds(value.extension, value.issues)) {
      context.addIssue({
        code: "custom",
        message:
          "The Prompt 24D extension must preserve the exact latest candidate issue IDs.",
        path: ["extension", "issueIds"],
      });
    }
    value.progress.forEach((stage, index) => {
      if (stage.stage !== expectedProgressOrder[index]) {
        context.addIssue({
          code: "custom",
          message:
            "Candidate progress stages must use the exact review flow order.",
          path: ["progress", index, "stage"],
        });
      }
    });
    const evidenceIds = new Set<string>();
    value.evidence.forEach((record, index) => {
      if (evidenceIds.has(record.id)) {
        context.addIssue({
          code: "custom",
          message: "Candidate review Evidence IDs must be unique.",
          path: ["evidence", index, "id"],
        });
      }
      evidenceIds.add(record.id);
    });
    const uniqueAttemptFields = [
      "idempotencyKeyDigest",
      "invocationId",
      "usageRecordId",
    ] as const;
    value.attempts.forEach((attempt, index) => {
      if (attempt.attemptNumber !== index) {
        context.addIssue({
          code: "custom",
          message:
            "Candidate attempts must be numbered sequentially from zero.",
          path: ["attempts", index, "attemptNumber"],
        });
      }
      const expectedKind = index === 0 ? "generation" : "repair";
      if (attempt.kind !== expectedKind) {
        context.addIssue({
          code: "custom",
          message:
            "The first candidate attempt must be generation and every later attempt must be repair.",
          path: ["attempts", index, "kind"],
        });
      }
    });
    for (const field of uniqueAttemptFields) {
      const seen = new Set<string>();
      value.attempts.forEach((attempt, index) => {
        if (seen.has(attempt[field])) {
          context.addIssue({
            code: "custom",
            message: `Candidate attempt ${field} values must be unique.`,
            path: ["attempts", index, field],
          });
        }
        seen.add(attempt[field]);
      });
    }
    if (
      !hasExactAttemptModelAuthority({
        artifact: value.artifact,
        attempts: value.attempts,
        extension: value.extension,
      }) ||
      !hasExactCandidateAttemptReplayAuthority(
        value.attempts,
        value.attemptAuthority,
      ) ||
      value.artifact.attemptAuthorityDigest !==
        digestCanonicalValue(value.attemptAuthority)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "The final model attempt, ordered usage, extension provenance, and original model output must match exactly.",
        path: ["attempts"],
      });
    }
    if (
      value.extension.id !== value.artifact.extensionId ||
      value.extension.solutionRevisionId !== value.artifact.solutionRevisionId
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Review extension and candidate artifact authority must match.",
        path: ["extension"],
      });
    }
    if (
      value.extension.acceptance.state !== "pending" ||
      value.extension.exportSafety.state !== "not-safe"
    ) {
      context.addIssue({
        code: "custom",
        message:
          "A review record must contain only a pending, not-safe extension.",
        path: ["extension", "acceptance"],
      });
    }
    if (value.extension.outputs.length !== value.artifact.files.length) {
      context.addIssue({
        code: "custom",
        message:
          "Prompt 24D outputs and stored candidate files must have the same exact cardinality.",
        path: ["extension", "outputs"],
      });
    }
    const outputByPath = new Map<
      string,
      (typeof value.extension.outputs)[number]
    >();
    const outputPortablePaths = new Set<string>();
    value.extension.outputs.forEach((output, index) => {
      const key = portablePathKey(output.path);
      if (outputPortablePaths.has(key)) {
        context.addIssue({
          code: "custom",
          message: "Prompt 24D output paths must be portably unique.",
          path: ["extension", "outputs", index, "path"],
        });
      }
      outputPortablePaths.add(key);
      outputByPath.set(output.path, output);
    });
    for (const [index, file] of value.artifact.files.entries()) {
      const output = outputByPath.get(file.path);
      if (
        output?.digest !== file.digest ||
        output.sizeBytes !== file.sizeBytes ||
        output.kind !== file.sourceKind
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Prompt 24D outputs must bind every exact stored candidate file.",
          path: ["artifact", "files", index],
        });
      }
    }
    const artifactByPath = new Map(
      value.artifact.files.map((file) => [file.path, file]),
    );
    value.extension.outputs.forEach((output, index) => {
      const file = artifactByPath.get(output.path);
      if (
        file?.digest !== output.digest ||
        file.sizeBytes !== output.sizeBytes ||
        file.sourceKind !== output.kind
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Every Prompt 24D output must bind one exact stored candidate file.",
          path: ["extension", "outputs", index],
        });
      }
    });
    const hasBlockingIssue = value.issues.some(
      (issue) =>
        issue.lifecycle.state === "current" &&
        (issue.severity === "error" || issue.severity === "security-error"),
    );
    const hasUnresolvedBehavior = value.unresolvedItems.length > 0;
    const requiredValidationPassed = value.validation.every(
      (check) => !check.required || check.result === "passed",
    );
    if (
      value.state === "ready-for-acceptance" &&
      (hasBlockingIssue || hasUnresolvedBehavior || !requiredValidationPassed)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Ready candidates require no blocking issue, no unresolved behavior, and all required checks to pass.",
        path: ["state"],
      });
    }
    if (getCandidateReviewDigest(value) !== value.reviewDigest) {
      context.addIssue({
        code: "custom",
        message:
          "Candidate review digest must hash the exact canonical record.",
        path: ["reviewDigest"],
      });
    }
  });

export const candidateDecisionV1Schema = z
  .object({
    artifact: candidateArtifactReferenceV1Schema,
    authorization: candidateReviewAuthorizationProofV1Schema,
    authorizationDecisionId: solutionStableIdSchema,
    contractVersion: z.literal(1),
    decidedAt: utcTimestampSchema,
    decidedBy: solutionStableIdSchema,
    decision: z.enum(["accepted", "rejected"]),
    deploymentAuthority: z.literal("none"),
    extension: aiAuthoredExtensionV1Schema,
    reviewDigest: sha256DigestSchema,
    review: candidateReviewRecordV1Schema,
    reviewId: solutionStableIdSchema,
    sourceSolutionRevisionId: solutionRevisionIdSchema,
    successorSolutionRevisionId: solutionRevisionIdSchema.optional(),
    writeAuthority: z.literal("none"),
  })
  .strict()
  .superRefine((value, context) => {
    const expectedAction = value.decision === "accepted" ? "accept" : "reject";
    const decisionExtensionFromReview = {
      ...value.review.extension,
      acceptance: value.extension.acceptance,
      exportSafety: value.extension.exportSafety,
      solutionRevisionId: value.extension.solutionRevisionId,
    };
    if (
      value.review.reviewId !== value.reviewId ||
      value.review.reviewDigest !== value.reviewDigest ||
      digestCanonicalValue(value.review.artifact) !==
        digestCanonicalValue(value.artifact) ||
      digestCanonicalValue(decisionExtensionFromReview) !==
        digestCanonicalValue(value.extension)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Candidate decisions must embed the exact source review and deterministic decision extension projection.",
        path: ["review"],
      });
    }
    if (
      value.authorizationDecisionId !==
        value.authorization.allowedDecision.decisionId ||
      !hasExactCandidateAuthorizationProof({
        action: expectedAction,
        artifactDigest: value.artifact.artifactDigest,
        completedAt: value.decidedAt,
        principalId: value.decidedBy,
        proof: value.authorization,
        reviewDigest: value.reviewDigest,
        reviewId: value.reviewId,
        scope: value.artifact.scope,
        solutionRevisionId: value.sourceSolutionRevisionId,
      })
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Candidate decisions must embed the exact verified authorization request and allowed decision.",
        path: ["authorization"],
      });
    }
    if (
      !hasExactArtifactExtensionAuthority({
        artifact: value.artifact,
        extension: value.extension,
      }) ||
      value.artifact.solutionRevisionId !== value.sourceSolutionRevisionId
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Candidate decisions must preserve the exact stored artifact, Prompt 24D outputs, source revision, and model authority.",
        path: ["artifact"],
      });
    }
    if (
      value.decision === "accepted" &&
      (value.successorSolutionRevisionId === undefined ||
        value.successorSolutionRevisionId === value.sourceSolutionRevisionId ||
        value.extension.solutionRevisionId !==
          value.successorSolutionRevisionId)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "An accepted decision must bind one distinct immutable successor Solution Revision.",
        path: ["successorSolutionRevisionId"],
      });
    }
    if (
      value.decision === "rejected" &&
      (value.successorSolutionRevisionId !== undefined ||
        value.extension.solutionRevisionId !== value.sourceSolutionRevisionId)
    ) {
      context.addIssue({
        code: "custom",
        message: "A rejected candidate cannot create a successor revision.",
        path: ["successorSolutionRevisionId"],
      });
    }
    if (value.decision === "accepted") {
      if (
        value.extension.acceptance.state !== "accepted" ||
        value.extension.acceptance.acceptedAt !== value.decidedAt ||
        value.extension.acceptance.acceptedBy !== value.decidedBy ||
        value.extension.exportSafety.state !== "safe-to-export"
      ) {
        context.addIssue({
          code: "custom",
          message:
            "An accepted decision must bind the exact reviewer, time, accepted state, and safe-to-export Evidence.",
          path: ["extension", "acceptance"],
        });
      }
    } else if (
      value.extension.acceptance.state !== "rejected" ||
      value.extension.acceptance.rejectedAt !== value.decidedAt ||
      value.extension.acceptance.rejectedBy !== value.decidedBy ||
      value.extension.exportSafety.state !== "not-safe"
    ) {
      context.addIssue({
        code: "custom",
        message:
          "A rejected decision must bind the exact reviewer, time, rejected state, and not-safe export state.",
        path: ["extension", "acceptance"],
      });
    }
  });

const candidateEvidenceMediaType =
  "application/vnd.cloudmarkup.ai-extension-candidate.v1+json" as const;
const requiredStaticExportEvidence = {
  kind: "ai-extension-parse-static-validity",
  rank: 4,
  requirements: ["ai-extension-parse-static-validity"],
} as const;
const requiredApplicationExportEvidence = {
  kind: "application-build-and-tests",
  rank: 5,
  requirements: ["application-build-and-tests", "application-security-checks"],
} as const;

function exactCandidateExportSafetyEvidenceIds(input: {
  readonly artifact: CandidateArtifactAuthorityV1;
  readonly evidence: readonly EvidenceRecordV1[];
  readonly extension: AiAuthoredExtensionV1;
  readonly sourceSolutionRevisionDigest: Sha256Digest;
  readonly successorSolutionRevisionId: string;
}): readonly string[] | undefined {
  const levels =
    input.extension.target.kind === "application"
      ? [requiredStaticExportEvidence, requiredApplicationExportEvidence]
      : [requiredStaticExportEvidence];
  const candidateSizeBytes = input.artifact.files.reduce(
    (total, file) => total + file.sizeBytes,
    0,
  );
  const evidenceIds: string[] = [];
  for (const level of levels) {
    const matching = input.evidence.filter((record) => {
      const candidateArtifacts = record.artifacts.filter(
        ({ digest }) => digest === input.artifact.artifactDigest,
      );
      return (
        record.solutionRevisionId === input.successorSolutionRevisionId &&
        record.staleness.state === "current" &&
        record.level.kind === level.kind &&
        record.level.rank === level.rank &&
        record.provenance.inputDigests.includes(
          input.artifact.artifactDigest,
        ) &&
        record.provenance.inputDigests.includes(
          input.sourceSolutionRevisionDigest,
        ) &&
        record.checks.every(
          (check) =>
            check.status === "passed" &&
            check.artifactDigests.includes(input.artifact.artifactDigest),
        ) &&
        level.requirements.every(
          (requirement) =>
            record.checks.filter(
              (check) =>
                check.status === "passed" &&
                check.generationCoverageRequirement === requirement &&
                check.artifactDigests.includes(input.artifact.artifactDigest),
            ).length === 1,
        ) &&
        candidateArtifacts.length === 1 &&
        candidateArtifacts[0]?.mediaType === candidateEvidenceMediaType &&
        candidateArtifacts[0].sizeBytes === candidateSizeBytes
      );
    });
    if (matching.length !== 1) return undefined;
    const record = matching[0];
    if (record === undefined) return undefined;
    evidenceIds.push(record.id);
  }
  return evidenceIds.sort();
}

export function getCandidateExportInputId(input: {
  readonly acceptanceAuthorization: CandidateReviewAuthorizationProofV1;
  readonly acceptedAt: string;
  readonly acceptedBy: string;
  readonly artifactDigest: Sha256Digest;
  readonly attemptAuthority: readonly CandidateAttemptReplayAuthorityV1[];
  readonly review: CandidateReviewRecordV1;
  readonly sourceSolutionRevision: z.output<
    typeof solutionRevisionManifestV1Schema
  >;
  readonly successorSolutionRevision: z.output<
    typeof solutionRevisionManifestV1Schema
  >;
}): string {
  return `candidate-export-input-${digestCanonicalValue({
    acceptedAt: input.acceptedAt,
    acceptedBy: input.acceptedBy,
    artifactDigest: input.artifactDigest,
    attemptAuthorityDigest: digestCanonicalValue(input.attemptAuthority),
    authorizationProofDigest: digestCanonicalValue(
      input.acceptanceAuthorization,
    ),
    reviewRecordDigest: digestCanonicalValue(input.review),
    sourceSolutionRevisionDigest: digestCanonicalValue(
      input.sourceSolutionRevision,
    ),
    successorSolutionRevisionDigest: digestCanonicalValue(
      input.successorSolutionRevision,
    ),
  }).slice("sha256:".length, 38)}`;
}
export const candidateExportInputV1Schema = z
  .object({
    acceptanceAuthorization: candidateReviewAuthorizationProofV1Schema,
    acceptanceAuthorizationDecisionId: solutionStableIdSchema,
    artifact: candidateArtifactReferenceV1Schema,
    attempts: z.array(candidateAttemptV1Schema).min(1).max(3),
    attemptAuthority: z
      .array(candidateAttemptReplayAuthorityV1Schema)
      .min(1)
      .max(3),
    artifactReadAuthority: z.literal("restricted-candidate-artifact-only"),
    classification: z.literal("immutable-solution-revision-export-input"),
    contractVersion: z.literal(1),
    createdAt: utcTimestampSchema,
    createdBy: solutionStableIdSchema,
    deploymentAuthority: z.literal("none"),
    evidence: evidenceCollectionV1Schema,
    exportInputDigest: sha256DigestSchema,
    exportInputId: solutionStableIdSchema,
    extension: aiAuthoredExtensionV1Schema,
    issueHistory: z.array(activeIssueV1Schema).max(10_000),
    issues: z.array(activeIssueV1Schema).max(1_000),
    repositoryWriteAuthority: z.literal("none"),
    review: candidateReviewRecordV1Schema,
    reviewDigest: sha256DigestSchema,
    reviewEvidence: z.array(evidenceRecordV1Schema).max(128),
    reviewId: solutionStableIdSchema,
    sourceIssueIdsAtFreeze: z.array(activeIssueIdSchema).max(10_000),
    sourceSolutionRevision: solutionRevisionManifestV1Schema,
    sourceSolutionRevisionDigest: sha256DigestSchema,
    sourceSolutionRevisionId: solutionRevisionIdSchema,
    successorSolutionRevision: solutionRevisionManifestV1Schema,
    successorSolutionRevisionDigest: sha256DigestSchema,
    userModifications: z.array(candidateUserModificationV1Schema).max(1_000),
  })
  .strict()
  .superRefine((value, context) => {
    const successorId = value.successorSolutionRevision.solutionRevisionId;
    const acceptedExtensionFromReview = {
      ...value.review.extension,
      acceptance: value.extension.acceptance,
      exportSafety: value.extension.exportSafety,
      solutionRevisionId: value.extension.solutionRevisionId,
    };
    if (
      value.review.state !== "ready-for-acceptance" ||
      value.review.reviewId !== value.reviewId ||
      value.review.reviewDigest !== value.reviewDigest ||
      digestCanonicalValue(value.review.artifact) !==
        digestCanonicalValue(value.artifact) ||
      digestCanonicalValue(value.review.attempts) !==
        digestCanonicalValue(value.attempts) ||
      digestCanonicalValue(value.review.attemptAuthority) !==
        digestCanonicalValue(value.attemptAuthority) ||
      digestCanonicalValue(value.review.evidence) !==
        digestCanonicalValue(value.reviewEvidence) ||
      digestCanonicalValue(value.review.issues) !==
        digestCanonicalValue(value.issues) ||
      digestCanonicalValue(value.review.issueHistory) !==
        digestCanonicalValue(value.issueHistory) ||
      digestCanonicalValue(acceptedExtensionFromReview) !==
        digestCanonicalValue(value.extension)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Export input must embed the exact accepted source Candidate Review and its deterministic accepted extension projection.",
        path: ["review"],
      });
    }
    if (
      value.acceptanceAuthorizationDecisionId !==
        value.acceptanceAuthorization.allowedDecision.decisionId ||
      !hasExactCandidateAuthorizationProof({
        action: "accept",
        artifactDigest: value.artifact.artifactDigest,
        completedAt: value.createdAt,
        principalId: value.createdBy,
        proof: value.acceptanceAuthorization,
        reviewDigest: value.review.reviewDigest,
        reviewId: value.review.reviewId,
        scope: value.review.scope,
        solutionRevisionId: value.sourceSolutionRevisionId,
      })
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Export input must embed the exact verified acceptance request and allowed decision.",
        path: ["acceptanceAuthorization"],
      });
    }
    if (
      getCandidateExportInputId({
        acceptanceAuthorization: value.acceptanceAuthorization,
        acceptedAt: value.createdAt,
        acceptedBy: value.createdBy,
        artifactDigest: value.artifact.artifactDigest,
        attemptAuthority: value.attemptAuthority,
        review: value.review,
        sourceSolutionRevision: value.sourceSolutionRevision,
        successorSolutionRevision: value.successorSolutionRevision,
      }) !== value.exportInputId
    ) {
      context.addIssue({
        code: "custom",
        message:
          "The stable export input ID must bind the exact review and acceptance authorization proof.",
        path: ["exportInputId"],
      });
    }
    if (
      !hasExactArtifactExtensionAuthority({
        artifact: value.artifact,
        extension: value.extension,
      }) ||
      !hasExactAttemptModelAuthority({
        artifact: value.artifact,
        attempts: value.attempts,
        extension: value.extension,
      }) ||
      !hasExactCandidateAttemptReplayAuthority(
        value.attempts,
        value.attemptAuthority,
      )
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Export input must preserve the exact artifact, Prompt 24D outputs, original model output, final model provenance, and ordered model usage.",
        path: ["extension"],
      });
    }
    if (
      value.extension.acceptance.state !== "accepted" ||
      value.extension.acceptance.acceptedAt !== value.createdAt ||
      value.extension.acceptance.acceptedBy !== value.createdBy ||
      value.extension.exportSafety.state !== "safe-to-export"
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Export input requires the exact accepted reviewer, time, and safe-to-export extension state.",
        path: ["extension", "acceptance"],
      });
    }
    if (
      successorId === value.sourceSolutionRevisionId ||
      successorId !== value.extension.solutionRevisionId ||
      value.artifact.solutionRevisionId !== value.sourceSolutionRevisionId
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Candidate export input must bind one distinct successor to the exact source revision, artifact, and accepted extension.",
        path: ["successorSolutionRevision"],
      });
    }
    if (
      value.sourceSolutionRevision.solutionRevisionId !==
        value.sourceSolutionRevisionId ||
      digestCanonicalValue(value.sourceSolutionRevision) !==
        value.sourceSolutionRevisionDigest ||
      value.sourceSolutionRevision.aiExtensionIds.includes(value.extension.id)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "The source Solution Revision digest and ID must bind the exact embedded immutable manifest before this extension was accepted.",
        path: ["sourceSolutionRevisionDigest"],
      });
    }
    if (
      digestCanonicalValue(value.successorSolutionRevision) !==
      value.successorSolutionRevisionDigest
    ) {
      context.addIssue({
        code: "custom",
        message:
          "The successor Solution Revision digest must bind the exact immutable manifest.",
        path: ["successorSolutionRevisionDigest"],
      });
    }
    const exactSuccessorExtensionIds = [
      ...new Set([
        ...value.sourceSolutionRevision.aiExtensionIds,
        value.extension.id,
      ]),
    ].sort();
    if (
      digestCanonicalValue(
        [...value.successorSolutionRevision.aiExtensionIds].sort(),
      ) !== digestCanonicalValue(exactSuccessorExtensionIds) ||
      value.successorSolutionRevision.createdAt !== value.createdAt ||
      value.successorSolutionRevision.createdBy !== value.createdBy
    ) {
      context.addIssue({
        code: "custom",
        message:
          "The successor Solution Revision must be created by the accepting principal at the acceptance time and contain the exact source-plus-accepted extension IDs.",
        path: ["successorSolutionRevision", "aiExtensionIds"],
      });
    }
    const frozenEvidence = [
      ...value.successorSolutionRevision.evidenceIdsAtFreeze,
    ].sort();
    const suppliedEvidence = value.evidence.records.map(({ id }) => id).sort();
    if (
      digestCanonicalValue(frozenEvidence) !==
        digestCanonicalValue(suppliedEvidence) ||
      value.evidence.records.some(
        (record) => record.solutionRevisionId !== successorId,
      )
    ) {
      context.addIssue({
        code: "custom",
        message:
          "The export Evidence collection must exactly equal the successor freeze and bind that revision.",
        path: ["evidence"],
      });
    }
    try {
      validateSolutionRevisionManifestWithEvidenceV1(
        value.successorSolutionRevision,
        value.evidence,
      );
    } catch {
      context.addIssue({
        code: "custom",
        message:
          "The successor Solution Revision and frozen Evidence must pass deterministic lifecycle validation.",
        path: ["successorSolutionRevision"],
      });
    }
    const reviewEvidenceIds = new Set<string>();
    value.reviewEvidence.forEach((record, index) => {
      if (reviewEvidenceIds.has(record.id)) {
        context.addIssue({
          code: "custom",
          message: "Exported review Evidence IDs must be unique.",
          path: ["reviewEvidence", index, "id"],
        });
      }
      reviewEvidenceIds.add(record.id);
    });
    try {
      assertCandidateIssueHistoryV1({
        evidence: value.reviewEvidence,
        history: value.issueHistory,
        latest: value.issues,
        solutionRevisionId: value.sourceSolutionRevisionId,
      });
    } catch {
      context.addIssue({
        code: "custom",
        message:
          "Export input must preserve the exact source-bound append-only issue history and latest records.",
        path: ["issueHistory"],
      });
    }
    if (!hasExactExtensionIssueIds(value.extension, value.issues)) {
      context.addIssue({
        code: "custom",
        message:
          "The accepted extension must preserve the exact latest candidate issue IDs.",
        path: ["extension", "issueIds"],
      });
    }
    const uniqueSourceIssueIds = [
      ...new Set(value.sourceIssueIdsAtFreeze),
    ].sort();
    const exactSourceIssueIds = [
      ...value.sourceSolutionRevision.issueIdsAtFreeze,
    ].sort();
    const expectedSuccessorIssueIds = [
      ...new Set([
        ...uniqueSourceIssueIds,
        ...value.issues.map(({ id }) => id),
      ]),
    ].sort();
    if (
      uniqueSourceIssueIds.length !== value.sourceIssueIdsAtFreeze.length ||
      digestCanonicalValue(uniqueSourceIssueIds) !==
        digestCanonicalValue(exactSourceIssueIds) ||
      digestCanonicalValue(expectedSuccessorIssueIds) !==
        digestCanonicalValue(
          [...value.successorSolutionRevision.issueIdsAtFreeze].sort(),
        )
    ) {
      context.addIssue({
        code: "custom",
        message:
          "The successor issue freeze must be the exact union of source issues and latest candidate issues.",
        path: ["successorSolutionRevision", "issueIdsAtFreeze"],
      });
    }
    const requiredEvidenceIds = exactCandidateExportSafetyEvidenceIds({
      artifact: value.artifact,
      evidence: value.evidence.records,
      extension: value.extension,
      sourceSolutionRevisionDigest: value.sourceSolutionRevisionDigest,
      successorSolutionRevisionId: successorId,
    });
    const requiredReviewEvidenceIds = exactCandidateExportSafetyEvidenceIds({
      artifact: value.artifact,
      evidence: value.reviewEvidence,
      extension: value.extension,
      sourceSolutionRevisionDigest: value.sourceSolutionRevisionDigest,
      successorSolutionRevisionId: value.sourceSolutionRevisionId,
    });
    if (
      requiredEvidenceIds === undefined ||
      requiredReviewEvidenceIds === undefined ||
      value.extension.exportSafety.state !== "safe-to-export" ||
      new Set(value.extension.exportSafety.evidenceIds).size !==
        value.extension.exportSafety.evidenceIds.length ||
      digestCanonicalValue(requiredEvidenceIds) !==
        digestCanonicalValue(
          [...value.extension.exportSafety.evidenceIds].sort(),
        )
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Safe-to-export Evidence IDs must exactly name the unique required, current, successor-bound candidate validation records.",
        path: ["extension", "exportSafety", "evidenceIds"],
      });
    }
    const modificationSource =
      value.artifact.origin.kind === "user-modified"
        ? value.artifact.origin.edits
        : [];
    if (
      digestCanonicalValue(value.userModifications) !==
      digestCanonicalValue(modificationSource)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Export input must preserve the exact user modification lineage.",
        path: ["userModifications"],
      });
    }
    const ownershipByPath = new Map<
      string,
      (typeof value.successorSolutionRevision.sourceOwnership)[number]
    >(
      value.successorSolutionRevision.sourceOwnership.map((entry) => [
        entry.path,
        entry,
      ]),
    );
    value.artifact.files.forEach((file, index) => {
      const ownership = ownershipByPath.get(file.path);
      const expectedOwnership =
        file.ownership === "user-owned-preserved"
          ? "user-owned"
          : "approved-extension";
      if (
        ownership?.contentHash !== file.digest ||
        ownership.ownership !== expectedOwnership
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Successor source ownership must bind every exact accepted file without transferring preserved user ownership.",
          path: ["artifact", "files", index],
        });
      }
    });
    const digestProjection = { ...value } as Partial<typeof value>;
    delete digestProjection.exportInputDigest;
    if (digestCanonicalValue(digestProjection) !== value.exportInputDigest) {
      context.addIssue({
        code: "custom",
        message:
          "The immutable export input digest must bind the exact complete record.",
        path: ["exportInputDigest"],
      });
    }
  });

export const candidateAcceptanceResultV1Schema = z
  .object({
    contractVersion: z.literal(1),
    decision: candidateDecisionV1Schema,
    exportInput: candidateExportInputV1Schema,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.decision.decision !== "accepted" ||
      value.decision.successorSolutionRevisionId !==
        value.exportInput.successorSolutionRevision.solutionRevisionId ||
      value.decision.sourceSolutionRevisionId !==
        value.exportInput.sourceSolutionRevisionId ||
      value.decision.reviewDigest !== value.exportInput.reviewDigest ||
      value.decision.reviewId !== value.exportInput.reviewId ||
      value.decision.decidedAt !== value.exportInput.createdAt ||
      value.decision.decidedBy !== value.exportInput.createdBy ||
      value.decision.authorizationDecisionId !==
        value.exportInput.acceptanceAuthorizationDecisionId ||
      digestCanonicalValue(value.decision.authorization) !==
        digestCanonicalValue(value.exportInput.acceptanceAuthorization) ||
      digestCanonicalValue(value.decision.review) !==
        digestCanonicalValue(value.exportInput.review) ||
      digestCanonicalValue(value.decision.artifact) !==
        digestCanonicalValue(value.exportInput.artifact) ||
      digestCanonicalValue(value.decision.extension) !==
        digestCanonicalValue(value.exportInput.extension)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Candidate acceptance result must bind the exact accepted decision, reviewer authority, artifact, extension, and immutable export input.",
        path: ["exportInput"],
      });
    }
  });

export type CandidateScopeV1 = z.output<typeof candidateScopeV1Schema>;
export type CandidateDiagnosticV1 = z.output<
  typeof candidateDiagnosticV1Schema
>;
export type CandidateArtifactFileReferenceV1 = z.output<
  typeof candidateArtifactFileReferenceV1Schema
>;
export type CandidateArtifactReferenceV1 = z.output<
  typeof candidateArtifactReferenceV1Schema
>;
export type InvalidCandidateArtifactReferenceV1 = z.output<
  typeof invalidCandidateArtifactReferenceV1Schema
>;
export type CandidateAttemptV1 = z.output<typeof candidateAttemptV1Schema>;
export type CandidateDecisionV1 = z.output<typeof candidateDecisionV1Schema>;
export type CandidateUserModificationV1 = z.output<
  typeof candidateUserModificationV1Schema
>;
export type CandidateArtifactOriginV1 = z.output<
  typeof candidateArtifactOriginV1Schema
>;
export type CandidateAttemptModelProvenanceV1 = z.output<
  typeof candidateAttemptModelProvenanceV1Schema
>;
export type CandidateExportInputV1 = z.output<
  typeof candidateExportInputV1Schema
>;
export type CandidateAcceptanceResultV1 = z.output<
  typeof candidateAcceptanceResultV1Schema
>;
export type CandidateExpectedTestV1 = z.output<
  typeof candidateExpectedTestV1Schema
>;
export type CandidateReviewAssumptionV1 = z.output<
  typeof candidateReviewAssumptionV1Schema
>;
export type CandidateReviewUnresolvedItemV1 = z.output<
  typeof candidateReviewUnresolvedItemV1Schema
>;
export type { ActiveIssueV1, AiAuthoredExtensionV1, EvidenceRecordV1 };

export const candidateArtifactLifecycleV1Schema = z.discriminatedUnion(
  "state",
  [
    z.object({ state: z.literal("current") }).strict(),
    z
      .object({
        state: z.literal("superseded"),
        successorArtifactDigest: sha256DigestSchema,
        successorArtifactId: solutionStableIdSchema,
        supersededAt: utcTimestampSchema,
      })
      .strict(),
  ],
);

export type CandidateArtifactLifecycleV1 = z.output<
  typeof candidateArtifactLifecycleV1Schema
>;

export const candidateValidationReplayV1Schema = z
  .object({
    attemptAuthority: z
      .array(candidateAttemptReplayAuthorityV1Schema)
      .min(1)
      .max(3),
    bundle: modelCandidateBundleV1Schema,
    bundleDigest: sha256DigestSchema,
    descriptor: modelInvocationDescriptorV1Schema,
    generationContext: modelGenerationContextV1Schema,
    generationContextDigest: sha256DigestSchema,
    solutionRevision: solutionRevisionManifestV1Schema,
    solutionRevisionDigest: sha256DigestSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const finalAuthority = value.attemptAuthority.at(-1);
    const uniqueInvocationIds = new Set<string>();
    const uniqueIdempotencyDigests = new Set<string>();
    const uniqueUsageRecordIds = new Set<string>();
    value.attemptAuthority.forEach((authority, index) => {
      const expectedKind = index === 0 ? "generation" : "repair";
      if (
        authority.attemptNumber !== index ||
        authority.kind !== expectedKind ||
        (expectedKind === "repair" &&
          authority.descriptor.feature !== "candidate.repair")
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Validation replay attempts must be the exact ordered generation-then-repair sequence.",
          path: ["attemptAuthority", index],
        });
      }
      for (const [seen, field, value] of [
        [
          uniqueInvocationIds,
          "invocationId",
          authority.descriptor.invocationId,
        ],
        [
          uniqueIdempotencyDigests,
          "idempotencyKeyDigest",
          authority.descriptor.idempotencyKeyDigest,
        ],
        [uniqueUsageRecordIds, "usageRecordId", authority.usage.usageRecordId],
      ] as const) {
        if (seen.has(value)) {
          context.addIssue({
            code: "custom",
            message: `Validation replay attempt ${field} values must be unique.`,
            path: ["attemptAuthority", index, field],
          });
        }
        seen.add(value);
      }
    });
    if (
      finalAuthority === undefined ||
      digestCanonicalValue(finalAuthority.descriptor) !==
        digestCanonicalValue(value.descriptor)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Validation replay descriptor must be the exact final ordered attempt descriptor.",
        path: ["descriptor"],
      });
    }
    if (digestCanonicalValue(value.bundle) !== value.bundleDigest) {
      context.addIssue({
        code: "custom",
        message: "Validation replay must bind the exact candidate bundle.",
        path: ["bundleDigest"],
      });
    }
    if (
      digestCanonicalValue(value.generationContext) !==
      value.generationContextDigest
    ) {
      context.addIssue({
        code: "custom",
        message: "Validation replay must bind the exact generation context.",
        path: ["generationContextDigest"],
      });
    }
    if (
      digestCanonicalValue(value.solutionRevision) !==
      value.solutionRevisionDigest
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Validation replay must bind the exact source Solution Revision.",
        path: ["solutionRevisionDigest"],
      });
    }
  });

export type CandidateValidationReplayV1 = z.output<
  typeof candidateValidationReplayV1Schema
>;

const candidateInspectionFileV1Schema = z
  .object({
    content: z.string().max(4 * 1024 * 1024),
    digest: sha256DigestSchema,
    ownership: z.enum(["ai-authored-candidate", "user-owned-preserved"]),
    path: safeRelativePathSchema,
    sizeBytes: z
      .number()
      .int()
      .nonnegative()
      .max(4 * 1024 * 1024),
    sourceKind: z.enum(["file", "patch"]),
  })
  .strict();

export const candidateInspectionV1Schema = z
  .object({
    artifactDigest: sha256DigestSchema,
    artifactId: solutionStableIdSchema,
    authorization: z
      .object({
        action: z.literal("inspect"),
        authorizationDecisionId: solutionStableIdSchema,
        principalId: solutionStableIdSchema,
      })
      .strict(),
    editAuthority: z.literal("reviewed-user-modifications-only"),
    files: z.array(candidateInspectionFileV1Schema).min(1).max(1_000),
    inspectionDigest: sha256DigestSchema,
    repositoryWriteAuthority: z.literal("none"),
    reviewDigest: sha256DigestSchema,
    reviewId: solutionStableIdSchema,
    scope: candidateScopeV1Schema,
  })
  .strict()
  .superRefine((value, context) => {
    const projection = { ...value } as Partial<typeof value>;
    delete projection.inspectionDigest;
    if (digestCanonicalValue(projection) !== value.inspectionDigest) {
      context.addIssue({
        code: "custom",
        message:
          "Candidate inspection digest must bind the exact authorized view.",
        path: ["inspectionDigest"],
      });
    }
  });

export type CandidateInspectionV1 = z.output<
  typeof candidateInspectionV1Schema
>;
