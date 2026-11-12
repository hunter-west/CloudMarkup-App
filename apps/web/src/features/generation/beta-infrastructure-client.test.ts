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

it.each([
  "initial-credit-fetch",
  "initial-credit-body",
  "status-fetch",
  "status-body",
  "terminal-credit-fetch",
  "terminal-credit-body",
])(
  "bounds a pending %s and retains uncertain admission recovery",
  async (phase) => {
    vi.useFakeTimers();
    for (const stop of ["deadline", "caller", "wall-clock"] as const) {
      sessionStorage.clear();
      const controller = new AbortController();
      const input = args(controller.signal);
      const onCredits =
        vi.fn<(receipt: BetaInfrastructureJobCreditsV1 | null) => void>();
      const failed = vi.fn<(error: unknown) => void>();
      const succeeded = vi.fn();
      let creditReads = 0;
      let readSignal: AbortSignal | null | undefined;
      let release: () => void = () => {
        throw new Error("Pending boundary not reached");
      };
      const fetcher = vi.fn<typeof fetch>((url, init) => {
        if (init?.method === "POST")
          return Promise.resolve(response("running"));
        if (init?.method === "DELETE")
          return Promise.resolve(new Response(null, { status: 503 }));
        if (typeof url !== "string")
          throw new TypeError("Expected a request URL");
        const isCredit = url.endsWith("/credits");
        if (isCredit) creditReads += 1;
        const current = isCredit
          ? creditReads === 1
            ? "initial-credit"
            : "terminal-credit"
          : "status";
        const payload = isCredit
          ? {
              apiVersion: "v1",
              data: {
                contractVersion: 1,
                jobId: "job_test",
                state: creditReads === 1 ? "reserved" : "settled",
                estimatedCreditUnits: "18",
                maximumCreditUnits: "100",
                ...(creditReads === 1 ? {} : { actualCreditUnits: "2" }),
              },
            }
          : {
              apiVersion: "v1",
              data: {
                contractVersion: 1,
                id: "job_test",
                architectureDigest: digest,
                state: "succeeded",
                result,
              },
            };
        const healthy = new Response(JSON.stringify(payload));
        if (!phase.startsWith(current)) return Promise.resolve(healthy);
        readSignal = init?.signal;
        // Deliberately ignore abort in the double: the client must settle even
        // if a transport or body promise does not cooperate with its signal.
        if (phase.endsWith("-fetch"))
          return new Promise<Response>((resolve) => {
            release = () => {
              resolve(healthy);
            };
          });
        vi.spyOn(healthy, "json").mockImplementation(
          () =>
            new Promise<unknown>((resolve) => {
              release = () => {
                resolve(payload);
              };
            }),
        );
        return Promise.resolve(healthy);
      });
      vi.stubGlobal("fetch", fetcher);
      const pending = requestBetaInfrastructureProposal({
        ...input,
        onCredits,
      }).then(succeeded, failed);
      await vi.advanceTimersByTimeAsync(2000);
      expect(readSignal).toBeDefined();
      expect(failed).not.toHaveBeenCalled();
      if (stop === "deadline") {
        await vi.advanceTimersByTimeAsync(597_999);
        expect(failed).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
      } else if (stop === "caller") {
        controller.abort();
        await vi.advanceTimersByTimeAsync(0);
      } else {
        // A throttled tab can receive a late result before its timer runs.
        vi.setSystemTime(Date.now() + 600_000);
        release();
        await vi.advanceTimersByTimeAsync(0);
      }
      expect(failed).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining(
          stop === "caller" ? { name: "AbortError" } : { code: "ai.deadline" },
        ),
      );
      await pending;
      expect(succeeded).not.toHaveBeenCalled();
      expect(readSignal?.aborted).toBe(true);
      const cancellations = fetcher.mock.calls.filter(
        ([, init]) => init?.method === "DELETE",
      );
      expect(cancellations).toHaveLength(1);
      expect(cancellations[0]?.[0]).toBe(
        "/api/v1/projects/project_test/beta-infrastructure-jobs/job_test",
      );
      expect(cancellations[0]?.[1]).toMatchObject({
        cache: "no-store",
        credentials: "same-origin",
        keepalive: true,
      });
      expect(
        new Headers(cancellations[0]?.[1]?.headers).get("authorization"),
      ).toBe("Bearer synthetic-token");
      expect(
        fetcher.mock.calls.filter(([, init]) => init?.method === "POST"),
      ).toHaveLength(1);
      expect(
        sessionStorage.getItem("cloudmarkup.beta-ai.pending-admissions.v1"),
      ).toContain("identity");
      const creditCallbacks = onCredits.mock.calls.length;
      const requests = fetcher.mock.calls.length;
      release();
      await vi.advanceTimersByTimeAsync(0);
      expect(onCredits).toHaveBeenCalledTimes(creditCallbacks);
      expect(fetcher).toHaveBeenCalledTimes(requests);
      expect(vi.getTimerCount()).toBe(0);
      fetcher.mockResolvedValue(response("succeeded"));
      await expect(requestBetaInfrastructureProposal(args())).resolves.toEqual(
        result,
      );
      const admissions = fetcher.mock.calls.filter(
        ([, init]) => init?.method === "POST",
      );
      expect(admissions).toHaveLength(2);
      expect(
        new Headers(admissions[0]?.[1]?.headers).get("idempotency-key"),
      ).toBe(new Headers(admissions[1]?.[1]?.headers).get("idempotency-key"));
      expect(admissions.map(([, init]) => parsedBody(init?.body))).toEqual([
        input.request,
        input.request,
      ]);
    }
  },
);

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

