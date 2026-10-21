package compiler

import (
	"math"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/hashicorp/hcl/v2/hclwrite"
	"github.com/zclconf/go-cty/cty"
)

const serviceKmsKey = "aws.kms.key"
const kmsPolicyOwnerRelationship = "aws.kms.key-owns-resource-policy"
const kmsPolicyScopeRelationship = "aws.iam.authorizes-kms-key"

func isKmsRelationship(relationship string) bool {
	return relationship == kmsPolicyOwnerRelationship || relationship == kmsPolicyScopeRelationship
}
func init() {
	terraformResourceTypeByService[serviceKmsKey] = "aws_kms_key"
	cloudFormationResourceTypeByService[serviceKmsKey] = "AWS::KMS::Key"
	networkingRelationshipContracts[kmsPolicyOwnerRelationship] = networkContract("aws.iam.policy-document", "aws.iam.policy-document.kms-key-resource-policy", serviceKmsKey, "aws.kms.key.resource-policy", 1, 1)
	networkingRelationshipContracts[kmsPolicyScopeRelationship] = networkContract("aws.iam.policy-statement", "aws.iam.policy-statement.kms-resource", serviceKmsKey, "aws.kms.key.policy-resource", 1, 128)
	terraformRelationshipSupport[kmsPolicyOwnerRelationship] = struct{}{}
	terraformRelationshipSupport[kmsPolicyScopeRelationship] = struct{}{}
}

var kmsConfigurationKeys = []string{"description", "keySpec", "keyUsage", "origin", "multiRegion", "enabled", "rotationEnabled", "rotationPeriodDays", "deletionWindowDays", "preventDestroy"}
var kmsAdminActions = map[string]bool{
	"kms:DescribeKey": true, "kms:GetKeyPolicy": true, "kms:PutKeyPolicy": true, "kms:UpdateKeyDescription": true,
	"kms:EnableKey": true, "kms:DisableKey": true, "kms:GetKeyRotationStatus": true, "kms:EnableKeyRotation": true, "kms:DisableKeyRotation": true,
	"kms:ListResourceTags": true, "kms:TagResource": true, "kms:UntagResource": true, "kms:ScheduleKeyDeletion": true, "kms:CancelKeyDeletion": true,
}
var kmsUserActions = map[string]bool{"kms:DescribeKey": true, "kms:Encrypt": true, "kms:Decrypt": true, "kms:ReEncryptFrom": true, "kms:ReEncryptTo": true, "kms:GenerateDataKey": true, "kms:GenerateDataKeyWithoutPlaintext": true}
var kmsRoleARN = regexp.MustCompile(`^arn:(aws|aws-us-gov|aws-cn):iam::([0-9]{12}):role/(?:[A-Za-z0-9+=,.@_-]+/)*[A-Za-z0-9+=,.@_-]{1,64}$`)

