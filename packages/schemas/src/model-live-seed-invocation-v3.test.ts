import { describe, expect, it } from "vitest";
import { modelInvocationDescriptorV1Schema } from "./model-gateway-v1.js";
import { modelLiveSeedInvocationDescriptorV3Schema as descriptor } from "./model-live-seed-invocation-v3.js";
const digest = "sha256:" + "a".repeat(64);
function fixture() {
  return descriptor.parse({
    contractVersion: 3,
    recordKind: "model-live-seed-invocation-descriptor",
    budgetDecisionId: "synthetic_budget",
    entitlementDecisionId: "synthetic_entitlement",
    complexity: "repair",
    evaluationPolicyId: "cloudmarkup.synthetic.evaluation",
    evaluationPolicyVersion: "1.0.0",
    feature: "candidate.repair",
    idempotencyKeyDigest: digest,
    inputDigest: digest,
    invocationId: "synthetic_invocation",
    modelId: "cloudmarkup.synthetic.model",
    modelVersion: "1.0.0",
    inferenceProfileId: "cloudmarkup.synthetic.profile",
    promptDigest: digest,
    promptTemplateId: "cloudmarkup.synthetic.prompt",
    promptVersion: "1.0.0",
    providerFamily: "amazon-bedrock",
    providerId: "cloudmarkup.synthetic.provider",
    requestedMode: "guided",
    role: "repair-escalation",
    toolAuthority: "none",
    scope: {
      organizationId: "synthetic_org",
      projectId: "synthetic_project",
      userId: "synthetic_user",
      jobId: "synthetic_job",
    },
    routing: {
      capabilityRegistryDigest: digest,
      capabilityRegistryId: "cloudmarkup.synthetic.capabilities",
      capabilityRegistryVersion: "1.0.0",
      capabilityVersion: "1.0.0",
      effort: "high",
      evaluationPolicyId: "cloudmarkup.synthetic.evaluation",
      evaluationPolicyVersion: "1.0.0",
      modelCapabilityDigest: digest,
      modelConfigurationReference: "cloudmarkup.synthetic.model",
      modelFamily: "cloudmarkup.synthetic.family",
      pricingVersionReference: "cloudmarkup.synthetic.pricing",
      routeId: "internal-escalation",
      routeDefinitionDigest: digest,
      routeRegistryDigest: digest,
      routeRegistryId: "cloudmarkup.synthetic.routes",
      routeRegistryVersion: "1.0.0",
      routingConfigurationDigest: digest,
    },
  });
}
describe("one-way first-seed invocation descriptor", () => {
  it("requires static provenance without a final route, report or counted estimate", () => {
    const value = fixture();
    expect(value.contractVersion).toBe(3);
    expect(value.routing).not.toHaveProperty("routingDecisionDigest");
    expect(value.routing).not.toHaveProperty("acceptedMaximumCreditUnits");
    expect(value.routing).not.toHaveProperty("evaluationResultDigest");
    expect(modelInvocationDescriptorV1Schema.safeParse(value).success).toBe(
      false,
    );
  });
  it.each([
    "routingDecisionDigest",
    "acceptedMaximumCreditUnits",
    "evaluationResultDigest",
    "evaluationResultVersion",
  ] as const)("rejects embedded downstream %s metadata", (key) => {
    const value = fixture();
    Object.assign(value.routing, {
      [key]:
        key === "acceptedMaximumCreditUnits"
          ? 1
          : key === "evaluationResultVersion"
            ? "1.0.0"
            : digest,
    });
    expect(descriptor.safeParse(value).success).toBe(false);
  });
  it.each([
    "route",
    "effort",
    "feature",
    "role",
    "policy",
    "version",
    "project",
    "job",
    "repository",
  ] as const)("rejects changed %s scope", (key) => {
    const value = fixture();
    if (key === "route")
      Object.assign(value.routing, { routeId: "deep-design" });
    if (key === "effort") Object.assign(value.routing, { effort: "xhigh" });
    if (key === "feature") Object.assign(value, { feature: "intent.extract" });
    if (key === "role") Object.assign(value, { role: "planning" });
    if (key === "policy")
      Object.assign(value.routing, {
        evaluationPolicyId: "cloudmarkup.synthetic.other",
      });
    if (key === "version") Object.assign(value, { contractVersion: 1 });
    if (key === "project") Reflect.deleteProperty(value.scope, "projectId");
    if (key === "job") Reflect.deleteProperty(value.scope, "jobId");
    if (key === "repository")
      Object.assign(value.scope, {
        repositorySnapshotId: "synthetic_repository",
      });
    expect(descriptor.safeParse(value).success).toBe(false);
  });
});
