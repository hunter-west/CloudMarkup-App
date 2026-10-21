package compiler

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"testing"
)

func TestCompilerDigestCommitsExactDescriptor(t *testing.T) {
	t.Parallel()

	descriptor := struct {
		ID      string `json:"id"`
		Version string `json:"version"`
	}{ID: CompilerID, Version: CompilerVersion}
	encoded, err := json.Marshal(descriptor)
	if err != nil {
		t.Fatalf("marshal compiler descriptor: %v", err)
	}
	digest := sha256.Sum256(encoded)
	got := "sha256:" + hex.EncodeToString(digest[:])
	if got != CompilerDigest {
		t.Fatalf("compiler descriptor digest = %q, want %q", got, CompilerDigest)
	}

	result := baseResult(nil)
	if result.Compiler.Digest != CompilerDigest {
		t.Fatalf("normalized compiler digest = %q, want %q", result.Compiler.Digest, CompilerDigest)
	}
	failed := failedCompilation(nil)
	if failed.Compiler.Digest != CompilerDigest {
		t.Fatalf("failed compilation compiler digest = %q, want %q", failed.Compiler.Digest, CompilerDigest)
	}
}

// A corrected renderer is a new compiler release, never an implicit upgrade of
// a customer's immutable Solution Revision selected under the deployed release.
func TestCompilerPatchRejectsPredecessorSolutionPin(t *testing.T) {
	t.Parallel()
	architecture := representativeDocument(t)
	manifest := validSolutionManifest(t, architecture, nil)
	current := Normalize(context.Background(), Request{Architecture: architecture, SolutionRevision: manifest})
	if !current.Succeeded() {
		t.Fatalf("current compiler pin failed: %#v", current.Diagnostics)
	}
	for _, pin := range []struct{ version, digest string }{
		{"1.1.0", "sha256:13a76e103fed8783d043a0a308b579424d52c7170a7ecf646b8cf232f1b47e34"},
		{"1.2.0", "sha256:2b163b038f051040098b0f98122fc070907d6fb13b279249ea13734ced3fa279"},
	} {
		t.Run(pin.version, func(t *testing.T) {
			predecessor := decodeMap(t, manifest)
			tool := objectAt(t, objectAt(t, objectAt(t, predecessor, "versions"), "compiler"), "tool")
			tool["version"], tool["digest"] = pin.version, pin.digest
			rejected := Compile(context.Background(), CompileRequest{Request: Request{Architecture: architecture, SolutionRevision: encodeMap(t, predecessor)}})
			if !hasDiagnostic(rejected.Diagnostics, "COMPAT_SOLUTION_COMPILER_MISMATCH") {
				t.Fatal("predecessor compiler pin was not rejected")
			}
			if rejected.Succeeded() || rejected.Artifact != nil {
				t.Fatal("predecessor pin was silently rebound")
			}
		})
	}
}
