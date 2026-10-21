package compiler

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
)

func Normalize(ctx context.Context, request Request) Result {
	request.Limits = normalizeLimits(request.Limits)
	if request.Target == "" {
		request.Target = TargetTerraform
	}
	collector := newDiagnosticCollector(request.Limits.MaxDiagnostics)
	decoded, ok := decodeRequest(ctx, request, collector)
	if !ok {
		return resultWithSortedDiagnostics(nil, collector.diagnostics())
	}

	hashes, err := computeContentHashes(decoded.architectureRaw)
	if err != nil {
		collector.addError("COMPILER_CANONICALIZATION_FAILED", "Versioned compiler input could not be canonically hashed.", SourceReference{Document: DocumentArchitecture})
		return resultWithSortedDiagnostics(nil, collector.diagnostics())
	}
	validateCompatibility(request, decoded, collector)
	validateSemantics(ctx, request, decoded, hashes, collector)

	model, err := buildNormalizedModel(ctx, request, decoded, hashes)
	if err != nil {
		if ctx.Err() != nil {
			collector.addError("COMPILER_CANCELED", "Compiler normalization was canceled.", SourceReference{Document: DocumentArchitecture})
		} else {
			collector.addError("COMPILER_NORMALIZATION_FAILED", "Compiler input could not be normalized.", SourceReference{Document: DocumentArchitecture})
		}
		return resultWithSortedDiagnostics(nil, collector.diagnostics())
	}

	target, targetOK := targetFor(request.Target)
	if !targetOK {
		reason := "COMPAT_TARGET_UNSUPPORTED"
		if request.Target == TargetCloudFormation {
			reason = "COMPAT_TARGET_NOT_IMPLEMENTED"
		}
		model.Target = TargetReadiness{
			Target: request.Target, ContractVersion: "", State: "unsupported",
			RenderingAvailable: false, Reasons: []string{reason},
		}
	} else if collector.hasErrors() {
		descriptor := target.Descriptor()
		model.Target = TargetReadiness{
			Target: descriptor.Kind, ContractVersion: descriptor.ContractVersion, State: "invalid",
			RenderingAvailable: false, Reasons: []string{"TARGET_INPUT_INVALID"},
		}
	} else if ctx.Err() != nil {
		collector.addError("COMPILER_CANCELED", "Compiler normalization was canceled.", SourceReference{Document: DocumentArchitecture})
		descriptor := target.Descriptor()
		model.Target = TargetReadiness{
			Target: descriptor.Kind, ContractVersion: descriptor.ContractVersion, State: "canceled",
			RenderingAvailable: false, Reasons: []string{"COMPILER_CANCELED"},
		}
	} else {
		model.Target = target.Assess(ctx, model)
	}
	encoded, err := json.Marshal(model)
	if err != nil || len(encoded) > request.Limits.MaxNormalizedBytes {
		collector.addError("LIMIT_NORMALIZED_OUTPUT_EXCEEDED", "Normalized compiler model exceeds the configured output limit.", SourceReference{Document: DocumentArchitecture})
		model = nil
	}
	return resultWithSortedDiagnostics(model, collector.diagnostics())
}

func resultWithSortedDiagnostics(model *NormalizedSolution, diagnostics []Diagnostic) Result {
	sort.SliceStable(diagnostics, func(left int, right int) bool {
		leftKey := diagnosticKey(diagnostics[left])
		rightKey := diagnosticKey(diagnostics[right])
		return compareUTF16(leftKey, rightKey) < 0
	})
	result := baseResult(diagnostics)
	result.Model = model
	return result
}

func diagnosticKey(diagnostic Diagnostic) string {
	return strings.Join([]string{
		string(diagnostic.Severity), diagnostic.Code, string(diagnostic.Source.Document),
		diagnostic.Source.Path, diagnostic.Source.NodeID, diagnostic.Source.EdgeID,
		diagnostic.Source.WorkloadID, diagnostic.Source.OperationID,
	}, "\x00")
}

