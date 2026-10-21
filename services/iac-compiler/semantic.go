package compiler

import (
	"bytes"
	"context"
	"fmt"
)

func validateSemantics(ctx context.Context, request Request, decoded *decodedRequest, hashes contentHashes, collector *diagnosticCollector) {
	architecture := decoded.architecture
	validateEmbeddedSolutionSemantics(decoded, collector)
	if len(architecture.Nodes) > request.Limits.MaxNodes {
		collector.addError("LIMIT_NODE_COUNT_EXCEEDED", "Architecture Document exceeds the configured node limit.", SourceReference{Document: DocumentArchitecture, Path: "$.nodes"})
	}
	if len(architecture.Edges) > request.Limits.MaxEdges {
		collector.addError("LIMIT_EDGE_COUNT_EXCEEDED", "Architecture Document exceeds the configured edge limit.", SourceReference{Document: DocumentArchitecture, Path: "$.edges"})
	}
	if len(decoded.workload.Workloads) > request.Limits.MaxWorkloads {
		collector.addError("LIMIT_WORKLOAD_COUNT_EXCEEDED", "Workload Document exceeds the configured workload limit.", SourceReference{Document: workloadDocument(request), Path: "$.workloads"})
	}

	nodes := make(map[string]nodeWire, len(architecture.Nodes))
	deploymentKeys := make(map[string]int, len(architecture.Nodes))
	for index, node := range architecture.Nodes {
		if canceled(ctx, collector, SourceReference{Document: DocumentArchitecture, Path: fmt.Sprintf("$.nodes[%d]", index), NodeID: node.ID}) {
			return
		}
		if _, exists := nodes[node.ID]; exists {
			collector.addError("SEMANTIC_DUPLICATE_NODE_ID", "Node IDs must be unique.", SourceReference{Document: DocumentArchitecture, Path: fmt.Sprintf("$.nodes[%d].id", index), NodeID: node.ID})
		} else {
			nodes[node.ID] = node
		}
		if first, exists := deploymentKeys[node.Semantic.DeploymentKey]; exists {
			collector.add(Diagnostic{
				Code: "SEMANTIC_DEPLOYMENT_KEY_COLLISION", Severity: SeverityError,
				Message: "Persisted deployment keys must be unique; deterministic target-key disambiguation does not make the source document valid.",
				Source:  SourceReference{Document: DocumentArchitecture, Path: fmt.Sprintf("$.nodes[%d].semantic.deploymentKey", index), NodeID: node.ID},
				Related: []SourceReference{{Document: DocumentArchitecture, Path: fmt.Sprintf("$.nodes[%d].semantic.deploymentKey", first), NodeID: architecture.Nodes[first].ID}},
			})
		} else {
			deploymentKeys[node.Semantic.DeploymentKey] = index
		}
		validateConfigurationReferences(node.Semantic.Configuration, nodesFromSlice(architecture.Nodes), variablesFromSlice(architecture.Variables), fmt.Sprintf("$.nodes[%d].semantic.configuration", index), SourceReference{Document: DocumentArchitecture, NodeID: node.ID}, collector)
	}

	edges := make(map[string]edgeWire, len(architecture.Edges))
	for index, edge := range architecture.Edges {
		if _, exists := edges[edge.ID]; exists {
			collector.addError("SEMANTIC_DUPLICATE_EDGE_ID", "Edge IDs must be unique.", SourceReference{Document: DocumentArchitecture, Path: fmt.Sprintf("$.edges[%d].id", index), EdgeID: edge.ID})
		} else {
			edges[edge.ID] = edge
		}
		if _, exists := nodes[edge.Semantic.Source.NodeID]; !exists {
			collector.addError("SEMANTIC_EDGE_SOURCE_MISSING", "Edge source references a node that does not exist.", SourceReference{Document: DocumentArchitecture, Path: fmt.Sprintf("$.edges[%d].semantic.source.nodeId", index), EdgeID: edge.ID})
		}
		if _, exists := nodes[edge.Semantic.Target.NodeID]; !exists {
			collector.addError("SEMANTIC_EDGE_TARGET_MISSING", "Edge target references a node that does not exist.", SourceReference{Document: DocumentArchitecture, Path: fmt.Sprintf("$.edges[%d].semantic.target.nodeId", index), EdgeID: edge.ID})
		}
		validateConfigurationReferences(edge.Semantic.Configuration, nodesFromSlice(architecture.Nodes), variablesFromSlice(architecture.Variables), fmt.Sprintf("$.edges[%d].semantic.configuration", index), SourceReference{Document: DocumentArchitecture, EdgeID: edge.ID}, collector)
	}

	validateParentReferences(architecture.Nodes, nodes, collector)
	validateLifecycleReferences(architecture.Nodes, architecture.Edges, nodes, edges, collector)
	validateVariablesAndOutputs(architecture, nodes, collector)
	validateStandaloneWorkloadBinding(request, decoded, collector)
	validateWorkloads(ctx, request, decoded.workload, nodes, edges, architecture, collector)
	validateSolutionBinding(decoded, hashes, collector)
}

