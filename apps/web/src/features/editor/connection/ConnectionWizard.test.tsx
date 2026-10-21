import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import {
  parseArchitectureDocument,
  type ArchitectureDocument,
} from "@cloudmarkup/domain";
import { awsConnectionResolverV1 } from "@cloudmarkup/provider-aws";
import type { ProviderConnectionResolverV1 } from "@cloudmarkup/provider-sdk";
import type { ConfigurationValue } from "@cloudmarkup/schemas";
import { describe, expect, it, vi } from "vitest";

import { NotificationProvider } from "../../../notifications/index.js";
import {
  ModePreferenceProvider,
  type ExperienceMode,
  type ModePreferenceStorage,
} from "../../../preferences/index.js";
import { ModeSwitch } from "../../../preferences/ModeSwitch.js";
import { RouterProvider } from "../../../routing/index.js";
import { awsIconRegistry } from "../../../provider-icons/aws-icon-registry.js";
import { awsEditorCatalog } from "../../../provider-catalog/aws-editor-catalog.js";
import { loadBlankAwsEditorArchitectureDocument } from "../../../provider-catalog/aws-editor-fixture.js";
import {
  connectionConfigurationValueText,
  type EditorConnectionStartIntent,
} from "../model/index.js";
import {
  EditorSessionProvider,
  useEditorDocumentSession,
  useEditorSessionStoreApi,
  useEditorSessionState,
} from "../session/index.js";
import { ConnectionWizard } from "./ConnectionWizard.js";
import { prepareBetaInfrastructureProposal } from "../../generation/beta-infrastructure-proposal.js";
import { applyPreparedResourceRepair } from "../model/resource-repair-command.js";

type TaggedValues = Readonly<Record<string, Readonly<ConfigurationValue>>>;

function serviceConfiguration(serviceId: string, overrides: TaggedValues = {}) {
  const service = awsEditorCatalog.services.find(
    (candidate) => candidate.serviceType === serviceId,
  );
  if (service?.configuration.defaults.kind !== "ready") {
    throw new TypeError(`Missing defaults for ${serviceId}.`);
  }
  const result = service.configuration.validate({
    ...service.configuration.defaults.values,
    ...overrides,
  });
  if (!result.success) {
    throw new TypeError(`Invalid test configuration for ${serviceId}.`);
  }
  return {
    schemaId: service.configuration.schemaId,
    schemaVersion: service.configuration.schemaVersion,
    values: result.values,
  };
}

function relationshipConfiguration(ruleId: string) {
  const relationship = awsEditorCatalog.relationships?.find(
    (candidate) => candidate.descriptorId === ruleId,
  );
  if (relationship?.configuration.defaults.kind !== "ready") {
    throw new TypeError(`Missing relationship defaults for ${ruleId}.`);
  }
  return {
    schemaId: relationship.configuration.schemaId,
    schemaVersion: relationship.configuration.schemaVersion,
    values: relationship.configuration.defaults.values,
  };
}

function testNode(
  id: string,
  serviceId: string,
  x: number,
  y: number,
  parent?: { readonly nodeId: string; readonly relationshipType: string },
) {
  const service = awsEditorCatalog.services.find(
    (candidate) => candidate.serviceType === serviceId,
  );
  if (service === undefined) {
    throw new TypeError(`Unknown test service ${serviceId}.`);
  }
  return {
    id,
    semantic: {
      deploymentKey: id,
      serviceType: service.serviceType,
      resourceType: service.resourceType,
      configuration: serviceConfiguration(serviceId),
      ...(parent === undefined ? {} : { parent }),
      lifecycle: {
        ownership: "user",
        origin: "user",
      },
    },
    presentation: {
      label: service.displayName,
      position: { x, y },
    },
  };
}

function createConnectionDocument(): ArchitectureDocument {
  return parseArchitectureDocument({
    kind: "cloudmarkup.architecture-document",
    schemaVersion: 1,
    documentId: "document_connection_wizard",
    architectureId: "architecture_connection_wizard",
    revision: {
      revisionId: "revision_connection_wizard",
      revisionNumber: 1,
      createdAt: "2026-07-29T12:00:00Z",
      createdBy: "actor_connection_wizard",
      sourceDraftId: "draft_connection_wizard",
    },
    provider: {
      id: awsEditorCatalog.providerId,
      region: "us-east-1",
    },
    catalog: {
      id: awsEditorCatalog.identity.id,
      version: awsEditorCatalog.identity.version,
      digest: awsEditorCatalog.identity.digest,
    },
    compilerCompatibility: {
      inputContractVersion: 1,
      minimumCompilerVersion: "1.0.0",
      maximumCompilerVersionExclusive: "2.0.0",
    },
    metadata: {
      source: "user",
      serialization: {
        mediaType: "application/json",
        encoding: "utf-8",
        canonicalization: "cloudmarkup.canonical-json.v1",
      },
    },
    nodes: [
      testNode("api", "aws.apigateway.http-api", 0, 0),
      testNode("lambda", "aws.lambda.function", 280, 0),
      testNode("table", "aws.dynamodb.table", 560, 0),
      testNode("role", "aws.iam.role", 280, 280),
      testNode("pool", "aws.cognito.user-pool", 0, 280),
      testNode("client", "aws.cognito.user-pool-client", 0, 560, {
        nodeId: "pool",
        relationshipType: "aws.cognito.contains-app-client",
      }),
    ],
    edges: [
      {
        id: "role_lambda",
        semantic: {
          source: {
            nodeId: "role",
            port: "aws.iam.role.assumable-role",
          },
          target: {
            nodeId: "lambda",
            port: "aws.lambda.function.execution-role",
          },
          relationshipType: "aws.iam.role-assumed-by-lambda",
          configuration: relationshipConfiguration(
            "aws.iam.role-assumed-by-lambda",
          ),
          lifecycle: {
            ownership: "user",
            origin: "user",
          },
        },
      },
    ],
    variables: [],
    outputs: [],
    assumptions: [],
    unresolvedRequirements: [],
  });
}