func buildNormalizedModel(ctx context.Context, request Request, decoded *decodedRequest, hashes contentHashes) (*NormalizedSolution, error) {
	architecture := decoded.architecture
	targetKeys := assignStableTargetKeys(architecture.Nodes)
	resources := make([]NormalizedResource, 0, len(architecture.Nodes))
	resourceIndex := make(map[string]ResourceReference, len(architecture.Nodes))
	workloadsByNode := make(map[string][]string)
	for _, workload := range decoded.workload.Workloads {
		workloadsByNode[workload.OwningNodeID] = append(workloadsByNode[workload.OwningNodeID], workload.ID)
	}
	for _, workloadIDs := range workloadsByNode {
		sort.Slice(workloadIDs, func(left int, right int) bool { return compareUTF16(workloadIDs[left], workloadIDs[right]) < 0 })
	}

	for _, node := range architecture.Nodes {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		targetKey := targetKeys[node.ID]
		reference := ResourceReference{NodeID: node.ID, TargetKey: targetKey}
		resourceIndex[node.ID] = reference
		resource := NormalizedResource{
			ID: node.ID, TargetKey: targetKey, DeploymentKey: node.Semantic.DeploymentKey,
			ServiceType: node.Semantic.ServiceType, ResourceType: node.Semantic.ResourceType,
			Configuration: normalizeConfiguration(node.Semantic.Configuration),
			Lifecycle:     normalizeLifecycle(node.Semantic.Lifecycle),
			WorkloadIDs:   append([]string{}, workloadsByNode[node.ID]...),
		}
		if node.Semantic.Parent != nil {
			parent := resourceIndex[node.Semantic.Parent.NodeID]
			if parent.NodeID == "" {
				parent = ResourceReference{NodeID: node.Semantic.Parent.NodeID, TargetKey: targetKeys[node.Semantic.Parent.NodeID]}
			}
			parent.RelationshipType = node.Semantic.Parent.RelationshipType
			resource.Parent = &parent
		}
		resources = append(resources, resource)
	}
	sort.Slice(resources, func(left int, right int) bool {
		return compareUTF16(resources[left].TargetKey+"\x00"+resources[left].ID, resources[right].TargetKey+"\x00"+resources[right].ID) < 0
	})

	connections := make([]NormalizedConnection, 0, len(architecture.Edges))
	connectionByID := make(map[string]NormalizedConnection, len(architecture.Edges))
	for _, edge := range architecture.Edges {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		source := resourceIndex[edge.Semantic.Source.NodeID]
		source.Port = edge.Semantic.Source.Port
		target := resourceIndex[edge.Semantic.Target.NodeID]
		target.Port = edge.Semantic.Target.Port
		connection := NormalizedConnection{
			ID: edge.ID, Source: source, Target: target,
			RelationshipType: edge.Semantic.RelationshipType,
			Configuration:    normalizeConfiguration(edge.Semantic.Configuration),
			Lifecycle:        normalizeLifecycle(edge.Semantic.Lifecycle),
		}
		connections = append(connections, connection)
		connectionByID[connection.ID] = connection
	}
	sort.Slice(connections, func(left int, right int) bool {
		leftKey := connectionSortKey(connections[left])
		rightKey := connectionSortKey(connections[right])
		return compareUTF16(leftKey, rightKey) < 0
	})

	policies := normalizePolicyAttachments(resources, connections, policyResourceTypesFor(request.Compatibility, architecture.Catalog))
	workloads, err := normalizeWorkloads(ctx, decoded, resourceIndex, connectionByID)
	if err != nil {
		return nil, err
	}
	externalResources := normalizeExternalResources(decoded.architectureRaw, resourceIndex)
	variables := normalizeVariables(architecture.Variables)
	outputs := normalizeOutputs(architecture.Outputs, resourceIndex)

	provenance := SolutionProvenance{
		ArchitectureDocumentID:   architecture.DocumentID,
		ArchitectureID:           architecture.ArchitectureID,
		ArchitectureRevisionID:   architecture.Revision.RevisionID,
		ArchitectureContentHash:  hashes.ArchitectureContent,
		ArchitectureDocumentHash: hashes.ArchitectureDocument,
		ArchitectureVisualHash:   hashes.ArchitectureVisual,
		WorkloadContentHash:      hashes.Workload,
		ProviderID:               architecture.Provider.ID,
		Region:                   architecture.Provider.Region,
		Catalog:                  architecture.Catalog,
	}
	if decoded.solution != nil {
		provenance.SolutionRevisionID = decoded.solution.SolutionRevisionID
	}

	return &NormalizedSolution{
		ContractVersion:   NormalizedModelContractVersion,
		Target:            TargetReadiness{Target: request.Target, State: "pending-assessment", RenderingAvailable: false, Reasons: []string{}},
		Provenance:        provenance,
		Resources:         resources,
		Connections:       connections,
		PolicyAttachments: policies,
		Variables:         variables,
		Outputs:           outputs,
		Workloads:         workloads,
		ExternalResources: externalResources,
	}, nil
}

