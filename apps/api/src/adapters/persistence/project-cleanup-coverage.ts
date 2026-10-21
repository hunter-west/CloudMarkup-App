import {
  parseProjectCleanupWake,
  projectCleanupWake,
  type CleanupWakeLedger,
} from "../../application/project-cleanup-wake.js";
import { sql, type SqlDatabase, type SqlExecutor } from "./sql.js";

/** Explicit operator proof, not the idle dispatcher. Required-mode enforcement
 * covers future deletions; SQL project/control locks keep this bounded snapshot
 * stable while existing intents are strongly checked against the wake ledger.
 * It changes no mode or schedule and never claims coverage from an empty page. */
export async function proveProjectCleanupWakeCoverage(input: {
  readonly database: SqlDatabase;
  readonly ledger: Pick<CleanupWakeLedger, "get">;
  readonly assertSchema: (tx: SqlExecutor) => Promise<void>;
  readonly maximumPending?: number;
}): Promise<{
  readonly covered: boolean;
  readonly pending: number;
  readonly reason?:
    "admission-not-required" | "backlog-exceeds-bound" | "wake-unconfirmed";
}> {
  const limit = input.maximumPending ?? 100;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000)
    throw new Error("The cleanup coverage bound is invalid.");
  return input.database.transaction(async (tx) => {
    await input.assertSchema(tx);
    const controls = await tx.query(
      sql(
        "SELECT admission_required FROM project_cleanup_controls WHERE control_id='beta' FOR SHARE",
      ),
    );
    if (
      controls.rows.length !== 1 ||
      controls.rows[0]?.["admission_required"] !== true
    )
      return { covered: false, pending: 0, reason: "admission-not-required" };
    const result = await tx.query(
      sql(
        `SELECT p.organization_id,p.project_id,p.record_version,
      to_char(p.deletion_requested_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS requested_at,
      a.wake_binding,a.lifecycle_status AS admission_status FROM projects p
      LEFT JOIN project_cleanup_admissions a ON a.organization_id=p.organization_id AND a.project_id=p.project_id
        AND a.expected_record_version+1=p.record_version
        AND (a.wake_binding::jsonb->>'deletionRequestedAt')::timestamptz=p.deletion_requested_at
      WHERE p.lifecycle_status='deletion-pending' AND p.deletion_requested_at IS NOT NULL
      ORDER BY p.organization_id,p.project_id LIMIT $1 FOR SHARE OF p`,
        [limit + 1],
      ),
    );
    if (result.rows.length > limit)
      return {
        covered: false,
        pending: result.rows.length,
        reason: "backlog-exceeds-bound",
      };
    for (const row of result.rows) {
      if (
        typeof row["organization_id"] !== "string" ||
        typeof row["project_id"] !== "string" ||
        typeof row["requested_at"] !== "string"
      )
        throw new Error("The cleanup coverage authority is invalid.");
      const canonical = projectCleanupWake({
        organizationId: row["organization_id"],
        projectId: row["project_id"],
        recordVersion: Number(row["record_version"]),
        deletionRequestedAt: row["requested_at"],
        lifecycleStatus: "deletion-pending",
      });
      const binding = row["wake_binding"];
      if (binding !== null && typeof binding !== "string")
        throw new Error("The cleanup coverage journal is invalid.");
      const wake =
        binding === null
          ? canonical
          : parseProjectCleanupWake(JSON.parse(binding) as unknown);
      if (
        wake.organizationId !== canonical.organizationId ||
        wake.projectId !== canonical.projectId ||
        wake.recordVersion !== canonical.recordVersion ||
        wake.deletionRequestedAt !== canonical.deletionRequestedAt ||
        (wake.schemaVersion === 2 && row["admission_status"] !== "committed")
      )
        throw new Error("The cleanup coverage binding is invalid.");
      const observed = await input.ledger.get(wake.wakeId);
      if (
        observed === null ||
        JSON.stringify(parseProjectCleanupWake(observed)) !==
          JSON.stringify(wake)
      )
        return {
          covered: false,
          pending: result.rows.length,
          reason: "wake-unconfirmed",
        };
    }
    return { covered: true, pending: result.rows.length };
  });
}
