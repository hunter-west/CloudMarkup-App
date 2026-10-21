import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import {
  applyAsyncJobLifecycleCommandV1,
  createAsyncJobRecordV1,
  getAsyncJobInputDigestV1,
  getAsyncJobInputSizeBytesV1,
  hashCanonicalValue,
  type AsyncJobLifecycleResultV1,
} from "@cloudmarkup/domain";
import {
  createCreationClaimAuditOutboxEntryV1,
  createJobAuditOutboxEntryV1,
} from "@cloudmarkup/job-framework";
import {
  asyncJobAttemptIdSchema,
  asyncJobCheckpointV1Schema,
  asyncJobIdempotencyClaimV1Schema,
  asyncJobIdSchema,
  asyncJobInputV1Schema,
  asyncJobObjectReferenceV1Schema,
  asyncJobTrustedActorV1Schema,
  asyncJobTrustedContextV1Schema,
  asyncJobTrustedOwnershipV1Schema,
  asyncJobWorkerIdSchema,
  namespacedIdentifierSchema,
  type AsyncJobAuditEventV1,
  type AsyncJobRecordV1,
} from "@cloudmarkup/schemas";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  bytesOf,
  digestBytes,
  hex,
  type JobObjectReference,
} from "./async-job-repository-codec.js";
import {
  PostgresAsyncJobRepository,
  type AsyncJobPersistenceObjectPort,
} from "./async-job-repository.js";
import { runMigrations } from "./migrations.js";
import { loadHistoricalBetaMigrations } from "./historical-beta-migrations-test-helper.js";
import { PostgresDatabase } from "./postgres-driver.js";
import { sql } from "./sql.js";
import { withDataApiTypes } from "./data-api-postgres-test-helpers.js";

const configuredUrl = process.env["CLOUDMARKUP_TEST_DATABASE_URL"]?.trim();
const integrationDescribe =
  configuredUrl === undefined || configuredUrl === ""
    ? describe.skip
    : describe;
const runId = randomUUID().replaceAll("-", "");
const schemaName = `cm_async_job_it_${runId}`;
const schemaMarker = `CloudMarkup synthetic async job integration ${runId}`;
const at = "2026-09-05T12:00:00.000Z";
const atSecond = (second: number): string =>
  new Date(Date.parse(at) + second * 1000).toISOString();
const id = (prefix: string): string =>
  `${prefix}_${randomUUID().replaceAll("-", "")}`;

function localDatabaseUrl(): string {
  if (configuredUrl === undefined || configuredUrl === "")
    throw new Error("A loopback PostgreSQL test URL is required.");
  let parsed: URL;
  try {
    parsed = new URL(configuredUrl);
  } catch {
    // Do not include a credential-bearing URL in a native URL parsing error.
    throw new Error("The PostgreSQL integration URL is invalid.");
  }
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname) ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    !/^\/[A-Za-z][A-Za-z0-9_]{0,62}$/u.test(parsed.pathname)
  ) {
    throw new Error(
      "Async job integration accepts only an explicit loopback PostgreSQL URL, database name, and no query/fragment overrides.",
    );
  }
  return configuredUrl;
}

/** Only object bodies are substituted. Every metadata write, FK, trigger, CAS,
 * transaction and audit operation in these tests executes against PostgreSQL.
 * This test-only port is not a production persistence fallback. */
class IntegrationObjects implements AsyncJobPersistenceObjectPort {
  readonly #database: PostgresDatabase;
  readonly #principalId: string;
  readonly #ownership: AsyncJobRecordV1["ownership"];
  readonly #bodies = new Map<string, Uint8Array>();

  constructor(
    database: PostgresDatabase,
    principalId: string,
    ownership: AsyncJobRecordV1["ownership"],
  ) {
    this.#database = database;
    this.#principalId = principalId;
    this.#ownership = ownership;
  }

