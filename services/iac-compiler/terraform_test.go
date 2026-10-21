package compiler

import (
	"context"
	"encoding/json"
	"reflect"
	"sort"
	"strings"
	"testing"
)

func TestTerraformApplicationArtifactModesAndMinimalLambda(t *testing.T) {
	t.Parallel()

	modes := []string{
		"infrastructure-only",
		"user-provided",
		"generated-starter",
		"complete-supported-pattern",
		"ai-assisted-custom",
		"external-artifact",
	}
	for _, mode := range modes {
		mode := mode
		t.Run(mode, func(t *testing.T) {
			t.Parallel()
			model := minimalLambdaModel(mode)
			artifact, diagnostics := renderTerraformArtifact(context.Background(), model, nil, DefaultLimits())
			assertNoTargetErrors(t, diagnostics)
			if artifact == nil || len(artifact.Files) != len(terraformFileOrder)+2 {
				t.Fatalf("artifact files = %#v", artifact)
			}
			for _, file := range artifact.Files {
				if !strings.HasPrefix(file.Path, "infrastructure/") {
					t.Fatalf("Terraform target emitted application source/build path %q", file.Path)
				}
			}
			if got := fileContent(t, artifact, "infrastructure/compute.tf"); !strings.Contains(got, `resource "aws_lambda_function" "notes_handler"`) {
				t.Fatalf("compute.tf does not contain stable Lambda address:\n%s", got)
			}
			if len(artifact.ApplicationArtifacts) != 1 || artifact.ApplicationArtifacts[0].ImplementationMode != mode {
				t.Fatalf("application artifacts = %#v", artifact.ApplicationArtifacts)
			}
			contract := artifact.ApplicationArtifacts[0]

			switch mode {
			case "generated-starter", "complete-supported-pattern":
				if contract.Delivery != "deterministic-relative-package" || contract.RelativePackagePath != "../application/artifacts/workload_notes/function.zip" {
					t.Fatalf("generated artifact contract = %#v", contract)
				}
			case "external-artifact":
				if contract.Delivery != "validated-object-artifact-input" || len(contract.Inputs) != 1 {
					t.Fatalf("external artifact contract = %#v", contract)
				}
			default:
				if contract.Delivery != "validated-relative-package-input" {
					t.Fatalf("relative artifact contract = %#v", contract)
				}
			}
			if mode == "infrastructure-only" && !hasDiagnostic(diagnostics, "APPLICATION_CODE_REQUIRED") {
				t.Fatalf("infrastructure-only diagnostics = %#v", diagnostics)
			}
			all := artifactText(artifact)
			if strings.Contains(all, `C:\\`) || strings.Contains(all, "local-exec") || strings.Contains(all, "provisioner") {
				t.Fatalf("artifact contains a forbidden local path or execution feature:\n%s", all)
			}
		})
	}
}

func TestTerraformAuthenticatedNotesAPIAndPolicyFamily(t *testing.T) {
	t.Parallel()

	model := authenticatedNotesModel()
	artifact, diagnostics := renderTerraformArtifact(context.Background(), model, nil, DefaultLimits())
	assertNoTargetErrors(t, diagnostics)
	if artifact == nil {
		t.Fatal("artifact is nil")
	}

	compute := fileContent(t, artifact, "infrastructure/compute.tf")
	identity := fileContent(t, artifact, "infrastructure/identity.tf")
	data := fileContent(t, artifact, "infrastructure/data.tf")
	security := fileContent(t, artifact, "infrastructure/security.tf")
	observability := fileContent(t, artifact, "infrastructure/observability.tf")
	for name, contents := range map[string]string{
		"HTTP API":           compute,
		"JWT authorizer":     compute,
		"Lambda integration": compute,
		"Cognito pool":       identity,
		"DynamoDB":           data,
		"Lambda permission":  security,
		"log group":          observability,
		"alarm":              observability,
	} {
		if contents == "" {
			t.Fatalf("%s output is empty", name)
		}
	}
	for _, fragment := range []string{
		`resource "aws_apigatewayv2_api"`,
		`resource "aws_apigatewayv2_authorizer"`,
		`resource "aws_apigatewayv2_integration"`,
		`resource "aws_apigatewayv2_route"`,
		`resource "aws_apigatewayv2_stage"`,
	} {
		if !strings.Contains(compute, fragment) {
			t.Errorf("compute.tf missing %q", fragment)
		}
	}
	for _, fragment := range []string{
		`resource "aws_iam_role"`,
		`resource "aws_iam_role_policy" "generated_read_policy"`,
		`resource "aws_iam_role_policy" "custom_policy"`,
		`resource "aws_iam_role_policy_attachment"`,
		`permissions_boundary`,
		`resource "aws_lambda_permission"`,
		`dynamodb:GetItem`,
		`dynamodb:PutItem`,
	} {
		if !strings.Contains(security+identity, fragment) {
			t.Errorf("IAM output missing %q", fragment)
		}
	}
	if strings.Contains(security, `resources = ["*"]`) || strings.Contains(security, `actions = ["*"]`) {
		t.Fatalf("security.tf contains a broad IAM wildcard:\n%s", security)
	}

	kinds := map[string]string{}
	for _, policy := range artifact.PolicyArtifacts {
		kinds[policy.PolicyDocumentID] = policy.Ownership + ":" + policy.PolicyKind
	}
	if kinds["generated_read_policy"] != "generated:generated-permission" || kinds["custom_policy"] != "user:identity-inline" || kinds["api_permission"] != "generated:service-grant" {
		t.Fatalf("policy provenance = %#v", artifact.PolicyArtifacts)
	}

	again, againDiagnostics := renderTerraformArtifact(context.Background(), cloneNormalized(t, model), nil, DefaultLimits())
	assertNoTargetErrors(t, againDiagnostics)
	if !reflect.DeepEqual(artifact, again) {
		t.Fatal("repeated rendering is not byte-identical")
	}
}

