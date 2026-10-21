package compiler

import (
	"testing"
)

func TestAuroraEveryFieldAndOwnershipFailsClosed(t *testing.T) {
	base := auroraModel(true)
	for _, n := range base.Resources {
		if _, ok := auroraSchemas[n.ServiceType]; !ok {
			continue
		}
		modes := []string{"unknown-field", "wrong-schema"}
		if n.ServiceType == serviceAuroraCluster {
			modes = append(modes, "generated-owner", "adopted-owner", "imported-owner")
		}
		// Both members share this schema; field mutations below still cover each member.
		if n.ID == "aurora_b" {
			modes = nil
		}
		for _, mode := range modes {
			t.Run(n.ServiceType+"/"+mode, func(t *testing.T) {
				for _, target := range []string{"terraform", "cloudformation"} {
					m := cloneNormalized(t, base)
					for i := range m.Resources {
						r := &m.Resources[i]
						if r.ID != n.ID {
							continue
						}
						switch mode {
						case "unknown-field":
							r.Configuration.Values["unreviewed"] = stringValueConfig("unsupported")
						case "wrong-schema":
							r.Configuration.SchemaVersion = "9.0.0"
						case "generated-owner":
							r.Lifecycle.Ownership = "generated"
							r.Lifecycle.Origin = "connection-rule"
						case "adopted-owner":
							r.Lifecycle.Ownership = "adopted"
						case "imported-owner":
							m.ExternalResources = append(m.ExternalResources, NormalizedExternalResource{ID: "external", OwnershipState: "managed-by-generated-iac", ArchitectureNodes: []ResourceReference{reference(*r)}})
						}
					}
					a, d := kmsArtifact(m, target)
					code := "CONFIGURATION_UNSUPPORTED"
					if mode == "generated-owner" || mode == "adopted-owner" {
						code = "AURORA_OWNERSHIP_INVALID"
					} else if mode == "imported-owner" {
						code = "AURORA_EXTERNAL_UNSUPPORTED"
					}
					if target == "cloudformation" {
						code = "CLOUDFORMATION_" + code
					} else {
						code = "TARGET_" + code
					}
					found := false
					for _, diagnostic := range d {
						if diagnostic.Code == code && diagnostic.Severity == SeverityError && diagnostic.Source.Document == DocumentArchitecture && diagnostic.Source.NodeID == n.ID {
							found = true
						}
					}
					if a != nil || !found {
						t.Fatalf("%s missing %s refusal for %s: %v", target, code, n.ID, d)
					}
				}
			})
		}
		for key := range n.Configuration.Values {
			if key == "description" {
				continue
			}
			for _, mode := range []string{"missing", "wrong-kind"} {
				t.Run(n.ServiceType+"/"+key+"/"+mode, func(t *testing.T) {
					for _, target := range []string{"terraform", "cloudformation"} {
						m := cloneNormalized(t, base)
						for i := range m.Resources {
							r := &m.Resources[i]
							if r.ID == n.ID {
								if mode == "missing" {
									delete(r.Configuration.Values, key)
								} else {
									r.Configuration.Values[key] = ConfigurationValue{Kind: "node-reference", NodeID: "repository", Attribute: serviceEcrRepository + ".arn"}
								}
							}
						}
						a, d := kmsArtifact(m, target)
						if a != nil || !ecsHasErrors(d) {
							t.Fatalf("%s accepted incomplete/incorrect field: %v", target, d)
						}
						if key == "name" && (n.ID == "aurora_parameters") {
							code, path := "TARGET_CONFIGURATION_UNSUPPORTED", ""
							if mode == "wrong-kind" {
								code, path = "TARGET_AURORA_FIELD_INVALID", "$.semantic.configuration.values.name"
							}
							if target == "cloudformation" {
								code = "CLOUDFORMATION_" + code[len("TARGET_"):]
							}
							found := false
							for _, diagnostic := range d {
								if diagnostic.Code == code && diagnostic.Severity == SeverityError && diagnostic.Source.Document == DocumentArchitecture && diagnostic.Source.NodeID == n.ID && diagnostic.Source.Path == path {
									found = true
								}
							}
							if !found {
								t.Fatalf("%s missing %s for %s%s: %v", target, code, n.ID, path, d)
							}
						}
					}
				})
			}
		}
	}
}

func TestAuroraEveryBindingFailsClosed(t *testing.T) {
	refusals := map[string]string{
		"wrong-port": "BINDING_INVALID", "wrong-schema": "CONFIGURATION_INVALID",
		"unknown-field": "CONFIGURATION_INVALID", "duplicate": "CARDINALITY_INVALID", "missing-endpoint": "INVALID",
	}
	for rel := range auroraContracts {
		for _, mode := range []string{"wrong-port", "wrong-schema", "unknown-field", "duplicate", "missing-endpoint"} {
			// Schema version and empty configuration share one scalar guard across this family.
			if (mode == "wrong-schema" || mode == "unknown-field") && rel != auroraGroupBinding {
				continue
			}
			t.Run(rel+"/"+mode, func(t *testing.T) {
				for _, target := range []string{"terraform", "cloudformation"} {
					m := auroraModel(false)
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

func TestAuroraUserOriginsPreserveNativeBytes(t *testing.T) {
	for _, target := range []string{"terraform", "cloudformation"} {
		baseline, d := kmsArtifact(auroraModel(false), target)
		assertNoTargetErrors(t, d)
		path := "infrastructure/data.tf"
		if target == "cloudformation" {
			path = cloudFormationTemplatePath
		}
		want := fileContent(t, baseline, path)
		for _, origin := range []string{"template", "ai-accepted", "migration"} {
			t.Run(target+"/"+origin, func(t *testing.T) {
				m := auroraModel(false)
				for i := range m.Resources {
					if _, ok := auroraSchemas[m.Resources[i].ServiceType]; ok {
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
