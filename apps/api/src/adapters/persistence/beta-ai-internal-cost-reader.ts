import {
  betaAiCostEvidenceQuery,
  readBetaAiLedgerEvidence,
} from "./beta-ai-cost-evidence.js";
import type { TrustedCommercialAccountingContext } from "../../application/commercial-persistence.js";
import {
  betaAiActualUsage,
  betaAiPricingVersion,
} from "../../application/beta-ai-pricing.js";
import { betaAiReservationId } from "./beta-ai-credit-meter.js";
import { sql, type SqlDatabase, type SqlRow } from "./sql.js";

type AccountingStatus =
  "known" | "not-incurred" | "unresolved" | "conflict" | "unsupported-pricing";
interface Counts {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  providerRequestId: string | null;
}
export interface BetaAiInternalCostRecord {
  readonly organizationId: string;
  readonly reservationId: string;
  readonly accountingStatus: AccountingStatus;
  readonly providerCostMicros: string | null;
  readonly providerCostCurrency: "USD" | null;
  readonly counts: Counts | null;
  readonly evidenceSources: readonly string[];
  readonly financialStatus: string;
  readonly cleanupPending: boolean;
  readonly pricingVersionId: string;
  readonly chargingPolicyVersion: string;
}

const identifier = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const token = (value: unknown): number => {
  if (!/^(0|[1-9][0-9]*)$/u.test(String(value)))
    throw new Error("Invalid usage evidence.");
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new Error("Invalid usage evidence.");
  return n;
};
function counts(
  row: SqlRow,
  input: string,
  output: string,
  cached: string,
  request: string,
): Counts {
  const id = row[request];
  if (
    id != null &&
    (typeof id !== "string" ||
      id.length < 1 ||
      id.length > 128 ||
      id.includes("\0"))
  )
    throw new Error("Invalid request evidence.");
  return {
    inputTokens: token(row[input]),
    outputTokens: token(row[output]),
    cacheReadInputTokens: token(row[cached]),
    providerRequestId: id ?? null,
  };
}
const same = (a: Counts, b: Counts) =>
  a.inputTokens === b.inputTokens &&
  a.outputTokens === b.outputTokens &&
  a.cacheReadInputTokens === b.cacheReadInputTokens &&
  a.providerRequestId === b.providerRequestId;

// This tag validates the port contract; the admitted owner must authenticate it.
const hasAccountingTag = (value: unknown) => value === "internal-accounting";

/** Pure internal projection: one invocation/reservation, never a customer charge.
 * Disagreement or incomplete evidence is diagnostic, never repaired or zeroed. */
