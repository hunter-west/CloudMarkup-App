import { afterEach, describe, expect, it, vi } from "vitest";
import {
  digestCanonicalValue as digest,
  normalizedModelUsageV1Schema,
} from "@cloudmarkup/schemas";
import { requireServerByokConfigurationV1 } from "./server-byok-configuration.js";
import {
  createServerByokModelsV1,
  normalizeServerByokOpenAiUsageV1,
  type ServerByokInvocationBindingV1,
  type ServerByokInvocationIdentityV1,
  type ServerByokInvocationLeaseV1,
  type ServerByokInvocationOutcomeV1,
  type ServerByokInvocationPolicyV1,
  type ServerByokUsageObservationV1,
} from "./server-byok-models.js";

const model = "gpt-5.4-2026-03-05"; // Synthetic transport only; availability is not asserted.
function configuration() {
  return {
    contractVersion: 1,
    provider: "openai-responses",
    endpoint: "https://api.openai.com/v1/responses",
    credentialReference: "operator.synthetic-reference",
    usageSemantics: "openai-responses-tokens.v1",
    roles: {
      architecture: { model, maximumOutputTokens: 6144 },
      applicationSource: { model, maximumOutputTokens: 12000 },
    },
    limits: {
      maximumInputBytes: 1048576,
      maximumRequestBytes: 2097152,
      maximumResponseBytes: 1048576,
      deadlineMilliseconds: 1000,
    },
  };
}
function usage() {
  return {
    input_tokens: 1280,
    input_tokens_details: { cached_tokens: 1024 },
    output_tokens: 24,
    output_tokens_details: { reasoning_tokens: 8 },
    total_tokens: 1304,
  };
}
function harness(
  feature: ServerByokInvocationIdentityV1["feature"] = "application-source.generate",
) {
  const events: string[] = [];
  const observations: ServerByokUsageObservationV1[] = [];
  const outcomes: ServerByokInvocationOutcomeV1[] = [];
  let state: "fresh" | "claimed" | "dispatched" | "recorded" | "uncertain" =
    "fresh";
  let binding: ServerByokInvocationBindingV1 | undefined;
  const lease: ServerByokInvocationLeaseV1 = {
    fundingSource: "provider-direct",
    get bindingDigest() {
      if (!binding) throw Error("unclaimed synthetic lease");
      return digest(binding);
    },
    assertCurrent: vi.fn(() => {
      events.push("current");
      return Promise.resolve();
    }),
    markDispatched: vi.fn(() => {
      events.push("dispatch");
      state = "dispatched";
      return Promise.resolve();
    }),
    observeKnownUsage: vi.fn((value: ServerByokUsageObservationV1) => {
      observations.push(value);
      events.push("usage");
      return Promise.resolve();
    }),
    finish: vi.fn((value: ServerByokInvocationOutcomeV1) => {
      outcomes.push(value);
      events.push(`finish:${value.state}`);
      state = "recorded";
      return Promise.resolve();
    }),
    markUncertain: vi.fn(() => {
      state = "uncertain";
      events.push("uncertain");
      return Promise.resolve();
    }),
  };
  const policy: ServerByokInvocationPolicyV1 = {
    fundingSource: "provider-direct",
    identity: {
      attemptNumber: 1,
      feature,
      invocationId: normalizedModelUsageV1Schema.shape.invocationId.parse(
        "synthetic_invocation",
      ),
      usageRecordId: "synthetic_usage",
      idempotencyKeyDigest: digest("stable synthetic job key"),
      scope: {
        userId: "synthetic_user",
        organizationId: "synthetic_org",
        projectId: "synthetic_project",
        jobId: "synthetic_job",
      },
    },
    claim: vi.fn((value: ServerByokInvocationBindingV1) => {
      events.push("claim");
      if (binding && digest(binding) !== digest(value))
        return Promise.resolve({ disposition: "refused" as const });
      if (state === "recorded")
        return Promise.resolve({ disposition: "recorded" as const });
      if (state !== "fresh")
        return Promise.resolve({ disposition: "uncertain" as const });
      binding = value;
      state = "claimed";
      return Promise.resolve({ disposition: "dispatch" as const, lease });
    }),
  };
  const payload = {
    contractVersion: 1,
    workloads: [
      {
        workloadId: "synthetic_workload",
        handler: "export const handler = async () => null;",
        tests: "// synthetic unexecuted tests",
        notes: "Review required.",
      },
    ],
  };
  const response = (
    tool = "application_source",
    output: unknown = payload,
  ) => ({
    model,
    status: "completed",
    error: null,
    incomplete_details: null,
    usage: usage(),
    output: [
      {
        type: "function_call",
        status: "completed",
        name: tool,
        arguments: JSON.stringify(output),
      },
    ],
  });
  const fetcher = vi.fn<typeof fetch>(() => {
    events.push("http");
    return Promise.resolve(Response.json(response()));
  });
  const resolveCredential = vi.fn(() => {
    events.push("key");
    return Promise.resolve("synthetic-private-opaque-token");
  });
  const raw = configuration();
  const create = () =>
    createServerByokModelsV1({
      configuration: raw,
      policy,
      resolveCredential,
      fetch: fetcher,
    });
  const input = {
    context: { workload: "synthetic_workload" },
    signal: new AbortController().signal,
  };
  return {
    raw,
    create,
    input,
    policy,
    lease,
    payload,
    response,
    fetcher,
    resolveCredential,
    events,
    observations,
    outcomes,
    binding: () => binding,
  };
}

