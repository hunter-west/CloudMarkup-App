package compiler

import (
	"context"
	"encoding/json"
	"fmt"
	"reflect"
	"strings"
	"testing"
)

func TestEventApplicationArtifactReadinessRequiresExactBuildEvidence(t *testing.T) {
	t.Parallel()

	exactReadiness := GeneratorReadiness{
		State: "compatible-interface-only",
		Generator: &ToolReference{
			ID: EventApplicationGeneratorID, Version: EventApplicationGeneratorVersion, Digest: EventApplicationGeneratorDigest,
		},
		TemplateID: EventApplicationTemplateID, TemplateVersion: EventApplicationTemplateVersion,
		Reasons: []string{"APPLICATION_GENERATION_SEPARATE_BOUNDARY_AVAILABLE"},
	}
	eventCatalog := CatalogReference{ID: TerraformCatalogID, Version: CurrentAwsCatalogVersion, Digest: CurrentAwsCatalogDigest}
	coverage := solutionWorkloadCoverageWire{
		WorkloadID: "workload_worker",
		State:      "complete-supported-pattern",
		Evidence: []solutionGenerationCoverageEvidenceWire{
			{EvidenceID: "evidence_generation", Requirement: "deterministic-application-generation"},
			{EvidenceID: "evidence_build", Requirement: "application-build-and-tests"},
			{EvidenceID: "evidence_security", Requirement: "application-security-checks"},
		},
		MissingRequirements:      []string{},
		UnresolvedRequirementIDs: []string{},
	}
	workload := workloadWire{Implementation: workloadImplementationWire{Mode: "complete-supported-pattern"}}
	if got := generatedArtifactTargetReadiness(eventCatalog, workload, coverage, true, exactReadiness); got != "application-artifact-ready" {
		t.Fatalf("complete readiness = %q, want application-artifact-ready", got)
	}
	starterWorkload := workload
	starterWorkload.Implementation.Mode = "generated-starter"
	starterCoverage := coverage
	starterCoverage.State = "starter-application"
	if got := generatedArtifactTargetReadiness(eventCatalog, starterWorkload, starterCoverage, true, exactReadiness); got != "application-starter-artifact-ready" {
		t.Fatalf("starter readiness = %q, want application-starter-artifact-ready", got)
	}

	missingBuild := coverage
	missingBuild.Evidence = append([]solutionGenerationCoverageEvidenceWire(nil), coverage.Evidence[:2]...)
	if got := generatedArtifactTargetReadiness(eventCatalog, workload, missingBuild, true, exactReadiness); got != "application-artifact-evidence-incomplete" {
		t.Fatalf("missing-build readiness = %q", got)
	}
	missingBuild = coverage
	missingBuild.MissingRequirements = []string{"application-build-and-tests"}
	if got := generatedArtifactTargetReadiness(eventCatalog, workload, missingBuild, true, exactReadiness); got != "application-artifact-evidence-incomplete" {
		t.Fatalf("explicit missing-build readiness = %q", got)
	}
	unreviewed := exactReadiness
	unreviewed.Generator = &ToolReference{ID: "cloudmarkup.unreviewed-generator", Version: "1.0.0", Digest: digestOf('f')}
	if got := generatedArtifactTargetReadiness(eventCatalog, workload, coverage, true, unreviewed); got != "application-artifact-evidence-incomplete" {
		t.Fatalf("unreviewed-generator readiness = %q", got)
	}
	workload.UnresolvedRequirementIDs = []string{"requirement_custom_transform"}
	if got := generatedArtifactTargetReadiness(eventCatalog, workload, coverage, true, exactReadiness); got != "application-artifact-evidence-incomplete" {
		t.Fatalf("unresolved complete-pattern readiness = %q", got)
	}
}

func TestTerraformEventApplicationBindsFinalZIPAndRequiresEvidence(t *testing.T) {
	t.Parallel()

	ready := readyEventApplicationModel()
	artifact, diagnostics := renderTerraformArtifact(context.Background(), ready, nil, DefaultLimits())
	assertNoTargetErrors(t, diagnostics)
	if hasDiagnostic(diagnostics, "APPLICATION_GENERATION_PENDING") {
		t.Fatalf("ready event artifact retained pending diagnostic: %#v", diagnostics)
	}
	if artifact == nil || len(artifact.ApplicationArtifacts) != 1 {
		t.Fatalf("application artifacts = %#v", artifact)
	}
	contract := artifact.ApplicationArtifacts[0]
	expectedPath := "application/artifacts/" + portableArtifactSegment(contract.WorkloadID) + "/function.zip"
	expectedTerraformPath := "../" + expectedPath
	if contract.ContractVersion != ApplicationArtifactTargetNeutralContractVersion ||
		contract.ArtifactReadiness != "application-artifact-ready" ||
		contract.RelativePackagePath != expectedTerraformPath ||
		contract.ExpectedArtifact == nil {
		t.Fatalf("ready application artifact contract = %#v", contract)
	}
	expected := contract.ExpectedArtifact
	if expected.ArtifactID != "artifact_"+portableArtifactSegment(contract.WorkloadID) ||
		expected.Kind != ApplicationArtifactKind ||
		expected.MediaType != ApplicationArtifactMediaType ||
		expected.Path != expectedPath ||
		expected.ArchiveEntrypoint != ApplicationArchiveEntrypoint ||
		expected.Handler != ApplicationLambdaHandler ||
		expected.DigestAlgorithm != ApplicationArtifactDigestAlgorithm ||
		expected.Runtime.ID != ApplicationRuntimeID ||
		expected.Runtime.Version != ApplicationRuntimeVersion ||
		expected.Runtime.Digest != ApplicationRuntimeDigest ||
		expected.Runtime.Runtime != ApplicationLambdaRuntime ||
		expected.Runtime.Handler != ApplicationLambdaHandler ||
		expected.Runtime.ModuleFormat != "esm" {
		t.Fatalf("target-neutral expected artifact = %#v", expected)
	}
	compute := fileContent(t, artifact, "infrastructure/compute.tf")
	variables := fileContent(t, artifact, "infrastructure/variables.tf")
	if !strings.Contains(compute, "filebase64sha256(var.") ||
		!strings.Contains(variables, `default     = "`+expectedTerraformPath+`"`) {
		t.Fatalf("final ZIP binding missing from Terraform\ncompute:\n%s\nvariables:\n%s", compute, variables)
	}
	for _, file := range artifact.Files {
		if strings.Contains(file.Content, "depends_on") {
			t.Fatalf("%s contains arbitrary depends_on", file.Path)
		}
	}
	again, againDiagnostics := renderTerraformArtifact(context.Background(), ready, nil, DefaultLimits())
	assertNoTargetErrors(t, againDiagnostics)
	if !reflect.DeepEqual(artifact, again) {
		t.Fatal("ready final artifact binding is not byte-reproducible")
	}

	incomplete := readyEventApplicationModel()
	incomplete.Workloads[0].TargetReadiness = "application-artifact-evidence-incomplete"
	incompleteArtifact, incompleteDiagnostics := renderTerraformArtifact(context.Background(), incomplete, nil, DefaultLimits())
	assertNoTargetErrors(t, incompleteDiagnostics)
	if !hasDiagnostic(incompleteDiagnostics, "APPLICATION_GENERATION_PENDING") ||
		incompleteArtifact.ApplicationArtifacts[0].ArtifactReadiness != "application-artifact-evidence-incomplete" {
		t.Fatalf("incomplete artifact diagnostics=%#v contract=%#v", incompleteDiagnostics, incompleteArtifact.ApplicationArtifacts)
	}

}

