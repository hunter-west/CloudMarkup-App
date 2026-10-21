package compiler

import (
	_ "embed"
	"encoding/json"
	"strings"
)

const serviceCloudfrontDistribution = "aws.cloudfront.distribution"
const serviceCloudfrontCache = "aws.cloudfront.cache-policy"
const serviceCloudfrontAlias = "aws.cloudfront.alias-configuration"
const cloudfrontOrigin = "aws.cloudfront.reads-s3-origin"
const cloudfrontCache = "aws.cloudfront.uses-cache-policy"
const cloudfrontAlias = "aws.cloudfront.distribution-owns-alias"
const cloudfrontCertificate = "aws.cloudfront.alias-uses-certificate"

func cloudfrontExternalResource(model *NormalizedSolution, id string) bool {
	for _, external := range model.ExternalResources {
		for _, ref := range external.ArchitectureNodes {
			if ref.NodeID == id {
				return true
			}
		}
	}
	return false
}

func cloudfrontCommercialRegion(region string) bool {
	for _, prefix := range []string{"cn-", "us-gov-", "us-iso", "eu-iso", "eusc-"} {
		if strings.HasPrefix(region, prefix) {
			return false
		}
	}
	for _, prefix := range []string{"af-", "ap-", "ca-", "eu-", "il-", "me-", "mx-", "sa-", "us-"} {
		if strings.HasPrefix(region, prefix) {
			return true
		}
	}
	return false
}

//go:embed internal/contracts/cloudfront-configuration-v1.json
var cloudfrontConfigurationJSON []byte
var cloudfrontSchemas = func() map[string]map[string]ecsField {
	var f map[string]map[string]ecsField
	if json.Unmarshal(cloudfrontConfigurationJSON, &f) != nil {
		panic("invalid reviewed CloudFront schema")
	}
	return f
}()
var cloudfrontContracts = map[string]ecsBinding{
	cloudfrontOrigin: {serviceCloudfrontDistribution, "s3-origin", "aws.s3.bucket", "cloudfront-origin", 1, 1}, cloudfrontCache: {serviceCloudfrontDistribution, "cache-policy", serviceCloudfrontCache, "distribution", 1, 128}, cloudfrontAlias: {serviceCloudfrontAlias, "distribution", serviceCloudfrontDistribution, "alias", 1, 1}, cloudfrontCertificate: {serviceCloudfrontAlias, "certificate", servicePublicCertificate, "cloudfront-alias", 1, 1},
}

func init() {
	terraformResourceTypeByService[serviceCloudfrontDistribution] = "aws_cloudfront_distribution"
	terraformResourceTypeByService[serviceCloudfrontCache] = "aws_cloudfront_cache_policy"
	cloudFormationResourceTypeByService[serviceCloudfrontDistribution] = "AWS::CloudFront::Distribution"
	cloudFormationResourceTypeByService[serviceCloudfrontCache] = "AWS::CloudFront::CachePolicy"
	terraformInternalService[serviceCloudfrontAlias] = struct{}{}
	cloudFormationInternalService[serviceCloudfrontAlias] = struct{}{}
	for rel, b := range cloudfrontContracts {
		networkingRelationshipContracts[rel] = networkContract(b.source, b.source+"."+b.sourcePort, b.target, b.target+"."+b.targetPort, b.sourceMax, b.targetMax)
		terraformRelationshipSupport[rel] = struct{}{}
	}
}
func cloudfrontGenerated(n NormalizedResource, e NormalizedConnection) bool {
	l := n.Lifecycle
	p := l.Provenance
	return l.Ownership == "generated" && l.Origin == "connection-rule" && p != nil && p.GeneratorKind == "connection-rule" && p.GeneratorID == cloudfrontOrigin && p.GeneratorVersion == "1.0.0" && p.OperationID != "" && len(p.DependentNodeIDs) == 0 && len(p.DependentEdgeIDs) == 1 && p.DependentEdgeIDs[0] == e.ID && (e.Lifecycle.Ownership != "generated" || e.Lifecycle.Provenance != nil && e.Lifecycle.Provenance.OperationID == p.OperationID)
}
func cloudfrontGeneratedPolicy(d terraformPolicyDocument) bool {
	return d.Resource.Lifecycle.Provenance != nil && d.Resource.Lifecycle.Provenance.GeneratorID == cloudfrontOrigin
}

