import { createHostRepairSuccessorTestInvocationV4 } from "./host-repair-successor-test-helpers.js";
import {
  createHostSeedRepairTestInvocation,
  createHostSeedRepairTestInvocationV3,
} from "./host-seed-test-helpers.js";
import {
  BedrockRuntimeClient,
  CountTokensCommand,
} from "@aws-sdk/client-bedrock-runtime";
import {
  modelInvocationDescriptorV1Schema,
  namespacedIdentifierSchema,
  sha256DigestSchema,
} from "@cloudmarkup/schemas";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  BedrockConverseInputTokenCounterV1,
  type BedrockCountHttpRequestV1,
  type BedrockCountHttpOptionsV1,
} from "./bedrock-token-count.js";
import {
  buildBedrockConverseRequestV1,
  buildBedrockHostSeedConverseRequestV2,
  buildBedrockHostSeedConverseRequestV3,
  buildBedrockHostRepairSuccessorConverseRequestV4,
} from "./bedrock-adapter.js";
import type { ModelProviderInvocationV1 } from "./ports.js";
import { reviewedModelPromptRegistry } from "./prompts/registry.js";
import { digestStructuredValue } from "./security.js";
import { getModelResponseToolV1 } from "./tools.js";
import { modelTestRequests } from "./test-helpers.js";

const digest = sha256DigestSchema.parse(`sha256:${"a".repeat(64)}`);
const modelId = namespacedIdentifierSchema.parse("anthropic.claude-sonnet-4-6");
const profileId = namespacedIdentifierSchema.parse(`global.${modelId}`);
const configurationReference = namespacedIdentifierSchema.parse(
  "cloudmarkup.bedrock.standard.v1",
);
function invocation(): ModelProviderInvocationV1 {
  const request = modelTestRequests().find(
    (candidate) => candidate.operation === "intent.extract",
  );
  if (request === undefined) throw new Error("missing Intent fixture");
  const prompt = reviewedModelPromptRegistry.get(request.operation);
  if (prompt === null) throw new Error("missing prompt");
  return {
    descriptor: {
      ...modelInvocationDescriptorV1Schema.parse({
        budgetDecisionId: "budget_test",
        complexity: "standard",
        contractVersion: 1,
        entitlementDecisionId: "entitlement_test",
        evaluationPolicyId: "cloudmarkup.model-evaluation.production.v1",
        evaluationPolicyVersion: "1.0.0",
        feature: request.operation,
        idempotencyKeyDigest: digest,
        inferenceProfileId: profileId,
        inputDigest: digestStructuredValue(request),
        invocationId: "invocation_bedrock_test",
        modelId,
        modelVersion: "configured-version",
        promptDigest: prompt.digest,
        promptTemplateId: prompt.templateId,
        promptVersion: prompt.version,
        providerFamily: "amazon-bedrock",
        providerId: "cloudmarkup.amazon-bedrock",
        requestedMode: "guided",
        role: "low-cost-extraction-help",
        scope: {
          jobId: "job_bedrock_test",
          organizationId: "organization_bedrock_test",
          projectId: "project_bedrock_test",
          userId: "user_bedrock_test",
        },
        toolAuthority: "none",
      }),
      routing: {
        effort: "medium",
        modelConfigurationReference: configurationReference,
        routeId: "standard-design",
      } as never,
    },
    maximumOutputBytes: 100_000,
    maximumOutputTokens: 8_192,
    prompt,
    promptCachePolicy: {
      cacheKeyRequired: false,
      enabled: false,
      maximumCheckpoints: 0,
      minimumCheckpointTokens: 0,
    },
    request,
    responseTool: getModelResponseToolV1(request.operation),
    timeoutMilliseconds: 5_000,
  };
}