func validateConfigurationReferences(configuration configurationWire, nodes map[string]struct{}, variables map[string]struct{}, path string, source SourceReference, collector *diagnosticCollector) {
	for key, value := range configuration.Values {
		reference := source
		reference.Path = path + ".values[" + fmt.Sprintf("%q", key) + "]"
		if value.Kind == "node-reference" {
			if _, exists := nodes[value.NodeID]; !exists {
				collector.addError("SEMANTIC_CONFIGURATION_NODE_MISSING", "Configuration references a node that does not exist.", reference)
			}
		}
		if value.Kind == "variable-reference" {
			if _, exists := variables[value.VariableID]; !exists {
				collector.addError("SEMANTIC_CONFIGURATION_VARIABLE_MISSING", "Configuration references a variable that does not exist.", reference)
			}
		}
	}
}

func validateParentReferences(nodeList []nodeWire, nodes map[string]nodeWire, collector *diagnosticCollector) {
	parentByNode := make(map[string]string)
	for index, node := range nodeList {
		if node.Semantic.Parent == nil {
			continue
		}
		parentID := node.Semantic.Parent.NodeID
		path := fmt.Sprintf("$.nodes[%d].semantic.parent.nodeId", index)
		if parentID == node.ID {
			collector.addError("SEMANTIC_PARENT_SELF_REFERENCE", "A node cannot be its own parent.", SourceReference{Document: DocumentArchitecture, Path: path, NodeID: node.ID})
			continue
		}
		if _, exists := nodes[parentID]; !exists {
			collector.addError("SEMANTIC_PARENT_MISSING", "Node parent references a node that does not exist.", SourceReference{Document: DocumentArchitecture, Path: path, NodeID: node.ID})
			continue
		}
		parentByNode[node.ID] = parentID
	}
	for index, node := range nodeList {
		seen := map[string]struct{}{node.ID: {}}
		current := parentByNode[node.ID]
		for current != "" {
			if _, exists := seen[current]; exists {
				collector.addError("SEMANTIC_PARENT_CYCLE", "Parent relationships must not form a cycle.", SourceReference{Document: DocumentArchitecture, Path: fmt.Sprintf("$.nodes[%d].semantic.parent.nodeId", index), NodeID: node.ID})
				break
			}
			seen[current] = struct{}{}
			current = parentByNode[current]
		}
	}
}

func validateLifecycleReferences(nodeList []nodeWire, edgeList []edgeWire, nodes map[string]nodeWire, edges map[string]edgeWire, collector *diagnosticCollector) {
	for index, node := range nodeList {
		validateProvenance(node.Semantic.Lifecycle.Provenance, node.ID, "", nodes, edges, fmt.Sprintf("$.nodes[%d].semantic.lifecycle.provenance", index), collector)
	}
	for index, edge := range edgeList {
		validateProvenance(edge.Semantic.Lifecycle.Provenance, "", edge.ID, nodes, edges, fmt.Sprintf("$.edges[%d].semantic.lifecycle.provenance", index), collector)
	}
}

