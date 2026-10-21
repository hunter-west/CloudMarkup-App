import {
  ApiClientError,
  accountAuthenticatorStateV1Schema,
  accountAuthenticatorStartResultV1Schema,
  accountAuthenticatorChangeResultV1Schema,
  changeAccountAuthenticatorV1Schema,
  currentPrincipalV1Schema,
  type AccountAuthenticatorStateV1,
  type ChangeAccountAuthenticatorV1,
} from "@cloudmarkup/api-contract";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  cloudMarkupQueryKeys,
  type CloudMarkupQueryRuntime,
} from "../../api/index.js";
import {
  browserCognitoAuthSession,
  startCognitoSignInWithPopup,
} from "../auth/cognito-browser-auth.js";
const uncertainMessage =
  "We could not confirm the authenticator change. Refresh its status before trying again. An unfinished setup may stay locked until its expiry time.";
const defaultSignIn = (signal: AbortSignal) =>
  startCognitoSignInWithPopup(browserCognitoAuthSession, {
    intent: "sign-in",
    signal,
  });
/** Key by verified principal. The setup key exists only in this mounted page, never in Query or storage. */
export function AccountAuthenticatorControls(
  props: Parameters<typeof AccountAuthenticatorSettings>[0],
) {
  return (
    <AccountAuthenticatorSettings
      key={props.principalId + ":" + String(props.runtime.sessionExpired)}
      {...props}
    />
  );
}
function AccountAuthenticatorSettings({
  runtime,
  principalId,
  startSignIn = defaultSignIn,
}: {
  readonly runtime: CloudMarkupQueryRuntime;
  readonly principalId: string;
  readonly startSignIn?: (signal: AbortSignal) => Promise<void>;
}) {
  const [state, setState] = useState<AccountAuthenticatorStateV1 | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const readVersion = useRef(0);
  const alive = useRef(false),
    pending = useRef(false),
    auth = useRef<AbortController | null>(null),
    codeForm = useRef<HTMLFormElement>(null);
  const read = useCallback(async () => {
    const value = accountAuthenticatorStateV1Schema.parse(
      (await runtime.client.request("account.authenticator.get", {})).data,
    );
    if (value.principalId !== principalId) throw Error("Account mismatch");
    return value;
  }, [runtime.client, principalId]);
  useEffect(() => {
    alive.current = true;
    let current = true;
    const version = ++readVersion.current;
    void read().then(
      (value) => {
        if (current && version === readVersion.current) setState(value);
      },
      () => {
        if (current && version === readVersion.current)
          setError(
            "Authenticator status could not be checked. Refresh or sign in again.",
          );
      },
    );
    return () => {
      current = false;
      alive.current = false;
      auth.current?.abort();
    };
  }, [read]);
  useEffect(() => {
    if (!state?.enrollment) return;
    const timeout = window.setTimeout(
      () => {
        setSecret(null);
        codeForm.current?.reset();
        setBlocked(true);
        setError(
          "Authenticator setup expired. Refresh its status before starting a new setup.",
        );
      },
      Math.max(0, Date.parse(state.enrollment.expiresAt) - Date.now()),
    );
    return () => {
      window.clearTimeout(timeout);
    };
  }, [state?.enrollment]);
  function begin() {
    if (!alive.current || pending.current) return false;
    pending.current = true;
    readVersion.current += 1;
    setBusy(true);
    setError(null);
    setMessage(null);
    return true;
  }
  function end() {
    pending.current = false;
    if (alive.current) setBusy(false);
  }
  function forget() {
    setSecret(null);
    codeForm.current?.reset();
  }
  function failure(value: unknown) {
    if (!alive.current) return;
    forget();
    setBlocked(true);
    const code =
      value instanceof ApiClientError ? value.envelope.error.code : null;
    setError(
      code === "authentication_required" || code === "access_denied"
        ? "Sign in again and reopen Security before changing your authenticator."
        : code === "conflict"
          ? "This setup changed or is no longer available. Refresh authenticator status."
          : uncertainMessage,
    );
  }
  async function refresh() {
    if (!begin()) return;
    forget();
    try {
      const value = await read();
      if (alive.current) {
        setState(value);
        setBlocked(false);
        setMessage("Authenticator status refreshed.");
      }
    } catch (value) {
      failure(value);
    } finally {
      end();
    }
  }
  async function signIn() {
    if (!begin()) return;
    forget();
    const controller = new AbortController();
    auth.current = controller;
    const active = () => alive.current && !controller.signal.aborted;
    try {
      await startSignIn(controller.signal);
      if (!active()) return;
      const actor = currentPrincipalV1Schema.parse(
        (await runtime.client.request("principal.get", {})).data,
      );
      if (!active()) return;
      runtime.resumeSession();
      runtime.queryClient.setQueryData(
        cloudMarkupQueryKeys.currentPrincipal(),
        actor,
      );
      if (actor.id !== principalId) {
        setState(null);
        setBlocked(true);
        setError(
          "The signed-in account changed. Reopen Security for that account.",
        );
        return;
      }
      const value = await read();
      if (active()) {
        setState(value);
        setBlocked(false);
        setMessage(
          "Sign-in refreshed. Review your authenticator settings before making a change.",
        );
      }
    } catch {
      if (active())
        setError(
          "Sign-in was not completed. No authenticator change was submitted by this sign-in action.",
        );
    } finally {
      auth.current = null;
      end();
    }
  }
  async function start() {
    if (runtime.sessionExpired || blocked || !begin()) return;
    forget();
    const attemptId = crypto.randomUUID();
    try {
      const result = accountAuthenticatorStartResultV1Schema.parse(
        (
          await runtime.client.request("account.authenticator.start", {
            headers: { "x-cloudmarkup-account": principalId },
            body: { contractVersion: 1, attemptId, acknowledgedRecovery: true },
          })
        ).data,
      );
      if (result.principalId !== principalId || result.attemptId !== attemptId)
        throw Error("Outcome mismatch");
      if (!alive.current) return;
      if (result.outcome !== "succeeded") {
        setBlocked(true);
        setError(
          result.outcome === "uncertain"
            ? uncertainMessage
            : "Setup was not started. Refresh the authenticator status or sign in again.",
        );
        return;
      }
      if (
        !result.state?.enrollment ||
        Date.parse(result.state.enrollment.expiresAt) <= Date.now()
      )
        throw Error("Expired setup");
      setState(result.state);
      setSecret(result.secretCode);
      setMessage(
        "Add this setup key to your authenticator app, then enter its six-digit code.",
      );
    } catch (value) {
      failure(value);
    } finally {
      end();
    }
  }
  async function change(input: ChangeAccountAuthenticatorV1) {
    if (runtime.sessionExpired || blocked || !begin()) return;
    if (input.action !== "verify-enable") forget();
    try {
      const result = accountAuthenticatorChangeResultV1Schema.parse(
        (
          await runtime.client.request("account.authenticator.change", {
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
        throw Error("Outcome mismatch");
      if (!alive.current) return;
      if (result.outcome !== "succeeded") {
        if (
          result.outcome === "rejected" &&
          result.problem === "incorrect-code"
        ) {
          setError(
            "That code was not accepted. Enter the current six-digit code from your authenticator app.",
          );
          return;
        }
        forget();
        setBlocked(true);
        setError(
          result.outcome === "uncertain"
            ? uncertainMessage
            : "The change was not accepted. Refresh authenticator status or sign in again.",
        );
        return;
      }
      forget();
      setState(result.state);
      setMessage(
        input.action === "verify-enable"
          ? "Authenticator enabled. You will need its code when signing in."
          : input.action === "disable"
            ? "Authenticator disabled. Existing sessions have not been ended."
            : "Unfinished setup cancelled. You can start a new setup.",
      );
    } catch (value) {
      failure(value);
    } finally {
      end();
    }
  }
  const disabled = busy || state === null || runtime.sessionExpired || blocked;
  const enrollment = state?.enrollment;
  const currentSetup =
    enrollment?.status === "ready" &&
    enrollment.currentSession &&
    secret !== null &&
    !runtime.sessionExpired &&
    !blocked;
  return (
    <section
      className="feature-card section-stack"
      aria-labelledby="authenticator-title"
    >
      <div>
        <p className="status-label">Two-step verification</p>
        <h2 id="authenticator-title">Authenticator app</h2>
        <p>Protect sign-in with a time-based code from an authenticator app.</p>
      </div>
      <p>
        Authenticator status:{" "}
        <strong>
          {state ? (state.enabled ? "Enabled" : "Not enabled") : "Unavailable"}
        </strong>
      </p>
      <p>
        Password recovery does not remove an authenticator. If you lose access
        to your app, you will need account recovery help.
      </p>
      {state?.recoveryContact ? (
        <p>
          Recovery help:{" "}
          <a
            href={
              state.recoveryContact.kind === "email"
                ? "mailto:" + state.recoveryContact.value
                : state.recoveryContact.value
            }
            rel="noreferrer"
          >
            {state.recoveryContact.value}
          </a>
        </p>
      ) : (
        <p>
          New setup is unavailable until an account recovery contact is
          configured.
        </p>
      )}
      {error ? <p role="alert">{error}</p> : null}
      {message ? <p role="status">{message}</p> : null}
      {busy ? <p role="status">Checking authenticator settings…</p> : null}
      <div className="button-row">
        <button
          className="button button--quiet"
          disabled={busy}
          type="button"
          onClick={() => {
            void refresh();
          }}
        >
          Refresh authenticator status
        </button>
        <button
          className="button button--quiet"
          disabled={busy}
          type="button"
          onClick={() => {
            void signIn();
          }}
        >
          Sign in again for authenticator
        </button>
      </div>
      {state?.enabled ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (disabled) return;
            const data = new FormData(event.currentTarget);
            if (data.get("reduction") !== "on") return;
            event.currentTarget.reset();
            void change({
              contractVersion: 1,
              attemptId: crypto.randomUUID(),
              action: "disable",
              acknowledgedReduction: true,
            });
          }}
        >
          <fieldset
            className="section-stack account-credential-fields"
            disabled={disabled}
          >
            <legend>Turn off authenticator</legend>
            <label className="account-authenticator-acknowledgement">
              <input type="checkbox" name="reduction" required />
              <span>
                I understand this removes the authenticator requirement from
                sign-in.
              </span>
            </label>
            <button className="button button--quiet" type="submit">
              Disable authenticator
            </button>
          </fieldset>
        </form>
      ) : enrollment ? (
        <div className="section-stack">
          <p>
            Setup expires at{" "}
            <time dateTime={enrollment.expiresAt}>
              {new Date(enrollment.expiresAt).toLocaleTimeString()}
            </time>
            .
          </p>
          {currentSetup ? (
            <>
              <p>
                In your authenticator app, add an account named Cloud Markup,
                choose a time-based key, and enter this setup key. Keep it
                private.
              </p>
              <label>
                Authenticator setup key
                <input
                  readOnly
                  value={secret}
                  autoComplete="off"
                  spellCheck={false}
                  onFocus={(event) => {
                    event.currentTarget.select();
                  }}
                />
              </label>
              <form
                ref={codeForm}
                onSubmit={(event) => {
                  event.preventDefault();
                  if (disabled) return;
                  const data = new FormData(event.currentTarget);
                  const input = changeAccountAuthenticatorV1Schema.safeParse({
                    contractVersion: 1,
                    attemptId: crypto.randomUUID(),
                    action: "verify-enable",
                    enrollmentId: enrollment.id,
                    code: data.get("code"),
                  });
                  event.currentTarget.reset();
                  if (!input.success) {
                    setError("Enter a six-digit authenticator code.");
                    return;
                  }
                  void change(input.data);
                }}
              >
                <fieldset
                  className="section-stack account-credential-fields"
                  disabled={disabled}
                >
                  <legend>Verify your authenticator</legend>
                  <label>
                    Authenticator code
                    <input
                      name="code"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      pattern="[0-9]{6}"
                      minLength={6}
                      maxLength={6}
                      required
                    />
                  </label>
                  <button type="submit" className="button button--primary">
                    Verify and enable authenticator
                  </button>
                </fieldset>
              </form>
            </>
          ) : (
            <p>
              {enrollment.status === "uncertain" ||
              enrollment.status === "verifying"
                ? "A previous attempt has an unconfirmed outcome. Refresh status or wait until setup expires."
                : "The setup key is no longer available on this page. Cancel the unfinished setup before starting again."}
            </p>
          )}
          <button
            type="button"
            className="button button--quiet"
            disabled={
              disabled ||
              (enrollment.status !== "ready" &&
                enrollment.status !== "starting")
            }
            onClick={() => {
              void change({
                contractVersion: 1,
                attemptId: crypto.randomUUID(),
                action: "cancel-setup",
                enrollmentId: enrollment.id,
              });
            }}
          >
            Cancel unfinished setup
          </button>
        </div>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (disabled || !state.enrollmentAvailable) return;
            const data = new FormData(event.currentTarget);
            if (data.get("recovery") !== "on") return;
            event.currentTarget.reset();
            void start();
          }}
        >
          <fieldset
            className="section-stack account-credential-fields"
            disabled={disabled || !state.enrollmentAvailable}
          >
            <legend>Set up authenticator</legend>
            <label className="account-authenticator-acknowledgement">
              <input type="checkbox" name="recovery" required />
              <span>
                I have saved the recovery contact and understand that password
                recovery does not remove the authenticator.
              </span>
            </label>
            <button type="submit" className="button button--primary">
              Set up authenticator
            </button>
          </fieldset>
        </form>
      )}
    </section>
  );
}
