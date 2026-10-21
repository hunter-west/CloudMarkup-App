package compiler

import (
	"context"
	"fmt"
	"reflect"
	"strings"
	"testing"
)

func TestOwnedRedriveMustMatchExactDLQEdge(t *testing.T) {
	for _, state := range []string{"matching", "conflicting", "standalone"} {
		t.Run(state, func(t *testing.T) {
			for _, target := range []string{"terraform", "cloudformation"} {
				t.Run(target, func(t *testing.T) {
					model := eventQueueConsumerModel()
					source, _ := modelResource(model, "queue_source")
					count := 5
					if state == "conflicting" {
						count = 10
					}
					child := eventResource("owned_redrive", "owned_redrive", "aws.sqs.redrive-configuration", map[string]ConfigurationValue{"maximumReceiveCount": integerValue(count), "redrivePermission": stringValueConfig("BY_QUEUE"), "replayMode": stringValueConfig("MANUAL_REVIEW")})
					model.Resources = append(model.Resources, child)
					model.Connections = append(model.Connections, connection("redrive_owner", "aws.sqs.queue-owns-redrive-configuration", child, source, "aws.sqs.queue-owns-redrive-configuration.connection", nil))
					if state == "standalone" {
						kept := model.Connections[:0]
						for _, c := range model.Connections {
							if c.ID != "edge_queue_dlq" {
								kept = append(kept, c)
							}
						}
						model.Connections = kept
					}
					finalizeEventModel(model)
					render := func() (*TargetArtifact, []Diagnostic) {
						if target == "cloudformation" {
							prepareCuratedCloudFormationModel(model)
							return renderCloudFormationArtifact(context.Background(), model, nil, DefaultLimits())
						}
						return renderTerraformArtifact(context.Background(), model, nil, DefaultLimits())
					}
					first, diagnostics := render()
					if state == "matching" {
						assertNoTargetErrors(t, diagnostics)
						if first == nil {
							t.Fatal("identical owned redrive settings refused")
						}
					} else {
						code := "TARGET_SQS_OWNED_REDRIVE_UNREPRESENTED"
						if target == "cloudformation" {
							code = cloudFormationDiagnosticCode(code)
						}
						if first != nil || !hasDiagnostic(diagnostics, code) {
							t.Fatalf("unrepresented owned redrive settings accepted: %#v", diagnostics)
						}
					}
					second, againDiagnostics := render()
					if !reflect.DeepEqual(first, second) || !reflect.DeepEqual(diagnostics, againDiagnostics) {
						t.Fatal("owned redrive result is not reproducible")
					}
				})
			}
		})
	}
}

func TestLogGroupReservedPrefixParity(t *testing.T) {
	for _, name := range []string{"aws/application", "/aws/lambda/notes-api-handler", "aws-application"} {
		t.Run(name, func(t *testing.T) {
			for _, target := range []string{"terraform", "cloudformation"} {
				t.Run(target, func(t *testing.T) {
					model := eventBaseModel()
					logs, _ := modelResource(authenticatedNotesModel(), "logs")
					model.Resources = append(model.Resources, logs)
					setResourceValue(model, "logs", "logGroupName", stringValueConfig(name))
					var artifact *TargetArtifact
					var diagnostics []Diagnostic
					code := "TARGET_LOG_GROUP_NAME_RESERVED"
					if target == "cloudformation" {
						prepareCuratedCloudFormationModel(model)
						code = cloudFormationDiagnosticCode(code)
						artifact, diagnostics = renderCloudFormationArtifact(context.Background(), model, nil, DefaultLimits())
					} else {
						artifact, diagnostics = renderTerraformArtifact(context.Background(), model, nil, DefaultLimits())
					}
					if strings.HasPrefix(name, "aws/") {
						if artifact != nil || !hasDiagnostic(diagnostics, code) {
							t.Fatalf("reserved log group name accepted: %#v", diagnostics)
						}
					} else {
						assertNoTargetErrors(t, diagnostics)
						if artifact == nil {
							t.Fatal("allowed log group name refused")
						}
					}
				})
			}
		})
	}
}