func assignStableTargetKeys(nodes []nodeWire) map[string]string {
	groups := make(map[string][]nodeWire)
	for _, node := range nodes {
		base := node.Semantic.DeploymentKey
		if base == "" {
			base = stableKeyFromNodeID(node.ID)
		}
		groups[base] = append(groups[base], node)
	}
	result := make(map[string]string, len(nodes))
	for base, group := range groups {
		sort.Slice(group, func(left int, right int) bool { return compareUTF16(group[left].ID, group[right].ID) < 0 })
		if len(group) == 1 {
			result[group[0].ID] = base
			continue
		}
		used := make(map[string]struct{})
		for index, node := range group {
			suffixDigest := sha256.Sum256([]byte(node.ID))
			suffix := hex.EncodeToString(suffixDigest[:])[:10]
			prefix := base
			if len(prefix) > 52 {
				prefix = prefix[:52]
			}
			candidate := prefix + "_" + suffix
			if _, exists := used[candidate]; exists {
				candidate = fmt.Sprintf("%s_%02d", prefix[:minInt(len(prefix), 49)], index)
			}
			used[candidate] = struct{}{}
			result[node.ID] = candidate
		}
	}
	return result
}

func stableKeyFromNodeID(nodeID string) string {
	var builder strings.Builder
	for _, character := range strings.ToLower(nodeID) {
		if (character >= 'a' && character <= 'z') || (character >= '0' && character <= '9') || character == '_' {
			builder.WriteRune(character)
		} else {
			builder.WriteByte('_')
		}
	}
	value := strings.Trim(builder.String(), "_")
	if value == "" || value[0] < 'a' || value[0] > 'z' {
		value = "r_" + value
	}
	if len(value) > 63 {
		value = value[:63]
	}
	return value
}

func normalizeConfiguration(configuration configurationWire) Configuration {
	values := make(map[string]ConfigurationValue, len(configuration.Values))
	for key, value := range configuration.Values {
		values[key] = ConfigurationValue{
			Kind: value.Kind, Value: value.Value, NodeID: value.NodeID,
			Attribute: value.Attribute, VariableID: value.VariableID, Reference: value.Reference,
		}
	}
	return Configuration{SchemaID: configuration.SchemaID, SchemaVersion: configuration.SchemaVersion, Values: values}
}

func normalizeLifecycle(lifecycle lifecycleWire) Lifecycle {
	result := Lifecycle{Ownership: lifecycle.Ownership, Origin: lifecycle.Origin, AdoptedBy: lifecycle.AdoptedBy}
	if lifecycle.Provenance != nil {
		nodes := append([]string{}, lifecycle.Provenance.DependentNodeIDs...)
		edges := append([]string{}, lifecycle.Provenance.DependentEdgeIDs...)
		sort.Slice(nodes, func(left int, right int) bool { return compareUTF16(nodes[left], nodes[right]) < 0 })
		sort.Slice(edges, func(left int, right int) bool { return compareUTF16(edges[left], edges[right]) < 0 })
		result.Provenance = &GeneratedProvenance{
			GeneratorKind:    lifecycle.Provenance.GeneratorKind,
			GeneratorID:      lifecycle.Provenance.GeneratorID,
			GeneratorVersion: lifecycle.Provenance.GeneratorVersion,
			OperationID:      lifecycle.Provenance.OperationID,
			DependentNodeIDs: nodes, DependentEdgeIDs: edges,
		}
	}
	return result
}

