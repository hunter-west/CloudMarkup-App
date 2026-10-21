import {
  ApiClientError,
  accountCredentialStateV1Schema,
  accountCredentialResultV1Schema,
  changeAccountCredentialsV1Schema,
  currentPrincipalV1Schema,
  type AccountCredentialStateV1,
  type AccountCredentialProblemV1,
  type ChangeAccountCredentialsV1,
} from "@cloudmarkup/api-contract";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  cloudMarkupQueryKeys,
  type CloudMarkupQueryRuntime,
} from "../../api/index.js";
import { AppLink } from "../../routing/index.js";
import {
  browserCognitoAuthSession,
  startCognitoSignInWithPopup,
} from "../auth/cognito-browser-auth.js";

function field(data: FormData, name: string): string {
  const value = data.get(name);
  return typeof value === "string" ? value : "";
}
const problemText: Readonly<Record<AccountCredentialProblemV1, string>> = {
  "incorrect-password": "The current password was not accepted.",
  "password-policy":
    "Choose a password that meets the requirements and has not been used recently.",
  "incorrect-code":
    "The verification code was not accepted. Check the code and try again.",
  "expired-code": "The verification code has expired. Request a new code.",
  "email-unavailable":
    "That email could not be used. Check the address or choose another.",
  "rate-limited": "Too many attempts. Wait before trying again.",
  reauthenticate: "Sign in again before changing account security.",
  unavailable:
    "The provider did not accept this change. Refresh account security before trying again.",
  unknown: "The outcome could not be confirmed.",
};
const uncertainText =
  "We could not confirm whether the change completed. Refresh account security before starting another attempt. For a password change, try signing in with your new password or use password recovery.";
const defaultSignIn = (signal: AbortSignal) =>
  startCognitoSignInWithPopup(browserCognitoAuthSession, {
    intent: "sign-in",
    signal,
  });

