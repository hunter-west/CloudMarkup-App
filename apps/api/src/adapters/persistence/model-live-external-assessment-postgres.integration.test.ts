import { modelLiveExternalCaseAssessmentV2Schema } from "../../model-live-external-case-assessment.js";
import { identifyLiveProposalValidationReceipt } from "./model-live-proposal-validation-codec.js";
import { readModelLiveParserInputReceipt } from "./model-live-parser-input.js";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import {
  frozenFullBetaEvaluationDatasetV1,
  digestStructuredValue,
} from "@cloudmarkup/model-gateway";
import {
  externalResourceV1Schema,
  modelOperationProposalResponseV1Schema,
} from "@cloudmarkup/schemas";
import { createModelAccountingPgTestHarness } from "./model-commercial-accounting-pg-test-helpers.js";
import { createLiveHostEvidencePgFixture } from "./model-live-runtime-host-evidence-pg-test-helpers.js";
import { createProductionModelLiveCaseRequest } from "../../production-model-live-case-request.js";
import {
  assessModelLiveExternalCaseV2_10,
  modelLiveExternalCaseAssessmentV2_10Schema,
} from "../../model-live-external-case-assessment-v2-10.js";
import { prepareProductionModelLiveProposalValidation } from "../../production-model-live-proposal-validation.js";
import { PostgresModelLiveCommercialAccounting } from "./model-live-commercial-accounting.js";
import { readProductionModelLiveObservationV2 } from "../../production-model-live-observation.js";
import { sql } from "./sql.js";
const configured = process.env["CLOUDMARKUP_TEST_DATABASE_URL"],
  executablePath = process.env["CLOUDMARKUP_TEST_COMPILER_EXECUTABLE"],
  executableSha256 = process.env["CLOUDMARKUP_TEST_COMPILER_SHA256"];
const integration =
  configured && executablePath && executableSha256 ? describe : describe.skip;
