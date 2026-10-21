import { z } from "zod";
import {
  digestCanonicalValue,
  modelLiveEvaluationScopeV2Schema,
  sha256DigestSchema,
  solutionStableIdSchema,
  utcTimestampSchema,
  type ModelLiveEvaluationPlanV2,
} from "@cloudmarkup/schemas";
import type { SqlRow } from "./sql.js";

export class ModelLiveInvocationSetError extends Error {
  readonly code = "model-live.invocation-set-unavailable";
  constructor() {
    super("The exact current evaluation invocation set is unavailable.");
    this.name = "ModelLiveInvocationSetError";
  }
}
export function requireInvocationSet(value: boolean): asserts value {
  if (!value) throw new ModelLiveInvocationSetError();
}
export const modelLiveInvocationSetReferenceV2Schema = z
  .object({
    setId: solutionStableIdSchema.regex(/^live_set_[a-f0-9]{32}$/u),
    setDigest: sha256DigestSchema,
  })
  .strict();
const entry = z
  .object({
    caseId: solutionStableIdSchema,
    caseDigest: sha256DigestSchema,
    sourceInputDigest: sha256DigestSchema,
    authorityTupleDigest: sha256DigestSchema,
    invocationId: solutionStableIdSchema.regex(/^invocation_[a-f0-9]{32}$/u),
  })
  .strict();
/** Private persisted comparison metadata. A digest is not issuance authority. */
export const modelLiveInvocationSetV2Schema = z
  .object({
    ...modelLiveInvocationSetReferenceV2Schema.shape,
    contractVersion: z.literal(2),
    recordKind: z.literal("model-live-invocation-set"),
    issuerId: z.literal("cloudmarkup.model-live-invocation-set"),
    issuerVersion: z.literal("1.0.0"),
    scope: modelLiveEvaluationScopeV2Schema,
    definitionId: solutionStableIdSchema,
    definitionDigest: sha256DigestSchema,
    planDigest: sha256DigestSchema,
    approvalDigest: sha256DigestSchema,
    issuedAt: utcTimestampSchema,
    entries: z.array(entry).min(1).max(21),
  })
  .strict()
  .superRefine((value, context) => {
    const { setDigest, ...body } = value;
    if (
      setDigest !== digestCanonicalValue(body) ||
      new Set(value.entries.map((e) => e.caseId)).size !==
        value.entries.length ||
      new Set(value.entries.map((e) => e.caseDigest)).size !==
        value.entries.length ||
      new Set(value.entries.map((e) => e.invocationId)).size !==
        value.entries.length
    ) {
      context.addIssue({
        code: "custom",
        message: "Exact unique ordered invocation metadata is required.",
      });
    }
  });
export type ModelLiveInvocationSetV2 = z.output<
  typeof modelLiveInvocationSetV2Schema
>;
export type ModelLiveInvocationSetReferenceV2 = z.output<
  typeof modelLiveInvocationSetReferenceV2Schema
>;
export const MODEL_LIVE_INVOCATION_SET_MAXIMUM_BYTES = 24 * 1024;
const same = (a: unknown, b: unknown) =>
  digestCanonicalValue(a) === digestCanonicalValue(b);
export function parseModelLiveInvocationSetRow(
  row: SqlRow,
  plan: ModelLiveEvaluationPlanV2,
) {
  const value: unknown =
    typeof row["set_record"] === "string"
      ? JSON.parse(row["set_record"])
      : row["set_record"];
  const record = modelLiveInvocationSetV2Schema.parse(value);
  requireInvocationSet(
    Buffer.byteLength(JSON.stringify(record), "utf8") <=
      MODEL_LIVE_INVOCATION_SET_MAXIMUM_BYTES &&
      same(record.scope, plan.definition.scope) &&
      record.definitionId === plan.definition.definitionId &&
      record.definitionDigest === plan.definition.definitionDigest &&
      record.planDigest === plan.planDigest &&
      record.approvalDigest === plan.approval.approvalDigest &&
      Date.parse(record.issuedAt) >= Date.parse(plan.issuedAt) &&
      Date.parse(record.issuedAt) < Date.parse(plan.expiresAt) &&
      row["organization_id"] === record.scope.organizationId &&
      row["project_id"] === record.scope.projectId &&
      row["principal_id"] === record.scope.userId &&
      row["plan_sha256"] === record.planDigest.slice(7) &&
      row["set_id"] === record.setId &&
      row["set_sha256"] === record.setDigest.slice(7) &&
      same(
        record.entries.map(
          ({
            caseId,
            caseDigest,
            sourceInputDigest,
            authorityTupleDigest,
          }) => ({
            caseId,
            caseDigest,
            sourceInputDigest,
            authorityTupleDigest,
          }),
        ),
        plan.definition.cases.map((c) => ({
          caseId: c.caseId,
          caseDigest: c.caseDigest,
          sourceInputDigest: c.sourceInputDigest,
          authorityTupleDigest: c.authorityBinding.authorityTupleDigest,
        })),
      ),
  );
  return record;
}
