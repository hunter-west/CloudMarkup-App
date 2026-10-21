import { z } from "zod";
import {
  digestStructuredValue,
  inspectModelValueForSecretCandidatesV1,
} from "@cloudmarkup/model-gateway";
import {
  sha256DigestSchema,
  solutionStableIdSchema,
} from "@cloudmarkup/schemas";
import {
  MODEL_LIVE_IMPORTER_102_SNAPSHOT_DIGESTS,
  modelLiveRepositoryParserAuthorityV1Schema,
} from "../../model-live-repository-parser-authority.js";

export class ModelLiveParserInputError extends Error {
  readonly code = "model-live-evaluation.parser-input-unavailable";
  constructor() {
    super("The exact issued repository parser input is unavailable.");
    this.name = "ModelLiveParserInputError";
  }
}
export function requireParserInput(value: boolean): asserts value {
  if (!value) throw new ModelLiveParserInputError();
}
export const modelLiveParserInputReferenceV1Schema = z
  .object({
    receiptId: solutionStableIdSchema.regex(/^parser_input_[a-f0-9]{64}$/u),
    receiptDigest: sha256DigestSchema,
  })
  .strict();

/** Metadata is not authority. Only the actual parser issuer may create the
 * immutable scoped row; validators and terminal readers require that row. */
export const modelLiveParserInputReceiptV1Schema = z
  .object({
    contractVersion: z.literal(1),
    recordKind: z.literal("model-live-parser-input-receipt"),
    receiptId: solutionStableIdSchema.regex(/^parser_input_[a-f0-9]{64}$/u),
    receiptDigest: sha256DigestSchema,
    organizationId: solutionStableIdSchema,
    projectId: solutionStableIdSchema,
    userId: solutionStableIdSchema,
    invocationId: solutionStableIdSchema,
    invocationScopeDigest: sha256DigestSchema,
    invocationDigest: sha256DigestSchema,
    descriptorDigest: sha256DigestSchema,
    requestDigest: sha256DigestSchema,
    runtimeRequestDigest: sha256DigestSchema,
    planDigest: sha256DigestSchema,
    approvalDigest: sha256DigestSchema,
    caseId: solutionStableIdSchema,
    caseDigest: sha256DigestSchema,
    sourceInputDigest: sha256DigestSchema,
    inputDigest: sha256DigestSchema,
    inputEvidenceId: solutionStableIdSchema,
    inputEvidenceDigest: sha256DigestSchema,
    repositoryParser: modelLiveRepositoryParserAuthorityV1Schema,
  })
  .strict()
  .superRefine((value, context) => {
    const { receiptId, receiptDigest, ...body } = value;
    if (
      receiptId !== "parser_input_" + digestStructuredValue(body).slice(7) ||
      receiptDigest !== digestStructuredValue({ ...body, receiptId }) ||
      value.repositoryParser.snapshotDigest !==
        MODEL_LIVE_IMPORTER_102_SNAPSHOT_DIGESTS[value.caseId] ||
      new TextEncoder().encode(JSON.stringify(value)).byteLength > 8192 ||
      inspectModelValueForSecretCandidatesV1(value).detectedValueCount !== 0
    ) {
      context.addIssue({
        code: "custom",
        message: "Parser input receipt metadata is contradictory.",
      });
    }
  });
export type ModelLiveParserInputReceiptV1 = z.output<
  typeof modelLiveParserInputReceiptV1Schema
>;

export function identifyModelLiveParserInputReceipt(
  body: Omit<ModelLiveParserInputReceiptV1, "receiptId" | "receiptDigest">,
): ModelLiveParserInputReceiptV1 {
  const identified = {
    ...body,
    receiptId: "parser_input_" + digestStructuredValue(body).slice(7),
  };
  return modelLiveParserInputReceiptV1Schema.parse({
    ...identified,
    receiptDigest: digestStructuredValue(identified),
  });
}
