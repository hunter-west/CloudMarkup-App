import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import type { ConfigurationValue } from "@cloudmarkup/schemas";
import { awsEditorCatalog } from "../../../provider-catalog/aws-editor-catalog.js";
import { loadAwsEditorArchitectureDocument } from "../../../provider-catalog/aws-editor-fixture.js";
import { awsIconRegistry } from "../../../provider-icons/aws-icon-registry.js";
import {
  createConfigurationFormBufferKey,
  foundationEditorCatalog,
  foundationIconRegistry,
  loadFoundationArchitectureDocument,
  type EditorCatalog,
  type LayoutAdapter,
  type LayoutRequest,
  type LayoutResult,
  type PreparedServiceRemoval,
} from "../model/index.js";
import {
  EditorSessionProvider,
  type EditorSessionProviderProps,
} from "./EditorSessionProvider.js";
import {
  useEditorDocumentSession,
  useEditorSessionState,
} from "./editor-session-hooks.js";

interface SessionProbeProps {
  readonly addServiceId?: string;
  readonly moveTo?: {
    readonly x: number;
    readonly y: number;
  };
}

function configurationValueAt(
  values: unknown,
  property: string,
): Readonly<ConfigurationValue> | undefined {
  if (typeof values !== "object" || values === null) {
    return undefined;
  }

  return (values as Readonly<Record<string, Readonly<ConfigurationValue>>>)[
    property
  ];
}

function SessionProbe({
  addServiceId = "example.compute",
  moveTo = { x: 420, y: 260 },
}: SessionProbeProps) {
  const session = useEditorDocumentSession();
  const transient = useEditorSessionState((state) => state);
  const [lastAddResult, setLastAddResult] = useState("not-run");
  const [lastHistoryResult, setLastHistoryResult] = useState("not-run");
  const [lastMoveResult, setLastMoveResult] = useState("not-run");

  const selectedNodeId =
    transient.selection?.kind === "node" ? transient.selection.id : "none";
  const hoveredEdgeId =
    transient.hoveredElement?.kind === "edge"
      ? transient.hoveredElement.id
      : "none";
  const preview = transient.previewPositions.get("node_application");
  const application =
    session.status === "ready"
      ? session.document.nodes.find((node) => node.id === "node_application")
      : undefined;
  const unknown =
    session.status === "ready"
      ? session.document.nodes.find((node) => node.id === "node_unknown")
      : undefined;
  const addedCompute =
    session.status === "ready"
      ? session.document.nodes.find((node) => node.id === "node_compute")
      : undefined;

  return (
    <div>
      <output data-testid="session-status">{session.status}</output>
      <output data-testid="problem">
        {session.status === "invalid" ? session.problem.message : "none"}
      </output>
      <output data-testid="content-hash">
        {session.status === "ready"
          ? session.hashes.contentHash
          : "unavailable"}
      </output>
      <output data-testid="visual-hash">
        {session.status === "ready" ? session.hashes.visualHash : "unavailable"}
      </output>
      <output data-testid="application-position">
        {application === undefined
          ? "unavailable"
          : `${String(application.presentation.position.x)},${String(
              application.presentation.position.y,
            )}`}
      </output>
      <output data-testid="unknown-position">
        {unknown === undefined
          ? "unavailable"
          : `${String(unknown.presentation.position.x)},${String(
              unknown.presentation.position.y,
            )}`}
      </output>
      <output data-testid="added-compute">
        {addedCompute === undefined
          ? "none"
          : [
              addedCompute.semantic.serviceType,
              addedCompute.semantic.resourceType,
              addedCompute.semantic.deploymentKey,
              `${String(addedCompute.presentation.position.x)},${String(
                addedCompute.presentation.position.y,
              )}`,
              addedCompute.semantic.lifecycle.ownership,
              addedCompute.semantic.lifecycle.origin,
            ].join("|")}
      </output>
      <output data-testid="node-count">
        {session.status === "ready"
          ? String(session.document.nodes.length)
          : "unavailable"}
      </output>
      <output data-testid="selection">{selectedNodeId}</output>
      <output data-testid="hover">{hoveredEdgeId}</output>
      <output data-testid="viewport">
        {`${String(transient.viewport.x)},${String(
          transient.viewport.y,
        )},${String(transient.viewport.zoom)}`}
      </output>
      <output data-testid="preview-position">
        {preview === undefined
          ? "none"
          : `${String(preview.x)},${String(preview.y)}`}
      </output>
      <output data-testid="announcement">{transient.liveAnnouncement}</output>
      <output data-testid="recent-services">
        {transient.recentServiceIds.join(",")}
      </output>
      <output data-testid="last-add-result">{lastAddResult}</output>
      <output data-testid="last-history-result">{lastHistoryResult}</output>
      <output data-testid="last-move-result">{lastMoveResult}</output>
      <output data-testid="history-state">
        {[
          String(session.history.canUndo),
          String(session.history.canRedo),
          session.history.undoLabel ?? "none",
          session.history.redoLabel ?? "none",
        ].join("|")}
      </output>

      <button
        onClick={() => {
          transient.setSelection({ id: "node_application", kind: "node" });
          transient.setHoveredElement({
            id: "edge_application_network",
            kind: "edge",
          });
          transient.setViewport({ x: 12, y: 24, zoom: 1.25 });
          transient.setNodePositionPreview("node_application", {
            x: 360,
            y: 220,
          });
          transient.announce("Transient editor state changed.");
        }}
        type="button"
      >
        Change transient state
      </button>
      <button
        onClick={() => {
          const result = session.addService(addServiceId, {
            x: 640,
            y: 320,
          });
          setLastAddResult(
            result.ok
              ? `${result.nodeId}:${result.deploymentKey}`
              : result.code,
          );
        }}
        type="button"
      >
        Add application service
      </button>
      <button
        onClick={() => {
          const result = session.moveNode("node_application", moveTo);
          setLastMoveResult(result.ok ? "success" : result.code);
        }}
        type="button"
      >
        Move application
      </button>
      <button
        onClick={() => {
          const result = session.moveNode("node_application", {
            x: 560,
            y: 320,
          });
          setLastMoveResult(result.ok ? "success" : result.code);
        }}
        type="button"
      >
        Move application elsewhere
      </button>
      <button
        onClick={() => {
          const result = session.undo();
          setLastHistoryResult(result.ok ? "undo-success" : result.message);
        }}
        type="button"
      >
        Undo history
      </button>
      <button
        onClick={() => {
          const result = session.redo();
          setLastHistoryResult(result.ok ? "redo-success" : result.message);
        }}
        type="button"
      >
        Redo history
      </button>
      <button
        onClick={() => {
          const result = session.moveNode("node_unknown", {
            x: 208,
            y: 104,
          });
          setLastMoveResult(result.ok ? "success" : result.code);
        }}
        type="button"
      >
        Move unknown resource
      </button>
    </div>
  );
}

