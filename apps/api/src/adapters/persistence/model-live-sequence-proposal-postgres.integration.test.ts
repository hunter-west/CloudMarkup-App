import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  digestCanonicalValue,
  type ModelLiveSequencePlanV3,
  type ModelLiveSequenceSelectionV3,
} from "@cloudmarkup/schemas";
import { syntheticSequenceFixtureV3 } from "@cloudmarkup/model-gateway/testing";
import { createModelAccountingPgTestHarness } from "./model-commercial-accounting-pg-test-helpers.js";
import { createLiveAccountingPgSeed } from "./model-live-commercial-accounting-pg-test-helpers.js";
import { requireRegisteredSequencePredecessor57 } from "./model-live-sequence-successor-migration-test-helpers.js";
import { splitPostgresStatements } from "./migrations.js";
import { sql } from "./sql.js";

const configured = process.env["CLOUDMARKUP_TEST_DATABASE_URL"]?.trim();
const integration = configured ? describe : describe.skip;
const id = () => randomUUID().replaceAll("-", "");
const hash = <T extends object>(value: T, key: string): T => ({
  ...value,
  [key]: digestCanonicalValue(
    Object.fromEntries(Object.entries(value).filter(([name]) => name !== key)),
  ),
});
/** Proposal-DDL compatibility only. Direct fixture SQL is deliberately not a
 * production V3 issuer, validator, report, runtime or accounting implementation. */
