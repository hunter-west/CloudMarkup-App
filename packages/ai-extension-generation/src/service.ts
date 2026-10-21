import {
  getApplicationContractRecordContentHash,
  getApplicationContractsContentHash,
} from "@cloudmarkup/domain";
import {
  activeIssueV1Schema,
  aiAuthoredExtensionV1Schema,
  aiExtensionIdSchema,
  aiExtensionOwnedPathV1Schema,
  aiExtensionSourceReferenceV1Schema,
  aiExtensionTargetV1Schema,
  evidenceRecordV1Schema,
  modelApplicationSourceGenerationRequestV1Schema,
  modelCandidateBundleV1Schema,
  modelCandidateRepairRequestV1Schema,
  modelIacExtensionGenerationRequestV1Schema,
  sha256DigestSchema,
  solutionRevisionIdSchema,
  solutionStableIdSchema,
  structuredExtensionRequestV1Schema,
  utcTimestampSchema,
  workloadV2Schema,
  type ActiveIssueV1,
  type AiAuthoredExtensionV1,
  type EvidenceRecordV1,
  type ModelCandidateBundleV1,
  type ModelGenerationContextV1,
  type Sha256Digest,
  type WorkloadV2,
} from "@cloudmarkup/schemas";
import {
  ModelGatewayError,
  type ModelGateway,
  type ModelGatewayInvocationContextV1,
  type ModelGatewayResultV1,
  type ModelRequestFor,
} from "@cloudmarkup/model-gateway";
import { z } from "zod";

import {
  candidateValidationReplayV1Schema,
  createCandidateArtifactReviewBinding,
  createCandidateArtifactReference,
  type CandidateArtifactStore,
  type CandidateValidationReplayV1,
} from "./artifact-store.js";
import {
  AI_EXTENSION_GENERATION_COORDINATOR_ID,
  AI_EXTENSION_GENERATION_COORDINATOR_VERSION,
  assertCandidateIssueHistoryV1,
  candidateAttemptReplayAuthorityV1Schema,
  candidateAttemptV1Schema,
  candidateDiagnosticV1Schema,
  candidateGenerationProgressFinalizationV1Schema,
  candidateReviewRecordV1Schema,
  candidateScopeV1Schema,
  getCandidateReviewDigest,
  type CandidateArtifactReferenceV1,
  type CandidateAttemptReplayAuthorityV1,
  type CandidateAttemptV1,
  type CandidateDiagnosticV1,
  type CandidateGenerationProgressFinalizationV1,
  type CandidateReviewRecordV1,
  type CandidateScopeV1,
} from "./contracts.js";
import { createCandidateStaticEvidence } from "./evidence.js";
import {
  candidateGenerationFailureV1Schema,
  getCandidateGenerationFailureDigest,
  type CandidateGenerationFailureV1,
} from "./failure.js";
import {
  reconcileCandidateIssueAssessment,
  type CandidateIssueRepairReferenceV1,
} from "./issues.js";
import {
  materializeCandidateBundle,
  type CandidateMaterializationResult,
} from "./materializer.js";
import {
  digestCanonicalValue,
  sameStringSet,
  sha256Text,
  stableRecordId,
  utf8ByteLength,
} from "./security.js";
import {
  candidateTargetValidationResultV1Schema,
  type CandidateTargetValidationPort,
  type CandidateTargetValidationResultV1,
  type CandidateValidationOutcomeV1,
} from "./validation.js";

type GenerationRequest =
  | ModelRequestFor<"application-source.generate">
  | ModelRequestFor<"iac-extension.generate">;
type GenerationResult =
  | ModelGatewayResultV1<"application-source.generate">
  | ModelGatewayResultV1<"iac-extension.generate">;

export type CandidateModelGateway = Pick<
  ModelGateway,
  | "generateApplicationSourceCandidate"
  | "generateIacExtensionCandidate"
  | "repairCandidate"
>;

export const candidateExtensionAuthorityV1Schema = z
  .object({
    id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u),
    ownedPaths: z.array(aiExtensionOwnedPathV1Schema).min(1).max(1_000),
    regenerationPolicy: z.enum([
      "replace-owned-exact",
      "propose-patch",
      "manual-only",
    ]),
    request: structuredExtensionRequestV1Schema,
    reservationId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u),
    sourceReferences: z
      .array(aiExtensionSourceReferenceV1Schema)
      .min(1)
      .max(256),
    target: aiExtensionTargetV1Schema,
  })
  .strict();

export type CandidateExtensionAuthorityV1 = z.output<
  typeof candidateExtensionAuthorityV1Schema
>;

export const candidateCommercialAuthorityV1Schema = z
  .object({
    acceptedWorkflowEstimateMaximumCreditUnits: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER),
    attemptEstimateCreditUnits: z
      .array(z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER))
      .min(1)
      .max(3),
    reservationId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u),
  })
  .strict();

export type CandidateCommercialAuthorityV1 = z.output<
  typeof candidateCommercialAuthorityV1Schema
>;

export interface DeterministicGenerationSelectionV1 {
  readonly authority: "deterministic-supported";
  readonly solutionRevisionId: string;
  readonly target: "application" | "terraform" | "cloudformation";
}

export interface CustomCandidateGenerationInputV1 {
  readonly applicationWorkload?: unknown;
  readonly assessedAt: string;
  readonly authority: "ai-assisted-custom" | "approved-iac-extension";
  readonly commercialAuthority: unknown;
  readonly extension: unknown;
  readonly maximumRepairAttempts: number;
  readonly modelContext: ModelGatewayInvocationContextV1;
  readonly modelRequest: GenerationRequest;
  readonly repairContexts: readonly ModelGatewayInvocationContextV1[];
  readonly scope: CandidateScopeV1;
}

export interface DeterministicGenerationRequiredV1 {
  readonly contractVersion: 1;
  readonly modelInvocations: 0;
  readonly solutionRevisionId: string;
  readonly state: "deterministic-generator-required";
  readonly target: "application" | "terraform" | "cloudformation";
  readonly writeAuthority: "none";
}

export type CandidateGenerationResultV1 =
  | DeterministicGenerationRequiredV1
  | CandidateGenerationFailureV1
  | CandidateReviewRecordV1;

export interface AiExtensionGenerationCoordinator {
  generate(
    input:
      DeterministicGenerationSelectionV1 | CustomCandidateGenerationInputV1,
    signal?: AbortSignal,
  ): Promise<CandidateGenerationResultV1>;
}

export interface AiExtensionGenerationCoordinatorDependencies {
  readonly artifactStore: CandidateArtifactStore;
  readonly gateway: CandidateModelGateway;
  readonly progress?: CandidateGenerationProgressPort;
  readonly validators: Readonly<{
    application: CandidateTargetValidationPort;
    cloudformation: CandidateTargetValidationPort;
    terraform: CandidateTargetValidationPort;
  }>;
}

export const CANDIDATE_GENERATION_MAXIMUM_PROGRESS_SNAPSHOTS = 10;

export const candidateGenerationProgressPredecessorV1Schema =
  z.discriminatedUnion("state", [
    z
      .object({
        previousSnapshotDigest: z.literal("none"),
        state: z.literal("genesis"),
      })
      .strict(),
    z
      .object({
        previousSnapshotDigest: sha256DigestSchema,
        state: z.literal("continues"),
      })
      .strict(),
  ]);

export const candidateGenerationProgressSnapshotV1Schema = z
  .object({
    assessedAt: utcTimestampSchema,
    attemptNumber: z.number().int().min(0).max(2),
    bundleDigest: sha256DigestSchema,
    contractVersion: z.literal(1),
    deploymentAuthority: z.literal("none"),
    evidence: z.array(evidenceRecordV1Schema).max(128),
    evidenceDigest: sha256DigestSchema,
    extensionId: aiExtensionIdSchema,
    generationRunId: solutionStableIdSchema,
    issueHistory: z.array(activeIssueV1Schema).max(10_000),
    issueHistoryDigest: sha256DigestSchema,
    issues: z.array(activeIssueV1Schema).max(1_000),
    issuesDigest: sha256DigestSchema,
    phase: z.enum([
      "generation-complete",
      "generation-rejected",
      "validation-assessed",
      "repair-complete",
      "repair-proposed",
      "repair-validated",
      "repair-rejected",
    ]),
    predecessor: candidateGenerationProgressPredecessorV1Schema,
    repositoryWriteAuthority: z.literal("none"),
    scope: candidateScopeV1Schema,
    sequence: z
      .number()
      .int()
      .min(1)
      .max(CANDIDATE_GENERATION_MAXIMUM_PROGRESS_SNAPSHOTS),
    snapshotDigest: sha256DigestSchema,
    solutionRevisionId: solutionRevisionIdSchema,
    writeAuthority: z.literal("none"),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.evidenceDigest !== digestCanonicalValue(value.evidence)) {
      context.addIssue({
        code: "custom",
        message: "Progress Evidence digest must bind the exact records.",
        path: ["evidenceDigest"],
      });
    }
    if (value.issueHistoryDigest !== digestCanonicalValue(value.issueHistory)) {
      context.addIssue({
        code: "custom",
        message: "Progress issue history digest must bind the exact history.",
        path: ["issueHistoryDigest"],
      });
    }
    if (value.issuesDigest !== digestCanonicalValue(value.issues)) {
      context.addIssue({
        code: "custom",
        message: "Progress issues digest must bind the exact latest records.",
        path: ["issuesDigest"],
      });
    }
    try {
      assertCandidateIssueHistoryV1({
        evidence: value.evidence,
        history: value.issueHistory,
        latest: value.issues,
        solutionRevisionId: value.solutionRevisionId,
      });
    } catch (error) {
      context.addIssue({
        code: "custom",
        message:
          error instanceof Error
            ? error.message
            : "Progress issue history is invalid.",
        path: ["issueHistory"],
      });
    }
    const projection = { ...value } as Partial<typeof value>;
    delete projection.snapshotDigest;
    if (value.snapshotDigest !== digestCanonicalValue(projection)) {
      context.addIssue({
        code: "custom",
        message: "Progress snapshot digest must bind the exact projection.",
        path: ["snapshotDigest"],
      });
    }
    if (
      (value.sequence === 1 && value.predecessor.state !== "genesis") ||
      (value.sequence > 1 && value.predecessor.state !== "continues")
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Progress predecessor authority must be genesis only at sequence one and linked thereafter.",
        path: ["predecessor"],
      });
    }
    if (
      (value.phase === "generation-complete" ||
        value.phase === "generation-rejected") &&
      value.attemptNumber !== 0
    ) {
      context.addIssue({
        code: "custom",
        message: "Generation progress must use attempt zero.",
        path: ["attemptNumber"],
      });
    }
    if (value.phase.startsWith("repair-") && value.attemptNumber === 0) {
      context.addIssue({
        code: "custom",
        message: "Repair progress requires a positive repair attempt number.",
        path: ["attemptNumber"],
      });
    }
  });

export type CandidateGenerationProgressSnapshotV1 = z.output<
  typeof candidateGenerationProgressSnapshotV1Schema
>;

const candidateGenerationProgressPhaseTransitions: Readonly<
  Record<
    CandidateGenerationProgressSnapshotV1["phase"],
    readonly CandidateGenerationProgressSnapshotV1["phase"][]
  >
> = {
  "generation-complete": ["validation-assessed"],
  "generation-rejected": [],
  "repair-complete": ["repair-proposed", "validation-assessed"],
  "repair-proposed": ["repair-validated"],
  "repair-rejected": [],
  "repair-validated": ["validation-assessed"],
  "validation-assessed": ["repair-complete", "repair-rejected"],
};

