import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
import type { EditorCatalog } from "../model/editor-catalog.js";
import {
  EditorSessionProvider,
  useEditorDocumentSession,
  useEditorSessionState,
} from "../session/index.js";
import { ServiceCatalogPanel } from "./ServiceCatalogPanel.js";

function createCommandIdFactory(): () => string {
  let sequence = 0;

  return () => {
    sequence += 1;
    return `operation_catalog_component_${String(sequence).padStart(4, "0")}`;
  };
}

function createModeStorage(initialMode: ExperienceMode): ModePreferenceStorage {
  return {
    getItem: vi.fn(() => initialMode),
    setItem: vi.fn(),
  };
}

function CatalogSessionProbe() {
  const session = useEditorDocumentSession();
  const recentServiceIds = useEditorSessionState(
    (state) => state.recentServiceIds,
  );
  const selection = useEditorSessionState((state) => state.selection);
  const announcement = useEditorSessionState((state) => state.liveAnnouncement);

  if (session.status !== "ready") {
    return <output data-testid="session-status">invalid</output>;
  }

  const lambdaNodes = session.document.nodes
    .filter((node) => node.semantic.serviceType === "aws.lambda.function")
    .sort((left, right) => left.id.localeCompare(right.id));

  return (
    <div>
      <output data-testid="session-status">ready</output>
      <output data-testid="content-hash">{session.hashes.contentHash}</output>
      <output data-testid="visual-hash">{session.hashes.visualHash}</output>
      <output data-testid="node-count">
        {String(session.document.nodes.length)}
      </output>
      <output data-testid="all-node-ids">
        {JSON.stringify(session.document.nodes.map((node) => node.id).sort())}
      </output>
      <output data-testid="lambda-node-ids">
        {JSON.stringify(lambdaNodes.map((node) => node.id))}
      </output>
      <output data-testid="secret-configurations">
        {JSON.stringify(
          session.document.nodes
            .filter(
              (node) =>
                node.semantic.serviceType === "aws.secretsmanager.secret",
            )
            .map((node) => node.semantic.configuration.values),
        )}
      </output>
      <output data-testid="attested-configurations">
        {JSON.stringify(
          session.document.nodes
            .filter((node) =>
              [
                "aws.route53.public-hosted-zone",
                "aws.cloudfront.distribution",
              ].includes(node.semantic.serviceType),
            )
            .map((node) => node.semantic.configuration.values),
        )}
      </output>
      <output data-testid="ec2-configurations">
        {JSON.stringify(
          session.document.nodes
            .filter((node) => node.semantic.serviceType === "aws.ec2.instance")
            .map((node) => node.semantic.configuration.values),
        )}
      </output>
      <output data-testid="lambda-deployment-keys">
        {JSON.stringify(lambdaNodes.map((node) => node.semantic.deploymentKey))}
      </output>
      <output data-testid="recent-service-ids">
        {JSON.stringify(recentServiceIds)}
      </output>
      <output data-testid="selection">
        {selection === null ? "none" : `${selection.kind}:${selection.id}`}
      </output>
      <output data-testid="announcement">{announcement}</output>
    </div>
  );
}

function setViewport(width: number, height = 900): void {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: width,
  });
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: height,
  });
  window.dispatchEvent(new Event("resize"));
}

function renderCatalog(
  initialMode: ExperienceMode = "guided",
  catalog: EditorCatalog = awsEditorCatalog,
) {
  return render(
    <NotificationProvider>
      <ModePreferenceProvider
        actorId="service-catalog-component-test"
        storage={createModeStorage(initialMode)}
      >
        <EditorSessionProvider
          catalog={catalog}
          createId={createCommandIdFactory()}
          document={loadAwsEditorArchitectureDocument()}
          iconRegistry={awsIconRegistry}
        >
          <ModeSwitch />
          <CatalogSessionProbe />
          <ServiceCatalogPanel />
        </EditorSessionProvider>
      </ModePreferenceProvider>
    </NotificationProvider>,
  );
}

