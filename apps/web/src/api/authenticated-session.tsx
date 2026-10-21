import { signInPathForReturn } from "../features/auth/sign-in-return-path.js";
import type { CurrentPrincipalV1 } from "@cloudmarkup/api-contract";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";

import { mapApiError } from "./api-errors.js";
import {
  useOptionalCloudMarkupQueryRuntime,
  type CloudMarkupQueryRuntime,
} from "./cloudmarkup-query-context.js";
import { cloudMarkupQueryKeys } from "./query-keys.js";

export interface AuthenticatedSession {
  readonly principal: CurrentPrincipalV1;
}

export interface AuthenticatedSessionBoundaryProps {
  readonly children: (session: AuthenticatedSession) => ReactNode;
  readonly fallback?: (reason: "client-unavailable") => ReactNode;
}

export function AuthenticatedSessionBoundary({
  children,
  fallback,
}: AuthenticatedSessionBoundaryProps) {
  const runtime = useOptionalCloudMarkupQueryRuntime();
  if (runtime === null) {
    return (
      fallback?.("client-unavailable") ?? (
        <main className="session-state-page" id="main-content" tabIndex={-1}>
          <section className="state-card state-card--warning" role="alert">
            <p className="status-label">API unavailable</p>
            <h1>CloudMarkup could not start</h1>
            <p>
              Configure the typed API client. Browser recovery is not treated as
              authenticated project storage.
            </p>
          </section>
        </main>
      )
    );
  }

  return (
    <ConfiguredAuthenticatedSessionBoundary runtime={runtime}>
      {children}
    </ConfiguredAuthenticatedSessionBoundary>
  );
}

function ConfiguredAuthenticatedSessionBoundary({
  children,
  runtime,
}: {
  readonly children: (session: AuthenticatedSession) => ReactNode;
  readonly runtime: CloudMarkupQueryRuntime;
}) {
  const principalQuery = useQuery({
    enabled: !runtime.sessionExpired,
    queryFn: async () =>
      (await runtime.client.request("principal.get", {})).data,
    queryKey: cloudMarkupQueryKeys.currentPrincipal(),
    retry(failureCount, error) {
      const mapped = mapApiError(error);
      return !mapped.sessionExpired && failureCount < 1;
    },
  });

  // Presentation history only: an initial 401 does not prove session expiry.
  // This resets with the boundary and never persists identity or grants access.
  const [wasAuthenticated, setWasAuthenticated] = useState(
    principalQuery.isSuccess,
  );
  if (principalQuery.isSuccess && !wasAuthenticated) {
    setWasAuthenticated(true);
  }

  const mappedError =
    principalQuery.error === null ? null : mapApiError(principalQuery.error);
  useEffect(() => {
    if (mappedError?.sessionExpired === true) {
      runtime.expireSession();
    }
  }, [mappedError?.sessionExpired, runtime]);

  if (runtime.sessionExpired || mappedError?.sessionExpired === true) {
    return (
      <main className="session-state-page" id="main-content" tabIndex={-1}>
        <section className="state-card state-card--permission" role="alert">
          <p className="status-label">
            {wasAuthenticated ? "Session expired" : "Sign in required"}
          </p>
          <h1>
            {wasAuthenticated ? "Your session expired" : "Sign in to continue"}
          </h1>
          <p>
            {wasAuthenticated
              ? "Your session expired. Sign in again to continue."
              : "Sign in to your CloudMarkup account to open this page."}
          </p>
          <a
            className="button button--primary"
            href={signInPathForReturn(
              window.location.pathname +
                window.location.search +
                window.location.hash,
            )}
          >
            {wasAuthenticated ? "Sign in again" : "Sign in"}
          </a>
        </section>
      </main>
    );
  }

  if (principalQuery.isPending) {
    return (
      <main className="session-state-page" id="main-content" tabIndex={-1}>
        <p aria-live="polite" role="status">
          Loading your authenticated CloudMarkup session...
        </p>
      </main>
    );
  }

  if (mappedError !== null) {
    return (
      <main className="session-state-page" id="main-content" tabIndex={-1}>
        <section className="state-card state-card--permission" role="alert">
          <p className="status-label">API error</p>
          <h1>CloudMarkup is unavailable</h1>
          <p>{mappedError.message}</p>
          <button
            className="button button--secondary"
            type="button"
            onClick={() => {
              void principalQuery.refetch();
            }}
          >
            Retry
          </button>
        </section>
      </main>
    );
  }

  if (principalQuery.data === undefined) {
    return null;
  }

  const session = { principal: principalQuery.data };
  return children(session);
}