func TestCloudFormationRedriveExactNamesWithoutDependencyCycle(t *testing.T) {
	for _, test := range []struct {
		name, queueType, sourceName, dlqName string
		count                                int
	}{
		{"standard", "STANDARD", "reviewed-work", "reviewed-dlq", 1},
		{"fifo-add-suffix", "FIFO", "reviewed-work", "reviewed-dlq", 1},
		{"fifo-preserve-suffix", "FIFO", "reviewed-work.fifo", "reviewed-dlq.fifo", 1},
		{"multiple-exact-sources", "STANDARD", "reviewed-work", "reviewed-dlq", 10},
	} {
		t.Run(test.name, func(t *testing.T) {
			model := queueRedriveModelWithSources(test.count)
			setResourceValue(model, "queue_source", "queueType", stringValueConfig(test.queueType))
			setResourceValue(model, "queue_source", "queueName", stringValueConfig(test.sourceName))
			setResourceValue(model, "queue_dlq", "queueType", stringValueConfig(test.queueType))
			setResourceValue(model, "queue_dlq", "queueName", stringValueConfig(test.dlqName))
			if test.queueType == "FIFO" {
				mutateConnection(model, "edge_queue_consumer", func(edge *NormalizedConnection) { edge.Configuration.Values["batchingWindowSeconds"] = integerValue(0) })
			}
			model.Resources = append(model.Resources, eventQueue("queue_unrelated", "unrelated_queue", "must-not-be-authorized", test.queueType))
			prepareCuratedCloudFormationModel(model)
			first := renderCloudFormationForTest(t, model)
			second := renderCloudFormationForTest(t, cloneNormalized(t, model))
			if !reflect.DeepEqual(first, second) {
				t.Fatal("redrive artifact changed on repeated compilation")
			}
			resources := mapAt(t, decodeCloudFormationTemplate(t, targetFileForTest(t, first, cloudFormationTemplatePath).Content), "Resources")
			dlqID, dlq := resourceForGraphID(t, resources, "queue_dlq")
			allow := mapAt(t, mapAt(t, dlq, "Properties"), "RedriveAllowPolicy")
			if allow["redrivePermission"] != "byQueue" {
				t.Fatalf("redrive permission widened: %#v", allow)
			}
			arns := arrayAtAny(t, allow, "sourceQueueArns")
			if len(arns) != test.count {
				t.Fatalf("authorized queue count = %d, want %d", len(arns), test.count)
			}
			for _, partition := range []string{"aws", "aws-us-gov", "aws-cn"} {
				actual := map[string]bool{}
				for _, arn := range arns {
					actual[resolveQueueARNForTest(t, arn, partition)] = true
				}
				expected := map[string]bool{}
				for index := 1; index <= test.count; index++ {
					sourceID := "queue_source"
					if index > 1 {
						sourceID = fmt.Sprintf("queue_source_%d", index)
					}
					_, source := resourceForGraphID(t, resources, sourceID)
					properties := mapAt(t, source, "Properties")
					redrive := mapAt(t, properties, "RedrivePolicy")
					if !reflect.DeepEqual(redrive["deadLetterTargetArn"], map[string]any{"Fn::GetAtt": []any{dlqID, "Arn"}}) || redrive["maxReceiveCount"] != float64(5) {
						t.Fatalf("source redrive changed: %#v", redrive)
					}
					expected[fmt.Sprintf("arn:%s:sqs:us-east-1:123456789012:%s", partition, properties["QueueName"])] = true
				}
				if !reflect.DeepEqual(actual, expected) {
					t.Fatalf("redrive source scope = %#v, want %#v", actual, expected)
				}
			}
			_, source := resourceForGraphID(t, resources, "queue_source")
			expectedName := test.sourceName
			if test.queueType == "FIFO" && !strings.HasSuffix(expectedName, ".fifo") {
				expectedName += ".fifo"
			}
			if mapAt(t, source, "Properties")["QueueName"] != expectedName {
				t.Fatal("explicit queue name or FIFO suffix changed")
			}
			assertQueueRedriveAndPartialBatch(t, resources)
			assertNoCloudFormationResourceCycle(t, resources)
		})
	}
}

