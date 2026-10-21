import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { syntheticSequenceFixtureV3 } from "@cloudmarkup/model-gateway/testing";
import {
  digestCanonicalValue,
  utcTimestampSchema,
  namespacedIdentifierSchema,
} from "@cloudmarkup/schemas";
import type { Principal } from "../../application/identity.js";
import { createModelAccountingPgTestHarness } from "./model-commercial-accounting-pg-test-helpers.js";
import { createLiveAccountingPgSeed } from "./model-live-commercial-accounting-pg-test-helpers.js";
import { requireRegisteredEvaluationSuccessor } from "./model-live-registered-successor-test-helpers.js";
import { applyProposedSequenceMigrationForRegistered57 } from "./model-live-sequence-successor-migration-test-helpers.js";
import {
  PostgresModelLiveSequences,
  type ModelLiveSequenceConfigurationV3,
} from "./model-live-sequences.js";
import {
  sql,
  type SqlDatabase,
  type SqlExecutor,
  type SqlStatement,
  type SqlRow,
} from "./sql.js";
const configured = process.env["CLOUDMARKUP_TEST_DATABASE_URL"]?.trim();
const integration = configured ? describe : describe.skip;
const id = (prefix: string) => prefix + "_" + randomUUID().replaceAll("-", "");
const denied = { code: "model-live.sequence-unavailable" };
const hash = <T extends object>(value: T, key: string): T => ({
  ...value,
  [key]: digestCanonicalValue(
    Object.fromEntries(Object.entries(value).filter(([name]) => name !== key)),
  ),
});
integration.each(["historical-proposal", "registered"] as const)(
  "authenticated private V3 plan and selection issuer on isolated PostgreSQL (%s)",
  (mode) => {
    const harness = createModelAccountingPgTestHarness(
      configured,
      mode === "historical-proposal" ? "0057" : undefined,
    );
    beforeAll(async () => {
      await harness.setup();
      if (mode === "historical-proposal")
        await applyProposedSequenceMigrationForRegistered57(harness.database);
      else await requireRegisteredEvaluationSuccessor(harness.database);
    }, 120000);
    afterAll(() => harness.teardown(), 30000);
    async function fixture() {
      const tenant = await harness.tenant();
      const clock = await harness.database.query(
        sql(
          "SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS now",
        ),
      );
      const now = clock.rows[0]?.["now"];
      if (typeof now !== "string") throw new Error("Synthetic clock missing.");
      const f = syntheticSequenceFixtureV3({
        ...tenant.scope,
        now,
        definitionId: id("definition"),
      });
      const scope = f.definition.scope;
      const principal: Principal = {
        principalId: scope.userId,
        sessionId: id("session"),
        authenticationSource: "cognito",
        authenticatedAt: now,
        expiresAt: new Date(Date.parse(now) + 3600000).toISOString(),
      };
      const state = {
        available: true,
        operators: [scope.userId] as readonly string[],
        definition: f.definition,
        dataset: f.dataset,
        policy: f.policy,
        definitionReads: 0,
        withdrawAt: Infinity,
      };
      const configuration: ModelLiveSequenceConfigurationV3 = {
        environment: scope.environment,
        resolveOperatorPrincipalIds: () => Promise.resolve(state.operators),
        resolveDefinition: (definitionId) => {
          state.definitionReads += 1;
          return Promise.resolve(
            state.available &&
              state.definitionReads < state.withdrawAt &&
              definitionId === state.definition.definitionId
              ? {
                  definition: state.definition,
                  dataset: state.dataset,
                  policy: state.policy,
                }
              : null,
          );
        },
      };
      const make = (
        overrides: Partial<{
          principal: Principal;
          configuration: ModelLiveSequenceConfigurationV3;
          scope: typeof scope;
          database: SqlDatabase;
        }> = {},
      ) =>
        new PostgresModelLiveSequences({
          database: harness.database,
          scope,
          principal,
          configuration,
          ...overrides,
        });
      const approval = {
        definitionId: f.definition.definitionId,
        expectedDefinitionDigest: f.definition.definitionDigest,
      };
      const issue = async () => {
        const adapter = make(),
          plan = await adapter.approve(approval);
        return {
          adapter,
          plan,
          reference: {
            definitionId: plan.definition.definitionId,
            planDigest: plan.planDigest,
          },
        };
      };
      return {
        ...f,
        tenant,
        scope,
        principal,
        state,
        configuration,
        make,
        approval,
        issue,
      };
    }
    async function stored(org: string) {
      return (
        await harness.database.query(
          sql(
            `SELECT
      (SELECT count(*)::int FROM model_live_sequence_plans WHERE organization_id=$1) AS plans,
      (SELECT count(*)::int FROM model_live_sequence_selections WHERE organization_id=$1) AS selections,
      (SELECT count(*)::int FROM model_live_sequence_revocations WHERE organization_id=$1) AS revocations`,
            [org],
          ),
        )
      ).rows[0];
    }
    async function financial(org: string) {
      return digestCanonicalValue(
        (
          await harness.database.query(
            sql(
              `SELECT
      (SELECT jsonb_agg(to_jsonb(r) ORDER BY reservation_id) FROM credit_reservations r WHERE organization_id=$1) AS reservations,
      (SELECT count(*) FROM usage_ledger_entries WHERE organization_id=$1) AS ledger,
      (SELECT count(*) FROM model_runtime_admissions WHERE organization_id=$1) AS runtime,
      (SELECT count(*) FROM model_commercial_workflows WHERE organization_id=$1) AS workflows,
      (SELECT count(*) FROM model_live_invocations WHERE organization_id=$1) AS invocations`,
              [org],
            ),
          )
        ).rows,
      );
    }
    function observeDatabase(
      onStatement: (statement: SqlStatement) => void,
    ): SqlDatabase {
      const query = (tx: SqlExecutor): SqlExecutor => ({
        query<TRow extends SqlRow = SqlRow>(statement: SqlStatement) {
          onStatement(statement);
          return tx.query<TRow>(statement);
        },
      });
      return {
        ...query(harness.database),
        close: () => Promise.resolve(),
        transaction: (work) =>
          harness.database.transaction((tx) => work(query(tx))),
      };
    }
    it("issues host-owned IDs once under concurrent retries and reads exact detached metadata without financial effects", async () => {
      const f = await fixture(),
        before = await financial(f.scope.organizationId),
        adapter = f.make();
      const plans = await Promise.all([
        adapter.approve(f.approval),
        adapter.approve(f.approval),
      ]);
      expect(plans[0]).toEqual(plans[1]);
      const plan = plans[0];
      expect(plan.planId).not.toBe(f.plan.planId);
      expect(plan.approval.approvalId).not.toBe(f.plan.approval.approvalId);
      const reference = {
        definitionId: plan.definition.definitionId,
        planDigest: plan.planDigest,
      };
      const selections = await Promise.all([
        adapter.issueSelection(reference),
        adapter.issueSelection(reference),
      ]);
      expect(selections[0]).toEqual(selections[1]);
      const selection = selections[0];
      expect(selection.stages).toHaveLength(4);
      expect(
        new Set(selection.stages.map((stage) => stage.invocationId)).size,
      ).toBe(4);
      expect(
        selection.stages.every(
          (stage) =>
            !f.selection.stages.some(
              (old) => old.invocationId === stage.invocationId,
            ),
        ),
      ).toBe(true);
      expect(await adapter.requireCurrent(reference)).toEqual(plan);
      const selected = {
        ...reference,
        selectionId: selection.selectionId,
        selectionDigest: selection.selectionDigest,
      };
      const detached = await adapter.requireCurrentSelection(selected);
      detached.stages.reverse();
      expect(await adapter.requireCurrentSelection(selected)).toEqual(
        selection,
      );
      expect(await stored(f.scope.organizationId)).toEqual({
        plans: 1,
        selections: 1,
        revocations: 0,
      });
      expect(await financial(f.scope.organizationId)).toBe(before);
    });
    it("takes org then plan exclusive locks before membership joins and performs only intended metadata writes", async () => {
      const f = await fixture(),
        statements: SqlStatement[] = [];
      const adapter = f.make({
        database: observeDatabase((statement) => {
          statements.push(statement);
          if (/^(?:INSERT|UPDATE|DELETE)/u.test(statement.text.trim()))
            expect(statement.text).toMatch(
              /^INSERT INTO model_live_sequence_(?:plans|selections)/u,
            );
        }),
      });
      const plan = await adapter.approve(f.approval);
      await adapter.issueSelection({
        definitionId: plan.definition.definitionId,
        planDigest: plan.planDigest,
      });
      const firstLock = statements.findIndex((statement) =>
        statement.text.includes("pg_advisory_xact_lock"),
      );
      expect(statements[firstLock]?.values).toEqual([
        `runtime-admission:${f.scope.organizationId}`,
      ]);
      expect(statements[firstLock + 1]?.values).toEqual([
        `live-evaluation-plan:${f.scope.organizationId}:${f.scope.projectId}:${f.scope.userId}`,
      ]);
      expect(
        statements.findIndex((statement) =>
          statement.text.includes("FROM memberships m"),
        ),
      ).toBeGreaterThan(firstLock + 1);
    });
    it.each(["test", "local-development"] as const)(
      "denies unverified %s identity before any database work",
      async (authenticationSource) => {
        const f = await fixture();
        expect(() =>
          f.make({ principal: { ...f.principal, authenticationSource } }),
        ).toThrow();
        expect(await stored(f.scope.organizationId)).toEqual({
          plans: 0,
          selections: 0,
          revocations: 0,
        });
      },
    );
    it.each(["expired", "future", "stale-operator"])(
      "denies %s authentication",
      async (kind) => {
        const f = await fixture(),
          principal = { ...f.principal };
        if (kind === "expired")
          principal.expiresAt = new Date(
            Date.parse(principal.authenticatedAt) - 1,
          ).toISOString();
        if (kind === "future")
          principal.authenticatedAt = new Date(
            Date.parse(principal.authenticatedAt) + 120000,
          ).toISOString();
        if (kind === "stale-operator")
          principal.authenticatedAt = new Date(
            Date.parse(principal.authenticatedAt) - 11 * 60000,
          ).toISOString();
        await expect(
          f.make({ principal }).approve(f.approval),
        ).rejects.toMatchObject(denied);
        expect(await stored(f.scope.organizationId)).toEqual({
          plans: 0,
          selections: 0,
          revocations: 0,
        });
      },
    );
    it.each([
      "missing-operator",
      "duplicate-operator",
      "removed-definition",
      "wrong-digest",
      "wrong-environment",
      "extra-authority",
      "expired-definition",
    ])("denies %s approval without minting", async (kind) => {
      const f = await fixture();
      let configuration = f.configuration;
      let approval = f.approval;
      if (kind === "missing-operator") f.state.operators = [];
      if (kind === "duplicate-operator")
        f.state.operators = [f.scope.userId, f.scope.userId];
      if (kind === "removed-definition") f.state.available = false;
      if (kind === "expired-definition") {
        f.state.definition = hash(
          {
            ...f.state.definition,
            expiresAt: utcTimestampSchema.parse(
              new Date(Date.parse(f.plan.issuedAt) - 1000).toISOString(),
            ),
          },
          "definitionDigest",
        );
        approval = {
          ...approval,
          expectedDefinitionDigest: f.state.definition.definitionDigest,
        };
      }
      if (kind === "wrong-digest")
        approval = {
          ...approval,
          expectedDefinitionDigest: digestCanonicalValue("wrong"),
        };
      if (kind === "wrong-environment")
        configuration = { ...configuration, environment: "staging" };
      if (kind === "extra-authority")
        approval = Object.assign({ ...approval }, { plan: f.plan });
      if (kind === "wrong-environment")
        expect(() => f.make({ configuration })).toThrow();
      else
        await expect(
          f.make({ configuration }).approve(approval),
        ).rejects.toMatchObject(denied);
      expect(await stored(f.scope.organizationId)).toEqual({
        plans: 0,
        selections: 0,
        revocations: 0,
      });
    });
    it("denies a configured nonowner operator while allowing the target's separate real owner approval", async () => {
      const f = await fixture(),
        operator = id("principal");
      await harness.database.transaction(async (tx) => {
        await tx.query(
          sql(
            "INSERT INTO principals(principal_id,display_name) VALUES($1,'Synthetic editor operator')",
            [operator],
          ),
        );
        await tx.query(
          sql(
            "INSERT INTO organization_roles(organization_id,role_key,policy_version,is_owner,capabilities) VALUES($1,'editor','authorization-v2',FALSE,cloudmarkup_authorization_v2_permissions('editor'))",
            [f.scope.organizationId],
          ),
        );
        await tx.query(
          sql(
            "INSERT INTO memberships(membership_id,organization_id,principal_id,role_key) VALUES($1,$2,$3,'editor')",
            [id("membership"), f.scope.organizationId, operator],
          ),
        );
      });
      f.state.operators = [operator, f.scope.userId];
      await expect(
        f
          .make({ principal: { ...f.principal, principalId: operator } })
          .approve(f.approval),
      ).rejects.toMatchObject(denied);
      const issued = await f.issue();
      expect(issued.plan.approval.operatorUserId).toBe(f.scope.userId);
    });
    it("uses a separate current owner operator without granting that operator target-principal selection authority", async () => {
      const f = await fixture(),
        operator = id("principal");
      await harness.database.transaction(async (tx) => {
        await tx.query(
          sql(
            "INSERT INTO principals(principal_id,display_name) VALUES($1,'Synthetic separate owner')",
            [operator],
          ),
        );
        await tx.query(
          sql(
            "INSERT INTO memberships(membership_id,organization_id,principal_id,role_key) VALUES($1,$2,$3,'owner')",
            [id("membership"), f.scope.organizationId, operator],
          ),
        );
        await tx.query(
          sql(
            "INSERT INTO organization_roles(organization_id,role_key,policy_version,is_owner,capabilities) VALUES($1,'editor','authorization-v2',FALSE,cloudmarkup_authorization_v2_permissions('editor'))",
            [f.scope.organizationId],
          ),
        );
        await tx.query(
          sql(
            "UPDATE memberships SET role_key='editor' WHERE organization_id=$1 AND principal_id=$2",
            [f.scope.organizationId, f.scope.userId],
          ),
        );
      });
      f.state.operators = [operator];
      const operatorAdapter = f.make({
          principal: { ...f.principal, principalId: operator },
        }),
        target = f.make();
      const plan = await operatorAdapter.approve(f.approval),
        reference = {
          definitionId: plan.definition.definitionId,
          planDigest: plan.planDigest,
        };
      expect(plan.approval.operatorUserId).toBe(operator);
      await expect(
        operatorAdapter.issueSelection(reference),
      ).rejects.toMatchObject(denied);
      const selection = await target.issueSelection(reference);
      expect(selection.scope.userId).toBe(f.scope.userId);
      await harness.database.query(
        sql(
          "UPDATE memberships SET lifecycle_status='suspended' WHERE organization_id=$1 AND principal_id=$2",
          [f.scope.organizationId, operator],
        ),
      );
      await expect(
        target.requireCurrentSelection({
          ...reference,
          selectionId: selection.selectionId,
          selectionDigest: selection.selectionDigest,
        }),
      ).rejects.toMatchObject(denied);
    });
    it.each(["operator", "seed"])(
      "rolls back selection when current %s authority changes after pre-insert admission",
      async (kind) => {
        const f = await fixture(),
          issued = await f.issue();
        let attempted = false;
        const adapter = f.make({
          database: observeDatabase((statement) => {
            if (
              statement.text.startsWith(
                "INSERT INTO model_live_sequence_selections",
              )
            ) {
              attempted = true;
              if (kind === "operator") f.state.operators = [];
              else {
                const definition = structuredClone(f.state.definition),
                  first = definition.cases[0];
                if (!first) throw new Error("Seed case missing.");
                first.seed.candidateDigest = digestCanonicalValue(
                  "changed-final-configured-seed",
                );
                f.state.definition = hash(definition, "definitionDigest");
              }
            }
          }),
        });
        await expect(
          adapter.issueSelection(issued.reference),
        ).rejects.toMatchObject(denied);
        expect(attempted).toBe(true);
        expect(await stored(f.scope.organizationId)).toEqual({
          plans: 1,
          selections: 0,
          revocations: 0,
        });
      },
    );
    it.each(["seed", "policy", "case-source", "frozen-source", "authority"])(
      "denies changed current %s metadata instead of rehashing stored authority",
      async (kind) => {
        const f = await fixture(),
          issued = await f.issue();
        const definition = structuredClone(f.state.definition),
          first = definition.cases[0];
        if (!first) throw new Error("Case missing.");
        if (kind === "seed")
          first.seed.candidateDigest = digestCanonicalValue("different-seed");
        if (kind === "policy")
          definition.policy = hash(
            {
              ...definition.policy,
              killSwitches: {
                ...definition.policy.killSwitches,
                global: {
                  ...definition.policy.killSwitches.global,
                  engaged: true,
                },
              },
            },
            "policyDigest",
          );
        if (kind === "case-source")
          first.sourceInputDigest = digestCanonicalValue("different-input");
        if (kind === "authority") {
          first.authorityBinding.authorityTuple.promptTemplateId =
            namespacedIdentifierSchema.parse("different.prompt");
          first.authorityBinding.authorityTupleDigest = digestCanonicalValue(
            first.authorityBinding.authorityTuple,
          );
        }
        if (kind === "frozen-source") {
          const dataset = structuredClone(f.state.dataset);
          const selected = dataset.cases.find((c) => c.caseId === first.caseId);
          if (!selected) throw new Error("Frozen case missing.");
          selected.input.requirements = "Synthetic changed input";
          f.state.dataset = dataset;
        }
        f.state.definition = hash(definition, "definitionDigest");
        f.state.policy = definition.policy;
        await expect(
          issued.adapter.issueSelection(issued.reference),
        ).rejects.toMatchObject(denied);
        await expect(
          issued.adapter.requireCurrent(issued.reference),
        ).rejects.toMatchObject(denied);
        expect(await stored(f.scope.organizationId)).toEqual({
          plans: 1,
          selections: 0,
          revocations: 0,
        });
      },
    );
    it.each(["membership", "operator", "definition", "revoked"])(
      "denies current %s withdrawal on selection issue and replay",
      async (kind) => {
        const f = await fixture(),
          issued = await f.issue(),
          selection = await issued.adapter.issueSelection(issued.reference);
        if (kind === "membership")
          await harness.database.query(
            sql(
              "UPDATE memberships SET lifecycle_status='suspended' WHERE organization_id=$1 AND principal_id=$2",
              [f.scope.organizationId, f.scope.userId],
            ),
          );
        if (kind === "operator") f.state.operators = [];
        if (kind === "definition") f.state.available = false;
        if (kind === "revoked") await issued.adapter.revoke(issued.reference);
        await expect(
          issued.adapter.issueSelection(issued.reference),
        ).rejects.toMatchObject(denied);
        await expect(
          issued.adapter.requireCurrentSelection({
            ...issued.reference,
            selectionId: selection.selectionId,
            selectionDigest: selection.selectionDigest,
          }),
        ).rejects.toMatchObject(denied);
      },
    );
    it.each(["approval", "selection"])(
      "rolls back %s when configured definition disappears only at final current check",
      async (kind) => {
        const f = await fixture(),
          writes: SqlStatement[] = [];
        const adapter = f.make({
          database: observeDatabase((statement) => {
            if (statement.text.startsWith("INSERT INTO model_live_sequence_"))
              writes.push(statement);
          }),
        });
        if (kind === "approval") {
          f.state.withdrawAt = 3;
          await expect(adapter.approve(f.approval)).rejects.toMatchObject(
            denied,
          );
          expect(
            writes.some((statement) =>
              statement.text.startsWith(
                "INSERT INTO model_live_sequence_plans",
              ),
            ),
          ).toBe(true);
          expect(await stored(f.scope.organizationId)).toEqual({
            plans: 0,
            selections: 0,
            revocations: 0,
          });
        } else {
          const plan = await adapter.approve(f.approval);
          f.state.withdrawAt = f.state.definitionReads + 2;
          await expect(
            adapter.issueSelection({
              definitionId: plan.definition.definitionId,
              planDigest: plan.planDigest,
            }),
          ).rejects.toMatchObject(denied);
          expect(
            writes.some((statement) =>
              statement.text.startsWith(
                "INSERT INTO model_live_sequence_selections",
              ),
            ),
          ).toBe(true);
          expect(await stored(f.scope.organizationId)).toEqual({
            plans: 1,
            selections: 0,
            revocations: 0,
          });
        }
      },
    );
    it("denies foreign plan/scope/selection references and caller-authored stage IDs", async () => {
      const f = await fixture(),
        other = await fixture(),
        issued = await f.issue(),
        selection = await issued.adapter.issueSelection(issued.reference);
      const selected = {
        ...issued.reference,
        selectionId: selection.selectionId,
        selectionDigest: selection.selectionDigest,
      };
      await expect(
        other.make().requireCurrent(issued.reference),
      ).rejects.toMatchObject(denied);
      await expect(
        issued.adapter.requireCurrent({
          ...issued.reference,
          planDigest: digestCanonicalValue("foreign"),
        }),
      ).rejects.toMatchObject(denied);
      await expect(
        issued.adapter.requireCurrentSelection({
          ...selected,
          selectionId: `live_sequence_${"f".repeat(32)}`,
        }),
      ).rejects.toMatchObject(denied);
      await expect(
        issued.adapter.requireCurrentSelection({
          ...selected,
          selectionDigest: digestCanonicalValue("foreign"),
        }),
      ).rejects.toMatchObject(denied);
      await expect(
        issued.adapter.issueSelection(
          Object.assign({ ...issued.reference }, { stages: selection.stages }),
        ),
      ).rejects.toMatchObject(denied);
    });
    it("revokes exactly and idempotently after configuration removal without extending the original plan", async () => {
      const f = await fixture(),
        issued = await f.issue(),
        before = await financial(f.scope.organizationId);
      f.state.available = false;
      await issued.adapter.revoke(issued.reference);
      await issued.adapter.revoke(issued.reference);
      await expect(issued.adapter.approve(f.approval)).rejects.toMatchObject(
        denied,
      );
      await expect(
        issued.adapter.requireCurrent(issued.reference),
      ).rejects.toMatchObject(denied);
      expect(await stored(f.scope.organizationId)).toEqual({
        plans: 1,
        selections: 0,
        revocations: 1,
      });
      expect(await financial(f.scope.organizationId)).toBe(before);
    });
    it("preserves actual historical V2 issuance after the proposal and real V3 issuer", async () => {
      const f = await fixture(),
        issued = await f.issue();
      await issued.adapter.issueSelection(issued.reference);
      const legacy = await createLiveAccountingPgSeed(harness);
      expect(legacy.plan.contractVersion).toBe(2);
    });
  },
);
