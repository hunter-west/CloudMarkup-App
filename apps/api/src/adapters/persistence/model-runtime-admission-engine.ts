import { parseSeedRuntimeRecordV4 } from "./model-live-seed-runtime-admission-codec.js";
import { randomUUID } from "node:crypto";
import {
  digestStructuredValue,
  ModelRuntimeControlError,
  type ModelRuntimeAdmissionStoreV1,
  type ModelRuntimeAdmissionClaimV1,
  type ModelRuntimeAdmissionClaimResultV1,
  type ModelRuntimeAdmissionTerminalV1,
  type ModelRuntimeLiveAuthorityReservationV1,
  type ModelLiveRuntimeAdmissionTerminalV2,
  type ModelLiveSeedRuntimeAdmissionTerminalV3,
  type ModelLiveSeedRuntimeAdmissionTerminalV4,
  expectedRuntimeDenialReasons,
  type ModelRuntimeStateSnapshotRequestV1,
  type ModelRuntimeExecutionLeaseV1,
  type ModelRuntimeTelemetryOutboxEntryV1,
} from "@cloudmarkup/model-gateway";
import {
  modelRuntimeStateSnapshotV1Schema,
  sha256DigestSchema,
  type Sha256Digest,
  type ModelRuntimeAdmissionRequestV1,
  type ModelRuntimeAdmissionDecisionV1,
  type ModelLiveRuntimeAdmissionRequestV2,
  type ModelLiveRuntimeAdmissionDecisionV2,
  type ModelLiveSequenceRuntimeAdmissionRequestV3,
  type ModelLiveSequenceRuntimeAdmissionRequestV4,
  type ModelLiveSequenceRuntimeAdmissionDecisionV4,
  type ModelLiveSequenceRuntimeAdmissionDecisionV3,
  type ModelRuntimeStateSnapshotV1,
} from "@cloudmarkup/schemas";
import {
  admissionAssert,
  admissionChecked,
  admissionJson,
  admissionRead,
  admissionScopeSchema,
  bindRuntimeOutbox,
  parseRuntimeOutbox,
  parseRuntimeRecord,
  runtimeExecutionLeaseSchema,
  runtimeWindow,
  RUNTIME_ADMISSION_OUTBOX_LIMIT,
  type RuntimeAdmissionRecord,
  type RuntimeAdmissionScope,
} from "./model-runtime-admission-codec.js";
import { parseSeedRuntimeRecord } from "./model-live-seed-runtime-admission-codec.js";
import { parseLiveRuntimeRecord } from "./model-live-runtime-admission-codec.js";
import { workflowInstantSchema } from "./model-commercial-workflow-codec.js";
import { sql, type SqlDatabase, type SqlExecutor, type SqlRow } from "./sql.js";

const hex = (value: string) => sha256DigestSchema.parse(value).slice(7);
const same = (left: unknown, right: unknown) =>
  digestStructuredValue(left) === digestStructuredValue(right);
function stale(): never {
  throw new ModelRuntimeControlError("stale-or-duplicate-conflict");
}
const numeric = (value: unknown) => {
  const parsed = Number(value);
  admissionAssert(Number.isSafeInteger(parsed) && parsed >= 0);
  return parsed;
};

type RuntimeRequest =
  | ModelRuntimeAdmissionRequestV1
  | ModelLiveRuntimeAdmissionRequestV2
  | ModelLiveSequenceRuntimeAdmissionRequestV3
  | ModelLiveSequenceRuntimeAdmissionRequestV4;
type RuntimeDecision =
  | ModelRuntimeAdmissionDecisionV1
  | ModelLiveRuntimeAdmissionDecisionV2
  | ModelLiveSequenceRuntimeAdmissionDecisionV3
  | ModelLiveSequenceRuntimeAdmissionDecisionV4;
type RuntimeTerminal =
  | ModelRuntimeAdmissionTerminalV1
  | ModelLiveRuntimeAdmissionTerminalV2
  | ModelLiveSeedRuntimeAdmissionTerminalV3
  | ModelLiveSeedRuntimeAdmissionTerminalV4;
type EngineRecord<
  R = RuntimeRequest,
  D = RuntimeDecision,
  T = RuntimeTerminal,
> = RuntimeAdmissionRecord<R, D, T> & {
  readonly liveAuthorityReservation?: ModelRuntimeLiveAuthorityReservationV1;
};
type EngineClaim<R, D, T> = Omit<
  ModelRuntimeAdmissionClaimV1,
  "admissionRequest" | "admissionDecision" | "deniedTerminal"
> & {
  readonly admissionRequest: R;
  readonly admissionDecision: D;
  readonly deniedTerminal?: T;
};
type EngineClaimResult<D, T> =
  | {
      readonly kind: "claimed";
      readonly admissionDecision: D;
      readonly executionLease: ModelRuntimeExecutionLeaseV1;
      readonly pending: T | null;
      readonly snapshot: ModelRuntimeStateSnapshotV1;
    }
  | {
      readonly kind: "denied";
      readonly snapshot: ModelRuntimeStateSnapshotV1;
      readonly terminal: T;
    }
  | { readonly kind: "duplicate-terminal"; readonly terminal: T }
  | Exclude<
      ModelRuntimeAdmissionClaimResultV1,
      { kind: "claimed" | "denied" | "duplicate-terminal" }
    >;
