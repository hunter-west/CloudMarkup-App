import { setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  digestStructuredValue,
  frozenFullBetaEvaluationDatasetV1,
} from "@cloudmarkup/model-gateway";
import { modelOperationProposalResponseV1Schema } from "@cloudmarkup/schemas";
import { createProductionModelLiveCaseRequest } from "../../production-model-live-case-request.js";
import { prepareProductionModelLiveProposalValidation } from "../../production-model-live-proposal-validation.js";
import { readProductionModelLiveObservationV2 } from "../../production-model-live-observation.js";
import { createModelAccountingPgTestHarness } from "./model-commercial-accounting-pg-test-helpers.js";
import { createLiveJournalPgFixture } from "./model-live-invocation-journal-pg-test-helpers.js";
import { createLiveHostEvidencePgFixture } from "./model-live-runtime-host-evidence-pg-test-helpers.js";
import { PostgresModelLiveCommercialAccounting } from "./model-live-commercial-accounting.js";
import { PostgresModelLiveEvaluationPlans } from "./model-live-evaluation-plans.js";
import {
  ModelLiveStoredObservationError,
  readStoredModelLiveObservationV2,
} from "./model-live-observation-reader.js";
import {
  sql,
  type SqlDatabase,
  type SqlResult,
  type SqlRow,
  type SqlStatement,
} from "./sql.js";

const configured = process.env["CLOUDMARKUP_TEST_DATABASE_URL"]?.trim();
const integration = configured ? describe : describe.skip;
/** Real scoped PostgreSQL issuance and canonical settlement of a synthetic
 * provider response. These tests prove restoration, never hosted model quality. */
