import { PostgresBetaAiCreditMeter } from "./adapters/persistence/beta-ai-credit-meter.js";
import {
  creditBalanceV1Schema,
  creditOverviewV1Schema,
  currentPlanEntitlementsV1Schema,
  usageEventIdSchema,
} from "@cloudmarkup/api-contract";

import { PostgresCommercialPersistenceRepository } from "./adapters/persistence/commercial-repositories.js";
import { sql, type SqlDatabase } from "./adapters/persistence/sql.js";
import { permissionsForRole } from "./application/authorization.js";
import type { CreditOverviewRecord } from "./application/commercial-persistence.js";
import { ApplicationError } from "./application/errors.js";
import type {
  CloudMarkupApplication,
  PrincipalContext,
} from "./application/ports.js";
import { AuthorizedCommercialRequestDatabase } from "./production-commercial-authorization.js";

const creditFields = [
  "activeGrantedCreditUnits",
  "availableCreditUnits",
  "compensatedCreditUnits",
  "debitAdjustmentCreditUnits",
  "netAdjustmentCreditUnits",
  "expiredCreditUnits",
  "reservedCreditUnits",
  "settledCreditUnits",
  "totalGrantedCreditUnits",
  "unresolvedCreditUnits",
] as const;

function checkedInteger(value: string): number {
  if (!/^-?(?:0|[1-9][0-9]*)$/u.test(value))
    throw new Error("Invalid credit integer.");
  const integer = BigInt(value);
  if (
    integer < BigInt(Number.MIN_SAFE_INTEGER) ||
    integer > BigInt(Number.MAX_SAFE_INTEGER)
  )
    throw new Error("Credit integer exceeds the public contract.");
  return Number(integer);
}

const internalLedgerIdPatterns = [
  /^ledger(?:\.release)?\.beta-ai\.[a-f0-9]{64}$/u,
  /^ledger_cutover_[a-f0-9]{40}$/u,
  /^ledger_staff_[a-f0-9]{32}$/u,
  /^topup_ledger_[a-f0-9]{64}$/u,
  /^ledger_[a-f0-9]{48}$/u,
  /^model_terminal_[a-f0-9]{64}$/u,
];

function publicLedgerCursor(ledgerEntryId: string | undefined) {
  if (ledgerEntryId === undefined) return {};
  if (usageEventIdSchema.safeParse(ledgerEntryId).success)
    return { ledgerThroughEventId: ledgerEntryId };
  // Existing accounting writers also use these exact internal namespaces. The
  // public cursor is optional; never expose or rewrite stored ledger identities.
  if (internalLedgerIdPatterns.some((pattern) => pattern.test(ledgerEntryId)))
    return {};
  throw new Error("The organization ledger cursor is invalid.");
}
/** Read-only canonical ledger projection. No account, plan, grant or trial is provisioned. */
export function createProductionCommercialReads(options: {
  readonly database: SqlDatabase;
  readonly clock?: () => Date;
}): Pick<
  CloudMarkupApplication,
  "getCreditBalance" | "getCreditOverview" | "getCurrentPlanEntitlements"
