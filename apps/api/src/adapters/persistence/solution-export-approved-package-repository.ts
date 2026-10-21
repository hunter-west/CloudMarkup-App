import type { ApprovedSolutionPackageRepository } from "@cloudmarkup/github-repository-export/ports";
import {
  serializeCanonicalJson,
  sha256DigestSchema,
} from "@cloudmarkup/schemas";

import {
  isOrganizationRole,
  permissionsForRole,
} from "../../application/authorization.js";
import { ApplicationError } from "../../application/errors.js";
import type {
  AuthorizedOrganizationScope,
  ObjectStore,
  StoredObjectReference,
} from "../../application/persistence.js";
import type { PrincipalContext } from "../../application/ports.js";
import {
  SolutionExportArtifactObjects,
  type RetainedSolutionExportObjects,
} from "./solution-export-artifact-objects.js";
import { sql, type SqlDatabase, type SqlExecutor, type SqlRow } from "./sql.js";

const identifier = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
function unavailable(): never {
  throw new ApplicationError(
    "service_unavailable",
    "The retained export is unavailable.",
  );
}
function notFound(): never {
  throw new ApplicationError(
    "not_found",
    "The requested resource is unavailable.",
  );
}
function string(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) unavailable();
  return value;
}
function integer(value: unknown, maximum: number): number {
  const parsed =
    typeof value === "bigint" ||
    (typeof value === "string" && /^\d+$/u.test(value))
      ? Number(value)
      : value;
  if (
    typeof parsed !== "number" ||
    !Number.isSafeInteger(parsed) ||
    parsed < 1 ||
    parsed > maximum
  )
    unavailable();
  return parsed;
}
function object(
  row: SqlRow,
  prefix: "manifest" | "archive",
  organizationId: string,
  projectId: string,
): StoredObjectReference {
  const storageProvider = row[`${prefix}_storage_provider`];
  if (
    storageProvider !== "s3" &&
    storageProvider !== "filesystem" &&
    storageProvider !== "memory"
  )
    unavailable();
  const checksum = string(row[`${prefix}_sha256`]);
  sha256DigestSchema.parse(`sha256:${checksum}`);
  return {
    contentSha256: checksum,
    ...(row[`${prefix}_entity_tag`] === null
      ? {}
      : { entityTag: string(row[`${prefix}_entity_tag`]) }),
    mediaType: prefix === "manifest" ? "application/json" : "application/zip",
    objectId: string(row[`${prefix}_object_id`]),
    objectVersion: string(row[`${prefix}_object_version`]),
    owner: { organizationId, projectId },
    purpose: prefix === "manifest" ? "artifact-manifest" : "export-package",
    sizeBytes: integer(
      row[prefix === "manifest" ? "manifest_size_bytes" : "size_bytes"],
      prefix === "manifest" ? 33_554_432 : 67_108_864,
    ),
    storageKey: string(row[`${prefix}_storage_key`]),
    storageProvider,
  };
}

/** Request-bound, current-authority reads of existing0012 terminal artifacts only. */
export class PostgresApprovedSolutionPackageRepository implements ApprovedSolutionPackageRepository {
  readonly #database: SqlDatabase;
  readonly #principal: PrincipalContext;
  readonly #objects: SolutionExportArtifactObjects;
  readonly #clock: () => Date;
  constructor(options: {
    readonly database: SqlDatabase;
    readonly principal: PrincipalContext;
    readonly objectStore: ObjectStore;
    readonly clock?: () => Date;
  }) {
    this.#database = options.database;
    this.#principal = structuredClone(options.principal);
    this.#objects = new SolutionExportArtifactObjects(options.objectStore);
    this.#clock = options.clock ?? (() => new Date());
  }

