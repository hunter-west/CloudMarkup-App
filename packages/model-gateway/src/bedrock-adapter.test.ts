import { createHostRepairSuccessorTestInvocationV4 } from "./host-repair-successor-test-helpers.js";
import { reviewedHostBoundedRepairPromptV4 } from "./prompts/host-bounded-repair.js";
import { reviewedHostSeedPatchRepairPromptV3 } from "./prompts/host-seed-patch-repair.js";
import { reviewedHostSeedRepairPromptV2 } from "./prompts/host-seed-repair.js";
import { createHash } from "node:crypto";
import {
  createHostSeedRepairTestInvocation,
  createHostSeedRepairTestInvocationV3,
} from "./host-seed-test-helpers.js";
import {
  BedrockRuntimeClient,
  ConverseCommand,
  ConverseStreamCommand,
  type ContentBlock,
  type ConverseStreamOutput,
} from "@aws-sdk/client-bedrock-runtime";
import {
  modelInvocationDescriptorV1Schema,
  namespacedIdentifierSchema,
  sha256DigestSchema,
} from "@cloudmarkup/schemas";
import { describe, expect, it, vi } from "vitest";

import {
  BedrockModelProviderAdapter,
  buildBedrockConverseRequestV1,
  buildBedrockHostSeedConverseRequestV2,
  buildBedrockHostSeedConverseRequestV3,
  buildBedrockHostRepairSuccessorConverseRequestV4,
  BedrockModelProviderConfigurationError,
  toBedrockStructuredOutputSchemaV1,
  type BedrockInvocationTransportV1,
  type BedrockRuntimeClientLikeV1,
} from "./bedrock-adapter.js";
import {
  ModelProviderInvocationError,
  type AmazonBedrockCapabilityProfileV1,
  type ModelProviderInvocationV1,
} from "./ports.js";
import { reviewedModelPromptRegistry } from "./prompts/registry.js";
import { digestStructuredValue } from "./security.js";
import { getModelResponseToolV1 } from "./tools.js";
import { deterministicFakeResponseV1 } from "./fakes.js";
import { modelTestRequests } from "./test-helpers.js";

const digest = sha256DigestSchema.parse(`sha256:${"a".repeat(64)}`);
const modelId = namespacedIdentifierSchema.parse("configured.model.standard");
const profileId = namespacedIdentifierSchema.parse(
  "configured.profile.standard",
);
const configurationReference = namespacedIdentifierSchema.parse(
  "cloudmarkup.bedrock.standard.v1",
);

function profile(
  input: {
    readonly native?: boolean | undefined;
    readonly streaming?: boolean | undefined;
  } = {},
): AmazonBedrockCapabilityProfileV1 {
  return {
    capabilities: [
      {
        acceptedEffortLevels: ["medium", "high"],
        capabilityDigest: digest,
        capabilityRegistryDigest: digest,
        capabilityRegistryId: "cloudmarkup.model-capabilities.amazon-bedrock",
        capabilityRegistryVersion: "1.0.0",
        capabilityVersion: "1.0.0",
        contextLimitTokens: 100_000,
        costTier: "standard",
        dataResidencyBoundary: "cloudmarkup.residency.us.v1",
        evaluation: {
          evaluationPolicyId: "cloudmarkup.model-evaluation.production.v1",
          evaluationPolicyVersion: "1.0.0",
          passed: true,
          resultDigest: digest,
          resultVersion: "1.0.0",
          scoreBasisPoints: 10_000,
        },
        inferenceProfileId: profileId,
        maximumAttempts: 2,
        maximumInputBytes: 1_000_000,
        maximumOutputBytes: 1_000_000,
        maximumOutputTokens: 8_192,
        modelConfigurationReference: configurationReference,
        modelFamily: "configured.model-family",
        modelId,
        modelVersion: "configured-version",
        operations: ["intent.extract", "requirements.blocking-questions"],
        pricingVersionReference: "cloudmarkup.pricing.configured.v1",
        promptCache: {
          maximumCheckpoints: 0,
          minimumCheckpointTokens: 0,
          supported: false,
        },
        roles: ["low-cost-extraction-help", "standard-planning-generation"],
        streamingSupported: input.streaming ?? false,
        structuredOutput: input.native ? "native-json-schema" : "tool-schema",
        supportedModes: ["guided", "professional"],
        timeoutMilliseconds: 5_000,
        usageFieldsExpected: [
          "input-units",
          "output-units",
          "cache-read-units",
          "cache-write-units",
          "thinking-units",
          "provider-request-id",
        ],
      },
    ],
    enabled: true,
    profileVersion: "1.0.0",
    providerFamily: "amazon-bedrock",
    providerId: "cloudmarkup.amazon-bedrock",
  };
}

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

