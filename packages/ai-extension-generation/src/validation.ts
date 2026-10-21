import {
  evidenceRecordV1Schema,
  sha256DigestSchema,
  type EvidenceRecordV1,
  type ModelCandidateBundleV1,
  type ModelGenerationContextV1,
  type ModelInvocationDescriptorV1,
  type SolutionRevisionManifestV1,
} from "@cloudmarkup/schemas";
import { z } from "zod";

import {
  candidateDiagnosticV1Schema,
  type CandidateArtifactReferenceV1,
  type CandidateDiagnosticV1,
} from "./contracts.js";
import type { MaterializedCandidateFile } from "./materializer.js";

export const candidateValidationOutcomeV1Schema = z
  .object({
    kind: z.enum([
      "parse",
      "format",
      "static-analysis",
      "build",
      "unit-test",
      "contract-test",
      "integration-test",
      "security",
    ]),
    result: z.enum(["passed", "failed", "error", "not-run"]),
    toolVersion: z.string().min(1).max(128).optional(),
  })
  .strict();

export const candidateTargetValidationResultV1Schema = z
  .object({
    diagnostics: z.array(candidateDiagnosticV1Schema).max(1_000),
    evidence: z.array(evidenceRecordV1Schema).max(31),
    outcomes: z.array(candidateValidationOutcomeV1Schema).max(16),
    representationDigest: sha256DigestSchema,
    state: z.enum(["passed", "failed", "error"]),
  })
  .strict()
  .superRefine((value, context) => {
    const kinds = new Set<string>();
    value.outcomes.forEach((outcome, index) => {
      if (kinds.has(outcome.kind)) {
        context.addIssue({
          code: "custom",
          message: "Target validation outcomes must be unique by kind.",
          path: ["outcomes", index, "kind"],
        });
      }
      kinds.add(outcome.kind);
    });
    const hasErrors = value.diagnostics.some(
      ({ severity }) => severity === "error",
    );
    if ((value.state === "passed") === hasErrors) {
      context.addIssue({
        code: "custom",
        message:
          "Target validation state must reflect deterministic diagnostics.",
        path: ["state"],
      });
    }
  });

export interface CandidateTargetValidationInput {
  readonly artifact: CandidateArtifactReferenceV1;
  readonly assessedAt: string;
  readonly bundle: ModelCandidateBundleV1;
  readonly descriptor: ModelInvocationDescriptorV1;
  readonly files: readonly MaterializedCandidateFile[];
  readonly generationContext: ModelGenerationContextV1;
  readonly solutionRevision: SolutionRevisionManifestV1;
}

export interface CandidateTargetValidationPort {
  validate(
    input: CandidateTargetValidationInput,
    signal?: AbortSignal,
  ): Promise<CandidateTargetValidationResultV1>;
}

export type CandidateValidationOutcomeV1 = z.output<
  typeof candidateValidationOutcomeV1Schema
>;
export type CandidateTargetValidationResultV1 = z.output<
  typeof candidateTargetValidationResultV1Schema
>;
export type { CandidateDiagnosticV1, EvidenceRecordV1 };
