package compiler

import (
	"context"
	"reflect"
	"strings"
	"testing"

	"github.com/hashicorp/hcl/v2"
	"github.com/hashicorp/hcl/v2/hclsyntax"
)

func TestNetworkingVpcDNSPrerequisiteBothTargets(t *testing.T) {
	for _, hostnames := range []bool{false, true} {
		for _, support := range []bool{false, true} {
			model := networkingTerraformModel()
			resources := []NormalizedResource{}
			for _, resource := range model.Resources {
				if resource.ServiceType == serviceRegionBoundary || resource.ServiceType == serviceVPC {
					resources = append(resources, resource)
				}
			}
			model.Resources = resources
			connections := []NormalizedConnection{}
			for _, connection := range model.Connections {
				if connection.RelationshipType == "aws.region.contains-vpc" {
					connections = append(connections, connection)
				}
			}
			model.Connections = connections
			model.Workloads = nil
			model.PolicyAttachments = nil
			model.Outputs = nil
			model.ExternalResources = nil
			setNetworkingValue(model, "vpc", "enableDnsHostnames", boolValue(hostnames))
			setNetworkingValue(model, "vpc", "enableDnsSupport", boolValue(support))
			before := cloneNormalized(t, model)
			for _, target := range []string{"terraform", "cloudformation"} {
				var artifact *TargetArtifact
				var diagnostics []Diagnostic
				if target == "terraform" {
					artifact, diagnostics = renderTerraformArtifact(context.Background(), model, nil, DefaultLimits())
				} else {
					artifact, diagnostics = renderCloudFormationArtifact(context.Background(), model, nil, DefaultLimits())
				}
				if hostnames && !support {
					if artifact != nil {
						t.Errorf("%s emitted DNS hostnames without DNS support", target)
					}
					code := "TARGET_NETWORK_DNS_CONFIGURATION_INVALID"
					if target == "cloudformation" {
						code = "CLOUDFORMATION_NETWORK_DNS_CONFIGURATION_INVALID"
					}
					found := false
					for _, diagnostic := range diagnostics {
						if diagnostic.Code == code && diagnostic.Severity == SeverityError {
							found = true
						}
					}
					if !found {
						t.Errorf("%s omitted DNS prerequisite diagnostic: %#v", target, diagnostics)
					}
				} else {
					assertNoTargetErrors(t, diagnostics)
					if artifact == nil {
						t.Errorf("%s omitted valid explicit DNS combination %t/%t", target, hostnames, support)
					}
				}
			}
			if !reflect.DeepEqual(before, model) {
				t.Fatal("DNS validation rewrote the declared configuration")
			}
		}
	}
}

func TestNetworkingSecurityGroupNamesAreVpcScopedBothTargets(t *testing.T) {
	for _, test := range []struct {
		name                   string
		separateVpc, duplicate bool
	}{
		{"Other-Group", false, false},
		{"Audit-Group", false, true},
		{"audit-group", false, true},
		{"audit-group", true, false},
	} {
		model := networkingTerraformModel()
		setNetworkingValue(model, "security_group", "groupName", stringValueConfig("Audit-Group"))
		vpc, _ := modelResource(model, "vpc")
		if test.separateVpc {
			region, _ := modelResource(model, "region")
			vpc = networkResource("other_vpc", "other_vpc", serviceVPC, serviceVPC+".configuration", "1.0.0", map[string]ConfigurationValue{
				"cidrBlock": stringValueConfig("10.30.0.0/16"), "enableDnsSupport": boolValue(true), "enableDnsHostnames": boolValue(true), "instanceTenancy": stringValueConfig("default"),
			})
			setNetworkParent(&vpc, region)
			model.Resources = append(model.Resources, vpc)
			model.Connections = append(model.Connections, networkConnection("other_vpc_region", "aws.region.contains-vpc", region, vpc))
		}
		group := networkResource("other_group", "other_group", serviceSecurityGroup, serviceSecurityGroup+".configuration", "1.0.0", map[string]ConfigurationValue{
			"groupName": stringValueConfig(test.name), "description": stringValueConfig("Synthetic scoped group"),
		})
		model.Resources = append(model.Resources, group)
		model.Connections = append(model.Connections, networkConnection("other_group_vpc", "aws.ec2.vpc-associates-security-group", vpc, group))
		sortModel(model)
		before := cloneNormalized(t, model)
		for _, target := range []string{"terraform", "cloudformation"} {
			var artifact *TargetArtifact
			var diagnostics []Diagnostic
			if target == "terraform" {
				artifact, diagnostics = renderTerraformArtifact(context.Background(), model, nil, DefaultLimits())
			} else {
				artifact, diagnostics = renderCloudFormationArtifact(context.Background(), model, nil, DefaultLimits())
			}
			if test.duplicate {
				if artifact != nil {
					t.Errorf("%s exported duplicate case-insensitive VPC group names", target)
				}
				found := false
				for _, diagnostic := range diagnostics {
					if diagnostic.Severity == SeverityError && strings.HasSuffix(diagnostic.Code, "NETWORK_SECURITY_GROUP_NAME_DUPLICATE") {
						found = true
					}
				}
				if !found {
					t.Errorf("%s omitted duplicate-name error: %#v", target, diagnostics)
				}
			} else {
				assertNoTargetErrors(t, diagnostics)
				if artifact == nil {
					t.Errorf("%s rejected distinct group name or VPC", target)
				}
			}
		}
		if !reflect.DeepEqual(before, model) {
			t.Fatal("Duplicate-name validation rewrote group names or associations")
		}
	}
}

