package compiler

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"sort"
	"strings"
	"testing"

	"github.com/hashicorp/hcl/v2"
	"github.com/hashicorp/hcl/v2/hclsyntax"
)

type prompt30FileManifest struct {
	Path      string `json:"path"`
	MediaType string `json:"mediaType"`
	Ownership string `json:"ownership"`
	Digest    string `json:"digest"`
	SizeBytes int    `json:"sizeBytes"`
}

type prompt30ArtifactManifest struct {
	ContractVersion      int                           `json:"contractVersion"`
	Compiler             ToolReference                 `json:"compiler"`
	Target               TargetKind                    `json:"target"`
	FormatVersion        string                        `json:"formatVersion"`
	Provenance           SolutionProvenance            `json:"provenance"`
	Metadata             TerraformCompilerMetadata     `json:"metadata"`
	Files                []prompt30FileManifest        `json:"files"`
	ApplicationArtifacts []ApplicationArtifactContract `json:"applicationArtifacts"`
	PolicyArtifacts      []PolicyArtifactContract      `json:"policyArtifacts"`
	Digest               string                        `json:"digest"`
}

func prompt30AssertArtifact(t *testing.T, fixture prompt30Fixture, artifact *TargetArtifact) {
	t.Helper()
	if artifact.Target != TargetTerraform || artifact.FormatVersion != TerraformFormatVersion {
		t.Fatalf("artifact target metadata = %#v", artifact)
	}
	if artifact.Provenance.SolutionRevisionID == "" || artifact.Provenance.Catalog.ID != TerraformCatalogID {
		t.Fatalf("artifact provenance is not revision/catalog bound = %#v", artifact.Provenance)
	}
	for _, file := range artifact.Files {
		if !strings.HasPrefix(file.Path, "infrastructure/") {
			t.Errorf("Terraform emitted non-infrastructure path %q", file.Path)
		}
		if strings.HasSuffix(file.Path, ".tf") {
			_, diagnostics := hclsyntax.ParseConfig([]byte(file.Content), file.Path, hcl.Pos{Line: 1, Column: 1})
			if diagnostics.HasErrors() {
				t.Errorf("generated HCL %s does not parse: %s", file.Path, diagnostics.Error())
			}
		}
	}
	for path, fragments := range fixture.mustContain {
		content := fileContent(t, artifact, path)
		for _, fragment := range fragments {
			if !strings.Contains(content, fragment) {
				t.Errorf("%s is missing semantic fragment %q", path, fragment)
			}
		}
	}
	for path, fragments := range fixture.mustNotContain {
		content := fileContent(t, artifact, path)
		for _, fragment := range fragments {
			if strings.Contains(content, fragment) {
				t.Errorf("%s contains forbidden semantic fragment %q", path, fragment)
			}
		}
	}
	all := artifactText(artifact)
	for _, action := range fixture.expectedActions {
		if !strings.Contains(all, action) {
			t.Errorf("artifact is missing expected IAM action %q", action)
		}
	}
	prompt30AssertNoForbiddenTerraform(t, artifact)
	if fixture.id == "generated-plus-custom-policies" || fixture.id == "complete-supported-notes-api" {
		ownership := map[string]string{}
		for _, policy := range artifact.PolicyArtifacts {
			ownership[policy.PolicyDocumentID] = policy.Ownership
		}
		if ownership["generated_read_policy"] != "generated" || ownership["custom_policy"] != "user" {
			t.Errorf("generated/custom policy provenance collapsed: %#v", artifact.PolicyArtifacts)
		}
	}
}

func prompt30AssertNoForbiddenTerraform(t *testing.T, artifact *TargetArtifact) {
	t.Helper()
	text := artifactText(artifact)
	for _, forbidden := range []string{
		"local-exec", "remote-exec", "provisioner", `module "`, "C:\\", "file://", "secret_fixture_marker_never_embed",
	} {
		if strings.Contains(text, forbidden) {
			t.Errorf("Terraform artifact contains forbidden construct %q", forbidden)
		}
	}
	if strings.Contains(text, `actions = ["*"]`) || strings.Contains(text, `resources = ["*"]`) {
		t.Error("Terraform artifact contains a broad IAM wildcard")
	}
}

func prompt30IACTree(artifact *TargetArtifact, fixtureID string) map[string]string {
	tree := map[string]string{"semantic-summary.md": prompt30TerraformSemanticSummary(artifact, fixtureID)}
	for _, file := range artifact.Files {
		if strings.HasSuffix(file.Path, ".tf") || file.Path == "infrastructure/README.md" {
			tree[filepath.ToSlash(file.Path)] = file.Content
		}
	}
	return tree
}

func prompt30TerraformManifestTree(t *testing.T, artifact *TargetArtifact, fixtureID string) map[string]string {
	t.Helper()
	files := make([]prompt30FileManifest, 0, len(artifact.Files))
	for _, file := range artifact.Files {
		files = append(files, prompt30FileManifest{
			Path: file.Path, MediaType: file.MediaType, Ownership: file.Ownership, Digest: file.Digest, SizeBytes: len([]byte(file.Content)),
		})
	}
	projection := prompt30ArtifactManifest{
		ContractVersion:      artifact.ContractVersion,
		Compiler:             ToolReference{ID: CompilerID, Version: CompilerVersion},
		Target:               artifact.Target,
		FormatVersion:        artifact.FormatVersion,
		Provenance:           artifact.Provenance,
		Metadata:             artifact.Metadata,
		Files:                files,
		ApplicationArtifacts: artifact.ApplicationArtifacts,
		PolicyArtifacts:      artifact.PolicyArtifacts,
		Digest:               artifact.Digest,
	}
	encoded, err := json.MarshalIndent(projection, "", "  ")
	if err != nil {
		t.Fatalf("marshal Terraform manifest golden: %v", err)
	}
	return map[string]string{
		"artifact.json":       string(encoded) + "\n",
		"semantic-summary.md": prompt30TerraformSemanticSummary(artifact, fixtureID),
	}
}

