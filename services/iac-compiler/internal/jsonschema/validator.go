// Package jsonschema validates the bounded keyword surface emitted by the
// repository's generated Draft 2020-12 schemas. It is intentionally not a
// general JSON Schema engine.
package jsonschema

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"unicode/utf16"
)

type Issue struct {
	Path    string
	Keyword string
}

type Validator struct {
	root           map[string]any
	maxDepth       int
	maxDiagnostics int
}

func New(schemaBytes []byte, maxDepth int, maxDiagnostics int) (*Validator, error) {
	var root map[string]any
	decoder := json.NewDecoder(strings.NewReader(string(schemaBytes)))
	decoder.UseNumber()
	if err := decoder.Decode(&root); err != nil {
		return nil, fmt.Errorf("decode generated JSON Schema: %w", err)
	}
	if maxDepth <= 0 || maxDiagnostics <= 0 {
		return nil, fmt.Errorf("JSON Schema limits must be positive")
	}
	return &Validator{root: root, maxDepth: maxDepth, maxDiagnostics: maxDiagnostics}, nil
}

func (validator *Validator) Validate(ctx context.Context, value any) []Issue {
	state := validationState{ctx: ctx, maxDepth: validator.maxDepth, maxDiagnostics: validator.maxDiagnostics}
	state.validate(validator.root, value, "$", 0)
	return state.issues
}

type validationState struct {
	ctx            context.Context
	issues         []Issue
	maxDepth       int
	maxDiagnostics int
}

func (state *validationState) add(path string, keyword string) {
	if len(state.issues) >= state.maxDiagnostics {
		return
	}
	state.issues = append(state.issues, Issue{Path: path, Keyword: keyword})
}

func (state *validationState) validate(schema map[string]any, value any, path string, depth int) {
	if len(state.issues) >= state.maxDiagnostics {
		return
	}
	select {
	case <-state.ctx.Done():
		state.add(path, "canceled")
		return
	default:
	}
	if depth > state.maxDepth {
		state.add(path, "maxDepth")
		return
	}

	if alternatives, ok := schema["oneOf"].([]any); ok {
		matches := 0
		for _, candidate := range alternatives {
			candidateSchema, ok := candidate.(map[string]any)
			if !ok {
				continue
			}
			trial := validationState{ctx: state.ctx, maxDepth: state.maxDepth, maxDiagnostics: 1}
			trial.validate(candidateSchema, value, path, depth+1)
			if len(trial.issues) == 0 {
				matches++
			}
		}
		if matches != 1 {
			state.add(path, "oneOf")
			return
		}
	}

	if expected, ok := schema["type"]; ok && !matchesType(expected, value) {
		state.add(path, "type")
		return
	}
	if expected, ok := schema["const"]; ok && !jsonEqual(expected, value) {
		state.add(path, "const")
		return
	}
	if values, ok := schema["enum"].([]any); ok {
		matched := false
		for _, expected := range values {
			if jsonEqual(expected, value) {
				matched = true
				break
			}
		}
		if !matched {
			state.add(path, "enum")
			return
		}
	}

	switch typed := value.(type) {
	case map[string]any:
		state.validateObject(schema, typed, path, depth)
	case []any:
		state.validateArray(schema, typed, path, depth)
	case string:
		state.validateString(schema, typed, path)
	case json.Number:
		state.validateNumber(schema, typed, path)
	case float64:
		state.validateFloat(schema, typed, path)
	}
}

func (state *validationState) validateObject(schema map[string]any, value map[string]any, path string, depth int) {
	properties, _ := schema["properties"].(map[string]any)
	if required, ok := schema["required"].([]any); ok {
		for _, requiredValue := range required {
			name, ok := requiredValue.(string)
			if !ok {
				continue
			}
			if _, exists := value[name]; !exists {
				state.add(childPath(path, name), "required")
			}
		}
	}

	keys := make([]string, 0, len(value))
	for key := range value {
		keys = append(keys, key)
	}
	sort.Strings(keys)

	propertyNameSchema, _ := schema["propertyNames"].(map[string]any)
	additional := schema["additionalProperties"]
	for _, key := range keys {
		if propertyNameSchema != nil {
			state.validate(propertyNameSchema, key, childPath(path, key), depth+1)
		}
		if propertySchema, ok := properties[key].(map[string]any); ok {
			state.validate(propertySchema, value[key], childPath(path, key), depth+1)
			continue
		}
		switch typed := additional.(type) {
		case bool:
			if !typed {
				state.add(childPath(path, key), "additionalProperties")
			}
		case map[string]any:
			state.validate(typed, value[key], childPath(path, key), depth+1)
		}
	}
}

