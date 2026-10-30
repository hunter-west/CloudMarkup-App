import { afterEach, expect, it, vi } from "vitest";
import type { BetaInfrastructureJobCreditsV1 } from "@cloudmarkup/api-contract";
import {
  BetaInfrastructureAccessDeniedError,
  BetaInfrastructureRequestError,
  requestBetaInfrastructureProposal,
} from "./beta-infrastructure-client.js";
import { loadBlankAwsEditorArchitectureDocument } from "../../provider-catalog/aws-editor-fixture.js";
import { digestCanonicalValue } from "@cloudmarkup/schemas";
const document = loadBlankAwsEditorArchitectureDocument("us-east-1");
const digest = digestCanonicalValue(document);
const proposal = {
  contractVersion: 3,
  summary: "A files bucket",
  resources: [
    {
      key: "files",
      label: "Files",
      serviceType: "aws.s3.bucket",
      parentKey: null,
    },
  ],
  existingResources: [],
  connections: [],
  limitations: [],
};
const result = { contractVersion: 1, architectureDigest: digest, proposal };
function response(state: string, id = "job_test") {
  return new Response(
    JSON.stringify({
      apiVersion: "v1",
      data: {
        contractVersion: 1,
        id,
        state,
        architectureDigest: digest,
        ...(state === "succeeded" ? { result } : {}),
      },
    }),
    { status: 200 },
  );
}
function parsedBody(value: unknown): unknown {
  if (typeof value !== "string") throw new Error("Expected serialized request");
  return JSON.parse(value) as unknown;
}
const args = (signal = new AbortController().signal) => ({
  projectId: "project_test",
  etag: '"draft:v1"',
  request: {
    contractVersion: 1 as const,
    proposalVersion: 3 as const,
    requirements: "Create a private bucket",
    architectureDocument: document,
  },
  signal,
  accessToken: () => "synthetic-token",
  onProgress: vi.fn<(message: string) => void>(),
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  sessionStorage.clear();
});
it("explains account eligibility after denial without exposing the response or starting a job", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      new Response("synthetic private denial detail", { status: 403 }),
    );
  vi.stubGlobal("fetch", fetcher);
  const input = args();
  await expect(requestBetaInfrastructureProposal(input)).rejects.toMatchObject({
    name: new BetaInfrastructureAccessDeniedError().name,
    code: "ai.access-denied",
    message:
      "AI access was denied. Check your workspace permissions, subscription and available credits before retrying. Your diagram is unchanged.",
  });
  expect(fetcher).toHaveBeenCalledOnce();
  expect(input.onProgress).not.toHaveBeenCalled();
});