  async publish(
    value: unknown,
    purpose: string,
  ): Promise<ReturnType<typeof asyncJobObjectReferenceV1Schema.parse>> {
    const bytes = bytesOf(value);
    const reference = await this.#publishBytes(
      bytes,
      digestBytes(bytes),
      purpose,
    );
    return asyncJobObjectReferenceV1Schema.parse({
      ...reference,
      contractVersion: 1,
      mediaType: "application/json",
      purpose,
    });
  }

  async #publishBytes(
    bytes: Uint8Array,
    digest: JobObjectReference["digest"],
    purpose: string,
  ): Promise<JobObjectReference> {
    const objectId = id("object");
    await this.#database.query(
      sql(
        `INSERT INTO stored_objects (
      object_id, organization_id, project_id, storage_provider, object_purpose,
      storage_key, object_version, content_sha256, size_bytes, media_type,
      lifecycle_state, created_by_principal_id, created_at, published_at
    ) VALUES ($1,$2,$3,'memory',$4,$5,'1',$6,$7,'application/json','published',$8,$9,$9)`,
        [
          objectId,
          this.#ownership.organizationId,
          this.#ownership.projectId ?? null,
          purpose,
          `${schemaName}/${objectId}`,
          hex(digest),
          bytes.length,
          this.#principalId,
          at,
        ],
      ),
    );
    this.#bodies.set(objectId, bytes);
    return { objectId, digest, sizeBytes: bytes.length };
  }

  async put(
    input: Parameters<AsyncJobPersistenceObjectPort["put"]>[0],
  ): Promise<JobObjectReference> {
    expect(input.ownership).toEqual(this.#ownership);
    expect(digestBytes(input.bytes)).toBe(input.digest);
    return this.#publishBytes(
      input.bytes,
      input.digest,
      input.kind === "input" ? "input-payload" : "report",
    );
  }

  async get(
    input: Parameters<AsyncJobPersistenceObjectPort["get"]>[0],
  ): Promise<Uint8Array> {
    expect(input.ownership).toEqual(this.#ownership);
    const result = await this.#database.query(
      sql(
        "SELECT object_id FROM stored_objects WHERE organization_id=$1 AND project_id IS NOT DISTINCT FROM $2 AND object_id=$3 AND content_sha256=$4 AND size_bytes=$5 AND object_purpose=$6 AND lifecycle_state='published'",
        [
          this.#ownership.organizationId,
          this.#ownership.projectId ?? null,
          input.objectId,
          hex(input.digest),
          input.sizeBytes,
          input.kind === "input" ? "input-payload" : "report",
        ],
      ),
    );
    if (result.rows.length !== 1)
      throw new Error(
        "Integration object metadata does not match its exact scope.",
      );
    const bytes = this.#bodies.get(input.objectId);
    if (bytes === undefined)
      throw new Error("Integration object body is missing.");
    return bytes;
  }
}

interface Fixture {
  readonly claimInput: Parameters<
    PostgresAsyncJobRepository["claimCreation"]
  >[0];
  readonly objects: IntegrationObjects;
  readonly principalId: string;
  readonly record: AsyncJobRecordV1;
  readonly repository: PostgresAsyncJobRepository;
}

function creationAudits(record: AsyncJobRecordV1) {
  return (
    ["entitlement-authorized", "job-created", "job-enqueued"] as const
  ).map((eventType) =>
    createJobAuditOutboxEntryV1({
      actor: { kind: "principal", actorId: record.idempotency.actorId },
      eventType,
      occurredAt: record.createdAt,
      record,
    }),
  );
}
function handler(record: AsyncJobRecordV1) {
  return {
    family: record.family,
    handlerId: namespacedIdentifierSchema.parse(
      "cloudmarkup.integration.handler",
    ),
    handlerVersion: "1.0.0",
    resumePolicy: "restart-from-input" as const,
  };
}
function authority(record: AsyncJobRecordV1, second: number) {
  return {
    at: atSecond(second),
    expectedInputDigest: record.inputDigest,
    expectedRecordVersion: record.recordVersion,
  };
}
function claimAttempt(
  record: AsyncJobRecordV1,
  second = 2,
  worker = "worker-integration",
): AsyncJobLifecycleResultV1 {
  return applyAsyncJobLifecycleCommandV1(record, {
    ...authority(record, second),
    attemptId: asyncJobAttemptIdSchema.parse(id("attempt")),
    dependencies: [],
    handler: handler(record),
    kind: "claim",
    leaseExpiresAt: atSecond(second + 60),
    workerId: asyncJobWorkerIdSchema.parse(worker),
  });
}
async function saveResult(
  repository: PostgresAsyncJobRepository,
  previous: AsyncJobRecordV1,
  result: AsyncJobLifecycleResultV1,
  eventType: AsyncJobAuditEventV1["eventType"],
): Promise<AsyncJobRecordV1> {
  if (result.transition === undefined)
    throw new Error("Integration fixture requires a lifecycle transition.");
  const audit = createJobAuditOutboxEntryV1({
    actor: asyncJobTrustedActorV1Schema.parse({
      kind: "worker",
      workerId: "worker-integration",
    }),
    eventType,
    occurredAt: result.job.updatedAt,
    record: result.job,
    transition: result.transition,
  });
  return repository.saveWithAudit(result.job, previous.recordVersion, [audit]);
}