func TestTerraformEventingRendersCuratedPatternsDeterministically(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name         string
		model        *NormalizedSolution
		eventing     []string
		security     []string
		mustNotMatch []string
	}{
		{
			name:  "image-upload-notification",
			model: eventS3LambdaModel(),
			eventing: []string{
				`resource "aws_s3_bucket" "uploads"`,
				`resource "aws_s3_bucket_notification" "uploads"`,
				`filter_prefix = "incoming/"`,
				`filter_suffix = ".jpg"`,
			},
			security: []string{`principal     = "s3.amazonaws.com"`, `source_account`, `aws_s3_bucket.uploads.arn`},
		},
		{
			name:  "scheduled-workflow-target",
			model: eventScheduleModel(),
			eventing: []string{
				`data "aws_cloudwatch_event_bus" "default_bus"`,
				`schedule_expression = "rate(1 hour)"`,
				`resource "aws_cloudwatch_event_target" "scheduled_target"`,
				`maximum_retry_attempts       = 10`,
			},
			security: []string{`principal     = "events.amazonaws.com"`, `aws_cloudwatch_event_rule.hourly.arn`},
		},
		{
			name:  "event-pattern-lambda-target",
			model: eventPatternTargetModel(),
			eventing: []string{
				`event_pattern = "{\"detail-type\":[\"Application Event\"],\"source\":[\"cloudmarkup.application\"]}"`,
				`resource "aws_cloudwatch_event_target" "scheduled_target"`,
			},
			security:     []string{`principal     = "events.amazonaws.com"`, `aws_cloudwatch_event_rule.hourly.arn`},
			mustNotMatch: []string{"schedule_expression"},
		},
		{
			name:         "custom-bus-event-pattern",
			model:        eventCustomBusPatternModel(),
			eventing:     []string{`resource "aws_cloudwatch_event_bus" "default_bus"`, `event_bus_name = aws_cloudwatch_event_bus.default_bus.name`, `event_pattern`},
			security:     []string{`events.amazonaws.com`, `aws_cloudwatch_event_rule.hourly.arn`},
			mustNotMatch: []string{"schedule_expression"},
		},
		{
			name:  "step-functions-lambda-task",
			model: eventStepFunctionsModel(),
			eventing: []string{
				`resource "aws_sfn_state_machine" "image_workflow"`,
				`resource "aws_cloudwatch_log_group" "image_workflow_logs"`,
				`definition = jsonencode`,
				`MaxAttempts = 2`,
				`aws_lambda_function.notes_handler.arn`,
			},
			security:     []string{`identifiers = ["states.amazonaws.com"]`, `lambda:InvokeFunction`, `aws_lambda_function.notes_handler.arn`},
			mustNotMatch: []string{`MaxAttempts = 3`},
		},
		{
			name:  "step-functions-lambda-task-no-retry",
			model: eventStepFunctionsNoRetryModel(),
			eventing: []string{
				`resource "aws_sfn_state_machine" "image_workflow"`,
				`TimeoutSeconds = 60`,
				`aws_lambda_function.notes_handler.arn`,
			},
			security:     []string{`identifiers = ["states.amazonaws.com"]`, `lambda:InvokeFunction`, `aws_lambda_function.notes_handler.arn`},
			mustNotMatch: []string{`Retry`, `MaxAttempts`},
		},
		{
			name:  "image-upload-queue-metadata-path",
			model: eventImageQueueMetadataModel(),
			eventing: []string{
				`resource "aws_s3_bucket_notification" "uploads"`,
				`eventbridge = true`,
				`event_pattern = "{\"detail-type\":[\"Object Created\"],\"source\":[\"aws.s3\"]}"`,
				`resource "aws_cloudwatch_event_target" "upload_target"`,
				`resource "aws_lambda_event_source_mapping"`,
			},
			security: []string{
				`identifiers = ["events.amazonaws.com"]`,
				`sqs:SendMessage`,
				`sqs:ReceiveMessage`,
				`dynamodb:PutItem`,
			},
		},
		{
			name:  "sns-fanout-queue",
			model: eventSNSFanoutModel(),
			eventing: []string{
				`resource "aws_sns_topic" "fanout"`,
				`resource "aws_sns_topic_subscription" "queue_subscription"`,
				`raw_message_delivery = true`,
				`resource "aws_sqs_queue" "fanout_queue"`,
			},
			security: []string{`resource "aws_sqs_queue_policy" "sns_queue_policy"`, `variable = "AWS:SourceArn"`, `aws_sns_topic.fanout.arn`},
		},
		{
			name:  "queue-consumer-with-dlq",
			model: eventQueueConsumerModel(),
			eventing: []string{
				`resource "aws_lambda_event_source_mapping"`,
				`ReportBatchItemFailures`,
				`redrive_policy`,
				`resource "aws_sqs_queue_redrive_allow_policy"`,
			},
			security: []string{`sqs:ReceiveMessage`, `sqs:DeleteMessage`, `sqs:GetQueueAttributes`},
		},
	}

	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			artifact, diagnostics := renderTerraformArtifact(context.Background(), test.model, nil, DefaultLimits())
			assertNoTargetErrors(t, diagnostics)
			if artifact == nil {
				t.Fatal("event Terraform artifact is nil")
			}
			eventing := fileContent(t, artifact, "infrastructure/eventing.tf")
			security := fileContent(t, artifact, "infrastructure/security.tf")
			normalizedEventing := strings.Join(strings.Fields(eventing), " ")
			normalizedSecurity := strings.Join(strings.Fields(security), " ")
			for _, expected := range test.eventing {
				if !strings.Contains(normalizedEventing, strings.Join(strings.Fields(expected), " ")) {
					t.Errorf("eventing.tf missing %q\n%s", expected, eventing)
				}
			}
			for _, expected := range test.security {
				if !strings.Contains(normalizedSecurity, strings.Join(strings.Fields(expected), " ")) {
					t.Errorf("security.tf missing %q\n%s", expected, security)
				}
			}
			for _, forbidden := range append(test.mustNotMatch, "depends_on") {
				if strings.Contains(eventing+security, forbidden) {
					t.Errorf("generated event Terraform contains forbidden %q", forbidden)
				}
			}
			if test.name == "image-upload-queue-metadata-path" {
				data := fileContent(t, artifact, "infrastructure/data.tf")
				if !strings.Contains(data, `resource "aws_dynamodb_table" "image_metadata"`) {
					t.Errorf("data.tf missing metadata table\n%s", data)
				}
			}
			if len(artifact.ApplicationArtifacts) != 1 || !artifact.ApplicationArtifacts[0].CodeRequired {
				t.Fatalf("application artifact contract = %#v; handler source must remain pending", artifact.ApplicationArtifacts)
			}
			again, againDiagnostics := renderTerraformArtifact(context.Background(), test.model, nil, DefaultLimits())
			assertNoTargetErrors(t, againDiagnostics)
			if !reflect.DeepEqual(artifact, again) {
				t.Fatal("event Terraform rendering is not byte-reproducible")
			}
			if strings.Contains(security, `"*"`) {
				t.Error("generated IAM policy contains a wildcard principal or resource")
			}
		})
	}
}