var prompt30ResourcePattern = regexp.MustCompile(`(?m)^resource "([^"]+)" "([^"]+)"`)

func prompt30TerraformSemanticSummary(artifact *TargetArtifact, fixtureID string) string {
	resources := []string{}
	for _, file := range artifact.Files {
		for _, match := range prompt30ResourcePattern.FindAllStringSubmatch(file.Content, -1) {
			resources = append(resources, match[1]+"."+match[2])
		}
	}
	sort.Strings(resources)
	lines := []string{
		"# Terraform semantic summary: " + fixtureID,
		"",
		"- Artifact digest: `" + artifact.Digest + "`",
		fmt.Sprintf("- Generated files: %d", len(artifact.Files)),
		fmt.Sprintf("- Resources: %d", len(resources)),
		fmt.Sprintf("- Application artifact contracts: %d", len(artifact.ApplicationArtifacts)),
		fmt.Sprintf("- Policy artifacts: %d", len(artifact.PolicyArtifacts)),
		"",
		"## Resources",
		"",
	}
	for _, resource := range resources {
		lines = append(lines, "- `"+resource+"`")
	}
	lines = append(lines, "", "## Policy provenance", "")
	for _, policy := range artifact.PolicyArtifacts {
		edges := []string{}
		if policy.Provenance != nil {
			edges = policy.Provenance.DependentEdgeIDs
		}
		lines = append(lines, fmt.Sprintf("- `%s`: `%s/%s`; edges `%s`", policy.PolicyDocumentID, policy.Ownership, policy.PolicyKind, strings.Join(edges, ",")))
	}
	lines = append(lines, "")
	return strings.Join(lines, "\n")
}

func prompt30GoldenUpdate(t *testing.T) (string, bool) {
	t.Helper()
	category := os.Getenv("CLOUDMARKUP_GENERATION_GOLDEN_CATEGORY")
	if category == "" {
		return "", false
	}
	if category != "iac" && category != "manifests" {
		return "", false
	}
	if os.Getenv("CLOUDMARKUP_GENERATION_GOLDEN_CONFIRM") != prompt30GoldenConfirm {
		t.Fatal("golden update requires the exact confirmation token")
	}
	if strings.TrimSpace(os.Getenv("CLOUDMARKUP_GENERATION_GOLDEN_SUMMARY")) == "" {
		t.Fatal("golden update requires a nonempty reviewer summary")
	}
	return category, true
}

func prompt30CompareOrUpdateTree(t *testing.T, fixtureID, category string, actual map[string]string, update bool) {
	t.Helper()
	root := filepath.Clean(filepath.Join(prompt30GoldenRoot, fixtureID, category))
	allowedRoot := filepath.Clean(prompt30GoldenRoot) + string(filepath.Separator)
	if !strings.HasPrefix(root+string(filepath.Separator), allowedRoot) || strings.ContainsAny(fixtureID, `/\`) {
		t.Fatalf("unsafe golden root %q", root)
	}
	if update {
		if err := prompt30ReplaceGoldenTree(root, actual); err != nil {
			t.Fatalf("replace golden tree: %v", err)
		}
	}
	expected := prompt30ReadTree(t, root)
	if !reflect.DeepEqual(actual, expected) {
		t.Fatalf("%s/%s golden tree differs\nactual files: %#v\nexpected files: %#v", fixtureID, category, sortedPrompt30Keys(actual), sortedPrompt30Keys(expected))
	}
}

func prompt30ReadTree(t *testing.T, root string) map[string]string {
	t.Helper()
	result := map[string]string{}
	err := filepath.WalkDir(root, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			return nil
		}
		content, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		relative, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		result[filepath.ToSlash(relative)] = string(content)
		return nil
	})
	if err != nil {
		t.Fatalf("read golden tree %s: %v", root, err)
	}
	return result
}

func prompt30AssertCleanDirectoryReproducibility(t *testing.T, tree map[string]string) {
	t.Helper()
	left := t.TempDir()
	right := t.TempDir()
	for _, root := range []string{left, right} {
		for relative, content := range tree {
			path := filepath.Join(root, filepath.FromSlash(relative))
			if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
				t.Fatal(err)
			}
		}
	}
	if !reflect.DeepEqual(prompt30ReadTree(t, left), prompt30ReadTree(t, right)) {
		t.Fatal("materializing in clean temporary directories changed output bytes")
	}
}

func readPrompt30Inventory(t *testing.T) prompt30Inventory {
	t.Helper()
	content, err := os.ReadFile("../../testdata/generation-goldens-v1/fixture-inventory.json")
	if err != nil {
		t.Fatalf("read Prompt 30 fixture inventory: %v", err)
	}
	var inventory prompt30Inventory
	if err := json.Unmarshal(content, &inventory); err != nil {
		t.Fatalf("decode Prompt 30 fixture inventory: %v", err)
	}
	return inventory
}

func filepathJoin(elements ...string) string {
	return filepath.Join(elements...)
}
