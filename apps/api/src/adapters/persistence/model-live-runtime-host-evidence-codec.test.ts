import { describe, expect, it } from "vitest";
import {
  buildBedrockConverseRequestV1,
  createBedrockRoutingConfigurationV1,
  prepareBedrockLiveEvaluationConfigurationV2,
  digestStructuredValue,
  serializedByteLength,
} from "@cloudmarkup/model-gateway";
import {
  modelLiveEvaluationPlanV2Schema,
  modelRuntimeInputEvidenceV1Schema,
} from "@cloudmarkup/schemas";
import {
  ModelLiveRuntimeHostEvidenceError,
  prepareModelLiveRuntimeInputV2,
} from "./model-live-runtime-host-evidence-codec.js";

import { syntheticLiveEvaluationFixtureV2 } from "@cloudmarkup/model-gateway/testing";

import { liveHostInputFixture as fixture } from "./model-live-runtime-host-evidence-test-helpers.js";

describe.each(["normal", "candidate"] as const)(
  "%s synthetic host configuration follows its caller-supplied clock",
  (activation) => {
    it.each([
      "2026-08-31T23:59:59.999Z",
      "2026-09-30T23:59:59.999Z",
      "2026-10-01T00:00:00.000Z",
      "2040-02-29T12:00:00.000Z",
    ])(
      "prepares valid metadata at %s and still rejects configuration expiry",
      (now) => {
        const input = fixture(
          "architecture.propose",
          syntheticLiveEvaluationFixtureV2({ now }),
          undefined,
          activation,
        );
        expect(
          prepareModelLiveRuntimeInputV2(input).inputEvidence.operation,
        ).toBe("architecture.propose");
        const { configuration } = input;
        const route = configuration.routes[0];
        if (!route?.effectiveUntil)
          throw Error("Missing bounded synthetic configuration.");
        for (const asOf of [
          new Date(Date.parse(route.effectiveFrom) - 1).toISOString(),
          route.effectiveUntil,
        ]) {
          expect(() =>
            configuration.contractVersion === 1
              ? createBedrockRoutingConfigurationV1({ asOf, configuration })
              : prepareBedrockLiveEvaluationConfigurationV2({
                  asOf,
                  configuration,
                }),
          ).toThrow(
            expect.objectContaining({
              code: "model-provider.configuration-not-effective",
            }),
          );
        }
      },
    );
  },
);

