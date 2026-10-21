package compiler

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"

	"cloudmarkup.com/iac-compiler/internal/contracts"
	"cloudmarkup.com/iac-compiler/internal/jsonschema"
)

type decodedRequest struct {
	architectureRaw map[string]any
	architecture    architectureWire
	workloadRaw     map[string]any
	workload        workloadBehaviorWire
	solutionRaw     map[string]any
	solution        *solutionRevisionWire
}

type diagnosticCollector struct {
	items     []Diagnostic
	limit     int
	truncated bool
}

func newDiagnosticCollector(limit int) *diagnosticCollector {
	return &diagnosticCollector{items: make([]Diagnostic, 0), limit: limit}
}

func (collector *diagnosticCollector) add(diagnostic Diagnostic) {
	if len(collector.items) >= collector.limit {
		collector.truncated = true
		return
	}
	collector.items = append(collector.items, diagnostic)
}

func (collector *diagnosticCollector) addError(code string, message string, source SourceReference) {
	collector.add(Diagnostic{Code: code, Severity: SeverityError, Message: message, Source: source})
}

func (collector *diagnosticCollector) hasErrors() bool {
	for _, diagnostic := range collector.items {
		if diagnostic.Severity == SeverityError {
			return true
		}
	}
	return collector.truncated
}

func (collector *diagnosticCollector) diagnostics() []Diagnostic {
	items := append([]Diagnostic(nil), collector.items...)
	if collector.truncated {
		limitDiagnostic := Diagnostic{
			Code:     "LIMIT_DIAGNOSTICS_EXCEEDED",
			Severity: SeverityError,
			Message:  "Compiler diagnostics exceeded the configured bound.",
			Source:   SourceReference{Document: DocumentArchitecture},
		}
		if len(items) >= collector.limit {
			items[collector.limit-1] = limitDiagnostic
		} else {
			items = append(items, limitDiagnostic)
		}
	}
	return items
}

func normalizeLimits(limits Limits) Limits {
	defaults := DefaultLimits()
	if limits.MaxArchitectureBytes <= 0 {
		limits.MaxArchitectureBytes = defaults.MaxArchitectureBytes
	}
	if limits.MaxWorkloadBytes <= 0 {
		limits.MaxWorkloadBytes = defaults.MaxWorkloadBytes
	}
	if limits.MaxSolutionBytes <= 0 {
		limits.MaxSolutionBytes = defaults.MaxSolutionBytes
	}
	if limits.MaxJSONDepth <= 0 {
		limits.MaxJSONDepth = defaults.MaxJSONDepth
	}
	if limits.MaxNodes <= 0 {
		limits.MaxNodes = defaults.MaxNodes
	}
	if limits.MaxEdges <= 0 {
		limits.MaxEdges = defaults.MaxEdges
	}
	if limits.MaxWorkloads <= 0 {
		limits.MaxWorkloads = defaults.MaxWorkloads
	}
	if limits.MaxOperations <= 0 {
		limits.MaxOperations = defaults.MaxOperations
	}
	if limits.MaxDiagnostics <= 0 {
		limits.MaxDiagnostics = defaults.MaxDiagnostics
	}
	if limits.MaxNormalizedBytes <= 0 {
		limits.MaxNormalizedBytes = defaults.MaxNormalizedBytes
	}
	if limits.MaxArtifactBytes <= 0 {
		limits.MaxArtifactBytes = defaults.MaxArtifactBytes
	}
	if limits.MaxArtifactFiles <= 0 {
		limits.MaxArtifactFiles = defaults.MaxArtifactFiles
	}
	return limits
}

func NormalizeReaders(ctx context.Context, request ReaderRequest) Result {
	limits := normalizeLimits(request.Limits)
	collector := newDiagnosticCollector(limits.MaxDiagnostics)
	architecture, ok := readBounded(request.Architecture, limits.MaxArchitectureBytes, DocumentArchitecture, collector)
	if !ok {
		return baseResult(collector.diagnostics())
	}
	workload, ok := readOptionalBounded(request.Workload, limits.MaxWorkloadBytes, DocumentWorkload, collector)
	if !ok {
		return baseResult(collector.diagnostics())
	}
	solution, ok := readOptionalBounded(request.SolutionRevision, limits.MaxSolutionBytes, DocumentSolutionRevision, collector)
	if !ok {
		return baseResult(collector.diagnostics())
	}
	return Normalize(ctx, Request{
		Architecture:     architecture,
		Workload:         workload,
		SolutionRevision: solution,
		Target:           request.Target,
		Compatibility:    request.Compatibility,
		Limits:           limits,
	})
}

