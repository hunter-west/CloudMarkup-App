package main

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	compiler "cloudmarkup.com/iac-compiler"
)

func TestRunCLINormalizesArchitectureFromStdin(t *testing.T) {
	t.Parallel()

	architecture := representativeFixture(t)
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	exitCode := runCLI(context.Background(), []string{"normalize", "--architecture", "-"}, bytes.NewReader(architecture), &stdout, &stderr)
	if exitCode != 0 {
		t.Fatalf("runCLI() exit code = %d, stderr = %q, stdout = %q", exitCode, stderr.String(), stdout.String())
	}
	var result compiler.Result
	if err := json.Unmarshal(stdout.Bytes(), &result); err != nil {
		t.Fatalf("decode CLI result: %v", err)
	}
	if !result.Succeeded() || result.Model == nil || len(result.Model.Resources) != 2 {
		t.Fatalf("CLI result = %#v", result)
	}
	if stderr.Len() != 0 {
		t.Fatalf("stderr = %q, want empty", stderr.String())
	}
}

func TestRunCLICompileUsesTheTargetBoundary(t *testing.T) {
	t.Parallel()

	var stdout bytes.Buffer
	var stderr bytes.Buffer
	exitCode := runCLI(context.Background(), []string{"compile", "--architecture", "-"}, bytes.NewReader(representativeFixture(t)), &stdout, &stderr)
	if exitCode != 2 {
		t.Fatalf("compile exit code = %d, stderr = %q", exitCode, stderr.String())
	}
	var result compiler.CompilationResult
	if err := json.Unmarshal(stdout.Bytes(), &result); err != nil {
		t.Fatalf("decode compilation result: %v", err)
	}
	if result.Artifact != nil || !strings.Contains(stdout.String(), "TARGET_CATALOG_UNSUPPORTED") {
		t.Fatalf("compile result = %#v", result)
	}
	if stderr.Len() != 0 {
		t.Fatalf("stderr = %q, want structured stdout diagnostics", stderr.String())
	}
}

func TestRunCLICompileSelectsCloudFormation(t *testing.T) {
	t.Parallel()

	var stdout bytes.Buffer
	var stderr bytes.Buffer
	exitCode := runCLI(
		context.Background(),
		[]string{"compile", "--architecture", "-", "--target", "cloudformation"},
		bytes.NewReader(cloudFormationCLIFixture(t)),
		&stdout,
		&stderr,
	)
	if exitCode != 0 {
		t.Fatalf("CloudFormation compile exit code = %d, stderr = %q, stdout = %q", exitCode, stderr.String(), stdout.String())
	}
	var result compiler.CompilationResult
	if err := json.Unmarshal(stdout.Bytes(), &result); err != nil {
		t.Fatalf("decode CloudFormation compilation result: %v", err)
	}
	if result.Artifact == nil || result.Artifact.Target != compiler.TargetCloudFormation {
		t.Fatalf("CloudFormation artifact = %#v", result.Artifact)
	}
	foundTemplate := false
	for _, file := range result.Artifact.Files {
		if file.Path == "infrastructure/template.json" && strings.Contains(file.Content, `"AWSTemplateFormatVersion": "2010-09-09"`) {
			foundTemplate = true
		}
	}
	if !foundTemplate || stderr.Len() != 0 {
		t.Fatalf("CloudFormation CLI output missing template or wrote stderr: %q", stderr.String())
	}
}

func TestRunCLICompileSelectsCloudFormationForCuratedEventWorkload(t *testing.T) {
	t.Parallel()

	var stdout bytes.Buffer
	var stderr bytes.Buffer
	exitCode := runCLI(
		context.Background(),
		[]string{"compile", "--architecture", "-", "--target", "cloudformation"},
		bytes.NewReader(cloudFormationEventCLIFixture(t)),
		&stdout,
		&stderr,
	)
	if exitCode != 0 {
		t.Fatalf("curated CloudFormation compile exit code = %d, stderr = %q, stdout = %q", exitCode, stderr.String(), stdout.String())
	}
	var result compiler.CompilationResult
	if err := json.Unmarshal(stdout.Bytes(), &result); err != nil {
		t.Fatalf("decode curated CloudFormation compilation result: %v", err)
	}
	if result.Artifact == nil || result.Artifact.Target != compiler.TargetCloudFormation {
		t.Fatalf("curated CloudFormation artifact = %#v", result.Artifact)
	}
	template := ""
	for _, file := range result.Artifact.Files {
		if file.Path == "infrastructure/template.json" {
			template = file.Content
		}
		if strings.HasSuffix(file.Path, ".tf") {
			t.Fatalf("CloudFormation CLI artifact leaked Terraform file %q", file.Path)
		}
	}
	for _, marker := range []string{
		`"AWS::SQS::Queue"`,
		`"AWS::Lambda::EventSourceMapping"`,
		`"RedrivePolicy"`,
		`"FunctionResponseTypes"`,
	} {
		if !strings.Contains(template, marker) {
			t.Errorf("curated CloudFormation CLI template missing %s", marker)
		}
	}
}

