import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import type {
  BillingCheckoutAttempt,
  BillingCheckoutSession,
} from "../../application/billing-checkout.js";
import type { AuthorizedOrganizationScope } from "../../application/persistence.js";
import { PostgresBillingPersistence } from "./billing-persistence.js";
import { splitPostgresStatements } from "./migrations.js";
import type {
  SqlDatabase,
  SqlExecutor,
  SqlResult,
  SqlRow,
  SqlStatement,
} from "./sql.js";

class Database implements SqlDatabase {
  readonly statements: SqlStatement[] = [];
  readonly modeChecks: SqlStatement[] = [];
  readonly results: SqlResult[];
  transactionActive = false;
  constructor(rows: readonly (readonly SqlRow[])[]) {
    this.results = rows.map((values) => ({
      rows: values,
      rowCount: values.length,
    }));
  }
  close() {
    return Promise.resolve();
  }
  query<T extends SqlRow>(statement: SqlStatement): Promise<SqlResult<T>> {
    if (!this.transactionActive)
      throw new Error("Expected short authorized transaction");
    if (statement.text.includes("FROM billing_provider_cutovers")) {
      this.modeChecks.push(statement);
      return Promise.resolve({ rows: [], rowCount: 0 });
    }
    this.statements.push(statement);
    const result = this.results.shift();
    if (result === undefined) throw new Error("Missing synthetic SQL result");
    return Promise.resolve(result as SqlResult<T>);
  }
  async transaction<T>(work: (tx: SqlExecutor) => Promise<T>): Promise<T> {
    this.transactionActive = true;
    try {
      return await work(this);
    } finally {
      this.transactionActive = false;
    }
  }
}
const scope: AuthorizedOrganizationScope = {
  capabilities: ["billing.manage"],
  correlationId: "correlation_checkout",
  membershipId: "membership_checkout",
  organizationId: "organization_checkout",
  principalId: "principal_checkout",
  roleKey: "owner",
  sessionId: "session_checkout",
};
const account = {
  billing_account_id: "billing_checkout",
  organization_id: scope.organizationId,
  lifecycle_status: "active",
  expensive_operations_enabled: true,
};
const attempt: BillingCheckoutAttempt = {
  attemptId: "checkout_" + "a".repeat(32),
  billingAccountId: "billing_checkout",
  organizationId: scope.organizationId,
  requestKeySha256: "b".repeat(64),
  requestSha256: "c".repeat(64),
  recordVersion: "1",
  state: "pending",
  retryBefore: "2026-09-06T11:00:00.000Z",
};
function row(value = attempt): SqlRow {
  return {
    attempt_id: value.attemptId,
    billing_account_id: value.billingAccountId,
    organization_id: value.organizationId,
    request_key_sha256: value.requestKeySha256,
    request_sha256: value.requestSha256,
    record_version: value.recordVersion,
    lifecycle_status: value.state,
    retry_before: value.retryBefore,
    provider_session_reference: value.providerSessionReference,
    provider_expires_at: value.providerExpiresAt,
  };
}
const session: BillingCheckoutSession = {
  billingAccountId: attempt.billingAccountId,
  organizationId: scope.organizationId,
  expiresAt: "2026-09-06T12:00:00.000Z",
  providerSessionReference: "cs_test_checkout",
  providerSubscriptionReference: null,
  status: "open",
  url: "https://checkout.stripe.com/c/pay/test",
};

