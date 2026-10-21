import {
  BedrockModelProviderAdapter,
  buildBedrockConverseRequestV1,
  digestStructuredValue,
  sha256Text,
  type ModelProviderAdapter,
  type ModelProviderInvocationV1,
  type ModelProviderResultV1,
} from "@cloudmarkup/model-gateway";
import {
  deterministicFakeProviderProfileV1,
  createHostRepairSuccessorTestInvocationV4,
} from "@cloudmarkup/model-gateway/testing";
import * as modelGateway from "@cloudmarkup/model-gateway";
import { modelInvocationDescriptorV1Schema } from "@cloudmarkup/schemas";
import { describe, expect, it, vi } from "vitest";
import { reviewedBedrockPricing20260916 } from "./bedrock-reviewed-pricing-20260916.js";
import {
  BedrockGlobalFullWindowCostAuthority,
  bedrockGlobalPricingEvidenceV1Schema,
  type BedrockGlobalPricingEvidenceV1,
} from "./bedrock-global-pricing.js";
import {
  ModelPlatformSpendError,
  PlatformSpendBoundModelProviderAdapter,
  PlatformSpendBoundHostSeedProviderAdapterV2,
  PlatformSpendBoundHostSeedProviderAdapterV3,
  PlatformSpendBoundHostRepairSuccessorProviderAdapterV4,
  modelPlatformReservationReceiptSchema,
  type ModelPlatformReservationInput,
  type ModelPlatformSpendReservationPort,
} from "./model-platform-spend.js";
import {
  platformSpendInvocation,
  platformSpendHostSeedInvocation,
  platformSpendHostSeedInvocationV3,
} from "./persistence/model-platform-spend-test-helpers.js";
import {
  BedrockGlobalCountedInputCostAuthority,
  BedrockGlobalCountedHostSeedCostAuthorityV2,
  BedrockGlobalCountedHostSeedCostAuthorityV3,
  BedrockGlobalCountedHostRepairSuccessorCostAuthorityV4,
} from "./bedrock-counted-global-pricing.js";
import { aiPreviewFixture } from "./persistence/ai-intent-preview-test-helpers.js";

const now = new Date("2026-09-05T22:00:00.000Z");

// Synthetic observations of the reviewed rate schema, not proof of a live
// account's offer retrieval, model access, route evaluation or paid invocation.
function fixture(
  kind: "sonnet" | "opus" = "sonnet",
  source: ModelProviderInvocationV1 = platformSpendInvocation(),
) {
  const modelId =
    kind === "sonnet" ? "anthropic.claude-sonnet-5" : "anthropic.claude-opus-5";
  const evidence = bedrockGlobalPricingEvidenceV1Schema.parse({
    contractVersion: 1,
    policyId: "cloudmarkup.bedrock-global-full-window.v1",
    accountId: "000000000000",
    environment: "beta",
    sourceRegion: "us-east-1",
    endpoint: "bedrock-runtime",
    serviceTier: "standard",
    offerUnit: "Units",
    currency: "USD",
    tokenDenominator: 1_000_000,
    publishedPricingReference:
      "https://platform.claude.com/docs/en/about-claude/pricing",
    pricingVersionId: `cloudmarkup.pricing.${kind}.global.d2026-09-05.v1`,
    modelId,
    modelVersion: "synthetic-reviewed-model-version",
    inferenceProfileId: `global.${modelId}`,
    offerId: kind === "sonnet" ? "offer-2ykemehpsyf7g" : "offer-f3u6lgbrem3zs",
    offerTermsDigest: digestStructuredValue(
      "synthetic-offer-observation-not-live-evidence",
    ),
    observedAt: "2026-09-05T21:00:00.000Z",
    validFrom: "2026-09-05T00:00:00.000Z",
    validUntil: "2026-09-12T00:00:00.000Z",
    rates:
      kind === "sonnet"
        ? {
            inputMicroUsdPerMillion: 2_000_000,
            outputMicroUsdPerMillion: 10_000_000,
            cacheReadMicroUsdPerMillion: 200_000,
            cacheWrite5mMicroUsdPerMillion: 2_500_000,
            cacheWrite1hMicroUsdPerMillion: 4_000_000,
          }
        : {
            inputMicroUsdPerMillion: 5_000_000,
            outputMicroUsdPerMillion: 25_000_000,
            cacheReadMicroUsdPerMillion: 500_000,
            cacheWrite5mMicroUsdPerMillion: 6_250_000,
            cacheWrite1hMicroUsdPerMillion: 10_000_000,
          },
  });
  const route = {
    enabled: true as const,
    invocationTarget: evidence.inferenceProfileId,
    modelConfigurationReference: `cloudmarkup.bedrock.${kind}.v1`,
    nativeStructuredOutputSupported: false as const,
    region: "us-east-1" as const,
    supportedRegions: ["us-east-1" as const],
    thinkingMode: "adaptive" as const,
    transport: "converse" as const,
  };
  const invocation: ModelProviderInvocationV1 = {
    ...source,
    descriptor: modelInvocationDescriptorV1Schema.parse({
      ...source.descriptor,
      inputDigest: digestStructuredValue({
        request: source.request,
        scope: source.descriptor.scope,
      }),
      providerId: "cloudmarkup.amazon-bedrock",
      modelId,
      modelVersion: evidence.modelVersion,
      inferenceProfileId: evidence.inferenceProfileId,
      routing: {
        ...source.descriptor.routing,
        modelConfigurationReference: route.modelConfigurationReference,
        pricingVersionReference: evidence.pricingVersionId,
      },
    }),
  };
  const clock = { current: now };
  const authority = new BedrockGlobalFullWindowCostAuthority({
    evidence,
    route,
    now: () => clock.current,
  });
  return { authority, clock, evidence, invocation, route };
}

function fallbackFixture(kind: "sonnet" | "opus") {
  const base = fixture(kind);
  const modelId =
    kind === "sonnet"
      ? "anthropic.claude-sonnet-4-6"
      : "anthropic.claude-opus-4-6-v1";
  const evidence = bedrockGlobalPricingEvidenceV1Schema.parse({
    ...base.evidence,
    modelId,
    inferenceProfileId: `global.${modelId}`,
    pricingVersionId: `cloudmarkup.pricing.${kind}46.global.d2026-09-09.v1`,
    offerId: kind === "sonnet" ? "offer-ldnd26nhxx676" : "offer-ee7a27hh4hr62",
    observedAt: "2026-09-09T12:00:00.000Z",
    validFrom: "2026-09-09T00:00:00.000Z",
    validUntil: "2026-09-16T00:00:00.000Z",
    rates:
      kind === "sonnet"
        ? {
            inputMicroUsdPerMillion: 3_000_000,
            outputMicroUsdPerMillion: 15_000_000,
            cacheReadMicroUsdPerMillion: 300_000,
            cacheWrite5mMicroUsdPerMillion: 3_750_000,
            cacheWrite1hMicroUsdPerMillion: 6_000_000,
          }
        : base.evidence.rates,
  });
  const route = {
    ...base.route,
    invocationTarget: evidence.inferenceProfileId,
    toolChoiceMode: "auto" as const,
  };
  const invocation = {
    ...base.invocation,
    descriptor: modelInvocationDescriptorV1Schema.parse({
      ...base.invocation.descriptor,
      modelId,
      inferenceProfileId: evidence.inferenceProfileId,
      routing: {
        ...base.invocation.descriptor.routing,
        pricingVersionReference: evidence.pricingVersionId,
      },
    }),
  };
  const clock = { current: new Date("2026-09-09T12:01:00.000Z") };
  const authority = new BedrockGlobalFullWindowCostAuthority({
    evidence,
    route,
    now: () => clock.current,
  });
  return { invocation, authority, clock, evidence, route };
}

