import { describe, expect, it } from "vitest";
import type { ConfigurationValue } from "@cloudmarkup/schemas";
import { applyGraphCommand } from "@cloudmarkup/domain";
import { awsEditorCatalog } from "../../../provider-catalog/aws-editor-catalog.js";
import { loadAwsEditorArchitectureDocument } from "../../../provider-catalog/aws-editor-fixture.js";
import { dispatchAddServiceCommand } from "./add-service-command.js";
import {
  createConfigurationFormModel,
  convertConfigurationFormValues,
} from "../inspector/configuration-form-model.js";
import { resolveSelectedResourceInspectorModel } from "../inspector/selected-resource-model.js";
import { prepareConfigurationCommand } from "./configuration-command.js";
const i = (value: number) => ({ kind: "integer" as const, value });
describe("RDS customer configuration", () => {
  it.each([
    [
      "aws.rds.db-instance",
      {
        identifier: {
          kind: "string",
          value: "synthetic-postgres",
        },
        engineVersion: {
          kind: "string",
          value: "16.6",
        },
        instanceClass: {
          kind: "string",
          value: "db.t4g.small",
        },
        databaseName: {
          kind: "string",
          value: "SyntheticApp",
        },
        masterUsername: {
          kind: "string",
          value: "SyntheticAdmin",
        },
        storageGiB: {
          kind: "integer",
          value: 30,
        },
        caIdentifier: {
          kind: "string",
          value: "rds-ca-rsa2048-g1",
        },
      },
    ],
  ] as const)(
    "creates %s through catalog setup and restores exact intent",
    (serviceId, configurationValues) => {
      let sequence = 0;
      const createId = () => `operation_rds_setup_${String(++sequence)}`;
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
        )["storageGiB"],
      ).toEqual(i(30));
      const converted = convertConfigurationFormValues(form, {
        ...form.initialValues,
        storageGiB: "40",
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
        )["storageGiB"],
      ).toEqual(i(40));
      if (applied.inversion.kind !== "available")
        throw Error("Missing inverse");
      expect(
        applyGraphCommand(applied.document, applied.inversion.command).document,
      ).toEqual(result.document);
    },
  );
});