const apiLambdaIntent: EditorConnectionStartIntent = {
  kind: "endpoints",
  source: {
    nodeId: "api",
    portId: "aws.apigateway.http-api.invocation",
  },
  target: {
    nodeId: "lambda",
    portId: "aws.lambda.function.synchronous-invocation",
  },
};

function createModeStorage(initialMode: ExperienceMode): ModePreferenceStorage {
  let value: ExperienceMode = initialMode;
  return {
    getItem: () => value,
    setItem: (_key, nextValue) => {
      if (nextValue === "guided" || nextValue === "professional") {
        value = nextValue;
      }
    },
  };
}

function createIds(ids: readonly string[]): () => string {
  let index = 0;
  return () => {
    const value = ids[index];
    index += 1;
    return value ?? `wizard_fallback_${String(index)}`;
  };
}

function WizardHarness({
  intent,
}: {
  readonly intent: EditorConnectionStartIntent;
}) {
  const session = useEditorDocumentSession();
  const store = useEditorSessionStoreApi();
  const announcement = useEditorSessionState((state) => state.liveAnnouncement);
  if (session.status !== "ready") {
    return <output data-testid="session-state">invalid</output>;
  }
  const policy = session.document.nodes.find(
    (node) => node.semantic.serviceType === "aws.iam.policy-statement",
  );
  const policyActions = (
    policy?.semantic.configuration.values as
      Readonly<Record<string, Readonly<ConfigurationValue>>> | undefined
  )?.["actions"];
  const generatedIds = [
    ...session.document.nodes.flatMap((node) =>
      node.semantic.lifecycle.ownership === "generated" ? [node.id] : [],
    ),
    ...session.document.edges.flatMap((edge) =>
      edge.semantic.lifecycle.ownership === "generated" ? [edge.id] : [],
    ),
  ].sort();

  return (
    <>
      <button
        onClick={() => {
          store.getState().setActiveConnectionDock({
            direction: "output",
            groupId: "aws.lambda.function.dock.data",
            nodeId: "lambda",
          });
          session.beginConnection(intent);
        }}
        type="button"
      >
        Start test connection
      </button>
      <output data-testid="content-hash">{session.hashes.contentHash}</output>
      <output data-testid="visual-hash">{session.hashes.visualHash}</output>
      <output data-testid="edge-count">
        {String(session.document.edges.length)}
      </output>
      <output data-testid="event-edge-count">
        {String(
          session.document.edges.filter(
            (edge) =>
              edge.semantic.relationshipType === "aws.s3.notifies-lambda",
          ).length,
        )}
      </output>
      <output data-testid="workload-trigger-count">
        {String(
          session.document.workloadBehavior.workloads.reduce(
            (count, workload) => count + workload.triggers.length,
            0,
          ),
        )}
      </output>
      <output data-testid="generated-ids">
        {JSON.stringify(generatedIds)}
      </output>
      <output data-testid="policy-actions">
        {policyActions?.kind === "string-list"
          ? JSON.stringify(policyActions.value)
          : "none"}
      </output>
      <output data-testid="connection-draft">
        {JSON.stringify({
          configuration: session.connectionWorkflow.configuration,
          editingEdgeId: session.connectionWorkflow.editingEdgeId,
          selectedCandidateKey: session.connectionWorkflow.selectedCandidateKey,
        })}
      </output>
      <output data-testid="announcement">{announcement}</output>
      <output data-testid="active-connection-dock">
        {store.getState().activeConnectionDock?.groupId ?? "none"}
      </output>
      <output data-testid="connection-history-state">
        {`${String(session.history.canUndo)}|${String(session.history.canRedo)}|${session.history.undoLabel ?? "none"}|${session.history.redoLabel ?? "none"}`}
      </output>
      <button
        onClick={() => {
          session.undo();
        }}
        type="button"
      >
        Undo connection history
      </button>
      <div aria-label="Test application mode">
        <ModeSwitch />
      </div>
      <ConnectionWizard />
    </>
  );
}

function renderWizard({
  catalog = awsEditorCatalog,
  connectionResolver = awsConnectionResolverV1,
  createId = createIds(["wizard_connection"]),
  document = createConnectionDocument(),
  intent = apiLambdaIntent,
  mode = "guided",
}: {
  readonly catalog?: typeof awsEditorCatalog;
  readonly connectionResolver?: ProviderConnectionResolverV1;
  readonly createId?: () => string;
  readonly document?: ArchitectureDocument;
  readonly intent?: EditorConnectionStartIntent;
  readonly mode?: ExperienceMode;
} = {}) {
  return render(
    <RouterProvider>
      <NotificationProvider>
        <ModePreferenceProvider
          actorId="connection-wizard-test"
          storage={createModeStorage(mode)}
        >
          <EditorSessionProvider
            catalog={catalog}
            connectionResolver={connectionResolver}
            createId={createId}
            document={document}
            iconRegistry={awsIconRegistry}
          >
            <WizardHarness intent={intent} />
          </EditorSessionProvider>
        </ModePreferenceProvider>
      </NotificationProvider>
    </RouterProvider>,
  );
}

function startConnection(): HTMLElement {
  const start = screen.getByRole("button", {
    name: "Start test connection",
  });
  start.focus();
  fireEvent.click(start);
  return start;
}

function setWizardModeForParityTest(mode: ExperienceMode): void {
  const modeControl = screen.getByRole("button", {
    hidden: true,
    name: mode === "guided" ? "Guided" : "Professional",
  });
  expect(modeControl.closest("[inert]")).not.toBeNull();

  // Modal browser interactions cannot reach this global control. These unit
  // cases inject the provider transition only to compare presentation output;
  // the end-to-end suite verifies the real modal interaction boundary.
  fireEvent.click(modeControl);
}

