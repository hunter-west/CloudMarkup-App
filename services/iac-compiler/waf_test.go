package compiler

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func wafRequest(t *testing.T) CompileRequest {
	t.Helper()
	input, err := os.ReadFile("../../packages/provider-aws/fixtures/waf-v1/public-alb-count.json")
	if err != nil {
		t.Fatal(err)
	}
	binding := DefaultCompatibilityRegistry().Catalogs[0]
	return CompileRequest{Request: Request{Architecture: input, Target: TargetCloudFormation, Compatibility: CompatibilityRegistry{Catalogs: []CatalogCompatibility{binding}}}}
}
func wafTemplate(t *testing.T, result CompilationResult) cloudFormationTemplate {
	t.Helper()
	if !result.Succeeded() || result.Artifact == nil {
		t.Fatal(result.Diagnostics)
	}
	var template cloudFormationTemplate
	for _, f := range result.Artifact.Files {
		if f.Path == cloudFormationTemplatePath {
			if err := json.Unmarshal([]byte(f.Content), &template); err != nil {
				t.Fatal(err)
			}
			return template
		}
	}
	t.Fatal("missing actual CloudFormation template")
	return template
}
func TestWafActualCompileAndGolden(t *testing.T) {
	// Keep the independent compiler's closed field schema aligned with the
	// authoritative generated catalog, rather than trusting a stale copied file.
	catalogBytes, err := os.ReadFile("../../packages/provider-aws/src/compiled/catalog-v1.json")
	if err != nil {
		t.Fatal(err)
	}
	var catalog struct {
		Services []struct {
			ID            string `json:"id"`
			Configuration struct {
				JSONSchema struct {
					Properties map[string]any `json:"properties"`
				} `json:"jsonSchema"`
			} `json:"configuration"`
		} `json:"services"`
	}
	if err := json.Unmarshal(catalogBytes, &catalog); err != nil {
		t.Fatal(err)
	}
	var localFields map[string]any
	if err := json.Unmarshal(wafConfigurationJSON, &localFields); err != nil {
		t.Fatal(err)
	}
	matched := false
	for _, service := range catalog.Services {
		if service.ID == serviceWaf {
			matched = true
			if !reflect.DeepEqual(service.Configuration.JSONSchema.Properties, localFields) {
				t.Fatal("WAF compiler fields drifted from current catalog")
			}
		}
	}
	if !matched {
		t.Fatal("current catalog omits WAF schema")
	}
	request := wafRequest(t)
	result := Compile(context.Background(), request)
	template := wafTemplate(t, result)
	wafResources := map[string]cloudFormationResource{}
	var aclID, albID string
	for id, r := range template.Resources {
		if r.Type == "AWS::WAFv2::WebACL" {
			aclID = id
			wafResources[id] = r
		}
		if r.Type == "AWS::WAFv2::WebACLAssociation" {
			wafResources[id] = r
		}
		if r.Type == "AWS::ElasticLoadBalancingV2::LoadBalancer" {
			albID = id
		}
		if r.Type == "AWS::WAFv2::LoggingConfiguration" {
			t.Fatal("logging was not requested")
		}
	}
	if len(wafResources) != 2 || aclID == "" || albID == "" {
		t.Fatal("missing native WebACL, association or existing ALB")
	}
	for _, r := range wafResources {
		if r.Type == "AWS::WAFv2::WebACLAssociation" {
			if !reflect.DeepEqual(r.Properties["WebACLArn"], cloudFormationGetAtt(aclID, "Arn")) || !reflect.DeepEqual(r.Properties["ResourceArn"], cloudFormationRef(albID)) {
				t.Fatal("incorrect native ARN association")
			}
			if r.DeletionPolicy != "" {
				t.Fatal("association removal must follow explicit graph intent")
			}
		}
	}
	actual, err := json.MarshalIndent(wafResources, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join("testdata", "waf-goldens-v1", "count.json")
	if os.Getenv("CLOUDMARKUP_UPDATE_WAF_GOLDEN") == "1" {
		if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, append(actual, '\n'), 0600); err != nil {
			t.Fatal(err)
		}
	}
	for _, file := range result.Artifact.Files {
		if file.Path != cloudFormationTemplatePath {
			continue
		}
		exportPath := "../../packages/provider-aws/fixtures/waf-v1/actual-cloudformation.json"
		if os.Getenv("CLOUDMARKUP_UPDATE_WAF_GOLDEN") == "1" {
			if err := os.WriteFile(exportPath, []byte(file.Content), 0600); err != nil {
				t.Fatal(err)
			}
		}
		saved, err := os.ReadFile(exportPath)
		if err != nil || strings.TrimSpace(string(saved)) != strings.TrimSpace(file.Content) {
			t.Fatal("full synthetic ALB/WAF export drift")
		}
	}
	expected, err := os.ReadFile(path)
	if err != nil || strings.TrimSpace(string(expected)) != string(actual) {
		t.Fatal("regional WAF golden drift")
	}
	if !reflect.DeepEqual(result, Compile(context.Background(), request)) {
		t.Fatal("repeated actual compile drift")
	}
	// Canonical resource/connection ordering and visual layout must not affect bytes.
	document := decodeMap(t, request.Request.Architecture)
	for _, key := range []string{"nodes", "edges"} {
		xs := document[key].([]any)
		for i, j := 0, len(xs)-1; i < j; i, j = i+1, j-1 {
			xs[i], xs[j] = xs[j], xs[i]
		}
	}
	for _, raw := range document["nodes"].([]any) {
		raw.(map[string]any)["presentation"].(map[string]any)["position"] = map[string]any{"x": 123, "y": 456}
	}
	request.Request.Architecture, _ = json.Marshal(document)
	again := Compile(context.Background(), request)
	reordered := wafTemplate(t, again)
	// Export receipts truthfully track changed visual/source provenance. Native
	// infrastructure intent remains identical across layout and ordering changes.
	if !reflect.DeepEqual(template.Resources, reordered.Resources) || !reflect.DeepEqual(template.Parameters, reordered.Parameters) || !reflect.DeepEqual(template.Outputs, reordered.Outputs) {
		t.Fatal("layout/order changed infrastructure intent", again.Diagnostics)
	}
}
func TestWafEnforcementAndOrderedPriorities(t *testing.T) {
	request := wafRequest(t)
	d := decodeMap(t, request.Request.Architecture)
	for _, raw := range d["nodes"].([]any) {
		n := raw.(map[string]any)
		if n["id"] != "web_waf" {
			continue
		}
		v := n["semantic"].(map[string]any)["configuration"].(map[string]any)["values"].(map[string]any)
		v["managedRuleMode"] = map[string]any{"kind": "string", "value": "enforce"}
		v["rateAction"] = map[string]any{"kind": "string", "value": "block"}
		v["ratePriority"] = map[string]any{"kind": "integer", "value": 20}
	}
	request.Request.Architecture, _ = json.Marshal(d)
	template := wafTemplate(t, Compile(context.Background(), request))
	for _, r := range template.Resources {
		if r.Type != "AWS::WAFv2::WebACL" {
			continue
		}
		rules := r.Properties["Rules"].([]any)
		first, second := rules[0].(map[string]any), rules[1].(map[string]any)
		if first["Priority"] != float64(10) || second["Priority"] != float64(20) {
			t.Fatal("priority order lost")
		}
		if _, ok := first["OverrideAction"].(map[string]any)["None"]; !ok {
			t.Fatal("managed actions must be retained")
		}
		if _, ok := second["Action"].(map[string]any)["Block"]; !ok {
			t.Fatal("rate block action missing")
		}
	}
}
func TestWafTargetAndCatalogBoundary(t *testing.T) {
	request := wafRequest(t)
	request.Request.Compatibility = CompatibilityRegistry{}
	if result := Compile(context.Background(), request); !result.Succeeded() {
		t.Fatal("current WAF catalog rejected", result.Diagnostics)
	}
	request.Request.Target = TargetTerraform
	if result := Compile(context.Background(), request); result.Succeeded() || result.Artifact != nil {
		t.Fatal("unsupported Terraform WAF path activated")
	}
	request = wafRequest(t)
	request.Request.Compatibility.Catalogs[0].Digest = "sha256:0000000000000000000000000000000000000000000000000000000000000000"
	if result := Compile(context.Background(), request); result.Succeeded() || result.Artifact != nil {
		t.Fatal("wrong catalog digest admitted")
	}
}
func TestWafNegativeConfiguration(t *testing.T) {
	// The candidate deliberately does not confer readiness on other inherited
	// catalog services, even when an explicit registry is provided.
	for _, entry := range []struct {
		key, kind string
		value     any
	}{
		{"scope", "string", "CLOUDFRONT"}, {"webAclRegion", "string", "eu-west-1"}, {"rateLimit", "integer", 9}, {"rateLimit", "integer", 2000000001}, {"rateWindowSeconds", "integer", 90}, {"ratePriority", "integer", 10}, {"managedRuleGroup", "string", "AWSManagedRulesBotControlRuleSet"}, {"requestLogging", "string", "enabled"}, {"sampledRequestsEnabled", "boolean", true}, {"defaultAction", "string", "block"}, {"unreviewed", "string", "raw-property"},
	} {
		t.Run(entry.key+"/"+entry.kind, func(t *testing.T) {
			request := wafRequest(t)
			d := decodeMap(t, request.Request.Architecture)
			for _, raw := range d["nodes"].([]any) {
				n := raw.(map[string]any)
				if n["id"] == "web_waf" {
					n["semantic"].(map[string]any)["configuration"].(map[string]any)["values"].(map[string]any)[entry.key] = map[string]any{"kind": entry.kind, "value": entry.value}
				}
			}
			request.Request.Architecture, _ = json.Marshal(d)
			result := Compile(context.Background(), request)
			if result.Succeeded() || result.Artifact != nil {
				t.Fatal("invalid WAF configuration exported")
			}
		})
	}
}
func TestWafNegativeAssociations(t *testing.T) {
	for _, mode := range []string{"missing-owner", "missing-alb", "duplicate-alb", "wrong-port", "wrong-parent", "non-alb", "wrong-provenance"} {
		t.Run(mode, func(t *testing.T) {
			request := wafRequest(t)
			d := decodeMap(t, request.Request.Architecture)
			edges := []any{}
			for _, raw := range d["edges"].([]any) {
				e := raw.(map[string]any)
				s := e["semantic"].(map[string]any)
				rel := s["relationshipType"]
				if mode == "missing-owner" && rel == wafOwner || mode == "missing-alb" && rel == wafProtects {
					continue
				}
				if rel == wafProtects {
					if mode == "wrong-port" {
						s["target"].(map[string]any)["port"] = "aws.elb.application-load-balancer.listener"
					}
					if mode == "non-alb" {
						s["target"] = map[string]any{"nodeId": "certificate", "port": "aws.acm.public-dns-certificate.alb-listener"}
					}
					if mode == "wrong-provenance" {
						s["lifecycle"].(map[string]any)["provenance"].(map[string]any)["generatorId"] = "aws.elb.alb-uses-vpc"
					}
					if mode == "duplicate-alb" {
						copy := map[string]any{"id": "duplicate_waf", "semantic": s}
						edges = append(edges, copy)
					}
				}
				edges = append(edges, e)
			}
			d["edges"] = edges
			if mode == "wrong-parent" {
				for _, raw := range d["nodes"].([]any) {
					n := raw.(map[string]any)
					if n["id"] == "waf_alb" {
						n["semantic"].(map[string]any)["parent"] = map[string]any{"nodeId": "vpc", "relationshipType": wafOwner}
					}
				}
			}
			request.Request.Architecture, _ = json.Marshal(d)
			if result := Compile(context.Background(), request); result.Succeeded() || result.Artifact != nil {
				t.Fatal("invalid association exported")
			}
		})
	}
}