export function projectBetaAiInternalCost(
  row: SqlRow,
  ledger: readonly SqlRow[],
  ledgerTruncated = false,
): BetaAiInternalCostRecord {
  const result = (
    accountingStatus: AccountingStatus,
    usage: Counts | null = null,
    sources: string[] = [],
    cost: string | null = null,
  ): BetaAiInternalCostRecord => ({
    organizationId: String(row["organization_id"]),
    reservationId: String(row["reservation_id"]),
    accountingStatus,
    providerCostMicros: cost,
    providerCostCurrency: cost === null ? null : "USD",
    counts: usage,
    evidenceSources: sources,
    financialStatus: String(row["financial_status"]),
    cleanupPending:
      row["financial_status"] === "released" && row["state"] !== "released",
    pricingVersionId: String(row["pricing_version_id"]),
    chargingPolicyVersion: String(row["charging_policy_version"]),
  });
  if (
    row["project_id"] !== row["reservation_project_id"] ||
    row["job_id"] !== row["reservation_job_id"] ||
    row["request_sha256"] !== row["reservation_request_sha256"] ||
    row["request_id"] !== row["reservation_id"] ||
    !["proposal", "application-source"].includes(String(row["purpose"])) ||
    betaAiReservationId({
      organizationId: String(row["organization_id"]),
      projectId: String(row["project_id"]),
      jobId: String(row["job_id"]),
      purpose: row["purpose"] as "proposal" | "application-source",
      requestSha256: String(row["request_sha256"]),
    }) !== row["reservation_id"]
  )
    return result("conflict");
  let pricing;
  try {
    pricing = betaAiPricingVersion(
      row["pricing_version_id"],
      row["charging_policy_version"],
    );
  } catch {
    return result("unsupported-pricing");
  }
  if (
    row["provider_key"] !== pricing.providerKey ||
    row["model_key"] !== pricing.modelId ||
    row["model_version"] !== pricing.modelVersion ||
    row["price_provider_key"] !== pricing.providerKey ||
    row["price_model_key"] !== pricing.modelId ||
    row["price_model_version"] !== pricing.modelVersion ||
    row["price_currency"] !== "USD" ||
    String(row["price_input_rate"]) !==
      String(pricing.inputMicrosPerMillionTokens) ||
    String(row["price_output_rate"]) !==
      String(pricing.outputMicrosPerMillionTokens) ||
    String(row["price_cached_rate"]) !==
      String(pricing.cachedInputMicrosPerMillionTokens)
  )
    return result("conflict");
  const evidence: { counts: Counts; source: string }[] = [];
  let incomplete = ledgerTruncated;
  try {
    if (row["usage_observed_at"] != null)
      evidence.push({
        source: "observation",
        counts: counts(
          row,
          "observed_input_tokens",
          "observed_output_tokens",
          "observed_cached_input_tokens",
          "observed_provider_request_id",
        ),
      });
    if (row["usage_recorded_at"] != null)
      evidence.push({
        source: "retained-legacy",
        counts: counts(
          row,
          "input_tokens",
          "output_tokens",
          "cached_input_tokens",
          "provider_request_id",
        ),
      });
    for (const entry of ledger) {
      if (
        entry["organization_id"] !== row["organization_id"] ||
        entry["reservation_id"] !== row["reservation_id"] ||
        entry["project_id"] !== row["project_id"] ||
        entry["job_id"] !== row["job_id"] ||
        entry["request_id"] !== row["request_id"]
      )
        return result("conflict");
      // Reservation/release events may intentionally omit usage. A settlement or
      // ANY supplied usage field must be complete and agree with original pins.
      const hasUsage = [
        "input_token_count",
        "output_token_count",
        "cached_input_token_count",
        "estimated_provider_cost_micros",
        "provider_cost_currency",
        "provider_request_id",
      ].some((key) => entry[key] != null);
      if (
        !hasUsage &&
        !["settlement", "provider-failure"].includes(
          String(entry["entry_kind"]),
        )
      )
        continue;
      if (
        [
          "input_token_count",
          "output_token_count",
          "cached_input_token_count",
          "estimated_provider_cost_micros",
          "provider_cost_currency",
        ].some((key) => entry[key] == null)
      ) {
        incomplete = true;
        continue;
      }
      if (
        entry["provider_key"] !== pricing.providerKey ||
        entry["model_key"] !== pricing.modelId ||
        entry["model_version"] !== pricing.modelVersion ||
        entry["pricing_version_id"] !== pricing.pricingVersionId ||
        entry["charging_policy_version"] !== pricing.chargingPolicyVersion ||
        entry["provider_cost_currency"] !== "USD"
      )
        return result("conflict");
      const usage = counts(
        entry,
        "input_token_count",
        "output_token_count",
        "cached_input_token_count",
        "provider_request_id",
      );
      if (
        String(entry["estimated_provider_cost_micros"]) !==
        betaAiActualUsage(usage, pricing).providerCostMicros
      )
        return result("conflict");
      evidence.push({
        source: "ledger:" + String(entry["ledger_entry_id"]),
        counts: usage,
      });
    }
  } catch {
    return result("conflict");
  }
  if (evidence.length > 0 && row["dispatched_at"] == null)
    return result("conflict");
  const first = evidence[0];
  if (first && evidence.some((entry) => !same(first.counts, entry.counts)))
    return result("conflict");
  if (incomplete)
    return result(
      "unresolved",
      null,
      evidence.map((entry) => entry.source),
    );
  if (first)
    return result(
      "known",
      first.counts,
      evidence.map((entry) => entry.source),
      betaAiActualUsage(first.counts, pricing).providerCostMicros,
    );
  return result(
    row["dispatched_at"] == null &&
      ["released", "expired"].includes(String(row["financial_status"]))
      ? "not-incurred"
      : "unresolved",
  );
}

