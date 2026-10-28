import { GitLabProjectSettings } from "./GitLabProjectSettings.js";
import {
  gitlabConnectionListResponseV1Schema,
  gitlabConnectionV1Schema,
  gitlabLinkIntentV1Schema,
  type CurrentPrincipalV1,
  type GitlabConnectionV1,
  type GitlabLinkIntentV1,
} from "@cloudmarkup/api-contract";
import { Button, StatusBadge, type StatusTone } from "@cloudmarkup/ui";
import { useInfiniteQuery, useMutation } from "@tanstack/react-query";
import { ExternalLink, GitBranch } from "lucide-react";
import { useEffect, useState } from "react";
import {
  cloudMarkupQueryKeys,
  mapApiError,
  type CloudMarkupQueryRuntime,
} from "../../api/index.js";
import type { GitLabLinkCallback } from "../exports/gitlab-link-callback.js";
import { subscribeToGitLabLinkCallback } from "../exports/gitlab-link-relay.js";

const statuses: Record<
  GitlabConnectionV1["status"],
  { label: string; tone: StatusTone }
> = {
  active: { label: "Connected", tone: "success" },
  refreshing: { label: "Refreshing access", tone: "incomplete" },
  "reconnect-required": { label: "Reconnect required", tone: "warning" },
  disconnected: { label: "Disconnected", tone: "incomplete" },
  revoked: { label: "Access revoked", tone: "incomplete" },
};
class ConnectionBindingError extends Error {}
function remainingLifetime(expiresAt: string): number {
  return Date.parse(expiresAt) - Date.now();
}
function errorMessage(error: unknown): string {
  if (error instanceof ConnectionBindingError)
    return "The GitLab response could not be verified. Reload your connection status.";
  const code = mapApiError(error).code;
  if (code === "service_unavailable")
    return "GitLab connections are unavailable in this deployment.";
  if (code === "access_denied" || code === "authentication_required")
    return "Sign in again and check your workspace permissions before managing GitLab.";
  return "The GitLab request could not be confirmed. Reload your connection status before trying again.";
}

