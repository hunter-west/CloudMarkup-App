package compiler

import (
	_ "embed"
	"encoding/json"
	"net/netip"
	"strings"
)

const serviceAlb = "aws.elb.application-load-balancer"
const serviceAlbTarget = "aws.elb.target-group"
const serviceAlbListener = "aws.elb.https-listener"
const serviceAlbAccess = "aws.elb.backend-access-configuration"
const albVpc = "aws.elb.alb-uses-vpc"
const albSubnet = "aws.elb.alb-uses-subnet"
const albGroup = "aws.elb.alb-uses-security-group"
const albListener = "aws.elb.alb-owns-listener"
const albForward = "aws.elb.listener-forwards-to-target-group"
const albCertificate = "aws.elb.listener-uses-certificate"
const albTargetVpc = "aws.elb.target-group-uses-vpc"
const albEc2 = "aws.elb.target-group-targets-ec2"
const albEcs = "aws.elb.target-group-targets-ecs"
const albAccess = "aws.elb.target-group-owns-backend-access"
const albAccessSource = "aws.elb.backend-access-uses-alb-group"
const albAccessTarget = "aws.elb.backend-access-uses-target-group"

//go:embed internal/contracts/elb-configuration-v1.json
var elbConfigurationJSON []byte
var elbSchemas = func() map[string]map[string]ecsField {
	var s map[string]map[string]ecsField
	if json.Unmarshal(elbConfigurationJSON, &s) != nil {
		panic("invalid reviewed ELB schema")
	}
	return s
}()
var elbContracts = map[string]ecsBinding{
	albVpc: {serviceAlb, "vpc", serviceVPC, "alb", 1, 128}, albSubnet: {serviceAlb, "subnet", serviceSubnet, "alb", 16, 128}, albGroup: {serviceAlb, "security-group", serviceSecurityGroup, "alb", 1, 128}, albListener: {serviceAlbListener, "alb", serviceAlb, "listener", 1, 1}, albForward: {serviceAlbListener, "target-group", serviceAlbTarget, "listener", 1, 1}, albCertificate: {serviceAlbListener, "certificate", servicePublicCertificate, "alb-listener", 1, 128}, albTargetVpc: {serviceAlbTarget, "vpc", serviceVPC, "alb-target-group", 1, 128}, albEc2: {serviceAlbTarget, "ec2-backend", serviceEc2Instance, "alb-target", 1, 1}, albEcs: {serviceAlbTarget, "ecs-backend", serviceEcsService, "alb-target", 1, 1}, albAccess: {serviceAlbAccess, "target-group", serviceAlbTarget, "backend-access", 1, 1}, albAccessSource: {serviceAlbAccess, "alb-group", serviceSecurityGroup, "alb-access-source", 1, 128}, albAccessTarget: {serviceAlbAccess, "backend-group", serviceSecurityGroup, "alb-access-target", 1, 128},
}

