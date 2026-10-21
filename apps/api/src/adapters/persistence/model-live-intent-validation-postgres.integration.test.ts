import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  frozenFullBetaEvaluationDatasetV1,
  digestStructuredValue,
} from "@cloudmarkup/model-gateway";
import {
  intentDocumentV1Schema,
  modelIntentExtractionRequestV1Schema,
  modelIntentExtractionResponseV1Schema,
  namespacedIdentifierSchema,
  sha256Text,
} from "@cloudmarkup/schemas";
import { createModelAccountingPgTestHarness } from "./model-commercial-accounting-pg-test-helpers.js";
import { createLiveHostEvidencePgFixture } from "./model-live-runtime-host-evidence-pg-test-helpers.js";
import { PostgresModelLiveProposalCaseValidator } from "./model-live-proposal-validation.js";
import { PostgresModelLiveCommercialAccounting } from "./model-live-commercial-accounting.js";
import { identifyLiveProposalValidationReceipt } from "./model-live-proposal-validation-codec.js";
import { readProductionModelLiveObservationV2 } from "../../production-model-live-observation.js";
import { prepareProductionModelLiveProposalValidation } from "../../production-model-live-proposal-validation.js";
import { loadMigrations } from "./migrations.js";
import { sql } from "./sql.js";

const configured = process.env["CLOUDMARKUP_TEST_DATABASE_URL"]?.trim();
const integration = configured ? describe : describe.skip;
/** Actual isolated SQL/validator/accounting with explicitly synthetic provider
 * responses. No AWS call, genuine model quality, report or promotion evidence. */
