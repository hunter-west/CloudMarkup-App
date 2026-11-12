import { describe, expect, it } from "vitest";
import {
  applyStaffProviderCostAuthorization,
  prepareStaffProviderCostAuthorization,
  type StaffProviderCostOperatorInput,
} from "./platform-operator.js";
import type {
  SqlDatabase,
  SqlExecutor,
  SqlResult,
  SqlRow,
  SqlStatement,
} from "./sql.js";

const input: StaffProviderCostOperatorInput = {
  issuer: "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_Synthetic",
  subject: "synthetic-subject",
  principalId: "principal_scope",
  organizationId: "org_scope",
  operatorReference: "synthetic-operator",
  reason: "Explicit synthetic accounting access",
  action: "authorized",
};
class OperatorDatabase implements SqlDatabase {
  globalVersion = "2";
  globalAllowed = true;
  scope: SqlRow | null = null;
  events: readonly unknown[][] = [];
  failAudit = false;
  close() {
    return Promise.resolve();
  }
  async transaction<T>(work: (tx: SqlExecutor) => Promise<T>): Promise<T> {
    const scope = this.scope,
      events = this.events;
    try {
      return await work(this);
    } catch (error) {
      this.scope = scope;
      this.events = events;
      throw error;
    }
  }
  query<T extends SqlRow = SqlRow>(
    statement: SqlStatement,
  ): Promise<SqlResult<T>> {
    let rows: SqlRow[] = [];
    const t = statement.text;
    if (t.includes("principal_identity_references"))
      rows = [{ principal_id: input.principalId, lifecycle_status: "active" }];
    else if (t.includes("FROM platform_staff_authorizations"))
      rows = [
        {
          permissions: this.globalAllowed
            ? ["provider-costs.read"]
            : ["accounts.read"],
          record_version: this.globalVersion,
          revoked: false,
        },
      ];
    else if (t.includes("FROM organizations"))
      rows = [
        { organization_id: statement.values[0], lifecycle_status: "active" },
      ];
    else if (t.includes("FROM platform_staff_provider_cost_authorizations"))
      rows = this.scope === null ? [] : [this.scope];
    else if (
      t.includes("pg_advisory_xact_lock") ||
      t.includes("FROM principals WHERE")
    )
      rows = [];
    else if (
      t.startsWith("INSERT INTO platform_staff_provider_cost_authorizations(")
    ) {
      expect(statement.values.slice(0, 2)).toEqual([
        input.principalId,
        input.organizationId,
      ]);
      this.scope = {
        staff_authorization_version: statement.values[2],
        record_version: String(Number(this.scope?.["record_version"] ?? 0) + 1),
        revoked: statement.values[3] === "revoked",
      };
    } else if (
      t.startsWith(
        "INSERT INTO platform_staff_provider_cost_authorization_events(",
      )
    ) {
      if (this.failAudit)
        return Promise.reject(Error("Synthetic audit failure"));
      this.events = [...this.events, [...statement.values]];
    } else throw Error("Unexpected operator fixture SQL");
    return Promise.resolve({ rows, rowCount: rows.length } as SqlResult<T>);
  }
}
describe("explicit provider-cost organization operator grant", () => {
  it("requires a current global reporting permission and an exact scoped preview, with atomic audit and revocation", async () => {
    const db = new OperatorDatabase();
    db.globalAllowed = false;
    await expect(
      prepareStaffProviderCostAuthorization(db, input),
    ).rejects.toThrow("preconditions");
    expect(db.scope).toBeNull();
    db.globalAllowed = true;
    const preview = await prepareStaffProviderCostAuthorization(db, input);
    expect(preview).toMatchObject({
      organizationId: input.organizationId,
      staffAuthorizationVersion: "2",
    });
    expect(db.scope).toBeNull();
    expect(db.events).toHaveLength(0);
    await expect(
      applyStaffProviderCostAuthorization(
        db,
        { ...input, organizationId: "org_other" },
        preview.digest,
      ),
    ).rejects.toThrow("preconditions");
    db.failAudit = true;
    await expect(
      applyStaffProviderCostAuthorization(db, input, preview.digest),
    ).rejects.toThrow("Synthetic audit failure");
    expect(db.scope).toBeNull();
    expect(db.events).toHaveLength(0);
    db.failAudit = false;
    await applyStaffProviderCostAuthorization(db, input, preview.digest);
    expect(db.scope).toMatchObject({
      staff_authorization_version: "2",
      revoked: false,
    });
    expect(db.events).toHaveLength(1);
    await expect(
      applyStaffProviderCostAuthorization(db, input, preview.digest),
    ).rejects.toThrow("preconditions");
    const revoke = { ...input, action: "revoked" as const };
    await applyStaffProviderCostAuthorization(
      db,
      revoke,
      (await prepareStaffProviderCostAuthorization(db, revoke)).digest,
    );
    expect(db.scope).toMatchObject({ revoked: true });
    expect(db.events).toHaveLength(2);
  });
});
