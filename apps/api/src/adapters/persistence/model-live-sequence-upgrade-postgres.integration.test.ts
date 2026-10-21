import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "./migrations.js";
import {
  loadRegisteredEvaluationSuccessor,
  requireRegisteredEvaluationSuccessor,
} from "./model-live-registered-successor-test-helpers.js";
import { persistedExportRunFixture } from "./solution-export-run-test-helpers.js";
import {
  digestStructuredValue,
  frozenFullBetaEvaluationDatasetV1,
  frozenModelEvaluationDatasetV1,
} from "@cloudmarkup/model-gateway";
import { createProductionModelLiveCaseRequest } from "../../production-model-live-case-request.js";
import { prepareProductionModelLiveProposalValidation } from "../../production-model-live-proposal-validation.js";
import { readProductionModelLiveObservationV2 } from "../../production-model-live-observation.js";
import { createModelAccountingPgTestHarness } from "./model-commercial-accounting-pg-test-helpers.js";
import { createLiveHostEvidencePgFixture } from "./model-live-runtime-host-evidence-pg-test-helpers.js";
import { createLiveJournalPgFixture } from "./model-live-invocation-journal-pg-test-helpers.js";
import { PostgresModelLiveCommercialAccounting } from "./model-live-commercial-accounting.js";
import { PostgresModelLiveEvaluationPlans } from "./model-live-evaluation-plans.js";
import { PostgresModelLiveInvocationJournal } from "./model-live-invocation-journal.js";
import {
  liveJournalBindingSchema,
  liveJournalScope,
} from "./model-live-invocation-journal-codec.js";
import { parseLiveRuntimeRecord } from "./model-live-runtime-admission-codec.js";
import { PostgresModelLiveInvocationSets } from "./model-live-invocation-sets.js";
import { readModelLiveParserInputReceipt } from "./model-live-parser-input.js";
import { readStoredModelLiveObservationV2 } from "./model-live-observation-reader.js";
import {
  applyProposedSequenceMigrationForRegistered57,
  requireRegisteredSequencePredecessor57,
} from "./model-live-sequence-successor-migration-test-helpers.js";
import {
  sql,
  type SqlDatabase,
  type SqlRow,
  type SqlStatement,
} from "./sql.js";

const configured = process.env["CLOUDMARKUP_TEST_DATABASE_URL"]?.trim();
const integration = configured ? describe : describe.skip;

/** Real current parser, plan/set issuance, SQL journal, validation and canonical
 * settlement over fixed synthetic provider responses. No HTTP/model call, V3
 * execution. Each mode creates genuine rows on57 before an overlay or actual
 * registered57-to58-to59 migration. The historical checkpoint remains separate. */