func TestTerraformNetworkingRendersCuratedTwoAZLayout(t *testing.T) {
	t.Parallel()

	model := networkingTerraformModel()
	artifact, diagnostics := renderTerraformArtifact(context.Background(), model, nil, DefaultLimits())
	assertNoTargetErrors(t, diagnostics)
	if artifact == nil {
		t.Fatal("networking artifact is nil")
	}

	for _, file := range artifact.Files {
		if !strings.HasSuffix(file.Path, ".tf") {
			continue
		}
		_, parseDiagnostics := hclsyntax.ParseConfig([]byte(file.Content), file.Path, hcl.Pos{Line: 1, Column: 1})
		if parseDiagnostics.HasErrors() {
			t.Errorf("generated HCL %s does not parse: %s", file.Path, parseDiagnostics.Error())
		}
	}

	networking := fileContent(t, artifact, "infrastructure/networking.tf")
	security := fileContent(t, artifact, "infrastructure/security.tf")
	compute := fileContent(t, artifact, "infrastructure/compute.tf")
	outputs := fileContent(t, artifact, "infrastructure/outputs.tf")
	variables := fileContent(t, artifact, "infrastructure/variables.tf")
	for _, fragment := range []string{
		`resource "aws_vpc" "application"`,
		`resource "aws_subnet" "private_a_subnet"`,
		`resource "aws_subnet" "private_b_subnet"`,
		`resource "aws_route_table_association"`,
		`resource "aws_internet_gateway"`,
		`resource "aws_nat_gateway" "nat_a"`,
		`availability_mode = "zonal"`,
		`resource "aws_vpc_endpoint" "s3_endpoint"`,
		`service_name      = format("com.amazonaws.%s.s3", var.aws_region)`,
		`route_table_ids   = [aws_route_table.private_a_routes.id, aws_route_table.private_b_routes.id]`,
	} {
		if !strings.Contains(networking, fragment) {
			t.Errorf("networking.tf is missing %q:\n%s", fragment, networking)
		}
	}
	for _, fragment := range []string{
		`resource "aws_security_group" "application"`,
		`egress      = []`,
		`resource "aws_vpc_security_group_ingress_rule"`,
		`data "aws_iam_policy_document" "s3_endpoint_policy"`,
		`resource "aws_iam_role_policy_attachment" "lambda_vpc_access"`,
	} {
		if !strings.Contains(security, fragment) {
			t.Errorf("security.tf is missing %q:\n%s", fragment, security)
		}
	}
	for _, fragment := range []string{
		`vpc_config {`,
		`subnet_ids                  = [aws_subnet.private_a_subnet.id, aws_subnet.private_b_subnet.id]`,
		`security_group_ids          = [aws_security_group.application.id]`,
		`depends_on = [aws_iam_role_policy_attachment.lambda_vpc_access]`,
	} {
		if !strings.Contains(compute, fragment) {
			t.Errorf("compute.tf is missing %q:\n%s", fragment, compute)
		}
	}
	if !strings.Contains(outputs, `value       = aws_vpc.application.id`) ||
		!strings.Contains(outputs, `value       = aws_subnet.private_a_subnet.id`) {
		t.Errorf("outputs do not preserve deterministic network references:\n%s", outputs)
	}
	if !strings.Contains(variables, `variable "aws_region"`) || !strings.Contains(variables, `default     = "us-east-1"`) {
		t.Errorf("AWS Region variable is missing or unbound:\n%s", variables)
	}
	prompt30AssertNoForbiddenTerraform(t, artifact)

	policyOwnership := map[string]string{}
	for _, policy := range artifact.PolicyArtifacts {
		policyOwnership[policy.PolicyDocumentID] = policy.Ownership
	}
	if policyOwnership["s3_endpoint_policy"] != "user" || policyOwnership["trust_policy"] != "generated" {
		t.Errorf("custom/generated policy provenance collapsed: %#v", artifact.PolicyArtifacts)
	}
	attachment, attachmentExists := modelResource(model, "lambda_vpc_access")
	if !attachmentExists || attachment.Lifecycle.Ownership != "user" {
		t.Errorf("Lambda ENI permission attachment must remain explicit and user-owned: %#v", attachment)
	}

	reversed := cloneNormalized(t, model)
	reversePrompt30Model(reversed)
	sortModel(reversed)
	again, againDiagnostics := renderTerraformArtifact(context.Background(), reversed, nil, DefaultLimits())
	assertNoTargetErrors(t, againDiagnostics)
	if again == nil {
		t.Fatal("second networking artifact is nil")
	}
	if artifact.Digest != again.Digest || !reflect.DeepEqual(artifact.Files, again.Files) {
		for index := range artifact.Files {
			if index >= len(again.Files) {
				break
			}
			t.Logf("file %d: %s %s / %s %s; content equal %t", index, artifact.Files[index].Path, artifact.Files[index].Digest, again.Files[index].Path, again.Files[index].Digest, artifact.Files[index].Content == again.Files[index].Content)
		}
		t.Fatalf("networking Terraform is not byte-reproducible after canonical reorder: first digest %s, second digest %s; first policies %#v; second policies %#v; files equal %t", artifact.Digest, again.Digest, artifact.PolicyArtifacts, again.PolicyArtifacts, reflect.DeepEqual(artifact.Files, again.Files))
	}
}

func TestCompileTerraformNetworkingFromArchitectureDocument(t *testing.T) {
	t.Parallel()

	model := networkingTerraformModel()
	for index := range model.Resources {
		if model.Resources[index].ID == "security_group" {
			model.Resources[index].DeploymentKey = "application_security_group"
		}
	}
	architecture := architectureFromNormalized(t, model)
	result := Compile(context.Background(), CompileRequest{Request: Request{Architecture: architecture, Target: TargetTerraform}})
	if !result.Succeeded() || result.Artifact == nil {
		t.Fatalf("Compile() diagnostics = %#v", result.Diagnostics)
	}
	networking := fileContent(t, result.Artifact, "infrastructure/networking.tf")
	compute := fileContent(t, result.Artifact, "infrastructure/compute.tf")
	if !strings.Contains(networking, `resource "aws_vpc" "application"`) ||
		!strings.Contains(networking, `resource "aws_vpc_endpoint" "s3_endpoint"`) ||
		!strings.Contains(compute, `vpc_config {`) {
		t.Fatalf("public Compile pipeline omitted reviewed networking:\n%s\n%s", networking, compute)
	}
}

