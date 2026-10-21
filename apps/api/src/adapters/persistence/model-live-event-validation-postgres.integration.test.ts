import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  digestStructuredValue,
  frozenFullBetaEvaluationDatasetV1,
} from "@cloudmarkup/model-gateway";
import { modelOperationProposalResponseV1Schema } from "@cloudmarkup/schemas";
import { createModelAccountingPgTestHarness } from "./model-commercial-accounting-pg-test-helpers.js";
import { createLiveHostEvidencePgFixture } from "./model-live-runtime-host-evidence-pg-test-helpers.js";
import { createProductionModelLiveCaseRequest } from "../../production-model-live-case-request.js";
import { prepareProductionModelLiveProposalValidation } from "../../production-model-live-proposal-validation.js";
import { createSyntheticEventGraph } from "../../model-live-event-test-helpers.js";
import {
  modelLiveEventCaseAssessmentV2Schema,
  assessModelLiveEventCaseV2,
} from "../../model-live-event-case-assessment.js";
import { PostgresModelLiveCommercialAccounting } from "./model-live-commercial-accounting.js";
import { readProductionModelLiveObservationV2 } from "../../production-model-live-observation.js";
import { sql } from "./sql.js";

const configured = process.env["CLOUDMARKUP_TEST_DATABASE_URL"];
const integration = configured ? describe : describe.skip;
/** Actual PostgreSQL/command/review evidence; all provider responses are synthetic.
 * Full topology alone must not turn incomplete application or policy work into quality. */
integration("actual event case assessment and durable recovery", () => {
  const harness = createModelAccountingPgTestHarness(configured);
  beforeAll(() => harness.setup(), 120000);
  afterAll(() => harness.teardown(), 30000);
  async function fixture(graph = false) {
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
      { request, caseId: evaluationCase.caseId, fullBeta: true },
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
      const { doc } = createSyntheticEventGraph();
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
      return assessModelLiveEventCaseV2({
        evaluationCase,
        proposal: {
          input: {
            createdAt: f.hostInput.plan.issuedAt,
            gatewayContext: context,
            modelRequest: request,
            solutionRevisionId: context.scope.solutionRevisionId as never,
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
  it.each([false, true])(
    "records actual graph=%s measurements without inventing passing quality",
    async (graph) => {
      const f = await fixture(graph);
      await f.complete();
      if (graph) await f.assess();
      const receipt = await f.issue();
      expect(receipt.assessment).toMatchObject({
        recordKind: "model-live-event-case-assessment",
        validatorVersion: "2.8.0",
      });
      const measurement = (dimension: string) =>
        receipt.assessment.measurements.find((m) => m.dimension === dimension);
      expect(measurement("capability-requirement-coverage")).toMatchObject({
        numerator: graph ? 9 : 0,
        denominator: 9,
      });
      expect(measurement("issue-clarity-correct-severity")?.numerator).toBe(0);
      expect(measurement("unresolved-behavior-honesty")?.numerator).toBe(1);
      expect(await f.issue()).toEqual(receipt);
      const stored = await harness.database.query(
        sql(
          "SELECT receipt_record FROM model_live_proposal_validation_receipts WHERE organization_id=$1",
          [f.scope.organizationId],
        ),
      );
      expect(stored.rowCount).toBe(1);
      expect(JSON.stringify(stored.rows)).not.toContain("Which reviewed image");
      const observation = await f.observe();
      expect(observation).toBeDefined();
      expect(await f.observe()).toEqual(observation);
    },
  );
  it("denies canceled validation before issuing any receipt", async () => {
    const f = await fixture();
    await f.complete();
    const controller = new AbortController();
    controller.abort();
    await expect(f.issue(controller.signal)).rejects.toThrow();
    const rows = await harness.database.query(
      sql(
        "SELECT receipt_id FROM model_live_proposal_validation_receipts WHERE organization_id=$1",
        [f.scope.organizationId],
      ),
    );
    expect(rows.rowCount).toBe(0);
  });
  it("rejects a coherently rehashed different case or denominator in both parsers", async () => {
    const f = await fixture();
    await f.complete();
    const receipt = await f.issue();
    for (const mutation of ["case", "coverage", "extra"] as const) {
      const candidate = structuredClone(receipt.assessment);
      if (mutation === "case") candidate.caseId = "other_case";
      if (mutation === "coverage") {
        const m = candidate.measurements.find(
          (m) => m.dimension === "capability-requirement-coverage",
        );
        if (m) m.denominator = 8;
      }
      const { assessmentDigest: ignored, ...body } = candidate;
      void ignored;
      const changed = {
        ...body,
        ...(mutation === "extra" ? { prompt: "untrusted" } : {}),
        assessmentDigest: digestStructuredValue({
          ...body,
          ...(mutation === "extra" ? { prompt: "untrusted" } : {}),
        }),
      };
      expect(
        modelLiveEventCaseAssessmentV2Schema.safeParse(changed).success,
      ).toBe(false);
      const result = await harness.database.query(
        sql(
          "SELECT cloudmarkup_live_proposal_assessment_shape($1::jsonb) AS accepted",
          [JSON.stringify(changed)],
        ),
      );
      expect(result.rows[0]?.["accepted"]).toBe(false);
    }
  });
});