function interceptSdk(
  run: (client: BedrockRuntimeClient, command: unknown) => Promise<unknown>,
) {
  vi.spyOn(BedrockRuntimeClient.prototype, "send").mockImplementation(function (
    this: BedrockRuntimeClient,
    command,
  ) {
    // Adapt the SDK overload whose final signature is its callback-only form.
    return run(this, command) as never;
  });
}
const host = "bedrock-runtime.us-east-1.amazonaws.com";
function fixture() {
  const payload = invocation();
  const route = {
    enabled: true,
    invocationTarget: profileId,
    modelConfigurationReference: configurationReference,
    nativeStructuredOutputSupported: false,
    region: "us-east-1",
    supportedRegions: ["us-east-1"],
    thinkingMode: "adaptive" as const,
    toolChoiceMode: "auto" as const,
    transport: "converse" as const,
  };
  const clock = { current: new Date("2026-09-09T12:00:00.000Z") };
  const authorize = vi.fn(() =>
    Promise.resolve({
      expiresAt: "2026-09-09T12:01:00.000Z",
    }),
  );
  const handle = vi
    .fn<
      (
        request: BedrockCountHttpRequestV1,
        options?: BedrockCountHttpOptionsV1,
      ) => Promise<{
        response: {
          statusCode: number;
          headers: Record<string, string>;
          body: Uint8Array;
        };
      }>
    >()
    .mockResolvedValue({
      response: {
        statusCode: 200,
        headers: { "content-type": "application/json" },
        body: new TextEncoder().encode(JSON.stringify({ inputTokens: 1_234 })),
      },
    });
  const counter = new BedrockConverseInputTokenCounterV1({
    modelId,
    invocationDigest: digestStructuredValue(payload),
    requestHandler: { handle },
    assertCurrentAuthority: authorize,
    now: () => clock.current,
  });
  const command = buildBedrockConverseRequestV1(payload, route);
  const converse = {
    messages: command.messages,
    system: command.system,
    toolConfig: command.toolConfig,
    additionalModelRequestFields: command.additionalModelRequestFields,
  };
  const raw = () => ({
    protocol: "https:",
    hostname: host,
    method: "POST",
    path: `/model/${modelId}/count-tokens`,
    headers: { host, "content-type": "application/json" },
    query: {},
    body: JSON.stringify({ input: { converse } }),
  });
  return { payload, route, clock, authorize, handle, counter, converse, raw };
}

function hostSeedFixture() {
  const base = fixture();
  const payload = createHostSeedRepairTestInvocation(base.payload);
  return completeHostSeedFixture(
    base,
    payload,
    buildBedrockHostSeedConverseRequestV2(payload, base.route),
  );
}
function hostSeedV3Fixture() {
  const base = fixture();
  const payload = createHostSeedRepairTestInvocationV3(base.payload);
  return completeHostSeedFixture(
    base,
    payload,
    buildBedrockHostSeedConverseRequestV3(payload, base.route),
  );
}
function completeHostSeedFixture<
  T extends
    | ReturnType<typeof createHostSeedRepairTestInvocation>
    | ReturnType<typeof createHostSeedRepairTestInvocationV3>
    | ReturnType<typeof createHostRepairSuccessorTestInvocationV4>,
>(
  base: Omit<ReturnType<typeof fixture>, "payload">,
  payload: T,
  command: ReturnType<typeof buildBedrockHostSeedConverseRequestV2>,
) {
  // Synthetic transport only; shared framing does not authenticate a live seed.
  base.counter.destroy();
  const makeCounter = () =>
    new BedrockConverseInputTokenCounterV1({
      modelId,
      invocationDigest: digestStructuredValue(payload),
      requestHandler: { handle: base.handle },
      assertCurrentAuthority: base.authorize,
      now: () => base.clock.current,
    });
  const converse = {
    messages: command.messages,
    system: command.system,
    toolConfig: command.toolConfig,
    additionalModelRequestFields: command.additionalModelRequestFields,
  };
  const raw = () => ({
    ...base.raw(),
    body: JSON.stringify({ input: { converse } }),
  });
  return { ...base, payload, makeCounter, converse, raw };
}

