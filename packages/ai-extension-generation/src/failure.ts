import {
  activeIssueV1Schema,
  evidenceRecordV1Schema,
  sha256DigestSchema,
  solutionRevisionIdSchema,
  solutionStableIdSchema,
  type Sha256Digest,
} from "@cloudmarkup/schemas";
import { z } from "zod";

import {
  assertCandidateIssueHistoryV1,
  candidateAttemptV1Schema,
  candidateDiagnosticV1Schema,
  candidateGenerationProgressFinalizationV1Schema,
  candidateProgressStageV1Schema,
  invalidCandidateArtifactReferenceV1Schema,
} from "./contracts.js";
import { digestCanonicalValue } from "./security.js";

const candidateGenerationFailureBaseV1Schema = z
  .object({
    attempts: z.array(candidateAttemptV1Schema).max(3),
    contractVersion: z.literal(1),
    diagnostics: z.array(candidateDiagnosticV1Schema).min(1).max(1_000),
    evidence: z.array(evidenceRecordV1Schema).max(128),
    extensionId: solutionStableIdSchema,
    generationProgress: candidateGenerationProgressFinalizationV1Schema,
    invalidArtifact: invalidCandidateArtifactReferenceV1Schema,
    issueHistory: z.array(activeIssueV1Schema).min(1).max(10_000),
    issues: z.array(activeIssueV1Schema).min(1).max(1_000),
    progress: z.array(candidateProgressStageV1Schema).length(5),
    resultDigest: sha256DigestSchema,
    solutionRevisionId: solutionRevisionIdSchema,
    state: z.literal("rejected"),
    writeAuthority: z.literal("none"),
  })
  .strict();

export type CandidateGenerationFailureV1 = z.output<
  typeof candidateGenerationFailureBaseV1Schema
>;

export function getCandidateGenerationFailureDigest(
  input:
    | CandidateGenerationFailureV1
    | Omit<CandidateGenerationFailureV1, "resultDigest">,
): Sha256Digest {
  const projection = {
    ...input,
  } as Partial<CandidateGenerationFailureV1>;
  delete projection.resultDigest;
  return digestCanonicalValue(projection);
}

export const candidateGenerationFailureV1Schema =
  candidateGenerationFailureBaseV1Schema.superRefine((value, context) => {
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
            : "Candidate issue history is invalid.",
        path: ["issueHistory"],
      });
    }
    if (
      value.generationProgress.terminalResultKind !==
        "candidate-generation-failure" ||
      ![
        "generation-rejected",
        "repair-rejected",
        "validation-assessed",
      ].includes(value.generationProgress.terminalPhase) ||
      value.generationProgress.finalEvidenceCount !== value.evidence.length ||
      value.generationProgress.finalEvidenceDigest !==
        digestCanonicalValue(value.evidence) ||
      value.generationProgress.finalIssueHistoryCount !==
        value.issueHistory.length ||
      value.generationProgress.finalIssuesDigest !==
        digestCanonicalValue(value.issues) ||
      value.generationProgress.finalIssuesCount !== value.issues.length ||
      value.generationProgress.finalIssueHistoryDigest !==
        digestCanonicalValue(value.issueHistory)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Generation failure must bind the exact finalized progress outcome, Evidence, and terminal issue state.",
        path: ["generationProgress"],
      });
    }
    if (getCandidateGenerationFailureDigest(value) !== value.resultDigest) {
      context.addIssue({
        code: "custom",
        message: "Generation failure digest must hash the exact safe result.",
        path: ["resultDigest"],
      });
    }
    if (
      value.invalidArtifact.extensionId !== value.extensionId ||
      value.invalidArtifact.solutionRevisionId !== value.solutionRevisionId
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Invalid artifact authority must match the generation failure.",
        path: ["invalidArtifact"],
      });
    }
  });
