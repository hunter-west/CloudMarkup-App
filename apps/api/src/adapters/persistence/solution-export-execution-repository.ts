import { applyAsyncJobLifecycleCommandV1 } from "@cloudmarkup/domain";
import {
  createJobAuditOutboxEntryV1,
  type JobRepository,
} from "@cloudmarkup/job-framework";
import {
  asyncJobTrustedOwnershipV1Schema,
  namespacedIdentifierSchema,
  utcTimestampSchema,
  parseAsyncJobRecordV1,
  type AsyncJobRecordV1,
} from "@cloudmarkup/schemas";
import type {
  ObjectStore,
  StoredObjectReference,
} from "../../application/persistence.js";
import { ApplicationError } from "../../application/errors.js";
import {
  PostgresAsyncJobRepository,
  type AsyncJobPersistenceObjectPort,
} from "./async-job-repository.js";
import { bytesOf, digestBytes } from "./async-job-repository-codec.js";
import { SolutionExportProducerObjects } from "./solution-export-producer-objects.js";
import {
  exportRunEqual,
  exportRunText,
  exportRunUnavailable,
} from "./solution-export-run-codec.js";
import {
  SolutionExportWorkerAuthority,
  solutionExportExecutionIdentity,
  type SolutionExportExecutionIdentity,
} from "./solution-export-worker-authority.js";
import { exportStoredObject } from "./solution-export-workflow-storage.js";
import { solutionExportOrphanTransition } from "./solution-export-orphan-receipt.js";
import {
  loadSolutionExportOrphanReceipt,
  retainSolutionExportOrphanReceipt,
} from "./solution-export-orphan-objects.js";
import { SolutionExportWorkflowStorage } from "./solution-export-workflow-storage.js";
import { sql, type SqlDatabase } from "./sql.js";

function conflict(): never {
  throw new ApplicationError(
    "conflict",
    "The export worker transition is no longer current.",
  );
}

/** Only lifecycle persistence uses this scope. Compiler, build, model and
 * artifact emission retain the stricter execution authority, including cancel.
 * Every transition publishes exact immutable bytes before taking SQL locks. */
class SolutionExportExecutionRepository extends PostgresAsyncJobRepository {
  readonly #database: SqlDatabase;
  readonly #authority: SolutionExportWorkerAuthority;
  readonly #objects: SolutionExportProducerObjects;
  readonly #port: AsyncJobPersistenceObjectPort;
  readonly #store: ObjectStore;
  constructor(
    database: SqlDatabase,
    authority: SolutionExportWorkerAuthority,
    objects: SolutionExportProducerObjects,
    port: AsyncJobPersistenceObjectPort,
    store: ObjectStore,
  ) {
    super({
      database: authority,
      objects: port,
      ownership: asyncJobTrustedOwnershipV1Schema.parse(authority.ownership),
    });
    this.#database = database;
    this.#authority = authority;
    this.#objects = objects;
    this.#port = port;
    this.#store = store;
  }