func TestTerraformGeneratedPermissionCoverageAndEdgeRemoval(t *testing.T) {
	t.Parallel()

	t.Run("relationship cannot bypass generated IAM", func(t *testing.T) {
		model := authenticatedNotesModel()
		removePolicyClosure(model, "generated_read_policy", false)
		artifact, diagnostics := renderTerraformArtifact(context.Background(), model, nil, DefaultLimits())
		if artifact != nil || !hasDiagnostic(diagnostics, "TARGET_GENERATED_POLICY_COVERAGE_MISSING") {
			t.Fatalf("missing generated policy result = %#v, diagnostics = %#v", artifact, diagnostics)
		}
	})

	t.Run("generated IAM cannot add a permission without typed relationship provenance", func(t *testing.T) {
		model := authenticatedNotesModel()
		role, _ := modelResource(model, "role")
		table, _ := modelResource(model, "table")
		addPolicy(model, "generated_extra_policy", "generated-permission", role, "aws.iam.role-owns-generated-permission", []string{"dynamodb:PutItem"}, "none", nil, &table, true, []string{"edge_lambda_reads"})
		artifact, diagnostics := renderTerraformArtifact(context.Background(), model, nil, DefaultLimits())
		if artifact != nil || !hasDiagnostic(diagnostics, "TARGET_GENERATED_POLICY_PROVENANCE_INVALID") {
			t.Fatalf("unbound generated policy result = %#v, diagnostics = %#v", artifact, diagnostics)
		}
	})
	t.Run("removing one edge preserves another edge permission", func(t *testing.T) {
		model := authenticatedNotesModel()
		removePolicyClosure(model, "generated_read_policy", true)
		artifact, diagnostics := renderTerraformArtifact(context.Background(), model, nil, DefaultLimits())
		assertNoTargetErrors(t, diagnostics)
		security := fileContent(t, artifact, "infrastructure/security.tf")
		if strings.Contains(security, `aws_iam_role_policy" "generated_read_policy`) || !strings.Contains(security, `aws_iam_role_policy" "generated_write_policy`) {
			t.Fatalf("independent generated permission preservation failed:\n%s", security)
		}
	})
}

func removePolicyClosure(model *NormalizedSolution, policyID string, removeSourceEdge bool) {
	keptResources := model.Resources[:0]
	for _, resource := range model.Resources {
		if resource.ID != policyID && resource.ID != policyID+"_statement" {
			keptResources = append(keptResources, resource)
		}
	}
	model.Resources = keptResources
	keptConnections := model.Connections[:0]
	for _, connection := range model.Connections {
		remove := strings.HasPrefix(connection.ID, policyID+"_")
		if removeSourceEdge && connection.ID == "edge_lambda_reads" {
			remove = true
		}
		if !remove {
			keptConnections = append(keptConnections, connection)
		}
	}
	model.Connections = keptConnections
}
func TestCompileTerraformFromArchitectureAndVisualChangesDoNotAlterFiles(t *testing.T) {
	t.Parallel()

	architecture := architectureFromNormalized(t, authenticatedNotesModel())
	result := Compile(context.Background(), CompileRequest{Request: Request{Architecture: architecture, Target: TargetTerraform}})
	if !result.Succeeded() || result.Artifact == nil {
		t.Fatalf("Compile() diagnostics = %#v", result.Diagnostics)
	}

	visual := decodeMap(t, architecture)
	for index, value := range visual["nodes"].([]any) {
		node := value.(map[string]any)
		presentation := node["presentation"].(map[string]any)
		presentation["label"] = "Visual label " + node["id"].(string)
		presentation["position"] = map[string]any{"x": float64(index * 97), "y": float64(index * -31)}
	}
	visualResult := Compile(context.Background(), CompileRequest{Request: Request{Architecture: encodeMap(t, visual), Target: TargetTerraform}})
	if !visualResult.Succeeded() || visualResult.Artifact == nil {
		t.Fatalf("visual Compile() diagnostics = %#v", visualResult.Diagnostics)
	}
	if !reflect.DeepEqual(result.Artifact.Files, visualResult.Artifact.Files) || !reflect.DeepEqual(result.Artifact.ApplicationArtifacts, visualResult.Artifact.ApplicationArtifacts) || !reflect.DeepEqual(result.Artifact.PolicyArtifacts, visualResult.Artifact.PolicyArtifacts) {
		t.Fatal("presentation-only changes altered Terraform, application artifacts, or policy output")
	}
}

