import { describe, expect, it, vi } from "vitest";
import {
  modelLiveEvaluationPlanV2Schema,
  modelEvaluationAuthorityTupleV1Schema,
  namespacedIdentifierSchema,
  semanticVersionSchema,
  type ModelLiveEvaluationPlanV2,
} from "@cloudmarkup/schemas";
import {
  bedrockModelCapabilityRegistryV1,
  prepareModelLiveRoutingDecisionV2,
  createModelLiveRoutingDecisionEvaluatorV2,
  selectModelRoutingDecisionV1,
} from "./bedrock-routing.js";
import {
  reviewedBedrockLiveEvaluationConfigurationV2Schema,
  prepareBedrockLiveEvaluationConfigurationV2,
} from "./bedrock-configuration.js";
import { syntheticLiveEvaluationFixtureV2 } from "./model-live-evaluation-fakes.js";
import {
  modelTestContext,
  modelTestRequests,
  modelTestRoutingRequest,
} from "./test-helpers.js";
import { digestStructuredValue } from "./security.js";
import {
  createModelLiveEvaluationGatewayV2,
  projectModelLiveGatewayClaimV2,
  ProviderNeutralModelGateway,
} from "./gateway.js";
import { modelRoutingConfigurationV1Schema } from "./routing.js";
import {
  CollectingModelUsageRecorder,
  CollectingSafeModelLogger,
  InMemoryModelInvocationStore,
  deterministicFakeResponseV1,
} from "./fakes.js";
import { InMemoryRestrictedInvalidSolutionProposalStoreV1 } from "./solution-planner.js";
import {
  ModelProviderInvocationError,
  type ModelProviderInvocationV1,
} from "./ports.js";

function rehashPlan(plan: ModelLiveEvaluationPlanV2) {
  const { policyDigest: _policy, ...policy } = plan.definition.policy;
  const { definitionDigest: _definition, ...definition } = plan.definition;
  const { approvalDigest: _approval, ...approval } = plan.approval;
  const { planDigest: _plan, ...metadata } = plan;
  void _policy;
  void _definition;
  void _approval;
  void _plan;
  definition.policy = {
    ...policy,
    policyDigest: digestStructuredValue(policy),
  };
  metadata.definition = {
    ...definition,
    definitionDigest: digestStructuredValue(definition),
  };
  approval.definitionDigest = metadata.definition.definitionDigest;
  metadata.approval = {
    ...approval,
    approvalDigest: digestStructuredValue(approval),
  };
  return modelLiveEvaluationPlanV2Schema.parse({
    ...metadata,
    planDigest: digestStructuredValue(metadata),
  });
}