integration(
  "prospective V3 plan and selection metadata on isolated PostgreSQL",
  () => {
    const harness = createModelAccountingPgTestHarness(configured, "0057");
    beforeAll(async () => {
      await harness.setup();
      await requireRegisteredSequencePredecessor57(harness.database);
      const source = await readFile(
        new URL(
          "../../../migration-proposals/model-live-sequences.sql",
          import.meta.url,
        ),
        "utf8",
      );
      expect(createHash("sha256").update(source).digest("hex")).toBe(
        "ef8dedec5318d27c4c124dc14475b3019d02c8e1e03923eadc684b4d15e2c668",
      );
      await harness.database.transaction(async (tx) => {
        for (const statement of splitPostgresStatements(source))
          await tx.query(sql(statement));
      });
    }, 120000);
    afterAll(() => harness.teardown(), 30000);
    async function fixture(
      existing?: Awaited<ReturnType<typeof harness.tenant>>,
    ) {
      const tenant = existing ?? (await harness.tenant());
      const clock = await harness.database.query(
        sql(
          "SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS now",
        ),
      );
      const now = clock.rows[0]?.["now"];
      if (typeof now !== "string")
        throw new Error("Synthetic database clock unavailable.");
      const f = syntheticSequenceFixtureV3({
        ...tenant.scope,
        now,
        definitionId: `sequence_definition_${id()}`,
      });
      const plan = hash(
        { ...f.plan, planId: `live_plan_${id()}` },
        "planDigest",
      );
      const selection = hash(
        {
          ...f.selection,
          planDigest: plan.planDigest,
          selectionId: `live_sequence_${id()}`,
          stages: f.selection.stages.map((stage) => ({
            ...stage,
            stageId: `live_stage_${id()}`,
            invocationId: `invocation_${id()}`,
          })),
        },
        "selectionDigest",
      );
      return { tenant, plan, selection };
    }
    function insertPlan(plan: ModelLiveSequencePlanV3) {
      const scope = plan.definition.scope;
      return harness.database.query(
        sql(
          `INSERT INTO model_live_sequence_plans
      (organization_id,project_id,principal_id,operator_principal_id,definition_id,definition_sha256,approval_sha256,plan_sha256,plan_id,plan_record,issued_at,expires_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::timestamptz,$12::timestamptz)`,
          [
            scope.organizationId,
            scope.projectId,
            scope.userId,
            plan.approval.operatorUserId,
            plan.definition.definitionId,
            plan.definition.definitionDigest.slice(7),
            plan.approval.approvalDigest.slice(7),
            plan.planDigest.slice(7),
            plan.planId,
            JSON.stringify(plan),
            plan.issuedAt,
            plan.expiresAt,
          ],
        ),
      );
    }
    function insertSelection(selection: ModelLiveSequenceSelectionV3) {
      const scope = selection.scope;
      return harness.database.query(
        sql(
          `INSERT INTO model_live_sequence_selections
      (organization_id,project_id,principal_id,plan_sha256,selection_id,selection_sha256,selection_record,issued_at)
      VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::timestamptz)`,
          [
            scope.organizationId,
            scope.projectId,
            scope.userId,
            selection.planDigest.slice(7),
            selection.selectionId,
            selection.selectionDigest.slice(7),
            JSON.stringify(selection),
            selection.issuedAt,
          ],
        ),
      );
    }
    async function financialState(org: string) {
      return digestCanonicalValue(
        (
          await harness.database.query(
            sql(
              `SELECT
      (SELECT count(*) FROM model_runtime_admissions WHERE organization_id=$1) AS runtime,
      (SELECT count(*) FROM model_commercial_workflows WHERE organization_id=$1) AS workflows,
      (SELECT count(*) FROM usage_ledger_entries WHERE organization_id=$1) AS ledger,
      (SELECT count(*) FROM credit_reservations WHERE organization_id=$1) AS reservations`,
              [org],
            ),
          )
        ).rows,
      );
    }
    it("stores complete immutable metadata without runtime or financial effects", async () => {
      const f = await fixture(),
        before = await financialState(f.tenant.scope.organizationId);
      await insertPlan(f.plan);
      await insertSelection(f.selection);
      const stored = await harness.database.query(
        sql(
          "SELECT selection_record FROM model_live_sequence_selections WHERE organization_id=$1 AND selection_id=$2",
          [f.tenant.scope.organizationId, f.selection.selectionId],
        ),
      );
      expect(stored.rows[0]?.["selection_record"]).toEqual(f.selection);
      expect(await financialState(f.tenant.scope.organizationId)).toBe(before);
    });
    it.each([
      "approval",
      "scope",
      "limits",
      "policy",
      "policy-evaluation",
      "policy-safety",
      "policy-window",
      "policy-cache",
      "policy-entitlement",
      "policy-switch",
      "authority",
      "tuple",
      "scalar-object",
      "allowlist-object",
      "activation-default",
      "null-seed",
    ])(
      "denies nested %s content through direct SQL despite coherent metadata hashes",
      async (kind) => {
        const f = await fixture();
        const plan = structuredClone(f.plan);
        const definition = plan.definition;
        const policy = definition.policy;
        const first = definition.cases[0];
        if (!first) throw new Error("Missing fixture case.");
        const add = (value: object) => {
          Object.assign(value, {
            prompt: "synthetic content must not be stored",
          });
        };
        if (kind === "approval") add(plan.approval);
        if (kind === "scope") {
          add(definition.scope);
          add(plan.approval.scope);
        }
        if (kind === "limits") add(definition.limits);
        if (kind === "policy") add(policy);
        if (kind === "policy-evaluation") add(policy.evaluationRequirement);
        if (kind === "policy-safety") add(policy.safety);
        if (kind === "policy-window") add(policy.requestWindows.user);
        if (kind === "policy-cache") add(policy.cacheKeyAuthority);
        if (kind === "policy-entitlement") {
          const entitlement = policy.featureEntitlements[0];
          if (!entitlement) throw new Error("Missing fixture entitlement.");
          add(entitlement);
        }
        if (kind === "policy-switch") add(policy.killSwitches.global);
        if (kind === "authority") add(first.authorityBinding);
        if (kind === "tuple") add(first.authorityBinding.authorityTuple);
        if (kind === "scalar-object")
          Object.assign(first.authorityBinding.authorityTuple, {
            promptTemplateId: { prompt: "synthetic nested content" },
          });
        if (kind === "allowlist-object")
          Object.assign(policy.allowlists, {
            dependencies: [{ prompt: "synthetic nested content" }],
          });
        if (kind === "activation-default")
          Object.assign(policy.liveEvaluation, { enabledByDefault: true });
        if (kind === "null-seed")
          Object.assign(first.seed, { candidateDigest: null });
        // Authority binding hashes its tuple alone, unlike the enclosing record hashes.
        first.authorityBinding.authorityTupleDigest = digestCanonicalValue(
          first.authorityBinding.authorityTuple,
        );
        definition.policy = hash(policy, "policyDigest");
        plan.definition = hash(definition, "definitionDigest");
        plan.approval = hash(
          {
            ...plan.approval,
            definitionDigest: plan.definition.definitionDigest,
          },
          "approvalDigest",
        );
        await expect(
          insertPlan(hash(plan, "planDigest")),
        ).rejects.toMatchObject({ code: "23514" });
        expect(
          (
            await harness.database.query(
              sql(
                "SELECT count(*)::int AS count FROM model_live_sequence_plans WHERE organization_id=$1",
                [f.tenant.scope.organizationId],
              ),
            )
          ).rows[0]?.["count"],
        ).toBe(0);
      },
    );
    it("preserves actual V2 plan issuance after proposal installation", async () => {
      const legacy = await createLiveAccountingPgSeed(harness);
      expect(legacy.plan.contractVersion).toBe(2);
      const stored = await harness.database.query(
        sql(
          "SELECT count(*)::int AS count FROM model_live_evaluation_plans WHERE organization_id=$1",
          [legacy.scope.organizationId],
        ),
      );
      expect(stored.rows[0]?.["count"]).toBe(1);
    });
    it.each([
      "reordered",
      "duplicate-invocation",
      "missing-slot",
      "foreign-case",
      "foreign-approval",
    ])("denies rehashed %s selection", async (kind) => {
      const f = await fixture();
      await insertPlan(f.plan);
      const record = structuredClone(f.selection);
      const first = record.stages[0],
        second = record.stages[1];
      if (!first || !second) throw new Error("Missing fixture stages.");
      if (kind === "reordered") record.stages.reverse();
      if (kind === "duplicate-invocation")
        second.invocationId = first.invocationId;
      if (kind === "missing-slot") record.stages.pop();
      if (kind === "foreign-case")
        first.caseDigest = digestCanonicalValue("foreign-case");
      if (kind === "foreign-approval")
        record.approvalDigest = digestCanonicalValue("foreign-approval");
      await expect(
        insertSelection(hash(record, "selectionDigest")),
      ).rejects.toMatchObject({ code: "23514" });
    });
    it("denies another tenant's coherent selection scope", async () => {
      const f = await fixture(),
        other = await fixture();
      await insertPlan(f.plan);
      await expect(
        insertSelection(
          hash(
            { ...f.selection, scope: other.selection.scope },
            "selectionDigest",
          ),
        ),
      ).rejects.toMatchObject({ code: "23514" });
    });
    it("denies reuse of a pre-issued invocation in a later sequence", async () => {
      const f = await fixture();
      await insertPlan(f.plan);
      await insertSelection(f.selection);
      const later = await fixture(f.tenant);
      await insertPlan(later.plan);
      const first = later.selection.stages[0],
        original = f.selection.stages[0];
      if (!first || !original) throw new Error("Missing fixture stages.");
      first.invocationId = original.invocationId;
      await expect(
        insertSelection(hash(later.selection, "selectionDigest")),
      ).rejects.toMatchObject({ code: "23514" });
    });
    it.each(["revocation", "membership"])(
      "denies current %s withdrawal before selection",
      async (kind) => {
        const f = await fixture();
        await insertPlan(f.plan);
        const scope = f.tenant.scope;
        if (kind === "revocation")
          await harness.database.query(
            sql(
              `INSERT INTO model_live_sequence_revocations
      (organization_id,project_id,principal_id,plan_sha256,operator_principal_id) VALUES($1,$2,$3,$4,$3)`,
              [
                scope.organizationId,
                scope.projectId,
                scope.userId,
                f.plan.planDigest.slice(7),
              ],
            ),
          );
        else
          await harness.database.query(
            sql(
              "UPDATE memberships SET lifecycle_status='suspended' WHERE organization_id=$1 AND principal_id=$2",
              [scope.organizationId, scope.userId],
            ),
          );
        await expect(insertSelection(f.selection)).rejects.toMatchObject({
          code: "23514",
        });
      },
    );
    it.each([
      "plan-update",
      "plan-delete",
      "selection-update",
      "selection-delete",
    ])("rejects %s mutation", async (kind) => {
      const f = await fixture();
      await insertPlan(f.plan);
      await insertSelection(f.selection);
      const org = f.tenant.scope.organizationId;
      const statements = {
        "plan-update":
          "UPDATE model_live_sequence_plans SET expires_at=expires_at+INTERVAL '1 minute' WHERE organization_id=$1",
        "plan-delete":
          "DELETE FROM model_live_sequence_plans WHERE organization_id=$1",
        "selection-update":
          "UPDATE model_live_sequence_selections SET issued_at=issued_at+INTERVAL '1 second' WHERE organization_id=$1",
        "selection-delete":
          "DELETE FROM model_live_sequence_selections WHERE organization_id=$1",
      };
      await expect(
        harness.database.query(
          sql(statements[kind as keyof typeof statements], [org]),
        ),
      ).rejects.toMatchObject({ code: "55000" });
    });
  },
);
