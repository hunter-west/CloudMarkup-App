package compiler

import (
	"context"
	"fmt"
	"reflect"
	"strings"
	"testing"
)

func TestCloudFormationNetworkingPreservesCuratedIntent(t *testing.T) {
	model := networkingTerraformModel()
	prepareCuratedCloudFormationModel(model)
	artifact := renderCloudFormationForTest(t, model)
	template := decodeCloudFormationTemplate(t, targetFileForTest(t, artifact, cloudFormationTemplatePath).Content)
	resources := mapAt(t, template, "Resources")
	for _, resourceType := range []string{
		"AWS::EC2::VPC", "AWS::EC2::Subnet", "AWS::EC2::RouteTable", "AWS::EC2::Route",
		"AWS::EC2::SubnetRouteTableAssociation", "AWS::EC2::InternetGateway", "AWS::EC2::VPCGatewayAttachment",
		"AWS::EC2::NatGateway", "AWS::EC2::VPCEndpoint", "AWS::EC2::SecurityGroup",
		"AWS::EC2::SecurityGroupIngress", "AWS::EC2::SecurityGroupEgress",
	} {
		if !templateHasResourceType(resources, resourceType) {
			t.Errorf("CloudFormation network missing %s", resourceType)
		}
	}
	lambda := resourceOfType(t, resources, "AWS::Lambda::Function")
	vpcConfig := mapAt(t, mapAt(t, lambda, "Properties"), "VpcConfig")
	if len(arrayAtAny(t, vpcConfig, "SubnetIds")) != 2 || len(arrayAtAny(t, vpcConfig, "SecurityGroupIds")) != 1 {
		t.Fatalf("Lambda VpcConfig = %#v", vpcConfig)
	}
	endpoint := resourceOfType(t, resources, "AWS::EC2::VPCEndpoint")
	if _, ok := mapAt(t, endpoint, "Properties")["PolicyDocument"].(map[string]any); !ok {
		t.Fatalf("restricted endpoint policy missing: %#v", endpoint)
	}
	securityGroup := resourceOfType(t, resources, "AWS::EC2::SecurityGroup")
	if egress := arrayAtAny(t, mapAt(t, securityGroup, "Properties"), "SecurityGroupEgress"); len(egress) != 1 {
		t.Fatalf("explicit default-egress suppression rule missing: %#v", egress)
	}
	ownership := map[string]string{}
	for _, policy := range artifact.PolicyArtifacts {
		ownership[policy.PolicyDocumentID] = policy.Ownership
	}
	if ownership["s3_endpoint_policy"] != "user" || ownership["trust_policy"] != "generated" {
		t.Fatalf("policy ownership collapsed: %#v", artifact.PolicyArtifacts)
	}
	readme := targetFileForTest(t, artifact, cloudFormationReadmePath).Content
	for _, expected := range []string{
		"## Legitimate target differences",
		"default EventBridge bus is referenced but not created",
		"same immutable ZIP checksum contract",
		"not AWS acceptance, change-set, or deployment Evidence",
	} {
		if !strings.Contains(readme, expected) {
			t.Errorf("CloudFormation README missing %q", expected)
		}
	}

	terraform, diagnostics := renderTerraformArtifact(context.Background(), model, nil, DefaultLimits())
	assertNoTargetErrors(t, diagnostics)
	if terraform == nil || !strings.Contains(fileContent(t, terraform, "infrastructure/networking.tf"), `resource "aws_vpc" "application"`) {
		t.Fatal("same normalized model did not preserve Terraform networking intent")
	}
}