function ServiceRemovalProbe() {
  const session = useEditorDocumentSession();
  const [preview, setPreview] = useState<PreparedServiceRemoval | null>(null);
  const [result, setResult] = useState("none");
  if (session.status !== "ready") return null;
  return (
    <div>
      <button
        onClick={() => {
          const prepared = session.previewServiceRemoval("node_application");
          if (prepared.ok) setPreview(prepared.preview);
          else setResult(prepared.message);
        }}
        type="button"
      >
        Preview application removal
      </button>
      <button
        disabled={preview === null}
        onClick={() => {
          if (preview === null) return;
          const applied = session.removeService(preview);
          setResult(applied.ok ? "success" : applied.message);
        }}
        type="button"
      >
        Confirm application removal
      </button>
      <output data-testid="service-removal-result">{result}</output>
    </div>
  );
}

function ConfigurationSessionProbe() {
  const session = useEditorDocumentSession();
  const transient = useEditorSessionState((state) => state);
  const [lastApplyResult, setLastApplyResult] = useState("not-run");
  const [lastPreviewResult, setLastPreviewResult] = useState("not-run");

  const node =
    session.status === "ready"
      ? session.document.nodes.find(
          (candidate) => candidate.id === "node_api_handler",
        )
      : undefined;
  const currentMemory = configurationValueAt(
    node?.semantic.configuration.values,
    "memoryMegabytes",
  );
  const previewNode = session.configurationPreview?.previewDocument.nodes.find(
    (candidate) => candidate.id === "node_api_handler",
  );
  const previewMemory = configurationValueAt(
    previewNode?.semantic.configuration.values,
    "memoryMegabytes",
  );
  const bufferKey =
    node === undefined
      ? "node:node_api_handler:unavailable"
      : createConfigurationFormBufferKey(
          { id: node.id, kind: "node" },
          node.semantic.configuration.schemaId,
          node.semantic.configuration.schemaVersion,
        );

  return (
    <div>
      <output data-testid="configuration-session-status">
        {session.status}
      </output>
      <output data-testid="configuration-content-hash">
        {session.status === "ready"
          ? session.hashes.contentHash
          : "unavailable"}
      </output>
      <output data-testid="configuration-visual-hash">
        {session.status === "ready" ? session.hashes.visualHash : "unavailable"}
      </output>
      <output data-testid="configuration-selection">
        {transient.selection === null
          ? "none"
          : `${transient.selection.kind}:${transient.selection.id}`}
      </output>
      <output data-testid="configuration-current-memory">
        {currentMemory?.kind === "integer"
          ? String(currentMemory.value)
          : "unavailable"}
      </output>
      <output data-testid="configuration-preview-memory">
        {previewMemory?.kind === "integer"
          ? String(previewMemory.value)
          : "none"}
      </output>
      <output data-testid="configuration-preview-command">
        {session.configurationPreview === null
          ? "none"
          : `${session.configurationPreview.command.commandId}|${session.configurationPreview.command.inverseCommandId}`}
      </output>
      <output data-testid="configuration-preview-base-hash">
        {session.configurationPreview?.baseHashes.contentHash ?? "none"}
      </output>
      <output data-testid="configuration-preview-content-hash">
        {session.configurationPreview?.previewHashes.contentHash ?? "none"}
      </output>
      <output data-testid="configuration-preview-visual-hash">
        {session.configurationPreview?.previewHashes.visualHash ?? "none"}
      </output>
      <output data-testid="configuration-buffer">
        {transient.configurationFormBuffers.has(bufferKey) ? "present" : "none"}
      </output>
      <output data-testid="configuration-last-preview">
        {lastPreviewResult}
      </output>
      <output data-testid="configuration-last-apply">{lastApplyResult}</output>
      <output data-testid="configuration-announcement">
        {transient.liveAnnouncement}
      </output>
      <output data-testid="configuration-history-state">
        {`${String(session.history.canUndo)}|${String(session.history.canRedo)}|${session.history.undoLabel ?? "none"}|${session.history.redoLabel ?? "none"}`}
      </output>

      <button
        onClick={() => {
          transient.setSelection({ id: "node_identity", kind: "node" });
        }}
        type="button"
      >
        Select identity
      </button>
      <button
        onClick={() => {
          transient.setSelection({ id: "node_notes_table", kind: "node" });
        }}
        type="button"
      >
        Change configuration selection
      </button>
      <button
        onClick={() => {
          transient.setConfigurationFormBuffer(bufferKey, {
            shouldValidate: true,
            values: { memoryMegabytes: "512" },
          });
        }}
        type="button"
      >
        Buffer configuration
      </button>
      <button
        onClick={() => {
          const result = session.previewConfiguration(
            { id: "node_api_handler", kind: "node" },
            { memoryMegabytes: { kind: "integer", value: 512 } },
          );
          setLastPreviewResult(
            result.ok
              ? "success"
              : `${result.code}:${String(result.issues.length)}`,
          );
        }}
        type="button"
      >
        Preview configuration
      </button>
      <button
        onClick={() => {
          const result = session.previewConfiguration(
            { id: "node_api_handler", kind: "node" },
            { timeoutSeconds: { kind: "integer", value: 0 } },
          );
          setLastPreviewResult(
            result.ok
              ? "success"
              : `${result.code}:${String(result.issues.length)}`,
          );
        }}
        type="button"
      >
        Preview invalid configuration
      </button>
      <button
        onClick={() => {
          const result = session.applyConfigurationPreview();
          setLastApplyResult(result.ok ? "success" : result.code);
        }}
        type="button"
      >
        Apply configuration
      </button>
      <button
        onClick={() => {
          session.discardConfigurationPreview();
        }}
        type="button"
      >
        Discard configuration
      </button>
      <button
        onClick={() => {
          session.undo();
        }}
        type="button"
      >
        Undo configuration history
      </button>
    </div>
  );
}

