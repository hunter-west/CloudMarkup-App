package compiler

import (
	"encoding/json"
	"os"
	"testing"
)

func TestCurrentAwsCatalogCompatibility(t *testing.T) {
	data, err := os.ReadFile("../../packages/provider-aws/src/compiled/catalog-v1.json")
	if err != nil {
		t.Fatal(err)
	}
	var artifact struct {
		Catalog struct {
			ID      string
			Version string
		}
		Digest     string
		Services   []json.RawMessage
		Migrations []json.RawMessage
	}
	if err := json.Unmarshal(data, &artifact); err != nil {
		t.Fatal(err)
	}
	if artifact.Catalog.ID != TerraformCatalogID || artifact.Catalog.Version != CurrentAwsCatalogVersion || artifact.Digest != CurrentAwsCatalogDigest || len(artifact.Services) != 73 || len(artifact.Migrations) != 0 {
		t.Fatal("installed catalog and compiler admission differ")
	}
	registry := DefaultCompatibilityRegistry()
	awsCatalogs := 0
	for _, catalog := range registry.Catalogs {
		if catalog.ID == TerraformCatalogID {
			awsCatalogs++
		}
	}
	if awsCatalogs != 1 || len(reviewedApplicationGeneratorTuples) != 3 {
		t.Fatal("only the current catalog and three reviewed application generators should be installed")
	}
	current := CatalogReference{ID: TerraformCatalogID, Version: CurrentAwsCatalogVersion, Digest: CurrentAwsCatalogDigest}
	if !isCurrentAwsCatalog(current) {
		t.Fatal("current binding rejected")
	}
	for _, prior := range []CatalogReference{
		{ID: TerraformCatalogID, Version: "0.16.0", Digest: "sha256:b8ae0f69d0fceae28e631e9036b745d2e8988967daee0a0b217e0da392d704d6"},
		{ID: TerraformCatalogID, Version: "0.29.0", Digest: "sha256:c5083d1f2a8244348455b4eddf67a3ad6a3ea45bb84e15bfe01f0f4ba40ec4e4"},
		{ID: TerraformCatalogID, Version: CurrentAwsCatalogVersion, Digest: "sha256:0000000000000000000000000000000000000000000000000000000000000000"},
	} {
		if isCurrentAwsCatalog(prior) {
			t.Fatal("unsupported or relabeled catalog acquired current authority")
		}
	}
}