func TestTerraformNetworkingRendersLowCostEndpointServerlessLayout(t *testing.T) {
	t.Parallel()

	model := lowCostEndpointTerraformModel()
	artifact, diagnostics := renderTerraformArtifact(context.Background(), model, nil, DefaultLimits())
	assertNoTargetErrors(t, diagnostics)
	if artifact == nil {
		t.Fatal("low-cost endpoint artifact is nil")
	}

	networking := fileContent(t, artifact, "infrastructure/networking.tf")
	compute := fileContent(t, artifact, "infrastructure/compute.tf")
	for _, fragment := range []string{
		`resource "aws_subnet" "private_a_subnet"`,
		`resource "aws_subnet" "private_b_subnet"`,
		`resource "aws_vpc_endpoint" "s3_endpoint"`,
		`service_name      = format("com.amazonaws.%s.s3", var.aws_region)`,
		`route_table_ids   = [aws_route_table.private_a_routes.id, aws_route_table.private_b_routes.id]`,
	} {
		if !strings.Contains(networking, fragment) {
			t.Errorf("low-cost networking.tf is missing %q:\n%s", fragment, networking)
		}
	}
	for _, forbidden := range []string{
		`resource "aws_nat_gateway"`,
		`resource "aws_internet_gateway"`,
		`resource "aws_route"`,
		`resource "aws_eip"`,
	} {
		if strings.Contains(networking, forbidden) {
			t.Errorf("low-cost endpoint layout unexpectedly contains %q:\n%s", forbidden, networking)
		}
	}
	if !strings.Contains(compute, `vpc_config {`) {
		t.Errorf("low-cost Lambda VPC configuration is missing:\n%s", compute)
	}
	prompt30AssertNoForbiddenTerraform(t, artifact)
}

