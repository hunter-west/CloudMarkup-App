import {
  ApiClientError,
  accountSessionV1Schema,
  accountSessionChangeReceiptV1Schema,
  pageMetadataSchema,
  type AccountSessionV1,
  type AccountSessionChangeReceiptV1,
  type ChangeAccountSessionsV1,
  type CurrentPrincipalV1,
} from "@cloudmarkup/api-contract";
import { Dialog } from "@cloudmarkup/ui";
import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import {
  cloudMarkupQueryKeys,
  type CloudMarkupQueryRuntime,
} from "../../api/index.js";
import { browserCognitoAuthSession } from "../auth/cognito-browser-auth.js";
import { useOptionalCognitoSignOut } from "../auth/cognito-sign-out-context.js";
import { useOptionalLocalOwnerSession } from "../auth/local-owner-session.js";
import { useInvitationAction } from "../organizations/recipient-invitation-state.js";
export interface AccountSessionAttempt {
  readonly input: ChangeAccountSessionsV1;
  readonly key: string;
  readonly dispatched?: boolean;
  readonly receipt?: AccountSessionChangeReceiptV1;
}
const retained = new Map<string, AccountSessionAttempt>();
async function readSessions(
  runtime: CloudMarkupQueryRuntime,
  principalId: string,
): Promise<readonly AccountSessionV1[]> {
  const items: AccountSessionV1[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 100; i++) {
    const response = await runtime.client.request("account.sessions.list", {
      query: {
        "page[limit]": "100",
        ...(cursor ? { "page[cursor]": cursor } : {}),
      },
    });
    const page = pageMetadataSchema.parse(response.page);
    for (const raw of response.data) {
      const row = accountSessionV1Schema.parse(raw);
      if (row.principalId !== principalId || row.id <= (items.at(-1)?.id ?? ""))
        throw Error("Session response mismatch");
      items.push(row);
    }
    if (!page.hasMore) return items;
    if (response.data.length === 0 || page.nextCursor !== items.at(-1)?.id)
      throw Error("Session cursor mismatch");
    cursor = page.nextCursor;
  }
  throw Error("Session history is too large to confirm");
}
const authenticationRequired = (error: unknown) =>
  error instanceof ApiClientError &&
  error.envelope.error.code === "authentication_required";
