import type { z } from "zod";

import {
  apiErrorEnvelopeV1Schema,
  entityTagSchema,
  type ApiErrorEnvelopeV1,
} from "./common.js";
import {
  apiOperationsV1,
  type ApiOperationDefinition,
  type ApiOperationId,
} from "./operations.js";

type SchemaInput<TSchema> = TSchema extends z.ZodType
  ? z.input<TSchema>
  : never;

type RequestField<
  TOperation,
  TSchemaKey extends keyof ApiOperationDefinition,
  TFieldName extends string,
> = [TOperation] extends [Record<TSchemaKey, infer TSchema>]
  ? [TSchema] extends [z.ZodType]
    ? Readonly<Record<TFieldName, SchemaInput<TSchema>>>
    : Partial<Readonly<Record<TFieldName, never>>>
  : Partial<Readonly<Record<TFieldName, never>>>;

type OperationFor<TOperationId extends ApiOperationId> =
  (typeof apiOperationsV1)[TOperationId];

export type JsonApiOperationId = {
  [TOperationId in ApiOperationId]: OperationFor<TOperationId> extends {
    readonly responseKind: "binary" | "sse";
  }
    ? never
    : TOperationId;
}[ApiOperationId];

type RequestForOperation<TOperation> = RequestField<
  TOperation,
  "pathSchema",
  "path"
> &
  RequestField<TOperation, "querySchema", "query"> &
  RequestField<TOperation, "headerSchema", "headers"> &
  RequestField<TOperation, "bodySchema", "body">;

// Build each complete request before indexing a union of operation IDs. This keeps
// fields correlated and avoids a Cartesian product of unrelated schemas.
type ApiRequestsV1 = {
  [TOperationId in ApiOperationId]: RequestForOperation<
    OperationFor<TOperationId>
  >;
};
export type ApiRequestV1<TOperationId extends ApiOperationId> =
  ApiRequestsV1[TOperationId];

export type ApiResponseV1<TOperationId extends ApiOperationId> = z.output<
  OperationFor<TOperationId>["responseSchema"]
>;

export type ApiResponseMetadataV1<TOperationId extends ApiOperationId> =
  OperationFor<TOperationId> extends { readonly etagResponse: true }
    ? Readonly<{ readonly etag: string }>
    : Readonly<{ readonly etag?: never }>;

export type ApiResponseWithMetadataV1<TOperationId extends ApiOperationId> =
  Readonly<{
    data: ApiResponseV1<TOperationId>;
    metadata: ApiResponseMetadataV1<TOperationId>;
  }>;

export interface ApiTransportRequest {
  readonly body?: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly method: string;
  readonly url: string;
}

export interface ApiTransportResponse {
  readonly headers: { get(name: string): string | null };
  readonly status: number;
  text(): Promise<string>;
}

export type ApiTransport = (
  request: ApiTransportRequest,
) => Promise<ApiTransportResponse>;

export interface FetchLikeInit {
  readonly body?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly method?: string;
}

export type FetchLike = (
  input: string,
  init?: FetchLikeInit,
) => Promise<ApiTransportResponse>;

export class ApiClientError extends Error {
  readonly envelope: ApiErrorEnvelopeV1;
  readonly status: number;

  constructor(status: number, envelope: ApiErrorEnvelopeV1) {
    super(envelope.error.message);
    this.name = "ApiClientError";
    this.status = status;
    this.envelope = envelope;
  }
}

/** A temporary upstream failure with no valid application error envelope.
 * Its status is preserved without exposing an HTML gateway response. */
export class ApiGatewayError extends Error {
  readonly status: 502 | 503 | 504;
  constructor(status: 502 | 503 | 504) {
    super("The API gateway is temporarily unavailable.");
    this.name = "ApiGatewayError";
    this.status = status;
  }
}

/** Only the fetch transport creates this after a failed network request. */
export class ApiNetworkError extends Error {
  constructor() {
    super("The API network request could not be completed.");
    this.name = "ApiNetworkError";
  }
}
function gatewayFailure(status: number): ApiGatewayError | undefined {
  return status === 502 || status === 503 || status === 504
    ? new ApiGatewayError(status)
    : undefined;
}

