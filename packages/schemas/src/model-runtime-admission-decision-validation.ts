import type { z } from "zod";
import { digestCanonicalValue } from "./canonical-digest.js";

interface RuntimeDecisionValidationInput {
  readonly outcome: "allowed" | "denied";
  readonly invokeModel: boolean;
  readonly authorization: {
    readonly commercialReservationDecisionId?: string | undefined;
    readonly concurrencyLeaseId?: string | undefined;
    readonly entitlementDecisionId?: string | undefined;
  };
  readonly expiresAt?: string | undefined;
  readonly decidedAt: string;
  readonly denialReasons: readonly string[];
  readonly safeError?: { readonly code: string } | undefined;
  readonly decisionDigest: string;
}

/** Shared V1/V2 outcome invariants. Parsing and a digest never issue authority. */
export function refineModelRuntimeAdmissionDecision(
  value: RuntimeDecisionValidationInput,
  context: z.RefinementCtx,
) {
  const allowed = value.outcome === "allowed";
  const hasAllAuthorizations =
    value.authorization.commercialReservationDecisionId !== undefined &&
    value.authorization.concurrencyLeaseId !== undefined &&
    value.authorization.entitlementDecisionId !== undefined;
  if (
    allowed !== value.invokeModel ||
    allowed !== hasAllAuthorizations ||
    allowed !== (value.expiresAt !== undefined) ||
    allowed !== (value.denialReasons.length === 0) ||
    allowed !== (value.safeError === undefined)
  ) {
    context.addIssue({
      code: "custom",
      message:
        "Only an allowed decision may invoke a model and it requires every exact authorization; denial must expose only safe reason data.",
      path: ["outcome"],
    });
  }
  if (!allowed) {
    if (
      value.denialReasons.length === 0 ||
      value.safeError === undefined ||
      !value.denialReasons.includes(value.safeError.code)
    ) {
      context.addIssue({
        code: "custom",
        message: "A denial requires a matching bounded safe error code.",
        path: ["safeError"],
      });
    }
  }
  if (new Set(value.denialReasons).size !== value.denialReasons.length) {
    context.addIssue({
      code: "custom",
      message: "Denial reasons must be unique.",
      path: ["denialReasons"],
    });
  }
  if (
    value.expiresAt !== undefined &&
    Date.parse(value.expiresAt) <= Date.parse(value.decidedAt)
  ) {
    context.addIssue({
      code: "custom",
      message: "Allowed admission authority must expire after its decision.",
      path: ["expiresAt"],
    });
  }
  const { decisionDigest, ...metadata } = value;
  if (decisionDigest !== digestCanonicalValue(metadata)) {
    context.addIssue({
      code: "custom",
      message:
        "Admission decision digest must bind its exact authority and safe result.",
      path: ["decisionDigest"],
    });
  }
}