func validateProvenance(provenance *generatedProvenanceWire, ownerNodeID string, ownerEdgeID string, nodes map[string]nodeWire, edges map[string]edgeWire, path string, collector *diagnosticCollector) {
	if provenance == nil {
		return
	}
	seenNodes := make(map[string]struct{})
	for index, nodeID := range provenance.DependentNodeIDs {
		source := SourceReference{Document: DocumentArchitecture, Path: fmt.Sprintf("%s.dependentNodeIds[%d]", path, index), NodeID: ownerNodeID, EdgeID: ownerEdgeID}
		if nodeID == ownerNodeID {
			collector.addError("SEMANTIC_PROVENANCE_SELF_REFERENCE", "Generated provenance cannot depend on its owning node.", source)
		}
		if _, exists := nodes[nodeID]; !exists {
			collector.addError("SEMANTIC_PROVENANCE_NODE_MISSING", "Generated provenance references a node that does not exist.", source)
		}
		if _, duplicate := seenNodes[nodeID]; duplicate {
			collector.addError("SEMANTIC_PROVENANCE_NODE_DUPLICATE", "Generated provenance node references must be unique.", source)
		}
		seenNodes[nodeID] = struct{}{}
	}
	seenEdges := make(map[string]struct{})
	for index, edgeID := range provenance.DependentEdgeIDs {
		source := SourceReference{Document: DocumentArchitecture, Path: fmt.Sprintf("%s.dependentEdgeIds[%d]", path, index), NodeID: ownerNodeID, EdgeID: ownerEdgeID}
		if edgeID == ownerEdgeID {
			collector.addError("SEMANTIC_PROVENANCE_SELF_REFERENCE", "Generated provenance cannot depend on its owning edge.", source)
		}
		if _, exists := edges[edgeID]; !exists {
			collector.addError("SEMANTIC_PROVENANCE_EDGE_MISSING", "Generated provenance references an edge that does not exist.", source)
		}
		if _, duplicate := seenEdges[edgeID]; duplicate {
			collector.addError("SEMANTIC_PROVENANCE_EDGE_DUPLICATE", "Generated provenance edge references must be unique.", source)
		}
		seenEdges[edgeID] = struct{}{}
	}
}

func validateVariablesAndOutputs(architecture architectureWire, nodes map[string]nodeWire, collector *diagnosticCollector) {
	variableIDs := make(map[string]int)
	variableKeys := make(map[string]int)
	for index, variable := range architecture.Variables {
		if _, exists := variableIDs[variable.ID]; exists {
			collector.addError("SEMANTIC_DUPLICATE_VARIABLE_ID", "Variable IDs must be unique.", SourceReference{Document: DocumentArchitecture, Path: fmt.Sprintf("$.variables[%d].id", index)})
		}
		variableIDs[variable.ID] = index
		if _, exists := variableKeys[variable.Key]; exists {
			collector.addError("SEMANTIC_DUPLICATE_VARIABLE_KEY", "Variable keys must be unique.", SourceReference{Document: DocumentArchitecture, Path: fmt.Sprintf("$.variables[%d].key", index)})
		}
		variableKeys[variable.Key] = index
		if variable.DefaultValue != nil && variable.DefaultValue.Kind != variable.ValueType {
			collector.addError("SEMANTIC_VARIABLE_DEFAULT_TYPE", "Variable default kind must match its declared value type.", SourceReference{Document: DocumentArchitecture, Path: fmt.Sprintf("$.variables[%d].defaultValue", index)})
		}
	}
	outputIDs := make(map[string]struct{})
	outputKeys := make(map[string]struct{})
	for index, output := range architecture.Outputs {
		if _, exists := outputIDs[output.ID]; exists {
			collector.addError("SEMANTIC_DUPLICATE_OUTPUT_ID", "Output IDs must be unique.", SourceReference{Document: DocumentArchitecture, Path: fmt.Sprintf("$.outputs[%d].id", index)})
		}
		outputIDs[output.ID] = struct{}{}
		if _, exists := outputKeys[output.Key]; exists {
			collector.addError("SEMANTIC_DUPLICATE_OUTPUT_KEY", "Output keys must be unique.", SourceReference{Document: DocumentArchitecture, Path: fmt.Sprintf("$.outputs[%d].key", index)})
		}
		outputKeys[output.Key] = struct{}{}
		if output.Source.Kind == "node-attribute" {
			if _, exists := nodes[output.Source.NodeID]; !exists {
				collector.addError("SEMANTIC_OUTPUT_NODE_MISSING", "Output references a node that does not exist.", SourceReference{Document: DocumentArchitecture, Path: fmt.Sprintf("$.outputs[%d].source.nodeId", index)})
			}
		}
		if output.Source.Kind == "variable" {
			if _, exists := variableIDs[output.Source.VariableID]; !exists {
				collector.addError("SEMANTIC_OUTPUT_VARIABLE_MISSING", "Output references a variable that does not exist.", SourceReference{Document: DocumentArchitecture, Path: fmt.Sprintf("$.outputs[%d].source.variableId", index)})
			}
		}
	}
}