func TestTerraformNetworkingRejectsUnsupportedOrUngroundedSemantics(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name       string
		mutate     func(*NormalizedSolution)
		diagnostic string
	}{
		{
			name: "legacy catalog",
			mutate: func(model *NormalizedSolution) {
				model.Provenance.Catalog.Version = "0.16.0"
				model.Provenance.Catalog.Digest = "sha256:b8ae0f69d0fceae28e631e9036b745d2e8988967daee0a0b217e0da392d704d6"
			},
			diagnostic: "TARGET_RESOURCE_UNSUPPORTED",
		},
		{
			name: "region boundary conflicts with immutable provider Region",
			mutate: func(model *NormalizedSolution) {
				setNetworkingValue(model, "region", "regionName", stringValueConfig("eu-west-1"))
			},
			diagnostic: "TARGET_NETWORK_REGION_MISMATCH",
		},
		{
			name: "route has no supported target",
			mutate: func(model *NormalizedSolution) {
				removeNetworkingConnection(model, "edge_private_route_nat_a")
			},
			diagnostic: "TARGET_NETWORK_ROUTE_TARGET_INVALID",
		},
		{
			name: "route table association has no subnet",
			mutate: func(model *NormalizedSolution) {
				removeNetworkingConnection(model, "edge_private_assoc_a_subnet")
			},
			diagnostic: "TARGET_NETWORK_ASSOCIATION_INVALID",
		},
		{
			name: "private NAT mode is outside the curated target",
			mutate: func(model *NormalizedSolution) {
				setNetworkingValue(model, "nat_a", "connectivityType", stringValueConfig("private"))
			},
			diagnostic: "TARGET_NETWORK_NAT_MODE_UNSUPPORTED",
		},
		{
			name: "security group without one VPC association",
			mutate: func(model *NormalizedSolution) {
				removeNetworkingConnection(model, "edge_vpc_security_group")
			},
			diagnostic: "TARGET_NETWORK_SECURITY_GROUP_VPC_INVALID",
		},
		{
			name: "gateway endpoint mode is unsupported",
			mutate: func(model *NormalizedSolution) {
				setNetworkingValue(model, "s3_endpoint", "endpointType", stringValueConfig("Interface"))
			},
			diagnostic: "TARGET_NETWORK_ENDPOINT_MODE_UNSUPPORTED",
		},
		{
			name: "gateway endpoint has no route table",
			mutate: func(model *NormalizedSolution) {
				removeNetworkingConnection(model, "edge_endpoint_table_a")
				removeNetworkingConnection(model, "edge_endpoint_table_b")
			},
			diagnostic: "TARGET_NETWORK_ENDPOINT_ROUTE_TABLE_REQUIRED",
		},
		{
			name: "gateway endpoint crosses VPCs",
			mutate: func(model *NormalizedSolution) {
				moveRouteTableToOtherVPC(model, "route_table_private_a", "edge_vpc_private_table_a")
			},
			diagnostic: "TARGET_NETWORK_CROSS_VPC_UNSUPPORTED",
		},
		{
			name: "Lambda VPC access has no security group",
			mutate: func(model *NormalizedSolution) {
				removeNetworkingConnection(model, "edge_lambda_security_group")
			},
			diagnostic: "TARGET_NETWORK_LAMBDA_SELECTION_INVALID",
		},
		{
			name: "Lambda VPC access selects multiple VPCs",
			mutate: func(model *NormalizedSolution) {
				moveAvailabilityZoneToOtherVPC(model, "az_a", "edge_vpc_az_a")
			},
			diagnostic: "TARGET_NETWORK_LAMBDA_VPC_INVALID",
		},
		{
			name: "public NAT without same VPC internet gateway",
			mutate: func(model *NormalizedSolution) {
				removeNetworkingResource(model, "internet_gateway")
			},
			diagnostic: "TARGET_NETWORK_NAT_INTERNET_GATEWAY_REQUIRED",
		},
		{
			name: "public NAT subnet without an internet gateway default route",
			mutate: func(model *NormalizedSolution) {
				removeNetworkingResource(model, "route_public_default")
			},
			diagnostic: "TARGET_NETWORK_NAT_INTERNET_GATEWAY_REQUIRED",
		},
		{
			name: "Lambda missing ENI permissions",
			mutate: func(model *NormalizedSolution) {
				removeNetworkingResource(model, "lambda_vpc_access")
			},
			diagnostic: "TARGET_NETWORK_LAMBDA_ENI_PERMISSION_REQUIRED",
		},
		{
			name: "unsupported IPv6 subnet",
			mutate: func(model *NormalizedSolution) {
				setNetworkingValue(model, "private_a", "assignIpv6AddressOnCreation", boolValue(true))
			},
			diagnostic: "TARGET_NETWORK_IPV6_UNSUPPORTED",
		},
		{
			name: "endpoint policy service mismatch",
			mutate: func(model *NormalizedSolution) {
				setNetworkingValue(model, "s3_endpoint_statement", "actions", stringList("dynamodb:GetItem"))
			},
			diagnostic: "TARGET_NETWORK_ENDPOINT_POLICY_SERVICE_MISMATCH",
		},
		{
			name: "generated endpoint policy masquerade",
			mutate: func(model *NormalizedSolution) {
				for index := range model.Resources {
					if model.Resources[index].ID == "s3_endpoint_policy" {
						model.Resources[index].Lifecycle = generatedLifecycle([]string{"edge_endpoint_policy"})
					}
				}
			},
			diagnostic: "TARGET_NETWORK_ENDPOINT_POLICY_OWNERSHIP_INVALID",
		},
		{
			name: "endpoint resource policy without principal",
			mutate: func(model *NormalizedSolution) {
				setNetworkingValue(model, "s3_endpoint_statement", "principalKind", stringValueConfig("none"))
				setNetworkingValue(model, "s3_endpoint_statement", "principals", stringList())
			},
			diagnostic: "TARGET_NETWORK_ENDPOINT_POLICY_PRINCIPAL_INVALID",
		},
		{
			name: "forged networking resource type",
			mutate: func(model *NormalizedSolution) {
				for index := range model.Resources {
					if model.Resources[index].ID == "private_a" {
						model.Resources[index].ResourceType = serviceVPC
					}
				}
			},
			diagnostic: "TARGET_NETWORK_RESOURCE_TYPE_INVALID",
		},
		{
			name: "forged semantic parent relationship",
			mutate: func(model *NormalizedSolution) {
				for index := range model.Resources {
					if model.Resources[index].ID == "private_a" && model.Resources[index].Parent != nil {
						model.Resources[index].Parent.RelationshipType = "aws.ec2.vpc-contains-route-table"
					}
				}
			},
			diagnostic: "TARGET_NETWORK_ANCESTRY_INVALID",
		},
		{
			name: "forged semantic port",
			mutate: func(model *NormalizedSolution) {
				for index := range model.Connections {
					if model.Connections[index].ID == "edge_endpoint_table_a" {
						model.Connections[index].Source.Port = "aws.ec2.gateway-vpc-endpoint.vpc"
					}
				}
			},
			diagnostic: "TARGET_NETWORK_RELATIONSHIP_BINDING_INVALID",
		},
		{
			name: "duplicate endpoint pair",
			mutate: func(model *NormalizedSolution) {
				for _, connection := range model.Connections {
					if connection.ID == "edge_endpoint_table_a" {
						duplicate := connection
						duplicate.ID = "edge_endpoint_table_a_duplicate"
						model.Connections = append(model.Connections, duplicate)
						break
					}
				}
			},
			diagnostic: "TARGET_NETWORK_RELATIONSHIP_CARDINALITY_INVALID",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			model := networkingTerraformModel()
			test.mutate(model)
			artifact, diagnostics := renderTerraformArtifact(context.Background(), model, nil, DefaultLimits())
			if artifact != nil || !hasDiagnostic(diagnostics, test.diagnostic) {
				t.Fatalf("artifact = %#v; diagnostics = %#v; want %s", artifact, diagnostics, test.diagnostic)
			}
		})
	}
}