function sentHostSeedBody(
  f: Pick<ReturnType<typeof hostSeedFixture>, "handle">,
): string {
  const body = f.handle.mock.calls[0]?.[0].body;
  if (typeof body === "string") return body;
  if (body instanceof Uint8Array)
    return new TextDecoder("utf-8", { fatal: true }).decode(body);
  throw Error("Missing serialized SDK request");
}

beforeEach(() => {
  // Synthetic signing inputs; the injected transport never opens a socket.
  vi.stubEnv("AWS_ACCESS_KEY_ID", "SYNTHETIC_COUNT_TEST");
  vi.stubEnv("AWS_SECRET_ACCESS_KEY", "synthetic-count-test-value");
  vi.stubEnv("AWS_SESSION_TOKEN", undefined);
  vi.stubEnv("AWS_PROFILE", undefined);
  vi.stubEnv("AWS_EC2_METADATA_DISABLED", "true");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("request-local Bedrock Converse token counting", () => {
  it("serializes the complete real SDK input, including system, framing, schema, cache and thinking", async () => {
    const f = fixture();
    const receipt = await f.counter.count(f.payload, f.route);
    expect(receipt).toEqual({
      policyId: "cloudmarkup.bedrock-converse-token-count.v1",
      invocationDigest: digestStructuredValue(f.payload),
      requestDigest: digestStructuredValue({ input: { converse: f.converse } }),
      inputTokens: 1_234,
      countedAt: "2026-09-09T12:00:00.000Z",
      expiresAt: "2026-09-09T12:00:30.000Z",
    });
    expect(f.handle).toHaveBeenCalledTimes(1);
    const call = f.handle.mock.calls[0];
    if (call === undefined) throw new Error("Missing count handoff");
    const [sent, options] = call;
    expect(sent.path).toBe(`/model/${modelId}/count-tokens`);
    expect(JSON.parse(sent.body as string)).toEqual({
      input: { converse: f.converse },
    });
    expect(
      f.converse.toolConfig?.tools?.[0]?.toolSpec?.inputSchema?.json,
    ).toEqual(f.payload.responseTool.inputSchema);
    expect(f.converse.additionalModelRequestFields).toEqual({
      thinking: { type: "adaptive" },
    });
    expect(f.authorize).toHaveBeenCalledTimes(3);
    expect(options?.abortSignal?.aborted).toBe(true);
    f.counter.destroy();
  });

  it("retains cache points in the counted SDK input", async () => {
    const f = fixture();
    const payload = {
      ...f.payload,
      promptCachePolicy: { ...f.payload.promptCachePolicy, enabled: true },
    };
    const counter = new BedrockConverseInputTokenCounterV1({
      modelId,
      invocationDigest: digestStructuredValue(payload),
      requestHandler: { handle: f.handle },
      assertCurrentAuthority: f.authorize,
      now: () => f.clock.current,
    });
    expect(await counter.count(payload, f.route)).not.toBeNull();
    const call = f.handle.mock.calls[0];
    if (call === undefined) throw new Error("Missing count handoff");
    expect(JSON.parse(call[0].body as string)).toMatchObject({
      input: {
        converse: {
          system: [
            { text: payload.prompt.content },
            { cachePoint: { type: "default" } },
          ],
        },
      },
    });
  });

  it.each([
    "body",
    "hostname",
    "host-header",
    "path",
    "method",
    "query",
    "port",
  ] as const)(
    "rejects an altered %s at the final transport boundary",
    async (kind) => {
      const f = fixture();
      interceptSdk(async (client) => {
        const request = f.raw();
        if (kind === "body")
          request.body = JSON.stringify({
            input: { converse: { messages: [] } },
          });
        if (kind === "hostname") request.hostname = "invalid.example";
        if (kind === "host-header") request.headers.host = "invalid.example";
        if (kind === "path") request.path = "/model/another-model/count-tokens";
        if (kind === "method") request.method = "GET";
        if (kind === "query") Object.assign(request.query, { changed: "true" });
        if (kind === "port") Object.assign(request, { port: 444 });
        await client.config.requestHandler.handle(request);
        return { inputTokens: 1, $metadata: { httpStatusCode: 200 } };
      });
      expect(await f.counter.count(f.payload, f.route)).toBeNull();
      expect(f.handle).not.toHaveBeenCalled();
    },
  );

  it("checks the bytes again after awaited final authorization", async () => {
    const f = fixture();
    const request = f.raw();
    f.authorize.mockImplementation(() => {
      if (f.authorize.mock.calls.length === 2) request.body = "{}";
      return Promise.resolve({ expiresAt: "2026-09-09T12:01:00.000Z" });
    });
    interceptSdk(async (client) => {
      await client.config.requestHandler.handle(request);
      return { inputTokens: 1, $metadata: { httpStatusCode: 200 } };
    });
    expect(await f.counter.count(f.payload, f.route)).toBeNull();
    expect(f.handle).not.toHaveBeenCalled();
  });

  it("allows at most one physical HTTP handoff in a count attempt", async () => {
    const f = fixture();
    let attempts: number | undefined;
    interceptSdk(async (client, command) => {
      expect(command).toBeInstanceOf(CountTokensCommand);
      attempts = await client.config.maxAttempts();
      await client.config.requestHandler.handle(f.raw());
      await client.config.requestHandler.handle(f.raw());
      return { inputTokens: 1, $metadata: { httpStatusCode: 200 } };
    });
    expect(await f.counter.count(f.payload, f.route)).toBeNull();
    expect(attempts).toBe(1);
    expect(f.handle).toHaveBeenCalledTimes(1);
  });

  it("rejects a fabricated SDK success without a guarded HTTP send", async () => {
    const f = fixture();
    vi.spyOn(BedrockRuntimeClient.prototype, "send").mockResolvedValue({
      inputTokens: 1,
      $metadata: { httpStatusCode: 200 },
    } as never);
    expect(await f.counter.count(f.payload, f.route)).toBeNull();
    expect(f.handle).not.toHaveBeenCalled();
  });

  it.each([0, 1.5, 1048577, "1234", null])(
    "rejects malformed token evidence %j",
    async (inputTokens) => {
      const f = fixture();
      f.handle.mockResolvedValue({
        response: {
          statusCode: 200,
          headers: { "content-type": "application/json" },
          body: new TextEncoder().encode(JSON.stringify({ inputTokens })),
        },
      });
      expect(await f.counter.count(f.payload, f.route)).toBeNull();
    },
  );

  it.each(["expired", "rollback", "denied"] as const)(
    "denies %s authority after SDK signing",
    async (kind) => {
      const f = fixture();
      f.authorize.mockImplementation(() => {
        if (f.authorize.mock.calls.length === 2) {
          if (kind === "denied")
            throw new Error("Synthetic authorization denial");
          f.clock.current = new Date(
            kind === "expired"
              ? "2026-09-09T12:01:00Z"
              : "2026-09-09T11:59:59Z",
          );
        }
        return Promise.resolve({ expiresAt: "2026-09-09T12:01:00.000Z" });
      });
      expect(await f.counter.count(f.payload, f.route)).toBeNull();
      expect(f.handle).not.toHaveBeenCalled();
    },
  );

  it("rejects a count if authority is revoked while the response is in flight", async () => {
    const f = fixture();
    f.authorize.mockImplementation(() => {
      if (f.authorize.mock.calls.length === 3)
        throw new Error("Synthetic revocation");
      return Promise.resolve({ expiresAt: "2026-09-09T12:01:00.000Z" });
    });
    expect(await f.counter.count(f.payload, f.route)).toBeNull();
    expect(f.handle).toHaveBeenCalledTimes(1);
  });

  it("cancels promptly while an uncooperative authorization callback is pending", async () => {
    const f = fixture();
    let release!: (value: { expiresAt: string }) => void;
    f.authorize.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const controller = new AbortController();
    const count = f.counter.count(f.payload, f.route, controller.signal);
    controller.abort();
    expect(await count).toBeNull();
    release({ expiresAt: "2026-09-09T12:01:00.000Z" });
    await Promise.resolve();
    expect(f.handle).not.toHaveBeenCalled();
  });

  it("times out without permitting a late response to become a valid receipt", async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.authorize.mockImplementation(
      () =>
        new Promise(() => {
          /* Simulate an authority provider that never responds. */
        }),
    );
    const count = f.counter.count(f.payload, f.route);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await count).toBeNull();
    expect(f.handle).not.toHaveBeenCalled();
  });

  it("bounds receipt freshness by current authorization", async () => {
    const f = fixture();
    f.authorize.mockResolvedValue({ expiresAt: "2026-09-09T12:00:05.000Z" });
    expect(await f.counter.count(f.payload, f.route)).toMatchObject({
      expiresAt: "2026-09-09T12:00:05.000Z",
    });
  });

  it.each([
    "invocation",
    "native",
    "region",
    "configuration",
    "target",
    "disabled",
    "abort",
  ] as const)(
    "rejects changed %s before SDK or transport work",
    async (kind) => {
      const f = fixture();
      const payload =
        kind === "invocation"
          ? { ...f.payload, maximumOutputTokens: 9_000 }
          : f.payload;
      const route = { ...f.route };
      if (kind === "native") route.nativeStructuredOutputSupported = true;
      if (kind === "region") route.supportedRegions = [];
      if (kind === "configuration")
        route.modelConfigurationReference = namespacedIdentifierSchema.parse(
          "changed.configuration",
        );
      if (kind === "target")
        route.invocationTarget =
          namespacedIdentifierSchema.parse("changed.target");
      if (kind === "disabled") route.enabled = false;
      const controller = new AbortController();
      if (kind === "abort") controller.abort();
      expect(
        await f.counter.count(payload, route, controller.signal),
      ).toBeNull();
      expect(f.authorize).not.toHaveBeenCalled();
      expect(f.handle).not.toHaveBeenCalled();
    },
  );

  it("does not enable an unverified model version for CountTokens", () => {
    const f = fixture();
    expect(
      () =>
        new BedrockConverseInputTokenCounterV1({
          modelId: "anthropic.claude-sonnet-5",
          invocationDigest: digestStructuredValue(f.payload),
          requestHandler: { handle: f.handle },
          assertCurrentAuthority: f.authorize,
        }),
    ).toThrow("The token counting configuration is unavailable.");
  });
});