export const candidateGenerationProgressPrefixV1Schema = z
  .object({
    contractVersion: z.literal(1),
    generationRunId: solutionStableIdSchema,
    snapshots: z
      .array(candidateGenerationProgressSnapshotV1Schema)
      .min(1)
      .max(CANDIDATE_GENERATION_MAXIMUM_PROGRESS_SNAPSHOTS),
  })
  .strict()
  .superRefine((value, context) => {
    const first = value.snapshots[0];
    if (
      first === undefined ||
      (first.phase !== "generation-complete" &&
        first.phase !== "generation-rejected")
    ) {
      context.addIssue({
        code: "custom",
        message: "A progress stream must begin with exact generation state.",
        path: ["snapshots", 0, "phase"],
      });
    }
    value.snapshots.forEach((snapshot, index) => {
      if (snapshot.generationRunId !== value.generationRunId) {
        context.addIssue({
          code: "custom",
          message:
            "Every progress snapshot must bind the exact generation run.",
          path: ["snapshots", index, "generationRunId"],
        });
      }
      if (index === 0) {
        if (
          snapshot.sequence !== 1 ||
          snapshot.predecessor.state !== "genesis"
        ) {
          context.addIssue({
            code: "custom",
            message:
              "The first progress snapshot must be sequence one with genesis predecessor authority.",
            path: ["snapshots", index, "predecessor"],
          });
        }
        return;
      }
      const previous = value.snapshots[index - 1];
      if (previous === undefined) return;
      if (
        snapshot.sequence !== previous.sequence + 1 ||
        snapshot.predecessor.state !== "continues" ||
        snapshot.predecessor.previousSnapshotDigest !== previous.snapshotDigest
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Progress snapshots must be a contiguous sequence with an exact predecessor hash chain.",
          path: ["snapshots", index, "predecessor"],
        });
      }
      if (
        snapshot.extensionId !== previous.extensionId ||
        snapshot.solutionRevisionId !== previous.solutionRevisionId ||
        digestCanonicalValue(snapshot.scope) !==
          digestCanonicalValue(previous.scope)
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Progress continuation must retain exact extension, scope, and revision authority.",
          path: ["snapshots", index],
        });
      }
      if (
        !candidateGenerationProgressPhaseTransitions[previous.phase].includes(
          snapshot.phase,
        )
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Progress phases must follow the exact generation lifecycle.",
          path: ["snapshots", index, "phase"],
        });
      }
      const expectedAttempt =
        previous.phase === "validation-assessed" &&
        (snapshot.phase === "repair-complete" ||
          snapshot.phase === "repair-rejected")
          ? previous.attemptNumber + 1
          : previous.attemptNumber;
      if (snapshot.attemptNumber !== expectedAttempt) {
        context.addIssue({
          code: "custom",
          message:
            "Progress attempt numbers must be monotonic and advance only when repair completes.",
          path: ["snapshots", index, "attemptNumber"],
        });
      }
      if (
        snapshot.issueHistory.length < previous.issueHistory.length ||
        previous.issueHistory.some(
          (record, recordIndex) =>
            digestCanonicalValue(record) !==
            digestCanonicalValue(snapshot.issueHistory[recordIndex]),
        )
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Progress continuation cannot truncate or rewrite append-only issue history.",
          path: ["snapshots", index, "issueHistory"],
        });
      }
    });
  });

export type CandidateGenerationProgressPrefixV1 = z.output<
  typeof candidateGenerationProgressPrefixV1Schema
>;

export function getCandidateGenerationProgressPrefixDigest(input: {
  readonly contractVersion: 1;
  readonly generationRunId: string;
  readonly snapshots: readonly CandidateGenerationProgressSnapshotV1[];
}): Sha256Digest {
  return digestCanonicalValue({
    contractVersion: input.contractVersion,
    generationRunId: input.generationRunId,
    snapshots: input.snapshots,
  });
}

export const candidateGenerationProgressStreamV1Schema = z
  .object({
    contractVersion: z.literal(1),
    finalization: candidateGenerationProgressFinalizationV1Schema,
    generationRunId: solutionStableIdSchema,
    snapshots: z
      .array(candidateGenerationProgressSnapshotV1Schema)
      .min(1)
      .max(CANDIDATE_GENERATION_MAXIMUM_PROGRESS_SNAPSHOTS),
  })
  .strict()
  .superRefine((value, context) => {
    const prefix = {
      contractVersion: value.contractVersion,
      generationRunId: value.generationRunId,
      snapshots: value.snapshots,
    } as const;
    if (!candidateGenerationProgressPrefixV1Schema.safeParse(prefix).success) {
      context.addIssue({
        code: "custom",
        message:
          "A finalized progress stream must contain one valid live prefix.",
        path: ["snapshots"],
      });
    }
    const finalSnapshot = value.snapshots.at(-1);
    if (
      finalSnapshot === undefined ||
      value.finalization.generationRunId !== value.generationRunId ||
      value.finalization.finalSequence !== finalSnapshot.sequence ||
      value.finalization.finalSnapshotDigest !== finalSnapshot.snapshotDigest ||
      value.finalization.finalEvidenceCount !== finalSnapshot.evidence.length ||
      value.finalization.finalEvidenceDigest !== finalSnapshot.evidenceDigest ||
      value.finalization.finalIssueHistoryCount !==
        finalSnapshot.issueHistory.length ||
      value.finalization.finalIssuesDigest !== finalSnapshot.issuesDigest ||
      value.finalization.finalIssuesCount !== finalSnapshot.issues.length ||
      value.finalization.finalIssueHistoryDigest !==
        finalSnapshot.issueHistoryDigest ||
      value.finalization.terminalPhase !== finalSnapshot.phase ||
      value.finalization.streamDigest !==
        getCandidateGenerationProgressPrefixDigest(prefix)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Progress finalization must bind the exact terminal sequence, snapshot, run, and complete stream digest.",
        path: ["finalization"],
      });
    }
  });

export type CandidateGenerationProgressStreamV1 = z.output<
  typeof candidateGenerationProgressStreamV1Schema
>;

function finalizeCandidateGenerationProgress(input: {
  readonly generationRunId: string;
  readonly snapshots: readonly CandidateGenerationProgressSnapshotV1[];
  readonly terminalResultKind:
    "candidate-review" | "candidate-generation-failure";
}): CandidateGenerationProgressFinalizationV1 {
  const finalSnapshot = input.snapshots.at(-1);
  if (finalSnapshot === undefined) {
    throw new Error("Candidate progress cannot finalize an empty stream.");
  }
  const prefix = candidateGenerationProgressPrefixV1Schema.parse({
    contractVersion: 1,
    generationRunId: input.generationRunId,
    snapshots: input.snapshots,
  });
  const finalization = candidateGenerationProgressFinalizationV1Schema.parse({
    contractVersion: 1,
    finalEvidenceCount: finalSnapshot.evidence.length,
    finalEvidenceDigest: finalSnapshot.evidenceDigest,
    finalIssueHistoryCount: finalSnapshot.issueHistory.length,
    finalIssueHistoryDigest: finalSnapshot.issueHistoryDigest,
    finalIssuesCount: finalSnapshot.issues.length,
    finalIssuesDigest: finalSnapshot.issuesDigest,
    finalSequence: finalSnapshot.sequence,
    finalSnapshotDigest: finalSnapshot.snapshotDigest,
    generationRunId: input.generationRunId,
    state: "finalized",
    streamDigest: getCandidateGenerationProgressPrefixDigest(prefix),
    terminalPhase: finalSnapshot.phase,
    terminalResultKind: input.terminalResultKind,
  });
  candidateGenerationProgressStreamV1Schema.parse({
    ...prefix,
    finalization,
  });
  return finalization;
}

export interface CandidateGenerationProgressPort {
  publish(
    snapshot: CandidateGenerationProgressSnapshotV1,
    signal?: AbortSignal,
  ): Promise<void>;
}

async function publishCandidateGenerationProgress(input: {
  readonly assessedAt: string;
  readonly attemptNumber: number;
  readonly bundleDigest: Sha256Digest;
  readonly dependencies: AiExtensionGenerationCoordinatorDependencies;
  readonly evidence: readonly EvidenceRecordV1[];
  readonly extensionId: string;
  readonly generationRunId: string;
  readonly issueHistory: readonly ActiveIssueV1[];
  readonly issues: readonly ActiveIssueV1[];
  readonly phase: CandidateGenerationProgressSnapshotV1["phase"];
  readonly previousSnapshots: readonly CandidateGenerationProgressSnapshotV1[];
  readonly scope: CandidateScopeV1;
  readonly signal?: AbortSignal;
  readonly solutionRevisionId: string;
}): Promise<CandidateGenerationProgressSnapshotV1> {
  const previousSnapshot = input.previousSnapshots.at(-1);
  const sequence = input.previousSnapshots.length + 1;
  if (sequence > CANDIDATE_GENERATION_MAXIMUM_PROGRESS_SNAPSHOTS) {
    throw new Error("Candidate progress exceeded the bounded snapshot limit.");
  }
  const projection = {
    assessedAt: input.assessedAt,
    attemptNumber: input.attemptNumber,
    bundleDigest: input.bundleDigest,
    contractVersion: 1 as const,
    deploymentAuthority: "none" as const,
    evidence: [...input.evidence],
    evidenceDigest: digestCanonicalValue(input.evidence),
    extensionId: input.extensionId,
    generationRunId: input.generationRunId,
    issueHistory: [...input.issueHistory],
    issueHistoryDigest: digestCanonicalValue(input.issueHistory),
    issues: [...input.issues],
    issuesDigest: digestCanonicalValue(input.issues),
    phase: input.phase,
    predecessor:
      previousSnapshot === undefined
        ? ({ previousSnapshotDigest: "none", state: "genesis" } as const)
        : ({
            previousSnapshotDigest: previousSnapshot.snapshotDigest,
            state: "continues",
          } as const),
    repositoryWriteAuthority: "none" as const,
    scope: input.scope,
    sequence,
    solutionRevisionId: input.solutionRevisionId,
    writeAuthority: "none" as const,
  };
  const snapshot = candidateGenerationProgressSnapshotV1Schema.parse({
    ...projection,
    snapshotDigest: digestCanonicalValue(projection),
  });
  const stream = candidateGenerationProgressPrefixV1Schema.parse({
    contractVersion: 1,
    generationRunId: input.generationRunId,
    snapshots: [...input.previousSnapshots, snapshot],
  });
  const exactSnapshot = stream.snapshots.at(-1);
  if (exactSnapshot === undefined) {
    throw new Error("Candidate progress stream did not retain its snapshot.");
  }
  if (input.dependencies.progress !== undefined) {
    await input.dependencies.progress.publish(
      Object.freeze(exactSnapshot),
      input.signal,
    );
  }
  return exactSnapshot;
}
const maximumReviewDiagnostics = 256;

