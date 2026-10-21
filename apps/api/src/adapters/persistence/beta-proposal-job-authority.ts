import { z } from "zod";
import {
  isOrganizationRole,
  permissionsForRole,
} from "../../application/authorization.js";
import type { AuthorizedOrganizationScope } from "../../application/persistence.js";
import { ApplicationError } from "../../application/errors.js";
import type { AsyncJobQueueEnvelopeV1 } from "@cloudmarkup/schemas";
import { exportRunEqual, exportRunText } from "./solution-export-run-codec.js";
import {
  sql,
  type SqlDatabase,
  type SqlExecutor,
  type SqlRow,
  type SqlStatement,
} from "./sql.js";

/** Worker authority comes from the committed exact job and current membership,
 * never identity fields in a model request or an invented authenticated session. */
export class BetaProposalJobAuthority implements SqlDatabase {
  readonly permission = "projects.mutate" as const;
  readonly ownership: { organizationId: string; projectId: string };
  readonly database: SqlDatabase;
  readonly envelope: AsyncJobQueueEnvelopeV1;
  constructor(database: SqlDatabase, envelope: AsyncJobQueueEnvelopeV1) {
    this.database = database;
    this.envelope = envelope;
    if (
      envelope.family !== "architecture-proposal" ||
      !envelope.ownership.projectId
    )
      throw new Error("Invalid proposal delivery.");
    this.ownership = {
      organizationId: envelope.ownership.organizationId,
      projectId: envelope.ownership.projectId,
    };
  }
  async authorize(tx: SqlExecutor): Promise<AuthorizedOrganizationScope> {
    const result = await tx.query(
      sql(
        `SELECT j.created_by_principal_id,j.correlation_id,m.membership_id,m.role_key,to_json(r.capabilities)::text AS capabilities_json
    FROM async_jobs j
    JOIN projects p ON p.organization_id=j.organization_id AND p.project_id=j.project_id AND p.lifecycle_status='active'
    JOIN principals actor ON actor.principal_id=j.created_by_principal_id AND actor.lifecycle_status='active'
    JOIN memberships m ON m.organization_id=j.organization_id AND m.principal_id=actor.principal_id AND m.lifecycle_status='active'
    JOIN organizations o ON o.organization_id=m.organization_id AND o.lifecycle_status='active'
    JOIN organization_roles r ON r.organization_id=m.organization_id AND r.role_key=m.role_key AND r.policy_version='authorization-v2'
    WHERE j.organization_id=$1 AND j.project_id=$2 AND j.job_id=$3 AND j.family='architecture-proposal'
      AND j.input_sha256=$4 AND j.correlation_id=$5 AND j.root_job_id=j.job_id AND j.parent_job_id IS NULL
      AND j.idempotency_actor_id=j.created_by_principal_id AND j.idempotency_scope='cloudmarkup.beta-infrastructure-proposals.create'
    FOR SHARE OF p,actor,m,o,r`,
        [
          this.ownership.organizationId,
          this.ownership.projectId,
          this.envelope.jobId,
          this.envelope.inputDigest.slice(7),
          this.envelope.correlationId,
        ],
      ),
    );
    const row = result.rows[0];
    const role = row?.["role_key"];
    if (
      result.rows.length !== 1 ||
      typeof role !== "string" ||
      !isOrganizationRole(role) ||
      !permissionsForRole(role).includes("projects.mutate") ||
      !exportRunEqual(
        z
          .array(z.string())
          .parse(JSON.parse(exportRunText(row?.["capabilities_json"])))
          .sort(),
        [...permissionsForRole(role)].sort(),
      )
    )
      throw new ApplicationError(
        "access_denied",
        "The proposal is no longer authorized.",
      );
    return {
      organizationId: this.ownership.organizationId,
      principalId: exportRunText(row?.["created_by_principal_id"]),
      correlationId: exportRunText(row?.["correlation_id"]),
      sessionId: "worker:" + this.envelope.jobId,
      membershipId: exportRunText(row?.["membership_id"]),
      roleKey: role,
      capabilities: permissionsForRole(role),
    };
  }
  async assertExecution(workerId: string): Promise<void> {
    const rows = await this.query(
      sql(
        `SELECT j.job_id FROM async_jobs j JOIN async_job_attempts a ON a.organization_id=j.organization_id AND a.job_id=j.job_id AND a.attempt_number=j.attempt_count
    JOIN projects p ON p.organization_id=j.organization_id AND p.project_id=j.project_id
    JOIN architecture_drafts d ON d.organization_id=j.organization_id AND d.project_id=j.project_id AND d.draft_id=j.draft_id AND p.current_draft_id=d.draft_id
    WHERE j.organization_id=$1 AND j.project_id=$2 AND j.job_id=$3 AND j.lifecycle_status='running' AND j.cancellation_requested_at IS NULL
    AND j.expires_at > clock_timestamp() AND a.lifecycle_status='running' AND a.worker_reference=$4 AND a.lease_expires_at > clock_timestamp()
    AND d.draft_version=j.draft_version AND d.pending_document_object_id IS NULL`,
        [
          this.ownership.organizationId,
          this.ownership.projectId,
          this.envelope.jobId,
          workerId,
        ],
      ),
    );
    if (rows.rows.length !== 1)
      throw new ApplicationError(
        "precondition_failed",
        "The proposal draft or job is no longer current.",
      );
  }
  close(): Promise<void> {
    return Promise.resolve();
  }
  transaction<T>(work: (tx: SqlExecutor) => Promise<T>): Promise<T> {
    return this.database.transaction(async (tx) => {
      await this.authorize(tx);
      return work(tx);
    });
  }
  query<T extends SqlRow = SqlRow>(statement: SqlStatement) {
    return this.transaction((tx) => tx.query<T>(statement));
  }
  scope() {
    return this.database.transaction((tx) => this.authorize(tx));
  }
}
