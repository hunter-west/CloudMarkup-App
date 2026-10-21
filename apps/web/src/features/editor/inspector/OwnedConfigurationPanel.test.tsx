import {
  parseArchitectureDocument,
  type ArchitectureDocument,
} from "@cloudmarkup/domain";
import { awsConnectionResolverV1 } from "@cloudmarkup/provider-aws";
import type { ConfigurationValue } from "@cloudmarkup/schemas";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  ModePreferenceProvider,
  type ModePreferenceStorage,
} from "../../../preferences/index.js";
import { awsIconRegistry } from "../../../provider-icons/aws-icon-registry.js";
import { awsEditorCatalog } from "../../../provider-catalog/aws-editor-catalog.js";
import {
  loadAwsEditorArchitectureDocument,
  loadAwsNetworkingVisualArchitectureDocument,
} from "../../../provider-catalog/aws-editor-fixture.js";
import { awsOwnedPolicyGraphDescriptors } from "../../../provider-catalog/aws-owned-policy-descriptors.js";
import { dispatchAddServiceCommand } from "../model/add-service-command.js";
import type { EditorOwnedConfigurationSlot } from "../model/editor-catalog.js";
import { projectOwnedPolicyConfigurations } from "../model/owned-configuration-policy-model.js";
import {
  EditorSessionProvider,
  useEditorDocumentSession,
  useEditorSessionState,
} from "../session/index.js";
import {
  GeneratedAdoptionPending,
  OwnedConfigurationPanel,
} from "./OwnedConfigurationPanel.js";
import {
  generatedAdoptionMessage,
  orderOwnedConfigurationSlots,
  ownedConfigurationSectionExplanation,
  ownedConfigurationSectionTitle,
  policyKindPermitsPrincipals,
  policyValidationSeverityTone,
  statementPrincipalConstraint,
  statementPrincipalHiddenProperties,
} from "./owned-configuration-panel-model.js";
import {
  resolveSelectedResourceInspectorModel,
  type SelectedNodeInspectorModel,
} from "./selected-resource-model.js";

function roleSlots(): readonly EditorOwnedConfigurationSlot[] {
  const role = awsEditorCatalog.services.find(
    (service) => service.serviceType === "aws.iam.role",
  );
  if (role?.ownedConfigurationSlots === undefined) {
    throw new TypeError("The exact AWS role slots are unavailable.");
  }
  return role.ownedConfigurationSlots;
}

it("opens the empty required Fargate slot and creates its essential container through accessible controls", async () => {
  let sequence = 0;
  const created = dispatchAddServiceCommand({
    document: loadAwsEditorArchitectureDocument(),
    catalog: awsEditorCatalog,
    createId: () => `operation_fargate_panel_${String(++sequence)}`,
    serviceId: "aws.ecs.task-definition",
    configurationValues: {
      family: { kind: "string", value: "SyntheticTask" },
      cpu: { kind: "integer", value: 256 },
      memoryMiB: { kind: "integer", value: 512 },
      architecture: { kind: "string", value: "x86_64" },
    },
  });
  renderPanelForNode(created.document, created.nodeId);
  openOwnedConfigurationPanel();
  const section = ownedSlotSection("Essential container");
  fireEvent.click(within(section).getByText("Add Essential container"));
  for (const [label, value] of [
    ["Name", "Application"],
    ["Container port", "8080"],
    ["Container UID:GID", "10001:10001"],
    ["Health executable", "/app/health"],
    ["Log stream prefix", "Application"],
  ] as const) {
    fireEvent.change(within(section).getByLabelText(`${label}Required`), {
      target: { value },
    });
  }
  const healthStartPeriod = within(section).getByLabelText(
    /^Health start period seconds/u,
  );
  expect(healthStartPeriod).toHaveValue("0");
  fireEvent.change(healthStartPeriod, { target: { value: "" } });
  const initialHash = screen.getByTestId("owned-content-hash").textContent;
  fireEvent.click(
    within(section).getByRole("button", { name: "Add essential container" }),
  );
  expect(within(section).getByRole("alert")).toHaveTextContent(
    "Health start period seconds is required.",
  );
  expect(healthStartPeriod).toHaveAttribute("aria-invalid", "true");
  expect(healthStartPeriod).toHaveAccessibleDescription(
    /Health start period seconds is required/u,
  );
  await waitFor(() => expect(healthStartPeriod).toHaveFocus());
  const advanced = healthStartPeriod.closest("details");
  if (advanced !== null) advanced.open = false;
  fireEvent.click(
    within(section).getByRole("link", { name: /Health start period seconds/u }),
  );
  expect(advanced?.open ?? true).toBe(true);
  expect(healthStartPeriod).toHaveFocus();
  expect(screen.getByTestId("owned-node-count")).toHaveTextContent("0");
  expect(screen.getByTestId("owned-content-hash").textContent).toBe(
    initialHash,
  );
  fireEvent.change(healthStartPeriod, { target: { value: "0" } });
  fireEvent.click(
    within(section).getByRole("button", { name: "Add essential container" }),
  );
  expect(within(section).queryByRole("alert")?.textContent ?? "").toBe("");
  await waitFor(() =>
    expect(screen.getByTestId("owned-node-count")).toHaveTextContent("1"),
  );
  expect(screen.getByTestId("owned-binding-edge-count")).toHaveTextContent("1");
  fireEvent.click(
    screen.getByRole("button", { name: "Undo owned configuration" }),
  );
  await waitFor(() =>
    expect(screen.getByTestId("owned-node-count")).toHaveTextContent("0"),
  );
});

