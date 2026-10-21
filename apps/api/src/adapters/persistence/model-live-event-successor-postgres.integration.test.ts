import { readStoredModelLiveObservationV2 } from "./model-live-observation-reader.js";
import {
  assessModelLiveEventCaseSuccessorV2,
  modelLiveEventCaseAssessmentSuccessorV2Schema,
} from "../../model-live-event-case-assessment-successor.js";
import { requireRegisteredEventSuccessorMigration } from "./model-live-event-successor-migration-test-helpers.js";
import {
  identifyLiveProposalValidationReceipt,
  type ModelLiveProposalValidationReceiptV2,
} from "./model-live-proposal-validation-codec.js";
import { readLiveProposalValidationReceipt } from "./model-live-proposal-validation-reader.js";
import type { SqlExecutor, SqlRow, SqlStatement } from "./sql.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  digestStructuredValue,
  fullBetaEventEvaluationPolicyV2,
  fullBetaModelEvaluationPolicyV2,
  modelLiveEventCriterionV211,
  sha256Text,
  frozenFullBetaEvaluationDatasetV1,
} from "@cloudmarkup/model-gateway";
import {
  modelOperationProposalResponseV1Schema,
  solutionRevisionIdSchema,
} from "@cloudmarkup/schemas";
import { createModelAccountingPgTestHarness } from "./model-commercial-accounting-pg-test-helpers.js";
import { createLiveHostEvidencePgFixture } from "./model-live-runtime-host-evidence-pg-test-helpers.js";
import { createProductionModelLiveCaseRequest } from "../../production-model-live-case-request.js";
import { prepareProductionModelLiveProposalValidation } from "../../production-model-live-proposal-validation.js";
import { createSyntheticEventGraph } from "../../model-live-event-test-helpers.js";
import { modelLiveEventCaseAssessmentV2Schema } from "../../model-live-event-case-assessment.js";
import { PostgresModelLiveCommercialAccounting } from "./model-live-commercial-accounting.js";
import { readProductionModelLiveObservationV2 } from "../../production-model-live-observation.js";
import { sql } from "./sql.js";

const configured = process.env["CLOUDMARKUP_TEST_DATABASE_URL"];
const integration = configured ? describe : describe.skip;
/** Actual PostgreSQL/command/review evidence; all provider responses are synthetic.
 * Full topology alone must not turn incomplete application or policy work into quality. */