it("waits for a durable result and reports queue and generation progress", async () => {
  vi.useFakeTimers();
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(response("queued"))
    .mockResolvedValueOnce(response("running"))
    .mockResolvedValueOnce(response("succeeded"));
  vi.stubGlobal("fetch", fetch);
  const input = args(),
    pending = requestBetaInfrastructureProposal(input);
  await vi.advanceTimersByTimeAsync(4000);
  await expect(pending).resolves.toEqual(result);
  expect(input.onProgress.mock.calls.map(([message]) => message)).toEqual([
    "Proposal queued…",
    "Designing your infrastructure… This can take a few minutes.",
  ]);
  expect(fetch.mock.calls[0]?.[0]).toMatch(/\/beta-infrastructure-jobs$/u);
  expect(
    new Headers(fetch.mock.calls[0]?.[1]?.headers).get("idempotency-key"),
  ).toBeTruthy();
});
it("reports the held estimate and exact settled credits for the same job", async () => {
  vi.useFakeTimers();
  const credits = (state: "reserved" | "settled") =>
    new Response(
      JSON.stringify({
        apiVersion: "v1",
        data: {
          contractVersion: 1,
          jobId: "job_test",
          state,
          estimatedCreditUnits: "18",
          maximumCreditUnits: "100",
          ...(state === "settled" ? { actualCreditUnits: "2" } : {}),
        },
      }),
      { status: 200 },
    );
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(response("queued"))
    .mockResolvedValueOnce(credits("reserved"))
    .mockResolvedValueOnce(response("succeeded"))
    .mockResolvedValueOnce(credits("settled"));
  vi.stubGlobal("fetch", fetch);
  const onCredits =
    vi.fn<(receipt: BetaInfrastructureJobCreditsV1 | null) => void>();
  const pending = requestBetaInfrastructureProposal({ ...args(), onCredits });
  await vi.advanceTimersByTimeAsync(2000);
  await expect(pending).resolves.toEqual(result);
  expect(onCredits.mock.calls.map(([receipt]) => receipt?.state)).toEqual([
    "reserved",
    "settled",
  ]);
  expect(onCredits.mock.calls.at(-1)?.[0]).toMatchObject({
    actualCreditUnits: "2",
  });
  expect(fetch.mock.calls[1]?.[0]).toEqual(
    expect.stringMatching(/\/job_test\/credits$/u),
  );
});
it("backs off status polling while a durable AI job remains active", async () => {
  vi.useFakeTimers();
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(response("running"))
    .mockResolvedValueOnce(response("running"))
    .mockResolvedValueOnce(response("running"))
    .mockResolvedValueOnce(response("running"))
    .mockResolvedValueOnce(response("succeeded"));
  vi.stubGlobal("fetch", fetch);
  const pending = requestBetaInfrastructureProposal(args());
  await vi.advanceTimersByTimeAsync(4000);
  expect(fetch).toHaveBeenCalledTimes(3);
  await vi.advanceTimersByTimeAsync(4999);
  expect(fetch).toHaveBeenCalledTimes(3);
  await vi.advanceTimersByTimeAsync(1);
  expect(fetch).toHaveBeenCalledTimes(4);
  await vi.advanceTimersByTimeAsync(5000);
  await expect(pending).resolves.toEqual(result);
  expect(fetch).toHaveBeenCalledTimes(5);
});

it("pauses status reads in a hidden tab and resumes the same job with the current token", async () => {
  vi.useFakeTimers();
  const visibility = vi
    .spyOn(globalThis.document, "visibilityState", "get")
    .mockReturnValue("hidden");
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(response("running"))
    .mockResolvedValueOnce(response("succeeded"));
  vi.stubGlobal("fetch", fetcher);
  let token = "initial-token";
  const pending = requestBetaInfrastructureProposal({
    ...args(),
    accessToken: () => token,
  });
  await vi.advanceTimersByTimeAsync(60_000);
  expect(fetcher).toHaveBeenCalledOnce();
  token = "refreshed-token";
  visibility.mockReturnValue("visible");
  globalThis.document.dispatchEvent(new Event("visibilitychange"));
  await expect(pending).resolves.toEqual(result);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls[1]?.[0]).toMatch(/\/job_test$/u);
  expect(fetcher.mock.calls[1]?.[1]).toMatchObject({ cache: "no-store" });
  expect(
    new Headers(fetcher.mock.calls[1]?.[1]?.headers).get("authorization"),
  ).toBe("Bearer refreshed-token");
  await vi.advanceTimersByTimeAsync(600_000);
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("cancels a hidden-tab job immediately and never resumes its status reads", async () => {
  vi.useFakeTimers();
  const visibility = vi
    .spyOn(globalThis.document, "visibilityState", "get")
    .mockReturnValue("hidden");
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(response("running"))
    .mockResolvedValueOnce(response("canceled"));
  vi.stubGlobal("fetch", fetcher);
  const controller = new AbortController();
  const pending = requestBetaInfrastructureProposal(args(controller.signal));
  const rejected = expect(pending).rejects.toMatchObject({
    name: "AbortError",
  });
  await vi.advanceTimersByTimeAsync(2000);
  expect(fetcher).toHaveBeenCalledOnce();
  controller.abort();
  await rejected;
  expect(fetcher.mock.calls[1]?.[0]).toMatch(/\/job_test$/u);
  expect(fetcher.mock.calls[1]?.[1]?.method).toBe("DELETE");
  visibility.mockReturnValue("visible");
  globalThis.document.dispatchEvent(new Event("visibilitychange"));
  await vi.advanceTimersByTimeAsync(600_000);
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("keeps the ten-minute deadline while hidden and cancels without another status read", async () => {
  vi.useFakeTimers();
  vi.spyOn(globalThis.document, "visibilityState", "get").mockReturnValue(
    "hidden",
  );
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(response("queued"))
    .mockResolvedValueOnce(response("canceled"));
  vi.stubGlobal("fetch", fetcher);
  const pending = requestBetaInfrastructureProposal(args());
  const rejected = expect(pending).rejects.toMatchObject({
    code: "ai.deadline",
    safeMessage: new BetaInfrastructureRequestError("ai.deadline", "job_test")
      .safeMessage,
  });
  await vi.advanceTimersByTimeAsync(599_999);
  expect(fetcher).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1);
  await rejected;
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls[1]?.[1]?.method).toBe("DELETE");
});

it("does not poll an expired job when a throttled hidden tab becomes visible", async () => {
  vi.useFakeTimers();
  const visibility = vi
    .spyOn(globalThis.document, "visibilityState", "get")
    .mockReturnValue("hidden");
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(response("running"))
    .mockResolvedValueOnce(response("canceled"));
  vi.stubGlobal("fetch", fetcher);
  const pending = requestBetaInfrastructureProposal(args());
  const rejected = expect(pending).rejects.toThrow(
    "taking longer than expected",
  );
  await vi.advanceTimersByTimeAsync(2000);
  // A background browser may delay timers beyond the wall-clock deadline.
  vi.setSystemTime(Date.now() + 600_000);
  visibility.mockReturnValue("visible");
  globalThis.document.dispatchEvent(new Event("visibilitychange"));
  await rejected;
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls[1]?.[1]?.method).toBe("DELETE");
});

