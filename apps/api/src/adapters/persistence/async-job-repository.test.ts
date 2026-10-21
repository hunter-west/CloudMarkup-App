/* eslint-disable @typescript-eslint/require-await -- Scripted SQL/object ports are asynchronous production interfaces; these tests do not emulate PostgreSQL constraints. */
import { hashCanonicalValue } from "@cloudmarkup/domain";
import {
  createCreationClaimAuditOutboxEntryV1,
  createJobAuditOutboxEntryV1,
  DEFAULT_JOB_LIMITS_V1,
  type JobCreationClaimV1,
} from "@cloudmarkup/job-framework";
import {
  asyncJobTrustedActorV1Schema,
  asyncJobInputV1Schema,
  parseAsyncJobRecordV1,
  type AsyncJobRecordV1,
} from "@cloudmarkup/schemas";
import { describe, expect, it } from "vitest";

import {
  bytesOf,
  claimProjection,
  digestBytes,
  hex,
  recordProjection,
  type JobObjectReference,
} from "./async-job-repository-codec.js";
import {
  PostgresAsyncJobRepository,
  type AsyncJobPersistenceObjectPort,
} from "./async-job-repository.js";
import type {
  SqlDatabase,
  SqlExecutor,
  SqlResult,
  SqlRow,
  SqlStatement,
} from "./sql.js";

const at = "2026-09-05T12:00:00.000Z";
const later = "2026-09-05T12:00:01.000Z";
const ownership = {
  organizationId: "organization-1",
} as AsyncJobRecordV1["ownership"];