describe("approved GLOBAL full-window platform cost authority", () => {
  it.each(reviewedBedrockPricing20260916)(
    "admits the refreshed $modelId observation without renewing historical evidence",
    async (reviewed) => {
      const kind = reviewed.modelId.includes("sonnet") ? "sonnet" : "opus";
      const f = fallbackFixture(kind);
      const {
        pricingSnapshot: { offerId, validFrom, validUntil, ...rates },
        ...observation
      } = reviewed;
      const evidence = bedrockGlobalPricingEvidenceV1Schema.parse({
        ...f.evidence,
        ...observation,
        offerId,
        validFrom,
        validUntil,
        rates,
      });
      const invocation = {
        ...f.invocation,
        maximumOutputTokens: kind === "sonnet" ? 64_000 : 128_000,
        descriptor: modelInvocationDescriptorV1Schema.parse({
          ...f.invocation.descriptor,
          routing: {
            ...f.invocation.descriptor.routing,
            pricingVersionReference: evidence.pricingVersionId,
          },
        }),
      };
      const clock = { current: new Date("2026-09-16T13:06:00.000Z") };
      const authority = new BedrockGlobalFullWindowCostAuthority({
        evidence,
        route: f.route,
        now: () => clock.current,
      });
      expect(await authority.resolve(invocation)).toMatchObject({
        pricingVersionId: reviewed.pricingVersionId,
        maximumCostMicroUsd: kind === "sonnet" ? 7_251_456 : 13_685_760,
        validUntil: "2026-09-23T00:00:00.000Z",
      });
      for (const changed of [
        { pricingVersionId: f.evidence.pricingVersionId },
        {
          modelId:
            kind === "sonnet"
              ? "anthropic.claude-opus-4-6-v1"
              : "anthropic.claude-sonnet-4-6",
        },
        { offerTermsDigest: digestStructuredValue("unreviewed-observation") },
        { observedAt: "2026-09-16T13:06:00.000Z" },
        { validUntil: "2026-09-24T00:00:00.000Z" },
        {
          rates: {
            ...rates,
            inputMicroUsdPerMillion: rates.inputMicroUsdPerMillion + 1,
          },
        },
      ]) {
        expect(
          bedrockGlobalPricingEvidenceV1Schema.safeParse({
            ...evidence,
            ...changed,
          }).success,
        ).toBe(false);
      }
      expect(await authority.resolve(f.invocation)).toBeNull();
      f.clock.current = clock.current;
      expect(await f.authority.resolve(f.invocation)).toBeNull();
      clock.current = new Date(validUntil);
      expect(await authority.resolve(invocation)).toBeNull();
    },
  );

  it.each(["sonnet", "opus"] as const)(
    "prices the exact approved %s 4.6 offer and bounds its model output",
    async (kind) => {
      const f = fallbackFixture(kind);
      const limit = kind === "sonnet" ? 64_000 : 128_000;
      const priced = await f.authority.resolve({
        ...f.invocation,
        maximumOutputTokens: limit,
      });
      expect(priced).toMatchObject({
        modelId: f.evidence.modelId,
        maximumCostMicroUsd: kind === "sonnet" ? 7_251_456 : 13_685_760,
        validUntil: "2026-09-16T00:00:00.000Z",
      });
      expect(
        await f.authority.resolve({
          ...f.invocation,
          maximumOutputTokens: limit + 1,
        }),
      ).toBeNull();
      expect(
        bedrockGlobalPricingEvidenceV1Schema.safeParse({
          ...f.evidence,
          offerId: "unreviewed",
        }).success,
      ).toBe(false);
      expect(
        bedrockGlobalPricingEvidenceV1Schema.safeParse({
          ...f.evidence,
          validUntil: "2026-09-17T00:00:00.000Z",
        }).success,
      ).toBe(false);
      f.clock.current = new Date("2026-09-16T00:00:00.000Z");
      expect(await f.authority.resolve(f.invocation)).toBeNull();
    },
  );

  it("rejects the obsolete request-only digest", async () => {
    const { authority, invocation } = fixture();
    expect(
      await authority.resolve({
        ...invocation,
        descriptor: {
          ...invocation.descriptor,
          inputDigest: digestStructuredValue(invocation.request),
        },
      }),
    ).toBeNull();
  });

  it("rejects changed request content with an unchanged scoped digest", async () => {
    const { authority, invocation } = fixture();
    if (invocation.request.operation !== "intent.extract")
      throw new Error("Synthetic Intent request missing.");
    const content = `${invocation.request.source.content} Changed requirements.`;
    expect(
      await authority.resolve({
        ...invocation,
        request: {
          ...invocation.request,
          source: {
            ...invocation.request.source,
            content,
            digest: sha256Text(content),
          },
        },
      }),
    ).toBeNull();
  });

  it.each(["organizationId", "projectId", "userId", "jobId"] as const)(
    "rejects changed %s with an unchanged scoped digest",
    async (field) => {
      const { authority, invocation } = fixture();
      expect(
        await authority.resolve({
          ...invocation,
          descriptor: {
            ...invocation.descriptor,
            scope: { ...invocation.descriptor.scope, [field]: "changed_scope" },
          },
        }),
      ).toBeNull();
    },
  );

  it("prices a correctly rebound scope without granting tenant authority", async () => {
    const { authority, invocation } = fixture();
    const scope = {
      ...invocation.descriptor.scope,
      organizationId: "other_org",
    };
    const rebound = {
      ...invocation,
      descriptor: {
        ...invocation.descriptor,
        scope,
        inputDigest: digestStructuredValue({
          request: invocation.request,
          scope,
        }),
      },
    };
    const originalCost = await authority.resolve(invocation);
    const reboundCost = await authority.resolve(rebound);
    expect(originalCost).toMatchObject({ maximumCostMicroUsd: 4_204_544 });
    expect(reboundCost).toMatchObject({
      maximumCostMicroUsd: 4_204_544,
      invocationDigest: digestStructuredValue(rebound),
    });
    expect(reboundCost?.invocationDigest).not.toBe(
      originalCost?.invocationDigest,
    );
  });

  it("prices the real preview fixture shape as component evidence, not activation", async () => {
    const preview = aiPreviewFixture();
    const { authority, invocation } = fixture("sonnet", preview.invocation);
    expect(invocation.descriptor.inputDigest).toBe(preview.binding.inputDigest);
    expect(invocation.request).toEqual(preview.modelRequest);
    expect(invocation.descriptor.scope).toEqual(preview.scope);
    expect(await authority.resolve(invocation)).toMatchObject({
      invocationDigest: digestStructuredValue(invocation),
      maximumCostMicroUsd: 4_204_544,
    });
  });

  it.each([
    ["sonnet", 4_204_544],
    ["opus", 10_511_360],
  ] as const)(
    "reserves full input/cache window plus all output for %s",
    async (kind, expected) => {
      const { authority, invocation, evidence } = fixture(kind);
      const ceiling = await authority.resolve(invocation);
      expect(ceiling).toMatchObject({
        invocationDigest: digestStructuredValue(invocation),
        modelId: evidence.modelId,
        inferenceProfileId: evidence.inferenceProfileId,
        pricingVersionId: evidence.pricingVersionId,
        maximumCostMicroUsd: expected,
        validFrom: evidence.observedAt,
        validUntil: evidence.validUntil,
      });
    },
  );

  it("does not apply a cache-hit, GLOBAL, byte-length or low-effort discount", async () => {
    const { authority, invocation } = fixture();
    const tiny = await authority.resolve(invocation);
    const enlargedRequest = {
      ...invocation.request,
      source: {
        ...("source" in invocation.request ? invocation.request.source : {}),
        content: "Synthetic requirements. ".repeat(100),
      },
    };
    const enlarged = {
      ...invocation,
      request: enlargedRequest,
      descriptor: {
        ...invocation.descriptor,
        inputDigest: digestStructuredValue({
          request: enlargedRequest,
          scope: invocation.descriptor.scope,
        }),
      },
    } as ModelProviderInvocationV1;
    expect((await authority.resolve(enlarged))?.maximumCostMicroUsd).toBe(
      tiny?.maximumCostMicroUsd,
    );
    const cached = {
      ...invocation,
      promptCachePolicy: {
        enabled: true,
        cacheKeyRequired: true,
        maximumCheckpoints: 1,
        minimumCheckpointTokens: 1024,
      },
    };
    expect((await authority.resolve(cached))?.maximumCostMicroUsd).toBe(
      tiny?.maximumCostMicroUsd,
    );
  });

  it("prices the full requested thinking-plus-text maximum, not visible text or effort", async () => {
    const { authority, invocation } = fixture();
    const expanded = {
      ...invocation,
      maximumOutputTokens: 131_072,
      descriptor: {
        ...invocation.descriptor,
        routing: { ...invocation.descriptor.routing, effort: "xhigh" },
      },
    } as ModelProviderInvocationV1;
    expect((await authority.resolve(expanded))?.maximumCostMicroUsd).toBe(
      5_505_024,
    );
    expect(
      await authority.resolve({ ...expanded, maximumOutputTokens: 131_073 }),
    ).toBeNull();
  });

  it.each([
    ["account", { accountId: "111111111111" }],
    ["region", { sourceRegion: "us-west-2" }],
    ["endpoint", { endpoint: "bedrock-mantle" }],
    ["tier", { serviceTier: "flex" }],
    ["currency", { currency: "EUR" }],
    ["raw offer unit", { offerUnit: "USD" }],
    ["denominator", { tokenDenominator: 1_000 }],
    ["offer", { offerId: "offer-unreviewed" }],
    ["geography", { inferenceProfileId: "us.anthropic.claude-sonnet-5" }],
    ["expiry", { validUntil: "2026-09-13T00:00:00.000Z" }],
    ["effective date", { validFrom: "2026-09-04T00:00:00.000Z" }],
    ["extra field", { guardrails: true }],
  ])("rejects unreviewed %s evidence", (_label, patch) => {
    const { evidence, route } = fixture();
    expect(
      () =>
        new BedrockGlobalFullWindowCostAuthority({
          evidence: { ...evidence, ...patch } as BedrockGlobalPricingEvidenceV1,
          route,
        }),
    ).toThrow(ModelPlatformSpendError);
  });

  it.each([
    "inputMicroUsdPerMillion",
    "outputMicroUsdPerMillion",
    "cacheReadMicroUsdPerMillion",
    "cacheWrite5mMicroUsdPerMillion",
    "cacheWrite1hMicroUsdPerMillion",
  ] as const)("rejects substituted or discounted %s", (rate) => {
    const { evidence, route } = fixture();
    expect(
      () =>
        new BedrockGlobalFullWindowCostAuthority({
          evidence: {
            ...evidence,
            rates: { ...evidence.rates, [rate]: evidence.rates[rate] - 1 },
          },
          route,
        }),
    ).toThrow(ModelPlatformSpendError);
  });

  it.each(["2026-09-05T20:59:59.999Z", "2026-09-12T00:00:00.000Z", "invalid"])(
    "fails closed at unavailable clock %s",
    async (timestamp) => {
      const { authority, clock, invocation } = fixture();
      clock.current = new Date(timestamp);
      expect(await authority.resolve(invocation)).toBeNull();
    },
  );

  it.each([
    { providerId: "unreviewed.provider" },
    { providerFamily: "deterministic-fake" },
    { modelId: "anthropic.claude-opus-5" },
    { modelVersion: "changed" },
    { inferenceProfileId: "us.anthropic.claude-sonnet-5" },
    { promptDigest: digestStructuredValue("substituted-prompt") },
    { feature: "summary.technical" },
    { requestedMode: "professional" },
  ])("denies substituted descriptor %j", async (patch) => {
    const { authority, invocation } = fixture();
    expect(
      await authority.resolve({
        ...invocation,
        descriptor: { ...invocation.descriptor, ...patch },
      } as ModelProviderInvocationV1),
    ).toBeNull();
  });

  it("binds route, pricing, reviewed prompt, schema-only tool and strict request fields", async () => {
    const { authority, invocation } = fixture();
    const candidates = [
      {
        ...invocation,
        descriptor: {
          ...invocation.descriptor,
          routing: {
            ...invocation.descriptor.routing,
            pricingVersionReference: "wrong.price",
          },
        },
      },
      {
        ...invocation,
        descriptor: {
          ...invocation.descriptor,
          routing: {
            ...invocation.descriptor.routing,
            modelConfigurationReference: "wrong.route",
          },
        },
      },
      {
        ...invocation,
        prompt: {
          ...invocation.prompt,
          content: `${invocation.prompt.content} changed`,
        },
      },
      {
        ...invocation,
        responseTool: { ...invocation.responseTool, authority: "execute" },
      },
      {
        ...invocation,
        responseTool: { ...invocation.responseTool, inputSchema: {} },
      },
      { ...invocation, compaction: { enabled: true } },
      { ...invocation, serviceTier: "priority" },
      {
        ...invocation,
        additionalModelRequestFields: { fallbacks: ["unreviewed"] },
      },
      { ...invocation, maximumOutputTokens: Number.NaN },
      { ...invocation, maximumOutputTokens: 1.5 },
    ];
    for (const candidate of candidates)
      expect(
        await authority.resolve(candidate as ModelProviderInvocationV1),
      ).toBeNull();
  });

  it("snapshots evidence and binds its digest without retaining invocation content", async () => {
    const { authority, evidence, invocation } = fixture();
    const first = await authority.resolve(invocation);
    evidence.rates.inputMicroUsdPerMillion = 1;
    evidence.validUntil = "2099-01-01T00:00:00.000Z" as never;
    expect(await authority.resolve(invocation)).toEqual(first);
    expect(JSON.stringify(first)).not.toContain(
      "Synthetic spending-fence fixture",
    );
  });

  it("denies an unreviewed billable addition to the shared SDK projection", async () => {
    const { authority, invocation, route } = fixture();
    const projected = buildBedrockConverseRequestV1(invocation, route);
    const builder = vi
      .spyOn(modelGateway, "buildBedrockConverseRequestV1")
      .mockReturnValue({
        ...projected,
        guardrailConfig: {
          guardrailIdentifier: "synthetic-guardrail",
          guardrailVersion: "DRAFT",
        },
      });
    try {
      expect(await authority.resolve(invocation)).toBeNull();
    } finally {
      builder.mockRestore();
    }
  });

  it.each(["converse", "converse-stream"] as const)(
    "shares the exact %s SDK projection; no network client is created",
    async (transport) => {
      const { invocation, route } = fixture();
      const selectedRoute = { ...route, transport };
      const send = vi
        .fn()
        .mockRejectedValue(new Error("Synthetic stop before any network"));
      const adapter = new BedrockModelProviderAdapter({
        profile: {
          providerFamily: "amazon-bedrock",
          providerId: "cloudmarkup.amazon-bedrock",
          enabled: true,
          profileVersion: "1.0.0",
          capabilities: [
            {
              ...deterministicFakeProviderProfileV1.capabilities[0],
              inferenceProfileId: selectedRoute.invocationTarget,
              modelConfigurationReference:
                selectedRoute.modelConfigurationReference,
              streamingSupported: true,
            },
          ],
        },
        routes: [selectedRoute],
        client: { send },
      });
      await expect(adapter.invoke(invocation)).rejects.toThrow();
      expect(send).toHaveBeenCalledTimes(1);
      const command = send.mock.calls[0]?.[0] as { input: unknown };
      expect(command.input).toEqual(
        buildBedrockConverseRequestV1(invocation, selectedRoute),
      );
    },
  );

  it("reserves again for each retry and never reserves or dispatches expired pricing", async () => {
    const { authority, clock, invocation } = fixture();
    const requests: ModelPlatformReservationInput[] = [];
    const reservations: ModelPlatformSpendReservationPort = {
      reserve: (input) => {
        requests.push(input);
        return Promise.resolve(
          modelPlatformReservationReceiptSchema.parse({
            kind: "reserved",
            dispatchId: input.dispatchId,
            claimDigest: digestStructuredValue(input),
            monthUtc: "2026-09",
            reservedAt: now.toISOString(),
            dispatchBefore: new Date(now.getTime() + 5000).toISOString(),
          }),
        );
      },
    };
    const result: ModelProviderResultV1 = {
      content: { kind: "text", text: "Synthetic response only." },
    };
    const http = vi.fn().mockResolvedValue(result);
    const profile: ModelProviderAdapter["profile"] = {
      providerFamily: "amazon-bedrock",
      providerId: "cloudmarkup.amazon-bedrock",
      enabled: true,
      profileVersion: "1.0.0",
      capabilities: [],
    };
    const bounded = new PlatformSpendBoundModelProviderAdapter({
      costs: authority,
      reservations,
      scope: invocation.descriptor.scope,
      now: () => clock.current,
      httpHandler: { handle: http },
      createDelegate: (handler) => ({
        profile,
        invoke: (value, signal) =>
          handler.handle(value, {
            abortSignal: signal,
          }) as Promise<ModelProviderResultV1>,
      }),
    });
    await bounded.invoke(invocation);
    await bounded.invoke(invocation);
    expect(requests).toHaveLength(2);
    expect(requests[0]?.dispatchId).not.toBe(requests[1]?.dispatchId);
    expect(
      requests.map((request) => request.ceiling.maximumCostMicroUsd),
    ).toEqual([4_204_544, 4_204_544]);
    clock.current = new Date("2026-09-12T00:00:00.000Z");
    await expect(bounded.invoke(invocation)).rejects.toThrow(
      ModelPlatformSpendError,
    );
    expect(requests).toHaveLength(2);
    expect(http).toHaveBeenCalledTimes(2);
  });
});

