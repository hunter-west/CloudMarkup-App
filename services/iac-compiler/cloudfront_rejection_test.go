package compiler

import (
	"strings"
	"testing"
)

func TestCloudfrontRuleOwnedBindings(t *testing.T) {
	for _, target := range []string{"terraform", "cloudformation"} {
		base := cloudfrontModel(true)
		for i := range base.Connections {
			e := &base.Connections[i]
			if _, ok := cloudfrontContracts[e.RelationshipType]; ok {
				e.Lifecycle = Lifecycle{Ownership: "generated", Origin: "connection-rule", Provenance: &GeneratedProvenance{GeneratorKind: "connection-rule", GeneratorID: e.RelationshipType, GeneratorVersion: "1.0.0", OperationID: "operation_cloudfront_origin", DependentNodeIDs: []string{e.Source.NodeID, e.Target.NodeID}, DependentEdgeIDs: []string{}}}
			}
		}
		a, d := kmsArtifact(base, target)
		assertNoTargetErrors(t, d)
		if a == nil {
			t.Fatal("missing explicit rule-owned export")
		}
		for rel := range cloudfrontContracts {
			for _, mode := range []string{"wrong-rule", "wrong-version", "missing-dependency", "extra-edge", "wrong-operation", "adopted"} {
				if rel != cloudfrontOrigin && mode != "wrong-rule" {
					continue
				}
				t.Run(target+"/"+rel+"/"+mode, func(t *testing.T) {
					m := cloneNormalized(t, base)
					for i := range m.Connections {
						e := &m.Connections[i]
						if e.RelationshipType != rel {
							continue
						}
						switch mode {
						case "wrong-rule":
							e.Lifecycle.Provenance.GeneratorID = "aws.cloudfront.unreviewed"
						case "wrong-version":
							e.Lifecycle.Provenance.GeneratorVersion = "9.0.0"
						case "missing-dependency":
							e.Lifecycle.Provenance.DependentNodeIDs = []string{e.Source.NodeID}
						case "extra-edge":
							e.Lifecycle.Provenance.DependentEdgeIDs = []string{"certificate_zone"}
						case "wrong-operation":
							e.Lifecycle.Provenance.OperationID = "operation_other"
						case "adopted":
							e.Lifecycle.Ownership = "adopted"
						}
					}
					a, d := kmsArtifact(m, target)
					if a != nil || !ecsHasErrors(d) {
						t.Fatalf("unsupported binding exported: %v", d)
					}
				})
			}
		}
	}
}

