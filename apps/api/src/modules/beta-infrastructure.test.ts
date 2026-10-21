import { describe, expect, it, vi } from "vitest";
import { createInitialArchitectureDocument } from "../application/architecture-document-storage.js";
import { createApp } from "../app.js";
import { digestCanonicalValue } from "@cloudmarkup/schemas";
import {
  FixedPrincipalResolver,
  InMemoryCloudMarkupApplication,
} from "../testing/in-memory-adapters.js";
import type { BetaInfrastructureApplication } from "../application/beta-infrastructure.js";
const at = "2026-09-17T12:00:00.000Z";
const principal = {
  principalId: "principal_beta_test",
  sessionId: "session_beta",
  authenticatedAt: at,
  expiresAt: "2026-09-17T13:00:00.000Z",
};
const architectureDocument = createInitialArchitectureDocument({
  identity: {
    architectureId: "architecture_beta_test",
    documentId: "document_beta_test",
    draftId: "draft_beta_test",
    revisionId: "revision_beta_test",
    principalId: principal.principalId,
  },
  createdAt: at,
  blank: true,
  infrastructureOnly: true,
});
const input = {
  contractVersion: 1,
  requirements: "A private file bucket",
  architectureDocument,
};
const result = {
  contractVersion: 1 as const,
  architectureDigest: digestCanonicalValue(architectureDocument),
  proposal: {
    contractVersion: 1 as const,
    summary: "A private file bucket.",
    resources: [
      {
        key: "files",
        serviceType: "aws.s3.bucket",
        label: "Files",
        parentKey: null,
      },
    ],
    connections: [],
    limitations: [],
  },
};
const headers = {
  authorization: "Bearer synthetic-owner",
  "content-type": "application/json",
  "if-match": '"draft:draft_beta_test:v1"',
};
function fixture(enabled = true) {
  const propose = vi
    .fn<BetaInfrastructureApplication["propose"]>()
    .mockResolvedValue(result);
  const app = createApp({
    application: new InMemoryCloudMarkupApplication({}),
    principalResolver: new FixedPrincipalResolver({
      "Bearer synthetic-owner": principal,
    }),
    authenticationClock: () => new Date(at),
    ...(enabled ? { betaInfrastructure: { propose } } : {}),
  });
  const request = (
    body: unknown = input,
    requestHeaders: Record<string, string> = headers,
  ) =>
    app.request(
      "/v1/projects/project_beta_test/beta-infrastructure-proposals",
      { method: "POST", headers: requestHeaders, body: JSON.stringify(body) },
    );
  return { propose, request };
}
describe("functional beta authenticated proposal route", () => {
  it("passes verified identity and current draft precondition and returns a non-cacheable typed preview", async () => {
    const f = fixture();
    const response = await f.request();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ apiVersion: "v1", data: result });
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(f.propose.mock.calls[0]?.[0]).toMatchObject({
      principalId: principal.principalId,
      authenticationSource: "test",
    });
    expect(f.propose.mock.calls[0]?.[1]).toBe("project_beta_test");
  });
  it.each([
    "unauthenticated",
    "malformed",
    "no-precondition",
    "disabled",
  ] as const)("denies %s before model application work", async (fault) => {
    const f = fixture(fault !== "disabled");
    const h: Record<string, string> = { ...headers };
    if (fault === "unauthenticated") delete h["authorization"];
    if (fault === "no-precondition") delete h["if-match"];
    const response = await f.request(
      fault === "malformed"
        ? { ...input, modelId: "caller-selected-model" }
        : input,
      h,
    );
    expect(response.status).toBe(
      {
        unauthenticated: 401,
        malformed: 400,
        "no-precondition": 428,
        disabled: 503,
      }[fault],
    );
    expect(f.propose).not.toHaveBeenCalled();
  });
});

describe("durable beta proposal HTTP routes", () => {
  function background() {
    const job = {
      contractVersion: 1 as const,
      id: "job_beta_test",
      architectureDigest: result.architectureDigest,
      state: "queued" as const,
    };
    const jobs = {
      create: vi.fn().mockResolvedValue(job),
      get: vi.fn().mockResolvedValue(job),
      credits: vi.fn().mockResolvedValue({
        contractVersion: 1,
        jobId: job.id,
        state: "reserved",
        estimatedCreditUnits: "12",
        maximumCreditUnits: "100",
      }),
      cancel: vi.fn().mockResolvedValue({ ...job, state: "canceled" }),
    };
    const app = createApp({
      application: new InMemoryCloudMarkupApplication({}),
      principalResolver: new FixedPrincipalResolver({
        "Bearer synthetic-owner": principal,
      }),
      authenticationClock: () => new Date(at),
      betaInfrastructureJobs: jobs,
    });
    const path = "/v1/projects/project_beta_test/beta-infrastructure-jobs";
    const create = (extra: Record<string, string> = {}) =>
      app.request(path, {
        method: "POST",
        headers: {
          ...headers,
          "idempotency-key": "proposal-request-test",
          ...extra,
        },
        body: JSON.stringify(input),
      });
    return { app, path, jobs, create };
  }
  it("admits a short authenticated request and returns a typed non-cacheable job", async () => {
    const f = background(),
      response = await f.create();
    expect(response.status).toBe(202);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(f.jobs.create).toHaveBeenCalledWith(
      expect.objectContaining({ principalId: principal.principalId }),
      "project_beta_test",
      input,
      headers["if-match"],
      "proposal-request-test",
    );
  });
  it("requires authentication and both idempotency and draft preconditions", async () => {
    for (const [extra, status] of [
      [{ authorization: "" }, 401],
      [{ "if-match": "" }, 400],
      [{ "idempotency-key": "" }, 400],
    ] as const) {
      const f = background();
      expect((await f.create(extra)).status).toBe(status);
      expect(f.jobs.create).not.toHaveBeenCalled();
    }
  });
  it("reads the credit receipt only through the authenticated job owner boundary", async () => {
    const f = background();
    const path = f.path + "/job_beta_test/credits";
    const denied = await f.app.request(path);
    expect(denied.status).toBe(401);
    expect(f.jobs.credits).not.toHaveBeenCalled();
    const receipt = await f.app.request(path, {
      headers: { authorization: headers.authorization },
    });
    expect(receipt.status).toBe(200);
    expect(await receipt.json()).toMatchObject({
      data: {
        state: "reserved",
        estimatedCreditUnits: "12",
        maximumCreditUnits: "100",
      },
    });
    expect(f.jobs.credits).toHaveBeenCalledWith(
      expect.objectContaining({ principalId: principal.principalId }),
      "project_beta_test",
      "job_beta_test",
    );
  });
  it("reads and cancels only through the verified principal boundary", async () => {
    const f = background();
    for (const method of ["GET", "DELETE"]) {
      const response = await f.app.request(f.path + "/job_beta_test", {
        method,
        headers: { authorization: headers.authorization },
      });
      expect(response.status).toBe(200);
    }
    expect(f.jobs.get).toHaveBeenCalledWith(
      expect.objectContaining({ principalId: principal.principalId }),
      "project_beta_test",
      "job_beta_test",
    );
    expect(f.jobs.cancel).toHaveBeenCalledWith(
      expect.objectContaining({ principalId: principal.principalId }),
      "project_beta_test",
      "job_beta_test",
    );
  });
});
