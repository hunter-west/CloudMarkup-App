import { digestStructuredValue as digest } from "@cloudmarkup/model-gateway";
import {
  modelLiveSequenceOutcomeV4Schema,
  type ModelLiveSequenceOutcomeV4,
} from "@cloudmarkup/schemas";
import { recoverValidatedRepairResultV4 } from "./model-live-repair-result-recovery.js";
import { firstSeedUsageObservationV4 } from "./model-live-seed-usage-observation-store.js";
import { firstSeedCandidateValidationV4 } from "./model-live-seed-candidate-store.js";
import {
  finalRepairUsageObservationV4,
  readIssuedFinalRepairInputV4,
} from "./model-live-repair-successor-usage-store.js";
import { finalRepairCandidateValidationV4 } from "./model-live-repair-successor-candidate-store.js";
import { readSeedDispatchCanonicalV4 } from "./model-live-seed-dispatch-store.js";
import { terminalProjection } from "./model-commercial-terminal-codec.js";
import { accountingRead } from "./model-commercial-accounting-codec.js";
import { requireSequenceAuthority as requireAuthority } from "./model-live-sequence-authority-codec.js";
import { sql } from "./sql.js";

type Input = Parameters<typeof recoverValidatedRepairResultV4>[0];
type Known = Awaited<ReturnType<typeof firstSeedUsageObservationV4>>;
type Stage = Input["execution"]["selection"]["stages"][number];
/** Read-only stage completion from exact SQL-verified terminal evidence.
 * Missing native validation never becomes a quality pass. Lost candidate RAM
 * remains an unknown quality result even when known usage can be released. */
export async function recoverRecordedRepairCaseV4(input: Input) {
  const validated = await recoverValidatedRepairResultV4(input);
  if (validated.kind === "found") return validated;
  const workflow = await readSeedDispatchCanonicalV4({
    ...input,
    requireActive: false,
  });
  const result = await input.tx.query(
    sql(
      "SELECT COALESCE(cloudmarkup_failed_repair_receipt_v4($1,$2,$3,$4,$5,$6),cloudmarkup_repair_expiry_receipt_v4($1,$2,$3,$4,$5,$6)) AS receipt",
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
  requireAuthority(result.rowCount === 1);
  const receipt = accountingRead(result.rows[0]?.["receipt"]);
  if (receipt === null) return { kind: "pending" as const };
  const projection = terminalProjection(receipt, workflow, input.scope, true);
  requireAuthority(
    projection.outcome.kind === "release" &&
      projection.record.invocationReceipt !== null,
  );
  const verified = projection.record.invocationReceipt;
  const recover = { ...input, operation: { kind: "recover" as const } };
  const firstKnown = await firstSeedUsageObservationV4(recover);
  const firstValidation = await firstSeedCandidateValidationV4(recover);
  const finalInput = await readIssuedFinalRepairInputV4(input);
  const finalKnown = await finalRepairUsageObservationV4(recover);
  const finalValidation = await finalRepairCandidateValidationV4(recover);
  const firstStage = input.execution.selection.stages.find(
    (s) =>
      s.caseId === input.execution.stageInput.caseId &&
      s.stageKey === "repair-1",
  );
  const finalStage = input.execution.selection.stages.find(
    (s) =>
      s.caseId === input.execution.stageInput.caseId &&
      s.stageKey === "repair-2",
  );
  requireAuthority(firstStage !== undefined && finalStage !== undefined);
  const bound = (stage: Stage) => ({
    contractVersion: 4,
    parentSequenceContractVersion: 3,
    recordKind: "model-live-sequence-outcome",
    selectionId: input.execution.selection.selectionId,
    selectionDigest: input.execution.selection.selectionDigest,
    planDigest: input.execution.plan.planDigest,
    ...stage,
    observedAt: verified.receivedAt,
  });
  const parse = (body: Record<string, unknown>) =>
    modelLiveSequenceOutcomeV4Schema.parse({
      ...body,
      outcomeDigest: digest(body),
    });
  const noDispatch = (
    stage: Stage,
    reason: Extract<
      ModelLiveSequenceOutcomeV4,
      { status: "not-dispatched" }
    >["reason"],
  ) =>
    parse({
      ...bound(stage),
      status: "not-dispatched",
      reason,
      noDispatchReceiptDigest: digest(verified),
    });
  const dispatched = (
    stage: Stage,
    known: Exclude<Known, { kind: "missing" }>,
  ) => {
    const binding = {
      ...bound(stage),
      inputBindingDigest: known.observation.inputBindingDigest,
      dispatchDigest: known.observation.dispatchDigest,
    };
    return known.usage.result === "succeeded"
      ? parse({ ...binding, status: "dispatch-unknown", reason: "ram-lost" })
      : parse({
          ...binding,
          status: "provider-failed",
          failure:
            known.usage.result === "canceled"
              ? "cancelled-after-dispatch"
              : "rejected",
          normalizedUsageDigest: known.observation.normalizedUsageDigest,
          commercialAttemptObservationDigest:
            known.observation.observationDigest,
        });
  };
  const first =
    firstValidation.kind !== "missing"
      ? firstValidation.outcome
      : firstKnown.kind === "missing"
        ? noDispatch(firstStage, "current-authority-denied")
        : dispatched(firstStage, firstKnown);
  let final: ModelLiveSequenceOutcomeV4;
  if (finalValidation.kind !== "missing") final = finalValidation.outcome;
  else if (finalKnown.kind !== "missing")
    final = dispatched(finalStage, finalKnown);
  else {
    const reason =
      first.status === "not-dispatched"
        ? "predecessor-not-dispatched"
        : first.status === "provider-failed"
          ? "predecessor-provider-failed"
          : first.status === "dispatch-unknown"
            ? "predecessor-unknown"
            : first.validation.status === "valid"
              ? "predecessor-valid"
              : !first.validation.repairable
                ? "predecessor-nonrepairable"
                : "current-authority-denied";
    if (reason !== "current-authority-denied")
      requireAuthority(finalInput === null);
    final = noDispatch(finalStage, reason);
  }
  requireAuthority(
    verified.result.attempts.length ===
      (firstKnown.kind === "missing" ? 0 : 1) +
        (finalKnown.kind === "missing" ? 0 : 1),
  );
  return {
    kind: "found" as const,
    accounting: "not-projected" as const,
    receipt: verified,
    outcomes: [first, final],
  };
}