integration.each(["historical-proposal", "registered"] as const)(
  "registered57 rows survive %s successors",
  (mode) => {
    const harness = createModelAccountingPgTestHarness(configured, "0057");
    beforeAll(() => harness.setup(), 120000);
    afterAll(() => harness.teardown(), 30000);

    async function settledParser(
      kind: "ambiguous-source-code-inference" | "external-existing-resource",
    ) {
      const executablePath =
        process.env["CLOUDMARKUP_TEST_COMPILER_EXECUTABLE"];
      const executableSha256 = process.env["CLOUDMARKUP_TEST_COMPILER_SHA256"];
      if (!executablePath || !executableSha256)
        throw Error(
          "The actual pinned parser is required for the configured upgrade gate.",
        );
      const evaluationCase = frozenFullBetaEvaluationDatasetV1.cases.find(
        (entry) => entry.caseKind === kind,
      );
      if (!evaluationCase)
        throw Error("Missing fixed repository evaluation case.");
      const request = createProductionModelLiveCaseRequest({
        caseId: evaluationCase.caseId,
        requestedMode: "guided",
      });
      const fixture = await createLiveHostEvidencePgFixture(
        harness,
        "candidate",
        true,
        true,
        "standard",
        {
          request,
          caseId: evaluationCase.caseId,
          fullBeta: true,
        },
      );
      if (!fixture.executionInput || !fixture.liveRouting)
        throw Error("Actual issued repository authority is required.");
      const validator = await prepareProductionModelLiveProposalValidation({
        plans: fixture.plans,
        invocation: fixture.hostInput.invocation,
        context: fixture.liveRouting.context,
        execution: fixture.executionInput,
        allowedApprovalPathIds: [],
        repositoryCompiler: { executablePath, executableSha256 },
      });
      if (!validator)
        throw Error("The actual successor parser validator is required.");
      const parser = await fixture.plans.withIssuedMetadata(
        fixture.identity,
        ({ transaction }) =>
          readModelLiveParserInputReceipt(transaction, {
            ...fixture.scope,
            invocationId: fixture.hostInput.invocation.descriptor.invocationId,
          }),
      );
      if (!parser)
        throw Error("The actual pre-inference parser receipt is required.");
      expect(parser.repositoryParser.importerVersion).toBe("1.0.2");
      await fixture.complete();
      const receipt = await validator.issue({
        plans: fixture.plans,
        evidence: fixture.issuer,
        journal: fixture.journal,
        result: fixture.gatewayResult,
        signal: new AbortController().signal,
        authorize: async () => {
          await fixture.plans.requireCurrent(fixture.identity);
        },
      });
      expect(receipt.assessment.validatorVersion).toBe(
        kind === "external-existing-resource" ? "2.10.0" : "2.9.0",
      );
      const accounting = new PostgresModelLiveCommercialAccounting({
        database: fixture.database,
        plans: fixture.plans,
        scope: fixture.scope,
        binding: fixture.binding,
        ...fixture.identity,
      });
      const observation = await readProductionModelLiveObservationV2({
        journal: fixture.journal,
        accounting,
        request: fixture.record.request,
        admissionRequest: fixture.runtime.request,
        authorize: async () => {
          await fixture.plans.requireCurrent(fixture.identity);
        },
      });
      // Capture the additive stored-reader identity from actual scoped rows before
      // the overlay. No post-upgrade reader value supplies an expected identity.
      const found = await harness.database.query(
        sql(
          `SELECT j.binding,j.binding_sha256,r.snapshot,r.snapshot_sha256
       FROM model_live_invocations j
       JOIN model_commercial_reservation_decisions d
         ON d.organization_id=j.organization_id AND d.project_id=j.project_id
         AND d.principal_id=j.principal_id AND d.scope_sha256=j.scope_sha256
         AND d.workflow_id=j.workflow_id
       JOIN model_runtime_admissions r
         ON r.organization_id=j.organization_id AND r.project_id=j.project_id
         AND r.principal_id=j.principal_id AND r.scope_sha256=d.runtime_scope_sha256
       WHERE j.organization_id=$1 AND j.project_id=$2 AND j.principal_id=$3
         AND j.invocation_id=$4`,
          [
            fixture.scope.organizationId,
            fixture.scope.projectId,
            fixture.scope.userId,
            fixture.journal.binding.invocationId,
          ],
        ),
      );
      expect(found.rowCount).toBe(1);
      const row = found.rows[0];
      if (!row) throw Error("The pre-upgrade scoped identity row is required.");
      const binding = liveJournalBindingSchema.parse(row["binding"]);
      const runtime = parseLiveRuntimeRecord(
        row["snapshot"],
        liveJournalScope(binding),
      );
      expect(digestStructuredValue(binding).slice(7)).toBe(
        row["binding_sha256"],
      );
      expect(digestStructuredValue(runtime).slice(7)).toBe(
        row["snapshot_sha256"],
      );
      expect(binding.invocationId).toBe(fixture.journal.binding.invocationId);
      expect(binding.runtimeRequestDigest).toBe(runtime.request.requestDigest);
      const observationIdentity = {
        invocationId: binding.invocationId,
        journalBindingDigest: digestStructuredValue(binding),
        runtimeRequestDigest: runtime.request.requestDigest,
      };
      return { ...fixture, parser, receipt, observation, observationIdentity };
    }

    async function snapshot(organizationId: string) {
      const state: Record<string, readonly SqlRow[]> = {};
      // Fixed table allowlist; complete row content stays in memory and is synthetic.
      for (const table of [
        "model_live_evaluation_plans",
        "model_live_invocation_sets",
        "model_live_parser_input_receipts",
        "model_live_runtime_host_evidence",
        "model_live_invocations",
        "model_live_proposal_validation_receipts",
        "model_commercial_workflows",
        "model_commercial_workflow_revisions",
        "model_commercial_reservation_decisions",
        "model_commercial_accounting_outcomes",
        "model_runtime_admissions",
        "model_platform_spend_reservations",
        "credit_grants",
        "credit_reservations",
        "credit_reservation_allocations",
        "usage_ledger_entries",
        "model_usage_event_details",
      ]) {
        state[table] = (
          await harness.database.query(
            sql(
              `SELECT to_jsonb(record) AS record FROM ${table} record WHERE organization_id=$1 ORDER BY to_jsonb(record)::text`,
              [organizationId],
            ),
          )
        ).rows;
      }
      return structuredClone(state);
    }

    async function retainedProductSnapshot() {
      const state: Record<string, readonly SqlRow[]> = {};
      for (const table of [
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
        "credit_reservation_allocations",
        "usage_ledger_entries",
        "stored_objects",
        "architecture_drafts",
        "architecture_revisions",
        "solution_records",
        "async_jobs",
        "solution_export_runs",
        "solution_export_artifacts",
        "solution_export_artifact_files",
        "solution_export_download_grants",
      ])
        state[table] = (
          await harness.database.query(
            sql(
              "SELECT to_jsonb(record) AS record FROM " +
                table +
                " record ORDER BY to_jsonb(record)::text",
            ),
          )
        ).rows;
      return structuredClone(state);
    }

    function existingOnlyDatabase() {
      const attemptedMutations: string[] = [];
      function requireRead(statement: SqlStatement) {
        if (!/^\s*SELECT\b/iu.test(statement.text)) {
          attemptedMutations.push(
            statement.text.trim().split(/\s+/u)[0] ?? "unknown",
          );
          throw Error(
            "Existing-only compatibility reads cannot mutate persistence.",
          );
        }
      }
      const database: SqlDatabase = {
        query: <R extends SqlRow>(statement: SqlStatement) => {
          requireRead(statement);
          return harness.database.query<R>(statement);
        },
        transaction: (work) =>
          harness.database.transaction((transaction) =>
            work({
              query: <R extends SqlRow>(statement: SqlStatement) => {
                requireRead(statement);
                return transaction.query<R>(statement);
              },
            }),
          ),
        close: () => Promise.resolve(),
      };
      return { database, attemptedMutations };
    }

    function coldPlans(
      fixture: Pick<
        Awaited<ReturnType<typeof createLiveJournalPgFixture>>,
        "scope" | "principal" | "plan" | "identity"
      >,
      database: SqlDatabase,
      dataset: typeof frozenFullBetaEvaluationDatasetV1,
    ) {
      return new PostgresModelLiveEvaluationPlans({
        database,
        scope: fixture.plan.definition.scope,
        principal: fixture.principal,
        configuration: {
          environment: fixture.plan.definition.scope.environment,
          resolveOperatorPrincipalIds: () =>
            Promise.resolve([fixture.scope.userId]),
          resolveDefinition: (definitionId) =>
            Promise.resolve(
              definitionId === fixture.identity.definitionId
                ? {
                    definition: fixture.plan.definition,
                    policy: fixture.plan.definition.policy,
                    dataset,
                  }
                : null,
            ),
        },
      });
    }

    it("preserves pre-upgrade selected, parser, validation, terminal and financial rows through existing-only reads", async () => {
      await requireRegisteredSequencePredecessor57(harness.database);
      const selected = await createLiveHostEvidencePgFixture(
        harness,
        "candidate",
        true,
        true,
        "standard",
      );
      const sets = new PostgresModelLiveInvocationSets(selected.plans);
      const invocationSet = await sets.issue(selected.identity);
      const entry = invocationSet.entries.find(
        (candidate) =>
          candidate.caseId === selected.journalBinding.evaluationCaseId,
      );
      if (!entry)
        throw Error("A genuinely issued selected invocation is required.");
      const setReference = {
        setId: invocationSet.setId,
        setDigest: invocationSet.setDigest,
      };
      const journal = new PostgresModelLiveInvocationJournal({
        ...selected.options,
        selectedInvocationSet: setReference,
        binding: {
          ...selected.journalBinding,
          invocationId: entry.invocationId,
        },
      });
      await journal.prepare(selected.callback);
      const repository = await settledParser("ambiguous-source-code-inference");
      const external = await settledParser("external-existing-resource");
      const fixtures = [selected, repository, external];
      const exports = await Promise.all([
        persistedExportRunFixture(harness.database, "terraform"),
        persistedExportRunFixture(harness.database, "cloudformation"),
      ]);
      for (const fixture of exports) {
        await fixture.createRoot();
        await fixture.repository.insertPreparedRun(fixture.prepared);
      }
      const productBefore = await retainedProductSnapshot();
      expect(productBefore["solution_records"]).toHaveLength(2);
      expect(productBefore["solution_export_runs"]).toHaveLength(2);
      expect(productBefore["architecture_revisions"]?.length).toBeGreaterThan(
        0,
      );
      expect(productBefore["credit_grants"]?.length).toBeGreaterThan(0);
      const before = await Promise.all(
        fixtures.map((fixture) => snapshot(fixture.scope.organizationId)),
      );
      expect(before[0]?.["model_live_invocation_sets"]).toHaveLength(1);
      expect(before[0]?.["model_live_invocations"]).toHaveLength(1);
      for (const index of [1, 2]) {
        expect(
          before[index]?.["model_live_parser_input_receipts"],
        ).toHaveLength(1);
        expect(
          before[index]?.["model_live_proposal_validation_receipts"],
        ).toHaveLength(1);
        expect(
          before[index]?.["model_commercial_accounting_outcomes"]?.length,
        ).toBeGreaterThan(0);
      }
      const beforeDigest = digestStructuredValue(before);
      if (mode === "historical-proposal") {
        await applyProposedSequenceMigrationForRegistered57(harness.database);
      } else {
        const predecessorLedger = await requireRegisteredEvaluationSuccessor(
          harness.database,
          "0057",
        );
        for (const version of ["0058", "0059"] as const) {
          const priorVersion = version === "0058" ? "0057" : "0058";
          const beforeLedger = await requireRegisteredEvaluationSuccessor(
            harness.database,
            priorVersion,
          );
          const migrations = await loadRegisteredEvaluationSuccessor(version);
          if (version === "0058") {
            const last = migrations.at(-1)?.statements.at(-1);
            if (!last)
              throw Error("Missing final reciprocal trigger statement.");
            const injected = Error("Synthetic reciprocal-tail failure.");
            const failing: SqlDatabase = {
              query: harness.database.query.bind(harness.database),
              close: () => Promise.resolve(),
              transaction: (work) =>
                harness.database.transaction((transaction) =>
                  work({
                    query: <R extends SqlRow>(statement: SqlStatement) => {
                      if (statement.text === last) throw injected;
                      return transaction.query<R>(statement);
                    },
                  }),
                ),
            };
            await expect(runMigrations(failing, migrations)).rejects.toBe(
              injected,
            );
            expect(
              await requireRegisteredEvaluationSuccessor(
                harness.database,
                "0057",
              ),
            ).toEqual(beforeLedger);
            expect(
              (
                await harness.database.query(
                  sql(
                    "SELECT to_regclass('model_live_sequence_plans') AS plans, to_regclass('model_live_sequence_selections') AS selections",
                  ),
                )
              ).rows[0],
            ).toEqual({ plans: null, selections: null });
            expect(await retainedProductSnapshot()).toEqual(productBefore);
            expect(
              await Promise.all(
                fixtures.map((fixture) =>
                  snapshot(fixture.scope.organizationId),
                ),
              ),
            ).toEqual(before);
          }
          await runMigrations(harness.database, migrations);
          const afterLedger = await requireRegisteredEvaluationSuccessor(
            harness.database,
            version,
          );
          expect(afterLedger.slice(0, beforeLedger.length)).toEqual(
            beforeLedger,
          );
          expect(afterLedger.slice(0, 57)).toEqual(predecessorLedger);
          expect(
            await Promise.all(
              fixtures.map((fixture) => snapshot(fixture.scope.organizationId)),
            ),
          ).toEqual(before);
          expect(await retainedProductSnapshot()).toEqual(productBefore);
          await runMigrations(harness.database, migrations);
          expect(
            await requireRegisteredEvaluationSuccessor(
              harness.database,
              version,
            ),
          ).toEqual(afterLedger);
          await expect(
            runMigrations(
              harness.database,
              migrations.filter((migration) => migration.version < version),
            ),
          ).rejects.toThrow();
          await expect(
            runMigrations(
              harness.database,
              migrations.map((migration) =>
                migration.version === version
                  ? { ...migration, checksumSha256: "0".repeat(64) }
                  : migration,
              ),
            ),
          ).rejects.toThrow();
          expect(
            await requireRegisteredEvaluationSuccessor(
              harness.database,
              version,
            ),
          ).toEqual(afterLedger);
          expect(await retainedProductSnapshot()).toEqual(productBefore);
        }
      }
      expect(
        await Promise.all(
          fixtures.map((fixture) => snapshot(fixture.scope.organizationId)),
        ),
      ).toEqual(before);
      const reads = existingOnlyDatabase();
      for (const fixture of [repository, external]) {
        const plans = coldPlans(
          fixture,
          reads.database,
          frozenFullBetaEvaluationDatasetV1,
        );
        const identity = {
          ...fixture.identity,
          invocationId: fixture.journal.binding.invocationId,
        };
        const first = await readStoredModelLiveObservationV2({
          database: reads.database,
          plans,
          ...identity,
        });
        expect(first).toEqual({
          ...fixture.observation,
          ...fixture.observationIdentity,
        });
        expect(
          await readStoredModelLiveObservationV2({
            database: reads.database,
            plans,
            ...identity,
          }),
        ).toEqual(first);
        expect(
          await plans.withIssuedMetadata(fixture.identity, ({ transaction }) =>
            readModelLiveParserInputReceipt(transaction, fixture.parser),
          ),
        ).toEqual(fixture.parser);
      }
      const selectedPlans = coldPlans(
        selected,
        reads.database,
        frozenModelEvaluationDatasetV1,
      );
      expect(
        await new PostgresModelLiveInvocationSets(selectedPlans).requireCurrent(
          {
            ...selected.identity,
            invocationSet: setReference,
            selected: entry,
          },
        ),
      ).toEqual(invocationSet);
      expect(reads.attemptedMutations).toEqual([]);
      const after = await Promise.all(
        fixtures.map((fixture) => snapshot(fixture.scope.organizationId)),
      );
      expect(after).toEqual(before);
      expect(digestStructuredValue(after)).toBe(beforeDigest);
      expect(await retainedProductSnapshot()).toEqual(productBefore);
      for (const fixture of exports)
        expect(await fixture.repository.getJob(fixture.selector)).toEqual({
          record: fixture.record,
          recordVersion: 1,
        });
      if (mode === "historical-proposal")
        await requireRegisteredSequencePredecessor57(harness.database);
      else await requireRegisteredEvaluationSuccessor(harness.database);
    }, 120000);
  },
);