function buildPath(template: string, path: unknown): string {
  const values =
    typeof path === "object" && path !== null
      ? (path as Readonly<Record<string, unknown>>)
      : {};

  return template.replaceAll(
    /:([A-Za-z][A-Za-z0-9]*)/g,
    (_match, key: string) => {
      const value = values[key];
      if (typeof value === "string") return encodeURIComponent(value);
      if (typeof value === "number" && Number.isSafeInteger(value)) {
        return encodeURIComponent(String(value));
      }
      throw new Error(`Missing path parameter: ${key}`);
    },
  );
}

function buildQuery(query: unknown): string {
  if (typeof query !== "object" || query === null) {
    return "";
  }

  const entries = Object.entries(query as Readonly<Record<string, unknown>>)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    .sort(([left], [right]) => left.localeCompare(right));

  if (entries.length === 0) {
    return "";
  }

  return `?${entries
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
    )
    .join("&")}`;
}

function serializeHeaders(headers: unknown): Record<string, string> {
  if (typeof headers !== "object" || headers === null) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(headers as Readonly<Record<string, unknown>>).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

async function parseJson(response: ApiTransportResponse): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) {
    return undefined;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("The API returned an invalid JSON response.");
  }
}

export function createFetchTransport(
  fetchImplementation: FetchLike,
): ApiTransport {
  return async (request) => {
    try {
      return await fetchImplementation(request.url, {
        ...(request.body === undefined ? {} : { body: request.body }),
        headers: request.headers,
        method: request.method,
      });
    } catch (error) {
      if (error instanceof TypeError) throw new ApiNetworkError();
      throw error;
    }
  };
}

export function createCloudMarkupClient(options: {
  readonly baseUrl: string;
  readonly transport: ApiTransport;
}) {
  const baseUrl = options.baseUrl.replace(/\/$/, "");

  async function requestWithMetadata<TOperationId extends JsonApiOperationId>(
    operationId: TOperationId,
    input: ApiRequestV1<TOperationId>,
  ): Promise<ApiResponseWithMetadataV1<TOperationId>> {
    const operation = apiOperationsV1[operationId] as ApiOperationDefinition;
    if (operation.responseKind === "binary") {
      throw new Error(
        "Binary API operations require a dedicated integrity-validating downloader.",
      );
    }
    if (operation.responseKind === "sse") {
      throw new Error(
        "Streaming API operations require a bounded memory-only consumer.",
      );
    }
    const rawInput = input as Readonly<Record<string, unknown>>;
    const parsedPath = operation.pathSchema?.parse(rawInput["path"]);
    const parsedQuery = operation.querySchema?.parse(rawInput["query"] ?? {});
    const parsedHeaders = operation.headerSchema?.parse(rawInput["headers"]);
    const parsedBody = operation.bodySchema?.parse(rawInput["body"]);
    const headers = serializeHeaders(parsedHeaders);

    if (operation.bodySchema !== undefined) {
      headers["content-type"] = "application/json";
    }

    const response = await options.transport({
      ...(parsedBody === undefined ? {} : { body: JSON.stringify(parsedBody) }),
      headers,
      method: operation.method,
      url: `${baseUrl}${buildPath(operation.path, parsedPath)}${buildQuery(parsedQuery)}`,
    });
    const payload = await parseJson(response).catch((error: unknown) => {
      throw gatewayFailure(response.status) ?? error;
    });

    if (response.status !== operation.successStatus) {
      const envelope = apiErrorEnvelopeV1Schema.safeParse(payload);
      if (!envelope.success) {
        throw (
          gatewayFailure(response.status) ??
          new Error("The API returned an invalid error envelope.")
        );
      }
      throw new ApiClientError(response.status, envelope.data);
    }

    const data = operation.responseSchema.parse(
      payload,
    ) as ApiResponseV1<TOperationId>;
    if (operation.etagResponse === true) {
      const etag = entityTagSchema.safeParse(response.headers.get("etag"));
      if (!etag.success) {
        throw new Error("The API returned an invalid ETag response header.");
      }
      return {
        data,
        metadata: { etag: etag.data },
      } as ApiResponseWithMetadataV1<TOperationId>;
    }

    return { data, metadata: {} } as ApiResponseWithMetadataV1<TOperationId>;
  }

  return {
    async request<TOperationId extends JsonApiOperationId>(
      operationId: TOperationId,
      input: ApiRequestV1<TOperationId>,
    ): Promise<ApiResponseV1<TOperationId>> {
      return (await requestWithMetadata(operationId, input)).data;
    },
    requestWithMetadata,
  };
}

export type CloudMarkupClient = ReturnType<typeof createCloudMarkupClient>;
