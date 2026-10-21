import { accountingRead } from "./model-commercial-accounting-codec.js";
import { sql } from "./sql.js";
import {
  digestStructuredValue,
  sha256Text,
  projectModelCommercialRecoveredInvocationRecordV1,
  type ModelCommercialInvocationAttemptV1,
} from "@cloudmarkup/model-gateway";
import { firstSeedUsageObservationV4 } from "./model-live-seed-usage-observation-store.js";
import { firstSeedCandidateValidationV4 } from "./model-live-seed-candidate-store.js";
import { finalRepairUsageObservationV4 } from "./model-live-repair-successor-usage-store.js";
import { finalRepairCandidateValidationV4 } from "./model-live-repair-successor-candidate-store.js";
import { unusedFinalRepairStageV4 } from "./model-live-repair-unused-stage-store.js";
import { readSeedDispatchCanonicalV4 } from "./model-live-seed-dispatch-store.js";
import { requireSequenceAuthority as requireAuthority } from "./model-live-sequence-authority-codec.js";

type Input = Omit<
  Parameters<typeof firstSeedCandidateValidationV4>[0],
  "operation"
>;
/** Reconstructs only a completely recorded evaluation's invocation metadata.
 * A recorded invalid candidate is evaluation evidence, never a quality pass.
 * Missing usage or validation stays pending; this performs no accounting write,
 * restores no source bytes and grants neither settlement nor another send. */
export async function recoverValidatedRepairResultV4(input: Input) {
  const recover = { ...input, operation: { kind: "recover" as const } };
  const first = await firstSeedCandidateValidationV4(recover);
  if (first.kind === "missing") return { kind: "pending" as const };
  const known = await firstSeedUsageObservationV4(recover);
  requireAuthority(known.kind !== "missing");
  const attempts: ModelCommercialInvocationAttemptV1[] = [known.attempt];
  const outcomes = [first.outcome];
  let observedAt: string;
  if (first.receipt.disposition === "invalid-repairable") {
    const final = await finalRepairCandidateValidationV4(recover);
    if (final.kind === "missing") return { kind: "pending" as const };
    const finalKnown = await finalRepairUsageObservationV4(recover);
    requireAuthority(finalKnown.kind !== "missing");
    attempts.push(finalKnown.attempt);
    outcomes.push(final.outcome);
    observedAt = final.outcome.observedAt;
  } else {
    const unused = await unusedFinalRepairStageV4(recover);
    if (unused.kind === "missing") return { kind: "pending" as const };
    outcomes.push(unused.outcome);
    observedAt = unused.outcome.observedAt;
  }
  const workflow = await readSeedDispatchCanonicalV4({
    ...input,
    requireActive: false,
  });
  const resultId =
    "result_" +
    sha256Text(
      [
        "model-live-validated-repair-result-v4",
        workflow.fingerprint,
        ...outcomes.map((outcome) => outcome.outcomeDigest),
        ...attempts.map((attempt) => digestStructuredValue(attempt)),
      ].join(":"),
    ).slice(7, 55);
  const record = projectModelCommercialRecoveredInvocationRecordV1(
    workflow,
    {
      attempts,
      completedAt: observedAt,
      failureCategory: null,
      resultId,
      status: "completed",
      usefulOutputDelivered: true,
    },
    observedAt,
  );
  requireAuthority(record.invocationReceipt !== null);
  const stored = await input.tx.query(
    sql(
      "SELECT cloudmarkup_recorded_repair_receipt_v4($1,$2,$3,$4,$5,$6) AS receipt",
      [
        input.scope.organizationId,
        input.scope.projectId,
        input.scope.userId,
        input.scope.tenantScopeDigest.slice(7),
        workflow.request.multiCallWorkflowId,
        workflow.revision,
      ],
    ),
  );
  requireAuthority(
    stored.rowCount === 1 &&
      digestStructuredValue(accountingRead(stored.rows[0]?.["receipt"])) ===
        digestStructuredValue(record.invocationReceipt),
  );

  return {
    kind: "found" as const,
    accounting: "not-projected" as const,
    receipt: record.invocationReceipt,
    outcomes,
  };
}
