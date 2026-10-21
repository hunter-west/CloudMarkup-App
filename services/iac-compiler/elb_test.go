package compiler

import (
	"context"
	"encoding/json"
	"github.com/hashicorp/hcl/v2"
	"github.com/hashicorp/hcl/v2/hclsyntax"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func elbModel(ecs, public bool) *NormalizedSolution {
	m := ec2Model(false)
	if ecs {
		m = ecsModel(false)
	}
	d := dnsModel(false)
	m.Resources = append(m.Resources, d.Resources...)
	m.Connections = append(m.Connections, d.Connections...)
	m.Outputs = nil
	m.Provenance.Catalog = CatalogReference{ID: TerraformCatalogID, Version: CurrentAwsCatalogVersion, Digest: CurrentAwsCatalogDigest}
	v, _ := modelResource(m, "vpc")
	azA, _ := modelResource(m, "az")
	azB := networkResource("az_b", "az_b", serviceAvailabilityZone, serviceAvailabilityZone+".configuration", "1.0.0", map[string]ConfigurationValue{"zoneName": stringValueConfig("us-east-1b")})
	setNetworkParent(&azB, v)
	tier := "private"
	scheme := "internal"
	if public {
		tier = "public"
		scheme = "internet-facing"
	}
	sa := networkSubnet("alb_subnet_a", "10.20.2.0/24", tier, false, azA)
	sb := networkSubnet("alb_subnet_b", "10.20.3.0/24", tier, false, azB)
	g := networkResource("alb_group", "alb_group", serviceSecurityGroup, serviceSecurityGroup+".configuration", "1.0.0", map[string]ConfigurationValue{"groupName": stringValueConfig("synthetic-alb"), "description": stringValueConfig("Explicit HTTPS client ingress and dedicated backend peer egress")})
	ingress := networkResource("alb_client", "alb_client", serviceSecurityGroupIngressRule, serviceSecurityGroupIngressRule+".configuration", "1.0.0", map[string]ConfigurationValue{"description": stringValueConfig("Synthetic declared client CIDR"), "protocol": stringValueConfig("tcp"), "fromPort": integerValue(443), "toPort": integerValue(443), "sourceIpv4Cidr": stringValueConfig("10.20.0.0/16")})
	ingress.Parent = &ResourceReference{NodeID: g.ID, TargetKey: g.TargetKey, RelationshipType: "aws.ec2.security-group-owns-ingress-rule"}
	makeNode := func(id, s string, values map[string]ConfigurationValue) NormalizedResource {
		return networkResource(id, id, s, s+".configuration", "1.0.0", values)
	}
	alb := makeNode("alb", serviceAlb, map[string]ConfigurationValue{"name": stringValueConfig("synthetic-alb"), "scheme": stringValueConfig(scheme), "loadBalancerType": stringValueConfig("application"), "ipAddressType": stringValueConfig("ipv4"), "idleTimeoutSeconds": integerValue(60), "http2": boolValue(true), "dropInvalidHeaders": boolValue(true), "desyncMitigation": stringValueConfig("defensive"), "deletionProtection": boolValue(true), "retain": boolValue(true)})
	mode, backend, rel, grace := "ec2-instance", "instance", albEc2, 0
	if ecs {
		mode, backend, rel, grace = "ecs-fargate", "service", albEcs, 30
	}
	tg := makeNode("target", serviceAlbTarget, map[string]ConfigurationValue{"name": stringValueConfig("synthetic-target"), "backendMode": stringValueConfig(mode), "port": integerValue(8080), "protocol": stringValueConfig("HTTP"), "protocolVersion": stringValueConfig("HTTP1"), "healthPath": stringValueConfig("/health"), "healthStatus": stringValueConfig("200"), "healthIntervalSeconds": integerValue(30), "healthTimeoutSeconds": integerValue(5), "healthyThreshold": integerValue(2), "unhealthyThreshold": integerValue(2), "deregistrationDelaySeconds": integerValue(60), "startupGraceSeconds": integerValue(grace), "retain": boolValue(true)})
	l := makeNode("listener", serviceAlbListener, map[string]ConfigurationValue{"serverName": stringValueConfig("app.example.test"), "port": integerValue(443), "protocol": stringValueConfig("HTTPS"), "securityPolicy": stringValueConfig("ELBSecurityPolicy-TLS13-1-2-2021-06"), "defaultAction": stringValueConfig("forward"), "domainMappingMode": stringValueConfig("external"), "retain": boolValue(true)})
	l.Parent = &ResourceReference{NodeID: alb.ID, TargetKey: alb.TargetKey, RelationshipType: albListener}
	access := makeNode("access", serviceAlbAccess, map[string]ConfigurationValue{"description": stringValueConfig("Exact synthetic ALB health/backend path"), "protocol": stringValueConfig("tcp"), "retain": boolValue(true)})
	access.Parent = &ResourceReference{NodeID: tg.ID, TargetKey: tg.TargetKey, RelationshipType: albAccess}
	m.Resources = append(m.Resources, azB, sa, sb, g, ingress, alb, tg, l, access)
	add := func(id, rel, s, t string) {
		source, _ := modelResource(m, s)
		target, _ := modelResource(m, t)
		m.Connections = append(m.Connections, networkConnection(id, rel, source, target))
	}
	for _, b := range [][4]string{{"az_b_owner", "aws.ec2.vpc-contains-availability-zone", "vpc", "az_b"}, {"alb_a_owner", "aws.ec2.availability-zone-contains-subnet", "az", "alb_subnet_a"}, {"alb_b_owner", "aws.ec2.availability-zone-contains-subnet", "az_b", "alb_subnet_b"}, {"alb_group_vpc", "aws.ec2.vpc-associates-security-group", "vpc", "alb_group"}, {"alb_ingress_owner", "aws.ec2.security-group-owns-ingress-rule", "alb_client", "alb_group"}, {"alb_vpc", albVpc, "alb", "vpc"}, {"alb_sa", albSubnet, "alb", "alb_subnet_a"}, {"alb_sb", albSubnet, "alb", "alb_subnet_b"}, {"alb_sg", albGroup, "alb", "alb_group"}, {"listener_owner", albListener, "listener", "alb"}, {"forward", albForward, "listener", "target"}, {"tls", albCertificate, "listener", "certificate"}, {"target_vpc", albTargetVpc, "target", "vpc"}, {"backend", rel, "target", backend}, {"access_owner", albAccess, "access", "target"}, {"access_source", albAccessSource, "access", "alb_group"}, {"access_target", albAccessTarget, "access", "group"}} {
		add(b[0], b[1], b[2], b[3])
	}
	for _, s := range []NormalizedResource{sa, sb} {
		table := networkRouteTable(s.ID, v)
		assoc := networkAssociation(s.ID, table)
		m.Resources = append(m.Resources, table, assoc)
		add(table.ID+"_vpc", "aws.ec2.vpc-contains-route-table", v.ID, table.ID)
		add(assoc.ID+"_owner", "aws.ec2.route-table-owns-subnet-association", assoc.ID, table.ID)
		add(assoc.ID+"_subnet", "aws.ec2.route-table-association-targets-subnet", assoc.ID, s.ID)
	}
	if public {
		igw := makeNode("alb_igw", serviceInternetGateway, map[string]ConfigurationValue{"name": stringValueConfig("synthetic-alb-igw")})
		m.Resources = append(m.Resources, igw)
		add("alb_igw_vpc", "aws.ec2.vpc-attaches-internet-gateway", v.ID, igw.ID)
		for _, s := range []NormalizedResource{sa, sb} {
			table, _ := modelResource(m, "route_table_"+s.ID)
			route := networkRoute(s.ID, table)
			m.Resources = append(m.Resources, route)
			add(route.ID+"_owner", "aws.ec2.route-table-owns-route", route.ID, table.ID)
			add(route.ID+"_igw", "aws.ec2.route-targets-internet-gateway", route.ID, igw.ID)
		}
	}
	for _, pair := range [][2]string{{"alb", "arn"}, {"alb", "dnsName"}, {"alb", "hostedZoneId"}, {"target", "arn"}, {"listener", "arn"}} {
		n, _ := modelResource(m, pair[0])
		ref := reference(n)
		ref.Attribute = n.ServiceType + "." + pair[1]
		m.Outputs = append(m.Outputs, NormalizedOutput{ID: pair[0] + "_" + pair[1], Key: pair[0] + "_" + pair[1], Kind: "node-attribute", Resource: &ref})
	}
	sortModel(m)
	return m
}
func TestElbBothNativeTargets(t *testing.T) {
	for _, ecs := range []bool{false, true} {
		for _, public := range []bool{false, true} {
			for _, target := range []string{"terraform", "cloudformation"} {
				name := map[bool]string{false: "ec2", true: "fargate"}[ecs] + "-" + map[bool]string{false: "internal", true: "public"}[public]
				t.Run(name+"/"+target, func(t *testing.T) {
					m := elbModel(ecs, public)
					before := cloneNormalized(t, m)
					a, d := kmsArtifact(m, target)
					assertNoTargetErrors(t, d)
					if a == nil {
						t.Fatal("missing artifact")
					}
					if !reflect.DeepEqual(m, before) {
						t.Fatal("source mutation")
					}
					warnings := 0
					for _, x := range d {
						if x.Code == "ELB_READINESS_EXTERNAL" {
							warnings++
						}
					}
					if warnings != 4 {
						t.Fatalf("missing external readiness warnings: %d %v", warnings, d)
					}
					file, goldenName := "infrastructure/elb.tf", "elb.tf"
					if target == "cloudformation" {
						file, goldenName = cloudFormationTemplatePath, "template.json"
					}
					content := fileContent(t, a, file)
					if target == "terraform" {
						for _, f := range a.Files {
							if strings.HasSuffix(f.Path, ".tf") {
								if _, d := hclsyntax.ParseConfig([]byte(f.Content), f.Path, hcl.InitialPos); d.HasErrors() {
									t.Fatal(d.Error())
								}
							}
						}
						for _, part := range []string{"aws_lb", "aws_lb_target_group", "aws_lb_listener", "aws_acm_certificate_validation.certificate_validation.certificate_arn", "referenced_security_group_id", "aws_security_group.alb_group.id", "aws_security_group.group.id", "prevent_destroy", "traffic-port", "ELBSecurityPolicy-TLS13-1-2-2021-06"} {
							if !strings.Contains(content, part) {
								t.Fatalf("missing %s", part)
							}
						}
						compute := fileContent(t, a, "infrastructure/compute.tf")
						if ecs {
							for _, part := range []string{"load_balancer {", "container_name = \"Application\"", "container_port = 8080", "aws_lb_target_group.target.arn", "aws_lb_listener.listener", "health_check_grace_period_seconds = 30"} {
								if !strings.Contains(strings.Join(strings.Fields(compute), " "), part) {
									t.Fatalf("missing ECS binding %s", part)
								}
							}
							if strings.Contains(content, "aws_lb_target_group_attachment") {
								t.Fatal("static IP registration inferred")
							}
						} else if !strings.Contains(content, "aws_lb_target_group_attachment") || !strings.Contains(content, "aws_instance.instance.id") {
							t.Fatal("missing instance registration")
						}
						security := fileContent(t, a, "infrastructure/security.tf")
						parsed, diags := hclsyntax.ParseConfig([]byte(security), "security.tf", hcl.InitialPos)
						if diags.HasErrors() {
							t.Fatal(diags.Error())
						}
						for _, group := range parsed.Body.(*hclsyntax.Body).Blocks {
							if group.Type == "resource" && group.Labels[0] == "aws_security_group" && (group.Labels[1] == "alb_group" || group.Labels[1] == "group") {
								for _, key := range []string{"ingress", "egress"} {
									if _, inline := group.Body.Attributes[key]; inline {
										t.Fatal("inline security-group attributes conflict with standalone rule managers")
									}
								}
							}
						}
						if !strings.Contains(security, "aws_vpc_security_group_ingress_rule") || !strings.Contains(security, "cidr_ipv4") {
							t.Fatal("explicit client CIDR rule must remain standalone")
						}
					} else {
						var template cloudFormationTemplate
						if json.Unmarshal([]byte(content), &template) != nil {
							t.Fatal("invalid CF JSON")
						}
						h := &cloudFormationRenderer{model: m, logicalIDs: map[string]string{}, usedLogicalIDs: map[string]string{}}
						h.assignLogicalIDs()
						lb := template.Resources[h.logicalIDs["alb"]]
						if public && len(lb.DependsOn) < 3 {
							t.Fatal("missing public gateway attachment/route dependencies")
						}
						if lb.Type != "AWS::ElasticLoadBalancingV2::LoadBalancer" || lb.DeletionPolicy != "Retain" {
							t.Fatal("missing retained ALB")
						}
						group := template.Resources[h.logicalIDs["alb_group"]]
						if group.DeletionPolicy != "Retain" {
							t.Fatal("peer group must retain owned inline access")
						}
						if len(group.Properties["SecurityGroupEgress"].([]any)) != 1 {
							t.Fatal("missing exact inline peer egress")
						}
						tg := template.Resources[h.logicalIDs["target"]]
						if ecs {
							if _, ok := tg.Properties["Targets"]; ok {
								t.Fatal("static Fargate IP targets")
							}
							service := template.Resources[h.logicalIDs["service"]]
							if len(service.Properties["LoadBalancers"].([]any)) != 1 || !containsString(service.DependsOn, h.logicalIDs["listener"]) {
								t.Fatal("missing native ECS listener dependency")
							}
						} else if len(tg.Properties["Targets"].([]any)) != 1 {
							t.Fatal("missing instance target")
						}
					}
					golden := filepath.Join("testdata", "elb-goldens-v1", name, goldenName)
					if os.Getenv("CLOUDMARKUP_UPDATE_ELB_GOLDENS") == "1" {
						if err := os.MkdirAll(filepath.Dir(golden), 0700); err != nil {
							t.Fatal(err)
						}
						if err := os.WriteFile(golden, []byte(content), 0600); err != nil {
							t.Fatal(err)
						}
					}
					want, err := os.ReadFile(golden)
					if err != nil || string(want) != content {
						t.Fatal("ELB golden drift")
					}
					again, d := kmsArtifact(cloneNormalized(t, m), target)
					assertNoTargetErrors(t, d)
					if !reflect.DeepEqual(a, again) {
						t.Fatal("nondeterministic export")
					}
					if os.Getenv("CLOUDMARKUP_WRITE_ELB_FIXTURES") == "1" && target == "terraform" {
						architecture := decodeMap(t, architectureFromNormalized(t, m))
						architecture["workloadBehavior"].(map[string]any)["workloads"] = []any{}
						data, err := json.MarshalIndent(architecture, "", "  ")
						if err != nil {
							t.Fatal(err)
						}
						dir := filepath.Join("..", "..", "packages", "provider-aws", "fixtures", "elb-v1")
						if err := os.MkdirAll(dir, 0700); err != nil {
							t.Fatal(err)
						}
						if err := os.WriteFile(filepath.Join(dir, name+".json"), append(data, '\n'), 0600); err != nil {
							t.Fatal(err)
						}
					}
				})
			}
		}
	}
}
func TestElbImmutableCompilation(t *testing.T) {
	for _, ecs := range []bool{false, true} {
		for _, target := range []TargetKind{TargetTerraform, TargetCloudFormation} {
			m := elbModel(ecs, false)
			doc := decodeMap(t, architectureFromNormalized(t, m))
			doc["workloadBehavior"].(map[string]any)["workloads"] = []any{}
			input, err := json.Marshal(doc)
			if err != nil {
				t.Fatal(err)
			}
			request := CompileRequest{Request: Request{Architecture: input, Target: target}}
			first := Compile(context.Background(), request)
			if !first.Succeeded() {
				t.Fatal(first.Diagnostics)
			}
			if !reflect.DeepEqual(first, Compile(context.Background(), request)) {
				t.Fatal("immutable drift")
			}
		}
	}
}
func TestElbReviewedSchemasMatchCatalog(t *testing.T) {
	contents, err := os.ReadFile(filepath.Join("..", "..", "packages", "provider-aws", "src", "compiled", "catalog-v1.json"))
	if err != nil {
		t.Fatal(err)
	}
	var c struct {
		Services []struct {
			ID            string
			Configuration struct {
				JSONSchema struct{ Properties map[string]ecsField }
			}
		}
	}
	if json.Unmarshal(contents, &c) != nil {
		t.Fatal("invalid source")
	}
	count := 0
	for _, s := range c.Services {
		if expected, ok := elbSchemas[s.ID]; ok {
			count++
			if !reflect.DeepEqual(expected, s.Configuration.JSONSchema.Properties) {
				t.Fatal("ELB schema drift")
			}
		}
	}
	if count != 4 {
		t.Fatal("missing source/native contracts")
	}
}