func connectionSortKey(connection NormalizedConnection) string {
	return strings.Join([]string{connection.Source.TargetKey, connection.Source.Port, connection.Target.TargetKey, connection.Target.Port, connection.RelationshipType, connection.ID}, "\x00")
}

func normalizePolicyAttachments(resources []NormalizedResource, connections []NormalizedConnection, policyResourceTypes map[string]struct{}) []PolicyAttachment {
	owners := make(map[string][]ResourceReference)
	for _, connection := range connections {
		if _, policy := policyResourceTypes[resourceTypeFor(resources, connection.Source.NodeID)]; policy {
			owners[connection.Source.NodeID] = append(owners[connection.Source.NodeID], connection.Target)
		}
		if _, policy := policyResourceTypes[resourceTypeFor(resources, connection.Target.NodeID)]; policy {
			owners[connection.Target.NodeID] = append(owners[connection.Target.NodeID], connection.Source)
		}
	}
	result := make([]PolicyAttachment, 0)
	for _, resource := range resources {
		if _, policy := policyResourceTypes[resource.ResourceType]; !policy {
			continue
		}
		references := owners[resource.ID]
		sort.Slice(references, func(left int, right int) bool {
			return compareUTF16(references[left].TargetKey+"\x00"+references[left].Port, references[right].TargetKey+"\x00"+references[right].Port) < 0
		})
		result = append(result, PolicyAttachment{
			ResourceID: resource.ID, TargetKey: resource.TargetKey, ResourceType: resource.ResourceType,
			Ownership: resource.Lifecycle.Ownership, OwnerReferences: references,
			Configuration: resource.Configuration, Provenance: resource.Lifecycle.Provenance,
		})
	}
	sort.Slice(result, func(left int, right int) bool {
		return compareUTF16(result[left].TargetKey, result[right].TargetKey) < 0
	})
	return result
}

func policyResourceTypesFor(registry CompatibilityRegistry, catalog CatalogReference) map[string]struct{} {
	if len(registry.Catalogs) == 0 {
		registry = DefaultCompatibilityRegistry()
	}
	result := make(map[string]struct{})
	for _, compatibility := range registry.Catalogs {
		if compatibility.ID != catalog.ID || compatibility.Version != catalog.Version || compatibility.Digest != catalog.Digest {
			continue
		}
		for _, resourceType := range compatibility.PolicyResourceTypes {
			result[resourceType] = struct{}{}
		}
	}
	return result
}

func resourceTypeFor(resources []NormalizedResource, nodeID string) string {
	for _, resource := range resources {
		if resource.ID == nodeID {
			return resource.ResourceType
		}
	}
	return ""
}

