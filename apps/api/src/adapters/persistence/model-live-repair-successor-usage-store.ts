import { modelLiveSequenceInputV3Schema } from "@cloudmarkup/schemas";
import { repairUsageObservationV4 } from "./model-live-repair-usage-observation-store.js";
import { firstSeedUsageObservationV4 } from "./model-live-seed-usage-observation-store.js";
import { firstSeedCandidateValidationV4 } from "./model-live-seed-candidate-store.js";
import { accountingRead } from "./model-commercial-accounting-codec.js";
import { requireSequenceAuthority as requireAuthority } from "./model-live-sequence-authority-codec.js";
import { sql } from "./sql.js";

/** Financial truth from an actual issued final input and immutable dispatch.
 * Configuration withdrawal does not erase known usage. This grants neither
 * response acceptance nor another physical request; no candidate RAM is loaded. */
export async function finalRepairUsageObservationV4(
  input: Omit<Parameters<typeof repairUsageObservationV4>[0], "successor">,
) {
  const { tx, scope, execution, accounting, now, operation } = input;
  const stage = await readIssuedFinalRepairInputV4({ tx, scope, execution });
  if (stage === null) {
    requireAuthority(operation.kind === "recover");
    return { kind: "missing" as const };
  }
  const prior = await firstSeedUsageObservationV4({
    tx,
    scope,
    execution,
    accounting,
    now,
    operation: { kind: "recover" },
  });
  const candidate = await firstSeedCandidateValidationV4({
    tx,
    scope,
    execution,
    accounting,
    now,
    operation: { kind: "recover" },
  });
  requireAuthority(prior.kind !== "missing" && candidate.kind !== "missing");
  return repairUsageObservationV4({
    tx,
    scope,
    execution,
    accounting,
    now,
    operation,
    successor: {
      stage,
      predecessor: {
        stage: execution.stageInput,
        attempt: prior.attempt,
        observation: prior.observation,
        receipt: candidate.receipt,
      },
    },
  });
}

/** Exact issued metadata only; no restored content or current send permission. */
export async function readIssuedFinalRepairInputV4(
  input: Pick<
    Parameters<typeof repairUsageObservationV4>[0],
    "tx" | "scope" | "execution"
  >,
) {
  const { tx, scope, execution } = input;
  const selected = execution.selection.stages.find(
    (stage) =>
      stage.caseId === execution.stageInput.caseId &&
      stage.stageKey === "repair-2",
  );
  requireAuthority(selected !== undefined);
  const row = (
    await tx.query(
      sql(
        "SELECT * FROM model_live_repair_successor_inputs_v4 WHERE organization_id=$1 AND project_id=$2 AND principal_id=$3 AND stage_id=$4 FOR SHARE",
        [scope.organizationId, scope.projectId, scope.userId, selected.stageId],
      ),
    )
  ).rows[0];
  if (row === undefined) return null;
  const stage = modelLiveSequenceInputV3Schema.parse(
    accountingRead(row["input_record"]),
  );
  requireAuthority(
    stage.stageKey === "repair-2" &&
      stage.stageId === selected.stageId &&
      stage.invocationId === selected.invocationId &&
      stage.caseDigest === selected.caseDigest &&
      row["input_sha256"] === stage.inputBindingDigest.slice(7) &&
      row["plan_sha256"] === stage.planDigest.slice(7) &&
      row["selection_id"] === stage.selectionId &&
      row["invocation_id"] === stage.invocationId &&
      row["operator_principal_id"] === execution.plan.approval.operatorUserId,
  );
  for (const key of [
    "selectionId",
    "selectionDigest",
    "planDigest",
    "caseId",
    "caseDigest",
    "recipeDigest",
    "authorityTupleDigest",
    "revisionDigest",
    "ownershipDigest",
  ] as const)
    requireAuthority(stage[key] === execution.stageInput[key]);
  return stage;
}
