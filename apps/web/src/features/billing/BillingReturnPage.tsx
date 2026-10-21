import { useEffect } from "react";
import { completeBillingWindowReturn } from "./billing-hosted-window.js";

export function BillingReturnPage({ returnId }: { readonly returnId: string }) {
  useEffect(() => {
    try {
      return completeBillingWindowReturn(returnId);
    } catch {
      // Storage or messaging can be unavailable. The original tab still owns
      // its session and refreshes authenticated billing state when focused.
      return;
    }
  }, [returnId]);
  return (
    <section className="state-card" aria-label="Return from billing">
      <h1>Return to CloudMarkup</h1>
      <p>
        Your original CloudMarkup tab is still open. You can close this window.
      </p>
      <button
        className="button"
        type="button"
        onClick={() => {
          window.close();
        }}
      >
        Close billing window
      </button>
    </section>
  );
}