  #assertAuthentication(): void {
    if (
      !Number.isFinite(Date.parse(this.#principal.expiresAt)) ||
      Date.parse(this.#principal.expiresAt) <= this.#clock().getTime()
    )
      throw new ApplicationError(
        "authentication_required",
        "Authentication is required.",
      );
  }

  async #authorize(
    transaction: SqlExecutor,
    organizationId: string,
    projectId: string,
  ): Promise<AuthorizedOrganizationScope> {
    this.#assertAuthentication();
    const result = await transaction.query(
      sql(
        `SELECT m.membership_id, m.role_key, to_json(r.capabilities)::text AS capabilities_json
       FROM memberships m
       JOIN principals p ON p.principal_id=m.principal_id AND p.lifecycle_status='active'
       JOIN organizations o ON o.organization_id=m.organization_id AND o.lifecycle_status='active'
       JOIN organization_roles r ON r.organization_id=m.organization_id AND r.role_key=m.role_key AND r.policy_version='authorization-v2'
       JOIN projects project ON project.organization_id=m.organization_id AND project.project_id=$3 AND project.lifecycle_status='active'
       WHERE m.principal_id=$1 AND m.organization_id=$2 AND m.lifecycle_status='active'
       FOR SHARE OF m, p, o, r, project`,
        [this.#principal.principalId, organizationId, projectId],
      ),
    );
    const row = result.rows[0];
    const role = row?.["role_key"];
    if (
      result.rows.length !== 1 ||
      typeof role !== "string" ||
      !isOrganizationRole(role)
    )
      notFound();
    let capabilities: unknown;
    try {
      capabilities = JSON.parse(string(row?.["capabilities_json"])) as unknown;
    } catch {
      unavailable();
    }
    if (
      !Array.isArray(capabilities) ||
      capabilities.some((value: unknown) => typeof value !== "string") ||
      JSON.stringify((capabilities as unknown[]).map(String).sort()) !==
        JSON.stringify([...permissionsForRole(role)].sort())
    )
      unavailable();
    if (!permissionsForRole(role).includes("exports.run"))
      throw new ApplicationError(
        "access_denied",
        "This account cannot export this project.",
      );
    return {
      capabilities: permissionsForRole(role),
      correlationId: this.#principal.correlationId,
      membershipId: string(row?.["membership_id"]),
      organizationId,
      principalId: this.#principal.principalId,
      roleKey: role,
      sessionId: this.#principal.sessionId,
    };
  }

  async withAuthorizedProject<T>(
    input: { readonly organizationId: string; readonly projectId: string },
    work: (
      transaction: SqlExecutor,
      scope: AuthorizedOrganizationScope,
    ) => Promise<T>,
  ): Promise<T> {
    if (
      ![input.organizationId, input.projectId].every((value) =>
        identifier.test(value),
      )
    )
      throw new ApplicationError(
        "invalid_request",
        "The export selector is invalid.",
      );
    return this.#database.transaction(async (transaction) => {
      const scope = await this.#authorize(
        transaction,
        input.organizationId,
        input.projectId,
      );
      const result = await work(transaction, scope);
      this.#assertAuthentication();
      return result;
    });
  }

  async #inspect(
    input: Parameters<
      ApprovedSolutionPackageRepository["getApprovedPackage"]
    >[0],
  ) {
    const { artifactId, organizationId, projectId } = input;
    if (
      ![artifactId, organizationId, projectId].every((value) =>
        identifier.test(value),
      )
    )
      throw new ApplicationError(
        "invalid_request",
        "The export selector is invalid.",
      );
    return this.#database.transaction(async (transaction) => {
      const scope = await this.#authorize(
        transaction,
        organizationId,
        projectId,
      );
      const found = await transaction.query(
        sql(
          `SELECT a.archive_file_name, a.file_count, a.manifest_object_id, a.manifest_sha256,
          a.manifest_size_bytes, a.archive_object_id, a.archive_sha256, a.size_bytes,
          a.solution_revision_id, r.solution_manifest_sha256, r.request_sha256, r.target_settings_sha256,
          r.target_profile_id, r.environment_type, r.environment_id,
          m.storage_provider AS manifest_storage_provider, m.storage_key AS manifest_storage_key,
          m.object_version AS manifest_object_version, m.entity_tag AS manifest_entity_tag,
          z.storage_provider AS archive_storage_provider, z.storage_key AS archive_storage_key,
          z.object_version AS archive_object_version, z.entity_tag AS archive_entity_tag
         FROM solution_export_artifacts a
         JOIN solution_export_runs r ON r.organization_id=a.organization_id AND r.project_id=a.project_id AND r.solution_export_run_id=a.solution_export_run_id
         JOIN async_jobs j ON j.organization_id=r.organization_id AND j.project_id=r.project_id AND j.job_id=r.root_job_id
         JOIN stored_objects m ON m.organization_id=a.organization_id AND m.project_id=a.project_id AND m.object_id=a.manifest_object_id
         JOIN stored_objects z ON z.organization_id=a.organization_id AND z.project_id=a.project_id AND z.object_id=a.archive_object_id
         WHERE a.organization_id=$1 AND a.project_id=$2 AND a.solution_export_artifact_id=$3
          AND a.retention_expires_at > GREATEST(CURRENT_TIMESTAMP, $4::timestamptz)
          AND r.lifecycle_status='succeeded' AND r.completed_at IS NOT NULL
          AND r.cancellation_requested_at IS NULL AND r.solution_revision_id=a.solution_revision_id
          AND r.generation_coverage_object_id IS NOT NULL AND r.evidence_object_id IS NOT NULL AND r.workflow_read_model_object_id IS NOT NULL
          AND j.lifecycle_status='succeeded' AND j.family='solution-export-orchestration'
          AND j.solution_revision_id=r.solution_revision_id AND j.solution_manifest_sha256=r.solution_manifest_sha256
          AND m.lifecycle_state='published' AND m.object_purpose='artifact-manifest' AND m.media_type='application/json'
          AND m.content_sha256=a.manifest_sha256 AND m.size_bytes=a.manifest_size_bytes
          AND z.lifecycle_state='published' AND z.object_purpose='export-package' AND z.media_type='application/zip'
          AND z.content_sha256=a.archive_sha256 AND z.size_bytes=a.size_bytes`,
          [organizationId, projectId, artifactId, this.#clock().toISOString()],
        ),
      );
      if (found.rows.length > 1) unavailable();
      this.#assertAuthentication();
      return { row: found.rows[0], scope };
    });
  }

  /** Metadata-only recheck suitable immediately before a provider request. */
  async assertAvailable(
    input: Parameters<
      ApprovedSolutionPackageRepository["getApprovedPackage"]
    >[0],
    expectedArchiveDigest: string,
  ): Promise<void> {
    const current = await this.#inspect(input);
    if (current.row === undefined) notFound();
    if (
      `sha256:${string(current.row["archive_sha256"])}` !==
      expectedArchiveDigest
    )
      unavailable();
  }

  async getApprovedPackage(
    input: Parameters<
      ApprovedSolutionPackageRepository["getApprovedPackage"]
    >[0],
  ) {
    const { artifactId, organizationId, projectId } = input;
    const inspect = () => this.#inspect(input);
    const first = await inspect();
    if (first.row === undefined) return null;
    const row = first.row;
    const metadata: RetainedSolutionExportObjects = {
      archive: object(row, "archive", organizationId, projectId),
      archiveFileName: string(row["archive_file_name"]),
      fileCount: integer(row["file_count"], 2_048),
      manifest: object(row, "manifest", organizationId, projectId),
      organizationId,
      projectId,
      solutionRevisionDigest: sha256DigestSchema.parse(
        `sha256:${string(row["solution_manifest_sha256"])}`,
      ),
      solutionRevisionId: string(row["solution_revision_id"]),
    };
    const authorize = async () => {
      const current = await inspect();
      if (current.row === undefined) notFound();
      const fingerprint = (value: SqlRow) =>
        serializeCanonicalJson(
          Object.fromEntries(
            Object.entries(value).map(([key, entry]) => [
              key,
              typeof entry === "bigint" ? entry.toString() : entry,
            ]),
          ),
        );
      if (fingerprint(current.row) !== fingerprint(row)) unavailable();
      return current.scope;
    };
    // Object I/O happens after the transaction has committed, never under its locks.
    const artifact = await this.#objects.read(metadata, authorize);
    const external = artifact.manifest.status.externalStages;
    if (
      external !== undefined &&
      (external.workflowRequestDigest !==
        `sha256:${string(row["request_sha256"])}` ||
        external.targetSettingsDigest !==
          `sha256:${string(row["target_settings_sha256"])}` ||
        external.environment.environmentType !== row["environment_type"] ||
        (external.environment.environmentId ?? null) !== row["environment_id"])
    )
      unavailable();
    await authorize();
    return { artifact, artifactId, organizationId, projectId };
  }
}
