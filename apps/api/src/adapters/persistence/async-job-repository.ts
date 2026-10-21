import { hashCanonicalValue } from "@cloudmarkup/domain";
import {
  JobFrameworkError,
  type CreditReservationDecisionV1,
  type EntitlementDecisionV1,
  type JobAuditOutboxEntryV1,
  type JobCreationClaimV1,
  type JobRepository,
} from "@cloudmarkup/job-framework";
import {
  asyncJobAuditEventV1Schema,
  asyncJobTrustedActorV1Schema,
  asyncJobTrustedOwnershipV1Schema,
  parseAsyncJobRecordV1,
  utcTimestampSchema,
  type AsyncJobRecordV1,
} from "@cloudmarkup/schemas";

import {
  artifactsOf,
  bytesOf,
  claimProjection,
  digestBytes,
  hex,
  immutableRecordAuthority,
  jobClaimSnapshotSchema,
  jobSqlParameter,
  numberColumn,
  objectFromRow,
  persistenceFailure,
  recordProjection,
  same,
  textColumn,
  timestampColumn,
  verifyProjection,
  type JobObjectReference,
  type JobSqlFields,
} from "./async-job-repository-codec.js";
import {
  sql,
  type SqlDatabase,
  type SqlExecutor,
  type SqlRow,
  type SqlValue,
} from "./sql.js";

type Ownership = AsyncJobRecordV1["ownership"];
type ObjectKind = "input" | "output" | "job-record" | "creation-claim";

/**
 * Explicit privileged object boundary, not an implicit authenticated-user scope.
 * Implementations must publish immutable exact-owner stored_objects metadata
 * before put resolves (application/json, input-payload for input, report otherwise).
 * No implementation or in-memory fallback is selected by this repository.
 */
export interface AsyncJobPersistenceObjectPort {
  put(input: {
    readonly bytes: Uint8Array;
    readonly kind: ObjectKind;
    readonly ownership: Ownership;
    readonly digest: JobObjectReference["digest"];
  }): Promise<JobObjectReference>;
  get(
    input: JobObjectReference & {
      readonly kind: ObjectKind;
      readonly ownership: Ownership;
    },
  ): Promise<Uint8Array>;
}

type Table =
  | "async_jobs"
  | "async_job_creation_claims"
  | "async_job_identity_reservations"
  | "async_job_creation_claim_orchestration_members"
  | "async_job_record_snapshots"
  | "async_job_claim_snapshots"
  | "async_job_dependencies"
  | "async_job_expected_children"
  | "async_job_attempts"
  | "async_job_checkpoints"
  | "async_job_artifact_outputs"
  | "async_job_evidence_outputs"
  | "async_job_events"
  | "async_job_creation_claim_events";

// The claim's identity and creation plan are immutable after insertion. The
// ordinary API role may change only this lifecycle projection.
const mutableClaimColumns = new Set([
  "claim_status",
  "denial_code",
  "denial_public_message",
  "entitlement_decision_reference",
  "entitlement_denial_code",
  "entitlement_outcome",
  "entitlement_public_message",
  "record_version",
  "reservation_denial_code",
  "reservation_outcome",
  "reservation_public_message",
  "reservation_reference",
  "updated_at",
]);
const mutableJobColumns = new Set([
  "artifact_count",
  "attempt_count",
  "cancellation_acknowledged_at",
  "cancellation_requested_at",
  "cancellation_requested_by",
  "checkpoint_count",
  "completed_at",
  "failure_classification",
  "failure_retry_after_seconds",
  "interaction_checkpoint_id",
  "interaction_handler_id",
  "interaction_handler_version",
  "interaction_id",
  "interaction_received_at",
  "interaction_requested_at",
  "interaction_response_object_id",
  "interaction_response_sha256",
  "interaction_response_size_bytes",
  "interaction_state",
  "internal_error_id",
  "latest_checkpoint_id",
  "lifecycle_status",
  "measured_output_size_bytes",
  "output_object_id",
  "output_sha256",
  "output_size_bytes",
  "progress_completed_units",
  "progress_message_key",
  "progress_phase",
  "progress_sequence",
  "progress_total_units",
  "progress_updated_at",
  "public_failure_message",
  "queued_at",
  "record_version",
  "safe_failure_code",
  "started_at",
  "superseded_by_job_id",
  "updated_at",
]);

// Identifiers below originate only in program-owned projections, never request data.
async function insert(
  executor: SqlExecutor,
  table: Table,
  fields: JobSqlFields,
): Promise<void> {
  const columns = Object.keys(fields);
  await executor.query(
    sql(
      `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(jobSqlParameter).join(", ")})`,
      Object.values(fields),
    ),
  );
}

interface LoadedJob {
  readonly record: AsyncJobRecordV1;
  readonly row: SqlRow;
}
interface LoadedClaim {
  readonly claim: JobCreationClaimV1;
  readonly row: SqlRow;
}

/** One instance is bound to one exact previously-authorized tenant/project. */
export class PostgresAsyncJobRepository implements JobRepository {
  readonly #database: SqlDatabase;
  readonly #objects: AsyncJobPersistenceObjectPort;
  readonly #ownership: Ownership;

  constructor(options: {
    readonly database: SqlDatabase;
    readonly objects: AsyncJobPersistenceObjectPort;
    readonly ownership: Ownership;
  }) {
    this.#database = options.database;
    this.#objects = options.objects;
    this.#ownership = asyncJobTrustedOwnershipV1Schema.parse(options.ownership);
  }

