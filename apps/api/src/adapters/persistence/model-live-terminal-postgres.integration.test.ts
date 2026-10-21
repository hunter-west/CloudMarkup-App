import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  digestStructuredValue,
  projectModelCommercialRecoveredInvocationRecordV1,
  projectModelCommercialTerminalOutcomeV1,
} from "@cloudmarkup/model-gateway";
import { createModelAccountingPgTestHarness } from "./model-commercial-accounting-pg-test-helpers.js";
import { createLiveJournalPgFixture } from "./model-live-invocation-journal-pg-test-helpers.js";
import { PostgresModelLiveCommercialAccounting } from "./model-live-commercial-accounting.js";
import { sql } from "./sql.js";

const configured = process.env["CLOUDMARKUP_TEST_DATABASE_URL"]?.trim();
const integration = configured ? describe : describe.skip;
integration("canonical V2 failed-invocation accounting", () => {
  const harness = createModelAccountingPgTestHarness(configured);
  beforeAll(() => harness.setup(), 60000);
  afterAll(() => harness.teardown(), 30000);
  const fixture = async (mode: "standard" | "deep" = "standard") => {
    const f = await createLiveJournalPgFixture(harness, mode);
    const accounting = new PostgresModelLiveCommercialAccounting({
      database: harness.database,
      scope: f.scope,
      binding: f.binding,
      plans: f.plans,
      ...f.identity,
    });
    const input = {
      request: f.record.request,
      requestDigest: f.record.fingerprint,
      admissionRequest: f.runtime.request,
    };
    const fail = async (known = true) => {
      await f.journal.prepare(f.callback);
      await f.journal.claim(f.claim);
      if (known) await f.journal.record(f.usage);
      await f.journal.fail(f.claim, "model-gateway.internal-error");
    };
    const effects = async () =>
      (
        await harness.database.query(
          sql(
            "SELECT r.status,e.entry_kind,e.settled_credit_units,e.normalized_credit_units,e.estimated_provider_cost_micros,d.compensated_credit_units FROM credit_reservations r JOIN usage_ledger_entries e ON e.organization_id=r.organization_id AND e.reservation_id=r.reservation_id LEFT JOIN model_usage_event_details d ON d.organization_id=e.organization_id AND d.ledger_entry_id=e.ledger_entry_id WHERE r.organization_id=$1 ORDER BY e.entry_kind",
            [f.scope.organizationId],
          ),
        )
      ).rows;
    return { ...f, accounting, terminalInput: input, fail, effects };
  };
  it.each(["standard", "deep"] as const)(
    "releases %s failure once with exact compensated usage and no workflow rewrite",
    async (mode) => {
      const f = await fixture(mode);
      await f.fail();
      const before = await f.persistedRuntime();
      const results = await Promise.all([
        f.accounting.recoverVerified(f.terminalInput),
        f.accounting.recoverVerified(f.terminalInput),
      ]);
      expect(results[0]).toEqual(results[1]);
      expect(results[0]).toMatchObject({
        kind: "verified",
        authority: "canonical-model-live-terminal-v2",
        evaluation: { evaluationCaseId: f.runtime.request.evaluationCaseId },
        outcome: {
          kind: "release",
          event: {
            chargedCreditUnits: 0,
            inputUnits: Number(f.usage.inputUnits),
          },
        },
      });
      const effects = await f.effects();
      expect(effects.map((row) => row["entry_kind"])).toEqual([
        "release",
        "reservation",
      ]);
      expect(effects[0]).toMatchObject({
        status: "released",
        settled_credit_units: "0",
      });
      expect(Number(effects[0]?.["compensated_credit_units"])).toBeGreaterThan(
        0,
      );
      expect(await f.persistedRuntime()).toEqual(before);
      expect(await f.journal.claim(f.claim)).toEqual({
        kind: "duplicate-result-unavailable",
      });
      const stored = await harness.database.query(
        sql(
          "SELECT snapshot FROM model_commercial_workflows WHERE organization_id=$1",
          [f.scope.organizationId],
        ),
      );
      expect(digestStructuredValue(stored.rows[0]?.["snapshot"])).toBe(
        digestStructuredValue(f.dispatched),
      );
    },
  );
  it("keeps unknown usage held and releases only when its actual receipt arrives", async () => {
    const f = await fixture();
    await f.fail(false);
    expect(await f.accounting.recoverVerified(f.terminalInput)).toEqual({
      kind: "unavailable",
    });
    expect((await f.effects()).map((r) => r["entry_kind"])).toEqual([
      "reservation",
    ]);
    f.removeOperators();
    await f.journal.record(f.usage);
    expect(await f.accounting.recoverVerified(f.terminalInput)).toMatchObject({
      kind: "verified",
      outcome: { kind: "release" },
    });
  });
  it("keeps generated output pending without validator authority", async () => {
    const f = await fixture();
    await f.journal.prepare(f.callback);
    await f.journal.claim(f.claim);
    await f.journal.record(f.usage);
    await f.journal.complete(f.claim, f.gatewayResult);
    expect(await f.accounting.recoverVerified(f.terminalInput)).toEqual({
      kind: "unavailable",
    });
    expect((await f.effects()).map((r) => r["entry_kind"])).toEqual([
      "reservation",
    ]);
  });
  it("denies substituted request and case metadata without a credit effect", async () => {
    const f = await fixture();
    await f.fail();
    await expect(
      f.accounting.recoverVerified({
        ...f.terminalInput,
        requestDigest: "sha256:" + "a".repeat(64),
      }),
    ).rejects.toThrow();
    await expect(
      f.accounting.recoverVerified({
        ...f.terminalInput,
        admissionRequest: {
          ...f.terminalInput.admissionRequest,
          evaluationCaseId: "different-case",
        },
      }),
    ).rejects.toThrow();
    expect((await f.effects()).map((r) => r["entry_kind"])).toEqual([
      "reservation",
    ]);
  });
  it("requires current execution membership for historical financial recovery", async () => {
    const f = await fixture();
    await f.fail();
    await harness.database.query(
      sql(
        "UPDATE memberships SET lifecycle_status='suspended' WHERE organization_id=$1 AND principal_id=$2",
        [f.scope.organizationId, f.scope.userId],
      ),
    );
    await expect(
      f.accounting.recoverVerified(f.terminalInput),
    ).rejects.toThrow();
    expect((await f.effects()).map((r) => r["entry_kind"])).toEqual([
      "reservation",
    ]);
  });
  it.each(["detail", "source"] as const)(
    "rolls back an SQL-rejected %s and recovers once from the original journal",
    async (kind) => {
      const f = await fixture();
      await f.fail();
      if (kind === "detail") f.corruptNextTerminalDetail();
      else f.corruptNextTerminalSource();
      await expect(
        f.accounting.recoverVerified(f.terminalInput),
      ).rejects.toThrow();
      expect(f.errors.length).toBeGreaterThan(0);
      expect((await f.effects()).map((r) => r["entry_kind"])).toEqual([
        "reservation",
      ]);
      const outcomes = await harness.database.query(
        sql(
          "SELECT 1 FROM model_commercial_accounting_outcomes WHERE organization_id=$1",
          [f.scope.organizationId],
        ),
      );
      expect(outcomes.rowCount).toBe(0);
      expect(await f.accounting.recoverVerified(f.terminalInput)).toMatchObject(
        { kind: "verified", outcome: { kind: "release" } },
      );
      expect((await f.effects()).map((r) => r["entry_kind"])).toEqual([
        "release",
        "reservation",
      ]);
    },
  );
  it("verifies SQL generation metadata against recorded usage", async () => {
    const f = await fixture();
    await f.fail();
    const row = await f.row();
    const generation = row?.["generation_evidence"];
    const check = async (value: unknown) =>
      (
        await harness.database.query(
          sql(
            "SELECT cloudmarkup_live_failed_generation_matches($1::jsonb,$2::jsonb) AS matches",
            [JSON.stringify(value), JSON.stringify(generation)],
          ),
        )
      ).rows[0]?.["matches"];
    expect(await check(f.usage)).toBe(true);
    for (const changed of [
      { ...f.usage, outputUnits: String(Number(f.usage.outputUnits) + 1) },
      { ...f.usage, invocationId: "different-invocation" },
      { ...f.usage, modelId: "different-model" },
      { ...f.usage, result: "provider-error" },
    ])
      expect(await check(changed)).toBe(false);
  });
  it("rejects another tenant's plan-store authority before ledger mutation", async () => {
    const f = await fixture();
    await f.fail();
    const other = await fixture();
    const substituted = new PostgresModelLiveCommercialAccounting({
      database: harness.database,
      scope: f.scope,
      binding: f.binding,
      plans: other.plans,
      ...f.identity,
    });
    await expect(
      substituted.recoverVerified(f.terminalInput),
    ).rejects.toThrow();
    expect((await f.effects()).map((r) => r["entry_kind"])).toEqual([
      "reservation",
    ]);
  });

  it("releases the current coordinator receipt and replays without another credit effect", async () => {
    const f = await fixture();
    await f.fail();
    const evidence = await f.journal.recoverVerified(f.recoveryInput);
    if (evidence.kind !== "verified")
      throw Error("Synthetic failed receipt unavailable");
    const at = new Date().toISOString();
    const projected = projectModelCommercialRecoveredInvocationRecordV1(
      f.dispatched,
      evidence.result,
      at,
    );
    const saved = await f.workflows.compareAndSet({
      expectedRevision: f.dispatched.revision,
      lease: f.workflowLease,
      record: projected,
      tenantScopeDigest: f.scope.tenantScopeDigest,
      trustedNow: at,
    });
    const outcome = projectModelCommercialTerminalOutcomeV1(saved, false);
    expect(outcome.kind).toBe("release");
    expect(await f.accounting.release({ event: outcome.event })).toEqual({
      replayed: false,
    });
    expect(await f.accounting.release({ event: outcome.event })).toEqual({
      replayed: true,
    });
    expect(await f.accounting.recoverVerified(f.terminalInput)).toMatchObject({
      kind: "verified",
      outcome,
    });
  });
});
