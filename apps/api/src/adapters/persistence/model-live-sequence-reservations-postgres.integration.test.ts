import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { syntheticSequenceFixtureV3 } from "@cloudmarkup/model-gateway/testing";
import {
  digestCanonicalValue,
  modelLiveSequencePlanV3Schema,
  modelLiveSequenceSelectionV3Schema,
} from "@cloudmarkup/schemas";
import { createModelAccountingPgTestHarness } from "./model-commercial-accounting-pg-test-helpers.js";
import { createLiveJournalPgFixture } from "./model-live-invocation-journal-pg-test-helpers.js";
import { modelLiveInvocationSetV2Schema } from "./model-live-invocation-set-codec.js";
import { requireRegisteredEvaluationSuccessor } from "./model-live-registered-successor-test-helpers.js";
import { applyProposedSequenceMigrationForRegistered57 } from "./model-live-sequence-successor-migration-test-helpers.js";
import { sql, type SqlStatement } from "./sql.js";

const configured = process.env["CLOUDMARKUP_TEST_DATABASE_URL"]?.trim();
const integration = configured ? describe : describe.skip;
const id = (prefix: string) => prefix + randomUUID().replaceAll("-", "");
const hash = <T extends object>(value: T, key: string) => ({
  ...value,
  [key]: digestCanonicalValue(
    Object.fromEntries(Object.entries(value).filter(([name]) => name !== key)),
  ),
});

