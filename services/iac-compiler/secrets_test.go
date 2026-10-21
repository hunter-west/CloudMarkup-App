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
	"github.com/hashicorp/hcl/v2/hclwrite"
)

func secretModel(customer bool) *NormalizedSolution {
	m := kmsModel()
	if !customer {
		m.Resources = []NormalizedResource{}
		m.Connections = []NormalizedConnection{}
	}
	m.Provenance.Catalog = CatalogReference{ID: TerraformCatalogID, Version: CurrentAwsCatalogVersion, Digest: CurrentAwsCatalogDigest}
	mode := "aws-managed"
	if customer {
		mode = "customer-managed"
	}
	s := networkResource("secret", "application_secret", serviceSecret, serviceSecret+".configuration", "1.0.0", map[string]ConfigurationValue{"name": stringValueConfig("application/credential"), "description": stringValueConfig("Externally populated synthetic credential"), "encryptionMode": stringValueConfig(mode), "valueMode": stringValueConfig("external-population"), "recoveryWindowDays": integerValue(30), "preventDestroy": boolValue(true)})
	m.Resources = append(m.Resources, s)
	if customer {
		key, _ := modelResource(m, "encryption_key")
		edge := networkConnection("secret_encryption", secretEncryptionRelationship, key, s)
		edge.Configuration.SchemaID = "aws.kms.key-encrypts-secret.connection"
		m.Connections = append(m.Connections, edge)
	}
	sortModel(m)
	return m
}
func secretReadModel() *NormalizedSolution {
	m := secretModel(true)
	role := networkResource("reader_role", "secret_reader", "aws.iam.role", "aws.iam.role.configuration", "2.0.0", map[string]ConfigurationValue{"roleName": stringValueConfig("synthetic-secret-reader"), "maxSessionDurationSeconds": integerValue(3600)})
	m.Resources = append(m.Resources, role)
	addPolicy(m, "reader_trust", "trust", role, "aws.iam.role-owns-trust-policy", []string{"sts:AssumeRole"}, "service", []string{"lambda.amazonaws.com"}, nil, false, nil)
	addPolicy(m, "secret_access", "identity-inline", role, "aws.iam.role-owns-inline-policy", []string{"secretsmanager:GetSecretValue"}, "none", nil, nil, false, nil)
	secret, _ := modelResource(m, "secret")
	for i := range m.Resources {
		r := &m.Resources[i]
		if r.ServiceType == "aws.iam.policy-statement" {
			r.Configuration.SchemaVersion = "2.0.0"
		}
		if r.ID == "secret_access" {
			parent := reference(role)
			parent.RelationshipType = "aws.iam.role-owns-inline-policy"
			r.Parent = &parent
		}
		if r.ID == "secret_access_statement" {
			r.Parent = &ResourceReference{NodeID: "secret_access", TargetKey: "secret_access", RelationshipType: "aws.iam.policy-contains-statement"}
			r.Configuration.Values["resourceNode"] = ConfigurationValue{Kind: "node-reference", NodeID: secret.ID, Attribute: serviceSecret + ".arn"}
		}
	}
	for i := range m.Connections {
		e := &m.Connections[i]
		if e.ID == "secret_access_membership" {
			e.Source.Port = "aws.iam.policy-statement.policy-document"
			e.Target.Port = "aws.iam.policy-document.statement"
		}
		if e.ID == "secret_access_owner" {
			e.Source.Port = "aws.iam.policy-document.role-inline-policy"
			e.Target.Port = "aws.iam.role.custom-inline-policy"
			e.Configuration.SchemaID = "aws.iam.role-inline-policy.attachment"
		}
	}
	statement, _ := modelResource(m, "secret_access_statement")
	edge := networkConnection("secret_access_scope", secretScopeRelationship, statement, secret)
	edge.Configuration.SchemaID = "aws.iam.policy-statement-authorizes-secret.connection"
	m.Connections = append(m.Connections, edge)
	sortModel(m)
	return m
}
func TestSecretBothTargetsGoldenAndExactARN(t *testing.T) {
	for _, target := range []string{"terraform", "cloudformation"} {
		t.Run(target, func(t *testing.T) {
			m := secretReadModel()
			before := cloneNormalized(t, m)
			a, d := kmsArtifact(m, target)
			assertNoTargetErrors(t, d)
			if a == nil {
				t.Fatal("missing export")
			}
			if !reflect.DeepEqual(before, m) {
				t.Fatal("export mutated source")
			}
			path, name := "infrastructure/security.tf", "security.tf"
			if target == "cloudformation" {
				path, name = cloudFormationTemplatePath, "template.json"
			}
			content := fileContent(t, a, path)
			for _, forbidden := range []string{"SecretString", "GenerateSecretString", "ReplicaRegions", "secret_string", "secret_binary", "aws_secretsmanager_secret_version", "force_delete_without_recovery"} {
				if strings.Contains(content, forbidden) {
					t.Fatalf("unsupported value/lifecycle rendered: %s", forbidden)
				}
			}
			if target == "terraform" {
				parsed, diagnostics := hclwrite.ParseConfig([]byte(content), path, hcl.InitialPos)
				if diagnostics.HasErrors() {
					t.Fatal(diagnostics.Error())
				}
				seen := false
				for _, b := range parsed.Body().Blocks() {
					labels := b.Labels()
					if b.Type() == "data" && len(labels) == 2 && labels[1] == "secret_access" {
						seen = true
						raw := strings.TrimSpace(string(b.Body().Blocks()[0].Body().GetAttribute("resources").Expr().BuildTokens(nil).Bytes()))
						if raw != "[aws_secretsmanager_secret.application_secret.arn]" {
							t.Fatalf("secret ARN scope = %s", raw)
						}
					}
				}
				if !seen || !strings.Contains(content, `kms_key_id              = aws_kms_key.application_key.arn`) || !strings.Contains(content, `recovery_window_in_days = 30`) || !strings.Contains(content, `prevent_destroy = true`) {
					t.Fatal("missing exact encrypted retained metadata")
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
				sid, kid := "", ""
				for id, raw := range resources {
					entry := raw.(map[string]any)
					switch entry["Type"] {
					case "AWS::SecretsManager::Secret":
						sid = id
						if entry["DeletionPolicy"] != "Retain" || entry["UpdateReplacePolicy"] != "Retain" {
							t.Fatal("retention lost")
						}
					case "AWS::KMS::Key":
						kid = id
					}
				}
				if sid == "" || kid == "" {
					t.Fatal("missing exact native metadata")
				}
				props := resources[sid].(map[string]any)["Properties"].(map[string]any)
				if !reflect.DeepEqual(props["KmsKeyId"], cloudFormationGetAtt(kid, "Arn")) {
					t.Fatal("incorrect key ARN")
				}
				for _, raw := range resources {
					entry := raw.(map[string]any)
					if entry["Type"] != "AWS::IAM::Role" {
						continue
					}
					role := entry["Properties"].(map[string]any)
					policy := role["Policies"].([]any)[0].(map[string]any)
					statement := policy["PolicyDocument"].(map[string]any)["Statement"].([]any)[0].(map[string]any)
					if !reflect.DeepEqual(statement["Resource"], []any{cloudFormationRef(sid)}) {
						t.Fatal("secret scope must Ref full ARN including AWS suffix")
					}
				}
			}
			golden := filepath.Join("testdata", "secret-goldens-v1", name)
			if os.Getenv("CLOUDMARKUP_UPDATE_SECRET_GOLDENS") == "1" {
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
				t.Fatal("secret golden differs")
			}
			for repeat := 0; repeat < 3; repeat++ {
				reverseResources(m.Resources)
				reverseConnections(m.Connections)
				sortModel(m)
				again, diagnostics := kmsArtifact(m, target)
				assertNoTargetErrors(t, diagnostics)
				if !reflect.DeepEqual(a, again) {
					t.Fatal("secret export depends on order")
				}
			}
		})
	}
}
func TestSecretAWSManagedAndMetadataOnly(t *testing.T) {
	for _, target := range []string{"terraform", "cloudformation"} {
		m := secretModel(false)
		a, d := kmsArtifact(m, target)
		assertNoTargetErrors(t, d)
		if a == nil {
			t.Fatal("metadata export missing")
		}
		if strings.Contains(artifactText(a), "kms_key_id") || strings.Contains(artifactText(a), "KmsKeyId") {
			t.Fatal("AWS-managed mode received a key")
		}
		if !hasDiagnostic(d, "SECRET_EXTERNAL_POPULATION_REQUIRED") {
			t.Fatal("external population prerequisite lost")
		}
	}
}

func TestSecretMetadataPermissionIsAnIndependentChoice(t *testing.T) {
	for _, target := range []string{"terraform", "cloudformation"} {
		m := secretReadModel()
		setResourceValue(m, "secret_access_statement", "actions", stringList("secretsmanager:DescribeSecret"))
		a, d := kmsArtifact(m, target)
		assertNoTargetErrors(t, d)
		if a == nil {
			t.Fatal("missing metadata-access export")
		}
		path := "infrastructure/security.tf"
		if target == "cloudformation" {
			path = cloudFormationTemplatePath
		}
		content := fileContent(t, a, path)
		if !strings.Contains(content, "secretsmanager:DescribeSecret") || strings.Contains(content, "secretsmanager:GetSecretValue") {
			t.Fatal("read-value authority was inferred")
		}
	}
}
func TestSecretInvalidIntentNoPartialOutput(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*NormalizedSolution)
	}{
		{"secret-value", func(m *NormalizedSolution) {
			setResourceValue(m, "secret", "secretString", stringValueConfig("sensitive-sentinel"))
		}},
		{"name", func(m *NormalizedSolution) {
			setResourceValue(m, "secret", "name", stringValueConfig("bad name"))
		}},
		{"ambiguous-name", func(m *NormalizedSolution) {
			setResourceValue(m, "secret", "name", stringValueConfig("name-abc123"))
		}},
		{"long-name", func(m *NormalizedSolution) {
			setResourceValue(m, "secret", "name", stringValueConfig(strings.Repeat("x", 513)))
		}},
		{"force-delete", func(m *NormalizedSolution) { setResourceValue(m, "secret", "recoveryWindowDays", integerValue(0)) }},
		{"recovery-high", func(m *NormalizedSolution) { setResourceValue(m, "secret", "recoveryWindowDays", integerValue(31)) }},
		{"recovery-fraction", func(m *NormalizedSolution) {
			setResourceValue(m, "secret", "recoveryWindowDays", ConfigurationValue{Kind: "integer", Value: 7.5})
		}},
		{"retention", func(m *NormalizedSolution) { setResourceValue(m, "secret", "preventDestroy", boolValue(false)) }},
		{"value-mode", func(m *NormalizedSolution) { setResourceValue(m, "secret", "valueMode", stringValueConfig("inline")) }},
		{"mode", func(m *NormalizedSolution) {
			setResourceValue(m, "secret", "encryptionMode", stringValueConfig("aws-managed"))
		}},
		{"disabled-key", func(m *NormalizedSolution) { setResourceValue(m, "encryption_key", "enabled", boolValue(false)) }},
		{"missing-key", func(m *NormalizedSolution) { removeNetworkingResource(m, "encryption_key") }},
		{"bad-port", func(m *NormalizedSolution) {
			for i := range m.Connections {
				if m.Connections[i].RelationshipType == secretEncryptionRelationship {
					m.Connections[i].Target.Port = "aws.secretsmanager.secret.policy-resource"
				}
			}
		}},
		{"bad-schema", func(m *NormalizedSolution) {
			for i := range m.Connections {
				if m.Connections[i].RelationshipType == secretEncryptionRelationship {
					m.Connections[i].Configuration.SchemaID = "aws.bad.connection"
				}
			}
		}},
		{"extra-edge-value", func(m *NormalizedSolution) {
			for i := range m.Connections {
				if m.Connections[i].RelationshipType == secretEncryptionRelationship {
					m.Connections[i].Configuration.Values["secretString"] = stringValueConfig("sensitive-sentinel")
				}
			}
		}},
		{"duplicate-key", func(m *NormalizedSolution) {
			for _, e := range m.Connections {
				if e.RelationshipType == secretEncryptionRelationship {
					e.ID = "duplicate"
					m.Connections = append(m.Connections, e)
					break
				}
			}
		}},
		{"foreign-parent", func(m *NormalizedSolution) {
			for i := range m.Resources {
				if m.Resources[i].ID == "secret" {
					m.Resources[i].Parent = &ResourceReference{NodeID: "encryption_key"}
				}
			}
		}},
		{"duplicate-name", func(m *NormalizedSolution) {
			s, _ := modelResource(m, "secret")
			s.ID = "duplicate_secret"
			s.TargetKey = "duplicate_secret"
			s.DeploymentKey = "duplicate_secret"
			m.Resources = append(m.Resources, s)
			key, _ := modelResource(m, "encryption_key")
			edge := networkConnection("duplicate_secret_encryption", secretEncryptionRelationship, key, s)
			edge.Configuration.SchemaID = "aws.kms.key-encrypts-secret.connection"
			m.Connections = append(m.Connections, edge)
		}},
		{"policy-write", func(m *NormalizedSolution) {
			setResourceValue(m, "secret_access_statement", "actions", stringList("secretsmanager:PutSecretValue"))
		}},
		{"policy-wildcard", func(m *NormalizedSolution) {
			setResourceValue(m, "secret_access_statement", "actions", stringList("secretsmanager:*"))
		}},
		{"policy-principal", func(m *NormalizedSolution) {
			setResourceValue(m, "secret_access_statement", "principalKind", stringValueConfig("service"))
			setResourceValue(m, "secret_access_statement", "principals", stringList("lambda.amazonaws.com"))
		}},
		{"pasted-arn", func(m *NormalizedSolution) {
			setResourceValue(m, "secret_access_statement", "resourceExpressions", stringList("arn:aws:secretsmanager:us-east-1:000000000000:secret:synthetic-abc123"))
		}},
		{"wrong-scope", func(m *NormalizedSolution) {
			setResourceValue(m, "secret_access_statement", "resourceNode", ConfigurationValue{Kind: "node-reference", NodeID: "reader_role", Attribute: serviceSecret + ".arn"})
		}},
		{"resource-policy", func(m *NormalizedSolution) {
			setResourceValue(m, "secret_access", "policyKind", stringValueConfig("resource"))
		}},
		{"missing-parent", func(m *NormalizedSolution) {
			for i := range m.Resources {
				if m.Resources[i].ID == "secret_access" {
					m.Resources[i].Parent = nil
				}
			}
		}},
		{"scope-schema", func(m *NormalizedSolution) {
			for i := range m.Connections {
				if m.Connections[i].RelationshipType == secretScopeRelationship {
					m.Connections[i].Configuration.SchemaID = "aws.bad.connection"
				}
			}
		}},
		{"membership-port", func(m *NormalizedSolution) {
			for i := range m.Connections {
				if m.Connections[i].ID == "secret_access_membership" {
					m.Connections[i].Source.Port = "aws.iam.policy-statement.kms-resource"
				}
			}
		}},
		{"owner-port", func(m *NormalizedSolution) {
			for i := range m.Connections {
				if m.Connections[i].ID == "secret_access_owner" {
					m.Connections[i].Source.Port = "aws.iam.policy-document.role-generated-permission"
				}
			}
		}},
		{"owner-schema", func(m *NormalizedSolution) {
			for i := range m.Connections {
				if m.Connections[i].ID == "secret_access_owner" {
					m.Connections[i].Configuration.SchemaID = "aws.bad.connection"
				}
			}
		}},
		{"adopted-reader-role", func(m *NormalizedSolution) {
			for i := range m.Resources {
				if m.Resources[i].ID == "reader_role" {
					m.Resources[i].Lifecycle.Ownership = "adopted"
				}
			}
		}},
		{"adopted-secret", func(m *NormalizedSolution) {
			for i := range m.Resources {
				if m.Resources[i].ID == "secret" {
					m.Resources[i].Lifecycle.Ownership = "adopted"
				}
			}
		}},
	}
	for _, target := range []string{"terraform", "cloudformation"} {
		for _, test := range tests {
			if target == "cloudformation" {
				switch test.name {
				case "secret-value", "retention", "disabled-key", "bad-port", "extra-edge-value", "policy-principal":
				default:
					continue
				}
			}
			t.Run(target+"/"+test.name, func(t *testing.T) {
				m := secretReadModel()
				test.mutate(m)
				if test.name == "duplicate-name" {
					valid := cloneNormalized(t, m)
					setResourceValue(valid, "duplicate_secret", "name", stringValueConfig("secondary_secret"))
					a, d := kmsArtifact(valid, target)
					assertNoTargetErrors(t, d)
					if a == nil {
						t.Fatal("renaming the correctly bound duplicate must restore a valid artifact")
					}
				}
				a, d := kmsArtifact(m, target)
				if a != nil || !hasErrorDiagnostics(d) {
					t.Fatalf("invalid intent produced partial output: %#v", d)
				}
				if test.name == "duplicate-name" {
					found := false
					for _, diagnostic := range d {
						if diagnostic.Code == "TARGET_SECRET_NAME_DUPLICATE" && diagnostic.Severity == SeverityError && diagnostic.Source.Document == DocumentArchitecture {
							found = true
						}
					}
					if !found {
						t.Fatalf("missing distinct duplicate-name refusal: %v", d)
					}
				}
				bytes, _ := json.Marshal(d)
				if strings.Contains(string(bytes), "sensitive-sentinel") {
					t.Fatal("diagnostic leaked secret value")
				}
			})
		}
	}
}
func TestSecretPublicCompileIsReproducible(t *testing.T) {
	for _, target := range []TargetKind{TargetTerraform, TargetCloudFormation} {
		m := secretReadModel()
		document := decodeMap(t, architectureFromNormalized(t, m))
		document["workloadBehavior"] = map[string]any{"contractVersion": float64(2), "workloads": []any{}}
		result := Compile(context.Background(), CompileRequest{Request: Request{Architecture: encodeMap(t, document), Target: target}})
		if !result.Succeeded() || result.Artifact == nil {
			t.Fatalf("public secret Compile failed: %#v", result.Diagnostics)
		}
		for _, field := range []string{"nodes", "edges"} {
			items := document[field].([]any)
			for i, j := 0, len(items)-1; i < j; i, j = i+1, j-1 {
				items[i], items[j] = items[j], items[i]
			}
		}
		again := Compile(context.Background(), CompileRequest{Request: Request{Architecture: encodeMap(t, document), Target: target}})
		if !again.Succeeded() || !reflect.DeepEqual(result.Artifact, again.Artifact) {
			t.Fatal("public source-order export is not reproducible")
		}
	}
}
