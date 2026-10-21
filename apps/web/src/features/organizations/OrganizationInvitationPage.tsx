import {
  acceptedOrganizationInvitationV1Schema,
  currentPrincipalV1Schema,
  organizationInvitationIdV1Schema,
  type AcceptedOrganizationInvitationV1,
} from "@cloudmarkup/api-contract";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import {
  cloudMarkupQueryKeys,
  useOptionalCloudMarkupQueryRuntime,
  type CloudMarkupQueryRuntime,
} from "../../api/index.js";
import {
  AppLink,
  useAppLocation,
  useNavigate,
  useRouteMatch,
} from "../../routing/index.js";
import { RoutePage } from "../../shell/RoutePage.js";
import {
  browserCognitoAuthSession,
  startCognitoSignInWithPopup,
} from "../auth/cognito-browser-auth.js";
import { invitationErrorMessage } from "./organization-invitation-errors.js";
import {
  readInvitationSecret,
  type InvitationSecret,
} from "./organization-invitation-link.js";
import "./organization-invitations.css";

const productionSignIn = (signal: AbortSignal) =>
  startCognitoSignInWithPopup(browserCognitoAuthSession, { signal });

export function OrganizationInvitationPage({
  startSignIn = productionSignIn,
}: {
  readonly startSignIn?: (signal: AbortSignal) => Promise<void>;
}) {
  const location = useAppLocation();
  const route = useRouteMatch();
  const navigate = useNavigate();
  const runtime = useOptionalCloudMarkupQueryRuntime();
  // Pure initializer survives StrictMode. The URL is scrubbed before mounting any request owner.
  const [secret] = useState(() =>
    readInvitationSecret(
      route.params.invitationId,
      location.search,
      location.hash,
    ),
  );
  const id = organizationInvitationIdV1Schema.safeParse(
    route.params.invitationId,
  );
  const cleanPath = `/invitations/${id.success ? id.data : "unavailable"}`;
  const clean =
    location.hash === "" &&
    location.search === "" &&
    location.pathname === cleanPath;
  useLayoutEffect(() => {
    if (!clean) navigate(cleanPath, { replace: true });
  }, [clean, cleanPath, navigate]);
  return (
    <RoutePage
      title="Organization invitation"
      eyebrow="Shared workspace"
      description="Review your signed-in account before joining."
      routeKey="invitation"
    >
      {!clean ? (
        <p role="status">Preparing invitation…</p>
      ) : secret === null ? (
        <section className="organization-invitation" role="alert">
          <h2>Invitation link unavailable</h2>
          <p>
            Open the original invitation link. Its private token is not retained
            after this page closes or reloads.
          </p>
          <AppLink to="/organizations">Return to organizations</AppLink>
        </section>
      ) : runtime === null ? (
        <section className="organization-invitation" role="alert">
          <h2>Invitations unavailable</h2>
          <p>
            This workspace has no configured account service. Nothing was
            changed.
          </p>
        </section>
      ) : (
        <InvitationAcceptance
          key={secret.invitationId}
          runtime={runtime}
          secret={secret}
          startSignIn={startSignIn}
        />
      )}
    </RoutePage>
  );
}

