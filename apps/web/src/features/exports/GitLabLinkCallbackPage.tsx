import type { GitLabLinkCallback } from "./gitlab-link-callback.js";
import { useEffect, useState } from "react";

import { RoutePage } from "../../shell/RoutePage.js";
import { relayGitLabLinkCallback } from "./gitlab-link-relay.js";

export function GitLabLinkCallbackPage({
  callback,
}: {
  readonly callback?: GitLabLinkCallback;
}) {
  const [status, setStatus] = useState<"pending" | "complete" | "failed">(
    callback === undefined ? "failed" : "pending",
  );
  useEffect(() => {
    if (callback === undefined) return;
    const controller = new AbortController();
    void relayGitLabLinkCallback(callback, {
      signal: controller.signal,
    }).then(
      () => {
        if (!controller.signal.aborted) setStatus("complete");
      },
      () => {
        if (!controller.signal.aborted) setStatus("failed");
      },
    );
    return () => {
      controller.abort();
    };
  }, [callback]);

  return (
    <RoutePage title="GitLab connection" routeKey="gitlab-link-callback">
      <section
        className="state-card"
        role={status === "failed" ? "alert" : "status"}
      >
        <h2>
          {status === "complete"
            ? "GitLab connected in the original tab"
            : status === "failed"
              ? "Return to your original CloudMarkup tab"
              : "Completing your GitLab connection"}
        </h2>
        <p>
          {status === "complete"
            ? "You may close this window and continue in CloudMarkup."
            : status === "failed"
              ? "The original signed-in tab must remain open. Start a new connection there if this attempt expired or was rejected."
              : "The original signed-in tab is verifying this one-time connection. Keep it open."}
        </p>
      </section>
    </RoutePage>
  );
}
