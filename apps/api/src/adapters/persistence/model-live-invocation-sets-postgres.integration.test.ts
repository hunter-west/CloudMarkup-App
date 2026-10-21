import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { digestStructuredValue } from "@cloudmarkup/model-gateway";
import { PostgresModelLiveEvaluationPlans } from "./model-live-evaluation-plans.js";
import { createModelAccountingPgTestHarness } from "./model-commercial-accounting-pg-test-helpers.js";
import { createLiveAccountingPgSeed } from "./model-live-commercial-accounting-pg-test-helpers.js";
import { createLiveJournalPgFixture } from "./model-live-invocation-journal-pg-test-helpers.js";
import { PostgresModelLiveInvocationJournal } from "./model-live-invocation-journal.js";
import { PostgresModelLiveInvocationSets } from "./model-live-invocation-sets.js";
import {
  sql,
  type SqlDatabase,
  type SqlRow,
  type SqlStatement,
} from "./sql.js";

const configured = process.env["CLOUDMARKUP_TEST_DATABASE_URL"]?.trim();
const integration = configured ? describe : describe.skip;
integration(
  "registered private V2 invocation set on isolated PostgreSQL",
  () => {
    const harness = createModelAccountingPgTestHarness(configured);
    beforeAll(async () => {
      await harness.setup();
    }, 120000);
    afterAll(() => harness.teardown(), 30000);
    async function fixture() {
      const f = await createLiveAccountingPgSeed(harness);
      const identity = {
        definitionId: f.plan.definition.definitionId,
        planDigest: f.plan.planDigest,
      };
      return {
        ...f,
        identity,
        sets: new PostgresModelLiveInvocationSets(f.plans),
      };
    }
    async function state(organizationId: string) {
      const result = await harness.database.query(
        sql(
          `SELECT
      (SELECT jsonb_agg(to_jsonb(x) ORDER BY x.ledger_entry_id) FROM usage_ledger_entries x WHERE x.organization_id=$1) AS ledger,
      (SELECT jsonb_agg(to_jsonb(x) ORDER BY x.workflow_id) FROM model_commercial_workflows x WHERE x.organization_id=$1) AS workflows,
      (SELECT jsonb_agg(to_jsonb(x) ORDER BY x.scope_sha256) FROM model_runtime_admissions x WHERE x.organization_id=$1) AS runtime,
      (SELECT jsonb_agg(to_jsonb(x) ORDER BY x.workflow_id,x.outcome_kind) FROM model_commercial_accounting_outcomes x WHERE x.organization_id=$1) AS outcomes`,
          [organizationId],
        ),
      );
      return digestStructuredValue(result.rows);
    }
    async function rowCount(organizationId: string) {
      const result = await harness.database.query(
        sql(
          "SELECT count(*)::int AS count FROM model_live_invocation_sets WHERE organization_id=$1",
          [organizationId],
        ),
      );
      return result.rows[0]?.["count"];
    }
    it("issues once under concurrent retries without any financial mutation", async () => {
      const f = await fixture(),
        before = await state(f.scope.organizationId);
      const [a, b] = await Promise.all([
        f.sets.issue(f.identity),
        f.sets.issue(f.identity),
      ]);
      expect(a).toEqual(b);
      expect(await f.sets.issue(f.identity)).toEqual(a);
      expect(a.entries.map((e) => e.caseId)).toEqual(
        f.plan.definition.cases.map((c) => c.caseId),
      );
      expect(new Set(a.entries.map((e) => e.invocationId)).size).toBe(
        a.entries.length,
      );
      expect(await rowCount(f.scope.organizationId)).toBe(1);
      expect(await state(f.scope.organizationId)).toBe(before);
    });
    it("reads an exact selected case under current approval", async () => {
      const f = await fixture(),
        set = await f.sets.issue(f.identity),
        entry = set.entries[0];
      if (!entry) throw Error("Synthetic entry missing.");
      const before = await state(f.scope.organizationId);
      expect(
        await f.sets.requireCurrent({
          ...f.identity,
          invocationSet: { setId: set.setId, setDigest: set.setDigest },
          selected: entry,
        }),
      ).toEqual(set);
      expect(await state(f.scope.organizationId)).toBe(before);
    });
    it.each([
      "set-id",
      "set-digest",
      "case-id",
      "case-digest",
      "invocation-id",
      "plan-digest",
    ] as const)("denies substituted %s", async (kind) => {
      const f = await fixture(),
        set = await f.sets.issue(f.identity),
        entry = set.entries[0];
      if (!entry) throw Error("Synthetic entry missing.");
      const selected = { ...entry },
        invocationSet = { setId: set.setId, setDigest: set.setDigest };
      const identity = { ...f.identity };
      if (kind === "set-id") invocationSet.setId = "live_set_" + "f".repeat(32);
      if (kind === "set-digest")
        invocationSet.setDigest = digestStructuredValue("wrong");
      if (kind === "case-id") selected.caseId = "case_other";
      if (kind === "case-digest")
        selected.caseDigest = digestStructuredValue("wrong");
      if (kind === "invocation-id")
        selected.invocationId = "invocation_" + "f".repeat(32);
      if (kind === "plan-digest")
        identity.planDigest = digestStructuredValue("wrong");
      await expect(
        f.sets.requireCurrent({ ...identity, invocationSet, selected }),
      ).rejects.toThrow();
    });
    it("rejects another tenant's otherwise valid set", async () => {
      const f = await fixture(),
        other = await fixture(),
        set = await f.sets.issue(f.identity),
        entry = set.entries[0];
      if (!entry) throw Error("Synthetic entry missing.");
      await expect(
        other.sets.requireCurrent({
          ...other.identity,
          invocationSet: { setId: set.setId, setDigest: set.setDigest },
          selected: entry,
        }),
      ).rejects.toThrow();
    });
    it.each(["operators", "configuration", "revocation"] as const)(
      "denies %s withdrawal on issuance and membership read",
      async (kind) => {
        const f = await fixture(),
          set = await f.sets.issue(f.identity),
          entry = set.entries[0];
        if (!entry) throw Error("Synthetic entry missing.");
        if (kind === "operators") f.removeOperators();
        else if (kind === "configuration") f.removeConfiguration();
        else await f.plans.revoke({ ...f.identity });
        await expect(f.sets.issue(f.identity)).rejects.toThrow();
        await expect(
          f.sets.requireCurrent({
            ...f.identity,
            invocationSet: { setId: set.setId, setDigest: set.setDigest },
            selected: entry,
          }),
        ).rejects.toThrow();
      },
    );
    it("rolls back issued IDs when original operator authority is withdrawn before commit", async () => {
      const f = await fixture();
      let operators: readonly string[] = [f.scope.userId];
      const database: SqlDatabase = {
        query: <R extends SqlRow>(statement: SqlStatement) =>
          harness.database.query<R>(statement),
        close: () => Promise.resolve(),
        transaction: (work) =>
          harness.database.transaction((tx) =>
            work({
              query: async <R extends SqlRow>(statement: SqlStatement) => {
                const result = await tx.query<R>(statement);
                if (
                  statement.text.startsWith(
                    "INSERT INTO model_live_invocation_sets",
                  )
                )
                  operators = [];
                return result;
              },
            }),
          ),
      };
      const plans = new PostgresModelLiveEvaluationPlans({
        database,
        scope: f.plan.definition.scope,
        principal: f.principal,
        configuration: {
          environment: f.plan.definition.scope.environment,
          resolveOperatorPrincipalIds: () => Promise.resolve(operators),
          resolveDefinition: () =>
            Promise.resolve({
              definition: f.plan.definition,
              dataset: f.source.dataset,
              policy: f.plan.definition.policy,
            }),
        },
      });
      const before = await state(f.scope.organizationId);
      await expect(
        new PostgresModelLiveInvocationSets(plans).issue(f.identity),
      ).rejects.toThrow();
      expect(await rowCount(f.scope.organizationId)).toBe(0);
      expect(await state(f.scope.organizationId)).toBe(before);
    });
    it("denies an expired authenticated session", async () => {
      const f = await fixture();
      const plans = new PostgresModelLiveEvaluationPlans({
        database: harness.database,
        scope: f.plan.definition.scope,
        principal: { ...f.principal, expiresAt: "2020-01-01T00:00:00.000Z" },
        configuration: {
          environment: f.plan.definition.scope.environment,
          resolveOperatorPrincipalIds: () => Promise.resolve([f.scope.userId]),
          resolveDefinition: () =>
            Promise.resolve({
              definition: f.plan.definition,
              dataset: f.source.dataset,
              policy: f.plan.definition.policy,
            }),
        },
      });
      await expect(
        new PostgresModelLiveInvocationSets(plans).issue(f.identity),
      ).rejects.toThrow();
      expect(await rowCount(f.scope.organizationId)).toBe(0);
    });
    it.each(["order", "source", "authority", "duplicate-invocation"] as const)(
      "rejects coherent direct-SQL %s substitution before uniqueness can hide the finding",
      async (kind) => {
        const f = await fixture(),
          set = await f.sets.issue(f.identity);
        const record = structuredClone(set);
        const first = record.entries[0],
          second = record.entries[1];
        if (!first || !second) throw Error("Synthetic matrix missing.");
        if (kind === "order") record.entries.reverse();
        else if (kind === "source")
          first.sourceInputDigest = digestStructuredValue("substituted-source");
        else if (kind === "authority")
          first.authorityTupleDigest = digestStructuredValue(
            "substituted-authority",
          );
        else second.invocationId = first.invocationId;
        record.setId = "live_set_" + "f".repeat(32);
        const body = Object.fromEntries(
          Object.entries(record).filter(([key]) => key !== "setDigest"),
        );
        record.setDigest = digestStructuredValue(body);
        await expect(
          harness.database.query(
            sql(
              "INSERT INTO model_live_invocation_sets (organization_id,project_id,principal_id,plan_sha256,set_id,set_sha256,set_record,issued_at) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::timestamptz)",
              [
                f.scope.organizationId,
                f.scope.projectId,
                f.scope.userId,
                f.plan.planDigest.slice(7),
                record.setId,
                record.setDigest.slice(7),
                JSON.stringify(record),
                record.issuedAt,
              ],
            ),
          ),
        ).rejects.toThrow(
          kind === "duplicate-invocation"
            ? "unique selected invocation identities"
            : "exact ordered invocation set entry",
        );
        expect(await f.sets.issue(f.identity)).toEqual(set);
      },
    );
    it.each(["UPDATE", "DELETE"] as const)(
      "rejects %s of the issued set",
      async (operation) => {
        const f = await fixture();
        await f.sets.issue(f.identity);
        const statement =
          operation === "UPDATE"
            ? "UPDATE model_live_invocation_sets SET set_record=set_record WHERE organization_id=$1"
            : "DELETE FROM model_live_invocation_sets WHERE organization_id=$1";
        await expect(
          harness.database.query(sql(statement, [f.scope.organizationId])),
        ).rejects.toThrow();
      },
    );
    it("rejects retroactive selection after historical journal registration", async () => {
      const f = await createLiveJournalPgFixture(harness);
      await f.journal.prepare(f.callback);
      await expect(
        new PostgresModelLiveInvocationSets(f.plans).issue(f.identity),
      ).rejects.toThrow();
      expect(await rowCount(f.scope.organizationId)).toBe(0);
    });
    it("registers only the exact selected invocation in the existing journal transaction", async () => {
      const f = await createLiveJournalPgFixture(harness);
      const sets = new PostgresModelLiveInvocationSets(f.plans),
        set = await sets.issue(f.identity);
      const selected = set.entries.find(
        (e) => e.caseId === f.journalBinding.evaluationCaseId,
      );
      if (!selected) throw Error("Selected synthetic case missing.");
      const before = await state(f.scope.organizationId);
      const selectedInvocationSet = {
        setId: set.setId,
        setDigest: set.setDigest,
      };
      const journal = new PostgresModelLiveInvocationJournal({
        ...f.options,
        selectedInvocationSet,
        binding: { ...f.journalBinding, invocationId: selected.invocationId },
      });
      await journal.prepare(f.callback);
      await journal.prepare(f.callback);
      expect(await f.row()).toMatchObject({
        invocation_id: selected.invocationId,
        gateway_state: "registered",
      });
      // Stored-set replay remains valid after its selected invocation exists.
      expect(await sets.issue(f.identity)).toEqual(set);
      expect(await state(f.scope.organizationId)).toBe(before);
    });
    it("denies a wrong selected set before journal insertion", async () => {
      const f = await createLiveJournalPgFixture(harness),
        set = await new PostgresModelLiveInvocationSets(f.plans).issue(
          f.identity,
        );
      const journal = new PostgresModelLiveInvocationJournal({
        ...f.options,
        selectedInvocationSet: {
          setId: set.setId,
          setDigest: digestStructuredValue("wrong"),
        },
      });
      await expect(journal.prepare(f.callback)).rejects.toThrow();
      expect(await f.row()).toBeUndefined();
    });
    it("does not allow the historical constructor to bypass an already sealed plan", async () => {
      const f = await createLiveJournalPgFixture(harness);
      await new PostgresModelLiveInvocationSets(f.plans).issue(f.identity);
      await expect(f.journal.prepare(f.callback)).rejects.toThrow();
      expect(await f.row()).toBeUndefined();
    });
    it("serializes a racing initial seal and historical registration without retroactive selection", async () => {
      const f = await createLiveJournalPgFixture(harness);
      const results = await Promise.allSettled([
        new PostgresModelLiveInvocationSets(f.plans).issue(f.identity),
        f.journal.prepare(f.callback),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(
        ((await rowCount(f.scope.organizationId)) === 1) !==
          ((await f.row()) !== undefined),
      ).toBe(true);
    });
    it("preserves unselected historical usage and recovery with unchanged finances", async () => {
      const f = await createLiveJournalPgFixture(harness),
        before = await state(f.scope.organizationId);
      await f.journal.prepare(f.callback);
      await f.journal.claim(f.claim);
      await f.journal.record(f.usage);
      await f.journal.complete(f.claim, f.gatewayResult);
      expect(await f.journal.listByInvocationId(f.claim.invocationId)).toEqual([
        f.usage,
      ]);
      expect(await f.journal.recoverVerified(f.recoveryInput)).toEqual({
        kind: "pending",
      });
      expect(await state(f.scope.organizationId)).toBe(before);
      expect(await rowCount(f.scope.organizationId)).toBe(0);
    });
  },
);