/** Actual PostgreSQL journal, parser, commands and review; synthetic model output only. Actual receipt and settlement; no provider execution. */
integration("actual existing-resource proposal assessment", () => {
  const harness = createModelAccountingPgTestHarness(configured);
  beforeAll(async () => {
    await harness.setup();
  }, 120000);
  afterAll(() => harness.teardown(), 30000);
  async function fixture(kind = "complete") {
    if (!executablePath || !executableSha256)
      throw Error("Pinned parser required");
    const evaluationCase = frozenFullBetaEvaluationDatasetV1.cases.find(
      (c) => c.caseKind === "external-existing-resource",
    );
    if (!evaluationCase) throw Error("Missing frozen case");
    const request = createProductionModelLiveCaseRequest({
      caseId: evaluationCase.caseId,
      requestedMode: "guided",
    });
    if (request.operation !== "operations.propose")
      throw Error("Missing operations request");
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
    const source =
      request.planningContext?.approvedRepositoryEvidence?.evidence[0];
    if (!source || !response.solutionProposal || !f.liveRouting)
      throw Error("Missing scoped proposal");
    const resource = externalResourceV1Schema.parse({
      id: "external_synthetic_notes",
      displayName: "Existing synthetic notes",
      capability: "external.data.table",
      resourceType: "aws.dynamodb.table",
      architectureNodeIds: [],
      provider: {
        state: "known",
        providerId: "aws.cloudmarkup",
        serviceFamily: "aws.dynamodb",
      },
      scope: {},
      addresses: [
        {
          addressId: "address_synthetic_notes",
          kind: "provider-resource-id",
          value: "synthetic-existing-notes",
        },
      ],
      lifecycle: {
        ownershipState: "existing-cloud-managed-elsewhere",
        lifecycleAuthority: "external-owner",
        behavior: {
          create: "forbidden",
          reference: "required",
          import: "review-optional",
          dataSource: "allowed",
        },
        iacTargets: [{ target: "terraform", readiness: "unresolved" }],
      },
      interfaces: [],
      dataClassifications: [],
      trustBoundary: "unknown",
      availability: { assumption: "unknown" },
      evidence: [],
      extractedCandidates: [],
      unresolvedInformation: [
        {
          unresolvedInformationId: "unknown_external_scope",
          fieldPath: "$.scope",
          summary:
            "Confirm the account, Region and intended reference mapping before use.",
          blocking: true,
        },
      ],
    });
    if (kind === "invented-account")
      resource.scope.accountReference = "123456789012";
    if (kind === "replacement-name") {
      const address = resource.addresses[0];
      if (address?.kind !== "provider-resource-id")
        throw Error("Missing source address");
      address.value = "replacement-table";
    }
    response.solutionProposal.externalResources =
      kind === "no-reference" ? [] : [resource];
    response.solutionProposal.targetReadiness.status = "blocked";
    response.proposalContext.assumptions = [];
    response.proposalContext.confidence.evidenceReferences =
      kind === "uncited"
        ? []
        : [
            {
              kind: "repository-evidence",
              referenceId: source.evidenceId,
              path: source.path,
              digest: source.fileChecksum,
              location: source.location,
            },
          ];
    Object.assign(f.gatewayResult.response, response);
    if (!f.executionInput) throw Error("Missing execution input");
    const host = await prepareProductionModelLiveProposalValidation({
      plans: f.plans,
      invocation: f.hostInput.invocation,
      context: f.liveRouting.context,
      execution: f.executionInput,
      allowedApprovalPathIds: [],
      repositoryCompiler: { executablePath, executableSha256 },
    });
    if (!host) throw Error("Missing fixed validator");

    const repositoryInput = await f.plans.withIssuedMetadata(
      f.identity,
      ({ transaction }) =>
        readModelLiveParserInputReceipt(transaction, {
          organizationId: f.scope.organizationId,
          projectId: f.scope.projectId,
          userId: f.scope.userId,
          invocationId: f.hostInput.invocation.descriptor.invocationId,
        }),
    );
    if (repositoryInput === null)
      throw Error("Missing actual parser input receipt");
    await f.complete();
    const commercialWorkflow = await f.journal.withCompletedOutputMetadata(
      f.gatewayResult,
      ({ commercialWorkflow }) => Promise.resolve(commercialWorkflow),
    );
    const context = f.liveRouting.context;
    if (!context.scope.solutionRevisionId) throw Error("Missing revision");
    const input = {
      evaluationCase,
      repositoryInput,
      compiler: { executablePath, executableSha256 },
      proposal: {
        input: {
          createdAt: f.hostInput.plan.issuedAt,
          gatewayContext: context,
          modelRequest: request,
          solutionRevisionId: context.scope.solutionRevisionId,
          validationEnvironment: "production" as const,
        },
        result: { ...f.gatewayResult, response },
        dependencies: { allowedApprovalPathIds: new Set<string>() },
      },
      commercialWorkflow,
      authorization: {
        authorizeStart: () =>
          Promise.resolve({
            allowed: true as const,
            decisionId: "synthetic_external_authority",
            evaluatedAt: f.hostInput.plan.issuedAt,
            principalId: f.scope.userId,
            reason: null,
          }),
        authorizeReview: () =>
          Promise.reject(Error("Evaluation cannot apply a review")),
      },
    };
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
    return { input, f, response, issue, observe, receipts };
  }
  it("previews the actual external reference while preserving ownership uncertainty", async () => {
    const { input, response } = await fixture();
    const before = digestStructuredValue(input.proposal);
    const { metadata, preferences } =
      await assessModelLiveExternalCaseV2_10(input);
    const measure = (d: string) =>
      metadata.measurements.find((m) => m.dimension === d)?.numerator;
    expect(measure("capability-requirement-coverage")).toBe(4);
    expect(measure("grounded-repository-evidence-rate")).toBe(1);
    expect(measure("stable-id-user-owned-file-preservation")).toBe(1);
    expect(measure("same-ui-semantics-across-assistance-preferences")).toBe(1);
    // The real unresolved scope/mapping warnings do not satisfy the frozen no-issues expectation.
    expect(measure("issue-clarity-correct-severity")).toBe(0);
    expect(
      preferences.assessment.candidateArchitecture.externalResources
        .resources[0]?.lifecycle.behavior.create,
    ).toBe("forbidden");
    expect(preferences.workflows.every((w) => w.state !== "review-ready")).toBe(
      true,
    );
    expect(digestStructuredValue(input.proposal)).toBe(before);
    expect(JSON.stringify(metadata)).not.toContain(
      response.solutionProposal?.externalResources[0]?.displayName,
    );
    expect(
      modelLiveExternalCaseAssessmentV2_10Schema.safeParse(metadata).success,
    ).toBe(true);
  }, 120000);
  it.each(["no-reference", "invented-account", "replacement-name", "uncited"])(
    "records negative quality for %s",
    async (kind) => {
      const { input } = await fixture(kind);
      const { metadata } = await assessModelLiveExternalCaseV2_10(input);
      const d =
        kind === "uncited"
          ? "grounded-repository-evidence-rate"
          : "capability-requirement-coverage";
      const m = metadata.measurements.find((m) => m.dimension === d);
      expect(m?.numerator).toBeLessThan(m?.denominator ?? 0);
      expect(
        metadata.measurements.find(
          (m) => m.dimension === "issue-clarity-correct-severity",
        )?.numerator,
      ).toBe(0);
    },
    120000,
  );
  it("rejects source substitution before assessment", async () => {
    const { input } = await fixture();
    if (!input.proposal.input.modelRequest.planningContext)
      throw Error("Missing planning");
    input.proposal.input.modelRequest.planningContext.approvedIntent.application.summary =
      "Unrelated source";
    await expect(assessModelLiveExternalCaseV2_10(input)).rejects.toThrow(
      "exact external-resource",
    );
  }, 120000);
  it("issues one immutable scoped receipt, replays it and settles negative quality", async () => {
    const f = await fixture();
    const [first, second] = await Promise.all([f.issue(), f.issue()]);
    expect(first).toEqual(second);
    expect(first.assessment.validatorVersion).toBe("2.10.0");
    expect((await f.f.journal.readValidatedUsage()).receipt).toEqual(first);
    expect((await f.receipts()).rowCount).toBe(1);
    const observed = await f.observe();
    expect(observed.observation.measurements).toHaveLength(12);
    expect(observed.caseResult.deterministicPassed).toBe(false);
    expect(observed.caseResult.outputDigest).toBe(
      first.assessment.outputDigest,
    );
    expect(JSON.stringify(await f.receipts())).not.toContain(
      "synthetic-existing-notes",
    );
  }, 120000);
  it.each([
    "cancelled",
    "withdrawn",
    "output-replaced",
    "unauthenticated",
  ] as const)(
    "denies %s without receipt",
    async (kind) => {
      const f = await fixture();
      const controller = new AbortController();
      if (kind === "cancelled") controller.abort();
      if (kind === "withdrawn") f.f.removeOperators();
      if (kind === "output-replaced")
        Reflect.set(f.f.gatewayResult.response, "unexpectedGrade", true);
      await expect(
        f.issue({
          signal: controller.signal,
          ...(kind === "unauthenticated"
            ? { authorize: () => Promise.reject(Error("Denied authority")) }
            : {}),
        }),
      ).rejects.toThrow();
      expect((await f.receipts()).rowCount).toBe(0);
    },
    120000,
  );
  it("denies cross-tenant journal substitution", async () => {
    const first = await fixture(),
      second = await fixture();
    await expect(first.issue({ journal: second.f.journal })).rejects.toThrow();
    expect((await first.receipts()).rowCount).toBe(0);
  }, 120000);
  it("rechecks tenant membership before settlement", async () => {
    const f = await fixture();
    await f.issue();
    await harness.database.query(
      sql(
        "UPDATE memberships SET lifecycle_status='suspended' WHERE organization_id=$1 AND principal_id=$2",
        [f.f.scope.organizationId, f.f.scope.userId],
      ),
    );
    await expect(f.observe()).rejects.toThrow();
    expect(
      (
        await harness.database.query(
          sql(
            "SELECT 1 FROM usage_ledger_entries WHERE organization_id=$1 AND entry_kind='settlement'",
            [f.f.scope.organizationId],
          ),
        )
      ).rowCount,
    ).toBe(0);
  }, 120000);
  it("keeps historical metadata readable but rejects contradictory measurement metadata", async () => {
    const f = await fixture();
    const receipt = await f.issue();
    const { assessmentDigest, ...historical } = structuredClone(
      receipt.assessment,
    );
    void assessmentDigest;
    historical.caseDigest = digestStructuredValue("historical-case");
    historical.sourceInputDigest = digestStructuredValue("historical-source");
    expect(
      modelLiveExternalCaseAssessmentV2_10Schema.safeParse({
        ...historical,
        assessmentDigest: digestStructuredValue(historical),
      }).success,
    ).toBe(true);
    const m = historical.measurements.find(
      (m) => m.dimension === "capability-requirement-coverage",
    );
    if (!m) throw Error("Missing coverage");
    m.denominator = 5;
    expect(
      modelLiveExternalCaseAssessmentV2_10Schema.safeParse({
        ...historical,
        assessmentDigest: digestStructuredValue(historical),
      }).success,
    ).toBe(false);
  }, 120000);
  it("denies a rehashed 2.7.0 downgrade of the issued 1.0.2 external input", async () => {
    const { issue, f } = await fixture();
    const receipt = await issue();
    const body = Object.fromEntries(
      Object.entries(receipt.assessment).filter(
        ([key]) =>
          ![
            "assessmentDigest",
            "repositoryParser",
            "repositoryInputReceipt",
          ].includes(key),
      ),
    );
    body["validatorVersion"] = "2.7.0";
    const assessment = modelLiveExternalCaseAssessmentV2Schema.parse({
      ...body,
      assessmentDigest: digestStructuredValue(body),
    });
    const { receiptId, receiptDigest, ...base } = receipt;
    void receiptId;
    void receiptDigest;
    const old = identifyLiveProposalValidationReceipt({ ...base, assessment });
    await expect(
      harness.database.query(
        sql(
          "INSERT INTO model_live_proposal_validation_receipts (organization_id,project_id,principal_id,invocation_id,receipt_id,receipt_sha256,input_evidence_id,operations_evidence_id,ownership_evidence_id,receipt_record) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)",
          [
            old.organizationId,
            old.projectId,
            old.userId,
            old.invocationId,
            old.receiptId,
            old.receiptDigest.slice(7),
            old.inputEvidenceId,
            old.operationsEvidenceId,
            old.ownershipEvidenceId,
            JSON.stringify(old),
          ],
        ),
      ),
    ).rejects.toMatchObject({ code: "23514" });
    expect((await f.journal.readValidatedUsage()).receipt).toEqual(receipt);
  }, 120000);
});