it("cancels the exact admitted server job when the user cancels while polling", async () => {
  vi.useFakeTimers();
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(response("running"))
    .mockResolvedValueOnce(response("canceled"));
  vi.stubGlobal("fetch", fetch);
  const controller = new AbortController();
  const pending = requestBetaInfrastructureProposal(args(controller.signal));
  const rejected = expect(pending).rejects.toThrow();
  await vi.advanceTimersByTimeAsync(1);
  controller.abort();
  await rejected;
  expect(fetch.mock.calls.at(-1)?.[0]).toMatch(/\/job_test$/u);
  expect(fetch.mock.calls.at(-1)?.[1]?.method).toBe("DELETE");
});
it("rejects a poll that switches job identities", async () => {
  vi.useFakeTimers();
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(response("queued"))
    .mockResolvedValueOnce(response("succeeded", "another_job"))
    .mockResolvedValueOnce(response("canceled"));
  vi.stubGlobal("fetch", fetch);
  const pending = requestBetaInfrastructureProposal(args());
  const rejected = expect(pending).rejects.toMatchObject({
    code: "ai.job-mismatch",
  });
  await vi.advanceTimersByTimeAsync(2000);
  await rejected;
});
it("finishes admission and cancels its exact job after cancellation during POST", async () => {
  let resolve!: (response: Response) => void;
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockImplementationOnce(
      () =>
        new Promise<Response>((r) => {
          resolve = r;
        }),
    )
    .mockResolvedValueOnce(response("canceled"));
  vi.stubGlobal("fetch", fetch);
  const controller = new AbortController(),
    pending = requestBetaInfrastructureProposal(args(controller.signal));
  const rejected = expect(pending).rejects.toThrow();
  controller.abort();
  resolve(response("queued"));
  await rejected;
  expect(fetch.mock.calls.at(-1)?.[1]?.method).toBe("DELETE");
});

