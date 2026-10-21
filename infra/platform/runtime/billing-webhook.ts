import { createHmac, timingSafeEqual } from "node:crypto";

import {
  parseStripeBillingWebhookDelivery,
  type BillingWebhookDelivery,
} from "@cloudmarkup/api/billing";

import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import type {
  APIGatewayProxyEvent,
  APIGatewayProxyEventV2,
  APIGatewayProxyResult,
} from "aws-lambda";

import {
  EDGE_ORIGIN_HEADER_NAME,
  EDGE_ORIGIN_VERIFICATION_ALLOWED_PATTERN,
  EDGE_ORIGIN_VERIFICATION_ENVIRONMENT_VARIABLE,
} from "../lib/edge-origin-contract.js";

const MAX_BODY_BYTES = 256 * 1024;
const SIGNATURE_TOLERANCE_SECONDS = 300;
const signingSecretPattern = /^whsec_[A-Za-z0-9_]+$/u;
const edgeOriginVerificationPattern = new RegExp(
  EDGE_ORIGIN_VERIFICATION_ALLOWED_PATTERN,
  "u",
);

type SecretVersion = "current" | "previous";
type BillingWebhookEvent = Pick<
  APIGatewayProxyEvent | APIGatewayProxyEventV2,
  "body" | "headers" | "isBase64Encoded"
>;

export type BillingWebhookQueueMessage = BillingWebhookDelivery;

export interface BillingWebhookRuntimeDependencies {
  readonly enqueue: (message: BillingWebhookQueueMessage) => Promise<void>;
  readonly loadSigningSecrets: () => Promise<
    readonly Readonly<{
      readonly secret: string;
      readonly version: SecretVersion;
    }>[]
  >;
  readonly log: (event: Readonly<Record<string, unknown>>) => void;
  readonly now: () => Date;
}

function response(statusCode: number, status: string): APIGatewayProxyResult {
  return {
    body: JSON.stringify({
      received: statusCode === 202 || statusCode === 200,
      status,
    }),
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
    },
    statusCode,
  };
}

function signatureHeader(value: string | undefined): Readonly<{
  readonly signatures: readonly Buffer[];
  readonly timestamp: number;
}> | null {
  if (value === undefined || value.length > 4_096) return null;
  let timestamp: number | undefined;
  const signatures: Buffer[] = [];
  for (const item of value.split(",")) {
    const separator = item.indexOf("=");
    if (separator < 1) return null;
    const key = item.slice(0, separator);
    const rawValue = item.slice(separator + 1);
    if (key === "t") {
      if (timestamp !== undefined || !/^[0-9]{1,16}$/u.test(rawValue)) {
        return null;
      }
      timestamp = Number(rawValue);
    } else if (key === "v1" && /^[0-9a-f]{64}$/u.test(rawValue)) {
      signatures.push(Buffer.from(rawValue, "hex"));
    }
  }
  return timestamp === undefined || signatures.length === 0
    ? null
    : { signatures, timestamp };
}

function secureEqual(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}

function hasExpectedEdgeOrigin(event: BillingWebhookEvent): boolean {
  const expected = process.env[EDGE_ORIGIN_VERIFICATION_ENVIRONMENT_VARIABLE];
  const headers: unknown = event.headers;
  if (headers === null || typeof headers !== "object") return false;
  const headerMap = headers as Readonly<Record<string, unknown>>;
  const receivedName = Object.keys(headerMap).find(
    (name) => name.toLowerCase() === EDGE_ORIGIN_HEADER_NAME,
  );
  const received =
    receivedName === undefined ? undefined : headerMap[receivedName];
  if (
    expected === undefined ||
    typeof received !== "string" ||
    !edgeOriginVerificationPattern.test(expected) ||
    !edgeOriginVerificationPattern.test(received)
  ) {
    return false;
  }
  return secureEqual(
    Buffer.from(received, "utf8"),
    Buffer.from(expected, "utf8"),
  );
}

function rawBody(event: BillingWebhookEvent): Uint8Array | null {
  if (typeof event.body !== "string") return null;
  let body: Buffer;
  try {
    body = Buffer.from(event.body, event.isBase64Encoded ? "base64" : "utf8");
  } catch {
    return null;
  }
  return body.byteLength <= MAX_BODY_BYTES ? body : null;
}

