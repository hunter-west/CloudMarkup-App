import { z } from "zod";
import { sha256DigestSchema } from "./architecture-document-v1.js";
import { digestCanonicalValue, sha256Text } from "./canonical-digest.js";
import {
  modelHostSeedRepairRequestV2Schema,
  modelHostSeedFileV2Schema,
} from "./model-host-seed-repair-v2.js";
import { modelLiveSequenceInputV3Schema } from "./model-live-evaluation-sequence-v3.js";

const first = modelHostSeedRepairRequestV2Schema.shape;
const stage = modelLiveSequenceInputV3Schema.shape;

/** The bytes are an unaccepted model repair of the original owned file.
 * They are neither a fresh fixed seed nor accepted repository content. */
export const modelHostRepairSuccessorFileV3Schema = z
  .object({
    ...modelHostSeedFileV2Schema.shape,
    ownership: z.literal("user-owned-preserved"),
    sourceAuthority: z.literal("unaccepted-model-repair"),
  })
  .strict();

/** References only. The private host must authenticate the actual first-stage
 * receipt and derive these bytes in RAM; parsing grants no issuance or send. */
export const modelHostRepairSuccessorRequestV3Schema = z
  .object({
    ...first,
    contractVersion: z.literal(3),
    failedCandidates: z.array(modelHostRepairSuccessorFileV3Schema).length(1),
    failedCandidatesCanonicalization: z.literal(
      "cloudmarkup.model-host-repair-successor-files.canonical-json.v3",
    ),
    currentAttempt: z.literal(2),
    predecessor: z
      .object({
        stageId: stage.stageId,
        invocationId: stage.invocationId,
        inputDigest: sha256DigestSchema,
        responseDigest: sha256DigestSchema,
        sourceTreeDigest: sha256DigestSchema,
        contentDigest: sha256DigestSchema,
        validationReceiptDigest: sha256DigestSchema,
        outcomeDigest: sha256DigestSchema,
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    const file = value.failedCandidates[0];
    if (file === undefined) return;
    if (
      file.contentDigest !== sha256Text(file.content) ||
      file.contentDigest !== value.predecessor.contentDigest ||
      value.failedOutputDigest !==
        digestCanonicalValue(value.failedCandidates) ||
      value.boundary.ownedPaths.length !== 1 ||
      value.boundary.ownedPaths[0] !== file.path
    ) {
      context.addIssue({
        code: "custom",
        message:
          "The exact prior candidate and single owned path are required.",
      });
    }
    const ids = new Set<string>();
    for (const diagnostic of value.diagnostics) {
      if (
        ids.has(diagnostic.diagnosticId) ||
        diagnostic.candidateId !== file.candidateId ||
        diagnostic.path !== file.path
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Successor diagnostics must identify the exact prior candidate.",
        });
      }
      ids.add(diagnostic.diagnosticId);
    }
  });
export type ModelHostRepairSuccessorRequestV3 = z.output<
  typeof modelHostRepairSuccessorRequestV3Schema
>;
