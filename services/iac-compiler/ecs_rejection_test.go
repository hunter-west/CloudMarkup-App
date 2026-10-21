package compiler

import (
	"fmt"
	"strings"
	"testing"
)

func ecsHasErrors(diagnostics []Diagnostic) bool {
	for _, d := range diagnostics {
		if d.Severity == SeverityError {
			return true
		}
	}
	return false
}

func TestEcsEveryFieldAndOwnershipFailsClosed(t *testing.T) {
	base := ecsModel(true)
	for _, target := range []string{"terraform", "cloudformation"} {
		artifact, diagnostics := kmsArtifact(cloneNormalized(t, base), target)
		assertNoTargetErrors(t, diagnostics)
		if artifact == nil {
			t.Fatalf("%s synthetic ECS baseline returned no artifact", target)
		}
	}
	for _, test := range []struct {
		service, nodeID, key, mode, code string
	}{
		{serviceEcrRepository, "repository", "", "unknown-field", "TARGET_CONFIGURATION_UNSUPPORTED"},
		{serviceEcsTask, "task", "", "wrong-schema", "TARGET_CONFIGURATION_UNSUPPORTED"},
		{serviceEcrImage, "image", "", "generated-owner", "TARGET_ECS_OWNERSHIP_INVALID"},
		{serviceEcsContainer, "container", "", "adopted-owner", "TARGET_ECS_OWNERSHIP_INVALID"},
		{serviceEcsService, "service", "", "imported-owner", "TARGET_ECS_EXTERNAL_UNSUPPORTED"},
		{serviceEcsContainer, "container", "readOnlyRoot", "missing", "TARGET_CONFIGURATION_UNSUPPORTED"},
		{serviceEcrRepository, "repository", "name", "wrong-kind", "TARGET_ECS_FIELD_INVALID"},
		{serviceEcsTask, "task", "cpu", "wrong-kind", "TARGET_ECS_FIELD_INVALID"},
		{serviceEcsService, "service", "publicIpv4", "wrong-kind", "TARGET_ECS_FIELD_INVALID"},
	} {
		name := test.service + "/" + test.mode
		if test.key != "" {
			name = test.service + "/" + test.key + "/" + test.mode
		}
		t.Run(name, func(t *testing.T) {
			for _, target := range []string{"terraform", "cloudformation"} {
				m := cloneNormalized(t, base)
				var mutated *NormalizedResource
				for i := range m.Resources {
					if m.Resources[i].ID == test.nodeID {
						mutated = &m.Resources[i]
						break
					}
				}
				if mutated == nil || mutated.ServiceType != test.service {
					t.Fatalf("missing exact synthetic ECS node %s", test.nodeID)
				}
				switch test.mode {
				case "unknown-field":
					mutated.Configuration.Values["unreviewed"] = stringValueConfig("unsupported")
				case "wrong-schema":
					mutated.Configuration.SchemaVersion = "9.0.0"
				case "generated-owner":
					if mutated.Lifecycle.Origin != "user" {
						t.Fatal("generated-owner baseline must retain user origin")
					}
					mutated.Lifecycle.Ownership = "generated"
				case "adopted-owner":
					mutated.Lifecycle.Origin = "adoption"
				case "imported-owner":
					m.ExternalResources = append(m.ExternalResources, NormalizedExternalResource{ID: "external", OwnershipState: "managed-by-generated-iac", ArchitectureNodes: []ResourceReference{reference(*mutated)}})
				case "missing":
					count := len(mutated.Configuration.Values)
					if _, ok := mutated.Configuration.Values[test.key]; !ok {
						t.Fatalf("missing synthetic required field %s", test.key)
					}
					delete(mutated.Configuration.Values, test.key)
					mutated.Configuration.Values["unreviewed"] = stringValueConfig("unsupported")
					if len(mutated.Configuration.Values) != count {
						t.Fatal("missing-field mutation must preserve map cardinality")
					}
				case "wrong-kind":
					mutated.Configuration.Values[test.key] = ConfigurationValue{Kind: "node-reference", NodeID: "repository", Attribute: serviceEcrRepository + ".arn"}
				default:
					t.Fatalf("unrecognized synthetic mutation %s", test.mode)
				}
				artifact, diagnostics := kmsArtifact(m, target)
				if artifact != nil {
					t.Fatalf("%s returned an artifact for %s", target, name)
				}
				wantCode := test.code
				if target == "cloudformation" {
					wantCode = "CLOUDFORMATION_" + strings.TrimPrefix(test.code, "TARGET_")
				}
				found := false
				for _, diagnostic := range diagnostics {
					if diagnostic.Code == wantCode && diagnostic.Severity == SeverityError && diagnostic.Source.Document == DocumentArchitecture && diagnostic.Source.NodeID == test.nodeID {
						if test.mode != "wrong-kind" || diagnostic.Source.Path == "$.semantic.configuration.values."+test.key {
							found = true
						}
					}
				}
				if !found {
					t.Fatalf("%s missing %s at exact mutated node %s for %s: %#v", target, wantCode, test.nodeID, name, diagnostics)
				}
			}
		})
	}
}
func TestEcsSemanticDependenciesFailWithoutPartialOutput(t *testing.T) {
	mutations := map[string]func(*NormalizedSolution){
		"mutable-image-tag": func(m *NormalizedSolution) { ec2Set(m, "image", "digest", stringValueConfig("latest")) },
		"digest-length": func(m *NormalizedSolution) {
			ec2Set(m, "image", "digest", stringValueConfig("sha256:"+strings.Repeat("a", 63)))
		},
		"manifest-index":        func(m *NormalizedSolution) { ec2Set(m, "image", "manifestType", stringValueConfig("oci-index")) },
		"architecture-mismatch": func(m *NormalizedSolution) { ec2Set(m, "image", "architecture", stringValueConfig("arm64")) },
		"bad-cpu-memory":        func(m *NormalizedSolution) { ec2Set(m, "task", "memoryMiB", integerValue(8192)) },
		"unpublished-image": func(m *NormalizedSolution) {
			ec2Set(m, "image", "publicationStatus", stringValueConfig("external-publication-required"))
		},
		"unpopulated-secret": func(m *NormalizedSolution) {
			for i := range m.Connections {
				if m.Connections[i].ID == "secret_binding" {
					m.Connections[i].Configuration.Values["populationStatus"] = stringValueConfig("external-population-required")
				}
			}
		},
		"shared-role": func(m *NormalizedSolution) {
			for i := range m.Connections {
				if m.Connections[i].ID == "application_binding" {
					m.Connections[i].Source = m.Connections[0].Source
					role, _ := modelResource(m, "execution_role")
					m.Connections[i].Source = reference(role)
					m.Connections[i].Source.Port = "aws.iam.role.assumable-role"
				}
			}
		},
		"borrowed-role": func(m *NormalizedSolution) {
			for _, e := range m.Connections {
				if e.ID == "execution_binding" {
					e.ID = "borrowed_role"
					m.Connections = append(m.Connections, e)
					break
				}
			}
		},
		"wrong-trust-principal": func(m *NormalizedSolution) {
			ec2Set(m, "execution_role_trust_statement", "principals", stringList("lambda.amazonaws.com"))
		},
		"trust-resource-kind": func(m *NormalizedSolution) {
			ec2Set(m, "execution_role_trust_statement", "resourceExpressions", stringValueConfig(""))
		},
		"trust-scope": func(m *NormalizedSolution) {
			ec2Set(m, "execution_role_trust_statement", "statementScope", stringValueConfig("resource"))
		},
		"duplicate-attachment": func(m *NormalizedSolution) {
			for _, e := range m.Connections {
				if e.ID == "attachment_owner" {
					e.ID = "duplicate_attachment"
					m.Connections = append(m.Connections, e)
					break
				}
			}
		},
		"wrong-attachment-port": func(m *NormalizedSolution) {
			for i := range m.Connections {
				if m.Connections[i].ID == "attachment_owner" {
					m.Connections[i].Source.Port = "aws.iam.managed-policy-attachment.invalid"
				}
			}
		},
		"network-region": func(m *NormalizedSolution) {
			for i := range m.Resources {
				if m.Resources[i].ServiceType == serviceRegionBoundary {
					m.Resources[i].Configuration.Values["regionName"] = stringValueConfig("us-west-2")
				}
			}
		},
		"network-ancestor": func(m *NormalizedSolution) {
			for _, e := range m.Connections {
				if e.RelationshipType == "aws.region.contains-vpc" {
					ec2RemoveEdge(m, e.ID)
					break
				}
			}
		},
		"duplicate-repository-name": func(m *NormalizedSolution) {
			for _, n := range m.Resources {
				if n.ServiceType == serviceEcrRepository {
					n.ID = "repository_duplicate"
					n.TargetKey = "repository_duplicate"
					m.Resources = append(m.Resources, n)
					break
				}
			}
		},
		"missing-execution-policy": func(m *NormalizedSolution) { ec2RemoveEdge(m, "attachment_owner") },
		"substituted-managed-policy": func(m *NormalizedSolution) {
			ec2Set(m, "execution_attachment", "managedPolicyReference", stringValueConfig("aws-managed:ReadOnlyAccess"))
		},
		"missing-image-owner": func(m *NormalizedSolution) { ec2RemoveEdge(m, "image_owner") },
		"wrong-owner-parent": func(m *NormalizedSolution) {
			for i := range m.Resources {
				if m.Resources[i].ID == "container" {
					m.Resources[i].Parent.NodeID = "cluster"
				}
			}
		},
		"missing-container-owner": func(m *NormalizedSolution) { ec2RemoveEdge(m, "container_owner") },
		"missing-log-binding":     func(m *NormalizedSolution) { ec2RemoveEdge(m, "logs_binding") },
		"missing-subnet":          func(m *NormalizedSolution) { ec2RemoveEdge(m, "subnet_binding") },
		"missing-security-group":  func(m *NormalizedSolution) { ec2RemoveEdge(m, "group_binding") },
		"missing-cluster":         func(m *NormalizedSolution) { ec2RemoveEdge(m, "cluster_binding") },
		"missing-task":            func(m *NormalizedSolution) { ec2RemoveEdge(m, "task_binding") },
		"cmk-secret": func(m *NormalizedSolution) {
			ec2Set(m, "secret", "encryptionMode", stringValueConfig("customer-managed"))
		},
		"metadata-read-only": func(m *NormalizedSolution) {
			ec2Set(m, "secret_access_statement", "actions", stringList("secretsmanager:DescribeSecret"))
		},
		"missing-secret-scope": func(m *NormalizedSolution) { ec2RemoveEdge(m, "secret_scope") },
		"task-role-secret-read": func(m *NormalizedSolution) {
			app, _ := modelResource(m, "application_role")
			for i := range m.Resources {
				if m.Resources[i].ID == "secret_access" {
					m.Resources[i].Parent.NodeID = app.ID
					m.Resources[i].Parent.TargetKey = app.TargetKey
				}
			}
			for i := range m.Connections {
				if m.Connections[i].ID == "secret_access_owner" {
					m.Connections[i].Target = reference(app)
					m.Connections[i].Target.Port = "aws.iam.role.custom-inline-policy"
				}
			}
		},
		"reserved-secret-env": func(m *NormalizedSolution) {
			for i := range m.Connections {
				if m.Connections[i].ID == "secret_binding" {
					m.Connections[i].Configuration.Values["environmentName"] = stringValueConfig("AWS_ACCESS_KEY_ID")
				}
			}
		},
		"duplicate-secret-env": func(m *NormalizedSolution) {
			for _, e := range m.Connections {
				if e.ID == "secret_binding" {
					e.ID = "duplicate_env"
					m.Connections = append(m.Connections, e)
					break
				}
			}
		},
		"public-address": func(m *NormalizedSolution) { ec2Set(m, "service", "publicIpv4", boolValue(true)) },
		"exec-enabled":   func(m *NormalizedSolution) { ec2Set(m, "service", "executeCommand", boolValue(true)) },
		"root-user":      func(m *NormalizedSolution) { ec2Set(m, "container", "user", stringValueConfig("0:0")) },
		"writable-root":  func(m *NormalizedSolution) { ec2Set(m, "container", "readOnlyRoot", boolValue(false)) },
		"shell-health": func(m *NormalizedSolution) {
			ec2Set(m, "container", "healthExecutable", stringValueConfig("sh -c 'exit 0'"))
		},
		"bad-health-bounds": func(m *NormalizedSolution) { ec2Set(m, "container", "healthIntervalSeconds", integerValue(4)) },
		"privileged-port":   func(m *NormalizedSolution) { ec2Set(m, "container", "containerPort", integerValue(80)) },
	}
	for rel := range ecsContracts {
		key := "wrong-binding-" + rel
		mutations[key] = func(m *NormalizedSolution) {
			for i := range m.Connections {
				if m.Connections[i].RelationshipType == rel {
					m.Connections[i].Source.Port = "aws.invalid.port"
					break
				}
			}
		}
		if rel != ecsImageOwner && rel != ecsSecretBinding {
			continue
		}
		key = "unknown-binding-field-" + rel
		mutations[key] = func(m *NormalizedSolution) {
			for i := range m.Connections {
				if m.Connections[i].RelationshipType == rel {
					m.Connections[i].Configuration.Values["unreviewed"] = stringValueConfig("unsupported")
					break
				}
			}
		}
	}
	for name, mutate := range mutations {
		t.Run(name, func(t *testing.T) {
			for _, target := range []string{"terraform", "cloudformation"} {
				m := ecsModel(true)
				mutate(m)
				sortModel(m)
				a, d := kmsArtifact(m, target)
				if a != nil || !ecsHasErrors(d) {
					t.Fatalf("%s accepted %s: %v", target, name, d)
				}
			}
		})
	}
}
func TestEcsDistinctSecretEnvironmentsForOneSource(t *testing.T) {
	for _, target := range []string{"terraform", "cloudformation"} {
		m := ecsModel(true)
		for _, e := range m.Connections {
			if e.ID == "secret_binding" {
				e.ID = "second_environment"
				e.Configuration = Configuration{SchemaID: e.Configuration.SchemaID, SchemaVersion: e.Configuration.SchemaVersion, Values: map[string]ConfigurationValue{"environmentName": stringValueConfig("SECOND_CONFIG"), "populationStatus": stringValueConfig("externally-confirmed")}}
				m.Connections = append(m.Connections, e)
				break
			}
		}
		sortModel(m)
		a, d := kmsArtifact(m, target)
		assertNoTargetErrors(t, d)
		if a == nil {
			t.Fatal("missing bounded multi-environment export")
		}
	}
}
func TestEcsAllAdmittedCpuMemoryPairs(t *testing.T) {
	for cpu, mems := range map[int][]int{256: {512, 1024, 2048}, 512: {1024, 2048, 3072, 4096}, 1024: {2048, 3072, 4096, 5120, 6144, 7168, 8192}} {
		for _, mem := range mems {
			t.Run(fmt.Sprintf("%d/%d", cpu, mem), func(t *testing.T) {
				for _, target := range []string{"terraform", "cloudformation"} {
					m := ecsModel(false)
					ec2Set(m, "task", "cpu", integerValue(cpu))
					ec2Set(m, "task", "memoryMiB", integerValue(mem))
					a, d := kmsArtifact(m, target)
					assertNoTargetErrors(t, d)
					if a == nil {
						t.Fatal("missing export")
					}
				}
			})
		}
	}
}
