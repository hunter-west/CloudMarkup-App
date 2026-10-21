import { setTimeout as delay } from "node:timers/promises";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  digestStructuredValue,
  ModelLiveCommercialLifecycleCoordinatorV2,
} from "@cloudmarkup/model-gateway";
import { createModelAccountingPgTestHarness } from "./model-commercial-accounting-pg-test-helpers.js";
import { createLiveAccountingPgFixture } from "./model-live-commercial-accounting-pg-test-helpers.js";
import {
  commercialClaim,
  commercialHarness,
} from "./model-commercial-workflow-test-helpers.js";
import { PostgresModelLiveCommercialAccounting } from "./model-live-commercial-accounting.js";
import { sql } from "./sql.js";

const configured = process.env["CLOUDMARKUP_TEST_DATABASE_URL"]?.trim();
const integration = configured ? describe : describe.skip;
integration("canonical V2 no-dispatch expiry recovery", () => {
  const harness = createModelAccountingPgTestHarness(configured);
  beforeAll(() => harness.setup(), 60000);
  afterAll(() => harness.teardown(), 30000);
  afterEach(() => vi.restoreAllMocks());
  async function fixture(mode: "standard" | "deep" = "standard") {
    const f = await createLiveAccountingPgFixture(
      harness,
      "100",
      mode,
      undefined,
      { expiresAfterMilliseconds: 5000 },
    );
    const accounting = new PostgresModelLiveCommercialAccounting({
      database: f.database,
      scope: f.scope,
      binding: f.binding,
      plans: f.plans,
      ...f.identity,
    });
    const context = f.record.resolvedContext;
    const pin = context?.estimateResult.pricingAuthority.routePins[0];
    if (context == null || pin == null)
      throw Error("Synthetic canonical prices missing.");
    await f.workflows.releaseExecution({
      lease: f.workflowLease,
      multiCallWorkflowId: f.record.request.multiCallWorkflowId,
      tenantScopeDigest: f.scope.tenantScopeDigest,
    });
    const h = commercialHarness(
      f.workflows,
      f.record.request,
      () => new Date().toISOString(),
      {
        accounting,
        route: context.selectedRoute,
        authorization: context.authorization,
        pricing: pin.pricingVersion,
        normalization: pin.normalizationPolicy,
      },
    );
    // No output was dispatched. This unavailable test port issues no receipt;
    // its calls are asserted absent on the fresh expiry path.
    const invocationRecovery = vi.fn(() =>
      Promise.resolve({ kind: "unavailable" as const }),
    );
    const coordinator = new ModelLiveCommercialLifecycleCoordinatorV2({
      ...h.dependencies,
      commercialRequest: f.record.request,
      admissionRequest: f.runtime.request,
      invocationRecovery: { recoverVerified: invocationRecovery },
      terminalRecovery: accounting,
    });
    const reserve = accounting.reserve.bind(accounting);
    vi.spyOn(accounting, "reserve").mockImplementationOnce(async (input) => {
      const result = await reserve(input);
      await delay(Math.max(0, Date.parse(input.expiresAt) - Date.now()) + 30);
      return result;
    });
    const invoke = vi.fn(() =>
      Promise.reject(Error("No provider callback is permitted.")),
    );
    const input = {
      request: f.record.request,
      requestDigest: f.record.fingerprint,
      admissionRequest: f.runtime.request,
    };
    const effects = async () =>
      (
        await harness.database.query(
          sql(
            "SELECT r.status,e.entry_kind,e.settled_credit_units,e.normalized_credit_units,e.estimated_provider_cost_micros,e.reason_code,d.input_units,d.output_units,d.total_units,d.attempts,o.source_kind FROM credit_reservations r JOIN usage_ledger_entries e ON e.organization_id=r.organization_id AND e.reservation_id=r.reservation_id LEFT JOIN model_usage_event_details d ON d.organization_id=e.organization_id AND d.ledger_entry_id=e.ledger_entry_id LEFT JOIN model_commercial_accounting_outcomes o ON o.organization_id=e.organization_id AND o.ledger_entry_id=e.ledger_entry_id WHERE r.organization_id=$1 ORDER BY e.entry_kind",
            [f.scope.organizationId],
          ),
        )
      ).rows;
    return {
      ...f,
      accounting,
      coordinator,
      input,
      effects,
      invoke,
      invocationRecovery,
    };
  }
  it.each(["standard", "deep"] as const)(
    "releases %s once from the real coordinator proof after runtime expiry",
    async (mode) => {
      const f = await fixture(mode);
      const before = await f.persistedRuntime();
      const result = await f.coordinator.execute(f.record.request, f.invoke);
      expect(result).toMatchObject({
        state: "released",
        completedCreditUnits: 0,
        compensationStatus: "not-required",
      });
      expect(f.invoke).not.toHaveBeenCalled();
      expect(f.invocationRecovery).not.toHaveBeenCalled();
      expect(Date.now()).toBeGreaterThan(
        Date.parse(f.record.request.expiresAt),
      );
      const recovered = await Promise.all([
        f.accounting.recoverVerified(f.input),
        f.accounting.recoverVerified(f.input),
      ]);
      expect(recovered[0]).toEqual(recovered[1]);
      expect(recovered[0]).toMatchObject({
        kind: "verified",
        authority: "canonical-model-live-terminal-v2",
        outcome: {
          kind: "release",
          event: {
            attempts: [],
            chargedCreditUnits: 0,
            estimatedProviderCostMicros: 0,
          },
        },
      });
      expect(await f.coordinator.recover(f.record.request)).toEqual(result);
      expect((await f.effects()).map((r) => r["entry_kind"])).toEqual([
        "release",
        "reservation",
      ]);
      expect((await f.effects())[0]).toMatchObject({
        status: "released",
        settled_credit_units: "0",
        normalized_credit_units: null,
        estimated_provider_cost_micros: null,
        reason_code: "model.reservation.expired-before-dispatch",
        input_units: "0",
        output_units: "0",
        total_units: "0",
        attempts: [],
        source_kind: "workflow-receipt",
      });
      expect(await f.persistedRuntime()).toEqual(before);
      expect(
        (await f.repository.getCreditBalance(f.authorized))
          .availableCreditUnits,
      ).toBe("100");
      expect(
        (
          await harness.database.query(
            sql(
              "SELECT 1 FROM model_live_invocations WHERE organization_id=$1",
              [f.scope.organizationId],
            ),
          )
        ).rowCount,
      ).toBe(0);
      expect(f.errors).toEqual([]);
    },
    15000,
  );
  it("does not treat a missing journal or an expired timestamp as proof", async () => {
    const f = await fixture();
    expect(await f.accounting.recoverVerified(f.input)).toEqual({
      kind: "unavailable",
    });
    const claimed = await f.workflows.claimExecution(
      commercialClaim(f.record.request),
    );
    expect(claimed.kind).toBe("acquired");
    const reserved = await f.adapter.reserve(f.fixture.input);
    expect(reserved.accepted).toBe(true);
    await delay(
      Math.max(0, Date.parse(f.record.request.expiresAt) - Date.now()) + 30,
    );
    expect(await f.accounting.recoverVerified(f.input)).toEqual({
      kind: "unavailable",
    });
    expect((await f.effects()).map((row) => row["entry_kind"])).toEqual([
      "reservation",
    ]);
    expect(f.invoke).not.toHaveBeenCalled();
  }, 15000);
  it("rolls back a rejected ledger detail and recovers the original expiry proof", async () => {
    const f = await fixture();
    const release = f.accounting.release.bind(f.accounting);
    vi.spyOn(f.accounting, "release").mockImplementationOnce((input) => {
      f.corruptNextTerminalDetail();
      return release(input);
    });
    await expect(
      f.coordinator.execute(f.record.request, f.invoke),
    ).rejects.toThrow();
    expect(f.errors.length).toBeGreaterThan(0);
    expect((await f.effects()).map((r) => r["entry_kind"])).toEqual([
      "reservation",
    ]);
    expect(
      (
        await harness.database.query(
          sql(
            "SELECT 1 FROM model_commercial_accounting_outcomes WHERE organization_id=$1",
            [f.scope.organizationId],
          ),
        )
      ).rowCount,
    ).toBe(0);
    expect(await f.accounting.recoverVerified(f.input)).toMatchObject({
      kind: "verified",
      outcome: { kind: "release" },
    });
    expect((await f.effects()).map((r) => r["entry_kind"])).toEqual([
      "release",
      "reservation",
    ]);
    expect(f.invoke).not.toHaveBeenCalled();
  }, 15000);
  it("recovers persisted no-dispatch evidence after operator withdrawal without dispatching", async () => {
    const f = await fixture();
    vi.spyOn(f.accounting, "release").mockRejectedValueOnce(
      Error("Synthetic interruption before terminal transaction."),
    );
    await expect(
      f.coordinator.execute(f.record.request, f.invoke),
    ).rejects.toThrow();
    f.removeOperators();
    expect(await f.accounting.recoverVerified(f.input)).toMatchObject({
      kind: "verified",
      outcome: { kind: "release" },
    });
    expect((await f.effects()).map((r) => r["entry_kind"])).toEqual([
      "release",
      "reservation",
    ]);
    expect(f.invoke).not.toHaveBeenCalled();
  }, 15000);
  it("requires current membership and exact request identity for expiry recovery", async () => {
    const f = await fixture();
    vi.spyOn(f.accounting, "release").mockRejectedValueOnce(
      Error("Synthetic interruption."),
    );
    await expect(
      f.coordinator.execute(f.record.request, f.invoke),
    ).rejects.toThrow();
    await expect(
      f.accounting.recoverVerified({
        ...f.input,
        requestDigest: digestStructuredValue("substituted"),
      }),
    ).rejects.toThrow();
    await harness.database.query(
      sql(
        "UPDATE memberships SET lifecycle_status='suspended' WHERE organization_id=$1 AND principal_id=$2",
        [f.scope.organizationId, f.scope.userId],
      ),
    );
    await expect(f.accounting.recoverVerified(f.input)).rejects.toThrow();
    expect((await f.effects()).map((r) => r["entry_kind"])).toEqual([
      "reservation",
    ]);
    expect(f.invoke).not.toHaveBeenCalled();
  }, 15000);
});
