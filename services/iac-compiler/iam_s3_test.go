package compiler

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/hashicorp/hcl/v2"
	"github.com/hashicorp/hcl/v2/hclwrite"
)

func TestEventInvocationPermissionAcceptsOnlyExactGeneratedOwnerScope(t *testing.T) {
	for _, test := range []struct {
		name, policy, edge, principal string
		model                         func() *NormalizedSolution
	}{
		{"s3", "s3_permission", "edge_upload_notification", "s3.amazonaws.com", eventS3LambdaModel},
		{"eventbridge", "event_permission", "edge_target_lambda", "events.amazonaws.com", eventScheduleModel},
		{"sns", "sns_permission", "edge_subscription_queue", "sns.amazonaws.com", func() *NormalizedSolution {
			model := eventSNSFanoutModel()
			removePolicy(model, "sns_queue_policy")
			setResourceValue(model, "queue_subscription", "protocol", stringValueConfig("LAMBDA"))
			setResourceValue(model, "queue_subscription", "rawMessageDelivery", boolValue(false))
			mutateConnection(model, "edge_subscription_queue", func(c *NormalizedConnection) {
				lambda, _ := modelResource(model, "lambda")
				c.RelationshipType = "aws.sns.subscription-invokes-lambda"
				c.Target = reference(lambda)
			})
			return model
		}},
	} {
		t.Run(test.name, func(t *testing.T) {
			model := test.model()
			removePolicy(model, test.policy)
			lambda, _ := modelResource(model, "lambda")
			// Current public resolvers bind the generated statement explicitly to
			// its Lambda owner, in addition to the source-edge provenance.
			addPolicy(model, test.policy, "service-grant", lambda, "aws.lambda.owns-invocation-permission", []string{"lambda:InvokeFunction"}, "service", []string{test.principal}, &lambda, true, []string{test.edge})
			statementID := test.policy + "_statement"
			setResourceValue(model, statementID, "resourceNode", ConfigurationValue{Kind: "node-reference", NodeID: lambda.ID, Attribute: "aws.lambda.function.arn"})
			finalizeEventModel(model)
			for _, target := range []string{"terraform", "cloudformation"} {
				t.Run(target, func(t *testing.T) {
					candidate := cloneNormalized(t, model)
					if target == "cloudformation" {
						prepareCuratedCloudFormationModel(candidate)
					}
					render := func(m *NormalizedSolution) (*TargetArtifact, []Diagnostic) {
						if target == "cloudformation" {
							return renderCloudFormationArtifact(context.Background(), m, nil, DefaultLimits())
						}
						return renderTerraformArtifact(context.Background(), m, nil, DefaultLimits())
					}
					first, diagnostics := render(candidate)
					assertNoTargetErrors(t, diagnostics)
					second, againDiagnostics := render(cloneNormalized(t, candidate))
					if first == nil || !reflect.DeepEqual(first, second) || !reflect.DeepEqual(diagnostics, againDiagnostics) {
						t.Fatal("exact owner-scoped invocation permission is not reproducible")
					}
					denied := cloneNormalized(t, candidate)
					setResourceValue(denied, statementID, "effect", stringValueConfig("deny"))
					deniedBefore := cloneNormalized(t, denied)
					deniedArtifact, deniedDiagnostics := render(denied)
					if deniedArtifact != nil || !hasDiagnostic(deniedDiagnostics, "TARGET_GENERATED_POLICY_PROVENANCE_INVALID") {
						t.Fatalf("generated Deny became an invocation grant: %#v", deniedDiagnostics)
					}
					if !reflect.DeepEqual(deniedBefore, denied) {
						t.Fatal("refusal rewrote the Deny statement")
					}
					if test.name != "s3" {
						return // The same matcher protects all three service grants.
					}
					for _, mutation := range []struct {
						name  string
						apply func(*NormalizedSolution)
					}{
						{"wrong-owner-reference", func(m *NormalizedSolution) {
							setResourceValue(m, statementID, "resourceNode", ConfigurationValue{Kind: "node-reference", NodeID: "role", Attribute: "aws.lambda.function.arn"})
						}},
						{"wrong-attribute", func(m *NormalizedSolution) {
							setResourceValue(m, statementID, "resourceNode", ConfigurationValue{Kind: "node-reference", NodeID: lambda.ID, Attribute: "aws.sqs.queue.arn"})
						}},
						{"wrong-action", func(m *NormalizedSolution) { setResourceValue(m, statementID, "actions", stringList("lambda:*")) }},
						{"wrong-principal", func(m *NormalizedSolution) {
							setResourceValue(m, statementID, "principals", stringList("apigateway.amazonaws.com"))
						}},
						{"wrong-provenance", func(m *NormalizedSolution) {
							for i := range m.Resources {
								if m.Resources[i].ID == statementID {
									p := *m.Resources[i].Lifecycle.Provenance
									p.OperationID = "foreign_operation"
									m.Resources[i].Lifecycle.Provenance = &p
								}
							}
						}},
					} {
						t.Run(mutation.name, func(t *testing.T) {
							invalid := cloneNormalized(t, candidate)
							mutation.apply(invalid)
							artifact, diagnostics := render(invalid)
							if artifact != nil || !hasErrorDiagnostics(diagnostics) {
								t.Fatalf("altered generated permission accepted: %#v", diagnostics)
							}
						})
					}
				})
			}
		})
	}
}

