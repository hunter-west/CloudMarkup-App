package compiler

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/hashicorp/hcl/v2"
	"github.com/hashicorp/hcl/v2/hclsyntax"
)

func kmsModel() *NormalizedSolution {
	model := networkingTerraformModel()
	model.Provenance.Catalog = CatalogReference{ID: TerraformCatalogID, Version: CurrentAwsCatalogVersion, Digest: CurrentAwsCatalogDigest}
	key := networkResource("encryption_key", "application_key", serviceKmsKey, serviceKmsKey+".configuration", "1.0.0", map[string]ConfigurationValue{
		"description": stringValueConfig("Synthetic application encryption"), "keySpec": stringValueConfig("SYMMETRIC_DEFAULT"), "keyUsage": stringValueConfig("ENCRYPT_DECRYPT"), "origin": stringValueConfig("AWS_KMS"), "multiRegion": boolValue(false), "enabled": boolValue(true), "rotationEnabled": boolValue(true), "rotationPeriodDays": integerValue(365), "deletionWindowDays": integerValue(30), "preventDestroy": boolValue(true),
	})
	policy := networkResource("key_policy", "key_policy", "aws.iam.policy-document", "aws.iam.policy-document.configuration", "1.0.0", map[string]ConfigurationValue{"policyName": stringValueConfig("KeyPolicy"), "policyKind": stringValueConfig("resource")})
	parent := reference(key)
	parent.RelationshipType = kmsPolicyOwnerRelationship
	policy.Parent = &parent
	statement := networkResource("key_admin", "key_admin", "aws.iam.policy-statement", "aws.iam.policy-statement.configuration", "2.0.0", map[string]ConfigurationValue{"statementId": stringValueConfig("KeyAdmin"), "effect": stringValueConfig("allow"), "actions": stringList("kms:DescribeKey", "kms:GetKeyPolicy", "kms:PutKeyPolicy"), "principalKind": stringValueConfig("provider-identity"), "principals": stringList("arn:aws:iam::000000000000:role/synthetic-key-admin"), "resourceExpressions": stringList(), "resourceNode": {Kind: "node-reference", NodeID: key.ID, Attribute: serviceKmsKey + ".arn"}})
	statementParent := reference(policy)
	statementParent.RelationshipType = "aws.iam.policy-contains-statement"
	statement.Parent = &statementParent
	owner := networkConnection("key_policy_owner", kmsPolicyOwnerRelationship, policy, key)
	membership := connection("key_admin_membership", "aws.iam.policy-contains-statement", statement, policy, "aws.iam.policy-membership.connection", nil)
	membership.Source.Port = "aws.iam.policy-statement.policy-document"
	membership.Target.Port = "aws.iam.policy-document.statement"
	scope := networkConnection("key_admin_scope", kmsPolicyScopeRelationship, statement, key)
	scope.Configuration.SchemaID = "aws.iam.policy-statement-authorizes-kms-key.connection"
	model.Resources = []NormalizedResource{key, policy, statement}
	model.Connections = []NormalizedConnection{owner, membership, scope}
	model.Workloads = []NormalizedWorkload{}
	model.PolicyAttachments = []PolicyAttachment{}
	model.Outputs = []NormalizedOutput{}
	model.ExternalResources = []NormalizedExternalResource{}
	model.Variables = []NormalizedVariable{}
	sortModel(model)
	return model
}
func kmsArtifact(model *NormalizedSolution, target string) (*TargetArtifact, []Diagnostic) {
	if target == "terraform" {
		return renderTerraformArtifact(context.Background(), model, nil, DefaultLimits())
	}
	return renderCloudFormationArtifact(context.Background(), model, nil, DefaultLimits())
}
func TestKmsKeyBothTargetsGoldenAndReproducibility(t *testing.T) {
	for _, target := range []string{"terraform", "cloudformation"} {
		t.Run(target, func(t *testing.T) {
			model := kmsModel()
			before := cloneNormalized(t, model)
			first, diagnostics := kmsArtifact(model, target)
			assertNoTargetErrors(t, diagnostics)
			if first == nil {
				t.Fatal("missing key export")
			}
			if !reflect.DeepEqual(model, before) {
				t.Fatal("export mutated its immutable input")
			}
			if len(first.PolicyArtifacts) != 1 || first.PolicyArtifacts[0].OwnerNodeID != "encryption_key" || first.PolicyArtifacts[0].Ownership != "user" {
				t.Fatal("key policy ownership lost")
			}
			for repeat := 0; repeat < 3; repeat++ {
				for left, right := 0, len(model.Resources)-1; left < right; left, right = left+1, right-1 {
					model.Resources[left], model.Resources[right] = model.Resources[right], model.Resources[left]
				}
				sortModel(model)
				again, d := kmsArtifact(model, target)
				assertNoTargetErrors(t, d)
				if !reflect.DeepEqual(first, again) {
					t.Fatal("non-deterministic key export")
				}
			}
			goldenName := "template.json"
			path := "infrastructure/template.json"
			if target == "terraform" {
				goldenName = "security.tf"
				path = "infrastructure/security.tf"
			}
			content := fileContent(t, first, path)
			if target == "terraform" {
				if _, d := hclsyntax.ParseConfig([]byte(content), path, hcl.Pos{Line: 1, Column: 1}); d.HasErrors() {
					t.Fatal(d.Error())
				}
				for _, fragment := range []string{`resource "aws_kms_key" "application_key"`, `resources = ["*"]`, `prevent_destroy = true`, `bypass_policy_lockout_safety_check = false`, `policy`} {
					if !strings.Contains(content, fragment) {
						t.Fatalf("missing %s", fragment)
					}
				}
			} else {
				if err := validateCloudFormationTemplate([]byte(content)); err != nil {
					t.Fatal(err)
				}
				var template map[string]any
				if err := json.Unmarshal([]byte(content), &template); err != nil {
					t.Fatal(err)
				}
				resources := template["Resources"].(map[string]any)
				if len(resources) != 1 {
					t.Fatal("key policy must be inline, not a second resource")
				}
				for _, raw := range resources {
					entry := raw.(map[string]any)
					if entry["Type"] != "AWS::KMS::Key" || entry["DeletionPolicy"] != "Retain" || entry["UpdateReplacePolicy"] != "Retain" {
						t.Fatal("retention lost")
					}
					props := entry["Properties"].(map[string]any)
					if props["BypassPolicyLockoutSafetyCheck"] != false {
						t.Fatal("lockout bypass")
					}
					doc := props["KeyPolicy"].(map[string]any)
					statement := doc["Statement"].([]any)[0].(map[string]any)
					if !reflect.DeepEqual(statement["Resource"], []any{"*"}) {
						t.Fatal("KMS key-local scope missing")
					}
				}
			}
			golden := filepath.Join("testdata", "kms-key-goldens-v1", goldenName)
			if os.Getenv("CLOUDMARKUP_UPDATE_KMS_GOLDENS") == "1" {
				if err := os.MkdirAll(filepath.Dir(golden), 0755); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(golden, []byte(content), 0644); err != nil {
					t.Fatal(err)
				}
			}
			expected, err := os.ReadFile(golden)
			if err != nil {
				t.Fatal(err)
			}
			if string(expected) != content {
				t.Fatalf("reviewed KMS %s golden differs", target)
			}
		})
	}
}
func TestKmsKeyInvalidIntentReturnsNoPartialArtifacts(t *testing.T) {
	for _, test := range []struct {
		name   string
		mutate func(*NormalizedSolution)
	}{
		{"missing-policy", func(m *NormalizedSolution) { removePolicy(m, "key_policy") }},
		{"rotation-low", func(m *NormalizedSolution) {
			setResourceValue(m, "encryption_key", "rotationPeriodDays", integerValue(89))
		}},
		{"rotation-high", func(m *NormalizedSolution) {
			setResourceValue(m, "encryption_key", "rotationPeriodDays", integerValue(2561))
		}},
		{"rotation-fraction", func(m *NormalizedSolution) {
			setResourceValue(m, "encryption_key", "rotationPeriodDays", ConfigurationValue{Kind: "integer", Value: 365.5})
		}},
		{"deletion-window", func(m *NormalizedSolution) {
			setResourceValue(m, "encryption_key", "deletionWindowDays", integerValue(0))
		}},
		{"destruction", func(m *NormalizedSolution) { setResourceValue(m, "encryption_key", "preventDestroy", boolValue(false)) }},
		{"multi-region", func(m *NormalizedSolution) { setResourceValue(m, "encryption_key", "multiRegion", boolValue(true)) }},
		{"imported-material", func(m *NormalizedSolution) {
			setResourceValue(m, "encryption_key", "origin", stringValueConfig("EXTERNAL"))
		}},
		{"asymmetric", func(m *NormalizedSolution) {
			setResourceValue(m, "encryption_key", "keySpec", stringValueConfig("RSA_2048"))
		}},
		{"lockout-property", func(m *NormalizedSolution) {
			setResourceValue(m, "encryption_key", "bypassPolicyLockoutSafetyCheck", boolValue(true))
		}},
		{"missing-admin", func(m *NormalizedSolution) { setResourceValue(m, "key_admin", "actions", stringList("kms:Decrypt")) }},
		{"mixed-admin-user", func(m *NormalizedSolution) {
			setResourceValue(m, "key_admin", "actions", stringList("kms:PutKeyPolicy", "kms:Decrypt"))
		}},
		{"wildcard-action", func(m *NormalizedSolution) { setResourceValue(m, "key_admin", "actions", stringList("kms:*")) }},
		{"wildcard-resource", func(m *NormalizedSolution) { setResourceValue(m, "key_admin", "resourceExpressions", stringList("*")) }},
		{"wildcard-principal", func(m *NormalizedSolution) { setResourceValue(m, "key_admin", "principals", stringList("*")) }},
		{"account-root", func(m *NormalizedSolution) {
			setResourceValue(m, "key_admin", "principals", stringList("arn:aws:iam::000000000000:root"))
		}},
		{"cross-account", func(m *NormalizedSolution) {
			setResourceValue(m, "key_admin", "principals", stringList("arn:aws:iam::000000000000:role/admin", "arn:aws:iam::111111111111:role/admin"))
		}},
		{"provider-identity-kind", func(m *NormalizedSolution) {
			setResourceValue(m, "key_admin", "principalKind", stringValueConfig("service"))
		}},
		{"owner-mismatch", func(m *NormalizedSolution) {
			for i := range m.Resources {
				if m.Resources[i].ID == "key_policy" {
					m.Resources[i].Parent = nil
				}
			}
		}},
		{"scope-mismatch", func(m *NormalizedSolution) {
			setResourceValue(m, "key_admin", "resourceNode", ConfigurationValue{Kind: "node-reference", NodeID: "key_policy", Attribute: serviceKmsKey + ".arn"})
		}},
		{"duplicate-owner", func(m *NormalizedSolution) {
			for _, edge := range m.Connections {
				if edge.RelationshipType == kmsPolicyOwnerRelationship {
					edge.ID = "duplicate_owner"
					m.Connections = append(m.Connections, edge)
					break
				}
			}
		}},
		{"wrong-port", func(m *NormalizedSolution) {
			for i := range m.Connections {
				if m.Connections[i].RelationshipType == kmsPolicyScopeRelationship {
					m.Connections[i].Source.Port = "aws.iam.policy-statement.s3-resource"
				}
			}
		}},
		{"unsupported-policy-kind", func(m *NormalizedSolution) {
			setResourceValue(m, "key_policy", "policyKind", stringValueConfig("identity-inline"))
		}},
		{"conditional-administrator", func(m *NormalizedSolution) {
			admin, _ := modelResource(m, "key_admin")
			condition := networkResource("key_condition", "key_condition", "aws.iam.policy-condition", "aws.iam.policy-condition.configuration", "1.0.0", map[string]ConfigurationValue{"operator": stringValueConfig("StringEquals"), "key": stringValueConfig("aws:RequestedRegion"), "values": stringList("us-east-1")})
			parent := reference(admin)
			parent.RelationshipType = "aws.iam.statement-owns-condition"
			condition.Parent = &parent
			edge := connection("key_condition_membership", "aws.iam.statement-owns-condition", condition, admin, "aws.iam.condition-membership.connection", nil)
			edge.Source.Port = "aws.iam.policy-condition.statement-condition"
			edge.Target.Port = "aws.iam.policy-statement.condition"
			m.Resources = append(m.Resources, condition)
			m.Connections = append(m.Connections, edge)
		}},
		{"deny-administrator", func(m *NormalizedSolution) { setResourceValue(m, "key_admin", "effect", stringValueConfig("deny")) }},
		{"invalid-role-name", func(m *NormalizedSolution) {
			setResourceValue(m, "key_admin", "principals", stringList("arn:aws:iam::000000000000:role/admin/"))
		}},
		{"invalid-membership-port", func(m *NormalizedSolution) {
			for i := range m.Connections {
				if m.Connections[i].RelationshipType == "aws.iam.policy-contains-statement" {
					m.Connections[i].Source.Port = "aws.iam.policy-statement.kms-resource"
				}
			}
		}},
		{"duplicate-membership", func(m *NormalizedSolution) {
			for _, edge := range m.Connections {
				if edge.RelationshipType == "aws.iam.policy-contains-statement" {
					edge.ID = "duplicate_membership"
					m.Connections = append(m.Connections, edge)
					break
				}
			}
		}},
		{"missing-boolean", func(m *NormalizedSolution) {
			for i := range m.Resources {
				if m.Resources[i].ID == "encryption_key" {
					delete(m.Resources[i].Configuration.Values, "enabled")
				}
			}
		}},
	} {
		for _, target := range []string{"terraform", "cloudformation"} {
			if target == "cloudformation" {
				switch test.name {
				case "missing-policy", "destruction", "lockout-property", "missing-admin":
				default:
					continue
				}
			}
			t.Run(test.name+"/"+target, func(t *testing.T) {
				model := kmsModel()
				test.mutate(model)
				artifact, diagnostics := kmsArtifact(model, target)
				if artifact != nil || !hasErrorDiagnostics(diagnostics) {
					t.Fatalf("invalid key returned artifact or no error: %#v", diagnostics)
				}
				for _, d := range diagnostics {
					if d.Source.Document != DocumentArchitecture {
						t.Fatal("missing source location")
					}
				}
			})
		}
	}
}
func TestKmsKeyRotationDisabledAndBoundaries(t *testing.T) {
	for _, target := range []string{"terraform", "cloudformation"} {
		for _, period := range []int{90, 2560} {
			m := kmsModel()
			setResourceValue(m, "encryption_key", "rotationPeriodDays", integerValue(period))
			a, d := kmsArtifact(m, target)
			assertNoTargetErrors(t, d)
			if a == nil {
				t.Fatal("valid rotation boundary rejected")
			}
		}
		m := kmsModel()
		setResourceValue(m, "encryption_key", "rotationEnabled", boolValue(false))
		a, d := kmsArtifact(m, target)
		assertNoTargetErrors(t, d)
		if a == nil {
			t.Fatal("rotation disabled rejected")
		}
		text := artifactText(a)
		if strings.Contains(text, "rotation_period_in_days") || strings.Contains(text, "RotationPeriodInDays") {
			t.Fatal("disabled rotation period rendered")
		}
	}
}
func TestKmsKeyExactCatalogDispatchAndHistoricalRejection(t *testing.T) {
	found := false
	for _, binding := range DefaultCompatibilityRegistry().Catalogs {
		if binding.Version == CurrentAwsCatalogVersion && binding.Digest == CurrentAwsCatalogDigest {
			found = true
		}
	}
	if !found {
		t.Fatal("KMS catalog not installed")
	}
	for _, target := range []string{"terraform", "cloudformation"} {
		for _, binding := range []CatalogReference{CatalogReference{ID: TerraformCatalogID, Version: "0.16.0", Digest: "sha256:b8ae0f69d0fceae28e631e9036b745d2e8988967daee0a0b217e0da392d704d6"}, {ID: TerraformCatalogID, Version: CurrentAwsCatalogVersion, Digest: "sha256:b8ae0f69d0fceae28e631e9036b745d2e8988967daee0a0b217e0da392d704d6"}} {
			m := kmsModel()
			m.Provenance.Catalog = binding
			a, d := kmsArtifact(m, target)
			if a != nil || !hasErrorDiagnostics(d) {
				t.Fatal("historical or relabeled catalog admitted KMS")
			}
		}
	}
}

