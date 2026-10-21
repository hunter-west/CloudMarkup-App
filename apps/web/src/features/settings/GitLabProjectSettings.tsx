import "./GitLabProjectSettings.css";
import {
  gitlabProjectDiscoveryResponseV1Schema,
  gitlabProjectSelectionListResponseV1Schema,
  gitlabProjectSelectionV1Schema,
  type GitlabProjectV1,
  type GitlabProjectSelectionV1,
} from "@cloudmarkup/api-contract";
import { Button } from "@cloudmarkup/ui";
import { useInfiniteQuery, useMutation } from "@tanstack/react-query";
import {
  cloudMarkupQueryKeys,
  type CloudMarkupQueryRuntime,
} from "../../api/index.js";

class ProjectResponseError extends Error {}
const eligibilityText: Record<GitlabProjectV1["eligibility"], string> = {
  eligible: "Available",
  archived: "Archived project",
  empty: "Needs a default branch",
  "insufficient-access": "Developer access or higher required",
};
export function GitLabProjectSettings({
  organizationId,
  principalId,
  connectionId,
  canManage,
  runtime,
}: {
  readonly organizationId: string;
  readonly principalId: string;
  readonly connectionId: string;
  readonly canManage: boolean;
  readonly runtime: Pick<CloudMarkupQueryRuntime, "client" | "queryClient">;
}) {
  const path = { organizationId, connectionId };
  const key = [
    ...cloudMarkupQueryKeys.organization(principalId, organizationId),
    "gitlab-projects",
    connectionId,
  ];
  function bind(value: {
    organizationId: string;
    principalId: string;
    connectionId: string;
  }) {
    if (
      value.organizationId !== organizationId ||
      value.principalId !== principalId ||
      value.connectionId !== connectionId
    )
      throw new ProjectResponseError();
  }
  const selected = useInfiniteQuery({
    queryKey: [...key, "selected"],
    retry: false,
    initialPageParam: "",
    queryFn: async ({ pageParam }) => {
      const result = gitlabProjectSelectionListResponseV1Schema.parse(
        await runtime.client.request("gitlab-project-selections.list", {
          path,
          query: { limit: 100, ...(pageParam ? { cursor: pageParam } : {}) },
        }),
      );
      result.data.forEach(bind);
      if (
        result.data.some(
          (item, index) =>
            item.projectId <=
            (result.data[index - 1]?.projectId ?? Number(pageParam || 0)),
        ) ||
        (result.page.hasMore &&
          (!result.data.length ||
            result.page.nextCursor !==
              String(result.data.at(-1)?.projectId))) ||
        (!result.page.hasMore && result.page.nextCursor !== undefined)
      )
        throw new ProjectResponseError();
      return result;
    },
    getNextPageParam: (last) => last.page.nextCursor,
  });
  const available = useInfiniteQuery({
    queryKey: [...key, "available"],
    retry: false,
    initialPageParam: 1,
    queryFn: async ({ pageParam }) => {
      const result = gitlabProjectDiscoveryResponseV1Schema.parse(
        await runtime.client.request("gitlab-projects.discover", {
          path,
          query: { page: pageParam },
        }),
      );
      bind(result.data);
      if (
        result.data.nextPage !== null &&
        result.data.nextPage !== pageParam + 1
      )
        throw new ProjectResponseError();
      return result.data;
    },
    getNextPageParam: (last) => last.nextPage ?? undefined,
  });
  const selections = selected.isError
    ? []
    : (selected.data?.pages.flatMap((page) => page.data) ?? []);
  const discovered = available.isError
    ? []
    : (available.data?.pages.flatMap((page) => page.projects) ?? []);
  const projects = [
    ...new Map(discovered.map((item) => [item.projectId, item])).values(),
  ];
  const change = useMutation({
    retry: false,
    mutationFn: async ({
      projectId,
      enabled,
      expectedVersion,
    }: {
      projectId: number;
      enabled: boolean;
      expectedVersion: number;
    }) => {
      if (
        !canManage ||
        selected.isError ||
        !selected.data ||
        selected.hasNextPage
      )
        throw new ProjectResponseError();
      const response = await runtime.client.request(
        "gitlab-project-selections.update",
        {
          path: { ...path, projectId: String(projectId) },
          body: { contractVersion: 1, enabled, expectedVersion },
        },
      );
      const result = gitlabProjectSelectionV1Schema.parse(response.data);
      bind(result);
      if (
        result.projectId !== projectId ||
        result.enabled !== enabled ||
        result.version !== expectedVersion + 1
      )
        throw new ProjectResponseError();
      return result;
    },
    onSettled: async () => {
      await runtime.queryClient.invalidateQueries({
        queryKey: [...key, "selected"],
      });
    },
  });
  function control(projectId: number, enabled: boolean) {
    const previous = selections.find((item) => item.projectId === projectId);
    change.mutate({
      projectId,
      enabled,
      expectedVersion: previous?.version ?? 0,
    });
  }
  function name(item: GitlabProjectSelectionV1) {
    return (
      projects.find((project) => project.projectId === item.projectId)
        ?.pathWithNamespace ?? `GitLab project ${String(item.projectId)}`
    );
  }
  const canChange =
    canManage &&
    !selected.isError &&
    !!selected.data &&
    !selected.hasNextPage &&
    !selected.isFetching &&
    !change.isPending;
  return (
    <section
      aria-labelledby={`gitlab-projects-${connectionId}`}
      className="integration-settings__link-flow integration-settings__repositories gitlab-project-settings"
    >
      <h3 id={`gitlab-projects-${connectionId}`}>Selected GitLab projects</h3>
      <p>
        Choose the projects CloudMarkup may use. Selecting a project does not
        write files; every export needs a separate review.
      </p>
      {selected.isPending ? (
        <p role="status">Loading selected projects…</p>
      ) : selected.isError ? (
        <p role="alert">
          Selected projects could not be verified. Reload before making changes.
        </p>
      ) : (
        <>
          {selections.some((item) => item.enabled) ? (
            <ul className="integration-settings__connections">
              {selections
                .filter((item) => item.enabled)
                .map((item) => (
                  <li key={item.projectId}>
                    <span>{name(item)}</span>
                    {canManage ? (
                      <Button
                        disabled={!canChange}
                        aria-label={`Remove ${name(item)}`}
                        onClick={() => {
                          control(item.projectId, false);
                        }}
                      >
                        Remove
                      </Button>
                    ) : null}
                  </li>
                ))}
            </ul>
          ) : (
            <p>No projects selected.</p>
          )}
          {selected.hasNextPage ? (
            <Button
              loading={selected.isFetchingNextPage}
              onClick={() => void selected.fetchNextPage()}
            >
              Load remaining selections
            </Button>
          ) : null}
        </>
      )}
      <h4>Available projects</h4>
      <p>
        Only projects with Developer access or higher are listed. Archived or
        empty projects cannot be selected for export.
      </p>
      {available.isPending ? (
        <p role="status">Loading GitLab projects…</p>
      ) : available.isError ? (
        <p role="alert">
          GitLab projects are unavailable. Check the connection and reload.
        </p>
      ) : (
        <>
          {projects.length ? (
            <ul className="integration-settings__connections">
              {projects.map((project) => {
                const alreadySelected = selections.some(
                  (item) =>
                    item.projectId === project.projectId && item.enabled,
                );
                return (
                  <li key={project.projectId}>
                    <a
                      href={project.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {project.pathWithNamespace}
                    </a>{" "}
                    <span>
                      {alreadySelected
                        ? "Selected"
                        : eligibilityText[project.eligibility]}
                    </span>
                    {canManage && !alreadySelected ? (
                      <Button
                        disabled={
                          !canChange || project.eligibility !== "eligible"
                        }
                        aria-label={`Select ${project.pathWithNamespace}`}
                        onClick={() => {
                          control(project.projectId, true);
                        }}
                      >
                        Select project
                      </Button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p>No available projects found.</p>
          )}
          {available.hasNextPage ? (
            <Button
              loading={available.isFetchingNextPage}
              onClick={() => void available.fetchNextPage()}
            >
              Load more GitLab projects
            </Button>
          ) : null}
        </>
      )}
      <Button
        disabled={change.isPending}
        onClick={() => {
          void selected.refetch();
          void available.refetch();
        }}
      >
        Reload projects
      </Button>
      {!canManage ? (
        <p>An owner or administrator can change selected projects.</p>
      ) : null}
      {change.isError ? (
        <p role="alert">
          The selection could not be confirmed. Reload projects to check its
          current status before trying again.
        </p>
      ) : null}
      {change.isSuccess ? <p role="status">Project selection saved.</p> : null}
    </section>
  );
}
