import type { BetaConverseUsage } from "@cloudmarkup/model-gateway";
import { betaAiActualUsage } from "../../application/beta-ai-pricing.js";
import { sql, type SqlDatabase, type SqlExecutor, type SqlRow } from "./sql.js";

export interface BetaAiUsageObservationIdentity {
  readonly organizationId: string;
  readonly reservationId: string;
  readonly projectId: string;
  readonly jobId: string;
  readonly purpose: "proposal" | "application-source";
  readonly requestSha256: string;
}
export interface BetaAiReleaseAccounting {
  readonly cleanup: "complete" | "pending";
  readonly accounting: "known" | "unresolved" | "not-incurred" | "conflict";
}
export class BetaAiUsageConflict extends Error {}

const predicate = `organization_id=$1 AND reservation_id=$2 AND project_id=$3
  AND job_id=$4 AND purpose=$5 AND request_sha256=$6`;
const keys = (identity: BetaAiUsageObservationIdentity) => [
  identity.organizationId,
  identity.reservationId,
  identity.projectId,
  identity.jobId,
  identity.purpose,
  identity.requestSha256,
];
function validate(usage: BetaConverseUsage) {
  betaAiActualUsage(usage); // Validate counts only; no customer or cost mutation.
  if (
    usage.providerRequestId !== undefined &&
    (typeof usage.providerRequestId !== "string" ||
      usage.providerRequestId.length < 1 ||
      usage.providerRequestId.length > 128 ||
      usage.providerRequestId.includes("\0"))
  )
    throw new BetaAiUsageConflict("The provider request identity is invalid.");
}
async function read(
  database: SqlExecutor,
  identity: BetaAiUsageObservationIdentity,
) {
  const result = await database.query(
    sql(
      `SELECT state,dispatched_at,usage_observed_at,observed_provider_request_id,
      observed_input_tokens,observed_output_tokens,observed_cached_input_tokens,
      usage_recorded_at,provider_request_id,input_tokens,output_tokens,cached_input_tokens
     FROM beta_ai_invocations WHERE ${predicate}`,
      keys(identity),
    ),
  );
  if (result.rows.length !== 1 || result.rows[0] === undefined)
    throw new BetaAiUsageConflict("The exact beta invocation is unavailable.");
  return result.rows[0];
}
function matches(row: SqlRow, usage: BetaConverseUsage) {
  return (
    row["usage_observed_at"] != null &&
    (row["observed_provider_request_id"] ?? null) ===
      (usage.providerRequestId ?? null) &&
    String(row["observed_input_tokens"]) === String(usage.inputTokens) &&
    String(row["observed_output_tokens"]) === String(usage.outputTokens) &&
    String(row["observed_cached_input_tokens"]) ===
      String(usage.cacheReadInputTokens)
  );
}
function assertObserved(row: SqlRow, usage: BetaConverseUsage) {
  if (
    row["dispatched_at"] == null ||
    (row["usage_observed_at"] != null && !matches(row, usage))
  )
    throw new BetaAiUsageConflict(
      "The provider usage conflicts with its committed dispatch.",
    );
}
function status(row: SqlRow): BetaAiReleaseAccounting {
  return {
    cleanup: "complete",
    accounting:
      row["usage_observed_at"] != null || row["usage_recorded_at"] != null
        ? "known"
        : row["dispatched_at"] == null
          ? "not-incurred"
          : "unresolved",
  };
}

/** Read-only accounting status; does not assert or change financial completion. */
export async function readBetaAiAccountingStatus(
  database: SqlDatabase,
  identity: BetaAiUsageObservationIdentity,
) {
  return status(await read(database, identity)).accounting;
}

/** Replays only persistence, never the provider. A read resolves a lost commit
 * acknowledgement; at most one additional write retries the same identity.
 * A caller must retain known usage and pass it to release if this still fails. */
export async function recordBetaAiUsageObservation(
  database: SqlDatabase,
  identity: BetaAiUsageObservationIdentity,
  usage: BetaConverseUsage,
): Promise<void> {
  validate(usage);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await database.transaction(async (transaction) => {
        await transaction.query(
          sql(
            `UPDATE beta_ai_invocations SET usage_observed_at=clock_timestamp(),
            observed_provider_request_id=$7,observed_input_tokens=$8,
            observed_output_tokens=$9,observed_cached_input_tokens=$10
           WHERE ${predicate} AND dispatched_at IS NOT NULL AND usage_observed_at IS NULL`,
            [
              ...keys(identity),
              usage.providerRequestId ?? null,
              BigInt(usage.inputTokens),
              BigInt(usage.outputTokens),
              BigInt(usage.cacheReadInputTokens),
            ],
          ),
        );
        const row = await read(transaction, identity);
        assertObserved(row, usage);
        if (!matches(row, usage))
          throw new Error("The provider usage write is unresolved.");
      });
      return;
    } catch (error) {
      if (error instanceof BetaAiUsageConflict) throw error;
      try {
        const row = await read(database, identity);
        assertObserved(row, usage);
        if (matches(row, usage)) return;
      } catch (reconciliationError) {
        if (reconciliationError instanceof BetaAiUsageConflict)
          throw reconciliationError;
      }
    }
  }
  throw new Error(
    "Beta usage preservation is unresolved; the provider must not be invoked again.",
  );
}