function layoutResultFor(request: LayoutRequest): LayoutResult {
  const positions = new Map([
    ["node_network", { x: 8, y: 8 }],
    ["node_zone", { x: 40, y: 160 }],
    ["node_application", { x: 48, y: 168 }],
    ["node_unknown", { x: 960, y: 40 }],
    ["node_unsupported", { x: 960, y: 440 }],
  ]);
  return {
    positions: request.nodes.map((node) => ({
      nodeId: node.id,
      parentId: node.parentId ?? null,
      position: positions.get(node.id) ?? { x: 0, y: 0 },
    })),
  };
}

function LayoutSessionProbe() {
  const session = useEditorDocumentSession();
  const previewPositions = useEditorSessionState(
    (state) => state.previewPositions,
  );
  const applicationPreview = previewPositions.get("node_application");
  const application =
    session.status === "ready"
      ? session.document.nodes.find((node) => node.id === "node_application")
      : undefined;

  return (
    <div>
      <output data-testid="layout-status">
        {session.layoutWorkflow.status}
      </output>
      <output data-testid="layout-content-hash">
        {session.status === "ready" ? session.hashes.contentHash : "none"}
      </output>
      <output data-testid="layout-visual-hash">
        {session.status === "ready" ? session.hashes.visualHash : "none"}
      </output>
      <output data-testid="layout-preview-position">
        {applicationPreview === undefined
          ? "none"
          : `${String(applicationPreview.x)},${String(applicationPreview.y)}`}
      </output>
      <output data-testid="layout-change-count">
        {session.layoutWorkflow.preview?.changes.length ?? 0}
      </output>
      <output data-testid="layout-application-position">
        {application === undefined
          ? "none"
          : `${String(application.presentation.position.x)},${String(application.presentation.position.y)}`}
      </output>
      <output data-testid="layout-history-state">
        {`${String(session.history.canUndo)}|${String(session.history.canRedo)}|${session.history.undoLabel ?? "none"}|${session.history.redoLabel ?? "none"}`}
      </output>
      <button
        onClick={() => {
          session.startAutomaticLayout();
        }}
        type="button"
      >
        Start automatic layout
      </button>
      <button
        onClick={() => {
          session.cancelAutomaticLayout();
        }}
        type="button"
      >
        Cancel automatic layout
      </button>
      <button
        onClick={() => {
          session.applyAutomaticLayout();
        }}
        type="button"
      >
        Apply automatic layout
      </button>
      <button
        onClick={() => {
          session.undo();
        }}
        type="button"
      >
        Undo layout history
      </button>
      <button
        onClick={() => {
          session.redo();
        }}
        type="button"
      >
        Redo layout history
      </button>
    </div>
  );
}

interface TestProviderProps {
  readonly catalog?: EditorCatalog;
  readonly children: ReactNode;
  readonly createId?: () => string;
  readonly document?: unknown;
  readonly iconRegistry?: typeof foundationIconRegistry;
  readonly layoutAdapter?: LayoutAdapter;
  readonly scopeKey?: string;
  readonly onDocumentChange?: EditorSessionProviderProps["onDocumentChange"];
}

function TestProvider({
  catalog = foundationEditorCatalog,
  children,
  createId = () => "operation-default",
  document = loadFoundationArchitectureDocument(),
  iconRegistry = foundationIconRegistry,
  layoutAdapter,
  onDocumentChange,
  scopeKey,
}: TestProviderProps) {
  return (
    <EditorSessionProvider
      catalog={catalog}
      createId={createId}
      document={document}
      iconRegistry={iconRegistry}
      {...(onDocumentChange === undefined ? {} : { onDocumentChange })}
      {...(layoutAdapter === undefined ? {} : { layoutAdapter })}
      {...(scopeKey === undefined ? {} : { scopeKey })}
    >
      {children}
    </EditorSessionProvider>
  );
}