func init() {
	for s, tf := range map[string]string{serviceAlb: "aws_lb", serviceAlbTarget: "aws_lb_target_group", serviceAlbListener: "aws_lb_listener"} {
		terraformResourceTypeByService[s] = tf
	}
	for s, cf := range map[string]string{serviceAlb: "AWS::ElasticLoadBalancingV2::LoadBalancer", serviceAlbTarget: "AWS::ElasticLoadBalancingV2::TargetGroup", serviceAlbListener: "AWS::ElasticLoadBalancingV2::Listener"} {
		cloudFormationResourceTypeByService[s] = cf
	}
	terraformInternalService[serviceAlbAccess] = struct{}{}
	cloudFormationInternalService[serviceAlbAccess] = struct{}{}
	for rel, b := range elbContracts {
		networkingRelationshipContracts[rel] = networkContract(b.source, b.source+"."+b.sourcePort, b.target, b.target+"."+b.targetPort, b.sourceMax, b.targetMax)
		terraformRelationshipSupport[rel] = struct{}{}
	}
}
func (r *terraformRenderer) elbSafe(n NormalizedResource) bool {
	return n.ID != "" && rdsUser(n) && n.ServiceType == n.ResourceType && !cloudfrontExternalResource(r.model, n.ID)
}
func (r *terraformRenderer) elbOne(n NormalizedResource, rel string, in bool) NormalizedResource {
	xs := r.relatedResources(n.ID, rel, in)
	if len(xs) == 1 {
		return xs[0]
	}
	return NormalizedResource{}
}
func (r *terraformRenderer) elbParent(n NormalizedResource, s, rel string, in bool) NormalizedResource {
	p, ok := r.resourceByID(func() string {
		if n.Parent != nil {
			return n.Parent.NodeID
		}
		return ""
	}())
	if !ok || !r.elbSafe(p) || p.ServiceType != s || n.Parent.RelationshipType != rel || r.elbOne(n, rel, in).ID != p.ID {
		return NormalizedResource{}
	}
	return p
}
func (r *terraformRenderer) elbZone(n NormalizedResource) NormalizedResource {
	return r.elbParent(n, serviceAvailabilityZone, "aws.ec2.availability-zone-contains-subnet", true)
}
func (r *terraformRenderer) elbVpc(n NormalizedResource) NormalizedResource {
	if n.ServiceType == serviceVPC && r.elbSafe(n) {
		return n
	}
	if n.ServiceType == serviceSecurityGroup {
		return r.elbOne(n, "aws.ec2.vpc-associates-security-group", true)
	}
	az := r.elbZone(n)
	return r.elbParent(az, serviceVPC, "aws.ec2.vpc-contains-availability-zone", true)
}
func (r *terraformRenderer) elbIngress(n NormalizedResource) []NormalizedResource {
	xs := []NormalizedResource{}
	for _, x := range r.relatedResources(n.ID, "aws.ec2.security-group-owns-ingress-rule", true) {
		if r.elbSafe(x) && x.Parent != nil && x.Parent.NodeID == n.ID && x.Parent.RelationshipType == "aws.ec2.security-group-owns-ingress-rule" {
			xs = append(xs, x)
		}
	}
	return xs
}
func (r *terraformRenderer) elbSourceAccess(groupID string) (NormalizedResource, bool) {
	if !isCurrentAwsCatalog(r.model.Provenance.Catalog) {
		return NormalizedResource{}, false
	}
	for _, n := range r.model.Resources {
		if n.ServiceType == serviceAlbAccess && r.elbOne(n, albAccessSource, false).ID == groupID {
			return n, true
		}
	}
	return NormalizedResource{}, false
}
func (r *terraformRenderer) elbPeerGroup(id string) bool {
	if !isCurrentAwsCatalog(r.model.Provenance.Catalog) {
		return false
	}
	for _, e := range r.model.Connections {
		if (e.RelationshipType == albAccessSource || e.RelationshipType == albAccessTarget) && e.Target.NodeID == id {
			return true
		}
	}
	return false
}
func (r *terraformRenderer) elbServiceTarget(serviceID string) (NormalizedResource, NormalizedResource, bool) {
	if !isCurrentAwsCatalog(r.model.Provenance.Catalog) {
		return NormalizedResource{}, NormalizedResource{}, false
	}
	s, ok := r.resourceByID(serviceID)
	if !ok {
		return NormalizedResource{}, NormalizedResource{}, false
	}
	tg := r.elbOne(s, albEcs, true)
	listener := r.elbOne(tg, albForward, true)
	return tg, listener, tg.ID != "" && listener.ID != ""
}

// A group-scoped peer grant applies to every associated workload. Inspect all
// incident edges, not just other access owners, before either native export.
func (r *terraformRenderer) elbDedicatedGroup(group, consumer, vpc, access NormalizedResource, consumerRelationship, accessRelationship string) bool {
	for _, e := range r.model.Connections {
		if e.Source.NodeID == group.ID {
			return false
		}
		if e.Target.NodeID != group.ID {
			continue
		}
		switch e.RelationshipType {
		case consumerRelationship:
			if consumer.ID == "" || e.Source.NodeID != consumer.ID {
				return false
			}
		case accessRelationship:
			if e.Source.NodeID != access.ID {
				return false
			}
		case "aws.ec2.vpc-associates-security-group":
			if vpc.ID == "" || e.Source.NodeID != vpc.ID {
				return false
			}
		case "aws.ec2.security-group-owns-ingress-rule", "aws.ec2.security-group-owns-egress-rule":
			rule, ok := r.resourceByID(e.Source.NodeID)
			if !ok || !r.elbSafe(rule) || rule.Parent == nil || rule.Parent.NodeID != group.ID || rule.Parent.RelationshipType != e.RelationshipType {
				return false
			}
		default:
			return false
		}
	}
	return true
}

