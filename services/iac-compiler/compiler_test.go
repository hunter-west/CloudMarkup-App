package compiler

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"reflect"
	"sort"
	"testing"
)

var representativeHashes = contentHashes{
	ArchitectureContent:  "sha256:a78ba1ab114e1d1a9687906d6d7c879cd43d211bda110322a114cc8f5d677a3e",
	ArchitectureDocument: "sha256:60c5c0af1f18fa2639e0c37c375caeb48fc73324fd2f26b495d444886935c6d2",
	ArchitectureVisual:   "sha256:9f6e43d1ae0eb6cab5139f66f2bc810f0594a40ac1b4a3da7e247435c8ed9364",
	Workload:             "sha256:0ca7f4b9b643b7e8ced683f220f2773ade7f1d43d6333aed9198bc23955e0e51",
	ApplicationContracts: "sha256:6ad4c6c491e73205c0e4d1a4ed1c24577bea03d0b6caed6ee917579fea96fec2",
	ExternalResources:    "sha256:24fb3839b149fd27e615757254f9825c672cccb717a11ec289bbedfb6ac0b266",
}

func TestNormalizeRepresentativeDocument(t *testing.T) {
	t.Parallel()

	architecture := representativeDocument(t)
	result := Normalize(context.Background(), Request{Architecture: architecture, Target: TargetTerraform})
	if !result.Succeeded() {
		t.Fatalf("Normalize() diagnostics = %#v", result.Diagnostics)
	}
	if result.Model == nil {
		t.Fatal("Normalize() model is nil")
	}
	if got := result.Model.Provenance; got.ArchitectureContentHash != representativeHashes.ArchitectureContent || got.ArchitectureDocumentHash != representativeHashes.ArchitectureDocument || got.ArchitectureVisualHash != representativeHashes.ArchitectureVisual || got.WorkloadContentHash != representativeHashes.Workload {
		t.Fatalf("cross-language hashes = %#v, want representative fixture hashes", got)
	}
	if got, want := resourceIDs(result.Model.Resources), []string{"node_source", "node_worker"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("resource IDs = %#v, want %#v", got, want)
	}
	if result.Model.Target.State != "ready" || !result.Model.Target.RenderingAvailable {
		t.Fatalf("target readiness = %#v, want render-ready Terraform", result.Model.Target)
	}
	if len(result.Model.Workloads) != 1 || len(result.Model.Workloads[0].Specification) == 0 {
		t.Fatalf("normalized workload = %#v, want one typed workload with canonical specification", result.Model.Workloads)
	}

	second := Normalize(context.Background(), Request{Architecture: architecture, Target: TargetTerraform})
	if !bytes.Equal(mustJSON(t, result), mustJSON(t, second)) {
		t.Fatal("repeated normalization is not byte-identical")
	}
}

func TestStructuralAndVersionValidationFailClosed(t *testing.T) {
	t.Parallel()

	t.Run("unknown field", func(t *testing.T) {
		document := decodeMap(t, representativeDocument(t))
		document["unexpected"] = true
		result := Normalize(context.Background(), Request{Architecture: encodeMap(t, document)})
		assertDiagnostic(t, result, "STRUCTURE_ARCHITECTURE_INVALID")
		if result.Model != nil {
			t.Fatal("structurally invalid input produced a model")
		}
	})

	t.Run("future schema", func(t *testing.T) {
		document := decodeMap(t, representativeDocument(t))
		document["schemaVersion"] = float64(4)
		result := Normalize(context.Background(), Request{Architecture: encodeMap(t, document)})
		assertDiagnostic(t, result, "COMPAT_SCHEMA_VERSION_UNSUPPORTED")
	})

	t.Run("unknown catalog", func(t *testing.T) {
		document := decodeMap(t, representativeDocument(t))
		objectAt(t, document, "catalog")["digest"] = digestOf('f')
		result := Normalize(context.Background(), Request{Architecture: encodeMap(t, document)})
		assertDiagnostic(t, result, "COMPAT_CATALOG_UNAVAILABLE")
	})

	t.Run("future target", func(t *testing.T) {
		result := Normalize(context.Background(), Request{Architecture: representativeDocument(t), Target: TargetKind("future-target")})
		assertDiagnostic(t, result, "COMPAT_TARGET_UNSUPPORTED")
	})
}