  override async get(jobId: string): Promise<AsyncJobRecordV1 | null> {
    if (jobId !== this.#authority.identity.jobId) exportRunUnavailable();
    await this.#authority.scope();
    const result = await super.get(jobId);
    await this.#authority.scope();
    return result;
  }

  override async saveWithAudit(
    record: AsyncJobRecordV1,
    expectedRecordVersion: number,
    auditEntries: Parameters<JobRepository["saveWithAudit"]>[2],
  ): Promise<AsyncJobRecordV1> {
    const authority = this.#authority;
    const ownership = asyncJobTrustedOwnershipV1Schema.parse(
      authority.ownership,
    );
    const stored = parseAsyncJobRecordV1({
      ...record,
      recordVersion: expectedRecordVersion + 1,
    });
    if (
      stored.jobId !== authority.identity.jobId ||
      !exportRunEqual(stored.ownership, ownership)
    )
      exportRunUnavailable();
    const reads = new Map<string, Uint8Array>();
    const references = new Map<string, StoredObjectReference>();
    const readKey = (
      input: Parameters<AsyncJobPersistenceObjectPort["get"]>[0],
    ) =>
      JSON.stringify([
        input.kind,
        input.objectId,
        input.digest,
        input.sizeBytes,
        input.ownership,
      ]);
    const retainReference = async (objectId: string) => {
      const value = await this.#objects.metadata(objectId);
      if (value?.state !== "published") exportRunUnavailable();
      references.set(objectId, value.reference);
    };
    const capture: AsyncJobPersistenceObjectPort = {
      put: () => Promise.reject(new Error("Export hydration cannot publish.")),
      get: async (input) => {
        const bytes = await this.#port.get(input);
        reads.set(readKey(input), Uint8Array.from(bytes));
        await retainReference(input.objectId);
        return bytes;
      },
    };
    const previous = await new PostgresAsyncJobRepository({
      database: authority,
      objects: capture,
      ownership,
    }).get(stored.jobId);
    const attempt = previous?.attempts.at(-1);
    if (
      previous?.recordVersion !== expectedRecordVersion ||
      previous.state !== "running" ||
      attempt?.state !== "running" ||
      attempt.lease === undefined ||
      !exportRunEqual(
        solutionExportExecutionIdentity(previous),
        authority.identity,
      )
    )
      conflict();
    if (authority.mode === "orphan-retry") {
      const expected = orphanRetry(previous, stored.updatedAt);
      if (!exportRunEqual(expected.job, stored)) conflict();
    }
    if (authority.mode === "orphan-reconcile") {
      const expected = solutionExportOrphanTransition(
        previous,
        stored.updatedAt,
      );
      if (!exportRunEqual(expected.job, stored)) conflict();
      if (stored.state !== "queued") {
        const retained = await loadSolutionExportOrphanReceipt(
          new SolutionExportWorkflowStorage(authority, this.#store),
          authority.identity,
          stored,
        );
        if (retained === null || !exportRunEqual(retained.prior, previous))
          conflict();
        await retainReference(retained.reference.objectId);
        await retainReference(retained.priorReference.objectId);
      }
    }
    const originalLeaseExpiresAt = attempt.lease.leaseExpiresAt;
    const writes = new Map<
      string,
      {
        readonly bytes: Uint8Array;
        readonly reference: Awaited<
          ReturnType<AsyncJobPersistenceObjectPort["put"]>
        >;
      }
    >();
    const publish = async (value: unknown, kind: "job-record" | "output") => {
      const bytes = bytesOf(value);
      const digest = digestBytes(bytes);
      const reference = await this.#port.put({
        bytes,
        digest,
        kind,
        ownership,
      });
      writes.set(JSON.stringify([kind, digest]), { bytes, reference });
      await retainReference(reference.objectId);
    };
    if (
      stored.output !== undefined &&
      !exportRunEqual(stored.output, previous.output ?? null)
    )
      await publish(stored.output, "output");
    await publish(stored, "job-record");
    const primed: AsyncJobPersistenceObjectPort = {
      get: (input) => {
        const bytes = reads.get(readKey(input));
        if (bytes === undefined) exportRunUnavailable();
        return Promise.resolve(Uint8Array.from(bytes));
      },
      put: (input) => {
        const entry = writes.get(JSON.stringify([input.kind, input.digest]));
        if (
          entry === undefined ||
          !exportRunEqual(input.ownership, ownership) ||
          !Buffer.from(input.bytes).equals(Buffer.from(entry.bytes))
        )
          exportRunUnavailable();
        return Promise.resolve(entry.reference);
      },
    };
    return this.#database.transaction(async (tx) => {
      const project = await tx.query(
        sql(
          "SELECT project_id FROM projects WHERE organization_id=$1 AND project_id=$2 AND lifecycle_status='active' FOR SHARE",
          [ownership.organizationId, ownership.projectId ?? null],
        ),
      );
      if (project.rows.length !== 1) exportRunUnavailable();
      const root = await tx.query(
        sql(
          "SELECT record_version,lifecycle_status FROM async_jobs WHERE organization_id=$1 AND project_id=$2 AND job_id=$3 FOR UPDATE",
          [ownership.organizationId, ownership.projectId ?? null, stored.jobId],
        ),
      );
      if (
        String(root.rows[0]?.["record_version"]) !==
          String(expectedRecordVersion) ||
        root.rows[0]?.["lifecycle_status"] !== "running"
      )
        conflict();
      await authority.authorize(tx);
      for (const reference of [...references.values()].sort((a, b) =>
        a.objectId < b.objectId ? -1 : a.objectId === b.objectId ? 0 : 1,
      )) {
        const locked = await tx.query(
          sql(
            "SELECT * FROM stored_objects WHERE organization_id=$1 AND project_id=$2 AND object_id=$3 AND lifecycle_state='published' FOR SHARE",
            [
              ownership.organizationId,
              ownership.projectId ?? null,
              reference.objectId,
            ],
          ),
        );
        if (
          locked.rows.length !== 1 ||
          locked.rows[0] === undefined ||
          !exportRunEqual(exportStoredObject(locked.rows[0]), reference)
        )
          exportRunUnavailable();
      }
      const assertLease = async () => {
        const current = await tx.query(
          sql("SELECT clock_timestamp() < $1::timestamptz AS current", [
            originalLeaseExpiresAt,
          ]),
        );
        if (
          current.rows[0]?.["current"] !==
          (authority.mode !== "orphan-retry" &&
            authority.mode !== "orphan-reconcile")
        )
          conflict();
      };
      await assertLease();
      if (authority.mode === "orphan-reconcile") {
        const reached = await tx.query(
          sql("SELECT clock_timestamp() >= $1::timestamptz AS reached", [
            stored.updatedAt,
          ]),
        );
        if (reached.rows[0]?.["reached"] !== true) conflict();
      }
      const joined: SqlDatabase = {
        query: (statement) => tx.query(statement),
        transaction: (work) => work(tx),
        close: () => Promise.resolve(),
      };
      const saved = await new PostgresAsyncJobRepository({
        database: joined,
        objects: primed,
        ownership,
      }).saveWithAudit(stored, expectedRecordVersion, auditEntries);
      await authority.authorize(tx);
      await assertLease();
      return saved;
    });
  }
}

