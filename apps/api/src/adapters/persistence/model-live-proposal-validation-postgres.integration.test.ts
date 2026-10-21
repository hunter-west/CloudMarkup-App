import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createValidationDocumentPath,
  createValidationFindingCode,
  defineValidationRuleV1,
} from "@cloudmarkup/domain";
import {
  frozenModelEvaluationDatasetV1,
  type AssistantWorkflowAuthorizationV1,
} from "@cloudmarkup/model-gateway";
import {
  modelTestRequests,
  testIntent,
  testSolutionRevision,
} from "@cloudmarkup/model-gateway/testing";
import {
  modelOperationProposalRequestV1Schema,
  modelOperationProposalResponseV1Schema,
  normalizedModelUsageV1Schema,
} from "@cloudmarkup/schemas";
import { createModelAccountingPgTestHarness } from "./model-commercial-accounting-pg-test-helpers.js";
import { createLiveHostEvidencePgFixture } from "./model-live-runtime-host-evidence-pg-test-helpers.js";
import { PostgresModelLiveProposalCaseValidator } from "./model-live-proposal-validation.js";
import {
  ModelLiveProposalValidationError,
  modelLiveProposalValidationReceiptV2Schema,
} from "./model-live-proposal-validation-codec.js";
import { readLiveProposalValidationReceipt } from "./model-live-proposal-validation-reader.js";
import { PostgresModelLiveCommercialAccounting } from "./model-live-commercial-accounting.js";
import { sql } from "./sql.js";

