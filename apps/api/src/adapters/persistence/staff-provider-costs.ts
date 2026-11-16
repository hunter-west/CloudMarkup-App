import {
  organizationIdSchema,
  staffProviderCostCursorV1Schema,
  staffProviderCostQueryV1Schema,
  staffProviderCostReportV1Schema,
} from "@cloudmarkup/api-contract";
import type { StaffProviderCostsApplication } from "../../application/staff-provider-costs.js";
import type { PrincipalContext } from "../../application/ports.js";
import { ApplicationError } from "../../application/errors.js";
import { authorizePlatformStaff } from "./staff-accounts.js";
import { PostgresBetaAiInternalCostReader } from "./beta-ai-internal-cost-reader.js";
import { sql, type SqlDatabase } from "./sql.js";

const denied = () =>
  new ApplicationError(
    "access_denied",
    "Provider-cost access for this organization is required.",
  );
const invalid = () =>
  new ApplicationError(
    "invalid_request",
    "The provider-cost report page is invalid.",
  );

/** Current canonical staff permission AND an explicit organization grant.
 * Authorization transactions stay separate from the adapter's READ ONLY page.
 * Reauthorization/version checks discard results if authority changes mid-read. */
export class PostgresStaffProviderCosts implements StaffProviderCostsApplication {
  readonly #database: SqlDatabase;
  constructor(database: SqlDatabase) {
    this.#database = database;
  }
  async #scope(principal: PrincipalContext, target: string) {
    return this.#database.transaction(async (tx) => {
      // Keep the existing session lock and canonical checks. Permission/scope
      // rows are SELECT-only: no UPDATE grant just to acquire a row lock. The
      // operator shares the session lock; a second authorization after the
      // read also requires the same global and organization grant versions.
      await authorizePlatformStaff(
        tx,
        principal,
        "provider-costs.read",
        false,
        false,
      );
      const result = await tx.query(
        sql(
          `SELECT g.organization_id,g.record_version::text AS scope_version,s.record_version::text AS staff_version
         FROM platform_staff_provider_cost_authorizations g
         JOIN platform_staff_authorizations s ON s.principal_id=g.principal_id
         JOIN organizations o ON o.organization_id=g.organization_id
         WHERE g.principal_id=$1 AND g.organization_id=$2 AND g.revoked_at IS NULL
           AND s.revoked_at IS NULL AND g.staff_authorization_version=s.record_version
           AND 'provider-costs.read'=ANY(s.permissions)
           AND o.lifecycle_status IN ('active','suspended')`,
          [principal.principalId, target],
        ),
      );
      const row = result.rows[0];
      if (
        result.rows.length !== 1 ||
        row?.["organization_id"] !== target ||
        typeof row["scope_version"] !== "string" ||
        !/^[1-9][0-9]*$/u.test(row["scope_version"]) ||
        typeof row["staff_version"] !== "string" ||
        !/^[1-9][0-9]*$/u.test(row["staff_version"])
      )
        throw denied();
      return {
        organizationId: target,
        scopeVersion: row["scope_version"],
        staffVersion: row["staff_version"],
      };
    });
  }
  read: StaffProviderCostsApplication["read"] = async (
    principal,
    organizationId,
    input,
  ) => {
    const actor = Object.freeze({ ...principal });
    const parsed = staffProviderCostQueryV1Schema.safeParse(input);
    if (
      !organizationIdSchema.safeParse(organizationId).success ||
      !parsed.success
    )
      throw invalid();
    const { from, until, cursor } = parsed.data;
    let afterReservationId: string | undefined;
    if (cursor !== undefined) {
      try {
        const decoded: unknown = JSON.parse(
          Buffer.from(cursor, "base64url").toString("utf8"),
        );
        const page = staffProviderCostCursorV1Schema.parse(decoded);
        if (
          page.organizationId !== organizationId ||
          page.from !== from ||
          page.until !== until
        )
          throw invalid();
        afterReservationId = page.afterReservationId;
      } catch {
        throw invalid();
      }
    }
    try {
      const scope = await this.#scope(actor, organizationId);
      const page = await new PostgresBetaAiInternalCostReader(
        this.#database,
      ).readPage(
        {
          authority: "internal-accounting",
          actorId: actor.principalId,
          organizationId: scope.organizationId,
          correlationId: actor.correlationId,
        },
        {
          from,
          until,
          ...(afterReservationId === undefined ? {} : { afterReservationId }),
        },
      );
      const current = await this.#scope(actor, scope.organizationId);
      if (
        current.scopeVersion !== scope.scopeVersion ||
        current.staffVersion !== scope.staffVersion
      )
        throw denied();
      return staffProviderCostReportV1Schema.parse({
        contractVersion: 1,
        organizationId: scope.organizationId,
        cohort: { from, until },
        asOf: page.asOf,
        records: page.records.map((row) => ({
          organizationId: row.organizationId,
          reservationId: row.reservationId,
          accountingStatus: row.accountingStatus,
          providerCostMicros: row.providerCostMicros,
          providerCostCurrency: row.providerCostCurrency,
          counts:
            row.counts === null
              ? null
              : {
                  inputTokens: row.counts.inputTokens,
                  outputTokens: row.counts.outputTokens,
                  cacheReadInputTokens: row.counts.cacheReadInputTokens,
                },
          evidenceSources: [
            ...new Set(
              row.evidenceSources.map((source) =>
                source.startsWith("ledger:") ? "ledger" : source,
              ),
            ),
          ],
          financialStatus: row.financialStatus,
          cleanupPending: row.cleanupPending,
          pricingVersionId: row.pricingVersionId,
          chargingPolicyVersion: row.chargingPolicyVersion,
        })),
        nextCursor:
          page.nextCursor === null
            ? null
            : Buffer.from(
                JSON.stringify({
                  contractVersion: 1,
                  organizationId: scope.organizationId,
                  from,
                  until,
                  afterReservationId: page.nextCursor,
                }),
              ).toString("base64url"),
        pageOnly: page.pageOnly,
        counts: page.counts,
        knownProviderCostMicros: page.knownProviderCostMicros,
        knownProviderCostCurrency: page.knownProviderCostCurrency,
        evidenceComplete: page.evidenceComplete,
        pointInTimeCohortComplete: page.pointInTimeCohortComplete,
      });
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw new ApplicationError(
        "service_unavailable",
        "The provider-cost report is unavailable. Try again later.",
      );
    }
  };
}