func TestCloudFormationEventingPreservesCuratedPatterns(t *testing.T) {
	tests := []struct {
		name  string
		model *NormalizedSolution
		types []string
	}{
		{"s3-notification", eventS3LambdaModel(), []string{"AWS::S3::Bucket", "AWS::Lambda::Permission"}},
		{"scheduled-workflow", eventScheduleModel(), []string{"AWS::Events::Rule", "AWS::Lambda::Permission"}},
		{"event-pattern-target", eventPatternTargetModel(), []string{"AWS::Events::Rule", "AWS::Lambda::Permission"}},
		{"custom-bus-event-pattern", eventCustomBusPatternModel(), []string{"AWS::Events::EventBus", "AWS::Events::Rule", "AWS::Lambda::Permission"}},
		{"step-functions", eventStepFunctionsModel(), []string{"AWS::StepFunctions::StateMachine", "AWS::Logs::LogGroup"}},
		{"image-processing", eventImageQueueMetadataModel(), []string{"AWS::S3::Bucket", "AWS::Events::Rule", "AWS::SQS::Queue", "AWS::Lambda::EventSourceMapping", "AWS::DynamoDB::Table"}},
		{"sns-fanout", eventSNSFanoutModel(), []string{"AWS::SNS::Topic", "AWS::SNS::Subscription", "AWS::SQS::Queue", "AWS::SQS::QueuePolicy"}},
		{"queue-consumer-dlq", eventQueueConsumerModel(), []string{"AWS::SQS::Queue", "AWS::Lambda::EventSourceMapping"}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			prepareCuratedCloudFormationModel(test.model)
			first := renderCloudFormationForTest(t, test.model)
			second := renderCloudFormationForTest(t, cloneNormalized(t, test.model))
			if !reflect.DeepEqual(first, second) {
				t.Fatal("CloudFormation event output is not reproducible")
			}
			resources := mapAt(t, decodeCloudFormationTemplate(t, targetFileForTest(t, first, cloudFormationTemplatePath).Content), "Resources")
			for _, resourceType := range test.types {
				if !templateHasResourceType(resources, resourceType) {
					t.Errorf("CloudFormation event pattern missing %s", resourceType)
				}
			}
			if test.name == "scheduled-workflow" && templateHasResourceType(resources, "AWS::Events::EventBus") {
				t.Error("default EventBridge bus must be referenced rather than falsely created")
			}
			if test.name == "queue-consumer-dlq" {
				assertQueueRedriveAndPartialBatch(t, resources)
			}
		})
	}
}

func TestCognitoSoftwareTokenMFAUsesTargetSpecificProperties(t *testing.T) {
	for _, mode := range []string{"OPTIONAL", "ON"} {
		t.Run(mode, func(t *testing.T) {
			model := eventBaseModel()
			pool, _ := modelResource(authenticatedNotesModel(), "pool")
			model.Resources = append(model.Resources, pool)
			setResourceValue(model, "pool", "mfaMode", stringValueConfig(mode))
			terraform, diagnostics := renderTerraformArtifact(context.Background(), model, nil, DefaultLimits())
			assertNoTargetErrors(t, diagnostics)
			identity := strings.Join(strings.Fields(fileContent(t, terraform, "infrastructure/identity.tf")), " ")
			if !strings.Contains(identity, `mfa_configuration = "`+mode+`"`) || !strings.Contains(identity, "software_token_mfa_configuration { enabled = true }") {
				t.Fatal("Terraform software-token MFA intent changed")
			}
			prepareCuratedCloudFormationModel(model)
			first := renderCloudFormationForTest(t, model)
			resources := mapAt(t, decodeCloudFormationTemplate(t, targetFileForTest(t, first, cloudFormationTemplatePath).Content), "Resources")
			properties := mapAt(t, resourceOfType(t, resources, "AWS::Cognito::UserPool"), "Properties")
			if properties["MfaConfiguration"] != mode || !reflect.DeepEqual(properties["EnabledMfas"], []any{"SOFTWARE_TOKEN_MFA"}) {
				t.Fatalf("CloudFormation MFA properties = %#v", properties)
			}
			if _, exists := properties["SoftwareTokenMfaConfiguration"]; exists {
				t.Fatal("API-only SoftwareTokenMfaConfiguration emitted as a CloudFormation property")
			}
			if !reflect.DeepEqual(first, renderCloudFormationForTest(t, cloneNormalized(t, model))) {
				t.Fatal("Cognito MFA CloudFormation output is not reproducible")
			}
		})
	}
}

