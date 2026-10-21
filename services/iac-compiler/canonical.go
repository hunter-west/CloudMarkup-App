package compiler

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"unicode/utf16"
)

type contentHashes struct {
	ArchitectureContent  string
	ArchitectureDocument string
	ArchitectureVisual   string
	Workload             string
	ApplicationContracts string
	ExternalResources    string
}

func computeContentHashes(architecture map[string]any) (contentHashes, error) {
	normalizedArchitecture := normalizeArchitectureMap(cloneMap(architecture))
	workload, _ := normalizedArchitecture["workloadBehavior"].(map[string]any)
	applicationContracts, _ := normalizedArchitecture["applicationContracts"].(map[string]any)
	externalResources, _ := normalizedArchitecture["externalResources"].(map[string]any)

	contentProjection := architectureContentProjection(cloneMap(normalizedArchitecture))
	visualProjection := map[string]any{
		"kind":          "cloudmarkup.architecture-visual-projection",
		"schemaVersion": float64(1),
		"nodes":         visualNodes(normalizedArchitecture),
	}

	architectureContent, err := hashCanonical(contentProjection)
	if err != nil {
		return contentHashes{}, err
	}
	architectureDocument, err := hashCanonical(normalizedArchitecture)
	if err != nil {
		return contentHashes{}, err
	}
	architectureVisual, err := hashCanonical(visualProjection)
	if err != nil {
		return contentHashes{}, err
	}
	workloadHash, err := hashCanonical(workload)
	if err != nil {
		return contentHashes{}, err
	}
	contractsHash, err := hashCanonical(applicationContracts)
	if err != nil {
		return contentHashes{}, err
	}
	externalHash, err := hashCanonical(externalResources)
	if err != nil {
		return contentHashes{}, err
	}

	return contentHashes{
		ArchitectureContent:  architectureContent,
		ArchitectureDocument: architectureDocument,
		ArchitectureVisual:   architectureVisual,
		Workload:             workloadHash,
		ApplicationContracts: contractsHash,
		ExternalResources:    externalHash,
	}, nil
}

func hashCanonical(value any) (string, error) {
	canonical, err := serializeCanonical(value)
	if err != nil {
		return "", err
	}
	digest := sha256.Sum256(canonical)
	return "sha256:" + hex.EncodeToString(digest[:]), nil
}

// serializeCanonical matches cloudmarkup.canonical-json.v1: object keys use
// JavaScript UTF-16 ordering, arrays retain caller-normalized order, two-space
// indentation is used, HTML characters are not escaped, and one trailing LF is
// included in the digest.
func serializeCanonical(value any) ([]byte, error) {
	var output bytes.Buffer
	if err := writeCanonical(&output, value, 0); err != nil {
		return nil, err
	}
	output.WriteByte('\n')
	return output.Bytes(), nil
}