func cloudfrontPolicyEdgesValid(m *NormalizedSolution, doc terraformPolicyDocument, origin NormalizedConnection) bool {
	if len(doc.Statements) != 1 {
		return false
	}
	st := doc.Statements[0]
	specs := map[string]struct{ source, target, sourcePort, targetPort, schema string }{
		"aws.s3.bucket-owns-resource-policy": {doc.Resource.ID, doc.Owner.ID, "aws.iam.policy-document.s3-bucket-resource-policy", "aws.s3.bucket.resource-policy", "aws.s3.bucket-owns-resource-policy.connection"},
		"aws.iam.policy-contains-statement":  {st.Resource.ID, doc.Resource.ID, "aws.iam.policy-statement.policy-document", "aws.iam.policy-document.statement", "aws.iam.policy-membership.connection"},
		"aws.iam.authorizes-s3-bucket":       {st.Resource.ID, doc.Owner.ID, "aws.iam.policy-statement.s3-resource", "aws.s3.bucket.policy-resource", "aws.iam.policy-statement-authorizes-s3-bucket.connection"},
	}
	if doc.Resource.Lifecycle.Provenance == nil || st.Resource.Lifecycle.Provenance == nil || doc.Resource.Lifecycle.Provenance.OperationID != st.Resource.Lifecycle.Provenance.OperationID {
		return false
	}
	for rel, s := range specs {
		count := 0
		for _, e := range m.Connections {
			if e.RelationshipType != rel {
				continue
			}
			if rel == "aws.iam.authorizes-s3-bucket" && e.Source.NodeID != s.source || rel != "aws.iam.authorizes-s3-bucket" && e.Target.NodeID != s.target {
				continue
			}
			count++
			p := e.Lifecycle.Provenance
			if e.Source.NodeID != s.source || e.Target.NodeID != s.target || e.Source.Port != s.sourcePort || e.Target.Port != s.targetPort || e.Configuration.SchemaID != s.schema || e.Configuration.SchemaVersion != "1.0.0" || len(e.Configuration.Values) != 0 || e.Lifecycle.Ownership != "generated" || e.Lifecycle.Origin != "connection-rule" || p == nil || p.GeneratorKind != "connection-rule" || p.GeneratorID != cloudfrontOrigin || p.GeneratorVersion != "1.0.0" || p.OperationID != doc.Resource.Lifecycle.Provenance.OperationID || len(p.DependentNodeIDs) != 0 || len(p.DependentEdgeIDs) != 1 || p.DependentEdgeIDs[0] != origin.ID {
				return false
			}
		}
		if count != 1 {
			return false
		}
	}
	return true
}
func (r *terraformRenderer) validateCloudfrontModel() {
	found := false
	for _, n := range r.model.Resources {
		if _, ok := cloudfrontSchemas[n.ServiceType]; ok {
			found = true
			break
		}
	}
	if !found {
		return
	}
	reject := func(n NormalizedResource, code, message string) {
		r.error("TARGET_CLOUDFRONT_"+code, message, SourceReference{Document: DocumentArchitecture, NodeID: n.ID})
	}
	documents := r.collectPolicyDocuments()
	for _, e := range r.model.Connections {
		if b, ok := cloudfrontContracts[e.RelationshipType]; ok {
			p := e.Lifecycle.Provenance
			user := e.Lifecycle.Ownership == "user" && (e.Lifecycle.Origin == "user" || e.Lifecycle.Origin == "template" || e.Lifecycle.Origin == "ai-accepted" || e.Lifecycle.Origin == "migration")
			generated := e.Lifecycle.Ownership == "generated" && e.Lifecycle.Origin == "connection-rule" && p != nil && p.GeneratorKind == "connection-rule" && p.GeneratorID == e.RelationshipType && p.GeneratorVersion == "1.0.0" && p.OperationID != "" && len(p.DependentEdgeIDs) == 0 && len(p.DependentNodeIDs) == 2 && containsString(p.DependentNodeIDs, e.Source.NodeID) && containsString(p.DependentNodeIDs, e.Target.NodeID)
			if !user && !generated || e.Source.Port != b.source+"."+b.sourcePort || e.Target.Port != b.target+"."+b.targetPort || e.Configuration.SchemaID != e.RelationshipType+".connection" || e.Configuration.SchemaVersion != "1.0.0" || len(e.Configuration.Values) != 0 {
				r.error("TARGET_CLOUDFRONT_BINDING_INVALID", "Exact reviewed endpoints, closed connection configuration and authorized binding ownership are required.", SourceReference{Document: DocumentArchitecture, EdgeID: e.ID})
			}
		}
	}

	for _, n := range r.model.Resources {
		if _, ok := cloudfrontSchemas[n.ServiceType]; !ok {
			continue
		}
		if !isCurrentAwsCatalog(r.model.Provenance.Catalog) {
			reject(n, "CATALOG_UNSUPPORTED", "CloudFront requires the exact reviewed catalog successor.")
			continue
		}
		if !rdsUser(n) || n.ResourceType != n.ServiceType {
			reject(n, "OWNERSHIP_INVALID", "CloudFront resources/configuration require exact user-owned identity; generated/adopted/imported/external ownership is unsupported.")
		}
		if !cloudfrontCommercialRegion(r.model.Provenance.Region) {
			reject(n, "PARTITION_UNSUPPORTED", "This CloudFront slice is limited to the commercial AWS partition.")
		}
		for _, external := range r.model.ExternalResources {
			for _, ref := range external.ArchitectureNodes {
				if ref.NodeID == n.ID {
					reject(n, "EXTERNAL_UNSUPPORTED", "External CloudFront ownership requires a separately reviewed contract.")
				}
			}
		}
		if !r.validateCloudfrontFields(n) {
			continue
		}
		if n.ServiceType != serviceCloudfrontAlias && n.Parent != nil {
			reject(n, "PLACEMENT_INVALID", "Distribution and cache policy must be user-owned roots.")
		}
		if n.ServiceType == serviceCloudfrontCache {
			if r.configNumber(n, "defaultTtl") > r.configNumber(n, "maxTtl") {
				reject(n, "TTL_INVALID", "Cache fallback TTL cannot exceed maximum TTL; minimum stays zero.")
			}
			for _, other := range r.model.Resources {
				if other.ID != n.ID && other.ServiceType == n.ServiceType && r.configString(other, "name") == r.configString(n, "name") {
					reject(n, "DUPLICATE_CACHE", "Cache policy names must be unique within the modeled native account namespace.")
				}
			}
		}
		if n.ServiceType == serviceCloudfrontDistribution {
			origins := r.relatedResources(n.ID, cloudfrontOrigin, false)
			caches := r.relatedResources(n.ID, cloudfrontCache, false)
			aliases := r.relatedResources(n.ID, cloudfrontAlias, true)
			if len(origins) != 1 {
				reject(n, "ORIGIN_INVALID", "Connect one dedicated user-owned private S3 REST origin.")
			} else {
				bucket := origins[0]
				valid := bucket.ServiceType == "aws.s3.bucket" && rdsUser(bucket) && !cloudfrontExternalResource(r.model, bucket.ID) && bucket.Parent == nil && bucket.ResourceType == bucket.ServiceType && r.configBool(bucket, "blockPublicAccess") && r.configBool(bucket, "versioningEnabled") && r.configBool(bucket, "deletionProtectionEnabled") && r.configString(bucket, "encryption") == "SSE-S3" && r.configString(bucket, "objectOwnership") == "BUCKET_OWNER_ENFORCED"
				if len(r.relatedResources(bucket.ID, cloudfrontOrigin, true)) != 1 {
					valid = false
				}
				if !valid {
					reject(n, "PRIVATE_ORIGIN_INVALID", "Dedicated private origin requires exact S3 REST bucket ownership, public-access blocking, versioning, SSE-S3 and deletion protection.")
				}
				var e NormalizedConnection
				for _, edge := range r.model.Connections {
					if edge.RelationshipType == cloudfrontOrigin && edge.Source.NodeID == n.ID {
						e = edge
					}
				}
				count := 0
				for _, doc := range documents {
					if doc.Owner.ID != bucket.ID {
						continue
					}
					count++
					if len(doc.Statements) != 1 || !cloudfrontGenerated(doc.Resource, e) || !cloudfrontPolicyEdgesValid(r.model, doc, e) || doc.Resource.Parent == nil || doc.Resource.Parent.NodeID != bucket.ID || doc.Resource.Parent.RelationshipType != "aws.s3.bucket-owns-resource-policy" {
						valid = false
						continue
					}
					st := doc.Statements[0]
					ref, exists := st.Resource.Configuration.Values["resourceNode"]
					if !exists || ref.Kind != "node-reference" || ref.NodeID != bucket.ID || ref.Attribute != "aws.s3.bucket.arn" {
						valid = false
					}
					expected := expectedGeneratedPolicy{OwnerID: bucket.ID, Kind: "resource", Actions: []string{"s3:GetObject"}, ScopeID: bucket.ID, Principal: "cloudfront.amazonaws.com", SourceArnID: n.ID}
					if !cloudfrontGenerated(st.Resource, e) || st.Resource.Parent == nil || st.Resource.Parent.NodeID != doc.Resource.ID || st.Resource.Parent.RelationshipType != "aws.iam.policy-contains-statement" || st.Effect != "allow" || !generatedStatementMatches(doc, st, expected) {
						valid = false
					}
				}
				if count != 1 || !valid {
					reject(n, "ORIGIN_POLICY_INVALID", "Require one exact provenance-bound generated read-only bucket policy with exact bucket-object scope and distribution-qualified SourceArn; custom/adopted/extra statements/conditions and policy merges are unsupported.")
				}
			}
			if len(caches) != 1 || caches[0].ServiceType != serviceCloudfrontCache || !rdsUser(caches[0]) || caches[0].Parent != nil || !r.validateCloudfrontFields(caches[0]) {
				reject(n, "CACHE_INVALID", "Connect one exact user-owned bounded static cache policy.")
			}
			mode := r.configString(n, "viewerCertificateMode")
			if mode == "default" && len(aliases) != 0 || mode == "acm-alias" && len(aliases) != 1 {
				reject(n, "VIEWER_MODE_INVALID", "Default viewer mode has no alias; ACM mode requires one canonical owned alias.")
			}
		}
		if n.ServiceType == serviceCloudfrontAlias {
			owners := r.relatedResources(n.ID, cloudfrontAlias, false)
			certs := r.relatedResources(n.ID, cloudfrontCertificate, false)
			if len(owners) != 1 || owners[0].ServiceType != serviceCloudfrontDistribution || !rdsUser(owners[0]) || n.Parent == nil || n.Parent.NodeID != owners[0].ID || n.Parent.RelationshipType != cloudfrontAlias || r.configString(owners[0], "viewerCertificateMode") != "acm-alias" {
				reject(n, "ALIAS_OWNER_INVALID", "Alias canonical parent and exact owner edge must identify one ACM-mode distribution.")
			}
			if len(certs) != 1 || certs[0].ServiceType != servicePublicCertificate || !rdsUser(certs[0]) || cloudfrontExternalResource(r.model, certs[0].ID) || r.configString(certs[0], "intendedUse") != "cloudfront-viewer" || r.configString(certs[0], "certificateRegion") != "us-east-1" || r.model.Provenance.Region != "us-east-1" || r.configString(certs[0], "domainName") != r.configString(n, "domainName") {
				reject(n, "ALIAS_CERTIFICATE_INVALID", "Alias must exactly match the primary domain of one public CloudFront-viewer ACM certificate in this us-east-1 graph; SAN/wildcard/import/cross-region inference is unsupported.")
			}
			for _, other := range r.model.Resources {
				if other.ID != n.ID && other.ServiceType == n.ServiceType && r.configString(other, "domainName") == r.configString(n, "domainName") {
					reject(n, "DUPLICATE_ALIAS", "Each modeled exact alias requires one distribution owner; external alias exclusivity remains unverified.")
				}
			}
		}
	}
}

const cloudfrontReadinessMessage = "Public content is caller-attested. Verify object population, freshness headers, alias exclusivity/delegation, certificate eligibility/issuance/renewal, quotas, deployment Region and authority externally. OAC protects origin access, not viewers. Retained serving/access and deliberate cleanup remain external; no upload, invalidation, live DNS/certificate/CloudFront change or TLS/serving health is proven."

func (r *terraformRenderer) cloudfrontWarnings(n NormalizedResource) {
	r.warning("CLOUDFRONT_READINESS_EXTERNAL", cloudfrontReadinessMessage, SourceReference{Document: DocumentArchitecture, NodeID: n.ID})
}