/** Called only after the existing ledger release succeeds or replays. PostgreSQL
 * evaluates each assignment from the old row: retained legacy counts are copied
 * into write-once evidence in the SAME statement that clears operational fields.
 * On failure the old row survives, while the financial release stays available. */
export async function completeBetaAiRelease(
  database: SqlDatabase,
  identity: BetaAiUsageObservationIdentity,
  knownUsage?: BetaConverseUsage,
): Promise<BetaAiReleaseAccounting> {
  if (knownUsage) validate(knownUsage);
  const incoming = {
    request: "CASE WHEN $7 THEN $8::varchar ELSE provider_request_id END",
    input: "CASE WHEN $7 THEN $9::bigint ELSE input_tokens END",
    output: "CASE WHEN $7 THEN $10::bigint ELSE output_tokens END",
    cached: "CASE WHEN $7 THEN $11::bigint ELSE cached_input_tokens END",
  };
  let retained: SqlRow | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const changed = await database.query(
        sql(
          `UPDATE beta_ai_invocations SET state='released',terminal_at=COALESCE(terminal_at,clock_timestamp()),
          usage_observed_at=CASE WHEN usage_observed_at IS NULL AND ($7 OR usage_recorded_at IS NOT NULL)
            THEN clock_timestamp() ELSE usage_observed_at END,
          observed_provider_request_id=CASE WHEN usage_observed_at IS NULL AND ($7 OR usage_recorded_at IS NOT NULL)
            THEN ${incoming.request} ELSE observed_provider_request_id END,
          observed_input_tokens=CASE WHEN usage_observed_at IS NULL AND ($7 OR usage_recorded_at IS NOT NULL)
            THEN ${incoming.input} ELSE observed_input_tokens END,
          observed_output_tokens=CASE WHEN usage_observed_at IS NULL AND ($7 OR usage_recorded_at IS NOT NULL)
            THEN ${incoming.output} ELSE observed_output_tokens END,
          observed_cached_input_tokens=CASE WHEN usage_observed_at IS NULL AND ($7 OR usage_recorded_at IS NOT NULL)
            THEN ${incoming.cached} ELSE observed_cached_input_tokens END,
          usage_recorded_at=NULL,provider_request_id=NULL,input_tokens=NULL,output_tokens=NULL,
          cached_input_tokens=NULL,output_object_id=NULL,output_sha256=NULL
         WHERE ${predicate} AND state IN ('reserved','dispatched','usage-recorded','released')
           AND (NOT $7 OR dispatched_at IS NOT NULL)
           AND (NOT $7 OR usage_recorded_at IS NULL OR
             (provider_request_id IS NOT DISTINCT FROM $8::varchar AND input_tokens=$9::bigint
              AND output_tokens=$10::bigint AND cached_input_tokens=$11::bigint))
           AND (usage_observed_at IS NULL OR (NOT $7 AND usage_recorded_at IS NULL) OR
             (observed_provider_request_id IS NOT DISTINCT FROM (${incoming.request})
              AND observed_input_tokens IS NOT DISTINCT FROM (${incoming.input})
              AND observed_output_tokens IS NOT DISTINCT FROM (${incoming.output})
              AND observed_cached_input_tokens IS NOT DISTINCT FROM (${incoming.cached})))`,
          [
            ...keys(identity),
            knownUsage !== undefined,
            knownUsage?.providerRequestId ?? null,
            knownUsage ? BigInt(knownUsage.inputTokens) : null,
            knownUsage ? BigInt(knownUsage.outputTokens) : null,
            knownUsage ? BigInt(knownUsage.cacheReadInputTokens) : null,
          ],
        ),
      );
      if (changed.rowCount !== 1)
        throw new BetaAiUsageConflict(
          "Release cleanup conflicts with retained usage.",
        );
      return status(await read(database, identity));
    } catch (error) {
      if (error instanceof BetaAiUsageConflict) throw error;
      try {
        const row = await read(database, identity);
        retained = row;
        if (row["state"] === "released") {
          if (knownUsage) {
            assertObserved(row, knownUsage);
            if (!matches(row, knownUsage)) continue;
          }
          return status(row);
        }
      } catch (reconciliationError) {
        if (reconciliationError instanceof BetaAiUsageConflict)
          throw reconciliationError;
      }
    }
  }
  return {
    cleanup: "pending",
    accounting:
      retained === undefined ? "unresolved" : status(retained).accounting,
  };
}
