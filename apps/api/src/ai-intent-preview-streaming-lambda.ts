import { randomUUID } from "node:crypto";
import type { APIGatewayProxyEvent, StreamifyHandler } from "aws-lambda";
import {
  API_CONTRACT_VERSION,
  AI_INTENT_PREVIEW_INVOCATION_HEADER_V1,
  MAX_JSON_REQUEST_BYTES,
  aiIntentPreviewRequestHeadersV1Schema,
  aiIntentPreviewResponseHeadersV1Schema,
  apiErrorEnvelopeV1Schema,
  createAiIntentPreviewV1Schema,
  projectPathV1Schema,
  type CreateAiIntentPreviewV1,
} from "@cloudmarkup/api-contract";
import type { PrincipalContext } from "./application/ports.js";
import type { PrincipalResolver } from "./application/identity.js";
import { ApplicationError } from "./application/errors.js";
import { hasVerifiedEdgeOrigin } from "./lambda-edge-handler.js";
import { API_SECURITY_HEADERS } from "./transport/http.js";
import {
  AI_INTENT_PREVIEW_SSE_HEADERS_V1,
  checkedAiIntentPreviewStreamLimitsV1,
} from "./transport/ai-intent-preview-stream.js";
import { streamAiIntentPreviewToNodeV1 } from "./transport/ai-intent-preview-native-producer.js";

type NativeInput = Parameters<typeof streamAiIntentPreviewToNodeV1>[0];
export interface AiIntentPreviewStreamingHostV1 {
  /** The host must resolve the project from this verified principal and enforce
   * current membership, project fence, draft/lease, model and commercial policy.
   * It must construct the real request-local production preview, never accept
   * browser ownership, price, model or admission claims. No work is dispatched
   * while preparing. The complete request stays in RAM. */
  prepare(input: {
    readonly principal: PrincipalContext;
    readonly projectId: string;
    readonly request: CreateAiIntentPreviewV1;
    readonly draftEtag: string;
    readonly idempotencyKey: string;
    readonly signal: AbortSignal;
    readonly assertCurrentPrincipal: () => Promise<{
      readonly expiresAt: string;
    }>;
  }): Promise<{
    readonly invocationId: string;
    readonly execute: NativeInput["execute"];
    readonly assertCurrentAuthority: NativeInput["assertCurrentAuthority"];
  }>;
}

function invalid(): never {
  throw new ApplicationError(
    "invalid_request",
    "The AI preview request is invalid.",
  );
}
function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    invalid();
  return value as Record<string, unknown>;
}
function headersFor(event: APIGatewayProxyEvent): Record<string, string> {
  const headers: Record<string, string> = Object.create(null) as Record<
    string,
    string
  >;
  const single = object(event.headers);
  const multipleValue: unknown = event.multiValueHeaders;
  const multiple = multipleValue == null ? {} : object(multipleValue);
  if (Object.keys(single).length > 100 || Object.keys(multiple).length > 100)
    invalid();
  const add = (name: string, value: unknown, repeated: boolean) => {
    if (
      !/^[A-Za-z0-9-]+$/u.test(name) ||
      typeof value !== "string" ||
      Buffer.byteLength(value, "utf8") > 8192 ||
      /[\r\n\0]/u.test(value)
    )
      invalid();
    const key = name.toLowerCase();
    if (Object.hasOwn(headers, key) && (!repeated || headers[key] !== value))
      invalid();
    headers[key] = value;
  };
  for (const [name, value] of Object.entries(single)) add(name, value, false);
  const multiNames = new Set<string>();
  for (const [name, value] of Object.entries(multiple)) {
    if (
      multiNames.has(name.toLowerCase()) ||
      !Array.isArray(value) ||
      value.length !== 1
    )
      invalid();
    multiNames.add(name.toLowerCase());
    add(name, value[0], true);
  }
  if (Object.keys(headers).length > 100) invalid();
  return headers;
}
function bodyFor(
  event: APIGatewayProxyEvent,
  headers: Record<string, string>,
): CreateAiIntentPreviewV1 {
  if (
    headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase() !==
      "application/json" ||
    (headers["content-encoding"] !== undefined &&
      headers["content-encoding"] !== "identity") ||
    typeof event.body !== "string" ||
    typeof event.isBase64Encoded !== "boolean"
  )
    invalid();
  let bytes: Buffer;
  if (event.isBase64Encoded) {
    if (
      event.body.length > Math.ceil(MAX_JSON_REQUEST_BYTES / 3) * 4 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(
        event.body,
      )
    )
      invalid();
    bytes = Buffer.from(event.body, "base64");
    if (bytes.toString("base64") !== event.body) invalid();
  } else {
    if (event.body.length > MAX_JSON_REQUEST_BYTES) {
      throw new ApplicationError(
        "payload_too_large",
        "The AI preview request is too large.",
      );
    }
    bytes = Buffer.from(event.body, "utf8");
    if (bytes.toString("utf8") !== event.body) invalid();
  }
  if (bytes.byteLength > MAX_JSON_REQUEST_BYTES) {
    throw new ApplicationError(
      "payload_too_large",
      "The AI preview request is too large.",
    );
  }
  const length = headers["content-length"];
  if (
    length !== undefined &&
    (!/^[0-9]+$/u.test(length) || Number(length) !== bytes.byteLength)
  )
    invalid();
  let value: unknown;
  try {
    value = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    ) as unknown;
  } catch {
    invalid();
  }
  const parsed = createAiIntentPreviewV1Schema.safeParse(value);
  if (!parsed.success) invalid();
  return parsed.data;
}
function requestPath(event: APIGatewayProxyEvent): string {
  if (
    "version" in event ||
    event.httpMethod !== "POST" ||
    typeof event.path !== "string" ||
    event.path.length > 8192
  )
    invalid();
  for (const query of [
    event.queryStringParameters,
    event.multiValueQueryStringParameters,
  ]) {
    if (query != null && Object.keys(object(query)).length > 0) invalid();
  }
  const match = /^\/v1\/projects\/([^/]+)\/ai-intent-previews$/u.exec(
    event.path,
  );
  if (match === null)
    throw new ApplicationError(
      "not_found",
      "The AI preview endpoint is unavailable.",
    );
  const parsed = projectPathV1Schema.safeParse({ projectId: match[1] });
  if (!parsed.success) invalid();
  return parsed.data.projectId;
}

