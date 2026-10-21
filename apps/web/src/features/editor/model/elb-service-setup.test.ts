import { configurationKeySchema } from "@cloudmarkup/schemas";
import { describe, expect, it } from "vitest";
import { applyGraphCommand } from "@cloudmarkup/domain";
import { awsCatalogV1 } from "@cloudmarkup/provider-aws/catalog";
import { awsEditorCatalog } from "../../../provider-catalog/aws-editor-catalog.js";
import { loadAwsEditorArchitectureDocument } from "../../../provider-catalog/aws-editor-fixture.js";
import { awsOwnedPolicyGraphDescriptors } from "../../../provider-catalog/aws-owned-policy-descriptors.js";
import { dispatchAddServiceCommand } from "./add-service-command.js";
import { prepareUserOwnedConfigurationCreate } from "./owned-policy-commands.js";
import {
  createConfigurationFormModel,
  convertConfigurationFormValues,
} from "../inspector/configuration-form-model.js";
import { resolveSelectedResourceInspectorModel } from "../inspector/selected-resource-model.js";
import { prepareConfigurationCommand } from "./configuration-command.js";
const s = (value: string) => ({ kind: "string" as const, value }),
  i = (value: number) => ({ kind: "integer" as const, value });
const distValues = { name: s("synthetic-alb"), scheme: s("internal") };
const targetValues = {
  name: s("synthetic-target"),
  backendMode: s("ec2-instance"),
  port: i(8080),
  healthPath: s("/health"),
  startupGraceSeconds: i(0),
};
describe("ELB customer configuration", () => {
  it.each([
    ["aws.elb.application-load-balancer", distValues],
    ["aws.elb.target-group", targetValues],
  ] as const)(
    "creates %s through setup and edits exact Inspector values with inverse",
    (serviceId, configurationValues) => {
      let sequence = 0;
      const createId = () => `operation_elb_setup_${String(++sequence)}`;
      const result = dispatchAddServiceCommand({
        document: loadAwsEditorArchitectureDocument(),
        catalog: awsEditorCatalog,
        createId,
        serviceId,
        configurationValues,
      });
      const n = result.document.nodes.find((n) => n.id === result.nodeId);
      expect(n?.semantic.lifecycle).toMatchObject({
        ownership: "user",
        origin: "user",
      });
      const model = resolveSelectedResourceInspectorModel(
        result.document,
        awsEditorCatalog,
        { kind: "node", id: result.nodeId },
      );
      if (model.kind !== "ready" || model.model.kind !== "node")
        throw Error("Missing Inspector");
      const form = createConfigurationFormModel(result.document, model.model);
      expect(form.fields.length).toBeGreaterThan(2);
      const field =
          serviceId === "aws.elb.application-load-balancer"
            ? "idleTimeoutSeconds"
            : "deregistrationDelaySeconds",
        value = "120";
      const converted = convertConfigurationFormValues(form, {
        ...form.initialValues,
        [field]: value,
      });
      if (!converted.success) throw Error(JSON.stringify(converted));
      const edit = prepareConfigurationCommand({
        document: result.document,
        catalog: awsEditorCatalog,
        createId,
        target: { kind: "node", id: result.nodeId },
        edits: converted.edits,
      });
      const applied = applyGraphCommand(result.document, edit.command);
      expect(
        applied.document.nodes.find((n) => n.id === result.nodeId)?.semantic
          .configuration.values[configurationKeySchema.parse(field)],
      ).toEqual(i(120));
      if (applied.inversion.kind !== "available")
        throw Error("Missing inverse");
      expect(
        applyGraphCommand(applied.document, applied.inversion.command).document,
      ).toEqual(result.document);
    },
  );
  it("creates and configures the native HTTPS listener with exact ALB parent and inverse", () => {
    let seq = 0;
    const createId = () => "operation_elb_listener_" + String(++seq);
    const owner = dispatchAddServiceCommand({
      document: loadAwsEditorArchitectureDocument(),
      catalog: awsEditorCatalog,
      createId,
      serviceId: "aws.elb.application-load-balancer",
      configurationValues: distValues,
    });
    const child = dispatchAddServiceCommand({
      document: owner.document,
      catalog: awsEditorCatalog,
      createId,
      serviceId: "aws.elb.https-listener",
      parentNodeId: owner.nodeId,
      configurationValues: { serverName: s("app.example.test") },
    });
    expect(child.node.semantic.parent).toEqual({
      nodeId: owner.nodeId,
      relationshipType: "aws.elb.alb-owns-listener",
    });
    expect(
      child.document.edges.some(
        (e) =>
          e.semantic.relationshipType === "aws.elb.alb-owns-listener" &&
          e.semantic.source.nodeId === child.nodeId &&
          e.semantic.target.nodeId === owner.nodeId,
      ),
    ).toBe(true);
    const model = resolveSelectedResourceInspectorModel(
      child.document,
      awsEditorCatalog,
      { kind: "node", id: child.nodeId },
    );
    if (model.kind !== "ready" || model.model.kind !== "node")
      throw Error("Missing listener Inspector");
    const form = createConfigurationFormModel(child.document, model.model);
    expect(form.fields.some((f) => f.field.property === "serverName")).toBe(
      true,
    );
    if (child.inversion.kind !== "available")
      throw Error("Missing listener inverse");
    expect(
      applyGraphCommand(child.document, child.inversion.command).document,
    ).toEqual(owner.document);
  });
  it("creates one canonical user-owned backend access in the target-group slot and restores its owner", () => {
    let sequence = 0;
    const result = dispatchAddServiceCommand({
      document: loadAwsEditorArchitectureDocument(),
      catalog: awsEditorCatalog,
      createId: () => `operation_elb_backend_access_${String(++sequence)}`,
      serviceId: "aws.elb.target-group",
      configurationValues: {
        ...targetValues,
      },
    });
    const childType = "aws.elb.backend-access-configuration",
      definition = awsCatalogV1.requireService(childType),
      c = awsCatalogV1.validateConfiguration(childType, {
        description: s("Exact synthetic backend peer access"),
      });
    if (!c.success) throw Error("Invalid backend-access");
    const input = {
      document: result.document,
      descriptors: awsOwnedPolicyGraphDescriptors,
      ownerNodeId: result.nodeId,
      slotId: "aws.elb.target-group.slot.backend-access",
      ownedKindId: childType,
      ownedConfiguration: {
        nodeId: "backend_access",
        deploymentKey: "backend_access",
        label: "Viewer backend-access",
        position: { x: 0, y: 0 },
        configuration: {
          schemaId: definition.configuration.schemaId,
          schemaVersion: definition.configuration.schemaVersion,
          values: c.values,
        },
      },
      ownerBindingEdgeId: "viewer_backend_access_owner",
      operationIdentities: {
        batch: {
          commandId: "command_backend_access",
          inverseCommandId: "inverse_backend_access",
        },
        actions: [
          {
            commandId: "command_backend_access_node",
            inverseCommandId: "inverse_backend_access_node",
          },
          {
            commandId: "command_backend_access_edge",
            inverseCommandId: "inverse_backend_access_edge",
          },
        ],
      },
    };
    const plan = prepareUserOwnedConfigurationCreate(input);
    expect(plan.status, JSON.stringify(plan)).toBe("ready");
    if (plan.status !== "ready") throw Error(JSON.stringify(plan));
    const applied = applyGraphCommand(result.document, plan.command);
    expect(
      applied.document.nodes.find((n) => n.id === "backend_access")?.semantic
        .parent,
    ).toEqual({
      nodeId: result.nodeId,
      relationshipType: "aws.elb.target-group-owns-backend-access",
    });
    expect(
      prepareUserOwnedConfigurationCreate({
        ...input,
        document: applied.document,
        ownedConfiguration: {
          ...input.ownedConfiguration,
          nodeId: "second_backend_access",
          deploymentKey: "second_backend_access",
        },
        ownerBindingEdgeId: "second_backend_access_owner",
      }).status,
    ).toBe("invalid");
    if (applied.inversion.kind !== "available")
      throw Error("Missing backend-access inverse");
    expect(
      applyGraphCommand(applied.document, applied.inversion.command).document,
    ).toEqual(result.document);
  });
});