/** All receipts and provider metadata are synthetic, never live approval. */
function fixture(deep = false) {
  const original = syntheticLiveEvaluationFixtureV2();
  const plan = structuredClone(original.plan);
  const role = deep
    ? "deep-architecture-custom-generation"
    : "standard-planning-generation";
  const binding = plan.definition.cases.find(
    (c) => c.authorityBinding.authorityTuple.role === role,
  );
  if (!binding) throw Error("Missing synthetic role.");
  const request = modelTestRequests().find(
    (r) => r.operation === binding.authorityBinding.authorityTuple.operation,
  );
  if (!request) throw Error("Missing synthetic operation.");
  const requirement = plan.definition.policy.evaluationRequirement;
  const configuration =
    reviewedBedrockLiveEvaluationConfigurationV2Schema.parse({
      contractVersion: 2,
      executionClass: "live-evaluation",
      recordKind: "bedrock-live-evaluation-configuration",
      capabilityRegistryVersion: "2.0.0",
      routeRegistryVersion: "2.0.0",
      routes: bedrockModelCapabilityRegistryV1.capabilities.map((c, index) => ({
        approvedModelClass: index === 0 ? "sonnet" : "opus",
        route: index === 0 ? "standard" : "deep",
        selectedRegion: "us-east-1",
        supportedRegions: ["us-east-1"],
        transport: "converse",
        effectiveFrom: "2026-09-01T00:00:00.000Z",
        effectiveUntil: "2026-10-01T00:00:00.000Z",
        retentionPolicy: "application-content-not-retained",
        capability: {
          ...c,
          modelId:
            index === 0
              ? "anthropic.claude-sonnet-4-6"
              : "anthropic.claude-opus-4-6",
          inferenceProfileId:
            index === 0
              ? "global.anthropic.claude-sonnet-4-6"
              : "global.anthropic.claude-opus-4-6",
          lifecycleState: "candidate",
          nativeStructuredOutputSupported: false,
          enabledEnvironments: ["development"],
          maximumOutputTokens: 64000,
          evaluation: {
            ...c.evaluation,
            evaluationPolicyId: requirement.evaluationPolicyId,
            evaluationPolicyVersion: requirement.evaluationPolicyVersion,
            passed: false,
            scoreBasisPoints: 0,
          },
        },
      })),
    });
  const prepared = prepareBedrockLiveEvaluationConfigurationV2({
    configuration,
    asOf: original.now,
  });
  const capability = prepared.capabilityRegistry.capabilities[deep ? 1 : 0];
  const routeId = deep ? "deep-design" : "standard-design";
  const route = prepared.routeRegistry.routes.find(
    (r) => r.routeId === routeId,
  );
  if (!capability || !route) throw Error("Missing synthetic route.");
  const context = {
    ...modelTestContext("live_routing_synthetic"),
    evaluationPolicyId: requirement.evaluationPolicyId,
    evaluationPolicyVersion: requirement.evaluationPolicyVersion,
    requestedMode: request.requestedMode,
    scope: {
      ...modelTestContext("live_routing_synthetic").scope,
      organizationId: plan.definition.scope.organizationId,
      projectId: plan.definition.scope.projectId,
      userId: plan.definition.scope.userId,
    },
  };
  const routingRequest = modelTestRoutingRequest(request, context, {
    environment: plan.definition.scope.environment,
    selectedPreference: routeId,
  });
  const tuple = modelEvaluationAuthorityTupleV1Schema.parse({
    ...binding.authorityBinding.authorityTuple,
    capabilityRegistryDigest: digestStructuredValue(
      prepared.capabilityRegistry,
    ),
    routeRegistryDigest: digestStructuredValue(prepared.routeRegistry),
    routeDefinitionDigest: digestStructuredValue(route),
    modelConfigurationReference: capability.modelConfigurationReference,
    inferenceProfileId: capability.inferenceProfileId,
  });
  binding.routeId = routeId;
  binding.invocationInputDigest = routingRequest.inputDigest;
  binding.authorityBinding = {
    authorityTuple: tuple,
    authorityTupleDigest: digestStructuredValue(tuple),
  };
  plan.definition.policy.allowlists.modelConfigurationReferences.push(
    capability.modelConfigurationReference,
  );
  if (deep) plan.definition.policy.allowlists.routes.push("deep-design");
  const routing = modelRoutingConfigurationV1Schema.parse({
    allowFallback: false,
    configurationId: prepared.routeRegistry.routeRegistryId,
    configurationVersion: prepared.routeRegistry.routeRegistryVersion,
    routes: prepared.capabilityRegistry.capabilities.flatMap((c) =>
      c.roles.map((role) => ({
        role,
        candidates: [
          {
            providerId: c.providerId,
            modelId: c.modelId,
            inferenceProfileId: c.inferenceProfileId,
            priority: 0,
          },
        ],
      })),
    ),
  });
  return {
    host: { context, request, profile: prepared.profile, routing },
    capabilityRegistry: prepared.capabilityRegistry,
    routeRegistry: prepared.routeRegistry,
    plan: rehashPlan(plan),
    caseId: binding.caseId,
    observedAt: original.now,
    request: routingRequest,
    routingConfigurationDigest: digestStructuredValue(routing),
    maximumOutputTokens: 4000,
    timeoutMilliseconds: 10000,
  };
}