function boundedCandidateDiagnostics(
  entries: readonly CandidateDiagnosticV1[],
): CandidateDiagnosticV1[] {
  const unique = [
    ...new Map(
      entries.map((entry) => [digestCanonicalValue(entry), entry]),
    ).values(),
  ];
  if (unique.length <= maximumReviewDiagnostics) return unique;
  return [
    ...unique.slice(0, maximumReviewDiagnostics - 1),
    diagnostic({
      category: "admission",
      code: "cloudmarkup.ai-extension.diagnostic-count-exceeded",
      detail:
        "Additional candidate diagnostics were deterministically omitted after the safe review limit was reached.",
      repairable: false,
      summary:
        "Candidate produced more diagnostics than the safe review limit.",
    }),
  ];
}
function diagnostic(input: {
  readonly category: CandidateDiagnosticV1["category"];
  readonly code: string;
  readonly detail: string;
  readonly path?: string;
  readonly repairable: boolean;
  readonly severity?: CandidateDiagnosticV1["severity"];
  readonly summary: string;
}): CandidateDiagnosticV1 {
  return candidateDiagnosticV1Schema.parse({
    category: input.category,
    checkId: `cloudmarkup.ai-extension.${input.category}`,
    code: input.code,
    ...(input.path === undefined ? {} : { path: input.path }),
    repairable: input.repairable,
    severity: input.severity ?? "error",
    summary: input.summary,
    technicalDetail: input.detail,
  });
}

function parseGenerationRequest(
  input: CustomCandidateGenerationInputV1,
): GenerationRequest & {
  readonly generationContext: ModelGenerationContextV1;
  readonly generationContextDigest: Sha256Digest;
} {
  const parsed =
    input.modelRequest.operation === "application-source.generate"
      ? modelApplicationSourceGenerationRequestV1Schema.parse(
          input.modelRequest,
        )
      : modelIacExtensionGenerationRequestV1Schema.parse(input.modelRequest);
  if (
    parsed.generationContext === undefined ||
    parsed.generationContextDigest === undefined ||
    digestCanonicalValue(parsed.generationContext) !==
      parsed.generationContextDigest
  ) {
    throw new Error(
      "Prompt 36A requires the exact canonical generation context and digest.",
    );
  }
  return parsed as GenerationRequest & {
    readonly generationContext: ModelGenerationContextV1;
    readonly generationContextDigest: Sha256Digest;
  };
}

function assertExactInvocationAuthority(input: {
  readonly commercialAuthority: CandidateCommercialAuthorityV1;
  readonly extensionReservationId: string;
  readonly maximumRepairAttempts: number;
  readonly modelContext: ModelGatewayInvocationContextV1;
  readonly repairContexts: readonly ModelGatewayInvocationContextV1[];
  readonly requestedMode: GenerationRequest["requestedMode"];
  readonly scope: CandidateScopeV1;
  readonly solutionRevisionId: string;
}): void {
  const contexts = [input.modelContext, ...input.repairContexts];
  if (
    input.commercialAuthority.reservationId !== input.extensionReservationId ||
    input.commercialAuthority.attemptEstimateCreditUnits.length !==
      input.maximumRepairAttempts + 1
  ) {
    throw new Error(
      "Generation and repair must bind one exact trusted commercial reservation and attempt estimate set.",
    );
  }
  const estimatedTotal =
    input.commercialAuthority.attemptEstimateCreditUnits.reduce(
      (total, value) => total + value,
      0,
    );
  if (
    estimatedTotal >
    input.commercialAuthority.acceptedWorkflowEstimateMaximumCreditUnits
  ) {
    throw new Error(
      "Generation and system-required repairs cannot exceed the accepted workflow estimate.",
    );
  }
  if (
    new Set(contexts.map(({ idempotencyKeyDigest }) => idempotencyKeyDigest))
      .size !== contexts.length
  ) {
    throw new Error(
      "Every generation and repair attempt requires a unique idempotency key.",
    );
  }
  if (
    contexts.some(
      (context) =>
        context.requestedMode !== input.requestedMode ||
        context.scope.organizationId !== input.scope.organizationId ||
        context.scope.projectId !== input.scope.projectId ||
        context.scope.solutionRevisionId !== input.solutionRevisionId,
    )
  ) {
    throw new Error(
      "Generation contexts must bind the exact tenant, project, revision, and requested mode.",
    );
  }
  if (
    contexts.some(
      (context) =>
        !context.budget.allowed ||
        !context.budget.estimateAccepted ||
        context.budget.acceptedEstimateMaximumCreditUnits !==
          input.commercialAuthority
            .acceptedWorkflowEstimateMaximumCreditUnits ||
        context.budget.decisionId !== input.modelContext.budget.decisionId ||
        context.entitlement.decisionId !==
          input.modelContext.entitlement.decisionId ||
        context.evaluationPolicyId !== input.modelContext.evaluationPolicyId ||
        context.evaluationPolicyVersion !==
          input.modelContext.evaluationPolicyVersion,
    )
  ) {
    throw new Error(
      "Every candidate attempt must preserve the exact accepted budget, entitlement, and evaluation policy authority.",
    );
  }

  const escalationCount = contexts.filter(
    ({ routingDecision }) => routingDecision?.routeId === "internal-escalation",
  ).length;
  if (escalationCount > 1) {
    throw new Error(
      "Candidate generation permits at most one trusted internal escalation.",
    );
  }
}

function rejoinExtensionSourceReference(
  reference: CandidateExtensionAuthorityV1["sourceReferences"][number],
  request: ReturnType<typeof parseGenerationRequest>,
): ModelGenerationContextV1["sourceReferences"][number] {
  switch (reference.kind) {
    case "architecture-node":
      return {
        kind: reference.kind,
        referenceId: reference.nodeId,
      };
    case "workload":
      return {
        kind: reference.kind,
        referenceId: reference.workloadId,
      };
    case "external-resource":
      return {
        kind: reference.kind,
        referenceId: reference.externalResourceId,
      };
    case "solution-contract": {
      const exactContracts =
        request.architecture.applicationContracts.contracts.filter(
          (contract) =>
            contract.contractId === reference.contractId &&
            contract.contractVersion === reference.contractVersion,
        );
      const exactContract = exactContracts[0];
      if (
        exactContracts.length !== 1 ||
        exactContract === undefined ||
        getApplicationContractRecordContentHash(exactContract) !==
          reference.digest
      ) {
        throw new Error(
          "Every solution-contract source reference requires exact versioned Application Contract authority.",
        );
      }
      return {
        digest: reference.digest,
        kind: reference.kind,
        referenceId: reference.contractId,
      };
    }
  }
}

function assertExactApplicationContractSetAuthority(
  extension: CandidateExtensionAuthorityV1,
  request: ReturnType<typeof parseGenerationRequest>,
): void {
  if (
    !extension.sourceReferences.some(
      (reference) => reference.kind === "solution-contract",
    )
  ) {
    return;
  }
  const applicationContracts = request.architecture.applicationContracts;
  const expectedRecordHashes = applicationContracts.contracts.map(
    getApplicationContractRecordContentHash,
  );
  if (
    request.solutionRevision.contracts.contentHash !==
      getApplicationContractsContentHash(applicationContracts) ||
    !sameStringSet(
      request.solutionRevision.contracts.recordHashes,
      expectedRecordHashes,
    )
  ) {
    throw new Error(
      "Solution-contract source authority must bind the exact frozen Application Contract set and records.",
    );
  }
}

function assertRequestAndExtensionAuthority(input: {
  readonly authority: CustomCandidateGenerationInputV1["authority"];
  readonly extension: CandidateExtensionAuthorityV1;
  readonly request: ReturnType<typeof parseGenerationRequest>;
}): void {
  const { extension, request } = input;
  const context = request.generationContext;
  assertExactApplicationContractSetAuthority(extension, request);
  const extensionSourceKeys = extension.sourceReferences.map((reference) =>
    digestCanonicalValue(rejoinExtensionSourceReference(reference, request)),
  );
  const contextSourceKeys = context.sourceReferences.map(digestCanonicalValue);
  const requestSourceKeys = request.sourceReferences.map(digestCanonicalValue);
  if (
    String(context.extensionId) !== extension.id ||
    !sameStringSet(request.boundary.ownedPaths, context.ownedPaths) ||
    !sameStringSet(
      request.sourceOwnershipAuthority.ownedPaths,
      context.ownedPaths,
    ) ||
    !sameStringSet(
      extension.ownedPaths.map(({ path }) => path),
      context.ownedPaths,
    ) ||
    !sameStringSet(extensionSourceKeys, contextSourceKeys) ||
    !sameStringSet(requestSourceKeys, contextSourceKeys) ||
    extension.request.objective !== context.requestedBehavior.objective ||
    !sameStringSet(
      extension.request.acceptanceCriteria,
      context.requestedBehavior.acceptanceCriteria,
    ) ||
    !sameStringSet(
      extension.request.constraints,
      context.requestedBehavior.requirements,
    ) ||
    !sameStringSet(
      request.acceptanceCriteria,
      context.requestedBehavior.acceptanceCriteria,
    ) ||
    context.existingFiles.some(
      (file) =>
        !context.ownedPaths.includes(file.path) ||
        context.protectedPaths.includes(file.path),
    ) ||
    digestCanonicalValue(request.validationExpectations) !==
      digestCanonicalValue(context.validationExpectations)
  ) {
    throw new Error(
      "Generation request does not match exact extension ownership and validation authority.",
    );
  }
  if (
    request.solutionRevision.solutionRevisionId !==
    request.sourceOwnershipAuthority.solutionRevisionId
  ) {
    throw new Error(
      "Generation source ownership must bind the exact Solution Revision.",
    );
  }
  for (const path of context.ownedPaths) {
    const ownership = request.solutionRevision.sourceOwnership.find(
      (entry) => entry.path === path,
    );
    const authorityOwnership =
      request.sourceOwnershipAuthority.sourceOwnership.find(
        (entry) => entry.path === path,
      );
    const extensionPath = extension.ownedPaths.find(
      (entry) => entry.path === path,
    );
    const existingFile = context.existingFiles.find(
      (entry) => entry.path === path,
    );
    const expectedGeneratedOwnership = "ai-authored";
    const exactUserOwnedPatch =
      context.kind === "application" &&
      ownership?.ownership === "user-owned" &&
      ownership.conflictBehavior === "preserve-user-content" &&
      ownership.contentHash !== undefined &&
      extensionPath?.conflictPolicy === "propose-patch" &&
      extensionPath.priorDigest === ownership.contentHash &&
      existingFile?.ownership === "user-owned" &&
      existingFile.contentDigest === ownership.contentHash &&
      existingFile.contentDigest === sha256Text(existingFile.content) &&
      existingFile.sizeBytes === utf8ByteLength(existingFile.content);
    const exactGeneratedOwnership =
      ownership?.ownership === expectedGeneratedOwnership &&
      ownership.ownerId === extension.id;
    if (
      ownership === undefined ||
      authorityOwnership === undefined ||
      digestCanonicalValue(authorityOwnership) !==
        digestCanonicalValue(ownership) ||
      (!exactGeneratedOwnership && !exactUserOwnedPatch)
    ) {
      throw new Error(
        "Every candidate path requires exact immutable Solution Revision ownership or explicit digest-bound user-owned patch authority.",
      );
    }
  }
  if (context.kind === "application") {
    if (
      input.authority !== "ai-assisted-custom" ||
      request.operation !== "application-source.generate" ||
      extension.target.kind !== "application" ||
      extension.target.workloadId !== context.workloadId ||
      extension.target.language !== context.language ||
      context.allowedProviders.length !== 0 ||
      context.allowedResources.length !== 0
    ) {
      throw new Error(
        "Application candidates require exact ai-assisted-custom authority.",
      );
    }
  } else if (
    input.authority !== "approved-iac-extension" ||
    request.operation !== "iac-extension.generate" ||
    extension.target.kind !== "iac-extension" ||
    extension.target.targetFormat !== context.targetFormat ||
    extension.target.extensionSlotId !== context.extensionSlotId ||
    extension.target.language !== context.language ||
    context.allowedProviders.length === 0 ||
    context.allowedResources.length === 0
  ) {
    throw new Error(
      "IaC candidates require one exact approved target extension slot and allowlist.",
    );
  }
}

