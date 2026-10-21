package compiler

import (
	"fmt"
	"sort"
	"strings"
)

func (renderer *cloudFormationRenderer) tagMap() map[string]any {
	tags := map[string]any{
		"CloudMarkupArchitecture": renderer.model.Provenance.ArchitectureID,
		"CloudMarkupRevision":     renderer.model.Provenance.ArchitectureRevisionID,
		"ManagedBy":               "CloudMarkup",
	}
	if renderer.model.Provenance.SolutionRevisionID != "" {
		tags["CloudMarkupSolutionRevision"] = renderer.model.Provenance.SolutionRevisionID
	}
	return tags
}

func (renderer *cloudFormationRenderer) tagList() []any {
	tags := renderer.tagMap()
	keys := make([]string, 0, len(tags))
	for key := range tags {
		keys = append(keys, key)
	}
	sort.Slice(keys, func(left int, right int) bool { return compareUTF16(keys[left], keys[right]) < 0 })
	result := make([]any, 0, len(keys))
	for _, key := range keys {
		result = append(result, map[string]any{"Key": key, "Value": tags[key]})
	}
	return result
}

func (renderer *cloudFormationRenderer) renderResources() {
	for _, resource := range renderer.model.Resources {
		if _, internal := cloudFormationInternalService[resource.ServiceType]; internal {
			continue
		}
		if _, supported := cloudFormationResourceTypeByService[resource.ServiceType]; !supported {
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
		case serviceKmsKey:
			renderer.renderKmsKey(resource)
		case serviceFsxLustre, serviceFsxWindows, serviceFsxOpenZFS, serviceFsxONTAP, serviceFsxSVM, serviceFsxVolume:
			renderer.renderFsx(resource)
		case "aws.apigateway.http-api":
			renderer.renderHTTPAPI(resource)
		case "aws.lambda.function":
			renderer.renderLambda(resource)
		case "aws.dynamodb.table":
			renderer.renderDynamoDBTable(resource)
		case "aws.cognito.user-pool":
			renderer.renderUserPool(resource)
		case "aws.cognito.user-pool-client":
			renderer.renderUserPoolClient(resource)
		case "aws.cloudwatch.log-group":
			renderer.renderLogGroup(resource)
		case "aws.cloudwatch.metric-alarm":
			renderer.renderMetricAlarm(resource)
		case "aws.iam.role":
			// IAM roles are rendered with their graph-owned policy documents.
		case serviceVPC:
			renderer.renderVPC(resource)
		case serviceSubnet:
			renderer.renderSubnet(resource)
		case serviceRouteTable:
			renderer.renderRouteTable(resource)
		case serviceRoute:
			renderer.renderRoute(resource)
		case serviceRouteTableAssociation:
			renderer.renderRouteTableAssociation(resource)
		case serviceInternetGateway:
			renderer.renderInternetGateway(resource)
		case serviceNATGateway:
			renderer.renderNATGateway(resource)
		case serviceGatewayVPCEndpoint:
			renderer.renderGatewayVPCEndpoint(resource)
		case serviceSecurityGroup:
			renderer.renderSecurityGroup(resource)
		case serviceSecurityGroupIngressRule:
			renderer.renderSecurityGroupRule(resource, true)
		case serviceSecurityGroupEgressRule:
			renderer.renderSecurityGroupRule(resource, false)
		case "aws.s3.bucket":
			renderer.renderS3Bucket(resource)
		case "aws.sqs.queue":
			renderer.renderSQSQueue(resource)
		case "aws.sns.topic":
			renderer.renderSNSTopic(resource)
		case "aws.eventbridge.event-bus":
			renderer.renderEventBus(resource)
		case "aws.eventbridge.rule":
			renderer.renderEventRule(resource)
		case "aws.stepfunctions.state-machine":
			renderer.renderStateMachine(resource)
		}
	}
}

func (renderer *cloudFormationRenderer) resourceMetadata(resource NormalizedResource) map[string]any {
	metadata := map[string]any{
		"CloudMarkup": map[string]any{
			"DeploymentKey": resource.DeploymentKey,
			"GraphId":       resource.ID,
			"Ownership":     resource.Lifecycle.Ownership,
			"TargetKey":     resource.TargetKey,
		},
	}
	if external, exists := renderer.externalByNode[resource.ID]; exists {
		metadata["CloudMarkup"].(map[string]any)["ExternalLifecycle"] = external.OwnershipState
	}
	return metadata
}

