import { PostgresModelLiveEvaluationPlans } from "./adapters/persistence/model-live-evaluation-plans.js";
import { readStoredModelLiveObservationV2 } from "./adapters/persistence/model-live-observation-reader.js";
import { modelLiveParserInputReceiptV1Schema } from "./adapters/persistence/model-live-parser-input-codec.js";
import { PostgresModelLiveInvocationSets } from "./adapters/persistence/model-live-invocation-sets.js";
import { ModelLiveInvocationSetError } from "./adapters/persistence/model-live-invocation-set-codec.js";
import { syntheticRepositoryCase } from "./model-live-repository-test-helpers.js";
import { createProductionModelLiveCaseRequest } from "./production-model-live-case-request.js";
import { prepareProductionModelLiveProposalValidation } from "./production-model-live-proposal-validation.js";
import { productionAiPlanningCatalogAuthority } from "./production-ai-planning-request.js";
import { prepareProductionModelLiveRequestV2 } from "./production-model-live-request.js";
import { prepareProductionModelLiveInputV2 } from "./production-model-live-preparation.js";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  digestStructuredValue,
  frozenModelEvaluationDatasetV1,
  frozenFullBetaEvaluationDatasetV1,
  type BedrockCountHttpRequestV1,
} from "@cloudmarkup/model-gateway";
import {
  deterministicFakeResponseV1,
  modelTestRequests,
  testIntent,
} from "@cloudmarkup/model-gateway/testing";
import {
  modelOperationProposalRequestV1Schema,
  namespacedIdentifierSchema,
  utcTimestampSchema,
} from "@cloudmarkup/schemas";
import { awsCatalogV1 } from "@cloudmarkup/provider-aws/catalog";
import { createProductionAiCatalogGrounding } from "./production-ai-catalog.js";
import {
  createProductionModelLiveExecutionV2,
  createProductionSelectedModelLiveExecutionV2,
  type ProductionModelLiveExecutionInputV2,
} from "./production-model-live-execution.js";
import { createModelAccountingPgTestHarness } from "./adapters/persistence/model-commercial-accounting-pg-test-helpers.js";
import { createLiveHostEvidencePgSeed } from "./adapters/persistence/model-live-runtime-host-evidence-pg-test-helpers.js";
import { parseModelLiveCommercialReadSelectors } from "./adapters/persistence/model-commercial-read-host-codec.js";
import { bedrockGlobalPricingEvidenceV1Schema } from "./adapters/bedrock-global-pricing.js";
import {
  sql,
  type SqlDatabase,
  type SqlExecutor,
  type SqlStatement,
} from "./adapters/persistence/sql.js";
import { modelLiveProposalValidationReceiptV2Schema } from "./adapters/persistence/model-live-proposal-validation-codec.js";