function InvitationAcceptance({
  runtime,
  secret,
  startSignIn,
}: {
  readonly runtime: CloudMarkupQueryRuntime;
  readonly secret: InvitationSecret;
  readonly startSignIn: (signal: AbortSignal) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [receipt, setReceipt] = useState<{
    readonly value: AcceptedOrganizationInvitationV1;
    readonly principalId: string;
  } | null>(null);
  const [projects, setProjects] = useState<string | null>(null);
  const pending = useRef(false);
  const alive = useRef(true);
  const signInController = useRef<AbortController | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      signInController.current?.abort();
    };
  }, []);
  const principal = useQuery({
    queryKey: cloudMarkupQueryKeys.currentPrincipal(),
    queryFn: async () =>
      currentPrincipalV1Schema.parse(
        (await runtime.client.request("principal.get", {})).data,
      ),
    enabled: !runtime.sessionExpired,
    staleTime: 0,
    retry: false,
    refetchOnMount: "always",
  });
  const ready =
    !runtime.sessionExpired && !principal.isFetching && !principal.isError
      ? principal.data
      : undefined;
  async function signIn() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setMessage("");
    const controller = new AbortController();
    signInController.current = controller;
    try {
      await startSignIn(controller.signal);
      if (alive.current && !controller.signal.aborted) {
        runtime.resumeSession();
        await principal.refetch();
      }
    } catch {
      if (alive.current)
        setMessage(
          "Sign-in was not completed. The invitation remains in this tab; try signing in again.",
        );
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function refreshAccess(accepted: NonNullable<typeof receipt>) {
    const value = currentPrincipalV1Schema.parse(
      (await runtime.client.request("principal.get", {})).data,
    );
    const membership = value.organizationContexts.find(
      (context) =>
        context.organizationId === accepted.value.organizationId &&
        context.membershipId === accepted.value.membershipId &&
        context.role === accepted.value.role &&
        context.capabilities.includes("projects.read"),
    );
    if (value.id !== accepted.principalId || membership === undefined)
      throw new Error("Joined workspace access is not current.");
    if (alive.current) {
      runtime.queryClient.setQueryData(
        cloudMarkupQueryKeys.currentPrincipal(),
        value,
      );
      void runtime.queryClient.invalidateQueries({
        queryKey: cloudMarkupQueryKeys.organizations(value.id),
      });
      setProjects(
        `/organizations/${encodeURIComponent(membership.organizationId)}/projects`,
      );
    }
  }
  async function accept() {
    if (pending.current || (receipt === null && ready === undefined)) return;
    pending.current = true;
    setBusy(true);
    setMessage("");
    let accepted = receipt;
    try {
      if (accepted === null && ready !== undefined) {
        const response = await runtime.client.request(
          "organization-invitations.accept",
          {
            path: { invitationId: secret.invitationId },
            body: { contractVersion: 1, token: secret.token },
          },
        );
        accepted = {
          value: acceptedOrganizationInvitationV1Schema.parse(response.data),
          principalId: ready.id,
        };
        if (!alive.current) return;
        setReceipt(accepted);
      }
      if (accepted !== null) await refreshAccess(accepted);
    } catch (error) {
      if (alive.current)
        setMessage(
          accepted === null
            ? invitationErrorMessage(error)
            : "The invitation was accepted, but current workspace access could not be confirmed. Refresh access without accepting again.",
        );
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return (
    <section
      className="organization-invitation"
      aria-labelledby="join-workspace-title"
    >
      <h2 id="join-workspace-title">
        {receipt === null ? "Join a shared workspace" : "Invitation accepted"}
      </h2>
      <p>Join only if you trust the person who sent this link.</p>
      {ready === undefined ? (
        <p role="status">
          {principal.isFetching
            ? "Checking your signed-in account…"
            : "Sign in to review and accept this invitation."}
        </p>
      ) : (
        <p>
          Signed in as {ready.displayName}. Joining does not change existing
          member roles.
        </p>
      )}
      <details>
        <summary>What joining checks</summary>
        <p>
          Your current account, the inviter’s authority, invitation status, and
          member capacity are checked by the server. No existing member role is
          changed.
        </p>
      </details>
      <div className="organization-invitation__actions">
        {projects === null ? (
          <>
            <button
              className="button button--secondary"
              type="button"
              disabled={busy}
              onClick={() => {
                void signIn();
              }}
            >
              {busy
                ? "Please wait…"
                : ready === undefined
                  ? "Sign in securely"
                  : "Sign in again"}
            </button>
            <button
              className="button button--primary"
              type="button"
              disabled={busy || (receipt === null && ready === undefined)}
              onClick={() => {
                void accept();
              }}
            >
              {busy
                ? "Please wait…"
                : receipt === null
                  ? "Join workspace"
                  : "Refresh workspace access"}
            </button>
          </>
        ) : (
          <AppLink className="button button--primary" to={projects}>
            Open shared projects
          </AppLink>
        )}
        <AppLink className="button button--secondary" to="/organizations">
          Cancel and leave
        </AppLink>
      </div>
      {message === "" ? null : <p role="alert">{message}</p>}
    </section>
  );
}
