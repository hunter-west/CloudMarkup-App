package compiler

import "sort"

type NormalizedVariable struct {
	ID           string              `json:"id"`
	Key          string              `json:"key"`
	ValueType    string              `json:"valueType"`
	Required     bool                `json:"required"`
	DefaultValue *ConfigurationValue `json:"defaultValue,omitempty"`
}

type NormalizedOutput struct {
	ID         string             `json:"id"`
	Key        string             `json:"key"`
	Kind       string             `json:"kind"`
	Sensitive  bool               `json:"sensitive"`
	Resource   *ResourceReference `json:"resource,omitempty"`
	VariableID string             `json:"variableId,omitempty"`
}

func normalizeVariables(values []variableWire) []NormalizedVariable {
	result := make([]NormalizedVariable, 0, len(values))
	for _, value := range values {
		normalized := NormalizedVariable{ID: value.ID, Key: value.Key, ValueType: value.ValueType, Required: value.Required}
		if value.DefaultValue != nil {
			defaultValue := normalizeConfigurationValue(*value.DefaultValue)
			normalized.DefaultValue = &defaultValue
		}
		result = append(result, normalized)
	}
	sort.Slice(result, func(left int, right int) bool {
		return compareUTF16(result[left].Key+"\x00"+result[left].ID, result[right].Key+"\x00"+result[right].ID) < 0
	})
	return result
}

func normalizeOutputs(values []outputWire, resources map[string]ResourceReference) []NormalizedOutput {
	result := make([]NormalizedOutput, 0, len(values))
	for _, value := range values {
		normalized := NormalizedOutput{ID: value.ID, Key: value.Key, Kind: value.Source.Kind, Sensitive: value.Sensitive, VariableID: value.Source.VariableID}
		if value.Source.NodeID != "" {
			reference := resources[value.Source.NodeID]
			reference.Attribute = value.Source.Attribute
			normalized.Resource = &reference
		}
		result = append(result, normalized)
	}
	sort.Slice(result, func(left int, right int) bool {
		return compareUTF16(result[left].Key+"\x00"+result[left].ID, result[right].Key+"\x00"+result[right].ID) < 0
	})
	return result
}

func normalizeConfigurationValue(value configurationValueWire) ConfigurationValue {
	return ConfigurationValue{
		Kind: value.Kind, Value: value.Value, NodeID: value.NodeID, Attribute: value.Attribute,
		VariableID: value.VariableID, Reference: value.Reference,
	}
}
