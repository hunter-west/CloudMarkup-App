import { describe, expect, it } from "vitest";

import {
  generateModelGatewayRequestV1JsonSchema,
  generateModelGatewayResponseV1JsonSchema,
  generateModelCacheKeyInputV1JsonSchema,
  generateModelCapabilityRegistryV1JsonSchema,
  generateModelInvocationDescriptorV1JsonSchema,
  generateModelRouteEstimateInputV1JsonSchema,
  generateModelRouteRegistryV1JsonSchema,
  generateModelRoutingDecisionV1JsonSchema,
  generateModelRoutingRequestV1JsonSchema,
  generateModelRoutingUiStateV1JsonSchema,
  generateNormalizedModelUsageV1JsonSchema,
  modelGatewayRequestV1Schema,
  modelGatewayResponseV1Schema,
  modelInvocationDescriptorV1Schema,
  normalizedModelUsageV1Schema,
} from "@cloudmarkup/schemas";

import {
  DeterministicFakeModelAdapter,
  InMemoryModelInvocationStore,
  CollectingModelUsageRecorder,
  CollectingSafeModelLogger,
  deterministicFakeRoutingV1,
} from "./fakes.js";
import { ProviderNeutralModelGateway } from "./gateway.js";
import { InMemoryRestrictedInvalidSolutionProposalStoreV1 } from "./solution-planner.js";
import { modelTestContext, modelTestRequests } from "./test-helpers.js";

describe("ModelGateway v1 contracts", () => {
  it("publishes distinct Draft 2020-12 schemas for requests, responses, descriptors, and usage", () => {
    const schemas = [
      generateModelGatewayRequestV1JsonSchema(),
      generateModelGatewayResponseV1JsonSchema(),
      generateModelInvocationDescriptorV1JsonSchema(),
      generateNormalizedModelUsageV1JsonSchema(),
    ];

    expect(schemas.map((schema) => schema["$id"])).toEqual([
      "https://schemas.cloudmarkup.com/model-gateway-request/v1.schema.json",
      "https://schemas.cloudmarkup.com/model-gateway-response/v1.schema.json",
      "https://schemas.cloudmarkup.com/model-invocation-descriptor/v1.schema.json",
      "https://schemas.cloudmarkup.com/normalized-model-usage/v1.schema.json",
    ]);
    expect(schemas[0]?.["oneOf"]).toHaveLength(15);
    expect(schemas[1]?.["oneOf"]).toHaveLength(15);
    expect(schemas.every((schema) => schema["$schema"] !== undefined)).toBe(
      true,
    );
  });

  it("publishes strict versioned routing, capability, cache, estimate, and safe UI schemas", () => {
    const schemas: Record<string, unknown>[] = [
      generateModelCapabilityRegistryV1JsonSchema(),
      generateModelRouteRegistryV1JsonSchema(),
      generateModelRoutingRequestV1JsonSchema(),
      generateModelRoutingDecisionV1JsonSchema(),
      generateModelCacheKeyInputV1JsonSchema(),
      generateModelRouteEstimateInputV1JsonSchema(),
      generateModelRoutingUiStateV1JsonSchema(),
    ];
    expect(schemas.map((schema) => schema["$id"])).toEqual([
      "https://schemas.cloudmarkup.com/model-capability-registry/v1.schema.json",
      "https://schemas.cloudmarkup.com/model-route-registry/v1.schema.json",
      "https://schemas.cloudmarkup.com/model-routing-request/v1.schema.json",
      "https://schemas.cloudmarkup.com/model-routing-decision/v1.schema.json",
      "https://schemas.cloudmarkup.com/model-cache-key-input/v1.schema.json",
      "https://schemas.cloudmarkup.com/model-route-estimate-input/v1.schema.json",
      "https://schemas.cloudmarkup.com/model-routing-ui-state/v1.schema.json",
    ]);
    expect(
      schemas.every(
        (schema) =>
          schema["$schema"] !== undefined &&
          schema["additionalProperties"] === false,
      ),
    ).toBe(true);
  });

  it("rejects unknown versions, operations, fields, and oversized content", () => {
    const valid = modelTestRequests()[0];
    expect(valid).toBeDefined();
    expect(
      modelGatewayRequestV1Schema.safeParse({ ...valid, contractVersion: 2 })
        .success,
    ).toBe(false);
    expect(
      modelGatewayRequestV1Schema.safeParse({
        contractVersion: 1,
        operation: "repository.mutate",
        requestedMode: "guided",
      }).success,
    ).toBe(false);
    expect(
      modelGatewayRequestV1Schema.safeParse({
        ...valid,
        arbitraryTools: [{ name: "shell" }],
      }).success,
    ).toBe(false);
    expect(
      modelGatewayRequestV1Schema.safeParse({
        contractVersion: 1,
        operation: "summary.technical",
        requestedMode: "guided",
        source: {
          content: "x".repeat(64 * 1_024 + 1),
          contentDigest: `sha256:${"a".repeat(64)}`,
          evidenceReferences: [],
          sourceKind: "architecture",
        },
      }).success,
    ).toBe(false);
  });

  it("requires repair diagnostics to assert sanitized secret-free input", () => {
    const repair = modelTestRequests().find(
      (request) => request.operation === "candidate.repair",
    );
    if (repair?.operation !== "candidate.repair") {
      throw new Error("Missing repair request fixture.");
    }
    expect(
      modelGatewayRequestV1Schema.safeParse({
        ...repair,
        diagnostics: repair.diagnostics.map((diagnostic) => ({
          ...diagnostic,
          noSecretValues: false,
        })),
      }).success,
    ).toBe(false);
  });

  it("requires complete normalized usage and denies raw prompt or response fields", async () => {
    expect(
      normalizedModelUsageV1Schema.safeParse({
        cacheReadUnits: "0",
        cacheWriteUnits: "0",
        contractVersion: 1,
        feature: "summary.technical",
        inputUnits: "1",
        invocationId: "invocation_test",
        modelId: "model.test",
        modelVersion: "1",
        outputUnits: "1",
        promptTemplateId: "prompt.test",
        promptVersion: "1.0.0",
        result: "succeeded",
        scope: {
          organizationId: "organization_test",
          userId: "user_test",
        },
        thinkingUnits: "0",
      }).success,
    ).toBe(false);

    const adapter = new DeterministicFakeModelAdapter();
    const gateway = new ProviderNeutralModelGateway({
      adapters: [adapter],
      allowedApprovalPathIds: ["cloudmarkup.dependency-review.v1"],
      invocationStore: new InMemoryModelInvocationStore(),
      invalidProposalStore:
        new InMemoryRestrictedInvalidSolutionProposalStoreV1(),
      logger: new CollectingSafeModelLogger(),
      routing: deterministicFakeRoutingV1,
      usageRecorder: new CollectingModelUsageRecorder(),
    });
    const summary = modelTestRequests().find(
      (request) => request.operation === "summary.technical",
    );
    if (summary?.operation !== "summary.technical") {
      throw new Error("Missing summary fixture.");
    }
    const result = await gateway.invoke(
      summary,
      modelTestContext("invocation_contract_usage"),
    );
    expect(result.usage).not.toHaveProperty("prompt");
    expect(result.usage).not.toHaveProperty("response");
    expect(normalizedModelUsageV1Schema.parse(result.usage)).toEqual(
      result.usage,
    );
    expect(modelInvocationDescriptorV1Schema.parse(result.descriptor)).toEqual(
      result.descriptor,
    );
    expect(modelGatewayResponseV1Schema.parse(result.response)).toEqual(
      result.response,
    );
  });
});
