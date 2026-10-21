package compiler

import (
	"strings"
	"testing"
)

func TestRdsEveryFieldAndOwnershipFailsClosed(t *testing.T) {
	base := rdsModel(true)
	for _, n := range base.Resources {
		if _, ok := rdsSchemas[n.ServiceType]; !ok {
			continue
		}
		modes := []string{"unknown-field", "wrong-schema"}
		if n.ServiceType == serviceRdsInstance {
			modes = append(modes, "generated-owner", "adopted-owner", "imported-owner")
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
						code = "RDS_OWNERSHIP_INVALID"
					} else if mode == "imported-owner" {
						code = "RDS_EXTERNAL_UNSUPPORTED"
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
						if key == "name" && (n.ID == "db_subnets" || n.ID == "db_parameters") {
							code, path := "TARGET_CONFIGURATION_UNSUPPORTED", ""
							if mode == "wrong-kind" {
								code, path = "TARGET_RDS_FIELD_INVALID", "$.semantic.configuration.values.name"
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
func TestRdsBoundedShapesFailClosed(t *testing.T) {
	cases := map[string]func(*NormalizedSolution){
		"database-keyword": func(m *NormalizedSolution) { ec2Set(m, "database", "databaseName", stringValueConfig("Table")) },
		"username-keyword": func(m *NormalizedSolution) { ec2Set(m, "database", "masterUsername", stringValueConfig("SELECT")) },
		"engine-major":     func(m *NormalizedSolution) { ec2Set(m, "database", "engineVersion", stringValueConfig("17.1")) },
		"class":            func(m *NormalizedSolution) { ec2Set(m, "database", "instanceClass", stringValueConfig("db.r6g.large")) },
		"storage-small":    func(m *NormalizedSolution) { ec2Set(m, "database", "storageGiB", integerValue(19)) },
		"storage-striping": func(m *NormalizedSolution) { ec2Set(m, "database", "storageGiB", integerValue(400)) },
		"backup-disabled":  func(m *NormalizedSolution) { ec2Set(m, "database", "backupRetentionDays", integerValue(0)) },
		"backup-too-long":  func(m *NormalizedSolution) { ec2Set(m, "database", "backupRetentionDays", integerValue(36)) },
		"public":           func(m *NormalizedSolution) { ec2Set(m, "database", "publicAccess", boolValue(true)) },
		"unprotected":      func(m *NormalizedSolution) { ec2Set(m, "database", "deletionProtection", boolValue(false)) },
		"unretained":       func(m *NormalizedSolution) { ec2Set(m, "database", "retain", boolValue(false)) },
		"unencrypted":      func(m *NormalizedSolution) { ec2Set(m, "database", "storageEncrypted", boolValue(false)) },
		"custom-key": func(m *NormalizedSolution) {
			ec2Set(m, "database", "encryptionMode", stringValueConfig("customer-managed"))
		},
		"automatic-minor": func(m *NormalizedSolution) { ec2Set(m, "database", "autoMinorUpgrade", boolValue(true)) },
		"major-upgrade":   func(m *NormalizedSolution) { ec2Set(m, "database", "allowMajorUpgrade", boolValue(true)) },
		"iam-db-auth":     func(m *NormalizedSolution) { ec2Set(m, "database", "iamAuthentication", boolValue(true)) },
		"password": func(m *NormalizedSolution) {
			ec2Set(m, "database", "masterPassword", stringValueConfig("synthetic-sensitive-sentinel"))
		},
		"database-reserved": func(m *NormalizedSolution) { ec2Set(m, "database", "databaseName", stringValueConfig("postgres")) },
		"username-reserved": func(m *NormalizedSolution) { ec2Set(m, "database", "masterUsername", stringValueConfig("rdsadmin")) },
		"ca-retired":        func(m *NormalizedSolution) { ec2Set(m, "database", "caIdentifier", stringValueConfig("rds-ca-2019")) },
		"credential-mode": func(m *NormalizedSolution) {
			ec2Set(m, "database", "masterAuthMode", stringValueConfig("external-password"))
		},
		"backup-wrap":  func(m *NormalizedSolution) { ec2Set(m, "database", "backupWindow", stringValueConfig("23:45-00:30")) },
		"backup-short": func(m *NormalizedSolution) { ec2Set(m, "database", "backupWindow", stringValueConfig("02:00-02:20")) },
		"backup-long":  func(m *NormalizedSolution) { ec2Set(m, "database", "backupWindow", stringValueConfig("02:00-05:00")) },
		"windows-overlap": func(m *NormalizedSolution) {
			ec2Set(m, "database", "maintenanceWindow", stringValueConfig("sun:02:15-sun:02:45"))
		},
		"maintenance-wrap": func(m *NormalizedSolution) {
			ec2Set(m, "database", "maintenanceWindow", stringValueConfig("sun:03:00-mon:03:30"))
		},
		"tls-disabled":         func(m *NormalizedSolution) { ec2Set(m, "db_parameters", "forceTls", boolValue(false)) },
		"parameter-family":     func(m *NormalizedSolution) { ec2Set(m, "db_parameters", "family", stringValueConfig("postgres17")) },
		"reserved-group":       func(m *NormalizedSolution) { ec2Set(m, "db_subnets", "name", stringValueConfig("default")) },
		"one-subnet":           func(m *NormalizedSolution) { ec2RemoveEdge(m, "db_subnet_b") },
		"missing-group":        func(m *NormalizedSolution) { ec2RemoveEdge(m, "db_group_binding") },
		"missing-parameters":   func(m *NormalizedSolution) { ec2RemoveEdge(m, "db_parameters_binding") },
		"missing-subnet-group": func(m *NormalizedSolution) { ec2RemoveEdge(m, "db_subnets_binding") },
		"same-zone-name":       func(m *NormalizedSolution) { ec2Set(m, "az_b", "zoneName", stringValueConfig("us-east-1a")) },
		"wrong-region":         func(m *NormalizedSolution) { m.Provenance.Region = "us-west-2" },
		"root-parent": func(m *NormalizedSolution) {
			for i := range m.Resources {
				if m.Resources[i].ID == "database" {
					m.Resources[i].Parent = &ResourceReference{NodeID: "vpc", TargetKey: "vpc", RelationshipType: "aws.region.contains-vpc"}
				}
			}
		},
		"duplicate-name": func(m *NormalizedSolution) {
			n, _ := modelResource(m, "db_parameters")
			n.ID = "duplicate_parameters"
			n.TargetKey = n.ID
			m.Resources = append(m.Resources, n)
		},
		"resource-type": func(m *NormalizedSolution) {
			for i := range m.Resources {
				if m.Resources[i].ID == "database" {
					m.Resources[i].ResourceType = "aws.rds.unreviewed"
				}
			}
		},
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			for _, target := range []string{"terraform", "cloudformation"} {
				m := rdsModel(false)
				mutate(m)
				sortModel(m)
				a, d := kmsArtifact(m, target)
				if a != nil || !ecsHasErrors(d) {
					t.Fatalf("%s accepted %s: %v", target, name, d)
				}
				for _, f := range d {
					if strings.Contains(f.Message, "synthetic-sensitive-sentinel") {
						t.Fatal("sensitive material exposed")
					}
				}
			}
		})
	}
}
func TestRdsEveryBindingFailsClosed(t *testing.T) {
	refusals := map[string]string{
		"wrong-port": "BINDING_INVALID", "wrong-schema": "CONFIGURATION_INVALID",
		"unknown-field": "CONFIGURATION_INVALID", "duplicate": "CARDINALITY_INVALID", "missing-endpoint": "INVALID",
	}
	for rel := range rdsContracts {
		for _, mode := range []string{"wrong-port", "wrong-schema", "unknown-field", "duplicate", "missing-endpoint"} {
			// Schema version and empty configuration share one scalar guard across this family.
			if (mode == "wrong-schema" || mode == "unknown-field") && rel != rdsGroupBinding {
				continue
			}
			t.Run(rel+"/"+mode, func(t *testing.T) {
				for _, target := range []string{"terraform", "cloudformation"} {
					m := rdsModel(false)
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
func TestRdsUserOriginsPreserveNativeBytes(t *testing.T) {
	for _, target := range []string{"terraform", "cloudformation"} {
		baseline, d := kmsArtifact(rdsModel(false), target)
		assertNoTargetErrors(t, d)
		path := "infrastructure/data.tf"
		if target == "cloudformation" {
			path = cloudFormationTemplatePath
		}
		want := fileContent(t, baseline, path)
		for _, origin := range []string{"template", "ai-accepted", "migration"} {
			t.Run(target+"/"+origin, func(t *testing.T) {
				m := rdsModel(false)
				for i := range m.Resources {
					if _, ok := rdsSchemas[m.Resources[i].ServiceType]; ok {
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
