package contracts

import (
	"bytes"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestEmbeddedSchemasMatchGeneratedCrossLanguageContracts(t *testing.T) {
	t.Parallel()

	_, thisFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller did not return the contract test path")
	}
	root := filepath.Clean(filepath.Join(filepath.Dir(thisFile), "..", "..", "..", ".."))

	tests := []struct {
		kind      Kind
		generated string
	}{
		{ArchitectureDocumentV3, "architecture-document-v3.schema.json"},
		{WorkloadBehaviorV2, "workload-behavior-v2.schema.json"},
		{SolutionRevisionV1, "solution-revision-manifest-v1.schema.json"},
	}

	for _, test := range tests {
		test := test
		t.Run(string(test.kind), func(t *testing.T) {
			t.Parallel()

			embedded, err := Schema(test.kind)
			if err != nil {
				t.Fatalf("Schema(%q): %v", test.kind, err)
			}
			generatedPath := filepath.Join(root, "packages", "schemas", "json-schema", test.generated)
			generated, err := os.ReadFile(generatedPath)
			if err != nil {
				t.Fatalf("read generated schema %s: %v", generatedPath, err)
			}
			if !bytes.Equal(embedded, generated) {
				t.Fatalf("embedded %s drifted from %s; regenerate and review the compiler contract copy", test.kind, generatedPath)
			}
		})
	}
}