func validateStandaloneWorkloadBinding(request Request, decoded *decodedRequest, collector *diagnosticCollector) {
	if len(request.Workload) == 0 {
		return
	}
	embedded, err := serializeCanonical(normalizeWorkloadMap(cloneMap(objectValue(decoded.architectureRaw, "workloadBehavior"))))
	if err != nil {
		collector.addError("COMPILER_CANONICALIZATION_FAILED", "Embedded Workload Document could not be canonicalized.", SourceReference{Document: DocumentArchitecture, Path: "$.workloadBehavior"})
		return
	}
	standalone, err := serializeCanonical(normalizeWorkloadMap(cloneMap(decoded.workloadRaw)))
	if err != nil {
		collector.addError("COMPILER_CANONICALIZATION_FAILED", "Standalone Workload Document could not be canonicalized.", SourceReference{Document: DocumentWorkload})
		return
	}
	if !bytes.Equal(embedded, standalone) {
		collector.add(Diagnostic{
			Code: "SEMANTIC_WORKLOAD_ARCHITECTURE_MISMATCH", Severity: SeverityError,
			Message: "Standalone Workload Document does not exactly match the Workload Behavior frozen in the Architecture Document.",
			Source:  SourceReference{Document: DocumentWorkload},
			Related: []SourceReference{{Document: DocumentArchitecture, Path: "$.workloadBehavior"}},
		})
	}
}