func TestSQSLambdaFIFOBatchingWindowParity(t *testing.T) {
	for _, test := range []struct {
		name, queueType string
		window          int
		rejected        bool
	}{
		{"standard-window", "STANDARD", 5, false},
		{"fifo-zero", "FIFO", 0, false},
		{"fifo-window", "FIFO", 5, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			for _, target := range []string{"terraform", "cloudformation"} {
				t.Run(target, func(t *testing.T) {
					model := eventQueueConsumerModel()
					for _, id := range []string{"queue_source", "queue_dlq"} {
						setResourceValue(model, id, "queueType", stringValueConfig(test.queueType))
						if test.queueType == "FIFO" {
							setResourceValue(model, id, "queueName", stringValueConfig(id+".fifo"))
						}
					}
					mutateConnection(model, "edge_queue_consumer", func(c *NormalizedConnection) {
						c.Configuration.Values["batchingWindowSeconds"] = integerValue(test.window)
					})
					render := func() (*TargetArtifact, []Diagnostic) {
						if target == "cloudformation" {
							prepareCuratedCloudFormationModel(model)
							return renderCloudFormationArtifact(context.Background(), model, nil, DefaultLimits())
						}
						return renderTerraformArtifact(context.Background(), model, nil, DefaultLimits())
					}
					first, diagnostics := render()
					if test.rejected {
						code := "TARGET_SQS_FIFO_BATCHING_WINDOW_UNSUPPORTED"
						if target == "cloudformation" {
							code = cloudFormationDiagnosticCode(code)
						}
						if first != nil || !hasDiagnostic(diagnostics, code) {
							t.Fatalf("FIFO batching window accepted: %#v", diagnostics)
						}
						found := false
						for _, d := range diagnostics {
							found = found || d.Code == code && d.Source.EdgeID == "edge_queue_consumer"
						}
						if !found {
							t.Fatal("batching-window diagnostic lacks the exact consumer edge")
						}
					} else {
						assertNoTargetErrors(t, diagnostics)
						if first == nil {
							t.Fatal("supported queue batching window refused")
						}
					}
					second, againDiagnostics := render()
					if !reflect.DeepEqual(first, second) || !reflect.DeepEqual(diagnostics, againDiagnostics) {
						t.Fatal("batching window result is not reproducible")
					}
				})
			}
		})
	}
}

func TestEventBridgeRejectsCurrentSNSKMSContract(t *testing.T) {
	model := eventScheduleModel()
	removePolicy(model, "event_permission")
	topic, _ := modelResource(eventSNSFanoutModel(), "fanout_topic")
	model.Resources = append(model.Resources, topic)
	setResourceValue(model, "event_target", "targetType", stringValueConfig("SNS"))
	mutateConnection(model, "edge_target_lambda", func(c *NormalizedConnection) {
		c.RelationshipType = "aws.eventbridge.target-publishes-to-sns"
		c.Target = reference(topic)
	})
	addPolicy(model, "event_topic_policy", "resource", topic, "aws.sns.topic-owns-resource-policy", []string{"sns:Publish"}, "service", []string{"events.amazonaws.com"}, &topic, true, []string{"edge_target_lambda"})
	finalizeEventModel(model)
	for _, target := range []string{"terraform", "cloudformation"} {
		t.Run(target, func(t *testing.T) {
			candidate := cloneNormalized(t, model)
			code := "TARGET_EVENTBRIDGE_SNS_ENCRYPTION_UNSUPPORTED"
			render := func() (*TargetArtifact, []Diagnostic) {
				if target == "cloudformation" {
					prepareCuratedCloudFormationModel(candidate)
					return renderCloudFormationArtifact(context.Background(), candidate, nil, DefaultLimits())
				}
				return renderTerraformArtifact(context.Background(), candidate, nil, DefaultLimits())
			}
			if target == "cloudformation" {
				code = cloudFormationDiagnosticCode(code)
			}
			first, diagnostics := render()
			if first != nil || !hasDiagnostic(diagnostics, code) {
				t.Fatalf("unsupported EventBridge SNS encryption accepted: %#v", diagnostics)
			}
			found := false
			for _, d := range diagnostics {
				found = found || d.Code == code && d.Source.EdgeID == "edge_target_lambda"
			}
			if !found {
				t.Fatal("unsupported encryption diagnostic lacks the exact delivery edge")
			}
			second, againDiagnostics := render()
			if second != nil || !reflect.DeepEqual(diagnostics, againDiagnostics) {
				t.Fatal("unsupported encryption diagnostics are not reproducible")
			}
		})
	}
}