function adapter(input: {
  readonly client: BedrockRuntimeClientLikeV1;
  readonly native?: boolean;
  readonly thinkingMode?: "adaptive";
  readonly toolChoiceMode?: "auto";
  readonly streaming?: boolean;
  readonly transport?: BedrockInvocationTransportV1;
}) {
  return new BedrockModelProviderAdapter({
    client: input.client,
    profile: profile({ native: input.native, streaming: input.streaming }),
    routes: [
      {
        ...(input.thinkingMode === undefined
          ? {}
          : { thinkingMode: input.thinkingMode }),
        ...(input.toolChoiceMode === undefined
          ? {}
          : { toolChoiceMode: input.toolChoiceMode }),
        enabled: true,
        invocationTarget: profileId,
        modelConfigurationReference: configurationReference,
        nativeStructuredOutputSupported: input.native ?? false,
        region: "us-east-1",
        supportedRegions: ["us-east-1"],
        transport: input.transport ?? "converse",
      },
    ],
  });
}

describe("Amazon Bedrock Runtime ModelProvider adapter", () => {
  it("constructs its actual SDK client with the supplied final handler and no hidden retries", async () => {
    const handle = vi
      .fn()
      .mockRejectedValue(new Error("Synthetic transport is never sent."));
    const requestHandler = { handle };
    let configuredHandler: unknown;
    let configuredAttempts: Promise<number> | undefined;
    const send = vi
      .spyOn(BedrockRuntimeClient.prototype, "send")
      .mockImplementation(function (this: BedrockRuntimeClient) {
        configuredHandler = this.config.requestHandler;
        configuredAttempts = this.config.maxAttempts();
        throw new Error("Synthetic SDK boundary stop.");
      });
    try {
      const current = invocation();
      const configured = new BedrockModelProviderAdapter({
        profile: profile(),
        requestHandler,
        routes: [
          {
            enabled: true,
            invocationTarget: profileId,
            modelConfigurationReference: configurationReference,
            nativeStructuredOutputSupported: false,
            region: "us-east-1",
            supportedRegions: ["us-east-1"],
            transport: "converse",
          },
        ],
      });
      await expect(configured.invoke(current)).rejects.toBeInstanceOf(
        ModelProviderInvocationError,
      );
      expect(configuredHandler).toBe(requestHandler);
      await expect(configuredAttempts).resolves.toBe(1);
      expect(handle).not.toHaveBeenCalled();
    } finally {
      send.mockRestore();
    }
  });

  it("rejects an opaque SDK client that would bypass the supplied final handler", () => {
    expect(
      () =>
        new BedrockModelProviderAdapter({
          client: { send: vi.fn().mockResolvedValue({}) },
          profile: profile(),
          routes: [],
          requestHandler: {
            handle: vi.fn().mockRejectedValue(new Error("Unused.")),
          },
        }),
    ).toThrow(
      expect.objectContaining({
        code: "model-provider.configuration-transport-conflict",
      }),
    );
  });

  it("uses one forced schema-only tool without unsupported provider strict mode", async () => {
    const current = invocation();
    if (current.request.operation !== "intent.extract")
      throw new Error("wrong request");
    const response = deterministicFakeResponseV1(current);
    const send = vi.fn<BedrockRuntimeClientLikeV1["send"]>().mockResolvedValue({
      $metadata: { requestId: "provider-request-1" },
      output: {
        message: {
          content: [
            {
              toolUse: {
                input: response,
                name: current.responseTool.toolName,
                toolUseId: "tool-use-1",
              },
            },
          ],
          role: "assistant",
        },
      },
      stopReason: "tool_use",
      usage: {
        cacheReadInputTokens: 3,
        cacheWriteInputTokens: 4,
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
      },
    });
    const result = await adapter({ client: { send } }).invoke(current);
    expect(result.content).toMatchObject({ kind: "tool-use", input: response });
    expect(result.usage).toEqual({
      cacheReadUnits: "3",
      cacheWriteUnits: "4",
      inputUnits: "10",
      outputUnits: "5",
      providerRequestId: "provider-request-1",
      thinkingUnits: "0",
    });
    const command = send.mock.calls[0]?.[0];
    expect(command).toBeInstanceOf(ConverseCommand);
    if (!(command instanceof ConverseCommand)) throw new Error("wrong command");
    expect(command.input.toolConfig?.tools).toHaveLength(1);
    expect(command.input.toolConfig?.tools?.[0]?.toolSpec).toMatchObject({
      name: current.responseTool.toolName,
    });
    expect(
      command.input.toolConfig?.tools?.[0]?.toolSpec?.strict,
    ).toBeUndefined();
    expect(
      command.input.toolConfig?.tools?.[0]?.toolSpec?.inputSchema?.json,
    ).toEqual(current.responseTool.inputSchema);
    expect(command.input.toolConfig?.toolChoice).toEqual({
      tool: { name: current.responseTool.toolName },
    });
    expect(command.input.outputConfig?.textFormat).toBeUndefined();
    expect(command.input.requestMetadata).toEqual(
      expect.objectContaining({ application: "cloudmarkup" }),
    );
    expect(JSON.stringify(command.input.requestMetadata)).not.toContain(
      "organization_bedrock_test",
    );
    expect(JSON.stringify(command.input.requestMetadata)).not.toContain(
      current.request.source.content,
    );
  });

  it("uses native JSON Schema only when the reviewed route supports it", async () => {
    const current = invocation();
    const response = deterministicFakeResponseV1(current);
    const send = vi.fn<BedrockRuntimeClientLikeV1["send"]>().mockResolvedValue({
      $metadata: { requestId: "provider-request-native" },
      output: { message: { content: [{ text: JSON.stringify(response) }] } },
      usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12 },
    });
    await adapter({ client: { send }, native: true }).invoke(current);
    const command = send.mock.calls[0]?.[0];
    if (!(command instanceof ConverseCommand)) throw new Error("wrong command");
    expect(command.input.outputConfig?.textFormat?.type).toBe("json_schema");
    expect(command.input.toolConfig).toBeUndefined();
  });

  it.each(["converse", "converse-stream"] as const)(
    "explicitly requests reviewed adaptive thinking with the forced response tool through %s",
    async (transport) => {
      const current = invocation();
      const response = deterministicFakeResponseV1(current);
      // eslint-disable-next-line @typescript-eslint/require-await -- Synthetic AWS stream.
      async function* stream() {
        yield {
          contentBlockStart: {
            contentBlockIndex: 0,
            start: {
              toolUse: { name: current.responseTool.toolName, toolUseId: "1" },
            },
          },
        };
        yield {
          contentBlockDelta: {
            contentBlockIndex: 0,
            delta: { toolUse: { input: JSON.stringify(response) } },
          },
        };
      }
      const send = vi
        .fn<BedrockRuntimeClientLikeV1["send"]>()
        .mockResolvedValue({
          $metadata: {},
          output: {
            message: {
              content: [
                {
                  toolUse: {
                    input: response,
                    name: current.responseTool.toolName,
                    toolUseId: "1",
                  },
                },
              ],
            },
          },
          stream: stream(),
        });
      await adapter({
        client: { send },
        streaming: true,
        thinkingMode: "adaptive",
        transport,
      }).invoke(current);
      const command = send.mock.calls[0]?.[0];
      if (command === undefined) throw new Error("missing command");
      expect(command.input.additionalModelRequestFields).toEqual({
        thinking: { type: "adaptive" },
      });
      expect(command.input.outputConfig?.effort).toBe("medium");
      expect(command.input.toolConfig?.toolChoice).toEqual({
        tool: { name: current.responseTool.toolName },
      });
      expect(
        command.input.toolConfig?.tools?.[0]?.toolSpec?.strict,
      ).toBeUndefined();
    },
  );

  it.each([
    "unknown",
    "duplicate",
    "native-tool",
    "oversize",
    "truncated",
  ] as readonly (
    | "unknown"
    | "duplicate"
    | "extra-unknown"
    | "native-tool"
    | "oversize"
    | "truncated"
  )[])(
    "rejects %s Converse response content and retains supplied usage",
    async (kind) => {
      const current = invocation();
      const response = deterministicFakeResponseV1(current);
      const validTool: ContentBlock = {
        toolUse: {
          input: response as never,
          name: current.responseTool.toolName,
          toolUseId: "1",
        },
      };
      const unknownTool: ContentBlock = {
        toolUse: { input: {}, name: "unapproved_tool", toolUseId: "2" },
      };
      const content =
        kind === "unknown"
          ? [unknownTool]
          : kind === "duplicate"
            ? [validTool, validTool]
            : kind === "extra-unknown"
              ? [validTool, unknownTool]
              : kind === "native-tool"
                ? [{ text: JSON.stringify(response) }, validTool]
                : [validTool];
      const send = vi
        .fn<BedrockRuntimeClientLikeV1["send"]>()
        .mockResolvedValue({
          $metadata: { requestId: "provider-invalid-response" },
          output: { message: { content } },
          stopReason: kind === "truncated" ? "max_tokens" : undefined,
          usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12 },
        });
      await expect(
        adapter({ client: { send }, native: kind === "native-tool" }).invoke({
          ...current,
          ...(kind === "oversize" ? { maximumOutputBytes: 1 } : {}),
        }),
      ).rejects.toMatchObject({
        safeCode: "model-provider.permanent",
        usage: {
          inputUnits: "8",
          outputUnits: "4",
          providerRequestId: "provider-invalid-response",
        },
      });
    },
  );

  it("bounds native UTF-8 bytes before parsing JSON and allows unconsumed reasoning alongside one tool", async () => {
    const current = invocation();
    const send = vi.fn<BedrockRuntimeClientLikeV1["send"]>().mockResolvedValue({
      $metadata: {},
      output: { message: { content: [{ text: '"éé"' }] } },
    });
    await expect(
      adapter({ client: { send }, native: true }).invoke({
        ...current,
        maximumOutputBytes: 4,
      }),
    ).rejects.toMatchObject({ safeCode: "model-provider.permanent" });
    const response = deterministicFakeResponseV1(current);
    send.mockResolvedValue({
      $metadata: {},
      output: {
        message: {
          content: [
            {
              reasoningContent: {
                reasoningText: {
                  text: "unconsumed synthetic reasoning",
                  signature: "synthetic-signature",
                },
              },
            },
            {
              toolUse: {
                name: current.responseTool.toolName,
                toolUseId: "1",
                input: response,
              },
            },
          ],
        },
      },
      stopReason: "tool_use",
    });
    const result = await adapter({
      client: { send },
      thinkingMode: "adaptive",
    }).invoke(current);
    expect(result.content).toEqual({
      input: response,
      kind: "tool-use",
      toolName: current.responseTool.toolName,
    });
    expect(JSON.stringify(result)).not.toContain(
      "unconsumed synthetic reasoning",
    );
  });

  it.each([
    "unknown",
    "duplicate",
    "wrong-index",
    "no-start",
    "native-tool",
    "truncated",
  ] as const)("rejects %s streamed response channel", async (kind) => {
    const current = invocation();
    const response = deterministicFakeResponseV1(current);
    const start: ConverseStreamOutput = {
      contentBlockStart: {
        contentBlockIndex: 0,
        start: {
          toolUse: {
            name:
              kind === "unknown"
                ? "unapproved_tool"
                : current.responseTool.toolName,
            toolUseId: "1",
          },
        },
      },
    };
    // eslint-disable-next-line @typescript-eslint/require-await -- Synthetic AWS stream.
    async function* stream(): AsyncIterable<ConverseStreamOutput> {
      if (kind !== "no-start") yield start;
      if (kind === "duplicate") yield start;
      yield {
        contentBlockDelta: {
          contentBlockIndex: kind === "wrong-index" ? 1 : 0,
          delta: { toolUse: { input: JSON.stringify(response) } },
        },
      };
      if (kind === "truncated")
        yield { messageStop: { stopReason: "max_tokens" } };
    }
    const send = vi
      .fn<BedrockRuntimeClientLikeV1["send"]>()
      .mockResolvedValue({ $metadata: {}, stream: stream() });
    await expect(
      adapter({
        client: { send },
        native: kind === "native-tool",
        streaming: true,
        transport: "converse-stream",
      }).invoke(current),
    ).rejects.toMatchObject({ safeCode: "model-provider.permanent" });
  });

  it.each([
    ["AccessDeniedException", "model-provider.iam-denied", "permanent"],
    ["ThrottlingException", "model-provider.throttled", "transient"],
    ["ServiceUnavailableException", "model-provider.retryable", "transient"],
  ] as const)(
    "maps %s to a safe stable failure",
    async (name, code, classification) => {
      const send = vi
        .fn()
        .mockRejectedValue(Object.assign(new Error("secret"), { name }));
      await expect(
        adapter({ client: { send } }).invoke(invocation()),
      ).rejects.toMatchObject({
        classification,
        safeCode: code,
      } satisfies Partial<ModelProviderInvocationError>);
    },
  );

  it("propagates cancellation to the SDK request without abandoning it", async () => {
    const send: BedrockRuntimeClientLikeV1["send"] = (_command, options) =>
      new Promise((_resolve, reject) => {
        options?.abortSignal?.addEventListener(
          "abort",
          () => {
            reject(new Error("aborted"));
          },
          {
            once: true,
          },
        );
      });
    const controller = new AbortController();
    const pending = adapter({ client: { send } }).invoke(
      invocation(),
      controller.signal,
    );
    controller.abort();
    await expect(pending).rejects.toMatchObject({
      safeCode: "model-provider.canceled",
    });
  });

  it("aborts the SDK request at the configured route timeout", async () => {
    const send: BedrockRuntimeClientLikeV1["send"] = (_command, options) =>
      new Promise((_resolve, reject) => {
        options?.abortSignal?.addEventListener(
          "abort",
          () => {
            reject(new Error("aborted"));
          },
          { once: true },
        );
      });
    const current = { ...invocation(), timeoutMilliseconds: 10 };
    await expect(
      adapter({ client: { send } }).invoke(current),
    ).rejects.toMatchObject({ safeCode: "model-provider.timeout" });
  });

  it("rejects Region and structured-output configuration contradictions", () => {
    expect(
      () =>
        new BedrockModelProviderAdapter({
          client: { send: vi.fn() },
          profile: profile({ native: false }),
          routes: [
            {
              enabled: true,
              invocationTarget: profileId,
              modelConfigurationReference: configurationReference,
              nativeStructuredOutputSupported: true,
              region: "eu-west-1",
              supportedRegions: ["us-east-1"],
              transport: "converse",
            },
          ],
        }),
    ).toThrow(BedrockModelProviderConfigurationError);
    expect(
      toBedrockStructuredOutputSchemaV1({
        additionalProperties: false,
        properties: { value: { maxLength: 2, type: "string" } },
        type: "object",
      }),
    ).toEqual({
      additionalProperties: false,
      properties: { value: { type: "string" } },
      type: "object",
    });
  });
});

