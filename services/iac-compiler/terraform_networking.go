package compiler

import (
	"math"
	"net/netip"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"github.com/hashicorp/hcl/v2/hclwrite"
	"github.com/zclconf/go-cty/cty"
)

const (
	serviceRegionBoundary             = "aws.region.boundary"
	serviceVPC                        = "aws.ec2.vpc"
	serviceAvailabilityZone           = "aws.ec2.availability-zone"
	serviceSubnet                     = "aws.ec2.subnet"
	serviceRouteTable                 = "aws.ec2.route-table"
	serviceRoute                      = "aws.ec2.route"
	serviceRouteTableAssociation      = "aws.ec2.route-table-association"
	serviceInternetGateway            = "aws.ec2.internet-gateway"
	serviceNATGateway                 = "aws.ec2.nat-gateway"
	serviceGatewayVPCEndpoint         = "aws.ec2.gateway-vpc-endpoint"
	serviceSecurityGroup              = "aws.ec2.security-group"
	serviceSecurityGroupIngressRule   = "aws.ec2.security-group-ingress-rule"
	serviceSecurityGroupEgressRule    = "aws.ec2.security-group-egress-rule"
	serviceLambdaVPCConfiguration     = "aws.lambda.vpc-access-configuration"
	lambdaVPCManagedPolicyReference   = "aws-managed:service-role/AWSLambdaVPCAccessExecutionRole"
	networkingRendererContractVersion = "1.0.0"
)

type networkingRelationshipContract struct {
	services         [2]string
	ports            [2]string
	maximumPerSource int
	maximumPerTarget int
	maximumPerPair   int
}

func networkContract(sourceService, sourcePort, targetService, targetPort string, maximumPerSource, maximumPerTarget int) networkingRelationshipContract {
	return networkingRelationshipContract{
		services: [2]string{sourceService, targetService}, ports: [2]string{sourcePort, targetPort},
		maximumPerSource: maximumPerSource, maximumPerTarget: maximumPerTarget, maximumPerPair: 1,
	}
}

var networkingRelationshipContracts = map[string]networkingRelationshipContract{
	"aws.region.contains-vpc":                         networkContract(serviceRegionBoundary, "aws.region.boundary.vpc-placement", serviceVPC, "aws.ec2.vpc.region", 100, 1),
	"aws.ec2.vpc-contains-availability-zone":          networkContract(serviceVPC, "aws.ec2.vpc.availability-zone-placement", serviceAvailabilityZone, "aws.ec2.availability-zone.vpc", 100, 1),
	"aws.ec2.availability-zone-contains-subnet":       networkContract(serviceAvailabilityZone, "aws.ec2.availability-zone.subnet-placement", serviceSubnet, "aws.ec2.subnet.availability-zone", 100, 1),
	"aws.ec2.vpc-contains-route-table":                networkContract(serviceVPC, "aws.ec2.vpc.route-table-placement", serviceRouteTable, "aws.ec2.route-table.vpc", 100, 1),
	"aws.ec2.subnet-contains-nat-gateway":             networkContract(serviceSubnet, "aws.ec2.subnet.nat-gateway-placement", serviceNATGateway, "aws.ec2.nat-gateway.subnet", 1, 1),
	"aws.ec2.vpc-contains-gateway-endpoint":           networkContract(serviceVPC, "aws.ec2.vpc.gateway-endpoint-placement", serviceGatewayVPCEndpoint, "aws.ec2.gateway-vpc-endpoint.vpc", 16, 1),
	"aws.ec2.route-table-owns-route":                  networkContract(serviceRoute, "aws.ec2.route.route-table", serviceRouteTable, "aws.ec2.route-table.route", 1, 100),
	"aws.ec2.route-table-owns-subnet-association":     networkContract(serviceRouteTableAssociation, "aws.ec2.route-table-association.route-table", serviceRouteTable, "aws.ec2.route-table.subnet-association", 1, 100),
	"aws.ec2.route-table-association-targets-subnet":  networkContract(serviceRouteTableAssociation, "aws.ec2.route-table-association.subnet", serviceSubnet, "aws.ec2.subnet.route-table-association", 1, 1),
	"aws.ec2.vpc-attaches-internet-gateway":           networkContract(serviceVPC, "aws.ec2.vpc.internet-gateway-attachment", serviceInternetGateway, "aws.ec2.internet-gateway.vpc-attachment", 1, 1),
	"aws.ec2.route-targets-internet-gateway":          networkContract(serviceRoute, "aws.ec2.route.internet-gateway-target", serviceInternetGateway, "aws.ec2.internet-gateway.route-target", 1, 100),
	"aws.ec2.route-targets-nat-gateway":               networkContract(serviceRoute, "aws.ec2.route.nat-gateway-target", serviceNATGateway, "aws.ec2.nat-gateway.route-target", 1, 100),
	"aws.ec2.gateway-endpoint-associates-route-table": networkContract(serviceGatewayVPCEndpoint, "aws.ec2.gateway-vpc-endpoint.route-table-association", serviceRouteTable, "aws.ec2.route-table.gateway-endpoint-association", 100, 16),
	"aws.ec2.gateway-endpoint-owns-policy":            networkContract("aws.iam.policy-document", "aws.iam.policy-document.gateway-endpoint-resource-policy", serviceGatewayVPCEndpoint, "aws.ec2.gateway-vpc-endpoint.resource-policy", 1, 1),
	"aws.ec2.vpc-associates-security-group":           networkContract(serviceVPC, "aws.ec2.vpc.security-group-association", serviceSecurityGroup, "aws.ec2.security-group.vpc", 100, 1),
	"aws.ec2.security-group-owns-ingress-rule":        networkContract(serviceSecurityGroupIngressRule, "aws.ec2.security-group-ingress-rule.security-group", serviceSecurityGroup, "aws.ec2.security-group.ingress-rule", 1, 100),
	"aws.ec2.security-group-owns-egress-rule":         networkContract(serviceSecurityGroupEgressRule, "aws.ec2.security-group-egress-rule.security-group", serviceSecurityGroup, "aws.ec2.security-group.egress-rule", 1, 100),
	"aws.lambda.owns-vpc-access-configuration":        networkContract(serviceLambdaVPCConfiguration, "aws.lambda.vpc-access-configuration.function", "aws.lambda.function", "aws.lambda.function.vpc-access", 1, 1),
	"aws.lambda.vpc-access-uses-subnet":               networkContract(serviceLambdaVPCConfiguration, "aws.lambda.vpc-access-configuration.subnet", serviceSubnet, "aws.ec2.subnet.lambda-vpc-access", 16, 100),
	"aws.lambda.vpc-access-uses-security-group":       networkContract(serviceLambdaVPCConfiguration, "aws.lambda.vpc-access-configuration.security-group", serviceSecurityGroup, "aws.ec2.security-group.lambda-vpc-access", 5, 100),
}

