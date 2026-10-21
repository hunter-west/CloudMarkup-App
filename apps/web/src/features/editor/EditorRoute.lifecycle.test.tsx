import {
  ApiClientError,
  type CloudMarkupClient,
  type CurrentPrincipalV1,
  type DraftArchitectureDocumentV1,
  type ProjectV1,
} from "@cloudmarkup/api-contract";
import {
  parseIntentDocument,
  getArchitectureDocumentHashes,
  parseArchitectureDocument,
  type ArchitectureDocument,
} from "@cloudmarkup/domain";
import { digestCanonicalValue } from "@cloudmarkup/schemas";
import { createSyntheticAiPreviewCandidate } from "../generation/ai-intent-preview-test-helpers.js";
import { QueryClient } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CloudMarkupQueryProvider,
  cloudMarkupQueryKeys,
} from "../../api/index.js";
import { ModePreferenceProvider } from "../../preferences/index.js";
import { loadManualNotesApiArchitectureDocument } from "../../provider-catalog/aws-editor-fixture.js";
import { awsEditorCatalog } from "../../provider-catalog/aws-editor-catalog.js";
import {
  AppLink,
  RouterProvider,
  useAppLocation,
} from "../../routing/index.js";
import { EditorRoute } from "./EditorRoute.js";
import type { AcceptRepositoryGraph } from "./repository/GitHubRepositoryWorkspace.js";
import { loadFoundationArchitectureDocument } from "./model/index.js";

// Isolate route/cache/save coordination from the separately tested canvas and
// domain command engine. This leaf simulates their onDocumentChange boundary.
vi.mock("./session/index.js", async () => {
  const { createContext, useContext, useState } = await import("react");
  const Context = createContext<ArchitectureDocument | null>(null);
  return {
    EditorSessionProvider: ({
      children,
      document,
      onDocumentChange,
    }: {
      children: ReactNode;
      document: ArchitectureDocument;
      onDocumentChange?: (value: ArchitectureDocument) => void;
    }) => {
      const [current, setCurrent] = useState(document);
      return (
        <Context.Provider value={current}>
          <output aria-label="Mounted architecture">
            {current.documentId}
          </output>
          <output aria-label="Mounted node label">
            {current.nodes[0]?.presentation.label}
          </output>
          <output aria-label="Mounted document">
            {JSON.stringify(current)}
          </output>
          <button
            type="button"
            onClick={() => {
              const next = parseArchitectureDocument({
                ...current,
                nodes: current.nodes.map((node, index) =>
                  index === 0
                    ? {
                        ...node,
                        presentation: {
                          ...node.presentation,
                          label: "Edited node",
                        },
                      }
                    : node,
                ),
              });
              setCurrent(next);
              onDocumentChange?.(next);
            }}
          >
            Simulate document change
          </button>
          {children}
        </Context.Provider>
      );
    },
    useEditorDocumentSession: () => ({
      status: "ready",
      document: useContext(Context),
    }),
  };
});
vi.mock("../../shell/AppShell.js", () => ({
  AppShell: ({
    children,
    workspace,
  }: {
    children: ReactNode;
    workspace?: {
      header?: ReactNode;
      bottom?: (tab: string, change: (tab: string) => void) => ReactNode;
    };
  }) => (
    <>
      {workspace?.header}
      {workspace?.bottom?.("repository", () => undefined)}
      {children}
    </>
  ),
}));
vi.mock("./EditorWorkspace.js", () => ({
  EditorMain: () => null,
  CatalogPanel: () => null,
  InspectorPanel: () => null,
  BottomWorkspacePanel: ({
    repositoryWorkspace,
  }: {
    repositoryWorkspace?: ReactNode;
  }) => repositoryWorkspace,
}));
vi.mock("./productivity/EditorProductivityTools.js", () => ({
  EditorProductivityTools: () => null,
}));

vi.mock("./repository/GitHubRepositoryWorkspace.js", async () => {
  const { useState } = await import("react");
  return {
    GitHubRepositoryWorkspace: ({
      onAcceptIntoDesign,
      firstRevisionAction,
    }: {
      onAcceptIntoDesign?: AcceptRepositoryGraph;
      firstRevisionAction?: (onStarted: () => void) => ReactNode;
    }) => {
      const [error, setError] = useState("");
      return (
        <>
          <button
            type="button"
            onClick={() => {
              setError("");
              void onAcceptIntoDesign?.({
                importId: "githubimport_synthetic",
                idempotencyKey: "synthetic-import-accept",
                input: {
                  contractVersion: 1,
                  decision: "accept-into-design",
                  expectedSnapshotDigest: "sha256:" + "a".repeat(64),
                  operationId: "reconcile.synthetic",
                },
              }).catch((cause: unknown) => {
                setError(
                  cause instanceof Error ? cause.message : "Review failed",
                );
              });
            }}
          >
            Accept synthetic repository change
          </button>
          <output aria-label="Repository review error">{error}</output>
          {new URLSearchParams(window.location.search).get("tool") === "import"
            ? firstRevisionAction?.(() => undefined)
            : null}
        </>
      );
    },
  };
});

