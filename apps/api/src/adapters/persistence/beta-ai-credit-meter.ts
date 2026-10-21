import { createHash } from "node:crypto";
import { ENTITLEMENT_POLICY_VERSION } from "@cloudmarkup/domain";
import type { BetaConverseUsage } from "@cloudmarkup/model-gateway";
import type { AuthorizedOrganizationScope } from "../../application/persistence.js";
import {
  BETA_AI_PRICING,
  betaAiActualUsage,
  betaAiPricingVersion,
} from "../../application/beta-ai-pricing.js";
import { PostgresCommercialPersistenceRepository } from "./commercial-repositories.js";
import { sql, type SqlDatabase } from "./sql.js";

export type BetaAiPurpose = "proposal" | "application-source";
export interface BetaAiCreditIdentity {
  readonly jobId: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly purpose: BetaAiPurpose;
  readonly requestSha256: string;
}
export interface BetaAiRecordedUsage {
  readonly outputObjectId: string;
  readonly outputSha256: string;
  readonly usage: BetaConverseUsage;
}
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export function betaAiReservationId(identity: BetaAiCreditIdentity) {
  return (
    "beta-ai." +
    digest(
      [identity.organizationId, identity.purpose, identity.jobId].join("\0"),
    )
  );
}
function assertIdentity(identity: BetaAiCreditIdentity) {
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(identity.jobId) ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(identity.projectId) ||
    !/^[a-f0-9]{64}$/u.test(identity.requestSha256)
  )
    throw new Error("The beta AI credit identity is invalid.");
}
function requiredRow(rows: readonly Readonly<Record<string, unknown>>[]) {
  const row = rows[0];
  if (rows.length !== 1 || !row)
    throw new Error("The beta AI credit record is unavailable.");
  return row;
}
/** Uses the existing grant-backed ledger. The journal fences dispatch and
 * records the exact provider usage and durable output needed for settlement. */
