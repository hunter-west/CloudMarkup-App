import { describe, expect, it } from "vitest";
import type { PrincipalContext } from "../../application/ports.js";
import { permissionsForRole } from "../../application/authorization.js";
import { PostgresOrganizationInvitationRepository } from "./organization-invitations.js";
import type {
  SqlDatabase,
  SqlExecutor,
  SqlResult,
  SqlRow,
  SqlStatement,
} from "./sql.js";

const principal: PrincipalContext = {
  principalId: "principal_member",
  sessionId: "session_member",
  authenticatedAt: "2026-09-08T12:00:00.000Z",
  expiresAt: "2026-09-08T12:10:00.000Z",
  authenticationSource: "test",
  correlationId: "correlation_member",
};
const id = "invitation_10000000-0000-0000-0000-000000000001";
const input = {
  organizationId: "org_member",
  role: "editor" as const,
  tokenSha256: "a".repeat(64),
  requestSha256: "b".repeat(64),
  idempotencyKeySha256: "c".repeat(64),
};
const issuer = {
  membership_id: "membership_issuer",
  role_key: "owner",
  capabilities: permissionsForRole("owner"),
};
const invitation = {
  invitation_id: id,
  organization_id: input.organizationId,
  issuer_principal_id: principal.principalId,
  issuer_membership_id: issuer.membership_id,
  target_role: input.role,
  token_sha256: input.tokenSha256,
  request_sha256: input.requestSha256,
  lifecycle_state: "pending",
  unexpired: true,
  expires_iso: "2026-09-09T12:00:00.000Z",
};
const result = (rows: readonly SqlRow[] = []): SqlResult => ({
  rows,
  rowCount: rows.length,
});
const active = result([{ principal_id: principal.principalId }]);
const account = result([{ billing_account_id: "billing_member" }]);

/** Statement-port coverage only; actual lock/constraint behavior is in the PG suite. */
class RecordedDatabase implements SqlDatabase {
  readonly statements: SqlStatement[] = [];
  readonly #results: (SqlResult | Error)[];
  constructor(results: readonly (SqlResult | Error)[]) {
    this.#results = [...results];
  }
  close(): Promise<void> {
    return Promise.resolve();
  }
  query<TRow extends SqlRow = SqlRow>(
    statement: SqlStatement,
  ): Promise<SqlResult<TRow>> {
    this.statements.push(statement);
    const next = this.#results.shift();
    if (next === undefined)
      return Promise.reject(new Error("Missing controlled statement result."));
    return next instanceof Error
      ? Promise.reject(next)
      : Promise.resolve(next as SqlResult<TRow>);
  }
  transaction<T>(work: (tx: SqlExecutor) => Promise<T>): Promise<T> {
    return work(this);
  }
}

