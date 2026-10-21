import { describe, expect, it } from "vitest";

import type {
  SqlDatabase,
  SqlExecutor,
  SqlResult,
  SqlRow,
  SqlStatement,
} from "../persistence/sql.js";
import { BetaCognitoPrincipalDirectory } from "./beta-cognito-principal-directory.js";

const issuer = "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_beta";
const reference = {
  issuer,
  provider: "cognito",
  subject: "subject-123",
} as const;

class RecordingDatabase implements SqlDatabase {
  readonly statements: SqlStatement[] = [];
  readonly #mappingRows: (readonly SqlRow[])[];
  transactions = 0;

  constructor(mappingRows: readonly (readonly SqlRow[])[]) {
    this.#mappingRows = [...mappingRows];
  }

  close(): Promise<void> {
    return Promise.resolve();
  }

  query<TRow extends SqlRow = SqlRow>(
    statement: SqlStatement,
  ): Promise<SqlResult<TRow>> {
    this.statements.push(statement);
    const rows = statement.text.includes("FROM principal_identity_references")
      ? ((this.#mappingRows.shift() ?? []) as readonly TRow[])
      : [];
    return Promise.resolve({ rowCount: rows.length, rows });
  }

  transaction<TResult>(
    work: (transaction: SqlExecutor) => Promise<TResult>,
  ): Promise<TResult> {
    this.transactions += 1;
    return work(this);
  }
}

describe("BetaCognitoPrincipalDirectory", () => {
  it("fails closed for a subject from a different issuer without querying", async () => {
    const database = new RecordingDatabase([]);
    const directory = new BetaCognitoPrincipalDirectory({ database, issuer });

    await expect(
      directory.resolveActivePrincipal({
        ...reference,
        issuer: "https://example.invalid/pool",
      }),
    ).resolves.toBeNull();
    expect(database.statements).toHaveLength(0);
    expect(database.transactions).toBe(0);
  });

  it("returns an existing active mapping without writing", async () => {
    const database = new RecordingDatabase([
      [{ lifecycle_status: "active", principal_id: "principal_existing" }],
    ]);
    const directory = new BetaCognitoPrincipalDirectory({ database, issuer });

    await expect(directory.resolveActivePrincipal(reference)).resolves.toEqual({
      principalId: "principal_existing",
    });
    expect(database.transactions).toBe(0);
    expect(database.statements).toHaveLength(1);
  });

  it("does not reactivate or replace a suspended principal", async () => {
    const database = new RecordingDatabase([
      [{ lifecycle_status: "suspended", principal_id: "principal_suspended" }],
    ]);
    const directory = new BetaCognitoPrincipalDirectory({ database, issuer });

    await expect(
      directory.resolveActivePrincipal(reference),
    ).resolves.toBeNull();
    expect(database.transactions).toBe(0);
  });

  it("atomically provisions deterministic owner tenancy after a subject lock", async () => {
    const database = new RecordingDatabase([
      [],
      [],
      [{ lifecycle_status: "active", principal_id: "principal_beta_result" }],
    ]);
    const directory = new BetaCognitoPrincipalDirectory({ database, issuer });

    await expect(directory.resolveActivePrincipal(reference)).resolves.toEqual({
      principalId: "principal_beta_result",
    });
    expect(database.transactions).toBe(1);
    expect(database.statements[1]?.text).toContain("pg_advisory_xact_lock");
    expect(database.statements[1]?.values).toEqual([
      expect.stringMatching(/^[0-9a-f]{64}$/u),
    ]);
    expect(database.statements[1]?.values[0]).not.toContain("\u0000");
    const principalInsert = database.statements.find((statement) =>
      statement.text.includes("INSERT INTO principals"),
    );
    const organizationInsert = database.statements.find((statement) =>
      statement.text.includes("INSERT INTO organizations"),
    );
    const roleInsert = database.statements.find((statement) =>
      statement.text.includes("INSERT INTO organization_roles"),
    );
    const membershipInsert = database.statements.find((statement) =>
      statement.text.includes("INSERT INTO memberships"),
    );
    expect(principalInsert?.values[0]).toMatch(
      /^principal_beta_[0-9a-f]{32}$/u,
    );
    expect(organizationInsert?.values[0]).toMatch(/^org_beta_[0-9a-f]{32}$/u);
    expect(roleInsert?.text).toContain(
      "cloudmarkup_authorization_v2_permissions",
    );
    expect(membershipInsert?.values).toEqual([
      expect.stringMatching(/^membership_beta_[0-9a-f]{32}$/u),
      organizationInsert?.values[0],
      principalInsert?.values[0],
    ]);
  });
});
