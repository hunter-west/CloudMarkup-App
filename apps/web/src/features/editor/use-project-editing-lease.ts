import {
  projectEditingLeaseStateV1Schema,
  type CloudMarkupClient,
  type ProjectEditingLeaseProofV1,
} from "@cloudmarkup/api-contract";
import { useCallback, useEffect, useRef, useState } from "react";

type LeaseView<T> =
  | { readonly status: "checking" | "unavailable" | "lost" }
  | { readonly status: "held"; readonly lastObservedExpiresAt: string }
  | {
      readonly status: "owned";
      readonly head: T;
      readonly leaseId: string;
    };

interface LeaseAttempt {
  active: boolean;
  ready: boolean;
  proof: ProjectEditingLeaseProofV1 | null;
  expiresAt: number;
  timer?: ReturnType<typeof setTimeout>;
  expiryTimer?: ReturnType<typeof setTimeout>;
  pending: Promise<void>;
}

function isAttemptActive(attempt: LeaseAttempt): boolean {
  return attempt.active;
}

function tabToken(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function bounded<T>(
  pending: Promise<T>,
  onLate?: (value: T) => Promise<void>,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let expired = false;
    const timer = setTimeout(() => {
      expired = true;
      reject(new Error("The editing access request timed out."));
    }, 15_000);
    void pending.then(
      (value) => {
        clearTimeout(timer);
        if (expired) {
          void onLate?.(value).catch(() => undefined);
        } else resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        if (!expired)
          reject(
            error instanceof Error
              ? error
              : new Error("Editing access failed."),
          );
      },
    );
  });
}

/** Tokens are per effect/tab, never persisted or placed in query keys. The
 * lifecycle chain makes StrictMode's cleanup finish its late acquisition and
 * release before the replacement acquires; every release carries its own proof. */