func TestCloudFormationRedriveRejectsMoreThanTenSources(t *testing.T) {
	model := queueRedriveModelWithSources(11)
	prepareCuratedCloudFormationModel(model)
	artifact, diagnostics := renderCloudFormationArtifact(context.Background(), model, nil, DefaultLimits())
	if artifact != nil {
		t.Fatal("oversized byQueue allow list produced an artifact")
	}
	if diagnosticByCode(t, diagnostics, "CLOUDFORMATION_SQS_REDRIVE_SOURCE_LIMIT").Source.NodeID != "queue_dlq" {
		t.Fatal("redrive limit diagnostic lost exact DLQ identity")
	}
}

func queueRedriveModelWithSources(count int) *NormalizedSolution {
	model := eventQueueConsumerModel()
	dlq, _ := modelResource(model, "queue_dlq")
	for index := 2; index <= count; index++ {
		source := eventQueue(fmt.Sprintf("queue_source_%d", index), fmt.Sprintf("work_queue_%d", index), fmt.Sprintf("reviewed-work-%d", index), "STANDARD")
		model.Resources = append(model.Resources, source)
		model.Connections = append(model.Connections, connection(fmt.Sprintf("edge_queue_dlq_%d", index), "aws.sqs.uses-dead-letter-queue", source, dlq, "aws.sqs.redrive.connection", map[string]ConfigurationValue{"maximumReceiveCount": integerValue(5), "replayMode": stringValueConfig("MANUAL_REVIEW")}))
	}
	return model
}

func TestCloudFormationLambdaRenamePreservesConnectedLogging(t *testing.T) {
	for _, name := range []string{"notes-api-handler", "qa-01-notes-api-reviewed", "qa-02-queue-worker-reviewed"} {
		t.Run(name, func(t *testing.T) {
			model := cloudFormationNotesModel("complete-supported-pattern")
			setResourceValue(model, "lambda", "functionName", stringValueConfig(name))
			artifact := renderCloudFormationForTest(t, model)
			if !reflect.DeepEqual(artifact, renderCloudFormationForTest(t, cloneNormalized(t, model))) {
				t.Fatal("logging artifact changed on repeat")
			}
			resources := mapAt(t, decodeCloudFormationTemplate(t, targetFileForTest(t, artifact, cloudFormationTemplatePath).Content), "Resources")
			logID, log := resourceForGraphID(t, resources, "logs")
			_, lambda := resourceForGraphID(t, resources, "lambda")
			properties := mapAt(t, lambda, "Properties")
			if properties["FunctionName"] != name || !reflect.DeepEqual(mapAt(t, properties, "LoggingConfig")["LogGroup"], map[string]any{"Ref": logID}) {
				t.Fatalf("renamed function lost exact logging binding: %#v", properties)
			}
			if mapAt(t, log, "Properties")["LogGroupName"] != "/aws/lambda/notes-api-handler" {
				t.Fatal("configured log group was renamed implicitly")
			}
			_, role := resourceForGraphID(t, resources, "role")
			scoped := false
			for _, rawPolicy := range arrayAtAny(t, mapAt(t, role, "Properties"), "Policies") {
				policy := rawPolicy.(map[string]any)
				for _, rawStatement := range arrayAtAny(t, mapAt(t, policy, "PolicyDocument"), "Statement") {
					statement := rawStatement.(map[string]any)
					for _, rawAction := range arrayAtAny(t, statement, "Action") {
						if rawAction == "logs:PutLogEvents" {
							if !reflect.DeepEqual(statement["Resource"], []any{map[string]any{"Fn::GetAtt": []any{logID, "Arn"}}}) {
								t.Fatalf("log policy scope widened: %#v", statement)
							}
							scoped = true
						}
					}
				}
			}
			if !scoped {
				t.Fatal("exact log-delivery policy missing")
			}
			assertNoCloudFormationResourceCycle(t, resources)
		})
	}
}

