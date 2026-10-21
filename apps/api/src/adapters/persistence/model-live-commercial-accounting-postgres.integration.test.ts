import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { digestStructuredValue } from "@cloudmarkup/model-gateway";
import { PostgresModelCommercialReservations } from "./model-commercial-accounting.js";
import { createModelAccountingPgTestHarness } from "./model-commercial-accounting-pg-test-helpers.js";
import { createLiveAccountingPgFixture } from "./model-live-commercial-accounting-pg-test-helpers.js";
import { sql } from "./sql.js";

const configured = process.env["CLOUDMARKUP_TEST_DATABASE_URL"]?.trim();
const integration = configured ? describe : describe.skip;
integration(
  "V2 evaluations reserve the canonical PostgreSQL credit ledger",
  () => {
    const harness = createModelAccountingPgTestHarness(configured);
    beforeAll(() => harness.setup(), 60000);
    afterAll(() => harness.teardown(), 30000);
    async function counts(organizationId: string) {
      return (
        await harness.database.query(
          sql(
            `SELECT (SELECT count(*)::int FROM model_commercial_reservation_decisions WHERE organization_id=$1) AS decisions,
      (SELECT count(*)::int FROM credit_reservations WHERE organization_id=$1) AS reservations,
      (SELECT count(*)::int FROM usage_ledger_entries WHERE organization_id=$1 AND entry_kind='reservation') AS ledger`,
            [organizationId],
          ),
        )
      ).rows[0];
    }
    it("reserves once under concurrent retries and persists exact bounded metadata", async () => {
      const f = await createLiveAccountingPgFixture(harness);
      const results = await Promise.all([
        f.adapter.reserve(f.input),
        f.adapter.reserve(f.input),
      ]);
      expect(f.errors).toEqual([]);
      expect(results.map((r) => r.replayed).sort()).toEqual([false, true]);
      expect(results.every((r) => r.accepted)).toBe(true);
      expect(await counts(f.scope.organizationId)).toEqual({
        decisions: 1,
        reservations: 1,
        ledger: 1,
      });
      expect(await f.adapter.recoverExistingReservation(f.input)).toMatchObject(
        {
          kind: "found",
          accountingStatus: "active",
          result: { accepted: true, replayed: true },
        },
      );
      const row = (
        await harness.database.query(
          sql(
            "SELECT mapping_version,live_binding,live_binding_sha256 FROM model_commercial_reservation_decisions WHERE organization_id=$1",
            [f.scope.organizationId],
          ),
        )
      ).rows[0];
      expect(row).toEqual({
        mapping_version: "live-evaluation-runtime-windows-v2",
        live_binding: f.binding,
        live_binding_sha256: digestStructuredValue(f.binding).slice(7),
      });
      expect(JSON.stringify(row)).not.toContain('"requirements"');
      expect(JSON.stringify(row)).not.toContain('"candidate"');
    });
    it("reserves the explicitly approved Deep route using the same canonical ledger", async () => {
      const f = await createLiveAccountingPgFixture(harness, "100", "deep");
      expect(f.record.request.requestedRoute).toBe("deep");
      expect(f.binding.routingDecision.routeId).toBe("deep-design");
      expect(await f.adapter.reserve(f.input)).toMatchObject({
        accepted: true,
        replayed: false,
      });
      expect(f.errors).toEqual([]);
      expect(await counts(f.scope.organizationId)).toEqual({
        decisions: 1,
        reservations: 1,
        ledger: 1,
      });
    });
    it.each(["revocation", "operators", "configuration"] as const)(
      "recovers existing reservations after %s without granting new authority",
      async (withdrawal) => {
        const f = await createLiveAccountingPgFixture(harness);
        await f.adapter.reserve(f.input);
        if (withdrawal === "revocation") await f.plans.revoke(f.identity);
        else if (withdrawal === "operators") f.removeOperators();
        else f.removeConfiguration();
        expect(
          await f.adapter.recoverExistingReservation(f.input),
        ).toMatchObject({ kind: "found", accountingStatus: "active" });
        expect(await f.adapter.reserve(f.input)).toMatchObject({
          accepted: true,
          replayed: true,
        });
        await expect(f.plans.requireCurrent(f.identity)).rejects.toThrow();
        expect(await counts(f.scope.organizationId)).toEqual({
          decisions: 1,
          reservations: 1,
          ledger: 1,
        });
      },
    );
    it("denies new reservations after revocation without changing the ledger", async () => {
      const f = await createLiveAccountingPgFixture(harness);
      await f.plans.revoke(f.identity);
      await expect(f.adapter.reserve(f.input)).rejects.toThrow();
      expect(await counts(f.scope.organizationId)).toEqual({
        decisions: 0,
        reservations: 0,
        ledger: 0,
      });
    });
    it("rolls back reservation, allocation and ledger when approval changes during the transaction", async () => {
      const f = await createLiveAccountingPgFixture(harness);
      f.withdrawDuringReservation();
      await expect(f.adapter.reserve(f.input)).rejects.toThrow();
      expect(await counts(f.scope.organizationId)).toEqual({
        decisions: 0,
        reservations: 0,
        ledger: 0,
      });
      expect(
        (
          await harness.database.query(
            sql(
              "SELECT count(*)::int AS count FROM credit_reservation_allocations WHERE organization_id=$1",
              [f.scope.organizationId],
            ),
          )
        ).rows[0]?.["count"],
      ).toBe(0);
    });
    it("records insufficient canonical credits as an immutable denial", async () => {
      const f = await createLiveAccountingPgFixture(harness, "0");
      expect(await f.adapter.reserve(f.input)).toMatchObject({
        accepted: false,
        denialReason: "insufficient-credits",
      });
      expect(await f.adapter.reserve(f.input)).toMatchObject({
        accepted: false,
        replayed: true,
      });
      expect(await counts(f.scope.organizationId)).toEqual({
        decisions: 1,
        reservations: 0,
        ledger: 0,
      });
    });
    it("keeps V1 accounting and V2 terminal settlement unavailable for evaluation work", async () => {
      const f = await createLiveAccountingPgFixture(harness);
      const { routingDecision, ...binding } = f.binding;
      void routingDecision;
      const normal = new PostgresModelCommercialReservations({
        database: harness.database,
        scope: f.scope,
        binding,
      });
      await expect(normal.reserve(f.input)).rejects.toThrow();
      expect("settle" in f.adapter).toBe(false);
      expect("release" in f.adapter).toBe(false);
      expect("recoverVerified" in f.adapter).toBe(false);
      expect(await counts(f.scope.organizationId)).toEqual({
        decisions: 0,
        reservations: 0,
        ledger: 0,
      });
    });
    it("requires the current execution membership even for historical recovery", async () => {
      const f = await createLiveAccountingPgFixture(harness);
      await f.adapter.reserve(f.input);
      await harness.database.query(
        sql(
          "UPDATE principals SET lifecycle_status='suspended' WHERE principal_id=$1",
          [f.scope.userId],
        ),
      );
      await expect(
        f.adapter.recoverExistingReservation(f.input),
      ).rejects.toThrow();
      expect(await counts(f.scope.organizationId)).toEqual({
        decisions: 1,
        reservations: 1,
        ledger: 1,
      });
    });
    it("preserves immutable decision rows and all preexisting legacy reservation bytes", async () => {
      const f = await createLiveAccountingPgFixture(harness);
      await f.adapter.reserve(f.input);
      await expect(
        harness.database.query(
          sql(
            "UPDATE model_commercial_reservation_decisions SET live_binding_sha256=$2 WHERE organization_id=$1",
            [f.scope.organizationId, "0".repeat(64)],
          ),
        ),
      ).rejects.toThrow();
      expect(
        (
          await harness.database.query(
            sql(
              "SELECT to_jsonb(r)-ARRAY['pricing_authority','legacy_pricing_version_id','model_pricing_version_id'] AS record FROM credit_reservations r WHERE reservation_id=$1",
              [harness.legacyReservationId],
            ),
          )
        ).rows[0]?.["record"],
      ).toEqual(harness.legacyBefore);
    });
    it.each([
      ["entitlement", "planVersionId"],
      ["route", "modelId"],
      ["route", "modelVersion"],
      ["route", "providerId"],
      ["route", "inferenceProfileId"],
      ["route", "routeId"],
      ["route", "modelConfigurationReference"],
      ["workflow", "feature"],
      ["workflow", "promptId"],
      ["workflow", "promptVersion"],
      ["workflow", "requestedRoute"],
      ["admission", "evaluationCaseId"],
      ["admission", "liveEvaluationPlanDigest"],
    ] as const)(
      "SQL independently rejects %s %s substitutions",
      async (target, field) => {
        const f = await createLiveAccountingPgFixture(harness);
        const workflow = structuredClone(f.record),
          runtime = structuredClone(f.runtime),
          binding = structuredClone(f.binding);
        const root =
          target === "entitlement"
            ? binding.routingDecision.entitlement
            : target === "route"
              ? binding.routingDecision
              : target === "workflow"
                ? workflow.request
                : runtime.request;
        Object.assign(root, { [field]: "synthetic.substitution" });
        const result = await harness.database.query(
          sql(
            "SELECT cloudmarkup_live_accounting_binding_valid($1::jsonb,$2::jsonb,$3::jsonb,$4::jsonb) AS valid",
            [
              JSON.stringify(workflow),
              JSON.stringify(runtime),
              JSON.stringify(binding),
              JSON.stringify(f.plan),
            ],
          ),
        );
        expect(result.rows[0]?.["valid"]).toBe(false);
      },
    );
  },
);