function catalogPanel(): HTMLElement {
  const panel = document.querySelector<HTMLElement>(
    ".service-catalog-panel[data-catalog-mode]",
  );
  if (panel === null) {
    throw new Error("The ready service catalog panel did not render.");
  }
  return panel;
}

function serviceCard(serviceId: string): HTMLElement {
  const card = document.querySelector<HTMLElement>(
    `[data-service-id="${serviceId}"]`,
  );
  if (card === null) {
    throw new Error(`Catalog service ${serviceId} did not render.`);
  }
  return card;
}

function catalogGroup(groupId: string): HTMLDetailsElement {
  const group = document.querySelector<HTMLDetailsElement>(
    `[data-catalog-group="${groupId}"]`,
  );
  if (group === null) {
    throw new Error(`Catalog group ${groupId} did not render.`);
  }
  return group;
}

function renderedServiceIds(): readonly string[] {
  return [...document.querySelectorAll<HTMLElement>("[data-service-id]")]
    .map((card) => card.dataset["serviceId"])
    .filter((serviceId): serviceId is string => serviceId !== undefined)
    .sort();
}

function expectedVisibleServiceIds(): readonly string[] {
  return awsEditorCatalog.services
    .filter(
      (service) =>
        service.deployable &&
        service.iconId !== null &&
        service.catalogVisibility !== "configuration" &&
        (!service.catalogGroup ||
          service.catalogGroup.primaryServiceType === service.serviceType),
    )
    .map((service) => service.serviceType)
    .sort();
}

function elementBySelector(parent: ParentNode, selector: string): HTMLElement {
  const element = parent.querySelector<HTMLElement>(selector);
  if (element === null) {
    throw new Error("Expected catalog slot " + selector + " to render.");
  }
  return element;
}

function directChildSlots(element: Element): readonly string[] {
  return [...element.children].map(
    (child) =>
      child.tagName.toLowerCase() + ":" + (child.getAttribute("class") ?? ""),
  );
}

function catalogStructureSignature() {
  const panel = catalogPanel();
  const controls = elementBySelector(panel, ".service-catalog-panel__controls");
  const heading = elementBySelector(controls, ".panel-heading");
  const searchField = elementBySelector(controls, ".cm-form-field");
  const lambdaCard = serviceCard("aws.lambda.function");
  const cardHeader = elementBySelector(
    lambdaCard,
    ".service-catalog-card__header",
  );
  const cardIdentity = elementBySelector(
    cardHeader,
    ".service-catalog-card__identity",
  );

  return {
    card: directChildSlots(lambdaCard),
    cardHeader: directChildSlots(cardHeader),
    cardIdentity: directChildSlots(cardIdentity),
    controls: directChildSlots(controls),
    heading: directChildSlots(heading),
    panel: directChildSlots(panel),
    searchField: directChildSlots(searchField),
  };
}