func architectureFromNormalized(t *testing.T, model *NormalizedSolution) []byte {
	t.Helper()
	document := decodeMap(t, representativeDocument(t))
	document["provider"] = map[string]any{"id": model.Provenance.ProviderID, "region": model.Provenance.Region}
	document["catalog"] = jsonObject(t, model.Provenance.Catalog)
	nodes := make([]any, 0, len(model.Resources))
	for index, resource := range model.Resources {
		semantic := map[string]any{
			"deploymentKey": resource.DeploymentKey, "serviceType": resource.ServiceType, "resourceType": resource.ResourceType,
			"configuration": jsonObject(t, resource.Configuration), "lifecycle": jsonObject(t, resource.Lifecycle),
		}
		if resource.Parent != nil {
			semantic["parent"] = map[string]any{
				"nodeId": resource.Parent.NodeID, "relationshipType": resource.Parent.RelationshipType,
			}
		}
		nodes = append(nodes, map[string]any{
			"id":           resource.ID,
			"semantic":     semantic,
			"presentation": map[string]any{"label": "Fixture " + resource.ID, "position": map[string]any{"x": float64(index * 20), "y": float64(index * 10)}},
		})
	}
	edges := make([]any, 0, len(model.Connections))
	for _, connection := range model.Connections {
		sourcePort := connection.Source.Port
		if sourcePort == "" {
			sourcePort = "aws.cloudmarkup.source"
		}
		targetPort := connection.Target.Port
		if targetPort == "" {
			targetPort = "aws.cloudmarkup.target"
		}
		edges = append(edges, map[string]any{
			"id": connection.ID,
			"semantic": map[string]any{
				"source":           map[string]any{"nodeId": connection.Source.NodeID, "port": sourcePort},
				"target":           map[string]any{"nodeId": connection.Target.NodeID, "port": targetPort},
				"relationshipType": connection.RelationshipType, "configuration": jsonObject(t, connection.Configuration), "lifecycle": jsonObject(t, connection.Lifecycle),
			},
		})
	}
	document["nodes"] = nodes
	document["edges"] = edges
	document["variables"] = []any{}
	document["outputs"] = []any{}
	document["workloadBehavior"] = map[string]any{
		"contractVersion": float64(2),
		"workloads": []any{map[string]any{
			"id": "workload_notes", "owningNodeId": "lambda",
			"implementation": map[string]any{"mode": "generated-starter", "runtimeFamily": "aws.lambda.nodejs", "handler": "index.handler", "sourceOwnership": "cloudmarkup"},
			"operations":     []any{}, "behaviorContracts": []any{}, "triggers": []any{}, "downstreamActions": []any{}, "environment": []any{},
			"errorBehavior":        map[string]any{"mode": "fail-invocation"},
			"executionAssumptions": map[string]any{"timeout": map[string]any{"kind": "duration", "milliseconds": float64(10000)}, "retry": map[string]any{"kind": "none"}},
			"triggerDispatch":      map[string]any{"mode": "single"}, "unresolvedRequirementIds": []any{},
			"entrypoints": []any{}, "httpRoutes": []any{}, "eventBindings": []any{}, "schedules": []any{}, "dataBindings": []any{}, "authorization": []any{},
			"idempotency": []any{}, "observability": map[string]any{"signals": []any{"logs", "metrics", "traces"}, "healthChecks": []any{}, "smokeTests": []any{}},
			"tests": []any{}, "sourceOwnership": []any{}, "extensionPoints": []any{}, "extensions": []any{}, "implementationRequirements": []any{},
			"compatibility": map[string]any{"applicationGenerators": []any{}, "modelGateways": []any{}},
			"provenance":    map[string]any{"source": "manual", "recordedAt": "2026-07-31T00:00:00.000Z", "recordedBy": "actor_fixture"},
		}},
	}
	return encodeMap(t, document)
}