func (renderer *terraformRenderer) validateKmsModel() {
	for _, resource := range renderer.model.Resources {
		if resource.ServiceType != serviceKmsKey {
			continue
		}
		source := SourceReference{Document: DocumentArchitecture, NodeID: resource.ID}
		if !isCurrentAwsCatalog(renderer.model.Provenance.Catalog) {
			renderer.error("TARGET_KMS_CATALOG_UNSUPPORTED", "KMS keys require the exact reviewed KMS catalog successor.", source)
			continue
		}
		if resource.ResourceType != serviceKmsKey || resource.Parent != nil || !renderer.validateConfiguration(resource, serviceKmsKey+".configuration", kmsConfigurationKeys) {
			renderer.error("TARGET_KMS_CONFIGURATION_INVALID", "KMS key requires its exact regional root resource and configuration.", source)
			continue
		}
		if renderer.configString(resource, "keySpec") != "SYMMETRIC_DEFAULT" || renderer.configString(resource, "keyUsage") != "ENCRYPT_DECRYPT" || renderer.configString(resource, "origin") != "AWS_KMS" || renderer.configBool(resource, "multiRegion") || !renderer.configBool(resource, "preventDestroy") {
			renderer.error("TARGET_KMS_MODE_UNSUPPORTED", "KMS foundation supports only retained regional AWS-generated symmetric encryption keys.", source)
		}
		description := renderer.configString(resource, "description")
		if !utf8.ValidString(description) || utf8.RuneCountInString(description) > 8192 {
			renderer.error("TARGET_KMS_DESCRIPTION_INVALID", "Key description exceeds its bounded supported length.", source)
		}
		for _, bound := range []struct {
			key              string
			minimum, maximum float64
		}{{"rotationPeriodDays", 90, 2560}, {"deletionWindowDays", 7, 30}} {
			value := renderer.configNumber(resource, bound.key)
			if math.IsNaN(value) || math.IsInf(value, 0) || value != math.Trunc(value) || value < bound.minimum || value > bound.maximum {
				renderer.error("TARGET_KMS_PERIOD_INVALID", "Rotation requires 90–2560 whole days; deletion waiting requires 7–30 whole days. Retention does not schedule deletion.", SourceReference{Document: DocumentArchitecture, NodeID: resource.ID, Path: "$.semantic.configuration.values." + bound.key})
			}
		}
		renderer.configBool(resource, "enabled")
		renderer.configBool(resource, "rotationEnabled")
		policies := renderer.relatedResources(resource.ID, kmsPolicyOwnerRelationship, true)
		if len(policies) != 1 {
			renderer.error("TARGET_KMS_POLICY_REQUIRED", "KMS key requires exactly one explicit user-owned canonical key policy.", source)
		}
		for _, external := range renderer.model.ExternalResources {
			for _, ref := range external.ArchitectureNodes {
				if ref.NodeID == resource.ID {
					renderer.error("TARGET_KMS_EXTERNAL_OWNERSHIP_UNSUPPORTED", "KMS import and external reference modes require separately reviewed ownership semantics.", source)
				}
			}
		}
	}
	for _, connection := range renderer.model.Connections {
		if isKmsRelationship(connection.RelationshipType) && !isCurrentAwsCatalog(renderer.model.Provenance.Catalog) {
			renderer.error("TARGET_KMS_CATALOG_UNSUPPORTED", "KMS policy bindings require the exact KMS catalog successor.", SourceReference{Document: DocumentArchitecture, EdgeID: connection.ID})
		}
	}
}

