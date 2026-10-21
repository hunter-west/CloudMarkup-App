import {
  githubInstallationLinkIntentV1Schema,
  type ApiResponseV1,
  type CurrentPrincipalV1,
  type CompleteGithubAppInstallationLinkV1,
} from "@cloudmarkup/api-contract";
import { Button, Popover, StatusBadge, type StatusTone } from "@cloudmarkup/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ExternalLink, GitBranch, Info } from "lucide-react";
import { useEffect, useState } from "react";

import {
  cloudMarkupQueryKeys,
  mapApiError,
  type CloudMarkupQueryRuntime,
} from "../../api/index.js";
import { subscribeToGitHubInstallationLinkCallback } from "../exports/github-installation-link-relay.js";

type Installation = ApiResponseV1<"github-installations.list">["data"][number];
type LinkIntent =
  ApiResponseV1<"github-installation-link-intents.create">["data"];

const installationStatuses: Record<
  Installation["status"],
  { label: string; tone: StatusTone }
> = {
  connected: { label: "Connected", tone: "success" },
  "reauthorization-required": { label: "Reconnect required", tone: "warning" },
  suspended: { label: "Suspended", tone: "warning" },
  deleted: { label: "Removed", tone: "incomplete" },
};

class IntegrationBindingError extends Error {
  constructor() {
    super("The integration response did not match this organization.");
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof IntegrationBindingError)
    return "The integration response could not be verified. No connection details were disclosed.";
  const mapped = mapApiError(error);
  return mapped.code === "service_unavailable"
    ? "GitHub connections are unavailable in this deployment. No connection was created."
    : mapped.message;
}