func TestDeterministicNormalizationIgnoresPresentationAndInputOrder(t *testing.T) {
	t.Parallel()

	baseline := Normalize(context.Background(), Request{Architecture: representativeDocument(t)})
	if !baseline.Succeeded() {
		t.Fatalf("baseline diagnostics = %#v", baseline.Diagnostics)
	}
	document := decodeMap(t, representativeDocument(t))
	reverseArray(t, document, "nodes")
	reverseArray(t, document, "edges")
	workload := objectAt(t, document, "workloadBehavior")
	reverseArray(t, workload, "workloads")
	nodes := arrayAt(t, document, "nodes")
	for _, value := range nodes {
		node := value.(map[string]any)
		presentation := objectAt(t, node, "presentation")
		presentation["label"] = "A presentation-only label"
		position := objectAt(t, presentation, "position")
		position["x"] = float64(9_999)
		position["y"] = float64(-9_999)
	}
	changed := Normalize(context.Background(), Request{Architecture: encodeMap(t, document)})
	if !changed.Succeeded() {
		t.Fatalf("changed diagnostics = %#v", changed.Diagnostics)
	}
	if !reflect.DeepEqual(baseline.Model.Resources, changed.Model.Resources) || !reflect.DeepEqual(baseline.Model.Connections, changed.Model.Connections) || !reflect.DeepEqual(baseline.Model.Workloads, changed.Model.Workloads) {
		t.Fatal("presentation-only or incidental array changes altered normalized infrastructure/application output")
	}
	if baseline.Model.Provenance.ArchitectureContentHash != changed.Model.Provenance.ArchitectureContentHash {
		t.Fatal("presentation-only changes altered the architecture content hash")
	}
	if baseline.Model.Provenance.ArchitectureVisualHash == changed.Model.Provenance.ArchitectureVisualHash {
		t.Fatal("presentation-only changes did not alter the separately tracked visual hash")
	}
}

func TestCollisionDetectionAndDeterministicDisambiguation(t *testing.T) {
	t.Parallel()

	document := decodeMap(t, representativeDocument(t))
	nodes := arrayAt(t, document, "nodes")
	worker := nodes[1].(map[string]any)
	objectAt(t, worker, "semantic")["deploymentKey"] = "source"
	input := encodeMap(t, document)
	first := Normalize(context.Background(), Request{Architecture: input})
	second := Normalize(context.Background(), Request{Architecture: input})
	assertDiagnostic(t, first, "SEMANTIC_DEPLOYMENT_KEY_COLLISION")
	if first.Model == nil || second.Model == nil {
		t.Fatal("semantically invalid collision should retain a non-renderable diagnostic model")
	}
	keys := []string{first.Model.Resources[0].TargetKey, first.Model.Resources[1].TargetKey}
	if keys[0] == keys[1] {
		t.Fatalf("target keys were not disambiguated: %#v", keys)
	}
	if !reflect.DeepEqual(first.Model.Resources, second.Model.Resources) {
		t.Fatal("collision disambiguation is not deterministic")
	}
	if first.Model.Target.State != "invalid" || first.Model.Target.RenderingAvailable {
		t.Fatalf("diagnostic model target = %#v, want invalid and non-renderable", first.Model.Target)
	}
}