describe("durable Checkout account guard SQL", () => {
  it("locks current canonical identity and the billing account before claiming, with SQL-owned retry times", async () => {
    const database = new Database([[account], [account], [], [row()]]);
    await expect(
      new PostgresBillingPersistence(database).claimCheckoutAttempt(
        scope,
        attempt,
      ),
    ).resolves.toEqual(attempt);
    const lock = database.statements[0];
    expect(lock?.text).toContain(
      "FOR UPDATE OF account FOR SHARE OF membership, principal, organization, role",
    );
    expect(lock?.text).toContain("role.policy_version = 'authorization-v2'");
    expect(lock?.text).toContain("'billing.manage' = ANY(role.capabilities)");
    expect(lock?.values).toEqual([
      scope.membershipId,
      scope.principalId,
      scope.organizationId,
      "test",
    ]);
    expect(database.statements[1]?.text).not.toContain("FOR UPDATE");
    expect(database.statements.at(-1)?.text).not.toContain("23 hours");
    expect(database.transactionActive).toBe(false);
    expect(database.modeChecks.length).toBeGreaterThan(0);
  });
  it("returns an existing open attempt across distinct browser keys without inserting another", async () => {
    const database = new Database([[account], [account], [row()]]);
    const found = await new PostgresBillingPersistence(
      database,
    ).claimCheckoutAttempt(scope, {
      ...attempt,
      requestKeySha256: "d".repeat(64),
    });
    expect(found.requestKeySha256).toBe(attempt.requestKeySha256);
    expect(
      database.statements.some((statement) =>
        statement.text.includes("INSERT"),
      ),
    ).toBe(false);
  });
  it.each(["missing membership", "inactive account", "wrong account"] as const)(
    "denies %s before writing",
    async (kind) => {
      const database = new Database([
        kind === "missing membership"
          ? []
          : [
              {
                ...account,
                ...(kind === "inactive account"
                  ? { lifecycle_status: "closed" }
                  : { billing_account_id: "billing_other" }),
              },
            ],
      ]);
      await expect(
        new PostgresBillingPersistence(database).claimCheckoutAttempt(
          scope,
          attempt,
        ),
      ).rejects.toThrow();
      expect(database.statements).toHaveLength(1);
    },
  );
  it("rejects a subscription that appeared while waiting for the account lock", async () => {
    const database = new Database([
      [account],
      [{ ...account, current_subscription_state: "active" }],
    ]);
    await expect(
      new PostgresBillingPersistence(database).claimCheckoutAttempt(
        scope,
        attempt,
      ),
    ).rejects.toThrow();
    expect(database.statements).toHaveLength(2);
  });
  it("persists exact provider evidence idempotently and never stores a hosted URL", async () => {
    const created: BillingCheckoutAttempt = {
      ...attempt,
      state: "created",
      recordVersion: "2",
      providerSessionReference: session.providerSessionReference,
      providerExpiresAt: session.expiresAt,
    };
    const database = new Database([
      [account],
      [account],
      [row()],
      [row(created)],
    ]);
    await expect(
      new PostgresBillingPersistence(database).recordCheckoutSession(
        scope,
        attempt,
        session,
      ),
    ).resolves.toEqual(created);
    expect(database.statements.at(-1)?.values).not.toContain(session.url);
    const replay = new Database([[account], [account], [row(created)]]);
    await expect(
      new PostgresBillingPersistence(replay).recordCheckoutSession(
        scope,
        attempt,
        session,
      ),
    ).resolves.toEqual(created);
    expect(
      replay.statements.some((statement) =>
        statement.text.startsWith("UPDATE"),
      ),
    ).toBe(false);
  });
  it("rejects cross-tenant evidence before SQL access and will not retire an unknown attempt", async () => {
    const database = new Database([]);
    const persistence = new PostgresBillingPersistence(database);
    await expect(
      persistence.recordCheckoutSession(scope, attempt, {
        ...session,
        organizationId: "organization_other",
      }),
    ).rejects.toThrow();
    await expect(
      persistence.retireCheckoutAttempt(scope, attempt, {
        ...session,
        status: "expired",
        url: null,
      }),
    ).rejects.toThrow();
    expect(database.statements).toHaveLength(0);
  });
  it("requires exact canceled-subscription proof before consuming a completed session", async () => {
    const created: BillingCheckoutAttempt = {
      ...attempt,
      state: "created",
      recordVersion: "2",
      providerSessionReference: session.providerSessionReference,
      providerExpiresAt: session.expiresAt,
    };
    const database = new Database([
      [account],
      [
        {
          ...account,
          current_subscription_state: "canceled",
          current_subscription_reference: "sub_other",
        },
      ],
    ]);
    await expect(
      new PostgresBillingPersistence(database).retireCheckoutAttempt(
        scope,
        created,
        {
          ...session,
          status: "complete",
          providerSubscriptionReference: "sub_exact",
          url: null,
        },
      ),
    ).rejects.toThrow();
    expect(database.statements).toHaveLength(2);
  });
  it("adds a partial unique guard and retained, immutable request evidence without entitlement changes", async () => {
    const source = await readFile(
      new URL(
        "../../../migrations/0021_billing_checkout_attempts.sql",
        import.meta.url,
      ),
      "utf8",
    );
    expect(splitPostgresStatements(source)).toHaveLength(4);
    expect(source).toContain(
      "CREATE UNIQUE INDEX billing_checkout_one_open_attempt",
    );
    expect(source).toContain(
      "WHERE lifecycle_status IN ('pending', 'created')",
    );
    expect(source).toContain("Checkout attempt evidence is retained");
    expect(source).toContain("OLD.request_key_sha256, OLD.request_sha256");
    expect(source).not.toMatch(
      /(?:INSERT INTO|UPDATE|ALTER TABLE) (?:credit_|organization_subscription|organization_billing)/u,
    );
  });
});
