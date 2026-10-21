import { describe, expect, it, vi } from "vitest";
import {
  AI_INTENT_PREVIEW_SSE_EVENT_V1,
  acknowledgeAiIntentPreviewV1Schema,
} from "@cloudmarkup/api-contract";
import {
  createBrowserAiIntentPreviewV1,
  type BrowserAiIntentPreviewAuthorityV1,
} from "./ai-intent-preview-client.js";
import { createSyntheticAiPreviewCandidate } from "./ai-intent-preview-test-helpers.js";

const invocationId = "preview_server_synthetic";
const previewUrl =
  "https://beta.example.test/api/v1/projects/project_preview/ai-intent-previews";
function requestJson(value: unknown): unknown {
  if (typeof value !== "string")
    throw new Error("Missing synthetic JSON body.");
  return JSON.parse(value) as unknown;
}
function bodyOf(response: Response) {
  if (response.body === null)
    throw new Error("Missing synthetic response body.");
  return response.body;
}
const status = (code: string) => ({ contractVersion: 1, type: "status", code });
const headers = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "private, no-store, no-transform",
  "content-security-policy": "sandbox",
  "x-content-type-options": "nosniff",
  "x-cloudmarkup-preview-invocation-id": invocationId,
};
function streamResponse(
  changes: Record<string, string> = {},
  statusCode = 200,
) {
  const frame = createSyntheticAiPreviewCandidate(invocationId);
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const value of [status("processing"), frame, status("finished")]) {
          controller.enqueue(
            Uint8Array.from(
              new TextEncoder().encode(
                `event: ${AI_INTENT_PREVIEW_SSE_EVENT_V1}\ndata: ${JSON.stringify(value)}\n\n`,
              ),
            ),
          );
        }
        controller.close();
      },
    }),
    { status: statusCode, headers: { ...headers, ...changes } },
  );
}
function ackResponse(
  body = JSON.stringify({
    apiVersion: "v1",
    data: { contractVersion: 1, state: "acknowledged" },
  }),
) {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Uint8Array.from(new TextEncoder().encode(body)));
        controller.close();
      },
    }),
    { headers: { "content-type": "application/json" } },
  );
}
function fixture() {
  const state: {
    authority: BrowserAiIntentPreviewAuthorityV1 | undefined;
    origin: string;
  } = {
    authority: {
      principalId: "principal_preview",
      sessionId: "session_preview",
      projectId: "project_preview",
      draftEtag: '"draft:draft_preview:v1"',
      editingProof: {
        leaseId: "projectlease_00000000-0000-4000-8000-000000000001",
        token: "A".repeat(43),
      },
      accessToken: "synthetic-access-token-one",
    },
    origin: "https://beta.example.test",
  };
  const controller = new AbortController();
  const retained: ReturnType<
    typeof createSyntheticAiPreviewCandidate
  >["candidate"][] = [];
  const onCandidate = vi.fn((candidate: (typeof retained)[number]) => {
    retained.push(candidate);
  });
  const onStatus = vi
    .fn<(code: string) => undefined>()
    .mockReturnValue(undefined);
  const fetchImplementation = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(streamResponse())
    .mockImplementation(() => {
      expect(retained).toHaveLength(1);
      return Promise.resolve(ackResponse());
    });
  const preview = createBrowserAiIntentPreviewV1({
    currentAuthority: () => state.authority,
    origin: () => state.origin,
    fetchImplementation,
  });
  const input = {
    projectId: "project_preview",
    requirements: "A small notes API.",
    requestedMode: "guided" as const,
    idempotencyKey: "preview_synthetic_one",
    signal: controller.signal,
    onCandidate,
    onStatus,
  };
  return {
    state,
    controller,
    retained,
    onCandidate,
    onStatus,
    fetchImplementation,
    run: (changes: Partial<typeof input> = {}) =>
      preview({ ...input, ...changes }),
  };
}