func TestEventBusScalarPoliciesRefuseLossyLowering(t *testing.T) {
	for _, mutation := range []string{"none", "condition", "multiple-principals", "deny", "all-principals", "architecture-node"} {
		for _, target := range []string{"terraform", "cloudformation"} {
			t.Run(mutation+"-"+target, func(t *testing.T) {
				model := eventCustomBusPatternModel()
				bus, _ := modelResource(model, "event_bus")
				addPolicy(model, "bus_policy", "resource", bus, "aws.eventbridge.event-bus-owns-resource-policy", []string{"events:PutEvents"}, "provider-identity", []string{"111122223333"}, &bus, false, nil)
				switch mutation {
				case "condition":
					statement, _ := modelResource(model, "bus_policy_statement")
					condition := resource("bus_condition", "bus_condition", "aws.iam.policy-condition", configuration("aws.iam.policy-condition.configuration", map[string]ConfigurationValue{
						"key": stringValueConfig("aws:PrincipalOrgID"), "operator": stringValueConfig("StringEquals"), "values": stringList("o-synthetic"),
					}))
					model.Resources = append(model.Resources, condition)
					model.Connections = append(model.Connections, connection("bus_condition_owner", "aws.iam.statement-owns-condition", condition, statement, "aws.iam.policy-condition-membership.connection", nil))
				case "multiple-principals":
					setResourceValue(model, "bus_policy_statement", "principals", stringList("111122223333", "444455556666"))
				case "deny":
					setResourceValue(model, "bus_policy_statement", "effect", stringValueConfig("deny"))
				case "all-principals":
					setResourceValue(model, "bus_policy_statement", "principalKind", stringValueConfig("all-principals"))
					setResourceValue(model, "bus_policy_statement", "principals", stringList("*"))
				case "architecture-node":
					role, ok := modelResource(model, "role")
					if !ok || role.ServiceType != "aws.iam.role" {
						t.Fatal("modeled-principal fixture must contain the referenced IAM role")
					}
					setResourceValue(model, "bus_policy_statement", "principalKind", stringValueConfig("architecture-node"))
					setResourceValue(model, "bus_policy_statement", "principals", stringList(role.ID))
				}
				finalizeEventModel(model)
				reader := &terraformRenderer{ctx: context.Background(), model: model, limits: DefaultLimits(), resourceNames: map[string]string{}}
				reader.assignResourceNames()
				documents := reader.collectPolicyDocuments()
				assertNoTargetErrors(t, reader.diagnostics)
				found := false
				for _, document := range documents {
					if document.Resource.ID != "bus_policy" {
						continue
					}
					found = true
					if len(document.Statements) != 1 || scalarEventBusGrant(document.Statements[0]) != (mutation == "none") {
						t.Fatal("scalar lowering did not inspect the complete admitted statement")
					}
					if mutation == "none" {
						for _, principal := range []struct{ kind, value string }{
							{"architecture-node", "111122223333"}, {"service", "111122223333"}, {"federated", "111122223333"}, {"none", "111122223333"}, {"all-principals", "111122223333"},
							{"provider-identity", "arn:aws:iam::111122223333:role/synthetic"}, {"provider-identity", "*"}, {"provider-identity", ""},
							{"provider-identity", "11112222333"}, {"provider-identity", "1111222233333"}, {"provider-identity", "11112222333x"},
						} {
							statement := document.Statements[0]
							statement.PrincipalKind, statement.Principals = principal.kind, []string{principal.value}
							if scalarEventBusGrant(statement) {
								t.Fatal("scalar lowering accepted a non-account principal")
							}
						}
						for _, actions := range [][]string{nil, {"events:PutEvents", "events:DescribeEventBus"}} {
							statement := document.Statements[0]
							statement.Actions = actions
							if scalarEventBusGrant(statement) {
								t.Fatal("scalar lowering ignored action cardinality")
							}
						}
					}
				}
				if !found {
					t.Fatal("fixture did not reach the resource policy lowering boundary")
				}
				before := cloneNormalized(t, model)
				var artifact *TargetArtifact
				var diagnostics []Diagnostic
				code := "TARGET_EVENT_BUS_POLICY_UNSUPPORTED"
				if target == "cloudformation" {
					code = cloudFormationDiagnosticCode(code)
					artifact, diagnostics = renderCloudFormationArtifact(context.Background(), model, nil, DefaultLimits())
				} else {
					artifact, diagnostics = renderTerraformArtifact(context.Background(), model, nil, DefaultLimits())
				}
				if mutation == "none" {
					assertNoTargetErrors(t, diagnostics)
					if artifact == nil {
						t.Fatal("exact scalar Allow grant refused")
					}
				} else if artifact != nil || diagnosticByCode(t, diagnostics, code).Source.NodeID != "bus_policy_statement" {
					t.Fatalf("lossy policy lowering was not refused at its statement: %#v", diagnostics)
				}
				if !reflect.DeepEqual(before, model) {
					t.Fatal("policy admission mutated caller-owned semantics")
				}
			})
		}
	}
}