/** Statement-level test double only. Real SQL trigger/migration behavior is tested separately. */
class ScriptedDatabase implements SqlDatabase {
  readonly statements: SqlStatement[] = [];
  handler: (statement: SqlStatement) => SqlResult = () => ({
    rows: [],
    rowCount: 0,
  });
  transactions = 0;
  rollbacks = 0;
  referencedObjectsPresent = true;
  async close(): Promise<void> {
    return;
  }
  async query<TRow extends SqlRow = SqlRow>(
    statement: SqlStatement,
  ): Promise<SqlResult<TRow>> {
    this.statements.push(statement);
    if (statement.text.startsWith("SELECT object_id FROM stored_objects"))
      return {
        rows: this.referencedObjectsPresent
          ? [{ object_id: statement.values[2] } as unknown as TRow]
          : [],
        rowCount: this.referencedObjectsPresent ? 1 : 0,
      };
    return this.handler(statement) as SqlResult<TRow>;
  }
  async transaction<TResult>(
    work: (transaction: SqlExecutor) => Promise<TResult>,
  ): Promise<TResult> {
    this.transactions += 1;
    try {
      return await work(this);
    } catch (error) {
      this.rollbacks += 1;
      throw error;
    }
  }
}
class TestObjects implements AsyncJobPersistenceObjectPort {
  readonly bodies = new Map<string, Uint8Array>();
  readonly puts: Parameters<AsyncJobPersistenceObjectPort["put"]>[0][] = [];
  corruptDigest = false;
  corruptRead = false;
  async put(
    input: Parameters<AsyncJobPersistenceObjectPort["put"]>[0],
  ): Promise<JobObjectReference> {
    this.puts.push(input);
    const objectId = `object-${String(this.puts.length)}`;
    this.bodies.set(objectId, input.bytes);
    return {
      objectId,
      digest: this.corruptDigest ? hashCanonicalValue("wrong") : input.digest,
      sizeBytes: input.bytes.length,
    };
  }
  async get(
    input: Parameters<AsyncJobPersistenceObjectPort["get"]>[0],
  ): Promise<Uint8Array> {
    if (this.corruptRead) return bytesOf({ corrupted: true });
    const bytes = this.bodies.get(input.objectId);
    if (bytes === undefined) throw new Error("Test object missing");
    return bytes;
  }
  add(value: unknown): JobObjectReference {
    const bytes = bytesOf(value);
    const objectId = `seed-${String(this.bodies.size)}`;
    this.bodies.set(objectId, bytes);
    return { objectId, digest: digestBytes(bytes), sizeBytes: bytes.length };
  }
}
function fixture() {
  const database = new ScriptedDatabase();
  const objects = new TestObjects();
  const repository = new PostgresAsyncJobRepository({
    database,
    objects,
    ownership,
  });
  const input = asyncJobInputV1Schema.parse({
    contractVersion: 1,
    family: "billing-usage-reconciliation",
    subject: { kind: "organization" },
    periodStart: "2026-09-01T00:00:00.000Z",
    periodEnd: "2026-09-02T00:00:00.000Z",
    batch: {
      contractVersion: 1,
      objectId: "batch-1",
      digest: hashCanonicalValue("batch"),
      mediaType: "application/json",
      purpose: "input-payload",
      sizeBytes: 128,
    },
  });
  const record = parseAsyncJobRecordV1({
    attempts: [],
    cancellation: { state: "none" },
    checkpoints: [],
    contractVersion: 1,
    correlationId: "correlation-1",
    createdAt: at,
    family: input.family,
    idempotency: {
      actorId: "principal-1",
      keyDigest: hashCanonicalValue("key"),
      operationId: "jobs.create",
      requestDigest: hashCanonicalValue("request"),
    },
    input,
    inputDigest: hashCanonicalValue(input),
    inputSizeBytes: bytesOf(input).length,
    interaction: { state: "none" },
    jobId: "job-1",
    limits: DEFAULT_JOB_LIMITS_V1,
    orchestration: {
      dependencyJobIds: [],
      expectedChildJobIds: [],
      failurePolicy: "fail-parent",
      rootJobId: "job-1",
    },
    ownership,
    queuedAt: at,
    recordVersion: 1,
    reservation: { state: "none" },
    state: "queued",
    updatedAt: at,
  });
  const claim: JobCreationClaimV1 = {
    claimedAt: at,
    correlationId: record.correlationId,
    creation: {
      input,
      inputDigest: record.inputDigest,
      inputSizeBytes: record.inputSizeBytes,
      limits: record.limits,
      orchestration: record.orchestration,
      reservationRequested: false,
    },
    denial: null,
    entitlementDecision: null,
    idempotency: record.idempotency,
    jobId: record.jobId,
    ownership,
    recordVersion: 1,
    reservationDecision: null,
    status: "claimed",
    updatedAt: at,
  };
  const claimRow = (value = claim): SqlRow => {
    const reference = objects.add(value);
    const inputObject = objects.add(value.creation.input);
    return {
      ...claimProjection(value, inputObject),
      snapshot_object_id: reference.objectId,
      snapshot_sha256: hex(reference.digest),
      snapshot_size_bytes: reference.sizeBytes,
    };
  };
  const recordRow = (value = record): SqlRow => {
    const reference = objects.add(value);
    const inputObject = objects.add(value.input);
    const output =
      value.output === undefined ? null : objects.add(value.output);
    return {
      ...recordProjection(value, inputObject, output, "entitlement-1"),
      snapshot_object_id: reference.objectId,
      snapshot_sha256: hex(reference.digest),
      snapshot_size_bytes: reference.sizeBytes,
    };
  };
  const creationInput = {
    claimedAt: at,
    correlationId: record.correlationId,
    creation: claim.creation,
    idempotency: claim.idempotency,
    jobId: claim.jobId,
    ownership,
  };
  return {
    database,
    objects,
    repository,
    record,
    claim,
    claimRow,
    recordRow,
    creationInput,
  };
}
function result(row?: SqlRow): SqlResult {
  return {
    rowCount: row === undefined ? 0 : 1,
    rows: row === undefined ? [] : [row],
  };
}
function insertFields(
  statement: SqlStatement | undefined,
): Record<string, unknown> {
  if (statement === undefined) throw new Error("Expected SQL insert");
  const match = /INSERT INTO \w+ \(([^)]+)\)/.exec(statement.text);
  if (match?.[1] === undefined) throw new Error("Not an insert");
  return Object.fromEntries(
    match[1]
      .split(",")
      .map((column, index) => [column.trim(), statement.values[index]]),
  );
}
function creationAudits(record: AsyncJobRecordV1) {
  return (
    ["entitlement-authorized", "job-created", "job-enqueued"] as const
  ).map((eventType) =>
    createJobAuditOutboxEntryV1({
      actor: { kind: "principal", actorId: record.idempotency.actorId },
      eventType,
      occurredAt: at,
      record,
    }),
  );
}

