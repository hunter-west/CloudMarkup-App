import { Button, StatusBadge } from "@cloudmarkup/ui";
import { GitBranch } from "lucide-react";

/** Presentation only: no provider request, authorization link or credential. */
export function BitbucketIntegrationPlaceholder({
  workspaceKind,
}: {
  readonly workspaceKind: "personal" | "organization";
}) {
  return (
    <section
      className="integration-settings"
      aria-labelledby="bitbucket-integration-title"
    >
      <header className="integration-settings__heading">
        <div>
          <GitBranch aria-hidden="true" size={22} />
          <h2 id="bitbucket-integration-title">Bitbucket</h2>
        </div>
        <StatusBadge label="Coming soon" tone="incomplete" />
      </header>
      <p className="integration-settings__description">
        {workspaceKind === "personal"
          ? "Bitbucket Cloud is planned for your personal projects."
          : "Bitbucket Cloud is planned for this organization's projects."}
      </p>
      <p>Connections, imports and exports are not available yet.</p>
      <div className="form-actions">
        <Button disabled>Connect Bitbucket</Button>
      </div>
    </section>
  );
}
