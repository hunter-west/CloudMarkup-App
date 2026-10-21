import type {
  ArchitectureDocumentV2,
  ArchitectureDocumentV3,
  WorkloadV1,
  WorkloadV2,
} from "@cloudmarkup/schemas";

import type {
  ArchitectureDocumentSemanticIssue,
  ArchitectureDocumentSemanticIssueCode,
} from "./semantic-validation.js";

export function duplicateIssues<T>(
  items: readonly T[],
  valueOf: (item: T) => string,
  path: string,
  code: ArchitectureDocumentSemanticIssueCode,
  label: string,
): readonly ArchitectureDocumentSemanticIssue[] {
  const firstIndexByValue = new Map<string, number>();
  const issues: ArchitectureDocumentSemanticIssue[] = [];

  items.forEach((item, index) => {
    const value = valueOf(item);
    const firstIndex = firstIndexByValue.get(value);
    if (firstIndex === undefined) {
      firstIndexByValue.set(value, index);
      return;
    }

    issues.push({
      code,
      message: `Duplicate ${label}; first declared at ${path}[${String(firstIndex)}].`,
      path: `${path}[${String(index)}]`,
    });
  });

  return issues;
}

function duplicatePathIssues<T>(
  items: readonly { readonly item: T; readonly path: string }[],
  valueOf: (item: T) => string,
  code: ArchitectureDocumentSemanticIssueCode,
  label: string,
): readonly ArchitectureDocumentSemanticIssue[] {
  const firstPathByValue = new Map<string, string>();
  const issues: ArchitectureDocumentSemanticIssue[] = [];

  items.forEach(({ item, path }) => {
    const value = valueOf(item);
    const firstPath = firstPathByValue.get(value);
    if (firstPath === undefined) {
      firstPathByValue.set(value, path);
      return;
    }

    issues.push({
      code,
      message: `Duplicate ${label}; first declared at ${firstPath}.`,
      path,
    });
  });

  return issues;
}

function validateWorkloadCollectionUniqueness(
  workload: WorkloadV1 | WorkloadV2,
  path: string,
): readonly ArchitectureDocumentSemanticIssue[] {
  return [
    ...duplicateIssues(
      workload.triggers,
      (trigger) => trigger.edgeId,
      `${path}.triggers`,
      "duplicate_workload_trigger_edge_binding",
      "workload trigger edge binding",
    ),
    ...duplicateIssues(
      workload.downstreamActions,
      (action) =>
        `${String(action.edgeId)}\u0000${String(action.sourceOperationId)}`,
      `${path}.downstreamActions`,
      "duplicate_workload_downstream_edge_binding",
      "workload downstream edge and operation binding",
    ),
    ...duplicateIssues(
      workload.environment,
      (binding) => binding.name,
      `${path}.environment`,
      "duplicate_workload_environment_name",
      "workload environment name",
    ),
    ...duplicateIssues(
      workload.unresolvedRequirementIds,
      (requirementId) => requirementId,
      `${path}.unresolvedRequirementIds`,
      "duplicate_workload_requirement_reference",
      "workload unresolved requirement reference",
    ),
  ];
}

function implementationSupportsDispatch(
  workload: WorkloadV1 | WorkloadV2,
): boolean {
  const implementationMode = workload.implementation.mode;
  const dispatchMode = workload.triggerDispatch.mode;

  switch (implementationMode) {
    case "infrastructure-only":
      return dispatchMode === "single";
    case "user-provided":
    case "external-artifact":
      return dispatchMode === "single" || dispatchMode === "user-provided";
    case "generated-starter":
    case "complete-supported-pattern":
      return (
        dispatchMode === "single" || dispatchMode === "generated-supported"
      );
    case "ai-assisted-custom":
      return dispatchMode === "single" || dispatchMode === "user-provided";
  }
}

