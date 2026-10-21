package compiler

import (
	"encoding/json"
	"reflect"
	"sort"
	"testing"
)

type prompt30Inventory struct {
	ContractVersion int `json:"contractVersion"`
	Fixtures        []struct {
		ID      string   `json:"id"`
		Layers  []string `json:"layers"`
		Support string   `json:"support"`
	} `json:"fixtures"`
}

func prompt30SupportedIACFixtures() []prompt30Fixture {
	api := prompt30APILambdaModel(true)
	authorized := prompt30APILambdaModel(true)
	readOnly := prompt30TableModel(false, false)
	readWrite := prompt30TableModel(true, false)
	multiple := prompt30TableModel(true, true)
	custom := prompt30CustomPolicyModel(false)
	generatedCustom := prompt30CustomPolicyModel(true)
	complete := authenticatedNotesModel()
	adoption := clonePrompt30Model(complete)
	adoption.ExternalResources = []NormalizedExternalResource{externalTable("imported-current-iac-lifecycle")}
	deletion := clonePrompt30Model(complete)
	removePolicyClosure(deletion, "generated_read_policy", true)
	sortModel(deletion)
	collision := minimalLambdaModel("generated-starter")
	collision.Resources = append(collision.Resources,
		dynamoResource("table_alpha", "shared_table", "alpha"),
		dynamoResource("table_beta", "shared_table", "beta"),
	)
	sortModel(collision)
	networkingLowCost := lowCostEndpointTerraformModel()
	networkingTwoAZ := networkingTerraformModel()

	return []prompt30Fixture{
		{id: "api-gateway-lambda", model: api, mustContain: map[string][]string{
			"infrastructure/compute.tf":  {`resource "aws_apigatewayv2_api" "notes_api"`, `resource "aws_apigatewayv2_integration"`},
			"infrastructure/security.tf": {`resource "aws_lambda_permission"`},
		}},
		{id: "cognito-authorized-api", model: authorized, mustContain: map[string][]string{
			"infrastructure/compute.tf":  {`resource "aws_apigatewayv2_authorizer"`, `authorization_type = "JWT"`},
			"infrastructure/identity.tf": {`resource "aws_cognito_user_pool"`, `resource "aws_cognito_user_pool_client"`},
		}},
		{id: "complete-supported-notes-api", model: complete, expectedActions: []string{
			"dynamodb:DeleteItem", "dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:Query", "dynamodb:UpdateItem", "lambda:InvokeFunction", "logs:CreateLogStream", "logs:PutLogEvents",
		}},
		{id: "custom-inline-iam-policy", model: custom, mustContain: map[string][]string{
			"infrastructure/security.tf": {`resource "aws_iam_role_policy" "custom_policy"`, "dynamodb:GetItem"},
		}},
		{id: "generated-plus-custom-policies", model: generatedCustom, mustContain: map[string][]string{
			"infrastructure/security.tf": {`resource "aws_iam_role_policy" "custom_policy"`, `resource "aws_iam_role_policy" "generated_read_policy"`},
		}},
		{id: "generated-resource-adoption", model: adoption, mustContain: map[string][]string{
			"infrastructure/data.tf": {`import {`, `id = "notes-existing"`, `to = aws_dynamodb_table.notes_table`},
		}},
		{id: "generated-resource-deletion", model: deletion, mustNotContain: map[string][]string{
			"infrastructure/security.tf": {"generated_read_policy", "dynamodb:Query"},
		}, mustContain: map[string][]string{
			"infrastructure/security.tf": {"generated_write_policy", "dynamodb:PutItem"},
		}},
		{id: "generated-starter-lambda", model: minimalLambdaModel("generated-starter")},
		{id: "lambda-dynamodb-read-only", model: readOnly, expectedActions: []string{"dynamodb:GetItem", "dynamodb:Query"}},
		{id: "lambda-dynamodb-read-write", model: readWrite, expectedActions: []string{"dynamodb:DeleteItem", "dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:Query", "dynamodb:UpdateItem"}},
		{id: "minimal-lambda-infrastructure-only", model: minimalLambdaModel("infrastructure-only")},
		{id: "multiple-downstream-dependencies", model: multiple, mustContain: map[string][]string{
			"infrastructure/data.tf": {`resource "aws_dynamodb_table" "notes_read_table"`, `resource "aws_dynamodb_table" "notes_write_table"`},
		}},
		{id: "networking-low-cost-endpoint-serverless", model: networkingLowCost, mustContain: map[string][]string{
			"infrastructure/networking.tf": {`resource "aws_vpc_endpoint" "s3_endpoint"`, `route_table_ids   = [aws_route_table.private_a_routes.id, aws_route_table.private_b_routes.id]`},
			"infrastructure/compute.tf":    {`vpc_config {`, `subnet_ids                  = [aws_subnet.private_a_subnet.id, aws_subnet.private_b_subnet.id]`},
		}, mustNotContain: map[string][]string{
			"infrastructure/networking.tf": {`resource "aws_nat_gateway"`, `resource "aws_internet_gateway"`, `resource "aws_eip"`},
		}},
		{id: "networking-two-az-public-private", model: networkingTwoAZ, mustContain: map[string][]string{
			"infrastructure/networking.tf": {`resource "aws_vpc" "application"`, `resource "aws_nat_gateway" "nat_a"`, `resource "aws_nat_gateway" "nat_b"`, `resource "aws_vpc_endpoint" "s3_endpoint"`},
			"infrastructure/security.tf":   {`resource "aws_security_group" "application"`, `resource "aws_vpc_security_group_ingress_rule"`},
			"infrastructure/compute.tf":    {`vpc_config {`, `depends_on = [aws_iam_role_policy_attachment.lambda_vpc_access]`},
		}, mustNotContain: map[string][]string{
			"infrastructure/networking.tf": {`resource "aws_eip"`},
		}},
		{id: "naming-collisions", model: collision, mustContain: map[string][]string{
			"infrastructure/data.tf": {`resource "aws_dynamodb_table" "shared_table_`},
		}},
		{id: "user-provided-lambda-artifact", model: minimalLambdaModel("user-provided")},
	}
}