function slot(kind: EditorOwnedConfigurationSlot["policyKinds"][number]) {
  const result = roleSlots().find((candidate) =>
    candidate.policyKinds.includes(kind),
  );
  if (result === undefined) {
    throw new TypeError(`The ${kind} role slot is unavailable.`);
  }
  return result;
}

function createCommandIdFactory(): () => string {
  let sequence = 0;
  return () => {
    sequence += 1;
    return `operation_editor_owned_configuration_panel_${String(sequence).padStart(4, "0")}`;
  };
}

function createModeStorage(
  mode: "guided" | "professional" = "guided",
): ModePreferenceStorage {
  return {
    getItem: () => mode,
    setItem: () => undefined,
  };
}

function withSecurityGroup(
  document: ArchitectureDocument,
): ArchitectureDocument {
  const service = awsEditorCatalog.services.find(
    (candidate) => candidate.serviceType === "aws.ec2.security-group",
  );
  if (service?.configuration.defaults.kind !== "ready") {
    throw new TypeError("The exact security-group defaults are unavailable.");
  }
  return parseArchitectureDocument({
    ...document,
    nodes: [
      ...document.nodes,
      {
        id: "node_network_security_group",
        semantic: {
          configuration: {
            schemaId: service.configuration.schemaId,
            schemaVersion: service.configuration.schemaVersion,
            values: structuredClone(service.configuration.defaults.values),
          },
          deploymentKey: "network_security_group",
          lifecycle: { origin: "user", ownership: "user" },
          resourceType: service.resourceType,
          serviceType: service.serviceType,
        },
        presentation: {
          label: "Application security group",
          position: { x: 1_120, y: 480 },
        },
      },
    ],
  });
}

function OwnedConfigurationPanelHarness({
  model,
}: {
  readonly model: SelectedNodeInspectorModel;
}) {
  const session = useEditorDocumentSession();
  const announcement = useEditorSessionState((state) => state.liveAnnouncement);
  if (session.status !== "ready") {
    return <output data-testid="session-status">invalid</output>;
  }
  const ownedNodes = session.document.nodes.filter(
    (node) => node.semantic.parent?.nodeId === model.node.id,
  );
  const ownedNodeIds = new Set(ownedNodes.map((node) => node.id));
  const bindingEdges = session.document.edges.filter(
    (edge) =>
      ownedNodeIds.has(edge.semantic.source.nodeId) ||
      ownedNodeIds.has(edge.semantic.target.nodeId),
  );
  const configurationValues = ownedNodes[0]?.semantic.configuration.values as
    Readonly<Record<string, Readonly<ConfigurationValue>>> | undefined;
  const description = configurationValues?.["description"];
  return (
    <>
      <output data-testid="owned-document">
        {JSON.stringify(session.document)}
      </output>
      <output data-testid="owned-content-hash">
        {session.hashes.contentHash}
      </output>
      <output data-testid="owned-node-count">
        {String(ownedNodes.length)}
      </output>
      <output data-testid="owned-binding-edge-count">
        {String(bindingEdges.length)}
      </output>
      <output data-testid="owned-node-parent">
        {ownedNodes[0]?.semantic.parent?.nodeId ?? "none"}
      </output>
      <output data-testid="owned-node-description">
        {description?.kind === "string" ? description.value : "none"}
      </output>
      <output data-testid="history-label">
        {session.history.undoLabel ?? "none"}
      </output>
      <output data-testid="announcement">{announcement}</output>
      <output data-testid="connection-workflow">
        {session.connectionWorkflow.open ? "open" : "closed"}
      </output>
      <button
        disabled={!session.history.canUndo}
        onClick={() => {
          session.undo();
        }}
        type="button"
      >
        Undo owned configuration
      </button>
      <button
        disabled={!session.history.canRedo}
        onClick={() => {
          session.redo();
        }}
        type="button"
      >
        Redo owned configuration
      </button>
      <OwnedConfigurationPanel model={model} />
    </>
  );
}