func (state *validationState) validateArray(schema map[string]any, value []any, path string, depth int) {
	if minimum, ok := integerKeyword(schema["minItems"]); ok && len(value) < minimum {
		state.add(path, "minItems")
	}
	if maximum, ok := integerKeyword(schema["maxItems"]); ok && len(value) > maximum {
		state.add(path, "maxItems")
	}
	items, _ := schema["items"].(map[string]any)
	if items == nil {
		return
	}
	for index, item := range value {
		state.validate(items, item, fmt.Sprintf("%s[%d]", path, index), depth+1)
	}
}

func (state *validationState) validateString(schema map[string]any, value string, path string) {
	if minimum, ok := integerKeyword(schema["minLength"]); ok && len(utf16.Encode([]rune(value))) < minimum {
		state.add(path, "minLength")
	}
	if maximum, ok := integerKeyword(schema["maxLength"]); ok && len(utf16.Encode([]rune(value))) > maximum {
		state.add(path, "maxLength")
	}
	pattern, ok := schema["pattern"].(string)
	if !ok {
		return
	}
	// Zod emits ECMAScript non-capturing groups. RE2 has the same matching
	// behavior for these contracts when the marker is changed to a capturing
	// group; no generated pattern uses look-around or backreferences.
	compatiblePattern := strings.ReplaceAll(pattern, "(?:", "(")
	compiled, err := regexp.Compile(compatiblePattern)
	if err != nil || !compiled.MatchString(value) {
		state.add(path, "pattern")
	}
}

func (state *validationState) validateNumber(schema map[string]any, value json.Number, path string) {
	parsed, err := strconv.ParseFloat(string(value), 64)
	if err != nil || math.IsInf(parsed, 0) || math.IsNaN(parsed) {
		state.add(path, "number")
		return
	}
	state.validateFloat(schema, parsed, path)
}

func (state *validationState) validateFloat(schema map[string]any, value float64, path string) {
	if schema["type"] == "integer" && math.Trunc(value) != value {
		state.add(path, "integer")
		return
	}
	if minimum, ok := numberKeyword(schema["minimum"]); ok && value < minimum {
		state.add(path, "minimum")
	}
	if maximum, ok := numberKeyword(schema["maximum"]); ok && value > maximum {
		state.add(path, "maximum")
	}
	if minimum, ok := numberKeyword(schema["exclusiveMinimum"]); ok && value <= minimum {
		state.add(path, "exclusiveMinimum")
	}
}

func matchesType(expected any, value any) bool {
	if names, ok := expected.([]any); ok {
		for _, name := range names {
			if matchesType(name, value) {
				return true
			}
		}
		return false
	}
	name, ok := expected.(string)
	if !ok {
		return false
	}
	switch name {
	case "object":
		_, ok = value.(map[string]any)
	case "array":
		_, ok = value.([]any)
	case "string":
		_, ok = value.(string)
	case "number":
		_, number := numericValue(value)
		ok = number
	case "integer":
		number, numeric := numericValue(value)
		ok = numeric && math.Trunc(number) == number
	case "boolean":
		_, ok = value.(bool)
	case "null":
		ok = value == nil
	default:
		ok = false
	}
	return ok
}

func jsonEqual(left any, right any) bool {
	leftNumber, leftNumeric := numericValue(left)
	rightNumber, rightNumeric := numericValue(right)
	if leftNumeric || rightNumeric {
		return leftNumeric && rightNumeric && leftNumber == rightNumber
	}
	leftBytes, leftErr := json.Marshal(left)
	rightBytes, rightErr := json.Marshal(right)
	return leftErr == nil && rightErr == nil && string(leftBytes) == string(rightBytes)
}

func numericValue(value any) (float64, bool) {
	switch typed := value.(type) {
	case json.Number:
		parsed, err := strconv.ParseFloat(string(typed), 64)
		return parsed, err == nil
	case float64:
		return typed, !math.IsInf(typed, 0) && !math.IsNaN(typed)
	default:
		return 0, false
	}
}

func integerKeyword(value any) (int, bool) {
	number, ok := numericValue(value)
	if !ok || number < 0 || math.Trunc(number) != number || number > math.MaxInt {
		return 0, false
	}
	return int(number), true
}

func numberKeyword(value any) (float64, bool) {
	return numericValue(value)
}

func childPath(parent string, key string) string {
	if regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`).MatchString(key) {
		return parent + "." + key
	}
	return parent + "[" + strconv.Quote(key) + "]"
}
