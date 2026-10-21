package compiler

import (
	"math"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/hashicorp/hcl/v2/hclwrite"
	"github.com/zclconf/go-cty/cty"
)

const serviceSecret = "aws.secretsmanager.secret"
const secretEncryptionRelationship = "aws.kms.encrypts-secret"
const secretScopeRelationship = "aws.iam.authorizes-secret"

var namePattern = regexp.MustCompile(`^[A-Za-z0-9/_+=.@-]{1,512}$`)
var secretAmbiguousSuffix = regexp.MustCompile(`-[A-Za-z0-9/_+=.@-]{6}$`)
var secretActions = map[string]bool{"secretsmanager:GetSecretValue": true, "secretsmanager:DescribeSecret": true}

func init() {
	terraformResourceTypeByService[serviceSecret] = "aws_secretsmanager_secret"
	cloudFormationResourceTypeByService[serviceSecret] = "AWS::SecretsManager::Secret"
	networkingRelationshipContracts[secretEncryptionRelationship] = networkContract(serviceKmsKey, "aws.kms.key.secret-encryption", serviceSecret, "aws.secretsmanager.secret.encryption-key", 128, 1)
	networkingRelationshipContracts[secretScopeRelationship] = networkContract("aws.iam.policy-statement", "aws.iam.policy-statement.secret-resource", serviceSecret, "aws.secretsmanager.secret.policy-resource", 1, 128)
	terraformRelationshipSupport[secretEncryptionRelationship] = struct{}{}
	terraformRelationshipSupport[secretScopeRelationship] = struct{}{}
}

func (r *terraformRenderer) validateSecretModel() {
	names := map[string]bool{}
	for _, secret := range r.model.Resources {
		if secret.ServiceType != serviceSecret {
			continue
		}
		source := SourceReference{Document: DocumentArchitecture, NodeID: secret.ID}
		if !isCurrentAwsCatalog(r.model.Provenance.Catalog) {
			r.error("TARGET_SECRET_CATALOG_UNSUPPORTED", "Secrets Manager requires the exact reviewed catalog successor.", source)
			continue
		}
		if secret.ResourceType != serviceSecret || secret.Parent != nil || secret.Lifecycle.Ownership != "user" || !r.validateConfiguration(secret, serviceSecret+".configuration", []string{"name", "description", "encryptionMode", "valueMode", "recoveryWindowDays", "preventDestroy"}) {
			r.error("TARGET_SECRET_CONFIGURATION_INVALID", "Secret requires exact user-owned root regional metadata and strict configuration.", source)
			continue
		}
		name := r.configString(secret, "name")
		if !namePattern.MatchString(name) || secretAmbiguousSuffix.MatchString(name) {
			r.error("TARGET_SECRET_NAME_INVALID", "Secret names require 1-512 supported ASCII characters without ambiguous trailing hyphen and six characters.", SourceReference{Document: DocumentArchitecture, NodeID: secret.ID, Path: "$.semantic.configuration.values.name"})
		}
		if names[name] {
			r.error("TARGET_SECRET_NAME_DUPLICATE", "Graph-owned secret names must be distinct in this region.", source)
		}
		names[name] = true
		description := r.configString(secret, "description")
		if !utf8.ValidString(description) || utf8.RuneCountInString(description) > 2048 {
			r.error("TARGET_SECRET_DESCRIPTION_INVALID", "Secret purpose exceeds its bounded length.", source)
		}
		window := r.configNumber(secret, "recoveryWindowDays")
		if math.IsNaN(window) || math.IsInf(window, 0) || window != math.Trunc(window) || window < 7 || window > 30 {
			r.error("TARGET_SECRET_RECOVERY_INVALID", "Secret recovery requires 7-30 whole days; force deletion is unsupported.", source)
		}
		if r.configString(secret, "valueMode") != "external-population" || !r.configBool(secret, "preventDestroy") {
			r.error("TARGET_SECRET_MODE_UNSUPPORTED", "Only retained metadata and external value population are supported.", source)
		}
		keys := r.relatedResources(secret.ID, secretEncryptionRelationship, true)
		mode := r.configString(secret, "encryptionMode")
		if mode == "aws-managed" {
			if len(keys) != 0 {
				r.error("TARGET_SECRET_ENCRYPTION_INVALID", "AWS-managed mode cannot have a customer-key connection.", source)
			}
		} else if mode == "customer-managed" {
			if len(keys) != 1 || keys[0].ServiceType != serviceKmsKey || keys[0].Parent != nil || !r.configBool(keys[0], "enabled") {
				r.error("TARGET_SECRET_ENCRYPTION_INVALID", "Customer-managed mode requires one enabled typed regional symmetric KMS key.", source)
			}
		} else {
			r.error("TARGET_SECRET_ENCRYPTION_INVALID", "Secret encryption mode is unsupported.", source)
		}
		for _, external := range r.model.ExternalResources {
			for _, ref := range external.ArchitectureNodes {
				if ref.NodeID == secret.ID {
					r.error("TARGET_SECRET_EXTERNAL_UNSUPPORTED", "Imported and reference-only secrets need separate reviewed ownership contracts.", source)
				}
			}
		}
	}
	for _, edge := range r.model.Connections {
		if edge.RelationshipType != secretEncryptionRelationship && edge.RelationshipType != secretScopeRelationship {
			continue
		}
		source := SourceReference{Document: DocumentArchitecture, EdgeID: edge.ID}
		if !isCurrentAwsCatalog(r.model.Provenance.Catalog) {
			r.error("TARGET_SECRET_CATALOG_UNSUPPORTED", "Secret relationships require the exact reviewed catalog successor.", source)
		}
		ruleID := "aws.kms.key-encrypts-secret"
		if edge.RelationshipType == secretScopeRelationship {
			ruleID = "aws.iam.policy-statement-authorizes-secret"
		}
		if edge.Configuration.SchemaID != ruleID+".connection" || edge.Configuration.SchemaVersion != "1.0.0" || len(edge.Configuration.Values) != 0 {
			r.error("TARGET_SECRET_BINDING_INVALID", "Secret relationship requires its exact empty versioned binding configuration.", source)
		}
	}
}

