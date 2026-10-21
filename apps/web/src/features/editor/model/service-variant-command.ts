import {
  applyGraphCommand,
  getArchitectureDocumentHashes,
  type ArchitectureDocument,
} from "@cloudmarkup/domain";
import {
  parseGraphCommandV1,
  type GraphCommandActionV1,
  type ConfigurationValue,
} from "@cloudmarkup/schemas";
import type { EditorCatalog } from "./editor-catalog.js";
import { createAddServiceCommand } from "./add-service-command.js";
import { hasExactEditorCatalogBinding } from "@cloudmarkup/graph-preparation/catalog-selection";
import { prepareParentConnectionActions } from "@cloudmarkup/graph-preparation/parent-connection-command";
import type { PreparedResourceRepair } from "./resource-repair-command.js";

/** A reviewed atomic replacement retains the node and deployment identities.
 * Dependents and generated resources fail closed; nothing is silently detached. */
export function prepareServiceVariantCommand(input: {
  document: ArchitectureDocument;
  catalog: EditorCatalog;
  nodeId: string;
  serviceId: string;
  parentNodeId: string | null;
  configurationValues: Readonly<Record<string, Readonly<ConfigurationValue>>>;
  createId: () => string;
}): PreparedResourceRepair {
  const node = input.document.nodes.find(
    (candidate) => candidate.id === input.nodeId,
  );
  const previous = input.catalog.services.find(
    (service) => service.serviceType === node?.semantic.serviceType,
  );
  const next = input.catalog.services.find(
    (service) => service.serviceType === input.serviceId,
  );
  if (
    !hasExactEditorCatalogBinding(input.document, input.catalog) ||
    !node ||
    !next ||
    !previous?.catalogGroup ||
    previous.catalogGroup.id !== next.catalogGroup?.id ||
    previous.serviceType === next.serviceType
  )
    throw new Error(
      "Choose a different type from this service’s available configuration choices.",
    );
  if (node.semantic.lifecycle.ownership === "generated")
    throw new Error("Adopt this generated resource before changing its type.");
  if (
    input.document.nodes.some(
      (candidate) => candidate.semantic.parent?.nodeId === node.id,
    )
  )
    throw new Error(
      "This service has dependent resources. Move or remove them explicitly before changing its type.",
    );
  const edges = input.document.edges.filter(
    (edge) =>
      edge.semantic.source.nodeId === node.id ||
      edge.semantic.target.nodeId === node.id,
  );
  if (
    edges.some(
      (edge) =>
        edge.semantic.relationshipType !==
          node.semantic.parent?.relationshipType ||
        ![edge.semantic.source.nodeId, edge.semantic.target.nodeId].includes(
          node.semantic.parent.nodeId,
        ),
    )
  )
    throw new Error(
      "This service has connections that depend on its type. Review and disconnect them before changing the type; no connections have been removed.",
    );
  const target = {
    documentId: input.document.documentId,
    architectureId: input.document.architectureId,
    revisionId: input.document.revision.revisionId,
  };
  const base = () => ({
    schemaVersion: 1 as const,
    commandId: input.createId(),
    inverseCommandId: input.createId(),
    origin: "user" as const,
    target,
  });
  const action = (value: unknown): GraphCommandActionV1 => {
    const parsed = parseGraphCommandV1(value);
    if (parsed.kind === "batch") throw new Error("Expected one operation.");
    return parsed;
  };
  const commands: GraphCommandActionV1[] = edges.map((edge) =>
    action({
      ...base(),
      kind: "remove-edge",
      edgeId: edge.id,
      expectedEdge: edge,
    }),
  );
  commands.push(
    action({
      ...base(),
      kind: "remove-node",
      nodeId: node.id,
      expectedNode: node,
    }),
  );
  let preview = input.document;
  for (const command of commands)
    preview = applyGraphCommand(preview, command).document;
  const addition = createAddServiceCommand({ ...input, document: preview });
  const replacement = {
    ...addition.node,
    id: node.id,
    semantic: {
      ...addition.node.semantic,
      deploymentKey: node.semantic.deploymentKey,
      lifecycle: node.semantic.lifecycle,
    },
    presentation: node.presentation,
  };
  const add = action({ ...base(), kind: "add-node", node: replacement });
  commands.push(add);
  preview = applyGraphCommand(preview, add).document;
  commands.push(
    ...prepareParentConnectionActions({
      document: preview,
      catalog: input.catalog,
      node: replacement,
      parent: replacement.semantic.parent ?? null,
      createId: input.createId,
    }),
  );
  const command = parseGraphCommandV1({ ...base(), kind: "batch", commands });
  const result = applyGraphCommand(input.document, command);
  return {
    command,
    beforeHashes: getArchitectureDocumentHashes(input.document),
    previewHashes: getArchitectureDocumentHashes(result.document),
    label: "Change service type",
    description:
      "Change " +
      previous.displayName +
      " to " +
      next.displayName +
      ". Review the new settings. Existing saved revisions keep their original file system type; an export may replace the deployed resource.",
  };
}