describe("pure V2 live host input preparation", () => {
  it.each([
    "architecture.propose",
    "application-source.generate",
    "iac-extension.generate",
    "repository.interpret",
  ] as const)(
    "prepares approved-case %s metadata for an unevaluated candidate without changing evaluation facts",
    (operation) => {
      const input = fixture(operation, undefined, undefined, "candidate");
      const before = structuredClone(input);
      const prepared = prepareModelLiveRuntimeInputV2(input);
      expect(input.configuration.contractVersion).toBe(2);
      expect(
        input.configuration.routes.every(
          (route) =>
            route.capability.lifecycleState === "candidate" &&
            !route.capability.evaluation.passed,
        ),
      ).toBe(true);
      expect(prepared.inputEvidence.inputDigest).toBe(
        input.invocation.descriptor.inputDigest,
      );
      expect(prepared.inputEvidence.operation).toBe(operation);
      expect(input).toEqual(before);
    },
  );

  it.each([
    "architecture.propose",
    "application-source.generate",
    "iac-extension.generate",
    "repository.interpret",
  ] as const)(
    "binds actual %s measurements and exact wire framing without issuing approval",
    (operation) => {
      const input = fixture(operation);
      const before = structuredClone(input);
      const prepared = prepareModelLiveRuntimeInputV2(input);
      expect(input).toEqual(before);
      expect(
        modelRuntimeInputEvidenceV1Schema.safeParse(prepared.inputEvidence)
          .success,
      ).toBe(true);
      expect(prepared.invocationDigest).toBe(
        digestStructuredValue(input.invocation),
      );
      expect(prepared.inputEvidence.requested.promptBytes).toBe(
        serializedByteLength(
          buildBedrockConverseRequestV1(input.invocation, prepared.route),
        ),
      );
      expect(prepared.route.toolChoiceMode).toBe("auto");
      expect(prepared.inputEvidence.requested.promptBytes).toBeGreaterThan(
        serializedByteLength(input.invocation.request),
      );
      expect(prepared.inputEvidence.verifierId).toBe(
        "cloudmarkup.live-host-evidence.v2",
      );
    },
  );
  it.each([
    [
      "tenant",
      (input: ReturnType<typeof fixture>) => {
        input.scope.userId = "principal_other";
      },
    ],
    [
      "case",
      (input: ReturnType<typeof fixture>) => {
        input.caseId = "case_unknown";
      },
    ],
    [
      "source",
      (input: ReturnType<typeof fixture>) => {
        input.invocation = {
          ...input.invocation,
          request: {
            ...input.invocation.request,
            requestedMode: "professional",
          },
        };
      },
    ],
    [
      "prompt",
      (input: ReturnType<typeof fixture>) => {
        input.invocation = {
          ...input.invocation,
          prompt: { ...input.invocation.prompt, content: "Substituted prompt" },
        };
      },
    ],
    [
      "tool",
      (input: ReturnType<typeof fixture>) => {
        input.invocation = {
          ...input.invocation,
          responseTool: {
            ...input.invocation.responseTool,
            inputSchema: { type: "object" },
          },
        };
      },
    ],
    [
      "output tokens",
      (input: ReturnType<typeof fixture>) => {
        input.invocation = { ...input.invocation, maximumOutputTokens: 64001 };
      },
    ],
    [
      "timeout",
      (input: ReturnType<typeof fixture>) => {
        input.invocation = {
          ...input.invocation,
          timeoutMilliseconds: 86400000,
        };
      },
    ],
    [
      "extra input field",
      (input: ReturnType<typeof fixture>) => {
        Object.assign(input.invocation, { requested: { nodeCount: 0 } });
      },
    ],
    [
      "ignored cache key",
      (input: ReturnType<typeof fixture>) => {
        Object.assign(input.invocation, {
          promptCacheKey: { digest: digestStructuredValue("synthetic") },
        });
      },
    ],
    [
      "model",
      (input: ReturnType<typeof fixture>) => {
        Reflect.set(
          input.invocation.descriptor,
          "modelId",
          "model.substituted",
        );
      },
    ],
    [
      "scope without job",
      (input: ReturnType<typeof fixture>) => {
        delete input.scope.jobId;
      },
    ],
    [
      "plan expiry",
      (input: ReturnType<typeof fixture>) => {
        input.observedAt = input.plan.expiresAt;
      },
    ],
    [
      "before issuance",
      (input: ReturnType<typeof fixture>) => {
        input.observedAt = new Date(
          Date.parse(input.plan.issuedAt) - 1,
        ).toISOString();
      },
    ],
    [
      "configuration expiry",
      (input: ReturnType<typeof fixture>) => {
        const until = input.configuration.routes[0]?.effectiveUntil;
        if (until === undefined || until === null)
          throw Error("Missing fixture expiry.");
        input.observedAt = until;
      },
    ],
    [
      "configured capability mutation",
      (input: ReturnType<typeof fixture>) => {
        const route = input.configuration.routes[0];
        if (route === undefined) throw Error("Missing fixture.");
        route.capability.maximumOutputBytes += 1;
      },
    ],
  ] as const)(
    "denies substituted %s with fixed, content-free errors",
    (_name, mutate) => {
      const input = fixture();
      mutate(input);
      expect(() => prepareModelLiveRuntimeInputV2(input)).toThrow(
        ModelLiveRuntimeHostEvidenceError,
      );
    },
  );

  it("denies internal repair escalation before preparing Evidence while prior-call lineage is unsupported", () => {
    const input = fixture("candidate.repair");
    expect(input.invocation.descriptor.routing?.routeId).toBe(
      "internal-escalation",
    );
    expect(() => prepareModelLiveRuntimeInputV2(input)).toThrow(
      ModelLiveRuntimeHostEvidenceError,
    );
  });

  it("rejects an embedded catalog mismatch even when every input and plan digest is rebound", () => {
    const input = fixture();
    const request = input.invocation.request;
    if (
      request.operation !== "architecture.propose" ||
      request.currentArchitecture === undefined
    )
      throw new Error("Missing synthetic architecture.");
    const catalogDigest = digestStructuredValue(
      "substituted synthetic catalog",
    );
    request.catalog.catalogDigest = catalogDigest;
    request.currentArchitecture.catalog.digest = catalogDigest;
    input.invocation.descriptor.inputDigest = digestStructuredValue({
      request,
      scope: input.scope,
    });
    const binding = input.plan.definition.cases.find(
      (entry) => entry.caseId === input.caseId,
    );
    if (binding === undefined) throw new Error("Missing synthetic case.");
    binding.invocationInputDigest = input.invocation.descriptor.inputDigest;
    const { definitionDigest, ...definitionData } = input.plan.definition;
    void definitionDigest;
    input.plan.definition.definitionDigest =
      digestStructuredValue(definitionData);
    input.plan.approval.definitionDigest =
      input.plan.definition.definitionDigest;
    const { approvalDigest, ...approvalData } = input.plan.approval;
    void approvalDigest;
    input.plan.approval.approvalDigest = digestStructuredValue(approvalData);
    const { planDigest, ...planData } = input.plan;
    void planDigest;
    input.plan.planDigest = digestStructuredValue(planData);
    expect(modelLiveEvaluationPlanV2Schema.safeParse(input.plan).success).toBe(
      true,
    );
    expect(() => prepareModelLiveRuntimeInputV2(input)).toThrow(
      ModelLiveRuntimeHostEvidenceError,
    );
  });

  it("detaches prepared request and route metadata from later caller mutation", () => {
    const input = fixture();
    const prepared = prepareModelLiveRuntimeInputV2(input);
    const before = structuredClone(prepared);
    input.invocation.descriptor.modelVersion = "caller-mutated";
    input.configuration.routes[0]?.supportedRegions.push("us-west-2");
    expect(prepared).toEqual(before);
  });
});
