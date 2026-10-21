import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ApplicationError } from "../../application/errors.js";
import {
  gitLabExportApprovalDigest,
  gitLabExportDescriptorSchema,
  gitLabExportMergeRequestSchema,
  gitLabExportRecordSchema,
  gitLabExportReviewIdSchema,
  type GitLabExportDescriptor,
  type GitLabExportRecord,
} from "../../application/gitlab-export-state.js";
import type { GitLabConnectionAuthority } from "./gitlab-connection-authority.js";
import { sql, type SqlExecutor, type SqlRow } from "./sql.js";

const positive = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER - 1);
function invalid(): never {
  throw new ApplicationError(
    "invalid_request",
    "The GitLab export request is invalid.",
  );
}
function conflict(): never {
  throw new ApplicationError(
    "conflict",
    "The GitLab export changed. Reload its current status before continuing.",
  );
}
function missing(): never {
  throw new ApplicationError("not_found", "The GitLab export is unavailable.");
}
const projection = `descriptor,approval_digest,lifecycle_status,record_version,verified_files,commit_sha,merge_request,
  expires_at<=clock_timestamp() AS expired,to_char(expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS expires_at`;
/** Durable one-shot provider dispatch and bounded readback progress. No SQL transaction spans provider I/O. */
export class PostgresGitLabExportReviews {
  readonly #authority: GitLabConnectionAuthority;
  readonly #applicationId: string;
  readonly #projectId: string;
  constructor(
    authority: GitLabConnectionAuthority,
    applicationId: string,
    projectId: string,
  ) {
    if (
      !/^[a-f0-9]{64}$/u.test(applicationId) ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(projectId)
    )
      invalid();
    this.#authority = authority;
    this.#applicationId = applicationId;
    this.#projectId = projectId;
  }
  #scope() {
    return [
      this.#authority.organizationId,
      this.#authority.principal.principalId,
      this.#applicationId,
      this.#projectId,
    ] as const;
  }
  #transaction<T>(
    write: boolean,
    work: (tx: SqlExecutor) => Promise<T>,
  ): Promise<T> {
    return this.#authority.transaction(
      write ? "exports.run" : "integrations.read",
      async (tx) => {
        const project = await tx.query(
          sql(
            `SELECT project_id FROM projects WHERE organization_id=$1 AND project_id=$2 AND lifecycle_status='active' FOR SHARE`,
            [this.#authority.organizationId, this.#projectId],
          ),
        );
        if (project.rows.length !== 1) missing();
        return work(tx);
      },
    );
  }
  #map(row: SqlRow | undefined): GitLabExportRecord {
    if (!row) return missing();
    const value = gitLabExportRecordSchema.parse({
      descriptor: row["descriptor"],
      approvalDigest: row["approval_digest"],
      state: row["lifecycle_status"],
      recordVersion: Number(row["record_version"]),
      verifiedFiles: Number(row["verified_files"]),
      commitSha: row["commit_sha"],
      mergeRequest: row["merge_request"],
      expiresAt: row["expires_at"],
      expired: row["expired"],
    });
    this.#bound(value.descriptor);
    if (value.approvalDigest !== gitLabExportApprovalDigest(value.descriptor))
      conflict();
    return value;
  }
  #bound(value: GitLabExportDescriptor): void {
    if (
      value.organizationId !== this.#authority.organizationId ||
      value.principalId !== this.#authority.principal.principalId ||
      value.applicationId !== this.#applicationId ||
      value.projectId !== this.#projectId
    )
      missing();
  }
  async #read(
    tx: SqlExecutor,
    reviewId: string,
    lock = false,
  ): Promise<GitLabExportRecord> {
    if (!gitLabExportReviewIdSchema.safeParse(reviewId).success)
      return invalid();
    return this.#map(
      (
        await tx.query(
          sql(
            `SELECT ${projection} FROM gitlab_export_reviews WHERE organization_id=$1 AND principal_id=$2 AND application_id=$3 AND project_id=$4 AND review_id=$5${lock ? " FOR UPDATE" : ""}`,
            [...this.#scope(), reviewId],
          ),
        )
      ).rows[0],
    );
  }
  async #selected(
    tx: SqlExecutor,
    value: GitLabExportDescriptor,
  ): Promise<void> {
    const row = (
      await tx.query(
        sql(
          `SELECT s.selection_version FROM gitlab_oauth_connections c
      JOIN gitlab_project_selections s ON s.connection_id=c.connection_id AND s.provider_project_id=$5
      WHERE c.organization_id=$1 AND c.principal_id=$2 AND c.application_id=$3 AND c.connection_id=$4
      AND c.lifecycle_status='active' AND c.grant_expires_at>clock_timestamp() AND s.enabled AND s.selection_version=$6
      FOR SHARE OF c,s`,
          [
            this.#authority.organizationId,
            this.#authority.principal.principalId,
            this.#applicationId,
            value.connectionId,
            value.providerProjectId,
            value.selectionVersion,
          ],
        ),
      )
    ).rows[0];
    if (!row) conflict();
  }
  async #audit(
    tx: SqlExecutor,
    reviewId: string,
    action: string,
  ): Promise<void> {
    await tx.query(
      sql(
        `INSERT INTO audit_events(audit_event_id,organization_id,actor_principal_id,action,target_kind,target_id,outcome,safe_summary,correlation_id)
      VALUES($1,$2,$3,$4,'integration',$5,'succeeded','Updated reviewed GitLab export state.',$6)`,
        [
          "audit_" + randomUUID(),
          this.#authority.organizationId,
          this.#authority.principal.principalId,
          "gitlab.export." + action,
          reviewId,
          this.#authority.principal.correlationId,
        ],
      ),
    );
  }
  create(input: GitLabExportDescriptor): Promise<GitLabExportRecord> {
    const parsed = gitLabExportDescriptorSchema.safeParse(input);
    if (!parsed.success) return invalid();
    const value = parsed.data;
    this.#bound(value);
    const approvalDigest = gitLabExportApprovalDigest(value);
    return this.#transaction(true, async (tx) => {
      await this.#selected(tx, value);
      const count = (
        await tx.query(
          sql(
            `SELECT count(*) AS count FROM gitlab_export_reviews WHERE organization_id=$1 AND principal_id=$2 AND application_id=$3 AND expires_at>clock_timestamp() AND lifecycle_status<>'succeeded'`,
            this.#scope().slice(0, 3),
          ),
        )
      ).rows[0]?.["count"];
      if (Number(count) >= 10)
        throw new ApplicationError(
          "conflict",
          "Finish or allow an existing GitLab export review to expire before creating another.",
        );
      const row = (
        await tx.query(
          sql(
            `INSERT INTO gitlab_export_reviews(organization_id,principal_id,application_id,project_id,review_id,connection_id,provider_project_id,branch_name,descriptor,approval_digest,created_at,updated_at,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,statement_timestamp(),statement_timestamp(),statement_timestamp()+INTERVAL '15 minutes') RETURNING ${projection}`,
            [
              ...this.#scope(),
              value.reviewId,
              value.connectionId,
              value.providerProjectId,
              value.branch,
              JSON.stringify(value),
              approvalDigest,
            ],
          ),
        )
      ).rows[0];
      await this.#audit(tx, value.reviewId, "review");
      return this.#map(row);
    });
  }
  get(reviewId: string): Promise<GitLabExportRecord> {
    return this.#transaction(false, (tx) => this.#read(tx, reviewId));
  }
  #advance(
    reviewId: string,
    expectedVersion: number,
    approvalDigest: string,
    work: (
      tx: SqlExecutor,
      current: GitLabExportRecord,
    ) => Promise<GitLabExportRecord>,
  ): Promise<GitLabExportRecord> {
    if (
      !positive.safeParse(expectedVersion).success ||
      !/^sha256:[a-f0-9]{64}$/u.test(approvalDigest)
    )
      return invalid();
    return this.#transaction(true, async (tx) => {
      const current = await this.#read(tx, reviewId, true);
      if (
        current.recordVersion !== expectedVersion ||
        current.approvalDigest !== approvalDigest
      )
        conflict();
      await this.#selected(tx, current.descriptor);
      return work(tx, current);
    });
  }
  async #write(
    tx: SqlExecutor,
    current: GitLabExportRecord,
    state: GitLabExportRecord["state"],
    verifiedFiles = current.verifiedFiles,
    commitSha = current.commitSha,
    mergeRequest = current.mergeRequest,
  ): Promise<GitLabExportRecord> {
    const row = (
      await tx.query(
        sql(
          `UPDATE gitlab_export_reviews SET lifecycle_status=$6,record_version=record_version+1,verified_files=$7,commit_sha=$8,merge_request=$9::jsonb,updated_at=clock_timestamp()
      WHERE organization_id=$1 AND principal_id=$2 AND application_id=$3 AND project_id=$4 AND review_id=$5 AND record_version=$10 RETURNING ${projection}`,
          [
            ...this.#scope(),
            current.descriptor.reviewId,
            state,
            verifiedFiles,
            commitSha,
            mergeRequest === null ? null : JSON.stringify(mergeRequest),
            current.recordVersion,
          ],
        ),
      )
    ).rows[0];
    if (!row) conflict();
    await this.#audit(tx, current.descriptor.reviewId, state);
    return this.#map(row);
  }
  claimCommit(
    reviewId: string,
    expectedVersion: number,
    approvalDigest: string,
    acknowledgedAutomation: boolean,
  ): Promise<GitLabExportRecord> {
    if (!z.literal(true).safeParse(acknowledgedAutomation).success)
      return invalid();
    return this.#advance(
      reviewId,
      expectedVersion,
      approvalDigest,
      (tx, current) => {
        if (current.state !== "prepared" || current.expired) conflict();
        return this.#write(tx, current, "commit-dispatched");
      },
    );
  }
  beginVerification(
    reviewId: string,
    expectedVersion: number,
    approvalDigest: string,
    commitSha: string,
  ): Promise<GitLabExportRecord> {
    if (!/^[a-f0-9]{40}$/u.test(commitSha)) return invalid();
    return this.#advance(
      reviewId,
      expectedVersion,
      approvalDigest,
      (tx, current) => {
        if (current.state !== "commit-dispatched") conflict();
        return this.#write(tx, current, "verifying", 0, commitSha);
      },
    );
  }
  recordVerifiedFiles(
    reviewId: string,
    expectedVersion: number,
    approvalDigest: string,
    verifiedFiles: number,
  ): Promise<GitLabExportRecord> {
    if (
      !Number.isSafeInteger(verifiedFiles) ||
      verifiedFiles < 1 ||
      verifiedFiles > 512
    )
      return invalid();
    return this.#advance(
      reviewId,
      expectedVersion,
      approvalDigest,
      (tx, current) => {
        if (
          current.state !== "verifying" ||
          verifiedFiles <= current.verifiedFiles ||
          verifiedFiles > current.verifiedFiles + 16 ||
          verifiedFiles > current.descriptor.fileCount
        )
          conflict();
        return this.#write(
          tx,
          current,
          verifiedFiles === current.descriptor.fileCount
            ? "verified"
            : "verifying",
          verifiedFiles,
        );
      },
    );
  }
  claimMergeRequest(
    reviewId: string,
    expectedVersion: number,
    approvalDigest: string,
  ): Promise<GitLabExportRecord> {
    return this.#advance(
      reviewId,
      expectedVersion,
      approvalDigest,
      (tx, current) => {
        if (current.state !== "verified" || current.expired) conflict();
        return this.#write(tx, current, "merge-request-dispatched");
      },
    );
  }
  complete(
    reviewId: string,
    expectedVersion: number,
    approvalDigest: string,
    input: NonNullable<GitLabExportRecord["mergeRequest"]>,
  ): Promise<GitLabExportRecord> {
    const parsed = gitLabExportMergeRequestSchema.safeParse(input);
    if (!parsed.success) return invalid();
    const result = parsed.data;
    return this.#advance(
      reviewId,
      expectedVersion,
      approvalDigest,
      (tx, current) => {
        if (
          current.state !== "merge-request-dispatched" ||
          result.sha !== current.commitSha
        )
          conflict();
        return this.#write(
          tx,
          current,
          "succeeded",
          current.verifiedFiles,
          current.commitSha,
          result,
        );
      },
    );
  }
}