func TestMalformedGeneratedProvenanceIsRejected(t *testing.T) {
	t.Parallel()

	document := decodeMap(t, representativeDocument(t))
	node := arrayAt(t, document, "nodes")[1].(map[string]any)
	objectAt(t, node, "semantic")["lifecycle"] = map[string]any{
		"ownership": "generated",
		"origin":    "migration",
		"provenance": map[string]any{
			"generatorKind": "migration", "generatorId": "example.generator", "generatorVersion": "1.0.0", "operationId": "operation_fixture",
			"dependentNodeIds": []any{"missing_node", "missing_node"}, "dependentEdgeIds": []any{"edge_trigger"},
		},
	}
	result := Normalize(context.Background(), Request{Architecture: encodeMap(t, document)})
	assertDiagnostic(t, result, "SEMANTIC_PROVENANCE_NODE_MISSING")
	assertDiagnostic(t, result, "SEMANTIC_PROVENANCE_NODE_DUPLICATE")
}

func TestStandaloneWorkloadMustMatchArchitecture(t *testing.T) {
	t.Parallel()

	document := decodeMap(t, representativeDocument(t))
	workload := cloneMap(objectAt(t, document, "workloadBehavior"))
	workloadRecord := arrayAt(t, workload, "workloads")[0].(map[string]any)
	workloadRecord["implementation"] = map[string]any{"mode": "infrastructure-only"}
	result := Normalize(context.Background(), Request{Architecture: representativeDocument(t), Workload: encodeMap(t, workload)})
	assertDiagnostic(t, result, "SEMANTIC_WORKLOAD_ARCHITECTURE_MISMATCH")
}

func TestSolutionRevisionBindsExactHashesAndRetryInput(t *testing.T) {
	t.Parallel()

	architecture := representativeDocument(t)
	manifest := validSolutionManifest(t, architecture, nil)
	request := Request{Architecture: architecture, SolutionRevision: manifest}
	first := Normalize(context.Background(), request)
	if !first.Succeeded() {
		t.Fatalf("valid Solution Revision diagnostics = %#v", first.Diagnostics)
	}
	if first.Model.Provenance.SolutionRevisionID != "solution_fixture_1" {
		t.Fatalf("Solution Revision provenance = %#v", first.Model.Provenance)
	}
	second := Normalize(context.Background(), request)
	if !bytes.Equal(mustJSON(t, first), mustJSON(t, second)) {
		t.Fatal("retrying exact Solution Revision input changed normalized output")
	}

	corrupt := decodeMap(t, manifest)
	objectAt(t, corrupt, "workload")["contentHash"] = digestOf('f')
	failed := Normalize(context.Background(), Request{Architecture: architecture, SolutionRevision: encodeMap(t, corrupt)})
	assertDiagnostic(t, failed, "SEMANTIC_SOLUTION_WORKLOAD_HASH_MISMATCH")
}

func TestWorkloadImplementationModesAndArtifactReferences(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name           string
		implementation map[string]any
		wantMode       string
		wantArtifacts  int
		wantReadiness  string
	}{
		{"infrastructure", map[string]any{"mode": "infrastructure-only"}, "infrastructure-only", 0, "not-applicable"},
		{"user provided", map[string]any{"mode": "user-provided", "runtimeFamily": "example.runtime.nodejs", "handler": "src/handler.main", "sourceOwnership": "user"}, "user-provided", 0, "not-applicable"},
		{"generated", map[string]any{"mode": "generated-starter", "runtimeFamily": "example.runtime.nodejs", "handler": "src/handler.main", "sourceOwnership": "cloudmarkup"}, "generated-starter", 0, "not-selected"},
		{"external artifact", map[string]any{"mode": "external-artifact", "runtimeFamily": "example.runtime.nodejs", "handler": "src/handler.main", "sourceOwnership": "external", "artifact": map[string]any{"artifactId": "artifact_fixture", "digest": digestOf('a')}}, "external-artifact", 1, "not-applicable"},
	}
	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			document := decodeMap(t, representativeDocument(t))
			workload := arrayAt(t, objectAt(t, document, "workloadBehavior"), "workloads")[0].(map[string]any)
			workload["implementation"] = test.implementation
			result := Normalize(context.Background(), Request{Architecture: encodeMap(t, document)})
			if !result.Succeeded() {
				t.Fatalf("Normalize() diagnostics = %#v", result.Diagnostics)
			}
			got := result.Model.Workloads[0]
			if got.ImplementationMode != test.wantMode || len(got.ArtifactInputs) != test.wantArtifacts || got.GeneratorReadiness.State != test.wantReadiness {
				t.Fatalf("normalized mode = %#v", got)
			}
		})
	}
}