export async function createSolutionExportExecutionRepository(input: {
  readonly database: SqlDatabase;
  readonly objectStore: ObjectStore;
  readonly claimed: AsyncJobRecordV1;
}): Promise<JobRepository> {
  return executionRepository(
    input,
    solutionExportExecutionIdentity(input.claimed),
    "lifecycle",
  );
}

async function executionRepository(
  input: { readonly database: SqlDatabase; readonly objectStore: ObjectStore },
  identity: SolutionExportExecutionIdentity,
  mode: "lifecycle" | "orphan-retry" | "orphan-reconcile",
): Promise<JobRepository> {
  const authority = new SolutionExportWorkerAuthority(
    input.database,
    identity,
    mode,
  );
  const rows = await authority.query(
    sql(
      "SELECT orchestration_input_object_id FROM solution_export_runs WHERE organization_id=$1 AND project_id=$2 AND solution_export_run_id=$3",
      [identity.organizationId, identity.projectId, identity.jobId],
    ),
  );
  if (rows.rows.length !== 1) exportRunUnavailable();
  const objects = new SolutionExportProducerObjects(
    authority,
    input.objectStore,
  );
  const port = objects.jobPort(
    exportRunText(rows.rows[0]?.["orchestration_input_object_id"]),
    identity.inputDigest,
  );
  return new SolutionExportExecutionRepository(
    input.database,
    authority,
    objects,
    port,
    input.objectStore,
  );
}