export function validateWorkloadBehaviorSemantics(
  document: ArchitectureDocumentV2 | ArchitectureDocumentV3,
): readonly ArchitectureDocumentSemanticIssue[] {
  const issues: ArchitectureDocumentSemanticIssue[] = [];
  const nodeIds = new Set(document.nodes.map((node) => node.id));
  const variableIds = new Set(
    document.variables.map((variable) => variable.id),
  );
  const requirementIds = new Set(
    document.unresolvedRequirements.map((requirement) => requirement.id),
  );
  const edgeById = new Map(
    document.edges.map((edge) => [edge.id, edge] as const),
  );
  const workloads: readonly (WorkloadV1 | WorkloadV2)[] = [
    ...document.workloadBehavior.workloads,
  ];

  issues.push(
    ...duplicateIssues(
      workloads,
      (workload) => workload.id,
      "$.workloadBehavior.workloads",
      "duplicate_workload_id",
      "workload ID",
    ),
    ...duplicateIssues(
      workloads,
      (workload) => workload.owningNodeId,
      "$.workloadBehavior.workloads",
      "duplicate_workload_owner",
      "workload owner",
    ),
    ...duplicatePathIssues(
      workloads.flatMap((workload, workloadIndex) =>
        workload.operations.map((operation, operationIndex) => ({
          item: operation,
          path: `$.workloadBehavior.workloads[${String(workloadIndex)}].operations[${String(operationIndex)}]`,
        })),
      ),
      (operation) => operation.id,
      "duplicate_workload_operation_id",
      "workload operation ID",
    ),
    ...duplicatePathIssues(
      workloads.flatMap((workload, workloadIndex) =>
        workload.triggers.map((trigger, triggerIndex) => ({
          item: trigger,
          path: `$.workloadBehavior.workloads[${String(workloadIndex)}].triggers[${String(triggerIndex)}]`,
        })),
      ),
      (trigger) => trigger.id,
      "duplicate_workload_trigger_binding_id",
      "workload trigger binding ID",
    ),
    ...duplicatePathIssues(
      workloads.flatMap((workload, workloadIndex) =>
        workload.downstreamActions.map((action, actionIndex) => ({
          item: action,
          path: `$.workloadBehavior.workloads[${String(workloadIndex)}].downstreamActions[${String(actionIndex)}]`,
        })),
      ),
      (action) => action.id,
      "duplicate_workload_downstream_binding_id",
      "workload downstream binding ID",
    ),
    ...duplicatePathIssues(
      workloads.flatMap((workload, workloadIndex) =>
        workload.environment.map((binding, bindingIndex) => ({
          item: binding,
          path: `$.workloadBehavior.workloads[${String(workloadIndex)}].environment[${String(bindingIndex)}]`,
        })),
      ),
      (binding) => binding.id,
      "duplicate_workload_environment_binding_id",
      "workload environment binding ID",
    ),
  );

  workloads.forEach((workload, workloadIndex) => {
    const path = `$.workloadBehavior.workloads[${String(workloadIndex)}]`;
    const operationIds = new Set(
      workload.operations.map((operation) => operation.id),
    );

    issues.push(...validateWorkloadCollectionUniqueness(workload, path));

    if (!nodeIds.has(workload.owningNodeId)) {
      issues.push({
        code: "broken_workload_owner_reference",
        message: "Workload ownership references a node that does not exist.",
        path: `${path}.owningNodeId`,
      });
    }

    workload.triggers.forEach((trigger, triggerIndex) => {
      const triggerPath = `${path}.triggers[${String(triggerIndex)}]`;
      const edge = edgeById.get(trigger.edgeId);
      if (edge === undefined) {
        issues.push({
          code: "broken_workload_trigger_edge_reference",
          message: "Workload trigger references an edge that does not exist.",
          path: `${triggerPath}.edgeId`,
        });
      } else if (edge.semantic.target.nodeId !== workload.owningNodeId) {
        issues.push({
          code: "invalid_workload_trigger_edge_ownership",
          message:
            "A workload trigger edge must target the workload's owning node.",
          path: `${triggerPath}.edgeId`,
        });
      }

      if (!operationIds.has(trigger.targetOperationId)) {
        issues.push({
          code: "broken_workload_trigger_operation_reference",
          message:
            "Workload trigger references an operation that is not declared by its workload.",
          path: `${triggerPath}.targetOperationId`,
        });
      }
    });

    workload.downstreamActions.forEach((action, actionIndex) => {
      const actionPath = `${path}.downstreamActions[${String(actionIndex)}]`;
      const edge = edgeById.get(action.edgeId);
      if (edge === undefined) {
        issues.push({
          code: "broken_workload_downstream_edge_reference",
          message:
            "Workload downstream action references an edge that does not exist.",
          path: `${actionPath}.edgeId`,
        });
      } else if (edge.semantic.source.nodeId !== workload.owningNodeId) {
        issues.push({
          code: "invalid_workload_downstream_edge_ownership",
          message:
            "A workload downstream edge must originate from the workload's owning node.",
          path: `${actionPath}.edgeId`,
        });
      }

      if (!operationIds.has(action.sourceOperationId)) {
        issues.push({
          code: "broken_workload_downstream_operation_reference",
          message:
            "Workload downstream action references an operation that is not declared by its workload.",
          path: `${actionPath}.sourceOperationId`,
        });
      }
    });

    workload.environment.forEach((binding, bindingIndex) => {
      const valuePath = `${path}.environment[${String(bindingIndex)}].value`;
      if (
        binding.value.kind === "variable-reference" &&
        !variableIds.has(binding.value.variableId)
      ) {
        issues.push({
          code: "broken_workload_environment_variable_reference",
          message:
            "Workload environment references a variable that does not exist.",
          path: `${valuePath}.variableId`,
        });
      }

      if (
        binding.value.kind === "node-attribute-reference" &&
        !nodeIds.has(binding.value.nodeId)
      ) {
        issues.push({
          code: "broken_workload_environment_node_reference",
          message:
            "Workload environment references a node that does not exist.",
          path: `${valuePath}.nodeId`,
        });
      }
    });

    workload.unresolvedRequirementIds.forEach(
      (requirementId, requirementIndex) => {
        if (!requirementIds.has(requirementId)) {
          issues.push({
            code: "broken_workload_requirement_reference",
            message:
              "Workload references an unresolved requirement that does not exist.",
            path: `${path}.unresolvedRequirementIds[${String(requirementIndex)}]`,
          });
        }
      },
    );

    if (
      workload.triggerDispatch.mode !== "single" &&
      !operationIds.has(workload.triggerDispatch.dispatcherOperationId)
    ) {
      issues.push({
        code: "broken_workload_dispatcher_operation_reference",
        message:
          "Trigger dispatch references an operation that is not declared by its workload.",
        path: `${path}.triggerDispatch.dispatcherOperationId`,
      });
    }

    if (!implementationSupportsDispatch(workload)) {
      issues.push({
        code: "invalid_workload_dispatch_mode_for_implementation",
        message:
          "Workload trigger dispatch mode is incompatible with its implementation source ownership.",
        path: `${path}.triggerDispatch.mode`,
      });
    }
  });

  return issues;
}
