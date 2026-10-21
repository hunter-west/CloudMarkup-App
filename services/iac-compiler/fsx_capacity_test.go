package compiler

import (
	"context"
	"reflect"
	"strconv"
	"strings"
	"testing"

	"github.com/hashicorp/hcl/v2"
	"github.com/hashicorp/hcl/v2/hclwrite"
)

func fsxCapacityArtifact(t *testing.T, model *NormalizedSolution, target string) (*TargetArtifact, []Diagnostic) {
	t.Helper()
	if target == "terraform" {
		return renderTerraformArtifact(context.Background(), model, nil, DefaultLimits())
	}
	return renderCloudFormationArtifact(context.Background(), model, nil, DefaultLimits())
}
func fsxWithCapacity(service string, capacity int, current bool) *NormalizedSolution {
	model := fsxModel(service)
	if current {
		model.Provenance.Catalog = CatalogReference{ID: TerraformCatalogID, Version: CurrentAwsCatalogVersion, Digest: CurrentAwsCatalogDigest}
	}
	for i := range model.Resources {
		if model.Resources[i].ID == "fsx" {
			model.Resources[i].Configuration.Values["storageCapacity"] = integerValue(capacity)
		}
	}
	return model
}
func TestFsxCapacityCurrentRejectsUnsupportedSizesWithoutPartialArtifacts(t *testing.T) {
	for _, test := range []struct {
		service  string
		capacity int
	}{
		{serviceFsxLustre, 0}, {serviceFsxLustre, 1199}, {serviceFsxLustre, 1201}, {serviceFsxLustre, 3600}, {serviceFsxLustre, 6000}, {serviceFsxLustre, 2401200},
		{serviceFsxONTAP, 1023}, {serviceFsxONTAP, 524289}, {serviceFsxONTAP, 1048576},
	} {
		for _, target := range []string{"terraform", "cloudformation"} {
			t.Run(test.service+"/"+strconv.Itoa(test.capacity)+"/"+target, func(t *testing.T) {
				artifact, diagnostics := fsxCapacityArtifact(t, fsxWithCapacity(test.service, test.capacity, true), target)
				if artifact != nil {
					t.Fatal("unsupported capacity returned a partial artifact")
				}
				found := false
				for _, d := range diagnostics {
					expectedCode := "TARGET_FSX_STORAGE_CAPACITY_INVALID"
					if target == "cloudformation" {
						expectedCode = "CLOUDFORMATION_FSX_STORAGE_CAPACITY_INVALID"
					}
					if d.Code == expectedCode {
						found = true
						if d.Source.NodeID != "fsx" || d.Source.Document != DocumentArchitecture || d.Severity != SeverityError {
							t.Fatalf("wrong source or severity: %#v", d)
						}
					}
				}
				if !found {
					t.Fatalf("missing precise capacity diagnostic: %#v", diagnostics)
				}
			})
		}
	}
}
func TestFsxCapacityCurrentPreservesValidSourceAndReproducibility(t *testing.T) {
	for _, test := range []struct {
		service  string
		capacity int
	}{
		{serviceFsxLustre, 1200}, {serviceFsxLustre, 2400}, {serviceFsxLustre, 4800}, {serviceFsxLustre, 7200}, {serviceFsxLustre, 2400000}, {serviceFsxONTAP, 1024}, {serviceFsxONTAP, 524288},
	} {
		for _, target := range []string{"terraform", "cloudformation"} {
			t.Run(test.service+"/"+strconv.Itoa(test.capacity)+"/"+target, func(t *testing.T) {
				model := fsxWithCapacity(test.service, test.capacity, true)
				current, diagnostics := fsxCapacityArtifact(t, model, target)
				assertNoTargetErrors(t, diagnostics)
				again, repeatedDiagnostics := fsxCapacityArtifact(t, model, target)
				assertNoTargetErrors(t, repeatedDiagnostics)
				if current == nil || again == nil {
					t.Fatal("missing accepted artifact")
				}
				if !reflect.DeepEqual(current, again) {
					t.Fatal("current output is not byte-reproducible")
				}

			})
		}
	}
}

// Compare every other byte after removing the one explicitly reviewed new attribute.