integration(
  "criterion-bound event successor actual issuance and recovery",
  () => {
    const harness = createModelAccountingPgTestHarness(configured);
    beforeAll(async () => {
      await harness.setup();
      await requireRegisteredEventSuccessorMigration(harness.database);
    }, 120000);
    afterAll(() => harness.teardown(), 30000);
    async function fixture(
      graph = false,
      evaluationPolicy = fullBetaEventEvaluationPolicyV2,
      trustedRole = true,
    ) {
      const evaluationCase = frozenFullBetaEvaluationDatasetV1.cases.find(
        (c) => c.caseKind === "event-driven-image-processing",
      );
      if (!evaluationCase) throw Error("Missing frozen event case");
      const request = createProductionModelLiveCaseRequest({
        caseId: evaluationCase.caseId,
        requestedMode: "guided",
      });
      if (request.operation !== "operations.propose")
        throw Error("Wrong event request");
      const f = await createLiveHostEvidencePgFixture(
        harness,
        "candidate",
        true,
        true,
        "standard",
        {
          request,
          caseId: evaluationCase.caseId,
          fullBeta: true,
          evaluationPolicy,
        },
      );
      const response = modelOperationProposalResponseV1Schema.parse(
        f.gatewayResult.response,
      );
      if (!response.solutionProposal || !f.liveRouting || !f.executionInput)
        throw Error("Missing event fixture authority");
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
      if (graph) {
        const { doc, add, link } = createSyntheticEventGraph();
        if (trustedRole) {
          add(
            "trust",
            "aws.iam.policy-document",
            { policyName: "LambdaTrust", policyKind: "trust" },
            ["role", "aws.iam.role-owns-trust-policy"],
          );
          link("trust", "role", "aws.iam.role-owns-trust-policy");
          add(
            "TrustLambda",
            "aws.iam.policy-statement",
            {
              statementId: "TrustLambda",
              effect: "allow",
              actions: { kind: "string-list", value: ["sts:AssumeRole"] },
              principalKind: "service",
              principals: {
                kind: "string-list",
                value: ["lambda.amazonaws.com"],
              },
              resourceExpressions: { kind: "string-list", value: [] },
            },
            ["trust", "aws.iam.policy-contains-statement"],
          );
          link("TrustLambda", "trust", "aws.iam.policy-contains-statement");
        }
        const target = {
          architectureId: request.architecture.architectureId,
          documentId: request.architecture.documentId,
          revisionId: request.architecture.revision.revisionId,
        };
        const envelope = (id: string) => ({
          schemaVersion: 1,
          commandId: id,
          inverseCommandId: id + "_inverse",
          origin: "ai-accepted",
          target,
        });
        const nodes = doc.nodes.filter((n) => n.id !== "region_evaluation");
        nodes.forEach((n) => {
          n.semantic.lifecycle = { origin: "ai-accepted", ownership: "user" };
        });
        doc.edges.forEach((e) => {
          e.semantic.lifecycle = { origin: "ai-accepted", ownership: "user" };
        });
        response.batches =
          modelOperationProposalResponseV1Schema.shape.batches.parse([
            {
              kind: "graph",
              batch: {
                ...envelope("event_batch"),
                kind: "batch",
                commands: [
                  ...nodes.map((node, i) => ({
                    ...envelope("event_node_" + String(i)),
                    kind: "add-node",
                    node,
                  })),
                  ...doc.edges.map((edge, i) => ({
                    ...envelope("event_edge_" + String(i)),
                    kind: "add-edge",
                    edge,
                  })),
                ],
              },
            },
          ]);
      }
      Object.assign(f.gatewayResult.response, response);
      const host = await prepareProductionModelLiveProposalValidation({
        invocation: f.hostInput.invocation,
        context: f.liveRouting.context,
        execution: f.executionInput,
        allowedApprovalPathIds: [],
      });
      if (!host) throw Error("Missing actual event validator");
      const issue = (signal = new AbortController().signal) =>
        host.issue({
          plans: f.plans,
          evidence: f.issuer,
          journal: f.journal,
          result: f.gatewayResult,
          signal,
          authorize: () => Promise.resolve(),
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
      const context = f.liveRouting.context;
      const assess = async () => {
        const commercialWorkflow = await f.journal.withCompletedOutputMetadata(
          f.gatewayResult,
          ({ commercialWorkflow }) => Promise.resolve(commercialWorkflow),
        );
        return assessModelLiveEventCaseSuccessorV2({
          evaluationPolicy,
          evaluationCase,
          proposal: {
            input: {
              createdAt: f.hostInput.plan.issuedAt,
              gatewayContext: context,
              modelRequest: request,
              solutionRevisionId: solutionRevisionIdSchema.parse(
                context.scope.solutionRevisionId,
              ),
              validationEnvironment: "production",
            },
            result: {
              ...f.gatewayResult,
              response: modelOperationProposalResponseV1Schema.parse(
                f.gatewayResult.response,
              ),
            },
            dependencies: { allowedApprovalPathIds: new Set() },
          },
          commercialWorkflow,
          authorization: {
            authorizeStart: () =>
              Promise.resolve({
                allowed: true,
                decisionId: "synthetic_event",
                evaluatedAt: f.hostInput.plan.issuedAt,
                principalId: f.scope.userId,
                reason: null,
              }),
            authorizeReview: () =>
              Promise.reject(Error("No synthetic review application")),
          },
        });
      };
      return { ...f, issue, observe, assess };
    }

    function substitute(receipt: ModelLiveProposalValidationReceiptV2) {
      const { assessmentDigest, ...old } = receipt.assessment;
      void assessmentDigest;
      const next = old.validatorVersion === "2.11.0" ? "2.8.0" : "2.11.0";
      const assessmentBody = {
        ...old,
        validatorVersion: next,
        measurements: old.measurements.map((m) =>
          m.dimension === "issue-clarity-correct-severity" && next === "2.11.0"
            ? {
                ...m,
                evidenceDigests: [
                  modelLiveEventCriterionV211.criterionDigest,
                  sha256Text("synthetic-substituted-binding"),
                  sha256Text("synthetic-substituted-coverage"),
                  sha256Text("synthetic-substituted-validation"),
                ],
              }
            : m,
        ),
      };
      const assessment = (
        next === "2.11.0"
          ? modelLiveEventCaseAssessmentSuccessorV2Schema
          : modelLiveEventCaseAssessmentV2Schema
      ).parse({
        ...assessmentBody,
        assessmentDigest: digestStructuredValue(assessmentBody),
      });
      const {
        receiptId,
        receiptDigest,
        assessment: oldAssessment,
        ...body
      } = receipt;
      void receiptId;
      void receiptDigest;
      void oldAssessment;
      return identifyLiveProposalValidationReceipt({ ...body, assessment });
    }
    async function attemptInsert(r: ModelLiveProposalValidationReceiptV2) {
      return harness.database.query(
        sql(
          "INSERT INTO model_live_proposal_validation_receipts (organization_id,project_id,principal_id,invocation_id,receipt_id,receipt_sha256,input_evidence_id,operations_evidence_id,ownership_evidence_id,receipt_record) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb) ON CONFLICT (organization_id,project_id,principal_id,invocation_id) DO NOTHING",
          [
            r.organizationId,
            r.projectId,
            r.userId,
            r.invocationId,
            r.receiptId,
            r.receiptDigest.slice(7),
            r.inputEvidenceId,
            r.operationsEvidenceId,
            r.ownershipEvidenceId,
            JSON.stringify(r),
          ],
        ),
      );
    }
    async function journalRow(f: Awaited<ReturnType<typeof fixture>>) {
      const rows = await harness.database.query(
        sql(
          "SELECT * FROM model_live_invocations WHERE organization_id=$1 AND project_id=$2 AND principal_id=$3 AND invocation_id=$4",
          [
            f.scope.organizationId,
            f.scope.projectId,
            f.scope.userId,
            f.hostInput.invocation.descriptor.invocationId,
          ],
        ),
      );
      const row = rows.rows[0];
      if (rows.rowCount !== 1 || !row)
        throw Error("Missing actual scoped invocation");
      return row;
    }
    it.each([false, true])(
      "retains blocking unknown and actual review states for full graph=%s",
      async (graph) => {
        const f = await fixture(graph);
        await f.complete();
        const actual = await f.assess();
        expect(
          actual.preferences.assessment.disposition,
          JSON.stringify(
            actual.preferences.assessment.validationReport.findings.map(
              (finding) =>
                Object.fromEntries(
                  Object.entries(finding).filter(([key]) =>
                    ["ruleId", "code", "severity"].includes(key),
                  ),
                ),
            ),
          ),
        ).toBe("needs-user-input");
        expect(actual.preferences.workflows.map((w) => w.state)).toEqual([
          "needs-user-input",
          "needs-user-input",
        ]);
        const receipt = await f.issue();
        expect(receipt.assessment.validatorVersion).toBe("2.11.0");
        expect(
          receipt.assessment.measurements.find(
            (m) => m.dimension === "capability-requirement-coverage",
          ),
        ).toMatchObject({ numerator: graph ? 9 : 0, denominator: 9 });
        expect(
          receipt.assessment.measurements.find(
            (m) => m.dimension === "issue-clarity-correct-severity",
          ),
        ).toMatchObject({ numerator: graph ? 1 : 0, denominator: 1 });
        expect(
          receipt.assessment.measurements.find(
            (m) => m.dimension === "unresolved-behavior-honesty",
          )?.numerator,
        ).toBe(1);
        expect(await f.issue()).toEqual(receipt);
        const observation = await f.observe();
        expect(observation).toBeDefined();
        expect(await f.observe()).toEqual(observation);
        const restored = await readStoredModelLiveObservationV2({
          database: f.database,
          plans: f.plans,
          ...f.identity,
          invocationId: f.hostInput.invocation.descriptor.invocationId,
        });
        expect(restored).toMatchObject(observation);
        const stored = await harness.database.query(
          sql(
            "SELECT receipt_record FROM model_live_proposal_validation_receipts WHERE organization_id=$1",
            [f.scope.organizationId],
          ),
        );
        expect(stored.rowCount).toBe(1);
        expect(JSON.stringify(stored.rows)).not.toContain(
          "Which reviewed image",
        );
      },
    );
    it("preserves actual historical 2.8 quality failure under the original policy", async () => {
      const f = await fixture(true, fullBetaModelEvaluationPolicyV2, false);
      await f.complete();
      const receipt = await f.issue();
      expect(receipt.assessment.validatorVersion).toBe("2.8.0");
      expect(
        receipt.assessment.measurements.find(
          (m) => m.dimension === "capability-requirement-coverage",
        )?.numerator,
      ).toBe(9);
      expect(
        receipt.assessment.measurements.find(
          (m) => m.dimension === "issue-clarity-correct-severity",
        )?.numerator,
      ).toBe(0);
      expect(await f.issue()).toEqual(receipt);
      expect(await f.observe()).toBeDefined();
    });
    it.each(["successor", "historical"] as const)(
      "denies rehashed version substitution under %s plan at SQL and shared reads",
      async (selection) => {
        const f = await fixture(
          true,
          selection === "successor"
            ? fullBetaEventEvaluationPolicyV2
            : fullBetaModelEvaluationPolicyV2,
        );
        await f.complete();
        const receipt = await f.issue(),
          changed = substitute(receipt);
        await expect(attemptInsert(changed)).rejects.toMatchObject({
          code: "23514",
        });
        const substitutedRead: SqlExecutor = {
          async query<R extends SqlRow>(statement: SqlStatement) {
            const result = await harness.database.query<R>(statement);
            return statement.text.includes(
              "FROM model_live_proposal_validation_receipts",
            )
              ? {
                  ...result,
                  rows: result.rows.map((row) => ({
                    ...row,
                    receipt_id: changed.receiptId,
                    receipt_sha256: changed.receiptDigest.slice(7),
                    receipt_record: changed,
                  })),
                }
              : result;
          },
        };
        await expect(
          readLiveProposalValidationReceipt(
            substitutedRead,
            await journalRow(f),
            f.runtime.request,
          ),
        ).rejects.toThrow();
        expect(await f.issue()).toEqual(receipt);
      },
    );
    it("denies cross-tenant receipt access using the actual issued invocation", async () => {
      const f = await fixture();
      await f.complete();
      await f.issue();
      const other = await harness.tenant();
      await expect(
        readLiveProposalValidationReceipt(
          harness.database,
          await journalRow(f),
          {
            ...f.runtime.request,
            organizationId: other.scope.organizationId,
            projectId: other.scope.projectId,
            userId: other.scope.userId,
          },
        ),
      ).rejects.toThrow();
    });
    it.each(["canceled", "removed-operator", "revoked-plan"] as const)(
      "denies %s authority without issuing a successor receipt",
      async (kind) => {
        const f = await fixture();
        await f.complete();
        const controller = new AbortController();
        if (kind === "canceled") controller.abort();
        else if (kind === "removed-operator") f.removeOperators();
        else await f.plans.revoke(f.identity);
        await expect(f.issue(controller.signal)).rejects.toThrow();
        const rows = await harness.database.query(
          sql(
            "SELECT receipt_id FROM model_live_proposal_validation_receipts WHERE organization_id=$1",
            [f.scope.organizationId],
          ),
        );
        expect(rows.rowCount).toBe(0);
      },
    );
    it("keeps SQL and typed selectors in parity for partial or missing preissued policy", async () => {
      const assessment = {
        caseId: "evaluation_case_event_driven_image_processing_full_beta_v1",
        recordKind: "model-live-event-case-assessment",
        validatorId: "cloudmarkup.live-event-case-validator.v2",
        validatorVersion: "2.11.0",
      };
      for (const policy of [
        null,
        {},
        {
          ...fullBetaEventEvaluationPolicyV2,
          evaluationPolicyId: "cloudmarkup.other-policy",
        },
        {
          ...fullBetaEventEvaluationPolicyV2,
          evaluationPolicyVersion: "2.4.0",
        },
        {
          ...fullBetaEventEvaluationPolicyV2,
          evaluationPolicyDigest: sha256Text("wrong-policy"),
        },
        fullBetaModelEvaluationPolicyV2,
      ]) {
        const rows = await harness.database.query(
          sql(
            "SELECT cloudmarkup_live_event_policy_parity($1::jsonb,$2::jsonb) AS accepted",
            [JSON.stringify(policy), JSON.stringify(assessment)],
          ),
        );
        expect(rows.rows[0]?.["accepted"]).toBe(false);
      }
      const rows = await harness.database.query(
        sql(
          "SELECT cloudmarkup_live_event_policy_parity($1::jsonb,$2::jsonb) AS accepted",
          [
            JSON.stringify(fullBetaEventEvaluationPolicyV2),
            JSON.stringify(assessment),
          ],
        ),
      );
      expect(rows.rows[0]?.["accepted"]).toBe(true);
    });
    it("rejects rehashed criterion or shape substitutions in both assessment parsers", async () => {
      const f = await fixture();
      await f.complete();
      const receipt = await f.issue();
      for (const mutation of [
        "criterion",
        "evidence-count",
        "coverage",
        "case",
        "extra",
      ] as const) {
        const { assessmentDigest, ...raw } = structuredClone(
          receipt.assessment,
        );
        void assessmentDigest;
        const clarity = raw.measurements.find(
          (m) => m.dimension === "issue-clarity-correct-severity",
        );
        const coverage = raw.measurements.find(
          (m) => m.dimension === "capability-requirement-coverage",
        );
        if (!clarity || !coverage) throw Error("Missing actual measurements");
        if (mutation === "criterion")
          clarity.evidenceDigests[0] = sha256Text("wrong-criterion");
        if (mutation === "evidence-count") clarity.evidenceDigests.pop();
        if (mutation === "coverage") coverage.denominator = 8;
        const body = {
          ...raw,
          ...(mutation === "case" ? { caseId: "case_other" } : {}),
          ...(mutation === "extra"
            ? { untrustedContent: "synthetic source" }
            : {}),
        };
        const changed = {
          ...body,
          assessmentDigest: digestStructuredValue(body),
        };
        expect(
          modelLiveEventCaseAssessmentSuccessorV2Schema.safeParse(changed)
            .success,
        ).toBe(false);
        const rows = await harness.database.query(
          sql(
            "SELECT cloudmarkup_live_proposal_assessment_shape($1::jsonb) AS accepted",
            [JSON.stringify(changed)],
          ),
        );
        expect(rows.rows[0]?.["accepted"]).toBe(false);
      }
    });

    it("retains exact immutable successor receipts for historical reads after revocation without new issuance", async () => {
      const f = await fixture();
      await f.complete();
      const receipt = await f.issue();
      await f.plans.revoke(f.identity);
      expect(
        await readLiveProposalValidationReceipt(
          harness.database,
          await journalRow(f),
          f.runtime.request,
        ),
      ).toEqual(receipt);
      await expect(f.issue()).rejects.toThrow();
    });
    it("keeps security-invalid historical topology negative under the successor criterion", async () => {
      const f = await fixture(true, fullBetaEventEvaluationPolicyV2, false);
      await f.complete();
      const actual = await f.assess();
      expect(actual.preferences.assessment.validationOutcome).toBe("failed");
      expect(
        actual.preferences.assessment.validationReport.findings.some(
          (finding) =>
            finding.code === "aws.validation.iam-role-trust-policy-missing" &&
            finding.severity === "security-error",
        ),
      ).toBe(true);
      const receipt = await f.issue();
      expect(
        receipt.assessment.measurements.find(
          (m) => m.dimension === "capability-requirement-coverage",
        )?.numerator,
      ).toBe(9);
      expect(
        receipt.assessment.measurements.find(
          (m) => m.dimension === "issue-clarity-correct-severity",
        )?.numerator,
      ).toBe(0);
      expect(
        receipt.assessment.measurements.find(
          (m) => m.dimension === "security-policy-violations",
        )?.numerator,
      ).toBeGreaterThan(0);
    });
    it("keeps trust-complete historical 2.8 clarity failure without other deterministic violations", async () => {
      const f = await fixture(true, fullBetaModelEvaluationPolicyV2, true);
      await f.complete();
      const receipt = await f.issue();
      expect(receipt.assessment.validatorVersion).toBe("2.8.0");
      const measurement = (dimension: string) =>
        receipt.assessment.measurements.find((m) => m.dimension === dimension);
      expect(measurement("capability-requirement-coverage")?.numerator).toBe(9);
      expect(
        measurement("graph-workload-external-rule-violations")?.numerator,
      ).toBe(0);
      expect(measurement("security-policy-violations")?.numerator).toBe(0);
      expect(measurement("issue-clarity-correct-severity")?.numerator).toBe(0);
      expect(measurement("unresolved-behavior-honesty")?.numerator).toBe(1);
    });
  },
);
