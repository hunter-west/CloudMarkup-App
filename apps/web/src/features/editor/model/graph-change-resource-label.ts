import type { GraphChangeSummary } from "@cloudmarkup/domain";

export function graphChangeResourceLabel(change: GraphChangeSummary): string {
  if ("nodeId" in change) {
    return change.nodeId;
  }
  if ("edgeId" in change) {
    return change.edgeId;
  }
  if ("resource" in change) {
    return change.resource.kind === "node"
      ? change.resource.nodeId
      : change.resource.edgeId;
  }
  if (change.kind === "workload-and-application-contracts-replaced") {
    return `${String(change.workloadCount)} workloads · ${String(change.applicationContractCount)} contracts`;
  }
  if (change.kind === "catalog-binding-replaced")
    return `Catalog ${change.previousCatalog.version} → ${change.catalog.version}`;
  return `${String(change.commandCount)} commands`;
}
