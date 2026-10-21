package compiler

import "testing"

func TestAuroraNativeInstanceNamespaceCollision(t *testing.T) {
	for _, target := range []string{"terraform", "cloudformation"} {
		model, rds := auroraModel(true), rdsModel(false)
		extra := map[string]bool{"database": true, "db_parameters": true}
		for _, node := range rds.Resources {
			if extra[node.ID] {
				model.Resources = append(model.Resources, node)
			}
		}
		for _, edge := range rds.Connections {
			if extra[edge.Source.NodeID] || extra[edge.Target.NodeID] {
				model.Connections = append(model.Connections, edge)
			}
		}
		sortModel(model)
		artifact, diagnostics := kmsArtifact(model, target)
		assertNoTargetErrors(t, diagnostics)
		if artifact == nil {
			t.Fatal("valid mixed RDS and Aurora export missing")
		}
		ec2Set(model, "aurora_a", "identifier", stringValueConfig("synthetic-postgres"))
		artifact, diagnostics = kmsArtifact(model, target)
		found := false
		for _, diagnostic := range diagnostics {
			if diagnostic.Code == "TARGET_AURORA_NAME_DUPLICATE" || diagnostic.Code == "CLOUDFORMATION_AURORA_NAME_DUPLICATE" {
				found = true
			}
		}
		if artifact != nil || !found {
			t.Fatalf("%s admitted native instance namespace collision: %v", target, diagnostics)
		}
	}
}

func TestAuroraCrossVPCSecurityGroup(t *testing.T) {
	for _, target := range []string{"terraform", "cloudformation"} {
		model := auroraModel(true)
		vpc, _ := modelResource(model, "vpc")
		vpc.ID, vpc.DeploymentKey = "other_vpc", "other_vpc"
		model.Resources = append(model.Resources, vpc)
		region, _ := modelResource(model, "region")
		model.Connections = append(model.Connections, networkConnection("region_other_vpc", "aws.region.contains-vpc", region, vpc))
		for i, edge := range model.Connections {
			if edge.RelationshipType == "aws.ec2.vpc-associates-security-group" && edge.Target.NodeID == "group" {
				model.Connections[i].Source = reference(vpc)
				model.Connections[i].Source.Port = edge.Source.Port
			}
		}
		sortModel(model)
		artifact, diagnostics := kmsArtifact(model, target)
		found := false
		for _, diagnostic := range diagnostics {
			if diagnostic.Code == "TARGET_AURORA_CROSS_VPC_INVALID" || diagnostic.Code == "CLOUDFORMATION_AURORA_CROSS_VPC_INVALID" {
				found = true
			}
		}
		if artifact != nil || !found {
			t.Fatalf("%s admitted cross-VPC Aurora security: %v", target, diagnostics)
		}
	}
}