describe("pure candidate live routing preparation", () => {
  it.each([false, true])(
    "prepares exact 4.6 route deep=%s without fabricating evaluation or normal activation",
    (deep) => {
      const input = fixture(deep),
        before = structuredClone(input);
      const decision = prepareModelLiveRoutingDecisionV2(input);
      expect(decision).toMatchObject({
        outcome: "selected",
        maximumAttempts: 1,
        automaticEscalationPermitted: false,
        maximumOutputTokens: 4000,
        timeoutMilliseconds: 10000,
        routeId: deep ? "deep-design" : "standard-design",
        modelId: deep
          ? "anthropic.claude-opus-4-6"
          : "anthropic.claude-sonnet-4-6",
        promptCachePolicy: {
          enabled: false,
          cacheKeyRequired: false,
          maximumCheckpoints: 0,
          minimumCheckpointTokens: 0,
        },
      });
      const evaluator = createModelLiveRoutingDecisionEvaluatorV2(input);
      const evaluated = evaluator.evaluate({
        request: input.request,
        routingConfigurationDigest: input.routingConfigurationDigest,
      });
      expect(evaluated.decision).toEqual(decision);
      expect(evaluated.capability.evaluation).toMatchObject({
        passed: false,
        scoreBasisPoints: 0,
      });
      expect(decision.evaluationResultDigest).toBe(
        evaluated.capability.evaluation.resultDigest,
      );
      const normal = selectModelRoutingDecisionV1(input);
      expect(normal.outcome).toBe("denied");
      expect(normal.reasonCodes).toContain("evaluation-failed");
      expect(input).toEqual(before);
    },
  );
  it.each([
    "scope",
    "input",
    "case",
    "route",
    "policy",
    "registry",
    "before",
    "expiry",
    "output-cap",
    "output-fraction",
    "timeout-cap",
    "timeout-expiry",
    "production",
  ] as const)("rejects mismatched %s binding", (kind) => {
    const input = fixture();
    if (kind === "scope") input.request.principalId = "foreign_user";
    if (kind === "input")
      input.request.inputDigest = digestStructuredValue("different");
    if (kind === "case") input.caseId = "unknown_case";
    if (kind === "route") input.request.selectedPreference = "deep-design";
    if (kind === "policy")
      input.request.requiredEvaluationPolicyVersion =
        semanticVersionSchema.parse("9.0.0");
    if (kind === "registry")
      input.capabilityRegistry.registryVersion =
        semanticVersionSchema.parse("9.0.0");
    if (kind === "before")
      input.observedAt = new Date(
        Date.parse(input.plan.issuedAt) - 1,
      ).toISOString();
    if (kind === "expiry") input.observedAt = input.plan.expiresAt;
    if (kind === "output-cap")
      input.maximumOutputTokens =
        input.plan.definition.policy.limits.maximumOutputTokens + 1;
    if (kind === "output-fraction") input.maximumOutputTokens = 1.5;
    if (kind === "timeout-cap") {
      const capability = input.capabilityRegistry.capabilities[0];
      if (capability === undefined)
        throw Error("Missing synthetic capability.");
      input.timeoutMilliseconds = capability.timeoutMilliseconds + 1;
      expect(input.timeoutMilliseconds).toBeLessThan(
        Date.parse(input.plan.expiresAt) - Date.parse(input.observedAt),
      );
    }
    if (kind === "timeout-expiry")
      input.observedAt = new Date(
        Date.parse(input.plan.expiresAt) - 1,
      ).toISOString();
    if (kind === "production") input.request.environment = "production";
    expect(() => prepareModelLiveRoutingDecisionV2(input)).toThrow();
  });
  it.each(["global", "feature", "suspended"] as const)(
    "rejects %s withdrawn policy",
    (kind) => {
      const input = fixture();
      if (kind === "global")
        input.plan.definition.policy.killSwitches.global = {
          engaged: true,
          reasonCode: namespacedIdentifierSchema.parse("synthetic.withdrawn"),
        };
      if (kind === "feature")
        input.plan.definition.policy.killSwitches.capabilitySwitches.push({
          operation: input.request.feature,
          engaged: true,
          reasonCode: namespacedIdentifierSchema.parse("synthetic.withdrawn"),
        });
      if (kind === "suspended")
        input.plan.definition.policy.administrativeSuspensions.push({
          scope: "user",
          scopeId: input.request.principalId,
          reasonCode: namespacedIdentifierSchema.parse(
            "synthetic.operator-suspended",
          ),
        });
      input.plan = rehashPlan(input.plan);
      expect(() => prepareModelLiveRoutingDecisionV2(input)).toThrow();
    },
  );
  it.each(["credits", "confirmation", "context"] as const)(
    "retains ordinary %s denial",
    (kind) => {
      const input = fixture(kind === "confirmation");
      if (kind === "credits") input.request.creditAuthorization.allowed = false;
      if (kind === "confirmation") {
        input.request.creditAuthorization.estimateAccepted = false;
        delete input.request.creditAuthorization
          .acceptedEstimateMaximumCreditUnits;
      }
      if (kind === "context") {
        input.request.estimatedContextTokens = 999999;
        input.plan.definition.limits.maximumInputTokens = 1000000;
        input.plan.definition.limits.maximumTotalTokens = 1100000;
        input.plan = rehashPlan(input.plan);
      }
      expect(prepareModelLiveRoutingDecisionV2(input).outcome).toBe("denied");
    },
  );
  it("binds the pure evaluator to detached metadata and rejects request or routing drift", () => {
    const input = fixture(),
      request = structuredClone(input.request);
    const evaluator = createModelLiveRoutingDecisionEvaluatorV2(input);
    input.plan.definition.policy.killSwitches.global.engaged = true;
    input.request.nodeCount++;
    expect(() =>
      evaluator.evaluate({
        request: input.request,
        routingConfigurationDigest: input.routingConfigurationDigest,
      }),
    ).toThrow();
    expect(() =>
      evaluator.evaluate({
        request,
        routingConfigurationDigest: digestStructuredValue("other"),
      }),
    ).toThrow();
    const evaluated = evaluator.evaluate({
      request,
      routingConfigurationDigest: input.routingConfigurationDigest,
    });
    expect(evaluated.decision.outcome).toBe("selected");
    // Even a matching pure result is not a durable approval or dispatch permit.
    Reflect.set(evaluated.capability.evaluation, "passed", true);
    expect(
      evaluator.evaluate({
        request,
        routingConfigurationDigest: input.routingConfigurationDigest,
      }).capability.evaluation.passed,
    ).toBe(false);
  });
});

