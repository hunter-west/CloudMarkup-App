package compiler

import (
	"sort"
	"strings"

	"github.com/hashicorp/hcl/v2/hclwrite"
	"github.com/zclconf/go-cty/cty"
)

func (renderer *terraformRenderer) renderResources() {
	for _, resource := range renderer.model.Resources {
		if _, internal := terraformInternalService[resource.ServiceType]; internal {
			continue
		}
		if !renderer.shouldRenderResource(resource.ID) {
			renderer.prepareReferenceOnlyResource(resource)
			continue
		}
		switch resource.ServiceType {
		case serviceEbsVolume, serviceEbsAttachment:
			renderer.renderEbsResource(resource)
		case serviceAlb, serviceAlbTarget, serviceAlbListener:
			renderer.renderElbResource(resource)
		case serviceCloudfrontDistribution, serviceCloudfrontCache:
			renderer.renderCloudfrontResource(resource)
		case servicePublicZone, servicePublicCertificate:
			renderer.renderDnsResource(resource)
		case serviceAuroraCluster, serviceAuroraInstance, serviceAuroraParameters:
			renderer.renderAuroraResource(resource)
		case serviceRdsInstance, serviceRdsSubnetGroup, serviceRdsParameterGroup:
			renderer.renderRdsResource(resource)
		case serviceEcrRepository, serviceEcsCluster, serviceEcsTask, serviceEcsService:
			renderer.renderEcsResource(resource)
		case serviceEcrImage, serviceEcsContainer:
			// Owned configurations project into their owner resources only.
		case serviceEc2Instance, serviceInstanceProfile:
			renderer.renderEc2Resource(resource)
		case serviceSecret:
			renderer.renderSecret(resource)
		case serviceFsxLustre, serviceFsxWindows, serviceFsxOpenZFS, serviceFsxONTAP, serviceFsxSVM, serviceFsxVolume:
			renderer.renderFsx(resource)
		case "aws.apigateway.http-api":
			renderer.renderHTTPAPI(resource)
		case "aws.cloudwatch.log-group":
			renderer.renderLogGroup(resource)
		case "aws.cloudwatch.metric-alarm":
			renderer.renderMetricAlarm(resource)
		case "aws.cognito.user-pool":
			renderer.renderUserPool(resource)
		case "aws.cognito.user-pool-client":
			renderer.renderUserPoolClient(resource)
		case "aws.dynamodb.table":
			renderer.renderDynamoDBTable(resource)
		case "aws.iam.role":
			// IAM roles require canonical trust and attachment projection and
			// are rendered by renderPolicies.
		case "aws.lambda.function":
			renderer.renderLambda(resource)
		case "aws.ec2.vpc":
			renderer.renderVPC(resource)
		case "aws.ec2.subnet":
			renderer.renderSubnet(resource)
		case "aws.ec2.route-table":
			renderer.renderRouteTable(resource)
		case "aws.ec2.route":
			renderer.renderRoute(resource)
		case "aws.ec2.route-table-association":
			renderer.renderRouteTableAssociation(resource)
		case "aws.ec2.internet-gateway":
			renderer.renderInternetGateway(resource)
		case "aws.ec2.nat-gateway":
			renderer.renderNATGateway(resource)
		case "aws.ec2.gateway-vpc-endpoint":
			renderer.renderGatewayVPCEndpoint(resource)
		case "aws.ec2.security-group":
			renderer.renderSecurityGroup(resource)
		case "aws.ec2.security-group-ingress-rule":
			renderer.renderSecurityGroupRule(resource, true)
		case "aws.ec2.security-group-egress-rule":
			renderer.renderSecurityGroupRule(resource, false)
		}
		renderer.renderImport(resource)
	}
	renderer.renderAPIConnections()
	renderer.renderEventResourcesAndConnections()
}

