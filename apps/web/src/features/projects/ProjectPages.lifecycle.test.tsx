import type {
  CloudMarkupClient,
  CurrentPrincipalV1,
  ProjectV1,
} from "@cloudmarkup/api-contract";
import { QueryClient } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CloudMarkupQueryProvider,
  cloudMarkupQueryKeys,
  type ExportCapabilitiesLoader,
} from "../../api/index.js";
import { RouterProvider } from "../../routing/index.js";
import { ProjectOverviewPage } from "./ProjectPages.js";

const organizationId = "org_lifecycle";
const principal: CurrentPrincipalV1 = {
  id: "principal_lifecycle",
  displayName: "Project owner",
  resourceVersion: 1,
  organizationContexts: [
    {
      organizationId,
      membershipId: "membership_lifecycle",
      role: "owner",
      isOwner: true,
      capabilities: ["projects.read", "projects.mutate", "projects.delete"],
    },
  ],
};
const project: ProjectV1 = {
  id: "project_lifecycle",
  organizationId,
  name: "Shared architecture",
  lifecycleStatus: "active",
  createdAt: "2026-09-06T00:00:00.000Z",
  updatedAt: "2026-09-06T00:00:00.000Z",
  currentDraft: { id: "draft_lifecycle", version: 1 },
  environmentCount: 0,
  version: 1,
};
const projectKey = cloudMarkupQueryKeys.project(
  principal.id,
  organizationId,
  project.id,
);
const draftKey = cloudMarkupQueryKeys.draft(
  principal.id,
  organizationId,
  project.id,
);
const listKey = cloudMarkupQueryKeys.projects(principal.id, organizationId);
const closedProject: ProjectV1 = {
  ...project,
  lifecycleStatus: "deletion-pending",
  version: 2,
};

