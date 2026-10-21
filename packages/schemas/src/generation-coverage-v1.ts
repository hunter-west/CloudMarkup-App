import { z } from "zod";

import { workloadIdSchema } from "./workload-behavior-v1.js";
import {
  evidenceIdSchema,
  solutionRevisionIdSchema,
  solutionStableIdSchema,
} from "./solution-contract-common-v1.js";

export const generationCoverageStateSchema = z.enum([
  "infrastructure-only",
  "starter-application",
  "complete-supported-pattern",
  "ai-assisted-custom-validated",
  "custom-implementation-required",
  "target-unsupported",
]);

export const generationCoverageRequirementSchema = z.enum([
  "structural-validity",
  "provider-architecture-validity",
  "deterministic-infrastructure-compilation",
  "deterministic-application-generation",
  "ai-extension-parse-static-validity",
  "application-build-and-tests",
  "application-security-checks",
]);

export const generationCoverageEvidenceV1Schema = z
  .object({
    evidenceId: evidenceIdSchema,
    requirement: generationCoverageRequirementSchema,
  })
  .strict();

export const workloadGenerationCoverageV1Schema = z
  .object({
    evidence: z.array(generationCoverageEvidenceV1Schema).max(64),
    missingRequirements: z.array(generationCoverageRequirementSchema).max(16),
    state: generationCoverageStateSchema,
    unresolvedRequirementIds: z.array(solutionStableIdSchema).max(128),
    workloadId: workloadIdSchema,
  })
  .strict();

export const solutionGenerationCoverageV1Schema = z
  .object({
    contractVersion: z.literal(1),
    evidence: z.array(generationCoverageEvidenceV1Schema).max(256),
    missingRequirements: z.array(generationCoverageRequirementSchema).max(16),
    solutionRevisionId: solutionRevisionIdSchema,
    state: generationCoverageStateSchema,
    workloads: z.array(workloadGenerationCoverageV1Schema).max(1_000),
  })
  .strict();

export type GenerationCoverageEvidenceV1 = z.output<
  typeof generationCoverageEvidenceV1Schema
>;
export type GenerationCoverageRequirement = z.output<
  typeof generationCoverageRequirementSchema
>;
export type GenerationCoverageState = z.output<
  typeof generationCoverageStateSchema
>;
export type SolutionGenerationCoverageV1 = z.output<
  typeof solutionGenerationCoverageV1Schema
>;
export type WorkloadGenerationCoverageV1 = z.output<
  typeof workloadGenerationCoverageV1Schema
>;
