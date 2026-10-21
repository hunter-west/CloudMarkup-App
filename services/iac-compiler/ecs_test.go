package compiler

import (
	"context"
	"encoding/json"
	"github.com/hashicorp/hcl/v2"
	"github.com/hashicorp/hcl/v2/hclsyntax"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func ecsModel(ready bool) *NormalizedSolution {
	base := ec2Model(false)
	m := secretModel(false)
	m.Provenance.Catalog = CatalogReference{ID: TerraformCatalogID, Version: CurrentAwsCatalogVersion, Digest: CurrentAwsCatalogDigest}
	m.Outputs = []NormalizedOutput{}
	keep := map[string]bool{}
	for _, n := range base.Resources {
		if isNetworkingService(n.ServiceType) || n.ServiceType == serviceRegionBoundary {
			m.Resources = append(m.Resources, n)
			keep[n.ID] = true
		}
	}
	for _, e := range base.Connections {
		if keep[e.Source.NodeID] && keep[e.Target.NodeID] {
			m.Connections = append(m.Connections, e)
		}
	}
	makeNode := func(id, s string, values map[string]ConfigurationValue) NormalizedResource {
		return networkResource(id, id, s, s+".configuration", "1.0.0", values)
	}
	repo := makeNode("repository", serviceEcrRepository, map[string]ConfigurationValue{"name": stringValueConfig("synthetic/application"), "tagMutability": stringValueConfig("IMMUTABLE"), "encryption": stringValueConfig("AES256"), "scanOnPush": boolValue(true), "retain": boolValue(true)})
	status := "external-publication-required"
	population := "external-population-required"
	count := 0
	if ready {
		status = "externally-confirmed"
		population = "externally-confirmed"
		count = 1
	}
	image := makeNode("image", serviceEcrImage, map[string]ConfigurationValue{"digest": stringValueConfig("sha256:" + strings.Repeat("a", 64)), "architecture": stringValueConfig("x86_64"), "manifestType": stringValueConfig("oci-image"), "publicationStatus": stringValueConfig(status)})
	image.Parent = &ResourceReference{NodeID: repo.ID, TargetKey: repo.TargetKey, RelationshipType: ecsImageOwner}
	cluster := makeNode("cluster", serviceEcsCluster, map[string]ConfigurationValue{"name": stringValueConfig("SyntheticCluster"), "containerInsights": stringValueConfig("disabled")})
	task := makeNode("task", serviceEcsTask, map[string]ConfigurationValue{"family": stringValueConfig("SyntheticTask"), "cpu": integerValue(256), "memoryMiB": integerValue(512), "architecture": stringValueConfig("x86_64"), "operatingSystem": stringValueConfig("LINUX"), "networkMode": stringValueConfig("awsvpc"), "capacity": stringValueConfig("FARGATE")})
	container := makeNode("container", serviceEcsContainer, map[string]ConfigurationValue{"name": stringValueConfig("Application"), "containerPort": integerValue(8080), "protocol": stringValueConfig("tcp"), "essential": boolValue(true), "user": stringValueConfig("10001:10001"), "readOnlyRoot": boolValue(true), "healthExecutable": stringValueConfig("/app/health"), "healthIntervalSeconds": integerValue(30), "healthTimeoutSeconds": integerValue(5), "healthRetries": integerValue(3), "healthStartPeriodSeconds": integerValue(0), "logStreamPrefix": stringValueConfig("Application"), "logMode": stringValueConfig("non-blocking"), "logBufferSize": stringValueConfig("10m")})
	container.Parent = &ResourceReference{NodeID: task.ID, TargetKey: task.TargetKey, RelationshipType: ecsContainerOwner}
	service := makeNode("service", serviceEcsService, map[string]ConfigurationValue{"name": stringValueConfig("SyntheticService"), "desiredCount": integerValue(count), "platformVersion": stringValueConfig("1.4.0"), "publicIpv4": boolValue(false), "executeCommand": boolValue(false), "availabilityZoneRebalancing": stringValueConfig("DISABLED")})
	logs := makeNode("logs", "aws.cloudwatch.log-group", map[string]ConfigurationValue{"logGroupName": stringValueConfig("/ecs/synthetic"), "retentionDays": integerValue(30), "logClass": stringValueConfig("STANDARD"), "preventDestroy": boolValue(true)})
	role := func(id string) NormalizedResource {
		return networkResource(id, id, "aws.iam.role", "aws.iam.role.configuration", "2.0.0", map[string]ConfigurationValue{"roleName": stringValueConfig(id), "maxSessionDurationSeconds": integerValue(3600)})
	}
	exec := role("execution_role")
	app := role("application_role")
	attachment := makeNode("execution_attachment", "aws.iam.managed-policy-attachment", map[string]ConfigurationValue{"displayName": stringValueConfig("Explicit ECS execution managed policy"), "attachmentKind": stringValueConfig("managed-policy-attachment"), "managedPolicyReference": stringValueConfig(ecsExecutionPolicy)})
	attachment.Parent = &ResourceReference{NodeID: exec.ID, TargetKey: exec.TargetKey, RelationshipType: "aws.iam.role-owns-managed-policy-attachment"}
	m.Resources = append(m.Resources, repo, image, cluster, task, container, service, logs, exec, app, attachment)
	add := func(id, rel, s, t string) {
		source, _ := modelResource(m, s)
		target, _ := modelResource(m, t)
		edge := networkConnection(id, rel, source, target)
		edge.Configuration.SchemaID = rel + ".connection"
		m.Connections = append(m.Connections, edge)
	}
	for _, b := range [][4]string{{"image_owner", ecsImageOwner, "image", "repository"}, {"container_owner", ecsContainerOwner, "container", "task"}, {"image_binding", ecsImageBinding, "image", "container"}, {"cluster_binding", ecsClusterBinding, "cluster", "service"}, {"task_binding", ecsTaskBinding, "task", "service"}, {"execution_binding", ecsExecutionBinding, "execution_role", "task"}, {"application_binding", ecsApplicationBinding, "application_role", "task"}, {"subnet_binding", ecsSubnetBinding, "service", "subnet"}, {"group_binding", ecsGroupBinding, "service", "group"}, {"logs_binding", ecsLogsBinding, "container", "logs"}, {"secret_binding", ecsSecretBinding, "secret", "container"}} {
		add(b[0], b[1], b[2], b[3])
	}
	m.Connections[len(m.Connections)-1].Configuration.Values = map[string]ConfigurationValue{"environmentName": stringValueConfig("DATABASE_PASSWORD"), "populationStatus": stringValueConfig(population)}
	m.Connections = append(m.Connections, NormalizedConnection{ID: "attachment_owner", RelationshipType: "aws.iam.role-owns-managed-policy-attachment", Source: ResourceReference{NodeID: attachment.ID, TargetKey: attachment.TargetKey, Port: "aws.iam.managed-policy-attachment.role-managed-policy"}, Target: ResourceReference{NodeID: exec.ID, TargetKey: exec.TargetKey, Port: "aws.iam.role.managed-policy"}, Configuration: Configuration{SchemaID: "aws.iam.role-managed-policy.attachment", SchemaVersion: "1.0.0", Values: map[string]ConfigurationValue{}}, Lifecycle: Lifecycle{Ownership: "user", Origin: "user"}})
	for _, r := range []NormalizedResource{exec, app} {
		addPolicy(m, r.ID+"_trust", "trust", r, "aws.iam.role-owns-trust-policy", []string{"sts:AssumeRole"}, "service", []string{"ecs-tasks.amazonaws.com"}, nil, false, nil)
	}
	addPolicy(m, "secret_access", "identity-inline", exec, "aws.iam.role-owns-inline-policy", []string{"secretsmanager:GetSecretValue"}, "none", nil, nil, false, nil)
	for i := range m.Resources {
		n := &m.Resources[i]
		if n.ServiceType == "aws.iam.policy-document" {
			owner := exec
			rel := "aws.iam.role-owns-trust-policy"
			if n.ID == app.ID+"_trust" {
				owner = app
			}
			if n.ID == "secret_access" {
				rel = "aws.iam.role-owns-inline-policy"
			}
			n.Parent = &ResourceReference{NodeID: owner.ID, TargetKey: owner.TargetKey, RelationshipType: rel}
		}
		if n.ServiceType == "aws.iam.policy-statement" {
			n.Configuration.SchemaVersion = "2.0.0"
			pid := strings.TrimSuffix(n.ID, "_statement")
			n.Parent = &ResourceReference{NodeID: pid, TargetKey: pid, RelationshipType: "aws.iam.policy-contains-statement"}
			if n.ID == "secret_access_statement" {
				n.Configuration.Values["resourceNode"] = ConfigurationValue{Kind: "node-reference", NodeID: "secret", Attribute: serviceSecret + ".arn"}
			}
		}
	}
	for i := range m.Connections {
		e := &m.Connections[i]
		if e.RelationshipType == "aws.iam.role-owns-trust-policy" {
			e.Source.Port = "aws.iam.policy-document.role-trust-policy"
			e.Target.Port = "aws.iam.role.trust-policy"
			e.Configuration.SchemaID = "aws.iam.role-trust-policy.attachment"
		}
		if e.RelationshipType == "aws.iam.role-owns-inline-policy" {
			e.Source.Port = "aws.iam.policy-document.role-inline-policy"
			e.Target.Port = "aws.iam.role.custom-inline-policy"
			e.Configuration.SchemaID = "aws.iam.role-inline-policy.attachment"
		}
		if e.RelationshipType == "aws.iam.policy-contains-statement" {
			e.Source.Port = "aws.iam.policy-statement.policy-document"
			e.Target.Port = "aws.iam.policy-document.statement"
		}
	}
	statement, _ := modelResource(m, "secret_access_statement")
	secret, _ := modelResource(m, "secret")
	scope := networkConnection("secret_scope", secretScopeRelationship, statement, secret)
	scope.Configuration.SchemaID = "aws.iam.policy-statement-authorizes-secret.connection"
	m.Connections = append(m.Connections, scope)
	sortModel(m)
	return m
}
func TestEcsBothTargetsDigestReferencesAndGolden(t *testing.T) {
	for _, target := range []string{"terraform", "cloudformation"} {
		t.Run(target, func(t *testing.T) {
			m := ecsModel(true)
			before := cloneNormalized(t, m)
			a, d := kmsArtifact(m, target)
			assertNoTargetErrors(t, d)
			if a == nil {
				t.Fatal("missing artifact")
			}
			if !reflect.DeepEqual(before, m) {
				t.Fatal("source mutated")
			}
			path, name := "infrastructure/compute.tf", "compute.tf"
			if target == "cloudformation" {
				path = cloudFormationTemplatePath
				name = "template.json"
			}
			content := fileContent(t, a, path)
			for _, bad := range []string{":latest", "CMD-SHELL", "aws_ecr_image", "SecretString", "secret_string", "entryPoint", "EntryPoint", "repositoryCredentials", "RepositoryCredentials", "privileged", "Privileged"} {
				if strings.Contains(content, bad) {
					t.Fatalf("unsupported generated behavior %s", bad)
				}
			}
			if target == "terraform" {
				for _, f := range a.Files {
					if strings.HasSuffix(f.Path, ".tf") {
						if _, d := hclsyntax.ParseConfig([]byte(f.Content), f.Path, hcl.InitialPos); d.HasErrors() {
							t.Fatal(d.Error())
						}
					}
				}
				for _, piece := range []string{"jsonencode(", "aws_ecr_repository.repository.repository_url", "aws_iam_role.execution_role.arn", "aws_iam_role.application_role.arn", "aws_secretsmanager_secret.application_secret.arn", "aws_cloudwatch_log_group.logs.name", "/app/health", "prevent_destroy = true", "assign_public_ip = false", "aws_iam_role_policy_attachment.execution_attachment", "aws_iam_role_policy.secret_access"} {
					if !strings.Contains(content, piece) {
						t.Fatalf("missing native reference %s", piece)
					}
				}
			} else {
				var template map[string]any
				if err := json.Unmarshal([]byte(content), &template); err != nil {
					t.Fatal(err)
				}
				types := map[string]int{}
				for _, raw := range template["Resources"].(map[string]any) {
					res := raw.(map[string]any)
					typ := res["Type"].(string)
					types[typ]++
					p := res["Properties"].(map[string]any)
					if typ == "AWS::ECR::Repository" && (res["DeletionPolicy"] != "Retain" || res["UpdateReplacePolicy"] != "Retain" || p["EmptyOnDelete"] != false) {
						t.Fatal("repository lifecycle lost")
					}
					if typ == "AWS::ECS::TaskDefinition" {
						if p["Cpu"] != "256" || p["Memory"] != "512" {
							t.Fatal("size native types lost")
						}
						c := p["ContainerDefinitions"].([]any)[0].(map[string]any)
						if _, ok := c["Image"].(map[string]any)["Fn::Join"]; !ok {
							t.Fatal("image not typed URI plus digest")
						}
						h := c["HealthCheck"].(map[string]any)
						if !reflect.DeepEqual(h["Command"], []any{"CMD", "/app/health"}) {
							t.Fatal("health command altered")
						}
						if c["User"] != "10001:10001" || c["ReadonlyRootFilesystem"] != true {
							t.Fatal("security baseline lost")
						}
					}
					if typ == "AWS::ECS::Service" {
						if p["DesiredCount"] != float64(1) || p["LaunchType"] != "FARGATE" || p["PlatformVersion"] != "1.4.0" || p["EnableExecuteCommand"] != false {
							t.Fatal("service native contract lost")
						}
					}
				}
				for _, typ := range []string{"AWS::ECR::Repository", "AWS::ECS::Cluster", "AWS::ECS::TaskDefinition", "AWS::ECS::Service"} {
					if types[typ] != 1 {
						t.Fatalf("resource %s missing/duplicated", typ)
					}
				}
			}
			golden := filepath.Join("testdata", "ecs-goldens-v1", name)
			if os.Getenv("CLOUDMARKUP_UPDATE_ECS_GOLDENS") == "1" {
				if err := os.MkdirAll(filepath.Dir(golden), 0700); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(golden, []byte(content), 0600); err != nil {
					t.Fatal(err)
				}
			}
			expected, err := os.ReadFile(golden)
			if err != nil {
				t.Fatal(err)
			}
			if string(expected) != content {
				t.Fatal("golden drift")
			}
			for i := 0; i < 2; i++ {
				reordered := cloneNormalized(t, m)
				for l, r := 0, len(reordered.Resources)-1; l < r; l, r = l+1, r-1 {
					reordered.Resources[l], reordered.Resources[r] = reordered.Resources[r], reordered.Resources[l]
				}
				for l, r := 0, len(reordered.Connections)-1; l < r; l, r = l+1, r-1 {
					reordered.Connections[l], reordered.Connections[r] = reordered.Connections[r], reordered.Connections[l]
				}
				sortModel(reordered)
				again, dd := kmsArtifact(reordered, target)
				assertNoTargetErrors(t, dd)
				if !reflect.DeepEqual(a, again) {
					t.Fatal("not reproducible")
				}
			}
		})
	}
}
func TestEcsArchitectureBothPlatformsAndStaged(t *testing.T) {
	for _, target := range []TargetKind{TargetTerraform, TargetCloudFormation} {
		for _, arm := range []bool{false, true} {
			for _, ready := range []bool{false, true} {
				name := string(target)
				if arm {
					name += "/arm"
				} else {
					name += "/x86"
				}
				if ready {
					name += "/ready"
				} else {
					name += "/staged"
				}
				t.Run(name, func(t *testing.T) {
					m := ecsModel(ready)
					if arm {
						ec2Set(m, "image", "architecture", stringValueConfig("arm64"))
						ec2Set(m, "task", "architecture", stringValueConfig("arm64"))
					}
					architecture := decodeMap(t, architectureFromNormalized(t, m))
					architecture["workloadBehavior"].(map[string]any)["workloads"] = []any{}
					input, err := json.Marshal(architecture)
					if err != nil {
						t.Fatal(err)
					}
					a := Compile(context.Background(), CompileRequest{Request: Request{Architecture: input, Target: target}})
					if !a.Succeeded() || a.Artifact == nil {
						t.Fatalf("immutable input failed: %v", a.Diagnostics)
					}
				})
			}
		}
	}
}
func TestEcsClosedSchemaDrift(t *testing.T) {
	c, err := os.ReadFile(filepath.Join("..", "..", "packages", "provider-aws", "src", "compiled", "catalog-v1.json"))
	if err != nil {
		t.Fatal(err)
	}
	var cat struct {
		Services []struct {
			ID            string `json:"id"`
			Configuration struct {
				JSONSchema struct {
					Properties map[string]ecsField `json:"properties"`
				} `json:"jsonSchema"`
			} `json:"configuration"`
		} `json:"services"`
	}
	if err := json.Unmarshal(c, &cat); err != nil {
		t.Fatal(err)
	}
	count := 0
	for _, s := range cat.Services {
		if p, ok := ecsSchemas[s.ID]; ok {
			count++
			if !reflect.DeepEqual(p, s.Configuration.JSONSchema.Properties) {
				t.Fatalf("schema drift %s", s.ID)
			}
		}
	}
	if count != 6 {
		t.Fatal("incomplete closed schemas")
	}
}