export function GitLabIntegrationSettings({
  organizationId,
  workspaceKind = "organization",
  principal,
  runtime,
}: {
  readonly organizationId: string;
  readonly workspaceKind?: "personal" | "organization";
  readonly principal: CurrentPrincipalV1;
  readonly runtime: CloudMarkupQueryRuntime;
}) {
  const organization = principal.organizationContexts.find(
    (value) => value.organizationId === organizationId,
  );
  const canRead =
    organization?.capabilities.includes("integrations.read") === true;
  const canManage =
    canRead && organization.capabilities.includes("integrations.manage");
  const [projectConnectionId, setProjectConnectionId] = useState<string | null>(
    null,
  );
  const queryKey = [
    ...cloudMarkupQueryKeys.organization(principal.id, organizationId),
    "gitlab-connections",
  ];
  const [intent, setIntent] = useState<GitlabLinkIntentV1 | null>(null);
  const [intentExpired, setIntentExpired] = useState(false);
  const [relayUnavailable, setRelayUnavailable] = useState(false);
  function bound(value: unknown): GitlabConnectionV1 {
    const parsed = gitlabConnectionV1Schema.safeParse(value);
    if (
      !parsed.success ||
      parsed.data.organizationId !== organizationId ||
      parsed.data.principalId !== principal.id
    )
      throw new ConnectionBindingError();
    return parsed.data;
  }
  const connections = useInfiniteQuery({
    queryKey,
    enabled: canRead && !runtime.sessionExpired,
    retry: false,
    initialPageParam: "",
    queryFn: async ({ pageParam }) => {
      const response = await runtime.client.request("gitlab-connections.list", {
        path: { organizationId },
        query: { limit: 50, ...(pageParam ? { cursor: pageParam } : {}) },
      });
      const parsed = gitlabConnectionListResponseV1Schema.safeParse(response);
      if (!parsed.success) throw new ConnectionBindingError();
      const items = parsed.data.data.map(bound);
      if (
        items.some(
          (item, index) => item.id <= (items[index - 1]?.id ?? pageParam),
        ) ||
        (parsed.data.page.hasMore &&
          (!items.length ||
            parsed.data.page.nextCursor !== items.at(-1)?.id)) ||
        (!parsed.data.page.hasMore && parsed.data.page.nextCursor !== undefined)
      )
        throw new ConnectionBindingError();
      return { items, nextCursor: parsed.data.page.nextCursor };
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
  const canConnect =
    canManage && connections.isSuccess && !runtime.sessionExpired;
  const list = connections.isError
    ? []
    : (connections.data?.pages.flatMap((page) => page.items) ?? []);
  const complete = useMutation({
    retry: false,
    mutationFn: async (callback: GitLabLinkCallback) => {
      if (
        !canConnect ||
        !intent ||
        remainingLifetime(intent.expiresAt) <= 0 ||
        new URL(intent.authorizationUrl).searchParams.get("state") !==
          callback.state
      )
        throw new ConnectionBindingError();
      const response = await runtime.client.request(
        "gitlab-link-completions.create",
        {
          path: { organizationId },
          body: { contractVersion: 1, intentId: intent.intentId, ...callback },
        },
      );
      const connection = bound(response.data);
      await runtime.queryClient.invalidateQueries({ queryKey });
      return connection;
    },
  });
  const completeLink = complete.mutateAsync;
  const createLink = useMutation({
    retry: false,
    mutationFn: async () => {
      if (!canConnect) throw new ConnectionBindingError();
      const response = await runtime.client.request(
        "gitlab-link-intents.create",
        {
          path: { organizationId },
          body: { contractVersion: 1 },
        },
      );
      const parsed = gitlabLinkIntentV1Schema.safeParse(response.data);
      if (
        !parsed.success ||
        remainingLifetime(parsed.data.expiresAt) <= 0 ||
        remainingLifetime(parsed.data.expiresAt) > 630_000 ||
        new URL(parsed.data.authorizationUrl).searchParams.get(
          "redirect_uri",
        ) !==
          window.location.origin + "/account/gitlab/callback"
      )
        throw new ConnectionBindingError();
      return parsed.data;
    },
    onSuccess: (next) => {
      complete.reset();
      setRelayUnavailable(false);
      setIntentExpired(false);
      setIntent(next);
    },
  });
  const disconnect = useMutation({
    retry: false,
    mutationFn: async (connectionId: string) => {
      if (!canConnect || !list.some((value) => value.id === connectionId))
        throw new ConnectionBindingError();
      const response = await runtime.client.request(
        "gitlab-connections.disconnect",
        {
          path: { organizationId, connectionId },
          body: { contractVersion: 1 },
        },
      );
      const result = bound(response.data);
      if (
        result.id !== connectionId ||
        !["disconnected", "revoked"].includes(result.status)
      )
        throw new ConnectionBindingError();
      return result;
    },
    onSettled: async () => {
      await runtime.queryClient.invalidateQueries({ queryKey });
    },
  });
  useEffect(() => {
    if (!intent || !canConnect) return;
    let active = true;
    let stop: (() => void) | undefined;
    try {
      stop = subscribeToGitLabLinkCallback({
        state: new URL(intent.authorizationUrl).searchParams.get("state") ?? "",
        expiresAt: intent.expiresAt,
        onCallback: completeLink,
      });
    } catch {
      queueMicrotask(() => {
        if (active) setRelayUnavailable(true);
      });
    }
    const timer = setTimeout(
      () => {
        setIntentExpired(true);
        stop?.();
      },
      Math.max(0, Date.parse(intent.expiresAt) - Date.now()),
    );
    return () => {
      active = false;
      clearTimeout(timer);
      stop?.();
    };
  }, [canConnect, completeLink, intent, organizationId, principal.id]);
  if (!canRead || runtime.sessionExpired)
    return (
      <p role="alert">
        You do not have permission to view workspace integrations.
      </p>
    );
  return (
    <section
      className="integration-settings"
      aria-labelledby="gitlab-integration-title"
    >
      <header className="integration-settings__heading">
        <div>
          <GitBranch aria-hidden="true" size={22} />
          <h2 id="gitlab-integration-title">GitLab</h2>
        </div>
      </header>
      <p className="integration-settings__description">
        {connections.isSuccess
          ? "Connect your GitLab.com account for this workspace. Your connection belongs to you and is not shared with other members."
          : "GitLab availability must be confirmed before you can connect. Download an available bundle or use GitHub when your account and workspace permit it."}
      </p>
      <p>
        {workspaceKind === "personal"
          ? "Personal connection · Available only to you in your personal workspace."
          : "Member-owned connection · Available only to you in this organization. Other members cannot use your GitLab authorization; shared organization GitLab connections are not available."}
      </p>
      {connections.isSuccess ? (
        <p>
          GitLab requests broad access to its API, including repositories you
          can access. Review that scope before connecting. Repository export has
          separate availability, permission and plan checks.
        </p>
      ) : null}
      {connections.isPending ? (
        <p role="status">Loading GitLab connections…</p>
      ) : connections.isError ? (
        <div role="alert">
          <p>{errorMessage(connections.error)}</p>
          <Button onClick={() => void connections.refetch()}>
            Reload GitLab status
          </Button>
        </div>
      ) : (
        <>
          {list.length === 0 ? (
            <p>You have no GitLab connections in this workspace.</p>
          ) : (
            <ul className="integration-settings__connections">
              {list.map((item) => (
                <li key={item.id}>
                  <div className="integration-settings__account">
                    <strong>{item.providerUsername}</strong>
                    <StatusBadge {...statuses[item.status]} />
                    {item.providerRevocation === "requires-user-action" ? (
                      <p>
                        CloudMarkup cannot confirm that all GitLab access was
                        revoked. Remove the CloudMarkup authorization in{" "}
                        <a
                          href="https://gitlab.com/-/user_settings/applications"
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          GitLab applications
                        </a>
                        , then connect again if needed.
                      </p>
                    ) : item.providerRevocation === "pending" ? (
                      <p>
                        CloudMarkup access is blocked. GitLab revocation still
                        needs to be confirmed.
                      </p>
                    ) : null}
                  </div>
                  {item.status === "active" ? (
                    <Button
                      aria-label={
                        "Choose projects for " + item.providerUsername
                      }
                      onClick={() => {
                        setProjectConnectionId(item.id);
                      }}
                    >
                      Choose projects
                    </Button>
                  ) : null}
                  {canConnect &&
                  item.status !== "revoked" &&
                  !(
                    item.status === "disconnected" &&
                    item.providerRevocation === "requires-user-action"
                  ) ? (
                    <Button
                      disabled={disconnect.isPending}
                      aria-label={`${item.status === "disconnected" ? "Retry revocation for" : "Disconnect"} ${item.providerUsername}`}
                      onClick={() => {
                        disconnect.mutate(item.id);
                      }}
                    >
                      {item.status === "disconnected"
                        ? "Retry revocation"
                        : "Disconnect"}
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {connections.hasNextPage ? (
            <Button
              loading={connections.isFetchingNextPage}
              onClick={() => void connections.fetchNextPage()}
            >
              Load more GitLab connections
            </Button>
          ) : null}
          <div className="form-actions">
            <Button onClick={() => void connections.refetch()}>
              Reload GitLab status
            </Button>
            {canConnect ? (
              <Button
                loading={createLink.isPending}
                disabled={complete.isPending}
                onClick={() => {
                  createLink.mutate();
                }}
              >
                {intent ? "Start new GitLab connection" : "Connect GitLab"}
              </Button>
            ) : (
              <p>An owner or administrator can connect their GitLab account.</p>
            )}
          </div>
        </>
      )}
      {projectConnectionId &&
      list.some(
        (item) => item.id === projectConnectionId && item.status === "active",
      ) ? (
        <GitLabProjectSettings
          key={organizationId + principal.id + projectConnectionId}
          organizationId={organizationId}
          principalId={principal.id}
          connectionId={projectConnectionId}
          canManage={canManage}
          runtime={runtime}
        />
      ) : null}
      {createLink.isError ? (
        <p role="alert">{errorMessage(createLink.error)}</p>
      ) : null}
      {canConnect && intent && !complete.isSuccess && !complete.isError ? (
        <div className="integration-settings__link-flow">
          {intentExpired || relayUnavailable ? (
            <p role="alert">
              {intentExpired
                ? "This connection attempt expired. Start a new GitLab connection."
                : "This browser cannot relay the connection securely. Use a browser with cross-tab messaging and start again."}
            </p>
          ) : (
            <>
              <p>
                Keep this tab open while you authorize CloudMarkup in GitLab.
              </p>
              <a
                className="button button--primary"
                href={intent.authorizationUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(event) => {
                  if (remainingLifetime(intent.expiresAt) <= 0) {
                    event.preventDefault();
                    setIntentExpired(true);
                  }
                }}
              >
                Continue to GitLab <ExternalLink aria-hidden="true" size={14} />
              </a>
            </>
          )}
        </div>
      ) : null}
      {complete.isPending ? (
        <p role="status">Verifying your GitLab connection…</p>
      ) : null}
      {complete.isSuccess ? (
        <p role="status">GitLab connection saved. Review its status above.</p>
      ) : null}
      {complete.isError ? (
        <p role="alert">{errorMessage(complete.error)}</p>
      ) : null}
      {disconnect.isError ? (
        <p role="alert">{errorMessage(disconnect.error)}</p>
      ) : null}
      {disconnect.isSuccess ? (
        <p role="status">
          CloudMarkup access is disconnected. Review the GitLab revocation
          status above.
        </p>
      ) : null}
    </section>
  );
}
