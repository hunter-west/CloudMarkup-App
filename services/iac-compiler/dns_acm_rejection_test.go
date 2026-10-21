package compiler

import (
	"strings"
	"testing"
)

func TestDnsEveryFieldAndOwnershipFailsClosed(t *testing.T) {
	base := dnsModel(true)
	for _, target := range []string{"terraform", "cloudformation"} {
		a, d := kmsArtifact(base, target)
		assertNoTargetErrors(t, d)
		if a == nil {
			t.Fatalf("%s missing valid baseline", target)
		}
	}
	for _, tc := range []struct{ nodeID, key, mode, code string }{
		{"public_zone", "domainName", "unknown-field", "TARGET_CONFIGURATION_UNSUPPORTED"},
		{"public_zone", "", "wrong-schema", "TARGET_CONFIGURATION_UNSUPPORTED"},
		{"public_zone", "", "generated-owner", "TARGET_DNS_OWNERSHIP_INVALID"},
		{"public_zone", "", "adopted-owner", "TARGET_DNS_OWNERSHIP_INVALID"},
		{"public_zone", "", "imported-owner", "TARGET_DNS_EXTERNAL_UNSUPPORTED"},
		{"public_zone", "domainName", "missing", "TARGET_CONFIGURATION_UNSUPPORTED"},
		{"public_zone", "domainName", "wrong-kind", "TARGET_DNS_FIELD_INVALID"},
		{"public_zone", "forceDestroy", "wrong-kind", "TARGET_DNS_FIELD_INVALID"},
		{"certificate", "domainName", "unknown-field", "TARGET_CONFIGURATION_UNSUPPORTED"},
		{"certificate", "", "wrong-schema", "TARGET_CONFIGURATION_UNSUPPORTED"},
		{"certificate", "", "generated-owner", "TARGET_DNS_OWNERSHIP_INVALID"},
		{"certificate", "", "adopted-owner", "TARGET_DNS_OWNERSHIP_INVALID"},
		{"certificate", "", "imported-owner", "TARGET_DNS_EXTERNAL_UNSUPPORTED"},
		{"certificate", "domainName", "missing", "TARGET_CONFIGURATION_UNSUPPORTED"},
		{"certificate", "domainName", "wrong-kind", "TARGET_DNS_FIELD_INVALID"},
		{"certificate", "retain", "wrong-kind", "TARGET_DNS_FIELD_INVALID"},
	} {
		n, ok := modelResource(base, tc.nodeID)
		if !ok {
			t.Fatalf("missing fixture node %s", tc.nodeID)
		}
		name := n.ServiceType + "/" + tc.mode
		if tc.mode == "missing" || tc.mode == "wrong-kind" {
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
				switch tc.mode {
				case "unknown-field":
					beforeKeys := len(mutated.Configuration.Values)
					if _, ok := mutated.Configuration.Values[tc.key]; !ok {
						t.Fatalf("missing original field %s", tc.key)
					}
					delete(mutated.Configuration.Values, tc.key)
					mutated.Configuration.Values["unreviewed"] = stringValueConfig("unsupported")
					if len(mutated.Configuration.Values) != beforeKeys {
						t.Fatal("wrong-key mutation must preserve cardinality")
					}
				case "wrong-schema":
					mutated.Configuration.SchemaVersion = "9.0.0"
				case "generated-owner":
					if mutated.Lifecycle.Origin != "user" {
						t.Fatal("ownership mutation requires user origin")
					}
					mutated.Lifecycle.Ownership = "generated"
				case "adopted-owner":
					mutated.Lifecycle.Ownership = "adopted"
				case "imported-owner":
					m.ExternalResources = append(m.ExternalResources, NormalizedExternalResource{ID: "external", OwnershipState: "managed-by-generated-iac", ArchitectureNodes: []ResourceReference{reference(*mutated)}})
				case "missing":
					delete(mutated.Configuration.Values, tc.key)
				case "wrong-kind":
					mutated.Configuration.Values[tc.key] = ConfigurationValue{Kind: "node-reference", NodeID: "repository", Attribute: serviceEcrRepository + ".arn"}
				default:
					t.Fatalf("unknown mutation %s", tc.mode)
				}
				a, d := kmsArtifact(m, target)
				code, sourcePath := tc.code, ""
				if target == "cloudformation" {
					code = "CLOUDFORMATION_" + strings.TrimPrefix(code, "TARGET_")
				}
				if tc.mode == "wrong-kind" {
					sourcePath = "$.semantic.configuration.values." + tc.key
				}
				found := false
				for _, diagnostic := range d {
					if diagnostic.Code == code && diagnostic.Severity == SeverityError && diagnostic.Source.Document == DocumentArchitecture && diagnostic.Source.NodeID == tc.nodeID && diagnostic.Source.Path == sourcePath {
						found = true
					}
				}
				if a != nil || !found {
					t.Fatalf("%s missing %s refusal for %s%s: %v", target, code, tc.nodeID, sourcePath, d)
				}
			}
		})
	}
}

func TestDnsEveryBindingFailsClosed(t *testing.T) {
	codeByMode := map[string]string{
		"wrong-port": "BINDING_INVALID", "wrong-schema": "CONFIGURATION_INVALID",
		"unknown-field": "CONFIGURATION_INVALID", "duplicate": "CARDINALITY_INVALID", "missing-endpoint": "INVALID",
	}
	for rel := range dnsContracts {
		for _, mode := range []string{"wrong-port", "wrong-schema", "unknown-field", "duplicate", "missing-endpoint"} {
			t.Run(rel+"/"+mode, func(t *testing.T) {
				for _, target := range []string{"terraform", "cloudformation"} {
					m := dnsModel(false)
					mutatedEdgeID := ""
					for i := range m.Connections {
						e := &m.Connections[i]
						if e.RelationshipType != rel {
							continue
						}
						mutatedEdgeID = e.ID
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
					if mutatedEdgeID == "" {
						t.Fatalf("missing fixture edge for %s", rel)
					}
					sortModel(m)
					a, d := kmsArtifact(m, target)
					if a != nil || !ecsHasErrors(d) {
						t.Fatalf("%s accepted %s: %v", target, mode, d)
					}
					prefix := "TARGET_NETWORK_RELATIONSHIP_"
					if target == "cloudformation" {
						prefix = "CLOUDFORMATION_NETWORK_RELATIONSHIP_"
					}
					code := prefix + codeByMode[mode]
					found := false
					for _, diagnostic := range d {
						found = found || diagnostic.Code == code && diagnostic.Severity == SeverityError && diagnostic.Source.Document == DocumentArchitecture && diagnostic.Source.EdgeID == mutatedEdgeID
					}
					if !found {
						t.Fatalf("%s lacks %s on edge %s: %v", target, code, mutatedEdgeID, d)
					}
				}
			})
		}
	}
}

func TestDnsUserOriginsPreserveNativeBytes(t *testing.T) {
	for _, target := range []string{"terraform", "cloudformation"} {
		baseline, d := kmsArtifact(dnsModel(false), target)
		assertNoTargetErrors(t, d)
		path := "infrastructure/dns.tf"
		if target == "cloudformation" {
			path = cloudFormationTemplatePath
		}
		want := fileContent(t, baseline, path)
		for _, origin := range []string{"template", "ai-accepted", "migration"} {
			t.Run(target+"/"+origin, func(t *testing.T) {
				m := dnsModel(false)
				for i := range m.Resources {
					if _, ok := dnsSchemas[m.Resources[i].ServiceType]; ok {
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
