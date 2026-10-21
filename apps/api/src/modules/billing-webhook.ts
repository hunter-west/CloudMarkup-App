import type { Hono } from "hono";

import {
  BILLING_WEBHOOK_MAX_BODY_BYTES,
  BillingApplicationError,
  type BillingApplicationService,
} from "../application/billing.js";
import type { ApiEnvironment } from "../transport/http.js";

async function readBoundedRawBody(
  request: Request,
): Promise<Uint8Array | undefined> {
  if (request.body === null) return new Uint8Array();
  const reader =
    request.body.getReader() as ReadableStreamDefaultReader<unknown>;
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      const chunk = result.value;
      if (!(chunk instanceof Uint8Array)) {
        throw new TypeError("The webhook body stream is invalid.");
      }
      totalBytes += chunk.byteLength;
      if (totalBytes > BILLING_WEBHOOK_MAX_BODY_BYTES) {
        await reader.cancel();
        return undefined;
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }
  const rawBody = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    rawBody.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return rawBody;
}
function webhookResponse(
  status: number,
  payload: Readonly<Record<string, boolean | string>>,
  retry = false,
): Response {
  return new Response(JSON.stringify(payload), {
    headers: {
      "content-type": "application/json; charset=UTF-8",
      ...(retry ? { "retry-after": "5" } : {}),
    },
    status,
  });
}

export function registerBillingWebhookRoute(
  app: Hono<ApiEnvironment>,
  billing: BillingApplicationService | undefined,
): void {
  app.post("/webhooks/stripe", async (context) => {
    if (billing === undefined) {
      return webhookResponse(
        503,
        { received: false, status: "billing-disabled" },
        true,
      );
    }

    const contentLength = context.req.header("content-length");
    if (
      contentLength !== undefined &&
      /^\d+$/.test(contentLength) &&
      Number(contentLength) > BILLING_WEBHOOK_MAX_BODY_BYTES
    ) {
      return webhookResponse(413, {
        received: false,
        status: "invalid-event",
      });
    }

    let rawBody: Uint8Array | undefined;
    try {
      rawBody = await readBoundedRawBody(context.req.raw);
    } catch {
      return webhookResponse(400, {
        received: false,
        status: "invalid-event",
      });
    }
    if (rawBody === undefined) {
      return webhookResponse(413, {
        received: false,
        status: "invalid-event",
      });
    }

    try {
      const result = await billing.processWebhook({
        rawBody,
        signatureHeader: context.req.header("stripe-signature"),
      });
      return webhookResponse(200, {
        received: true,
        status: result.status,
      });
    } catch (error) {
      if (
        error instanceof BillingApplicationError &&
        (error.code === "invalid-provider-event" ||
          error.code === "idempotency-conflict")
      ) {
        return webhookResponse(400, {
          received: false,
          status: "invalid-event",
        });
      }
      return webhookResponse(
        503,
        { received: false, status: "retry-later" },
        true,
      );
    }
  });
}