func normalizeWorkloads(ctx context.Context, decoded *decodedRequest, resources map[string]ResourceReference, connections map[string]NormalizedConnection) ([]NormalizedWorkload, error) {
	specifications := normalizedWorkloadSpecifications(decoded.workloadRaw)
	coverage := solutionCoverageByWorkload(decoded.solution)
	result := make([]NormalizedWorkload, 0, len(decoded.workload.Workloads))
	for _, workload := range decoded.workload.Workloads {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		operations := make([]OperationBinding, 0, len(workload.Operations))
		for _, operation := range workload.Operations {
			operations = append(operations, OperationBinding{
				ID: operation.ID, Capability: operation.Capability,
				InputContract:  normalizeContractReference(operation.InputContract),
				OutputContract: normalizeContractReference(operation.OutputContract),
			})
		}
		sort.Slice(operations, func(left int, right int) bool { return compareUTF16(operations[left].ID, operations[right].ID) < 0 })

		triggers := make([]TriggerBinding, 0, len(workload.Triggers))
		for _, trigger := range workload.Triggers {
			connection := connections[trigger.EdgeID]
			triggers = append(triggers, TriggerBinding{ID: trigger.ID, Kind: "trigger", EdgeID: trigger.EdgeID, OperationID: trigger.TargetOperationID, Connection: optionalConnection(connection)})
		}
		actions := make([]TriggerBinding, 0, len(workload.DownstreamActions))
		for _, action := range workload.DownstreamActions {
			connection := connections[action.EdgeID]
			actions = append(actions, TriggerBinding{ID: action.ID, Kind: "downstream-action", EdgeID: action.EdgeID, OperationID: action.SourceOperationID, Connection: optionalConnection(connection)})
		}
		sort.Slice(triggers, func(left int, right int) bool { return compareUTF16(triggers[left].ID, triggers[right].ID) < 0 })
		sort.Slice(actions, func(left int, right int) bool { return compareUTF16(actions[left].ID, actions[right].ID) < 0 })

		environment := make([]EnvironmentBinding, 0, len(workload.Environment))
		for _, binding := range workload.Environment {
			normalized := EnvironmentBinding{ID: binding.ID, Name: binding.Name, Kind: binding.Value.Kind, VariableID: binding.Value.VariableID, SecretReference: binding.Value.Reference}
			if binding.Value.NodeID != "" {
				reference := resources[binding.Value.NodeID]
				reference.Attribute = binding.Value.Attribute
				normalized.Resource = &reference
			}
			environment = append(environment, normalized)
		}
		sort.Slice(environment, func(left int, right int) bool { return compareUTF16(environment[left].ID, environment[right].ID) < 0 })

		artifactInputs := normalizeArtifactInputs(workload)
		ownership := make([]SourceOwnership, 0, len(workload.SourceOwnership))
		for _, declaration := range workload.SourceOwnership {
			ownership = append(ownership, SourceOwnership{
				DeclarationID: declaration.DeclarationID, Path: declaration.Path, PathKind: declaration.PathKind,
				Ownership: declaration.Ownership, OwnerID: declaration.OwnerID, Regeneration: declaration.Regeneration,
				ConflictBehavior: declaration.ConflictBehavior, SemanticDiff: declaration.SemanticDiff.Strategy,
				NormalizerID: declaration.SemanticDiff.NormalizerID, NormalizerVersion: declaration.SemanticDiff.NormalizerVersion,
				BaselineDigest: declaration.BaselineDigest, ExtensionPointID: declaration.ExtensionPointID,
			})
		}
		sort.Slice(ownership, func(left int, right int) bool {
			return compareUTF16(ownership[left].DeclarationID, ownership[right].DeclarationID) < 0
		})
		extensionPoints := make([]ExtensionPoint, 0, len(workload.ExtensionPoints))
		for _, point := range workload.ExtensionPoints {
			permitted := append([]string(nil), point.PermittedOwnership...)
			sort.Slice(permitted, func(left int, right int) bool { return compareUTF16(permitted[left], permitted[right]) < 0 })
			extensionPoints = append(extensionPoints, ExtensionPoint{ID: point.ExtensionPointID, Path: point.Path, Kind: point.Kind, PermittedOwnership: permitted, ConflictBehavior: point.ConflictBehavior})
		}
		sort.Slice(extensionPoints, func(left int, right int) bool {
			return compareUTF16(extensionPoints[left].ID, extensionPoints[right].ID) < 0
		})

		coverageRecord, hasCoverage := coverage[workload.ID]
		coverageState := coverageRecord.State
		if coverageState == "" {
			coverageState = conservativeCoverage(workload.Implementation.Mode)
		}
		readiness := generatorReadiness(decoded, workload)
		targetReadiness := generatedArtifactTargetReadiness(decoded.architecture.Catalog, workload, coverageRecord, hasCoverage, readiness)
		result = append(result, NormalizedWorkload{
			ID: workload.ID, OwningResource: resources[workload.OwningNodeID],
			ImplementationMode: workload.Implementation.Mode,
			RuntimeFamily:      workload.Implementation.RuntimeFamily, LanguageFamily: workload.LanguageFamily,
			Handler: workload.Implementation.Handler, SourceOwner: workload.Implementation.SourceOwnership,
			Operations: operations, Triggers: triggers, DownstreamActions: actions,
			Environment: environment, ArtifactInputs: artifactInputs, ArtifactOutputs: []ArtifactReference{},
			SourceOwnership: ownership, ExtensionPoints: extensionPoints,
			GenerationCoverage: coverageState, TargetReadiness: targetReadiness,
			GeneratorReadiness: readiness,
			Specification:      specifications[workload.ID],
		})
	}
	sort.Slice(result, func(left int, right int) bool { return compareUTF16(result[left].ID, result[right].ID) < 0 })
	return result, nil
}

