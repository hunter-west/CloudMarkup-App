package compiler

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/hashicorp/hcl/v2"
	"github.com/hashicorp/hcl/v2/hclsyntax"
	"github.com/zclconf/go-cty/cty"
)

func TestS3CORSMethodsAtPublicCompilerBoundary(t *testing.T) {
	sourceBytes, err := os.ReadFile(filepath.Join(eventRepositoryFixtureRoot, "s3-image-metadata", "source.json"))
	if err != nil {
		t.Fatal(err)
	}
	var source struct {
		ArchitectureDocument json.RawMessage `json:"architectureDocument"`
	}
	if err := json.Unmarshal(sourceBytes, &source); err != nil {
		t.Fatal(err)
	}
	for _, target := range []TargetKind{TargetTerraform, TargetCloudFormation} {
		t.Run(string(target), func(t *testing.T) {
			document := decodeMap(t, source.ArchitectureDocument)
			// Construct a fresh current-catalog test request without rewriting the
			// retained repository fixture or admitting a historical catalog.
			document["catalog"] = CatalogReference{ID: TerraformCatalogID, Version: CurrentAwsCatalogVersion, Digest: CurrentAwsCatalogDigest}
			const nodeID = "node_cors_methods"
			const bucketID = "upload_bucket"
			values := map[string]ConfigurationValue{
				"allowedHeaders": stringList("content-type"),
				"allowedMethods": stringList("GET", "HEAD", "PUT", "POST"),
				"allowedOrigins": stringList("https://app.example.invalid"),
				"maxAgeSeconds":  integerValue(300),
			}
			document["nodes"] = append(arrayAt(t, document, "nodes"), map[string]any{
				"id": nodeID,
				"semantic": map[string]any{
					"serviceType": "aws.s3.bucket-cors-configuration", "resourceType": "aws.s3.bucket-cors-configuration", "deploymentKey": "cors_methods",
					"configuration": configuration("aws.s3.bucket-cors-configuration.configuration", values),
					"parent":        map[string]any{"nodeId": bucketID, "relationshipType": "aws.s3.bucket-owns-cors-configuration"},
					"lifecycle":     map[string]any{"origin": "user", "ownership": "user"},
				},
				"presentation": map[string]any{"label": "CORS methods", "position": map[string]any{"x": 0, "y": 0}},
			})
			document["edges"] = append(arrayAt(t, document, "edges"), map[string]any{
				"id": "edge_cors_methods_owner",
				"semantic": map[string]any{
					"relationshipType": "aws.s3.bucket-owns-cors-configuration",
					"source":           map[string]any{"nodeId": nodeID, "port": "aws.s3.bucket-cors-configuration.bucket"},
					"target":           map[string]any{"nodeId": bucketID, "port": "aws.s3.bucket.cors-configuration"},
					"configuration":    configuration("aws.s3.bucket-owns-cors-configuration.connection", map[string]ConfigurationValue{}),
					"lifecycle":        map[string]any{"origin": "user", "ownership": "user"},
				},
			})
			compile := func() CompilationResult {
				return CompileReaders(context.Background(), CompileReaderRequest{Request: ReaderRequest{
					Architecture: bytes.NewReader(encodeMap(t, document)), Target: target,
					Compatibility: DefaultCompatibilityRegistry(), Limits: DefaultLimits(),
				}})
			}
			if positive := compile(); !positive.Succeeded() || positive.Artifact == nil {
				t.Fatalf("all four reviewed CORS methods must produce an artifact: %#v", positive.Diagnostics)
			}
			values["allowedMethods"] = stringList("TRACE")
			negative := compile()
			if negative.Succeeded() || negative.Artifact != nil {
				t.Fatal("catalog-invalid CORS TRACE method returned an artifact")
			}
			code := "TARGET_S3_CORS_METHOD_UNSUPPORTED"
			if target == TargetCloudFormation {
				code = cloudFormationDiagnosticCode(code)
			}
			for _, diagnostic := range negative.Diagnostics {
				if diagnostic.Code == code && diagnostic.Severity == SeverityError && diagnostic.Source.Document == DocumentArchitecture && diagnostic.Source.NodeID == nodeID {
					return
				}
			}
			t.Fatalf("missing exact CORS node diagnostic: %#v", negative.Diagnostics)
		})
	}
}

