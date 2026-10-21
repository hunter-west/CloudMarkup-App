package compiler

import (
	"strings"
	"testing"
)

func TestElbEveryFieldAndOwnershipFailsClosed(t *testing.T) {
	base := elbModel(false, false)
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
		{"alb", "", "unknown-field", "TARGET_CONFIGURATION_UNSUPPORTED"},
		{"target", "", "wrong-schema", "TARGET_CONFIGURATION_UNSUPPORTED"},
		{"listener", "", "generated-owner", "TARGET_ELB_OWNERSHIP_INVALID"},
		{"access", "", "adopted-owner", "TARGET_ELB_OWNERSHIP_INVALID"},
		{"alb", "", "imported-owner", "TARGET_ELB_OWNERSHIP_INVALID"},
		{"alb", "deletionProtection", "missing", "TARGET_CONFIGURATION_UNSUPPORTED"},
		{"access", "retain", "missing", "TARGET_CONFIGURATION_UNSUPPORTED"},
		{"alb", "deletionProtection", "wrong-kind", "TARGET_ELB_FIELD_INVALID"},
		{"alb", "name", "wrong-kind", "TARGET_ELB_FIELD_INVALID"},
		{"alb", "idleTimeoutSeconds", "wrong-kind", "TARGET_ELB_FIELD_INVALID"},
		{"target", "retain", "wrong-kind", "TARGET_ELB_FIELD_INVALID"},
		{"target", "healthPath", "wrong-kind", "TARGET_ELB_FIELD_INVALID"},
		{"target", "port", "wrong-kind", "TARGET_ELB_FIELD_INVALID"},
		{"listener", "retain", "wrong-kind", "TARGET_ELB_FIELD_INVALID"},
		{"listener", "serverName", "wrong-kind", "TARGET_ELB_FIELD_INVALID"},
		{"listener", "port", "wrong-kind", "TARGET_ELB_FIELD_INVALID"},
		{"access", "retain", "wrong-kind", "TARGET_ELB_FIELD_INVALID"},
		{"access", "description", "wrong-kind", "TARGET_ELB_FIELD_INVALID"},
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
					if tc.nodeID == "access" && tc.key == "retain" {
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

func TestElbPeerDescriptionBothTargets(t *testing.T) {
	valid := "AZaz09 ._-:/()#,@[]+=;{}!$*"
	valid += strings.Repeat("a", 128-len(valid))
	for _, description := range []string{valid, "Backénd access", "Backend & access", "Backend access\n"} {
		for _, target := range []string{"terraform", "cloudformation"} {
			model := elbModel(false, false)
			setNetworkingValue(model, "access", "description", stringValueConfig(description))
			artifact, diagnostics := kmsArtifact(model, target)
			if description == valid {
				assertNoTargetErrors(t, diagnostics)
				if artifact == nil {
					t.Fatal("valid peer description rejected")
				}
				path := "infrastructure/elb.tf"
				if target == "cloudformation" {
					path = cloudFormationTemplatePath
				}
				if strings.Count(fileContent(t, artifact, path), description) != 2 {
					t.Fatal("peer description was not preserved on both rules")
				}
				continue
			}
			found := false
			for _, diagnostic := range diagnostics {
				if strings.HasSuffix(diagnostic.Code, "ELB_FIELD_INVALID") && diagnostic.Source.NodeID == "access" && diagnostic.Source.Path == "$.semantic.configuration.values.description" {
					found = true
				}
			}
			if artifact != nil || !found {
				t.Fatalf("%s admitted invalid peer description: %v", target, diagnostics)
			}
		}
	}
}

func TestElbEveryBindingFailsClosed(t *testing.T) {
	for rel := range elbContracts {
		for _, mode := range []string{"wrong-port", "wrong-schema", "unknown-field", "duplicate", "missing-endpoint"} {
			if rel != albVpc && (mode == "wrong-schema" || mode == "unknown-field") {
				continue
			}
			t.Run(rel+"/"+mode, func(t *testing.T) {
				for _, target := range []string{"terraform", "cloudformation"} {
					m := elbModel(rel == albEcs, false)
					for i := range m.Connections {
						e := &m.Connections[i]
						if e.RelationshipType != rel {
							continue
						}
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
					sortModel(m)
					a, d := kmsArtifact(m, target)
					if a != nil || !ecsHasErrors(d) {
						t.Fatalf("%s accepted %s: %v", target, mode, d)
					}
				}
			})
		}
	}
}

func TestElbUserOriginsPreserveNativeBytes(t *testing.T) {
	for _, target := range []string{"terraform", "cloudformation"} {
		baseline, d := kmsArtifact(elbModel(false, false), target)
		assertNoTargetErrors(t, d)
		path := "infrastructure/elb.tf"
		if target == "cloudformation" {
			path = cloudFormationTemplatePath
		}
		want := fileContent(t, baseline, path)
		for _, origin := range []string{"template", "ai-accepted", "migration"} {
			t.Run(target+"/"+origin, func(t *testing.T) {
				m := elbModel(false, false)
				for i := range m.Resources {
					if _, ok := elbSchemas[m.Resources[i].ServiceType]; ok {
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

func TestElbExternalDependenciesFailClosed(t *testing.T) {
	for _, ecs := range []bool{false, true} {
		ids := []string{"target", "listener", "access", "certificate", "vpc", "az", "az_b", "alb_subnet_a", "alb_subnet_b", "group", "alb_group", "subnet", "alb_client"}
		if ecs {
			ids = []string{"service", "container"}
		} else {
			ids = append(ids, "instance")
		}
		for _, id := range ids {
			for _, target := range []string{"terraform", "cloudformation"} {
				t.Run(id+"/"+target+map[bool]string{false: "-ec2", true: "-fargate"}[ecs], func(t *testing.T) {
					m := elbModel(ecs, false)
					n, ok := modelResource(m, id)
					if !ok {
						t.Fatal("missing dependency")
					}
					x := externalTable("existing-cloud-managed-elsewhere")
					x.ID = "external"
					x.ResourceType = n.ResourceType
					x.ArchitectureNodes = []ResourceReference{reference(n)}
					x.Addresses = []ExternalResourceAddress{{ID: "external_id", Kind: "provider-resource-id", Value: "synthetic-resource"}}
					x.Targets = []ExternalResourceTarget{{Target: TargetKind(target), Readiness: "reference-ready", MappingID: n.ServiceType + "." + target, MappingVersion: "1.0.0"}}
					m.ExternalResources = append(m.ExternalResources, x)
					a, d := kmsArtifact(m, target)
					explicit := false
					for _, e := range d {
						if strings.Contains(e.Code, "ELB_") && e.Severity == SeverityError {
							explicit = true
						}
					}
					if a != nil || !explicit {
						t.Fatalf("missing explicit external ELB rejection: %v", d)
					}
				})
			}
		}
	}
}
func TestElbTopologyFailsClosed(t *testing.T) {
	mutations := map[string]func(*NormalizedSolution){"missing-listener": func(m *NormalizedSolution) { removeNetworkingResource(m, "listener") }, "missing-access": func(m *NormalizedSolution) { removeNetworkingResource(m, "access") }, "public-route": func(m *NormalizedSolution) {
		setResourceValue(m, "alb", "scheme", stringValueConfig("internet-facing"))
	}, "duplicate-physical-zone": func(m *NormalizedSolution) { setResourceValue(m, "az_b", "zoneName", stringValueConfig("us-east-1a")) },
		"reserved-name": func(m *NormalizedSolution) {
			setResourceValue(m, "alb", "name", stringValueConfig("internal-reserved"))
		}, "ipv6": func(m *NormalizedSolution) {
			setResourceValue(m, "alb", "ipAddressType", stringValueConfig("dualstack"))
		}, "small-subnet": func(m *NormalizedSolution) {
			setResourceValue(m, "alb_subnet_a", "cidrBlock", stringValueConfig("10.20.2.0/28"))
		}, "ec2-grace": func(m *NormalizedSolution) { setResourceValue(m, "target", "startupGraceSeconds", integerValue(30)) }, "http-viewer": func(m *NormalizedSolution) { setResourceValue(m, "listener", "protocol", stringValueConfig("HTTP")) }, "name-mismatch": func(m *NormalizedSolution) {
			setResourceValue(m, "listener", "serverName", stringValueConfig("other.example.test"))
		}, "wrong-cert-use": func(m *NormalizedSolution) {
			setResourceValue(m, "certificate", "intendedUse", stringValueConfig("cloudfront-viewer"))
		}, "wrong-cert-region": func(m *NormalizedSolution) {
			setResourceValue(m, "certificate", "certificateRegion", stringValueConfig("us-west-2"))
		}, "backend-tls": func(m *NormalizedSolution) { setResourceValue(m, "target", "protocol", stringValueConfig("HTTPS")) }, "lambda-target": func(m *NormalizedSolution) { setResourceValue(m, "target", "backendMode", stringValueConfig("lambda")) }, "invalid-health": func(m *NormalizedSolution) {
			setResourceValue(m, "target", "healthPath", stringValueConfig("../health"))
		}, "viewer-port": func(m *NormalizedSolution) { setResourceValue(m, "alb_client", "fromPort", integerValue(80)) }, "wrong-owner": func(m *NormalizedSolution) {
			for i := range m.Resources {
				if m.Resources[i].ID == "listener" {
					m.Resources[i].Parent.NodeID = "vpc"
				}
			}
		}}
	for name, mutate := range mutations {
		for _, target := range []string{"terraform", "cloudformation"} {
			if target == "cloudformation" {
				switch name {
				case "missing-listener", "missing-access", "public-route", "http-viewer", "wrong-cert-region", "lambda-target", "viewer-port":
				default:
					continue
				}
			}
			t.Run(name+"/"+target, func(t *testing.T) {
				m := elbModel(false, false)
				mutate(m)
				a, d := kmsArtifact(m, target)
				if a != nil || !ecsHasErrors(d) {
					t.Fatalf("unsupported intent exported: %v", d)
				}
			})
		}
	}
}
func TestElbRuleOwnedBindings(t *testing.T) {
	for _, fixture := range []struct {
		relationship string
		ecs          bool
		edgeIDs      []string
	}{
		{albSubnet, false, []string{"alb_sa", "alb_sb"}},
		{albEcs, true, []string{"backend"}},
	} {
		for _, target := range []string{"terraform", "cloudformation"} {
			base := elbModel(fixture.ecs, false)
			for i := range base.Connections {
				e := &base.Connections[i]
				if _, ok := elbContracts[e.RelationshipType]; ok {
					e.Lifecycle = Lifecycle{Ownership: "generated", Origin: "connection-rule", Provenance: &GeneratedProvenance{GeneratorKind: "connection-rule", GeneratorID: e.RelationshipType, GeneratorVersion: "1.0.0", OperationID: "operation_elb", DependentNodeIDs: []string{e.Source.NodeID, e.Target.NodeID}, DependentEdgeIDs: []string{}}}
				}
			}
			a, d := kmsArtifact(base, target)
			assertNoTargetErrors(t, d)
			if a == nil {
				t.Fatal("missing rule-owned binding export")
			}
			for _, mode := range []string{"rule", "version", "dependency", "extra-edge", "empty-operation", "adopted"} {
				t.Run(fixture.relationship+"/"+target+"/"+mode, func(t *testing.T) {
					m := cloneNormalized(t, base)
					mutatedEdgeIDs := map[string]bool{}
					for i := range m.Connections {
						e := &m.Connections[i]
						if e.RelationshipType != fixture.relationship {
							continue
						}
						mutatedEdgeIDs[e.ID] = true
						switch mode {
						case "rule":
							e.Lifecycle.Provenance.GeneratorID = "aws.elb.unreviewed"
						case "version":
							e.Lifecycle.Provenance.GeneratorVersion = "9.0.0"
						case "dependency":
							e.Lifecycle.Provenance.DependentNodeIDs = []string{e.Source.NodeID}
						case "extra-edge":
							e.Lifecycle.Provenance.DependentEdgeIDs = []string{"certificate_zone"}
						case "empty-operation":
							e.Lifecycle.Provenance.OperationID = ""
						case "adopted":
							e.Lifecycle.Ownership = "adopted"
						}
					}
					if len(mutatedEdgeIDs) != len(fixture.edgeIDs) {
						t.Fatalf("unexpected mutated edges: %v", mutatedEdgeIDs)
					}
					for _, edgeID := range fixture.edgeIDs {
						if !mutatedEdgeIDs[edgeID] {
							t.Fatalf("missing fixture edge %s", edgeID)
						}
					}
					a, d := kmsArtifact(m, target)
					if a != nil {
						t.Fatal("invalid binding provenance exported")
					}
					code := "TARGET_ELB_BINDING_INVALID"
					if target == "cloudformation" {
						code = "CLOUDFORMATION_ELB_BINDING_INVALID"
					}
					for _, edgeID := range fixture.edgeIDs {
						found := false
						for _, diagnostic := range d {
							if diagnostic.Code == code && diagnostic.Severity == SeverityError && diagnostic.Source.Document == DocumentArchitecture && diagnostic.Source.EdgeID == edgeID {
								found = true
							}
						}
						if !found {
							t.Fatalf("missing %s error for mutated edge %s: %v", code, edgeID, d)
						}
					}
				})
			}
		}
	}
}