func TestOwnedS3NotificationRequiresExactDeliveryProjection(t *testing.T) {
	for _, state := range []string{"edge-only", "matching", "standalone", "conflicting", "eventbridge", "duplicate"} {
		t.Run(state, func(t *testing.T) {
			for _, target := range []string{"terraform", "cloudformation"} {
				t.Run(target, func(t *testing.T) {
					model := eventS3LambdaModel()
					bucket, _ := modelResource(model, "upload_bucket")
					child := eventResource("owned_notification", "owned_notification", "aws.s3.bucket-notification-configuration", map[string]ConfigurationValue{
						"notificationName": stringValueConfig("user-upload-notification"), "eventType": stringValueConfig("OBJECT_CREATED"), "destinationKind": stringValueConfig("LAMBDA"), "filterPrefix": stringValueConfig("incoming/"), "filterSuffix": stringValueConfig(".jpg"), "deliverySemantics": stringValueConfig("AT_LEAST_ONCE_UNORDERED"),
					})
					model.Resources = append(model.Resources, child)
					model.Connections = append(model.Connections, connection("owned_notification_owner", "aws.s3.bucket-owns-notification-configuration", child, bucket, "aws.s3.bucket-owns-notification-configuration.connection", nil))
					if state == "edge-only" {
						model.Resources = model.Resources[:len(model.Resources)-1]
						model.Connections = model.Connections[:len(model.Connections)-1]
					}
					if state == "standalone" {
						removePolicy(model, "s3_permission")
						kept := model.Connections[:0]
						for _, c := range model.Connections {
							if c.ID != "edge_upload_notification" {
								kept = append(kept, c)
							}
						}
						model.Connections = kept
					}
					if state == "conflicting" {
						setResourceValue(model, child.ID, "filterPrefix", stringValueConfig("deleted/"))
					}
					if state == "eventbridge" {
						setResourceValue(model, child.ID, "destinationKind", stringValueConfig("EVENTBRIDGE"))
					}
					if state == "duplicate" {
						duplicate := child
						duplicate.ID = "duplicate_notification"
						duplicate.TargetKey = "duplicate_notification"
						model.Resources = append(model.Resources, duplicate)
						model.Connections = append(model.Connections, connection("duplicate_notification_owner", "aws.s3.bucket-owns-notification-configuration", duplicate, bucket, "aws.s3.bucket-owns-notification-configuration.connection", nil))
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
					if state == "edge-only" || state == "matching" && target == "terraform" {
						assertNoTargetErrors(t, diagnostics)
						if first == nil {
							t.Fatal("identical owned notification refused")
						}
						if state == "matching" && !strings.Contains(fileContent(t, first, "infrastructure/eventing.tf"), `"user-upload-notification"`) {
							t.Fatal("Terraform notification omitted the exact owned notification name")
						}
						if state == "matching" && !strings.Contains(fileContent(t, first, "infrastructure/eventing.tf"), `depends_on = [aws_lambda_permission.s3_permission]`) {
							t.Fatal("Named Terraform notification lost the exact generated permission dependency")
						}
					} else {
						code := "TARGET_S3_OWNED_NOTIFICATION_UNREPRESENTED"
						if target == "cloudformation" {
							code = cloudFormationDiagnosticCode(code)
							if state == "matching" {
								code = "CLOUDFORMATION_S3_OWNED_NOTIFICATION_NAME_UNSUPPORTED"
							}
						}
						if first != nil || !hasDiagnostic(diagnostics, code) {
							t.Fatalf("unrepresented owned notification accepted: %#v", diagnostics)
						}
						if state == "matching" {
							found := false
							for _, diagnostic := range diagnostics {
								found = found || diagnostic.Code == code && diagnostic.Source.NodeID == child.ID
							}
							if !found {
								t.Fatal("CloudFormation owned-name refusal lacks the exact child reference")
							}
						}
					}
					second, againDiagnostics := render()
					if !reflect.DeepEqual(first, second) || !reflect.DeepEqual(diagnostics, againDiagnostics) {
						t.Fatal("owned notification result is not reproducible")
					}
				})
			}
		})
	}
}

func TestS3NotificationNamesAreUniqueWithinBucket(t *testing.T) {
	for _, state := range []string{"same-name", "distinct-names", "different-buckets", "owned-edge-collision", "edge-only-collision"} {
		for _, target := range []string{"terraform", "cloudformation"} {
			t.Run(state+"/"+target, func(t *testing.T) {
				model := eventS3LambdaModel()
				bucket, _ := modelResource(model, "upload_bucket")
				otherContext := cloneNormalized(t, model)
				lambda, _ := modelResource(otherContext, "lambda")
				lambda.ID, lambda.TargetKey = "other_lambda", "other_handler"
				lambda.Configuration.Values["functionName"] = stringValueConfig("other-handler")
				lambda.WorkloadIDs = []string{"workload_other"}
				role, _ := modelResource(otherContext, "role")
				role.ID, role.TargetKey = "other_role", "other_role"
				role.Configuration.Values["roleName"] = stringValueConfig("other-lambda-role")
				roleEdge := connection("edge_other_role", "aws.iam.role-assumed-by-lambda", role, lambda, "aws.iam.lambda-role.connection", nil)
				model.Resources = append(model.Resources, role, lambda)
				model.Connections = append(model.Connections, roleEdge)
				addPolicy(model, "other_trust", "trust", role, "aws.iam.role-owns-trust-policy", []string{"sts:AssumeRole"}, "service", []string{"lambda.amazonaws.com"}, nil, true, []string{roleEdge.ID})
				workload := otherContext.Workloads[0]
				workload.ID, workload.OwningResource = "workload_other", reference(lambda)
				model.Workloads = append(model.Workloads, workload)
				secondBucket := bucket
				if state == "different-buckets" {
					secondBucket = eventResource("other_bucket", "other_bucket", "aws.s3.bucket", map[string]ConfigurationValue{})
					secondBucket.Configuration = configuration("aws.s3.bucket.configuration", map[string]ConfigurationValue{})
					for key, value := range bucket.Configuration.Values {
						secondBucket.Configuration.Values[key] = value
					}
					secondBucket.Configuration.Values["bucketName"] = stringValueConfig("cloudmarkup-other-uploads")
					model.Resources = append(model.Resources, secondBucket)
				}
				secondEdge := connection("second_notification", "aws.s3.notifies-lambda", secondBucket, lambda, "aws.s3.notification.connection", map[string]ConfigurationValue{"deliverySemantics": stringValueConfig("AT_LEAST_ONCE_UNORDERED"), "eventType": stringValueConfig("OBJECT_CREATED"), "filterPrefix": stringValueConfig("outgoing/"), "filterSuffix": stringValueConfig(".jpg")})
				model.Connections = append(model.Connections, secondEdge)
				addPolicy(model, "s3_permission_2", "service-grant", lambda, "aws.lambda.owns-invocation-permission", []string{"lambda:InvokeFunction"}, "service", []string{"s3.amazonaws.com"}, nil, true, []string{secondEdge.ID})
				if state == "edge-only-collision" {
					setResourceValue(model, "s3_permission_2_statement", "statementId", stringValueConfig("s3permission"))
				}
				if state != "edge-only-collision" {
					name := "shared-name"
					if state == "owned-edge-collision" {
						name = "s3permission2"
					}
					for index, prefix := range []string{"incoming/", "outgoing/"} {
						if index == 1 && state == "owned-edge-collision" {
							continue
						}
						owner := bucket
						if index == 1 {
							owner = secondBucket
							if state == "distinct-names" {
								name = "different-name"
							}
						}
						id := fmt.Sprintf("owned_notification_%d", index)
						child := eventResource(id, id, "aws.s3.bucket-notification-configuration", map[string]ConfigurationValue{"notificationName": stringValueConfig(name), "eventType": stringValueConfig("OBJECT_CREATED"), "destinationKind": stringValueConfig("LAMBDA"), "filterPrefix": stringValueConfig(prefix), "filterSuffix": stringValueConfig(".jpg"), "deliverySemantics": stringValueConfig("AT_LEAST_ONCE_UNORDERED")})
						model.Resources = append(model.Resources, child)
						model.Connections = append(model.Connections, connection(id+"_owner", "aws.s3.bucket-owns-notification-configuration", child, owner, "aws.s3.bucket-owns-notification-configuration.connection", nil))
					}
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
				positive := state == "distinct-names" || state == "different-buckets"
				if positive && target == "terraform" || state == "edge-only-collision" && target == "cloudformation" {
					assertNoTargetErrors(t, diagnostics)
					if first == nil {
						t.Fatal("Distinct per-bucket notification names refused")
					}
				} else {
					code := "TARGET_S3_NOTIFICATION_NAME_CONFLICT"
					if target == "cloudformation" {
						code = "CLOUDFORMATION_S3_OWNED_NOTIFICATION_NAME_UNSUPPORTED"
					}
					if first != nil || !hasDiagnostic(diagnostics, code) {
						t.Fatalf("Expected exact name refusal %s; artifact emitted=%t, diagnostics=%#v", code, first != nil, diagnostics)
					}
				}
				second, again := render()
				if !reflect.DeepEqual(first, second) || !reflect.DeepEqual(diagnostics, again) {
					t.Fatal("Notification name validation is not reproducible")
				}
			})
		}
	}
}

func TestTerraformEventingRejectsUnsupportedTopologyWithSourceReferences(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name  string
		model func() *NormalizedSolution
		code  string
	}{
		{"custom-bus-schedule", func() *NormalizedSolution {
			model := eventScheduleModel()
			setResourceValue(model, "event_bus", "busType", stringValueConfig("CUSTOM"))
			setResourceValue(model, "event_bus", "busName", stringValueConfig("application-events"))
			return model
		}, "TARGET_EVENT_SCHEDULE_DEFAULT_BUS_REQUIRED"},
		{"unsupported-filter", func() *NormalizedSolution {
			model := eventScheduleModel()
			setResourceValue(model, "event_rule", "filterKeys", stringList("tenantId"))
			return model
		}, "TARGET_EVENT_FILTER_UNSUPPORTED"},
		{"unsupported-sns-filter", func() *NormalizedSolution {
			model := eventSNSFanoutModel()
			setResourceValue(model, "queue_subscription", "filterKeys", stringList("tenantId"))
			setResourceValue(model, "queue_subscription", "filterScope", stringValueConfig("MESSAGE_ATTRIBUTES"))
			return model
		}, "TARGET_EVENT_FILTER_UNSUPPORTED"},
		{"fifo-dlq-mismatch", func() *NormalizedSolution {
			model := eventQueueConsumerModel()
			setResourceValue(model, "queue_dlq", "queueType", stringValueConfig("FIFO"))
			return model
		}, "TARGET_SQS_DLQ_FIFO_MISMATCH"},
		{"missing-permission", func() *NormalizedSolution {
			model := eventScheduleModel()
			removePolicy(model, "event_permission")
			return model
		}, "TARGET_GENERATED_POLICY_COVERAGE_MISSING"},
		{"wrong-sqs-direction", func() *NormalizedSolution {
			model := eventQueueConsumerModel()
			for index := range model.Connections {
				if model.Connections[index].ID == "edge_queue_consumer" {
					model.Connections[index].Source, model.Connections[index].Target = model.Connections[index].Target, model.Connections[index].Source
				}
			}
			return model
		}, "TARGET_SQS_DIRECTION_INVALID"},
		{"event-cycle", func() *NormalizedSolution {
			model := eventQueueConsumerModel()
			lambda, _ := modelResource(model, "lambda")
			queue, _ := modelResource(model, "queue_source")
			model.Connections = append(model.Connections, connection("edge_lambda_requeues", "aws.lambda.sends-message-to-sqs", lambda, queue, "aws.lambda.sqs-send.connection", map[string]ConfigurationValue{"deliverySemantics": stringValueConfig("AT_LEAST_ONCE"), "ordering": stringValueConfig("BEST_EFFORT")}))
			sortModel(model)
			return model
		}, "TARGET_EVENT_FLOW_CYCLE"},
		{"unbounded-retry", func() *NormalizedSolution {
			model := eventScheduleModel()
			setResourceValue(model, "event_target", "maximumRetryAttempts", integerValue(999))
			return model
		}, "TARGET_EVENT_RETRY_UNBOUNDED"},
		{"step-functions-none-with-retries", func() *NormalizedSolution {
			model := eventStepFunctionsModel()
			mutateConnection(model, "edge_workflow_task", func(connection *NormalizedConnection) {
				connection.Configuration.Values["retryMode"] = stringValueConfig("NONE")
			})
			return model
		}, "TARGET_STEP_FUNCTIONS_RETRY_CONFIGURATION_INVALID"},
		{"step-functions-bounded-with-one-attempt", func() *NormalizedSolution {
			model := eventStepFunctionsModel()
			mutateConnection(model, "edge_workflow_task", func(connection *NormalizedConnection) {
				connection.Configuration.Values["maximumAttempts"] = integerValue(1)
			})
			return model
		}, "TARGET_STEP_FUNCTIONS_RETRY_CONFIGURATION_INVALID"},
		{"step-functions-unknown-retry-mode", func() *NormalizedSolution {
			model := eventStepFunctionsModel()
			mutateConnection(model, "edge_workflow_task", func(connection *NormalizedConnection) {
				connection.Configuration.Values["retryMode"] = stringValueConfig("FOREVER")
			})
			return model
		}, "TARGET_STEP_FUNCTIONS_TASK_CONFIGURATION_UNSUPPORTED"},
		{"step-functions-unsupported-timeout", func() *NormalizedSolution {
			model := eventStepFunctionsModel()
			mutateConnection(model, "edge_workflow_task", func(connection *NormalizedConnection) {
				connection.Configuration.Values["taskTimeoutSeconds"] = integerValue(45)
			})
			return model
		}, "TARGET_STEP_FUNCTIONS_TASK_CONFIGURATION_UNSUPPORTED"},
		{"step-functions-unsupported-attempts", func() *NormalizedSolution {
			model := eventStepFunctionsModel()
			mutateConnection(model, "edge_workflow_task", func(connection *NormalizedConnection) {
				connection.Configuration.Values["maximumAttempts"] = integerValue(4)
			})
			return model
		}, "TARGET_STEP_FUNCTIONS_TASK_CONFIGURATION_UNSUPPORTED"},
		{"step-functions-wrong-schema", func() *NormalizedSolution {
			model := eventStepFunctionsModel()
			mutateConnection(model, "edge_workflow_task", func(connection *NormalizedConnection) {
				connection.Configuration.SchemaID = "aws.stepfunctions.unknown.connection"
			})
			return model
		}, "TARGET_CONNECTION_CONFIGURATION_UNSUPPORTED"},
		{"step-functions-wrong-schema-version", func() *NormalizedSolution {
			model := eventStepFunctionsModel()
			mutateConnection(model, "edge_workflow_task", func(connection *NormalizedConnection) {
				connection.Configuration.SchemaVersion = "2.0.0"
			})
			return model
		}, "TARGET_CONNECTION_CONFIGURATION_UNSUPPORTED"},
		{"step-functions-extra-key", func() *NormalizedSolution {
			model := eventStepFunctionsModel()
			mutateConnection(model, "edge_workflow_task", func(connection *NormalizedConnection) {
				connection.Configuration.Values["customRetry"] = boolValue(true)
			})
			return model
		}, "TARGET_CONNECTION_CONFIGURATION_UNSUPPORTED"},
		{"step-functions-missing-key", func() *NormalizedSolution {
			model := eventStepFunctionsModel()
			mutateConnection(model, "edge_workflow_task", func(connection *NormalizedConnection) {
				delete(connection.Configuration.Values, "retryMode")
			})
			return model
		}, "TARGET_CONNECTION_CONFIGURATION_UNSUPPORTED"},
		{"step-functions-timeout-wrong-type", func() *NormalizedSolution {
			model := eventStepFunctionsModel()
			mutateConnection(model, "edge_workflow_task", func(connection *NormalizedConnection) {
				connection.Configuration.Values["taskTimeoutSeconds"] = stringValueConfig("60")
			})
			return model
		}, "TARGET_CONNECTION_VALUE_INVALID"},
		{"step-functions-mode-wrong-type", func() *NormalizedSolution {
			model := eventStepFunctionsModel()
			mutateConnection(model, "edge_workflow_task", func(connection *NormalizedConnection) {
				connection.Configuration.Values["retryMode"] = integerValue(1)
			})
			return model
		}, "TARGET_CONNECTION_VALUE_INVALID"},
		{"step-functions-attempts-wrong-type", func() *NormalizedSolution {
			model := eventStepFunctionsModel()
			mutateConnection(model, "edge_workflow_task", func(connection *NormalizedConnection) {
				connection.Configuration.Values["maximumAttempts"] = numberValue(3)
			})
			return model
		}, "TARGET_CONNECTION_VALUE_INVALID"},
	}
	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			model := test.model()
			artifact, diagnostics := renderTerraformArtifact(context.Background(), model, nil, DefaultLimits())
			if artifact != nil || !hasDiagnostic(diagnostics, test.code) {
				t.Fatalf("artifact = %#v; diagnostics = %#v; want %s", artifact, diagnostics, test.code)
			}
			foundSource := false
			for _, diagnostic := range diagnostics {
				if diagnostic.Code == test.code && (diagnostic.Source.NodeID != "" || diagnostic.Source.EdgeID != "") {
					foundSource = true
				}
			}
			if !foundSource {
				t.Fatalf("diagnostic %s lacks a source node/edge: %#v", test.code, diagnostics)
			}
			if strings.HasPrefix(test.name, "step-functions-") {
				foundTaskEdge := false
				for _, diagnostic := range diagnostics {
					if diagnostic.Code == test.code && diagnostic.Source.EdgeID == "edge_workflow_task" {
						foundTaskEdge = true
					}
				}
				if !foundTaskEdge {
					t.Fatalf("diagnostic %s lacks the Step Functions task edge source: %#v", test.code, diagnostics)
				}
			}
			again, againDiagnostics := renderTerraformArtifact(context.Background(), model, nil, DefaultLimits())
			if again != nil || !reflect.DeepEqual(diagnostics, againDiagnostics) {
				t.Fatalf("unsupported topology diagnostics are not reproducible: first=%#v second=%#v", diagnostics, againDiagnostics)
			}
			if test.name == "custom-bus-schedule" || test.name == "unsupported-filter" || test.name == "unsupported-sns-filter" {
				prepareCuratedCloudFormationModel(model)
				cf, cfDiagnostics := renderCloudFormationArtifact(context.Background(), model, nil, DefaultLimits())
				if cf != nil || !hasDiagnostic(cfDiagnostics, cloudFormationDiagnosticCode(test.code)) {
					t.Fatalf("CloudFormation accepted unsupported event intent: %#v", cfDiagnostics)
				}
			}
		})
	}
}