func TestNetworkingConfigurationContractBothTargets(t *testing.T) {
	for _, target := range []string{"terraform", "cloudformation"} {
		t.Run(target, func(t *testing.T) {
			render := func(model *NormalizedSolution) (bool, []Diagnostic) {
				if target == "cloudformation" {
					artifact, diagnostics := renderCloudFormationArtifact(context.Background(), model, nil, DefaultLimits())
					return artifact != nil, diagnostics
				}
				artifact, diagnostics := renderTerraformArtifact(context.Background(), model, nil, DefaultLimits())
				return artifact != nil, diagnostics
			}
			model := networkingTerraformModel()
			prepareCuratedCloudFormationModel(model)
			for _, id := range []string{"security_group", "security_ingress", "security_egress"} {
				description := "AZaz09 ._-:/()#,@[]+=;{}!$*"
				if id == "security_group" {
					description += "&"
				}
				description += strings.Repeat("a", 255-len(description))
				setNetworkingValue(model, id, "description", stringValueConfig(description))
			}
			if artifact, diagnostics := render(model); !artifact || hasErrorDiagnostics(diagnostics) {
				t.Fatalf("valid AWS description characters were rejected: %v", diagnostics)
			}
			invalid := cloneNormalized(t, model)
			setNetworkingValue(invalid, "security_group", "description", stringValueConfig("é"))
			setNetworkingValue(invalid, "security_ingress", "description", stringValueConfig("bad&"))
			setNetworkingValue(invalid, "security_egress", "description", stringValueConfig("bad\n"))
			artifact, diagnostics := render(invalid)
			count := 0
			for _, diagnostic := range diagnostics {
				if strings.HasSuffix(diagnostic.Code, "NETWORK_SECURITY_GROUP_DESCRIPTION_INVALID") {
					count++
				}
			}
			if artifact || count != 3 {
				t.Fatalf("invalid descriptions escaped export validation: artifact=%v, diagnostics=%v", artifact, diagnostics)
			}
			for _, test := range []struct {
				id, key string
				value   ConfigurationValue
			}{
				{"vpc", "cidrBlock", stringValueConfig("")},
				{"vpc", "enableDnsSupport", stringValueConfig("true")},
				{"az_a", "zoneName", stringValueConfig("")},
				{"internet_gateway", "name", stringValueConfig("")},
				{"route_table_public", "name", stringValueConfig("")},
				{"security_group", "groupName", stringValueConfig("")},
				{"security_ingress", "sourceIpv4Cidr", stringValueConfig("")},
				{"security_egress", "destinationIpv4Cidr", stringValueConfig("not-a-cidr")},
				{"security_egress", "fromPort", integerValue(-2)},
				{"security_egress", "toPort", integerValue(65536)},
				{"security_egress", "protocol", stringValueConfig("unsupported")},
				{"security_ingress", "fromPort", ConfigurationValue{Kind: "number", Value: float64(443)}},
				{"nat_a", "allocationId", stringValueConfig("invalid-allocation")},
				{"private_a", "accessTier", stringValueConfig("unsupported")},
				{"lambda_vpc", "egressRequirement", stringValueConfig("unsupported")},
			} {
				candidate := cloneNormalized(t, model)
				setNetworkingValue(candidate, test.id, test.key, test.value)
				before := cloneNormalized(t, candidate)
				artifact, diagnostics := render(candidate)
				if artifact || !hasErrorDiagnostics(diagnostics) {
					t.Errorf("%s.%s escaped %s literal validation", test.id, test.key, target)
				}
				if !reflect.DeepEqual(before, candidate) {
					t.Fatal("Literal validation rewrote the input")
				}
			}
			for _, ports := range []struct {
				protocol string
				from, to int
				valid    bool
			}{
				{"tcp", 0, 65535, true}, {"udp", 65535, 65535, true},
				{"icmp", -1, -1, true}, {"icmp", 255, 255, true},
				{"-1", -1, -1, true}, {"tcp", 443, 80, false},
				{"icmp", -1, 0, false}, {"icmp", 256, 0, false},
				{"-1", 0, 0, false},
			} {
				candidate := cloneNormalized(t, model)
				setNetworkingValue(candidate, "security_egress", "protocol", stringValueConfig(ports.protocol))
				setNetworkingValue(candidate, "security_egress", "fromPort", integerValue(ports.from))
				setNetworkingValue(candidate, "security_egress", "toPort", integerValue(ports.to))
				artifact, diagnostics := render(candidate)
				if artifact != ports.valid || hasErrorDiagnostics(diagnostics) == ports.valid {
					t.Errorf("%s ports %s %d..%d: artifact=%v diagnostics=%v", target, ports.protocol, ports.from, ports.to, artifact, diagnostics)
				}
			}
		})
	}
}

