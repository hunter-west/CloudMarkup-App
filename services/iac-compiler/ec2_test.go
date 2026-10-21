package compiler

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/hashicorp/hcl/v2"
	"github.com/hashicorp/hcl/v2/hclsyntax"
)

func ec2Model(customer bool) *NormalizedSolution {
	m := secretModel(false)
	m.Provenance.Catalog = CatalogReference{ID: TerraformCatalogID, Version: CurrentAwsCatalogVersion, Digest: CurrentAwsCatalogDigest}
	region := networkResource("region", "region", serviceRegionBoundary, serviceRegionBoundary+".configuration", "1.0.0", map[string]ConfigurationValue{"regionName": stringValueConfig("us-east-1")})
	vpc := networkResource("vpc", "vpc", serviceVPC, serviceVPC+".configuration", "1.0.0", map[string]ConfigurationValue{"cidrBlock": stringValueConfig("10.20.0.0/16"), "enableDnsHostnames": boolValue(true), "enableDnsSupport": boolValue(true), "instanceTenancy": stringValueConfig("default")})
	setNetworkParent(&vpc, region)
	az := networkResource("az", "az", serviceAvailabilityZone, serviceAvailabilityZone+".configuration", "1.0.0", map[string]ConfigurationValue{"zoneName": stringValueConfig("us-east-1a")})
	setNetworkParent(&az, vpc)
	subnet := networkSubnet("subnet", "10.20.1.0/24", "private", false, az)
	table := networkRouteTable("private", vpc)
	association := networkAssociation("private", table)
	group := networkResource("group", "group", serviceSecurityGroup, serviceSecurityGroup+".configuration", "1.0.0", map[string]ConfigurationValue{"groupName": stringValueConfig("synthetic-private-instance"), "description": stringValueConfig("Explicit private workload policy")})
	profile := networkResource("profile", "profile", serviceInstanceProfile, serviceInstanceProfile+".configuration", "1.0.0", map[string]ConfigurationValue{"name": stringValueConfig("synthetic-instance-profile"), "path": stringValueConfig("/")})
	role := networkResource("ec2_role", "ec2_role", "aws.iam.role", "aws.iam.role.configuration", "2.0.0", map[string]ConfigurationValue{"roleName": stringValueConfig("synthetic-ec2-role"), "maxSessionDurationSeconds": integerValue(3600)})
	mode := "default-key"
	if customer {
		mode = "customer-managed"
	}
	instance := networkResource("instance", "instance", serviceEc2Instance, serviceEc2Instance+".configuration", "1.0.0", map[string]ConfigurationValue{
		"imageId": stringValueConfig("ami-0123456789abcdef0"), "imageRegion": stringValueConfig("us-east-1"), "imageArchitecture": stringValueConfig("x86_64"), "imageOperatingSystem": stringValueConfig("linux"), "imageVirtualization": stringValueConfig("hvm"), "imageRootDeviceType": stringValueConfig("ebs"), "imageRootDeviceName": stringValueConfig("/dev/xvda"), "imageRootMinimumGiB": integerValue(8), "imageRootOnly": boolValue(true), "instanceType": stringValueConfig("t3.small"), "tenancy": stringValueConfig("default"), "cpuCreditMode": stringValueConfig("standard"), "publicIpv4": boolValue(false), "rootSizeGiB": integerValue(30), "rootVolumeType": stringValueConfig("gp3"), "rootEncrypted": boolValue(true), "rootIops": integerValue(3000), "rootThroughputMiBps": integerValue(125), "rootDeleteOnTermination": boolValue(false), "rootEncryptionMode": stringValueConfig(mode), "metadataAuthentication": stringValueConfig("required"), "metadataEndpoint": stringValueConfig("enabled"), "metadataHopLimit": integerValue(1), "metadataIpv6": stringValueConfig("disabled"), "metadataTags": stringValueConfig("disabled"), "detailedMonitoring": boolValue(false),
	})
	m.Resources = []NormalizedResource{region, vpc, az, subnet, table, association, group, profile, role, instance}
	m.Connections = []NormalizedConnection{
		networkConnection("region_vpc", "aws.region.contains-vpc", region, vpc), networkConnection("vpc_az", "aws.ec2.vpc-contains-availability-zone", vpc, az), networkConnection("az_subnet", "aws.ec2.availability-zone-contains-subnet", az, subnet), networkConnection("vpc_table", "aws.ec2.vpc-contains-route-table", vpc, table), networkConnection("table_association", "aws.ec2.route-table-owns-subnet-association", association, table), networkConnection("association_subnet", "aws.ec2.route-table-association-targets-subnet", association, subnet), networkConnection("vpc_group", "aws.ec2.vpc-associates-security-group", vpc, group), networkConnection("instance_subnet", ec2SubnetRelationship, instance, subnet), networkConnection("instance_group", ec2GroupRelationship, instance, group), networkConnection("role_profile", ec2RoleRelationship, role, profile), networkConnection("profile_instance", ec2ProfileRelationship, profile, instance),
	}
	addPolicy(m, "ec2_trust", "trust", role, "aws.iam.role-owns-trust-policy", []string{"sts:AssumeRole"}, "service", []string{"ec2.amazonaws.com"}, nil, false, nil)
	for i := range m.Resources {
		r := &m.Resources[i]
		if r.ID == "ec2_trust" {
			r.Parent = &ResourceReference{NodeID: role.ID, TargetKey: role.TargetKey, RelationshipType: "aws.iam.role-owns-trust-policy"}
		}
		if r.ID == "ec2_trust_statement" {
			r.Configuration.SchemaVersion = "2.0.0"
			r.Parent = &ResourceReference{NodeID: "ec2_trust", TargetKey: "ec2_trust", RelationshipType: "aws.iam.policy-contains-statement"}
		}
	}
	for i := range m.Connections {
		e := &m.Connections[i]
		if e.ID == "ec2_trust_owner" {
			e.Source.Port = "aws.iam.policy-document.role-trust-policy"
			e.Target.Port = "aws.iam.role.trust-policy"
			e.Configuration.SchemaID = "aws.iam.role-trust-policy.attachment"
		}
		if e.ID == "ec2_trust_membership" {
			e.Source.Port = "aws.iam.policy-statement.policy-document"
			e.Target.Port = "aws.iam.policy-document.statement"
		}
	}
	if customer {
		k := kmsModel()
		m.Resources = append(m.Resources, k.Resources...)
		m.Connections = append(m.Connections, k.Connections...)
		key, _ := modelResource(m, "encryption_key")
		binding := networkConnection("root_key", ec2RootKeyRelationship, key, instance)
		binding.Configuration.SchemaID = "aws.kms.key-encrypts-instance-root.connection"
		m.Connections = append(m.Connections, binding)
	}
	m.Outputs = []NormalizedOutput{}
	for _, attribute := range []string{"id", "privateIp", "privateDns"} {
		ref := reference(instance)
		ref.Attribute = serviceEc2Instance + "." + attribute
		m.Outputs = append(m.Outputs, NormalizedOutput{ID: "output_" + attribute, Key: attribute, Kind: "node-attribute", Resource: &ref})
	}
	sortModel(m)
	return m
}
func ec2Set(m *NormalizedSolution, id, key string, value ConfigurationValue) {
	for i := range m.Resources {
		if m.Resources[i].ID == id {
			m.Resources[i].Configuration.Values[key] = value
			return
		}
	}
	panic("fixture resource missing")
}
func ec2RemoveEdge(m *NormalizedSolution, id string) {
	edges := []NormalizedConnection{}
	for _, e := range m.Connections {
		if e.ID != id {
			edges = append(edges, e)
		}
	}
	m.Connections = edges
}
func TestEc2BothTargetsExactLaunchAndGolden(t *testing.T) {
	for _, target := range []string{"terraform", "cloudformation"} {
		t.Run(target, func(t *testing.T) {
			m := ec2Model(true)
			before := cloneNormalized(t, m)
			a, d := kmsArtifact(m, target)
			assertNoTargetErrors(t, d)
			if a == nil {
				t.Fatal("missing export")
			}
			if !reflect.DeepEqual(m, before) {
				t.Fatal("source mutated")
			}
			name := "compute.tf"
			filePath := "infrastructure/compute.tf"
			if target == "cloudformation" {
				filePath = cloudFormationTemplatePath
				name = "template.json"
			}
			content := fileContent(t, a, filePath)
			for _, bad := range []string{"user_data", "UserData", "key_name", "KeyName", "aws_ami", "resolve:ssm", "password", "aws_network_interface\"", "AWS::EC2::NetworkInterface\"", "aws_ebs_volume", "AWS::EC2::Volume\""} {
				if strings.Contains(content, bad) {
					t.Fatalf("unsupported launch construct %s", bad)
				}
			}
			if target == "terraform" {
				for _, file := range a.Files {
					if strings.HasSuffix(file.Path, ".tf") {
						if _, diagnostics := hclsyntax.ParseConfig([]byte(file.Content), file.Path, hcl.InitialPos); diagnostics.HasErrors() {
							t.Fatalf("invalid generated HCL: %s", diagnostics.Error())
						}
					}
				}
				for _, piece := range []string{"ami-0123456789abcdef0", "aws_iam_instance_profile.profile.name", "aws_subnet.subnet_subnet.id", "aws_security_group.group.id", "associate_public_ip_address = false", "http_tokens", "required", "throughput", "125", "aws_kms_key.application_key.arn", "delete_on_termination = false"} {
					if !strings.Contains(content, piece) {
						t.Fatalf("missing exact launch field %s", piece)
					}
				}
				identity := fileContent(t, a, "infrastructure/identity.tf")
				if !strings.Contains(identity, "aws_iam_instance_profile") || !strings.Contains(identity, "aws_iam_role.ec2_role.name") {
					t.Fatal("profile does not bind actual role name")
				}
			} else {
				var template map[string]any
				if err := json.Unmarshal([]byte(content), &template); err != nil {
					t.Fatal(err)
				}
				resources := template["Resources"].(map[string]any)
				seen := map[string]int{}
				for _, raw := range resources {
					resource := raw.(map[string]any)
					kind := resource["Type"].(string)
					seen[kind]++
					p := resource["Properties"].(map[string]any)
					if kind == "AWS::EC2::Instance" {
						root := p["BlockDeviceMappings"].([]any)[0].(map[string]any)
						if root["DeviceName"] != "/dev/xvda" {
							t.Fatal("root device guessed")
						}
						ebs := root["Ebs"].(map[string]any)
						if _, exists := ebs["Throughput"]; exists {
							t.Fatal("unsupported CF throughput")
						}
						if ebs["Iops"] != float64(3000) || ebs["Encrypted"] != true || ebs["DeleteOnTermination"] != false {
							t.Fatal("root contract lost")
						}
						network := p["NetworkInterfaces"].([]any)[0].(map[string]any)
						if network["DeviceIndex"] != "0" || network["AssociatePublicIpAddress"] != false || network["DeleteOnTermination"] != true {
							t.Fatal("private primary interface lost")
						}
						if _, exists := p["SubnetId"]; exists {
							t.Fatal("duplicate network ownership")
						}
						if _, exists := p["SecurityGroupIds"]; exists {
							t.Fatal("duplicate group ownership")
						}
						if _, ok := p["IamInstanceProfile"].(map[string]any)["Ref"]; !ok {
							t.Fatal("profile not typed Ref")
						}
					}
					if kind == "AWS::IAM::InstanceProfile" {
						if _, exists := p["Tags"]; exists {
							t.Fatal("unsupported profile Tags")
						}
						if len(p["Roles"].([]any)) != 1 {
							t.Fatal("profile role lost")
						}
					}
				}
				if seen["AWS::EC2::Instance"] != 1 || seen["AWS::IAM::InstanceProfile"] != 1 {
					t.Fatal("launch resources missing")
				}
			}
			dir := filepath.Join("testdata", "ec2-goldens-v1")
			file := filepath.Join(dir, name)
			if os.Getenv("UPDATE_EC2_GOLDENS") == "1" {
				if err := os.MkdirAll(dir, 0755); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(file, []byte(content), 0644); err != nil {
					t.Fatal(err)
				}
			}
			expected, err := os.ReadFile(file)
			if err != nil || string(expected) != content {
				t.Fatalf("EC2 golden mismatch %s: %v", file, err)
			}
			for i := 0; i < 3; i++ {
				copy := cloneNormalized(t, m)
				reversePrompt30Model(copy)
				sortModel(copy)
				again, diag := kmsArtifact(copy, target)
				assertNoTargetErrors(t, diag)
				if again == nil || a.Digest != again.Digest || !reflect.DeepEqual(a.Files, again.Files) {
					t.Fatal("launch export not byte-reproducible")
				}
			}
		})
	}
}
func TestEc2RejectsInvalidLaunchWithoutPartialArtifact(t *testing.T) {
	cases := []struct {
		name   string
		mutate func(*NormalizedSolution)
	}{
		{"unknown-field", func(m *NormalizedSolution) { ec2Set(m, "instance", "userData", stringValueConfig("unsupported")) }},
		{"missing-image", func(m *NormalizedSolution) {
			for i := range m.Resources {
				if m.Resources[i].ID == "instance" {
					delete(m.Resources[i].Configuration.Values, "imageId")
				}
			}
		}},
		{"parameter-image", func(m *NormalizedSolution) { ec2Set(m, "instance", "imageId", stringValueConfig("resolve:ssm:/image")) }},
		{"region", func(m *NormalizedSolution) { ec2Set(m, "instance", "imageRegion", stringValueConfig("us-west-2")) }},
		{"architecture", func(m *NormalizedSolution) { ec2Set(m, "instance", "imageArchitecture", stringValueConfig("arm64")) }},
		{"instance-type", func(m *NormalizedSolution) { ec2Set(m, "instance", "instanceType", stringValueConfig("m8i.large")) }},
		{"windows", func(m *NormalizedSolution) {
			ec2Set(m, "instance", "imageOperatingSystem", stringValueConfig("windows"))
		}},
		{"virtualization", func(m *NormalizedSolution) {
			ec2Set(m, "instance", "imageVirtualization", stringValueConfig("paravirtual"))
		}},
		{"image-data-mappings", func(m *NormalizedSolution) { ec2Set(m, "instance", "imageRootOnly", boolValue(false)) }},
		{"root-device", func(m *NormalizedSolution) {
			ec2Set(m, "instance", "imageRootDeviceName", stringValueConfig("/dev/sdf"))
		}},
		{"root-shrink", func(m *NormalizedSolution) { ec2Set(m, "instance", "rootSizeGiB", integerValue(7)) }},
		{"root-size-bound", func(m *NormalizedSolution) { ec2Set(m, "instance", "rootSizeGiB", integerValue(16385)) }},
		{"root-minimum-zero", func(m *NormalizedSolution) { ec2Set(m, "instance", "imageRootMinimumGiB", integerValue(0)) }},
		{"root-fraction", func(m *NormalizedSolution) {
			ec2Set(m, "instance", "rootSizeGiB", ConfigurationValue{Kind: "integer", Value: 1.5})
		}},
		{"root-encryption", func(m *NormalizedSolution) { ec2Set(m, "instance", "rootEncrypted", boolValue(false)) }},
		{"root-type", func(m *NormalizedSolution) { ec2Set(m, "instance", "rootVolumeType", stringValueConfig("gp2")) }},
		{"alternate-throughput", func(m *NormalizedSolution) { ec2Set(m, "instance", "rootThroughputMiBps", integerValue(250)) }},
		{"alternate-iops", func(m *NormalizedSolution) { ec2Set(m, "instance", "rootIops", integerValue(6000)) }},
		{"imds-v1", func(m *NormalizedSolution) {
			ec2Set(m, "instance", "metadataAuthentication", stringValueConfig("optional"))
		}},
		{"metadata-zero", func(m *NormalizedSolution) { ec2Set(m, "instance", "metadataHopLimit", integerValue(0)) }},
		{"metadata-overflow", func(m *NormalizedSolution) { ec2Set(m, "instance", "metadataHopLimit", integerValue(65)) }},
		{"public-ip", func(m *NormalizedSolution) { ec2Set(m, "instance", "publicIpv4", boolValue(true)) }},
		{"wrong-bool-kind", func(m *NormalizedSolution) { ec2Set(m, "instance", "publicIpv4", stringValueConfig("false")) }},
		{"unlimited-credits", func(m *NormalizedSolution) { ec2Set(m, "instance", "cpuCreditMode", stringValueConfig("unlimited")) }},
		{"missing-subnet", func(m *NormalizedSolution) { ec2RemoveEdge(m, "instance_subnet") }},
		{"missing-group", func(m *NormalizedSolution) { ec2RemoveEdge(m, "instance_group") }},
		{"missing-profile", func(m *NormalizedSolution) { ec2RemoveEdge(m, "profile_instance") }},
		{"missing-role", func(m *NormalizedSolution) { ec2RemoveEdge(m, "role_profile") }},
		{"trust-principal", func(m *NormalizedSolution) {
			ec2Set(m, "ec2_trust_statement", "principals", stringList("lambda.amazonaws.com"))
		}},
		{"trust-wildcard", func(m *NormalizedSolution) { ec2Set(m, "ec2_trust_statement", "principals", stringList("*")) }},
		{"trust-extra-action", func(m *NormalizedSolution) {
			ec2Set(m, "ec2_trust_statement", "actions", stringList("sts:AssumeRole", "sts:TagSession"))
		}},
		{"trust-scope", func(m *NormalizedSolution) { ec2Set(m, "ec2_trust_statement", "resourceExpressions", stringList("*")) }},
		{"profile-arn-name", func(m *NormalizedSolution) {
			ec2Set(m, "profile", "name", stringValueConfig("arn:aws:iam::000000000000:role/example"))
		}},
		{"profile-path", func(m *NormalizedSolution) { ec2Set(m, "profile", "path", stringValueConfig("/other/")) }},
		{"missing-customer-key", func(m *NormalizedSolution) { ec2RemoveEdge(m, "root_key") }},
		{"disabled-key", func(m *NormalizedSolution) { ec2Set(m, "encryption_key", "enabled", boolValue(false)) }},
		{"default-with-key", func(m *NormalizedSolution) {
			ec2Set(m, "instance", "rootEncryptionMode", stringValueConfig("default-key"))
		}},
		{"wrong-binding-schema", func(m *NormalizedSolution) {
			for i := range m.Connections {
				if m.Connections[i].ID == "root_key" {
					m.Connections[i].Configuration.SchemaID = "other.connection"
				}
			}
		}},
		{"reversed-binding", func(m *NormalizedSolution) {
			for i := range m.Connections {
				if m.Connections[i].ID == "profile_instance" {
					m.Connections[i].Source, m.Connections[i].Target = m.Connections[i].Target, m.Connections[i].Source
				}
			}
		}},
		{"duplicate-binding", func(m *NormalizedSolution) {
			for _, e := range m.Connections {
				if e.ID == "instance_subnet" {
					e.ID = "duplicate_subnet"
					m.Connections = append(m.Connections, e)
					break
				}
			}
		}},
		{"generated-instance", func(m *NormalizedSolution) {
			for i := range m.Resources {
				if m.Resources[i].ID == "instance" {
					m.Resources[i].Lifecycle.Ownership = "generated"
				}
			}
		}},
		{"historical-secret-catalog", func(m *NormalizedSolution) {
			m.Provenance.Catalog = CatalogReference{ID: TerraformCatalogID, Version: "0.16.0", Digest: "sha256:b8ae0f69d0fceae28e631e9036b745d2e8988967daee0a0b217e0da392d704d6"}
		}},
		{"trust-resource-kind", func(m *NormalizedSolution) {
			ec2Set(m, "ec2_trust_statement", "resourceExpressions", stringValueConfig(""))
		}},
		{"trust-schema", func(m *NormalizedSolution) {
			for i := range m.Resources {
				if m.Resources[i].ID == "ec2_trust_statement" {
					m.Resources[i].Configuration.SchemaVersion = "1.0.0"
				}
			}
		}},
		{"trust-parent", func(m *NormalizedSolution) {
			for i := range m.Resources {
				if m.Resources[i].ID == "ec2_trust" {
					m.Resources[i].Parent = nil
				}
			}
		}},
		{"trust-member-port", func(m *NormalizedSolution) {
			for i := range m.Connections {
				if m.Connections[i].ID == "ec2_trust_membership" {
					m.Connections[i].Target.Port = "aws.iam.policy-document.role-trust-policy"
				}
			}
		}},
		{"profile-external", func(m *NormalizedSolution) {
			m.ExternalResources = append(m.ExternalResources, NormalizedExternalResource{ID: "external_profile", ResourceType: serviceInstanceProfile, ArchitectureNodes: []ResourceReference{{NodeID: "profile", TargetKey: "profile"}}})
		}},
		{"role-external", func(m *NormalizedSolution) {
			m.ExternalResources = append(m.ExternalResources, NormalizedExternalResource{ID: "external_role", ResourceType: "aws.iam.role", ArchitectureNodes: []ResourceReference{{NodeID: "ec2_role", TargetKey: "ec2_role"}}})
		}},
		{"role-aggregate-consumer", func(m *NormalizedSolution) {
			role, _ := modelResource(m, "ec2_role")
			profile, _ := modelResource(m, "profile")
			e := networkConnection("extra_role_consumer", ec2RoleRelationship, role, profile)
			m.Connections = append(m.Connections, e)
		}},
		{"cross-vpc", func(m *NormalizedSolution) {
			vpc, _ := modelResource(m, "vpc")
			vpc.ID, vpc.TargetKey = "other_vpc", "other_vpc"
			m.Resources = append(m.Resources, vpc)
			region, _ := modelResource(m, "region")
			group, _ := modelResource(m, "group")
			ec2RemoveEdge(m, "vpc_group")
			m.Connections = append(m.Connections, networkConnection("region_other_vpc", "aws.region.contains-vpc", region, vpc), networkConnection("other_vpc_group", "aws.ec2.vpc-associates-security-group", vpc, group))
		}},
		{"duplicate-profile-name", func(m *NormalizedSolution) {
			profile, _ := modelResource(m, "profile")
			profile.ID, profile.TargetKey = "other_profile", "other_profile"
			m.Resources = append(m.Resources, profile)
		}},
		{"unreviewed-output", func(m *NormalizedSolution) { m.Outputs[0].Resource.Attribute = serviceEc2Instance + ".arn" }},
	}
	for _, target := range []string{"terraform", "cloudformation"} {
		for _, tc := range cases {
			t.Run(target+"/"+tc.name, func(t *testing.T) {
				m := ec2Model(true)
				tc.mutate(m)
				a, d := kmsArtifact(m, target)
				if a != nil || !hasErrorDiagnostics(d) {
					t.Fatalf("invalid launch admitted: artifact=%v diagnostics=%v", a != nil, d)
				}
				if tc.name == "profile-path" || target == "cloudformation" && tc.name == "historical-secret-catalog" {
					code, nodeID, path := "TARGET_EC2_PROFILE_CONFIGURATION_INVALID", "profile", ""
					if target == "cloudformation" {
						code = "CLOUDFORMATION_EC2_PROFILE_CONFIGURATION_INVALID"
					}
					if tc.name == "historical-secret-catalog" {
						code, nodeID, path = "CLOUDFORMATION_CATALOG_UNSUPPORTED", "", "$.catalog"
					}
					found := false
					for _, diagnostic := range d {
						if diagnostic.Code == code && diagnostic.Severity == SeverityError && diagnostic.Source.Document == DocumentArchitecture && diagnostic.Source.NodeID == nodeID && diagnostic.Source.Path == path {
							found = true
						}
					}
					if !found {
						t.Fatalf("missing exact %s refusal: %v", code, d)
					}
				}
				if tc.name == "parameter-image" {
					expected := "TARGET_EC2_IMAGE_INVALID"
					if target == "cloudformation" {
						expected = "CLOUDFORMATION_EC2_IMAGE_INVALID"
					}
					found := false
					for _, diagnostic := range d {
						if diagnostic.Code == expected && diagnostic.Severity == SeverityError && diagnostic.Source.Document == DocumentArchitecture && diagnostic.Source.NodeID == "instance" {
							found = true
						}
					}
					if !found {
						t.Fatalf("missing static-image rejection %s: %v", expected, d)
					}
				}
				if tc.name == "cross-vpc" || tc.name == "duplicate-profile-name" {
					expected := map[string]string{"cross-vpc": "TARGET_EC2_CROSS_VPC_INVALID", "duplicate-profile-name": "TARGET_EC2_PROFILE_NAME_DUPLICATE"}[tc.name]
					if target == "cloudformation" {
						expected = strings.Replace(expected, "TARGET_", "CLOUDFORMATION_", 1)
					}
					found := false
					for _, diagnostic := range d {
						if diagnostic.Code == expected {
							found = true
						}
					}
					if !found {
						t.Fatalf("missing specific contract rejection %s: %v", expected, d)
					}
				}
			})
		}
	}
}
func TestEc2ProfileOutputsAreTyped(t *testing.T) {
	for _, target := range []string{"terraform", "cloudformation"} {
		t.Run(target, func(t *testing.T) {
			m := ec2Model(false)
			profile, _ := modelResource(m, "profile")
			m.Outputs = []NormalizedOutput{}
			for _, attribute := range []string{"name", "arn"} {
				ref := reference(profile)
				ref.Attribute = serviceInstanceProfile + "." + attribute
				m.Outputs = append(m.Outputs, NormalizedOutput{ID: "output_profile_" + attribute, Key: "profile_" + attribute, Kind: "node-attribute", Resource: &ref})
			}
			a, diagnostics := kmsArtifact(m, target)
			assertNoTargetErrors(t, diagnostics)
			if a == nil {
				t.Fatal("missing profile output export")
			}
			if target == "terraform" {
				content := fileContent(t, a, "infrastructure/outputs.tf")
				for _, attr := range []string{"name", "arn"} {
					if !strings.Contains(content, "aws_iam_instance_profile.profile."+attr) {
						t.Fatal("profile output lost typed attribute")
					}
				}
			} else {
				var template map[string]any
				if err := json.Unmarshal([]byte(fileContent(t, a, cloudFormationTemplatePath)), &template); err != nil {
					t.Fatal(err)
				}
				outputs := template["Outputs"].(map[string]any)
				seenRef, seenArn := false, false
				for _, output := range outputs {
					value := output.(map[string]any)["Value"].(map[string]any)
					if _, ok := value["Ref"]; ok {
						seenRef = true
					}
					if attr, ok := value["Fn::GetAtt"].([]any); ok && len(attr) == 2 && attr[1] == "Arn" {
						seenArn = true
					}
				}
				if !seenRef || !seenArn {
					t.Fatal("profile output lost native Ref/Arn authority")
				}
			}
		})
	}
}
func TestEc2ArchitectureCompileAndVariants(t *testing.T) {
	for _, target := range []TargetKind{TargetTerraform, TargetCloudFormation} {
		for _, arm := range []bool{false, true} {
			t.Run(string(target)+map[bool]string{false: "/x86", true: "/arm"}[arm], func(t *testing.T) {
				m := ec2Model(false)
				if arm {
					ec2Set(m, "instance", "instanceType", stringValueConfig("t4g.small"))
					ec2Set(m, "instance", "imageArchitecture", stringValueConfig("arm64"))
					ec2Set(m, "instance", "imageRootDeviceName", stringValueConfig("/dev/sda1"))
					ec2Set(m, "instance", "rootDeleteOnTermination", boolValue(true))
				}
				architecture := decodeMap(t, architectureFromNormalized(t, m))
				architecture["workloadBehavior"].(map[string]any)["workloads"] = []any{}
				input, err := json.Marshal(architecture)
				if err != nil {
					t.Fatal(err)
				}
				request := CompileRequest{Request: Request{Architecture: input, Target: target}}
				result := Compile(context.Background(), request)
				if !result.Succeeded() || result.Artifact == nil {
					t.Fatalf("full immutable input failed: %v", result.Diagnostics)
				}
			})
		}
	}
}
