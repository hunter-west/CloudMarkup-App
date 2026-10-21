import {
  parseAsyncJobRecordV1,
  type AsyncJobRecordV1,
} from "@cloudmarkup/schemas";
import {
  exportRunBytes,
  exportRunEqual,
  exportRunInteger,
  exportRunSha,
  exportRunText,
  exportRunUnavailable,
  parsePreparedExportRun,
} from "./solution-export-run-codec.js";
import {
  parseSolutionExportOrphanReceipt,
  solutionExportOrphanTransition,
  verifySolutionExportOrphanReceipt,
} from "./solution-export-orphan-receipt.js";
import {
  solutionExportExecutionIdentity,
  type SolutionExportExecutionIdentity,
} from "./solution-export-worker-authority.js";
import type { SolutionExportWorkflowStorage } from "./solution-export-workflow-storage.js";
import { sql } from "./sql.js";
import type { StoredObjectReference } from "../../application/persistence.js";
function snapshotReference(reference: StoredObjectReference) {
  return {
    contractVersion: 1,
    objectId: reference.objectId,
    digest: "sha256:" + reference.contentSha256,
    sizeBytes: reference.sizeBytes,
    purpose: reference.purpose,
    mediaType: reference.mediaType,
  };
}

export function solutionExportOrphanReceiptId(
  storage: SolutionExportWorkflowStorage,
  execution: SolutionExportExecutionIdentity,
  priorRecordVersion: number,
) {
  return storage.identity("orphan-terminal-receipt", {
    jobId: execution.jobId,
    attemptId: execution.attemptId,
    value: { priorRecordVersion },
  });
}

/** This reference must be the actual append-only root journal entry, not merely
 * any scoped JSON object containing a plausible job. */
async function priorSnapshot(
  storage: SolutionExportWorkflowStorage,
  jobId: string,
  version: number,
) {
  const found = await storage.authority.query(
    sql(
      `SELECT snapshot_object_id,snapshot_sha256,snapshot_size_bytes FROM async_job_record_snapshots
     WHERE organization_id=$1 AND project_id=$2 AND job_id=$3 AND record_version=$4`,
      [
        storage.authority.ownership.organizationId,
        storage.authority.ownership.projectId,
        jobId,
        version,
      ],
    ),
  );
  const row = found.rows[0];
  if (found.rows.length !== 1 || row === undefined) exportRunUnavailable();
  const stored = await storage.metadata(
    exportRunText(row["snapshot_object_id"]),
  );
  if (
    stored?.state !== "published" ||
    stored.reference.purpose !== "report" ||
    stored.reference.mediaType !== "application/json" ||
    stored.reference.contentSha256 !== row["snapshot_sha256"] ||
    stored.reference.sizeBytes !== exportRunInteger(row["snapshot_size_bytes"])
  )
    exportRunUnavailable();
  return stored.reference;
}

export async function loadSolutionExportOrphanReceipt(
  storage: SolutionExportWorkflowStorage,
  execution: SolutionExportExecutionIdentity,
  terminal?: AsyncJobRecordV1,
  priorVersion = terminal === undefined
    ? undefined
    : terminal.recordVersion - 1,
) {
  if (
    priorVersion === undefined ||
    !Number.isSafeInteger(priorVersion) ||
    priorVersion < 1
  )
    exportRunUnavailable();
  const object = await storage.metadata(
    solutionExportOrphanReceiptId(storage, execution, priorVersion),
  );
  if (object === null) return null;
  if (
    object.state !== "published" ||
    object.reference.purpose !== "report" ||
    object.reference.mediaType !== "application/json"
  )
    exportRunUnavailable();
  const receipt = parseSolutionExportOrphanReceipt(
    await storage.readJson(object.reference),
  );
  if (
    !exportRunEqual(receipt.execution, execution) ||
    receipt.priorRecordVersion !== priorVersion
  )
    exportRunUnavailable();
  const reference = await priorSnapshot(
    storage,
    execution.jobId,
    receipt.priorRecordVersion,
  );
  if (!exportRunEqual(snapshotReference(reference), receipt.priorSnapshot))
    exportRunUnavailable();
  const prior = parseAsyncJobRecordV1(await storage.readJson(reference));
  const verified = verifySolutionExportOrphanReceipt(receipt, prior, terminal);
  const time = await storage.authority.query(
    sql("SELECT clock_timestamp() >= $1::timestamptz AS reached", [
      receipt.reconciledAt,
    ]),
  );
  if (time.rows[0]?.["reached"] !== true) exportRunUnavailable();
  return {
    ...verified,
    reference: object.reference,
    priorReference: reference,
  };
}

