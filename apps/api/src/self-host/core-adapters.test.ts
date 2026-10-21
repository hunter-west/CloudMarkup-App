import { describe, expect, it, vi } from "vitest";
import { createSelfHostCoreAdapters } from "./core-adapters.js";
import type { SelfHostConfiguration } from "./configuration.js";
import type { SelfHostCredentialResolver } from "./configuration.js";
import type {
  SqlDatabase,
  SqlResult,
  SqlRow,
  SqlStatement,
} from "../adapters/persistence/sql.js";

const origin = "http://127.0.0.1:4317";
const configuration = {
  server: { host: "127.0.0.1", publicOrigin: origin },
  issuer: null,
  identity: {
    mode: "local-owner",
    ownerPrincipalId: "principal_local_owner",
    operatorSecretReference: "operator.owner",
  },
} as SelfHostConfiguration;
function fixture(active = true) {
  const statements: SqlStatement[] = [];
  const close = vi.fn(() => Promise.resolve());
  const database: SqlDatabase = {
    close,
    transaction: async (work) => work(database),
    query<TRow extends SqlRow>(
      statement: SqlStatement,
    ): Promise<SqlResult<TRow>> {
      statements.push(statement);
      const rows: SqlRow[] =
        statement.text.includes("FROM principals WHERE") && active
          ? [{ principal_id: "principal_local_owner" }]
          : [];
      return Promise.resolve({
        rows: rows as readonly TRow[],
        rowCount: rows.length,
      });
    },
  };
  return { database, statements, close };
}
describe("concrete standalone identity composition", () => {
  it("loads the server proof and admits the real local composition without provisioning an identity", async () => {
    const f = fixture();
    const resolveCredential = vi.fn<SelfHostCredentialResolver>(() =>
      Promise.resolve(Buffer.alloc(32, 7).toString("base64url")),
    );
    const core = await createSelfHostCoreAdapters({
      configuration,
      database: f.database,
      resolveCredential,
      signal: new AbortController().signal,
    });
    await core.assertReady();
    expect(core.api.accountSessions?.mode).toBe("local-owner");
    expect(core.api.localOwnerSessions?.publicOrigin).toBe(origin);
    expect(core.api.browserSessions).toBeUndefined();
    expect(core.api.accountAuthenticator).toBeUndefined();
    expect(core.api.runtimeConfig).toBeUndefined();
    expect(
      await core.api.principalResolver.resolve("Bearer forged.token"),
    ).toBeNull();
    expect(resolveCredential.mock.calls[0]?.[0]).toBe("operator.owner");
    expect(
      f.statements.every(
        (s) =>
          s.text.startsWith("SELECT") &&
          s.values[0] === "principal_local_owner",
      ),
    ).toBe(true);
    expect(f.close).not.toHaveBeenCalled();
  });
  it("refuses missing owner, malformed proof and actual non-loopback listener without granting or provisioning", async () => {
    for (const scenario of [
      {
        active: false,
        proof: Buffer.alloc(32, 7).toString("base64url"),
        host: "127.0.0.1",
      },
      { active: true, proof: "not-a-canonical-proof", host: "127.0.0.1" },
      {
        active: true,
        proof: Buffer.alloc(32, 7).toString("base64url"),
        host: "0.0.0.0",
      },
    ]) {
      const f = fixture(scenario.active);
      await expect(
        createSelfHostCoreAdapters({
          configuration: {
            ...configuration,
            server: {
              ...configuration.server,
              host: scenario.host as "127.0.0.1" | "0.0.0.0",
            },
          },
          database: f.database,
          resolveCredential: () => Promise.resolve(scenario.proof),
          signal: new AbortController().signal,
        }),
      ).rejects.toThrow();
      expect(f.statements.every((s) => s.text.startsWith("SELECT"))).toBe(true);
    }
  });
});
