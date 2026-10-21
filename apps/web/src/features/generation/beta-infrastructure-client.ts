import {
  betaInfrastructureJobResponseV1Schema,
  betaInfrastructureJobCreditsResponseV1Schema,
  type BetaInfrastructureJobCreditsV1,
} from "@cloudmarkup/api-contract";
import {
  digestCanonicalValue,
  type CreateBetaInfrastructureProposalV1,
} from "@cloudmarkup/schemas";

const requestFailureMessages = {
  "ai.access-denied":
    "AI access was denied. Check your workspace permissions, subscription and available credits before retrying. Your diagram is unchanged.",
  "ai.recovery-unavailable":
    "AI request recovery is unavailable in this tab. Restore browser session storage before retrying.",
  "ai.recovery-write-blocked":
    "AI request recovery is unavailable in this tab. Allow browser session storage before using AI assistance.",
  "ai.pending-limit":
    "Too many AI requests are awaiting confirmation. Try again after they expire.",
  "ai.deadline":
    "The AI proposal is taking longer than expected. Check Usage and the original request's status before trying again.",
  "ai.sign-in-required": "Sign in again to use AI assistance.",
  "ai.saved-source-changed":
    "The saved draft changed or the current canvas/catalog needs saving. Save, then reload the project and try again.",
  "ai.context-unsupported":
    "The reviewed context or selected repair is unsupported. Check the canvas settings and use the dedicated configuration, connection or permissions editor.",
  "ai.unavailable":
    "Reviewed canvas AI is unavailable on this server. Check availability again before retrying.",
  "ai.queue-unconfirmed":
    "The AI proposal could not be confirmed. Check AI availability and Usage before trying again. Your diagram is unchanged.",
  "ai.proposal-unavailable":
    "The proposal is unavailable. Check your project access and retry.",
  "ai.job-mismatch":
    "The proposal no longer matches this request. Check the original request's status before trying again.",
  "ai.cancelled": "Proposal cancelled.",
  "ai.failed":
    "The AI proposal could not finish. Your diagram is unchanged. Retry, or split the requested change into smaller steps.",
  "ai.result-mismatch":
    "The proposal does not match the saved canvas or request version. Request a fresh proposal.",
} as const;

/** Only locally classified failures carry display copy; remote text never does. */
export class BetaInfrastructureRequestError extends Error {
  readonly code: keyof typeof requestFailureMessages;
  readonly safeMessage: string;

  constructor(code: keyof typeof requestFailureMessages) {
    const message = requestFailureMessages[code];
    super(message);
    this.name = "BetaInfrastructureRequestError";
    this.code = code;
    this.safeMessage = message;
  }
}

export class BetaInfrastructureAccessDeniedError extends BetaInfrastructureRequestError {
  constructor() {
    super("ai.access-denied");
    this.name = "BetaInfrastructureAccessDeniedError";
  }
}