function assertApplicationWorkloadAuthority(input: {
  readonly extension: CandidateExtensionAuthorityV1;
  readonly generationContext: Extract<
    ModelGenerationContextV1,
    { kind: "application" }
  >;
  readonly workloadInput: unknown;
  readonly solutionRevision: GenerationRequest["solutionRevision"];
}): WorkloadV2 {
  const workload = workloadV2Schema.parse(input.workloadInput);
  const context = input.generationContext;
  if (
    workload.id !== context.workloadId ||
    workload.implementation.mode !== "ai-assisted-custom" ||
    String(workload.implementation.extension.extensionId) !==
      input.extension.id ||
    workload.implementation.runtimeFamily !== context.runtimeFamily ||
    workload.languageFamily !== context.language
  ) {
    throw new Error(
      "Application generation requires the exact canonical ai-assisted-custom Workload.",
    );
  }
  for (const path of context.ownedPaths) {
    const point = workload.extensionPoints.find((entry) => entry.path === path);
    const ownership = workload.sourceOwnership.find(
      (entry) => entry.path === path,
    );
    const revisionOwnership = input.solutionRevision.sourceOwnership.find(
      (entry) => entry.path === path,
    );
    const extensionPath = input.extension.ownedPaths.find(
      (entry) => entry.path === path,
    );
    const existingFile = context.existingFiles.find(
      (entry) => entry.path === path,
    );
    const exactAiAuthoredPath =
      ownership?.ownership === "ai-authored" &&
      revisionOwnership?.ownership === "ai-authored" &&
      revisionOwnership.ownerId === input.extension.id &&
      ownership.ownerId === input.extension.id;
    const exactUserOwnedPatch =
      ownership?.ownership === "user-owned" &&
      ownership.regeneration === "never" &&
      ownership.conflictBehavior === "preserve-user-content" &&
      revisionOwnership?.ownership === "user-owned" &&
      revisionOwnership.conflictBehavior === "preserve-user-content" &&
      revisionOwnership.ownerId === ownership.ownerId &&
      revisionOwnership.contentHash !== undefined &&
      extensionPath?.conflictPolicy === "propose-patch" &&
      extensionPath.priorDigest === revisionOwnership.contentHash &&
      existingFile?.ownership === "user-owned" &&
      existingFile.contentDigest === revisionOwnership.contentHash &&
      existingFile.contentDigest === sha256Text(existingFile.content) &&
      existingFile.sizeBytes === utf8ByteLength(existingFile.content);
    const exactPoint =
      point !== undefined &&
      ownership?.extensionPointId === point.extensionPointId &&
      ownership.pathKind === "file" &&
      (exactAiAuthoredPath || exactUserOwnedPatch) &&
      (ownership.ownership === "ai-authored" ||
        ownership.ownership === "user-owned") &&
      point.permittedOwnership.includes(ownership.ownership);
    if (!exactPoint) {
      throw new Error(
        "Application candidate path is not an exact canonical Workload extension point.",
      );
    }
  }
  if (
    !workload.extensionPoints.some(
      ({ extensionPointId }) => extensionPointId === context.extensionPointId,
    )
  ) {
    throw new Error(
      "Application generation context names an unknown extension point.",
    );
  }
  const expectedKinds = new Set(
    context.validationExpectations
      .filter(({ required }) => required)
      .map(({ kind }) => kind),
  );
  if (
    !workload.compatibility.modelGateways.some((compatibility) =>
      [...expectedKinds].every((kind) =>
        compatibility.requiredValidation.includes(kind),
      ),
    )
  ) {
    throw new Error(
      "Workload model compatibility does not authorize every required validation kind.",
    );
  }
  return workload;
}

function attemptRecord(input: {
  readonly attemptNumber: number;
  readonly bundleDigest: Sha256Digest;
  readonly kind: "generation" | "repair";
  readonly mergedBundleDigest: Sha256Digest;
  readonly result: GenerationResult | ModelGatewayResultV1<"candidate.repair">;
}): CandidateAttemptV1 {
  return candidateAttemptV1Schema.parse({
    attemptNumber: input.attemptNumber,
    bundleDigest: input.bundleDigest,
    idempotencyKeyDigest: input.result.descriptor.idempotencyKeyDigest,
    invocationId: input.result.descriptor.invocationId,
    kind: input.kind,
    mergedBundleDigest: input.mergedBundleDigest,
    metered: true,
    model: {
      modelId: input.result.descriptor.modelId,
      modelVersion: input.result.descriptor.modelVersion,
      promptDigest: input.result.descriptor.promptDigest,
      promptTemplateId: input.result.descriptor.promptTemplateId,
      promptVersion: input.result.descriptor.promptVersion,
      providerId: input.result.descriptor.providerId,
    },
    usageRecordId: input.result.usage.usageRecordId,
  });
}

function attemptReplayAuthority(input: {
  readonly attemptNumber: number;
  readonly kind: "generation" | "repair";
  readonly mergedBundleDigest: Sha256Digest;
  readonly rawBundleDigest: Sha256Digest;
  readonly result: GenerationResult | ModelGatewayResultV1<"candidate.repair">;
}): CandidateAttemptReplayAuthorityV1 {
  return candidateAttemptReplayAuthorityV1Schema.parse({
    attemptNumber: input.attemptNumber,
    descriptor: input.result.descriptor,
    kind: input.kind,
    mergedBundleDigest: input.mergedBundleDigest,
    rawBundleDigest: input.rawBundleDigest,
    usage: input.result.usage,
  });
}
function contentKind(
  context: ModelGenerationContextV1,
): "application" | "terraform" | "cloudformation" {
  return context.kind === "application" ? "application" : context.targetFormat;
}

function makeMaterializationPolicy(input: {
  readonly extension: CandidateExtensionAuthorityV1;
  readonly request: ReturnType<typeof parseGenerationRequest>;
  readonly repairBases?: readonly {
    readonly content?: string;
    readonly digest: Sha256Digest;
    readonly path: string;
  }[];
}) {
  const context = input.request.generationContext;
  return {
    approvalPathIds: input.request.boundary.approvalPathIds,
    approvedDependencies: context.allowedDependencies.map((dependency) => ({
      approvalPathId: dependency.approvalPathId,
      ecosystem: dependency.ecosystem,
      kind: dependency.kind,
      name: dependency.name,
      version: dependency.requestedVersion,
    })),
    boundaryId: input.request.boundary.boundaryId,
    contentKind: contentKind(context),
    existingFiles: context.existingFiles
      .filter(({ path }) => context.ownedPaths.includes(path))
      .map((file) => ({
        content: file.content,
        digest: file.contentDigest,
        noSecretValues: true as const,
        ownership:
          file.ownership === "user-owned"
            ? ("user-owned" as const)
            : ("previous-ai-candidate" as const),
        path: file.path,
      })),
    limits: {
      maximumFileBytes: context.limits.maximumCandidateFileBytes,
      maximumDependencies: context.limits.maximumDependencyRequests,
      maximumFiles: context.limits.maximumCandidateFiles,
      maximumPatchHunks: 128,
      maximumTotalBytes: context.limits.maximumCandidateTotalBytes,
    },
    ownedPaths: input.extension.ownedPaths,
    protectedPaths: context.protectedPaths,
    repairBases: input.repairBases ?? [],
    sourceReferenceIds: context.sourceReferences.map(
      ({ referenceId }) => referenceId,
    ),
    validationExpectations: context.validationExpectations,
  };
}

function candidateMetadataDiagnostics(input: {
  readonly bundle: ModelCandidateBundleV1;
  readonly context: ModelGenerationContextV1;
  readonly descriptor: GenerationResult["descriptor"];
  readonly workload?: WorkloadV2;
}): CandidateDiagnosticV1[] {
  const diagnostics: CandidateDiagnosticV1[] = [];
  const sourceIds = new Set(
    input.context.sourceReferences.map(({ referenceId }) => referenceId),
  );
  const assumptions = input.bundle.assumptions ?? [];
  const unresolvedItems = input.bundle.unresolvedItems ?? [];
  const expectedTests = input.bundle.expectedTests ?? [];
  for (const item of [
    ...assumptions,
    ...unresolvedItems,
    ...expectedTests,
    ...input.bundle.generationPlan.steps,
  ]) {
    if (
      item.sourceReferences.some(
        ({ referenceId }) => !sourceIds.has(referenceId),
      )
    ) {
      diagnostics.push(
        diagnostic({
          category: "provenance",
          code: "cloudmarkup.ai-extension.candidate-source-ungrounded",
          detail:
            "Candidate metadata references evidence outside the exact generation context.",
          repairable: false,
          summary: "Candidate metadata contains an ungrounded source claim.",
        }),
      );
    }
  }
  if (expectedTests.length > input.context.limits.maximumExpectedTests) {
    diagnostics.push(
      diagnostic({
        category: "static-analysis",
        code: "cloudmarkup.ai-extension.expected-test-count-exceeded",
        detail: "Expected tests exceed the exact configured maximum.",
        repairable: false,
        summary: "Candidate declared too many expected tests.",
      }),
    );
  }
  const expectationById = new Map(
    input.context.validationExpectations.map((expectation) => [
      expectation.checkId,
      expectation,
    ]),
  );
  if (
    expectedTests.some((test) => {
      const expectation = expectationById.get(test.validationCheckId);
      return expectation?.kind !== test.kind;
    })
  ) {
    diagnostics.push(
      diagnostic({
        category: "provenance",
        code: "cloudmarkup.ai-extension.expected-test-authority-mismatch",
        detail:
          "Expected tests must bind an exact validation check of the same kind.",
        repairable: false,
        summary: "Candidate expected tests changed validation authority.",
      }),
    );
  }
  if (unresolvedItems.length > 0) {
    diagnostics.push(
      diagnostic({
        category: "static-analysis",
        code: "cloudmarkup.ai-extension.candidate-item-unresolved",
        detail:
          "Candidate behavior remains unresolved and cannot be called complete or hidden by repair.",
        repairable: false,
        summary: "Candidate still has unresolved behavior.",
      }),
    );
  }
  if (input.context.kind === "application") {
    const testKinds = new Set(expectedTests.map(({ kind }) => kind));
    if (!testKinds.has("unit-test") || !testKinds.has("contract-test")) {
      diagnostics.push(
        diagnostic({
          category: "static-analysis",
          code: "cloudmarkup.ai-extension.expected-tests-missing",
          detail:
            "AI-assisted custom application candidates require grounded unit and contract tests.",
          repairable: false,
          summary: "Candidate omitted required expected tests.",
        }),
      );
    }
    if (
      expectedTests.some(({ targetPaths }) =>
        targetPaths.some((path) => !input.context.ownedPaths.includes(path)),
      )
    ) {
      diagnostics.push(
        diagnostic({
          category: "ownership",
          code: "cloudmarkup.ai-extension.expected-test-path-not-owned",
          detail: "Expected tests must target exact candidate-owned paths.",
          repairable: false,
          summary: "Expected test path is outside candidate ownership.",
        }),
      );
    }
    const compatibility = input.workload?.compatibility.modelGateways.find(
      (entry) =>
        entry.modelFamily === input.descriptor.routing?.modelFamily &&
        entry.promptTemplateId === input.descriptor.promptTemplateId &&
        entry.promptVersion === input.descriptor.promptVersion &&
        entry.promptDigest === input.descriptor.promptDigest,
    );
    if (compatibility === undefined) {
      diagnostics.push(
        diagnostic({
          category: "provenance",
          code: "cloudmarkup.ai-extension.model-compatibility-mismatch",
          detail:
            "The exact selected model family and prompt are not authorized by the canonical Workload.",
          repairable: false,
          summary: "Candidate model compatibility is not authorized.",
        }),
      );
    }
    if (
      (input.workload?.unresolvedRequirementIds.length ?? 0) > 0 ||
      input.workload?.implementationRequirements.some(
        ({ blocking }) => blocking,
      )
    ) {
      diagnostics.push(
        diagnostic({
          category: "static-analysis",
          code: "cloudmarkup.ai-extension.workload-behavior-unresolved",
          detail:
            "Canonical Workload behavior still contains a blocking implementation requirement.",
          repairable: false,
          summary: "Custom application behavior remains incomplete.",
        }),
      );
    }
  }
  return diagnostics;
}

