import { timingSafeEqual } from "node:crypto";

import { handle } from "hono/aws-lambda";

import { API_SECURITY_HEADERS } from "./transport/http.js";

const EDGE_ORIGIN_HEADER = "x-cloudmarkup-edge-origin";
const EDGE_ORIGIN_VALUE_PATTERN = /^[A-Za-z0-9._~-]{32,128}$/u;
export type AppLambdaHandler = ReturnType<typeof handle>;
type AppLambdaEvent = Parameters<AppLambdaHandler>[0];
type AppLambdaContext = Parameters<AppLambdaHandler>[1];

function secureEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

export function hasVerifiedEdgeOrigin(event: {
  readonly headers?: unknown;
}): boolean {
  const environment = process.env["CLOUDMARKUP_ENVIRONMENT"];
  const protectedRuntime =
    process.env["CLOUDMARKUP_DEPLOYMENT_SHELL"] === "true" ||
    environment === "beta" ||
    environment === "staging" ||
    environment === "prod";
  const expected = process.env["CLOUDMARKUP_EDGE_ORIGIN_VERIFICATION"];
  if (!protectedRuntime && expected === undefined) return true;
  if (expected === undefined || !EDGE_ORIGIN_VALUE_PATTERN.test(expected)) {
    return false;
  }
  const headers: unknown = event.headers;
  if (headers === null || typeof headers !== "object") return false;
  const headerMap = headers as Readonly<Record<string, unknown>>;
  const suppliedName = Object.keys(headerMap).find(
    (name) => name.toLowerCase() === EDGE_ORIGIN_HEADER,
  );
  const supplied =
    suppliedName === undefined ? undefined : headerMap[suppliedName];
  return (
    typeof supplied === "string" &&
    EDGE_ORIGIN_VALUE_PATTERN.test(supplied) &&
    secureEqual(supplied, expected)
  );
}

export function createEdgeProtectedLambdaHandler(
  applicationHandler: () => AppLambdaHandler,
) {
  return async (event: AppLambdaEvent, context: AppLambdaContext) => {
    if (!hasVerifiedEdgeOrigin(event)) {
      console.log(
        JSON.stringify({
          component: "api",
          event: "security.origin.denied",
          outcome: "origin-verification-failure",
        }),
      );

      return {
        body: JSON.stringify({ status: "origin-unavailable" }),
        headers: API_SECURITY_HEADERS,
        statusCode: 403,
      };
    }
    return applicationHandler()(event, context);
  };
}
