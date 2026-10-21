package compiler

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"testing"
)

func TestCloudFormationAuthenticatedNotesGoldenAndSemantics(t *testing.T) {
	model := cloudFormationNotesModel("complete-supported-pattern")
	artifact := renderCloudFormationForTest(t, model)
	if artifact.Target != TargetCloudFormation || artifact.FormatVersion != CloudFormationFormatVersion {
		t.Fatalf("target artifact = %#v", artifact)
	}
	if artifact.Metadata.TemplateSpecificationVersion != CloudFormationTemplateSpecificationVersion || artifact.Metadata.TemplateFormat != "json" || artifact.Metadata.LocalValidation != "cloudmarkup-structured-template-v1" {
		t.Fatalf("CloudFormation metadata = %#v", artifact.Metadata)
	}
	if artifact.Metadata.RequiredTerraformVersion != "" || len(artifact.Metadata.Providers) != 0 {
		t.Fatalf("CloudFormation artifact leaked Terraform metadata: %#v", artifact.Metadata)
	}

	templateFile := targetFileForTest(t, artifact, cloudFormationTemplatePath)
	parametersFile := targetFileForTest(t, artifact, cloudFormationParametersPath)
	var parameterValues map[string]any
	if err := json.Unmarshal([]byte(parametersFile.Content), &parameterValues); err != nil {
		t.Fatalf("decode CloudFormation parameter example: %v", err)
	}
	if len(parameterValues) == 0 {
		t.Fatal("CloudFormation parameter example is empty")
	}
	readme := targetFileForTest(t, artifact, cloudFormationReadmePath).Content
	for _, expected := range []string{"does not generate source, upload packages, call AWS, create a change set, or deploy", "Prompt 32A ZIP", "customer-owned CI/CD"} {
		if !strings.Contains(readme, expected) {
			t.Fatalf("CloudFormation README missing %q", expected)
		}
	}
	if err := validateCloudFormationTemplate([]byte(templateFile.Content)); err != nil {
		t.Fatalf("validate generated template: %v", err)
	}
	template := decodeCloudFormationTemplate(t, templateFile.Content)
	if template["AWSTemplateFormatVersion"] != CloudFormationTemplateSpecificationVersion {
		t.Fatalf("template format version = %#v", template["AWSTemplateFormatVersion"])
	}
	resources := mapAt(t, template, "Resources")
	wantTypes := []string{
		"AWS::ApiGatewayV2::Api", "AWS::ApiGatewayV2::Authorizer", "AWS::ApiGatewayV2::Integration",
		"AWS::ApiGatewayV2::Route", "AWS::ApiGatewayV2::Stage", "AWS::CloudWatch::Alarm",
		"AWS::Cognito::UserPool", "AWS::Cognito::UserPoolClient", "AWS::DynamoDB::Table",
		"AWS::IAM::Role", "AWS::Lambda::Function", "AWS::Lambda::Permission", "AWS::Logs::LogGroup",
	}
	gotTypes := make([]string, 0, len(resources))
	for _, raw := range resources {
		resource := raw.(map[string]any)
		gotTypes = append(gotTypes, resource["Type"].(string))
		if _, exists := resource["DependsOn"]; exists {
			t.Fatal("reviewed initial-family template emitted arbitrary DependsOn")
		}
	}
	sort.Strings(gotTypes)
	sort.Strings(wantTypes)
	if !reflect.DeepEqual(gotTypes, wantTypes) {
		t.Fatalf("resource types = %#v, want %#v", gotTypes, wantTypes)
	}

	lambda := mapAt(t, mapAt(t, resources, "NotesHandler"), "Properties")
	code := mapAt(t, lambda, "Code")
	assertRef(t, code["S3Bucket"])
	assertRef(t, code["S3Key"])
	assertRef(t, code["S3ObjectVersion"])
	assertGetAtt(t, lambda["Role"], "NotesRole", "Arn")

	role := mapAt(t, mapAt(t, resources, "NotesRole"), "Properties")
	if len(arrayAtAny(t, role, "Policies")) != 4 {
		t.Fatalf("role inline policies = %#v", role["Policies"])
	}
	if len(arrayAtAny(t, role, "ManagedPolicyArns")) != 1 {
		t.Fatalf("managed attachments = %#v", role["ManagedPolicyArns"])
	}
	if _, ok := role["PermissionsBoundary"].(map[string]any)["Fn::Sub"]; !ok {
		t.Fatalf("permissions boundary = %#v", role["PermissionsBoundary"])
	}
	trust := mapAt(t, role, "AssumeRolePolicyDocument")
	if len(arrayAtAny(t, trust, "Statement")) != 1 {
		t.Fatalf("trust policy = %#v", trust)
	}

	permission := firstResourceOfType(t, resources, "AWS::Lambda::Permission")
	permissionProperties := mapAt(t, permission, "Properties")
	if permissionProperties["Principal"] != "apigateway.amazonaws.com" {
		t.Fatalf("Lambda permission principal = %#v", permissionProperties["Principal"])
	}
	if _, ok := permissionProperties["SourceArn"].(map[string]any)["Fn::Join"]; !ok {
		t.Fatalf("Lambda permission SourceArn = %#v", permissionProperties["SourceArn"])
	}

	if len(artifact.ApplicationArtifacts) != 1 || artifact.ApplicationArtifacts[0].ContractVersion != ApplicationArtifactTargetNeutralContractVersion || artifact.ApplicationArtifacts[0].ExpectedArtifact == nil {
		t.Fatalf("application artifact contract = %#v", artifact.ApplicationArtifacts)
	}
	application := artifact.ApplicationArtifacts[0]
	if application.RelativePackagePath != "../application/artifacts/workload_notes/function.zip" || application.ExpectedArtifact.Path != "application/artifacts/workload_notes/function.zip" {
		t.Fatalf("target-neutral application path = %#v", application)
	}
	kinds := map[string]int{}
	for _, policy := range artifact.PolicyArtifacts {
		kinds[policy.PolicyKind]++
	}
	for _, kind := range []string{"trust", "identity-inline", "generated-permission", "service-grant"} {
		if kinds[kind] == 0 {
			t.Fatalf("policy artifact kind %q missing from %#v", kind, artifact.PolicyArtifacts)
		}
	}

	goldenPath := filepath.Join("testdata", "cloudformation-goldens-v1", "authenticated-notes", "template.json")
	if os.Getenv("CLOUDMARKUP_UPDATE_CLOUDFORMATION_GOLDENS") == "1" {
		if err := os.MkdirAll(filepath.Dir(goldenPath), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(goldenPath, []byte(templateFile.Content), 0o644); err != nil {
			t.Fatal(err)
		}
	} else {
		golden, err := os.ReadFile(goldenPath)
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(golden, []byte(templateFile.Content)) {
			t.Fatal("CloudFormation authenticated-notes golden drifted")
		}
	}
}

func TestCloudFormationIsReproducibleAndLayoutIndependent(t *testing.T) {
	baseline := cloudFormationNotesModel("complete-supported-pattern")
	first := renderCloudFormationForTest(t, baseline)
	second := renderCloudFormationForTest(t, cloudFormationNotesModel("complete-supported-pattern"))
	if !reflect.DeepEqual(first, second) {
		t.Fatal("CloudFormation rendering is not reproducible")
	}

	reordered := cloudFormationNotesModel("complete-supported-pattern")
	reverseResources(reordered.Resources)
	reverseConnections(reordered.Connections)
	reversePolicyAttachments(reordered.PolicyAttachments)
	reverseWorkloads(reordered.Workloads)
	third := renderCloudFormationForTest(t, reordered)
	if first.Digest != third.Digest || !reflect.DeepEqual(first.Files, third.Files) {
		t.Fatal("CloudFormation output changed with normalized input/display ordering")
	}
}

func TestCloudFormationApplicationModesReuseOneArtifactContract(t *testing.T) {
	for _, mode := range []string{"infrastructure-only", "user-provided", "ai-assisted-custom", "generated-starter", "complete-supported-pattern", "external-artifact"} {
		mode := mode
		t.Run(mode, func(t *testing.T) {
			model := cloudFormationMinimalModel(mode)
			artifact := renderCloudFormationForTest(t, model)
			if len(artifact.ApplicationArtifacts) != 1 {
				t.Fatalf("application artifacts = %#v", artifact.ApplicationArtifacts)
			}
			binding := artifact.ApplicationArtifacts[0]
			if len(binding.Variables) != 4 {
				t.Fatalf("artifact inputs = %#v", binding.Variables)
			}
			if mode == "generated-starter" || mode == "complete-supported-pattern" {
				if binding.ContractVersion != ApplicationArtifactTargetNeutralContractVersion || binding.ExpectedArtifact == nil || binding.Delivery != "deterministic-package-upload-input" {
					t.Fatalf("generated artifact binding = %#v", binding)
				}
			}
		})
	}
}

func TestCloudFormationSecretsAreNoEchoAndNeverEmbedded(t *testing.T) {
	model := cloudFormationMinimalModel("user-provided")
	model.Workloads[0].Environment = []EnvironmentBinding{{ID: "database_secret", Name: "DATABASE_SECRET", Kind: "secret-reference", SecretReference: "secret://never-emit-this"}}
	artifact := renderCloudFormationForTest(t, model)
	templateFile := targetFileForTest(t, artifact, cloudFormationTemplatePath)
	if strings.Contains(templateFile.Content, "secret://never-emit-this") {
		t.Fatal("generated template embedded a secret reference")
	}
	template := decodeCloudFormationTemplate(t, templateFile.Content)
	parameters := mapAt(t, template, "Parameters")
	foundNoEcho := false
	for _, raw := range parameters {
		parameter := raw.(map[string]any)
		if parameter["NoEcho"] == true {
			foundNoEcho = true
		}
	}
	if !foundNoEcho {
		t.Fatal("secret environment binding did not produce a NoEcho parameter")
	}
}

func TestCloudFormationStableLogicalIDCollisionUsesGraphIdentity(t *testing.T) {
	model := cloudFormationMinimalModel("user-provided")
	left := dynamoResource("table-left", "shared_table", "left")
	right := dynamoResource("table-right", "shared_table", "right")
	left.DeploymentKey = "shared-table"
	right.DeploymentKey = "shared_table"
	model.Resources = append(model.Resources, left, right)
	artifact := renderCloudFormationForTest(t, model)
	template := decodeCloudFormationTemplate(t, targetFileForTest(t, artifact, cloudFormationTemplatePath).Content)
	resources := mapAt(t, template, "Resources")
	logicalIDs := []string{}
	for logicalID, raw := range resources {
		if raw.(map[string]any)["Type"] == "AWS::DynamoDB::Table" {
			logicalIDs = append(logicalIDs, logicalID)
		}
	}
	sort.Strings(logicalIDs)
	if len(logicalIDs) != 2 || logicalIDs[0] == logicalIDs[1] || !strings.HasPrefix(logicalIDs[0], "SharedTable") || !strings.HasPrefix(logicalIDs[1], "SharedTable") {
		t.Fatalf("stable collision logical IDs = %#v", logicalIDs)
	}
}

func TestCloudFormationRejectsUnsupportedTargetSurfaceWithSourceDiagnostics(t *testing.T) {
	model := cloudFormationMinimalModel("user-provided")
	model.Provenance.Catalog.Version = CurrentAwsCatalogVersion
	model.Provenance.Catalog.Digest = CurrentAwsCatalogDigest
	bucket := resource("bucket", "uploads", "aws.unreviewed.resource", configuration("aws.unreviewed.resource.configuration", map[string]ConfigurationValue{}))
	model.Resources = append(model.Resources, bucket)
	artifact, diagnostics := renderCloudFormationArtifact(context.Background(), model, nil, DefaultLimits())
	if artifact != nil {
		t.Fatal("unsupported CloudFormation resource produced an artifact")
	}
	diagnostic := diagnosticByCode(t, diagnostics, "CLOUDFORMATION_RESOURCE_UNSUPPORTED")
	if diagnostic.Source.NodeID != bucket.ID {
		t.Fatalf("diagnostic source = %#v", diagnostic.Source)
	}
}

func TestCloudFormationAndTerraformShareApplicationArtifactAndInitialResources(t *testing.T) {
	model := cloudFormationNotesModel("complete-supported-pattern")
	cloudFormation := renderCloudFormationForTest(t, model)
	terraform, diagnostics := renderTerraformArtifact(context.Background(), model, nil, DefaultLimits())
	if hasErrorDiagnostics(diagnostics) || terraform == nil {
		t.Fatalf("Terraform cross-target compile diagnostics = %#v", diagnostics)
	}
	if !reflect.DeepEqual(cloudFormation.ApplicationArtifacts[0].ExpectedArtifact, terraform.ApplicationArtifacts[0].ExpectedArtifact) {
		t.Fatalf("cross-target application artifact mismatch: CloudFormation=%#v Terraform=%#v", cloudFormation.ApplicationArtifacts[0], terraform.ApplicationArtifacts[0])
	}
	terraformBody := ""
	for _, file := range terraform.Files {
		terraformBody += file.Content
	}
	for _, resourceType := range []string{"aws_apigatewayv2_api", "aws_lambda_function", "aws_dynamodb_table", "aws_cognito_user_pool", "aws_iam_role", "aws_cloudwatch_log_group"} {
		if !strings.Contains(terraformBody, resourceType) {
			t.Fatalf("Terraform equivalence evidence missing %q", resourceType)
		}
	}
}

func TestCloudFormationParametersOutputsTagsAndReferences(t *testing.T) {
	model := cloudFormationMinimalModel("user-provided")
	defaultValue := stringValueConfig("test")
	model.Variables = []NormalizedVariable{{ID: "environment_name", Key: "environment_name", ValueType: "string", Required: false, DefaultValue: &defaultValue}}
	model.Workloads[0].Environment = []EnvironmentBinding{{ID: "environment_binding", Name: "ENVIRONMENT_NAME", Kind: "variable-reference", VariableID: "environment_name"}}
	lambda, _ := modelResource(model, "lambda")
	model.Outputs = []NormalizedOutput{
		{ID: "function_arn", Key: "function_arn", Kind: "node-attribute", Resource: &ResourceReference{NodeID: lambda.ID, TargetKey: lambda.TargetKey, Attribute: "arn"}},
		{ID: "environment_output", Key: "environment_name", Kind: "variable", VariableID: "environment_name"},
	}
	artifact := renderCloudFormationForTest(t, model)
	template := decodeCloudFormationTemplate(t, targetFileForTest(t, artifact, cloudFormationTemplatePath).Content)
	parameters := mapAt(t, template, "Parameters")
	foundArchitectureParameter := false
	for _, raw := range parameters {
		parameter := raw.(map[string]any)
		if parameter["Description"] == "Architecture variable environment_name." && parameter["Default"] == "test" {
			foundArchitectureParameter = true
		}
	}
	if !foundArchitectureParameter {
		t.Fatalf("architecture parameter missing from %#v", parameters)
	}
	outputs := mapAt(t, template, "Outputs")
	if len(outputs) != 2 {
		t.Fatalf("outputs = %#v", outputs)
	}
	resources := mapAt(t, template, "Resources")
	lambdaResource := mapAt(t, resources, "NotesHandler")
	lambdaProperties := mapAt(t, lambdaResource, "Properties")
	tags := mapAt(t, lambdaProperties, "Tags")
	if tags["ManagedBy"] != "CloudMarkup" || tags["CloudMarkupArchitecture"] != model.Provenance.ArchitectureID {
		t.Fatalf("Lambda tags = %#v", tags)
	}
	environment := mapAt(t, mapAt(t, lambdaProperties, "Environment"), "Variables")
	assertRef(t, environment["ENVIRONMENT_NAME"])
	terraform, diagnostics := renderTerraformArtifact(context.Background(), model, nil, DefaultLimits())
	assertNoTargetErrors(t, diagnostics)
	if terraform == nil {
		t.Fatal("same normalized variables, outputs, and tags did not produce Terraform")
	}
	terraformBody := ""
	for _, file := range terraform.Files {
		terraformBody += file.Content
	}
	for _, expected := range []string{`variable "environment_name"`, `output "function_arn"`, `ManagedBy`, `"CloudMarkup"`, `CloudMarkupArchitecture`, `"` + model.Provenance.ArchitectureID + `"`} {
		if !strings.Contains(terraformBody, expected) {
			t.Fatalf("Terraform cross-target variables/outputs/tags missing %q", expected)
		}
	}
}

func TestCloudFormationRejectsSensitiveOutputs(t *testing.T) {
	model := cloudFormationMinimalModel("user-provided")
	lambda, _ := modelResource(model, "lambda")
	model.Outputs = []NormalizedOutput{{ID: "secret_output", Key: "secret_output", Kind: "node-attribute", Sensitive: true, Resource: &ResourceReference{NodeID: lambda.ID, TargetKey: lambda.TargetKey, Attribute: "arn"}}}
	artifact, diagnostics := renderCloudFormationArtifact(context.Background(), model, nil, DefaultLimits())
	if artifact != nil {
		t.Fatal("sensitive output produced a CloudFormation artifact")
	}
	diagnosticByCode(t, diagnostics, "CLOUDFORMATION_SENSITIVE_OUTPUT_UNSUPPORTED")
}

func cloudFormationNotesModel(mode string) *NormalizedSolution {
	model := authenticatedNotesModel()
	model.Workloads[0].ImplementationMode = mode
	prepareCloudFormationModel(model)
	return model
}

func cloudFormationMinimalModel(mode string) *NormalizedSolution {
	model := minimalLambdaModel(mode)
	prepareCloudFormationModel(model)
	return model
}

func prepareCloudFormationModel(model *NormalizedSolution) {
	model.Target = TargetReadiness{Target: TargetCloudFormation, ContractVersion: CloudFormationTargetContractVersion, State: "ready", RenderingAvailable: true, Reasons: []string{}}
	model.Provenance.Catalog = CatalogReference{ID: CloudFormationCatalogID, Version: CurrentAwsCatalogVersion, Digest: CurrentAwsCatalogDigest}
	for index := range model.Resources {
		if model.Resources[index].ServiceType == "aws.iam.policy-statement" {
			model.Resources[index].Configuration.SchemaVersion = "2.0.0"
		}
	}
	sortModel(model)
	for index := range model.Workloads {
		workload := &model.Workloads[index]
		if workload.ImplementationMode == "generated-starter" || workload.ImplementationMode == "complete-supported-pattern" {
			workload.GeneratorReadiness = GeneratorReadiness{
				State:      "compatible-interface-only",
				Generator:  &ToolReference{ID: ApplicationGeneratorID, Version: ApplicationGeneratorVersion, Digest: ApplicationGeneratorDigest},
				TemplateID: ApplicationTemplateID, TemplateVersion: ApplicationTemplateVersion,
				Reasons: []string{"APPLICATION_GENERATION_SEPARATE_BOUNDARY_AVAILABLE"},
			}
			if workload.ImplementationMode == "complete-supported-pattern" {
				workload.GenerationCoverage = "complete-supported-pattern"
				workload.TargetReadiness = "application-artifact-ready"
			} else {
				workload.GenerationCoverage = "starter-application"
				workload.TargetReadiness = "application-starter-artifact-ready"
			}
		}
	}
}

func renderCloudFormationForTest(t *testing.T, model *NormalizedSolution) *TargetArtifact {
	t.Helper()
	artifact, diagnostics := renderCloudFormationArtifact(context.Background(), model, nil, DefaultLimits())
	if hasErrorDiagnostics(diagnostics) || artifact == nil {
		t.Fatalf("CloudFormation diagnostics = %#v", diagnostics)
	}
	return artifact
}

func targetFileForTest(t *testing.T, artifact *TargetArtifact, path string) TargetFile {
	t.Helper()
	for _, file := range artifact.Files {
		if file.Path == path {
			return file
		}
	}
	t.Fatalf("target file %q missing", path)
	return TargetFile{}
}

func decodeCloudFormationTemplate(t *testing.T, content string) map[string]any {
	t.Helper()
	var template map[string]any
	if err := json.Unmarshal([]byte(content), &template); err != nil {
		t.Fatal(err)
	}
	return template
}

func mapAt(t *testing.T, value map[string]any, key string) map[string]any {
	t.Helper()
	result, ok := value[key].(map[string]any)
	if !ok {
		t.Fatalf("%s = %T, want object", key, value[key])
	}
	return result
}

func arrayAtAny(t *testing.T, value map[string]any, key string) []any {
	t.Helper()
	result, ok := value[key].([]any)
	if !ok {
		t.Fatalf("%s = %T, want array", key, value[key])
	}
	return result
}

func assertRef(t *testing.T, value any) {
	t.Helper()
	if reference, ok := value.(map[string]any); !ok || reference["Ref"] == "" {
		t.Fatalf("value = %#v, want Ref", value)
	}
}

func assertGetAtt(t *testing.T, value any, logicalID string, attribute string) {
	t.Helper()
	intrinsic, ok := value.(map[string]any)
	if !ok {
		t.Fatalf("value = %#v, want Fn::GetAtt", value)
	}
	if !reflect.DeepEqual(intrinsic["Fn::GetAtt"], []any{logicalID, attribute}) {
		t.Fatalf("Fn::GetAtt = %#v", intrinsic["Fn::GetAtt"])
	}
}

func firstResourceOfType(t *testing.T, resources map[string]any, resourceType string) map[string]any {
	t.Helper()
	for _, raw := range resources {
		resource := raw.(map[string]any)
		if resource["Type"] == resourceType {
			return resource
		}
	}
	t.Fatalf("resource type %q missing", resourceType)
	return nil
}

func diagnosticByCode(t *testing.T, diagnostics []Diagnostic, code string) Diagnostic {
	t.Helper()
	for _, diagnostic := range diagnostics {
		if diagnostic.Code == code {
			return diagnostic
		}
	}
	t.Fatalf("diagnostic %q missing from %#v", code, diagnostics)
	return Diagnostic{}
}

func reverseResources(values []NormalizedResource) {
	for left, right := 0, len(values)-1; left < right; left, right = left+1, right-1 {
		values[left], values[right] = values[right], values[left]
	}
}

func reverseConnections(values []NormalizedConnection) {
	for left, right := 0, len(values)-1; left < right; left, right = left+1, right-1 {
		values[left], values[right] = values[right], values[left]
	}
}

func reversePolicyAttachments(values []PolicyAttachment) {
	for left, right := 0, len(values)-1; left < right; left, right = left+1, right-1 {
		values[left], values[right] = values[right], values[left]
	}
}

func reverseWorkloads(values []NormalizedWorkload) {
	for left, right := 0, len(values)-1; left < right; left, right = left+1, right-1 {
		values[left], values[right] = values[right], values[left]
	}
}
