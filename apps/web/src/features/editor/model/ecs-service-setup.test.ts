import { describe, expect, it } from "vitest";
import type { ConfigurationValue } from "@cloudmarkup/schemas";
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
const s = (value: string) => ({ kind: "string" as const, value });
const i = (value: number) => ({ kind: "integer" as const, value });
describe("ECR/Fargate customer configuration", () => {
  it.each([["aws.ecs.service", { name: s("SyntheticService") }]] as const)(
    "creates %s through catalog setup and restores exact intent",
    (serviceId, configurationValues) => {
      let sequence = 0;
      const createId = () => `operation_ecs_setup_${String(++sequence)}`;
      const document = loadAwsEditorArchitectureDocument();
      const result = dispatchAddServiceCommand({
        document,
        catalog: awsEditorCatalog,
        createId,
        serviceId,
        configurationValues,
      });
      const node = result.document.nodes.find((n) => n.id === result.nodeId);
      expect(node?.semantic.serviceType).toBe(serviceId);
      expect(node?.semantic.lifecycle).toMatchObject({
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
      expect(form.fields.length).toBeGreaterThan(1);

      expect(
        (
          node?.semantic.configuration.values as Record<
            string,
            ConfigurationValue
          >
        )["desiredCount"],
      ).toEqual(i(0));
      const converted = convertConfigurationFormValues(form, {
        ...form.initialValues,
        desiredCount: "2",
      });
      if (!converted.success) throw Error("Configuration conversion failed");
      const edit = prepareConfigurationCommand({
        document: result.document,
        catalog: awsEditorCatalog,
        createId,
        target: { kind: "node", id: result.nodeId },
        edits: converted.edits,
      });
      const applied = applyGraphCommand(result.document, edit.command);
      expect(
        (
          applied.document.nodes.find((n) => n.id === result.nodeId)?.semantic
            .configuration.values as Record<string, ConfigurationValue>
        )["desiredCount"],
      ).toEqual(i(2));
      if (applied.inversion.kind !== "available")
        throw Error("Missing inverse");
      expect(
        applyGraphCommand(applied.document, applied.inversion.command).document,
      ).toEqual(result.document);
    },
  );
  it.each([
    [
      "aws.ecr.repository",
      "aws.ecr.image-reference",
      "image",
      { name: s("synthetic/application") },
      {
        digest: s("sha256:" + "a".repeat(64)),
        architecture: s("x86_64"),
        manifestType: s("oci-image"),
      },
    ],
    [
      "aws.ecs.task-definition",
      "aws.ecs.container-definition",
      "container",
      {
        family: s("SyntheticTask"),
        cpu: i(256),
        memoryMiB: i(512),
        architecture: s("x86_64"),
      },
      {
        name: s("Application"),
        containerPort: i(8080),
        user: s("10001:10001"),
        healthExecutable: s("/app/health"),
        logStreamPrefix: s("Application"),
      },
    ],
  ] as const)(
    "creates canonical %s owned configuration and inverse",
    (ownerType, childType, suffix, ownerValues, childValues) => {
      let sequence = 0;
      const pendingTask = dispatchAddServiceCommand({
        document: loadAwsEditorArchitectureDocument(),
        catalog: awsEditorCatalog,
        createId: () => `operation_pending_task_${String(++sequence)}`,
        serviceId: "aws.ecs.task-definition",
        configurationValues: {
          family: s("PendingTask"),
          cpu: i(256),
          memoryMiB: i(512),
          architecture: s("x86_64"),
        },
      });
      const created = dispatchAddServiceCommand({
        document: pendingTask.document,
        catalog: awsEditorCatalog,
        createId: () => `operation_ecs_owned_${String(++sequence)}`,
        serviceId: ownerType,
        configurationValues: ownerValues,
      });
      const definition = awsCatalogV1.getService(childType),
        values = awsCatalogV1.validateConfiguration(childType, childValues);
      if (!definition || !values.success)
        throw Error("Invalid reviewed owned configuration");
      const operations = {
        batch: {
          commandId: "command_ecs_owned",
          inverseCommandId: "inverse_ecs_owned",
        },
        actions: [
          {
            commandId: "command_ecs_child",
            inverseCommandId: "inverse_ecs_child",
          },
          {
            commandId: "command_ecs_edge",
            inverseCommandId: "inverse_ecs_edge",
          },
        ],
      };
      const result = prepareUserOwnedConfigurationCreate({
        document: created.document,
        descriptors: awsOwnedPolicyGraphDescriptors,
        ownerNodeId: created.nodeId,
        slotId: ownerType + ".slot." + suffix,
        ownedKindId: childType,
        ownedConfiguration: {
          nodeId: "node_ecs_owned",
          deploymentKey: "ecs_owned",
          label: "Reviewed owned configuration",
          position: { x: 0, y: 0 },
          configuration: {
            schemaId: definition.configuration.schemaId,
            schemaVersion: definition.configuration.schemaVersion,
            values: values.values,
          },
        },
        ownerBindingEdgeId: "edge_ecs_owned",
        operationIdentities: operations,
      });
      expect(result.status, JSON.stringify(result)).toBe("ready");
      if (result.status !== "ready") throw Error(JSON.stringify(result));
      const applied = applyGraphCommand(created.document, result.command);
      const child = applied.document.nodes.find(
        (n) => n.id === "node_ecs_owned",
      );
      expect(child?.semantic.parent?.nodeId).toBe(created.nodeId);
      expect(
        applied.document.edges.filter(
          (e) =>
            e.semantic.source.nodeId === "node_ecs_owned" &&
            e.semantic.target.nodeId === created.nodeId,
        ),
      ).toHaveLength(1);
      if (applied.inversion.kind !== "available")
        throw Error("Missing owned inverse");
      expect(
        applyGraphCommand(applied.document, applied.inversion.command).document,
      ).toEqual(created.document);
    },
  );
});
