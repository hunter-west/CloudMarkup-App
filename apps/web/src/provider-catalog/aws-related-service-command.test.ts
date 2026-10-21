import {
  applyGraphCommand,
  getArchitectureDocumentHashes,
} from "@cloudmarkup/domain";
import { describe, expect, it } from "vitest";
import { awsEditorCatalog as catalog } from "./aws-editor-catalog.js";
import { loadBlankAwsEditorArchitectureDocument } from "./aws-editor-fixture.js";
import { dispatchAddServiceCommand } from "../features/editor/model/add-service-command.js";
import { serviceCreationDefaults } from "../features/editor/model/placement-rules.js";
import { prepareAwsRelatedService } from "@cloudmarkup/provider-aws/proposals/aws-related-service-command";
let sequence = 0;
const createId = () => "operation_related_test_" + String(++sequence);
describe("related AWS resources in configuration", () => {
  it.each([
    ["aws.fsx.ontap-file-system", "aws.fsx.ontap-storage-virtual-machine"],
    ["aws.fsx.ontap-storage-virtual-machine", "aws.fsx.ontap-volume"],
    ["aws.cognito.user-pool", "aws.cognito.user-pool-client"],
    ["aws.eventbridge.event-bus", "aws.eventbridge.rule"],
  ])(
    "adds %s settings and the required connection atomically",
    (ownerType, serviceId) => {
      const owner = dispatchAddServiceCommand({
        document: loadBlankAwsEditorArchitectureDocument(),
        catalog,
        serviceId: ownerType,
        configurationValues:
          ownerType === "aws.fsx.ontap-file-system"
            ? { throughputCapacity: { kind: "integer", value: 1536 } }
            : {},
        createId,
      });
      const service = catalog.services.find(
        (candidate) => candidate.serviceType === serviceId,
      );
      if (!service) throw new Error("Missing related service");
      const before = getArchitectureDocumentHashes(owner.document);
      const prepared = prepareAwsRelatedService({
        document: owner.document,
        catalog,
        ownerNodeId: owner.nodeId,
        serviceId: service.serviceType,
        configurationValues: serviceCreationDefaults(owner.document, service),
        createId,
      });
      expect(getArchitectureDocumentHashes(owner.document)).toEqual(before);
      const result = applyGraphCommand(owner.document, prepared.command);
      expect(result.document.nodes.length).toBe(
        owner.document.nodes.length + 1,
      );
      expect(result.document.edges.length).toBe(
        owner.document.edges.length + 1,
      );
      const child = result.document.nodes.find(
        (node) => node.semantic.serviceType === serviceId,
      );
      if (!child) throw new Error("Missing related resource");
      expect(
        result.document.edges.some(
          (edge) =>
            [edge.semantic.source.nodeId, edge.semantic.target.nodeId].includes(
              owner.nodeId,
            ) &&
            [edge.semantic.source.nodeId, edge.semantic.target.nodeId].includes(
              child.id,
            ),
        ),
      ).toBe(true);
      if (result.inversion.kind !== "available")
        throw new Error("Expected reversible addition");
      expect(
        getArchitectureDocumentHashes(
          applyGraphCommand(result.document, result.inversion.command).document,
        ),
      ).toEqual(before);
    },
  );
});