func writeCanonical(output *bytes.Buffer, value any, depth int) error {
	switch typed := value.(type) {
	case nil:
		output.WriteString("null")
	case bool:
		if typed {
			output.WriteString("true")
		} else {
			output.WriteString("false")
		}
	case string:
		encoded, err := json.Marshal(typed)
		if err != nil {
			return err
		}
		text := string(encoded)
		text = strings.ReplaceAll(text, `\u003c`, "<")
		text = strings.ReplaceAll(text, `\u003e`, ">")
		text = strings.ReplaceAll(text, `\u0026`, "&")
		text = strings.ReplaceAll(text, `\u2028`, " ")
		text = strings.ReplaceAll(text, `\u2029`, " ")
		output.WriteString(text)
	case json.Number:
		parsed, err := strconv.ParseFloat(string(typed), 64)
		if err != nil {
			return fmt.Errorf("canonical number: %w", err)
		}
		return writeCanonical(output, parsed, depth)
	case float64:
		encoded, err := json.Marshal(typed)
		if err != nil {
			return fmt.Errorf("canonical number: %w", err)
		}
		output.Write(encoded)
	case []any:
		if len(typed) == 0 {
			output.WriteString("[]")
			return nil
		}
		output.WriteString("[\n")
		for index, item := range typed {
			writeIndent(output, depth+1)
			if err := writeCanonical(output, item, depth+1); err != nil {
				return err
			}
			if index < len(typed)-1 {
				output.WriteByte(',')
			}
			output.WriteByte('\n')
		}
		writeIndent(output, depth)
		output.WriteByte(']')
	case map[string]any:
		if len(typed) == 0 {
			output.WriteString("{}")
			return nil
		}
		keys := make([]string, 0, len(typed))
		for key := range typed {
			keys = append(keys, key)
		}
		sort.Slice(keys, func(left int, right int) bool {
			return compareUTF16(keys[left], keys[right]) < 0
		})
		output.WriteString("{\n")
		for index, key := range keys {
			writeIndent(output, depth+1)
			if err := writeCanonical(output, key, depth+1); err != nil {
				return err
			}
			output.WriteString(": ")
			if err := writeCanonical(output, typed[key], depth+1); err != nil {
				return err
			}
			if index < len(keys)-1 {
				output.WriteByte(',')
			}
			output.WriteByte('\n')
		}
		writeIndent(output, depth)
		output.WriteByte('}')
	default:
		return fmt.Errorf("unsupported canonical JSON value %T", value)
	}
	return nil
}

func writeIndent(output *bytes.Buffer, depth int) {
	output.WriteString(strings.Repeat("  ", depth))
}

func compareUTF16(left string, right string) int {
	leftUnits := utf16.Encode([]rune(left))
	rightUnits := utf16.Encode([]rune(right))
	length := len(leftUnits)
	if len(rightUnits) < length {
		length = len(rightUnits)
	}
	for index := 0; index < length; index++ {
		if leftUnits[index] < rightUnits[index] {
			return -1
		}
		if leftUnits[index] > rightUnits[index] {
			return 1
		}
	}
	if len(leftUnits) < len(rightUnits) {
		return -1
	}
	if len(leftUnits) > len(rightUnits) {
		return 1
	}
	return 0
}

func normalizeArchitectureMap(document map[string]any) map[string]any {
	sortObjectArray(document, "nodes", func(value map[string]any) string { return stringValue(value, "id") })
	forEachObject(document, "nodes", func(node map[string]any) {
		semantic := objectValue(node, "semantic")
		normalizeLifecycleMap(objectValue(semantic, "lifecycle"))
	})
	sortObjectArray(document, "edges", func(value map[string]any) string { return stringValue(value, "id") })
	forEachObject(document, "edges", func(edge map[string]any) {
		semantic := objectValue(edge, "semantic")
		normalizeLifecycleMap(objectValue(semantic, "lifecycle"))
	})
	for _, collection := range []string{"variables", "outputs", "assumptions", "unresolvedRequirements"} {
		sortObjectArray(document, collection, func(value map[string]any) string { return stringValue(value, "id") })
	}
	if workload, ok := document["workloadBehavior"].(map[string]any); ok {
		document["workloadBehavior"] = normalizeWorkloadMap(workload)
	}
	if contracts, ok := document["applicationContracts"].(map[string]any); ok {
		document["applicationContracts"] = normalizeApplicationContractsMap(contracts)
	}
	if external, ok := document["externalResources"].(map[string]any); ok {
		document["externalResources"] = normalizeExternalResourcesMap(external)
	}
	return document
}

func normalizeLifecycleMap(lifecycle map[string]any) {
	if stringValue(lifecycle, "ownership") == "user" {
		return
	}
	provenance := objectValue(lifecycle, "provenance")
	sortStringArray(provenance, "dependentNodeIds")
	sortStringArray(provenance, "dependentEdgeIds")
}

