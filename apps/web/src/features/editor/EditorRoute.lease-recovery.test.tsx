import type {
  CloudMarkupClient,
  CurrentPrincipalV1,
  DraftArchitectureDocumentV1,
  ProjectV1,
} from "@cloudmarkup/api-contract";
import {
  getArchitectureDocumentHashes,
  parseArchitectureDocument,
} from "@cloudmarkup/domain";
import { QueryClient } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { Blob as NodeBlob } from "node:buffer";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CloudMarkupQueryProvider,
  cloudMarkupQueryKeys,
} from "../../api/index.js";
import { ModePreferenceProvider } from "../../preferences/index.js";
import { RouterProvider } from "../../routing/index.js";
import { EditorRoute } from "./EditorRoute.js";
import { loadFoundationArchitectureDocument } from "./model/index.js";
import {
  createEditorRecoveryEnvelopeV1,
  prepareEditorRecoverySnapshotV1,
} from "./persistence/editor-recovery-envelope.js";
import type { IndexedDbEditorRecoveryStoreV1 } from "./persistence/indexeddb-editor-recovery-store.js";
import type {
  EditorRecoveryCheckpointRequest,
  EditorRecoveryCheckpointResult,
} from "./persistence/editor-recovery-store.js";

const storeSeam = vi.hoisted(() => ({
  create: vi.fn<() => IndexedDbEditorRecoveryStoreV1 | undefined>(),
}));
vi.mock("./persistence/indexeddb-editor-recovery-store.js", () => ({
  createIndexedDbEditorRecoveryStore: storeSeam.create,
}));
vi.mock("../../shell/AppShell.js", () => ({
  AppShell: ({
    children,
    workspace,
  }: {
    children: ReactNode;
    workspace?: { header?: ReactNode };
  }) => (
    <>
      {workspace?.header}
      {children}
    </>
  ),
}));
vi.mock("./productivity/EditorProductivityTools.js", () => ({
  EditorProductivityTools: () => null,
}));
vi.mock("./EditorWorkspace.js", async () => {
  const { useEditorDocumentSession } = await import("./session/index.js");
  return {
    CatalogPanel: () => null,
    InspectorPanel: () => null,
    BottomWorkspacePanel: () => null,
    EditorMain: () => {
      const session = useEditorDocumentSession();
      if (session.status !== "ready") return null;
      return (
        <>
          <output aria-label="Application position">
            {
              session.document.nodes.find(
                (node) => node.id === "node_application",
              )?.presentation.position.x
            }
          </output>
          {[180, 220].map((x) => (
            <button
              type="button"
              key={x}
              onClick={() => {
                expect(
                  session.moveNode("node_application", { x, y: 190 }).ok,
                ).toBe(true);
              }}
            >
              Move resource to {x}
            </button>
          ))}
        </>
      );
    },
  };
});
const projectId = "project_lease_recovery";
const organizationId = "org_lease_recovery";
const principal: CurrentPrincipalV1 = {
  id: "principal_lease_recovery",
  displayName: "Editor",
  resourceVersion: 1,
  organizationContexts: [
    {
      organizationId,
      membershipId: "membership_recovery",
      role: "owner",
      isOwner: true,
      capabilities: ["projects.read", "projects.mutate"],
    },
  ],
};
const document = loadFoundationArchitectureDocument();
const draft: DraftArchitectureDocumentV1 = {
  id: "draft_recovery",
  projectId,
  architectureDocument: document,
  version: 1,
  contentDigest: getArchitectureDocumentHashes(document).contentHash,
  updatedAt: "2026-09-06T00:00:00.000Z",
};
const project: ProjectV1 = {
  id: projectId,
  organizationId,
  name: "Shared project",
  lifecycleStatus: "active",
  createdAt: draft.updatedAt,
  updatedAt: draft.updatedAt,
  currentDraft: { id: draft.id, version: 1 },
  environmentCount: 0,
  version: 1,
};
async function settle() {
  await act(async () => {
    await Promise.resolve();
  });
}
function setup(
  store?: IndexedDbEditorRecoveryStoreV1,
  lifecycleStatus: ProjectV1["lifecycleStatus"] = "active",
) {
  storeSeam.create.mockReturnValue(store);
  vi.stubGlobal("indexedDB", {});
  let leaseEpoch = 0;
  let serverDraft = draft;
  let serverProject = { ...project, lifecycleStatus };
  const request = vi
    .fn<(operation: string) => Promise<unknown>>()
    .mockImplementation((operation: string) => {
      if (operation.endsWith("release"))
        return Promise.resolve({
          data: { contractVersion: 1, projectId, state: "available" },
        });
      if (!operation.startsWith("project-editing-leases."))
        return Promise.reject(new Error("Unexpected request"));
      if (operation === "project-editing-leases.acquire") leaseEpoch += 1;
      return Promise.resolve({
        data: {
          contractVersion: 1,
          projectId,
          state: "owned",
          leaseId:
            "projectlease_00000000-0000-4000-8000-" +
            String(leaseEpoch).padStart(12, "0"),
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        },
      });
    });
  const saves = vi
    .fn<(operation: string) => Promise<unknown>>()
    .mockRejectedValue(new TypeError("Synthetic offline save"));
  let readFailure = false;
  const requestWithMetadata = vi.fn((operation: string) =>
    operation === "drafts.get" || operation === "projects.get"
      ? readFailure
        ? Promise.reject(new TypeError("Synthetic background read failure"))
        : Promise.resolve({
            data: {
              apiVersion: "v1",
              data: operation === "drafts.get" ? serverDraft : serverProject,
            },
            metadata: {
              etag:
                operation === "drafts.get"
                  ? '"draft:recovery:' + String(serverDraft.version) + '"'
                  : '"project:recovery:' + String(serverProject.version) + '"',
            },
          })
      : saves(operation),
  );
  const client = {
    request,
    requestWithMetadata,
  } as unknown as CloudMarkupClient;
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  queryClient.setQueryData(
    cloudMarkupQueryKeys.project(principal.id, organizationId, projectId),
    { project: serverProject, etag: '"project:recovery:1"' },
  );
  queryClient.setQueryData(
    cloudMarkupQueryKeys.draft(principal.id, organizationId, projectId),
    { draft, etag: '"draft:recovery:1"' },
  );
  window.history.replaceState(
    null,
    "",
    `/organizations/${organizationId}/projects/${projectId}/editor`,
  );
  render(
    <ModePreferenceProvider actorId={principal.id} storage={null}>
      <CloudMarkupQueryProvider client={client} queryClient={queryClient}>
        <RouterProvider>
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
        </RouterProvider>
      </CloudMarkupQueryProvider>
    </ModePreferenceProvider>,
  );
  return {
    request,
    requestWithMetadata,
    saves,
    queryClient,
    closeProject: (status: "deletion-pending" | "deleted") => {
      serverProject = {
        ...serverProject,
        lifecycleStatus: status,
        version: 2,
        updatedAt: new Date(Date.now()).toISOString(),
      };
    },
    advanceDraft: (nextDraft: DraftArchitectureDocumentV1) => {
      serverDraft = nextDraft;
      serverProject = {
        ...project,
        currentDraft: { id: nextDraft.id, version: nextDraft.version },
      };
    },
    failReads: () => {
      readFailure = true;
    },
    restoreReads: () => {
      readFailure = false;
    },
  };
}
async function loseLease() {
  vi.setSystemTime(new Date(Date.now() + 60_001));
  fireEvent.focus(window);
  await settle();
  expect(
    screen.getByRole("region", { name: "Paused local recovery" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /Move resource/u }),
  ).not.toBeInTheDocument();
}
async function downloadedDocument() {
  vi.stubGlobal("Blob", NodeBlob);
  const create = vi.fn<(_blob: Blob) => string>(
    () => "blob:synthetic-recovery",
  );
  vi.stubGlobal(
    "URL",
    class extends URL {
      static override createObjectURL = create;
      static override revokeObjectURL = vi.fn();
    },
  );
  const click = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe("cloudmarkup-recovery.json");
      expect(this.href).toBe("blob:synthetic-recovery");
    });
  fireEvent.click(
    screen.getByRole("button", { name: "Download local recovery" }),
  );
  expect(click).toHaveBeenCalledOnce();
  const blob = create.mock.calls[0]?.[0] as unknown as NodeBlob;
  return JSON.parse(await blob.text()) as {
    nodes: { id: string; presentation: { position: { x: number } } }[];
  };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-06T00:00:00Z"));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("real editor recovery survives editing lease loss", () => {
  it.each(["deletion-pending", "deleted"] as const)(
    "keeps unsaved RAM-only work downloadable when an active project becomes %s",
    async (status) => {
      const f = setup();
      await settle();
      fireEvent.click(
        screen.getByRole("button", { name: "Move resource to 180" }),
      );
      expect(screen.getByLabelText("Application position")).toHaveTextContent(
        "184",
      );
      f.closeProject(status);
      await act(async () => {
        await f.queryClient.refetchQueries({
          queryKey: cloudMarkupQueryKeys.project(
            principal.id,
            organizationId,
            projectId,
          ),
          exact: true,
        });
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(
        screen.getByRole("region", { name: "Paused local recovery" }),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          "This project is closed. Your local changes remain available for download only.",
        ),
      ).toBeInTheDocument();
      expect(screen.getByText(/not persisted/u)).toBeInTheDocument();
      for (const name of [
        /Move resource/u,
        /^Save now$/u,
        /^Try editing$/u,
        /^Save local changes as a copy$/u,
        /^Load latest saved draft$/u,
      ]) {
        expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
      }
      expect(
        screen.getByRole("link", { name: "Return to projects" }),
      ).toHaveAttribute("href", `/organizations/${organizationId}/projects`);
      fireEvent.keyDown(globalThis.document.body, { key: "z", ctrlKey: true });
      fireEvent.keyDown(globalThis.document.body, { key: "s", ctrlKey: true });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_001);
      });
      const downloaded = await downloadedDocument();
      expect(
        downloaded.nodes.find((node) => node.id === "node_application")
          ?.presentation.position.x,
      ).toBe(184);
      expect(f.saves).not.toHaveBeenCalled();
      expect(f.request.mock.calls.map(([operation]) => operation)).toEqual([
        "project-editing-leases.acquire",
        "project-editing-leases.release",
      ]);
      expect(
        f.queryClient.getQueryData(
          cloudMarkupQueryKeys.draft(principal.id, organizationId, projectId),
        ),
      ).toEqual({ draft, etag: '"draft:recovery:1"' });
      expect(storeSeam.create).toHaveBeenCalledOnce();
    },
  );
  it.each(["deletion-pending", "deleted"] as const)(
    "does not open a cached draft or acquire a lease for an initially %s project",
    async (status) => {
      const f = setup(undefined, status);
      await settle();
      expect(screen.getByRole("status")).toHaveTextContent("Project closed");
      expect(
        screen.queryByRole("region", { name: "Paused local recovery" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /Move resource/u }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Download local recovery" }),
      ).not.toBeInTheDocument();
      expect(f.request).not.toHaveBeenCalled();
      expect(f.saves).not.toHaveBeenCalled();
      expect(
        f.requestWithMetadata.mock.calls.some(
          ([operation]) => operation === "drafts.get",
        ),
      ).toBe(false);
      expect(storeSeam.create).not.toHaveBeenCalled();
    },
  );
  it("keeps the in-memory document downloadable without IndexedDB and never autosaves it after loss", async () => {
    const { saves } = setup();
    await settle();
    fireEvent.click(
      screen.getByRole("button", { name: "Move resource to 180" }),
    );
    await loseLease();
    const downloaded = await downloadedDocument();
    expect(
      downloaded.nodes.find((node) => node.id === "node_application")
        ?.presentation.position.x,
    ).toBe(184);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(saves).not.toHaveBeenCalled();
    expect(screen.getByText(/not persisted/u)).toBeInTheDocument();
  });
  it("keeps its real coordinator/store open while an older checkpoint and newer edits drain after loss", async () => {
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    let generation = 0;
    const close = vi.fn();
    const checkpoint = vi
      .fn<
        (
          input: EditorRecoveryCheckpointRequest,
        ) => Promise<EditorRecoveryCheckpointResult>
      >()
      .mockImplementation(async (input) => {
        generation += 1;
        const thisGeneration = generation;
        if (thisGeneration === 1) await pending;
        expect(close).not.toHaveBeenCalled();
        const snapshot = prepareEditorRecoverySnapshotV1(
          input.binding,
          input.document,
        );
        if (!snapshot.ok)
          throw new Error("Synthetic checkpoint must be valid.");
        const envelope = createEditorRecoveryEnvelopeV1(snapshot.snapshot, {
          generation: thisGeneration,
          savedAt: input.savedAt,
          writerId: input.writerId,
        });
        return {
          status: "stored",
          envelope,
          head: {
            generation: thisGeneration,
            snapshotDigest: envelope.checkpoint.snapshotDigest,
          },
        };
      });
    const store: IndexedDbEditorRecoveryStoreV1 = {
      contractVersion: 1,
      close,
      checkpoint,
      load: () => Promise.resolve({ status: "empty" }),
      discard: () => Promise.resolve({ status: "empty" }),
      remediateRejected: () => Promise.resolve({ status: "discarded" }),
      subscribe: () => () => undefined,
    };
    setup(store);
    await settle();
    fireEvent.click(
      screen.getByRole("button", { name: "Move resource to 180" }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(750);
    });
    expect(checkpoint).toHaveBeenCalledOnce();
    fireEvent.click(
      screen.getByRole("button", { name: "Move resource to 220" }),
    );
    await loseLease();
    expect(close).not.toHaveBeenCalled();
    await act(async () => {
      finish();
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(checkpoint).toHaveBeenCalledTimes(2);
    expect(
      checkpoint.mock.calls[1]?.[0].document.nodes.find(
        (node) => node.id === "node_application",
      )?.presentation.position.x,
    ).toBe(224);
    expect(close).not.toHaveBeenCalled();
    const downloaded = await downloadedDocument();
    expect(
      downloaded.nodes.find((node) => node.id === "node_application")
        ?.presentation.position.x,
    ).toBe(224);
  });
  it.each(["draft", "project"] as const)(
    "retains unsaved in-memory recovery and revalidates explicit retry after a background %s read fails",
    async (kind) => {
      const f = setup();
      await settle();
      fireEvent.click(
        screen.getByRole("button", { name: "Move resource to 180" }),
      );
      f.failReads();
      await act(async () => {
        await f.queryClient.refetchQueries({
          queryKey: cloudMarkupQueryKeys[kind](
            principal.id,
            organizationId,
            projectId,
          ),
          exact: true,
        });
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(
        screen.getByRole("region", { name: "Paused local recovery" }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /Move resource/u }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText("The project draft could not be loaded"),
      ).not.toBeInTheDocument();
      const downloaded = await downloadedDocument();
      expect(
        downloaded.nodes.find((node) => node.id === "node_application")
          ?.presentation.position.x,
      ).toBe(184);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(f.saves).not.toHaveBeenCalled();
      f.restoreReads();
      fireEvent.click(screen.getByRole("button", { name: "Try editing" }));
      await settle();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(
        screen.getByRole("button", { name: "Move resource to 180" }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("region", { name: "Paused local recovery" }),
      ).not.toBeInTheDocument();
      expect(f.saves).not.toHaveBeenCalled();
    },
  );
  it("keeps local changes paused after a new-epoch changed head until explicit latest-draft reload", async () => {
    const f = setup();
    await settle();
    fireEvent.click(
      screen.getByRole("button", { name: "Move resource to 180" }),
    );
    await loseLease();
    const latestDocument = parseArchitectureDocument({
      ...document,
      nodes: document.nodes.map((node) =>
        node.id === "node_application"
          ? {
              ...node,
              presentation: {
                ...node.presentation,
                position: { ...node.presentation.position, x: 400 },
              },
            }
          : node,
      ),
    });
    const latestDraft: DraftArchitectureDocumentV1 = {
      ...draft,
      architectureDocument: latestDocument,
      contentDigest: getArchitectureDocumentHashes(latestDocument).contentHash,
      version: 2,
      updatedAt: "2026-09-06T00:01:00.000Z",
    };
    f.advanceDraft(latestDraft);
    fireEvent.click(screen.getByRole("button", { name: "Try editing" }));
    await settle();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(
      f.request.mock.calls.filter(
        ([operation]) => operation === "project-editing-leases.acquire",
      ),
    ).toHaveLength(2);
    expect(
      screen.getByRole("region", { name: "Paused local recovery" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Move resource/u }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/saved draft changed while this session was paused/u),
    ).toBeInTheDocument();
    const downloaded = await downloadedDocument();
    expect(
      downloaded.nodes.find((node) => node.id === "node_application")
        ?.presentation.position.x,
    ).toBe(184);
    expect(f.saves).not.toHaveBeenCalled();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(
      screen.getByRole("button", { name: "Load latest saved draft" }),
    );
    await settle();
    expect(confirm).toHaveBeenCalledOnce();
    expect(confirm).toHaveBeenCalledWith(
      expect.stringContaining("replaces unsaved changes in this tab"),
    );
    expect(
      screen.queryByRole("region", { name: "Paused local recovery" }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Application position")).toHaveTextContent(
      "400",
    );
    expect(
      screen.getByRole("button", { name: "Move resource to 180" }),
    ).toBeInTheDocument();
    expect(
      f.queryClient.getQueryData(
        cloudMarkupQueryKeys.draft(principal.id, organizationId, projectId),
      ),
    ).toEqual({
      draft: latestDraft,
      etag: '"draft:recovery:2"',
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(f.saves).not.toHaveBeenCalled();
  });
});
