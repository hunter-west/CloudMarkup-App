package compiler

import (
	"fmt"
	"sort"
)

func normalizeExternalResources(raw map[string]any, resources map[string]ResourceReference) []NormalizedExternalResource {
	document := objectValue(raw, "externalResources")
	values, _ := document["resources"].([]any)
	result := make([]NormalizedExternalResource, 0, len(values))
	for _, value := range values {
		record, _ := value.(map[string]any)
		lifecycle := objectValue(record, "lifecycle")
		behavior := objectValue(lifecycle, "behavior")
		normalized := NormalizedExternalResource{
			ID:                 stringValue(record, "id"),
			ResourceType:       stringValue(record, "resourceType"),
			OwnershipState:     stringValue(lifecycle, "ownershipState"),
			LifecycleAuthority: stringValue(lifecycle, "lifecycleAuthority"),
			Behavior: ExternalResourceBehavior{
				Create:          stringValue(behavior, "create"),
				Reference:       stringValue(behavior, "reference"),
				Import:          stringValue(behavior, "import"),
				DataSource:      stringValue(behavior, "dataSource"),
				ImportAddressID: stringValue(behavior, "importAddressId"),
			},
			ArchitectureNodes: []ResourceReference{},
			Targets:           []ExternalResourceTarget{},
			Addresses:         []ExternalResourceAddress{},
		}
		for _, nodeValue := range anySlice(record["architectureNodeIds"]) {
			nodeID, _ := nodeValue.(string)
			if reference, exists := resources[nodeID]; exists {
				normalized.ArchitectureNodes = append(normalized.ArchitectureNodes, reference)
			}
		}
		for _, targetValue := range anySlice(lifecycle["iacTargets"]) {
			target, _ := targetValue.(map[string]any)
			normalized.Targets = append(normalized.Targets, ExternalResourceTarget{
				Target:         TargetKind(stringValue(target, "target")),
				Readiness:      stringValue(target, "readiness"),
				MappingID:      stringValue(target, "mappingId"),
				MappingVersion: stringValue(target, "mappingVersion"),
			})
		}
		for _, addressValue := range anySlice(record["addresses"]) {
			address, _ := addressValue.(map[string]any)
			value := stringValue(address, "value")
			if value == "" && stringValue(address, "kind") == "network-endpoint" {
				value = fmt.Sprintf("%s:%d", stringValue(address, "host"), intValue(address, "port"))
			}
			if value == "" && stringValue(address, "kind") == "repository-dependency" {
				value = stringValue(address, "packageReference")
			}
			normalized.Addresses = append(normalized.Addresses, ExternalResourceAddress{
				ID: stringValue(address, "addressId"), Kind: stringValue(address, "kind"), Value: value,
			})
		}
		sort.Slice(normalized.ArchitectureNodes, func(left int, right int) bool {
			return compareUTF16(normalized.ArchitectureNodes[left].TargetKey, normalized.ArchitectureNodes[right].TargetKey) < 0
		})
		sort.Slice(normalized.Targets, func(left int, right int) bool {
			return compareUTF16(string(normalized.Targets[left].Target), string(normalized.Targets[right].Target)) < 0
		})
		sort.Slice(normalized.Addresses, func(left int, right int) bool {
			return compareUTF16(normalized.Addresses[left].ID, normalized.Addresses[right].ID) < 0
		})
		result = append(result, normalized)
	}
	sort.Slice(result, func(left int, right int) bool {
		return compareUTF16(result[left].ID, result[right].ID) < 0
	})
	return result
}

func anySlice(value any) []any {
	values, _ := value.([]any)
	return values
}