/** Real SQL boundary proof only. No V3 issuer, dispatch or genuine tool evidence. */
integration.each(["historical-proposal", "registered"] as const)(
  "reciprocal sequence invocation reservation on PostgreSQL (%s)",
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
    async function now() {
      const row = (
        await harness.database.query(
          sql(
            "SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS now",
          ),
        )
      ).rows[0];
      if (typeof row?.["now"] !== "string")
        throw Error("Synthetic SQL clock unavailable.");
      return row["now"];
    }
    async function sequence(
      f: Awaited<ReturnType<typeof createLiveJournalPgFixture>>,
      invocationId: string,
      alternate?: Pick<typeof f.scope, "projectId" | "userId">,
    ) {
      const source = syntheticSequenceFixtureV3({
        ...f.scope,
        ...alternate,
        now: await now(),
        definitionId: id("sequence_definition_"),
      });
      const plan = modelLiveSequencePlanV3Schema.parse(
        hash({ ...source.plan, planId: id("live_plan_") }, "planDigest"),
      );
      const scope = plan.definition.scope;
      await harness.database.query(
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
      const selection = modelLiveSequenceSelectionV3Schema.parse(
        hash(
          {
            ...source.selection,
            planDigest: plan.planDigest,
            selectionId: id("live_sequence_"),
            stages: source.selection.stages.map((stage, index) => ({
              ...stage,
              stageId: id("live_stage_"),
              invocationId: index === 0 ? invocationId : id("invocation_"),
            })),
          },
          "selectionDigest",
        ),
      );
      const statement = sql(
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
      );
      return { plan, selection, statement };
    }
    function journal(
      f: Awaited<ReturnType<typeof createLiveJournalPgFixture>>,
      invocationId: string,
    ) {
      const binding = { ...f.journalBinding, invocationId };
      return sql(
        `INSERT INTO model_live_invocations
      (organization_id,project_id,principal_id,invocation_id,scope_sha256,workflow_id,reservation_id,dispatch_intent_id,binding_sha256,binding,callback_metadata)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb)`,
        [
          f.scope.organizationId,
          f.scope.projectId,
          f.scope.userId,
          invocationId,
          f.scope.tenantScopeDigest.slice(7),
          f.dispatched.request.multiCallWorkflowId,
          f.dispatched.request.reservationId,
          f.callback.dispatchIntentId,
          digestCanonicalValue(binding).slice(7),
          JSON.stringify(binding),
          JSON.stringify(f.callback),
        ],
      );
    }
    async function selectedSet(
      f: Awaited<ReturnType<typeof createLiveJournalPgFixture>>,
      invocationId: string,
    ) {
      const p = f.plan;
      const body = {
        contractVersion: 2,
        recordKind: "model-live-invocation-set",
        issuerId: "cloudmarkup.model-live-invocation-set",
        issuerVersion: "1.0.0",
        setId: id("live_set_"),
        scope: p.definition.scope,
        definitionId: p.definition.definitionId,
        definitionDigest: p.definition.definitionDigest,
        planDigest: p.planDigest,
        approvalDigest: p.approval.approvalDigest,
        issuedAt: await now(),
        entries: p.definition.cases.map((entry, index) => ({
          caseId: entry.caseId,
          caseDigest: entry.caseDigest,
          sourceInputDigest: entry.sourceInputDigest,
          authorityTupleDigest: entry.authorityBinding.authorityTupleDigest,
          invocationId: index === 0 ? invocationId : id("invocation_"),
        })),
      };
      const set = modelLiveInvocationSetV2Schema.parse({
        ...body,
        setDigest: digestCanonicalValue(body),
      });
      return sql(
        "INSERT INTO model_live_invocation_sets (organization_id,project_id,principal_id,plan_sha256,set_id,set_sha256,set_record,issued_at) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::timestamptz)",
        [
          f.scope.organizationId,
          f.scope.projectId,
          f.scope.userId,
          p.planDigest.slice(7),
          set.setId,
          set.setDigest.slice(7),
          JSON.stringify(set),
          set.issuedAt,
        ],
      );
    }
    async function state(org: string) {
      return (
        await harness.database.query(
          sql(
            `SELECT
      (SELECT count(*)::int FROM model_live_sequence_selections WHERE organization_id=$1) AS sequences,
      (SELECT count(*)::int FROM model_live_invocation_sets WHERE organization_id=$1) AS sets,
      (SELECT count(*)::int FROM model_live_invocations WHERE organization_id=$1) AS journals,
      (SELECT jsonb_agg(to_jsonb(x) ORDER BY x.ledger_entry_id) FROM usage_ledger_entries x WHERE x.organization_id=$1) AS ledger,
      (SELECT jsonb_agg(to_jsonb(x) ORDER BY x.workflow_id) FROM model_commercial_workflows x WHERE x.organization_id=$1) AS workflows,
      (SELECT jsonb_agg(to_jsonb(x) ORDER BY x.scope_sha256) FROM model_runtime_admissions x WHERE x.organization_id=$1) AS runtime`,
            [org],
          ),
        )
      ).rows[0];
    }
    async function proveValid(statement: SqlStatement) {
      const rollback = new Error("Synthetic valid insertion rollback.");
      await expect(
        harness.database.transaction(async (tx) => {
          await tx.query(statement);
          throw rollback;
        }),
      ).rejects.toBe(rollback);
    }
    async function alternateScope(
      f: Awaited<ReturnType<typeof createLiveJournalPgFixture>>,
      difference: "project" | "principal",
    ) {
      const projectId =
        difference === "project" ? id("project_") : f.scope.projectId;
      const userId =
        difference === "principal" ? id("principal_") : f.scope.userId;
      // Synthetic identity rows use the same current schema/owner-membership
      // fixture pattern. The real V2 fixture and all production factories stay unchanged.
      await harness.database.transaction(async (tx) => {
        if (difference === "principal") {
          await tx.query(
            sql(
              "INSERT INTO principals(principal_id,display_name) VALUES($1,'Synthetic reciprocal owner')",
              [userId],
            ),
          );
          await tx.query(
            sql(
              "INSERT INTO memberships(membership_id,organization_id,principal_id,role_key) VALUES($1,$2,$3,'owner')",
              [id("membership_"), f.scope.organizationId, userId],
            ),
          );
        } else {
          await tx.query(
            sql(
              "INSERT INTO projects(project_id,organization_id,name,created_by_principal_id) VALUES($1,$2,'Synthetic reciprocal project',$3)",
              [projectId, f.scope.organizationId, userId],
            ),
          );
        }
      });
      const current = await harness.database.query(
        sql(
          "SELECT p.project_id,m.principal_id FROM projects p JOIN memberships m ON m.organization_id=p.organization_id JOIN principals u ON u.principal_id=m.principal_id WHERE p.organization_id=$1 AND p.project_id=$2 AND m.principal_id=$3 AND p.lifecycle_status='active' AND m.lifecycle_status='active' AND u.lifecycle_status='active'",
          [f.scope.organizationId, projectId, userId],
        ),
      );
      expect(current.rowCount).toBe(1);
      expect(current.rows[0]).toEqual({
        project_id: projectId,
        principal_id: userId,
      });
      return { projectId, userId };
    }
    async function financialSnapshot(organizationId: string) {
      const records: Record<string, unknown> = {};
      for (const table of [
        "credit_grants",
        "credit_reservations",
        "credit_reservation_allocations",
        "usage_ledger_entries",
        "model_commercial_workflows",
        "model_commercial_workflow_revisions",
        "model_commercial_reservation_decisions",
        "model_commercial_accounting_outcomes",
        "model_runtime_admissions",
        "model_platform_spend_reservations",
        "model_usage_event_details",
      ]) {
        records[table] = (
          await harness.database.query(
            sql(
              `SELECT to_jsonb(record) AS record FROM ${table} record WHERE organization_id=$1 ORDER BY to_jsonb(record)::text`,
              [organizationId],
            ),
          )
        ).rows;
      }
      return structuredClone(records);
    }
    async function pair(
      kind: "journal" | "set",
      difference?: "project" | "principal",
    ) {
      const f = await createLiveJournalPgFixture(harness);
      const invocationId = id("invocation_");
      const alternate =
        difference === undefined
          ? undefined
          : await alternateScope(f, difference);
      const v3 = await sequence(f, invocationId, alternate);
      const v2 =
        kind === "journal"
          ? journal(f, invocationId)
          : await selectedSet(f, invocationId);
      // Both statements must independently pass their original authority guards.
      await proveValid(v3.statement);
      await proveValid(v2);
      return { f, v3, v2, invocationId };
    }
    it("uses actual read committed and volatile post-lock lookups in ordered triggers", async () => {
      expect(
        (
          await harness.database.query(
            sql("SHOW default_transaction_isolation"),
          )
        ).rows[0]?.["default_transaction_isolation"],
      ).toBe("read committed");
      expect(
        (await harness.database.query(sql("SHOW transaction_isolation")))
          .rows[0]?.["transaction_isolation"],
      ).toBe("read committed");
      const rows = (
        await harness.database.query(
          sql(
            "SELECT proname,provolatile FROM pg_proc WHERE proname IN ('require_model_live_sequence_reservation_snapshot','enforce_model_live_sequence_selection_snapshot','enforce_model_live_set_sequence_reservation','enforce_model_live_journal_sequence_reservation','enforce_model_live_sequence_selection_insert') AND pronamespace=current_schema()::regnamespace ORDER BY proname",
          ),
        )
      ).rows;
      expect(rows).toHaveLength(5);
      expect(rows.every((row) => row["provolatile"] === "v")).toBe(true);
      for (const table of [
        "model_live_invocations",
        "model_live_invocation_sets",
        "model_live_sequence_selections",
      ]) {
        const names = (
          await harness.database.query(
            sql(
              "SELECT tgname FROM pg_trigger WHERE tgrelid=$1::regclass AND NOT tgisinternal ORDER BY tgname",
              [table],
            ),
          )
        ).rows.map((row) => String(row["tgname"]));
        expect(names[0]).toContain("_00_");
      }
    });
    it.each(["journal", "set"] as const)(
      "denies either committed insertion order against V2 %s",
      async (kind) => {
        for (const v3First of [true, false]) {
          const p = await pair(kind),
            before = await state(p.f.scope.organizationId);
          await harness.database.query(v3First ? p.v3.statement : p.v2);
          await expect(
            harness.database.query(v3First ? p.v2 : p.v3.statement),
          ).rejects.toMatchObject({ code: "23514" });
          const after = await state(p.f.scope.organizationId);
          expect(after).toEqual({
            ...before,
            sequences: v3First ? 1 : 0,
            sets: !v3First && kind === "set" ? 1 : 0,
            journals: !v3First && kind === "journal" ? 1 : 0,
          });
        }
      },
      30000,
    );
    for (const kind of ["journal", "set"] as const)
      for (const v3First of [true, false]) {
        it(`serializes actual ${kind} contention with V3 first=${String(v3First)}`, async () => {
          const p = await pair(kind),
            before = await state(p.f.scope.organizationId);
          let releaseFirst: () => void = () => {
            throw new Error("Release promise is not initialized.");
          };
          let firstReady: () => void = () => {
            throw new Error("Ready promise is not initialized.");
          };
          const ready = new Promise<void>((resolve) => {
            firstReady = resolve;
          });
          const release = new Promise<void>((resolve) => {
            releaseFirst = resolve;
          });
          let firstPid = 0,
            secondPid = 0;
          const first = harness.database.transaction(async (tx) => {
            firstPid = Number(
              (await tx.query(sql("SELECT pg_backend_pid() AS pid"))).rows[0]?.[
                "pid"
              ],
            );
            await tx.query(v3First ? p.v3.statement : p.v2);
            firstReady();
            await release;
          });
          await Promise.race([ready, first]);
          const second = harness.database.transaction(async (tx) => {
            secondPid = Number(
              (await tx.query(sql("SELECT pg_backend_pid() AS pid"))).rows[0]?.[
                "pid"
              ],
            );
            await tx.query(v3First ? p.v2 : p.v3.statement);
          });
          const observedSecond = second.then(
            () => ({ code: "unexpected-success" }),
            (error: unknown) => error,
          );
          try {
            const deadline = Date.now() + 5000;
            let blocked = false;
            while (Date.now() < deadline && !blocked) {
              if (secondPid !== 0)
                blocked =
                  (
                    await harness.database.query(
                      sql(
                        "SELECT $2::int = ANY(pg_blocking_pids($1::int)) AS blocked",
                        [secondPid, firstPid],
                      ),
                    )
                  ).rows[0]?.["blocked"] === true;
              if (!blocked)
                await new Promise((resolve) => setTimeout(resolve, 10));
            }
            expect(blocked).toBe(true);
          } finally {
            releaseFirst();
            await Promise.allSettled([first, observedSecond]);
          }
          await first;
          expect(await observedSecond).toMatchObject({ code: "23514" });
          const after = await state(p.f.scope.organizationId);
          expect(after).toEqual({
            ...before,
            sequences: v3First ? 1 : 0,
            sets: !v3First && kind === "set" ? 1 : 0,
            journals: !v3First && kind === "journal" ? 1 : 0,
          });
        }, 30000);
      }
    for (const difference of ["project", "principal"] as const)
      for (const kind of ["journal", "set"] as const)
        for (const v3First of [true, false]) {
          it(`serializes same-organization different-${difference} ${kind} contention with V3 first=${String(v3First)}`, async () => {
            const p = await pair(kind, difference);
            const scope = p.v3.plan.definition.scope;
            expect(scope.organizationId).toBe(p.f.scope.organizationId);
            expect(scope.projectId === p.f.scope.projectId).toBe(
              difference !== "project",
            );
            expect(scope.userId === p.f.scope.userId).toBe(
              difference !== "principal",
            );
            const before = await state(p.f.scope.organizationId);
            const finances = await financialSnapshot(p.f.scope.organizationId);
            let releaseFirst: () => void = () => {
              throw Error("Release barrier unavailable.");
            };
            let firstReady: () => void = () => {
              throw Error("Ready barrier unavailable.");
            };
            const ready = new Promise<void>((resolve) => {
              firstReady = resolve;
            });
            const release = new Promise<void>((resolve) => {
              releaseFirst = resolve;
            });
            let firstPid = 0,
              secondPid = 0;
            const first = harness.database.transaction(async (tx) => {
              const pid = (
                await tx.query(sql("SELECT pg_backend_pid() AS pid"))
              ).rows[0]?.["pid"];
              if (typeof pid !== "number")
                throw Error("First transaction PID unavailable.");
              firstPid = pid;
              await tx.query(v3First ? p.v3.statement : p.v2);
              firstReady();
              await release;
            });
            let observedSecond: Promise<unknown> | undefined;
            try {
              await Promise.race([ready, first]);
              const second = harness.database.transaction(async (tx) => {
                const pid = (
                  await tx.query(sql("SELECT pg_backend_pid() AS pid"))
                ).rows[0]?.["pid"];
                if (typeof pid !== "number")
                  throw Error("Second transaction PID unavailable.");
                secondPid = pid;
                await tx.query(v3First ? p.v2 : p.v3.statement);
              });
              observedSecond = second.then(
                () => ({ code: "unexpected-success" }),
                (error: unknown) => error,
              );
              const deadline = Date.now() + 5000;
              let blocked = false;
              while (Date.now() < deadline && !blocked) {
                if (secondPid !== 0)
                  blocked =
                    (
                      await harness.database.query(
                        sql(
                          "SELECT $2::int = ANY(pg_blocking_pids($1::int)) AS blocked",
                          [secondPid, firstPid],
                        ),
                      )
                    ).rows[0]?.["blocked"] === true;
                if (!blocked)
                  await new Promise((resolve) => setTimeout(resolve, 10));
              }
              expect(blocked).toBe(true);
            } finally {
              releaseFirst();
              await Promise.allSettled(
                observedSecond === undefined
                  ? [first]
                  : [first, observedSecond],
              );
            }
            await first;
            expect(await observedSecond).toMatchObject({ code: "23514" });
            expect(await state(p.f.scope.organizationId)).toEqual({
              ...before,
              sequences: v3First ? 1 : 0,
              sets: !v3First && kind === "set" ? 1 : 0,
              journals: !v3First && kind === "journal" ? 1 : 0,
            });
            expect(await financialSnapshot(p.f.scope.organizationId)).toEqual(
              finances,
            );
          }, 30000);
        }
    for (const isolation of ["REPEATABLE READ", "SERIALIZABLE"] as const)
      for (const target of ["sequence", "journal", "set"] as const) {
        it(`denies ${isolation} before a ${target} insertion`, async () => {
          const p = await pair(target === "set" ? "set" : "journal"),
            before = await state(p.f.scope.organizationId);
          await expect(
            harness.database.transaction(async (tx) => {
              await tx.query(
                sql(`SET TRANSACTION ISOLATION LEVEL ${isolation}`),
              );
              await tx.query(
                sql("SELECT count(*) FROM model_live_sequence_selections"),
              );
              await tx.query(target === "sequence" ? p.v3.statement : p.v2);
            }),
          ).rejects.toMatchObject({ code: "23514" });
          expect(await state(p.f.scope.organizationId)).toEqual(before);
        }, 30000);
      }
    it.each(["journal", "set"] as const)(
      "does not reserve IDs after a rolled back V3 insert before %s",
      async (kind) => {
        const p = await pair(kind);
        await proveValid(p.v3.statement);
        await harness.database.query(p.v2);
        expect((await state(p.f.scope.organizationId))?.["sequences"]).toBe(0);
      },
      30000,
    );
    it("retains the V3 ID reservation after plan revocation", async () => {
      const p = await pair("journal");
      await harness.database.query(p.v3.statement);
      await harness.database.query(
        sql(
          "INSERT INTO model_live_sequence_revocations(organization_id,project_id,principal_id,plan_sha256,operator_principal_id) VALUES($1,$2,$3,$4,$3)",
          [
            p.f.scope.organizationId,
            p.f.scope.projectId,
            p.f.scope.userId,
            p.v3.plan.planDigest.slice(7),
          ],
        ),
      );
      await expect(harness.database.query(p.v2)).rejects.toMatchObject({
        code: "23514",
      });
    }, 30000);
    it("keeps the same identity independent across organizations", async () => {
      const first = await pair("journal");
      await harness.database.query(first.v3.statement);
      const other = await createLiveJournalPgFixture(harness);
      expect(other.scope.organizationId).not.toBe(first.f.scope.organizationId);
      await harness.database.query(journal(other, first.invocationId));
      expect((await state(other.scope.organizationId))?.["journals"]).toBe(1);
    }, 30000);
    it("allows unrelated IDs in one organization without altering the reservation", async () => {
      const p = await pair("journal");
      await harness.database.query(p.v3.statement);
      await harness.database.query(journal(p.f, id("invocation_")));
      expect(await state(p.f.scope.organizationId)).toMatchObject({
        sequences: 1,
        journals: 1,
      });
    }, 30000);
    it("serializes two V3 selections competing for one invocation ID", async () => {
      const p = await pair("journal"),
        later = await sequence(p.f, p.invocationId);
      await proveValid(later.statement);
      const outcomes = await Promise.allSettled([
        harness.database.query(p.v3.statement),
        harness.database.query(later.statement),
      ]);
      expect(
        outcomes.filter((outcome) => outcome.status === "fulfilled"),
      ).toHaveLength(1);
      const rejected = outcomes.find(
        (outcome) => outcome.status === "rejected",
      );
      expect(
        rejected?.status === "rejected" ? rejected.reason : null,
      ).toMatchObject({ code: "23514" });
      expect(await state(p.f.scope.organizationId)).toMatchObject({
        sequences: 1,
        journals: 0,
        sets: 0,
      });
    }, 30000);

    it("preserves ordinary historical journal preparation and stored readback", async () => {
      const f = await createLiveJournalPgFixture(harness),
        before = await state(f.scope.organizationId);
      await f.journal.prepare(f.callback);
      expect(await f.row()).toMatchObject({
        invocation_id: f.journalBinding.invocationId,
        gateway_state: "registered",
      });
      expect(await state(f.scope.organizationId)).toEqual({
        ...before,
        journals: 1,
      });
    }, 30000);
  },
);
