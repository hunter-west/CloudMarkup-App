import { Writable } from "node:stream";
import type { APIGatewayProxyEvent, Context } from "aws-lambda";
import { aiIntentPreviewFrameV1Schema } from "@cloudmarkup/api-contract";
import { digestStructuredValue } from "@cloudmarkup/model-gateway";
import { modelIntentExtractionResponseV1Schema } from "@cloudmarkup/schemas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApplicationError } from "./application/errors.js";
import type { Principal } from "./application/identity.js";
import { aiPreviewFixture } from "./adapters/persistence/ai-intent-preview-test-helpers.js";
import {
  createAiIntentPreviewStreamingLambdaHandlerV1,
  type AiIntentPreviewStreamingHostV1,
} from "./ai-intent-preview-streaming-lambda.js";

const original: Principal = {
  principalId: "principal_test",
  sessionId: "session_test",
  authenticationSource: "test",
  authenticatedAt: "2026-09-09T17:50:00.000Z",
  expiresAt: "2026-09-09T19:00:00.000Z",
};
const body = {
  contractVersion: 1,
  requirements: "A synthetic small API.\nKeep this exact text.",
  requestedMode: "guided",
  editingProof: {
    leaseId: "projectlease_00000000-0000-4000-8000-000000000001",
    token: "A".repeat(43),
  },
};
const headers = {
  authorization: "Bearer synthetic-preview-token",
  "content-type": "application/json",
  "if-match": '"draft:main:v1"',
  "idempotency-key": "preview_test",
};
const limits = {
  heartbeatMilliseconds: 20,
  backpressureMilliseconds: 50,
  deadlineMilliseconds: 200,
};
const context = { getRemainingTimeInMillis: () => 10000 } as Context;
function event(
  overrides: Partial<APIGatewayProxyEvent> = {},
): APIGatewayProxyEvent {
  return {
    httpMethod: "POST",
    path: "/v1/projects/project_test/ai-intent-previews",
    resource: "/v1/{proxy+}",
    body: JSON.stringify(body),
    isBase64Encoded: false,
    headers,
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    requestContext: { authorizer: { claims: { sub: "forged_gateway_user" } } },
    ...overrides,
  } as APIGatewayProxyEvent;
}
const cleanups: (() => void)[] = [];
function fixture() {
  const chunks: Buffer[] = [];
  const output = Object.assign(
    new Writable({
      write(chunk: Buffer, _encoding, callback) {
        chunks.push(Buffer.from(chunk));
        callback();
      },
    }),
    { setContentType: () => undefined },
  );
  cleanups.push(() => {
    output.destroy();
  });
  const metadata = vi.fn<
    (stream: Writable, value: Record<string, unknown>) => Writable
  >((stream) => stream);
  vi.stubGlobal("awslambda", { HttpResponseStream: { from: metadata } });
  const resolve = vi.fn(
    (authorization: string | undefined): Promise<Principal | null> =>
      Promise.resolve(
        authorization === headers.authorization ? { ...original } : null,
      ),
  );
  const candidate = modelIntentExtractionResponseV1Schema.parse(
    aiPreviewFixture().result.response,
  );
  const authority = vi.fn(() =>
    Promise.resolve({ expiresAt: original.expiresAt }),
  );
  const verifyEmission = vi.fn(() => Promise.resolve());
  const execute = vi.fn<
    Awaited<ReturnType<AiIntentPreviewStreamingHostV1["prepare"]>>["execute"]
  >(async ({ emit, signal }) => {
    await emit({
      candidate,
      delivery: {
        contractVersion: 1,
        invocationId: candidate.provenance.invocationId,
        outputDigest: digestStructuredValue(candidate),
        token: "A".repeat(43),
        expiresAt: new Date(Date.now() + 30000).toISOString(),
      },
      signal: signal ?? new AbortController().signal,
      assertCurrentEmission: verifyEmission,
    });
    return { contractVersion: 1, delivery: "memory-only" };
  });
  const prepared = {
    invocationId: candidate.provenance.invocationId,
    execute,
    assertCurrentAuthority: authority,
  };
  const prepare = vi.fn<AiIntentPreviewStreamingHostV1["prepare"]>(() =>
    Promise.resolve(prepared),
  );
  const handler = createAiIntentPreviewStreamingLambdaHandlerV1({
    principalResolver: { resolve },
    host: { prepare },
    limits,
  });
  const run = (request = event(), runtime = context) =>
    handler(request, output, runtime);
  const response = () => {
    const value = metadata.mock.calls[0]?.[1];
    if (value === undefined)
      throw new Error("Synthetic response has no metadata.");
    if (typeof value["statusCode"] !== "number")
      throw new Error("Synthetic response has no status.");
    return { ...value, statusCode: value["statusCode"] };
  };
  const text = () => Buffer.concat(chunks).toString("utf8");
  const frames = () =>
    chunks.map((chunk) =>
      aiIntentPreviewFrameV1Schema.parse(
        JSON.parse(
          chunk
            .toString("utf8")
            .split("\n")
            .find((line) => line.startsWith("data: "))
            ?.slice(6) ?? "null",
        ),
      ),
    );
  return {
    run,
    resolve,
    prepare,
    prepared,
    execute,
    authority,
    verifyEmission,
    candidate,
    output,
    chunks,
    metadata,
    response,
    text,
    frames,
  };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-09T18:00:00.000Z"));
  vi.stubEnv("CLOUDMARKUP_ENVIRONMENT", "test");
  vi.stubEnv("CLOUDMARKUP_DEPLOYMENT_SHELL", "false");
  vi.stubEnv("CLOUDMARKUP_EDGE_ORIGIN_VERIFICATION", undefined);
});
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("dedicated REST preview streaming Lambda", () => {
  it("authenticates the REST request and streams an exact native candidate with fixed headers", async () => {
    const f = fixture();
    await f.run();
    expect(f.response()).toMatchObject({
      statusCode: 200,
      headers: {
        "cache-control": "private, no-store, no-transform",
        "content-type": "text/event-stream; charset=utf-8",
        "content-security-policy": "sandbox",
        "x-cloudmarkup-preview-invocation-id": f.prepared.invocationId,
      },
    });
    expect(f.prepare).toHaveBeenCalledTimes(1);
    const request = f.prepare.mock.calls[0]?.[0];
    expect(request).toMatchObject({
      principal: original,
      projectId: "project_test",
      request: body,
      draftEtag: headers["if-match"],
      idempotencyKey: headers["idempotency-key"],
    });
    expect(request?.principal.principalId).not.toBe("forged_gateway_user");
    expect(request?.signal.aborted).toBe(true);
    expect(f.frames().map((frame) => frame.type)).toEqual([
      "status",
      "candidate",
      "status",
    ]);
    expect(f.frames()[1]).toMatchObject({ candidate: f.candidate });
    expect(f.execute).toHaveBeenCalledTimes(1);
    expect(f.verifyEmission).toHaveBeenCalledTimes(2);
    expect(f.output.writableFinished).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("accepts canonical base64 JSON and consistent single/multi-value headers", async () => {
    const f = fixture();
    await f.run(
      event({
        body: Buffer.from(JSON.stringify(body)).toString("base64"),
        isBase64Encoded: true,
        multiValueHeaders: { Authorization: [headers.authorization] },
      }),
    );
    expect(f.response().statusCode).toBe(200);
    expect(f.prepare.mock.calls[0]?.[0].request).toEqual(body);
  });
  it.each([undefined, "Bearer forged"])(
    "requires a verified token before body parsing (%s)",
    async (authorization) => {
      const f = fixture();
      const requestHeaders = { ...headers, authorization };
      if (authorization === undefined)
        Reflect.deleteProperty(requestHeaders, "authorization");
      await f.run(event({ headers: requestHeaders, body: "{malformed" }));
      expect(f.response().statusCode).toBe(401);
      expect(f.prepare).not.toHaveBeenCalled();
      expect(f.execute).not.toHaveBeenCalled();
    },
  );
  it("rejects expired authentication and ignores gateway authorizer claims", async () => {
    const f = fixture();
    f.resolve.mockResolvedValue({
      ...original,
      expiresAt: new Date(Date.now()).toISOString(),
    });
    await f.run();
    expect(f.response().statusCode).toBe(401);
    expect(f.prepare).not.toHaveBeenCalled();
  });
  it("enforces the configured edge origin before any authentication or host work", async () => {
    const f = fixture();
    vi.stubEnv("CLOUDMARKUP_ENVIRONMENT", "beta");
    vi.stubEnv("CLOUDMARKUP_EDGE_ORIGIN_VERIFICATION", "a".repeat(40));
    await f.run();
    expect(f.response().statusCode).toBe(403);
    expect(f.resolve).not.toHaveBeenCalled();
    expect(f.prepare).not.toHaveBeenCalled();
  });
  it("accepts the exact edge origin on the protected beta lane", async () => {
    const f = fixture();
    vi.stubEnv("CLOUDMARKUP_ENVIRONMENT", "beta");
    vi.stubEnv("CLOUDMARKUP_EDGE_ORIGIN_VERIFICATION", "a".repeat(40));
    await f.run(
      event({
        headers: { ...headers, "x-cloudmarkup-edge-origin": "a".repeat(40) },
      }),
    );
    expect(f.response().statusCode).toBe(200);
  });
  it.each([
    "access_denied",
    "precondition_failed",
    "not_found",
    "rate_limited",
  ] as const)(
    "preserves safe host denial status without exposing private fields (%s)",
    async (code) => {
      const f = fixture();
      f.prepare.mockRejectedValue(
        new ApplicationError(code, body.requirements, {
          fieldIssues: [
            {
              code: "request.invalid-field",
              message: body.editingProof.token,
              path: [body.editingProof.token],
            },
          ],
        }),
      );
      await f.run();
      expect(f.response().statusCode).toBe(
        new ApplicationError(code, "safe").status,
      );
      expect(f.execute).not.toHaveBeenCalled();
      expect(f.text()).not.toContain(body.requirements);
      expect(f.text()).not.toContain(body.editingProof.token);
    },
  );
  it.each([
    { ...body, organizationId: "org_untrusted" },
    { ...body, modelId: "unapproved-model" },
    { ...body, requirements: "" },
    { ...body, editingProof: { ...body.editingProof, token: "invalid" } },
    { ...body, [body.editingProof.token]: "unknown" },
  ])(
    "rejects injected authority and malformed bodies without echoing unknown keys %#",
    async (request) => {
      const f = fixture();
      await f.run(event({ body: JSON.stringify(request) }));
      expect(f.response().statusCode).toBe(400);
      expect(f.prepare).not.toHaveBeenCalled();
      expect(f.text()).not.toContain(body.editingProof.token);
    },
  );
  it.each([
    { headers: { ...headers, "if-match": 'W/"draft:main:v1"' } },
    { headers: { ...headers, "idempotency-key": undefined } },
    { queryStringParameters: { [body.editingProof.token]: "1" } },
    { multiValueQueryStringParameters: { [body.editingProof.token]: ["1"] } },
    { headers: { ...headers, Authorization: "Bearer different" } },
    {
      multiValueHeaders: {
        authorization: [headers.authorization, headers.authorization],
      },
    },
    { multiValueHeaders: { authorization: ["Bearer different"] } },
    { headers: { ...headers, "content-length": "1" } },
    { headers: { ...headers, "content-encoding": "gzip" } },
    { headers: { ...headers, "content-type": "text/plain" } },
    { path: "/v1/projects/other_tenant/ai-intent-previews" },
    { body: "/w==", isBase64Encoded: true },
    { body: "not base64", isBase64Encoded: true },
  ] satisfies Partial<APIGatewayProxyEvent>[])(
    "rejects malformed headers, selectors, queries and encoding %#",
    async (override) => {
      const f = fixture();
      await f.run(event(override));
      expect(f.response().statusCode).toBe(400);
      expect(f.prepare).not.toHaveBeenCalled();
      expect(f.text()).not.toContain(body.editingProof.token);
    },
  );
  it("bounds the actual UTF-8 body size before parsing", async () => {
    const f = fixture();
    await f.run(event({ body: "💡".repeat(70000) }));
    expect(f.response().statusCode).toBe(413);
    expect(f.prepare).not.toHaveBeenCalled();
  });
  it("never echoes or logs unexpected host errors", async () => {
    const f = fixture();
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    f.prepare.mockRejectedValue(
      new Error(body.requirements + body.editingProof.token),
    );
    await f.run();
    expect(f.response().statusCode).toBe(503);
    expect(f.text()).not.toContain(body.editingProof.token);
    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
  it("rejects a session change after preparation before committing SSE metadata", async () => {
    const f = fixture();
    f.resolve
      .mockResolvedValueOnce(original)
      .mockResolvedValue({ ...original, sessionId: "session_changed" });
    await f.run();
    expect(f.response().statusCode).toBe(401);
    expect(f.execute).not.toHaveBeenCalled();
  });
  it("drops candidate output when authentication is revoked at its native handoff", async () => {
    const f = fixture();
    let calls = 0;
    f.resolve.mockImplementation(() => {
      calls++;
      return Promise.resolve(calls < 4 ? original : null);
    });
    await f.run();
    expect(f.response().statusCode).toBe(200);
    expect(f.frames()).toHaveLength(1);
    expect(f.execute).toHaveBeenCalledTimes(1);
    expect(f.output.destroyed).toBe(true);
  });
  it("uses original principal expiry even if a later resolver returns an extended interval", async () => {
    const f = fixture();
    f.resolve.mockResolvedValueOnce(original).mockResolvedValue({
      ...original,
      expiresAt: "2099-01-01T00:00:00.000Z",
    });
    f.authority.mockImplementation(() => {
      vi.setSystemTime(new Date(original.expiresAt));
      return Promise.resolve({ expiresAt: "2099-01-01T00:00:00.000Z" });
    });
    await f.run();
    expect(f.response().statusCode).toBe(403);
    expect(f.execute).not.toHaveBeenCalled();
  });
  it("bounds uncooperative preparation and never executes a late prepared result", async () => {
    const f = fixture();
    let release: (() => void) | undefined;
    f.prepare.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => {
            resolve(f.prepared);
          };
        }),
    );
    const pending = f.run();
    await vi.advanceTimersByTimeAsync(210);
    await pending;
    expect(f.output.destroyed).toBe(true);
    expect(f.metadata).not.toHaveBeenCalled();
    release?.();
    await Promise.resolve();
    expect(f.execute).not.toHaveBeenCalled();
    expect(f.prepare.mock.calls[0]?.[0].signal.aborted).toBe(true);
  });
  it("stops on disconnect during preparation without releasing another execution", async () => {
    const f = fixture();
    f.prepare.mockImplementation(() => {
      f.output.destroy();
      return Promise.resolve(f.prepared);
    });
    await f.run();
    expect(f.execute).not.toHaveBeenCalled();
    expect(f.metadata).not.toHaveBeenCalled();
  });
  it("rejects payload-v2 and Function-URL-shaped events on the REST lane", async () => {
    const f = fixture();
    await f.run(
      Object.assign(event(), { version: "2.0", rawPath: event().path }),
    );
    expect(f.response().statusCode).toBe(400);
    expect(f.prepare).not.toHaveBeenCalled();
  });
  it("pins the prepared invocation before awaited authority can mutate host metadata", async () => {
    const f = fixture();
    const originalId = f.prepared.invocationId;
    f.authority.mockImplementation(() => {
      Reflect.set(f.prepared, "invocationId", "invocation_mutated");
      return Promise.resolve({ expiresAt: original.expiresAt });
    });
    await f.run();
    expect(f.response()).toMatchObject({
      statusCode: 200,
      headers: { "x-cloudmarkup-preview-invocation-id": originalId },
    });
    expect(f.frames()[1]).toMatchObject({
      type: "candidate",
      delivery: { invocationId: originalId },
    });
  });
  it("finishes errors through the AWS writable facade's native end callback", async () => {
    const f = fixture();
    f.prepare.mockRejectedValue(
      new ApplicationError("access_denied", body.requirements),
    );
    const facade = {
      write: f.output.write.bind(f.output),
      end: f.output.end.bind(f.output),
    };
    f.metadata.mockReturnValue(facade as unknown as Writable);
    await f.run();
    expect(f.output.writableFinished).toBe(true);
    expect(JSON.parse(f.text())).toMatchObject({
      error: { code: "access_denied" },
    });
    expect(vi.getTimerCount()).toBe(0);
  });
  it("emits error metadata through the runtime's first-write hook", async () => {
    const f = fixture();
    f.prepare.mockRejectedValue(
      new ApplicationError("access_denied", body.requirements),
    );
    const underlyingWrite = f.output.write.bind(f.output);
    vi.spyOn(f.output, "write").mockImplementationOnce((chunk: unknown) => {
      if (typeof chunk !== "string")
        throw new Error("Synthetic error body must be JSON.");
      const prelude = Buffer.from(
        JSON.stringify(f.metadata.mock.calls[0]?.[1]),
      );
      return underlyingWrite(
        Buffer.concat([prelude, Buffer.alloc(8), Buffer.from(chunk)]),
      );
    });
    await f.run();
    const wire = Buffer.concat(f.chunks);
    const delimiter = wire.indexOf(Buffer.alloc(8));
    expect(delimiter).toBeGreaterThan(0);
    expect(
      JSON.parse(wire.subarray(0, delimiter).toString("utf8")),
    ).toMatchObject({ statusCode: 403 });
    expect(
      JSON.parse(wire.subarray(delimiter + 8).toString("utf8")),
    ).toMatchObject({
      error: {
        code: "access_denied",
        message: "The AI preview request could not be completed.",
      },
    });
    expect(f.text()).not.toContain(body.requirements);
  });
  it("contains a native metadata failure while constructing a safe error response", async () => {
    const f = fixture();
    f.prepare.mockRejectedValue(new Error(body.requirements));
    f.metadata.mockImplementation(() => {
      throw new Error("synthetic native metadata fault");
    });
    await expect(f.run()).resolves.toBeUndefined();
    expect(f.output.destroyed).toBe(true);
    expect(f.execute).not.toHaveBeenCalled();
    expect(f.chunks).toEqual([]);
  });
  it("refuses an exhausted Lambda deadline before authentication", async () => {
    const f = fixture();
    await f.run(event(), { getRemainingTimeInMillis: () => 250 } as Context);
    expect(f.resolve).not.toHaveBeenCalled();
    expect(f.chunks).toEqual([]);
    expect(f.output.destroyed).toBe(true);
  });
});
