import { describe, expect, it } from "vitest";

import {
  DeterministicScenarioFakeModelAdapter,
  deterministicFakeProviderProfileV1,
  deterministicFakeRoutingV1,
  deterministicModelGatewayScenarioIdsV1,
  runDeterministicModelGatewayScenarioV1,
  type DeterministicModelGatewayScenarioResultV1,
} from "./fakes.js";

function expectAttempt(
  result: DeterministicModelGatewayScenarioResultV1,
): asserts result is Extract<
  DeterministicModelGatewayScenarioResultV1,
  { kind: "attempt" }
> {
  expect(result.kind).toBe("attempt");
  if (result.kind !== "attempt") {
    throw new Error("Expected a deterministic attempt scenario.");
  }
}

function expectDenied(
  result: DeterministicModelGatewayScenarioResultV1,
): asserts result is Extract<
  DeterministicModelGatewayScenarioResultV1,
  { kind: "route-denied" }
> {
  expect(result.kind).toBe("route-denied");
  if (result.kind !== "route-denied") {
    throw new Error("Expected a deterministic route-denied scenario.");
  }
}

describe("Prompt 34R deterministic ModelGateway scenarios", () => {
  it("rejects unknown deterministic fake scenarios at runtime", async () => {
    let adapterError: unknown;
    try {
      new DeterministicScenarioFakeModelAdapter([
        "unknown-adapter-scenario" as never,
      ]);
    } catch (error) {
      adapterError = error;
    }
    expect(adapterError).toMatchObject({
      code: "model-gateway.invalid-deterministic-fake-scenario",
      message: "The deterministic fake scenario is not recognized.",
      name: "DeterministicFakeScenarioError",
    });

    await expect(
      runDeterministicModelGatewayScenarioV1(
        "unknown-runner-scenario" as never,
      ),
    ).rejects.toMatchObject({
      code: "model-gateway.invalid-deterministic-fake-scenario",
      message: "The deterministic fake scenario is not recognized.",
      name: "DeterministicFakeScenarioError",
    });
  });

  it("publishes the complete explicit routing scenario set", () => {
    expect(deterministicModelGatewayScenarioIdsV1).toEqual([
      "standard-success",
      "deep-success",
      "standard-validation-failure",
      "internal-escalation-success",
      "internal-escalation-failure",
      "route-disabled",
      "plan-denial",
      "credit-denial",
      "duplicate-request",
      "model-configuration-drift",
    ]);
    expect(deterministicFakeProviderProfileV1.capabilities[0]).toMatchObject({
      capabilityVersion: "1.0.0",
      evaluation: {
        evaluationPolicyId: "cloudmarkup.model-evaluation.production.v1",
      },
      modelConfigurationReference: "cloudmarkup.fake-model.standard.v1",
      modelFamily: "cloudmarkup.fake-model",
      pricingVersionReference: "cloudmarkup.pricing.fake-model.v1",
      usageFieldsExpected: [
        "input-units",
        "output-units",
        "cache-read-units",
        "cache-write-units",
        "thinking-units",
      ],
    });
    expect(deterministicFakeRoutingV1.configurationId).toBe(
      "cloudmarkup.model-routing.fake.v1",
    );
  });

  it("simulates deterministic Standard and Deep success without a provider call", async () => {
    const standard =
      await runDeterministicModelGatewayScenarioV1("standard-success");
    const standardAgain =
      await runDeterministicModelGatewayScenarioV1("standard-success");
    const deep = await runDeterministicModelGatewayScenarioV1("deep-success");
    expectAttempt(standard);
    expectAttempt(standardAgain);
    expectAttempt(deep);

    expect(standard).toEqual(standardAgain);
    expect(standard).toMatchObject({
      contractVersion: 1,
      decision: {
        evaluationPolicyId: "cloudmarkup.model-evaluation.production.v1",
        modelCapabilityVersion: "1.0.0",
        modelConfigurationReference: "cloudmarkup.bedrock.standard.v1",
        modelFamily: "configured.model-family.standard",
        modelId: "configured.model.standard.required",
        outcome: "selected",
        pricingVersionReference: "cloudmarkup.pricing.unavailable.standard",
        routeId: "standard-design",
      },
      result: "succeeded",
    });
    expect(deep).toMatchObject({
      decision: {
        evaluationPolicyId: "cloudmarkup.model-evaluation.production.v1",
        modelConfigurationReference: "cloudmarkup.bedrock.deep.v1",
        modelFamily: "configured.model-family.deep",
        modelId: "configured.model.deep.required",
        outcome: "selected",
        pricingVersionReference: "cloudmarkup.pricing.unavailable.deep",
        routeId: "deep-design",
      },
      result: "succeeded",
    });
  });

  it("simulates Standard validation failure and bounded terminal escalation outcomes", async () => {
    const standardFailure = await runDeterministicModelGatewayScenarioV1(
      "standard-validation-failure",
    );
    const escalationSuccess = await runDeterministicModelGatewayScenarioV1(
      "internal-escalation-success",
    );
    const escalationFailure = await runDeterministicModelGatewayScenarioV1(
      "internal-escalation-failure",
    );
    expectAttempt(standardFailure);
    expectAttempt(escalationSuccess);
    expectAttempt(escalationFailure);

    expect(standardFailure).toMatchObject({
      decision: {
        automaticEscalationPermitted: true,
        routeId: "standard-design",
      },
      result: "validation-failure",
      safeCode: "model-output.validation-failed",
    });
    expect(escalationSuccess).toMatchObject({
      decision: {
        automaticEscalationPermitted: false,
        customerCharge: { incrementalEscalationCreditUnits: 0 },
        escalation: {
          originalResult: "validation-failure",
          originalRouteId: "standard-design",
        },
        maximumAttempts: 1,
        modelId: "configured.model.deep.required",
        routeId: "internal-escalation",
      },
      result: "succeeded",
    });
    expect(escalationFailure).toMatchObject({
      decision: {
        automaticEscalationPermitted: false,
        maximumAttempts: 1,
        routeId: "internal-escalation",
      },
      result: "validation-failure",
      safeCode: "model-escalation.validation-failed",
    });
  });

  it("simulates route, plan, and credit denials before provider invocation", async () => {
    const [disabled, planDenied, creditDenied] = await Promise.all([
      runDeterministicModelGatewayScenarioV1("route-disabled"),
      runDeterministicModelGatewayScenarioV1("plan-denial"),
      runDeterministicModelGatewayScenarioV1("credit-denial"),
    ]);
    expectDenied(disabled);
    expectDenied(planDenied);
    expectDenied(creditDenied);

    expect(disabled.decision.reasonCodes).toContain("route-disabled");
    expect(planDenied.decision).toMatchObject({
      entitlement: { allowed: false, planKey: "starter" },
      outcome: "denied",
      routeId: "deep-design",
    });
    expect(planDenied.decision.reasonCodes).toContain("plan-denied");
    expect(creditDenied.decision).toMatchObject({
      creditAuthorization: { allowed: false },
      outcome: "denied",
      routeId: "standard-design",
    });
    expect(creditDenied.decision.reasonCodes).toContain("credits-insufficient");
  });

  it("simulates duplicate request fencing and model-configuration drift", async () => {
    const duplicate =
      await runDeterministicModelGatewayScenarioV1("duplicate-request");
    expect(duplicate).toEqual({
      contractVersion: 1,
      duplicateClaim: { kind: "duplicate-in-progress" },
      firstClaim: { kind: "claimed" },
      kind: "duplicate-request",
      scenario: "duplicate-request",
    });

    await expect(
      runDeterministicModelGatewayScenarioV1("model-configuration-drift"),
    ).rejects.toMatchObject({
      code: "model-routing.configuration-drift",
      name: "ModelRoutingPolicyError",
    });
  });
});
