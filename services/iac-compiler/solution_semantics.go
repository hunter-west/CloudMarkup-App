package compiler

import "fmt"

func validateEmbeddedSolutionSemantics(decoded *decodedRequest, collector *diagnosticCollector) {
	architecture := decoded.architecture
	contracts := objectValue(decoded.architectureRaw, "applicationContracts")
	external := objectValue(decoded.architectureRaw, "externalResources")
	validateEmbeddedRevisionBinding(contracts, "applicationContracts", architecture, collector)
	validateEmbeddedRevisionBinding(external, "externalResources", architecture, collector)
	// Application Contracts v1 has its own stable contractSetId. Architecture v3
	// binds the embedded set through documentId and revision, not equality between
	// unrelated ID namespaces. Keep those exact checks above.
	if stringValue(external, "architectureId") != architecture.ArchitectureID {
		collector.addError("SEMANTIC_EXTERNAL_RESOURCE_ARCHITECTURE_MISMATCH", "External Resource Document binds a different architecture identity.", SourceReference{Document: DocumentArchitecture, Path: "$.externalResources.architectureId"})
	}

	validateIdentifiedCollection(decoded.architectureRaw, "assumptions", "SEMANTIC_DUPLICATE_ASSUMPTION_ID", collector)
	validateIdentifiedCollection(decoded.architectureRaw, "unresolvedRequirements", "SEMANTIC_DUPLICATE_REQUIREMENT_ID", collector)
	validateExternalResourceReferences(external, architecture, collector)
	validateApplicationContractReferences(decoded.architectureRaw, contracts, collector)
}

func validateEmbeddedRevisionBinding(document map[string]any, field string, architecture architectureWire, collector *diagnosticCollector) {
	if stringValue(document, "documentId") != architecture.DocumentID {
		collector.addError("SEMANTIC_EMBEDDED_DOCUMENT_ID_MISMATCH", "Embedded solution document binds a different Architecture Document identity.", SourceReference{Document: DocumentArchitecture, Path: "$." + field + ".documentId"})
	}
	revision := objectValue(document, "revision")
	if stringValue(revision, "revisionId") != architecture.Revision.RevisionID || intValue(revision, "revisionNumber") != architecture.Revision.RevisionNumber {
		collector.addError("SEMANTIC_EMBEDDED_REVISION_MISMATCH", "Embedded solution document binds a different immutable architecture revision.", SourceReference{Document: DocumentArchitecture, Path: "$." + field + ".revision"})
	}
}

func validateIdentifiedCollection(document map[string]any, field string, code string, collector *diagnosticCollector) {
	seen := make(map[string]int)
	values, _ := document[field].([]any)
	for index, value := range values {
		item, _ := value.(map[string]any)
		id := stringValue(item, "id")
		if first, exists := seen[id]; exists {
			collector.add(Diagnostic{
				Code: code, Severity: SeverityError, Message: "Stable identifiers must be unique within their collection.",
				Source:  SourceReference{Document: DocumentArchitecture, Path: fmt.Sprintf("$.%s[%d].id", field, index)},
				Related: []SourceReference{{Document: DocumentArchitecture, Path: fmt.Sprintf("$.%s[%d].id", field, first)}},
			})
		} else {
			seen[id] = index
		}
	}
}

func validateExternalResourceReferences(document map[string]any, architecture architectureWire, collector *diagnosticCollector) {
	nodes := nodesFromSlice(architecture.Nodes)
	seen := make(map[string]int)
	resources, _ := document["resources"].([]any)
	for resourceIndex, value := range resources {
		resource, _ := value.(map[string]any)
		id := stringValue(resource, "id")
		if first, exists := seen[id]; exists {
			collector.add(Diagnostic{
				Code: "SEMANTIC_DUPLICATE_EXTERNAL_RESOURCE_ID", Severity: SeverityError,
				Message: "External Resource IDs must be unique.",
				Source:  SourceReference{Document: DocumentArchitecture, Path: fmt.Sprintf("$.externalResources.resources[%d].id", resourceIndex)},
				Related: []SourceReference{{Document: DocumentArchitecture, Path: fmt.Sprintf("$.externalResources.resources[%d].id", first)}},
			})
		} else {
			seen[id] = resourceIndex
		}
		references, _ := resource["architectureNodeIds"].([]any)
		for referenceIndex, reference := range references {
			nodeID, _ := reference.(string)
			if _, exists := nodes[nodeID]; !exists {
				collector.addError("SEMANTIC_EXTERNAL_RESOURCE_NODE_MISSING", "External Resource references an architecture node that does not exist.", SourceReference{Document: DocumentArchitecture, Path: fmt.Sprintf("$.externalResources.resources[%d].architectureNodeIds[%d]", resourceIndex, referenceIndex), NodeID: nodeID})
			}
		}
	}
}