export class PostgresBetaAiCreditMeter {
  readonly #database: SqlDatabase;
  readonly #reservationDatabase: SqlDatabase;
  readonly #ledger: PostgresCommercialPersistenceRepository;
  constructor(authority: SqlDatabase, commercialDatabase: SqlDatabase) {
    this.#database = authority;
    this.#reservationDatabase = commercialDatabase;
    // The commercial reader sets REPEATABLE READ before its first statement.
    // Request/worker authorities already issue authorization SQL on transaction
    // entry, so the commercial transaction must use the raw database and recheck
    // the verified membership through its own canonical repository boundary.
    this.#ledger = new PostgresCommercialPersistenceRepository(
      commercialDatabase,
    );
  }
  async reserve(
    scope: AuthorizedOrganizationScope,
    identity: BetaAiCreditIdentity,
    estimatedCreditUnits: string,
    reservedCreditUnits: string,
    expiresAt: string,
  ) {
    assertIdentity(identity);
    if (
      scope.organizationId !== identity.organizationId ||
      !scope.capabilities.includes("commercial.expensive.use")
    )
      throw new Error("AI credit use is not authorized.");
    await this.reconcileExpired(identity.organizationId);
    const plan = await this.#ledger.getCurrentPlanEntitlements(scope);
    if (
      !plan.expensiveOperationsEnabled ||
      !plan.entitlements.some(
        (entry) => entry.feature === "ai-assisted-operations" && entry.enabled,
      )
    )
      throw new Error("AI credit use is unavailable for this workspace.");
    const reservationId = betaAiReservationId(identity);
    const reservation = await this.#reservationDatabase.transaction(
      async (tx) => {
        const previous = await tx.query(
          sql(
            "SELECT r.pricing_version_id,r.charging_policy_version,r.reserved_credit_units,i.estimated_credit_units " +
              "FROM credit_reservations r JOIN beta_ai_invocations i ON i.organization_id=r.organization_id AND i.reservation_id=r.reservation_id " +
              "WHERE r.organization_id=$1 AND r.reservation_id=$2 AND r.project_id=$3 AND r.job_id=$4 AND r.request_sha256=$5 AND i.purpose=$6 AND i.request_sha256=$5",
            [
              identity.organizationId,
              reservationId,
              identity.projectId,
              identity.jobId,
              identity.requestSha256,
              identity.purpose,
            ],
          ),
        );
        if (previous.rows.length > 0) {
          const prior = requiredRow(previous.rows);
          betaAiPricingVersion(
            prior["pricing_version_id"],
            prior["charging_policy_version"],
          );
          return {
            reservedCreditUnits: String(prior["reserved_credit_units"]),
            estimatedCreditUnits: String(prior["estimated_credit_units"]),
          };
        }
        const pricing = BETA_AI_PRICING;
        const heldReservation = await this.#ledger.reserveCreditsInTransaction(
          tx,
          scope,
          {
            chargingPolicyVersion: pricing.chargingPolicyVersion,
            entitlementPolicyVersion: ENTITLEMENT_POLICY_VERSION,
            expiresAt,
            featureKey: "ai-assisted-operations",
            idempotencyKey: "beta-ai:reserve:" + reservationId,
            jobId: identity.jobId,
            modelId: pricing.modelId,
            modelVersion: pricing.modelVersion,
            planVersionId: plan.plan.versionId,
            pricingVersionId: pricing.pricingVersionId,
            projectId: identity.projectId,
            providerKey: pricing.providerKey,
            requestId: reservationId,
            requestSha256: identity.requestSha256,
            requestedCreditUnits: reservedCreditUnits,
            reservationId,
          },
        );
        await tx.query(
          sql(
            `INSERT INTO beta_ai_invocations (organization_id,reservation_id,project_id,job_id,purpose,request_sha256,estimated_credit_units)
       VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (organization_id,reservation_id) DO NOTHING`,
            [
              identity.organizationId,
              reservationId,
              identity.projectId,
              identity.jobId,
              identity.purpose,
              identity.requestSha256,
              BigInt(estimatedCreditUnits),
            ],
          ),
        );
        const row = requiredRow(
          (
            await tx.query(
              sql(
                `SELECT project_id,job_id,purpose,request_sha256,estimated_credit_units FROM beta_ai_invocations WHERE organization_id=$1 AND reservation_id=$2`,
                [identity.organizationId, reservationId],
              ),
            )
          ).rows,
        );
        if (
          row["project_id"] !== identity.projectId ||
          row["job_id"] !== identity.jobId ||
          row["purpose"] !== identity.purpose ||
          row["request_sha256"] !== identity.requestSha256 ||
          String(row["estimated_credit_units"]) !== estimatedCreditUnits
        )
          throw new Error(
            "The AI credit reservation conflicts with a prior invocation.",
          );
        return { ...heldReservation, estimatedCreditUnits };
      },
    );
    return {
      reservationId,
      estimatedCreditUnits: reservation.estimatedCreditUnits,
      reservedCreditUnits: reservation.reservedCreditUnits,
    };
  }
  async claim(
    identity: BetaAiCreditIdentity,
  ): Promise<"dispatch" | "recorded" | "uncertain"> {
    assertIdentity(identity);
    const reservationId = betaAiReservationId(identity);
    return this.#database.transaction(async (tx) => {
      await tx.query(
        sql(
          "SELECT billing_account_id FROM organization_billing_accounts WHERE organization_id=$1 FOR UPDATE",
          [identity.organizationId],
        ),
      );
      const row = requiredRow(
        (
          await tx.query(
            sql(
              `SELECT i.state,i.project_id,i.job_id,i.purpose,i.request_sha256,
                r.status AS reservation_status,r.expires_at > clock_timestamp() AS reservation_current,
                account.lifecycle_status AS account_status,account.expensive_operations_enabled,
                (r.plan_version_id<>'planver_staff_trial_2026_10_06_v1' OR cloudmarkup_staff_trial_current_v1(r.organization_id,r.billing_account_id)) AS trial_admitted
               FROM beta_ai_invocations i
               JOIN credit_reservations r ON r.organization_id=i.organization_id AND r.reservation_id=i.reservation_id
               JOIN organization_billing_accounts account ON account.organization_id=r.organization_id AND account.billing_account_id=r.billing_account_id
               WHERE i.organization_id=$1 AND i.reservation_id=$2 FOR UPDATE OF i`,
              [identity.organizationId, reservationId],
            ),
          )
        ).rows,
      );
      if (
        row["project_id"] !== identity.projectId ||
        row["job_id"] !== identity.jobId ||
        row["purpose"] !== identity.purpose ||
        row["request_sha256"] !== identity.requestSha256
      )
        throw new Error("The AI dispatch identity conflicts.");
      if (row["state"] === "reserved") {
        if (
          row["reservation_status"] !== "active" ||
          row["reservation_current"] !== true ||
          row["trial_admitted"] !== true ||
          row["account_status"] !== "active" ||
          row["expensive_operations_enabled"] !== true
        )
          throw new Error(
            "The beta AI credit reservation is no longer active.",
          );
        await tx.query(
          sql(
            `UPDATE beta_ai_invocations SET state='dispatched',dispatched_at=clock_timestamp() WHERE organization_id=$1 AND reservation_id=$2`,
            [identity.organizationId, reservationId],
          ),
        );
        return "dispatch";
      }
      if (row["state"] === "usage-recorded" || row["state"] === "settled")
        return "recorded";
      return "uncertain";
    });
  }
  async recorded(
    identity: BetaAiCreditIdentity,
  ): Promise<BetaAiRecordedUsage | null> {
    const row = requiredRow(
      (
        await this.#database.query(
          sql(
            `SELECT state,output_object_id,output_sha256,input_tokens,output_tokens,cached_input_tokens,provider_request_id FROM beta_ai_invocations WHERE organization_id=$1 AND reservation_id=$2 AND project_id=$3 AND job_id=$4 AND purpose=$5 AND request_sha256=$6`,
            [
              identity.organizationId,
              betaAiReservationId(identity),
              identity.projectId,
              identity.jobId,
              identity.purpose,
              identity.requestSha256,
            ],
          ),
        )
      ).rows,
    );
    if (row["state"] !== "usage-recorded" && row["state"] !== "settled")
      return null;
    const providerRequestId = row["provider_request_id"];
    if (
      providerRequestId !== null &&
      providerRequestId !== undefined &&
      typeof providerRequestId !== "string"
    )
      throw new Error("The provider request identity is invalid.");
    const usage = {
      inputTokens: Number(row["input_tokens"]),
      outputTokens: Number(row["output_tokens"]),
      cacheReadInputTokens: Number(row["cached_input_tokens"]),
      ...(providerRequestId ? { providerRequestId } : {}),
    };
    betaAiActualUsage(usage);
    return {
      outputObjectId: String(row["output_object_id"]),
      outputSha256: String(row["output_sha256"]),
      usage,
    };
  }
  async record(identity: BetaAiCreditIdentity, evidence: BetaAiRecordedUsage) {
    const reservationId = betaAiReservationId(identity);
    const held = requiredRow(
      (
        await this.#database.query(
          sql(
            `SELECT reserved_credit_units,pricing_version_id,charging_policy_version FROM credit_reservations WHERE organization_id=$1 AND reservation_id=$2 AND project_id=$3 AND job_id=$4 AND status='active'`,
            [
              identity.organizationId,
              reservationId,
              identity.projectId,
              identity.jobId,
            ],
          ),
        )
      ).rows,
    );
    const pricing = betaAiPricingVersion(
      held["pricing_version_id"],
      held["charging_policy_version"],
    );
    const charge = betaAiActualUsage(evidence.usage, pricing);
    if (
      BigInt(charge.creditUnits) > BigInt(String(held["reserved_credit_units"]))
    )
      throw new Error("Provider usage exceeded the reserved credit ceiling.");
    const changed = await this.#database.query(
      sql(
        `UPDATE beta_ai_invocations SET state='usage-recorded',usage_recorded_at=clock_timestamp(),
       provider_request_id=$3,input_tokens=$4,output_tokens=$5,cached_input_tokens=$6,output_object_id=$7,output_sha256=$8
       WHERE organization_id=$1 AND reservation_id=$2 AND project_id=$9 AND job_id=$10 AND purpose=$11 AND request_sha256=$12 AND state='dispatched'`,
        [
          identity.organizationId,
          reservationId,
          evidence.usage.providerRequestId ?? null,
          BigInt(evidence.usage.inputTokens),
          BigInt(evidence.usage.outputTokens),
          BigInt(evidence.usage.cacheReadInputTokens),
          evidence.outputObjectId,
          evidence.outputSha256,
          identity.projectId,
          identity.jobId,
          identity.purpose,
          identity.requestSha256,
        ],
      ),
    );
    if (changed.rowCount !== 1) {
      const prior = await this.recorded(identity);
      if (!prior || JSON.stringify(prior) !== JSON.stringify(evidence))
        throw new Error("The AI usage record conflicts with a prior dispatch.");
    }
    return charge;
  }
  async settle(identity: BetaAiCreditIdentity) {
    const evidence = await this.recorded(identity);
    if (!evidence)
      throw new Error("Delivered AI output has no provider usage evidence.");
    const pricing = await this.reservedPricing(identity);
    const charge = betaAiActualUsage(evidence.usage, pricing);
    const reservationId = betaAiReservationId(identity);
    await this.#ledger.settleReservation(
      {
        actorId: "beta-ai-meter",
        authority: "internal-accounting",
        correlationId: identity.jobId,
        organizationId: identity.organizationId,
      },
      {
        actualNormalizedCreditUnits: charge.creditUnits,
        chargingPolicyVersion: pricing.chargingPolicyVersion,
        chargingScenario: "beta-ai-output-delivered-v1",
        customerChargeCreditUnits: charge.creditUnits,
        estimatedProviderCostMicros: charge.providerCostMicros,
        idempotencyKey: "beta-ai:settle:" + reservationId,
        inputTokenCount: String(evidence.usage.inputTokens),
        outputTokenCount: String(evidence.usage.outputTokens),
        cachedInputTokenCount: String(evidence.usage.cacheReadInputTokens),
        ledgerEntryId: "ledger." + reservationId,
        modelId: pricing.modelId,
        modelVersion: pricing.modelVersion,
        pricingVersionId: pricing.pricingVersionId,
        providerKey: pricing.providerKey,
        providerCostCurrency: "USD",
        ...(evidence.usage.providerRequestId
          ? { providerRequestId: evidence.usage.providerRequestId }
          : {}),
        reasonCode: "beta-ai.output-delivered",
        requestId: reservationId,
        requestSha256: identity.requestSha256,
        reservationId,
      },
    );
    await this.#database.query(
      sql(
        `UPDATE beta_ai_invocations SET state='settled',terminal_at=clock_timestamp() WHERE organization_id=$1 AND reservation_id=$2 AND state='usage-recorded'`,
        [identity.organizationId, reservationId],
      ),
    );
    return charge;
  }
  private async reservedPricing(identity: BetaAiCreditIdentity) {
    const row = requiredRow(
      (
        await this.#reservationDatabase.query(
          sql(
            "SELECT pricing_version_id,charging_policy_version FROM credit_reservations WHERE organization_id=$1 AND reservation_id=$2 AND project_id=$3 AND job_id=$4 AND request_sha256=$5",
            [
              identity.organizationId,
              betaAiReservationId(identity),
              identity.projectId,
              identity.jobId,
              identity.requestSha256,
            ],
          ),
        )
      ).rows,
    );
    return betaAiPricingVersion(
      row["pricing_version_id"],
      row["charging_policy_version"],
    );
  }
  /** Reconciles old holds on an authorized balance or new-use request.
   * A grace window exceeds the bounded model call and worker lease. */
  async reconcileExpired(organizationId: string): Promise<number> {
    const rows = await this.#reservationDatabase.query(
      sql(
        "SELECT i.project_id,i.job_id,i.purpose,i.request_sha256,i.state," +
          "j.lifecycle_status AS job_status," +
          "EXISTS(SELECT 1 FROM async_job_attempts a WHERE a.organization_id=i.organization_id " +
          "AND a.job_id=i.job_id AND a.lifecycle_status='running' AND a.lease_expires_at>clock_timestamp()) AS active_lease," +
          "EXISTS(SELECT 1 FROM stored_objects o WHERE o.organization_id=i.organization_id " +
          "AND o.project_id=i.project_id AND o.object_id=i.output_object_id " +
          "AND o.content_sha256=i.output_sha256 AND o.lifecycle_state='published') AS output_published " +
          "FROM beta_ai_invocations i " +
          "JOIN credit_reservations r ON r.organization_id=i.organization_id AND r.reservation_id=i.reservation_id " +
          "LEFT JOIN async_jobs j ON j.organization_id=i.organization_id AND j.project_id=i.project_id AND j.job_id=i.job_id " +
          "WHERE i.organization_id=$1 AND r.status='active' " +
          "AND r.expires_at<=$2::timestamptz-INTERVAL '10 minutes' " +
          "ORDER BY r.expires_at,i.reservation_id LIMIT 25",
        [organizationId, new Date().toISOString()],
      ),
    );
    for (const row of rows.rows) {
      if (row["active_lease"] === true) continue;
      const identity: BetaAiCreditIdentity = {
        organizationId,
        projectId: String(row["project_id"]),
        jobId: String(row["job_id"]),
        purpose:
          row["purpose"] === "application-source"
            ? "application-source"
            : "proposal",
        requestSha256: String(row["request_sha256"]),
      };
      try {
        if (
          row["state"] === "usage-recorded" &&
          row["output_published"] === true &&
          (identity.purpose === "application-source" ||
            row["job_status"] === "succeeded")
        )
          await this.settle(identity);
        else await this.release(identity);
      } catch (error) {
        const terminal = await this.#reservationDatabase.query(
          sql(
            "SELECT status FROM credit_reservations WHERE organization_id=$1 AND reservation_id=$2",
            [organizationId, betaAiReservationId(identity)],
          ),
        );
        if (terminal.rows[0]?.["status"] === "active") throw error;
      }
    }
    return rows.rows.length;
  }
  async release(identity: BetaAiCreditIdentity) {
    const reservationId = betaAiReservationId(identity);
    const row = requiredRow(
      (
        await this.#reservationDatabase.query(
          sql(
            `SELECT state FROM beta_ai_invocations WHERE organization_id=$1 AND reservation_id=$2 AND project_id=$3 AND job_id=$4 AND purpose=$5 AND request_sha256=$6`,
            [
              identity.organizationId,
              reservationId,
              identity.projectId,
              identity.jobId,
              identity.purpose,
              identity.requestSha256,
            ],
          ),
        )
      ).rows,
    );
    if (row["state"] === "settled" || row["state"] === "released") return;
    const pricing = await this.reservedPricing(identity);
    await this.#ledger.releaseReservation(
      {
        actorId: "beta-ai-meter",
        authority: "internal-accounting",
        correlationId: identity.jobId,
        organizationId: identity.organizationId,
      },
      {
        chargingPolicyVersion: pricing.chargingPolicyVersion,
        chargingScenario:
          row["state"] === "reserved"
            ? "user-cancelled-before-invocation"
            : "cloudmarkup-internal-failure",
        idempotencyKey: "beta-ai:release:" + reservationId,
        ledgerEntryId: "ledger.release." + reservationId,
        reasonCode: "beta-ai.output-unavailable",
        requestId: reservationId,
        requestSha256: identity.requestSha256,
        reservationId,
      },
    );
    await this.#reservationDatabase.query(
      sql(
        `UPDATE beta_ai_invocations SET state='released',terminal_at=clock_timestamp(),usage_recorded_at=NULL,
       provider_request_id=NULL,input_tokens=NULL,output_tokens=NULL,cached_input_tokens=NULL,output_object_id=NULL,output_sha256=NULL
       WHERE organization_id=$1 AND reservation_id=$2 AND state IN ('reserved','dispatched','usage-recorded')`,
        [identity.organizationId, reservationId],
      ),
    );
  }
}
