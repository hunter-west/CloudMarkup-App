package compiler

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"
)

const (
	prompt30MaximumRepositoryPathLength = 180
	prompt30MaximumFilenameLength       = 96
)

var (
	prompt30FullDigestFilenamePattern = regexp.MustCompile(`(?i)[a-f0-9]{64}`)
	prompt30WindowsReservedName       = regexp.MustCompile(`(?i)^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$`)
)

type prompt30PlannedGoldenFile struct {
	content string
	target  string
}

func prompt30PathEscapesRoot(relative string) bool {
	return filepath.IsAbs(relative) || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator))
}

func prompt30InvalidWindowsComponent(component string) bool {
	if component == "" || component == "." || component == ".." || strings.HasSuffix(component, ".") || strings.HasSuffix(component, " ") || strings.ContainsAny(component, `<>:"|?*`) || prompt30WindowsReservedName.MatchString(component) {
		return true
	}
	for index := 0; index < len(component); index++ {
		if component[index] < 0x20 || component[index] > 0x7e {
			return true
		}
	}
	return false
}

func prompt30PlanGoldenTree(root string, actual map[string]string) ([]prompt30PlannedGoldenFile, error) {
	resolvedRoot, err := filepath.Abs(root)
	if err != nil {
		return nil, fmt.Errorf("resolve golden root: %w", err)
	}
	resolvedGoldenRoot, err := filepath.Abs(prompt30GoldenRoot)
	if err != nil {
		return nil, fmt.Errorf("resolve generation golden root: %w", err)
	}
	rootRelativeToGoldens, err := filepath.Rel(resolvedGoldenRoot, resolvedRoot)
	if err != nil {
		return nil, fmt.Errorf("relativize golden root: %w", err)
	}
	enforceRepositoryBudget := !prompt30PathEscapesRoot(rootRelativeToGoldens)
	resolvedRepositoryRoot, err := filepath.Abs(filepath.Join(prompt30GoldenRoot, "..", "..", ".."))
	if err != nil {
		return nil, fmt.Errorf("resolve repository root: %w", err)
	}

	keys := make([]string, 0, len(actual))
	for relative := range actual {
		keys = append(keys, relative)
	}
	sort.Strings(keys)

	portableOwners := map[string]string{}
	plan := make([]prompt30PlannedGoldenFile, 0, len(keys))
	for _, relative := range keys {
		components := strings.Split(relative, "/")
		if relative == "" || strings.Contains(relative, `\`) || strings.HasPrefix(relative, "/") || filepath.IsAbs(relative) {
			return nil, fmt.Errorf("unsafe Prompt 30 golden path %q", relative)
		}
		for _, component := range components {
			if prompt30InvalidWindowsComponent(component) {
				return nil, fmt.Errorf("nonportable Prompt 30 golden path %q", relative)
			}
		}
		filename := components[len(components)-1]
		if len(filename) > prompt30MaximumFilenameLength {
			return nil, fmt.Errorf("Prompt 30 golden filename exceeds its safe boundary (%d/%d): %s", len(filename), prompt30MaximumFilenameLength, relative)
		}
		if prompt30FullDigestFilenamePattern.MatchString(filename) {
			return nil, fmt.Errorf("Prompt 30 golden filename contains a full SHA-256 digest: %s", relative)
		}
		portable := strings.ToLower(relative)
		if existing, ok := portableOwners[portable]; ok {
			return nil, fmt.Errorf("duplicate Windows Prompt 30 golden path: %s and %s", existing, relative)
		}
		portableOwners[portable] = relative

		targetElements := append([]string{resolvedRoot}, components...)
		target := filepath.Join(targetElements...)
		targetRelativeToRoot, err := filepath.Rel(resolvedRoot, target)
		if err != nil || targetRelativeToRoot == "." || prompt30PathEscapesRoot(targetRelativeToRoot) {
			return nil, fmt.Errorf("Prompt 30 golden path escapes its root: %s", relative)
		}
		if enforceRepositoryBudget {
			repositoryRelative, err := filepath.Rel(resolvedRepositoryRoot, target)
			if err != nil || prompt30PathEscapesRoot(repositoryRelative) {
				return nil, fmt.Errorf("Prompt 30 golden path escapes the repository: %s", relative)
			}
			repositoryRelative = filepath.ToSlash(repositoryRelative)
			if len(repositoryRelative) > prompt30MaximumRepositoryPathLength {
				return nil, fmt.Errorf("Prompt 30 repository golden path exceeds its safe boundary (%d/%d): %s", len(repositoryRelative), prompt30MaximumRepositoryPathLength, repositoryRelative)
			}
		}
		plan = append(plan, prompt30PlannedGoldenFile{content: actual[relative], target: target})
	}
	return plan, nil
}

func prompt30ValidateExistingGoldenTree(root string) error {
	info, err := os.Lstat(root)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("inspect old golden tree: %w", err)
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("old golden root must be a regular directory: %s", root)
	}
	return filepath.WalkDir(root, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.Type()&os.ModeSymlink != 0 {
			return fmt.Errorf("old golden tree contains a symbolic link: %s", path)
		}
		if entry.IsDir() {
			return nil
		}
		entryInfo, err := entry.Info()
		if err != nil {
			return err
		}
		if !entryInfo.Mode().IsRegular() {
			return fmt.Errorf("old golden tree contains a non-regular file: %s", path)
		}
		return nil
	})
}

func prompt30ReplaceGoldenTree(root string, actual map[string]string) error {
	plan, err := prompt30PlanGoldenTree(root, actual)
	if err != nil {
		return err
	}
	if err := prompt30ValidateExistingGoldenTree(root); err != nil {
		return err
	}
	if err := os.RemoveAll(root); err != nil {
		return fmt.Errorf("remove old golden tree: %w", err)
	}
	for _, file := range plan {
		if err := os.MkdirAll(filepath.Dir(file.target), 0o755); err != nil {
			return fmt.Errorf("create golden directory: %w", err)
		}
		if err := os.WriteFile(file.target, []byte(file.content), 0o644); err != nil {
			return fmt.Errorf("write golden file: %w", err)
		}
	}
	return nil
}

func TestGenerationGoldenReplacementRejectsUnsafePathsBeforeDelete(t *testing.T) {
	fullDigest := strings.Repeat("a", 64)
	cases := []struct {
		name string
		tree map[string]string
	}{
		{name: "traversal", tree: map[string]string{"infrastructure/../../escape.tf": "unsafe"}},
		{name: "absolute", tree: map[string]string{"C:/escape.tf": "unsafe"}},
		{name: "backslash", tree: map[string]string{`infrastructure\escape.tf`: "unsafe"}},
		{name: "empty component", tree: map[string]string{"infrastructure//escape.tf": "unsafe"}},
		{name: "reserved device", tree: map[string]string{"infrastructure/con.tf": "unsafe"}},
		{name: "alternate data stream", tree: map[string]string{"infrastructure/file.tf:stream": "unsafe"}},
		{name: "trailing dot", tree: map[string]string{"infrastructure./file.tf": "unsafe"}},
		{name: "control character", tree: map[string]string{"infrastructure/bad\x01.tf": "unsafe"}},
		{name: "non ASCII normalization ambiguity", tree: map[string]string{"infrastructure/café.tf": "unsafe"}},
		{name: "filename budget", tree: map[string]string{"infrastructure/" + strings.Repeat("a", 94) + ".tf": "unsafe"}},
		{name: "full digest filename", tree: map[string]string{"infrastructure/" + fullDigest + ".tf": "unsafe"}},
		{name: "portable collision", tree: map[string]string{"infrastructure/Thing.tf": "one", "infrastructure/thing.tf": "two"}},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			root := filepath.Join(t.TempDir(), "reviewed")
			if err := os.MkdirAll(root, 0o755); err != nil {
				t.Fatal(err)
			}
			sentinel := filepath.Join(root, "sentinel.txt")
			if err := os.WriteFile(sentinel, []byte("reviewed"), 0o600); err != nil {
				t.Fatal(err)
			}
			if err := prompt30ReplaceGoldenTree(root, test.tree); err == nil {
				t.Fatal("unsafe prospective golden tree was accepted")
			}
			content, err := os.ReadFile(sentinel)
			if err != nil {
				t.Fatalf("reviewed tree was deleted before validation: %v", err)
			}
			if string(content) != "reviewed" {
				t.Fatalf("reviewed sentinel changed to %q", string(content))
			}
		})
	}
}

func TestGenerationGoldenPlanEnforcesRepositoryPathBudget(t *testing.T) {
	root := filepath.Join(prompt30GoldenRoot, "multiple-downstream-dependencies", "iac")
	longRelative := "infrastructure/" + strings.Repeat("a", 80) + "/" + strings.Repeat("z", 80) + ".tf"
	if _, err := prompt30PlanGoldenTree(root, map[string]string{longRelative: "unsafe"}); err == nil || !strings.Contains(err.Error(), "180") {
		t.Fatalf("repository path budget error = %v", err)
	}
}
