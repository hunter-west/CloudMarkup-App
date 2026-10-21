package compiler

import (
	"regexp"
	"sort"
	"strings"
	"unicode/utf16"

	"github.com/hashicorp/hcl/v2/hclwrite"
	"github.com/zclconf/go-cty/cty"
)

type terraformPolicyDocument struct {
	Resource   NormalizedResource
	Owner      NormalizedResource
	OwnerEdge  NormalizedConnection
	Kind       string
	Name       string
	Statements []terraformPolicyStatement
}

type terraformPolicyStatement struct {
	Resource      NormalizedResource
	Effect        string
	StatementID   string
	Actions       []string
	PrincipalKind string
	Principals    []string
	Expressions   []string
	Scopes        []NormalizedResource
	Conditions    []terraformPolicyCondition
}

type terraformPolicyCondition struct {
	Resource NormalizedResource
	Operator string
	Key      string
	Values   []string
}

func (renderer *terraformRenderer) renderPolicies() {
	documents := renderer.collectPolicyDocuments()
	for _, document := range documents {
		renderedAs := "data.aws_iam_policy_document." + renderer.resourceNames[document.Resource.ID]
		if document.Kind == "identity-inline" || document.Kind == "generated-permission" {
			renderedAs = "aws_iam_role_policy." + renderer.resourceNames[document.Resource.ID]
		} else if document.Kind == "service-grant" {
			renderedAs = "aws_lambda_permission." + renderer.resourceNames[document.Resource.ID]
		} else if document.Kind == "resource" {
			prefix, eventPolicy := map[string]string{
				"aws.s3.bucket":             "aws_s3_bucket_policy.",
				"aws.sqs.queue":             "aws_sqs_queue_policy.",
				"aws.sns.topic":             "aws_sns_topic_policy.",
				"aws.eventbridge.event-bus": "aws_cloudwatch_event_bus_policy.",
			}[document.Owner.ServiceType]
			if eventPolicy {
				renderedAs = prefix + renderer.resourceNames[document.Resource.ID]
			}
		}
		if document.Owner.ServiceType == serviceKmsKey {
			renderedAs = "aws_kms_key." + renderer.resourceNames[document.Owner.ID] + ".policy"
		}
		renderer.policyArtifacts = append(renderer.policyArtifacts, PolicyArtifactContract{
			PolicyDocumentID: document.Resource.ID, OwnerNodeID: document.Owner.ID, PolicyKind: document.Kind,
			Ownership: document.Resource.Lifecycle.Ownership, RenderedAs: renderedAs, Provenance: document.Resource.Lifecycle.Provenance,
		})
	}
	if renderer.hasErrors() {
		return
	}
	for _, document := range documents {
		if document.Kind == "service-grant" {
			continue
		}
		data := hclwrite.NewBlock("data", []string{"aws_iam_policy_document", renderer.resourceNames[document.Resource.ID]})
		for _, statement := range document.Statements {
			data.Body().AppendBlock(renderer.renderPolicyStatement(statement, document))
		}
		appendBlock(renderer.file("security.tf"), data)
	}

	for _, resource := range renderer.model.Resources {
		if resource.ServiceType != "aws.iam.role" {
			continue
		}
		if !renderer.shouldRenderResource(resource.ID) {
			renderer.prepareReferenceOnlyResource(resource)
			continue
		}
		renderer.renderIAMRole(resource, documents)
	}
	renderer.renderManagedPolicyAttachments(documents)
	renderer.renderLambdaPermissions(documents)
	renderer.renderEventResourcePolicies(documents)
	renderer.renderKmsKeys(documents)
}

