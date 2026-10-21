import type { ArchitectureDocument } from "@cloudmarkup/domain";
import {
  digestCanonicalValue,
  parseGraphCommandV1,
  workloadTriggerBindingIdSchema,
} from "@cloudmarkup/schemas";

/**
 * Bind reviewed event edges to one declared workload operation. The command
 * remains version-bound and can be included in an atomic connection batch.
 */
export function prepareEventWorkloadBinding(
  document: ArchitectureDocument,
  edges: readonly ArchitectureDocument["edges"][number][],
  createId: () => string,
) {
  const additions = new Map<
    string,
    (typeof document.workloadBehavior.workloads)[number]["triggers"]
  >();
  for (const edge of edges) {
    const workload = document.workloadBehavior.workloads.find(
      (item) => item.owningNodeId === edge.semantic.target.nodeId,
    );
    const operation = workload?.operations[0];
    if (operation === undefined || workload?.operations.length !== 1)
      throw new Error(
        "Choose one workload purpose and operation before adding this event connection.",
      );
    if (workload.triggers.some((trigger) => trigger.edgeId === edge.id))
      continue;
    const pending = additions.get(workload.id) ?? [];
    additions.set(workload.id, [
      ...pending,
      {
        id: workloadTriggerBindingIdSchema.parse(
          "trigger_" + digestCanonicalValue(edge.id).slice(-32),
        ),
        edgeId: edge.id,
        targetOperationId: operation.id,
      },
    ]);
  }
  if (additions.size === 0) return null;
  const workloads = document.workloadBehavior.workloads.map((workload) => ({
    ...workload,
    triggers: [...workload.triggers, ...(additions.get(workload.id) ?? [])],
  }));
  const command = parseGraphCommandV1({
    schemaVersion: 1,
    commandId: createId(),
    inverseCommandId: createId(),
    origin: "user",
    target: {
      architectureId: document.architectureId,
      documentId: document.documentId,
      revisionId: document.revision.revisionId,
    },
    kind: "replace-workload-and-application-contracts",
    expectedWorkloadBehavior: document.workloadBehavior,
    expectedApplicationContracts: document.applicationContracts,
    workloadBehavior: { ...document.workloadBehavior, workloads },
    applicationContracts: document.applicationContracts,
  });
  if (command.kind !== "replace-workload-and-application-contracts")
    throw new TypeError("Expected a workload binding command.");
  return command;
}
