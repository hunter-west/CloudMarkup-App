package compiler

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"reflect"
	"testing"
)

// Synthetic current-catalog graph created through domain commands and the real
// provider resolver. It contains no customer architecture or execution evidence.
func httpNoContentDocument(t *testing.T) map[string]any {
	t.Helper()
	raw, err := os.ReadFile("testdata/http-no-content-v1/architecture.json")
	if err != nil {
		t.Fatal(err)
	}
	return decodeMap(t, raw)
}

func httpNoContentTool() ToolReference {
	return ToolReference{ID: HttpNoContentGeneratorID, Version: HttpNoContentGeneratorVersion, Digest: HttpNoContentGeneratorDigest}
}

func TestHttpNoContentNativeGraphAndWireContract(t *testing.T) {
	for _, target := range []TargetKind{TargetTerraform, TargetCloudFormation} {
		t.Run(string(target), func(t *testing.T) {
			architecture := encodeMap(t, httpNoContentDocument(t))
			tool := httpNoContentTool()
			request := CompileRequest{Request: Request{Architecture: architecture, SolutionRevision: httpNoContentManifest(t, architecture, &tool), Target: target}}
			result := Compile(context.Background(), request)
			if !result.Succeeded() || result.Artifact == nil {
				t.Fatalf("native graph rejected: %#v", result.Diagnostics)
			}
			if !reflect.DeepEqual(result, Compile(context.Background(), request)) {
				t.Fatal("native result is not reproducible")
			}
			encoded, err := json.Marshal(result.Model)
			if err != nil {
				t.Fatal(err)
			}
			for _, property := range []string{"workloadIds", "dependentNodeIds", "dependentEdgeIds"} {
				if bytes.Contains(encoded, []byte(`"`+property+`":null`)) {
					t.Fatalf("%s must be an array at the wire boundary", property)
				}
			}
			readiness := result.Model.Workloads[0].GeneratorReadiness
			if readiness.State != "compatible-interface-only" || readiness.TemplateID != HttpNoContentTemplateID {
				t.Fatalf("wrong readiness: %#v", readiness)
			}
			for _, artifact := range result.Artifact.ApplicationArtifacts {
				if artifact.ArtifactReadiness != "application-artifact-evidence-incomplete" {
					t.Fatal("compilation must not claim application execution")
				}
			}
		})
	}
}

func TestHttpNoContentExactCompatibilityAndPermissionBoundary(t *testing.T) {
	for _, mutation := range []string{"catalog", "mode", "generator-digest", "template", "pattern", "compiler-predecessor", "other-scope", "extra-action", "other-principal", "extra-expression", "missing-provenance"} {
		t.Run(mutation, func(t *testing.T) {
			document := httpNoContentDocument(t)
			tool := httpNoContentTool()
			workload := arrayAt(t, objectAt(t, document, "workloadBehavior"), "workloads")[0].(map[string]any)
			code := ""
			switch mutation {
			case "catalog":
				document["catalog"] = map[string]any{"id": CloudFormationCatalogID, "version": "0.16.0", "digest": "sha256:b8ae0f69d0fceae28e631e9036b745d2e8988967daee0a0b217e0da392d704d6"}
				code = "COMPAT_GENERATOR_CATALOG_MISMATCH"
			case "mode":
				implementation := objectAt(t, workload, "implementation")
				implementation["mode"] = "generated-starter"
				delete(implementation, "supportedPattern")
				declaration := arrayAt(t, objectAt(t, workload, "compatibility"), "applicationGenerators")[0].(map[string]any)
				declaration["supportedModes"] = []any{"generated-starter"}
				code = "COMPAT_WORKLOAD_GENERATOR_MISMATCH"
			case "generator-digest":
				tool.Digest = digestOf('f')
				code = "COMPAT_GENERATOR_UNAVAILABLE"
			case "template":
				declaration := arrayAt(t, objectAt(t, workload, "compatibility"), "applicationGenerators")[0].(map[string]any)
				declaration["templateId"] = "unreviewed.template"
				code = "COMPAT_WORKLOAD_GENERATOR_MISMATCH"
			case "pattern":
				objectAt(t, objectAt(t, workload, "implementation"), "supportedPattern")["digest"] = digestOf('f')
				code = "COMPAT_WORKLOAD_PATTERN_MISMATCH"
			case "compiler-predecessor":
				code = "COMPAT_SOLUTION_COMPILER_MISMATCH"
			default:
				foundStatement := false
				for _, value := range arrayAt(t, document, "nodes") {
					node := value.(map[string]any)
					if node["id"] != "operation_no_content_00027.node.lambda-service-grant" {
						continue
					}
					foundStatement = true
					semantic := objectAt(t, node, "semantic")
					values := objectAt(t, objectAt(t, semantic, "configuration"), "values")
					switch mutation {
					case "other-scope":
						objectAt(t, values, "resourceNode")["nodeId"] = "node_apigateway_http_api"
					case "extra-action":
						values["actions"] = map[string]any{"kind": "string-list", "value": []any{"lambda:InvokeFunction", "dynamodb:GetItem"}}
					case "other-principal":
						values["principals"] = map[string]any{"kind": "string-list", "value": []any{"events.amazonaws.com"}}
					case "extra-expression":
						values["resourceExpressions"] = map[string]any{"kind": "string-list", "value": []any{"arn:aws:lambda:us-east-1:000000000000:function:synthetic-other"}}
					case "missing-provenance":
						objectAt(t, objectAt(t, semantic, "lifecycle"), "provenance")["dependentEdgeIds"] = []any{}
					}
				}
				if !foundStatement {
					t.Fatal("missing synthetic API invocation grant statement")
				}
			}
			architecture := encodeMap(t, document)
			manifest := httpNoContentManifest(t, architecture, &tool)
			if mutation == "compiler-predecessor" {
				decoded := decodeMap(t, manifest)
				pinned := objectAt(t, objectAt(t, objectAt(t, decoded, "versions"), "compiler"), "tool")
				pinned["version"] = "1.1.1"
				pinned["digest"] = "sha256:f96727098c5ee8b3e3e436c242c01847d39abd76322ea3883865a4c6dd3ed3fe"
				manifest = encodeMap(t, decoded)
			}
			for _, target := range []TargetKind{TargetTerraform, TargetCloudFormation} {
				result := Compile(context.Background(), CompileRequest{Request: Request{Architecture: architecture, SolutionRevision: manifest, Target: target}})
				if result.Succeeded() || result.Artifact != nil {
					t.Fatalf("%s accepted %s", target, mutation)
				}
				if code != "" && !hasDiagnostic(result.Diagnostics, code) {
					t.Fatalf("%s lacks %s: %#v", target, code, result.Diagnostics)
				}
				if code == "" {
					foundProvenance, foundCoverage := false, false
					for _, diagnostic := range result.Diagnostics {
						if diagnostic.Severity != SeverityError || diagnostic.Source.Document != DocumentArchitecture {
							continue
						}
						foundProvenance = foundProvenance || diagnostic.Code == "TARGET_GENERATED_POLICY_PROVENANCE_INVALID" && diagnostic.Source.NodeID == "operation_no_content_00027.node.lambda-service-grant-document"
						foundCoverage = foundCoverage || diagnostic.Code == "TARGET_GENERATED_POLICY_COVERAGE_MISSING" && diagnostic.Source.EdgeID == "operation_no_content_00027.edge.connection"
					}
					if !foundProvenance || !foundCoverage {
						t.Fatalf("%s lacks exact API grant provenance or trigger coverage refusal for %s: %#v", target, mutation, result.Diagnostics)
					}
				}
			}
		})
	}
}