export interface BetaAiCostCohort {
  readonly from: string;
  readonly until: string;
  readonly afterReservationId?: string;
}

/** Internal service adapter only. The composition must supply an authenticated
 * accounting actor and its approved organization. This type/tag is the existing
 * trusted-service contract, NOT authentication of caller-supplied JSON. No HTTP
 * route, customer capability, database owner, cron, or role membership is added. */
export class PostgresBetaAiInternalCostReader {
  readonly #database: SqlDatabase;
  constructor(database: SqlDatabase) {
    this.#database = database;
  }
  async readPage(
    context: TrustedCommercialAccountingContext,
    cohort: BetaAiCostCohort,
  ) {
    if (
      !hasAccountingTag(context.authority) ||
      !identifier.test(context.organizationId) ||
      !identifier.test(context.actorId) ||
      typeof context.correlationId !== "string" ||
      context.correlationId.length < 1 ||
      context.correlationId.length > 128
    )
      throw new Error("Internal accounting scope is required.");
    for (const date of [cohort.from, cohort.until])
      if (
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(date) ||
        !Number.isFinite(Date.parse(date)) ||
        new Date(date).toISOString() !== date
      )
        throw new Error("Invalid accounting cohort.");
    if (
      cohort.from >= cohort.until ||
      (cohort.afterReservationId !== undefined &&
        !/^beta-ai\.[a-f0-9]{64}$/u.test(cohort.afterReservationId))
    )
      throw new Error("Invalid accounting cohort cursor.");
    return this.#database.transaction(async (tx) => {
      await tx.query(
        sql("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY"),
      );
      const stamp = await tx.query(
        // Bind the public report timestamp independently of driver-specific
        // timestamp strings or the process/database session timezone.
        sql(
          `SELECT to_char(transaction_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS as_of`,
        ),
      );
      const asOfValue = stamp.rows[0]?.["as_of"];
      const asOf =
        asOfValue instanceof Date ? asOfValue.toISOString() : String(asOfValue);
      if (!Number.isFinite(Date.parse(asOf)))
        throw new Error("Accounting snapshot time is unavailable.");
      const page = await tx.query(
        sql(
          `${betaAiCostEvidenceQuery}
        WHERE i.organization_id=$1 AND r.created_at >= $2::timestamptz AND r.created_at < $3::timestamptz
          AND ($4::text IS NULL OR i.reservation_id>$4) ORDER BY i.reservation_id LIMIT 25`,
          [
            context.organizationId,
            cohort.from,
            cohort.until,
            cohort.afterReservationId ?? null,
          ],
        ),
      );
      const records: BetaAiInternalCostRecord[] = [];
      for (const row of page.rows) {
        if (row["organization_id"] !== context.organizationId)
          throw new Error("Accounting organization scope conflicts.");
        const evidence = await readBetaAiLedgerEvidence(
          tx,
          context.organizationId,
          String(row["reservation_id"]),
        );
        records.push(
          projectBetaAiInternalCost(
            row,
            evidence.rows.slice(0, 25),
            evidence.rows.length > 25,
          ),
        );
      }
      const counts = {
        known: 0,
        "not-incurred": 0,
        unresolved: 0,
        conflict: 0,
        "unsupported-pricing": 0,
      };
      let knownCost = 0n;
      for (const record of records) {
        counts[record.accountingStatus]++;
        if (record.providerCostMicros !== null)
          knownCost += BigInt(record.providerCostMicros);
      }
      const nextCursor =
        page.rows.length === 25
          ? String(page.rows.at(-1)?.["reservation_id"])
          : null;
      return {
        cohort,
        asOf,
        records,
        nextCursor,
        pageOnly: true as const,
        counts,
        knownProviderCostMicros:
          counts.known === 0 ? null : knownCost.toString(),
        knownProviderCostCurrency: counts.known === 0 ? null : ("USD" as const),
        evidenceComplete:
          counts.unresolved +
            counts.conflict +
            counts["unsupported-pricing"] ===
          0,
        // Each page is its own snapshot; cross-page point-in-time totals are NOT
        // promised. An external diagnostic sweep must preserve per-page asOf.
        pointInTimeCohortComplete:
          nextCursor === null && cohort.afterReservationId === undefined,
      };
    });
  }
}
