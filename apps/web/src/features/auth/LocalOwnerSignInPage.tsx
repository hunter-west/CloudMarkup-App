import { useEffect, useRef, useState, type SyntheticEvent } from "react";

import { useOptionalCloudMarkupQueryRuntime } from "../../api/index.js";
import { useAppLocation, useNavigate } from "../../routing/index.js";
import { RoutePage } from "../../shell/RoutePage.js";
import { signInReturnPathFromSearch } from "./sign-in-return-path.js";
import { useOptionalLocalOwnerSession } from "./local-owner-session.js";

export function LocalOwnerSignInPage() {
  const localOwner = useOptionalLocalOwnerSession();
  const runtime = useOptionalCloudMarkupQueryRuntime();
  const navigate = useNavigate();
  const location = useAppLocation();
  const proofInput = useRef<HTMLInputElement>(null);
  const activeAttempt = useRef<AbortController | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(
    () => () => {
      activeAttempt.current?.abort();
      activeAttempt.current = null;
    },
    [],
  );

  const submit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (localOwner === null || pending) return;
    const proof = proofInput.current?.value ?? "";
    if (proofInput.current !== null) proofInput.current.value = "";
    const controller = new AbortController();
    activeAttempt.current = controller;
    setPending(true);
    setError(null);
    void localOwner.session.exchange(proof, controller.signal).then(
      () => {
        if (activeAttempt.current !== controller || controller.signal.aborted)
          return;
        runtime?.resumeSession();
        const destination =
          signInReturnPathFromSearch(location.search) ?? "/settings/profile";
        activeAttempt.current = null;
        setPending(false);
        navigate(destination, { replace: true });
      },
      () => {
        if (activeAttempt.current !== controller || controller.signal.aborted)
          return;
        activeAttempt.current = null;
        setPending(false);
        setError(
          "The local owner proof was not accepted. Check the server and try again.",
        );
        proofInput.current?.focus();
      },
    );
  };

  return (
    <RoutePage
      title="Sign in to local CloudMarkup"
      routeKey="local-owner-sign-in"
    >
      <section className="auth-entry" aria-label="Local owner sign in">
        <div className="auth-entry__overview">
          <p className="status-label">Self-hosted workspace</p>
          <h2>Your local architecture workspace</h2>
          <p>
            Enter the operator proof from your local setup. The proof is sent
            only to the local server; the resulting session stays in this
            browser tab until it expires or you sign out.
          </p>
        </div>
        <div className="auth-entry__panel">
          <h2>Local owner access</h2>
          <p>
            This installation accepts one operator. Reloading the page requires
            a new sign-in.
          </p>
          <form onSubmit={submit}>
            <label htmlFor="local-owner-proof">Local owner proof</label>
            <input
              autoComplete="off"
              id="local-owner-proof"
              name="local-owner-proof"
              ref={proofInput}
              required
              spellCheck={false}
              type="password"
            />
            <button
              className="button button--primary auth-entry__primary-action"
              disabled={pending || localOwner === null}
              type="submit"
            >
              {pending ? "Checking local proof..." : "Sign in locally"}
            </button>
          </form>
          {pending ? (
            <p aria-live="polite" role="status">
              Checking your local owner proof.
            </p>
          ) : null}
          {error === null ? null : <p role="alert">{error}</p>}
        </div>
      </section>
    </RoutePage>
  );
}
