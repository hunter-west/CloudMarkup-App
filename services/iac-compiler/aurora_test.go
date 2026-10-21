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

func auroraModel(two bool) *NormalizedSolution {
	m := rdsModel(false)
	m.Provenance.Catalog = CatalogReference{ID: TerraformCatalogID, Version: CurrentAwsCatalogVersion, Digest: CurrentAwsCatalogDigest}
	m.Outputs = nil
	resources := []NormalizedResource{}
	for _, n := range m.Resources {
		if n.ID != "database" && n.ID != "db_parameters" {
			resources = append(resources, n)
		}
	}
	m.Resources = resources
	connections := []NormalizedConnection{}
	for _, e := range m.Connections {
		if e.Source.NodeID != "database" && e.Target.NodeID != "database" && e.Source.NodeID != "db_parameters" && e.Target.NodeID != "db_parameters" {
			connections = append(connections, e)
		}
	}
	m.Connections = connections
	node := func(id, typ string, values map[string]ConfigurationValue) NormalizedResource {
		return networkResource(id, id, typ, typ+".configuration", "1.0.0", values)
	}
	cluster := node("aurora_cluster", serviceAuroraCluster, map[string]ConfigurationValue{"identifier": stringValueConfig("synthetic-aurora"), "engine": stringValueConfig("aurora-postgresql"), "engineVersion": stringValueConfig("16.6"), "engineMode": stringValueConfig("provisioned"), "capacityMode": stringValueConfig("serverless-v2"), "minimumCapacityAcus": stringValueConfig("0.5"), "maximumCapacityAcus": stringValueConfig("4"), "autoPause": boolValue(false), "databaseName": stringValueConfig("SyntheticApp"), "masterUsername": stringValueConfig("SyntheticAdmin"), "masterAuthMode": stringValueConfig("rds-managed"), "storageType": stringValueConfig("aurora"), "storageEncrypted": boolValue(true), "encryptionMode": stringValueConfig("aws-managed"), "port": integerValue(5432), "backupRetentionDays": integerValue(7), "backupWindow": stringValueConfig("02:00-02:30"), "maintenanceWindow": stringValueConfig("sun:03:00-sun:03:30"), "deletionProtection": boolValue(true), "retain": boolValue(true), "autoMinorUpgrade": boolValue(false), "allowMajorUpgrade": boolValue(false), "extendedSupport": stringValueConfig("disabled"), "iamAuthentication": boolValue(false), "dataApi": boolValue(false)})
	member := func(id, zone string, tier int) NormalizedResource {
		return node(id, serviceAuroraInstance, map[string]ConfigurationValue{"identifier": stringValueConfig("synthetic-" + strings.ReplaceAll(id, "_", "-")), "instanceClass": stringValueConfig("db.serverless"), "availabilityZone": stringValueConfig(zone), "promotionTier": integerValue(tier), "caIdentifier": stringValueConfig("rds-ca-rsa2048-g1"), "publicAccess": boolValue(false), "retain": boolValue(true), "autoMinorUpgrade": boolValue(false), "performanceInsights": boolValue(false), "monitoringInterval": integerValue(0)})
	}
	parameters := node("aurora_parameters", serviceAuroraParameters, map[string]ConfigurationValue{"name": stringValueConfig("synthetic-aurora-tls"), "description": stringValueConfig("Explicit synthetic Aurora TLS parameters"), "family": stringValueConfig("aurora-postgresql16"), "forceTls": boolValue(true), "retain": boolValue(true)})
	m.Resources = append(m.Resources, cluster, member("aurora_a", "us-east-1a", 0), parameters)
	if two {
		m.Resources = append(m.Resources, member("aurora_b", "us-east-1b", 1))
	}
	bindings := [][4]string{{"aurora_subnets", auroraSubnetBinding, "db_subnets", "aurora_cluster"}, {"aurora_tls", auroraParameterBinding, "aurora_parameters", "aurora_cluster"}, {"aurora_member_a", auroraMemberBinding, "aurora_cluster", "aurora_a"}, {"aurora_security", auroraGroupBinding, "aurora_cluster", "group"}}
	if two {
		bindings = append(bindings, [4]string{"aurora_member_b", auroraMemberBinding, "aurora_cluster", "aurora_b"})
	}
	for _, b := range bindings {
		source, _ := modelResource(m, b[2])
		target, _ := modelResource(m, b[3])
		edge := networkConnection(b[0], b[1], source, target)
		edge.Configuration.SchemaID = b[1] + ".connection"
		m.Connections = append(m.Connections, edge)
	}
	for _, n := range m.Resources {
		attributes := []string{}
		switch n.ServiceType {
		case serviceAuroraCluster:
			attributes = []string{"identifier", "arn", "address", "readerAddress", "port", "masterUserSecretArn"}
		case serviceAuroraInstance:
			attributes = []string{"identifier", "arn", "address", "port"}
		case serviceAuroraParameters:
			attributes = []string{"name"}
		}
		for _, attribute := range attributes {
			ref := reference(n)
			ref.Attribute = n.ServiceType + "." + attribute
			m.Outputs = append(m.Outputs, NormalizedOutput{ID: n.ID + "_" + attribute, Key: n.ID + "_" + attribute, Kind: "node-attribute", Resource: &ref})
		}
	}
	sortModel(m)
	return m
}
func TestAuroraNativeExports(t *testing.T) {
	for _, target := range []string{"terraform", "cloudformation"} {
		for _, two := range []bool{false, true} {
			t.Run(target+map[bool]string{false: "/single", true: "/two"}[two], func(t *testing.T) {
				model := auroraModel(two)
				before := cloneNormalized(t, model)
				artifact, diagnostics := kmsArtifact(model, target)
				assertNoTargetErrors(t, diagnostics)
				if artifact == nil {
					t.Fatal("missing Aurora export")
				}
				if !reflect.DeepEqual(model, before) {
					t.Fatal("source mutated")
				}
				filename, name := "infrastructure/data.tf", "data.tf"
				if target == "cloudformation" {
					filename, name = cloudFormationTemplatePath, "template.json"
				}
				content := fileContent(t, artifact, filename)
				for _, bad := range []string{"master_password =", "\"MasterUserPassword\"", "SecretString", "GenerateSecretString", "kms_key_id", "KmsKeyId", "seconds_until_auto_pause", "SecondsUntilAutoPause", "aws_db_proxy", "AWS::RDS::DBProxy"} {
					if strings.Contains(content, bad) {
						t.Fatalf("unsupported behavior %s", bad)
					}
				}
				if target == "terraform" {
					for _, file := range artifact.Files {
						if strings.HasSuffix(file.Path, ".tf") {
							if _, diagnostics := hclsyntax.ParseConfig([]byte(file.Content), file.Path, hcl.InitialPos); diagnostics.HasErrors() {
								t.Fatal(diagnostics.Error())
							}
						}
					}
					for _, part := range []string{"aws_rds_cluster", "aws_rds_cluster_instance", "aws_rds_cluster_parameter_group", "aws_rds_cluster.aurora_cluster.id", "aws_rds_cluster.aurora_cluster.engine_version", "aws_db_subnet_group.db_subnets.name", "aws_rds_cluster_parameter_group.aurora_parameters.name", "rds.force_ssl", "pending-reboot", "min_capacity = 0.5", "max_capacity = 4", "manage_master_user_password", "prevent_destroy", "synthetic-aurora-final"} {
						if !strings.Contains(content, part) {
							t.Fatalf("missing exact native projection %s", part)
						}
					}
					if !strings.Contains(fileContent(t, artifact, "infrastructure/outputs.tf"), "aws_rds_cluster.aurora_cluster.master_user_secret[0].secret_arn") {
						t.Fatal("managed-secret metadata traversal lost")
					}
				} else {
					var template map[string]any
					if json.Unmarshal([]byte(content), &template) != nil {
						t.Fatal("invalid structured JSON")
					}
					counts := map[string]int{}
					for _, raw := range template["Resources"].(map[string]any) {
						resource := raw.(map[string]any)
						typ := resource["Type"].(string)
						counts[typ]++
						properties := resource["Properties"].(map[string]any)
						if strings.HasPrefix(typ, "AWS::RDS::") && (resource["DeletionPolicy"] != "Retain" || resource["UpdateReplacePolicy"] != "Retain") {
							t.Fatal("native retention lost")
						}
						if typ == "AWS::RDS::DBCluster" {
							if properties["Engine"] != "aurora-postgresql" || properties["EngineMode"] != "provisioned" || properties["Port"] != float64(5432) || properties["StorageType"] != "aurora" || properties["ManageMasterUserPassword"] != true || properties["StorageEncrypted"] != true || properties["DeletionProtection"] != true {
								t.Fatal("cluster semantics lost")
							}
							if !reflect.DeepEqual(properties["ServerlessV2ScalingConfiguration"], map[string]any{"MinCapacity": float64(0.5), "MaxCapacity": float64(4)}) {
								t.Fatal("capacity shape lost")
							}
							if _, ok := properties["ApplyImmediately"]; ok {
								t.Fatal("unsupported CF cluster property")
							}
							for _, key := range []string{"DBSubnetGroupName", "DBClusterParameterGroupName"} {
								if _, ok := properties[key].(map[string]any)["Ref"]; !ok {
									t.Fatal("dependency not typed Ref")
								}
							}
						}
						if typ == "AWS::RDS::DBInstance" {
							if properties["DBInstanceClass"] != "db.serverless" || properties["PubliclyAccessible"] != false || properties["AutoMinorVersionUpgrade"] != false || properties["ApplyImmediately"] != false {
								t.Fatal("member semantics lost")
							}
							for _, key := range []string{"EngineVersion", "StorageEncrypted", "MasterUsername", "ManageMasterUserPassword", "Port", "BackupRetentionPeriod", "AllocatedStorage"} {
								if _, ok := properties[key]; ok {
									t.Fatalf("cluster-owned property duplicated: %s", key)
								}
							}
							if _, ok := properties["DBClusterIdentifier"].(map[string]any)["Ref"]; !ok {
								t.Fatal("member not bound to cluster")
							}
						}
						if typ == "AWS::RDS::DBClusterParameterGroup" && !reflect.DeepEqual(properties["Parameters"], map[string]any{"rds.force_ssl": "1"}) {
							t.Fatal("cluster TLS parameters lost")
						}
					}
					wantMembers := 1
					if two {
						wantMembers = 2
					}
					if counts["AWS::RDS::DBCluster"] != 1 || counts["AWS::RDS::DBInstance"] != wantMembers || counts["AWS::RDS::DBClusterParameterGroup"] != 1 || counts["AWS::RDS::DBSubnetGroup"] != 1 {
						t.Fatal("native resources missing or duplicated")
					}
					if !strings.Contains(content, "MasterUserSecret.SecretArn") || !strings.Contains(content, "ReadEndpoint.Address") {
						t.Fatal("typed cluster metadata outputs lost")
					}
				}
				if !two {
					golden := filepath.Join("testdata", "aurora-goldens-v1", name)
					if os.Getenv("CLOUDMARKUP_UPDATE_AURORA_GOLDENS") == "1" {
						if err := os.MkdirAll(filepath.Dir(golden), 0700); err != nil {
							t.Fatal(err)
						}
						if err := os.WriteFile(golden, []byte(content), 0600); err != nil {
							t.Fatal(err)
						}
					}
					expected, err := os.ReadFile(golden)
					if err != nil || string(expected) != content {
						t.Fatal("Aurora golden drift")
					}
				}
				reordered := cloneNormalized(t, model)
				for l, r := 0, len(reordered.Resources)-1; l < r; l, r = l+1, r-1 {
					reordered.Resources[l], reordered.Resources[r] = reordered.Resources[r], reordered.Resources[l]
				}
				for l, r := 0, len(reordered.Connections)-1; l < r; l, r = l+1, r-1 {
					reordered.Connections[l], reordered.Connections[r] = reordered.Connections[r], reordered.Connections[l]
				}
				sortModel(reordered)
				again, diagnostics := kmsArtifact(reordered, target)
				assertNoTargetErrors(t, diagnostics)
				if !reflect.DeepEqual(artifact, again) {
					t.Fatal("ordering changed native bytes")
				}
			})
		}
	}
}
func TestAuroraImmutableArchitectureCompile(t *testing.T) {
	for _, target := range []TargetKind{TargetTerraform, TargetCloudFormation} {
		for _, two := range []bool{false, true} {
			t.Run(string(target)+map[bool]string{false: "/single", true: "/two"}[two], func(t *testing.T) {
				architecture := decodeMap(t, architectureFromNormalized(t, auroraModel(two)))
				architecture["workloadBehavior"].(map[string]any)["workloads"] = []any{}
				input, err := json.Marshal(architecture)
				if err != nil {
					t.Fatal(err)
				}
				request := CompileRequest{Request: Request{Architecture: input, Target: target}}
				result := Compile(context.Background(), request)
				if !result.Succeeded() || result.Artifact == nil {
					t.Fatalf("immutable Aurora input failed: %v", result.Diagnostics)
				}
				again := Compile(context.Background(), request)
				if !again.Succeeded() || !reflect.DeepEqual(result.Artifact, again.Artifact) {
					t.Fatal("immutable export not reproducible")
				}
			})
		}
	}
}
func TestAuroraSourceFieldDrift(t *testing.T) {
	contents, err := os.ReadFile(filepath.Join("..", "..", "packages", "provider-aws", "src", "compiled", "catalog-v1.json"))
	if err != nil {
		t.Fatal(err)
	}
	var catalog struct {
		Services []struct {
			ID            string `json:"id"`
			Configuration struct {
				JSONSchema struct {
					Properties map[string]ecsField `json:"properties"`
				} `json:"jsonSchema"`
			} `json:"configuration"`
		} `json:"services"`
	}
	if json.Unmarshal(contents, &catalog) != nil {
		t.Fatal("invalid catalog")
	}
	count := 0
	for _, service := range catalog.Services {
		if expected, ok := auroraSchemas[service.ID]; ok {
			count++
			if !reflect.DeepEqual(expected, service.Configuration.JSONSchema.Properties) {
				t.Fatal("Aurora source/native drift")
			}
		}
	}
	if count != 3 {
		t.Fatal("missing Aurora native cards")
	}
}