type StoreInput<K extends keyof ModelRuntimeAdmissionStoreV1> = Parameters<
  ModelRuntimeAdmissionStoreV1[K]
>[0];
interface EngineBinding<R, D> {
  readonly admissionRequest: R;
  readonly admissionDecision: D;
  readonly tenantScopeDigest: Sha256Digest;
}
export interface RuntimeAdmissionEngineCodec<
  R extends RuntimeRequest,
  D extends RuntimeDecision,
  T extends RuntimeTerminal,
> {
  readonly version: 1 | 2 | 3 | 4;
  readonly parseClaim: (
    value: unknown,
    scope: RuntimeAdmissionScope,
  ) => EngineClaim<R, D, T>;
  readonly parseRecord: (
    value: unknown,
    scope: RuntimeAdmissionScope,
  ) => EngineRecord<R, D, T>;
  readonly parseState: (
    value: ModelRuntimeStateSnapshotRequestV1,
    scope: RuntimeAdmissionScope,
  ) => ModelRuntimeStateSnapshotRequestV1;
  readonly parseTerminal: (value: unknown, request: R, decision: D) => T;
}
/** Trusted host callbacks inside the shared, authenticated organization transaction.
 * Issued metadata permits recovery only. Current approval is repeated on commit
 * by the live-plan transaction owner whenever new authority is requested. */
export interface RuntimeAdmissionTransactionAuthority<R, D, T> {
  readonly requireCurrent: () => Promise<void>;
  readonly bindState: (input: ModelRuntimeStateSnapshotRequestV1) => void;
  readonly bindClaim: (input: EngineClaim<R, D, T>) => void;
}
export interface RuntimeAdmissionTransactionPort<R, D, T> {
  run<Output>(
    work: (
      transaction: SqlExecutor,
      now: string,
      authority: RuntimeAdmissionTransactionAuthority<R, D, T>,
    ) => Promise<Output>,
  ): Promise<Output>;
}
function parseAnyRuntimeRecord(
  value: unknown,
  scope: RuntimeAdmissionScope,
): EngineRecord {
  const raw = admissionRead(value);
  if (
    typeof raw === "object" &&
    raw !== null &&
    "request" in raw &&
    typeof raw.request === "object" &&
    raw.request !== null &&
    "contractVersion" in raw.request
  ) {
    if (raw.request.contractVersion === 4)
      return parseSeedRuntimeRecordV4(raw, scope);
    if (raw.request.contractVersion === 3)
      return parseSeedRuntimeRecord(raw, scope);
    if (raw.request.contractVersion === 2)
      return parseLiveRuntimeRecord(raw, scope);
  }
  return parseRuntimeRecord(raw, scope);
}
function parseRuntimeRow<R extends EngineRecord>(
  row: SqlRow,
  scope: RuntimeAdmissionScope,
  parse: (value: unknown, scope: RuntimeAdmissionScope) => R,
): R {
  const record = parse(row["snapshot"], scope);
  admissionAssert(
    row["scope_sha256"] === hex(record.tenantScopeDigest) &&
      row["snapshot_sha256"] === hex(digestStructuredValue(record)) &&
      row["organization_id"] === record.request.organizationId &&
      row["project_id"] === record.request.projectId &&
      row["principal_id"] === record.request.userId &&
      numeric(row["revision"]) === record.revision &&
      row["active_concurrency_lease_id"] ===
        (record.executionLease === null ? null : record.concurrencyLeaseId),
  );
  return record;
}

/** Shared SQL persistence for explicit versioned codecs. Public adapters select
 * their codec; this engine never converts evaluation records to normal records. */
export class PostgresRuntimeAdmissionEngine<
  R extends RuntimeRequest,
  D extends RuntimeDecision,
  T extends RuntimeTerminal,
