import { describe, expect, it, vi } from "vitest";
import {
  AI_INTENT_PREVIEW_REQUIREMENTS_MAX_BYTES_V1,
  aiIntentPreviewRequestHeadersV1Schema,
  aiIntentPreviewRequestQueryV1Schema,
  aiIntentPreviewResponseHeadersV1Schema,
  createAiIntentPreviewV1Schema,
} from "./ai-intent-preview-request.js";
import { createCloudMarkupClient, type JsonApiOperationId } from "./client.js";
import { apiOperationsV1 } from "./operations.js";
import { generateOpenApiDocumentV1 } from "./openapi.js";

const input = {
  contractVersion: 1,
  requirements: "A small notes API.\nKeep the original text.",
  requestedMode: "guided",
  editingProof: {
    leaseId: "projectlease_00000000-0000-4000-8000-000000000001",
    token: "A".repeat(43),
  },
};
describe("memory-only preview request contract", () => {
  it("accepts bounded prompt and editing proof without inventing execution or billing authority", () => {
    expect(createAiIntentPreviewV1Schema.parse(input)).toEqual(input);
    expect(apiOperationsV1["ai-intent-previews.create"]).toMatchObject({
      method: "POST",
      responseKind: "sse",
      responseMediaType: "text/event-stream",
      security: "principal",
      path: "/v1/projects/:projectId/ai-intent-previews",
    });
  });
  it.each([
    "organizationId",
    "principalId",
    "maximumCostMicroUsd",
    "candidate",
  ])("rejects caller-supplied %s", (key) => {
    expect(
      createAiIntentPreviewV1Schema.safeParse({ ...input, [key]: "untrusted" })
        .success,
    ).toBe(false);
  });
  it.each([
    ["empty", ""],
    [
      "oversized ASCII",
      "x".repeat(AI_INTENT_PREVIEW_REQUIREMENTS_MAX_BYTES_V1 + 1),
    ],
    [
      "oversized UTF-8",
      "💡".repeat(AI_INTENT_PREVIEW_REQUIREMENTS_MAX_BYTES_V1 / 4 + 1),
    ],
  ] as const)("rejects %s requirements", (_name, requirements) => {
    expect(
      createAiIntentPreviewV1Schema.safeParse({ ...input, requirements })
        .success,
    ).toBe(false);
  });
  it("counts UTF-8 bytes and preserves content at the exact limit", () => {
    const requirements = "💡".repeat(
      AI_INTENT_PREVIEW_REQUIREMENTS_MAX_BYTES_V1 / 4,
    );
    expect(
      createAiIntentPreviewV1Schema.parse({ ...input, requirements })
        .requirements,
    ).toBe(requirements);
  });
  it.each([
    { "idempotency-key": "preview_one" },
    { "if-match": '"draft:main:v1"' },
    { "idempotency-key": "preview_one", "if-match": 'W/"draft:main:v1"' },
    { "idempotency-key": "preview_one", "if-match": '"revision:main:v1"' },
    { "idempotency-key": "preview_one", "if-match": '"draft:main:v0"' },
  ])(
    "requires exact saved-draft precondition and idempotency headers %j",
    (headers) => {
      expect(
        aiIntentPreviewRequestHeadersV1Schema.safeParse(headers).success,
      ).toBe(false);
    },
  );
  it("accepts the existing strong draft and idempotency shape", () => {
    expect(
      aiIntentPreviewRequestHeadersV1Schema.parse({
        "idempotency-key": "preview_one",
        "if-match": '"draft:main:v1"',
      }),
    ).toEqual({
      "idempotency-key": "preview_one",
      "if-match": '"draft:main:v1"',
    });
    expect(
      aiIntentPreviewRequestQueryV1Schema.safeParse({ token: "untrusted" })
        .success,
    ).toBe(false);
  });
  it("requires a server invocation identity and fixed non-cacheable SSE headers", () => {
    const headers = {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "private, no-store, no-transform",
      "content-security-policy": "sandbox",
      "x-content-type-options": "nosniff",
      "x-cloudmarkup-preview-invocation-id": "preview_server_one",
    };
    expect(aiIntentPreviewResponseHeadersV1Schema.parse(headers)).toEqual(
      headers,
    );
    expect(
      aiIntentPreviewResponseHeadersV1Schema.safeParse({
        ...headers,
        "cache-control": "public",
      }).success,
    ).toBe(false);
    expect(
      aiIntentPreviewResponseHeadersV1Schema.safeParse({
        ...headers,
        "x-cloudmarkup-preview-invocation-id": "",
      }).success,
    ).toBe(false);
  });
  it("excludes SSE from the buffered JSON client at types and runtime before sending", async () => {
    const excluded: "ai-intent-previews.create" extends JsonApiOperationId
      ? false
      : true = true;
    expect(excluded).toBe(true);
    const transport = vi
      .fn()
      .mockRejectedValue(new Error("No transport permitted"));
    const client = createCloudMarkupClient({ baseUrl: "/api", transport });
    const force = client.request.bind(client) as unknown as (
      operation: string,
      input: unknown,
    ) => Promise<unknown>;
    await expect(force("ai-intent-previews.create", {})).rejects.toThrow(
      "bounded memory-only consumer",
    );
    expect(transport).not.toHaveBeenCalled();
  });
  it("documents the SSE byte stream and JSON frame shape without advertising a buffered response", () => {
    const document = generateOpenApiDocumentV1();
    expect(document).toHaveProperty(
      [
        "paths",
        "/v1/projects/{projectId}/ai-intent-previews",
        "post",
        "responses",
        "200",
        "content",
        "text/event-stream",
        "schema",
        "type",
      ],
      "string",
    );
    expect(document).toHaveProperty([
      "paths",
      "/v1/projects/{projectId}/ai-intent-previews",
      "post",
      "responses",
      "200",
      "content",
      "text/event-stream",
      "x-cloudmarkup-frame-schema",
    ]);
    expect(document).not.toHaveProperty([
      "paths",
      "/v1/projects/{projectId}/ai-intent-previews",
      "post",
      "responses",
      "200",
      "content",
      "application/json",
    ]);
  });
});
