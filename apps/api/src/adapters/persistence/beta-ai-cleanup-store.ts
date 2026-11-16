import { createHash } from "node:crypto";
import {
  checkpoint,
  change,
  type CleanupChange,
  type CleanupCheckpoint,
  type CleanupCheckpointStore,
  type CleanupIdentity,
  type CleanupReceipt,
} from "../../application/beta-ai-cleanup-owner.js";
import {
  CLEANUP_RETENTION_POLICY,
  cleanupRetentionEligibility,
} from "../../application/beta-ai-cleanup-retention.js";
import {
  betaAiCostEvidenceQuery,
  readBetaAiLedgerEvidence,
} from "./beta-ai-cost-evidence.js";
import { projectBetaAiInternalCost } from "./beta-ai-internal-cost-reader.js";
import { sql, type SqlDatabase, type SqlExecutor } from "./sql.js";

const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const parsed = (value: unknown): unknown =>
  typeof value === "string" ? JSON.parse(value) : value;
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
const stamp = (value: unknown) => {
  const parsed =
    value instanceof Date
      ? value
      : typeof value === "string"
        ? new Date(value)
        : null;
  return parsed && Number.isFinite(parsed.getTime())
    ? parsed.toISOString()
    : null;
};
const conflict = () =>
  Error("Cleanup checkpoint identity or generation conflicts.");

/** This port is supplied by the existing qualified restore owner, never an HTTP
 * parameter or a restored database row alone. No default admission is provided. */
export interface CleanupRestoreAdmission {
  currentEpoch(organizationId: string): Promise<string>;
}
export async function lockCleanupControl(
  tx: SqlExecutor,
  organizationId: string,
  expectedEpoch: string,
) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(expectedEpoch))
    throw Error("Cleanup restore admission is required.");
  await tx.query(
    sql("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      "beta-ai-cleanup-v1:" + organizationId,
    ]),
  );
  const row = (
    await tx.query(
      sql(
        "SELECT organization_id,restore_epoch,resume_allowed,held FROM beta_ai_cleanup_control WHERE organization_id=$1",
        [organizationId],
      ),
    )
  ).rows[0];
  if (
    row?.["organization_id"] !== organizationId ||
    row["restore_epoch"] !== expectedEpoch ||
    row["resume_allowed"] !== true
  )
    throw Error("Cleanup restore admission is required.");
  return { epoch: expectedEpoch, held: row["held"] !== false };
}

/** Verify the canonical surviving copy, not the optimistic cleanup outcome.
 * No usage, pricing, financial record or unknown count is repaired here. */
export async function readCleanupCompletionProof(
  tx: SqlExecutor,
  identity: CleanupIdentity,
): Promise<string | null> {
  // JSONB key order is not stable. Hash a canonical field order on every read.
  identity = {
    organizationId: identity.organizationId,
    reservationId: identity.reservationId,
    projectId: identity.projectId,
    jobId: identity.jobId,
    purpose: identity.purpose,
    requestSha256: identity.requestSha256,
  };
  const rows = await tx.query(
    sql(
      `${betaAiCostEvidenceQuery}
    WHERE i.organization_id=$1 AND i.reservation_id=$2 FOR SHARE OF i,r`,
      [identity.organizationId, identity.reservationId],
    ),
  );
  const row = rows.rows[0];
  if (
    rows.rows.length !== 1 ||
    row?.["organization_id"] !== identity.organizationId ||
    row["reservation_id"] !== identity.reservationId ||
    row["project_id"] !== identity.projectId ||
    row["job_id"] !== identity.jobId ||
    row["purpose"] !== identity.purpose ||
    row["request_sha256"] !== identity.requestSha256 ||
    row["state"] !== "released"
  )
    return null;
  const ledger = await readBetaAiLedgerEvidence(
    tx,
    identity.organizationId,
    identity.reservationId,
  );
  const record = projectBetaAiInternalCost(
    row,
    ledger.rows.slice(0, 25),
    ledger.rows.length > 25,
  );
  if (
    record.financialStatus !== "released" ||
    record.cleanupPending ||
    !["known", "not-incurred"].includes(record.accountingStatus)
  )
    return null;
  // Retained legacy fields must never become an expiring last copy. The normal
  // release path preserves an observation before clearing those fields.
  if (
    record.accountingStatus === "known" &&
    !record.evidenceSources.some(
      (s) => s === "observation" || s.startsWith("ledger:"),
    )
  )
    return null;
  if (
    !ledger.rows.some(
      (r) =>
        r["ledger_entry_id"] === "ledger.release." + identity.reservationId &&
        r["entry_kind"] === "release",
    )
  )
    return null;
  return hash({ identity, record });
}

