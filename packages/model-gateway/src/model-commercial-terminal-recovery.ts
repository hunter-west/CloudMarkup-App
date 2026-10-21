import { z } from "zod";
import type {
  ModelCommercialOperationRequestV1,
  ModelCommercialTerminalOutcomeV1,
} from "./commercial-lifecycle.js";
import {
  canonicalModelTerminalMetadataSchema,
  assertCanonicalModelTerminalIntegrity,
} from "./model-commercial-terminal-integrity.js";
const verified = z.lazy(() =>
  canonicalModelTerminalMetadataSchema
    .extend({ authority: z.literal("canonical-model-terminal-v1") })
    .strict(),
);
export interface ModelCommercialTerminalRecoveryPortV1 {
  /** Exact existing work only. No reservation, provider call, content replay or
   * current-user authority can be manufactured from these identifiers. */
  recoverVerified(input: {
    readonly request: ModelCommercialOperationRequestV1;
    readonly requestDigest: string;
  }): Promise<
    { readonly kind: "unavailable" } | ModelCommercialVerifiedTerminalV1
  >;
}
export interface ModelCommercialVerifiedTerminalV1 {
  readonly kind: "verified";
  readonly authority: "canonical-model-terminal-v1";
  readonly requestDigest: string;
  readonly reservationId: string;
  readonly dispatchIntentId: string;
  readonly pricingAuthorityDigest: string;
  readonly outcome: ModelCommercialTerminalOutcomeV1 & {
    readonly kind: "settlement" | "release";
  };
}
/** Shape/integrity only. The injected host port remains the authority. */
export function parseModelCommercialVerifiedTerminalV1(
  value: unknown,
  request: ModelCommercialOperationRequestV1,
): ModelCommercialVerifiedTerminalV1 {
  const parsed = verified.parse(value);
  if (
    request.feature !== "intent.extract" ||
    request.requestedRoute !== "standard"
  )
    throw new TypeError("Canonical model terminal metadata is contradictory.");
  assertCanonicalModelTerminalIntegrity(parsed, request);
  return parsed;
}
