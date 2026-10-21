package compiler

import (
	"context"
	"fmt"
	"reflect"
	"strings"
	"testing"
)

const (
	prompt30GoldenConfirm = "UPDATE_REVIEWED_GENERATION_GOLDENS"
	prompt30GoldenRoot    = "../../testdata/generation-goldens-v1/goldens"
)

type prompt30Fixture struct {
	id              string
	model           *NormalizedSolution
	mustContain     map[string][]string
	mustNotContain  map[string][]string
	expectedActions []string
}

func TestGenerationGoldenFixtureInventory(t *testing.T) {
	t.Parallel()
	inventory := readPrompt30Inventory(t)
	if inventory.ContractVersion != 1 {
		t.Fatalf("fixture inventory contractVersion = %d", inventory.ContractVersion)
	}
	seen := map[string]bool{}
	for _, fixture := range inventory.Fixtures {
		if seen[fixture.ID] {
			t.Fatalf("duplicate fixture inventory ID %q", fixture.ID)
		}
		seen[fixture.ID] = true
		if fixture.ID == "" || len(fixture.Layers) == 0 {
			t.Fatalf("incomplete fixture inventory record = %#v", fixture)
		}
	}
	want := []string{
		"api-gateway-lambda",
		"cognito-authorized-api",
		"complete-supported-notes-api",
		"custom-inline-iam-policy",
		"generated-plus-custom-policies",
		"generated-resource-adoption",
		"generated-resource-deletion",
		"generated-starter-lambda",
		"invalid-and-unsupported-configurations",
		"lambda-dynamodb-read-only",
		"lambda-dynamodb-read-write",
		"malformed-solution-revision-or-workload-reference",
		"minimal-lambda-infrastructure-only",
		"multiple-downstream-dependencies",
		"multiple-trigger-compatible",
		"multiple-trigger-incompatible",
		"networking-low-cost-endpoint-serverless",
		"networking-two-az-public-private",
		"mutable-display-label-changes",
		"naming-collisions",
		"stable-visual-only-changes",
		"unresolved-business-behavior",
		"user-owned-source-conflict",
		"user-provided-lambda-artifact",
	}
	for _, id := range want {
		if !seen[id] {
			t.Errorf("fixture inventory is missing %q", id)
		}
	}
}

func TestGenerationGoldenSuite(t *testing.T) {
	fixtures := prompt30SupportedIACFixtures()
	assertPrompt30IACInventory(t, fixtures)
	category, update := prompt30GoldenUpdate(t)
	for _, fixture := range fixtures {
		fixture := fixture
		t.Run(fixture.id, func(t *testing.T) {
			artifact, diagnostics := renderTerraformArtifact(context.Background(), cloneNormalized(t, fixture.model), nil, DefaultLimits())
			assertNoTargetErrors(t, diagnostics)
			if artifact == nil {
				t.Fatal("Terraform artifact is nil")
			}
			prompt30AssertArtifact(t, fixture, artifact)

			again, againDiagnostics := renderTerraformArtifact(context.Background(), cloneNormalized(t, fixture.model), nil, DefaultLimits())
			assertNoTargetErrors(t, againDiagnostics)
			if !reflect.DeepEqual(artifact, again) {
				t.Fatal("repeated render is not byte-identical")
			}

			iacTree := prompt30IACTree(artifact, fixture.id)
			manifestTree := prompt30TerraformManifestTree(t, artifact, fixture.id)
			if !update || category == "iac" {
				prompt30CompareOrUpdateTree(t, fixture.id, "iac", iacTree, update)
			}
			if !update || category == "manifests" {
				prompt30CompareOrUpdateTree(t, fixture.id, filepathJoin("manifests", "terraform"), manifestTree, update)
			}
			prompt30AssertCleanDirectoryReproducibility(t, iacTree)
		})
	}
}