func TestKmsKeyPublicCompilePipeline(t *testing.T) {
	for _, target := range []TargetKind{TargetTerraform, TargetCloudFormation} {
		document := decodeMap(t, architectureFromNormalized(t, kmsModel()))
		document["workloadBehavior"] = map[string]any{"contractVersion": float64(2), "workloads": []any{}}
		architecture := encodeMap(t, document)
		result := Compile(context.Background(), CompileRequest{Request: Request{Architecture: architecture, Target: target}})
		if !result.Succeeded() || result.Artifact == nil {
			t.Fatalf("public KMS Compile diagnostics = %#v", result.Diagnostics)
		}
		if len(result.Artifact.PolicyArtifacts) != 1 || result.Artifact.PolicyArtifacts[0].OwnerNodeID != "encryption_key" {
			t.Fatal("public compile lost inline key-policy ownership")
		}
	}
}

func TestKmsKeySeparateEncryptionUser(t *testing.T) {
	for _, target := range []string{"terraform", "cloudformation"} {
		model := kmsModel()
		key, _ := modelResource(model, "encryption_key")
		policy, _ := modelResource(model, "key_policy")
		user, _ := modelResource(cloneNormalized(t, model), "key_admin")
		user.ID = "key_user"
		user.TargetKey = "key_user"
		user.DeploymentKey = "key_user"
		user.Configuration.Values["statementId"] = stringValueConfig("KeyUser")
		user.Configuration.Values["actions"] = stringList("kms:DescribeKey", "kms:Decrypt", "kms:Encrypt", "kms:GenerateDataKey")
		user.Configuration.Values["principals"] = stringList("arn:aws:iam::000000000000:role/synthetic-key-user")
		membership := connection("key_user_membership", "aws.iam.policy-contains-statement", user, policy, "aws.iam.policy-membership.connection", nil)
		membership.Source.Port = "aws.iam.policy-statement.policy-document"
		membership.Target.Port = "aws.iam.policy-document.statement"
		scope := networkConnection("key_user_scope", kmsPolicyScopeRelationship, user, key)
		scope.Configuration.SchemaID = "aws.iam.policy-statement-authorizes-kms-key.connection"
		model.Resources = append(model.Resources, user)
		model.Connections = append(model.Connections, membership, scope)
		sortModel(model)
		artifact, diagnostics := kmsArtifact(model, target)
		assertNoTargetErrors(t, diagnostics)
		if artifact == nil || !strings.Contains(artifactText(artifact), "kms:Decrypt") || !strings.Contains(artifactText(artifact), "kms:PutKeyPolicy") {
			t.Fatal("separate explicit key users and administrator were not preserved")
		}
	}
}
