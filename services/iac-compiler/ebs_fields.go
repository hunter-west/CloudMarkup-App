package compiler

import (
	"math"
	"regexp"
	"sort"
	"unicode/utf16"
)

func (r *terraformRenderer) validateEbsFields(n NormalizedResource) bool {
	schema := ebsSchemas[n.ServiceType]
	keys := []string{}
	for k := range schema {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	if !r.validateConfiguration(n, n.ServiceType+".configuration", keys) {
		return false
	}
	ok := true
	for _, k := range keys {
		s := schema[k]
		v := n.Configuration.Values[k]
		valid := v.Kind == s.Type
		var value any
		switch s.Type {
		case "string":
			value = r.configString(n, k)
			t := r.configString(n, k)
			valid = valid && (s.Pattern == "" || regexp.MustCompile(s.Pattern).MatchString(t)) && (s.MinLength == nil || len(utf16.Encode([]rune(t))) >= *s.MinLength) && (s.MaxLength == nil || len(utf16.Encode([]rune(t))) <= *s.MaxLength)
		case "integer":
			f := r.configNumber(n, k)
			value = f
			valid = valid && !math.IsNaN(f) && !math.IsInf(f, 0) && f == math.Trunc(f) && (s.Minimum == nil || f >= *s.Minimum) && (s.Maximum == nil || f <= *s.Maximum)
		case "boolean":
			value = r.configBool(n, k)
			valid = valid && (s.Const == nil || value == *s.Const)
		}
		if len(s.Enum) > 0 {
			found := false
			for _, e := range s.Enum {
				if e == value {
					found = true
				}
			}
			valid = valid && found
		}
		if !valid {
			r.error("TARGET_EBS_FIELD_INVALID", "Supply every exact reviewed literal field with admitted bounds/modes; reference values and unknown properties are unsupported.", SourceReference{Document: DocumentArchitecture, NodeID: n.ID, Path: "$.semantic.configuration.values." + k})
			ok = false
		}
	}
	return ok
}
