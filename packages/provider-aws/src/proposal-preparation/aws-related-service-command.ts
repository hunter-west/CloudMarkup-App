import {
  applyGraphCommand,
  getArchitectureDocumentHashes,
} from "@cloudmarkup/domain";
import { parseGraphCommandV1 } from "@cloudmarkup/schemas";
import { awsCatalogV1 } from "@cloudmarkup/provider-aws/catalog";
import { awsConnectionResolverV1 } from "@cloudmarkup/provider-aws/connection-resolution";
import type { EditorCatalog } from "@cloudmarkup/graph-preparation/editor-catalog";
import { createAddServiceCommand } from "@cloudmarkup/graph-preparation/add-service-command";
import { listServiceCreationParents } from "@cloudmarkup/graph-preparation/placement-rules";
import { hasExactEditorCatalogBinding } from "@cloudmarkup/graph-preparation/catalog-selection";

const rules: Readonly<Record<string, string>> = {
  "aws.fsx.ontap-storage-virtual-machine": "aws.fsx.ontap-svm-uses-file-system",
  "aws.fsx.ontap-volume": "aws.fsx.ontap-volume-uses-svm",
  "aws.cognito.user-pool-client": "aws.cognito.user-pool-configures-app-client",
  "aws.eventbridge.rule": "aws.eventbridge.event-bus-associates-rule",
};
export const prepareAwsRelatedService: NonNullable<
  EditorCatalog["prepareRelatedService"]
> = (input) => {
  if (!hasExactEditorCatalogBinding(input.document, input.catalog))
    throw new Error("The exact service catalog is required.");
  const owner = input.document.nodes.find(
    (node) => node.id === input.ownerNodeId,
  );
  const service = input.catalog.services.find(
    (candidate) => candidate.serviceType === input.serviceId,
  );
  const ownerService = input.catalog.services.find(
    (candidate) => candidate.serviceType === owner?.semantic.serviceType,
  );
  const rule = awsCatalogV1
    .listConnectionRules()
    .find((candidate) => candidate.id === rules[input.serviceId]);
  if (
    !owner ||
    !service ||
    !rule ||
    !ownerService?.relatedServiceTypes?.includes(input.serviceId)
  )
    throw new Error("This setting is unavailable for the selected service.");
  const parentNodeId =
    listServiceCreationParents(input.document, input.catalog, service).find(
      (parent) => parent.parentNodeId === owner.id,
    )?.parentNodeId ?? null;
  const addition = createAddServiceCommand({ ...input, parentNodeId });
  const created = applyGraphCommand(input.document, addition.command).document;
  const sourceId =
    rule.source.serviceId === owner.semantic.serviceType
      ? owner.id
      : addition.nodeId;
  const targetId = sourceId === owner.id ? addition.nodeId : owner.id;
  const commands =
    addition.command.kind === "batch"
      ? [...addition.command.commands]
      : [addition.command];
  if (
    !created.edges.some(
      (edge) =>
        edge.semantic.source.nodeId === sourceId &&
        edge.semantic.target.nodeId === targetId &&
        edge.semantic.relationshipType === rule.relationshipType,
    )
  ) {
    const connection = awsConnectionResolverV1.resolve({
      document: created,
      operationId: input.createId(),
      ruleId: rule.id,
      configuration: {},
      source: { nodeId: sourceId, portId: rule.source.portId },
      target: { nodeId: targetId, portId: rule.target.portId },
    });
    if (!connection.success)
      throw new Error(
        connection.findings[0]?.guidedMessage ??
          "The new resource could not be associated with this service.",
      );
    commands.push(...connection.batch.commands);
  }
  const command = parseGraphCommandV1({
    schemaVersion: 1,
    commandId: input.createId(),
    inverseCommandId: input.createId(),
    origin: "user",
    target: addition.command.target,
    kind: "batch",
    commands,
  });
  const preview = applyGraphCommand(input.document, command);
  return {
    command,
    beforeHashes: getArchitectureDocumentHashes(input.document),
    previewHashes: getArchitectureDocumentHashes(preview.document),
    label: "Add related service setting",
    description:
      "Add " +
      service.displayName +
      " and its connection to " +
      owner.presentation.label +
      ".",
  };
};
