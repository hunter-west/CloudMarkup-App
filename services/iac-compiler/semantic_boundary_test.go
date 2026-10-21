package compiler

import (
	"context"
	"testing"
)

func TestAdditionalWorkloadReferenceAndDispatchValidation(t *testing.T) {
	t.Parallel()

	t.Run("missing environment variable", func(t *testing.T) {
		document := decodeMap(t, representativeDocument(t))
		workload := arrayAt(t, objectAt(t, document, "workloadBehavior"), "workloads")[0].(map[string]any)
		binding := arrayAt(t, workload, "environment")[0].(map[string]any)
		objectAt(t, binding, "value")["variableId"] = "variable_missing"
		result := Normalize(context.Background(), Request{Architecture: encodeMap(t, document)})
		assertDiagnostic(t, result, "SEMANTIC_WORKLOAD_ENVIRONMENT_VARIABLE_MISSING")
	})

	t.Run("implementation dispatch mismatch", func(t *testing.T) {
		document := decodeMap(t, representativeDocument(t))
		workload := arrayAt(t, objectAt(t, document, "workloadBehavior"), "workloads")[0].(map[string]any)
		workload["triggerDispatch"] = map[string]any{"mode": "generated-supported", "dispatcherId": "example.dispatcher.generated", "dispatcherVersion": "1.0.0", "dispatcherOperationId": "workload_operation_handle"}
		result := Normalize(context.Background(), Request{Architecture: encodeMap(t, document)})
		assertDiagnostic(t, result, "SEMANTIC_WORKLOAD_DISPATCH_MODE_INVALID")
	})
}

func TestEmbeddedSolutionDocumentsBindExactArchitectureRevision(t *testing.T) {
	t.Parallel()

	document := decodeMap(t, representativeDocument(t))
	contracts := objectAt(t, document, "applicationContracts")
	objectAt(t, contracts, "revision")["revisionId"] = "revision_other"
	result := Normalize(context.Background(), Request{Architecture: encodeMap(t, document)})
	assertDiagnostic(t, result, "SEMANTIC_EMBEDDED_REVISION_MISMATCH")
}

func TestSourceOwnershipMetadataIsPreserved(t *testing.T) {
	t.Parallel()

	document := decodeMap(t, representativeDocument(t))
	workload := arrayAt(t, objectAt(t, document, "workloadBehavior"), "workloads")[0].(map[string]any)
	workload["sourceOwnership"] = []any{map[string]any{
		"declarationId":    "ownership_handler",
		"path":             "src/handler.ts",
		"pathKind":         "file",
		"ownership":        "user-owned",
		"ownerId":          "example.team.application",
		"regeneration":     "never",
		"conflictBehavior": "preserve-user-content",
		"semanticDiff": map[string]any{
			"strategy":          "structured-language",
			"normalizerId":      "example.normalizer.typescript",
			"normalizerVersion": "1.2.3",
		},
		"baselineDigest": digestOf('c'),
	}}
	result := Normalize(context.Background(), Request{Architecture: encodeMap(t, document)})
	if !result.Succeeded() {
		t.Fatalf("Normalize() diagnostics = %#v", result.Diagnostics)
	}
	if got := result.Model.Workloads[0].SourceOwnership[0]; got.SemanticDiff != "structured-language" || got.NormalizerID != "example.normalizer.typescript" || got.NormalizerVersion != "1.2.3" || got.Ownership != "user-owned" {
		t.Fatalf("source ownership = %#v, want exact normalized ownership metadata", got)
	}
}

func TestDiagnosticAndDepthLimitsFailClosed(t *testing.T) {
	t.Parallel()

	document := decodeMap(t, representativeDocument(t))
	workload := arrayAt(t, objectAt(t, document, "workloadBehavior"), "workloads")[0].(map[string]any)
	workload["unresolvedRequirementIds"] = []any{"requirement_missing_one", "requirement_missing_two"}
	limits := DefaultLimits()
	limits.MaxDiagnostics = 1
	limited := Normalize(context.Background(), Request{Architecture: encodeMap(t, document), Limits: limits})
	assertDiagnostic(t, limited, "LIMIT_DIAGNOSTICS_EXCEEDED")
	if len(limited.Diagnostics) != 1 {
		t.Fatalf("diagnostic count = %d, want configured maximum 1", len(limited.Diagnostics))
	}

	depthLimits := DefaultLimits()
	depthLimits.MaxJSONDepth = 2
	deep := Normalize(context.Background(), Request{Architecture: representativeDocument(t), Limits: depthLimits})
	assertDiagnostic(t, deep, "LIMIT_JSON_DEPTH_EXCEEDED")
}
