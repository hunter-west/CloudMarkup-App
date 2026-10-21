import { digestStructuredValue } from "@cloudmarkup/model-gateway";
import { modelInvocationDescriptorV1Schema } from "@cloudmarkup/schemas";

import {
  MODEL_PLATFORM_MONTHLY_CAP_MICRO_USD,
  ModelPlatformSpendError,
  modelPlatformReservationInputSchema,
  modelPlatformReservationReceiptSchema,
  type ModelPlatformReservationInput,
  type ModelPlatformSpendReservationPort,
} from "../model-platform-spend.js";
import { sql, type SqlDatabase } from "./sql.js";

/** One exact host-authorized scope; never instantiate from browser ownership.
 * The lock and aggregate intentionally span every organization and project.
 * No release/delete/settlement API: uncertain charges retain their full bound.
 */
export class PostgresModelPlatformSpendStore implements ModelPlatformSpendReservationPort {
  readonly #database: SqlDatabase;
  readonly #scope: ModelPlatformReservationInput["scope"];
  constructor(input: {
    readonly database: SqlDatabase;
    readonly scope: ModelPlatformReservationInput["scope"];
  }) {
    const scope = modelInvocationDescriptorV1Schema.shape.scope.safeParse(
      input.scope,
    );
    if (!scope.success) throw new ModelPlatformSpendError();
    this.#database = input.database;
    this.#scope = scope.data;
  }
  async reserve(
    value: ModelPlatformReservationInput,
  ): ReturnType<ModelPlatformSpendReservationPort["reserve"]> {
    const parsed = modelPlatformReservationInputSchema.safeParse(value);
    if (
      !parsed.success ||
      digestStructuredValue(parsed.data.scope) !==
        digestStructuredValue(this.#scope)
    )
      throw new ModelPlatformSpendError();
    const input = parsed.data;
    const claimDigest = digestStructuredValue(input);
    const hex = (digest: string): string => digest.slice("sha256:".length);
    try {
      return await this.#database.transaction(async (tx) => {
        await tx.query(
          sql(
            "SELECT pg_advisory_xact_lock(hashtextextended('cloudmarkup:model-platform-monthly-usd:v1',0))",
          ),
        );
        const existing = await tx.query(
          sql(
            "SELECT claim_sha256 FROM model_platform_spend_reservations WHERE dispatch_id=$1",
            [input.dispatchId],
          ),
        );
        if (existing.rowCount !== 0) {
          if (
            existing.rowCount !== 1 ||
            existing.rows[0]?.["claim_sha256"] !== hex(claimDigest)
          )
            throw new ModelPlatformSpendError();
          return { kind: "duplicate" as const };
        }
        // Read the database clock AFTER waiting on the global lock. A queued
        // end-of-month transaction may not spend against a stale caller month.
        const clock = await tx.query(
          sql(
            "WITH instant AS MATERIALIZED (SELECT clock_timestamp() AS at) SELECT to_char(at AT TIME ZONE 'UTC','YYYY-MM') AS month_utc,to_char(at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS trusted_now FROM instant",
          ),
        );
        const month = clock.rows[0]?.["month_utc"];
        const instant = clock.rows[0]?.["trusted_now"];
        if (
          clock.rowCount !== 1 ||
          typeof month !== "string" ||
          typeof instant !== "string" ||
          !/^\d{4}-(?:0[1-9]|1[0-2])$/u.test(month) ||
          !Number.isFinite(Date.parse(instant)) ||
          instant.slice(0, 7) !== month ||
          Date.parse(instant) < Date.parse(input.ceiling.validFrom) ||
          Date.parse(instant) >= Date.parse(input.ceiling.validUntil) ||
          (input.ceiling.dispatchValidUntil !== undefined &&
            Date.parse(instant) >= Date.parse(input.ceiling.dispatchValidUntil))
        )
          throw new ModelPlatformSpendError();
        const total = await tx.query(
          sql(
            "SELECT COALESCE(SUM(maximum_cost_micro_usd),0)::text AS reserved_micro_usd FROM model_platform_spend_reservations WHERE month_utc=$1",
            [month],
          ),
        );
        const rawTotal = total.rows[0]?.["reserved_micro_usd"];
        if (
          total.rowCount !== 1 ||
          typeof rawTotal !== "string" ||
          !/^\d{1,8}$/u.test(rawTotal)
        )
          throw new ModelPlatformSpendError();
        if (
          Number(rawTotal) + input.ceiling.maximumCostMicroUsd >
          MODEL_PLATFORM_MONTHLY_CAP_MICRO_USD
        )
          throw new ModelPlatformSpendError("cap-exceeded");
        const inserted = await tx.query(
          sql(
            `INSERT INTO model_platform_spend_reservations(dispatch_id,organization_id,project_id,principal_id,scope_sha256,invocation_id,claim_sha256,invocation_sha256,provider_id,model_id,model_version,inference_profile_id,pricing_version_id,pricing_version_sha256,maximum_cost_micro_usd,pricing_valid_from,pricing_valid_until)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::timestamptz,$17::timestamptz)
          RETURNING month_utc,to_char(reserved_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS reserved_at,to_char(dispatch_before AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS dispatch_before`,
            [
              input.dispatchId,
              input.scope.organizationId,
              input.scope.projectId ?? null,
              input.scope.userId,
              hex(digestStructuredValue(input.scope)),
              input.invocationId,
              hex(claimDigest),
              hex(input.ceiling.invocationDigest),
              input.ceiling.providerId,
              input.ceiling.modelId,
              input.ceiling.modelVersion,
              input.ceiling.inferenceProfileId,
              input.ceiling.pricingVersionId,
              hex(input.ceiling.pricingVersionDigest),
              input.ceiling.maximumCostMicroUsd,
              input.ceiling.validFrom,
              input.ceiling.validUntil,
            ],
          ),
        );
        const row = inserted.rows[0];
        const receipt = modelPlatformReservationReceiptSchema.safeParse({
          kind: "reserved",
          dispatchId: input.dispatchId,
          claimDigest,
          monthUtc: row?.["month_utc"],
          reservedAt: row?.["reserved_at"],
          dispatchBefore: row?.["dispatch_before"],
        });
        if (inserted.rowCount !== 1 || !receipt.success)
          throw new ModelPlatformSpendError();
        return receipt.data;
      });
    } catch (error) {
      if (error instanceof ModelPlatformSpendError) throw error;
      throw new ModelPlatformSpendError();
    }
  }
}