function fillApiQuestions(routeKey = "GET /notes"): void {
  const route = screen.getByLabelText(
    /Which HTTP method and path should invoke this function/u,
  );
  expect(route).toBeVisible();
  expect(
    screen.getByLabelText(
      /Which HTTP API Lambda payload format should be used/u,
    ),
  ).toHaveValue("2.0");
  expect(
    screen.getByLabelText(/How long may API Gateway wait for the function/u),
  ).toHaveValue(10_000);
  fireEvent.change(route, {
    target: { value: routeKey },
  });
}

function resolveReadTableConnection(
  document: ArchitectureDocument,
): ArchitectureDocument {
  const result = awsConnectionResolverV1.resolve({
    configuration: {
      consistentRead: { kind: "boolean", value: false },
    },
    document,
    operationId: "table_access",
    ruleId: "aws.lambda.reads-dynamodb-table",
    source: {
      nodeId: "lambda",
      portId: "aws.lambda.function.data-read",
    },
    target: {
      nodeId: "table",
      portId: "aws.dynamodb.table.table-api",
    },
  });
  if (!result.success) {
    throw new TypeError("Could not create the editable connection fixture.");
  }
  return result.preview.document;
}

describe("ConnectionWizard", () => {
  function technicalDetails(): HTMLElement {
    const summary = screen.getByText("Technical details");
    const details = summary.closest("details");
    if (details === null) {
      throw new TypeError("Expected one shared Technical details disclosure.");
    }
    return details;
  }

  function openTechnicalDetails(): HTMLElement {
    const details = technicalDetails();
    if (!details.hasAttribute("open")) {
      fireEvent.click(within(details).getByText("Technical details"));
    }
    expect(details).toHaveAttribute("open");
    return details;
  }

  function connectionSettingLabels(): string[] {
    const section = screen
      .getByRole("heading", { name: "Connection settings" })
      .closest("section");
    if (section === null) {
      throw new TypeError("Expected the shared connection settings section.");
    }
    return [...section.querySelectorAll("label")].map((label) =>
      label.textContent.replace(/s+/gu, " ").trim(),
    );
  }

  it("redacts secret and sensitive-variable reference identifiers in previews", () => {
    const secretReference = {
      kind: "secret-reference",
      reference: "secret_ref_fixture",
    } as unknown as Readonly<ConfigurationValue>;
    const variableReference = {
      kind: "variable-reference",
      variableId: "variable_sensitive_fixture",
    } as unknown as Readonly<ConfigurationValue>;

    expect(connectionConfigurationValueText(secretReference)).toBe(
      "Secret reference configured (identifier and value not shown)",
    );
    expect(connectionConfigurationValueText(variableReference)).toBe(
      "Sensitive variable reference configured (identifier and value not shown)",
    );
    expect(
      [
        connectionConfigurationValueText(secretReference),
        connectionConfigurationValueText(variableReference),
      ].join(" "),
    ).not.toMatch(/secret_ref_fixture|variable_sensitive_fixture/u);
  });

  it("rejects a mismatched editor catalog before connection discovery", () => {
    const listCompatible = vi.fn(
      (
        request: Parameters<ProviderConnectionResolverV1["listCompatible"]>[0],
      ) => awsConnectionResolverV1.listCompatible(request),
    );
    const resolver: ProviderConnectionResolverV1 = {
      ...awsConnectionResolverV1,
      listCompatible,
    };
    renderWizard({
      catalog: {
        ...awsEditorCatalog,
        identity: { ...awsEditorCatalog.identity, version: "999.0.0" },
      },
      connectionResolver: resolver,
    });

    startConnection();

    expect(listCompatible).not.toHaveBeenCalled();
    expect(
      screen.getByRole("dialog", { name: "Connection unavailable" }),
    ).toBeVisible();
    expect(
      within(screen.getByRole("dialog")).getByText(
        "Open this architecture with the provider catalog version it was created with.",
      ),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Connect" }),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("edge-count")).toHaveTextContent("1");
  });

  it("shows the candidate selector only for an ambiguous connection", () => {
    renderWizard({
      intent: {
        kind: "node",
        nodeId: "api",
      },
    });
    startConnection();

    expect(
      screen.getByRole("dialog", { name: "Choose services to connect" }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", {
        name: "What should this connection do?",
      }),
    ).toBeVisible();
    const guidedChoices = screen.getAllByRole("radio");
    expect(guidedChoices).toHaveLength(3);
    const candidateKeys = guidedChoices.map((choice) =>
      choice.getAttribute("value"),
    );
    const candidateLabels = guidedChoices.map(
      (choice) => choice.getAttribute("aria-label") ?? choice.textContent,
    );
    expect(screen.getByRole("dialog")).not.toHaveTextContent("Exact rule");

    setWizardModeForParityTest("professional");

    const professionalChoices = screen.getAllByRole("radio");
    expect(
      professionalChoices.map((choice) => choice.getAttribute("value")),
    ).toEqual(candidateKeys);
    expect(
      professionalChoices.map(
        (choice) => choice.getAttribute("aria-label") ?? choice.textContent,
      ),
    ).toEqual(candidateLabels);
    expect(screen.getByRole("dialog")).not.toHaveTextContent("Exact rule");
    expect(
      screen.queryByRole("button", { name: "Review connection" }),
    ).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("radio", {
        name: "Invokes",
      }),
    );

    expect(
      screen.getByRole("dialog", {
        name: "Connect API Gateway HTTP API to Lambda function",
      }),
    ).toBeVisible();
    expect(
      screen.queryByRole("heading", {
        name: "What should this connection do?",
      }),
    ).not.toBeInTheDocument();
    expect(connectionSettingLabels()).toHaveLength(3);
  });

  it("keeps disabled candidate diagnostics mode-appropriate without leaking IDs", () => {
    renderWizard({
      intent: { kind: "node", nodeId: "lambda" },
    });
    const initialContentHash = screen.getByTestId("content-hash").textContent;
    const initialDraft = screen.getByTestId("connection-draft").textContent;

    startConnection();

    const blockedRole = screen.getByRole("radio", {
      name: "Uses role",
    });
    expect(blockedRole).toBeDisabled();
    const descriptionId = blockedRole.getAttribute("aria-describedby");
    if (descriptionId === null) {
      throw new TypeError("Expected an accessible disabled-candidate reason.");
    }
    const description = document.getElementById(descriptionId);
    if (description === null) {
      throw new TypeError("Expected the disabled-candidate description.");
    }
    expect(description).toHaveTextContent(
      "This input already has its one allowed connection.",
    );
    expect(description).not.toHaveTextContent(
      "cloudmarkup.connection.target-port-cardinality-exceeded",
    );

    setWizardModeForParityTest("professional");

    expect(description).toHaveTextContent(
      "The requested edge would exceed the target port's aggregate catalog cardinality across connection rules.",
    );
    expect(description).not.toHaveTextContent(
      "cloudmarkup.connection.target-port-cardinality-exceeded",
    );
    expect(description).not.toHaveTextContent("$.document.edges");
    expect(screen.getByTestId("connection-draft").textContent).toBe(
      initialDraft,
    );
    expect(screen.getByTestId("content-hash").textContent).toBe(
      initialContentHash,
    );
  });

  it("uses the same setup fields, order, actions, and two-stage review in both modes", async () => {
    renderWizard({ createId: createIds(["api_cancel"]) });
    const initialContentHash = screen.getByTestId("content-hash").textContent;
    const initialVisualHash = screen.getByTestId("visual-hash").textContent;
    const start = startConnection();

    const dialog = screen.getByRole("dialog", {
      name: "Connect API Gateway HTTP API to Lambda function",
    });
    expect(dialog).toBeVisible();
    expect(screen.getByTestId("active-connection-dock")).toHaveTextContent(
      "none",
    );
    expect(
      within(dialog).queryByRole("button", { name: "Guided" }),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).queryByRole("button", { name: "Professional" }),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).getByText(
        "Routes one HTTP API method and path to a Lambda function.",
      ),
    ).toBeVisible();
    expect(screen.getByText("Set up connection")).toBeVisible();
    expect(screen.getAllByText("Required")).toHaveLength(3);
    expect(
      screen.getAllByText(/The reviewed catalog default is recommended\./u),
    ).toHaveLength(2);
    const guidedLabels = connectionSettingLabels();
    expect(guidedLabels).toHaveLength(3);
    expect(
      screen.getByRole("button", { name: "Review connection" }),
    ).toBeVisible();

    const setupTechnical = technicalDetails();
    const guidedSetupTechnicalTree = setupTechnical.innerHTML;
    expect(setupTechnical).not.toHaveAttribute("open");
    expect(
      within(setupTechnical).getByText(
        "aws.apigateway.http-api-invokes-lambda",
      ),
    ).not.toBeVisible();

    setWizardModeForParityTest("professional");

    expect(connectionSettingLabels()).toEqual(guidedLabels);
    expect(
      screen.getByRole("button", { name: "Review connection" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeVisible();
    expect(setupTechnical).not.toHaveAttribute("open");
    expect(technicalDetails().innerHTML).toBe(guidedSetupTechnicalTree);

    const openedSetupTechnical = openTechnicalDetails();
    expect(
      within(openedSetupTechnical).getByText(
        "aws.apigateway.http-api-invokes-lambda",
      ),
    ).toBeVisible();
    expect(
      within(openedSetupTechnical).getByText(
        "aws.apigateway.http-api.invocation",
      ),
    ).toBeVisible();
    expect(
      within(openedSetupTechnical).getByRole("heading", {
        name: "Cardinality utilization",
      }),
    ).toBeVisible();
    fireEvent.click(
      within(openedSetupTechnical).getByText("Technical details"),
    );

    setWizardModeForParityTest("guided");
    expect(connectionSettingLabels()).toEqual(guidedLabels);
    fillApiQuestions();
    fireEvent.click(screen.getByRole("button", { name: "Review connection" }));

    expect(
      await screen.findByRole("heading", {
        name: "What will change",
      }),
    ).toBeVisible();
    expect(screen.getByText("Review and connect")).toBeVisible();
    expect(
      screen.getByRole("list", { name: "Permission consequences" }),
    ).toHaveTextContent(
      "The future compiler may grant API Gateway invoke permission only on the connected Lambda function.",
    );
    const directCost = screen
      .getAllByRole("heading", { name: "Cost" })
      .find((heading) => heading.closest("details") === null);
    if (directCost === undefined) {
      throw new TypeError("Expected a directly visible cost consequence.");
    }
    expect(directCost).toBeVisible();
    expect(screen.getByText(/may affect AWS usage charges/u)).toBeVisible();
    expect(screen.getByRole("button", { name: "Back" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Connect" })).toHaveAttribute(
      "title",
      "Ctrl/Command+Enter",
    );

    const reviewTechnical = technicalDetails();
    expect(reviewTechnical).not.toHaveAttribute("open");
    expect(
      within(reviewTechnical).getByText("lambda:InvokeFunction"),
    ).not.toBeVisible();
    openTechnicalDetails();
    expect(
      within(reviewTechnical).getByRole("heading", {
        name: "Batch commands",
      }),
    ).toBeVisible();
    expect(
      within(reviewTechnical).getByText("lambda:InvokeFunction"),
    ).toBeVisible();
    expect(reviewTechnical).toHaveTextContent("apigateway.amazonaws.com");
    expect(reviewTechnical).toHaveTextContent("api_cancel.edge.connection");
    const guidedReviewTechnicalTree = reviewTechnical.innerHTML;
    expect(
      within(reviewTechnical).getByRole("list", {
        name: "Validation rule references",
      }),
    ).toHaveTextContent("aws.cloudmarkup.validation.connection-questions");

    setWizardModeForParityTest("professional");
    expect(
      screen.getByRole("heading", {
        name: "What will change",
      }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Back" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Connect" })).toBeVisible();
    expect(technicalDetails().innerHTML).toBe(guidedReviewTechnicalTree);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(screen.getByTestId("content-hash").textContent).toBe(
      initialContentHash,
    );
    expect(screen.getByTestId("visual-hash").textContent).toBe(
      initialVisualHash,
    );
    expect(screen.getByTestId("edge-count")).toHaveTextContent("1");
    expect(screen.getByTestId("announcement")).toHaveTextContent(
      "Connection canceled. The architecture was not changed.",
    );
    await waitFor(() => {
      expect(start).toHaveFocus();
    });
  });

  it("keeps one setup stage for field errors and puts exact findings in Technical details", async () => {
    renderWizard();
    startConnection();
    const timeout = screen.getByRole("spinbutton", {
      name: /How long may API Gateway wait/u,
    });
    fireEvent.change(timeout, { target: { value: "15000" } });

    fireEvent.click(screen.getByRole("button", { name: "Review connection" }));

    const route = screen.getByRole("textbox", {
      name: /Which HTTP method and path should invoke this function/u,
    });
    const summary = await screen.findByRole("alert");
    expect(
      within(summary).getByRole("link", {
        name: /Choose the HTTP method and path before adding this Lambda integration/u,
      }),
    ).toHaveAttribute("href", `#${route.id}`);
    expect(route).toHaveAttribute("aria-invalid", "true");
    expect(route).toHaveFocus();
    expect(timeout).toHaveValue(15000);
    expect(screen.getByText("Set up connection")).toBeVisible();
    expect(connectionSettingLabels()).toHaveLength(3);
    expect(
      screen.queryByRole("button", { name: "Connect" }),
    ).not.toBeInTheDocument();

    setWizardModeForParityTest("professional");

    expect(
      within(summary).getByRole("link", {
        name: /Route identity is required to prevent implicit catch-all behavior/u,
      }),
    ).toBeVisible();
    expect(connectionSettingLabels()).toHaveLength(3);
    const details = openTechnicalDetails();
    expect(details).toHaveTextContent("aws.apigateway.finding.route-required");
    expect(details).toHaveTextContent("routeKey");
    expect(details).toHaveTextContent(
      "aws.cloudmarkup.validation.connection-questions",
    );
  });

  it("does not expose Connect for a resolver success carrying an error finding", async () => {
    const resolver: ProviderConnectionResolverV1 = {
      ...awsConnectionResolverV1,
      resolve: (request) => {
        const result = awsConnectionResolverV1.resolve(request);
        return result.success
          ? {
              ...result,
              findings: [
                {
                  code: "test.connection.block-preview",
                  guidedMessage: "This resolver error blocks confirmation.",
                  path: "$.ruleId",
                  professionalMessage:
                    "A success result with an error finding is non-confirmable.",
                  severity: "error" as const,
                },
              ],
            }
          : result;
      },
    };
    renderWizard({ connectionResolver: resolver, mode: "professional" });
    startConnection();
    fillApiQuestions();
    fireEvent.click(screen.getByRole("button", { name: "Review connection" }));

    const summary = await screen.findByRole("alert");
    expect(summary).toHaveTextContent(
      "A success result with an error finding is non-confirmable.",
    );
    expect(summary).toHaveFocus();
    expect(
      screen.queryByRole("button", { name: "Connect" }),
    ).not.toBeInTheDocument();
    const details = openTechnicalDetails();
    expect(details).toHaveTextContent("test.connection.block-preview");
    expect(details).toHaveTextContent("$.ruleId");
    expect(screen.getByTestId("edge-count")).toHaveTextContent("1");
  });

  it.each([
    { mode: "guided" as const, modifier: "control" as const },
    { mode: "professional" as const, modifier: "command" as const },
  ])(
    "supports the same keyboard confirmation in $mode mode",
    async ({ mode, modifier }) => {
      const operationId = "api_keyboard_" + mode;
      const expectedGeneratedIds = [
        operationId + ".edge.connection",
        operationId + ".edge.lambda-service-grant-owner",
        operationId + ".edge.lambda-service-grant-scope",
        operationId + ".edge.lambda-service-grant-statement",
        operationId + ".node.lambda-service-grant",
        operationId + ".node.lambda-service-grant-document",
      ].sort();
      renderWizard({
        createId: createIds([operationId]),
        mode,
      });
      startConnection();
      fillApiQuestions("GET /" + mode);
      fireEvent.click(
        screen.getByRole("button", { name: "Review connection" }),
      );
      expect(screen.getByTestId("edge-count")).toHaveTextContent("1");
      expect(screen.getByRole("button", { name: "Connect" })).toHaveAttribute(
        "title",
        "Ctrl/Command+Enter",
      );

      if (modifier === "control") {
        fireEvent.keyDown(document, { ctrlKey: true, key: "Enter" });
      } else {
        fireEvent.keyDown(document, { key: "Enter", metaKey: true });
      }

      await waitFor(() => {
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      });
      expect(screen.getByTestId("edge-count")).toHaveTextContent("5");
      expect(screen.getByTestId("generated-ids")).toHaveTextContent(
        JSON.stringify(expectedGeneratedIds),
      );
      expect(screen.getByTestId("announcement")).toHaveTextContent(
        "Connection applied through the confirmed atomic Graph Command batch.",
      );

      fireEvent.click(
        screen.getByRole("button", { name: "Undo connection history" }),
      );
      expect(screen.getByTestId("edge-count")).toHaveTextContent("1");
      expect(screen.getByTestId("generated-ids")).toHaveTextContent("[]");
    },
  );

  it("skips an empty setup step for a zero-question connection", async () => {
    renderWizard({
      createId: createIds(["audience_zero"]),
      intent: {
        kind: "endpoints",
        source: {
          nodeId: "client",
          portId: "aws.cognito.user-pool-client.jwt-audience",
        },
        target: {
          nodeId: "api",
          portId: "aws.apigateway.http-api.jwt-audience",
        },
      },
    });
    startConnection();

    expect(
      await screen.findByRole("heading", {
        name: "What will change",
      }),
    ).toBeVisible();
    expect(screen.queryByText("Set up connection")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Connection settings" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "Connect the app client's Cognito user pool as the API JWT issuer.",
      ),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Back" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect" })).toBeVisible();

    setWizardModeForParityTest("professional");
    expect(
      screen.getByText(
        "A complete API Gateway JWT authorizer requires both audience and issuer relationships.",
      ),
    ).toBeVisible();
    const details = openTechnicalDetails();
    expect(details).toHaveTextContent(
      "aws.cognito.app-client-authorizes-http-api",
    );
    expect(details).toHaveTextContent(
      "aws.cognito.finding.jwt-issuer-required",
    );
    expect(details).toHaveTextContent(
      "aws.cloudmarkup.validation.api-route-authentication",
    );

    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(screen.getByTestId("edge-count")).toHaveTextContent("2");
    expect(screen.getByTestId("generated-ids")).toHaveTextContent(
      "audience_zero.edge.connection",
    );
  });

  it("shows Cognito defaults together and a directly visible audience warning", async () => {
    renderWizard({
      createId: createIds(["cognito_authorizer"]),
      intent: {
        kind: "endpoints",
        source: {
          nodeId: "pool",
          portId: "aws.cognito.user-pool.jwt-issuer",
        },
        target: {
          nodeId: "api",
          portId: "aws.apigateway.http-api.jwt-issuer",
        },
      },
    });
    startConnection();

    expect(
      screen.getByLabelText(/What should the API JWT authorizer be called/u),
    ).toHaveValue("notesJwt");
    expect(
      screen.getByLabelText(/Where should API Gateway read the bearer token/u),
    ).toHaveValue("$request.header.Authorization");
    expect(connectionSettingLabels()).toHaveLength(2);
    expect(
      screen.getAllByText(/The reviewed catalog default is recommended\./u),
    ).toHaveLength(2);
    expect(
      screen.queryByRole("button", { name: "Next question" }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Review connection" }));

    expect(
      await screen.findByText(
        "Connect a Cognito app client as the JWT audience before treating the API as fully authenticated.",
      ),
    ).toBeVisible();
    const details = openTechnicalDetails();
    expect(details).toHaveTextContent(
      "aws.cognito.user-pool-authorizes-http-api",
    );
    expect(details).toHaveTextContent(
      "aws.cloudmarkup.validation.api-route-authentication",
    );
    expect(screen.getByTestId("edge-count")).toHaveTextContent("1");
  });

  it("keeps an unavailable saved choice visible without bypassing generated-recipe guards", async () => {
    const created = awsConnectionResolverV1.resolve({
      document: createConnectionDocument(),
      operationId: "saved_api",
      ruleId: "aws.apigateway.http-api-invokes-lambda",
      source: { nodeId: "api", portId: "aws.apigateway.http-api.invocation" },
      target: {
        nodeId: "lambda",
        portId: "aws.lambda.function.synchronous-invocation",
      },
      configuration: {
        routeKey: { kind: "string", value: "GET /saved" },
        payloadFormatVersion: { kind: "string", value: "2.0" },
        timeoutMilliseconds: { kind: "integer", value: 10000 },
      },
    });
    if (!created.success)
      throw new Error("Expected the public API connection fixture.");
    const document = parseArchitectureDocument({
      ...created.preview.document,
      edges: created.preview.document.edges.map((edge) =>
        edge.id === "saved_api.edge.connection"
          ? {
              ...edge,
              semantic: {
                ...edge.semantic,
                configuration: {
                  ...edge.semantic.configuration,
                  values: {
                    ...edge.semantic.configuration.values,
                    payloadFormatVersion: { kind: "string", value: "1.0" },
                  },
                },
              },
            }
          : edge,
      ),
    });
    renderWizard({
      document,
      intent: { kind: "edge", edgeId: "saved_api.edge.connection" },
      createId: createIds(["correct_saved_api"]),
    });
    const hash = screen.getByTestId("content-hash").textContent;
    startConnection();
    const payload = screen.getByRole("combobox", {
      name: /Which HTTP API Lambda payload format/u,
    });
    expect(payload).toHaveValue("1.0");
    expect(
      within(payload).getByRole("option", { selected: true }),
    ).toHaveTextContent("Unavailable: 1.0");
    fireEvent.click(screen.getByRole("button", { name: "Review connection" }));
    expect(await screen.findByRole("alert")).toBeVisible();
    expect(screen.getByTestId("content-hash").textContent).toBe(hash);
    expect(payload).toHaveValue("1.0");
    fireEvent.change(payload, { target: { value: "2.0" } });
    fireEvent.click(screen.getByRole("button", { name: "Review connection" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "generated changes that no longer match its reviewed recipe",
    );
    expect(payload).toHaveValue("2.0");
    expect(
      screen.queryByRole("button", { name: "Update connection" }),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("content-hash").textContent).toBe(hash);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId("generated-ids")).toHaveTextContent(
      "saved_api.edge.connection",
    );
    expect(screen.getByTestId("content-hash").textContent).toBe(hash);
  });

  it("edits a generated DynamoDB connection without changing identities or IAM scope", async () => {
    const editableDocument = resolveReadTableConnection(
      createConnectionDocument(),
    );
    const expectedGeneratedIds = [
      "table_access.edge.connection",
      "table_access.edge.policy-document-statement",
      "table_access.edge.policy-role",
      "table_access.edge.policy-table",
      "table_access.node.dynamodb-policy",
      "table_access.node.dynamodb-policy-document",
    ].sort();
    renderWizard({
      createId: createIds(["edit_table_access"]),
      document: editableDocument,
      intent: {
        edgeId: "table_access.edge.connection",
        kind: "edge",
      },
      mode: "professional",
    });
    expect(screen.getByTestId("edge-count")).toHaveTextContent("5");
    expect(screen.getByTestId("generated-ids")).toHaveTextContent(
      JSON.stringify(expectedGeneratedIds),
    );
    startConnection();

    const consistentRead = screen.getByLabelText(
      /Does the function require strongly consistent reads/u,
    );
    expect(consistentRead).not.toBeChecked();
    const setupDetails = technicalDetails();
    expect(
      within(setupDetails).getByRole("heading", {
        name: "Cardinality utilization",
      }),
    ).not.toBeVisible();
    fireEvent.click(consistentRead);
    fireEvent.click(screen.getByRole("button", { name: "Review connection" }));

    expect(
      screen.getByRole("list", { name: "Permission consequences" }),
    ).toHaveTextContent(
      "The data-read relationship grants only item lookup and query on the connected table.",
    );
    expect(
      screen.getByRole("heading", { name: "Generated supporting resources" }),
    ).toBeVisible();
    expect(
      screen.getByText(/only after no other connection uses them/u),
    ).toBeVisible();

    const reviewDetails = openTechnicalDetails();
    const permissionEffects = within(reviewDetails).getByRole("list", {
      name: "Permission effects",
    });
    expect(permissionEffects).toHaveTextContent("aws.lambda.iam.dynamodb-read");
    expect(permissionEffects).toHaveTextContent("dynamodb:GetItem");
    expect(permissionEffects).toHaveTextContent("dynamodb:Query");
    expect(permissionEffects).toHaveTextContent(
      "Scope connected-target: connected target node DynamoDB table (table).",
    );
    const generatedPreview = within(reviewDetails).getByRole("list", {
      name: "Generated resources",
    });
    for (const id of expectedGeneratedIds) {
      expect(generatedPreview).toHaveTextContent(id);
    }
    expect(generatedPreview).toHaveTextContent(
      "aws.iam.policy-statement.configuration",
    );
    expect(generatedPreview).toHaveTextContent(
      "aws.dynamodb.table.policy-resource",
    );
    expect(
      within(reviewDetails).getByRole("list", {
        name: "Whole-architecture IAM requirements",
      }),
    ).toHaveTextContent("table_access.edge.connection");

    fireEvent.click(screen.getByRole("button", { name: "Update connection" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(screen.getByTestId("edge-count")).toHaveTextContent("5");
    expect(screen.getByTestId("generated-ids")).toHaveTextContent(
      JSON.stringify(expectedGeneratedIds),
    );
    expect(screen.getByTestId("policy-actions")).toHaveTextContent(
      "dynamodb:GetItem",
    );
    expect(screen.getByTestId("policy-actions")).toHaveTextContent(
      "dynamodb:Query",
    );
    expect(screen.getByTestId("policy-actions")).not.toHaveTextContent(
      "dynamodb:DeleteItem",
    );
  });

  it("removes a generated connection with its permissions and restores it through Undo", async () => {
    const document = resolveReadTableConnection(createConnectionDocument());
    renderWizard({
      createId: createIds(["remove_table_access"]),
      document,
      intent: { edgeId: "table_access.edge.connection", kind: "edge" },
    });
    startConnection();
    fireEvent.click(screen.getByRole("button", { name: "Remove connection" }));
    expect(
      screen.getByRole("heading", { name: "Remove this connection?" }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Confirm removal" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId("edge-count")).toHaveTextContent("1");
    expect(screen.getByTestId("generated-ids")).toHaveTextContent("[]");
    expect(screen.getByTestId("connection-history-state")).toHaveTextContent(
      "true|false|Remove connection",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Undo connection history" }),
    );
    expect(screen.getByTestId("edge-count")).toHaveTextContent("5");
    expect(screen.getByTestId("generated-ids")).toHaveTextContent(
      "table_access.edge.connection",
    );
  });
  it("binds a manually added S3 event to the Lambda workload in one undoable preview", async () => {
    const blank = loadBlankAwsEditorArchitectureDocument("us-east-1");
    let sequence = 0;
    const prepared = prepareBetaInfrastructureProposal({
      document: blank,
      catalog: awsEditorCatalog,
      createId: () => "manual_event_setup_" + String(++sequence),
      proposal: {
        contractVersion: 3,
        summary: "Prepare a file processor",
        existingResources: [],
        resources: [
          {
            key: "source",
            serviceType: "aws.s3.bucket",
            label: "Source",
            parentKey: null,
          },
          {
            key: "handler",
            serviceType: "aws.lambda.function",
            label: "Handler",
            parentKey: null,
            purpose: "Process source bucket events.",
          },
          {
            key: "role",
            serviceType: "aws.iam.role",
            label: "Role",
            parentKey: null,
          },
          {
            key: "logs",
            serviceType: "aws.cloudwatch.log-group",
            label: "Logs",
            parentKey: null,
          },
        ],
        connections: [
          {
            ruleId: "aws.iam.role-assumed-by-lambda",
            sourceKey: "role",
            targetKey: "handler",
            configuration: {},
          },
          {
            ruleId: "aws.lambda.writes-log-group",
            sourceKey: "handler",
            targetKey: "logs",
            configuration: {},
          },
        ],
        limitations: [],
      },
    });
    const document = applyPreparedResourceRepair(blank, prepared).document;
    const source = document.nodes.find(
      (node) => node.presentation.label === "Source",
    );
    const handler = document.nodes.find(
      (node) => node.presentation.label === "Handler",
    );
    if (source === undefined || handler === undefined)
      throw new Error("Expected S3 and Lambda resources.");
    renderWizard({
      createId: () => "manual_event_" + String(++sequence),
      document,
      intent: {
        kind: "endpoints",
        source: { nodeId: source.id, portId: "aws.s3.bucket.notifications" },
        target: {
          nodeId: handler.id,
          portId: "aws.lambda.function.asynchronous-invocation",
        },
      },
    });
    expect(screen.getByTestId("workload-trigger-count")).toHaveTextContent("0");
    startConnection();
    fireEvent.click(screen.getByRole("button", { name: "Review connection" }));
    fireEvent.click(await screen.findByRole("button", { name: "Connect" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId("event-edge-count")).toHaveTextContent("1");
    expect(screen.getByTestId("workload-trigger-count")).toHaveTextContent("1");
    fireEvent.click(
      screen.getByRole("button", { name: "Undo connection history" }),
    );
    expect(screen.getByTestId("event-edge-count")).toHaveTextContent("0");
    expect(screen.getByTestId("workload-trigger-count")).toHaveTextContent("0");
  });
  it("unbinds a generated S3 event trigger and restores it with one Undo", async () => {
    const blank = loadBlankAwsEditorArchitectureDocument("us-east-1");
    let sequence = 0;
    const prepared = prepareBetaInfrastructureProposal({
      document: blank,
      catalog: awsEditorCatalog,
      createId: () => "event_remove_" + String(++sequence),
      proposal: {
        contractVersion: 3,
        summary: "Process uploaded files",
        existingResources: [],
        resources: [
          {
            key: "source",
            serviceType: "aws.s3.bucket",
            label: "Source",
            parentKey: null,
          },
          {
            key: "handler",
            serviceType: "aws.lambda.function",
            label: "Handler",
            parentKey: null,
            purpose: "Process source bucket events.",
          },
          {
            key: "role",
            serviceType: "aws.iam.role",
            label: "Role",
            parentKey: null,
          },
          {
            key: "logs",
            serviceType: "aws.cloudwatch.log-group",
            label: "Logs",
            parentKey: null,
          },
        ],
        connections: [
          {
            ruleId: "aws.iam.role-assumed-by-lambda",
            sourceKey: "role",
            targetKey: "handler",
            configuration: {},
          },
          {
            ruleId: "aws.lambda.writes-log-group",
            sourceKey: "handler",
            targetKey: "logs",
            configuration: {},
          },
          {
            ruleId: "aws.s3.bucket-notifies-lambda",
            sourceKey: "source",
            targetKey: "handler",
            configuration: {},
          },
        ],
        limitations: [],
      },
    });
    const document = applyPreparedResourceRepair(blank, prepared).document;
    const eventEdge = document.edges.find(
      (edge) => edge.semantic.relationshipType === "aws.s3.notifies-lambda",
    );
    if (!eventEdge) throw new Error("Expected event edge.");
    renderWizard({
      createId: () => "remove_event_" + String(++sequence),
      document,
      intent: { edgeId: eventEdge.id, kind: "edge" },
    });
    expect(screen.getByTestId("workload-trigger-count")).toHaveTextContent("1");
    startConnection();
    fireEvent.click(screen.getByRole("button", { name: "Remove connection" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm removal" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId("event-edge-count")).toHaveTextContent("0");
    expect(screen.getByTestId("workload-trigger-count")).toHaveTextContent("0");
    fireEvent.click(
      screen.getByRole("button", { name: "Undo connection history" }),
    );
    expect(screen.getByTestId("event-edge-count")).toHaveTextContent("1");
    expect(screen.getByTestId("workload-trigger-count")).toHaveTextContent("1");
  });
  it("rejects reversed endpoints without issuing a command", () => {
    renderWizard({
      intent: {
        kind: "endpoints",
        source: {
          nodeId: "lambda",
          portId: "aws.lambda.function.synchronous-invocation",
        },
        target: {
          nodeId: "api",
          portId: "aws.apigateway.http-api.invocation",
        },
      },
    });
    const initialContentHash = screen.getByTestId("content-hash").textContent;
    startConnection();

    expect(
      screen.getByRole("heading", {
        name: "These endpoints cannot be connected",
      }),
    ).toBeVisible();
    expect(
      within(screen.getByRole("dialog")).getByText(
        "Start the connection from the output side shown by the catalog.",
      ),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Connect" }),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("edge-count")).toHaveTextContent("1");
    expect(screen.getByTestId("content-hash").textContent).toBe(
      initialContentHash,
    );
  });

  it("falls back to navigable CloudMarkup guidance for an unsafe catalog URL", () => {
    const catalog: typeof awsEditorCatalog = {
      ...awsEditorCatalog,
      services: awsEditorCatalog.services.map((service) =>
        service.serviceType === "aws.lambda.function"
          ? {
              ...service,
              education: {
                ...service.education,
                documentation: [
                  {
                    href: "javascript:alert('unsafe')",
                    kind: "official" as const,
                    title: "Unsafe documentation",
                  },
                ],
              },
            }
          : service,
      ),
    };
    renderWizard({
      catalog,
      intent: {
        kind: "endpoints",
        source: {
          nodeId: "lambda",
          portId: "aws.lambda.function.synchronous-invocation",
        },
        target: {
          nodeId: "api",
          portId: "aws.apigateway.http-api.invocation",
        },
      },
    });

    startConnection();

    const guidance = screen.getByRole("link", {
      name: "Read the deeper provider guidance",
    });
    expect(guidance).toHaveAttribute("href", "/help/connections");
    fireEvent.click(guidance);
    expect(window.location.pathname).toBe("/help/connections");
  });
});
