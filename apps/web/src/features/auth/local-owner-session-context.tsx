import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { useOptionalCloudMarkupQueryRuntime } from "../../api/index.js";
import { useNavigate } from "../../routing/index.js";
import type { LocalOwnerBrowserSession } from "./local-owner-browser-auth.js";
import { LocalOwnerReauthenticationPage } from "./LocalOwnerReauthenticationPage.js";

import { LocalOwnerSessionContext } from "./local-owner-session.js";

interface PendingChallenge {
  readonly resolve: () => void;
  readonly reject: (reason: Error) => void;
  readonly signal: AbortSignal | undefined;
  readonly onAbort: () => void;
}

export function LocalOwnerSessionProvider({
  children,
  session,
}: {
  readonly children: ReactNode;
  readonly session: LocalOwnerBrowserSession;
}) {
  const navigate = useNavigate();
  const runtime = useOptionalCloudMarkupQueryRuntime();
  const challenge = useRef<PendingChallenge | null>(null);
  const [challengeOpen, setChallengeOpen] = useState(false);
  const settleChallenge = useCallback((error?: Error) => {
    const pending = challenge.current;
    if (pending === null) return;
    challenge.current = null;
    pending.signal?.removeEventListener("abort", pending.onAbort);
    setChallengeOpen(false);
    if (error === undefined) pending.resolve();
    else pending.reject(error);
  }, []);
  const reauthenticate = useCallback(
    (signal?: AbortSignal) => {
      if (signal?.aborted)
        return Promise.reject(new Error("Local sign-in was cancelled."));
      if (challenge.current !== null)
        return Promise.reject(
          new Error("Local sign-in is already in progress."),
        );
      return new Promise<void>((resolve, reject) => {
        const onAbort = () => {
          settleChallenge(new Error("Local sign-in was cancelled."));
        };
        challenge.current = { resolve, reject, signal, onAbort };
        signal?.addEventListener("abort", onAbort, { once: true });
        setChallengeOpen(true);
      });
    },
    [settleChallenge],
  );
  useEffect(
    () => () => {
      const pending = challenge.current;
      challenge.current = null;
      pending?.signal?.removeEventListener("abort", pending.onAbort);
      pending?.reject(new Error("Local sign-in was cancelled."));
    },
    [],
  );
  const signOut = useCallback(async () => {
    const revokedCurrentSession = await session.signOut();
    if (!revokedCurrentSession || session.getValidAccessToken() !== undefined)
      return;
    runtime?.queryClient.clear();
    runtime?.expireSession();
    navigate("/sign-in", { replace: true });
  }, [navigate, runtime, session]);
  const value = useMemo(
    () => ({ session, signOut, reauthenticate }),
    [session, signOut, reauthenticate],
  );
  return (
    <LocalOwnerSessionContext.Provider value={value}>
      {children}
      {challengeOpen ? (
        <LocalOwnerReauthenticationPage
          session={session}
          onAuthenticated={() => {
            settleChallenge();
          }}
          onCancel={() => {
            settleChallenge(new Error("Local sign-in was cancelled."));
          }}
        />
      ) : null}
    </LocalOwnerSessionContext.Provider>
  );
}
