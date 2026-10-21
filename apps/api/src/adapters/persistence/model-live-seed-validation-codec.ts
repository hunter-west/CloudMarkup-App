import type { SqlRow } from "./sql.js";
import { z } from "zod";
import { applicationHostRepairSeedBindingsV1Schema } from "@cloudmarkup/application-build-runner/host-repair-seed";
import {
  digestCanonicalValue,
  modelLiveEvaluationScopeV2Schema,
  modelLiveRepairCaseV3Schema,
  sha256DigestSchema,
  solutionStableIdSchema,
  utcTimestampSchema,
} from "@cloudmarkup/schemas";

export class ModelLiveSeedValidationError extends Error {
  readonly code = "model-live-evaluation.seed-validation-unavailable";
  constructor() {
    super("The exact authenticated seed validation is unavailable.");
    this.name = "ModelLiveSeedValidationError";
  }
}
export function requireSeedValidation(value: boolean): asserts value {
  if (!value) throw new ModelLiveSeedValidationError();
}
const receiptId = solutionStableIdSchema.regex(
  /^seed_validation_[a-f0-9]{64}$/u,
);
export const modelLiveSeedValidationReferenceV1Schema = z
  .object({
    receiptId,
    receiptDigest: sha256DigestSchema,
  })
  .strict();

/** Strict immutable metadata only. Parsing/identifying this record neither proves
 * execution nor issues authority; the private authenticated issuer must own the
 * actual fixed runner call and the scoped database insert. */
export const modelLiveSeedValidationReceiptV1Schema = z
  .object({
    contractVersion: z.literal(1),
    recordKind: z.literal("model-live-seed-validation-receipt"),
    receiptId,
    receiptDigest: sha256DigestSchema,
    scope: modelLiveEvaluationScopeV2Schema,
    operatorUserId: solutionStableIdSchema,
    caseId: modelLiveRepairCaseV3Schema,
    caseDigest: sha256DigestSchema,
    frozenInputDigest: sha256DigestSchema,
    datasetDigest: sha256DigestSchema,
    // Persisted V1 pins are immutable; a future host recipe must not rewrite them.
    recipeId: z.literal(
      "cloudmarkup.model-live.repair-seed.typescript-assignment",
    ),
    recipeVersion: z.literal("1.1.0"),
    sourceAuthority: z.literal("fixed-host-synthetic"),
    variant: z.literal("invalid-seed"),
    disposition: z.literal("invalid-repairable"),
    observedDefect: z.literal("TS2322"),
    cleanup: z.literal("verified"),
    startedAt: utcTimestampSchema,
    completedAt: utcTimestampSchema,
    issuedAt: utcTimestampSchema,
    ownershipDigest: sha256DigestSchema,
    configurationDigest: sha256DigestSchema,
    profileDigest: sha256DigestSchema,
    toolchainDigest: sha256DigestSchema,
    builderDigest: sha256DigestSchema,
    scannerDigest: sha256DigestSchema,
    bindings: applicationHostRepairSeedBindingsV1Schema,
    reportDigest: sha256DigestSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const { receiptId: id, receiptDigest, ...body } = value;
    if (
      id !== "seed_validation_" + digestCanonicalValue(body).slice(7) ||
      receiptDigest !== digestCanonicalValue({ ...body, receiptId: id }) ||
      Date.parse(value.startedAt) > Date.parse(value.completedAt) ||
      Date.parse(value.completedAt) > Date.parse(value.issuedAt) ||
      Buffer.byteLength(JSON.stringify(value), "utf8") > 8192
    )
      context.addIssue({
        code: "custom",
        message: "Seed validation metadata is contradictory.",
      });
  });
export type ModelLiveSeedValidationReceiptV1 = z.output<
  typeof modelLiveSeedValidationReceiptV1Schema
>;

/** Computes metadata identity, never execution, tenant or database authority. */
export function identifyModelLiveSeedValidationReceipt(
  body: Omit<ModelLiveSeedValidationReceiptV1, "receiptId" | "receiptDigest">,
): ModelLiveSeedValidationReceiptV1 {
  const identified = {
    ...body,
    receiptId: "seed_validation_" + digestCanonicalValue(body).slice(7),
  };
  return modelLiveSeedValidationReceiptV1Schema.parse({
    ...identified,
    receiptDigest: digestCanonicalValue(identified),
  });
}

/** Exact immutable row restoration only; current operator, configuration and
 * execution authority must still be checked by the private scoped issuer. */
export function parseModelLiveSeedValidationRow(
  row: SqlRow,
  expectedScope: ModelLiveSeedValidationReceiptV1["scope"],
): ModelLiveSeedValidationReceiptV1 {
  try {
    const scope = modelLiveEvaluationScopeV2Schema.parse(expectedScope);
    const raw = row["receipt_record"];
    const encoded = typeof raw === "string" ? raw : JSON.stringify(raw);
    requireSeedValidation(
      typeof encoded === "string" && Buffer.byteLength(encoded, "utf8") <= 8192,
    );
    const receipt = modelLiveSeedValidationReceiptV1Schema.parse(
      JSON.parse(encoded) as unknown,
    );
    requireSeedValidation(
      digestCanonicalValue(receipt.scope) === digestCanonicalValue(scope) &&
        row["organization_id"] === scope.organizationId &&
        row["project_id"] === scope.projectId &&
        row["principal_id"] === scope.userId &&
        row["operator_principal_id"] === receipt.operatorUserId &&
        row["case_id"] === receipt.caseId &&
        row["receipt_id"] === receipt.receiptId &&
        row["receipt_sha256"] === receipt.receiptDigest.slice(7) &&
        row["configuration_sha256"] === receipt.configurationDigest.slice(7) &&
        Date.parse(utcTimestampSchema.parse(row["issued_at_text"])) ===
          Date.parse(receipt.issuedAt),
    );
    return receipt;
  } catch {
    throw new ModelLiveSeedValidationError();
  }
}
