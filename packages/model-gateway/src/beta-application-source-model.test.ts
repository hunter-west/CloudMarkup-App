import { describe, expect, it, vi } from "vitest";
import {
  BETA_APPLICATION_SOURCE_MODEL_ID,
  createBetaApplicationSourceModel,
  betaApplicationSourceModelRequest,
} from "./beta-application-source-model.js";

const send = vi.hoisted(() => vi.fn());
it("source v3 has its own strict response version and semantic prompt without changing old prompts", () => {
  const request = betaApplicationSourceModelRequest({
    context: { contextVersion: 3 },
    semantic: true,
  });
  expect(
    request.toolConfig?.tools?.[0]?.toolSpec?.inputSchema?.json,
  ).toHaveProperty("properties.contractVersion.const", 3);
  expect(request.system?.[0]?.text).toContain("declared test expectations");
  for (const reviewed of [false, true]) {
    const old = betaApplicationSourceModelRequest({ context: {}, reviewed });
    expect(old.system?.[0]?.text).not.toContain("For contextVersion 3");
    expect(
      old.toolConfig?.tools?.[0]?.toolSpec?.inputSchema?.json,
    ).toHaveProperty("properties.contractVersion.const", reviewed ? 2 : 1);
  }
});
vi.mock("@aws-sdk/client-bedrock-runtime", () => ({
  BedrockRuntimeClient: class {
    send = send;
  },
  ConverseCommand: class {
    readonly input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  },
}));

describe("beta application source model routing", () => {
  it("requires provider usage for a metered source draft", async () => {
    const source = {
      contractVersion: 1,
      workloads: [
        {
          workloadId: "workload-1",
          handler: "export async function handler() {}",
          tests: "test",
          notes: "Review",
        },
      ],
    };
    send.mockResolvedValueOnce({
      stopReason: "tool_use",
      output: {
        message: {
          content: [{ toolUse: { name: "application_source", input: source } }],
        },
      },
      usage: { inputTokens: 500, outputTokens: 1000 },
      $metadata: { requestId: "bedrock-source-1" },
    });
    const onUsage = vi.fn().mockResolvedValue(undefined);
    await createBetaApplicationSourceModel()({
      context: {},
      signal: new AbortController().signal,
      onUsage,
    });
    expect(onUsage).toHaveBeenCalledWith({
      inputTokens: 500,
      outputTokens: 1000,
      cacheReadInputTokens: 0,
      providerRequestId: "bedrock-source-1",
    });
  });
  it("uses the Claude Sonnet profile for bounded code generation", async () => {
    const output = {
      contractVersion: 1,
      workloads: [
        {
          workloadId: "workload-1",
          handler: "export async function handler() {}",
          tests: "import { test } from 'node:test';",
          notes: "Review before use.",
        },
      ],
    };
    send.mockResolvedValueOnce({
      stopReason: "tool_use",
      output: {
        message: {
          content: [{ toolUse: { name: "application_source", input: output } }],
        },
      },
    });
    const signal = new AbortController().signal;
    expect(
      await createBetaApplicationSourceModel()({ context: {}, signal }),
    ).toEqual(output);
    expect(BETA_APPLICATION_SOURCE_MODEL_ID).toBe(
      "global.anthropic.claude-sonnet-4-6",
    );
    const call = send.mock.calls.at(-1) as readonly unknown[] | undefined;
    const command = call?.[0] as
      | {
          readonly input: {
            readonly modelId: string;
            readonly inferenceConfig: {
              readonly maxTokens: number;
              readonly temperature: number;
            };
            readonly toolConfig: {
              readonly tools: readonly unknown[];
              readonly toolChoice: unknown;
            };
          };
        }
      | undefined;
    expect(command?.input.modelId).toBe(BETA_APPLICATION_SOURCE_MODEL_ID);
    expect(command?.input.inferenceConfig).toEqual({
      maxTokens: 12_000,
      temperature: 0,
    });
    expect(command?.input.toolConfig.tools).toHaveLength(1);
    expect(command?.input.toolConfig.toolChoice).toEqual({
      tool: { name: "application_source" },
    });
    expect(call?.[1]).toEqual({ abortSignal: signal });
  });
});
