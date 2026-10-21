import { z } from "zod";

import { apiErrorEnvelopeV1Schema } from "./common.js";
import {
  apiOperationsV1,
  type ApiOperationDefinition,
  type ApiOperationId,
} from "./operations.js";

type JsonObject = Record<string, unknown>;

function withoutDialect(schema: unknown): JsonObject {
  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) {
    throw new Error("OpenAPI schema generation returned a non-object schema.");
  }

  const copy = { ...(schema as JsonObject) };
  delete copy["$schema"];
  return copy;
}

function toOpenApiSchema(schema: z.ZodType, io: "input" | "output") {
  return withoutDialect(
    z.toJSONSchema(schema, {
      io,
      target: "draft-2020-12",
      unrepresentable: "any",
    }),
  );
}

function openApiPath(path: string): string {
  return path.replaceAll(/:([A-Za-z][A-Za-z0-9]*)/g, "{$1}");
}

function openApiHeaderName(name: string): string {
  const names: Readonly<Record<string, string>> = {
    "idempotency-key": "Idempotency-Key",
    "if-match": "If-Match",
    "cache-control": "Cache-Control",
    "content-disposition": "Content-Disposition",
    "content-length": "Content-Length",
    "content-security-policy": "Content-Security-Policy",
    "content-type": "Content-Type",
    "referrer-policy": "Referrer-Policy",
    "x-cloudmarkup-content-sha256": "X-CloudMarkup-Content-Sha256",
    "x-content-type-options": "X-Content-Type-Options",
  };

  return names[name] ?? name;
}

function schemaParameters(
  schema: z.ZodType | undefined,
  location: "header" | "path" | "query",
): JsonObject[] {
  if (schema === undefined) {
    return [];
  }

  const generated = toOpenApiSchema(schema, "input");
  const properties = generated["properties"];
  const required = new Set(
    Array.isArray(generated["required"])
      ? generated["required"].filter(
          (value): value is string => typeof value === "string",
        )
      : [],
  );

  if (typeof properties !== "object" || properties === null) {
    return [];
  }

  const propertySchemas = properties as Record<string, unknown>;
  return Object.entries(propertySchemas).map(([name, propertySchema]) => ({
    in: location,
    name: location === "header" ? openApiHeaderName(name) : name,
    required: location === "path" || required.has(name),
    schema: propertySchema,
  }));
}

function responseHeaders(
  schema: z.ZodType | undefined,
): JsonObject | undefined {
  if (schema === undefined) return undefined;
  const generated = toOpenApiSchema(schema, "output");
  const properties = generated["properties"];
  if (typeof properties !== "object" || properties === null) return undefined;
  return Object.fromEntries(
    Object.entries(properties as Record<string, unknown>).map(
      ([name, propertySchema]) => [
        openApiHeaderName(name),
        { schema: propertySchema },
      ],
    ),
  );
}

function operationDocument(
  operationId: ApiOperationId,
  operation: ApiOperationDefinition,
): JsonObject {
  const parameters = [
    ...schemaParameters(operation.pathSchema, "path"),
    ...schemaParameters(operation.querySchema, "query"),
    ...schemaParameters(operation.headerSchema, "header"),
  ];

  const successResponse: JsonObject = {
    content: {
      [operation.responseKind === "binary" || operation.responseKind === "sse"
        ? (operation.responseMediaType ?? "application/octet-stream")
        : "application/json"]: {
        schema:
          operation.responseKind === "binary"
            ? { format: "binary", type: "string" }
            : operation.responseKind === "sse"
              ? {
                  type: "string",
                  description:
                    "Bounded server-sent events. Each data field is one JSON frame; the complete candidate remains in memory only.",
                }
              : toOpenApiSchema(operation.responseSchema, "output"),
        ...(operation.responseKind === "sse"
          ? {
              "x-cloudmarkup-frame-schema": toOpenApiSchema(
                operation.responseSchema,
                "output",
              ),
            }
          : {}),
      },
    },
    description: "Successful response",
  };
  const declaredResponseHeaders = responseHeaders(
    operation.responseHeaderSchema,
  );
  if (declaredResponseHeaders !== undefined)
    successResponse["headers"] = declaredResponseHeaders;

  if (operation.etagResponse === true) {
    successResponse["headers"] = {
      ETag: {
        description: "Strong entity tag for optimistic concurrency",
        schema: { pattern: '^"[A-Za-z0-9._:-]+"$', type: "string" },
      },
    };
  }

  const document: JsonObject = {
    operationId: operationId.replaceAll(".", "_"),
    responses: {
      [operation.successStatus]: successResponse,
      default: {
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ApiErrorEnvelopeV1" },
          },
        },
        description: "Safe versioned error response",
      },
    },
    summary: operation.summary,
    tags: [operation.tag],
  };

  if (parameters.length > 0) {
    document["parameters"] = parameters;
  }

  if (operation.bodySchema !== undefined) {
    document["requestBody"] = {
      content: {
        "application/json": {
          schema: toOpenApiSchema(operation.bodySchema, "input"),
        },
      },
      required: true,
    };
  }

  if (operation.security === "principal") {
    document["security"] = [{ bearerAuth: [] }];
  }

  return document;
}

export function generateOpenApiDocumentV1() {
  const paths: Record<string, JsonObject> = {};

  for (const [operationId, operation] of Object.entries(apiOperationsV1) as [
    ApiOperationId,
    ApiOperationDefinition,
  ][]) {
    const path = openApiPath(operation.path);
    const pathItem = paths[path] ?? {};
    pathItem[operation.method.toLowerCase()] = operationDocument(
      operationId,
      operation,
    );
    paths[path] = pathItem;
  }

  return {
    components: {
      schemas: {
        ApiErrorEnvelopeV1: toOpenApiSchema(apiErrorEnvelopeV1Schema, "output"),
      },
      securitySchemes: {
        bearerAuth: {
          bearerFormat: "JWT",
          scheme: "bearer",
          type: "http",
        },
      },
    },
    info: {
      description:
        "Versioned CloudMarkup modular-monolith contract. Tenant context is derived from verified middleware; route identifiers are selectors only.",
      title: "CloudMarkup API",
      version: "1.0.0",
    },
    jsonSchemaDialect: "https://json-schema.org/draft/2020-12/schema",
    openapi: "3.1.0",
    paths,
    tags: [
      { name: "Operations" },
      { name: "Identity" },
      { name: "Organizations" },
      { name: "Projects" },
      { name: "Drafts" },
      { name: "Revisions" },
      { name: "Validation" },
      { name: "Jobs" },
      { name: "Artifacts" },
      { name: "Integrations" },
      { name: "Audit" },
      { name: "Solution Exports" },
    ],
  } as const;
}

export type OpenApiDocumentV1 = ReturnType<typeof generateOpenApiDocumentV1>;