func validateWorkloads(ctx context.Context, request Request, behavior workloadBehaviorWire, nodes map[string]nodeWire, edges map[string]edgeWire, architecture architectureWire, collector *diagnosticCollector) {
	document := workloadDocument(request)
	workloadIDs := make(map[string]int)
	owners := make(map[string]int)
	globalOperationIDs := make(map[string]SourceReference)
	globalTriggerIDs := make(map[string]SourceReference)
	globalActionIDs := make(map[string]SourceReference)
	globalEnvironmentIDs := make(map[string]SourceReference)
	requirements := make(map[string]struct{})
	for _, requirement := range architecture.UnresolvedRequirements {
		requirements[requirement.ID] = struct{}{}
	}
	totalOperations := 0
	for workloadIndex, workload := range behavior.Workloads {
		path := fmt.Sprintf("$.workloads[%d]", workloadIndex)
		if canceled(ctx, collector, SourceReference{Document: document, Path: path, WorkloadID: workload.ID}) {
			return
		}
		if _, exists := workloadIDs[workload.ID]; exists {
			collector.addError("SEMANTIC_DUPLICATE_WORKLOAD_ID", "Workload IDs must be unique.", SourceReference{Document: document, Path: path + ".id", WorkloadID: workload.ID})
		}
		workloadIDs[workload.ID] = workloadIndex
		if _, exists := owners[workload.OwningNodeID]; exists {
			collector.addError("SEMANTIC_DUPLICATE_WORKLOAD_OWNER", "Only one workload may own one architecture node.", SourceReference{Document: document, Path: path + ".owningNodeId", WorkloadID: workload.ID})
		}
		owners[workload.OwningNodeID] = workloadIndex
		if _, exists := nodes[workload.OwningNodeID]; !exists {
			collector.addError("SEMANTIC_WORKLOAD_OWNER_MISSING", "Workload owner references a node that does not exist.", SourceReference{Document: document, Path: path + ".owningNodeId", WorkloadID: workload.ID})
		}
		operationIDs := make(map[string]struct{})
		for operationIndex, operation := range workload.Operations {
			totalOperations++
			source := SourceReference{Document: document, Path: fmt.Sprintf("%s.operations[%d].id", path, operationIndex), WorkloadID: workload.ID, OperationID: operation.ID}
			if _, exists := operationIDs[operation.ID]; exists {
				collector.addError("SEMANTIC_DUPLICATE_WORKLOAD_OPERATION_ID", "Workload operation IDs must be unique.", source)
			}
			if related, exists := globalOperationIDs[operation.ID]; exists {
				collector.add(Diagnostic{Code: "SEMANTIC_DUPLICATE_WORKLOAD_OPERATION_ID", Severity: SeverityError, Message: "Workload operation IDs must be unique across the document.", Source: source, Related: []SourceReference{related}})
			} else {
				globalOperationIDs[operation.ID] = source
			}
			operationIDs[operation.ID] = struct{}{}
		}
		validateWorkloadBindings(workload, path, document, operationIDs, edges, globalTriggerIDs, globalActionIDs, globalEnvironmentIDs, collector)
		validateAdditionalWorkloadSemantics(workload, path, document, nodes, architecture, collector)
		for index, requirementID := range workload.UnresolvedRequirementIDs {
			if _, exists := requirements[requirementID]; !exists {
				collector.addError("SEMANTIC_WORKLOAD_REQUIREMENT_MISSING", "Workload references an unresolved architecture requirement that does not exist.", SourceReference{Document: document, Path: fmt.Sprintf("%s.unresolvedRequirementIds[%d]", path, index), WorkloadID: workload.ID})
			}
		}
		validateExtendedWorkloadReferences(workload, path, document, operationIDs, edges, requirements, collector)
	}
	if totalOperations > request.Limits.MaxOperations {
		collector.addError("LIMIT_OPERATION_COUNT_EXCEEDED", "Workload Document exceeds the configured operation limit.", SourceReference{Document: document, Path: "$.workloads"})
	}
}