func s3PolicyTestModel() *NormalizedSolution {
	model := eventS3LambdaModel()
	role, _ := modelResource(model, "role")
	bucket, _ := modelResource(model, "upload_bucket")
	for _, policy := range []struct {
		name    string
		actions []string
	}{
		{"bucket_access", []string{"s3:ListBucket"}},
		{"object_access", []string{"s3:DeleteObject", "s3:GetObject", "s3:PutObject"}},
		{"mixed_access", []string{"s3:GetObject", "s3:ListBucket", "s3:PutObject"}},
		{"object_deny", []string{"s3:DeleteObject"}},
	} {
		addPolicy(model, policy.name, "identity-inline", role, "aws.iam.role-owns-inline-policy", policy.actions, "none", nil, &bucket, false, nil)
	}
	for index := range model.Connections {
		if model.Connections[index].RelationshipType == "aws.iam.authorizes-s3-bucket" {
			model.Connections[index].Source.Port = "aws.iam.policy-statement.s3-resource"
			model.Connections[index].Target.Port = "aws.s3.bucket.policy-resource"
		}
	}
	setResourceValue(model, "object_access_statement", "resourceNode", ConfigurationValue{Kind: "node-reference", NodeID: bucket.ID, Attribute: "aws.s3.bucket.arn"})
	setResourceValue(model, "object_deny_statement", "effect", stringValueConfig("deny"))
	finalizeEventModel(model)
	return model
}