func jsonObject(t *testing.T, value any) map[string]any {
	t.Helper()
	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	var result map[string]any
	if err := json.Unmarshal(encoded, &result); err != nil {
		t.Fatal(err)
	}
	return result
}
func TestTerraformExternalOwnershipImportAndExtensionBoundaries(t *testing.T) {
	t.Parallel()

	t.Run("external reference is not created", func(t *testing.T) {
		model := authenticatedNotesModel()
		model.ExternalResources = []NormalizedExternalResource{externalTable("existing-cloud-managed-elsewhere")}
		artifact, diagnostics := renderTerraformArtifact(context.Background(), model, nil, DefaultLimits())
		assertNoTargetErrors(t, diagnostics)
		data := fileContent(t, artifact, "infrastructure/data.tf")
		if strings.Contains(data, `resource "aws_dynamodb_table" "notes_table"`) {
			t.Fatalf("externally managed table was created:\n%s", data)
		}
		if variables := fileContent(t, artifact, "infrastructure/variables.tf"); !strings.Contains(variables, `variable "notes_table_external_arn"`) {
			t.Fatalf("external binding variable missing:\n%s", variables)
		}
	})

	t.Run("reviewed import renders one import block", func(t *testing.T) {
		model := authenticatedNotesModel()
		model.ExternalResources = []NormalizedExternalResource{externalTable("imported-current-iac-lifecycle")}
		artifact, diagnostics := renderTerraformArtifact(context.Background(), model, nil, DefaultLimits())
		assertNoTargetErrors(t, diagnostics)
		data := fileContent(t, artifact, "infrastructure/data.tf")
		if strings.Count(data, "import {") != 1 || !strings.Contains(data, `id = "notes-existing"`) {
			t.Fatalf("reviewed import output =\n%s", data)
		}
	})

	t.Run("target extension remains fail closed", func(t *testing.T) {
		model := minimalLambdaModel("generated-starter")
		extension := TargetExtensionReference{
			ContractVersion: 1, ExtensionID: "extension_fixture", Target: TargetTerraform,
			Path: "infrastructure/extensions/fixture.tf", Ownership: "ai-accepted",
			Digest: digestOf('e'), EvidenceIDs: []string{"evidence_fixture"}, Approved: true,
		}
		artifact, diagnostics := renderTerraformArtifact(context.Background(), model, []TargetExtensionReference{extension}, DefaultLimits())
		if artifact != nil || !hasDiagnostic(diagnostics, "TARGET_EXTENSION_NOT_SUPPORTED") {
			t.Fatalf("extension result = %#v, diagnostics = %#v", artifact, diagnostics)
		}
	})
}

func TestTerraformStabilitySecretsCollisionsUnsupportedBehaviorAndLimits(t *testing.T) {
	t.Parallel()

	t.Run("stable names disambiguate collisions", func(t *testing.T) {
		model := minimalLambdaModel("generated-starter")
		first := dynamoResource("table_alpha", "shared_table", "alpha")
		second := dynamoResource("table_beta", "shared_table", "beta")
		model.Resources = append(model.Resources, first, second)
		sortModel(model)
		artifact, diagnostics := renderTerraformArtifact(context.Background(), model, nil, DefaultLimits())
		assertNoTargetErrors(t, diagnostics)
		data := fileContent(t, artifact, "infrastructure/data.tf")
		if strings.Count(data, `resource "aws_dynamodb_table" "shared_table_`) != 2 {
			t.Fatalf("colliding stable names were not deterministically disambiguated:\n%s", data)
		}
	})

	t.Run("secret reference becomes a sensitive input only", func(t *testing.T) {
		model := minimalLambdaModel("user-provided")
		model.Workloads[0].Environment = []EnvironmentBinding{{ID: "database_token", Name: "DATABASE_TOKEN", Kind: "secret-reference", SecretReference: "secretref_never_emit"}}
		artifact, diagnostics := renderTerraformArtifact(context.Background(), model, nil, DefaultLimits())
		assertNoTargetErrors(t, diagnostics)
		text := artifactText(artifact)
		if strings.Contains(text, "secretref_never_emit") || !strings.Contains(fileContent(t, artifact, "infrastructure/variables.tf"), "sensitive") {
			t.Fatalf("secret reference handling is unsafe:\n%s", text)
		}
	})

	t.Run("artifact byte limit is enforced", func(t *testing.T) {
		limits := DefaultLimits()
		limits.MaxArtifactBytes = 128
		artifact, diagnostics := renderTerraformArtifact(context.Background(), minimalLambdaModel("generated-starter"), nil, limits)
		if artifact != nil || !hasDiagnostic(diagnostics, "LIMIT_TARGET_ARTIFACT_EXCEEDED") {
			t.Fatalf("bounded render = %#v, diagnostics = %#v", artifact, diagnostics)
		}
	})
}