func TestAlarmDatapointsCannotExceedEvaluationPeriods(t *testing.T) {
	for _, pair := range [][2]int{{1, 1}, {2, 3}, {3, 3}, {2, 1}, {5, 1}} {
		for _, target := range []string{"terraform", "cloudformation"} {
			t.Run(fmt.Sprintf("%s-%d-of-%d", target, pair[0], pair[1]), func(t *testing.T) {
				model := authenticatedNotesModel()
				prepareCuratedCloudFormationModel(model)
				setResourceValue(model, "alarm", "datapointsToAlarm", integerValue(pair[0]))
				setResourceValue(model, "alarm", "evaluationPeriods", integerValue(pair[1]))
				render := func() (*TargetArtifact, []Diagnostic) {
					if target == "cloudformation" {
						return renderCloudFormationArtifact(context.Background(), model, nil, DefaultLimits())
					}
					return renderTerraformArtifact(context.Background(), model, nil, DefaultLimits())
				}
				first, diagnostics := render()
				if pair[0] > pair[1] {
					code := "TARGET_ALARM_DATAPOINTS_EXCEED_PERIODS"
					if target == "cloudformation" {
						code = cloudFormationDiagnosticCode(code)
					}
					if first != nil || !hasDiagnostic(diagnostics, code) {
						t.Fatalf("alarm M greater than N accepted: %#v", diagnostics)
					}
				} else {
					assertNoTargetErrors(t, diagnostics)
					if first == nil {
						t.Fatal("valid M-out-of-N alarm refused")
					}
					if target == "cloudformation" {
						resources := mapAt(t, decodeCloudFormationTemplate(t, targetFileForTest(t, first, cloudFormationTemplatePath).Content), "Resources")
						properties := mapAt(t, resourceOfType(t, resources, "AWS::CloudWatch::Alarm"), "Properties")
						if properties["DatapointsToAlarm"] != float64(pair[0]) || properties["EvaluationPeriods"] != float64(pair[1]) {
							t.Fatal("valid alarm settings were rewritten")
						}
					}
				}
				second, againDiagnostics := render()
				if !reflect.DeepEqual(first, second) || !reflect.DeepEqual(diagnostics, againDiagnostics) {
					t.Fatal("alarm result is not reproducible")
				}
			})
		}
	}
}

func TestCloudFormationEventApplicationArtifactIsTargetNeutral(t *testing.T) {
	model := readyEventApplicationModel()
	prepareCuratedCloudFormationModel(model)
	cloudFormation := renderCloudFormationForTest(t, model)
	terraform, diagnostics := renderTerraformArtifact(context.Background(), model, nil, DefaultLimits())
	assertNoTargetErrors(t, diagnostics)
	if terraform == nil || len(cloudFormation.ApplicationArtifacts) != 1 || len(terraform.ApplicationArtifacts) != 1 {
		t.Fatalf("cross-target application artifacts missing: CloudFormation=%#v Terraform=%#v", cloudFormation.ApplicationArtifacts, terraform)
	}
	if !reflect.DeepEqual(cloudFormation.ApplicationArtifacts[0].ExpectedArtifact, terraform.ApplicationArtifacts[0].ExpectedArtifact) || cloudFormation.ApplicationArtifacts[0].ArtifactReadiness != "application-artifact-ready" {
		t.Fatalf("target-neutral artifact contract diverged: CloudFormation=%#v Terraform=%#v", cloudFormation.ApplicationArtifacts[0], terraform.ApplicationArtifacts[0])
	}
	if cloudFormation.ApplicationArtifacts[0].GenerationCoverage != terraform.ApplicationArtifacts[0].GenerationCoverage || cloudFormation.ApplicationArtifacts[0].GenerationCoverage != "complete-supported-pattern" {
		t.Fatalf("target-neutral generation coverage diverged: CloudFormation=%#v Terraform=%#v", cloudFormation.ApplicationArtifacts[0], terraform.ApplicationArtifacts[0])
	}
}

