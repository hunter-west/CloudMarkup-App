package compiler

import (
	"context"
	"strings"
	"testing"
)

func TestTerraformArtifactInputContractsEmitValidation(t *testing.T) {
	t.Parallel()

	for _, mode := range []string{"generated-starter", "user-provided", "external-artifact"} {
		mode := mode
		t.Run(mode, func(t *testing.T) {
			t.Parallel()
			artifact, diagnostics := renderTerraformArtifact(context.Background(), minimalLambdaModel(mode), nil, DefaultLimits())
			assertNoTargetErrors(t, diagnostics)
			if artifact == nil || len(artifact.ApplicationArtifacts) != 1 {
				t.Fatalf("artifact contract = %#v", artifact)
			}
			for _, variable := range artifact.ApplicationArtifacts[0].Variables {
				if variable.Validation == "" {
					t.Fatalf("artifact variable lacks validation semantics: %#v", variable)
				}
			}
			variables := fileContent(t, artifact, "infrastructure/variables.tf")
			if !strings.Contains(variables, "validation {") || !strings.Contains(variables, "condition") {
				t.Fatalf("Terraform artifact variables lack validation blocks:\n%s", variables)
			}
			if mode != "external-artifact" && !strings.Contains(variables, "absolute machine paths are forbidden") {
				t.Fatalf("relative package contract lacks an absolute-path rejection message:\n%s", variables)
			}
		})
	}
}
func TestPortableArtifactSegmentMatchesApplicationBuildContract(t *testing.T) {
	t.Parallel()

	const hashed = "team_notes-9f1188ffec23328dd65a49bf84617b62550a293a19b563fd9951e90c4d3a987a"
	for input, expected := range map[string]string{
		"workload_notes": "workload_notes",
		"team:notes":     hashed,
	} {
		if actual := portableArtifactSegment(input); actual != expected {
			t.Fatalf("portableArtifactSegment(%q) = %q, want %q", input, actual, expected)
		}
	}
	if actual := safeRelativePackagePath("team:notes"); actual != "../application/artifacts/"+hashed+"/function.zip" {
		t.Fatalf("safeRelativePackagePath() = %q", actual)
	}
}

func TestTerraformSensitiveArchitectureOutputIsPreserved(t *testing.T) {
	t.Parallel()

	model := authenticatedNotesModel()
	lambda := referenceForID(t, model.Resources, "lambda")
	lambda.Attribute = "arn"
	model.Outputs = []NormalizedOutput{{
		ID: "output_function_arn", Key: "function_arn", Kind: "node-attribute", Sensitive: true, Resource: &lambda,
	}}
	artifact, diagnostics := renderTerraformArtifact(context.Background(), model, nil, DefaultLimits())
	assertNoTargetErrors(t, diagnostics)
	outputs := fileContent(t, artifact, "infrastructure/outputs.tf")
	if !strings.Contains(outputs, "sensitive   = true") {
		t.Fatalf("sensitive output marker was not rendered:\n%s", outputs)
	}

	document := decodeMap(t, representativeDocument(t))
	document["outputs"] = []any{map[string]any{
		"id": "output_source_arn", "key": "source_arn", "valueType": "string", "sensitive": true,
		"source": map[string]any{"kind": "node-attribute", "nodeId": "node_source", "attribute": "aws.test.source.arn"},
	}}
	normalized := Normalize(context.Background(), Request{Architecture: encodeMap(t, document), Target: TargetTerraform})
	if !normalized.Succeeded() || normalized.Model == nil || len(normalized.Model.Outputs) != 1 || !normalized.Model.Outputs[0].Sensitive {
		t.Fatalf("normalized sensitive output = %#v; diagnostics = %#v", normalized.Model, normalized.Diagnostics)
	}
}

func referenceForID(t *testing.T, resources []NormalizedResource, id string) ResourceReference {
	t.Helper()
	for _, resource := range resources {
		if resource.ID == id {
			return reference(resource)
		}
	}
	t.Fatalf("resource %q not found", id)
	return ResourceReference{}
}
