package compiler

import (
	"sort"
	"strings"
)

func (renderer *cloudFormationRenderer) policyHelper() *terraformRenderer {
	return &terraformRenderer{
		ctx: renderer.ctx, model: renderer.model, limits: renderer.limits,
		resourceNames: make(map[string]string), externalByNode: make(map[string]NormalizedExternalResource),
	}
}

func (renderer *cloudFormationRenderer) renderIAM(documents []terraformPolicyDocument) {
	for _, document := range documents {
		renderedAs := renderer.logicalIDs[document.Owner.ID] + ".PolicyDocument"
		switch document.Kind {
		case "trust":
			renderedAs = renderer.logicalIDs[document.Owner.ID] + ".AssumeRolePolicyDocument"
		case "identity-inline", "generated-permission":
			renderedAs = renderer.logicalIDs[document.Owner.ID] + ".Policies." + renderer.logicalIDs[document.Resource.ID]
		case "service-grant":
			renderedAs = renderer.logicalIDs[document.Resource.ID]
		}
		if document.Owner.ServiceType == serviceKmsKey {
			renderedAs = renderer.logicalIDs[document.Owner.ID] + ".KeyPolicy"
		}
		renderer.policyArtifacts = append(renderer.policyArtifacts, PolicyArtifactContract{
			PolicyDocumentID: document.Resource.ID, OwnerNodeID: document.Owner.ID, PolicyKind: document.Kind,
			Ownership: document.Resource.Lifecycle.Ownership, RenderedAs: renderedAs, Provenance: document.Resource.Lifecycle.Provenance,
		})
	}
	sort.Slice(renderer.policyArtifacts, func(left int, right int) bool {
		return compareUTF16(renderer.policyArtifacts[left].PolicyDocumentID, renderer.policyArtifacts[right].PolicyDocumentID) < 0
	})

	for _, role := range renderer.model.Resources {
		if role.ServiceType != "aws.iam.role" {
			continue
		}
		if !renderer.validateConfiguration(role, "aws.iam.role.configuration", []string{"maxSessionDurationSeconds", "roleName"}) {
			continue
		}
		trust := []terraformPolicyDocument{}
		inline := []terraformPolicyDocument{}
		for _, document := range documents {
			if document.Owner.ID != role.ID {
				continue
			}
			switch document.Kind {
			case "trust":
				trust = append(trust, document)
			case "identity-inline", "generated-permission":
				inline = append(inline, document)
			}
		}
		if len(trust) != 1 {
			renderer.error("CLOUDFORMATION_ROLE_TRUST_POLICY_REQUIRED", "IAM role requires exactly one canonical trust policy.", SourceReference{Document: DocumentArchitecture, NodeID: role.ID})
			continue
		}
		policies := make([]any, 0, len(inline))
		for _, document := range inline {
			policies = append(policies, map[string]any{
				"PolicyDocument": renderer.policyDocument(document),
				"PolicyName":     document.Name,
			})
		}
		properties := map[string]any{
			"AssumeRolePolicyDocument": renderer.policyDocument(trust[0]),
			"Description":              ec2RoleDescription(renderer.model, role.ID),
			"MaxSessionDuration":       renderer.configInt(role, "maxSessionDurationSeconds"),
			"RoleName":                 renderer.configString(role, "roleName"),
			"Tags":                     renderer.tagList(),
		}
		if len(policies) > 0 {
			properties["Policies"] = policies
		}
		managed := renderer.managedAttachmentsForRole(role.ID, "managed-policy-attachment")
		if len(managed) > 0 {
			arns := make([]any, 0, len(managed))
			for _, attachment := range managed {
				arns = append(arns, renderer.managedPolicyReference(attachment))
			}
			properties["ManagedPolicyArns"] = arns
		}
		boundaries := renderer.managedAttachmentsForRole(role.ID, "permissions-boundary")
		if len(boundaries) > 1 {
			renderer.error("CLOUDFORMATION_PERMISSIONS_BOUNDARY_AMBIGUOUS", "IAM role has more than one permissions boundary.", SourceReference{Document: DocumentArchitecture, NodeID: role.ID})
			continue
		}
		if len(boundaries) == 1 {
			properties["PermissionsBoundary"] = renderer.managedPolicyReference(boundaries[0])
		}
		renderer.addResource(renderer.logicalIDs[role.ID], cloudFormationResource{
			Type: "AWS::IAM::Role", Properties: properties, Metadata: renderer.resourceMetadata(role),
		}, SourceReference{Document: DocumentArchitecture, NodeID: role.ID})
	}
}

func (renderer *cloudFormationRenderer) policyDocument(document terraformPolicyDocument) map[string]any {
	statements := make([]any, 0, len(document.Statements))
	for _, statement := range document.Statements {
		statements = append(statements, renderer.policyStatement(document, statement))
	}
	return map[string]any{"Version": "2012-10-17", "Statement": statements}
}