function response(value: ProjectV1) {
  return {
    data: { apiVersion: "v1", data: value },
    metadata: {
      etag: '"project:' + value.id + ":" + String(value.version) + '"',
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function setup(
  requestWithMetadata: ReturnType<typeof vi.fn>,
  initialProject: ProjectV1 = project,
  loadExportCapabilities?: ExportCapabilitiesLoader,
) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, retryDelay: 0, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  queryClient.setQueryData(projectKey, {
    project: initialProject,
    etag: response(initialProject).metadata.etag,
  });
  queryClient.setQueryData(draftKey, {
    draft: { id: project.currentDraft.id },
  });
  queryClient.setQueryData(listKey, { data: [project] });
  window.history.replaceState(
    null,
    "",
    "/organizations/" + organizationId + "/projects/" + project.id,
  );
  const client = {
    request: vi.fn().mockRejectedValue(new Error("Unexpected request")),
    requestWithMetadata,
  } as unknown as CloudMarkupClient;
  const result = render(
    <CloudMarkupQueryProvider
      client={client}
      queryClient={queryClient}
      {...(loadExportCapabilities === undefined
        ? {}
        : { loadExportCapabilities })}
    >
      <RouterProvider>
        <ProjectOverviewPage
          organizationId={organizationId}
          principal={principal}
          projectId={project.id}
        />
      </RouterProvider>
    </CloudMarkupQueryProvider>,
  );
  return { ...result, queryClient };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("project lifecycle navigation and cache isolation", () => {
  it.each([true, false])(
    "describes only the current hosted export availability (%s)",
    async (enabled) => {
      const request = vi.fn();
      const loadExportCapabilities: ExportCapabilitiesLoader = () =>
        Promise.resolve({
          schemaVersion: 1,
          exports: enabled
            ? {
                targets: ["cloudformation"],
                workload: "infrastructure-only",
                maximumBytes: 4_194_304,
              }
            : { targets: [], workload: null, maximumBytes: 4_194_304 },
        });
      setup(request, project, loadExportCapabilities);
      expect(
        await screen.findByRole("link", { name: "Open canvas" }),
      ).toBeVisible();
      expect(
        screen.getByRole("link", { name: "Revisions and exports" }),
      ).toHaveAttribute(
        "href",
        "/organizations/" +
          organizationId +
          "/projects/" +
          project.id +
          "/revisions",
      );
      expect(request).not.toHaveBeenCalled();
      expect(
        screen.queryByText(/Hosted export generation is not enabled/u),
      ).not.toBeInTheDocument();
    },
  );
  it.each(["deleted", "deletion-pending"] as const)(
    "closes %s projects without offering edit or mutation routes",
    (lifecycleStatus) => {
      const request = vi.fn();
      setup(request, { ...project, lifecycleStatus });
      expect(
        screen.getByLabelText("Project lifecycle summary"),
      ).toHaveTextContent(lifecycleStatus);
      expect(
        screen.getByRole("link", { name: "Return to projects" }),
      ).toHaveAttribute(
        "href",
        "/organizations/" + organizationId + "/projects",
      );
      expect(
        screen.queryByRole("link", {
          name: /Open editor|Current draft|Intent review/iu,
        }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", {
          name: /Delete project|Archive project/iu,
        }),
      ).not.toBeInTheDocument();
      expect(request).not.toHaveBeenCalled();
      if (lifecycleStatus === "deletion-pending") {
        expect(
          screen.getByText(
            /Scheduled cleanup permanently removes retained project content/iu,
          ),
        ).toBeVisible();
      } else {
        expect(
          screen.queryByText(
            /Scheduled cleanup permanently removes retained project content/iu,
          ),
        ).not.toBeInTheDocument();
      }
    },
  );

  it("requires confirmation and invalidates only the deleted project's descendants", async () => {
    const confirm = vi
      .spyOn(window, "confirm")
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    const request = vi.fn().mockResolvedValue(response(closedProject));
    const { queryClient } = setup(request);
    expect(
      screen.getByText(/This closes the project and requests deletion/iu),
    ).toHaveTextContent(
      "Scheduled cleanup permanently removes retained project content.",
    );
    const siblingKey = cloudMarkupQueryKeys.draft(
      principal.id,
      organizationId,
      "project_other",
    );
    queryClient.setQueryData(siblingKey, { draft: { id: "draft_other" } });
    fireEvent.click(screen.getByRole("button", { name: "Delete project" }));
    expect(request).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Delete project" }));
    expect(
      await screen.findByRole("heading", { name: "Deletion requested" }),
    ).toBeVisible();
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(confirm).toHaveBeenCalledWith(
      `Request deletion of “${project.name}”? This closes the project and cannot be undone from this screen. Scheduled cleanup permanently removes retained project content. An audit record is retained.`,
    );
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith("projects.delete", {
      path: { projectId: project.id },
      headers: {
        "if-match": response(project).metadata.etag,
        "idempotency-key": expect.any(String) as unknown,
      },
    });
    expect(queryClient.getQueryData(projectKey)).toEqual({
      project: closedProject,
      etag: response(closedProject).metadata.etag,
    });
    expect(queryClient.getQueryData(draftKey)).toBeUndefined();
    expect(queryClient.getQueryData(siblingKey)).toEqual({
      draft: { id: "draft_other" },
    });
    expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(true);
  });

  it("does not let a delayed active-project read replace a successful tombstone", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const read = deferred<ReturnType<typeof response>>();
    const request = vi
      .fn()
      .mockImplementation((operation: string) =>
        operation === "projects.get"
          ? read.promise
          : Promise.resolve(response(closedProject)),
      );
    const { queryClient } = setup(request);
    let refetch!: Promise<void>;
    act(() => {
      refetch = queryClient.refetchQueries({
        queryKey: projectKey,
        exact: true,
      });
    });
    await waitFor(() => {
      expect(request).toHaveBeenCalledWith("projects.get", {
        path: { projectId: project.id },
      });
    });
    fireEvent.click(screen.getByRole("button", { name: "Delete project" }));
    await screen.findByRole("heading", { name: "Deletion requested" });
    await act(async () => {
      await Promise.resolve();
      read.resolve(response(project));
      await refetch;
    });
    expect(queryClient.getQueryData(projectKey)).toEqual({
      project: closedProject,
      etag: response(closedProject).metadata.etag,
    });
    expect(
      screen.queryByRole("link", { name: "Open canvas" }),
    ).not.toBeInTheDocument();
  });

  it("does not repopulate detached project caches when a delete finishes after navigation", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const mutation = deferred<ReturnType<typeof response>>();
    const { queryClient, unmount } = setup(
      vi.fn().mockReturnValue(mutation.promise),
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete project" }));
    unmount();
    queryClient.clear();
    await act(async () => {
      await Promise.resolve();
      mutation.resolve(response(closedProject));
    });
    expect(queryClient.getQueryData(projectKey)).toBeUndefined();
    expect(queryClient.getQueryData(draftKey)).toBeUndefined();
  });

  it("rejects a cross-organization mutation response without changing cached project or draft", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { queryClient } = setup(
      vi
        .fn()
        .mockResolvedValue(
          response({ ...closedProject, organizationId: "org_other" }),
        ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete project" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Project update not confirmed",
    );
    expect(queryClient.getQueryData(projectKey)).toEqual({
      project,
      etag: response(project).metadata.etag,
    });
    expect(queryClient.getQueryData(draftKey)).toEqual({
      draft: { id: project.currentDraft.id },
    });
    expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(false);
  });

  it("offers a read-only refresh after an ambiguous failure without sending another delete", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const request = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(response(closedProject));
    setup(request);
    fireEvent.click(screen.getByRole("button", { name: "Delete project" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Project update not confirmed",
    );
    expect(
      screen.queryByText("The project was not changed"),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Refresh project status" }),
    );
    await screen.findByRole("heading", { name: "Deletion requested" });
    expect(
      request.mock.calls.map(([operation]: readonly unknown[]) => operation),
    ).toEqual(["projects.delete", "projects.get"]);
  });
});