func validateWorkloadBindings(workload workloadWire, path string, document DocumentKind, operationIDs map[string]struct{}, edges map[string]edgeWire, triggerIDs map[string]SourceReference, actionIDs map[string]SourceReference, environmentIDs map[string]SourceReference, collector *diagnosticCollector) {
	triggerEdges := make(map[string]struct{})
	for index, trigger := range workload.Triggers {
		source := SourceReference{Document: document, Path: fmt.Sprintf("%s.triggers[%d]", path, index), WorkloadID: workload.ID}
		checkGlobalBindingID("SEMANTIC_DUPLICATE_WORKLOAD_TRIGGER_ID", trigger.ID, source, triggerIDs, collector)
		edge, exists := edges[trigger.EdgeID]
		if !exists {
			collector.addError("SEMANTIC_WORKLOAD_TRIGGER_EDGE_MISSING", "Workload trigger references an edge that does not exist.", source)
		} else if edge.Semantic.Target.NodeID != workload.OwningNodeID {
			collector.addError("SEMANTIC_WORKLOAD_TRIGGER_EDGE_OWNERSHIP", "Workload trigger edge must target the owning node.", source)
		}
		if _, exists := operationIDs[trigger.TargetOperationID]; !exists {
			collector.addError("SEMANTIC_WORKLOAD_TRIGGER_OPERATION_MISSING", "Workload trigger references an operation that does not exist in its workload.", source)
		}
		if _, duplicate := triggerEdges[trigger.EdgeID]; duplicate {
			collector.addError("SEMANTIC_DUPLICATE_WORKLOAD_TRIGGER_EDGE", "A trigger edge may be bound only once in a workload.", source)
		}
		triggerEdges[trigger.EdgeID] = struct{}{}
	}
	actionKeys := make(map[string]struct{})
	for index, action := range workload.DownstreamActions {
		source := SourceReference{Document: document, Path: fmt.Sprintf("%s.downstreamActions[%d]", path, index), WorkloadID: workload.ID}
		checkGlobalBindingID("SEMANTIC_DUPLICATE_WORKLOAD_ACTION_ID", action.ID, source, actionIDs, collector)
		edge, exists := edges[action.EdgeID]
		if !exists {
			collector.addError("SEMANTIC_WORKLOAD_ACTION_EDGE_MISSING", "Workload downstream action references an edge that does not exist.", source)
		} else if edge.Semantic.Source.NodeID != workload.OwningNodeID {
			collector.addError("SEMANTIC_WORKLOAD_ACTION_EDGE_OWNERSHIP", "Workload downstream edge must originate from the owning node.", source)
		}
		if _, exists := operationIDs[action.SourceOperationID]; !exists {
			collector.addError("SEMANTIC_WORKLOAD_ACTION_OPERATION_MISSING", "Workload downstream action references an operation that does not exist in its workload.", source)
		}
		key := action.EdgeID + "\x00" + action.SourceOperationID
		if _, duplicate := actionKeys[key]; duplicate {
			collector.addError("SEMANTIC_DUPLICATE_WORKLOAD_ACTION_EDGE", "A downstream edge and operation pair may be bound only once.", source)
		}
		actionKeys[key] = struct{}{}
	}
	environmentNames := make(map[string]struct{})
	for index, binding := range workload.Environment {
		source := SourceReference{Document: document, Path: fmt.Sprintf("%s.environment[%d]", path, index), WorkloadID: workload.ID}
		checkGlobalBindingID("SEMANTIC_DUPLICATE_WORKLOAD_ENVIRONMENT_ID", binding.ID, source, environmentIDs, collector)
		if _, duplicate := environmentNames[binding.Name]; duplicate {
			collector.addError("SEMANTIC_DUPLICATE_WORKLOAD_ENVIRONMENT_NAME", "Workload environment names must be unique.", source)
		}
		environmentNames[binding.Name] = struct{}{}
	}
	if workload.TriggerDispatch.Mode != "single" {
		if _, exists := operationIDs[workload.TriggerDispatch.DispatcherOperationID]; !exists {
			collector.addError("SEMANTIC_WORKLOAD_DISPATCH_OPERATION_MISSING", "Trigger dispatch references an operation that does not exist in its workload.", SourceReference{Document: document, Path: path + ".triggerDispatch.dispatcherOperationId", WorkloadID: workload.ID})
		}
	}
}

