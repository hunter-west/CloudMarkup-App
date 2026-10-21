import type {
  ConfigurationValue,
  ServiceConfigurationRecord,
  VersionedArchitectureDocument,
} from "@cloudmarkup/schemas";

import { validateSolutionReferences } from "./solution-reference-validation.js";
import {
  duplicateIssues,
  validateWorkloadBehaviorSemantics,
} from "./workload-semantic-validation.js";

export type ArchitectureDocumentSemanticIssueCode =
  | "application_contract_digest_mismatch"
  | "application_contract_kind_mismatch"
  | "broken_application_contract_reference"
  | "broken_external_resource_node_reference"
  | "broken_workload_dispatcher_operation_reference"
  | "broken_workload_extension_reference"
  | "broken_workload_v2_edge_reference"
  | "broken_workload_v2_operation_reference"
  | "broken_workload_downstream_edge_reference"
  | "broken_workload_downstream_operation_reference"
  | "broken_workload_environment_node_reference"
  | "broken_workload_environment_variable_reference"
  | "broken_workload_owner_reference"
  | "broken_workload_requirement_reference"
  | "broken_workload_trigger_edge_reference"
  | "broken_workload_trigger_operation_reference"
  | "broken_configuration_node_reference"
  | "broken_configuration_variable_reference"
  | "broken_edge_source_reference"
  | "broken_edge_target_reference"
  | "broken_generated_edge_reference"
  | "broken_generated_node_reference"
  | "broken_output_node_reference"
  | "broken_output_variable_reference"
  | "broken_parent_reference"
  | "duplicate_assumption_id"
  | "duplicate_deployment_key"
  | "duplicate_edge_id"
  | "duplicate_generated_edge_reference"
  | "duplicate_generated_node_reference"
  | "duplicate_node_id"
  | "duplicate_output_id"
  | "duplicate_output_key"
  | "duplicate_requirement_id"
  | "duplicate_variable_id"
  | "duplicate_variable_key"
  | "duplicate_workload_downstream_binding_id"
  | "duplicate_workload_downstream_edge_binding"
  | "duplicate_workload_environment_binding_id"
  | "duplicate_workload_environment_name"
  | "duplicate_workload_extension_id"
  | "duplicate_workload_id"
  | "duplicate_workload_operation_id"
  | "duplicate_workload_owner"
  | "duplicate_workload_requirement_reference"
  | "duplicate_workload_trigger_binding_id"
  | "duplicate_workload_trigger_edge_binding"
  | "invalid_workload_downstream_edge_ownership"
  | "invalid_workload_dispatch_mode_for_implementation"
  | "invalid_workload_trigger_edge_ownership"
  | "invalid_workload_model_compatibility"
  | "missing_workload_model_compatibility"
  | "duplicate_application_contract_identity"
  | "duplicate_external_resource_id"
  | "invalid_variable_default"
  | "parent_cycle"
  | "self_generated_edge_reference"
  | "self_generated_node_reference"
  | "self_parent";

export interface ArchitectureDocumentSemanticIssue {
  readonly code: ArchitectureDocumentSemanticIssueCode;
  readonly message: string;
  readonly path: string;
}

function compareUtf16(left: string, right: string): number {
  if (left === right) {
    return 0;
  }

  return left < right ? -1 : 1;
}

function validateConfigurationReferences(
  configuration: ServiceConfigurationRecord,
  path: string,
  nodeIds: ReadonlySet<string>,
  variableIds: ReadonlySet<string>,
): readonly ArchitectureDocumentSemanticIssue[] {
  const issues: ArchitectureDocumentSemanticIssue[] = [];

  Object.entries(configuration.values).forEach(([key, value]) => {
    const valuePath = `${path}.values.${key}`;

    if (value.kind === "node-reference" && !nodeIds.has(value.nodeId)) {
      issues.push({
        code: "broken_configuration_node_reference",
        message: "Configuration references a node that does not exist.",
        path: `${valuePath}.nodeId`,
      });
    }

    if (
      value.kind === "variable-reference" &&
      !variableIds.has(value.variableId)
    ) {
      issues.push({
        code: "broken_configuration_variable_reference",
        message: "Configuration references a variable that does not exist.",
        path: `${valuePath}.variableId`,
      });
    }
  });

  return issues;
}

function variableDefaultMatches(
  valueType: VersionedArchitectureDocument["variables"][number]["valueType"],
  defaultValue: ConfigurationValue,
): boolean {
  return defaultValue.kind === valueType;
}

