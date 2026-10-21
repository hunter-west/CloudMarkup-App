import { createProductionCommercialReads } from "../../production-commercial-reads.js";
import { withDataApiTypes } from "./data-api-postgres-test-helpers.js";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  digestStructuredValue,
  projectModelCommercialTerminalOutcomeV1,
  type ModelCommercialInvocationContextV1,
} from "@cloudmarkup/model-gateway";
import type { PostgresDatabase } from "./postgres-driver.js";
import {
  sql,
  type SqlDatabase,
  type SqlRow,
  type SqlStatement,
} from "./sql.js";
import { PostgresCommercialPersistenceRepository } from "./commercial-repositories.js";
import { PostgresModelCommercialPersistenceRepository } from "./model-commercial-repository.js";
import { runtimeTestId } from "./model-runtime-admission-test-helpers.js";
import { PostgresModelCommercialReservations } from "./model-commercial-accounting.js";
import { modelAccountingPhysicalId } from "./model-commercial-accounting-codec.js";
import {
  parseWorkflowRecord,
  workflowJson,
} from "./model-commercial-workflow-codec.js";
import { modelTerminalIdentity } from "./model-commercial-terminal-codec.js";
import {
  createModelAccountingPgTestHarness,
  plan,
  entitlement,
  charging,
} from "./model-commercial-accounting-pg-test-helpers.js";