func normalizeWorkloadMap(behavior map[string]any) map[string]any {
	sortObjectArray(behavior, "workloads", func(value map[string]any) string { return stringValue(value, "id") })
	forEachObject(behavior, "workloads", normalizeWorkloadInPlace)
	return behavior
}

func normalizeWorkloadInPlace(workload map[string]any) {
	for _, collection := range []string{"operations", "triggers", "downstreamActions", "environment"} {
		sortObjectArray(workload, collection, func(value map[string]any) string { return stringValue(value, "id") })
	}
	sortObjectArray(workload, "behaviorContracts", contractReferenceKey)
	sortStringArray(workload, "unresolvedRequirementIds")
	collections := map[string]string{
		"entrypoints": "entrypointId", "httpRoutes": "routeId", "eventBindings": "bindingId",
		"schedules": "bindingId", "dataBindings": "bindingId", "authorization": "bindingId",
		"idempotency": "policyId", "tests": "bindingId", "sourceOwnership": "declarationId",
		"extensionPoints": "extensionPointId", "extensions": "extensionId",
		"implementationRequirements": "implementationRequirementId",
	}
	for collection, key := range collections {
		key := key
		sortObjectArray(workload, collection, func(value map[string]any) string { return stringValue(value, key) })
	}
	forEachObject(workload, "schedules", func(binding map[string]any) {
		schedule := objectValue(binding, "schedule")
		if stringValue(schedule, "kind") == "weekly" {
			sortStringArray(schedule, "days")
		}
	})
	forEachObject(workload, "authorization", func(binding map[string]any) {
		sortStringArray(binding, "operationIds")
		sortStringArray(binding, "permittedRoleIds")
	})
	forEachObject(workload, "idempotency", func(policy map[string]any) { sortStringArray(policy, "operationIds") })
	observability := objectValue(workload, "observability")
	sortStringArray(observability, "signals")
	sortObjectArray(observability, "healthChecks", func(value map[string]any) string { return stringValue(value, "healthCheckId") })
	sortObjectArray(observability, "smokeTests", contractReferenceKey)
	forEachObject(workload, "extensionPoints", func(point map[string]any) { sortStringArray(point, "permittedOwnership") })
	forEachObject(workload, "extensions", func(extension map[string]any) { sortStringArray(extension, "validationEvidenceIds") })
	forEachObject(workload, "implementationRequirements", func(requirement map[string]any) {
		sortObjectArray(requirement, "affectedContractReferences", contractReferenceKey)
	})
	compatibility := objectValue(workload, "compatibility")
	sortObjectArray(compatibility, "applicationGenerators", func(value map[string]any) string {
		return strings.Join([]string{stringValue(value, "generatorId"), stringValue(value, "minimumVersion"), stringValue(value, "templateId"), stringValue(value, "templateVersion")}, "\x00")
	})
	forEachObject(compatibility, "applicationGenerators", func(generator map[string]any) { sortStringArray(generator, "supportedModes") })
	sortObjectArray(compatibility, "modelGateways", func(value map[string]any) string {
		return strings.Join([]string{stringValue(value, "modelGatewayContractVersion"), stringValue(value, "modelFamily"), stringValue(value, "promptTemplateId"), stringValue(value, "promptVersion")}, "\x00")
	})
	forEachObject(compatibility, "modelGateways", func(gateway map[string]any) { sortStringArray(gateway, "requiredValidation") })
	implementation := objectValue(workload, "implementation")
	if stringValue(implementation, "mode") == "ai-assisted-custom" {
		sortStringArray(objectValue(implementation, "extension"), "validationEvidenceIds")
	}
}