func (renderer *terraformRenderer) collectPolicyDocuments() []terraformPolicyDocument {
	resources := make(map[string]NormalizedResource, len(renderer.model.Resources))
	roleNames := map[string]bool{}
	for _, resource := range renderer.model.Resources {
		resources[resource.ID] = resource
		renderer.validateIAMConfigurationLiterals(resource)
		if resource.ServiceType == "aws.iam.role" {
			value := resource.Configuration.Values["roleName"]
			if name, ok := value.Value.(string); value.Kind == "string" && ok && name != "" {
				key := strings.ToLower(name)
				if roleNames[key] {
					renderer.error("TARGET_IAM_ROLE_NAME_DUPLICATE", "IAM role names must be unique in the modeled AWS account, ignoring letter case. Rename one explicitly; export never rewrites names.", SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
				}
				roleNames[key] = true
			}
		}
	}
	documents := []terraformPolicyDocument{}
	for _, resource := range renderer.model.Resources {
		if resource.ServiceType != "aws.iam.policy-document" {
			continue
		}
		if !renderer.validateConfiguration(resource, "aws.iam.policy-document.configuration", []string{"policyKind", "policyName"}) {
			continue
		}
		ownerEdges := []NormalizedConnection{}
		for _, connection := range renderer.model.Connections {
			if connection.Source.NodeID != resource.ID {
				continue
			}
			switch connection.RelationshipType {
			case "aws.iam.role-owns-generated-permission", "aws.iam.role-owns-inline-policy", "aws.iam.role-owns-trust-policy",
				"aws.lambda.owns-invocation-permission", "aws.ec2.gateway-endpoint-owns-policy",
				"aws.s3.bucket-owns-resource-policy", "aws.sqs.queue-owns-resource-policy",
				"aws.sns.topic-owns-resource-policy", "aws.eventbridge.event-bus-owns-resource-policy", kmsPolicyOwnerRelationship:
				ownerEdges = append(ownerEdges, connection)
			}
		}
		if len(ownerEdges) != 1 {
			renderer.error("TARGET_POLICY_OWNER_INVALID", "IAM policy document must bind exactly one supported owner slot.", SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
			continue
		}
		owner, exists := resources[ownerEdges[0].Target.NodeID]
		if !exists {
			renderer.error("TARGET_POLICY_OWNER_INVALID", "IAM policy owner does not resolve.", SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
			continue
		}
		document := terraformPolicyDocument{
			Resource: resource, Owner: owner, OwnerEdge: ownerEdges[0],
			Kind: renderer.configString(resource, "policyKind"), Name: renderer.configString(resource, "policyName"),
			Statements: []terraformPolicyStatement{},
		}
		expectedKind := map[string]string{
			"aws.iam.role-owns-generated-permission":         "generated-permission",
			"aws.iam.role-owns-inline-policy":                "identity-inline",
			"aws.iam.role-owns-trust-policy":                 "trust",
			"aws.lambda.owns-invocation-permission":          "service-grant",
			"aws.ec2.gateway-endpoint-owns-policy":           "resource",
			"aws.s3.bucket-owns-resource-policy":             "resource",
			"aws.sqs.queue-owns-resource-policy":             "resource",
			"aws.sns.topic-owns-resource-policy":             "resource",
			"aws.eventbridge.event-bus-owns-resource-policy": "resource",
			kmsPolicyOwnerRelationship:                       "resource",
		}[document.OwnerEdge.RelationshipType]
		if document.Kind != expectedKind {
			renderer.error("TARGET_POLICY_KIND_OWNER_MISMATCH", "IAM policy kind does not match its canonical owned-configuration slot.", SourceReference{Document: DocumentArchitecture, NodeID: resource.ID, EdgeID: document.OwnerEdge.ID})
			continue
		}
		if (document.Kind == "generated-permission" || document.Kind == "service-grant" || (document.Kind == "resource" && resource.Lifecycle.Ownership == "generated")) && (resource.Lifecycle.Ownership != "generated" || resource.Lifecycle.Provenance == nil) {
			renderer.error("TARGET_POLICY_PROVENANCE_REQUIRED", "Generated policy requires immutable generated-resource provenance.", SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
			continue
		}
		if document.Kind == "identity-inline" && resource.Lifecycle.Ownership == "generated" {
			renderer.error("TARGET_CUSTOM_POLICY_OWNERSHIP_INVALID", "Custom inline policy cannot masquerade as a generated permission.", SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
			continue
		}
		for _, connection := range renderer.model.Connections {
			if connection.RelationshipType != "aws.iam.policy-contains-statement" || connection.Target.NodeID != resource.ID {
				continue
			}
			statementResource, exists := resources[connection.Source.NodeID]
			if !exists || statementResource.ServiceType != "aws.iam.policy-statement" {
				renderer.error("TARGET_POLICY_STATEMENT_INVALID", "IAM policy membership does not reference a statement.", SourceReference{Document: DocumentArchitecture, EdgeID: connection.ID})
				continue
			}
			statement, ok := renderer.collectPolicyStatement(statementResource, resources)
			if ok {
				document.Statements = append(document.Statements, statement)
			}
		}
		if len(document.Statements) == 0 {
			renderer.error("TARGET_POLICY_STATEMENTS_REQUIRED", "IAM policy document has no supported statements.", SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
			continue
		}
		if document.Kind == "resource" && resource.Lifecycle.Ownership != "user" && resource.Lifecycle.Ownership != "generated" {
			renderer.error("TARGET_RESOURCE_POLICY_OWNERSHIP_INVALID", "Resource policy must remain explicitly user-owned or provenance-bound generated content.", SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
			continue
		}
		if hasSecretIntent(document) && !renderer.validateSecretPolicy(document) {
			continue
		}
		if document.Owner.ServiceType != serviceKmsKey && hasKmsIntent(document) {
			renderer.error("TARGET_KMS_POLICY_OWNER_INVALID", "KMS actions and scope are supported only in their exact owning key policy.", SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
			continue
		}
		if document.Kind == "resource" {
			valid := true
			if document.Owner.ServiceType != serviceKmsKey {
				valid = renderer.validateEventResourcePolicyDocument(document)
			}
			if document.Owner.ServiceType == serviceGatewayVPCEndpoint {
				valid = resource.Lifecycle.Ownership == "user" && renderer.validateEndpointPolicyDocument(document)
			}
			if document.Owner.ServiceType == serviceKmsKey {
				valid = renderer.validateKmsPolicyDocument(document)
			}
			if !valid {
				continue
			}
		}
		sort.Slice(document.Statements, func(left int, right int) bool {
			return compareUTF16(document.Statements[left].Resource.TargetKey, document.Statements[right].Resource.TargetKey) < 0
		})
		documents = append(documents, document)
	}
	sort.Slice(documents, func(left int, right int) bool {
		return compareUTF16(documents[left].Resource.TargetKey, documents[right].Resource.TargetKey) < 0
	})
	renderer.validateRelationshipPolicyCoverage(documents)
	return documents
}

var iamNamePattern = regexp.MustCompile(`^[A-Za-z0-9+=,.@_-]+$`)
var iamStatementIDPattern = regexp.MustCompile(`^[A-Za-z0-9]+$`)
var iamConditionKeyPattern = regexp.MustCompile(`^[A-Za-z0-9:/._-]+$`)
var iamManagedReferencePattern = regexp.MustCompile(`^(aws-managed|approved-variable):[A-Za-z0-9_./${}-]+$`)

// Validate the pinned catalog's closed literal contract before either target
// consumes IAM values. Scope, principals and generated provenance retain their
// separate semantic checks below; no declaration is normalized or repaired.
func (renderer *terraformRenderer) validateIAMConfigurationLiterals(resource NormalizedResource) {
	if !renderer.isCurrentCatalog() {
		return
	}
	version := "1.0.0"
	var keys []string
	switch resource.ServiceType {
	case "aws.iam.role":
		version, keys = "2.0.0", []string{"maxSessionDurationSeconds", "roleName"}
	case "aws.iam.policy-document":
		keys = []string{"policyKind", "policyName"}
	case "aws.iam.policy-statement":
		version, keys = "2.0.0", []string{"actions", "effect", "principalKind", "principals", "resourceExpressions", "statementId"}
		if _, exists := resource.Configuration.Values["resourceNode"]; exists {
			keys = append(keys, "resourceNode")
		}
	case "aws.iam.policy-condition":
		keys = []string{"key", "operator", "values"}
	case "aws.iam.managed-policy-attachment":
		keys = []string{"attachmentKind", "displayName", "managedPolicyReference"}
	default:
		return
	}
	if !renderer.validateConfigurationVersion(resource, resource.ServiceType+".configuration", version, keys) {
		return
	}
	for _, key := range keys {
		if !iamConfigurationValueValid(resource.Configuration.Values[key], key) {
			renderer.error("TARGET_IAM_CONFIGURATION_VALUE_INVALID", "IAM field "+key+" must satisfy its exact catalog literal type, format, range and uniqueness constraints.", SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
		}
	}
}

func iamConfigurationValueValid(value ConfigurationValue, key string) bool {
	if key == "maxSessionDurationSeconds" {
		literal, ok := value.Value.(float64)
		return value.Kind == "integer" && ok && literal == 3600
	}
	if key == "actions" || key == "principals" || key == "resourceExpressions" || key == "values" {
		items, ok := value.Value.([]any)
		minimum, maximum := 0, 32
		if key == "actions" {
			minimum, maximum = 1, 64
		}
		if key == "values" {
			minimum = 1
		}
		if value.Kind != "string-list" || !ok || len(items) < minimum || len(items) > maximum {
			return false
		}
		seen := map[string]bool{}
		for _, item := range items {
			literal, ok := item.(string)
			if !ok || seen[literal] {
				return false
			}
			seen[literal] = true
		}
		return true
	}
	if key == "resourceNode" && value.Kind == "node-reference" {
		return value.NodeID != ""
	}
	literal, ok := value.Value.(string)
	if value.Kind != "string" || !ok {
		return false
	}
	length := len(utf16.Encode([]rune(literal)))
	switch key {
	case "roleName":
		return length >= 1 && length <= 64 && iamNamePattern.MatchString(literal)
	case "policyName":
		return length >= 1 && length <= 128 && iamNamePattern.MatchString(literal)
	case "statementId":
		return length >= 1 && length <= 128 && iamStatementIDPattern.MatchString(literal)
	case "key":
		return length >= 3 && length <= 256 && iamConditionKeyPattern.MatchString(literal)
	case "displayName":
		return length >= 1 && length <= 128
	case "managedPolicyReference":
		return length >= 5 && length <= 512 && iamManagedReferencePattern.MatchString(literal)
	case "resourceNode":
		return length >= 1 && length <= 256
	case "effect":
		return literal == "allow" || literal == "deny"
	case "attachmentKind":
		return literal == "managed-policy-attachment" || literal == "permissions-boundary"
	case "policyKind":
		return literal == "identity-inline" || literal == "trust" || literal == "resource" || literal == "generated-permission" || literal == "service-grant"
	case "principalKind":
		return literal == "none" || literal == "service" || literal == "architecture-node" || literal == "provider-identity" || literal == "federated" || literal == "all-principals"
	case "operator":
		return literal == "ArnEquals" || literal == "ArnLike" || literal == "Bool" || literal == "IpAddress" || literal == "NumericEquals" || literal == "StringEquals" || literal == "StringLike"
	default:
		return false
	}
}

func (renderer *terraformRenderer) collectPolicyStatement(resource NormalizedResource, resources map[string]NormalizedResource) (terraformPolicyStatement, bool) {
	keys := []string{"actions", "effect", "principalKind", "principals", "resourceExpressions", "statementId"}
	if _, exists := resource.Configuration.Values["resourceNode"]; exists {
		keys = append(keys, "resourceNode")
	}
	schemaVersion := "1.0.0"
	if renderer.isCurrentCatalog() {
		schemaVersion = "2.0.0"
	}
	if !renderer.validateNetworkConfiguration(resource, "aws.iam.policy-statement.configuration", schemaVersion, keys) {
		return terraformPolicyStatement{}, false
	}
	statement := terraformPolicyStatement{
		Resource: resource, Effect: renderer.configString(resource, "effect"), StatementID: renderer.configString(resource, "statementId"),
		Actions: renderer.configStringList(resource, "actions"), PrincipalKind: renderer.configString(resource, "principalKind"),
		Principals: renderer.configStringList(resource, "principals"), Expressions: renderer.configStringList(resource, "resourceExpressions"),
		Scopes: []NormalizedResource{}, Conditions: []terraformPolicyCondition{},
	}
	for _, action := range statement.Actions {
		if !renderer.supportedPolicyAction(action) {
			renderer.error("TARGET_POLICY_ACTION_UNSUPPORTED", "IAM action is outside the reviewed compiler action set.", SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
			return terraformPolicyStatement{}, false
		}
	}
	for _, expression := range statement.Expressions {
		if strings.ContainsAny(expression, "*?") || !strings.HasPrefix(expression, "arn:") {
			renderer.error("TARGET_POLICY_RESOURCE_EXPRESSION_UNSUPPORTED", "IAM resource expression must be one exact non-wildcard ARN.", SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
			return terraformPolicyStatement{}, false
		}
	}
	for _, connection := range renderer.model.Connections {
		if connection.Source.NodeID != resource.ID {
			continue
		}
		switch connection.RelationshipType {
		case "aws.iam.authorizes-dynamodb-table", "aws.iam.authorizes-lambda-function", "aws.iam.authorizes-log-group",
			"aws.iam.authorizes-s3-bucket", "aws.iam.authorizes-sqs-queue",
			"aws.iam.authorizes-sns-topic", "aws.iam.authorizes-eventbridge-bus",
			"aws.iam.authorizes-step-functions-state-machine", kmsPolicyScopeRelationship, secretScopeRelationship:
			if target, exists := resources[connection.Target.NodeID]; exists {
				if target.ServiceType == "aws.s3.bucket" || connection.RelationshipType == "aws.iam.authorizes-s3-bucket" {
					if target.ServiceType != "aws.s3.bucket" || target.ResourceType != "aws.s3.bucket" || connection.RelationshipType != "aws.iam.authorizes-s3-bucket" ||
						connection.Source.Port != "aws.iam.policy-statement.s3-resource" || connection.Target.Port != "aws.s3.bucket.policy-resource" ||
						connection.Configuration.SchemaID != "aws.iam.policy-statement-authorizes-s3-bucket.connection" || connection.Configuration.SchemaVersion != "1.0.0" || len(connection.Configuration.Values) != 0 {
						renderer.error("TARGET_POLICY_S3_SCOPE_INVALID", "S3 policy scope must retain its exact typed bucket authorization binding.", SourceReference{Document: DocumentArchitecture, NodeID: resource.ID, EdgeID: connection.ID})
						return terraformPolicyStatement{}, false
					}
				}
				statement.Scopes = append(statement.Scopes, target)
			}
		}
		if connection.RelationshipType == "aws.iam.statement-owns-condition" {
			conditionResource, exists := resources[connection.Source.NodeID]
			if !exists || conditionResource.ServiceType != "aws.iam.policy-condition" {
				continue
			}
		}
	}
	for _, scope := range statement.Scopes {
		if scope.ServiceType != "aws.s3.bucket" {
			continue
		}
		if reference, exists := resource.Configuration.Values["resourceNode"]; exists &&
			(reference.Kind != "node-reference" || reference.NodeID != scope.ID || reference.Attribute != "aws.s3.bucket.arn" || len(statement.Scopes) != 1) {
			renderer.error("TARGET_POLICY_S3_SCOPE_INVALID", "S3 policy resource reference must match its one exact bucket authorization binding.", SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
			return terraformPolicyStatement{}, false
		}
	}
	// Condition membership is condition -> statement, unlike resource scope.
	for _, connection := range renderer.model.Connections {
		if connection.RelationshipType != "aws.iam.statement-owns-condition" || connection.Target.NodeID != resource.ID {
			continue
		}
		conditionResource, exists := resources[connection.Source.NodeID]
		if !exists || !renderer.validateConfiguration(conditionResource, "aws.iam.policy-condition.configuration", []string{"key", "operator", "values"}) {
			continue
		}
		statement.Conditions = append(statement.Conditions, terraformPolicyCondition{
			Resource: conditionResource, Operator: renderer.configString(conditionResource, "operator"),
			Key: renderer.configString(conditionResource, "key"), Values: renderer.configStringList(conditionResource, "values"),
		})
	}
	sort.Slice(statement.Scopes, func(left int, right int) bool {
		return compareUTF16(statement.Scopes[left].TargetKey, statement.Scopes[right].TargetKey) < 0
	})
	sort.Slice(statement.Conditions, func(left int, right int) bool {
		return compareUTF16(statement.Conditions[left].Resource.TargetKey, statement.Conditions[right].Resource.TargetKey) < 0
	})
	return statement, true
}

func (renderer *terraformRenderer) renderPolicyStatement(statement terraformPolicyStatement, document terraformPolicyDocument) *hclwrite.Block {
	policyKind := document.Kind
	block := hclwrite.NewBlock("statement", nil)
	body := block.Body()
	body.SetAttributeValue("sid", cty.StringVal(statementID(statement.StatementID)))
	effect := "Allow"
	if statement.Effect == "deny" {
		effect = "Deny"
	}
	body.SetAttributeValue("effect", cty.StringVal(effect))
	actions := make([]cty.Value, len(statement.Actions))
	for index, action := range statement.Actions {
		actions[index] = cty.StringVal(action)
	}
	body.SetAttributeValue("actions", cty.ListVal(actions))

	resourceTokens := []hclwrite.Tokens{}
	for _, scope := range statement.Scopes {
		attribute := "arn"
		if scope.ServiceType == serviceKmsKey && document.Owner.ID == scope.ID && document.OwnerEdge.RelationshipType == kmsPolicyOwnerRelationship {
			resourceTokens = append(resourceTokens, hclwrite.TokensForValue(cty.StringVal("*")))
		} else if scope.ServiceType == "aws.cloudwatch.log-group" {
			resourceTokens = append(resourceTokens, formatTokens("%s:*", renderer.resourceAttributeTokens(scope.ID, attribute)))
		} else if scope.ServiceType == "aws.s3.bucket" {
			bucket, objects := s3PolicyResourceKinds(statement.Actions)
			if bucket {
				resourceTokens = append(resourceTokens, renderer.resourceAttributeTokens(scope.ID, attribute))
			}
			if objects {
				resourceTokens = append(resourceTokens, formatTokens("%s/*", renderer.resourceAttributeTokens(scope.ID, attribute)))
			}
		} else {
			resourceTokens = append(resourceTokens, renderer.resourceAttributeTokens(scope.ID, attribute))
		}
	}
	for _, expression := range statement.Expressions {
		resourceTokens = append(resourceTokens, hclwrite.TokensForValue(cty.StringVal(expression)))
	}
	if policyKind != "trust" && len(resourceTokens) == 0 {
		renderer.error("TARGET_POLICY_RESOURCE_REQUIRED", "Non-trust IAM statement requires exact resource scope.", SourceReference{Document: DocumentArchitecture, NodeID: statement.Resource.ID})
	} else if len(resourceTokens) > 0 {
		body.SetAttributeRaw("resources", tupleTokens(resourceTokens...))
	}

	if statement.PrincipalKind != "none" {
		principalType := map[string]string{"service": "Service", "architecture-node": "AWS", "provider-identity": "AWS", "federated": "Federated", "all-principals": "*"}[statement.PrincipalKind]
		if principalType == "" || (statement.PrincipalKind == "all-principals" && policyKind != "resource") {
			renderer.error("TARGET_POLICY_PRINCIPAL_UNSUPPORTED", "IAM principal kind is unsupported or overly broad.", SourceReference{Document: DocumentArchitecture, NodeID: statement.Resource.ID})
		} else {
			identifiers := []hclwrite.Tokens{}
			for _, principal := range statement.Principals {
				if statement.PrincipalKind == "architecture-node" {
					identifiers = append(identifiers, renderer.resourceAttributeTokens(principal, "arn"))
				} else {
					if statement.PrincipalKind != "all-principals" && strings.ContainsAny(principal, "*?") {
						renderer.error("TARGET_POLICY_PRINCIPAL_UNSUPPORTED", "IAM principal cannot contain a wildcard.", SourceReference{Document: DocumentArchitecture, NodeID: statement.Resource.ID})
						continue
					}
					identifiers = append(identifiers, hclwrite.TokensForValue(cty.StringVal(principal)))
				}
			}
			principal := hclwrite.NewBlock("principals", nil)
			principal.Body().SetAttributeValue("type", cty.StringVal(principalType))
			principal.Body().SetAttributeRaw("identifiers", tupleTokens(identifiers...))
			body.AppendBlock(principal)
		}
	}
	for _, condition := range statement.Conditions {
		block := hclwrite.NewBlock("condition", nil)
		block.Body().SetAttributeValue("test", cty.StringVal(condition.Operator))
		block.Body().SetAttributeValue("variable", cty.StringVal(condition.Key))
		values := make([]cty.Value, len(condition.Values))
		for index, value := range condition.Values {
			values[index] = cty.StringVal(value)
		}
		block.Body().SetAttributeValue("values", cty.ListVal(values))
		body.AppendBlock(block)
	}
	if sourceArnID := renderer.generatedPolicySourceArnID(document, statement); sourceArnID != "" {
		condition := hclwrite.NewBlock("condition", nil)
		operator := "ArnEquals"
		if cloudfrontGeneratedPolicy(document) {
			operator = "StringEquals"
		}
		condition.Body().SetAttributeValue("test", cty.StringVal(operator))
		condition.Body().SetAttributeValue("variable", cty.StringVal("AWS:SourceArn"))
		condition.Body().SetAttributeRaw("values", tupleTokens(renderer.resourceAttributeTokens(sourceArnID, "arn")))
		body.AppendBlock(condition)
	}
	return block
}

func (renderer *terraformRenderer) generatedPolicySourceArnID(document terraformPolicyDocument, statement terraformPolicyStatement) string {
	if document.Resource.Lifecycle.Provenance == nil || document.Kind != "resource" {
		return ""
	}
	for _, edgeID := range document.Resource.Lifecycle.Provenance.DependentEdgeIDs {
		for _, connection := range renderer.model.Connections {
			if connection.ID != edgeID {
				continue
			}
			expected, supported := renderer.expectedGeneratedPolicy(connection)
			if supported && expected.SourceArnID != "" && generatedStatementMatches(document, statement, expected) {
				return expected.SourceArnID
			}
		}
	}
	return ""
}

func (renderer *terraformRenderer) renderIAMRole(role NormalizedResource, documents []terraformPolicyDocument) {
	if !renderer.validateConfigurationVersion(role, "aws.iam.role.configuration", "2.0.0", []string{"maxSessionDurationSeconds", "roleName"}) {
		return
	}
	trust := []terraformPolicyDocument{}
	for _, document := range documents {
		if document.Owner.ID == role.ID && document.Kind == "trust" {
			trust = append(trust, document)
		}
	}
	if len(trust) != 1 {
		renderer.error("TARGET_ROLE_TRUST_POLICY_REQUIRED", "IAM role requires exactly one canonical trust policy.", SourceReference{Document: DocumentArchitecture, NodeID: role.ID})
		return
	}
	block := renderer.resourceBlock(role)
	body := block.Body()
	body.SetAttributeValue("name", cty.StringVal(renderer.configString(role, "roleName")))
	body.SetAttributeValue("description", cty.StringVal(ec2RoleDescription(renderer.model, role.ID)))
	body.SetAttributeValue("max_session_duration", cty.NumberIntVal(int64(renderer.configInt(role, "maxSessionDurationSeconds"))))
	body.SetAttributeTraversal("assume_role_policy", traversal("data", "aws_iam_policy_document", renderer.resourceNames[trust[0].Resource.ID], "json"))
	boundaries := renderer.managedAttachmentsForRole(role.ID, "permissions-boundary")
	if len(boundaries) > 1 {
		renderer.error("TARGET_PERMISSIONS_BOUNDARY_AMBIGUOUS", "IAM role has more than one permissions boundary.", SourceReference{Document: DocumentArchitecture, NodeID: role.ID})
		return
	}
	if len(boundaries) == 1 {
		body.SetAttributeRaw("permissions_boundary", renderer.managedPolicyReferenceTokens(boundaries[0]))
	}
	body.SetAttributeTraversal("tags", traversal("local", "tags"))
	appendBlock(renderer.file("identity.tf"), block)

	for _, document := range documents {
		if document.Owner.ID != role.ID || (document.Kind != "identity-inline" && document.Kind != "generated-permission") {
			continue
		}
		policy := hclwrite.NewBlock("resource", []string{"aws_iam_role_policy", renderer.resourceNames[document.Resource.ID]})
		policy.Body().SetAttributeValue("name", cty.StringVal(document.Name))
		policy.Body().SetAttributeRaw("role", renderer.resourceAttributeTokens(role.ID, "name"))
		policy.Body().SetAttributeTraversal("policy", traversal("data", "aws_iam_policy_document", renderer.resourceNames[document.Resource.ID], "json"))
		appendBlock(renderer.file("security.tf"), policy)
	}
}

func (renderer *terraformRenderer) renderManagedPolicyAttachments(documents []terraformPolicyDocument) {
	attachments := []NormalizedResource{}
	managedReferenceCount := 0
	for _, resource := range renderer.model.Resources {
		if resource.ServiceType != "aws.iam.managed-policy-attachment" {
			continue
		}
		managedReferenceCount++
		if renderer.attachmentKind(resource) == "managed-policy-attachment" {
			attachments = append(attachments, resource)
		}
	}
	if managedReferenceCount == 0 {
		return
	}
	partition := hclwrite.NewBlock("data", []string{"aws_partition", "current"})
	appendBlock(renderer.file("security.tf"), partition)
	for _, attachment := range attachments {
		role, ok := renderer.connectedResource(attachment.ID, "aws.iam.role-owns-managed-policy-attachment", false)
		if !ok {
			renderer.error("TARGET_MANAGED_POLICY_OWNER_REQUIRED", "Managed-policy attachment requires one IAM role owner.", SourceReference{Document: DocumentArchitecture, NodeID: attachment.ID})
			continue
		}
		block := hclwrite.NewBlock("resource", []string{"aws_iam_role_policy_attachment", renderer.resourceNames[attachment.ID]})
		block.Body().SetAttributeRaw("role", renderer.resourceAttributeTokens(role.ID, "name"))
		block.Body().SetAttributeRaw("policy_arn", renderer.managedPolicyReferenceTokens(attachment))
		appendBlock(renderer.file("security.tf"), block)
	}
}

func (renderer *terraformRenderer) managedAttachmentsForRole(roleID string, kind string) []NormalizedResource {
	result := []NormalizedResource{}
	relationship := "aws.iam.role-owns-managed-policy-attachment"
	if kind == "permissions-boundary" {
		relationship = "aws.iam.role-owns-permissions-boundary"
	}
	for _, connection := range renderer.model.Connections {
		if connection.RelationshipType != relationship || connection.Target.NodeID != roleID {
			continue
		}
		resource, ok := renderer.resourceByID(connection.Source.NodeID)
		if ok && renderer.attachmentKind(resource) == kind {
			result = append(result, resource)
		}
	}
	sort.Slice(result, func(left int, right int) bool {
		return compareUTF16(result[left].TargetKey, result[right].TargetKey) < 0
	})
	return result
}

func (renderer *terraformRenderer) attachmentKind(resource NormalizedResource) string {
	if !renderer.validateConfiguration(resource, "aws.iam.managed-policy-attachment.configuration", []string{"attachmentKind", "displayName", "managedPolicyReference"}) {
		return ""
	}
	return renderer.configString(resource, "attachmentKind")
}

func (renderer *terraformRenderer) managedPolicyReferenceTokens(resource NormalizedResource) hclwrite.Tokens {
	reference := renderer.configString(resource, "managedPolicyReference")
	if strings.HasPrefix(reference, "aws-managed:") {
		name := strings.TrimPrefix(reference, "aws-managed:")
		return formatTokens("arn:%s:iam::aws:policy/%s", hclwrite.TokensForTraversal(traversal("data", "aws_partition", "current", "partition")), hclwrite.TokensForValue(cty.StringVal(name)))
	}
	if strings.HasPrefix(reference, "approved-variable:") {
		name := renderer.resourceNames[resource.ID] + "_managed_policy_arn"
		renderer.addVariable(terraformVariable{Name: name, Type: "string", Required: true, Description: "Approved managed-policy ARN reference."})
		return hclwrite.TokensForTraversal(traversal("var", name))
	}
	renderer.error("TARGET_MANAGED_POLICY_REFERENCE_UNSUPPORTED", "Managed-policy reference kind is unsupported.", SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
	return hclwrite.TokensForValue(cty.StringVal("INVALID_POLICY_ARN"))
}

func (renderer *terraformRenderer) renderLambdaPermissions(documents []terraformPolicyDocument) {
	statementIDsByFunction := map[string]SourceReference{}
	for _, document := range documents {
		if document.Kind != "service-grant" || document.Owner.ServiceType != "aws.lambda.function" {
			continue
		}
		if len(document.Statements) != 1 {
			renderer.error("TARGET_LAMBDA_PERMISSION_INVALID", "Lambda service grant must contain exactly one statement.", SourceReference{Document: DocumentArchitecture, NodeID: document.Resource.ID})
			continue
		}
		statement := document.Statements[0]
		connection, ok := renderer.permissionSourceConnection(document)
		if !ok {
			renderer.error("TARGET_LAMBDA_PERMISSION_PROVENANCE_REQUIRED", "Lambda service grant must retain one exact supported trigger provenance edge.", SourceReference{Document: DocumentArchitecture, NodeID: document.Resource.ID})
			continue
		}
		expected, supported := renderer.expectedGeneratedPolicy(connection)
		if !supported || expected.Kind != "service-grant" || !generatedStatementMatches(document, statement, expected) {
			renderer.error("TARGET_LAMBDA_PERMISSION_INVALID", "Lambda invocation permission does not match the exact typed trigger effect.", SourceReference{Document: DocumentArchitecture, NodeID: document.Resource.ID})
			continue
		}
		// Terraform declares literal SIDs; CloudFormation's distinct permission
		// resources do not expose this property and keep their separate renderer.
		renderedSID := statementID(statement.StatementID)
		key := document.Owner.ID + "\x00" + renderedSID
		source := SourceReference{Document: DocumentArchitecture, NodeID: document.Resource.ID}
		if previous, duplicate := statementIDsByFunction[key]; duplicate {
			before := len(renderer.diagnostics)
			renderer.error("TARGET_LAMBDA_PERMISSION_SID_DUPLICATE", "Invocation grants for one Lambda must declare distinct statement IDs. Review the referenced owner and conflicting grants through an authorized graph change; export never rewrites permissions or expands trigger support.", source)
			if len(renderer.diagnostics) > before {
				renderer.diagnostics[len(renderer.diagnostics)-1].Related = []SourceReference{previous, {Document: DocumentArchitecture, NodeID: document.Owner.ID}}
			}
			continue
		}
		statementIDsByFunction[key] = source
		block := hclwrite.NewBlock("resource", []string{"aws_lambda_permission", renderer.resourceNames[document.Resource.ID]})
		block.Body().SetAttributeValue("statement_id", cty.StringVal(renderedSID))
		block.Body().SetAttributeValue("action", cty.StringVal("lambda:InvokeFunction"))
		block.Body().SetAttributeRaw("function_name", renderer.resourceAttributeTokens(document.Owner.ID, "name"))
		block.Body().SetAttributeValue("principal", cty.StringVal(expected.Principal))
		if connection.RelationshipType == "aws.apigateway.integrates-lambda" {
			routeKey := renderer.connectionString(connection, "routeKey")
			block.Body().SetAttributeRaw("source_arn", formatTokens("%s/"+routeSourceSuffix(routeKey), renderer.resourceAttributeTokens(connection.Source.NodeID, "executionArn")))
		} else if expected.SourceArnID != "" {
			block.Body().SetAttributeRaw("source_arn", renderer.resourceAttributeTokens(expected.SourceArnID, "arn"))
		}
		if connection.RelationshipType == "aws.s3.notifies-lambda" {
			identityName := renderer.resourceNames[document.Resource.ID]
			identity := hclwrite.NewBlock("data", []string{"aws_caller_identity", identityName})
			appendBlock(renderer.file("security.tf"), identity)
			block.Body().SetAttributeTraversal("source_account", traversal("data", "aws_caller_identity", identityName, "account_id"))
		}
		appendBlock(renderer.file("security.tf"), block)
	}
}

func (renderer *terraformRenderer) permissionSourceConnection(document terraformPolicyDocument) (NormalizedConnection, bool) {
	if document.Resource.Lifecycle.Provenance == nil {
		return NormalizedConnection{}, false
	}
	matches := []NormalizedConnection{}
	for _, edgeID := range document.Resource.Lifecycle.Provenance.DependentEdgeIDs {
		for _, connection := range renderer.model.Connections {
			if connection.ID != edgeID {
				continue
			}
			expected, supported := renderer.expectedGeneratedPolicy(connection)
			if supported && expected.Kind == "service-grant" && expected.OwnerID == document.Owner.ID {
				matches = append(matches, connection)
			}
		}
	}
	return firstConnection(matches)
}

func firstConnection(values []NormalizedConnection) (NormalizedConnection, bool) {
	if len(values) != 1 {
		return NormalizedConnection{}, false
	}
	return values[0], true
}

func (renderer *terraformRenderer) validateRelationshipPolicyCoverage(documents []terraformPolicyDocument) {
	for _, connection := range renderer.model.Connections {
		expected, supported := renderer.expectedGeneratedPolicy(connection)
		if !supported {
			continue
		}
		matched := false
		for _, document := range documents {
			if document.Resource.Lifecycle.Provenance == nil || !containsString(document.Resource.Lifecycle.Provenance.DependentEdgeIDs, connection.ID) {
				continue
			}
			for _, statement := range document.Statements {
				matched = matched || generatedStatementMatches(document, statement, expected)
			}
		}
		if !matched {
			renderer.error("TARGET_GENERATED_POLICY_COVERAGE_MISSING", "Supported relationship is missing its exact generated IAM policy and source-edge provenance.", SourceReference{Document: DocumentArchitecture, EdgeID: connection.ID})
		}
	}
	renderer.validateGeneratedPolicyProvenance(documents)
}

type expectedGeneratedPolicy struct {
	AllowOwnerScope bool
	OwnerID         string
	Kind            string
	Actions         []string
	ScopeID         string
	Principal       string
	SourceArnID     string
}

func (renderer *terraformRenderer) expectedGeneratedPolicy(connection NormalizedConnection) (expectedGeneratedPolicy, bool) {
	switch connection.RelationshipType {
	case "aws.iam.role-assumed-by-lambda":
		return expectedGeneratedPolicy{OwnerID: connection.Source.NodeID, Kind: "trust", Actions: []string{"sts:AssumeRole"}, Principal: "lambda.amazonaws.com"}, true
	case "aws.lambda.reads-dynamodb-table":
		return expectedGeneratedPolicy{OwnerID: renderer.lambdaRoleID(connection.Source.NodeID), Kind: "generated-permission", Actions: []string{"dynamodb:GetItem", "dynamodb:Query"}, ScopeID: connection.Target.NodeID}, true
	case "aws.lambda.writes-dynamodb-table":
		return expectedGeneratedPolicy{OwnerID: renderer.lambdaRoleID(connection.Source.NodeID), Kind: "generated-permission", Actions: []string{"dynamodb:DeleteItem", "dynamodb:PutItem", "dynamodb:UpdateItem"}, ScopeID: connection.Target.NodeID}, true
	case cloudfrontOrigin:
		if !isCurrentAwsCatalog(renderer.model.Provenance.Catalog) {
			return expectedGeneratedPolicy{}, false
		}
		return expectedGeneratedPolicy{OwnerID: connection.Target.NodeID, Kind: "resource", Actions: []string{"s3:GetObject"}, ScopeID: connection.Target.NodeID, Principal: "cloudfront.amazonaws.com", SourceArnID: connection.Source.NodeID}, true
	case "aws.lambda.reads-s3-bucket":
		return expectedGeneratedPolicy{OwnerID: renderer.lambdaRoleID(connection.Source.NodeID), Kind: "generated-permission", Actions: []string{"s3:GetObject"}, ScopeID: connection.Target.NodeID}, isCurrentAwsCatalog(renderer.model.Provenance.Catalog)
	case "aws.lambda.writes-s3-bucket":
		return expectedGeneratedPolicy{OwnerID: renderer.lambdaRoleID(connection.Source.NodeID), Kind: "generated-permission", Actions: []string{"s3:PutObject"}, ScopeID: connection.Target.NodeID}, isCurrentAwsCatalog(renderer.model.Provenance.Catalog)
	case "aws.lambda.writes-log-group":
		return expectedGeneratedPolicy{OwnerID: renderer.lambdaRoleID(connection.Source.NodeID), Kind: "generated-permission", Actions: []string{"logs:CreateLogStream", "logs:PutLogEvents"}, ScopeID: connection.Target.NodeID}, true
	case "aws.apigateway.integrates-lambda":
		return expectedGeneratedPolicy{OwnerID: connection.Target.NodeID, Kind: "service-grant", Actions: []string{"lambda:InvokeFunction"}, Principal: "apigateway.amazonaws.com", AllowOwnerScope: isCurrentAwsCatalog(renderer.model.Provenance.Catalog) || renderer.model.Provenance.Catalog == (CatalogReference{ID: CloudFormationCatalogID, Version: CurrentAwsCatalogVersion, Digest: CurrentAwsCatalogDigest})}, true
	case "aws.iam.role-assumed-by-step-functions":
		return expectedGeneratedPolicy{OwnerID: connection.Source.NodeID, Kind: "trust", Actions: []string{"sts:AssumeRole"}, Principal: "states.amazonaws.com"}, true
	case "aws.iam.role-assumed-by-eventbridge-target":
		return expectedGeneratedPolicy{OwnerID: connection.Source.NodeID, Kind: "trust", Actions: []string{"sts:AssumeRole"}, Principal: "events.amazonaws.com"}, true
	case "aws.lambda.sends-message-to-sqs", "aws.lambda.uses-sqs-dead-letter-queue":
		return expectedGeneratedPolicy{OwnerID: renderer.lambdaRoleID(connection.Source.NodeID), Kind: "generated-permission", Actions: []string{"sqs:SendMessage"}, ScopeID: connection.Target.NodeID}, true
	case "aws.sqs.triggers-lambda":
		return expectedGeneratedPolicy{OwnerID: renderer.lambdaRoleID(connection.Target.NodeID), Kind: "generated-permission", Actions: []string{"sqs:DeleteMessage", "sqs:GetQueueAttributes", "sqs:ReceiveMessage"}, ScopeID: connection.Source.NodeID}, true
	case "aws.lambda.publishes-to-sns":
		return expectedGeneratedPolicy{OwnerID: renderer.lambdaRoleID(connection.Source.NodeID), Kind: "generated-permission", Actions: []string{"sns:Publish"}, ScopeID: connection.Target.NodeID}, true
	case "aws.lambda.puts-events-on-eventbridge":
		return expectedGeneratedPolicy{OwnerID: renderer.lambdaRoleID(connection.Source.NodeID), Kind: "generated-permission", Actions: []string{"events:PutEvents"}, ScopeID: connection.Target.NodeID}, true
	case "aws.lambda.starts-step-functions-state-machine":
		return expectedGeneratedPolicy{OwnerID: renderer.lambdaRoleID(connection.Source.NodeID), Kind: "generated-permission", Actions: []string{"states:StartExecution"}, ScopeID: connection.Target.NodeID}, true
	case "aws.stepfunctions.state-machine-invokes-lambda":
		return expectedGeneratedPolicy{OwnerID: renderer.eventRoleID(connection.Source.NodeID, "aws.iam.role-assumed-by-step-functions"), Kind: "generated-permission", Actions: []string{"lambda:InvokeFunction"}, ScopeID: connection.Target.NodeID}, true
	case "aws.eventbridge.target-starts-state-machine":
		return expectedGeneratedPolicy{OwnerID: renderer.eventRoleID(connection.Source.NodeID, "aws.iam.role-assumed-by-eventbridge-target"), Kind: "generated-permission", Actions: []string{"states:StartExecution"}, ScopeID: connection.Target.NodeID}, true
	case "aws.s3.notifies-lambda":
		return expectedGeneratedPolicy{OwnerID: connection.Target.NodeID, Kind: "service-grant", Actions: []string{"lambda:InvokeFunction"}, Principal: "s3.amazonaws.com", SourceArnID: connection.Source.NodeID, AllowOwnerScope: isCurrentAwsCatalog(renderer.model.Provenance.Catalog)}, true
	case "aws.sns.subscription-invokes-lambda":
		topic, _ := renderer.connectedResource(connection.Source.NodeID, "aws.sns.topic-owns-subscription", true)
		return expectedGeneratedPolicy{OwnerID: connection.Target.NodeID, Kind: "service-grant", Actions: []string{"lambda:InvokeFunction"}, Principal: "sns.amazonaws.com", SourceArnID: topic.ID, AllowOwnerScope: isCurrentAwsCatalog(renderer.model.Provenance.Catalog)}, true
	case "aws.eventbridge.target-invokes-lambda":
		rule, _ := renderer.connectedResource(connection.Source.NodeID, "aws.eventbridge.rule-owns-target", true)
		return expectedGeneratedPolicy{OwnerID: connection.Target.NodeID, Kind: "service-grant", Actions: []string{"lambda:InvokeFunction"}, Principal: "events.amazonaws.com", SourceArnID: rule.ID, AllowOwnerScope: isCurrentAwsCatalog(renderer.model.Provenance.Catalog)}, true
	case "aws.sns.subscription-sends-to-sqs":
		topic, _ := renderer.connectedResource(connection.Source.NodeID, "aws.sns.topic-owns-subscription", true)
		return expectedGeneratedPolicy{OwnerID: connection.Target.NodeID, Kind: "resource", Actions: []string{"sqs:SendMessage"}, ScopeID: connection.Target.NodeID, Principal: "sns.amazonaws.com", SourceArnID: topic.ID}, true
	case "aws.eventbridge.target-sends-to-sqs", "aws.eventbridge.target-publishes-to-sns", "aws.eventbridge.target-uses-dead-letter-queue":
		rule, _ := renderer.connectedResource(connection.Source.NodeID, "aws.eventbridge.rule-owns-target", true)
		action := "sqs:SendMessage"
		if connection.RelationshipType == "aws.eventbridge.target-publishes-to-sns" {
			action = "sns:Publish"
		}
		return expectedGeneratedPolicy{OwnerID: connection.Target.NodeID, Kind: "resource", Actions: []string{action}, ScopeID: connection.Target.NodeID, Principal: "events.amazonaws.com", SourceArnID: rule.ID}, true
	default:
		return expectedGeneratedPolicy{}, false
	}
}

func (renderer *terraformRenderer) validateGeneratedPolicyProvenance(documents []terraformPolicyDocument) {
	connections := make(map[string]NormalizedConnection, len(renderer.model.Connections))
	for _, connection := range renderer.model.Connections {
		connections[connection.ID] = connection
	}
	for _, document := range documents {
		provenance := document.Resource.Lifecycle.Provenance
		if provenance == nil || (document.Kind != "trust" && document.Kind != "generated-permission" && document.Kind != "service-grant" && !(document.Kind == "resource" && document.Resource.Lifecycle.Ownership == "generated")) {
			continue
		}
		matchedStatements := make([]bool, len(document.Statements))
		valid := len(provenance.DependentEdgeIDs) > 0
		for _, edgeID := range provenance.DependentEdgeIDs {
			connection, exists := connections[edgeID]
			expected, supported := renderer.expectedGeneratedPolicy(connection)
			edgeMatched := exists && supported
			if edgeMatched {
				edgeMatched = false
				for index, statement := range document.Statements {
					if generatedStatementMatches(document, statement, expected) {
						matchedStatements[index] = true
						edgeMatched = true
					}
				}
			}
			valid = valid && edgeMatched
		}
		for _, matched := range matchedStatements {
			valid = valid && matched
		}
		if !valid {
			renderer.error("TARGET_GENERATED_POLICY_PROVENANCE_INVALID", "Every generated IAM statement and provenance edge must match one exact supported architecture relationship.", SourceReference{Document: DocumentArchitecture, NodeID: document.Resource.ID})
		}
	}
}

func generatedStatementMatches(document terraformPolicyDocument, statement terraformPolicyStatement, expected expectedGeneratedPolicy) bool {
	if document.Owner.ID != expected.OwnerID || document.Kind != expected.Kind || !sameStrings(statement.Actions, expected.Actions) || len(statement.Expressions) != 0 || len(statement.Conditions) != 0 {
		return false
	}
	if expected.Principal == "" {
		if statement.PrincipalKind != "none" || len(statement.Principals) != 0 {
			return false
		}
	} else if statement.PrincipalKind != "service" || !sameStrings(statement.Principals, []string{expected.Principal}) {
		return false
	}
	if expected.ScopeID == "" {
		if len(statement.Scopes) == 0 {
			_, hasReference := statement.Resource.Configuration.Values["resourceNode"]
			return !expected.AllowOwnerScope || !hasReference
		}
		if !expected.AllowOwnerScope || len(statement.Scopes) != 1 || statement.Scopes[0].ID != expected.OwnerID {
			return false
		}
		reference, exists := statement.Resource.Configuration.Values["resourceNode"]
		if !exists || reference.Kind != "node-reference" || reference.NodeID != expected.OwnerID || reference.Attribute != "aws.lambda.function.arn" {
			return false
		}
		statementProvenance := statement.Resource.Lifecycle.Provenance
		documentProvenance := document.Resource.Lifecycle.Provenance
		return statement.Resource.Lifecycle.Ownership == "generated" && statementProvenance != nil && documentProvenance != nil &&
			statementProvenance.GeneratorKind == documentProvenance.GeneratorKind &&
			statementProvenance.GeneratorID == documentProvenance.GeneratorID &&
			statementProvenance.GeneratorVersion == documentProvenance.GeneratorVersion &&
			statementProvenance.OperationID == documentProvenance.OperationID &&
			sameStrings(statementProvenance.DependentEdgeIDs, documentProvenance.DependentEdgeIDs) &&
			sameStrings(statementProvenance.DependentNodeIDs, documentProvenance.DependentNodeIDs)
	}
	return len(statement.Scopes) == 1 && statement.Scopes[0].ID == expected.ScopeID
}
func (renderer *terraformRenderer) lambdaRoleID(lambdaID string) string {
	role, ok := renderer.connectedResource(lambdaID, "aws.iam.role-assumed-by-lambda", true)
	if !ok {
		return ""
	}
	return role.ID
}

func sameStrings(left, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}
func (renderer *terraformRenderer) supportedPolicyAction(action string) bool {
	if isCurrentAwsCatalog(renderer.model.Provenance.Catalog) && secretActions[action] {
		return true
	}
	if isCurrentAwsCatalog(renderer.model.Provenance.Catalog) && (kmsAdminActions[action] || kmsUserActions[action]) {
		return true
	}
	switch action {
	case "sts:AssumeRole", "lambda:InvokeFunction", "dynamodb:GetItem", "dynamodb:Query", "dynamodb:DeleteItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "logs:CreateLogStream", "logs:PutLogEvents":
		return true
	}
	if renderer.isCurrentCatalog() {
		switch action {
		case "dynamodb:BatchGetItem", "dynamodb:BatchWriteItem", "dynamodb:DescribeTable", "s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket",
			"sqs:SendMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes", "sqs:ReceiveMessage",
			"sns:Publish", "events:PutEvents", "states:StartExecution":
			return true
		}
	}
	return false
}

func (renderer *terraformRenderer) validateEndpointPolicyDocument(document terraformPolicyDocument) bool {
	if document.Owner.ServiceType != serviceGatewayVPCEndpoint {
		renderer.error("TARGET_RESOURCE_POLICY_OWNER_INVALID", "Resource policy owner is not a supported gateway VPC endpoint.", SourceReference{Document: DocumentArchitecture, NodeID: document.Resource.ID})
		return false
	}
	service := renderer.configString(document.Owner, "service")
	serviceValid := service == "s3" || service == "dynamodb"
	principalValid := true
	for _, statement := range document.Statements {
		for _, action := range statement.Actions {
			serviceValid = serviceValid && strings.HasPrefix(action, service+":")
		}
		for _, expression := range statement.Expressions {
			expressionMatches := strings.HasPrefix(expression, "arn:aws:"+service+":")
			serviceValid = serviceValid && expressionMatches
		}
		for _, scope := range statement.Scopes {
			serviceValid = serviceValid && service == "dynamodb" && scope.ServiceType == "aws.dynamodb.table"
		}
		principalValid = principalValid && statement.PrincipalKind != "none" && len(statement.Principals) > 0
		if statement.PrincipalKind == "all-principals" {
			principalValid = principalValid && sameStrings(statement.Principals, []string{"*"})
		}
	}
	if !serviceValid {
		renderer.error("TARGET_NETWORK_ENDPOINT_POLICY_SERVICE_MISMATCH", "Gateway endpoint policy actions and exact resources must match the selected S3 or DynamoDB service.", SourceReference{Document: DocumentArchitecture, NodeID: document.Resource.ID})
	}
	if !principalValid {
		renderer.error("TARGET_NETWORK_ENDPOINT_POLICY_PRINCIPAL_INVALID", "Gateway endpoint resource-policy statements require an explicit canonical principal; all-principals must remain exactly one reviewed wildcard principal.", SourceReference{Document: DocumentArchitecture, NodeID: document.Resource.ID})
	}
	return serviceValid && principalValid
}

func (renderer *terraformRenderer) configStringList(resource NormalizedResource, key string) []string {
	value := resource.Configuration.Values[key]
	items, ok := value.Value.([]any)
	if !ok || value.Kind != "string-list" {
		renderer.error("TARGET_CONFIGURATION_VALUE_INVALID", "Resource configuration value has an unsupported list type.", SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
		return []string{}
	}
	result := make([]string, 0, len(items))
	for _, item := range items {
		text, ok := item.(string)
		if !ok {
			renderer.error("TARGET_CONFIGURATION_VALUE_INVALID", "Resource configuration list contains an unsupported value.", SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
			return []string{}
		}
		result = append(result, text)
	}
	sort.Slice(result, func(left int, right int) bool { return compareUTF16(result[left], result[right]) < 0 })
	return result
}

// A graph bucket reference scopes only the reviewed actions to that bucket.
// Object actions need its object ARN; ListBucket needs the bucket ARN itself.
// Keep a single stable resource of each kind even when several actions need it.
func s3PolicyResourceKinds(actions []string) (bucket, objects bool) {
	for _, action := range actions {
		switch action {
		case "s3:ListBucket":
			bucket = true
		case "s3:GetObject", "s3:PutObject", "s3:DeleteObject":
			objects = true
		}
	}
	return bucket, objects
}
