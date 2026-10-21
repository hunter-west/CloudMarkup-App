import { z } from "zod";
import {
  digestCanonicalValue,
  modelLiveSequencePlanV3Schema,
  modelLiveSequenceSelectionV3Schema,
  sha256DigestSchema,
  solutionStableIdSchema,
  utcTimestampSchema,
  type ModelLiveSequenceDefinitionV3,
  type ModelLiveSequencePlanV3,
} from "@cloudmarkup/schemas";
import type { SqlRow } from "./sql.js";

export class ModelLiveSequenceAuthorityError extends Error {
  readonly code = "model-live.sequence-unavailable";
  constructor() {
    super("The exact current evaluation sequence is unavailable.");
    this.name = "ModelLiveSequenceAuthorityError";
  }
}
export function requireSequenceAuthority(value: boolean): asserts value {
  if (!value) throw new ModelLiveSequenceAuthorityError();
}
export const sequencePlanReferenceSchema = z
  .object({
    definitionId: solutionStableIdSchema,
    planDigest: sha256DigestSchema,
  })
  .strict();
export const sequenceApprovalRequestSchema = z
  .object({
    definitionId: solutionStableIdSchema,
    expectedDefinitionDigest: sha256DigestSchema,
  })
  .strict();
export const sequenceSelectionReferenceSchema = sequencePlanReferenceSchema
  .extend({
    selectionId: solutionStableIdSchema.regex(/^live_sequence_[a-f0-9]{32}$/u),
    selectionDigest: sha256DigestSchema,
  })
  .strict();
export type SequencePlanReference = z.output<
  typeof sequencePlanReferenceSchema
>;
export type SequenceSelectionReference = z.output<
  typeof sequenceSelectionReferenceSchema
>;
export const sameSequenceMetadata = (left: unknown, right: unknown) =>
  digestCanonicalValue(left) === digestCanonicalValue(right);
const MAXIMUM_PLAN_BYTES = 48 * 1024;
const MAXIMUM_SELECTION_BYTES = 32 * 1024;
function boundedRecord(value: unknown, maximumBytes: number): unknown {
  const encoded = typeof value === "string" ? value : JSON.stringify(value);
  requireSequenceAuthority(
    typeof encoded === "string" &&
      Buffer.byteLength(encoded, "utf8") <= maximumBytes,
  );
  return JSON.parse(encoded) as unknown;
}
function sameTime(value: unknown, expected: string) {
  return Date.parse(utcTimestampSchema.parse(value)) === Date.parse(expected);
}
/** Exact persisted restoration only. A parsed row is not current operator,
 * stage validation, commercial, dispatch or report authority. */
export function parseIssuedModelLiveSequencePlanRow(
  row: SqlRow,
  scope: ModelLiveSequenceDefinitionV3["scope"],
) {
  const plan = modelLiveSequencePlanV3Schema.parse(
    boundedRecord(row["plan_record"], MAXIMUM_PLAN_BYTES),
  );
  const definition = plan.definition;
  requireSequenceAuthority(
    typeof row["revoked"] === "boolean" &&
      sameSequenceMetadata(definition.scope, scope) &&
      row["organization_id"] === scope.organizationId &&
      row["project_id"] === scope.projectId &&
      row["principal_id"] === scope.userId &&
      row["operator_principal_id"] === plan.approval.operatorUserId &&
      row["definition_id"] === definition.definitionId &&
      row["definition_sha256"] === definition.definitionDigest.slice(7) &&
      row["approval_sha256"] === plan.approval.approvalDigest.slice(7) &&
      row["plan_sha256"] === plan.planDigest.slice(7) &&
      row["plan_id"] === plan.planId &&
      sameTime(row["issued_at_text"], plan.issuedAt) &&
      sameTime(row["expires_at_text"], plan.expiresAt),
  );
  return { plan, revoked: row["revoked"] };
}
/** Current-reader compatibility: historical callers still reject revoked plans. */
export function parseModelLiveSequencePlanRow(
  row: SqlRow,
  scope: ModelLiveSequenceDefinitionV3["scope"],
) {
  const issued = parseIssuedModelLiveSequencePlanRow(row, scope);
  requireSequenceAuthority(!issued.revoked);
  return issued.plan;
}
export function parseModelLiveSequenceSelectionRow(
  row: SqlRow,
  plan: ModelLiveSequencePlanV3,
) {
  const selection = modelLiveSequenceSelectionV3Schema.parse(
    boundedRecord(row["selection_record"], MAXIMUM_SELECTION_BYTES),
  );
  const scope = plan.definition.scope;
  requireSequenceAuthority(
    sameSequenceMetadata(selection.scope, scope) &&
      selection.definitionId === plan.definition.definitionId &&
      selection.planDigest === plan.planDigest &&
      selection.approvalDigest === plan.approval.approvalDigest &&
      row["organization_id"] === scope.organizationId &&
      row["project_id"] === scope.projectId &&
      row["principal_id"] === scope.userId &&
      row["plan_sha256"] === plan.planDigest.slice(7) &&
      row["selection_id"] === selection.selectionId &&
      row["selection_sha256"] === selection.selectionDigest.slice(7) &&
      sameTime(row["issued_at_text"], selection.issuedAt) &&
      Date.parse(selection.issuedAt) >= Date.parse(plan.issuedAt) &&
      Date.parse(selection.issuedAt) < Date.parse(plan.expiresAt) &&
      sameSequenceMetadata(
        selection.stages.map(({ caseId, caseDigest, stageKey }) => ({
          caseId,
          caseDigest,
          stageKey,
        })),
        plan.definition.cases.flatMap(({ caseId, caseDigest }) =>
          ["repair-1", "repair-2"].map((stageKey) => ({
            caseId,
            caseDigest,
            stageKey,
          })),
        ),
      ),
  );
  return selection;
}
