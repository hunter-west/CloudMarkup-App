import { Dialog } from "@cloudmarkup/ui";
import { useEffect, useRef, useState, type SyntheticEvent } from "react";

import type { LocalOwnerBrowserSession } from "./local-owner-browser-auth.js";

/** This proof page overlays the current route without unmounting it. The
 * pending invitation, membership or session attempt remains in this tab. */
export function LocalOwnerReauthenticationPage({
  session,
  onAuthenticated,
  onCancel,
}: {
  readonly session: LocalOwnerBrowserSession;
  readonly onAuthenticated: () => void;
  readonly onCancel: () => void;
}) {
  const proofInput = useRef<HTMLInputElement>(null);
  const activeAttempt = useRef<AbortController | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    proofInput.current?.focus();
    return () => activeAttempt.current?.abort();
  }, []);

  function cancel() {
    activeAttempt.current?.abort();
    activeAttempt.current = null;
    onCancel();
  }

  function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const proof = proofInput.current?.value ?? "";
    if (proofInput.current !== null) proofInput.current.value = "";
    const controller = new AbortController();
    activeAttempt.current = controller;
    setPending(true);
    setError(false);
    void session.exchange(proof, controller.signal).then(
      () => {
        if (activeAttempt.current !== controller || controller.signal.aborted)
          return;
        activeAttempt.current = null;
        onAuthenticated();
      },
      () => {
        if (activeAttempt.current !== controller || controller.signal.aborted)
          return;
        activeAttempt.current = null;
        setPending(false);
        setError(true);
        proofInput.current?.focus();
      },
    );
  }

  return (
    <Dialog onClose={cancel} open title="Confirm local owner access">
      <p>
        Enter your local operator proof to continue the pending action. Your
        current page and attempt remain open.
      </p>
      <form onSubmit={submit}>
        <label htmlFor="local-reauth-proof">Local owner proof</label>
        <input
          autoComplete="off"
          id="local-reauth-proof"
          name="local-reauth-proof"
          ref={proofInput}
          required
          spellCheck={false}
          type="password"
        />
        <button
          className="button button--primary"
          disabled={pending}
          type="submit"
        >
          {pending ? "Checking local proof..." : "Continue pending action"}
        </button>
      </form>
      {error ? (
        <p role="alert">
          The local owner proof was not accepted. Check the server and try
          again.
        </p>
      ) : null}
    </Dialog>
  );
}