func validateExtendedWorkloadReferences(workload workloadWire, path string, document DocumentKind, operations map[string]struct{}, edges map[string]edgeWire, requirements map[string]struct{}, collector *diagnosticCollector) {
	checkOperation := func(operationID string, referencePath string) {
		if operationID == "" {
			return
		}
		if _, exists := operations[operationID]; !exists {
			collector.addError("SEMANTIC_WORKLOAD_OPERATION_REFERENCE_MISSING", "Workload binding references an operation that does not exist in its workload.", SourceReference{Document: document, Path: referencePath, WorkloadID: workload.ID, OperationID: operationID})
		}
	}
	checkEdge := func(edgeID string, referencePath string) {
		if edgeID == "" {
			return
		}
		if _, exists := edges[edgeID]; !exists {
			collector.addError("SEMANTIC_WORKLOAD_EDGE_REFERENCE_MISSING", "Workload binding references an edge that does not exist.", SourceReference{Document: document, Path: referencePath, WorkloadID: workload.ID})
		}
	}
	for index, binding := range workload.Entrypoints {
		checkOperation(binding.OperationID, fmt.Sprintf("%s.entrypoints[%d].operationId", path, index))
	}
	for index, binding := range workload.HTTPRoutes {
		checkOperation(binding.OperationID, fmt.Sprintf("%s.httpRoutes[%d].operationId", path, index))
		checkEdge(binding.TriggerEdgeID, fmt.Sprintf("%s.httpRoutes[%d].triggerEdgeId", path, index))
	}
	for index, binding := range workload.EventBindings {
		checkOperation(binding.OperationID, fmt.Sprintf("%s.eventBindings[%d].operationId", path, index))
		checkEdge(binding.EdgeID, fmt.Sprintf("%s.eventBindings[%d].edgeId", path, index))
	}
	for index, binding := range workload.Schedules {
		checkOperation(binding.OperationID, fmt.Sprintf("%s.schedules[%d].operationId", path, index))
		checkEdge(binding.TriggerEdgeID, fmt.Sprintf("%s.schedules[%d].triggerEdgeId", path, index))
	}
	for index, binding := range workload.DataBindings {
		checkOperation(binding.OperationID, fmt.Sprintf("%s.dataBindings[%d].operationId", path, index))
		checkEdge(binding.EdgeID, fmt.Sprintf("%s.dataBindings[%d].edgeId", path, index))
	}
	for index, binding := range workload.Authorization {
		for operationIndex, operationID := range binding.OperationIDs {
			checkOperation(operationID, fmt.Sprintf("%s.authorization[%d].operationIds[%d]", path, index, operationIndex))
		}
	}
	for index, binding := range workload.Idempotency {
		for operationIndex, operationID := range binding.OperationIDs {
			checkOperation(operationID, fmt.Sprintf("%s.idempotency[%d].operationIds[%d]", path, index, operationIndex))
		}
	}
	for index, health := range workload.Observability.HealthChecks {
		checkOperation(health.OperationID, fmt.Sprintf("%s.observability.healthChecks[%d].operationId", path, index))
	}
	for index, requirement := range workload.ImplementationRequirements {
		if requirement.ArchitectureRequirementID == "" {
			continue
		}
		if _, exists := requirements[requirement.ArchitectureRequirementID]; !exists {
			collector.addError("SEMANTIC_WORKLOAD_REQUIREMENT_MISSING", "Implementation requirement references an architecture requirement that does not exist.", SourceReference{Document: document, Path: fmt.Sprintf("%s.implementationRequirements[%d].architectureRequirementId", path, index), WorkloadID: workload.ID})
		}
	}
	if workload.Implementation.Mode == "ai-assisted-custom" && workload.Implementation.Extension != nil {
		matched := false
		for _, extension := range workload.Extensions {
			if extension.ExtensionID == workload.Implementation.Extension.ExtensionID && extension.Digest == workload.Implementation.Extension.Digest && extension.Ownership == workload.Implementation.Extension.Ownership {
				matched = true
				break
			}
		}
		if !matched {
			collector.addError("SEMANTIC_WORKLOAD_EXTENSION_MISMATCH", "AI-assisted implementation must reference an exact declared extension.", SourceReference{Document: document, Path: path + ".implementation.extension", WorkloadID: workload.ID})
		}
	}
}

