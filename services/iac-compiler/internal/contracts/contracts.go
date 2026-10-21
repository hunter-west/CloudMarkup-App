// Package contracts owns the compiler-local, generated cross-language contract
// assets. The files are exact copies of the TypeScript-owned JSON Schemas and
// are guarded by drift tests; the standalone compiler never imports TypeScript
// runtime code.
package contracts

import (
	"embed"
	"fmt"
)

//go:embed schemas/*.schema.json
var schemas embed.FS

type Kind string

const (
	ArchitectureDocumentV3 Kind = "architecture-document-v3"
	WorkloadBehaviorV2     Kind = "workload-behavior-v2"
	SolutionRevisionV1     Kind = "solution-revision-manifest-v1"
)

var schemaFiles = map[Kind]string{
	ArchitectureDocumentV3: "schemas/architecture-document-v3.schema.json",
	WorkloadBehaviorV2:     "schemas/workload-behavior-v2.schema.json",
	SolutionRevisionV1:     "schemas/solution-revision-manifest-v1.schema.json",
}

func Schema(kind Kind) ([]byte, error) {
	name, ok := schemaFiles[kind]
	if !ok {
		return nil, fmt.Errorf("unsupported compiler contract %q", kind)
	}

	contents, err := schemas.ReadFile(name)
	if err != nil {
		return nil, fmt.Errorf("read embedded compiler contract %q: %w", kind, err)
	}
	return contents, nil
}

func SchemaFile(kind Kind) (string, bool) {
	name, ok := schemaFiles[kind]
	return name, ok
}