/** Dedicated native REST streaming adapter. Hono's buffered Lambda conversion
 * never receives the prompt or candidate; its generic exception logger is also
 * avoided. The AWS native metadata wrapper is used only after safe preparation.
 * Deployment must bind this handler with awslambda.streamifyResponse and the
 * reviewed private API Gateway STREAM integration, never a Function URL. */
export function createAiIntentPreviewStreamingLambdaHandlerV1(input: {
  readonly principalResolver: PrincipalResolver;
  readonly host: AiIntentPreviewStreamingHostV1;
  readonly limits?: NativeInput["limits"];
}): StreamifyHandler<APIGatewayProxyEvent, void> {
  const limits = checkedAiIntentPreviewStreamLimitsV1(input.limits);
  return async (event, rawOutput, context) => {
    const controller = new AbortController();
    const remaining = context.getRemainingTimeInMillis();
    const duration = Math.min(
      limits.deadlineMilliseconds,
      Number.isFinite(remaining) ? Math.max(0, remaining - 500) : 0,
    );
    const stopAt = performance.now() + duration;
    const stop = () => {
      controller.abort();
      rawOutput.destroy();
    };
    const closed = () => {
      if (!rawOutput.writableFinished) stop();
    };
    rawOutput.on("error", stop);
    rawOutput.on("close", closed);
    const timeout = setTimeout(stop, duration);
    let responseStarted = false;
    const correlationId = randomUUID();
    const active = () => {
      if (
        controller.signal.aborted ||
        rawOutput.destroyed ||
        performance.now() >= stopAt
      ) {
        stop();
        throw new ApplicationError(
          "service_unavailable",
          "The AI preview request is unavailable.",
        );
      }
    };
    const bounded = async <T>(work: Promise<T>): Promise<T> => {
      void work.catch(() => undefined);
      active();
      let abort: (() => void) | undefined;
      const cancellation = new Promise<never>((_resolve, reject) => {
        abort = () => {
          reject(
            new ApplicationError(
              "service_unavailable",
              "The AI preview request is unavailable.",
            ),
          );
        };
        controller.signal.addEventListener("abort", abort, { once: true });
        if (controller.signal.aborted) abort();
      });
      try {
        const result = await Promise.race([work, cancellation]);
        active();
        return result;
      } finally {
        if (abort !== undefined)
          controller.signal.removeEventListener("abort", abort);
      }
    };
    try {
      active();
      if (
        rawOutput.writableObjectMode ||
        rawOutput.writableLength !== 0 ||
        rawOutput.writableEnded ||
        !rawOutput.writable
      ) {
        rawOutput.destroy();
        return;
      }
      const headers = headersFor(event);
      if (!hasVerifiedEdgeOrigin({ headers })) {
        throw new ApplicationError(
          "access_denied",
          "The AI preview origin is unavailable.",
        );
      }
      active();
      const principal = await bounded(
        input.principalResolver.resolve(headers["authorization"]),
      );
      if (
        principal === null ||
        !Number.isFinite(Date.parse(principal.expiresAt)) ||
        Date.parse(principal.expiresAt) <= Date.now()
      ) {
        throw new ApplicationError(
          "authentication_required",
          "Authentication is required.",
        );
      }
      const original: PrincipalContext = Object.freeze({
        ...principal,
        correlationId,
      });
      const assertCurrentPrincipal = async () => {
        active();
        const current = await bounded(
          input.principalResolver.resolve(headers["authorization"]),
        );
        if (
          current?.principalId !== original.principalId ||
          current.sessionId !== original.sessionId ||
          current.authenticationSource !== original.authenticationSource ||
          current.authenticatedAt !== original.authenticatedAt
        ) {
          throw new ApplicationError(
            "authentication_required",
            "Authentication is required.",
          );
        }
        const expiresAt = Math.min(
          Date.parse(original.expiresAt),
          Date.parse(current.expiresAt),
        );
        if (!Number.isFinite(expiresAt) || Date.now() >= expiresAt) {
          throw new ApplicationError(
            "authentication_required",
            "Authentication is required.",
          );
        }
        active();
        return { expiresAt: new Date(expiresAt).toISOString() };
      };
      const projectId = requestPath(event);
      const parsedHeaders = aiIntentPreviewRequestHeadersV1Schema.safeParse({
        "if-match": headers["if-match"],
        "idempotency-key": headers["idempotency-key"],
      });
      if (!parsedHeaders.success) invalid();
      const request = bodyFor(event, headers);
      active();
      const prepared = await bounded(
        input.host.prepare({
          principal: original,
          projectId,
          request,
          draftEtag: parsedHeaders.data["if-match"],
          idempotencyKey: parsedHeaders.data["idempotency-key"],
          signal: controller.signal,
          assertCurrentPrincipal,
        }),
      );
      const invocationId = aiIntentPreviewResponseHeadersV1Schema.shape[
        AI_INTENT_PREVIEW_INVOCATION_HEADER_V1
      ].parse(prepared.invocationId);
      const execute = prepared.execute;
      const currentScope = prepared.assertCurrentAuthority;
      const assertCurrentAuthority = async () => {
        const principalAuthority = await assertCurrentPrincipal();
        const scope = await bounded(currentScope());
        const expiresAt = Math.min(
          Date.parse(principalAuthority.expiresAt),
          Date.parse(scope.expiresAt),
        );
        if (!Number.isFinite(expiresAt) || Date.now() >= expiresAt) {
          throw new ApplicationError(
            "access_denied",
            "The AI preview authority has expired.",
          );
        }
        active();
        return { expiresAt: new Date(expiresAt).toISOString() };
      };
      await assertCurrentAuthority();
      const responseHeaders = aiIntentPreviewResponseHeadersV1Schema.parse({
        ...AI_INTENT_PREVIEW_SSE_HEADERS_V1,
        [AI_INTENT_PREVIEW_INVOCATION_HEADER_V1]: invocationId,
      });
      active();
      responseStarted = true;
      const output = awslambda.HttpResponseStream.from(rawOutput, {
        statusCode: 200,
        headers: { ...API_SECURITY_HEADERS, ...responseHeaders },
      });
      await streamAiIntentPreviewToNodeV1({
        output,
        invocationId,
        signal: controller.signal,
        execute,
        assertCurrentAuthority,
        limits,
      });
    } catch (error) {
      if (responseStarted || controller.signal.aborted || rawOutput.destroyed) {
        rawOutput.destroy();
        return;
      }
      // Never reuse arbitrary error messages, field paths, conflict bodies or
      // gateway/provider claims: they may contain temporary input or proofs.
      try {
        const failure = new ApplicationError(
          error instanceof ApplicationError
            ? error.code
            : "service_unavailable",
          "The AI preview request could not be completed.",
        );
        const payload = apiErrorEnvelopeV1Schema.parse({
          apiVersion: API_CONTRACT_VERSION,
          error: {
            code: failure.code,
            message: failure.message,
            correlationId,
          },
        });
        responseStarted = true;
        const output = awslambda.HttpResponseStream.from(rawOutput, {
          statusCode: failure.status,
          headers: {
            ...API_SECURITY_HEADERS,
            "content-type": "application/json; charset=utf-8",
          },
        });
        // AWS installs its HTTP metadata prelude on the first write(), not
        // end(body). Keep this explicit so error responses have valid framing.
        output.write(JSON.stringify(payload));
        const errorDeadline = setTimeout(stop, limits.backpressureMilliseconds);
        try {
          // AWS exposes a writable facade, not a Node Writable instance. Its
          // native end callback is the completion boundary; finished() rejects
          // that facade even though it supports the documented write/end API.
          await bounded(
            new Promise<void>((resolve, reject) => {
              output.end((error?: Error | null) => {
                if (error != null)
                  reject(
                    new ApplicationError(
                      "service_unavailable",
                      "The AI preview response is unavailable.",
                    ),
                  );
                else resolve();
              });
            }),
          );
        } finally {
          clearTimeout(errorDeadline);
        }
      } catch {
        rawOutput.destroy();
      }
    } finally {
      clearTimeout(timeout);
      controller.abort();
      // Keep the content-free error observer until close, including late native
      // errors. The request closure contains no persistent response storage.
      rawOutput.removeListener("close", closed);
      if (rawOutput.closed) rawOutput.removeListener("error", stop);
      else
        rawOutput.once("close", () => {
          rawOutput.removeListener("error", stop);
        });
      if (!rawOutput.writableFinished) rawOutput.destroy();
    }
  };
}