integration("durable current Intent evaluation receipts", () => {
  const harness = createModelAccountingPgTestHarness(configured);
  beforeAll(() => harness.setup(), 60000);
  afterAll(() => harness.teardown(), 30000);
  async function fixture(positive = true) {
    const evaluationCase = frozenFullBetaEvaluationDatasetV1.cases.find(
      (c) => c.caseKind === "vague-conflicting-requirements",
    );
    if (!evaluationCase) throw Error("Missing Intent case");
    const request = modelIntentExtractionRequestV1Schema.parse({
      contractVersion: 1,
      operation: "intent.extract",
      requestedMode: "guided",
      source: {
        kind: "requirements-text",
        sourceId: "requirements_current_intent",
        content: evaluationCase.input.requirements,
        digest: sha256Text(evaluationCase.input.requirements),
      },
    });
    const f = await createLiveHostEvidencePgFixture(
      harness,
      "candidate",
      true,
      true,
      "standard",
      { request, caseId: evaluationCase.caseId, fullBeta: true },
    );
    if (f.gatewayResult.response.operation !== "intent.extract")
      throw Error("Wrong fixture operation");
    const intent = intentDocumentV1Schema.parse(
      JSON.parse(
        readFileSync(
          fileURLToPath(
            new URL(
              "../../../../../packages/test-fixtures/fixtures/intent-document/v1/ambiguous/unknown-requirements.json",
              import.meta.url,
            ),
          ),
          "utf8",
        ),
      ),
    );
    intent.metadata = f.gatewayResult.response.intentDocument.metadata;
    intent.assumptions = [];
    intent.decisions = [];
    intent.alternatives = [];
    intent.application.summary = request.source.content;
    const visit = (value: unknown, path: string): void => {
      if (value === null || typeof value !== "object" || Array.isArray(value))
        return;
      const row = value as Record<string, unknown>;
      if (row["state"] === "unknown") {
        const question = intent.unresolvedQuestions.find(
          (q) => q.id === row["questionId"],
        );
        if (!question) throw Error("Missing fixture question");
        question.subject = namespacedIdentifierSchema.parse(
          "requirements." +
            path.replace("operationalOverhead", "operational-overhead"),
        ) as typeof question.subject;
        question.classification = "blocking";
        question.rationale =
          "The synthetic source leaves this constraint unresolved.";
        return;
      }
      for (const [key, child] of Object.entries(row))
        visit(child, path ? path + "." + key : key);
    };
    visit(intent, "");
    if (!positive)
      intent.connectivity.ingress = {
        state: "none",
        rationale: "Synthetic invented no-ingress choice.",
      };
    f.gatewayResult.response.intentDocument = intent;
    const input = {
      invocation: f.hostInput.invocation,
      journal: f.journal,
      intent: {
        ...f.gatewayResult,
        response: modelIntentExtractionResponseV1Schema.parse(
          f.gatewayResult.response,
        ),
      },
    };
    const validator = new PostgresModelLiveProposalCaseValidator({
      plans: f.plans,
      evidence: f.issuer,
      definitionId: f.identity.definitionId,
    });
    const accounting = new PostgresModelLiveCommercialAccounting({
      database: f.database,
      scope: f.scope,
      binding: f.binding,
      plans: f.plans,
      ...f.identity,
    });
    const receipts = () =>
      harness.database.query(
        sql(
          "SELECT receipt_record FROM model_live_proposal_validation_receipts WHERE organization_id=$1",
          [f.scope.organizationId],
        ),
      );
    return { ...f, input, validator, accounting, receipts };
  }
  it("preserves all 46 historical SQL files and extends only the two receipt guards", async () => {
    const migrations = await loadMigrations(
      fileURLToPath(new URL("../../../migrations", import.meta.url)),
    );
    expect(migrations).toHaveLength(120);
    expect(migrations.reduce((n, m) => n + m.statements.length, 0)).toBe(1367);
    const prior = {
      storageContractVersion: 1,
      migrations: migrations
        .slice(0, 46)
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
    ).toBe("580062b0c0135702450f8b28ac5a718b412a027fe9ee2a1f6a42709fa66f6aec");
    expect(
      migrations.find(({ version }) => version === "0047")?.statements,
    ).toHaveLength(2);
  });
  it.each([true, false])(
    "issues actual positive=%s structural receipts and settles the exact observed usage",
    async (positive) => {
      const f = await fixture(positive);
      await f.complete();
      const receipt = await f.validator.issue(f.input);
      expect(receipt.assessment.validatorId).toBe(
        "cloudmarkup.live-intent-case-validator.v2",
      );
      expect(receipt.assessment.measurements.map((m) => m.numerator)).toEqual(
        positive ? [1, 0, 16, 3, 1, 1] : [1, 0, 15, 2, 0, 1],
      );
      expect(await f.validator.issue(f.input)).toEqual(receipt);
      expect((await f.receipts()).rowCount).toBe(1);
      expect((await f.journal.readValidatedUsage()).receipt).toEqual(receipt);
      const observation = await readProductionModelLiveObservationV2({
        journal: f.journal,
        accounting: f.accounting,
        request: f.record.request,
        admissionRequest: f.runtime.request,
        authorize: () => Promise.resolve(),
      });
      expect(observation.observation.measurements).toHaveLength(10);
      expect(observation.caseResult.contractVersion).toBe(2);
      expect(observation.caseResult.outputDigest).toBe(
        receipt.assessment.outputDigest,
      );
      expect(
        observation.caseResult.scores.filter((score) => score.applicable),
      ).toHaveLength(10);
      const coverage = observation.caseResult.scores.find(
        (score) => score.dimension === "capability-requirement-coverage",
      );
      expect(coverage).toMatchObject({
        numerator: positive ? 16 : 15,
        denominator: 16,
      });
      if (!positive)
        expect(observation.caseResult.deterministicPassed).toBe(false);
      expect(observation.observation.measurements.slice(0, 6)).toEqual(
        receipt.assessment.measurements,
      );
      expect(observation.observation.operationalUsage.totalTokens).toBe(
        Number(f.usage.inputUnits) + Number(f.usage.outputUnits),
      );
      expect(
        observation.observation.operationalUsage.creditUnits,
      ).toBeGreaterThan(0);
      expect(JSON.stringify(await f.receipts())).not.toContain(
        f.input.intent.response.intentDocument.application.summary,
      );
    },
    120000,
  );
  it("uses the production fixed host and exact current approval before and after validation", async () => {
    const f = await fixture();
    await f.complete();
    if (!f.executionInput || !f.liveRouting)
      throw Error("Missing fixture execution");
    const host = await prepareProductionModelLiveProposalValidation({
      invocation: f.hostInput.invocation,
      context: f.liveRouting.context,
      execution: f.executionInput,
      allowedApprovalPathIds: [],
    });
    expect(host).not.toBeNull();
    let calls = 0;
    const receipt = await host?.issue({
      plans: f.plans,
      evidence: f.issuer,
      journal: f.journal,
      result: f.gatewayResult,
      signal: new AbortController().signal,
      authorize: () => {
        calls++;
        return Promise.resolve();
      },
    });
    expect(calls).toBe(2);
    expect(receipt?.assessment.validatorVersion).toBe("2.2.0");
  }, 120000);
  it.each([
    "cancelled",
    "withdrawn",
    "output-replaced",
    "extra-grade",
  ] as const)(
    "refuses %s without issuing a receipt",
    async (kind) => {
      const f = await fixture();
      await f.complete();
      const controller = new AbortController();
      if (kind === "cancelled") controller.abort();
      if (kind === "withdrawn") f.removeOperators();
      if (kind === "output-replaced")
        f.input.intent.response.intentDocument.application.summary =
          "Substituted result";
      const input = { ...f.input, signal: controller.signal };
      if (kind === "extra-grade") Reflect.set(input, "passed", true);
      await expect(f.validator.issue(input)).rejects.toThrow();
      expect((await f.receipts()).rowCount).toBe(0);
    },
    120000,
  );
  it("serializes concurrent Intent validation into one immutable receipt", async () => {
    const f = await fixture();
    await f.complete();
    const receipts = await Promise.all([
      f.validator.issue(f.input),
      f.validator.issue(f.input),
    ]);
    expect(receipts[0]).toEqual(receipts[1]);
    expect((await f.receipts()).rowCount).toBe(1);
  }, 120000);
  it("denies cross-tenant validator and completed journal substitution", async () => {
    const f = await fixture(),
      other = await fixture();
    await f.complete();
    await other.complete();
    await expect(other.validator.issue(f.input)).rejects.toThrow();
    await expect(
      f.validator.issue({ ...f.input, journal: other.journal }),
    ).rejects.toThrow();
    expect((await f.receipts()).rowCount).toBe(0);
    expect((await other.receipts()).rowCount).toBe(0);
  }, 120000);
  it.each(["before-receipt", "before-settlement"] as const)(
    "rechecks tenant membership %s",
    async (kind) => {
      const f = await fixture();
      await f.complete();
      if (kind === "before-settlement") await f.validator.issue(f.input);
      await harness.database.query(
        sql(
          "UPDATE memberships SET lifecycle_status='suspended' WHERE organization_id=$1 AND principal_id=$2",
          [f.scope.organizationId, f.scope.userId],
        ),
      );
      if (kind === "before-receipt") {
        await expect(f.validator.issue(f.input)).rejects.toThrow();
        expect((await f.receipts()).rowCount).toBe(0);
      } else {
        await expect(
          readProductionModelLiveObservationV2({
            journal: f.journal,
            accounting: f.accounting,
            request: f.record.request,
            admissionRequest: f.runtime.request,
            authorize: () => Promise.resolve(),
          }),
        ).rejects.toThrow();
      }
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
  it("rejects malformed dimension sets and cannot attach a historical operations validator to an Intent invocation", async () => {
    const f = await fixture();
    await f.complete();
    const receipt = await f.validator.issue(f.input);
    for (const mutate of [
      (value: typeof receipt.assessment) => {
        value.measurements.pop();
      },
      (value: typeof receipt.assessment) => {
        const item = value.measurements.find(
          (m) => m.dimension === "capability-requirement-coverage",
        );
        if (item) item.denominator = 15;
      },
      (value: typeof receipt.assessment) => {
        Reflect.set(value, "validatorVersion", "2.1.0");
      },
    ]) {
      const value = structuredClone(receipt.assessment);
      mutate(value);
      const check = await harness.database.query(
        sql(
          "SELECT cloudmarkup_live_proposal_assessment_shape($1::jsonb) AS valid",
          [JSON.stringify(value)],
        ),
      );
      expect(check.rows[0]?.["valid"]).toBe(false);
    }
    const assessment = {
      ...receipt.assessment,
      recordKind: "model-live-proposal-case-assessment" as const,
      validatorId: "cloudmarkup.live-proposal-case-validator.v2" as const,
      validatorVersion: "2.1.0" as const,
      measurements: receipt.assessment.measurements
        .filter(
          (m) =>
            ![
              "capability-requirement-coverage",
              "unresolved-behavior-honesty",
            ].includes(m.dimension),
        )
        .map((m) =>
          m.dimension === "issue-clarity-correct-severity"
            ? { ...m, numerator: 1, denominator: 1 }
            : m,
        ),
    };
    const { assessmentDigest, ...assessmentBody } = assessment;
    expect(assessmentDigest).toBe(receipt.assessment.assessmentDigest);
    const { receiptId, receiptDigest, ...body } = receipt;
    expect(receiptId).toBeDefined();
    expect(receiptDigest).toBeDefined();
    const forged = identifyLiveProposalValidationReceipt({
      ...body,
      assessment: {
        ...assessmentBody,
        assessmentDigest: digestStructuredValue(assessmentBody),
      },
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
    ).rejects.toThrow(/exact completed active invocation/u);
    expect((await f.receipts()).rowCount).toBe(1);
  }, 120000);
});
