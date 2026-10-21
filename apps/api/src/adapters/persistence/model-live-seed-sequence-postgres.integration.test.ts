import { createSeedBoundSequencePgFixture } from "./model-live-seed-sequence-test-helpers.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  digestCanonicalValue,
  modelLiveSequenceDefinitionV3Schema,
  modelLiveSequencePlanV3Schema,
  type ModelLiveSequencePlanV3,
} from "@cloudmarkup/schemas";
import { createModelAccountingPgTestHarness } from "./model-commercial-accounting-pg-test-helpers.js";
import { applySeedValidationProposal } from "./model-live-proposal-migrations-test-helpers.js";
import {
  sql,
  type SqlDatabase,
  type SqlExecutor,
  type SqlRow,
  type SqlStatement,
} from "./sql.js";

const configured = process.env["CLOUDMARKUP_TEST_DATABASE_URL"]?.trim();
const integration = configured ? describe : describe.skip;
const denied = { code: "model-live.sequence-unavailable" };
const hash = <T extends object>(value: T, key: string): T => ({
  ...value,
  [key]: digestCanonicalValue(
    Object.fromEntries(Object.entries(value).filter(([name]) => name !== key)),
  ),
});
integration(
  "receipt-bound private sequence approval on actual PostgreSQL",
  () => {
    const harness = createModelAccountingPgTestHarness(configured, "0098");
    beforeAll(async () => {
      await harness.setup();
      await applySeedValidationProposal(harness.database);
    }, 120000);
    afterAll(() => harness.teardown(), 30000);

    const fixture = createSeedBoundSequencePgFixture(harness);

    it.each([0, 1])(
      "denies approval with only %i issued seeds and never implicitly runs tools",
      async (count) => {
        const f = await fixture();
        await f.seeds(count);
        await expect(f.adapter.approve(f.approval())).rejects.toMatchObject(
          denied,
        );
        expect(f.host.open).toHaveBeenCalledTimes(count);
        expect(await f.stored()).toMatchObject({ plans: 0, selections: 0 });
      },
      30000,
    );

    it("approves exact receipts, restores after restart and replays one immutable selection", async () => {
      const f = await fixture();
      const { receipts, plan, reference } = await f.issue();
      expect(
        receipts.every(
          (r) => Date.parse(r.issuedAt) <= Date.parse(plan.approval.approvedAt),
        ),
      ).toBe(true);
      expect(await f.adapter.approve(f.approval())).toEqual(plan);
      expect(await f.make().requireCurrent(reference)).toEqual(plan);
      const selections = await Promise.all([
        f.adapter.issueSelection(reference),
        f.make().issueSelection(reference),
      ]);
      expect(selections[0]).toEqual(selections[1]);
      const selection = selections[0];
      expect(
        await f.make().requireCurrentSelection({
          ...reference,
          selectionId: selection.selectionId,
          selectionDigest: selection.selectionDigest,
        }),
      ).toEqual(selection);
      expect(f.host.open).toHaveBeenCalledTimes(2);
      expect(await f.stored()).toMatchObject({ plans: 1, selections: 1 });
    }, 60000);

    it.each([
      "sourceDigest",
      "revisionDigest",
      "candidateDigest",
      "ownershipDigest",
      "validationReceiptDigest",
      "validatorPolicyDigest",
    ] as const)(
      "denies coherently rehashed %s substitution before approval",
      async (key) => {
        const f = await fixture();
        await f.seeds();
        f.definitionState.definition =
          modelLiveSequenceDefinitionV3Schema.parse(
            hash(
              {
                ...f.definitionState.definition,
                cases: f.definitionState.definition.cases.map((entry) => ({
                  ...entry,
                  seed: {
                    ...entry.seed,
                    [key]: digestCanonicalValue({ replacement: key }),
                  },
                })),
              },
              "definitionDigest",
            ),
          );
        await expect(f.adapter.approve(f.approval())).rejects.toMatchObject(
          denied,
        );
        expect(await f.stored()).toMatchObject({ plans: 0 });
        expect(f.host.open).toHaveBeenCalledTimes(2);
      },
      30000,
    );

    it("copies the approval request before asynchronous source admission", async () => {
      const f = await fixture();
      await f.seeds();
      const approval = f.approval();
      const original = { ...approval };
      f.host.assertHostIsolation.mockImplementation(() => {
        expect(f.state.transactionDepth).toBe(0);
        approval.definitionId = "definition_changed_after_admission";
        approval.expectedDefinitionDigest = digestCanonicalValue({
          changed: true,
        });
        return Promise.resolve();
      });
      const plan = await f.adapter.approve(approval);
      expect(plan.definition.definitionId).toBe(original.definitionId);
      expect(plan.definition.definitionDigest).toBe(
        original.expectedDefinitionDigest,
      );
      expect(f.host.open).toHaveBeenCalledTimes(2);
    }, 30000);

    it.each(["operator", "host", "definition", "membership"] as const)(
      "denies selection when %s authority is withdrawn during source admission",
      async (kind) => {
        const f = await fixture();
        const { reference } = await f.issue();
        let preflightCompleted = false;
        f.host.assertHostIsolation.mockImplementation(async () => {
          expect(f.state.transactionDepth).toBe(0);
          if (kind === "operator") f.state.operators = [];
          if (kind === "host") f.state.available = false;
          if (kind === "definition") f.definitionState.available = false;
          if (kind === "membership")
            await harness.database.query(
              sql(
                "UPDATE memberships SET lifecycle_status='suspended' WHERE organization_id=$1 AND principal_id=$2",
                [f.scope.organizationId, f.scope.userId],
              ),
            );
          preflightCompleted = true;
        });
        await expect(f.adapter.issueSelection(reference)).rejects.toMatchObject(
          denied,
        );
        expect(preflightCompleted).toBe(true);
        if (kind === "membership") {
          const membership = await harness.database.query(
            sql(
              "SELECT lifecycle_status FROM memberships WHERE organization_id=$1 AND principal_id=$2",
              [f.scope.organizationId, f.scope.userId],
            ),
          );
          expect(membership.rows).toEqual([{ lifecycle_status: "suspended" }]);
        }
        expect(await f.stored()).toMatchObject({ plans: 1, selections: 0 });
        expect(await f.count()).toBe(2);
        expect(f.host.open).toHaveBeenCalledTimes(2);
      },
      30000,
    );

    it("rolls back approval if current host authority disappears after insert", async () => {
      const f = await fixture();
      await f.seeds();
      f.state.afterInsert = () => {
        f.state.available = false;
        return Promise.resolve();
      };
      await expect(f.adapter.approve(f.approval())).rejects.toMatchObject(
        denied,
      );
      expect(await f.stored()).toMatchObject({ plans: 0 });
      expect(await f.count()).toBe(2);
    }, 30000);

    it("keeps revocation available after the validation host is unavailable", async () => {
      const f = await fixture();
      const { reference } = await f.issue();
      f.state.available = false;
      const preflights = f.host.assertHostIsolation.mock.calls.length;
      await expect(f.adapter.requireCurrent(reference)).rejects.toMatchObject(
        denied,
      );
      await f.adapter.revoke(reference);
      await f.adapter.revoke(reference);
      expect(await f.stored()).toMatchObject({ plans: 1, revocations: 1 });
      expect(f.host.assertHostIsolation).toHaveBeenCalledTimes(preflights);
      f.state.available = true;
      await expect(f.adapter.requireCurrent(reference)).rejects.toMatchObject(
        denied,
      );
    }, 30000);

    it("rejects an exactly rehashed restored plan approved before its seed receipts existed", async () => {
      const f = await fixture();
      const { plan, receipts } = await f.issue();
      const first = receipts[0];
      if (!first) throw Error("Missing synthetic seed receipt");
      const earlier = new Date(Date.parse(first.issuedAt) - 1000).toISOString();
      const modified: ModelLiveSequencePlanV3 =
        modelLiveSequencePlanV3Schema.parse(
          hash(
            {
              ...plan,
              issuedAt: earlier,
              approval: hash(
                { ...plan.approval, approvedAt: earlier },
                "approvalDigest",
              ),
            },
            "planDigest",
          ),
        );
      const wrap = (tx: SqlExecutor): SqlExecutor => ({
        async query<TRow extends SqlRow = SqlRow>(statement: SqlStatement) {
          const result = await tx.query<TRow>(statement);
          if (!statement.text.includes("FROM model_live_sequence_plans p"))
            return result;
          return {
            ...result,
            rows: result.rows.map((row) => ({
              ...row,
              plan_record: modified,
              approval_sha256: modified.approval.approvalDigest.slice(7),
              plan_sha256: modified.planDigest.slice(7),
              issued_at_text: modified.issuedAt,
            })),
          };
        },
      });
      const database: SqlDatabase = {
        close: () => Promise.resolve(),
        query: (statement) => wrap(f.database).query(statement),
        transaction: (work) => f.database.transaction((tx) => work(wrap(tx))),
      };
      await expect(
        f.make({ database }).requireCurrent({
          definitionId: modified.definition.definitionId,
          planDigest: modified.planDigest,
        }),
      ).rejects.toMatchObject(denied);
      expect(
        await f.adapter.requireCurrent({
          definitionId: plan.definition.definitionId,
          planDigest: plan.planDigest,
        }),
      ).toEqual(plan);
    }, 30000);
  },
);