it.each(["fetch", "body"] as const)(
  "classifies terminal-credit %s rejections before optional-error handling",
  async (phase) => {
    vi.useFakeTimers();
    const timeout = vi.spyOn(AbortSignal, "timeout");
    for (const scenario of [
      { elapsed: 3000, cancel: false },
      { elapsed: 599_999, cancel: false },
      { elapsed: 600_000, cancel: false },
      { elapsed: 600_001, cancel: false },
      { elapsed: 3000, cancel: true },
      { elapsed: 600_000, cancel: true },
    ]) {
      sessionStorage.clear();
      timeout.mockClear();
      const startedAt = Date.now();
      const controller = new AbortController();
      const input = args(controller.signal);
      const onCredits =
        vi.fn<(receipt: BetaInfrastructureJobCreditsV1 | null) => void>();
      const succeeded = vi.fn();
      const failed = vi.fn<(error: unknown) => void>();
      let reads = 0;
      let readSignal: AbortSignal | null | undefined;
      let rejectRead: (error: Error) => void = () => {
        throw new Error("Terminal read not reached");
      };
      const fetcher = vi.fn<typeof fetch>((url, init) => {
        if (init?.method === "POST")
          return Promise.resolve(response("running"));
        if (init?.method === "DELETE")
          return Promise.resolve(new Response(null, { status: 503 }));
        if (typeof url !== "string")
          throw new TypeError("Expected a request URL");
        if (!url.endsWith("/credits"))
          return Promise.resolve(response("succeeded"));
        reads += 1;
        const receipt = new Response(
          JSON.stringify({
            apiVersion: "v1",
            data: {
              contractVersion: 1,
              jobId: "job_test",
              state: reads === 1 ? "reserved" : "settled",
              estimatedCreditUnits: "18",
              maximumCreditUnits: "100",
              ...(reads === 1 ? {} : { actualCreditUnits: "2" }),
            },
          }),
        );
        if (reads === 1) return Promise.resolve(receipt);
        readSignal = init?.signal;
        if (phase === "fetch")
          return new Promise<Response>((_resolve, reject) => {
            rejectRead = reject;
          });
        vi.spyOn(receipt, "json").mockImplementation(
          () =>
            new Promise<unknown>((_resolve, reject) => {
              rejectRead = reject;
            }),
        );
        return Promise.resolve(receipt);
      });
      vi.stubGlobal("fetch", fetcher);
      const pending = requestBetaInfrastructureProposal({
        ...input,
        onCredits,
      }).then(succeeded, failed);
      await vi.advanceTimersByTimeAsync(2000);
      expect(reads).toBe(2);
      expect(readSignal?.aborted).toBe(false);
      expect(onCredits.mock.calls.map(([receipt]) => receipt?.state)).toEqual([
        "reserved",
      ]);
      const key = new Headers(fetcher.mock.calls[0]?.[1]?.headers).get(
        "idempotency-key",
      );
      expect(key).toBeTruthy();
      // Move wall time without delivering the throttled helper timer. Reject
      // first, then cancel synchronously to exercise error-exit precedence.
      vi.setSystemTime(startedAt + scenario.elapsed);
      expect(succeeded).not.toHaveBeenCalled();
      expect(failed).not.toHaveBeenCalled();
      rejectRead(new TypeError("synthetic transport detail"));
      const cancellation = new DOMException(
        "Caller canceled the request",
        "AbortError",
      );
      if (scenario.cancel) controller.abort(cancellation);
      await vi.advanceTimersByTimeAsync(0);
      await pending;
      const refused = scenario.cancel || scenario.elapsed >= 600_000;
      if (refused) {
        expect(succeeded).not.toHaveBeenCalled();
        if (scenario.cancel)
          expect(failed).toHaveBeenCalledExactlyOnceWith(cancellation);
        else
          expect(failed).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({
              code: "ai.deadline",
              safeMessage: new BetaInfrastructureRequestError(
                "ai.deadline",
                "job_test",
              ).safeMessage,
            }),
          );
      } else {
        expect(failed).not.toHaveBeenCalled();
        expect(succeeded).toHaveBeenCalledExactlyOnceWith(result);
      }
      expect(readSignal?.aborted).toBe(true);
      expect(
        onCredits.mock.calls.map(([receipt]) => receipt?.state ?? null),
      ).toEqual(["reserved", null]);
      const cancellations = fetcher.mock.calls.filter(
        ([, init]) => init?.method === "DELETE",
      );
      expect(cancellations).toHaveLength(refused ? 1 : 0);
      if (refused) {
        expect(cancellations[0]?.[0]).toBe(
          "/api/v1/projects/project_test/beta-infrastructure-jobs/job_test",
        );
        expect(cancellations[0]?.[1]).toMatchObject({
          credentials: "same-origin",
          cache: "no-store",
          keepalive: true,
        });
        expect(
          new Headers(cancellations[0]?.[1]?.headers).get("authorization"),
        ).toBe("Bearer synthetic-token");
        expect(
          parsedBody(
            sessionStorage.getItem("cloudmarkup.beta-ai.pending-admissions.v1"),
          ),
        ).toEqual([
          {
            identity: digestCanonicalValue({
              projectId: input.projectId,
              etag: input.etag,
              request: input.request,
            }),
            key,
            expiresAt: startedAt + 3_600_000,
          },
        ]);
      } else
        expect(
          parsedBody(
            sessionStorage.getItem("cloudmarkup.beta-ai.pending-admissions.v1"),
          ),
        ).toEqual([]);
      expect(timeout.mock.calls.map(([milliseconds]) => milliseconds)).toEqual(
        refused ? [30_000, 10_000] : [30_000],
      );
      expect(
        fetcher.mock.calls.filter(([, init]) => init?.method === "POST"),
      ).toHaveLength(1);
      expect(vi.getTimerCount()).toBe(0);
      if (refused) {
        fetcher.mockResolvedValue(response("succeeded"));
        await expect(
          requestBetaInfrastructureProposal(args()),
        ).resolves.toEqual(result);
        const admissions = fetcher.mock.calls.filter(
          ([, init]) => init?.method === "POST",
        );
        expect(admissions).toHaveLength(2);
        expect(
          new Headers(admissions[1]?.[1]?.headers).get("idempotency-key"),
        ).toBe(key);
        expect(admissions.map(([, init]) => parsedBody(init?.body))).toEqual([
          input.request,
          input.request,
        ]);
      }
    }
    // The status path has no optional-credit catch to mask helper precedence.
    sessionStorage.clear();
    const controller = new AbortController();
    const cancelled = new DOMException(
      "Caller wins the status error race",
      "AbortError",
    );
    const failed = vi.fn<(error: unknown) => void>();
    const succeeded = vi.fn();
    let readSignal: AbortSignal | null | undefined;
    let rejectStatus: (error: Error) => void = () => {
      throw new Error("Status read not reached");
    };
    const fetcher = vi.fn<typeof fetch>((_url, init) => {
      if (init?.method === "POST") return Promise.resolve(response("running"));
      if (init?.method === "DELETE")
        return Promise.resolve(new Response(null, { status: 503 }));
      readSignal = init?.signal;
      if (phase === "fetch")
        return new Promise<Response>((_resolve, reject) => {
          rejectStatus = reject;
        });
      const status = response("succeeded");
      vi.spyOn(status, "json").mockImplementation(
        () =>
          new Promise<unknown>((_resolve, reject) => {
            rejectStatus = reject;
          }),
      );
      return Promise.resolve(status);
    });
    vi.stubGlobal("fetch", fetcher);
    const pending = requestBetaInfrastructureProposal(
      args(controller.signal),
    ).then(succeeded, failed);
    await vi.advanceTimersByTimeAsync(2000);
    expect(readSignal?.aborted).toBe(false);
    rejectStatus(new TypeError("Earlier queued status failure"));
    controller.abort(cancelled);
    await vi.advanceTimersByTimeAsync(0);
    await pending;
    expect(succeeded).not.toHaveBeenCalled();
    expect(failed).toHaveBeenCalledExactlyOnceWith(cancelled);
    expect(readSignal?.aborted).toBe(true);
    expect(
      fetcher.mock.calls
        .filter(([, init]) => init?.method === "DELETE")
        .map(([url]) => url),
    ).toEqual([
      "/api/v1/projects/project_test/beta-infrastructure-jobs/job_test",
    ]);
    expect(
      fetcher.mock.calls.filter(([, init]) => init?.method === "POST"),
    ).toHaveLength(1);
    expect(
      sessionStorage.getItem("cloudmarkup.beta-ai.pending-admissions.v1"),
    ).toContain("identity");
    expect(vi.getTimerCount()).toBe(0);
  },
);