func eventBaseModel() *NormalizedSolution {
	model := minimalLambdaModel("infrastructure-only")
	model.Provenance.Catalog.Version = CurrentAwsCatalogVersion
	model.Provenance.Catalog.Digest = CurrentAwsCatalogDigest
	for index := range model.Resources {
		if model.Resources[index].ServiceType == "aws.iam.policy-statement" {
			model.Resources[index].Configuration.SchemaVersion = "2.0.0"
		}
	}
	model.Workloads[0].GenerationCoverage = "infrastructure-only"
	model.Workloads[0].TargetReadiness = "application-generation-pending-prompt-45a"
	return model
}

func readyEventApplicationModel() *NormalizedSolution {
	model := eventQueueConsumerModel()
	workload := &model.Workloads[0]
	workload.ImplementationMode = "complete-supported-pattern"
	workload.GenerationCoverage = "complete-supported-pattern"
	workload.TargetReadiness = "application-artifact-ready"
	workload.GeneratorReadiness = GeneratorReadiness{
		State: "compatible-interface-only",
		Generator: &ToolReference{
			ID: EventApplicationGeneratorID, Version: EventApplicationGeneratorVersion, Digest: EventApplicationGeneratorDigest,
		},
		TemplateID: EventApplicationTemplateID, TemplateVersion: EventApplicationTemplateVersion,
		Reasons: []string{"APPLICATION_GENERATION_SEPARATE_BOUNDARY_AVAILABLE"},
	}
	workload.Specification = json.RawMessage(`{"eventBindings":[{"id":"binding_queue"}],"schedules":[],"implementationRequirements":[]}`)
	return model
}