it("reuses admission identity after an uncertain POST response", async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockRejectedValueOnce(new TypeError("Connection lost"))
    .mockResolvedValueOnce(response("succeeded"));
  vi.stubGlobal("fetch", fetch);
  const input = args();
  input.request.requirements = "Synthetic uncertain admission retry";
  await expect(requestBetaInfrastructureProposal(input)).rejects.toMatchObject({
    code: "ai.queue-unconfirmed",
  });
  await expect(requestBetaInfrastructureProposal(input)).resolves.toEqual(
    result,
  );
  expect(
    new Headers(fetch.mock.calls[0]?.[1]?.headers).get("idempotency-key"),
  ).toBe(new Headers(fetch.mock.calls[1]?.[1]?.headers).get("idempotency-key"));
});

it("retains a safe request reference and the same reservation after polling and cancellation lose connectivity", async () => {
  vi.useFakeTimers();
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(response("running"))
    .mockRejectedValueOnce(new TypeError("private network details"))
    .mockRejectedValueOnce(new TypeError("private cancellation details"))
    .mockResolvedValueOnce(response("succeeded"));
  vi.stubGlobal("fetch", fetcher);
  const input = args();
  const pending = requestBetaInfrastructureProposal(input);
  const rejected = expect(pending).rejects.toMatchObject({
    code: "ai.queue-unconfirmed",
    safeMessage: new BetaInfrastructureRequestError(
      "ai.queue-unconfirmed",
      "job_test",
    ).safeMessage,
  });
  await Promise.all([vi.advanceTimersByTimeAsync(2000), rejected]);
  expect(fetcher.mock.calls[2]?.[1]?.method).toBe("DELETE");
  await expect(requestBetaInfrastructureProposal(input)).resolves.toEqual(
    result,
  );
  const admissions = fetcher.mock.calls.filter(
    ([, init]) => init?.method === "POST",
  );
  expect(admissions).toHaveLength(2);
  expect(
    new Set(
      admissions.map(([, init]) =>
        new Headers(init?.headers).get("idempotency-key"),
      ),
    ).size,
  ).toBe(1);
  expect(admissions.map(([, init]) => parsedBody(init?.body))).toEqual([
    input.request,
    input.request,
  ]);
});

it("recovers the same pending admission after module reload without storing prompt, canvas or access token", async () => {
  const input = args();
  input.request.requirements = "Synthetic hard reload uncertain admission";
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockRejectedValueOnce(new TypeError("Response lost after admission"))
    .mockResolvedValueOnce(response("succeeded"));
  vi.stubGlobal("fetch", fetch);
  await expect(requestBetaInfrastructureProposal(input)).rejects.toMatchObject({
    code: "ai.queue-unconfirmed",
  });
  const retained =
    sessionStorage.getItem("cloudmarkup.beta-ai.pending-admissions.v1") ?? "";
  expect(retained).not.toContain(input.request.requirements);
  expect(retained).not.toContain("architectureDocument");
  expect(retained).not.toContain("synthetic-token");
  expect(retained).not.toContain(input.projectId);
  vi.resetModules();
  const reloaded = await import("./beta-infrastructure-client.js");
  await expect(
    reloaded.requestBetaInfrastructureProposal(input),
  ).resolves.toEqual(result);
  expect(
    new Headers(fetch.mock.calls[0]?.[1]?.headers).get("idempotency-key"),
  ).toBe(new Headers(fetch.mock.calls[1]?.[1]?.headers).get("idempotency-key"));
});

it("keeps deliberate completed requests distinct and binds changed pending requests separately", async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockImplementation(() => Promise.resolve(response("succeeded")));
  vi.stubGlobal("fetch", fetch);
  const input = args();
  await requestBetaInfrastructureProposal(input);
  await requestBetaInfrastructureProposal(input);
  expect(
    new Headers(fetch.mock.calls[0]?.[1]?.headers).get("idempotency-key"),
  ).not.toBe(
    new Headers(fetch.mock.calls[1]?.[1]?.headers).get("idempotency-key"),
  );
  fetch.mockRejectedValue(new TypeError("Uncertain response"));
  await expect(requestBetaInfrastructureProposal(input)).rejects.toMatchObject({
    code: "ai.queue-unconfirmed",
  });
  input.request.requirements = "Create a deliberately different private bucket";
  await expect(requestBetaInfrastructureProposal(input)).rejects.toMatchObject({
    code: "ai.queue-unconfirmed",
  });
  expect(
    new Headers(fetch.mock.calls[2]?.[1]?.headers).get("idempotency-key"),
  ).not.toBe(
    new Headers(fetch.mock.calls[3]?.[1]?.headers).get("idempotency-key"),
  );
});