func validateSolutionBinding(decoded *decodedRequest, hashes contentHashes, collector *diagnosticCollector) {
	if decoded.solution == nil {
		return
	}
	solution := decoded.solution
	checks := []struct {
		actual   string
		expected string
		path     string
		code     string
		message  string
	}{
		{solution.Architecture.ContentHash, hashes.ArchitectureContent, "$.architecture.contentHash", "SEMANTIC_SOLUTION_ARCHITECTURE_HASH_MISMATCH", "Solution Revision architecture content hash does not match the exact Architecture Document."},
		{solution.Architecture.DocumentHash, hashes.ArchitectureDocument, "$.architecture.documentHash", "SEMANTIC_SOLUTION_DOCUMENT_HASH_MISMATCH", "Solution Revision architecture document hash does not match the exact Architecture Document."},
		{solution.Architecture.VisualHash, hashes.ArchitectureVisual, "$.architecture.visualHash", "SEMANTIC_SOLUTION_VISUAL_HASH_MISMATCH", "Solution Revision visual hash does not match the exact Architecture Document."},
		{solution.Workload.ContentHash, hashes.Workload, "$.workload.contentHash", "SEMANTIC_SOLUTION_WORKLOAD_HASH_MISMATCH", "Solution Revision workload hash does not match the exact Workload Document."},
		{solution.Contracts.ContentHash, hashes.ApplicationContracts, "$.contracts.contentHash", "SEMANTIC_SOLUTION_CONTRACT_HASH_MISMATCH", "Solution Revision application-contract hash does not match the Architecture Document."},
		{solution.ExternalResources.ContentHash, hashes.ExternalResources, "$.externalResources.contentHash", "SEMANTIC_SOLUTION_EXTERNAL_HASH_MISMATCH", "Solution Revision external-resource hash does not match the Architecture Document."},
	}
	for _, check := range checks {
		if check.actual != check.expected {
			collector.addError(check.code, check.message, SourceReference{Document: DocumentSolutionRevision, Path: check.path})
		}
	}
	if solution.Architecture.RevisionID != decoded.architecture.Revision.RevisionID {
		collector.addError("SEMANTIC_SOLUTION_REVISION_MISMATCH", "Solution Revision architecture binding names a different immutable revision.", SourceReference{Document: DocumentSolutionRevision, Path: "$.architecture.revisionId"})
	}
	if solution.GenerationCoverage.SolutionRevisionID != solution.SolutionRevisionID {
		collector.addError("SEMANTIC_SOLUTION_COVERAGE_REVISION_MISMATCH", "Generation coverage must bind the same Solution Revision.", SourceReference{Document: DocumentSolutionRevision, Path: "$.generationCoverage.solutionRevisionId"})
	}
	workloads := make(map[string]struct{}, len(decoded.workload.Workloads))
	for _, workload := range decoded.workload.Workloads {
		workloads[workload.ID] = struct{}{}
	}
	coverage := make(map[string]struct{})
	for index, item := range solution.GenerationCoverage.Workloads {
		if _, exists := workloads[item.WorkloadID]; !exists {
			collector.addError("SEMANTIC_SOLUTION_COVERAGE_WORKLOAD_MISSING", "Generation coverage references a workload that does not exist.", SourceReference{Document: DocumentSolutionRevision, Path: fmt.Sprintf("$.generationCoverage.workloads[%d].workloadId", index), WorkloadID: item.WorkloadID})
		}
		if _, duplicate := coverage[item.WorkloadID]; duplicate {
			collector.addError("SEMANTIC_SOLUTION_COVERAGE_WORKLOAD_DUPLICATE", "Generation coverage workload IDs must be unique.", SourceReference{Document: DocumentSolutionRevision, Path: fmt.Sprintf("$.generationCoverage.workloads[%d].workloadId", index), WorkloadID: item.WorkloadID})
		}
		coverage[item.WorkloadID] = struct{}{}
	}
}

func checkGlobalBindingID(code string, id string, source SourceReference, seen map[string]SourceReference, collector *diagnosticCollector) {
	if related, exists := seen[id]; exists {
		collector.add(Diagnostic{Code: code, Severity: SeverityError, Message: "Workload binding IDs must be unique across the document.", Source: source, Related: []SourceReference{related}})
	} else {
		seen[id] = source
	}
}

func workloadDocument(request Request) DocumentKind {
	if len(request.Workload) > 0 {
		return DocumentWorkload
	}
	return DocumentArchitecture
}

func nodesFromSlice(nodes []nodeWire) map[string]struct{} {
	result := make(map[string]struct{}, len(nodes))
	for _, node := range nodes {
		result[node.ID] = struct{}{}
	}
	return result
}

func variablesFromSlice(variables []variableWire) map[string]struct{} {
	result := make(map[string]struct{}, len(variables))
	for _, variable := range variables {
		result[variable.ID] = struct{}{}
	}
	return result
}

func canceled(ctx context.Context, collector *diagnosticCollector, source SourceReference) bool {
	select {
	case <-ctx.Done():
		collector.addError("COMPILER_CANCELED", "Compiler normalization was canceled.", source)
		return true
	default:
		return false
	}
}
