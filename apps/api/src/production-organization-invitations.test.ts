import { describe, expect, it, vi } from "vitest";
import type {
  SqlDatabase,
  SqlExecutor,
  SqlStatement,
} from "./adapters/persistence/sql.js";
import { createProductionOrganizationInvitations } from "./production-organization-invitations.js";

describe("production invitation factory", () => {
  it("uses real SQL authority and never substitutes an in-memory member or raw token", async () => {
    const query = vi
      .fn<(statement: SqlStatement) => Promise<never>>()
      .mockRejectedValue(new Error("Synthetic database unavailable."));
    const database: SqlDatabase = {
      query,
      close: () => Promise.resolve(),
      transaction: <T>(work: (tx: SqlExecutor) => Promise<T>) =>
        work({ query }),
    };
    const now = "2026-09-07T18:00:00.000Z";
    const application = createProductionOrganizationInvitations(
      database,
      () => new Date(now),
    );
    const token = "A".repeat(43);
    const actor = {
      principalId: "principal_test",
      sessionId: "session_test",
      authenticationSource: "test" as const,
      correlationId: "correlation_test",
      authenticatedAt: now,
      expiresAt: "2026-09-07T18:10:00.000Z",
    };
    await expect(
      application.create(
        actor,
        "org_test",
        { contractVersion: 1, role: "editor", token },
        "attempt-test",
      ),
    ).rejects.toMatchObject({ code: "service_unavailable" });
    expect(query).toHaveBeenCalled();
    expect(JSON.stringify(query.mock.calls)).not.toContain(token);
  });
  it("does not reach SQL for expired authentication", async () => {
    const query = vi
      .fn<(statement: SqlStatement) => Promise<never>>()
      .mockRejectedValue(new Error("Unexpected synthetic SQL request."));
    const database: SqlDatabase = {
      query,
      close: () => Promise.resolve(),
      transaction: <T>(work: (tx: SqlExecutor) => Promise<T>) =>
        work({ query }),
    };
    const now = "2026-09-07T18:00:00.000Z";
    const application = createProductionOrganizationInvitations(
      database,
      () => new Date(now),
    );
    await expect(
      application.accept(
        {
          principalId: "principal_test",
          sessionId: "session_test",
          authenticationSource: "test",
          correlationId: "correlation_test",
          authenticatedAt: now,
          expiresAt: now,
        },
        "invitation_12345678-1234-4234-8234-123456789abc",
        { contractVersion: 1, token: "A".repeat(43) },
      ),
    ).rejects.toMatchObject({ code: "authentication_required" });
    expect(query).not.toHaveBeenCalled();
  });
});