func s3AccuracyModel() *NormalizedSolution {
	model := eventS3LambdaModel()
	model.Provenance.Catalog = CatalogReference{ID: TerraformCatalogID, Version: CurrentAwsCatalogVersion, Digest: CurrentAwsCatalogDigest}
	return model
}
func s3AccuracyArtifact(model *NormalizedSolution, target string) (*TargetArtifact, []Diagnostic) {
	if target == "terraform" {
		return renderTerraformArtifact(context.Background(), model, nil, DefaultLimits())
	}
	return renderCloudFormationArtifact(context.Background(), model, nil, DefaultLimits())
}
func requireS3Error(t *testing.T, model *NormalizedSolution, target, code string) {
	t.Helper()
	artifact, diagnostics := s3AccuracyArtifact(model, target)
	if artifact != nil {
		t.Fatal("invalid S3 input returned a partial artifact")
	}
	if target == "cloudformation" {
		code = cloudFormationDiagnosticCode(code)
	}
	for _, d := range diagnostics {
		if d.Code == code && d.Severity == SeverityError && d.Source.Document == DocumentArchitecture {
			return
		}
	}
	t.Fatalf("missing S3 error %s: %#v", code, diagnostics)
}
func TestS3AccuracyRejectsInvalidNamesAcrossBothTargets(t *testing.T) {
	for _, name := range []string{"ab", strings.Repeat("a", 64), "Example", "example_bucket", "example..bucket", "192.168.5.4", "999.001.1.2", "xn--example", "sthree-example", "amzn-s3-demo-example", "example-s3alias", "example--ol-s3", "example.mrap", "example--x-s3", "example--table-s3", "example-an", "example\n", "-example", "example-"} {
		for _, target := range []string{"terraform", "cloudformation"} {
			t.Run(name+"/"+target, func(t *testing.T) {
				model := s3AccuracyModel()
				setResourceValue(model, "upload_bucket", "bucketName", stringValueConfig(name))
				requireS3Error(t, model, target, "TARGET_S3_BUCKET_NAME_INVALID")
			})
		}
	}
}
func s3TwoNotifications(prefix, suffix, event string) *NormalizedSolution {
	model := s3AccuracyModel()
	bucket, _ := modelResource(model, "upload_bucket")
	lambda, _ := modelResource(model, "lambda")
	edge := connection("edge_second_notification", "aws.s3.notifies-lambda", bucket, lambda, "aws.s3.notification.connection", map[string]ConfigurationValue{"deliverySemantics": stringValueConfig("AT_LEAST_ONCE_UNORDERED"), "eventType": stringValueConfig(event), "filterPrefix": stringValueConfig(prefix), "filterSuffix": stringValueConfig(suffix)})
	model.Connections = append(model.Connections, edge)
	addPolicy(model, "s3_second_permission", "service-grant", lambda, "aws.lambda.owns-invocation-permission", []string{"lambda:InvokeFunction"}, "service", []string{"s3.amazonaws.com"}, nil, true, []string{edge.ID})
	finalizeEventModel(model)
	return model
}
func TestS3AccuracyChecksNotificationIntersectionsAcrossTargets(t *testing.T) {
	for _, test := range []struct {
		prefix, suffix, event string
		overlap               bool
	}{
		{"incoming/raw/", ".jpg", "OBJECT_CREATED", true}, {"incoming/", "pg", "OBJECT_CREATED", true}, {"", "", "OBJECT_CREATED", true}, {"incoming%2Fraw/", ".jpg", "OBJECT_CREATED", true},
		{"incoming/", ".png", "OBJECT_CREATED", false}, {"logs/", ".jpg", "OBJECT_CREATED", false}, {"incoming/", ".jpg", "OBJECT_REMOVED", false},
	} {
		for _, target := range []string{"terraform", "cloudformation"} {
			t.Run(test.prefix+test.suffix+test.event+target, func(t *testing.T) {
				model := s3TwoNotifications(test.prefix, test.suffix, test.event)
				if test.overlap {
					requireS3Error(t, model, target, "TARGET_S3_NOTIFICATION_FILTERS_OVERLAP")
					return
				}
				artifact, diagnostics := s3AccuracyArtifact(model, target)
				assertNoTargetErrors(t, diagnostics)
				if artifact == nil {
					t.Fatal("valid disjoint filters lost their artifact")
				}
			})
		}
	}
}
func TestS3AccuracyRejectsInvalidEncodingWithoutInferringAFilter(t *testing.T) {
	for _, value := range []string{"*", "%2A", "bad%", "%FF", "raw space", "raw\nnewline", "rawé", strings.Repeat("a", 1025)} {
		for _, target := range []string{"terraform", "cloudformation"} {
			t.Run(target+value, func(t *testing.T) {
				model := s3AccuracyModel()
				mutateConnection(model, "edge_upload_notification", func(edge *NormalizedConnection) { edge.Configuration.Values["filterPrefix"] = stringValueConfig(value) })
				requireS3Error(t, model, target, "TARGET_S3_NOTIFICATION_FILTER_INVALID")
			})
		}
	}
}
func TestS3AccuracyStablePairSources(t *testing.T) {
	model := s3TwoNotifications("incoming/raw/", ".jpg", "OBJECT_CREATED")
	renderer := &terraformRenderer{ctx: context.Background(), model: model}
	renderer.validateS3Accuracy()
	if len(renderer.diagnostics) != 1 || renderer.diagnostics[0].Source.EdgeID != "edge_upload_notification" || len(renderer.diagnostics[0].Related) != 1 || renderer.diagnostics[0].Related[0].EdgeID != "edge_second_notification" {
		t.Fatalf("wrong pair sources: %#v", renderer.diagnostics)
	}
	for left, right := 0, len(model.Connections)-1; left < right; left, right = left+1, right-1 {
		model.Connections[left], model.Connections[right] = model.Connections[right], model.Connections[left]
	}
	repeated := &terraformRenderer{ctx: context.Background(), model: model}
	repeated.validateS3Accuracy()
	if !reflect.DeepEqual(renderer.diagnostics, repeated.diagnostics) {
		t.Fatal("input ordering changed pair diagnostics")
	}
}