describe("same-origin memory-only AI preview browser host", () => {
  it("receives a complete candidate before posting the existing content-free acknowledgement", async () => {
    const f = fixture();
    await expect(f.run()).resolves.toEqual({
      contractVersion: 1,
      transport: "finished",
      candidateHandedOff: true,
      acknowledgement: "confirmed",
    });
    expect(f.retained).toHaveLength(1);
    expect(f.fetchImplementation).toHaveBeenCalledTimes(2);
    const [url, request] = f.fetchImplementation.mock.calls[0] ?? [];
    expect(url).toBe(
      "https://beta.example.test/api/v1/projects/project_preview/ai-intent-previews",
    );
    expect(request).toMatchObject({
      method: "POST",
      credentials: "omit",
      mode: "same-origin",
      redirect: "error",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      keepalive: false,
      headers: {
        authorization: "Bearer synthetic-access-token-one",
        "if-match": '"draft:draft_preview:v1"',
        "idempotency-key": "preview_synthetic_one",
      },
    });
    expect(requestJson(request?.body)).toEqual({
      contractVersion: 1,
      requirements: "A small notes API.",
      requestedMode: "guided",
      editingProof: f.state.authority?.editingProof,
    });
    const [ackUrl, acknowledgement] = f.fetchImplementation.mock.calls[1] ?? [];
    expect(ackUrl).toBe(previewUrl + "/acknowledgement");
    const body: unknown = requestJson(acknowledgement?.body);
    expect(acknowledgeAiIntentPreviewV1Schema.parse(body)).toMatchObject({
      contractVersion: 1,
      delivery: {
        invocationId,
        token: "A".repeat(43),
        outputDigest:
          createSyntheticAiPreviewCandidate(invocationId).delivery.outputDigest,
      },
      editingProof: f.state.authority?.editingProof,
    });
    expect(body).not.toHaveProperty("candidate");
    expect(body).not.toHaveProperty("requirements");
  });

  it.each(["principalId", "sessionId", "projectId", "draftEtag"] as const)(
    "cancels the response if %s changes while the request is awaiting headers",
    async (field) => {
      const f = fixture();
      const response = streamResponse();
      const cancel = vi.spyOn(bodyOf(response), "cancel");
      f.fetchImplementation.mockReset().mockImplementation(async () => {
        await Promise.resolve();
        if (f.state.authority !== undefined)
          f.state.authority = { ...f.state.authority, [field]: "changed" };
        return response;
      });
      await expect(f.run()).rejects.toThrow("AI preview is unavailable");
      expect(f.onCandidate).not.toHaveBeenCalled();
      expect(cancel).toHaveBeenCalled();
      expect(f.fetchImplementation).toHaveBeenCalledOnce();
    },
  );

  it.each(["leaseId", "token"] as const)(
    "denies a changed editing %s before candidate handoff",
    async (field) => {
      const f = fixture();
      f.onStatus.mockImplementation((code) => {
        if (code === "processing" && f.state.authority !== undefined)
          f.state.authority = {
            ...f.state.authority,
            editingProof: {
              ...f.state.authority.editingProof,
              [field]: "changed",
            },
          };
        return undefined;
      });
      await expect(f.run()).resolves.toMatchObject({
        candidateHandedOff: false,
        acknowledgement: "not-attempted",
      });
      expect(f.onCandidate).not.toHaveBeenCalled();
      expect(f.fetchImplementation).toHaveBeenCalledOnce();
    },
  );

  it("retains the received candidate but does not acknowledge after the session is lost", async () => {
    const f = fixture();
    f.onCandidate.mockImplementation((candidate) => {
      f.retained.push(candidate);
      f.state.authority = undefined;
    });
    await expect(f.run()).resolves.toMatchObject({
      candidateHandedOff: true,
      acknowledgement: "unconfirmed",
    });
    expect(f.retained).toHaveLength(1);
    expect(f.fetchImplementation).toHaveBeenCalledOnce();
  });

  it("permits token refresh within the same session and reauthorizes the acknowledgement", async () => {
    const f = fixture();
    f.onCandidate.mockImplementation((candidate) => {
      f.retained.push(candidate);
      if (f.state.authority !== undefined)
        f.state.authority = {
          ...f.state.authority,
          accessToken: "synthetic-refreshed-token",
        };
    });
    await expect(f.run()).resolves.toMatchObject({
      acknowledgement: "confirmed",
    });
    expect(f.fetchImplementation.mock.calls[1]?.[1]?.headers).toHaveProperty(
      "authorization",
      "Bearer synthetic-refreshed-token",
    );
  });

  it.each([
    ["cache-control", "public"],
    ["content-type", "application/json"],
    ["content-security-policy", ""],
    ["x-content-type-options", ""],
    ["x-cloudmarkup-preview-invocation-id", ""],
  ] as const)(
    "rejects invalid response header %s without reading it as JSON or retrying",
    async (name, value) => {
      const f = fixture();
      const response = streamResponse({ [name]: value });
      const text = vi.spyOn(response, "text");
      const cancel = vi.spyOn(bodyOf(response), "cancel");
      f.fetchImplementation.mockReset().mockResolvedValue(response);
      await expect(f.run()).rejects.toThrow("AI preview is unavailable");
      expect(text).not.toHaveBeenCalled();
      expect(cancel).toHaveBeenCalled();
      expect(f.fetchImplementation).toHaveBeenCalledOnce();
    },
  );

  it("rejects a candidate whose identity differs from the trusted response header", async () => {
    const f = fixture();
    f.fetchImplementation.mockReset().mockResolvedValue(
      streamResponse({
        "x-cloudmarkup-preview-invocation-id": "preview_other",
      }),
    );
    await expect(f.run()).resolves.toMatchObject({
      candidateHandedOff: false,
      acknowledgement: "not-attempted",
    });
    expect(f.fetchImplementation).toHaveBeenCalledOnce();
  });

  it.each(["oversized", "malformed", "unexpected-state"] as const)(
    "keeps a candidate in RAM with an unconfirmed %s acknowledgement",
    async (kind) => {
      const f = fixture();
      f.fetchImplementation
        .mockReset()
        .mockResolvedValueOnce(streamResponse())
        .mockResolvedValueOnce(
          ackResponse(
            kind === "oversized"
              ? "x".repeat(16 * 1024 + 1)
              : kind === "malformed"
                ? "invalid JSON"
                : JSON.stringify({
                    apiVersion: "v1",
                    data: { contractVersion: 1, state: "accepted" },
                  }),
          ),
        );
      await expect(f.run()).resolves.toMatchObject({
        candidateHandedOff: true,
        acknowledgement: "unconfirmed",
      });
      expect(f.retained).toHaveLength(1);
      expect(f.fetchImplementation).toHaveBeenCalledTimes(2);
    },
  );

  it("ends an uncooperative initial fetch on cancellation and cancels its late response", async () => {
    const f = fixture();
    let release: ((response: Response) => void) | undefined;
    f.fetchImplementation.mockReset().mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const outcome = expect(f.run()).rejects.toThrow(
      "AI preview is unavailable",
    );
    await vi.waitFor(() => {
      expect(f.fetchImplementation).toHaveBeenCalledOnce();
    });
    f.controller.abort();
    await outcome;
    const late = streamResponse();
    const cancel = vi.spyOn(bodyOf(late), "cancel");
    release?.(late);
    await vi.waitFor(() => {
      expect(cancel).toHaveBeenCalled();
    });
    expect(f.onCandidate).not.toHaveBeenCalled();
  });

  it.each([
    "missing-session",
    "other-project",
    "invalid-token",
    "invalid-origin",
    "already-canceled",
  ] as const)("does not send a request for %s", async (kind) => {
    const f = fixture();
    if (kind === "missing-session") f.state.authority = undefined;
    if (kind === "other-project" && f.state.authority !== undefined)
      f.state.authority = { ...f.state.authority, projectId: "project_other" };
    if (kind === "invalid-token" && f.state.authority !== undefined)
      f.state.authority = { ...f.state.authority, accessToken: "bad token" };
    if (kind === "invalid-origin")
      f.state.origin = "http://public.example.test";
    if (kind === "already-canceled") f.controller.abort();
    await expect(f.run()).rejects.toThrow("AI preview is unavailable");
    expect(f.fetchImplementation).not.toHaveBeenCalled();
  });

  it.each([
    ["http://localhost:5173", true],
    ["http://127.0.0.1:5173", true],
    ["http://[::1]:5173", true],
    ["http://localhost:5173", false],
    ["http://127.0.0.1:5173", false],
    ["http://[::1]:5173", false],
  ] as const)(
    "allows loopback %s only in development (%s)",
    async (origin, development) => {
      vi.stubEnv("DEV", development);
      try {
        const f = fixture();
        f.state.origin = origin;
        if (development) {
          await expect(f.run()).resolves.toMatchObject({
            transport: "finished",
          });
          expect(f.fetchImplementation).toHaveBeenCalledTimes(2);
        } else {
          await expect(f.run()).rejects.toThrow("AI preview is unavailable");
          expect(f.fetchImplementation).not.toHaveBeenCalled();
          expect(f.onCandidate).not.toHaveBeenCalled();
        }
      } finally {
        vi.unstubAllEnvs();
      }
    },
  );

  it("cancels an unexpected redirected response before reading content", async () => {
    const f = fixture();
    const response = streamResponse();
    Object.defineProperty(response, "redirected", { value: true });
    const cancel = vi.spyOn(bodyOf(response), "cancel");
    f.fetchImplementation.mockReset().mockResolvedValue(response);
    await expect(f.run()).rejects.toThrow("AI preview is unavailable");
    expect(cancel).toHaveBeenCalled();
    expect(f.onCandidate).not.toHaveBeenCalled();
  });
});
