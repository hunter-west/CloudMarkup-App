import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import {
  createValidationDocumentPath,
  GraphCommandApplicationError,
  parseArchitectureDocument,
  type ArchitectureDocument,
} from "@cloudmarkup/domain";
import type { ConfigurationValue } from "@cloudmarkup/schemas";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { NotificationProvider } from "../../../notifications/index.js";
import {
  ModePreferenceProvider,
  type ExperienceMode,
  type ModePreferenceStorage,
} from "../../../preferences/index.js";
import { ModeSwitch } from "../../../preferences/ModeSwitch.js";
import { awsIconRegistry } from "../../../provider-icons/aws-icon-registry.js";
import { awsEditorCatalog } from "../../../provider-catalog/aws-editor-catalog.js";
import { loadAwsEditorArchitectureDocument } from "../../../provider-catalog/aws-editor-fixture.js";
import { WorkspaceShellControllerContext } from "../../../shell/workspace-shell-context.js";
import type { InspectorTab } from "../../../shell/AppShell.js";
import * as configurationCommands from "../model/configuration-command.js";
import type { EditorCatalog } from "../model/editor-catalog.js";
import {
  foundationEditorCatalog,
  foundationIconRegistry,
  loadFoundationArchitectureDocument,
} from "../model/foundation-editor-fixture.js";
import {
  EditorSessionProvider,
  useEditorDocumentSession,
  useEditorSessionState,
  useEditorSessionStoreApi,
} from "../session/index.js";
import {
  SelectedResourceInspector,
  SelectedResourceCode,
} from "./SelectedResourceInspector.js";

function createCommandIdFactory(): () => string {
  let sequence = 0;
  return () => {
    sequence += 1;
    return `operation_inspector_component_${String(sequence).padStart(4, "0")}`;
  };
}

function createModeStorage(initialMode: ExperienceMode): ModePreferenceStorage {
  return {
    getItem: () => initialMode,
    setItem: () => undefined,
  };
}

function valueAt(
  values: unknown,
  property: string,
): Readonly<ConfigurationValue> | undefined {
  return (values as Readonly<Record<string, Readonly<ConfigurationValue>>>)[
    property
  ];
}

function InspectorTestControls() {
  const session = useEditorDocumentSession();
  const store = useEditorSessionStoreApi();
  const selection = useEditorSessionState((state) => state.selection);
  const announcement = useEditorSessionState((state) => state.liveAnnouncement);

  if (session.status !== "ready") {
    return <output data-testid="session-state">invalid</output>;
  }

  const lambda = session.document.nodes.find(
    (node) => node.semantic.serviceType === "aws.lambda.function",
  );
  const application = session.document.nodes.find(
    (node) => node.semantic.serviceType === "example.compute",
  );
  const edge = session.document.edges[0];
  const selectedNode =
    selection?.kind === "node"
      ? session.document.nodes.find((node) => node.id === selection.id)
      : undefined;
  const memory =
    lambda === undefined
      ? undefined
      : valueAt(lambda.semantic.configuration.values, "memoryMegabytes");
  const behaviorPurpose =
    session.document.applicationContracts.contracts.find(
      (contract) => contract.contractKind === "behavior-operation",
    )?.description ?? "none";

  return (
    <div>
      <button
        disabled={lambda === undefined}
        onClick={() => {
          if (lambda !== undefined) {
            store.getState().setSelection({ id: lambda.id, kind: "node" });
          }
        }}
        type="button"
      >
        Select Lambda fixture
      </button>
      <button
        disabled={application === undefined}
        onClick={() => {
          if (application !== undefined) {
            store.getState().setSelection({ id: application.id, kind: "node" });
          }
        }}
        type="button"
      >
        Select Application fixture
      </button>{" "}
      <button
        disabled={lambda === undefined}
        onClick={() => {
          if (lambda !== undefined) {
            store.getState().setSelection({ id: lambda.id, kind: "node" });
            store.getState().setValidationFocus({
              findingId: "finding_inspector_function_name",
              location: {
                key: "functionName",
                kind: "configuration",
                owner: { kind: "node", nodeId: lambda.id },
                path: createValidationDocumentPath(
                  "$.nodes[node_api_handler].semantic.configuration.values.functionName",
                ),
              },
              target: "draft",
            });
          }
        }}
        type="button"
      >
        Focus Lambda function name finding
      </button>
      {edge === undefined ? null : (
        <button
          onClick={() => {
            store.getState().setSelection({ id: edge.id, kind: "edge" });
          }}
          type="button"
        >
          Select relationship fixture
        </button>
      )}
      <output data-testid="selection">
        {selection === null ? "none" : `${selection.kind}:${selection.id}`}
      </output>
      <output data-testid="selected-parent">
        {selectedNode === undefined
          ? "unavailable"
          : (selectedNode.semantic.parent?.nodeId ?? "architecture-root")}
      </output>
      <output data-testid="selected-position">
        {selectedNode === undefined
          ? "unavailable"
          : `${String(selectedNode.presentation.position.x)}, ${String(
              selectedNode.presentation.position.y,
            )}`}
      </output>
      <output data-testid="content-hash">{session.hashes.contentHash}</output>
      <output data-testid="visual-hash">{session.hashes.visualHash}</output>
      <output data-testid="memory-value">
        {memory?.kind === "integer" ? String(memory.value) : "unavailable"}
      </output>
      <output data-testid="edge-count">
        {String(session.document.edges.length)}
      </output>
      <output data-testid="application-contract-count">
        {String(session.document.applicationContracts.contracts.length)}
      </output>
      <output data-testid="behavior-purpose">{behaviorPurpose}</output>
      <output data-testid="preview-id">
        {session.configurationPreview?.command.commandId ?? "none"}
      </output>
      <output data-testid="announcement">{announcement}</output>
      <button
        onClick={() => {
          session.undo();
        }}
        type="button"
      >
        Undo inspector change
      </button>
    </div>
  );
}

function InspectorHarness() {
  const [activeTab, setActiveTab] =
    useState<Exclude<InspectorTab, "architecture">>("configure");
  return (
    <WorkspaceShellControllerContext.Provider
      value={{
        posture: "desktop",
        overlays: {
          catalog: { open: false },
          inspector: { open: true },
          safeArea: { bottom: 0, left: 0, right: 0 },
        },
        openCatalogPanel: vi.fn(),
        openWorkspacePanel: vi.fn(),
        openRevisionPlaceholder: vi.fn(),
        focusArchitectureTarget: vi.fn(),
        openContextPanel(_target, tab) {
          if (tab && tab !== "architecture") setActiveTab(tab);
        },
      }}
    >
      <ModeSwitch />
      <InspectorTestControls />
      <section aria-label="Code workspace">
        <SelectedResourceCode />
      </section>
      <SelectedResourceInspector
        activeTab={activeTab}
        onActiveTabChange={setActiveTab}
      />
    </WorkspaceShellControllerContext.Provider>
  );
}