func TestTerraformLambdaPermissionSIDsAreFunctionScoped(t *testing.T) {
	for _, test := range []struct{ sameFunction, sameSID bool }{{true, true}, {true, false}, {false, true}} {
		model := eventS3LambdaModel()
		lambda, _ := modelResource(model, "lambda")
		otherLambda := lambda
		if !test.sameFunction {
			other := cloneNormalized(t, minimalLambdaModel("infrastructure-only"))
			for index := range other.Resources {
				resource := &other.Resources[index]
				resource.ID = "second_" + resource.ID
				resource.TargetKey = "second_" + resource.TargetKey
				resource.DeploymentKey = resource.TargetKey
				for index := range resource.WorkloadIDs {
					resource.WorkloadIDs[index] = "second_" + resource.WorkloadIDs[index]
				}
				if resource.Lifecycle.Provenance != nil {
					for index := range resource.Lifecycle.Provenance.DependentEdgeIDs {
						resource.Lifecycle.Provenance.DependentEdgeIDs[index] = "second_" + resource.Lifecycle.Provenance.DependentEdgeIDs[index]
					}
				}
			}
			for index := range other.Connections {
				edge := &other.Connections[index]
				edge.ID = "second_" + edge.ID
				edge.Source.NodeID, edge.Target.NodeID = "second_"+edge.Source.NodeID, "second_"+edge.Target.NodeID
				edge.Source.TargetKey, edge.Target.TargetKey = "second_"+edge.Source.TargetKey, "second_"+edge.Target.TargetKey
			}
			for index := range other.Workloads {
				other.Workloads[index].ID = "second_" + other.Workloads[index].ID
				other.Workloads[index].OwningResource.NodeID = "second_" + other.Workloads[index].OwningResource.NodeID
				other.Workloads[index].OwningResource.TargetKey = "second_" + other.Workloads[index].OwningResource.TargetKey
			}
			setResourceValue(other, "second_role", "roleName", stringValueConfig("second-role"))
			setResourceValue(other, "second_lambda", "functionName", stringValueConfig("second-function"))
			otherLambda, _ = modelResource(other, "second_lambda")
			model.Resources = append(model.Resources, other.Resources...)
			model.Connections = append(model.Connections, other.Connections...)
			model.Workloads = append(model.Workloads, other.Workloads...)
		}
		bucket, _ := modelResource(cloneNormalized(t, model), "upload_bucket")
		bucket.ID, bucket.TargetKey, bucket.DeploymentKey = "second_bucket", "second_bucket", "second_bucket"
		bucket.Configuration.Values["bucketName"] = stringValueConfig("cloudmarkup-second-uploads")
		edge := connection("edge_second_notification", "aws.s3.notifies-lambda", bucket, otherLambda, "aws.s3.notification.connection", map[string]ConfigurationValue{"deliverySemantics": stringValueConfig("AT_LEAST_ONCE_UNORDERED"), "eventType": stringValueConfig("OBJECT_CREATED"), "filterPrefix": stringValueConfig("incoming/"), "filterSuffix": stringValueConfig(".jpg")})
		model.Resources = append(model.Resources, bucket)
		model.Connections = append(model.Connections, edge)
		addPolicy(model, "second_permission", "service-grant", otherLambda, "aws.lambda.owns-invocation-permission", []string{"lambda:InvokeFunction"}, "service", []string{"s3.amazonaws.com"}, nil, true, []string{edge.ID})
		setResourceValue(model, "s3_permission_statement", "statementId", stringValueConfig("EventConnectionPermission"))
		secondSID := "EventConnectionPermission"
		if !test.sameSID {
			secondSID = "OtherConnectionPermission"
		}
		setResourceValue(model, "second_permission_statement", "statementId", stringValueConfig(secondSID))
		prepareCuratedCloudFormationModel(model)
		before := cloneNormalized(t, model)
		artifact, diagnostics := renderTerraformArtifact(context.Background(), model, nil, DefaultLimits())
		if test.sameFunction && test.sameSID {
			found := false
			for _, diagnostic := range diagnostics {
				if diagnostic.Code == "TARGET_LAMBDA_PERMISSION_SID_DUPLICATE" && diagnostic.Severity == SeverityError && diagnostic.Source.NodeID == "second_permission" && len(diagnostic.Related) == 2 && diagnostic.Related[0].NodeID == "s3_permission" && diagnostic.Related[1].NodeID == "lambda" {
					found = true
				}
			}
			if artifact != nil || !found {
				t.Errorf("Terraform exported same-function duplicate SIDs: artifact=%v diagnostics=%v", artifact != nil, diagnostics)
			}
		} else if artifact == nil || hasErrorDiagnostics(diagnostics) {
			t.Errorf("Terraform rejected distinct SID/function control: %v", diagnostics)
		}
		again, repeatedDiagnostics := renderTerraformArtifact(context.Background(), model, nil, DefaultLimits())
		if !reflect.DeepEqual(artifact, again) || !reflect.DeepEqual(diagnostics, repeatedDiagnostics) {
			t.Fatal("Terraform SID validation is not deterministic")
		}
		cfn, cfnDiagnostics := renderCloudFormationArtifact(context.Background(), model, nil, DefaultLimits())
		if cfn == nil || hasErrorDiagnostics(cfnDiagnostics) {
			t.Errorf("CloudFormation edge-only permissions changed: %v", cfnDiagnostics)
		}
		if !reflect.DeepEqual(before, model) {
			t.Fatal("SID guard rewrote values or generated provenance")
		}
	}
}

