import { randomUUID } from "node:crypto";

import {
  digestStructuredValue,
  type ModelCommercialVerifiedScopeV1,
  type ModelCommercialWorkflowExecutionLeaseV1,
  type ModelCommercialWorkflowRecordV1,
  type ModelCommercialWorkflowStore,
} from "@cloudmarkup/model-gateway";

import {
  assertWorkflowTransition,
  parseWorkflowRecord,
  parseWorkflowRequest,
  parseWorkflowScope,
  workflowFailure,
  workflowIdSchema,
  workflowInstantSchema,
  workflowJson,
  workflowLeaseSchema,
  workflowSame,
} from "./model-commercial-workflow-codec.js";
import {
  sql,
  type SqlDatabase,
  type SqlExecutor,
  type SqlValue,
} from "./sql.js";

interface LoadedWorkflow {
  readonly record: ModelCommercialWorkflowRecordV1;
  readonly lease: ModelCommercialWorkflowExecutionLeaseV1 | null;
  readonly fence: number;
}
const hex = (value: string) => value.slice("sha256:".length);

/** Host-only, exact verified scope. The host must authorize current active scope
 * before construction/use. This journal neither authenticates a principal nor
 * grants credits, reserves platform dollars, or permits provider invocation. */
export class PostgresModelCommercialWorkflowStore implements ModelCommercialWorkflowStore {
  readonly #database: SqlDatabase;
  readonly #scope: ModelCommercialVerifiedScopeV1;
  constructor(input: {
    readonly database: SqlDatabase;
    readonly scope: ModelCommercialVerifiedScopeV1;
  }) {
    this.#database = input.database;
    this.#scope = parseWorkflowScope(input.scope);
  }
  #values(workflowId: string): readonly SqlValue[] {
    if (!workflowIdSchema.safeParse(workflowId).success) workflowFailure();
    return [
      this.#scope.organizationId,
      hex(this.#scope.tenantScopeDigest),
      this.#scope.projectId,
      this.#scope.userId,
      workflowId,
    ];
  }
  #assertScope(digest: string): void {
    if (digest !== this.#scope.tenantScopeDigest) workflowFailure();
  }
  async #lock(tx: SqlExecutor): Promise<void> {
    // Also serializes competing workflow IDs for one scope-local idempotency key.
    await tx.query(
      sql("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        `model-commercial:${this.#scope.organizationId}:${this.#scope.tenantScopeDigest}`,
      ]),
    );
  }
  async #now(tx: SqlExecutor): Promise<string> {
    const found = await tx.query(
      sql(
        "SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS workflow_now",
      ),
    );
    const parsed = workflowInstantSchema.safeParse(
      found.rows[0]?.["workflow_now"],
    );
    return parsed.success ? parsed.data : workflowFailure();
  }
  async #load(
    tx: SqlExecutor,
    workflowId: string,
  ): Promise<LoadedWorkflow | null> {
    const found = await tx.query(
      sql(
        `SELECT *,
      to_char(lease_acquired_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS acquired_iso,
      to_char(lease_expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS expires_iso
      FROM model_commercial_workflows WHERE organization_id=$1 AND scope_sha256=$2 AND project_id=$3 AND principal_id=$4 AND workflow_id=$5 FOR UPDATE`,
        this.#values(workflowId),
      ),
    );
    const row = found.rows[0];
    if (row === undefined) return null;
    let raw = row["snapshot"];
    if (typeof raw === "string") {
      try {
        raw = JSON.parse(raw) as unknown;
      } catch {
        workflowFailure();
      }
    }
    const record = parseWorkflowRecord(raw, this.#scope);
    const fence = Number(row["fence"]);
    if (
      !Number.isSafeInteger(fence) ||
      fence < 1 ||
      row["snapshot_sha256"] !== hex(digestStructuredValue(record)) ||
      row["fingerprint_sha256"] !== hex(record.fingerprint) ||
      record.request.multiCallWorkflowId !== workflowId ||
      Number(row["revision"]) !== record.revision ||
      row["state"] !== record.state ||
      row["reservation_id"] !== record.request.reservationId ||
      row["idempotency_sha256"] !==
        hex(digestStructuredValue(record.request.idempotencyKey))
    )
      workflowFailure();
    let lease: ModelCommercialWorkflowExecutionLeaseV1 | null = null;
    if (row["lease_id"] !== null) {
      const parsed = workflowLeaseSchema.safeParse({
        leaseId: row["lease_id"],
        fencingToken: String(fence),
        acquiredAt: row["acquired_iso"],
        expiresAt: row["expires_iso"],
      });
      if (!parsed.success) return workflowFailure();
      lease = parsed.data;
    } else if (row["acquired_iso"] !== null || row["expires_iso"] !== null)
      workflowFailure();
    return { record, fence, lease };
  }
  async claimExecution(
    input: Parameters<ModelCommercialWorkflowStore["claimExecution"]>[0],
  ): ReturnType<ModelCommercialWorkflowStore["claimExecution"]> {
    try {
      return await this.#claimExecution(input);
    } catch {
      return workflowFailure();
    }
  }
  async #claimExecution(
    input: Parameters<ModelCommercialWorkflowStore["claimExecution"]>[0],
  ): ReturnType<ModelCommercialWorkflowStore["claimExecution"]> {
    this.#assertScope(input.tenantScopeDigest);
    const request = parseWorkflowRequest(input.request, this.#scope);
    if (
      input.fingerprint !== digestStructuredValue(request) ||
      typeof input.recoveryOnly !== "boolean" ||
      !workflowInstantSchema.safeParse(input.trustedNow).success ||
      !workflowInstantSchema.safeParse(input.leaseExpiresAt).success ||
      Date.parse(input.leaseExpiresAt) <= Date.parse(input.trustedNow) ||
      Date.parse(input.leaseExpiresAt) - Date.parse(input.trustedNow) > 300000
    )
      workflowFailure();
    return this.#database.transaction(async (tx) => {
      await this.#lock(tx);
      const existing = await this.#load(tx, request.multiCallWorkflowId);
      if (
        existing !== null &&
        existing.record.fingerprint !== input.fingerprint
      )
        return { kind: "conflict" };
      if (existing?.record.response != null)
        return { kind: "terminal", response: existing.record.response };
      if (existing === null && input.recoveryOnly) return { kind: "missing" };
      const databaseNow = Date.parse(await this.#now(tx));
      if (
        existing?.lease !== null &&
        existing?.lease !== undefined &&
        Date.parse(existing.lease.expiresAt) > databaseNow
      )
        return { kind: "in-progress" };
      // A future host clock cannot acquire an unbounded database lease.
      if (
        Date.parse(input.leaseExpiresAt) <= databaseNow ||
        Date.parse(input.leaseExpiresAt) > databaseNow + 301000
      )
        workflowFailure();
      const fence = (existing?.fence ?? 0) + 1;
      if (!Number.isSafeInteger(fence)) workflowFailure();
      const lease = workflowLeaseSchema.parse({
        acquiredAt: input.trustedNow,
        expiresAt: input.leaseExpiresAt,
        fencingToken: String(fence),
        leaseId: "commercial_lease_" + randomUUID().replaceAll("-", ""),
      });
      const record =
        existing?.record ??
        parseWorkflowRecord(
          {
            dispatchIntent: null,
            fingerprint: input.fingerprint,
            invocationReceipt: null,
            invocationResult: null,
            request,
            reservationIntent: null,
            reservationReceipt: null,
            revision: 0,
            resolvedContext: null,
            response: null,
            state: "claimed",
          },
          this.#scope,
        );
      if (existing === null) {
        const duplicate = await tx.query(
          sql(
            "SELECT workflow_id FROM model_commercial_workflows WHERE organization_id=$1 AND (reservation_id=$2 OR (scope_sha256=$3 AND idempotency_sha256=$4))",
            [
              this.#scope.organizationId,
              request.reservationId,
              hex(this.#scope.tenantScopeDigest),
              hex(digestStructuredValue(request.idempotencyKey)),
            ],
          ),
        );
        if (duplicate.rowCount !== 0) return { kind: "conflict" };
        await tx.query(
          sql(
            `INSERT INTO model_commercial_workflows
          (organization_id,scope_sha256,project_id,principal_id,workflow_id,fingerprint_sha256,idempotency_sha256,reservation_id,snapshot,snapshot_sha256,revision,state,fence,lease_id,lease_acquired_at,lease_expires_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,0,'claimed',$11,$12,$13::timestamptz,$14::timestamptz)`,
            [
              ...this.#values(request.multiCallWorkflowId),
              hex(record.fingerprint),
              hex(digestStructuredValue(request.idempotencyKey)),
              request.reservationId,
              workflowJson(record),
              hex(digestStructuredValue(record)),
              fence,
              lease.leaseId,
              lease.acquiredAt,
              lease.expiresAt,
            ],
          ),
        );
      } else {
        const updated = await tx.query(
          sql(
            `UPDATE model_commercial_workflows SET fence=$6,lease_id=$7,lease_acquired_at=$8::timestamptz,lease_expires_at=$9::timestamptz
          WHERE organization_id=$1 AND scope_sha256=$2 AND project_id=$3 AND principal_id=$4 AND workflow_id=$5
          AND (lease_id IS NULL OR lease_expires_at <= clock_timestamp())`,
            [
              ...this.#values(request.multiCallWorkflowId),
              fence,
              lease.leaseId,
              lease.acquiredAt,
              lease.expiresAt,
            ],
          ),
        );
        if (updated.rowCount !== 1) workflowFailure();
      }
      return { kind: "acquired", lease, record };
    });
  }
  async compareAndSet(
    input: Parameters<ModelCommercialWorkflowStore["compareAndSet"]>[0],
  ): Promise<ModelCommercialWorkflowRecordV1> {
    try {
      return await this.#compareAndSet(input);
    } catch {
      return workflowFailure();
    }
  }
  async #compareAndSet(
    input: Parameters<ModelCommercialWorkflowStore["compareAndSet"]>[0],
  ): Promise<ModelCommercialWorkflowRecordV1> {
    this.#assertScope(input.tenantScopeDigest);
    const candidate = parseWorkflowRecord(input.record, this.#scope);
    const lease = workflowLeaseSchema.safeParse(input.lease);
    if (
      !lease.success ||
      !Number.isSafeInteger(input.expectedRevision) ||
      input.expectedRevision < 0 ||
      candidate.revision !== input.expectedRevision ||
      !workflowInstantSchema.safeParse(input.trustedNow).success ||
      Date.parse(input.trustedNow) >= Date.parse(lease.data.expiresAt)
    )
      return workflowFailure();
    return this.#database.transaction(async (tx) => {
      await this.#lock(tx);
      const before = await this.#load(
        tx,
        candidate.request.multiCallWorkflowId,
      );
      if (
        before?.lease == null ||
        !workflowSame(before.lease, lease.data) ||
        before.record.revision !== input.expectedRevision
      )
        return workflowFailure();
      assertWorkflowTransition(before.record, candidate);
      const record = parseWorkflowRecord(
        { ...candidate, revision: candidate.revision + 1 },
        this.#scope,
      );
      const updated = await tx.query(
        sql(
          `UPDATE model_commercial_workflows SET snapshot=$6::jsonb,snapshot_sha256=$7,revision=$8,state=$9
        WHERE organization_id=$1 AND scope_sha256=$2 AND project_id=$3 AND principal_id=$4 AND workflow_id=$5
        AND revision=$10 AND fence=$11 AND lease_id=$12 AND lease_expires_at > clock_timestamp()`,
          [
            ...this.#values(record.request.multiCallWorkflowId),
            workflowJson(record),
            hex(digestStructuredValue(record)),
            record.revision,
            record.state,
            input.expectedRevision,
            Number(lease.data.fencingToken),
            lease.data.leaseId,
          ],
        ),
      );
      if (updated.rowCount !== 1) return workflowFailure();
      return record;
    });
  }
  async releaseExecution(
    input: Parameters<ModelCommercialWorkflowStore["releaseExecution"]>[0],
  ): Promise<void> {
    try {
      await this.#releaseExecution(input);
      return;
    } catch {
      return workflowFailure();
    }
  }
  async #releaseExecution(
    input: Parameters<ModelCommercialWorkflowStore["releaseExecution"]>[0],
  ): Promise<void> {
    this.#assertScope(input.tenantScopeDigest);
    const lease = workflowLeaseSchema.safeParse(input.lease);
    if (!lease.success) return workflowFailure();
    await this.#database.transaction(async (tx) => {
      await this.#lock(tx);
      const before = await this.#load(tx, input.multiCallWorkflowId);
      if (before?.lease == null || !workflowSame(before.lease, lease.data))
        return;
      await tx.query(
        sql(
          `UPDATE model_commercial_workflows SET lease_id=NULL,lease_acquired_at=NULL,lease_expires_at=NULL
        WHERE organization_id=$1 AND scope_sha256=$2 AND project_id=$3 AND principal_id=$4 AND workflow_id=$5 AND fence=$6 AND lease_id=$7`,
          [
            ...this.#values(input.multiCallWorkflowId),
            Number(lease.data.fencingToken),
            lease.data.leaseId,
          ],
        ),
      );
    });
  }
}
