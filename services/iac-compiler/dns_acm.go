package compiler

import (
	_ "embed"
	"encoding/json"
	"strings"
)

const servicePublicZone = "aws.route53.public-hosted-zone"
const servicePublicCertificate = "aws.acm.public-dns-certificate"
const dnsCertificateBinding = "aws.acm.certificate-validates-in-zone"

var dnsContracts = map[string]ecsBinding{dnsCertificateBinding: {servicePublicCertificate, "validation-zone", servicePublicZone, "certificate", 1, 128}}

//go:embed internal/contracts/dns-acm-configuration-v1.json
var dnsConfigurationJSON []byte
var dnsSchemas = func() map[string]map[string]ecsField {
	var fields map[string]map[string]ecsField
	if json.Unmarshal(dnsConfigurationJSON, &fields) != nil {
		panic("invalid reviewed DNS/ACM schema")
	}
	return fields
}()

func init() {
	terraformResourceTypeByService[servicePublicZone] = "aws_route53_zone"
	terraformResourceTypeByService[servicePublicCertificate] = "aws_acm_certificate"
	cloudFormationResourceTypeByService[servicePublicZone] = "AWS::Route53::HostedZone"
	cloudFormationResourceTypeByService[servicePublicCertificate] = "AWS::CertificateManager::Certificate"
	networkingRelationshipContracts[dnsCertificateBinding] = networkContract(servicePublicCertificate, servicePublicCertificate+".validation-zone", servicePublicZone, servicePublicZone+".certificate", 1, 128)
	terraformRelationshipSupport[dnsCertificateBinding] = struct{}{}
}
func dnsCovers(domain, zone string) bool {
	return domain == zone || strings.HasSuffix(domain, "."+zone)
}
func dnsBindingOwnership(e NormalizedConnection) bool {
	l := e.Lifecycle
	if l.Ownership == "user" {
		return l.Origin == "user" || l.Origin == "template" || l.Origin == "ai-accepted" || l.Origin == "migration"
	}
	p := l.Provenance
	return l.Ownership == "generated" && l.Origin == "connection-rule" && p != nil && p.GeneratorKind == "connection-rule" && p.GeneratorID == dnsCertificateBinding && p.GeneratorVersion == "1.0.0" && p.OperationID != "" && len(p.DependentNodeIDs) == 2 && containsString(p.DependentNodeIDs, e.Source.NodeID) && containsString(p.DependentNodeIDs, e.Target.NodeID) && len(p.DependentEdgeIDs) == 0
}
func (r *terraformRenderer) validateDnsModel() {
	reject := func(n NormalizedResource, code, message string) {
		r.error("TARGET_DNS_"+code, message, SourceReference{Document: DocumentArchitecture, NodeID: n.ID})
	}
	names := map[string]bool{}
	for _, n := range r.model.Resources {
		if _, ok := dnsSchemas[n.ServiceType]; !ok {
			continue
		}
		if !isCurrentAwsCatalog(r.model.Provenance.Catalog) {
			reject(n, "CATALOG_UNSUPPORTED", "DNS/ACM requires the exact reviewed catalog successor.")
			continue
		}
		if n.Parent != nil || n.ResourceType != n.ServiceType || !rdsUser(n) {
			reject(n, "OWNERSHIP_INVALID", "Require exact user-owned root new public zones/certificates; private/generated/adopted/imported ownership is unsupported.")
		}
		for _, external := range r.model.ExternalResources {
			for _, ref := range external.ArchitectureNodes {
				if ref.NodeID == n.ID {
					reject(n, "EXTERNAL_UNSUPPORTED", "External zone/account/certificate authority needs a separately reviewed contract.")
				}
			}
		}
		if !r.validateDnsFields(n) {
			continue
		}
		domain := r.configString(n, "domainName")
		identity := n.ServiceType + ":" + domain
		if names[identity] {
			reject(n, "DUPLICATE_DOMAIN", "Use one exact native zone/certificate domain identity; validation-record ownership cannot overlap.")
		}
		names[identity] = true
		if n.ServiceType == servicePublicCertificate {
			zones := r.relatedResources(n.ID, dnsCertificateBinding, false)
			valid := len(zones) == 1
			for _, edge := range r.model.Connections {
				if edge.RelationshipType == dnsCertificateBinding && edge.Source.NodeID == n.ID && !dnsBindingOwnership(edge) {
					valid = false
				}
			}
			if valid {
				zone := zones[0]
				name := r.configString(zone, "domainName")
				valid = zone.ServiceType == servicePublicZone && rdsUser(zone) && zone.Parent == nil && zone.ResourceType == servicePublicZone && r.validateDnsFields(zone) && dnsCovers(domain, name)
				for _, other := range r.model.Resources {
					if other.ServiceType == servicePublicZone && other.ID != zone.ID {
						otherName := r.configString(other, "domainName")
						if len(otherName) > len(name) && dnsCovers(domain, otherName) {
							valid = false
						}
					}
				}
			}
			if !valid {
				reject(n, "ZONE_AUTHORITY_INVALID", "Bind exactly one caller-attested public zone containing the domain, using the most-specific modeled zone. Registrar/parent delegation remains external.")
			}
			region := r.configString(n, "certificateRegion")
			if region != r.model.Provenance.Region || r.configString(n, "intendedUse") == "cloudfront-viewer" && region != "us-east-1" {
				reject(n, "REGION_INVALID", "Certificate Region must match this graph; CloudFront viewer intent requires us-east-1. Cross-region/provider/stack orchestration is unsupported.")
			}
		}
	}
}
func (r *terraformRenderer) dnsWarnings(n NormalizedResource) {
	r.warning("DNS_CERTIFICATE_READINESS_EXTERNAL", "Domain control is caller-attested. Verify registrar/parent NS delegation, public DNS/CAA/issuer eligibility, existing validation records, deployer authority and exact deployment Region externally. Terraform models a retained CNAME plus validation waiter; CloudFormation uses inline managed validation and must be deployed in the declared Region. Validation may stay pending. No DNS changes, certificate issuance/renewal, consumer TLS or runtime health are verified; protected retained zone/certificate/CNAME cleanup stays external.", SourceReference{Document: DocumentArchitecture, NodeID: n.ID})
}