func TestFsxONTAPCurrentUsesOnlyTheExplicitSingleSubnet(t *testing.T) {
	for _, selected := range []string{"private_a", "private_b"} {
		t.Run(selected, func(t *testing.T) {
			model := fsxWithCapacity(serviceFsxONTAP, 1024, true)
			for i := range model.Connections {
				if model.Connections[i].ID == "fsx_subnet" {
					storage, _ := modelResource(model, "fsx")
					subnet, _ := modelResource(model, selected)
					model.Connections[i] = networkConnection("fsx_subnet", serviceFsxONTAP+"-uses-subnet", storage, subnet)
				}
			}
			artifact, diagnostics := fsxCapacityArtifact(t, model, "terraform")
			assertNoTargetErrors(t, diagnostics)
			if artifact == nil {
				t.Fatal("missing ONTAP artifact")
			}
			seen := 0
			for _, file := range artifact.Files {
				if !strings.HasSuffix(file.Path, ".tf") {
					continue
				}
				parsed, errors := hclwrite.ParseConfig([]byte(file.Content), file.Path, hcl.InitialPos)
				if errors.HasErrors() {
					t.Fatal(errors.Error())
				}
				for _, block := range parsed.Body().Blocks() {
					labels := block.Labels()
					if block.Type() != "resource" || len(labels) != 2 || labels[0] != "aws_fsx_ontap_file_system" {
						continue
					}
					attribute := block.Body().GetAttribute("preferred_subnet_id")
					if attribute == nil {
						t.Fatal("missing provider-required preferred subnet")
					}
					actual := strings.TrimSpace(string(attribute.Expr().BuildTokens(nil).Bytes()))
					if actual != "aws_subnet."+selected+"_subnet.id" {
						t.Fatalf("preferred subnet did not follow graph intent: %s", actual)
					}
					seen++
				}
			}
			if seen != 1 {
				t.Fatalf("expected one reviewed ONTAP mapping, got %d", seen)
			}
		})
	}
	for _, count := range []int{0, 2} {
		model := fsxWithCapacity(serviceFsxONTAP, 1024, true)
		if count == 0 {
			connections := []NormalizedConnection{}
			for _, edge := range model.Connections {
				if edge.ID != "fsx_subnet" {
					connections = append(connections, edge)
				}
			}
			model.Connections = connections
		} else {
			storage, _ := modelResource(model, "fsx")
			subnet, _ := modelResource(model, "private_b")
			model.Connections = append(model.Connections, networkConnection("fsx_other_subnet", serviceFsxONTAP+"-uses-subnet", storage, subnet))
		}
		artifact, diagnostics := fsxCapacityArtifact(t, model, "terraform")
		if artifact != nil || len(diagnostics) == 0 {
			t.Fatal("missing or ambiguous subnet produced an artifact")
		}
	}
}

func TestFsxONTAPThroughputBothTargets(t *testing.T) {
	for _, throughput := range []int{384, 768, 1536, 3072, 6144} {
		for _, target := range []string{"terraform", "cloudformation"} {
			model := fsxModel(serviceFsxONTAP)
			setNetworkingValue(model, "fsx", "throughputCapacity", integerValue(throughput))
			artifact, diagnostics := fsxCapacityArtifact(t, model, target)
			if throughput < 1536 {
				found := false
				for _, diagnostic := range diagnostics {
					if strings.HasSuffix(diagnostic.Code, "FSX_ONTAP_THROUGHPUT_INVALID") && diagnostic.Source.NodeID == "fsx" && diagnostic.Source.Path == "$.semantic.configuration.values.throughputCapacity" {
						found = true
					}
				}
				if artifact != nil || !found {
					t.Fatalf("%s admitted unsupported %d: %v", target, throughput, diagnostics)
				}
				continue
			}
			assertNoTargetErrors(t, diagnostics)
			again, repeated := fsxCapacityArtifact(t, model, target)
			assertNoTargetErrors(t, repeated)
			if artifact == nil || !reflect.DeepEqual(artifact, again) {
				t.Fatal("valid throughput is not reproducible")
			}
			path, expected := "infrastructure/data.tf", "throughput_capacity_per_ha_pair = "+strconv.Itoa(throughput)
			if target == "cloudformation" {
				path, expected = cloudFormationTemplatePath, `"ThroughputCapacityPerHAPair": `+strconv.Itoa(throughput)
			}
			content := fileContent(t, artifact, path)
			if !strings.Contains(strings.Join(strings.Fields(content), " "), expected) {
				t.Fatalf("%s changed explicit throughput %d", target, throughput)
			}
		}
	}
}