func eventResource(id, key, service string, values map[string]ConfigurationValue) NormalizedResource {
	return resource(id, key, service, configuration(service+".configuration", values))
}

func eventS3LambdaModel() *NormalizedSolution {
	model := eventBaseModel()
	lambda, _ := modelResource(model, "lambda")
	bucket := eventResource("upload_bucket", "uploads", "aws.s3.bucket", map[string]ConfigurationValue{
		"blockPublicAccess": boolValue(true), "bucketName": stringValueConfig("cloudmarkup-image-uploads"), "deletionProtectionEnabled": boolValue(true), "encryption": stringValueConfig("SSE-S3"), "objectOwnership": stringValueConfig("BUCKET_OWNER_ENFORCED"), "versioningEnabled": boolValue(true),
	})
	edge := connection("edge_upload_notification", "aws.s3.notifies-lambda", bucket, lambda, "aws.s3.notification.connection", map[string]ConfigurationValue{"deliverySemantics": stringValueConfig("AT_LEAST_ONCE_UNORDERED"), "eventType": stringValueConfig("OBJECT_CREATED"), "filterPrefix": stringValueConfig("incoming/"), "filterSuffix": stringValueConfig(".jpg")})
	model.Resources = append(model.Resources, bucket)
	model.Connections = append(model.Connections, edge)
	addPolicy(model, "s3_permission", "service-grant", lambda, "aws.lambda.owns-invocation-permission", []string{"lambda:InvokeFunction"}, "service", []string{"s3.amazonaws.com"}, nil, true, []string{edge.ID})
	finalizeEventModel(model)
	return model
}

