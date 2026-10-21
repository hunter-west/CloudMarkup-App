package compiler

import (
	"github.com/hashicorp/hcl/v2/hclsyntax"
	"github.com/hashicorp/hcl/v2/hclwrite"
	"github.com/zclconf/go-cty/cty"
)

func dnsLifecycle(body *hclwrite.Body, certificate bool) {
	life := hclwrite.NewBlock("lifecycle", nil)
	life.Body().SetAttributeValue("prevent_destroy", cty.BoolVal(true))
	if certificate {
		life.Body().SetAttributeValue("create_before_destroy", cty.BoolVal(true))
	}
	body.AppendBlock(life)
}
func (r *terraformRenderer) dnsValidationOption(n NormalizedResource, field string) hclwrite.Tokens {
	tokens := hclwrite.TokensForFunctionCall("one", hclwrite.TokensForTraversal(traversal("aws_acm_certificate", r.resourceNames[n.ID], "domain_validation_options")))
	return append(tokens, &hclwrite.Token{Type: hclsyntax.TokenDot, Bytes: []byte(".")}, &hclwrite.Token{Type: hclsyntax.TokenIdent, Bytes: []byte(field)})
}
func (r *terraformRenderer) renderDnsResource(n NormalizedResource) {
	block := r.resourceBlock(n)
	body := block.Body()
	body.SetAttributeTraversal("tags", traversal("local", "tags"))
	if n.ServiceType == servicePublicZone {
		body.SetAttributeValue("name", cty.StringVal(r.configString(n, "domainName")))
		body.SetAttributeValue("comment", cty.StringVal(r.configString(n, "comment")))
		body.SetAttributeValue("force_destroy", cty.BoolVal(false))
		dnsLifecycle(body, false)
		appendBlock(r.file("dns.tf"), block)
		r.dnsWarnings(n)
		return
	}
	body.SetAttributeValue("domain_name", cty.StringVal(r.configString(n, "domainName")))
	body.SetAttributeValue("region", cty.StringVal(r.configString(n, "certificateRegion")))
	body.SetAttributeValue("validation_method", cty.StringVal("DNS"))
	body.SetAttributeValue("key_algorithm", cty.StringVal("RSA_2048"))
	options := hclwrite.NewBlock("options", nil)
	options.Body().SetAttributeValue("certificate_transparency_logging_preference", cty.StringVal("ENABLED"))
	options.Body().SetAttributeValue("export", cty.StringVal("DISABLED"))
	body.AppendBlock(options)
	dnsLifecycle(body, true)
	appendBlock(r.file("dns.tf"), block)
	zone, _ := r.connectedResource(n.ID, dnsCertificateBinding, false)
	name := r.resourceNames[n.ID]
	record := hclwrite.NewBlock("resource", []string{"aws_route53_record", name + "_dns_validation"})
	rb := record.Body()
	rb.SetAttributeRaw("zone_id", r.resourceAttributeTokens(zone.ID, "zoneId"))
	rb.SetAttributeRaw("name", r.dnsValidationOption(n, "resource_record_name"))
	rb.SetAttributeRaw("type", r.dnsValidationOption(n, "resource_record_type"))
	rb.SetAttributeRaw("records", tupleTokens(r.dnsValidationOption(n, "resource_record_value")))
	rb.SetAttributeValue("ttl", cty.NumberIntVal(60))
	rb.SetAttributeValue("allow_overwrite", cty.BoolVal(false))
	dnsLifecycle(rb, false)
	appendBlock(r.file("dns.tf"), record)
	waiter := hclwrite.NewBlock("resource", []string{"aws_acm_certificate_validation", name + "_validation"})
	wb := waiter.Body()
	wb.SetAttributeValue("region", cty.StringVal(r.configString(n, "certificateRegion")))
	wb.SetAttributeTraversal("certificate_arn", traversal("aws_acm_certificate", name, "arn"))
	wb.SetAttributeRaw("validation_record_fqdns", tupleTokens(hclwrite.TokensForTraversal(traversal("aws_route53_record", name+"_dns_validation", "fqdn"))))
	appendBlock(r.file("dns.tf"), waiter)
	r.dnsWarnings(n)
}
func (r *cloudFormationRenderer) renderDnsResource(n NormalizedResource) {
	props := map[string]any{}
	resource := cloudFormationResource{Type: cloudFormationResourceTypeByService[n.ServiceType], Properties: props, Metadata: r.resourceMetadata(n), DeletionPolicy: "Retain", UpdateReplacePolicy: "Retain"}
	if n.ServiceType == servicePublicZone {
		props["Name"] = r.configString(n, "domainName")
		props["HostedZoneConfig"] = map[string]any{"Comment": r.configString(n, "comment")}
		props["HostedZoneTags"] = r.tagList()
	} else {
		helper := &terraformRenderer{model: r.model}
		zone, _ := helper.connectedResource(n.ID, dnsCertificateBinding, false)
		domain := r.configString(n, "domainName")
		props["DomainName"] = domain
		props["ValidationMethod"] = "DNS"
		props["KeyAlgorithm"] = "RSA_2048"
		props["CertificateExport"] = "DISABLED"
		props["CertificateTransparencyLoggingPreference"] = "ENABLED"
		props["DomainValidationOptions"] = []any{map[string]any{"DomainName": domain, "HostedZoneId": r.resourceAttribute(zone.ID, "zoneId")}}
		props["Tags"] = r.tagList()
	}
	r.addResource(r.logicalIDs[n.ID], resource, SourceReference{Document: DocumentArchitecture, NodeID: n.ID})
	helper := &terraformRenderer{model: r.model}
	helper.dnsWarnings(n)
	r.diagnostics = append(r.diagnostics, helper.diagnostics...)
}