type indexedApplicationContract struct {
	kind   string
	digest string
	index  int
}

func validateApplicationContractReferences(architecture map[string]any, contractSet map[string]any, collector *diagnosticCollector) {
	contracts := make(map[string]indexedApplicationContract)
	values, _ := contractSet["contracts"].([]any)
	for index, value := range values {
		contract, _ := value.(map[string]any)
		identity := stringValue(contract, "contractId") + "@" + stringValue(contract, "contractVersion")
		if first, exists := contracts[identity]; exists {
			collector.add(Diagnostic{
				Code: "SEMANTIC_DUPLICATE_APPLICATION_CONTRACT", Severity: SeverityError,
				Message: "Application Contract ID and version pairs must be unique.",
				Source:  SourceReference{Document: DocumentArchitecture, Path: fmt.Sprintf("$.applicationContracts.contracts[%d]", index)},
				Related: []SourceReference{{Document: DocumentArchitecture, Path: fmt.Sprintf("$.applicationContracts.contracts[%d]", first.index)}},
			})
			continue
		}
		wrapper := map[string]any{"contracts": []any{cloneMap(contract)}}
		normalizeApplicationContractsMap(wrapper)
		normalized := wrapper["contracts"].([]any)[0]
		digest, err := hashCanonical(normalized)
		if err != nil {
			collector.addError("COMPILER_CANONICALIZATION_FAILED", "Application Contract could not be canonically hashed.", SourceReference{Document: DocumentArchitecture, Path: fmt.Sprintf("$.applicationContracts.contracts[%d]", index)})
			continue
		}
		contracts[identity] = indexedApplicationContract{kind: stringValue(contract, "contractKind"), digest: digest, index: index}
	}
	walkContractReferences(architecture, "$", func(reference map[string]any, path string) {
		identity := stringValue(reference, "contractId") + "@" + stringValue(reference, "contractVersion")
		contract, exists := contracts[identity]
		if !exists {
			collector.addError("SEMANTIC_APPLICATION_CONTRACT_REFERENCE_MISSING", "Application Contract reference does not resolve to the exact contract set.", SourceReference{Document: DocumentArchitecture, Path: path})
			return
		}
		if contract.kind != stringValue(reference, "contractKind") {
			collector.addError("SEMANTIC_APPLICATION_CONTRACT_KIND_MISMATCH", "Application Contract reference kind does not match its target contract.", SourceReference{Document: DocumentArchitecture, Path: path})
		}
		if contract.digest != stringValue(reference, "digest") {
			collector.addError("SEMANTIC_APPLICATION_CONTRACT_DIGEST_MISMATCH", "Application Contract reference digest does not match its target contract.", SourceReference{Document: DocumentArchitecture, Path: path})
		}
	})
}

func walkContractReferences(value any, path string, visit func(map[string]any, string)) {
	switch typed := value.(type) {
	case []any:
		for index, item := range typed {
			walkContractReferences(item, fmt.Sprintf("%s[%d]", path, index), visit)
		}
	case map[string]any:
		_, hasID := typed["contractId"].(string)
		_, hasVersion := typed["contractVersion"].(string)
		_, hasDigest := typed["digest"].(string)
		_, hasKind := typed["contractKind"].(string)
		if hasID && hasVersion && hasDigest && hasKind {
			visit(typed, path)
		}
		keys := make([]string, 0, len(typed))
		for key := range typed {
			keys = append(keys, key)
		}
		sortStringsUTF16(keys)
		for _, key := range keys {
			walkContractReferences(typed[key], path+"."+key, visit)
		}
	}
}

func sortStringsUTF16(values []string) {
	for index := 1; index < len(values); index++ {
		for current := index; current > 0 && compareUTF16(values[current], values[current-1]) < 0; current-- {
			values[current], values[current-1] = values[current-1], values[current]
		}
	}
}
