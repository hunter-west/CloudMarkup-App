import {
  digestStructuredValue as digest,
  type ModelCommercialVerifiedScopeV1,
} from "@cloudmarkup/model-gateway";
import {
  modelPlatformReservationReceiptSchema,
  type ModelPlatformReservationInput,
  type ModelPlatformReservationReceipt,
} from "../model-platform-spend.js";
import { accountingNumber } from "./model-commercial-accounting-codec.js";
import {
  requireSequenceAuthority as requireAuthority,
  sameSequenceMetadata as same,
} from "./model-live-sequence-authority-codec.js";
import { sql, type SqlExecutor } from "./sql.js";
const hex = (value: string) => value.slice(7);

/** Compare the actual immutable SQL reservation, never only caller receipt metadata. */
export async function requireActualRepairPlatformReservation(input: {
  readonly tx: SqlExecutor;
  readonly scope: ModelCommercialVerifiedScopeV1;
  readonly descriptorScope: ModelPlatformReservationInput["scope"];
  readonly claim: ModelPlatformReservationInput;
  readonly receipt: ModelPlatformReservationReceipt;
}): Promise<void> {
  const { tx, scope, descriptorScope, claim, receipt } = input;
  const platform = (
    await tx.query(
      sql(
        `SELECT *,to_char(reserved_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS receipt_reserved_at,to_char(dispatch_before AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS receipt_dispatch_before,
    pricing_valid_from=$2::timestamptz AS same_valid_from,pricing_valid_until=$3::timestamptz AS same_valid_until
    FROM model_platform_spend_reservations WHERE dispatch_id=$1 FOR SHARE`,
        [claim.dispatchId, claim.ceiling.validFrom, claim.ceiling.validUntil],
      ),
    )
  ).rows[0];
  requireAuthority(platform !== undefined);
  const actualReceipt = modelPlatformReservationReceiptSchema.parse({
    kind: "reserved",
    dispatchId: platform["dispatch_id"],
    claimDigest: "sha256:" + String(platform["claim_sha256"]),
    monthUtc: platform["month_utc"],
    reservedAt: platform["receipt_reserved_at"],
    dispatchBefore: platform["receipt_dispatch_before"],
  });
  requireAuthority(
    same(receipt, actualReceipt) &&
      receipt.claimDigest === digest(claim) &&
      same(claim.scope, descriptorScope) &&
      platform["organization_id"] === scope.organizationId &&
      platform["project_id"] === scope.projectId &&
      platform["principal_id"] === scope.userId &&
      platform["scope_sha256"] === hex(digest(claim.scope)) &&
      platform["invocation_id"] === claim.invocationId &&
      platform["invocation_sha256"] === hex(claim.ceiling.invocationDigest) &&
      platform["provider_id"] === claim.ceiling.providerId &&
      platform["model_id"] === claim.ceiling.modelId &&
      platform["model_version"] === claim.ceiling.modelVersion &&
      platform["inference_profile_id"] === claim.ceiling.inferenceProfileId &&
      platform["pricing_version_id"] === claim.ceiling.pricingVersionId &&
      platform["pricing_version_sha256"] ===
        hex(claim.ceiling.pricingVersionDigest) &&
      accountingNumber(platform["maximum_cost_micro_usd"]) ===
        claim.ceiling.maximumCostMicroUsd &&
      platform["same_valid_from"] === true &&
      platform["same_valid_until"] === true,
  );
}
