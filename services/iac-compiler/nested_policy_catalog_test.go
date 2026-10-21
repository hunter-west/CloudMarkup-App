package compiler

import (
	"context"
	"reflect"
	"strings"
	"testing"
)

func TestNestedPolicyRoleConfigurationVersion(t *testing.T) {
	for _, test := range []struct {
		name, version           string
		current, extra, allowed bool
	}{
		{"old-schema-denied", "1.0.0", true, false, false},
		{"current-v2", "2.0.0", true, false, true},
		{"unknown-v3-denied", "3.0.0", true, false, false},
		{"extra-scalar-denied", "2.0.0", true, true, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			model := minimalLambdaModel("infrastructure-only")
			if test.current {
				prepareCuratedCloudFormationModel(model)
				model.Provenance.Catalog = CatalogReference{ID: TerraformCatalogID, Version: CurrentAwsCatalogVersion, Digest: CurrentAwsCatalogDigest}
			}
			for index := range model.Resources {
				if model.Resources[index].ServiceType == "aws.iam.role" {
					model.Resources[index].Configuration.SchemaVersion = test.version
					if test.extra {
						model.Resources[index].Configuration.Values["unreviewed"] = stringValueConfig("value")
					}
				}
			}
			artifact, diagnostics := renderTerraformArtifact(context.Background(), model, nil, DefaultLimits())
			if test.allowed {
				if artifact == nil || hasErrorDiagnostics(diagnostics) {
					t.Fatalf("reviewed role failed: %v", diagnostics)
				}
				repeated, repeatedDiagnostics := renderTerraformArtifact(context.Background(), model, nil, DefaultLimits())
				if !reflect.DeepEqual(artifact, repeated) || !reflect.DeepEqual(diagnostics, repeatedDiagnostics) {
					t.Fatal("role output is not reproducible")
				}
				if !strings.Contains(fileContent(t, artifact, "infrastructure/identity.tf"), "max_session_duration") {
					t.Fatal("role scalar mapping missing")
				}
			} else if artifact != nil || !hasDiagnostic(diagnostics, "TARGET_CONFIGURATION_UNSUPPORTED") {
				t.Fatalf("unreviewed role accepted: %v", diagnostics)
			}
		})
	}
}