describe("PostgresAsyncJobRepository statement and codec contract", () => {
  it("rejects foreign scopes before any database or object I/O", async () => {
    const f = fixture();
    await expect(
      f.repository.claimCreation({
        ...f.creationInput,
        ownership: {
          ...ownership,
          organizationId: "foreign" as typeof ownership.organizationId,
        },
      }),
    ).rejects.toMatchObject({ code: "job.scope-mismatch" });
    await expect(
      f.repository.listPendingAuditEntries({
        limit: 1,
        ownership: {
          ...ownership,
          projectId: "foreign" as NonNullable<typeof ownership.projectId>,
        },
      }),
    ).rejects.toMatchObject({ code: "job.scope-mismatch" });
    expect(f.database.statements).toEqual([]);
    expect(f.objects.puts).toEqual([]);
  });
  it("stores a claim, identity reservation and exact snapshot in one transaction after the idempotency lock", async () => {
    const f = fixture();
    const created = await f.repository.claimCreation(f.creationInput);
    expect(created).toEqual({ kind: "claimed", claim: f.claim });
    expect(f.database.transactions).toBe(1);
    expect(f.database.statements[0]?.text).toContain("pg_advisory_xact_lock");
    const insertStatement = f.database.statements.find((entry) =>
      entry.text.startsWith("INSERT INTO async_job_creation_claims "),
    );
    expect(insertStatement).toBeDefined();
    expect(insertFields(insertStatement)).toMatchObject({
      inline_input_size_bytes: f.record.inputSizeBytes,
      referenced_input_size_bytes: 128,
      actor_id: "principal-1",
      input_sha256: hex(f.record.inputDigest),
    });
    expect(f.database.statements.at(-1)?.text).toContain(
      "INSERT INTO async_job_claim_snapshots",
    );
    expect(f.objects.puts.map((put) => put.kind)).toEqual([
      "input",
      "creation-claim",
    ]);
  });
  it("rejects digest mismatch and changed object-port bytes without publishing a SQL claim", async () => {
    const f = fixture();
    await expect(
      f.repository.claimCreation({
        ...f.creationInput,
        creation: { ...f.claim.creation, inputSizeBytes: 1 },
      }),
    ).rejects.toMatchObject({ code: "job.input-authority-mismatch" });
    f.objects.corruptDigest = true;
    await expect(
      f.repository.claimCreation(f.creationInput),
    ).rejects.toMatchObject({ code: "job.persistence-integrity" });
    expect(f.database.rollbacks).toBe(1);
    expect(
      f.database.statements.some((entry) =>
        entry.text.startsWith("INSERT INTO async_job_creation_claims "),
      ),
    ).toBe(false);
  });
  it("rejects unpublished or foreign referenced input objects before creating the durable identity", async () => {
    const f = fixture();
    f.database.referencedObjectsPresent = false;
    await expect(
      f.repository.claimCreation(f.creationInput),
    ).rejects.toMatchObject({ code: "job.object-reference-mismatch" });
    const query = f.database.statements.find((entry) =>
      entry.text.startsWith("SELECT object_id FROM stored_objects"),
    );
    expect(query?.values).toEqual([
      ownership.organizationId,
      null,
      "batch-1",
      hex(hashCanonicalValue("batch")),
      128,
      "application/json",
      "input-payload",
    ]);
    expect(
      f.database.statements.some((entry) => entry.text.startsWith("INSERT")),
    ).toBe(false);
    expect(f.objects.puts).toEqual([]);
  });
  it("replays the same root request even when a retry generated a different proposed job ID", async () => {
    const f = fixture();
    const row = f.claimRow();
    f.database.handler = (query) =>
      query.text.includes("FROM async_job_creation_claims c")
        ? result(row)
        : result();
    const replay = await f.repository.claimCreation({
      ...f.creationInput,
      jobId: "retry-id" as typeof f.record.jobId,
      creation: {
        ...f.claim.creation,
        orchestration: {
          ...f.claim.creation.orchestration,
          rootJobId: "retry-id" as typeof f.record.jobId,
        },
      },
    });
    expect(replay).toEqual({ kind: "existing", claim: f.claim });
    expect(f.objects.puts).toEqual([]);
  });
  it("conflicts on same-key different request or project without leaking the original claim", async () => {
    const f = fixture();
    const row = f.claimRow();
    f.database.handler = (query) =>
      query.text.includes("FROM async_job_creation_claims c")
        ? result(row)
        : result();
    expect(
      await f.repository.claimCreation({
        ...f.creationInput,
        idempotency: {
          ...f.claim.idempotency,
          requestDigest: hashCanonicalValue("changed"),
        },
      }),
    ).toEqual({ kind: "conflict" });
    f.database.handler = (query) =>
      query.text.startsWith("SELECT project_id")
        ? result({ project_id: "another-project" })
        : result();
    expect(await f.repository.claimCreation(f.creationInput)).toEqual({
      kind: "conflict",
    });
  });
  it("reads an exact immutable record and fails closed on normalized drift, missing snapshots or changed bytes", async () => {
    const f = fixture();
    const row = f.recordRow();
    f.database.handler = () => result(row);
    expect(await f.repository.get("job-1")).toEqual(f.record);
    f.database.handler = () => result({ ...row, lifecycle_status: "running" });
    await expect(f.repository.get("job-1")).rejects.toMatchObject({
      code: "job.persistence-integrity",
    });
    f.database.handler = () => result({ ...row, snapshot_object_id: null });
    await expect(f.repository.get("job-1")).rejects.toMatchObject({
      code: "job.persistence-integrity",
    });
    f.database.handler = () => result(row);
    f.objects.corruptRead = true;
    await expect(f.repository.get("job-1")).rejects.toMatchObject({
      code: "job.persistence-integrity",
    });
  });
  it("preserves optional input fields and distinguishes typed output JSON length from measured output bytes", async () => {
    const f = fixture();
    const completed = parseAsyncJobRecordV1({
      ...f.record,
      completedAt: later,
      state: "succeeded",
      updatedAt: later,
      outputSizeBytes: 37,
      output: {
        contractVersion: 1,
        evidenceRecords: [],
        family: "billing-usage-reconciliation",
        reconciliation: {
          artifactId: "artifact-1",
          availability: { state: "available" },
          object: {
            contractVersion: 1,
            objectId: "report-1",
            digest: hashCanonicalValue("report"),
            mediaType: "application/json",
            purpose: "billing-reconciliation-result",
            sizeBytes: 37,
          },
        },
      },
    });
    const row = f.recordRow(completed);
    f.database.handler = () => result(row);
    expect(row["output_size_bytes"]).toBe(bytesOf(completed.output).length);
    expect(row["measured_output_size_bytes"]).toBe(37);
    expect(await f.repository.get("job-1")).toEqual(completed);
  });
  it("records entitlement with CAS and returns exact repeated decisions without another write", async () => {
    const f = fixture();
    let row = f.claimRow();
    f.database.handler = (query) =>
      query.text.includes("FROM async_job_creation_claims c")
        ? result(row)
        : query.text.startsWith("UPDATE")
          ? { rowCount: 1, rows: [] }
          : result();
    const decision = { allowed: true, decisionReference: "entitlement-1" };
    const claim = await f.repository.recordEntitlement(
      f.claim,
      decision,
      later,
    );
    expect(claim.recordVersion).toBe(2);
    expect(claim.entitlementDecision).toEqual(decision);
    const claimUpdate = f.database.statements.find((entry) =>
      entry.text.startsWith("UPDATE async_job_creation_claims SET "),
    );
    expect(
      claimUpdate?.text
        .split(" SET ")[1]
        ?.split(" WHERE ")[0]
        ?.split(", ")
        .map((assignment) => assignment.split("=")[0])
        .sort(),
    ).toEqual([
      "entitlement_decision_reference",
      "entitlement_outcome",
      "record_version",
      "updated_at",
    ]);
    row = f.claimRow(claim);
    const count = f.database.statements.length;
    expect(
      await f.repository.recordEntitlement(f.claim, decision, later),
    ).toEqual(claim);
    expect(
      f.database.statements
        .slice(count)
        .some((entry) => entry.text.startsWith("UPDATE")),
    ).toBe(false);
    await expect(
      f.repository.recordEntitlement(
        f.claim,
        { allowed: false, decisionReference: "changed" },
        later,
      ),
    ).rejects.toMatchObject({ code: "job.creation-claim-conflict" });
  });
  it("completes the approved claim and durable creation audit as one transaction", async () => {
    const f = fixture();
    const approved = {
      ...f.claim,
      entitlementDecision: {
        allowed: true,
        decisionReference: "entitlement-1",
      },
      recordVersion: 2,
    };
    const row = f.claimRow(approved);
    f.database.handler = (query) =>
      query.text.includes("FROM async_job_creation_claims c")
        ? result(row)
        : query.text.includes("AS next")
          ? result({ next: 1 })
          : query.text.startsWith("UPDATE")
            ? { rows: [], rowCount: 1 }
            : result();
    expect(
      await f.repository.completeCreation(
        approved,
        f.record,
        later,
        creationAudits(f.record),
      ),
    ).toEqual(f.record);
    expect(f.database.transactions).toBe(1);
    expect(
      f.database.statements.filter((entry) =>
        entry.text.startsWith("INSERT INTO async_job_events "),
      ),
    ).toHaveLength(3);
    expect(
      f.database.statements.some((entry) =>
        entry.text.startsWith("INSERT INTO async_job_record_snapshots"),
      ),
    ).toBe(true);
  });
  it("rejects completion without required audit before writing job state", async () => {
    const f = fixture();
    const approved = {
      ...f.claim,
      entitlementDecision: {
        allowed: true,
        decisionReference: "entitlement-1",
      },
      recordVersion: 2,
    };
    const row = f.claimRow(approved);
    f.database.handler = () => result(row);
    await expect(
      f.repository.completeCreation(approved, f.record, later, []),
    ).rejects.toMatchObject({ code: "job.audit-outbox-mismatch" });
    expect(
      f.database.statements.some((entry) => entry.text.startsWith("INSERT")),
    ).toBe(false);
  });
  it("preserves a denial source and stores denial and audit in the same transaction", async () => {
    const f = fixture();
    const row = f.claimRow();
    f.database.handler = (query) =>
      query.text.includes("FROM async_job_creation_claims c")
        ? result(row)
        : query.text.includes("AS next")
          ? result({ next: 1 })
          : query.text.startsWith("UPDATE")
            ? { rowCount: 1, rows: [] }
            : result();
    const denial = {
      code: "job.entitlement-denied",
      publicMessage: "job-not-supported" as const,
    };
    const audit = createCreationClaimAuditOutboxEntryV1({
      actor: { kind: "system", reason: "orphan-reconciler" },
      claim: f.claim,
      denial,
      denialSource: "recovery",
      occurredAt: later,
    });
    const denied = await f.repository.denyCreation(
      f.claim,
      denial,
      later,
      audit,
    );
    expect(denied.status).toBe("denied");
    const insertStatement = f.database.statements.find((entry) =>
      entry.text.startsWith("INSERT INTO async_job_creation_claim_events "),
    );
    expect(insertFields(insertStatement)).toMatchObject({
      denial_source: "recovery",
      claim_record_version: 2,
    });
    expect(f.database.transactions).toBe(1);
  });
  it("rejects stale mutations and requires exact transition-version audit", async () => {
    const f = fixture();
    const row = f.recordRow();
    f.database.handler = () => result(row);
    await expect(
      f.repository.saveWithAudit(f.record, 1, []),
    ).rejects.toMatchObject({ code: "job.audit-outbox-mismatch" });
    const next = parseAsyncJobRecordV1({
      ...f.record,
      recordVersion: 3,
      updatedAt: later,
    });
    const audit = createJobAuditOutboxEntryV1({
      actor: { kind: "system", reason: "scheduler" },
      eventType: "job-enqueued",
      occurredAt: later,
      record: next,
      transition: {
        at: later as NonNullable<typeof next.completedAt>,
        from: "queued",
        to: "queued",
        reason: "retry-scheduled",
        recordVersion: 3,
      },
    });
    await expect(
      f.repository.saveWithAudit(next, 2, [audit]),
    ).rejects.toMatchObject({ code: "job.write-conflict" });
    expect(
      f.database.statements.some((entry) => entry.text.startsWith("UPDATE")),
    ).toBe(false);
  });
  it("persists retry hints and retains SQL lease history when the typed terminal attempt omits its lease", async () => {
    const f = fixture();
    const running = parseAsyncJobRecordV1({
      ...f.record,
      state: "running",
      startedAt: at,
      recordVersion: 2,
      attempts: [
        {
          attemptId: "attempt-1",
          attemptNumber: 1,
          state: "running",
          startedAt: at,
          runtimeSeconds: 0,
          lease: {
            workerId: "worker-1",
            heartbeatAt: at,
            leaseExpiresAt: "2026-09-05T12:00:30.000Z",
          },
        },
      ],
    });
    const retry = parseAsyncJobRecordV1({
      ...running,
      state: "queued",
      recordVersion: 3,
      updatedAt: later,
      attempts: [
        {
          attemptId: "attempt-1",
          attemptNumber: 1,
          state: "failed",
          startedAt: at,
          completedAt: later,
          runtimeSeconds: 1,
          failure: {
            classification: "transient",
            code: "job.rate-limited",
            publicMessage: "job-temporarily-unavailable",
            retryAfterSeconds: 17,
          },
          retryDisposition: {
            kind: "retry",
            notBefore: "2026-09-05T12:00:18.000Z",
          },
        },
      ],
    });
    const row = f.recordRow(running);
    f.database.handler = (query) =>
      query.text.includes("FROM async_jobs j")
        ? result(row)
        : query.text.includes("AS next")
          ? result({ next: 1 })
          : query.text.startsWith("UPDATE")
            ? { rowCount: 1, rows: [] }
            : result();
    const audit = createJobAuditOutboxEntryV1({
      actor: asyncJobTrustedActorV1Schema.parse({
        kind: "worker",
        workerId: "worker-1",
      }),
      eventType: "retry-scheduled",
      occurredAt: later,
      record: retry,
      transition: {
        at: retry.updatedAt,
        from: "running",
        to: "queued",
        reason: "retry-scheduled",
        recordVersion: 3,
      },
    });
    expect(await f.repository.saveWithAudit(retry, 2, [audit])).toEqual(retry);
    const attemptSql = f.database.statements.find((query) =>
      query.text.startsWith("UPDATE async_job_attempts"),
    );
    expect(attemptSql?.text).toContain("failure_retry_after_seconds");
    expect(attemptSql?.text).not.toContain("worker_reference=");
    expect(attemptSql?.text).not.toContain("SET attempt_id=");
    expect(attemptSql?.values).toContain(17);
    expect(attemptSql?.values).toContain("attempt-1");
    expect(attemptSql?.values).toContain("2026-09-05T12:00:30.000Z");
    expect(retry.attempts[0]?.lease).toBeUndefined();
  });
  it("persists cancellation acknowledgement and preserves the distinct audit transition instant", async () => {
    const f = fixture();
    const row = f.recordRow();
    const canceled = parseAsyncJobRecordV1({
      ...f.record,
      state: "canceled",
      completedAt: later,
      updatedAt: later,
      recordVersion: 2,
      cancellation: {
        state: "acknowledged",
        requestedBy: "principal-1",
        requestedAt: at,
        acknowledgedAt: later,
      },
    });
    f.database.handler = (query) =>
      query.text.includes("FROM async_jobs j")
        ? result(row)
        : query.text.includes("AS next")
          ? result({ next: 1 })
          : query.text.startsWith("UPDATE")
            ? { rowCount: 1, rows: [] }
            : result();
    const audit = createJobAuditOutboxEntryV1({
      actor: { kind: "system", reason: "scheduler" },
      eventType: "job-canceled",
      occurredAt: later,
      record: canceled,
      transition: {
        at: canceled.createdAt,
        from: "queued",
        to: "canceled",
        reason: "cancellation-acknowledged",
        recordVersion: 2,
      },
    });
    expect(await f.repository.saveWithAudit(canceled, 1, [audit])).toEqual(
      canceled,
    );
    const auditSql = f.database.statements.find((query) =>
      query.text.startsWith("INSERT INTO async_job_events "),
    );
    expect(insertFields(auditSql)).toMatchObject({
      transition_at: at,
      occurred_at: later,
    });
    const updated = f.database.statements.find((query) =>
      query.text.startsWith("UPDATE async_jobs"),
    );
    expect(updated?.text).toContain("cancellation_acknowledged_at");
    expect(updated?.text.split(" SET ")[1]?.split(" WHERE ")[0]).not.toMatch(
      /(?:organization_id|project_id|job_id|input_object_id)=/u,
    );
    expect(f.database.transactions).toBe(1);
  });
  it("locks normalized claim authority before reading its version snapshot", async () => {
    const f = fixture();
    const row = f.claimRow();
    f.database.handler = (query) =>
      query.text.includes("FROM async_job_creation_claims c")
        ? result(row)
        : query.text.startsWith("UPDATE")
          ? { rowCount: 1, rows: [] }
          : result();
    await f.repository.recordEntitlement(
      f.claim,
      { allowed: true, decisionReference: "entitlement-1" },
      later,
    );
    const lockIndex = f.database.statements.findIndex((query) =>
      query.text.includes("FOR UPDATE OF c"),
    );
    const snapshotIndex = f.database.statements.findIndex((query) =>
      query.text.includes("LEFT JOIN async_job_claim_snapshots"),
    );
    expect(lockIndex).toBeGreaterThanOrEqual(0);
    expect(snapshotIndex).toBeGreaterThan(lockIndex);
    expect(f.database.statements[snapshotIndex]?.text).not.toContain(
      "FOR UPDATE",
    );
    expect(f.database.statements[lockIndex]?.values).toEqual([
      ownership.organizationId,
      null,
      f.claim.idempotency.operationId,
      hex(f.claim.idempotency.keyDigest),
    ]);
  });
  it("reads the committed snapshot after the job lock and returns a version conflict for a waiting contender", async () => {
    const f = fixture();
    const newer = parseAsyncJobRecordV1({
      ...f.record,
      recordVersion: 2,
      updatedAt: later,
    });
    const row = f.recordRow(newer);
    f.database.handler = (query) =>
      query.text.includes("FOR UPDATE OF j")
        ? result({ job_id: newer.jobId })
        : query.text.includes("LEFT JOIN async_job_record_snapshots")
          ? result(row)
          : result();
    const audit = createJobAuditOutboxEntryV1({
      actor: { kind: "system", reason: "scheduler" },
      eventType: "job-enqueued",
      occurredAt: later,
      record: newer,
      transition: {
        at: newer.updatedAt,
        from: "queued",
        to: "queued",
        reason: "retry-scheduled",
        recordVersion: 2,
      },
    });
    await expect(
      f.repository.saveWithAudit(newer, 1, [audit]),
    ).rejects.toMatchObject({ code: "job.write-conflict" });
    expect(f.database.statements[0]?.text).toContain("FOR UPDATE OF j");
    expect(f.database.statements[1]?.text).toContain(
      "LEFT JOIN async_job_record_snapshots",
    );
    expect(f.database.statements[1]?.text).not.toContain("FOR UPDATE");
    expect(
      f.database.statements.some((query) => query.text.startsWith("UPDATE")),
    ).toBe(false);
  });
  it("binds reconciliation filters and limits to exact ownership before LIMIT", async () => {
    const f = fixture();
    await f.repository.listQueuedJobsReadyForDispatch({
      availableAtOrBefore: later,
      limit: 7,
      ownership,
    });
    const query = f.database.statements[0];
    if (query === undefined) throw new Error("Expected SQL statement");
    expect(query.text).toContain(
      "j.organization_id=$1 AND j.project_id IS NOT DISTINCT FROM $2",
    );
    expect(query.text).toContain("retry_not_before");
    expect(query.text).toContain("LIMIT $4");
    expect(query.values).toEqual([ownership.organizationId, null, later, 7]);
    await expect(
      f.repository.listStaleCreationClaims({
        limit: 1001,
        ownership,
        updatedBefore: later,
      }),
    ).rejects.toMatchObject({ code: "job.invalid-list-limit" });
  });
  it("aborts the state-and-audit transaction when an event identity collides with another outbox scope or kind", async () => {
    const f = fixture();
    const approved = {
      ...f.claim,
      entitlementDecision: {
        allowed: true,
        decisionReference: "entitlement-1",
      },
      recordVersion: 2,
    };
    const row = f.claimRow(approved);
    f.database.handler = (query) =>
      query.text.includes("FROM async_job_creation_claims c")
        ? result(row)
        : query.text.startsWith("SELECT 1 AS collision")
          ? result({ collision: 1 })
          : query.text.startsWith("UPDATE")
            ? { rowCount: 1, rows: [] }
            : result();
    await expect(
      f.repository.completeCreation(
        approved,
        f.record,
        later,
        creationAudits(f.record),
      ),
    ).rejects.toMatchObject({ code: "job.audit-event-collision" });
    expect(f.database.rollbacks).toBe(1);
    expect(
      f.database.statements.some((query) =>
        query.text.startsWith("INSERT INTO async_job_events "),
      ),
    ).toBe(false);
  });
});