func isNetworkingService(service string) bool {
	switch service {
	case serviceRegionBoundary, serviceVPC, serviceAvailabilityZone, serviceSubnet,
		serviceRouteTable, serviceRoute, serviceRouteTableAssociation,
		serviceInternetGateway, serviceNATGateway, serviceGatewayVPCEndpoint,
		serviceSecurityGroup, serviceSecurityGroupIngressRule,
		serviceSecurityGroupEgressRule, serviceLambdaVPCConfiguration:
		return true
	default:
		return false
	}
}

func isNetworkingRelationship(relationship string) bool {
	_, ok := networkingRelationshipContracts[relationship]
	return ok
}

func (renderer *terraformRenderer) validateNetworkingModel() {
	if renderer.model == nil || !renderer.isCurrentCatalog() {
		return
	}

	for _, external := range renderer.model.ExternalResources {
		for _, reference := range external.ArchitectureNodes {
			resource, ok := renderer.resourceByID(reference.NodeID)
			if ok && isNetworkingService(resource.ServiceType) {
				renderer.error("TARGET_NETWORK_EXTERNAL_OWNERSHIP_UNSUPPORTED", "Curated networking resources must remain generated-IaC owned; reference/import modes need separately reviewed target semantics.", SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
			}
		}
	}

	groupNamesByVPC := map[string]bool{}
	for _, resource := range renderer.model.Resources {
		if isNetworkingService(resource.ServiceType) && resource.ResourceType != resource.ServiceType {
			renderer.error("TARGET_NETWORK_RESOURCE_TYPE_INVALID", "Networking resource type must match its exact catalog service type.", SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
			continue
		}
		switch resource.ServiceType {
		case serviceRegionBoundary:
			if renderer.validateNetworkConfiguration(resource, "aws.region.boundary.configuration", "1.0.0", []string{"regionName"}) && renderer.configString(resource, "regionName") != renderer.model.Provenance.Region {
				renderer.error("TARGET_NETWORK_REGION_MISMATCH", "Region boundary must match the immutable Architecture provider Region.", SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
			}
			if resource.Parent != nil {
				renderer.error("TARGET_NETWORK_ANCESTRY_INVALID", "Region boundary must remain at the architecture root.", SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
			}
		case serviceVPC:
			renderer.validateNetworkConfiguration(resource, "aws.ec2.vpc.configuration", "1.0.0", []string{"cidrBlock", "enableDnsHostnames", "enableDnsSupport", "instanceTenancy"})
			if resource.Configuration.Values["enableDnsHostnames"].Kind == "boolean" && resource.Configuration.Values["enableDnsSupport"].Kind == "boolean" && renderer.configBool(resource, "enableDnsHostnames") && !renderer.configBool(resource, "enableDnsSupport") {
				renderer.error("TARGET_NETWORK_DNS_CONFIGURATION_INVALID", "VPC DNS hostnames require DNS support. Enable DNS support or explicitly disable DNS hostnames; declared settings are never changed automatically.", SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
			}
			renderer.requireNetworkParent(resource, serviceRegionBoundary, "aws.region.contains-vpc", false)
			if renderer.configString(resource, "instanceTenancy") != "default" {
				renderer.error("TARGET_NETWORK_MODE_UNSUPPORTED", "Only default VPC tenancy is supported.", SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
			}
		case serviceAvailabilityZone:
			renderer.validateNetworkConfiguration(resource, "aws.ec2.availability-zone.configuration", "1.0.0", []string{"zoneName"})
			renderer.requireNetworkParent(resource, serviceVPC, "aws.ec2.vpc-contains-availability-zone", false)
		case serviceSubnet:
			renderer.validateNetworkConfiguration(resource, "aws.ec2.subnet.configuration", "1.0.0", []string{"accessTier", "assignIpv6AddressOnCreation", "cidrBlock", "mapPublicIpOnLaunch"})
			renderer.requireNetworkParent(resource, serviceAvailabilityZone, "aws.ec2.availability-zone-contains-subnet", false)
			if renderer.configBool(resource, "assignIpv6AddressOnCreation") {
				renderer.error("TARGET_NETWORK_IPV6_UNSUPPORTED", "IPv6 subnet addressing is outside the curated Terraform networking target.", SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
			}
		case serviceRouteTable:
			renderer.validateNetworkConfiguration(resource, "aws.ec2.route-table.configuration", "1.0.0", []string{"name"})
			renderer.requireNetworkParent(resource, serviceVPC, "aws.ec2.vpc-contains-route-table", false)
		case serviceRoute:
			renderer.validateNetworkConfiguration(resource, "aws.ec2.route.configuration", "1.0.0", []string{"destinationIpv4Cidr"})
			renderer.requireNetworkParent(resource, serviceRouteTable, "aws.ec2.route-table-owns-route", true)
			targets := append(renderer.relatedResources(resource.ID, "aws.ec2.route-targets-internet-gateway", false), renderer.relatedResources(resource.ID, "aws.ec2.route-targets-nat-gateway", false)...)
			if len(targets) != 1 {
				renderer.error("TARGET_NETWORK_ROUTE_TARGET_INVALID", "Every route must select exactly one supported internet or NAT gateway target.", SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
			}
		case serviceRouteTableAssociation:
			renderer.validateNetworkConfiguration(resource, "aws.ec2.route-table-association.configuration", "1.0.0", []string{})
			renderer.requireNetworkParent(resource, serviceRouteTable, "aws.ec2.route-table-owns-subnet-association", true)
			if len(renderer.relatedResources(resource.ID, "aws.ec2.route-table-association-targets-subnet", false)) != 1 {
				renderer.error("TARGET_NETWORK_ASSOCIATION_INVALID", "Route-table association must select exactly one subnet.", SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
			}
		case serviceInternetGateway:
			renderer.validateNetworkConfiguration(resource, "aws.ec2.internet-gateway.configuration", "1.0.0", []string{"name"})
			if len(renderer.relatedResources(resource.ID, "aws.ec2.vpc-attaches-internet-gateway", true)) != 1 {
				renderer.error("TARGET_NETWORK_INTERNET_GATEWAY_ATTACHMENT_INVALID", "Internet gateway must attach to exactly one VPC.", SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
			}
		case serviceNATGateway:
			renderer.validateNetworkConfiguration(resource, "aws.ec2.nat-gateway.configuration", "1.0.0", []string{"allocationId", "availabilityMode", "connectivityType"})
			renderer.requireNetworkParent(resource, serviceSubnet, "aws.ec2.subnet-contains-nat-gateway", false)
			if renderer.configString(resource, "connectivityType") != "public" || renderer.configString(resource, "availabilityMode") != "zonal" {
				renderer.error("TARGET_NETWORK_NAT_MODE_UNSUPPORTED", "Only zonal public NAT gateways with explicit reviewed Elastic IP allocation IDs are supported.", SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
			}
			vpcID, vpcOK := renderer.networkVPCID(resource)
			subnetID, subnetIDOK := renderer.parentIDOfType(resource, serviceSubnet)
			subnet, subnetOK := renderer.resourceByID(subnetID)
			if !vpcOK || !subnetIDOK || !subnetOK || !renderer.subnetHasInternetGatewayDefault(subnet, vpcID) {
				renderer.error("TARGET_NETWORK_NAT_INTERNET_GATEWAY_REQUIRED", "A public NAT gateway requires a public parent subnet with one explicit route-table association and one default route to an internet gateway attached to the same VPC.", SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
			}
		case serviceGatewayVPCEndpoint:
			renderer.validateNetworkConfiguration(resource, "aws.ec2.gateway-vpc-endpoint.configuration", "1.0.0", []string{"endpointType", "policyMode", "service"})
			renderer.requireNetworkParent(resource, serviceVPC, "aws.ec2.vpc-contains-gateway-endpoint", false)
			renderer.validateGatewayEndpoint(resource)
		case serviceSecurityGroup:
			renderer.validateNetworkConfiguration(resource, "aws.ec2.security-group.configuration", "1.0.0", []string{"description", "groupName"})
			renderer.validateSecurityGroupDescription(resource)
			vpcs := renderer.relatedResources(resource.ID, "aws.ec2.vpc-associates-security-group", true)
			if len(vpcs) != 1 || vpcs[0].ServiceType != serviceVPC {
				renderer.error("TARGET_NETWORK_SECURITY_GROUP_VPC_INVALID", "Security group must associate with exactly one VPC.", SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
			} else if name := renderer.configString(resource, "groupName"); name != "" {
				key := vpcs[0].ID + "\x00" + strings.ToLower(name)
				if groupNamesByVPC[key] {
					renderer.error("TARGET_NETWORK_SECURITY_GROUP_NAME_DUPLICATE", "Security group names must be unique within one VPC, ignoring letter case. Rename one explicitly; export never rewrites names or associations.", SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
				}
				groupNamesByVPC[key] = true
			}
		case serviceSecurityGroupIngressRule:
			renderer.validateNetworkConfiguration(resource, "aws.ec2.security-group-ingress-rule.configuration", "1.0.0", []string{"description", "fromPort", "protocol", "sourceIpv4Cidr", "toPort"})
			renderer.validateSecurityGroupDescription(resource)
			renderer.requireNetworkParent(resource, serviceSecurityGroup, "aws.ec2.security-group-owns-ingress-rule", true)
		case serviceSecurityGroupEgressRule:
			renderer.validateNetworkConfiguration(resource, "aws.ec2.security-group-egress-rule.configuration", "1.0.0", []string{"description", "destinationIpv4Cidr", "fromPort", "protocol", "toPort"})
			renderer.validateSecurityGroupDescription(resource)
			renderer.requireNetworkParent(resource, serviceSecurityGroup, "aws.ec2.security-group-owns-egress-rule", true)
		case serviceLambdaVPCConfiguration:
			renderer.validateNetworkConfiguration(resource, "aws.lambda.vpc-access-configuration.configuration", "1.1.0", []string{"egressRequirement", "ipv6AllowedForDualStack"})
			renderer.requireNetworkParent(resource, "aws.lambda.function", "aws.lambda.owns-vpc-access-configuration", true)
			renderer.validateLambdaVPCConfiguration(resource)
		}
	}

	sourceCounts := map[string]int{}
	targetCounts := map[string]int{}
	pairCounts := map[string]int{}
	for _, connection := range renderer.model.Connections {
		if _, networking := networkingRelationshipContracts[connection.RelationshipType]; !networking {
			continue
		}
		sourceCounts[connection.RelationshipType+"\x00"+connection.Source.NodeID]++
		targetCounts[connection.RelationshipType+"\x00"+connection.Target.NodeID]++
		pairCounts[connection.RelationshipType+"\x00"+connection.Source.NodeID+"\x00"+connection.Target.NodeID]++
	}

	for _, connection := range renderer.model.Connections {
		contract, networking := networkingRelationshipContracts[connection.RelationshipType]
		if !networking {
			continue
		}
		source, sourceOK := renderer.resourceByID(connection.Source.NodeID)
		target, targetOK := renderer.resourceByID(connection.Target.NodeID)
		if !sourceOK || !targetOK || source.ServiceType != contract.services[0] || target.ServiceType != contract.services[1] {
			renderer.error("TARGET_NETWORK_RELATIONSHIP_INVALID", "Networking relationship endpoints do not match the exact catalog contract.", SourceReference{Document: DocumentArchitecture, EdgeID: connection.ID})
			continue
		}
		if connection.Source.Port != contract.ports[0] || connection.Target.Port != contract.ports[1] || connection.Source.TargetKey != source.TargetKey || connection.Target.TargetKey != target.TargetKey {
			renderer.error("TARGET_NETWORK_RELATIONSHIP_BINDING_INVALID", "Networking relationship ports and stable endpoint references must match the exact catalog contract.", SourceReference{Document: DocumentArchitecture, EdgeID: connection.ID})
		}
		schemaID := connection.RelationshipType + ".connection"
		if connection.RelationshipType == kmsPolicyScopeRelationship {
			schemaID = "aws.iam.policy-statement-authorizes-kms-key.connection"
		}
		if connection.RelationshipType == secretEncryptionRelationship {
			schemaID = "aws.kms.key-encrypts-secret.connection"
		}
		if connection.RelationshipType == secretScopeRelationship {
			schemaID = "aws.iam.policy-statement-authorizes-secret.connection"
		}
		if rule := ec2RuleID(connection.RelationshipType); rule != "" {
			schemaID = rule + ".connection"
		}
		configurationKeys := []string{}
		if connection.RelationshipType == ecsSecretBinding {
			configurationKeys = []string{"environmentName", "populationStatus"}
		}
		if connection.Configuration.SchemaID != schemaID || connection.Configuration.SchemaVersion != "1.0.0" || !exactConfigurationKeys(connection.Configuration, configurationKeys) {
			renderer.error("TARGET_NETWORK_RELATIONSHIP_CONFIGURATION_INVALID", "Networking relationship configuration must use the exact empty catalog schema.", SourceReference{Document: DocumentArchitecture, EdgeID: connection.ID})
		}
		if sourceCounts[connection.RelationshipType+"\x00"+connection.Source.NodeID] > contract.maximumPerSource || targetCounts[connection.RelationshipType+"\x00"+connection.Target.NodeID] > contract.maximumPerTarget || pairCounts[connection.RelationshipType+"\x00"+connection.Source.NodeID+"\x00"+connection.Target.NodeID] > contract.maximumPerPair {
			renderer.error("TARGET_NETWORK_RELATIONSHIP_CARDINALITY_INVALID", "Networking relationship exceeds an exact catalog source, target, or endpoint-pair cardinality.", SourceReference{Document: DocumentArchitecture, EdgeID: connection.ID})
		}
		if requiresSameVPC(connection.RelationshipType) {
			sourceVPC, sourceVpcOK := renderer.networkVPCID(source)
			targetVPC, targetVpcOK := renderer.networkVPCID(target)
			if !sourceVpcOK || !targetVpcOK || sourceVPC != targetVPC {
				renderer.error("TARGET_NETWORK_CROSS_VPC_UNSUPPORTED", "Networking relationship must remain inside one exact VPC.", SourceReference{Document: DocumentArchitecture, EdgeID: connection.ID})
			}
		}
	}
}

func (renderer *terraformRenderer) validateNetworkConfiguration(resource NormalizedResource, schemaID string, schemaVersion string, keys []string) bool {
	if resource.Configuration.SchemaID != schemaID || resource.Configuration.SchemaVersion != schemaVersion || !exactConfigurationKeys(resource.Configuration, keys) {
		renderer.error("TARGET_NETWORK_CONFIGURATION_UNSUPPORTED", "Networking configuration does not match the exact implemented catalog schema.", SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
		return false
	}
	// IAM endpoint policies also reuse this exact-schema check, while their
	// literal contracts are owned by the IAM validator.
	if !isNetworkingService(resource.ServiceType) {
		return true
	}
	valid := true
	for _, key := range keys {
		if !networkConfigurationValueValid(resource, key) {
			renderer.error("TARGET_NETWORK_CONFIGURATION_VALUE_INVALID", "Networking field "+key+" must satisfy its exact catalog literal type, format, and range.", SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
			valid = false
		}
	}
	if resource.ServiceType == serviceSecurityGroupIngressRule || resource.ServiceType == serviceSecurityGroupEgressRule {
		if !networkRulePortsValid(resource) {
			renderer.error("TARGET_NETWORK_PORT_RANGE_INVALID", "Security group rule ports must match the selected protocol and form a supported ordered range.", SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
			valid = false
		}
	}
	return valid
}

var networkRegionPattern = regexp.MustCompile(`^[a-z]{2}(?:-[a-z0-9]+)+-[0-9]+$`)
var networkZonePattern = regexp.MustCompile(`^[a-z]{2}(?:-[a-z0-9]+)+-[0-9]+[a-z]$`)
var networkNamePattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9 ._/-]*$`)
var networkGroupNamePattern = regexp.MustCompile(`^[A-Za-z0-9 _.-]+$`)
var networkAllocationPattern = regexp.MustCompile(`^eipalloc-[0-9a-f]+$`)
var networkCIDRPattern = regexp.MustCompile(`^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/(?:[0-9]|[12][0-9]|3[0-2])$`)

// This closed guard mirrors the current networking catalog, without defaulting or
// coercing stored values. Both target adapters run it before rendering.
func networkConfigurationValueValid(resource NormalizedResource, key string) bool {
	value := resource.Configuration.Values[key]
	switch key {
	case "enableDnsHostnames", "enableDnsSupport", "mapPublicIpOnLaunch", "assignIpv6AddressOnCreation", "ipv6AllowedForDualStack":
		literal, ok := value.Value.(bool)
		return value.Kind == "boolean" && ok && ((key != "assignIpv6AddressOnCreation" && key != "ipv6AllowedForDualStack") || !literal)
	case "fromPort", "toPort":
		literal, ok := value.Value.(float64)
		return value.Kind == "integer" && ok && !math.IsNaN(literal) && !math.IsInf(literal, 0) && math.Trunc(literal) == literal && literal >= -1 && literal <= 65535
	}
	literal, ok := value.Value.(string)
	if value.Kind != "string" || !ok {
		return false
	}
	switch key {
	case "regionName":
		return len(literal) >= 8 && len(literal) <= 32 && networkRegionPattern.MatchString(literal)
	case "zoneName":
		return len(literal) >= 9 && len(literal) <= 33 && networkZonePattern.MatchString(literal)
	case "cidrBlock", "destinationIpv4Cidr", "sourceIpv4Cidr":
		minimum, maximum := 0, 32
		if resource.ServiceType == serviceVPC || resource.ServiceType == serviceSubnet {
			minimum, maximum = 16, 28
		}
		return networkIPv4CIDRValid(literal, minimum, maximum)
	case "instanceTenancy":
		return literal == "default"
	case "accessTier":
		return literal == "public" || literal == "private"
	case "name":
		return len(literal) >= 1 && len(literal) <= 128 && networkNamePattern.MatchString(literal)
	case "allocationId":
		return len(literal) >= 13 && len(literal) <= 64 && networkAllocationPattern.MatchString(literal)
	case "availabilityMode":
		return literal == "zonal"
	case "connectivityType":
		return literal == "public"
	case "endpointType":
		return literal == "Gateway"
	case "policyMode":
		return literal == "full-access" || literal == "restricted"
	case "service":
		return literal == "s3" || literal == "dynamodb"
	case "groupName":
		return len(literal) >= 1 && len(literal) <= 255 && !strings.HasPrefix(literal, "sg-") && networkGroupNamePattern.MatchString(literal)
	case "description":
		return validSecurityGroupDescription(literal, 255, resource.ServiceType == serviceSecurityGroup)
	case "protocol":
		return literal == "tcp" || literal == "udp" || literal == "icmp" || literal == "-1"
	case "egressRequirement":
		return literal == "none" || literal == "internet" || literal == "s3" || literal == "dynamodb" || literal == "s3-and-dynamodb"
	default:
		return false
	}
}

func networkIPv4CIDRValid(value string, minimum, maximum int) bool {
	if len(value) < 9 || len(value) > 18 || !networkCIDRPattern.MatchString(value) {
		return false
	}
	parts := strings.Split(value, "/")
	bits, _ := strconv.Atoi(parts[1])
	if bits < minimum || bits > maximum {
		return false
	}
	var octets [4]byte
	for index, text := range strings.Split(parts[0], ".") {
		octet, err := strconv.Atoi(text)
		if err != nil || octet > 255 {
			return false
		}
		octets[index] = byte(octet)
	}
	prefix := netip.PrefixFrom(netip.AddrFrom4(octets), bits)
	return prefix == prefix.Masked()
}

func networkRulePortsValid(resource NormalizedResource) bool {
	if !networkConfigurationValueValid(resource, "fromPort") || !networkConfigurationValueValid(resource, "toPort") || !networkConfigurationValueValid(resource, "protocol") {
		return false
	}
	from := resource.Configuration.Values["fromPort"].Value.(float64)
	to := resource.Configuration.Values["toPort"].Value.(float64)
	protocol := resource.Configuration.Values["protocol"].Value.(string)
	switch protocol {
	case "-1":
		return from == -1 && to == -1
	case "icmp":
		return from <= 255 && to <= 255 && (from != -1 || to == -1)
	default:
		return from >= 0 && from <= to
	}
}

func (renderer *terraformRenderer) requireNetworkParent(resource NormalizedResource, parentService string, relationship string, childIsSource bool) {
	if resource.Parent == nil {
		renderer.error("TARGET_NETWORK_ANCESTRY_INVALID", "Networking resource is missing its required semantic parent.", SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
		return
	}
	parent, ok := renderer.resourceByID(resource.Parent.NodeID)
	if !ok || parent.ServiceType != parentService || resource.Parent.TargetKey != parent.TargetKey || resource.Parent.RelationshipType != relationship {
		renderer.error("TARGET_NETWORK_ANCESTRY_INVALID", "Networking resource parent has an unsupported type.", SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
		return
	}
	matched := 0
	for _, connection := range renderer.model.Connections {
		if connection.RelationshipType != relationship {
			continue
		}
		if childIsSource {
			if connection.Source.NodeID == resource.ID && connection.Target.NodeID == parent.ID {
				matched++
			}
		} else {
			if connection.Source.NodeID == parent.ID && connection.Target.NodeID == resource.ID {
				matched++
			}
		}
	}
	if matched != 1 {
		renderer.error("TARGET_NETWORK_PARENT_EDGE_INVALID", "Semantic parent requires exactly one backing relationship.", SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
	}
}

func requiresSameVPC(relationship string) bool {
	switch relationship {
	case "aws.ec2.route-table-association-targets-subnet", "aws.ec2.route-targets-internet-gateway", "aws.ec2.route-targets-nat-gateway", "aws.ec2.gateway-endpoint-associates-route-table", "aws.ec2.vpc-associates-security-group":
		return true
	default:
		return false
	}
}

func (renderer *terraformRenderer) relatedResources(nodeID string, relationship string, nodeIsTarget bool) []NormalizedResource {
	result := []NormalizedResource{}
	for _, connection := range renderer.model.Connections {
		if connection.RelationshipType != relationship {
			continue
		}
		otherID := ""
		if nodeIsTarget && connection.Target.NodeID == nodeID {
			otherID = connection.Source.NodeID
		} else if !nodeIsTarget && connection.Source.NodeID == nodeID {
			otherID = connection.Target.NodeID
		}
		if otherID != "" {
			if resource, ok := renderer.resourceByID(otherID); ok {
				result = append(result, resource)
			}
		}
	}
	sort.Slice(result, func(left int, right int) bool {
		return compareUTF16(result[left].TargetKey+"\x00"+result[left].ID, result[right].TargetKey+"\x00"+result[right].ID) < 0
	})
	return result
}

func (renderer *terraformRenderer) subnetHasInternetGatewayDefault(subnet NormalizedResource, vpcID string) bool {
	if subnet.ServiceType != serviceSubnet || renderer.configString(subnet, "accessTier") != "public" {
		return false
	}
	associations := renderer.relatedResources(subnet.ID, "aws.ec2.route-table-association-targets-subnet", true)
	if len(associations) != 1 || associations[0].ServiceType != serviceRouteTableAssociation {
		return false
	}
	tables := renderer.relatedResources(associations[0].ID, "aws.ec2.route-table-owns-subnet-association", false)
	if len(tables) != 1 || tables[0].ServiceType != serviceRouteTable {
		return false
	}
	tableVPC, tableVPCOK := renderer.networkVPCID(tables[0])
	if !tableVPCOK || tableVPC != vpcID {
		return false
	}
	validDefaults := 0
	for _, route := range renderer.relatedResources(tables[0].ID, "aws.ec2.route-table-owns-route", true) {
		if route.ServiceType != serviceRoute || renderer.configString(route, "destinationIpv4Cidr") != "0.0.0.0/0" {
			continue
		}
		gateways := renderer.relatedResources(route.ID, "aws.ec2.route-targets-internet-gateway", false)
		if len(gateways) != 1 || gateways[0].ServiceType != serviceInternetGateway {
			continue
		}
		gatewayVPC, gatewayVPCOK := renderer.networkVPCID(gateways[0])
		if gatewayVPCOK && gatewayVPC == vpcID {
			validDefaults++
		}
	}
	return validDefaults == 1
}

func (renderer *terraformRenderer) networkVPCID(resource NormalizedResource) (string, bool) {
	switch resource.ServiceType {
	case serviceVPC:
		return resource.ID, true
	case serviceAvailabilityZone, serviceRouteTable, serviceGatewayVPCEndpoint:
		return renderer.parentIDOfType(resource, serviceVPC)
	case serviceSubnet:
		azID, ok := renderer.parentIDOfType(resource, serviceAvailabilityZone)
		if !ok {
			return "", false
		}
		az, ok := renderer.resourceByID(azID)
		if !ok {
			return "", false
		}
		return renderer.parentIDOfType(az, serviceVPC)
	case serviceRoute, serviceRouteTableAssociation:
		tableID, ok := renderer.parentIDOfType(resource, serviceRouteTable)
		if !ok {
			return "", false
		}
		table, ok := renderer.resourceByID(tableID)
		if !ok {
			return "", false
		}
		return renderer.parentIDOfType(table, serviceVPC)
	case serviceNATGateway:
		subnetID, ok := renderer.parentIDOfType(resource, serviceSubnet)
		if !ok {
			return "", false
		}
		subnet, ok := renderer.resourceByID(subnetID)
		if !ok {
			return "", false
		}
		return renderer.networkVPCID(subnet)
	case serviceInternetGateway:
		vpcs := renderer.relatedResources(resource.ID, "aws.ec2.vpc-attaches-internet-gateway", true)
		if len(vpcs) == 1 {
			return vpcs[0].ID, true
		}
	case serviceSecurityGroup:
		vpcs := renderer.relatedResources(resource.ID, "aws.ec2.vpc-associates-security-group", true)
		if len(vpcs) == 1 {
			return vpcs[0].ID, true
		}
	case serviceSecurityGroupIngressRule, serviceSecurityGroupEgressRule:
		groupID, ok := renderer.parentIDOfType(resource, serviceSecurityGroup)
		if !ok {
			return "", false
		}
		group, ok := renderer.resourceByID(groupID)
		if !ok {
			return "", false
		}
		return renderer.networkVPCID(group)
	}
	return "", false
}

func (renderer *terraformRenderer) validateSecurityGroupDescription(resource NormalizedResource) {
	description := renderer.configString(resource, "description")
	if !validSecurityGroupDescription(description, 255, resource.ServiceType == serviceSecurityGroup) {
		renderer.error("TARGET_NETWORK_SECURITY_GROUP_DESCRIPTION_INVALID", "Security group descriptions require 1-255 AWS-supported ASCII characters without line breaks; ampersands are allowed only on the group, not its rules.", SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
	}
}

func validSecurityGroupDescription(description string, maximum int, group bool) bool {
	if len(description) < 1 || len(description) > maximum {
		return false
	}
	for _, character := range description {
		if character >= 'a' && character <= 'z' || character >= 'A' && character <= 'Z' || character >= '0' && character <= '9' || strings.ContainsRune(" ._-:/()#,@[]+=;{}!$*", character) || character == '&' && group {
			continue
		}
		return false
	}
	return true
}

func (renderer *terraformRenderer) parentIDOfType(resource NormalizedResource, service string) (string, bool) {
	if resource.Parent == nil {
		return "", false
	}
	parent, ok := renderer.resourceByID(resource.Parent.NodeID)
	return resource.Parent.NodeID, ok && parent.ServiceType == service
}

func (renderer *terraformRenderer) validateGatewayEndpoint(endpoint NormalizedResource) {
	service := renderer.configString(endpoint, "service")
	if renderer.configString(endpoint, "endpointType") != "Gateway" || (service != "s3" && service != "dynamodb") {
		renderer.error("TARGET_NETWORK_ENDPOINT_MODE_UNSUPPORTED", "Only same-Region S3 and DynamoDB Gateway endpoints are supported.", SourceReference{Document: DocumentArchitecture, NodeID: endpoint.ID})
	}
	if len(renderer.relatedResources(endpoint.ID, "aws.ec2.gateway-endpoint-associates-route-table", false)) == 0 {
		renderer.error("TARGET_NETWORK_ENDPOINT_ROUTE_TABLE_REQUIRED", "Gateway endpoint requires at least one exact route-table association.", SourceReference{Document: DocumentArchitecture, NodeID: endpoint.ID})
	}
	policies := renderer.relatedResources(endpoint.ID, "aws.ec2.gateway-endpoint-owns-policy", true)
	mode := renderer.configString(endpoint, "policyMode")
	if (mode == "restricted" && len(policies) != 1) || (mode == "full-access" && len(policies) != 0) || (mode != "restricted" && mode != "full-access") {
		renderer.error("TARGET_NETWORK_ENDPOINT_POLICY_INVALID", "Endpoint policy mode and graph-owned canonical policy must match exactly.", SourceReference{Document: DocumentArchitecture, NodeID: endpoint.ID})
	}
	if len(policies) == 1 && policies[0].Lifecycle.Ownership != "user" {
		renderer.error("TARGET_NETWORK_ENDPOINT_POLICY_OWNERSHIP_INVALID", "Restricted endpoint policy must remain explicitly user-owned and cannot masquerade as generated policy.", SourceReference{Document: DocumentArchitecture, NodeID: policies[0].ID})
	}
}

func (renderer *terraformRenderer) validateLambdaVPCConfiguration(configuration NormalizedResource) {
	if renderer.configBool(configuration, "ipv6AllowedForDualStack") {
		renderer.error("TARGET_NETWORK_IPV6_UNSUPPORTED", "Lambda dual-stack VPC access is outside the curated IPv4 target.", SourceReference{Document: DocumentArchitecture, NodeID: configuration.ID})
	}
	subnets := renderer.relatedResources(configuration.ID, "aws.lambda.vpc-access-uses-subnet", false)
	groups := renderer.relatedResources(configuration.ID, "aws.lambda.vpc-access-uses-security-group", false)
	if len(subnets) == 0 || len(subnets) > 16 || len(groups) == 0 || len(groups) > 5 {
		renderer.error("TARGET_NETWORK_LAMBDA_SELECTION_INVALID", "Lambda VPC access requires 1-16 subnets and 1-5 security groups.", SourceReference{Document: DocumentArchitecture, NodeID: configuration.ID})
		return
	}
	vpcID, ok := renderer.networkVPCID(subnets[0])
	if !ok {
		renderer.error("TARGET_NETWORK_LAMBDA_VPC_INVALID", "Lambda subnet selection does not resolve to one VPC.", SourceReference{Document: DocumentArchitecture, NodeID: configuration.ID})
		return
	}
	for _, resource := range append(append([]NormalizedResource{}, subnets...), groups...) {
		candidate, candidateOK := renderer.networkVPCID(resource)
		if !candidateOK || candidate != vpcID {
			renderer.error("TARGET_NETWORK_LAMBDA_VPC_INVALID", "Lambda VPC subnets and security groups must all belong to one exact VPC.", SourceReference{Document: DocumentArchitecture, NodeID: configuration.ID})
			return
		}
	}
	owner := renderer.relatedResources(configuration.ID, "aws.lambda.owns-vpc-access-configuration", false)
	if len(owner) != 1 || !renderer.hasLambdaVPCManagedPolicy(owner[0].ID) {
		renderer.error("TARGET_NETWORK_LAMBDA_ENI_PERMISSION_REQUIRED", "Lambda VPC access requires the reviewed AWSLambdaVPCAccessExecutionRole managed-policy attachment on its exact execution role.", SourceReference{Document: DocumentArchitecture, NodeID: configuration.ID})
	}
}

func (renderer *terraformRenderer) hasLambdaVPCManagedPolicy(lambdaID string) bool {
	role, ok := renderer.connectedResource(lambdaID, "aws.iam.role-assumed-by-lambda", true)
	if !ok {
		return false
	}
	for _, attachment := range renderer.relatedResources(role.ID, "aws.iam.role-owns-managed-policy-attachment", true) {
		if attachment.ServiceType == "aws.iam.managed-policy-attachment" && renderer.configString(attachment, "attachmentKind") == "managed-policy-attachment" && renderer.configString(attachment, "managedPolicyReference") == lambdaVPCManagedPolicyReference {
			return true
		}
	}
	return false
}

func (renderer *terraformRenderer) renderVPC(resource NormalizedResource) {
	block := renderer.resourceBlock(resource)
	body := block.Body()
	body.SetAttributeValue("cidr_block", cty.StringVal(renderer.configString(resource, "cidrBlock")))
	body.SetAttributeValue("enable_dns_support", cty.BoolVal(renderer.configBool(resource, "enableDnsSupport")))
	body.SetAttributeValue("enable_dns_hostnames", cty.BoolVal(renderer.configBool(resource, "enableDnsHostnames")))
	body.SetAttributeValue("instance_tenancy", cty.StringVal(renderer.configString(resource, "instanceTenancy")))
	body.SetAttributeTraversal("tags", traversal("local", "tags"))
	appendBlock(renderer.file("networking.tf"), block)
}

func (renderer *terraformRenderer) renderSubnet(resource NormalizedResource) {
	azID, _ := renderer.parentIDOfType(resource, serviceAvailabilityZone)
	az, _ := renderer.resourceByID(azID)
	vpcID, _ := renderer.networkVPCID(resource)
	block := renderer.resourceBlock(resource)
	body := block.Body()
	body.SetAttributeRaw("vpc_id", renderer.resourceAttributeTokens(vpcID, "id"))
	body.SetAttributeValue("availability_zone", cty.StringVal(renderer.configString(az, "zoneName")))
	body.SetAttributeValue("cidr_block", cty.StringVal(renderer.configString(resource, "cidrBlock")))
	body.SetAttributeValue("map_public_ip_on_launch", cty.BoolVal(renderer.configBool(resource, "mapPublicIpOnLaunch")))
	body.SetAttributeValue("assign_ipv6_address_on_creation", cty.BoolVal(false))
	body.SetAttributeTraversal("tags", traversal("local", "tags"))
	appendBlock(renderer.file("networking.tf"), block)
}

func (renderer *terraformRenderer) renderRouteTable(resource NormalizedResource) {
	vpcID, _ := renderer.parentIDOfType(resource, serviceVPC)
	block := renderer.resourceBlock(resource)
	block.Body().SetAttributeRaw("vpc_id", renderer.resourceAttributeTokens(vpcID, "id"))
	block.Body().SetAttributeRaw("tags", renderer.namedNetworkTags(renderer.configString(resource, "name")))
	appendBlock(renderer.file("networking.tf"), block)
}

func (renderer *terraformRenderer) renderRoute(resource NormalizedResource) {
	table, _ := renderer.connectedResource(resource.ID, "aws.ec2.route-table-owns-route", false)
	block := renderer.resourceBlock(resource)
	body := block.Body()
	body.SetAttributeRaw("route_table_id", renderer.resourceAttributeTokens(table.ID, "id"))
	body.SetAttributeValue("destination_cidr_block", cty.StringVal(renderer.configString(resource, "destinationIpv4Cidr")))
	if targets := renderer.relatedResources(resource.ID, "aws.ec2.route-targets-internet-gateway", false); len(targets) == 1 {
		body.SetAttributeRaw("gateway_id", renderer.resourceAttributeTokens(targets[0].ID, "id"))
	} else if targets := renderer.relatedResources(resource.ID, "aws.ec2.route-targets-nat-gateway", false); len(targets) == 1 {
		body.SetAttributeRaw("nat_gateway_id", renderer.resourceAttributeTokens(targets[0].ID, "id"))
	}
	appendBlock(renderer.file("networking.tf"), block)
}

func (renderer *terraformRenderer) renderRouteTableAssociation(resource NormalizedResource) {
	table, _ := renderer.connectedResource(resource.ID, "aws.ec2.route-table-owns-subnet-association", false)
	subnet, _ := renderer.connectedResource(resource.ID, "aws.ec2.route-table-association-targets-subnet", false)
	block := renderer.resourceBlock(resource)
	block.Body().SetAttributeRaw("route_table_id", renderer.resourceAttributeTokens(table.ID, "id"))
	block.Body().SetAttributeRaw("subnet_id", renderer.resourceAttributeTokens(subnet.ID, "id"))
	appendBlock(renderer.file("networking.tf"), block)
}

func (renderer *terraformRenderer) renderInternetGateway(resource NormalizedResource) {
	vpc, _ := renderer.connectedResource(resource.ID, "aws.ec2.vpc-attaches-internet-gateway", true)
	block := renderer.resourceBlock(resource)
	block.Body().SetAttributeRaw("vpc_id", renderer.resourceAttributeTokens(vpc.ID, "id"))
	block.Body().SetAttributeRaw("tags", renderer.namedNetworkTags(renderer.configString(resource, "name")))
	appendBlock(renderer.file("networking.tf"), block)
}

func (renderer *terraformRenderer) renderNATGateway(resource NormalizedResource) {
	subnetID, _ := renderer.parentIDOfType(resource, serviceSubnet)
	block := renderer.resourceBlock(resource)
	body := block.Body()
	body.SetAttributeValue("allocation_id", cty.StringVal(renderer.configString(resource, "allocationId")))
	body.SetAttributeValue("connectivity_type", cty.StringVal(renderer.configString(resource, "connectivityType")))
	body.SetAttributeValue("availability_mode", cty.StringVal(renderer.configString(resource, "availabilityMode")))
	body.SetAttributeRaw("subnet_id", renderer.resourceAttributeTokens(subnetID, "id"))
	if vpcID, ok := renderer.networkVPCID(resource); ok {
		gateways := []hclwrite.Tokens{}
		for _, gateway := range renderer.model.Resources {
			if gateway.ServiceType == serviceInternetGateway {
				if gatewayVPC, gatewayOK := renderer.networkVPCID(gateway); gatewayOK && gatewayVPC == vpcID {
					gateways = append(gateways, hclwrite.TokensForTraversal(traversal("aws_internet_gateway", renderer.resourceNames[gateway.ID])))
				}
			}
		}
		if len(gateways) == 1 {
			body.SetAttributeRaw("depends_on", tupleTokens(gateways...))
		}
	}
	body.SetAttributeTraversal("tags", traversal("local", "tags"))
	appendBlock(renderer.file("networking.tf"), block)
}

func (renderer *terraformRenderer) renderGatewayVPCEndpoint(resource NormalizedResource) {
	vpcID, _ := renderer.parentIDOfType(resource, serviceVPC)
	block := renderer.resourceBlock(resource)
	body := block.Body()
	body.SetAttributeRaw("vpc_id", renderer.resourceAttributeTokens(vpcID, "id"))
	body.SetAttributeRaw("service_name", formatTokens("com.amazonaws.%s."+renderer.configString(resource, "service"), hclwrite.TokensForTraversal(traversal("var", "aws_region"))))
	body.SetAttributeValue("vpc_endpoint_type", cty.StringVal("Gateway"))
	tables := renderer.relatedResources(resource.ID, "aws.ec2.gateway-endpoint-associates-route-table", false)
	tableTokens := make([]hclwrite.Tokens, 0, len(tables))
	for _, table := range tables {
		tableTokens = append(tableTokens, renderer.resourceAttributeTokens(table.ID, "id"))
	}
	body.SetAttributeRaw("route_table_ids", tupleTokens(tableTokens...))
	if renderer.configString(resource, "policyMode") == "restricted" {
		policies := renderer.relatedResources(resource.ID, "aws.ec2.gateway-endpoint-owns-policy", true)
		if len(policies) == 1 {
			body.SetAttributeTraversal("policy", traversal("data", "aws_iam_policy_document", renderer.resourceNames[policies[0].ID], "json"))
		}
	}
	body.SetAttributeTraversal("tags", traversal("local", "tags"))
	appendBlock(renderer.file("networking.tf"), block)
}

func (renderer *terraformRenderer) renderSecurityGroup(resource NormalizedResource) {
	vpc, _ := renderer.connectedResource(resource.ID, "aws.ec2.vpc-associates-security-group", true)
	block := renderer.resourceBlock(resource)
	body := block.Body()
	body.SetAttributeValue("name", cty.StringVal(renderer.configString(resource, "groupName")))
	body.SetAttributeValue("description", cty.StringVal(renderer.configString(resource, "description")))
	if renderer.elbPeerGroup(resource.ID) {
		dnsLifecycle(body, false)
	}
	body.SetAttributeRaw("vpc_id", renderer.resourceAttributeTokens(vpc.ID, "id"))
	if !renderer.elbPeerGroup(resource.ID) {
		body.SetAttributeValue("egress", cty.EmptyTupleVal)
	}
	body.SetAttributeTraversal("tags", traversal("local", "tags"))
	appendBlock(renderer.file("security.tf"), block)
}

func (renderer *terraformRenderer) renderSecurityGroupRule(resource NormalizedResource, ingress bool) {
	relationship := "aws.ec2.security-group-owns-egress-rule"
	cidrKey := "destinationIpv4Cidr"
	if ingress {
		relationship = "aws.ec2.security-group-owns-ingress-rule"
		cidrKey = "sourceIpv4Cidr"
	}
	group, _ := renderer.connectedResource(resource.ID, relationship, false)
	block := renderer.resourceBlock(resource)
	body := block.Body()
	protocol := renderer.configString(resource, "protocol")
	body.SetAttributeValue("ip_protocol", cty.StringVal(protocol))
	if protocol != "-1" {
		body.SetAttributeValue("from_port", cty.NumberIntVal(int64(renderer.configInt(resource, "fromPort"))))
		body.SetAttributeValue("to_port", cty.NumberIntVal(int64(renderer.configInt(resource, "toPort"))))
	}
	body.SetAttributeValue("cidr_ipv4", cty.StringVal(renderer.configString(resource, cidrKey)))
	body.SetAttributeValue("description", cty.StringVal(renderer.configString(resource, "description")))
	body.SetAttributeRaw("security_group_id", renderer.resourceAttributeTokens(group.ID, "id"))
	appendBlock(renderer.file("security.tf"), block)
}

func (renderer *terraformRenderer) renderLambdaVPCConfig(body *hclwrite.Body, lambda NormalizedResource) {
	configurations := renderer.relatedResources(lambda.ID, "aws.lambda.owns-vpc-access-configuration", true)
	if len(configurations) == 0 {
		return
	}
	configuration := configurations[0]
	subnets := renderer.relatedResources(configuration.ID, "aws.lambda.vpc-access-uses-subnet", false)
	groups := renderer.relatedResources(configuration.ID, "aws.lambda.vpc-access-uses-security-group", false)
	subnetTokens := make([]hclwrite.Tokens, 0, len(subnets))
	for _, subnet := range subnets {
		subnetTokens = append(subnetTokens, renderer.resourceAttributeTokens(subnet.ID, "id"))
	}
	groupTokens := make([]hclwrite.Tokens, 0, len(groups))
	for _, group := range groups {
		groupTokens = append(groupTokens, renderer.resourceAttributeTokens(group.ID, "id"))
	}
	vpcConfig := hclwrite.NewBlock("vpc_config", nil)
	vpcConfig.Body().SetAttributeRaw("subnet_ids", tupleTokens(subnetTokens...))
	vpcConfig.Body().SetAttributeRaw("security_group_ids", tupleTokens(groupTokens...))
	vpcConfig.Body().SetAttributeValue("ipv6_allowed_for_dual_stack", cty.BoolVal(false))
	body.AppendBlock(vpcConfig)
	if attachment, ok := renderer.lambdaVPCManagedPolicyAttachment(lambda.ID); ok {
		body.SetAttributeRaw("depends_on", tupleTokens(hclwrite.TokensForTraversal(traversal("aws_iam_role_policy_attachment", renderer.resourceNames[attachment.ID]))))
	}
}

func (renderer *terraformRenderer) lambdaVPCManagedPolicyAttachment(lambdaID string) (NormalizedResource, bool) {
	role, ok := renderer.connectedResource(lambdaID, "aws.iam.role-assumed-by-lambda", true)
	if !ok {
		return NormalizedResource{}, false
	}
	for _, attachment := range renderer.relatedResources(role.ID, "aws.iam.role-owns-managed-policy-attachment", true) {
		if attachment.ServiceType == "aws.iam.managed-policy-attachment" && renderer.configString(attachment, "attachmentKind") == "managed-policy-attachment" && renderer.configString(attachment, "managedPolicyReference") == lambdaVPCManagedPolicyReference {
			return attachment, true
		}
	}
	return NormalizedResource{}, false
}

func (renderer *terraformRenderer) namedNetworkTags(name string) hclwrite.Tokens {
	return hclwrite.TokensForFunctionCall(
		"merge",
		hclwrite.TokensForTraversal(traversal("local", "tags")),
		hclwrite.TokensForObject([]hclwrite.ObjectAttrTokens{{
			Name:  hclwrite.TokensForIdentifier("Name"),
			Value: hclwrite.TokensForValue(cty.StringVal(strings.TrimSpace(name))),
		}}),
	)
}