func TestPinnedGeneratorCompatibilityUsesSeparateBoundary(t *testing.T) {
	t.Parallel()

	document := decodeMap(t, representativeDocument(t))
	workload := arrayAt(t, objectAt(t, document, "workloadBehavior"), "workloads")[0].(map[string]any)
	workload["implementation"] = map[string]any{"mode": "generated-starter", "runtimeFamily": "example.runtime.nodejs", "handler": "src/handler.main", "sourceOwnership": "cloudmarkup"}
	compatibility := objectAt(t, workload, "compatibility")
	compatibility["applicationGenerators"] = []any{map[string]any{
		"generatorId": "cloudmarkup.application-generator", "minimumVersion": "1.0.0", "maximumVersionExclusive": "2.0.0",
		"templateId": "cloudmarkup.template.notes", "templateVersion": "1.0.0", "supportedModes": []any{"generated-starter"},
	}}
	architecture := encodeMap(t, document)
	generator := ToolReference{ID: "cloudmarkup.application-generator", Version: "1.2.0", Digest: digestOf('b')}
	manifest := validSolutionManifest(t, architecture, &generator)
	registry := DefaultCompatibilityRegistry()
	registry.ApplicationGenerators = []GeneratorCompatibility{{ID: generator.ID, Version: generator.Version, Digest: generator.Digest}}
	result := Normalize(context.Background(), Request{Architecture: architecture, SolutionRevision: manifest, Compatibility: registry})
	if !result.Succeeded() {
		t.Fatalf("Normalize() diagnostics = %#v", result.Diagnostics)
	}
	readiness := result.Model.Workloads[0].GeneratorReadiness
	if readiness.State != "compatible-interface-only" || readiness.TemplateID != "cloudmarkup.template.notes" || len(result.Model.Workloads[0].ArtifactOutputs) != 0 {
		t.Fatalf("generator readiness = %#v; source generation must remain separate and unexecuted", readiness)
	}
}

func TestCustomAndGeneratedPolicyFactsArePreserved(t *testing.T) {
	t.Parallel()

	document := decodeMap(t, representativeDocument(t))
	nodes := arrayAt(t, document, "nodes")
	custom := nodes[0].(map[string]any)
	customSemantic := objectAt(t, custom, "semantic")
	customSemantic["serviceType"] = "aws.iam.policy-document"
	customSemantic["resourceType"] = "aws.iam.policy-document"
	generated := nodes[1].(map[string]any)
	generatedSemantic := objectAt(t, generated, "semantic")
	generatedSemantic["serviceType"] = "aws.iam.policy-statement"
	generatedSemantic["resourceType"] = "aws.iam.policy-statement"
	generatedSemantic["lifecycle"] = map[string]any{
		"ownership": "generated", "origin": "migration",
		"provenance": map[string]any{
			"generatorKind": "migration", "generatorId": "example.generator", "generatorVersion": "1.0.0", "operationId": "operation_fixture",
			"dependentNodeIds": []any{"node_source"}, "dependentEdgeIds": []any{"edge_trigger"},
		},
	}
	registry := DefaultCompatibilityRegistry()
	fixtureCatalog := objectAt(t, document, "catalog")
	matches := 0
	for index := range registry.Catalogs {
		catalog := &registry.Catalogs[index]
		if catalog.ID == fixtureCatalog["id"] && catalog.Version == fixtureCatalog["version"] && catalog.Digest == fixtureCatalog["digest"] {
			catalog.PolicyResourceTypes = []string{"aws.iam.policy-document", "aws.iam.policy-statement"}
			matches++
		}
	}
	if matches != 1 {
		t.Fatalf("fixture catalog matches = %d, want 1", matches)
	}
	result := Normalize(context.Background(), Request{Architecture: encodeMap(t, document), Compatibility: registry})
	if !result.Succeeded() {
		t.Fatalf("Normalize() diagnostics = %#v", result.Diagnostics)
	}
	if len(result.Model.PolicyAttachments) != 2 {
		t.Fatalf("policy attachments = %#v", result.Model.PolicyAttachments)
	}
	ownership := []string{result.Model.PolicyAttachments[0].Ownership, result.Model.PolicyAttachments[1].Ownership}
	sort.Strings(ownership)
	if !reflect.DeepEqual(ownership, []string{"generated", "user"}) {
		t.Fatalf("policy ownership = %#v", ownership)
	}
}