func (renderer *cloudFormationRenderer) renderHTTPAPI(resource NormalizedResource) {
	if !renderer.validateConfiguration(resource, "aws.apigateway.http-api.configuration", []string{"corsEnabled", "jwtAuthorizationRequired", "name", "protocolType"}) {
		return
	}
	if renderer.configBool(resource, "corsEnabled") || !renderer.configBool(resource, "jwtAuthorizationRequired") {
		renderer.error("CLOUDFORMATION_API_SECURITY_UNSUPPORTED", "Supported HTTP APIs require JWT authorization and disabled CORS until a reviewed CORS policy exists.", SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
		return
	}
	renderer.addResource(renderer.logicalIDs[resource.ID], cloudFormationResource{
		Type: "AWS::ApiGatewayV2::Api",
		Properties: map[string]any{
			"Description":  "CloudMarkup authenticated notes HTTP API.",
			"Name":         renderer.configString(resource, "name"),
			"ProtocolType": renderer.configString(resource, "protocolType"),
			"Tags":         renderer.tagMap(),
		},
		Metadata: renderer.resourceMetadata(resource),
	}, SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
}

func (renderer *cloudFormationRenderer) renderLambda(resource NormalizedResource) {
	keys := []string{"architecture", "functionName", "handler", "memoryMegabytes", "reservedConcurrency", "runtime", "timeoutSeconds", "tracingEnabled"}
	if !renderer.validateConfiguration(resource, "aws.lambda.function.configuration", keys) {
		return
	}
	if renderer.configString(resource, "runtime") != ApplicationLambdaRuntime || renderer.configString(resource, "handler") != ApplicationLambdaHandler {
		renderer.error("CLOUDFORMATION_LAMBDA_RUNTIME_UNSUPPORTED", "The reviewed CloudFormation target supports only the exact Node.js 24 runtime and index.handler entrypoint.", SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
		return
	}
	role, ok := renderer.connectedResource(resource.ID, "aws.iam.role-assumed-by-lambda", true)
	if !ok {
		renderer.error("CLOUDFORMATION_LAMBDA_ROLE_REQUIRED", "Lambda function requires one exact execution-role connection.", SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
		return
	}
	artifact, exists := renderer.artifactByNode[resource.ID]
	if !exists {
		renderer.error("CLOUDFORMATION_LAMBDA_ARTIFACT_MISSING", "Lambda function has no validated application-artifact contract.", SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
		return
	}
	tracing := "PassThrough"
	if renderer.configBool(resource, "tracingEnabled") {
		tracing = "Active"
	}
	properties := map[string]any{
		"Architectures": []any{renderer.configString(resource, "architecture")},
		"Code": map[string]any{
			"S3Bucket":        cloudFormationRef(artifact.Bucket),
			"S3Key":           cloudFormationRef(artifact.Key),
			"S3ObjectVersion": cloudFormationRef(artifact.Version),
		},
		"Description":                  "CloudMarkup notes-API workload.",
		"FunctionName":                 renderer.configString(resource, "functionName"),
		"Handler":                      renderer.configString(resource, "handler"),
		"MemorySize":                   renderer.configInt(resource, "memoryMegabytes"),
		"ReservedConcurrentExecutions": renderer.configInt(resource, "reservedConcurrency"),
		"Role":                         renderer.resourceAttribute(role.ID, "arn"),
		"Runtime":                      renderer.configString(resource, "runtime"),
		"Tags":                         renderer.tagMap(),
		"Timeout":                      renderer.configInt(resource, "timeoutSeconds"),
		"TracingConfig":                map[string]any{"Mode": tracing},
	}
	if environment := renderer.lambdaEnvironment(resource, artifact.Workload); len(environment) > 0 {
		properties["Environment"] = map[string]any{"Variables": environment}
	}
	logGroups := renderer.relatedResources(resource.ID, "aws.lambda.writes-log-group", false)
	if len(logGroups) > 1 {
		renderer.error("CLOUDFORMATION_LAMBDA_LOG_GROUP_AMBIGUOUS", "Lambda function supports one exact connected log group.", SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
		return
	}
	if len(logGroups) == 1 {
		properties["LoggingConfig"] = map[string]any{"LogGroup": renderer.resourceAttribute(logGroups[0].ID, "name")}
	}
	renderer.renderLambdaVPCConfiguration(properties, resource)
	renderer.renderLambdaDeadLetterConfiguration(properties, resource)
	metadata := renderer.resourceMetadata(resource)
	metadata["CloudMarkup"].(map[string]any)["ApplicationArtifact"] = map[string]any{
		"Base64Sha256Parameter": cloudFormationRef(artifact.Digest),
		"ImplementationMode":    artifact.Workload.ImplementationMode,
		"Path":                  artifact.LocalPath,
		"Readiness":             artifact.Workload.TargetReadiness,
		"WorkloadId":            artifact.Workload.ID,
	}
	renderer.addResource(renderer.logicalIDs[resource.ID], cloudFormationResource{
		Type: "AWS::Lambda::Function", Properties: properties, Metadata: metadata,
	}, SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
}

func (renderer *cloudFormationRenderer) lambdaEnvironment(resource NormalizedResource, workload NormalizedWorkload) map[string]any {
	result := map[string]any{}
	for _, binding := range workload.Environment {
		switch binding.Kind {
		case "node-attribute-reference":
			if binding.Resource == nil {
				renderer.error("CLOUDFORMATION_WORKLOAD_ENVIRONMENT_INVALID", "Workload environment resource reference is missing.", SourceReference{Document: DocumentWorkload, WorkloadID: workload.ID})
				continue
			}
			result[binding.Name] = renderer.resourceAttribute(binding.Resource.NodeID, binding.Resource.Attribute)
		case "variable-reference":
			parameter, ok := renderer.variableParameters[binding.VariableID]
			if !ok {
				renderer.error("CLOUDFORMATION_WORKLOAD_ENVIRONMENT_INVALID", "Workload environment variable reference is unavailable.", SourceReference{Document: DocumentWorkload, WorkloadID: workload.ID})
				continue
			}
			result[binding.Name] = cloudFormationRef(parameter)
		case "secret-reference":
			parameter := renderer.addParameter(renderer.logicalIDs[resource.ID]+" secret "+binding.ID, cloudFormationParameterBinding{
				Description: "Secret value supplied through a protected customer-owned CloudFormation parameter channel.", Sensitive: true, Validation: "non-empty",
			})
			result[binding.Name] = cloudFormationRef(parameter)
		default:
			renderer.error("CLOUDFORMATION_WORKLOAD_ENVIRONMENT_UNSUPPORTED", "Workload environment binding kind is unsupported.", SourceReference{Document: DocumentWorkload, WorkloadID: workload.ID})
		}
	}
	return result
}

func (renderer *cloudFormationRenderer) renderDynamoDBTable(resource NormalizedResource) {
	keys := []string{"billingMode", "deletionProtectionEnabled", "partitionKeyName", "partitionKeyType", "pointInTimeRecoveryEnabled", "serverSideEncryptionEnabled", "tableName"}
	if !renderer.validateConfiguration(resource, "aws.dynamodb.table.configuration", keys) {
		return
	}
	keyName := renderer.configString(resource, "partitionKeyName")
	renderer.addResource(renderer.logicalIDs[resource.ID], cloudFormationResource{
		Type: "AWS::DynamoDB::Table",
		Properties: map[string]any{
			"AttributeDefinitions":             []any{map[string]any{"AttributeName": keyName, "AttributeType": renderer.configString(resource, "partitionKeyType")}},
			"BillingMode":                      renderer.configString(resource, "billingMode"),
			"DeletionProtectionEnabled":        renderer.configBool(resource, "deletionProtectionEnabled"),
			"KeySchema":                        []any{map[string]any{"AttributeName": keyName, "KeyType": "HASH"}},
			"PointInTimeRecoverySpecification": map[string]any{"PointInTimeRecoveryEnabled": renderer.configBool(resource, "pointInTimeRecoveryEnabled")},
			"SSESpecification":                 map[string]any{"SSEEnabled": renderer.configBool(resource, "serverSideEncryptionEnabled")},
			"TableName":                        renderer.configString(resource, "tableName"),
			"Tags":                             renderer.tagList(),
		},
		Metadata: renderer.resourceMetadata(resource),
	}, SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
}

func (renderer *cloudFormationRenderer) renderUserPool(resource NormalizedResource) {
	keys := []string{"accountRecovery", "deletionProtectionEnabled", "mfaMode", "passwordMinimumLength", "requirePasswordLowercase", "requirePasswordNumbers", "requirePasswordSymbols", "requirePasswordUppercase", "selfSignUpEnabled", "signInAlias", "userPoolName", "usernameCaseSensitive"}
	if !renderer.validateConfiguration(resource, "aws.cognito.user-pool.configuration", keys) {
		return
	}
	deletionProtection := "INACTIVE"
	if renderer.configBool(resource, "deletionProtectionEnabled") {
		deletionProtection = "ACTIVE"
	}
	renderer.addResource(renderer.logicalIDs[resource.ID], cloudFormationResource{
		Type: "AWS::Cognito::UserPool",
		Properties: map[string]any{
			"AccountRecoverySetting": map[string]any{"RecoveryMechanisms": []any{map[string]any{"Name": "verified_email", "Priority": 1}}},
			"AdminCreateUserConfig":  map[string]any{"AllowAdminCreateUserOnly": !renderer.configBool(resource, "selfSignUpEnabled")},
			"AutoVerifiedAttributes": []any{"email"},
			"DeletionProtection":     deletionProtection,
			"MfaConfiguration":       renderer.configString(resource, "mfaMode"),
			"Policies": map[string]any{"PasswordPolicy": map[string]any{
				"MinimumLength":    renderer.configInt(resource, "passwordMinimumLength"),
				"RequireLowercase": renderer.configBool(resource, "requirePasswordLowercase"),
				"RequireNumbers":   renderer.configBool(resource, "requirePasswordNumbers"),
				"RequireSymbols":   renderer.configBool(resource, "requirePasswordSymbols"),
				"RequireUppercase": renderer.configBool(resource, "requirePasswordUppercase"),
			}},
			"EnabledMfas":           []any{"SOFTWARE_TOKEN_MFA"},
			"UserPoolName":          renderer.configString(resource, "userPoolName"),
			"UsernameAttributes":    []any{renderer.configString(resource, "signInAlias")},
			"UsernameConfiguration": map[string]any{"CaseSensitive": renderer.configBool(resource, "usernameCaseSensitive")},
			"UserPoolTags":          renderer.tagMap(),
		},
		Metadata: renderer.resourceMetadata(resource),
	}, SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
}

func (renderer *cloudFormationRenderer) renderUserPoolClient(resource NormalizedResource) {
	keys := []string{"accessTokenValidityMinutes", "allowRefreshTokenAuth", "allowUserSrpAuth", "clientName", "generateClientSecret", "idTokenValidityMinutes", "preventUserExistenceErrors", "refreshTokenValidityDays"}
	if !renderer.validateConfiguration(resource, "aws.cognito.user-pool-client.configuration", keys) {
		return
	}
	pool, ok := renderer.connectedResource(resource.ID, "aws.cognito.contains-app-client", true)
	if !ok {
		renderer.error("CLOUDFORMATION_COGNITO_POOL_REQUIRED", "Cognito app client requires one exact user-pool connection.", SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
		return
	}
	flows := []any{}
	if renderer.configBool(resource, "allowRefreshTokenAuth") {
		flows = append(flows, "ALLOW_REFRESH_TOKEN_AUTH")
	}
	if renderer.configBool(resource, "allowUserSrpAuth") {
		flows = append(flows, "ALLOW_USER_SRP_AUTH")
	}
	prevention := "LEGACY"
	if renderer.configBool(resource, "preventUserExistenceErrors") {
		prevention = "ENABLED"
	}
	renderer.addResource(renderer.logicalIDs[resource.ID], cloudFormationResource{
		Type: "AWS::Cognito::UserPoolClient",
		Properties: map[string]any{
			"AccessTokenValidity":        renderer.configInt(resource, "accessTokenValidityMinutes"),
			"ClientName":                 renderer.configString(resource, "clientName"),
			"ExplicitAuthFlows":          flows,
			"GenerateSecret":             renderer.configBool(resource, "generateClientSecret"),
			"IdTokenValidity":            renderer.configInt(resource, "idTokenValidityMinutes"),
			"PreventUserExistenceErrors": prevention,
			"RefreshTokenValidity":       renderer.configInt(resource, "refreshTokenValidityDays"),
			"TokenValidityUnits":         map[string]any{"AccessToken": "minutes", "IdToken": "minutes", "RefreshToken": "days"},
			"UserPoolId":                 renderer.resourceAttribute(pool.ID, "id"),
		},
		Metadata: renderer.resourceMetadata(resource),
	}, SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
}

func (renderer *cloudFormationRenderer) renderLogGroup(resource NormalizedResource) {
	if !renderer.validateConfiguration(resource, "aws.cloudwatch.log-group.configuration", []string{"logClass", "logGroupName", "preventDestroy", "retentionDays"}) {
		return
	}
	name := renderer.configString(resource, "logGroupName")
	if strings.HasPrefix(name, "aws/") {
		renderer.error("CLOUDFORMATION_LOG_GROUP_NAME_RESERVED", "CloudWatch log group names cannot start with aws/. Choose a valid explicit name; /aws/lambda/ remains allowed.", SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
		return
	}
	entry := cloudFormationResource{
		Type: "AWS::Logs::LogGroup",
		Properties: map[string]any{
			"LogGroupClass":   renderer.configString(resource, "logClass"),
			"LogGroupName":    name,
			"RetentionInDays": renderer.configInt(resource, "retentionDays"),
			"Tags":            renderer.tagList(),
		},
		Metadata: renderer.resourceMetadata(resource),
	}
	if renderer.configBool(resource, "preventDestroy") {
		entry.DeletionPolicy = "Retain"
		entry.UpdateReplacePolicy = "Retain"
	}
	renderer.addResource(renderer.logicalIDs[resource.ID], entry, SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
}

func (renderer *cloudFormationRenderer) renderMetricAlarm(resource NormalizedResource) {
	keys := []string{"alarmName", "comparisonOperator", "datapointsToAlarm", "evaluationPeriods", "metricName", "namespace", "periodSeconds", "statistic", "threshold", "treatMissingData"}
	if !renderer.validateConfiguration(resource, "aws.cloudwatch.metric-alarm.configuration", keys) {
		return
	}
	if renderer.configInt(resource, "datapointsToAlarm") > renderer.configInt(resource, "evaluationPeriods") {
		renderer.error("CLOUDFORMATION_ALARM_DATAPOINTS_EXCEED_PERIODS", "CloudWatch datapointsToAlarm (M) must not exceed evaluationPeriods (N); correct the explicit alarm settings.", SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
		return
	}
	function, edge, ok := renderer.connectedWithEdge(resource.ID, "aws.lambda.monitored-by-alarm", true)
	if !ok {
		renderer.error("CLOUDFORMATION_ALARM_METRIC_REQUIRED", "CloudWatch alarm requires one exact Lambda metric connection.", SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
		return
	}
	dimensionName := "FunctionName"
	if configured, ok := edge.Configuration.Values["dimensionName"].Value.(string); ok && configured != "" {
		dimensionName = configured
	}
	renderer.addResource(renderer.logicalIDs[resource.ID], cloudFormationResource{
		Type: "AWS::CloudWatch::Alarm",
		Properties: map[string]any{
			"AlarmDescription":   "CloudMarkup notes-API Lambda error alarm.",
			"AlarmName":          renderer.configString(resource, "alarmName"),
			"ComparisonOperator": renderer.configString(resource, "comparisonOperator"),
			"DatapointsToAlarm":  renderer.configInt(resource, "datapointsToAlarm"),
			"Dimensions":         []any{map[string]any{"Name": dimensionName, "Value": renderer.resourceAttribute(function.ID, "name")}},
			"EvaluationPeriods":  renderer.configInt(resource, "evaluationPeriods"),
			"MetricName":         renderer.configString(resource, "metricName"),
			"Namespace":          renderer.configString(resource, "namespace"),
			"Period":             renderer.configInt(resource, "periodSeconds"),
			"Statistic":          renderer.configString(resource, "statistic"),
			"Tags":               renderer.tagList(),
			"Threshold":          renderer.configNumber(resource, "threshold"),
			"TreatMissingData":   renderer.configString(resource, "treatMissingData"),
		},
		Metadata: renderer.resourceMetadata(resource),
	}, SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
}

func (renderer *cloudFormationRenderer) renderAPIConnections() {
	for _, api := range renderer.model.Resources {
		if api.ServiceType != "aws.apigateway.http-api" {
			continue
		}
		issuer, issuerEdge, issuerOK := renderer.connectedWithEdge(api.ID, "aws.cognito.provides-jwt-issuer", true)
		audience, _, audienceOK := renderer.connectedWithEdge(api.ID, "aws.cognito.provides-jwt-audience", true)
		if !issuerOK || !audienceOK {
			renderer.error("CLOUDFORMATION_API_AUTHORIZER_REQUIRED", "Authenticated HTTP API requires exact Cognito issuer and audience connections.", SourceReference{Document: DocumentArchitecture, NodeID: api.ID})
			continue
		}
		if !renderer.validateConnectionConfiguration(issuerEdge, "aws.cognito.jwt-issuer.connection", []string{"authorizerName", "identitySource"}) {
			continue
		}
		authorizerID := renderer.derivedLogicalID(api.DeploymentKey + " jwt authorizer")
		renderer.addResource(authorizerID, cloudFormationResource{
			Type: "AWS::ApiGatewayV2::Authorizer",
			Properties: map[string]any{
				"ApiId":          renderer.resourceAttribute(api.ID, "id"),
				"AuthorizerType": "JWT",
				"IdentitySource": []any{renderer.connectionString(issuerEdge, "identitySource")},
				"JwtConfiguration": map[string]any{
					"Audience": []any{renderer.resourceAttribute(audience.ID, "id")},
					"Issuer":   renderer.resourceAttribute(issuer.ID, "endpoint"),
				},
				"Name": renderer.connectionString(issuerEdge, "authorizerName"),
			},
		}, SourceReference{Document: DocumentArchitecture, NodeID: api.ID})

		stageID := renderer.derivedLogicalID(api.DeploymentKey + " default stage")
		renderer.addResource(stageID, cloudFormationResource{
			Type:       "AWS::ApiGatewayV2::Stage",
			Properties: map[string]any{"ApiId": renderer.resourceAttribute(api.ID, "id"), "AutoDeploy": true, "StageName": "$default", "Tags": renderer.tagMap()},
		}, SourceReference{Document: DocumentArchitecture, NodeID: api.ID})

		for _, connection := range renderer.model.Connections {
			if connection.RelationshipType != "aws.apigateway.integrates-lambda" || connection.Source.NodeID != api.ID {
				continue
			}
			if !renderer.validateConnectionConfiguration(connection, "aws.apigateway.lambda-integration.connection", []string{"payloadFormatVersion", "routeKey", "timeoutMilliseconds"}) {
				continue
			}
			lambda, ok := renderer.resourceByID(connection.Target.NodeID)
			if !ok || lambda.ServiceType != "aws.lambda.function" {
				renderer.error("CLOUDFORMATION_API_INTEGRATION_INVALID", "HTTP API integration target is not a supported Lambda function.", SourceReference{Document: DocumentArchitecture, EdgeID: connection.ID})
				continue
			}
			integrationID := renderer.derivedLogicalID(api.DeploymentKey + " " + lambda.DeploymentKey + " " + connection.ID + " integration")
			renderer.addResource(integrationID, cloudFormationResource{
				Type: "AWS::ApiGatewayV2::Integration",
				Properties: map[string]any{
					"ApiId": renderer.resourceAttribute(api.ID, "id"), "IntegrationMethod": "POST", "IntegrationType": "AWS_PROXY",
					"IntegrationUri": renderer.resourceAttribute(lambda.ID, "arn"), "PayloadFormatVersion": renderer.connectionString(connection, "payloadFormatVersion"),
					"TimeoutInMillis": renderer.connectionInt(connection, "timeoutMilliseconds"),
				},
			}, SourceReference{Document: DocumentArchitecture, EdgeID: connection.ID})
			routeID := renderer.derivedLogicalID(api.DeploymentKey + " " + lambda.DeploymentKey + " " + connection.ID + " route")
			renderer.addResource(routeID, cloudFormationResource{
				Type: "AWS::ApiGatewayV2::Route",
				Properties: map[string]any{
					"ApiId": renderer.resourceAttribute(api.ID, "id"), "AuthorizationType": "JWT", "AuthorizerId": cloudFormationRef(authorizerID),
					"RouteKey": renderer.connectionString(connection, "routeKey"), "Target": cloudFormationJoin("integrations/", cloudFormationRef(integrationID)),
				},
			}, SourceReference{Document: DocumentArchitecture, EdgeID: connection.ID})
		}
	}
}

func (renderer *cloudFormationRenderer) renderOutputs() {
	for _, output := range renderer.model.Outputs {
		if output.Sensitive {
			renderer.error("CLOUDFORMATION_SENSITIVE_OUTPUT_UNSUPPORTED", "CloudFormation outputs cannot conceal sensitive values; use a protected parameter or secret reference instead.", SourceReference{Document: DocumentArchitecture, Path: "$.outputs"})
			continue
		}
		logicalID := renderer.derivedLogicalID(output.Key + " output")
		var value any
		switch output.Kind {
		case "node-attribute":
			if output.Resource == nil {
				renderer.error("CLOUDFORMATION_OUTPUT_REFERENCE_INVALID", "Architecture output has no resource reference.", SourceReference{Document: DocumentArchitecture, Path: "$.outputs"})
				continue
			}
			value = renderer.resourceAttribute(output.Resource.NodeID, output.Resource.Attribute)
		case "variable":
			parameter, ok := renderer.variableParameters[output.VariableID]
			if !ok {
				renderer.error("CLOUDFORMATION_OUTPUT_REFERENCE_INVALID", "Architecture output references an unavailable variable.", SourceReference{Document: DocumentArchitecture, Path: "$.outputs"})
				continue
			}
			value = cloudFormationRef(parameter)
		default:
			renderer.error("CLOUDFORMATION_OUTPUT_KIND_UNSUPPORTED", "Architecture output kind is unsupported by CloudFormation generation.", SourceReference{Document: DocumentArchitecture, Path: "$.outputs"})
			continue
		}
		renderer.outputs[logicalID] = cloudFormationOutput{Description: "Architecture output " + output.Key + ".", Value: value}
	}
}

func (renderer *cloudFormationRenderer) resourceAttribute(nodeID string, attribute string) any {
	resource, ok := renderer.resourceByID(nodeID)
	if !ok {
		renderer.error("CLOUDFORMATION_REFERENCE_INVALID", "CloudFormation reference points to an unavailable resource.", SourceReference{Document: DocumentArchitecture, NodeID: nodeID})
		return "INVALID_REFERENCE"
	}
	attribute = strings.TrimPrefix(attribute, resource.ServiceType+".")
	logicalID := renderer.logicalIDs[nodeID]
	switch resource.ServiceType {
	case serviceEbsVolume:
		if isCurrentAwsCatalog(renderer.model.Provenance.Catalog) && attribute == "id" {
			return cloudFormationRef(logicalID)
		}
	case serviceAlb, serviceAlbTarget, serviceAlbListener:
		if !isCurrentAwsCatalog(renderer.model.Provenance.Catalog) {
			break
		}
		if attribute == "arn" {
			return cloudFormationRef(logicalID)
		}
		if resource.ServiceType == serviceAlb && attribute == "dnsName" {
			return cloudFormationGetAtt(logicalID, "DNSName")
		}
		if resource.ServiceType == serviceAlb && attribute == "hostedZoneId" {
			return cloudFormationGetAtt(logicalID, "CanonicalHostedZoneID")
		}
	case serviceCloudfrontDistribution, serviceCloudfrontCache:
		if !isCurrentAwsCatalog(renderer.model.Provenance.Catalog) {
			break
		}
		if attribute == "id" {
			return cloudFormationRef(logicalID)
		}
		if attribute == "arn" && resource.ServiceType == serviceCloudfrontDistribution {
			return cloudFormationJoin("arn:", cloudFormationRef("AWS::Partition"), ":cloudfront::", cloudFormationRef("AWS::AccountId"), ":distribution/", cloudFormationRef(logicalID))
		}
		if resource.ServiceType == serviceCloudfrontDistribution && attribute == "domainName" {
			return cloudFormationGetAtt(logicalID, "DomainName")
		}
		if resource.ServiceType == serviceCloudfrontDistribution && attribute == "hostedZoneId" {
			return "Z2FDTNDATAQYW2"
		}
	case servicePublicZone, servicePublicCertificate:
		if !isCurrentAwsCatalog(renderer.model.Provenance.Catalog) {
			break
		}
		if resource.ServiceType == servicePublicCertificate && attribute == "arn" || resource.ServiceType == servicePublicZone && attribute == "zoneId" {
			return cloudFormationRef(logicalID)
		}
		if resource.ServiceType == servicePublicZone && attribute == "nameServers" {
			return cloudFormationGetAtt(logicalID, "NameServers")
		}
	case serviceAuroraCluster, serviceAuroraInstance, serviceAuroraParameters:
		if !isCurrentAwsCatalog(renderer.model.Provenance.Catalog) {
			break
		}
		if attribute == "identifier" && resource.ServiceType != serviceAuroraParameters || attribute == "name" && resource.ServiceType == serviceAuroraParameters {
			return cloudFormationRef(logicalID)
		}
		attributes := map[string]string{}
		if resource.ServiceType == serviceAuroraCluster {
			attributes = map[string]string{"arn": "DBClusterArn", "address": "Endpoint.Address", "readerAddress": "ReadEndpoint.Address", "port": "Endpoint.Port", "masterUserSecretArn": "MasterUserSecret.SecretArn"}
		}
		if resource.ServiceType == serviceAuroraInstance {
			attributes = map[string]string{"arn": "DBInstanceArn", "address": "Endpoint.Address", "port": "Endpoint.Port"}
		}
		if native, ok := attributes[attribute]; ok {
			return cloudFormationGetAtt(logicalID, native)
		}
	case serviceRdsInstance:
		if !isCurrentAwsCatalog(renderer.model.Provenance.Catalog) {
			break
		}
		if attribute == "identifier" {
			return cloudFormationRef(logicalID)
		}
		if a, ok := map[string]string{"arn": "DBInstanceArn", "address": "Endpoint.Address", "port": "Endpoint.Port", "masterUserSecretArn": "MasterUserSecret.SecretArn"}[attribute]; ok {
			return cloudFormationGetAtt(logicalID, a)
		}
	case serviceRdsSubnetGroup, serviceRdsParameterGroup:
		if !isCurrentAwsCatalog(renderer.model.Provenance.Catalog) {
			break
		}
		if attribute == "name" {
			return cloudFormationRef(logicalID)
		}
		if attribute == "arn" {
			a := "DBSubnetGroupArn"
			if resource.ServiceType == serviceRdsParameterGroup {
				a = "DBParameterGroupArn"
			}
			return cloudFormationGetAtt(logicalID, a)
		}
	case serviceEcrRepository:
		if !isCurrentAwsCatalog(renderer.model.Provenance.Catalog) {
			break
		}
		if attribute == "name" {
			return cloudFormationRef(logicalID)
		}
		if attribute == "arn" {
			return cloudFormationGetAtt(logicalID, "Arn")
		}
		if attribute == "repositoryUrl" {
			return cloudFormationGetAtt(logicalID, "RepositoryUri")
		}
	case serviceEcsCluster:
		if !isCurrentAwsCatalog(renderer.model.Provenance.Catalog) {
			break
		}
		if attribute == "name" {
			return cloudFormationRef(logicalID)
		}
		if attribute == "arn" {
			return cloudFormationGetAtt(logicalID, "Arn")
		}
	case serviceEcsTask:
		if isCurrentAwsCatalog(renderer.model.Provenance.Catalog) && attribute == "arn" {
			return cloudFormationRef(logicalID)
		}
	case serviceEcsService:
		if !isCurrentAwsCatalog(renderer.model.Provenance.Catalog) {
			break
		}
		if attribute == "name" {
			return cloudFormationGetAtt(logicalID, "Name")
		}
		if attribute == "arn" {
			return cloudFormationRef(logicalID)
		}
	case serviceEc2Instance:
		if !isCurrentAwsCatalog(renderer.model.Provenance.Catalog) {
			break
		}
		if attribute == "id" {
			return cloudFormationRef(logicalID)
		}
		if attribute == "privateIp" {
			return cloudFormationGetAtt(logicalID, "PrivateIp")
		}
		if attribute == "privateDns" {
			return cloudFormationGetAtt(logicalID, "PrivateDnsName")
		}
	case serviceInstanceProfile:
		if !isCurrentAwsCatalog(renderer.model.Provenance.Catalog) {
			break
		}
		if attribute == "name" {
			return cloudFormationRef(logicalID)
		}
		if attribute == "arn" {
			return cloudFormationGetAtt(logicalID, "Arn")
		}
	case serviceSecret:
		if attribute == "arn" || attribute == "id" {
			return cloudFormationRef(logicalID)
		}
		if attribute == "name" {
			return renderer.configString(resource, "name")
		}
	case serviceKmsKey:
		if !isCurrentAwsCatalog(renderer.model.Provenance.Catalog) {
			break
		}
		if attribute == "arn" {
			return cloudFormationGetAtt(logicalID, "Arn")
		}
		if attribute == "id" {
			return cloudFormationRef(logicalID)
		}
	case "aws.apigateway.http-api":
		switch attribute {
		case "id":
			return cloudFormationRef(logicalID)
		case "endpoint":
			return cloudFormationGetAtt(logicalID, "ApiEndpoint")
		case "arn", "executionArn", "execution_arn":
			return cloudFormationJoin("arn:", cloudFormationRef("AWS::Partition"), ":execute-api:", cloudFormationRef("AWS::Region"), ":", cloudFormationRef("AWS::AccountId"), ":", cloudFormationRef(logicalID))
		}
	case "aws.lambda.function":
		switch attribute {
		case "id", "name":
			return cloudFormationRef(logicalID)
		case "arn", "invokeArn", "invoke_arn":
			return cloudFormationGetAtt(logicalID, "Arn")
		}
	case "aws.dynamodb.table":
		if attribute == "arn" {
			return cloudFormationGetAtt(logicalID, "Arn")
		}
		if attribute == "id" || attribute == "name" {
			return cloudFormationRef(logicalID)
		}
	case "aws.iam.role":
		if attribute == "arn" {
			return cloudFormationGetAtt(logicalID, "Arn")
		}
		if attribute == "id" || attribute == "name" {
			return cloudFormationRef(logicalID)
		}
	case "aws.cognito.user-pool":
		if attribute == "arn" {
			return cloudFormationGetAtt(logicalID, "Arn")
		}
		if attribute == "id" {
			return cloudFormationRef(logicalID)
		}
		if attribute == "endpoint" {
			return cloudFormationJoin("https://cognito-idp.", cloudFormationRef("AWS::Region"), ".", cloudFormationRef("AWS::URLSuffix"), "/", cloudFormationRef(logicalID))
		}
	case "aws.cognito.user-pool-client":
		if attribute == "id" {
			return cloudFormationRef(logicalID)
		}
	case "aws.cloudwatch.log-group":
		if attribute == "arn" {
			return cloudFormationGetAtt(logicalID, "Arn")
		}
		if attribute == "id" || attribute == "name" {
			return cloudFormationRef(logicalID)
		}
	case "aws.cloudwatch.metric-alarm":
		if attribute == "arn" {
			return cloudFormationGetAtt(logicalID, "Arn")
		}
		if attribute == "id" || attribute == "name" {
			return cloudFormationRef(logicalID)
		}
	case serviceFsxLustre, serviceFsxWindows, serviceFsxOpenZFS, serviceFsxONTAP, serviceFsxSVM, serviceFsxVolume:
		if attribute == "id" {
			return cloudFormationRef(logicalID)
		}
		if attribute == "arn" {
			return cloudFormationGetAtt(logicalID, "ResourceARN")
		}
	case serviceVPC:
		if attribute == "id" {
			return cloudFormationRef(logicalID)
		}
		if attribute == "arn" {
			return cloudFormationSub("arn:${AWS::Partition}:ec2:${AWS::Region}:${AWS::AccountId}:vpc/${VpcId}", map[string]any{"VpcId": cloudFormationRef(logicalID)})
		}
		if attribute == "cidrBlock" {
			return cloudFormationGetAtt(logicalID, "CidrBlock")
		}
		if attribute == "defaultSecurityGroupId" {
			return cloudFormationGetAtt(logicalID, "DefaultSecurityGroup")
		}
	case serviceSubnet:
		if attribute == "id" {
			return cloudFormationRef(logicalID)
		}
		if attribute == "arn" {
			return cloudFormationSub("arn:${AWS::Partition}:ec2:${AWS::Region}:${AWS::AccountId}:subnet/${SubnetId}", map[string]any{"SubnetId": cloudFormationRef(logicalID)})
		}
		if attribute == "availabilityZone" {
			return cloudFormationGetAtt(logicalID, "AvailabilityZone")
		}
	case serviceRouteTable, serviceInternetGateway, serviceSecurityGroupIngressRule, serviceSecurityGroupEgressRule:
		if attribute == "id" {
			return cloudFormationRef(logicalID)
		}
		if attribute == "arn" {
			kind := map[string]string{serviceRouteTable: "route-table", serviceInternetGateway: "internet-gateway", serviceSecurityGroupIngressRule: "security-group-rule", serviceSecurityGroupEgressRule: "security-group-rule"}[resource.ServiceType]
			return cloudFormationSub("arn:${AWS::Partition}:ec2:${AWS::Region}:${AWS::AccountId}:"+kind+"/${ResourceId}", map[string]any{"ResourceId": cloudFormationRef(logicalID)})
		}
	case serviceRoute, serviceRouteTableAssociation:
		if attribute == "id" {
			return cloudFormationRef(logicalID)
		}
	case serviceNATGateway:
		if attribute == "id" {
			return cloudFormationRef(logicalID)
		}
		if attribute == "publicIp" {
			return cloudFormationGetAtt(logicalID, "PublicIp")
		}
		if attribute == "privateIp" {
			return cloudFormationGetAtt(logicalID, "PrivateIp")
		}
	case serviceGatewayVPCEndpoint:
		if attribute == "id" {
			return cloudFormationRef(logicalID)
		}
		if attribute == "arn" {
			return cloudFormationSub("arn:${AWS::Partition}:ec2:${AWS::Region}:${AWS::AccountId}:vpc-endpoint/${EndpointId}", map[string]any{"EndpointId": cloudFormationRef(logicalID)})
		}
		if attribute == "prefixListId" {
			return cloudFormationGetAtt(logicalID, "PrefixListId")
		}
	case serviceSecurityGroup:
		if attribute == "id" {
			return cloudFormationGetAtt(logicalID, "GroupId")
		}
		if attribute == "name" {
			return cloudFormationRef(logicalID)
		}
		if attribute == "arn" {
			return cloudFormationSub("arn:${AWS::Partition}:ec2:${AWS::Region}:${AWS::AccountId}:security-group/${GroupId}", map[string]any{"GroupId": cloudFormationGetAtt(logicalID, "GroupId")})
		}
	case "aws.s3.bucket":
		if attribute == "id" || attribute == "name" {
			return cloudFormationRef(logicalID)
		}
		if attribute == "arn" {
			return cloudFormationGetAtt(logicalID, "Arn")
		}
	case "aws.sqs.queue":
		if attribute == "id" || attribute == "url" {
			return cloudFormationRef(logicalID)
		}
		if attribute == "arn" {
			return cloudFormationGetAtt(logicalID, "Arn")
		}
		if attribute == "name" {
			return cloudFormationGetAtt(logicalID, "QueueName")
		}
	case "aws.sns.topic":
		if attribute == "id" || attribute == "arn" {
			return cloudFormationRef(logicalID)
		}
		if attribute == "name" {
			return cloudFormationGetAtt(logicalID, "TopicName")
		}
	case "aws.eventbridge.event-bus":
		if renderer.configString(resource, "busType") == "DEFAULT" {
			if attribute == "id" || attribute == "name" {
				return "default"
			}
			if attribute == "arn" {
				return cloudFormationSub("arn:${AWS::Partition}:events:${AWS::Region}:${AWS::AccountId}:event-bus/default", nil)
			}
		}
		if attribute == "id" || attribute == "name" {
			return cloudFormationRef(logicalID)
		}
		if attribute == "arn" {
			return cloudFormationGetAtt(logicalID, "Arn")
		}
	case "aws.eventbridge.rule":
		if attribute == "id" || attribute == "name" {
			return cloudFormationRef(logicalID)
		}
		if attribute == "arn" {
			return cloudFormationGetAtt(logicalID, "Arn")
		}
	case "aws.stepfunctions.state-machine":
		if attribute == "id" || attribute == "arn" {
			return cloudFormationRef(logicalID)
		}
		if attribute == "name" {
			return cloudFormationGetAtt(logicalID, "Name")
		}
	}
	renderer.error("CLOUDFORMATION_ATTRIBUTE_UNSUPPORTED", "CloudFormation mapping does not expose the requested resource attribute.", SourceReference{Document: DocumentArchitecture, NodeID: nodeID})
	return fmt.Sprintf("INVALID_ATTRIBUTE_%s", attribute)
}
