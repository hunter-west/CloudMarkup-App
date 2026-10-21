import {
  digestCanonicalValue,
  modelLiveSequenceInputV3Schema,
  utcTimestampSchema,
} from "@cloudmarkup/schemas";
import {
  ModelLiveSequenceAuthorityError,
  requireSequenceAuthority as requireAuthority,
} from "./model-live-sequence-authority-codec.js";
import type { prepareModelLiveRepairSuccessorStageInputV4 } from "./model-live-repair-successor-stage-input-codec.js";
import { sql, type SqlExecutor, type SqlRow } from "./sql.js";

type Prepared = ReturnType<typeof prepareModelLiveRepairSuccessorStageInputV4>;

/** Restores exact metadata only after the private host reconstructs and verifies
 * the actual predecessor. This does not restore RAM or dispatch authority. */
export function parseModelLiveRepairSuccessorInputRowV4(
  row: SqlRow,
  prepared: Prepared,
  observedAt: string,
) {
  try {
    const raw = row["input_record"];
    const encoded = typeof raw === "string" ? raw : JSON.stringify(raw);
    requireAuthority(
      typeof encoded === "string" && Buffer.byteLength(encoded, "utf8") <= 8192,
    );
    const record = modelLiveSequenceInputV3Schema.parse(
      JSON.parse(encoded) as unknown,
    );
    const { inputBindingDigest, issuedAt, ...fields } = record;
    requireAuthority(
      record.stageKey === "repair-2" &&
        record.predecessor.kind === "stage" &&
        digestCanonicalValue(fields) ===
          digestCanonicalValue(prepared.fields) &&
        row["organization_id"] === prepared.scope.organizationId &&
        row["project_id"] === prepared.scope.projectId &&
        row["principal_id"] === prepared.scope.userId &&
        row["operator_principal_id"] ===
          prepared.plan.approval.operatorUserId &&
        row["plan_sha256"] === record.planDigest.slice(7) &&
        row["selection_id"] === record.selectionId &&
        row["stage_id"] === record.stageId &&
        row["invocation_id"] === record.invocationId &&
        row["input_sha256"] === inputBindingDigest.slice(7) &&
        row["model_configuration_sha256"] ===
          prepared.configurationDigest.slice(7) &&
        row["seed_configuration_sha256"] ===
          prepared.seedConfigurationDigest.slice(7) &&
        Date.parse(utcTimestampSchema.parse(row["issued_at_text"])) ===
          Date.parse(issuedAt) &&
        Date.parse(issuedAt) >= Date.parse(prepared.selection.issuedAt) &&
        Date.parse(issuedAt) >= Date.parse(prepared.predecessorObservedAt) &&
        Date.parse(issuedAt) < Date.parse(prepared.plan.expiresAt) &&
        Date.parse(issuedAt) <=
          Date.parse(utcTimestampSchema.parse(observedAt)),
    );
    return record;
  } catch {
    throw new ModelLiveSequenceAuthorityError();
  }
}

/** Called only inside the authenticated journal's transaction, with current
 * runtime, commercial and actual predecessor checks before and after issuance. */
export async function issueModelLiveRepairSuccessorInputV4(input: {
  readonly tx: SqlExecutor;
  readonly prepared: Prepared;
  readonly now: string;
}) {
  const { tx, prepared, now } = input;
  const scope = prepared.plan.definition.scope;
  const keys = [
    scope.organizationId,
    scope.projectId,
    scope.userId,
    prepared.stage.stageId,
  ];
  const read = () =>
    tx.query(
      sql(
        "SELECT *,to_char(issued_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS issued_at_text FROM model_live_repair_successor_inputs_v4 WHERE organization_id=$1 AND project_id=$2 AND principal_id=$3 AND stage_id=$4",
        keys,
      ),
    );
  const prior = await tx.query(
    sql(
      "SELECT 1 FROM model_live_invocations WHERE organization_id=$1 AND project_id=$2 AND principal_id=$3 AND invocation_id=$4 LIMIT 1",
      [
        scope.organizationId,
        scope.projectId,
        scope.userId,
        prepared.stage.invocationId,
      ],
    ),
  );
  requireAuthority(prior.rowCount === 0);
  const found = await read();
  requireAuthority(found.rowCount <= 1);
  if (found.rows[0])
    return {
      kind: "existing" as const,
      record: parseModelLiveRepairSuccessorInputRowV4(
        found.rows[0],
        prepared,
        now,
      ),
    };
  const body = { ...prepared.fields, issuedAt: now };
  const record = modelLiveSequenceInputV3Schema.parse({
    ...body,
    inputBindingDigest: digestCanonicalValue(body),
  });
  const encoded = JSON.stringify(record);
  requireAuthority(Buffer.byteLength(encoded, "utf8") <= 8192);
  await tx.query(
    sql(
      "INSERT INTO model_live_repair_successor_inputs_v4 (organization_id,project_id,principal_id,operator_principal_id,plan_sha256,selection_id,stage_id,invocation_id,input_sha256,model_configuration_sha256,seed_configuration_sha256,input_record,issued_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::timestamptz)",
      [
        scope.organizationId,
        scope.projectId,
        scope.userId,
        prepared.plan.approval.operatorUserId,
        record.planDigest.slice(7),
        record.selectionId,
        record.stageId,
        record.invocationId,
        record.inputBindingDigest.slice(7),
        prepared.configurationDigest.slice(7),
        prepared.seedConfigurationDigest.slice(7),
        encoded,
        now,
      ],
    ),
  );
  const row = (await read()).rows[0];
  requireAuthority(row !== undefined);
  const issued = parseModelLiveRepairSuccessorInputRowV4(row, prepared, now);
  requireAuthority(
    digestCanonicalValue(issued) === digestCanonicalValue(record),
  );
  return {
    kind: "issued" as const,
    record: issued,
    invocation: prepared.invocation,
    route: prepared.route,
    requested: prepared.requested,
    configurationDigest: prepared.configurationDigest,
  };
}
