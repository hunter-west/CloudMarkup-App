import { describe, expect, it } from "vitest";

import {
  configurationKeySchema,
  modelCapabilityRegistryV1Schema,
  modelDependencyRequestV1Schema,
  modelRouteRegistryV1Schema,
  modelRoutingFeatureAuthorityV1,
  modelRoutingRequestV1Schema,
  namespacedIdentifierSchema,
  operationIdSchema,
  reconciliationProposalV1Schema,
  semanticVersionSchema,
  solutionRevisionIdSchema,
  type ModelGatewayRequestV1,
  type ModelRouteRegistryV1,
  type ModelRoutingDecisionV1,
  type ModelRoutingRequestV1,
} from "@cloudmarkup/schemas";

import {
  bedrockModelCapabilityRegistryV1,
  bedrockModelRouteRegistryV1,
  createModelRoutingDecisionEvaluatorV1,
} from "./bedrock-routing.js";
import {
  DeterministicFakeModelAdapter,
  DeterministicScenarioFakeModelAdapter,
  InMemoryModelInvocationStore,
  ScriptedFakeModelAdapter,
  CollectingModelUsageRecorder,
  CollectingSafeModelLogger,
  deterministicFakeResponseV1,
  deterministicFakeProviderProfileV1,
  deterministicFakeRoutingV1,
  supportedFakeOperations,
} from "./fakes.js";
import {
  ModelGatewayError,
  ProviderNeutralModelGateway,
  assertNoModelTools,
} from "./gateway.js";
import {
  ModelProviderInvocationError,
  type ModelProviderInvocationV1,
  type ModelProviderCapabilityProfileV1,
  type ModelProviderResultV1,
  type ModelProviderUsageV1,
  type ModelRoutingDecisionEvaluatorV1,
} from "./ports.js";
import { InMemoryRestrictedInvalidSolutionProposalStoreV1 } from "./solution-planner.js";
import {
  modelRoutingConfigurationV1Schema,
  type ModelRoutingConfigurationV1,
} from "./routing.js";
import {
  digestStructuredValue,
  sha256Text,
  validateModelRequestAuthority,
} from "./security.js";
import { getModelResponseToolV1 } from "./tools.js";
import {
  modelTestContext,
  modelTestRequests,
  modelTestRoutingRequest,
  testCandidateBoundary,
} from "./test-helpers.js";

function successfulProviderResult(
  invocation: ModelProviderInvocationV1,
): ModelProviderResultV1 {
  return {
    content: responseToolContent(
      invocation,
      deterministicFakeResponseV1(invocation),
    ),
    usage: {
      cacheReadUnits: "0",
      cacheWriteUnits: "0",
      inputUnits: "20",
      outputUnits: "10",
      providerRequestId: `provider_${invocation.descriptor.invocationId}`,
      thinkingUnits: "3",
    },
  };
}

function responseToolContent(
  invocation: ModelProviderInvocationV1,
  input: unknown,
): ModelProviderResultV1["content"] {
  return {
    input,
    kind: "tool-use",
    toolName: invocation.responseTool.toolName,
  };
}

function createHarness(input?: {
  readonly adapter?:
    | DeterministicFakeModelAdapter
    | DeterministicScenarioFakeModelAdapter
    | ScriptedFakeModelAdapter;
  readonly allowedApprovalPathIds?: readonly string[];
  readonly invocationStore?: InMemoryModelInvocationStore;
  readonly maximumOutputBytes?: number;
  readonly maximumAttempts?: number;
  readonly routeRegistry?: ModelRouteRegistryV1;
  readonly routing?: ModelRoutingConfigurationV1;
  readonly routingDecisionEvaluator?: ModelRoutingDecisionEvaluatorV1;
}) {
  const adapter = input?.adapter ?? new DeterministicFakeModelAdapter();
  const invocationStore =
    input?.invocationStore ?? new InMemoryModelInvocationStore();
  const invalidProposalStore =
    new InMemoryRestrictedInvalidSolutionProposalStoreV1();
  const logger = new CollectingSafeModelLogger();
  const usageRecorder = new CollectingModelUsageRecorder();
  const gateway = new ProviderNeutralModelGateway({
    adapters: [adapter],
    allowedApprovalPathIds: input?.allowedApprovalPathIds ?? [
      "cloudmarkup.dependency-review.v1",
    ],
    invocationStore,
    invalidProposalStore,
    logger,
    ...(input?.maximumOutputBytes === undefined
      ? {}
      : { maximumOutputBytes: input.maximumOutputBytes }),
    ...(input?.maximumAttempts === undefined
      ? {}
      : { maximumAttempts: input.maximumAttempts }),
    ...(input?.routeRegistry === undefined
      ? {}
      : { routeRegistry: input.routeRegistry }),
    ...(input?.routingDecisionEvaluator === undefined
      ? {}
      : { routingDecisionEvaluator: input.routingDecisionEvaluator }),
    routing: input?.routing ?? deterministicFakeRoutingV1,
    usageRecorder,
  });
  return {
    adapter,
    gateway,
    invalidProposalStore,
    invocationStore,
    logger,
    usageRecorder,
  };
}

function requestFor<TOperation extends ModelGatewayRequestV1["operation"]>(
  operation: TOperation,
): Extract<ModelGatewayRequestV1, { operation: TOperation }> {
  const request = modelTestRequests().find(
    (candidate) => candidate.operation === operation,
  );
  if (request === undefined) throw new Error(`Missing request ${operation}.`);
  return request as Extract<ModelGatewayRequestV1, { operation: TOperation }>;
}

async function expectGatewayCode(
  promise: Promise<unknown>,
  code: string,
): Promise<void> {
  await expect(promise).rejects.toMatchObject({ code });
}

async function expectPreProviderGatewayCode(
  request: ModelGatewayRequestV1,
  code: string,
  invocationId: string,
): Promise<void> {
  const harness = createHarness();
  await expectGatewayCode(
    harness.gateway.invoke(request, modelTestContext(invocationId)),
    code,
  );
  expect(harness.adapter.invocations).toHaveLength(0);
  expect(harness.usageRecorder.records).toHaveLength(0);
}