func prompt30APILambdaModel(authorized bool) *NormalizedSolution {
	model := authenticatedNotesModel()
	allowed := []string{"role", "lambda", "trust_policy", "trust_policy_statement", "api", "api_permission", "api_permission_statement"}
	if authorized {
		allowed = append(allowed, "pool", "client")
	}
	projectPrompt30Model(model, allowed)
	if !authorized {
		for index := range model.Resources {
			if model.Resources[index].ID == "api" {
				model.Resources[index].Configuration.Values["jwtAuthorizationRequired"] = boolValue(false)
			}
		}
	}
	sortModel(model)
	return model
}

func prompt30TableModel(includeWrite, separate bool) *NormalizedSolution {
	model := minimalLambdaModel("complete-supported-pattern")
	lambda, _ := modelResource(model, "lambda")
	role, _ := modelResource(model, "role")
	readTable := dynamoResource("read_table", "notes_read_table", "notes-read")
	writeTable := readTable
	if separate {
		writeTable = dynamoResource("write_table", "notes_write_table", "notes-write")
	}
	model.Resources = append(model.Resources, readTable)
	read := connection("edge_lambda_reads", "aws.lambda.reads-dynamodb-table", lambda, readTable, "aws.lambda.dynamodb-read.connection", map[string]ConfigurationValue{"consistentRead": boolValue(false)})
	model.Connections = append(model.Connections, read)
	addPolicy(model, "generated_read_policy", "generated-permission", role, "aws.iam.role-owns-generated-permission", []string{"dynamodb:GetItem", "dynamodb:Query"}, "none", nil, &readTable, true, []string{read.ID})
	if includeWrite {
		if separate {
			model.Resources = append(model.Resources, writeTable)
		}
		write := connection("edge_lambda_writes", "aws.lambda.writes-dynamodb-table", lambda, writeTable, "aws.lambda.dynamodb-write.connection", nil)
		model.Connections = append(model.Connections, write)
		addPolicy(model, "generated_write_policy", "generated-permission", role, "aws.iam.role-owns-generated-permission", []string{"dynamodb:DeleteItem", "dynamodb:PutItem", "dynamodb:UpdateItem"}, "none", nil, &writeTable, true, []string{write.ID})
	}
	sortModel(model)
	return model
}