func (renderer *cloudFormationRenderer) policyStatement(document terraformPolicyDocument, statement terraformPolicyStatement) map[string]any {
	effect := "Allow"
	if statement.Effect == "deny" {
		effect = "Deny"
	}
	result := map[string]any{
		"Action": statement.Actions,
		"Effect": effect,
		"Sid":    statementID(statement.StatementID),
	}
	resources := make([]any, 0, len(statement.Scopes)+len(statement.Expressions))
	for _, scope := range statement.Scopes {
		if scope.ServiceType == serviceKmsKey && document.Owner.ID == scope.ID && document.OwnerEdge.RelationshipType == kmsPolicyOwnerRelationship {
			resources = append(resources, "*")
		} else if scope.ServiceType == "aws.s3.bucket" {
			bucket, objects := s3PolicyResourceKinds(statement.Actions)
			if bucket {
				resources = append(resources, renderer.resourceAttribute(scope.ID, "arn"))
			}
			if objects {
				resources = append(resources, cloudFormationJoin(renderer.resourceAttribute(scope.ID, "arn"), "/*"))
			}
		} else {
			resources = append(resources, renderer.resourceAttribute(scope.ID, "arn"))
		}
	}
	for _, expression := range statement.Expressions {
		resources = append(resources, expression)
	}
	if document.Kind != "trust" && len(resources) == 0 {
		renderer.error("CLOUDFORMATION_POLICY_RESOURCE_REQUIRED", "Non-trust IAM statement requires exact resource scope.", SourceReference{Document: DocumentArchitecture, NodeID: statement.Resource.ID})
	} else if len(resources) > 0 {
		result["Resource"] = resources
	}
	if statement.PrincipalKind != "none" {
		principals := make([]any, 0, len(statement.Principals))
		for _, principal := range statement.Principals {
			if statement.PrincipalKind == "architecture-node" {
				principals = append(principals, renderer.resourceAttribute(principal, "arn"))
			} else {
				principals = append(principals, principal)
			}
		}
		switch statement.PrincipalKind {
		case "service":
			result["Principal"] = map[string]any{"Service": principals}
		case "architecture-node", "provider-identity":
			result["Principal"] = map[string]any{"AWS": principals}
		case "federated":
			result["Principal"] = map[string]any{"Federated": principals}
		case "all-principals":
			if len(statement.Principals) == 1 && statement.Principals[0] == "*" && document.Kind == "resource" {
				result["Principal"] = "*"
			} else {
				renderer.error("CLOUDFORMATION_POLICY_PRINCIPAL_UNSUPPORTED", "IAM principal kind is unsupported or overly broad.", SourceReference{Document: DocumentArchitecture, NodeID: statement.Resource.ID})
			}
		default:
			renderer.error("CLOUDFORMATION_POLICY_PRINCIPAL_UNSUPPORTED", "IAM principal kind is unsupported or overly broad.", SourceReference{Document: DocumentArchitecture, NodeID: statement.Resource.ID})
		}
	}
	conditions := map[string]any{}
	for _, condition := range statement.Conditions {
		operator, _ := conditions[condition.Operator].(map[string]any)
		if operator == nil {
			operator = map[string]any{}
			conditions[condition.Operator] = operator
		}
		operator[condition.Key] = condition.Values
	}
	if sourceID := renderer.generatedPolicySourceArnID(document, statement); sourceID != "" {
		kind := "ArnEquals"
		if cloudfrontGeneratedPolicy(document) {
			kind = "StringEquals"
		}
		operator, _ := conditions[kind].(map[string]any)
		if operator == nil {
			operator = map[string]any{}
			conditions[kind] = operator
		}
		operator["AWS:SourceArn"] = renderer.resourceAttribute(sourceID, "arn")
	}
	if len(conditions) > 0 {
		result["Condition"] = conditions
	}
	return result
}

func (renderer *cloudFormationRenderer) generatedPolicySourceArnID(document terraformPolicyDocument, statement terraformPolicyStatement) string {
	if document.Resource.Lifecycle.Provenance == nil || document.Kind != "resource" {
		return ""
	}
	helper := renderer.policyHelper()
	for _, edgeID := range document.Resource.Lifecycle.Provenance.DependentEdgeIDs {
		for _, connection := range renderer.model.Connections {
			if connection.ID != edgeID {
				continue
			}
			expected, supported := helper.expectedGeneratedPolicy(connection)
			if supported && expected.SourceArnID != "" && generatedStatementMatches(document, statement, expected) {
				return expected.SourceArnID
			}
		}
	}
	return ""
}