func TestIAMLiteralsMatchCurrentCatalogBothTargets(t *testing.T) {
	model := s3PolicyTestModel()
	role, _ := modelResource(model, "role")
	addManagedAttachment(model, "audit_attachment", "managed-policy-attachment", "aws-managed:service-role/AWSLambdaBasicExecutionRole", role, "aws.iam.role-owns-managed-policy-attachment")
	statement, _ := modelResource(model, "object_access_statement")
	condition := resource("audit_condition", "audit_condition", "aws.iam.policy-condition", configuration("aws.iam.policy-condition.configuration", map[string]ConfigurationValue{
		"key": stringValueConfig("aws:RequestedRegion"), "operator": stringValueConfig("StringEquals"), "values": stringList("us-east-1"),
	}))
	model.Resources = append(model.Resources, condition)
	model.Connections = append(model.Connections, connection("audit_condition_owner", "aws.iam.statement-owns-condition", condition, statement, "aws.iam.policy-condition-membership.connection", nil))
	prepareCuratedCloudFormationModel(model)
	for _, target := range []string{"terraform", "cloudformation"} {
		render := func(candidate *NormalizedSolution) (bool, []Diagnostic) {
			if target == "terraform" {
				artifact, diagnostics := renderTerraformArtifact(context.Background(), candidate, nil, DefaultLimits())
				return artifact != nil, diagnostics
			}
			artifact, diagnostics := renderCloudFormationArtifact(context.Background(), candidate, nil, DefaultLimits())
			return artifact != nil, diagnostics
		}
		if artifact, diagnostics := render(model); !artifact || hasErrorDiagnostics(diagnostics) {
			t.Fatalf("%s rejected valid IAM control: %v", target, diagnostics)
		}
		for _, test := range []struct {
			id, key string
			value   ConfigurationValue
		}{
			{"role", "roleName", stringValueConfig("")}, {"role", "roleName", stringValueConfig("AuditRole\n")},
			{"role", "maxSessionDurationSeconds", integerValue(3599)}, {"role", "maxSessionDurationSeconds", stringValueConfig("3600")},
			{"object_access", "policyName", stringValueConfig("")},
			{"audit_attachment", "displayName", stringValueConfig("")}, {"audit_attachment", "managedPolicyReference", stringValueConfig("unreviewed")},
			{"object_access_statement", "actions", stringList()}, {"object_access_statement", "effect", stringValueConfig("unsupported")},
			{"object_access_statement", "resourceExpressions", stringList("arn:aws:s3:::audit-bucket/object", "arn:aws:s3:::audit-bucket/object")},
			{"object_access_statement", "statementId", stringValueConfig("")}, {"object_access_statement", "statementId", stringValueConfig("Bad_Sid")},
			{"audit_condition", "key", stringValueConfig("")}, {"audit_condition", "operator", stringValueConfig("unsupported")},
			{"audit_condition", "values", stringList()}, {"audit_condition", "values", stringList("us-east-1", "us-east-1")},
		} {
			candidate := cloneNormalized(t, model)
			setResourceValue(candidate, test.id, test.key, test.value)
			before := cloneNormalized(t, candidate)
			artifact, diagnostics := render(candidate)
			if artifact || !hasErrorDiagnostics(diagnostics) {
				t.Errorf("%s exported SDK-invalid %s.%s", target, test.id, test.key)
			}
			if !reflect.DeepEqual(before, candidate) {
				t.Fatal("IAM literal validation rewrote the input")
			}
		}
	}
}

func TestIAMRoleNamesAreAccountScopedBothTargets(t *testing.T) {
	for _, otherName := range []string{"Other-Role", "Audit-Role", "audit-role"} {
		model := minimalLambdaModel("generated-starter")
		setResourceValue(model, "role", "roleName", stringValueConfig("Audit-Role"))
		other := resource("other_role", "other_role", "aws.iam.role", configuration("aws.iam.role.configuration", map[string]ConfigurationValue{
			"roleName": stringValueConfig(otherName), "maxSessionDurationSeconds": integerValue(3600),
		}))
		model.Resources = append(model.Resources, other)
		addPolicy(model, "other_trust", "trust", other, "aws.iam.role-owns-trust-policy", []string{"sts:AssumeRole"}, "service", []string{"lambda.amazonaws.com"}, nil, false, nil)
		prepareCuratedCloudFormationModel(model)
		before := cloneNormalized(t, model)
		for _, target := range []string{"terraform", "cloudformation"} {
			var artifact *TargetArtifact
			var diagnostics []Diagnostic
			if target == "terraform" {
				artifact, diagnostics = renderTerraformArtifact(context.Background(), model, nil, DefaultLimits())
			} else {
				artifact, diagnostics = renderCloudFormationArtifact(context.Background(), model, nil, DefaultLimits())
			}
			duplicate := otherName != "Other-Role"
			if duplicate {
				found := false
				for _, diagnostic := range diagnostics {
					if strings.HasSuffix(diagnostic.Code, "IAM_ROLE_NAME_DUPLICATE") && diagnostic.Severity == SeverityError {
						found = true
					}
				}
				if artifact != nil || !found {
					t.Errorf("%s exported duplicate IAM role names: artifact=%v diagnostics=%v", target, artifact != nil, diagnostics)
				}
			} else if artifact == nil || hasErrorDiagnostics(diagnostics) {
				t.Errorf("%s rejected distinct IAM role names: %v", target, diagnostics)
			}
		}
		if !reflect.DeepEqual(before, model) {
			t.Fatal("Role name validation rewrote the input")
		}
	}
}