/** Finish only a previously staged receipt's publication. Its exact bytes are
 * then parsed and canonically verified before any root/audit mutation. */
async function finishPendingReceipt(
  storage: SolutionExportWorkflowStorage,
  execution: SolutionExportExecutionIdentity,
  priorVersion: number,
) {
  const object = await storage.metadata(
    solutionExportOrphanReceiptId(storage, execution, priorVersion),
  );
  if (object?.state !== "publication-pending") return;
  const reference = object.reference;
  if (
    reference.purpose !== "report" ||
    reference.mediaType !== "application/json" ||
    reference.sizeBytes > 4 * 1024 * 1024
  )
    exportRunUnavailable();
  await storage.store.publish(await storage.authority.scope(), reference);
  await storage.authority.query(
    sql(
      `UPDATE stored_objects SET lifecycle_state='published',published_at=COALESCE(published_at,clock_timestamp())
     WHERE organization_id=$1 AND project_id=$2 AND object_id=$3 AND object_version=$4 AND content_sha256=$5 AND lifecycle_state='publication-pending'`,
      [
        storage.authority.ownership.organizationId,
        storage.authority.ownership.projectId,
        reference.objectId,
        reference.objectVersion,
        reference.contentSha256,
      ],
    ),
  );
}

export async function retainSolutionExportOrphanReceipt(
  storage: SolutionExportWorkflowStorage,
  root: AsyncJobRecordV1,
  databaseAt: string,
) {
  const execution = solutionExportExecutionIdentity(root);
  await finishPendingReceipt(storage, execution, root.recordVersion);
  const existing = await loadSolutionExportOrphanReceipt(
    storage,
    execution,
    undefined,
    root.recordVersion,
  );
  if (existing !== null) {
    if (!exportRunEqual(existing.prior, root)) exportRunUnavailable();
    return existing;
  }
  const result = solutionExportOrphanTransition(root, databaseAt);
  if (result.job.state === "queued") exportRunUnavailable();
  const reference = await priorSnapshot(
    storage,
    root.jobId,
    root.recordVersion,
  );
  if (!exportRunEqual(await storage.readJson(reference), root))
    exportRunUnavailable();
  const found = await storage.authority.query(
    sql(
      "SELECT workflow_read_model_object_id,workflow_read_model_sha256 FROM solution_export_runs WHERE organization_id=$1 AND project_id=$2 AND solution_export_run_id=$3",
      [execution.organizationId, execution.projectId, execution.jobId],
    ),
  );
  const row = found.rows[0];
  if (found.rows.length !== 1 || row === undefined) exportRunUnavailable();
  const snapshot = await storage.metadata(
    exportRunText(row["workflow_read_model_object_id"]),
  );
  if (
    snapshot?.state !== "published" ||
    snapshot.reference.purpose !== "checkpoint-state" ||
    snapshot.reference.contentSha256 !== row["workflow_read_model_sha256"]
  )
    exportRunUnavailable();
  const prepared = parsePreparedExportRun(
    await storage.readJson(snapshot.reference),
  );
  const receipt = parseSolutionExportOrphanReceipt({
    contractVersion: 1,
    kind: "cloudmarkup.solution-export-orphan-terminal-receipt",
    execution,
    prepared,
    priorRecordVersion: root.recordVersion,
    priorSnapshot: snapshotReference(reference),
    reconciledAt: databaseAt,
    terminalState: result.job.state,
    terminalRootDigest: `sha256:${exportRunSha(exportRunBytes(result.job))}`,
  });
  verifySolutionExportOrphanReceipt(receipt, root, result.job);
  await storage.put(
    exportRunBytes(receipt),
    "report",
    "application/json",
    solutionExportOrphanReceiptId(storage, execution, root.recordVersion),
  );
  const retained = await loadSolutionExportOrphanReceipt(
    storage,
    execution,
    result.job,
  );
  if (retained === null) exportRunUnavailable();
  return retained;
}