describe("explicit host-seed V2 token counting", () => {
  it("counts the complete SDK input while retaining host provenance and the strict V1 response schema", async () => {
    const f = hostSeedFixture();
    const counter = f.makeCounter();
    const result = await counter.countHostSeedV2(f.payload, f.route);
    expect(result).toMatchObject({
      invocationDigest: digestStructuredValue(f.payload),
      requestDigest: digestStructuredValue({ input: { converse: f.converse } }),
      inputTokens: 1234,
    });
    expect(f.handle).toHaveBeenCalledTimes(1);
    const body = sentHostSeedBody(f);
    expect(JSON.parse(body) as unknown).toEqual({
      input: { converse: f.converse },
    });
    expect(body).toContain("fixed-host-synthetic");
    expect(body).toContain("user-owned");
    expect(
      f.converse.toolConfig?.tools?.[0]?.toolSpec?.inputSchema?.json,
    ).toEqual(getModelResponseToolV1("candidate.repair").inputSchema);
    expect(f.authorize).toHaveBeenCalledTimes(3);
    counter.destroy();
  });
  it.each(["ownership", "content", "feature", "response"] as const)(
    "rejects coherently bound invalid %s before authorization or HTTP",
    async (kind) => {
      const f = hostSeedFixture();
      const file = f.payload.request.failedCandidates[0];
      if (!file) throw Error("Missing seed fixture");
      if (kind === "ownership")
        Object.assign(file, { ownership: "ai-authored-candidate" });
      if (kind === "content") file.content += "substituted";
      if (kind === "feature")
        Object.assign(f.payload.descriptor, { feature: "intent.extract" });
      if (kind === "response")
        Object.assign(f.payload.responseTool, { operation: "intent.extract" });
      const counter = f.makeCounter();
      expect(await counter.countHostSeedV2(f.payload, f.route)).toBeNull();
      expect(f.authorize).not.toHaveBeenCalled();
      expect(f.handle).not.toHaveBeenCalled();
      counter.destroy();
    },
  );

  it("captures immutable RAM input before awaited authorization", async () => {
    const f = hostSeedFixture();
    const expected = structuredClone(f.converse);
    f.authorize.mockImplementation(() => {
      const file = f.payload.request.failedCandidates[0];
      if (!file) throw Error("Missing seed fixture");
      file.content = "caller changed content after capture";
      return Promise.resolve({ expiresAt: "2026-09-09T12:01:00.000Z" });
    });
    const counter = f.makeCounter();
    expect(await counter.countHostSeedV2(f.payload, f.route)).not.toBeNull();
    const body = sentHostSeedBody(f);
    expect(JSON.parse(body) as unknown).toEqual({
      input: { converse: expected },
    });
    counter.destroy();
  });
  it("denies cancellation before counting a V2 input", async () => {
    const f = hostSeedFixture();
    const signal = AbortSignal.abort();
    const counter = f.makeCounter();
    expect(
      await counter.countHostSeedV2(f.payload, f.route, signal),
    ).toBeNull();
    expect(f.authorize).not.toHaveBeenCalled();
    expect(f.handle).not.toHaveBeenCalled();
    counter.destroy();
  });
});

