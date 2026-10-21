package compiler

import (
	"github.com/hashicorp/hcl/v2/hclwrite"
	"github.com/zclconf/go-cty/cty"
	"strconv"
)

func (r *terraformRenderer) renderElbResource(n NormalizedResource) {
	if n.ServiceType == serviceAlbAccess {
		return
	}
	block := r.resourceBlock(n)
	b := block.Body()
	dnsLifecycle(b, false)
	b.SetAttributeTraversal("tags", traversal("local", "tags"))
	switch n.ServiceType {
	case serviceAlb:
		b.SetAttributeValue("name", cty.StringVal(r.configString(n, "name")))
		b.SetAttributeValue("internal", cty.BoolVal(r.configString(n, "scheme") == "internal"))
		b.SetAttributeValue("load_balancer_type", cty.StringVal("application"))
		b.SetAttributeValue("ip_address_type", cty.StringVal("ipv4"))
		b.SetAttributeValue("idle_timeout", cty.NumberIntVal(int64(r.configInt(n, "idleTimeoutSeconds"))))
		for _, key := range []string{"enable_deletion_protection", "enable_http2", "drop_invalid_header_fields"} {
			b.SetAttributeValue(key, cty.BoolVal(true))
		}
		b.SetAttributeValue("desync_mitigation_mode", cty.StringVal("defensive"))
		for _, entry := range [][2]string{{albSubnet, "subnets"}, {albGroup, "security_groups"}} {
			refs := []hclwrite.Tokens{}
			for _, s := range r.relatedResources(n.ID, entry[0], false) {
				refs = append(refs, r.resourceAttributeTokens(s.ID, "id"))
			}
			b.SetAttributeRaw(entry[1], tupleTokens(refs...))
		}
		if r.configString(n, "scheme") == "internet-facing" {
			deps := []hclwrite.Tokens{}
			seen := map[string]bool{}
			for _, s := range r.relatedResources(n.ID, albSubnet, false) {
				assoc := r.elbOne(s, "aws.ec2.route-table-association-targets-subnet", true)
				rt := r.elbOne(assoc, "aws.ec2.route-table-owns-subnet-association", false)
				for _, route := range r.relatedResources(rt.ID, "aws.ec2.route-table-owns-route", true) {
					if r.configString(route, "destinationIpv4Cidr") != "0.0.0.0/0" {
						continue
					}
					gateway := r.elbOne(route, "aws.ec2.route-targets-internet-gateway", false)
					if gateway.ID != "" && !seen[gateway.ID] {
						deps = append(deps, hclwrite.TokensForTraversal(traversal("aws_internet_gateway", r.resourceNames[gateway.ID])))
						seen[gateway.ID] = true
					}
					deps = append(deps, hclwrite.TokensForTraversal(traversal("aws_route", r.resourceNames[route.ID])))
				}
			}
			if len(deps) > 0 {
				b.SetAttributeRaw("depends_on", tupleTokens(deps...))
			}
		}
	case serviceAlbTarget:
		v := r.elbOne(n, albTargetVpc, false)
		b.SetAttributeValue("name", cty.StringVal(r.configString(n, "name")))
		b.SetAttributeRaw("vpc_id", r.resourceAttributeTokens(v.ID, "id"))
		b.SetAttributeValue("port", cty.NumberIntVal(int64(r.configInt(n, "port"))))
		b.SetAttributeValue("protocol", cty.StringVal("HTTP"))
		b.SetAttributeValue("protocol_version", cty.StringVal("HTTP1"))
		mode := "instance"
		if r.configString(n, "backendMode") == "ecs-fargate" {
			mode = "ip"
		}
		b.SetAttributeValue("target_type", cty.StringVal(mode))
		b.SetAttributeValue("deregistration_delay", cty.NumberIntVal(int64(r.configInt(n, "deregistrationDelaySeconds"))))
		health := hclwrite.NewBlock("health_check", nil)
		h := health.Body()
		h.SetAttributeValue("enabled", cty.BoolVal(true))
		h.SetAttributeValue("protocol", cty.StringVal("HTTP"))
		h.SetAttributeValue("port", cty.StringVal("traffic-port"))
		h.SetAttributeValue("path", cty.StringVal(r.configString(n, "healthPath")))
		h.SetAttributeValue("matcher", cty.StringVal("200"))
		for _, pair := range [][2]string{{"interval", "healthIntervalSeconds"}, {"timeout", "healthTimeoutSeconds"}, {"healthy_threshold", "healthyThreshold"}, {"unhealthy_threshold", "unhealthyThreshold"}} {
			h.SetAttributeValue(pair[0], cty.NumberIntVal(int64(r.configInt(n, pair[1]))))
		}
		b.AppendBlock(health)
		if mode == "instance" {
			backend := r.elbOne(n, albEc2, false)
			attachment := hclwrite.NewBlock("resource", []string{"aws_lb_target_group_attachment", r.resourceNames[n.ID] + "_instance"})
			ab := attachment.Body()
			ab.SetAttributeRaw("target_group_arn", r.resourceAttributeTokens(n.ID, "arn"))
			ab.SetAttributeRaw("target_id", r.resourceAttributeTokens(backend.ID, "id"))
			ab.SetAttributeValue("port", cty.NumberIntVal(int64(r.configInt(n, "port"))))
			dnsLifecycle(ab, false)
			appendBlock(r.file("elb.tf"), attachment)
		}
		access := r.elbOne(n, albAccess, true)
		ag := r.elbOne(access, albAccessSource, false)
		bg := r.elbOne(access, albAccessTarget, false)
		for _, pair := range [][3]string{{"aws_vpc_security_group_ingress_rule", bg.ID, ag.ID}, {"aws_vpc_security_group_egress_rule", ag.ID, bg.ID}} {
			grant := hclwrite.NewBlock("resource", []string{pair[0], r.resourceNames[access.ID] + map[bool]string{true: "_ingress", false: "_egress"}[pair[0] == "aws_vpc_security_group_ingress_rule"]})
			gb := grant.Body()
			gb.SetAttributeRaw("security_group_id", r.resourceAttributeTokens(pair[1], "id"))
			gb.SetAttributeRaw("referenced_security_group_id", r.resourceAttributeTokens(pair[2], "id"))
			gb.SetAttributeValue("ip_protocol", cty.StringVal("tcp"))
			for _, k := range []string{"from_port", "to_port"} {
				gb.SetAttributeValue(k, cty.NumberIntVal(int64(r.configInt(n, "port"))))
			}
			gb.SetAttributeValue("description", cty.StringVal(r.configString(access, "description")))
			dnsLifecycle(gb, false)
			appendBlock(r.file("elb.tf"), grant)
		}
		r.elbWarnings(access)
	case serviceAlbListener:
		alb := r.elbOne(n, albListener, false)
		tg := r.elbOne(n, albForward, false)
		cert := r.elbOne(n, albCertificate, false)
		b.SetAttributeRaw("load_balancer_arn", r.resourceAttributeTokens(alb.ID, "arn"))
		b.SetAttributeValue("port", cty.NumberIntVal(443))
		b.SetAttributeValue("protocol", cty.StringVal("HTTPS"))
		b.SetAttributeValue("ssl_policy", cty.StringVal(r.configString(n, "securityPolicy")))
		b.SetAttributeRaw("certificate_arn", r.resourceAttributeTokens(cert.ID, "arn"))
		action := hclwrite.NewBlock("default_action", nil)
		action.Body().SetAttributeValue("type", cty.StringVal("forward"))
		action.Body().SetAttributeRaw("target_group_arn", r.resourceAttributeTokens(tg.ID, "arn"))
		b.AppendBlock(action)
	}
	appendBlock(r.file("elb.tf"), block)
	r.elbWarnings(n)
}
func (r *cloudFormationRenderer) renderElbResource(n NormalizedResource) {
	h := &terraformRenderer{model: r.model, limits: r.limits}
	p := map[string]any{"Tags": r.tagList()}
	res := cloudFormationResource{Type: cloudFormationResourceTypeByService[n.ServiceType], Properties: p, Metadata: r.resourceMetadata(n), DeletionPolicy: "Retain", UpdateReplacePolicy: "Retain"}
	switch n.ServiceType {
	case serviceAlb:
		p["Name"] = r.configString(n, "name")
		p["Scheme"] = r.configString(n, "scheme")
		p["Type"] = "application"
		p["IpAddressType"] = "ipv4"
		for _, entry := range [][2]string{{albSubnet, "Subnets"}, {albGroup, "SecurityGroups"}} {
			refs := []any{}
			for _, s := range h.relatedResources(n.ID, entry[0], false) {
				refs = append(refs, r.resourceAttribute(s.ID, "id"))
			}
			p[entry[1]] = refs
		}
		attrs := []any{}
		for _, pair := range [][2]string{{"deletion_protection.enabled", "true"}, {"routing.http2.enabled", "true"}, {"routing.http.drop_invalid_header_fields.enabled", "true"}, {"routing.http.desync_mitigation_mode", "defensive"}, {"idle_timeout.timeout_seconds", strconv.Itoa(r.configInt(n, "idleTimeoutSeconds"))}} {
			attrs = append(attrs, map[string]any{"Key": pair[0], "Value": pair[1]})
		}
		p["LoadBalancerAttributes"] = attrs
		if r.configString(n, "scheme") == "internet-facing" {
			seen := map[string]bool{}
			for _, s := range h.relatedResources(n.ID, albSubnet, false) {
				assoc := h.elbOne(s, "aws.ec2.route-table-association-targets-subnet", true)
				rt := h.elbOne(assoc, "aws.ec2.route-table-owns-subnet-association", false)
				for _, route := range h.relatedResources(rt.ID, "aws.ec2.route-table-owns-route", true) {
					if r.configString(route, "destinationIpv4Cidr") != "0.0.0.0/0" {
						continue
					}
					gateway := h.elbOne(route, "aws.ec2.route-targets-internet-gateway", false)
					if gateway.ID != "" && !seen[gateway.ID] {
						res.DependsOn = append(res.DependsOn, r.gatewayAttachmentLogicalID(gateway.ID))
						seen[gateway.ID] = true
					}
					res.DependsOn = append(res.DependsOn, r.logicalIDs[route.ID])
				}
			}
		}
	case serviceAlbTarget:
		v := h.elbOne(n, albTargetVpc, false)
		p["Name"] = r.configString(n, "name")
		p["VpcId"] = r.resourceAttribute(v.ID, "id")
		p["Port"] = r.configInt(n, "port")
		p["Protocol"] = "HTTP"
		p["ProtocolVersion"] = "HTTP1"
		mode := "instance"
		if r.configString(n, "backendMode") == "ecs-fargate" {
			mode = "ip"
		}
		p["TargetType"] = mode
		p["HealthCheckEnabled"] = true
		p["HealthCheckProtocol"] = "HTTP"
		p["HealthCheckPort"] = "traffic-port"
		p["HealthCheckPath"] = r.configString(n, "healthPath")
		p["Matcher"] = map[string]any{"HttpCode": "200"}
		for _, pair := range [][2]string{{"HealthCheckIntervalSeconds", "healthIntervalSeconds"}, {"HealthCheckTimeoutSeconds", "healthTimeoutSeconds"}, {"HealthyThresholdCount", "healthyThreshold"}, {"UnhealthyThresholdCount", "unhealthyThreshold"}} {
			p[pair[0]] = r.configInt(n, pair[1])
		}
		p["TargetGroupAttributes"] = []any{map[string]any{"Key": "deregistration_delay.timeout_seconds", "Value": strconv.Itoa(r.configInt(n, "deregistrationDelaySeconds"))}}
		if mode == "instance" {
			backend := h.elbOne(n, albEc2, false)
			p["Targets"] = []any{map[string]any{"Id": r.resourceAttribute(backend.ID, "id"), "Port": r.configInt(n, "port")}}
		}
		access := h.elbOne(n, albAccess, true)
		ag := h.elbOne(access, albAccessSource, false)
		bg := h.elbOne(access, albAccessTarget, false)
		r.addResource(r.logicalIDs[access.ID]+"Ingress", cloudFormationResource{Type: "AWS::EC2::SecurityGroupIngress", Properties: map[string]any{"GroupId": r.resourceAttribute(bg.ID, "id"), "SourceSecurityGroupId": r.resourceAttribute(ag.ID, "id"), "IpProtocol": "tcp", "FromPort": r.configInt(n, "port"), "ToPort": r.configInt(n, "port"), "Description": r.configString(access, "description")}, Metadata: r.resourceMetadata(access), DeletionPolicy: "Retain", UpdateReplacePolicy: "Retain"}, SourceReference{Document: DocumentArchitecture, NodeID: access.ID})
		h.elbWarnings(access)
	case serviceAlbListener:
		alb := h.elbOne(n, albListener, false)
		tg := h.elbOne(n, albForward, false)
		cert := h.elbOne(n, albCertificate, false)
		p["LoadBalancerArn"] = r.resourceAttribute(alb.ID, "arn")
		p["Port"] = 443
		p["Protocol"] = "HTTPS"
		p["SslPolicy"] = r.configString(n, "securityPolicy")
		p["Certificates"] = []any{map[string]any{"CertificateArn": r.resourceAttribute(cert.ID, "arn")}}
		p["DefaultActions"] = []any{map[string]any{"Type": "forward", "TargetGroupArn": r.resourceAttribute(tg.ID, "arn")}}
	}
	r.addResource(r.logicalIDs[n.ID], res, SourceReference{Document: DocumentArchitecture, NodeID: n.ID})
	h.elbWarnings(n)
	r.diagnostics = append(r.diagnostics, h.diagnostics...)
}

// An explicit inline rule suppresses AWS's default IPv4/IPv6 egress at creation.
// Ordinary groups use the documented localhost-only placeholder; their reviewed
// network permissions stay in standalone graph-owned rules. ALB source groups
// retain the canonical access node's exact peer permission.
func (r *cloudFormationRenderer) elbGroupEgress(n NormalizedResource) []any {
	h := &terraformRenderer{model: r.model, limits: r.limits}
	access, ok := h.elbSourceAccess(n.ID)
	if !ok {
		return []any{map[string]any{"CidrIp": "127.0.0.1/32", "IpProtocol": "-1"}}
	}
	tg := h.elbOne(access, albAccess, false)
	bg := h.elbOne(access, albAccessTarget, false)
	return []any{map[string]any{"DestinationSecurityGroupId": r.resourceAttribute(bg.ID, "id"), "IpProtocol": "tcp", "FromPort": r.configInt(tg, "port"), "ToPort": r.configInt(tg, "port"), "Description": r.configString(access, "description")}}
}