const pendingAdmissionsStorageKey = "cloudmarkup.beta-ai.pending-admissions.v1";
interface PendingAdmission {
  identity: string;
  key: string;
  expiresAt: number;
}
function readPendingAdmissions(): PendingAdmission[] {
  try {
    const serialized = sessionStorage.getItem(pendingAdmissionsStorageKey);
    if (serialized === null) return [];
    if (serialized.length > 16_000)
      throw new Error("Oversized recovery metadata");
    const raw: unknown = JSON.parse(serialized);
    if (!Array.isArray(raw) || raw.length > 50)
      throw new Error("Invalid recovery metadata");
    const entries: PendingAdmission[] = [];
    for (const value of raw as unknown[]) {
      if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("Invalid recovery metadata");
      const entry = value as Record<string, unknown>;
      const { identity, key, expiresAt } = entry;
      if (
        Object.keys(entry).sort().join(",") !== "expiresAt,identity,key" ||
        typeof identity !== "string" ||
        !/^sha256:[0-9a-f]{64}$/u.test(identity) ||
        typeof key !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(
          key,
        ) ||
        typeof expiresAt !== "number" ||
        !Number.isSafeInteger(expiresAt) ||
        expiresAt > Date.now() + 3_600_000
      )
        throw new Error("Invalid recovery metadata");
      if (expiresAt > Date.now())
        entries.push({
          identity,
          key,
          expiresAt,
        });
    }
    if (new Set(entries.map((entry) => entry.identity)).size !== entries.length)
      throw new Error("Duplicate recovery metadata");
    return entries;
  } catch {
    throw new BetaInfrastructureRequestError("ai.recovery-unavailable");
  }
}
function writePendingAdmissions(entries: PendingAdmission[]) {
  try {
    const serialized = JSON.stringify(entries);
    sessionStorage.setItem(pendingAdmissionsStorageKey, serialized);
    if (sessionStorage.getItem(pendingAdmissionsStorageKey) !== serialized)
      throw new Error("Recovery metadata was not retained");
  } catch {
    throw new BetaInfrastructureRequestError("ai.recovery-write-blocked");
  }
}
function forgetAdmission(identity: string) {
  try {
    writePendingAdmissions(
      readPendingAdmissions().filter((entry) => entry.identity !== identity),
    );
  } catch {
    // Retaining the old key is conservative: replay finds the same terminal job
    // rather than admitting another debit if storage fails after success.
  }
}
export function describeBetaInfrastructureCredits(
  receipt: BetaInfrastructureJobCreditsV1 | null,
): string {
  if (receipt === null)
    return "Credit receipt is temporarily unavailable. Check Usage for the settled amount.";
  if (receipt.state === "settled")
    return `Used ${receipt.actualCreditUnits ?? "unavailable"} credits (estimated ${receipt.estimatedCreditUnits ?? "unavailable"}).`;
  if (receipt.state === "released" || receipt.state === "not-metered")
    return "No credits charged.";
  return `Estimated ${receipt.estimatedCreditUnits ?? "unavailable"} credits; up to ${receipt.maximumCreditUnits ?? "unavailable"} temporarily reserved. Actual use appears when generation completes.`;
}
function admissionKey(identity: string) {
  const pendingAdmissions = readPendingAdmissions();
  const prior = pendingAdmissions.find((entry) => entry.identity === identity);
  if (prior) return prior.key;
  if (pendingAdmissions.length >= 50)
    throw new BetaInfrastructureRequestError("ai.pending-limit");
  const key = crypto.randomUUID();
  // Commit only bounded metadata before POST. No prompt, canvas, token, tenant
  // identity or provider output is stored. Reloads in this tab reuse the key.
  writePendingAdmissions([
    ...pendingAdmissions,
    { identity, key, expiresAt: Date.now() + 3_600_000 },
  ]);
  return key;
}
function pause(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    signal.throwIfAborted();
    const cancelled = () => {
      clearTimeout(timer);
      reject(new DOMException("Cancelled", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", cancelled);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", cancelled, { once: true });
  });
}
function proposalDeadlineError() {
  return new BetaInfrastructureRequestError("ai.deadline");
}
function waitForVisibleDocument(signal: AbortSignal, deadline: number) {
  signal.throwIfAborted();
  if (Date.now() >= deadline) throw proposalDeadlineError();
  if (document.visibilityState !== "hidden") return;
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", visible);
      signal.removeEventListener("abort", cancelled);
    };
    const visible = () => {
      if (document.visibilityState === "hidden") return;
      cleanup();
      if (Date.now() >= deadline) reject(proposalDeadlineError());
      else resolve();
    };
    const cancelled = () => {
      cleanup();
      reject(new DOMException("Cancelled", "AbortError"));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(proposalDeadlineError());
    }, deadline - Date.now());
    document.addEventListener("visibilitychange", visible);
    signal.addEventListener("abort", cancelled, { once: true });
  });
}
/** Browser requests are short; the durable worker owns model execution. */
export async function requestBetaInfrastructureProposal(input: {
  projectId: string;
  etag: string;
  request: CreateBetaInfrastructureProposalV1;
  signal: AbortSignal;
  accessToken: () => string | null | undefined;
  onProgress: (message: string) => void;
  onCredits?: (receipt: BetaInfrastructureJobCreditsV1 | null) => void;
}) {
  const url = `/api/v1/projects/${encodeURIComponent(input.projectId)}/beta-infrastructure-jobs`;
  const headers = () => {
    const token = input.accessToken();
    if (!token) throw new BetaInfrastructureRequestError("ai.sign-in-required");
    return {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    };
  };
  const admissionIdentity = digestCanonicalValue({
    projectId: input.projectId,
    etag: input.etag,
    request: input.request,
  });
  let jobId: string | undefined;
  let succeeded = false;
  try {
    input.signal.throwIfAborted();
    // Finish admission even after Cancel so its exact job can then be cancelled.
    const response = await fetch(url, {
      method: "POST",
      signal: AbortSignal.timeout(30_000),
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        ...headers(),
        "if-match": input.etag,
        "idempotency-key": admissionKey(admissionIdentity),
      },
      body: JSON.stringify(input.request),
    });
    if (response.status === 403)
      throw new BetaInfrastructureAccessDeniedError();
    if (!response.ok)
      throw new BetaInfrastructureRequestError(
        response.status === 412
          ? "ai.saved-source-changed"
          : response.status === 401
            ? "ai.sign-in-required"
            : response.status === 400
              ? "ai.context-unsupported"
              : response.status === 422 || response.status === 503
                ? "ai.unavailable"
                : "ai.queue-unconfirmed",
      );
    let job = betaInfrastructureJobResponseV1Schema.parse(
      await response.json(),
    ).data;
    jobId = job.id;
    const readCredits = async () => {
      if (!input.onCredits) return;
      try {
        const receipt = await fetch(
          `${url}/${encodeURIComponent(job.id)}/credits`,
          {
            signal: input.signal,
            cache: "no-store",
            credentials: "same-origin",
            headers: headers(),
          },
        );
        if (!receipt.ok) throw new Error("Credit receipt unavailable.");
        const credits = betaInfrastructureJobCreditsResponseV1Schema.parse(
          await receipt.json(),
        ).data;
        if (credits.jobId !== job.id)
          throw new Error("Credit receipt identity changed.");
        input.onCredits(credits);
      } catch {
        input.onCredits(null);
      }
    };
    await readCredits();
    const deadline = Date.now() + 600_000;
    let completedPolls = 0;
    while (job.state === "queued" || job.state === "running") {
      input.signal.throwIfAborted();
      if (Date.now() >= deadline) throw proposalDeadlineError();
      input.onProgress(
        job.state === "queued"
          ? "Proposal queued…"
          : "Designing your infrastructure… This can take a few minutes.",
      );
      // Keep the first updates quick, then reduce status traffic for long jobs.
      await pause(completedPolls < 2 ? 2000 : 5000, input.signal);
      // The durable worker continues while this tab is hidden. Resume status
      // reads on return, preserving cancellation and the ten-minute deadline.
      await waitForVisibleDocument(input.signal, deadline);
      const poll = await fetch(`${url}/${encodeURIComponent(job.id)}`, {
        signal: input.signal,
        cache: "no-store",
        credentials: "same-origin",
        headers: headers(),
      });
      if (!poll.ok)
        throw new BetaInfrastructureRequestError(
          poll.status === 401
            ? "ai.sign-in-required"
            : "ai.proposal-unavailable",
        );
      const next = betaInfrastructureJobResponseV1Schema.parse(
        await poll.json(),
      ).data;
      if (
        next.id !== jobId ||
        next.architectureDigest !== job.architectureDigest
      )
        throw new BetaInfrastructureRequestError("ai.job-mismatch");
      job = next;
      completedPolls += 1;
    }
    input.signal.throwIfAborted();
    // A deterministic rejection can release the initial reservation. Show the
    // terminal receipt even when there is no deliverable proposal.
    await readCredits();
    if (job.state !== "succeeded" || !job.result)
      throw new BetaInfrastructureRequestError(
        job.state === "canceled" ? "ai.cancelled" : "ai.failed",
      );
    if (
      job.architectureDigest !==
        digestCanonicalValue(input.request.architectureDocument) ||
      (input.request.proposalVersion === 6 &&
        job.result.proposal.contractVersion !== 6)
    )
      throw new BetaInfrastructureRequestError("ai.result-mismatch");
    succeeded = true;
    forgetAdmission(admissionIdentity);
    return job.result;
  } finally {
    if (jobId && !succeeded) {
      try {
        const cancellation = await fetch(
          `${url}/${encodeURIComponent(jobId)}`,
          {
            method: "DELETE",
            headers: headers(),
            credentials: "same-origin",
            cache: "no-store",
            signal: AbortSignal.timeout(10_000),
            keepalive: true,
          },
        );
        if (cancellation.ok) {
          const cancelled = betaInfrastructureJobResponseV1Schema.parse(
            await cancellation.json(),
          ).data;
          if (
            cancelled.id === jobId &&
            cancelled.architectureDigest ===
              digestCanonicalValue(input.request.architectureDocument) &&
            ["canceled", "failed", "expired"].includes(cancelled.state)
          )
            forgetAdmission(admissionIdentity);
        }
      } catch {
        /* Server job expiry still bounds admission after lost connectivity. */
      }
    }
  }
}