func normalizeApplicationContractsMap(contracts map[string]any) map[string]any {
	sortObjectArray(contracts, "contracts", func(value map[string]any) string {
		return strings.Join([]string{stringValue(value, "contractId"), stringValue(value, "contractVersion"), stringValue(value, "contractKind")}, "\x00")
	})
	forEachObject(contracts, "contracts", func(contract map[string]any) {
		sortStringArray(objectValue(contract, "provenance"), "sourceReferenceIds")
		switch stringValue(contract, "contractKind") {
		case "http-api":
			request := objectValue(contract, "request")
			sortObjectArray(request, "parameters", func(value map[string]any) string {
				return stringValue(value, "location") + "\x00" + stringValue(value, "name")
			})
			sortObjectArray(contract, "responses", func(value map[string]any) string {
				return fmt.Sprintf("%03d\x00%s", intValue(value, "statusCode"), stringValue(value, "mediaType"))
			})
			forEachObject(contract, "responses", func(response map[string]any) {
				sortObjectArray(response, "headers", func(value map[string]any) string { return stringValue(value, "name") })
			})
		case "event-message":
			sortObjectArray(contract, "headers", func(value map[string]any) string { return stringValue(value, "name") })
		case "data-entity":
			sortObjectArray(contract, "fields", func(value map[string]any) string { return stringValue(value, "name") })
			sortObjectArray(contract, "indexes", func(value map[string]any) string { return stringValue(value, "indexId") })
			sortStringArray(contract, "supportedOperations")
		case "auth":
			sortObjectArray(contract, "claims", func(value map[string]any) string {
				return stringValue(value, "name") + "\x00" + stringValue(value, "source")
			})
			sortObjectArray(contract, "roles", func(value map[string]any) string { return stringValue(value, "roleId") })
			forEachObject(contract, "roles", func(role map[string]any) {
				sortObjectArray(role, "claimRequirements", func(value map[string]any) string {
					return strings.Join([]string{stringValue(value, "claimName"), stringValue(value, "match"), stringValue(value, "expectedValue")}, "\x00")
				})
			})
		case "behavior-operation":
			authorization := objectValue(contract, "authorization")
			sortStringArray(authorization, "permittedRoleIds")
			sortObjectArray(contract, "failureOutcomes", func(value map[string]any) string {
				return stringValue(value, "category") + "\x00" + stringValue(value, "description")
			})
		case "test-case":
			sortAnyArray(contract, "preconditions")
			sortObjectArray(contract, "fixtureReferences", func(value map[string]any) string {
				return stringValue(value, "fixtureId") + "\x00" + stringValue(value, "digest")
			})
			sortObjectArray(contract, "expectations", func(value map[string]any) string { return stringValue(value, "expectationId") })
		}
	})
	return contracts
}

func normalizeExternalResourcesMap(document map[string]any) map[string]any {
	sortObjectArray(document, "resources", func(value map[string]any) string { return stringValue(value, "id") })
	forEachObject(document, "resources", func(resource map[string]any) {
		sortStringArray(resource, "architectureNodeIds")
		for collection, key := range map[string]string{"addresses": "addressId", "interfaces": "interfaceId", "evidence": "evidenceId", "extractedCandidates": "candidateId", "unresolvedInformation": "unresolvedInformationId"} {
			key := key
			sortObjectArray(resource, collection, func(value map[string]any) string { return stringValue(value, key) })
		}
		lifecycle := objectValue(resource, "lifecycle")
		sortObjectArray(lifecycle, "iacTargets", func(value map[string]any) string { return stringValue(value, "target") })
		forEachObject(resource, "interfaces", func(resourceInterface map[string]any) {
			sortObjectArray(resourceInterface, "contracts", contractReferenceKey)
			sortStringArray(objectValue(resourceInterface, "authentication"), "secretReferences")
		})
		sortStringArray(resource, "dataClassifications")
	})
	return document
}