func (renderer *terraformRenderer) renderHTTPAPI(resource NormalizedResource) {
	if !renderer.validateConfiguration(resource, "aws.apigateway.http-api.configuration", []string{"corsEnabled", "jwtAuthorizationRequired", "name", "protocolType"}) {
		return
	}
	if renderer.configBool(resource, "corsEnabled") || !renderer.configBool(resource, "jwtAuthorizationRequired") {
		renderer.error("TARGET_API_SECURITY_UNSUPPORTED", "Supported HTTP APIs require JWT authorization and disabled CORS until a reviewed CORS policy exists.", SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
		return
	}
	block := renderer.resourceBlock(resource)
	block.Body().SetAttributeValue("name", cty.StringVal(renderer.configString(resource, "name")))
	block.Body().SetAttributeValue("description", cty.StringVal("CloudMarkup authenticated notes HTTP API."))
	block.Body().SetAttributeValue("protocol_type", cty.StringVal(renderer.configString(resource, "protocolType")))
	block.Body().SetAttributeTraversal("tags", traversal("local", "tags"))
	appendBlock(renderer.file("compute.tf"), block)
}

func (renderer *terraformRenderer) renderLambda(resource NormalizedResource) {
	if !renderer.validateConfiguration(resource, "aws.lambda.function.configuration", []string{"architecture", "functionName", "handler", "memoryMegabytes", "reservedConcurrency", "runtime", "timeoutSeconds", "tracingEnabled"}) {
		return
	}
	runtime := renderer.configString(resource, "runtime")
	handler := renderer.configString(resource, "handler")
	if runtime != ApplicationLambdaRuntime || handler != ApplicationLambdaHandler {
		renderer.error("TARGET_LAMBDA_RUNTIME_UNSUPPORTED", "The reviewed Terraform target supports only the exact Node.js 24 runtime and index.handler entrypoint.", SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
		return
	}
	role, ok := renderer.connectedResource(resource.ID, "aws.iam.role-assumed-by-lambda", true)
	if !ok {
		renderer.error("TARGET_LAMBDA_ROLE_REQUIRED", "Lambda function requires one exact execution-role connection.", SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
		return
	}
	block := renderer.resourceBlock(resource)
	body := block.Body()
	body.SetAttributeValue("function_name", cty.StringVal(renderer.configString(resource, "functionName")))
	body.SetAttributeValue("description", cty.StringVal("CloudMarkup notes-API workload."))
	body.SetAttributeRaw("role", renderer.resourceAttributeTokens(role.ID, "arn"))
	body.SetAttributeValue("handler", cty.StringVal(handler))
	body.SetAttributeValue("runtime", cty.StringVal(runtime))
	body.SetAttributeValue("architectures", cty.ListVal([]cty.Value{cty.StringVal(renderer.configString(resource, "architecture"))}))
	body.SetAttributeValue("memory_size", cty.NumberIntVal(int64(renderer.configInt(resource, "memoryMegabytes"))))
	body.SetAttributeValue("reserved_concurrent_executions", cty.NumberIntVal(int64(renderer.configInt(resource, "reservedConcurrency"))))
	body.SetAttributeValue("timeout", cty.NumberIntVal(int64(renderer.configInt(resource, "timeoutSeconds"))))
	renderer.renderLambdaArtifact(body, resource.ID)
	tracing := hclwrite.NewBlock("tracing_config", nil)
	mode := "PassThrough"
	if renderer.configBool(resource, "tracingEnabled") {
		mode = "Active"
	}
	tracing.Body().SetAttributeValue("mode", cty.StringVal(mode))
	body.AppendBlock(tracing)
	renderer.renderLambdaEnvironment(body, resource)
	renderer.renderLambdaVPCConfig(body, resource)
	renderer.renderLambdaDeadLetterConfig(body, resource)
	body.SetAttributeTraversal("tags", traversal("local", "tags"))
	appendBlock(renderer.file("compute.tf"), block)
}

func (renderer *terraformRenderer) renderLambdaEnvironment(body *hclwrite.Body, resource NormalizedResource) {
	if len(resource.WorkloadIDs) != 1 {
		return
	}
	var workload *NormalizedWorkload
	for index := range renderer.model.Workloads {
		if renderer.model.Workloads[index].ID == resource.WorkloadIDs[0] {
			workload = &renderer.model.Workloads[index]
			break
		}
	}
	if workload == nil || len(workload.Environment) == 0 {
		return
	}
	attributes := make([]hclwrite.ObjectAttrTokens, 0, len(workload.Environment))
	for _, binding := range workload.Environment {
		var value hclwrite.Tokens
		switch binding.Kind {
		case "node-attribute-reference":
			if binding.Resource == nil {
				renderer.error("TARGET_WORKLOAD_ENVIRONMENT_INVALID", "Workload environment resource reference is missing.", SourceReference{Document: DocumentWorkload, WorkloadID: workload.ID})
				continue
			}
			value = renderer.resourceAttributeTokens(binding.Resource.NodeID, binding.Resource.Attribute)
		case "variable-reference":
			name, ok := renderer.variableNameByID(binding.VariableID)
			if !ok {
				renderer.error("TARGET_WORKLOAD_ENVIRONMENT_INVALID", "Workload environment variable reference is unavailable.", SourceReference{Document: DocumentWorkload, WorkloadID: workload.ID})
				continue
			}
			value = hclwrite.TokensForTraversal(traversal("var", name))
		case "secret-reference":
			name := renderer.resourceNames[resource.ID] + "_secret_" + terraformIdentifier(binding.ID)
			renderer.addVariable(terraformVariable{Name: name, Type: "string", Sensitive: true, Required: true, Description: "Secret value supplied through a protected customer-owned Terraform input channel."})
			value = hclwrite.TokensForTraversal(traversal("var", name))
		default:
			renderer.error("TARGET_WORKLOAD_ENVIRONMENT_UNSUPPORTED", "Workload environment binding kind is unsupported.", SourceReference{Document: DocumentWorkload, WorkloadID: workload.ID})
			continue
		}
		attributes = append(attributes, hclwrite.ObjectAttrTokens{Name: hclwrite.TokensForValue(cty.StringVal(binding.Name)), Value: value})
	}
	if len(attributes) == 0 {
		return
	}
	environment := hclwrite.NewBlock("environment", nil)
	environment.Body().SetAttributeRaw("variables", hclwrite.TokensForObject(attributes))
	body.AppendBlock(environment)
}

func (renderer *terraformRenderer) renderDynamoDBTable(resource NormalizedResource) {
	if !renderer.validateConfiguration(resource, "aws.dynamodb.table.configuration", []string{"billingMode", "deletionProtectionEnabled", "partitionKeyName", "partitionKeyType", "pointInTimeRecoveryEnabled", "serverSideEncryptionEnabled", "tableName"}) {
		return
	}
	block := renderer.resourceBlock(resource)
	body := block.Body()
	body.SetAttributeValue("name", cty.StringVal(renderer.configString(resource, "tableName")))
	body.SetAttributeValue("billing_mode", cty.StringVal(renderer.configString(resource, "billingMode")))
	body.SetAttributeValue("hash_key", cty.StringVal(renderer.configString(resource, "partitionKeyName")))
	body.SetAttributeValue("deletion_protection_enabled", cty.BoolVal(renderer.configBool(resource, "deletionProtectionEnabled")))
	attribute := hclwrite.NewBlock("attribute", nil)
	attribute.Body().SetAttributeValue("name", cty.StringVal(renderer.configString(resource, "partitionKeyName")))
	attribute.Body().SetAttributeValue("type", cty.StringVal(renderer.configString(resource, "partitionKeyType")))
	body.AppendBlock(attribute)
	pitr := hclwrite.NewBlock("point_in_time_recovery", nil)
	pitr.Body().SetAttributeValue("enabled", cty.BoolVal(renderer.configBool(resource, "pointInTimeRecoveryEnabled")))
	body.AppendBlock(pitr)
	encryption := hclwrite.NewBlock("server_side_encryption", nil)
	encryption.Body().SetAttributeValue("enabled", cty.BoolVal(renderer.configBool(resource, "serverSideEncryptionEnabled")))
	body.AppendBlock(encryption)
	body.SetAttributeTraversal("tags", traversal("local", "tags"))
	appendBlock(renderer.file("data.tf"), block)
}

func (renderer *terraformRenderer) renderUserPool(resource NormalizedResource) {
	keys := []string{"accountRecovery", "deletionProtectionEnabled", "mfaMode", "passwordMinimumLength", "requirePasswordLowercase", "requirePasswordNumbers", "requirePasswordSymbols", "requirePasswordUppercase", "selfSignUpEnabled", "signInAlias", "userPoolName", "usernameCaseSensitive"}
	if !renderer.validateConfiguration(resource, "aws.cognito.user-pool.configuration", keys) {
		return
	}
	block := renderer.resourceBlock(resource)
	body := block.Body()
	body.SetAttributeValue("name", cty.StringVal(renderer.configString(resource, "userPoolName")))
	body.SetAttributeValue("mfa_configuration", cty.StringVal(renderer.configString(resource, "mfaMode")))
	body.SetAttributeValue("deletion_protection", cty.StringVal(activeState(renderer.configBool(resource, "deletionProtectionEnabled"))))
	body.SetAttributeValue("username_attributes", cty.ListVal([]cty.Value{cty.StringVal(renderer.configString(resource, "signInAlias"))}))
	body.SetAttributeValue("auto_verified_attributes", cty.ListVal([]cty.Value{cty.StringVal("email")}))
	admin := hclwrite.NewBlock("admin_create_user_config", nil)
	admin.Body().SetAttributeValue("allow_admin_create_user_only", cty.BoolVal(!renderer.configBool(resource, "selfSignUpEnabled")))
	body.AppendBlock(admin)
	username := hclwrite.NewBlock("username_configuration", nil)
	username.Body().SetAttributeValue("case_sensitive", cty.BoolVal(renderer.configBool(resource, "usernameCaseSensitive")))
	body.AppendBlock(username)
	password := hclwrite.NewBlock("password_policy", nil)
	password.Body().SetAttributeValue("minimum_length", cty.NumberIntVal(int64(renderer.configInt(resource, "passwordMinimumLength"))))
	password.Body().SetAttributeValue("require_lowercase", cty.BoolVal(renderer.configBool(resource, "requirePasswordLowercase")))
	password.Body().SetAttributeValue("require_numbers", cty.BoolVal(renderer.configBool(resource, "requirePasswordNumbers")))
	password.Body().SetAttributeValue("require_symbols", cty.BoolVal(renderer.configBool(resource, "requirePasswordSymbols")))
	password.Body().SetAttributeValue("require_uppercase", cty.BoolVal(renderer.configBool(resource, "requirePasswordUppercase")))
	body.AppendBlock(password)
	recovery := hclwrite.NewBlock("account_recovery_setting", nil)
	mechanism := hclwrite.NewBlock("recovery_mechanism", nil)
	mechanism.Body().SetAttributeValue("name", cty.StringVal("verified_email"))
	mechanism.Body().SetAttributeValue("priority", cty.NumberIntVal(1))
	recovery.Body().AppendBlock(mechanism)
	body.AppendBlock(recovery)
	softwareToken := hclwrite.NewBlock("software_token_mfa_configuration", nil)
	softwareToken.Body().SetAttributeValue("enabled", cty.BoolVal(true))
	body.AppendBlock(softwareToken)
	body.SetAttributeTraversal("tags", traversal("local", "tags"))
	appendBlock(renderer.file("identity.tf"), block)
}

func (renderer *terraformRenderer) renderUserPoolClient(resource NormalizedResource) {
	keys := []string{"accessTokenValidityMinutes", "allowRefreshTokenAuth", "allowUserSrpAuth", "clientName", "generateClientSecret", "idTokenValidityMinutes", "preventUserExistenceErrors", "refreshTokenValidityDays"}
	if !renderer.validateConfiguration(resource, "aws.cognito.user-pool-client.configuration", keys) {
		return
	}
	pool, ok := renderer.connectedResource(resource.ID, "aws.cognito.contains-app-client", true)
	if !ok {
		renderer.error("TARGET_COGNITO_POOL_REQUIRED", "Cognito app client requires one exact user-pool connection.", SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
		return
	}
	block := renderer.resourceBlock(resource)
	body := block.Body()
	body.SetAttributeValue("name", cty.StringVal(renderer.configString(resource, "clientName")))
	body.SetAttributeRaw("user_pool_id", renderer.resourceAttributeTokens(pool.ID, "id"))
	body.SetAttributeValue("generate_secret", cty.BoolVal(renderer.configBool(resource, "generateClientSecret")))
	body.SetAttributeValue("prevent_user_existence_errors", cty.StringVal(enabledState(renderer.configBool(resource, "preventUserExistenceErrors"))))
	flows := []cty.Value{}
	if renderer.configBool(resource, "allowRefreshTokenAuth") {
		flows = append(flows, cty.StringVal("ALLOW_REFRESH_TOKEN_AUTH"))
	}
	if renderer.configBool(resource, "allowUserSrpAuth") {
		flows = append(flows, cty.StringVal("ALLOW_USER_SRP_AUTH"))
	}
	body.SetAttributeValue("explicit_auth_flows", cty.ListVal(flows))
	body.SetAttributeValue("access_token_validity", cty.NumberIntVal(int64(renderer.configInt(resource, "accessTokenValidityMinutes"))))
	body.SetAttributeValue("id_token_validity", cty.NumberIntVal(int64(renderer.configInt(resource, "idTokenValidityMinutes"))))
	body.SetAttributeValue("refresh_token_validity", cty.NumberIntVal(int64(renderer.configInt(resource, "refreshTokenValidityDays"))))
	units := hclwrite.NewBlock("token_validity_units", nil)
	units.Body().SetAttributeValue("access_token", cty.StringVal("minutes"))
	units.Body().SetAttributeValue("id_token", cty.StringVal("minutes"))
	units.Body().SetAttributeValue("refresh_token", cty.StringVal("days"))
	body.AppendBlock(units)
	appendBlock(renderer.file("identity.tf"), block)
}

func (renderer *terraformRenderer) renderLogGroup(resource NormalizedResource) {
	if !renderer.validateConfiguration(resource, "aws.cloudwatch.log-group.configuration", []string{"logClass", "logGroupName", "preventDestroy", "retentionDays"}) {
		return
	}
	name := renderer.configString(resource, "logGroupName")
	if strings.HasPrefix(name, "aws/") {
		renderer.error("TARGET_LOG_GROUP_NAME_RESERVED", "CloudWatch log group names cannot start with aws/. Choose a valid explicit name; /aws/lambda/ remains allowed.", SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
		return
	}
	block := renderer.resourceBlock(resource)
	body := block.Body()
	body.SetAttributeValue("name", cty.StringVal(name))
	body.SetAttributeValue("log_group_class", cty.StringVal(renderer.configString(resource, "logClass")))
	body.SetAttributeValue("retention_in_days", cty.NumberIntVal(int64(renderer.configInt(resource, "retentionDays"))))
	lifecycle := hclwrite.NewBlock("lifecycle", nil)
	lifecycle.Body().SetAttributeValue("prevent_destroy", cty.BoolVal(renderer.configBool(resource, "preventDestroy")))
	body.AppendBlock(lifecycle)
	body.SetAttributeTraversal("tags", traversal("local", "tags"))
	appendBlock(renderer.file("observability.tf"), block)
}

func (renderer *terraformRenderer) renderMetricAlarm(resource NormalizedResource) {
	keys := []string{"alarmName", "comparisonOperator", "datapointsToAlarm", "evaluationPeriods", "metricName", "namespace", "periodSeconds", "statistic", "threshold", "treatMissingData"}
	if !renderer.validateConfiguration(resource, "aws.cloudwatch.metric-alarm.configuration", keys) {
		return
	}
	if renderer.configInt(resource, "datapointsToAlarm") > renderer.configInt(resource, "evaluationPeriods") {
		renderer.error("TARGET_ALARM_DATAPOINTS_EXCEED_PERIODS", "CloudWatch datapointsToAlarm (M) must not exceed evaluationPeriods (N); correct the explicit alarm settings.", SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
		return
	}
	function, ok := renderer.connectedResource(resource.ID, "aws.lambda.monitored-by-alarm", true)
	if !ok {
		renderer.error("TARGET_ALARM_METRIC_REQUIRED", "CloudWatch alarm requires one exact Lambda metric connection.", SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
		return
	}
	block := renderer.resourceBlock(resource)
	body := block.Body()
	body.SetAttributeValue("alarm_name", cty.StringVal(renderer.configString(resource, "alarmName")))
	body.SetAttributeValue("alarm_description", cty.StringVal("CloudMarkup notes-API Lambda error alarm."))
	body.SetAttributeValue("comparison_operator", cty.StringVal(renderer.configString(resource, "comparisonOperator")))
	body.SetAttributeValue("datapoints_to_alarm", cty.NumberIntVal(int64(renderer.configInt(resource, "datapointsToAlarm"))))
	body.SetAttributeValue("evaluation_periods", cty.NumberIntVal(int64(renderer.configInt(resource, "evaluationPeriods"))))
	body.SetAttributeValue("metric_name", cty.StringVal(renderer.configString(resource, "metricName")))
	body.SetAttributeValue("namespace", cty.StringVal(renderer.configString(resource, "namespace")))
	body.SetAttributeValue("period", cty.NumberIntVal(int64(renderer.configInt(resource, "periodSeconds"))))
	body.SetAttributeValue("statistic", cty.StringVal(renderer.configString(resource, "statistic")))
	body.SetAttributeValue("threshold", cty.NumberFloatVal(renderer.configNumber(resource, "threshold")))
	body.SetAttributeValue("treat_missing_data", cty.StringVal(renderer.configString(resource, "treatMissingData")))
	body.SetAttributeRaw("dimensions", hclwrite.TokensForObject([]hclwrite.ObjectAttrTokens{{
		Name: hclwrite.TokensForIdentifier("FunctionName"), Value: renderer.resourceAttributeTokens(function.ID, "name"),
	}}))
	body.SetAttributeTraversal("tags", traversal("local", "tags"))
	appendBlock(renderer.file("observability.tf"), block)
}

func (renderer *terraformRenderer) renderAPIConnections() {
	for _, api := range renderer.model.Resources {
		if api.ServiceType != "aws.apigateway.http-api" || !renderer.shouldRenderResource(api.ID) {
			continue
		}
		issuer, issuerConnection, issuerOK := renderer.connectedWithEdge(api.ID, "aws.cognito.provides-jwt-issuer", true)
		audience, _, audienceOK := renderer.connectedWithEdge(api.ID, "aws.cognito.provides-jwt-audience", true)
		if !issuerOK || !audienceOK {
			renderer.error("TARGET_API_AUTHORIZER_REQUIRED", "Authenticated HTTP API requires exact Cognito issuer and audience connections.", SourceReference{Document: DocumentArchitecture, NodeID: api.ID})
			continue
		}
		if !renderer.validateConnectionConfiguration(issuerConnection, "aws.cognito.jwt-issuer.connection", []string{"authorizerName", "identitySource"}) {
			continue
		}
		authorizerName := renderer.resourceNames[api.ID] + "_jwt"
		authorizer := hclwrite.NewBlock("resource", []string{"aws_apigatewayv2_authorizer", authorizerName})
		authorizer.Body().SetAttributeRaw("api_id", renderer.resourceAttributeTokens(api.ID, "id"))
		authorizer.Body().SetAttributeValue("authorizer_type", cty.StringVal("JWT"))
		authorizer.Body().SetAttributeValue("name", cty.StringVal(renderer.connectionString(issuerConnection, "authorizerName")))
		authorizer.Body().SetAttributeValue("identity_sources", cty.ListVal([]cty.Value{cty.StringVal(renderer.connectionString(issuerConnection, "identitySource"))}))
		jwt := hclwrite.NewBlock("jwt_configuration", nil)
		jwt.Body().SetAttributeRaw("audience", tupleTokens(renderer.resourceAttributeTokens(audience.ID, "id")))
		jwt.Body().SetAttributeRaw("issuer", hclwrite.TokensForFunctionCall("format", hclwrite.TokensForValue(cty.StringVal("https://%s")), renderer.resourceAttributeTokens(issuer.ID, "endpoint")))
		authorizer.Body().AppendBlock(jwt)
		appendBlock(renderer.file("compute.tf"), authorizer)

		stage := hclwrite.NewBlock("resource", []string{"aws_apigatewayv2_stage", renderer.resourceNames[api.ID]})
		stage.Body().SetAttributeRaw("api_id", renderer.resourceAttributeTokens(api.ID, "id"))
		stage.Body().SetAttributeValue("name", cty.StringVal("$default"))
		stage.Body().SetAttributeValue("auto_deploy", cty.BoolVal(true))
		stage.Body().SetAttributeTraversal("tags", traversal("local", "tags"))
		appendBlock(renderer.file("compute.tf"), stage)

		for _, connection := range renderer.model.Connections {
			if connection.RelationshipType != "aws.apigateway.integrates-lambda" || connection.Source.NodeID != api.ID {
				continue
			}
			if !renderer.validateConnectionConfiguration(connection, "aws.apigateway.lambda-integration.connection", []string{"payloadFormatVersion", "routeKey", "timeoutMilliseconds"}) {
				continue
			}
			lambda, ok := renderer.resourceByID(connection.Target.NodeID)
			if !ok || lambda.ServiceType != "aws.lambda.function" {
				renderer.error("TARGET_API_INTEGRATION_INVALID", "HTTP API integration target is not a supported Lambda function.", SourceReference{Document: DocumentArchitecture, EdgeID: connection.ID})
				continue
			}
			integrationName := renderer.resourceNames[api.ID] + "_" + renderer.resourceNames[lambda.ID] + "_" + shortDigest(connection.ID)
			integration := hclwrite.NewBlock("resource", []string{"aws_apigatewayv2_integration", integrationName})
			integration.Body().SetAttributeRaw("api_id", renderer.resourceAttributeTokens(api.ID, "id"))
			integration.Body().SetAttributeValue("integration_type", cty.StringVal("AWS_PROXY"))
			integration.Body().SetAttributeValue("integration_method", cty.StringVal("POST"))
			integration.Body().SetAttributeRaw("integration_uri", renderer.resourceAttributeTokens(lambda.ID, "invokeArn"))
			integration.Body().SetAttributeValue("payload_format_version", cty.StringVal(renderer.connectionString(connection, "payloadFormatVersion")))
			integration.Body().SetAttributeValue("timeout_milliseconds", cty.NumberIntVal(int64(renderer.connectionInt(connection, "timeoutMilliseconds"))))
			appendBlock(renderer.file("compute.tf"), integration)

			route := hclwrite.NewBlock("resource", []string{"aws_apigatewayv2_route", integrationName})
			route.Body().SetAttributeRaw("api_id", renderer.resourceAttributeTokens(api.ID, "id"))
			route.Body().SetAttributeValue("route_key", cty.StringVal(renderer.connectionString(connection, "routeKey")))
			route.Body().SetAttributeValue("authorization_type", cty.StringVal("JWT"))
			route.Body().SetAttributeTraversal("authorizer_id", traversal("aws_apigatewayv2_authorizer", authorizerName, "id"))
			route.Body().SetAttributeRaw("target", hclwrite.TokensForFunctionCall("format", hclwrite.TokensForValue(cty.StringVal("integrations/%s")), hclwrite.TokensForTraversal(traversal("aws_apigatewayv2_integration", integrationName, "id"))))
			appendBlock(renderer.file("compute.tf"), route)
		}
	}
}

func (renderer *terraformRenderer) resourceBlock(resource NormalizedResource) *hclwrite.Block {
	return hclwrite.NewBlock("resource", []string{terraformResourceTypeByService[resource.ServiceType], renderer.resourceNames[resource.ID]})
}

func (renderer *terraformRenderer) renderImport(resource NormalizedResource) {
	external, exists := renderer.externalByNode[resource.ID]
	if !exists || external.OwnershipState != "imported-current-iac-lifecycle" {
		return
	}
	target, ok := externalTarget(external, TargetTerraform)
	if !ok || target.Readiness != "import-ready" {
		renderer.error("TARGET_IMPORT_NOT_READY", "Imported resource requires reviewed Terraform import-ready metadata.", SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
		return
	}
	identifier := ""
	for _, address := range external.Addresses {
		if address.ID == external.Behavior.ImportAddressID && address.Kind == "provider-resource-id" {
			identifier = address.Value
			break
		}
	}
	if identifier == "" {
		renderer.error("TARGET_IMPORT_IDENTIFIER_REQUIRED", "Imported resource requires an exact provider resource identifier.", SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
		return
	}
	block := hclwrite.NewBlock("import", nil)
	block.Body().SetAttributeTraversal("to", traversal(terraformResourceTypeByService[resource.ServiceType], renderer.resourceNames[resource.ID]))
	block.Body().SetAttributeValue("id", cty.StringVal(identifier))
	appendBlock(renderer.file("data.tf"), block)
}

func (renderer *terraformRenderer) prepareReferenceOnlyResource(resource NormalizedResource) {
	attributes := []string{"id", "arn", "name"}
	switch resource.ServiceType {
	case "aws.apigateway.http-api":
		attributes = append(attributes, "executionArn", "endpoint")
	case "aws.cognito.user-pool":
		attributes = append(attributes, "endpoint")
	case "aws.lambda.function":
		attributes = append(attributes, "invokeArn")
	}
	for _, attribute := range attributes {
		if terraformAttribute(resource.ServiceType, attribute) != "" {
			renderer.externalVariable(resource.ID, attribute)
		}
	}
}

func (renderer *terraformRenderer) connectedResource(nodeID string, relationship string, nodeIsTarget bool) (NormalizedResource, bool) {
	resource, _, ok := renderer.connectedWithEdge(nodeID, relationship, nodeIsTarget)
	return resource, ok
}

func (renderer *terraformRenderer) connectedWithEdge(nodeID string, relationship string, nodeIsTarget bool) (NormalizedResource, NormalizedConnection, bool) {
	matches := []NormalizedConnection{}
	for _, connection := range renderer.model.Connections {
		if connection.RelationshipType != relationship {
			continue
		}
		if (nodeIsTarget && connection.Target.NodeID == nodeID) || (!nodeIsTarget && connection.Source.NodeID == nodeID) {
			matches = append(matches, connection)
		}
	}
	if len(matches) != 1 {
		return NormalizedResource{}, NormalizedConnection{}, false
	}
	otherID := matches[0].Target.NodeID
	if nodeIsTarget {
		otherID = matches[0].Source.NodeID
	}
	resource, ok := renderer.resourceByID(otherID)
	return resource, matches[0], ok
}

func (renderer *terraformRenderer) validateConfiguration(resource NormalizedResource, schemaID string, keys []string) bool {
	return renderer.validateConfigurationVersion(resource, schemaID, "1.0.0", keys)
}

func (renderer *terraformRenderer) validateConfigurationVersion(resource NormalizedResource, schemaID string, schemaVersion string, keys []string) bool {
	if resource.Configuration.SchemaID != schemaID || resource.Configuration.SchemaVersion != schemaVersion || !exactConfigurationKeys(resource.Configuration, keys) {
		renderer.error("TARGET_CONFIGURATION_UNSUPPORTED", "Resource configuration does not match the implemented catalog mapping.", SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
		return false
	}
	return true
}

func (renderer *terraformRenderer) validateConnectionConfiguration(connection NormalizedConnection, schemaID string, keys []string) bool {
	if connection.Configuration.SchemaID != schemaID || connection.Configuration.SchemaVersion != "1.0.0" || !exactConfigurationKeys(connection.Configuration, keys) {
		renderer.error("TARGET_CONNECTION_CONFIGURATION_UNSUPPORTED", "Relationship configuration does not match the implemented catalog mapping.", SourceReference{Document: DocumentArchitecture, EdgeID: connection.ID})
		return false
	}
	return true
}

func exactConfigurationKeys(configuration Configuration, keys []string) bool {
	if len(configuration.Values) != len(keys) {
		return false
	}
	expected := append([]string(nil), keys...)
	sort.Strings(expected)
	actual := make([]string, 0, len(configuration.Values))
	for key := range configuration.Values {
		actual = append(actual, key)
	}
	sort.Strings(actual)
	for index := range expected {
		if expected[index] != actual[index] {
			return false
		}
	}
	return true
}

func (renderer *terraformRenderer) configString(resource NormalizedResource, key string) string {
	value := resource.Configuration.Values[key]
	result, ok := value.Value.(string)
	if value.Kind != "string" || !ok {
		renderer.error("TARGET_CONFIGURATION_VALUE_INVALID", "Resource configuration value has an unsupported type.", SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
		return "INVALID"
	}
	return result
}

func (renderer *terraformRenderer) configBool(resource NormalizedResource, key string) bool {
	value := resource.Configuration.Values[key]
	result, ok := value.Value.(bool)
	if value.Kind != "boolean" || !ok {
		renderer.error("TARGET_CONFIGURATION_VALUE_INVALID", "Resource configuration value has an unsupported type.", SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
	}
	return result
}

func (renderer *terraformRenderer) configInt(resource NormalizedResource, key string) int {
	return int(renderer.configNumber(resource, key))
}

func (renderer *terraformRenderer) configNumber(resource NormalizedResource, key string) float64 {
	value := resource.Configuration.Values[key]
	result, ok := value.Value.(float64)
	if (value.Kind != "number" && value.Kind != "integer") || !ok {
		renderer.error("TARGET_CONFIGURATION_VALUE_INVALID", "Resource configuration value has an unsupported numeric type.", SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
	}
	return result
}

func (renderer *terraformRenderer) connectionString(connection NormalizedConnection, key string) string {
	value := connection.Configuration.Values[key]
	result, ok := value.Value.(string)
	if value.Kind != "string" || !ok {
		renderer.error("TARGET_CONNECTION_VALUE_INVALID", "Relationship configuration value has an unsupported type.", SourceReference{Document: DocumentArchitecture, EdgeID: connection.ID})
		return "INVALID"
	}
	return result
}

func (renderer *terraformRenderer) connectionInt(connection NormalizedConnection, key string) int {
	value := connection.Configuration.Values[key]
	result, ok := value.Value.(float64)
	if (value.Kind != "number" && value.Kind != "integer") || !ok {
		renderer.error("TARGET_CONNECTION_VALUE_INVALID", "Relationship configuration value has an unsupported numeric type.", SourceReference{Document: DocumentArchitecture, EdgeID: connection.ID})
	}
	return int(result)
}

func activeState(value bool) string {
	if value {
		return "ACTIVE"
	}
	return "INACTIVE"
}

func enabledState(value bool) string {
	if value {
		return "ENABLED"
	}
	return "LEGACY"
}

func routeSourceSuffix(routeKey string) string {
	parts := strings.SplitN(routeKey, " ", 2)
	if len(parts) != 2 {
		return "$default/*/*"
	}
	resourcePath := strings.TrimPrefix(parts[1], "/")
	segments := strings.Split(resourcePath, "/")
	for index, segment := range segments {
		if strings.HasPrefix(segment, "{") && strings.HasSuffix(segment, "}") {
			segments[index] = "*"
		}
	}
	return "$default/" + parts[0] + "/" + strings.Join(segments, "/")
}

func formatTokens(format string, values ...hclwrite.Tokens) hclwrite.Tokens {
	arguments := []hclwrite.Tokens{hclwrite.TokensForValue(cty.StringVal(format))}
	arguments = append(arguments, values...)
	return hclwrite.TokensForFunctionCall("format", arguments...)
}

func statementID(value string) string {
	var result strings.Builder
	for _, character := range value {
		if (character >= 'a' && character <= 'z') || (character >= 'A' && character <= 'Z') || (character >= '0' && character <= '9') {
			result.WriteRune(character)
		}
	}
	if result.Len() == 0 {
		return "CloudMarkupPermission"
	}
	return result.String()
}