export function GitHubIntegrationSettings({
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
  const [intent, setIntent] = useState<LinkIntent | null>(null);
  const [intentExpired, setIntentExpired] = useState(false);
  const [relayUnavailable, setRelayUnavailable] = useState(false);
  const [selectedIntegrationId, setSelectedIntegrationId] = useState<
    string | null
  >(null);
  const queryKey = cloudMarkupQueryKeys.githubInstallations(
    principal.id,
    organizationId,
  );
  const installations = useQuery({
    enabled: canRead,
    queryKey,
    queryFn: async () => {
      const response = await runtime.client.request(
        "github-installations.list",
        { path: { organizationId } },
      );
      if (
        response.data.some(
          (value) => value.organizationId !== organizationId,
        ) ||
        new Set(response.data.map((value) => value.integrationId)).size !==
          response.data.length
      )
        throw new IntegrationBindingError();
      return response.data;
    },
    retry: false,
  });
  const list =
    installations.data?.every(
      (item) => item.organizationId === organizationId,
    ) === true
      ? installations.data
      : [];
  const selected = list.find(
    (item) =>
      item.integrationId === selectedIntegrationId &&
      item.status === "connected",
  );
  const repositories = useQuery({
    enabled: canRead && selected !== undefined,
    queryKey: [
      ...queryKey,
      selectedIntegrationId ?? "unselected",
      "settings-repositories",
    ],
    queryFn: async () => {
      if (selected === undefined) throw new IntegrationBindingError();
      const response = await runtime.client.request(
        "github-repositories.list",
        {
          path: { organizationId, integrationId: selected.integrationId },
        },
      );
      if (
        response.data.some(
          (value) =>
            value.organizationId !== organizationId ||
            value.integrationId !== selected.integrationId ||
            value.installationId !== selected.installationId,
        ) ||
        new Set(response.data.map((value) => value.repositoryId)).size !==
          response.data.length
      )
        throw new IntegrationBindingError();
      return response.data;
    },
    retry: false,
  });
  const complete = useMutation({
    mutationFn: async (callback: CompleteGithubAppInstallationLinkV1) => {
      if (
        !canManage ||
        callback.intentId !== intent?.intentId ||
        Date.parse(intent.expiresAt) <= Date.now()
      )
        throw new IntegrationBindingError();
      const response = await runtime.client.request(
        "github-installation-link-completions.create",
        {
          body: callback,
          path: { organizationId },
        },
      );
      if (response.data.organizationId !== organizationId)
        throw new IntegrationBindingError();
      await runtime.queryClient.invalidateQueries({ queryKey });
      return response.data;
    },
    retry: false,
  });
  const completeLink = complete.mutateAsync;
  const createLink = useMutation({
    mutationFn: async () => {
      if (!canManage) throw new IntegrationBindingError();
      const response = await runtime.client.request(
        "github-installation-link-intents.create",
        {
          body: { contractVersion: 1 },
          path: { organizationId },
        },
      );
      const parsed = githubInstallationLinkIntentV1Schema.safeParse(
        response.data,
      );
      if (!parsed.success || Date.parse(parsed.data.expiresAt) <= Date.now())
        throw new IntegrationBindingError();
      return parsed.data;
    },
    onSuccess: (next) => {
      complete.reset();
      setRelayUnavailable(false);
      setIntentExpired(false);
      setIntent(next);
    },
    retry: false,
  });

  useEffect(() => {
    if (intent === null || !canManage) return;
    let active = true;
    let unsubscribe: (() => void) | undefined;
    try {
      unsubscribe = subscribeToGitHubInstallationLinkCallback({
        intentId: intent.intentId,
        expiresAt: intent.expiresAt,
        onCallback: completeLink,
      });
    } catch {
      queueMicrotask(() => {
        if (active) setRelayUnavailable(true);
      });
    }
    const timeout = setTimeout(
      () => {
        setIntentExpired(true);
        unsubscribe?.();
      },
      Math.max(0, Date.parse(intent.expiresAt) - Date.now()),
    );
    return () => {
      active = false;
      clearTimeout(timeout);
      unsubscribe?.();
    };
  }, [canManage, completeLink, intent, organizationId, principal.id]);

  if (!canRead)
    return (
      <p role="alert">
        You do not have permission to view organization integrations.
      </p>
    );

  return (
    <section
      className="integration-settings"
      aria-labelledby="github-integration-title"
    >
      <header className="integration-settings__heading">
        <div>
          <GitBranch aria-hidden="true" size={22} />
          <h2 id="github-integration-title">GitHub</h2>
        </div>
        <Popover
          label="GitHub connection details"
          trigger={<Info aria-hidden="true" size={16} />}
          triggerLabel="GitHub connection details"
        >
          <p>
            Install the CloudMarkup GitHub App on repositories you choose.
            Linking verifies your GitHub account and the originating CloudMarkup
            session.
          </p>
          <p>
            Repository export requires a separate reviewed preview and
            confirmation. Connecting does not push code, merge a pull request,
            or deploy infrastructure.
          </p>
        </Popover>
      </header>
      <p className="integration-settings__description">
        {workspaceKind === "personal"
          ? "Personal connection · Repository access stays in your personal workspace."
          : "Shared organization connection · Editors, administrators and owners can use the selected repositories for this organization’s projects. Owners and administrators manage connections."}
      </p>
      {installations.isPending ? (
        <p role="status">Loading GitHub connections…</p>
      ) : installations.isError ? (
        <div role="alert">
          <p>{errorMessage(installations.error)}</p>
          <Button onClick={() => void installations.refetch()}>
            Try again
          </Button>
        </div>
      ) : (
        <>
          {list.length === 0 ? (
            <p>
              {workspaceKind === "personal"
                ? "No GitHub accounts are connected to your personal workspace."
                : "No GitHub accounts are connected to this organization."}
            </p>
          ) : (
            <ul className="integration-settings__connections">
              {list.map((item) => {
                const status = installationStatuses[item.status];
                return (
                  <li key={item.integrationId}>
                    <div className="integration-settings__account">
                      <strong>{item.accountLogin}</strong>
                      <small>
                        {item.accountType} ·{" "}
                        {item.repositorySelection === "selected"
                          ? "Selected repositories"
                          : "All repositories"}
                      </small>
                    </div>
                    <StatusBadge label={status.label} tone={status.tone} />
                    <Button
                      disabled={item.status !== "connected"}
                      onClick={() => {
                        setSelectedIntegrationId(
                          selectedIntegrationId === item.integrationId
                            ? null
                            : item.integrationId,
                        );
                      }}
                      aria-expanded={
                        selectedIntegrationId === item.integrationId
                      }
                    >
                      {selectedIntegrationId === item.integrationId
                        ? "Hide repositories"
                        : "View repositories"}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
          {canManage ? (
            <div className="form-actions">
              <Button
                loading={createLink.isPending}
                loadingLabel="Preparing connection"
                onClick={() => {
                  createLink.mutate();
                }}
              >
                {intent === null ? "Connect GitHub" : "Start new connection"}
              </Button>
            </div>
          ) : (
            <p>Ask an organization owner or administrator to connect GitHub.</p>
          )}
        </>
      )}
      {createLink.isError ? (
        <p role="alert">{errorMessage(createLink.error)}</p>
      ) : null}
      {canManage &&
      intent !== null &&
      !complete.isSuccess &&
      !complete.isError ? (
        <div className="integration-settings__link-flow">
          {intentExpired || relayUnavailable ? (
            <p role="alert">
              {intentExpired
                ? "This connection attempt expired. Start a new connection."
                : "This browser cannot relay the connection securely. Use a browser with cross-tab messaging and start again."}
            </p>
          ) : (
            <>
              <p>
                {workspaceKind === "personal"
                  ? "This installation will be linked to your personal workspace. "
                  : "This installation will be shared with this organization. "}
                Keep this tab open. In the GitHub window, choose only the
                repositories you want to connect.
              </p>
              <a
                className="button button--primary"
                href={intent.installationUrl}
                rel="noopener noreferrer"
                target="_blank"
                onClick={(event) => {
                  if (Date.parse(intent.expiresAt) <= Date.now()) {
                    event.preventDefault();
                    setIntentExpired(true);
                  }
                }}
              >
                Continue to GitHub <ExternalLink aria-hidden="true" size={14} />
              </a>
            </>
          )}
        </div>
      ) : null}
      {complete.isPending ? (
        <p role="status">Verifying your GitHub connection…</p>
      ) : null}
      {complete.isSuccess ? (
        <p role="status">
          GitHub connected. Repository access is limited to the verified
          installation.
        </p>
      ) : null}
      {complete.isError ? (
        <p role="alert">
          {errorMessage(complete.error)} Start a new connection to try again.
        </p>
      ) : null}
      {selected === undefined ? null : (
        <section
          className="integration-settings__repositories"
          aria-label={`Repositories for ${selected.accountLogin}`}
        >
          <h3>Available repositories</h3>
          {repositories.isPending ? (
            <p role="status">Checking repository access…</p>
          ) : repositories.isError ? (
            <p role="alert">{errorMessage(repositories.error)}</p>
          ) : repositories.data.length === 0 ? (
            <p>
              No repositories are available. Review the App&apos;s selected
              repositories in GitHub.
            </p>
          ) : (
            <ul>
              {repositories.data.map((repository) => (
                <li key={repository.repositoryId}>
                  <span>
                    {repository.owner}/{repository.name}
                  </span>
                  <small>
                    {repository.private ? "Private" : "Public"}
                    {repository.archived ? " · Archived" : ""}
                    {repository.disabled ? " · Disabled" : ""}
                  </small>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </section>
  );
}
