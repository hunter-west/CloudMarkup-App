import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { modelBlockingQuestionsResponseV1Schema } from "@cloudmarkup/schemas";
import { loadMigrations } from "./migrations.js";
import { sql } from "./sql.js";
import { PostgresModelLiveCommercialAccounting } from "./model-live-commercial-accounting.js";
import { readProductionModelLiveObservationV2 } from "../../production-model-live-observation.js";
import { syntheticQuestionsCase } from "../../model-live-questions-test-helpers.js";
import { createModelAccountingPgTestHarness } from "./model-commercial-accounting-pg-test-helpers.js";
import { createLiveHostEvidencePgFixture } from "./model-live-runtime-host-evidence-pg-test-helpers.js";
import { prepareProductionModelLiveProposalValidation } from "../../production-model-live-proposal-validation.js";
const configured = process.env["CLOUDMARKUP_TEST_DATABASE_URL"]?.trim();
const integration = configured ? describe : describe.skip;
/** Real isolated SQL and fixed validator with synthetic provider responses only. */
integration("durable actual clarification case assessment", () => {
  const harness = createModelAccountingPgTestHarness(configured);
  beforeAll(() => harness.setup(), 120000);
  afterAll(() => harness.teardown(), 30000);
  async function fixture(completeQuestions = true) {
    const synthetic = syntheticQuestionsCase();
    const request = synthetic.request;
    const f = await createLiveHostEvidencePgFixture(
      harness,
      "candidate",
      true,
      true,
      "standard",
      { request, caseId: synthetic.evaluationCase.caseId, fullBeta: true },
    );
    const response = modelBlockingQuestionsResponseV1Schema.parse(
      f.gatewayResult.response,
    );
    response.questions = structuredClone(synthetic.response.questions);
    response.proposalContext.assumptions = [];
    response.proposalContext.unknowns = [];
    if (!completeQuestions) response.questions.pop();
    Object.assign(f.gatewayResult.response, response);
    if (!f.liveRouting || !f.executionInput)
      throw Error("Missing real scoped execution");
    const host = await prepareProductionModelLiveProposalValidation({
      invocation: f.hostInput.invocation,
      context: f.liveRouting.context,
      execution: f.executionInput,
      allowedApprovalPathIds: [],
    });
    if (!host) throw Error("Missing fixed validator");
    const issue = (overrides: Partial<Parameters<typeof host.issue>[0]> = {}) =>
      host.issue({
        plans: f.plans,
        evidence: f.issuer,
        journal: f.journal,
        result: f.gatewayResult,
        signal: new AbortController().signal,
        authorize: () => Promise.resolve(),
        ...overrides,
      });
    const accounting = new PostgresModelLiveCommercialAccounting({
      database: f.database,
      scope: f.scope,
      binding: f.binding,
      plans: f.plans,
      ...f.identity,
    });
    const observe = () =>
      readProductionModelLiveObservationV2({
        journal: f.journal,
        accounting,
        request: f.record.request,
        admissionRequest: f.runtime.request,
        authorize: () => Promise.resolve(),
      });
    const receipts = () =>
      harness.database.query(
        sql(
          "SELECT receipt_record FROM model_live_proposal_validation_receipts WHERE organization_id=$1",
          [f.scope.organizationId],
        ),
      );
    return { ...f, issue, observe, receipts };
  }
  it.each([false, true])(
    "records actual completeQuestions=%s with exact canonical usage",
    async (completeQuestions) => {
      const f = await fixture(completeQuestions);
      await f.complete();
      const receipt = await f.issue();
      expect(receipt.assessment.validatorVersion).toBe("2.4.0");
      expect(receipt.assessment.measurements).toHaveLength(6);
      expect(
        receipt.assessment.measurements.find(
          (m) => m.dimension === "capability-requirement-coverage",
        )?.numerator,
      ).toBe(completeQuestions ? 4 : 3);
      expect(await f.issue()).toEqual(receipt);
      expect((await f.journal.readValidatedUsage()).receipt).toEqual(receipt);
      const result = await f.observe();
      expect(result.observation.measurements).toHaveLength(10);
      expect(result.caseResult.outputDigest).toBe(
        receipt.assessment.outputDigest,
      );
      if (!completeQuestions)
        expect(result.caseResult.deterministicPassed).toBe(false);
      expect(JSON.stringify(await f.receipts())).not.toContain(
        "Which actions must be recorded",
      );
    },
    120000,
  );
  it.each([
    "cancelled",
    "withdrawn",
    "output-replaced",
    "unauthenticated",
  ] as const)(
    "denies %s without issuing a receipt",
    async (kind) => {
      const f = await fixture();
      await f.complete();
      const controller = new AbortController();
      if (kind === "cancelled") controller.abort();
      if (kind === "withdrawn") f.removeOperators();
      if (kind === "output-replaced")
        Reflect.set(f.gatewayResult.response, "unexpectedGrade", true);
      await expect(
        f.issue({
          signal: controller.signal,
          ...(kind === "unauthenticated"
            ? {
                authorize: () =>
                  Promise.reject(Error("Synthetic denied authority")),
              }
            : {}),
        }),
      ).rejects.toThrow();
      expect((await f.receipts()).rowCount).toBe(0);
    },
    120000,
  );
  it("issues one immutable receipt under concurrent validation", async () => {
    const f = await fixture();
    await f.complete();
    const receipts = await Promise.all([f.issue(), f.issue()]);
    expect(receipts[0]).toEqual(receipts[1]);
    expect((await f.receipts()).rowCount).toBe(1);
  }, 120000);
  it("denies cross-tenant completed journal substitution", async () => {
    const f = await fixture(),
      other = await fixture();
    await f.complete();
    await other.complete();
    await expect(f.issue({ journal: other.journal })).rejects.toThrow();
    await expect(other.issue({ result: f.gatewayResult })).rejects.toThrow();
    expect((await f.receipts()).rowCount).toBe(0);
    expect((await other.receipts()).rowCount).toBe(0);
  }, 120000);
  it.each(["before-receipt", "before-settlement"] as const)(
    "rechecks current tenant membership %s",
    async (phase) => {
      const f = await fixture();
      await f.complete();
      if (phase === "before-settlement") await f.issue();
      await harness.database.query(
        sql(
          "UPDATE memberships SET lifecycle_status='suspended' WHERE organization_id=$1 AND principal_id=$2",
          [f.scope.organizationId, f.scope.userId],
        ),
      );
      if (phase === "before-receipt") await expect(f.issue()).rejects.toThrow();
      else await expect(f.observe()).rejects.toThrow();
      expect(
        (
          await harness.database.query(
            sql(
              "SELECT 1 FROM usage_ledger_entries WHERE organization_id=$1 AND entry_kind='settlement'",
              [f.scope.organizationId],
            ),
          )
        ).rowCount,
      ).toBe(0);
    },
    120000,
  );
  it("rejects missing, altered and externally graded assessment metadata at the SQL boundary", async () => {
    const f = await fixture();
    await f.complete();
    const receipt = await f.issue();
    for (const mutate of [
      (v: typeof receipt.assessment) => {
        v.measurements.pop();
      },
      (v: typeof receipt.assessment) => {
        const coverage = v.measurements.find(
          (m) => m.dimension === "capability-requirement-coverage",
        );
        if (coverage) coverage.denominator = 5;
      },
      (v: typeof receipt.assessment) => {
        Reflect.set(v, "passed", true);
      },
    ]) {
      const candidate = structuredClone(receipt.assessment);
      mutate(candidate);
      expect(
        (
          await harness.database.query(
            sql(
              "SELECT cloudmarkup_live_proposal_assessment_shape($1::jsonb) AS valid",
              [JSON.stringify(candidate)],
            ),
          )
        ).rows[0]?.["valid"],
      ).toBe(false);
    }
  }, 120000);
  it("preserves all 48 historical migrations byte-for-byte", async () => {
    const migrations = await loadMigrations(
      fileURLToPath(new URL("../../../migrations", import.meta.url)),
    );
    expect(migrations).toHaveLength(120);
    expect(migrations.reduce((n, m) => n + m.statements.length, 0)).toBe(1367);
    const prior = {
      storageContractVersion: 1,
      migrations: migrations
        .slice(0, 48)
        .map(({ version, file, checksumSha256 }) => ({
          version,
          file,
          checksumSha256,
        })),
    };
    expect(
      createHash("sha256")
        .update(JSON.stringify(prior, null, 2) + "\n")
        .digest("hex"),
    ).toBe("05e5e832d17f57be2f4107482126fddfffbd4c6d3b3a5b3d25c37138c732736e");
    expect(
      migrations.find(({ version }) => version === "0049")?.statements,
    ).toHaveLength(2);
  });
});
