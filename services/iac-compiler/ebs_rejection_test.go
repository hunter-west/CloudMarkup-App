package compiler

import (
	"strings"
	"testing"
)

func TestEbsEveryFieldAndOwnershipFailsClosed(t *testing.T) {
	base := ebsModel(true, true)
	for _, target := range []string{"terraform", "cloudformation"} {
		a, d := kmsArtifact(base, target)
		assertNoTargetErrors(t, d)
		if a == nil {
			t.Fatalf("%s missing valid baseline", target)
		}
	}
	for _, tc := range []struct{ nodeID, key, mode, code string }{
		{"volume", "encryptionMode", "unknown-field", "TARGET_CONFIGURATION_UNSUPPORTED"},
		{"volume", "", "wrong-schema", "TARGET_CONFIGURATION_UNSUPPORTED"},
		{"volume", "", "generated-owner", "TARGET_EBS_OWNERSHIP_INVALID"},
		{"volume", "", "adopted-owner", "TARGET_EBS_OWNERSHIP_INVALID"},
		{"volume", "", "imported-owner", "TARGET_EBS_OWNERSHIP_INVALID"},
		{"volume", "encryptionMode", "missing", "TARGET_CONFIGURATION_UNSUPPORTED"},
		{"volume", "encryptionMode", "wrong-kind", "TARGET_EBS_FIELD_INVALID"},
		{"volume", "sizeGiB", "wrong-kind", "TARGET_EBS_FIELD_INVALID"},
		{"volume", "multiAttach", "wrong-kind", "TARGET_EBS_FIELD_INVALID"},
		{"attachment", "deviceName", "unknown-field", "TARGET_CONFIGURATION_UNSUPPORTED"},
		{"attachment", "", "wrong-schema", "TARGET_CONFIGURATION_UNSUPPORTED"},
		{"attachment", "", "generated-owner", "TARGET_EBS_OWNERSHIP_INVALID"},
		{"attachment", "", "adopted-owner", "TARGET_EBS_OWNERSHIP_INVALID"},
		{"attachment", "", "imported-owner", "TARGET_EBS_OWNERSHIP_INVALID"},
		{"attachment", "deviceName", "missing", "TARGET_CONFIGURATION_UNSUPPORTED"},
		{"attachment", "deviceName", "wrong-kind", "TARGET_EBS_FIELD_INVALID"},
		{"attachment", "forceDetach", "wrong-kind", "TARGET_EBS_FIELD_INVALID"},
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

func TestEbsEveryBindingFailsClosed(t *testing.T) {
	refusals := map[string]string{
		"wrong-port": "BINDING_INVALID", "wrong-schema": "CONFIGURATION_INVALID",
		"unknown-field": "CONFIGURATION_INVALID", "duplicate": "CARDINALITY_INVALID", "missing-endpoint": "INVALID",
	}
	for rel := range ebsContracts {
		for _, mode := range []string{"wrong-port", "wrong-schema", "unknown-field", "duplicate", "missing-endpoint"} {
			// Schema version and empty configuration share one scalar guard across this family.
			if (mode == "wrong-schema" || mode == "unknown-field") && rel != ebsKey {
				continue
			}
			t.Run(rel+"/"+mode, func(t *testing.T) {
				for _, target := range []string{"terraform", "cloudformation"} {
					m := ebsModel(true, true)
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
						codes = append(codes, prefix+"EBS_BINDING_INVALID")
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

func TestEbsUserOriginsPreserveNativeBytes(t *testing.T) {
	for _, target := range []string{"terraform", "cloudformation"} {
		baseline, d := kmsArtifact(ebsModel(true, true), target)
		assertNoTargetErrors(t, d)
		path := "infrastructure/ebs.tf"
		if target == "cloudformation" {
			path = cloudFormationTemplatePath
		}
		want := fileContent(t, baseline, path)
		for _, origin := range []string{"template", "ai-accepted", "migration"} {
			t.Run(target+"/"+origin, func(t *testing.T) {
				m := ebsModel(true, true)
				for i := range m.Resources {
					if _, ok := ebsSchemas[m.Resources[i].ServiceType]; ok {
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

func TestEbsRuleOwnedBindings(t *testing.T) {
	for rel := range ebsContracts {
		for _, target := range []string{"terraform", "cloudformation"} {
			base := ebsModel(true, true)
			for i := range base.Connections {
				e := &base.Connections[i]
				if _, ok := ebsContracts[e.RelationshipType]; ok {
					e.Lifecycle = Lifecycle{Ownership: "generated", Origin: "connection-rule", Provenance: &GeneratedProvenance{GeneratorKind: "connection-rule", GeneratorID: e.RelationshipType, GeneratorVersion: "1.0.0", OperationID: "operation_ebs", DependentNodeIDs: []string{e.Source.NodeID, e.Target.NodeID}, DependentEdgeIDs: []string{}}}
				}
			}
			a, d := kmsArtifact(base, target)
			assertNoTargetErrors(t, d)
			if a == nil {
				t.Fatal("missing rule-owned binding export")
			}
			for _, mode := range []string{"rule", "version", "dependency", "extra-edge", "empty-operation", "adopted"} {
				if rel != ebsKey && mode != "rule" {
					continue
				}
				t.Run(rel+"/"+target+"/"+mode, func(t *testing.T) {
					m := cloneNormalized(t, base)
					for i := range m.Connections {
						e := &m.Connections[i]
						if e.RelationshipType != rel {
							continue
						}
						switch mode {
						case "rule":
							e.Lifecycle.Provenance.GeneratorID = "aws.ebs.unreviewed"
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
					a, d := kmsArtifact(m, target)
					if a != nil || !ecsHasErrors(d) {
						t.Fatal("invalid binding provenance exported")
					}
				})
			}
		}
	}
}

func TestEbsTopologyFailsClosed(t *testing.T) {
	cases := []struct {
		name   string
		mutate func(*NormalizedSolution)
	}{
		{"missing-zone", func(m *NormalizedSolution) { ebsRemoveRelationship(m, ebsZone) }},
		{"missing-owner", func(m *NormalizedSolution) { ebsRemoveRelationship(m, ebsOwner) }},
		{"missing-instance", func(m *NormalizedSolution) { ebsRemoveRelationship(m, ebsInstance) }},
		{"missing-customer-key", func(m *NormalizedSolution) { ebsRemoveRelationship(m, ebsKey) }},
		{"default-with-selected-key", func(m *NormalizedSolution) {
			ec2Set(m, "volume", "encryptionMode", stringValueConfig("account-default"))
		}},
		{"disabled-key", func(m *NormalizedSolution) { ec2Set(m, "encryption_key", "enabled", boolValue(false)) }},
		{"wrong-zone-parent", func(m *NormalizedSolution) {
			for i := range m.Resources {
				if m.Resources[i].ID == "volume" {
					m.Resources[i].Parent.NodeID = "vpc"
				}
			}
		}},
		{"wrong-attachment-parent", func(m *NormalizedSolution) {
			for i := range m.Resources {
				if m.Resources[i].ID == "attachment" {
					m.Resources[i].Parent.NodeID = "instance"
				}
			}
		}},
		{"root-device", func(m *NormalizedSolution) { ec2Set(m, "attachment", "deviceName", stringValueConfig("/dev/xvda")) }},
		{"other-zone", func(m *NormalizedSolution) {
			z, _ := modelResource(m, "az")
			v, _ := modelResource(m, "vpc")
			other := z
			other.ID = "other_az"
			other.TargetKey = "other_az"
			other.Configuration.Values = map[string]ConfigurationValue{"zoneName": stringValueConfig("us-east-1b")}
			m.Resources = append(m.Resources, other)
			m.Connections = append(m.Connections, networkConnection("other_az_owner", "aws.ec2.vpc-contains-availability-zone", v, other))
			for i := range m.Resources {
				if m.Resources[i].ID == "volume" {
					m.Resources[i].Parent = &ResourceReference{NodeID: other.ID, TargetKey: other.TargetKey, RelationshipType: ebsZone}
				}
			}
			for i := range m.Connections {
				if m.Connections[i].RelationshipType == ebsZone {
					m.Connections[i].Target.NodeID = other.ID
					m.Connections[i].Target.TargetKey = other.TargetKey
					m.Connections[i].Target.Port = serviceAvailabilityZone + ".ebs-volume"
				}
			}
		}},
		{"duplicate-device", func(m *NormalizedSolution) {
			z, _ := modelResource(m, "az")
			instance, _ := modelResource(m, "instance")
			v, _ := modelResource(m, "volume")
			a, _ := modelResource(m, "attachment")
			v.ID = "second_volume"
			v.TargetKey = "second_volume"
			a.ID = "second_attachment"
			a.TargetKey = "second_attachment"
			a.Parent = &ResourceReference{NodeID: v.ID, TargetKey: v.TargetKey, RelationshipType: ebsOwner}
			m.Resources = append(m.Resources, v, a)
			m.Connections = append(m.Connections, networkConnection("second_zone", ebsZone, v, z), networkConnection("second_key", ebsKey, v, func() NormalizedResource { k, _ := modelResource(m, "encryption_key"); return k }()), networkConnection("second_owner", ebsOwner, a, v), networkConnection("second_instance", ebsInstance, a, instance))
		}},
	}
	for _, c := range cases {
		for _, target := range []string{"terraform", "cloudformation"} {
			if target == "cloudformation" {
				switch c.name {
				case "missing-owner", "missing-customer-key", "default-with-selected-key", "disabled-key", "root-device", "other-zone":
				default:
					continue
				}
			}
			t.Run(c.name+"/"+target, func(t *testing.T) {
				m := ebsModel(true, true)
				c.mutate(m)
				sortModel(m)
				a, d := kmsArtifact(m, target)
				if a != nil || !ecsHasErrors(d) {
					t.Fatalf("accepted invalid EBS topology: %v", d)
				}
			})
		}
	}
}
func TestEbsExternalDependenciesFailClosed(t *testing.T) {
	for _, id := range []string{"volume", "attachment", "instance", "encryption_key", "az", "vpc", "region", "subnet", "group"} {
		for _, target := range []string{"terraform", "cloudformation"} {
			t.Run(id+"/"+target, func(t *testing.T) {
				m := ebsModel(true, true)
				n, ok := modelResource(m, id)
				if !ok {
					t.Fatal("missing synthetic dependency")
				}
				m.ExternalResources = append(m.ExternalResources, NormalizedExternalResource{ID: "external", OwnershipState: "managed-by-generated-iac", ArchitectureNodes: []ResourceReference{reference(n)}})
				a, d := kmsArtifact(m, target)
				if a != nil || !ecsHasErrors(d) {
					t.Fatal("external dependency accepted")
				}
			})
		}
	}
}
func TestEbsBoundedDeviceAndCapacityVariants(t *testing.T) {
	for _, device := range []string{"/dev/sdf", "/dev/sdg", "/dev/sdh", "/dev/sdi"} {
		for _, size := range []int{1, 16384} {
			for _, target := range []string{"terraform", "cloudformation"} {
				m := ebsModel(false, true)
				ec2Set(m, "attachment", "deviceName", stringValueConfig(device))
				ec2Set(m, "volume", "sizeGiB", integerValue(size))
				ec2Set(m, "instance", "instanceType", stringValueConfig("t4g.small"))
				ec2Set(m, "instance", "imageArchitecture", stringValueConfig("arm64"))
				a, d := kmsArtifact(m, target)
				assertNoTargetErrors(t, d)
				if a == nil {
					t.Fatal("missing admitted variant")
				}
			}
		}
	}
}

func ebsRemoveRelationship(m *NormalizedSolution, rel string) {
	xs := []NormalizedConnection{}
	for _, e := range m.Connections {
		if e.RelationshipType != rel {
			xs = append(xs, e)
		}
	}
	m.Connections = xs
}