func TestGenerationGoldenSolutionRevisionFullPath(t *testing.T) {
	t.Parallel()
	architecture := architectureFromNormalized(t, authenticatedNotesModel())
	manifest := validSolutionManifest(t, architecture, nil)
	manifestObject := decodeMap(t, manifest)
	coverage := objectAt(t, manifestObject, "generationCoverage")
	coverage["state"] = "complete-supported-pattern"
	workloadCoverage := arrayAt(t, coverage, "workloads")[0].(map[string]any)
	workloadCoverage["workloadId"] = "workload_notes"
	workloadCoverage["state"] = "complete-supported-pattern"
	workloadCoverage["unresolvedRequirementIds"] = []any{}
	manifest = encodeMap(t, manifestObject)

	request := CompileRequest{Request: Request{
		Architecture:     architecture,
		SolutionRevision: manifest,
		Target:           TargetTerraform,
	}}
	first := Compile(context.Background(), request)
	second := Compile(context.Background(), request)
	if !first.Succeeded() || !second.Succeeded() {
		t.Fatalf("full Solution Revision compile diagnostics = %#v / %#v", first.Diagnostics, second.Diagnostics)
	}
	if !reflect.DeepEqual(first, second) {
		t.Fatal("full Solution Revision compile changed across repeated runs")
	}
	if first.Artifact.Provenance.SolutionRevisionID != "solution_fixture_1" {
		t.Fatalf("artifact Solution Revision = %#v", first.Artifact.Provenance)
	}
	readme := fileContent(t, first.Artifact, "infrastructure/README.md")
	for _, expected := range []string{
		"solution_fixture_1",
		CompilerID,
		CompilerVersion,
		TerraformCatalogID,
		CurrentAwsCatalogVersion,
	} {
		if !strings.Contains(readme, expected) {
			t.Errorf("README does not contain pinned metadata %q", expected)
		}
	}
}

func TestGenerationGoldenNegativeAndMetamorphicCases(t *testing.T) {
	t.Parallel()
	t.Run("unsupported configuration", func(t *testing.T) {
		architecture := decodeMap(t, architectureFromNormalized(t, minimalLambdaModel("generated-starter")))
		for _, value := range arrayAt(t, architecture, "nodes") {
			node := value.(map[string]any)
			if node["id"] == "lambda" {
				configuration := objectAt(t, objectAt(t, node, "semantic"), "configuration")
				objectAt(t, configuration, "values")["runtime"] = map[string]any{"kind": "string", "value": "python3.14"}
			}
		}
		result := Compile(context.Background(), CompileRequest{Request: Request{Architecture: encodeMap(t, architecture), Target: TargetTerraform}})
		if result.Artifact != nil || !hasDiagnostic(result.Diagnostics, "TARGET_LAMBDA_RUNTIME_UNSUPPORTED") {
			t.Fatalf("unsupported configuration result = %#v", result)
		}
	})
	t.Run("malformed Solution Revision", func(t *testing.T) {
		architecture := representativeDocument(t)
		manifest := decodeMap(t, validSolutionManifest(t, architecture, nil))
		objectAt(t, manifest, "architecture")["contentHash"] = digestOf('f')
		result := Compile(context.Background(), CompileRequest{Request: Request{
			Architecture: architecture, SolutionRevision: encodeMap(t, manifest), Target: TargetTerraform,
		}})
		if result.Artifact != nil || !hasDiagnostic(result.Diagnostics, "SEMANTIC_SOLUTION_ARCHITECTURE_HASH_MISMATCH") {
			t.Fatalf("malformed Solution Revision result = %#v", result)
		}
	})
	t.Run("malformed workload owner", func(t *testing.T) {
		document := decodeMap(t, representativeDocument(t))
		workload := arrayAt(t, objectAt(t, document, "workloadBehavior"), "workloads")[0].(map[string]any)
		workload["owningNodeId"] = "missing_node"
		result := Compile(context.Background(), CompileRequest{Request: Request{
			Architecture: encodeMap(t, document), Target: TargetTerraform,
		}})
		if result.Artifact != nil || !hasDiagnostic(result.Diagnostics, "SEMANTIC_WORKLOAD_OWNER_MISSING") {
			t.Fatalf("malformed workload result = %#v", result)
		}
	})
	t.Run("visual and display changes", func(t *testing.T) {
		architecture := architectureFromNormalized(t, authenticatedNotesModel())
		baseline := Compile(context.Background(), CompileRequest{Request: Request{Architecture: architecture, Target: TargetTerraform}})
		changed := decodeMap(t, architecture)
		for index, value := range arrayAt(t, changed, "nodes") {
			node := value.(map[string]any)
			presentation := objectAt(t, node, "presentation")
			presentation["label"] = fmt.Sprintf("Mutable label %03d", index)
			presentation["position"] = map[string]any{"x": float64(index * -71), "y": float64(index * 113)}
		}
		reversePrompt30Values(arrayAt(t, changed, "nodes"))
		reversePrompt30Values(arrayAt(t, changed, "edges"))
		workloads := arrayAt(t, objectAt(t, changed, "workloadBehavior"), "workloads")
		reversePrompt30Values(workloads)
		variant := Compile(context.Background(), CompileRequest{Request: Request{Architecture: encodeMap(t, changed), Target: TargetTerraform}})
		if !baseline.Succeeded() || !variant.Succeeded() {
			t.Fatalf("metamorphic diagnostics = %#v / %#v", baseline.Diagnostics, variant.Diagnostics)
		}
		if !reflect.DeepEqual(baseline.Artifact.Files, variant.Artifact.Files) ||
			!reflect.DeepEqual(baseline.Artifact.ApplicationArtifacts, variant.Artifact.ApplicationArtifacts) ||
			!reflect.DeepEqual(baseline.Artifact.PolicyArtifacts, variant.Artifact.PolicyArtifacts) {
			t.Fatal("visual/display-only changes altered deployment files, addresses, or paths")
		}
	})
}

