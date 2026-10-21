import {
  applyGraphCommand,
  parseArchitectureDocument,
  getArchitectureDocumentHashes,
} from "@cloudmarkup/domain";
import { describe, expect, it } from "vitest";
import { awsEditorCatalog } from "../../../provider-catalog/aws-editor-catalog.js";
import { loadBlankAwsEditorArchitectureDocument } from "../../../provider-catalog/aws-editor-fixture.js";
import { dispatchAddServiceCommand } from "./add-service-command.js";
import { serviceCreationDefaults } from "./placement-rules.js";
import { prepareServiceVariantCommand } from "./service-variant-command.js";
import { prepareAwsRelatedService } from "@cloudmarkup/provider-aws/proposals/aws-related-service-command";
import { applyPreparedResourceRepair } from "./resource-repair-command.js";

let sequence = 0;
const createId = () => "operation_variant_test_" + String(++sequence);
const catalog = awsEditorCatalog;
function fixture() {
  const document = loadBlankAwsEditorArchitectureDocument();
  const added = dispatchAddServiceCommand({
    document,
    catalog,
    serviceId: "aws.fsx.lustre-file-system",
    parentNodeId: null,
    configurationValues: { storageCapacity: { kind: "integer", value: 1200 } },
    createId,
  });
  const next = catalog.services.find(
    (service) => service.serviceType === "aws.fsx.openzfs-file-system",
  );
  if (!next) throw new Error("Missing file system variant");
  return {
    document: added.document,
    catalog,
    nodeId: added.nodeId,
    serviceId: next.serviceType,
    parentNodeId: null,
    configurationValues: {
      ...serviceCreationDefaults(added.document, next),
      storageCapacity: { kind: "integer" as const, value: 64 },
    },
    createId,
  };
}
describe("reviewed service variant changes", () => {
  it("preserves identity and position, changes exact type/schema, and supports exact undo", () => {
    const input = fixture();
    const before = structuredClone(input.document);
    const node = before.nodes.find(
      (candidate) => candidate.id === input.nodeId,
    );
    if (!node) throw new Error("Missing source node");
    const prepared = prepareServiceVariantCommand(input);
    expect(input.document).toEqual(before);
    const result = applyPreparedResourceRepair(input.document, prepared);
    const changed = result.document.nodes.find(
      (candidate) => candidate.id === node.id,
    );
    if (!changed) throw new Error("Missing replacement node");
    expect(changed.semantic.serviceType).toBe(input.serviceId);
    expect(changed.semantic.configuration.schemaId).toContain("openzfs");
    expect(changed.semantic.deploymentKey).toBe(node.semantic.deploymentKey);
    expect(changed.presentation).toEqual(node.presentation);
    expect(result.inversion.kind).toBe("available");
    if (result.inversion.kind !== "available")
      throw new Error("Expected an inverse");
    expect(
      getArchitectureDocumentHashes(
        applyGraphCommand(result.document, result.inversion.command).document,
      ),
    ).toEqual(getArchitectureDocumentHashes(before));
  });
  it("rejects a type outside the selected product", () => {
    const input = fixture();
    expect(() =>
      prepareServiceVariantCommand({ ...input, serviceId: "aws.s3.bucket" }),
    ).toThrow(/different type/u);
  });
  it("rejects incomplete variant settings without changing the draft", () => {
    const input = fixture();
    const before = structuredClone(input.document);
    expect(() =>
      prepareServiceVariantCommand({
        ...input,
        configurationValues: {
          storageCapacity: { kind: "integer", value: -1 },
        },
      }),
    ).toThrow();
    expect(input.document).toEqual(before);
  });
  it("does not apply a reviewed variant against a changed draft", () => {
    const input = fixture();
    const prepared = prepareServiceVariantCommand(input);
    const changed = dispatchAddServiceCommand({
      document: input.document,
      catalog,
      serviceId: "aws.s3.bucket",
      createId,
    });
    expect(() =>
      applyPreparedResourceRepair(changed.document, prepared),
    ).toThrow(/design changed/u);
  });
  it("preserves generated ownership by refusing implicit adoption", () => {
    const input = fixture();
    const document = parseArchitectureDocument({
      ...input.document,
      nodes: input.document.nodes.map((node) =>
        node.id === input.nodeId
          ? {
              ...node,
              semantic: {
                ...node.semantic,
                lifecycle: {
                  ownership: "generated",
                  origin: "connection-rule",
                  provenance: {
                    generatorKind: "connection-rule",
                    generatorId: "example.generator.variant",
                    generatorVersion: "1.0.0",
                    operationId: "operation_generated_variant",
                    dependentNodeIds: [],
                    dependentEdgeIds: [],
                  },
                },
              },
            }
          : node,
      ),
    });
    const before = getArchitectureDocumentHashes(document);
    expect(() => prepareServiceVariantCommand({ ...input, document })).toThrow(
      /Adopt/u,
    );
    expect(getArchitectureDocumentHashes(document)).toEqual(before);
  });
  it("does not disconnect an ONTAP storage virtual machine when changing file systems", () => {
    const input = fixture();
    const owner = dispatchAddServiceCommand({
      document: loadBlankAwsEditorArchitectureDocument(),
      catalog,
      serviceId: "aws.fsx.ontap-file-system",
      configurationValues: {
        throughputCapacity: { kind: "integer", value: 1536 },
      },
      createId,
    });
    const child = catalog.services.find(
      (service) =>
        service.serviceType === "aws.fsx.ontap-storage-virtual-machine",
    );
    if (!child) throw new Error("Missing SVM definition");
    const related = prepareAwsRelatedService({
      document: owner.document,
      catalog,
      ownerNodeId: owner.nodeId,
      serviceId: child.serviceType,
      configurationValues: serviceCreationDefaults(owner.document, child),
      createId,
    });
    const document = applyGraphCommand(
      owner.document,
      related.command,
    ).document;
    const before = getArchitectureDocumentHashes(document);
    expect(() =>
      prepareServiceVariantCommand({
        ...input,
        document,
        nodeId: owner.nodeId,
      }),
    ).toThrow(/connections/u);
    expect(getArchitectureDocumentHashes(document)).toEqual(before);
  });
});