describe("approved GLOBAL exact-request counted cost authority", () => {
  function countedFixture(kind: "sonnet" | "opus" = "sonnet") {
    const f = fallbackFixture(kind);
    const count = vi
      .spyOn(modelGateway.BedrockConverseInputTokenCounterV1.prototype, "count")
      .mockImplementation((payload) =>
        Promise.resolve({
          policyId: modelGateway.BEDROCK_CONVERSE_TOKEN_COUNT_POLICY_V1,
          invocationDigest: digestStructuredValue(payload),
          requestDigest: digestStructuredValue("synthetic-complete-sdk-count"),
          inputTokens: 1_234,
          countedAt: f.clock.current.toISOString(),
          expiresAt: new Date(f.clock.current.getTime() + 30_000).toISOString(),
        }),
      );
    const authority = new BedrockGlobalCountedInputCostAuthority({
      evidence: f.evidence,
      route: f.route,
      invocation: f.invocation,
      now: () => f.clock.current,
      requestHandler: {
        handle: vi
          .fn()
          .mockRejectedValue(new Error("No network in API cost unit test")),
      },
      assertCurrentAuthority: () =>
        Promise.resolve({
          expiresAt: new Date(f.clock.current.getTime() + 60_000).toISOString(),
        }),
    });
    return { ...f, count, countedAuthority: authority };
  }

  it.each(["sonnet", "opus"] as const)(
    "prices %s counted input at the maximum cache rate plus all reserved output",
    async (kind) => {
      const f = countedFixture(kind);
      try {
        const result = await f.countedAuthority.resolve(f.invocation);
        const expected = Math.ceil(
          (1_234 *
            Math.max(
              ...Object.entries(f.evidence.rates)
                .filter(([key]) => key !== "outputMicroUsdPerMillion")
                .map(([, value]) => value),
            ) +
            f.invocation.maximumOutputTokens *
              f.evidence.rates.outputMicroUsdPerMillion) /
            1_000_000,
        );
        expect(result).toMatchObject({
          invocationDigest: digestStructuredValue(f.invocation),
          modelId: f.evidence.modelId,
          maximumCostMicroUsd: expected,
          validFrom: f.clock.current.toISOString(),
          validUntil: f.evidence.validUntil,
          dispatchValidUntil: new Date(
            f.clock.current.getTime() + 30_000,
          ).toISOString(),
        });
        const full = await f.authority.resolve(f.invocation);
        if (full === null || result === null)
          throw new Error("Missing synthetic pricing");
        expect(result.maximumCostMicroUsd).toBeLessThan(
          full.maximumCostMicroUsd,
        );
        expect(result.pricingVersionDigest).not.toBe(full.pricingVersionDigest);
        expect(f.count).toHaveBeenCalledTimes(1);
        await f.countedAuthority.resolve(f.invocation);
        expect(f.count).toHaveBeenCalledTimes(2);
      } finally {
        f.count.mockRestore();
      }
    },
  );

  it("rejects changed invocation content before counting", async () => {
    const f = countedFixture();
    try {
      expect(
        await f.countedAuthority.resolve({
          ...f.invocation,
          maximumOutputTokens: f.invocation.maximumOutputTokens + 1,
        }),
      ).toBeNull();
      expect(f.count).not.toHaveBeenCalled();
    } finally {
      f.count.mockRestore();
    }
  });

  it.each([
    "unavailable",
    "expired",
    "wrong-binding",
    "pricing-expired",
    "canceled",
  ] as const)(
    "denies %s counting evidence without falling back to unbound pricing",
    async (kind) => {
      const f = countedFixture();
      const controller = new AbortController();
      if (kind === "pricing-expired")
        f.clock.current = new Date(Date.parse(f.evidence.validUntil) - 10_000);
      const receipt = {
        policyId: modelGateway.BEDROCK_CONVERSE_TOKEN_COUNT_POLICY_V1,
        invocationDigest: digestStructuredValue(f.invocation),
        requestDigest: digestStructuredValue("synthetic-complete-sdk-count"),
        inputTokens: 1_234,
        countedAt: f.clock.current.toISOString(),
        expiresAt: new Date(f.clock.current.getTime() + 30_000).toISOString(),
      };
      f.count.mockImplementation(async () => {
        await Promise.resolve(); // Model the asynchronous count response boundary.
        if (kind === "unavailable") return null;
        if (kind === "expired")
          return { ...receipt, expiresAt: f.clock.current.toISOString() };
        if (kind === "wrong-binding")
          return {
            ...receipt,
            invocationDigest: digestStructuredValue("other-request"),
          };
        if (kind === "pricing-expired")
          f.clock.current = new Date(f.evidence.validUntil);
        if (kind === "canceled") controller.abort();
        return receipt;
      });
      try {
        expect(
          await f.countedAuthority.resolve(f.invocation, controller.signal),
        ).toBeNull();
        if (kind === "pricing-expired") {
          expect(f.count).toHaveBeenCalledTimes(1);
          expect(Date.parse(receipt.expiresAt)).toBeGreaterThan(
            f.clock.current.getTime(),
          );
        }
      } finally {
        f.count.mockRestore();
      }
    },
  );

  it("does not count a request when its reviewed pricing has already expired", async () => {
    const f = countedFixture();
    f.clock.current = new Date(f.evidence.validUntil);
    try {
      expect(await f.countedAuthority.resolve(f.invocation)).toBeNull();
      expect(f.count).not.toHaveBeenCalled();
    } finally {
      f.count.mockRestore();
    }
  });

  it("caps the short-lived count receipt at the pricing evidence expiry", async () => {
    const f = countedFixture();
    f.clock.current = new Date(Date.parse(f.evidence.validUntil) - 10_000);
    try {
      expect(await f.countedAuthority.resolve(f.invocation)).toMatchObject({
        validUntil: f.evidence.validUntil,
        dispatchValidUntil: f.evidence.validUntil,
      });
    } finally {
      f.count.mockRestore();
    }
  });
});

