package compiler

import (
	"context"
	"encoding/json"
	"strconv"
	"strings"
	"testing"
)

func fsxModel(service string) *NormalizedSolution {
	model := networkingTerraformModel()
	model.Provenance.Catalog = CatalogReference{ID: TerraformCatalogID, Version: CurrentAwsCatalogVersion, Digest: CurrentAwsCatalogDigest}
	retained := map[string]bool{"region": true, "vpc": true, "az_a": true, "az_b": true, "private_a": true, "private_b": true, "security_group": true}
	resources := []NormalizedResource{}
	for _, r := range model.Resources {
		if retained[r.ID] {
			resources = append(resources, r)
		}
	}
	model.Resources = resources
	connections := []NormalizedConnection{}
	for _, e := range model.Connections {
		if retained[e.Source.NodeID] && retained[e.Target.NodeID] {
			connections = append(connections, e)
		}
	}
	model.Connections = connections
	model.Workloads = []NormalizedWorkload{}
	model.PolicyAttachments = []PolicyAttachment{}
	model.Outputs = []NormalizedOutput{}
	model.ExternalResources = []NormalizedExternalResource{}
	values := map[string]ConfigurationValue{}
	switch service {
	case serviceFsxLustre:
		values = map[string]ConfigurationValue{"storageCapacity": integerValue(1200), "perUnitStorageThroughput": integerValue(125), "dataCompressionType": stringValueConfig("LZ4")}
	case serviceFsxWindows:
		values = map[string]ConfigurationValue{"storageCapacity": integerValue(32), "throughputCapacity": integerValue(32), "deploymentType": stringValueConfig("MULTI_AZ_1"), "activeDirectoryId": stringValueConfig("d-0123456789"), "automaticBackupRetentionDays": integerValue(7)}
	case serviceFsxOpenZFS:
		values = map[string]ConfigurationValue{"storageCapacity": integerValue(64), "throughputCapacity": integerValue(160), "automaticBackupRetentionDays": integerValue(7), "clientCidr": stringValueConfig("10.20.0.0/16")}
	case serviceFsxONTAP:
		values = map[string]ConfigurationValue{"storageCapacity": integerValue(1024), "throughputCapacity": integerValue(1536), "automaticBackupRetentionDays": integerValue(7)}
	}
	storage := networkResource("fsx", "file_store", service, service+".configuration", "1.0.0", values)
	model.Resources = append(model.Resources, storage)
	subnet, _ := modelResource(model, "private_a")
	group, _ := modelResource(model, "security_group")
	model.Connections = append(model.Connections, networkConnection("fsx_subnet", service+"-uses-subnet", storage, subnet), networkConnection("fsx_security", service+"-uses-security-group", storage, group))
	if service == serviceFsxWindows {
		subnetB, _ := modelResource(model, "private_b")
		model.Connections = append(model.Connections, networkConnection("fsx_subnet_b", service+"-uses-subnet", storage, subnetB))
	}
	if service == serviceFsxLustre {
		for _, direction := range []string{"ingress", "egress"} {
			for index, ports := range [][2]int{{988, 988}, {1018, 1023}} {
				kind := serviceSecurityGroupIngressRule
				key := "sourceIpv4Cidr"
				if direction == "egress" {
					kind = serviceSecurityGroupEgressRule
					key = "destinationIpv4Cidr"
				}
				id := "lustre_" + direction + strconv.Itoa(index)
				rule := networkResource(id, id, kind, kind+".configuration", "1.0.0", map[string]ConfigurationValue{"protocol": stringValueConfig("tcp"), "fromPort": integerValue(ports[0]), "toPort": integerValue(ports[1]), key: stringValueConfig("10.20.0.0/16"), "description": stringValueConfig("Lustre internal traffic")})
				setNetworkParent(&rule, group)
				model.Resources = append(model.Resources, rule)
				model.Connections = append(model.Connections, networkConnection(id+"_owner", "aws.ec2.security-group-owns-"+direction+"-rule", rule, group))
			}
		}
		bucket := eventResource("fsx_bucket", "processed_files", "aws.s3.bucket", map[string]ConfigurationValue{"blockPublicAccess": boolValue(true), "bucketName": stringValueConfig("synthetic-processed-files"), "deletionProtectionEnabled": boolValue(true), "encryption": stringValueConfig("SSE-S3"), "objectOwnership": stringValueConfig("BucketOwnerEnforced"), "versioningEnabled": boolValue(true)})
		model.Resources = append(model.Resources, bucket)
		model.Connections = append(model.Connections, networkConnection("fsx_s3", fsxRepositoryRelationship, storage, bucket))
	}
	if service == serviceFsxONTAP {
		svm := networkResource("svm", "file_svm", serviceFsxSVM, serviceFsxSVM+".configuration", "1.0.0", map[string]ConfigurationValue{"name": stringValueConfig("svm")})
		volume := networkResource("volume", "shared_volume", serviceFsxVolume, serviceFsxVolume+".configuration", "1.0.0", map[string]ConfigurationValue{"name": stringValueConfig("share"), "sizeInMegabytes": integerValue(102400), "junctionPath": stringValueConfig("/share")})
		model.Resources = append(model.Resources, svm, volume)
		model.Connections = append(model.Connections, networkConnection("svm_fs", fsxSVMRelationship, svm, storage), networkConnection("volume_svm", fsxVolumeRelationship, volume, svm))
	}
	sortModel(model)
	return model
}