func networkingTerraformModel() *NormalizedSolution {
	model := minimalLambdaModel("generated-starter")
	model.Provenance.Catalog.Version = CurrentAwsCatalogVersion
	model.Provenance.Catalog.Digest = CurrentAwsCatalogDigest
	for index := range model.Resources {
		if model.Resources[index].ServiceType == "aws.iam.policy-statement" {
			model.Resources[index].Configuration.SchemaVersion = "2.0.0"
		}
	}

	region := networkResource("region", "region", serviceRegionBoundary, "aws.region.boundary.configuration", "1.0.0", map[string]ConfigurationValue{
		"regionName": stringValueConfig("us-east-1"),
	})
	vpc := networkResource("vpc", "application", serviceVPC, "aws.ec2.vpc.configuration", "1.0.0", map[string]ConfigurationValue{
		"cidrBlock": stringValueConfig("10.20.0.0/16"), "enableDnsHostnames": boolValue(true),
		"enableDnsSupport": boolValue(true), "instanceTenancy": stringValueConfig("default"),
	})
	setNetworkParent(&vpc, region)
	azA := networkResource("az_a", "az_a", serviceAvailabilityZone, "aws.ec2.availability-zone.configuration", "1.0.0", map[string]ConfigurationValue{"zoneName": stringValueConfig("us-east-1a")})
	azB := networkResource("az_b", "az_b", serviceAvailabilityZone, "aws.ec2.availability-zone.configuration", "1.0.0", map[string]ConfigurationValue{"zoneName": stringValueConfig("us-east-1b")})
	setNetworkParent(&azA, vpc)
	setNetworkParent(&azB, vpc)
	publicA := networkSubnet("public_a", "10.20.0.0/24", "public", true, azA)
	privateA := networkSubnet("private_a", "10.20.10.0/24", "private", false, azA)
	publicB := networkSubnet("public_b", "10.20.1.0/24", "public", true, azB)
	privateB := networkSubnet("private_b", "10.20.11.0/24", "private", false, azB)

	publicTable := networkRouteTable("public", vpc)
	privateTableA := networkRouteTable("private_a", vpc)
	privateTableB := networkRouteTable("private_b", vpc)
	internetGateway := networkResource("internet_gateway", "internet_gateway", serviceInternetGateway, "aws.ec2.internet-gateway.configuration", "1.0.0", map[string]ConfigurationValue{"name": stringValueConfig("application-internet")})
	natA := networkNAT("nat_a", "eipalloc-0123456789abcdef0", publicA)
	natB := networkNAT("nat_b", "eipalloc-0123456789abcdef1", publicB)
	publicRoute := networkRoute("public_default", publicTable)
	privateRouteA := networkRoute("private_default_a", privateTableA)
	privateRouteB := networkRoute("private_default_b", privateTableB)
	publicAssociationA := networkAssociation("public_a", publicTable)
	publicAssociationB := networkAssociation("public_b", publicTable)
	privateAssociationA := networkAssociation("private_a", privateTableA)
	privateAssociationB := networkAssociation("private_b", privateTableB)

	endpoint := networkResource("s3_endpoint", "s3_endpoint", serviceGatewayVPCEndpoint, "aws.ec2.gateway-vpc-endpoint.configuration", "1.0.0", map[string]ConfigurationValue{
		"endpointType": stringValueConfig("Gateway"), "policyMode": stringValueConfig("restricted"), "service": stringValueConfig("s3"),
	})
	setNetworkParent(&endpoint, vpc)
	securityGroup := networkResource("security_group", "application", serviceSecurityGroup, "aws.ec2.security-group.configuration", "1.0.0", map[string]ConfigurationValue{
		"description": stringValueConfig("Lambda application traffic"), "groupName": stringValueConfig("application-lambda"),
	})
	ingress := networkResource("security_ingress", "application_https_ingress", serviceSecurityGroupIngressRule, "aws.ec2.security-group-ingress-rule.configuration", "1.0.0", map[string]ConfigurationValue{
		"description": stringValueConfig("HTTPS from the application VPC"), "fromPort": integerValue(443), "protocol": stringValueConfig("tcp"),
		"sourceIpv4Cidr": stringValueConfig("10.20.0.0/16"), "toPort": integerValue(443),
	})
	egress := networkResource("security_egress", "application_https_egress", serviceSecurityGroupEgressRule, "aws.ec2.security-group-egress-rule.configuration", "1.0.0", map[string]ConfigurationValue{
		"description": stringValueConfig("Reviewed HTTPS egress"), "destinationIpv4Cidr": stringValueConfig("0.0.0.0/0"),
		"fromPort": integerValue(443), "protocol": stringValueConfig("tcp"), "toPort": integerValue(443),
	})
	setNetworkParent(&ingress, securityGroup)
	setNetworkParent(&egress, securityGroup)

	lambda, _ := modelResource(model, "lambda")
	lambdaConfig := networkResource("lambda_vpc", "lambda_vpc", serviceLambdaVPCConfiguration, "aws.lambda.vpc-access-configuration.configuration", "1.1.0", map[string]ConfigurationValue{
		"egressRequirement": stringValueConfig("internet"), "ipv6AllowedForDualStack": boolValue(false),
	})
	setNetworkParent(&lambdaConfig, lambda)

	endpointPolicy := networkResource("s3_endpoint_policy", "s3_endpoint_policy", "aws.iam.policy-document", "aws.iam.policy-document.configuration", "1.0.0", map[string]ConfigurationValue{
		"policyKind": stringValueConfig("resource"), "policyName": stringValueConfig("s3-endpoint-restricted"),
	})
	endpointStatement := networkResource("s3_endpoint_statement", "s3_endpoint_statement", "aws.iam.policy-statement", "aws.iam.policy-statement.configuration", "2.0.0", map[string]ConfigurationValue{
		"actions": stringList("s3:GetObject"), "effect": stringValueConfig("allow"), "principalKind": stringValueConfig("provider-identity"),
		"principals":          stringList("arn:aws:iam::111122223333:role/application"),
		"resourceExpressions": stringList("arn:aws:s3:::company-private-bucket/object"), "statementId": stringValueConfig("ApplicationObjectRead"),
	})

	model.Resources = append(model.Resources,
		region, vpc, azA, azB, publicA, privateA, publicB, privateB,
		publicTable, privateTableA, privateTableB, internetGateway, natA, natB,
		publicRoute, privateRouteA, privateRouteB, publicAssociationA, publicAssociationB,
		privateAssociationA, privateAssociationB, endpoint, securityGroup, ingress, egress,
		lambdaConfig, endpointPolicy, endpointStatement,
	)

	connections := []NormalizedConnection{
		networkConnection("edge_region_vpc", "aws.region.contains-vpc", region, vpc),
		networkConnection("edge_vpc_az_a", "aws.ec2.vpc-contains-availability-zone", vpc, azA),
		networkConnection("edge_vpc_az_b", "aws.ec2.vpc-contains-availability-zone", vpc, azB),
		networkConnection("edge_az_public_a", "aws.ec2.availability-zone-contains-subnet", azA, publicA),
		networkConnection("edge_az_private_a", "aws.ec2.availability-zone-contains-subnet", azA, privateA),
		networkConnection("edge_az_public_b", "aws.ec2.availability-zone-contains-subnet", azB, publicB),
		networkConnection("edge_az_private_b", "aws.ec2.availability-zone-contains-subnet", azB, privateB),
		networkConnection("edge_vpc_public_table", "aws.ec2.vpc-contains-route-table", vpc, publicTable),
		networkConnection("edge_vpc_private_table_a", "aws.ec2.vpc-contains-route-table", vpc, privateTableA),
		networkConnection("edge_vpc_private_table_b", "aws.ec2.vpc-contains-route-table", vpc, privateTableB),
		networkConnection("edge_vpc_igw", "aws.ec2.vpc-attaches-internet-gateway", vpc, internetGateway),
		networkConnection("edge_public_a_nat", "aws.ec2.subnet-contains-nat-gateway", publicA, natA),
		networkConnection("edge_public_b_nat", "aws.ec2.subnet-contains-nat-gateway", publicB, natB),
		networkConnection("edge_public_route_owner", "aws.ec2.route-table-owns-route", publicRoute, publicTable),
		networkConnection("edge_private_route_a_owner", "aws.ec2.route-table-owns-route", privateRouteA, privateTableA),
		networkConnection("edge_private_route_b_owner", "aws.ec2.route-table-owns-route", privateRouteB, privateTableB),
		networkConnection("edge_public_route_igw", "aws.ec2.route-targets-internet-gateway", publicRoute, internetGateway),
		networkConnection("edge_private_route_nat_a", "aws.ec2.route-targets-nat-gateway", privateRouteA, natA),
		networkConnection("edge_private_route_nat_b", "aws.ec2.route-targets-nat-gateway", privateRouteB, natB),
		networkConnection("edge_public_assoc_a_owner", "aws.ec2.route-table-owns-subnet-association", publicAssociationA, publicTable),
		networkConnection("edge_public_assoc_b_owner", "aws.ec2.route-table-owns-subnet-association", publicAssociationB, publicTable),
		networkConnection("edge_private_assoc_a_owner", "aws.ec2.route-table-owns-subnet-association", privateAssociationA, privateTableA),
		networkConnection("edge_private_assoc_b_owner", "aws.ec2.route-table-owns-subnet-association", privateAssociationB, privateTableB),
		networkConnection("edge_public_assoc_a_subnet", "aws.ec2.route-table-association-targets-subnet", publicAssociationA, publicA),
		networkConnection("edge_public_assoc_b_subnet", "aws.ec2.route-table-association-targets-subnet", publicAssociationB, publicB),
		networkConnection("edge_private_assoc_a_subnet", "aws.ec2.route-table-association-targets-subnet", privateAssociationA, privateA),
		networkConnection("edge_private_assoc_b_subnet", "aws.ec2.route-table-association-targets-subnet", privateAssociationB, privateB),
		networkConnection("edge_vpc_endpoint", "aws.ec2.vpc-contains-gateway-endpoint", vpc, endpoint),
		networkConnection("edge_endpoint_table_a", "aws.ec2.gateway-endpoint-associates-route-table", endpoint, privateTableA),
		networkConnection("edge_endpoint_table_b", "aws.ec2.gateway-endpoint-associates-route-table", endpoint, privateTableB),
		networkConnection("edge_endpoint_policy", "aws.ec2.gateway-endpoint-owns-policy", endpointPolicy, endpoint),
		connection("edge_endpoint_statement", "aws.iam.policy-contains-statement", endpointStatement, endpointPolicy, "aws.iam.policy-membership.connection", nil),
		networkConnection("edge_vpc_security_group", "aws.ec2.vpc-associates-security-group", vpc, securityGroup),
		networkConnection("edge_security_ingress", "aws.ec2.security-group-owns-ingress-rule", ingress, securityGroup),
		networkConnection("edge_security_egress", "aws.ec2.security-group-owns-egress-rule", egress, securityGroup),
		networkConnection("edge_lambda_vpc", "aws.lambda.owns-vpc-access-configuration", lambdaConfig, lambda),
		networkConnection("edge_lambda_private_a", "aws.lambda.vpc-access-uses-subnet", lambdaConfig, privateA),
		networkConnection("edge_lambda_private_b", "aws.lambda.vpc-access-uses-subnet", lambdaConfig, privateB),
		networkConnection("edge_lambda_security_group", "aws.lambda.vpc-access-uses-security-group", lambdaConfig, securityGroup),
	}
	model.Connections = append(model.Connections, connections...)

	role, _ := modelResource(model, "role")
	addManagedAttachment(model, "lambda_vpc_access", "managed-policy-attachment", lambdaVPCManagedPolicyReference, role, "aws.iam.role-owns-managed-policy-attachment")
	vpcOutput := reference(vpc)
	vpcOutput.Attribute = "id"
	privateAOutput := reference(privateA)
	privateAOutput.Attribute = "id"
	model.Outputs = []NormalizedOutput{
		{ID: "output_vpc_id", Key: "vpc_id", Kind: "node-attribute", Resource: &vpcOutput},
		{ID: "output_private_subnet_a_id", Key: "private_subnet_a_id", Kind: "node-attribute", Resource: &privateAOutput},
	}
	sortModel(model)
	return model
}