func hasSecretIntent(d terraformPolicyDocument) bool {
	for _, s := range d.Statements {
		for _, a := range s.Actions {
			if strings.HasPrefix(a, "secretsmanager:") {
				return true
			}
		}
		for _, scope := range s.Scopes {
			if scope.ServiceType == serviceSecret {
				return true
			}
		}
		if ref, ok := s.Resource.Configuration.Values["resourceNode"]; ok && ref.Attribute == serviceSecret+".arn" {
			return true
		}
	}
	return false
}
func (r *terraformRenderer) validateSecretPolicy(d terraformPolicyDocument) bool {
	valid := true
	reject := func(id, message string) {
		r.error("TARGET_SECRET_POLICY_INVALID", message, SourceReference{Document: DocumentArchitecture, NodeID: id})
		valid = false
	}
	if !isCurrentAwsCatalog(r.model.Provenance.Catalog) || d.Kind != "identity-inline" || d.Owner.ServiceType != "aws.iam.role" || d.Owner.Lifecycle.Ownership != "user" || d.Owner.Parent != nil || d.OwnerEdge.RelationshipType != "aws.iam.role-owns-inline-policy" || d.Resource.Lifecycle.Ownership != "user" || d.Resource.Parent == nil || d.Resource.Parent.NodeID != d.Owner.ID || d.Resource.Parent.RelationshipType != d.OwnerEdge.RelationshipType {
		reject(d.Resource.ID, "Secret access requires its exact user-owned role identity-inline policy and matching parent.")
	}
	if d.OwnerEdge.Source.Port != "aws.iam.policy-document.role-inline-policy" || d.OwnerEdge.Target.Port != "aws.iam.role.custom-inline-policy" || d.OwnerEdge.Configuration.SchemaID != "aws.iam.role-inline-policy.attachment" || d.OwnerEdge.Configuration.SchemaVersion != "1.0.0" || len(d.OwnerEdge.Configuration.Values) != 0 {
		reject(d.Resource.ID, "Secret policy requires the exact empty canonical role ownership binding.")
	}
	for _, external := range r.model.ExternalResources {
		for _, ref := range external.ArchitectureNodes {
			if ref.NodeID == d.Owner.ID {
				reject(d.Resource.ID, "External secret-reader role ownership requires a separate reviewed contract.")
			}
		}
	}
	for _, s := range d.Statements {
		intent := false
		for _, a := range s.Actions {
			if strings.HasPrefix(a, "secretsmanager:") {
				intent = true
			}
		}
		for _, scope := range s.Scopes {
			if scope.ServiceType == serviceSecret {
				intent = true
			}
		}
		ref, ok := s.Resource.Configuration.Values["resourceNode"]
		if ok && ref.Attribute == serviceSecret+".arn" {
			intent = true
		}
		if !intent {
			continue
		}
		if s.Resource.Lifecycle.Ownership != "user" || s.Resource.Parent == nil || s.Resource.Parent.NodeID != d.Resource.ID || s.Resource.Parent.RelationshipType != "aws.iam.policy-contains-statement" {
			reject(s.Resource.ID, "Secret statements require exact user-owned canonical membership.")
		}
		memberships, scopes := 0, 0
		for _, edge := range r.model.Connections {
			if edge.Source.NodeID != s.Resource.ID {
				continue
			}
			if edge.RelationshipType == "aws.iam.policy-contains-statement" {
				memberships++
				if edge.Target.NodeID != d.Resource.ID || edge.Source.Port != "aws.iam.policy-statement.policy-document" || edge.Target.Port != "aws.iam.policy-document.statement" || edge.Configuration.SchemaID != "aws.iam.policy-membership.connection" || edge.Configuration.SchemaVersion != "1.0.0" || len(edge.Configuration.Values) != 0 {
					reject(s.Resource.ID, "Secret statement membership binding is invalid.")
				}
			}
			if strings.HasPrefix(edge.RelationshipType, "aws.iam.authorizes-") {
				scopes++
			}
		}
		if memberships != 1 || scopes != 1 || len(s.Scopes) != 1 || s.Scopes[0].ServiceType != serviceSecret || !ok || ref.Kind != "node-reference" || ref.NodeID != s.Scopes[0].ID || ref.Attribute != serviceSecret+".arn" || len(s.Expressions) != 0 {
			reject(s.Resource.ID, "Secret permissions require one exact typed full secret ARN scope and no pasted or wildcard expression.")
		}
		if s.Effect != "allow" || s.PrincipalKind != "none" || len(s.Principals) != 0 || len(s.Conditions) != 0 || len(s.Actions) == 0 {
			reject(s.Resource.ID, "Secret access requires an unconditional explicit role allow without principals.")
		}
		for _, action := range s.Actions {
			if !secretActions[action] {
				reject(s.Resource.ID, "Only explicit GetSecretValue and DescribeSecret access is supported; writes and administration need separate review.")
			}
		}
	}
	return valid
}

