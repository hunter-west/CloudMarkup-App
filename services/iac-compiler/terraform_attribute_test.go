package compiler

import (
	"context"
	"reflect"
	"strings"
	"testing"
)

func TestTerraformAttributeAliases(t *testing.T) {
	t.Parallel()

	tests := []struct {
		service   string
		attribute string
		provider  string
	}{
		{service: "aws.apigateway.http-api", attribute: "arn", provider: "arn"},
		{service: "aws.apigateway.http-api", attribute: "endpoint", provider: "api_endpoint"},
		{service: "aws.apigateway.http-api", attribute: "executionArn", provider: "execution_arn"},
		{service: "aws.apigateway.http-api", attribute: "execution_arn", provider: "execution_arn"},
		{service: "aws.apigateway.http-api", attribute: "id", provider: "id"},
		{service: "aws.cloudwatch.log-group", attribute: "arn", provider: "arn"},
		{service: "aws.cloudwatch.log-group", attribute: "id", provider: "id"},
		{service: "aws.cloudwatch.log-group", attribute: "name", provider: "name"},
		{service: "aws.cloudwatch.metric-alarm", attribute: "arn", provider: "arn"},
		{service: "aws.cloudwatch.metric-alarm", attribute: "id", provider: "id"},
		{service: "aws.cloudwatch.metric-alarm", attribute: "name", provider: "alarm_name"},
		{service: "aws.cognito.user-pool", attribute: "arn", provider: "arn"},
		{service: "aws.cognito.user-pool", attribute: "endpoint", provider: "endpoint"},
		{service: "aws.cognito.user-pool", attribute: "id", provider: "id"},
		{service: "aws.cognito.user-pool-client", attribute: "id", provider: "id"},
		{service: "aws.dynamodb.table", attribute: "arn", provider: "arn"},
		{service: "aws.dynamodb.table", attribute: "id", provider: "id"},
		{service: "aws.dynamodb.table", attribute: "name", provider: "name"},
		{service: "aws.iam.role", attribute: "arn", provider: "arn"},
		{service: "aws.iam.role", attribute: "id", provider: "id"},
		{service: "aws.iam.role", attribute: "name", provider: "name"},
		{service: serviceKmsKey, attribute: "arn", provider: "arn"},
		{service: serviceKmsKey, attribute: "id", provider: "id"},
		{service: serviceSecret, attribute: "arn", provider: "arn"},
		{service: serviceSecret, attribute: "id", provider: "id"},
		{service: serviceSecret, attribute: "name", provider: "name"},
		{service: "aws.lambda.function", attribute: "arn", provider: "arn"},
		{service: "aws.lambda.function", attribute: "id", provider: "id"},
		{service: "aws.lambda.function", attribute: "invokeArn", provider: "invoke_arn"},
		{service: "aws.lambda.function", attribute: "invoke_arn", provider: "invoke_arn"},
		{service: "aws.lambda.function", attribute: "name", provider: "function_name"},
	}

	for _, test := range tests {
		test := test
		t.Run(test.service+"/"+test.attribute, func(t *testing.T) {
			t.Parallel()
			for _, attribute := range []string{test.attribute, test.service + "." + test.attribute} {
				if got := terraformAttribute(test.service, attribute); got != test.provider {
					t.Fatalf("terraformAttribute(%q, %q) = %q, want %q", test.service, attribute, got, test.provider)
				}
			}
		})
	}

	for _, test := range []struct {
		service   string
		attribute string
	}{
		{service: "aws.dynamodb.table", attribute: "aws.dynamodb.table.stream-arn"},
		{service: "aws.dynamodb.table", attribute: "aws.dynamodb.table.tableName"},
		{service: "aws.dynamodb.table", attribute: "aws.lambda.function.arn"},
		{service: "aws.dynamodb.table", attribute: "stream_arn"},
		{service: "aws.unsupported.resource", attribute: "aws.unsupported.resource.id"},
	} {
		if got := terraformAttribute(test.service, test.attribute); got != "" {
			t.Errorf("unsupported terraformAttribute(%q, %q) = %q", test.service, test.attribute, got)
		}
	}
}