func minimalLambdaModel(mode string) *NormalizedSolution {
	role := resource("role", "notes_role", "aws.iam.role", configuration("aws.iam.role.configuration", map[string]ConfigurationValue{
		"maxSessionDurationSeconds": integerValue(3600), "roleName": stringValueConfig("notes-api-lambda-role"),
	}))
	lambda := resource("lambda", "notes_handler", "aws.lambda.function", configuration("aws.lambda.function.configuration", map[string]ConfigurationValue{
		"architecture": stringValueConfig("arm64"), "functionName": stringValueConfig("notes-api-handler"),
		"handler": stringValueConfig("index.handler"), "memoryMegabytes": integerValue(256),
		"reservedConcurrency": integerValue(10), "runtime": stringValueConfig("nodejs24.x"),
		"timeoutSeconds": integerValue(10), "tracingEnabled": boolValue(true),
	}))
	lambda.WorkloadIDs = []string{"workload_notes"}
	roleEdge := connection("edge_role_lambda", "aws.iam.role-assumed-by-lambda", role, lambda, "aws.iam.lambda-role.connection", nil)
	model := baseTerraformModel()
	model.Resources = append(model.Resources, role, lambda)
	model.Connections = append(model.Connections, roleEdge)
	addPolicy(model, "trust_policy", "trust", role, "aws.iam.role-owns-trust-policy", []string{"sts:AssumeRole"}, "service", []string{"lambda.amazonaws.com"}, nil, true, []string{roleEdge.ID})
	workload := NormalizedWorkload{
		ID: "workload_notes", OwningResource: reference(lambda), ImplementationMode: mode,
		RuntimeFamily: "aws.lambda.nodejs", Handler: "index.handler", SourceOwner: "user",
		Operations: []OperationBinding{}, Triggers: []TriggerBinding{}, DownstreamActions: []TriggerBinding{}, Environment: []EnvironmentBinding{},
		ArtifactInputs: []ArtifactReference{}, ArtifactOutputs: []ArtifactReference{}, SourceOwnership: []SourceOwnership{}, ExtensionPoints: []ExtensionPoint{},
		GenerationCoverage: "infrastructure-and-application", TargetReadiness: "ready", Specification: json.RawMessage(`{}`),
	}
	if mode == "external-artifact" {
		workload.ArtifactInputs = []ArtifactReference{{ArtifactID: "artifact_external", Digest: digestOf('a'), Kind: "external-workload-artifact", Ownership: "external", WorkloadID: workload.ID, MediaType: "application/zip"}}
	}
	model.Workloads = []NormalizedWorkload{workload}
	sortModel(model)
	return model
}