export function useProjectEditingLease<T>({
  client,
  enabled,
  projectId,
  readHead,
}: {
  readonly client: CloudMarkupClient | null;
  readonly enabled: boolean;
  readonly projectId: string;
  readonly readHead: () => Promise<T>;
}) {
  const [view, setView] = useState<LeaseView<T>>({ status: "checking" });
  const [retained, setRetained] = useState<{ head: T; leaseId: string } | null>(
    null,
  );
  const [generation, setGeneration] = useState(0);
  const current = useRef<LeaseAttempt | null>(null);
  const lifecycle = useRef(Promise.resolve());
  const releaseCurrent = useRef<() => Promise<void>>(() => Promise.resolve());

  useEffect(() => {
    if (!enabled || client === null) return;
    const attempt: LeaseAttempt = {
      active: true,
      ready: false,
      proof: null,
      expiresAt: 0,
      pending: Promise.resolve(),
    };
    current.current = attempt;
    // The new attempt is checking even while its predecessor's bounded
    // release drains. A cancelled StrictMode attempt cannot change the view.
    void Promise.resolve().then(() => {
      if (isAttemptActive(attempt)) setView({ status: "checking" });
    });
    const clearTimers = () => {
      clearTimeout(attempt.timer);
      clearTimeout(attempt.expiryTimer);
    };
    const lose = () => {
      clearTimers();
      if (attempt.active) setView({ status: "lost" });
      attempt.active = false;
    };
    const release = async () => {
      attempt.active = false;
      clearTimers();
      await attempt.pending;
      const proof = attempt.proof;
      attempt.proof = null;
      if (proof === null) return;
      try {
        await bounded(
          client.request("project-editing-leases.release", {
            path: { projectId },
            body: { contractVersion: 1, ...proof },
          }),
        );
      } catch {
        // A disconnected tab cannot promise release. The server's short lease
        // expires independently; no takeover or locally fabricated ownership.
      }
    };
    releaseCurrent.current = release;
    const valid = () =>
      attempt.active &&
      attempt.proof !== null &&
      Date.now() < attempt.expiresAt;
    const watchExpiry = () => {
      clearTimeout(attempt.expiryTimer);
      attempt.expiryTimer = setTimeout(
        lose,
        Math.max(0, attempt.expiresAt - Date.now()),
      );
    };
    const renew = async () => {
      if (!valid()) {
        lose();
        return;
      }
      const proof = attempt.proof;
      if (proof === null) return;
      try {
        const response = await bounded(
          client.request("project-editing-leases.renew", {
            path: { projectId },
            body: { contractVersion: 1, ...proof },
          }),
        );
        const state = projectEditingLeaseStateV1Schema.parse(response.data);
        if (!attempt.active) return;
        if (
          state.projectId !== projectId ||
          state.state !== "owned" ||
          state.leaseId !== proof.leaseId ||
          Date.parse(state.expiresAt) <= Date.now()
        ) {
          lose();
          return;
        }
        attempt.expiresAt = Date.parse(state.expiresAt);
        watchExpiry();
        scheduleRenewal();
      } catch {
        lose();
      }
    };
    const scheduleRenewal = () => {
      attempt.timer = setTimeout(() => {
        attempt.pending = attempt.pending.then(renew);
      }, 20_000);
    };
    const acquire = async () => {
      if (!isAttemptActive(attempt)) return;
      setView({ status: "checking" });
      try {
        const token = tabToken();
        const response = await bounded(
          client.request("project-editing-leases.acquire", {
            path: { projectId },
            body: { contractVersion: 1, token },
          }),
          async (lateResponse) => {
            const late = projectEditingLeaseStateV1Schema.parse(
              lateResponse.data,
            );
            if (late.projectId === projectId && late.state === "owned")
              await bounded(
                client.request("project-editing-leases.release", {
                  path: { projectId },
                  body: { contractVersion: 1, leaseId: late.leaseId, token },
                }),
              );
          },
        );
        const state = projectEditingLeaseStateV1Schema.parse(response.data);
        if (state.projectId !== projectId)
          throw new Error("The editing lease belongs to another project.");
        if (state.state !== "owned") {
          if (isAttemptActive(attempt))
            setView(
              state.state === "held"
                ? { status: "held", lastObservedExpiresAt: state.expiresAt }
                : { status: "unavailable" },
            );
          return;
        }
        attempt.proof = { leaseId: state.leaseId, token };
        attempt.expiresAt = Date.parse(state.expiresAt);
        if (!isAttemptActive(attempt)) return;
        if (!valid()) throw new Error("The editing lease has expired.");
        watchExpiry();
        scheduleRenewal();
        // Ownership is not a stale-draft override: read the server again only
        // after acquiring, before any editor or local recovery is mounted.
        const head = await bounded(readHead());
        if (!valid()) return;
        attempt.ready = true;
        setRetained({ head, leaseId: state.leaseId });
        setView({ status: "owned", head, leaseId: state.leaseId });
      } catch {
        clearTimers();
        if (isAttemptActive(attempt)) setView({ status: "unavailable" });
        attempt.active = false;
      }
    };
    // Release is queued separately, never from inside its own pending promise.
    attempt.pending = lifecycle.current.then(acquire);
    lifecycle.current = attempt.pending;
    const checkAfterSuspension = () => {
      if (attempt.proof !== null && !valid()) lose();
    };
    window.addEventListener("focus", checkAfterSuspension);
    document.addEventListener("visibilitychange", checkAfterSuspension);
    return () => {
      attempt.active = false;
      clearTimers();
      window.removeEventListener("focus", checkAfterSuspension);
      document.removeEventListener("visibilitychange", checkAfterSuspension);
      lifecycle.current = release();
    };
  }, [client, enabled, generation, projectId, readHead]);

  const getProof = useCallback((): ProjectEditingLeaseProofV1 | null => {
    const attempt = current.current;
    return attempt?.active === true &&
      attempt.ready &&
      Date.now() < attempt.expiresAt
      ? attempt.proof
      : null;
  }, []);
  const retry = useCallback(() => {
    setView({ status: "checking" });
    setGeneration((value) => value + 1);
  }, []);
  const release = useCallback(() => releaseCurrent.current(), []);
  return { ...view, retained, getProof, retry, release };
}
