import {
  digestCanonicalValue as digest,
  modelLiveSequenceOutcomeV4Schema,
} from "@cloudmarkup/schemas";
import type {
  ModelCommercialVerifiedScopeV1,
  ModelLiveSeedRuntimeExecutionInputV4,
} from "@cloudmarkup/model-gateway";
import type { ModelSeedAccountingBinding } from "./model-live-seed-commercial-accounting-codec.js";
import { accountingRead } from "./model-commercial-accounting-codec.js";
import { firstSeedUsageObservationV4 } from "./model-live-seed-usage-observation-store.js";
import {
  modelLiveSeedCandidateReceiptV1Schema,
  projectFirstSeedCandidateOutcomeV4,
  type ModelLiveSeedCandidateReceiptV1,
} from "./model-live-seed-candidate-codec.js";
import { requireSequenceAuthority as requireAuthority } from "./model-live-sequence-authority-codec.js";
import { sql, type SqlExecutor } from "./sql.js";

const same = (a: unknown, b: unknown) => digest(a) === digest(b);
export async function firstSeedCandidateValidationV4(input: {
  readonly tx: SqlExecutor;
  readonly scope: ModelCommercialVerifiedScopeV1;
  readonly execution: ModelLiveSeedRuntimeExecutionInputV4;
  readonly accounting: ModelSeedAccountingBinding;
  readonly now: string;
  readonly operation:
    | { readonly kind: "recover" }
    | {
        readonly kind: "record";
        readonly receipt: ModelLiveSeedCandidateReceiptV1;
      };
}) {
  const { tx, scope, execution, operation } = input;
  const known = await firstSeedUsageObservationV4({
    ...input,
    operation: { kind: "recover" },
  });
  if (known.kind === "missing") {
    requireAuthority(operation.kind === "recover");
    return { kind: "missing" as const };
  }
  const keys = [
    scope.organizationId,
    scope.projectId,
    scope.userId,
    execution.stageInput.stageId,
  ];
  const read = async () =>
    (
      await tx.query(
        sql(
          "SELECT * FROM model_live_sequence_candidate_validations WHERE organization_id=$1 AND project_id=$2 AND principal_id=$3 AND stage_id=$4 FOR UPDATE",
          keys,
        ),
      )
    ).rows[0];
  const restore = (row: NonNullable<Awaited<ReturnType<typeof read>>>) => {
    const receipt = modelLiveSeedCandidateReceiptV1Schema.parse(
      accountingRead(row["receipt_record"]),
    );
    const outcome = projectFirstSeedCandidateOutcomeV4(
      execution.stageInput,
      known.observation,
      receipt,
    );
    requireAuthority(
      row["organization_id"] === scope.organizationId &&
        row["project_id"] === scope.projectId &&
        row["principal_id"] === scope.userId &&
        row["stage_id"] === execution.stageInput.stageId &&
        same(receipt.scope, execution.plan.definition.scope) &&
        receipt.scope.organizationId === scope.organizationId &&
        receipt.scope.projectId === scope.projectId &&
        receipt.scope.userId === scope.userId &&
        row["invocation_id"] === receipt.invocationId &&
        row["receipt_id"] === receipt.receiptId &&
        row["receipt_sha256"] === receipt.receiptDigest.slice(7) &&
        row["outcome_sha256"] === outcome.outcomeDigest.slice(7) &&
        same(
          modelLiveSequenceOutcomeV4Schema.parse(
            accountingRead(row["outcome_record"]),
          ),
          outcome,
        ) &&
        receipt.normalizedUsageDigest === digest(known.usage) &&
        known.usage.result === "succeeded" &&
        Date.parse(receipt.startedAt) >= Date.parse(known.usage.completedAt) &&
        Date.parse(receipt.issuedAt) <= Date.parse(input.now),
    );
    return { receipt, outcome };
  };
  const existing = await read();
  if (existing !== undefined) {
    const restored = restore(existing);
    if (operation.kind === "record") {
      const candidate = modelLiveSeedCandidateReceiptV1Schema.parse(
        operation.receipt,
      );
      // Racing actual validations may have different times/report digests. Their
      // content, lineage, configuration and disposition must still be identical.
      for (const key of [
        "scope",
        "stageId",
        "invocationId",
        "inputBindingDigest",
        "seedReceiptDigest",
        "commercialAttemptObservationDigest",
        "normalizedUsageDigest",
        "providerResultDigest",
        "configurationDigest",
        "lineage",
        "disposition",
        "observedDefect",
      ] as const)
        requireAuthority(same(restored.receipt[key], candidate[key]));
      requireAuthority(
        restored.receipt.bindings.sourceTreeDigest ===
          candidate.bindings.sourceTreeDigest,
      );
    }
    return {
      kind:
        operation.kind === "record"
          ? ("replayed" as const)
          : ("found" as const),
      ...restored,
    };
  }
  if (operation.kind === "recover") return { kind: "missing" as const };
  const receipt = modelLiveSeedCandidateReceiptV1Schema.parse(
    operation.receipt,
  );
  const outcome = projectFirstSeedCandidateOutcomeV4(
    execution.stageInput,
    known.observation,
    receipt,
  );
  const row = {
    organization_id: scope.organizationId,
    project_id: scope.projectId,
    principal_id: scope.userId,
    stage_id: execution.stageInput.stageId,
    invocation_id: receipt.invocationId,
    receipt_id: receipt.receiptId,
    receipt_sha256: receipt.receiptDigest.slice(7),
    outcome_sha256: outcome.outcomeDigest.slice(7),
    receipt_record: receipt,
    outcome_record: outcome,
  };
  restore(row);
  const inserted = await tx.query(
    sql(
      `INSERT INTO model_live_sequence_candidate_validations
    (organization_id,project_id,principal_id,stage_id,invocation_id,receipt_id,receipt_sha256,receipt_record,outcome_sha256,outcome_record)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10::jsonb)`,
      [
        ...keys,
        receipt.invocationId,
        receipt.receiptId,
        receipt.receiptDigest.slice(7),
        JSON.stringify(receipt),
        outcome.outcomeDigest.slice(7),
        JSON.stringify(outcome),
      ],
    ),
  );
  requireAuthority(inserted.rowCount === 1);
  return { kind: "recorded" as const, receipt, outcome };
}