describe("explicit V2 fixed-host counted pricing and retained spending", () => {
  function hostFixture(kind: "sonnet" | "opus" = "sonnet") {
    const f = fallbackFixture(kind);
    const invocation = platformSpendHostSeedInvocation(f.invocation);
    const count = vi
      .spyOn(
        modelGateway.BedrockConverseInputTokenCounterV1.prototype,
        "countHostSeedV2",
      )
      .mockImplementation((payload) =>
        Promise.resolve({
          policyId: modelGateway.BEDROCK_CONVERSE_TOKEN_COUNT_POLICY_V1,
          invocationDigest: digestStructuredValue(payload),
          requestDigest: sha256Text("synthetic-count-only"),
          inputTokens: 1234,
          countedAt: f.clock.current.toISOString(),
          expiresAt: new Date(f.clock.current.getTime() + 30_000).toISOString(),
        }),
      );
    const costs = new BedrockGlobalCountedHostSeedCostAuthorityV2({
      evidence: f.evidence,
      route: f.route,
      invocation,
      now: () => f.clock.current,
      requestHandler: {
        handle: vi
          .fn()
          .mockRejectedValue(new Error("Unit tests never access Bedrock.")),
      },
      assertCurrentAuthority: () =>
        Promise.resolve({
          expiresAt: new Date(f.clock.current.getTime() + 60_000).toISOString(),
        }),
    });
    return { ...f, invocation, count, costs };
  }
  it.each(["sonnet", "opus"] as const)(
    "prices complete %s V2 input plus full output and keeps V1 entry points separate",
    async (kind) => {
      const f = hostFixture(kind);
      try {
        const full = await f.authority.resolveHostSeedV2(f.invocation);
        const priced = await f.costs.resolveHostSeedV2(f.invocation);
        const inputRate = Math.max(
          f.evidence.rates.inputMicroUsdPerMillion,
          f.evidence.rates.cacheReadMicroUsdPerMillion,
          f.evidence.rates.cacheWrite5mMicroUsdPerMillion,
          f.evidence.rates.cacheWrite1hMicroUsdPerMillion,
        );
        expect(priced?.maximumCostMicroUsd).toBe(
          Math.ceil(
            (1234 * inputRate +
              f.invocation.maximumOutputTokens *
                f.evidence.rates.outputMicroUsdPerMillion) /
              1_000_000,
          ),
        );
        expect(full).not.toBeNull();
        expect(priced).not.toBeNull();
        expect(priced?.maximumCostMicroUsd).toBeLessThan(
          full?.maximumCostMicroUsd ?? 0,
        );
        expect(priced?.pricingVersionDigest).not.toBe(
          full?.pricingVersionDigest,
        );
        expect(priced?.invocationDigest).toBe(
          digestStructuredValue(f.invocation),
        );
        await f.costs.resolveHostSeedV2(f.invocation);
        expect(f.count).toHaveBeenCalledTimes(2);
        expect(
          await Reflect.apply(
            f.authority.resolve.bind(f.authority),
            undefined,
            [f.invocation],
          ),
        ).toBeNull();
        expect(
          await Reflect.apply(
            f.costs.resolveHostSeedV2.bind(f.costs),
            undefined,
            [fallbackFixture(kind).invocation],
          ),
        ).toBeNull();
      } finally {
        f.count.mockRestore();
      }
    },
  );
  it.each([
    "unscoped",
    "wrong-user",
    "old-prompt",
    "schema",
    "expired",
    "billable-field",
  ] as const)(
    "rejects %s before token counting or reservation",
    async (kind) => {
      const f = hostFixture();
      const changed = structuredClone(f.invocation);
      if (kind === "unscoped")
        changed.descriptor.inputDigest = digestStructuredValue(changed.request);
      if (kind === "wrong-user")
        Object.assign(changed.descriptor.scope, { userId: "user_other" });
      if (kind === "old-prompt") {
        const prompt =
          modelGateway.reviewedModelPromptRegistry.get("candidate.repair");
        if (!prompt) throw Error("Missing historical prompt");
        Object.assign(changed, { prompt });
        Object.assign(changed.descriptor, {
          promptDigest: prompt.digest,
          promptTemplateId: prompt.templateId,
          promptVersion: prompt.version,
        });
      }
      if (kind === "schema")
        Object.assign(changed, {
          responseTool: { ...changed.responseTool, inputSchema: {} },
        });
      if (kind === "expired") f.clock.current = new Date(f.evidence.validUntil);
      if (kind === "billable-field")
        Object.assign(changed, { serviceTier: "priority" });
      try {
        expect(await f.authority.resolveHostSeedV2(changed)).toBeNull();
        expect(await f.costs.resolveHostSeedV2(changed)).toBeNull();
        expect(f.count).not.toHaveBeenCalled();
      } finally {
        f.count.mockRestore();
      }
    },
  );
  it("rejects stale or absent V2 counts and retains the pricing expiry bound", async () => {
    const f = hostFixture();
    try {
      f.count.mockResolvedValueOnce(null);
      expect(await f.costs.resolveHostSeedV2(f.invocation)).toBeNull();
      f.count.mockResolvedValueOnce({
        policyId: modelGateway.BEDROCK_CONVERSE_TOKEN_COUNT_POLICY_V1,
        invocationDigest: digestStructuredValue(f.invocation),
        requestDigest: sha256Text("synthetic"),
        inputTokens: 1234,
        countedAt: f.clock.current.toISOString(),
        expiresAt: f.clock.current.toISOString(),
      });
      expect(await f.costs.resolveHostSeedV2(f.invocation)).toBeNull();
      f.clock.current = new Date(Date.parse(f.evidence.validUntil) - 10_000);
      expect(await f.costs.resolveHostSeedV2(f.invocation)).toMatchObject({
        dispatchValidUntil: f.evidence.validUntil,
      });
    } finally {
      f.count.mockRestore();
    }
  });
  it.each(["success", "unknown", "revoked", "second-send"] as const)(
    "retains one reservation per %s attempt and rechecks the physical send",
    async (outcome) => {
      const f = hostFixture();
      const requests: ModelPlatformReservationInput[] = [];
      const result: ModelProviderResultV1 = {
        content: { kind: "text", text: "synthetic V2 response" },
      };
      const http = vi
        .fn()
        .mockImplementation(() =>
          outcome === "unknown"
            ? Promise.reject(new Error("Synthetic uncertain HTTP handover"))
            : Promise.resolve(result),
        );
      const beforeDispatch = vi.fn().mockImplementation(() =>
        outcome === "revoked"
          ? Promise.reject(new Error("Synthetic revoked stage"))
          : Promise.resolve({
              expiresAt: new Date(
                f.clock.current.getTime() + 60_000,
              ).toISOString(),
            }),
      );
      const bound = new PlatformSpendBoundHostSeedProviderAdapterV2({
        costs: f.costs,
        scope: f.invocation.descriptor.scope,
        now: () => f.clock.current,
        beforeDispatch,
        reservations: {
          reserve: (input) => {
            requests.push(input);
            return Promise.resolve(
              modelPlatformReservationReceiptSchema.parse({
                kind: "reserved",
                dispatchId: input.dispatchId,
                claimDigest: digestStructuredValue(input),
                monthUtc: "2026-09",
                reservedAt: f.clock.current.toISOString(),
                dispatchBefore: new Date(
                  f.clock.current.getTime() + 5000,
                ).toISOString(),
              }),
            );
          },
        },
        httpHandler: { handle: http },
        createDelegate: (handler) => ({
          profile: {
            providerFamily: "amazon-bedrock",
            providerId: "cloudmarkup.amazon-bedrock",
            enabled: true,
            profileVersion: "1.0.0",
            capabilities: [],
          },
          invokeHostSeedV2: async (value, signal) => {
            await handler.handle(value, { abortSignal: signal });
            if (outcome === "second-send")
              await handler.handle(value, { abortSignal: signal });
            return result;
          },
        }),
      });
      try {
        if (outcome === "success")
          await expect(bound.invokeHostSeedV2(f.invocation)).resolves.toEqual(
            result,
          );
        else
          await expect(bound.invokeHostSeedV2(f.invocation)).rejects.toThrow();
        expect(requests).toHaveLength(1);
        expect(beforeDispatch).toHaveBeenCalledTimes(1);
        expect(http).toHaveBeenCalledTimes(outcome === "revoked" ? 0 : 1);
        if (outcome === "success") {
          await bound.invokeHostSeedV2(f.invocation);
          expect(requests).toHaveLength(2);
          expect(requests[0]?.dispatchId).not.toBe(requests[1]?.dispatchId);
        }
      } finally {
        f.count.mockRestore();
      }
    },
  );
});

