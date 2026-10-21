package compiler

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

const eventRepositoryFixtureRoot = "../../packages/architecture-cli/src/fixtures/aws-eventing/compiler-v1"

func TestEventRepositoryCompilationFixtures(t *testing.T) {
	for _, fixtureCase := range []string{
		"s3-image-metadata",
		"sqs-consumer-dlq",
		"sns-fanout-multi",
		"eventbridge-scheduled",
		"eventbridge-target",
		"step-functions-task",
	} {
		fixtureCase := fixtureCase
		t.Run(fixtureCase, func(t *testing.T) {
			sourcePath := filepath.Join(eventRepositoryFixtureRoot, fixtureCase, "source.json")
			sourceBytes, err := os.ReadFile(sourcePath)
			if err != nil {
				t.Fatal(err)
			}
			var source struct {
				ArchitectureDocument json.RawMessage `json:"architectureDocument"`
				ApplicationContracts json.RawMessage `json:"applicationContracts"`
				Case                 string          `json:"case"`
				SolutionRevision     json.RawMessage `json:"solutionRevision"`
				WorkloadBehavior     json.RawMessage `json:"workloadBehavior"`
			}
			if err := json.Unmarshal(sourceBytes, &source); err != nil {
				t.Fatal(err)
			}
			var embedded struct {
				ApplicationContracts json.RawMessage `json:"applicationContracts"`
				WorkloadBehavior     json.RawMessage `json:"workloadBehavior"`
			}
			if err := json.Unmarshal(source.ArchitectureDocument, &embedded); err != nil {
				t.Fatal(err)
			}
			var standaloneApplication, embeddedApplication, standaloneWorkload, embeddedWorkload any
			for raw, target := range map[*any]json.RawMessage{
				&standaloneApplication: source.ApplicationContracts,
				&embeddedApplication:   embedded.ApplicationContracts,
				&standaloneWorkload:    source.WorkloadBehavior,
				&embeddedWorkload:      embedded.WorkloadBehavior,
			} {
				if err := json.Unmarshal(target, raw); err != nil {
					t.Fatal(err)
				}
			}
			if source.Case != fixtureCase || !reflect.DeepEqual(standaloneApplication, embeddedApplication) || !reflect.DeepEqual(standaloneWorkload, embeddedWorkload) {
				t.Fatal("standalone event source contracts drifted from the exact Architecture source")
			}
			compile := func() CompilationResult {
				return CompileReaders(context.Background(), CompileReaderRequest{Request: ReaderRequest{
					Architecture:     bytes.NewReader(source.ArchitectureDocument),
					Workload:         bytes.NewReader(source.WorkloadBehavior),
					SolutionRevision: bytes.NewReader(source.SolutionRevision),
					Target:           TargetTerraform,
					Compatibility:    DefaultCompatibilityRegistry(),
					Limits:           DefaultLimits(),
				}})
			}
			first := compile()
			second := compile()
			if !first.Succeeded() {
				t.Fatalf("compiler fixture failed: %#v", first.Diagnostics)
			}
			if first.Compiler.ID != CompilerID || first.Compiler.Version != CompilerVersion || first.Compiler.Digest != CompilerDigest {
				t.Fatalf("compiler fixture pin = %#v", first.Compiler)
			}
			if !reflect.DeepEqual(first, second) {
				t.Fatal("compiler fixture is not deterministic")
			}
			if first.Model == nil || first.Artifact == nil || len(first.Model.Resources) == 0 || len(first.Model.PolicyAttachments) == 0 || len(first.Artifact.PolicyArtifacts) == 0 {
				t.Fatalf("compiler fixture projection is incomplete: model=%#v artifact=%#v", first.Model, first.Artifact)
			}
			wantApplications := 1
			if fixtureCase == "sns-fanout-multi" {
				wantApplications = 2
			}
			if len(first.Artifact.ApplicationArtifacts) != wantApplications {
				t.Fatalf("application artifacts = %d, want %d", len(first.Artifact.ApplicationArtifacts), wantApplications)
			}
			for _, application := range first.Artifact.ApplicationArtifacts {
				wantPath := "application/artifacts/" + portableArtifactSegment(application.WorkloadID) + "/function.zip"
				if application.ContractVersion != ApplicationArtifactTargetNeutralContractVersion || application.ArtifactReadiness != "application-artifact-evidence-incomplete" || application.ExpectedArtifact == nil || application.ExpectedArtifact.Path != wantPath || application.RelativePackagePath != "../"+wantPath {
					t.Fatalf("final application artifact binding = %#v", application)
				}
			}
			prompt30AssertNoForbiddenTerraform(t, first.Artifact)
			for _, file := range first.Artifact.Files {
				if strings.Contains(file.Content, "depends_on") {
					t.Fatalf("%s contains arbitrary depends_on", file.Path)
				}
			}

			actual, err := json.MarshalIndent(first, "", "  ")
			if err != nil {
				t.Fatal(err)
			}
			actual = append(actual, '\n')
			compilationPath := filepath.Join(eventRepositoryFixtureRoot, fixtureCase, "compilation.json")
			if os.Getenv("CLOUDMARKUP_UPDATE_EVENT_REPOSITORY_FIXTURES") == "1" {
				if err := os.WriteFile(compilationPath, actual, 0o644); err != nil {
					t.Fatal(err)
				}
				return
			}
			expected, err := os.ReadFile(compilationPath)
			if err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(expected, actual) {
				t.Fatalf("compiler fixture drifted; regenerate %s", fmt.Sprintf("%s/compilation.json", fixtureCase))
			}
		})
	}
}
