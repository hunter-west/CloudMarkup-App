import { describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import {
  InMemoryCloudMarkupApplication,
  FixedPrincipalResolver,
} from "./testing/in-memory-adapters.js";
import { InMemoryObjectStore } from "./adapters/persistence/memory-object-store.js";
import type {
  SqlDatabase,
  SqlExecutor,
  SqlResult,
  SqlRow,
  SqlStatement,
} from "./adapters/persistence/sql.js";
import { ApplicationError } from "./application/errors.js";
import type { PrincipalContext } from "./application/ports.js";
import { createProductionSolutionExportReads } from "./production-solution-export-reads.js";

const now = new Date();
const principal: PrincipalContext = {
  authenticatedAt: now.toISOString(),
  authenticationSource: "test",
  correlationId: "correlation_read",
  expiresAt: new Date(now.getTime() + 3600000).toISOString(),
  principalId: "principal_read",
  sessionId: "session_read",
};
const projectId = "project_read";
const artifactId = "solutionartifact_read";
const artifactPath = `/v1/projects/${projectId}/solution-export-artifacts/${artifactId}`;
const requests = [
  {
    method: "GET",
    path: `/v1/projects/${projectId}/solution-export-jobs/solutionexport_read`,
  },
  { method: "GET", path: artifactPath },
  { method: "GET", path: `${artifactPath}/files/solutionfile_read/preview` },
  { method: "GET", path: `${artifactPath}/diff` },
  { method: "POST", path: `${artifactPath}/download-grants` },
  {
    method: "GET",
    path: `${artifactPath}/download-grants/downloadgrant_read/content`,
  },
] as const;
function fixture(
  resolve: (
    actor: PrincipalContext,
    project: string,
  ) => Promise<string | null> = () => Promise.resolve(null),
) {
  const touched = vi.fn();
  const database: SqlDatabase = {
    close: () => Promise.resolve(),
    transaction: <T>(work: (tx: SqlExecutor) => Promise<T>) => work(database),
    query<TRow extends SqlRow>(
      _statement: SqlStatement,
    ): Promise<SqlResult<TRow>> {
      void _statement;
      touched();
      return Promise.reject(
        new Error("Synthetic SQL is intentionally unavailable."),
      );
    },
  };
  const identity = { organizationForProject: vi.fn(resolve) };
  const reads = createProductionSolutionExportReads({
    database,
    identity,
    objectStore: new InMemoryObjectStore(),
    clock: () => now,
  });
  const app = createApp({
    application: new InMemoryCloudMarkupApplication({}),
    solutionExportReads: reads,
    authenticationClock: () => now,
    principalResolver: new FixedPrincipalResolver({
      "Bearer synthetic-read": principal,
    }),
  });
  const request = (
    path: string,
    method = "GET",
    token = "Bearer synthetic-read",
  ) =>
    app.request(path, {
      method,
      headers: {
        authorization: token,
        "content-type": "application/json",
        "idempotency-key": "synthetic-request",
      },
      ...(method === "POST"
        ? { body: JSON.stringify({ contractVersion: 1 }) }
        : {}),
    });
  return { identity, reads, app, request, touched };
}
describe("production solution export read-only composition", () => {
  it.each(requests)(
    "requires authentication before $method $path",
    async ({ path, method }) => {
      const h = fixture();
      expect(
        (await h.request(path, method, "Bearer unrecognized")).status,
      ).toBe(401);
      expect(h.identity.organizationForProject).not.toHaveBeenCalled();
      expect(h.touched).not.toHaveBeenCalled();
    },
  );
  it.each(requests)(
    "conceals foreign ownership before $method $path",
    async ({ path, method }) => {
      const h = fixture();
      const response = await h.request(path, method);
      expect(response.status).toBe(404);
      expect(h.identity.organizationForProject).toHaveBeenCalledTimes(1);
      expect(h.touched).not.toHaveBeenCalled();
    },
  );
  it("snapshots the verified principal before awaiting ownership resolution", async () => {
    let release: ((value: string | null) => void) | undefined;
    const h = fixture(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const supplied = { ...principal };
    const pending = h.reads.getArtifact(supplied, projectId, artifactId);
    supplied.principalId = "principal_changed";
    const observed = h.identity.organizationForProject.mock.calls[0]?.[0];
    expect(observed).toMatchObject({
      principalId: principal.principalId,
      sessionId: principal.sessionId,
    });
    expect(Object.isFrozen(observed)).toBe(true);
    release?.(null);
    await expect(pending).rejects.toMatchObject({ code: "not_found" });
  });
  it("fails closed on expired authentication before any durable query", async () => {
    const h = fixture(() => Promise.resolve("org_read"));
    await expect(
      h.reads.getArtifact(
        { ...principal, expiresAt: new Date(now.getTime() - 1).toISOString() },
        projectId,
        artifactId,
      ),
    ).rejects.toMatchObject({ code: "authentication_required" });
    expect(h.touched).not.toHaveBeenCalled();
  });
  it("translates unavailable persistence without leaking underlying errors", async () => {
    const h = fixture(() => Promise.resolve("org_read"));
    const response = await h.request(artifactPath);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("Synthetic SQL");
  });
  it("preserves explicit current-authority denials", async () => {
    const h = fixture(() =>
      Promise.reject(new ApplicationError("access_denied", "Access denied.")),
    );
    expect((await h.request(artifactPath)).status).toBe(403);
  });
  it("does not fabricate create or cancellation implementations for read registration", async () => {
    const h = fixture();
    const cancel = await h.request(
      `/v1/projects/${projectId}/solution-export-jobs/solutionexport_read/cancel`,
      "POST",
    );
    expect(cancel.status).toBe(503);
    const create = await h.app.request(
      `/v1/projects/${projectId}/solution-export-jobs`,
      {
        method: "POST",
        headers: {
          authorization: "Bearer synthetic-read",
          "content-type": "application/json",
          "idempotency-key": "synthetic-create",
        },
        body: JSON.stringify({
          contractVersion: 1,
          environment: { environmentType: "development" },
          exportName: "Synthetic export",
          solutionRevisionId: "solutionrevision_read",
          targetProfileId: "cloudmarkup.export.terraform-nodejs24-v1",
        }),
      },
    );
    expect(create.status).toBe(503);
    expect(h.identity.organizationForProject).not.toHaveBeenCalled();
  });
});
