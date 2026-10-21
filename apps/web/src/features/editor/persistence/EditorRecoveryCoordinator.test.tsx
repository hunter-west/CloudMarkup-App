import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  hashCanonicalValue,
  type ArchitectureDocument,
} from "@cloudmarkup/domain";

import { DevelopmentFixtureStatus } from "../DevelopmentFixtureStatus.js";
import {
  foundationEditorCatalog,
  foundationIconRegistry,
  loadFoundationArchitectureDocument,
} from "../model/index.js";
import { dispatchMoveNodeCommand } from "../model/move-node-command.js";
import {
  EditorSessionProvider,
  type EditorSessionProviderProps,
} from "../session/EditorSessionProvider.js";
import {
  useEditorDocumentSession,
  useEditorSessionState,
} from "../session/editor-session-hooks.js";
import { useEditorRecovery } from "./editor-recovery-context.js";
import {
  createEditorRecoveryBindingV1,
  createEditorRecoveryEnvelopeV1,
  prepareEditorRecoverySnapshotV1,
} from "./editor-recovery-envelope.js";
import {
  EDITOR_RECOVERY_STORE_CONTRACT_VERSION,
  type EditorRecoveryBindingV1,
  type EditorRecoveryCheckpointRequest,
  type EditorRecoveryCheckpointResult,
  type EditorRecoveryDiagnosticV1,
  type EditorRecoveryDiscardRequest,
  type EditorRecoveryDiscardResult,
  type EditorRecoveryHead,
  type EditorRecoveryHeadNotice,
  type EditorRecoveryLoadResult,
  type EditorRecoveryReady,
  type EditorRecoveryRejectedRemediationRequest,
  type EditorRecoveryRejectedRemediationResult,
  type EditorRecoveryStoreV1,
} from "./editor-recovery-store.js";

class FakeEditorRecoveryStore implements EditorRecoveryStoreV1 {
  public readonly contractVersion = EDITOR_RECOVERY_STORE_CONTRACT_VERSION;
  public readonly checkpointRequests: EditorRecoveryCheckpointRequest[] = [];
  public readonly discardRequests: EditorRecoveryDiscardRequest[] = [];
  public readonly loadBindings: EditorRecoveryBindingV1[] = [];
  public readonly remediationRequests: EditorRecoveryRejectedRemediationRequest[] =
    [];
  readonly #listeners = new Set<(notice: EditorRecoveryHeadNotice) => void>();

  public get subscriptionCount(): number {
    return this.#listeners.size;
  }

  public checkpointImplementation:
    | ((
        request: EditorRecoveryCheckpointRequest,
      ) => Promise<EditorRecoveryCheckpointResult>)
    | undefined;
  public discardImplementation:
    | ((
        request: EditorRecoveryDiscardRequest,
      ) => Promise<EditorRecoveryDiscardResult>)
    | undefined;
  public loadResult: EditorRecoveryLoadResult = { status: "empty" };
  public remediationImplementation:
    | ((
        request: EditorRecoveryRejectedRemediationRequest,
      ) => Promise<EditorRecoveryRejectedRemediationResult>)
    | undefined;
  #head: EditorRecoveryHead | null = null;