func TestFsxFamiliesRenderBothTargetsReproducibly(t *testing.T) {
	for _, family := range []string{serviceFsxLustre, serviceFsxWindows, serviceFsxOpenZFS, serviceFsxONTAP} {
		t.Run(family, func(t *testing.T) {
			model := fsxModel(family)
			for _, target := range []string{"terraform", "cloudformation"} {
				t.Run(target, func(t *testing.T) {
					var first *TargetArtifact
					for repeat := 0; repeat < 3; repeat++ {
						var artifact *TargetArtifact
						var diagnostics []Diagnostic
						if target == "terraform" {
							artifact, diagnostics = renderTerraformArtifact(context.Background(), model, nil, DefaultLimits())
						} else {
							artifact, diagnostics = renderCloudFormationArtifact(context.Background(), model, nil, DefaultLimits())
						}
						assertNoTargetErrors(t, diagnostics)
						if artifact == nil {
							t.Fatal("missing artifact")
						}
						if first != nil && artifact.Digest != first.Digest {
							t.Fatal("FSx artifact is not reproducible")
						}
						first = artifact
					}
					encoded, _ := json.Marshal(first)
					if !strings.Contains(string(encoded), "FSx") && !strings.Contains(string(encoded), "aws_fsx_") {
						t.Fatal("missing file system")
					}
					if family == serviceFsxLustre {
						if !strings.Contains(string(encoded), "DataRepositoryAssociation") && !strings.Contains(string(encoded), "aws_fsx_data_repository_association") {
							t.Fatal("missing exact S3 repository association")
						}
						if strings.Contains(string(encoded), "DELETED") {
							t.Fatal("S3 import must not silently propagate deletions")
						}
					}
					if family == serviceFsxONTAP {
						if !strings.Contains(string(encoded), "StorageVirtualMachine") && !strings.Contains(string(encoded), "aws_fsx_ontap_storage_virtual_machine") {
							t.Fatal("missing SVM")
						}
					}
				})
			}
		})
	}
}

