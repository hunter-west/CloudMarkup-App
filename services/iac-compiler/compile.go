package compiler

import (
	"context"
	"encoding/json"
	"sort"
)

func Compile(ctx context.Context, request CompileRequest) CompilationResult {
	request.Request.Limits = normalizeLimits(request.Request.Limits)
	if request.Request.Target == "" {
		request.Request.Target = TargetTerraform
	}
	normalized := Normalize(ctx, request.Request)
	result := CompilationResult{
		ContractVersion: TargetArtifactContractVersion,
		Compiler:        normalized.Compiler,
		Model:           normalized.Model,
		Diagnostics:     append([]Diagnostic(nil), normalized.Diagnostics...),
	}
	if !normalized.Succeeded() || normalized.Model == nil {
		return sortCompilationDiagnostics(result)
	}
	target, ok := targetFor(request.Request.Target)
	if !ok {
		return sortCompilationDiagnostics(result)
	}
	artifact, diagnostics := target.Render(ctx, normalized.Model, request.TargetExtensions, request.Request.Limits)
	result.Diagnostics = append(result.Diagnostics, diagnostics...)
	if hasErrorDiagnostics(result.Diagnostics) {
		result.Model.Target = TargetReadiness{
			Target: request.Request.Target, ContractVersion: target.Descriptor().ContractVersion,
			State: "unsupported", RenderingAvailable: false, Reasons: diagnosticCodes(result.Diagnostics),
		}
		return sortCompilationDiagnostics(result)
	}
	if artifact == nil {
		result.Diagnostics = append(result.Diagnostics, Diagnostic{
			Code: "TARGET_RENDER_FAILED", Severity: SeverityError,
			Message: "Target rendering did not produce an artifact.", Source: SourceReference{Document: DocumentArchitecture},
		})
		return sortCompilationDiagnostics(result)
	}
	encoded, err := json.Marshal(artifact)
	if err != nil || len(encoded) > request.Request.Limits.MaxArtifactBytes {
		result.Diagnostics = append(result.Diagnostics, Diagnostic{
			Code: "LIMIT_TARGET_ARTIFACT_EXCEEDED", Severity: SeverityError,
			Message: "Generated target artifact exceeds the configured output limit.", Source: SourceReference{Document: DocumentArchitecture},
		})
		return sortCompilationDiagnostics(result)
	}
	result.Artifact = artifact
	result.Model.Target = target.Assess(ctx, result.Model)
	return sortCompilationDiagnostics(result)
}

func sortCompilationDiagnostics(result CompilationResult) CompilationResult {
	sort.SliceStable(result.Diagnostics, func(left int, right int) bool {
		return compareUTF16(diagnosticKey(result.Diagnostics[left]), diagnosticKey(result.Diagnostics[right])) < 0
	})
	return result
}

func hasErrorDiagnostics(diagnostics []Diagnostic) bool {
	for _, diagnostic := range diagnostics {
		if diagnostic.Severity == SeverityError {
			return true
		}
	}
	return false
}

func diagnosticCodes(diagnostics []Diagnostic) []string {
	seen := make(map[string]struct{})
	result := make([]string, 0)
	for _, diagnostic := range diagnostics {
		if diagnostic.Severity != SeverityError {
			continue
		}
		if _, exists := seen[diagnostic.Code]; exists {
			continue
		}
		seen[diagnostic.Code] = struct{}{}
		result = append(result, diagnostic.Code)
	}
	sort.Slice(result, func(left int, right int) bool { return compareUTF16(result[left], result[right]) < 0 })
	return result
}
func CompileReaders(ctx context.Context, request CompileReaderRequest) CompilationResult {
	limits := normalizeLimits(request.Request.Limits)
	collector := newDiagnosticCollector(limits.MaxDiagnostics)
	architecture, ok := readBounded(request.Request.Architecture, limits.MaxArchitectureBytes, DocumentArchitecture, collector)
	if !ok {
		return failedCompilation(collector.diagnostics())
	}
	workload, ok := readOptionalBounded(request.Request.Workload, limits.MaxWorkloadBytes, DocumentWorkload, collector)
	if !ok {
		return failedCompilation(collector.diagnostics())
	}
	solution, ok := readOptionalBounded(request.Request.SolutionRevision, limits.MaxSolutionBytes, DocumentSolutionRevision, collector)
	if !ok {
		return failedCompilation(collector.diagnostics())
	}
	return Compile(ctx, CompileRequest{
		Request: Request{
			Architecture: architecture, Workload: workload, SolutionRevision: solution,
			Target: request.Request.Target, Compatibility: request.Request.Compatibility, Limits: limits,
		},
		TargetExtensions: request.TargetExtensions,
	})
}

func failedCompilation(diagnostics []Diagnostic) CompilationResult {
	return sortCompilationDiagnostics(CompilationResult{
		ContractVersion: TargetArtifactContractVersion,
		Compiler:        ToolReference{ID: CompilerID, Version: CompilerVersion, Digest: CompilerDigest},
		Diagnostics:     diagnostics,
	})
}