integrationDescribe("async repository on isolated loopback PostgreSQL", () => {
  let administration: PostgresDatabase | undefined;
  let database: PostgresDatabase;
  let openedDatabase: PostgresDatabase | undefined;
  let createdSchema = false;
  let expectedMigrationCount = 0;

  beforeAll(async () => {
    const connectionString = localDatabaseUrl();
    if (!/^cm_async_job_it_[a-f0-9]{32}$/u.test(schemaName))
      throw new Error("Unsafe integration schema name.");
    administration = new PostgresDatabase({
      connectionString,
      max: 1,
      application_name: "cloudmarkup-async-integration-admin",
      connectionTimeoutMillis: 5000,
    });
    // The identifier and marker are generated by this test, never URL input.
    await administration.transaction(async (transaction) => {
      await transaction.query(sql(`CREATE SCHEMA "${schemaName}"`));
      await transaction.query(
        sql(`COMMENT ON SCHEMA "${schemaName}" IS '${schemaMarker}'`),
      );
    });
    createdSchema = true;
    database = new PostgresDatabase({
      connectionString,
      max: 8,
      application_name: "cloudmarkup-async-integration",
      options: `-c search_path=${schemaName} -c timezone=UTC`,
      connectionTimeoutMillis: 5000,
    });
    openedDatabase = database;
    const migrations = await loadHistoricalBetaMigrations(
      fileURLToPath(new URL("../../../migrations", import.meta.url)),
    );
    expectedMigrationCount = migrations.length;
    await runMigrations(database, migrations);
    await runMigrations(database, migrations);
  }, 60_000);

  afterAll(async () => {
    try {
      await openedDatabase?.close();
      if (createdSchema && administration !== undefined) {
        const marker = await administration.query(
          sql(
            "SELECT obj_description(oid, 'pg_namespace') AS marker FROM pg_namespace WHERE nspname=$1",
            [schemaName],
          ),
        );
        if (
          marker.rows[0]?.["marker"] !== schemaMarker ||
          !/^cm_async_job_it_[a-f0-9]{32}$/u.test(schemaName)
        )
          throw new Error(
            "Refusing cleanup of an unverified integration schema.",
          );
        // Transactional DDL preserves the exact synthetic schema if cleanup
        // fails; a successful drop removes only fixtures reproducible here.
        await administration.transaction(async (transaction) => {
          await transaction.query(sql(`DROP SCHEMA "${schemaName}" CASCADE`));
        });
      }
    } finally {
      await administration?.close();
    }
  }, 30_000);

  async function fixture(): Promise<Fixture> {
    const principalId = id("principal");
    const organizationId = id("organization");
    await database.transaction(async (transaction) => {
      await transaction.query(
        sql(
          "INSERT INTO principals(principal_id,display_name) VALUES ($1,'Synthetic async integration')",
          [principalId],
        ),
      );
      await transaction.query(
        sql(
          "INSERT INTO organizations(organization_id,display_name,slug) VALUES ($1,'Synthetic async integration',$2)",
          [organizationId, `async-${organizationId.replaceAll("_", "-")}`],
        ),
      );
    });
    const ownership = asyncJobTrustedOwnershipV1Schema.parse({
      organizationId,
    });
    const objects = new IntegrationObjects(database, principalId, ownership);
    const batch = await objects.publish({ entries: [] }, "input-payload");
    const input = asyncJobInputV1Schema.parse({
      batch,
      contractVersion: 1,
      family: "billing-usage-reconciliation",
      periodStart: "2026-09-01T00:00:00.000Z",
      periodEnd: "2026-09-02T00:00:00.000Z",
      subject: { kind: "organization" },
    });
    const context = asyncJobTrustedContextV1Schema.parse({
      actor: { kind: "principal", actorId: principalId },
      correlationId: id("correlation"),
      ownership,
    });
    const record = createAsyncJobRecordV1({
      context,
      createdAt: at,
      expiresAt: atSecond(300),
      idempotency: asyncJobIdempotencyClaimV1Schema.parse({
        actorId: principalId,
        keyDigest: hashCanonicalValue(id("key")),
        operationId: "jobs.create",
        requestDigest: hashCanonicalValue(input),
      }),
      input,
      inputDigest: getAsyncJobInputDigestV1(input),
      inputSizeBytes: getAsyncJobInputSizeBytesV1(input),
      jobId: asyncJobIdSchema.parse(id("job")),
      reservation: { state: "none" },
    }).job;
    const claimInput: Fixture["claimInput"] = {
      claimedAt: at,
      correlationId: record.correlationId,
      creation: {
        expiresAt: atSecond(300),
        input,
        inputDigest: record.inputDigest,
        inputSizeBytes: record.inputSizeBytes,
        limits: record.limits,
        orchestration: record.orchestration,
        reservationRequested: false,
      },
      idempotency: record.idempotency,
      jobId: record.jobId,
      ownership,
    };
    return {
      claimInput,
      objects,
      principalId,
      record,
      repository: new PostgresAsyncJobRepository({
        database: withDataApiTypes(database),
        objects,
        ownership,
      }),
    };
  }

  async function createQueued(f: Fixture): Promise<AsyncJobRecordV1> {
    const claim = await f.repository.claimCreation(f.claimInput);
    if (claim.kind !== "claimed")
      throw new Error("Expected a new integration claim.");
    const approved = await f.repository.recordEntitlement(
      claim.claim,
      { allowed: true, decisionReference: id("entitlement") },
      atSecond(1),
    );
    return f.repository.completeCreation(
      approved,
      f.record,
      atSecond(1),
      creationAudits(f.record),
    );
  }

  it("migrates the isolated schema completely and keeps repeated migration idempotent", async () => {
    const applied = await database.query(
      sql("SELECT version FROM cloudmarkup_schema_migrations ORDER BY version"),
    );
    expect(applied.rows.at(-2)?.["version"]).toBe("0098");
    expect(applied.rows.at(-1)?.["version"]).toBe("0138");
    expect(applied.rows).toHaveLength(expectedMigrationCount);
    const current = await database.query(
      sql("SELECT current_schema() AS schema"),
    );
    expect(current.rows[0]?.["schema"]).toBe(schemaName);
  });

  it("serializes actual concurrent idempotency claims and atomically completes the normalized job, snapshot, and audit outbox", async () => {
    const f = await fixture();
    const claims = await Promise.all([
      f.repository.claimCreation(f.claimInput),
      f.repository.claimCreation(f.claimInput),
    ]);
    expect(claims.map((entry) => entry.kind).sort()).toEqual([
      "claimed",
      "existing",
    ]);
    const first = claims[0];
    if (first.kind === "conflict")
      throw new Error("Expected exact claim replay.");
    const approved = await f.repository.recordEntitlement(
      first.claim,
      { allowed: true, decisionReference: id("entitlement") },
      atSecond(1),
    );
    const queued = await f.repository.completeCreation(
      approved,
      f.record,
      atSecond(1),
      creationAudits(f.record),
    );
    expect(await f.repository.get(queued.jobId)).toEqual(queued);
    expect(
      await f.repository.claimCreation({
        ...f.claimInput,
        idempotency: {
          ...f.claimInput.idempotency,
          requestDigest: hashCanonicalValue("different"),
        },
      }),
    ).toEqual({ kind: "conflict" });
    const pending = await f.repository.listPendingAuditEntries({
      limit: 10,
      ownership: queued.ownership,
    });
    expect(pending).toHaveLength(3);
    const event = pending[0];
    if (event === undefined) throw new Error("Expected durable audit event.");
    await f.repository.markAuditEntryPublished({
      eventId: event.event.eventId,
      ownership: queued.ownership,
      publishedAt: atSecond(2),
    });
    await f.repository.markAuditEntryPublished({
      eventId: event.event.eventId,
      ownership: queued.ownership,
      publishedAt: atSecond(3),
    });
    expect(
      await f.repository.listPendingAuditEntries({
        limit: 10,
        ownership: queued.ownership,
      }),
    ).toHaveLength(2);
    const persisted = await database.query(
      sql(
        "SELECT (SELECT count(*) FROM async_job_record_snapshots WHERE job_id=$1)::integer AS snapshots, (SELECT count(*) FROM async_job_events WHERE job_id=$1)::integer AS events",
        [queued.jobId],
      ),
    );
    expect(persisted.rows[0]).toMatchObject({ snapshots: 1, events: 3 });
  });

  it("enforces one winning CAS/lease against concurrent actual PostgreSQL transactions", async () => {
    const f = await fixture();
    const queued = await createQueued(f);
    const attempts = [
      claimAttempt(queued, 2, "worker-one"),
      claimAttempt(queued, 2, "worker-two"),
    ];
    const outcomes = await Promise.allSettled(
      attempts.map((attempt) =>
        saveResult(f.repository, queued, attempt, "attempt-claimed"),
      ),
    );
    expect(
      outcomes.filter((outcome) => outcome.status === "fulfilled"),
    ).toHaveLength(1);
    const rejected = outcomes.find((outcome) => outcome.status === "rejected");
    expect(rejected).toMatchObject({
      status: "rejected",
      reason: { code: "job.write-conflict" },
    });
    const persisted = await f.repository.get(queued.jobId);
    expect(persisted?.recordVersion).toBe(2);
    expect(persisted?.attempts).toHaveLength(1);
    const running = await database.query(
      sql(
        "SELECT count(*)::integer AS count FROM async_job_attempts WHERE job_id=$1 AND lifecycle_status='running'",
        [queued.jobId],
      ),
    );
    expect(running.rows[0]?.["count"]).toBe(1);
  });

  it("persists a checkpoint, exact retry hint and retained lease, then cancellation, with immutable and bounded SQL checks", async () => {
    const f = await fixture();
    const queued = await createQueued(f);
    let running = await saveResult(
      f.repository,
      queued,
      claimAttempt(queued),
      "attempt-claimed",
    );
    const attempt = running.attempts[0];
    if (attempt === undefined) throw new Error("Expected a running attempt.");
    const state = await f.objects.publish(
      { cursor: "synthetic-checkpoint" },
      "checkpoint-state",
    );
    const checkpoint = asyncJobCheckpointV1Schema.parse({
      attemptNumber: 1,
      checkpointId: id("checkpoint"),
      createdAt: atSecond(3),
      handlerId: handler(running).handlerId,
      handlerVersion: "1.0.0",
      inputDigest: running.inputDigest,
      sequence: 1,
      state,
    });
    const checkpointed = applyAsyncJobLifecycleCommandV1(running, {
      ...authority(running, 3),
      attemptId: attempt.attemptId,
      checkpoint,
      handler: handler(running),
      kind: "record-checkpoint",
      workerId: asyncJobWorkerIdSchema.parse("worker-integration"),
    });
    running = await saveResult(
      f.repository,
      running,
      checkpointed,
      "checkpoint-recorded",
    );
    await expect(
      database.query(
        sql(
          "UPDATE async_job_checkpoints SET size_bytes=size_bytes+1 WHERE checkpoint_id=$1",
          [checkpoint.checkpointId],
        ),
      ),
    ).rejects.toMatchObject({ code: "55000" });
    await expect(
      database.query(
        sql(
          "UPDATE async_job_attempts SET failure_retry_after_seconds=1 WHERE attempt_id=$1",
          [attempt.attemptId],
        ),
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      database.query(
        sql(
          "UPDATE async_job_attempts SET lifecycle_status='failed', failure_classification='permanent', safe_failure_code='job.invalid', public_failure_message='job-input-invalid', retry_disposition='do-not-retry', completed_at=$2, runtime_seconds=2, failure_retry_after_seconds=1 WHERE attempt_id=$1",
          [attempt.attemptId, atSecond(4)],
        ),
      ),
    ).rejects.toMatchObject({ code: "23514" });
    const retried = applyAsyncJobLifecycleCommandV1(running, {
      ...authority(running, 4),
      attemptId: attempt.attemptId,
      handler: handler(running),
      kind: "complete-attempt",
      outcome: {
        outcome: "failed",
        failure: {
          classification: "transient",
          code: "job.rate-limited",
          publicMessage: "job-temporarily-unavailable",
          retryAfterSeconds: 17,
        },
      },
      workerId: asyncJobWorkerIdSchema.parse("worker-integration"),
    });
    const retry = await saveResult(
      f.repository,
      running,
      retried,
      "retry-scheduled",
    );
    expect(retry.attempts[0]?.lease).toBeUndefined();
    expect(retry.attempts[0]?.failure?.retryAfterSeconds).toBe(17);
    const lease = await database.query(
      sql(
        "SELECT worker_reference, failure_retry_after_seconds, lease_expires_at FROM async_job_attempts WHERE attempt_id=$1",
        [attempt.attemptId],
      ),
    );
    expect(lease.rows[0]).toMatchObject({
      worker_reference: "worker-integration",
      failure_retry_after_seconds: 17,
    });
    expect(lease.rows[0]?.["lease_expires_at"]).not.toBeNull();
    expect(
      await f.repository.listQueuedJobsReadyForDispatch({
        availableAtOrBefore: atSecond(20),
        limit: 10,
        ownership: retry.ownership,
      }),
    ).toEqual([]);
    expect(
      await f.repository.listQueuedJobsReadyForDispatch({
        availableAtOrBefore: atSecond(21),
        limit: 10,
        ownership: retry.ownership,
      }),
    ).toEqual([retry]);
    const cancellation = applyAsyncJobLifecycleCommandV1(retry, {
      ...authority(retry, 22),
      context: asyncJobTrustedContextV1Schema.parse({
        actor: { kind: "principal", actorId: f.principalId },
        correlationId: retry.correlationId,
        ownership: retry.ownership,
      }),
      kind: "request-cancellation",
    });
    const canceled = await saveResult(
      f.repository,
      retry,
      cancellation,
      "job-canceled",
    );
    expect(canceled.state).toBe("canceled");
    expect(canceled.cancellation.state).toBe("acknowledged");
    expect(await f.repository.get(canceled.jobId)).toEqual(canceled);
  });

  it("stores output JSON size independently of measured artifact bytes under real object and snapshot constraints", async () => {
    const f = await fixture();
    const queued = await createQueued(f);
    const running = await saveResult(
      f.repository,
      queued,
      claimAttempt(queued),
      "attempt-claimed",
    );
    const attempt = running.attempts[0];
    if (attempt === undefined) throw new Error("Expected a running attempt.");
    const outputObject = await f.objects.publish(
      { reconciled: 7 },
      "billing-reconciliation-result",
    );
    const completed = applyAsyncJobLifecycleCommandV1(running, {
      ...authority(running, 3),
      attemptId: attempt.attemptId,
      handler: handler(running),
      kind: "complete-attempt",
      workerId: asyncJobWorkerIdSchema.parse("worker-integration"),
      outcome: {
        outcome: "succeeded",
        outputSizeBytes: outputObject.sizeBytes,
        output: {
          contractVersion: 1,
          evidenceRecords: [],
          family: "billing-usage-reconciliation",
          reconciliation: {
            artifactId: id("artifact"),
            availability: { state: "available" },
            object: outputObject,
          },
        },
      },
    });
    const succeeded = await saveResult(
      f.repository,
      running,
      completed,
      "job-succeeded",
    );
    expect(await f.repository.get(succeeded.jobId)).toEqual(succeeded);
    const sizes = await database.query(
      sql(
        "SELECT output_size_bytes::integer AS json_bytes, measured_output_size_bytes::integer AS measured_bytes FROM async_jobs WHERE job_id=$1",
        [succeeded.jobId],
      ),
    );
    expect(sizes.rows[0]).toEqual({
      json_bytes: bytesOf(succeeded.output).length,
      measured_bytes: outputObject.sizeBytes,
    });
    expect(sizes.rows[0]?.["json_bytes"]).not.toBe(
      sizes.rows[0]?.["measured_bytes"],
    );
  });

  it("rolls back a real lifecycle transaction when durable audit publication identities collide", async () => {
    const f = await fixture();
    const queued = await createQueued(f);
    const transition = claimAttempt(queued);
    if (transition.transition === undefined)
      throw new Error("Expected transition.");
    const existing = creationAudits(queued)[0];
    if (existing === undefined) throw new Error("Expected creation audit.");
    await expect(
      f.repository.saveWithAudit(transition.job, queued.recordVersion, [
        {
          kind: "job",
          event: { ...existing.event, transition: transition.transition },
        },
      ]),
    ).rejects.toMatchObject({ code: "job.audit-event-collision" });
    expect(await f.repository.get(queued.jobId)).toEqual(queued);
    const counts = await database.query(
      sql(
        "SELECT (SELECT count(*) FROM async_job_attempts WHERE job_id=$1)::integer AS attempts, (SELECT count(*) FROM async_job_record_snapshots WHERE job_id=$1)::integer AS snapshots, (SELECT count(*) FROM async_job_events WHERE job_id=$1)::integer AS events",
        [queued.jobId],
      ),
    );
    expect(counts.rows[0]).toEqual({ attempts: 0, snapshots: 1, events: 3 });
  });

  it("denies foreign referenced objects and cross-tenant job reads at actual SQL boundaries", async () => {
    const own = await fixture();
    const foreign = await fixture();
    const queued = await createQueued(foreign);
    expect(await own.repository.get(queued.jobId)).toBeNull();
    const foreignInput = foreign.record.input;
    const badInput = {
      ...own.claimInput,
      creation: {
        ...own.claimInput.creation,
        input: foreignInput,
        inputDigest: getAsyncJobInputDigestV1(foreignInput),
        inputSizeBytes: getAsyncJobInputSizeBytesV1(foreignInput),
      },
    };
    await expect(own.repository.claimCreation(badInput)).rejects.toMatchObject({
      code: "job.object-reference-mismatch",
    });
    const claims = await database.query(
      sql(
        "SELECT count(*)::integer AS count FROM async_job_creation_claims WHERE organization_id=$1",
        [own.record.ownership.organizationId],
      ),
    );
    expect(claims.rows[0]?.["count"]).toBe(0);
    const foreignEvent = creationAudits(queued)[0];
    if (foreignEvent === undefined)
      throw new Error("Expected foreign creation event.");
    await expect(
      own.repository.markAuditEntryPublished({
        eventId: foreignEvent.event.eventId,
        ownership: own.record.ownership,
        publishedAt: atSecond(3),
      }),
    ).rejects.toMatchObject({ code: "job.audit-outbox-not-found" });
  });

  it("preserves denial source and claim audit receipts while rejecting immutable snapshot mutation", async () => {
    const f = await fixture();
    const result = await f.repository.claimCreation(f.claimInput);
    if (result.kind !== "claimed") throw new Error("Expected claimed fixture.");
    const denial = {
      code: "job.entitlement-denied",
      publicMessage: "job-not-supported" as const,
    };
    const disallowed = await f.repository.recordEntitlement(
      result.claim,
      {
        allowed: false,
        decisionReference: id("entitlement"),
        denialCode: denial.code,
        publicMessage: denial.publicMessage,
      },
      atSecond(1),
    );
    const audit = createCreationClaimAuditOutboxEntryV1({
      actor: { kind: "principal", actorId: disallowed.idempotency.actorId },
      claim: disallowed,
      denial,
      denialSource: "entitlement",
      occurredAt: atSecond(2),
    });
    const denied = await f.repository.denyCreation(
      disallowed,
      denial,
      atSecond(2),
      audit,
    );
    const identity = {
      keyDigest: denied.idempotency.keyDigest,
      operationId: denied.idempotency.operationId,
      ownership: denied.ownership,
    };
    expect(await f.repository.getCreationClaim(identity)).toEqual(denied);
    expect(
      await f.repository.listPendingAuditEntries({
        limit: 10,
        ownership: denied.ownership,
      }),
    ).toEqual([audit]);
    await f.repository.markAuditEntryPublished({
      eventId: audit.event.eventId,
      ownership: denied.ownership,
      publishedAt: atSecond(3),
    });
    expect(
      await f.repository.listPendingAuditEntries({
        limit: 10,
        ownership: denied.ownership,
      }),
    ).toEqual([]);
    await expect(
      database.query(
        sql(
          "UPDATE async_job_claim_snapshots SET snapshot_size_bytes=snapshot_size_bytes+1 WHERE organization_id=$1 AND operation_id=$2 AND idempotency_key_sha256=$3",
          [
            denied.ownership.organizationId,
            denied.idempotency.operationId,
            hex(denied.idempotency.keyDigest),
          ],
        ),
      ),
    ).rejects.toMatchObject({ code: "55000" });
  });
});