function validateGeneratedProvenance(
  lifecycle: VersionedArchitectureDocument["nodes"][number]["semantic"]["lifecycle"],
  path: string,
  nodeIds: ReadonlySet<string>,
  edgeIds: ReadonlySet<string>,
  owner:
    | { readonly kind: "node"; readonly id: string }
    | { readonly kind: "edge"; readonly id: string },
): readonly ArchitectureDocumentSemanticIssue[] {
  if (lifecycle.ownership === "user") {
    return [];
  }

  const issues: ArchitectureDocumentSemanticIssue[] = [];

  issues.push(
    ...duplicateIssues(
      lifecycle.provenance.dependentNodeIds,
      (nodeId) => nodeId,
      `${path}.provenance.dependentNodeIds`,
      "duplicate_generated_node_reference",
      "generated dependent node reference",
    ),
    ...duplicateIssues(
      lifecycle.provenance.dependentEdgeIds,
      (edgeId) => edgeId,
      `${path}.provenance.dependentEdgeIds`,
      "duplicate_generated_edge_reference",
      "generated dependent edge reference",
    ),
  );

  lifecycle.provenance.dependentNodeIds.forEach(
    (dependentNodeId, dependentIndex) => {
      if (owner.kind === "node" && owner.id === dependentNodeId) {
        issues.push({
          code: "self_generated_node_reference",
          message: "Generated provenance cannot depend on its own node.",
          path: `${path}.provenance.dependentNodeIds[${String(dependentIndex)}]`,
        });
      } else if (!nodeIds.has(dependentNodeId)) {
        issues.push({
          code: "broken_generated_node_reference",
          message:
            "Generated provenance references a node that does not exist.",
          path: `${path}.provenance.dependentNodeIds[${String(dependentIndex)}]`,
        });
      }
    },
  );
  lifecycle.provenance.dependentEdgeIds.forEach(
    (dependentEdgeId, dependentIndex) => {
      if (owner.kind === "edge" && owner.id === dependentEdgeId) {
        issues.push({
          code: "self_generated_edge_reference",
          message: "Generated provenance cannot depend on its own edge.",
          path: `${path}.provenance.dependentEdgeIds[${String(dependentIndex)}]`,
        });
      } else if (!edgeIds.has(dependentEdgeId)) {
        issues.push({
          code: "broken_generated_edge_reference",
          message:
            "Generated provenance references an edge that does not exist.",
          path: `${path}.provenance.dependentEdgeIds[${String(dependentIndex)}]`,
        });
      }
    },
  );

  return issues;
}

function validateParentCycles(
  document: VersionedArchitectureDocument,
  nodeIndexById: ReadonlyMap<string, number>,
): readonly ArchitectureDocumentSemanticIssue[] {
  const parentByNodeId = new Map(
    document.nodes
      .filter((node) => node.semantic.parent !== undefined)
      .map((node) => [node.id, node.semantic.parent?.nodeId] as const),
  );
  const issues: ArchitectureDocumentSemanticIssue[] = [];
  const reported = new Set<string>();

  document.nodes.forEach((node) => {
    const visited = new Set<string>([node.id]);
    let current = parentByNodeId.get(node.id);

    while (current !== undefined) {
      if (visited.has(current)) {
        if (current !== node.id || parentByNodeId.get(node.id) === node.id) {
          return;
        }

        const index = nodeIndexById.get(node.id);
        if (index !== undefined && !reported.has(node.id)) {
          reported.add(node.id);
          issues.push({
            code: "parent_cycle",
            message: "Parent relationships must not form a cycle.",
            path: `$.nodes[${String(index)}].semantic.parent.nodeId`,
          });
        }
        return;
      }

      visited.add(current);
      current = parentByNodeId.get(current);
    }
  });

  return issues;
}