function targetValidatorFor(
  dependencies: AiExtensionGenerationCoordinatorDependencies,
  context: ModelGenerationContextV1,
): CandidateTargetValidationPort {
  if (context.kind === "application")
    return dependencies.validators.application;
  return context.targetFormat === "terraform"
    ? dependencies.validators.terraform
    : dependencies.validators.cloudformation;
}

function evidenceDiagnostics(input: {
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
        diagnostic({
          category: "provenance",
          code: "cloudmarkup.ai-extension.validation-evidence-ungrounded",
          detail:
            "Target validation Evidence does not bind the exact candidate artifact, passing checks, exact required level, required coverage, and Solution Revision.",
          repairable: false,
          summary: "Candidate validation Evidence is not grounded.",
        }),
      );
    }
  }
  if (
    input.result.evidence.filter((record) => bindsCandidate(record)).length !==
    1
  ) {
    diagnostics.push(
      diagnostic({
        category: "provenance",
        code: "cloudmarkup.ai-extension.required-evidence-cardinality",
        detail:
          "The target validator must emit exactly one candidate-bound Evidence record for every required coverage claim.",
        repairable: false,
        summary: "Candidate is missing required validation Evidence.",
      }),
    );
  }
  return diagnostics;
}

function validationChecks(input: {
  readonly diagnostics: readonly CandidateDiagnosticV1[];
  readonly expectations: ModelGenerationContextV1["validationExpectations"];
  readonly outcomes: readonly CandidateValidationOutcomeV1[];
}): AiAuthoredExtensionV1["validation"] {
  const categoriesByKind: Readonly<
    Record<
      ModelGenerationContextV1["validationExpectations"][number]["kind"],
      readonly CandidateDiagnosticV1["category"][]
    >
  > = {
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
  };
  return input.expectations.map((expectation) => {
    const outcome = input.outcomes.find(
      ({ kind }) => kind === expectation.kind,
    );
    const diagnosticFailure = input.diagnostics.some(
      (entry) =>
        entry.severity === "error" &&
        categoriesByKind[expectation.kind].includes(entry.category),
    );
    return {
      checkId: expectation.checkId,
      kind: expectation.kind,
      required: expectation.required,
      result: diagnosticFailure ? "failed" : (outcome?.result ?? "not-run"),
      ...(outcome?.toolVersion === undefined
        ? {}
        : { toolVersion: outcome.toolVersion }),
    };
  });
}

function failedCandidateDigest(
  candidate: ModelCandidateBundleV1["candidates"][number],
) {
  return candidate.kind === "file"
    ? candidate.contentDigest
    : candidate.proposedResultDigest;
}

function relevantRepairInput(input: {
  readonly bundle: ModelCandidateBundleV1;
  readonly diagnostics: readonly CandidateDiagnosticV1[];
}) {
  const repairable = input.diagnostics.filter(
    ({ repairable, severity }) => repairable && severity === "error",
  );
  if (repairable.length === 0) return undefined;
  const explicitlyDiagnosedPaths = new Set(
    repairable.flatMap(({ path }) => (path === undefined ? [] : [path])),
  );
  const failedCandidates =
    explicitlyDiagnosedPaths.size === 0
      ? input.bundle.candidates.length === 1
        ? input.bundle.candidates
        : []
      : input.bundle.candidates.filter(({ path }) =>
          explicitlyDiagnosedPaths.has(path),
        );
  if (failedCandidates.length === 0) return undefined;
  const failedByPath = new Map(
    failedCandidates.map((candidate) => [candidate.path, candidate]),
  );
  const diagnostics = repairable.flatMap((entry) => {
    const candidate =
      entry.path === undefined
        ? failedCandidates[0]
        : failedByPath.get(entry.path);
    if (candidate === undefined) return [];
    return [
      {
        candidateId: candidate.candidateId,
        checkKind:
          entry.category === "parse" ||
          entry.category === "format" ||
          entry.category === "build" ||
          entry.category === "unit-test" ||
          entry.category === "integration-test" ||
          entry.category === "contract-test" ||
          entry.category === "security"
            ? entry.category
            : ("static-analysis" as const),
        diagnosticId: stableRecordId("repair-diagnostic", {
          candidateId: candidate.candidateId,
          code: entry.code,
          path: candidate.path,
        }),
        message: entry.summary,
        noSecretValues: true as const,
        path: candidate.path,
        redactionStatus: "not-required" as const,
        toolId: AI_EXTENSION_GENERATION_COORDINATOR_ID,
        toolVersion: AI_EXTENSION_GENERATION_COORDINATOR_VERSION,
      },
    ];
  });
  return diagnostics.length === 0
    ? undefined
    : { diagnostics, failedCandidates };
}

function mergeRepairBundle(input: {
  readonly previous: ModelCandidateBundleV1;
  readonly repaired: ModelCandidateBundleV1;
}): ModelCandidateBundleV1 {
  const repairedPaths = new Set(
    input.repaired.candidates.map(({ path }) => path),
  );
  const repairedStepPaths = new Set(
    input.repaired.generationPlan.steps.map(({ targetPath }) => targetPath),
  );
  const untouchedCandidates = input.previous.candidates.filter(
    ({ path }) => !repairedPaths.has(path),
  );
  const usedCandidateIds = new Set<string>(
    untouchedCandidates.map(({ candidateId }) => candidateId),
  );
  const repairedCandidates = input.repaired.candidates.map((candidate) => {
    let candidateId: string = candidate.candidateId;
    let collisionOrdinal = 0;
    while (usedCandidateIds.has(candidateId)) {
      candidateId = stableRecordId("repair-candidate", {
        collisionOrdinal,
        originalCandidateId: candidate.candidateId,
        path: candidate.path,
        resultDigest: failedCandidateDigest(candidate),
      });
      collisionOrdinal += 1;
    }
    usedCandidateIds.add(candidateId);
    return { ...candidate, candidateId };
  });
  const untouchedSteps = input.previous.generationPlan.steps.filter(
    ({ targetPath }) => !repairedStepPaths.has(targetPath),
  );
  const usedStepIds = new Set<string>(
    untouchedSteps.map(({ stepId }) => stepId),
  );
  const repairedSteps = input.repaired.generationPlan.steps.map((step) => {
    let stepId: string = step.stepId;
    let collisionOrdinal = 0;
    while (usedStepIds.has(stepId)) {
      stepId = stableRecordId("repair-plan-step", {
        action: step.action,
        collisionOrdinal,
        originalStepId: step.stepId,
        targetPath: step.targetPath,
      });
      collisionOrdinal += 1;
    }
    usedStepIds.add(stepId);
    return { ...step, stepId };
  });
  return modelCandidateBundleV1Schema.parse({
    ...input.repaired,
    candidates: [...untouchedCandidates, ...repairedCandidates],
    generationPlan: {
      ...input.repaired.generationPlan,
      steps: [...untouchedSteps, ...repairedSteps],
    },
  });
}

async function invokeGeneration(
  gateway: CandidateModelGateway,
  request: ReturnType<typeof parseGenerationRequest>,
  context: ModelGatewayInvocationContextV1,
  signal?: AbortSignal,
): Promise<GenerationResult> {
  return request.operation === "application-source.generate"
    ? gateway.generateApplicationSourceCandidate(request, context, signal)
    : gateway.generateIacExtensionCandidate(request, context, signal);
}

function progress(input: {
  readonly repairAttempts: number;
  readonly ready: boolean;
  readonly terminalFailure: boolean;
}) {
  return [
    { stage: "generate" as const, state: "complete" as const },
    {
      stage: "check" as const,
      state: input.terminalFailure
        ? ("failed" as const)
        : ("complete" as const),
    },
    {
      stage: "fix-automatically-where-safe" as const,
      state:
        input.repairAttempts === 0
          ? ("not-needed" as const)
          : input.ready
            ? ("complete" as const)
            : ("exhausted" as const),
    },
    {
      stage: "review-remaining-issues" as const,
      state: input.ready ? ("ready" as const) : ("blocked" as const),
    },
    {
      stage: "accept-candidate" as const,
      state: input.ready ? ("ready" as const) : ("blocked" as const),
    },
  ];
}

function safeGatewayRejectionCode(error: unknown): string {
  return error instanceof ModelGatewayError &&
    /^model-gateway\.[a-z0-9-]+$/u.test(error.code)
    ? error.code
    : "model-gateway.internal-error";
}

