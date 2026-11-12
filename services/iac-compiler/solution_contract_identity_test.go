package compiler

import (
	"bytes"
	"context"
	"testing"
)

func TestIndependentApplicationContractSetIdentity(t *testing.T) {
	t.Parallel()
	document := decodeMap(t, representativeDocument(t))
	objectAt(t, document, "applicationContracts")["contractSetId"] = "contracts_independent_identity"
	input := encodeMap(t, document)
	result := Normalize(context.Background(), Request{Architecture: input, Target: TargetTerraform})
	if !result.Succeeded() || result.Model == nil {
		t.Fatalf("independent contract-set identity was rejected: %#v", result.Diagnostics)
	}
	repeated := Normalize(context.Background(), Request{Architecture: input, Target: TargetTerraform})
	if !bytes.Equal(mustJSON(t, result), mustJSON(t, repeated)) {
		t.Fatal("repeated normalization changed")
	}
}

func TestIndependentContractSetStillRequiresExactEmbeddedBinding(t *testing.T) {
	t.Parallel()
	for _, kind := range []string{"applicationContracts", "externalResources"} {
		for _, field := range []string{"documentId", "revisionId", "revisionNumber", "createdAt", "createdBy", "previousRevisionId"} {
			t.Run(kind+"-"+field, func(t *testing.T) {
				document := decodeMap(t, representativeDocument(t))
				objectAt(t, document, "applicationContracts")["contractSetId"] = "contracts_independent_identity"
				contracts := objectAt(t, document, kind)
				code := "SEMANTIC_EMBEDDED_REVISION_MISMATCH"
				if field == "documentId" {
					contracts[field] = "document_foreign"
					code = "SEMANTIC_EMBEDDED_DOCUMENT_ID_MISMATCH"
				} else if field == "revisionId" {
					objectAt(t, contracts, "revision")[field] = "revision_foreign"
				} else if field == "revisionNumber" {
					objectAt(t, contracts, "revision")[field] = float64(99)
				} else if field == "createdAt" {
					objectAt(t, contracts, "revision")[field] = "2031-01-01T00:00:00Z"
				} else {
					objectAt(t, contracts, "revision")[field] = "foreign_" + field
				}
				result := Normalize(context.Background(), Request{Architecture: encodeMap(t, document), Target: TargetTerraform})
				assertDiagnostic(t, result, code)
				if result.Succeeded() {
					t.Fatal("foreign embedded document or revision was accepted")
				}
			})
		}
	}
}