export function validateArchitectureDocumentSemantics(
  document: VersionedArchitectureDocument,
): readonly ArchitectureDocumentSemanticIssue[] {
  const issues: ArchitectureDocumentSemanticIssue[] = [];
  const nodeIds = new Set(document.nodes.map((node) => node.id));
  const edgeIds = new Set(document.edges.map((edge) => edge.id));
  const variableIds = new Set(
    document.variables.map((variable) => variable.id),
  );
  const nodeIndexById = new Map(
    document.nodes.map((node, index) => [node.id, index] as const),
  );

  issues.push(
    ...duplicateIssues(
      document.nodes,
      (node) => node.id,
      "$.nodes",
      "duplicate_node_id",
      "node ID",
    ),
    ...duplicateIssues(
      document.nodes,
      (node) => node.semantic.deploymentKey,
      "$.nodes",
      "duplicate_deployment_key",
      "node deployment key",
    ),
    ...duplicateIssues(
      document.edges,
      (edge) => edge.id,
      "$.edges",
      "duplicate_edge_id",
      "edge ID",
    ),
    ...duplicateIssues(
      document.variables,
      (variable) => variable.id,
      "$.variables",
      "duplicate_variable_id",
      "variable ID",
    ),
    ...duplicateIssues(
      document.variables,
      (variable) => variable.key,
      "$.variables",
      "duplicate_variable_key",
      "variable key",
    ),
    ...duplicateIssues(
      document.outputs,
      (output) => output.id,
      "$.outputs",
      "duplicate_output_id",
      "output ID",
    ),
    ...duplicateIssues(
      document.outputs,
      (output) => output.key,
      "$.outputs",
      "duplicate_output_key",
      "output key",
    ),
    ...duplicateIssues(
      document.assumptions,
      (assumption) => assumption.id,
      "$.assumptions",
      "duplicate_assumption_id",
      "assumption ID",
    ),
    ...duplicateIssues(
      document.unresolvedRequirements,
      (requirement) => requirement.id,
      "$.unresolvedRequirements",
      "duplicate_requirement_id",
      "unresolved requirement ID",
    ),
  );

  document.nodes.forEach((node, index) => {
    const parentId = node.semantic.parent?.nodeId;

    if (parentId === node.id) {
      issues.push({
        code: "self_parent",
        message: "A node cannot be its own parent.",
        path: `$.nodes[${String(index)}].semantic.parent.nodeId`,
      });
    } else if (parentId !== undefined && !nodeIds.has(parentId)) {
      issues.push({
        code: "broken_parent_reference",
        message: "Parent references a node that does not exist.",
        path: `$.nodes[${String(index)}].semantic.parent.nodeId`,
      });
    }

    issues.push(
      ...validateConfigurationReferences(
        node.semantic.configuration,
        `$.nodes[${String(index)}].semantic.configuration`,
        nodeIds,
        variableIds,
      ),
    );

    issues.push(
      ...validateGeneratedProvenance(
        node.semantic.lifecycle,
        `$.nodes[${String(index)}].semantic.lifecycle`,
        nodeIds,
        edgeIds,
        { kind: "node", id: node.id },
      ),
    );
  });

  issues.push(...validateParentCycles(document, nodeIndexById));

  document.edges.forEach((edge, index) => {
    if (!nodeIds.has(edge.semantic.source.nodeId)) {
      issues.push({
        code: "broken_edge_source_reference",
        message: "Edge source references a node that does not exist.",
        path: `$.edges[${String(index)}].semantic.source.nodeId`,
      });
    }

    if (!nodeIds.has(edge.semantic.target.nodeId)) {
      issues.push({
        code: "broken_edge_target_reference",
        message: "Edge target references a node that does not exist.",
        path: `$.edges[${String(index)}].semantic.target.nodeId`,
      });
    }

    issues.push(
      ...validateConfigurationReferences(
        edge.semantic.configuration,
        `$.edges[${String(index)}].semantic.configuration`,
        nodeIds,
        variableIds,
      ),
      ...validateGeneratedProvenance(
        edge.semantic.lifecycle,
        `$.edges[${String(index)}].semantic.lifecycle`,
        nodeIds,
        edgeIds,
        { kind: "edge", id: edge.id },
      ),
    );
  });

  document.variables.forEach((variable, index) => {
    if (
      variable.defaultValue !== undefined &&
      !variableDefaultMatches(variable.valueType, variable.defaultValue)
    ) {
      issues.push({
        code: "invalid_variable_default",
        message: "Variable default kind must match its declared value type.",
        path: `$.variables[${String(index)}].defaultValue`,
      });
    }
  });

  document.outputs.forEach((output, index) => {
    if (
      output.source.kind === "node-attribute" &&
      !nodeIds.has(output.source.nodeId)
    ) {
      issues.push({
        code: "broken_output_node_reference",
        message: "Output references a node that does not exist.",
        path: `$.outputs[${String(index)}].source.nodeId`,
      });
    }

    if (
      output.source.kind === "variable" &&
      !variableIds.has(output.source.variableId)
    ) {
      issues.push({
        code: "broken_output_variable_reference",
        message: "Output references a variable that does not exist.",
        path: `$.outputs[${String(index)}].source.variableId`,
      });
    }
  });

  if ("workloadBehavior" in document) {
    issues.push(...validateWorkloadBehaviorSemantics(document));
  }

  if (document.schemaVersion === 3) {
    issues.push(...validateSolutionReferences(document));
  }

  return issues.sort(
    (left, right) =>
      compareUtf16(left.path, right.path) ||
      compareUtf16(left.code, right.code) ||
      compareUtf16(left.message, right.message),
  );
}

export function formatArchitectureDocumentSemanticIssues(
  issues: readonly ArchitectureDocumentSemanticIssue[],
): string {
  return issues
    .map((issue) => `${issue.path}: ${issue.message} [${issue.code}]`)
    .join("\n");
}

export class ArchitectureDocumentSemanticError extends Error {
  public readonly issues: readonly ArchitectureDocumentSemanticIssue[];

  public constructor(issues: readonly ArchitectureDocumentSemanticIssue[]) {
    super(formatArchitectureDocumentSemanticIssues(issues));
    this.name = "ArchitectureDocumentSemanticError";
    this.issues = issues;
  }
}