> {
  readonly #database: SqlDatabase;
  readonly #scope: RuntimeAdmissionScope;
  readonly #codec: RuntimeAdmissionEngineCodec<R, D, T>;
  readonly #authorityTransactions:
    RuntimeAdmissionTransactionPort<R, D, T> | undefined;
  constructor(input: {
    readonly database: SqlDatabase;
    readonly scope: RuntimeAdmissionScope;
    readonly codec: RuntimeAdmissionEngineCodec<R, D, T>;
    readonly authorityTransactions?: RuntimeAdmissionTransactionPort<R, D, T>;
  }) {
    this.#database = input.database;
    this.#scope = admissionChecked(() =>
      admissionScopeSchema.parse(input.scope),
    );
    this.#codec = input.codec;
    this.#authorityTransactions = input.authorityTransactions;
    admissionAssert(
      input.codec.version === 1 || input.authorityTransactions !== undefined,
    );
  }
  async #transaction<Output>(
    work: (
      tx: SqlExecutor,
      now: string,
      authority?: RuntimeAdmissionTransactionAuthority<R, D, T>,
    ) => Promise<Output>,
  ): Promise<Output> {
    try {
      if (this.#authorityTransactions !== undefined)
        return await this.#authorityTransactions.run(work);
      return await this.#database.transaction(async (tx) => {
        const scope = this.#scope;
        const authorized = await tx.query(
          sql(
            `SELECT 1 AS authorized FROM memberships m
          JOIN principals p ON p.principal_id=m.principal_id AND p.lifecycle_status='active'
          JOIN organizations o ON o.organization_id=m.organization_id AND o.lifecycle_status='active'
          JOIN organization_roles r ON r.organization_id=m.organization_id AND r.role_key=m.role_key
          JOIN projects pr ON pr.organization_id=m.organization_id AND pr.project_id=$2 AND pr.lifecycle_status='active'
          WHERE m.organization_id=$1 AND m.principal_id=$3 AND m.lifecycle_status='active'
          AND r.policy_version='authorization-v2' AND r.capabilities=cloudmarkup_authorization_v2_permissions(r.role_key)
          AND r.capabilities @> ARRAY['projects.mutate','commercial.expensive.use']::text[]
          FOR SHARE OF m,p,o,r,pr`,
            [scope.organizationId, scope.projectId, scope.userId],
          ),
        );
        admissionAssert(authorized.rowCount === 1);
        // Organization serialization covers user/org windows and lease-ID reuse.
        await tx.query(
          sql("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
            `runtime-admission:${scope.organizationId}`,
          ]),
        );
        const now = await this.#now(tx);
        return await work(tx, now);
      });
    } catch (error) {
      if (error instanceof ModelRuntimeControlError) throw error;
      throw new ModelRuntimeControlError("routing-authority-mismatch");
    }
  }
  async #now(tx: SqlExecutor): Promise<string> {
    const rows = await tx.query(
      sql(
        "SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS runtime_now",
      ),
    );
    return admissionChecked(() =>
      workflowInstantSchema.parse(rows.rows[0]?.["runtime_now"]),
    );
  }
  #row(row: SqlRow, scope = this.#scope): EngineRecord<R, D, T> {
    return parseRuntimeRow(row, scope, this.#codec.parseRecord);
  }
  async #load(
    tx: SqlExecutor,
    scopeDigest: string,
  ): Promise<EngineRecord<R, D, T> | null> {
    const found = await tx.query(
      sql(
        `SELECT organization_id,project_id,principal_id,scope_sha256,snapshot,snapshot_sha256,revision,active_concurrency_lease_id
      FROM model_runtime_admissions WHERE organization_id=$1 AND scope_sha256=$2 AND project_id=$3 AND principal_id=$4 FOR UPDATE`,
        [
          this.#scope.organizationId,
          hex(scopeDigest),
          this.#scope.projectId,
          this.#scope.userId,
        ],
      ),
    );
    return found.rows[0] === undefined ? null : this.#row(found.rows[0]);
  }
  async #required(tx: SqlExecutor, scopeDigest: string, fingerprint?: string) {
    const found = await this.#load(tx, scopeDigest);
    if (
      found === null ||
      (fingerprint !== undefined && found.fingerprint !== fingerprint)
    )
      stale();
    return found;
  }
  async #write(
    tx: SqlExecutor,
    next: EngineRecord,
    previous: EngineRecord | null,
  ) {
    const record = parseAnyRuntimeRecord(next, {
      organizationId: next.request.organizationId,
      projectId: next.request.projectId,
      userId: next.request.userId,
    });
    const values = [
      record.request.organizationId,
      hex(record.tenantScopeDigest),
      record.request.projectId,
      record.request.userId,
      admissionJson(record),
      hex(digestStructuredValue(record)),
      record.revision,
      record.executionLease === null ? null : record.concurrencyLeaseId,
      record.executionLease?.expiresAt ?? null,
    ];
    const result =
      previous === null
        ? await tx.query(
            sql(
              `INSERT INTO model_runtime_admissions(organization_id,scope_sha256,project_id,principal_id,snapshot,snapshot_sha256,revision,active_concurrency_lease_id,lease_expires_at,last_fence)
          VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9::timestamptz,CASE WHEN $8::varchar IS NULL THEN 0 ELSE split_part($5::jsonb#>>'{executionLease,fencingToken}','_',3)::bigint END)`,
              values,
            ),
          )
        : await tx.query(
            sql(
              `UPDATE model_runtime_admissions SET snapshot=$5::jsonb,snapshot_sha256=$6,revision=$7,active_concurrency_lease_id=$8,lease_expires_at=$9::timestamptz,
          last_fence=CASE WHEN $8::varchar IS NULL THEN last_fence ELSE split_part($5::jsonb#>>'{executionLease,fencingToken}','_',3)::bigint END
          WHERE organization_id=$1 AND scope_sha256=$2 AND project_id=$3 AND principal_id=$4 AND revision=$10 AND snapshot_sha256=$11
          AND (NOT $12::boolean OR lease_expires_at>clock_timestamp())`,
              [
                ...values,
                previous.revision,
                hex(digestStructuredValue(previous)),
                !same(previous.pending, record.pending) ||
                  !same(previous.terminal, record.terminal),
              ],
            ),
          );
    if (result.rowCount !== 1) stale();
  }
  async #snapshot(
    tx: SqlExecutor,
    input: ModelRuntimeStateSnapshotRequestV1,
    now: string,
  ) {
    const organizationBounds = runtimeWindow(
      now,
      input.organizationWindowSeconds,
    );
    const userBounds = runtimeWindow(now, input.userWindowSeconds);
    // A delayed/future host cannot select a cheaper request window.
    if (
      runtimeWindow(input.decidedAt, input.organizationWindowSeconds)
        .startsAt !== organizationBounds.startsAt ||
      runtimeWindow(input.decidedAt, input.userWindowSeconds).startsAt !==
        userBounds.startsAt
    )
      stale();
    const counts = await tx.query(
      sql(
        `SELECT
      (SELECT count(*) FROM model_runtime_admission_debits WHERE organization_id=$1 AND debited_at >= $3::timestamptz AND debited_at < $4::timestamptz) AS org_requests,
      (SELECT count(*) FROM model_runtime_admission_debits WHERE organization_id=$1 AND principal_id=$2 AND debited_at >= $5::timestamptz AND debited_at < $6::timestamptz) AS user_requests,
      (SELECT count(*) FROM model_runtime_admissions WHERE organization_id=$1 AND lease_expires_at > $7::timestamptz) AS org_active,
      (SELECT count(*) FROM model_runtime_admissions WHERE organization_id=$1 AND principal_id=$2 AND lease_expires_at > $7::timestamptz) AS user_active,
      EXISTS(SELECT 1 FROM model_runtime_admissions WHERE organization_id=$1 AND scope_sha256=$8) AS replay`,
        [
          input.organizationId,
          input.userId,
          organizationBounds.startsAt,
          organizationBounds.endsAt,
          userBounds.startsAt,
          userBounds.endsAt,
          now,
          hex(input.tenantScopeDigest),
        ],
      ),
    );
    const row = counts.rows[0];
    admissionAssert(row !== undefined);
    const leases = await tx.query(
      sql(
        `SELECT active_concurrency_lease_id FROM model_runtime_admissions WHERE organization_id=$1 AND lease_expires_at > $2::timestamptz ORDER BY active_concurrency_lease_id LIMIT 257`,
        [input.organizationId, now],
      ),
    );
    // Do not truncate authority. This technical envelope is below the Data API
    // row/response budget and fails closed if a future policy exceeds it.
    admissionAssert(
      leases.rows.length <= 256 &&
        leases.rows.length === numeric(row["org_active"]),
    );
    const liveAuthorityUsage = await this.#liveUsage(tx, input, now);
    const body = {
      ...(liveAuthorityUsage === undefined ? {} : { liveAuthorityUsage }),
      activeConcurrencyLeaseIds: leases.rows.map(
        (lease) => lease["active_concurrency_lease_id"],
      ),
      capturedAt: input.decidedAt,
      contractVersion: 1 as const,
      idempotencyReplay: row["replay"],
      organizationId: input.organizationId,
      policyDigest: input.runtimePolicyDigest,
      projectId: input.projectId,
      recordKind: "model-runtime-state-snapshot" as const,
      requestDigest: input.requestDigest,
      snapshotId: `runtime_snapshot_${digestStructuredValue({ capturedAt: input.decidedAt, requestDigest: input.requestDigest, runtimePolicyDigest: input.runtimePolicyDigest, tenantScopeDigest: input.tenantScopeDigest }).slice(7, 55)}`,
      userId: input.userId,
      windows: {
        organization: {
          activeConcurrentJobs: numeric(row["org_active"]),
          requestCount: numeric(row["org_requests"]),
          windowEndsAt: organizationBounds.endsAt,
          windowStartedAt: organizationBounds.startsAt,
        },
        user: {
          activeConcurrentJobs: numeric(row["user_active"]),
          requestCount: numeric(row["user_requests"]),
          windowEndsAt: userBounds.endsAt,
          windowStartedAt: userBounds.startsAt,
        },
      },
    };
    const snapshot = admissionChecked(() =>
      modelRuntimeStateSnapshotV1Schema.parse({
        ...body,
        snapshotDigest: digestStructuredValue(body),
      }),
    );
    admissionJson(snapshot);
    return snapshot;
  }
  async #liveUsage(
    tx: SqlExecutor,
    input: ModelRuntimeStateSnapshotRequestV1,
    now: string,
  ) {
    const reservation = input.liveAuthorityReservation;
    if (reservation === undefined) return undefined;
    const counts = await tx.query(
      sql(
        `SELECT count(*) FILTER (WHERE lease_expires_at>$3::timestamptz) AS active,
      COALESCE(sum((snapshot#>>'{liveAuthorityReservation,planned,cacheReadTokens}')::numeric),0) AS cache_read,
      COALESCE(sum((snapshot#>>'{liveAuthorityReservation,planned,cacheWriteTokens}')::numeric),0) AS cache_write,
      COALESCE(sum((snapshot#>>'{liveAuthorityReservation,planned,creditUnits}')::numeric),0) AS credits,
      COALESCE(sum((snapshot#>>'{liveAuthorityReservation,planned,estimatedMicroUsd}')::numeric),0) AS cost,
      COALESCE(sum((snapshot#>>'{liveAuthorityReservation,planned,inputTokens}')::numeric),0) AS input,
      COALESCE(sum((snapshot#>>'{liveAuthorityReservation,planned,invocations}')::numeric),0) AS invocations,
      COALESCE(sum((snapshot#>>'{liveAuthorityReservation,planned,outputTokens}')::numeric),0) AS output,
      COALESCE(sum((snapshot#>>'{liveAuthorityReservation,planned,totalTokens}')::numeric),0) AS total
      FROM model_runtime_admissions WHERE organization_id=$1
      AND snapshot#>>'{request,liveEvaluationAuthorityDigest}'=$2 AND snapshot#>>'{decision,outcome}'='allowed'`,
        [input.organizationId, reservation.authorityDigest, now],
      ),
    );
    const row = counts.rows[0];
    admissionAssert(row !== undefined);
    return {
      authorityDigest: reservation.authorityDigest,
      activeConcurrentJobs: numeric(row["active"]),
      reservedCacheReadTokens: numeric(row["cache_read"]),
      reservedCacheWriteTokens: numeric(row["cache_write"]),
      reservedCreditUnits: numeric(row["credits"]),
      reservedEstimatedMicroUsd: numeric(row["cost"]),
      reservedInputTokens: numeric(row["input"]),
      reservedInvocations: numeric(row["invocations"]),
      reservedOutputTokens: numeric(row["output"]),
      reservedTotalTokens: numeric(row["total"]),
    };
  }
  inspect(raw: ModelRuntimeStateSnapshotRequestV1) {
    const input = this.#codec.parseState(raw, this.#scope);
    return this.#transaction(async (tx, now, authority) => {
      authority?.bindState(input);
      await authority?.requireCurrent();
      return this.#snapshot(tx, input, now);
    });
  }
  async #lease(
    tx: SqlExecutor,
    input: EngineClaim<R, D, T>,
    revision: number,
    now: string,
    recoveryOnly: boolean,
  ): Promise<ModelRuntimeExecutionLeaseV1> {
    const expiry = Date.parse(input.executionLeaseExpiresAt);
    if (expiry <= Date.parse(now) || expiry > Date.parse(now) + 300000) stale();
    const sequence = await tx.query(
      sql("SELECT nextval('model_runtime_execution_fence') AS fence"),
    );
    const fence = numeric(sequence.rows[0]?.["fence"]);
    admissionAssert(fence > 0);
    return runtimeExecutionLeaseSchema.parse({
      acquiredAt: now,
      executionLeaseId: `runtime_execution_${randomUUID().replaceAll("-", "")}`,
      expiresAt: input.executionLeaseExpiresAt,
      fencingToken: `runtime_fence_${String(fence)}`,
      recoveryOnly,
      revision,
    });
  }
  async #fenceExpired<Record extends EngineRecord>(
    tx: SqlExecutor,
    record: Record,
    now: string,
  ) {
    if (
      record.executionLease === null ||
      Date.parse(record.executionLease.expiresAt) > Date.parse(now)
    )
      return record;
    const fenced = {
      ...record,
      executionLease: null,
      revision: record.revision + 1,
      recoveryRequired: true,
    };
    await this.#write(tx, fenced, record);
    return fenced;
  }
  async #collision(
    tx: SqlExecutor,
    input: EngineClaim<R, D, T>,
    now: string,
  ): Promise<boolean> {
    if (input.leaseId === undefined) return false;
    const found = await tx.query(
      sql(
        `SELECT organization_id,project_id,principal_id,scope_sha256,snapshot,snapshot_sha256,revision,active_concurrency_lease_id
      FROM model_runtime_admissions WHERE organization_id=$1 AND active_concurrency_lease_id=$2 AND scope_sha256<>$3 FOR UPDATE`,
        [input.organizationId, input.leaseId, hex(input.tenantScopeDigest)],
      ),
    );
    const row = found.rows[0];
    if (row === undefined) return false;
    const scope = admissionChecked(() =>
      admissionScopeSchema.parse({
        organizationId: row["organization_id"],
        projectId: row["project_id"],
        userId: row["principal_id"],
      }),
    );
    const record = parseRuntimeRow(row, scope, parseAnyRuntimeRecord);
    admissionAssert(record.executionLease !== null);
    if (Date.parse(record.executionLease.expiresAt) > Date.parse(now))
      return true;
    await this.#fenceExpired(tx, record, now);
    return false;
  }
  async #append(
    tx: SqlExecutor,
    record: EngineRecord<R, D, T>,
    entries: readonly ModelRuntimeTelemetryOutboxEntryV1[],
  ) {
    admissionAssert(entries.length <= 32);
    for (const raw of entries) {
      const entry = bindRuntimeOutbox(
        parseRuntimeOutbox(raw),
        record.request,
        record.decision,
      );
      const result = await tx.query(
        sql(
          `INSERT INTO model_runtime_admission_outbox(organization_id,scope_sha256,outbox_sha256,entry)
        VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(organization_id,scope_sha256,outbox_sha256) DO UPDATE SET entry=model_runtime_admission_outbox.entry
        WHERE model_runtime_admission_outbox.entry=EXCLUDED.entry`,
          [
            record.request.organizationId,
            hex(record.tenantScopeDigest),
            hex(entry.outboxId),
            admissionJson(entry, 8192),
          ],
        ),
      );
      if (result.rowCount !== 1) stale();
    }
    const count = await tx.query(
      sql(
        "SELECT count(*) AS count FROM model_runtime_admission_outbox WHERE organization_id=$1 AND scope_sha256=$2",
        [record.request.organizationId, hex(record.tenantScopeDigest)],
      ),
    );
    admissionAssert(
      numeric(count.rows[0]?.["count"]) <= RUNTIME_ADMISSION_OUTBOX_LIMIT,
    );
  }
  claim(raw: EngineClaim<R, D, T>): Promise<EngineClaimResult<D, T>> {
    const input = this.#codec.parseClaim(raw, this.#scope);
    return this.#transaction(async (tx, now, authority) => {
      authority?.bindClaim(input);
      let previous = await this.#load(tx, input.tenantScopeDigest);
      if (previous !== null) {
        if (
          previous.fingerprint !== input.fingerprint ||
          previous.concurrencyLeaseId !== (input.leaseId ?? null) ||
          !same(previous.request, input.admissionRequest)
        )
          return { kind: "conflict" };
        if (previous.terminal !== null)
          return { kind: "duplicate-terminal", terminal: previous.terminal };
        if (
          previous.executionLease !== null &&
          Date.parse(previous.executionLease.expiresAt) > Date.parse(now)
        )
          return { kind: "duplicate-in-progress" };
        previous = await this.#fenceExpired(tx, previous, now);
        if (!input.acquire) return { kind: "conflict" };
      }
      if (previous === null) await authority?.requireCurrent();
      if (await this.#collision(tx, input, now)) return { kind: "conflict" };
      const snapshot = await this.#snapshot(tx, input, now);
      if (
        previous === null &&
        (snapshot.snapshotDigest !== input.snapshotDigest ||
          snapshot.snapshotId !== input.snapshotId)
      )
        return { kind: "conflict" };
      if (
        previous === null &&
        Date.parse(input.commercialExpiresAt) <= Date.parse(now)
      )
        return { kind: "expired" };
      if (
        input.acquire &&
        previous === null &&
        (snapshot.windows.organization.requestCount >=
          input.limits.maximumOrganizationRequests ||
          snapshot.windows.user.requestCount >=
            input.limits.maximumUserRequests)
      )
        return {
          kind: "limit-changed",
          reason: "request-limit-exceeded",
          snapshot,
        };
      if (
        input.acquire &&
        (snapshot.windows.organization.activeConcurrentJobs >=
          input.limits.maximumConcurrentOrganizationJobs ||
          snapshot.windows.user.activeConcurrentJobs >=
            input.limits.maximumConcurrentUserJobs)
      )
        return {
          kind: "limit-changed",
          reason: "concurrency-limit-exceeded",
          snapshot,
        };
      if (
        input.acquire &&
        previous === null &&
        input.liveAuthorityReservation !== undefined
      ) {
        const reasons = expectedRuntimeDenialReasons({
          liveAuthorityReservation: input.liveAuthorityReservation,
          replayDenialReasons: [],
          runtimeState: snapshot,
          policy: {
            requestWindows: {
              organization: {
                maximumConcurrentJobs:
                  input.limits.maximumConcurrentOrganizationJobs,
                maximumRequests: input.limits.maximumOrganizationRequests,
                windowSeconds: input.organizationWindowSeconds,
              },
              user: {
                maximumConcurrentJobs: input.limits.maximumConcurrentUserJobs,
                maximumRequests: input.limits.maximumUserRequests,
                windowSeconds: input.userWindowSeconds,
              },
            },
          },
        });
        if (reasons.includes("concurrency-limit-exceeded"))
          return {
            kind: "limit-changed",
            reason: "concurrency-limit-exceeded",
            snapshot,
          };
        if (reasons.includes("live-evaluation-not-authorized"))
          return {
            kind: "limit-changed",
            reason: "live-evaluation-not-authorized",
            snapshot,
          };
      }
      const revision = previous === null ? 0 : previous.revision + 1;
      const recoveryRequired = previous?.recoveryRequired ?? false;
      const recoveryOnly =
        (this.#codec.version !== 1 && previous !== null) ||
        recoveryRequired ||
        (previous?.pending !== null && previous?.pending !== undefined) ||
        Date.parse(
          previous?.commercialExpiresAt ?? input.commercialExpiresAt,
        ) <= Date.parse(now);
      const executionLease = input.acquire
        ? await this.#lease(tx, input, revision, now, recoveryOnly)
        : null;
      const record = this.#codec.parseRecord(
        previous === null
          ? {
              ...(input.liveAuthorityReservation === undefined
                ? {}
                : { liveAuthorityReservation: input.liveAuthorityReservation }),
              request: input.admissionRequest,
              decision: input.admissionDecision,
              originalSnapshot: snapshot,
              fingerprint: input.fingerprint,
              tenantScopeDigest: input.tenantScopeDigest,
              commercialExpiresAt: input.commercialExpiresAt,
              concurrencyLeaseId: input.leaseId ?? null,
              revision,
              recoveryRequired,
              executionLease,
              pending: null,
              terminal: input.deniedTerminal ?? null,
            }
          : { ...previous, revision, executionLease },
        this.#scope,
      );
      // Keep headroom for terminal evidence before any model can be dispatched.
      if (previous === null) admissionJson(record, 10000);
      await this.#write(tx, record, previous);
      if (previous === null) {
        await tx.query(
          sql(
            `INSERT INTO model_runtime_admission_debits(organization_id,scope_sha256,principal_id,debited_at) VALUES($1,$2,$3,$4::timestamptz)`,
            [
              input.organizationId,
              hex(input.tenantScopeDigest),
              input.userId,
              now,
            ],
          ),
        );
        await this.#append(tx, record, input.claimOutbox);
      }
      const after = await this.#snapshot(tx, input, now);
      if (executionLease === null) {
        admissionAssert(record.terminal !== null);
        return { kind: "denied", snapshot: after, terminal: record.terminal };
      }
      await this.#assertDatabaseLease(tx, record);
      return {
        kind: "claimed",
        admissionDecision: record.decision,
        executionLease,
        pending: record.pending,
        snapshot: after,
      };
    });
  }
  async #assertDatabaseLease(tx: SqlExecutor, record: EngineRecord<R, D, T>) {
    const lease = record.executionLease;
    if (lease === null) stale();
    const found = await tx.query(
      sql(
        `SELECT 1 AS current FROM model_runtime_admissions
      WHERE organization_id=$1 AND scope_sha256=$2 AND project_id=$3 AND principal_id=$4 AND revision=$5 AND snapshot_sha256=$6
      AND lease_expires_at>clock_timestamp() AND ($7::boolean OR (snapshot->>'commercialExpiresAt')::timestamptz>clock_timestamp())`,
        [
          record.request.organizationId,
          hex(record.tenantScopeDigest),
          record.request.projectId,
          record.request.userId,
          record.revision,
          hex(digestStructuredValue(record)),
          lease.recoveryOnly,
        ],
      ),
    );
    if (found.rowCount !== 1) stale();
  }
  #assertLease(
    record: EngineRecord<R, D, T>,
    raw: ModelRuntimeExecutionLeaseV1,
    now: string,
    trustedNow?: string,
  ) {
    const lease = admissionChecked(() =>
      runtimeExecutionLeaseSchema.parse(raw),
    );
    if (
      record.executionLease === null ||
      !same(record.executionLease, lease) ||
      record.terminal !== null ||
      Date.parse(lease.expiresAt) <= Date.parse(now)
    )
      stale();
    if (trustedNow !== undefined) {
      const parsed = admissionChecked(() =>
        workflowInstantSchema.parse(trustedNow),
      );
      if (Date.parse(lease.expiresAt) <= Date.parse(parsed)) stale();
    }
  }
  assertExecutionLease(
    input: Parameters<ModelRuntimeAdmissionStoreV1["assertExecutionLease"]>[0],
  ) {
    return this.#transaction(async (tx, now, authority) => {
      const record = await this.#required(tx, input.tenantScopeDigest);
      this.#assertLease(record, input.executionLease, now, input.trustedNow);
      if (!input.executionLease.recoveryOnly) await authority?.requireCurrent();
      const expires = admissionChecked(() =>
        workflowInstantSchema.parse(input.commercialExpiresAt),
      );
      if (
        !input.executionLease.recoveryOnly &&
        (Date.parse(record.commercialExpiresAt) <= Date.parse(now) ||
          Date.parse(expires) <= Date.parse(now) ||
          Date.parse(record.commercialExpiresAt) <=
            Date.parse(input.trustedNow))
      )
        stale();
      await this.#assertDatabaseLease(tx, record);
    });
  }
  checkpointPendingAndRelease(
    input: Omit<StoreInput<"checkpointPendingAndRelease">, "pending"> & {
      readonly pending: T;
    },
  ) {
    return this.#transaction(async (tx, now, authority) => {
      const record = await this.#required(
        tx,
        input.tenantScopeDigest,
        input.fingerprint,
      );
      this.#assertLease(record, input.executionLease, now, input.trustedNow);
      const pending = this.#codec.parseTerminal(
        input.pending,
        record.request,
        record.decision,
      );
      admissionAssert(
        record.decision.outcome === "allowed" &&
          pending.commercial?.state === "settlement-pending" &&
          (record.pending === null || same(record.pending, pending)),
      );
      if (pending.output !== null) await authority?.requireCurrent();
      await this.#append(tx, record, input.pendingOutbox);
      await this.#write(
        tx,
        {
          ...record,
          pending,
          executionLease: null,
          revision: record.revision + 1,
        },
        record,
      );
    });
  }
  completeAndRelease(
    input: Omit<StoreInput<"completeAndRelease">, "terminal"> & {
      readonly terminal: T;
    },
  ) {
    return this.#transaction(async (tx, now, authority) => {
      const record = await this.#required(
        tx,
        input.tenantScopeDigest,
        input.fingerprint,
      );
      this.#assertLease(record, input.executionLease, now, input.trustedNow);
      const terminal = this.#codec.parseTerminal(
        input.terminal,
        record.request,
        record.decision,
      );
      admissionAssert(
        record.decision.outcome === "allowed" &&
          terminal.commercial !== null &&
          terminal.commercial.state !== "settlement-pending",
      );
      if (terminal.output !== null) await authority?.requireCurrent();
      await this.#append(tx, record, input.terminalOutbox);
      await this.#write(
        tx,
        {
          ...record,
          terminal,
          executionLease: null,
          revision: record.revision + 1,
        },
        record,
      );
    });
  }
  release(input: Parameters<ModelRuntimeAdmissionStoreV1["release"]>[0]) {
    return this.#transaction(async (tx, now) => {
      const record = await this.#required(tx, input.tenantScopeDigest);
      const lease = admissionChecked(() =>
        runtimeExecutionLeaseSchema.parse(input.executionLease),
      );
      if (record.executionLease === null || !same(record.executionLease, lease))
        stale();
      await this.#write(
        tx,
        {
          ...record,
          executionLease: null,
          revision: record.revision + 1,
          recoveryRequired:
            record.recoveryRequired ||
            Date.parse(lease.expiresAt) <= Date.parse(now),
        },
        record,
      );
    });
  }
  listPendingOutbox(
    input: Parameters<ModelRuntimeAdmissionStoreV1["listPendingOutbox"]>[0],
  ) {
    return this.#transaction(async (tx) => {
      const record = await this.#required(
        tx,
        input.tenantScopeDigest,
        input.fingerprint,
      );
      const entries: ModelRuntimeTelemetryOutboxEntryV1[] = [];
      let after = "";
      for (;;) {
        const rows = await tx.query(
          sql(
            `SELECT entry,outbox_sha256 FROM model_runtime_admission_outbox WHERE organization_id=$1 AND scope_sha256=$2 AND NOT acknowledged AND outbox_sha256>$3 ORDER BY outbox_sha256 LIMIT 16`,
            [this.#scope.organizationId, hex(input.tenantScopeDigest), after],
          ),
        );
        for (const row of rows.rows) {
          const entry = bindRuntimeOutbox(
            parseRuntimeOutbox(
              typeof row["entry"] === "string"
                ? admissionChecked(
                    () => JSON.parse(row["entry"] as string) as unknown,
                  )
                : row["entry"],
            ),
            record.request,
            record.decision,
          );
          admissionAssert(row["outbox_sha256"] === hex(entry.outboxId));
          entries.push(entry);
          after = hex(entry.outboxId);
        }
        admissionAssert(entries.length <= RUNTIME_ADMISSION_OUTBOX_LIMIT);
        if (rows.rows.length < 16) return entries;
      }
    });
  }
  acknowledgeOutbox(
    input: Parameters<ModelRuntimeAdmissionStoreV1["acknowledgeOutbox"]>[0],
  ) {
    return this.#transaction(async (tx) => {
      await this.#required(tx, input.tenantScopeDigest, input.fingerprint);
      const result = await tx.query(
        sql(
          `UPDATE model_runtime_admission_outbox SET acknowledged=TRUE WHERE organization_id=$1 AND scope_sha256=$2 AND outbox_sha256=$3`,
          [
            this.#scope.organizationId,
            hex(input.tenantScopeDigest),
            hex(input.outboxId),
          ],
        ),
      );
      if (result.rowCount !== 1) stale();
    });
  }
  #binding(record: EngineRecord<R, D, T>, input: EngineBinding<R, D>) {
    const terminal = record.terminal ?? record.pending;
    if (
      record.executionLease !== null ||
      terminal === null ||
      record.decision.outcome !== "allowed" ||
      !record.decision.invokeModel ||
      terminal.commercial === null ||
      !same(record.request, input.admissionRequest) ||
      !same(record.decision, input.admissionDecision)
    )
      stale();
    return {
      fingerprint: record.fingerprint,
      tenantScopeDigest: record.tenantScopeDigest,
      terminalDigest: digestStructuredValue(terminal),
    };
  }
  readOperationalExecutionBinding(input: EngineBinding<R, D>) {
    return this.#transaction(async (tx) =>
      this.#binding(await this.#required(tx, input.tenantScopeDigest), input),
    );
  }
  appendOperationalOutbox(
    input: EngineBinding<R, D> &
      Omit<
        StoreInput<"appendOperationalOutbox">,
        "admissionRequest" | "admissionDecision"
      >,
  ) {
    return this.#transaction(async (tx) => {
      const record = await this.#required(
        tx,
        input.tenantScopeDigest,
        input.fingerprint,
      );
      const binding = this.#binding(record, input);
      if (binding.terminalDigest !== input.terminalDigest) stale();
      const entry = bindRuntimeOutbox(
        parseRuntimeOutbox(input.entry),
        record.request,
        record.decision,
      );
      const operational = [
        "generation-result",
        "groundedness-failure",
        "import-inference",
        "repair-result",
        "safety-issue",
        "validator-failure",
      ].includes(entry.audit.eventKind);
      admissionAssert(
        entry.audit.referenceDigests.includes(binding.terminalDigest) &&
          (operational
            ? entry.metric.sourceAuthority === "runtime-control-v1" &&
              entry.metric.unit === "count" &&
              entry.metric.value === 1
            : entry.audit.eventKind === "eval-regression" &&
              entry.metric.sourceAuthority === "deterministic-evaluation-v1" &&
              entry.metric.unit === "basis-points"),
      );
      await this.#append(tx, record, [entry]);
    });
  }
}