const configured = process.env["CLOUDMARKUP_TEST_DATABASE_URL"]?.trim();
const integration = configured ? describe : describe.skip;
const kinds = [
  "placement",
  "connection",
  "policy",
  "security",
  "cost-sensitive",
  "coverage",
  "target-readiness",
] as const;
function request() {
  const base = modelTestRequests().find(
    (entry) => entry.operation === "operations.propose",
  );
  if (!base) throw Error("Missing operations test request.");
  return modelOperationProposalRequestV1Schema.parse({
    ...base,
    planningContext: {
      allowedAssistantOperationKinds: ["edit-workload"],
      allowedGraphCommandKinds: ["move-node"],
      allowedPolicyKinds: [],
      approvedIntent: testIntent,
      assistantLimits: {
        maximumApplicationContracts: 64,
        maximumOperations: 64,
        maximumSourceOwnershipDeclarations: 64,
        maximumTestScenarios: 64,
        maximumWorkloadOperations: 64,
        maximumWorkloads: 64,
      },
      limits: {
        maximumAddedNodes: 8,
        maximumEdges: 64,
        maximumExternalResources: 64,
        maximumNodes: 64,
      },
      target: "terraform",
      targetReadiness: base.architecture.nodes.map((node) => ({
        rationale: "Synthetic deterministic fixture readiness.",
        serviceType: node.semantic.serviceType,
        status: "ready",
        target: "terraform",
      })),
      validationRules: kinds.map((kind) => ({
        kind,
        ruleId: "example.live." + kind,
      })),
    },
  });
}
integration("actual V2 case validation receipts on isolated PostgreSQL", () => {
  const harness = createModelAccountingPgTestHarness(configured);
  beforeAll(async () => {
    await harness.setup();
  }, 60000);
  afterAll(() => harness.teardown(), 30000);
  async function fixture(
    caseKind = "prompt-injection-and-secrets",
    rejected = false,
  ) {
    const evaluationCase = frozenModelEvaluationDatasetV1.cases.find(
      (entry) => entry.caseKind === caseKind,
    );
    if (!evaluationCase) throw Error("Missing frozen safety case.");
    const modelRequest = request();
    const f = await createLiveHostEvidencePgFixture(
      harness,
      "candidate",
      true,
      false,
      "standard",
      { request: modelRequest, caseId: evaluationCase.caseId },
    );
    const context = f.liveRouting?.context;
    if (!context) throw Error("Missing exact scoped context.");
    const state = {
      allowed: true,
      onStart: () => Promise.resolve(),
      unavailable: false,
    };
    const authorize = async (): Promise<
      Awaited<ReturnType<AssistantWorkflowAuthorizationV1["authorizeStart"]>>
    > => {
      await state.onStart();
      return {
        allowed: state.allowed,
        decisionId: "synthetic_validator_authorization",
        evaluatedAt: f.hostInput.plan.issuedAt,
        principalId: f.scope.userId,
        reason: state.allowed ? null : "not-authorized",
      };
    };
    const dependencies = {
      allowedApprovalPathIds: new Set(["cloudmarkup.dependency-review.v1"]),
      validationRules: kinds.map((kind) =>
        defineValidationRuleV1({
          id: "example.live." + kind,
          interfaceVersion: 1,
          ruleVersion: "1.0.0",
          input: "architecture-document",
          applicability: {
            catalogs: { kind: "all" },
            environments: ["development"],
            providers: { kind: "all" },
            targets: ["compilation"],
          },
          evaluate: () => {
            if (state.unavailable)
              throw Error("Synthetic unavailable validator.");
            return rejected && kind === "security"
              ? [
                  {
                    code: createValidationFindingCode("example.live.unsafe"),
                    severity: "security-error" as const,
                    title: "Synthetic deterministic rejection",
                    beginnerExplanation:
                      "The actual synthetic rule rejects this candidate.",
                    technicalExplanation:
                      "The declared security rule reports an unsafe candidate.",
                    affected: [
                      {
                        kind: "document" as const,
                        path: createValidationDocumentPath("$.nodes"),
                      },
                    ],
                    documentationReferences: [],
                  },
                ]
              : [];
          },
        }),
      ),
    };
    const validator = new PostgresModelLiveProposalCaseValidator({
      plans: f.plans,
      evidence: f.issuer,
      definitionId: f.identity.definitionId,
      dependencies,
      authorization: { authorizeStart: authorize, authorizeReview: authorize },
    });
    const input = {
      invocation: f.hostInput.invocation,
      journal: f.journal,
      proposal: {
        input: {
          createdAt: f.hostInput.plan.issuedAt,
          gatewayContext: context,
          modelRequest,
          solutionRevisionId: testSolutionRevision.solutionRevisionId,
          validationEnvironment: "development" as const,
        },
        result: {
          ...f.gatewayResult,
          response: modelOperationProposalResponseV1Schema.parse(
            f.gatewayResult.response,
          ),
        },
      },
    };
    const accounting = new PostgresModelLiveCommercialAccounting({
      database: f.database,
      scope: f.scope,
      binding: f.binding,
      plans: f.plans,
      ...f.identity,
    });
    const terminalInput = {
      request: f.record.request,
      requestDigest: f.record.fingerprint,
      admissionRequest: f.runtime.request,
    };
    const receipts = () =>
      harness.database.query(
        sql(
          "SELECT * FROM model_live_proposal_validation_receipts WHERE organization_id=$1",
          [f.scope.organizationId],
        ),
      );
    const readReceipt = (mutate?: (row: Record<string, unknown>) => void) =>
      f.plans.withIssuedMetadata(f.identity, async ({ transaction }) => {
        const rows = await transaction.query(
          sql(
            "SELECT * FROM model_live_invocations WHERE organization_id=$1 AND project_id=$2 AND principal_id=$3 AND invocation_id=$4",
            [
              f.scope.organizationId,
              f.scope.projectId,
              f.scope.userId,
              input.invocation.descriptor.invocationId,
            ],
          ),
        );
        const actual = rows.rows[0];
        if (actual === undefined) throw Error("Missing actual scoped journal.");
        const candidate = structuredClone(actual);
        mutate?.(candidate);
        return readLiveProposalValidationReceipt(
          transaction,
          candidate,
          f.runtime.request,
        );
      });
    return {
      ...f,
      validator,
      input,
      state,
      receipts,
      evaluationCase,
      readReceipt,
      accounting,
      terminalInput,
    };
  }
  it.each([
    "prompt-injection-and-secrets",
    "direct-deployment-credential-request",
  ])(
    "issues actual measurements for %s with exact retry and no charge",
    async (kind) => {
      const f = await fixture(kind);
      await f.complete();
      const receipt = await f.validator.issue(f.input);
      expect(receipt.assessment.measurements.map((m) => m.numerator)).toEqual([
        1, 0, 0, 1,
      ]);
      expect(receipt.assessment.caseDigest).toBe(f.evaluationCase.caseDigest);
      expect(await f.validator.issue(f.input)).toEqual(receipt);
      const rows = await f.receipts();
      expect(rows.rowCount).toBe(1);
      expect(
        modelLiveProposalValidationReceiptV2Schema.parse(
          rows.rows[0]?.["receipt_record"],
        ),
      ).toEqual(receipt);
      const raw = JSON.stringify(rows.rows);
      for (const prohibited of [
        "planningContext",
        "candidateArchitecture",
        "beginnerExplanation",
        "operationBatch",
      ])
        expect(raw).not.toContain(prohibited);
      const terminals = await harness.database.query(
        sql(
          "SELECT outcome_kind FROM model_commercial_accounting_outcomes WHERE organization_id=$1",
          [f.scope.organizationId],
        ),
      );
      expect(terminals.rowCount).toBe(0);
    },
    30000,
  );
  it.each(["current", "revoked", "withdrawn"] as const)(
    "settles a recorded negative-quality evaluation once under %s execution approval",
    async (authority) => {
      const f = await fixture();
      await f.complete();
      expect(await f.accounting.recoverVerified(f.terminalInput)).toEqual({
        kind: "unavailable",
      });
      const receipt = await f.validator.issue(f.input);
      expect(receipt.assessment.measurements[2]?.numerator).toBe(0);
      const runtimeBefore = await f.persistedRuntime();
      if (authority === "revoked") await f.plans.revoke(f.identity);
      if (authority === "withdrawn") f.removeOperators();
      const invocation = await f.journal.recoverVerified(f.recoveryInput);
      expect(invocation).toMatchObject({
        kind: "verified",
        source: "validated-output",
        outputDigest: receipt.assessment.outputDigest,
        validationReceiptDigest: receipt.receiptDigest,
        result: { status: "completed", usefulOutputDelivered: true },
      });
      const results = await Promise.all([
        f.accounting.recoverVerified(f.terminalInput),
        f.accounting.recoverVerified(f.terminalInput),
      ]);
      expect(results[0]).toEqual(results[1]);
      expect(results[0]).toMatchObject({
        kind: "verified",
        authority: "canonical-model-live-terminal-v2",
        outcome: {
          kind: "settlement",
          event: { inputUnits: Number(f.usage.inputUnits) },
        },
      });
      if (results[0].kind !== "verified")
        throw Error("Missing actual canonical settlement.");
      expect(results[0].outcome.event.chargedCreditUnits).toBeGreaterThan(0);
      expect(results[0].outcome.event.chargedCreditUnits).toBeLessThanOrEqual(
        results[0].outcome.event.reservedCreditUnits,
      );
      const effects = await harness.database.query(
        sql(
          "SELECT r.status,e.entry_kind,e.charging_scenario,e.settled_credit_units,o.live_validation_receipt_id,o.live_validation_receipt_sha256 FROM credit_reservations r JOIN usage_ledger_entries e ON e.organization_id=r.organization_id AND e.reservation_id=r.reservation_id LEFT JOIN model_commercial_accounting_outcomes o ON o.organization_id=e.organization_id AND o.ledger_entry_id=e.ledger_entry_id WHERE r.organization_id=$1 ORDER BY e.entry_kind",
          [f.scope.organizationId],
        ),
      );
      expect(effects.rows.map((r) => r["entry_kind"])).toEqual([
        "reservation",
        "settlement",
      ]);
      expect(effects.rows[1]).toMatchObject({
        status: "settled",
        charging_scenario: "model-evaluation-recorded-v2",
        settled_credit_units: String(
          results[0].outcome.event.chargedCreditUnits,
        ),
        live_validation_receipt_id: receipt.receiptId,
        live_validation_receipt_sha256: receipt.receiptDigest.slice(7),
      });
      expect(await f.persistedRuntime()).toEqual(runtimeBefore);
      if (authority === "current") {
        expect(await f.journal.claim(f.claim)).toEqual({
          kind: "duplicate-result-unavailable",
        });
      } else {
        await expect(f.journal.claim(f.claim)).rejects.toThrow();
      }
    },
    30000,
  );
  it.each(["source", "detail"] as const)(
    "rolls back substituted settlement %s and permits genuine retry",
    async (kind) => {
      const f = await fixture();
      await f.complete();
      await f.validator.issue(f.input);
      if (kind === "source") f.corruptNextTerminalSource();
      else f.corruptNextTerminalDetail();
      await expect(
        f.accounting.recoverVerified(f.terminalInput),
      ).rejects.toThrow();
      expect(
        (
          await harness.database.query(
            sql(
              "SELECT 1 FROM model_commercial_accounting_outcomes WHERE organization_id=$1",
              [f.scope.organizationId],
            ),
          )
        ).rowCount,
      ).toBe(0);
      expect(
        (
          await harness.database.query(
            sql(
              "SELECT status FROM credit_reservations WHERE organization_id=$1",
              [f.scope.organizationId],
            ),
          )
        ).rows[0]?.["status"],
      ).toBe("active");
      expect(await f.accounting.recoverVerified(f.terminalInput)).toMatchObject(
        {
          kind: "verified",
          outcome: { kind: "settlement" },
        },
      );
    },
    30000,
  );
  it("denies recorded-evaluation recovery after tenant membership is suspended", async () => {
    const f = await fixture();
    await f.complete();
    await f.validator.issue(f.input);
    await harness.database.query(
      sql(
        "UPDATE memberships SET lifecycle_status='suspended' WHERE organization_id=$1 AND principal_id=$2",
        [f.scope.organizationId, f.scope.userId],
      ),
    );
    await expect(
      f.accounting.recoverVerified(f.terminalInput),
    ).rejects.toThrow();
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
  }, 30000);
  it("records genuine negative observations without turning them into a passing design", async () => {
    const f = await fixture("direct-deployment-credential-request", true);
    await f.complete();
    const receipt = await f.validator.issue(f.input);
    expect(receipt.assessment.measurements.map((m) => m.numerator)).toEqual([
      1, 1, 0, 1,
    ]);
    expect((await f.receipts()).rowCount).toBe(1);
  }, 30000);
  it.each([
    "incomplete",
    "output",
    "unavailable",
    "denied",
    "revoked",
    "withdrawn-during-validation",
    "cancelled",
    "late-cancelled",
  ] as const)(
    "cannot issue after %s",
    async (kind) => {
      const f = await fixture();
      if (kind !== "incomplete") await f.complete();
      const abort = new AbortController();
      if (kind === "output")
        f.input.proposal.result.response.provenance.modelVersion =
          "substituted";
      if (kind === "unavailable") f.state.unavailable = true;
      if (kind === "denied") f.state.allowed = false;
      if (kind === "revoked") await f.plans.revoke(f.identity);
      if (kind === "withdrawn-during-validation")
        f.state.onStart = () => {
          f.removeConfiguration();
          return Promise.resolve();
        };
      if (kind === "cancelled") abort.abort();
      if (kind === "late-cancelled")
        f.state.onStart = () => {
          abort.abort();
          return Promise.resolve();
        };
      await expect(
        f.validator.issue({ ...f.input, signal: abort.signal }),
      ).rejects.toBeInstanceOf(ModelLiveProposalValidationError);
      expect((await f.receipts()).rowCount).toBe(0);
    },
    30000,
  );
  it("reads actual issued receipts after approval revocation without granting new work", async () => {
    const f = await fixture();
    await f.complete();
    expect(await f.readReceipt()).toBeNull();
    const receipt = await f.validator.issue(f.input);
    expect(await f.readReceipt()).toEqual(receipt);
    await f.plans.revoke(f.identity);
    expect(await f.readReceipt()).toEqual(receipt);
    await expect(f.validator.issue(f.input)).rejects.toBeInstanceOf(
      ModelLiveProposalValidationError,
    );
    expect((await f.receipts()).rowCount).toBe(1);
  }, 30000);
  it.each(["scope", "binding", "output", "usage"] as const)(
    "rejects a receipt read against substituted %s journal metadata",
    async (kind) => {
      const f = await fixture();
      await f.complete();
      await f.validator.issue(f.input);
      await expect(
        f.readReceipt((row) => {
          if (kind === "scope") row["project_id"] = "project_substituted";
          if (kind === "binding") row["binding_sha256"] = "0".repeat(64);
          if (kind === "output") row["output_sha256"] = "0".repeat(64);
          if (kind === "usage") {
            const usage = normalizedModelUsageV1Schema.parse(
              row["normalized_usage"],
            );
            row["normalized_usage"] = {
              ...usage,
              inputUnits: String(BigInt(usage.inputUnits) + 1n),
            };
          }
        }),
      ).rejects.toThrow();
      expect((await f.receipts()).rowCount).toBe(1);
    },
    30000,
  );
  it("serializes concurrent actual validation into one receipt", async () => {
    const f = await fixture();
    await f.complete();
    const receipts = await Promise.all([
      f.validator.issue(f.input),
      f.validator.issue(f.input),
    ]);
    expect(receipts[0]).toEqual(receipts[1]);
    expect((await f.receipts()).rowCount).toBe(1);
  }, 30000);
  it("denies cross-tenant validator and journal substitution", async () => {
    const f = await fixture(),
      other = await fixture();
    await f.complete();
    await other.complete();
    await expect(other.validator.issue(f.input)).rejects.toBeInstanceOf(
      ModelLiveProposalValidationError,
    );
    await expect(
      f.validator.issue({ ...f.input, journal: other.journal }),
    ).rejects.toBeInstanceOf(ModelLiveProposalValidationError);
    expect((await f.receipts()).rowCount).toBe(0);
    expect((await other.receipts()).rowCount).toBe(0);
  }, 30000);
  it("rolls back the inserted receipt when approving ownership is withdrawn before commit", async () => {
    const f = await fixture();
    await f.complete();
    f.withdrawDuringValidationReceipt();
    await expect(f.validator.issue(f.input)).rejects.toBeInstanceOf(
      ModelLiveProposalValidationError,
    );
    expect((await f.receipts()).rowCount).toBe(0);
    expect((await f.rows()).rowCount).toBe(3);
  }, 30000);
  it("denies raw field injection and immutable receipt mutation", async () => {
    const f = await fixture();
    await f.complete();
    const receipt = await f.validator.issue(f.input);
    for (const expression of [
      'receipt_record || \'{"rawPrompt":"synthetic"}\'::jsonb',
      "jsonb_set(receipt_record,'{assessment,measurements,0,sourceAuthority}','\"synthetic-fake-v1\"'::jsonb)",
    ]) {
      const shape = await harness.database.query(
        sql(
          "SELECT cloudmarkup_live_proposal_receipt_shape(" +
            expression +
            ") AS valid FROM model_live_proposal_validation_receipts WHERE organization_id=$1",
          [f.scope.organizationId],
        ),
      );
      expect(shape.rows[0]?.["valid"]).toBe(false);
    }
    await expect(
      harness.database.query(
        sql(
          "UPDATE model_live_proposal_validation_receipts SET receipt_record=$2::jsonb WHERE organization_id=$1",
          [f.scope.organizationId, JSON.stringify(receipt)],
        ),
      ),
    ).rejects.toThrow();
    await expect(
      harness.database.query(
        sql(
          "DELETE FROM model_live_proposal_validation_receipts WHERE organization_id=$1",
          [f.scope.organizationId],
        ),
      ),
    ).rejects.toThrow();
  }, 30000);
});
