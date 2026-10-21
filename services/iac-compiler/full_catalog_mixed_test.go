package compiler

import (
	"context"
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

// The shared network and subnet group keep their existing identities while
// standalone PostgreSQL and two Aurora members retain distinct lifecycles.
func TestStandaloneRdsAndTwoMemberAuroraCoexist(t *testing.T) {
	model := rdsModel(false)
	aurora := auroraModel(true)
	for _, resource := range aurora.Resources {
		if existing, ok := modelResource(model, resource.ID); ok {
			if !reflect.DeepEqual(existing, resource) {
				t.Fatalf("shared fixture resource %s differs", resource.ID)
			}
			continue
		}
		model.Resources = append(model.Resources, resource)
	}
	for _, connection := range aurora.Connections {
		found := false
		for _, existing := range model.Connections {
			if existing.ID == connection.ID {
				if !reflect.DeepEqual(existing, connection) {
					t.Fatalf("shared fixture edge %s differs", connection.ID)
				}
				found = true
				break
			}
		}
		if !found {
			model.Connections = append(model.Connections, connection)
		}
	}
	model.Outputs = append(model.Outputs, aurora.Outputs...)
	sortModel(model)
	before := cloneNormalized(t, model)
	compile := func(input *NormalizedSolution, target string) *TargetArtifact {
		architecture := decodeMap(t, architectureFromNormalized(t, input))
		architecture["workloadBehavior"].(map[string]any)["workloads"] = []any{}
		bytes, err := json.Marshal(architecture)
		if err != nil {
			t.Fatal(err)
		}
		result := Compile(context.Background(), CompileRequest{Request: Request{Architecture: bytes, Target: TargetKind(target)}})
		if !result.Succeeded() || result.Artifact == nil {
			t.Fatalf("mixed immutable architecture compile failed: %v", result.Diagnostics)
		}
		return result.Artifact
	}
	for _, target := range []string{"terraform", "cloudformation"} {
		t.Run(target, func(t *testing.T) {
			artifact := compile(model, target)
			if artifact == nil {
				t.Fatal("mixed database export absent")
			}
			if !reflect.DeepEqual(model, before) {
				t.Fatal("mixed export changed source identities")
			}
			if target == "terraform" {
				content := fileContent(t, artifact, "infrastructure/data.tf")
				for _, declaration := range []string{`resource "aws_db_instance" "database"`, `resource "aws_rds_cluster" "aurora_cluster"`, `resource "aws_rds_cluster_instance" "aurora_a"`, `resource "aws_rds_cluster_instance" "aurora_b"`} {
					if !strings.Contains(content, declaration) {
						t.Fatalf("lost native address %s", declaration)
					}
				}
				if strings.Count(content, `resource "aws_db_subnet_group"`) != 1 {
					t.Fatal("shared subnet group duplicated")
				}
			} else {
				var template map[string]any
				if err := json.Unmarshal([]byte(fileContent(t, artifact, cloudFormationTemplatePath)), &template); err != nil {
					t.Fatal(err)
				}
				counts := map[string]int{}
				postgres, auroraMembers := 0, 0
				for _, raw := range template["Resources"].(map[string]any) {
					resource := raw.(map[string]any)
					typ := resource["Type"].(string)
					counts[typ]++
					if typ == "AWS::RDS::DBInstance" {
						properties := resource["Properties"].(map[string]any)
						switch properties["Engine"] {
						case "postgres":
							postgres++
							if _, present := properties["DBClusterIdentifier"]; present {
								t.Fatal("standalone database became cluster member")
							}
						case "aurora-postgresql":
							auroraMembers++
							if _, present := properties["DBClusterIdentifier"].(map[string]any)["Ref"]; !present {
								t.Fatal("member lost typed cluster identity")
							}
						}
					}
				}
				if postgres != 1 || auroraMembers != 2 || counts["AWS::RDS::DBCluster"] != 1 || counts["AWS::RDS::DBSubnetGroup"] != 1 {
					t.Fatalf("mixed native resource identities lost: %v", counts)
				}
			}
			for _, file := range artifact.Files {
				if strings.Contains(file.Content, `"MasterUserPassword"`) || strings.Contains(file.Content, "master_password =") || strings.Contains(file.Content, "rds:*") {
					t.Fatal("mixed export introduced credential or broad permission")
				}
			}
			if !reflect.DeepEqual(artifact, compile(cloneNormalized(t, model), target)) {
				t.Fatal("identical immutable input changed export or provenance")
			}
			reordered := cloneNormalized(t, model)
			for i, j := 0, len(reordered.Resources)-1; i < j; i, j = i+1, j-1 {
				reordered.Resources[i], reordered.Resources[j] = reordered.Resources[j], reordered.Resources[i]
			}
			for i, j := 0, len(reordered.Connections)-1; i < j; i, j = i+1, j-1 {
				reordered.Connections[i], reordered.Connections[j] = reordered.Connections[j], reordered.Connections[i]
			}
			again := compile(reordered, target)
			// The source hash correctly describes the exact submitted bytes;
			// native files and addresses must remain independent of input order.
			if !reflect.DeepEqual(artifact.Files, again.Files) {
				t.Fatal("input order altered mixed native files")
			}
		})
	}
}
