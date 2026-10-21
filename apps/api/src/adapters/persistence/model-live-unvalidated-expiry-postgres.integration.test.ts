import { setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createModelAccountingPgTestHarness } from "./model-commercial-accounting-pg-test-helpers.js";
import { createLiveJournalPgFixture } from "./model-live-invocation-journal-pg-test-helpers.js";
import { PostgresModelLiveCommercialAccounting } from "./model-live-commercial-accounting.js";
import { sql } from "./sql.js";

const configured = process.env["CLOUDMARKUP_TEST_DATABASE_URL"]?.trim();
const integration = configured ? describe : describe.skip;
/** Synthetic provider usage; actual issued plans, journal locks, immutable
 * reservation deadlines and canonical PostgreSQL ledger transitions. */
integration("known completed evaluation without validation receipt", () => {
  const harness = createModelAccountingPgTestHarness(configured);
  beforeAll(() => harness.setup(), 60000);
  afterAll(() => harness.teardown(), 30000);
  async function fixture(mode: "standard" | "deep" = "standard") {
    const f = await createLiveJournalPgFixture(harness, mode, undefined, {
      expiresAfterMilliseconds: 8000,
    });
    const accounting = new PostgresModelLiveCommercialAccounting({
      database: f.database,
      scope: f.scope,
      binding: f.binding,
      plans: f.plans,
      ...f.identity,
    });
    await f.journal.prepare(f.callback);
    expect(await f.journal.claim(f.claim)).toEqual({ kind: "claimed" });
    const input = {
      request: f.record.request,
      requestDigest: f.record.fingerprint,
      admissionRequest: f.runtime.request,
    };
    const expire = () =>
      delay(
        Math.max(0, Date.parse(f.record.request.expiresAt) - Date.now()) + 40,
      );
    const journal = async () =>
      (
        await harness.database.query(
          sql("SELECT * FROM model_live_invocations WHERE organization_id=$1", [
            f.scope.organizationId,
          ]),
        )
      ).rows;
    const effects = async () =>
      (
        await harness.database.query(
          sql(
            "SELECT entry_kind,settled_credit_units,estimated_provider_cost_micros FROM usage_ledger_entries WHERE organization_id=$1 AND pricing_authority='model-provider-v1' ORDER BY entry_kind",
            [f.scope.organizationId],
          ),
        )
      ).rows;
    return { ...f, accounting, input, expire, journalRows: journal, effects };
  }
  it.each(["standard", "deep"] as const)(
    "compensates %s known usage once after the actual deadline without rewriting completion",
    async (mode) => {
      const f = await fixture(mode);
      await f.journal.record(f.usage);
      await f.journal.complete(f.claim, f.gatewayResult);
      const before = await f.journalRows();
      expect(before[0]?.["gateway_state"]).toBe("complete");
      expect(await f.accounting.recoverVerified(f.input)).toEqual({
        kind: "unavailable",
      });
      await f.expire();
      f.removeOperators();
      const results = await Promise.all([
        f.accounting.recoverVerified(f.input),
        f.accounting.recoverVerified(f.input),
      ]);
      expect(results[0]).toEqual(results[1]);
      expect(results[0]).toMatchObject({
        kind: "verified",
        outcome: {
          kind: "release",
          event: {
            status: "internal-failure",
            failureCategory:
              "cloudmarkup.model-evaluation.validation-unavailable",
            chargedCreditUnits: 0,
          },
        },
      });
      expect(await f.journalRows()).toEqual(before);
      expect((await f.effects()).map((entry) => entry["entry_kind"])).toEqual([
        "release",
        "reservation",
      ]);
      expect((await f.effects())[0]?.["settled_credit_units"]).toBe("0");
      expect(
        Number((await f.effects())[0]?.["estimated_provider_cost_micros"]),
      ).toBeGreaterThan(0);
      expect(
        (
          await harness.database.query(
            sql(
              "SELECT * FROM model_live_proposal_validation_receipts WHERE organization_id=$1",
              [f.scope.organizationId],
            ),
          )
        ).rowCount,
      ).toBe(0);
      expect(
        (await f.repository.getCreditBalance(f.authorized))
          .availableCreditUnits,
      ).toBe("100");
    },
    30000,
  );
  it("retains unknown usage after the same deadline", async () => {
    const f = await fixture();
    const before = await f.journalRows();
    await f.expire();
    expect(await f.accounting.recoverVerified(f.input)).toEqual({
      kind: "unavailable",
    });
    expect(await f.journalRows()).toEqual(before);
    expect((await f.effects()).map((entry) => entry["entry_kind"])).toEqual([
      "reservation",
    ]);
  }, 30000);
  it("rolls back a substituted terminal source then permits genuine recovery", async () => {
    const f = await fixture();
    await f.journal.record(f.usage);
    await f.journal.complete(f.claim, f.gatewayResult);
    await f.expire();
    f.corruptNextTerminalSource();
    await expect(f.accounting.recoverVerified(f.input)).rejects.toThrow();
    expect((await f.effects()).map((entry) => entry["entry_kind"])).toEqual([
      "reservation",
    ]);
    await expect(f.accounting.recoverVerified(f.input)).resolves.toMatchObject({
      kind: "verified",
      outcome: { kind: "release" },
    });
  }, 30000);
});