func TestHttpNoContentDescriptorDigests(t *testing.T) {
	template := map[string]any{
		"contractVersion": 1, "id": HttpNoContentTemplateID, "version": HttpNoContentTemplateVersion,
		"capability": "application.http.authenticated-no-content", "method": "GET", "successStatus": 204,
		"requestBody": "none", "responseBody": "none", "authentication": "managed-api-gateway-jwt-and-exact-auth-contract",
		"persistentData": "none", "network": "none", "runtime": "nodejs24.x", "language": "typescript",
		"tests": []string{"authenticated-no-content", "missing-authorizer-denied", "unknown-route-denied"},
	}
	if canonicalDescriptorDigest(t, template) != HttpNoContentTemplateDigest {
		t.Fatal("template descriptor drift")
	}
	templateReference := map[string]any{"id": HttpNoContentTemplateID, "version": HttpNoContentTemplateVersion, "digest": HttpNoContentTemplateDigest}
	pattern := map[string]any{"contractVersion": 1, "template": templateReference, "behavior": "application.http.authenticated-no-content"}
	if canonicalDescriptorDigest(t, pattern) != HttpNoContentPatternDigest {
		t.Fatal("pattern descriptor drift")
	}
	patternReference := map[string]any{"id": HttpNoContentPatternID, "version": HttpNoContentPatternVersion, "digest": HttpNoContentPatternDigest}
	generator := map[string]any{"contractVersion": 1, "version": HttpNoContentGeneratorVersion, "templates": []any{templateReference}, "patterns": []any{patternReference}}
	if canonicalDescriptorDigest(t, generator) != HttpNoContentGeneratorDigest {
		t.Fatal("generator descriptor drift")
	}
}

func httpNoContentManifest(t *testing.T, architecture []byte, tool *ToolReference) []byte {
	t.Helper()
	manifest := decodeMap(t, validSolutionManifest(t, architecture, tool))
	// No source/build evidence has been produced at this compiler-only boundary.
	objectAt(t, manifest, "generationCoverage")["workloads"] = []any{}
	return encodeMap(t, manifest)
}

func TestCurrentCatalogHttpNoContentArtifactContract(t *testing.T) {
	for _, target := range []TargetKind{TargetTerraform, TargetCloudFormation} {
		t.Run(string(target), func(t *testing.T) {
			document := httpNoContentDocument(t)
			document["catalog"] = map[string]any{"id": CloudFormationCatalogID, "version": CurrentAwsCatalogVersion, "digest": CurrentAwsCatalogDigest}
			architecture := encodeMap(t, document)
			tool := httpNoContentTool()
			request := CompileRequest{Request: Request{Architecture: architecture, SolutionRevision: httpNoContentManifest(t, architecture, &tool), Target: target}}
			result := Compile(context.Background(), request)
			if !result.Succeeded() || result.Artifact == nil || len(result.Artifact.ApplicationArtifacts) != 1 {
				t.Fatalf("current catalog compilation failed: %#v", result.Diagnostics)
			}
			artifact := result.Artifact.ApplicationArtifacts[0]
			if artifact.ContractVersion != ApplicationArtifactTargetNeutralContractVersion || artifact.ExpectedArtifact == nil || artifact.ArtifactReadiness != "application-artifact-evidence-incomplete" {
				t.Fatalf("current catalog lost its exact, unbuilt artifact contract: %#v", artifact)
			}
			if !reflect.DeepEqual(result, Compile(context.Background(), request)) {
				t.Fatal("current catalog compilation is not reproducible")
			}
		})
	}
}