describe("adaptive automatic tool selection", () => {
  it.each(["valid-tool", "plain-text"] as readonly (
    "valid-tool" | "wrong-tool" | "plain-text"
  )[])(
    "uses automatic selection while strictly validating %s",
    async (kind) => {
      const current = invocation();
      const response = deterministicFakeResponseV1(current);
      const send = vi
        .fn<BedrockRuntimeClientLikeV1["send"]>()
        .mockResolvedValue({
          $metadata: {},
          output: {
            message: {
              content:
                kind === "plain-text"
                  ? [{ text: JSON.stringify(response) }]
                  : [
                      {
                        toolUse: {
                          input: response,
                          name:
                            kind === "wrong-tool"
                              ? "unapproved_tool"
                              : current.responseTool.toolName,
                          toolUseId: "1",
                        },
                      },
                    ],
            },
          },
        });
      const work = adapter({
        client: { send },
        thinkingMode: "adaptive",
        toolChoiceMode: "auto",
      }).invoke(current);
      if (kind === "valid-tool")
        await expect(work).resolves.toMatchObject({
          content: {
            kind: "tool-use",
            toolName: current.responseTool.toolName,
          },
        });
      else
        await expect(work).rejects.toBeInstanceOf(ModelProviderInvocationError);
      const command = send.mock.calls[0]?.[0];
      expect(command?.input.toolConfig?.toolChoice).toEqual({ auto: {} });
      expect(command?.input.additionalModelRequestFields).toEqual({
        thinking: { type: "adaptive" },
      });
      expect(command?.input.toolConfig?.tools).toHaveLength(1);
    },
  );
});