const configured = process.env["CLOUDMARKUP_TEST_DATABASE_URL"]?.trim();
const integration = configured ? describe : describe.skip;
function gate() {
  let open = () => {
    /* assigned synchronously */
  };
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

integration("model reservation bridge on real PostgreSQL", () => {
  const harness = createModelAccountingPgTestHarness(configured);
  const { tenant, fixture, terminalFixture } = harness;
  let db: PostgresDatabase;
  let legacy: Awaited<ReturnType<typeof tenant>>;
  let legacyReservationId: string;
  let legacyBefore: unknown;
  beforeAll(async () => {
    await harness.setup();
    db = harness.database;
    legacy = harness.legacy;
    legacyReservationId = harness.legacyReservationId;
    legacyBefore = harness.legacyBefore;
  }, 60000);
  afterAll(() => harness.teardown(), 30000);
  async function expectPublicBalance(f: Awaited<ReturnType<typeof fixture>>) {
    const expected = await f.repository.getCreditBalance(f.authorized);
    const principal = {
      principalId: f.scope.userId,
      correlationId: f.authorized.correlationId,
      sessionId: f.authorized.sessionId,
      authenticationSource: "test" as const,
      authenticatedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    };
    const reads = createProductionCommercialReads({
      database: withDataApiTypes(db),
    });
    const overview = await reads.getCreditOverview(
      principal,
      f.scope.organizationId,
    );
    expect(overview.balance).toMatchObject({
      availableCreditUnits: Number(expected.availableCreditUnits),
      reservedCreditUnits: Number(expected.reservedCreditUnits),
      settledCreditUnits: Number(expected.settledCreditUnits),
      compensatedCreditUnits: Number(expected.compensatedCreditUnits),
    });
    expect(overview.balance).not.toHaveProperty("ledgerThroughEventId");
    const balance = await reads.getCreditBalance(
      principal,
      f.scope.organizationId,
    );
    expect(balance.availableCreditUnits).toBe(
      Number(expected.availableCreditUnits),
    );
    expect(balance).not.toHaveProperty("ledgerThroughEventId");
  }
  async function waitForDatabaseBlocker(blocker: number) {
    for (let attempt = 0; attempt < 120; attempt++) {
      const blocked = await db.query(
        sql(
          "SELECT 1 FROM pg_stat_activity WHERE $1::int=ANY(pg_blocking_pids(pid)) AND wait_event_type='Lock'",
          [blocker],
        ),
      );
      if (blocked.rowCount > 0) return;
      await delay(25);
    }
    throw new Error("Synthetic database contention was not observed.");
  }
  it.each([true, false])(
    "terminal29: SQL cache, provider-unit and fractional buffer parity delivery=%s",
    async (acknowledged) => {
      const f = await terminalFixture(true);
      const finished = await f.coordinator.execute(
        f.record.request,
        (context) => f.generate(context, acknowledged),
      );
      expect(f.errors).toEqual([]);
      expect(finished.state).toBe(acknowledged ? "completed" : "compensated");
      // ceil(6.700176 micros) = 7; ceil(7 * 25%) = 2; ceil(9 / 2) = 5 credits.
      // Maximum usage reserves 22 credits, so this admitted single-primary path
      // cannot overrun its reservation. Provider units do not inflate totalUnits.
      expect(finished.completedCreditUnits).toBe(acknowledged ? 5 : 0);
      const row = (
        await db.query(
          sql(
            `SELECT o.outcome,r.reserved_credit_units,e.estimated_provider_cost_micros,e.normalized_credit_units,
      detail.input_units,detail.output_units,detail.cache_read_units,detail.cache_write_units,detail.total_units,detail.provider_specific_units,
      detail.charged_credit_units,detail.compensated_credit_units FROM model_commercial_accounting_outcomes o
      JOIN credit_reservations r ON r.organization_id=o.organization_id AND r.reservation_id=o.canonical_reservation_id
      JOIN usage_ledger_entries e ON e.organization_id=o.organization_id AND e.ledger_entry_id=o.ledger_entry_id
      JOIN model_usage_event_details detail ON detail.organization_id=e.organization_id AND detail.ledger_entry_id=e.ledger_entry_id
      WHERE o.organization_id=$1`,
            [f.scope.organizationId],
          ),
        )
      ).rows[0];
      expect(row).toMatchObject({
        reserved_credit_units: "22",
        estimated_provider_cost_micros: "7",
        normalized_credit_units: "5",
        input_units: "11",
        output_units: "7",
        cache_read_units: "3",
        cache_write_units: "2",
        total_units: "23",
        provider_specific_units: [{ unitName: "thinking-units", units: "5" }],
        charged_credit_units: acknowledged ? "5" : "0",
        compensated_credit_units: acknowledged ? "0" : "5",
      });
      expect(await f.coordinator.recover(f.record.request)).toEqual(finished);
      await expectPublicBalance(f);
    },
  );
  it("terminal29: account-first settlement does not deadlock a competing legacy release", async () => {
    const f = await terminalFixture();
    const original = f.adapter.settle.bind(f.adapter);
    const intercepted = vi
      .spyOn(f.adapter, "settle")
      .mockImplementationOnce(async (input) => {
        const locked = gate(),
          proceed = gate();
        let blocker = 0;
        const competing: SqlDatabase = {
          close: () => Promise.resolve(),
          query: db.query.bind(db),
          transaction: (work) =>
            db.transaction((tx) =>
              work({
                query: async <TRow extends SqlRow>(statement: SqlStatement) => {
                  const result = await tx.query<TRow>(statement);
                  if (
                    statement.text.includes(
                      "FROM organization_billing_accounts",
                    ) &&
                    statement.text.includes("FOR UPDATE")
                  ) {
                    blocker = Number(
                      (await tx.query(sql("SELECT pg_backend_pid() AS pid")))
                        .rows[0]?.["pid"],
                    );
                    locked.open();
                    await proceed.promise;
                  }
                  return result;
                },
              }),
            ),
        };
        const release = new PostgresCommercialPersistenceRepository(competing)
          .releaseReservation(f.accounting, {
            chargingScenario: "user-cancelled-before-invocation",
            chargingPolicyVersion: charging,
            idempotencyKey: runtimeTestId("legacyrace"),
            ledgerEntryId: runtimeTestId("legacyraceledger"),
            reasonCode: "test.synthetic-contention",
            requestId: modelAccountingPhysicalId("request", f.record),
            requestSha256: f.record.fingerprint.slice(7),
            reservationId: modelAccountingPhysicalId("reservation", f.record),
          })
          .then(
            (value) => ({ value }),
            (error: unknown) => ({ error }),
          );
        await locked.promise;
        const terminal = original(input);
        try {
          await waitForDatabaseBlocker(blocker);
        } finally {
          proceed.open();
        }
        expect(await release).toMatchObject({
          error: { code: "access-denied" },
        });
        return await terminal;
      });
    const finished = await f.coordinator.execute(f.record.request, (context) =>
      f.generate(context, true),
    );
    await expect(intercepted.mock.results[0]?.value).resolves.toEqual({
      replayed: false,
    });
    expect(finished.state).toBe("completed");
    expect(f.errors).toEqual([]);
  });
  it("terminal29: workflow-first preview recovery does not deadlock settlement", async () => {
    const f = await terminalFixture();
    const locked = gate(),
      proceed = gate();
    let blocker = 0;
    const competing: SqlDatabase = {
      close: () => Promise.resolve(),
      query: db.query.bind(db),
      transaction: (work) =>
        db.transaction((tx) =>
          work({
            query: async <TRow extends SqlRow>(statement: SqlStatement) => {
              const result = await tx.query<TRow>(statement);
              if (
                statement.text.includes("FROM model_commercial_workflows") &&
                statement.text.includes("FOR UPDATE")
              ) {
                blocker = Number(
                  (await tx.query(sql("SELECT pg_backend_pid() AS pid")))
                    .rows[0]?.["pid"],
                );
                locked.open();
                await proceed.promise;
              }
              return result;
            },
          }),
        ),
    };
    const terminalAdapter = new PostgresModelCommercialReservations({
      database: competing,
      scope: f.scope,
      binding: f.binding,
    });
    const intercepted = vi
      .spyOn(f.adapter, "settle")
      .mockImplementationOnce(async (input) => {
        const raw = (
          await db.query(
            sql(
              "SELECT snapshot FROM model_commercial_workflows WHERE organization_id=$1",
              [f.scope.organizationId],
            ),
          )
        ).rows[0]?.["snapshot"];
        const w = parseWorkflowRecord(raw, f.scope);
        if (w.dispatchIntent === null)
          throw new Error("Synthetic dispatch missing.");
        const terminal = terminalAdapter.settle(input);
        await locked.promise;
        const recovered = f.journal.recoverVerified({
          request: w.request,
          dispatchIntent: w.dispatchIntent,
        });
        try {
          await waitForDatabaseBlocker(blocker);
        } finally {
          proceed.open();
        }
        const result = await terminal;
        await expect(recovered).resolves.toMatchObject({ kind: "verified" });
        return result;
      });
    const finished = await f.coordinator.execute(f.record.request, (context) =>
      f.generate(context, true),
    );
    await expect(intercepted.mock.results[0]?.value).resolves.toEqual({
      replayed: false,
    });
    expect(finished.state).toBe("completed");
    expect(f.errors).toEqual([]);
  });
  it("terminal29: coordinator-proven zero dispatch releases with exact zero usage and replays after reservation expiry", async () => {
    const f = await terminalFixture(false, 1500);
    const reserve = f.adapter.reserve.bind(f.adapter);
    vi.spyOn(f.adapter, "reserve").mockImplementationOnce(async (input) => {
      const result = await reserve(input);
      await delay(Math.max(0, Date.parse(input.expiresAt) - Date.now()) + 30);
      return result;
    });
    const invoke = vi.fn((context: ModelCommercialInvocationContextV1) =>
      f.generate(context, true),
    );
    const first = await f.coordinator.execute(f.record.request, invoke);
    expect(invoke).not.toHaveBeenCalled();
    expect(first).toMatchObject({ state: "released", completedCreditUnits: 0 });
    const recovered = await f.coordinator.recover(f.record.request);
    expect(recovered).toMatchObject({
      state: "released",
      completedCreditUnits: 0,
      compensationStatus: "not-required",
    });
    expect(await f.coordinator.recover(f.record.request)).toEqual(recovered);
    const row = (
      await db.query(
        sql(
          `SELECT r.status,e.normalized_credit_units,e.estimated_provider_cost_micros,e.charging_scenario,e.reason_code,
      d.input_units,d.output_units,d.cache_read_units,d.cache_write_units,d.total_units,d.provider_specific_units,d.attempts,o.source_kind
      FROM model_commercial_accounting_outcomes o JOIN credit_reservations r ON r.organization_id=o.organization_id AND r.reservation_id=o.canonical_reservation_id
      JOIN usage_ledger_entries e ON e.organization_id=o.organization_id AND e.ledger_entry_id=o.ledger_entry_id
      JOIN model_usage_event_details d ON d.organization_id=e.organization_id AND d.ledger_entry_id=e.ledger_entry_id WHERE o.organization_id=$1`,
          [f.scope.organizationId],
        ),
      )
    ).rows[0];
    expect(row).toMatchObject({
      status: "released",
      charging_scenario: "cloudmarkup-internal-failure",
      reason_code: "model.reservation.expired-before-dispatch",
      normalized_credit_units: null,
      estimated_provider_cost_micros: null,
      input_units: "0",
      output_units: "0",
      cache_read_units: "0",
      cache_write_units: "0",
      total_units: "0",
      provider_specific_units: [],
      attempts: [],
      source_kind: "workflow-receipt",
    });
    expect(
      (await f.repository.getCreditBalance(f.authorized)).availableCreditUnits,
    ).toBe("100");
  });
  it("terminal29: deferred SQL rejects contradictory detail units and rolls back the complete terminal transaction", async () => {
    const f = await terminalFixture();
    const corrupt: SqlDatabase = {
      close: () => Promise.resolve(),
      query: db.query.bind(db),
      transaction: (work) =>
        db.transaction((tx) =>
          work({
            query: (statement) => {
              if (
                statement.text.includes("INSERT INTO model_usage_event_details")
              ) {
                const values = [...statement.values];
                values[14] = BigInt(String(values[14])) + 1n;
                values[18] = BigInt(String(values[18])) + 1n;
                return tx.query({ ...statement, values });
              }
              return tx.query(statement);
            },
          }),
        ),
    };
    const corrupted = new PostgresModelCommercialReservations({
      database: corrupt,
      scope: f.scope,
      binding: f.binding,
    });
    const intercepted = vi
      .spyOn(f.adapter, "settle")
      .mockImplementationOnce((input) => corrupted.settle(input));
    const first = await f.coordinator.execute(f.record.request, (context) =>
      f.generate(context, true),
    );
    expect(first.state).toBe("settlement-pending");
    await expect(intercepted.mock.results[0]?.value).rejects.toThrow();
    expect(
      (
        await db.query(
          sql(
            "SELECT 1 FROM model_commercial_accounting_outcomes WHERE organization_id=$1",
            [f.scope.organizationId],
          ),
        )
      ).rowCount,
    ).toBe(0);
    expect(
      (await f.repository.getCreditBalance(f.authorized)).settledCreditUnits,
    ).toBe("0");
    expect(
      (await f.coordinator.recover(f.record.request)).completedCreditUnits,
    ).toBe(1);
  });
  it.each([true, false])(
    "terminal29: canonical delivery=%s, exact replay and retained immutable evidence",
    async (acknowledged) => {
      const f = await terminalFixture();
      const invoke = vi.fn(
        async (context: ModelCommercialInvocationContextV1) => {
          const held = await f.repository.getCreditOverview(f.authorized);
          expect(BigInt(held.balance.reservedCreditUnits)).toBeGreaterThan(0n);
          expect(held.availableByKind).toEqual({
            monthly: "0",
            purchased: "0",
            other: held.balance.availableCreditUnits,
          });
          expect(
            BigInt(held.balance.availableCreditUnits) +
              BigInt(held.balance.reservedCreditUnits),
          ).toBe(100n);
          return f.generate(context, acknowledged);
        },
      );
      const result = await f.coordinator
        .execute(f.record.request, invoke)
        .catch((error: unknown) => {
          expect(f.errors).toEqual([]);
          throw error;
        });
      await expect(invoke.mock.results[0]?.value).resolves.toMatchObject({
        usefulOutputDelivered: acknowledged,
      });
      expect(f.errors).toEqual([]);
      expect(result.state).toBe(acknowledged ? "completed" : "compensated");
      expect(result.completedCreditUnits).toBe(acknowledged ? 1 : 0);
      expect(await f.coordinator.recover(f.record.request)).toEqual(result);
      expect(invoke).toHaveBeenCalledTimes(1);
      const rows = await db.query(
        sql(
          `SELECT r.status,e.settled_credit_units,e.charging_scenario,e.pricing_authority,
      (SELECT count(*) FROM model_commercial_accounting_outcomes o WHERE o.organization_id=r.organization_id) AS evidence_count
      FROM credit_reservations r JOIN usage_ledger_entries e ON e.organization_id=r.organization_id AND e.ledger_entry_id=r.terminal_ledger_entry_id
      WHERE r.organization_id=$1`,
          [f.scope.organizationId],
        ),
      );
      expect(rows.rows[0]).toMatchObject({
        status: acknowledged ? "settled" : "released",
        pricing_authority: "model-provider-v1",
        charging_scenario: acknowledged
          ? "model-preview-delivered-v1"
          : "cloudmarkup-internal-failure",
        evidence_count: "1",
      });
      const balance = await f.repository.getCreditBalance(f.authorized);
      expect(balance.reservedCreditUnits).toBe("0");
      expect(balance.settledCreditUnits).toBe(acknowledged ? "1" : "0");
      const overview = await f.repository.getCreditOverview(f.authorized);
      expect(overview.availableByKind).toEqual({
        monthly: "0",
        purchased: "0",
        other: acknowledged ? "99" : "100",
      });
      expect(overview.nextExpiration).toBeNull();
      const metadata = await db.query(
        sql(
          "SELECT row_to_json(o)::text AS metadata FROM model_commercial_accounting_outcomes o WHERE organization_id=$1",
          [f.scope.organizationId],
        ),
      );
      expect(String(metadata.rows[0]?.["metadata"])).not.toContain(
        f.preview.modelRequest.source.content,
      );
      expect(String(metadata.rows[0]?.["metadata"])).not.toContain(
        JSON.stringify(f.preview.result.response),
      );
      await expect(
        db.query(
          sql(
            "UPDATE model_commercial_accounting_outcomes SET outcome_sha256=$2 WHERE organization_id=$1",
            [f.scope.organizationId, "b".repeat(64)],
          ),
        ),
      ).rejects.toThrow();
    },
  );
  it("terminal29: recovers a committed settlement after lost acknowledgement without settling twice", async () => {
    const f = await terminalFixture();
    const settle = f.adapter.settle.bind(f.adapter);
    const calls = vi
      .spyOn(f.adapter, "settle")
      .mockImplementationOnce(async (input) => {
        await settle(input);
        throw new Error(
          "Synthetic acknowledgement lost after committed terminal transaction.",
        );
      });
    const invoke = vi.fn((context: ModelCommercialInvocationContextV1) =>
      f.generate(context, true),
    );
    const first = await f.coordinator.execute(f.record.request, invoke);
    expect(first.state).toBe("settlement-pending");
    const recovered = await Promise.all(
      Array.from({ length: 4 }, () => f.coordinator.recover(f.record.request)),
    );
    expect(
      recovered.every(
        (result) =>
          result.state === "completed" && result.completedCreditUnits === 1,
      ),
    ).toBe(true);
    expect(calls).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledTimes(1);
    const counted = await db.query(
      sql(
        "SELECT count(*) AS count FROM usage_ledger_entries WHERE organization_id=$1 AND entry_kind='settlement'",
        [f.scope.organizationId],
      ),
    );
    expect(counted.rows[0]?.["count"]).toBe("1");
    expect(f.errors).toEqual([]);
  });
  it("terminal29: preserves a frozen unknown receipt while verified late usage releases once without delivery", async () => {
    const f = await terminalFixture();
    const invoke = vi.fn(
      async (context: ModelCommercialInvocationContextV1) => {
        await f.journal.prepare(context);
        expect(await f.journal.claim(f.preview.claim)).toEqual({
          kind: "claimed",
        });
        throw new Error(
          "Synthetic lost response; metering is not yet available.",
        );
      },
    );
    const first = await f.coordinator.execute(f.record.request, invoke);
    expect(first.state).toBe("reconciliation-required");
    expect(first.completedCreditUnits).toBeNull();
    const frozen = (
      await db.query(
        sql(
          "SELECT snapshot FROM model_commercial_workflows WHERE organization_id=$1",
          [f.scope.organizationId],
        ),
      )
    ).rows[0]?.["snapshot"];
    expect((await f.coordinator.recover(f.record.request)).state).toBe(
      "reconciliation-required",
    );
    expect(
      (await f.repository.getCreditBalance(f.authorized)).reservedCreditUnits,
    ).toBe(String(f.input.requestedCreditUnits));
    const technical = new PostgresModelCommercialPersistenceRepository(db);
    expect(
      await technical.listReconciliationCandidates(
        f.accounting,
        new Date().toISOString(),
      ),
    ).toHaveLength(1);
    // Completion records only usage/hashes from the ORIGINAL claim. No emission,
    // replacement claim, invocation, request debit or dollar release is created.
    await f.journal.record(f.preview.result.usage);
    await f.journal.complete(f.preview.claim, f.preview.result);
    const recovered = await Promise.all(
      Array.from({ length: 4 }, () => f.coordinator.recover(f.record.request)),
    );
    expect(
      recovered.every(
        (result) =>
          result.state === "compensated" && result.completedCreditUnits === 0,
      ),
    ).toBe(true);
    expect(
      (
        await db.query(
          sql(
            "SELECT snapshot FROM model_commercial_workflows WHERE organization_id=$1",
            [f.scope.organizationId],
          ),
        )
      ).rows[0]?.["snapshot"],
    ).toEqual(frozen);
    expect(await f.journal.claim(f.preview.claim)).toEqual({
      kind: "duplicate-result-unavailable",
    });
    const counts = (
      await db.query(
        sql(
          `SELECT
      (SELECT count(*) FROM model_commercial_accounting_outcomes WHERE organization_id=$1) AS outcomes,
      (SELECT count(*) FROM credit_reservations WHERE organization_id=$1) AS reservations,
      (SELECT count(*) FROM model_runtime_admission_debits WHERE organization_id=$1) AS debits,
      (SELECT count(*) FROM usage_ledger_entries WHERE organization_id=$1 AND entry_kind IN ('release','settlement','provider-failure')) AS terminals`,
          [f.scope.organizationId],
        ),
      )
    ).rows[0];
    expect(counts).toEqual({
      outcomes: "2",
      reservations: "1",
      debits: "1",
      terminals: "1",
    });
    expect(
      (await f.repository.getCreditBalance(f.authorized)).availableCreditUnits,
    ).toBe("100");
    expect(
      await technical.listReconciliationCandidates(
        f.accounting,
        new Date().toISOString(),
      ),
    ).toEqual([]);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(f.errors).toEqual([]);
  });
  it("terminal29: failed terminal detail rolls back allocations and evidence, then recover-only settles", async () => {
    const f = await terminalFixture();
    const append = vi
      .spyOn(
        PostgresModelCommercialPersistenceRepository.prototype,
        "appendUsageEventDetailInTransaction",
      )
      .mockRejectedValueOnce(new Error("Synthetic terminal detail outage."));
    const invoke = vi.fn((context: ModelCommercialInvocationContextV1) =>
      f.generate(context, true),
    );
    try {
      expect(
        (await f.coordinator.execute(f.record.request, invoke)).state,
      ).toBe("settlement-pending");
      expect(
        (
          await db.query(
            sql(
              "SELECT count(*) AS count FROM model_commercial_accounting_outcomes WHERE organization_id=$1",
              [f.scope.organizationId],
            ),
          )
        ).rows[0]?.["count"],
      ).toBe("0");
      expect(
        (await f.repository.getCreditBalance(f.authorized)).reservedCreditUnits,
      ).toBe(String(f.input.requestedCreditUnits));
      expect(
        (await f.repository.getCreditBalance(f.authorized)).settledCreditUnits,
      ).toBe("0");
    } finally {
      append.mockRestore();
    }
    expect(
      (await f.coordinator.recover(f.record.request)).completedCreditUnits,
    ).toBe(1);
    expect(invoke).toHaveBeenCalledTimes(1);
  });
  it("terminal29: rejects revoked and cross-tenant terminal recovery without mutating the original hold", async () => {
    const f = await terminalFixture();
    await f.coordinator.execute(f.record.request, async (context) => {
      await f.journal.prepare(context);
      await f.journal.claim(f.preview.claim);
      throw new Error("Synthetic unknown usage.");
    });
    const other = await tenant();
    const forged = new PostgresModelCommercialReservations({
      database: db,
      scope: other.scope,
      binding: f.binding,
    });
    await expect(
      forged.recoverVerified({
        request: f.record.request,
        requestDigest: f.record.fingerprint,
      }),
    ).rejects.toThrow();
    await db.query(
      sql(
        "UPDATE memberships SET lifecycle_status='suspended' WHERE organization_id=$1 AND principal_id=$2",
        [f.scope.organizationId, f.scope.userId],
      ),
    );
    await expect(
      f.adapter.recoverVerified({
        request: f.record.request,
        requestDigest: f.record.fingerprint,
      }),
    ).rejects.toThrow();
    const row = (
      await db.query(
        sql("SELECT status FROM credit_reservations WHERE organization_id=$1", [
          f.scope.organizationId,
        ]),
      )
    ).rows[0];
    expect(row?.["status"]).toBe("active");
    await db.query(
      sql(
        "UPDATE memberships SET lifecycle_status='active' WHERE organization_id=$1 AND principal_id=$2",
        [f.scope.organizationId, f.scope.userId],
      ),
    );
    await db.query(
      sql(
        "UPDATE projects SET lifecycle_status='archived' WHERE organization_id=$1 AND project_id=$2",
        [f.scope.organizationId, f.scope.projectId],
      ),
    );
    await expect(
      f.adapter.recoverVerified({
        request: f.record.request,
        requestDigest: f.record.fingerprint,
      }),
    ).rejects.toThrow();
    expect(
      (
        await db.query(
          sql(
            "SELECT count(*) AS count FROM model_commercial_accounting_outcomes WHERE organization_id=$1",
            [f.scope.organizationId],
          ),
        )
      ).rows[0]?.["count"],
    ).toBe("1");
  });
  it("terminal29: rejects forged amounts, missing terminal ledger and direct legacy/internal settlement bypasses", async () => {
    const f = await terminalFixture();
    const settle = f.adapter.settle.bind(f.adapter);
    const checked = vi
      .spyOn(f.adapter, "settle")
      .mockImplementationOnce(async (input) => {
        const raw = (
          await db.query(
            sql(
              "SELECT snapshot FROM model_commercial_workflows WHERE organization_id=$1",
              [f.scope.organizationId],
            ),
          )
        ).rows[0]?.["snapshot"];
        const w = parseWorkflowRecord(raw, f.scope),
          outcome = projectModelCommercialTerminalOutcomeV1(w);
        if (
          w.invocationReceipt === null ||
          w.dispatchIntent === null ||
          w.resolvedContext === null
        )
          throw new Error("Synthetic receipt unavailable.");
        const insert = (candidate: typeof outcome) =>
          sql(
            `INSERT INTO model_commercial_accounting_outcomes(organization_id,scope_sha256,workflow_id,
        project_id,principal_id,canonical_reservation_id,source_revision,workflow_fingerprint_sha256,dispatch_intent_id,pricing_authority_sha256,
        outcome_kind,source_kind,preview_invocation_id,receipt,outcome,outcome_sha256,ledger_entry_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'settlement','preview-journal',$11,$12::jsonb,$13::jsonb,$14,$15)`,
            [
              f.scope.organizationId,
              f.scope.tenantScopeDigest.slice(7),
              w.request.multiCallWorkflowId,
              f.scope.projectId,
              f.scope.userId,
              modelAccountingPhysicalId("reservation", w),
              w.revision,
              w.fingerprint.slice(7),
              w.dispatchIntent?.dispatchIntentId ?? "missing",
              w.resolvedContext?.estimateResult.pricingAuthority.authorityDigest.slice(
                7,
              ) ?? "missing",
              f.preview.binding.invocationId,
              workflowJson(w.invocationReceipt),
              workflowJson(candidate),
              digestStructuredValue(candidate).slice(7),
              modelTerminalIdentity("terminal", candidate.event),
            ],
          );
        await expect(
          db.transaction((tx) =>
            tx.query(
              insert({
                ...outcome,
                actualCreditUnits: outcome.actualCreditUnits + 1,
                event: {
                  ...outcome.event,
                  chargedCreditUnits: outcome.event.chargedCreditUnits + 1,
                },
              }),
            ),
          ),
        ).rejects.toMatchObject({ code: "23514" });
        await expect(
          db.transaction((tx) => tx.query(insert(outcome))),
        ).rejects.toThrow();
        for (const candidate of [
          {
            ...outcome,
            event: { ...outcome.event, status: "cancelled" as const },
          },
          {
            ...outcome,
            event: {
              ...outcome.event,
              failureCategory: "model-gateway.timeout",
            },
          },
          {
            ...outcome,
            response: { ...outcome.response, state: "released" as const },
          },
          {
            ...outcome,
            event: {
              ...outcome.event,
              inputUnits: outcome.event.inputUnits + 1,
              totalUnits: outcome.event.totalUnits + 1,
            },
          },
        ])
          await expect(
            db.transaction((tx) => tx.query(insert(candidate))),
          ).rejects.toMatchObject({ code: "23514" });
        const canonical = {
          chargingPolicyVersion: charging,
          chargingScenario: "model-preview-delivered-v1" as const,
          actualNormalizedCreditUnits: String(outcome.actualCreditUnits),
          customerChargeCreditUnits: String(outcome.event.chargedCreditUnits),
          idempotencyKey: runtimeTestId("forged"),
          ledgerEntryId: runtimeTestId("forgedledger"),
          requestId: modelAccountingPhysicalId("request", w),
          requestSha256: w.fingerprint.slice(7),
          reservationId: modelAccountingPhysicalId("reservation", w),
          reasonCode: "test.synthetic-forgery",
          providerKey: outcome.event.providerKey,
          modelId: outcome.event.modelId,
          modelVersion: outcome.event.modelVersion,
          pricingVersionId: outcome.event.pricingVersionId,
          estimatedProviderCostMicros: String(
            outcome.event.estimatedProviderCostMicros,
          ),
          providerCostCurrency: "USD",
          inputTokenCount: String(outcome.event.inputUnits),
          outputTokenCount: String(outcome.event.outputUnits),
          cachedInputTokenCount: "0",
        };
        // Neither an ordinary API call nor an invented internal assertion can
        // replace the exact metadata/ledger lineage required by the deferred SQL.
        await expect(
          Promise.resolve().then(() =>
            f.repository.settleReservation(f.accounting, canonical as never),
          ),
        ).rejects.toMatchObject({ code: "invalid-input" });
        await expect(
          db.transaction((tx) =>
            f.repository.terminalModelReservationInTransaction(
              tx,
              f.accounting,
              canonical,
              {
                actualCreditUnits: String(outcome.actualCreditUnits),
                assertCurrent: () => Promise.resolve(),
              },
            ),
          ),
        ).rejects.toMatchObject({ code: "23514" });
        expect(
          (
            await db.query(
              sql(
                "SELECT count(*) AS count FROM model_commercial_accounting_outcomes WHERE organization_id=$1",
                [f.scope.organizationId],
              ),
            )
          ).rows[0]?.["count"],
        ).toBe("0");
        return settle(input);
      });
    const finished = await f.coordinator.execute(f.record.request, (context) =>
      f.generate(context, true),
    );
    await expect(checked.mock.results[0]?.value).resolves.toEqual({
      replayed: false,
    });
    expect(finished.completedCreditUnits).toBe(1);
    expect(checked).toHaveBeenCalledTimes(1);
    expect(f.errors).toEqual([]);
  });
  it("terminal29: SQL rejects malformed model namespaces while retaining the actual namespaced gateway row", async () => {
    const f = await terminalFixture();
    for (const key of [
      "vendor..model",
      "vendor.",
      ".vendor",
      "vendor.2model",
      "a".repeat(65),
    ]) {
      await expect(
        db.query(
          sql(
            `INSERT INTO model_provider_pricing_versions
        SELECT (jsonb_populate_record(NULL::model_provider_pricing_versions,to_jsonb(p)||jsonb_build_object('pricing_version_id',$1::text,'provider_key',$2::text))).*
        FROM model_provider_pricing_versions p WHERE pricing_version_id=$3`,
            [
              runtimeTestId("invalidmodelprice"),
              key,
              f.input.event.pricingVersionId,
            ],
          ),
        ),
      ).rejects.toMatchObject({ code: key.length > 64 ? "22001" : "23514" });
    }
    expect(
      (
        await db.query(
          sql(
            "SELECT provider_key FROM model_provider_pricing_versions WHERE pricing_version_id=$1",
            [f.input.event.pricingVersionId],
          ),
        )
      ).rows[0]?.["provider_key"],
    ).toBe("cloudmarkup.amazon-bedrock");
  });
  it("preserves preexisting canonical rows and validates both exact pricing tuple FKs", async () => {
    const after = (
      await db.query(
        sql(
          "SELECT to_jsonb(r)-ARRAY['pricing_authority','legacy_pricing_version_id','model_pricing_version_id'] AS record,pricing_authority,legacy_pricing_version_id=pricing_version_id AS legacy FROM credit_reservations r WHERE reservation_id=$1",
          [legacyReservationId],
        ),
      )
    ).rows[0];
    expect(after?.["record"]).toEqual(legacyBefore);
    expect(after?.["pricing_authority"]).toBe("legacy-provider-v1");
    expect(after?.["legacy"]).toBe(true);
    const constraints = await db.query(
      sql(
        "SELECT count(*) AS count FROM pg_constraint WHERE conrelid IN ('credit_reservations'::regclass,'usage_ledger_entries'::regclass) AND conname IN ('credit_reservations_legacy_pricing_fk','credit_reservations_model_pricing_fk','usage_ledger_legacy_pricing_fk','usage_ledger_model_pricing_fk') AND convalidated",
      ),
    );
    expect(Number(constraints.rows[0]?.["count"])).toBe(4);
  });
  it("atomically reserves the existing balance once and recovers the exact canonical receipt", async () => {
    const f = await fixture();
    const before = await f.repository.getCreditBalance(f.authorized);
    const outcomes = await Promise.all(
      Array.from({ length: 5 }, () => f.adapter.reserve(f.input)),
    ).catch((error: unknown) => {
      expect(f.errors).toEqual([]);
      throw error;
    });
    expect(outcomes.every((o) => o.accepted)).toBe(true);
    expect(outcomes.filter((o) => !o.replayed)).toHaveLength(1);
    const recovered = await f.adapter.recoverExistingReservation(f.input);
    expect(recovered).toMatchObject({
      kind: "found",
      accountingStatus: "active",
      result: { accepted: true, replayed: true },
    });
    const after = await f.repository.getCreditBalance(f.authorized);
    expect(
      BigInt(before.availableCreditUnits) - BigInt(after.availableCreditUnits),
    ).toBe(BigInt(f.input.requestedCreditUnits));
    const rows = await db.query(
      sql(
        "SELECT count(*) AS count FROM credit_reservations WHERE organization_id=$1",
        [f.scope.organizationId],
      ),
    );
    expect(Number(rows.rows[0]?.["count"])).toBe(1);
    await expectPublicBalance(f);
  });
  it("persists insufficient-credit denial without creating a reservation and never retries it", async () => {
    const f = await fixture(await tenant("0"));
    expect(await f.adapter.reserve(f.input)).toMatchObject({
      accepted: false,
      denialReason: "insufficient-credits",
      replayed: false,
    });
    expect(await f.adapter.reserve(f.input)).toMatchObject({
      accepted: false,
      denialReason: "insufficient-credits",
      replayed: true,
    });
    expect(await f.adapter.recoverExistingReservation(f.input)).toMatchObject({
      kind: "found",
      accountingStatus: "denied",
    });
    expect(
      (
        await db.query(
          sql("SELECT 1 FROM credit_reservations WHERE organization_id=$1", [
            f.scope.organizationId,
          ]),
        )
      ).rowCount,
    ).toBe(0);
  });
  it("recovery-only lookup cannot create a missing decision and altered metadata cannot replay", async () => {
    const f = await fixture();
    expect(await f.adapter.recoverExistingReservation(f.input)).toEqual({
      kind: "not-found",
    });
    await expect(
      f.adapter.reserve({ ...f.input, requestedCreditUnits: 1 }),
    ).rejects.toThrow();
    expect(
      (
        await db.query(
          sql(
            "SELECT 1 FROM model_commercial_reservation_decisions WHERE organization_id=$1",
            [f.scope.organizationId],
          ),
        )
      ).rowCount,
    ).toBe(0);
  });
  it("rejects cross-tenant binding and revoked current membership before any accounting effect", async () => {
    const f = await fixture();
    const other = await fixture();
    await expect(
      new PostgresModelCommercialReservations({
        database: db,
        scope: other.scope,
        binding: f.binding,
      }).reserve(f.input),
    ).rejects.toThrow();
    await db.query(
      sql(
        "UPDATE memberships SET lifecycle_status='suspended' WHERE organization_id=$1 AND principal_id=$2",
        [f.scope.organizationId, f.scope.userId],
      ),
    );
    await expect(f.adapter.reserve(f.input)).rejects.toThrow();
  });
  it("retains model reservations against legacy release/expiry and immutable decision rewrites", async () => {
    const f = await fixture();
    await f.adapter.reserve(f.input);
    const id = modelAccountingPhysicalId("reservation", f.record);
    await expect(
      db.query(
        sql(
          "UPDATE model_commercial_reservation_decisions SET accepted=FALSE,denial_reason='insufficient-credits',canonical_reservation_id=NULL WHERE organization_id=$1",
          [f.scope.organizationId],
        ),
      ),
    ).rejects.toThrow();
    await expect(
      f.repository.expireReservation(f.accounting, {
        reservationId: id,
        ledgerEntryId: runtimeTestId("expire"),
        idempotencyKey: runtimeTestId("expireidem"),
        requestSha256: digestStructuredValue("expire").slice(7),
        chargingPolicyVersion: charging,
      }),
    ).rejects.toThrow();
    expect(await f.adapter.recoverExistingReservation(f.input)).toMatchObject({
      kind: "found",
      accountingStatus: "active",
    });
  });
  it("serializes different workflows against the same canonical concurrency and retains unknown reservations after runtime release", async () => {
    const t = await tenant();
    const capacity = {
      featureRequests: { current: 0, maximum: 100 },
      perUserRequests: { current: 0, maximum: 100 },
      organizationConcurrentReservations: { current: 0, maximum: 1 },
    };
    const a = await fixture(t, "one", { capacity }),
      b = await fixture(t, "two", { capacity });
    const outcomes = await Promise.all([
      a.adapter.reserve(a.input),
      b.adapter.reserve(b.input),
    ]);
    expect(outcomes.filter((o) => o.accepted)).toHaveLength(1);
    expect(outcomes.find((o) => !o.accepted)?.denialReason).toBe(
      "organization-concurrent-reservation-limit-reached",
    );
    const accepted = outcomes[0].accepted ? a : b;
    await accepted.runtimeStore.release({
      executionLease: accepted.runtime.executionLease,
      tenantScopeDigest: accepted.binding.runtimeScopeDigest,
    });
    expect(
      await accepted.adapter.recoverExistingReservation(accepted.input),
    ).toMatchObject({ kind: "found", accountingStatus: "active" });
    const c = await fixture(t, "three", { capacity });
    expect(await c.adapter.reserve(c.input)).toMatchObject({
      accepted: false,
      denialReason: "organization-concurrent-reservation-limit-reached",
    });
  });
  it.each(["featureRequests", "perUserRequests"] as const)(
    "enforces exact persisted half-open %s windows across different workflows",
    async (key) => {
      const t = await tenant();
      const capacity = {
        featureRequests: { current: 0, maximum: 100 },
        perUserRequests: { current: 0, maximum: 100 },
        organizationConcurrentReservations: { current: 0, maximum: 10 },
        [key]: { current: 0, maximum: 1 },
      };
      const a = await fixture(t, "one", { capacity }),
        b = await fixture(t, "two", { capacity });
      expect(await a.adapter.reserve(a.input)).toMatchObject({
        accepted: true,
      });
      expect(await b.adapter.reserve(b.input)).toMatchObject({
        accepted: false,
        denialReason:
          key === "featureRequests"
            ? "feature-limit-reached"
            : "per-user-request-limit-reached",
      });
    },
  );
  it("cannot create a new reservation after execution release; missing recovery remains read-only", async () => {
    const f = await fixture();
    await f.runtimeStore.release({
      executionLease: f.runtime.executionLease,
      tenantScopeDigest: f.binding.runtimeScopeDigest,
    });
    await expect(f.adapter.reserve(f.input)).rejects.toThrow();
    expect(await f.adapter.recoverExistingReservation(f.input)).toEqual({
      kind: "not-found",
    });
  });
  it("rolls back every canonical write when the reserved detail INSERT returns zero rows", async () => {
    const f = await fixture();
    const before = await f.repository.getCreditBalance(f.authorized);
    const database: SqlDatabase = {
      close: () => Promise.resolve(),
      query: db.query.bind(db),
      transaction: (work) =>
        db.transaction((tx) =>
          work({
            query: (statement) =>
              tx.query(
                statement.text.includes("INSERT INTO model_usage_event_details")
                  ? { ...statement, text: statement.text + " AND FALSE" }
                  : statement,
              ),
          }),
        ),
    };
    const adapter = new PostgresModelCommercialReservations({
      database,
      scope: f.scope,
      binding: f.binding,
    });
    await expect(adapter.reserve(f.input)).rejects.toThrow();
    expect(await f.adapter.recoverExistingReservation(f.input)).toEqual({
      kind: "not-found",
    });
    expect(
      (await f.repository.getCreditBalance(f.authorized)).availableCreditUnits,
    ).toBe(before.availableCreditUnits);
    expect(
      (
        await db.query(
          sql("SELECT 1 FROM credit_reservations WHERE organization_id=$1", [
            f.scope.organizationId,
          ]),
        )
      ).rowCount,
    ).toBe(0);
  });
  it("uses final database time and rolls back a reservation stalled across its captured window", async () => {
    const f = await fixture(undefined, runtimeTestId("window"), {
      windowSeconds: 2,
    });
    const ends = f.runtime.snapshot.windows.organization.windowEndsAt;
    const database: SqlDatabase = {
      close: () => Promise.resolve(),
      query: db.query.bind(db),
      transaction: (work) =>
        db.transaction((tx) =>
          work({
            query: async (statement) => {
              if (statement.text.includes("INSERT INTO credit_reservations"))
                await tx.query(
                  sql(
                    "SELECT pg_sleep(GREATEST(0,EXTRACT(EPOCH FROM ($1::timestamptz-clock_timestamp())))+0.05)",
                    [ends],
                  ),
                );
              return tx.query(statement);
            },
          }),
        ),
    };
    await expect(
      new PostgresModelCommercialReservations({
        database,
        scope: f.scope,
        binding: f.binding,
      }).reserve(f.input),
    ).rejects.toThrow();
    expect(await f.adapter.recoverExistingReservation(f.input)).toEqual({
      kind: "not-found",
    });
    expect(
      (
        await db.query(
          sql("SELECT 1 FROM credit_reservations WHERE organization_id=$1", [
            f.scope.organizationId,
          ]),
        )
      ).rowCount,
    ).toBe(0);
  }, 10000);
  it("serializes the last available credits across different workflows without a second balance", async () => {
    const t = await tenant("5");
    const a = await fixture(t, "one"),
      b = await fixture(t, "two");
    const outcomes = await Promise.all([
      a.adapter.reserve(a.input),
      b.adapter.reserve(b.input),
    ]);
    expect(outcomes.filter((o) => o.accepted)).toHaveLength(1);
    expect(outcomes.find((o) => !o.accepted)?.denialReason).toBe(
      "insufficient-credits",
    );
    expect(
      (await t.repository.getCreditBalance(t.authorized)).availableCreditUnits,
    ).toBe("2");
  });
  it("denies direct model-priced canonical reservation writes lacking an accepted decision", async () => {
    const f = await fixture();
    const context = f.record.resolvedContext;
    if (!context) throw new Error("Missing fixture context.");
    await expect(
      db.transaction((tx) =>
        f.repository.reserveModelCreditsInTransaction(
          tx,
          { ...f.accounting, actingPrincipalId: f.scope.userId },
          {
            chargingPolicyVersion: charging,
            entitlementPolicyVersion: entitlement,
            expiresAt: f.input.expiresAt,
            featureKey: "ai-assisted-operations",
            idempotencyKey: runtimeTestId("forgedidem"),
            jobId: f.input.event.jobId,
            modelId: f.input.event.modelId,
            modelVersion: f.input.event.modelVersion,
            planVersionId: plan,
            pricingVersionId: f.input.event.pricingVersionId,
            projectId: f.scope.projectId,
            providerKey: f.input.event.providerKey,
            requestId: modelAccountingPhysicalId("request", f.record),
            requestSha256: f.record.fingerprint.slice(7),
            requestedCreditUnits: String(f.input.requestedCreditUnits),
            reservationId: modelAccountingPhysicalId("reservation", f.record),
          },
          {
            capturedAt: context.estimateResult.pricingAuthority.capturedAt,
            environment: f.input.event.environment,
            inferenceProfileId: f.input.event.inferenceProfileId,
            normalizationPolicyVersionId:
              f.input.event.normalizationPolicyVersionId,
            perUserMaximum: 100,
            assertCurrent: () => Promise.resolve(),
          },
        ),
      ),
    ).rejects.toMatchObject({ code: "23514" });
    expect(
      (
        await db.query(
          sql("SELECT 1 FROM credit_reservations WHERE organization_id=$1", [
            f.scope.organizationId,
          ]),
        )
      ).rowCount,
    ).toBe(0);
    expect(
      (await f.repository.getCreditBalance(f.authorized)).availableCreditUnits,
    ).toBe("100");
  });
  it("requires an explicit denial and replaces supplied decision timestamps with database time", async () => {
    const f = await fixture();
    const insert = (denial: string | null) =>
      db.query(
        sql(
          `INSERT INTO model_commercial_reservation_decisions(organization_id,scope_sha256,workflow_id,project_id,principal_id,intent_id,input_sha256,
      runtime_scope_sha256,runtime_fingerprint_sha256,mapping_version,organization_window_start,organization_window_end,user_window_start,user_window_end,accepted,denial_reason,canonical_reservation_id,created_at)
      SELECT w.organization_id,w.scope_sha256,w.workflow_id,w.project_id,w.principal_id,w.snapshot#>>'{reservationIntent,intentId}',$1::char(64),
      r.scope_sha256,$2::char(64),'intent-extract-runtime-windows-v1',
      (r.snapshot#>>'{originalSnapshot,windows,organization,windowStartedAt}')::timestamptz,(r.snapshot#>>'{originalSnapshot,windows,organization,windowEndsAt}')::timestamptz,
      (r.snapshot#>>'{originalSnapshot,windows,user,windowStartedAt}')::timestamptz,(r.snapshot#>>'{originalSnapshot,windows,user,windowEndsAt}')::timestamptz,FALSE,$3::varchar,NULL,'1970-01-01T00:00:00Z'::timestamptz
      FROM model_commercial_workflows w JOIN model_runtime_admissions r ON r.organization_id=w.organization_id AND r.scope_sha256=$6::char(64)
      WHERE w.organization_id=$4::varchar AND w.workflow_id=$5::varchar`,
          [
            digestStructuredValue(f.input).slice(7),
            f.binding.runtimeFingerprint.slice(7),
            denial,
            f.scope.organizationId,
            f.binding.workflowId,
            f.binding.runtimeScopeDigest.slice(7),
          ],
        ),
      );
    await expect(insert(null)).rejects.toMatchObject({ code: "23514" });
    const before = Date.now();
    expect((await insert("insufficient-credits")).rowCount).toBe(1);
    const row = (
      await db.query(
        sql(
          "SELECT to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS created_at FROM model_commercial_reservation_decisions WHERE organization_id=$1",
          [f.scope.organizationId],
        ),
      )
    ).rows[0];
    expect(Date.parse(String(row?.["created_at"]))).toBeGreaterThanOrEqual(
      before,
    );
  });
  it("preserves legacy release, replay and canonical grant availability after the FK switch", async () => {
    const old = (
      await db.query(
        sql(
          "SELECT request_id FROM credit_reservations WHERE reservation_id=$1",
          [legacyReservationId],
        ),
      )
    ).rows[0];
    const requestId = old?.["request_id"];
    if (typeof requestId !== "string")
      throw new Error("Missing legacy fixture.");
    const input = {
      chargingScenario: "user-cancelled-before-invocation" as const,
      chargingPolicyVersion: charging,
      idempotencyKey: runtimeTestId("legacyrelease"),
      ledgerEntryId: runtimeTestId("legacyterminal"),
      reasonCode: "test.pre-invocation",
      requestId,
      requestSha256: digestStructuredValue("syntheticlegacyrelease").slice(7),
      reservationId: legacyReservationId,
    };
    const released = await legacy.repository.releaseReservation(
      legacy.accounting,
      input,
    );
    expect(released.status).toBe("released");
    expect(
      await legacy.repository.releaseReservation(legacy.accounting, input),
    ).toEqual(released);
    expect(
      (await legacy.repository.getCreditBalance(legacy.authorized))
        .availableCreditUnits,
    ).toBe("100");
  });
});