func eventScheduleModel() *NormalizedSolution {
	model := eventBaseModel()
	lambda, _ := modelResource(model, "lambda")
	bus := eventResource("event_bus", "default_bus", "aws.eventbridge.event-bus", map[string]ConfigurationValue{"busName": stringValueConfig("default"), "busType": stringValueConfig("DEFAULT"), "deletionProtectionEnabled": boolValue(true), "encryption": stringValueConfig("AWS_OWNED")})
	rule := eventResource("event_rule", "hourly", "aws.eventbridge.rule", map[string]ConfigurationValue{"detailTypes": stringList("Application Event"), "enabled": boolValue(true), "filterKeys": stringList(), "ruleName": stringValueConfig("hourly-processing"), "scheduleExpression": stringValueConfig("RATE_1_HOUR"), "sourceKinds": stringList("cloudmarkup.application"), "triggerMode": stringValueConfig("SCHEDULE")})
	rule.Configuration.SchemaVersion = "1.1.0"
	target := eventResource("event_target", "scheduled_target", "aws.eventbridge.target", map[string]ConfigurationValue{"deadLetterMode": stringValueConfig("NONE"), "deliverySemantics": stringValueConfig("AT_LEAST_ONCE"), "inputMode": stringValueConfig("MATCHED_EVENT"), "maximumEventAgeSeconds": integerValue(3600), "maximumRetryAttempts": integerValue(10), "targetName": stringValueConfig("scheduled-handler"), "targetType": stringValueConfig("LAMBDA")})
	association := connection("edge_bus_rule", "aws.eventbridge.event-bus-associates-rule", bus, rule, "aws.eventbridge.event-bus-associates-rule.connection", nil)
	owner := connection("edge_rule_target", "aws.eventbridge.rule-owns-target", rule, target, "aws.eventbridge.rule-owns-target.connection", nil)
	delivery := connection("edge_target_lambda", "aws.eventbridge.target-invokes-lambda", target, lambda, "aws.eventing.delivery.connection", map[string]ConfigurationValue{"deliverySemantics": stringValueConfig("AT_LEAST_ONCE")})
	model.Resources = append(model.Resources, bus, rule, target)
	model.Connections = append(model.Connections, association, owner, delivery)
	addPolicy(model, "event_permission", "service-grant", lambda, "aws.lambda.owns-invocation-permission", []string{"lambda:InvokeFunction"}, "service", []string{"events.amazonaws.com"}, nil, true, []string{delivery.ID})
	finalizeEventModel(model)
	return model
}

func eventPatternTargetModel() *NormalizedSolution {
	model := eventScheduleModel()
	setResourceValue(model, "event_rule", "triggerMode", stringValueConfig("EVENT_PATTERN"))
	setResourceValue(model, "event_rule", "scheduleExpression", stringValueConfig("NONE"))
	return model
}

func eventCustomBusPatternModel() *NormalizedSolution {
	model := eventPatternTargetModel()
	setResourceValue(model, "event_bus", "busType", stringValueConfig("CUSTOM"))
	setResourceValue(model, "event_bus", "busName", stringValueConfig("application-events"))
	return model
}

func eventStepFunctionsModel() *NormalizedSolution {
	model := eventBaseModel()
	lambda, _ := modelResource(model, "lambda")
	workflowRole := resource("workflow_role", "image_workflow_role", "aws.iam.role", configuration("aws.iam.role.configuration", map[string]ConfigurationValue{
		"maxSessionDurationSeconds": integerValue(3600), "roleName": stringValueConfig("image-workflow-role"),
	}))
	workflow := eventResource("image_workflow", "image_workflow", "aws.stepfunctions.state-machine", map[string]ConfigurationValue{
		"definitionMode": stringValueConfig("CATALOG_OPERATIONS"), "deletionProtectionEnabled": boolValue(true),
		"encryption": stringValueConfig("AWS_OWNED_KEY"), "executionTimeoutSeconds": integerValue(300),
		"loggingMode": stringValueConfig("ERRORS_WITHOUT_EXECUTION_DATA"), "stateMachineName": stringValueConfig("image-workflow"),
		"tracingEnabled": boolValue(true), "workflowType": stringValueConfig("STANDARD"),
	})
	roleEdge := connection("edge_workflow_role", "aws.iam.role-assumed-by-step-functions", workflowRole, workflow, "aws.iam.role-assumed-by-step-functions.connection", nil)
	task := connection("edge_workflow_task", "aws.stepfunctions.state-machine-invokes-lambda", workflow, lambda, "aws.stepfunctions.lambda-task.connection", map[string]ConfigurationValue{
		"maximumAttempts": integerValue(3), "retryMode": stringValueConfig("BOUNDED_EXPONENTIAL"), "taskTimeoutSeconds": integerValue(60),
	})
	model.Resources = append(model.Resources, workflowRole, workflow)
	model.Connections = append(model.Connections, roleEdge, task)
	addPolicy(model, "workflow_trust", "trust", workflowRole, "aws.iam.role-owns-trust-policy", []string{"sts:AssumeRole"}, "service", []string{"states.amazonaws.com"}, nil, true, []string{roleEdge.ID})
	addPolicy(model, "workflow_invoke", "generated-permission", workflowRole, "aws.iam.role-owns-generated-permission", []string{"lambda:InvokeFunction"}, "none", nil, &lambda, true, []string{task.ID})
	finalizeEventModel(model)
	return model
}

func eventStepFunctionsNoRetryModel() *NormalizedSolution {
	model := eventStepFunctionsModel()
	mutateConnection(model, "edge_workflow_task", func(connection *NormalizedConnection) {
		connection.Configuration.Values["retryMode"] = stringValueConfig("NONE")
		connection.Configuration.Values["maximumAttempts"] = integerValue(1)
	})
	return model
}

func eventImageQueueMetadataModel() *NormalizedSolution {
	model := eventQueueConsumerModel()
	lambda, _ := modelResource(model, "lambda")
	role, _ := modelResource(model, "role")
	queue, _ := modelResource(model, "queue_source")
	bucket := eventResource("upload_bucket", "uploads", "aws.s3.bucket", map[string]ConfigurationValue{
		"blockPublicAccess": boolValue(true), "bucketName": stringValueConfig("cloudmarkup-image-uploads"), "deletionProtectionEnabled": boolValue(true), "encryption": stringValueConfig("SSE-S3"), "objectOwnership": stringValueConfig("BUCKET_OWNER_ENFORCED"), "versioningEnabled": boolValue(true),
	})
	bus := eventResource("event_bus", "default_bus", "aws.eventbridge.event-bus", map[string]ConfigurationValue{
		"busName": stringValueConfig("default"), "busType": stringValueConfig("DEFAULT"), "deletionProtectionEnabled": boolValue(true), "encryption": stringValueConfig("AWS_OWNED"),
	})
	rule := eventResource("upload_rule", "upload_rule", "aws.eventbridge.rule", map[string]ConfigurationValue{
		"detailTypes": stringList("Object Created"), "enabled": boolValue(true), "filterKeys": stringList(), "ruleName": stringValueConfig("image-upload"),
		"scheduleExpression": stringValueConfig("NONE"), "sourceKinds": stringList("aws.s3"), "triggerMode": stringValueConfig("EVENT_PATTERN"),
	})
	rule.Configuration.SchemaVersion = "1.1.0"
	target := eventResource("upload_target", "upload_target", "aws.eventbridge.target", map[string]ConfigurationValue{
		"deadLetterMode": stringValueConfig("NONE"), "deliverySemantics": stringValueConfig("AT_LEAST_ONCE"), "inputMode": stringValueConfig("MATCHED_EVENT"),
		"maximumEventAgeSeconds": integerValue(3600), "maximumRetryAttempts": integerValue(10), "targetName": stringValueConfig("image-queue"), "targetType": stringValueConfig("SQS"),
	})
	table := dynamoResource("image_metadata", "image_metadata", "image-metadata")
	s3Events := connection("edge_s3_eventbridge", "aws.s3.sends-events-to-eventbridge", bucket, bus, "aws.s3.eventbridge.connection", nil)
	association := connection("edge_upload_rule", "aws.eventbridge.event-bus-associates-rule", bus, rule, "aws.eventbridge.event-bus-associates-rule.connection", nil)
	owner := connection("edge_upload_target", "aws.eventbridge.rule-owns-target", rule, target, "aws.eventbridge.rule-owns-target.connection", nil)
	delivery := connection("edge_target_queue", "aws.eventbridge.target-sends-to-sqs", target, queue, "aws.eventing.delivery.connection", map[string]ConfigurationValue{"deliverySemantics": stringValueConfig("AT_LEAST_ONCE")})
	write := connection("edge_metadata_write", "aws.lambda.writes-dynamodb-table", lambda, table, "aws.lambda.dynamodb-write.connection", nil)
	model.Resources = append(model.Resources, bucket, bus, rule, target, table)
	model.Connections = append(model.Connections, s3Events, association, owner, delivery, write)
	addPolicy(model, "event_queue_policy", "resource", queue, "aws.sqs.queue-owns-resource-policy", []string{"sqs:SendMessage"}, "service", []string{"events.amazonaws.com"}, &queue, true, []string{delivery.ID})
	addPolicy(model, "metadata_write_policy", "generated-permission", role, "aws.iam.role-owns-generated-permission", []string{"dynamodb:DeleteItem", "dynamodb:PutItem", "dynamodb:UpdateItem"}, "none", nil, &table, true, []string{write.ID})
	finalizeEventModel(model)
	return model
}