function hasExactCandidateIssueClosureEvidence(
  issue: ActiveIssueV1,
  evidence: readonly EvidenceRecordV1[],
): boolean {
  return (
    issue.closureRequirements.length > 0 &&
    issue.closureRequirements.every((requirement) =>
      evidence.some(
        (record) =>
          record.solutionRevisionId === issue.solutionRevisionId &&
          record.staleness.state === "current" &&
          record.level.kind === requirement.evidenceLevel.kind &&
          record.level.rank === requirement.evidenceLevel.rank &&
          record.checks.every((check) => check.status === "passed") &&
          record.checks.some(
            (check) =>
              check.checkId === requirement.evidenceCheckId &&
              check.status === "passed" &&
              check.issueIds.includes(issue.id),
          ),
      ),
    )
  );
}
function createCandidateRepairClosureEvidence(input: {
  readonly artifact: CandidateArtifactReferenceV1;
  readonly assessedAt: string;
  readonly diagnostics: readonly CandidateDiagnosticV1[];
  readonly evidence: readonly EvidenceRecordV1[];
  readonly issues: readonly ActiveIssueV1[];
  readonly proposedPatchDigest: Sha256Digest;
}): readonly EvidenceRecordV1[] {
  if (input.diagnostics.some(({ severity }) => severity === "error")) return [];
  const groups = new Map<
    string,
    {
      readonly basis: EvidenceRecordV1;
      readonly checks: Map<
        string,
        {
          readonly checkId: string;
          readonly issueIds: Set<string>;
        }
      >;
    }
  >();
  for (const issue of input.issues) {
    if (
      issue.lifecycle.state !== "current" ||
      issue.aiProposedFix?.validationStatus !== "validation-pending" ||
      issue.aiProposedFix.proposedPatchDigest !== input.proposedPatchDigest
    ) {
      continue;
    }
    for (const requirement of issue.closureRequirements) {
      const basis = input.evidence.find(
        (record) =>
          record.solutionRevisionId === issue.solutionRevisionId &&
          record.staleness.state === "current" &&
          record.level.kind === requirement.evidenceLevel.kind &&
          record.level.rank === requirement.evidenceLevel.rank &&
          record.provenance.inputDigests.includes(
            input.artifact.artifactDigest,
          ) &&
          record.checks.every((check) => check.status === "passed"),
      );
      if (basis === undefined) continue;
      const group = groups.get(basis.id) ?? {
        basis,
        checks: new Map<
          string,
          { readonly checkId: string; readonly issueIds: Set<string> }
        >(),
      };
      const check = group.checks.get(requirement.evidenceCheckId) ?? {
        checkId: requirement.evidenceCheckId,
        issueIds: new Set<string>(),
      };
      check.issueIds.add(issue.id);
      group.checks.set(requirement.evidenceCheckId, check);
      groups.set(basis.id, group);
    }
  }

  return [...groups.values()].flatMap(({ basis, checks }) => {
    const entries = [...checks.values()].sort((left, right) =>
      left.checkId < right.checkId ? -1 : left.checkId > right.checkId ? 1 : 0,
    );
    const chunks = Array.from(
      { length: Math.ceil(entries.length / 64) },
      (_, index) => entries.slice(index * 64, index * 64 + 64),
    );
    return chunks.map((chunk) => {
      const linkedChecks = chunk.map((check) => ({
        artifactDigests: [input.artifact.artifactDigest],
        checkId: check.checkId,
        issueIds: [...check.issueIds].sort(),
        status: "passed" as const,
        summary:
          "The exact full deterministic candidate validation passed after the AI repair.",
      }));
      const basisDigest = digestCanonicalValue(basis);
      return evidenceRecordV1Schema.parse({
        artifacts: basis.artifacts,
        checks: linkedChecks,
        contractVersion: 1,
        environment: basis.environment,
        id: stableRecordId("evidence-ai-repair-closure", {
          artifactDigest: input.artifact.artifactDigest,
          basisDigest,
          checks: linkedChecks,
          proposedPatchDigest: input.proposedPatchDigest,
        }),
        layer: "generated",
        level: basis.level,
        models: basis.models,
        provenance: {
          actor: {
            kind: "deterministic-tool",
            tool: {
              id: AI_EXTENSION_GENERATION_COORDINATOR_ID,
              version: AI_EXTENSION_GENERATION_COORDINATOR_VERSION,
            },
          },
          createdAt: input.assessedAt,
          inputDigests: [
            input.artifact.artifactDigest,
            input.proposedPatchDigest,
            basisDigest,
          ],
        },
        solutionRevisionId: basis.solutionRevisionId,
        staleness: { assessedAt: input.assessedAt, state: "current" },
        tools: [
          {
            id: AI_EXTENSION_GENERATION_COORDINATOR_ID,
            version: AI_EXTENSION_GENERATION_COORDINATOR_VERSION,
          },
        ],
      });
    });
  });
}
type CandidateGenerationFailureDraftV1 = Omit<
  CandidateGenerationFailureV1,
  "generationProgress" | "resultDigest"
>;

function finalizeCandidateGenerationFailure(input: {
  readonly draft: CandidateGenerationFailureDraftV1;
  readonly generationProgress: CandidateGenerationProgressFinalizationV1;
}): CandidateGenerationFailureV1 {
  const projection = {
    ...input.draft,
    generationProgress: input.generationProgress,
  };
  return candidateGenerationFailureV1Schema.parse({
    ...projection,
    resultDigest: getCandidateGenerationFailureDigest(projection),
  });
}

async function modelGatewayRejectionFailure(input: {
  readonly assessedAt: string;
  readonly attempts: readonly CandidateAttemptV1[];
  readonly dependencies: AiExtensionGenerationCoordinatorDependencies;
  readonly error: unknown;
  readonly extension: CandidateExtensionAuthorityV1;
  readonly invocationId: string;
  readonly operation:
    | "application-source.generate"
    | "iac-extension.generate"
    | "candidate.repair";
  readonly previousEvidence?: readonly EvidenceRecordV1[];
  readonly previousIssueHistory?: readonly ActiveIssueV1[];
  readonly previousInvalidArtifact?: Awaited<
    ReturnType<CandidateArtifactStore["preserveInvalid"]>
  >;
  readonly request: ReturnType<typeof parseGenerationRequest>;
  readonly scope: CandidateScopeV1;
}): Promise<CandidateGenerationFailureDraftV1> {
  const gatewayCode = safeGatewayRejectionCode(input.error);
  const marker = {
    classification: "model-gateway-restricted-output-marker",
    gatewayCode,
    invocationId: input.invocationId,
    operation: input.operation,
    ...(input.previousInvalidArtifact === undefined
      ? {}
      : {
          previousInvalidArtifact: {
            artifactDigest: input.previousInvalidArtifact.artifactDigest,
            artifactId: input.previousInvalidArtifact.artifactId,
          },
        }),
    retention: "raw-output-retained-by-model-gateway",
  } as const;
  const bundleDigest = digestCanonicalValue(marker);
  const gatewayDiagnostic = diagnostic({
    category: "admission",
    code: "cloudmarkup.ai-extension.model-gateway-output-rejected",
    detail: `The configured ModelGateway rejected the candidate invocation with safe code ${gatewayCode}. Any provider output is retained only by the restricted ModelGateway diagnostic store.`,
    repairable: false,
    summary: "ModelGateway candidate output was rejected safely.",
  });
  const invalidArtifact =
    await input.dependencies.artifactStore.preserveInvalid({
      bundle: marker,
      bundleDigest,
      diagnostics: [gatewayDiagnostic],
      extensionId: input.extension.id,
      scope: input.scope,
      solutionRevisionId: input.request.solutionRevision.solutionRevisionId,
      storedAt: input.assessedAt,
    });
  const reconciliation = reconcileCandidateIssueAssessment({
    applicationBuildIssues:
      input.request.generationContext.kind === "application",
    assessedAt: input.assessedAt,
    bundleDigest,
    diagnostics: [gatewayDiagnostic],
    evidence: input.previousEvidence ?? [],
    extensionId: input.extension.id,
    inputDigests: [
      input.request.generationContextDigest,
      digestCanonicalValue(input.request.solutionRevision),
    ],
    markMissingAsStale: false,
    previousRecords: input.previousIssueHistory ?? [],
    solutionRevisionId: input.request.solutionRevision.solutionRevisionId,
  });
  const issues = reconciliation.latestRecords;
  const projection = {
    attempts: [...input.attempts],
    contractVersion: 1 as const,
    diagnostics: [gatewayDiagnostic],
    evidence: [...(input.previousEvidence ?? [])],
    extensionId: input.extension.id,
    invalidArtifact,
    issueHistory: [...reconciliation.history],
    issues: [...issues],
    progress: [
      {
        stage: "generate" as const,
        state:
          input.operation === "candidate.repair"
            ? ("complete" as const)
            : ("failed" as const),
      },
      { stage: "check" as const, state: "failed" as const },
      {
        stage: "fix-automatically-where-safe" as const,
        state:
          input.operation === "candidate.repair"
            ? ("exhausted" as const)
            : ("not-needed" as const),
      },
      { stage: "review-remaining-issues" as const, state: "blocked" as const },
      { stage: "accept-candidate" as const, state: "blocked" as const },
    ],
    solutionRevisionId: input.request.solutionRevision.solutionRevisionId,
    state: "rejected" as const,
    writeAuthority: "none" as const,
  };
  return projection;
}

