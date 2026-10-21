import type { GitHubWebhookService } from "@cloudmarkup/github-repository-export/webhook";
import type { Context } from "aws-lambda";
import { Hono } from "hono";
import { handle } from "hono/aws-lambda";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { handler } from "./lambda.js";
import { registerGitHubWebhookRoute } from "./modules/github-webhook.js";
import type { ApiEnvironment } from "./transport/http.js";
import {
  createCorrelationMiddleware,
  createPrincipalMiddleware,
} from "./transport/http.js";

const event = {
  version: "2.0",
  routeKey: "GET /health",
  rawPath: "/health",
  rawQueryString: "",
  body: "",
  headers: {},
  requestContext: {
    accountId: "000000000000",
    apiId: "local-test",
    authentication: null,
    authorizer: {},
    domainName: "local.test",
    domainPrefix: "local",
    http: {
      method: "GET",
      path: "/health",
      protocol: "HTTP/1.1",
      sourceIp: "127.0.0.1",
      userAgent: "vitest",
    },
    requestId: "request-id",
    routeKey: "GET /health",
    stage: "$default",
    time: "23/Jul/2026:00:00:00 +0000",
    timeEpoch: 0,
  },
  isBase64Encoded: false,
};

const readinessEvent = {
  ...event,
  rawPath: "/ready",
  requestContext: {
    ...event.requestContext,
    http: { ...event.requestContext.http, path: "/ready" },
    routeKey: "GET /ready",
  },
  routeKey: "GET /ready",
};

const restHealthEvent = {
  body: null,
  headers: {},
  httpMethod: "GET",
  isBase64Encoded: false,
  path: "/health",
  requestContext: {},
  resource: "/health",
} as unknown as Parameters<typeof handler>[0];

const context: Context = {
  callbackWaitsForEmptyEventLoop: false,
  functionName: "cloudmarkup-api",
  functionVersion: "$LATEST",
  invokedFunctionArn:
    "arn:aws:lambda:us-east-1:000000000000:function:cloudmarkup-api",
  memoryLimitInMB: "128",
  awsRequestId: "request-id",
  logGroupName: "/aws/lambda/cloudmarkup-api",
  logStreamName: "local-test",
  getRemainingTimeInMillis: () => 1_000,
  done: () => undefined,
  fail: () => undefined,
  succeed: () => undefined,
};

