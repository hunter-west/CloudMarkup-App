import type {
  CreateGithubRepositoryImportV1,
  CurrentPrincipalV1,
  GithubRepositoryImportV1,
  GithubRepositoryReconciliationReviewV1,
  ReviewGithubRepositoryImportV1,
} from "@cloudmarkup/api-contract";
import type { ArchitectureDocumentV3 } from "@cloudmarkup/schemas";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  cloudMarkupQueryKeys,
  mapApiError,
  useOptionalCloudMarkupQueryRuntime,
} from "../../../api/index.js";
import { useWorkspaceShellController } from "../../../shell/workspace-shell-context.js";
import { AppLink } from "../../../routing/index.js";
import { useModePreference } from "../../../preferences/index.js";
import { GitHubRepositoryImportPanel } from "./GitHubRepositoryImportPanel.js";
import {
  RepositoryConformanceView,
  type RepositoryConformanceDisplayResult,
  type RepositoryReviewAction,
} from "./RepositoryConformanceView.js";

function mutationKey(prefix: string): string {
  return `${prefix}:${globalThis.crypto.randomUUID()}`;
}

function reviewDecision(
  action: RepositoryReviewAction["action"],
): ReviewGithubRepositoryImportV1["decision"] {
  switch (action) {
    case "accept-into-design":
      return "accept-into-design";
    case "keep-observed-only":
      return "keep-observed";
    case "mark-external":
      return "mark-external";
    case "regenerate-to-design":
      return "regenerate";
    case "ignore":
      return "ignore";
    case "reject":
      return "reject";
  }
}

function displayResult(
  record: GithubRepositoryImportV1,
): RepositoryConformanceDisplayResult | undefined {
  if (record.observedSolution === undefined) return undefined;
  return {
    differences: record.semanticDifferences,
    issues: record.issues.map((issue) => ({
      id: issue.issueId,
      lifecycle: { state: issue.lifecycle },
      severity: issue.severity,
      sourceRecordId: issue.evidenceIds.join(", ") || issue.issueId,
      summary: issue.summary,
    })),
    observedSolution: record.observedSolution,
  };
}

export interface RepositoryGraphAcceptanceRequest {
  readonly importId: string;
  readonly input: ReviewGithubRepositoryImportV1;
  readonly idempotencyKey: string;
}
export type AcceptRepositoryGraph = (
  request: RepositoryGraphAcceptanceRequest,
) => Promise<GithubRepositoryReconciliationReviewV1>;