func eventSNSFanoutModel() *NormalizedSolution {
	model := eventBaseModel()
	topic := eventResource("fanout_topic", "fanout", "aws.sns.topic", map[string]ConfigurationValue{"contentBasedDeduplication": boolValue(false), "deletionProtectionEnabled": boolValue(true), "encryption": stringValueConfig("AWS_MANAGED_KMS"), "topicName": stringValueConfig("image-events"), "topicType": stringValueConfig("STANDARD")})
	queue := eventQueue("fanout_queue", "fanout_queue", "image-events-consumer", "STANDARD")
	sub := eventResource("queue_subscription", "queue_subscription", "aws.sns.subscription", map[string]ConfigurationValue{"deliverySemantics": stringValueConfig("AT_LEAST_ONCE"), "filterKeys": stringList(), "filterScope": stringValueConfig("NONE"), "protocol": stringValueConfig("SQS"), "rawMessageDelivery": boolValue(true), "retryPolicy": stringValueConfig("SERVICE_MANAGED"), "subscriptionName": stringValueConfig("queue-consumer")})
	owner := connection("edge_topic_subscription", "aws.sns.topic-owns-subscription", topic, sub, "aws.sns.topic-owns-subscription.connection", nil)
	delivery := connection("edge_subscription_queue", "aws.sns.subscription-sends-to-sqs", sub, queue, "aws.eventing.delivery.connection", map[string]ConfigurationValue{"deliverySemantics": stringValueConfig("AT_LEAST_ONCE")})
	model.Resources = append(model.Resources, topic, queue, sub)
	model.Connections = append(model.Connections, owner, delivery)
	addPolicy(model, "sns_queue_policy", "resource", queue, "aws.sqs.queue-owns-resource-policy", []string{"sqs:SendMessage"}, "service", []string{"sns.amazonaws.com"}, &queue, true, []string{delivery.ID})
	finalizeEventModel(model)
	return model
}

func eventQueueConsumerModel() *NormalizedSolution {
	model := eventBaseModel()
	lambda, _ := modelResource(model, "lambda")
	role, _ := modelResource(model, "role")
	queue := eventQueue("queue_source", "work_queue", "image-processing", "STANDARD")
	dlq := eventQueue("queue_dlq", "work_dlq", "image-processing-dlq", "STANDARD")
	redrive := connection("edge_queue_dlq", "aws.sqs.uses-dead-letter-queue", queue, dlq, "aws.sqs.redrive.connection", map[string]ConfigurationValue{"maximumReceiveCount": integerValue(5), "replayMode": stringValueConfig("MANUAL_REVIEW")})
	consumer := connection("edge_queue_consumer", "aws.sqs.triggers-lambda", queue, lambda, "aws.sqs.lambda-consumer.connection", map[string]ConfigurationValue{"batchSize": integerValue(10), "batchingWindowSeconds": integerValue(5), "deliverySemantics": stringValueConfig("AT_LEAST_ONCE"), "maximumConcurrency": integerValue(10), "partialBatchResponse": boolValue(true)})
	model.Resources = append(model.Resources, queue, dlq)
	model.Connections = append(model.Connections, redrive, consumer)
	addPolicy(model, "queue_consumer_policy", "generated-permission", role, "aws.iam.role-owns-generated-permission", []string{"sqs:DeleteMessage", "sqs:GetQueueAttributes", "sqs:ReceiveMessage"}, "none", nil, &queue, true, []string{consumer.ID})
	finalizeEventModel(model)
	return model
}

func eventQueue(id, key, name, queueType string) NormalizedResource {
	return eventResource(id, key, "aws.sqs.queue", map[string]ConfigurationValue{"contentBasedDeduplication": boolValue(false), "deletionProtectionEnabled": boolValue(true), "encryption": stringValueConfig("SQS_MANAGED"), "messageRetentionSeconds": integerValue(345600), "queueName": stringValueConfig(name), "queueType": stringValueConfig(queueType), "receiveWaitTimeSeconds": integerValue(20), "visibilityTimeoutSeconds": integerValue(60)})
}

func finalizeEventModel(model *NormalizedSolution) {
	for index := range model.Resources {
		if model.Resources[index].ServiceType == "aws.iam.policy-statement" {
			model.Resources[index].Configuration.SchemaVersion = "2.0.0"
		}
	}
	sortModel(model)
}

func setResourceValue(model *NormalizedSolution, id, key string, value ConfigurationValue) {
	for index := range model.Resources {
		if model.Resources[index].ID == id {
			model.Resources[index].Configuration.Values[key] = value
			return
		}
	}
}

func mutateConnection(model *NormalizedSolution, id string, mutate func(*NormalizedConnection)) {
	for index := range model.Connections {
		if model.Connections[index].ID == id {
			mutate(&model.Connections[index])
			return
		}
	}
}

func removePolicy(model *NormalizedSolution, id string) {
	resources := model.Resources[:0]
	for _, resource := range model.Resources {
		if resource.ID != id && resource.ID != id+"_statement" {
			resources = append(resources, resource)
		}
	}
	model.Resources = resources
	connections := model.Connections[:0]
	for _, connection := range model.Connections {
		if !strings.HasPrefix(connection.ID, id+"_") {
			connections = append(connections, connection)
		}
	}
	model.Connections = connections
	sortModel(model)
}