integration(
  "stored live observations without execution or financial writes",
  () => {
    const harness = createModelAccountingPgTestHarness(configured);
    async function fixture(
      stage: "settled" | "validated" | "completed" | "claimed" = "settled",
    ) {
      const evaluationCase = frozenFullBetaEvaluationDatasetV1.cases.find(
        (c) => c.caseKind === "event-driven-image-processing",
      );
      if (!evaluationCase) throw Error("Missing frozen event case");
      const request = createProductionModelLiveCaseRequest({
        caseId: evaluationCase.caseId,
        requestedMode: "guided",
      });
      const f = await createLiveHostEvidencePgFixture(
        harness,
        "candidate",
        true,
        true,
        "standard",
        { request, caseId: evaluationCase.caseId, fullBeta: true },
      );
      if (!f.liveRouting || !f.executionInput)
        throw Error("Missing synthetic host authority");
      const response = modelOperationProposalResponseV1Schema.parse(
        f.gatewayResult.response,
      );
      if (!response.solutionProposal) throw Error("Missing synthetic proposal");
      response.proposalContext.assumptions = [];
      response.proposalContext.unknowns =
        modelOperationProposalResponseV1Schema.shape.proposalContext.shape.unknowns.parse(
          [
            {
              confidence: response.proposalContext.confidence,
              unknownId: "missing_transform",
              blocking: true,
              question:
                "Which reviewed image transformation implementation should process the uploaded object?",
            },
          ],
        );
      response.solutionProposal.targetReadiness.status = "blocked";
      Object.assign(f.gatewayResult.response, response);
      const validator = await prepareProductionModelLiveProposalValidation({
        invocation: f.hostInput.invocation,
        context: f.liveRouting.context,
        execution: f.executionInput,
        allowedApprovalPathIds: [],
      });
      if (!validator) throw Error("Missing actual event validator");
      if (stage !== "claimed") await f.complete();
      if (stage === "validated" || stage === "settled")
        await validator.issue({
          plans: f.plans,
          evidence: f.issuer,
          journal: f.journal,
          result: f.gatewayResult,
          signal: new AbortController().signal,
          authorize: async () => {
            await f.plans.requireCurrent(f.identity);
          },
        });
      const accounting = new PostgresModelLiveCommercialAccounting({
        database: f.database,
        plans: f.plans,
        scope: f.scope,
        binding: f.binding,
        ...f.identity,
      });
      const observe = () =>
        readProductionModelLiveObservationV2({
          journal: f.journal,
          accounting,
          request: f.record.request,
          admissionRequest: f.runtime.request,
          authorize: async () => {
            await f.plans.requireCurrent(f.identity);
          },
        });
      const original = stage === "settled" ? await observe() : undefined;
      return { ...f, accounting, observe, original };
    }
    let settled: Awaited<ReturnType<typeof fixture>>;
    beforeAll(async () => {
      await harness.setup();
      settled = await fixture();
    }, 120000);
    afterAll(() => harness.teardown(), 30000);

    function reader(
      f = settled,
      options: {
        readonly fault?: (
          statement: SqlStatement,
          rows: Record<string, unknown>[],
        ) => void;
        readonly beforeQuery?: (statement: SqlStatement) => void;
        readonly expiredSession?: boolean;
        readonly operators?: readonly string[];
      } = {},
    ) {
      const writes: string[] = [];
      const inspect = async <R extends SqlRow>(
        statement: SqlStatement,
        run: () => Promise<SqlResult<R>>,
      ): Promise<SqlResult<R>> => {
        options.beforeQuery?.(statement);
        if (
          /^\s*(?:INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE)\b/iu.test(
            statement.text,
          )
        ) {
          writes.push(statement.text.split(/\s+/u).slice(0, 3).join(" "));
          throw Error("The observation reader attempted a database mutation.");
        }
        const result = await run();
        const rows = structuredClone(result.rows) as Record<string, unknown>[];
        options.fault?.(statement, rows);
        return { ...result, rows: rows as R[] };
      };
      const database: SqlDatabase = {
        query: <R extends SqlRow>(statement: SqlStatement) =>
          inspect(statement, () => harness.database.query<R>(statement)),
        close: () => Promise.resolve(),
        transaction: (work) =>
          harness.database.transaction((tx) =>
            work({
              query: <R extends SqlRow>(statement: SqlStatement) =>
                inspect(statement, () => tx.query<R>(statement)),
            }),
          ),
      };
      const plans = new PostgresModelLiveEvaluationPlans({
        database,
        scope: f.plan.definition.scope,
        principal: {
          ...f.principal,
          ...(options.expiredSession
            ? { expiresAt: "2020-01-01T00:00:00.000Z" }
            : {}),
        },
        configuration: {
          environment: f.plan.definition.scope.environment,
          resolveOperatorPrincipalIds: () =>
            Promise.resolve(options.operators ?? [f.scope.userId]),
          resolveDefinition: (id) =>
            Promise.resolve(
              id === f.identity.definitionId
                ? {
                    definition: f.plan.definition,
                    dataset: frozenFullBetaEvaluationDatasetV1,
                    policy: f.plan.definition.policy,
                  }
                : null,
            ),
        },
      });
      const input = {
        database,
        plans,
        ...f.identity,
        invocationId: f.journal.binding.invocationId,
      };
      return {
        input,
        read: () => readStoredModelLiveObservationV2(input),
        writes,
      };
    }
    async function state(
      f: { readonly scope: { readonly organizationId: string } } = settled,
      database: SqlDatabase = harness.database,
    ) {
      const rows = await database.query(
        sql(
          `SELECT
        (SELECT jsonb_agg(to_jsonb(e) ORDER BY e.ledger_entry_id) FROM usage_ledger_entries e WHERE e.organization_id=$1) AS ledger,
        (SELECT jsonb_agg(to_jsonb(o) ORDER BY o.workflow_id,o.outcome_kind) FROM model_commercial_accounting_outcomes o WHERE o.organization_id=$1) AS outcomes,
        (SELECT jsonb_agg(to_jsonb(w) ORDER BY w.workflow_id) FROM model_commercial_workflows w WHERE w.organization_id=$1) AS workflows,
        (SELECT jsonb_agg(to_jsonb(r) ORDER BY r.scope_sha256) FROM model_runtime_admissions r WHERE r.organization_id=$1) AS runtime,
        (SELECT jsonb_agg(to_jsonb(j) ORDER BY j.invocation_id) FROM model_live_invocations j WHERE j.organization_id=$1) AS journal`,
          [f.scope.organizationId],
        ),
      );
      return digestStructuredValue(rows.rows);
    }
    it("restores the exact negative assessment twice without any mutation", async () => {
      const selected = reader();
      const before = await state();
      const result = await selected.read();
      expect(result).toMatchObject(settled.original ?? {});
      expect(result).toMatchObject({
        invocationId: settled.journal.binding.invocationId,
        journalBindingDigest: digestStructuredValue(settled.journal.binding),
        runtimeRequestDigest: settled.runtime.request.requestDigest,
        caseResult: { deterministicPassed: false },
      });
      expect(
        result.observation.measurements.find(
          (m) => m.dimension === "issue-clarity-correct-severity",
        )?.numerator,
      ).toBe(0);
      expect(await selected.read()).toEqual(result);
      expect(await state()).toBe(before);
      expect(selected.writes).toEqual([]);
      expect(JSON.stringify(result)).not.toContain(
        "Which reviewed image transformation",
      );
    });
    it("does not settle a completed validated case whose terminal is missing", async () => {
      const f = await fixture("validated");
      const selected = reader(f);
      const before = await state(f);
      await expect(selected.read()).rejects.toBeInstanceOf(
        ModelLiveStoredObservationError,
      );
      expect(await state(f)).toBe(before);
      expect(selected.writes).toEqual([]);
      await expect(f.observe()).resolves.toBeDefined();
      await expect(selected.read()).resolves.toMatchObject({
        caseResult: { deterministicPassed: false },
      });
    });
    it.each(["claimed", "completed"] as const)(
      "denies %s work without inventing validation or usage",
      async (stage) => {
        const f = await fixture(stage);
        const selected = reader(f);
        const before = await state(f);
        await expect(selected.read()).rejects.toBeInstanceOf(
          ModelLiveStoredObservationError,
        );
        expect(await state(f)).toBe(before);
        expect(selected.writes).toEqual([]);
      },
    );
    it("does not turn genuinely compensated unvalidated usage into an observation", async () => {
      // Legacy synthetic pricing and candidate-host pricing are intentionally distinct.
      const compensationHarness =
        createModelAccountingPgTestHarness(configured);
      await compensationHarness.setup();
      try {
        const f = await createLiveJournalPgFixture(
          compensationHarness,
          "standard",
          undefined,
          {
            expiresAfterMilliseconds: 8000,
          },
        );
        await f.journal.prepare(f.callback);
        expect(await f.journal.claim(f.claim)).toEqual({ kind: "claimed" });
        await f.journal.record(f.usage);
        await f.journal.complete(f.claim, f.gatewayResult);
        await delay(
          Math.max(0, Date.parse(f.record.request.expiresAt) - Date.now()) + 40,
        );
        const accounting = new PostgresModelLiveCommercialAccounting({
          database: f.database,
          plans: f.plans,
          scope: f.scope,
          binding: f.binding,
          ...f.identity,
        });
        await expect(
          accounting.recoverVerified({
            request: f.record.request,
            requestDigest: f.record.fingerprint,
            admissionRequest: f.runtime.request,
          }),
        ).resolves.toMatchObject({
          kind: "verified",
          outcome: {
            kind: "release",
            event: { chargedCreditUnits: 0, status: "internal-failure" },
          },
        });
        const before = await state(f, compensationHarness.database);
        await expect(
          readStoredModelLiveObservationV2({
            database: f.database,
            plans: f.plans,
            ...f.identity,
            invocationId: f.journal.binding.invocationId,
          }),
        ).rejects.toBeInstanceOf(ModelLiveStoredObservationError);
        expect(await state(f, compensationHarness.database)).toBe(before);
      } finally {
        await compensationHarness.teardown();
      }
    }, 30000);
    it.each(["definition", "plan", "invocation", "malformed"] as const)(
      "denies changed %s selectors",
      async (kind) => {
        const selected = reader();
        const input = { ...selected.input };
        if (kind === "definition") input.definitionId = "definition_wrong";
        if (kind === "plan")
          input.planDigest = digestStructuredValue("wrong-plan");
        if (kind === "invocation") input.invocationId = "invocation_wrong";
        if (kind === "malformed") input.invocationId = "../private";
        await expect(
          readStoredModelLiveObservationV2(input),
        ).rejects.toBeInstanceOf(ModelLiveStoredObservationError);
        expect(selected.writes).toEqual([]);
      },
    );
    it.each(["expired-session", "removed-operator"] as const)(
      "denies %s before restoring evidence",
      async (kind) => {
        const selected = reader(
          settled,
          kind === "expired-session"
            ? { expiredSession: true }
            : { operators: [] },
        );
        await expect(selected.read()).rejects.toBeInstanceOf(
          ModelLiveStoredObservationError,
        );
        expect(selected.writes).toEqual([]);
      },
    );
    it("denies a real revoked approval without changing the recorded terminal", async () => {
      const f = await fixture();
      await f.plans.revoke(f.identity);
      const before = await state(f);
      const selected = reader(f);
      await expect(selected.read()).rejects.toBeInstanceOf(
        ModelLiveStoredObservationError,
      );
      expect(await state(f)).toBe(before);
      expect(selected.writes).toEqual([]);
    });
    it("cannot use another tenant's matching invocation identifier", async () => {
      const other = await fixture();
      const selected = reader(other);
      await expect(
        readStoredModelLiveObservationV2({
          ...selected.input,
          ...settled.identity,
          invocationId: settled.journal.binding.invocationId,
        }),
      ).rejects.toBeInstanceOf(ModelLiveStoredObservationError);
      expect(selected.writes).toEqual([]);
    });
    it.each([
      "journal",
      "workflow",
      "runtime",
      "accounting",
      "validation-receipt",
      "canonical-terminal",
    ] as const)(
      "denies substituted %s readback from actual PostgreSQL",
      async (kind) => {
        let substituted = false;
        const selected = reader(settled, {
          fault(statement, rows) {
            const row = rows[0];
            if (!row) return;
            const key =
              kind === "journal"
                ? "journal_sha256"
                : kind === "workflow"
                  ? "workflow_sha256"
                  : kind === "runtime"
                    ? "runtime_sha256"
                    : kind === "accounting"
                      ? "live_binding_sha256"
                      : null;
            if (key !== null && statement.text.includes("AS journal_binding")) {
              row[key] = "f".repeat(64);
              substituted = true;
            } else if (
              kind === "validation-receipt" &&
              statement.text.includes(
                "recorded_at FROM model_live_proposal_validation_receipts",
              )
            ) {
              row["receipt_sha256"] = "f".repeat(64);
              substituted = true;
            } else if (
              kind === "canonical-terminal" &&
              statement.text.includes(
                "FROM model_commercial_accounting_outcomes",
              ) &&
              statement.text.includes("outcome_kind<>")
            ) {
              row["outcome_sha256"] = "f".repeat(64);
              substituted = true;
            }
          },
        });
        const before = await state();
        await expect(selected.read()).rejects.toBeInstanceOf(
          ModelLiveStoredObservationError,
        );
        expect(substituted).toBe(true);
        expect(await state()).toBe(before);
        expect(selected.writes).toEqual([]);
      },
    );
    it("rechecks trusted time before returning after evidence was read", async () => {
      let seenReceipt = false;
      let expired = false;
      const selected = reader(settled, {
        fault(statement, rows) {
          if (
            statement.text.includes(
              "recorded_at FROM model_live_proposal_validation_receipts",
            )
          )
            seenReceipt = true;
          if (
            seenReceipt &&
            statement.text.includes("clock_timestamp() AT TIME ZONE 'UTC'") &&
            statement.text.includes("AS now") &&
            rows[0]
          ) {
            rows[0]["now"] = "2099-01-01T00:00:00.000Z";
            expired = true;
          }
        },
      });
      await expect(selected.read()).rejects.toBeInstanceOf(
        ModelLiveStoredObservationError,
      );
      expect(expired).toBe(true);
      expect(selected.writes).toEqual([]);
    });
  },
);