describe("ServiceCatalogPanel", () => {
  beforeEach(() => {
    setViewport(1024);
  });

  it("requires caller supplied EC2 image and root declarations before adding private compute", async () => {
    renderCatalog();
    fireEvent.click(
      within(serviceCard("aws.ec2.instance")).getByRole("button", {
        name: "Set up EC2 instance",
      }),
    );
    const dialog = screen.getByRole("dialog", { name: "Set up EC2 instance" });
    const labels = [
      /AMI ID/u,
      /AMI Region/u,
      /AMI architecture/u,
      /AMI root device/u,
      /AMI minimum root size/u,
      /Instance type/u,
      /Root disk size/u,
    ];
    const controls = labels.map((label) => {
      const field = within(dialog).getByLabelText(label, {
        selector: "input,select",
      });
      expect(field).toHaveProperty("value", "");
      if (field instanceof HTMLSelectElement) {
        expect(field.selectedOptions[0]).toHaveTextContent("Choose a value");
      }
      return field;
    });
    const imageHelpTrigger = within(dialog).getByRole("button", {
      name: "More information about AMI ID",
    });
    imageHelpTrigger.focus();
    const imageHelp = await within(dialog).findByRole("dialog", {
      name: "AMI ID field information",
    });
    expect(imageHelp).toHaveTextContent("exact regional AMI ID");
    expect(imageHelp).toHaveTextContent("must match ^ami-[0-9a-f]{17}$");
    fireEvent.keyDown(imageHelpTrigger, { key: "Escape" });
    expect(dialog).toBeVisible();
    expect(imageHelpTrigger).toHaveFocus();
    expect(
      within(dialog).queryByRole("dialog", {
        name: "AMI ID field information",
      }),
    ).toBeNull();
    expect(
      within(dialog).queryByLabelText(/User data|Password|SSH key/iu),
    ).toBeNull();
    const add = within(dialog).getByRole("button", { name: "Add to canvas" });
    fireEvent.click(add);
    await waitFor(() =>
      expect(within(dialog).getByRole("alert")).toHaveTextContent(
        "Check the highlighted settings",
      ),
    );
    expect(screen.getByTestId("ec2-configurations")).toHaveTextContent("[]");
    const values = [
      "ami-0123456789abcdef0",
      "us-east-1",
      "x86_64",
      "/dev/xvda",
      "8",
      "t3.small",
      "30",
    ];
    controls.forEach((field, index) =>
      fireEvent.change(field, { target: { value: values[index] } }),
    );
    fireEvent.click(add);
    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "Set up EC2 instance" }),
      ).toBeNull();
    });
    expect(
      JSON.parse(screen.getByTestId("ec2-configurations").textContent),
    ).toMatchObject([
      {
        publicIpv4: { kind: "boolean", value: false },
        rootEncrypted: { kind: "boolean", value: true },
        metadataAuthentication: { kind: "string", value: "required" },
        rootDeleteOnTermination: { kind: "boolean", value: false },
      },
    ]);
  });

  it("requires an explicit real IAM profile name", async () => {
    renderCatalog();
    fireEvent.click(
      within(serviceCard("aws.iam.instance-profile")).getByRole("button", {
        name: "Set up IAM instance profile",
      }),
    );
    const dialog = screen.getByRole("dialog", {
      name: "Set up IAM instance profile",
    });
    const name = within(dialog).getByRole("textbox", {
      name: /Instance profile name/u,
    });
    expect(name).toHaveValue("");
    fireEvent.change(name, {
      target: { value: "arn:aws:iam::000000000000:role/incorrect" },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Add to canvas" }),
    );
    await waitFor(() =>
      expect(within(dialog).getByRole("alert")).toHaveTextContent(
        "Check the highlighted settings",
      ),
    );
    fireEvent.change(name, { target: { value: "synthetic-instance-profile" } });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Add to canvas" }),
    );
    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "Set up IAM instance profile" }),
      ).toBeNull();
    });
  });

  it.each([
    [
      "guided",
      "aws.route53.public-hosted-zone",
      "domainControlAttested",
      { domainName: "example.test", comment: "Synthetic owned domain" },
    ],
    [
      "guided",
      "aws.cloudfront.distribution",
      "publicContentAttested",
      {
        enabled: true,
        comment: "Synthetic public content",
        defaultRootObject: "index.html",
        priceClass: "PriceClass_100",
      },
    ],
  ] as const)(
    "requires explicit attestation in %s setup for %s",
    async (mode, serviceType, property, entered) => {
      renderCatalog(mode);
      const service = awsEditorCatalog.services.find(
        (candidate) => candidate.serviceType === serviceType,
      );
      if (service === undefined) throw new Error("Missing attestation service");
      fireEvent.click(
        within(serviceCard(serviceType)).getByRole("button", {
          name: `Set up ${service.displayName}`,
        }),
      );
      const dialog = screen.getByRole("dialog", {
        name: `Set up ${service.displayName}`,
      });
      const fieldFor = (key: string) => {
        const field = service.configuration.fields.find(
          (candidate) => candidate.property === key,
        );
        if (field === undefined) throw new Error("Missing setup field");
        return within(dialog).getByLabelText(new RegExp(field.label, "u"), {
          selector: "input,select",
        });
      };
      const attestation = fieldFor(property);
      expect(attestation.tagName).toBe("SELECT");
      expect(attestation).toBeEnabled();
      expect(attestation).toHaveValue("");
      for (const [key, value] of Object.entries(entered)) {
        const input = fieldFor(key);
        fireEvent.change(input, { target: { value: String(value) } });
      }
      fireEvent.click(
        within(dialog).getByRole("button", { name: "Add to canvas" }),
      );
      await waitFor(() =>
        expect(within(dialog).getByRole("alert")).toHaveTextContent(
          "Check the highlighted settings",
        ),
      );
      expect(screen.getByTestId("attested-configurations")).toHaveTextContent(
        "[]",
      );
      fireEvent.change(attestation, { target: { value: "true" } });
      expect(attestation).toHaveValue("true");
      fireEvent.click(
        within(dialog).getByRole("button", { name: "Add to canvas" }),
      );
      await waitFor(() => {
        expect(
          screen.queryByRole("dialog", {
            name: `Set up ${service.displayName}`,
          }),
        ).toBeNull();
      });
      expect(
        JSON.parse(screen.getByTestId("attested-configurations").textContent),
      ).toEqual([
        expect.objectContaining({
          [property]: { kind: "boolean", value: true },
        }),
      ]);
    },
  );

  it("sets up retained Secrets Manager metadata with an explicit name and no value input", async () => {
    renderCatalog();
    fireEvent.click(
      within(serviceCard("aws.secretsmanager.secret")).getByRole("button", {
        name: "Set up Secrets Manager secret",
      }),
    );
    const dialog = screen.getByRole("dialog", {
      name: "Set up Secrets Manager secret",
    });
    const name = within(dialog).getByRole("textbox", { name: /Secret name/u });
    expect(name).toBeEnabled();
    expect(name).toHaveValue("");
    expect(
      within(dialog).getByRole("combobox", { name: /Value source/u }),
    ).toHaveValue("external-population");
    expect(
      within(dialog).getByRole("combobox", { name: /Encryption key/u }),
    ).toHaveValue("aws-managed");
    expect(
      within(dialog).getByRole("textbox", { name: /Retain secret/u }),
    ).toHaveValue("true");
    expect(
      within(dialog).getByRole("textbox", { name: /Retain secret/u }),
    ).toHaveAttribute("readonly");
    expect(
      within(dialog).queryByLabelText(/Secret value|Secret string|Password/u),
    ).toBeNull();
    expect(dialog).toHaveTextContent("Populate it externally");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Add to canvas" }),
    );
    await waitFor(() =>
      expect(within(dialog).getByRole("alert")).toHaveTextContent(
        "Check the highlighted settings",
      ),
    );
    expect(screen.getByTestId("secret-configurations")).toHaveTextContent("[]");
    fireEvent.change(name, { target: { value: "application/credential" } });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Add to canvas" }),
    );
    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "Set up Secrets Manager secret" }),
      ).toBeNull();
    });
    expect(
      JSON.parse(screen.getByTestId("secret-configurations").textContent),
    ).toEqual([
      {
        name: { kind: "string", value: "application/credential" },
        description: {
          kind: "string",
          value: "Externally populated application secret",
        },
        encryptionMode: { kind: "string", value: "aws-managed" },
        valueMode: { kind: "string", value: "external-population" },
        recoveryWindowDays: { kind: "integer", value: 30 },
        preventDestroy: { kind: "boolean", value: true },
      },
    ]);
  });

  it("keeps header, search, and card slots structurally identical across modes", () => {
    const guidedRender = renderCatalog("guided");
    const guidedStructure = catalogStructureSignature();
    const guidedLambda = serviceCard("aws.lambda.function");

    expect(
      screen.queryByText(/Choose a service by name or purpose/u),
    ).toBeNull();
    expect(
      screen.getByRole("searchbox", { name: "Search services" }),
    ).toHaveAttribute("placeholder", "Search by name or purpose");
    fireEvent.click(screen.getByRole("button", { name: "Catalog help" }));
    expect(
      screen.getByRole("dialog", { name: "Catalog help" }),
    ).toHaveTextContent(
      "Details and limitations come from the exact bundled catalog.",
    );
    expect(
      elementBySelector(guidedLambda, ".service-catalog-card__identity span"),
    ).toHaveTextContent(
      "Runs reviewed request, event, message, and workflow operations with explicit producer and consumer relationships.",
    );

    guidedRender.unmount();
    renderCatalog("professional");

    expect(catalogStructureSignature()).toEqual(guidedStructure);
    expect(
      screen.queryByText(/Choose a service by name or purpose/u),
    ).toBeNull();
    expect(
      screen.getByRole("searchbox", { name: "Search services" }),
    ).toHaveAttribute("placeholder", "Search by name or purpose");
    fireEvent.click(screen.getByRole("button", { name: "Catalog help" }));
    expect(
      screen.getByRole("dialog", { name: "Catalog help" }),
    ).toHaveTextContent(
      "Details and limitations come from the exact bundled catalog.",
    );
    expect(
      elementBySelector(
        serviceCard("aws.lambda.function"),
        ".service-catalog-card__identity span",
      ),
    ).toHaveTextContent(
      "Runs reviewed request, event, message, and workflow operations with explicit producer and consumer relationships.",
    );
  });

  it("uses labeled Details and Add actions with the correct emphasis", () => {
    renderCatalog();

    const lambda = serviceCard("aws.lambda.function");
    const actions = lambda.querySelector<HTMLElement>(
      ".service-catalog-card__actions",
    );
    if (actions === null) {
      throw new Error("Expected the Lambda service-card action row.");
    }

    const details = within(actions).getByRole("button", {
      name: "Show details for Lambda function",
    });
    const add = within(actions).getByRole("button", {
      name: "Add Lambda function to canvas",
    });

    expect(actions.lastElementChild).toBe(details);
    expect(details).toHaveTextContent("Details");
    expect(details).toHaveAttribute("data-size", "compact");
    expect(details).toHaveAttribute("data-variant", "secondary");
    expect(add).toHaveTextContent("Add");
    expect(add).toHaveAttribute("data-size", "compact");
    expect(add).toHaveAttribute("data-variant", "primary");
    expect(add).toBeEnabled();

    const ec2 = serviceCard("aws.ec2.instance");
    expect(ec2).toHaveTextContent(
      "Enter the required service settings before adding it to your project.",
    );
    expect(
      within(ec2).getByRole("button", { name: "Set up EC2 instance" }),
    ).toBeEnabled();

    const availabilityZone = serviceCard("aws.ec2.availability-zone");
    expect(availabilityZone).toHaveTextContent("Add a parent first:");
    expect(availabilityZone).toHaveTextContent("Virtual private cloud");
    expect(
      within(availabilityZone).getByRole("button", {
        name: "Add a parent before Availability Zone",
      }),
    ).toBeDisabled();
  });

  it("renders the AWS display name as the primary heading for the complete professional service set", () => {
    renderCatalog("professional");

    const expectedServiceIds = expectedVisibleServiceIds();

    const professionalLambda = serviceCard("aws.lambda.function");
    expect(catalogPanel()).toHaveAttribute("data-catalog-mode", "professional");
    expect(renderedServiceIds()).toEqual(expectedServiceIds);
    expect(
      within(professionalLambda).getByRole("heading", {
        level: 3,
        name: "Lambda function",
      }),
    ).toBeVisible();
    expect(professionalLambda).not.toHaveTextContent("aws.lambda.function");
  });

  it("searches catalog-authored service names and plain-language capability text", () => {
    renderCatalog();

    const expectedServiceIds = expectedVisibleServiceIds();
    const guidedLambda = serviceCard("aws.lambda.function");
    expect(catalogPanel()).toHaveAttribute("data-catalog-mode", "guided");
    expect(renderedServiceIds()).toEqual(expectedServiceIds);
    expect(guidedLambda).toHaveTextContent(
      "Runs reviewed request, event, message, and workflow operations with explicit producer and consumer relationships.",
    );
    expect(
      within(guidedLambda).getByRole("heading", {
        level: 3,
        name: "Lambda function",
      }),
    ).toBeVisible();
    expect(guidedLambda).not.toHaveTextContent("aws.lambda.function");

    const search = screen.getByRole("searchbox", {
      name: "Search services",
    });

    fireEvent.change(search, { target: { value: "DynamoDB table" } });

    expect(serviceCard("aws.dynamodb.table")).toBeVisible();
    expect(renderedServiceIds()).not.toContain("aws.cognito.user-pool");

    fireEvent.change(search, {
      target: { value: "bounded application workload" },
    });

    expect(renderedServiceIds()).toContain("aws.lambda.function");
    expect(serviceCard("aws.lambda.function")).toHaveTextContent(
      "Runs reviewed request, event, message, and workflow operations with explicit producer and consumer relationships.",
    );
  });

  it("keeps a named scroll region with keyboard-accessible native category disclosures", () => {
    renderCatalog();

    const results = screen.getByRole("region", {
      name: "Catalog service results",
    });
    expect(results).toHaveAttribute("id", "service-catalog-results");
    expect(results).toHaveAttribute("data-catalog-scroll-region");
    expect(results).not.toHaveAttribute("tabindex");

    const rootPlaceable = catalogGroup("root-placeable");
    expect(rootPlaceable).toHaveAttribute("open");
    const rootSummary = rootPlaceable.querySelector("summary");
    if (rootSummary === null) {
      throw new Error("Expected the root-placeable disclosure summary.");
    }
    rootSummary.focus();
    expect(rootSummary).toHaveFocus();

    const parentRequired = catalogGroup("parent-required");
    expect(parentRequired).toHaveAttribute("open");
    const parentSummary = parentRequired.querySelector("summary");
    if (parentSummary === null) {
      throw new Error("Expected the parent-required disclosure summary.");
    }
    fireEvent.click(parentSummary);
    expect(parentRequired).not.toHaveAttribute("open");

    const search = screen.getByRole("searchbox", {
      name: "Search services",
    });
    fireEvent.change(search, {
      target: { value: "aws.lambda.function" },
    });
    const firstSearchGroup = catalogGroup("root-placeable");
    expect(firstSearchGroup).toHaveAttribute("open");
    const firstSearchSummary = firstSearchGroup.querySelector("summary");
    if (firstSearchSummary === null) {
      throw new Error("Expected the filtered category disclosure summary.");
    }
    fireEvent.click(firstSearchSummary);
    expect(firstSearchGroup).not.toHaveAttribute("open");

    fireEvent.change(search, {
      target: { value: "Lambda function" },
    });
    expect(catalogGroup("root-placeable")).toHaveAttribute("open");
  });

  it("opens labeled service information on focus, hover, and click without hiding critical warnings", () => {
    renderCatalog();

    const lambdaCard = serviceCard("aws.lambda.function");
    const information = within(lambdaCard).getByRole("button", {
      name: "More information about Lambda function",
    });
    const informationRoot = information.closest(".cm-popover");
    if (informationRoot === null) {
      throw new Error("Expected the shared service-information popover.");
    }

    fireEvent.focus(information);
    expect(
      screen.getByRole("dialog", {
        name: "Lambda function service information",
      }),
    ).toHaveTextContent(
      /Availability.*Infrastructure as Code support.*Connections.*Technical identifier/isu,
    );
    const informationDialog = screen.getByRole("dialog", {
      name: "Lambda function service information",
    });
    expect(informationDialog).toHaveTextContent(
      "cloudformation: implemented mapping",
    );
    expect(informationDialog).toHaveTextContent(
      "terraform: implemented mapping",
    );
    expect(informationDialog).toHaveTextContent("aws.lambda.function");
    fireEvent.blur(information, { relatedTarget: document.body });
    expect(
      screen.queryByRole("dialog", {
        name: "Lambda function service information",
      }),
    ).not.toBeInTheDocument();

    fireEvent.mouseEnter(informationRoot);
    expect(
      screen.getByRole("dialog", {
        name: "Lambda function service information",
      }),
    ).toBeVisible();
    fireEvent.mouseLeave(informationRoot);

    fireEvent.click(information);
    expect(
      screen.getByRole("dialog", {
        name: "Lambda function service information",
      }),
    ).toHaveTextContent("aws.lambda.function");
    fireEvent.mouseLeave(informationRoot);
    expect(
      screen.getByRole("dialog", {
        name: "Lambda function service information",
      }),
    ).toBeVisible();
    fireEvent.click(information);
    expect(information).toHaveFocus();

    const parentRequired = catalogGroup("parent-required");
    const parentSummary = parentRequired.querySelector("summary");
    if (parentSummary === null) {
      throw new Error("Expected the parent-required disclosure summary.");
    }
    fireEvent.click(parentSummary);
    expect(
      document.querySelector('[data-service-id="aws.iam.policy-statement"]'),
    ).toBeNull();
  });

  it("opens structured service details in a labeled dialog and restores focus after Escape", () => {
    renderCatalog();

    const details = within(serviceCard("aws.lambda.function")).getByRole(
      "button",
      { name: "Show details for Lambda function" },
    );
    details.focus();
    fireEvent.click(details);

    const dialog = screen.getByRole("dialog", {
      name: "Lambda function details",
    });
    expect(dialog).toBeVisible();
    expect(
      within(dialog).getByRole("heading", {
        level: 2,
        name: "Lambda function details",
      }),
    ).toHaveFocus();
    for (const section of [
      "What it does",
      "Common uses",
      "Configuration readiness",
      "Available connections",
      "IaC support",
      "Known limitations",
    ]) {
      expect(
        within(dialog).getByRole("heading", { level: 3, name: section }),
      ).toBeVisible();
    }
    expect(dialog).toHaveTextContent("API Gateway HTTP API");
    expect(dialog).toHaveTextContent("aws.lambda.function");
    expect(dialog).toHaveTextContent(/\d+ input · \d+ output/u);
    expect(details).toHaveAttribute("aria-controls", "service-catalog-preview");

    fireEvent.keyDown(document, { key: "Escape" });

    expect(details).toHaveFocus();
    expect(
      screen.queryByRole("dialog", { name: "Lambda function details" }),
    ).not.toBeInTheDocument();
  });

  it("adds through the explicit button, records recent use, and shows the approved service icon", () => {
    renderCatalog();

    const beforeHash = screen.getByTestId("content-hash").textContent;
    const lambdaCard = serviceCard("aws.lambda.function");
    const approvedIcon = lambdaCard.querySelector<HTMLElement>(
      '[data-icon-resolution="approved"]',
    );

    expect(approvedIcon).not.toBeNull();
    expect(
      approvedIcon?.querySelector("img.cm-provider-icon__asset"),
    ).not.toBeNull();

    fireEvent.click(
      within(lambdaCard).getByRole("button", {
        name: "Add Lambda function to canvas",
      }),
    );

    expect(screen.getByTestId("node-count")).toHaveTextContent("5");
    expect(screen.getByTestId("lambda-node-ids")).toHaveTextContent(
      '["node_api_handler","node_lambda_function"]',
    );
    expect(screen.getByTestId("selection")).toHaveTextContent(
      "node:node_lambda_function",
    );
    expect(screen.getByTestId("content-hash").textContent).not.toBe(beforeHash);
    expect(screen.getByTestId("recent-service-ids")).toHaveTextContent(
      '["aws.lambda.function"]',
    );
    expect(
      screen.getByRole("heading", { name: "Recently used" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("dialog", { name: "Lambda function details" }),
    ).not.toBeInTheDocument();
    const recentDetails = screen.getByRole("button", {
      name: "Show details for recently used Lambda function",
    });
    expect(recentDetails).not.toHaveAttribute("aria-controls");
    fireEvent.click(recentDetails);
    expect(recentDetails).toHaveAttribute(
      "aria-controls",
      "service-catalog-preview",
    );
    expect(
      screen.getByRole("dialog", { name: "Lambda function details" }),
    ).toBeVisible();
    const closeDetails = screen.getByRole("button", {
      name: "Close details for Lambda function",
    });
    fireEvent.click(closeDetails);
    expect(recentDetails).toHaveFocus();
    expect(
      screen.queryByRole("dialog", { name: "Lambda function details" }),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("announcement")).toHaveTextContent(
      "Lambda function added through a Graph Command.",
    );
  });

  it("adds repeatedly from the native drag/add action with unique stable identities", () => {
    renderCatalog();

    const firstCard = serviceCard("aws.lambda.function");
    const firstKeyboardAdd = within(firstCard).getByRole("button", {
      name: "Drag or add Lambda function to canvas",
    });
    fireEvent.click(firstKeyboardAdd);

    const secondCard = serviceCard("aws.lambda.function");
    const secondKeyboardAdd = within(secondCard).getByRole("button", {
      name: "Drag or add Lambda function to canvas",
    });
    fireEvent.click(secondKeyboardAdd);

    expect(screen.getByTestId("node-count")).toHaveTextContent("6");
    expect(screen.getByTestId("lambda-node-ids")).toHaveTextContent(
      '["node_api_handler","node_lambda_function","node_lambda_function_2"]',
    );
    expect(screen.getByTestId("lambda-deployment-keys")).toHaveTextContent(
      '["api_handler","lambda_function","lambda_function_2"]',
    );
    expect(screen.getByTestId("selection")).toHaveTextContent(
      "node:node_lambda_function_2",
    );
    expect(screen.getByTestId("recent-service-ids")).toHaveTextContent(
      '["aws.lambda.function"]',
    );
  });

  it("finds owner-managed settings without offering an independent Add action", () => {
    renderCatalog();
    fireEvent.change(
      screen.getByRole("searchbox", { name: "Search services" }),
      {
        target: { value: "aws.iam.policy-statement" },
      },
    );
    expect(
      document.querySelector('[data-catalog-group="service-settings"]'),
    ).toBeNull();
    expect(renderedServiceIds()).not.toContain("aws.iam.policy-statement");
    fireEvent.click(
      screen.getByRole("button", { name: "Show all catalog entries" }),
    );
    expect(
      screen.getByRole("searchbox", { name: "Search services" }),
    ).toHaveFocus();
    expect(catalogGroup("parent-required")).toHaveAttribute("open");
  });

  it("restores search focus before clearing an empty result", () => {
    renderCatalog();

    const search = screen.getByRole("searchbox", {
      name: "Search services",
    });
    fireEvent.change(search, {
      target: { value: "no catalog service matches this" },
    });
    const clearSearch = screen.getByRole("button", { name: "Clear search" });
    clearSearch.focus();

    fireEvent.click(clearSearch);

    expect(search).toHaveFocus();
    expect(search).toHaveValue("");
    expect(screen.queryByText("No services match this search")).toBeNull();
  });

  it("keeps automatic Add but removes drag semantics when no phone canvas exists", () => {
    setViewport(390, 844);
    renderCatalog();

    const lambdaCard = serviceCard("aws.lambda.function");
    expect(
      within(lambdaCard).queryByRole("button", {
        name: "Drag or add Lambda function to canvas",
      }),
    ).not.toBeInTheDocument();
    expect(
      within(lambdaCard).getByRole("button", {
        name: "Add Lambda function to canvas",
      }),
    ).toBeEnabled();
    expect(lambdaCard).toHaveTextContent(
      "Drag placement requires a tablet or desktop canvas.",
    );
  });

  it("renders catalog-load failure distinctly from catalog-empty and search-empty states", () => {
    const failedCatalog: EditorCatalog = {
      ...awsEditorCatalog,
      invalidEntries: [],
      serviceListState: {
        kind: "failed",
        reason: "The synthetic service list failed safely.",
      },
      services: [],
    };

    renderCatalog("guided", failedCatalog);

    expect(
      screen.getByRole("heading", {
        name: "Catalog services could not be loaded",
      }),
    ).toBeVisible();
    expect(
      screen.getByText("The synthetic service list failed safely."),
    ).toBeVisible();
    expect(
      screen.queryByText("No services match this search"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("This catalog has no services"),
    ).not.toBeInTheDocument();
  });
});
