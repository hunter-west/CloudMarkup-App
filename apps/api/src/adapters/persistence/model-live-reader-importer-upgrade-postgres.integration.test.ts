import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { digestStructuredValue } from "@cloudmarkup/model-gateway";
import { runMigrations } from "./migrations.js";
import { loadHistoricalBetaMigrations } from "./historical-beta-migrations-test-helper.js";
import { createModelAccountingPgTestHarness } from "./model-commercial-accounting-pg-test-helpers.js";
import { createLiveAccountingPgSeed } from "./model-live-commercial-accounting-pg-test-helpers.js";
import { PostgresModelLiveInvocationSets } from "./model-live-invocation-sets.js";
import { persistedExportRunFixture } from "./solution-export-run-test-helpers.js";
import { sql } from "./sql.js";

const configured = process.env["CLOUDMARKUP_TEST_DATABASE_URL"]?.trim();
const integration = configured ? describe : describe.skip;

/** Real registered migrations and SQL-issued synthetic plans/revisions/jobs.
 * No model, new quality grade, compiled-artifact claim or cloud write. */
integration("registered0055 to0057 evaluation metadata upgrade", () => {
  const harness = createModelAccountingPgTestHarness(configured, "0055");
  beforeAll(() => harness.setup(), 120000);
  afterAll(() => harness.teardown(), 30000);
  const tables = [
    "principals",
    "organizations",
    "memberships",
    "projects",
    "commercial_plan_versions",
    "commercial_plan_feature_entitlements",
    "commercial_plan_numeric_limits",
    "commercial_plan_included_credit_grants",
    "commercial_plan_seat_rules",
    "organization_subscription_projections",
    "credit_grants",
    "credit_reservations",
    "usage_ledger_entries",
    "stored_objects",
    "architecture_drafts",
    "architecture_revisions",
    "solution_records",
    "solution_export_runs",
    "solution_export_artifacts",
    "solution_export_artifact_files",
    "solution_export_download_grants",
    "model_live_evaluation_plans",
    "model_live_evaluation_revocations",
    "model_live_invocations",
    "model_live_proposal_validation_receipts",
    "model_commercial_workflows",
    "model_commercial_accounting_outcomes",
  ] as const;
  async function snapshot() {
    const records = await Promise.all(
      tables.map(async (table) => {
        // Fixed source-owned table names only; no identifier comes from a request.
        const rows = await harness.database.query(
          sql(
            "SELECT to_jsonb(x) AS record FROM " +
              table +
              " x ORDER BY to_jsonb(x)::text",
          ),
        );
        return [table, rows.rows] as const;
      }),
    );
    return Object.fromEntries(records);
  }
  async function ledger() {
    return (
      await harness.database.query(
        sql(
          "SELECT version,checksum_sha256,applied_at FROM cloudmarkup_schema_migrations ORDER BY version",
        ),
      )
    ).rows;
  }
  it("keeps original plans, credits, saved manifests and both export targets exact through upgrade and replay", async () => {
    const migrations = await loadHistoricalBetaMigrations(
      fileURLToPath(new URL("../../../migrations", import.meta.url)),
    );
    const live = await createLiveAccountingPgSeed(harness);
    const exports = await Promise.all([
      persistedExportRunFixture(harness.database, "terraform"),
      persistedExportRunFixture(harness.database, "cloudformation"),
    ]);
    for (const f of exports) {
      await f.createRoot();
      await f.repository.insertPreparedRun(f.prepared);
    }
    const original = await snapshot(),
      originalLedger = await ledger();
    expect(originalLedger).toHaveLength(55);
    expect(originalLedger.at(-1)?.["version"]).toBe("0055");
    expect(original["model_live_evaluation_plans"]).toHaveLength(1);
    expect(original["credit_grants"]?.length).toBeGreaterThan(0);
    expect(
      original["organization_subscription_projections"]?.length,
    ).toBeGreaterThan(0);
    expect(original["solution_records"]).toHaveLength(2);
    expect(original["solution_export_runs"]).toHaveLength(2);
    expect(
      (
        await harness.database.query(
          sql(
            "SELECT to_regclass('model_live_invocation_sets') AS sets,to_regclass('model_live_parser_input_receipts') AS parser",
          ),
        )
      ).rows[0],
    ).toEqual({ sets: null, parser: null });
    await runMigrations(
      harness.database,
      migrations.filter(({ version }) => version <= "0056"),
    );
    expect(await snapshot()).toEqual(original);
    expect((await ledger()).slice(0, 55)).toEqual(originalLedger);
    expect((await ledger()).at(-1)?.["version"]).toBe("0056");
    expect(
      (
        await harness.database.query(
          sql(
            "SELECT to_regclass('model_live_parser_input_receipts') AS parser",
          ),
        )
      ).rows[0],
    ).toEqual({ parser: null });
    const identity = {
      definitionId: live.plan.definition.definitionId,
      planDigest: live.plan.planDigest,
    };
    const issued = await new PostgresModelLiveInvocationSets(live.plans).issue(
      identity,
    );
    const setBefore = await harness.database.query(
      sql("SELECT to_jsonb(x) AS record FROM model_live_invocation_sets x"),
    );
    expect(setBefore.rowCount).toBe(1);
    await runMigrations(
      harness.database,
      migrations.filter(({ version }) => version <= "0057"),
    );
    expect(await snapshot()).toEqual(original);
    expect((await ledger()).slice(0, 55)).toEqual(originalLedger);
    const upgradedLedger = await ledger();
    expect(upgradedLedger).toHaveLength(57);
    expect(upgradedLedger.at(-1)?.["version"]).toBe("0057");
    expect(
      await new PostgresModelLiveInvocationSets(live.plans).issue(identity),
    ).toEqual(issued);
    expect(
      (
        await harness.database.query(
          sql("SELECT to_jsonb(x) AS record FROM model_live_invocation_sets x"),
        )
      ).rows,
    ).toEqual(setBefore.rows);
    expect(
      (
        await harness.database.query(
          sql("SELECT 1 FROM model_live_parser_input_receipts"),
        )
      ).rowCount,
    ).toBe(0);
    for (const f of exports)
      expect(await f.repository.getJob(f.selector)).toEqual({
        record: f.record,
        recordVersion: 1,
      });
    await runMigrations(
      harness.database,
      migrations.filter(({ version }) => version <= "0057"),
    );
    expect(await ledger()).toEqual(upgradedLedger);
    expect(digestStructuredValue(await snapshot())).toBe(
      digestStructuredValue(original),
    );
    await expect(
      runMigrations(harness.database, migrations.slice(0, 55)),
    ).rejects.toThrow();
    const altered = migrations
      .filter(({ version }) => version <= "0057")
      .map((migration) =>
        migration.version === "0057"
          ? { ...migration, checksumSha256: "0".repeat(64) }
          : migration,
      );
    await expect(runMigrations(harness.database, altered)).rejects.toThrow();
    expect(await ledger()).toEqual(upgradedLedger);
    expect(await snapshot()).toEqual(original);
  }, 120000);
});
