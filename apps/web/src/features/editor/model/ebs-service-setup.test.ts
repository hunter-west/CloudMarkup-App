import { configurationKeySchema } from "@cloudmarkup/schemas";
import { describe, expect, it } from "vitest";
import { applyGraphCommand } from "@cloudmarkup/domain";
import { awsCatalogV1 } from "@cloudmarkup/provider-aws/catalog";
import { awsEditorCatalog } from "../../../provider-catalog/aws-editor-catalog.js";
import { parseArchitectureDocument } from "@cloudmarkup/domain";
import ebsFixtureJson from "../../../../../../packages/provider-aws/fixtures/ebs-v1/default-unattached.json";

import { dispatchAddServiceCommand } from "./add-service-command.js";

import {
  createConfigurationFormModel,
  convertConfigurationFormValues,
} from "../inspector/configuration-form-model.js";
import { resolveSelectedResourceInspectorModel } from "../inspector/selected-resource-model.js";
import { prepareConfigurationCommand } from "./configuration-command.js";
const ebsFixture = () => {
  const parsed = parseArchitectureDocument(ebsFixtureJson);
  return parseArchitectureDocument({
    ...parsed,
    nodes: parsed.nodes.map((n) => ({
      ...n,
      presentation: { ...n.presentation, position: { x: 64, y: 192 } },
    })),
    catalog: {
      id: awsCatalogV1.artifact.catalog.id,
      version: awsCatalogV1.artifact.catalog.version,
      digest: awsCatalogV1.artifact.digest,
    },
  });
};
const s = (value: string) => ({ kind: "string" as const, value }),
  i = (value: number) => ({ kind: "integer" as const, value });
const volumeValues = {
  name: s("synthetic-extra"),
  sizeGiB: i(100),
  encryptionMode: s("account-default"),
};
const attachmentValues = { deviceName: s("/dev/sdf") };
describe("EBS parent-required configuration", () => {
  it.each([
    ["aws.ebs.volume", volumeValues],
    ["aws.ebs.volume-attachment", attachmentValues],
  ] as const)(
    "creates %s through setup and edits exact Inspector values with inverse",
    (serviceId, configurationValues) => {
      let sequence = 0;
      const createId = () => `operation_ebs_setup_${String(++sequence)}`;
      const result = dispatchAddServiceCommand({
        document: ebsFixture(),
        catalog: awsEditorCatalog,
        createId,
        serviceId,
        parentNodeId: serviceId === "aws.ebs.volume" ? "az" : "volume",
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
      const field = serviceId === "aws.ebs.volume" ? "sizeGiB" : "deviceName",
        value = serviceId === "aws.ebs.volume" ? "200" : "/dev/sdg";
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
      ).toEqual(serviceId === "aws.ebs.volume" ? i(200) : s("/dev/sdg"));
      if (applied.inversion.kind !== "available")
        throw Error("Missing inverse");
      expect(
        applyGraphCommand(applied.document, applied.inversion.command).document,
      ).toEqual(result.document);
    },
  );
});
