import {
  betaInfrastructureProposalSchema,
  createBetaInfrastructureProposalV1Schema,
  sha256DigestSchema,
  betaProposalApplicabilityReceiptV1Schema,
  digestCanonicalValue,
} from "@cloudmarkup/schemas";
import { z } from "zod";
import { createDataEnvelopeSchema } from "./common.js";
export { createBetaInfrastructureProposalV1Schema };
export const betaInfrastructureProposalResponseV1Schema =
  createDataEnvelopeSchema(
    z
      .object({
        contractVersion: z.literal(1),
        architectureDigest: sha256DigestSchema,
        proposal: betaInfrastructureProposalSchema,
        applicability: betaProposalApplicabilityReceiptV1Schema.optional(),
      })
      .strict()
      .superRefine((value, context) => {
        if (value.proposal.contractVersion === 6) {
          const receipt = value.applicability;
          const mutation =
            value.proposal.resources.length +
              value.proposal.connections.length +
              value.proposal.updates.length >
            0;
          if (
            receipt?.architectureDigest !== value.architectureDigest ||
            receipt.proposalDigest !== digestCanonicalValue(value.proposal) ||
            receipt.kind !==
              (mutation ? "mutation" : "questions-or-assessment") ||
            (mutation
              ? receipt.commandDigest === null
              : receipt.commandDigest !== null)
          )
            context.addIssue({
              code: "custom",
              message:
                "V6 delivery requires its matching host applicability receipt.",
            });
        } else if (value.applicability)
          context.addIssue({
            code: "custom",
            message:
              "Historical delivery contracts cannot acquire a new applicability receipt.",
          });
      }),
  );

export const betaInfrastructureJobPathV1Schema = z
  .object({
    projectId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u),
    jobId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u),
  })
  .strict();
export const betaInfrastructureJobV1Schema = z
  .object({
    contractVersion: z.literal(1),
    id: z.string().min(1).max(128),
    state: z.enum([
      "queued",
      "running",
      "succeeded",
      "failed",
      "canceled",
      "expired",
    ]),
    architectureDigest: sha256DigestSchema,
    result: betaInfrastructureProposalResponseV1Schema.shape.data.optional(),
  })
  .strict()
  .superRefine((v, c) => {
    if (
      (v.state === "succeeded") !== (v.result !== undefined) ||
      (v.result && v.result.architectureDigest !== v.architectureDigest)
    )
      c.addIssue({
        code: "custom",
        message: "Job result must match its completed draft binding.",
      });
  });
export const betaInfrastructureJobResponseV1Schema = createDataEnvelopeSchema(
  betaInfrastructureJobV1Schema,
);
export type BetaInfrastructureJobV1 = z.infer<
  typeof betaInfrastructureJobV1Schema
>;

/** Separate receipt preserves the strict v1 job response for existing clients. */
export const betaInfrastructureJobCreditsV1Schema = z
  .object({
    contractVersion: z.literal(1),
    jobId: z.string().min(1).max(128),
    state: z.enum([
      "reserved",
      "dispatched",
      "usage-recorded",
      "settled",
      "released",
      "not-metered",
    ]),
    estimatedCreditUnits: z
      .string()
      .regex(/^(0|[1-9][0-9]*)$/u)
      .optional(),
    maximumCreditUnits: z
      .string()
      .regex(/^(0|[1-9][0-9]*)$/u)
      .optional(),
    actualCreditUnits: z
      .string()
      .regex(/^(0|[1-9][0-9]*)$/u)
      .optional(),
  })
  .strict();
export const betaInfrastructureJobCreditsResponseV1Schema =
  createDataEnvelopeSchema(betaInfrastructureJobCreditsV1Schema);
export type BetaInfrastructureJobCreditsV1 = z.infer<
  typeof betaInfrastructureJobCreditsV1Schema
>;