export function AccountSessionControls({
  runtime,
  principal,
  attempts = retained,
}: {
  readonly runtime: CloudMarkupQueryRuntime;
  readonly principal: CurrentPrincipalV1;
  readonly attempts?: Map<string, AccountSessionAttempt>;
}) {
  const action = useInvitationAction(runtime, principal.id, "session"),
    signOut = useOptionalCognitoSignOut(),
    localOwner = useOptionalLocalOwnerSession();
  const [attempt, setAttempt] = useState<AccountSessionAttempt | null>(
      () => attempts.get(principal.id) ?? null,
    ),
    [open, setOpen] = useState(false);
  const current = useRef(attempt),
    trigger = useRef<HTMLButtonElement>(null);
  const key = [
    ...cloudMarkupQueryKeys.principal(principal.id),
    "account-sessions",
  ];
  const query = useQuery({
    queryKey: key,
    queryFn: () => readSessions(runtime, principal.id),
    retry: false,
    enabled: !runtime.sessionExpired,
  });
  function save(value: AccountSessionAttempt | null) {
    current.current = value;
    setAttempt(value);
    if (value === null) attempts.delete(principal.id);
    else {
      attempts.set(principal.id, value);
      while (attempts.size > 8) {
        const oldest = attempts.keys().next().value;
        if (oldest === undefined) break;
        attempts.delete(oldest);
      }
    }
  }
  function review(input: ChangeAccountSessionsV1) {
    if (current.current !== null) {
      setOpen(true);
      return;
    }
    save({ input, key: "session_" + crypto.randomUUID() });
    setOpen(true);
    action.setError(null);
  }
  async function confirm() {
    const value = current.current;
    if (value === null || !action.begin()) return;
    try {
      let receipt = value.receipt;
      if (!receipt) {
        await action.verifyActor();
        if (!action.mounted()) return;
        save({ ...value, dispatched: true });
        receipt = accountSessionChangeReceiptV1Schema.parse(
          (
            await runtime.client.request("account.sessions.change", {
              body: value.input,
              headers: { "idempotency-key": value.key },
            })
          ).data,
        );
        if (
          receipt.principalId !== principal.id ||
          receipt.action !== value.input.action ||
          receipt.sessionId !==
            (value.input.action === "revoke" ? value.input.sessionId : null)
        )
          throw Error("Session receipt mismatch");
        if (!action.mounted()) return;
        save({ ...value, dispatched: true, receipt });
      }
      let sessions: readonly AccountSessionV1[];
      try {
        sessions = await readSessions(runtime, principal.id);
      } catch (error) {
        if (!authenticationRequired(error)) throw error;
        if (!action.mounted()) return;
        // Revocation is confirmed by its bound receipt and denied current admission.
        save(null);
        setOpen(false);
        if (localOwner === null) browserCognitoAuthSession.clearSession();
        else localOwner.session.clear();
        runtime.queryClient.clear();
        try {
          await signOut?.signOut();
        } finally {
          runtime.expireSession();
        }
        return;
      }
      if (
        receipt.action === "revoke"
          ? sessions.some((s) => s.id === receipt.sessionId)
          : sessions.some(
              (s) =>
                Date.parse(s.authenticatedAt) <=
                Date.parse(receipt.authenticatedThrough ?? ""),
            )
      )
        throw Error("Session revocation readback mismatch");
      await action.verifyActor();
      if (!action.mounted()) return;
      runtime.queryClient.setQueryData(key, sessions);
      save(null);
      setOpen(false);
      action.setMessage(
        receipt.action === "revoke-all"
          ? "Earlier CloudMarkup sessions ended. Your current sign-in is active."
          : "The selected sign-in ended.",
      );
    } catch (error) {
      if (action.mounted())
        action.setError(
          authenticationRequired(error)
            ? "Sign in again, then retry this same attempt to confirm its outcome."
            : error instanceof ApiClientError &&
                error.envelope.error.code === "access_denied"
              ? "A recent sign-in is required. Sign in again, then retry this attempt."
              : "The result could not be confirmed. Retry this same attempt to check its outcome.",
        );
    } finally {
      action.end();
    }
  }
  return (
    <section className="feature-card" aria-labelledby="account-sessions-title">
      <p className="status-label">Account security</p>
      <h2 id="account-sessions-title">Browser sessions</h2>
      <p>
        Review CloudMarkup browser sign-ins. Ending a sign-in stops that session
        from accessing CloudMarkup or renewing. Work already in progress may
        finish.
      </p>
      {action.message ? <p role="status">{action.message}</p> : null}
      {query.isPending ? (
        <p role="status">Loading your sessions…</p>
      ) : query.isError ? (
        <div role="alert">
          <p>Your sessions could not be loaded.</p>
          <button
            type="button"
            className="button button--secondary"
            onClick={() => void query.refetch()}
          >
            Retry sessions
          </button>
        </div>
      ) : (
        <ul className="account-session-list" aria-label="Your browser sign-ins">
          {query.data.map((session, index) => (
            <li key={session.id}>
              <div>
                <strong>
                  {session.current
                    ? "This sign-in"
                    : "Browser sign-in " + String(index + 1)}
                </strong>
                <p>
                  Signed in {new Date(session.authenticatedAt).toLocaleString()}{" "}
                  · Expires {new Date(session.expiresAt).toLocaleString()}
                </p>
              </div>
              <button
                type="button"
                className="button button--secondary"
                disabled={action.busy || runtime.sessionExpired}
                onClick={() => {
                  review({
                    contractVersion: 1,
                    action: "revoke",
                    sessionId: session.id,
                  });
                }}
              >
                End{" "}
                {session.current
                  ? "this sign-in"
                  : "browser sign-in " + String(index + 1)}
              </button>
            </li>
          ))}
          {query.data.length === 0 ? (
            <li>
              No active registered browser sessions. An older sign-in may not
              appear here; ending all sessions also covers it.
            </li>
          ) : null}
        </ul>
      )}
      <button
        ref={trigger}
        type="button"
        className="button button--secondary"
        disabled={action.busy || runtime.sessionExpired}
        onClick={() => {
          review({ contractVersion: 1, action: "revoke-all" });
        }}
      >
        {attempt
          ? "Review pending session change"
          : "End all CloudMarkup sessions"}
      </button>
      <Dialog
        open={open}
        returnFocusRef={trigger}
        onClose={() => {
          if (!action.busy) setOpen(false);
        }}
        title="End account sessions"
      >
        {action.error ? <p role="alert">{action.error}</p> : null}
        <p>
          {attempt?.input.action === "revoke-all"
            ? "End all CloudMarkup sessions? You will need to sign in again on your devices."
            : "End this browser sign-in? Its access and renewal will stop."}
        </p>
        <p>
          Your projects, {localOwner === null ? "billing history and " : ""}
          local draft recovery are retained.
        </p>
        <button
          type="button"
          className="button button--primary"
          disabled={action.busy || runtime.sessionExpired}
          onClick={() => void confirm()}
        >
          {action.busy
            ? "Confirming…"
            : attempt?.receipt
              ? "Refresh session status"
              : "Confirm ending sessions"}
        </button>
        {!attempt?.dispatched ? (
          <button
            type="button"
            className="button button--quiet"
            disabled={action.busy}
            onClick={() => {
              save(null);
              setOpen(false);
            }}
          >
            Cancel session change
          </button>
        ) : null}
        {action.error || runtime.sessionExpired ? (
          <button
            type="button"
            className="button button--secondary"
            disabled={action.busy}
            onClick={() => void action.signIn()}
          >
            Sign in again
          </button>
        ) : null}
        <p>
          An uncertain attempt stays in this tab so it can be confirmed after
          signing in again.
        </p>
      </Dialog>
    </section>
  );
}