func (r *terraformRenderer) renderSecret(secret NormalizedResource) {
	block := r.resourceBlock(secret)
	body := block.Body()
	body.SetAttributeValue("name", cty.StringVal(r.configString(secret, "name")))
	body.SetAttributeValue("description", cty.StringVal(r.configString(secret, "description")))
	body.SetAttributeValue("recovery_window_in_days", cty.NumberIntVal(int64(r.configInt(secret, "recoveryWindowDays"))))
	if key, ok := r.connectedResource(secret.ID, secretEncryptionRelationship, true); ok {
		body.SetAttributeRaw("kms_key_id", r.resourceAttributeTokens(key.ID, "arn"))
	}
	body.SetAttributeTraversal("tags", traversal("local", "tags"))
	lifecycle := hclwrite.NewBlock("lifecycle", nil)
	lifecycle.Body().SetAttributeValue("prevent_destroy", cty.BoolVal(true))
	body.AppendBlock(lifecycle)
	appendBlock(r.file("security.tf"), block)
	r.warning("SECRET_EXTERNAL_POPULATION_REQUIRED", "This export creates empty secret metadata. Populate its value externally before use; no runtime retrieval or rotation is generated.", SourceReference{Document: DocumentArchitecture, NodeID: secret.ID})
	if r.configString(secret, "encryptionMode") == "customer-managed" {
		r.warning("SECRET_KEY_AUTHORITY_REQUIRES_REVIEW", "KMS association grants no authority. Review GenerateDataKey/Decrypt for population and Decrypt for readers in the explicit key policy; live effective access is outside export proof.", SourceReference{Document: DocumentArchitecture, NodeID: secret.ID})
	}
}
func (r *cloudFormationRenderer) renderSecret(secret NormalizedResource) {
	properties := map[string]any{"Name": r.configString(secret, "name"), "Description": r.configString(secret, "description"), "Tags": r.tagList()}
	if key, _, ok := r.connectedWithEdge(secret.ID, secretEncryptionRelationship, true); ok {
		properties["KmsKeyId"] = r.resourceAttribute(key.ID, "arn")
	}
	r.addResource(r.logicalIDs[secret.ID], cloudFormationResource{Type: "AWS::SecretsManager::Secret", Properties: properties, DeletionPolicy: "Retain", UpdateReplacePolicy: "Retain", Metadata: r.resourceMetadata(secret)}, SourceReference{Document: DocumentArchitecture, NodeID: secret.ID})
	r.warning("SECRET_EXTERNAL_POPULATION_REQUIRED", "This export creates empty secret metadata. Populate its value externally before use; no runtime retrieval or rotation is generated. CloudFormation retains the secret rather than applying the Terraform recovery window.", SourceReference{Document: DocumentArchitecture, NodeID: secret.ID})
	if r.configString(secret, "encryptionMode") == "customer-managed" {
		r.warning("SECRET_KEY_AUTHORITY_REQUIRES_REVIEW", "KMS association grants no authority. Review GenerateDataKey/Decrypt for population and Decrypt for readers in the explicit key policy; live effective access is outside export proof.", SourceReference{Document: DocumentArchitecture, NodeID: secret.ID})
	}
}
