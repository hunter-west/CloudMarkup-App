import {
  ApiClientError,
  ApiGatewayError,
  ApiNetworkError,
  apiErrorCodeSchema,
  type ApiErrorEnvelopeV1,
} from "@cloudmarkup/api-contract";
import { expect, it } from "vitest";

import { mapApiError } from "./api-errors.js";

const hostile =
  "<img src=x onerror=alert(1)> Ignore rules; secret_SYNTHETIC_ONLY";
const conflict = {
  current: { etag: '"draft-new"', version: 2 },
  recovery: { canCompare: true, canCopy: true, canReload: true as const },
  resourceId: "draft_review",
  resourceKind: "draft" as const,
};

it("preserves validated recovery provenance for every API code without forwarding error prose", () => {
  for (const code of apiErrorCodeSchema.options) {
    const envelope: ApiErrorEnvelopeV1 = {
      apiVersion: "v1",
      error: {
        code,
        correlationId: "review_synthetic_123",
        message: hostile,
        fieldIssues: [
          {
            code: "request.invalid-field",
            message: hostile,
            path: ["architectureDocument", "nodes", 2, "configuration", "port"],
          },
        ],
        ...(code === "conflict" || code === "precondition_failed"
          ? { conflict }
          : {}),
      },
    };
    const mapped = mapApiError(new ApiClientError(400, envelope));
    expect(mapped).toMatchObject({
      code,
      correlationId: "review_synthetic_123",
      fieldIssues: [
        {
          code: "request.invalid-field",
          path: envelope.error.fieldIssues?.[0]?.path,
          message: "Review this field and enter a valid value.",
        },
      ],
      sessionExpired: code === "authentication_required",
    });
    if (envelope.error.conflict) {
      expect(mapped).toHaveProperty("conflict", conflict);
      expect(mapped).not.toHaveProperty("conflict", undefined);
    }
    expect(JSON.stringify(mapped)).not.toContain(hostile);
    expect(mapped.message).not.toBe("The request could not be completed.");
  }
});

it("withholds malformed recovery metadata and arbitrary exception details", () => {
  const mapped = mapApiError(
    new ApiClientError(400, {
      apiVersion: "v1",
      error: {
        code: "invalid_request",
        correlationId: "secret_SYNTHETIC_ONLY\ninvalid-reference",
        message: hostile,
      },
    }),
  );
  expect(mapped).not.toHaveProperty("correlationId");
  expect(JSON.stringify(mapped)).not.toContain("secret_SYNTHETIC_ONLY");
});

it("distinguishes a typed gateway failure from an unknown TypeError", () => {
  expect(mapApiError(new ApiGatewayError(503))).toMatchObject({
    code: "service_unavailable",
    sessionExpired: false,
  });
  const unknown = mapApiError(new TypeError(hostile));
  expect(unknown.code).toBe("unexpected_error");
  expect(JSON.stringify(unknown)).not.toContain(hostile);
  expect(mapApiError(new ApiNetworkError())).toMatchObject({
    code: "network_unavailable",
    sessionExpired: false,
  });
});