func (renderer *terraformRenderer) validateKmsPolicyDocument(document terraformPolicyDocument) bool {
	source := SourceReference{Document: DocumentArchitecture, NodeID: document.Resource.ID}
	valid := true
	reject := func(code, message string, statement *terraformPolicyStatement) {
		ref := source
		if statement != nil {
			ref.NodeID = statement.Resource.ID
		}
		renderer.error(code, message, ref)
		valid = false
	}
	if !isCurrentAwsCatalog(renderer.model.Provenance.Catalog) || document.Kind != "resource" || document.Owner.ServiceType != serviceKmsKey || document.Resource.Lifecycle.Ownership != "user" || document.Resource.Parent == nil || document.Resource.Parent.NodeID != document.Owner.ID || document.Resource.Parent.RelationshipType != kmsPolicyOwnerRelationship {
		reject("TARGET_KMS_POLICY_OWNER_INVALID", "Key policy requires its exact user-owned resource-policy slot and matching semantic parent.", nil)
	}
	accounts := map[string]bool{}
	administrator := false
	for _, statement := range document.Statements {
		statement := statement
		memberships := 0
		for _, edge := range renderer.model.Connections {
			if edge.RelationshipType != "aws.iam.policy-contains-statement" || edge.Source.NodeID != statement.Resource.ID {
				continue
			}
			memberships++
			if edge.Target.NodeID != document.Resource.ID || edge.Source.Port != "aws.iam.policy-statement.policy-document" || edge.Target.Port != "aws.iam.policy-document.statement" || edge.Configuration.SchemaID != "aws.iam.policy-membership.connection" || edge.Configuration.SchemaVersion != "1.0.0" || len(edge.Configuration.Values) != 0 {
				reject("TARGET_KMS_POLICY_MEMBERSHIP_INVALID", "KMS statements require one exact canonical membership binding with no extra configuration.", &statement)
			}
		}
		if memberships != 1 {
			reject("TARGET_KMS_POLICY_MEMBERSHIP_INVALID", "KMS statements require exactly one canonical policy owner.", &statement)
		}
		reference, hasReference := statement.Resource.Configuration.Values["resourceNode"]
		if len(statement.Scopes) != 1 || statement.Scopes[0].ID != document.Owner.ID || !hasReference || reference.Kind != "node-reference" || reference.NodeID != document.Owner.ID || reference.Attribute != serviceKmsKey+".arn" || len(statement.Expressions) != 0 {
			reject("TARGET_KMS_POLICY_SELF_SCOPE_INVALID", "Key policy statements require one exact owning-key reference and no wildcard or pasted resource scope.", &statement)
		}
		admin := containsString(statement.Actions, "kms:PutKeyPolicy")
		actions := kmsUserActions
		if admin {
			actions = kmsAdminActions
		}
		actionValid := len(statement.Actions) > 0
		for _, action := range statement.Actions {
			if !actions[action] {
				actionValid = false
			}
		}
		if statement.Effect != "allow" || !actionValid || len(statement.Conditions) > 0 {
			reject("TARGET_KMS_POLICY_ACTIONS_UNSUPPORTED", "Separate reviewed unconditional administrator and encryption/decryption allow statements. Mixed use, denies, grants and conditions require a later variant.", &statement)
		}
		principalValid := statement.PrincipalKind == "provider-identity" && len(statement.Principals) > 0
		for _, principal := range statement.Principals {
			match := kmsRoleARN.FindStringSubmatch(principal)
			if match == nil {
				principalValid = false
			} else {
				accounts[match[1]+":"+match[2]] = true
			}
		}
		if !principalValid {
			reject("TARGET_KMS_POLICY_PRINCIPAL_INVALID", "KMS foundation requires explicit exact IAM role ARNs; root, service, session and wildcard principals are unsupported.", &statement)
		}
		if statement.Resource.Parent == nil || statement.Resource.Parent.NodeID != document.Resource.ID || statement.Resource.Parent.RelationshipType != "aws.iam.policy-contains-statement" || statement.Resource.Lifecycle.Ownership != "user" {
			reject("TARGET_KMS_POLICY_STATEMENT_OWNER_INVALID", "KMS statements must retain their exact user-owned policy membership.", &statement)
		}
		if admin && principalValid && actionValid && statement.Effect == "allow" && len(statement.Conditions) == 0 {
			administrator = true
		}
	}
	if !administrator {
		reject("TARGET_KMS_POLICY_ADMINISTRATOR_REQUIRED", "An explicit unconditional administrator statement must allow kms:PutKeyPolicy. The deployment caller must retain this authority; lockout bypass remains false.", nil)
	}
	if len(accounts) > 1 {
		reject("TARGET_KMS_POLICY_CROSS_ACCOUNT_UNSUPPORTED", "KMS foundation role principals must belong to one account and partition; verify it is the deployment account before using the export.", nil)
	}
	return valid
}