  public async checkpoint(
    request: EditorRecoveryCheckpointRequest,
  ): Promise<EditorRecoveryCheckpointResult> {
    this.checkpointRequests.push(request);
    if (this.checkpointImplementation !== undefined) {
      return this.checkpointImplementation(request);
    }

    const prepared = prepareEditorRecoverySnapshotV1(
      request.binding,
      request.document,
    );
    if (!prepared.ok) {
      return { status: "rejected", diagnostic: prepared.diagnostic };
    }
    const generation = (this.#head?.generation ?? 0) + 1;
    const envelope = createEditorRecoveryEnvelopeV1(prepared.snapshot, {
      generation,
      savedAt: request.savedAt,
      writerId: request.writerId,
    });
    this.#head = {
      generation,
      snapshotDigest: envelope.checkpoint.snapshotDigest,
    };
    return { status: "stored", envelope, head: this.#head };
  }

  public async discard(
    request: EditorRecoveryDiscardRequest,
  ): Promise<EditorRecoveryDiscardResult> {
    this.discardRequests.push(request);
    return this.discardImplementation?.(request) ?? { status: "discarded" };
  }

  public emit(notice: EditorRecoveryHeadNotice): void {
    for (const listener of this.#listeners) {
      listener(notice);
    }
  }

  public load(
    binding: EditorRecoveryBindingV1,
  ): Promise<EditorRecoveryLoadResult> {
    this.loadBindings.push(binding);
    return Promise.resolve(this.loadResult);
  }

  public remediateRejected(
    request: EditorRecoveryRejectedRemediationRequest,
  ): Promise<EditorRecoveryRejectedRemediationResult> {
    this.remediationRequests.push(request);
    if (this.remediationImplementation !== undefined) {
      return this.remediationImplementation(request);
    }
    if (request.action === "discard") {
      return Promise.resolve({ status: "discarded" });
    }

    const prepared = prepareEditorRecoverySnapshotV1(
      request.binding,
      request.document,
    );
    if (!prepared.ok) {
      return Promise.resolve({
        status: "rejected",
        diagnostic: prepared.diagnostic,
      });
    }
    const generation = (this.#head?.generation ?? 0) + 1;
    const envelope = createEditorRecoveryEnvelopeV1(prepared.snapshot, {
      generation,
      savedAt: request.savedAt,
      writerId: request.writerId,
    });
    this.#head = {
      generation,
      snapshotDigest: envelope.checkpoint.snapshotDigest,
    };
    return Promise.resolve({ status: "stored", envelope, head: this.#head });
  }

  public subscribe(
    _binding: EditorRecoveryBindingV1,
    listener: (notice: EditorRecoveryHeadNotice) => void,
  ): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }
}

function createSequentialId(prefix: string): () => string {
  let sequence = 0;
  return () => {
    sequence += 1;
    return `${prefix}_${String(sequence)}`;
  };
}

function requiredAt<T>(values: readonly T[], index: number): T {
  const value = values[index];
  if (value === undefined) {
    throw new Error(`Expected value at index ${String(index)}.`);
  }
  return value;
}

function moveDocument(
  document: ArchitectureDocument,
  x: number,
  y: number,
  prefix: string,
): ArchitectureDocument {
  return dispatchMoveNodeCommand({
    createId: createSequentialId(prefix),
    document,
    nodeId: "node_application",
    position: { x, y },
  }).document;
}

function applicationPosition(document: ArchitectureDocument): string {
  const position = document.nodes.find((node) => node.id === "node_application")
    ?.presentation.position;
  return position === undefined
    ? "unavailable"
    : `${String(position.x)},${String(position.y)}`;
}

function recoveryHead(generation: number): EditorRecoveryHead {
  return {
    generation,
    snapshotDigest: hashCanonicalValue({
      generation,
      kind: "editor-recovery-coordinator-test-head",
    }),
  };
}

function readyResult(
  seedDocument: ArchitectureDocument,
  recoveredDocument: ArchitectureDocument,
  scopeKey: string,
  generation = 1,
): EditorRecoveryReady {
  const binding = createEditorRecoveryBindingV1({
    scopeKey,
    seedDocument,
  });
  const prepared = prepareEditorRecoverySnapshotV1(binding, recoveredDocument);
  if (!prepared.ok) {
    throw new Error("The recovered test document could not be prepared.");
  }
  const envelope = createEditorRecoveryEnvelopeV1(prepared.snapshot, {
    generation,
    savedAt: "2026-07-30T14:00:00.000Z",
    writerId: "writer_previous",
  });
  return {
    diagnostic: null,
    document: recoveredDocument,
    envelope,
    head: {
      generation,
      snapshotDigest: envelope.checkpoint.snapshotDigest,
    },
    migrationClassification: "current",
    status: "ready",
  };
}

function rejectedDiagnostic(
  binding: EditorRecoveryBindingV1,
): EditorRecoveryDiagnosticV1 {
  return {
    classification: "envelope-malformed",
    diagnostics: [
      {
        code: "malformed-envelope",
        message: "The saved envelope is malformed.",
        path: "$",
      },
    ],
    kind: "cloudmarkup.editor-recovery-diagnostic",
    schemaVersion: 1,
    scopeFingerprint: binding.scopeFingerprint,
  };
}

function SessionRecoveryProbe() {
  const session = useEditorDocumentSession();
  const transient = useEditorSessionState((state) => state);
  const recovery = useEditorRecovery();

  return (
    <div>
      <output data-testid="session-status">{session.status}</output>
      <output data-testid="recovery-status">{recovery.state.status}</output>
      <output data-testid="recovered">
        {recovery.state.status === "saved"
          ? String(recovery.state.recovered)
          : "unavailable"}
      </output>
      <output data-testid="application-position">
        {session.status === "ready"
          ? applicationPosition(session.document)
          : "unavailable"}
      </output>
      <output data-testid="history">
        {`${String(session.history.canUndo)}|${String(session.history.canRedo)}`}
      </output>
      <output data-testid="selection">
        {transient.selection === null
          ? "none"
          : `${transient.selection.kind}:${transient.selection.id}`}
      </output>
      <button
        onClick={() => {
          transient.setSelection({ id: "node_application", kind: "node" });
        }}
        type="button"
      >
        Select application
      </button>
      <button
        onClick={() => {
          session.moveNode("node_application", { x: 420, y: 260 });
        }}
        type="button"
      >
        Move application
      </button>
      <button
        onClick={() => {
          session.undo();
        }}
        type="button"
      >
        Undo
      </button>
      <button
        onClick={() => {
          session.redo();
        }}
        type="button"
      >
        Redo
      </button>
    </div>
  );
}

function RecoveryProvider({
  children,
  createId = createSequentialId("operation_recovery"),
  document = loadFoundationArchitectureDocument(),
  recoveryCheckingFallback = <DevelopmentFixtureStatus />,
  scopeKey = "project:editor-recovery-coordinator",
  store,
  ...recoveryProps
}: {
  readonly children: ReactNode;
  readonly createId?: () => string;
  readonly document?: ArchitectureDocument;
  readonly scopeKey?: string;
  readonly store: EditorRecoveryStoreV1;
} & Pick<
  EditorSessionProviderProps,
  | "recoveryAutosaveDebounceMilliseconds"
  | "preserveSessionOnRecoveryRebind"
  | "recoveryCheckingFallback"
  | "recoveryDownloadDiagnostic"
  | "recoveryNow"
  | "recoveryWriterId"
>) {
  return (
    <EditorSessionProvider
      catalog={foundationEditorCatalog}
      createId={createId}
      document={document}
      iconRegistry={foundationIconRegistry}
      recoveryCheckingFallback={recoveryCheckingFallback}
      recoveryStore={store}
      scopeKey={scopeKey}
      {...recoveryProps}
    >
      {children}
    </EditorSessionProvider>
  );
}

describe("EditorRecoveryCoordinator session integration", () => {
  it("rebases an acknowledged server version without resetting editor state", async () => {
    const store = new FakeEditorRecoveryStore();
    const seedDocument = loadFoundationArchitectureDocument();
    const acknowledgedDocument = moveDocument(
      seedDocument,
      424,
      264,
      "operation_acknowledged",
    );
    const createId = createSequentialId("operation_server_rebase");
    const rendered = render(
      <RecoveryProvider
        createId={createId}
        document={seedDocument}
        preserveSessionOnRecoveryRebind
        scopeKey="server:project:draft:1"
        store={store}
      >
        <SessionRecoveryProbe />
      </RecoveryProvider>,
    );

    await waitFor(() => {
      expect(store.loadBindings).toHaveLength(1);
      expect(screen.getByTestId("recovery-status")).toHaveTextContent("saved");
    });
    fireEvent.click(screen.getByRole("button", { name: "Select application" }));
    fireEvent.click(screen.getByRole("button", { name: "Move application" }));
    expect(screen.getByTestId("application-position")).toHaveTextContent(
      "424,264",
    );
    expect(screen.getByTestId("history")).toHaveTextContent("true|false");
    expect(screen.getByTestId("selection")).toHaveTextContent(
      "node:node_application",
    );

    rendered.rerender(
      <RecoveryProvider
        createId={createId}
        document={acknowledgedDocument}
        preserveSessionOnRecoveryRebind
        scopeKey="server:project:draft:2"
        store={store}
      >
        <SessionRecoveryProbe />
      </RecoveryProvider>,
    );

    await waitFor(() => {
      expect(store.loadBindings).toHaveLength(2);
      expect(screen.getByTestId("recovery-status")).toHaveTextContent("saved");
    });
    expect(store.loadBindings[0]?.scopeFingerprint).not.toBe(
      store.loadBindings[1]?.scopeFingerprint,
    );
    expect(screen.getByTestId("application-position")).toHaveTextContent(
      "424,264",
    );
    expect(screen.getByTestId("history")).toHaveTextContent("true|false");
    expect(screen.getByTestId("selection")).toHaveTextContent(
      "node:node_application",
    );
    await waitFor(() => {
      expect(store.discardRequests).toHaveLength(1);
    });
    expect(store.discardRequests[0]?.binding.scopeFingerprint).toBe(
      store.loadBindings[0]?.scopeFingerprint,
    );
  });
  it("preserves a newer overlapping edit while rebinding recovery to an acknowledged version", async () => {
    const store = new FakeEditorRecoveryStore();
    const seedDocument = loadFoundationArchitectureDocument();
    const acknowledgedDocument = moveDocument(
      seedDocument,
      300,
      180,
      "operation_earlier_acknowledgement",
    );
    const createId = createSequentialId("operation_overlapping_rebase");
    const rendered = render(
      <RecoveryProvider
        createId={createId}
        document={seedDocument}
        preserveSessionOnRecoveryRebind
        recoveryAutosaveDebounceMilliseconds={0}
        scopeKey="server:project:overlap:1"
        store={store}
      >
        <SessionRecoveryProbe />
      </RecoveryProvider>,
    );

    await waitFor(() => {
      expect(store.loadBindings).toHaveLength(1);
      expect(screen.getByTestId("recovery-status")).toHaveTextContent("saved");
    });
    fireEvent.click(screen.getByRole("button", { name: "Select application" }));
    fireEvent.click(screen.getByRole("button", { name: "Move application" }));
    expect(screen.getByTestId("application-position")).toHaveTextContent(
      "424,264",
    );

    rendered.rerender(
      <RecoveryProvider
        createId={createId}
        document={acknowledgedDocument}
        preserveSessionOnRecoveryRebind
        recoveryAutosaveDebounceMilliseconds={0}
        scopeKey="server:project:overlap:2"
        store={store}
      >
        <SessionRecoveryProbe />
      </RecoveryProvider>,
    );

    await waitFor(() => {
      expect(store.loadBindings).toHaveLength(2);
      const reboundBinding = store.loadBindings[1];
      expect(
        store.checkpointRequests.some(
          (request) =>
            request.binding.scopeFingerprint ===
              reboundBinding?.scopeFingerprint &&
            applicationPosition(request.document) === "424,264",
        ),
      ).toBe(true);
    });
    expect(screen.getByTestId("application-position")).toHaveTextContent(
      "424,264",
    );
    expect(screen.getByTestId("history")).toHaveTextContent("true|false");
    expect(screen.getByTestId("selection")).toHaveTextContent(
      "node:node_application",
    );
    await waitFor(() => {
      expect(store.discardRequests).toHaveLength(1);
    });
    expect(store.discardRequests[0]?.binding.scopeFingerprint).toBe(
      store.loadBindings[0]?.scopeFingerprint,
    );
  });
  it("retries pruning when another scope is superseded during an in-flight discard", async () => {
    const store = new FakeEditorRecoveryStore();
    const createId = createSequentialId("operation_in_flight_prune_rebase");
    let resolveFirstDiscard:
      ((result: EditorRecoveryDiscardResult) => void) | undefined;
    const firstDiscard = new Promise<EditorRecoveryDiscardResult>((resolve) => {
      resolveFirstDiscard = resolve;
    });
    let discardCall = 0;
    store.discardImplementation = () => {
      discardCall += 1;
      return discardCall === 1
        ? firstDiscard
        : Promise.resolve({ status: "discarded" });
    };
    let acknowledgedDocument = loadFoundationArchitectureDocument();
    const rendered = render(
      <RecoveryProvider
        createId={createId}
        document={acknowledgedDocument}
        preserveSessionOnRecoveryRebind
        recoveryAutosaveDebounceMilliseconds={0}
        scopeKey="server:project:in-flight-prune:1"
        store={store}
      >
        <SessionRecoveryProbe />
      </RecoveryProvider>,
    );

    await waitFor(() => {
      expect(store.loadBindings).toHaveLength(1);
      expect(screen.getByTestId("recovery-status")).toHaveTextContent("saved");
    });
    fireEvent.click(screen.getByRole("button", { name: "Move application" }));
    await waitFor(() => {
      expect(store.checkpointRequests).toHaveLength(1);
    });
    acknowledgedDocument = requiredAt(store.checkpointRequests, 0).document;
    rendered.rerender(
      <RecoveryProvider
        createId={createId}
        document={acknowledgedDocument}
        preserveSessionOnRecoveryRebind
        recoveryAutosaveDebounceMilliseconds={0}
        scopeKey="server:project:in-flight-prune:2"
        store={store}
      >
        <SessionRecoveryProbe />
      </RecoveryProvider>,
    );
    await waitFor(() => {
      expect(store.loadBindings).toHaveLength(2);
      expect(store.discardRequests).toHaveLength(1);
    });

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => {
      expect(store.checkpointRequests).toHaveLength(2);
    });
    acknowledgedDocument = requiredAt(store.checkpointRequests, 1).document;
    rendered.rerender(
      <RecoveryProvider
        createId={createId}
        document={acknowledgedDocument}
        preserveSessionOnRecoveryRebind
        recoveryAutosaveDebounceMilliseconds={0}
        scopeKey="server:project:in-flight-prune:3"
        store={store}
      >
        <SessionRecoveryProbe />
      </RecoveryProvider>,
    );
    await waitFor(() => {
      expect(store.loadBindings).toHaveLength(3);
    });
    expect(store.discardRequests).toHaveLength(1);

    const resolveDiscard = resolveFirstDiscard;
    if (resolveDiscard === undefined) {
      throw new Error("The first discard did not expose its resolver.");
    }
    await act(async () => {
      resolveDiscard({ status: "discarded" });
      await firstDiscard;
    });

    await waitFor(() => {
      expect(store.discardRequests).toHaveLength(2);
    });
    expect(
      store.discardRequests.map((request) => request.binding.scopeFingerprint),
    ).toEqual([
      store.loadBindings[0]?.scopeFingerprint,
      store.loadBindings[1]?.scopeFingerprint,
    ]);
  });
  it("uses the stable default clock and reaches ready after exactly one load", async () => {
    const store = new FakeEditorRecoveryStore();

    render(
      <RecoveryProvider store={store}>
        <SessionRecoveryProbe />
      </RecoveryProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("session-status")).toHaveTextContent("ready");
      expect(screen.getByTestId("recovery-status")).toHaveTextContent("saved");
    });
    await act(async () => Promise.resolve());
    expect(store.loadBindings).toHaveLength(1);
  });

