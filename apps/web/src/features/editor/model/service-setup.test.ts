import { describe, expect, it } from "vitest";
import { applyGraphCommand } from "@cloudmarkup/domain";
import {
  createConfigurationFormModel,
  convertConfigurationFormValues,
} from "../inspector/configuration-form-model.js";
import { resolveSelectedResourceInspectorModel } from "../inspector/selected-resource-model.js";
import { prepareConfigurationCommand } from "./configuration-command.js";
import { awsEditorCatalog } from "../../../provider-catalog/aws-editor-catalog.js";
import { loadAwsEditorArchitectureDocument } from "../../../provider-catalog/aws-editor-fixture.js";
import {
  createAddServiceCommand,
  dispatchAddServiceCommand,
} from "./add-service-command.js";
import {
  listServiceCreationParents,
  resolveServiceCreationAvailability,
} from "./placement-rules.js";

function fixture() {
  let sequence = 0;
  return {
    catalog: awsEditorCatalog,

    createId: () =>
      `operation_service_setup_${String(++sequence).padStart(4, "0")}`,
    document: loadAwsEditorArchitectureDocument(),
  };
}

describe("customer service setup", () => {
  it("edits explicit EC2 storage/IMDS intent through the Inspector and reverses it exactly", () => {
    const input = fixture();
    const created = dispatchAddServiceCommand({
      ...input,
      serviceId: "aws.ec2.instance",
      configurationValues: {
        imageId: { kind: "string", value: "ami-0123456789abcdef0" },
        imageRegion: { kind: "string", value: input.document.provider.region },
        imageArchitecture: { kind: "string", value: "x86_64" },
        imageRootDeviceName: { kind: "string", value: "/dev/xvda" },
        imageRootMinimumGiB: { kind: "integer", value: 8 },
        instanceType: { kind: "string", value: "t3.small" },
        rootSizeGiB: { kind: "integer", value: 30 },
      },
    });
    const selected = resolveSelectedResourceInspectorModel(
      created.document,
      input.catalog,
      { kind: "node", id: created.nodeId },
    );
    if (selected.kind !== "ready" || selected.model.kind !== "node")
      throw Error("Expected editable EC2");
    const form = createConfigurationFormModel(created.document, selected.model);
    const converted = convertConfigurationFormValues(form, {
      ...form.initialValues,
      rootSizeGiB: "40",
      metadataHopLimit: "2",
      rootDeleteOnTermination: "true",
    });
    if (!converted.success)
      throw Error(
        "Explicit launch edit rejected: " + JSON.stringify(converted),
      );
    const prepared = prepareConfigurationCommand({
      ...input,
      document: created.document,
      edits: converted.edits,
      target: { kind: "node", id: created.nodeId },
    });
    expect(
      prepared.previewDocument.nodes.find((node) => node.id === created.nodeId)
        ?.semantic.configuration.values,
    ).toMatchObject({
      rootSizeGiB: { kind: "integer", value: 40 },
      metadataHopLimit: { kind: "integer", value: 2 },
      rootDeleteOnTermination: { kind: "boolean", value: true },
    });
    const result = applyGraphCommand(created.document, prepared.command);
    if (result.inversion.kind !== "available")
      throw Error("Expected exact launch inverse");
    expect(
      applyGraphCommand(result.document, result.inversion.command).document,
    ).toEqual(created.document);
    for (const edits of [
      { metadataAuthentication: { kind: "string", value: "optional" } },
      { publicIpv4: { kind: "boolean", value: true } },
      { rootThroughputMiBps: { kind: "integer", value: 250 } },
      { userData: { kind: "string", value: "unsupported" } },
    ] as const)
      expect(() =>
        prepareConfigurationCommand({
          ...input,
          document: created.document,
          edits,
          target: { kind: "node", id: created.nodeId },
        }),
      ).toThrow();
    expect(() =>
      createAddServiceCommand({
        ...input,
        serviceId: "aws.ec2.instance",
        configurationValues: {},
      }),
    ).toThrow();
    expect(created.node.semantic.parent).toBeUndefined();
    expect(created.node.semantic.lifecycle).toEqual({
      ownership: "user",
      origin: "user",
    });
  });
  it("edits secret metadata in the Inspector and reverses the exact graph command", () => {
    const input = fixture();
    const created = dispatchAddServiceCommand({
      ...input,
      serviceId: "aws.secretsmanager.secret",
      configurationValues: {
        name: { kind: "string", value: "application/credential" },
      },
    });
    const selected = resolveSelectedResourceInspectorModel(
      created.document,
      input.catalog,
      { kind: "node", id: created.nodeId },
    );
    if (selected.kind !== "ready" || selected.model.kind !== "node")
      throw Error("Expected editable secret metadata");
    const form = createConfigurationFormModel(created.document, selected.model);
    expect(form.fields.map(({ field }) => field.property)).toEqual([
      "name",
      "description",
      "encryptionMode",
      "valueMode",
      "recoveryWindowDays",
      "preventDestroy",
    ]);
    expect(
      form.fields
        .filter((field) => !field.editable)
        .map(({ field }) => field.property),
    ).toEqual(["valueMode", "preventDestroy"]);
    const converted = convertConfigurationFormValues(form, {
      ...form.initialValues,
      description: "Synthetic service credential purpose",
      recoveryWindowDays: "7",
      encryptionMode: "customer-managed",
      valueMode: "unsupported-inline-value",
      preventDestroy: false,
    });
    if (!converted.success) throw Error("Metadata edit rejected");
    expect(converted.edits["valueMode"]).toEqual({
      kind: "string",
      value: "external-population",
    });
    expect(converted.edits["preventDestroy"]).toEqual({
      kind: "boolean",
      value: true,
    });
    const prepared = prepareConfigurationCommand({
      ...input,
      document: created.document,
      edits: converted.edits,
      target: { kind: "node", id: created.nodeId },
    });
    expect(prepared.changes.map(({ property }) => property)).toEqual([
      "description",
      "encryptionMode",
      "recoveryWindowDays",
    ]);
    expect(
      prepared.previewDocument.nodes.find((node) => node.id === created.nodeId)
        ?.semantic.configuration.values,
    ).toMatchObject({
      description: {
        kind: "string",
        value: "Synthetic service credential purpose",
      },
      recoveryWindowDays: { kind: "integer", value: 7 },
      encryptionMode: { kind: "string", value: "customer-managed" },
    });
    const result = applyGraphCommand(created.document, prepared.command);
    if (result.inversion.kind !== "available")
      throw Error("Expected metadata inverse");
    expect(
      applyGraphCommand(result.document, result.inversion.command).document,
    ).toEqual(created.document);
    expect(
      convertConfigurationFormValues(form, {
        ...form.initialValues,
        recoveryWindowDays: "0",
      }).success,
    ).toBe(false);
    expect(() =>
      prepareConfigurationCommand({
        ...input,
        document: created.document,
        edits: { preventDestroy: { kind: "boolean", value: false } },
        target: { kind: "node", id: created.nodeId },
      }),
    ).toThrow();
    expect(() =>
      prepareConfigurationCommand({
        ...input,
        document: created.document,
        edits: {
          secretString: {
            kind: "string",
            value: "synthetic-sensitive-sentinel",
          },
        },
        target: { kind: "node", id: created.nodeId },
      }),
    ).toThrow();
  });
  it("creates the Region, VPC, zone, subnet and configured NAT through graph commands", () => {
    const input = fixture();
    const original = structuredClone(input.document);
    const region = dispatchAddServiceCommand({
      ...input,
      serviceId: "aws.region.boundary",
    });
    const regionNode = region.document.nodes.find(
      (node) => node.id === region.nodeId,
    );
    expect(regionNode?.semantic.configuration.values).toEqual({
      regionName: { kind: "string", value: original.provider.region },
    });
    const vpc = dispatchAddServiceCommand({
      ...input,
      document: region.document,
      serviceId: "aws.ec2.vpc",
    });
    expect(vpc.node.semantic.parent?.nodeId).toBe(region.nodeId);
    const zone = dispatchAddServiceCommand({
      ...input,
      document: vpc.document,
      serviceId: "aws.ec2.availability-zone",
      configurationValues: {
        zoneName: { kind: "string", value: `${original.provider.region}a` },
      },
      parentNodeId: vpc.nodeId,
    });
    const subnet = dispatchAddServiceCommand({
      ...input,
      document: zone.document,
      serviceId: "aws.ec2.subnet",
    });
    expect(subnet.node.semantic.parent?.nodeId).toBe(zone.nodeId);
    const nat = dispatchAddServiceCommand({
      ...input,
      document: subnet.document,
      serviceId: "aws.ec2.nat-gateway",
      parentNodeId: subnet.nodeId,
      configurationValues: {
        allocationId: { kind: "string", value: "eipalloc-0123456789abcdef0" },
        connectivityType: { kind: "string", value: "public" },
        availabilityMode: { kind: "string", value: "zonal" },
      },
    });
    expect(nat.node.semantic.parent?.nodeId).toBe(subnet.nodeId);
    expect(nat.node.semantic.lifecycle).toEqual({
      ownership: "user",
      origin: "user",
    });
    expect(input.document).toEqual(original);
  });

  it("requires a choice among current valid parents and refuses deleted or wrong parents", () => {
    const input = fixture();
    const first = dispatchAddServiceCommand({
      ...input,
      serviceId: "aws.cognito.user-pool",
    });
    const serviceId = "aws.cognito.user-pool-client";
    const service = input.catalog.services.find(
      (candidate) => candidate.serviceType === serviceId,
    );
    if (service === undefined) throw new Error("Expected app client");
    const choices = listServiceCreationParents(
      first.document,
      input.catalog,
      service,
    );
    expect(choices.length).toBeGreaterThan(1);
    expect(
      resolveServiceCreationAvailability(
        first.document,
        input.catalog,
        serviceId,
      ),
    ).toMatchObject({ enabled: false, code: "parent-ambiguous" });
    const command = createAddServiceCommand({
      ...input,
      document: first.document,
      serviceId,
      parentNodeId: first.nodeId,
    });
    expect(command.node.semantic.parent?.nodeId).toBe(first.nodeId);
    for (const parentNodeId of [
      null,
      "node_deleted_parent",
      "node_application",
    ]) {
      expect(() =>
        createAddServiceCommand({
          ...input,
          document: first.document,
          serviceId,
          parentNodeId,
        }),
      ).toThrow();
    }
  });

  it("rejects invalid configuration and a Region different from the project without adding a node", () => {
    const input = fixture();
    for (const configurationValues of [
      {},
      { regionName: { kind: "string" as const, value: "invalid" } },
      {
        regionName: {
          kind: "string" as const,
          value:
            input.document.provider.region === "eu-west-1"
              ? "us-east-1"
              : "eu-west-1",
        },
      },
    ]) {
      expect(() =>
        createAddServiceCommand({
          ...input,
          serviceId: "aws.region.boundary",
          configurationValues,
        }),
      ).toThrow();
    }
    expect(() =>
      createAddServiceCommand({
        ...input,
        serviceId: "aws.iam.policy-statement",
        configurationValues: {},
        parentNodeId: null,
      }),
    ).toThrow();
  });
});