func TestRunCLIRejectsUnsupportedCommandAndUnsafeOverwrite(t *testing.T) {
	t.Parallel()

	var stdout bytes.Buffer
	var stderr bytes.Buffer
	if exitCode := runCLI(context.Background(), []string{"deploy"}, strings.NewReader(""), &stdout, &stderr); exitCode != 2 {
		t.Fatalf("unsupported command exit code = %d, want 2", exitCode)
	}
	if !strings.Contains(stderr.String(), usageText) {
		t.Fatalf("stderr = %q, want usage", stderr.String())
	}

	directory := t.TempDir()
	inputPath := filepath.Join(directory, "architecture.json")
	if err := os.WriteFile(inputPath, representativeFixture(t), 0o600); err != nil {
		t.Fatalf("write fixture: %v", err)
	}
	stdout.Reset()
	stderr.Reset()
	exitCode := runCLI(context.Background(), []string{"normalize", "--architecture", inputPath, "--output", inputPath}, strings.NewReader(""), &stdout, &stderr)
	if exitCode != 2 || !strings.Contains(stderr.String(), "must not overwrite") {
		t.Fatalf("overwrite exit code = %d, stderr = %q", exitCode, stderr.String())
	}
}

func TestRunCLIReturnsStructuredDiagnosticsForInvalidInput(t *testing.T) {
	t.Parallel()

	var stdout bytes.Buffer
	var stderr bytes.Buffer
	exitCode := runCLI(context.Background(), []string{"normalize", "--architecture", "-"}, strings.NewReader(`{"kind":"cloudmarkup.architecture-document","schemaVersion":4}`), &stdout, &stderr)
	if exitCode != 2 {
		t.Fatalf("runCLI() exit code = %d, want 2", exitCode)
	}
	if !strings.Contains(stdout.String(), "COMPAT_SCHEMA_VERSION_UNSUPPORTED") || strings.Contains(stdout.String(), `schemaVersion\":4`) {
		t.Fatalf("stdout = %q, want stable content-free diagnostic", stdout.String())
	}
}

func representativeFixture(t *testing.T) []byte {
	t.Helper()
	_, thisFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller did not return the CLI test path")
	}
	path := filepath.Join(filepath.Dir(thisFile), "..", "..", "..", "..", "packages", "test-fixtures", "fixtures", "architecture-document", "v3", "valid", "representative.json")
	contents, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read representative fixture: %v", err)
	}
	return contents
}

func cloudFormationCLIFixture(t *testing.T) []byte {
	t.Helper()
	var document map[string]any
	if err := json.Unmarshal(representativeFixture(t), &document); err != nil {
		t.Fatalf("decode representative fixture: %v", err)
	}
	document["provider"] = map[string]any{"id": "aws.cloudmarkup", "region": "us-east-1"}
	document["catalog"] = map[string]any{
		"id":      compiler.CloudFormationCatalogID,
		"version": compiler.CurrentAwsCatalogVersion,
		"digest":  compiler.CurrentAwsCatalogDigest,
	}
	document["nodes"] = []any{map[string]any{
		"id": "table_cli_fixture",
		"semantic": map[string]any{
			"deploymentKey": "cli_table",
			"serviceType":   "aws.dynamodb.table",
			"resourceType":  "aws.dynamodb.table",
			"configuration": map[string]any{
				"schemaId":      "aws.dynamodb.table.configuration",
				"schemaVersion": "1.0.0",
				"values": map[string]any{
					"billingMode":                 map[string]any{"kind": "string", "value": "PAY_PER_REQUEST"},
					"deletionProtectionEnabled":   map[string]any{"kind": "boolean", "value": true},
					"partitionKeyName":            map[string]any{"kind": "string", "value": "id"},
					"partitionKeyType":            map[string]any{"kind": "string", "value": "S"},
					"pointInTimeRecoveryEnabled":  map[string]any{"kind": "boolean", "value": true},
					"serverSideEncryptionEnabled": map[string]any{"kind": "boolean", "value": true},
					"tableName":                   map[string]any{"kind": "string", "value": "cloudmarkup-cli-fixture"},
				},
			},
			"lifecycle": map[string]any{"ownership": "user", "origin": "user"},
		},
		"presentation": map[string]any{
			"label":    "CLI fixture table",
			"position": map[string]any{"x": 0, "y": 0},
		},
	}}
	document["edges"] = []any{}
	document["variables"] = []any{}
	document["outputs"] = []any{}
	document["unresolvedRequirements"] = []any{}
	workloadBehavior := document["workloadBehavior"].(map[string]any)
	workloadBehavior["workloads"] = []any{}
	encoded, err := json.Marshal(document)
	if err != nil {
		t.Fatalf("encode CloudFormation CLI fixture: %v", err)
	}
	return encoded
}

func cloudFormationEventCLIFixture(t *testing.T) []byte {
	t.Helper()
	_, thisFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller did not return the CLI test path")
	}
	path := filepath.Join(
		filepath.Dir(thisFile),
		"..", "..", "..", "..",
		"packages", "architecture-cli", "src", "fixtures", "aws-eventing",
		"compiler-v1", "sqs-consumer-dlq", "source.json",
	)
	contents, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read curated event fixture: %v", err)
	}
	var source struct {
		ArchitectureDocument map[string]any `json:"architectureDocument"`
	}
	if err := json.Unmarshal(contents, &source); err != nil {
		t.Fatalf("decode curated event fixture: %v", err)
	}
	source.ArchitectureDocument["catalog"] = map[string]any{
		"id":      compiler.CloudFormationCatalogID,
		"version": compiler.CurrentAwsCatalogVersion,
		"digest":  compiler.CurrentAwsCatalogDigest,
	}
	for _, rawNode := range source.ArchitectureDocument["nodes"].([]any) {
		node := rawNode.(map[string]any)
		semantic := node["semantic"].(map[string]any)
		if semantic["serviceType"] == "aws.iam.policy-statement" {
			configuration := semantic["configuration"].(map[string]any)
			configuration["schemaVersion"] = "2.0.0"
		}
	}
	encoded, err := json.Marshal(source.ArchitectureDocument)
	if err != nil {
		t.Fatalf("encode curated event fixture: %v", err)
	}
	return encoded
}