func authenticatedNotesModel() *NormalizedSolution {
	model := minimalLambdaModel("complete-supported-pattern")
	lambda, _ := modelResource(model, "lambda")
	role, _ := modelResource(model, "role")
	api := resource("api", "notes_api", "aws.apigateway.http-api", configuration("aws.apigateway.http-api.configuration", map[string]ConfigurationValue{
		"corsEnabled": boolValue(false), "jwtAuthorizationRequired": boolValue(true), "name": stringValueConfig("notes-api"), "protocolType": stringValueConfig("HTTP"),
	}))
	table := dynamoResource("table", "notes_table", "notes")
	pool := resource("pool", "notes_pool", "aws.cognito.user-pool", configuration("aws.cognito.user-pool.configuration", map[string]ConfigurationValue{
		"accountRecovery": stringValueConfig("verified_email_only"), "deletionProtectionEnabled": boolValue(true), "mfaMode": stringValueConfig("OPTIONAL"),
		"passwordMinimumLength": integerValue(12), "requirePasswordLowercase": boolValue(true), "requirePasswordNumbers": boolValue(true),
		"requirePasswordSymbols": boolValue(true), "requirePasswordUppercase": boolValue(true), "selfSignUpEnabled": boolValue(false),
		"signInAlias": stringValueConfig("email"), "userPoolName": stringValueConfig("notes-users"), "usernameCaseSensitive": boolValue(false),
	}))
	client := resource("client", "notes_client", "aws.cognito.user-pool-client", configuration("aws.cognito.user-pool-client.configuration", map[string]ConfigurationValue{
		"accessTokenValidityMinutes": integerValue(15), "allowRefreshTokenAuth": boolValue(true), "allowUserSrpAuth": boolValue(true),
		"clientName": stringValueConfig("notes-web"), "generateClientSecret": boolValue(false), "idTokenValidityMinutes": integerValue(15),
		"preventUserExistenceErrors": boolValue(true), "refreshTokenValidityDays": integerValue(30),
	}))
	logGroup := resource("logs", "notes_logs", "aws.cloudwatch.log-group", configuration("aws.cloudwatch.log-group.configuration", map[string]ConfigurationValue{
		"logClass": stringValueConfig("STANDARD"), "logGroupName": stringValueConfig("/aws/lambda/notes-api-handler"), "preventDestroy": boolValue(true), "retentionDays": integerValue(30),
	}))
	alarm := resource("alarm", "notes_alarm", "aws.cloudwatch.metric-alarm", configuration("aws.cloudwatch.metric-alarm.configuration", map[string]ConfigurationValue{
		"alarmName": stringValueConfig("notes-api-errors"), "comparisonOperator": stringValueConfig("GreaterThanOrEqualToThreshold"),
		"datapointsToAlarm": integerValue(1), "evaluationPeriods": integerValue(1), "metricName": stringValueConfig("Errors"),
		"namespace": stringValueConfig("AWS/Lambda"), "periodSeconds": integerValue(60), "statistic": stringValueConfig("Sum"),
		"threshold": numberValue(1), "treatMissingData": stringValueConfig("notBreaching"),
	}))
	model.Resources = append(model.Resources, api, table, pool, client, logGroup, alarm)
	contains := connection("edge_pool_client", "aws.cognito.contains-app-client", pool, client, "aws.cognito.user-pool-client.connection", nil)
	issuer := connection("edge_pool_api", "aws.cognito.provides-jwt-issuer", pool, api, "aws.cognito.jwt-issuer.connection", map[string]ConfigurationValue{"authorizerName": stringValueConfig("notesJwt"), "identitySource": stringValueConfig("$request.header.Authorization")})
	audience := connection("edge_client_api", "aws.cognito.provides-jwt-audience", client, api, "aws.cognito.jwt-audience.connection", nil)
	integration := connection("edge_api_lambda", "aws.apigateway.integrates-lambda", api, lambda, "aws.apigateway.lambda-integration.connection", map[string]ConfigurationValue{"payloadFormatVersion": stringValueConfig("2.0"), "routeKey": stringValueConfig("ANY /notes/{proxy+}"), "timeoutMilliseconds": integerValue(10000)})
	read := connection("edge_lambda_reads", "aws.lambda.reads-dynamodb-table", lambda, table, "aws.lambda.dynamodb-read.connection", map[string]ConfigurationValue{"consistentRead": boolValue(false)})
	write := connection("edge_lambda_writes", "aws.lambda.writes-dynamodb-table", lambda, table, "aws.lambda.dynamodb-write.connection", nil)
	logs := connection("edge_lambda_logs", "aws.lambda.writes-log-group", lambda, logGroup, "aws.lambda.cloudwatch-logs.connection", map[string]ConfigurationValue{"deliveryMode": stringValueConfig("application-logs")})
	monitor := connection("edge_lambda_alarm", "aws.lambda.monitored-by-alarm", lambda, alarm, "aws.lambda.cloudwatch-alarm.connection", map[string]ConfigurationValue{"dimensionName": stringValueConfig("FunctionName"), "metricName": stringValueConfig("Errors")})
	model.Connections = append(model.Connections, contains, issuer, audience, integration, read, write, logs, monitor)
	addPolicy(model, "generated_read_policy", "generated-permission", role, "aws.iam.role-owns-generated-permission", []string{"dynamodb:GetItem", "dynamodb:Query"}, "none", nil, &table, true, []string{read.ID})
	addPolicy(model, "generated_write_policy", "generated-permission", role, "aws.iam.role-owns-generated-permission", []string{"dynamodb:DeleteItem", "dynamodb:PutItem", "dynamodb:UpdateItem"}, "none", nil, &table, true, []string{write.ID})
	addPolicy(model, "generated_logs_policy", "generated-permission", role, "aws.iam.role-owns-generated-permission", []string{"logs:CreateLogStream", "logs:PutLogEvents"}, "none", nil, &logGroup, true, []string{logs.ID})
	addPolicy(model, "custom_policy", "identity-inline", role, "aws.iam.role-owns-inline-policy", []string{"dynamodb:GetItem"}, "none", nil, &table, false, nil)
	addPolicy(model, "api_permission", "service-grant", lambda, "aws.lambda.owns-invocation-permission", []string{"lambda:InvokeFunction"}, "service", []string{"apigateway.amazonaws.com"}, nil, true, []string{integration.ID})
	addManagedAttachment(model, "managed_policy", "managed-policy-attachment", "aws-managed:AWSXRayDaemonWriteAccess", role, "aws.iam.role-owns-managed-policy-attachment")
	addManagedAttachment(model, "permissions_boundary", "permissions-boundary", "aws-managed:ReadOnlyAccess", role, "aws.iam.role-owns-permissions-boundary")
	sortModel(model)
	return model
}

func baseTerraformModel() *NormalizedSolution {
	return &NormalizedSolution{
		ContractVersion: NormalizedModelContractVersion,
		Target:          TargetReadiness{Target: TargetTerraform, ContractVersion: TerraformTargetContractVersion, State: "ready", RenderingAvailable: true, Reasons: []string{}},
		Provenance: SolutionProvenance{
			ArchitectureDocumentID: "document_notes", ArchitectureID: "architecture_notes", ArchitectureRevisionID: "revision_notes_1",
			ArchitectureContentHash: digestOf('1'), ArchitectureDocumentHash: digestOf('2'), ArchitectureVisualHash: digestOf('3'), WorkloadContentHash: digestOf('4'),
			SolutionRevisionID: "solution_notes_1", ProviderID: "aws.cloudmarkup", Region: "us-east-1",
			Catalog: CatalogReference{ID: TerraformCatalogID, Version: CurrentAwsCatalogVersion, Digest: CurrentAwsCatalogDigest},
		},
		Resources: []NormalizedResource{}, Connections: []NormalizedConnection{}, PolicyAttachments: []PolicyAttachment{}, Variables: []NormalizedVariable{}, Outputs: []NormalizedOutput{}, Workloads: []NormalizedWorkload{}, ExternalResources: []NormalizedExternalResource{},
	}
}

