package compiler

import "fmt"

func validateAdditionalWorkloadSemantics(workload workloadWire, path string, document DocumentKind, nodes map[string]nodeWire, architecture architectureWire, collector *diagnosticCollector) {
	variables := variablesFromSlice(architecture.Variables)
	for index, binding := range workload.Environment {
		source := SourceReference{Document: document, Path: fmt.Sprintf("%s.environment[%d].value", path, index), WorkloadID: workload.ID}
		switch binding.Value.Kind {
		case "variable-reference":
			if _, exists := variables[binding.Value.VariableID]; !exists {
				collector.addError("SEMANTIC_WORKLOAD_ENVIRONMENT_VARIABLE_MISSING", "Workload environment references a variable that does not exist.", source)
			}
		case "node-attribute-reference":
			if _, exists := nodes[binding.Value.NodeID]; !exists {
				collector.addError("SEMANTIC_WORKLOAD_ENVIRONMENT_NODE_MISSING", "Workload environment references a node that does not exist.", source)
			}
		}
	}

	if !workloadImplementationSupportsDispatch(workload.Implementation.Mode, workload.TriggerDispatch.Mode) {
		collector.addError(
			"SEMANTIC_WORKLOAD_DISPATCH_MODE_INVALID",
			"Trigger dispatch mode is incompatible with workload implementation ownership.",
			SourceReference{Document: document, Path: path + ".triggerDispatch.mode", WorkloadID: workload.ID},
		)
	}
}

func workloadImplementationSupportsDispatch(implementationMode string, dispatchMode string) bool {
	switch implementationMode {
	case "infrastructure-only":
		return dispatchMode == "single"
	case "user-provided", "external-artifact", "ai-assisted-custom":
		return dispatchMode == "single" || dispatchMode == "user-provided"
	case "generated-starter", "complete-supported-pattern":
		return dispatchMode == "single" || dispatchMode == "generated-supported"
	default:
		return false
	}
}