func TestCloudfrontEveryFieldAndOwnershipFailsClosed(t *testing.T) {
	base := cloudfrontModel(true)
	for _, target := range []string{"terraform", "cloudformation"} {
		a, d := kmsArtifact(base, target)
		assertNoTargetErrors(t, d)
		if a == nil {
			t.Fatalf("%s missing valid baseline", target)
		}
	}
	for _, tc := range []struct {
		nodeID, key, mode, code string
	}{
		{"distribution", "", "unknown-field", "TARGET_CONFIGURATION_UNSUPPORTED"},
		{"static_cache", "", "wrong-schema", "TARGET_CONFIGURATION_UNSUPPORTED"},
		{"viewer_alias", "", "generated-owner", "TARGET_CLOUDFRONT_OWNERSHIP_INVALID"},
		{"distribution", "", "adopted-owner", "TARGET_CLOUDFRONT_OWNERSHIP_INVALID"},
		{"static_cache", "", "imported-owner", "TARGET_CLOUDFRONT_EXTERNAL_UNSUPPORTED"},
		{"distribution", "enabled", "missing", "TARGET_CONFIGURATION_UNSUPPORTED"},
		{"viewer_alias", "retain", "missing", "TARGET_CONFIGURATION_UNSUPPORTED"},
		{"distribution", "defaultRootObject", "wrong-kind", "TARGET_DNS_FIELD_INVALID"},
		{"distribution", "enabled", "wrong-kind", "TARGET_DNS_FIELD_INVALID"},
		{"static_cache", "name", "wrong-kind", "TARGET_DNS_FIELD_INVALID"},
		{"static_cache", "defaultTtl", "wrong-kind", "TARGET_DNS_FIELD_INVALID"},
		{"static_cache", "forwardViewerCookies", "wrong-kind", "TARGET_DNS_FIELD_INVALID"},
		{"viewer_alias", "domainName", "wrong-kind", "TARGET_DNS_FIELD_INVALID"},
		{"viewer_alias", "retain", "wrong-kind", "TARGET_DNS_FIELD_INVALID"},
	} {
		n, ok := modelResource(base, tc.nodeID)
		if !ok {
			t.Fatalf("missing fixture node %s", tc.nodeID)
		}
		name := n.ServiceType + "/" + tc.mode
		if tc.key != "" {
			name = n.ServiceType + "/" + tc.key + "/" + tc.mode
		}
		t.Run(name, func(t *testing.T) {
			for _, target := range []string{"terraform", "cloudformation"} {
				m := cloneNormalized(t, base)
				var mutated *NormalizedResource
				for i := range m.Resources {
					if m.Resources[i].ID == tc.nodeID {
						mutated = &m.Resources[i]
						break
					}
				}
				if mutated == nil {
					t.Fatalf("missing mutable fixture node %s", tc.nodeID)
				}
				beforeKeys := len(mutated.Configuration.Values)
				switch tc.mode {
				case "unknown-field":
					mutated.Configuration.Values["unreviewed"] = stringValueConfig("unsupported")
				case "wrong-schema":
					mutated.Configuration.SchemaVersion = "9.0.0"
				case "generated-owner":
					if mutated.Lifecycle.Origin != "user" {
						t.Fatal("generated ownership mutation requires user origin")
					}
					mutated.Lifecycle.Ownership = "generated"
				case "adopted-owner":
					mutated.Lifecycle.Ownership = "adopted"
				case "imported-owner":
					m.ExternalResources = append(m.ExternalResources, NormalizedExternalResource{ID: "external", OwnershipState: "managed-by-generated-iac", ArchitectureNodes: []ResourceReference{reference(*mutated)}})
				case "missing":
					delete(mutated.Configuration.Values, tc.key)
					if tc.nodeID == "viewer_alias" && tc.key == "retain" {
						mutated.Configuration.Values["unreviewed"] = stringValueConfig("unsupported")
						if len(mutated.Configuration.Values) != beforeKeys {
							t.Fatal("key-set mutation must preserve cardinality")
						}
					}
				case "wrong-kind":
					mutated.Configuration.Values[tc.key] = ConfigurationValue{Kind: "node-reference", NodeID: "repository", Attribute: serviceEcrRepository + ".arn"}
				default:
					t.Fatalf("unknown mutation %s", tc.mode)
				}
				a, d := kmsArtifact(m, target)
				code, path := tc.code, ""
				if target == "cloudformation" {
					code = "CLOUDFORMATION_" + strings.TrimPrefix(code, "TARGET_")
				}
				if tc.mode == "wrong-kind" {
					path = "$.semantic.configuration.values." + tc.key
				}
				found := false
				for _, diagnostic := range d {
					if diagnostic.Code == code && diagnostic.Severity == SeverityError && diagnostic.Source.Document == DocumentArchitecture && diagnostic.Source.NodeID == tc.nodeID && diagnostic.Source.Path == path {
						found = true
					}
				}
				if a != nil || !found {
					t.Fatalf("%s missing %s refusal for %s%s: %v", target, code, tc.nodeID, path, d)
				}
			}
		})
	}
}

