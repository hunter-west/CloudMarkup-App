import { z } from "zod";
import { sha256DigestSchema } from "./architecture-document-v1.js";
import { digestCanonicalValue, sha256Text } from "./canonical-digest.js";
import {
  modelCandidateRepairRequestV1Schema,
  modelFileCandidateV1Schema,
} from "./model-gateway-v1.js";

const repair = modelCandidateRepairRequestV1Schema.shape;
const file = modelFileCandidateV1Schema.options[0].shape;

/** The first repair starts with host-created source. This is never an assertion
 * that a model produced it, nor permission to replace the owned file. */
export const modelHostSeedFileV2Schema = z
  .object({
    candidateId: file.candidateId,
    content: file.content,
    contentDigest: file.contentDigest,
    encoding: file.encoding,
    kind: file.kind,
    ownership: z.literal("user-owned"),
    path: file.path,
    sourceAuthority: z.literal("fixed-host-synthetic"),
  })
  .strict();

/** Separate input version; the existing strict V1 response still describes only
 * new unaccepted AI candidates. These digests are references, not issued proof. */
export const modelHostSeedRepairRequestV2Schema = z
  .object({
    contractVersion: z.literal(2),
    operation: repair.operation,
    requestedMode: repair.requestedMode,
    boundary: repair.boundary,
    diagnostics: repair.diagnostics,
    failedCandidates: z.array(modelHostSeedFileV2Schema).length(1),
    failedCandidatesCanonicalization: z.literal(
      "cloudmarkup.model-host-seed-files.canonical-json.v2",
    ),
    failedOutputDigest: sha256DigestSchema,
    currentAttempt: z.literal(1),
    maximumRepairAttempts: z.literal(2),
    validationExpectations: repair.validationExpectations,
    hostSeed: z
      .object({
        recipeId: z.literal(
          "cloudmarkup.model-live.repair-seed.typescript-assignment",
        ),
        recipeVersion: z.literal("1.1.0"),
        recipeDigest: sha256DigestSchema,
        sourceTreeDigest: sha256DigestSchema,
        solutionRevisionDigest: sha256DigestSchema,
        ownershipDigest: sha256DigestSchema,
        seedValidationReceiptDigest: sha256DigestSchema,
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    const candidate = value.failedCandidates[0];
    if (candidate === undefined) {
      context.addIssue({
        code: "custom",
        message: "The exact host seed file is required.",
      });
      return;
    }
    if (
      candidate.contentDigest !== sha256Text(candidate.content) ||
      value.failedOutputDigest !==
        digestCanonicalValue(value.failedCandidates) ||
      value.boundary.ownedPaths.length !== 1 ||
      value.boundary.ownedPaths[0] !== candidate.path
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Host seed content and its exact single-file boundary disagree.",
      });
    }
    const diagnosticIds = new Set<string>();
    for (const diagnostic of value.diagnostics) {
      if (
        diagnosticIds.has(diagnostic.diagnosticId) ||
        diagnostic.candidateId !== candidate.candidateId ||
        diagnostic.path !== candidate.path
      ) {
        context.addIssue({
          code: "custom",
          message: "Host seed diagnostics must identify the exact failed file.",
        });
      }
      diagnosticIds.add(diagnostic.diagnosticId);
    }
  });

export type ModelHostSeedRepairRequestV2 = z.output<
  typeof modelHostSeedRepairRequestV2Schema
>;