describe("Lambda entry point", () => {
  beforeEach(() => {
    vi.stubEnv("CLOUDMARKUP_ENVIRONMENT", undefined);
    vi.stubEnv("CLOUDMARKUP_DEPLOYMENT_SHELL", undefined);
    vi.stubEnv("CLOUDMARKUP_EDGE_ORIGIN_VERIFICATION", undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("adapts an API Gateway payload-v2 health request", async () => {
    const response = await handler(event, context);

    expect(response).toMatchObject({
      body: JSON.stringify({
        contractVersion: 1,
        service: "cloudmarkup-api",
        status: "ok",
      }),
      statusCode: 200,
    });
  });

  it("adapts a Regional REST API payload-v1 health request", async () => {
    const response = await handler(restHealthEvent, context);

    expect(response).toMatchObject({
      body: JSON.stringify({
        contractVersion: 1,
        service: "cloudmarkup-api",
        status: "ok",
      }),
      statusCode: 200,
    });
  });

  it("forwards a REST payload-v1 bearer token and never trusts gateway claim shapes", async () => {
    const resolve = vi.fn((authorization: string | undefined) =>
      Promise.resolve(
        authorization === "Bearer rest-access-token"
          ? {
              authenticatedAt: "2026-08-31T00:00:00.000Z",
              authenticationSource: "test" as const,
              expiresAt: "2099-01-01T00:00:00.000Z",
              principalId: "principal-from-verified-token",
              sessionId: "session-from-verified-token",
            }
          : null,
      ),
    );
    const authenticated = new Hono<ApiEnvironment>();
    authenticated.use(
      "*",
      createCorrelationMiddleware(() => "rest-auth-correlation"),
    );
    authenticated.use("/v1/*", createPrincipalMiddleware({ resolve }));
    authenticated.get("/v1/probe", (request) =>
      request.json({ principalId: request.get("principal").principalId }),
    );
    const restHandler = handle(authenticated);
    const response = await restHandler(
      {
        ...restHealthEvent,
        headers: { authorization: "Bearer rest-access-token" },
        httpMethod: "GET",
        path: "/v1/probe",
        requestContext: {
          ...restHealthEvent.requestContext,
          authorizer: {
            claims: { sub: "must-not-be-trusted" },
            jwt: { claims: { sub: "also-must-not-be-trusted" } },
          },
        },
        resource: "/v1/{proxy+}",
      } as unknown as Parameters<typeof restHandler>[0],
      context,
    );

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      principalId: "principal-from-verified-token",
    });
    expect(resolve).toHaveBeenCalledWith("Bearer rest-access-token");
  });

  it("preserves exact REST payload-v1 bytes for the GitHub signature boundary", async () => {
    const raw = Buffer.from(
      '{\r\n  "action": "opened",\r\n  "spacing": "preserved"\r\n}\r\n',
      "utf8",
    );
    const handleWebhook = vi.fn((input: { readonly body: Uint8Array }) => {
      expect([...input.body]).toEqual([...raw]);
      return Promise.resolve({
        deliveryId: "delivery-rest-v1",
        status: "processed" as const,
      });
    });
    const webhookApp = new Hono<ApiEnvironment>();
    registerGitHubWebhookRoute(webhookApp, {
      handle: handleWebhook,
    } as unknown as GitHubWebhookService);
    const restHandler = handle(webhookApp);
    const response = await restHandler(
      {
        ...restHealthEvent,
        body: raw.toString("utf8"),
        headers: {
          "content-type": "application/json",
          "x-github-delivery": "delivery-rest-v1",
          "x-github-event": "pull_request",
          "x-hub-signature-256": `sha256=${"a".repeat(64)}`,
        },
        httpMethod: "POST",
        isBase64Encoded: false,
        path: "/webhooks/github",
        resource: "/webhooks/github",
      } as unknown as Parameters<typeof restHandler>[0],
      context,
    );

    expect(response.statusCode).toBe(200);
    expect(handleWebhook).toHaveBeenCalledTimes(1);
  });

  it("reports the default unavailable application composition as not ready", async () => {
    const response = await handler(readinessEvent, context);

    expect(response).toMatchObject({ statusCode: 503 });
    expect(JSON.parse(response.body)).toMatchObject({
      checks: [{ name: "application-composition", status: "not-ready" }],
      status: "not-ready",
    });
  });

  it("fails closed when the deployed API is called without the edge-origin marker", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.stubEnv("CLOUDMARKUP_DEPLOYMENT_SHELL", "true");
    vi.stubEnv(
      "CLOUDMARKUP_EDGE_ORIGIN_VERIFICATION",
      "cloudmarkup-test-edge-origin-marker-0001",
    );

    const response = await handler(event, context);

    expect(response).toMatchObject({
      body: JSON.stringify({ status: "origin-unavailable" }),
      statusCode: 403,
    });
    expect(response.headers).toMatchObject({
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    });
    expect(log).toHaveBeenCalledWith(
      JSON.stringify({
        component: "api",
        event: "security.origin.denied",
        outcome: "origin-verification-failure",
      }),
    );
  });

  it("fails closed on an invalid deployed origin-marker configuration", async () => {
    const invalidMarker = " ".repeat(32);
    vi.stubEnv("CLOUDMARKUP_DEPLOYMENT_SHELL", "true");
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.stubEnv("CLOUDMARKUP_EDGE_ORIGIN_VERIFICATION", invalidMarker);

    const response = await handler(
      { ...event, headers: { "x-cloudmarkup-edge-origin": invalidMarker } },
      context,
    );

    expect(response).toMatchObject({ statusCode: 403 });
    expect(JSON.stringify(log.mock.calls)).not.toContain(invalidMarker);
  });

  it("accepts the exact deployment-bound edge-origin marker", async () => {
    const marker = "cloudmarkup-test-edge-origin-marker-0001";
    vi.stubEnv("CLOUDMARKUP_DEPLOYMENT_SHELL", "true");
    vi.stubEnv("CLOUDMARKUP_EDGE_ORIGIN_VERIFICATION", marker);

    const response = await handler(
      { ...event, headers: { "x-cloudmarkup-edge-origin": marker } },
      context,
    );

    expect(response).toMatchObject({ statusCode: 200 });
  });

  it("continues enforcing the edge marker after the deployment shell is replaced", async () => {
    vi.stubEnv("CLOUDMARKUP_DEPLOYMENT_SHELL", "false");
    vi.stubEnv("CLOUDMARKUP_ENVIRONMENT", "beta");
    vi.stubEnv(
      "CLOUDMARKUP_EDGE_ORIGIN_VERIFICATION",
      "cloudmarkup-test-edge-origin-marker-0001",
    );

    const response = await handler(event, context);

    expect(response).toMatchObject({ statusCode: 403 });
  });
});