describe("static V3 first-seed counted pricing and final spending fence", () => {
  function staticFixture(kind: "sonnet" | "opus" = "sonnet") {
    const f = fallbackFixture(kind);
    const invocation = platformSpendHostSeedInvocationV3(f.invocation);
    const count = vi
      .spyOn(
        modelGateway.BedrockConverseInputTokenCounterV1.prototype,
        "countHostSeedV3",
      )
      .mockImplementation((payload) =>
        Promise.resolve({
          policyId: modelGateway.BEDROCK_CONVERSE_TOKEN_COUNT_POLICY_V1,
          invocationDigest: digestStructuredValue(payload),
          requestDigest: sha256Text("synthetic-v3-count"),
          inputTokens: 1234,
          countedAt: f.clock.current.toISOString(),
          expiresAt: new Date(f.clock.current.getTime() + 30000).toISOString(),
        }),
      );
    const costs = new BedrockGlobalCountedHostSeedCostAuthorityV3({
      evidence: f.evidence,
      route: f.route,
      invocation,
      now: () => f.clock.current,
      requestHandler: {
        handle: vi.fn().mockRejectedValue(new Error("No network in this test")),
      },
      assertCurrentAuthority: () =>
        Promise.resolve({
          expiresAt: new Date(f.clock.current.getTime() + 60000).toISOString(),
        }),
    });
    return { ...f, invocation, count, costs };
  }
  it.each(["sonnet", "opus"] as const)(
    "prices the exact %s V3 payload and rejects historical readers",
    async (kind) => {
      const f = staticFixture(kind);
      try {
        const full = await f.authority.resolveHostSeedV3(f.invocation);
        const priced = await f.costs.resolveHostSeedV3(f.invocation);
        expect(priced).not.toBeNull();
        expect(full).not.toBeNull();
        const rates = f.evidence.rates;
        expect(priced?.maximumCostMicroUsd).toBe(
          Math.ceil(
            (1234 *
              Math.max(
                rates.inputMicroUsdPerMillion,
                rates.cacheReadMicroUsdPerMillion,
                rates.cacheWrite5mMicroUsdPerMillion,
                rates.cacheWrite1hMicroUsdPerMillion,
              ) +
              f.invocation.maximumOutputTokens *
                rates.outputMicroUsdPerMillion) /
              1000000,
          ),
        );
        expect(priced?.invocationDigest).toBe(
          digestStructuredValue(f.invocation),
        );
        expect(priced?.pricingVersionDigest).not.toBe(
          full?.pricingVersionDigest,
        );
        expect(
          await Reflect.apply(
            f.authority.resolveHostSeedV2.bind(f.authority),
            undefined,
            [f.invocation],
          ),
        ).toBeNull();
        expect(
          await Reflect.apply(
            f.costs.resolveHostSeedV3.bind(f.costs),
            undefined,
            [platformSpendHostSeedInvocation(fallbackFixture(kind).invocation)],
          ),
        ).toBeNull();
        expect(f.count).toHaveBeenCalledTimes(1);
        f.count.mockResolvedValueOnce(null);
        expect(await f.costs.resolveHostSeedV3(f.invocation)).toBeNull();
      } finally {
        f.count.mockRestore();
      }
    },
  );
  it.each([
    "cache-key",
    "cache-enabled",
    "final-routing",
    "extra-billable-field",
  ] as const)("rejects V3 %s before counting", async (kind) => {
    const f = staticFixture();
    const changed = structuredClone(f.invocation);
    if (kind === "cache-key")
      Object.assign(changed, { promptCacheKey: undefined });
    if (kind === "cache-enabled")
      Object.assign(changed.promptCachePolicy, { enabled: true });
    if (kind === "final-routing")
      Object.assign(changed.descriptor.routing, {
        routingDecisionDigest: sha256Text("fake final route"),
      });
    if (kind === "extra-billable-field")
      Object.assign(changed, { serviceTier: "priority" });
    try {
      expect(await f.authority.resolveHostSeedV3(changed)).toBeNull();
      expect(await f.costs.resolveHostSeedV3(changed)).toBeNull();
      expect(f.count).not.toHaveBeenCalled();
    } finally {
      f.count.mockRestore();
    }
  });
  it("retains each V3 reservation across success, revocation, uncertain failure and repeated-send rejection", async () => {
    const f = staticFixture();
    const requests: ModelPlatformReservationInput[] = [];
    let mode: "success" | "revoked" | "unknown" | "second-send" = "success";
    const result: ModelProviderResultV1 = {
      content: { kind: "text", text: "synthetic V3 response" },
    };
    const http = vi
      .fn()
      .mockImplementation(() =>
        mode === "unknown"
          ? Promise.reject(new Error("Synthetic uncertain send"))
          : Promise.resolve(result),
      );
    const beforeDispatch = vi.fn().mockImplementation(() =>
      mode === "revoked"
        ? Promise.reject(new Error("Synthetic revoked authority"))
        : Promise.resolve({
            expiresAt: new Date(
              f.clock.current.getTime() + 60000,
            ).toISOString(),
          }),
    );
    const bound = new PlatformSpendBoundHostSeedProviderAdapterV3({
      costs: f.costs,
      scope: f.invocation.descriptor.scope,
      now: () => f.clock.current,
      beforeDispatch,
      reservations: {
        reserve: (input) => {
          requests.push(input);
          return Promise.resolve(
            modelPlatformReservationReceiptSchema.parse({
              kind: "reserved",
              dispatchId: input.dispatchId,
              claimDigest: digestStructuredValue(input),
              monthUtc: f.clock.current.toISOString().slice(0, 7),
              reservedAt: f.clock.current.toISOString(),
              dispatchBefore: new Date(
                f.clock.current.getTime() + 5000,
              ).toISOString(),
            }),
          );
        },
      },
      httpHandler: { handle: http },
      createDelegate: (handler) => ({
        profile: {
          providerFamily: "amazon-bedrock",
          providerId: "cloudmarkup.amazon-bedrock",
          enabled: true,
          profileVersion: "1.0.0",
          capabilities: [],
        },
        invokeHostSeedV3: async (value, signal) => {
          await handler.handle(value, { abortSignal: signal });
          if (mode === "second-send")
            await handler.handle(value, { abortSignal: signal });
          return result;
        },
      }),
    });
    try {
      await expect(bound.invokeHostSeedV3(f.invocation)).resolves.toEqual(
        result,
      );
      expect(requests).toHaveLength(1);
      expect(http).toHaveBeenCalledTimes(1);
      mode = "revoked";
      await expect(bound.invokeHostSeedV3(f.invocation)).rejects.toThrow();
      expect(requests).toHaveLength(2);
      expect(http).toHaveBeenCalledTimes(1);
      mode = "unknown";
      await expect(bound.invokeHostSeedV3(f.invocation)).rejects.toThrow();
      expect(requests).toHaveLength(3);
      expect(http).toHaveBeenCalledTimes(2);
      mode = "second-send";
      await expect(bound.invokeHostSeedV3(f.invocation)).rejects.toThrow();
      expect(requests).toHaveLength(4);
      expect(http).toHaveBeenCalledTimes(3);
      expect(new Set(requests.map((entry) => entry.dispatchId)).size).toBe(4);
      expect(beforeDispatch).toHaveBeenCalledTimes(4);
    } finally {
      f.count.mockRestore();
    }
  });
});