func TestBoundsAndCancellation(t *testing.T) {
	t.Parallel()

	architecture := representativeDocument(t)
	limits := DefaultLimits()
	limits.MaxArchitectureBytes = int64(len(architecture) - 1)
	tooLarge := Normalize(context.Background(), Request{Architecture: architecture, Limits: limits})
	assertDiagnostic(t, tooLarge, "LIMIT_INPUT_BYTES_EXCEEDED")

	canceledContext, cancel := context.WithCancel(context.Background())
	cancel()
	canceledResult := Normalize(canceledContext, Request{Architecture: architecture})
	assertDiagnostic(t, canceledResult, "COMPILER_CANCELED")

	outputLimits := DefaultLimits()
	outputLimits.MaxNormalizedBytes = 100
	oversizedOutput := Normalize(context.Background(), Request{Architecture: architecture, Limits: outputLimits})
	assertDiagnostic(t, oversizedOutput, "LIMIT_NORMALIZED_OUTPUT_EXCEEDED")
	if oversizedOutput.Model != nil {
		t.Fatal("oversized normalized output was retained")
	}
}

func TestReaderEntryPointBoundsInput(t *testing.T) {
	t.Parallel()

	architecture := representativeDocument(t)
	result := NormalizeReaders(context.Background(), ReaderRequest{Architecture: bytes.NewReader(architecture), Target: TargetTerraform})
	if !result.Succeeded() {
		t.Fatalf("NormalizeReaders() diagnostics = %#v", result.Diagnostics)
	}
	missing := NormalizeReaders(context.Background(), ReaderRequest{})
	assertDiagnostic(t, missing, "INPUT_REQUIRED")
}

