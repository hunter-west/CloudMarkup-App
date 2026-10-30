import {
  accountWorkspaceListResponseV1Schema,
  accountWorkspaceV1Schema,
  currentPrincipalV1Schema,
  type AccountWorkspaceV1,
  type CurrentPrincipalV1,
} from "@cloudmarkup/api-contract";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  cloudMarkupQueryKeys,
  mapApiError,
  type CloudMarkupQueryRuntime,
} from "../../api/index.js";
import { GitHubIntegrationSettings } from "./GitHubIntegrationSettings.js";
import { GitLabIntegrationSettings } from "./GitLabIntegrationSettings.js";
import { BitbucketIntegrationPlaceholder } from "./BitbucketIntegrationPlaceholder.js";

class PersonalWorkspaceBindingError extends Error {}

async function personalWorkspace(
  runtime: CloudMarkupQueryRuntime,
  principalId: string,
) {
  const response = accountWorkspaceListResponseV1Schema.parse(
    await runtime.client.request("account.workspaces.list", {
      query: { "page[limit]": "100" },
    }),
  );
  // The account contract admits at most 100 workspaces. An incomplete or
  // ambiguous directory must never select a shared organization as Personal.
  if (
    response.page.hasMore ||
    new Set(response.data.map((item) => item.id)).size !==
      response.data.length ||
    response.data.some((item) => item.principalId !== principalId)
  )
    throw new PersonalWorkspaceBindingError();
  const personal = response.data.filter((item) => item.kind === "personal");
  if (personal.length > 1) throw new PersonalWorkspaceBindingError();
  const listed = personal[0];
  if (!listed) return null;
  const workspace = accountWorkspaceV1Schema.parse(
    (
      await runtime.client.request("account.workspaces.get", {
        path: { organizationId: listed.id },
      })
    ).data,
  );
  const actor = currentPrincipalV1Schema.parse(
    (await runtime.client.request("principal.get", {})).data,
  );
  const context = actor.organizationContexts.find(
    (item) => item.organizationId === workspace.id,
  );
  if (
    workspace.id !== listed.id ||
    workspace.kind !== "personal" ||
    workspace.principalId !== principalId ||
    workspace.role !== "owner" ||
    actor.id !== principalId ||
    context?.role !== "owner" ||
    !context.isOwner ||
    !context.capabilities.includes("integrations.read") ||
    !context.capabilities.includes("integrations.manage")
  )
    throw new PersonalWorkspaceBindingError();
  return { workspace, actor };
}

function errorMessage(error: unknown): string {
  return error instanceof PersonalWorkspaceBindingError
    ? "Your personal workspace could not be verified. Reload before managing integrations."
    : mapApiError(error).message;
}

export function PersonalIntegrationSettings({
  runtime,
  principal,
}: {
  readonly runtime: CloudMarkupQueryRuntime;
  readonly principal: CurrentPrincipalV1;
}) {
  const queryKey = [
    ...cloudMarkupQueryKeys.organizations(principal.id),
    "personal-integrations",
  ];
  const details = useQuery({
    queryKey,
    enabled: !runtime.sessionExpired,
    retry: false,
    queryFn: () => personalWorkspace(runtime, principal.id),
  });
  const create = useMutation({
    retry: false,
    mutationFn: async () => {
      if (runtime.sessionExpired) throw new PersonalWorkspaceBindingError();
      const current = currentPrincipalV1Schema.parse(
        (await runtime.client.request("principal.get", {})).data,
      );
      if (current.id !== principal.id)
        throw new PersonalWorkspaceBindingError();
      const created: AccountWorkspaceV1 = accountWorkspaceV1Schema.parse(
        (
          await runtime.client.request("account.personal-workspace.create", {
            body: { contractVersion: 1 },
          })
        ).data,
      );
      if (created.kind !== "personal" || created.principalId !== principal.id)
        throw new PersonalWorkspaceBindingError();
      const result = await personalWorkspace(runtime, principal.id);
      if (result?.workspace.id !== created.id)
        throw new PersonalWorkspaceBindingError();
      return result;
    },
    onSuccess: async (result) => {
      runtime.queryClient.setQueryData(queryKey, result);
      // Refresh global authority through its current session rather than
      // publishing an actor snapshot after an asynchronous workspace creation.
      await runtime.queryClient.invalidateQueries({
        queryKey: cloudMarkupQueryKeys.currentPrincipal(),
      });
      await runtime.queryClient.invalidateQueries({
        queryKey: cloudMarkupQueryKeys.organizations(principal.id),
      });
    },
  });
  const verified = details.data;
  if (runtime.sessionExpired)
    return <p role="alert">Sign in again to manage your integrations.</p>;
  return (
    <div className="section-stack">
      <section className="state-card">
        <h2>Personal integrations</h2>
        <p>
          These connections are for your personal projects. Manage connections
          for shared projects in the organization&apos;s integration settings.
        </p>
        <p>
          Connect GitHub or GitLab when available for your account. Bitbucket is
          coming soon. Other repository providers cannot be added.
        </p>
        {details.isPending ? (
          <p role="status">Checking your personal workspace.</p>
        ) : details.isError ? (
          <>
            <p role="alert">{errorMessage(details.error)}</p>
            <button
              className="button button--secondary"
              type="button"
              onClick={() => void details.refetch()}
            >
              Reload personal workspace
            </button>
          </>
        ) : verified === null ? (
          <>
            <p>
              Create your personal workspace to connect integrations. You do not
              need to join an organization.
            </p>
            <button
              className="button button--primary"
              type="button"
              disabled={create.isPending}
              onClick={() => {
                create.mutate();
              }}
            >
              {create.isPending
                ? "Creating personal workspace…"
                : "Create personal workspace"}
            </button>
          </>
        ) : null}
        {create.isError ? (
          <p role="alert">{errorMessage(create.error)}</p>
        ) : null}
      </section>
      {!details.isError && verified?.actor.id === principal.id ? (
        <>
          <GitHubIntegrationSettings
            key={verified.workspace.id + ":github"}
            organizationId={verified.workspace.id}
            workspaceKind="personal"
            principal={verified.actor}
            runtime={runtime}
          />
          <GitLabIntegrationSettings
            key={verified.workspace.id + ":gitlab"}
            organizationId={verified.workspace.id}
            workspaceKind="personal"
            principal={verified.actor}
            runtime={runtime}
          />
          <BitbucketIntegrationPlaceholder workspaceKind="personal" />
        </>
      ) : null}
    </div>
  );
}