func readBounded(reader io.Reader, maximum int64, document DocumentKind, collector *diagnosticCollector) ([]byte, bool) {
	if reader == nil {
		collector.addError("INPUT_REQUIRED", "The Architecture Document input is required.", SourceReference{Document: document})
		return nil, false
	}
	contents, err := io.ReadAll(io.LimitReader(reader, maximum+1))
	if err != nil {
		collector.addError("INPUT_READ_FAILED", "Compiler input could not be read.", SourceReference{Document: document})
		return nil, false
	}
	if int64(len(contents)) > maximum {
		collector.addError("LIMIT_INPUT_BYTES_EXCEEDED", "Compiler input exceeds the configured byte limit.", SourceReference{Document: document})
		return nil, false
	}
	return contents, true
}

func readOptionalBounded(reader io.Reader, maximum int64, document DocumentKind, collector *diagnosticCollector) ([]byte, bool) {
	if reader == nil {
		return nil, true
	}
	return readBounded(reader, maximum, document, collector)
}

func decodeRequest(ctx context.Context, request Request, collector *diagnosticCollector) (*decodedRequest, bool) {
	limits := request.Limits
	architectureRaw, ok := decodeDocument(ctx, request.Architecture, DocumentArchitecture, contracts.ArchitectureDocumentV3, "cloudmarkup.architecture-document", "schemaVersion", 3, limits, collector)
	if !ok {
		return nil, false
	}
	var architecture architectureWire
	if err := json.Unmarshal(request.Architecture, &architecture); err != nil {
		collector.addError("STRUCTURE_ARCHITECTURE_INVALID", "Architecture Document could not be decoded after structural validation.", SourceReference{Document: DocumentArchitecture})
		return nil, false
	}

	workloadRaw, _ := architectureRaw["workloadBehavior"].(map[string]any)
	workload := architecture.WorkloadBehavior
	if len(request.Workload) > 0 {
		standaloneRaw, standaloneOK := decodeDocument(ctx, request.Workload, DocumentWorkload, contracts.WorkloadBehaviorV2, "", "contractVersion", 2, limits, collector)
		if !standaloneOK {
			return nil, false
		}
		var standalone workloadBehaviorWire
		if err := json.Unmarshal(request.Workload, &standalone); err != nil {
			collector.addError("STRUCTURE_WORKLOAD_INVALID", "Workload Document could not be decoded after structural validation.", SourceReference{Document: DocumentWorkload})
			return nil, false
		}
		workloadRaw = standaloneRaw
		workload = standalone
	}

	decoded := &decodedRequest{architectureRaw: architectureRaw, architecture: architecture, workloadRaw: workloadRaw, workload: workload}
	if len(request.SolutionRevision) == 0 {
		return decoded, true
	}
	solutionRaw, solutionOK := decodeDocument(ctx, request.SolutionRevision, DocumentSolutionRevision, contracts.SolutionRevisionV1, "cloudmarkup.solution-revision-manifest", "contractVersion", 1, limits, collector)
	if !solutionOK {
		return nil, false
	}
	var solution solutionRevisionWire
	if err := json.Unmarshal(request.SolutionRevision, &solution); err != nil {
		collector.addError("STRUCTURE_SOLUTION_REVISION_INVALID", "Solution Revision could not be decoded after structural validation.", SourceReference{Document: DocumentSolutionRevision})
		return nil, false
	}
	decoded.solutionRaw = solutionRaw
	decoded.solution = &solution
	return decoded, true
}

