import {
  solutionExportArtifactV1Schema,
  solutionExportDownloadGrantV1Schema,
  solutionExportEnvironmentV1Schema,
  solutionExportTargetProfileIdV1Schema,
} from "@cloudmarkup/api-contract";
import {
  asyncJobArtifactReferenceV1Schema,
  solutionExportOrchestrationJobOutputV1Schema,
  parseAsyncJobRecordV1,
  sha256DigestSchema,
} from "@cloudmarkup/schemas";
import type { ObjectStore } from "../../application/persistence.js";
import type { PrincipalContext } from "../../application/ports.js";
import type {
  SolutionExportRepository,
  StoredSolutionExportArtifact,
  StoredSolutionExportDownloadGrant,
} from "../../application/solution-exports.js";
import { ApplicationError } from "../../application/errors.js";
import { createSolutionExportRunInsertionBindingV1 } from "../../application/solution-export-persistence-binding.js";
import { SolutionExportArtifactObjects } from "./solution-export-artifact-objects.js";
import { SolutionExportWorkerAuthority } from "./solution-export-worker-authority.js";
import { SolutionExportRequestAuthority } from "./solution-export-authority.js";
import { parseSolutionExportTerminalReceipt } from "./solution-export-terminal-codec.js";
import {
  exportRunEqual,
  exportRunInteger,
  exportRunText,
  exportRunUnavailable,
  parseStoredExportRun,
} from "./solution-export-run-codec.js";
import {
  SolutionExportWorkflowStorage,
  exportJobObject,
  solutionExportWorkflowByteLimit,
} from "./solution-export-workflow-storage.js";
import { sql, type SqlDatabase, type SqlExecutor, type SqlRow } from "./sql.js";

type Reads = Pick<
  SolutionExportRepository,
  | "findLatestArtifact"
  | "getArtifact"
  | "getDownloadGrant"
  | "reserveDownloadGrant"
