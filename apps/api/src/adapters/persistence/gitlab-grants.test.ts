import {
  BeginTransactionCommand,
  CommitTransactionCommand,
  ExecuteStatementCommand,
  RollbackTransactionCommand,
  type RDSDataClient,
} from "@aws-sdk/client-rds-data";
import { describe, expect, it, vi } from "vitest";
import { GitLabConnectionAuthority } from "./gitlab-connection-authority.js";
import { PostgresGitLabGrants } from "./gitlab-grants.js";
import { RdsDataApiDatabase } from "./rds-data-driver.js";

const now = new Date("2026-01-01T12:00:00.000Z");
const connectionId = "gitlab_" + "a".repeat(32);
const attemptId = "gitlabrefresh_" + "b".repeat(32);

function fixture(
  rows: readonly object[],
  updated: number,
  sessionAllowed = true,
  member = true,
) {
  const reply = (command: unknown) => {
    if (command instanceof BeginTransactionCommand)
      return { transactionId: "synthetic-transaction" };
    if (
      command instanceof CommitTransactionCommand ||
      command instanceof RollbackTransactionCommand
    )
      return {};
    if (!(command instanceof ExecuteStatementCommand))
      throw new Error("Unexpected database command");
    const sql = command.input.sql ?? "";
    const records = sql.includes("cloudmarkup_account_session_allowed_v1")
      ? [{ allowed: sessionAllowed }]
      : sql.includes("SELECT m.role_key")
        ? member
          ? [{ role_key: "owner" }]
          : []
        : sql.includes("SELECT connection_id FROM gitlab_oauth_connections")
          ? rows
          : [];
    return {
      formattedRecords: JSON.stringify(records),
      numberOfRecordsUpdated: updated,
    };
  };
  const send = vi.fn((command: unknown) => Promise.resolve(reply(command)));
  const database = new RdsDataApiDatabase({
    client: { send } as unknown as RDSDataClient,
    database: "synthetic",
    resourceArn: "arn:aws:rds:us-east-1:000000000000:cluster:synthetic",
    secretArn: "arn:aws:secretsmanager:us-east-1:000000000000:secret:synthetic",
  });
  const authority = new GitLabConnectionAuthority(
    database,
    {
      principalId: "principal_synthetic",
      sessionId: "session_synthetic",
      correlationId: "correlation_synthetic",
      authenticationSource: "cognito",
      authenticatedAt: "2026-01-01T11:59:00.000Z",
      expiresAt: "2026-01-01T13:00:00.000Z",
    },
    "org_synthetic",
    () => now,
  );
  return { grants: new PostgresGitLabGrants(authority, "c".repeat(64)), send };
}

for (const operation of ["usable", "refresh-current"] as const) {
  describe(`GitLab ${operation} admission through RDS Data API`, () => {
    const invoke = (grants: PostgresGitLabGrants) =>
      operation === "usable"
        ? grants.assertUsable(connectionId, 1)
        : grants.assertRefreshCurrent(connectionId, 1, attemptId);
    it.each([
      {
        name: "returned row with zero records updated",
        rows: [{ connection_id: connectionId }],
        updated: 0,
        admitted: true,
      },
      {
        name: "returned row with a row count",
        rows: [{ connection_id: connectionId }],
        updated: 1,
        admitted: true,
      },
      { name: "missing row", rows: [], updated: 0, admitted: false },
      {
        name: "update count without a returned row",
        rows: [],
        updated: 1,
        admitted: false,
      },
      {
        name: "ambiguous duplicate rows",
        rows: [
          { connection_id: connectionId },
          { connection_id: connectionId },
        ],
        updated: 0,
        admitted: false,
      },
    ])(
      "uses returned records for $name",
      async ({ rows, updated, admitted }) => {
        const { grants, send } = fixture(rows, updated);
        if (admitted) {
          await expect(invoke(grants)).resolves.toBeUndefined();
          expect(
            send.mock.calls.some(
              ([command]) => command instanceof CommitTransactionCommand,
            ),
          ).toBe(true);
        } else {
          await expect(invoke(grants)).rejects.toMatchObject({
            code: "conflict",
          });
          expect(
            send.mock.calls.some(
              ([command]) => command instanceof RollbackTransactionCommand,
            ),
          ).toBe(true);
        }
      },
    );
    it.each([
      { sessionAllowed: false, member: true, code: "authentication_required" },
      { sessionAllowed: true, member: false, code: "not_found" },
    ])(
      "retains authority denial $code",
      async ({ sessionAllowed, member, code }) => {
        const { grants, send } = fixture(
          [{ connection_id: connectionId }],
          0,
          sessionAllowed,
          member,
        );
        await expect(invoke(grants)).rejects.toMatchObject({ code });
        expect(
          send.mock.calls.some(
            ([command]) =>
              command instanceof ExecuteStatementCommand &&
              command.input.sql?.includes(
                "SELECT connection_id FROM gitlab_oauth_connections",
              ),
          ),
        ).toBe(false);
      },
    );
  });
}