func TestCloudFormationCuratedLimitationsAreSourceLinked(t *testing.T) {
	tests := []struct {
		name          string
		model         func() *NormalizedSolution
		code          string
		terraformCode string
		source        string
	}{
		{"unsupported-filter", func() *NormalizedSolution {
			model := eventScheduleModel()
			setResourceValue(model, "event_rule", "filterKeys", stringList("tenantId"))
			return model
		}, "CLOUDFORMATION_EVENT_FILTER_UNSUPPORTED", "TARGET_EVENT_FILTER_UNSUPPORTED", "event_rule"},
		{"fifo-dlq-mismatch", func() *NormalizedSolution {
			model := eventQueueConsumerModel()
			setResourceValue(model, "queue_dlq", "queueType", stringValueConfig("FIFO"))
			return model
		}, "CLOUDFORMATION_SQS_DLQ_FIFO_MISMATCH", "TARGET_SQS_DLQ_FIFO_MISMATCH", "edge_queue_dlq"},
		{"unbounded-retry", func() *NormalizedSolution {
			model := eventScheduleModel()
			setResourceValue(model, "event_target", "maximumRetryAttempts", integerValue(999))
			return model
		}, "CLOUDFORMATION_EVENT_RETRY_UNBOUNDED", "TARGET_EVENT_RETRY_UNBOUNDED", "event_target"},
		{"interface-endpoint", func() *NormalizedSolution {
			model := networkingTerraformModel()
			setNetworkingValue(model, "s3_endpoint", "endpointType", stringValueConfig("Interface"))
			return model
		}, "CLOUDFORMATION_NETWORK_ENDPOINT_MODE_UNSUPPORTED", "TARGET_NETWORK_ENDPOINT_MODE_UNSUPPORTED", "s3_endpoint"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			model := test.model()
			prepareCuratedCloudFormationModel(model)
			artifact, diagnostics := renderCloudFormationArtifact(context.Background(), model, nil, DefaultLimits())
			if artifact != nil {
				t.Fatal("unsupported target limitation produced an artifact")
			}
			diagnostic := diagnosticByCode(t, diagnostics, test.code)
			if diagnostic.Source.NodeID != test.source && diagnostic.Source.EdgeID != test.source {
				t.Fatalf("diagnostic source = %#v, want %s", diagnostic.Source, test.source)
			}
			terraform, terraformDiagnostics := renderTerraformArtifact(context.Background(), model, nil, DefaultLimits())
			if terraform != nil {
				t.Fatal("unsupported cross-target limitation produced a Terraform artifact")
			}
			terraformDiagnostic := diagnosticByCode(t, terraformDiagnostics, test.terraformCode)
			if terraformDiagnostic.Source.NodeID != test.source && terraformDiagnostic.Source.EdgeID != test.source {
				t.Fatalf("Terraform diagnostic source = %#v, want %s", terraformDiagnostic.Source, test.source)
			}
		})
	}
}

func prepareCuratedCloudFormationModel(model *NormalizedSolution) {
	model.Target = TargetReadiness{Target: TargetCloudFormation, ContractVersion: CloudFormationTargetContractVersion, State: "ready", RenderingAvailable: true, Reasons: []string{}}
	model.Provenance.Catalog = CatalogReference{ID: CloudFormationCatalogID, Version: CurrentAwsCatalogVersion, Digest: CurrentAwsCatalogDigest}
	for index := range model.Resources {
		if model.Resources[index].ServiceType == "aws.iam.policy-statement" {
			model.Resources[index].Configuration.SchemaVersion = "2.0.0"
		}
	}
	sortModel(model)
}

func templateHasResourceType(resources map[string]any, resourceType string) bool {
	for _, raw := range resources {
		if resource, ok := raw.(map[string]any); ok && resource["Type"] == resourceType {
			return true
		}
	}
	return false
}

func resourceOfType(t *testing.T, resources map[string]any, resourceType string) map[string]any {
	t.Helper()
	for _, raw := range resources {
		if resource, ok := raw.(map[string]any); ok && resource["Type"] == resourceType {
			return resource
		}
	}
	t.Fatalf("resource type %s missing", resourceType)
	return nil
}

func assertQueueRedriveAndPartialBatch(t *testing.T, resources map[string]any) {
	t.Helper()
	hasRedrive, hasAllow := false, false
	for _, raw := range resources {
		resource, _ := raw.(map[string]any)
		if resource["Type"] != "AWS::SQS::Queue" {
			continue
		}
		properties := mapAt(t, resource, "Properties")
		if _, ok := properties["RedrivePolicy"]; ok {
			hasRedrive = true
		}
		if _, ok := properties["RedriveAllowPolicy"]; ok {
			hasAllow = true
		}
	}
	if !hasRedrive || !hasAllow {
		t.Fatalf("SQS redrive intent missing: redrive=%t allow=%t", hasRedrive, hasAllow)
	}
	mapping := resourceOfType(t, resources, "AWS::Lambda::EventSourceMapping")
	responseTypes := arrayAtAny(t, mapAt(t, mapping, "Properties"), "FunctionResponseTypes")
	if len(responseTypes) != 1 || responseTypes[0] != "ReportBatchItemFailures" {
		t.Fatalf("partial batch response missing: %#v", responseTypes)
	}
}

