package compiler

import (
	_ "embed"
	"encoding/json"
	"math"
	"regexp"
	"sort"
	"unicode/utf16"
)

const serviceWaf = "aws.wafv2.web-acl"
const serviceWafAssociation = "aws.wafv2.alb-association"
const wafOwner = "aws.wafv2.association-uses-web-acl"
const wafProtects = "aws.wafv2.association-protects-alb"

//go:embed internal/contracts/waf-configuration-v1.json
var wafConfigurationJSON []byte
var wafSchema = func() map[string]ecsField {
	var fields map[string]ecsField
	if json.Unmarshal(wafConfigurationJSON, &fields) != nil {
		panic("invalid reviewed WAF schema")
	}
	return fields
}()

func isWafRelationship(rel string) bool { return rel == wafOwner || rel == wafProtects }

func init() {
	cloudFormationResourceTypeByService[serviceWaf] = "AWS::WAFv2::WebACL"
	cloudFormationResourceTypeByService[serviceWafAssociation] = "AWS::WAFv2::WebACLAssociation"
	networkingRelationshipContracts[wafOwner] = networkContract(serviceWafAssociation, serviceWafAssociation+".web-acl", serviceWaf, serviceWaf+".association", 1, 128)
	networkingRelationshipContracts[wafProtects] = networkContract(serviceWafAssociation, serviceWafAssociation+".alb", serviceAlb, serviceAlb+".waf", 1, 1)
	// No Terraform resource type or relationship support is registered.
}
func (r *terraformRenderer) validateWafModel() {
	reject := func(n NormalizedResource, code, message string) {
		r.error("TARGET_WAF_"+code, message, SourceReference{Document: DocumentArchitecture, NodeID: n.ID})
	}
	for _, e := range r.model.Connections {
		if !isWafRelationship(e.RelationshipType) {
			continue
		}
		p := e.Lifecycle.Provenance
		user := e.Lifecycle.Ownership == "user" && containsString([]string{"user", "template", "ai-accepted", "migration"}, e.Lifecycle.Origin)
		generated := e.Lifecycle.Ownership == "generated" && e.Lifecycle.Origin == "connection-rule" && p != nil && p.GeneratorKind == "connection-rule" && p.GeneratorID == e.RelationshipType && p.GeneratorVersion == "1.0.0" && p.OperationID != "" && len(p.DependentNodeIDs) == 2 && containsString(p.DependentNodeIDs, e.Source.NodeID) && containsString(p.DependentNodeIDs, e.Target.NodeID) && len(p.DependentEdgeIDs) == 0
		if !isCurrentAwsCatalog(r.model.Provenance.Catalog) || (!user && !generated) {
			r.error("TARGET_WAF_BINDING_INVALID", "Require the exact current catalog and canonical WAF bindings.", SourceReference{Document: DocumentArchitecture, EdgeID: e.ID})
		}
	}
	for _, n := range r.model.Resources {
		if n.ServiceType != serviceWaf && n.ServiceType != serviceWafAssociation {
			continue
		}
		if !isCurrentAwsCatalog(r.model.Provenance.Catalog) {
			reject(n, "CATALOG_UNSUPPORTED", "Use the exact current regional WAF catalog binding.")
			continue
		}
		if !r.elbSafe(n) {
			reject(n, "OWNERSHIP_INVALID", "Use exact user-owned modeled WAF resources; external/adopted/generated ownership is unavailable.")
		}
		if n.ServiceType == serviceWafAssociation {
			if !r.validateConfiguration(n, serviceWafAssociation+".configuration", []string{}) {
				continue
			}
			owner := r.elbParent(n, serviceWaf, wafOwner, false)
			alb := r.elbOne(n, wafProtects, false)
			if owner.ID == "" {
				reject(n, "OWNER_INVALID", "Association parent and exact owner edge must agree on one regional ACL.")
			}
			if alb.ServiceType != serviceAlb || !r.elbSafe(alb) {
				reject(n, "TARGET_INVALID", "Associate one existing modeled regional ALB only; HTTP APIs and CloudFront are unavailable.")
			}
			continue
		}
		keys := []string{}
		for k := range wafSchema {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		if !r.validateConfiguration(n, serviceWaf+".configuration", keys) {
			continue
		}
		for _, k := range keys {
			s, v := wafSchema[k], n.Configuration.Values[k]
			valid := v.Kind == s.Type
			var value any
			switch s.Type {
			case "string":
				x := r.configString(n, k)
				value = x
				valid = valid && (s.Pattern == "" || regexp.MustCompile(s.Pattern).MatchString(x)) && (s.MinLength == nil || len(utf16.Encode([]rune(x))) >= *s.MinLength) && (s.MaxLength == nil || len(utf16.Encode([]rune(x))) <= *s.MaxLength)
			case "integer":
				x := r.configNumber(n, k)
				value = x
				valid = valid && !math.IsNaN(x) && !math.IsInf(x, 0) && x == math.Trunc(x) && (s.Minimum == nil || x >= *s.Minimum) && (s.Maximum == nil || x <= *s.Maximum)
			case "boolean":
				value = r.configBool(n, k)
				valid = valid && (s.Const == nil || value == *s.Const)
			}
			if len(s.Enum) > 0 {
				found := false
				for _, enum := range s.Enum {
					if enum == value {
						found = true
					}
				}
				valid = valid && found
			}
			if !valid {
				reject(n, "FIELD_INVALID", "Supply every exact literal WAF field within admitted bounds; raw statements, references and unknown fields are unavailable.")
			}
		}
		if n.Parent != nil {
			reject(n, "PLACEMENT_INVALID", "Regional Web ACLs are root resources.")
		}
		if !cloudfrontCommercialRegion(r.model.Provenance.Region) || r.configString(n, "webAclRegion") != r.model.Provenance.Region {
			reject(n, "REGION_INVALID", "ACL and ALB must use this project's commercial AWS Region.")
		}
		if r.configInt(n, "ratePriority") == r.configInt(n, "managedRulePriority") {
			reject(n, "PRIORITIES_DUPLICATE", "Rate and managed-rule priorities must be distinct; lower values evaluate first.")
		}
		owners := r.relatedResources(n.ID, wafOwner, true)
		if len(owners) == 0 {
			reject(n, "ASSOCIATION_MISSING", "Add an explicit owned ALB association.")
		}
		for _, other := range r.model.Resources {
			if other.ID != n.ID && other.ServiceType == serviceWaf && r.configString(other, "name") == r.configString(n, "name") {
				reject(n, "NAME_DUPLICATE", "Web ACL names must be unique in the modeled account and Region.")
			}
		}
		r.warning("WAF_TRAFFIC_REVIEW_REQUIRED", "Count mode does not block. Tune traffic before enforcement. Origin-IP rates are approximate; vendor-default managed rules can change independently. Metrics do not enable request logging/sampling. Verify regional availability, quotas and 8 KB ALB body inspection limits externally.", SourceReference{Document: DocumentArchitecture, NodeID: n.ID})
	}
}

func (r *cloudFormationRenderer) renderWafResource(n NormalizedResource) {
	p := map[string]any{}
	resource := cloudFormationResource{Type: cloudFormationResourceTypeByService[n.ServiceType], Properties: p, Metadata: r.resourceMetadata(n)}
	if n.ServiceType == serviceWafAssociation {
		h := &terraformRenderer{model: r.model}
		owner := h.elbOne(n, wafOwner, false)
		alb := h.elbOne(n, wafProtects, false)
		p["WebACLArn"] = cloudFormationGetAtt(r.logicalIDs[owner.ID], "Arn")
		p["ResourceArn"] = r.resourceAttribute(alb.ID, "arn")
	} else {
		name := r.configString(n, "name")
		visibility := func(suffix string) map[string]any {
			return map[string]any{"CloudWatchMetricsEnabled": r.configBool(n, "cloudWatchMetricsEnabled"), "SampledRequestsEnabled": false, "MetricName": name + suffix}
		}
		groupAction := "Count"
		if r.configString(n, "managedRuleMode") == "enforce" {
			groupAction = "None"
		}
		rateAction := "Count"
		if r.configString(n, "rateAction") == "block" {
			rateAction = "Block"
		}
		rules := []map[string]any{
			{"Name": name + "_bad_inputs", "Priority": r.configInt(n, "managedRulePriority"), "OverrideAction": map[string]any{groupAction: map[string]any{}}, "Statement": map[string]any{"ManagedRuleGroupStatement": map[string]any{"VendorName": "AWS", "Name": "AWSManagedRulesKnownBadInputsRuleSet"}}, "VisibilityConfig": visibility("_bad_inputs")},
			{"Name": name + "_rate", "Priority": r.configInt(n, "ratePriority"), "Action": map[string]any{rateAction: map[string]any{}}, "Statement": map[string]any{"RateBasedStatement": map[string]any{"AggregateKeyType": "IP", "Limit": r.configInt(n, "rateLimit"), "EvaluationWindowSec": r.configInt(n, "rateWindowSeconds")}}, "VisibilityConfig": visibility("_rate")},
		}
		sort.Slice(rules, func(i, j int) bool { return rules[i]["Priority"].(int) < rules[j]["Priority"].(int) })
		p["Name"] = name
		p["Scope"] = "REGIONAL"
		p["DefaultAction"] = map[string]any{"Allow": map[string]any{}}
		p["VisibilityConfig"] = visibility("_web_acl")
		p["Rules"] = rules
		p["Tags"] = r.tagList()
		resource.DeletionPolicy = "Retain"
		resource.UpdateReplacePolicy = "Retain"
	}
	r.addResource(r.logicalIDs[n.ID], resource, SourceReference{Document: DocumentArchitecture, NodeID: n.ID})
}
