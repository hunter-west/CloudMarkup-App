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

func rdsModel(multi bool) *NormalizedSolution {
	base := ec2Model(false)
	m := cloneRdsModel(base)
	m.Provenance.Catalog = CatalogReference{ID: TerraformCatalogID, Version: CurrentAwsCatalogVersion, Digest: CurrentAwsCatalogDigest}
	m.Resources = nil
	m.Connections = nil
	m.Outputs = nil
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
	vpc, _ := modelResource(m, "vpc")
	az := networkResource("az_b", "az_b", serviceAvailabilityZone, serviceAvailabilityZone+".configuration", "1.0.0", map[string]ConfigurationValue{"zoneName": stringValueConfig("us-east-1b")})
	setNetworkParent(&az, vpc)
	subnet := networkSubnet("subnet_b", "10.20.2.0/24", "private", false, az)
	table, _ := modelResource(m, "route_table_private")
	association := networkAssociation("private_b", table)
	m.Resources = append(m.Resources, az, subnet, association)
	m.Connections = append(m.Connections, networkConnection("vpc_az_b", "aws.ec2.vpc-contains-availability-zone", vpc, az), networkConnection("az_subnet_b", "aws.ec2.availability-zone-contains-subnet", az, subnet), networkConnection("table_association_b", "aws.ec2.route-table-owns-subnet-association", association, table), networkConnection("association_subnet_b", "aws.ec2.route-table-association-targets-subnet", association, subnet))
	node := func(id, typ string, values map[string]ConfigurationValue) NormalizedResource {
		return networkResource(id, id, typ, typ+".configuration", "1.0.0", values)
	}
	database := node("database", serviceRdsInstance, map[string]ConfigurationValue{"identifier": stringValueConfig("synthetic-postgres"), "engine": stringValueConfig("postgres"), "engineVersion": stringValueConfig("16.6"), "instanceClass": stringValueConfig("db.t4g.small"), "databaseName": stringValueConfig("SyntheticApp"), "masterUsername": stringValueConfig("SyntheticAdmin"), "masterAuthMode": stringValueConfig("rds-managed"), "storageType": stringValueConfig("gp3"), "storageGiB": integerValue(30), "storageEncrypted": boolValue(true), "encryptionMode": stringValueConfig("aws-managed"), "multiAz": boolValue(multi), "port": integerValue(5432), "backupRetentionDays": integerValue(7), "backupWindow": stringValueConfig("02:00-02:30"), "maintenanceWindow": stringValueConfig("sun:03:00-sun:03:30"), "caIdentifier": stringValueConfig("rds-ca-rsa2048-g1"), "publicAccess": boolValue(false), "deletionProtection": boolValue(true), "retain": boolValue(true), "autoMinorUpgrade": boolValue(false), "allowMajorUpgrade": boolValue(false), "extendedSupport": stringValueConfig("disabled"), "iamAuthentication": boolValue(false), "performanceInsights": boolValue(false), "monitoringInterval": integerValue(0)})
	group := node("db_subnets", serviceRdsSubnetGroup, map[string]ConfigurationValue{"name": stringValueConfig("synthetic-db-subnets"), "description": stringValueConfig("Explicit synthetic database subnets"), "retain": boolValue(true)})
	parameters := node("db_parameters", serviceRdsParameterGroup, map[string]ConfigurationValue{"name": stringValueConfig("synthetic-postgres-tls"), "description": stringValueConfig("Explicit synthetic TLS parameters"), "family": stringValueConfig("postgres16"), "forceTls": boolValue(true), "retain": boolValue(true)})
	m.Resources = append(m.Resources, database, group, parameters)
	for _, b := range [][4]string{{"db_subnet_a", rdsSubnetBinding, "db_subnets", "subnet"}, {"db_subnet_b", rdsSubnetBinding, "db_subnets", "subnet_b"}, {"db_subnets_binding", rdsSubnetGroupBinding, "db_subnets", "database"}, {"db_parameters_binding", rdsParameterBinding, "db_parameters", "database"}, {"db_group_binding", rdsGroupBinding, "database", "group"}} {
		s, _ := modelResource(m, b[2])
		target, _ := modelResource(m, b[3])
		e := networkConnection(b[0], b[1], s, target)
		e.Configuration.SchemaID = b[1] + ".connection"
		m.Connections = append(m.Connections, e)
	}
	for _, n := range []NormalizedResource{database, group, parameters} {
		attributes := []string{"name", "arn"}
		if n.ID == database.ID {
			attributes = []string{"identifier", "arn", "address", "port", "masterUserSecretArn"}
		}
		for _, a := range attributes {
			ref := reference(n)
			ref.Attribute = n.ServiceType + "." + a
			m.Outputs = append(m.Outputs, NormalizedOutput{ID: n.ID + "_" + a, Key: n.ID + "_" + a, Kind: "node-attribute", Resource: &ref})
		}
	}
	sortModel(m)
	return m
}
func cloneRdsModel(m *NormalizedSolution) *NormalizedSolution {
	b, _ := json.Marshal(m)
	var copy NormalizedSolution
	if json.Unmarshal(b, &copy) != nil {
		panic("invalid synthetic model")
	}
	return &copy
}

