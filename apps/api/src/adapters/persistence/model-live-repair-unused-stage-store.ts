import {
  digestCanonicalValue as digest,
  modelLiveSequenceOutcomeV4Schema,
} from "@cloudmarkup/schemas";
import { accountingRead } from "./model-commercial-accounting-codec.js";
import { firstSeedCandidateValidationV4 } from "./model-live-seed-candidate-store.js";
import { requireSequenceAuthority as requireAuthority } from "./model-live-sequence-authority-codec.js";
import { sql } from "./sql.js";
type Input = Omit<
  Parameters<typeof firstSeedCandidateValidationV4>[0],
  "operation"
> & {
  readonly operation: { readonly kind: "record" | "recover" };
};
/** A proof of an unused selected final stage, only after actual immutable first
 * validation stopped repair. No provider failure or unknown usage becomes zero.
 * The caller owns current authority and the transaction; recovery is metadata only. */
export async function unusedFinalRepairStageV4(input: Input) {
  const { tx, scope, execution, operation } = input;
  const stage = execution.selection.stages.find(
    (entry) =>
      entry.caseId === execution.stageInput.caseId &&
      entry.stageKey === "repair-2",
  );
  requireAuthority(stage !== undefined);
  const prior = await firstSeedCandidateValidationV4({
    ...input,
    operation: { kind: "recover" },
  });
  const keys = [
    scope.organizationId,
    scope.projectId,
    scope.userId,
    stage.stageId,
  ];
  const existing = (
    await tx.query(
      sql(
        "SELECT *,to_char(observed_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS observed_at_text FROM model_live_repair_unused_stages_v4 WHERE organization_id=$1 AND project_id=$2 AND principal_id=$3 AND stage_id=$4 FOR UPDATE",
        keys,
      ),
    )
  ).rows[0];
  if (
    prior.kind === "missing" ||
    prior.receipt.disposition === "invalid-repairable"
  ) {
    requireAuthority(operation.kind === "recover" && existing === undefined);
    return { kind: "missing" as const };
  }
  const reason =
    prior.receipt.disposition === "valid"
      ? "predecessor-valid"
      : "predecessor-nonrepairable";
  const project = (observedAt: string) => {
    requireAuthority(
      Date.parse(observedAt) >= Date.parse(prior.receipt.issuedAt) &&
        Date.parse(observedAt) <= Date.parse(input.now),
    );
    const bound = {
      selectionId: execution.selection.selectionId,
      selectionDigest: execution.selection.selectionDigest,
      planDigest: execution.plan.planDigest,
      ...stage,
    };
    const proof = {
      contractVersion: 1,
      recordKind: "model-live-final-stage-unused-proof",
      scope: execution.plan.definition.scope,
      ...bound,
      predecessorValidationReceiptDigest: prior.receipt.receiptDigest,
      predecessorOutcomeDigest: prior.outcome.outcomeDigest,
      reason,
      observedAt,
    };
    const body = {
      contractVersion: 4,
      parentSequenceContractVersion: 3,
      recordKind: "model-live-sequence-outcome",
      ...bound,
      status: "not-dispatched",
      reason,
      observedAt,
      noDispatchReceiptDigest: digest(proof),
    };
    return {
      proof,
      outcome: modelLiveSequenceOutcomeV4Schema.parse({
        ...body,
        outcomeDigest: digest(body),
      }),
    };
  };
  if (existing !== undefined) {
    requireAuthority(typeof existing["observed_at_text"] === "string");
    const restored = project(existing["observed_at_text"]);
    requireAuthority(
      existing["organization_id"] === scope.organizationId &&
        existing["project_id"] === scope.projectId &&
        existing["principal_id"] === scope.userId &&
        existing["stage_id"] === stage.stageId &&
        existing["invocation_id"] === stage.invocationId &&
        existing["predecessor_stage_id"] === execution.stageInput.stageId &&
        existing["proof_sha256"] === digest(restored.proof).slice(7) &&
        existing["outcome_sha256"] ===
          restored.outcome.outcomeDigest.slice(7) &&
        digest(accountingRead(existing["proof_record"])) ===
          digest(restored.proof) &&
        digest(accountingRead(existing["outcome_record"])) ===
          digest(restored.outcome),
    );
    return {
      kind:
        operation.kind === "record"
          ? ("replayed" as const)
          : ("found" as const),
      ...restored,
    };
  }
  if (operation.kind === "recover") return { kind: "missing" as const };
  const recorded = project(input.now);
  const inserted = await tx.query(
    sql(
      "INSERT INTO model_live_repair_unused_stages_v4 (organization_id,project_id,principal_id,stage_id,invocation_id,predecessor_stage_id,proof_sha256,proof_record,outcome_sha256,outcome_record,observed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10::jsonb,$11::timestamptz)",
      [
        ...keys,
        stage.invocationId,
        execution.stageInput.stageId,
        digest(recorded.proof).slice(7),
        JSON.stringify(recorded.proof),
        recorded.outcome.outcomeDigest.slice(7),
        JSON.stringify(recorded.outcome),
        input.now,
      ],
    ),
  );
  requireAuthority(inserted.rowCount === 1);
  return { kind: "recorded" as const, ...recorded };
}