func (renderer *terraformRenderer) renderKmsKeys(documents []terraformPolicyDocument) {
	for _, key := range renderer.model.Resources {
		if key.ServiceType != serviceKmsKey {
			continue
		}
		var policy *terraformPolicyDocument
		for i := range documents {
			if documents[i].Owner.ID == key.ID && documents[i].OwnerEdge.RelationshipType == kmsPolicyOwnerRelationship {
				if policy != nil {
					renderer.error("TARGET_KMS_POLICY_REQUIRED", "KMS requires exactly one key policy.", SourceReference{Document: DocumentArchitecture, NodeID: key.ID})
					break
				}
				policy = &documents[i]
			}
		}
		if policy == nil {
			renderer.error("TARGET_KMS_POLICY_REQUIRED", "KMS key policy is missing or invalid.", SourceReference{Document: DocumentArchitecture, NodeID: key.ID})
			continue
		}
		block := renderer.resourceBlock(key)
		body := block.Body()
		body.SetAttributeValue("description", cty.StringVal(renderer.configString(key, "description")))
		body.SetAttributeValue("customer_master_key_spec", cty.StringVal("SYMMETRIC_DEFAULT"))
		body.SetAttributeValue("key_usage", cty.StringVal("ENCRYPT_DECRYPT"))
		body.SetAttributeValue("multi_region", cty.BoolVal(false))
		body.SetAttributeValue("is_enabled", cty.BoolVal(renderer.configBool(key, "enabled")))
		rotation := renderer.configBool(key, "rotationEnabled")
		body.SetAttributeValue("enable_key_rotation", cty.BoolVal(rotation))
		if rotation {
			body.SetAttributeValue("rotation_period_in_days", cty.NumberIntVal(int64(renderer.configInt(key, "rotationPeriodDays"))))
		}
		body.SetAttributeValue("deletion_window_in_days", cty.NumberIntVal(int64(renderer.configInt(key, "deletionWindowDays"))))
		body.SetAttributeValue("bypass_policy_lockout_safety_check", cty.BoolVal(false))
		body.SetAttributeTraversal("policy", traversal("data", "aws_iam_policy_document", renderer.resourceNames[policy.Resource.ID], "json"))
		body.SetAttributeTraversal("tags", traversal("local", "tags"))
		lifecycle := hclwrite.NewBlock("lifecycle", nil)
		lifecycle.Body().SetAttributeValue("prevent_destroy", cty.BoolVal(true))
		body.AppendBlock(lifecycle)
		appendBlock(renderer.file("security.tf"), block)
		renderer.warning("KMS_DEPLOYMENT_AUTHORITY_REQUIRES_REVIEW", "Verify all key-policy roles exist in the deployment account and the deployment caller retains PutKeyPolicy authority. Export does not prove live permissions; lockout safety remains enabled.", SourceReference{Document: DocumentArchitecture, NodeID: key.ID})
	}
}

func (renderer *cloudFormationRenderer) renderKmsKey(key NormalizedResource) {
	var policy *terraformPolicyDocument
	for i := range renderer.policyDocuments {
		if renderer.policyDocuments[i].Owner.ID == key.ID && renderer.policyDocuments[i].OwnerEdge.RelationshipType == kmsPolicyOwnerRelationship {
			policy = &renderer.policyDocuments[i]
		}
	}
	if policy == nil {
		renderer.error("CLOUDFORMATION_KMS_POLICY_REQUIRED", "KMS key requires one exact key policy.", SourceReference{Document: DocumentArchitecture, NodeID: key.ID})
		return
	}
	rotation := renderer.configBool(key, "rotationEnabled")
	properties := map[string]any{"Description": renderer.configString(key, "description"), "KeySpec": "SYMMETRIC_DEFAULT", "KeyUsage": "ENCRYPT_DECRYPT", "Origin": "AWS_KMS", "MultiRegion": false, "Enabled": renderer.configBool(key, "enabled"), "EnableKeyRotation": rotation, "PendingWindowInDays": renderer.configInt(key, "deletionWindowDays"), "BypassPolicyLockoutSafetyCheck": false, "KeyPolicy": renderer.policyDocument(*policy), "Tags": renderer.tagList()}
	if rotation {
		properties["RotationPeriodInDays"] = renderer.configInt(key, "rotationPeriodDays")
	}
	renderer.addResource(renderer.logicalIDs[key.ID], cloudFormationResource{Type: "AWS::KMS::Key", Properties: properties, DeletionPolicy: "Retain", UpdateReplacePolicy: "Retain", Metadata: renderer.resourceMetadata(key)}, SourceReference{Document: DocumentArchitecture, NodeID: key.ID})
	renderer.warning("KMS_DEPLOYMENT_AUTHORITY_REQUIRES_REVIEW", "Verify key-policy roles exist in the deployment account and the deployment caller retains PutKeyPolicy. Key-kind changes are immutable CloudFormation updates; lockout safety remains enabled.", SourceReference{Document: DocumentArchitecture, NodeID: key.ID})
}

func hasKmsIntent(document terraformPolicyDocument) bool {
	for _, statement := range document.Statements {
		for _, action := range statement.Actions {
			if strings.HasPrefix(action, "kms:") {
				return true
			}
		}
		for _, scope := range statement.Scopes {
			if scope.ServiceType == serviceKmsKey {
				return true
			}
		}
	}
	return false
}