func TestS3PolicyResourceSemanticsAndGoldens(t *testing.T) {
	model := s3PolicyTestModel()
	terraform, diagnostics := renderTerraformArtifact(context.Background(), model, nil, DefaultLimits())
	assertNoTargetErrors(t, diagnostics)
	security := fileContent(t, terraform, "infrastructure/security.tf")
	parsed, parseDiagnostics := hclwrite.ParseConfig([]byte(security), "security.tf", hcl.InitialPos)
	if parseDiagnostics.HasErrors() {
		t.Fatal(parseDiagnostics.Error())
	}
	expectedTerraform := map[string]string{
		"bucket_access": "[aws_s3_bucket.uploads.arn]",
		"object_access": "[format(\"%s/*\", aws_s3_bucket.uploads.arn)]",
		"mixed_access":  "[aws_s3_bucket.uploads.arn, format(\"%s/*\", aws_s3_bucket.uploads.arn)]",
		"object_deny":   "[format(\"%s/*\", aws_s3_bucket.uploads.arn)]",
	}
	seen := 0
	for _, block := range parsed.Body().Blocks() {
		labels := block.Labels()
		if block.Type() != "data" || len(labels) != 2 || labels[0] != "aws_iam_policy_document" {
			continue
		}
		expected, exists := expectedTerraform[labels[1]]
		if !exists {
			continue
		}
		seen++
		statement := block.Body().Blocks()[0].Body()
		actual := strings.TrimSpace(string(statement.GetAttribute("resources").Expr().BuildTokens(nil).Bytes()))
		if actual != expected {
			t.Errorf("%s resources = %s; want %s", labels[1], actual, expected)
		}
		if labels[1] == "object_deny" && strings.TrimSpace(string(statement.GetAttribute("effect").Expr().BuildTokens(nil).Bytes())) != "\"Deny\"" {
			t.Fatal("object deny became an allow")
		}
	}
	if seen != len(expectedTerraform) {
		t.Fatalf("found %d reviewed Terraform policies", seen)
	}

	prepareCuratedCloudFormationModel(model)
	cloudFormation := renderCloudFormationForTest(t, model)
	template := targetFileForTest(t, cloudFormation, cloudFormationTemplatePath).Content
	resources := mapAt(t, decodeCloudFormationTemplate(t, template), "Resources")
	bucketID := ""
	for id, raw := range resources {
		if raw.(map[string]any)["Type"] == "AWS::S3::Bucket" {
			bucketID = id
		}
	}
	if bucketID == "" {
		t.Fatal("missing bucket")
	}
	bucketProperties := mapAt(t, resources[bucketID].(map[string]any), "Properties")
	if bucketProperties["BucketName"] != "cloudmarkup-image-uploads" {
		t.Fatal("policy scope no longer matches the exact configured bucket name")
	}
	bucketARN := map[string]any{"Fn::Sub": "arn:${AWS::Partition}:s3:::cloudmarkup-image-uploads"}
	objectARN := map[string]any{"Fn::Join": []any{"", []any{bucketARN, "/*"}}}
	expectedCloudFormation := map[string][]any{
		"bucket_access": {bucketARN}, "object_access": {objectARN},
		"mixed_access": {bucketARN, objectARN}, "object_deny": {objectARN},
	}
	role := mapAt(t, firstResourceOfType(t, resources, "AWS::IAM::Role"), "Properties")
	seen = 0
	for _, raw := range arrayAtAny(t, role, "Policies") {
		policy := raw.(map[string]any)
		name := policy["PolicyName"].(string)
		expected, exists := expectedCloudFormation[name]
		if !exists {
			continue
		}
		seen++
		statement := arrayAtAny(t, mapAt(t, policy, "PolicyDocument"), "Statement")[0].(map[string]any)
		if !reflect.DeepEqual(statement["Resource"], expected) {
			t.Errorf("%s resources = %#v; want %#v", name, statement["Resource"], expected)
		}
		if name == "object_deny" && statement["Effect"] != "Deny" {
			t.Fatal("object deny became an allow")
		}
	}
	if seen != len(expectedCloudFormation) {
		t.Fatalf("found %d reviewed CloudFormation policies", seen)
	}
	lambdaID, _ := resourceForGraphID(t, resources, "lambda")
	permissionID, permission := resourceForGraphID(t, resources, "s3_permission")
	if !reflect.DeepEqual(mapAt(t, permission, "Properties"), map[string]any{
		"Action": "lambda:InvokeFunction", "FunctionName": map[string]any{"Ref": lambdaID},
		"Principal": "s3.amazonaws.com", "SourceAccount": map[string]any{"Ref": "AWS::AccountId"}, "SourceArn": bucketARN,
	}) || !reflect.DeepEqual(resources[bucketID].(map[string]any)["DependsOn"], []any{permissionID}) {
		t.Fatal("S3 invocation scope or permission-before-notification ordering changed")
	}
	assertNoCloudFormationResourceCycle(t, resources)

	// Derive an ARN only for the exact inline-role/notification cycle. Other
	// policies, scopes and ambiguous role relationships retain their references.
	for _, variant := range []string{"inline", "generated", "resource-policy", "other-role", "no-notification", "ambiguous-role", "external", "invalid-name"} {
		candidate := cloneNormalized(t, model)
		owner, _ := modelResource(candidate, "role")
		document := terraformPolicyDocument{Kind: "identity-inline", Owner: owner}
		renderer := &cloudFormationRenderer{model: candidate, logicalIDs: map[string]string{"upload_bucket": bucketID}}
		switch variant {
		case "generated":
			document.Kind = "generated-permission"
		case "resource-policy":
			document.Kind = "resource"
		case "other-role":
			document.Owner.ID = "unrelated_role"
		case "no-notification":
			candidate.Connections = nil
		case "ambiguous-role":
			for _, edge := range candidate.Connections {
				if edge.RelationshipType == "aws.iam.role-assumed-by-lambda" {
					candidate.Connections = append(candidate.Connections, edge)
					break
				}
			}
		case "external":
			renderer.externalByNode = map[string]NormalizedExternalResource{"upload_bucket": {}}
		case "invalid-name":
			setResourceValue(candidate, "upload_bucket", "bucketName", stringValueConfig("${Unbound}"))
		}
		bucket, _ := modelResource(candidate, "upload_bucket")
		var expected any = map[string]any{"Fn::GetAtt": []any{bucketID, "Arn"}}
		if variant == "inline" || variant == "generated" {
			expected = bucketARN
		}
		if actual := renderer.s3PolicyResourceARN(document, bucket); !reflect.DeepEqual(actual, expected) {
			t.Errorf("%s ARN scope = %#v; want %#v", variant, actual, expected)
		}
	}

	reordered := cloneNormalized(t, model)
	reverseResources(reordered.Resources)
	reverseConnections(reordered.Connections)
	again := renderCloudFormationForTest(t, reordered)
	if !reflect.DeepEqual(cloudFormation, again) {
		t.Fatal("CloudFormation S3 output depends on incidental input order")
	}
	// Render both Terraform repetitions from the same catalog after the CFN preparation.
	firstTF, firstDiagnostics := renderTerraformArtifact(context.Background(), model, nil, DefaultLimits())
	secondTF, secondDiagnostics := renderTerraformArtifact(context.Background(), reordered, nil, DefaultLimits())
	assertNoTargetErrors(t, firstDiagnostics)
	assertNoTargetErrors(t, secondDiagnostics)
	if !reflect.DeepEqual(firstTF, secondTF) {
		t.Fatal("Terraform S3 output depends on incidental input order")
	}
	for path, content := range map[string]string{"security.tf": security, "template.json": template} {
		golden := filepath.Join("testdata", "s3-policy-goldens-v1", path)
		if os.Getenv("CLOUDMARKUP_UPDATE_S3_POLICY_GOLDENS") == "1" {
			if err := os.MkdirAll(filepath.Dir(golden), 0o755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(golden, []byte(content), 0o644); err != nil {
				t.Fatal(err)
			}
		} else {
			expected, err := os.ReadFile(golden)
			if err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(expected, []byte(content)) {
				t.Fatalf("%s S3 policy golden drifted", path)
			}
		}
	}
}

func TestS3PoliciesRejectUnreviewedActionsAndUnboundScopes(t *testing.T) {
	for _, test := range []struct {
		name, action, expression string
		removeScope              bool
		code                     string
	}{
		{name: "wildcard-action", action: "s3:*", code: "TARGET_POLICY_ACTION_UNSUPPORTED"},
		{name: "unreviewed-action", action: "s3:GetObjectVersion", code: "TARGET_POLICY_ACTION_UNSUPPORTED"},
		{name: "raw-wildcard", expression: "arn:aws:s3:::unreviewed/*", code: "TARGET_POLICY_RESOURCE_EXPRESSION_UNSUPPORTED"},
		{name: "missing-graph-scope", removeScope: true, code: "TARGET_POLICY_RESOURCE_REQUIRED"},
	} {
		t.Run(test.name, func(t *testing.T) {
			model := s3PolicyTestModel()
			if test.action != "" {
				setResourceValue(model, "object_access_statement", "actions", stringList(test.action))
			}
			if test.expression != "" {
				setResourceValue(model, "object_access_statement", "resourceExpressions", stringList(test.expression))
			}
			if test.removeScope {
				edges := []NormalizedConnection{}
				for _, edge := range model.Connections {
					if edge.ID != "object_access_scope" {
						edges = append(edges, edge)
					}
				}
				model.Connections = edges
			}
			artifact, diagnostics := renderTerraformArtifact(context.Background(), model, nil, DefaultLimits())
			if artifact != nil || !hasDiagnostic(diagnostics, test.code) {
				t.Fatalf("Terraform artifact=%v, diagnostics=%v", artifact, diagnostics)
			}
			prepareCuratedCloudFormationModel(model)
			cf, cfDiagnostics := renderCloudFormationArtifact(context.Background(), model, nil, DefaultLimits())
			if cf != nil || !hasErrorDiagnostics(cfDiagnostics) {
				t.Fatalf("CloudFormation accepted unsupported S3 policy: %#v", cfDiagnostics)
			}
			// Even failure diagnostics must remain deterministic and content-free.
			_, again := renderCloudFormationArtifact(context.Background(), cloneNormalized(t, model), nil, DefaultLimits())
			firstJSON, _ := json.Marshal(cfDiagnostics)
			againJSON, _ := json.Marshal(again)
			if !bytes.Equal(firstJSON, againJSON) {
				t.Fatal("S3 failure diagnostics changed on repeat")
			}
		})
	}
}

func TestS3PolicyRejectsMismatchedGraphBindings(t *testing.T) {
	for _, test := range []struct {
		name   string
		mutate func(*NormalizedSolution)
	}{
		{"wrong-attribute", func(m *NormalizedSolution) {
			setResourceValue(m, "object_access_statement", "resourceNode", ConfigurationValue{Kind: "node-reference", NodeID: "upload_bucket", Attribute: "aws.sqs.queue.arn"})
		}},
		{"wrong-node", func(m *NormalizedSolution) {
			setResourceValue(m, "object_access_statement", "resourceNode", ConfigurationValue{Kind: "node-reference", NodeID: "lambda", Attribute: "aws.s3.bucket.arn"})
		}},
		{"wrong-source-port", func(m *NormalizedSolution) {
			mutateConnection(m, "object_access_scope", func(c *NormalizedConnection) { c.Source.Port = "aws.iam.policy-statement.sqs-resource" })
		}},
		{"wrong-target-port", func(m *NormalizedSolution) {
			mutateConnection(m, "object_access_scope", func(c *NormalizedConnection) { c.Target.Port = "aws.s3.bucket.notification" })
		}},
		{"wrong-schema", func(m *NormalizedSolution) {
			mutateConnection(m, "object_access_scope", func(c *NormalizedConnection) { c.Configuration.SchemaVersion = "9.0.0" })
		}},
		{"extra-config", func(m *NormalizedSolution) {
			mutateConnection(m, "object_access_scope", func(c *NormalizedConnection) { c.Configuration.Values["prefix"] = stringValueConfig("*") })
		}},
		{"wrong-target-service", func(m *NormalizedSolution) {
			mutateConnection(m, "object_access_scope", func(c *NormalizedConnection) { r, _ := modelResource(m, "lambda"); c.Target = reference(r) })
		}},
		{"wrong-relationship", func(m *NormalizedSolution) {
			mutateConnection(m, "object_access_scope", func(c *NormalizedConnection) { c.RelationshipType = "aws.iam.authorizes-sqs-queue" })
		}},
	} {
		t.Run(test.name, func(t *testing.T) {
			model := s3PolicyTestModel()
			test.mutate(model)
			tf, diagnostics := renderTerraformArtifact(context.Background(), model, nil, DefaultLimits())
			if tf != nil || !hasDiagnostic(diagnostics, "TARGET_POLICY_S3_SCOPE_INVALID") {
				t.Fatalf("mismatched S3 graph binding accepted: %#v", diagnostics)
			}
			prepareCuratedCloudFormationModel(model)
			cf, diagnostics := renderCloudFormationArtifact(context.Background(), model, nil, DefaultLimits())
			if cf != nil || !hasErrorDiagnostics(diagnostics) {
				t.Fatalf("CloudFormation accepted mismatched S3 scope: %#v", diagnostics)
			}
		})
	}
}