/** Key this component by verified principal. Credential bodies never enter Query or browser storage. */
export function AccountCredentialControls({
  runtime,
  principalId,
  startSignIn = defaultSignIn,
}: {
  readonly runtime: CloudMarkupQueryRuntime;
  readonly principalId: string;
  readonly startSignIn?: (signal: AbortSignal) => Promise<void>;
}) {
  const [state, setState] = useState<AccountCredentialStateV1 | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [message, setMessage] = useState<string | null>(null),
    [reauth, setReauth] = useState(false),
    [uncertain, setUncertain] = useState(false);
  const alive = useRef(false),
    pending = useRef(false),
    auth = useRef<AbortController | null>(null);
  const passwordForm = useRef<HTMLFormElement>(null),
    emailForm = useRef<HTMLFormElement>(null),
    codeForm = useRef<HTMLFormElement>(null);
  const read = useCallback(async () => {
    const next = accountCredentialStateV1Schema.parse(
      (await runtime.client.request("account.credentials.get", {})).data,
    );
    if (next.principalId !== principalId) throw Error("Account state mismatch");
    void runtime.queryClient.invalidateQueries({
      queryKey: cloudMarkupQueryKeys.currentPrincipal(),
      exact: true,
    });
    return next;
  }, [runtime.client, runtime.queryClient, principalId]);
  useEffect(() => {
    alive.current = true;
    let current = true;
    void read().then(
      (value) => {
        if (current) {
          setState(value);
          setReauth(false);
        }
      },
      (failure: unknown) => {
        if (!current) return;
        const needsAuth =
          failure instanceof ApiClientError &&
          failure.envelope.error.code === "authentication_required";
        setReauth(needsAuth);
        setError(
          needsAuth
            ? "Sign in again to enable password and email controls."
            : "Account security could not be checked. Refresh to try again.",
        );
      },
    );
    return () => {
      current = false;
      alive.current = false;
      auth.current?.abort();
    };
  }, [read]);
  function begin() {
    if (pending.current || !alive.current) return false;
    pending.current = true;
    setBusy(true);
    setError(null);
    setMessage(null);
    return true;
  }
  function end() {
    pending.current = false;
    if (alive.current) setBusy(false);
  }
  function clearForms() {
    passwordForm.current?.reset();
    emailForm.current?.reset();
    codeForm.current?.reset();
  }
  async function refresh() {
    if (!begin()) return;
    try {
      const value = await read();
      if (!alive.current) return;
      setState(value);
      setUncertain(false);
      setReauth(false);
      setMessage(
        "Current sign-in email refreshed. Passwords cannot be checked from this page.",
      );
    } catch {
      if (alive.current)
        setError(
          "Account security could not be refreshed. Sign in again or try later.",
        );
    } finally {
      end();
    }
  }
  function activeAuth(controller: AbortController) {
    return alive.current && !controller.signal.aborted;
  }
  async function signIn() {
    if (!begin()) return;
    clearForms();
    const controller = new AbortController();
    auth.current = controller;
    try {
      await startSignIn(controller.signal);
      if (!activeAuth(controller)) return;
      const actor = currentPrincipalV1Schema.parse(
        (await runtime.client.request("principal.get", {})).data,
      );
      if (!activeAuth(controller)) return;
      runtime.resumeSession();
      runtime.queryClient.setQueryData(
        cloudMarkupQueryKeys.currentPrincipal(),
        actor,
      );
      if (actor.id !== principalId) {
        setState(null);
        setError(
          "The signed-in account changed. Reopen Security for that account.",
        );
        return;
      }
      const value = await read();
      if (!activeAuth(controller)) return;
      setState(value);
      setReauth(false);
      setUncertain(false);
      setMessage("Sign-in refreshed. Enter your account change again.");
    } catch {
      if (alive.current)
        setError(
          "Sign-in was not completed. Your password and email changes were not submitted by this sign-in action.",
        );
    } finally {
      auth.current = null;
      end();
    }
  }
  async function submit(input: ChangeAccountCredentialsV1) {
    if (runtime.sessionExpired || reauth || uncertain || !begin()) return;
    try {
      const result = accountCredentialResultV1Schema.parse(
        (
          await runtime.client.request("account.credentials.change", {
            headers: { "x-cloudmarkup-account": principalId },
            body: input,
          })
        ).data,
      );
      if (
        result.principalId !== principalId ||
        result.attemptId !== input.attemptId ||
        result.action !== input.action
      )
        throw Error("Account outcome mismatch");
      if (!alive.current) return;
      if (result.outcome === "uncertain") {
        setUncertain(true);
        setError(uncertainText);
        return;
      }
      if (result.outcome === "rejected") {
        setReauth(result.problem === "reauthenticate");
        setError(problemText[result.problem ?? "unknown"]);
        return;
      }
      setState(result.state);
      setMessage(
        input.action === "password-change"
          ? "Password changed."
          : input.action === "email-confirm"
            ? "Email verified: " +
              (result.state?.email ?? "your sign-in email") +
              "."
            : input.action === "email-resend"
              ? "Verification code requested. Check your email."
              : "Email update requested. Check your new email for a verification code. Your current email stays active until verification.",
      );
      await runtime.queryClient.invalidateQueries({
        queryKey: cloudMarkupQueryKeys.currentPrincipal(),
      });
    } catch (failure) {
      if (!alive.current) return;
      if (
        failure instanceof ApiClientError &&
        ["authentication_required", "access_denied"].includes(
          failure.envelope.error.code,
        )
      ) {
        setReauth(true);
        setError(
          "Sign in again and reopen Security before making this change.",
        );
      } else if (
        failure instanceof ApiClientError &&
        failure.envelope.error.code === "rate_limited"
      ) {
        setError(problemText["rate-limited"]);
      } else {
        setUncertain(true);
        setError(uncertainText);
      }
    } finally {
      end();
    }
  }
  const disabled =
    busy || state === null || runtime.sessionExpired || reauth || uncertain;
  return (
    <section
      className="feature-card section-stack"
      aria-labelledby="credential-controls-title"
    >
      <div>
        <p className="status-label">Personal security</p>
        <h2 id="credential-controls-title">Password and sign-in email</h2>
        <p>
          Manage your own account. Password changes do not end other sessions;
          use the session controls to end access.
        </p>
      </div>
      {state ? (
        <dl className="editor-inspector-list">
          <div>
            <dt>Current sign-in email</dt>
            <dd>
              {state.email ?? "Not available"}
              {state.emailVerified ? " · Verified" : " · Not verified"}
            </dd>
          </div>
        </dl>
      ) : (
        <p>Current provider account details are unavailable.</p>
      )}
      {error ? <p role="alert">{error}</p> : null}
      {message ? <p role="status">{message}</p> : null}
      {busy ? <p role="status">Checking your account change…</p> : null}
      <div className="button-row">
        <button
          className="button button--quiet"
          type="button"
          disabled={busy}
          onClick={() => {
            void refresh();
          }}
        >
          Refresh account security
        </button>
        <button
          className="button button--quiet"
          type="button"
          disabled={busy}
          onClick={() => {
            void signIn();
          }}
        >
          Sign in again securely
        </button>
        <AppLink to="/forgot-password?returnTo=%2Fsettings%2Fsecurity">
          Recover a forgotten password
        </AppLink>
      </div>
      <details className="settings-task">
        <summary>Change your password</summary>
        <form
          ref={passwordForm}
          onSubmit={(event) => {
            event.preventDefault();
            if (disabled) return;
            const data = new FormData(event.currentTarget),
              currentPassword = field(data, "current-password"),
              newPassword = field(data, "new-password"),
              confirmation = field(data, "confirm-password");
            if (newPassword !== confirmation) {
              setError("The new passwords do not match.");
              return;
            }
            const parsed = changeAccountCredentialsV1Schema.safeParse({
              contractVersion: 1,
              attemptId: crypto.randomUUID(),
              action: "password-change",
              currentPassword,
              newPassword,
            });
            if (!parsed.success) {
              setError(
                "Use at least 14 characters, including uppercase and lowercase letters, a number and a symbol, with no spaces.",
              );
              return;
            }
            event.currentTarget.reset();
            void submit(parsed.data);
          }}
        >
          <fieldset
            disabled={disabled}
            className="section-stack account-credential-fields"
          >
            <legend>Change password</legend>
            <label>
              Current password
              <input
                name="current-password"
                type="password"
                autoComplete="current-password"
                required
                maxLength={256}
              />
            </label>
            <label>
              New password
              <input
                name="new-password"
                type="password"
                autoComplete="new-password"
                required
                minLength={14}
                maxLength={256}
                aria-describedby="password-requirements"
              />
            </label>
            <p id="password-requirements">
              At least 14 characters, including uppercase and lowercase letters,
              a number and a symbol. No spaces.
            </p>
            <label>
              Confirm new password
              <input
                name="confirm-password"
                type="password"
                autoComplete="new-password"
                required
                minLength={14}
                maxLength={256}
              />
            </label>
            <button className="button button--primary" type="submit">
              Change password
            </button>
          </fieldset>
        </form>
      </details>
      <details className="settings-task">
        <summary>Update your sign-in email</summary>
        <form
          ref={emailForm}
          onSubmit={(event) => {
            event.preventDefault();
            if (disabled) return;
            const email = field(
              new FormData(event.currentTarget),
              "email",
            ).trim();
            const parsed = changeAccountCredentialsV1Schema.safeParse({
              contractVersion: 1,
              attemptId: crypto.randomUUID(),
              action: "email-start",
              email,
            });
            if (!parsed.success) {
              setError("Enter a valid email address.");
              return;
            }
            event.currentTarget.reset();
            void submit(parsed.data);
          }}
        >
          <fieldset
            disabled={disabled}
            className="section-stack account-credential-fields"
          >
            <legend>Change sign-in email</legend>
            <label>
              New email address
              <input
                name="email"
                type="email"
                autoComplete="email"
                required
                maxLength={320}
              />
            </label>
            <button className="button button--primary" type="submit">
              Send verification code
            </button>
          </fieldset>
        </form>
        <form
          ref={codeForm}
          onSubmit={(event) => {
            event.preventDefault();
            if (disabled) return;
            const code = field(
              new FormData(event.currentTarget),
              "code",
            ).trim();
            const parsed = changeAccountCredentialsV1Schema.safeParse({
              contractVersion: 1,
              attemptId: crypto.randomUUID(),
              action: "email-confirm",
              code,
            });
            if (!parsed.success) {
              setError("Enter the six-digit verification code.");
              return;
            }
            event.currentTarget.reset();
            void submit(parsed.data);
          }}
        >
          <fieldset
            disabled={disabled}
            className="section-stack account-credential-fields"
          >
            <legend>Verify your new email</legend>
            <label>
              Email verification code
              <input
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                required
                maxLength={6}
              />
            </label>
            <div className="button-row">
              <button className="button button--primary" type="submit">
                Verify email
              </button>
              <button
                className="button button--quiet"
                type="button"
                onClick={() => {
                  void submit({
                    contractVersion: 1,
                    attemptId: crypto.randomUUID(),
                    action: "email-resend",
                  });
                }}
              >
                Request another code
              </button>
            </div>
          </fieldset>
        </form>
      </details>
    </section>
  );
}