function gatewayFixture(deep = false) {
  const { host, ...preparation } = fixture(deep);
  const context = {
    ...host.context,
    routingRequest: preparation.request,
    routingDecision: prepareModelLiveRoutingDecisionV2(preparation),
  };
  const state = {
    revoked: false,
    revokeAtDispatch: false,
    driftAtDispatch: false,
    transient: false,
    invalid: false,
  };
  const sent: ModelProviderInvocationV1[] = [];
  const phases: string[] = [];
  const usageRecorder = new CollectingModelUsageRecorder();
  const invocationStore = new InMemoryModelInvocationStore();
  const claim = vi.spyOn(invocationStore, "claim");
  const complete = vi.spyOn(invocationStore, "complete");
  const fail = vi.spyOn(invocationStore, "fail");
  const shared = {
    adapters: [
      {
        profile: host.profile,
        invoke: (invocation: ModelProviderInvocationV1) => {
          sent.push(structuredClone(invocation));
          const usage = {
            inputUnits: "20",
            outputUnits: "10",
            cacheReadUnits: "0",
            cacheWriteUnits: "0",
            thinkingUnits: "3",
            providerRequestId: "synthetic_provider",
          };
          if (state.transient)
            throw new ModelProviderInvocationError({
              classification: "transient",
              safeCode: "model-provider.transient",
              safeMessage: "Synthetic transient failure.",
              usage,
            });
          return Promise.resolve({
            content: {
              kind: "tool-use" as const,
              input: state.invalid
                ? { notAResponse: true }
                : deterministicFakeResponseV1(invocation),
              toolName: invocation.responseTool.toolName,
            },
            usage,
          });
        },
      },
    ],
    allowedApprovalPathIds: ["cloudmarkup.dependency-review.v1"],
    invocationStore,
    usageRecorder,
    invalidProposalStore:
      new InMemoryRestrictedInvalidSolutionProposalStoreV1(),
    logger: new CollectingSafeModelLogger(),
    routing: host.routing,
    routeRegistry: preparation.routeRegistry,
  };
  const gateway = createModelLiveEvaluationGatewayV2({
    ...shared,
    liveAuthority: {
      authorize: (input) => {
        phases.push(input.phase);
        if (
          state.revoked ||
          (state.revokeAtDispatch && input.phase === "dispatch")
        )
          throw Error("Synthetic withdrawn authority.");
        expect(input.request).toEqual(host.request);
        expect(input.context).toEqual(context);
        if (input.phase === "dispatch") {
          expect(
            input.invocation.descriptor.routing?.routingDecisionDigest,
          ).toBe(digestStructuredValue(context.routingDecision));
          expect(input.invocation.maximumOutputTokens).toBe(
            preparation.maximumOutputTokens,
          );
        }
        return Promise.resolve({
          ...structuredClone(preparation),
          observedAt:
            input.phase === "dispatch"
              ? new Date(
                  Date.parse(preparation.observedAt) + 1000,
                ).toISOString()
              : preparation.observedAt,
          maximumOutputTokens:
            state.driftAtDispatch && input.phase === "dispatch"
              ? 4001
              : preparation.maximumOutputTokens,
        });
      },
    },
  });
  return {
    gateway,
    state,
    sent,
    phases,
    usageRecorder,
    claim,
    complete,
    fail,
    shared,
    preparation,
    request: host.request,
    context,
  };
}

