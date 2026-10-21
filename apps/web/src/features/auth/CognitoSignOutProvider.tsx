import { useCallback, useEffect, useMemo, type ReactNode } from "react";

import { useOptionalCloudMarkupQueryRuntime } from "../../api/index.js";
import { useNavigate } from "../../routing/index.js";
import {
  browserCognitoAuthSession,
  type CognitoBrowserAuthSession,
} from "./cognito-browser-auth.js";
import { performCognitoSignOut } from "./cognito-sign-out-action.js";
import {
  browserCognitoSignOutChannel,
  type CognitoSignOutChannel,
} from "./cognito-sign-out-channel.js";
import {
  CognitoSignOutContext,
  type CognitoSignOutActions,
} from "./cognito-sign-out-context.js";

export function CognitoSignOutProvider({
  channel = browserCognitoSignOutChannel,
  children,
  session = browserCognitoAuthSession,
}: {
  readonly channel?: CognitoSignOutChannel;
  readonly children: ReactNode;
  readonly session?: CognitoBrowserAuthSession;
}) {
  const navigate = useNavigate();
  const runtime = useOptionalCloudMarkupQueryRuntime();
  const queryClient = runtime?.queryClient;
  useEffect(
    () =>
      channel.subscribe(() => {
        session.clearSession();
        queryClient?.clear();
        navigate("/sign-in", { replace: true });
      }),
    [channel, navigate, queryClient, session],
  );
  const signOut = useCallback(async () => {
    if (runtime === null) {
      throw new TypeError("The authenticated browser session is unavailable.");
    }
    return performCognitoSignOut({
      queryClient: runtime.queryClient,
      session,
    });
  }, [runtime, session]);
  const signOutAndClearLocalRecovery = useCallback(async () => {
    if (runtime === null) {
      throw new TypeError("The authenticated browser session is unavailable.");
    }
    return performCognitoSignOut({
      clearLocalRecovery: true,
      queryClient: runtime.queryClient,
      session,
    });
  }, [runtime, session]);
  const value = useMemo<CognitoSignOutActions | null>(
    () => (runtime === null ? null : { signOut, signOutAndClearLocalRecovery }),
    [runtime, signOut, signOutAndClearLocalRecovery],
  );
  return (
    <CognitoSignOutContext.Provider value={value}>
      {children}
    </CognitoSignOutContext.Provider>
  );
}