>;
type Selector = Parameters<Reads["getArtifact"]>[0];
const utc = (column: string) =>
  `to_char(${column} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
function denied(): never {
  throw new ApplicationError(
    "not_found",
    "The requested resource is unavailable.",
  );
}

/** Request-bound reads and short-lived grants. Does not create export jobs or fake unavailable ports. */
export class PostgresSolutionExportDownloadRepository implements Reads {
  readonly authority:
    SolutionExportRequestAuthority | SolutionExportWorkerAuthority;
  readonly storage: SolutionExportWorkflowStorage;
  constructor(
    database: SqlDatabase,
    objects: ObjectStore,
    principal: PrincipalContext | SolutionExportWorkerAuthority,
    ownership: { readonly organizationId: string; readonly projectId: string },
  ) {
    this.authority =
      principal instanceof SolutionExportWorkerAuthority
        ? principal
        : new SolutionExportRequestAuthority(
            database,
            principal,
            ownership,
            "artifacts.read",
          );
    if (!exportRunEqual(this.authority.ownership, ownership)) denied();
    this.storage = new SolutionExportWorkflowStorage(this.authority, objects);
  }
  #requestPrincipal(): PrincipalContext {
    if (!(this.authority instanceof SolutionExportRequestAuthority)) denied();
    return this.authority.principal;
  }
  #selector(input: Selector): void {
    if (
      !exportRunEqual(
        { organizationId: input.organizationId, projectId: input.projectId },
        this.authority.ownership,
      ) ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(input.artifactId)
    )
      denied();
  }
  async findLatestArtifact(
    input: Parameters<Reads["findLatestArtifact"]>[0],
  ): Promise<StoredSolutionExportArtifact | null> {
    // These are selectors, not authority. The request-bound scope reauthorizes
    // every query and every object read, including after potentially slow I/O.
    this.#selector({ ...input, artifactId: "latest" });
    const environment = solutionExportEnvironmentV1Schema.safeParse(
      input.environment,
    );
    const profile = solutionExportTargetProfileIdV1Schema.safeParse(
      input.targetProfileId,
    );
    const settings = sha256DigestSchema.safeParse(input.targetSettingsDigest);
    if (!environment.success || !profile.success || !settings.success) denied();
    const selector = {
      organizationId: input.organizationId,
      projectId: input.projectId,
      environment: environment.data,
      targetProfileId: profile.data,
      targetSettingsDigest: settings.data,
    };
    const latest = async (): Promise<string | null> => {
      const selected = await this.authority.query(
        sql(
          `SELECT a.solution_export_artifact_id FROM solution_export_artifacts a
          JOIN solution_export_runs r ON r.organization_id=a.organization_id
            AND r.project_id=a.project_id AND r.solution_export_run_id=a.solution_export_run_id
          WHERE a.organization_id=$1 AND a.project_id=$2
            AND r.environment_type=$3 AND r.environment_id IS NOT DISTINCT FROM $4::varchar
            AND r.target_profile_id=$5 AND r.target_settings_sha256=$6
            AND a.retention_expires_at>clock_timestamp()
            AND r.lifecycle_status='succeeded' AND r.cancellation_requested_at IS NULL
          ORDER BY a.created_at DESC,a.solution_export_artifact_id DESC LIMIT 1`,
          [
            selector.organizationId,
            selector.projectId,
            selector.environment.environmentType,
            selector.environment.environmentId ?? null,
            selector.targetProfileId,
            selector.targetSettingsDigest.slice(7),
          ],
        ),
      );
      if (selected.rows.length > 1) exportRunUnavailable();
      return selected.rows[0] === undefined
        ? null
        : exportRunText(selected.rows[0]["solution_export_artifact_id"]);
    };
    const artifactId = await latest();
    if (artifactId === null) return null;
    const artifact = await this.getArtifact({ ...selector, artifactId });
    if (
      artifact === null ||
      !exportRunEqual(artifact.targetEnvironment, selector.environment) ||
      artifact.targetProfileId !== selector.targetProfileId ||
      artifact.targetSettingsDigest !== selector.targetSettingsDigest ||
      (await latest()) !== artifactId
    )
      exportRunUnavailable();
    return artifact;
  }
  async #inspect(tx: SqlExecutor, input: Selector): Promise<SqlRow | null> {
    const found = await tx.query(
      sql(
        `SELECT a.solution_export_artifact_id,a.organization_id,a.project_id,a.solution_export_run_id,a.solution_revision_id,a.manifest_object_id,a.manifest_sha256,a.manifest_size_bytes,a.archive_object_id,a.archive_sha256,a.archive_file_name,a.file_count,a.size_bytes,${utc("a.created_at")} AS created_at,
      ${utc("a.retention_expires_at")} AS retention_expires_at,r.workflow_read_model_object_id,r.workflow_read_model_sha256,
      r.solution_manifest_sha256,j.output_object_id,j.output_sha256,j.record_version AS root_record_version,
      s.snapshot_object_id AS root_snapshot_object_id,s.snapshot_sha256 AS root_snapshot_sha256,
      aroot.attempt_id AS root_attempt_id,aroot.attempt_number AS root_attempt_number,
      aroot.worker_reference AS root_worker_id,${utc("aroot.completed_at")} AS root_attempt_completed_at,
      ${utc("j.completed_at")} AS root_completed_at
      FROM solution_export_artifacts a JOIN solution_export_runs r ON r.organization_id=a.organization_id
        AND r.project_id=a.project_id AND r.solution_export_run_id=a.solution_export_run_id
      JOIN async_jobs j ON j.organization_id=r.organization_id AND j.project_id=r.project_id AND j.job_id=r.root_job_id
      JOIN async_job_record_snapshots s ON s.organization_id=j.organization_id AND s.project_id=j.project_id
        AND s.job_id=j.job_id AND s.record_version=j.record_version
      JOIN stored_objects root_object ON root_object.organization_id=s.organization_id AND root_object.project_id=s.project_id
        AND root_object.object_id=s.snapshot_object_id AND root_object.content_sha256=s.snapshot_sha256
        AND root_object.lifecycle_state='published' AND root_object.object_purpose='report'
      JOIN async_job_attempts aroot ON aroot.organization_id=j.organization_id AND aroot.job_id=j.job_id
        AND aroot.lifecycle_status='succeeded' AND aroot.completed_at=j.completed_at
        AND aroot.attempt_number=(SELECT max(current_attempt.attempt_number) FROM async_job_attempts current_attempt
          WHERE current_attempt.organization_id=j.organization_id AND current_attempt.job_id=j.job_id)
      WHERE a.organization_id=$1 AND a.project_id=$2 AND a.solution_export_artifact_id=$3
        AND a.retention_expires_at>clock_timestamp() AND r.lifecycle_status='succeeded' AND j.lifecycle_status='succeeded'
        AND r.completed_at=j.completed_at AND r.cancellation_requested_at IS NULL AND j.cancellation_requested_at IS NULL
        AND j.family='solution-export-orchestration' AND j.solution_revision_id=r.solution_revision_id
        AND j.root_job_id=j.job_id AND j.parent_job_id IS NULL
        AND j.created_by_principal_id=r.created_by_principal_id AND j.idempotency_actor_id=r.created_by_principal_id
        AND a.solution_revision_id=r.solution_revision_id AND j.solution_manifest_sha256=r.solution_manifest_sha256
        AND j.input_object_id=r.orchestration_input_object_id AND j.input_sha256=r.orchestration_input_sha256
        AND r.generation_coverage_object_id IS NOT NULL AND r.evidence_object_id IS NOT NULL
      FOR SHARE OF r,j,root_object,aroot`,
        [input.organizationId, input.projectId, input.artifactId],
      ),
    );
    if (found.rows.length > 1) exportRunUnavailable();
    return found.rows[0] ?? null;
  }
  async #object(id: unknown, digest: unknown) {
    const metadata = await this.storage.metadata(exportRunText(id));
    if (
      metadata?.state !== "published" ||
      metadata.reference.contentSha256 !== digest ||
      metadata.reference.sizeBytes >
        solutionExportWorkflowByteLimit(
          metadata.reference.purpose,
          metadata.reference.mediaType,
        )
    )
      exportRunUnavailable();
    return metadata.reference;
  }
  async getArtifact(
    input: Selector,
  ): Promise<StoredSolutionExportArtifact | null> {
    this.#selector(input);
    const before = await this.authority.transaction((tx) =>
      this.#inspect(tx, input),
    );
    if (before === null) return null;
    const snapshot = await this.#object(
      before["workflow_read_model_object_id"],
      before["workflow_read_model_sha256"],
    );
    if (snapshot.purpose !== "checkpoint-state") exportRunUnavailable();
    const stored = parseStoredExportRun(await this.storage.readJson(snapshot));
    const manifest = await this.#object(
      before["manifest_object_id"],
      before["manifest_sha256"],
    );
    const archive = await this.#object(
      before["archive_object_id"],
      before["archive_sha256"],
    );
    const outputObject = await this.#object(
      before["output_object_id"],
      before["output_sha256"],
    );
    const output = solutionExportOrchestrationJobOutputV1Schema.parse(
      await this.storage.readJson(outputObject),
    );
    const rootObject = await this.#object(
      before["root_snapshot_object_id"],
      before["root_snapshot_sha256"],
    );
    if (rootObject.purpose !== "report") exportRunUnavailable();
    const root = parseAsyncJobRecordV1(await this.storage.readJson(rootObject));
    const attempt = root.attempts.at(-1);
    if (attempt === undefined) exportRunUnavailable();
    const binding = createSolutionExportRunInsertionBindingV1(
      stored.workflowSubmission,
    );
    const receiptObject = await this.storage.metadata(
      this.storage.identity("terminal-receipt", {
        jobId: root.jobId,
        attemptId: before["root_attempt_id"],
        value: null,
      }),
    );
    if (
      receiptObject?.state !== "published" ||
      receiptObject.reference.purpose !== "report"
    )
      exportRunUnavailable();
    const receipt = parseSolutionExportTerminalReceipt(
      await this.storage.readJson(receiptObject.reference),
    );
    if (
      root.jobId !== stored.job.id ||
      root.ownership.organizationId !== input.organizationId ||
      root.ownership.projectId !== input.projectId ||
      root.state !== "succeeded" ||
      root.recordVersion !== exportRunInteger(before["root_record_version"]) ||
      root.completedAt !== before["root_completed_at"] ||
      root.cancellation.state !== "none" ||
      root.idempotency.actorId !== stored.createdByPrincipalId ||
      root.inputDigest !== binding.orchestrationInputSha256 ||
      !exportRunEqual(root.input, binding.orchestrationInput) ||
      !exportRunEqual(root.output, output) ||
      attempt.attemptId !== before["root_attempt_id"] ||
      attempt.attemptNumber !==
        exportRunInteger(before["root_attempt_number"]) ||
      attempt.state !== "succeeded" ||
      attempt.completedAt !== before["root_attempt_completed_at"] ||
      !exportRunEqual(receipt.execution, {
        jobId: root.jobId,
        organizationId: input.organizationId,
        projectId: input.projectId,
        actorId: stored.createdByPrincipalId,
        inputDigest: root.inputDigest,
        attemptId: attempt.attemptId,
        attemptNumber: attempt.attemptNumber,
        workerId: before["root_worker_id"],
      }) ||
      !exportRunEqual(
        receipt.prepared.workflowSubmission,
        stored.workflowSubmission,
      ) ||
      receipt.result.outcome.outcome !== "succeeded" ||
      !exportRunEqual(receipt.result.outcome.output, root.output) ||
      stored.organizationId !== input.organizationId ||
      stored.job.projectId !== input.projectId ||
      stored.job.id !== before["solution_export_run_id"] ||
      stored.job.state !== "succeeded" ||
      stored.job.artifact?.artifactId !== input.artifactId ||
      stored.job.artifact.digest !== `sha256:${archive.contentSha256}` ||
      output.verifiedPackage.artifactId !== input.artifactId ||
      !exportRunEqual(output.verifiedPackage.object, exportJobObject(archive))
    )
      exportRunUnavailable();
    const verified = await new SolutionExportArtifactObjects(
      this.storage.store,
    ).read(
      {
        archive,
        manifest,
        archiveFileName: exportRunText(before["archive_file_name"]),
        fileCount: exportRunInteger(before["file_count"]),
        organizationId: input.organizationId,
        projectId: input.projectId,
        solutionRevisionId: exportRunText(before["solution_revision_id"]),
        solutionRevisionDigest: sha256DigestSchema.parse(
          `sha256:${exportRunText(before["solution_manifest_sha256"])}`,
        ),
      },
      () => this.authority.scope(),
      "artifacts.read",
    );
    const rows = await this.authority.query(
      sql(
        "SELECT * FROM solution_export_artifact_files WHERE organization_id=$1 AND project_id=$2 AND solution_export_artifact_id=$3 ORDER BY repository_path",
        [input.organizationId, input.projectId, input.artifactId],
      ),
    );
    if (rows.rows.length !== verified.files.length) exportRunUnavailable();
    const byPath = new Map(verified.files.map((file) => [file.path, file]));
    const contents = new Map<string, Uint8Array>();
    const files = rows.rows.map((row) => {
      const file = byPath.get(exportRunText(row["repository_path"]));
      const id = exportRunText(row["solution_export_file_id"]);
      const preview = row["preview_available"];
      if (
        file === undefined ||
        typeof preview !== "boolean" ||
        file.mediaType !== row["media_type"] ||
        file.ownership !== row["ownership"] ||
        file.checksum !== `sha256:${exportRunText(row["content_sha256"])}` ||
        file.semanticChecksum !==
          `sha256:${exportRunText(row["semantic_sha256"])}` ||
        file.bytes.length !== Number(row["size_bytes"])
      )
        exportRunUnavailable();
      if (preview) contents.set(id, file.bytes.slice());
      return {
        id,
        path: file.path,
        mediaType: file.mediaType,
        ownership: file.ownership,
        checksum: file.checksum,
        semanticChecksum: file.semanticChecksum,
        sizeBytes: file.bytes.length,
        previewAvailable: preview,
      };
    });
    // Database collations need not match the artifact contract's UTF-16 order.
    files.sort((left, right) =>
      left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
    );
    const artifact = solutionExportArtifactV1Schema.parse({
      contractVersion: 1,
      id: input.artifactId,
      jobId: stored.job.id,
      projectId: input.projectId,
      solutionRevisionId: stored.job.solutionRevision.solutionRevisionId,
      archiveFileName: verified.archiveFileName,
      digest: verified.zipDigest,
      manifestDigest: verified.manifestDigest,
      createdAt: exportRunText(before["created_at"]),
      downloadAvailability: {
        state: "available",
        expiresAt: exportRunText(before["retention_expires_at"]),
      },
      fileCount: files.length,
      files,
      sizeBytes: verified.zipBytes.length,
      warnings: stored.job.warnings,
      ...(stored.job.previousArtifactId === undefined
        ? {}
        : { previousArtifactId: stored.job.previousArtifactId }),
    });
    const after = await this.authority.transaction((tx) =>
      this.#inspect(tx, input),
    );
    if (!exportRunEqual(before, after)) denied();
    return {
      artifact,
      fileContents: contents,
      organizationId: input.organizationId,
      targetEnvironment: stored.job.target.environment,
      targetProfileId: stored.targetProfileId,
      targetSettingsDigest: sha256DigestSchema.parse(
        stored.job.target.settingsDigest,
      ),
      verifiedArtifact: verified,
      zipBytes: verified.zipBytes.slice(),
      workflowPackage: asyncJobArtifactReferenceV1Schema.parse(
        output.verifiedPackage,
      ),
    };
  }
  #grant(row: SqlRow, artifact: SqlRow): StoredSolutionExportDownloadGrant {
    const id = exportRunText(row["solution_export_download_grant_id"]);
    const artifactId = exportRunText(row["solution_export_artifact_id"]);
    const projectId = this.authority.ownership.projectId;
    return {
      organizationId: this.authority.ownership.organizationId,
      projectId,
      artifactId,
      principalId: this.#requestPrincipal().principalId,
      grant: solutionExportDownloadGrantV1Schema.parse({
        contractVersion: 1,
        id,
        artifactId,
        digest: `sha256:${exportRunText(row["archive_sha256"])}`,
        expiresAt: exportRunText(row["expires_at"]),
        fileName: artifact["archive_file_name"],
        sizeBytes: exportRunInteger(artifact["size_bytes"]),
        mediaType: "application/zip",
        url: `/v1/projects/${projectId}/solution-export-artifacts/${artifactId}/download-grants/${id}/content`,
      }),
    };
  }
  async getDownloadGrant(
    input: Parameters<Reads["getDownloadGrant"]>[0],
  ): Promise<StoredSolutionExportDownloadGrant | null> {
    this.#selector(input);
    if (input.principalId !== this.#requestPrincipal().principalId) denied();
    return this.authority.transaction(async (tx) => {
      const artifact = await this.#inspect(tx, input);
      if (artifact === null) return null;
      const found = await tx.query(
        sql(
          `SELECT g.solution_export_download_grant_id,g.organization_id,g.project_id,g.solution_export_artifact_id,g.principal_id,g.idempotency_key_sha256,g.archive_sha256,g.revoked_at,g.created_at,${utc("g.expires_at")} AS expires_at FROM solution_export_download_grants g
        WHERE organization_id=$1 AND project_id=$2 AND solution_export_artifact_id=$3 AND principal_id=$4
        AND solution_export_download_grant_id=$5 AND revoked_at IS NULL AND expires_at>clock_timestamp() AND archive_sha256=$6`,
          [
            input.organizationId,
            input.projectId,
            input.artifactId,
            input.principalId,
            input.grantId,
            exportRunText(artifact["archive_sha256"]),
          ],
        ),
      );
      return found.rows[0] === undefined
        ? null
        : this.#grant(found.rows[0], artifact);
    });
  }
  async reserveDownloadGrant(
    input: Parameters<Reads["reserveDownloadGrant"]>[0],
  ): Promise<StoredSolutionExportDownloadGrant> {
    const requested = structuredClone(input.grant),
      grant = solutionExportDownloadGrantV1Schema.parse(requested.grant);
    this.#selector(requested);
    if (
      requested.principalId !== this.#requestPrincipal().principalId ||
      requested.revokedAt !== undefined ||
      grant.artifactId !== requested.artifactId ||
      input.artifact.artifact.id !== grant.artifactId
    )
      denied();
    const artifact = await this.getArtifact(requested);
    if (artifact === null) denied();
    if (
      grant.digest !== artifact.artifact.digest ||
      grant.fileName !== artifact.artifact.archiveFileName ||
      grant.sizeBytes !== artifact.artifact.sizeBytes ||
      grant.url !==
        `/v1/projects/${requested.projectId}/solution-export-artifacts/${requested.artifactId}/download-grants/${grant.id}/content`
    )
      denied();
    const key = sha256DigestSchema.parse(input.idempotencyKeyDigest).slice(7);
    return this.authority.transaction(async (tx) => {
      const fresh = await this.#inspect(tx, requested);
      if (fresh === null) denied();
      await tx.query(
        sql(
          `INSERT INTO solution_export_download_grants(solution_export_download_grant_id,organization_id,project_id,
        solution_export_artifact_id,principal_id,idempotency_key_sha256,archive_sha256,expires_at,created_at)
        SELECT $1,$2,$3,$4,$5,$6,$7,$8::timestamptz,clock_timestamp()
        WHERE $8::timestamptz>clock_timestamp() AND $8::timestamptz<=clock_timestamp()+interval '5 minutes'
          AND $8::timestamptz<=$9::timestamptz ON CONFLICT DO NOTHING`,
          [
            grant.id,
            requested.organizationId,
            requested.projectId,
            requested.artifactId,
            requested.principalId,
            key,
            grant.digest.slice(7),
            grant.expiresAt,
            exportRunText(fresh["retention_expires_at"]),
          ],
        ),
      );
      // The content request rechecks revocation and expiry. Locking this grant
      // would require broad UPDATE rights for the API role without protecting
      // the interval between reservation and download.
      const found = await tx.query(
        sql(
          `SELECT g.solution_export_download_grant_id,g.organization_id,g.project_id,g.solution_export_artifact_id,g.principal_id,g.idempotency_key_sha256,g.archive_sha256,g.revoked_at,g.created_at,${utc("g.expires_at")} AS expires_at FROM solution_export_download_grants g
        WHERE organization_id=$1 AND project_id=$2 AND solution_export_artifact_id=$3 AND principal_id=$4 AND idempotency_key_sha256=$5
        AND revoked_at IS NULL AND expires_at>clock_timestamp()`,
          [
            requested.organizationId,
            requested.projectId,
            requested.artifactId,
            requested.principalId,
            key,
          ],
        ),
      );
      const row = found.rows[0];
      if (
        found.rows.length !== 1 ||
        row?.["solution_export_download_grant_id"] !== grant.id ||
        row["archive_sha256"] !== grant.digest.slice(7)
      )
        denied();
      return this.#grant(row, fresh);
    });
  }
}
