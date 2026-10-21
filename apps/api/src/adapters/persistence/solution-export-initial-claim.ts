import { randomUUID } from "node:crypto";
import {
  applyAsyncJobLifecycleCommandV1,
  deriveAsyncJobQueueEnvelopeV1,
} from "@cloudmarkup/domain";
import { createJobAuditOutboxEntryV1 } from "@cloudmarkup/job-framework";
import {
  asyncJobAttemptIdSchema,
  asyncJobWorkerIdSchema,
  namespacedIdentifierSchema,
  utcTimestampSchema,
  type AsyncJobRecordV1,
} from "@cloudmarkup/schemas";
import { permissionsForRole } from "../../application/authorization.js";
import { ApplicationError } from "../../application/errors.js";
import type {
  ObjectStore,
  StoredObjectReference,
} from "../../application/persistence.js";
import { createSolutionExportRunInsertionBindingV1 } from "../../application/solution-export-persistence-binding.js";
import { solutionExportRootAdmissionCommand } from "../../application/solution-export-root-admission.js";
import {
  PostgresAsyncJobRepository,
  type AsyncJobPersistenceObjectPort,
} from "./async-job-repository.js";
import { bytesOf, digestBytes } from "./async-job-repository-codec.js";
import {
  authorizeSolutionExportClaim,
  parseSolutionExportExecutionEnvelope,
  parseSolutionExportInitialEnvelope,
} from "./solution-export-initial-claim-authority.js";
import {
  SolutionExportProducerObjects,
  type SolutionExportObjectAuthority,
} from "./solution-export-producer-objects.js";
import {
  exportRunEqual,
  exportRunText,
  exportRunUnavailable,
  parsePreparedExportRun,
} from "./solution-export-run-codec.js";
import { exportStoredObject } from "./solution-export-workflow-storage.js";
import { sql, type SqlDatabase, type SqlExecutor } from "./sql.js";

function conflict(): never {
  throw new ApplicationError(
    "conflict",
    "The export delivery is no longer current.",
  );
}

/** Claim one delivered root attempt. Source reads and snapshot publication finish
 * before the final SQL transaction. Only the existing domain engine changes the
 * job, and its CAS, attempt and audit outbox commit under the same authority locks.
 * Retry availability is verified against the exact previous failed attempt. */
interface ClaimOptions {
  readonly database: SqlDatabase;
  readonly objectStore: ObjectStore;
  readonly envelope: unknown;
  readonly workerId: string;
  readonly leaseMilliseconds?: number;
}
export function claimInitialSolutionExport(
  options: ClaimOptions,
): Promise<AsyncJobRecordV1> {
  return claimSolutionExport({
    ...options,
    envelope: parseSolutionExportInitialEnvelope(options.envelope),
  });
}