/** Durable organization checkpoint/receipt adapter. The supplied database must
 * enforce current session, organization and restore admission on every SQL
 * transaction. Immutable receipts and active controls are NEVER retired here. */
export class PostgresBetaAiCleanupStore implements CleanupCheckpointStore {
  readonly database: SqlDatabase;
  readonly organizationId: string;
  readonly admission: CleanupRestoreAdmission;
  constructor(
    database: SqlDatabase,
    organizationId: string,
    admission: CleanupRestoreAdmission,
  ) {
    this.database = database;
    this.organizationId = organizationId;
    this.admission = admission;
  }
  #scope(organizationId: string) {
    if (organizationId !== this.organizationId) throw conflict();
  }
  async #control(tx: SqlExecutor) {
    return lockCleanupControl(
      tx,
      this.organizationId,
      await this.admission.currentEpoch(this.organizationId),
    );
  }
  async #checkpoint(tx: SqlExecutor, epoch: string) {
    const rows = await tx.query(
      sql(
        "SELECT snapshot FROM beta_ai_cleanup_checkpoints WHERE organization_id=$1",
        [this.organizationId],
      ),
    );
    return checkpoint(
      rows.rows.length === 0
        ? null
        : (parsed(rows.rows[0]?.["snapshot"]) as CleanupCheckpoint),
      this.organizationId,
      epoch,
    );
  }
  async load(organizationId: string) {
    this.#scope(organizationId);
    return this.database.transaction(async (tx) => {
      const control = await this.#control(tx);
      return {
        organizationId,
        restoreEpoch: control.epoch,
        resumeAllowed: true,
        retentionHolds: control.held ? ["organization-hold"] : [],
        checkpoint: await this.#checkpoint(tx, control.epoch),
      };
    });
  }
  async #receipt(
    tx: SqlExecutor,
    operationId: string,
    epoch: string,
  ): Promise<CleanupReceipt | null> {
    const row = (
      await tx.query(
        sql(
          "SELECT payload_sha256,checkpoint,verified_completed_at FROM beta_ai_cleanup_operations WHERE organization_id=$1 AND restore_epoch=$2 AND operation_id=$3",
          [this.organizationId, epoch, operationId],
        ),
      )
    ).rows[0];
    if (!row) return null;
    return {
      organizationId: this.organizationId,
      operationId,
      payloadSha256: String(row["payload_sha256"]),
      checkpoint: checkpoint(
        parsed(row["checkpoint"]) as CleanupCheckpoint,
        this.organizationId,
        epoch,
      ),
      verifiedCompletedAt: stamp(row["verified_completed_at"]),
    };
  }
  async receipt(organizationId: string, operationId: string) {
    this.#scope(organizationId);
    return this.database.transaction(async (tx) => {
      const control = await this.#control(tx);
      return this.#receipt(tx, operationId, control.epoch);
    });
  }
  async commit(input: CleanupChange): Promise<CleanupReceipt> {
    // Freeze caller-owned data across awaits. The store re-derives the operation
    // identity and transition; a supplied digest or all-known flag is no proof.
    const value = structuredClone(input);
    this.#scope(value.organizationId);
    return this.database.transaction(async (tx) => {
      const control = await this.#control(tx);
      if (value.next.restoreEpoch !== control.epoch) throw conflict();
      const nextFromInput = checkpoint(
        value.next,
        this.organizationId,
        control.epoch,
      );
      const selfBound = change(
        value.kind,
        { ...nextFromInput, generation: value.expectedGeneration },
        nextFromInput,
        value.outcomes,
      );
      if (
        selfBound.operationId !== value.operationId ||
        selfBound.payloadSha256 !== value.payloadSha256
      )
        throw conflict();
      const prior = await this.#receipt(tx, value.operationId, control.epoch);
      if (prior) {
        if (
          prior.payloadSha256 !== value.payloadSha256 ||
          !same(
            prior.checkpoint,
            checkpoint(value.next, this.organizationId, control.epoch),
          )
        )
          throw conflict();
        return prior;
      }
      const current = await this.#checkpoint(tx, control.epoch);
      const next = checkpoint(value.next, this.organizationId, control.epoch);
      if (
        value.expectedGeneration !== current.generation ||
        next.generation !== (BigInt(current.generation) + 1n).toString()
      )
        throw conflict();
      if (value.kind === "prepare") {
        if (
          current.pending !== null ||
          next.pending === null ||
          value.outcomes.length !== 0 ||
          next.sweep !== current.sweep ||
          next.cursor !== current.cursor
        )
          throw conflict();
        const { pageId, ...page } = next.pending;
        if (
          pageId !==
          hash({
            organizationId: this.organizationId,
            sweep: current.sweep,
            cursor: current.cursor,
            page,
          })
        )
          throw conflict();
      } else {
        if (
          current.pending === null ||
          next.pending !== null ||
          next.cursor !== current.pending.nextCursor ||
          next.sweep !==
            (
              BigInt(current.sweep) + (next.cursor === null ? 1n : 0n)
            ).toString() ||
          value.outcomes.length !== current.pending.identities.length ||
          value.outcomes.some((outcome, index) => {
            const id = current.pending?.identities[index];
            return (
              !id ||
              Object.entries(id).some(
                ([k, v]) => outcome[k as keyof typeof outcome] !== v,
              ) ||
              !["released", "pending", "conflict"].includes(
                outcome.financial,
              ) ||
              !["complete", "pending"].includes(outcome.cleanup) ||
              !["known", "not-incurred", "unresolved", "conflict"].includes(
                outcome.accounting,
              )
            );
          })
        )
          throw conflict();
      }
      const expected = change(value.kind, current, next, value.outcomes);
      if (
        expected.operationId !== value.operationId ||
        expected.payloadSha256 !== value.payloadSha256
      )
        throw conflict();
      const proofs: (string | null)[] = [];
      if (value.kind === "complete") {
        for (const outcome of value.outcomes) {
          const identity = current.pending?.identities[proofs.length];
          if (!identity) throw conflict();
          const proof =
            outcome.financial === "released" && outcome.cleanup === "complete"
              ? await readCleanupCompletionProof(tx, identity)
              : null;
          proofs.push(proof);
          const outcomeWrite = await tx.query(
            sql(
              `INSERT INTO beta_ai_cleanup_outcomes(organization_id,reservation_id,identity,financial_status,cleanup_status,accounting_status,verification_sha256,restore_epoch)
            VALUES($1,$2,$3::jsonb,$4,$5,$6,$7,$8)
            ON CONFLICT(organization_id,reservation_id) DO UPDATE SET financial_status=EXCLUDED.financial_status,
              cleanup_status=EXCLUDED.cleanup_status,accounting_status=EXCLUDED.accounting_status,verification_sha256=EXCLUDED.verification_sha256,restore_epoch=EXCLUDED.restore_epoch
            WHERE beta_ai_cleanup_outcomes.identity=EXCLUDED.identity`,
              [
                this.organizationId,
                identity.reservationId,
                JSON.stringify(identity),
                outcome.financial,
                outcome.cleanup,
                outcome.accounting,
                proof,
                control.epoch,
              ],
            ),
          );
          if (outcomeWrite.rowCount !== 1) throw conflict();
        }
      }
      const proof =
        value.kind === "complete" && proofs.every((p) => p !== null)
          ? hash(proofs)
          : null;
      // The trigger assigns a completion clock only with a verified proof; the
      // runtime cannot submit or update that timestamp. Replay returns this row.
      await tx.query(
        sql(
          `INSERT INTO beta_ai_cleanup_operations(organization_id,restore_epoch,operation_id,payload_sha256,kind,checkpoint,identities,verification_sha256)
        VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8)`,
          [
            this.organizationId,
            control.epoch,
            value.operationId,
            value.payloadSha256,
            value.kind,
            JSON.stringify(next),
            JSON.stringify(current.pending?.identities ?? []),
            proof,
          ],
        ),
      );
      if (value.kind === "complete")
        await tx.query(
          sql(
            "INSERT INTO beta_ai_cleanup_diagnostics(organization_id,restore_epoch,operation_id,details) VALUES($1,$2,$3,$4::jsonb)",
            [
              this.organizationId,
              control.epoch,
              value.operationId,
              JSON.stringify(value.outcomes),
            ],
          ),
        );
      const saved = await tx.query(
        sql(
          `INSERT INTO beta_ai_cleanup_checkpoints(organization_id,restore_epoch,generation,snapshot)
        VALUES($1,$2,$3::bigint,$4::jsonb) ON CONFLICT(organization_id) DO UPDATE SET generation=EXCLUDED.generation,snapshot=EXCLUDED.snapshot
        WHERE beta_ai_cleanup_checkpoints.restore_epoch=EXCLUDED.restore_epoch AND beta_ai_cleanup_checkpoints.generation=$5::bigint`,
          [
            this.organizationId,
            control.epoch,
            next.generation,
            JSON.stringify(next),
            current.generation,
          ],
        ),
      );
      if (saved.rowCount !== 1) throw conflict();
      const receipt = await this.#receipt(tx, value.operationId, control.epoch);
      if (!receipt) throw Error("Cleanup receipt unavailable.");
      return receipt;
    });
  }
  async #eligibility(
    tx: SqlExecutor,
    operationId: string,
    epoch: string,
    held: boolean,
  ) {
    const row = (
      await tx.query(
        sql(
          `SELECT o.identities,o.verification_sha256,o.verified_completed_at,d.details,d.retired_at,
      to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS now
      FROM beta_ai_cleanup_operations o JOIN beta_ai_cleanup_diagnostics d USING(organization_id,restore_epoch,operation_id)
      WHERE o.organization_id=$1 AND o.restore_epoch=$2 AND o.operation_id=$3`,
          [this.organizationId, epoch, operationId],
        ),
      )
    ).rows[0];
    if (!row) throw Error("Cleanup diagnostics unavailable.");
    const current = await this.#checkpoint(tx, epoch);
    const identities = parsed(row["identities"]) as CleanupIdentity[];
    if (!Array.isArray(identities) || identities.length > 25) throw conflict();
    const proofs = [];
    for (const identity of identities) {
      if (identity.organizationId !== this.organizationId) throw conflict();
      proofs.push(await readCleanupCompletionProof(tx, identity));
    }
    const evidence = {
      recordClass: "redundant-page-details",
      policy: CLEANUP_RETENTION_POLICY,
      verifiedCompletedAt: stamp(row["verified_completed_at"]),
      now: String(row["now"]),
      restoreAdmitted: true,
      sameEpoch: true,
      held,
      pending: current.pending !== null,
      dependenciesRetained: true,
      originalProof:
        typeof row["verification_sha256"] === "string"
          ? row["verification_sha256"]
          : null,
      currentProof: proofs.every((p) => p !== null) ? hash(proofs) : null,
    };
    return {
      operationId,
      alreadyRetired: row["retired_at"] != null,
      ...cleanupRetentionEligibility(evidence),
    };
  }
  /** A bounded dry run; no DELETE/UPDATE, customer data or provider requests. */
  async retentionPage(afterOperationId = "") {
    if (afterOperationId !== "" && !/^[a-f0-9]{64}$/u.test(afterOperationId))
      throw conflict();
    return this.database.transaction(async (tx) => {
      const control = await this.#control(tx);
      const rows = await tx.query(
        sql(
          "SELECT operation_id FROM beta_ai_cleanup_diagnostics WHERE organization_id=$1 AND restore_epoch=$2 AND operation_id>$3 ORDER BY operation_id LIMIT 25",
          [this.organizationId, control.epoch, afterOperationId],
        ),
      );
      const records = [];
      for (const row of rows.rows)
        records.push(
          await this.#eligibility(
            tx,
            String(row["operation_id"]),
            control.epoch,
            control.held,
          ),
        );
      return {
        records,
        nextCursor:
          rows.rows.length === 25
            ? String(rows.rows.at(-1)?.["operation_id"])
            : null,
      };
    });
  }
  /** No production caller or privilege exists. A future confirmed retirement
   * action must supply its independent current authority INSIDE this transaction.
   * Only redundant details are removed; the exact receipt/fences survive. */
  async retireDiagnostics(
    operationId: string,
    authorizeRetirement: (
      tx: SqlExecutor,
      organizationId: string,
    ) => Promise<void>,
  ) {
    if (!/^[a-f0-9]{64}$/u.test(operationId)) throw conflict();
    return this.database.transaction(async (tx) => {
      await authorizeRetirement(tx, this.organizationId);
      const control = await this.#control(tx);
      const decision = await this.#eligibility(
        tx,
        operationId,
        control.epoch,
        control.held,
      );
      if (decision.alreadyRetired) return decision;
      if (!decision.eligible) return decision;
      await tx.query(
        sql(
          `UPDATE beta_ai_cleanup_diagnostics SET details=NULL,retired_at=clock_timestamp()
        WHERE organization_id=$1 AND restore_epoch=$2 AND operation_id=$3 AND retired_at IS NULL`,
          [this.organizationId, control.epoch, operationId],
        ),
      );
      // Same transaction acknowledgement is recoverable by the immutable target
      // operation and retained retired_at; a retry never recreates details.
      await authorizeRetirement(tx, this.organizationId);
      return { ...decision, alreadyRetired: true };
    });
  }
}
