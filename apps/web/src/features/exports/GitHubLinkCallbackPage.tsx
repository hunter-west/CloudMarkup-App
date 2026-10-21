import type { CompleteGithubAppInstallationLinkV1 } from "@cloudmarkup/api-contract";
import { useEffect, useState } from "react";

import { RoutePage } from "../../shell/RoutePage.js";
import { relayGitHubInstallationLinkCallback } from "./github-installation-link-relay.js";

export function GitHubLinkCallbackPage({
  callback,
}: {
  readonly callback?: CompleteGithubAppInstallationLinkV1;
}) {
  const [status, setStatus] = useState<"pending" | "complete" | "failed">(
    callback === undefined ? "failed" : "pending",
  );
  useEffect(() => {
    if (callback === undefined) return;
    const controller = new AbortController();
    void relayGitHubInstallationLinkCallback(callback, {
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
    <RoutePage
      title="GitHub connection"
      routeKey="github-installation-link-callback"
    >
      <section
        className="state-card"
        role={status === "failed" ? "alert" : "status"}
      >
        <h2>
          {status === "complete"
            ? "GitHub connected in the original tab"
            : status === "failed"
              ? "Return to your original CloudMarkup tab"
              : "Completing your GitHub connection"}
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
