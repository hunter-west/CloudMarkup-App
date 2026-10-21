import {
  acceptedIntentV1Schema,
  apiOperationsV1,
} from "@cloudmarkup/api-contract";
import {
  digestCanonicalValue,
  modelIntentExtractionResponseV1Schema,
} from "@cloudmarkup/schemas";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../app.js";
import type { AiIntentAcceptancePortV1 } from "../application/ai-intent-acceptance.js";
import { ApplicationError } from "../application/errors.js";
import {
  FixedPrincipalResolver,
  InMemoryCloudMarkupApplication,
} from "../testing/in-memory-adapters.js";
import { aiPreviewFixture } from "../adapters/persistence/ai-intent-preview-test-helpers.js";

const now = "2026-09-11T13:00:00.000Z";
const principal = {
  principalId: "principal_test",
  sessionId: "session_test",
  authenticatedAt: "2026-09-11T12:00:00.000Z",
  expiresAt: "2026-09-11T14:00:00.000Z",
};
const candidate = modelIntentExtractionResponseV1Schema.parse(
  aiPreviewFixture().result.response,
);
const input = {
  contractVersion: 1 as const,
  candidate,
  editingProof: {
    leaseId: "projectlease_12345678-1234-4234-8234-123456789abc",
    token: "A".repeat(43),
  },
};
const receipt = acceptedIntentV1Schema.parse({
  contractVersion: 1,
  acceptedIntentId: "accepted_intent_test",
  projectId: "project_test",
  createdAt: now,
  createdByPrincipalId: principal.principalId,
  sourceDraftId: "draft_test",
  sourceDraftVersion: 1,
  invocationId: candidate.provenance.invocationId,
  outputDigest: digestCanonicalValue(candidate),
  intentDigest: digestCanonicalValue(candidate.intentDocument),
  intentDocument: candidate.intentDocument,
});
const path = "/v1/projects/project_test/ai-intent-previews/acceptance";
const headers = {
  authorization: "Bearer synthetic-owner",
  "content-type": "application/json",
  "if-match": '"draft:draft_test:v1"',
  "idempotency-key": "accepted_intent_test",
};
function fixture(enabled = true) {
  const accept = vi
    .fn<AiIntentAcceptancePortV1["accept"]>()
    .mockResolvedValue(receipt);
  const get = vi
    .fn<AiIntentAcceptancePortV1["get"]>()
    .mockResolvedValue(receipt);
  const app = createApp({
    application: new InMemoryCloudMarkupApplication({}),
    authenticationClock: () => new Date(now),
    correlationIdFactory: () => "correlation-intent-accept",
    principalResolver: new FixedPrincipalResolver({
      "Bearer synthetic-owner": principal,
      "Bearer synthetic-expired": { ...principal, expiresAt: now },
    }),
    ...(enabled ? { aiIntentAcceptance: { accept, get } } : {}),
  });
  const request = (
    body: unknown = input,
    target = path,
    requestHeaders: Record<string, string> = headers,
  ) =>
    app.request(target, {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify(body),
    });
  return { app, accept, get, request };
}
describe("explicit Intent acceptance HTTP boundary", () => {
  it("passes exact candidate, original draft precondition and proof with only verified principal authority", async () => {
    const f = fixture(),
      response = await f.request();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ apiVersion: "v1", data: receipt });
    expect(f.accept).toHaveBeenCalledExactlyOnceWith(
      {
        ...principal,
        authenticationSource: "test",
        correlationId: "correlation-intent-accept",
      },
      "project_test",
      input,
      headers["if-match"],
      headers["idempotency-key"],
    );
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(apiOperationsV1["ai-intent-previews.accept"].security).toBe(
      "principal",
    );
  });
  it.each([undefined, "Bearer synthetic-expired"])(
    "authenticates before content parsing with %s",
    async (authorization) => {
      const f = fixture();
      const response = await f.app.request(path, {
        method: "POST",
        headers: authorization ? { authorization } : {},
        body: "{invalid",
      });
      expect(response.status).toBe(401);
      expect(f.accept).not.toHaveBeenCalled();
    },
  );
  it.each(["if-match", "idempotency-key"])("requires %s", async (missing) => {
    const f = fixture();
    const supplied = Object.fromEntries(
      Object.entries(headers).filter(([key]) => key !== missing),
    );
    expect((await f.request(input, path, supplied)).status).toBe(
      missing === "if-match" ? 428 : 400,
    );
    expect(f.accept).not.toHaveBeenCalled();
  });
  it.each([
    { ...input, organizationId: "org_other" },
    { ...input, outputDigest: receipt.outputDigest },
    { ...input, accepted: true },
    { ...input, contractVersion: 2 },
    { ...input, editingProof: { ...input.editingProof, token: "bad" } },
  ])("rejects injected or invalid acceptance %#", async (body) => {
    const f = fixture();
    const response = await f.request(body);
    expect(response.status).toBe(400);
    expect(f.accept).not.toHaveBeenCalled();
    expect(await response.text()).not.toContain(input.editingProof.token);
  });
  it("rejects proof-bearing queries without echoing query names or values", async () => {
    const f = fixture();
    const response = await f.request(
      input,
      path + "?" + input.editingProof.token + "=x",
    );
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain(input.editingProof.token);
    expect(f.accept).not.toHaveBeenCalled();
  });
  it("remains unavailable until the real persistence host is configured", async () => {
    expect((await fixture(false).request()).status).toBe(503);
  });
  it("preserves denied and stale authority failures from the persistence boundary", async () => {
    for (const [code, status] of [
      ["access_denied", 403],
      ["precondition_failed", 412],
      ["not_found", 404],
    ] as const) {
      const f = fixture();
      f.accept.mockRejectedValue(
        new ApplicationError(code, "The requested resource is unavailable."),
      );
      expect((await f.request()).status).toBe(status);
    }
  });
  it("reads only the explicitly selected accepted record under verified principal identity", async () => {
    const f = fixture();
    const response = await f.app.request(
      "/v1/projects/project_test/accepted-intents/accepted_intent_test",
      { headers: { authorization: headers.authorization } },
    );
    expect(response.status).toBe(200);
    expect(f.get).toHaveBeenCalledExactlyOnceWith(
      {
        ...principal,
        authenticationSource: "test",
        correlationId: "correlation-intent-accept",
      },
      "project_test",
      "accepted_intent_test",
    );
    expect(f.accept).not.toHaveBeenCalled();
  });
});