function renderInspector({
  catalog = awsEditorCatalog,
  document = loadAwsEditorArchitectureDocument(),
  iconRegistry = awsIconRegistry,
  mode = "guided",
}: {
  readonly catalog?: EditorCatalog;
  readonly document?: ArchitectureDocument;
  readonly iconRegistry?: typeof awsIconRegistry;
  readonly mode?: ExperienceMode;
} = {}) {
  return render(
    <NotificationProvider>
      <ModePreferenceProvider
        actorId="selected-inspector-component-test"
        storage={createModeStorage(mode)}
      >
        <EditorSessionProvider
          catalog={catalog}
          createId={createCommandIdFactory()}
          document={document}
          iconRegistry={iconRegistry}
        >
          <InspectorHarness />
        </EditorSessionProvider>
      </ModePreferenceProvider>
    </NotificationProvider>,
  );
}

function selectLambda(): void {
  fireEvent.click(
    screen.getByRole("button", { name: "Select Lambda fixture" }),
  );
}

function selectApplication(): void {
  fireEvent.click(
    screen.getByRole("button", {
      name: "Select Application fixture",
    }),
  );
}

function selectedPanel(name: string): HTMLElement {
  return screen.getByRole("tabpanel", { name });
}

function inspectorTabList(): HTMLElement {
  return screen.getByRole("tablist", { name: "Inspector sections" });
}

function inspectorTabLabels(): readonly string[] {
  return within(inspectorTabList())
    .getAllByRole("tab")
    .map((tab) => tab.textContent.trim());
}

function markupSignature(root: HTMLElement): readonly string[] {
  return [root, ...root.querySelectorAll<HTMLElement>("*")].map((element) =>
    [
      element.tagName,
      element.getAttribute("class") ?? "",
      element.getAttribute("role") ?? "",
      element.getAttribute("type") ?? "",
      element.getAttribute("aria-label") ?? "",
      element.getAttribute("href") ?? "",
    ].join("|"),
  );
}

function withLambdaTableRelationship(
  document: ArchitectureDocument,
): ArchitectureDocument {
  const lambda = document.nodes.find(
    (node) => node.semantic.serviceType === "aws.lambda.function",
  );
  const table = document.nodes.find(
    (node) => node.semantic.serviceType === "aws.dynamodb.table",
  );
  const relationship = awsEditorCatalog.relationships?.find(
    (candidate) => candidate.id === "aws.lambda.reads-dynamodb-table",
  );
  if (
    lambda === undefined ||
    table === undefined ||
    relationship === undefined
  ) {
    throw new TypeError("Expected the Lambda-to-DynamoDB catalog fixture.");
  }

  return parseArchitectureDocument({
    ...document,
    edges: [
      {
        id: "edge_lambda_table_access",
        semantic: {
          configuration: {
            schemaId: relationship.configuration.schemaId,
            schemaVersion: relationship.configuration.schemaVersion,
            values: {
              consistentRead: { kind: "boolean", value: false },
            },
          },
          lifecycle: {
            origin: "user",
            ownership: "user",
          },
          relationshipType: relationship.id,
          source: {
            nodeId: lambda.id,
            port: relationship.sourcePortId,
          },
          target: {
            nodeId: table.id,
            port: relationship.targetPortId,
          },
        },
      },
    ],
  });
}

function withGeneratedLambdaTableRelationship(
  document: ArchitectureDocument,
): ArchitectureDocument {
  const connected = withLambdaTableRelationship(document);
  return parseArchitectureDocument({
    ...connected,
    edges: connected.edges.map((edge) => ({
      ...edge,
      semantic: {
        ...edge.semantic,
        lifecycle: {
          origin: "connection-rule",
          ownership: "generated",
          provenance: {
            dependentEdgeIds: [],
            dependentNodeIds: [
              edge.semantic.source.nodeId,
              edge.semantic.target.nodeId,
            ],
            generatorId: "aws.lambda.reads-dynamodb-table",
            generatorKind: "connection-rule",
            generatorVersion: "1.0.0",
            operationId: "generated_connection_fixture",
          },
        },
      },
    })),
  });
}

function withTwoLambdaTriggers(
  document: ArchitectureDocument,
  triggerDispatch: ArchitectureDocument["workloadBehavior"]["workloads"][number]["triggerDispatch"],
): ArchitectureDocument {
  const lambda = document.nodes.find(
    (node) => node.semantic.serviceType === "aws.lambda.function",
  );
  const source = document.nodes.find(
    (node) => node.semantic.serviceType === "aws.cognito.user-pool",
  );
  const workload = document.workloadBehavior.workloads.find(
    (candidate) => candidate.owningNodeId === lambda?.id,
  );
  if (lambda === undefined || source === undefined || workload === undefined) {
    throw new TypeError("Expected the Lambda workload trigger fixture.");
  }
  const triggerEdges = ["edge_trigger_one", "edge_trigger_two"].map(
    (edgeId, index) => ({
      id: edgeId,
      semantic: {
        configuration: {
          schemaId: "aws.test.trigger-connection",
          schemaVersion: "1.0.0",
          values: {},
        },
        lifecycle: {
          origin: "user" as const,
          ownership: "user" as const,
        },
        relationshipType: `aws.test.invokes-lambda-${String(index + 1)}`,
        source: {
          nodeId: source.id,
          port: `aws.test.trigger-${String(index + 1)}`,
        },
        target: {
          nodeId: lambda.id,
          port: "aws.lambda.function.synchronous-invocation",
        },
      },
    }),
  );

  return parseArchitectureDocument({
    ...document,
    edges: [...document.edges, ...triggerEdges],
    workloadBehavior: {
      ...document.workloadBehavior,
      workloads: document.workloadBehavior.workloads.map((candidate) =>
        candidate.id === workload.id
          ? {
              ...candidate,
              triggerDispatch,
              triggers: triggerEdges.map((edge, index) => ({
                edgeId: edge.id,
                id: `trigger_binding_${String(index + 1)}`,
                targetOperationId: "operation_handle_request",
              })),
            }
          : candidate,
      ),
    },
  });
}