export function createBillingWebhookHandler(
  dependencies: BillingWebhookRuntimeDependencies,
): (event: BillingWebhookEvent) => Promise<APIGatewayProxyResult> {
  return async (event) => {
    const bytes = rawBody(event);
    const signature = signatureHeader(
      event.headers["stripe-signature"] ?? event.headers["Stripe-Signature"],
    );
    if (bytes === null || signature === null) {
      dependencies.log({
        component: "billing-webhook",
        outcome: "signature-failure",
        reasonCode: "missing-header-or-body",
      });
      return response(400, "invalid-signature");
    }
    const nowSeconds = Math.floor(dependencies.now().getTime() / 1_000);
    if (
      !Number.isFinite(nowSeconds) ||
      Math.abs(nowSeconds - signature.timestamp) > SIGNATURE_TOLERANCE_SECONDS
    ) {
      dependencies.log({
        component: "billing-webhook",
        outcome: "signature-failure",
        reasonCode: "stale-timestamp",
      });
      return response(400, "invalid-signature");
    }
    const signedPayload = Buffer.concat([
      Buffer.from(signature.timestamp.toString() + ".", "utf8"),
      Buffer.from(bytes),
    ]);
    let signatureSecretVersion: SecretVersion | undefined;
    try {
      const secrets = await dependencies.loadSigningSecrets();
      signatureSecretVersion = secrets.find(({ secret }) => {
        if (!signingSecretPattern.test(secret)) return false;
        const expected = createHmac("sha256", secret)
          .update(signedPayload)
          .digest();
        return signature.signatures.some((candidate) =>
          secureEqual(candidate, expected),
        );
      })?.version;
    } catch {
      dependencies.log({
        component: "billing-webhook",
        outcome: "secret-load-failure",
      });
      return response(503, "billing-unavailable");
    }
    if (signatureSecretVersion === undefined) {
      dependencies.log({
        component: "billing-webhook",
        outcome: "signature-failure",
        reasonCode: "signature-mismatch",
      });
      return response(400, "invalid-signature");
    }
    let message: BillingWebhookQueueMessage | null;
    try {
      message = parseStripeBillingWebhookDelivery({
        planMappingVersion:
          process.env["CLOUDMARKUP_BILLING_PLAN_MAPPING_VERSION"] ??
          "unconfigured",
        stripeEnvironment:
          process.env["CLOUDMARKUP_STRIPE_ENVIRONMENT"] === "live"
            ? "live"
            : "test",
        rawBody: bytes,
        signatureSecretVersion,
        webhookEndpointVersion:
          process.env["CLOUDMARKUP_BILLING_WEBHOOK_ENDPOINT_VERSION"] ??
          "unconfigured",
      });
    } catch {
      dependencies.log({
        component: "billing-webhook",
        outcome: "invalid-event",
      });
      return response(400, "invalid-event");
    }
    if (message === null) return response(200, "ignored-unsupported-event");
    try {
      await dependencies.enqueue(message);
    } catch {
      dependencies.log({
        component: "billing-webhook",
        outcome: "processing-failure",
      });
      return response(503, "billing-unavailable");
    }
    dependencies.log({
      component: "billing-webhook",
      outcome: "accepted",
      providerEventReference: message.providerEventReference,
      signatureSecretVersion,
    });
    return response(202, "accepted");
  };
}

const secrets = new SecretsManagerClient({});
const sqs = new SQSClient({});

async function loadSecret(reference: string): Promise<string> {
  const result = await secrets.send(
    new GetSecretValueCommand({
      SecretId: reference,
      VersionStage: "AWSCURRENT",
    }),
  );
  if (typeof result.SecretString !== "string") {
    throw new TypeError("The signing secret is unavailable.");
  }
  return result.SecretString;
}

const deployedHandler = createBillingWebhookHandler({
  enqueue: async (message) => {
    const queueUrl = process.env["CLOUDMARKUP_BILLING_WEBHOOK_QUEUE_URL"];
    if (queueUrl === undefined) {
      throw new TypeError("The billing queue is unavailable.");
    }
    await sqs.send(
      new SendMessageCommand({
        MessageBody: JSON.stringify(message),
        MessageDeduplicationId: message.providerEventReference,
        MessageGroupId: message.objectReference,
        QueueUrl: queueUrl,
      }),
    );
  },
  loadSigningSecrets: async () => {
    if (
      process.env["CLOUDMARKUP_BILLING_ENABLED"] !== "true" ||
      (process.env["CLOUDMARKUP_STRIPE_ENVIRONMENT"] !== "test" &&
        process.env["CLOUDMARKUP_STRIPE_ENVIRONMENT"] !== "live")
    ) {
      throw new TypeError("Billing is disabled.");
    }
    const current = process.env["CLOUDMARKUP_STRIPE_WEBHOOK_SECRET_REFERENCE"];
    if (current === undefined) {
      throw new TypeError("The signing secret is unavailable.");
    }
    const previous =
      process.env["CLOUDMARKUP_STRIPE_PREVIOUS_WEBHOOK_SECRET_REFERENCE"];
    return Object.freeze([
      Object.freeze({
        secret: await loadSecret(current),
        version: "current" as const,
      }),
      ...(previous === undefined
        ? []
        : [
            Object.freeze({
              secret: await loadSecret(previous),
              version: "previous" as const,
            }),
          ]),
    ]);
  },
  log: (event) => {
    console.log(JSON.stringify(event));
  },
  now: () => new Date(),
});

export async function handler(
  event: BillingWebhookEvent,
): Promise<APIGatewayProxyResult> {
  if (process.env["CLOUDMARKUP_BILLING_ENABLED"] !== "true") {
    return response(503, "billing-disabled");
  }
  if (!hasExpectedEdgeOrigin(event)) {
    console.log(
      JSON.stringify({
        component: "billing-webhook",
        event: "security.origin.denied",
        outcome: "origin-verification-failure",
      }),
    );
    return response(403, "origin-verification-failed");
  }

  return deployedHandler(event);
}