func architectureContentProjection(document map[string]any) map[string]any {
	revision := objectValue(document, "revision")
	delete(revision, "createdAt")
	forEachObject(document, "nodes", func(node map[string]any) {
		delete(node, "presentation")
		lifecycle := objectValue(objectValue(node, "semantic"), "lifecycle")
		if stringValue(lifecycle, "ownership") == "adopted" {
			delete(lifecycle, "adoptedAt")
		}
	})
	forEachObject(document, "edges", func(edge map[string]any) {
		lifecycle := objectValue(objectValue(edge, "semantic"), "lifecycle")
		if stringValue(lifecycle, "ownership") == "adopted" {
			delete(lifecycle, "adoptedAt")
		}
	})
	workload := objectValue(document, "workloadBehavior")
	forEachObject(workload, "workloads", func(item map[string]any) {
		provenance := objectValue(item, "provenance")
		delete(provenance, "recordedAt")
		delete(provenance, "acceptedAt")
	})
	contracts := objectValue(document, "applicationContracts")
	delete(objectValue(contracts, "revision"), "createdAt")
	forEachObject(contracts, "contracts", func(contract map[string]any) { delete(objectValue(contract, "provenance"), "recordedAt") })
	external := objectValue(document, "externalResources")
	delete(objectValue(external, "revision"), "createdAt")
	forEachObject(external, "resources", func(resource map[string]any) {
		forEachObject(resource, "evidence", func(evidence map[string]any) {
			for key := range evidence {
				if key != "evidenceId" && key != "source" && key != "digest" {
					delete(evidence, key)
				}
			}
		})
	})
	return document
}

func visualNodes(document map[string]any) []any {
	nodes, _ := document["nodes"].([]any)
	result := make([]any, 0, len(nodes))
	for _, value := range nodes {
		node, _ := value.(map[string]any)
		result = append(result, map[string]any{"id": node["id"], "presentation": node["presentation"]})
	}
	return result
}

func cloneMap(value map[string]any) map[string]any {
	encoded, _ := json.Marshal(value)
	decoder := json.NewDecoder(bytes.NewReader(encoded))
	decoder.UseNumber()
	var result map[string]any
	_ = decoder.Decode(&result)
	return result
}

func objectValue(parent map[string]any, key string) map[string]any {
	if parent == nil {
		return map[string]any{}
	}
	value, _ := parent[key].(map[string]any)
	return value
}

func stringValue(parent map[string]any, key string) string {
	value, _ := parent[key].(string)
	return value
}

func intValue(parent map[string]any, key string) int {
	switch value := parent[key].(type) {
	case json.Number:
		parsed, _ := strconv.Atoi(string(value))
		return parsed
	case float64:
		return int(value)
	default:
		return 0
	}
}

func sortObjectArray(parent map[string]any, key string, keyOf func(map[string]any) string) {
	values, ok := parent[key].([]any)
	if !ok {
		return
	}
	sort.SliceStable(values, func(left int, right int) bool {
		leftMap, _ := values[left].(map[string]any)
		rightMap, _ := values[right].(map[string]any)
		return compareUTF16(keyOf(leftMap), keyOf(rightMap)) < 0
	})
}

func sortStringArray(parent map[string]any, key string) {
	values, ok := parent[key].([]any)
	if !ok {
		return
	}
	sort.SliceStable(values, func(left int, right int) bool {
		leftValue, _ := values[left].(string)
		rightValue, _ := values[right].(string)
		return compareUTF16(leftValue, rightValue) < 0
	})
}

func sortAnyArray(parent map[string]any, key string) {
	values, ok := parent[key].([]any)
	if !ok {
		return
	}
	sort.SliceStable(values, func(left int, right int) bool {
		leftBytes, _ := serializeCanonical(values[left])
		rightBytes, _ := serializeCanonical(values[right])
		return bytes.Compare(leftBytes, rightBytes) < 0
	})
}

func forEachObject(parent map[string]any, key string, visit func(map[string]any)) {
	values, ok := parent[key].([]any)
	if !ok {
		return
	}
	for _, value := range values {
		if object, ok := value.(map[string]any); ok {
			visit(object)
		}
	}
}

func contractReferenceKey(value map[string]any) string {
	return strings.Join([]string{stringValue(value, "contractId"), stringValue(value, "contractVersion"), stringValue(value, "digest")}, "\x00")
}