func resource(id, key, service string, config Configuration) NormalizedResource {
	return NormalizedResource{ID: id, TargetKey: key, DeploymentKey: key, ServiceType: service, ResourceType: service, Configuration: config, Lifecycle: Lifecycle{Ownership: "user", Origin: "user"}, WorkloadIDs: []string{}}
}

func dynamoResource(id, key, name string) NormalizedResource {
	return resource(id, key, "aws.dynamodb.table", configuration("aws.dynamodb.table.configuration", map[string]ConfigurationValue{
		"billingMode": stringValueConfig("PAY_PER_REQUEST"), "deletionProtectionEnabled": boolValue(true), "partitionKeyName": stringValueConfig("noteId"),
		"partitionKeyType": stringValueConfig("S"), "pointInTimeRecoveryEnabled": boolValue(true), "serverSideEncryptionEnabled": boolValue(true), "tableName": stringValueConfig(name),
	}))
}

func configuration(schema string, values map[string]ConfigurationValue) Configuration {
	version := "1.0.0"
	if schema == "aws.iam.role.configuration" || schema == "aws.iam.policy-statement.configuration" {
		version = "2.0.0"
	}
	return Configuration{SchemaID: schema, SchemaVersion: version, Values: values}
}

func stringValueConfig(value string) ConfigurationValue {
	return ConfigurationValue{Kind: "string", Value: value}
}
func integerValue(value int) ConfigurationValue {
	return ConfigurationValue{Kind: "integer", Value: float64(value)}
}
func numberValue(value float64) ConfigurationValue {
	return ConfigurationValue{Kind: "number", Value: value}
}
func boolValue(value bool) ConfigurationValue {
	return ConfigurationValue{Kind: "boolean", Value: value}
}
func stringList(values ...string) ConfigurationValue {
	items := make([]any, len(values))
	for index, value := range values {
		items[index] = value
	}
	return ConfigurationValue{Kind: "string-list", Value: items}
}

func connection(id, relationship string, source, target NormalizedResource, schema string, values map[string]ConfigurationValue) NormalizedConnection {
	if values == nil {
		values = map[string]ConfigurationValue{}
	}
	return NormalizedConnection{ID: id, Source: reference(source), Target: reference(target), RelationshipType: relationship, Configuration: configuration(schema, values), Lifecycle: Lifecycle{Ownership: "user", Origin: "user"}}
}

func reference(resource NormalizedResource) ResourceReference {
	return ResourceReference{NodeID: resource.ID, TargetKey: resource.TargetKey}
}

func generatedLifecycle(edgeIDs []string) Lifecycle {
	return Lifecycle{Ownership: "generated", Origin: "connection-rule", Provenance: &GeneratedProvenance{GeneratorKind: "connection-rule", GeneratorID: "aws.cloudmarkup.connection-rule", GeneratorVersion: "1.0.0", OperationID: "operation_fixture", DependentNodeIDs: []string{}, DependentEdgeIDs: append([]string(nil), edgeIDs...)}}
}

func addPolicy(model *NormalizedSolution, id, kind string, owner NormalizedResource, ownerRelationship string, actions []string, principalKind string, principals []string, scope *NormalizedResource, generated bool, dependentEdges []string) {
	lifecycle := Lifecycle{Ownership: "user", Origin: "user"}
	if generated {
		lifecycle = generatedLifecycle(dependentEdges)
	}
	document := resource(id, id, "aws.iam.policy-document", configuration("aws.iam.policy-document.configuration", map[string]ConfigurationValue{"policyKind": stringValueConfig(kind), "policyName": stringValueConfig(id)}))
	document.Lifecycle = lifecycle
	statement := resource(id+"_statement", id+"_statement", "aws.iam.policy-statement", configuration("aws.iam.policy-statement.configuration", map[string]ConfigurationValue{
		"actions": stringList(actions...), "effect": stringValueConfig("allow"), "principalKind": stringValueConfig(principalKind),
		"principals": stringList(principals...), "resourceExpressions": stringList(), "statementId": stringValueConfig(statementID(id)),
	}))
	statement.Lifecycle = lifecycle
	model.Resources = append(model.Resources, document, statement)
	model.Connections = append(model.Connections,
		connection(id+"_owner", ownerRelationship, document, owner, ownerRelationship+".attachment", nil),
		connection(id+"_membership", "aws.iam.policy-contains-statement", statement, document, "aws.iam.policy-membership.connection", nil),
	)
	if scope != nil {
		relationship := map[string]string{
			"aws.dynamodb.table": "aws.iam.authorizes-dynamodb-table", "aws.cloudwatch.log-group": "aws.iam.authorizes-log-group", "aws.lambda.function": "aws.iam.authorizes-lambda-function",
			"aws.s3.bucket": "aws.iam.authorizes-s3-bucket", "aws.sqs.queue": "aws.iam.authorizes-sqs-queue", "aws.sns.topic": "aws.iam.authorizes-sns-topic",
			"aws.eventbridge.event-bus": "aws.iam.authorizes-eventbridge-bus", "aws.stepfunctions.state-machine": "aws.iam.authorizes-step-functions-state-machine",
		}[scope.ServiceType]
		schema := map[string]string{
			"aws.dynamodb.table": "aws.iam.policy-table.connection", "aws.cloudwatch.log-group": "aws.iam.policy-log-group.connection", "aws.lambda.function": "aws.iam.policy-lambda.connection",
			"aws.s3.bucket": "aws.iam.policy-statement-authorizes-s3-bucket.connection", "aws.sqs.queue": "aws.iam.policy-statement-authorizes-sqs-queue.connection", "aws.sns.topic": "aws.iam.policy-statement-authorizes-sns-topic.connection",
			"aws.eventbridge.event-bus": "aws.iam.policy-statement-authorizes-eventbridge-bus.connection", "aws.stepfunctions.state-machine": "aws.iam.policy-statement-authorizes-step-functions-state-machine.connection",
		}[scope.ServiceType]
		model.Connections = append(model.Connections, connection(id+"_scope", relationship, statement, *scope, schema, nil))
	}
}

