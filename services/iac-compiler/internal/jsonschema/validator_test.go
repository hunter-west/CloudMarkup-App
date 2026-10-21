package jsonschema

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func TestValidatorCoversGeneratedKeywordSemantics(t *testing.T) {
	t.Parallel()

	schema := []byte(`{
  "type":"object",
  "required":["kind","items"],
  "additionalProperties":false,
  "properties":{
    "kind":{"const":"fixture"},
    "items":{"type":"array","minItems":1,"maxItems":2,"items":{"oneOf":[{"type":"string","pattern":"^(?:a|b)+$"},{"type":"integer","minimum":1,"maximum":2}]}}
  }
}`)
	validator, err := New(schema, 8, 8)
	if err != nil {
		t.Fatalf("New(): %v", err)
	}

	valid := decode(t, `{"kind":"fixture","items":["ab",2]}`)
	if issues := validator.Validate(context.Background(), valid); len(issues) != 0 {
		t.Fatalf("valid document issues = %#v", issues)
	}

	invalid := decode(t, `{"kind":"other","items":[0,"c",3],"extra":true}`)
	issues := validator.Validate(context.Background(), invalid)
	if len(issues) == 0 {
		t.Fatal("invalid document produced no issues")
	}
}

func decode(t *testing.T, contents string) any {
	t.Helper()
	decoder := json.NewDecoder(strings.NewReader(contents))
	decoder.UseNumber()
	var value any
	if err := decoder.Decode(&value); err != nil {
		t.Fatalf("decode fixture: %v", err)
	}
	return value
}