// SQL leases and CountTokens must use real time. Only the reviewed offer clock
// is translated into its frozen fixture window; rates, SDK projection and
// maximum-cost calculation still run through the real pricing implementation.
// Exact offer expiry is covered without this mock in bedrock-global-pricing.test.
// These synthetic HTTP tests never establish current AWS offer evidence.
vi.mock("./adapters/bedrock-global-pricing.js", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("./adapters/bedrock-global-pricing.js")
    >();
  class SyntheticOfferClock
    extends actual.BedrockGlobalFullWindowCostAuthority
  {
    readonly #offset: number;
    constructor(
      input: ConstructorParameters<
        typeof actual.BedrockGlobalFullWindowCostAuthority
      >[0],
    ) {
      const clock = input.now ?? (() => new Date());
      const offset = clock().getTime() - Date.parse("2026-09-10T12:00:00.000Z");
      super({ ...input, now: () => new Date(clock().getTime() - offset) });
      this.#offset = offset;
    }
    override async resolve(
      invocation: Parameters<
        typeof actual.BedrockGlobalFullWindowCostAuthority.prototype.resolve
      >[0],
    ) {
      const result = await super.resolve(invocation);
      if (result === null) return null;
      return {
        ...result,
        validFrom: utcTimestampSchema.parse(
          new Date(Date.parse(result.validFrom) + this.#offset).toISOString(),
        ),
        validUntil: utcTimestampSchema.parse(
          new Date(Date.parse(result.validUntil) + this.#offset).toISOString(),
        ),
      };
    }
  }
  return {
    ...actual,
    BedrockGlobalFullWindowCostAuthority: SyntheticOfferClock,
  };
});

/** Real current catalog/rules with explicitly synthetic provider output. A move
 * exercises actual validation and accounting only, never live quality evidence. */
function proposalSource(unrelatedRequirements = false) {
  const base = modelTestRequests().find(
    (request) => request.operation === "operations.propose",
  );
  const evaluationCase = frozenModelEvaluationDatasetV1.cases.find(
    (entry) => entry.caseKind === "prompt-injection-and-secrets",
  );
  if (!base || !evaluationCase) throw Error("Missing synthetic source.");
  const catalog = createProductionAiCatalogGrounding();
  const region = awsCatalogV1.requireService("aws.region.boundary");
  const request = modelOperationProposalRequestV1Schema.parse({
    ...base,
    architecture: {
      ...base.architecture,
      provider: { id: "aws.cloudmarkup", region: "us-east-1" },
      catalog: catalog.catalog,
      nodes: [
        {
          id: "region_evaluation",
          semantic: {
            serviceType: region.id,
            resourceType: "aws.region.boundary",
            deploymentKey: "region_evaluation",
            lifecycle: { origin: "user", ownership: "user" },
            configuration: {
              schemaId: region.configuration.schemaId,
              schemaVersion: region.configuration.schemaVersion,
              values: { regionName: { kind: "string", value: "us-east-1" } },
            },
          },
          presentation: {
            label: "Evaluation region",
            position: { x: 0, y: 0 },
          },
        },
      ],
      edges: [],
      assumptions: [],
      outputs: [],
      variables: [],
      unresolvedRequirements: [],
      workloadBehavior: {
        ...base.architecture.workloadBehavior,
        workloads: [],
      },
      applicationContracts: {
        ...base.architecture.applicationContracts,
        contracts: [],
      },
      externalResources: {
        ...base.architecture.externalResources,
        resources: [],
      },
    },
    catalogGrounding: catalog,
    planningContext: {
      allowedAssistantOperationKinds: ["request-clarification"],
      allowedGraphCommandKinds: ["move-node"],
      allowedPolicyKinds: [],
      approvedIntent: {
        ...testIntent,
        application: {
          ...testIntent.application,
          summary: unrelatedRequirements
            ? "Build an unrelated public website."
            : evaluationCase.input.requirements,
        },
      },
      assistantLimits: {
        maximumApplicationContracts: 0,
        maximumOperations: 8,
        maximumSourceOwnershipDeclarations: 0,
        maximumTestScenarios: 0,
        maximumWorkloadOperations: 0,
        maximumWorkloads: 0,
      },
      limits: {
        maximumAddedNodes: 0,
        maximumEdges: 0,
        maximumExternalResources: 0,
        maximumNodes: 1,
      },
      target: "terraform",
      targetReadiness:
        productionAiPlanningCatalogAuthority("terraform").targetReadiness,
      validationRules:
        productionAiPlanningCatalogAuthority("terraform").validationRules,
    },
  });
  return { request, caseId: evaluationCase.caseId };
}

const configured = process.env["CLOUDMARKUP_TEST_DATABASE_URL"]?.trim();
const isRepositoryCoverage =
  process.env["npm_lifecycle_event"] === "test:coverage";
if (
  process.env["CI"] === "true" &&
  process.env["npm_lifecycle_event"] === "test:live-counted-execution" &&
  !configured
) {
  throw new Error(
    "Counted execution verification requires its test database in CI.",
  );
}
// The functional-beta workflow runs this complete suite separately without
// coverage instrumentation, which interferes with its real-time SQL leases.
// Default/full CI still includes the instrumented suite.
const separateFunctionalBetaRun =
  isRepositoryCoverage &&
  process.env["CLOUDMARKUP_TEST_MODEL_COMPOSITION_WITHOUT_COVERAGE"] === "true";
const integration =
  configured && !separateFunctionalBetaRun ? describe : describe.skip;
/** Actual SQL plan/input, fresh runtime, canonical accounting, gateway and SDK
 * serialization through a synthetic final HTTP handler. No AWS/model/quality proof. */
integration("actual live execution composition", () => {
  const harness = createModelAccountingPgTestHarness(configured);
  beforeAll(async () => {
    await harness.setup();
  }, 120000);
  afterAll(() => harness.teardown(), 30000);
  beforeEach(() => {
    vi.stubEnv("AWS_ACCESS_KEY_ID", "SYNTHETIC_COUNT_TEST");
    vi.stubEnv("AWS_SECRET_ACCESS_KEY", "synthetic-count-test-value");
    vi.stubEnv("AWS_SESSION_TOKEN", undefined);
    vi.stubEnv("AWS_PROFILE", undefined);
    vi.stubEnv("AWS_EC2_METADATA_DISABLED", "true");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });
  async function state(organizationId: string) {
    return (
      await harness.database.query(
        sql(
          `SELECT
       (SELECT count(*)::int FROM model_runtime_admissions WHERE organization_id=$1) AS admissions,
       (SELECT count(*)::int FROM model_commercial_workflows WHERE organization_id=$1) AS workflows,
       (SELECT count(*)::int FROM credit_reservations WHERE organization_id=$1) AS credits,
       (SELECT count(*)::int FROM model_platform_spend_reservations WHERE organization_id=$1) AS spending,
       (SELECT count(*)::int FROM model_live_invocations WHERE organization_id=$1) AS invocations`,
          [organizationId],
        ),
      )
    ).rows[0];
  }
  async function fixture(
    mode: "standard" | "deep" = "standard",
    planning: boolean | "current" = false,
    unrelatedRequirements = false,
    repositoryKind?:
      | Parameters<typeof syntheticRepositoryCase>[0]
      | "external-existing-resource",
    selectInvocationSet = false,
  ) {
    const currentCase = frozenFullBetaEvaluationDatasetV1.cases.find(
      (c) => c.caseKind === (repositoryKind ?? "prompt-injection-and-secrets"),
    );
    if (!currentCase) throw Error("Missing frozen source");
    const f = await createLiveHostEvidencePgSeed(
      harness,
      mode,
      planning === "current" || repositoryKind !== undefined
        ? {
            request: createProductionModelLiveCaseRequest({
              caseId: currentCase.caseId,
              requestedMode: "guided",
            }),
            caseId: currentCase.caseId,
            fullBeta: true,
          }
        : planning
          ? proposalSource(unrelatedRequirements)
          : mode === "standard"
            ? proposalSource(unrelatedRequirements)
            : undefined,
      selectInvocationSet,
    );
    const execution = f.executionInput,
      liveRouting = f.liveRouting;
    const pin =
      f.workflow.resolvedContext?.estimateResult.pricingAuthority.routePins[0];
    if (!execution || !liveRouting || !pin)
      throw Error("Missing prepared synthetic fixture");
    const { invocation, configuration } = f.hostInput;
    const policy = execution.plan.definition.policy,
      route = execution.routingDecision;
    const selectors = parseModelLiveCommercialReadSelectors({
      contractVersion: 2,
      executionClass: "live-evaluation",
      pricingVersionId: pin.pricingVersion.pricingVersionId,
      pricingVersionDigest: digestStructuredValue(pin.pricingVersion),
      normalizationPolicyVersionId:
        pin.normalizationPolicy.normalizationPolicyVersionId,
      normalizationPolicyDigest: digestStructuredValue(pin.normalizationPolicy),
      runtimePolicyId: policy.policyId,
      runtimePolicyVersion: policy.policyVersion,
      runtimePolicyDigest: policy.policyDigest,
      routeId: route.routeId,
      routeDefinitionDigest: route.routeDefinitionDigest,
      modelConfigurationReference: route.modelConfigurationReference,
    });
    const pricing = bedrockGlobalPricingEvidenceV1Schema.parse({
      contractVersion: 1,
      policyId: "cloudmarkup.bedrock-global-full-window.v1",
      accountId: "000000000000",
      environment: "beta",
      sourceRegion: "us-east-1",
      endpoint: "bedrock-runtime",
      serviceTier: "standard",
      offerUnit: "Units",
      currency: "USD",
      tokenDenominator: 1000000,
      publishedPricingReference:
        "https://platform.claude.com/docs/en/about-claude/pricing",
      pricingVersionId: selectors.pricingVersionId,
      modelId: invocation.descriptor.modelId,
      modelVersion: invocation.descriptor.modelVersion,
      inferenceProfileId: invocation.descriptor.inferenceProfileId,
      offerId:
        mode === "standard" ? "offer-ldnd26nhxx676" : "offer-ee7a27hh4hr62",
      offerTermsDigest: digestStructuredValue(
        "synthetic offer observation, not AWS evidence",
      ),
      observedAt: "2026-09-10T12:00:00.000Z",
      validFrom: "2026-09-09T00:00:00.000Z",
      validUntil: "2026-09-16T00:00:00.000Z",
      rates:
        mode === "standard"
          ? {
              inputMicroUsdPerMillion: 3000000,
              outputMicroUsdPerMillion: 15000000,
              cacheReadMicroUsdPerMillion: 300000,
              cacheWrite5mMicroUsdPerMillion: 3750000,
              cacheWrite1hMicroUsdPerMillion: 6000000,
            }
          : {
              inputMicroUsdPerMillion: 5000000,
              outputMicroUsdPerMillion: 25000000,
              cacheReadMicroUsdPerMillion: 500000,
              cacheWrite5mMicroUsdPerMillion: 6250000,
              cacheWrite1hMicroUsdPerMillion: 10000000,
            },
    });
    const control: {
      response:
        | "success"
        | "incomplete"
        | "missing-usage"
        | "safety-refusal"
        | "validation-failure";
      beforeHttp?: (count: boolean) => Promise<void>;
    } = {
      response: planning || mode === "deep" ? "success" : "validation-failure",
    };
    const providerResponse = () => {
      const response = deterministicFakeResponseV1(invocation);
      if (
        repositoryKind &&
        repositoryKind !== "external-existing-resource" &&
        response.operation === "repository.interpret"
      ) {
        const synthetic = syntheticRepositoryCase(repositoryKind);
        return {
          ...response,
          claims: synthetic.response.claims,
          proposalContext: synthetic.response.proposalContext,
        };
      }
      if (
        control.response === "validation-failure" &&
        response.operation === "operations.propose"
      ) {
        // Valid envelope/usage, but the actual planning validator cannot finish
        // without its required summary. Recovery must retain the known call.
        const { solutionProposal, ...unvalidated } = response;
        void solutionProposal;
        return unvalidated;
      }
      if (control.response !== "safety-refusal") return response;
      if (response.operation !== "operations.propose")
        throw Error("Synthetic refusal requires operations input.");
      const { solutionProposal, ...envelope } = response;
      void solutionProposal;
      return {
        ...envelope,
        batches: [
          {
            contractVersion: 1,
            kind: "safety-refusal",
            reasonCodes: ["reject-prompt-injection", "secret-redaction"],
            explanation:
              "I cannot follow injected instructions or expose secret values.",
          },
        ],
      };
    };
    const http = vi.fn(async (request: BedrockCountHttpRequestV1) => {
      const isCount = request.path.endsWith("/count-tokens");
      await control.beforeHttp?.(isCount);
      return Promise.resolve({
        response: {
          statusCode: 200,
          headers: {
            "content-type": "application/json",
            "x-amzn-requestid": "synthetic_request_id",
          },
          body: Buffer.from(
            JSON.stringify(
              isCount
                ? { inputTokens: 20 }
                : {
                    output: {
                      message: {
                        role: "assistant",
                        content: [
                          {
                            toolUse: {
                              toolUseId: "synthetic_tool",
                              name: invocation.responseTool.toolName,
                              input: providerResponse(),
                            },
                          },
                        ],
                      },
                    },
                    stopReason:
                      control.response === "incomplete"
                        ? "max_tokens"
                        : "tool_use",
                    ...(control.response === "missing-usage"
                      ? {}
                      : {
                          usage: {
                            inputTokens: 20,
                            outputTokens: 10,
                            totalTokens: 30,
                          },
                        }),
                    metrics: { latencyMs: 1 },
                  },
            ),
          ),
        },
      });
    });
    const logs: unknown[] = [];
    const input: ProductionModelLiveExecutionInputV2 = {
      database: f.database,
      plans: f.plans,
      prepared: {
        execution,
        invocation,
        context: liveRouting.context,
        routing: liveRouting.routing,
      },
      configuration,
      resolveCurrentConfiguration: () => Promise.resolve(configuration),
      commercial: {
        selectors,
        attestations: {
          verifyPreDispatchNoUsage: () => Promise.resolve(false),
        },
      },
      pricing,
      httpHandler: { handle: http },
      allowedApprovalPathIds:
        "boundary" in invocation.request
          ? invocation.request.boundary.approvalPathIds
          : [],
      telemetry: { publish: () => Promise.resolve() },
      logger: {
        write: (entry) => {
          logs.push(entry);
        },
      },
    };
    return { ...f, input, http, logs, control };
  }
  function coldReader(f: Awaited<ReturnType<typeof fixture>>) {
    const writes: string[] = [];
    function inspect(statement: SqlStatement) {
      if (
        /^\s*(?:INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE)\b/iu.test(
          statement.text,
        )
      ) {
        writes.push(statement.text);
        throw Error("Stored observation attempted a write.");
      }
    }
    const wrap = (executor: SqlExecutor): SqlExecutor => ({
      query: (statement) => {
        inspect(statement);
        return executor.query(statement);
      },
    });
    const database: SqlDatabase = {
      ...wrap(f.database),
      close: () => Promise.resolve(),
      transaction: (work) => f.database.transaction((tx) => work(wrap(tx))),
    };
    const plan = f.input.prepared.execution.plan;
    const plans = new PostgresModelLiveEvaluationPlans({
      database,
      scope: plan.definition.scope,
      principal: f.principal,
      configuration: {
        environment: plan.definition.scope.environment,
        resolveOperatorPrincipalIds: () => Promise.resolve([f.scope.userId]),
        resolveDefinition: (id) =>
          Promise.resolve(
            id === plan.definition.definitionId
              ? {
                  definition: plan.definition,
                  dataset: frozenFullBetaEvaluationDatasetV1,
                  policy: plan.definition.policy,
                }
              : null,
          ),
      },
    });
    return {
      writes,
      read: () =>
        readStoredModelLiveObservationV2({
          database,
          plans,
          definitionId: plan.definition.definitionId,
          planDigest: plan.planDigest,
          invocationId: f.input.prepared.invocation.descriptor.invocationId,
        }),
    };
  }
  async function completeState(organizationId: string) {
    const result = await harness.database.query(
      sql(
        `SELECT
      (SELECT jsonb_agg(to_jsonb(x) ORDER BY x.ledger_entry_id) FROM usage_ledger_entries x WHERE x.organization_id=$1) AS ledger,
      (SELECT jsonb_agg(to_jsonb(x) ORDER BY x.workflow_id,x.outcome_kind) FROM model_commercial_accounting_outcomes x WHERE x.organization_id=$1) AS outcomes,
      (SELECT jsonb_agg(to_jsonb(x) ORDER BY x.workflow_id) FROM model_commercial_workflows x WHERE x.organization_id=$1) AS workflows,
      (SELECT jsonb_agg(to_jsonb(x) ORDER BY x.scope_sha256) FROM model_runtime_admissions x WHERE x.organization_id=$1) AS runtime,
      (SELECT jsonb_agg(to_jsonb(x) ORDER BY x.invocation_id) FROM model_live_invocations x WHERE x.organization_id=$1) AS journal,
      (SELECT jsonb_agg(to_jsonb(x) ORDER BY x.plan_sha256) FROM model_live_invocation_sets x WHERE x.organization_id=$1) AS sets,
      (SELECT jsonb_agg(to_jsonb(x) ORDER BY x.invocation_id) FROM model_live_parser_input_receipts x WHERE x.organization_id=$1) AS parser,
      (SELECT jsonb_agg(to_jsonb(x) ORDER BY x.invocation_id) FROM model_live_proposal_validation_receipts x WHERE x.organization_id=$1) AS assessments`,
        [organizationId],
      ),
    );
    return digestStructuredValue(result.rows);
  }
  async function assertUnavailableCase(f: Awaited<ReturnType<typeof fixture>>) {
    const execution = f.input.prepared.execution;
    const before = await state(f.scope.organizationId);
    await expect(createProductionModelLiveExecutionV2(f.input)).rejects.toThrow(
      "case validator is unavailable",
    );
    await expect(
      prepareProductionModelLiveInputV2({
        database: f.database,
        plans: f.plans,
        definitionId: execution.plan.definition.definitionId,
        planDigest: execution.plan.planDigest,
        caseId: execution.admissionRequest.evaluationCaseId,
        invocation: f.input.prepared.invocation,
        configuration: f.input.configuration,
        resolveCurrentConfiguration: f.input.resolveCurrentConfiguration,
        selectors: f.input.commercial.selectors,
        httpHandler: f.input.httpHandler,
      }),
    ).rejects.toThrow("case validator is unavailable");
    expect(f.http).not.toHaveBeenCalled();
    expect(await state(f.scope.organizationId)).toEqual(before);
  }
  it("executes and replays the exact host-issued selected invocation through the real production journal", async () => {
    const f = await fixture("standard", "current", false, undefined, true);
    const set = f.selectedInvocationSet;
    if (set === undefined)
      throw Error("Actual synthetic set issuance missing.");
    const execution = f.input.prepared.execution;
    const entry = set.entries.find(
      (c) => c.caseId === execution.admissionRequest.evaluationCaseId,
    );
    if (entry === undefined)
      throw Error("Selected case missing from issued set.");
    expect(f.input.prepared.context.invocationId).toBe(entry.invocationId);
    expect(f.input.prepared.invocation.descriptor.invocationId).toBe(
      entry.invocationId,
    );
    expect(f.http).not.toHaveBeenCalled();
    expect(await state(f.scope.organizationId)).toMatchObject({
      invocations: 0,
      spending: 0,
      credits: 0,
    });
    const host = await createProductionSelectedModelLiveExecutionV2({
      ...f.input,
      invocationSet: { setId: set.setId, setDigest: set.setDigest },
    });
    expect((await host.execute()).commercial).toMatchObject({
      state: "completed",
    });
    const rows = await harness.database.query(
      sql(
        "SELECT invocation_id,binding,normalized_usage,gateway_state FROM model_live_invocations WHERE organization_id=$1 AND project_id=$2 AND principal_id=$3",
        [f.scope.organizationId, f.scope.projectId, f.scope.userId],
      ),
    );
    expect(rows.rowCount).toBe(1);
    expect(rows.rows[0]).toMatchObject({
      invocation_id: entry.invocationId,
      gateway_state: "complete",
      binding: {
        invocationId: entry.invocationId,
        evaluationCaseId: entry.caseId,
        evaluationCaseDigest: entry.caseDigest,
        liveEvaluationPlanDigest: set.planDigest,
      },
      normalized_usage: { invocationId: entry.invocationId },
    });
    const observed = await host.observe();
    expect(observed.observation.caseId).toBe(entry.caseId);
    expect(observed.observation.caseDigest).toBe(entry.caseDigest);
    expect(f.http).toHaveBeenCalledTimes(2);
    const identity = {
      definitionId: execution.plan.definition.definitionId,
      planDigest: execution.plan.planDigest,
    };
    expect(
      await new PostgresModelLiveInvocationSets(f.plans).issue(identity),
    ).toEqual(set);
    const terminalState = await state(f.scope.organizationId);
    await expect(host.execute()).resolves.toMatchObject({ replayed: true });
    expect(await state(f.scope.organizationId)).toEqual(terminalState);
    expect(f.http).toHaveBeenCalledTimes(2);
    f.removeOperators();
    await expect(host.execute()).rejects.toThrow();
    expect(f.http).toHaveBeenCalledTimes(2);
    expect(await state(f.scope.organizationId)).toEqual(terminalState);
  }, 120000);
  it.each(["unissued", "other-invocation"] as const)(
    "denies selected V2 %s membership before any provider or financial work",
    async (kind) => {
      const f = await fixture("standard", "current");
      const plan = f.input.prepared.execution.plan;
      const reference = {
        definitionId: plan.definition.definitionId,
        planDigest: plan.planDigest,
      };
      const set =
        kind === "other-invocation"
          ? await new PostgresModelLiveInvocationSets(f.plans).issue(reference)
          : {
              setId: "live_set_" + "a".repeat(32),
              setDigest: digestStructuredValue("unissued"),
            };
      const before = await state(f.scope.organizationId);
      const previousErrors = f.errors.length;
      await expect(
        createProductionSelectedModelLiveExecutionV2({
          ...f.input,
          invocationSet: { setId: set.setId, setDigest: set.setDigest },
        }),
      ).rejects.toMatchObject({
        code: "model-live-evaluation.authority-unavailable",
      });
      // The existing plan boundary sanitizes the inner membership failure.
      expect(f.errors.slice(previousErrors)).toContainEqual(
        expect.any(ModelLiveInvocationSetError),
      );
      expect(f.http).not.toHaveBeenCalled();
      expect(await state(f.scope.organizationId)).toEqual(before);
    },
  );
  it.each(["standard", "deep"] as const)(
    "counts the implemented %s source or denies its unavailable validator without writes",
    async (mode) => {
      const f = await fixture(mode);
      if (mode === "deep") {
        await assertUnavailableCase(f);
        return;
      }
      const execution = f.input.prepared.execution;
      const before = await state(f.scope.organizationId);
      const prepared = await prepareProductionModelLiveInputV2({
        database: f.input.database,
        plans: f.input.plans,
        definitionId: execution.plan.definition.definitionId,
        planDigest: execution.plan.planDigest,
        caseId: execution.admissionRequest.evaluationCaseId,
        invocation: f.input.prepared.invocation,
        configuration: f.input.configuration,
        resolveCurrentConfiguration: f.input.resolveCurrentConfiguration,
        selectors: f.input.commercial.selectors,
        httpHandler: f.input.httpHandler,
      });
      expect(prepared.count.inputTokens).toBe(20);
      expect(prepared.inputEvidence).toEqual(execution.inputEvidence);
      expect(prepared.plannedCall.maximumUsage.inputUnits).toBe(20);
      expect(prepared.plannedCall.maximumUsage.outputUnits).toBe(
        f.input.prepared.invocation.maximumOutputTokens,
      );
      expect(prepared.minimumCreditUnits).toBeLessThanOrEqual(
        prepared.maximumCreditUnits,
      );
      expect(prepared.maximumCreditUnits).toBeLessThanOrEqual(
        Number(prepared.snapshot.balance.availableCreditUnits),
      );
      expect(prepared.maximumEstimatedProviderCostMicros).toBeGreaterThan(0);
      expect(f.http).toHaveBeenCalledTimes(1);
      expect(
        f.http.mock.calls.every(([request]) =>
          request.path.endsWith("/count-tokens"),
        ),
      ).toBe(true);
      expect(await state(f.scope.organizationId)).toEqual(before);
    },
    120000,
  );
  // This complete path enforces a real 30-second counted authorization.
  // check:full runs it first without coverage instrumentation, which can
  // otherwise exhaust that unchanged freshness window before dispatch.
  it.skipIf(isRepositoryCoverage).each(["standard", "deep"] as const)(
    "builds implemented %s counted execution or denies its unavailable validator",
    async (mode) => {
      const f = await fixture(mode, mode === "standard");
      if (mode === "deep") {
        await assertUnavailableCase(f);
        return;
      }
      f.control.response = "safety-refusal";
      const original = f.input.prepared.execution;
      const before = await state(f.scope.organizationId);
      const request = await prepareProductionModelLiveRequestV2({
        database: f.database,
        plans: f.plans,
        definitionId: original.plan.definition.definitionId,
        planDigest: original.plan.planDigest,
        caseId: original.admissionRequest.evaluationCaseId,
        invocation: f.input.prepared.invocation,
        context: f.input.prepared.context,
        configuration: f.input.configuration,
        resolveCurrentConfiguration: f.input.resolveCurrentConfiguration,
        selectors: f.input.commercial.selectors,
        httpHandler: f.input.httpHandler,
        ids: {
          eventIdPrefix: original.commercialRequest.eventIdPrefix,
          idempotencyKey: original.commercialRequest.idempotencyKey,
          multiCallWorkflowId: original.commercialRequest.multiCallWorkflowId,
          requestId: original.commercialRequest.requestId,
          reservationId: original.commercialRequest.reservationId,
          admissionDecisionId: "counted_admission",
          concurrencyLeaseId: "counted_concurrency",
        },
      });
      const execution = request.prepared.execution;
      expect(execution.admissionDecision.outcome).toBe("allowed");
      expect(
        execution.admissionRequest.commercialEstimate.maximumCreditUnits,
      ).toBe(request.counted.maximumCreditUnits);
      expect(execution.commercialRequest.plannedCalls).toEqual([
        request.counted.plannedCall,
      ]);
      expect(execution.commercialRequest.requestedMaximumInputUnits).toBe(20);
      expect(execution.commercialRequest.expiresAt).toBe(
        request.counted.expiresAt,
      );
      expect(request.prepared.context.entitlement.decisionId).toBe(
        request.counted.snapshot.entitlement.entitlementSnapshotId,
      );
      expect(f.http).toHaveBeenCalledTimes(2);
      expect(
        f.http.mock.calls.every(([http]) =>
          http.path.endsWith("/count-tokens"),
        ),
      ).toBe(true);
      expect(await state(f.scope.organizationId)).toEqual(before);
      const host = await createProductionModelLiveExecutionV2({
        ...f.input,
        prepared: request.prepared,
      });
      expect(await state(f.scope.organizationId)).toEqual(before);
      const executed = await host.execute();
      expect(executed.admission.outcome).toBe("allowed");
      const observation = await host.observe();
      expect(
        observation.observation.measurements
          .slice(0, 4)
          .map((entry) => entry.numerator),
      ).toEqual([1, 0, 1, 1]); // Zero security-policy violations is the passing value.
      const calls = f.http.mock.calls.length;
      await host.execute();
      expect(f.http).toHaveBeenCalledTimes(calls);
    },
    120000,
  );
  it("denies counted preparation when approval is withdrawn during the real count boundary", async () => {
    const f = await fixture();
    const execution = f.input.prepared.execution;
    const before = await state(f.scope.organizationId);
    f.control.beforeHttp = async () => {
      await f.plans.revoke({
        definitionId: execution.plan.definition.definitionId,
        planDigest: execution.plan.planDigest,
      });
    };
    await expect(
      prepareProductionModelLiveInputV2({
        database: f.input.database,
        plans: f.input.plans,
        definitionId: execution.plan.definition.definitionId,
        planDigest: execution.plan.planDigest,
        caseId: execution.admissionRequest.evaluationCaseId,
        invocation: f.input.prepared.invocation,
        configuration: f.input.configuration,
        resolveCurrentConfiguration: f.input.resolveCurrentConfiguration,
        selectors: f.input.commercial.selectors,
        httpHandler: f.input.httpHandler,
      }),
    ).rejects.toThrow();
    expect(f.http).toHaveBeenCalledTimes(1);
    expect(await state(f.scope.organizationId)).toEqual(before);
  }, 120000);
  it.each(["counted-preparation", "execution"] as const)(
    "rejects unrelated but consistently hashed source before %s sends HTTP",
    async (boundary) => {
      const f = await fixture("standard", true, true);
      const execution = f.input.prepared.execution;
      const before = await state(f.scope.organizationId);
      const attempt =
        boundary === "execution"
          ? createProductionModelLiveExecutionV2(f.input)
          : prepareProductionModelLiveInputV2({
              database: f.database,
              plans: f.plans,
              definitionId: execution.plan.definition.definitionId,
              planDigest: execution.plan.planDigest,
              caseId: execution.admissionRequest.evaluationCaseId,
              invocation: f.input.prepared.invocation,
              configuration: f.input.configuration,
              resolveCurrentConfiguration: f.input.resolveCurrentConfiguration,
              selectors: f.input.commercial.selectors,
              httpHandler: f.input.httpHandler,
            });
      await expect(attempt).rejects.toThrow(
        "exact frozen evaluation request source",
      );
      expect(f.http).not.toHaveBeenCalled();
      expect(await state(f.scope.organizationId)).toEqual(before);
    },
    120000,
  );
  it.each([
    "omitted-rule",
    "reclassified-rule",
    "forged-readiness",
    "uninstalled-policy",
  ] as const)(
    "rejects %s in production planning metadata before any inference",
    async (mutation) => {
      const f = await fixture("standard", true);
      const prepared = structuredClone(f.input.prepared);
      const request = prepared.invocation.request;
      if (
        request.operation !== "operations.propose" ||
        !request.planningContext
      )
        throw Error("Missing planning context");
      const context = request.planningContext;
      if (mutation === "omitted-rule") context.validationRules.pop();
      if (mutation === "reclassified-rule") {
        const rule = context.validationRules[0];
        if (!rule) throw Error("Missing rule");
        rule.kind = "placement";
      }
      if (mutation === "forged-readiness") context.targetReadiness.pop();
      if (mutation === "uninstalled-policy")
        context.allowedPolicyKinds.push(
          namespacedIdentifierSchema.parse("aws.unreviewed.policy"),
        );
      await expect(
        prepareProductionModelLiveProposalValidation({
          ...prepared,
          allowedApprovalPathIds: [],
        }),
      ).rejects.toThrow("Current production proposal validation");
      expect(f.http).not.toHaveBeenCalled();
    },
  );

  const parserPath = process.env["CLOUDMARKUP_TEST_COMPILER_EXECUTABLE"],
    parserSha = process.env["CLOUDMARKUP_TEST_COMPILER_SHA256"];
  it.each(
    ["missing", "substituted"].flatMap((kind) =>
      ["ambiguous-source-code-inference", "external-existing-resource"].map(
        (caseKind) => ({ kind, caseKind }),
      ),
    ),
  )(
    "denies a $kind parser for $caseKind before HTTP or reservations",
    async ({ kind, caseKind }) => {
      const f = await fixture(
        "standard",
        "current",
        false,
        caseKind as
          "ambiguous-source-code-inference" | "external-existing-resource",
      );
      const before = await state(f.scope.organizationId);
      await expect(
        createProductionModelLiveExecutionV2({
          ...f.input,
          ...(kind === "substituted"
            ? {
                repositoryCompiler: {
                  executablePath: parserPath ?? "missing-pinned-compiler",
                  executableSha256: "0".repeat(64),
                },
              }
            : {}),
        }),
      ).rejects.toThrow();
      expect(f.http).not.toHaveBeenCalled();
      expect(await state(f.scope.organizationId)).toEqual(before);
    },
    120000,
  );
  it
    .skipIf(!parserPath || !parserSha)
    .each([
      "deterministic-repository-import",
      "ambiguous-source-code-inference",
      "designed-observed-mismatch",
      "external-existing-resource",
    ] as const)(
    "executes selected %s through the parser, settlement and cold stored reader",
    async (caseKind) => {
      if (!parserPath || !parserSha) throw Error("Real pinned parser required");
      const f = await fixture("standard", "current", false, caseKind, true);
      const set = f.selectedInvocationSet;
      if (!set) throw Error("Actual issued set required");
      const entry = set.entries.find(
        (item) =>
          item.caseId ===
          f.input.prepared.execution.admissionRequest.evaluationCaseId,
      );
      if (!entry) throw Error("Exact selected case required");
      expect(f.input.prepared.invocation.descriptor.invocationId).toBe(
        entry.invocationId,
      );
      const host = await createProductionSelectedModelLiveExecutionV2({
        invocationSet: { setId: set.setId, setDigest: set.setDigest },
        ...f.input,
        repositoryCompiler: {
          executablePath: parserPath,
          executableSha256: parserSha,
        },
      });
      expect(f.http).not.toHaveBeenCalled();
      const parserInput = await f.database.query(
        sql(
          "SELECT receipt_record FROM model_live_parser_input_receipts WHERE organization_id=$1 AND invocation_id=$2",
          [
            f.scope.organizationId,
            f.input.prepared.invocation.descriptor.invocationId,
          ],
        ),
      );
      expect(parserInput.rowCount).toBe(1);
      expect(parserInput.rows[0]?.["receipt_record"]).toMatchObject({
        repositoryParser: { importerVersion: "1.0.2" },
      });
      const parsedInput = modelLiveParserInputReceiptV1Schema.parse(
        parserInput.rows[0]?.["receipt_record"],
      );
      expect(parsedInput).toMatchObject({
        invocationId: entry.invocationId,
        caseId: entry.caseId,
        caseDigest: entry.caseDigest,
        sourceInputDigest: entry.sourceInputDigest,
        planDigest: set.planDigest,
      });
      const read = coldReader(f);
      const preparedState = await completeState(f.scope.organizationId);
      await expect(read.read()).rejects.toMatchObject({
        code: "model-live.stored-observation-unavailable",
      });
      expect(await completeState(f.scope.organizationId)).toBe(preparedState);
      expect((await host.execute()).commercial?.state).toBe("completed");
      expect(f.http).toHaveBeenCalledTimes(2);
      const observation = await host.observe();
      const validated = await f.database.query(
        sql(
          "SELECT receipt_record FROM model_live_proposal_validation_receipts WHERE organization_id=$1 AND invocation_id=$2",
          [f.scope.organizationId, entry.invocationId],
        ),
      );
      const validation = modelLiveProposalValidationReceiptV2Schema.parse(
        validated.rows[0]?.["receipt_record"],
      );
      expect(validation.assessment).toMatchObject({
        validatorVersion:
          caseKind === "external-existing-resource" ? "2.10.0" : "2.9.0",
        repositoryInputReceipt: {
          receiptId: parsedInput.receiptId,
          receiptDigest: parsedInput.receiptDigest,
        },
      });
      const beforeRead = await completeState(f.scope.organizationId);
      const restored = await read.read();
      expect(restored).toMatchObject(observation);
      expect(restored.invocationId).toBe(entry.invocationId);
      expect(await read.read()).toEqual(restored);
      expect(read.writes).toEqual([]);
      expect(await completeState(f.scope.organizationId)).toBe(beforeRead);
      expect(f.http).toHaveBeenCalledTimes(2);
      expect(observation.observation.measurements).toHaveLength(
        [
          "deterministic-repository-import",
          "external-existing-resource",
        ].includes(caseKind)
          ? 12
          : 11,
      );
      expect(
        observation.observation.measurements.find(
          (m) => m.dimension === "issue-clarity-correct-severity",
        )?.numerator,
      ).toBe(
        [
          "deterministic-repository-import",
          "external-existing-resource",
        ].includes(caseKind)
          ? 0
          : 1,
      );
      if (
        [
          "deterministic-repository-import",
          "external-existing-resource",
        ].includes(caseKind)
      )
        expect(observation.caseResult.deterministicPassed).toBe(false);
      expect(JSON.stringify(f.logs)).not.toContain(
        "Which deployment owns this source",
      );
    },
    120000,
  );

  it("counts and settles the current production source through the actual host", async () => {
    const f = await fixture("standard", "current");
    f.control.response = "safety-refusal";
    const execution = f.input.prepared.execution;
    const before = await state(f.scope.organizationId);
    const counted = await prepareProductionModelLiveInputV2({
      database: f.database,
      plans: f.plans,
      definitionId: execution.plan.definition.definitionId,
      planDigest: execution.plan.planDigest,
      caseId: execution.admissionRequest.evaluationCaseId,
      invocation: f.input.prepared.invocation,
      configuration: f.input.configuration,
      resolveCurrentConfiguration: f.input.resolveCurrentConfiguration,
      selectors: f.input.commercial.selectors,
      httpHandler: f.input.httpHandler,
    });
    expect(counted.inputEvidence).toEqual(execution.inputEvidence);
    expect(await state(f.scope.organizationId)).toEqual(before);
    const host = await createProductionModelLiveExecutionV2(f.input);
    expect((await host.execute()).commercial?.state).toBe("completed");
    expect(f.http).toHaveBeenCalledTimes(3);
    const observation = await host.observe();
    expect(observation.caseResult.caseId).toBe(
      execution.admissionRequest.evaluationCaseId,
    );
    expect(
      observation.observation.measurements.find(
        (m) => m.dimension === "issue-clarity-correct-severity",
      )?.numerator,
    ).toBe(1);
    // Settlement is independent of quality passing; measured latency and cost
    // still use the unchanged policy and may fail their historical thresholds.
  }, 120000);

  it("settles an actual fixed-rule assessment without activating a model", async () => {
    const f = await fixture("standard", true);
    expect(
      f.input.prepared.execution.admissionRequest.requested.promptBytes,
    ).toBeLessThanOrEqual(
      f.input.prepared.execution.plan.definition.policy.limits
        .maximumPromptBytes,
    );
    const host = await createProductionModelLiveExecutionV2(f.input);
    const result = await host.execute();
    expect(result.commercial).toMatchObject({ state: "completed" });
    expect(f.http).toHaveBeenCalledTimes(2);
    const receipts = await harness.database.query(
      sql(
        "SELECT receipt_record FROM model_live_proposal_validation_receipts WHERE organization_id=$1",
        [f.scope.organizationId],
      ),
    );
    expect(receipts.rowCount).toBe(1);
    const receipt = receipts.rows[0]?.["receipt_record"];
    const record = modelLiveProposalValidationReceiptV2Schema.parse(
      typeof receipt === "string" ? (JSON.parse(receipt) as unknown) : receipt,
    );
    const observed = await host.observe();
    expect(observed.validationReceiptDigest).toBe(record.receiptDigest);
    expect(
      observed.observation.measurements.find(
        (entry) => entry.dimension === "issue-clarity-correct-severity",
      )?.numerator,
    ).toBe(0);
    expect(observed.observation.operationalUsage).toMatchObject({
      commercialSourceAuthority: "canonical-commercial-v1",
      usageSourceAuthority: "canonical-model-usage-v1",
      inputTokens: 20,
      outputTokens: 10,
      totalTokens: 30,
    });
    if (result.commercial === null)
      throw Error("Missing canonical completion.");
    expect(observed.observation.operationalUsage.creditUnits).toBe(
      result.commercial.completedCreditUnits,
    );
    expect(
      observed.observation.operationalUsage.estimatedMicroUsd,
    ).toBeGreaterThan(0);
    expect(observed.observationDigest).toBe(
      digestStructuredValue(observed.observation),
    );
    expect(await host.observe()).toEqual(observed);
    expect(
      record.assessment.measurements.find(
        (measurement) => measurement.dimension === "structured-schema-validity",
      )?.numerator,
    ).toBe(1);
    expect(
      await harness.database.query(
        sql("SELECT status FROM credit_reservations WHERE organization_id=$1", [
          f.scope.organizationId,
        ]),
      ),
    ).toMatchObject({ rows: [{ status: "settled" }] });
    await expect(host.execute()).resolves.toMatchObject({
      replayed: true,
      commercial: result.commercial,
    });
    expect(f.http).toHaveBeenCalledTimes(2);
    expect((await state(f.scope.organizationId))?.["credits"]).toBe(1);
  }, 120000);
  it("records an actual typed refusal through the guarded host and fixed rules", async () => {
    const f = await fixture("standard", true);
    f.control.response = "safety-refusal";
    const host = await createProductionModelLiveExecutionV2(f.input);
    expect((await host.execute()).commercial).toMatchObject({
      state: "completed",
    });
    const rows = await harness.database.query(
      sql(
        "SELECT receipt_record FROM model_live_proposal_validation_receipts WHERE organization_id=$1",
        [f.scope.organizationId],
      ),
    );
    expect(rows.rowCount).toBe(1);
    const raw = rows.rows[0]?.["receipt_record"];
    const receipt = modelLiveProposalValidationReceiptV2Schema.parse(
      typeof raw === "string" ? (JSON.parse(raw) as unknown) : raw,
    );
    const collected = await host.observe();
    expect(collected.validationReceiptDigest).toBe(receipt.receiptDigest);
    expect(collected.observation.measurements).toHaveLength(8);
    expect(collected.observation.measurements.slice(0, 4)).toEqual(
      receipt.assessment.measurements,
    );
    expect(JSON.stringify(collected)).not.toContain("I cannot follow");
    expect(receipt.assessment.validatorVersion).toBe("2.1.0");
    expect(
      receipt.assessment.measurements.map(
        (measurement) => measurement.numerator,
      ),
    ).toEqual([1, 0, 1, 1]);
    expect(JSON.stringify(rows.rows)).not.toContain("I cannot follow");
    expect(f.http).toHaveBeenCalledTimes(2);
    await expect(host.execute()).resolves.toMatchObject({ replayed: true });
    expect(f.http).toHaveBeenCalledTimes(2);
    f.removeOperators();
    await expect(host.observe()).rejects.toThrow();
    expect(f.http).toHaveBeenCalledTimes(2);
  }, 120000);
  it("does not issue a quality receipt after approval is withdrawn at completed HTTP", async () => {
    const f = await fixture("standard", true);
    expect(
      f.input.prepared.execution.admissionRequest.requested.promptBytes,
    ).toBeLessThanOrEqual(
      f.input.prepared.execution.plan.definition.policy.limits
        .maximumPromptBytes,
    );
    f.control.beforeHttp = (count) => {
      if (!count) f.removeOperators();
      return Promise.resolve();
    };
    const host = await createProductionModelLiveExecutionV2(f.input);
    await expect(host.execute()).resolves.toMatchObject({
      commercial: { state: "compensated", completedCreditUnits: 0 },
      output: null,
    });
    expect(f.http).toHaveBeenCalledTimes(2);
    expect(
      (
        await harness.database.query(
          sql(
            "SELECT * FROM model_live_proposal_validation_receipts WHERE organization_id=$1",
            [f.scope.organizationId],
          ),
        )
      ).rowCount,
    ).toBe(0);
  }, 120000);
  it.each(["standard", "deep"] as const)(
    "requires the implemented %s validator before constructing without admission or HTTP",
    async (mode) => {
      const f = await fixture(mode);
      if (mode === "deep") {
        await assertUnavailableCase(f);
        return;
      }
      const initial = {
        admissions: 0,
        workflows: 0,
        credits: 0,
        spending: 0,
        invocations: 0,
      };
      expect(await state(f.scope.organizationId)).toEqual(initial);
      const host = await createProductionModelLiveExecutionV2(f.input);
      expect(host).toHaveProperty("execute");
      await expect(host.observe()).rejects.toThrow();
      expect(await state(f.scope.organizationId)).toEqual(initial);
      expect(f.http).not.toHaveBeenCalled();
    },
  );
  it.each(["standard", "deep"] as const)(
    "admits implemented %s guarded execution and denies an unavailable family before HTTP",
    async (mode) => {
      const f = await fixture(mode);
      if (mode === "deep") {
        await assertUnavailableCase(f);
        return;
      }
      const host = await createProductionModelLiveExecutionV2(f.input);
      await expect(host.execute()).rejects.toMatchObject({
        safeCode: "runtime-control-unavailable",
      });
      expect(
        f.http.mock.calls.map(([request]) => request.path.split("/").at(-1)),
        JSON.stringify(f.logs),
      ).toEqual(["count-tokens", "converse"]);
      expect(await state(f.scope.organizationId)).toEqual({
        admissions: 1,
        workflows: 1,
        credits: 1,
        spending: 1,
        invocations: 1,
      });
      const row = (
        await harness.database.query(
          sql(
            "SELECT gateway_state FROM model_live_invocations WHERE organization_id=$1",
            [f.scope.organizationId],
          ),
        )
      ).rows[0];
      expect(row?.["gateway_state"], JSON.stringify(f.logs)).toBe("complete");
    },
    120000,
  );

  it.each(["organizationId", "projectId", "userId", "jobId"] as const)(
    "rejects another %s before any admission or HTTP",
    async (field) => {
      const f = await fixture();
      const supplied = structuredClone(f.input.prepared);
      supplied.invocation.descriptor.scope[field] = "different_scope";
      await expect(
        createProductionModelLiveExecutionV2({
          ...f.input,
          prepared: supplied,
        }),
      ).rejects.toThrow();
      expect(await state(f.scope.organizationId)).toEqual({
        admissions: 0,
        workflows: 0,
        credits: 0,
        spending: 0,
        invocations: 0,
      });
      expect(f.http).not.toHaveBeenCalled();
    },
  );
  it("rejects an unissued plan digest and a replaced input receipt", async () => {
    const f = await fixture();
    for (const kind of ["plan", "receipt"] as const) {
      const prepared = structuredClone(f.input.prepared);
      if (kind === "plan")
        prepared.execution.plan.planDigest = digestStructuredValue("unissued");
      else
        prepared.execution.inputEvidence.evidenceDigest =
          digestStructuredValue("replaced");
      await expect(
        createProductionModelLiveExecutionV2({ ...f.input, prepared }),
      ).rejects.toThrow();
    }
    expect(await state(f.scope.organizationId)).toEqual({
      admissions: 0,
      workflows: 0,
      credits: 0,
      spending: 0,
      invocations: 0,
    });
    expect(f.http).not.toHaveBeenCalled();
  });
  it("rechecks actual operator withdrawal after construction before admission", async () => {
    const f = await fixture();
    const host = await createProductionModelLiveExecutionV2(f.input);
    f.removeOperators();
    await expect(host.execute()).rejects.toThrow();
    expect(await state(f.scope.organizationId)).toEqual({
      admissions: 0,
      workflows: 0,
      credits: 0,
      spending: 0,
      invocations: 0,
    });
    expect(f.http).not.toHaveBeenCalled();
  });
  it("retains the original candidate configuration at fresh execution", async () => {
    const f = await fixture();
    let current: typeof f.input.configuration | null = f.input.configuration;
    const host = await createProductionModelLiveExecutionV2({
      ...f.input,
      resolveCurrentConfiguration: () => Promise.resolve(current),
    });
    current = null;
    await expect(host.execute()).rejects.toThrow();
    expect(await state(f.scope.organizationId)).toEqual({
      admissions: 0,
      workflows: 0,
      credits: 0,
      spending: 0,
      invocations: 0,
    });
    expect(f.http).not.toHaveBeenCalled();
  });
  it("checks actual withdrawal after CountTokens and makes no inference handoff", async () => {
    const f = await fixture();
    f.control.beforeHttp = (count) => {
      if (count) f.removeOperators();
      return Promise.resolve();
    };
    const host = await createProductionModelLiveExecutionV2(f.input);
    await expect(host.execute()).rejects.toThrow();
    expect(
      f.http.mock.calls.map(([request]) => request.path.split("/").at(-1)),
    ).toEqual(["count-tokens"]);
    expect((await state(f.scope.organizationId))?.["spending"]).toBe(0);
  }, 120000);
  it("rechecks actual approval after platform reservation before signed inference HTTP", async () => {
    const f = await fixture();
    let withdrew = false;
    const host = await createProductionModelLiveExecutionV2({
      ...f.input,
      resolveCurrentConfiguration: async () => {
        if ((await state(f.scope.organizationId))?.["spending"] === 1) {
          withdrew = true;
          f.removeOperators();
        }
        return f.input.configuration;
      },
    });
    await expect(host.execute()).rejects.toThrow();
    expect(withdrew).toBe(true);
    expect(
      f.http.mock.calls.map(([request]) => request.path.split("/").at(-1)),
    ).toEqual(["count-tokens"]);
    expect((await state(f.scope.organizationId))?.["spending"]).toBe(1);
  }, 120000);
  it("uses actual known provider failure usage for canonical release", async () => {
    const f = await fixture();
    f.control.response = "incomplete";
    const host = await createProductionModelLiveExecutionV2(f.input);
    const result = await host.execute();
    expect(result.commercial).toMatchObject({
      state: "compensated",
      completedCreditUnits: 0,
      compensationStatus: "applied",
    });
    expect(result.output).toBeNull();
    expect(f.http).toHaveBeenCalledTimes(2);
    expect((await state(f.scope.organizationId))?.["spending"]).toBe(1);
    const status = (
      await harness.database.query(
        sql("SELECT status FROM credit_reservations WHERE organization_id=$1", [
          f.scope.organizationId,
        ]),
      )
    ).rows[0];
    expect(status?.["status"]).toBe("released");
  }, 120000);
  it("keeps missing usage pending and does not infer a zero-cost result", async () => {
    const f = await fixture();
    f.control.response = "missing-usage";
    const host = await createProductionModelLiveExecutionV2(f.input);
    await expect(host.execute()).rejects.toThrow();
    expect(f.http).toHaveBeenCalledTimes(2);
    const row = (
      await harness.database.query(
        sql(
          "SELECT normalized_usage,gateway_state FROM model_live_invocations WHERE organization_id=$1",
          [f.scope.organizationId],
        ),
      )
    ).rows[0];
    expect(row).toEqual({ normalized_usage: null, gateway_state: "failed" });
    const status = (
      await harness.database.query(
        sql("SELECT status FROM credit_reservations WHERE organization_id=$1", [
          f.scope.organizationId,
        ]),
      )
    ).rows[0];
    expect(status?.["status"]).toBe("active");
  }, 120000);
  it("keeps completed generation pending without replaying a provider invocation", async () => {
    const f = await fixture();
    const host = await createProductionModelLiveExecutionV2(f.input);
    await expect(host.execute()).rejects.toThrow();
    const first = await state(f.scope.organizationId);
    expect(f.http).toHaveBeenCalledTimes(2);
    await expect(host.execute()).rejects.toThrow();
    expect(f.http).toHaveBeenCalledTimes(2);
    expect(await state(f.scope.organizationId)).toEqual(first);
    const row = (
      await harness.database.query(
        sql(
          "SELECT gateway_state,output_sha256,normalized_usage IS NOT NULL AS known_usage FROM model_live_invocations WHERE organization_id=$1",
          [f.scope.organizationId],
        ),
      )
    ).rows[0];
    expect(row).toMatchObject({ gateway_state: "complete", known_usage: true });
    expect(row?.["output_sha256"]).toMatch(/^[0-9a-f]{64}$/);
  }, 120000);
  it("cancels before admission and does not let prepared-input mutation replace issued authority", async () => {
    const f = await fixture();
    const controller = new AbortController();
    const host = await createProductionModelLiveExecutionV2(f.input);
    f.input.prepared.execution.admissionDecision.decisionDigest =
      digestStructuredValue("mutated");
    controller.abort();
    await expect(host.execute(controller.signal)).rejects.toThrow();
    expect(f.http).not.toHaveBeenCalled();
    expect(await state(f.scope.organizationId)).toEqual({
      admissions: 0,
      workflows: 0,
      credits: 0,
      spending: 0,
      invocations: 0,
    });
    await expect(host.execute()).rejects.toMatchObject({
      safeCode: "runtime-control-unavailable",
    });
    expect(f.http).toHaveBeenCalledTimes(2);
    expect((await state(f.scope.organizationId))?.["admissions"]).toBe(1);
  }, 120000);
  it("rejects concurrent execution through the same request-local host", async () => {
    const f = await fixture();
    const host = await createProductionModelLiveExecutionV2(f.input);
    const first = expect(host.execute()).rejects.toMatchObject({
      safeCode: "runtime-control-unavailable",
    });
    await expect(host.execute()).rejects.toMatchObject({
      code: "model-live.execution-unavailable",
    });
    await first;
    expect(f.http).toHaveBeenCalledTimes(2);
    expect((await state(f.scope.organizationId))?.["credits"]).toBe(1);
  }, 120000);
});
