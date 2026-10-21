import {
  API_CONTRACT_VERSION,
  MAX_JSON_REQUEST_BYTES,
  apiErrorEnvelopeV1Schema,
  type FieldIssue,
} from "@cloudmarkup/api-contract";
import type { Context, MiddlewareHandler } from "hono";

import { ApplicationError } from "../application/errors.js";
import type {
  PageOptions,
  PrincipalContext,
  PrincipalResolver,
} from "../application/ports.js";

const MAX_REQUEST_URL_LENGTH = 8_192;
const MAX_HEADER_COUNT = 100;
const MAX_HEADER_VALUE_BYTES = 8_192;

export const API_SECURITY_HEADERS = Object.freeze({
  "cache-control": "no-store",
  "content-security-policy":
    "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'",
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
  "permissions-policy":
    "camera=(), display-capture=(), geolocation=(), microphone=(), payment=(), publickey-credentials-get=(), usb=()",
  "referrer-policy": "no-referrer",
  "strict-transport-security": "max-age=63072000; includeSubDomains; preload",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
} as const);

export interface ApiEnvironment {
  readonly Variables: {
    readonly correlationId: string;
    readonly principal: PrincipalContext;
  };
}

export type ApiContext = Context<ApiEnvironment>;

interface SchemaFailure {
  readonly error: {
    readonly issues: readonly {
      readonly code: string;
      readonly message: string;
      readonly path: readonly PropertyKey[];
    }[];
  };
  readonly success: false;
}

interface SchemaSuccess<TValue> {
  readonly data: TValue;
  readonly success: true;
}

export interface RuntimeSchema<TValue> {
  safeParse(input: unknown): SchemaFailure | SchemaSuccess<TValue>;
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function fieldIssues(
  issues: SchemaFailure["error"]["issues"],
): readonly FieldIssue[] {
  return issues.slice(0, 100).map((issue) => ({
    code: "request.invalid-field",
    message: "The supplied value is invalid.",
    path: issue.path.map((part) =>
      typeof part === "number" ? part : String(part),
    ),
  }));
}

function parseSchema<TValue>(
  schema: RuntimeSchema<TValue>,
  input: unknown,
): TValue {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ApplicationError("invalid_request", "The request is invalid.", {
      fieldIssues: fieldIssues(result.error.issues),
    });
  }

  return result.data;
}

export function createCorrelationMiddleware(
  factory: () => string,
): MiddlewareHandler<ApiEnvironment> {
  return async (context, next) => {
    context.set("correlationId", factory());
    await next();
  };
}

export function securityHeadersMiddleware(): MiddlewareHandler<ApiEnvironment> {
  return async (context, next) => {
    await next();
    for (const [name, value] of Object.entries(API_SECURITY_HEADERS)) {
      if (
        name === "cache-control" &&
        context.res.headers
          .get(name)
          ?.split(",")
          .some((directive) => directive.trim().toLowerCase() === "no-store")
      ) {
        continue;
      }
      // Binary downloads use the stricter sandbox directive. Preserve that
      // explicit response contract while overriding any weaker route CSP.
      if (
        name === "content-security-policy" &&
        context.res.headers.get(name) === "sandbox"
      ) {
        continue;
      }

      context.header(name, value);
    }
  };
}

export function requestLimitsMiddleware(): MiddlewareHandler<ApiEnvironment> {
  return async (context, next) => {
    if (context.req.url.length > MAX_REQUEST_URL_LENGTH) {
      throw new ApplicationError(
        "payload_too_large",
        "The request target is too large.",
      );
    }

    let headerCount = 0;
    for (const [, value] of context.req.raw.headers) {
      headerCount += 1;
      if (byteLength(value) > MAX_HEADER_VALUE_BYTES) {
        throw new ApplicationError(
          "payload_too_large",
          "A request header is too large.",
        );
      }
    }

    if (headerCount > MAX_HEADER_COUNT) {
      throw new ApplicationError(
        "payload_too_large",
        "The request has too many headers.",
      );
    }

    const contentLength = context.req.header("content-length");
    if (contentLength !== undefined) {
      if (!/^\d+$/.test(contentLength)) {
        throw new ApplicationError(
          "invalid_request",
          "The Content-Length header is invalid.",
        );
      }

      if (Number(contentLength) > MAX_JSON_REQUEST_BYTES) {
        throw new ApplicationError(
          "payload_too_large",
          "The request body is too large.",
        );
      }
    }

    await next();
  };
}

export function createPrincipalMiddleware(
  resolver: PrincipalResolver,
  clock: () => Date = () => new Date(),
): MiddlewareHandler<ApiEnvironment> {
  return async (context, next) => {
    const principal = await resolver.resolve(
      context.req.header("authorization"),
    );
    const expiresAt =
      principal === null ? Number.NaN : Date.parse(principal.expiresAt);
    if (
      principal === null ||
      !Number.isFinite(expiresAt) ||
      expiresAt <= clock().getTime()
    ) {
      throw new ApplicationError(
        "authentication_required",
        "Authentication is required.",
      );
    }

    context.set("principal", {
      ...principal,
      correlationId: context.get("correlationId"),
    });
    await next();
  };
}