describe("ProviderNeutralModelGateway", () => {
  it("never dispatches or meters a completed memory-only invocation again", async () => {
    class UnavailableResultStore extends InMemoryModelInvocationStore {
      override claim() {
        return Promise.resolve({
          kind: "duplicate-result-unavailable" as const,
        });
      }
    }
    const harness = createHarness({
      invocationStore: new UnavailableResultStore(),
    });
    await expectGatewayCode(
      harness.gateway.invoke(
        requestFor("intent.extract"),
        modelTestContext("invocation_memory_complete"),
      ),
      "model-gateway.result-not-replayable",
    );
    expect(harness.adapter.invocations).toHaveLength(0);
    expect(harness.usageRecorder.records).toHaveLength(0);
    expect(harness.logger.events).toHaveLength(0);
  });
  it("runs deterministic no-network fakes for every versioned operation", async () => {
    const harness = createHarness();
    const requests = modelTestRequests();

    for (const [index, request] of requests.entries()) {
      const result = await harness.gateway.invoke(
        request,
        modelTestContext(`invocation_all_${String(index)}`),
      );
      expect(result.response.operation).toBe(request.operation);
      expect(result.descriptor.toolAuthority).toBe("none");
      expect(result.usage.result).toBe("succeeded");
    }

    expect(requests.map((request) => request.operation)).toEqual(
      supportedFakeOperations(),
    );
    expect(harness.adapter.invocations).toHaveLength(requests.length);
    expect(harness.usageRecorder.records).toHaveLength(requests.length);
  });

  it("rejects routing class drift for every versioned feature", () => {
    const requests = modelTestRequests();
    expect(requests).toHaveLength(15);
    expect(new Set(requests.map((request) => request.operation))).toEqual(
      new Set(Object.keys(modelRoutingFeatureAuthorityV1)),
    );

    for (const [index, request] of requests.entries()) {
      const routingRequest = modelTestRoutingRequest(
        request,
        modelTestContext(`invocation_feature_authority_${String(index)}`),
      );
      const authority = modelRoutingFeatureAuthorityV1[request.operation];
      expect(routingRequest).toMatchObject(authority);

      const operationClassResult = modelRoutingRequestV1Schema.safeParse({
        ...routingRequest,
        operationClass:
          authority.operationClass === "extraction" ? "planning" : "extraction",
      });
      expect(operationClassResult.success).toBe(false);
      if (!operationClassResult.success) {
        expect(operationClassResult.error.issues).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ path: ["operationClass"] }),
          ]),
        );
      }

      const outputClassResult = modelRoutingRequestV1Schema.safeParse({
        ...routingRequest,
        expectedOutputClass:
          authority.expectedOutputClass === "small-explanation"
            ? "structured-proposal"
            : "small-explanation",
      });
      expect(outputClassResult.success).toBe(false);
      if (!outputClassResult.success) {
        expect(outputClassResult.error.issues).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ path: ["expectedOutputClass"] }),
          ]),
        );
      }
    }
  });

  it("rejects issue sources that mismatch or lack trusted revision scope", async () => {
    const operations = [
      "issue.explain",
      "deterministic-fix.explain",
      "fix.propose",
    ] as const;

    for (const [index, operation] of operations.entries()) {
      const mismatch = createHarness();
      const mismatchContext = modelTestContext(
        `invocation_issue_scope_mismatch_${String(index)}`,
      );
      await expectGatewayCode(
        mismatch.gateway.invoke(requestFor(operation), {
          ...mismatchContext,
          scope: {
            ...mismatchContext.scope,
            solutionRevisionId: solutionRevisionIdSchema.parse(
              "solution_revision_other",
            ),
          },
        }),
        "model-gateway.scope-authority-mismatch",
      );
      expect(mismatch.adapter.invocations).toHaveLength(0);
      expect(mismatch.usageRecorder.records).toHaveLength(0);

      const missing = createHarness();
      const missingContext = modelTestContext(
        `invocation_issue_scope_missing_${String(index)}`,
      );
      const {
        solutionRevisionId: omittedSolutionRevisionId,
        ...scopeWithoutSolutionRevision
      } = missingContext.scope;
      expect(omittedSolutionRevisionId).toBeDefined();
      await expectGatewayCode(
        missing.gateway.invoke(requestFor(operation), {
          ...missingContext,
          scope: scopeWithoutSolutionRevision,
        }),
        "model-gateway.scope-authority-mismatch",
      );
      expect(missing.adapter.invocations).toHaveLength(0);
      expect(missing.usageRecorder.records).toHaveLength(0);
    }
  });

  it("rejects forged request-only source authority before provider invocation", async () => {
    const generation = structuredClone(
      requestFor("application-source.generate"),
    );
    generation.solutionRevision.architecture.contentHash = sha256Text(
      "forged generation architecture binding",
    );
    await expectPreProviderGatewayCode(
      generation,
      "model-gateway.ungrounded-generation-input",
      "invocation_forged_generation_source",
    );
    const generationRecordHashes = structuredClone(
      requestFor("application-source.generate"),
    );
    generationRecordHashes.solutionRevision.contracts.recordHashes = [
      sha256Text("forged contract record hash"),
    ];
    await expectPreProviderGatewayCode(
      generationRecordHashes,
      "model-gateway.ungrounded-generation-input",
      "invocation_forged_generation_record_hashes",
    );

    const workload = structuredClone(requestFor("workload.propose"));
    if (workload.solutionRevision === undefined) {
      throw new Error("Missing optional workload Solution Revision fixture.");
    }
    workload.solutionRevision.architecture.contentHash = sha256Text(
      "forged workload architecture binding",
    );
    await expectPreProviderGatewayCode(
      workload,
      "model-gateway.ungrounded-workload-revision",
      "invocation_forged_workload_source",
    );

    const repairDigest = structuredClone(requestFor("candidate.repair"));
    repairDigest.failedOutputDigest = sha256Text("forged failed output");
    await expectPreProviderGatewayCode(
      repairDigest,
      "model-gateway.repair-input-digest-mismatch",
      "invocation_forged_repair_digest",
    );

    const repairPatch = structuredClone(requestFor("candidate.repair"));
    const failedCandidate = repairPatch.failedCandidates[0];
    if (failedCandidate?.kind !== "file") {
      throw new Error("Missing failed file candidate fixture.");
    }
    repairPatch.failedCandidates = [
      {
        baseDigest: failedCandidate.contentDigest,
        candidateId: failedCandidate.candidateId,
        kind: "patch",
        ownership: failedCandidate.ownership,
        path: failedCandidate.path,
        proposedResultDigest: sha256Text("forged patch result"),
        unifiedDiff:
          "--- a/application/other.ts\n+++ b/application/other.ts\n@@ -1 +1 @@\n-old\n+new\n",
      },
    ];
    repairPatch.failedOutputDigest = digestStructuredValue(
      repairPatch.failedCandidates,
    );
    await expectPreProviderGatewayCode(
      repairPatch,
      "model-gateway.patch-path-mismatch",
      "invocation_forged_repair_patch",
    );
  });

  it("rejects stale issue and source content digests before provider invocation", async () => {
    const issue = structuredClone(requestFor("issue.explain"));
    issue.issue.summary = "A forged issue summary with the prior digest.";
    await expectPreProviderGatewayCode(
      issue,
      "model-gateway.issue-record-digest-mismatch",
      "invocation_stale_issue_digest",
    );

    const intent = structuredClone(requestFor("intent.extract"));
    intent.source.content = "Mutated requirements with the prior digest.";
    await expectPreProviderGatewayCode(
      intent,
      "model-gateway.source-digest-mismatch",
      "invocation_stale_intent_digest",
    );

    const summary = structuredClone(requestFor("summary.technical"));
    summary.source.content = "Mutated summary source with the prior digest.";
    await expectPreProviderGatewayCode(
      summary,
      "model-gateway.source-digest-mismatch",
      "invocation_stale_summary_digest",
    );
  });

  it("returns byte-identical structured fake output for the same invocation", async () => {
    const request = requestFor("summary.technical");
    const first = createHarness();
    const second = createHarness();
    const context = modelTestContext("invocation_deterministic");

    const [left, right] = await Promise.all([
      first.gateway.invoke(request, context),
      second.gateway.invoke(request, context),
    ]);

    expect(JSON.stringify(left.response)).toBe(JSON.stringify(right.response));
    expect({
      ...left.usage,
      completedAt: undefined,
      durationMilliseconds: undefined,
      startedAt: undefined,
    }).toEqual({
      ...right.usage,
      completedAt: undefined,
      durationMilliseconds: undefined,
      startedAt: undefined,
    });
  });

  it("retries deterministic throttling and denies cache units without an exact key", async () => {
    const throttled = new DeterministicScenarioFakeModelAdapter([
      "throttled",
      "success",
    ]);
    const retried = createHarness({ adapter: throttled });
    const result = await retried.gateway.invoke(
      requestFor("summary.technical"),
      modelTestContext("invocation_scenario_throttle"),
    );
    expect(result.usage.cacheReadUnits).toBe("0");
    expect(throttled.invocations).toHaveLength(2);

    const cacheHit = createHarness({
      adapter: new DeterministicScenarioFakeModelAdapter(["cache-hit"]),
    });
    await expectGatewayCode(
      cacheHit.gateway.invoke(
        requestFor("summary.technical"),
        modelTestContext("invocation_scenario_cache_hit"),
      ),
      "model-gateway.invalid-usage",
    );
    const cacheMiss = createHarness({
      adapter: new DeterministicScenarioFakeModelAdapter(["cache-miss"]),
    });
    await expectGatewayCode(
      cacheMiss.gateway.invoke(
        requestFor("summary.technical"),
        modelTestContext("invocation_scenario_cache_miss"),
      ),
      "model-gateway.invalid-usage",
    );
  });

  it("requires a fully recomputed production route and rejects replay or drift", async () => {
    const capabilityRegistry = modelCapabilityRegistryV1Schema.parse({
      ...bedrockModelCapabilityRegistryV1,
      capabilities: bedrockModelCapabilityRegistryV1.capabilities.map(
        (capability) => ({
          ...capability,
          evaluation: {
            ...capability.evaluation,
            passed: true,
            scoreBasisPoints: 9_500,
          },
          lifecycleState: "active",
        }),
      ),
    });
    const routeRegistry = modelRouteRegistryV1Schema.parse({
      ...bedrockModelRouteRegistryV1,
      capabilityRegistryDigest: digestStructuredValue(capabilityRegistry),
    });
    const routing = modelRoutingConfigurationV1Schema.parse({
      allowFallback: false,
      configurationId: routeRegistry.routeRegistryId,
      configurationVersion: routeRegistry.routeRegistryVersion,
      routes: [
        {
          candidates: [
            {
              inferenceProfileId: "configured.profile.standard.required",
              modelId: "configured.model.standard.required",
              priority: 1,
              providerId: "cloudmarkup.amazon-bedrock",
            },
          ],
          role: "low-cost-extraction-help",
        },
        {
          candidates: [
            {
              inferenceProfileId: "configured.profile.standard.required",
              modelId: "configured.model.standard.required",
              priority: 1,
              providerId: "cloudmarkup.amazon-bedrock",
            },
          ],
          role: "standard-planning-generation",
        },
        {
          candidates: [
            {
              inferenceProfileId: "configured.profile.deep.required",
              modelId: "configured.model.deep.required",
              priority: 1,
              providerId: "cloudmarkup.amazon-bedrock",
            },
          ],
          role: "deep-architecture-custom-generation",
        },
        {
          candidates: [
            {
              inferenceProfileId: "configured.profile.deep.required",
              modelId: "configured.model.deep.required",
              priority: 1,
              providerId: "cloudmarkup.amazon-bedrock",
            },
          ],
          role: "repair-escalation",
        },
      ],
    });
    const routingConfigurationDigest = digestStructuredValue(routing);
    const routingDecisionEvaluator = createModelRoutingDecisionEvaluatorV1({
      capabilityRegistry,
      routeRegistry,
    });
    const request = requestFor("summary.technical");
    const profileContext = modelTestContext("invocation_route_profile");
    const profileRoutingRequest = modelRoutingRequestV1Schema.parse({
      ...modelTestRoutingRequest(request, profileContext),
      creditAuthorization: {
        ...modelTestRoutingRequest(request, profileContext).creditAuthorization,
        decisionId: profileContext.budget.decisionId,
      },
    });
    const trustedCapability = routingDecisionEvaluator.evaluate({
      request: profileRoutingRequest,
      routingConfigurationDigest,
    }).capability;
    const deepTrustedCapability = routingDecisionEvaluator.evaluate({
      request: modelTestRoutingRequest(request, profileContext, {
        selectedPreference: "deep-design",
      }),
      routingConfigurationDigest,
    }).capability;
    const profile: ModelProviderCapabilityProfileV1 = {
      capabilities: [trustedCapability, deepTrustedCapability],
      enabled: true,
      profileVersion: "1.0.0",
      providerFamily: "amazon-bedrock",
      providerId: "cloudmarkup.amazon-bedrock",
    };
    const routedContext = (
      invocationId: string,
      decisionOverrides: Partial<ModelRoutingDecisionV1> = {},
    ) => {
      const base = modelTestContext(invocationId);
      const initialRoutingRequest = modelTestRoutingRequest(request, base);
      const routingRequest = modelRoutingRequestV1Schema.parse({
        ...initialRoutingRequest,
        creditAuthorization: {
          ...initialRoutingRequest.creditAuthorization,
          decisionId: base.budget.decisionId,
        },
      });
      const routingDecision = {
        ...routingDecisionEvaluator.evaluate({
          request: routingRequest,
          routingConfigurationDigest,
        }).decision,
        ...decisionOverrides,
      };
      return { ...base, routingDecision, routingRequest };
    };

    const missingAdapter = new ScriptedFakeModelAdapter(
      [successfulProviderResult],
      profile,
    );
    const missing = createHarness({
      adapter: missingAdapter,
      routeRegistry,
      routing,
      routingDecisionEvaluator,
    });
    await expectGatewayCode(
      missing.gateway.invoke(
        request,
        modelTestContext("invocation_route_required"),
      ),
      "model-gateway.routing-decision-required",
    );
    expect(missingAdapter.invocations).toHaveLength(0);
    expect(missing.usageRecorder.records).toHaveLength(0);

    const boundAdapter = new ScriptedFakeModelAdapter(
      [
        successfulProviderResult,
        successfulProviderResult,
        successfulProviderResult,
      ],
      profile,
    );
    const bound = createHarness({
      adapter: boundAdapter,
      routeRegistry,
      routing,
      routingDecisionEvaluator,
    });
    const context = routedContext("invocation_route_bound");
    const result = await bound.gateway.invoke(request, context);
    expect(result.descriptor.routing).toEqual(result.usage.routing);
    expect(result.descriptor.routing).toMatchObject({
      capabilityRegistryDigest: digestStructuredValue(capabilityRegistry),
      effort: "medium",
      evaluationPolicyId: "cloudmarkup.model-evaluation.production.v1",
      modelFamily: "configured.model-family.standard",
      routeId: "standard-design",
      routeRegistryDigest: digestStructuredValue(routeRegistry),
      routingConfigurationDigest,
    });
    expect(boundAdapter.invocations[0]).toMatchObject({
      maximumOutputTokens: 8_192,
      promptCacheKey: {
        input: {
          cacheScope: "organization",
          organizationId: context.scope.organizationId,
          providerId: "cloudmarkup.amazon-bedrock",
        },
      },
      promptCachePolicy: {
        enabled: true,
        maximumCheckpoints: 4,
        minimumCheckpointTokens: 4_096,
      },
      timeoutMilliseconds: 120_000,
    });
    const cacheKey = boundAdapter.invocations[0]?.promptCacheKey;
    expect(cacheKey?.digest).toBe(
      cacheKey === undefined
        ? undefined
        : digestStructuredValue(cacheKey.input),
    );
    expect(result.usage).toMatchObject({
      attemptNumber: 1,
      idempotencyKeyDigest: context.idempotencyKeyDigest,
      inputDigest: context.routingRequest.inputDigest,
    });
    const replay = await bound.gateway.invoke(request, context);
    expect(replay).toEqual(result);
    expect(boundAdapter.invocations).toHaveLength(1);

    const cacheAdapter = new DeterministicScenarioFakeModelAdapter(
      ["cache-hit", "cache-miss"],
      profile,
    );
    const cacheHarness = createHarness({
      adapter: cacheAdapter,
      routeRegistry,
      routing,
      routingDecisionEvaluator,
    });
    const cacheHit = await cacheHarness.gateway.invoke(
      request,
      routedContext("invocation_route_cache_hit"),
    );
    const cacheMiss = await cacheHarness.gateway.invoke(
      request,
      routedContext("invocation_route_cache_miss"),
    );
    expect(cacheHit.usage).toMatchObject({
      cacheReadUnits: "80",
      cacheWriteUnits: "0",
    });
    expect(cacheMiss.usage).toMatchObject({
      cacheReadUnits: "0",
      cacheWriteUnits: "80",
    });
    expect(cacheAdapter.invocations).toHaveLength(2);
    expect(
      cacheAdapter.invocations.every(
        (invocation) => invocation.promptCacheKey !== undefined,
      ),
    ).toBe(true);

    const belowThresholdBase = modelTestContext(
      "invocation_route_cache_below_threshold",
    );
    const belowThresholdRoutingRequest = modelTestRoutingRequest(
      request,
      belowThresholdBase,
      { estimatedContextTokens: 4_095 },
    );
    const belowThresholdRoutingDecision = routingDecisionEvaluator.evaluate({
      request: belowThresholdRoutingRequest,
      routingConfigurationDigest,
    }).decision;
    expect(belowThresholdRoutingDecision.promptCachePolicy.enabled).toBe(false);
    const unauthorizedCacheAdapter = new DeterministicScenarioFakeModelAdapter(
      ["cache-hit"],
      profile,
    );
    const unauthorizedCache = createHarness({
      adapter: unauthorizedCacheAdapter,
      routeRegistry,
      routing,
      routingDecisionEvaluator,
    });
    await expectGatewayCode(
      unauthorizedCache.gateway.invoke(request, {
        ...belowThresholdBase,
        routingDecision: belowThresholdRoutingDecision,
        routingRequest: belowThresholdRoutingRequest,
      }),
      "model-gateway.invalid-usage",
    );
    expect(unauthorizedCacheAdapter.invocations).toHaveLength(1);
    expect(
      unauthorizedCacheAdapter.invocations[0]?.promptCacheKey,
    ).toBeUndefined();

    const missingProviderRequestIdAdapter = new ScriptedFakeModelAdapter(
      [
        (invocation) => {
          const successful = successfulProviderResult(invocation);
          if (successful.usage === undefined) {
            throw new Error("Missing synthetic provider usage.");
          }
          return {
            ...successful,
            usage: {
              cacheReadUnits: successful.usage.cacheReadUnits,
              cacheWriteUnits: successful.usage.cacheWriteUnits,
              inputUnits: successful.usage.inputUnits,
              outputUnits: successful.usage.outputUnits,
              thinkingUnits: successful.usage.thinkingUnits,
            },
          };
        },
      ],
      profile,
    );
    const missingProviderRequestId = createHarness({
      adapter: missingProviderRequestIdAdapter,
      routeRegistry,
      routing,
      routingDecisionEvaluator,
    });
    await expectGatewayCode(
      missingProviderRequestId.gateway.invoke(
        request,
        routedContext("invocation_route_missing_provider_request_id"),
      ),
      "model-gateway.missing-usage",
    );
    expect(missingProviderRequestIdAdapter.invocations).toHaveLength(1);
    expect(missingProviderRequestId.usageRecorder.records).toHaveLength(0);

    const missingErrorRequestIdAdapter = new ScriptedFakeModelAdapter(
      [
        new ModelProviderInvocationError({
          classification: "permanent",
          safeCode: "model-provider.permanent",
          safeMessage:
            "The synthetic production provider rejected the request.",
          usage: {
            cacheReadUnits: "0",
            cacheWriteUnits: "0",
            inputUnits: "5",
            outputUnits: "0",
            thinkingUnits: "0",
          },
        }),
      ],
      profile,
    );
    const missingErrorRequestId = createHarness({
      adapter: missingErrorRequestIdAdapter,
      routeRegistry,
      routing,
      routingDecisionEvaluator,
    });
    await expectGatewayCode(
      missingErrorRequestId.gateway.invoke(
        request,
        routedContext("invocation_route_error_missing_provider_request_id"),
      ),
      "model-gateway.missing-usage",
    );
    expect(missingErrorRequestIdAdapter.invocations).toHaveLength(1);
    expect(missingErrorRequestId.usageRecorder.records).toHaveLength(0);

    const deepBase = modelTestContext("invocation_route_deep");
    const deepRoutingRequest = modelTestRoutingRequest(request, deepBase, {
      selectedPreference: "deep-design",
    });
    const deepRoutingDecision = routingDecisionEvaluator.evaluate({
      request: deepRoutingRequest,
      routingConfigurationDigest,
    }).decision;
    const deepResult = await bound.gateway.invoke(request, {
      ...deepBase,
      routingDecision: deepRoutingDecision,
      routingRequest: deepRoutingRequest,
    });
    expect(deepResult.descriptor).toMatchObject({
      modelId: "configured.model.deep.required",
      role: "deep-architecture-custom-generation",
      routing: { routeId: "deep-design" },
    });

    const originalRoutingDecisionDigest =
      result.descriptor.routing?.routingDecisionDigest;
    if (originalRoutingDecisionDigest === undefined) {
      throw new Error("The Standard invocation routing digest is missing.");
    }
    const internalContext = (invocationId: string) => {
      const base = modelTestContext(invocationId);
      const routingRequest = modelTestRoutingRequest(request, base, {
        currentValidationState: "failed-build",
        priorAttempt: {
          diagnosticsDigest: sha256Text("sanitized failed build"),
          escalationCount: 0,
          originalAcceptedEstimateMaximumCreditUnits: 20,
          originalCreditAuthorizationDecisionId: base.budget.decisionId,
          originalInvocationId: context.invocationId,
          originalRoutingDecisionDigest,
          result: "build-failure",
          routeId: "standard-design",
        },
      });
      const routingDecision = routingDecisionEvaluator.evaluate({
        request: routingRequest,
        routingConfigurationDigest,
      }).decision;
      return { ...base, routingDecision, routingRequest };
    };
    const internal = internalContext("invocation_route_internal");
    expect(internal.routingDecision).toMatchObject({
      automaticEscalationPermitted: false,
      customerCharge: { incrementalEscalationCreditUnits: 0 },
      maximumAttempts: 1,
      outcome: "selected",
      routeId: "internal-escalation",
    });
    const internalResult = await bound.gateway.invoke(request, internal);
    expect(internalResult.descriptor).toMatchObject({
      modelId: "configured.model.deep.required",
      role: "repair-escalation",
      routing: { routeId: "internal-escalation" },
    });
    await expectGatewayCode(
      bound.gateway.invoke(
        request,
        internalContext("invocation_route_internal_replay"),
      ),
      "model-gateway.invocation-conflict",
    );
    expect(boundAdapter.invocations).toHaveLength(3);

    const mutations: readonly ((
      decision: ModelRoutingDecisionV1,
    ) => ModelRoutingDecisionV1)[] = [
      (decision) => ({
        ...decision,
        modelId: "configured.model.deep.required",
      }),
      (decision) => ({ ...decision, effort: "high" }),
      (decision) => ({ ...decision, maximumAttempts: 1 }),
      (decision) => ({
        ...decision,
        maximumOutputTokens: decision.maximumOutputTokens + 1,
      }),
      (decision) => ({
        ...decision,
        automaticEscalationPermitted: !decision.automaticEscalationPermitted,
      }),
      (decision) => ({
        ...decision,
        customerCharge: {
          ...decision.customerCharge,
          acceptedMaximumCreditUnits:
            (decision.customerCharge.acceptedMaximumCreditUnits ?? 0) + 1,
        },
      }),
      (decision) => ({
        ...decision,
        reasonCodes: [...decision.reasonCodes, "custom-code"],
      }),
    ];
    for (const [index, mutate] of mutations.entries()) {
      const forged = routedContext("invocation_route_forged_" + String(index));
      await expectGatewayCode(
        bound.gateway.invoke(request, {
          ...forged,
          routingDecision: mutate(forged.routingDecision),
        }),
        "model-gateway.routing-decision-mismatch",
      );
    }
    const unknownField = routedContext("invocation_route_unknown_field");
    await expectGatewayCode(
      bound.gateway.invoke(request, {
        ...unknownField,
        routingDecision: {
          ...unknownField.routingDecision,
          browserClaimedModel: "configured.model.deep.required",
        } as unknown as ModelRoutingDecisionV1,
      }),
      "model-gateway.routing-decision-mismatch",
    );

    const noPriorInternal = routedContext("invocation_route_no_prior_internal");
    await expectGatewayCode(
      bound.gateway.invoke(request, {
        ...noPriorInternal,
        routingDecision: {
          ...noPriorInternal.routingDecision,
          automaticEscalationPermitted: false,
          effort: "high",
          escalation: {
            diagnosticsDigest: sha256Text("forged diagnostics"),
            originalAcceptedEstimateMaximumCreditUnits:
              noPriorInternal.routingRequest.creditAuthorization
                .acceptedEstimateMaximumCreditUnits ?? 0,
            originalCreditAuthorizationDecisionId:
              noPriorInternal.routingRequest.creditAuthorization.decisionId,
            originalInvocationId: "invocation_forged_standard_prior",
            originalResult: "validation-failure",
            originalRouteId: "standard-design",
            originalRoutingDecisionDigest: sha256Text(
              "forged standard decision",
            ),
          },
          maximumAttempts: 1,
          routeId: "internal-escalation",
        },
      }),
      "model-gateway.routing-decision-mismatch",
    );

    const deepStarterBase = modelTestContext("invocation_route_starter_deep");
    const deepStarterInitial = modelTestRoutingRequest(
      request,
      deepStarterBase,
    );
    const deepStarterRequest = modelRoutingRequestV1Schema.parse({
      ...deepStarterInitial,
      creditAuthorization: {
        ...deepStarterInitial.creditAuthorization,
        decisionId: deepStarterBase.budget.decisionId,
      },
      plan: { ...deepStarterInitial.plan, key: "starter" },
      selectedPreference: "deep-design",
    });
    const deepStarterDecision = routingDecisionEvaluator.evaluate({
      request: deepStarterRequest,
      routingConfigurationDigest,
    }).decision;
    expect(deepStarterDecision.outcome).toBe("denied");
    await expectGatewayCode(
      bound.gateway.invoke(request, {
        ...deepStarterBase,
        routingDecision: deepStarterDecision,
        routingRequest: deepStarterRequest,
      }),
      "model-gateway.routing-decision-mismatch",
    );

    const staleBinding = routedContext("invocation_route_stale_binding");
    await expectGatewayCode(
      bound.gateway.invoke(request, {
        ...staleBinding,
        routingRequest: {
          ...staleBinding.routingRequest,
          inputDigest: sha256Text("stale routing input"),
        },
      }),
      "model-gateway.routing-decision-mismatch",
    );

    const authorityMutations: readonly ((
      value: ModelRoutingRequestV1,
    ) => ModelRoutingRequestV1)[] = [
      (value) =>
        modelRoutingRequestV1Schema.parse({
          ...value,
          plan: { ...value.plan, key: "starter" },
        }),
      (value) =>
        modelRoutingRequestV1Schema.parse({
          ...value,
          plan: { ...value.plan, versionId: "plan_version_forged" },
        }),
      (value) =>
        modelRoutingRequestV1Schema.parse({
          ...value,
          creditAuthorization: {
            ...value.creditAuthorization,
            availableCreditUnits:
              value.creditAuthorization.availableCreditUnits + 1,
          },
        }),
      (value) =>
        modelRoutingRequestV1Schema.parse({
          ...value,
          creditAuthorization: {
            ...value.creditAuthorization,
            acceptedEstimateMaximumCreditUnits:
              (value.creditAuthorization.acceptedEstimateMaximumCreditUnits ??
                0) + 1,
          },
        }),
      (value) =>
        modelRoutingRequestV1Schema.parse({
          ...value,
          creditAuthorization: {
            allowed: value.creditAuthorization.allowed,
            availableCreditUnits:
              value.creditAuthorization.availableCreditUnits,
            decisionId: value.creditAuthorization.decisionId,
            estimateAccepted: false,
          },
        }),
    ];
    const authorityAdapter = new ScriptedFakeModelAdapter(
      Array.from(
        { length: authorityMutations.length },
        () => successfulProviderResult,
      ),
      profile,
    );
    const authorityHarness = createHarness({
      adapter: authorityAdapter,
      routeRegistry,
      routing,
      routingDecisionEvaluator,
    });
    for (const [index, mutate] of authorityMutations.entries()) {
      const base = modelTestContext(
        `invocation_route_authority_mutation_${String(index)}`,
      );
      const routingRequest = mutate(modelTestRoutingRequest(request, base));
      const routingDecision = routingDecisionEvaluator.evaluate({
        request: routingRequest,
        routingConfigurationDigest,
      }).decision;
      expect(routingDecision.outcome).toBe("selected");
      await expectGatewayCode(
        authorityHarness.gateway.invoke(request, {
          ...base,
          routingDecision,
          routingRequest,
        }),
        "model-gateway.routing-decision-mismatch",
      );
    }
    expect(authorityAdapter.invocations).toHaveLength(0);

    const repairRequest = requestFor("candidate.repair");
    const xhighEffortAuthorization = {
      classification: "difficult-repair",
      decisionId: "effort_decision_gateway_test",
      policyId: namespacedIdentifierSchema.parse(
        "cloudmarkup.model-effort.difficult.v1",
      ),
      policyVersion: semanticVersionSchema.parse("1.0.0"),
    } as const;
    const xhighBase = {
      ...modelTestContext("invocation_route_xhigh", "deep"),
      xhighEffortAuthorization,
    };
    const xhighRoutingRequest = modelTestRoutingRequest(
      repairRequest,
      xhighBase,
      { selectedPreference: "deep-design" },
    );
    const xhighRoutingDecision = routingDecisionEvaluator.evaluate({
      request: xhighRoutingRequest,
      routingConfigurationDigest,
    }).decision;
    expect(xhighRoutingDecision.effort).toBe("xhigh");
    const xhighAdapter = new ScriptedFakeModelAdapter(
      [successfulProviderResult],
      profile,
    );
    const xhighHarness = createHarness({
      adapter: xhighAdapter,
      routeRegistry,
      routing,
      routingDecisionEvaluator,
    });
    const xhighResult = await xhighHarness.gateway.invoke(repairRequest, {
      ...xhighBase,
      routingDecision: xhighRoutingDecision,
      routingRequest: xhighRoutingRequest,
    });
    expect(xhighResult.descriptor.routing?.effort).toBe("xhigh");
    expect(xhighAdapter.invocations).toHaveLength(1);

    const unauthorizedXhighBase = modelTestContext(
      "invocation_route_xhigh_unauthorized",
      "deep",
    );
    const unauthorizedXhighRoutingRequest = modelTestRoutingRequest(
      repairRequest,
      unauthorizedXhighBase,
      {
        selectedPreference: "deep-design",
        xhighEffortAuthorization,
      },
    );
    const unauthorizedXhighRoutingDecision = routingDecisionEvaluator.evaluate({
      request: unauthorizedXhighRoutingRequest,
      routingConfigurationDigest,
    }).decision;
    await expectGatewayCode(
      xhighHarness.gateway.invoke(repairRequest, {
        ...unauthorizedXhighBase,
        routingDecision: unauthorizedXhighRoutingDecision,
        routingRequest: unauthorizedXhighRoutingRequest,
      }),
      "model-gateway.routing-decision-mismatch",
    );
    expect(xhighAdapter.invocations).toHaveLength(1);

    const mutatedProfile: ModelProviderCapabilityProfileV1 = {
      ...profile,
      capabilities: [
        {
          ...trustedCapability,
          maximumOutputTokens: trustedCapability.maximumOutputTokens + 1,
        },
      ],
    };
    const mutatedAdapter = new ScriptedFakeModelAdapter(
      [successfulProviderResult],
      mutatedProfile,
    );
    const mutated = createHarness({
      adapter: mutatedAdapter,
      routeRegistry,
      routing,
      routingDecisionEvaluator,
    });
    await expectGatewayCode(
      mutated.gateway.invoke(
        request,
        routedContext("invocation_route_capability_drift"),
      ),
      "model-gateway.routing-decision-mismatch",
    );
    expect(mutatedAdapter.invocations).toHaveLength(0);
    expect(mutated.usageRecorder.records).toHaveLength(0);

    const driftedRouting = modelRoutingConfigurationV1Schema.parse({
      ...routing,
      routes: routing.routes.map((route) => ({
        ...route,
        candidates: route.candidates.map((candidate) => ({
          ...candidate,
          priority: candidate.priority + 1,
        })),
      })),
    });
    const driftedAdapter = new ScriptedFakeModelAdapter(
      [successfulProviderResult],
      profile,
    );
    const drifted = createHarness({
      adapter: driftedAdapter,
      routeRegistry,
      routing: driftedRouting,
      routingDecisionEvaluator,
    });
    await expectGatewayCode(
      drifted.gateway.invoke(
        request,
        routedContext("invocation_route_configuration_drift"),
      ),
      "model-gateway.routing-decision-mismatch",
    );
    expect(driftedAdapter.invocations).toHaveLength(0);
    expect(boundAdapter.invocations).toHaveLength(3);
  });

  it.each([
    "application-source.generate" as const,
    "iac-extension.generate" as const,
    "candidate.repair" as const,
  ])("retains invalid %s output in the restricted store", async (operation) => {
    const harness = createHarness({
      adapter: new ScriptedFakeModelAdapter([
        (invocation) => {
          const usage = successfulProviderResult(invocation).usage;
          if (usage === undefined) {
            throw new Error("Missing synthetic provider usage.");
          }
          return {
            content: responseToolContent(invocation, {
              contractVersion: 1,
              operation,
              unexpectedCandidateField: "restricted-debug-evidence",
            }),
            usage,
          };
        },
      ]),
    });

    await expectGatewayCode(
      harness.gateway.invoke(
        requestFor(operation),
        modelTestContext(
          `invocation_invalid_${operation.replaceAll(".", "_")}`,
        ),
      ),
      "model-gateway.invalid-output",
    );
    expect(harness.invalidProposalStore.records).toHaveLength(1);
    expect(harness.invalidProposalStore.records[0]).toMatchObject({
      classification: "restricted-model-proposal",
      diagnostics: [
        expect.objectContaining({ code: "model-gateway.invalid-output" }),
      ],
      retentionPolicyId: "cloudmarkup.invalid-model-proposal.v1",
    });
    expect(
      harness.invalidProposalStore.records[0]?.proposalCanonicalJson,
    ).toContain("unexpectedCandidateField");
  });

  it("rejects malformed, unknown-operation, and oversized output", async () => {
    const malformed = createHarness({
      adapter: new ScriptedFakeModelAdapter([
        (invocation) => {
          const usage = successfulProviderResult(invocation).usage;
          if (usage === undefined) {
            throw new Error("Missing synthetic provider usage.");
          }
          return {
            content: responseToolContent(invocation, { contractVersion: 1 }),
            usage,
          };
        },
      ]),
    });
    await expectGatewayCode(
      malformed.gateway.invoke(
        requestFor("summary.technical"),
        modelTestContext("invocation_malformed"),
      ),
      "model-gateway.invalid-output",
    );
    expect(malformed.usageRecorder.records).toHaveLength(1);
    expect(malformed.usageRecorder.records[0]?.result).toBe("invalid-output");

    const unknownRequest = {
      contractVersion: 1,
      operation: "deployment.execute",
      requestedMode: "guided",
    } as never;
    await expectGatewayCode(
      createHarness().gateway.invoke(
        unknownRequest,
        modelTestContext("invocation_unknown"),
      ),
      "model-gateway.invalid-request",
    );

    const oversized = createHarness({
      adapter: new ScriptedFakeModelAdapter([
        (invocation) => {
          const output = deterministicFakeResponseV1(invocation);
          if (output.operation !== "summary.technical") {
            throw new Error("Unexpected operation.");
          }
          output.summary = "x".repeat(1_000);
          return {
            ...successfulProviderResult(invocation),
            content: responseToolContent(invocation, output),
          };
        },
      ]),
      maximumOutputBytes: 300,
    });
    await expectGatewayCode(
      oversized.gateway.invoke(
        requestFor("summary.technical"),
        modelTestContext("invocation_oversized"),
      ),
      "model-gateway.output-too-large",
    );
    expect(oversized.usageRecorder.records).toHaveLength(1);
    expect(oversized.usageRecorder.records[0]?.result).toBe("invalid-output");
  });

  it("rejects unknown catalog services and ungrounded repository claims", async () => {
    const unknownService = createHarness({
      adapter: new ScriptedFakeModelAdapter([
        (invocation) => {
          const output = deterministicFakeResponseV1(invocation);
          if (output.operation !== "architecture.propose") {
            throw new Error("Unexpected operation.");
          }
          const service = output.services[0];
          if (service === undefined) throw new Error("Missing fake service.");
          service.catalogServiceId = "unknown.service" as never;
          return {
            ...successfulProviderResult(invocation),
            content: responseToolContent(invocation, output),
          };
        },
      ]),
    });
    await expectGatewayCode(
      unknownService.gateway.invoke(
        requestFor("architecture.propose"),
        modelTestContext("invocation_unknown_service"),
      ),
      "model-gateway.unknown-service",
    );

    const ungrounded = createHarness({
      adapter: new ScriptedFakeModelAdapter([
        (invocation) => {
          const output = deterministicFakeResponseV1(invocation);
          if (output.operation !== "repository.interpret") {
            throw new Error("Unexpected operation.");
          }
          const reference = output.claims[0]?.evidenceReferences[0];
          if (reference === undefined)
            throw new Error("Missing fake evidence.");
          reference.referenceId = "repository_evidence_not_supplied";
          return {
            ...successfulProviderResult(invocation),
            content: responseToolContent(invocation, output),
          };
        },
      ]),
    });
    await expectGatewayCode(
      ungrounded.gateway.invoke(
        requestFor("repository.interpret"),
        modelTestContext("invocation_ungrounded"),
      ),
      "model-gateway.ungrounded-repository-claim",
    );
  });

  it("grounds Graph Commands, workload owners, and reconciliation operations in exact supplied state", async () => {
    const unknownOwner = createHarness({
      adapter: new ScriptedFakeModelAdapter([
        (invocation) => {
          const output = deterministicFakeResponseV1(invocation);
          if (output.operation !== "operations.propose")
            throw new Error("Unexpected operation.");
          const batch = output.batches.find(
            (candidate) => candidate.kind === "workload",
          );
          const operation = batch?.operations[0];
          if (operation?.action !== "add")
            throw new Error("Missing workload add fixture.");
          operation.proposal.owningNodeId = "node_not_supplied" as never;
          return {
            ...successfulProviderResult(invocation),
            content: responseToolContent(invocation, output),
          };
        },
      ]),
    });
    await expectGatewayCode(
      unknownOwner.gateway.invoke(
        requestFor("operations.propose"),
        modelTestContext("invocation_unknown_workload_owner"),
      ),
      "model-gateway.ungrounded-workload-operation",
    );

    const graph = createHarness({
      adapter: new ScriptedFakeModelAdapter([
        (invocation) => {
          const output = deterministicFakeResponseV1(invocation);
          if (output.operation !== "operations.propose")
            throw new Error("Unexpected operation.");
          if (invocation.request.operation !== "operations.propose")
            throw new Error("Unexpected request operation.");
          const architecture = invocation.request.architecture;
          const node = architecture.nodes[0];
          if (node === undefined) throw new Error("Missing architecture node.");
          const target = {
            architectureId: architecture.architectureId,
            documentId: architecture.documentId,
            revisionId: architecture.revision.revisionId,
          };
          output.batches = [
            {
              batch: {
                commandId: operationIdSchema.parse("command_batch_model_test"),
                commands: [
                  {
                    commandId: operationIdSchema.parse(
                      "command_move_model_test",
                    ),
                    expectedPosition: { x: -999, y: -999 },
                    inverseCommandId: operationIdSchema.parse(
                      "command_move_model_test_inverse",
                    ),
                    kind: "move-node",
                    nodeId: node.id,
                    origin: "ai-accepted",
                    position: { x: 10, y: 20 },
                    schemaVersion: 1,
                    target,
                  },
                ],
                inverseCommandId: operationIdSchema.parse(
                  "command_batch_model_test_inverse",
                ),
                kind: "batch",
                origin: "ai-accepted",
                schemaVersion: 1,
                target,
              },
              kind: "graph",
            },
          ];
          return {
            ...successfulProviderResult(invocation),
            content: responseToolContent(invocation, output),
          };
        },
      ]),
    });
    await expectGatewayCode(
      graph.gateway.invoke(
        requestFor("operations.propose"),
        modelTestContext("invocation_ungrounded_graph_command"),
      ),
      "model-gateway.ungrounded-graph-command",
    );

    const observedHash = sha256Text("observed-content");
    const targetDigest = sha256Text("observed-target");
    const reconciliation = reconciliationProposalV1Schema.parse({
      applyPolicy: "explicit-review-and-deterministic-operation",
      authority: "proposal-only",
      contractVersion: 1,
      kind: "cloudmarkup.reconciliation-proposal",
      observedContentHash: observedHash,
      observedSolutionId: "observed_solution_model_test",
      operations: [
        {
          kind: "keep-observed-only",
          operationId: "reconciliation_operation_model_test",
          rationale: "Keep the exact supplied observation as evidence only.",
          target: {
            kind: "resource",
            observedResourceId: "observed_resource_model_test",
            recordDigest: targetDigest,
          },
        },
      ],
      proposalId: "reconciliation_proposal_model_test",
      provenance: {
        actor: {
          kind: "deterministic-tool",
          tool: {
            digest: sha256Text("reconciliation-tool"),
            id: "cloudmarkup.reconciliation-engine",
            version: "1.0.0",
          },
        },
        createdAt: "2026-08-20T00:00:00.000Z",
        inputDigests: [observedHash],
      },
      repositorySnapshotDigest: sha256Text("repository-snapshot"),
      repositorySnapshotId: "repository_snapshot_model_test",
      review: { state: "pending-review" },
    });
    const reconciliationRequest = structuredClone(
      requestFor("operations.propose"),
    );
    reconciliationRequest.reconciliation = reconciliation;
    const reconciliationScopeMismatchAdapter = new ScriptedFakeModelAdapter([
      successfulProviderResult,
    ]);
    const reconciliationScopeMismatch = createHarness({
      adapter: reconciliationScopeMismatchAdapter,
    });
    await expectGatewayCode(
      reconciliationScopeMismatch.gateway.invoke(
        reconciliationRequest,
        modelTestContext("invocation_reconciliation_scope_mismatch"),
      ),
      "model-gateway.scope-authority-mismatch",
    );
    expect(reconciliationScopeMismatchAdapter.invocations).toHaveLength(0);
    const ungroundedReconciliation = createHarness({
      adapter: new ScriptedFakeModelAdapter([
        (invocation) => {
          const output = deterministicFakeResponseV1(invocation);
          if (output.operation !== "operations.propose")
            throw new Error("Unexpected operation.");
          output.batches = [
            {
              expectedObservedContentHash: observedHash,
              kind: "reconciliation",
              operations: [
                {
                  ...reconciliation.operations[0],
                  target: {
                    ...reconciliation.operations[0]?.target,
                    recordDigest: sha256Text("invented-target"),
                  },
                },
              ],
            },
          ] as never;
          return {
            ...successfulProviderResult(invocation),
            content: responseToolContent(invocation, output),
          };
        },
      ]),
    });
    await expectGatewayCode(
      ungroundedReconciliation.gateway.invoke(reconciliationRequest, {
        ...modelTestContext("invocation_ungrounded_reconciliation"),
        scope: {
          ...modelTestContext("invocation_ungrounded_reconciliation").scope,
          repositorySnapshotId: reconciliation.repositorySnapshotId,
        },
      }),
      "model-gateway.reconciliation-evidence-lineage-mismatch",
    );
    expect(ungroundedReconciliation.adapter.invocations).toHaveLength(0);
  });

  it("fences cancellation and retries only transient provider failures", async () => {
    const canceled = createHarness();
    const controller = new AbortController();
    controller.abort();
    await expectGatewayCode(
      canceled.gateway.invoke(
        requestFor("summary.plain-language"),
        modelTestContext("invocation_canceled"),
        controller.signal,
      ),
      "model-gateway.canceled",
    );
    expect(canceled.adapter.invocations).toHaveLength(0);

    const completedController = new AbortController();
    const completedAdapter = new ScriptedFakeModelAdapter([
      (invocation) => {
        completedController.abort();
        return successfulProviderResult(invocation);
      },
    ]);
    const completedThenCanceled = createHarness({
      adapter: completedAdapter,
    });
    await expectGatewayCode(
      completedThenCanceled.gateway.invoke(
        requestFor("summary.plain-language"),
        modelTestContext("invocation_completed_then_canceled"),
        completedController.signal,
      ),
      "model-gateway.canceled",
    );
    expect(completedThenCanceled.usageRecorder.records).toHaveLength(1);
    expect(completedThenCanceled.usageRecorder.records[0]).toMatchObject({
      inputUnits: "20",
      outputUnits: "10",
      result: "canceled",
    });

    const postStartController = new AbortController();
    const postStartAdapter = new ScriptedFakeModelAdapter([
      () => {
        postStartController.abort();
        return new ModelProviderInvocationError({
          classification: "permanent",
          safeCode: "model-provider.canceled",
          safeMessage: "The synthetic provider observed cancellation.",
          usage: {
            cacheReadUnits: "0",
            cacheWriteUnits: "0",
            inputUnits: "7",
            outputUnits: "0",
            providerRequestId: "provider_post_start_canceled",
            thinkingUnits: "0",
          },
        });
      },
    ]);
    const postStartCanceled = createHarness({ adapter: postStartAdapter });
    await expectGatewayCode(
      postStartCanceled.gateway.invoke(
        requestFor("summary.plain-language"),
        modelTestContext("invocation_post_start_canceled"),
        postStartController.signal,
      ),
      "model-gateway.canceled",
    );
    expect(postStartAdapter.invocations).toHaveLength(1);
    expect(postStartCanceled.usageRecorder.records).toMatchObject([
      {
        inputUnits: "7",
        providerRequestId: "provider_post_start_canceled",
        result: "canceled",
      },
    ]);

    const adapter = new ScriptedFakeModelAdapter([
      new ModelProviderInvocationError({
        classification: "transient",
        safeCode: "model-provider.temporary",
        safeMessage: "The fake provider is temporarily unavailable.",
        usage: {
          cacheReadUnits: "0",
          cacheWriteUnits: "0",
          inputUnits: "12",
          outputUnits: "0",
          providerRequestId: "provider_retry_attempt_1",
          thinkingUnits: "1",
        },
      }),
      successfulProviderResult,
    ]);
    const retry = createHarness({ adapter });
    const result = await retry.gateway.invoke(
      requestFor("summary.plain-language"),
      modelTestContext("invocation_retry"),
    );
    expect(result.response.operation).toBe("summary.plain-language");
    expect(adapter.invocations).toHaveLength(2);
    expect(retry.usageRecorder.records).toMatchObject([
      { attemptNumber: 1, result: "provider-error" },
      { attemptNumber: 2, result: "succeeded" },
    ]);
    expect(
      new Set(retry.usageRecorder.records.map((usage) => usage.usageRecordId))
        .size,
    ).toBe(2);
    expect(
      retry.logger.events.some((event) => event.result === "retrying"),
    ).toBe(true);

    const terminalFailureAdapter = new ScriptedFakeModelAdapter([
      new ModelProviderInvocationError({
        classification: "transient",
        safeCode: "model-provider.temporary",
        safeMessage: "The first synthetic provider attempt is retryable.",
        usage: {
          cacheReadUnits: "0",
          cacheWriteUnits: "0",
          inputUnits: "4",
          outputUnits: "0",
          providerRequestId: "provider_terminal_attempt_1",
          thinkingUnits: "0",
        },
      }),
      new ModelProviderInvocationError({
        classification: "permanent",
        safeCode: "model-provider.permanent",
        safeMessage: "The second synthetic provider attempt is terminal.",
        usage: {
          cacheReadUnits: "0",
          cacheWriteUnits: "0",
          inputUnits: "5",
          outputUnits: "0",
          providerRequestId: "provider_terminal_attempt_2",
          thinkingUnits: "0",
        },
      }),
    ]);
    const terminalFailure = createHarness({ adapter: terminalFailureAdapter });
    await expectGatewayCode(
      terminalFailure.gateway.invoke(
        requestFor("summary.plain-language"),
        modelTestContext("invocation_terminal_attempt"),
      ),
      "model-provider.permanent",
    );
    expect(terminalFailure.usageRecorder.records).toMatchObject([
      { attemptNumber: 1, result: "provider-error" },
      { attemptNumber: 2, result: "provider-error" },
    ]);
    expect(terminalFailure.logger.events.at(-1)).toMatchObject({
      attempt: 2,
      safeCode: "model-provider.permanent",
    });
  });

  it("awaits adapter-owned late timeout settlement and meters it once", async () => {
    const profile = {
      ...deterministicFakeProviderProfileV1,
      capabilities: deterministicFakeProviderProfileV1.capabilities.map(
        (capability) => ({
          ...capability,
          maximumAttempts: 1,
          timeoutMilliseconds: 10,
        }),
      ),
    };
    const adapter = new ScriptedFakeModelAdapter(
      [
        async (invocation) => {
          expect(invocation.timeoutMilliseconds).toBe(10);
          await new Promise((resolve) => setTimeout(resolve, 25));
          throw new ModelProviderInvocationError({
            classification: "permanent",
            safeCode: "model-provider.timeout",
            safeMessage: "The adapter settled the timed-out provider request.",
            usage: {
              cacheReadUnits: "0",
              cacheWriteUnits: "0",
              inputUnits: "9",
              outputUnits: "0",
              providerRequestId: "provider_late_timeout_settlement",
              thinkingUnits: "0",
            },
          });
        },
      ],
      profile,
    );
    const harness = createHarness({ adapter });
    const startedAt = Date.now();
    await expectGatewayCode(
      harness.gateway.invoke(
        requestFor("summary.technical"),
        modelTestContext("invocation_timeout"),
      ),
      "model-provider.timeout",
    );
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(20);
    expect(adapter.invocations).toHaveLength(1);
    expect(harness.usageRecorder.records).toMatchObject([
      {
        attemptNumber: 1,
        providerRequestId: "provider_late_timeout_settlement",
        result: "provider-error",
      },
    ]);
  });

  it("rejects prose and unknown response tools as machine state", async () => {
    const prose = createHarness({
      adapter: new ScriptedFakeModelAdapter([
        {
          content: { kind: "text", text: "Looks good to me." },
          usage: {
            cacheReadUnits: "0",
            cacheWriteUnits: "0",
            inputUnits: "1",
            outputUnits: "1",
            thinkingUnits: "0",
          },
        },
      ]),
    });
    await expectGatewayCode(
      prose.gateway.invoke(
        requestFor("summary.technical"),
        modelTestContext("invocation_prose"),
      ),
      "model-gateway.prose-not-machine-state",
    );
    expect(prose.usageRecorder.records[0]?.result).toBe("invalid-output");

    const unknownTool = createHarness({
      adapter: new ScriptedFakeModelAdapter([
        (invocation) => ({
          ...successfulProviderResult(invocation),
          content: {
            input: deterministicFakeResponseV1(invocation),
            kind: "tool-use",
            toolName: "cloudmarkup_unknown_v1",
          },
        }),
      ]),
    });
    await expectGatewayCode(
      unknownTool.gateway.invoke(
        requestFor("summary.technical"),
        modelTestContext("invocation_unknown_tool"),
      ),
      "model-gateway.unknown-response-tool",
    );
    expect(unknownTool.usageRecorder.records[0]?.result).toBe("invalid-output");
  });

  it("redacts secret values before adapter invocation and never logs raw bodies", async () => {
    const request = structuredClone(requestFor("summary.technical"));
    const fakeAccessKey = ["AK", "IA", "1234", "5678", "90AB", "CDEF"].join("");
    const bearer = "Bearer abcdefghijklmnopqrstuvwxyz012345";
    const jwt =
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0LXVzZXIifQ.signaturevalue";
    const githubToken = `ghp_${"a".repeat(36)}`;
    const jsonSecret = '"client_secret": "quoted-json-secret"';
    request.source.content = `token=super-secret-value ${fakeAccessKey} ${bearer} ${jwt} ${githubToken} ${jsonSecret} https://user:pass@example.test/path`;
    request.source.contentDigest = sha256Text(request.source.content);
    const harness = createHarness();

    await harness.gateway.invoke(
      request,
      modelTestContext("invocation_redaction"),
    );
    const assertedSecretFree = structuredClone(
      requestFor("repository.interpret"),
    );
    const assertedEvidence = assertedSecretFree.evidence[0];
    if (assertedEvidence === undefined)
      throw new Error("Missing repository evidence fixture.");
    assertedEvidence.content = `Authorization: ${bearer} ${jwt}`;
    await harness.gateway.invoke(
      assertedSecretFree,
      modelTestContext("invocation_redaction_asserted_secret_free"),
    );

    const sanitizedSummary = harness.adapter.invocations[0]?.request;
    if (sanitizedSummary?.operation !== "summary.technical") {
      throw new Error("Missing sanitized summary invocation.");
    }
    expect(sanitizedSummary.source.contentDigest).toBe(
      sha256Text(sanitizedSummary.source.content),
    );
    expect(() => {
      validateModelRequestAuthority(sanitizedSummary);
    }).not.toThrow();

    const externalResource = structuredClone(
      requestFor("external-resource.propose"),
    );
    const repositoryExcerpt = externalResource.repositoryExcerpts[0];
    if (repositoryExcerpt === undefined) {
      throw new Error("Missing external-resource repository excerpt fixture.");
    }
    repositoryExcerpt.content =
      'client_secret="repository-excerpt-secret-value"';
    const externalNode = externalResource.architecture.nodes[0];
    if (externalNode === undefined) {
      throw new Error("Missing external-resource architecture node fixture.");
    }
    const typedPassword = "typed-gateway-password-value";
    const sessionToken = "IQoJb3JpZ2luX2VjEGatewaySessionTokenValue";
    const listedSecret = "typed-gateway-list-secret";
    externalNode.presentation.label = `aws_session_token="${sessionToken}"`;
    externalNode.semantic.configuration.values = {
      ...externalNode.semantic.configuration.values,
      [configurationKeySchema.parse("awsSessionToken")]: {
        kind: "string",
        value: sessionToken,
      },
      [configurationKeySchema.parse("password")]: {
        kind: "string",
        value: typedPassword,
      },
      [configurationKeySchema.parse("secret")]: {
        kind: "secret-reference",
        reference: "secret_gateway_session",
      },
      [configurationKeySchema.parse("token")]: {
        kind: "string-list",
        value: [listedSecret],
      },
    };
    await harness.gateway.invoke(
      externalResource,
      modelTestContext("invocation_redaction_repository_excerpt"),
    );
    const sanitizedExternalResource = harness.adapter.invocations[2]?.request;
    if (sanitizedExternalResource?.operation !== "external-resource.propose") {
      throw new Error("Missing sanitized external-resource invocation.");
    }
    expect(
      sanitizedExternalResource.repositoryExcerpts[0]?.redaction.categories,
    ).toContain("secret-candidate");
    expect(
      sanitizedExternalResource.repositoryExcerpts[0]?.redaction,
    ).toMatchObject({
      noSecretValues: true,
      status: "applied",
    });
    const sanitizedExternalNode =
      sanitizedExternalResource.architecture.nodes[0];
    if (sanitizedExternalNode === undefined) {
      throw new Error("Missing sanitized external-resource architecture node.");
    }
    expect(sanitizedExternalNode.semantic.configuration.values).toMatchObject({
      awsSessionToken: { kind: "string", value: "[REDACTED:SECRET]" },
      password: { kind: "string", value: "[REDACTED:SECRET]" },
      [configurationKeySchema.parse("secret")]: {
        kind: "secret-reference",
        reference: "secret_gateway_session",
      },
      token: { kind: "string-list", value: ["[REDACTED:SECRET]"] },
    });
    expect(sanitizedExternalNode.presentation.label).toContain("[REDACTED:");

    const credentialReference = structuredClone(
      requestFor("external-resource.propose"),
    );
    const credentialReferenceNode = credentialReference.architecture.nodes[0];
    if (credentialReferenceNode === undefined) {
      throw new Error(
        "Missing credential-reference architecture node fixture.",
      );
    }
    const rejectedCredentialReference = `ghp_${"b".repeat(36)}`;
    credentialReferenceNode.semantic.configuration.values = {
      ...credentialReferenceNode.semantic.configuration.values,
      [configurationKeySchema.parse("secret")]: {
        kind: "secret-reference",
        reference: rejectedCredentialReference,
      },
    };
    const invocationCountBeforeRejectedReference =
      harness.adapter.invocations.length;
    await expectGatewayCode(
      harness.gateway.invoke(
        credentialReference,
        modelTestContext("invocation_redaction_credential_reference_denied"),
      ),
      "model-gateway.redaction-unsupported",
    );
    expect(harness.adapter.invocations).toHaveLength(
      invocationCountBeforeRejectedReference,
    );

    const repair = structuredClone(requestFor("candidate.repair"));
    const failedFile = repair.failedCandidates[0];
    const diagnostic = repair.diagnostics[0];
    if (failedFile?.kind !== "file") {
      throw new Error("Missing failed repair file fixture.");
    }
    if (diagnostic === undefined) {
      throw new Error("Missing repair diagnostic fixture.");
    }
    failedFile.content = 'const client_secret = "repair-secret-value";\n';
    failedFile.contentDigest = sha256Text(failedFile.content);
    diagnostic.message =
      'The parser returned client_secret="repair-diagnostic-secret-value".';
    repair.failedOutputDigest = digestStructuredValue(repair.failedCandidates);
    await harness.gateway.invoke(
      repair,
      modelTestContext("invocation_redaction_repair"),
    );
    const sanitizedRepair = harness.adapter.invocations[3]?.request;
    if (sanitizedRepair?.operation !== "candidate.repair") {
      throw new Error("Missing sanitized repair invocation.");
    }
    expect(() => {
      validateModelRequestAuthority(sanitizedRepair);
    }).not.toThrow();
    expect(sanitizedRepair.diagnostics[0]?.redactionStatus).toBe("applied");

    const patchRepair = structuredClone(requestFor("candidate.repair"));
    const patchSource = patchRepair.failedCandidates[0];
    if (patchSource?.kind !== "file") {
      throw new Error("Missing patch repair source fixture.");
    }
    patchRepair.failedCandidates = [
      {
        baseDigest: patchSource.contentDigest,
        candidateId: patchSource.candidateId,
        kind: "patch",
        ownership: patchSource.ownership,
        path: patchSource.path,
        proposedResultDigest: sha256Text("redacted patch result"),
        unifiedDiff:
          '--- a/application/fake.ts\n+++ b/application/fake.ts\n@@ -1 +1 @@\n-old\n+const client_secret = "patch-secret-value";\n',
      },
    ];
    patchRepair.failedOutputDigest = digestStructuredValue(
      patchRepair.failedCandidates,
    );
    await expectGatewayCode(
      harness.gateway.invoke(
        patchRepair,
        modelTestContext("invocation_redaction_patch_denied"),
      ),
      "model-gateway.redaction-unsupported",
    );

    const serializedInvocation = JSON.stringify(harness.adapter.invocations);
    const serializedLogs = JSON.stringify(harness.logger.events);
    for (const secret of [
      "super-secret-value",
      fakeAccessKey,
      "user:pass",
      bearer,
      jwt,
      githubToken,
      "quoted-json-secret",
      "repository-excerpt-secret-value",
      "repair-diagnostic-secret-value",
      typedPassword,
      sessionToken,
      listedSecret,
      rejectedCredentialReference,
    ]) {
      expect(serializedInvocation).not.toContain(secret);
      expect(serializedLogs).not.toContain(secret);
    }
    expect(serializedInvocation).toContain("[REDACTED:");
    expect(harness.logger.events.every((event) => !("prompt" in event))).toBe(
      true,
    );
    expect(harness.logger.events.every((event) => !("response" in event))).toBe(
      true,
    );
  });

  it("fails closed for missing usage and metering failure", async () => {
    const missingUsage = createHarness({
      adapter: new ScriptedFakeModelAdapter([
        (invocation) => ({
          content: responseToolContent(
            invocation,
            deterministicFakeResponseV1(invocation),
          ),
        }),
      ]),
    });
    await expectGatewayCode(
      missingUsage.gateway.invoke(
        requestFor("summary.technical"),
        modelTestContext("invocation_missing_usage"),
      ),
      "model-gateway.missing-usage",
    );

    const metering = createHarness();
    metering.usageRecorder.fail = true;
    await expectGatewayCode(
      metering.gateway.invoke(
        requestFor("summary.technical"),
        modelTestContext("invocation_metering_failure"),
      ),
      "model-gateway.metering-failed",
    );
    expect(
      metering.logger.events.some(
        (event) => event.result === "metering-failed",
      ),
    ).toBe(true);
  });

  it("meters failed provider attempts exactly once and never fabricates denied usage", async () => {
    const permanentAdapter = new ScriptedFakeModelAdapter([
      new ModelProviderInvocationError({
        classification: "permanent",
        safeCode: "model-provider.permanent",
        safeMessage: "The provider permanently rejected the request.",
        usage: {
          cacheReadUnits: "0",
          cacheWriteUnits: "0",
          inputUnits: "17",
          outputUnits: "0",
          providerRequestId: "provider_permanent_attempt_1",
          thinkingUnits: "3",
        },
      }),
    ]);
    const permanent = createHarness({ adapter: permanentAdapter });
    await expectGatewayCode(
      permanent.gateway.invoke(
        requestFor("summary.technical"),
        modelTestContext("invocation_permanent_usage"),
      ),
      "model-provider.permanent",
    );
    expect(permanent.usageRecorder.records).toMatchObject([
      {
        attemptNumber: 1,
        inputUnits: "17",
        providerRequestId: "provider_permanent_attempt_1",
        result: "provider-error",
      },
    ]);

    const missingErrorUsageAdapter = new ScriptedFakeModelAdapter([
      new ModelProviderInvocationError({
        classification: "transient",
        safeCode: "model-provider.no-usage",
        safeMessage: "The provider omitted failed-attempt usage.",
      }),
      successfulProviderResult,
    ]);
    const missingErrorUsage = createHarness({
      adapter: missingErrorUsageAdapter,
    });
    await expectGatewayCode(
      missingErrorUsage.gateway.invoke(
        requestFor("summary.technical"),
        modelTestContext("invocation_error_missing_usage"),
      ),
      "model-gateway.missing-usage",
    );
    expect(missingErrorUsageAdapter.invocations).toHaveLength(1);
    expect(missingErrorUsage.usageRecorder.records).toHaveLength(0);

    const genericFailureAdapter = new ScriptedFakeModelAdapter([
      new Error("raw provider transport failure"),
    ]);
    const genericFailure = createHarness({ adapter: genericFailureAdapter });
    await expectGatewayCode(
      genericFailure.gateway.invoke(
        requestFor("summary.technical"),
        modelTestContext("invocation_generic_error_missing_usage"),
      ),
      "model-gateway.missing-usage",
    );
    expect(genericFailureAdapter.invocations).toHaveLength(1);
    expect(genericFailure.usageRecorder.records).toHaveLength(0);

    const invalidUsage = {
      cacheReadUnits: "0",
      cacheWriteUnits: "0",
      inputUnits: "1",
      outputUnits: "0",
      rawBillingPayload: "not-authorized",
      thinkingUnits: "0",
    } as unknown as ModelProviderUsageV1;
    const invalidErrorUsageAdapter = new ScriptedFakeModelAdapter([
      new ModelProviderInvocationError({
        classification: "transient",
        safeCode: "model-provider.invalid-usage",
        safeMessage: "The provider returned malformed usage.",
        usage: invalidUsage,
      }),
      successfulProviderResult,
    ]);
    const invalidErrorUsage = createHarness({
      adapter: invalidErrorUsageAdapter,
    });
    await expectGatewayCode(
      invalidErrorUsage.gateway.invoke(
        requestFor("summary.technical"),
        modelTestContext("invocation_error_invalid_usage"),
      ),
      "model-gateway.invalid-usage",
    );
    expect(invalidErrorUsageAdapter.invocations).toHaveLength(1);
    expect(invalidErrorUsage.usageRecorder.records).toHaveLength(0);

    const failedMeteringAdapter = new ScriptedFakeModelAdapter([
      new ModelProviderInvocationError({
        classification: "transient",
        safeCode: "model-provider.retryable",
        safeMessage: "The provider returned retryable failure usage.",
        usage: {
          cacheReadUnits: "0",
          cacheWriteUnits: "0",
          inputUnits: "4",
          outputUnits: "0",
          providerRequestId: "provider_metering_failure_attempt_1",
          thinkingUnits: "0",
        },
      }),
      successfulProviderResult,
    ]);
    const failedMetering = createHarness({ adapter: failedMeteringAdapter });
    failedMetering.usageRecorder.fail = true;
    await expectGatewayCode(
      failedMetering.gateway.invoke(
        requestFor("summary.technical"),
        modelTestContext("invocation_failed_attempt_metering"),
      ),
      "model-gateway.metering-failed",
    );
    expect(failedMeteringAdapter.invocations).toHaveLength(1);

    const denied = createHarness();
    const deniedContext = modelTestContext("invocation_pre_provider_denied");
    await expectGatewayCode(
      denied.gateway.invoke(requestFor("summary.technical"), {
        ...deniedContext,
        entitlement: { ...deniedContext.entitlement, allowed: false },
      }),
      "model-gateway.entitlement-denied",
    );
    expect(denied.adapter.invocations).toHaveLength(0);
    expect(denied.usageRecorder.records).toHaveLength(0);

    const replay = createHarness();
    await replay.gateway.invoke(
      requestFor("summary.technical"),
      modelTestContext("invocation_usage_recorder_replay"),
    );
    const usage = replay.usageRecorder.records[0];
    if (usage === undefined) throw new Error("Missing recorded usage.");
    await replay.usageRecorder.record(usage);
    expect(replay.usageRecorder.records).toHaveLength(1);
    await expect(
      replay.usageRecorder.record({ ...usage, inputUnits: "999" }),
    ).rejects.toThrow("conflicting usage record");
  });

  it("deduplicates exact invocation IDs and rejects conflicting reuse", async () => {
    const harness = createHarness();
    const context = modelTestContext("invocation_duplicate");
    const request = requestFor("summary.technical");

    const first = await harness.gateway.invoke(request, context);
    const duplicate = await harness.gateway.invoke(request, context);
    expect(duplicate).toEqual(first);
    expect(harness.adapter.invocations).toHaveLength(1);

    await expectGatewayCode(
      harness.gateway.invoke(requestFor("summary.plain-language"), context),
      "model-gateway.invocation-conflict",
    );
    await expectGatewayCode(
      harness.gateway.invoke(request, {
        ...context,
        budget: {
          ...context.budget,
          decisionId: "budget_decision_authority_drift",
        },
      }),
      "model-gateway.invocation-conflict",
    );
    expect(harness.adapter.invocations).toHaveLength(1);
  });

  it("binds duplicate completion to exact raw and dependency approval authority", async () => {
    const rawStore = new InMemoryModelInvocationStore();
    const firstRaw = structuredClone(requestFor("summary.technical"));
    firstRaw.source.content = 'client_secret: "first-raw-secret"';
    firstRaw.source.contentDigest = sha256Text(firstRaw.source.content);
    const secondRaw = structuredClone(firstRaw);
    secondRaw.source.content = 'client_secret: "second-raw-secret"';
    secondRaw.source.contentDigest = sha256Text(secondRaw.source.content);
    const rawContext = modelTestContext("invocation_raw_authority_replay");
    const firstRawHarness = createHarness({ invocationStore: rawStore });
    await firstRawHarness.gateway.invoke(firstRaw, rawContext);
    const secondRawHarness = createHarness({ invocationStore: rawStore });
    await expectGatewayCode(
      secondRawHarness.gateway.invoke(secondRaw, rawContext),
      "model-gateway.invocation-conflict",
    );
    expect(secondRawHarness.adapter.invocations).toHaveLength(0);

    const invocationStore = new InMemoryModelInvocationStore();
    const approvedAdapter = new ScriptedFakeModelAdapter([
      (invocation) => {
        const output = deterministicFakeResponseV1(invocation);
        if (output.operation !== "application-source.generate") {
          throw new Error("Unexpected operation.");
        }
        output.candidateBundle.dependencies.push(
          modelDependencyRequestV1Schema.parse({
            approvalPathId: "cloudmarkup.dependency-review.v1",
            ecosystem: "package.npm",
            kind: "package",
            name: "approved-test-package",
            reason: "Exercise exact replay approval authority.",
            requestedVersion: "1.0.0",
            reviewState: "requested",
          }),
        );
        return {
          ...successfulProviderResult(invocation),
          content: responseToolContent(invocation, output),
        };
      },
    ]);
    const approved = createHarness({
      adapter: approvedAdapter,
      invocationStore,
    });
    const request = requestFor("application-source.generate");
    const context = modelTestContext("invocation_approval_authority_replay");
    await approved.gateway.invoke(request, context);

    const deniedAdapter = new ScriptedFakeModelAdapter([
      successfulProviderResult,
    ]);
    const denied = createHarness({
      adapter: deniedAdapter,
      allowedApprovalPathIds: [],
      invocationStore,
    });
    await expectGatewayCode(
      denied.gateway.invoke(request, context),
      "model-gateway.invocation-conflict",
    );
    expect(deniedAdapter.invocations).toHaveLength(0);
    expect(denied.usageRecorder.records).toHaveLength(0);
  });

  it("enforces generated path ownership and allow-listed dependency review", async () => {
    const outsidePath = createHarness({
      adapter: new ScriptedFakeModelAdapter([
        (invocation) => {
          const output = deterministicFakeResponseV1(invocation);
          if (output.operation !== "application-source.generate") {
            throw new Error("Unexpected operation.");
          }
          const candidate = output.candidateBundle.candidates[0];
          if (candidate === undefined) throw new Error("Missing candidate.");
          candidate.path = "user-owned/handler.ts";
          return {
            ...successfulProviderResult(invocation),
            content: responseToolContent(invocation, output),
          };
        },
      ]),
    });
    await expectGatewayCode(
      outsidePath.gateway.invoke(
        requestFor("application-source.generate"),
        modelTestContext("invocation_unowned_path"),
      ),
      "model-gateway.path-not-owned",
    );

    const dependencyDenied = createHarness({
      adapter: new ScriptedFakeModelAdapter([
        (invocation) => {
          const output = deterministicFakeResponseV1(invocation);
          if (output.operation !== "application-source.generate") {
            throw new Error("Unexpected operation.");
          }
          output.candidateBundle.dependencies.push(
            modelDependencyRequestV1Schema.parse({
              approvalPathId: "cloudmarkup.unreviewed-dependency-path",
              ecosystem: "package.npm",
              kind: "package",
              name: "unreviewed-package",
              reason: "Exercise the approval-path denial.",
              requestedVersion: "1.0.0",
              reviewState: "requested",
            }),
          );
          return {
            ...successfulProviderResult(invocation),
            content: responseToolContent(invocation, output),
          };
        },
      ]),
    });
    await expectGatewayCode(
      dependencyDenied.gateway.invoke(
        requestFor("application-source.generate"),
        modelTestContext("invocation_dependency_denied"),
      ),
      "model-gateway.dependency-approval-path-denied",
    );

    expect(testCandidateBoundary.writeAuthority).toBe(
      "candidate-artifacts-only",
    );
  });

  it("exposes no arbitrary tool authority", () => {
    expect(() => {
      assertNoModelTools({ tools: [{ name: "shell" }] });
    }).toThrow(
      expect.objectContaining({ code: "model-gateway.tool-authority-denied" }),
    );
    expect(() => {
      assertNoModelTools({
        descriptor: { toolAuthority: "none" },
        request: { operation: "summary.technical" },
      });
    }).not.toThrow();
  });

  it("keeps safe errors free of raw provider output and provider failures", async () => {
    const rawSecret = "token=must-never-appear-in-error";
    const harness = createHarness({
      adapter: new ScriptedFakeModelAdapter([
        {
          content: {
            input: { rawSecret },
            kind: "tool-use",
            toolName: getModelResponseToolV1("summary.technical").toolName,
          },
          usage: {
            cacheReadUnits: "0",
            cacheWriteUnits: "0",
            inputUnits: "1",
            outputUnits: "1",
            thinkingUnits: "0",
          },
        },
      ]),
    });
    let caught: unknown;
    try {
      await harness.gateway.invoke(
        requestFor("summary.technical"),
        modelTestContext("invocation_safe_error"),
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ModelGatewayError);
    expect(JSON.stringify(caught)).not.toContain(rawSecret);
    expect(JSON.stringify(harness.logger.events)).not.toContain(rawSecret);

    const rawProviderDetail =
      "provider-body token=must-never-escape-the-adapter";
    const unknownProviderCode = "provider-secret-code";
    const providerFailure = createHarness({
      adapter: new ScriptedFakeModelAdapter([
        new ModelProviderInvocationError({
          classification: "permanent",
          safeCode: unknownProviderCode,
          safeMessage: rawProviderDetail,
          usage: {
            cacheReadUnits: "0",
            cacheWriteUnits: "0",
            inputUnits: "5",
            outputUnits: "0",
            providerRequestId: "provider_safe_failure",
            thinkingUnits: "0",
          },
        }),
      ]),
    });
    let providerCaught: unknown;
    try {
      await providerFailure.gateway.invoke(
        requestFor("summary.technical"),
        modelTestContext("invocation_safe_provider_error"),
      );
    } catch (error) {
      providerCaught = error;
    }
    expect(providerCaught).toMatchObject({
      code: "model-provider.permanent",
      message: "The model provider permanently rejected the invocation.",
    });
    expect(providerFailure.usageRecorder.records).toMatchObject([
      { providerRequestId: "provider_safe_failure", result: "provider-error" },
    ]);
    expect(
      providerFailure.logger.events.some(
        (event) => event.safeCode === "model-provider.permanent",
      ),
    ).toBe(true);
    const serializedProviderFailure = JSON.stringify({
      error: providerCaught,
      logger: providerFailure.logger.events,
      store: providerFailure.invocationStore,
    });
    expect(serializedProviderFailure).not.toContain(rawProviderDetail);
    expect(serializedProviderFailure).not.toContain(unknownProviderCode);
  });
});