function renderPanelForNode(
  document: ArchitectureDocument,
  nodeId: string,
  mode: "guided" | "professional" = "guided",
  createId: () => string = createCommandIdFactory(),
) {
  const resolution = resolveSelectedResourceInspectorModel(
    document,
    awsEditorCatalog,
    { id: nodeId, kind: "node" },
  );
  if (resolution.kind !== "ready" || resolution.model.kind !== "node") {
    throw new TypeError(
      "The exact selected-node inspector model is unavailable.",
    );
  }
  return render(
    <ModePreferenceProvider
      actorId="owned-configuration-panel-test"
      storage={createModeStorage(mode)}
    >
      <EditorSessionProvider
        catalog={awsEditorCatalog}
        connectionResolver={awsConnectionResolverV1}
        createId={createId}
        document={document}
        iconRegistry={awsIconRegistry}
        ownedPolicyDescriptors={awsOwnedPolicyGraphDescriptors}
      >
        <OwnedConfigurationPanelHarness model={resolution.model} />
      </EditorSessionProvider>
    </ModePreferenceProvider>,
  );
}

function openOwnedConfigurationPanel(): void {
  const summary = screen.getByText(/Policies and related settings/u);
  if (!summary.closest("details")?.open) fireEvent.click(summary);
}

function ownedSlotSection(name: string): HTMLElement {
  const section = screen.getByRole("heading", { name }).closest("section");
  if (section === null) {
    throw new TypeError(`The ${name} owned-configuration section is missing.`);
  }
  return section;
}