func TestCloudFormationUnreviewedGeneratorRetainsVersionOneContract(t *testing.T) {
	model := readyEventApplicationModel()
	prepareCuratedCloudFormationModel(model)
	model.Workloads[0].GeneratorReadiness.Generator = &ToolReference{ID: "unreviewed.generator", Version: "1.0.0", Digest: digestOf('f')}
	artifact, diagnostics := renderCloudFormationArtifact(context.Background(), model, nil, DefaultLimits())
	assertNoTargetErrors(t, diagnostics)
	if artifact == nil || len(artifact.ApplicationArtifacts) != 1 || !hasDiagnostic(diagnostics, "APPLICATION_GENERATION_PENDING") {
		t.Fatalf("unreviewed generator lost its pending state: artifact=%#v diagnostics=%#v", artifact, diagnostics)
	}
	contract := artifact.ApplicationArtifacts[0]
	if contract.ContractVersion != ApplicationArtifactContractVersion || contract.ExpectedArtifact != nil || contract.ArtifactReadiness != "" {
		t.Fatalf("version-one artifact contains version-two fields: %#v", contract)
	}
}

// AWS adds default IPv4/IPv6 outbound rules when a group is created without an
// explicit egress rule. Its documented localhost-only rule suppresses that
// creation default while graph-owned network rules remain standalone.
func TestCloudFormationSecurityGroupSuppressesDefaultEgressAtCreation(t *testing.T) {
	for _, standalone := range []bool{false, true} {
		name := "no-egress"
		if standalone {
			name = "standalone-egress"
		}
		t.Run(name, func(t *testing.T) {
			model := networkingTerraformModel()
			if !standalone {
				var resources []NormalizedResource
				for _, resource := range model.Resources {
					if resource.ServiceType != serviceSecurityGroupEgressRule {
						resources = append(resources, resource)
					}
				}
				var connections []NormalizedConnection
				for _, connection := range model.Connections {
					if connection.RelationshipType != "aws.ec2.security-group-owns-egress-rule" {
						connections = append(connections, connection)
					}
				}
				model.Resources, model.Connections = resources, connections
			}
			prepareCuratedCloudFormationModel(model)
			artifact := renderCloudFormationForTest(t, model)
			resources := mapAt(t, decodeCloudFormationTemplate(t, targetFileForTest(t, artifact, cloudFormationTemplatePath).Content), "Resources")
			group := resourceOfType(t, resources, "AWS::EC2::SecurityGroup")
			inline := arrayAtAny(t, mapAt(t, group, "Properties"), "SecurityGroupEgress")
			want := []any{map[string]any{"CidrIp": "127.0.0.1/32", "IpProtocol": "-1"}}
			if !reflect.DeepEqual(inline, want) {
				t.Fatalf("group creation would retain implicit outbound IPv4/IPv6 defaults: %#v", inline)
			}
			if standalone {
				rule := mapAt(t, resourceOfType(t, resources, "AWS::EC2::SecurityGroupEgress"), "Properties")
				if rule["IpProtocol"] != "tcp" || rule["FromPort"] != float64(443) || rule["ToPort"] != float64(443) || rule["CidrIp"] != "0.0.0.0/0" {
					t.Fatalf("reviewed standalone network intent changed: %#v", rule)
				}
			} else if templateHasResourceType(resources, "AWS::EC2::SecurityGroupEgress") {
				t.Fatal("no-egress intent acquired a standalone network rule")
			}
			if again := renderCloudFormationForTest(t, cloneNormalized(t, model)); !reflect.DeepEqual(artifact, again) {
				t.Fatal("egress suppression is not reproducible")
			}
		})
	}
}
