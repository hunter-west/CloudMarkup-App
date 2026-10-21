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
const distValues = {
  comment: s("Synthetic public static delivery"),
  enabled: { kind: "boolean" as const, value: false },
  publicContentAttested: { kind: "boolean" as const, value: true },
  defaultRootObject: s("index.html"),
  priceClass: s("PriceClass_100"),
};
describe("CloudFront customer configuration", () => {
  it.each([
    ["aws.cloudfront.distribution", distValues],
    [
      "aws.cloudfront.cache-policy",
      {
        name: s("StaticExample"),
        comment: s("Synthetic cache"),
        defaultTtl: i(300),
        maxTtl: i(3600),
      },
    ],
  ] as const)(
    "creates %s through setup and edits exact Inspector values with inverse",
    (serviceId, configurationValues) => {
      let sequence = 0;
      const createId = () => `operation_cloudfront_setup_${String(++sequence)}`;
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
          serviceId === "aws.cloudfront.distribution"
            ? "enabled"
            : "defaultTtl",
        value = field === "enabled" ? true : "600";
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
      ).toEqual(
        field === "enabled" ? { kind: "boolean", value: true } : i(600),
      );
      if (applied.inversion.kind !== "available")
        throw Error("Missing inverse");
      expect(
        applyGraphCommand(applied.document, applied.inversion.command).document,
      ).toEqual(result.document);
    },
  );
  it("creates one canonical user-owned alias in the distribution slot and restores its owner", () => {
    let sequence = 0;
    const result = dispatchAddServiceCommand({
      document: loadAwsEditorArchitectureDocument(),
      catalog: awsEditorCatalog,
      createId: () => `operation_cloudfront_alias_${String(++sequence)}`,
      serviceId: "aws.cloudfront.distribution",
      configurationValues: {
        ...distValues,
        viewerCertificateMode: s("acm-alias"),
      },
    });
    const childType = "aws.cloudfront.alias-configuration",
      definition = awsCatalogV1.requireService(childType),
      c = awsCatalogV1.validateConfiguration(childType, {
        domainName: s("app.example.test"),
      });
    if (!c.success) throw Error("Invalid alias");
    const input = {
      document: result.document,
      descriptors: awsOwnedPolicyGraphDescriptors,
      ownerNodeId: result.nodeId,
      slotId: "aws.cloudfront.distribution.slot.alias",
      ownedKindId: childType,
      ownedConfiguration: {
        nodeId: "viewer_alias",
        deploymentKey: "viewer_alias",
        label: "Viewer alias",
        position: { x: 0, y: 0 },
        configuration: {
          schemaId: definition.configuration.schemaId,
          schemaVersion: definition.configuration.schemaVersion,
          values: c.values,
        },
      },
      ownerBindingEdgeId: "viewer_alias_owner",
      operationIdentities: {
        batch: {
          commandId: "command_alias",
          inverseCommandId: "inverse_alias",
        },
        actions: [
          {
            commandId: "command_alias_node",
            inverseCommandId: "inverse_alias_node",
          },
          {
            commandId: "command_alias_edge",
            inverseCommandId: "inverse_alias_edge",
          },
        ],
      },
    };
    const plan = prepareUserOwnedConfigurationCreate(input);
    expect(plan.status, JSON.stringify(plan)).toBe("ready");
    if (plan.status !== "ready") throw Error(JSON.stringify(plan));
    const applied = applyGraphCommand(result.document, plan.command);
    expect(
      applied.document.nodes.find((n) => n.id === "viewer_alias")?.semantic
        .parent,
    ).toEqual({
      nodeId: result.nodeId,
      relationshipType: "aws.cloudfront.distribution-owns-alias",
    });
    expect(
      prepareUserOwnedConfigurationCreate({
        ...input,
        document: applied.document,
        ownedConfiguration: {
          ...input.ownedConfiguration,
          nodeId: "second_alias",
          deploymentKey: "second_alias",
        },
        ownerBindingEdgeId: "second_alias_owner",
      }).status,
    ).toBe("invalid");
    if (applied.inversion.kind !== "available")
      throw Error("Missing alias inverse");
    expect(
      applyGraphCommand(applied.document, applied.inversion.command).document,
    ).toEqual(result.document);
  });
});