describe("OwnedConfigurationPanel policies", () => {
  it("opens fresh role and key policy setup and completes each owner without hiding the remaining requirement", async () => {
    const createId = createCommandIdFactory();
    const role = dispatchAddServiceCommand({
      document: loadAwsEditorArchitectureDocument(),
      catalog: awsEditorCatalog,
      createId,
      serviceId: "aws.iam.role",
    });
    const key = dispatchAddServiceCommand({
      document: role.document,
      catalog: awsEditorCatalog,
      createId,
      serviceId: "aws.kms.key",
    });
    let source = key.document;
    for (const [nodeId, sectionName, action] of [
      [role.nodeId, slot("trust").displayName, "sts:AssumeRole"],
      [key.nodeId, "Key policy", "kms:DescribeKey"],
    ] as const) {
      const view = renderPanelForNode(source, nodeId, "guided", createId);
      openOwnedConfigurationPanel();
      const section = ownedSlotSection(sectionName);
      fireEvent.click(within(section).getByText(`Add ${sectionName}`));
      for (const summary of within(section).getAllByText(
        "Advanced policy fields",
      )) {
        fireEvent.click(summary);
      }
      fireEvent.change(within(section).getByLabelText(/^Actions/u), {
        target: { value: action },
      });
      fireEvent.change(within(section).getByLabelText(/^Principal type/u), {
        target: { value: "service" },
      });
      fireEvent.change(within(section).getByLabelText(/^Principals/u), {
        target: { value: "ec2.amazonaws.com" },
      });
      const beforeHash = screen.getByTestId("owned-content-hash").textContent;
      fireEvent.click(
        within(section).getByRole("button", { name: "Add policy" }),
      );
      const errors = within(section).getByRole("alert");
      expect(
        within(errors).getByRole("link", {
          name: /Policy details: Policy name/u,
        }),
      ).toBeVisible();
      const policyName = within(section).getByLabelText(/^Policy name/u);
      expect(policyName).toHaveAttribute("aria-invalid", "true");
      await waitFor(() => expect(policyName).toHaveFocus());
      expect(screen.getByTestId("owned-content-hash").textContent).toBe(
        beforeHash,
      );
      expect(within(section).getByLabelText(/^Actions/u)).toHaveValue(action);
      fireEvent.change(policyName, {
        target: {
          value: nodeId === role.nodeId ? "InitialTrust" : "InitialKey",
        },
      });
      fireEvent.click(
        within(section).getByRole("button", { name: "Add policy" }),
      );
      expect(within(section).queryByRole("alert")).not.toBeInTheDocument();
      await waitFor(() => {
        expect(screen.getByTestId("owned-node-count")).toHaveTextContent("1");
      });
      expect(within(section).getByRole("article")).toBeVisible();
      const saved = parseArchitectureDocument(
        JSON.parse(screen.getByTestId("owned-document").textContent),
      );
      expect(
        projectOwnedPolicyConfigurations(saved, awsOwnedPolicyGraphDescriptors)
          .success,
      ).toBe(nodeId === key.nodeId);
      fireEvent.click(
        screen.getByRole("button", { name: "Undo owned configuration" }),
      );
      await waitFor(() => {
        expect(screen.getByTestId("owned-content-hash").textContent).toBe(
          beforeHash,
        );
      });
      source = saved;
      view.unmount();
    }
  });

  it("uses the required IAM section order, labels, and exact explanations", () => {
    expect(
      orderOwnedConfigurationSlots(roleSlots()).map((candidate) =>
        ownedConfigurationSectionTitle(candidate),
      ),
    ).toEqual([
      "Custom inline policies",
      "Trust policy",
      "Generated permissions",
      "Managed attachments",
      "Permissions boundary",
    ]);
    expect(
      ownedConfigurationSectionExplanation(slot("generated-permission")),
    ).toBe(
      "These were created because this role or function is connected to other services.",
    );
    expect(ownedConfigurationSectionExplanation(slot("identity-inline"))).toBe(
      "You explicitly added these permissions to this role.",
    );
    expect(ownedConfigurationSectionExplanation(slot("trust"))).toBe(
      "This controls who or what may use this role.",
    );
    expect(
      ownedConfigurationSectionExplanation(slot("permissions-boundary")),
    ).toBe("This limits the maximum permissions the role can receive.");
  });

  it("keeps the six target-readiness dimensions and export support explicit", () => {
    const readiness = slot("identity-inline").targetReadiness;
    expect(Object.keys(readiness).sort()).toEqual(
      [
        "cloudformation",
        "configuration",
        "generatedCode",
        "modeling",
        "terraform",
        "validation",
      ].sort(),
    );
    expect(readiness.modeling.status).toBe("supported");
    expect(readiness.configuration.status).toBe("supported");
    expect(readiness.validation.status).toBe("supported");
    expect(readiness.terraform.status).toBe("supported");
    expect(readiness.cloudformation.status).toBe("supported");
  });

  it("shows truthful adoption metadata without a fake action", () => {
    const { rerender } = render(
      <GeneratedAdoptionPending adoption="allowed" />,
    );
    expect(screen.getByText("Adopt before customize")).toBeInTheDocument();
    expect(
      screen.getByText(/reviewed adoption workflow is not available/u),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();

    rerender(<GeneratedAdoptionPending adoption="forbidden" />);
    expect(
      screen.getByText(/provider does not permit adoption/u),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(generatedAdoptionMessage("not-applicable")).toContain(
      "does not apply",
    );
  });

  it("hides and fixes principals for identity permissions but exposes them for permitted policy kinds", () => {
    for (const kind of ["identity-inline", "generated-permission"] as const) {
      expect(policyKindPermitsPrincipals(kind)).toBe(false);
      expect(statementPrincipalHiddenProperties(kind)).toEqual([
        "principalKind",
        "principals",
      ]);
      expect(statementPrincipalConstraint(kind)).toEqual({
        principalKind: "none",
        principals: "",
      });
    }
    for (const kind of ["trust", "resource", "service-grant"] as const) {
      expect(policyKindPermitsPrincipals(kind)).toBe(true);
      expect(statementPrincipalHiddenProperties(kind)).toEqual([]);
      expect(statementPrincipalConstraint(kind)).toEqual({});
    }
  });

  it("keeps informational validation severities truthful", () => {
    expect(policyValidationSeverityTone("error")).toBe("error");
    expect(policyValidationSeverityTone("security-error")).toBe("error");
    expect(policyValidationSeverityTone("warning")).toBe("warning");
    expect(policyValidationSeverityTone("cost-warning")).toBe("warning");
    expect(policyValidationSeverityTone("recommendation")).toBe("info");
    expect(policyValidationSeverityTone("educational-note")).toBe("neutral");
  });
});

describe("OwnedConfigurationPanel non-policy configurations", () => {
  it("preserves owned list values and rejects an empty lifecycle boolean without inferring false", async () => {
    const created = dispatchAddServiceCommand({
      document: loadAwsEditorArchitectureDocument(),
      catalog: awsEditorCatalog,
      createId: createCommandIdFactory(),
      serviceId: "aws.s3.bucket",
    });
    const view = renderPanelForNode(created.document, created.nodeId);
    openOwnedConfigurationPanel();
    const corsSection = ownedSlotSection("S3 CORS configuration");
    fireEvent.click(within(corsSection).getByText("Add S3 CORS configuration"));
    expect(
      within(corsSection).getByRole("textbox", { name: /^Allowed methods/u }),
    ).toHaveValue("GET\nHEAD");
    fireEvent.click(within(corsSection).getByText("Add S3 CORS configuration"));
    const section = ownedSlotSection("S3 lifecycle configuration");
    fireEvent.click(
      within(section).getByText("Add S3 lifecycle configuration"),
    );
    const expireOldVersions =
      within(section).getByLabelText(/^Expire old versions/u);
    expect(expireOldVersions).toHaveValue("true");
    fireEvent.change(expireOldVersions, { target: { value: "" } });
    const initialHash = screen.getByTestId("owned-content-hash").textContent;
    fireEvent.click(
      within(section).getByRole("button", {
        name: "Add s3 lifecycle configuration",
      }),
    );
    expect(within(section).getByRole("alert")).toHaveTextContent(
      "Expire old versions is required.",
    );
    expect(screen.getByTestId("owned-node-count")).toHaveTextContent("0");
    expect(screen.getByTestId("owned-content-hash").textContent).toBe(
      initialHash,
    );
    expect(expireOldVersions).toHaveValue("");
    fireEvent.change(expireOldVersions, { target: { value: "false" } });
    fireEvent.click(
      within(section).getByRole("button", {
        name: "Add s3 lifecycle configuration",
      }),
    );
    await waitFor(() => {
      expect(screen.getByTestId("owned-node-count")).toHaveTextContent("1");
    });
    const saved = parseArchitectureDocument(
      JSON.parse(screen.getByTestId("owned-document").textContent),
    );
    expect(
      saved.nodes.find(
        (node) =>
          node.semantic.serviceType === "aws.s3.bucket-lifecycle-configuration",
      )?.semantic.configuration.values,
    ).toMatchObject({
      expireNoncurrentVersions: { kind: "boolean", value: false },
    });
    const validHash = screen.getByTestId("owned-content-hash").textContent;
    const stale = parseArchitectureDocument({
      ...saved,
      nodes: saved.nodes.map((node) =>
        node.semantic.serviceType === "aws.s3.bucket-lifecycle-configuration"
          ? {
              ...node,
              semantic: {
                ...node.semantic,
                configuration: {
                  ...node.semantic.configuration,
                  values: {
                    ...node.semantic.configuration.values,
                    expireNoncurrentVersions: {
                      kind: "string",
                      value: "retired-flag",
                    },
                  },
                },
              },
            }
          : node,
      ),
    });
    view.unmount();
    renderPanelForNode(stale, created.nodeId);
    openOwnedConfigurationPanel();
    const card = screen.getByRole("article");
    fireEvent.click(within(card).getByText("Edit configuration"));
    const choice = within(card).getByRole("combobox", {
      name: /^Expire old versions/u,
    });
    expect(choice).toHaveValue("retired-flag");
    expect(
      within(choice).getByRole("option", { selected: true }),
    ).toHaveTextContent("Unavailable: retired-flag");
    const staleHash = screen.getByTestId("owned-content-hash").textContent;
    fireEvent.click(
      within(card).getByRole("button", { name: "Save configuration" }),
    );
    expect(within(card).getByRole("alert")).toHaveTextContent(
      "Choose true or false.",
    );
    await waitFor(() => expect(choice).toHaveFocus());
    expect(screen.getByTestId("owned-content-hash").textContent).toBe(
      staleHash,
    );
    fireEvent.change(choice, { target: { value: "false" } });
    fireEvent.click(
      within(card).getByRole("button", { name: "Save configuration" }),
    );
    await waitFor(() => {
      expect(screen.getByTestId("owned-content-hash").textContent).toBe(
        validHash,
      );
    });
  });

  it("requires explicit owned image choices and preserves unavailable saved values until corrected", async () => {
    const created = dispatchAddServiceCommand({
      document: loadAwsEditorArchitectureDocument(),
      catalog: awsEditorCatalog,
      createId: createCommandIdFactory(),
      serviceId: "aws.ecr.repository",
      configurationValues: {
        name: { kind: "string", value: "synthetic-owned-image" },
      },
    });
    const view = renderPanelForNode(created.document, created.nodeId);
    openOwnedConfigurationPanel();
    const section = ownedSlotSection("Image identities");
    fireEvent.click(within(section).getByText("Add Image identities"));
    const architecture = within(section).getByRole("combobox", {
      name: /^Architecture/u,
    });
    const manifest = within(section).getByRole("combobox", {
      name: /^Manifest type/u,
    });
    for (const choice of [architecture, manifest]) {
      expect(choice).toHaveValue("");
      expect(
        within(choice).getByRole("option", { selected: true }),
      ).toHaveTextContent("Choose a value");
    }
    expect(
      within(section).getByRole("combobox", { name: /^Publication status/u }),
    ).toHaveValue("external-publication-required");
    const digest = `sha256:${"a".repeat(64)}`;
    fireEvent.change(within(section).getByLabelText(/^Digest/u), {
      target: { value: digest },
    });
    const initialHash = screen.getByTestId("owned-content-hash").textContent;
    fireEvent.click(
      within(section).getByRole("button", { name: "Add image identities" }),
    );
    expect(within(section).getByRole("alert")).toBeVisible();
    expect(screen.getByTestId("owned-node-count")).toHaveTextContent("0");
    expect(screen.getByTestId("owned-content-hash").textContent).toBe(
      initialHash,
    );
    expect(within(section).getByLabelText(/^Digest/u)).toHaveValue(digest);
    fireEvent.change(architecture, { target: { value: "arm64" } });
    fireEvent.change(manifest, { target: { value: "oci-image" } });
    fireEvent.click(
      within(section).getByRole("button", { name: "Add image identities" }),
    );
    await waitFor(() => {
      expect(screen.getByTestId("owned-node-count")).toHaveTextContent("1");
    });
    expect(screen.getByTestId("owned-binding-edge-count")).toHaveTextContent(
      "1",
    );
    const saved = parseArchitectureDocument(
      JSON.parse(screen.getByTestId("owned-document").textContent),
    );
    const image = saved.nodes.find(
      (node) => node.semantic.serviceType === "aws.ecr.image-reference",
    );
    expect(image?.semantic.configuration.values).toMatchObject({
      architecture: { kind: "string", value: "arm64" },
      manifestType: { kind: "string", value: "oci-image" },
    });
    const stale = parseArchitectureDocument({
      ...saved,
      nodes: saved.nodes.map((node) =>
        node.id === image?.id
          ? {
              ...node,
              semantic: {
                ...node.semantic,
                configuration: {
                  ...node.semantic.configuration,
                  values: {
                    ...node.semantic.configuration.values,
                    architecture: { kind: "string", value: "retired-image" },
                  },
                },
              },
            }
          : node,
      ),
    });
    view.unmount();
    renderPanelForNode(stale, created.nodeId);
    openOwnedConfigurationPanel();
    const card = screen.getByRole("article");
    fireEvent.click(within(card).getByText("Edit configuration"));
    const savedArchitecture = within(card).getByRole("combobox", {
      name: /^Architecture/u,
    });
    expect(savedArchitecture).toHaveValue("retired-image");
    expect(
      within(savedArchitecture).getByRole("option", { selected: true }),
    ).toHaveTextContent("Unavailable: retired-image");
    const staleHash = screen.getByTestId("owned-content-hash").textContent;
    fireEvent.click(
      within(card).getByRole("button", { name: "Save configuration" }),
    );
    expect(within(card).getByRole("alert")).toBeVisible();
    expect(savedArchitecture).toHaveValue("retired-image");
    expect(screen.getByTestId("owned-content-hash").textContent).toBe(
      staleHash,
    );
    fireEvent.change(savedArchitecture, { target: { value: "x86_64" } });
    fireEvent.click(
      within(card).getByRole("button", { name: "Save configuration" }),
    );
    await waitFor(() => {
      expect(screen.getByTestId("owned-content-hash").textContent).not.toBe(
        staleHash,
      );
    });
    expect(screen.getByTestId("owned-node-count")).toHaveTextContent("1");
    expect(screen.getByTestId("owned-binding-edge-count")).toHaveTextContent(
      "1",
    );
    expect(savedArchitecture).toHaveValue("x86_64");
    expect(within(card).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps generic labels and the same technical-details structure across assistance modes", () => {
    const document = withSecurityGroup(loadAwsEditorArchitectureDocument());
    const structure = () => {
      const panel = screen.getByRole("region", {
        name: "Owned configurations",
      });
      return {
        slots: [
          ...panel.querySelectorAll<HTMLElement>(
            "[data-owned-configuration-slot]",
          ),
        ].map((section) => section.dataset["ownedConfigurationSlot"]),
        summaries: [...panel.querySelectorAll("summary")].map(
          (summary) => summary.textContent,
        ),
      };
    };

    const guided = renderPanelForNode(
      document,
      "node_network_security_group",
      "guided",
    );
    expect(
      screen.queryByRole("region", {
        name: "Owned configuration validation summary",
      }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Policies and related settings (0)")).toBeVisible();
    expect(screen.queryByLabelText("Policies and attachments")).toBeNull();
    const guidedStructure = structure();
    expect(guidedStructure.summaries).not.toContain("Technical details");
    expect(guidedStructure.summaries).not.toContain("Target readiness");
    guided.unmount();

    renderPanelForNode(document, "node_network_security_group", "professional");
    expect(structure()).toEqual(guidedStructure);
    expect(
      screen.queryByRole("region", {
        name: "Owned configuration validation summary",
      }),
    ).not.toBeInTheDocument();
  });

  it("creates, edits, removes, and restores one exact graph-backed configuration through accessible controls", async () => {
    const document = withSecurityGroup(loadAwsEditorArchitectureDocument());
    renderPanelForNode(document, "node_network_security_group");
    openOwnedConfigurationPanel();

    const ingressSection = ownedSlotSection("Ingress rules");
    fireEvent.click(within(ingressSection).getByText("Add Ingress rules"));
    expect(
      within(ingressSection).queryByText("Initial statement"),
    ).not.toBeInTheDocument();
    fireEvent.change(within(ingressSection).getByLabelText(/Protocol/u), {
      target: { value: "tcp" },
    });
    fireEvent.change(
      within(ingressSection).getByLabelText(/From port or ICMP type/u),
      { target: { value: "443" } },
    );
    fireEvent.change(
      within(ingressSection).getByLabelText(/To port or ICMP code/u),
      { target: { value: "443" } },
    );
    fireEvent.change(
      within(ingressSection).getByLabelText(/Source IPv4 CIDR/u),
      { target: { value: "10.0.0.0/24" } },
    );
    fireEvent.change(within(ingressSection).getByLabelText(/Purpose/u), {
      target: { value: "Reviewed application ingress" },
    });
    fireEvent.click(
      within(ingressSection).getByRole("button", {
        name: "Add ingress rules",
      }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("owned-node-count")).toHaveTextContent("1");
    });
    expect(screen.getByTestId("owned-binding-edge-count")).toHaveTextContent(
      "1",
    );
    expect(screen.getByTestId("owned-node-parent")).toHaveTextContent(
      "node_network_security_group",
    );
    expect(screen.getByTestId("history-label")).toHaveTextContent(
      "Add Ingress rules",
    );
    expect(screen.getByTestId("announcement")).toHaveTextContent(
      "Add Ingress rules applied through one Graph Command batch.",
    );

    const card = screen.getByRole("article");
    expect(within(card).getByText("Edit configuration")).toBeVisible();
    expect(
      within(card).getByRole("button", { name: "Remove configuration" }),
    ).toBeVisible();
    expect(
      within(card).queryByRole("button", { name: "Edit attachment" }),
    ).not.toBeInTheDocument();

    fireEvent.click(within(card).getByText("Edit configuration"));
    fireEvent.change(within(card).getByLabelText(/Purpose/u), {
      target: { value: "Allow reviewed application ingress" },
    });
    fireEvent.click(
      within(card).getByRole("button", { name: "Save configuration" }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("owned-node-description")).toHaveTextContent(
        "Allow reviewed application ingress",
      );
    });
    expect(screen.getByTestId("owned-node-count")).toHaveTextContent("1");
    expect(screen.getByTestId("owned-binding-edge-count")).toHaveTextContent(
      "1",
    );
    expect(screen.getByTestId("history-label")).toHaveTextContent(
      "Update Ingress rules",
    );

    fireEvent.click(
      within(card).getByRole("button", { name: "Remove configuration" }),
    );
    await waitFor(() => {
      expect(screen.getByTestId("owned-node-count")).toHaveTextContent("0");
    });
    expect(screen.getByTestId("owned-binding-edge-count")).toHaveTextContent(
      "0",
    );
    expect(screen.getByTestId("history-label")).toHaveTextContent(
      "Remove Ingress rules",
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Undo owned configuration" }),
    );
    await waitFor(() => {
      expect(screen.getByTestId("owned-node-count")).toHaveTextContent("1");
    });
    expect(screen.getByTestId("owned-binding-edge-count")).toHaveTextContent(
      "1",
    );
    expect(screen.getByTestId("owned-node-description")).toHaveTextContent(
      "Allow reviewed application ingress",
    );
  });

  it("exposes completed Lambda associations and removes, undoes, and redoes them as one exact batch", async () => {
    renderPanelForNode(
      loadAwsNetworkingVisualArchitectureDocument(),
      "node_networked_lambda",
    );
    openOwnedConfigurationPanel();

    const vpcAccessSection = ownedSlotSection("VPC access");
    const card = within(vpcAccessSection).getByRole("article");
    expect(within(card).getByText("Current associations (3)")).toBeVisible();
    fireEvent.click(within(card).getByText("Current associations (3)"));
    expect(
      within(card).getByText(/Uses subnet · Private subnet A/u),
    ).toBeVisible();
    expect(
      within(card).getByText(/Uses subnet · Private subnet B/u),
    ).toBeVisible();
    expect(
      within(card).getByText(
        /Uses security group · Application security group/u,
      ),
    ).toBeVisible();
    expect(
      within(card).getAllByText("Generated · reviewed cleanup"),
    ).toHaveLength(3);
    expect(
      within(card).getByText(/disconnect 3 current associations/u),
    ).toBeVisible();
    expect(screen.getByTestId("owned-node-count")).toHaveTextContent("1");
    expect(screen.getByTestId("owned-binding-edge-count")).toHaveTextContent(
      "4",
    );

    fireEvent.click(
      within(card).getByRole("button", {
        name: "Remove configuration and 3 associations",
      }),
    );
    await waitFor(() => {
      expect(screen.getByTestId("owned-node-count")).toHaveTextContent("0");
    });
    expect(screen.getByTestId("owned-binding-edge-count")).toHaveTextContent(
      "0",
    );
    expect(screen.getByTestId("history-label")).toHaveTextContent(
      "Remove VPC access",
    );
    expect(screen.getByTestId("announcement")).toHaveTextContent(
      "Remove VPC access applied through one Graph Command batch.",
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Undo owned configuration" }),
    );
    await waitFor(() => {
      expect(screen.getByTestId("owned-node-count")).toHaveTextContent("1");
    });
    expect(screen.getByTestId("owned-binding-edge-count")).toHaveTextContent(
      "4",
    );
    expect(
      within(ownedSlotSection("VPC access")).getByText(
        "Current associations (3)",
      ),
    ).toBeVisible();

    fireEvent.click(
      screen.getByRole("button", { name: "Redo owned configuration" }),
    );
    await waitFor(() => {
      expect(screen.getByTestId("owned-node-count")).toHaveTextContent("0");
    });
    expect(screen.getByTestId("owned-binding-edge-count")).toHaveTextContent(
      "0",
    );
    expect(screen.getByTestId("announcement")).toHaveTextContent(
      "Redid Remove VPC access.",
    );
  });

  it("starts a reviewed retarget from an exact generated association row", async () => {
    renderPanelForNode(
      loadAwsNetworkingVisualArchitectureDocument(),
      "node_public_route_table",
    );
    openOwnedConfigurationPanel();

    const associationSection = ownedSlotSection("Subnet associations");
    const heading = within(associationSection).getByRole("heading", {
      level: 5,
      name: "Public subnet B association",
    });
    const card = heading.closest("article");
    if (card === null) {
      throw new TypeError("The exact route-table association card is missing.");
    }
    fireEvent.click(
      within(card).getByText("Current associations (1)", { exact: true }),
    );
    expect(
      within(card).getByText(
        /Associates subnet · Public subnet B · 10\.0\.2\.0\/24/u,
      ),
    ).toBeVisible();
    const changeSubnet = within(card).getByRole("button", {
      name: "Change Subnet for Public subnet B association",
    });
    expect(changeSubnet).toBeVisible();

    fireEvent.click(changeSubnet);
    await waitFor(() => {
      expect(screen.getByTestId("connection-workflow")).toHaveTextContent(
        "open",
      );
    });
    expect(screen.getByTestId("announcement")).toHaveTextContent(
      "Connection settings are ready to edit. Nothing has changed yet.",
    );
    expect(screen.getByTestId("history-label")).toHaveTextContent("none");
  });

  it("starts the shared connection flow from exact hidden configuration ports", async () => {
    renderPanelForNode(loadAwsEditorArchitectureDocument(), "node_api_handler");
    openOwnedConfigurationPanel();

    const vpcAccessSection = ownedSlotSection("VPC access");
    fireEvent.click(within(vpcAccessSection).getByText("Add VPC access"));
    fireEvent.click(
      within(vpcAccessSection).getByRole("button", {
        name: "Add vpc access",
      }),
    );
    await waitFor(() => {
      expect(screen.getByTestId("owned-node-count")).toHaveTextContent("1");
    });

    const card = screen.getByRole("article");
    const associations = within(card).getByRole("group", {
      name: "VPC access associations",
    });
    expect(
      within(associations).getByRole("button", {
        name: "Choose Subnets for VPC access",
      }),
    ).toBeVisible();
    expect(
      within(associations).getByRole("button", {
        name: "Choose Security groups for VPC access",
      }),
    ).toBeVisible();
    expect(
      within(associations).queryByRole("button", {
        name: /Lambda function/u,
      }),
    ).not.toBeInTheDocument();

    fireEvent.click(
      within(associations).getByRole("button", {
        name: "Choose Subnets for VPC access",
      }),
    );
    await waitFor(() => {
      expect(screen.getByTestId("connection-workflow")).toHaveTextContent(
        "open",
      );
    });
    expect(screen.getByTestId("owned-node-count")).toHaveTextContent("1");
    expect(screen.getByTestId("owned-binding-edge-count")).toHaveTextContent(
      "1",
    );
  });
});