func TestRdsNativeExports(t *testing.T) {
	for _, target := range []string{"terraform", "cloudformation"} {
		for _, multi := range []bool{false, true} {
			t.Run(target+"/"+map[bool]string{false: "single", true: "standby"}[multi], func(t *testing.T) {
				m := rdsModel(multi)
				before := cloneNormalized(t, m)
				artifact, diagnostics := kmsArtifact(m, target)
				assertNoTargetErrors(t, diagnostics)
				if artifact == nil {
					t.Fatal("missing export")
				}
				if !reflect.DeepEqual(m, before) {
					t.Fatal("source mutated")
				}
				path, name := "infrastructure/data.tf", "data.tf"
				if target == "cloudformation" {
					path, name = cloudFormationTemplatePath, "template.json"
				}
				content := fileContent(t, artifact, path)
				for _, bad := range []string{"master_password =", "\"MasterUserPassword\"", "SecretString", "secret_string", "GenerateSecretString", "aws_rds_cluster", "AWS::RDS::DBCluster", "aws_db_proxy", "AWS::RDS::DBProxy", "aws_iam_policy", "kms_key_id", "KmsKeyId"} {
					if strings.Contains(content, bad) {
						t.Fatalf("unsupported native behavior %s", bad)
					}
				}
				if target == "terraform" {
					for _, f := range artifact.Files {
						if strings.HasSuffix(f.Path, ".tf") {
							if _, d := hclsyntax.ParseConfig([]byte(f.Content), f.Path, hcl.InitialPos); d.HasErrors() {
								t.Fatal(d.Error())
							}
						}
					}
					for _, part := range []string{"aws_db_instance", "aws_db_subnet_group.db_subnets.name", "aws_db_parameter_group.db_parameters.name", "aws_security_group.group.id", "aws_subnet.subnet_subnet.id", "aws_subnet.subnet_b_subnet.id", "rds.force_ssl", "pending-reboot", "manage_master_user_password", "deletion_protection", "prevent_destroy", "open-source-rds-extended-support-disabled", "synthetic-postgres-final"} {
						if !strings.Contains(content, part) {
							t.Fatalf("missing exact native binding %s", part)
						}
					}
					outputs := fileContent(t, artifact, "infrastructure/outputs.tf")
					if !strings.Contains(outputs, "aws_db_instance.database.master_user_secret[0].secret_arn") {
						t.Fatal("managed secret metadata traversal lost")
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
						if strings.HasPrefix(typ, "AWS::RDS::") && (res["DeletionPolicy"] != "Retain" || res["UpdateReplacePolicy"] != "Retain") {
							t.Fatal("native dependent retention lost")
						}
						p := res["Properties"].(map[string]any)
						if typ == "AWS::RDS::DBInstance" {
							if p["AllocatedStorage"] != "30" || p["Port"] != "5432" || p["ApplyImmediately"] != false || p["MultiAZ"] != multi || p["ManageMasterUserPassword"] != true || p["StorageEncrypted"] != true || p["PubliclyAccessible"] != false || p["DeletionProtection"] != true || p["EngineLifecycleSupport"] != "open-source-rds-extended-support-disabled" || res["DeletionPolicy"] != "Retain" || res["UpdateReplacePolicy"] != "Retain" {
								t.Fatal("native database security/lifecycle lost")
							}
							for _, key := range []string{"DBSubnetGroupName", "DBParameterGroupName"} {
								if _, ok := p[key].(map[string]any)["Ref"]; !ok {
									t.Fatal("dependency is not typed Ref")
								}
							}
						}
						if typ == "AWS::RDS::DBParameterGroup" {
							if !reflect.DeepEqual(p["Parameters"], map[string]any{"rds.force_ssl": "1"}) {
								t.Fatal("TLS parameter lost")
							}
						}
					}
					for _, typ := range []string{"AWS::RDS::DBInstance", "AWS::RDS::DBSubnetGroup", "AWS::RDS::DBParameterGroup"} {
						if types[typ] != 1 {
							t.Fatal("native resource missing or duplicated")
						}
					}
					if !strings.Contains(content, "MasterUserSecret.SecretArn") {
						t.Fatal("managed-secret metadata GetAtt lost")
					}
				}
				if !multi {
					golden := filepath.Join("testdata", "rds-goldens-v1", name)
					if os.Getenv("CLOUDMARKUP_UPDATE_RDS_GOLDENS") == "1" {
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
						t.Fatal("RDS golden drift")
					}
				}
				reordered := cloneNormalized(t, m)
				for l, r := 0, len(reordered.Resources)-1; l < r; l, r = l+1, r-1 {
					reordered.Resources[l], reordered.Resources[r] = reordered.Resources[r], reordered.Resources[l]
				}
				for l, r := 0, len(reordered.Connections)-1; l < r; l, r = l+1, r-1 {
					reordered.Connections[l], reordered.Connections[r] = reordered.Connections[r], reordered.Connections[l]
				}
				sortModel(reordered)
				again, d := kmsArtifact(reordered, target)
				assertNoTargetErrors(t, d)
				if !reflect.DeepEqual(artifact, again) {
					t.Fatal("reordering changed native bytes")
				}
			})
		}
	}
}
func TestRdsSourceFieldDrift(t *testing.T) {
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
	for _, s := range catalog.Services {
		if expected, ok := rdsSchemas[s.ID]; ok {
			count++
			if !reflect.DeepEqual(expected, s.Configuration.JSONSchema.Properties) {
				t.Fatal("RDS source/native schema drift")
			}
		}
	}
	if count != 3 {
		t.Fatal("native RDS cards missing")
	}
}
func TestRdsCurrentAndFrozenCompatibility(t *testing.T) {
	m := rdsModel(false)
	m.Provenance.Catalog = CatalogReference{ID: TerraformCatalogID, Version: "0.23.0", Digest: "sha256:7cd7e7012e1758fd1c17bdf1c0823bc55caae868b36213ea3b3c7d3e73195dc9"}
	for _, target := range []string{"terraform", "cloudformation"} {
		a, d := kmsArtifact(m, target)
		if a != nil || !ecsHasErrors(d) {
			t.Fatal("RDS admitted under frozen ECS authority")
		}
	}
}