func normalizedWorkloadSpecifications(raw map[string]any) map[string]json.RawMessage {
	normalized := normalizeWorkloadMap(cloneMap(raw))
	result := make(map[string]json.RawMessage)
	values, _ := normalized["workloads"].([]any)
	for _, value := range values {
		workload, _ := value.(map[string]any)
		contents, err := serializeCanonical(workload)
		if err == nil {
			result[stringValue(workload, "id")] = json.RawMessage(contents)
		}
	}
	return result
}

func normalizeContractReference(contract workloadIOContractWire) *ContractReference {
	if contract.Kind != "contract-reference" || contract.Reference == nil {
		return nil
	}
	return &ContractReference{ContractID: contract.Reference.ContractID, ContractVersion: contract.Reference.ContractVersion, Digest: contract.Reference.Digest, ContractKind: contract.Reference.ContractKind}
}

func optionalConnection(connection NormalizedConnection) *NormalizedConnection {
	if connection.ID == "" {
		return nil
	}
	copy := connection
	return &copy
}

func normalizeArtifactInputs(workload workloadWire) []ArtifactReference {
	inputs := make([]ArtifactReference, 0, 2)
	if artifact := workload.Implementation.Artifact; artifact != nil {
		inputs = append(inputs, ArtifactReference{ArtifactID: artifact.ArtifactID, Digest: artifact.Digest, Kind: "external-workload-artifact", Ownership: "external", WorkloadID: workload.ID})
	}
	if pattern := workload.Implementation.SupportedPattern; pattern != nil {
		inputs = append(inputs, ArtifactReference{ArtifactID: pattern.PatternID + ":" + pattern.PatternVersion, Digest: pattern.Digest, Kind: "supported-pattern", Ownership: "cloudmarkup", WorkloadID: workload.ID})
	}
	if extension := workload.Implementation.Extension; extension != nil {
		inputs = append(inputs, ArtifactReference{ArtifactID: extension.ExtensionID, Digest: extension.Digest, Kind: "ai-extension-reference", Ownership: extension.Ownership, WorkloadID: workload.ID})
	}
	sort.Slice(inputs, func(left int, right int) bool {
		return compareUTF16(inputs[left].Kind+"\x00"+inputs[left].ArtifactID, inputs[right].Kind+"\x00"+inputs[right].ArtifactID) < 0
	})
	return inputs
}

func solutionCoverageByWorkload(solution *solutionRevisionWire) map[string]solutionWorkloadCoverageWire {
	result := make(map[string]solutionWorkloadCoverageWire)
	if solution == nil {
		return result
	}
	for _, workload := range solution.GenerationCoverage.Workloads {
		result[workload.WorkloadID] = workload
	}
	return result
}

func conservativeCoverage(mode string) string {
	if mode == "infrastructure-only" {
		return "infrastructure-only"
	}
	return "custom-implementation-required"
}