func TestCloudfrontEveryBindingFailsClosed(t *testing.T) {
	refusals := map[string]string{
		"wrong-port": "BINDING_INVALID", "wrong-schema": "CONFIGURATION_INVALID",
		"unknown-field": "CONFIGURATION_INVALID", "duplicate": "CARDINALITY_INVALID", "missing-endpoint": "INVALID",
	}
	for rel := range cloudfrontContracts {
		for _, mode := range []string{"wrong-port", "wrong-schema", "unknown-field", "duplicate", "missing-endpoint"} {
			// Schema version and empty configuration share one scalar guard across this family.
			if (mode == "wrong-schema" || mode == "unknown-field") && rel != cloudfrontOrigin {
				continue
			}
			t.Run(rel+"/"+mode, func(t *testing.T) {
				for _, target := range []string{"terraform", "cloudformation"} {
					m := cloudfrontModel(true)
					edgeID := ""
					for i := range m.Connections {
						e := &m.Connections[i]
						if e.RelationshipType != rel {
							continue
						}
						edgeID = e.ID
						switch mode {
						case "wrong-port":
							e.Source.Port = "aws.rds.unreviewed"
						case "wrong-schema":
							e.Configuration.SchemaVersion = "9.0.0"
						case "unknown-field":
							e.Configuration.Values["unreviewed"] = stringValueConfig("unsupported")
						case "duplicate":
							copy := *e
							copy.ID = "duplicate"
							m.Connections = append(m.Connections, copy)
						case "missing-endpoint":
							e.Target.NodeID = "unavailable"
						}
						break
					}
					if edgeID == "" {
						t.Fatalf("missing fixture relationship %s", rel)
					}
					sortModel(m)
					a, d := kmsArtifact(m, target)
					if a != nil {
						t.Fatalf("%s accepted %s: %v", target, mode, d)
					}
					prefix := "TARGET_"
					if target == "cloudformation" {
						prefix = "CLOUDFORMATION_"
					}
					codes := []string{prefix + "NETWORK_RELATIONSHIP_" + refusals[mode]}
					if mode == "wrong-schema" || mode == "unknown-field" {
						codes = append(codes, prefix+"CLOUDFRONT_BINDING_INVALID")
					}
					for _, code := range codes {
						found := false
						for _, diagnostic := range d {
							if diagnostic.Code == code && diagnostic.Severity == SeverityError && diagnostic.Source.Document == DocumentArchitecture && diagnostic.Source.EdgeID == edgeID {
								found = true
							}
						}
						if !found {
							t.Fatalf("%s missing %s for mutated edge %s: %v", target, code, edgeID, d)
						}
					}
				}
			})
		}
	}
}

func TestCloudfrontUserOriginsPreserveNativeBytes(t *testing.T) {
	for _, target := range []string{"terraform", "cloudformation"} {
		baseline, d := kmsArtifact(cloudfrontModel(true), target)
		assertNoTargetErrors(t, d)
		path := "infrastructure/cloudfront.tf"
		if target == "cloudformation" {
			path = cloudFormationTemplatePath
		}
		want := fileContent(t, baseline, path)
		for _, origin := range []string{"template", "ai-accepted", "migration"} {
			t.Run(target+"/"+origin, func(t *testing.T) {
				m := cloudfrontModel(true)
				for i := range m.Resources {
					if _, ok := cloudfrontSchemas[m.Resources[i].ServiceType]; ok {
						m.Resources[i].Lifecycle.Origin = origin
					}
				}
				a, d := kmsArtifact(m, target)
				assertNoTargetErrors(t, d)
				if fileContent(t, a, path) != want {
					t.Fatal("creation origin changed deployment meaning")
				}
			})
		}
	}
}

func TestCloudfrontExternalDependencyRejected(t *testing.T) {
	for _, id := range []string{"origin", "distribution", "static_cache", "viewer_alias", "certificate"} {
		for _, target := range []string{"terraform", "cloudformation"} {
			t.Run(id+"/"+target, func(t *testing.T) {
				m := cloudfrontModel(true)
				n, ok := modelResource(m, id)
				if !ok {
					t.Fatal("Missing bounded dependency " + id)
				}
				external := externalTable("existing-cloud-managed-elsewhere")
				external.ID = "external_bounded_resource"
				external.ResourceType = n.ResourceType
				external.ArchitectureNodes = []ResourceReference{reference(n)}
				external.Addresses = []ExternalResourceAddress{{ID: "external_id", Kind: "provider-resource-id", Value: "synthetic-existing-resource"}}
				external.Targets = []ExternalResourceTarget{{Target: TargetKind(target), Readiness: "reference-ready", MappingID: n.ServiceType + "." + target, MappingVersion: "1.0.0"}}
				m.ExternalResources = append(m.ExternalResources, external)
				a, d := kmsArtifact(m, target)
				if a != nil || !ecsHasErrors(d) {
					t.Fatalf("%s accepted external %s: %v", target, id, d)
				}
				wantCode := "TARGET_CLOUDFRONT_EXTERNAL_UNSUPPORTED"
				if id == "origin" {
					wantCode = "TARGET_CLOUDFRONT_PRIVATE_ORIGIN_INVALID"
				}
				if id == "certificate" {
					wantCode = "TARGET_CLOUDFRONT_ALIAS_CERTIFICATE_INVALID"
				}
				if target == "cloudformation" {
					wantCode = "CLOUDFORMATION_" + strings.TrimPrefix(wantCode, "TARGET_")
				}
				found := false
				for _, diagnostic := range d {
					if diagnostic.Code == wantCode {
						found = true
					}
				}
				if !found {
					t.Fatalf("%s missing explicit %s external ownership rejection: %v", target, id, d)
				}
			})
		}
	}
}