  it("mounts a validated refresh checkpoint with fresh empty history", async () => {
    const store = new FakeEditorRecoveryStore();
    const seedDocument = loadFoundationArchitectureDocument();
    const recoveredDocument = moveDocument(
      seedDocument,
      612,
      388,
      "operation_refresh_recovery",
    );
    const scopeKey = "project:valid-refresh-recovery";
    store.loadResult = readyResult(
      seedDocument,
      recoveredDocument,
      scopeKey,
      7,
    );

    render(
      <RecoveryProvider
        document={seedDocument}
        scopeKey={scopeKey}
        store={store}
      >
        <SessionRecoveryProbe />
      </RecoveryProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("application-position")).toHaveTextContent(
        applicationPosition(recoveredDocument),
      );
      expect(screen.getByTestId("recovered")).toHaveTextContent("true");
    });
    expect(screen.getByTestId("history")).toHaveTextContent("false|false");
    expect(store.checkpointRequests).toHaveLength(0);
  });

  it("checkpoints accepted move, undo, and redo documents but not transient state", async () => {
    const store = new FakeEditorRecoveryStore();
    const seedDocument = loadFoundationArchitectureDocument();

    render(
      <RecoveryProvider
        document={seedDocument}
        recoveryAutosaveDebounceMilliseconds={0}
        recoveryNow={() => "2026-07-30T15:00:00.000Z"}
        store={store}
      >
        <SessionRecoveryProbe />
      </RecoveryProvider>,
    );
    await waitFor(() => {
      expect(screen.getByTestId("session-status")).toHaveTextContent("ready");
      expect(screen.getByTestId("recovery-status")).toHaveTextContent("saved");
    });

    fireEvent.click(screen.getByRole("button", { name: "Select application" }));
    await waitFor(() => {
      expect(screen.getByTestId("selection")).toHaveTextContent(
        "node:node_application",
      );
    });
    await act(async () => Promise.resolve());
    expect(store.checkpointRequests).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Move application" }));
    await waitFor(() => {
      expect(store.checkpointRequests).toHaveLength(1);
    });
    const movedPosition = applicationPosition(
      requiredAt(store.checkpointRequests, 0).document,
    );

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => {
      expect(store.checkpointRequests).toHaveLength(2);
    });
    expect(
      applicationPosition(requiredAt(store.checkpointRequests, 1).document),
    ).toBe(applicationPosition(seedDocument));

    fireEvent.click(screen.getByRole("button", { name: "Redo" }));
    await waitFor(() => {
      expect(store.checkpointRequests).toHaveLength(3);
    });
    expect(
      applicationPosition(requiredAt(store.checkpointRequests, 2).document),
    ).toBe(movedPosition);
  });

  it("flushes a pending checkpoint on pagehide", async () => {
    const store = new FakeEditorRecoveryStore();

    render(
      <RecoveryProvider
        recoveryAutosaveDebounceMilliseconds={60_000}
        store={store}
      >
        <SessionRecoveryProbe />
      </RecoveryProvider>,
    );
    await screen.findByTestId("session-status");

    fireEvent.click(screen.getByRole("button", { name: "Move application" }));
    expect(screen.getByTestId("recovery-status")).toHaveTextContent("unsaved");
    expect(store.checkpointRequests).toHaveLength(0);

    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    await waitFor(() => {
      expect(store.checkpointRequests).toHaveLength(1);
    });
  });

  it("flushes a pending checkpoint before an SPA unmount disposes autosave", async () => {
    const store = new FakeEditorRecoveryStore();
    const view = render(
      <RecoveryProvider
        recoveryAutosaveDebounceMilliseconds={60_000}
        store={store}
      >
        <SessionRecoveryProbe />
      </RecoveryProvider>,
    );
    await screen.findByTestId("session-status");

    fireEvent.click(screen.getByRole("button", { name: "Move application" }));
    expect(screen.getByTestId("recovery-status")).toHaveTextContent("unsaved");
    expect(store.checkpointRequests).toHaveLength(0);

    view.unmount();
    await waitFor(() => {
      expect(store.checkpointRequests).toHaveLength(1);
    });
  });
  it("surfaces a stale foreign checkpoint notice as a conflict", async () => {
    const store = new FakeEditorRecoveryStore();
    const scopeKey = "project:foreign-notice-conflict";

    render(
      <RecoveryProvider scopeKey={scopeKey} store={store}>
        <SessionRecoveryProbe />
      </RecoveryProvider>,
    );
    await waitFor(() => {
      expect(screen.getByTestId("recovery-status")).toHaveTextContent("saved");
    });
    const binding = store.loadBindings[0];
    if (binding === undefined) {
      throw new Error("The recovery store was not loaded.");
    }

    act(() => {
      store.emit({
        head: recoveryHead(12),
        kind: "checkpoint",
        scopeFingerprint: binding.scopeFingerprint,
        writerId: "writer_foreign_tab",
      });
    });
    expect(screen.getByTestId("recovery-status")).toHaveTextContent("conflict");
  });

  it.each([
    { hasPreviousCheckpoint: true, label: "the previous valid checkpoint" },
    { hasPreviousCheckpoint: false, label: "the seed document" },
  ])(
    "recovers $label through classification-bound remediation",
    async ({ hasPreviousCheckpoint }) => {
      const store = new FakeEditorRecoveryStore();
      const seedDocument = loadFoundationArchitectureDocument();
      const safeDocument = moveDocument(
        seedDocument,
        532,
        348,
        "operation_previous_valid",
      );
      const scopeKey = `project:rejected-${String(hasPreviousCheckpoint)}`;
      const binding = createEditorRecoveryBindingV1({
        scopeKey,
        seedDocument,
      });
      store.loadResult = {
        classification: "envelope-malformed",
        diagnostic: rejectedDiagnostic(binding),
        ...(hasPreviousCheckpoint
          ? {
              previousValidCheckpoint: readyResult(
                seedDocument,
                safeDocument,
                scopeKey,
                8,
              ),
            }
          : {}),
        status: "rejected",
      };

      render(
        <RecoveryProvider
          document={seedDocument}
          scopeKey={scopeKey}
          store={store}
        >
          <SessionRecoveryProbe />
        </RecoveryProvider>,
      );
      await screen.findByText("Recovery required");
      expect(screen.queryByTestId("session-status")).not.toBeInTheDocument();

      fireEvent.click(
        screen.getByRole("button", { name: "Recover safe copy" }),
      );
      await waitFor(() => {
        expect(store.remediationRequests).toHaveLength(1);
      });
      const request = requiredAt(store.remediationRequests, 0);
      expect(request).toMatchObject({
        action: "replace",
        expectedClassification: "envelope-malformed",
        expectedHead: null,
      });
      if (request.action !== "replace") {
        throw new Error("Expected a replacement remediation request.");
      }
      expect(applicationPosition(request.document)).toBe(
        applicationPosition(
          hasPreviousCheckpoint ? safeDocument : seedDocument,
        ),
      );
      await waitFor(() => {
        expect(screen.getByTestId("history")).toHaveTextContent("false|false");
      });
    },
  );

  it("offers diagnostic download and classification-bound discard", async () => {
    const store = new FakeEditorRecoveryStore();
    const seedDocument = loadFoundationArchitectureDocument();
    const scopeKey = "project:discard-corrupt-recovery";
    const binding = createEditorRecoveryBindingV1({
      scopeKey,
      seedDocument,
    });
    const downloadDiagnostic =
      vi.fn<(contents: string, filename: string) => void>();
    store.loadResult = {
      classification: "envelope-malformed",
      diagnostic: rejectedDiagnostic(binding),
      status: "rejected",
    };

    render(
      <RecoveryProvider
        document={seedDocument}
        recoveryDownloadDiagnostic={downloadDiagnostic}
        scopeKey={scopeKey}
        store={store}
      >
        <SessionRecoveryProbe />
      </RecoveryProvider>,
    );
    await screen.findByText("Recovery required");
    expect(screen.queryByTestId("session-status")).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Download diagnostic copy" }),
    );
    expect(downloadDiagnostic).toHaveBeenCalledWith(
      expect.stringContaining('"classification": "envelope-malformed"'),
      "cloudmarkup-recovery-diagnostic.json",
    );
    expect(downloadDiagnostic.mock.lastCall?.[0]).not.toContain(
      "canonicalDocument",
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Discard local draft" }),
    );
    await waitFor(() => {
      expect(store.remediationRequests).toHaveLength(1);
    });
    expect(requiredAt(store.remediationRequests, 0)).toMatchObject({
      action: "discard",
      expectedClassification: "envelope-malformed",
      expectedHead: null,
    });
    expect(store.discardRequests).toHaveLength(0);
    await waitFor(() => {
      expect(screen.getByTestId("recovery-status")).toHaveTextContent("saved");
      expect(screen.getByTestId("history")).toHaveTextContent("false|false");
    });
  });

  it("does not overwrite a concurrently replaced valid record", async () => {
    const store = new FakeEditorRecoveryStore();
    const seedDocument = loadFoundationArchitectureDocument();
    const scopeKey = "project:remediation-conflict";
    const binding = createEditorRecoveryBindingV1({
      scopeKey,
      seedDocument,
    });
    store.loadResult = {
      classification: "envelope-malformed",
      diagnostic: rejectedDiagnostic(binding),
      status: "rejected",
    };
    store.remediationImplementation = (request) =>
      Promise.resolve({
        actualClassification: "ready",
        actualHead: recoveryHead(11),
        expectedClassification: request.expectedClassification,
        expectedHead: request.expectedHead,
        status: "conflict",
      });

    render(
      <RecoveryProvider
        document={seedDocument}
        scopeKey={scopeKey}
        store={store}
      >
        <SessionRecoveryProbe />
      </RecoveryProvider>,
    );
    await screen.findByText("Recovery required");
    expect(screen.queryByTestId("session-status")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Recover safe copy" }));
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        "Recovery paused because the local record changed",
      );
    });
    expect(screen.queryByTestId("session-status")).not.toBeInTheDocument();
    expect(requiredAt(store.remediationRequests, 0)).toMatchObject({
      action: "replace",
      expectedClassification: "envelope-malformed",
      expectedHead: null,
    });
    expect(store.checkpointRequests).toHaveLength(0);
  });
  it("does not reactivate autosave when remediation resolves after unmount", async () => {
    const store = new FakeEditorRecoveryStore();
    const seedDocument = loadFoundationArchitectureDocument();
    const scopeKey = "project:unmounted-remediation";
    const binding = createEditorRecoveryBindingV1({
      scopeKey,
      seedDocument,
    });
    const ready = readyResult(seedDocument, seedDocument, scopeKey, 3);
    let resolveRemediation:
      ((result: EditorRecoveryRejectedRemediationResult) => void) | undefined;
    store.loadResult = {
      classification: "envelope-malformed",
      diagnostic: rejectedDiagnostic(binding),
      status: "rejected",
    };
    store.remediationImplementation = () =>
      new Promise<EditorRecoveryRejectedRemediationResult>((resolve) => {
        resolveRemediation = resolve;
      });

    const view = render(
      <RecoveryProvider
        document={seedDocument}
        scopeKey={scopeKey}
        store={store}
      >
        <SessionRecoveryProbe />
      </RecoveryProvider>,
    );
    await screen.findByText("Recovery required");
    fireEvent.click(screen.getByRole("button", { name: "Recover safe copy" }));
    await waitFor(() => {
      expect(store.remediationRequests).toHaveLength(1);
    });

    view.unmount();
    await act(async () => {
      resolveRemediation?.({
        status: "stored",
        envelope: ready.envelope,
        head: ready.head,
      });
      await Promise.resolve();
    });

    expect(store.subscriptionCount).toBe(0);
    expect(store.checkpointRequests).toHaveLength(0);
  });
});
