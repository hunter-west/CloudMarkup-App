package compiler

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestInspectTerraformHCLIsDeterministicAndValueFree(t *testing.T) {
	source := []byte(`resource "aws_dynamodb_table" "notes" {
  name = "do-not-return-this-value"
  billing_mode = var.billing_mode
  tags = { Environment = local.environment }
}`)
	first := InspectTerraformHCL(source, "main.tf")
	second := InspectTerraformHCL(source, "main.tf")
	left, _ := json.Marshal(first)
	right, _ := json.Marshal(second)
	if string(left) != string(right) {
		t.Fatal("inspection is not deterministic")
	}
	if !first.Succeeded || len(first.Blocks) != 1 {
		t.Fatalf("unexpected result: %#v", first)
	}
	serialized := string(left)
	if strings.Contains(serialized, "do-not-return-this-value") {
		t.Fatal("literal value leaked")
	}
	if !strings.Contains(serialized, "var.billing_mode") || !strings.Contains(serialized, "local.environment") {
		t.Fatal("safe references missing")
	}
}

func TestInspectTerraformHCLReportsUnresolvedSyntaxWithoutSource(t *testing.T) {
	result := InspectTerraformHCL([]byte(`resource "aws_s3_bucket" "bad" { value = }`), "main.tf")
	if result.Succeeded || len(result.Diagnostics) == 0 {
		t.Fatal("expected parse failure")
	}
	encoded, _ := json.Marshal(result.Diagnostics)
	if strings.Contains(string(encoded), "value =") {
		t.Fatal("source leaked in diagnostic")
	}
}
