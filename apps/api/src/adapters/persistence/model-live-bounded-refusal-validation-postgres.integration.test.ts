import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { modelOperationProposalResponseV1Schema } from "@cloudmarkup/schemas";
import { loadMigrations } from "./migrations.js";
import { sql } from "./sql.js";
import { PostgresModelLiveCommercialAccounting } from "./model-live-commercial-accounting.js";
import { readProductionModelLiveObservationV2 } from "../../production-model-live-observation.js";
import { identifyLiveProposalValidationReceipt } from "./model-live-proposal-validation-codec.js";
import { modelLiveBoundedRefusalCaseAssessmentV2Schema } from "../../model-live-bounded-refusal-case-assessment.js";
import {
  digestStructuredValue,
  frozenFullBetaEvaluationDatasetV1,
} from "@cloudmarkup/model-gateway";
import { createProductionModelLiveCaseRequest } from "../../production-model-live-case-request.js";
import { createModelAccountingPgTestHarness } from "./model-commercial-accounting-pg-test-helpers.js";
import { waitForLiveAccountingPgTestWindow } from "./model-live-commercial-accounting-pg-test-helpers.js";
import { createLiveHostEvidencePgFixture } from "./model-live-runtime-host-evidence-pg-test-helpers.js";
import { prepareProductionModelLiveProposalValidation } from "../../production-model-live-proposal-validation.js";
const configured = process.env["CLOUDMARKUP_TEST_DATABASE_URL"]?.trim();
const integration = configured ? describe : describe.skip;
/** Real isolated SQL and fixed validator with synthetic provider responses only. */
integration.each([
  "nonexistent-unsupported-services",
  "excessive-resource-request",
] as const)("durable actual bounded refusal: %s", (caseKind) => {
  const harness = createModelAccountingPgTestHarness(configured);
  beforeAll(() => harness.setup(), 120000);
  afterAll(() => harness.teardown(), 30000);
  beforeEach(() => waitForLiveAccountingPgTestWindow(harness.database), 65000);
  async function fixture(
    outcome: "correct" | "wrong-reason" | "unrelated-proposal" = "correct",
  ) {
    const evaluationCase = frozenFullBetaEvaluationDatasetV1.cases.find(
      (c) => c.caseKind === caseKind,
    );
    if (!evaluationCase) throw Error("Missing bounded case");
    const request = createProductionModelLiveCaseRequest({
      caseId: evaluationCase.caseId,
      requestedMode: "guided",
    });
    if (request.operation !== "operations.propose")
      throw Error("Wrong operation");
    const f = await createLiveHostEvidencePgFixture(
      harness,
      "candidate",
      true,
      true,
      "standard",
      { request, caseId: evaluationCase.caseId, fullBeta: true },
    );
    const response = modelOperationProposalResponseV1Schema.parse(
      f.gatewayResult.response,
    );
    if (outcome !== "unrelated-proposal") delete response.solutionProposal;
    if (outcome !== "unrelated-proposal")
      response.batches =
        modelOperationProposalResponseV1Schema.shape.batches.parse([
          {
            contractVersion: 1,
            kind: "safety-refusal",
            reasonCodes:
              outcome === "wrong-reason"
                ? ["no-deployment-authority"]
                : caseKind === "excessive-resource-request"
                  ? ["reject-resource-limit"]
                  : ["reject-unsupported-service", "reject-unsupported-field"],
            explanation:
              "The requested resources or fields exceed the reviewed catalog or bounded request limits. No changes are proposed.",
          },
        ]);
    response.proposalContext.assumptions = [];
    response.proposalContext.unknowns = [];
    if (outcome !== "unrelated-proposal")
      Reflect.deleteProperty(f.gatewayResult.response, "solutionProposal");
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
  it.each(["correct", "wrong-reason", "unrelated-proposal"] as const)(
    "records actual %s quality and canonical usage",
    async (outcome) => {
      const f = await fixture(outcome);
      await f.complete();
      const receipt = await f.issue();
      expect(receipt.assessment.validatorVersion).toBe("2.5.0");
      expect(receipt.assessment.measurements).toHaveLength(
        caseKind === "excessive-resource-request" ? 6 : 7,
      );
      for (const dimension of [
        "issue-clarity-correct-severity",
        "unresolved-behavior-honesty",
      ])
        expect(
          receipt.assessment.measurements.find((m) => m.dimension === dimension)
            ?.numerator,
        ).toBe(outcome === "correct" ? 1 : 0);
      expect(await f.issue()).toEqual(receipt);
      expect((await f.journal.readValidatedUsage()).receipt).toEqual(receipt);
      const result = await f.observe();
      expect(result.observation.measurements).toHaveLength(
        caseKind === "excessive-resource-request" ? 10 : 11,
      );
      if (outcome !== "correct")
        expect(result.caseResult.deterministicPassed).toBe(false);
      expect(JSON.stringify(await f.receipts())).not.toContain(
        "The requested resources or fields",
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
          (m) => m.dimension === "issue-clarity-correct-severity",
        );
        if (coverage) coverage.denominator = 2;
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
  it("keeps versioned metadata readable but rejects a self-consistent source substitution against the immutable plan", async () => {
    const f = await fixture();
    await f.complete();
    const receipt = await f.issue();
    const { assessmentDigest, ...body } = receipt.assessment;
    void assessmentDigest;
    const alternate = {
      ...body,
      caseDigest: digestStructuredValue("synthetic different frozen case"),
      sourceInputDigest: digestStructuredValue("synthetic different source"),
    };
    const assessment = modelLiveBoundedRefusalCaseAssessmentV2Schema.parse({
      ...alternate,
      assessmentDigest: digestStructuredValue(alternate),
    });
    const { receiptId, receiptDigest, ...binding } = receipt;
    void receiptId;
    void receiptDigest;
    const forged = identifyLiveProposalValidationReceipt({
      ...binding,
      assessment,
    });
    await expect(
      harness.database.query(
        sql(
          "INSERT INTO model_live_proposal_validation_receipts (organization_id,project_id,principal_id,invocation_id,receipt_id,receipt_sha256,input_evidence_id,operations_evidence_id,ownership_evidence_id,receipt_record) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)",
          [
            forged.organizationId,
            forged.projectId,
            forged.userId,
            forged.invocationId,
            forged.receiptId,
            forged.receiptDigest.slice(7),
            forged.inputEvidenceId,
            forged.operationsEvidenceId,
            forged.ownershipEvidenceId,
            JSON.stringify(forged),
          ],
        ),
      ),
    ).rejects.toThrow("exact completed active invocation");
    expect((await f.journal.readValidatedUsage()).receipt).toEqual(receipt);
    expect((await f.receipts()).rowCount).toBe(1);
  }, 120000);
  it("preserves all 49 historical migrations byte-for-byte", async () => {
    const migrations = await loadMigrations(
      fileURLToPath(new URL("../../../migrations", import.meta.url)),
    );
    expect(migrations).toHaveLength(120);
    expect(migrations.reduce((n, m) => n + m.statements.length, 0)).toBe(1367);
    const prior = {
      storageContractVersion: 1,
      migrations: migrations
        .slice(0, 49)
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
    ).toBe("1623e281c41b3fbb6c5f8ac4a594b0293624866ab45d657fee65017ba5273a51");
    expect(
      migrations.find(({ version }) => version === "0050")?.statements,
    ).toHaveLength(2);
  });
});