func decodeDocument(ctx context.Context, contents []byte, document DocumentKind, contractKind contracts.Kind, expectedKind string, versionField string, expectedVersion int, limits Limits, collector *diagnosticCollector) (map[string]any, bool) {
	if len(contents) == 0 {
		collector.addError("INPUT_REQUIRED", "Compiler input is required.", SourceReference{Document: document})
		return nil, false
	}
	maximum := limits.MaxArchitectureBytes
	if document == DocumentWorkload {
		maximum = limits.MaxWorkloadBytes
	} else if document == DocumentSolutionRevision {
		maximum = limits.MaxSolutionBytes
	}
	if int64(len(contents)) > maximum {
		collector.addError("LIMIT_INPUT_BYTES_EXCEEDED", "Compiler input exceeds the configured byte limit.", SourceReference{Document: document})
		return nil, false
	}
	select {
	case <-ctx.Done():
		collector.addError("COMPILER_CANCELED", "Compiler normalization was canceled.", SourceReference{Document: document})
		return nil, false
	default:
	}

	decoder := json.NewDecoder(bytes.NewReader(contents))
	decoder.UseNumber()
	var value any
	if err := decoder.Decode(&value); err != nil {
		collector.addError("INPUT_JSON_INVALID", "Compiler input is not one valid JSON value.", SourceReference{Document: document})
		return nil, false
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		collector.addError("INPUT_JSON_INVALID", "Compiler input must contain exactly one JSON value.", SourceReference{Document: document})
		return nil, false
	}
	object, ok := value.(map[string]any)
	if !ok {
		collector.addError("STRUCTURE_ROOT_INVALID", "Compiler input root must be an object.", SourceReference{Document: document, Path: "$"})
		return nil, false
	}
	if exceedsJSONDepth(object, 1, limits.MaxJSONDepth) {
		collector.addError("LIMIT_JSON_DEPTH_EXCEEDED", "Compiler input exceeds the configured JSON depth limit.", SourceReference{Document: document})
		return nil, false
	}
	if expectedKind != "" {
		kind, _ := object["kind"].(string)
		if kind != expectedKind {
			collector.addError("COMPAT_DOCUMENT_KIND_UNSUPPORTED", "Compiler input document kind is unsupported.", SourceReference{Document: document, Path: "$.kind"})
			return nil, false
		}
	}
	version, versionOK := numberAsInt(object[versionField])
	if !versionOK || version != expectedVersion {
		collector.addError("COMPAT_SCHEMA_VERSION_UNSUPPORTED", fmt.Sprintf("Compiler supports only %s version %d.", document, expectedVersion), SourceReference{Document: document, Path: "$." + versionField})
		return nil, false
	}

	schemaBytes, err := contracts.Schema(contractKind)
	if err != nil {
		collector.addError("COMPILER_CONTRACT_UNAVAILABLE", "Compiler structural contract is unavailable.", SourceReference{Document: document})
		return nil, false
	}
	validator, err := jsonschema.New(schemaBytes, limits.MaxJSONDepth, limits.MaxDiagnostics)
	if err != nil {
		collector.addError("COMPILER_CONTRACT_INVALID", "Compiler structural contract is invalid.", SourceReference{Document: document})
		return nil, false
	}
	issues := validator.Validate(ctx, object)
	for _, issue := range issues {
		if issue.Keyword == "canceled" {
			collector.addError("COMPILER_CANCELED", "Compiler normalization was canceled.", SourceReference{Document: document, Path: issue.Path})
			continue
		}
		collector.addError(structureCode(document), "Compiler input does not satisfy its versioned structural contract ("+issue.Keyword+").", SourceReference{Document: document, Path: issue.Path})
	}
	return object, len(issues) == 0
}

func structureCode(document DocumentKind) string {
	switch document {
	case DocumentWorkload:
		return "STRUCTURE_WORKLOAD_INVALID"
	case DocumentSolutionRevision:
		return "STRUCTURE_SOLUTION_REVISION_INVALID"
	default:
		return "STRUCTURE_ARCHITECTURE_INVALID"
	}
}

func numberAsInt(value any) (int, bool) {
	switch typed := value.(type) {
	case json.Number:
		integer, err := typed.Int64()
		return int(integer), err == nil && int64(int(integer)) == integer
	case float64:
		integer := int(typed)
		return integer, float64(integer) == typed
	default:
		return 0, false
	}
}

func baseResult(diagnostics []Diagnostic) Result {
	return Result{
		ContractVersion: NormalizedModelContractVersion,
		Compiler:        ToolReference{ID: CompilerID, Version: CompilerVersion, Digest: CompilerDigest},
		Diagnostics:     diagnostics,
	}
}