func networkResource(id, key, service, schema, version string, values map[string]ConfigurationValue) NormalizedResource {
	result := resource(id, key, service, configuration(schema, values))
	result.Configuration.SchemaVersion = version
	return result
}

func networkSubnet(id, cidr, tier string, publicIP bool, az NormalizedResource) NormalizedResource {
	subnet := networkResource(id, id+"_subnet", serviceSubnet, "aws.ec2.subnet.configuration", "1.0.0", map[string]ConfigurationValue{
		"accessTier": stringValueConfig(tier), "assignIpv6AddressOnCreation": boolValue(false),
		"cidrBlock": stringValueConfig(cidr), "mapPublicIpOnLaunch": boolValue(publicIP),
	})
	setNetworkParent(&subnet, az)
	return subnet
}

func networkRouteTable(id string, vpc NormalizedResource) NormalizedResource {
	table := networkResource("route_table_"+id, id+"_routes", serviceRouteTable, "aws.ec2.route-table.configuration", "1.0.0", map[string]ConfigurationValue{"name": stringValueConfig(id + "-routes")})
	setNetworkParent(&table, vpc)
	return table
}

func networkNAT(id, allocationID string, subnet NormalizedResource) NormalizedResource {
	nat := networkResource(id, id, serviceNATGateway, "aws.ec2.nat-gateway.configuration", "1.0.0", map[string]ConfigurationValue{
		"allocationId": stringValueConfig(allocationID), "availabilityMode": stringValueConfig("zonal"), "connectivityType": stringValueConfig("public"),
	})
	setNetworkParent(&nat, subnet)
	return nat
}

