package compiler

func (renderer *cloudFormationRenderer) namedTagList(name string) []any {
	tags := renderer.tagList()
	return append(tags, map[string]any{"Key": "Name", "Value": name})
}

func (renderer *cloudFormationRenderer) renderVPC(resource NormalizedResource) {
	if !renderer.validateConfiguration(resource, "aws.ec2.vpc.configuration", []string{"cidrBlock", "enableDnsHostnames", "enableDnsSupport", "instanceTenancy"}) {
		return
	}
	renderer.addResource(renderer.logicalIDs[resource.ID], cloudFormationResource{
		Type: "AWS::EC2::VPC", Properties: map[string]any{
			"CidrBlock": renderer.configString(resource, "cidrBlock"), "EnableDnsHostnames": renderer.configBool(resource, "enableDnsHostnames"),
			"EnableDnsSupport": renderer.configBool(resource, "enableDnsSupport"), "InstanceTenancy": renderer.configString(resource, "instanceTenancy"),
			"Tags": renderer.tagList(),
		}, Metadata: renderer.resourceMetadata(resource),
	}, SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
}

func (renderer *cloudFormationRenderer) renderSubnet(resource NormalizedResource) {
	if !renderer.validateConfiguration(resource, "aws.ec2.subnet.configuration", []string{"accessTier", "assignIpv6AddressOnCreation", "cidrBlock", "mapPublicIpOnLaunch"}) {
		return
	}
	azID, _ := renderer.parentIDOfType(resource, serviceAvailabilityZone)
	az, _ := renderer.resourceByID(azID)
	vpcID, _ := renderer.networkVPCID(resource)
	renderer.addResource(renderer.logicalIDs[resource.ID], cloudFormationResource{
		Type: "AWS::EC2::Subnet", Properties: map[string]any{
			"AssignIpv6AddressOnCreation": false, "AvailabilityZone": renderer.configString(az, "zoneName"),
			"CidrBlock": renderer.configString(resource, "cidrBlock"), "MapPublicIpOnLaunch": renderer.configBool(resource, "mapPublicIpOnLaunch"),
			"Tags": renderer.tagList(), "VpcId": renderer.resourceAttribute(vpcID, "id"),
		}, Metadata: renderer.resourceMetadata(resource),
	}, SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
}

func (renderer *cloudFormationRenderer) renderRouteTable(resource NormalizedResource) {
	vpcID, _ := renderer.parentIDOfType(resource, serviceVPC)
	renderer.addResource(renderer.logicalIDs[resource.ID], cloudFormationResource{
		Type: "AWS::EC2::RouteTable", Properties: map[string]any{
			"Tags": renderer.namedTagList(renderer.configString(resource, "name")), "VpcId": renderer.resourceAttribute(vpcID, "id"),
		}, Metadata: renderer.resourceMetadata(resource),
	}, SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
}

func (renderer *cloudFormationRenderer) gatewayAttachmentLogicalID(gatewayID string) string {
	return renderer.derivedLogicalID(renderer.logicalIDs[gatewayID] + " vpc attachment")
}

func (renderer *cloudFormationRenderer) renderInternetGateway(resource NormalizedResource) {
	vpc, _ := renderer.connectedResource(resource.ID, "aws.ec2.vpc-attaches-internet-gateway", true)
	renderer.addResource(renderer.logicalIDs[resource.ID], cloudFormationResource{
		Type: "AWS::EC2::InternetGateway", Properties: map[string]any{
			"Tags": renderer.namedTagList(renderer.configString(resource, "name")),
		}, Metadata: renderer.resourceMetadata(resource),
	}, SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
	attachmentID := renderer.gatewayAttachmentLogicalID(resource.ID)
	renderer.addResource(attachmentID, cloudFormationResource{
		Type: "AWS::EC2::VPCGatewayAttachment", Properties: map[string]any{
			"InternetGatewayId": renderer.resourceAttribute(resource.ID, "id"), "VpcId": renderer.resourceAttribute(vpc.ID, "id"),
		}, Metadata: map[string]any{"CloudMarkup": map[string]any{"DerivedFromGraphId": resource.ID, "Relationship": "aws.ec2.vpc-attaches-internet-gateway"}},
	}, SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
}

func (renderer *cloudFormationRenderer) renderRoute(resource NormalizedResource) {
	table, _ := renderer.connectedResource(resource.ID, "aws.ec2.route-table-owns-route", false)
	properties := map[string]any{"DestinationCidrBlock": renderer.configString(resource, "destinationIpv4Cidr"), "RouteTableId": renderer.resourceAttribute(table.ID, "id")}
	dependsOn := []string{}
	if targets := renderer.relatedResources(resource.ID, "aws.ec2.route-targets-internet-gateway", false); len(targets) == 1 {
		properties["GatewayId"] = renderer.resourceAttribute(targets[0].ID, "id")
		dependsOn = append(dependsOn, renderer.gatewayAttachmentLogicalID(targets[0].ID))
	} else if targets := renderer.relatedResources(resource.ID, "aws.ec2.route-targets-nat-gateway", false); len(targets) == 1 {
		properties["NatGatewayId"] = renderer.resourceAttribute(targets[0].ID, "id")
	}
	renderer.addResource(renderer.logicalIDs[resource.ID], cloudFormationResource{
		Type: "AWS::EC2::Route", Properties: properties, DependsOn: dependsOn, Metadata: renderer.resourceMetadata(resource),
	}, SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
}

func (renderer *cloudFormationRenderer) renderRouteTableAssociation(resource NormalizedResource) {
	table, _ := renderer.connectedResource(resource.ID, "aws.ec2.route-table-owns-subnet-association", false)
	subnet, _ := renderer.connectedResource(resource.ID, "aws.ec2.route-table-association-targets-subnet", false)
	renderer.addResource(renderer.logicalIDs[resource.ID], cloudFormationResource{
		Type: "AWS::EC2::SubnetRouteTableAssociation", Properties: map[string]any{
			"RouteTableId": renderer.resourceAttribute(table.ID, "id"), "SubnetId": renderer.resourceAttribute(subnet.ID, "id"),
		}, Metadata: renderer.resourceMetadata(resource),
	}, SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
}

func (renderer *cloudFormationRenderer) renderNATGateway(resource NormalizedResource) {
	subnetID, _ := renderer.parentIDOfType(resource, serviceSubnet)
	dependsOn := []string{}
	if vpcID, ok := renderer.networkVPCID(resource); ok {
		for _, gateway := range renderer.model.Resources {
			if gateway.ServiceType == serviceInternetGateway {
				if gatewayVPC, matches := renderer.networkVPCID(gateway); matches && gatewayVPC == vpcID {
					dependsOn = append(dependsOn, renderer.gatewayAttachmentLogicalID(gateway.ID))
				}
			}
		}
	}
	metadata := renderer.resourceMetadata(resource)
	metadata["CloudMarkup"].(map[string]any)["TargetDifference"] = "CloudFormation derives zonal NAT placement from SubnetId; availabilityMode remains validated architecture intent."
	renderer.addResource(renderer.logicalIDs[resource.ID], cloudFormationResource{
		Type: "AWS::EC2::NatGateway", Properties: map[string]any{
			"AllocationId": renderer.configString(resource, "allocationId"), "ConnectivityType": renderer.configString(resource, "connectivityType"),
			"SubnetId": renderer.resourceAttribute(subnetID, "id"), "Tags": renderer.tagList(),
		}, DependsOn: dependsOn, Metadata: metadata,
	}, SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
}

func (renderer *cloudFormationRenderer) renderGatewayVPCEndpoint(resource NormalizedResource) {
	vpcID, _ := renderer.parentIDOfType(resource, serviceVPC)
	tables := renderer.relatedResources(resource.ID, "aws.ec2.gateway-endpoint-associates-route-table", false)
	routeTableIDs := make([]any, 0, len(tables))
	for _, table := range tables {
		routeTableIDs = append(routeTableIDs, renderer.resourceAttribute(table.ID, "id"))
	}
	properties := map[string]any{
		"RouteTableIds": routeTableIDs, "ServiceName": cloudFormationSub("com.amazonaws.${AWS::Region}."+renderer.configString(resource, "service"), nil),
		"Tags": renderer.tagList(), "VpcEndpointType": "Gateway", "VpcId": renderer.resourceAttribute(vpcID, "id"),
	}
	if renderer.configString(resource, "policyMode") == "restricted" {
		if policy, ok := renderer.resourcePolicyForOwner(resource.ID); ok {
			properties["PolicyDocument"] = renderer.policyDocument(policy)
		}
	}
	renderer.addResource(renderer.logicalIDs[resource.ID], cloudFormationResource{
		Type: "AWS::EC2::VPCEndpoint", Properties: properties, Metadata: renderer.resourceMetadata(resource),
	}, SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
}

func (renderer *cloudFormationRenderer) renderSecurityGroup(resource NormalizedResource) {
	vpc, _ := renderer.connectedResource(resource.ID, "aws.ec2.vpc-associates-security-group", true)
	res := cloudFormationResource{
		Type: "AWS::EC2::SecurityGroup", Properties: map[string]any{
			"GroupDescription": renderer.configString(resource, "description"), "GroupName": renderer.configString(resource, "groupName"),
			"SecurityGroupEgress": renderer.elbGroupEgress(resource), "Tags": renderer.tagList(), "VpcId": renderer.resourceAttribute(vpc.ID, "id"),
		}, Metadata: renderer.resourceMetadata(resource),
	}
	helper := &terraformRenderer{model: renderer.model}
	if helper.elbPeerGroup(resource.ID) {
		res.DeletionPolicy = "Retain"
		res.UpdateReplacePolicy = "Retain"
	}
	renderer.addResource(renderer.logicalIDs[resource.ID], res, SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
}

func (renderer *cloudFormationRenderer) renderSecurityGroupRule(resource NormalizedResource, ingress bool) {
	relationship := "aws.ec2.security-group-owns-egress-rule"
	cidrProperty, cidrKey, resourceType := "CidrIp", "destinationIpv4Cidr", "AWS::EC2::SecurityGroupEgress"
	if ingress {
		relationship, cidrKey, resourceType = "aws.ec2.security-group-owns-ingress-rule", "sourceIpv4Cidr", "AWS::EC2::SecurityGroupIngress"
	}
	group, _ := renderer.connectedResource(resource.ID, relationship, false)
	properties := map[string]any{
		cidrProperty: renderer.configString(resource, cidrKey), "Description": renderer.configString(resource, "description"),
		"GroupId": renderer.resourceAttribute(group.ID, "id"), "IpProtocol": renderer.configString(resource, "protocol"),
	}
	if renderer.configString(resource, "protocol") != "-1" {
		properties["FromPort"] = renderer.configInt(resource, "fromPort")
		properties["ToPort"] = renderer.configInt(resource, "toPort")
	}
	renderer.addResource(renderer.logicalIDs[resource.ID], cloudFormationResource{
		Type: resourceType, Properties: properties, Metadata: renderer.resourceMetadata(resource),
	}, SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
}

func (renderer *cloudFormationRenderer) renderLambdaVPCConfiguration(properties map[string]any, lambda NormalizedResource) {
	configurations := renderer.relatedResources(lambda.ID, "aws.lambda.owns-vpc-access-configuration", true)
	if len(configurations) == 0 {
		return
	}
	configuration := configurations[0]
	subnets := renderer.relatedResources(configuration.ID, "aws.lambda.vpc-access-uses-subnet", false)
	groups := renderer.relatedResources(configuration.ID, "aws.lambda.vpc-access-uses-security-group", false)
	subnetIDs := make([]any, 0, len(subnets))
	for _, subnet := range subnets {
		subnetIDs = append(subnetIDs, renderer.resourceAttribute(subnet.ID, "id"))
	}
	groupIDs := make([]any, 0, len(groups))
	for _, group := range groups {
		groupIDs = append(groupIDs, renderer.resourceAttribute(group.ID, "id"))
	}
	properties["VpcConfig"] = map[string]any{
		"Ipv6AllowedForDualStack": false, "SecurityGroupIds": groupIDs, "SubnetIds": subnetIDs,
	}
}
