import { describe, expect, it } from "vitest";

import type {
  SqlDatabase,
  SqlExecutor,
  SqlResult,
  SqlRow,
  SqlStatement,
} from "../persistence/sql.js";
import { PostgresAuthorizationStore } from "./postgres-authorization-store.js";
import { PostgresPrincipalDirectory } from "./postgres-principal-directory.js";

class RecordingDatabase implements SqlDatabase {
  readonly statements: SqlStatement[] = [];
  readonly #results: SqlResult[];

  constructor(results: readonly SqlResult[]) {
    this.#results = [...results];
  }

  close(): Promise<void> {
    return Promise.resolve();
  }

  query<TRow extends SqlRow = SqlRow>(
    statement: SqlStatement,
  ): Promise<SqlResult<TRow>> {
    this.statements.push(statement);
    const result = this.#results.shift();
    if (result === undefined) {
      throw new Error("Missing controlled SQL result.");
    }
    return Promise.resolve(result as SqlResult<TRow>);
  }

  transaction<TResult>(
    work: (transaction: SqlExecutor) => Promise<TResult>,
  ): Promise<TResult> {
    return work(this);
  }
}

function result(rows: readonly SqlRow[] = []): SqlResult {
  return { rowCount: rows.length, rows };
}

describe("PostgreSQL identity and authorization adapters", () => {
  it("parameterizes external identity references and returns only active application principals", async () => {
    const subject = "subject'); DROP TABLE principals; --";
    const database = new RecordingDatabase([
      result([{ principal_id: "principal_active" }]),
    ]);
    const directory = new PostgresPrincipalDirectory(database);

    await expect(
      directory.resolveActivePrincipal({
        issuer: "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_example",
        provider: "cognito",
        subject,
      }),
    ).resolves.toEqual({ principalId: "principal_active" });
    expect(database.statements[0]?.values).toEqual([
      "cognito",
      "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_example",
      subject,
    ]);
    expect(database.statements[0]?.text).not.toContain(subject);
    expect(database.statements[0]?.text).toContain(
      "p.lifecycle_status = 'active'",
    );
  });

  it("parameterizes current membership and exact object selectors", async () => {
    const database = new RecordingDatabase([
      result([
        {
          membership_id: "membership_a",
          role_key: "administrator",
          status: "active",
        },
      ]),
      result([
        {
          object_id: "export_a",
          organization_id: "org_a",
          project_id: "project_a",
        },
      ]),
    ]);
    const store = new PostgresAuthorizationStore(database);

    await expect(store.getMembership("principal_a", "org_a")).resolves.toEqual({
      membershipId: "membership_a",
      role: "administrator",
      status: "active",
    });
    await expect(store.getJob("export", "export_a")).resolves.toEqual({
      objectId: "export_a",
      organizationId: "org_a",
      projectId: "project_a",
    });
    expect(database.statements.map((statement) => statement.values)).toEqual([
      ["principal_a", "org_a"],
      ["export_a"],
    ]);
    expect(database.statements[0]?.text).not.toContain("principal_a");
    expect(database.statements[1]?.text).not.toContain("export_a");
  });
});