  #assertScope(ownership: Ownership): void {
    if (!same(this.#ownership, ownership))
      persistenceFailure("job.scope-mismatch");
  }
  #scopeValues(): readonly SqlValue[] {
    return [this.#ownership.organizationId, this.#ownership.projectId ?? null];
  }
  #limit(value: number): number {
    if (!Number.isSafeInteger(value) || value < 1 || value > 1000)
      persistenceFailure("job.invalid-list-limit");
    return value;
  }
  async #verifyReferencedObjects(
    executor: SqlExecutor,
    value: unknown,
  ): Promise<void> {
    const references: Record<string, unknown>[] = [];
    const visit = (candidate: unknown): void => {
      if (Array.isArray(candidate)) {
        candidate.forEach(visit);
        return;
      }
      if (candidate === null || typeof candidate !== "object") return;
      const object = candidate as Record<string, unknown>;
      if (
        typeof object["objectId"] === "string" &&
        typeof object["purpose"] === "string" &&
        typeof object["digest"] === "string" &&
        typeof object["sizeBytes"] === "number" &&
        typeof object["mediaType"] === "string"
      ) {
        references.push(object);
        return;
      }
      Object.values(object).forEach(visit);
    };
    visit(value);
    for (const object of references) {
      const result = await executor.query(
        sql(
          "SELECT object_id FROM stored_objects WHERE organization_id=$1 AND project_id IS NOT DISTINCT FROM $2 AND object_id=$3 AND content_sha256=$4 AND size_bytes=$5 AND media_type=$6 AND object_purpose=$7 AND lifecycle_state='published'",
          [
            ...this.#scopeValues(),
            String(object["objectId"]),
            String(object["digest"]).slice(7),
            Number(object["sizeBytes"]),
            String(object["mediaType"]),
            String(object["purpose"]),
          ],
        ),
      );
      if (result.rows.length !== 1)
        persistenceFailure("job.object-reference-mismatch");
    }
  }
  async #put(
    value: unknown,
    kind: ObjectKind,
    limit = 4 * 1024 * 1024,
  ): Promise<JobObjectReference> {
    const bytes = bytesOf(value);
    if (bytes.length > limit)
      persistenceFailure("job.persistence-object-too-large");
    const digest = digestBytes(bytes);
    const reference = await this.#objects.put({
      bytes,
      digest,
      kind,
      ownership: this.#ownership,
    });
    if (
      reference.digest !== digest ||
      reference.sizeBytes !== bytes.length ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(reference.objectId)
    )
      persistenceFailure();
    return reference;
  }
  async #readObject(
    reference: JobObjectReference,
    kind: ObjectKind,
  ): Promise<unknown> {
    if (reference.sizeBytes < 0 || reference.sizeBytes > 4 * 1024 * 1024)
      persistenceFailure();
    const bytes = await this.#objects.get({
      ...reference,
      kind,
      ownership: this.#ownership,
    });
    if (
      bytes.length !== reference.sizeBytes ||
      digestBytes(bytes) !== reference.digest
    )
      persistenceFailure();
    try {
      return JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      ) as unknown;
    } catch {
      return persistenceFailure();
    }
  }
  async #snapshot(
    executor: SqlExecutor,
    value: AsyncJobRecordV1 | JobCreationClaimV1,
  ): Promise<void> {
    const isJob = "state" in value;
    const reference = await this.#put(
      value,
      isJob ? "job-record" : "creation-claim",
    );
    await insert(
      executor,
      isJob ? "async_job_record_snapshots" : "async_job_claim_snapshots",
      {
        organization_id: this.#ownership.organizationId,
        project_id: this.#ownership.projectId ?? null,
        ...(isJob
          ? { job_id: value.jobId }
          : {
              operation_id: value.idempotency.operationId,
              idempotency_key_sha256: hex(value.idempotency.keyDigest),
            }),
        record_version: value.recordVersion,
        snapshot_object_id: reference.objectId,
        snapshot_sha256: hex(reference.digest),
        snapshot_size_bytes: reference.sizeBytes,
        created_at: value.updatedAt,
      },
    );
  }
  async #loadJob(
    executor: SqlExecutor,
    jobId: string,
    lock = false,
  ): Promise<LoadedJob | null> {
    if (lock) {
      // A contender may wait for a newer row version at READ COMMITTED.
      // Read its matching snapshot only in a fresh statement after the lock,
      // so the winner's newly committed snapshot is visible as well.
      const locked = await executor.query(
        sql(
          "SELECT j.job_id FROM async_jobs j WHERE j.organization_id=$1 AND j.project_id IS NOT DISTINCT FROM $2 AND j.job_id=$3 FOR UPDATE OF j",
          [...this.#scopeValues(), jobId],
        ),
      );
      if (locked.rows.length === 0) return null;
    }
    const result = await executor.query(
      sql(
        `SELECT j.*, s.snapshot_object_id, s.snapshot_sha256, s.snapshot_size_bytes
      FROM async_jobs j LEFT JOIN async_job_record_snapshots s ON s.organization_id=j.organization_id AND s.job_id=j.job_id AND s.record_version=j.record_version
      WHERE j.organization_id=$1 AND j.project_id IS NOT DISTINCT FROM $2 AND j.job_id=$3`,
        [...this.#scopeValues(), jobId],
      ),
    );
    const row = result.rows[0];
    if (row === undefined) return null;
    const record = parseAsyncJobRecordV1(
      await this.#readObject(objectFromRow(row, "snapshot"), "job-record"),
    );
    this.#assertScope(record.ownership);
    const input = objectFromRow(row, "input");
    const output =
      row["output_object_id"] === null ? null : objectFromRow(row, "output");
    verifyProjection(
      row,
      recordProjection(
        record,
        input,
        output,
        textColumn(row, "entitlement_decision_reference"),
      ),
    );
    if (
      !same(record.input, await this.#readObject(input, "input")) ||
      (output !== null &&
        !same(record.output, await this.#readObject(output, "output")))
    )
      persistenceFailure();
    return { record, row };
  }
  async #loadClaim(
    executor: SqlExecutor,
    operationId: string,
    keyDigest: string,
    lock = false,
  ): Promise<LoadedClaim | null> {
    if (lock) {
      const locked = await executor.query(
        sql(
          "SELECT c.job_id FROM async_job_creation_claims c WHERE c.organization_id=$1 AND c.project_id IS NOT DISTINCT FROM $2 AND c.operation_id=$3 AND c.idempotency_key_sha256=$4 FOR UPDATE OF c",
          [...this.#scopeValues(), operationId, keyDigest],
        ),
      );
      if (locked.rows.length === 0) return null;
    }
    const result = await executor.query(
      sql(
        `SELECT c.*, s.snapshot_object_id, s.snapshot_sha256, s.snapshot_size_bytes
      FROM async_job_creation_claims c LEFT JOIN async_job_claim_snapshots s ON s.organization_id=c.organization_id AND s.operation_id=c.operation_id AND s.idempotency_key_sha256=c.idempotency_key_sha256 AND s.record_version=c.record_version
      WHERE c.organization_id=$1 AND c.project_id IS NOT DISTINCT FROM $2 AND c.operation_id=$3 AND c.idempotency_key_sha256=$4`,
        [...this.#scopeValues(), operationId, keyDigest],
      ),
    );
    const row = result.rows[0];
    if (row === undefined) return null;
    const claim = jobClaimSnapshotSchema.parse(
      await this.#readObject(objectFromRow(row, "snapshot"), "creation-claim"),
    );
    this.#assertScope(claim.ownership);
    verifyProjection(row, claimProjection(claim, objectFromRow(row, "input")));
    return { claim, row };
  }
  async #update(
    executor: SqlExecutor,
    table: "async_jobs" | "async_job_creation_claims",
    fields: JobSqlFields,
    identity: JobSqlFields,
    expected: number,
  ): Promise<void> {
    const entries = Object.entries(fields);
    const keys = Object.entries(identity);
    const values = [
      ...entries.map(([, value]) => value),
      ...keys.map(([, value]) => value),
      expected,
    ];
    const result = await executor.query(
      sql(
        `UPDATE ${table} SET ${entries.map(([column], i) => `${column}=${jobSqlParameter(column, i)}`).join(", ")} WHERE ${keys.map(([column], i) => `${column} IS NOT DISTINCT FROM $${String(entries.length + i + 1)}`).join(" AND ")} AND record_version=$${String(values.length)}`,
        values,
      ),
    );
    if (result.rowCount !== 1)
      persistenceFailure(
        table === "async_jobs"
          ? "job.write-conflict"
          : "job.creation-claim-conflict",
      );
  }
  async #updateClaim(
    executor: SqlExecutor,
    current: JobCreationClaimV1,
    next: JobCreationClaimV1,
    input: JobObjectReference,
  ): Promise<void> {
    const previous = claimProjection(current, input);
    const projected = claimProjection(next, input);
    const changed: Record<string, SqlValue> = {};
    for (const [column, value] of Object.entries(projected)) {
      if (Object.is(value, previous[column])) continue;
      if (!mutableClaimColumns.has(column))
        persistenceFailure("job.creation-claim-mismatch");
      changed[column] = value;
    }
    if (changed["record_version"] !== current.recordVersion + 1)
      persistenceFailure("job.creation-claim-mismatch");
    await this.#update(
      executor,
      "async_job_creation_claims",
      changed,
      this.#claimIdentity(current),
      current.recordVersion,
    );
  }
  async #updateJob(
    executor: SqlExecutor,
    loaded: LoadedJob,
    stored: AsyncJobRecordV1,
    output: JobObjectReference | null,
  ): Promise<void> {
    const input = objectFromRow(loaded.row, "input");
    const entitlement = textColumn(
      loaded.row,
      "entitlement_decision_reference",
    );
    const previous = recordProjection(
      loaded.record,
      input,
      loaded.row["output_object_id"] === null
        ? null
        : objectFromRow(loaded.row, "output"),
      entitlement,
    );
    const projected = recordProjection(stored, input, output, entitlement);
    const changed: Record<string, SqlValue> = {};
    for (const [column, value] of Object.entries(projected)) {
      if (Object.is(value, previous[column])) continue;
      if (!mutableJobColumns.has(column))
        persistenceFailure("job.immutable-authority-changed");
      changed[column] = value;
    }
    if (changed["record_version"] !== loaded.record.recordVersion + 1)
      persistenceFailure("job.write-conflict");
    await this.#update(
      executor,
      "async_jobs",
      changed,
      {
        organization_id: this.#ownership.organizationId,
        project_id: this.#ownership.projectId ?? null,
        job_id: stored.jobId,
      },
      loaded.record.recordVersion,
    );
  }
  #claimIdentity(claim: JobCreationClaimV1): JobSqlFields {
    return {
      organization_id: this.#ownership.organizationId,
      project_id: this.#ownership.projectId ?? null,
      operation_id: claim.idempotency.operationId,
      idempotency_key_sha256: hex(claim.idempotency.keyDigest),
    };
  }

  public async claimCreation(
    input: Parameters<JobRepository["claimCreation"]>[0],
  ): ReturnType<JobRepository["claimCreation"]> {
    this.#assertScope(input.ownership);
    const proposed = jobClaimSnapshotSchema.parse({
      ...input,
      denial: null,
      entitlementDecision: null,
      recordVersion: 1,
      reservationDecision: null,
      status: "claimed",
      updatedAt: input.claimedAt,
    });
    if (
      hashCanonicalValue(input.creation.input) !== input.creation.inputDigest ||
      bytesOf(input.creation.input).length !== input.creation.inputSizeBytes
    )
      persistenceFailure("job.input-authority-mismatch");
    return this.#database.transaction(async (tx) => {
      // Serialize the organization-wide idempotency key, including foreign-project conflicts.
      await tx.query(
        sql("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
          JSON.stringify([
            this.#ownership.organizationId,
            input.idempotency.operationId,
            input.idempotency.keyDigest,
          ]),
        ]),
      );
      const existingIdentity = await tx.query(
        sql(
          "SELECT project_id FROM async_job_creation_claims WHERE organization_id=$1 AND operation_id=$2 AND idempotency_key_sha256=$3",
          [
            this.#ownership.organizationId,
            input.idempotency.operationId,
            hex(input.idempotency.keyDigest),
          ],
        ),
      );
      if (
        existingIdentity.rows[0] !== undefined &&
        existingIdentity.rows[0]["project_id"] !==
          (this.#ownership.projectId ?? null)
      )
        return { kind: "conflict" };
      const existing = await this.#loadClaim(
        tx,
        input.idempotency.operationId,
        hex(input.idempotency.keyDigest),
        true,
      );
      if (existing !== null) {
        const comparable = (
          creation: JobCreationClaimV1["creation"],
        ): unknown => ({
          ...creation,
          orchestration: {
            ...creation.orchestration,
            ...(creation.orchestration.parentJobId === undefined
              ? { rootJobId: "self" }
              : {}),
          },
        });
        return !same(existing.claim.idempotency, input.idempotency) ||
          !same(comparable(existing.claim.creation), comparable(input.creation))
          ? { kind: "conflict" }
          : { kind: "existing", claim: existing.claim };
      }
      await this.#verifyReferencedObjects(tx, proposed.creation.input);
      if (input.creation.orchestration.parentJobId === undefined)
        await this.#reserveIdentity(tx, proposed, input.jobId, null);
      else {
        const child = await tx.query(
          sql(
            "SELECT * FROM async_job_identity_reservations WHERE organization_id=$1 AND project_id IS NOT DISTINCT FROM $2 AND job_id=$3",
            [...this.#scopeValues(), input.jobId],
          ),
        );
        if (child.rows[0] === undefined)
          persistenceFailure("job.child-identity-unreserved");
        verifyProjection(child.rows[0], {
          reservation_kind: "expected-child",
          parent_job_id: input.creation.orchestration.parentJobId,
          root_job_id: input.creation.orchestration.rootJobId,
          correlation_id: input.correlationId,
        });
      }
      for (const childId of proposed.creation.orchestration.expectedChildJobIds)
        await this.#reserveIdentity(tx, proposed, childId, proposed.jobId);
      const object = await this.#put(
        proposed.creation.input,
        "input",
        proposed.creation.limits.inlineInputBytes,
      );
      await insert(
        tx,
        "async_job_creation_claims",
        claimProjection(proposed, object),
      );
      for (const [kind, members] of [
        ["dependency", proposed.creation.orchestration.dependencyJobIds],
        ["expected-child", proposed.creation.orchestration.expectedChildJobIds],
      ] as const) {
        for (const [ordinal, member] of members.entries())
          await insert(tx, "async_job_creation_claim_orchestration_members", {
            ...this.#claimIdentity(proposed),
            relationship_kind: kind,
            member_ordinal: ordinal,
            member_job_id: member,
            created_at: proposed.claimedAt,
          });
      }
      await this.#snapshot(tx, proposed);
      return { kind: "claimed", claim: proposed };
    });
  }
  async #reserveIdentity(
    tx: SqlExecutor,
    claim: JobCreationClaimV1,
    jobId: string,
    parentJobId: string | null,
  ): Promise<void> {
    await insert(tx, "async_job_identity_reservations", {
      organization_id: this.#ownership.organizationId,
      project_id: this.#ownership.projectId ?? null,
      job_id: jobId,
      reservation_kind: parentJobId === null ? "root" : "expected-child",
      parent_job_id: parentJobId,
      root_job_id: claim.creation.orchestration.rootJobId,
      correlation_id: claim.correlationId,
      reserving_operation_id: claim.idempotency.operationId,
      reserving_idempotency_key_sha256: hex(claim.idempotency.keyDigest),
      reserved_at: claim.claimedAt,
    });
  }
  async #changeClaim(
    claim: JobCreationClaimV1,
    change: (current: JobCreationClaimV1) => JobCreationClaimV1,
    after?: (tx: SqlExecutor, updated: JobCreationClaimV1) => Promise<void>,
  ): Promise<JobCreationClaimV1> {
    this.#assertScope(claim.ownership);
    return this.#database.transaction(async (tx) => {
      const loaded = await this.#loadClaim(
        tx,
        claim.idempotency.operationId,
        hex(claim.idempotency.keyDigest),
        true,
      );
      if (loaded === null) persistenceFailure("job.creation-claim-conflict");
      const current = loaded.claim;
      const next = jobClaimSnapshotSchema.parse(change(current));
      if (same(current, next)) return current;
      if (
        current.status !== "claimed" ||
        current.recordVersion !== claim.recordVersion ||
        next.updatedAt < current.updatedAt
      )
        persistenceFailure("job.creation-claim-conflict");
      await this.#updateClaim(
        tx,
        current,
        next,
        objectFromRow(loaded.row, "input"),
      );
      await this.#snapshot(tx, next);
      await after?.(tx, next);
      return next;
    });
  }
  public recordEntitlement(
    claim: JobCreationClaimV1,
    decision: EntitlementDecisionV1,
    updatedAt: string,
  ): Promise<JobCreationClaimV1> {
    return this.#changeClaim(claim, (current) => {
      if (
        current.status === "claimed" &&
        same(current.entitlementDecision, decision)
      )
        return current;
      if (current.entitlementDecision !== null)
        persistenceFailure("job.creation-claim-conflict");
      return {
        ...current,
        entitlementDecision: decision,
        recordVersion: current.recordVersion + 1,
        updatedAt,
      };
    });
  }
  public recordReservation(
    claim: JobCreationClaimV1,
    decision: CreditReservationDecisionV1,
    updatedAt: string,
  ): Promise<JobCreationClaimV1> {
    return this.#changeClaim(claim, (current) => {
      if (
        current.status === "claimed" &&
        same(current.reservationDecision, decision)
      )
        return current;
      if (
        current.reservationDecision !== null ||
        current.entitlementDecision?.allowed !== true ||
        !current.creation.reservationRequested ||
        (decision.allowed && decision.reservationId === undefined)
      )
        persistenceFailure("job.creation-claim-conflict");
      return {
        ...current,
        reservationDecision: decision,
        recordVersion: current.recordVersion + 1,
        updatedAt,
      };
    });
  }
  public denyCreation(
    claim: JobCreationClaimV1,
    denial: NonNullable<JobCreationClaimV1["denial"]>,
    updatedAt: string,
    auditEntry: Extract<JobAuditOutboxEntryV1, { kind: "creation-claim" }>,
  ): Promise<JobCreationClaimV1> {
    return this.#changeClaim(
      claim,
      (current) => {
        if (
          auditEntry.event.claimRecordVersion !== current.recordVersion + 1 ||
          auditEntry.event.correlationId !== current.correlationId ||
          !same(auditEntry.event.denial, denial) ||
          !same(auditEntry.event.idempotency, current.idempotency) ||
          !same(auditEntry.event.ownership, current.ownership)
        )
          persistenceFailure("job.audit-outbox-mismatch");
        return {
          ...current,
          denial,
          recordVersion: current.recordVersion + 1,
          status: "denied",
          updatedAt,
        };
      },
      async (tx, current) => {
        await this.#appendAudit(tx, auditEntry, current);
      },
    );
  }
  public async completeCreation(
    claim: JobCreationClaimV1,
    record: AsyncJobRecordV1,
    updatedAt: string,
    auditEntries: readonly JobAuditOutboxEntryV1[],
  ): Promise<AsyncJobRecordV1> {
    this.#assertScope(claim.ownership);
    this.#assertScope(record.ownership);
    return this.#database.transaction(async (tx) => {
      const loaded = await this.#loadClaim(
        tx,
        claim.idempotency.operationId,
        hex(claim.idempotency.keyDigest),
        true,
      );
      if (
        loaded?.claim.status !== "claimed" ||
        loaded.claim.recordVersion !== claim.recordVersion
      )
        persistenceFailure("job.creation-claim-conflict");
      const current = loaded.claim;
      const reservation = current.creation.reservationRequested
        ? {
            state: "reserved",
            reservationId: current.reservationDecision?.reservationId,
          }
        : { state: "none" };
      const stored = parseAsyncJobRecordV1({ ...record, recordVersion: 1 });
      if (
        current.entitlementDecision?.allowed !== true ||
        (current.creation.reservationRequested &&
          current.reservationDecision?.allowed !== true) ||
        (!current.creation.reservationRequested &&
          current.reservationDecision !== null) ||
        updatedAt < current.updatedAt ||
        stored.state !== "queued" ||
        stored.createdAt !== current.claimedAt ||
        stored.queuedAt !== current.claimedAt ||
        stored.jobId !== current.jobId ||
        stored.correlationId !== current.correlationId ||
        !same(stored.idempotency, current.idempotency) ||
        !same(stored.reservation, reservation) ||
        !same(
          {
            input: stored.input,
            inputDigest: stored.inputDigest,
            inputSizeBytes: stored.inputSizeBytes,
            limits: stored.limits,
            orchestration: stored.orchestration,
            reservationRequested: current.creation.reservationRequested,
            ...(stored.expiresAt === undefined
              ? {}
              : { expiresAt: stored.expiresAt }),
          },
          current.creation,
        )
      )
        persistenceFailure("job.creation-claim-mismatch");
      const eventTypes = new Set(
        auditEntries.map((entry) => entry.event.eventType),
      );
      if (
        auditEntries.length < 3 ||
        !eventTypes.has("job-created") ||
        !eventTypes.has("job-enqueued") ||
        !eventTypes.has("entitlement-authorized") ||
        (current.creation.reservationRequested &&
          !eventTypes.has("reservation-established"))
      )
        persistenceFailure("job.audit-outbox-mismatch");
      this.#validateAudit(stored, auditEntries, false);
      await insert(
        tx,
        "async_jobs",
        recordProjection(
          stored,
          objectFromRow(loaded.row, "input"),
          null,
          current.entitlementDecision.decisionReference,
        ),
      );
      for (const dependency of stored.orchestration.dependencyJobIds)
        await insert(tx, "async_job_dependencies", {
          organization_id: this.#ownership.organizationId,
          project_id: this.#ownership.projectId ?? null,
          job_id: stored.jobId,
          dependency_job_id: dependency,
          created_at: stored.createdAt,
        });
      for (const child of stored.orchestration.expectedChildJobIds)
        await insert(tx, "async_job_expected_children", {
          organization_id: this.#ownership.organizationId,
          project_id: this.#ownership.projectId ?? null,
          parent_job_id: stored.jobId,
          child_job_id: child,
          created_at: stored.createdAt,
        });
      await this.#snapshot(tx, stored);
      const completed: JobCreationClaimV1 = {
        ...current,
        recordVersion: current.recordVersion + 1,
        status: "completed",
        updatedAt,
      };
      await this.#updateClaim(
        tx,
        current,
        completed,
        objectFromRow(loaded.row, "input"),
      );
      await this.#snapshot(tx, completed);
      for (const entry of auditEntries)
        await this.#appendAudit(tx, entry, current);
      return stored;
    });
  }
  #validateAudit(
    record: AsyncJobRecordV1,
    entries: readonly JobAuditOutboxEntryV1[],
    transitionRequired: boolean,
  ): void {
    if (
      entries.length === 0 ||
      entries.some(
        (entry) =>
          entry.kind !== "job" ||
          entry.event.jobId !== record.jobId ||
          entry.event.correlationId !== record.correlationId ||
          !same(entry.event.ownership, record.ownership) ||
          (transitionRequired &&
            entry.event.transition?.recordVersion !== record.recordVersion),
      )
    )
      persistenceFailure("job.audit-outbox-mismatch");
    for (const entry of entries)
      if (entry.kind === "job") asyncJobAuditEventV1Schema.parse(entry.event);
  }
  public async saveWithAudit(
    record: AsyncJobRecordV1,
    expectedRecordVersion: number,
    auditEntries: readonly JobAuditOutboxEntryV1[],
  ): Promise<AsyncJobRecordV1> {
    this.#assertScope(record.ownership);
    const stored = parseAsyncJobRecordV1({
      ...record,
      recordVersion: expectedRecordVersion + 1,
    });
    this.#validateAudit(stored, auditEntries, true);
    return this.#database.transaction(async (tx) => {
      const loaded = await this.#loadJob(tx, stored.jobId, true);
      if (loaded?.record.recordVersion !== expectedRecordVersion)
        persistenceFailure("job.write-conflict");
      if (
        !same(
          immutableRecordAuthority(loaded.record),
          immutableRecordAuthority(stored),
        )
      )
        persistenceFailure("job.immutable-authority-changed");
      await this.#verifyReferencedObjects(tx, stored.output);
      await this.#verifyReferencedObjects(tx, stored.interaction);
      await this.#verifyReferencedObjects(tx, stored.checkpoints);
      const output =
        stored.output === undefined
          ? null
          : loaded.record.output !== undefined &&
              same(loaded.record.output, stored.output)
            ? objectFromRow(loaded.row, "output")
            : await this.#put(
                stored.output,
                "output",
                stored.limits.outputBytes,
              );
      // New checkpoints require the existing running job/attempt; terminal writes follow them.
      await this.#writeCheckpoints(tx, loaded.record, stored);
      await this.#updateJob(tx, loaded, stored, output);
      await this.#writeAttempts(tx, loaded.record, stored);
      await this.#writeOutputs(tx, loaded.record, stored);
      await this.#snapshot(tx, stored);
      for (const entry of auditEntries) await this.#appendAudit(tx, entry);
      return stored;
    });
  }
  async #writeCheckpoints(
    tx: SqlExecutor,
    previous: AsyncJobRecordV1,
    record: AsyncJobRecordV1,
  ): Promise<void> {
    if (
      !same(
        previous.checkpoints,
        record.checkpoints.slice(0, previous.checkpoints.length),
      )
    )
      persistenceFailure("job.immutable-checkpoint-changed");
    for (const checkpoint of record.checkpoints.slice(
      previous.checkpoints.length,
    )) {
      const attempt = previous.attempts.find(
        (item) => item.attemptNumber === checkpoint.attemptNumber,
      );
      if (attempt?.state !== "running")
        persistenceFailure("job.checkpoint-attempt-mismatch");
      await insert(tx, "async_job_checkpoints", {
        organization_id: this.#ownership.organizationId,
        job_id: record.jobId,
        attempt_id: attempt.attemptId,
        attempt_number: checkpoint.attemptNumber,
        checkpoint_id: checkpoint.checkpointId,
        checkpoint_number: checkpoint.sequence,
        handler_id: checkpoint.handlerId,
        handler_version: checkpoint.handlerVersion,
        input_sha256: hex(checkpoint.inputDigest),
        object_id: checkpoint.state.objectId,
        content_sha256: hex(checkpoint.state.digest),
        size_bytes: checkpoint.state.sizeBytes,
        created_at: checkpoint.createdAt,
      });
    }
  }
  async #writeAttempts(
    tx: SqlExecutor,
    previous: AsyncJobRecordV1,
    record: AsyncJobRecordV1,
  ): Promise<void> {
    if (record.attempts.length < previous.attempts.length)
      persistenceFailure("job.immutable-attempt-changed");
    for (const [index, attempt] of record.attempts.entries()) {
      const old = previous.attempts[index];
      if (same(old ?? null, attempt)) continue;
      if (
        old !== undefined &&
        (old.state !== "running" ||
          old.attemptId !== attempt.attemptId ||
          old.attemptNumber !== attempt.attemptNumber ||
          old.startedAt !== attempt.startedAt ||
          old.resumedFromCheckpointId !== attempt.resumedFromCheckpointId)
      )
        persistenceFailure("job.immutable-attempt-changed");
      const lease = attempt.lease ?? old?.lease;
      const fields: JobSqlFields = {
        attempt_id: attempt.attemptId,
        organization_id: this.#ownership.organizationId,
        job_id: record.jobId,
        attempt_number: attempt.attemptNumber,
        lifecycle_status: attempt.state,
        worker_reference: lease?.workerId ?? null,
        lease_expires_at: lease?.leaseExpiresAt ?? null,
        heartbeat_at: lease?.heartbeatAt ?? null,
        failure_classification: attempt.failure?.classification ?? null,
        retry_disposition: attempt.retryDisposition?.kind ?? null,
        safe_failure_code: attempt.failure?.code ?? null,
        internal_error_id: attempt.failure?.internalErrorId ?? null,
        public_failure_message: attempt.failure?.publicMessage ?? null,
        failure_retry_after_seconds: attempt.failure?.retryAfterSeconds ?? null,
        started_at: attempt.startedAt,
        resumed_from_checkpoint_id: attempt.resumedFromCheckpointId ?? null,
        retry_not_before:
          attempt.retryDisposition?.kind === "retry"
            ? attempt.retryDisposition.notBefore
            : null,
        runtime_seconds: attempt.runtimeSeconds,
        completed_at: attempt.completedAt ?? null,
      };
      if (old === undefined) await insert(tx, "async_job_attempts", fields);
      else {
        // The attempt identity is immutable in the canonical trigger. Updating
        // unchanged identity columns also demands privileges the runtime does
        // not have; write only the lifecycle columns that can advance.
        const entries = Object.entries({
          lifecycle_status: fields["lifecycle_status"] ?? null,
          lease_expires_at: fields["lease_expires_at"] ?? null,
          heartbeat_at: fields["heartbeat_at"] ?? null,
          failure_classification: fields["failure_classification"] ?? null,
          retry_disposition: fields["retry_disposition"] ?? null,
          safe_failure_code: fields["safe_failure_code"] ?? null,
          internal_error_id: fields["internal_error_id"] ?? null,
          public_failure_message: fields["public_failure_message"] ?? null,
          failure_retry_after_seconds:
            fields["failure_retry_after_seconds"] ?? null,
          retry_not_before: fields["retry_not_before"] ?? null,
          runtime_seconds: fields["runtime_seconds"] ?? null,
          completed_at: fields["completed_at"] ?? null,
        });
        const result = await tx.query(
          sql(
            `UPDATE async_job_attempts SET ${entries.map(([column], i) => `${column}=${jobSqlParameter(column, i)}`).join(", ")} WHERE organization_id=$${String(entries.length + 1)} AND job_id=$${String(entries.length + 2)} AND attempt_id=$${String(entries.length + 3)} AND lifecycle_status='running'`,
            [
              ...entries.map(([, value]) => value),
              this.#ownership.organizationId,
              record.jobId,
              attempt.attemptId,
            ],
          ),
        );
        if (result.rowCount !== 1) persistenceFailure("job.write-conflict");
      }
    }
  }
  async #writeOutputs(
    tx: SqlExecutor,
    previous: AsyncJobRecordV1,
    record: AsyncJobRecordV1,
  ): Promise<void> {
    const existing = artifactsOf(previous);
    for (const artifact of artifactsOf(record)) {
      const old = existing.find(
        (item) => item.artifactId === artifact.artifactId,
      );
      if (old !== undefined) {
        if (!same(old.object, artifact.object))
          persistenceFailure("job.immutable-output-changed");
        continue;
      }
      await insert(tx, "async_job_artifact_outputs", {
        organization_id: this.#ownership.organizationId,
        job_id: record.jobId,
        artifact_reference_id: artifact.artifactId,
        object_id: artifact.object.objectId,
        content_sha256: hex(artifact.object.digest),
        size_bytes: artifact.object.sizeBytes,
        expires_at: artifact.object.expiresAt ?? null,
        created_at: record.updatedAt,
      });
    }
    if (record.output === undefined || !("evidenceRecords" in record.output))
      return;
    const oldEvidence =
      previous.output !== undefined && "evidenceRecords" in previous.output
        ? previous.output.evidenceRecords
        : [];
    for (const evidence of record.output.evidenceRecords) {
      const old = oldEvidence.find(
        (item) => item.evidenceId === evidence.evidenceId,
      );
      if (old !== undefined) {
        if (!same(old, evidence))
          persistenceFailure("job.immutable-output-changed");
        continue;
      }
      const result = await tx.query(
        sql(
          "SELECT solution_record_id FROM solution_records WHERE organization_id=$1 AND project_id IS NOT DISTINCT FROM $2 AND record_kind='evidence' AND subject_id=$3 AND content_object_id=$4",
          [
            ...this.#scopeValues(),
            evidence.evidenceId,
            evidence.record.objectId,
          ],
        ),
      );
      const row = result.rows[0];
      if (row === undefined || result.rows.length !== 1)
        persistenceFailure("job.evidence-binding-mismatch");
      await insert(tx, "async_job_evidence_outputs", {
        organization_id: this.#ownership.organizationId,
        project_id: this.#ownership.projectId ?? null,
        job_id: record.jobId,
        evidence_solution_record_id: textColumn(row, "solution_record_id"),
        evidence_id: evidence.evidenceId,
        evidence_record_kind: "evidence",
        evidence_object_id: evidence.record.objectId,
        evidence_sha256: hex(evidence.record.digest),
        evidence_size_bytes: evidence.record.sizeBytes,
        solution_revision_id: evidence.solutionRevisionId,
        environment_id: evidence.environment.environmentId ?? null,
        environment_type: evidence.environment.environmentType,
        created_at: record.updatedAt,
      });
    }
  }

  public async get(jobId: string): Promise<AsyncJobRecordV1 | null> {
    return (await this.#loadJob(this.#database, jobId))?.record ?? null;
  }
  public async getCreationClaim(
    input: Parameters<JobRepository["getCreationClaim"]>[0],
  ): Promise<JobCreationClaimV1 | null> {
    this.#assertScope(input.ownership);
    return (
      (
        await this.#loadClaim(
          this.#database,
          input.operationId,
          hex(input.keyDigest),
        )
      )?.claim ?? null
    );
  }
  async #listJobs(
    predicate: string,
    values: readonly SqlValue[],
    order: string,
    limit = 1000,
  ): Promise<readonly AsyncJobRecordV1[]> {
    const result = await this.#database.query(
      sql(
        `SELECT j.job_id FROM async_jobs j WHERE j.organization_id=$1 AND j.project_id IS NOT DISTINCT FROM $2 AND ${predicate} ORDER BY ${order} LIMIT $${String(values.length + 3)}`,
        [...this.#scopeValues(), ...values, this.#limit(limit)],
      ),
    );
    const records: AsyncJobRecordV1[] = [];
    for (const row of result.rows) {
      const record = await this.get(textColumn(row, "job_id"));
      if (record !== null) records.push(record);
    }
    return records;
  }
  public listChildren(
    parentJobId: string,
  ): Promise<readonly AsyncJobRecordV1[]> {
    return this.#listJobs("j.parent_job_id=$3", [parentJobId], "j.job_id", 128);
  }
  public listJobsWithExpiredLeases(
    input: Parameters<JobRepository["listJobsWithExpiredLeases"]>[0],
  ): Promise<readonly AsyncJobRecordV1[]> {
    this.#assertScope(input.ownership);
    return this.#listJobs(
      "j.lifecycle_status='running' AND EXISTS (SELECT 1 FROM async_job_attempts a WHERE a.organization_id=j.organization_id AND a.job_id=j.job_id AND a.lifecycle_status='running' AND a.lease_expires_at <= $3::timestamptz)",
      [utcTimestampSchema.parse(input.expiredBefore)],
      "j.updated_at, j.job_id",
      input.limit,
    );
  }
  public listJobsPastRetention(
    input: Parameters<JobRepository["listJobsPastRetention"]>[0],
  ): Promise<readonly AsyncJobRecordV1[]> {
    this.#assertScope(input.ownership);
    return this.#listJobs(
      "j.expires_at <= $3::timestamptz AND j.lifecycle_status NOT IN ('succeeded','failed','canceled','expired','superseded')",
      [utcTimestampSchema.parse(input.expiredBefore)],
      "j.expires_at, j.job_id",
      input.limit,
    );
  }
  public listQueuedJobsReadyForDispatch(
    input: Parameters<JobRepository["listQueuedJobsReadyForDispatch"]>[0],
  ): Promise<readonly AsyncJobRecordV1[]> {
    this.#assertScope(input.ownership);
    const available =
      "COALESCE((SELECT a.retry_not_before FROM async_job_attempts a WHERE a.organization_id=j.organization_id AND a.job_id=j.job_id ORDER BY a.attempt_number DESC LIMIT 1), j.interaction_received_at, j.queued_at)";
    return this.#listJobs(
      `j.lifecycle_status='queued' AND ${available} <= $3::timestamptz`,
      [utcTimestampSchema.parse(input.availableAtOrBefore)],
      `${available}, j.job_id`,
      input.limit,
    );
  }
  public async listStaleCreationClaims(
    input: Parameters<JobRepository["listStaleCreationClaims"]>[0],
  ): Promise<readonly JobCreationClaimV1[]> {
    this.#assertScope(input.ownership);
    const result = await this.#database.query(
      sql(
        "SELECT operation_id, idempotency_key_sha256 FROM async_job_creation_claims WHERE organization_id=$1 AND project_id IS NOT DISTINCT FROM $2 AND claim_status='claimed' AND updated_at <= $3::timestamptz ORDER BY updated_at, job_id LIMIT $4",
        [
          ...this.#scopeValues(),
          utcTimestampSchema.parse(input.updatedBefore),
          this.#limit(input.limit),
        ],
      ),
    );
    const claims: JobCreationClaimV1[] = [];
    for (const row of result.rows) {
      const loaded = await this.#loadClaim(
        this.#database,
        textColumn(row, "operation_id"),
        textColumn(row, "idempotency_key_sha256"),
      );
      if (loaded !== null) claims.push(loaded.claim);
    }
    return claims;
  }

  async #appendAudit(
    tx: SqlExecutor,
    entry: JobAuditOutboxEntryV1,
    claim?: JobCreationClaimV1,
  ): Promise<void> {
    this.#assertScope(entry.event.ownership);
    await tx.query(
      sql("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        `async-job-audit:${entry.event.eventId}`,
      ]),
    );
    const existing = await this.#readAudit(tx, entry.event.eventId);
    if (existing !== null) {
      if (!same(existing, entry))
        persistenceFailure("job.audit-event-collision");
      return;
    }
    // The downstream audit port is idempotent by event ID across both kinds.
    // Check only existence under the global identity lock; never return another
    // tenant's event body, ownership, or publication state.
    const collision = await tx.query(
      sql(
        "SELECT 1 AS collision FROM async_job_events WHERE event_id=$1 UNION ALL SELECT 1 AS collision FROM async_job_creation_claim_events WHERE creation_event_id=$1 LIMIT 1",
        [entry.event.eventId],
      ),
    );
    if (collision.rows.length !== 0)
      persistenceFailure("job.audit-event-collision");
    const actor = asyncJobTrustedActorV1Schema.parse(entry.event.actor);
    const actorFields: JobSqlFields = {
      actor_kind: actor.kind,
      actor_reference:
        actor.kind === "principal"
          ? actor.actorId
          : actor.kind === "worker"
            ? actor.workerId
            : actor.reason,
      actor_principal_id: actor.kind === "principal" ? actor.actorId : null,
    };
    if (entry.kind === "job") {
      const event = asyncJobAuditEventV1Schema.parse(entry.event);
      const sequence = await tx.query(
        sql(
          "SELECT COALESCE(MAX(sequence_number),0)+1 AS next FROM async_job_events WHERE organization_id=$1 AND job_id=$2",
          [this.#ownership.organizationId, event.jobId],
        ),
      );
      await insert(tx, "async_job_events", {
        event_id: event.eventId,
        organization_id: this.#ownership.organizationId,
        job_id: event.jobId,
        sequence_number: numberColumn(sequence.rows[0] ?? {}, "next"),
        event_kind: event.eventType,
        from_status: event.transition?.from ?? null,
        to_status: event.transition?.to ?? null,
        summary_sha256:
          event.summaryDigest === undefined ? null : hex(event.summaryDigest),
        transition_reason: event.transition?.reason ?? null,
        transition_record_version: event.transition?.recordVersion ?? null,
        transition_at: event.transition?.at ?? null,
        correlation_id: event.correlationId,
        ...actorFields,
        occurred_at: event.occurredAt,
      });
    } else {
      if (claim === undefined) persistenceFailure("job.audit-outbox-mismatch");
      const event = entry.event;
      const sequence = await tx.query(
        sql(
          "SELECT COALESCE(MAX(sequence_number),0)+1 AS next FROM async_job_creation_claim_events WHERE organization_id=$1 AND operation_id=$2 AND idempotency_key_sha256=$3",
          [
            this.#ownership.organizationId,
            event.idempotency.operationId,
            hex(event.idempotency.keyDigest),
          ],
        ),
      );
      await insert(tx, "async_job_creation_claim_events", {
        ...this.#claimIdentity(claim),
        creation_event_id: event.eventId,
        sequence_number: numberColumn(sequence.rows[0] ?? {}, "next"),
        claim_record_version: event.claimRecordVersion,
        event_kind: event.eventType,
        safe_event_code: event.denial.code,
        public_message: event.denial.publicMessage,
        denial_source: event.denialSource,
        request_sha256: hex(event.idempotency.requestDigest),
        creation_plan_sha256: hex(hashCanonicalValue(claim.creation)),
        summary_sha256: hex(hashCanonicalValue(entry.event)),
        correlation_id: event.correlationId,
        ...actorFields,
        occurred_at: event.occurredAt,
      });
    }
  }
  async #readAudit(
    executor: SqlExecutor,
    eventId: string,
  ): Promise<JobAuditOutboxEntryV1 | null> {
    const jobs = await executor.query(
      sql(
        "SELECT e.*, j.project_id FROM async_job_events e JOIN async_jobs j ON j.organization_id=e.organization_id AND j.job_id=e.job_id WHERE e.organization_id=$1 AND j.project_id IS NOT DISTINCT FROM $2 AND e.event_id=$3",
        [...this.#scopeValues(), eventId],
      ),
    );
    const row = jobs.rows[0];
    const actorOf = (source: SqlRow): unknown =>
      source["actor_kind"] === "principal"
        ? { kind: "principal", actorId: source["actor_reference"] }
        : source["actor_kind"] === "worker"
          ? { kind: "worker", workerId: source["actor_reference"] }
          : { kind: "system", reason: source["actor_reference"] };
    if (row !== undefined)
      return {
        kind: "job",
        event: asyncJobAuditEventV1Schema.parse({
          actor: actorOf(row),
          correlationId: row["correlation_id"],
          eventId: row["event_id"],
          eventType: row["event_kind"],
          jobId: row["job_id"],
          occurredAt: timestampColumn(row, "occurred_at"),
          ownership: this.#ownership,
          ...(row["summary_sha256"] === null
            ? {}
            : { summaryDigest: `sha256:${textColumn(row, "summary_sha256")}` }),
          ...(row["to_status"] === null
            ? {}
            : {
                transition: {
                  at: timestampColumn(row, "transition_at"),
                  ...(row["from_status"] === null
                    ? {}
                    : { from: row["from_status"] }),
                  to: row["to_status"],
                  reason: row["transition_reason"],
                  recordVersion: numberColumn(row, "transition_record_version"),
                },
              }),
        }),
      };
    const claims = await executor.query(
      sql(
        "SELECT e.*, c.actor_id FROM async_job_creation_claim_events e JOIN async_job_creation_claims c ON c.organization_id=e.organization_id AND c.operation_id=e.operation_id AND c.idempotency_key_sha256=e.idempotency_key_sha256 WHERE e.organization_id=$1 AND e.project_id IS NOT DISTINCT FROM $2 AND e.creation_event_id=$3",
        [...this.#scopeValues(), eventId],
      ),
    );
    const event = claims.rows[0];
    if (event === undefined) return null;
    if (
      event["event_kind"] !== "creation-denied" ||
      !["entitlement", "recovery", "reservation"].includes(
        textColumn(event, "denial_source"),
      )
    )
      persistenceFailure();
    const claim = await this.#loadClaim(
      executor,
      textColumn(event, "operation_id"),
      textColumn(event, "idempotency_key_sha256"),
    );
    if (claim?.claim.denial == null) persistenceFailure();
    const entry: Extract<JobAuditOutboxEntryV1, { kind: "creation-claim" }> = {
      kind: "creation-claim",
      event: {
        actor: asyncJobTrustedActorV1Schema.parse(actorOf(event)),
        claimRecordVersion: numberColumn(event, "claim_record_version"),
        contractVersion: 1,
        correlationId: claim.claim.correlationId,
        denial: claim.claim.denial,
        denialSource: textColumn(event, "denial_source") as
          "entitlement" | "recovery" | "reservation",
        eventId: asyncJobAuditEventV1Schema.shape.eventId.parse(
          event["creation_event_id"],
        ),
        eventType: "creation-denied",
        idempotency: claim.claim.idempotency,
        occurredAt: timestampColumn(event, "occurred_at"),
        ownership: this.#ownership,
      },
    };
    if (hex(hashCanonicalValue(entry.event)) !== event["summary_sha256"])
      persistenceFailure();
    return entry;
  }
  public async listPendingAuditEntries(
    input: Parameters<JobRepository["listPendingAuditEntries"]>[0],
  ): Promise<readonly JobAuditOutboxEntryV1[]> {
    this.#assertScope(input.ownership);
    const result = await this.#database.query(
      sql(
        `SELECT event_id FROM (
      SELECT e.event_id, e.occurred_at FROM async_job_events e JOIN async_jobs j ON j.organization_id=e.organization_id AND j.job_id=e.job_id
      WHERE e.organization_id=$1 AND j.project_id IS NOT DISTINCT FROM $2 AND NOT EXISTS (SELECT 1 FROM async_job_event_delivery_receipts r WHERE r.organization_id=e.organization_id AND r.event_id=e.event_id)
      UNION ALL SELECT e.creation_event_id AS event_id, e.occurred_at FROM async_job_creation_claim_events e
      WHERE e.organization_id=$1 AND e.project_id IS NOT DISTINCT FROM $2 AND NOT EXISTS (SELECT 1 FROM async_job_creation_claim_event_delivery_receipts r WHERE r.organization_id=e.organization_id AND r.creation_event_id=e.creation_event_id)
      ) pending ORDER BY occurred_at, event_id LIMIT $3`,
        [...this.#scopeValues(), this.#limit(input.limit)],
      ),
    );
    const entries: JobAuditOutboxEntryV1[] = [];
    for (const row of result.rows) {
      const entry = await this.#readAudit(
        this.#database,
        textColumn(row, "event_id"),
      );
      if (entry === null) persistenceFailure();
      entries.push(entry);
    }
    return entries;
  }
  public async markAuditEntryPublished(
    input: Parameters<JobRepository["markAuditEntryPublished"]>[0],
  ): Promise<void> {
    this.#assertScope(input.ownership);
    await this.#database.transaction(async (tx) => {
      const entry = await this.#readAudit(tx, input.eventId);
      if (entry === null)
        throw new JobFrameworkError(
          "job.audit-outbox-not-found",
          "The audit outbox entry was not found.",
        );
      const table =
        entry.kind === "job"
          ? "async_job_event_delivery_receipts"
          : "async_job_creation_claim_event_delivery_receipts";
      const key = entry.kind === "job" ? "event_id" : "creation_event_id";
      await tx.query(
        sql(
          `INSERT INTO ${table} (${key}, organization_id, project_id, published_at) VALUES ($1,$2,$3,$4::timestamptz) ON CONFLICT (${key}) DO NOTHING`,
          [
            input.eventId,
            ...this.#scopeValues(),
            utcTimestampSchema.parse(input.publishedAt),
          ],
        ),
      );
    });
  }
}