function withDistantApplicationAtRoot(
  document: ArchitectureDocument,
): ArchitectureDocument {
  return parseArchitectureDocument({
    ...document,
    nodes: document.nodes.map((node) =>
      node.id === "node_application"
        ? {
            ...node,
            semantic: {
              configuration: node.semantic.configuration,
              deploymentKey: node.semantic.deploymentKey,
              lifecycle: node.semantic.lifecycle,
              resourceType: node.semantic.resourceType,
              serviceType: node.semantic.serviceType,
            },
            presentation: {
              ...node.presentation,
              position: {
                x: 10_000,
                y: 10_000,
              },
            },
          }
        : node,
    ),
  });
}

describe("SelectedResourceInspector", () => {
  it("reviews, cancels, deletes, and undoes a selected service", () => {
    renderInspector({
      catalog: foundationEditorCatalog,
      document: loadFoundationArchitectureDocument(),
      iconRegistry: foundationIconRegistry,
    });
    selectApplication();
    const deleteService = screen.getByRole("button", {
      name: "Delete service",
    });
    expect(
      selectedPanel("Configure").compareDocumentPosition(deleteService) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
    expect(deleteService.closest(".selected-inspector__overview")).toBeNull();
    fireEvent.click(deleteService);
    let dialog = screen.getByRole("dialog", { name: "Delete Application?" });
    expect(dialog).toHaveTextContent("2 connected relationships");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.getByTestId("selection")).toHaveTextContent(
      "node:node_application",
    );
    expect(screen.getByTestId("edge-count")).toHaveTextContent("2");

    fireEvent.click(screen.getByRole("button", { name: "Delete service" }));
    dialog = screen.getByRole("dialog", { name: "Delete Application?" });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Delete service" }),
    );
    expect(screen.getByTestId("selection")).toHaveTextContent("none");
    expect(screen.getByTestId("edge-count")).toHaveTextContent("0");
    expect(screen.getByTestId("announcement")).toHaveTextContent(
      "Undo is available",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Undo inspector change" }),
    );
    expect(screen.getByTestId("edge-count")).toHaveTextContent("2");
  });

  it("keeps selected context collapsed while inspector tabs stay available", () => {
    renderInspector();
    selectLambda();

    const title = screen.getByText("Notes API handler", {
      selector: ".selected-inspector__identity-title",
    });
    const summary = title.closest("summary");
    const details = summary?.closest("details");
    if (summary === null || details === null || details === undefined) {
      throw new Error("Expected the selected-resource disclosure to render.");
    }
    const placementHeading = within(details).getByText(
      "Choose where this resource belongs",
    );

    expect(details).not.toHaveAttribute("open");
    expect(summary).toHaveAccessibleName(
      /Selected architecture element details:.*Lambda function\.\s*Notes API handler/u,
    );
    expect(placementHeading).not.toBeVisible();
    expect(screen.getByRole("tab", { name: "Configure" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(selectedPanel("Configure")).toBeVisible();

    summary.focus();
    expect(summary).toHaveFocus();
    fireEvent.click(summary);
    expect(details).toHaveAttribute("open");
    expect(placementHeading).toBeVisible();

    fireEvent.click(summary);
    expect(details).not.toHaveAttribute("open");
    expect(selectedPanel("Configure")).toBeVisible();
  });

  it("selects a node without mutation, renders schema fields, and applies only the prepared command", async () => {
    renderInspector();
    const initialContentHash = screen.getByTestId("content-hash").textContent;
    const initialVisualHash = screen.getByTestId("visual-hash").textContent;

    expect(
      within(selectedPanel("Configure")).getByRole("heading", {
        name: "No resource selected",
      }),
    ).toBeVisible();
    selectLambda();

    expect(screen.getByTestId("selection")).toHaveTextContent(
      "node:node_api_handler",
    );
    expect(
      screen.getByRole("heading", {
        name: "Configure Notes API handler",
      }),
    ).toBeVisible();
    expect(screen.getByTestId("content-hash").textContent).toBe(
      initialContentHash,
    );
    expect(screen.getByTestId("visual-hash").textContent).toBe(
      initialVisualHash,
    );

    const memory = screen.getByLabelText(/^Memory \(MB\)/u);
    expect(memory).toHaveValue(256);
    expect(memory).toHaveAttribute("type", "number");
    expect(
      screen.getByRole("checkbox", { name: /Enable active tracing/u }),
    ).toBeChecked();
    fireEvent.change(memory, { target: { value: "512" } });
    fireEvent.click(screen.getByRole("button", { name: "Review changes" }));

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "Review before applying" }),
      ).toBeVisible();
    });
    expect(screen.getByTestId("preview-id")).not.toHaveTextContent("none");
    expect(screen.getByTestId("memory-value")).toHaveTextContent("256");
    expect(screen.getByTestId("content-hash").textContent).toBe(
      initialContentHash,
    );
    expect(selectedPanel("Configure")).toHaveTextContent(
      "Visual layoutUnchanged",
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Apply configuration" }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("memory-value")).toHaveTextContent("512");
    });
    expect(screen.getByTestId("content-hash").textContent).not.toBe(
      initialContentHash,
    );
    expect(screen.getByTestId("visual-hash").textContent).toBe(
      initialVisualHash,
    );
    expect(screen.getByTestId("preview-id")).toHaveTextContent("none");
    expect(screen.getByTestId("announcement")).toHaveTextContent(
      "Configuration applied through the prepared Graph Command.",
    );
  });

  it("keeps an unavailable saved choice visible until the user corrects it", async () => {
    const source = loadAwsEditorArchitectureDocument();
    const document = parseArchitectureDocument({
      ...source,
      nodes: source.nodes.map((node) =>
        node.semantic.serviceType === "aws.lambda.function"
          ? {
              ...node,
              semantic: {
                ...node.semantic,
                configuration: {
                  ...node.semantic.configuration,
                  values: {
                    ...node.semantic.configuration.values,
                    runtime: { kind: "string", value: "retired-runtime" },
                  },
                },
              },
            }
          : node,
      ),
    });
    renderInspector({ document });
    selectLambda();
    const initialHash = screen.getByTestId("content-hash").textContent;
    const runtime = screen.getByRole("combobox", { name: /^Runtime/u });
    expect(runtime).toHaveValue("retired-runtime");
    expect(
      within(runtime).getByRole("option", { selected: true }),
    ).toHaveTextContent("Unavailable: retired-runtime");
    fireEvent.click(screen.getByRole("button", { name: "Review changes" }));
    expect(await screen.findByRole("alert")).toBeVisible();
    expect(screen.getByTestId("preview-id")).toHaveTextContent("none");
    expect(screen.getByTestId("content-hash").textContent).toBe(initialHash);

    fireEvent.change(runtime, { target: { value: "nodejs24.x" } });
    fireEvent.click(screen.getByRole("button", { name: "Review changes" }));
    expect(
      await screen.findByRole("heading", { name: "Review before applying" }),
    ).toBeVisible();
    expect(screen.getByTestId("content-hash").textContent).toBe(initialHash);
  });

  it("keeps a failed stale-preview error visible after the preview is invalidated", async () => {
    const apply = vi
      .spyOn(configurationCommands, "applyPreparedConfigurationCommand")
      .mockImplementationOnce(() => {
        throw new GraphCommandApplicationError([
          {
            code: "precondition_failed",
            message: "The selected configuration changed.",
            path: "$.expectedConfiguration",
          },
        ]);
      });
    renderInspector();
    selectLambda();

    fireEvent.change(screen.getByLabelText(/^Memory \(MB\)/u), {
      target: { value: "512" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Review changes" }));
    await screen.findByRole("heading", { name: "Review before applying" });

    fireEvent.click(
      screen.getByRole("button", { name: "Apply configuration" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Configuration changed after this preview. Review the latest values and preview again.",
    );
    expect(screen.getByTestId("preview-id")).toHaveTextContent("none");
    expect(screen.getByTestId("memory-value")).toHaveTextContent("256");
    apply.mockRestore();
  });

  it("supports automatic keyboard tab activation with associated panels", () => {
    renderInspector();
    selectLambda();

    expect(inspectorTabList().closest(".cm-tabs")).toHaveAttribute(
      "data-size",
      "compact",
    );
    expect(inspectorTabLabels()).toEqual(["Configure", "Connect", "Learn"]);

    const configure = screen.getByRole("tab", { name: "Configure" });
    configure.focus();
    fireEvent.keyDown(configure, { key: "ArrowRight" });

    const connect = screen.getByRole("tab", { name: "Connect" });
    expect(connect).toHaveFocus();
    expect(connect).toHaveAttribute("aria-selected", "true");
    expect(selectedPanel("Connect")).not.toHaveTextContent(
      "How is compatibility determined?",
    );
    const configurePanelId = configure.getAttribute("aria-controls");
    expect(configurePanelId).not.toBeNull();
    expect(document.getElementById(configurePanelId ?? "")).not.toBeVisible();

    fireEvent.keyDown(connect, { key: "End" });
    expect(screen.getByRole("tab", { name: "Learn" })).toHaveFocus();
    expect(selectedPanel("Learn")).toBeVisible();
    expect(inspectorTabLabels()).toEqual(["Configure", "Connect", "Learn"]);
  });

  it("keeps workload readiness evidence and disclosure state stable across a live mode switch", () => {
    renderInspector();
    selectLambda();

    const configurePanel = selectedPanel("Configure");
    const implementation = within(configurePanel).getByRole("region", {
      name: "Implementation readiness",
    });
    expect(within(implementation).queryByText("Technical details")).toBeNull();
    const guidedMarkup = markupSignature(implementation);

    expect(inspectorTabLabels()).toEqual(["Configure", "Connect", "Learn"]);
    expect(implementation).toHaveTextContent("User-provided implementation");
    expect(implementation).toHaveTextContent(
      "aws.lambda.runtime-family.nodejs24",
    );
    expect(implementation).toHaveTextContent("index.handler");
    expect(implementation).toHaveTextContent(
      "User-owned application code is required.",
    );
    expect(implementation).toHaveTextContent(
      "Review available options when exporting a saved revision.",
    );
    expect(implementation).toHaveTextContent("No trigger binding is declared.");

    fireEvent.click(screen.getByRole("button", { name: "Professional" }));

    expect(selectedPanel("Configure")).toBe(configurePanel);
    expect(
      within(configurePanel).getByRole("region", {
        name: "Implementation readiness",
      }),
    ).toBe(implementation);
    expect(within(implementation).queryByText("Technical details")).toBeNull();
    expect(markupSignature(implementation)).toEqual(guidedMarkup);
    expect(inspectorTabLabels()).toEqual(["Configure", "Connect", "Learn"]);
  });

  it("previews, applies, and undoes strict workload purpose and I/O contracts", async () => {
    renderInspector();
    selectLambda();
    const initialContentHash = screen.getByTestId("content-hash").textContent;
    const initialVisualHash = screen.getByTestId("visual-hash").textContent;
    const implementationSummary = screen
      .getByText("Implementation", { selector: "span" })
      .closest("summary");
    if (implementationSummary === null) {
      throw new Error("Expected implementation disclosure summary.");
    }
    fireEvent.click(implementationSummary);
    expect(
      screen.getByRole("heading", { name: "Application function" }),
    ).toBeVisible();
    fireEvent.click(screen.getByText("Inputs and outputs (optional)"));

    expect(screen.getByLabelText(/^Purpose/u)).toBeVisible();
    expect(screen.getByLabelText(/^Operation name/u)).toHaveValue(
      "Notes API handler behavior",
    );
    fireEvent.change(screen.getByLabelText(/^Purpose/u), {
      target: {
        value: "Validate a note request and return its stable identifier.",
      },
    });
    fireEvent.change(screen.getByLabelText(/^Inputs/u), {
      target: { value: "noteId:uuid:internal:required" },
    });
    fireEvent.change(screen.getByLabelText(/^Outputs/u), {
      target: { value: "accepted:boolean:internal:required" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Preview purpose and I/O" }),
    );

    expect(
      await screen.findByLabelText("Prepared workload operation"),
    ).toHaveTextContent("1 input and 1 output fields");
    expect(screen.getByTestId("application-contract-count")).toHaveTextContent(
      "0",
    );
    expect(screen.getByTestId("content-hash").textContent).toBe(
      initialContentHash,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Apply purpose and I/O" }),
    );
    await waitFor(() => {
      expect(
        screen.getByTestId("application-contract-count"),
      ).toHaveTextContent("3");
    });
    expect(screen.getByTestId("behavior-purpose")).toHaveTextContent(
      "Validate a note request and return its stable identifier.",
    );
    expect(screen.getByTestId("content-hash").textContent).not.toBe(
      initialContentHash,
    );
    expect(screen.getByTestId("visual-hash").textContent).toBe(
      initialVisualHash,
    );
    expect(screen.getByTestId("announcement")).toHaveTextContent(
      "Workload purpose and I/O applied through one atomic Graph Command.",
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Undo inspector change" }),
    );
    await waitFor(() => {
      expect(
        screen.getByTestId("application-contract-count"),
      ).toHaveTextContent("0");
    });
    expect(screen.getByTestId("content-hash").textContent).toBe(
      initialContentHash,
    );
  });

  it("rejects secret-shaped purpose values without reflecting the value", async () => {
    renderInspector();
    selectLambda();
    const implementationSummary = screen
      .getByText("Implementation", { selector: "span" })
      .closest("summary");
    if (implementationSummary === null) {
      throw new Error("Expected implementation disclosure summary.");
    }
    fireEvent.click(implementationSummary);
    const sensitive = "must-never-render";
    fireEvent.change(screen.getByLabelText(/^Purpose/u), {
      target: { value: `Handle notes with password=${sensitive}` },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Preview purpose and I/O" }),
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "Credential or secret values are not accepted.",
    );
    expect(alert).not.toHaveTextContent(sensitive);
    expect(screen.getByTestId("application-contract-count")).toHaveTextContent(
      "0",
    );
  });
  it("reviews infrastructure-only setup for an older function and undoes it completely", async () => {
    const source = loadAwsEditorArchitectureDocument();
    renderInspector({
      document: parseArchitectureDocument({
        ...source,
        workloadBehavior: { ...source.workloadBehavior, workloads: [] },
      }),
    });
    selectLambda();
    const before = screen.getByTestId("content-hash").textContent;
    fireEvent.click(
      screen.getByRole("button", { name: "Set up infrastructure-only export" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Set up infrastructure-only export",
    });
    expect(dialog).toHaveTextContent(
      "Application code must be supplied before deployment",
    );
    expect(screen.getByTestId("content-hash").textContent).toBe(before);
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.getByTestId("content-hash").textContent).toBe(before);
    fireEvent.click(
      screen.getByRole("button", { name: "Set up infrastructure-only export" }),
    );
    fireEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Apply to draft",
      }),
    );
    await waitFor(() => {
      expect(screen.getByTestId("content-hash").textContent).not.toBe(before);
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Undo inspector change" }),
    );
    await waitFor(() => {
      expect(screen.getByTestId("content-hash").textContent).toBe(before);
    });
  });

  it("keeps unavailable capability explanations in Learn rather than connection actions", () => {
    renderInspector();
    selectLambda();
    fireEvent.click(screen.getByRole("tab", { name: "Connect" }));
    expect(selectedPanel("Connect")).not.toHaveTextContent(
      "Unavailable capabilities",
    );
    fireEvent.click(screen.getByRole("tab", { name: "Learn" }));
    const learn = selectedPanel("Learn");
    expect(learn).toHaveTextContent("How is compatibility determined?");
    const before = markupSignature(learn);
    fireEvent.click(screen.getByRole("button", { name: "Professional" }));
    expect(markupSignature(learn)).toEqual(before);
  });

  it("recommends separating multiple triggers only when dispatch remains single", () => {
    const sourceDocument = loadAwsEditorArchitectureDocument();
    const dispatcherOperationId =
      sourceDocument.workloadBehavior.workloads[0]?.operations[0]?.id;
    if (dispatcherOperationId === undefined) {
      throw new TypeError("Expected the Lambda workload operation fixture.");
    }
    renderInspector({
      document: withTwoLambdaTriggers(sourceDocument, { mode: "single" }),
    });
    selectLambda();
    expect(selectedPanel("Configure")).toHaveTextContent(
      "Separate functions are safer when their event contracts differ",
    );

    cleanup();
    renderInspector({
      document: withTwoLambdaTriggers(sourceDocument, {
        dispatcherOperationId,
        mode: "user-provided",
      }),
    });
    selectLambda();
    expect(selectedPanel("Configure")).not.toHaveTextContent(
      "Separate functions are safer",
    );
  });

  it("preserves unsaved values while Guided and Professional presentation changes", () => {
    renderInspector();
    selectLambda();
    const initialContentHash = screen.getByTestId("content-hash").textContent;
    const functionName = screen.getByLabelText(/^Function name/u);
    const guidedTabLabels = inspectorTabLabels();
    const guidedTabSize = inspectorTabList()
      .closest(".cm-tabs")
      ?.getAttribute("data-size");
    const advancedSummary = screen.getByText(/^Optional settings \(7\)/u, {
      selector: "summary",
    });
    const advanced = advancedSummary.closest("details");
    if (advanced === null) {
      throw new Error("Expected the advanced configuration disclosure.");
    }
    const guidedAdvancedLabels = [...advanced.querySelectorAll("label")].map(
      (label) => label.textContent,
    );
    expect(advanced).not.toHaveAttribute("open");
    fireEvent.click(advancedSummary);
    expect(advanced).toHaveAttribute("open");

    fireEvent.change(functionName, {
      target: { value: "notes-api-handler-edited" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Professional" }));

    expect(
      screen.getByRole("button", { name: "Professional" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(inspectorTabLabels()).toEqual(guidedTabLabels);
    expect(
      inspectorTabList().closest(".cm-tabs")?.getAttribute("data-size"),
    ).toBe(guidedTabSize);
    expect(screen.getByLabelText(/^Function name/u)).toHaveValue(
      "notes-api-handler-edited",
    );
    const professionalAdvancedSummary = screen.getByText(
      /^Optional settings \(7\)/u,
      { selector: "summary" },
    );
    expect(professionalAdvancedSummary).toBe(advancedSummary);
    expect(professionalAdvancedSummary.closest("details")).toBe(advanced);
    expect(advanced).toHaveAttribute("open");
    expect(
      [...advanced.querySelectorAll("label")].map((label) => label.textContent),
    ).toEqual(guidedAdvancedLabels);

    fireEvent.click(screen.getByRole("button", { name: "Guided" }));
    expect(
      screen.getByText(/^Optional settings \(7\)/u, {
        selector: "summary",
      }),
    ).toBe(advancedSummary);
    expect(advanced).toHaveAttribute("open");

    expect(screen.getByLabelText(/^Function name/u)).toHaveValue(
      "notes-api-handler-edited",
    );
    expect(screen.getByTestId("content-hash").textContent).toBe(
      initialContentHash,
    );
  });

  it("keeps boundary controls and progressive disclosures stable across modes", async () => {
    renderInspector({
      catalog: foundationEditorCatalog,
      document: loadFoundationArchitectureDocument(),
      iconRegistry: foundationIconRegistry,
    });
    selectApplication();

    const placement = screen.getByRole("region", {
      name: "Boundary placement",
    });
    const helpTrigger = within(placement).getByRole("button", {
      name: "More information about boundary placement",
    });
    fireEvent.click(helpTrigger);
    const boundaryHelp = selectedPanel("Learn");
    fireEvent.click(
      within(boundaryHelp).getByText("Placement and connection guidance", {
        selector: "summary",
      }),
    );
    expect(boundaryHelp).toHaveTextContent(
      "Boundaries group related resources.",
    );
    expect(boundaryHelp).toHaveTextContent(
      "moving a service visually does not change its configuration.",
    );

    expect(within(placement).queryByText("Technical details")).toBeNull();

    const select = screen.getByRole("combobox", {
      name: "Place this resource",
    });
    const optionEvidence = within(select)
      .getAllByRole("option")
      .map((option) => ({
        label: option.textContent,
        value: option.getAttribute("value"),
      }));
    expect(optionEvidence.map((option) => option.value)).toEqual([
      "root:",
      "node:node_zone",
    ]);
    expect(select).toHaveValue("node:node_zone");

    fireEvent.change(select, { target: { value: "root:" } });
    const guidedMarkup = markupSignature(placement);
    fireEvent.click(screen.getByRole("button", { name: "Professional" }));

    expect(screen.getByRole("region", { name: "Boundary placement" })).toBe(
      placement,
    );
    expect(screen.getByRole("combobox", { name: "Place this resource" })).toBe(
      select,
    );
    expect(select).toHaveValue("root:");
    expect(
      within(select)
        .getAllByRole("option")
        .map((option) => ({
          label: option.textContent,
          value: option.getAttribute("value"),
        })),
    ).toEqual(optionEvidence);
    expect(
      within(placement).getByRole("button", {
        name: "More information about boundary placement",
      }),
    ).toBe(helpTrigger);
    expect(selectedPanel("Learn")).toBe(boundaryHelp);
    expect(within(placement).queryByText("Technical details")).toBeNull();
    expect(markupSignature(placement)).toEqual(guidedMarkup);

    fireEvent.click(screen.getByRole("button", { name: "Apply placement" }));

    await waitFor(() => {
      expect(screen.getByTestId("selected-parent")).toHaveTextContent(
        "architecture-root",
      );
    });
    expect(screen.getByTestId("selected-position")).toHaveTextContent(
      "160, 360",
    );
    expect(screen.getByTestId("announcement")).toHaveTextContent(
      "Node placed at the architecture root.",
    );

    fireEvent.click(screen.getByRole("button", { name: "Guided" }));
    const selectAfterApply = screen.getByRole("combobox", {
      name: "Place this resource",
    });
    fireEvent.change(selectAfterApply, {
      target: { value: "node:node_zone" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply placement" }));

    await waitFor(() => {
      expect(screen.getByTestId("selected-parent")).toHaveTextContent(
        "node_zone",
      );
    });
    expect(screen.getByTestId("selected-position")).toHaveTextContent(
      "32, 160",
    );
  });
  it("places a distant root resource into the next readable non-drag boundary slot", async () => {
    renderInspector({
      catalog: foundationEditorCatalog,
      document: withDistantApplicationAtRoot(
        loadFoundationArchitectureDocument(),
      ),
      iconRegistry: foundationIconRegistry,
    });
    selectApplication();

    const placementSelect = screen.getByRole("combobox", {
      name: "Place this resource",
    });
    expect(placementSelect).toHaveValue("root:");
    expect(
      within(placementSelect)
        .getAllByRole("option")
        .map((option) => option.getAttribute("value")),
    ).toEqual(["root:", "node:node_zone"]);
    fireEvent.change(placementSelect, {
      target: { value: "node:node_zone" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply placement" }));

    await waitFor(() => {
      expect(screen.getByTestId("selected-parent")).toHaveTextContent(
        "node_zone",
      );
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(placementSelect).not.toHaveAttribute("aria-invalid", "true");
    expect(screen.getByTestId("selected-position")).toHaveTextContent(
      "32, 160",
    );
    expect(screen.getByTestId("announcement")).toHaveTextContent(
      "Node placed inside the selected boundary.",
    );
  });

  it("renders catalog education as inert text and permits only HTTPS official links", () => {
    const maliciousSummary =
      '<img src="invalid" onerror="window.__unsafe = true"> is text.';
    const maliciousExplanation =
      "<script>window.__unsafe = true</script> stays visible as text.";
    const catalog: EditorCatalog = {
      ...awsEditorCatalog,
      services: awsEditorCatalog.services.map((service) =>
        service.serviceType === "aws.lambda.function"
          ? {
              ...service,
              education: {
                ...service.education,
                documentation: [
                  {
                    href: "javascript:window.__unsafe=true",
                    kind: "official" as const,
                    title: "Unsafe documentation",
                  },
                  {
                    href: "https://example.com/safe-official-docs",
                    kind: "official" as const,
                    title: "Safe official documentation",
                  },
                ],
                guidedExplanation: maliciousExplanation,
                summary: maliciousSummary,
              },
            }
          : service,
      ),
    };
    const { container } = renderInspector({ catalog });
    selectLambda();
    fireEvent.click(screen.getByRole("tab", { name: "Learn" }));
    const panel = selectedPanel("Learn");

    expect(within(panel).getByText(maliciousSummary)).toBeVisible();
    expect(within(panel).getByText(maliciousExplanation)).toBeVisible();
    expect(panel.querySelector("img")).toBeNull();
    expect(panel.querySelector("script")).toBeNull();
    expect(
      within(panel).queryByRole("link", {
        name: /Unsafe documentation/u,
      }),
    ).not.toBeInTheDocument();
    expect(
      within(panel).getByRole("link", {
        name: /Safe official documentation/u,
      }),
    ).toHaveAttribute("href", "https://example.com/safe-official-docs");
    expect(
      container.querySelector('a[href^="javascript:"]'),
    ).not.toBeInTheDocument();
  });

  it("shows record-level catalog validation failures without creating a preview", async () => {
    const catalog: EditorCatalog = {
      ...awsEditorCatalog,
      services: awsEditorCatalog.services.map((service) =>
        service.serviceType === "aws.lambda.function"
          ? {
              ...service,
              configuration: {
                ...service.configuration,
                validate: () => ({
                  issues: [
                    {
                      code: "validation-unavailable" as const,
                      message:
                        "The exact catalog validator is unavailable for this configuration.",
                      path: "$.values",
                      property: undefined,
                    },
                  ],
                  success: false as const,
                }),
              },
            }
          : service,
      ),
    };
    renderInspector({ catalog });
    selectLambda();
    const initialHash = screen.getByTestId("content-hash").textContent;

    fireEvent.click(screen.getByRole("button", { name: "Review changes" }));

    expect(
      await screen.findByText(
        "The exact catalog validator is unavailable for this configuration.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId("preview-id")).toHaveTextContent("none");
    expect(screen.getByTestId("content-hash").textContent).toBe(initialHash);
  });

  it("opens advanced errors and lets their summary link focus the invalid field", async () => {
    renderInspector();
    selectLambda();
    const advanced = screen
      .getByText(/^Optional settings \(7\)/u, { selector: "summary" })
      .closest("details");
    expect(advanced).not.toHaveAttribute("open");

    const concurrency = screen.getByLabelText(/^Reserved concurrency/u);
    fireEvent.change(concurrency, { target: { value: "-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Review changes" }));

    await waitFor(() => {
      expect(advanced).toHaveAttribute("open");
    });
    const errorLink = screen.getByRole("link", {
      name: /Reserved concurrency/u,
    });
    fireEvent.click(errorLink);
    await waitFor(() => {
      expect(concurrency).toHaveFocus();
    });
    expect(screen.getByTestId("preview-id")).toHaveTextContent("none");
  });

  it("groups actionable capability starts without inferring target relationships", () => {
    const declared = awsEditorCatalog.relationships?.[0];
    if (declared === undefined) {
      throw new TypeError("Expected at least one catalog relationship.");
    }
    const catalog: EditorCatalog = {
      ...awsEditorCatalog,
      relationships: [
        ...(awsEditorCatalog.relationships ?? []),
        {
          ...declared,
          descriptorId: "synthetic.relationship.descriptor",
          displayName: "Must not infer this relationship",
          id: "synthetic.relationship.compatible-looking",
          sourceServiceType: "aws.lambda.function",
          targetServiceType: "aws.dynamodb.table",
        },
      ],
    };
    renderInspector({ catalog });
    selectLambda();
    const initialHash = screen.getByTestId("content-hash").textContent;
    fireEvent.click(screen.getByRole("tab", { name: "Connect" }));
    const panel = selectedPanel("Connect");

    expect(
      within(panel).getByRole("heading", {
        name: "No existing connections",
      }),
    ).toBeVisible();
    expect(panel).not.toHaveTextContent("Must not infer this relationship");
    const actions = within(panel).getByRole("region", {
      name: "Available connection actions",
    });
    const optionsSummary = within(actions).getByText(
      /^Connection options \(\d+\)$/u,
      { selector: "summary" },
    );
    const optionsDetails = optionsSummary.closest("details");
    expect(optionsDetails).not.toHaveAttribute("open");
    fireEvent.click(optionsSummary);
    expect(optionsDetails).toHaveAttribute("open");
    expect(
      within(actions)
        .getAllByRole("heading", { level: 5 })
        .map((heading) => heading.textContent),
    ).toEqual([
      "Receives events from",
      "Reads or writes data",
      "Sends messages or events",
      "Invokes another workload",
      "Network and security",
      "Observability",
    ]);
    const connectAction = within(actions).getByRole("button", {
      name: "Connect Notes API handler using Data read output capability",
    });
    const guidedMarkup = markupSignature(actions);
    expect(connectAction).toBeEnabled();
    expect(actions).toHaveTextContent(
      "Requests bounded read access to a connected data store.",
    );

    fireEvent.click(screen.getByRole("button", { name: "Professional" }));

    expect(selectedPanel("Connect")).toBe(panel);
    expect(
      within(panel).getByRole("region", {
        name: "Available connection actions",
      }),
    ).toBe(actions);
    expect(
      within(actions).getByRole("button", {
        name: "Connect Notes API handler using Data read output capability",
      }),
    ).toBe(connectAction);
    expect(markupSignature(actions)).toEqual(guidedMarkup);

    fireEvent.click(
      within(panel).getByRole("button", {
        name: "Connect Notes API handler using Data read output capability",
      }),
    );

    expect(screen.getByTestId("announcement")).toHaveTextContent(
      "The version-bound connection engine is not available.",
    );
    expect(screen.getByTestId("edge-count")).toHaveTextContent("0");
    expect(screen.getByTestId("content-hash").textContent).toBe(initialHash);
  });

  it("keeps exact relationship, cardinality, and permission evidence stable across modes", () => {
    const document = withLambdaTableRelationship(
      loadAwsEditorArchitectureDocument(),
    );
    const relationship = awsEditorCatalog.relationships?.find(
      (candidate) => candidate.id === "aws.lambda.reads-dynamodb-table",
    );
    if (relationship === undefined) {
      throw new TypeError("Expected the Lambda-to-DynamoDB descriptor.");
    }
    renderInspector({ document });
    const initialHash = screen.getByTestId("content-hash").textContent;

    fireEvent.click(
      screen.getByRole("button", { name: "Select relationship fixture" }),
    );

    expect(
      screen.getByRole("heading", {
        name: `Configure ${relationship.displayName}`,
      }),
    ).toBeVisible();
    expect(
      screen.getByLabelText(/^Use strongly consistent reads/u),
    ).not.toBeChecked();

    fireEvent.click(screen.getByRole("tab", { name: "Connect" }));
    const panel = selectedPanel("Connect");
    const permissionList = within(panel).getByRole("list", {
      name: "Permission consequences",
    });
    const guidedMarkup = markupSignature(panel);
    expect(panel).toHaveTextContent("Cardinality utilization");
    expect(panel).toHaveTextContent("Rule from source");
    expect(panel).toHaveTextContent("Exact endpoint pair");
    expect(panel).toHaveTextContent("Required configuration");
    expect(panel).toHaveTextContent("Generated resources");
    expect(panel).toHaveTextContent("Permission implications");
    expect(panel).toHaveTextContent("dynamodb:GetItem, dynamodb:Query");
    expect(panel).toHaveTextContent("Resource scope: connected target.");
    expect(panel).toHaveTextContent("Potential missing information");
    expect(panel).toHaveTextContent(/Diagnostic [\w.-]+\./u);
    expect(panel).toHaveTextContent("Relationship lifecycle");
    expect(panel).toHaveTextContent(
      relationship.lifecycle.adoption.replaceAll("-", " "),
    );
    expect(panel).toHaveTextContent(relationship.descriptorId);

    fireEvent.click(screen.getByRole("button", { name: "Professional" }));

    expect(selectedPanel("Connect")).toBe(panel);
    expect(
      within(panel).getByRole("list", { name: "Permission consequences" }),
    ).toBe(permissionList);
    expect(markupSignature(panel)).toEqual(guidedMarkup);
    expect(screen.getByTestId("content-hash").textContent).toBe(initialHash);
  });
  it("gates editing to generated connection-rule edges", () => {
    const userOwnedDocument = withLambdaTableRelationship(
      loadAwsEditorArchitectureDocument(),
    );
    renderInspector({ document: userOwnedDocument });
    fireEvent.click(
      screen.getByRole("button", { name: "Select relationship fixture" }),
    );
    fireEvent.click(screen.getByRole("tab", { name: "Connect" }));
    const userPanel = selectedPanel("Connect");

    expect(
      within(userPanel).getByRole("button", {
        name: "Remove connection",
      }),
    ).toBeEnabled();
    expect(userPanel).toHaveTextContent(
      /Use Configure to change this connection/u,
    );
    expect(
      within(userPanel).queryByRole("button", {
        name: "Manage connection",
      }),
    ).not.toBeInTheDocument();

    cleanup();
    const generatedDocument = withGeneratedLambdaTableRelationship(
      loadAwsEditorArchitectureDocument(),
    );
    renderInspector({ document: generatedDocument });
    fireEvent.click(
      screen.getByRole("button", { name: "Select relationship fixture" }),
    );
    fireEvent.click(screen.getByRole("tab", { name: "Connect" }));
    const generatedPanel = selectedPanel("Connect");

    expect(
      within(generatedPanel).getByRole("button", {
        name: "Manage connection",
      }),
    ).toBeEnabled();
    expect(
      within(generatedPanel).queryByRole("button", {
        name: "Remove connection",
      }),
    ).not.toBeInTheDocument();
  });

  it("keeps exact and unknown connection endpoint evidence stable across modes", () => {
    const exactDocument = withLambdaTableRelationship(
      loadAwsEditorArchitectureDocument(),
    );
    renderInspector({ document: exactDocument });
    selectLambda();
    fireEvent.click(screen.getByRole("tab", { name: "Connect" }));
    const exactPanel = selectedPanel("Connect");
    const exactInformation = within(exactPanel).getByRole("button", {
      name: /More information about the connection with/u,
    });
    fireEvent.click(exactInformation);
    const exactDetails = selectedPanel("Learn");
    fireEvent.click(
      within(exactDetails).getByText("Placement and connection guidance", {
        selector: "summary",
      }),
    );
    expect(exactDetails).toHaveTextContent("aws.lambda.reads-dynamodb-table");
    expect(exactDetails).toHaveTextContent("aws.lambda.data.read");
    expect(exactDetails).toHaveTextContent("aws.dynamodb.table.table-api");
    fireEvent.click(screen.getByRole("tab", { name: "Connect" }));
    const guidedExactMarkup = markupSignature(exactPanel);
    expect(exactPanel).toHaveTextContent(
      "Connects a Lambda data-read capability to a table and generates bounded read permission.",
    );
    expect(exactPanel).toHaveTextContent("Reads or writes data");

    fireEvent.click(screen.getByRole("button", { name: "Professional" }));

    expect(selectedPanel("Connect")).toBe(exactPanel);
    expect(markupSignature(exactPanel)).toEqual(guidedExactMarkup);

    cleanup();
    const unknownDocument = parseArchitectureDocument({
      ...exactDocument,
      edges: exactDocument.edges.map((edge) => ({
        ...edge,
        semantic: {
          ...edge.semantic,
          relationshipType: "example.unknown.relationship",
        },
      })),
    });
    renderInspector({ document: unknownDocument });
    selectLambda();
    fireEvent.click(screen.getByRole("tab", { name: "Connect" }));
    const unknownPanel = selectedPanel("Connect");
    const unknownInformation = within(unknownPanel).getByRole("button", {
      name: /More information about the connection with/u,
    });
    fireEvent.click(unknownInformation);
    const unknownDetails = selectedPanel("Learn");
    fireEvent.click(
      within(unknownDetails).getByText("Placement and connection guidance", {
        selector: "summary",
      }),
    );
    expect(unknownDetails).toHaveTextContent("example.unknown.relationship");
    expect(unknownDetails).toHaveTextContent("aws.dynamodb.table.table-api");
    fireEvent.click(screen.getByRole("tab", { name: "Connect" }));
    const guidedUnknownMarkup = markupSignature(unknownPanel);
    expect(unknownPanel).toHaveTextContent(
      "Unsupported or unknown relationship",
    );

    fireEvent.click(screen.getByRole("button", { name: "Professional" }));

    expect(selectedPanel("Connect")).toBe(unknownPanel);
    expect(markupSignature(unknownPanel)).toEqual(guidedUnknownMarkup);
  });
  it("describes IaC mappings without rendering compiler output", () => {
    renderInspector({ mode: "professional" });
    selectLambda();
    const panel = screen.getByRole("region", { name: "Code workspace" });

    expect(panel).toHaveTextContent(
      "Save a revision, then export to generate and download code.",
    );
    expect(panel).toHaveTextContent("terraform");
    expect(panel).toHaveTextContent("aws_lambda_function");
    expect(panel).toHaveTextContent("cloudformation");
    expect(panel).toHaveTextContent("AWS::Lambda::Function");
    expect(within(panel).queryByText("Metadata only")).toBeNull();
    expect(within(panel).getAllByText("Export mapping available")).toHaveLength(
      2,
    );
    expect(panel).toHaveTextContent("Export limitations");
    expect(panel).toHaveTextContent("Container images and layers");
    expect(panel.querySelector("pre")).toBeNull();
    expect(panel.querySelector("code")).toBeNull();
    expect(screen.queryByRole("tab", { name: "IaC" })).toBeNull();
  });
});