func TestRdsImmutableArchitectureCompile(t *testing.T) {
	for _, target := range []TargetKind{TargetTerraform, TargetCloudFormation} {
		for _, multi := range []bool{false, true} {
			t.Run(string(target)+map[bool]string{false: "/single", true: "/standby"}[multi], func(t *testing.T) {
				m := rdsModel(multi)
				architecture := decodeMap(t, architectureFromNormalized(t, m))
				architecture["workloadBehavior"].(map[string]any)["workloads"] = []any{}
				input, err := json.Marshal(architecture)
				if err != nil {
					t.Fatal(err)
				}
				request := CompileRequest{Request: Request{Architecture: input, Target: target}}
				result := Compile(context.Background(), request)
				if !result.Succeeded() || result.Artifact == nil {
					t.Fatalf("immutable RDS input failed: %v", result.Diagnostics)
				}
				again := Compile(context.Background(), request)
				if !again.Succeeded() || !reflect.DeepEqual(result.Artifact, again.Artifact) {
					t.Fatal("immutable RDS export not reproducible")
				}
			})
		}
	}
}

func TestRdsReservedNameSourceDrift(t *testing.T) {
	source, err := os.ReadFile(filepath.Join("..", "..", "packages", "provider-aws", "src", "catalog", "services", "rds-postgres-reserved-v1.json"))
	if err != nil {
		t.Fatal(err)
	}
	if string(source) != string(rdsReservedJSON) {
		t.Fatal("reserved-name source/native drift")
	}
	if len(rdsReserved) != 101 || !rdsReserved["select"] || !rdsReserved["current_user"] || rdsReserved["syntheticadmin"] {
		t.Fatal("reserved-name contract lost")
	}
}