func addManagedAttachment(model *NormalizedSolution, id, kind, referenceValue string, role NormalizedResource, relationship string) {
	attachment := resource(id, id, "aws.iam.managed-policy-attachment", configuration("aws.iam.managed-policy-attachment.configuration", map[string]ConfigurationValue{
		"attachmentKind": stringValueConfig(kind), "displayName": stringValueConfig(id), "managedPolicyReference": stringValueConfig(referenceValue),
	}))
	model.Resources = append(model.Resources, attachment)
	model.Connections = append(model.Connections, connection(id+"_owner", relationship, attachment, role, relationship+".attachment", nil))
}

func externalTable(state string) NormalizedExternalResource {
	resource := NormalizedExternalResource{
		ID: "external_table", ResourceType: "aws.dynamodb.table", ArchitectureNodes: []ResourceReference{{NodeID: "table", TargetKey: "notes_table"}},
		Targets:   []ExternalResourceTarget{{Target: TargetTerraform, Readiness: "reference-ready", MappingID: "aws.dynamodb.table.terraform", MappingVersion: TerraformFormatVersion}},
		Addresses: []ExternalResourceAddress{{ID: "table_id", Kind: "provider-resource-id", Value: "notes-existing"}, {ID: "table_arn", Kind: "cloud-arn", Value: "arn:aws:dynamodb:us-east-1:111122223333:table/notes-existing"}},
	}
	if state == "imported-current-iac-lifecycle" {
		resource.OwnershipState = state
		resource.LifecycleAuthority = "current-customer-iac"
		resource.Behavior = ExternalResourceBehavior{Create: "forbidden", Reference: "required", Import: "reviewed-required", DataSource: "optional", ImportAddressID: "table_id"}
		resource.Targets[0].Readiness = "import-ready"
	} else {
		resource.OwnershipState = "existing-cloud-managed-elsewhere"
		resource.LifecycleAuthority = "external-owner"
		resource.Behavior = ExternalResourceBehavior{Create: "forbidden", Reference: "required", Import: "review-optional", DataSource: "allowed"}
	}
	return resource
}

func sortModel(model *NormalizedSolution) {
	sort.Slice(model.Resources, func(left, right int) bool {
		return compareUTF16(model.Resources[left].TargetKey+"\x00"+model.Resources[left].ID, model.Resources[right].TargetKey+"\x00"+model.Resources[right].ID) < 0
	})
	sort.Slice(model.Connections, func(left, right int) bool {
		return compareUTF16(model.Connections[left].ID, model.Connections[right].ID) < 0
	})
}

func modelResource(model *NormalizedSolution, id string) (NormalizedResource, bool) {
	for _, resource := range model.Resources {
		if resource.ID == id {
			return resource, true
		}
	}
	return NormalizedResource{}, false
}

func cloneNormalized(t *testing.T, model *NormalizedSolution) *NormalizedSolution {
	t.Helper()
	encoded, err := json.Marshal(model)
	if err != nil {
		t.Fatal(err)
	}
	var clone NormalizedSolution
	if err := json.Unmarshal(encoded, &clone); err != nil {
		t.Fatal(err)
	}
	return &clone
}

func fileContent(t *testing.T, artifact *TargetArtifact, path string) string {
	t.Helper()
	for _, file := range artifact.Files {
		if file.Path == path {
			return file.Content
		}
	}
	t.Fatalf("artifact file %q not found", path)
	return ""
}

func artifactText(artifact *TargetArtifact) string {
	var result strings.Builder
	for _, file := range artifact.Files {
		result.WriteString(file.Content)
	}
	return result.String()
}

func assertNoTargetErrors(t *testing.T, diagnostics []Diagnostic) {
	t.Helper()
	if hasErrorDiagnostics(diagnostics) {
		t.Fatalf("target diagnostics = %#v", diagnostics)
	}
}

func hasDiagnostic(diagnostics []Diagnostic, code string) bool {
	for _, diagnostic := range diagnostics {
		if diagnostic.Code == code {
			return true
		}
	}
	return false
}