func (renderer *cloudFormationRenderer) managedAttachmentsForRole(roleID string, kind string) []NormalizedResource {
	relationship := "aws.iam.role-owns-managed-policy-attachment"
	if kind == "permissions-boundary" {
		relationship = "aws.iam.role-owns-permissions-boundary"
	}
	result := []NormalizedResource{}
	for _, connection := range renderer.model.Connections {
		if connection.RelationshipType != relationship || connection.Target.NodeID != roleID {
			continue
		}
		resource, ok := renderer.resourceByID(connection.Source.NodeID)
		if !ok || resource.ServiceType != "aws.iam.managed-policy-attachment" {
			continue
		}
		if !renderer.validateConfiguration(resource, "aws.iam.managed-policy-attachment.configuration", []string{"attachmentKind", "displayName", "managedPolicyReference"}) {
			continue
		}
		if renderer.configString(resource, "attachmentKind") == kind {
			result = append(result, resource)
		}
	}
	sort.Slice(result, func(left int, right int) bool {
		return compareUTF16(result[left].TargetKey, result[right].TargetKey) < 0
	})
	return result
}

func (renderer *cloudFormationRenderer) managedPolicyReference(resource NormalizedResource) any {
	reference := renderer.configString(resource, "managedPolicyReference")
	if strings.HasPrefix(reference, "aws-managed:") {
		name := strings.TrimPrefix(reference, "aws-managed:")
		return cloudFormationSub("arn:${AWS::Partition}:iam::aws:policy/"+name, nil)
	}
	if strings.HasPrefix(reference, "approved-variable:") {
		parameter := renderer.addParameter(renderer.logicalIDs[resource.ID]+" approved managed policy arn", cloudFormationParameterBinding{
			Description: "Approved managed-policy ARN reference.", Validation: "non-empty",
		})
		return cloudFormationRef(parameter)
	}
	renderer.error("CLOUDFORMATION_MANAGED_POLICY_REFERENCE_UNSUPPORTED", "Managed-policy reference kind is unsupported.", SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
	return "INVALID_POLICY_ARN"
}

func (renderer *cloudFormationRenderer) renderLambdaPermissions(documents []terraformPolicyDocument) {
	helper := renderer.policyHelper()
	for _, document := range documents {
		if document.Kind != "service-grant" || document.Owner.ServiceType != "aws.lambda.function" {
			continue
		}
		if len(document.Statements) != 1 || document.Resource.Lifecycle.Provenance == nil {
			renderer.error("CLOUDFORMATION_LAMBDA_PERMISSION_INVALID", "Lambda service grant must contain one provenance-bound statement.", SourceReference{Document: DocumentArchitecture, NodeID: document.Resource.ID})
			continue
		}
		matches := []NormalizedConnection{}
		for _, edgeID := range document.Resource.Lifecycle.Provenance.DependentEdgeIDs {
			for _, connection := range renderer.model.Connections {
				if connection.ID != edgeID {
					continue
				}
				expected, supported := helper.expectedGeneratedPolicy(connection)
				if supported && expected.Kind == "service-grant" && expected.OwnerID == document.Owner.ID {
					matches = append(matches, connection)
				}
			}
		}
		if len(matches) != 1 {
			renderer.error("CLOUDFORMATION_LAMBDA_PERMISSION_PROVENANCE_REQUIRED", "Lambda service grant must retain one exact supported trigger provenance edge.", SourceReference{Document: DocumentArchitecture, NodeID: document.Resource.ID})
			continue
		}
		connection := matches[0]
		expected, supported := helper.expectedGeneratedPolicy(connection)
		statement := document.Statements[0]
		if !supported || !generatedStatementMatches(document, statement, expected) {
			renderer.error("CLOUDFORMATION_LAMBDA_PERMISSION_INVALID", "Lambda invocation permission does not match the exact typed trigger effect.", SourceReference{Document: DocumentArchitecture, NodeID: document.Resource.ID})
			continue
		}
		properties := map[string]any{
			"Action":       "lambda:InvokeFunction",
			"FunctionName": renderer.resourceAttribute(document.Owner.ID, "name"),
			"Principal":    expected.Principal,
		}
		if connection.RelationshipType == "aws.apigateway.integrates-lambda" {
			routeKey := renderer.connectionString(connection, "routeKey")
			properties["SourceArn"] = cloudFormationJoin(renderer.resourceAttribute(connection.Source.NodeID, "executionArn"), "/", routeSourceSuffix(routeKey))
		} else if connection.RelationshipType == "aws.s3.notifies-lambda" {
			bucket, _ := renderer.resourceByID(connection.Source.NodeID)
			properties["SourceArn"] = cloudFormationSub("arn:${AWS::Partition}:s3:::"+renderer.configString(bucket, "bucketName"), nil)
			properties["SourceAccount"] = cloudFormationRef("AWS::AccountId")
		} else if expected.SourceArnID != "" {
			properties["SourceArn"] = renderer.resourceAttribute(expected.SourceArnID, "arn")
		}
		renderer.addResource(renderer.logicalIDs[document.Resource.ID], cloudFormationResource{
			Type: "AWS::Lambda::Permission", Properties: properties, Metadata: renderer.resourceMetadata(document.Resource),
		}, SourceReference{Document: DocumentArchitecture, NodeID: document.Resource.ID})
	}
}