export function parsePath<TValue>(
  context: ApiContext,
  schema: RuntimeSchema<TValue>,
): TValue {
  return parseSchema(schema, context.req.param());
}

export function parseQuery<TValue>(
  context: ApiContext,
  schema: RuntimeSchema<TValue>,
): TValue {
  const parameters = new URL(context.req.url).searchParams;
  for (const key of new Set(parameters.keys())) {
    if (parameters.getAll(key).length > 1) {
      throw new ApplicationError("invalid_request", "The request is invalid.", {
        fieldIssues: [
          {
            code: "request.duplicate-query-parameter",
            message: "A query parameter may be supplied only once.",
            path: ["query", key],
          },
        ],
      });
    }
  }

  return parseSchema(schema, Object.fromEntries(parameters));
}

export function parseHeaders<TValue>(
  context: ApiContext,
  schema: RuntimeSchema<TValue>,
  names: readonly string[],
): TValue {
  const input = Object.fromEntries(
    names.map((name) => [name, context.req.header(name)]),
  );

  if (
    names.includes("idempotency-key") &&
    input["idempotency-key"] === undefined
  ) {
    throw new ApplicationError(
      "idempotency_key_required",
      "An Idempotency-Key header is required.",
    );
  }

  if (names.includes("if-match") && input["if-match"] === undefined) {
    throw new ApplicationError(
      "precondition_required",
      "An If-Match header is required.",
    );
  }

  return parseSchema(schema, input);
}

export async function parseJsonBody<TValue>(
  context: ApiContext,
  schema: RuntimeSchema<TValue>,
): Promise<TValue> {
  const contentType = context.req.header("content-type");
  if (
    contentType?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json"
  ) {
    throw new ApplicationError(
      "invalid_request",
      "The request body must use application/json.",
    );
  }

  const text = await context.req.raw.text();
  if (byteLength(text) > MAX_JSON_REQUEST_BYTES) {
    throw new ApplicationError(
      "payload_too_large",
      "The request body is too large.",
    );
  }

  let input: unknown;
  try {
    input = JSON.parse(text) as unknown;
  } catch {
    throw new ApplicationError(
      "invalid_request",
      "The request body is not valid JSON.",
    );
  }

  return parseSchema(schema, input);
}

export function pageOptions(
  query: Readonly<Record<string, unknown>>,
): PageOptions {
  const cursor = query["page[cursor]"];
  const limit = query["page[limit]"];
  const sort = query["sort"];
  const filters = Object.fromEntries(
    Object.entries(query)
      .filter(
        (entry): entry is [string, string] =>
          entry[0].startsWith("filter[") && typeof entry[1] === "string",
      )
      .map(([key, value]) => [key.slice(7, -1), value]),
  );

  return {
    ...(typeof cursor === "string" ? { cursor } : {}),
    filters,
    limit: typeof limit === "string" ? Number(limit) : 25,
    ...(typeof sort === "string" ? { sort } : {}),
  };
}

export function dataEnvelope<TValue>(value: TValue) {
  return { apiVersion: API_CONTRACT_VERSION, data: value } as const;
}

export function listEnvelope<TValue>(
  items: readonly TValue[],
  nextCursor: string | undefined,
) {
  return {
    apiVersion: API_CONTRACT_VERSION,
    data: items,
    page: {
      hasMore: nextCursor !== undefined,
      ...(nextCursor === undefined ? {} : { nextCursor }),
    },
  } as const;
}

export function validatedJsonResponse<TValue>(
  schema: RuntimeSchema<TValue>,
  payload: unknown,
  status: number,
  headers: Readonly<Record<string, string>> = {},
): Response {
  const result = schema.safeParse(payload);
  if (!result.success) {
    throw new ApplicationError(
      "internal_error",
      "The service could not complete the request.",
    );
  }

  return new Response(JSON.stringify(result.data), {
    headers: {
      ...API_SECURITY_HEADERS,
      "content-type": "application/json; charset=UTF-8",
      ...headers,
    },
    status,
  });
}

export function errorResponse(context: ApiContext, error: unknown): Response {
  const applicationError =
    error instanceof ApplicationError
      ? error
      : new ApplicationError(
          "internal_error",
          "The service could not complete the request.",
        );
  const payload = {
    apiVersion: API_CONTRACT_VERSION,
    error: {
      code: applicationError.code,
      ...(applicationError.conflict === undefined
        ? {}
        : { conflict: applicationError.conflict }),
      correlationId: context.get("correlationId"),
      ...(applicationError.fieldIssues === undefined
        ? {}
        : { fieldIssues: [...applicationError.fieldIssues] }),
      message: applicationError.message,
    },
  };

  const parsed = apiErrorEnvelopeV1Schema.parse(payload);
  return new Response(JSON.stringify(parsed), {
    headers: {
      ...API_SECURITY_HEADERS,
      "content-type": "application/json; charset=UTF-8",
    },
    status: applicationError.status,
  });
}