export function createAiExtensionGenerationCoordinator(
  dependencies: AiExtensionGenerationCoordinatorDependencies,
): AiExtensionGenerationCoordinator {
  return Object.freeze({
    async generate(
      input:
        DeterministicGenerationSelectionV1 | CustomCandidateGenerationInputV1,
      signal?: AbortSignal,
    ): Promise<CandidateGenerationResultV1> {
      if (input.authority === "deterministic-supported") {
        return Object.freeze({
          contractVersion: 1 as const,
          modelInvocations: 0 as const,
          solutionRevisionId: input.solutionRevisionId,
          state: "deterministic-generator-required" as const,
          target: input.target,
          writeAuthority: "none" as const,
        });
      }
      const extension = candidateExtensionAuthorityV1Schema.parse(
        input.extension,
      );
      const request = parseGenerationRequest(input);
      const commercialAuthority = candidateCommercialAuthorityV1Schema.parse(
        input.commercialAuthority,
      );
      if (
        !Number.isInteger(input.maximumRepairAttempts) ||
        input.maximumRepairAttempts < 0 ||
        input.maximumRepairAttempts > 2 ||
        input.maximumRepairAttempts >
          request.generationContext.limits.maximumRepairAttempts ||
        input.repairContexts.length !== input.maximumRepairAttempts
      ) {
        throw new Error(
          "Candidate repair requires an exact configured limit of zero through two attempts.",
        );
      }
      assertRequestAndExtensionAuthority({
        authority: input.authority,
        extension,
        request,
      });
      assertExactInvocationAuthority({
        commercialAuthority,
        extensionReservationId: extension.reservationId,
        maximumRepairAttempts: input.maximumRepairAttempts,
        modelContext: input.modelContext,
        repairContexts: input.repairContexts,
        requestedMode: request.requestedMode,
        scope: input.scope,
        solutionRevisionId: request.solutionRevision.solutionRevisionId,
      });
      const workload =
        request.generationContext.kind === "application"
          ? assertApplicationWorkloadAuthority({
              extension,
              generationContext: request.generationContext,
              solutionRevision: request.solutionRevision,
              workloadInput: input.applicationWorkload,
            })
          : undefined;
      const generationRunId = stableRecordId("candidate-generation-run", {
        extensionId: extension.id,
        idempotencyKeyDigest: input.modelContext.idempotencyKeyDigest,
        invocationId: input.modelContext.invocationId,
        scope: input.scope,
        solutionRevisionId: request.solutionRevision.solutionRevisionId,
      });
      const progressSnapshots: CandidateGenerationProgressSnapshotV1[] = [];
      const publishProgress = async (snapshot: {
        readonly attemptNumber: number;
        readonly bundleDigest: Sha256Digest;
        readonly evidence: readonly EvidenceRecordV1[];
        readonly issueHistory: readonly ActiveIssueV1[];
        readonly issues: readonly ActiveIssueV1[];
        readonly phase: CandidateGenerationProgressSnapshotV1["phase"];
      }): Promise<void> => {
        const published = await publishCandidateGenerationProgress({
          assessedAt: input.assessedAt,
          attemptNumber: snapshot.attemptNumber,
          bundleDigest: snapshot.bundleDigest,
          dependencies,
          evidence: snapshot.evidence,
          extensionId: extension.id,
          generationRunId,
          issueHistory: snapshot.issueHistory,
          issues: snapshot.issues,
          phase: snapshot.phase,
          previousSnapshots: progressSnapshots,
          scope: input.scope,
          ...(signal === undefined ? {} : { signal }),
          solutionRevisionId: request.solutionRevision.solutionRevisionId,
        });
        progressSnapshots.push(published);
      };
      const finalizeProgress = (
        terminalResultKind: CandidateGenerationProgressFinalizationV1["terminalResultKind"],
      ): CandidateGenerationProgressFinalizationV1 =>
        finalizeCandidateGenerationProgress({
          generationRunId,
          snapshots: progressSnapshots,
          terminalResultKind,
        });
      let gatewayResult: GenerationResult;
      try {
        gatewayResult = await invokeGeneration(
          dependencies.gateway,
          request,
          input.modelContext,
          signal,
        );
      } catch (error) {
        const failure = await modelGatewayRejectionFailure({
          assessedAt: input.assessedAt,
          attempts: [],
          dependencies,
          error,
          extension,
          invocationId: input.modelContext.invocationId,
          operation: request.operation,
          request,
          scope: input.scope,
        });
        await publishProgress({
          attemptNumber: 0,
          bundleDigest: failure.invalidArtifact.bundleDigest,
          evidence: failure.evidence,
          issueHistory: failure.issueHistory,
          issues: failure.issues,
          phase: "generation-rejected",
        });
        return finalizeCandidateGenerationFailure({
          draft: failure,
          generationProgress: finalizeProgress("candidate-generation-failure"),
        });
      }
      let bundle = modelCandidateBundleV1Schema.parse(
        gatewayResult.response.candidateBundle,
      );
      let bundleDigest = digestCanonicalValue(bundle);
      const attempts: CandidateAttemptV1[] = [
        attemptRecord({
          attemptNumber: 0,
          bundleDigest,
          kind: "generation",
          mergedBundleDigest: bundleDigest,
          result: gatewayResult,
        }),
      ];
      const attemptAuthority: CandidateAttemptReplayAuthorityV1[] = [
        attemptReplayAuthority({
          attemptNumber: 0,
          kind: "generation",
          mergedBundleDigest: bundleDigest,
          rawBundleDigest: bundleDigest,
          result: gatewayResult,
        }),
      ];
      await publishProgress({
        attemptNumber: 0,
        bundleDigest,
        evidence: [],
        issueHistory: [],
        issues: [],
        phase: "generation-complete",
      });
      let repairAttempt = 0;
      let materialization: CandidateMaterializationResult;
      let targetResult: CandidateTargetValidationResultV1 | undefined;
      let allDiagnostics: CandidateDiagnosticV1[] = [];
      let issueEvidence: EvidenceRecordV1[] = [];
      let terminalEvidence: EvidenceRecordV1[] = [];
      let issueHistory: ActiveIssueV1[] = [];
      let issues: ActiveIssueV1[] = [];
      let pendingRepair:
        | {
            readonly checkIds: readonly string[];
            readonly reference: CandidateIssueRepairReferenceV1;
          }
        | undefined;
      let provisionalArtifact:
        ReturnType<typeof createCandidateArtifactReference> | undefined;
      let provisionalValidationReplay: CandidateValidationReplayV1 | undefined;
      let lastInvalidArtifact:
        | Awaited<ReturnType<CandidateArtifactStore["preserveInvalid"]>>
        | undefined;

      let repairBases: readonly {
        readonly content?: string;
        readonly digest: Sha256Digest;
        readonly path: string;
      }[] = [];

      for (;;) {
        materialization = materializeCandidateBundle({
          bundle,
          policy: makeMaterializationPolicy({
            extension,
            repairBases,
            request,
          }),
        });
        allDiagnostics = [
          ...materialization.diagnostics,
          ...candidateMetadataDiagnostics({
            bundle,
            context: request.generationContext,
            descriptor: gatewayResult.descriptor,
            ...(workload === undefined ? {} : { workload }),
          }),
        ];
        targetResult = undefined;
        provisionalArtifact = undefined;
        provisionalValidationReplay = undefined;
        if (materialization.succeeded) {
          provisionalValidationReplay = candidateValidationReplayV1Schema.parse(
            {
              attemptAuthority,
              bundle,
              bundleDigest: materialization.bundleDigest,
              descriptor: gatewayResult.descriptor,
              generationContext: request.generationContext,
              generationContextDigest: request.generationContextDigest,
              solutionRevision: request.solutionRevision,
              solutionRevisionDigest: digestCanonicalValue(
                request.solutionRevision,
              ),
            },
          );
          provisionalArtifact = createCandidateArtifactReference({
            bundleDigest: materialization.bundleDigest,
            extensionId: extension.id,
            files: materialization.files,
            scope: input.scope,
            solutionRevisionId: request.solutionRevision.solutionRevisionId,
            storedAt: input.assessedAt,
            targetKind: contentKind(request.generationContext),
            validationReplay: provisionalValidationReplay,
          });
          try {
            targetResult = candidateTargetValidationResultV1Schema.parse(
              await targetValidatorFor(
                dependencies,
                request.generationContext,
              ).validate(
                {
                  artifact: provisionalArtifact,
                  assessedAt: input.assessedAt,
                  bundle,
                  descriptor: gatewayResult.descriptor,
                  files: materialization.files,
                  generationContext: request.generationContext,
                  solutionRevision: request.solutionRevision,
                },
                signal,
              ),
            );
            allDiagnostics.push(...targetResult.diagnostics);
            allDiagnostics.push(
              ...evidenceDiagnostics({
                artifact: provisionalArtifact,
                context: request.generationContext,
                result: targetResult,
                solutionRevisionId: request.solutionRevision.solutionRevisionId,
              }),
            );
          } catch {
            allDiagnostics.push(
              diagnostic({
                category: "provenance",
                code: "cloudmarkup.ai-extension.target-validator-error",
                detail:
                  "The exact configured target validator did not return a valid bounded result.",
                repairable: false,
                summary:
                  "Candidate target validation could not complete safely.",
              }),
            );
          }
        }
        allDiagnostics = boundedCandidateDiagnostics(allDiagnostics);
        const assessedArtifact = provisionalArtifact;
        const assessmentEvidence =
          assessedArtifact === undefined || targetResult === undefined
            ? []
            : [
                createCandidateStaticEvidence({
                  artifact: assessedArtifact,
                  assessedAt: input.assessedAt,
                  claimsCoverageRequirement:
                    request.generationContext.kind === "application",
                  descriptor: gatewayResult.descriptor,
                  diagnostics: allDiagnostics,
                  generationContextDigest: request.generationContextDigest,
                  outcomes: targetResult.outcomes,
                  solutionRevisionDigest: digestCanonicalValue(
                    request.solutionRevision,
                  ),
                  solutionRevisionId:
                    request.solutionRevision.solutionRevisionId,
                }),
                ...targetResult.evidence.filter(
                  (record) =>
                    record.solutionRevisionId ===
                      request.solutionRevision.solutionRevisionId &&
                    record.staleness.state === "current" &&
                    record.provenance.inputDigests.includes(
                      assessedArtifact.artifactDigest,
                    ),
                ),
              ];
        let availableIssueEvidence = [
          ...issueEvidence,
          ...assessmentEvidence,
        ].filter(
          (record, index, records) =>
            records.findIndex(({ id }) => id === record.id) === index,
        );
        if (pendingRepair !== undefined && assessedArtifact !== undefined) {
          availableIssueEvidence = [
            ...availableIssueEvidence,
            ...createCandidateRepairClosureEvidence({
              artifact: assessedArtifact,
              assessedAt: input.assessedAt,
              diagnostics: allDiagnostics,
              evidence: availableIssueEvidence,
              issues,
              proposedPatchDigest: pendingRepair.reference.proposedPatchDigest,
            }),
          ].filter(
            (record, index, records) =>
              records.findIndex(({ id }) => id === record.id) === index,
          );
        }
        if (pendingRepair !== undefined) {
          const validationSucceeded = pendingRepair.reference.issueIds.every(
            (issueId) => {
              const issue = issues.find(({ id }) => id === issueId);
              return (
                issue !== undefined &&
                !allDiagnostics.some(({ checkId }) =>
                  pendingRepair?.checkIds.includes(checkId),
                ) &&
                hasExactCandidateIssueClosureEvidence(
                  issue,
                  availableIssueEvidence,
                )
              );
            },
          );
          const finalizedRepair = reconcileCandidateIssueAssessment({
            applicationBuildIssues:
              request.generationContext.kind === "application",
            assessedAt: input.assessedAt,
            bundleDigest: materialization.bundleDigest,
            diagnostics: [],
            evidence: availableIssueEvidence,
            extensionId: extension.id,
            inputDigests: [
              ...(provisionalArtifact === undefined
                ? []
                : [provisionalArtifact.artifactDigest]),
              request.generationContextDigest,
            ],
            markMissingAsStale: false,
            previousRecords: issueHistory,
            repairReference: {
              ...pendingRepair.reference,
              validationStatus: validationSucceeded
                ? "validated-for-review"
                : "rejected",
            },
            solutionRevisionId: request.solutionRevision.solutionRevisionId,
          });
          issueHistory = [...finalizedRepair.history];
          issues = [...finalizedRepair.latestRecords];
          await publishProgress({
            attemptNumber: repairAttempt,
            bundleDigest: materialization.bundleDigest,
            evidence: availableIssueEvidence,
            issueHistory,
            issues,
            phase: "repair-validated",
          });
          pendingRepair = undefined;
        }
        const issueAssessment = reconcileCandidateIssueAssessment({
          applicationBuildIssues:
            request.generationContext.kind === "application",
          assessedAt: input.assessedAt,
          bundleDigest: materialization.bundleDigest,
          diagnostics: allDiagnostics,
          evidence: availableIssueEvidence,
          extensionId: extension.id,
          inputDigests: [
            ...(provisionalArtifact === undefined
              ? []
              : [provisionalArtifact.artifactDigest]),
            request.generationContextDigest,
            digestCanonicalValue(request.solutionRevision),
          ],
          markMissingAsStale: true,
          previousRecords: issueHistory,
          solutionRevisionId: request.solutionRevision.solutionRevisionId,
        });
        issueHistory = [...issueAssessment.history];
        issues = [...issueAssessment.latestRecords];
        const closureEvidenceIds = new Set(
          issueHistory.flatMap((issue) =>
            issue.lifecycle.state === "resolved"
              ? issue.lifecycle.evidenceIds
              : [],
          ),
        );
        issueEvidence = availableIssueEvidence.filter(({ id }) =>
          closureEvidenceIds.has(id),
        );
        terminalEvidence = [...availableIssueEvidence];
        await publishProgress({
          attemptNumber: repairAttempt,
          bundleDigest: materialization.bundleDigest,
          evidence: availableIssueEvidence,
          issueHistory,
          issues,
          phase: "validation-assessed",
        });
        const hasErrors = allDiagnostics.some(
          ({ severity }) => severity === "error",
        );
        if (hasErrors) {
          lastInvalidArtifact =
            await dependencies.artifactStore.preserveInvalid({
              bundle,
              bundleDigest: materialization.bundleDigest,
              diagnostics: allDiagnostics,
              extensionId: extension.id,
              scope: input.scope,
              solutionRevisionId: request.solutionRevision.solutionRevisionId,
              storedAt: input.assessedAt,
            });
        }
        const repairInput = relevantRepairInput({
          bundle,
          diagnostics: allDiagnostics,
        });
        if (
          !hasErrors ||
          repairInput === undefined ||
          repairAttempt >= input.maximumRepairAttempts
        ) {
          break;
        }
        repairAttempt += 1;
        const priorContent = {
          assumptions: bundle.assumptions ?? [],
          expectedTests: bundle.expectedTests ?? [],
          unresolvedItems: bundle.unresolvedItems ?? [],
        };
        const previousRepairBases = repairBases;
        repairBases = repairInput.failedCandidates.map((candidate) => {
          const materialized = materialization.files.find(
            ({ path }) => path === candidate.path,
          );
          const content =
            candidate.kind === "file"
              ? candidate.content
              : materialized?.content;
          return {
            ...(content === undefined ? {} : { content }),
            digest: failedCandidateDigest(candidate),
            path: candidate.path,
          };
        });
        const repairBaseByPath = new Map(
          previousRepairBases.map((base) => [base.path, base]),
        );
        for (const base of repairBases) repairBaseByPath.set(base.path, base);
        repairBases = [...repairBaseByPath.values()].sort((left, right) =>
          left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
        );

        const repairRequest = modelCandidateRepairRequestV1Schema.parse({
          boundary: request.boundary,
          contractVersion: 1,
          currentAttempt: repairAttempt,
          diagnostics: repairInput.diagnostics,
          failedCandidates: repairInput.failedCandidates,
          failedCandidatesCanonicalization:
            "cloudmarkup.model-failed-candidates.canonical-json.v1",
          failedOutputDigest: digestCanonicalValue(
            repairInput.failedCandidates,
          ),
          generationContext: request.generationContext,
          generationContextDigest: request.generationContextDigest,
          maximumRepairAttempts: input.maximumRepairAttempts,
          operation: "candidate.repair",
          priorCandidateContext: {
            ...priorContent,
            contextDigest: digestCanonicalValue(priorContent),
          },
          requestedMode: request.requestedMode,
          validationExpectations: request.validationExpectations,
        });
        const repairContext = input.repairContexts[repairAttempt - 1];
        if (repairContext === undefined) {
          throw new Error("Repair invocation context is unavailable.");
        }
        let repairResult: ModelGatewayResultV1<"candidate.repair">;
        try {
          repairResult = await dependencies.gateway.repairCandidate(
            repairRequest,
            repairContext,
            signal,
          );
        } catch (error) {
          const failure = await modelGatewayRejectionFailure({
            assessedAt: input.assessedAt,
            attempts,
            dependencies,
            error,
            extension,
            invocationId: repairContext.invocationId,
            operation: "candidate.repair",
            previousEvidence: issueEvidence,
            previousIssueHistory: issueHistory,
            ...(lastInvalidArtifact === undefined
              ? {}
              : { previousInvalidArtifact: lastInvalidArtifact }),
            request,
            scope: input.scope,
          });
          await publishProgress({
            attemptNumber: repairAttempt,
            bundleDigest: failure.invalidArtifact.bundleDigest,
            evidence: failure.evidence,
            issueHistory: failure.issueHistory,
            issues: failure.issues,
            phase: "repair-rejected",
          });
          return finalizeCandidateGenerationFailure({
            draft: failure,
            generationProgress: finalizeProgress(
              "candidate-generation-failure",
            ),
          });
        }
        const repairedBundle = modelCandidateBundleV1Schema.parse(
          repairResult.response.candidateBundle,
        );
        const repairedBundleDigest = digestCanonicalValue(repairedBundle);
        bundle = mergeRepairBundle({
          previous: bundle,
          repaired: repairedBundle,
        });
        bundleDigest = digestCanonicalValue(bundle);
        gatewayResult = repairResult as unknown as GenerationResult;
        attempts.push(
          attemptRecord({
            attemptNumber: repairAttempt,
            bundleDigest: repairedBundleDigest,
            kind: "repair",
            mergedBundleDigest: bundleDigest,
            result: repairResult,
          }),
        );
        attemptAuthority.push(
          attemptReplayAuthority({
            attemptNumber: repairAttempt,
            kind: "repair",
            mergedBundleDigest: bundleDigest,
            rawBundleDigest: repairedBundleDigest,
            result: repairResult,
          }),
        );
        await publishProgress({
          attemptNumber: repairAttempt,
          bundleDigest,
          evidence: issueEvidence,
          issueHistory,
          issues,
          phase: "repair-complete",
        });
        const repairedDiagnostics = allDiagnostics.filter(
          ({ repairable, severity }) => repairable && severity === "error",
        );
        const repairIssueIds = issues
          .filter(
            (issue) =>
              issue.lifecycle.state === "current" &&
              repairedDiagnostics.some(
                (entry) =>
                  entry.summary === issue.summary &&
                  entry.technicalDetail === issue.technicalDetail,
              ),
          )
          .map(({ id }) => id);
        if (repairIssueIds.length > 0) {
          const reference: CandidateIssueRepairReferenceV1 = {
            description:
              "AI candidate repair is awaiting the full deterministic validation pipeline.",
            issueIds: repairIssueIds,
            proposedPatchDigest: repairedBundleDigest,
            validationStatus: "validation-pending",
          };
          const pendingAssessment = reconcileCandidateIssueAssessment({
            applicationBuildIssues:
              request.generationContext.kind === "application",
            assessedAt: input.assessedAt,
            bundleDigest,
            diagnostics: [],
            evidence: issueEvidence,
            extensionId: extension.id,
            inputDigests: [
              bundleDigest,
              request.generationContextDigest,
              digestCanonicalValue(request.solutionRevision),
            ],
            markMissingAsStale: false,
            previousRecords: issueHistory,
            repairReference: reference,
            solutionRevisionId: request.solutionRevision.solutionRevisionId,
          });
          issueHistory = [...pendingAssessment.history];
          issues = [...pendingAssessment.latestRecords];
          pendingRepair = {
            checkIds: [
              ...new Set(repairedDiagnostics.map(({ checkId }) => checkId)),
            ],
            reference,
          };
          await publishProgress({
            attemptNumber: repairAttempt,
            bundleDigest,
            evidence: issueEvidence,
            issueHistory,
            issues,
            phase: "repair-proposed",
          });
        }
      }

      if (
        !materialization.succeeded ||
        provisionalArtifact === undefined ||
        provisionalValidationReplay === undefined ||
        targetResult === undefined
      ) {
        if (lastInvalidArtifact === undefined) {
          throw new Error(
            "Rejected candidate was not preserved in the restricted store.",
          );
        }

        const projection = {
          attempts,
          contractVersion: 1 as const,
          diagnostics: allDiagnostics,
          evidence: terminalEvidence,
          extensionId: extension.id,
          invalidArtifact: lastInvalidArtifact,
          issueHistory,
          issues: [...issues],
          progress: progress({
            ready: false,
            repairAttempts: repairAttempt,
            terminalFailure: true,
          }),
          solutionRevisionId: request.solutionRevision.solutionRevisionId,
          state: "rejected" as const,
          writeAuthority: "none" as const,
        };
        return finalizeCandidateGenerationFailure({
          draft: projection,
          generationProgress: finalizeProgress("candidate-generation-failure"),
        });
      }

      const artifact = await dependencies.artifactStore.put({
        bundleDigest: materialization.bundleDigest,
        extensionId: extension.id,
        files: materialization.files,
        scope: input.scope,
        solutionRevisionId: request.solutionRevision.solutionRevisionId,
        storedAt: input.assessedAt,
        targetKind: contentKind(request.generationContext),
        validationReplay: provisionalValidationReplay,
      });
      if (artifact.artifactDigest !== provisionalArtifact.artifactDigest) {
        throw new Error(
          "Candidate artifact store changed the exact content address.",
        );
      }
      const checks = validationChecks({
        diagnostics: allDiagnostics,
        expectations: request.generationContext.validationExpectations,
        outcomes: targetResult.outcomes,
      });
      const evidence = terminalEvidence;

      const ready =
        !allDiagnostics.some(({ severity }) => severity === "error") &&
        checks.every((check) => !check.required || check.result === "passed") &&
        (bundle.unresolvedItems ?? []).length === 0;
      const allMissingEvidenceKinds = [
        "cloudmarkup.user-acceptance",
        ...checks
          .filter((check) => check.required && check.result !== "passed")
          .map(({ checkId }) => checkId),
      ].filter((value, index, values) => values.indexOf(value) === index);
      const missingEvidenceKinds =
        allMissingEvidenceKinds.length <= 64
          ? allMissingEvidenceKinds
          : [
              ...allMissingEvidenceKinds.slice(0, 63),
              "cloudmarkup.ai-extension.additional-required-evidence",
            ];
      const pendingExtension = aiAuthoredExtensionV1Schema.parse({
        acceptance: { state: "pending" },
        contractVersion: 1,
        dependencies: materialization.dependencies,
        exportSafety: {
          missingEvidenceKinds,
          state: "not-safe",
        },
        id: extension.id,
        issueIds: issues.map(({ id }) => id),
        model: {
          modelId: gatewayResult.descriptor.modelId,
          modelVersion: gatewayResult.descriptor.modelVersion,
          outputDigest: artifact.bundleDigest,
          promptDigest: gatewayResult.descriptor.promptDigest,
          promptVersion: gatewayResult.descriptor.promptVersion,
          providerId: gatewayResult.descriptor.providerId,
          reservationId: extension.reservationId,
          usageEventIds: attempts.map(({ usageRecordId }) => usageRecordId),
        },
        outputs: artifact.files.map((file) => ({
          digest: file.digest,
          kind: file.sourceKind,
          path: file.path,
          sizeBytes: file.sizeBytes,
        })),
        ownedPaths: extension.ownedPaths,
        regenerationPolicy: extension.regenerationPolicy,
        request: extension.request,
        solutionRevisionId: request.solutionRevision.solutionRevisionId,
        sourceReferences: extension.sourceReferences,
        target: extension.target,
        validation: checks,
      });
      const reviewProjection = {
        artifact,
        assumptions: (bundle.assumptions ?? []).map((assumption) => ({
          assumptionId: assumption.assumptionId,
          sourceReferenceIds: assumption.sourceReferences.map(
            ({ referenceId }) => referenceId,
          ),
          statement: assumption.statement,
        })),
        attempts,
        attemptAuthority,
        contractVersion: 1 as const,
        diagnostics: allDiagnostics,
        evidence,
        expectedTests: (bundle.expectedTests ?? []).map((test) => ({
          description: test.description,
          expectedTestId: test.expectedTestId,
          kind: test.kind,
          sourceReferenceIds: test.sourceReferences.map(
            ({ referenceId }) => referenceId,
          ),
          targetPaths: test.targetPaths,
          validationCheckId: test.validationCheckId,
        })),
        editRevalidations: [],
        extension: pendingExtension,
        generationProgress: finalizeProgress("candidate-review"),
        issueHistory,
        issues,
        progress: progress({
          ready,
          repairAttempts: repairAttempt,
          terminalFailure: false,
        }),
        reviewId: stableRecordId("candidate-review", {
          artifactDigest: artifact.artifactDigest,
          extensionId: extension.id,
          solutionRevisionId: request.solutionRevision.solutionRevisionId,
        }),
        scope: input.scope,
        state: ready
          ? ("ready-for-acceptance" as const)
          : ("review-with-issues" as const),
        unresolvedItems: (bundle.unresolvedItems ?? []).map((item) => ({
          detail: item.detail,
          blocking: item.blocking,
          question: item.question,
          sourceReferenceIds: item.sourceReferences.map(
            ({ referenceId }) => referenceId,
          ),
          unresolvedItemId: item.unresolvedItemId,
        })),
        validation: checks,
        writeAuthority: "none" as const,
      };
      const candidateReview = candidateReviewRecordV1Schema.parse({
        ...reviewProjection,
        reviewDigest: getCandidateReviewDigest(reviewProjection),
      });
      if (dependencies.artifactStore.bindReview === undefined) {
        throw new Error(
          "Candidate review storage does not support immutable review binding.",
        );
      }
      const reviewBinding = await dependencies.artifactStore.bindReview({
        artifactId: artifact.artifactId,
        boundAt: input.assessedAt,
        expectedArtifactDigest: artifact.artifactDigest,
        reviewDigest: candidateReview.reviewDigest,
        reviewId: candidateReview.reviewId,
        scope: input.scope,
      });
      const expectedReviewBinding = createCandidateArtifactReviewBinding({
        reference: artifact,
        review: {
          boundAt: input.assessedAt,
          reviewDigest: candidateReview.reviewDigest,
          reviewId: candidateReview.reviewId,
        },
      });
      if (
        digestCanonicalValue(reviewBinding) !==
        digestCanonicalValue(expectedReviewBinding)
      ) {
        throw new Error(
          "Candidate artifact store changed the immutable review binding.",
        );
      }
      return candidateReview;
    },
  });
}
