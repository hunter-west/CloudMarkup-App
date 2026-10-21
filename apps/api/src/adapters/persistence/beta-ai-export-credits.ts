import {
  betaInfrastructureJobCreditsV1Schema,
  type BetaInfrastructureJobCreditsV1,
} from "@cloudmarkup/api-contract";
import type {
  CloudMarkupApplication,
  PrincipalContext,
} from "../../application/ports.js";
import type { SolutionExportReadApplication } from "../../application/solution-export-reads.js";
import { sql, type SqlDatabase } from "./sql.js";

/** Reads only the journal for the exact export already authorized by the
 * existing export read boundary. No provider or Stripe API is consulted. */
export function createBetaAiExportCredits(options: {
  readonly database: SqlDatabase;
  readonly application: Pick<CloudMarkupApplication, "getProject">;
  readonly reads: Pick<SolutionExportReadApplication, "getJob">;
}) {
  return {
    async get(
      principal: PrincipalContext,
      projectId: string,
      jobId: string,
    ): Promise<BetaInfrastructureJobCreditsV1> {
      await options.reads.getJob(principal, projectId, jobId);
      const project = await options.application.getProject(
        principal,
        projectId,
      );
      const result = await options.database.query(
        sql(
          "SELECT i.state,i.estimated_credit_units,r.reserved_credit_units," +
            "(SELECT COALESCE(sum(a.settled_credit_units),0) FROM credit_reservation_allocations a " +
            "WHERE a.organization_id=i.organization_id AND a.reservation_id=i.reservation_id) AS actual_credit_units " +
            "FROM beta_ai_invocations i " +
            "JOIN credit_reservations r ON r.organization_id=i.organization_id AND r.reservation_id=i.reservation_id " +
            "WHERE i.organization_id=$1 AND i.project_id=$2 AND i.job_id=$3 AND i.purpose='application-source'",
          [project.value.organizationId, projectId, jobId],
        ),
      );
      if (result.rows.length > 1)
        throw new Error("Conflicting export credit receipts.");
      const row = result.rows[0];
      return betaInfrastructureJobCreditsV1Schema.parse({
        contractVersion: 1,
        jobId,
        ...(row === undefined
          ? { state: "not-metered" }
          : {
              state: row["state"],
              estimatedCreditUnits: String(row["estimated_credit_units"]),
              maximumCreditUnits: String(row["reserved_credit_units"]),
              ...(["settled", "released"].includes(String(row["state"]))
                ? { actualCreditUnits: String(row["actual_credit_units"]) }
                : {}),
            }),
      });
    },
  };
}