func prompt30CustomPolicyModel(includeGenerated bool) *NormalizedSolution {
	model := minimalLambdaModel("complete-supported-pattern")
	lambda, _ := modelResource(model, "lambda")
	role, _ := modelResource(model, "role")
	table := dynamoResource("table", "notes_table", "notes")
	model.Resources = append(model.Resources, table)
	addPolicy(model, "custom_policy", "identity-inline", role, "aws.iam.role-owns-inline-policy", []string{"dynamodb:GetItem"}, "none", nil, &table, false, nil)
	if includeGenerated {
		read := connection("edge_lambda_reads", "aws.lambda.reads-dynamodb-table", lambda, table, "aws.lambda.dynamodb-read.connection", map[string]ConfigurationValue{"consistentRead": boolValue(false)})
		model.Connections = append(model.Connections, read)
		addPolicy(model, "generated_read_policy", "generated-permission", role, "aws.iam.role-owns-generated-permission", []string{"dynamodb:GetItem", "dynamodb:Query"}, "none", nil, &table, true, []string{read.ID})
	}
	sortModel(model)
	return model
}

func projectPrompt30Model(model *NormalizedSolution, allowedIDs []string) {
	allowed := map[string]bool{}
	for _, id := range allowedIDs {
		allowed[id] = true
	}
	resources := make([]NormalizedResource, 0, len(model.Resources))
	for _, resource := range model.Resources {
		if allowed[resource.ID] {
			resources = append(resources, resource)
		}
	}
	connections := make([]NormalizedConnection, 0, len(model.Connections))
	for _, connection := range model.Connections {
		if allowed[connection.Source.NodeID] && allowed[connection.Target.NodeID] {
			connections = append(connections, connection)
		}
	}
	attachments := make([]PolicyAttachment, 0, len(model.PolicyAttachments))
	for _, attachment := range model.PolicyAttachments {
		if allowed[attachment.ResourceID] {
			attachments = append(attachments, attachment)
		}
	}
	model.Resources = resources
	model.Connections = connections
	model.PolicyAttachments = attachments
}

func assertPrompt30IACInventory(t *testing.T, fixtures []prompt30Fixture) {
	t.Helper()
	inventory := readPrompt30Inventory(t)
	want := map[string]bool{}
	for _, fixture := range inventory.Fixtures {
		if fixture.Support == "supported" && containsPrompt30String(fixture.Layers, "iac") {
			want[fixture.ID] = true
		}
	}
	got := map[string]bool{}
	for _, fixture := range fixtures {
		got[fixture.id] = true
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("supported IaC golden fixture set = %#v, inventory = %#v", got, want)
	}
}

func containsPrompt30String(values []string, wanted string) bool {
	for _, value := range values {
		if value == wanted {
			return true
		}
	}
	return false
}

func reversePrompt30Values(values []any) {
	for left, right := 0, len(values)-1; left < right; left, right = left+1, right-1 {
		values[left], values[right] = values[right], values[left]
	}
}

func reversePrompt30Model(model *NormalizedSolution) {
	for left, right := 0, len(model.Resources)-1; left < right; left, right = left+1, right-1 {
		model.Resources[left], model.Resources[right] = model.Resources[right], model.Resources[left]
	}
	for left, right := 0, len(model.Connections)-1; left < right; left, right = left+1, right-1 {
		model.Connections[left], model.Connections[right] = model.Connections[right], model.Connections[left]
	}
	for left, right := 0, len(model.PolicyAttachments)-1; left < right; left, right = left+1, right-1 {
		model.PolicyAttachments[left], model.PolicyAttachments[right] = model.PolicyAttachments[right], model.PolicyAttachments[left]
	}
}

func clonePrompt30Model(model *NormalizedSolution) *NormalizedSolution {
	encoded, err := json.Marshal(model)
	if err != nil {
		panic(err)
	}
	var clone NormalizedSolution
	if err := json.Unmarshal(encoded, &clone); err != nil {
		panic(err)
	}
	return &clone
}

func sortedPrompt30Keys(values map[string]string) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}
