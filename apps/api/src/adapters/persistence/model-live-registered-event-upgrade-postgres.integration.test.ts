import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  digestStructuredValue,
  frozenFullBetaEvaluationDatasetV1,
  fullBetaModelEvaluationPolicyV2,
  fullBetaEventEvaluationPolicyV2,
} from "@cloudmarkup/model-gateway";
import { createModelAccountingPgTestHarness } from "./model-commercial-accounting-pg-test-helpers.js";
import { createLiveHostEvidencePgFixture } from "./model-live-runtime-host-evidence-pg-test-helpers.js";
import { createProductionModelLiveCaseRequest } from "../../production-model-live-case-request.js";
import { prepareProductionModelLiveProposalValidation } from "../../production-model-live-proposal-validation.js";
import { readProductionModelLiveObservationV2 } from "../../production-model-live-observation.js";
import { PostgresModelLiveCommercialAccounting } from "./model-live-commercial-accounting.js";
import { readStoredModelLiveObservationV2 } from "./model-live-observation-reader.js";
import { runMigrations } from "./migrations.js";
import {
  loadRegisteredEvaluationSuccessor,
  requireRegisteredEvaluationSuccessor,
} from "./model-live-registered-successor-test-helpers.js";
import { sql } from "./sql.js";
const configured = process.env["CLOUDMARKUP_TEST_DATABASE_URL"]?.trim();
const integration = configured ? describe : describe.skip;
integration("actual registered58-to59 event receipt compatibility", () => {
  const harness = createModelAccountingPgTestHarness(configured, "0058");
  beforeAll(() => harness.setup(), 120000);
  afterAll(() => harness.teardown(), 30000);
  async function fixture(policy: typeof fullBetaModelEvaluationPolicyV2) {
    const evaluationCase = frozenFullBetaEvaluationDatasetV1.cases.find(
      (entry) => entry.caseKind === "event-driven-image-processing",
    );
    if (!evaluationCase) throw Error("Missing fixed event case.");
    const request = createProductionModelLiveCaseRequest({
      caseId: evaluationCase.caseId,
      requestedMode: "guided",
    });
    const actual = await createLiveHostEvidencePgFixture(
      harness,
      "candidate",
      true,
      true,
      "standard",
      {
        request,
        caseId: evaluationCase.caseId,
        fullBeta: true,
        evaluationPolicy: policy,
      },
    );
    if (!actual.liveRouting || !actual.executionInput)
      throw Error("Missing actual event authority.");
    const host = await prepareProductionModelLiveProposalValidation({
      invocation: actual.hostInput.invocation,
      context: actual.liveRouting.context,
      execution: actual.executionInput,
      allowedApprovalPathIds: [],
    });
    if (!host) throw Error("Missing actual event validator.");
    await actual.complete();
    const issue = () =>
      host.issue({
        plans: actual.plans,
        evidence: actual.issuer,
        journal: actual.journal,
        result: actual.gatewayResult,
        signal: new AbortController().signal,
        authorize: async () => {
          await actual.plans.requireCurrent(actual.identity);
        },
      });
    const accounting = new PostgresModelLiveCommercialAccounting({
      database: actual.database,
      scope: actual.scope,
      binding: actual.binding,
      plans: actual.plans,
      ...actual.identity,
    });
    const observe = () =>
      readProductionModelLiveObservationV2({
        journal: actual.journal,
        accounting,
        request: actual.record.request,
        admissionRequest: actual.runtime.request,
        authorize: async () => {
          await actual.plans.requireCurrent(actual.identity);
        },
      });
    const stored = () =>
      readStoredModelLiveObservationV2({
        database: harness.database,
        plans: actual.plans,
        ...actual.identity,
        invocationId: actual.journal.binding.invocationId,
      });
    return { ...actual, issue, observe, stored };
  }
  async function snapshot() {
    const records = [];
    for (const table of [
      "model_live_evaluation_plans",
      "model_live_invocations",
      "model_live_runtime_host_evidence",
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
    ])
      records.push([
        table,
        (
          await harness.database.query(
            sql(
              "SELECT to_jsonb(record) AS record FROM " +
                table +
                " record ORDER BY to_jsonb(record)::text",
            ),
          )
        ).rows,
      ]);
    return digestStructuredValue(records);
  }
  it("preserves genuine2.8 history and admits only the preissued matching2.11 policy after59", async () => {
    const legacy = await fixture(fullBetaModelEvaluationPolicyV2);
    const oldReceipt = await legacy.issue();
    expect(oldReceipt.assessment.validatorVersion).toBe("2.8.0");
    expect(await legacy.issue()).toEqual(oldReceipt);
    await legacy.observe();
    // Settlement closes execution authority; historical reads remain available.
    await expect(legacy.issue()).rejects.toThrow();
    const oldObservation = await legacy.stored();
    expect(oldObservation).not.toBeNull();
    const replayableLegacy = await fixture(fullBetaModelEvaluationPolicyV2);
    const replayableReceipt = await replayableLegacy.issue();
    const successor = await fixture(fullBetaEventEvaluationPolicyV2);
    await expect(successor.issue()).rejects.toThrow();
    expect(
      (
        await harness.database.query(
          sql(
            "SELECT 1 FROM model_live_proposal_validation_receipts WHERE organization_id=$1 AND invocation_id=$2",
            [
              successor.scope.organizationId,
              successor.journal.binding.invocationId,
            ],
          ),
        )
      ).rowCount,
    ).toBe(0);
    const before = await snapshot();
    const oldLedger = await requireRegisteredEvaluationSuccessor(
      harness.database,
      "0058",
    );
    const migrations = await loadRegisteredEvaluationSuccessor();
    await runMigrations(harness.database, migrations);
    const newLedger = await requireRegisteredEvaluationSuccessor(
      harness.database,
    );
    expect(newLedger.slice(0, 58)).toEqual(oldLedger);
    expect(await snapshot()).toBe(before);
    expect(await legacy.stored()).toEqual(oldObservation);
    await expect(legacy.issue()).rejects.toThrow();
    expect(await replayableLegacy.issue()).toEqual(replayableReceipt);
    expect(await snapshot()).toBe(before);
    await runMigrations(harness.database, migrations);
    expect(
      await requireRegisteredEvaluationSuccessor(harness.database),
    ).toEqual(newLedger);
    expect(await snapshot()).toBe(before);
    const receipt = await successor.issue();
    expect(receipt.assessment.validatorVersion).toBe("2.11.0");
    expect(await successor.issue()).toEqual(receipt);
    await successor.observe();
    expect(await successor.stored()).not.toBeNull();
    const settled = await snapshot();
    expect(await legacy.stored()).toEqual(oldObservation);
    expect(await snapshot()).toBe(settled);
  }, 120000);
});
