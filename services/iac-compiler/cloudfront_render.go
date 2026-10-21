package compiler

import (
	"crypto/sha256"
	"fmt"
	"github.com/hashicorp/hcl/v2/hclwrite"
	"github.com/zclconf/go-cty/cty"
)

func cloudfrontOacName(model *NormalizedSolution, n NormalizedResource) string {
	h := sha256.Sum256([]byte(model.Provenance.ArchitectureID + ":" + n.ID))
	return fmt.Sprintf("cm-%x", h[:12])
}
func (r *terraformRenderer) renderCloudfrontResource(n NormalizedResource) {
	if n.ServiceType == serviceCloudfrontAlias {
		return
	}
	block := r.resourceBlock(n)
	body := block.Body()
	dnsLifecycle(body, false)
	if n.ServiceType == serviceCloudfrontCache {
		body.SetAttributeValue("name", cty.StringVal(r.configString(n, "name")))
		body.SetAttributeValue("comment", cty.StringVal(r.configString(n, "comment")))
		for _, pair := range [][2]string{{"min_ttl", "minTtl"}, {"default_ttl", "defaultTtl"}, {"max_ttl", "maxTtl"}} {
			body.SetAttributeValue(pair[0], cty.NumberFloatVal(r.configNumber(n, pair[1])))
		}
		params := hclwrite.NewBlock("parameters_in_cache_key_and_forwarded_to_origin", nil)
		params.Body().SetAttributeValue("enable_accept_encoding_gzip", cty.BoolVal(true))
		params.Body().SetAttributeValue("enable_accept_encoding_brotli", cty.BoolVal(true))
		for _, pair := range [][2]string{{"cookies_config", "cookie_behavior"}, {"headers_config", "header_behavior"}, {"query_strings_config", "query_string_behavior"}} {
			child := hclwrite.NewBlock(pair[0], nil)
			child.Body().SetAttributeValue(pair[1], cty.StringVal("none"))
			params.Body().AppendBlock(child)
		}
		body.AppendBlock(params)
		appendBlock(r.file("cloudfront.tf"), block)
		r.cloudfrontWarnings(n)
		return
	}
	bucket, _ := r.connectedResource(n.ID, cloudfrontOrigin, false)
	cache, _ := r.connectedResource(n.ID, cloudfrontCache, false)
	name := r.resourceNames[n.ID]
	oac := hclwrite.NewBlock("resource", []string{"aws_cloudfront_origin_access_control", name + "_oac"})
	ob := oac.Body()
	ob.SetAttributeValue("name", cty.StringVal(cloudfrontOacName(r.model, n)))
	ob.SetAttributeValue("description", cty.StringVal("Graph-owned read-only private S3 origin"))
	ob.SetAttributeValue("origin_access_control_origin_type", cty.StringVal("s3"))
	ob.SetAttributeValue("signing_behavior", cty.StringVal("always"))
	ob.SetAttributeValue("signing_protocol", cty.StringVal("sigv4"))
	dnsLifecycle(ob, false)
	appendBlock(r.file("cloudfront.tf"), oac)
	body.SetAttributeValue("comment", cty.StringVal(r.configString(n, "comment")))
	body.SetAttributeValue("enabled", cty.BoolVal(r.configBool(n, "enabled")))
	body.SetAttributeValue("is_ipv6_enabled", cty.BoolVal(true))
	body.SetAttributeValue("http_version", cty.StringVal("http2"))
	body.SetAttributeValue("price_class", cty.StringVal(r.configString(n, "priceClass")))
	body.SetAttributeValue("default_root_object", cty.StringVal(r.configString(n, "defaultRootObject")))
	body.SetAttributeValue("retain_on_delete", cty.BoolVal(true))
	body.SetAttributeValue("wait_for_deployment", cty.BoolVal(true))
	body.SetAttributeTraversal("tags", traversal("local", "tags"))
	origin := hclwrite.NewBlock("origin", nil)
	origin.Body().SetAttributeTraversal("domain_name", traversal("aws_s3_bucket", r.resourceNames[bucket.ID], "bucket_regional_domain_name"))
	origin.Body().SetAttributeValue("origin_id", cty.StringVal("private-s3"))
	origin.Body().SetAttributeTraversal("origin_access_control_id", traversal("aws_cloudfront_origin_access_control", name+"_oac", "id"))
	body.AppendBlock(origin)
	behavior := hclwrite.NewBlock("default_cache_behavior", nil)
	bb := behavior.Body()
	bb.SetAttributeRaw("allowed_methods", stringTuple([]string{"GET", "HEAD"}))
	bb.SetAttributeRaw("cached_methods", stringTuple([]string{"GET", "HEAD"}))
	bb.SetAttributeValue("target_origin_id", cty.StringVal("private-s3"))
	bb.SetAttributeValue("viewer_protocol_policy", cty.StringVal("redirect-to-https"))
	bb.SetAttributeValue("compress", cty.BoolVal(true))
	bb.SetAttributeRaw("cache_policy_id", r.resourceAttributeTokens(cache.ID, "id"))
	body.AppendBlock(behavior)
	restrictions := hclwrite.NewBlock("restrictions", nil)
	geo := hclwrite.NewBlock("geo_restriction", nil)
	geo.Body().SetAttributeValue("restriction_type", cty.StringVal("none"))
	geo.Body().SetAttributeRaw("locations", hclwrite.TokensForTuple(nil))
	restrictions.Body().AppendBlock(geo)
	body.AppendBlock(restrictions)
	viewer := hclwrite.NewBlock("viewer_certificate", nil)
	aliases := r.relatedResources(n.ID, cloudfrontAlias, true)
	if len(aliases) == 0 {
		viewer.Body().SetAttributeValue("cloudfront_default_certificate", cty.BoolVal(true))
	} else {
		alias := aliases[0]
		cert, _ := r.connectedResource(alias.ID, cloudfrontCertificate, false)
		body.SetAttributeRaw("aliases", stringTuple([]string{r.configString(alias, "domainName")}))
		viewer.Body().SetAttributeRaw("acm_certificate_arn", r.resourceAttributeTokens(cert.ID, "arn"))
		viewer.Body().SetAttributeValue("ssl_support_method", cty.StringVal("sni-only"))
		viewer.Body().SetAttributeValue("minimum_protocol_version", cty.StringVal("TLSv1.2_2021"))
		zone, _ := r.connectedResource(cert.ID, dnsCertificateBinding, false)
		for _, kind := range []string{"A", "AAAA"} {
			record := hclwrite.NewBlock("resource", []string{"aws_route53_record", r.resourceNames[alias.ID] + "_" + kind})
			rb := record.Body()
			rb.SetAttributeRaw("zone_id", r.resourceAttributeTokens(zone.ID, "zoneId"))
			rb.SetAttributeValue("name", cty.StringVal(r.configString(alias, "domainName")))
			rb.SetAttributeValue("type", cty.StringVal(kind))
			rb.SetAttributeValue("allow_overwrite", cty.BoolVal(false))
			dnsLifecycle(rb, false)
			target := hclwrite.NewBlock("alias", nil)
			target.Body().SetAttributeRaw("name", r.resourceAttributeTokens(n.ID, "domainName"))
			target.Body().SetAttributeRaw("zone_id", r.resourceAttributeTokens(n.ID, "hostedZoneId"))
			target.Body().SetAttributeValue("evaluate_target_health", cty.BoolVal(false))
			rb.AppendBlock(target)
			appendBlock(r.file("cloudfront.tf"), record)
		}
	}
	body.AppendBlock(viewer)
	appendBlock(r.file("cloudfront.tf"), block)
	r.cloudfrontWarnings(n)
}
func stringTuple(v []string) hclwrite.Tokens {
	items := []hclwrite.Tokens{}
	for _, s := range v {
		items = append(items, hclwrite.TokensForValue(cty.StringVal(s)))
	}
	return hclwrite.TokensForTuple(items)
}
func (r *cloudFormationRenderer) renderCloudfrontResource(n NormalizedResource) {
	if n.ServiceType == serviceCloudfrontAlias {
		return
	}
	p := map[string]any{}
	resource := cloudFormationResource{Type: cloudFormationResourceTypeByService[n.ServiceType], Properties: p, Metadata: r.resourceMetadata(n), DeletionPolicy: "Retain", UpdateReplacePolicy: "Retain"}
	helper := &terraformRenderer{model: r.model}
	if n.ServiceType == serviceCloudfrontCache {
		p["CachePolicyConfig"] = map[string]any{"Name": r.configString(n, "name"), "Comment": r.configString(n, "comment"), "MinTTL": 0, "DefaultTTL": r.configNumber(n, "defaultTtl"), "MaxTTL": r.configNumber(n, "maxTtl"), "ParametersInCacheKeyAndForwardedToOrigin": map[string]any{"EnableAcceptEncodingGzip": true, "EnableAcceptEncodingBrotli": true, "CookiesConfig": map[string]any{"CookieBehavior": "none"}, "HeadersConfig": map[string]any{"HeaderBehavior": "none"}, "QueryStringsConfig": map[string]any{"QueryStringBehavior": "none"}}}
	} else {
		bucket, _ := helper.connectedResource(n.ID, cloudfrontOrigin, false)
		cache, _ := helper.connectedResource(n.ID, cloudfrontCache, false)
		oacID := r.logicalIDs[n.ID] + "Oac"
		r.addResource(oacID, cloudFormationResource{Type: "AWS::CloudFront::OriginAccessControl", Properties: map[string]any{"OriginAccessControlConfig": map[string]any{"Name": cloudfrontOacName(r.model, n), "Description": "Graph-owned read-only private S3 origin", "OriginAccessControlOriginType": "s3", "SigningBehavior": "always", "SigningProtocol": "sigv4"}}, Metadata: r.resourceMetadata(n), DeletionPolicy: "Retain", UpdateReplacePolicy: "Retain"}, SourceReference{Document: DocumentArchitecture, NodeID: n.ID})
		config := map[string]any{"Comment": r.configString(n, "comment"), "Enabled": r.configBool(n, "enabled"), "IPV6Enabled": true, "HttpVersion": "http2", "PriceClass": r.configString(n, "priceClass"), "DefaultRootObject": r.configString(n, "defaultRootObject"), "Origins": []any{map[string]any{"Id": "private-s3", "DomainName": cloudFormationGetAtt(r.logicalIDs[bucket.ID], "RegionalDomainName"), "OriginAccessControlId": cloudFormationRef(oacID), "S3OriginConfig": map[string]any{"OriginAccessIdentity": ""}}}, "DefaultCacheBehavior": map[string]any{"TargetOriginId": "private-s3", "ViewerProtocolPolicy": "redirect-to-https", "AllowedMethods": []any{"GET", "HEAD"}, "CachedMethods": []any{"GET", "HEAD"}, "Compress": true, "CachePolicyId": r.resourceAttribute(cache.ID, "id")}, "Restrictions": map[string]any{"GeoRestriction": map[string]any{"RestrictionType": "none"}}, "ViewerCertificate": map[string]any{"CloudFrontDefaultCertificate": true}}
		p["DistributionConfig"] = config
		p["Tags"] = r.tagList()
		aliases := helper.relatedResources(n.ID, cloudfrontAlias, true)
		if len(aliases) == 1 {
			alias := aliases[0]
			cert, _ := helper.connectedResource(alias.ID, cloudfrontCertificate, false)
			zone, _ := helper.connectedResource(cert.ID, dnsCertificateBinding, false)
			config["Aliases"] = []any{r.configString(alias, "domainName")}
			config["ViewerCertificate"] = map[string]any{"AcmCertificateArn": r.resourceAttribute(cert.ID, "arn"), "SslSupportMethod": "sni-only", "MinimumProtocolVersion": "TLSv1.2_2021"}
			for _, kind := range []string{"A", "AAAA"} {
				r.addResource(r.logicalIDs[alias.ID]+kind, cloudFormationResource{Type: "AWS::Route53::RecordSet", Properties: map[string]any{"HostedZoneId": r.resourceAttribute(zone.ID, "zoneId"), "Name": r.configString(alias, "domainName"), "Type": kind, "AliasTarget": map[string]any{"DNSName": r.resourceAttribute(n.ID, "domainName"), "HostedZoneId": "Z2FDTNDATAQYW2", "EvaluateTargetHealth": false}}, Metadata: r.resourceMetadata(alias), DeletionPolicy: "Retain", UpdateReplacePolicy: "Retain"}, SourceReference{Document: DocumentArchitecture, NodeID: alias.ID})
			}
		}
	}
	r.addResource(r.logicalIDs[n.ID], resource, SourceReference{Document: DocumentArchitecture, NodeID: n.ID})
	r.warning("CLOUDFRONT_READINESS_EXTERNAL", cloudfrontReadinessMessage, SourceReference{Document: DocumentArchitecture, NodeID: n.ID})
}
