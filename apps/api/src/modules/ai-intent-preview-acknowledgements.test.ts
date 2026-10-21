import { MAX_JSON_REQUEST_BYTES } from "@cloudmarkup/api-contract";
import { describe, expect, it, vi } from "vitest";

import { createApp } from "../app.js";
import type { AiIntentPreviewAcknowledgementPortV1 } from "../application/ai-intent-preview-acknowledgements.js";
import { API_AUTHORIZATION_REQUIREMENTS } from "../application/authorization.js";
import { ApplicationError } from "../application/errors.js";
import { createProductionAiIntentPreviewAcknowledgements } from "../production-ai-intent-preview-acknowledgements.js";
import {
  FixedPrincipalResolver,
  InMemoryCloudMarkupApplication,
} from "../testing/in-memory-adapters.js";

const now = "2026-09-07T15:29:45.000Z";
const principal = {
  principalId: "principal_test",
  sessionId: "session_test",
  authenticatedAt: "2026-09-07T15:00:00.000Z",
  expiresAt: "2026-09-07T16:00:00.000Z",
};
const path = "/v1/projects/project_test/ai-intent-previews/acknowledgement";
const input = {
  contractVersion: 1 as const,
  delivery: {
    contractVersion: 1 as const,
    invocationId: "invocation_test",
    outputDigest: `sha256:${"a".repeat(64)}` as const,
    expiresAt: "2026-09-07T15:30:00.000Z",
    token: "A".repeat(43),
  },
  editingProof: {
    leaseId: "projectlease_12345678-1234-4234-8234-123456789abc",
    token: "Q".repeat(42) + "A",
  },
};
const receipt = { contractVersion: 1 as const, state: "acknowledged" as const };
const headers = {
  authorization: "Bearer synthetic-owner",
  "content-type": "application/json",
};
function fixture(enabled = true) {
  const acknowledge = vi
    .fn<AiIntentPreviewAcknowledgementPortV1["acknowledge"]>()
    .mockResolvedValue(receipt);
  const app = createApp({
    application: new InMemoryCloudMarkupApplication({}),
    authenticationClock: () => new Date(now),
    correlationIdFactory: () => "correlation-preview-ack",
    principalResolver: new FixedPrincipalResolver({
      "Bearer synthetic-owner": principal,
      "Bearer synthetic-expired": { ...principal, expiresAt: now },
    }),
    ...(enabled ? { aiIntentPreviewAcknowledgements: { acknowledge } } : {}),
  });
  const request = (body: unknown = input, target = path) =>
    app.request(target, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  return { app, acknowledge, request };
}

describe("authenticated AI preview ACK HTTP boundary", () => {
  it("passes the verified principal and only parsed proof data, returning no-store receipt metadata", async () => {
    const f = fixture();
    const response = await f.request();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ apiVersion: "v1", data: receipt });
    expect(f.acknowledge).toHaveBeenCalledExactlyOnceWith(
      {
        ...principal,
        authenticationSource: "test",
        correlationId: "correlation-preview-ack",
      },
      "project_test",
      input,
    );
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(
      API_AUTHORIZATION_REQUIREMENTS["ai-intent-previews.acknowledge"],
    ).toEqual({
      kind: "organization-permission",
      permission: "commercial.expensive.use",
    });
  });
  it.each([undefined, "Bearer synthetic-expired"])(
    "authenticates before parsing or invoking with %s",
    async (authorization) => {
      const f = fixture();
      const response = await f.app.request(path, {
        method: "POST",
        headers: authorization === undefined ? {} : { authorization },
        body: "{invalid",
      });
      expect(response.status).toBe(401);
      expect(f.acknowledge).not.toHaveBeenCalled();
    },
  );
  it.each([
    { ...input, contractVersion: 2 },
    { ...input, organizationId: "org_other" },
    { ...input, principal },
    { ...input, candidate: "unaccepted-input" },
    { ...input, delivery: { ...input.delivery, token: "short" } },
    {
      ...input,
      editingProof: { ...input.editingProof, leaseId: "projectlease_invalid" },
    },
  ])("rejects malformed or injected request authority %#", async (value) => {
    const f = fixture();
    const response = await f.request(value);
    expect(response.status).toBe(400);
    expect(f.acknowledge).not.toHaveBeenCalled();
    expect(await response.text()).not.toContain(input.delivery.token);
  });
  it("rejects invalid project selectors, all query strings and oversized JSON", async () => {
    const f = fixture();
    for (const target of [
      path.replace("project_test", "org_other"),
      path + "?token=" + input.delivery.token,
      path + "?x=1&x=2",
    ])
      expect((await f.request(input, target)).status).toBe(400);
    const large = await f.app.request(path, {
      method: "POST",
      headers,
      body: " ".repeat(MAX_JSON_REQUEST_BYTES + 1),
    });
    expect(large.status).toBe(413);
    expect(f.acknowledge).not.toHaveBeenCalled();
  });
  it("rejects wrong content type, invalid JSON and missing host without a fallback", async () => {
    const f = fixture();
    for (const requestHeaders of [
      headers,
      { authorization: headers.authorization },
    ]) {
      expect(
        (
          await f.app.request(path, {
            method: "POST",
            headers: requestHeaders,
            body: "{invalid",
          })
        ).status,
      ).toBe(400);
    }
    expect(f.acknowledge).not.toHaveBeenCalled();
    const disabled = fixture(false);
    expect((await disabled.request()).status).toBe(503);
    expect(disabled.acknowledge).not.toHaveBeenCalled();
  });
  it("never echoes delivery or tab proofs used as duplicate query names", async () => {
    const f = fixture();
    for (const token of [input.delivery.token, input.editingProof.token]) {
      const response = await f.request(input, `${path}?${token}=1&${token}=2`);
      expect(response.status).toBe(400);
      const text = await response.text();
      expect(text).not.toContain(input.delivery.token);
      expect(text).not.toContain(input.editingProof.token);
    }
    expect(f.acknowledge).not.toHaveBeenCalled();
  });
  it("does not reinterpret a denied/stale receipt as delivered", async () => {
    const f = fixture();
    f.acknowledge.mockRejectedValue(
      new ApplicationError(
        "conflict",
        "The preview acknowledgement could not be confirmed.",
      ),
    );
    const response = await f.request();
    expect(response.status).toBe(409);
    const text = await response.text();
    for (const value of [
      input.delivery.token,
      input.editingProof.token,
      principal.principalId,
      principal.sessionId,
    ])
      expect(text).not.toContain(value);
  });
  it("sanitizes real host database failures without constructing any provider or new metadata", async () => {
    const transaction = vi.fn();
    const query = vi.fn();
    const port = createProductionAiIntentPreviewAcknowledgements({
      query: () => {
        query();
        return Promise.reject(new Error("Unexpected direct query"));
      },
      transaction: () => {
        transaction();
        return Promise.reject(
          new Error("private SQL and unaccepted-input " + input.delivery.token),
        );
      },
      close: () => Promise.resolve(),
    });
    expect(transaction).not.toHaveBeenCalled();
    await expect(
      port.acknowledge(
        {
          ...principal,
          // Synthetic Cognito descriptor reaches the real host's SQL failure path.
          authenticationSource: "cognito",
          correlationId: "correlation-preview-ack",
        },
        "project_test",
        input,
      ),
    ).rejects.toMatchObject({
      code: "conflict",
      message: "The preview acknowledgement could not be confirmed.",
    });
    expect(transaction).toHaveBeenCalledOnce();
    expect(query).not.toHaveBeenCalled();
  });
});