describe("organization invitation SQL boundary", () => {
  it("fails before tenant lookup when current principal is unavailable", async () => {
    const database = new RecordedDatabase([result()]);
    await expect(
      new PostgresOrganizationInvitationRepository(database).create(
        principal,
        input,
      ),
    ).rejects.toMatchObject({ code: "authentication_required" });
    expect(database.statements).toHaveLength(1);
    expect(database.statements[0]?.values).toEqual([
      principal.principalId,
      principal.expiresAt,
      principal.authenticatedAt,
    ]);
  });
  it("does not lock or create a billing account for a non-member", async () => {
    const database = new RecordedDatabase([active, result()]);
    await expect(
      new PostgresOrganizationInvitationRepository(database).create(
        principal,
        input,
      ),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(database.statements).toHaveLength(2);
    expect(
      database.statements.some((statement) =>
        statement.text.includes("organization_billing_accounts"),
      ),
    ).toBe(false);
  });
  it("denies a missing canonical account without inventing a plan", async () => {
    const database = new RecordedDatabase([active, result([issuer]), result()]);
    await expect(
      new PostgresOrganizationInvitationRepository(database).create(
        principal,
        input,
      ),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(database.statements.at(-1)?.text).toContain("FOR UPDATE");
    expect(
      database.statements.every(
        (statement) => !statement.text.includes("INSERT"),
      ),
    ).toBe(true);
  });
  it("serializes through the account before locked identity and exact replay", async () => {
    const database = new RecordedDatabase([
      active,
      result([issuer]),
      account,
      active,
      result([issuer]),
      result([invitation]),
      active,
    ]);
    const actor = { ...principal };
    const promise = new PostgresOrganizationInvitationRepository(
      database,
    ).create(actor, input);
    actor.principalId = "principal_changed";
    actor.expiresAt = "2099-01-01T00:00:00.000Z";
    await expect(promise).resolves.toMatchObject({ id, status: "pending" });
    expect(database.statements[2]?.text).toContain(
      "organization_billing_accounts",
    );
    expect(database.statements[2]?.text).toContain("FOR UPDATE");
    expect(database.statements[3]?.text).toContain("FOR SHARE");
    expect(database.statements[4]?.text).toContain("FOR SHARE OF m,p,o,r");
    expect(database.statements[4]?.text).toContain(
      "cloudmarkup_authorization_v2_permissions",
    );
    expect(database.statements[5]?.values).toEqual([
      input.organizationId,
      principal.principalId,
      input.idempotencyKeySha256,
    ]);
    expect(JSON.stringify(database.statements)).not.toContain(
      "principal_changed",
    );
    expect(JSON.stringify(database.statements)).not.toContain("2099-");
  });
  it.each([
    "request_sha256",
    "token_sha256",
    "target_role",
    "issuer_membership_id",
  ])("binds replay to the exact %s", async (field) => {
    const database = new RecordedDatabase([
      active,
      result([issuer]),
      account,
      active,
      result([issuer]),
      result([{ ...invitation, [field]: "changed" }]),
    ]);
    await expect(
      new PostgresOrganizationInvitationRepository(database).create(
        principal,
        input,
      ),
    ).rejects.toMatchObject({ code: "idempotency_key_reused" });
    expect(
      database.statements.every(
        (statement) => !statement.text.includes("INSERT"),
      ),
    ).toBe(true);
  });
  it("denies absent current plan and includes exact source/version/time/feature predicates", async () => {
    const database = new RecordedDatabase([
      active,
      result([issuer]),
      account,
      active,
      result([issuer]),
      result(),
      result(),
    ]);
    await expect(
      new PostgresOrganizationInvitationRepository(database).create(
        principal,
        input,
      ),
    ).rejects.toMatchObject({ code: "access_denied" });
    const query = database.statements.at(-1);
    if (query === undefined) throw new Error("Missing plan statement.");
    expect(query.values).toEqual([input.organizationId]);
    for (const predicate of [
      "snapshot.source_record_version=subscription.record_version",
      "snapshot.plan_version_id=subscription.plan_version_id",
      "subscription.billable_seat_quantity=1",
      "subscription.current_period_end>clock_timestamp()",
      "snapshot.effective_at<=clock_timestamp()",
      "'shared-projects','organization-roles'",
    ])
      expect(query.text).toContain(predicate);
    expect(
      database.statements.every(
        (statement) => !statement.text.includes("INSERT"),
      ),
    ).toBe(true);
  });
  it("hides unknown invitation secrets before locking tenant state", async () => {
    const database = new RecordedDatabase([active, result()]);
    await expect(
      new PostgresOrganizationInvitationRepository(database).accept(
        principal,
        id,
        input.tokenSha256,
      ),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(database.statements[1]?.values).toEqual([id, input.tokenSha256]);
    expect(database.statements).toHaveLength(2);
  });
  it("never returns driver details containing metadata or tokens", async () => {
    const database = new RecordedDatabase([
      new Error("SQL DETAIL private token and parameters"),
    ]);
    const failure: unknown = await new PostgresOrganizationInvitationRepository(
      database,
    )
      .accept(principal, id, input.tokenSha256)
      .catch((error: unknown) => error);
    expect(failure).toMatchObject({
      code: "service_unavailable",
      message: "The invitation request could not be completed. Try again.",
    });
    expect(String(failure)).not.toContain("SQL DETAIL");
    expect(String(failure)).not.toContain("parameters");
  });
});
