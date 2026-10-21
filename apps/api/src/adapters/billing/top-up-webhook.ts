import type {
  CreditTopUpProvider,
  CreditTopUpWebhookProcessor,
} from "../../application/billing-top-ups.js";
import { BillingApplicationError } from "../../application/billing-errors.js";
import type { PostgresCreditTopUpPersistence } from "../persistence/credit-top-up-persistence.js";

/** Composed only behind signature verification and authenticated event retrieval.
 * Event metadata locates retained evidence; a fresh provider read grants authority. */
export function createCreditTopUpWebhookProcessor(input: {
  readonly provider: Pick<CreditTopUpProvider, "getCreditTopUpSession">;
  readonly persistence: Pick<
    PostgresCreditTopUpPersistence,
    "findForProvider" | "observeVerifiedPayment"
  >;
}): CreditTopUpWebhookProcessor {
  return async (event) => {
    if (!event.supported) return null;
    const data = event.providerEventData;
    if (data === null || typeof data !== "object" || Array.isArray(data))
      return null;
    const object = data as Readonly<Record<string, unknown>>;
    let attemptId: string | undefined,
      paymentReference: string | undefined,
      sessionReference: string | undefined;
    if (
      [
        "checkout.session.completed",
        "checkout.session.async_payment_succeeded",
        "checkout.session.async_payment_failed",
        "checkout.session.expired",
      ].includes(event.eventType)
    ) {
      if (
        object["object"] !== "checkout.session" ||
        object["mode"] !== "payment" ||
        typeof object["id"] !== "string"
      )
        return null;
      sessionReference = object["id"];
      const metadata = object["metadata"];
      if (
        metadata === null ||
        typeof metadata !== "object" ||
        Array.isArray(metadata)
      )
        return null;
      const value = (metadata as Readonly<Record<string, unknown>>)[
        "cloudmarkup_top_up_attempt"
      ];
      if (typeof value !== "string") return null;
      attemptId = value;
    } else if (
      event.eventType === "charge.refunded" ||
      event.eventType === "charge.dispute.created" ||
      event.eventType === "charge.dispute.closed"
    ) {
      if (
        object["object"] !==
          (event.eventType === "charge.refunded" ? "charge" : "dispute") ||
        typeof object["payment_intent"] !== "string"
      )
        return null;
      paymentReference = object["payment_intent"];
    } else return null;
    const selector =
      attemptId !== undefined
        ? { attemptId }
        : paymentReference !== undefined
          ? { providerPaymentReference: paymentReference }
          : null;
    if (selector === null) return null;
    const attempt = await input.persistence.findForProvider(selector);
    if (attempt === null) return null;
    const reference = sessionReference ?? attempt.providerSessionReference;
    if (
      reference === null ||
      (attempt.providerSessionReference !== null &&
        attempt.providerSessionReference !== reference)
    ) {
      throw new BillingApplicationError(
        "invalid-provider-event",
        "The credit purchase event does not match its recorded session.",
      );
    }
    const checked = await input.provider.getCreditTopUpSession({
      purchase: attempt,
      providerSessionReference: reference,
    });
    const status = await input.persistence.observeVerifiedPayment(
      attempt,
      checked,
    );
    return {
      organizationId: attempt.organizationId,
      billingAccountId: attempt.billingAccountId,
      status,
    };
  };
}