describe("EditorSessionProvider", () => {
  it("rejects a stale service removal preview without reporting a second save", () => {
    const onDocumentChange = vi.fn();
    let sequence = 0;
    render(
      <TestProvider
        createId={() => "stale-removal-operation-" + String(++sequence)}
        onDocumentChange={onDocumentChange}
      >
        <SessionProbe />
        <ServiceRemovalProbe />
      </TestProvider>,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Preview application removal" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Move application elsewhere" }),
    );
    expect(onDocumentChange).toHaveBeenCalledTimes(1);
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm application removal" }),
    );
    expect(screen.getByTestId("service-removal-result")).toHaveTextContent(
      "The design changed after this preview",
    );
    expect(screen.getByTestId("node-count")).toHaveTextContent("5");
    expect(onDocumentChange).toHaveBeenCalledTimes(1);
  });

  it("keeps selection and other transient state out of both document hashes", () => {
    render(
      <TestProvider>
        <SessionProbe />
      </TestProvider>,
    );

    const contentHash = screen.getByTestId("content-hash").textContent;
    const visualHash = screen.getByTestId("visual-hash").textContent;
    const position = screen.getByTestId("application-position").textContent;

    fireEvent.click(
      screen.getByRole("button", { name: "Change transient state" }),
    );

    expect(screen.getByTestId("selection")).toHaveTextContent(
      "node_application",
    );
    expect(screen.getByTestId("hover")).toHaveTextContent(
      "edge_application_network",
    );
    expect(screen.getByTestId("viewport")).toHaveTextContent("12,24,1.25");
    expect(screen.getByTestId("preview-position")).toHaveTextContent("360,220");
    expect(screen.getByTestId("content-hash").textContent).toBe(contentHash);
    expect(screen.getByTestId("visual-hash").textContent).toBe(visualHash);
    expect(screen.getByTestId("application-position").textContent).toBe(
      position,
    );
    expect(screen.getByTestId("history-state")).toHaveTextContent(
      "false|false|none|none",
    );
  });

  it("moves a node only through the command dispatcher and preserves semantic content", () => {
    const sourceDocument = loadFoundationArchitectureDocument();
    const sourceSnapshot = JSON.stringify(sourceDocument);
    const createId = vi
      .fn<() => string>()
      .mockReturnValueOnce("operation_move_application")
      .mockReturnValueOnce("operation_restore_application");

    render(
      <TestProvider createId={createId} document={sourceDocument}>
        <SessionProbe />
      </TestProvider>,
    );

    const contentHash = screen.getByTestId("content-hash").textContent;
    const visualHash = screen.getByTestId("visual-hash").textContent;
    fireEvent.click(
      screen.getByRole("button", { name: "Change transient state" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Move application" }));

    expect(screen.getByTestId("last-move-result")).toHaveTextContent("success");
    expect(screen.getByTestId("application-position")).toHaveTextContent(
      "424,264",
    );
    expect(screen.getByTestId("content-hash").textContent).toBe(contentHash);
    expect(screen.getByTestId("visual-hash").textContent).not.toBe(visualHash);
    expect(screen.getByTestId("preview-position")).toHaveTextContent("none");
    expect(screen.getByTestId("announcement")).toHaveTextContent(
      "Node moved. Architecture content did not change.",
    );
    expect(createId).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(sourceDocument)).toBe(sourceSnapshot);
  });

  it("undoes and redoes accepted commands without restoring transient editor state, then invalidates redo on a new command", () => {
    let sequence = 0;
    render(
      <TestProvider
        createId={() => {
          sequence += 1;
          return `history_session_${String(sequence).padStart(4, "0")}`;
        }}
      >
        <SessionProbe />
      </TestProvider>,
    );
    const originalPosition = screen.getByTestId(
      "application-position",
    ).textContent;

    fireEvent.click(
      screen.getByRole("button", { name: "Change transient state" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Move application" }));
    expect(screen.getByTestId("history-state")).toHaveTextContent(
      "true|false|Move",
    );

    fireEvent.click(screen.getByRole("button", { name: "Undo history" }));
    expect(screen.getByTestId("last-history-result")).toHaveTextContent(
      "undo-success",
    );
    expect(screen.getByTestId("application-position").textContent).toBe(
      originalPosition,
    );
    expect(screen.getByTestId("history-state")).toHaveTextContent(
      "false|true|none|Move",
    );
    expect(screen.getByTestId("selection")).toHaveTextContent(
      "node_application",
    );
    expect(screen.getByTestId("hover")).toHaveTextContent(
      "edge_application_network",
    );
    expect(screen.getByTestId("viewport")).toHaveTextContent("12,24,1.25");

    fireEvent.click(screen.getByRole("button", { name: "Redo history" }));
    expect(screen.getByTestId("last-history-result")).toHaveTextContent(
      "redo-success",
    );
    expect(screen.getByTestId("application-position")).toHaveTextContent(
      "424,264",
    );

    fireEvent.click(screen.getByRole("button", { name: "Undo history" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Move application elsewhere" }),
    );
    expect(screen.getByTestId("application-position")).toHaveTextContent(
      "560,320",
    );
    expect(screen.getByTestId("history-state")).toHaveTextContent(
      "true|false|Move",
    );

    fireEvent.click(screen.getByRole("button", { name: "Redo history" }));
    expect(screen.getByTestId("last-history-result")).toHaveTextContent(
      "There is no architecture change to redo.",
    );
    expect(screen.getByTestId("application-position")).toHaveTextContent(
      "560,320",
    );
  });

  it("moves an unknown catalog resource without invoking placement validation", () => {
    const sourceDocument = loadFoundationArchitectureDocument();
    const sourceSnapshot = JSON.stringify(sourceDocument);
    const createId = vi
      .fn<() => string>()
      .mockReturnValueOnce("operation_move_unknown")
      .mockReturnValueOnce("operation_restore_unknown");

    render(
      <TestProvider createId={createId} document={sourceDocument}>
        <SessionProbe />
      </TestProvider>,
    );

    const contentHash = screen.getByTestId("content-hash").textContent;
    const visualHash = screen.getByTestId("visual-hash").textContent;
    fireEvent.click(
      screen.getByRole("button", { name: "Move unknown resource" }),
    );

    expect(screen.getByTestId("last-move-result")).toHaveTextContent("success");
    expect(screen.getByTestId("unknown-position")).toHaveTextContent("208,104");
    expect(screen.getByTestId("content-hash").textContent).toBe(contentHash);
    expect(screen.getByTestId("visual-hash").textContent).not.toBe(visualHash);
    expect(createId).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(sourceDocument)).toBe(sourceSnapshot);
  });

  it("adds a service through the command path and synchronizes document and transient state", () => {
    const sourceDocument = loadFoundationArchitectureDocument();
    const sourceSnapshot = JSON.stringify(sourceDocument);
    const createId = vi
      .fn<() => string>()
      .mockReturnValueOnce("operation_add_compute")
      .mockReturnValueOnce("operation_remove_compute");

    render(
      <TestProvider createId={createId} document={sourceDocument}>
        <SessionProbe />
      </TestProvider>,
    );

    const contentHash = screen.getByTestId("content-hash").textContent;
    const visualHash = screen.getByTestId("visual-hash").textContent;

    fireEvent.click(
      screen.getByRole("button", { name: "Add application service" }),
    );

    expect(screen.getByTestId("last-add-result")).toHaveTextContent(
      "node_compute:compute",
    );
    expect(screen.getByTestId("node-count")).toHaveTextContent("6");
    expect(screen.getByTestId("added-compute")).toHaveTextContent(
      "example.compute|example.compute.application|compute|640,320|user|user",
    );
    expect(screen.getByTestId("content-hash").textContent).not.toBe(
      contentHash,
    );
    expect(screen.getByTestId("visual-hash").textContent).not.toBe(visualHash);
    expect(screen.getByTestId("selection")).toHaveTextContent("node_compute");
    expect(screen.getByTestId("recent-services")).toHaveTextContent(
      "example.compute",
    );
    expect(screen.getByTestId("announcement")).toHaveTextContent(
      "Application resource added through a Graph Command.",
    );
    expect(createId).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(sourceDocument)).toBe(sourceSnapshot);
  });

  it("preserves document hashes and transient selection when an add command is rejected", () => {
    const sourceDocument = loadFoundationArchitectureDocument();
    const sourceSnapshot = JSON.stringify(sourceDocument);
    const createId = vi.fn(() => "operation_duplicate");

    render(
      <TestProvider createId={createId} document={sourceDocument}>
        <SessionProbe />
      </TestProvider>,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Change transient state" }),
    );
    const contentHash = screen.getByTestId("content-hash").textContent;
    const visualHash = screen.getByTestId("visual-hash").textContent;

    fireEvent.click(
      screen.getByRole("button", { name: "Add application service" }),
    );

    expect(screen.getByTestId("last-add-result")).toHaveTextContent(
      "command-rejected",
    );
    expect(screen.getByTestId("node-count")).toHaveTextContent("5");
    expect(screen.getByTestId("added-compute")).toHaveTextContent("none");
    expect(screen.getByTestId("content-hash").textContent).toBe(contentHash);
    expect(screen.getByTestId("visual-hash").textContent).toBe(visualHash);
    expect(screen.getByTestId("selection")).toHaveTextContent(
      "node_application",
    );
    expect(screen.getByTestId("recent-services")).toBeEmptyDOMElement();
    expect(screen.getByTestId("announcement")).toHaveTextContent(
      "The service could not be added. The architecture document was not changed.",
    );
    expect(screen.getByTestId("announcement")).not.toHaveTextContent(
      "command identity",
    );
    expect(createId).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(sourceDocument)).toBe(sourceSnapshot);
  });

  it("rolls back a rejected move and exposes only a safe failure", () => {
    const createId = vi.fn(() => "operation_duplicate");

    render(
      <TestProvider createId={createId}>
        <SessionProbe />
      </TestProvider>,
    );

    const contentHash = screen.getByTestId("content-hash").textContent;
    const visualHash = screen.getByTestId("visual-hash").textContent;
    const position = screen.getByTestId("application-position").textContent;
    fireEvent.click(
      screen.getByRole("button", { name: "Change transient state" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Move application" }));

    expect(screen.getByTestId("last-move-result")).toHaveTextContent(
      "command-rejected",
    );
    expect(screen.getByTestId("application-position").textContent).toBe(
      position,
    );
    expect(screen.getByTestId("content-hash").textContent).toBe(contentHash);
    expect(screen.getByTestId("visual-hash").textContent).toBe(visualHash);
    expect(screen.getByTestId("preview-position")).toHaveTextContent("none");
    expect(screen.getByTestId("announcement")).toHaveTextContent(
      "The node could not be moved. The architecture document was not changed.",
    );
    expect(screen.getByTestId("announcement")).not.toHaveTextContent(
      "inverse command IDs",
    );
  });

  it("fails closed for invalid input without dispatching a command", () => {
    const createId = vi.fn(() => "operation_unused");

    render(
      <TestProvider createId={createId} document={{ schemaVersion: 99 }}>
        <SessionProbe />
      </TestProvider>,
    );

    expect(screen.getByTestId("session-status")).toHaveTextContent("invalid");
    expect(screen.getByTestId("problem")).toHaveTextContent(
      "The architecture document is invalid or unsupported. It was not loaded.",
    );

    fireEvent.click(screen.getByRole("button", { name: "Move application" }));

    expect(screen.getByTestId("last-move-result")).toHaveTextContent(
      "document-unavailable",
    );
    expect(screen.getByTestId("announcement")).toHaveTextContent(
      "The node could not be moved because no valid architecture is loaded.",
    );
    expect(createId).not.toHaveBeenCalled();
  });

  it("starts a fresh transient and document session when its scope changes", () => {
    let commandSequence = 0;
    const createId = () => {
      commandSequence += 1;
      return `operation_scope_${String(commandSequence)}`;
    };
    const { rerender } = render(
      <TestProvider createId={createId} scopeKey="scope-a">
        <SessionProbe />
      </TestProvider>,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Change transient state" }),
    );
    expect(screen.getByTestId("selection")).toHaveTextContent(
      "node_application",
    );
    fireEvent.click(screen.getByRole("button", { name: "Move application" }));
    expect(screen.getByTestId("application-position")).toHaveTextContent(
      "424,264",
    );

    rerender(
      <TestProvider createId={createId} scopeKey="scope-b">
        <SessionProbe />
      </TestProvider>,
    );

    expect(screen.getByTestId("application-position")).toHaveTextContent(
      "40,160",
    );
    expect(screen.getByTestId("selection")).toHaveTextContent("none");
    expect(screen.getByTestId("hover")).toHaveTextContent("none");
    expect(screen.getByTestId("viewport")).toHaveTextContent("0,0,1");
    expect(screen.getByTestId("preview-position")).toHaveTextContent("none");
    expect(screen.getByTestId("announcement")).toBeEmptyDOMElement();
  });

  it("previews configuration without mutating the document or selection, then applies the exact prepared command", () => {
    const sourceDocument = loadAwsEditorArchitectureDocument();
    const sourceSnapshot = JSON.stringify(sourceDocument);
    const createId = vi
      .fn<() => string>()
      .mockReturnValueOnce("operation_configuration_preview")
      .mockReturnValueOnce("operation_configuration_inverse");

    render(
      <TestProvider
        catalog={awsEditorCatalog}
        createId={createId}
        document={sourceDocument}
        iconRegistry={awsIconRegistry}
      >
        <ConfigurationSessionProbe />
      </TestProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Select identity" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Buffer configuration" }),
    );
    const contentHash = screen.getByTestId(
      "configuration-content-hash",
    ).textContent;
    const visualHash = screen.getByTestId(
      "configuration-visual-hash",
    ).textContent;
    const currentMemory = screen.getByTestId(
      "configuration-current-memory",
    ).textContent;

    fireEvent.click(
      screen.getByRole("button", { name: "Preview configuration" }),
    );

    expect(screen.getByTestId("configuration-last-preview")).toHaveTextContent(
      "success",
    );
    expect(
      screen.getByTestId("configuration-preview-command"),
    ).toHaveTextContent(
      "operation_configuration_preview|operation_configuration_inverse",
    );
    expect(
      screen.getByTestId("configuration-preview-memory"),
    ).toHaveTextContent("512");
    expect(screen.getByTestId("configuration-current-memory").textContent).toBe(
      currentMemory,
    );
    expect(screen.getByTestId("configuration-content-hash").textContent).toBe(
      contentHash,
    );
    expect(screen.getByTestId("configuration-visual-hash").textContent).toBe(
      visualHash,
    );
    expect(
      screen.getByTestId("configuration-preview-base-hash").textContent,
    ).toBe(contentHash);
    expect(
      screen.getByTestId("configuration-preview-content-hash").textContent,
    ).not.toBe(contentHash);
    expect(
      screen.getByTestId("configuration-preview-visual-hash").textContent,
    ).toBe(visualHash);
    expect(screen.getByTestId("configuration-selection")).toHaveTextContent(
      "node:node_identity",
    );
    expect(screen.getByTestId("configuration-buffer")).toHaveTextContent(
      "present",
    );
    expect(screen.getByTestId("configuration-announcement")).toHaveTextContent(
      "Configuration command preview ready. The architecture document has not changed.",
    );
    expect(createId).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(sourceDocument)).toBe(sourceSnapshot);

    fireEvent.click(
      screen.getByRole("button", { name: "Apply configuration" }),
    );

    expect(screen.getByTestId("configuration-last-apply")).toHaveTextContent(
      "success",
    );
    expect(
      screen.getByTestId("configuration-current-memory"),
    ).toHaveTextContent("512");
    expect(
      screen.getByTestId("configuration-content-hash").textContent,
    ).not.toBe(contentHash);
    expect(screen.getByTestId("configuration-visual-hash").textContent).toBe(
      visualHash,
    );
    expect(
      screen.getByTestId("configuration-preview-command"),
    ).toHaveTextContent("none");
    expect(screen.getByTestId("configuration-selection")).toHaveTextContent(
      "node:node_identity",
    );
    expect(screen.getByTestId("configuration-buffer")).toHaveTextContent(
      "none",
    );
    expect(screen.getByTestId("configuration-announcement")).toHaveTextContent(
      "Configuration applied through the prepared Graph Command.",
    );
    expect(createId).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(sourceDocument)).toBe(sourceSnapshot);
    expect(screen.getByTestId("configuration-history-state")).toHaveTextContent(
      "true|false|Update node configuration",
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Undo configuration history" }),
    );
    expect(screen.getByTestId("configuration-current-memory").textContent).toBe(
      currentMemory,
    );
    expect(screen.getByTestId("configuration-content-hash").textContent).toBe(
      contentHash,
    );
    expect(screen.getByTestId("configuration-selection")).toHaveTextContent(
      "node:node_identity",
    );
    expect(screen.getByTestId("configuration-history-state")).toHaveTextContent(
      "false|true|none|Update node configuration",
    );
  });

  it("discards prepared configuration and fails closed when apply has no preview", () => {
    render(
      <TestProvider
        catalog={awsEditorCatalog}
        createId={vi
          .fn<() => string>()
          .mockReturnValueOnce("operation_configuration_discard")
          .mockReturnValueOnce("operation_configuration_discard_inverse")}
        document={loadAwsEditorArchitectureDocument()}
        iconRegistry={awsIconRegistry}
      >
        <ConfigurationSessionProbe />
      </TestProvider>,
    );

    const contentHash = screen.getByTestId(
      "configuration-content-hash",
    ).textContent;
    const visualHash = screen.getByTestId(
      "configuration-visual-hash",
    ).textContent;
    const currentMemory = screen.getByTestId(
      "configuration-current-memory",
    ).textContent;

    fireEvent.click(
      screen.getByRole("button", { name: "Preview configuration" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Discard configuration" }),
    );

    expect(
      screen.getByTestId("configuration-preview-command"),
    ).toHaveTextContent("none");
    expect(screen.getByTestId("configuration-announcement")).toHaveTextContent(
      "Configuration command preview discarded.",
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Apply configuration" }),
    );

    expect(screen.getByTestId("configuration-last-apply")).toHaveTextContent(
      "preview-unavailable",
    );
    expect(screen.getByTestId("configuration-content-hash").textContent).toBe(
      contentHash,
    );
    expect(screen.getByTestId("configuration-visual-hash").textContent).toBe(
      visualHash,
    );
    expect(screen.getByTestId("configuration-current-memory").textContent).toBe(
      currentMemory,
    );
    expect(screen.getByTestId("configuration-announcement")).toHaveTextContent(
      "Preview a valid configuration command before applying changes.",
    );
  });

  it("rejects invalid configuration without changing the document or selection", () => {
    const createId = vi.fn(() => "operation_unused");
    render(
      <TestProvider
        catalog={awsEditorCatalog}
        createId={createId}
        document={loadAwsEditorArchitectureDocument()}
        iconRegistry={awsIconRegistry}
      >
        <ConfigurationSessionProbe />
      </TestProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Select identity" }));
    const contentHash = screen.getByTestId(
      "configuration-content-hash",
    ).textContent;
    const visualHash = screen.getByTestId(
      "configuration-visual-hash",
    ).textContent;

    fireEvent.click(
      screen.getByRole("button", { name: "Preview invalid configuration" }),
    );

    expect(screen.getByTestId("configuration-last-preview")).toHaveTextContent(
      "command-rejected:1",
    );
    expect(
      screen.getByTestId("configuration-preview-command"),
    ).toHaveTextContent("none");
    expect(screen.getByTestId("configuration-content-hash").textContent).toBe(
      contentHash,
    );
    expect(screen.getByTestId("configuration-visual-hash").textContent).toBe(
      visualHash,
    );
    expect(screen.getByTestId("configuration-selection")).toHaveTextContent(
      "node:node_identity",
    );
    expect(screen.getByTestId("configuration-announcement")).toHaveTextContent(
      "The configuration value does not satisfy its catalog schema.",
    );
    expect(createId).not.toHaveBeenCalled();
  });

  it("clears a prepared configuration when the selection changes before apply", () => {
    render(
      <TestProvider
        catalog={awsEditorCatalog}
        createId={vi
          .fn<() => string>()
          .mockReturnValueOnce("operation_configuration_selection")
          .mockReturnValueOnce("operation_configuration_selection_inverse")}
        document={loadAwsEditorArchitectureDocument()}
        iconRegistry={awsIconRegistry}
      >
        <ConfigurationSessionProbe />
      </TestProvider>,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Preview configuration" }),
    );
    expect(
      screen.getByTestId("configuration-preview-command"),
    ).not.toHaveTextContent("none");

    fireEvent.click(
      screen.getByRole("button", { name: "Change configuration selection" }),
    );

    expect(
      screen.getByTestId("configuration-preview-command"),
    ).toHaveTextContent("none");
    fireEvent.click(
      screen.getByRole("button", { name: "Apply configuration" }),
    );
    expect(screen.getByTestId("configuration-last-apply")).toHaveTextContent(
      "preview-unavailable",
    );
  });

  it("fails configuration preview and apply closed when the document is invalid", () => {
    const createId = vi.fn(() => "operation_unused");
    render(
      <TestProvider
        catalog={awsEditorCatalog}
        createId={createId}
        document={{ schemaVersion: 99 }}
        iconRegistry={awsIconRegistry}
      >
        <ConfigurationSessionProbe />
      </TestProvider>,
    );

    expect(
      screen.getByTestId("configuration-session-status"),
    ).toHaveTextContent("invalid");
    fireEvent.click(
      screen.getByRole("button", { name: "Preview configuration" }),
    );
    expect(screen.getByTestId("configuration-last-preview")).toHaveTextContent(
      "document-unavailable:0",
    );
    expect(screen.getByTestId("configuration-announcement")).toHaveTextContent(
      "Configuration could not be previewed because no valid architecture is loaded.",
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Apply configuration" }),
    );
    expect(screen.getByTestId("configuration-last-apply")).toHaveTextContent(
      "document-unavailable",
    );
    expect(screen.getByTestId("configuration-announcement")).toHaveTextContent(
      "Configuration could not be applied because no valid architecture is loaded.",
    );
    expect(createId).not.toHaveBeenCalled();
  });

  it("previews automatic layout without mutating hashes, then applies only positions", async () => {
    let sequence = 0;
    const layoutAdapter: LayoutAdapter = {
      layout: vi.fn((request: LayoutRequest) =>
        Promise.resolve(layoutResultFor(request)),
      ),
    };
    render(
      <TestProvider
        createId={() => {
          sequence += 1;
          return `operation_layout_session_${String(sequence).padStart(4, "0")}`;
        }}
        layoutAdapter={layoutAdapter}
      >
        <LayoutSessionProbe />
      </TestProvider>,
    );
    const contentHash = screen.getByTestId("layout-content-hash").textContent;
    const visualHash = screen.getByTestId("layout-visual-hash").textContent;
    const applicationPosition = screen.getByTestId(
      "layout-application-position",
    ).textContent;

    fireEvent.click(
      screen.getByRole("button", { name: "Start automatic layout" }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("layout-status")).toHaveTextContent("preview");
    });
    expect(screen.getByTestId("layout-preview-position")).toHaveTextContent(
      "48,168",
    );
    expect(screen.getByTestId("layout-change-count")).not.toHaveTextContent(
      "0",
    );
    expect(screen.getByTestId("layout-content-hash").textContent).toBe(
      contentHash,
    );
    expect(screen.getByTestId("layout-visual-hash").textContent).toBe(
      visualHash,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Apply automatic layout" }),
    );

    expect(screen.getByTestId("layout-status")).toHaveTextContent("idle");
    expect(screen.getByTestId("layout-preview-position")).toHaveTextContent(
      "none",
    );
    expect(screen.getByTestId("layout-content-hash").textContent).toBe(
      contentHash,
    );
    expect(screen.getByTestId("layout-visual-hash").textContent).not.toBe(
      visualHash,
    );
    expect(screen.getByTestId("layout-application-position")).toHaveTextContent(
      "48,168",
    );
    expect(screen.getByTestId("layout-history-state")).toHaveTextContent(
      "true|false|Arrange architecture",
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Undo layout history" }),
    );
    expect(screen.getByTestId("layout-application-position").textContent).toBe(
      applicationPosition,
    );
    expect(screen.getByTestId("layout-content-hash").textContent).toBe(
      contentHash,
    );
    expect(screen.getByTestId("layout-visual-hash").textContent).toBe(
      visualHash,
    );
    expect(screen.getByTestId("layout-history-state")).toHaveTextContent(
      "false|true|none|Arrange architecture",
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Redo layout history" }),
    );
    expect(screen.getByTestId("layout-application-position")).toHaveTextContent(
      "48,168",
    );
    expect(screen.getByTestId("layout-content-hash").textContent).toBe(
      contentHash,
    );
    expect(screen.getByTestId("layout-visual-hash").textContent).not.toBe(
      visualHash,
    );
  });

  it("cancels an in-flight layout as a no-op and discards a late result", async () => {
    let resolveLayout: ((result: LayoutResult) => void) | undefined;
    let capturedRequest: LayoutRequest | undefined;
    const layoutAdapter: LayoutAdapter = {
      layout: vi.fn(
        (request: LayoutRequest) =>
          new Promise<LayoutResult>((resolve) => {
            capturedRequest = request;
            resolveLayout = resolve;
          }),
      ),
    };
    render(
      <TestProvider layoutAdapter={layoutAdapter}>
        <LayoutSessionProbe />
      </TestProvider>,
    );
    const contentHash = screen.getByTestId("layout-content-hash").textContent;
    const visualHash = screen.getByTestId("layout-visual-hash").textContent;

    fireEvent.click(
      screen.getByRole("button", { name: "Start automatic layout" }),
    );
    expect(screen.getByTestId("layout-status")).toHaveTextContent("running");
    fireEvent.click(
      screen.getByRole("button", { name: "Cancel automatic layout" }),
    );
    expect(screen.getByTestId("layout-status")).toHaveTextContent("idle");

    if (capturedRequest === undefined || resolveLayout === undefined) {
      throw new Error("The test adapter did not receive the layout request.");
    }
    resolveLayout(layoutResultFor(capturedRequest));
    await waitFor(() => {
      expect(screen.getByTestId("layout-status")).toHaveTextContent("idle");
    });

    expect(screen.getByTestId("layout-preview-position")).toHaveTextContent(
      "none",
    );
    expect(screen.getByTestId("layout-content-hash").textContent).toBe(
      contentHash,
    );
    expect(screen.getByTestId("layout-visual-hash").textContent).toBe(
      visualHash,
    );
  });
});