it("fails before POST when pending-request recovery metadata cannot be retained", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>();
  vi.stubGlobal("fetch", fetch);
  vi.stubGlobal("sessionStorage", {
    getItem: () => null,
    setItem: () => {
      throw new Error("Storage blocked");
    },
  });
  await expect(requestBetaInfrastructureProposal(args())).rejects.toThrow(
    "Allow browser session storage",
  );
  expect(fetch).not.toHaveBeenCalled();
});

it("rejects malformed recovery metadata and enforces the pending-request ceiling before POST", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>();
  vi.stubGlobal("fetch", fetch);
  const storageKey = "cloudmarkup.beta-ai.pending-admissions.v1";
  sessionStorage.setItem(storageKey, "{malformed}");
  await expect(requestBetaInfrastructureProposal(args())).rejects.toThrow(
    "recovery is unavailable",
  );
  sessionStorage.setItem(
    storageKey,
    JSON.stringify(
      Array.from({ length: 50 }, (_, i) => ({
        identity: "sha256:" + i.toString(16).padStart(64, "0"),
        key: "00000000-0000-4000-8000-" + i.toString(16).padStart(12, "0"),
        expiresAt: Date.now() + 3_600_000,
      })),
    ),
  );
  await expect(requestBetaInfrastructureProposal(args())).rejects.toThrow(
    "Too many AI requests",
  );
  expect(fetch).not.toHaveBeenCalled();
});

it("prunes expired recovery metadata before a deliberate new admission", async () => {
  const input = args();
  const identity = digestCanonicalValue({
    projectId: input.projectId,
    etag: input.etag,
    request: input.request,
  });
  const oldKey = "00000000-0000-4000-8000-000000000000";
  sessionStorage.setItem(
    "cloudmarkup.beta-ai.pending-admissions.v1",
    JSON.stringify([{ identity, key: oldKey, expiresAt: Date.now() - 1 }]),
  );
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockImplementation(() => Promise.resolve(response("succeeded")));
  vi.stubGlobal("fetch", fetch);
  await expect(requestBetaInfrastructureProposal(input)).resolves.toEqual(
    result,
  );
  expect(
    new Headers(fetch.mock.calls[0]?.[1]?.headers).get("idempotency-key"),
  ).not.toBe(oldKey);
});