func TestCloudFormationLambdaLoggingDoesNotInferOrIgnoreConnections(t *testing.T) {
	model := cloudFormationMinimalModel("generated-starter")
	artifact := renderCloudFormationForTest(t, model)
	resources := mapAt(t, decodeCloudFormationTemplate(t, targetFileForTest(t, artifact, cloudFormationTemplatePath).Content), "Resources")
	if _, exists := mapAt(t, resourceOfType(t, resources, "AWS::Lambda::Function"), "Properties")["LoggingConfig"]; exists {
		t.Fatal("unconnected log destination was inferred")
	}
	model = cloudFormationNotesModel("complete-supported-pattern")
	logs, _ := modelResource(model, "logs")
	duplicate := logs
	duplicate.ID, duplicate.DeploymentKey = "logs_duplicate", "logs_duplicate"
	model.Resources = append(model.Resources, duplicate)
	lambda, _ := modelResource(model, "lambda")
	model.Connections = append(model.Connections, connection("edge_lambda_logs_duplicate", "aws.lambda.writes-log-group", lambda, duplicate, "aws.lambda.cloudwatch-logs.connection", map[string]ConfigurationValue{"deliveryMode": stringValueConfig("application-logs")}))
	role, _ := modelResource(model, "role")
	addPolicy(model, "generated_duplicate_logs_policy", "generated-permission", role, "aws.iam.role-owns-generated-permission", []string{"logs:CreateLogStream", "logs:PutLogEvents"}, "none", nil, &duplicate, true, []string{"edge_lambda_logs_duplicate"})
	sortModel(model)
	artifact, diagnostics := renderCloudFormationArtifact(context.Background(), model, nil, DefaultLimits())
	if artifact != nil {
		t.Fatal("ambiguous log connections produced an artifact")
	}
	diagnosticByCode(t, diagnostics, "CLOUDFORMATION_LAMBDA_LOG_GROUP_AMBIGUOUS")
}

func resourceForGraphID(t *testing.T, resources map[string]any, graphID string) (string, map[string]any) {
	t.Helper()
	for id, raw := range resources {
		resource := raw.(map[string]any)
		metadata, _ := resource["Metadata"].(map[string]any)
		cloudMarkup, _ := metadata["CloudMarkup"].(map[string]any)
		if cloudMarkup["GraphId"] == graphID {
			return id, resource
		}
	}
	t.Fatalf("resource for graph identity %s missing", graphID)
	return "", nil
}

func resolveQueueARNForTest(t *testing.T, raw any, partition string) string {
	t.Helper()
	join := arrayAtAny(t, raw.(map[string]any), "Fn::Join")
	if join[0] != "" {
		t.Fatal("unexpected ARN separator")
	}
	var result strings.Builder
	for _, value := range join[1].([]any) {
		if literal, ok := value.(string); ok {
			result.WriteString(literal)
			continue
		}
		reference := value.(map[string]any)["Ref"]
		switch reference {
		case "AWS::Partition":
			result.WriteString(partition)
		case "AWS::Region":
			result.WriteString("us-east-1")
		case "AWS::AccountId":
			result.WriteString("123456789012")
		default:
			t.Fatalf("ARN unexpectedly depends on a resource or unknown reference: %#v", value)
		}
	}
	return result.String()
}

func assertNoCloudFormationResourceCycle(t *testing.T, resources map[string]any) {
	t.Helper()
	dependencies := map[string]map[string]bool{}
	var collect func(any, map[string]bool)
	collect = func(raw any, result map[string]bool) {
		switch value := raw.(type) {
		case map[string]any:
			if reference, ok := value["Ref"].(string); ok && resources[reference] != nil {
				result[reference] = true
			}
			if attribute, ok := value["Fn::GetAtt"].([]any); ok && len(attribute) > 0 {
				if reference, ok := attribute[0].(string); ok && resources[reference] != nil {
					result[reference] = true
				}
			}
			for _, nested := range value {
				collect(nested, result)
			}
		case []any:
			for _, nested := range value {
				collect(nested, result)
			}
		}
	}
	for id, raw := range resources {
		dependencies[id] = map[string]bool{}
		collect(raw, dependencies[id])
	}
	visited, active := map[string]bool{}, map[string]bool{}
	var visit func(string)
	visit = func(id string) {
		if active[id] {
			t.Fatalf("implicit resource dependency cycle reaches %s", id)
		}
		if visited[id] {
			return
		}
		active[id] = true
		for dependency := range dependencies[id] {
			visit(dependency)
		}
		active[id] = false
		visited[id] = true
	}
	for id := range resources {
		visit(id)
	}
}