function orphanRetry(root: AsyncJobRecordV1, at: string) {
  const result = applyAsyncJobLifecycleCommandV1(root, {
    kind: "reconcile-orphan",
    at: utcTimestampSchema.parse(at),
    expectedInputDigest: root.inputDigest,
    expectedRecordVersion: root.recordVersion,
    handler: {
      family: "solution-export-orchestration",
      handlerId: namespacedIdentifierSchema.parse(
        "cloudmarkup.solution-export.workflow",
      ),
      handlerVersion: "1.0.0",
      resumePolicy: "restart-from-input",
    },
  });
  // Terminal orphan/expiration outcomes require their own durable settlement
  // receipt. This adapter may only schedule the existing bounded restart.
  if (
    result.job.state !== "queued" ||
    result.transition === undefined ||
    result.job.attempts.at(-1)?.state !== "orphaned"
  )
    exportRunUnavailable();
  return { ...result, transition: result.transition };
}

/** Host-only retry of one exact current expired execution. Database time, current
 * creator permission, immutable input, published snapshot and CAS are rechecked.
 * No process executor or artifact publisher receives this recovery authority. */
export async function retryOrphanedSolutionExport(input: {
  readonly database: SqlDatabase;
  readonly objectStore: ObjectStore;
  readonly identity: SolutionExportExecutionIdentity;
}): Promise<AsyncJobRecordV1> {
  const repository = await executionRepository(
    input,
    input.identity,
    "orphan-retry",
  );
  const root = await repository.get(input.identity.jobId);
  if (
    root === null ||
    !exportRunEqual(solutionExportExecutionIdentity(root), input.identity)
  )
    exportRunUnavailable();
  const time = await input.database.query(
    sql(
      "SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS at",
    ),
  );
  const result = orphanRetry(root, exportRunText(time.rows[0]?.["at"]));
  return repository.saveWithAudit(result.job, root.recordVersion, [
    createJobAuditOutboxEntryV1({
      actor: { kind: "system", reason: "orphan-reconciler" },
      eventType: "orphan-reconciled",
      occurredAt: result.transition.at,
      record: result.job,
      transition: result.transition,
    }),
  ]);
}

/** One actual expired execution can either restart within its original limits,
 * or retain an explicit canonical orphan receipt before terminal root/audit CAS.
 * A repeated terminal call verifies that same receipt; it cannot redispatch. */
export async function reconcileOrphanedSolutionExport(input: {
  readonly database: SqlDatabase;
  readonly objectStore: ObjectStore;
  readonly identity: SolutionExportExecutionIdentity;
}): Promise<AsyncJobRecordV1> {
  const repository = await executionRepository(
    input,
    input.identity,
    "orphan-reconcile",
  );
  const authority = new SolutionExportWorkerAuthority(
    input.database,
    input.identity,
    "orphan-reconcile",
  );
  const storage = new SolutionExportWorkflowStorage(
    authority,
    input.objectStore,
  );
  const root = await repository.get(input.identity.jobId);
  if (root === null) exportRunUnavailable();
  if (["failed", "canceled", "expired"].includes(root.state)) {
    const settled = await loadSolutionExportOrphanReceipt(
      storage,
      input.identity,
      root,
    );
    if (settled === null) exportRunUnavailable();
    return root;
  }
  if (!exportRunEqual(solutionExportExecutionIdentity(root), input.identity))
    exportRunUnavailable();
  const time = await input.database.query(
    sql(
      "SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS at",
    ),
  );
  let result = solutionExportOrphanTransition(
    root,
    exportRunText(time.rows[0]?.["at"]),
  );
  if (result.job.state !== "queued") {
    const retained = await retainSolutionExportOrphanReceipt(
      storage,
      root,
      result.transition.at,
    );
    result = { job: retained.job, transition: retained.transition };
  }
  return repository.saveWithAudit(result.job, root.recordVersion, [
    createJobAuditOutboxEntryV1({
      actor: { kind: "system", reason: "orphan-reconciler" },
      eventType: "orphan-reconciled",
      occurredAt: result.transition.at,
      record: result.job,
      transition: result.transition,
    }),
  ]);
}