export function GitHubRepositoryWorkspace({
  architecture,
  onAcceptIntoDesign,
  firstRevisionAction,
  organizationId,
  principal,
  projectId,
}: {
  readonly architecture: ArchitectureDocumentV3;
  readonly onAcceptIntoDesign?: AcceptRepositoryGraph;
  readonly firstRevisionAction?: (onStarted: () => void) => ReactNode;
  readonly organizationId: string;
  readonly principal: CurrentPrincipalV1;
  readonly projectId: string;
}) {
  const runtime = useOptionalCloudMarkupQueryRuntime();
  const { mode } = useModePreference();
  const shell = useWorkspaceShellController();
  const [firstRevisionRequested, setFirstRevisionRequested] = useState(false);
  const firstRevisionFocused = useRef(false);
  const markFirstRevisionStarted = useCallback(() => {
    setFirstRevisionRequested(true);
  }, []);
  const revisions = useQuery({
    enabled: runtime !== null,
    queryKey: cloudMarkupQueryKeys.revisions(
      principal.id,
      organizationId,
      projectId,
    ),
    staleTime: 0,
    queryFn: async () => {
      if (runtime === null) throw new TypeError("API runtime unavailable.");
      const response = await runtime.client.request("solution-revisions.list", {
        path: { projectId },
        query: { "page[limit]": "100", sort: "-createdAt" },
      });
      if (response.data.some((revision) => revision.projectId !== projectId))
        throw new TypeError("Repository baseline project binding failed.");
      return response.data;
    },
  });
  const revisionConfirmed =
    revisions.isSuccess && revisions.data.length > 0 && !revisions.isFetching;
  useEffect(() => {
    if (
      revisionConfirmed &&
      firstRevisionRequested &&
      !firstRevisionFocused.current
    ) {
      firstRevisionFocused.current = true;
      shell?.openWorkspacePanel("code", "repository-import-form");
    }
  }, [revisionConfirmed, firstRevisionRequested, shell]);
  const [selectedIntegrationId, setSelectedIntegrationId] = useState<
    string | undefined
  >();
  const [selectedRepositoryId, setSelectedRepositoryId] = useState<number>();
  const [notice, setNotice] = useState<string>();
  const idempotencyKeys = useRef(new Map<string, string>());

  const installations = useQuery({
    enabled: runtime !== null,
    queryKey: cloudMarkupQueryKeys.githubInstallations(
      principal.id,
      organizationId,
    ),
    queryFn: async () => {
      if (runtime === null) throw new TypeError("API runtime unavailable.");
      const response = await runtime.client.request(
        "github-installations.list",
        {
          path: { organizationId },
        },
      );
      if (
        response.data.some(
          (installation) => installation.organizationId !== organizationId,
        )
      ) {
        throw new TypeError("GitHub installation tenant binding failed.");
      }
      return response.data.filter(({ status }) => status === "connected");
    },
  });
  const effectiveIntegrationId =
    selectedIntegrationId ?? installations.data?.[0]?.integrationId ?? "";

  const repositories = useQuery({
    enabled: runtime !== null && effectiveIntegrationId !== "",
    queryKey: cloudMarkupQueryKeys.githubRepositories(
      principal.id,
      organizationId,
      effectiveIntegrationId === "" ? "unselected" : effectiveIntegrationId,
    ),
    queryFn: async () => {
      if (runtime === null || effectiveIntegrationId === "") {
        throw new TypeError("GitHub installation selection is unavailable.");
      }
      const response = await runtime.client.request(
        "github-repositories.list",
        {
          path: { integrationId: effectiveIntegrationId, organizationId },
        },
      );
      if (
        response.data.some(
          (repository) =>
            repository.organizationId !== organizationId ||
            repository.integrationId !== effectiveIntegrationId,
        )
      ) {
        throw new TypeError("GitHub repository tenant binding failed.");
      }
      return response.data.filter(
        ({ archived, disabled }) => !archived && !disabled,
      );
    },
  });
  const effectiveRepositoryId =
    selectedRepositoryId ?? repositories.data?.[0]?.repositoryId ?? 0;

  const branches = useQuery({
    enabled: runtime !== null && effectiveRepositoryId > 0,
    queryKey: cloudMarkupQueryKeys.githubRepositoryBranches(
      principal.id,
      organizationId,
      effectiveIntegrationId === "" ? "unselected" : effectiveIntegrationId,
      effectiveRepositoryId > 0 ? effectiveRepositoryId : 1,
    ),
    queryFn: async () => {
      if (
        runtime === null ||
        effectiveIntegrationId === "" ||
        effectiveRepositoryId <= 0
      ) {
        throw new TypeError("GitHub repository selection is unavailable.");
      }
      const response = await runtime.client.request(
        "github-repository-branches.list",
        {
          path: {
            integrationId: effectiveIntegrationId,
            organizationId,
            repositoryId: effectiveRepositoryId,
          },
        },
      );
      return response.data;
    },
  });

  const historyKey = cloudMarkupQueryKeys.githubRepositoryImports(
    principal.id,
    organizationId,
    projectId,
    effectiveRepositoryId > 0 ? effectiveRepositoryId : undefined,
  );
  const history = useQuery({
    enabled: runtime !== null && effectiveRepositoryId > 0,
    queryKey: historyKey,
    queryFn: async () => {
      if (runtime === null || effectiveRepositoryId <= 0) {
        throw new TypeError("GitHub repository selection is unavailable.");
      }
      const response = await runtime.client.request(
        "github-repository-imports.list",
        {
          path: { projectId },
          query: { repositoryId: String(effectiveRepositoryId) },
        },
      );
      if (
        response.data.some(
          (record) =>
            record.projectId !== projectId ||
            record.repositoryId !== effectiveRepositoryId,
        )
      ) {
        throw new TypeError("Repository import project binding failed.");
      }
      return response.data;
    },
  });

  const importMutation = useMutation({
    mutationFn: async (input: CreateGithubRepositoryImportV1) => {
      if (runtime === null || !revisionConfirmed)
        throw new TypeError(
          "Save a confirmed revision before importing repository code.",
        );
      const signature = JSON.stringify(input);
      const key =
        idempotencyKeys.current.get(signature) ?? mutationKey("github-import");
      idempotencyKeys.current.set(signature, key);
      setNotice(undefined);
      try {
        const response = await runtime.client.request(
          "github-repository-imports.create",
          {
            body: input,
            headers: { "idempotency-key": key },
            path: { projectId },
          },
        );
        if (
          response.data.projectId !== projectId ||
          response.data.repositoryId !== input.repositoryId
        ) {
          throw new TypeError("Repository import project binding failed.");
        }
        idempotencyKeys.current.delete(signature);
        await runtime.queryClient.invalidateQueries({
          queryKey: cloudMarkupQueryKeys.githubRepositoryImports(
            principal.id,
            organizationId,
            projectId,
          ),
        });
        setNotice(
          response.data.state === "succeeded"
            ? `Pinned snapshot ${response.data.commitSha.slice(0, 12)} was imported without changing the approved design.`
            : response.data.state === "running"
              ? "The repository import is still running. Refresh its history to see the result."
              : "The repository import failed. Review the selected files and import history before trying again.",
        );
      } catch (error) {
        const mapped = mapApiError(error);
        if (mapped.sessionExpired) runtime.expireSession();
        throw new Error(mapped.message, { cause: error });
      }
    },
  });

  const reviewMutation = useMutation({
    mutationFn: async ({
      action,
      importId,
      snapshotDigest,
    }: {
      readonly action: RepositoryReviewAction;
      readonly importId: string;
      readonly snapshotDigest: string;
    }) => {
      if (runtime === null || action.operationId === undefined) {
        throw new TypeError("A reviewable repository operation is required.");
      }
      const decision = reviewDecision(action.action);
      const signature = [
        "review",
        importId,
        snapshotDigest,
        action.operationId,
        decision,
        action.reason ?? "",
      ].join(":");
      const key =
        idempotencyKeys.current.get(signature) ?? mutationKey("github-review");
      idempotencyKeys.current.set(signature, key);
      const input: ReviewGithubRepositoryImportV1 = {
        contractVersion: 1,
        decision,
        expectedSnapshotDigest: snapshotDigest,
        operationId: action.operationId,
        ...(action.reason === undefined ? {} : { reason: action.reason }),
      };
      if (decision === "accept-into-design" && onAcceptIntoDesign === undefined)
        throw new Error(
          "Open this project in the saved editor with editing access before accepting changes.",
        );
      const reviewed =
        decision === "accept-into-design" && onAcceptIntoDesign !== undefined
          ? await onAcceptIntoDesign({ importId, input, idempotencyKey: key })
          : (
              await runtime.client.request(
                "github-repository-import-reviews.create",
                {
                  body: input,
                  headers: { "idempotency-key": key },
                  path: { importId, projectId },
                },
              )
            ).data;
      if (reviewed.importId !== importId) {
        throw new TypeError("Repository review import binding failed.");
      }
      idempotencyKeys.current.delete(signature);
      setNotice(
        decision === "regenerate"
          ? "A reviewed restore preview was created. Repository changes still require the existing branch and pull-request export workflow."
          : reviewed.designChanged
            ? "The accepted canonical operation changed the approved design."
            : "The repository observation review was recorded without changing the approved design.",
      );
    },
  });

  const selectRepository = useCallback(
    (selection: {
      readonly integrationId: string;
      readonly repositoryId: number;
    }) => {
      setSelectedIntegrationId(selection.integrationId);
      setSelectedRepositoryId(selection.repositoryId);
      setNotice(undefined);
    },
    [],
  );
  const latest = useMemo(
    () =>
      [...(history.data ?? [])]
        .filter(({ state }) => state === "succeeded")
        .sort((left, right) =>
          right.createdAt.localeCompare(left.createdAt),
        )[0],
    [history.data],
  );
  const comparison = latest === undefined ? undefined : displayResult(latest);
  const comparisonRevisionId = latest?.comparisonSolutionRevisionId;
  const baseline = useQuery({
    enabled: runtime !== null && comparisonRevisionId !== undefined,
    queryKey: cloudMarkupQueryKeys.revision(
      principal.id,
      organizationId,
      projectId,
      comparisonRevisionId ?? "unselected",
    ),
    queryFn: async () => {
      if (runtime === null || comparisonRevisionId === undefined)
        throw new TypeError("The comparison revision is unavailable.");
      const response = await runtime.client.request("solution-revisions.get", {
        path: { projectId, solutionRevisionId: comparisonRevisionId },
      });
      if (
        response.data.summary.projectId !== projectId ||
        response.data.summary.solutionRevisionId !== comparisonRevisionId
      )
        throw new TypeError("Repository comparison revision binding failed.");
      return response.data;
    },
    select: (revision) => revision.revision.architectureDocument,
  });
  const queryError =
    installations.error ??
    repositories.error ??
    branches.error ??
    history.error ??
    baseline.error;

  if (runtime === null) {
    return (
      <section className="workspace-empty" role="alert">
        <h2>Repository import is unavailable</h2>
        <p>The authenticated API client is not connected.</p>
      </section>
    );
  }
  if (queryError !== null) {
    return (
      <section className="workspace-empty" role="alert">
        <h2>Repository evidence could not be loaded</h2>
        <p>{mapApiError(queryError).message}</p>
      </section>
    );
  }
  if (installations.isPending) {
    return (
      <section aria-live="polite" className="workspace-empty">
        <h2>Loading authorized repositories…</h2>
      </section>
    );
  }
  if ((installations.data?.length ?? 0) === 0) {
    return (
      <section className="workspace-empty">
        <h2>No connected GitHub App installation</h2>
        <p>
          Connect GitHub to import Terraform or CloudFormation files from a
          repository and review them on your canvas.
        </p>
        <AppLink
          to={`/organizations/${encodeURIComponent(organizationId)}/settings/integrations`}
        >
          Connect GitHub
        </AppLink>
      </section>
    );
  }
  if (repositories.isPending) {
    return (
      <section aria-live="polite" className="workspace-empty">
        <h2>Loading authorized repositories…</h2>
      </section>
    );
  }
  if ((repositories.data?.length ?? 0) === 0) {
    return (
      <section className="workspace-empty">
        <h2>No authorized repository is available</h2>
        <p>Select repositories in the GitHub App installation settings.</p>
        <AppLink
          to={`/organizations/${encodeURIComponent(organizationId)}/settings/integrations`}
        >
          Manage GitHub connection
        </AppLink>
      </section>
    );
  }

  if (branches.isPending) {
    return (
      <section aria-live="polite" className="workspace-empty">
        <h2>Loading repository branches…</h2>
      </section>
    );
  }

  return (
    <div>
      {notice === undefined ? null : (
        <p aria-live="polite" className="status-card" role="status">
          {notice}
        </p>
      )}
      {revisions.isPending || revisions.isFetching ? (
        <p role="status">Checking your saved revision before import…</p>
      ) : revisions.isError ? (
        <section className="workspace-empty" role="alert">
          <h2>We couldn&apos;t check your saved revision</h2>
          <p>{mapApiError(revisions.error).message}</p>
          <button
            className="text-link"
            type="button"
            onClick={() => {
              void revisions.refetch();
            }}
          >
            Check again
          </button>
        </section>
      ) : revisions.data.length === 0 ? (
        <section
          className="workspace-empty"
          aria-label="Save a first revision before import"
        >
          <h2>Save your first revision</h2>
          <p>
            A revision is a saved checkpoint for comparing your design with
            code. Save this project first, then choose code from GitHub to
            review.
          </p>
          <p>
            Terraform and CloudFormation imports are read-only observations.
            They do not automatically become editable canvas resources. Your
            original repository files stay unchanged.
          </p>
          {firstRevisionAction?.(markFirstRevisionStarted) ?? (
            <p>
              Open this project with editing access to save a revision before
              importing.
            </p>
          )}
        </section>
      ) : null}
      <GitHubRepositoryImportPanel
        key={`${principal.id}:${organizationId}:${projectId}:${effectiveIntegrationId}:${String(effectiveRepositoryId)}`}
        assistanceMode={mode}
        disabled={!revisionConfirmed}
        branches={branches.data ?? []}
        history={history.data ?? []}
        installations={installations.data ?? []}
        onDiscover={async (input) => {
          try {
            const response = await runtime.client.request(
              "github-repository-discovery.read",
              { body: input, path: { projectId } },
            );
            if (response.data.projectId !== projectId)
              throw new TypeError(
                "Repository discovery project binding failed.",
              );
            return response.data;
          } catch (error) {
            const mapped = mapApiError(error);
            if (mapped.sessionExpired) runtime.expireSession();
            throw new Error(mapped.message, { cause: error });
          }
        }}
        onImport={async (input) => {
          await importMutation.mutateAsync(input);
        }}
        onRepositorySelectionChange={selectRepository}
        repositories={repositories.data ?? []}
      />
      {comparisonRevisionId !== undefined && baseline.isPending ? (
        <p role="status">Loading the saved design used for this comparison…</p>
      ) : latest === undefined || comparison === undefined ? null : (
        <RepositoryConformanceView
          architecture={baseline.data ?? architecture}
          mode={mode}
          onReviewAction={(action) => {
            if (latest.snapshotDigest !== undefined) {
              reviewMutation.mutate(
                {
                  action,
                  importId: latest.importId,
                  snapshotDigest: latest.snapshotDigest,
                },
                {
                  onError(error) {
                    const mapped = mapApiError(error);
                    if (mapped.sessionExpired) runtime.expireSession();
                    setNotice(mapped.message);
                  },
                },
              );
            }
          }}
          result={comparison}
          regenerationUnavailableReason="Regeneration from repository review is not available in this beta. Create an export from a saved revision instead."
        />
      )}
    </div>
  );
}