func FuzzGenerationCompilerMalformedJSON(f *testing.F) {
	for _, seed := range []string{
		"{",
		"null",
		`{"kind":"cloudmarkup.architecture-document"}`,
		`{"nodes":[{"id":"../escape"}]}`,
	} {
		f.Add(seed)
	}
	f.Fuzz(func(t *testing.T, input string) {
		if len(input) > 16*1024 {
			t.Skip()
		}
		result := Compile(context.Background(), CompileRequest{Request: Request{
			Architecture: []byte(input), Target: TargetTerraform,
		}})
		if result.Artifact != nil && !result.Succeeded() {
			t.Fatal("failed compilation retained a Terraform artifact")
		}
		if result.Artifact != nil {
			prompt30AssertNoForbiddenTerraform(t, result.Artifact)
		}
	})
}

func FuzzGenerationTerraformIdentifiersAndLabels(f *testing.F) {
	for _, seed := range []string{"notes", "same-name", "ümlaut", "../escape", "A B C", strings.Repeat("x", 80)} {
		f.Add(seed)
	}
	f.Fuzz(func(t *testing.T, value string) {
		if len(value) > 256 {
			t.Skip()
		}
		model := minimalLambdaModel("generated-starter")
		model.Resources = append(model.Resources,
			dynamoResource("table_alpha", value, "alpha"),
			dynamoResource("table_beta", value, "beta"),
		)
		sortModel(model)
		artifact, diagnostics := renderTerraformArtifact(context.Background(), model, nil, DefaultLimits())
		if artifact == nil {
			if !hasErrorDiagnostics(diagnostics) {
				t.Fatal("identifier rejection did not emit an error")
			}
			return
		}
		prompt30AssertNoForbiddenTerraform(t, artifact)
		again, againDiagnostics := renderTerraformArtifact(context.Background(), cloneNormalized(t, model), nil, DefaultLimits())
		assertNoTargetErrors(t, againDiagnostics)
		if !reflect.DeepEqual(artifact, again) {
			t.Fatal("identifier fixture is not reproducible")
		}
	})
}

func FuzzGenerationPolicyStatements(f *testing.F) {
	for _, seed := range []string{"dynamodb:GetItem", "dynamodb:PutItem", "*", "iam:PassRole", "bad action"} {
		f.Add(seed)
	}
	f.Fuzz(func(t *testing.T, action string) {
		if len(action) > 128 {
			t.Skip()
		}
		model := minimalLambdaModel("generated-starter")
		role, _ := modelResource(model, "role")
		addPolicy(model, "custom_fuzz_policy", "identity-inline", role, "aws.iam.role-owns-inline-policy", []string{action}, "none", nil, nil, false, nil)
		sortModel(model)
		artifact, diagnostics := renderTerraformArtifact(context.Background(), model, nil, DefaultLimits())
		if artifact == nil {
			if !hasErrorDiagnostics(diagnostics) {
				t.Fatal("policy rejection did not emit an error")
			}
			return
		}
		if action == "*" {
			t.Fatal("wildcard policy action was rendered")
		}
		prompt30AssertNoForbiddenTerraform(t, artifact)
	})
}

func BenchmarkGenerationGoldenSmall(b *testing.B) {
	model := minimalLambdaModel("generated-starter")
	b.ReportAllocs()
	for index := 0; index < b.N; index++ {
		artifact, diagnostics := renderTerraformArtifact(context.Background(), model, nil, DefaultLimits())
		if artifact == nil || hasErrorDiagnostics(diagnostics) {
			b.Fatalf("small render failed: %#v", diagnostics)
		}
	}
}

func BenchmarkGenerationGoldenMedium(b *testing.B) {
	model := authenticatedNotesModel()
	b.ReportAllocs()
	for index := 0; index < b.N; index++ {
		artifact, diagnostics := renderTerraformArtifact(context.Background(), model, nil, DefaultLimits())
		if artifact == nil || hasErrorDiagnostics(diagnostics) {
			b.Fatalf("medium render failed: %#v", diagnostics)
		}
	}
}