const organizationId = "org_editor_lifecycle";
const projectListPath = "/organizations/" + organizationId + "/projects";
const principal: CurrentPrincipalV1 = {
  id: "principal_editor_lifecycle",
  displayName: "Editor owner",
  resourceVersion: 1,
  organizationContexts: [
    {
      organizationId,
      membershipId: "membership_editor_lifecycle",
      role: "owner",
      isOwner: true,
      capabilities: [
        "projects.read",
        "projects.mutate",
        "integrations.read",
        "revisions.create",
      ],
    },
  ],
};
function project(
  id: string,
  lifecycleStatus: ProjectV1["lifecycleStatus"] = "active",
): ProjectV1 {
  return {
    id,
    organizationId,
    name: id,
    lifecycleStatus,
    createdAt: "2026-09-06T00:00:00.000Z",
    updatedAt: "2026-09-06T00:00:00.000Z",
    currentDraft: { id: "draft_" + id, version: 1 },
    environmentCount: 0,
    version: 1,
  };
}
function draft(
  projectId: string,
  version = 1,
  document?: ArchitectureDocument,
): DraftArchitectureDocumentV1 {
  const fixture = loadFoundationArchitectureDocument();
  const documentId = "document_" + projectId;
  const architectureDocument =
    document ??
    parseArchitectureDocument({
      ...fixture,
      documentId,
      applicationContracts: { ...fixture.applicationContracts, documentId },
      externalResources: { ...fixture.externalResources, documentId },
    });
  return {
    architectureDocument,
    contentDigest:
      getArchitectureDocumentHashes(architectureDocument).contentHash,
    id: "draft_" + projectId,
    projectId,
    updatedAt: "2026-09-06T00:00:00.000Z",
    version,
  };
}
function head(value: DraftArchitectureDocumentV1) {
  return {
    draft: value,
    etag: '"draft:' + value.id + ":" + String(value.version) + '"',
  };
}
function response(value: DraftArchitectureDocumentV1) {
  return {
    data: { apiVersion: "v1", data: value },
    metadata: { etag: head(value).etag },
  };
}
function draftKey(id: string) {
  return cloudMarkupQueryKeys.draft(principal.id, organizationId, id);
}
function projectKey(id: string) {
  return cloudMarkupQueryKeys.project(principal.id, organizationId, id);
}
function editorPath(id: string) {
  return projectListPath + "/" + id + "/editor";
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function Workspace() {
  const location = useAppLocation();
  const projectId = location.pathname.split("/")[4] ?? "project_a";
  return (
    <>
      <AppLink to={editorPath("project_a")}>Switch to project A</AppLink>
      <AppLink to={editorPath("project_b")}>Switch to project B</AppLink>
      {location.pathname === projectListPath ? (
        <h1>Projects list</h1>
      ) : (
        <EditorRoute
          organizationId={organizationId}
          principal={principal}
          projectId={projectId}
          shellIdentity={{
            kind: "verified",
            actorId: principal.id,
            displayName: principal.displayName,
            organization: { id: organizationId, name: "Shared workspace" },
          }}
        />
      )}
    </>
  );
}
type MetadataRequest = (operation: string, input: unknown) => Promise<unknown>;
type LeaseRequest = (
  operation: string,
  input: { path: { projectId: string } },
) => Promise<unknown>;
type DraftRead = (input: {
  path: { projectId: string };
}) => Promise<ReturnType<typeof response>>;

function setup(
  requestWithMetadata: ReturnType<typeof vi.fn<MetadataRequest>> = vi
    .fn<MetadataRequest>()
    .mockRejectedValue(new Error("Unexpected metadata request")),
  lifecycleStatus: ProjectV1["lifecycleStatus"] = "active",
  readDraft: ReturnType<typeof vi.fn<DraftRead>> = vi
    .fn<DraftRead>()
    .mockImplementation((input: { path: { projectId: string } }) =>
      Promise.resolve(response(draft(input.path.projectId))),
    ),
  selection?: {
    readonly search: string;
    readonly request: ReturnType<typeof vi.fn<MetadataRequest>>;
  },
) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  for (const id of ["project_a", "project_b"]) {
    queryClient.setQueryData(projectKey(id), {
      project: project(id, lifecycleStatus),
      etag: '"project:' + id + ':1"',
    });
    queryClient.setQueryData(draftKey(id), head(draft(id)));
  }
  const leaseRequest = vi
    .fn<LeaseRequest>()
    .mockImplementation(
      (operation: string, input: { path: { projectId: string } }) =>
        Promise.resolve({
          data: {
            contractVersion: 1,
            projectId: input.path.projectId,
            ...(operation.endsWith("release")
              ? { state: "available" }
              : {
                  state: "owned",
                  leaseId: "projectlease_00000000-0000-4000-8000-000000000001",
                  expiresAt: new Date(Date.now() + 60_000).toISOString(),
                }),
          },
        }),
    );
  const request =
    selection?.request ??
    vi.fn<MetadataRequest>().mockRejectedValue(new Error("Unexpected request"));
  const client = {
    request: (operation: string, input: { path: { projectId: string } }) =>
      operation.startsWith("project-editing-leases.")
        ? leaseRequest(operation, input)
        : request(operation, input),
    requestWithMetadata: (
      operation: string,
      input: { path: { projectId: string } },
    ) =>
      operation === "drafts.get"
        ? readDraft(input)
        : requestWithMetadata(operation, input),
  } as unknown as CloudMarkupClient;
  window.history.replaceState(
    null,
    "",
    editorPath("project_a") + (selection?.search ?? ""),
  );
  const result = render(
    <ModePreferenceProvider actorId={principal.id} storage={null}>
      <CloudMarkupQueryProvider client={client} queryClient={queryClient}>
        <RouterProvider>
          <Workspace />
        </RouterProvider>
      </CloudMarkupQueryProvider>
    </ModePreferenceProvider>,
  );
  return {
    ...result,
    queryClient,
    request,
    requestWithMetadata,
    readDraft,
    leaseRequest,
  };
}
function openSaveDetails() {
  fireEvent.click(
    screen.getByRole("button", { name: "Open save and recovery status" }),
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("one active project editor per workspace", () => {
  it("opens an older AWS project without writing on read, then saves and reloads with the current catalog", async () => {
    const document = parseArchitectureDocument({
      ...loadManualNotesApiArchitectureDocument(),
      catalog: {
        id: "aws.cloudmarkup.notes-api-catalog",
        version: "0.16.0",
        digest:
          "sha256:b8ae0f69d0fceae28e631e9036b745d2e8988967daee0a0b217e0da392d704d6",
      },
    });
    const oldDraft = draft("project_a", 1, document);
    const before = structuredClone(oldDraft);
    const readDraft = vi.fn<DraftRead>().mockResolvedValue(response(oldDraft));
    let saved = oldDraft;
    const save = vi
      .fn<MetadataRequest>()
      .mockImplementation((operation, input) => {
        expect(operation).toBe("drafts.save");
        const request = input as {
          body: { architectureDocument: unknown };
          headers: { "if-match": string };
        };
        expect(request.headers["if-match"]).toBe(head(oldDraft).etag);
        saved = draft(
          "project_a",
          2,
          parseArchitectureDocument(request.body.architectureDocument),
        );
        return Promise.resolve(response(saved));
      });
    const f = setup(save, "active", readDraft);
    await screen.findByLabelText("Mounted architecture");
    expect(
      JSON.parse(
        screen.getByLabelText("Mounted document").textContent,
      ) as unknown,
    ).toEqual({ ...document, catalog: awsEditorCatalog.identity });
    expect(oldDraft).toEqual(before);
    expect(f.requestWithMetadata).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Simulate document change" }),
    );
    await waitFor(() => {
      expect(save).toHaveBeenCalledOnce();
    });
    const written = parseArchitectureDocument(saved.architectureDocument);
    expect(written.catalog).toEqual(awsEditorCatalog.identity);
    expect(written.edges).toEqual(document.edges);
    expect(written.nodes.map((node) => node.semantic)).toEqual(
      document.nodes.map((node) => node.semantic),
    );
    f.unmount();
    setup(
      undefined,
      "active",
      vi.fn<DraftRead>().mockResolvedValue(response(saved)),
    );
    await screen.findByLabelText("Mounted architecture");
    expect(
      JSON.parse(
        screen.getByLabelText("Mounted document").textContent,
      ) as unknown,
    ).toEqual(written);
  });

  it("opens incompatible saved content for recovery with exact issue paths and no writes", async () => {
    const baseline = loadManualNotesApiArchitectureDocument();
    const document = parseArchitectureDocument({
      ...baseline,
      catalog: {
        ...baseline.catalog,
        version: "0.16.0",
        digest: "sha256:" + "a".repeat(64),
      },
      nodes: baseline.nodes.map((node, index) =>
        index === 0
          ? {
              ...node,
              semantic: {
                ...node.semantic,
                configuration: {
                  ...node.semantic.configuration,
                  values: {
                    ...node.semantic.configuration.values,
                    futureSetting: { kind: "string", value: "keep-me" },
                  },
                },
              },
            }
          : node,
      ),
    });
    const original = draft("project_a", 1, document);
    const before = structuredClone(original);
    const f = setup(
      undefined,
      "active",
      vi.fn<DraftRead>().mockResolvedValue(response(original)),
    );
    expect(
      await screen.findByRole("heading", {
        name: "Review this project's catalog compatibility",
      }),
    ).toBeVisible();
    expect(
      screen.getByText(
        "$.nodes[0].semantic.configuration.values.futureSetting",
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Download original project" }),
    ).toBeEnabled();
    expect(
      screen.queryByRole("button", {
        name: "Apply reviewed catalog adaptation",
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Mounted architecture"),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Saved resources and connections"));
    for (const element of screen.getAllByText(
      new RegExp(
        document.nodes[0]?.presentation.label ?? "missing fixture",
        "u",
      ),
    ))
      expect(element).toBeVisible();
    expect(original).toEqual(before);
    expect(f.requestWithMetadata).not.toHaveBeenCalled();
  });

  it("requires a deliberate schema adaptation before mounting or saving the candidate", async () => {
    const baseline = loadManualNotesApiArchitectureDocument();
    const original = parseArchitectureDocument({
      ...baseline,
      catalog: {
        ...baseline.catalog,
        version: "0.16.0",
        digest: "sha256:" + "a".repeat(64),
      },
      nodes: baseline.nodes.map((node, index) =>
        index === 0
          ? {
              ...node,
              semantic: {
                ...node.semantic,
                configuration: {
                  ...node.semantic.configuration,
                  schemaVersion: "0.9.0",
                },
              },
            }
          : node,
      ),
    });
    let saved: ArchitectureDocument | undefined;
    const save = vi
      .fn<MetadataRequest>()
      .mockImplementation((operation, input) => {
        expect(operation).toBe("drafts.save");
        saved = parseArchitectureDocument(
          (input as { body: { architectureDocument: unknown } }).body
            .architectureDocument,
        );
        return Promise.resolve(response(draft("project_a", 2, saved)));
      });
    setup(
      save,
      "active",
      vi
        .fn<DraftRead>()
        .mockResolvedValue(response(draft("project_a", 1, original))),
    );
    const apply = await screen.findByRole("button", {
      name: "Apply reviewed catalog adaptation",
    });
    expect(
      screen.queryByLabelText("Mounted architecture"),
    ).not.toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(apply);
    await screen.findByLabelText("Mounted architecture");
    await waitFor(() => {
      expect(save).toHaveBeenCalledOnce();
    });
    expect(saved?.catalog).toEqual(awsEditorCatalog.identity);
    expect(saved?.nodes[0]?.semantic.configuration).toEqual(
      baseline.nodes[0]?.semantic.configuration,
    );
    expect(saved?.edges).toEqual(original.edges);
    expect(original.nodes[0]?.semantic.configuration.schemaVersion).toBe(
      "0.9.0",
    );
  });

  it("replaces loading with an accurate last-observed reservation notice and a read-only title", async () => {
    const f = setup();
    const lastObservedExpiresAt = new Date(Date.now() - 60_000).toISOString();
    let release: (value: unknown) => void = () => undefined;
    f.leaseRequest.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    await waitFor(() => {
      expect(f.leaseRequest).toHaveBeenCalled();
    });
    expect(screen.getByRole("status")).toHaveTextContent("Loading project");
    expect(document.title).toBe("Loading project");
    expect(screen.queryByText("Read-only project")).not.toBeInTheDocument();
    act(() => {
      release({
        data: {
          contractVersion: 1,
          projectId: "project_a",
          state: "held",
          expiresAt: lastObservedExpiresAt,
        },
      });
    });
    expect(await screen.findByText("Read-only project")).toBeVisible();
    expect(
      screen.getByText(/Editing access was reserved when last checked/u),
    ).toBeVisible();
    expect(
      screen.queryByText(/Another session is editing/u),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/then choose Try editing/u)).toBeVisible();
    const expiry = screen.getByText(/Last observed reservation expiry/u);
    const formattedExpiry = new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "long",
    }).format(new Date(lastObservedExpiresAt));
    expect(within(expiry).getByText(formattedExpiry)).toHaveAttribute(
      "datetime",
      lastObservedExpiresAt,
    );
    expect(screen.getByRole("button", { name: "Try editing" })).toBeEnabled();
    expect(f.leaseRequest).toHaveBeenCalledOnce();
    expect(
      screen.queryByLabelText("Mounted architecture"),
    ).not.toBeInTheDocument();
    await waitFor(() => {
      expect(document.title).toBe("project_a · Read-only project");
    });
  });
  it("checks editing access on explicit retry and mounts only the freshly read server head", async () => {
    const f = setup();
    f.leaseRequest.mockResolvedValueOnce({
      data: {
        contractVersion: 1,
        projectId: "project_a",
        state: "held",
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
      },
    });
    expect(await screen.findByText("Read-only project")).toBeVisible();
    expect(f.readDraft).toHaveBeenCalledOnce();
    const initialDocument = parseArchitectureDocument(
      draft("project_a").architectureDocument,
    );
    const freshDocument = parseArchitectureDocument({
      ...initialDocument,
      nodes: initialDocument.nodes.map((node, index) =>
        index === 0
          ? {
              ...node,
              presentation: {
                ...node.presentation,
                label: "Fresh server node",
              },
            }
          : node,
      ),
    });
    f.readDraft.mockResolvedValueOnce(
      response(draft("project_a", 4, freshDocument)),
    );
    fireEvent.click(screen.getByRole("button", { name: "Try editing" }));
    await waitFor(() => {
      expect(screen.getByLabelText("Mounted node label")).toHaveTextContent(
        "Fresh server node",
      );
    });
    expect(f.leaseRequest.mock.calls.map(([operation]) => operation)).toEqual([
      "project-editing-leases.acquire",
      "project-editing-leases.acquire",
    ]);
    expect(f.readDraft).toHaveBeenCalledTimes(2);
    expect(f.requestWithMetadata).not.toHaveBeenCalled();
    expect(screen.queryByText("Read-only project")).not.toBeInTheDocument();
  });
  it("mounts only the selected project's cached architecture when switching directly", async () => {
    const { requestWithMetadata, readDraft } = setup();
    expect(
      await screen.findByLabelText("Mounted architecture"),
    ).toHaveTextContent("document_project_a");
    fireEvent.click(screen.getByRole("link", { name: "Switch to project B" }));
    expect(
      await screen.findByLabelText("Mounted architecture"),
    ).toHaveTextContent("document_project_b");
    expect(screen.getAllByLabelText("Mounted architecture")).toHaveLength(1);
    fireEvent.click(screen.getByRole("link", { name: "Switch to project A" }));
    expect(
      await screen.findByLabelText("Mounted architecture"),
    ).toHaveTextContent("document_project_a");
    expect(requestWithMetadata).not.toHaveBeenCalled();
    expect(readDraft.mock.calls.map(([input]) => input.path.projectId)).toEqual(
      [
        "project_a",
        "project_a",
        "project_b",
        "project_b",
        "project_a",
        "project_a",
      ],
    );
  });

  it.each(["deleted", "deletion-pending"] as const)(
    "does not mount a cached editor or load a draft for a %s project",
    (status) => {
      const { requestWithMetadata, readDraft } = setup(undefined, status);
      expect(screen.getByRole("status")).toHaveTextContent("Project closed");
      expect(
        screen.queryByLabelText("Mounted architecture"),
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole("link", { name: "Return to projects" }),
      ).toHaveAttribute("href", projectListPath);
      expect(requestWithMetadata).not.toHaveBeenCalled();
      expect(readDraft).not.toHaveBeenCalled();
    },
  );

  it("renders a metadata read error instead of waiting forever for its disabled draft query", async () => {
    const request = vi.fn().mockRejectedValue(new Error("Project unavailable"));
    const { queryClient } = setup(request);
    await act(async () => {
      await Promise.resolve();
      queryClient.removeQueries({ queryKey: projectKey("project_b") });
      queryClient.removeQueries({ queryKey: draftKey("project_b") });
      fireEvent.click(
        screen.getByRole("link", { name: "Switch to project B" }),
      );
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The project draft could not be loaded",
    );
    expect(
      request.mock.calls.map(([operation]: readonly unknown[]) => operation),
    ).toEqual(["projects.get"]);
  });

  it("closes an already saved project without creating a redundant save", async () => {
    const { requestWithMetadata } = setup();
    await screen.findByLabelText("Mounted architecture");
    openSaveDetails();
    expect(screen.getByText(/releases editing access/u)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Close project" }));
    expect(
      await screen.findByRole("heading", { name: "Projects list" }),
    ).toBeVisible();
    expect(requestWithMetadata).not.toHaveBeenCalled();
  });

  it("waits for the exact pending draft save before returning to Projects", async () => {
    const pending = deferred<ReturnType<typeof response>>();
    const request = vi.fn().mockReturnValue(pending.promise);
    setup(request);
    await screen.findByLabelText("Mounted architecture");
    fireEvent.click(
      screen.getByRole("button", { name: "Simulate document change" }),
    );
    openSaveDetails();
    fireEvent.click(screen.getByRole("button", { name: "Close project" }));
    await waitFor(() => {
      expect(request).toHaveBeenCalledTimes(1);
    });
    expect(window.location.pathname).toBe(editorPath("project_a"));
    expect(
      screen.getByRole("button", { name: "Saving and closing…" }),
    ).toBeDisabled();
    expect(request).toHaveBeenCalledWith("drafts.save", {
      body: {
        architectureDocument: expect.any(Object) as unknown,
        contractVersion: 1,
        editingLease: {
          leaseId: "projectlease_00000000-0000-4000-8000-000000000001",
          token: expect.any(String) as unknown,
        },
      },
      headers: { "if-match": head(draft("project_a")).etag },
      path: { projectId: "project_a" },
    });
    await act(async () => {
      await Promise.resolve();
      pending.resolve(response(draft("project_a", 2)));
    });
    expect(
      await screen.findByRole("heading", { name: "Projects list" }),
    ).toBeVisible();
  });

  it("keeps the current project open when save-before-close fails", async () => {
    const request = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const { queryClient } = setup(request);
    await screen.findByLabelText("Mounted architecture");
    fireEvent.click(
      screen.getByRole("button", { name: "Simulate document change" }),
    );
    openSaveDetails();
    fireEvent.click(screen.getByRole("button", { name: "Close project" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Retry save" })).toBeEnabled(),
    );
    expect(window.location.pathname).toBe(editorPath("project_a"));
    expect(screen.getByLabelText("Mounted architecture")).toHaveTextContent(
      "document_project_a",
    );
    expect(queryClient.getQueryData(draftKey("project_a"))).toEqual(
      head(draft("project_a")),
    );
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("joins an in-flight save when closing instead of queuing a duplicate document", async () => {
    const pending = deferred<ReturnType<typeof response>>();
    const request = vi.fn().mockReturnValue(pending.promise);
    setup(request);
    await screen.findByLabelText("Mounted architecture");
    fireEvent.click(
      screen.getByRole("button", { name: "Simulate document change" }),
    );
    openSaveDetails();
    fireEvent.click(screen.getByRole("button", { name: "Save now" }));
    await waitFor(() => {
      expect(request).toHaveBeenCalledTimes(1);
    });
    fireEvent.click(screen.getByRole("button", { name: "Close project" }));
    await act(async () => {
      await Promise.resolve();
      pending.resolve(response(draft("project_a", 2)));
    });
    expect(
      await screen.findByRole("heading", { name: "Projects list" }),
    ).toBeVisible();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it.each(["success", "failure"] as const)(
    "ignores a previous editor's in-flight save %s after switching to another cached project",
    async (outcome) => {
      const pending = deferred<ReturnType<typeof response>>();
      const request = vi.fn().mockReturnValue(pending.promise);
      const { queryClient } = setup(request);
      await screen.findByLabelText("Mounted architecture");
      fireEvent.click(
        screen.getByRole("button", { name: "Simulate document change" }),
      );
      openSaveDetails();
      fireEvent.click(screen.getByRole("button", { name: "Save now" }));
      await waitFor(() => {
        expect(request).toHaveBeenCalledTimes(1);
      });
      fireEvent.click(
        screen.getByRole("link", { name: "Switch to project B" }),
      );
      expect(
        await screen.findByLabelText("Mounted architecture"),
      ).toHaveTextContent("document_project_b");
      expect(
        queryClient.getQueryState(draftKey("project_a"))?.isInvalidated,
      ).toBe(true);
      queryClient.setQueryData(draftKey("project_a"), head(draft("project_a")));
      await act(async () => {
        await Promise.resolve();
        if (outcome === "success")
          pending.resolve(response(draft("project_a", 2)));
        else pending.reject(new TypeError("Failed to fetch"));
      });
      expect(
        queryClient.getQueryState(draftKey("project_a"))?.isInvalidated,
      ).toBe(true);
      expect(queryClient.getQueryData(draftKey("project_a"))).toEqual(
        head(draft("project_a")),
      );
      expect(queryClient.getQueryData(draftKey("project_b"))).toEqual(
        head(draft("project_b")),
      );
      expect(window.location.pathname).toBe(editorPath("project_b"));
      expect(
        screen.queryByRole("button", { name: "Retry save" }),
      ).not.toBeInTheDocument();
      expect(request).toHaveBeenCalledTimes(1);
    },
  );

  it("does not resurrect an evicted draft cache after a detached successful save", async () => {
    const pending = deferred<ReturnType<typeof response>>();
    const request = vi.fn().mockReturnValue(pending.promise);
    const { queryClient, unmount } = setup(request);
    await screen.findByLabelText("Mounted architecture");
    fireEvent.click(
      screen.getByRole("button", { name: "Simulate document change" }),
    );
    openSaveDetails();
    fireEvent.click(screen.getByRole("button", { name: "Save now" }));
    await waitFor(() => {
      expect(request).toHaveBeenCalledTimes(1);
    });
    unmount();
    queryClient.removeQueries({ queryKey: draftKey("project_a") });
    await act(async () => {
      await Promise.resolve();
      pending.resolve(response(draft("project_a", 2)));
    });
    expect(queryClient.getQueryData(draftKey("project_a"))).toBeUndefined();
    expect(queryClient.getQueryData(draftKey("project_b"))).toEqual(
      head(draft("project_b")),
    );
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("waits for a fresh head when reopening a cached project instead of claiming its old version is saved", async () => {
    const pending = deferred<ReturnType<typeof response>>();
    const readDraft = vi
      .fn()
      .mockResolvedValueOnce(response(draft("project_a")))
      .mockResolvedValueOnce(response(draft("project_a")))
      .mockResolvedValueOnce(response(draft("project_b")))
      .mockResolvedValueOnce(response(draft("project_b")))
      .mockReturnValue(pending.promise);
    const { queryClient } = setup(undefined, "active", readDraft);
    await screen.findByLabelText("Mounted architecture");
    fireEvent.click(screen.getByRole("link", { name: "Switch to project B" }));
    await screen.findByLabelText("Mounted architecture");
    fireEvent.click(screen.getByRole("link", { name: "Switch to project A" }));
    expect(
      screen.queryByLabelText("Mounted architecture"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Open save and recovery status" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Loading");
    expect(queryClient.getQueryData(draftKey("project_a"))).toEqual(
      head(draft("project_a")),
    );
    await act(async () => {
      await Promise.resolve();
      pending.resolve(response(draft("project_a", 3)));
    });
    expect(
      await screen.findByLabelText("Mounted architecture"),
    ).toHaveTextContent("document_project_a");
    expect(
      screen.getByText("Saved · server draft version 3"),
    ).toBeInTheDocument();
    expect(readDraft).toHaveBeenCalledTimes(6);
  });

  it("keeps a cached draft closed when fresh mount validation fails", async () => {
    const readDraft = vi
      .fn()
      .mockRejectedValue(new Error("Draft access unavailable"));
    setup(undefined, "active", readDraft);
    expect(
      screen.queryByLabelText("Mounted architecture"),
    ).not.toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The project draft could not be loaded",
    );
    expect(
      screen.queryByRole("button", { name: "Open save and recovery status" }),
    ).not.toBeInTheDocument();
    expect(readDraft).toHaveBeenCalledTimes(2);
  });
  it("marks a last-moment edit unsaved even before the expired lease callback renders", async () => {
    const request = vi
      .fn<MetadataRequest>()
      .mockResolvedValue(response(draft("project_a", 2)));
    setup(request);
    await screen.findByLabelText("Mounted architecture");
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 60_001);
    fireEvent.click(
      screen.getByRole("button", { name: "Simulate document change" }),
    );
    openSaveDetails();
    expect(
      screen.getByText("Unsaved changes", { exact: true }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save now" }));
    expect(request).not.toHaveBeenCalled();
    fireEvent.focus(window);
    await screen.findByRole("region", { name: "Paused local recovery" });
    clock.mockRestore();
    fireEvent.click(screen.getByRole("button", { name: "Try editing" }));
    await screen.findByRole("button", {
      name: "Open save and recovery status",
    });
    openSaveDetails();
    expect(
      screen.getByText("Unsaved changes", { exact: true }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close project" }));
    await screen.findByRole("heading", { name: "Projects list" });
    expect(request).toHaveBeenCalledOnce();
  });
  it("does not let a late old-lease authentication failure block a new lease or acknowledge unsaved work", async () => {
    const oldSave = deferred<ReturnType<typeof response>>();
    const request = vi
      .fn<MetadataRequest>()
      .mockReturnValueOnce(oldSave.promise)
      .mockResolvedValue(response(draft("project_a", 2)));
    const f = setup(request);
    await screen.findByLabelText("Mounted architecture");
    fireEvent.click(
      screen.getByRole("button", { name: "Simulate document change" }),
    );
    openSaveDetails();
    fireEvent.click(screen.getByRole("button", { name: "Save now" }));
    await waitFor(() => {
      expect(request).toHaveBeenCalledOnce();
    });
    const currentTime = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(currentTime + 60_001);
    fireEvent.focus(window);
    await screen.findByRole("region", { name: "Paused local recovery" });
    clock.mockRestore();
    f.leaseRequest.mockImplementation(
      (operation: string, input: { path: { projectId: string } }) =>
        Promise.resolve({
          data: {
            contractVersion: 1,
            projectId: input.path.projectId,
            ...(operation.endsWith("release")
              ? { state: "available" }
              : {
                  state: "owned",
                  leaseId: "projectlease_00000000-0000-4000-8000-000000000002",
                  expiresAt: new Date(Date.now() + 60_000).toISOString(),
                }),
          },
        }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Try editing" }));
    await screen.findByRole("button", {
      name: "Open save and recovery status",
    });
    await act(async () => {
      oldSave.reject(
        new ApiClientError(401, {
          apiVersion: "v1",
          error: {
            code: "authentication_required",
            message: "Old session expired.",
            correlationId: "correlation_old_lease",
          },
        }),
      );
      await Promise.resolve();
    });
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    expect(screen.queryByText(/Your session expired/u)).not.toBeInTheDocument();
    expect(f.queryClient.getQueryData(draftKey("project_a"))).toEqual(
      head(draft("project_a")),
    );
    openSaveDetails();
    fireEvent.click(screen.getByRole("button", { name: "Save now" }));
    await screen.findAllByText("Saved · server draft version 2");
    expect(request).toHaveBeenCalledTimes(2);
  });
});

function acceptedReview() {
  return {
    apiVersion: "v1",
    data: {
      decision: "accept-into-design",
      designChanged: true,
      importId: "githubimport_synthetic",
      operationId: "reconcile.synthetic",
      receiptId: "repository-command.synthetic",
      reviewedAt: "2026-09-09T12:00:00.000Z",
      snapshotDigest: "sha256:" + "a".repeat(64),
    },
  };
}
function importedDraft(version = 2) {
  const baseline = parseArchitectureDocument(
    draft("project_a").architectureDocument,
  );
  return draft(
    "project_a",
    version,
    parseArchitectureDocument({
      ...baseline,
      nodes: baseline.nodes.map((node, index) =>
        index === 0
          ? {
              ...node,
              presentation: {
                ...node.presentation,
                label: "Accepted import node",
              },
            }
          : node,
      ),
    }),
  );
}
async function readyImportEditor() {
  await screen.findByRole("button", {
    name: "Accept synthetic repository change",
  });
}
function acceptImport() {
  fireEvent.click(
    screen.getByRole("button", { name: "Accept synthetic repository change" }),
  );
}

describe("saved editor repository acceptance", () => {
  it("drains the pending save before binding the import to its latest ETag and remounting the accepted draft", async () => {
    const pendingSave = deferred<ReturnType<typeof response>>();
    const save = vi.fn<MetadataRequest>().mockReturnValue(pendingSave.promise);
    const f = setup(save);
    await readyImportEditor();
    await waitFor(() => {
      expect(f.readDraft).toHaveBeenCalledTimes(2);
    });
    const review = deferred<ReturnType<typeof acceptedReview>>();
    f.request.mockReturnValue(review.promise);
    fireEvent.click(
      screen.getByRole("button", { name: "Simulate document change" }),
    );
    acceptImport();
    await waitFor(() => {
      expect(save).toHaveBeenCalledTimes(1);
    });
    expect(f.request).not.toHaveBeenCalled();
    const saved = draft("project_a", 2);
    await act(async () => {
      pendingSave.resolve(response(saved));
      await pendingSave.promise;
    });
    await waitFor(() => {
      expect(f.request).toHaveBeenCalledTimes(1);
    });
    expect(f.request).toHaveBeenCalledWith(
      "github-repository-import-reviews.create",
      expect.objectContaining({
        body: expect.objectContaining({
          draftAcceptance: {
            expectedDraftEtag: head(saved).etag,
            editingLease: {
              leaseId: "projectlease_00000000-0000-4000-8000-000000000001",
              token: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/u) as unknown,
            },
          },
        }) as unknown,
        headers: { "idempotency-key": "synthetic-import-accept" },
      }),
    );
    f.readDraft.mockResolvedValue(response(importedDraft(3)));
    await act(async () => {
      review.resolve(acceptedReview());
      await review.promise;
    });
    await waitFor(() =>
      expect(screen.getByLabelText("Mounted node label")).toHaveTextContent(
        "Accepted import node",
      ),
    );
    expect(f.queryClient.getQueryData(draftKey("project_a"))).toMatchObject({
      draft: { version: 3 },
    });
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("retries an uncertain review with the same ETag and request instead of making a new save", async () => {
    const f = setup();
    await readyImportEditor();
    await waitFor(() => {
      expect(f.readDraft).toHaveBeenCalledTimes(2);
    });
    f.request.mockRejectedValueOnce(new Error("Interrupted review response"));
    acceptImport();
    await waitFor(() =>
      expect(
        screen.getByLabelText("Repository review error"),
      ).toHaveTextContent("Interrupted review response"),
    );
    const first = f.request.mock.calls[0];
    f.request.mockResolvedValue(acceptedReview());
    f.readDraft.mockResolvedValue(response(importedDraft()));
    acceptImport();
    await waitFor(() =>
      expect(screen.getByLabelText("Mounted node label")).toHaveTextContent(
        "Accepted import node",
      ),
    );
    expect(f.request.mock.calls[1]).toEqual(first);
    expect(f.requestWithMetadata).not.toHaveBeenCalled();
  });

  it("does not overwrite a newer local edit if a delayed result arrives", async () => {
    const f = setup();
    await readyImportEditor();
    await waitFor(() => {
      expect(f.readDraft).toHaveBeenCalledTimes(2);
    });
    const review = deferred<ReturnType<typeof acceptedReview>>();
    f.request.mockReturnValue(review.promise);
    acceptImport();
    await waitFor(() => {
      expect(f.request).toHaveBeenCalledTimes(1);
    });
    // Exercise the defensive boundary even if a programmatic update bypasses inert UI.
    fireEvent.click(
      screen.getByRole("button", { name: "Simulate document change" }),
    );
    const reads = f.readDraft.mock.calls.length;
    await act(async () => {
      review.resolve(acceptedReview());
      await review.promise;
    });
    await waitFor(() =>
      expect(
        screen.getByLabelText("Repository review error"),
      ).toHaveTextContent("Editing changed while the review was running"),
    );
    expect(screen.getByLabelText("Mounted node label")).toHaveTextContent(
      "Edited node",
    );
    expect(f.readDraft).toHaveBeenCalledTimes(reads);
    expect(f.requestWithMetadata).not.toHaveBeenCalled();
  });

  it("does not apply a delayed review to another project after navigation", async () => {
    const f = setup();
    await readyImportEditor();
    await waitFor(() => {
      expect(f.readDraft).toHaveBeenCalledTimes(2);
    });
    const review = deferred<ReturnType<typeof acceptedReview>>();
    f.request.mockReturnValue(review.promise);
    acceptImport();
    await waitFor(() => {
      expect(f.request).toHaveBeenCalledTimes(1);
    });
    fireEvent.click(screen.getByRole("link", { name: "Switch to project B" }));
    await waitFor(() =>
      expect(screen.getByLabelText("Mounted architecture")).toHaveTextContent(
        "document_project_b",
      ),
    );
    await act(async () => {
      review.resolve(acceptedReview());
      await review.promise;
    });
    expect(screen.getByLabelText("Mounted architecture")).toHaveTextContent(
      "document_project_b",
    );
    expect(f.queryClient.getQueryData(draftKey("project_b"))).toMatchObject({
      draft: { version: 1 },
    });
  });
});

function acceptedRequirements() {
  const candidate = createSyntheticAiPreviewCandidate(
    "preview_revision_synthetic",
  ).candidate;
  const intentDocument = parseIntentDocument(candidate.intentDocument);
  return {
    contractVersion: 1,
    acceptedIntentId: "accepted_intent_" + "a".repeat(48),
    projectId: "project_a",
    createdAt: "2026-09-11T12:00:00.000Z",
    createdByPrincipalId: principal.id,
    sourceDraftId: "draft_project_a",
    sourceDraftVersion: 1,
    invocationId: candidate.provenance.invocationId,
    outputDigest: digestCanonicalValue(candidate),
    intentDigest: digestCanonicalValue(intentDocument),
    intentDocument,
  };
}
describe("explicit requirements selection at revision creation", () => {
  it("shows the saved record and retains the exact selection, ETag and key after an uncertain create", async () => {
    const record = acceptedRequirements();
    const request = vi
      .fn<MetadataRequest>()
      .mockImplementation((operation) =>
        operation === "accepted-intents.get"
          ? Promise.resolve({ data: record })
          : Promise.reject(Error("Interrupted response")),
      );
    const f = setup(
      vi
        .fn<MetadataRequest>()
        .mockResolvedValue(response(draft("project_a", 2))),
      "active",
      undefined,
      {
        search: "?acceptedIntent=" + record.acceptedIntentId,
        request,
      },
    );
    expect(
      await screen.findByRole("region", { name: "Selected requirements" }),
    ).toHaveTextContent(record.intentDocument.application.summary);
    expect(
      screen.getByRole("link", { name: "Review selected requirements" }),
    ).toHaveAttribute(
      "href",
      projectListPath +
        "/project_a/intent?acceptedIntent=" +
        record.acceptedIntentId,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Create Solution Revision" }),
    );
    await screen.findByRole("heading", {
      name: "Solution Revision was not created",
    });
    const first = request.mock.calls.find(
      ([operation]) => operation === "solution-revisions.create",
    );
    expect(first).toEqual([
      "solution-revisions.create",
      {
        body: {
          contractVersion: 1,
          draftId: "draft_project_a",
          draftVersion: 2,
          name: "Solution revision 2",
          acceptedIntentId: record.acceptedIntentId,
        },
        headers: {
          "idempotency-key": expect.any(String) as unknown,
          "if-match": '"draft:draft_project_a:2"',
        },
        path: { projectId: "project_a" },
      },
    ]);
    fireEvent.click(
      screen.getByRole("button", { name: "Create Solution Revision" }),
    );
    await waitFor(() => {
      expect(
        request.mock.calls.filter(
          ([operation]) => operation === "solution-revisions.create",
        ),
      ).toHaveLength(2);
    });
    expect(
      request.mock.calls.filter(
        ([operation]) => operation === "solution-revisions.create",
      )[1],
    ).toEqual(first);
    expect(
      f.queryClient
        .getQueryCache()
        .getAll()
        .some(
          (entry) =>
            entry.state.data !== undefined &&
            JSON.stringify(entry.state.data).includes(
              record.intentDocument.application.summary,
            ),
        ),
    ).toBe(false);
  });
  it("requires explicit abandonment when the visible selection changes after an uncertain request", async () => {
    const record = acceptedRequirements();
    const request = vi
      .fn<MetadataRequest>()
      .mockImplementation((operation) =>
        operation === "accepted-intents.get"
          ? Promise.resolve({ data: record })
          : Promise.reject(Error("Interrupted response")),
      );
    setup(
      vi
        .fn<MetadataRequest>()
        .mockResolvedValue(response(draft("project_a", 2))),
      "active",
      undefined,
      {
        search: "?acceptedIntent=" + record.acceptedIntentId,
        request,
      },
    );
    await screen.findByRole("region", { name: "Selected requirements" });
    fireEvent.click(
      screen.getByRole("button", { name: "Create Solution Revision" }),
    );
    await screen.findByRole("heading", {
      name: "Solution Revision was not created",
    });
    fireEvent.click(screen.getByRole("link", { name: "Switch to project A" }));
    await waitFor(() => {
      expect(
        screen.queryByRole("region", { name: "Selected requirements" }),
      ).not.toBeInTheDocument();
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Create Solution Revision" }),
    );
    await screen.findByText(
      "The requirements selection changed. Abandon the pending revision attempt before creating a new one.",
    );
    expect(
      request.mock.calls.filter(
        ([operation]) => operation === "solution-revisions.create",
      ),
    ).toHaveLength(1);
    fireEvent.click(
      screen.getByRole("button", { name: "Abandon revision retry" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Create Solution Revision" }),
    );
    await waitFor(() => {
      expect(
        request.mock.calls.filter(
          ([operation]) => operation === "solution-revisions.create",
        ),
      ).toHaveLength(2);
    });
    const attempts = request.mock.calls.filter(
      ([operation]) => operation === "solution-revisions.create",
    );
    expect(attempts[1]?.[1]).toMatchObject({
      body: { draftId: "draft_project_a" },
    });
    expect(attempts[1]?.[1]).not.toHaveProperty("body.acceptedIntentId");
    expect(attempts[1]?.[1]).not.toEqual(attempts[0]?.[1]);
  });
  it.each(["digest", "draft", "future", "duplicate", "malformed"] as const)(
    "blocks revision creation for %s requirements",
    async (change) => {
      const record = acceptedRequirements();
      const request = vi.fn<MetadataRequest>().mockResolvedValue({
        data: {
          ...record,
          ...(change === "digest"
            ? { intentDigest: "sha256:" + "0".repeat(64) }
            : {}),
          ...(change === "draft" ? { sourceDraftId: "other_draft" } : {}),
          ...(change === "future" ? { sourceDraftVersion: 2 } : {}),
        },
      });
      setup(
        vi
          .fn<MetadataRequest>()
          .mockResolvedValue(response(draft("project_a", 2))),
        "active",
        undefined,
        {
          search:
            "?acceptedIntent=" +
            (change === "malformed" ? "bad" : record.acceptedIntentId) +
            (change === "duplicate"
              ? "&acceptedIntent=" + record.acceptedIntentId
              : ""),
          request,
        },
      );
      await screen.findByText(
        "Selected requirements are unavailable. Return to the saved requirements to review the selection.",
      );
      fireEvent.click(
        screen.getByRole("button", { name: "Create Solution Revision" }),
      );
      await screen.findByRole("heading", {
        name: "Solution Revision was not created",
      });
      expect(
        request.mock.calls.filter(
          ([operation]) => operation === "solution-revisions.create",
        ),
      ).toHaveLength(0);
      if (change === "duplicate" || change === "malformed")
        expect(request).not.toHaveBeenCalled();
    },
  );
});

function firstImportRevision(saved: DraftArchitectureDocumentV1) {
  return {
    data: {
      summary: {
        projectId: saved.projectId,
        sourceDraftId: saved.id,
        sourceDraftVersion: saved.version,
        solutionRevisionId: "solution_revision_first_import",
        generationCoverage: { state: "infrastructure-only" },
      },
      revision: {
        projectId: saved.projectId,
        architectureDocument: saved.architectureDocument,
      },
      manifest: { intent: { state: "not-applicable" } },
    },
  };
}

describe("first repository import uses the existing revision save lifecycle", () => {
  it("drains unsaved edits and creates the baseline from the exact saved version while keeping Code selected", async () => {
    const pendingSave = deferred<ReturnType<typeof response>>();
    const save = vi.fn<MetadataRequest>().mockReturnValue(pendingSave.promise);
    const request = vi
      .fn<MetadataRequest>()
      .mockImplementation((operation) =>
        operation === "solution-revisions.create"
          ? Promise.resolve(firstImportRevision(draft("project_a", 2)))
          : Promise.reject(new Error("Unexpected request")),
      );
    const f = setup(save, "active", undefined, {
      search: "?tool=import",
      request,
    });
    await screen.findByRole("button", { name: "Save first revision" });
    await waitFor(() => {
      expect(f.readDraft).toHaveBeenCalledTimes(2);
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Simulate document change" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Save first revision" }),
    );
    await waitFor(() => {
      expect(save).toHaveBeenCalledOnce();
    });
    expect(
      request.mock.calls.some(
        ([operation]) => operation === "solution-revisions.create",
      ),
    ).toBe(false);
    const saved = draft("project_a", 2);
    await act(async () => {
      pendingSave.resolve(response(saved));
      await pendingSave.promise;
    });
    await waitFor(() => {
      expect(request).toHaveBeenCalledWith(
        "solution-revisions.create",
        expect.objectContaining({
          body: {
            contractVersion: 1,
            draftId: saved.id,
            draftVersion: 2,
            name: "Solution revision 2",
          },
          headers: {
            "idempotency-key": expect.any(String) as unknown,
            "if-match": head(saved).etag,
          },
          path: { projectId: "project_a" },
        }),
      );
    });
    expect(window.location.pathname + window.location.search).toBe(
      editorPath("project_a") + "?tool=import",
    );
    expect(
      request.mock.calls.some(
        ([operation]) => operation === "github-repository-imports.create",
      ),
    ).toBe(false);
  });
  it("does not create a revision after a failed draft save and permits a normal retry", async () => {
    const save = vi
      .fn<MetadataRequest>()
      .mockRejectedValueOnce(new Error("Synthetic save interruption"))
      .mockResolvedValue(response(draft("project_a", 2)));
    const request = vi
      .fn<MetadataRequest>()
      .mockImplementation((operation) =>
        operation === "solution-revisions.create"
          ? Promise.resolve(firstImportRevision(draft("project_a", 2)))
          : Promise.reject(new Error("Unexpected request")),
      );
    const f = setup(save, "active", undefined, {
      search: "?tool=import",
      request,
    });
    await screen.findByRole("button", { name: "Save first revision" });
    await waitFor(() => {
      expect(f.readDraft).toHaveBeenCalledTimes(2);
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Simulate document change" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Save first revision" }),
    );
    await waitFor(() => {
      expect(save).toHaveBeenCalledOnce();
      expect(
        screen.getByRole("button", { name: "Save first revision" }),
      ).toBeEnabled();
    });
    expect(
      request.mock.calls.some(
        ([operation]) => operation === "solution-revisions.create",
      ),
    ).toBe(false);
    fireEvent.click(
      screen.getByRole("button", { name: "Save first revision" }),
    );
    await waitFor(() => {
      expect(
        request.mock.calls.filter(
          ([operation]) => operation === "solution-revisions.create",
        ),
      ).toHaveLength(1);
    });
    expect(save).toHaveBeenCalledTimes(2);
  });
  it("reuses the exact immutable request after an uncertain first-revision response", async () => {
    const request = vi
      .fn<MetadataRequest>()
      .mockRejectedValueOnce(new Error("Interrupted revision response"))
      .mockImplementation((operation) =>
        operation === "solution-revisions.create"
          ? Promise.resolve(firstImportRevision(draft("project_a", 2)))
          : Promise.reject(new Error("Unexpected request")),
      );
    const f = setup(
      vi
        .fn<MetadataRequest>()
        .mockResolvedValue(response(draft("project_a", 2))),
      "active",
      undefined,
      {
        search: "?tool=import",
        request,
      },
    );
    await screen.findByRole("button", { name: "Save first revision" });
    await waitFor(() => {
      expect(f.readDraft).toHaveBeenCalledTimes(2);
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Save first revision" }),
    );
    await waitFor(() => {
      expect(
        request.mock.calls.filter(
          ([operation]) => operation === "solution-revisions.create",
        ),
      ).toHaveLength(1);
    });
    expect(
      await within(
        screen.getByRole("region", { name: "Import infrastructure code" }),
      ).findByRole("alert"),
    ).toHaveTextContent("The request could not be completed.");
    const first = request.mock.calls.find(
      ([operation]) => operation === "solution-revisions.create",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Save first revision" }),
    );
    await waitFor(() => {
      expect(
        request.mock.calls.filter(
          ([operation]) => operation === "solution-revisions.create",
        ),
      ).toHaveLength(2);
    });
    expect(
      request.mock.calls.filter(
        ([operation]) => operation === "solution-revisions.create",
      )[1],
    ).toEqual(first);
    expect(f.requestWithMetadata).toHaveBeenCalledOnce();
  });
  it("does not use an expired editing lease to save a first-import baseline", async () => {
    const request = vi.fn<MetadataRequest>();
    const f = setup(undefined, "active", undefined, {
      search: "?tool=import",
      request,
    });
    await screen.findByRole("button", { name: "Save first revision" });
    await waitFor(() => {
      expect(f.readDraft).toHaveBeenCalledTimes(2);
    });
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 60_001);
    fireEvent.click(
      screen.getByRole("button", { name: "Simulate document change" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Save first revision" }),
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(f.requestWithMetadata).not.toHaveBeenCalled();
    expect(
      request.mock.calls.some(
        ([operation]) => operation === "solution-revisions.create",
      ),
    ).toBe(false);
  });
});
