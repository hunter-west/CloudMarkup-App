import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  digestStructuredValue,
  ModelRuntimeControlError,
} from "@cloudmarkup/model-gateway";
import { modelRuntimeAdmissionDecisionV1Schema } from "@cloudmarkup/schemas";
import { PostgresModelRuntimeAdmissionStore } from "./model-runtime-admission-store.js";
import {
  runtimeAdmissionFixture,
  runtimeTestId,
} from "./model-runtime-admission-test-helpers.js";
import {
  admissionJson,
  parseRuntimeRecord,
} from "./model-runtime-admission-codec.js";
import { runMigrations } from "./migrations.js";
import { loadHistoricalBetaMigrations } from "./historical-beta-migrations-test-helper.js";
import { PostgresDatabase } from "./postgres-driver.js";
import {
  sql,
  type SqlDatabase,
  type SqlExecutor,
  type SqlRow,
  type SqlStatement,
} from "./sql.js";

const configured = process.env["CLOUDMARKUP_TEST_DATABASE_URL"]?.trim();
const integration =
  configured === undefined || configured === "" ? describe.skip : describe;
const suffix = randomUUID().replaceAll("-", "");
const schemaName = `cm_runtime_admission_${suffix}`;
const marker = `CloudMarkup synthetic runtime admission ${suffix}`;
function loopback() {
  if (!configured) throw new Error("Explicit synthetic database required.");
  const url = new URL(configured);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.search !== "" ||
    url.hash !== "" ||
    !/^\/[A-Za-z][A-Za-z0-9_]{0,62}$/u.test(url.pathname)
  )
    throw new Error("Explicit loopback database without overrides required.");
  return configured;
}
integration("normal runtime admission on real PostgreSQL", () => {
  let admin: PostgresDatabase | undefined;
  let database: PostgresDatabase;
  let opened: PostgresDatabase | undefined;
  let created = false;
  beforeAll(async () => {
    const connectionString = loopback();
    if (!/^cm_runtime_admission_[a-f0-9]{32}$/u.test(schemaName))
      throw new Error("Unsafe schema.");
    admin = new PostgresDatabase({
      connectionString,
      max: 1,
      connectionTimeoutMillis: 5000,
    });
    await admin.transaction(async (tx) => {
      await tx.query(sql(`CREATE SCHEMA "${schemaName}"`));
      await tx.query(sql(`COMMENT ON SCHEMA "${schemaName}" IS '${marker}'`));
    });
    created = true;
    database = new PostgresDatabase({
      connectionString,
      max: 5,
      connectionTimeoutMillis: 5000,
      options: `-c search_path=${schemaName} -c timezone=UTC -c statement_timeout=5000`,
    });
    opened = database;
    const migrations = await loadHistoricalBetaMigrations(
      fileURLToPath(new URL("../../../migrations", import.meta.url)),
    );
    await runMigrations(database, migrations);
    await runMigrations(database, migrations);
  }, 60000);
  afterAll(async () => {
    try {
      await opened?.close();
      if (created && admin !== undefined) {
        const found = await admin.query(
          sql(
            "SELECT obj_description(oid,'pg_namespace') AS marker FROM pg_namespace WHERE nspname=$1",
            [schemaName],
          ),
        );
        if (
          found.rows[0]?.["marker"] !== marker ||
          !/^cm_runtime_admission_[a-f0-9]{32}$/u.test(schemaName)
        )
          throw new Error("Refusing unverified schema cleanup.");
        await admin.transaction(async (tx) => {
          await tx.query(sql(`DROP SCHEMA "${schemaName}" CASCADE`));
        });
      }
    } finally {
      await admin?.close();
    }
  }, 30000);
  async function fixture() {
    const f = runtimeAdmissionFixture();
    await database.transaction(async (tx) => {
      await tx.query(
        sql(
          "INSERT INTO principals(principal_id,display_name) VALUES($1,'Synthetic runtime')",
          [f.scope.userId],
        ),
      );
      await tx.query(
        sql(
          "INSERT INTO organizations(organization_id,display_name,slug) VALUES($1,'Synthetic runtime',$2)",
          [f.scope.organizationId, f.scope.organizationId.replaceAll("_", "-")],
        ),
      );
      await tx.query(
        sql(
          "INSERT INTO organization_roles(organization_id,role_key,policy_version,is_owner,capabilities) VALUES($1,'owner','authorization-v2',TRUE,cloudmarkup_authorization_v2_permissions('owner'))",
          [f.scope.organizationId],
        ),
      );
      await tx.query(
        sql(
          "INSERT INTO memberships(membership_id,organization_id,principal_id,role_key) VALUES($1,$2,$3,'owner')",
          [runtimeTestId("membership"), f.scope.organizationId, f.scope.userId],
        ),
      );
      await tx.query(
        sql(
          "INSERT INTO projects(project_id,organization_id,name,created_by_principal_id) VALUES($1,$2,'Synthetic runtime',$3)",
          [f.scope.projectId, f.scope.organizationId, f.scope.userId],
        ),
      );
    });
    const errors: unknown[] = [];
    const observed: SqlDatabase = {
      close: () => Promise.resolve(),
      query: database.query.bind(database),
      transaction: (work) =>
        database.transaction(async (tx) => {
          try {
            return await work(tx);
          } catch (error) {
            errors.push(error);
            throw error;
          }
        }),
    };
    const store = new PostgresModelRuntimeAdmissionStore({
      database: observed,
      scope: f.scope,
    });
    return { ...f, store, errors };
  }
  async function row(f: Awaited<ReturnType<typeof fixture>>) {
    const found = await database.query(
      sql(
        "SELECT snapshot FROM model_runtime_admissions WHERE organization_id=$1 AND scope_sha256=$2",
        [f.scope.organizationId, f.state.tenantScopeDigest.slice(7)],
      ),
    );
    return parseRuntimeRecord(found.rows[0]?.["snapshot"], f.scope);
  }
  async function waitPast(expiresAt: string) {
    const milliseconds = Math.max(0, Date.parse(expiresAt) - Date.now()) + 30;
    await database.query(
      sql("SELECT pg_sleep($1::double precision)", [milliseconds / 1000]),
    );
  }
  function delayedDatabase(
    onQuery: (statement: SqlStatement, tx: SqlExecutor) => Promise<void>,
  ): SqlDatabase {
    return {
      query: database.query.bind(database),
      close: () => Promise.resolve(),
      transaction: (work) =>
        database.transaction(async (tx) =>
          work({
            async query<T extends SqlRow = SqlRow>(statement: SqlStatement) {
              const result = await tx.query<T>(statement);
              await onQuery(statement, tx);
              return result;
            },
          }),
        ),
    };
  }
  it("claims one exact key once across independent adapters and retains its debit after release", async () => {
    const f = await fixture();
    const input = f.claim(await f.store.inspect(f.state));
    const other = new PostgresModelRuntimeAdmissionStore({
      database,
      scope: f.scope,
    });
    const results = await Promise.all([
      f.store.claim(input),
      other.claim(input),
    ]);
    expect(results.map((result) => result.kind).sort()).toEqual([
      "claimed",
      "duplicate-in-progress",
    ]);
    const result = results.find((value) => value.kind === "claimed");
    if (result?.kind !== "claimed") throw new Error("Missing synthetic claim");
    await f.store.release({
      executionLease: result.executionLease,
      tenantScopeDigest: f.state.tenantScopeDigest,
    });
    const snapshot = await other.inspect(f.state);
    expect(snapshot.windows.organization).toMatchObject({
      requestCount: 1,
      activeConcurrentJobs: 0,
    });
    expect(
      await f.store.listPendingOutbox({
        fingerprint: input.fingerprint,
        tenantScopeDigest: f.state.tenantScopeDigest,
      }),
    ).toHaveLength(1);
  });
  it("fences stale snapshots and exact active concurrency lease-ID collisions", async () => {
    const f = await fixture();
    const a = f.claim(await f.store.inspect(f.state));
    const second = runtimeAdmissionFixture(f.scope, new Date().toISOString());
    const b = second.claim(await f.store.inspect(second.state));
    expect((await f.store.claim(a)).kind).toBe("claimed");
    expect(await f.store.claim(b)).toEqual({ kind: "conflict" });
    const collision = runtimeAdmissionFixture(
      f.scope,
      new Date().toISOString(),
      runtimeTestId("samelease"),
      a.leaseId,
    );
    expect(
      await f.store.claim(
        collision.claim(await f.store.inspect(collision.state)),
      ),
    ).toEqual({ kind: "conflict" });
    expect(
      (await f.store.inspect(f.state)).windows.organization.requestCount,
    ).toBe(1);
  });
  it("records denied decisions once, without execution authority", async () => {
    const f = await fixture();
    const input = f.claim(await f.store.inspect(f.state));
    const { decisionDigest: _digest, expiresAt: _expiry, ...body } = f.decision;
    void _digest;
    void _expiry;
    const denied = {
      ...body,
      authorization: {},
      denialReasons: ["feature-not-entitled"],
      invokeModel: false,
      outcome: "denied",
      safeError: {
        code: "feature-not-entitled",
        messageKey: "cloudmarkup.runtime.feature-not-entitled",
        noRawSensitiveValues: true,
      },
    };
    const decision = modelRuntimeAdmissionDecisionV1Schema.parse({
      ...denied,
      decisionDigest: digestStructuredValue(denied),
    });
    const { leaseId: _lease, ...base } = input;
    void _lease;
    const deniedInput = {
      ...base,
      acquire: false,
      admissionDecision: decision,
      claimOutbox: [],
      deniedTerminal: { admission: decision, commercial: null, output: null },
    };
    expect((await f.store.claim(deniedInput)).kind).toBe("denied");
    expect((await f.store.claim(deniedInput)).kind).toBe("duplicate-terminal");
    expect((await f.store.inspect(f.state)).windows.organization).toMatchObject(
      { requestCount: 1, activeConcurrentJobs: 0 },
    );
  });
  it("expired full capacity admits a fresh request but old ownership cannot complete or assert emission authority", async () => {
    const f = await fixture();
    const input = {
      ...f.claim(await f.store.inspect(f.state)),
      executionLeaseExpiresAt: new Date(Date.now() + 750).toISOString(),
      limits: {
        maximumConcurrentOrganizationJobs: 1,
        maximumConcurrentUserJobs: 1,
        maximumOrganizationRequests: 20,
        maximumUserRequests: 20,
      },
    };
    const first = await f.store.claim(input);
    if (first.kind !== "claimed") throw new Error("Missing initial claim");
    await waitPast(first.executionLease.expiresAt);
    const second = runtimeAdmissionFixture(f.scope, new Date().toISOString());
    const newClaim = {
      ...second.claim(await f.store.inspect(second.state)),
      limits: input.limits,
    };
    expect((await f.store.claim(newClaim)).kind).toBe("claimed");
    if (f.terminal.commercial === null)
      throw new Error("Missing synthetic commercial metadata");
    await expect(
      f.store.checkpointPendingAndRelease({
        executionLease: first.executionLease,
        fingerprint: input.fingerprint,
        tenantScopeDigest: f.state.tenantScopeDigest,
        pending: {
          ...f.terminal,
          commercial: {
            ...f.terminal.commercial,
            state: "settlement-pending",
            reconciliationState: "pending-settlement",
          },
        },
        pendingOutbox: [],
        trustedNow: new Date().toISOString(),
      }),
    ).rejects.toThrow(ModelRuntimeControlError);
    await expect(
      f.store.assertExecutionLease({
        commercialExpiresAt: input.commercialExpiresAt,
        executionLease: first.executionLease,
        tenantScopeDigest: f.state.tenantScopeDigest,
        trustedNow: new Date().toISOString(),
      }),
    ).rejects.toThrow(ModelRuntimeControlError);
    await expect(
      f.store.completeAndRelease({
        executionLease: first.executionLease,
        fingerprint: input.fingerprint,
        tenantScopeDigest: f.state.tenantScopeDigest,
        terminal: f.terminal,
        terminalOutbox: [],
        trustedNow: new Date().toISOString(),
      }),
    ).rejects.toThrow(ModelRuntimeControlError);
    expect(
      (await f.store.inspect(second.state)).windows.organization,
    ).toMatchObject({ requestCount: 2, activeConcurrentJobs: 1 });
  });
  it("same-key expired takeover is recovery-only, monotonic, and never consumes another request", async () => {
    const f = await fixture();
    const input = {
      ...f.claim(await f.store.inspect(f.state)),
      executionLeaseExpiresAt: new Date(Date.now() + 750).toISOString(),
    };
    const first = await f.store.claim(input);
    if (first.kind !== "claimed") throw new Error("Missing initial claim");
    await waitPast(first.executionLease.expiresAt);
    const retry = {
      ...input,
      decidedAt: new Date().toISOString(),
      executionLeaseExpiresAt: new Date(Date.now() + 120000).toISOString(),
    };
    const second = await f.store.claim(retry);
    if (second.kind !== "claimed") throw new Error("Missing recovery claim");
    expect(second.executionLease.recoveryOnly).toBe(true);
    expect(second.executionLease.revision).toBeGreaterThan(
      first.executionLease.revision,
    );
    expect(second.executionLease.fencingToken).not.toBe(
      first.executionLease.fencingToken,
    );
    await expect(
      f.store.release({
        executionLease: first.executionLease,
        tenantScopeDigest: f.state.tenantScopeDigest,
      }),
    ).rejects.toThrow(ModelRuntimeControlError);
    expect(
      (await f.store.inspect({ ...f.state, decidedAt: retry.decidedAt }))
        .windows.organization.requestCount,
    ).toBe(1);
    expect((await row(f)).recoveryRequired).toBe(true);
  });
  it("reusing an expired lease ID fences the previous scope before creating new authority", async () => {
    const f = await fixture();
    const input = {
      ...f.claim(await f.store.inspect(f.state)),
      executionLeaseExpiresAt: new Date(Date.now() + 750).toISOString(),
    };
    const first = await f.store.claim(input);
    if (first.kind !== "claimed") throw new Error("Missing first");
    await waitPast(first.executionLease.expiresAt);
    const next = runtimeAdmissionFixture(
      f.scope,
      new Date().toISOString(),
      runtimeTestId("replacement"),
      input.leaseId,
    );
    expect(
      (await f.store.claim(next.claim(await f.store.inspect(next.state)))).kind,
    ).toBe("claimed");
    expect(await row(f)).toMatchObject({
      executionLease: null,
      recoveryRequired: true,
    });
    await expect(
      f.store.release({
        executionLease: first.executionLease,
        tenantScopeDigest: f.state.tenantScopeDigest,
      }),
    ).rejects.toThrow(ModelRuntimeControlError);
  });
  it("checkpoint recovery preserves pending evidence, completion, and idempotent outbox acknowledgement", async () => {
    const f = await fixture();
    const { input, result } = await f.admit(f.store);
    const commercial = f.terminal.commercial;
    if (commercial === null) throw new Error("Missing synthetic metadata");
    const pending = {
      ...f.terminal,
      commercial: {
        ...commercial,
        state: "settlement-pending" as const,
        reconciliationState: "pending-settlement" as const,
      },
    };
    await f.store.checkpointPendingAndRelease({
      executionLease: result.executionLease,
      fingerprint: input.fingerprint,
      pending,
      pendingOutbox: [],
      tenantScopeDigest: f.state.tenantScopeDigest,
      trustedNow: new Date().toISOString(),
    });
    const recovery = await f.store.claim(input);
    if (recovery.kind !== "claimed") throw new Error("Missing recovery");
    expect(recovery.executionLease.recoveryOnly).toBe(true);
    expect(recovery.pending).toEqual(pending);
    await f.store.completeAndRelease({
      executionLease: recovery.executionLease,
      fingerprint: input.fingerprint,
      tenantScopeDigest: f.state.tenantScopeDigest,
      terminal: f.terminal,
      terminalOutbox: [f.outbox("release")],
      trustedNow: new Date().toISOString(),
    });
    expect((await f.store.claim(input)).kind).toBe("duplicate-terminal");
    expect((await row(f)).pending).toEqual(pending);
    const entries = await f.store.listPendingOutbox({
      fingerprint: input.fingerprint,
      tenantScopeDigest: f.state.tenantScopeDigest,
    });
    expect(entries).toHaveLength(2);
    for (const entry of entries) {
      await f.store.acknowledgeOutbox({
        fingerprint: input.fingerprint,
        outboxId: entry.outboxId,
        tenantScopeDigest: f.state.tenantScopeDigest,
      });
      await f.store.acknowledgeOutbox({
        fingerprint: input.fingerprint,
        outboxId: entry.outboxId,
        tenantScopeDigest: f.state.tenantScopeDigest,
      });
    }
    expect(
      await f.store.listPendingOutbox({
        fingerprint: input.fingerprint,
        tenantScopeDigest: f.state.tenantScopeDigest,
      }),
    ).toEqual([]);
  });
  it("current membership revocation and cross-tenant selectors deny every subsequent authority read", async () => {
    const f = await fixture();
    const { input, result } = await f.admit(f.store);
    const other = await fixture();
    await expect(
      other.store.listPendingOutbox({
        fingerprint: input.fingerprint,
        tenantScopeDigest: f.state.tenantScopeDigest,
      }),
    ).rejects.toThrow(ModelRuntimeControlError);
    await database.query(
      sql(
        "UPDATE memberships SET lifecycle_status='suspended' WHERE organization_id=$1 AND principal_id=$2",
        [f.scope.organizationId, f.scope.userId],
      ),
    );
    await expect(
      f.store.assertExecutionLease({
        commercialExpiresAt: input.commercialExpiresAt,
        executionLease: result.executionLease,
        tenantScopeDigest: f.state.tenantScopeDigest,
        trustedNow: new Date().toISOString(),
      }),
    ).rejects.toThrow(ModelRuntimeControlError);
  });
  it("a near-expiry terminal write rolls back preceding outbox inserts after a SQL stall", async () => {
    const f = await fixture();
    const input = {
      ...f.claim(await f.store.inspect(f.state)),
      executionLeaseExpiresAt: new Date(Date.now() + 1000).toISOString(),
    };
    const result = await f.store.claim(input);
    if (result.kind !== "claimed") throw new Error("Missing claim");
    let stalls = 0;
    const delayed = new PostgresModelRuntimeAdmissionStore({
      scope: f.scope,
      database: delayedDatabase(async (statement, tx) => {
        if (
          statement.text.startsWith(
            "INSERT INTO model_runtime_admission_outbox",
          )
        ) {
          stalls += 1;
          await tx.query(sql("SELECT pg_sleep(1.2)"));
        }
      }),
    });
    await expect(
      delayed.completeAndRelease({
        executionLease: result.executionLease,
        fingerprint: input.fingerprint,
        tenantScopeDigest: f.state.tenantScopeDigest,
        terminal: f.terminal,
        terminalOutbox: [f.outbox("release")],
        trustedNow: new Date().toISOString(),
      }),
    ).rejects.toThrow(ModelRuntimeControlError);
    expect(stalls).toBe(1);
    expect((await row(f)).terminal).toBeNull();
    expect(
      await f.store.listPendingOutbox({
        fingerprint: input.fingerprint,
        tenantScopeDigest: f.state.tenantScopeDigest,
      }),
    ).toHaveLength(1);
  });
  it("a claim cannot return authority if its outbox insertion stalls past expiry", async () => {
    const f = await fixture();
    const input = {
      ...f.claim(await f.store.inspect(f.state)),
      executionLeaseExpiresAt: new Date(Date.now() + 1000).toISOString(),
    };
    let stalls = 0;
    const delayed = new PostgresModelRuntimeAdmissionStore({
      scope: f.scope,
      database: delayedDatabase(async (statement, tx) => {
        if (
          statement.text.startsWith(
            "INSERT INTO model_runtime_admission_outbox",
          )
        ) {
          stalls += 1;
          await tx.query(sql("SELECT pg_sleep(1.2)"));
        }
      }),
    });
    await expect(delayed.claim(input)).rejects.toThrow(
      ModelRuntimeControlError,
    );
    expect(stalls).toBe(1);
    expect((await f.store.inspect(f.state)).windows.organization).toMatchObject(
      { requestCount: 0, activeConcurrentJobs: 0 },
    );
  });
  it("database guards reject metadata deletion and terminal/debit rewrites", async () => {
    const f = await fixture();
    const { input, result } = await f.admit(f.store);
    await f.store.completeAndRelease({
      executionLease: result.executionLease,
      fingerprint: input.fingerprint,
      tenantScopeDigest: f.state.tenantScopeDigest,
      terminal: f.terminal,
      terminalOutbox: [],
      trustedNow: new Date().toISOString(),
    });
    for (const table of [
      "model_runtime_admissions",
      "model_runtime_admission_debits",
      "model_runtime_admission_outbox",
    ]) {
      await expect(
        database.query(
          sql(`DELETE FROM ${table} WHERE organization_id=$1`, [
            f.scope.organizationId,
          ]),
        ),
      ).rejects.toThrow();
    }
    await expect(
      database.query(
        sql(
          "UPDATE model_runtime_admissions SET revision=revision+1,snapshot=jsonb_set(snapshot,'{terminal}','null') WHERE organization_id=$1",
          [f.scope.organizationId],
        ),
      ),
    ).rejects.toThrow();
    await expect(
      database.query(
        sql(
          "UPDATE model_runtime_admission_debits SET debited_at=clock_timestamp() WHERE organization_id=$1",
          [f.scope.organizationId],
        ),
      ),
    ).rejects.toThrow();
    expect((await row(f)).terminal).toEqual(f.terminal);
  });
  it("at-cap exact operational replay remains idempotent but a 257th entry fails closed", async () => {
    const f = await fixture();
    const { input, result } = await f.admit(f.store);
    await f.store.completeAndRelease({
      executionLease: result.executionLease,
      fingerprint: input.fingerprint,
      tenantScopeDigest: f.state.tenantScopeDigest,
      terminal: f.terminal,
      terminalOutbox: [],
      trustedNow: new Date().toISOString(),
    });
    const binding = await f.store.readOperationalExecutionBinding({
      admissionDecision: f.decision,
      admissionRequest: f.request,
      tenantScopeDigest: f.state.tenantScopeDigest,
    });
    const entries = Array.from({ length: 255 }, (_, i) =>
      f.outbox("safety-issue", binding.terminalDigest, `entry${String(i)}`),
    );
    await database.transaction(async (tx) => {
      for (const entry of entries)
        await tx.query(
          sql(
            "INSERT INTO model_runtime_admission_outbox(organization_id,scope_sha256,outbox_sha256,entry) VALUES($1,$2,$3,$4::jsonb)",
            [
              f.scope.organizationId,
              f.state.tenantScopeDigest.slice(7),
              entry.outboxId.slice(7),
              admissionJson(entry),
            ],
          ),
        );
    });
    const last = entries.at(-1);
    if (last === undefined) throw new Error("Missing entry");
    const operation = {
      ...binding,
      admissionDecision: f.decision,
      admissionRequest: f.request,
    };
    await expect(
      f.store.appendOperationalOutbox({ ...operation, entry: last }),
    ).resolves.toBeUndefined();
    await expect(
      f.store.appendOperationalOutbox({
        ...operation,
        entry: f.outbox("safety-issue", binding.terminalDigest, "overflow"),
      }),
    ).rejects.toThrow(ModelRuntimeControlError);
    expect(
      await f.store.listPendingOutbox({
        fingerprint: input.fingerprint,
        tenantScopeDigest: f.state.tenantScopeDigest,
      }),
    ).toHaveLength(256);
  }, 20000);
});