export async function claimSolutionExport(
  options: ClaimOptions,
): Promise<AsyncJobRecordV1> {
  const envelope = parseSolutionExportExecutionEnvelope(options.envelope);
  const workerId = asyncJobWorkerIdSchema.parse(options.workerId);
  const leaseMilliseconds = options.leaseMilliseconds ?? 300_000;
  if (
    !Number.isSafeInteger(leaseMilliseconds) ||
    leaseMilliseconds < 1 ||
    leaseMilliseconds > 900_000
  )
    throw new ApplicationError(
      "invalid_request",
      "The export lease duration is invalid.",
    );
  const projectId = envelope.ownership.projectId;
  if (projectId === undefined) exportRunUnavailable();
  const ownership = {
    organizationId: envelope.ownership.organizationId,
    projectId,
  };
  const database = options.database;
  const original = await database.transaction((tx) =>
    authorizeSolutionExportClaim(tx, envelope),
  );
  if (original.context.actor.kind !== "principal") exportRunUnavailable();
  // Durable worker scope comes from current persisted creator authority. This is
  // an internal storage context; no original session or PrincipalContext is invented.
  const authority: SolutionExportObjectAuthority = {
    ownership,
    permission: "exports.run",
    query: (statement) =>
      database.transaction(async (tx) => {
        await authorizeSolutionExportClaim(tx, envelope);
        return tx.query(statement);
      }),
    scope: () =>
      database.transaction(async (tx) => {
        const current = await authorizeSolutionExportClaim(tx, envelope);
        if (current.context.actor.kind !== "principal") exportRunUnavailable();
        return {
          ...ownership,
          principalId: current.context.actor.actorId,
          membershipId: current.membershipId,
          roleKey: current.role,
          capabilities: permissionsForRole(current.role),
          correlationId: envelope.correlationId,
          sessionId: `worker.claim.${envelope.jobId}`,
        };
      }),
  };
  const objects = new SolutionExportProducerObjects(
    authority,
    options.objectStore,
  );
  const rows = await authority.query(
    sql(
      "SELECT workflow_read_model_object_id,workflow_request_object_id,orchestration_input_object_id,idempotency_key_sha256 FROM solution_export_runs WHERE organization_id=$1 AND project_id=$2 AND solution_export_run_id=$3",
      [ownership.organizationId, projectId, envelope.jobId],
    ),
  );
  const row = rows.rows[0];
  if (rows.rows.length !== 1 || row === undefined) exportRunUnavailable();
  const references = new Map<string, StoredObjectReference>();
  async function read(
    objectId: string,
    purpose: StoredObjectReference["purpose"],
  ) {
    const metadata = await objects.metadata(objectId);
    if (
      metadata?.state !== "published" ||
      metadata.reference.purpose !== purpose
    )
      exportRunUnavailable();
    const bytes = await objects.read(metadata.reference);
    references.set(objectId, metadata.reference);
    return bytes;
  }
  const preparedBytes = await read(
    exportRunText(row["workflow_read_model_object_id"]),
    "checkpoint-state",
  );
  let prepared;
  try {
    prepared = parsePreparedExportRun(
      JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(preparedBytes),
      ) as unknown,
    );
  } catch {
    return exportRunUnavailable();
  }
  const binding = createSolutionExportRunInsertionBindingV1(
    prepared.workflowSubmission,
  );
  const request = await read(
    exportRunText(row["workflow_request_object_id"]),
    "input-payload",
  );
  const input = await read(
    exportRunText(row["orchestration_input_object_id"]),
    "input-payload",
  );
  if (
    digestBytes(request) !== binding.requestSha256 ||
    digestBytes(input) !== binding.orchestrationInputSha256 ||
    prepared.organizationId !== ownership.organizationId ||
    prepared.job.projectId !== projectId ||
    prepared.job.id !== envelope.jobId ||
    prepared.createdByPrincipalId !== original.context.actor.actorId ||
    prepared.job.state !== "queued"
  )
    exportRunUnavailable();
  for (const [name, source] of Object.entries(
    prepared.workflowSubmission.request.sources,
  )) {
    if (source === undefined) continue;
    const bytes = await read(
      source.objectId,
      name === "architectureDocument"
        ? "architecture-revision"
        : name === "solutionRevision"
          ? "solution-revision-manifest"
          : "input-payload",
    );
    if (
      digestBytes(bytes) !== source.digest ||
      bytes.length !== source.sizeBytes
    )
      exportRunUnavailable();
  }
  const delegate = objects.jobPort(
    exportRunText(row["orchestration_input_object_id"]),
    binding.orchestrationInputSha256,
  );
  const reads = new Map<string, Uint8Array>();
  const readKey = (
    value: Parameters<AsyncJobPersistenceObjectPort["get"]>[0],
  ) => JSON.stringify(value);
  const priming: AsyncJobPersistenceObjectPort = {
    put: () =>
      Promise.reject(new Error("Export claim hydration cannot publish.")),
    get: async (value) => {
      const bytes = await delegate.get(value);
      reads.set(readKey(value), Uint8Array.from(bytes));
      const metadata = await objects.metadata(value.objectId);
      if (metadata?.state !== "published") exportRunUnavailable();
      references.set(value.objectId, metadata.reference);
      return bytes;
    },
  };
  const root = await new PostgresAsyncJobRepository({
    database,
    objects: priming,
    ownership,
  }).get(envelope.jobId);
  const command = solutionExportRootAdmissionCommand(
    prepared,
    `sha256:${exportRunText(row["idempotency_key_sha256"])}`,
  );
  if (
    root === null ||
    !exportRunEqual(deriveAsyncJobQueueEnvelopeV1(root), envelope) ||
    !exportRunEqual(command.idempotency, root.idempotency) ||
    !exportRunEqual(command.request.input, root.input) ||
    command.inputDigest !== root.inputDigest ||
    root.createdAt !== prepared.job.createdAt ||
    root.orchestration.dependencyJobIds.length !== 0
  )
    exportRunUnavailable();
  const clock = await authority.query(
    sql(
      "SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS now",
    ),
  );
  const at = utcTimestampSchema.parse(clock.rows[0]?.["now"]);
  const expires = Math.min(
    Date.parse(at) + leaseMilliseconds,
    Date.parse(at) + root.limits.runtimeSeconds * 1000,
    root.expiresAt === undefined ? Infinity : Date.parse(root.expiresAt),
  );
  if (expires <= Date.parse(at)) conflict();
  const leaseExpiresAt = utcTimestampSchema.parse(
    new Date(expires).toISOString(),
  );
  const claimed = applyAsyncJobLifecycleCommandV1(root, {
    at,
    attemptId: asyncJobAttemptIdSchema.parse(`attempt.${randomUUID()}`),
    dependencies: [],
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
    kind: "claim",
    leaseExpiresAt,
    workerId,
  });
  if (claimed.transition === undefined) conflict();
  const audit = createJobAuditOutboxEntryV1({
    actor: { kind: "worker", workerId },
    eventType: "attempt-claimed",
    occurredAt: at,
    record: claimed.job,
    transition: claimed.transition,
  });
  const snapshotBytes = bytesOf(claimed.job);
  const snapshotInput = {
    bytes: snapshotBytes,
    digest: digestBytes(snapshotBytes),
    kind: "job-record" as const,
    ownership,
  };
  const snapshot = await delegate.put(snapshotInput);
  const published = await objects.metadata(snapshot.objectId);
  if (published?.state !== "published") exportRunUnavailable();
  references.set(snapshot.objectId, published.reference);
  // Once locks are acquired every repository object operation is an exact RAM
  // replay. Unknown bytes/references fail closed instead of issuing network I/O.
  const primed: AsyncJobPersistenceObjectPort = {
    get: (value) => {
      const bytes = reads.get(readKey(value));
      if (bytes === undefined) exportRunUnavailable();
      return Promise.resolve(Uint8Array.from(bytes));
    },
    put: (value) => {
      if (
        value.kind !== "job-record" ||
        !exportRunEqual(value.ownership, ownership) ||
        value.digest !== snapshot.digest ||
        !Buffer.from(value.bytes).equals(Buffer.from(snapshotBytes))
      )
        exportRunUnavailable();
      return Promise.resolve(snapshot);
    },
  };
  return database.transaction(async (tx) => {
    const current = await authorizeSolutionExportClaim(tx, envelope);
    if (!exportRunEqual(current, original)) conflict();
    for (const reference of [...references.values()].sort((a, b) =>
      a.objectId.localeCompare(b.objectId),
    )) {
      const locked = await tx.query(
        sql(
          "SELECT * FROM stored_objects WHERE organization_id=$1 AND project_id=$2 AND object_id=$3 AND lifecycle_state='published' FOR SHARE",
          [ownership.organizationId, projectId, reference.objectId],
        ),
      );
      if (
        locked.rows.length !== 1 ||
        locked.rows[0] === undefined ||
        !exportRunEqual(exportStoredObject(locked.rows[0]), reference)
      )
        exportRunUnavailable();
    }
    const currentLease = async (executor: SqlExecutor) => {
      const checked = await executor.query(
        sql("SELECT clock_timestamp() < $1::timestamptz AS current", [
          leaseExpiresAt,
        ]),
      );
      if (checked.rows[0]?.["current"] !== true) conflict();
    };
    await currentLease(tx);
    const joined: SqlDatabase = {
      query: (statement) => tx.query(statement),
      transaction: (work) => work(tx),
      close: () => Promise.resolve(),
    };
    const saved = await new PostgresAsyncJobRepository({
      database: joined,
      objects: primed,
      ownership,
    }).saveWithAudit(claimed.job, root.recordVersion, [audit]);
    await currentLease(tx);
    return saved;
  });
}