> {
  async function getCreditOverview(
    principal: PrincipalContext,
    organizationId: string,
  ) {
    try {
      const database = new AuthorizedCommercialRequestDatabase(
        options.database,
        principal,
        organizationId,
        "commercial.summary.read",
        options.clock ?? (() => new Date()),
      );
      const context = await database.context();
      const existence = await database.query(
        sql(
          `SELECT EXISTS(SELECT 1 FROM organization_billing_accounts WHERE organization_id = $1) AS has_account,
           to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS as_of`,
          [organizationId],
        ),
      );
      const row = existence.rows[0];
      if (
        existence.rows.length !== 1 ||
        typeof row?.["has_account"] !== "boolean" ||
        typeof row["as_of"] !== "string"
      )
        throw new Error("Invalid account presence evidence.");
      let record: CreditOverviewRecord;
      if (!row["has_account"]) {
        // Authorization and absence were checked together under the same short
        // transaction. Missing/revoked tenants can never become zero balances.
        record = {
          balance: {
            organizationId,
            asOf: row["as_of"],
            exhausted: true,
            activeGrantedCreditUnits: "0",
            availableCreditUnits: "0",
            compensatedCreditUnits: "0",
            debitAdjustmentCreditUnits: "0",
            netAdjustmentCreditUnits: "0",
            expiredCreditUnits: "0",
            reservedCreditUnits: "0",
            settledCreditUnits: "0",
            totalGrantedCreditUnits: "0",
            unresolvedCreditUnits: "0",
          },
          availableByKind: { monthly: "0", purchased: "0", other: "0" },
          nextExpiration: null,
        };
      } else {
        await new PostgresBetaAiCreditMeter(
          options.database,
          options.database,
        ).reconcileExpired(organizationId);
        record = await new PostgresCommercialPersistenceRepository(
          database,
        ).getCreditOverview({
          capabilities: permissionsForRole(context.role),
          correlationId: context.correlationId,
          membershipId: context.membershipId,
          organizationId,
          principalId: principal.principalId,
          roleKey: context.role,
          sessionId: principal.sessionId,
        });
      }
      if (record.balance.organizationId !== organizationId)
        throw new Error("Credit scope mismatch.");
      const { ledgerThroughEventId, ...publicRecord } = record.balance;
      const summary = creditBalanceV1Schema.parse({
        ...publicRecord,
        ...publicLedgerCursor(ledgerThroughEventId),
        ...Object.fromEntries(
          creditFields.map((key) => [key, checkedInteger(record.balance[key])]),
        ),
        contractVersion: 1,
      });
      const overview = creditOverviewV1Schema.parse({
        contractVersion: 1,
        balance: summary,
        availableByKind: Object.fromEntries(
          Object.entries(record.availableByKind).map(([key, units]) => [
            key,
            checkedInteger(units),
          ]),
        ),
        nextExpiration:
          record.nextExpiration === null
            ? null
            : {
                at: record.nextExpiration.at,
                creditUnits: checkedInteger(record.nextExpiration.creditUnits),
              },
      });
      await database.context();
      return overview;
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw new ApplicationError(
        "service_unavailable",
        "The organization credit summary is unavailable.",
      );
    }
  }

  return {
    async getCurrentPlanEntitlements(principal, organizationId) {
      const authority = new AuthorizedCommercialRequestDatabase(
        options.database,
        principal,
        organizationId,
        "commercial.summary.read",
        options.clock ?? (() => new Date()),
      );
      try {
        const context = await authority.context();
        // The repository owns a read-only repeatable-read transaction. Do not
        // insert row-locking queries before its isolation-level declaration.
        const record = await new PostgresCommercialPersistenceRepository(
          options.database,
        ).getCurrentPlanEntitlements({
          capabilities: permissionsForRole(context.role),
          correlationId: context.correlationId,
          membershipId: context.membershipId,
          organizationId,
          principalId: principal.principalId,
          roleKey: context.role,
          sessionId: principal.sessionId,
        });
        if (record.organizationId !== organizationId)
          throw new Error("Plan scope mismatch.");
        const summary = currentPlanEntitlementsV1Schema.parse({
          ...record,
          contractVersion: 1,
          plan: {
            ...record.plan,
            version: checkedInteger(record.plan.version),
          },
          limits: record.limits.map((limit) => ({
            ...limit,
            maximum: checkedInteger(limit.maximum),
          })),
          subscription:
            record.subscription.state === "not-subscribed"
              ? record.subscription
              : {
                  ...record.subscription,
                  projectionVersion: checkedInteger(
                    record.subscription.projectionVersion,
                  ),
                },
        });
        // An earlier snapshot does not permit disclosure after token expiry or
        // revocation. No account, subscription or credit is created by this read.
        await authority.context();
        return summary;
      } catch (error) {
        if (error instanceof ApplicationError) throw error;
        throw new ApplicationError(
          "service_unavailable",
          "The current organization plan could not be verified.",
        );
      }
    },
    getCreditOverview,
    async getCreditBalance(principal, organizationId) {
      return (await getCreditOverview(principal, organizationId)).balance;
    },
  };
}