func TestTerraformNamespacedEnvironmentBindingsAreDeterministic(t *testing.T) {
	t.Parallel()

	model := minimalLambdaModel("generated-starter")
	table := dynamoResource("table", "notes_table", "notes")
	model.Resources = append(model.Resources, table)
	model.Workloads[0].Environment = []EnvironmentBinding{
		{ID: "table_arn", Name: "NOTES_TABLE_ARN", Kind: "node-attribute-reference", Resource: terraformTestAttributeReference(table, "aws.dynamodb.table.arn")},
		{ID: "table_bare_name", Name: "NOTES_TABLE_BARE_NAME", Kind: "node-attribute-reference", Resource: terraformTestAttributeReference(table, "name")},
		{ID: "table_id", Name: "NOTES_TABLE_ID", Kind: "node-attribute-reference", Resource: terraformTestAttributeReference(table, "aws.dynamodb.table.id")},
		{ID: "table_name", Name: "NOTES_TABLE_NAME", Kind: "node-attribute-reference", Resource: terraformTestAttributeReference(table, "aws.dynamodb.table.name")},
	}
	sortModel(model)

	artifact, diagnostics := renderTerraformArtifact(context.Background(), model, nil, DefaultLimits())
	assertNoTargetErrors(t, diagnostics)
	if artifact == nil {
		t.Fatal("artifact is nil")
	}
	again, againDiagnostics := renderTerraformArtifact(context.Background(), cloneNormalized(t, model), nil, DefaultLimits())
	assertNoTargetErrors(t, againDiagnostics)
	if !reflect.DeepEqual(artifact, again) {
		t.Fatal("namespaced environment binding render is not byte-identical")
	}

	compute := strings.Join(strings.Fields(fileContent(t, artifact, "infrastructure/compute.tf")), " ")
	for _, fragment := range []string{
		`"NOTES_TABLE_ARN" = aws_dynamodb_table.notes_table.arn`,
		`"NOTES_TABLE_BARE_NAME" = aws_dynamodb_table.notes_table.name`,
		`"NOTES_TABLE_ID" = aws_dynamodb_table.notes_table.id`,
		`"NOTES_TABLE_NAME" = aws_dynamodb_table.notes_table.name`,
	} {
		if !strings.Contains(compute, fragment) {
			t.Errorf("compute.tf missing environment binding %q:\n%s", fragment, compute)
		}
	}
	if strings.Contains(compute, "aws.dynamodb.table.") {
		t.Fatalf("canonical attribute identifier leaked into Terraform traversal:\n%s", compute)
	}
}

func TestTerraformUnsupportedEnvironmentAttributesFailClosed(t *testing.T) {
	t.Parallel()

	for _, referenceOnly := range []bool{false, true} {
		referenceOnly := referenceOnly
		name := "managed"
		if referenceOnly {
			name = "reference-only"
		}
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			model := minimalLambdaModel("generated-starter")
			table := dynamoResource("table", "notes_table", "notes")
			model.Resources = append(model.Resources, table)
			if referenceOnly {
				model.ExternalResources = []NormalizedExternalResource{externalTable("existing-cloud-managed-elsewhere")}
			}
			model.Workloads[0].Environment = []EnvironmentBinding{{
				ID: "table_stream", Name: "NOTES_TABLE_STREAM_ARN", Kind: "node-attribute-reference",
				Resource: terraformTestAttributeReference(table, "aws.dynamodb.table.stream-arn"),
			}}
			sortModel(model)

			artifact, diagnostics := renderTerraformArtifact(context.Background(), model, nil, DefaultLimits())
			if artifact != nil || !hasDiagnostic(diagnostics, "TARGET_RESOURCE_ATTRIBUTE_UNSUPPORTED") {
				t.Fatalf("unsupported environment attribute result = %#v, diagnostics = %#v", artifact, diagnostics)
			}
		})
	}
}

func terraformTestAttributeReference(resource NormalizedResource, attribute string) *ResourceReference {
	reference := reference(resource)
	reference.Attribute = attribute
	return &reference
}
