import {
  accountWorkspaceV1Schema,
  type CurrentPrincipalV1,
} from "@cloudmarkup/api-contract";
import { useQuery } from "@tanstack/react-query";
import {
  cloudMarkupQueryKeys,
  mapApiError,
  type CloudMarkupQueryRuntime,
} from "../../api/index.js";
import { GitHubIntegrationSettings } from "./GitHubIntegrationSettings.js";
import { GitLabIntegrationSettings } from "./GitLabIntegrationSettings.js";
import { BitbucketIntegrationPlaceholder } from "./BitbucketIntegrationPlaceholder.js";

class WorkspaceBindingError extends Error {}

/** Legacy organization-shaped routes also address private personal tenants. */
export function VerifiedWorkspaceIntegrationSettings({
  runtime,
  principal,
  organizationId,
}: {
  readonly runtime: CloudMarkupQueryRuntime;
  readonly principal: CurrentPrincipalV1;
  readonly organizationId: string;
}) {
  const context = principal.organizationContexts.find(
    (item) => item.organizationId === organizationId,
  );
  const canRead = context?.capabilities.includes("integrations.read") === true;
  const scope = useQuery({
    queryKey: [
      ...cloudMarkupQueryKeys.organization(principal.id, organizationId),
      "integration-workspace-kind",
      context?.role,
    ],
    enabled: canRead && !runtime.sessionExpired,
    retry: false,
    queryFn: async () => {
      const workspace = accountWorkspaceV1Schema.parse(
        (
          await runtime.client.request("account.workspaces.get", {
            path: { organizationId },
          })
        ).data,
      );
      if (
        workspace.id !== organizationId ||
        workspace.principalId !== principal.id ||
        workspace.role !== context?.role
      )
        throw new WorkspaceBindingError();
      return workspace;
    },
  });
  if (!canRead || runtime.sessionExpired)
    return (
      <p role="alert">Sign in with permission to view these integrations.</p>
    );
  if (scope.isPending)
    return <p role="status">Checking your integration access.</p>;
  const workspace = scope.data;
  async function reload() {
    await runtime.queryClient.invalidateQueries({
      queryKey: cloudMarkupQueryKeys.currentPrincipal(),
    });
    await scope.refetch();
  }
  if (
    scope.isError ||
    workspace?.id !== organizationId ||
    workspace.principalId !== principal.id ||
    workspace.role !== context.role
  )
    return (
      <section className="state-card">
        <p role="alert">
          {scope.error instanceof WorkspaceBindingError || !scope.isError
            ? "Your personal workspace or organization could not be verified. Reload before connecting."
            : mapApiError(scope.error).message}
        </p>
        <button
          className="button button--secondary"
          type="button"
          onClick={() => void reload()}
        >
          Reload integration access
        </button>
      </section>
    );
  const binding = JSON.stringify([principal.id, workspace.id, context]);
  return (
    <div className="section-stack">
      <section className="state-card">
        <h2>
          {workspace.kind === "personal"
            ? "Personal integrations"
            : "Organization integrations"}
        </h2>
        <p>
          {workspace.kind === "personal"
            ? "Personal workspace"
            : "Organization"}
          : {workspace.displayName}
        </p>
        <p>
          {workspace.kind === "personal"
            ? "These connections are for your personal projects. Manage connections for shared projects in the organization's integration settings."
            : "Manage repository connections for this organization's projects. Your personal integrations stay separate."}
        </p>
        <p>
          Connect GitHub or GitLab when available for your account. Bitbucket is
          coming soon. Other repository providers cannot be added.
        </p>
      </section>
      <GitHubIntegrationSettings
        key={binding + ":github"}
        runtime={runtime}
        principal={principal}
        organizationId={workspace.id}
        workspaceKind={workspace.kind}
      />
      <GitLabIntegrationSettings
        key={binding + ":gitlab"}
        runtime={runtime}
        principal={principal}
        organizationId={workspace.id}
        workspaceKind={workspace.kind}
      />
      <BitbucketIntegrationPlaceholder workspaceKind={workspace.kind} />
    </div>
  );
}