it("reuses an exact v6 admission after a lost response with one simulated reservation and no downgrade", async () => {
  const input = {
    ...args(),
    request: {
      ...args().request,
      proposalVersion: 6 as const,
      selectedIssue: {
        code: "aws.validation.synthetic",
        affected: [
          {
            nodeId: "node_stable",
            fieldPath: ".semantic.configuration.values.timeoutSeconds",
          },
        ],
      },
    },
  };
  const v6Proposal = {
    ...proposal,
    contractVersion: 6,
    resources: [],
    updates: [],
    review: {
      intent: "Clarify workload",
      questions: ["Which timeout?"],
      assumptions: [],
      checks: [],
    },
  };
  const v6Result = {
    contractVersion: 1,
    architectureDigest: digest,
    proposal: v6Proposal,
    applicability: {
      contractVersion: 1,
      validatorVersion: "beta-applicability-v1",
      architectureDigest: digest,
      catalogDigest: document.catalog.digest,
      proposalDigest: digestCanonicalValue(v6Proposal),
      commandDigest: null,
      resultDigest: digest,
      kind: "questions-or-assessment",
    },
  };
  const reservations = new Set<string>();
  let first = true;
  const fetcher = vi.fn<typeof globalThis.fetch>((_url, init) => {
    const key = new Headers(init?.headers).get("idempotency-key");
    if (!key) throw new Error("Missing key");
    reservations.add(key);
    if (first) {
      first = false;
      return Promise.reject(new TypeError("Lost response after reservation"));
    }
    return Promise.resolve(
      new Response(
        JSON.stringify({
          apiVersion: "v1",
          data: {
            contractVersion: 1,
            id: "job_v6",
            architectureDigest: digest,
            state: "succeeded",
            result: v6Result,
          },
        }),
      ),
    );
  });
  vi.stubGlobal("fetch", fetcher);
  await expect(requestBetaInfrastructureProposal(input)).rejects.toMatchObject({
    code: "ai.queue-unconfirmed",
  });
  await expect(requestBetaInfrastructureProposal(input)).resolves.toEqual(
    v6Result,
  );
  expect(reservations.size).toBe(1);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls.map(([, init]) => parsedBody(init?.body))).toEqual([
    input.request,
    input.request,
  ]);
});
it("rejects a legacy result for v6 without a second paid request and retains its uncertain key", async () => {
  const input = {
    ...args(),
    request: { ...args().request, proposalVersion: 6 as const },
  };
  const fetcher = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValue(response("succeeded"));
  vi.stubGlobal("fetch", fetcher);
  await expect(requestBetaInfrastructureProposal(input)).rejects.toMatchObject({
    code: "ai.result-mismatch",
  });
  expect(
    fetcher.mock.calls.filter(([, init]) => init?.method === "POST"),
  ).toHaveLength(1);
  expect(
    sessionStorage.getItem("cloudmarkup.beta-ai.pending-admissions.v1"),
  ).toContain("identity");
});
it.each([400, 412, 422, 503])(
  "does not auto retry or downgrade an admission rejected with status %s",
  async (status) => {
    const fetcher = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(null, { status }));
    vi.stubGlobal("fetch", fetcher);
    await expect(
      requestBetaInfrastructureProposal({
        ...args(),
        request: { ...args().request, proposalVersion: 6 },
      }),
    ).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledOnce();
    expect(parsedBody(fetcher.mock.calls[0]?.[1]?.body)).toHaveProperty(
      "proposalVersion",
      6,
    );
  },
);

it("refreshes the exact terminal credit receipt after a v6 applicability rejection", async () => {
  const terminal = () => response("failed");
  const credit = (state: "reserved" | "released") =>
    new Response(
      JSON.stringify({
        apiVersion: "v1",
        data: {
          contractVersion: 1,
          jobId: "job_test",
          state,
          estimatedCreditUnits: "18",
          maximumCreditUnits: "100",
        },
      }),
    );
  const fetcher = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(terminal())
    .mockResolvedValueOnce(credit("reserved"))
    .mockResolvedValueOnce(credit("released"))
    .mockResolvedValueOnce(terminal());
  vi.stubGlobal("fetch", fetcher);
  const onCredits =
    vi.fn<(receipt: BetaInfrastructureJobCreditsV1 | null) => void>();
  await expect(
    requestBetaInfrastructureProposal({
      ...args(),
      request: { ...args().request, proposalVersion: 6 },
      onCredits,
    }),
  ).rejects.toThrow("Request reference: job_test.");
  expect(onCredits.mock.calls.map(([receipt]) => receipt?.state)).toEqual([
    "reserved",
    "released",
  ]);
  expect(
    fetcher.mock.calls.filter(([, init]) => init?.method === "POST"),
  ).toHaveLength(1);
  expect(fetcher.mock.calls[2]?.[0]).toMatch(/\/job_test\/credits$/u);
});

it("never displays an untrusted request reference as support instructions", () => {
  const error = new BetaInfrastructureRequestError(
    "ai.failed",
    "private content <script>run()</script>",
  );
  expect(error.safeMessage).not.toContain("private content");
  expect(error.safeMessage).not.toContain("<script>");
  expect(error.safeMessage).not.toContain("Request reference:");
});