func validSolutionManifest(t *testing.T, architecture []byte, generator *ToolReference) []byte {
	t.Helper()
	raw := decodeMap(t, architecture)
	hashes, err := computeContentHashes(raw)
	if err != nil {
		t.Fatalf("computeContentHashes(): %v", err)
	}
	catalog := objectAt(t, raw, "catalog")
	revision := objectAt(t, raw, "revision")
	applicationGenerator := map[string]any{"state": "not-applicable", "reason": "Application generation has not run."}
	if generator != nil {
		applicationGenerator = map[string]any{"state": "pinned", "tool": map[string]any{"id": generator.ID, "version": generator.Version, "digest": generator.Digest}}
	}
	manifest := map[string]any{
		"aiExtensionIds": []any{},
		"architecture": map[string]any{
			"contentHash": hashes.ArchitectureContent, "documentHash": hashes.ArchitectureDocument,
			"documentKind": "cloudmarkup.architecture-document", "revisionId": revision["revisionId"], "schemaVersion": float64(3), "visualHash": hashes.ArchitectureVisual,
		},
		"assumptions": []any{}, "contractVersion": float64(1),
		"contracts": map[string]any{"contentHash": hashes.ApplicationContracts, "contractVersion": float64(1), "recordHashes": []any{}},
		"createdAt": "2026-08-16T00:00:00.000Z", "createdBy": "actor_fixture",
		"evidenceIdsAtFreeze": []any{},
		"externalResources":   map[string]any{"contentHash": hashes.ExternalResources, "contractVersion": float64(1)},
		"generationCoverage": map[string]any{
			"contractVersion": float64(1), "evidence": []any{}, "missingRequirements": []any{}, "solutionRevisionId": "solution_fixture_1", "state": "custom-implementation-required",
			"workloads": []any{map[string]any{"evidence": []any{}, "missingRequirements": []any{}, "state": "custom-implementation-required", "unresolvedRequirementIds": []any{"requirement_retry_review"}, "workloadId": "workload_worker"}},
		},
		"intent":           map[string]any{"reason": "This project began from a reviewed blank design.", "state": "not-applicable"},
		"issueIdsAtFreeze": []any{}, "kind": "cloudmarkup.solution-revision-manifest", "repositoryObservations": []any{}, "solutionRevisionId": "solution_fixture_1",
		"sourceOwnership": []any{}, "unresolvedDecisionIds": []any{},
		"versions": map[string]any{
			"applicationGenerator": applicationGenerator,
			"catalog":              map[string]any{"id": catalog["id"], "version": catalog["version"], "digest": catalog["digest"]},
			"compiler":             map[string]any{"state": "pinned", "tool": map[string]any{"id": CompilerID, "version": CompilerVersion}},
			"diagramRenderer":      map[string]any{"state": "not-applicable", "reason": "Diagram rendering has not run."},
			"importer":             map[string]any{"state": "not-applicable", "reason": "No repository import is bound."},
			"modelPrompt":          map[string]any{"state": "not-applicable", "reason": "No model invocation is bound."},
			"policy":               []any{},
		},
		"workload": map[string]any{"contentHash": hashes.Workload, "contractVersion": float64(2)},
	}
	return encodeMap(t, manifest)
}

func representativeDocument(t *testing.T) []byte {
	t.Helper()
	contents, err := os.ReadFile("../../packages/test-fixtures/fixtures/architecture-document/v3/valid/representative.json")
	if err != nil {
		t.Fatalf("read representative fixture: %v", err)
	}
	return contents
}

func decodeMap(t *testing.T, contents []byte) map[string]any {
	t.Helper()
	var result map[string]any
	if err := json.Unmarshal(contents, &result); err != nil {
		t.Fatalf("decode JSON fixture: %v", err)
	}
	return result
}

func encodeMap(t *testing.T, value map[string]any) []byte {
	t.Helper()
	contents, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("encode JSON fixture: %v", err)
	}
	return contents
}

func objectAt(t *testing.T, value map[string]any, key string) map[string]any {
	t.Helper()
	object, ok := value[key].(map[string]any)
	if !ok {
		t.Fatalf("%s is %T, want object", key, value[key])
	}
	return object
}

func arrayAt(t *testing.T, value map[string]any, key string) []any {
	t.Helper()
	array, ok := value[key].([]any)
	if !ok {
		t.Fatalf("%s is %T, want array", key, value[key])
	}
	return array
}

func reverseArray(t *testing.T, value map[string]any, key string) {
	t.Helper()
	array := arrayAt(t, value, key)
	for left, right := 0, len(array)-1; left < right; left, right = left+1, right-1 {
		array[left], array[right] = array[right], array[left]
	}
}

func digestOf(character byte) string {
	return "sha256:" + string(bytes.Repeat([]byte{character}, 64))
}

func assertDiagnostic(t *testing.T, result Result, code string) {
	t.Helper()
	for _, diagnostic := range result.Diagnostics {
		if diagnostic.Code == code {
			return
		}
	}
	t.Fatalf("diagnostics = %#v, want code %s", result.Diagnostics, code)
}

func resourceIDs(resources []NormalizedResource) []string {
	result := make([]string, len(resources))
	for index, resource := range resources {
		result[index] = resource.ID
	}
	return result
}

func mustJSON(t *testing.T, value any) []byte {
	t.Helper()
	contents, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("json.Marshal(): %v", err)
	}
	return contents
}
