import { createHash } from "node:crypto";
import {
  RepositoryError,
  type AuthorizedOrganizationScope,
  type DraftCommandIdentity,
  type DraftCommandReceipt,
  type DraftMetadataRecord,
} from "../../application/persistence.js";
import { sql, type SqlExecutor } from "./sql.js";

function key(command: DraftCommandIdentity): string {
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(command.commandId) ||
    !/^[a-f0-9]{64}$/u.test(command.requestSha256) ||
    !/^[A-Za-z0-9._:-]{8,128}$/u.test(command.idempotencyKey)
  )
    throw new RepositoryError(
      "invalid-input",
      "The command identity is invalid.",
    );
  return createHash("sha256").update(command.idempotencyKey).digest("hex");
}

export async function readDraftCommandReceipt(
  executor: SqlExecutor,
  scope: AuthorizedOrganizationScope,
  projectId: string,
  command: DraftCommandIdentity,
): Promise<DraftCommandReceipt | null> {
  const result = await executor.query(
    sql(
      `SELECT r.*, to_char(COALESCE(o.published_at,r.created_at) AT TIME ZONE 'UTC',
       'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS result_updated_at
     FROM draft_command_receipts r
     JOIN stored_objects o ON o.organization_id=r.organization_id AND o.object_id=r.document_object_id
     WHERE r.organization_id=$1 AND r.project_id=$2 AND r.principal_id=$3 AND r.idempotency_key_sha256=$4`,
      [scope.organizationId, projectId, scope.principalId, key(command)],
    ),
  );
  const row = result.rows[0];
  if (row === undefined) return null;
  if (
    row["request_sha256"] !== command.requestSha256 ||
    row["command_id"] !== command.commandId
  )
    throw new RepositoryError(
      "idempotency-conflict",
      "The idempotency key was used for a different request.",
    );
  const string = (name: string) => {
    const value = row[name];
    if (typeof value !== "string")
      throw new RepositoryError(
        "persistence-unavailable",
        "The command receipt is unavailable.",
      );
    return value;
  };
  const number = (name: string) => {
    const value = Number(row[name]);
    if (!Number.isSafeInteger(value) || value < 1)
      throw new RepositoryError(
        "persistence-unavailable",
        "The command receipt is unavailable.",
      );
    return value;
  };
  return {
    commandId: string("command_id"),
    updatedAt: string("result_updated_at"),
    metadata: {
      organizationId: scope.organizationId,
      projectId,
      draftId: string("draft_id"),
      draftVersion: number("draft_version"),
      documentSchemaVersion: number("document_schema_version"),
      documentObjectId: string("document_object_id"),
      contentSha256: string("content_sha256"),
      semanticSha256: string("semantic_sha256"),
      visualSha256: string("visual_sha256"),
    },
  };
}

export async function insertDraftCommandReceipt(
  executor: SqlExecutor,
  scope: AuthorizedOrganizationScope,
  command: DraftCommandIdentity,
  metadata: DraftMetadataRecord,
): Promise<void> {
  await executor.query(
    sql(
      `INSERT INTO draft_command_receipts(organization_id,project_id,principal_id,idempotency_key_sha256,
       request_sha256,command_id,draft_id,draft_version,document_schema_version,document_object_id,
       content_sha256,semantic_sha256,visual_sha256)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        scope.organizationId,
        metadata.projectId,
        scope.principalId,
        key(command),
        command.requestSha256,
        command.commandId,
        metadata.draftId,
        metadata.draftVersion,
        metadata.documentSchemaVersion,
        metadata.documentObjectId,
        metadata.contentSha256,
        metadata.semanticSha256,
        metadata.visualSha256,
      ],
    ),
  );
}