describe("explicit live gateway using the shared invocation engine", () => {
  it.each([false, true])(
    "preserves journal, exact descriptor and usage for candidate deep=%s",
    async (deep) => {
      const h = gatewayFixture(deep);
      const result = await h.gateway.invoke(h.request, h.context);
      expect(result.response.operation).toBe(h.request.operation);
      expect(h.sent).toHaveLength(1);
      expect(h.sent[0]?.descriptor.routing?.evaluationResultDigest).toBe(
        h.context.routingDecision.evaluationResultDigest,
      );
      expect(h.phases).toEqual(["invoke", "dispatch"]);
      expect(h.claim).toHaveBeenCalledTimes(1);
      expect(h.complete).toHaveBeenCalledTimes(1);
      expect(h.usageRecorder.records).toHaveLength(1);
      expect(h.usageRecorder.records[0]).toMatchObject({
        result: "succeeded",
        outputUnits: "10",
        attemptNumber: 1,
      });
      expect(await h.gateway.invoke(h.request, h.context)).toEqual(result);
      expect(h.sent).toHaveLength(1);
      h.state.revoked = true;
      await expect(
        h.gateway.invoke(h.request, h.context),
      ).rejects.toMatchObject({
        code: "model-gateway.live-authority-required",
      });
      expect(h.sent).toHaveLength(1);
    },
  );
  it.each(["invoke", "dispatch", "drift"] as const)(
    "stops %s authority failure before provider work",
    async (phase) => {
      const h = gatewayFixture();
      h.state.revoked = phase === "invoke";
      h.state.revokeAtDispatch = phase === "dispatch";
      h.state.driftAtDispatch = phase === "drift";
      await expect(
        h.gateway.invoke(h.request, h.context),
      ).rejects.toMatchObject({
        code: "model-gateway.live-authority-required",
      });
      expect(h.sent).toHaveLength(0);
      expect(h.usageRecorder.records).toHaveLength(0);
      expect(h.claim).toHaveBeenCalledTimes(phase === "invoke" ? 0 : 1);
      expect(h.fail).toHaveBeenCalledTimes(phase === "invoke" ? 0 : 1);
    },
  );
  it("cannot activate a candidate in normal V1 even with a supplied live pure evaluator", async () => {
    const h = gatewayFixture();
    const normal = new ProviderNeutralModelGateway({
      ...h.shared,
      routingDecisionEvaluator: createModelLiveRoutingDecisionEvaluatorV2(
        h.preparation,
      ),
    });
    await expect(normal.invoke(h.request, h.context)).rejects.toMatchObject({
      code: "model-gateway.no-evaluated-route",
    });
    expect(h.sent).toHaveLength(0);
  });
  it("retains one exact billable provider attempt when a transient error occurs", async () => {
    const h = gatewayFixture();
    h.state.transient = true;
    await expect(h.gateway.invoke(h.request, h.context)).rejects.toThrow();
    expect(h.sent).toHaveLength(1);
    expect(h.usageRecorder.records).toHaveLength(1);
    expect(h.usageRecorder.records[0]).toMatchObject({
      result: "provider-error",
      attemptNumber: 1,
      outputUnits: "10",
    });
    expect(h.complete).not.toHaveBeenCalled();
    expect(h.fail).toHaveBeenCalledTimes(1);
  });
  it("retains strict generated response validation and failure journaling", async () => {
    const h = gatewayFixture();
    h.state.invalid = true;
    await expect(h.gateway.invoke(h.request, h.context)).rejects.toThrow();
    expect(h.sent).toHaveLength(1);
    expect(h.complete).not.toHaveBeenCalled();
    expect(h.fail).toHaveBeenCalledTimes(1);
  });
  it("requires exact prepared decisions and cannot enter through the fake default", async () => {
    const h = gatewayFixture();
    const { routingDecision, routingRequest, ...unrouted } = h.context;
    void routingDecision;
    void routingRequest;
    await expect(h.gateway.invoke(h.request, unrouted)).rejects.toMatchObject({
      code: "model-gateway.live-authority-required",
    });
    expect(h.claim).not.toHaveBeenCalled();
    expect(h.sent).toHaveLength(0);
    h.context.routingDecision.maximumOutputTokens++;
    await expect(h.gateway.invoke(h.request, h.context)).rejects.toMatchObject({
      code: "model-gateway.routing-decision-mismatch",
    });
    expect(h.claim).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "projects the exact real shared gateway claim for deep=%s without side effects",
    async (deep) => {
      const h = gatewayFixture(deep);
      const projectionInput = {
        preparation: h.preparation,
        request: h.request,
        context: h.context,
        adapterProfiles: h.shared.adapters.map((adapter) => adapter.profile),
        allowedApprovalPathIds: h.shared.allowedApprovalPathIds,
        routing: h.shared.routing,
      };
      const projected = projectModelLiveGatewayClaimV2(projectionInput);
      expect(h.claim).not.toHaveBeenCalled();
      expect(h.sent).toEqual([]);
      expect(
        projectModelLiveGatewayClaimV2({
          ...projectionInput,
          preparation: {
            ...h.preparation,
            observedAt: new Date(
              Date.parse(h.preparation.observedAt) + 1000,
            ).toISOString(),
          },
        }),
      ).toEqual(projected);
      await h.gateway.invoke(h.request, h.context);
      expect(h.claim).toHaveBeenCalledExactlyOnceWith(projected);
      expect(h.complete.mock.calls[0]?.[0]).toEqual(projected);
      expect(projected.escalation).toBeUndefined();
    },
  );
  it("binds projected live claims to exact adapter and approval-path metadata", () => {
    const h = gatewayFixture();
    const input = {
      preparation: h.preparation,
      request: h.request,
      context: h.context,
      adapterProfiles: h.shared.adapters.map((adapter) => adapter.profile),
      allowedApprovalPathIds: h.shared.allowedApprovalPathIds,
      routing: h.shared.routing,
    };
    const original = projectModelLiveGatewayClaimV2(input);
    expect(
      projectModelLiveGatewayClaimV2({
        ...input,
        allowedApprovalPathIds: [
          ...input.allowedApprovalPathIds,
          ...input.allowedApprovalPathIds,
        ],
      }),
    ).toEqual(original);
    expect(
      projectModelLiveGatewayClaimV2({ ...input, allowedApprovalPathIds: [] })
        .authorityDigest,
    ).not.toBe(original.authorityDigest);
    expect(
      projectModelLiveGatewayClaimV2({
        ...input,
        adapterProfiles: input.adapterProfiles.map((profile) => ({
          ...profile,
          profileVersion: "2",
        })),
      }).authorityDigest,
    ).not.toBe(original.authorityDigest);
    expect(h.claim).not.toHaveBeenCalled();
    expect(h.sent).toEqual([]);
  });
  it.each([
    "context",
    "request",
    "routing",
    "decision",
    "preparation",
  ] as const)(
    "rejects contradictory %s during pure live claim projection",
    (kind) => {
      const h = gatewayFixture();
      const input = structuredClone({
        preparation: h.preparation,
        request: h.request,
        context: h.context,
        adapterProfiles: h.shared.adapters.map((adapter) => adapter.profile),
        allowedApprovalPathIds: h.shared.allowedApprovalPathIds,
        routing: h.shared.routing,
      });
      if (kind === "context") input.context.scope.userId = "another_user";
      if (kind === "request")
        input.request.requestedMode =
          input.request.requestedMode === "guided" ? "professional" : "guided";
      if (kind === "routing") input.routing.allowFallback = true;
      if (kind === "decision")
        input.context.routingDecision.maximumOutputTokens++;
      if (kind === "preparation") input.preparation.caseId = "absent_case";
      expect(() => projectModelLiveGatewayClaimV2(input)).toThrow();
      expect(h.claim).not.toHaveBeenCalled();
      expect(h.sent).toEqual([]);
    },
  );
});
