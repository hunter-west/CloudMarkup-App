import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { digestCanonicalValue, utcTimestampSchema } from "@cloudmarkup/schemas";
import { createModelAccountingPgTestHarness } from "./model-commercial-accounting-pg-test-helpers.js";
import { requireRegisteredEvaluationSuccessor } from "./model-live-registered-successor-test-helpers.js";
import { syntheticSeedValidationBody } from "./model-live-seed-validation-test-helpers.js";
import { parseModelLiveSeedValidationRow } from "./model-live-seed-validation-codec.js";
import { applySeedValidationProposal } from "./model-live-proposal-migrations-test-helpers.js";
import { sql } from "./sql.js";

const configured = process.env["CLOUDMARKUP_TEST_DATABASE_URL"]?.trim();
const integration = configured ? describe : describe.skip;
// Direct synthetic metadata insertion exercises proposal SQL, not native receipt issuance.
integration("unregistered seed receipt metadata on real PostgreSQL", () => {
  const harness = createModelAccountingPgTestHarness(configured, "0098");
  beforeAll(async () => {
    await harness.setup();
    await applySeedValidationProposal(harness.database);
  }, 120000);
  afterAll(() => harness.teardown(), 30000);

  type Tenant = Awaited<ReturnType<typeof harness.tenant>>;
  async function insert(
    tenant: Tenant,
    change: (value: Record<string, unknown>) => void = () => undefined,
  ) {
    return harness.database.transaction(async (tx) => {
      const clock = await tx.query(
        sql(
          "SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS now",
        ),
      );
      const now = utcTimestampSchema.parse(clock.rows[0]?.["now"]);
      const scope = {
        organizationId: tenant.scope.organizationId,
        projectId: tenant.scope.projectId,
        userId: tenant.scope.userId,
        environment: "development" as const,
        plan: "pro" as const,
      };
      const base = {
        ...syntheticSeedValidationBody(),
        scope,
        operatorUserId: scope.userId,
        startedAt: now,
        completedAt: now,
        issuedAt: now,
      };
      const body: Record<string, unknown> = { ...base };
      change(body);
      const receiptId =
        "seed_validation_" + digestCanonicalValue(body).slice(7);
      const identified = { ...body, receiptId };
      const receiptDigest = digestCanonicalValue(identified);
      const result = await tx.query(
        sql(
          "INSERT INTO model_live_seed_validation_receipts (organization_id,project_id,principal_id,operator_principal_id,case_id,receipt_id,receipt_sha256,configuration_sha256,receipt_record,issued_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::timestamptz) RETURNING *,to_char(issued_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS issued_at_text",
          [
            scope.organizationId,
            scope.projectId,
            scope.userId,
            scope.userId,
            base.caseId,
            receiptId,
            receiptDigest.slice(7),
            base.configurationDigest.slice(7),
            JSON.stringify({ ...identified, receiptDigest }),
            now,
          ],
        ),
      );
      const row = result.rows[0];
      if (!row) throw Error("Missing synthetic stored metadata");
      return { row, scope, receiptId };
    });
  }
  it("restores exact metadata and preserves the registered migration history", async () => {
    const { row, scope } = await insert(await harness.tenant());
    expect(parseModelLiveSeedValidationRow(row, scope).scope).toEqual(scope);
    await requireRegisteredEvaluationSuccessor(harness.database);
  });
  it.each([
    "grade",
    "nested-source",
    "cleanup",
    "missing",
    "foreign-scope",
  ] as const)(
    "rejects coherently rehashed %s metadata at SQL",
    async (kind) => {
      const tenant = await harness.tenant();
      await expect(
        insert(tenant, (body) => {
          if (kind === "grade") body["grade"] = "pass";
          if (kind === "nested-source")
            body["bindings"] = {
              ...(body["bindings"] as object),
              source: "unaccepted source",
            };
          if (kind === "cleanup") body["cleanup"] = "not-established";
          if (kind === "missing") delete body["reportDigest"];
          if (kind === "foreign-scope")
            body["scope"] = {
              ...(body["scope"] as object),
              organizationId: "organization_foreign",
            };
        }),
      ).rejects.toMatchObject({ code: "23514" });
    },
  );
  it("denies a suspended member even when the metadata shape is valid", async () => {
    const tenant = await harness.tenant();
    await harness.database.query(
      sql(
        "UPDATE memberships SET lifecycle_status='suspended' WHERE organization_id=$1 AND principal_id=$2",
        [tenant.scope.organizationId, tenant.scope.userId],
      ),
    );
    await expect(insert(tenant)).rejects.toMatchObject({ code: "23514" });
  });
  it("allows only one receipt per tenant, fixed case and configuration", async () => {
    const tenant = await harness.tenant();
    const results = await Promise.allSettled([insert(tenant), insert(tenant)]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
  });
  it("rejects update and deletion of retained metadata", async () => {
    const { scope, receiptId } = await insert(await harness.tenant());
    const keys = [
      scope.organizationId,
      scope.projectId,
      scope.userId,
      receiptId,
    ];
    await expect(
      harness.database.query(
        sql(
          "UPDATE model_live_seed_validation_receipts SET issued_at=issued_at WHERE organization_id=$1 AND project_id=$2 AND principal_id=$3 AND receipt_id=$4",
          keys,
        ),
      ),
    ).rejects.toMatchObject({ code: "55000" });
    await expect(
      harness.database.query(
        sql(
          "DELETE FROM model_live_seed_validation_receipts WHERE organization_id=$1 AND project_id=$2 AND principal_id=$3 AND receipt_id=$4",
          keys,
        ),
      ),
    ).rejects.toMatchObject({ code: "55000" });
  });
});
