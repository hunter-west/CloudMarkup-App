import {
  applyGraphCommand,
  getArchitectureDocumentHashes,
  type ArchitectureDocument,
  type ArchitectureDocumentHashes,
} from "@cloudmarkup/domain";
import { parseGraphCommandV1, type GraphCommandV1 } from "@cloudmarkup/schemas";
import type { EditorCatalog } from "./editor-catalog.js";
import { hasExactEditorCatalogBinding } from "./catalog-selection.js";
import { prepareParentConnectionActions } from "./parent-connection-command.js";
import { prepareInfrastructureWorkloadCommand } from "./infrastructure-workload-command.js";

export type ResourceRepairKind =
  "parent-connection" | "infrastructure-workload";
export interface PreparedResourceRepair {
  readonly command: GraphCommandV1;
  readonly description: string;
  readonly label: string;
  readonly beforeHashes: ArchitectureDocumentHashes;
  readonly previewHashes: ArchitectureDocumentHashes;
}
export function prepareResourceRepair(input: {
  readonly document: ArchitectureDocument;
  readonly catalog: EditorCatalog;
  readonly nodeId: string;
  readonly kind: ResourceRepairKind;
  readonly createId: () => string;
}): PreparedResourceRepair | null {
  if (!hasExactEditorCatalogBinding(input.document, input.catalog))
    throw new Error("The exact catalog is required to review this repair.");
  const node = input.document.nodes.find(({ id }) => id === input.nodeId);
  if (node === undefined)
    throw new Error("This resource is no longer present.");
  let command: GraphCommandV1;
  let label: string;
  let description: string;
  if (input.kind === "infrastructure-workload") {
    command = prepareInfrastructureWorkloadCommand(input);
    label = "Set up infrastructure-only export";
    description =
      "Declare infrastructure-only behavior for this function. Application code must be supplied before deployment; no source, runtime, handler, or business logic is created.";
  } else {
    if (node.semantic.parent === undefined) return null;
    const commands = prepareParentConnectionActions({
      ...input,
      node,
      parent: node.semantic.parent,
    });
    if (commands.length === 0) return null;
    // Recovery may add one missing link only; reparenting and lifecycle edits use their own flows.
    if (commands.length !== 1 || commands[0]?.kind !== "add-edge")
      throw new Error(
        "Review the conflicting parent connections before repairing this placement.",
      );
    command = parseGraphCommandV1({
      schemaVersion: 1,
      commandId: input.createId(),
      inverseCommandId: input.createId(),
      origin: "user",
      target: commands[0].target,
      kind: "batch",
      commands,
    });
    label = "Repair parent connection";
    description =
      "Add the missing connection to the existing parent. The chosen parent, settings, and canvas position stay the same.";
  }
  const result = applyGraphCommand(input.document, command);
  return {
    command,
    label,
    description,
    beforeHashes: getArchitectureDocumentHashes(input.document),
    previewHashes: getArchitectureDocumentHashes(result.document),
  };
}
export function applyPreparedResourceRepair(
  document: ArchitectureDocument,
  prepared: PreparedResourceRepair,
) {
  const current = getArchitectureDocumentHashes(document);
  if (
    current.contentHash !== prepared.beforeHashes.contentHash ||
    current.visualHash !== prepared.beforeHashes.visualHash
  )
    throw new Error(
      "The design changed after this preview. Review the repair again.",
    );
  const result = applyGraphCommand(document, prepared.command);
  const after = getArchitectureDocumentHashes(result.document);
  if (
    after.contentHash !== prepared.previewHashes.contentHash ||
    after.visualHash !== prepared.previewHashes.visualHash
  )
    throw new Error(
      "The repair no longer matches its preview. Review it again.",
    );
  return result;
}