func generatorReadiness(decoded *decodedRequest, workload workloadWire) GeneratorReadiness {
	if workload.Implementation.Mode != "generated-starter" && workload.Implementation.Mode != "complete-supported-pattern" {
		return GeneratorReadiness{State: "not-applicable", Reasons: []string{}}
	}
	if decoded.solution == nil || decoded.solution.Versions.ApplicationGenerator.State != "pinned" {
		return GeneratorReadiness{State: "not-selected", Reasons: []string{"APPLICATION_GENERATOR_NOT_PINNED"}}
	}
	tool := decoded.solution.Versions.ApplicationGenerator.Tool
	catalog := decoded.architecture.Catalog
	if generatorCompatibilityMatches(tool, catalog, workload) != 1 {
		return GeneratorReadiness{State: "incompatible", Generator: &tool, Reasons: []string{"COMPAT_WORKLOAD_GENERATOR_MISMATCH"}}
	}
	var selected workloadGeneratorCompatibilityWire
	for _, compatibility := range workload.Compatibility.ApplicationGenerators {
		if generatorCompatibilityDeclarationMatches(tool, catalog, workload, compatibility) {
			selected = compatibility
		}
	}
	return GeneratorReadiness{
		State: "compatible-interface-only", Generator: &tool,
		TemplateID: selected.TemplateID, TemplateVersion: selected.TemplateVersion,
		Reasons: []string{"APPLICATION_GENERATION_SEPARATE_BOUNDARY_AVAILABLE"},
	}
}

func minInt(left int, right int) int {
	if left < right {
		return left
	}
	return right
}
func generatedArtifactTargetReadiness(catalog CatalogReference, workload workloadWire, coverage solutionWorkloadCoverageWire, hasCoverage bool, readiness GeneratorReadiness) string {
	mode := workload.Implementation.Mode
	if mode != "generated-starter" && mode != "complete-supported-pattern" {
		return "normalized-reference-only"
	}
	if !hasCoverage || !reviewedTargetNeutralApplicationGeneratorReadiness(catalog, readiness) {
		return "application-artifact-evidence-incomplete"
	}
	expectedState := "starter-application"
	readyState := "application-starter-artifact-ready"
	if mode == "complete-supported-pattern" {
		expectedState = "complete-supported-pattern"
		readyState = "application-artifact-ready"
	}
	if coverage.State != expectedState {
		return "application-artifact-evidence-incomplete"
	}
	required := map[string]bool{
		"deterministic-application-generation": false,
		"application-build-and-tests":          false,
		"application-security-checks":          false,
	}
	for _, entry := range coverage.Evidence {
		if _, exists := required[entry.Requirement]; exists && entry.EvidenceID != "" {
			required[entry.Requirement] = true
		}
	}
	for requirement, present := range required {
		if !present || containsString(coverage.MissingRequirements, requirement) {
			return "application-artifact-evidence-incomplete"
		}
	}
	if mode == "complete-supported-pattern" &&
		(len(coverage.MissingRequirements) > 0 ||
			len(coverage.UnresolvedRequirementIDs) > 0 ||
			len(workload.UnresolvedRequirementIDs) > 0 ||
			len(workload.ImplementationRequirements) > 0) {
		return "application-artifact-evidence-incomplete"
	}
	return readyState
}

func reviewedEventApplicationGeneratorReadiness(readiness GeneratorReadiness) bool {
	return readiness.State == "compatible-interface-only" &&
		readiness.Generator != nil &&
		readiness.Generator.ID == EventApplicationGeneratorID &&
		readiness.Generator.Version == EventApplicationGeneratorVersion &&
		readiness.Generator.Digest == EventApplicationGeneratorDigest &&
		readiness.TemplateID == EventApplicationTemplateID &&
		readiness.TemplateVersion == EventApplicationTemplateVersion
}

func reviewedTargetNeutralApplicationGeneratorReadiness(catalog CatalogReference, readiness GeneratorReadiness) bool {
	if !isCurrentAwsCatalog(catalog) || readiness.State != "compatible-interface-only" || readiness.Generator == nil {
		return false
	}
	tuple, ok := reviewedGeneratorTuple(*readiness.Generator, catalog)
	return ok && readiness.TemplateID == tuple.TemplateID && readiness.TemplateVersion == tuple.TemplateVersion
}