func (r *terraformRenderer) validateElbModel() {
	found := false
	for _, n := range r.model.Resources {
		if _, ok := elbSchemas[n.ServiceType]; ok {
			found = true
		}
	}
	if !found {
		return
	}
	reject := func(n NormalizedResource, code, message string) {
		r.error("TARGET_ELB_"+code, message, SourceReference{Document: DocumentArchitecture, NodeID: n.ID})
	}
	for _, e := range r.model.Connections {
		if b, ok := elbContracts[e.RelationshipType]; ok {
			p := e.Lifecycle.Provenance
			user := e.Lifecycle.Ownership == "user" && (e.Lifecycle.Origin == "user" || e.Lifecycle.Origin == "template" || e.Lifecycle.Origin == "ai-accepted" || e.Lifecycle.Origin == "migration")
			generated := e.Lifecycle.Ownership == "generated" && e.Lifecycle.Origin == "connection-rule" && p != nil && p.GeneratorKind == "connection-rule" && p.GeneratorID == e.RelationshipType && p.GeneratorVersion == "1.0.0" && p.OperationID != "" && len(p.DependentNodeIDs) == 2 && containsString(p.DependentNodeIDs, e.Source.NodeID) && containsString(p.DependentNodeIDs, e.Target.NodeID) && len(p.DependentEdgeIDs) == 0
			s, sok := r.resourceByID(e.Source.NodeID)
			t, tok := r.resourceByID(e.Target.NodeID)
			if !user && !generated || !sok || !tok || s.ServiceType != b.source || s.ResourceType != b.source || t.ServiceType != b.target || t.ResourceType != b.target || e.Source.Port != b.source+"."+b.sourcePort || e.Target.Port != b.target+"."+b.targetPort || e.Configuration.SchemaID != e.RelationshipType+".connection" || e.Configuration.SchemaVersion != "1.0.0" || len(e.Configuration.Values) != 0 {
				r.error("TARGET_ELB_BINDING_INVALID", "Require exact endpoint types/ports, closed schema and authorized binding provenance.", SourceReference{Document: DocumentArchitecture, EdgeID: e.ID})
			}
		}
	}
	// All transitive network dependencies used by this profile must remain modeled,
	// exact and user-owned. Existing network validators check configuration/edges.
	for _, n := range r.model.Resources {
		if isNetworkingService(n.ServiceType) || n.ServiceType == serviceRegionBoundary {
			if !r.elbSafe(n) {
				reject(n, "NETWORK_OWNERSHIP_INVALID", "ELB networking must be exact user-owned resources; no external/adopted network dependency.")
			}
		}
	}
	for _, n := range r.model.Resources {
		if _, ok := elbSchemas[n.ServiceType]; !ok {
			continue
		}
		if !isCurrentAwsCatalog(r.model.Provenance.Catalog) {
			reject(n, "CATALOG_UNSUPPORTED", "Use the exact reviewed ELB successor catalog.")
			continue
		}
		if !r.elbSafe(n) {
			reject(n, "OWNERSHIP_INVALID", "Require exact user-owned ELB resources/configurations; external/adopted/generated ownership is unsupported.")
		}
		if !cloudfrontCommercialRegion(r.model.Provenance.Region) {
			reject(n, "PARTITION_UNSUPPORTED", "Use a commercial AWS Region.")
		}
		if !r.validateElbFields(n) {
			continue
		}
		if n.ServiceType == serviceAlb || n.ServiceType == serviceAlbTarget {
			if n.Parent != nil {
				reject(n, "PLACEMENT_INVALID", "ALB and target-group resources are roots.")
			}
			if strings.HasPrefix(r.configString(n, "name"), "internal-") {
				reject(n, "NAME_INVALID", "Native names cannot start with internal-.")
			}
			for _, o := range r.model.Resources {
				if o.ID != n.ID && o.ServiceType == n.ServiceType && r.configString(o, "name") == r.configString(n, "name") {
					reject(n, "NAME_DUPLICATE", "Names must be unique per modeled native type and Region.")
				}
			}
		}
		switch n.ServiceType {
		case serviceAlb:
			v := r.elbOne(n, albVpc, false)
			g := r.elbOne(n, albGroup, false)
			subs := r.relatedResources(n.ID, albSubnet, false)
			zones := map[string]bool{}
			valid := r.elbSafe(v) && r.elbSafe(g) && r.elbVpc(g).ID == v.ID && len(subs) >= 2 && len(subs) <= 16
			for _, s := range subs {
				z := r.elbZone(s)
				cidr, err := netip.ParsePrefix(r.configString(s, "cidrBlock"))
				if !r.elbSafe(s) || z.ID == "" || zones[r.configString(z, "zoneName")] || r.elbVpc(s).ID != v.ID || err != nil || !cidr.Addr().Is4() || cidr.Bits() > 27 || cidr.Masked() != cidr {
					valid = false
				}
				zones[r.configString(z, "zoneName")] = true
				if r.configString(n, "scheme") == "internet-facing" && !r.subnetHasInternetGatewayDefault(s, v.ID) {
					reject(n, "PUBLIC_ROUTE_INVALID", "Every internet-facing subnet requires its exact public internet-gateway default route.")
				}
			}
			if !valid {
				reject(n, "NETWORK_INVALID", "Use one VPC/group and 2-16 same-VPC subnets, one per distinct AZ, at least /27.")
			}
			ingress := false
			for _, x := range r.elbIngress(g) {
				if r.configString(x, "protocol") == "tcp" && r.configInt(x, "fromPort") == 443 && r.configInt(x, "toPort") == 443 {
					ingress = true
				}
			}
			if !ingress {
				reject(n, "VIEWER_INGRESS_MISSING", "Explicitly own TCP/443 client CIDR ingress on the exact ALB group.")
			}
			if len(r.relatedResources(g.ID, "aws.ec2.security-group-owns-egress-rule", true)) > 0 {
				reject(n, "EGRESS_UNSUPPORTED", "The dedicated ALB group uses only its exact owned backend peer egress; CIDR egress merges are unsupported.")
			}
			l := r.elbOne(n, albListener, true)
			if l.ID == "" || r.elbParent(l, serviceAlb, albListener, false).ID != n.ID {
				reject(n, "LISTENER_INVALID", "Require one canonical owned HTTPS listener and matching owner edge.")
			}
		case serviceAlbListener:
			a := r.elbParent(n, serviceAlb, albListener, false)
			tg := r.elbOne(n, albForward, false)
			cert := r.elbOne(n, albCertificate, false)
			if a.ID == "" || !r.elbSafe(tg) || len(r.relatedResources(tg.ID, albForward, true)) != 1 {
				reject(n, "LISTENER_OWNER_INVALID", "Bind the canonical listener to one ALB and one dedicated target group.")
			}
			if !r.elbSafe(cert) || r.configString(cert, "intendedUse") != "regional" || r.configString(cert, "certificateRegion") != r.model.Provenance.Region || r.configString(cert, "domainName") != r.configString(n, "serverName") {
				reject(n, "CERTIFICATE_INVALID", "Use the exact primary name of a regional public DNS ACM certificate in the graph Region.")
			}
		case serviceAlbTarget:
			l := r.elbOne(n, albForward, true)
			a := r.elbOne(l, albListener, false)
			v := r.elbOne(n, albTargetVpc, false)
			ag := r.elbOne(a, albGroup, false)
			subs := r.relatedResources(a.ID, albSubnet, false)
			ec2 := r.relatedResources(n.ID, albEc2, false)
			ecs := r.relatedResources(n.ID, albEcs, false)
			rel := albEc2
			backend := NormalizedResource{}
			if r.configString(n, "backendMode") == "ec2-instance" {
				if len(ec2) == 1 {
					backend = ec2[0]
				}
			} else {
				rel = albEcs
				if len(ecs) == 1 {
					backend = ecs[0]
				}
			}
			if !r.elbSafe(a) || !r.elbSafe(v) || r.elbOne(a, albVpc, false).ID != v.ID || len(ec2)+len(ecs) != 1 || !r.elbSafe(backend) || len(r.relatedResources(backend.ID, rel, true)) != 1 {
				reject(n, "BACKEND_INVALID", "Use one dedicated private EC2 or Fargate backend and the exact ALB/target VPC.")
			}
			sr, gr := ec2SubnetRelationship, ec2GroupRelationship
			if rel == albEcs {
				sr, gr = ecsSubnetBinding, ecsGroupBinding
			}
			bs := r.relatedResources(backend.ID, sr, false)
			bg := r.elbOne(backend, gr, false)
			valid := len(bs) > 0 && r.elbSafe(bg) && r.elbVpc(bg).ID == v.ID && bg.ID != ag.ID
			for _, s := range bs {
				enabled := false
				for _, as := range subs {
					if r.elbZone(s).ID != "" && r.elbZone(s).ID == r.elbZone(as).ID {
						enabled = true
					}
				}
				if !r.elbSafe(s) || r.elbVpc(s).ID != v.ID || r.configString(s, "accessTier") != "private" || !enabled {
					valid = false
				}
			}
			if !valid {
				reject(n, "BACKEND_NETWORK_INVALID", "Use private backend subnets in this VPC and ALB-enabled AZs with one distinct dedicated group.")
			}
			if rel == albEc2 && r.configInt(n, "startupGraceSeconds") != 0 {
				reject(n, "EC2_GRACE_INVALID", "EC2 startup grace must be zero.")
			}
			if rel == albEcs {
				task := r.elbOne(backend, ecsTaskBinding, true)
				container := r.elbOne(task, ecsContainerOwner, true)
				if !r.elbSafe(container) || r.configInt(container, "containerPort") != r.configInt(n, "port") {
					reject(n, "ECS_PORT_INVALID", "Target port must equal the exact essential container port of this Fargate service.")
				}
			}
			access := r.elbOne(n, albAccess, true)
			if !r.elbSafe(access) || r.elbParent(access, serviceAlbTarget, albAccess, false).ID != n.ID || r.elbOne(access, albAccessSource, false).ID != ag.ID || r.elbOne(access, albAccessTarget, false).ID != bg.ID {
				reject(n, "BACKEND_ACCESS_INVALID", "Canonical owned access must bind the exact selected ALB/backend groups.")
			}
			for _, x := range r.elbIngress(bg) {
				protocol := r.configString(x, "protocol")
				p := r.configInt(n, "port")
				if protocol == "-1" || protocol == "tcp" && r.configInt(x, "fromPort") <= p && r.configInt(x, "toPort") >= p {
					reject(n, "BACKEND_BYPASS_UNSUPPORTED", "CIDR ingress cannot bypass the exact source-group path on this backend port.")
				}
			}
			if ag.ID != "" && !r.elbDedicatedGroup(ag, a, v, access, albGroup, albAccessSource) || bg.ID != "" && !r.elbDedicatedGroup(bg, backend, v, access, gr, albAccessTarget) {
				reject(n, "SHARED_ACCESS_UNSUPPORTED", "Peer groups must bind only the selected ALB/backend and exact access owner, canonical VPC and owned rules; unrelated consumers or unsupported group bindings would broaden the peer grant.")
			}
		case serviceAlbAccess:
			if r.elbParent(n, serviceAlbTarget, albAccess, false).ID == "" {
				reject(n, "ACCESS_OWNER_INVALID", "Canonical target-group parent and owner edge must agree.")
			}
		}
	}
}
func (r *terraformRenderer) elbWarnings(n NormalizedResource) {
	r.warning("ELB_READINESS_EXTERNAL", "Verify quotas, Region/AZ availability, free subnet IPs, routes/NACLs, deployer/service-linked-role authority, external hostname mapping, certificate issuance/renewal, HTTP backend health and retained-resource cleanup externally. Viewer TLS terminates at ALB; backend HTTP is unencrypted. No provisioning or live health is proven.", SourceReference{Document: DocumentArchitecture, NodeID: n.ID})
}