func TestFsxRejectsInvalidBindingsBeforeEitherTarget(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*NormalizedSolution)
	}{
		{"historical catalog", func(m *NormalizedSolution) {
			m.Provenance.Catalog = CatalogReference{ID: TerraformCatalogID, Version: "0.16.0", Digest: "sha256:b8ae0f69d0fceae28e631e9036b745d2e8988967daee0a0b217e0da392d704d6"}
		}},
		{"missing Lustre range", func(m *NormalizedSolution) {
			for i := range m.Resources {
				if m.Resources[i].ID == "lustre_ingress1" {
					m.Resources[i].Configuration.Values["toPort"] = integerValue(1022)
				}
			}
		}},
		{"Lustre CIDR excludes file servers", func(m *NormalizedSolution) {
			for i := range m.Resources {
				if m.Resources[i].ID == "lustre_ingress0" {
					m.Resources[i].Configuration.Values["sourceIpv4Cidr"] = stringValueConfig("10.20.255.0/24")
				}
			}
		}},
		{"Lustre wrong protocol", func(m *NormalizedSolution) {
			for i := range m.Resources {
				if m.Resources[i].ID == "lustre_egress1" {
					m.Resources[i].Configuration.Values["protocol"] = stringValueConfig("udp")
				}
			}
		}},
		{"missing subnet", func(m *NormalizedSolution) {
			edges := []NormalizedConnection{}
			for _, e := range m.Connections {
				if e.ID != "fsx_subnet" {
					edges = append(edges, e)
				}
			}
			m.Connections = edges
		}},
		{"wrong endpoint", func(m *NormalizedSolution) {
			for i := range m.Connections {
				if m.Connections[i].ID == "fsx_subnet" {
					m.Connections[i].Target.Port = "aws.ec2.subnet.lambda-vpc-access"
				}
			}
		}},
		{"invalid capacity", func(m *NormalizedSolution) {
			for i := range m.Resources {
				if m.Resources[i].ID == "fsx" {
					m.Resources[i].Configuration.Values["storageCapacity"] = integerValue(1201)
				}
			}
		}},
		{"extra configuration", func(m *NormalizedSolution) {
			for i := range m.Resources {
				if m.Resources[i].ID == "fsx" {
					m.Resources[i].Configuration.Values["password"] = stringValueConfig("synthetic")
				}
			}
		}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			m := fsxModel(serviceFsxLustre)
			test.mutate(m)
			for _, target := range []string{"terraform", "cloudformation"} {
				var artifact *TargetArtifact
				var diagnostics []Diagnostic
				if target == "terraform" {
					artifact, diagnostics = renderTerraformArtifact(context.Background(), m, nil, DefaultLimits())
				} else {
					artifact, diagnostics = renderCloudFormationArtifact(context.Background(), m, nil, DefaultLimits())
				}
				if artifact != nil {
					t.Fatalf("%s published invalid input", target)
				}
				found := false
				for _, d := range diagnostics {
					if d.Severity == SeverityError {
						found = true
					}
				}
				if !found {
					t.Fatal("missing error")
				}
			}
		})
	}
}

func TestFsxWindowsMultiAZCanonicalPlacement(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*NormalizedSolution)
	}{
		{"distinct zones", func(m *NormalizedSolution) {}},
		{"physical alias", func(m *NormalizedSolution) { setResourceValue(m, "az_b", "zoneName", stringValueConfig("us-east-1a")) }},
		{"foreign zone", func(m *NormalizedSolution) { setResourceValue(m, "az_b", "zoneName", stringValueConfig("us-west-2b")) }},
		{"missing backing edge", func(m *NormalizedSolution) {
			connections := []NormalizedConnection{}
			for _, edge := range m.Connections {
				if edge.RelationshipType != "aws.ec2.availability-zone-contains-subnet" || edge.Target.NodeID != "private_b" {
					connections = append(connections, edge)
				}
			}
			m.Connections = connections
		}},
		{"wrong parent relationship", func(m *NormalizedSolution) {
			for i := range m.Resources {
				if m.Resources[i].ID == "az_b" {
					m.Resources[i].Parent.RelationshipType = "aws.region.contains-vpc"
				}
			}
		}},
		{"foreign Region boundary", func(m *NormalizedSolution) {
			setResourceValue(m, "region", "regionName", stringValueConfig("us-west-2"))
		}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			model := fsxModel(serviceFsxWindows)
			test.mutate(model)
			before, _ := json.Marshal(model)
			for _, target := range []string{"terraform", "cloudformation"} {
				var artifact *TargetArtifact
				var diagnostics []Diagnostic
				if target == "terraform" {
					artifact, diagnostics = renderTerraformArtifact(context.Background(), model, nil, DefaultLimits())
				} else {
					artifact, diagnostics = renderCloudFormationArtifact(context.Background(), model, nil, DefaultLimits())
				}
				if test.name == "distinct zones" {
					assertNoTargetErrors(t, diagnostics)
					if artifact == nil {
						t.Fatalf("%s omitted valid artifact", target)
					}
				} else {
					if artifact != nil {
						t.Errorf("%s published invalid physical placement", target)
					}
					found := false
					code := "TARGET_FSX_CONFIGURATION_INVALID"
					if target == "cloudformation" {
						code = "CLOUDFORMATION_FSX_CONFIGURATION_INVALID"
					}
					for _, diagnostic := range diagnostics {
						if diagnostic.Code == code && diagnostic.Severity == SeverityError {
							found = true
						}
					}
					if !found {
						t.Errorf("%s missing FSx placement error: %#v", target, diagnostics)
					}
				}
			}
			after, _ := json.Marshal(model)
			if string(before) != string(after) {
				t.Fatal("Validation rewrote stored settings or placement")
			}
		})
	}
}