describe("final V4 repair pricing and spending", () => {
  function successorFixture(kind: "sonnet" | "opus" = "sonnet") {
    const f = fallbackFixture(kind);
    const invocation = createHostRepairSuccessorTestInvocationV4(
      platformSpendHostSeedInvocationV3(f.invocation),
    );
    const count = vi
      .spyOn(
        modelGateway.BedrockConverseInputTokenCounterV1.prototype,
        "countHostRepairSuccessorV4",
      )
      .mockImplementation((payload) =>
        Promise.resolve({
          policyId: modelGateway.BEDROCK_CONVERSE_TOKEN_COUNT_POLICY_V1,
          invocationDigest: digestStructuredValue(payload),
          requestDigest: sha256Text("synthetic-v4-count"),
          inputTokens: 2345,
          countedAt: f.clock.current.toISOString(),
          expiresAt: new Date(f.clock.current.getTime() + 30000).toISOString(),
        }),
      );
    const costsInput = {
      evidence: f.evidence,
      route: f.route,
      invocation,
      reservedTokenCeiling: {
        input: 2345,
        output: invocation.maximumOutputTokens,
      },
      now: () => f.clock.current,
      requestHandler: {
        handle: vi.fn().mockRejectedValue(new Error("No network in this test")),
      },
      assertCurrentAuthority: () =>
        Promise.resolve({
          expiresAt: new Date(f.clock.current.getTime() + 60000).toISOString(),
        }),
    };
    const costs = new BedrockGlobalCountedHostRepairSuccessorCostAuthorityV4(
      costsInput,
    );

    return { ...f, invocation, count, costs, costsInput };
  }
  it("rejects a count above the already reserved second-call input ceiling", async () => {
    const f = successorFixture();
    try {
      f.count.mockResolvedValueOnce({
        policyId: modelGateway.BEDROCK_CONVERSE_TOKEN_COUNT_POLICY_V1,
        invocationDigest: digestStructuredValue(f.invocation),
        requestDigest: sha256Text("synthetic over-budget count"),
        inputTokens: 2346,
        countedAt: f.clock.current.toISOString(),
        expiresAt: new Date(f.clock.current.getTime() + 30000).toISOString(),
      });
      expect(
        await f.costs.resolveHostRepairSuccessorV4(f.invocation),
      ).toBeNull();
      expect(f.costsInput.requestHandler.handle).not.toHaveBeenCalled();
    } finally {
      f.count.mockRestore();
    }
  });
  it.each([
    "missing",
    "negative",
    "fractional",
    "nonfinite",
    "output",
  ] as const)("denies %s reserved token bounds before counting", (kind) => {
    const f = successorFixture();
    try {
      const input = {
        ...f.costsInput,
        reservedTokenCeiling: { ...f.costsInput.reservedTokenCeiling },
      };
      if (kind === "missing")
        Reflect.deleteProperty(input, "reservedTokenCeiling");
      if (kind === "negative") input.reservedTokenCeiling.input = -1;
      if (kind === "fractional") input.reservedTokenCeiling.input = 1.5;
      if (kind === "nonfinite") input.reservedTokenCeiling.input = Infinity;
      if (kind === "output")
        input.reservedTokenCeiling.output =
          f.invocation.maximumOutputTokens - 1;
      expect(
        () => new BedrockGlobalCountedHostRepairSuccessorCostAuthorityV4(input),
      ).toThrow();
      expect(f.count).not.toHaveBeenCalled();
    } finally {
      f.count.mockRestore();
    }
  });
  it.each(["sonnet", "opus"] as const)(
    "prices the complete %s final repair and keeps historical readers strict",
    async (kind) => {
      const f = successorFixture(kind);
      try {
        const full = await f.authority.resolveHostRepairSuccessorV4(
          f.invocation,
        );
        const priced = await f.costs.resolveHostRepairSuccessorV4(f.invocation);
        expect(full).not.toBeNull();
        expect(priced?.maximumCostMicroUsd).toBe(
          Math.ceil(
            (2345 *
              Math.max(
                f.evidence.rates.inputMicroUsdPerMillion,
                f.evidence.rates.cacheReadMicroUsdPerMillion,
                f.evidence.rates.cacheWrite5mMicroUsdPerMillion,
                f.evidence.rates.cacheWrite1hMicroUsdPerMillion,
              ) +
              f.invocation.maximumOutputTokens *
                f.evidence.rates.outputMicroUsdPerMillion) /
              1000000,
          ),
        );
        expect(priced?.invocationDigest).toBe(
          digestStructuredValue(f.invocation),
        );
        expect(priced?.pricingVersionDigest).not.toBe(
          full?.pricingVersionDigest,
        );
        expect(
          await Reflect.apply(
            f.authority.resolveHostSeedV3.bind(f.authority),
            undefined,
            [f.invocation],
          ),
        ).toBeNull();
        expect(f.count).toHaveBeenCalledTimes(1);
        f.count.mockResolvedValueOnce(null);
        expect(
          await f.costs.resolveHostRepairSuccessorV4(f.invocation),
        ).toBeNull();
      } finally {
        f.count.mockRestore();
      }
    },
  );
  it.each(["historical-input", "prompt"] as const)(
    "rejects %s before final-repair counting",
    async (kind) => {
      const f = successorFixture();
      const changed = structuredClone(f.invocation);
      if (kind === "historical-input")
        Object.assign(changed, {
          request: platformSpendHostSeedInvocationV3(
            fallbackFixture("sonnet").invocation,
          ).request,
        });
      if (kind === "prompt")
        Object.assign(changed.prompt, { content: "substituted" });
      try {
        expect(
          await f.authority.resolveHostRepairSuccessorV4(changed),
        ).toBeNull();
        expect(await f.costs.resolveHostRepairSuccessorV4(changed)).toBeNull();
        expect(f.count).not.toHaveBeenCalled();
      } finally {
        f.count.mockRestore();
      }
    },
  );
  it("retains final-repair spend on revoked or uncertain sends and denies a second physical request", async () => {
    const f = successorFixture();
    const reservations: ModelPlatformReservationInput[] = [];
    let mode: "success" | "revoked" | "unknown" | "second-send" = "success";
    const result: ModelProviderResultV1 = {
      content: { kind: "text", text: "synthetic V4 response" },
    };
    const http = vi
      .fn()
      .mockImplementation(() =>
        mode === "unknown"
          ? Promise.reject(Error("uncertain"))
          : Promise.resolve(result),
      );
    const bound = new PlatformSpendBoundHostRepairSuccessorProviderAdapterV4({
      costs: f.costs,
      scope: f.invocation.descriptor.scope,
      now: () => f.clock.current,
      beforeDispatch: () =>
        mode === "revoked"
          ? Promise.reject(Error("revoked"))
          : Promise.resolve({
              expiresAt: new Date(
                f.clock.current.getTime() + 60000,
              ).toISOString(),
            }),
      reservations: {
        reserve: (claim) => {
          reservations.push(claim);
          return Promise.resolve(
            modelPlatformReservationReceiptSchema.parse({
              kind: "reserved",
              dispatchId: claim.dispatchId,
              claimDigest: digestStructuredValue(claim),
              monthUtc: f.clock.current.toISOString().slice(0, 7),
              reservedAt: f.clock.current.toISOString(),
              dispatchBefore: new Date(
                f.clock.current.getTime() + 5000,
              ).toISOString(),
            }),
          );
        },
      },
      httpHandler: { handle: http },
      createDelegate: (handler) => ({
        profile: {
          providerFamily: "amazon-bedrock",
          providerId: "cloudmarkup.amazon-bedrock",
          enabled: true,
          profileVersion: "1.0.0",
          capabilities: [],
        },
        invokeHostRepairSuccessorV4: async (value, signal) => {
          await handler.handle(value, { abortSignal: signal });
          if (mode === "second-send")
            await handler.handle(value, { abortSignal: signal });
          return result;
        },
      }),
    });
    try {
      await expect(
        bound.invokeHostRepairSuccessorV4(f.invocation),
      ).resolves.toEqual(result);
      mode = "revoked";
      await expect(
        bound.invokeHostRepairSuccessorV4(f.invocation),
      ).rejects.toThrow();
      expect(http).toHaveBeenCalledTimes(1);
      mode = "unknown";
      await expect(
        bound.invokeHostRepairSuccessorV4(f.invocation),
      ).rejects.toThrow();
      mode = "second-send";
      await expect(
        bound.invokeHostRepairSuccessorV4(f.invocation),
      ).rejects.toThrow();
      expect(http).toHaveBeenCalledTimes(3);
      expect(reservations).toHaveLength(4);
      expect(new Set(reservations.map((entry) => entry.dispatchId)).size).toBe(
        4,
      );
    } finally {
      f.count.mockRestore();
    }
  });
});