describe("server-only Responses BYOK admission", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  it("requires explicit private configuration, fixed endpoint and a complete current-main role set", () => {
    const raw = configuration(),
      parsed = requireServerByokConfigurationV1(raw);
    raw.roles.architecture.model = "changed";
    expect(parsed.roles.architecture.model).toBe(model);
    expect(Object.isFrozen(parsed.roles.architecture)).toBe(true);
    for (const input of [
      undefined,
      {},
      { ...configuration(), endpoint: "http://127.0.0.1/v1/responses" },
      {
        ...configuration(),
        endpoint: "https://api.openai.com.evil.invalid/v1/responses",
      },
      { ...configuration(), apiKey: "synthetic-private-opaque-token" },
      { ...configuration(), roles: {} },
      {
        ...configuration(),
        roles: {
          ...configuration().roles,
          architecture: {
            model: "mutable-model-alias",
            maximumOutputTokens: 6144,
          },
        },
      },
    ])
      expect(() => requireServerByokConfigurationV1(input)).toThrow(
        "Server BYOK configuration is unavailable.",
      );
    vi.stubGlobal("window", {});
    expect(() => harness().create()).toThrow(/admission/u);
  });
  it("persists dispatch and known usage before accepting locally validated output, without double counting cached/reasoning tokens", async () => {
    const f = harness(),
      models = f.create();
    expect(await models.applicationSource(f.input)).toEqual(f.payload);
    expect(f.events).toEqual([
      "key",
      "claim",
      "current",
      "dispatch",
      "http",
      "usage",
      "finish:succeeded",
    ]);
    expect(f.observations[0]).toMatchObject({
      inputUnits: "256",
      cacheReadUnits: "1024",
      outputUnits: "24",
      thinkingUnits: "8",
      cacheWriteUnits: "0",
      modelVersion: model,
    });
    expect(f.binding()).toMatchObject({
      fundingSource: "provider-direct",
      modelVersion: model,
      scope: f.policy.identity.scope,
    });
    const call = f.fetcher.mock.calls[0];
    if (call === undefined) throw Error("Missing synthetic provider request");
    const [endpoint, request] = call;
    if (typeof request?.body !== "string")
      throw Error("Missing bounded JSON request body");
    const body = JSON.parse(request.body) as Record<string, unknown>;
    expect(endpoint).toBe("https://api.openai.com/v1/responses");
    expect(request.redirect).toBe("error");
    expect(body).toMatchObject({
      store: false,
      stream: false,
      parallel_tool_calls: false,
      model,
    });
    expect(JSON.stringify(body)).not.toContain(
      "synthetic-private-opaque-token",
    );
    expect(f.outcomes[0]?.state).toBe("succeeded");
    await expect(models.applicationSource(f.input)).rejects.toThrow(
      /recorded/u,
    );
    expect(f.fetcher).toHaveBeenCalledTimes(1);
  });
  it("rejects contradictory token counters rather than fabricating usage or a monetary price", () => {
    for (const raw of [
      undefined,
      { ...usage(), total_tokens: 1 },
      { ...usage(), input_tokens_details: { cached_tokens: 1281 } },
      { ...usage(), output_tokens_details: { reasoning_tokens: 25 } },
      {
        ...usage(),
        input_tokens_details: { cached_tokens: 1, cache_write_tokens: 2 },
      },
    ])
      expect(() => normalizeServerByokOpenAiUsageV1(raw)).toThrow(/provider/u);
  });
  it("uses the same reviewed architecture schema and prompt under a distinct verified proposal identity", async () => {
    const f = harness("architecture.propose");
    const proposal = {
      contractVersion: 1,
      summary: "A private bucket.",
      resources: [
        {
          key: "bucket",
          serviceType: "aws.s3.bucket",
          label: "Files",
          parentKey: null,
        },
      ],
      connections: [],
      limitations: [],
    };
    f.fetcher.mockResolvedValue(
      Response.json(f.response("infrastructure_proposal", proposal)),
    );
    const result = await f.create().architecture({
      requirements: "A private bucket",
      catalog: {},
      signal: f.input.signal,
    });
    expect(result).toEqual(proposal);
    expect(f.binding()).toMatchObject({
      role: "architecture",
      feature: "architecture.propose",
      promptTemplateId: "cloudmarkup.beta-infrastructure",
      maximumOutputTokens: 4096,
    });
    expect(f.outcomes[0]?.state).toBe("succeeded");
  });
  it("denies wrong scope, input bounds and replay/uncertain dispositions before provider dispatch", async () => {
    const wrong = harness("architecture.propose");
    await expect(wrong.create().applicationSource(wrong.input)).rejects.toThrow(
      /admission/u,
    );
    expect(wrong.resolveCredential).not.toHaveBeenCalled();
    const bounded = harness();
    bounded.raw.limits.maximumInputBytes = 1;
    await expect(
      bounded.create().applicationSource(bounded.input),
    ).rejects.toThrow(/input/u);
    expect(bounded.resolveCredential).not.toHaveBeenCalled();
    for (const disposition of ["refused", "recorded", "uncertain"] as const) {
      const f = harness();
      vi.mocked(f.policy.claim).mockResolvedValue({ disposition });
      await expect(f.create().applicationSource(f.input)).rejects.toThrow();
      expect(f.fetcher).not.toHaveBeenCalled();
      expect(f.lease.markDispatched).not.toHaveBeenCalled();
    }
  });
  it("keeps unknown dispatch or failed usage/terminal persistence held, and never retries the provider", async () => {
    for (const failure of ["transport", "usage", "finish"] as const) {
      const f = harness();
      if (failure === "transport")
        f.fetcher.mockRejectedValue(Error("synthetic transport failure"));
      if (failure === "usage")
        vi.mocked(f.lease.observeKnownUsage).mockRejectedValue(
          Error("synthetic journal failure"),
        );
      if (failure === "finish")
        vi.mocked(f.lease.finish).mockRejectedValue(
          Error("synthetic final journal failure"),
        );
      const models = f.create();
      await expect(models.applicationSource(f.input)).rejects.toThrow(
        /uncertain/u,
      );
      expect(f.lease.markUncertain).toHaveBeenCalledTimes(1);
      await expect(models.applicationSource(f.input)).rejects.toThrow(
        /uncertain/u,
      );
      expect(f.fetcher).toHaveBeenCalledTimes(1);
    }
  });
  it("records known charged usage while refusing secret-bearing, wrong-model or incomplete tool output", async () => {
    for (const change of [
      (f: ReturnType<typeof harness>) => ({
        ...f.response(),
        model: "foreign-model",
      }),
      (f: ReturnType<typeof harness>) => ({
        ...f.response(),
        status: "incomplete",
      }),
      (f: ReturnType<typeof harness>) =>
        f.response("application_source", {
          ...f.payload,
          workloads: [
            {
              ...f.payload.workloads[0],
              notes: "synthetic-private-opaque-token",
            },
          ],
        }),
    ]) {
      const f = harness();
      f.fetcher.mockResolvedValue(Response.json(change(f)));
      await expect(f.create().applicationSource(f.input)).rejects.toThrow(
        /output/u,
      );
      expect(f.observations).toHaveLength(1);
      expect(f.outcomes[0]?.state).toBe("invalid-output");
      expect(f.lease.markUncertain).not.toHaveBeenCalled();
    }
  });
  it("bounds an uncooperative response stream and cancellation without emitting accepted output", async () => {
    for (const failure of ["oversize", "deadline"] as const) {
      const f = harness();
      if (failure === "oversize") f.raw.limits.maximumResponseBytes = 8;
      else {
        f.raw.limits.deadlineMilliseconds = 15;
        f.fetcher.mockImplementation(
          () => new Promise<Response>(() => undefined),
        );
      }
      await expect(f.create().applicationSource(f.input)).rejects.toThrow();
      expect(f.lease.markUncertain).toHaveBeenCalledTimes(1);
      expect(f.outcomes).toHaveLength(0);
    }
  });
});