func networkRoute(id string, table NormalizedResource) NormalizedResource {
	route := networkResource("route_"+id, id, serviceRoute, "aws.ec2.route.configuration", "1.0.0", map[string]ConfigurationValue{"destinationIpv4Cidr": stringValueConfig("0.0.0.0/0")})
	setNetworkParent(&route, table)
	return route
}

func networkAssociation(id string, table NormalizedResource) NormalizedResource {
	association := networkResource("association_"+id, id+"_association", serviceRouteTableAssociation, "aws.ec2.route-table-association.configuration", "1.0.0", map[string]ConfigurationValue{})
	setNetworkParent(&association, table)
	return association
}

func setNetworkParent(child *NormalizedResource, parent NormalizedResource) {
	reference := reference(parent)
	reference.RelationshipType = map[string]string{
		serviceVPC:                      "aws.region.contains-vpc",
		serviceAvailabilityZone:         "aws.ec2.vpc-contains-availability-zone",
		serviceSubnet:                   "aws.ec2.availability-zone-contains-subnet",
		serviceRouteTable:               "aws.ec2.vpc-contains-route-table",
		serviceNATGateway:               "aws.ec2.subnet-contains-nat-gateway",
		serviceGatewayVPCEndpoint:       "aws.ec2.vpc-contains-gateway-endpoint",
		serviceRoute:                    "aws.ec2.route-table-owns-route",
		serviceRouteTableAssociation:    "aws.ec2.route-table-owns-subnet-association",
		serviceSecurityGroupIngressRule: "aws.ec2.security-group-owns-ingress-rule",
		serviceSecurityGroupEgressRule:  "aws.ec2.security-group-owns-egress-rule",
		serviceLambdaVPCConfiguration:   "aws.lambda.owns-vpc-access-configuration",
	}[child.ServiceType]
	child.Parent = &reference
}

func networkConnection(id, relationship string, source, target NormalizedResource) NormalizedConnection {
	result := connection(id, relationship, source, target, relationship+".connection", nil)
	if contract, ok := networkingRelationshipContracts[relationship]; ok {
		result.Source.Port = contract.ports[0]
		result.Target.Port = contract.ports[1]
	}
	return result
}

func removeNetworkingResource(model *NormalizedSolution, id string) {
	resources := make([]NormalizedResource, 0, len(model.Resources))
	for _, resource := range model.Resources {
		if resource.ID != id {
			resources = append(resources, resource)
		}
	}
	connections := make([]NormalizedConnection, 0, len(model.Connections))
	for _, connection := range model.Connections {
		if connection.Source.NodeID != id && connection.Target.NodeID != id {
			connections = append(connections, connection)
		}
	}
	model.Resources = resources
	model.Connections = connections
}

func setNetworkingValue(model *NormalizedSolution, resourceID, key string, value ConfigurationValue) {
	for index := range model.Resources {
		if model.Resources[index].ID == resourceID {
			model.Resources[index].Configuration.Values[key] = value
			return
		}
	}
}

func removeNetworkingConnection(model *NormalizedSolution, id string) {
	connections := make([]NormalizedConnection, 0, len(model.Connections))
	for _, connection := range model.Connections {
		if connection.ID != id {
			connections = append(connections, connection)
		}
	}
	model.Connections = connections
}

func addOtherNetworkingVPC(model *NormalizedSolution) NormalizedResource {
	region, ok := modelResource(model, "region")
	if !ok {
		panic("networking test model is missing its Region boundary")
	}
	other := networkResource("vpc_other", "other", serviceVPC, "aws.ec2.vpc.configuration", "1.0.0", map[string]ConfigurationValue{
		"cidrBlock": stringValueConfig("10.30.0.0/16"), "enableDnsHostnames": boolValue(true),
		"enableDnsSupport": boolValue(true), "instanceTenancy": stringValueConfig("default"),
	})
	setNetworkParent(&other, region)
	model.Resources = append(model.Resources, other)
	model.Connections = append(model.Connections, networkConnection("edge_region_vpc_other", "aws.region.contains-vpc", region, other))
	return other
}

func moveRouteTableToOtherVPC(model *NormalizedSolution, tableID, placementEdgeID string) {
	other := addOtherNetworkingVPC(model)
	for index := range model.Resources {
		if model.Resources[index].ID == tableID {
			setNetworkParent(&model.Resources[index], other)
		}
	}
	for index := range model.Connections {
		if model.Connections[index].ID == placementEdgeID {
			model.Connections[index].Source.NodeID = other.ID
			model.Connections[index].Source.TargetKey = other.TargetKey
		}
	}
	sortModel(model)
}

func moveAvailabilityZoneToOtherVPC(model *NormalizedSolution, zoneID, placementEdgeID string) {
	other := addOtherNetworkingVPC(model)
	for index := range model.Resources {
		if model.Resources[index].ID == zoneID {
			setNetworkParent(&model.Resources[index], other)
		}
	}
	for index := range model.Connections {
		if model.Connections[index].ID == placementEdgeID {
			model.Connections[index].Source.NodeID = other.ID
			model.Connections[index].Source.TargetKey = other.TargetKey
		}
	}
	sortModel(model)
}

func lowCostEndpointTerraformModel() *NormalizedSolution {
	model := networkingTerraformModel()
	for _, resourceID := range []string{
		"association_public_a",
		"association_public_b",
		"internet_gateway",
		"nat_a",
		"nat_b",
		"public_a",
		"public_b",
		"route_private_default_a",
		"route_private_default_b",
		"route_public_default",
		"route_table_public",
	} {
		removeNetworkingResource(model, resourceID)
	}
	setNetworkingValue(model, "lambda_vpc", "egressRequirement", stringValueConfig("s3"))
	sortModel(model)
	return model
}
