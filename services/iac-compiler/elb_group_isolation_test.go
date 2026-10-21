package compiler

import (
	"reflect"
	"testing"
)

func elbUnrelatedConsumer(t *testing.T, model *NormalizedSolution, ecs, sourceGroup bool) *NormalizedSolution {
	t.Helper()
	m := cloneNormalized(t, model)
	id := "instance"
	if ecs {
		id = "service"
	}
	consumer, ok := modelResource(cloneNormalized(t, m), id)
	if !ok {
		t.Fatal("missing synthetic selected backend")
	}
	consumer.ID = "bystander_backend"
	consumer.DeploymentKey = consumer.ID
	consumer.TargetKey = consumer.ID
	if ecs {
		consumer.Configuration.Values["name"] = stringValueConfig("SyntheticBystander")
	}
	bindings := []NormalizedConnection{}
	for _, edge := range m.Connections {
		if edge.RelationshipType == albEc2 || edge.RelationshipType == albEcs {
			continue
		}
		if edge.Source.NodeID != id && edge.Target.NodeID != id {
			continue
		}
		copy := edge
		copy.ID = "bystander_" + edge.ID
		if edge.Source.NodeID == id {
			copy.Source.NodeID = consumer.ID
			copy.Source.TargetKey = consumer.TargetKey
		}
		if edge.Target.NodeID == id {
			copy.Target.NodeID = consumer.ID
			copy.Target.TargetKey = consumer.TargetKey
		} else if sourceGroup && (edge.RelationshipType == ec2GroupRelationship || edge.RelationshipType == ecsGroupBinding) {
			group, _ := modelResource(m, "alb_group")
			copy.Target.NodeID = group.ID
			copy.Target.TargetKey = group.TargetKey
		}
		bindings = append(bindings, copy)
	}
	m.Resources = append(m.Resources, consumer)
	m.Connections = append(m.Connections, bindings...)
	sortModel(m)
	return m
}

func TestElbDedicatedGroupRejectsUnrelatedConsumers(t *testing.T) {
	for _, current := range []bool{true} {
		for _, ecs := range []bool{false, true} {
			for _, sourceGroup := range []bool{false, true} {
				for _, target := range []string{"terraform", "cloudformation"} {
					version := "0.28"
					if current {
						version = "0.29"
					}
					name := version + "/" + map[bool]string{false: "EC2", true: "Fargate"}[ecs] + "/" + map[bool]string{false: "backend", true: "source"}[sourceGroup] + "/" + target
					t.Run(name, func(t *testing.T) {
						base := elbModel(ecs, false)
						if current {
							base.Provenance.Catalog = CatalogReference{ID: TerraformCatalogID, Version: CurrentAwsCatalogVersion, Digest: CurrentAwsCatalogDigest}
						}
						_, baseline := kmsArtifact(base, target)
						assertNoTargetErrors(t, baseline)
						changed := elbUnrelatedConsumer(t, base, ecs, sourceGroup)
						before := cloneNormalized(t, changed)
						artifact, diagnostics := kmsArtifact(changed, target)
						if artifact != nil || !ecsHasErrors(diagnostics) {
							t.Fatalf("accepted unrelated group consumer: %v", diagnostics)
						}
						found := false
						code := "TARGET_ELB_SHARED_ACCESS_UNSUPPORTED"
						if target == "cloudformation" {
							code = "CLOUDFORMATION_ELB_SHARED_ACCESS_UNSUPPORTED"
						}
						for _, diagnostic := range diagnostics {
							if diagnostic.Code == code {
								found = true
							}
						}
						if !found {
							t.Fatalf("missing dedicated-group rejection: %v", diagnostics)
						}
						if !reflect.DeepEqual(before, changed) {
							t.Fatal("shared-group rejection mutated its input")
						}
					})
				}
			}
		}
	}
}

func TestElbDedicatedGroupPreservesMultipleFargateTasks(t *testing.T) {
	for _, current := range []bool{true} {
		for _, target := range []string{"terraform", "cloudformation"} {
			name := map[bool]string{false: "0.28", true: "0.29"}[current] + "/" + target
			t.Run(name, func(t *testing.T) {
				m := elbModel(true, false)
				if current {
					m.Provenance.Catalog = CatalogReference{ID: TerraformCatalogID, Version: CurrentAwsCatalogVersion, Digest: CurrentAwsCatalogDigest}
				}
				for i := range m.Resources {
					n := &m.Resources[i]
					if n.ID == "service" {
						n.Configuration.Values["desiredCount"] = integerValue(3)
					}
					if n.ID == "image" {
						n.Configuration.Values["publicationStatus"] = stringValueConfig("externally-confirmed")
					}
				}
				for i := range m.Connections {
					values := m.Connections[i].Configuration.Values
					if _, ok := values["populationStatus"]; ok {
						values["populationStatus"] = stringValueConfig("externally-confirmed")
					}
				}
				before := cloneNormalized(t, m)
				artifact, diagnostics := kmsArtifact(m, target)
				assertNoTargetErrors(t, diagnostics)
				if artifact == nil || !reflect.DeepEqual(before, m) {
					t.Fatal("intended service task count was rejected or mutated")
				}
			})
		}
	}
}
