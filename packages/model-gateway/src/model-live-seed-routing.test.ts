import { describe, expect, it } from "vitest";
import {
  semanticVersionSchema,
  modelCapabilityRegistryV1Schema,
  modelRouteRegistryV1Schema,
  modelEvaluationAuthorityTupleV1Schema,
  modelLiveSequenceDefinitionV3Schema,
  modelLiveSequenceApprovalV3Schema,
  modelLiveSequencePlanV3Schema,
  modelLiveSequenceSelectionV3Schema,
  modelLiveSequenceInputV3Schema,
  modelRoutingRequestV1Schema,
  modelLiveRuntimeControlPolicyV2Schema,
} from "@cloudmarkup/schemas";
import { digestStructuredValue as digest } from "./security.js";
import { syntheticSeedRuntimeFixtureV3 } from "./model-live-seed-runtime-test-helpers.js";
import { rehashSequenceTest as rehash } from "./model-live-sequence-test-helpers.js";
import {
  bedrockModelCapabilityRegistryV1,
  bedrockModelRouteRegistryV1,
  prepareModelLiveSeedRoutingDecisionV3,
  type ModelLiveSeedRoutingPreparationInputV3,
} from "./bedrock-routing.js";

/** Configured candidate metadata only; no current host, model or approval fact. */
function fixture(): ModelLiveSeedRoutingPreparationInputV3 {
  const base = syntheticSeedRuntimeFixtureV3().input;
  const requirement = base.plan.definition.policy.evaluationRequirement;
  const capabilityRegistry = modelCapabilityRegistryV1Schema.parse({
    ...bedrockModelCapabilityRegistryV1,
    capabilities: bedrockModelCapabilityRegistryV1.capabilities.map((c) => ({
      ...c,
      enabledEnvironments: ["development"],
      evaluation: {
        ...c.evaluation,
        evaluationPolicyId: requirement.evaluationPolicyId,
        evaluationPolicyVersion: requirement.evaluationPolicyVersion,
      },
    })),
  });
  const routeRegistry = modelRouteRegistryV1Schema.parse({
    ...bedrockModelRouteRegistryV1,
    capabilityRegistryDigest: digest(capabilityRegistry),
    routes: bedrockModelRouteRegistryV1.routes.map((r) => ({
      ...r,
      enabled: true,
    })),
  });
  const route = routeRegistry.routes.find(
    (r) => r.routeId === "internal-escalation",
  );
  const capability = capabilityRegistry.capabilities.find(
    (c) => c.modelConfigurationReference === route?.modelConfigurationReference,
  );
  if (!route || !capability)
    throw Error("Missing configured synthetic repair route");
  const policy = modelLiveRuntimeControlPolicyV2Schema.parse(
    rehash(
      {
        ...base.plan.definition.policy,
        allowlists: {
          ...base.plan.definition.policy.allowlists,
          modelConfigurationReferences: [
            capability.modelConfigurationReference,
          ],
        },
      },
      "policyDigest",
    ),
  );
  const definition = modelLiveSequenceDefinitionV3Schema.parse(
    rehash(
      {
        ...base.plan.definition,
        policy,
        cases: base.plan.definition.cases.map((entry) => {
          const tuple = modelEvaluationAuthorityTupleV1Schema.parse({
            ...entry.authorityBinding.authorityTuple,
            capabilityRegistryDigest: digest(capabilityRegistry),
            routeRegistryDigest: digest(routeRegistry),
            routeDefinitionDigest: digest(route),
            modelConfigurationReference: capability.modelConfigurationReference,
            inferenceProfileId: capability.inferenceProfileId,
          });
          return {
            ...entry,
            authorityBinding: {
              authorityTuple: tuple,
              authorityTupleDigest: digest(tuple),
            },
          };
        }),
      },
      "definitionDigest",
    ),
  );
  const approval = modelLiveSequenceApprovalV3Schema.parse(
    rehash(
      {
        ...base.plan.approval,
        definitionDigest: definition.definitionDigest,
      },
      "approvalDigest",
    ),
  );
  const plan = modelLiveSequencePlanV3Schema.parse(
    rehash({ ...base.plan, definition, approval }, "planDigest"),
  );
  const selection = modelLiveSequenceSelectionV3Schema.parse(
    rehash(
      {
        ...base.selection,
        planDigest: plan.planDigest,
        approvalDigest: approval.approvalDigest,
      },
      "selectionDigest",
    ),
  );
  const entry = definition.cases.find(
    (c) => c.caseId === base.stageInput.caseId,
  );
  if (!entry) throw Error("Missing synthetic seed case");
  const stageInput = modelLiveSequenceInputV3Schema.parse(
    rehash(
      {
        ...base.stageInput,
        planDigest: plan.planDigest,
        selectionDigest: selection.selectionDigest,
        authorityTupleDigest: entry.authorityBinding.authorityTupleDigest,
      },
      "inputBindingDigest",
    ),
  );
  const request = modelRoutingRequestV1Schema.parse({
    ...base.routingRequest,
    inputDigest: stageInput.operationInputDigest,
    estimatedContextTokens: 100,
  });
  return {
    plan,
    selection,
    stageInput,
    request,
    capabilityRegistry,
    routeRegistry,
    routingConfigurationDigest: digest("configured synthetic routing"),
    observedAt: stageInput.issuedAt,
    maximumOutputTokens: 1000,
    timeoutMilliseconds: 1000,
  };
}
describe("current-registry first-seed routing preparation", () => {
  it("selects the configured repair route from exact issued lineage without a prior model invocation", () => {
    const input = fixture();
    const route = prepareModelLiveSeedRoutingDecisionV3(input);
    expect(route).toMatchObject({
      contractVersion: 3,
      recordKind: "model-live-seed-routing-decision",
      outcome: "selected",
      routeId: "internal-escalation",
      maximumAttempts: 1,
      seedInputBindingDigest: input.stageInput.inputBindingDigest,
      maximumOutputTokens: 1000,
      timeoutMilliseconds: 1000,
      automaticEscalationPermitted: false,
      promptCachePolicy: { enabled: false },
    });
    expect(route).not.toHaveProperty("escalation");
    expect(route).not.toHaveProperty("evaluationResultDigest");
    expect(route).not.toHaveProperty("evaluationResultVersion");
    expect(input.request).not.toHaveProperty("priorAttempt");
  });
  it.each([
    "tenant",
    "principal",
    "input",
    "early",
    "expired",
    "output",
    "timeout",
    "capability",
    "route",
    "selection",
    "prior-attempt",
    "xhigh",
  ] as const)("rejects altered %s authority", (kind) => {
    const input = fixture();
    if (kind === "tenant") input.request.organizationId = "other_org";
    if (kind === "principal") input.request.principalId = "other_principal";
    if (kind === "input") input.request.inputDigest = digest("other input");
    if (kind === "early")
      Object.assign(input, { observedAt: input.plan.issuedAt });
    if (kind === "expired")
      Object.assign(input, { observedAt: input.plan.expiresAt });
    if (kind === "output")
      Object.assign(input, { maximumOutputTokens: 99999999 });
    if (kind === "timeout")
      Object.assign(input, { timeoutMilliseconds: 99999999 });
    if (kind === "capability")
      input.capabilityRegistry.registryVersion =
        semanticVersionSchema.parse("2.0.0");
    if (kind === "route")
      input.routeRegistry.routeRegistryVersion =
        semanticVersionSchema.parse("2.0.0");
    if (kind === "selection")
      Object.assign(input, {
        selection: {
          ...input.selection,
          selectionDigest: digest("other selection"),
        },
      });
    if (kind === "prior-attempt")
      Object.assign(input.request, {
        currentValidationState: "failed-build",
        priorAttempt: {
          diagnosticsDigest: digest("synthetic diagnostics"),
          escalationCount: 0,
          originalAcceptedEstimateMaximumCreditUnits: 40,
          originalCreditAuthorizationDecisionId: "synthetic_credit",
          originalInvocationId: "synthetic_prior_invocation",
          originalRoutingDecisionDigest: digest("synthetic prior route"),
          result: "build-failure",
          routeId: "standard-design",
        },
      });
    if (kind === "xhigh")
      Object.assign(input.request, {
        xhighEffortAuthorization: {
          classification: "difficult-repair",
          decisionId: "synthetic_effort",
          policyId: "cloudmarkup.model-effort.difficult.v1",
          policyVersion: "1.0.0",
        },
      });
    // Negative prior-attempt/effort cases are valid request data. They fail the
    // seed-specific boundary rather than malformed-schema parsing.
    modelRoutingRequestV1Schema.parse(input.request);
    expect(() => prepareModelLiveSeedRoutingDecisionV3(input)).toThrow();
  });
  it("requires an accepted estimate for the first repair", () => {
    const input = fixture();
    input.request.creditAuthorization.estimateAccepted = false;
    delete input.request.creditAuthorization.acceptedEstimateMaximumCreditUnits;
    const decision = prepareModelLiveSeedRoutingDecisionV3(input);
    expect(decision.outcome).toBe("denied");
    expect(decision.reasonCodes).toContain("user-confirmation-required");
  });
});