describe.each([3, 4] as const)(
  "one-way repair V%s full-input counting",
  (version) => {
    function currentFixture() {
      const f = hostSeedV3Fixture();
      if (version === 3)
        return {
          ...f,
          command: buildBedrockHostSeedConverseRequestV3(f.payload, f.route),
          count: (
            counter: BedrockConverseInputTokenCounterV1,
            signal?: AbortSignal,
          ) => counter.countHostSeedV3(f.payload, f.route, signal),
        };
      const payload = createHostRepairSuccessorTestInvocationV4(f.payload);
      const command = buildBedrockHostRepairSuccessorConverseRequestV4(
        payload,
        f.route,
      );
      const next = completeHostSeedFixture(f, payload, command);
      return {
        ...next,
        command,
        count: (
          counter: BedrockConverseInputTokenCounterV1,
          signal?: AbortSignal,
        ) => counter.countHostRepairSuccessorV4(payload, f.route, signal),
      };
    }
    it("counts the exact SDK body with high effort and no final decision reference", async () => {
      const f = currentFixture();
      const command = f.command;
      expect(command.outputConfig?.effort).toBe("high");
      expect(f.payload.descriptor.routing).not.toHaveProperty(
        "routingDecisionDigest",
      );
      const counter = f.makeCounter();
      const result = await f.count(counter);
      expect(result).toMatchObject({
        invocationDigest: digestStructuredValue(f.payload),
        requestDigest: digestStructuredValue({
          input: { converse: f.converse },
        }),
        inputTokens: 1234,
      });
      expect(JSON.parse(sentHostSeedBody(f)) as unknown).toEqual({
        input: { converse: f.converse },
      });
      expect(f.authorize).toHaveBeenCalledTimes(3);
      expect(f.handle).toHaveBeenCalledTimes(1);
      expect(() => {
        Reflect.apply(buildBedrockHostSeedConverseRequestV2, undefined, [
          f.payload,
          f.route,
        ]);
      }).toThrow();
      counter.destroy();
    });
    it.each([
      "final-decision",
      "credits",
      "legacy-version",
      "cache",
      "effort",
      "content",
    ] as const)(
      "rejects coherently bound invalid %s before authorization or HTTP",
      async (kind) => {
        const f = currentFixture();
        if (kind === "final-decision")
          Object.assign(f.payload.descriptor.routing, {
            routingDecisionDigest: digestStructuredValue("substituted"),
          });
        if (kind === "credits")
          Object.assign(f.payload.descriptor.routing, {
            acceptedMaximumCreditUnits: 1,
          });
        if (kind === "legacy-version")
          Object.assign(f.payload.descriptor, { contractVersion: 1 });
        if (kind === "cache")
          Object.assign(f.payload.promptCachePolicy, { enabled: true });
        if (kind === "effort")
          Object.assign(f.payload.descriptor.routing, { effort: "xhigh" });
        if (kind === "content") {
          const file = f.payload.request.failedCandidates[0];
          if (!file) throw Error("Missing synthetic source");
          file.content += "substituted";
        }
        const counter = f.makeCounter();
        expect(await f.count(counter)).toBeNull();
        expect(f.authorize).not.toHaveBeenCalled();
        expect(f.handle).not.toHaveBeenCalled();
        counter.destroy();
      },
    );
    if (version === 3)
      it("rechecks authority at the final HTTP handoff", async () => {
        const f = currentFixture();
        f.authorize.mockImplementation(() =>
          f.authorize.mock.calls.length === 2
            ? Promise.reject(Error("Synthetic withdrawal"))
            : Promise.resolve({ expiresAt: "2026-09-09T12:01:00.000Z" }),
        );
        const counter = f.makeCounter();
        expect(await f.count(counter)).toBeNull();
        expect(f.handle).not.toHaveBeenCalled();
        counter.destroy();
      });
    if (version === 3)
      it("invalidates a count attempt when its complete body is substituted", async () => {
        const f = currentFixture();
        interceptSdk(async (client) => {
          await expect(
            client.config.requestHandler.handle({ ...f.raw(), body: "{}" }),
          ).rejects.toThrow();
          return { inputTokens: 1234, $metadata: { httpStatusCode: 200 } };
        });
        const counter = f.makeCounter();
        expect(await f.count(counter)).toBeNull();
        expect(f.handle).not.toHaveBeenCalled();
        counter.destroy();
      });
    if (version === 3)
      it("requires a successful HTTP response even when middleware returns token data", async () => {
        const f = currentFixture();
        f.handle.mockImplementation(() =>
          Promise.resolve({
            response: {
              statusCode: 503,
              headers: { "content-type": "application/json" },
              body: Buffer.from(
                JSON.stringify({ message: "Synthetic unavailable response" }),
              ),
            },
          }),
        );
        interceptSdk(async (client) => {
          await client.config.requestHandler.handle(f.raw());
          return { inputTokens: 1234, $metadata: { httpStatusCode: 200 } };
        });
        const counter = f.makeCounter();
        expect(await f.count(counter)).toBeNull();
        expect(f.handle).toHaveBeenCalledTimes(1);
        counter.destroy();
      });
    if (version === 3)
      it("permits only one physical send for one V3 count context", async () => {
        const f = currentFixture();
        interceptSdk(async (client) => {
          await client.config.requestHandler.handle(f.raw());
          await expect(
            client.config.requestHandler.handle(f.raw()),
          ).rejects.toThrow();
          return { inputTokens: 1234, $metadata: { httpStatusCode: 200 } };
        });
        const counter = f.makeCounter();
        expect(await f.count(counter)).not.toBeNull();
        expect(f.handle).toHaveBeenCalledTimes(1);
        counter.destroy();
      });
    it("rejects cancellation before current authority or HTTP", async () => {
      const f = currentFixture();
      const counter = f.makeCounter();
      expect(await f.count(counter, AbortSignal.abort())).toBeNull();
      expect(f.authorize).not.toHaveBeenCalled();
      expect(f.handle).not.toHaveBeenCalled();
      counter.destroy();
    });
  },
);