describe("explicit fixed-host V2 repair transport", () => {
  it("uses a separate immutable prompt without changing historical repair authority", () => {
    expect(reviewedModelPromptRegistry.get("candidate.repair")).toMatchObject({
      templateId: "cloudmarkup.prompt.candidate-repair",
      version: "1.1.0",
      digest:
        "sha256:d6e1c7bcda6198ce55e9f769e61d3aaa6d2d636875b5a14cf4424f8651c8563f",
    });
    expect(reviewedModelPromptRegistry.list()).not.toContain(
      reviewedHostSeedRepairPromptV2,
    );
    expect(reviewedHostSeedRepairPromptV2.digest).toBe(
      "sha256:" +
        createHash("sha256")
          .update(reviewedHostSeedRepairPromptV2.content)
          .digest("hex"),
    );
    expect(Object.isFrozen(reviewedHostSeedRepairPromptV2)).toBe(true);
    expect(Object.isFrozen(reviewedHostSeedRepairPromptV2.operations)).toBe(
      true,
    );
  });
  function setup(transport: BedrockInvocationTransportV1 = "converse") {
    const current = createHostSeedRepairTestInvocation(invocation());
    const requestHandler = {
      handle: vi
        .fn()
        .mockRejectedValue(new Error("Synthetic handler must not send.")),
    };
    const route = {
      enabled: true,
      invocationTarget: profileId,
      modelConfigurationReference: configurationReference,
      nativeStructuredOutputSupported: false,
      region: "us-east-1",
      supportedRegions: ["us-east-1"],
      transport,
    };
    const p = profile({ streaming: transport === "converse-stream" });
    const capability = p.capabilities[0];
    if (!capability) throw Error("Missing synthetic capability");
    const configured = new BedrockModelProviderAdapter({
      profile: {
        ...p,
        capabilities: [
          {
            ...capability,
            operations: ["candidate.repair"],
            roles: ["repair-escalation"],
          },
        ],
      },
      requestHandler,
      routes: [route],
    });
    return { current, configured, requestHandler, route };
  }
  it("requires the final HTTP handler and keeps V1 entry points closed to V2", async () => {
    const { current, configured, route } = setup();
    const send = vi.fn<BedrockRuntimeClientLikeV1["send"]>();
    await expect(
      adapter({ client: { send } }).invokeHostSeedV2(current),
    ).rejects.toMatchObject({
      code: "model-provider.host-seed-final-handler-required",
    });
    expect(() => {
      Reflect.apply(buildBedrockConverseRequestV1, undefined, [current, route]);
    }).toThrow();
    await expect(
      Reflect.apply(configured.invoke.bind(configured), undefined, [current]),
    ).rejects.toMatchObject({
      code: "model-provider.request-version-unavailable",
    });
    expect(send).not.toHaveBeenCalled();
  });
  it.each(["converse", "converse-stream"] as const)(
    "sends exact counted V2 framing once through %s and normalizes usage",
    async (transport) => {
      const f = setup(transport);
      const response = {
        contractVersion: 1,
        observation: "synthetic-transport-only",
      };
      const events: ConverseStreamOutput[] = [
        {
          contentBlockStart: {
            contentBlockIndex: 0,
            start: {
              toolUse: {
                name: f.current.responseTool.toolName,
                toolUseId: "seed-tool",
              },
            },
          },
        },
        {
          contentBlockDelta: {
            contentBlockIndex: 0,
            delta: { toolUse: { input: JSON.stringify(response) } },
          },
        },
        { contentBlockStop: { contentBlockIndex: 0 } },
        { messageStop: { stopReason: "tool_use" } },
        {
          metadata: {
            metrics: { latencyMs: 1 },
            usage: { inputTokens: 123, outputTokens: 17, totalTokens: 140 },
          },
        },
      ];
      async function* stream(): AsyncIterable<ConverseStreamOutput> {
        for (const event of events) {
          await Promise.resolve();
          yield event;
        }
      }
      let attempts: Promise<number> | undefined;
      let handler: unknown;
      const send = vi
        .spyOn(BedrockRuntimeClient.prototype, "send")
        .mockImplementation(function (this: BedrockRuntimeClient) {
          attempts = this.config.maxAttempts();
          handler = this.config.requestHandler;
          const result = Promise.resolve(
            transport === "converse"
              ? {
                  $metadata: { requestId: "synthetic-seed-request" },
                  stopReason: "tool_use",
                  output: {
                    message: {
                      role: "assistant",
                      content: [
                        {
                          toolUse: {
                            name: f.current.responseTool.toolName,
                            toolUseId: "seed-tool",
                            input: response,
                          },
                        },
                      ],
                    },
                  },
                  usage: {
                    inputTokens: 123,
                    outputTokens: 17,
                    totalTokens: 140,
                  },
                }
              : {
                  $metadata: { requestId: "synthetic-seed-request" },
                  stream: stream(),
                },
          );
          // Match the SDK callback-only overload, as in the existing transport tests.
          return result as never;
        });
      try {
        const pending = f.configured.invokeHostSeedV2(f.current);
        const changedFile = f.current.request.failedCandidates[0];
        if (!changedFile) throw Error("Missing synthetic candidate");
        changedFile.content = "changed after invocation";
        const result = await pending;
        expect(result.content).toMatchObject({
          kind: "tool-use",
          input: response,
        });
        expect(result.usage).toMatchObject({
          inputUnits: "123",
          outputUnits: "17",
          providerRequestId: "synthetic-seed-request",
        });
        expect(send).toHaveBeenCalledTimes(1);
        expect(handler).toBe(f.requestHandler);
        await expect(attempts).resolves.toBe(1);
        const command = send.mock.calls[0]?.[0];
        expect(command).toBeInstanceOf(
          transport === "converse" ? ConverseCommand : ConverseStreamCommand,
        );
        if (
          !(command instanceof ConverseCommand) &&
          !(command instanceof ConverseStreamCommand)
        )
          throw Error("Unexpected SDK command");
        const expected = buildBedrockHostSeedConverseRequestV2(
          createHostSeedRepairTestInvocation(invocation()),
          f.route,
        );
        expect(command.input).toEqual(expected);
        const text = command.input.messages?.[0]?.content?.[0]?.text;
        expect(text).toContain('"sourceAuthority":"fixed-host-synthetic"');
        expect(text).toContain('"contractVersion":2');
        expect(text).not.toContain("changed after invocation");
        expect(f.requestHandler.handle).not.toHaveBeenCalled();
      } finally {
        send.mockRestore();
      }
    },
  );
  it("rejects stale input, prompt, mode, role and response channel before sending", async () => {
    const f = setup();
    const send = vi.spyOn(BedrockRuntimeClient.prototype, "send");
    const changes = [
      (v: typeof f.current) => {
        const old = reviewedModelPromptRegistry.get("candidate.repair");
        if (!old) throw Error("Missing historical prompt");
        Object.assign(v, { prompt: old });
        Object.assign(v.descriptor, {
          promptDigest: old.digest,
          promptTemplateId: old.templateId,
          promptVersion: old.version,
        });
      },
      (v: typeof f.current) => {
        Object.assign(v.descriptor.scope, { userId: "user_synthetic_other" });
      },
      (v: typeof f.current) => {
        v.descriptor.inputDigest = digestStructuredValue(v.request);
      },
      (v: typeof f.current) => {
        v.descriptor.inputDigest = digest;
      },
      (v: typeof f.current) => {
        v.descriptor.promptDigest = digest;
      },
      (v: typeof f.current) => {
        v.descriptor.feature = "intent.extract";
      },
      (v: typeof f.current) => {
        v.descriptor.role = "standard-planning-generation";
      },
      (v: typeof f.current) => {
        v.descriptor.requestedMode = "professional";
      },
      (v: typeof f.current) => {
        const changedFile = v.request.failedCandidates[0];
        if (!changedFile) throw Error("Missing synthetic candidate");
        changedFile.content += "changed";
      },
      (v: typeof f.current) => {
        Object.assign(v, {
          responseTool: getModelResponseToolV1("intent.extract"),
        });
      },
    ];
    try {
      for (const change of changes) {
        const value = structuredClone(f.current);
        change(value);
        await expect(
          f.configured.invokeHostSeedV2(value),
        ).rejects.toMatchObject({
          code: "model-provider.host-seed-binding-invalid",
        });
      }
      await expect(
        Reflect.apply(
          f.configured.invokeHostSeedV2.bind(f.configured),
          undefined,
          [invocation()],
        ),
      ).rejects.toMatchObject({
        code: "model-provider.host-seed-binding-invalid",
      });
      const canceled = new AbortController();
      canceled.abort();
      await expect(
        f.configured.invokeHostSeedV2(f.current, canceled.signal),
      ).rejects.toMatchObject({ safeCode: "model-provider.canceled" });
      expect(send).not.toHaveBeenCalled();
    } finally {
      send.mockRestore();
    }
  });
  it.each([3, 4] as const)(
    "sends the exact V%s payload through the real SDK final HTTP handler once",
    async (version) => {
      vi.stubEnv("AWS_ACCESS_KEY_ID", "SYNTHETIC_SEED_TRANSPORT");
      vi.stubEnv("AWS_SECRET_ACCESS_KEY", "synthetic-seed-transport-value");
      vi.stubEnv("AWS_SESSION_TOKEN", undefined);
      vi.stubEnv("AWS_PROFILE", undefined);
      vi.stubEnv("AWS_EC2_METADATA_DISABLED", "true");
      const f = setup();
      const first = createHostSeedRepairTestInvocationV3(invocation());
      const successor = createHostRepairSuccessorTestInvocationV4(first);
      const current = version === 3 ? first : successor;
      const prompt =
        version === 3
          ? reviewedHostSeedPatchRepairPromptV3
          : reviewedHostBoundedRepairPromptV4;
      expect(current.prompt).toBe(prompt);
      const { modelId: target, ...expected } =
        version === 3
          ? buildBedrockHostSeedConverseRequestV3(first, f.route)
          : buildBedrockHostRepairSuccessorConverseRequestV4(
              successor,
              f.route,
            );
      const response = {
        contractVersion: 1,
        observation: "synthetic-v3-transport",
      };
      let sent: unknown;
      f.requestHandler.handle.mockImplementation((request: unknown) => {
        sent = request;
        return Promise.resolve({
          response: {
            statusCode: 200,
            headers: {
              "content-type": "application/json",
              "x-amzn-requestid": "synthetic-v3-request",
            },
            body: Buffer.from(
              JSON.stringify({
                stopReason: "tool_use",
                output: {
                  message: {
                    role: "assistant",
                    content: [
                      {
                        toolUse: {
                          name: current.responseTool.toolName,
                          toolUseId: "seed-v3-tool",
                          input: response,
                        },
                      },
                    ],
                  },
                },
                usage: { inputTokens: 123, outputTokens: 17, totalTokens: 140 },
              }),
            ),
          },
        });
      });
      try {
        const result =
          version === 3
            ? await f.configured.invokeHostSeedV3(first)
            : await f.configured.invokeHostRepairSuccessorV4(successor);
        if (
          sent === null ||
          typeof sent !== "object" ||
          !("method" in sent) ||
          !("path" in sent) ||
          !("body" in sent)
        )
          throw Error("Missing synthetic SDK request");
        expect(sent.method).toBe("POST");
        expect(sent.path).toBe(
          "/model/" + encodeURIComponent(target ?? "") + "/converse",
        );
        const wire =
          typeof sent.body === "string"
            ? sent.body
            : sent.body instanceof Uint8Array
              ? new TextDecoder().decode(sent.body)
              : null;
        if (wire === null)
          throw Error("Unexpected synthetic SDK body encoding");
        expect(JSON.parse(wire)).toEqual(JSON.parse(JSON.stringify(expected)));
        expect(JSON.parse(wire)).toMatchObject({
          system: [{ text: prompt.content }],
        });

        expect(result.content).toMatchObject({
          kind: "tool-use",
          input: response,
        });
        expect(result.usage).toMatchObject({
          inputUnits: "123",
          outputUnits: "17",
          providerRequestId: "synthetic-v3-request",
        });
        expect(f.requestHandler.handle).toHaveBeenCalledTimes(1);
      } finally {
        vi.unstubAllEnvs();
      }
    },
  );
  it("rejects V3 cache, downstream routing, old descriptors and cancellation before the SDK send", async () => {
    const f = setup();
    const current = createHostSeedRepairTestInvocationV3(invocation());
    for (const change of [
      (value: typeof current) => {
        Object.assign(value, { promptCacheKey: undefined });
      },
      (value: typeof current) => {
        Object.assign(value.promptCachePolicy, { enabled: true });
      },
      (value: typeof current) => {
        Object.assign(value.descriptor.routing, {
          routingDecisionDigest: digest,
        });
      },
      (value: typeof current) => {
        Object.assign(value.descriptor, { contractVersion: 1 });
      },
    ]) {
      const changed = structuredClone(current);
      change(changed);
      await expect(
        f.configured.invokeHostSeedV3(changed),
      ).rejects.toMatchObject({
        code: "model-provider.host-seed-binding-invalid",
      });
    }
    const controller = new AbortController();
    controller.abort();
    await expect(
      f.configured.invokeHostSeedV3(current, controller.signal),
    ).rejects.toMatchObject({ safeCode: "model-provider.canceled" });
    await expect(
      Reflect.apply(
        f.configured.invokeHostSeedV2.bind(f.configured),
        undefined,
        [current],
      ),
    ).rejects.toMatchObject({
      code: "model-provider.host-seed-binding-invalid",
    });
    await expect(
      Reflect.apply(
        f.configured.invokeHostSeedV3.bind(f.configured),
        undefined,
        [f.current],
      ),
    ).rejects.toMatchObject({
      code: "model-provider.host-seed-binding-invalid",
    });
    const send = vi.fn<BedrockRuntimeClientLikeV1["send"]>();
    await expect(
      adapter({ client: { send } }).invokeHostSeedV3(current),
    ).rejects.toMatchObject({
      code: "model-provider.host-seed-final-handler-required",
    });
    expect(send).not.toHaveBeenCalled();
    expect(f.requestHandler.handle).not.toHaveBeenCalled();
  });
  it("requires final repair transport authority and rejects historical inputs before SDK use", async () => {
    const f = setup();
    const first = createHostSeedRepairTestInvocationV3(invocation());
    const current = createHostRepairSuccessorTestInvocationV4(first);
    const send = vi.fn<BedrockRuntimeClientLikeV1["send"]>();
    await expect(
      adapter({ client: { send } }).invokeHostRepairSuccessorV4(current),
    ).rejects.toMatchObject({
      code: "model-provider.repair-successor-final-handler-required",
    });
    for (const entry of [
      f.configured.invoke.bind(f.configured),
      f.configured.invokeHostSeedV2.bind(f.configured),
      f.configured.invokeHostSeedV3.bind(f.configured),
    ])
      await expect(
        Reflect.apply(entry, undefined, [current]),
      ).rejects.toThrow();
    await expect(
      Reflect.apply(
        f.configured.invokeHostRepairSuccessorV4.bind(f.configured),
        undefined,
        [first],
      ),
    ).rejects.toMatchObject({
      code: "model-provider.repair-successor-binding-invalid",
    });
    await expect(
      f.configured.invokeHostRepairSuccessorV4(current, AbortSignal.abort()),
    ).rejects.toMatchObject({
      safeCode: "model-provider.canceled",
    });
    const changed = structuredClone(current);
    changed.request.predecessor.outcomeDigest =
      digestStructuredValue("substituted");
    await expect(
      f.configured.invokeHostRepairSuccessorV4(changed),
    ).rejects.toMatchObject({
      code: "model-provider.repair-successor-binding-invalid",
    });
    expect(send).not.toHaveBeenCalled();
    expect(f.requestHandler.handle).not.toHaveBeenCalled();
  });
});