func TestS3AccuracyRejectsFabricatedCatalogBindings(t *testing.T) {
	for _, catalog := range []CatalogReference{
		CatalogReference{ID: TerraformCatalogID, Version: "0.16.0", Digest: "sha256:b8ae0f69d0fceae28e631e9036b745d2e8988967daee0a0b217e0da392d704d6"},
		{ID: TerraformCatalogID, Version: CurrentAwsCatalogVersion, Digest: "sha256:b8ae0f69d0fceae28e631e9036b745d2e8988967daee0a0b217e0da392d704d6"},
		{ID: "other", Version: CurrentAwsCatalogVersion, Digest: CurrentAwsCatalogDigest},
	} {
		for _, target := range []string{"terraform", "cloudformation"} {
			model := s3AccuracyModel()
			model.Provenance.Catalog = catalog
			artifact, diagnostics := s3AccuracyArtifact(model, target)
			if artifact != nil || len(diagnostics) == 0 {
				t.Fatal("fabricated catalog binding gained compiler authority")
			}
		}
	}
}

func TestS3AccuracyUsesProviderBooleanForEventBridge(t *testing.T) {
	for _, current := range []bool{true} {
		model := eventImageQueueMetadataModel()
		model.Provenance.Catalog = CatalogReference{ID: TerraformCatalogID, Version: CurrentAwsCatalogVersion, Digest: CurrentAwsCatalogDigest}
		if current {
			model.Provenance.Catalog = CatalogReference{ID: TerraformCatalogID, Version: CurrentAwsCatalogVersion, Digest: CurrentAwsCatalogDigest}
		}
		artifact, diagnostics := s3AccuracyArtifact(model, "terraform")
		assertNoTargetErrors(t, diagnostics)
		if artifact == nil {
			t.Fatal("S3 EventBridge artifact missing")
		}
		found := 0
		for _, file := range artifact.Files {
			if !strings.HasSuffix(file.Path, ".tf") {
				continue
			}
			parsed, parseDiagnostics := hclsyntax.ParseConfig([]byte(file.Content), file.Path, hcl.InitialPos)
			if parseDiagnostics.HasErrors() {
				t.Fatal(parseDiagnostics.Error())
			}
			for _, block := range parsed.Body.(*hclsyntax.Body).Blocks {
				if block.Type != "resource" || len(block.Labels) != 2 || block.Labels[0] != "aws_s3_bucket_notification" {
					continue
				}
				found++
				attribute := block.Body.Attributes["eventbridge"]
				nested := 0
				for _, child := range block.Body.Blocks {
					if child.Type == "eventbridge" {
						nested++
					}
				}
				if current {
					if attribute == nil || nested != 0 {
						t.Fatal("current S3 EventBridge setting must be an attribute, not a block")
					}
					value, errors := attribute.Expr.Value(nil)
					if errors.HasErrors() || !value.RawEquals(cty.True) {
						t.Fatal("current S3 EventBridge setting must be the provider boolean true")
					}
				}
			}
		}
		if found != 1 {
			t.Fatal("S3 notifications must have exactly one owning resource")
		}
	}
}
