package compiler

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"regexp"
	"testing"
)

func TestDefaultRegistryPinsApplicationGeneratorExactly(t *testing.T) {
	t.Parallel()

	notesMatches := 0
	eventMatches := 0
	for _, generator := range DefaultCompatibilityRegistry().ApplicationGenerators {
		if generator.ID == ApplicationGeneratorID && generator.Version == ApplicationGeneratorVersion && generator.Digest == ApplicationGeneratorDigest {
			notesMatches++
		}
		if generator.ID == EventApplicationGeneratorID && generator.Version == EventApplicationGeneratorVersion && generator.Digest == EventApplicationGeneratorDigest {
			eventMatches++
		}
	}
	if notesMatches != 1 || eventMatches != 1 {
		t.Fatalf("default generator matches = notes:%d event:%d, want exactly one each", notesMatches, eventMatches)
	}
}

func TestEventGeneratorRequiresExactCatalogTemplatePatternAndDispatcherTuple(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		mutate   func(*testing.T, map[string]any, *ToolReference)
		wantCode string
	}{
		{name: "exact tuple"},
		{
			name: "historical infrastructure catalog",
			mutate: func(t *testing.T, document map[string]any, _ *ToolReference) {
				document["catalog"] = map[string]any{
					"id": TerraformCatalogID, "version": "0.16.0", "digest": "sha256:b8ae0f69d0fceae28e631e9036b745d2e8988967daee0a0b217e0da392d704d6",
				}
			},
			wantCode: "COMPAT_GENERATOR_CATALOG_MISMATCH",
		},
		{
			name: "generator digest rebound",
			mutate: func(t *testing.T, _ map[string]any, generator *ToolReference) {
				generator.Digest = digestOf('f')
			},
			wantCode: "COMPAT_GENERATOR_UNAVAILABLE",
		},
		{
			name: "notes generator on event catalog",
			mutate: func(t *testing.T, document map[string]any, generator *ToolReference) {
				*generator = ToolReference{ID: ApplicationGeneratorID, Version: ApplicationGeneratorVersion, Digest: ApplicationGeneratorDigest}
				declaration := builtInGeneratorDeclaration(t, document)
				declaration["generatorId"] = ApplicationGeneratorID
				declaration["minimumVersion"] = ApplicationGeneratorVersion
				declaration["templateId"] = ApplicationTemplateID
				declaration["templateVersion"] = ApplicationTemplateVersion
			},
			wantCode: "COMPAT_WORKLOAD_PATTERN_MISMATCH",
		},
		{
			name: "template",
			mutate: func(t *testing.T, document map[string]any, _ *ToolReference) {
				builtInGeneratorDeclaration(t, document)["templateId"] = "cloudmarkup.template.unreviewed"
			},
			wantCode: "COMPAT_WORKLOAD_GENERATOR_MISMATCH",
		},
		{
			name: "pattern digest",
			mutate: func(t *testing.T, document map[string]any, _ *ToolReference) {
				objectAt(t, objectAt(t, builtInGeneratorWorkload(t, document), "implementation"), "supportedPattern")["digest"] = digestOf('f')
			},
			wantCode: "COMPAT_WORKLOAD_PATTERN_MISMATCH",
		},
		{
			name: "implicit dispatch",
			mutate: func(t *testing.T, document map[string]any, _ *ToolReference) {
				builtInGeneratorWorkload(t, document)["triggerDispatch"] = map[string]any{"mode": "single"}
			},
			wantCode: "COMPAT_WORKLOAD_DISPATCHER_MISMATCH",
		},
		{
			name: "dispatcher version",
			mutate: func(t *testing.T, document map[string]any, _ *ToolReference) {
				objectAt(t, builtInGeneratorWorkload(t, document), "triggerDispatch")["dispatcherVersion"] = "1.0.1"
			},
			wantCode: "COMPAT_WORKLOAD_DISPATCHER_MISMATCH",
		},
		{
			name: "dispatcher ID",
			mutate: func(t *testing.T, document map[string]any, _ *ToolReference) {
				objectAt(t, builtInGeneratorWorkload(t, document), "triggerDispatch")["dispatcherId"] = "cloudmarkup.dispatcher.unreviewed"
			},
			wantCode: "COMPAT_WORKLOAD_DISPATCHER_MISMATCH",
		},
		{
			name: "dispatcher operation",
			mutate: func(t *testing.T, document map[string]any, _ *ToolReference) {
				objectAt(t, builtInGeneratorWorkload(t, document), "triggerDispatch")["dispatcherOperationId"] = "workload_operation_missing"
			},
			wantCode: "COMPAT_WORKLOAD_DISPATCHER_MISMATCH",
		},
	}

	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			document := eventGeneratorDocument(t)
			generator := ToolReference{ID: EventApplicationGeneratorID, Version: EventApplicationGeneratorVersion, Digest: EventApplicationGeneratorDigest}
			if test.mutate != nil {
				test.mutate(t, document, &generator)
			}
			architecture := encodeMap(t, document)
			result := Normalize(context.Background(), Request{
				Architecture: architecture, SolutionRevision: validSolutionManifest(t, architecture, &generator),
				Compatibility: DefaultCompatibilityRegistry(),
			})
			if test.wantCode == "" {
				if !result.Succeeded() {
					t.Fatalf("Normalize() diagnostics = %#v", result.Diagnostics)
				}
				readiness := result.Model.Workloads[0].GeneratorReadiness
				if !reviewedEventApplicationGeneratorReadiness(readiness) {
					t.Fatalf("event generator readiness = %#v", readiness)
				}
				return
			}
			if result.Succeeded() {
				t.Fatalf("Normalize() unexpectedly succeeded for %s", test.name)
			}
			assertDiagnostic(t, result, test.wantCode)
		})
	}
}

func TestSupportedPatternArtifactIDUsesStableSolutionExportShape(t *testing.T) {
	t.Parallel()

	document := eventGeneratorDocument(t)
	architecture := encodeMap(t, document)
	generator := ToolReference{ID: EventApplicationGeneratorID, Version: EventApplicationGeneratorVersion, Digest: EventApplicationGeneratorDigest}
	result := Normalize(context.Background(), Request{
		Architecture: architecture, SolutionRevision: validSolutionManifest(t, architecture, &generator),
		Compatibility: DefaultCompatibilityRegistry(),
	})
	if !result.Succeeded() {
		t.Fatalf("Normalize() diagnostics = %#v", result.Diagnostics)
	}
	inputs := result.Model.Workloads[0].ArtifactInputs
	if len(inputs) != 1 {
		t.Fatalf("supported-pattern inputs = %#v, want exactly one", inputs)
	}
	want := EventApplicationPatternID + ":" + EventApplicationPatternVersion
	if inputs[0].ArtifactID != want || inputs[0].Kind != "supported-pattern" {
		t.Fatalf("supported-pattern input = %#v, want artifact ID %q", inputs[0], want)
	}
	if !regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$`).MatchString(inputs[0].ArtifactID) {
		t.Fatalf("supported-pattern artifact ID %q is not a stable Solution Export ID", inputs[0].ArtifactID)
	}
}

func TestBuiltInGeneratorIdentityRejectsCallerSuppliedDigestRebinding(t *testing.T) {
	t.Parallel()

	document := builtInGeneratorDocument(t, "generated-starter")
	architecture := encodeMap(t, document)
	rebound := ToolReference{ID: ApplicationGeneratorID, Version: ApplicationGeneratorVersion, Digest: digestOf('f')}
	registry := DefaultCompatibilityRegistry()
	registry.ApplicationGenerators = []GeneratorCompatibility{{ID: rebound.ID, Version: rebound.Version, Digest: rebound.Digest}}
	result := Normalize(context.Background(), Request{
		Architecture:     architecture,
		SolutionRevision: validSolutionManifest(t, architecture, &rebound),
		Compatibility:    registry,
	})
	if result.Succeeded() {
		t.Fatal("caller-supplied registry rebound the built-in generator identity")
	}
	assertDiagnostic(t, result, "COMPAT_GENERATOR_UNAVAILABLE")
}

func TestGeneratorCompatibilityRequiresDigestAndRejectsAmbiguity(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name                  string
		tool                  ToolReference
		duplicateRegistry     bool
		duplicateDeclaration  bool
		wantSuccess           bool
		wantReadinessTemplate string
		wantCode              string
	}{
		{
			name:                  "exact reviewed pin",
			tool:                  ToolReference{ID: ApplicationGeneratorID, Version: ApplicationGeneratorVersion, Digest: ApplicationGeneratorDigest},
			wantSuccess:           true,
			wantReadinessTemplate: "cloudmarkup.template.aws-lambda-notes-typescript",
		},
		{
			name:     "missing digest",
			tool:     ToolReference{ID: ApplicationGeneratorID, Version: ApplicationGeneratorVersion},
			wantCode: "STRUCTURE_SOLUTION_REVISION_INVALID",
		},
		{
			name:              "ambiguous registry",
			tool:              ToolReference{ID: ApplicationGeneratorID, Version: ApplicationGeneratorVersion, Digest: ApplicationGeneratorDigest},
			duplicateRegistry: true,
			wantCode:          "COMPAT_GENERATOR_UNAVAILABLE",
		},
		{
			name:                 "ambiguous workload template",
			tool:                 ToolReference{ID: ApplicationGeneratorID, Version: ApplicationGeneratorVersion, Digest: ApplicationGeneratorDigest},
			duplicateDeclaration: true,
			wantCode:             "COMPAT_WORKLOAD_GENERATOR_MISMATCH",
		},
	}

	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			document := builtInGeneratorDocument(t, "generated-starter")
			workload := arrayAt(t, objectAt(t, document, "workloadBehavior"), "workloads")[0].(map[string]any)
			declaration := map[string]any{
				"generatorId": ApplicationGeneratorID, "minimumVersion": ApplicationGeneratorVersion,
				"templateId": ApplicationTemplateID, "templateVersion": ApplicationTemplateVersion,
				"supportedModes": []any{"generated-starter"},
			}
			declarations := []any{declaration}
			if test.duplicateDeclaration {
				declarations = append(declarations, declaration)
			}
			objectAt(t, workload, "compatibility")["applicationGenerators"] = declarations

			architecture := encodeMap(t, document)
			manifest := validSolutionManifest(t, architecture, &test.tool)
			registry := DefaultCompatibilityRegistry()
			if test.duplicateRegistry {
				registry.ApplicationGenerators = append(registry.ApplicationGenerators, GeneratorCompatibility{ID: ApplicationGeneratorID, Version: ApplicationGeneratorVersion, Digest: ApplicationGeneratorDigest})
			}
			result := Normalize(context.Background(), Request{
				Architecture: architecture, SolutionRevision: manifest, Compatibility: registry,
			})
			if test.wantSuccess {
				if !result.Succeeded() {
					t.Fatalf("Normalize() diagnostics = %#v", result.Diagnostics)
				}
				readiness := result.Model.Workloads[0].GeneratorReadiness
				if readiness.State != "compatible-interface-only" || readiness.TemplateID != test.wantReadinessTemplate {
					t.Fatalf("generator readiness = %#v", readiness)
				}
				return
			}
			if result.Succeeded() {
				t.Fatalf("Normalize() unexpectedly succeeded: %#v", result.Model.Workloads[0].GeneratorReadiness)
			}
			assertDiagnostic(t, result, test.wantCode)
			if test.duplicateDeclaration {
				if result.Model == nil || result.Model.Workloads[0].GeneratorReadiness.State != "incompatible" {
					t.Fatalf("ambiguous generator readiness = %#v, want incompatible", result.Model)
				}
			}
		})
	}
}

func TestBuiltInDescriptorDigestsCommitExactGeneratorTemplateRuntimeAndPatternMatrix(t *testing.T) {
	t.Parallel()

	runtimeDescriptor := map[string]any{
		"contractVersion": 1,
		"id":              ApplicationRuntimeID,
		"version":         ApplicationRuntimeVersion,
		"runtimeFamily":   ApplicationRuntimeFamily,
		"languageFamily":  ApplicationLanguageFamily,
		"runtime":         ApplicationLambdaRuntime,
		"handler":         ApplicationLambdaHandler,
		"moduleFormat":    "esm",
	}
	runtimeDigest := canonicalDescriptorDigest(t, runtimeDescriptor)
	if runtimeDigest != ApplicationRuntimeDigest {
		t.Fatalf("runtime descriptor digest = %q, want %q", runtimeDigest, ApplicationRuntimeDigest)
	}

	supportedRelationships := []string{
		"aws.apigateway.integrates-lambda",
		"aws.lambda.reads-dynamodb-table",
		"aws.lambda.writes-dynamodb-table",
		"aws.lambda.writes-log-group",
	}
	supportedOperations := []string{"create", "read", "update", "delete"}
	templateDescriptor := map[string]any{
		"contractVersion": 1,
		"id":              ApplicationTemplateID,
		"version":         ApplicationTemplateVersion,
		"pattern": map[string]any{
			"id": ApplicationPatternID, "version": ApplicationPatternVersion,
		},
		"runtime": map[string]any{
			"id": ApplicationRuntimeID, "version": ApplicationRuntimeVersion, "digest": runtimeDigest,
		},
		"supportedModes":          []string{"generated-starter", "complete-supported-pattern"},
		"supportedRelationships":  supportedRelationships,
		"supportedDataOperations": supportedOperations,
		"triggerContract":         "aws.apigateway.http-api.payload-v2",
	}
	templateDigest := canonicalDescriptorDigest(t, templateDescriptor)
	if templateDigest != ApplicationTemplateDigest {
		t.Fatalf("template descriptor digest = %q, want %q", templateDigest, ApplicationTemplateDigest)
	}

	patternDescriptor := map[string]any{
		"contractVersion":         1,
		"id":                      ApplicationPatternID,
		"version":                 ApplicationPatternVersion,
		"templateDigest":          templateDigest,
		"supportedDataOperations": supportedOperations,
		"supportedRelationships":  supportedRelationships,
	}
	patternDigest := canonicalDescriptorDigest(t, patternDescriptor)
	if patternDigest != ApplicationPatternDigest {
		t.Fatalf("pattern descriptor digest = %q, want %q", patternDigest, ApplicationPatternDigest)
	}

	generatorDescriptor := map[string]any{
		"contractVersion": 1,
		"id":              ApplicationGeneratorID,
		"version":         ApplicationGeneratorVersion,
		"templates": []any{map[string]any{
			"id": ApplicationTemplateID, "version": ApplicationTemplateVersion, "digest": templateDigest,
		}},
	}
	generatorDigest := canonicalDescriptorDigest(t, generatorDescriptor)
	if generatorDigest != ApplicationGeneratorDigest {
		t.Fatalf("generator descriptor digest = %q, want %q", generatorDigest, ApplicationGeneratorDigest)
	}
}

func TestEventDescriptorDigestsCommitExactDispatcherTemplatePatternAndGeneratorTuple(t *testing.T) {
	t.Parallel()

	patterns := []string{
		"s3-image-metadata",
		"sqs-consumer-dlq",
		"sns-fanout-consumer",
		"eventbridge-scheduled",
		"eventbridge-target",
		"step-functions-task",
	}
	relationships := []string{
		"aws.s3.notifies-lambda",
		"aws.sqs.triggers-lambda",
		"aws.sns.subscription-invokes-lambda",
		"aws.sns.subscription-sends-to-sqs",
		"aws.eventbridge.target-invokes-lambda",
		"aws.stepfunctions.state-machine-invokes-lambda",
		"aws.lambda.writes-dynamodb-table",
		"aws.lambda.writes-log-group",
		"aws.sqs.uses-dead-letter-queue",
		"aws.eventbridge.target-uses-dead-letter-queue",
	}
	s3PayloadContract := map[string]any{
		"fields": []any{
			map[string]any{"classification": "internal", "name": "bucket", "nullable": false, "required": true, "scalarType": "string"},
			map[string]any{"classification": "internal", "name": "eTag", "nullable": false, "required": true, "scalarType": "string"},
			map[string]any{"classification": "internal", "name": "key", "nullable": false, "required": true, "scalarType": "string"},
			map[string]any{"classification": "internal", "name": "sequencer", "nullable": false, "required": true, "scalarType": "string"},
			map[string]any{"classification": "internal", "name": "size", "nullable": false, "required": true, "scalarType": "integer"},
			map[string]any{"classification": "internal", "name": "versionId", "nullable": false, "required": true, "scalarType": "string"},
		},
		"partitionKey":        "key",
		"storageIntent":       "persistent",
		"supportedOperations": []any{"consume", "create"},
	}
	scheduledPayloadContract := map[string]any{
		"fields": []any{
			map[string]any{"classification": "internal", "name": "correlationId", "nullable": false, "required": false, "scalarType": "string"},
			map[string]any{"classification": "internal", "name": "eventId", "nullable": false, "required": true, "scalarType": "string"},
		},
		"partitionKey":        "eventId",
		"storageIntent":       "transient",
		"supportedOperations": []any{"consume"},
	}
	scheduledPayloadAuthority := map[string]any{
		"envelopeKind":          "aws.events.scheduled-event",
		"payloadContract":       scheduledPayloadContract,
		"fieldBindings":         []any{map[string]any{"payloadField": "eventId", "sourcePath": "$.id"}},
		"nonAuthoritativePaths": []any{"$.detail"},
	}
	snsSqsRawDeliveryPrerequisite := map[string]any{
		"queueBodyAuthority":    "bound-event-payload",
		"relationshipType":      "aws.sns.subscription-sends-to-sqs",
		"sourceResourceType":    "aws.sns.subscription",
		"sourceServiceType":     "aws.sns.subscription",
		"requiredConfiguration": map[string]any{"rawMessageDelivery": true},
	}
	runtimeExtensionBoundary := map[string]any{
		"generatedSeam": map[string]any{
			"path":                      "generated/runtime-extension.ts",
			"ownership":                 "generated",
			"behavior":                  "no-op",
			"generatedProfilePackaging": "included",
		},
		"userExtension": map[string]any{
			"path":                      "extensions/custom.ts",
			"ownership":                 "user-owned",
			"generatedProfilePackaging": "excluded",
			"activation":                "separately-reviewed-custom-source-profile",
			"modificationStatus":        "custom-implementation-required",
		},
	}
	dispatcherDigest := canonicalDescriptorDigest(t, map[string]any{
		"contractVersion":   1,
		"id":                EventApplicationDispatcherID,
		"version":           EventApplicationDispatcherVersion,
		"dispatchAuthority": "workload-event-binding-and-typed-edge",
		"inference":         "forbidden",
		"payloadAuthorities": map[string]any{
			"eventbridge-scheduled": scheduledPayloadAuthority,
		},
		"supportedPatterns": patterns,
	})
	if dispatcherDigest != EventApplicationDispatcherDigest {
		t.Fatalf("event dispatcher digest = %q, want %q", dispatcherDigest, EventApplicationDispatcherDigest)
	}
	templateDigest := canonicalDescriptorDigest(t, map[string]any{
		"contractVersion": 1,
		"id":              EventApplicationTemplateID,
		"version":         EventApplicationTemplateVersion,
		"pattern": map[string]any{
			"id": EventApplicationPatternID, "version": EventApplicationPatternVersion,
		},
		"runtime": map[string]any{
			"id": ApplicationRuntimeID, "version": ApplicationRuntimeVersion, "digest": ApplicationRuntimeDigest,
		},
		"dispatcher": map[string]any{
			"id": EventApplicationDispatcherID, "version": EventApplicationDispatcherVersion, "digest": dispatcherDigest,
		},
		"completePatternContracts": map[string]any{
			"s3-image-metadata": map[string]any{
				"payload": s3PayloadContract,
			},
			"sqs-consumer-dlq": map[string]any{
				"upstreamSnsToSqs": snsSqsRawDeliveryPrerequisite,
			},
		},
		"runtimeExtensionBoundary": runtimeExtensionBoundary,
		"supportedModes":           []string{"generated-starter", "complete-supported-pattern"},
		"supportedRelationships":   relationships,
		"supportedPatterns":        patterns,
		"dispatchAuthority":        "explicit-workload-contract",
		"eventInference":           "forbidden",
	})
	if templateDigest != EventApplicationTemplateDigest {
		t.Fatalf("event template digest = %q, want %q", templateDigest, EventApplicationTemplateDigest)
	}
	patternDigest := canonicalDescriptorDigest(t, map[string]any{
		"contractVersion":        1,
		"id":                     EventApplicationPatternID,
		"version":                EventApplicationPatternVersion,
		"templateDigest":         templateDigest,
		"dispatcherDigest":       dispatcherDigest,
		"supportedPatterns":      patterns,
		"supportedRelationships": relationships,
	})
	if patternDigest != EventApplicationPatternDigest {
		t.Fatalf("event pattern digest = %q, want %q", patternDigest, EventApplicationPatternDigest)
	}
	generatorDigest := canonicalDescriptorDigest(t, map[string]any{
		"contractVersion": 1,
		"id":              EventApplicationGeneratorID,
		"version":         EventApplicationGeneratorVersion,
		"templates": []any{map[string]any{
			"id": EventApplicationTemplateID, "version": EventApplicationTemplateVersion, "digest": templateDigest,
		}},
	})
	if generatorDigest != EventApplicationGeneratorDigest {
		t.Fatalf("event generator digest = %q, want %q", generatorDigest, EventApplicationGeneratorDigest)
	}
}

func TestBuiltInGeneratorMatrixFailsClosed(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		mode     string
		mutate   func(*testing.T, map[string]any)
		wantCode string
	}{
		{
			name: "template ID", mode: "generated-starter", wantCode: "COMPAT_WORKLOAD_GENERATOR_MISMATCH",
			mutate: func(t *testing.T, document map[string]any) {
				builtInGeneratorDeclaration(t, document)["templateId"] = "cloudmarkup.template.unreviewed"
			},
		},
		{
			name: "template version", mode: "generated-starter", wantCode: "COMPAT_WORKLOAD_GENERATOR_MISMATCH",
			mutate: func(t *testing.T, document map[string]any) {
				builtInGeneratorDeclaration(t, document)["templateVersion"] = "1.0.1"
			},
		},
		{
			name: "non-exact generator range", mode: "generated-starter", wantCode: "COMPAT_WORKLOAD_GENERATOR_MISMATCH",
			mutate: func(t *testing.T, document map[string]any) {
				builtInGeneratorDeclaration(t, document)["maximumVersionExclusive"] = "2.0.0"
			},
		},
		{
			name: "runtime family", mode: "generated-starter", wantCode: "COMPAT_WORKLOAD_RUNTIME_MISMATCH",
			mutate: func(t *testing.T, document map[string]any) {
				objectAt(t, builtInGeneratorWorkload(t, document), "implementation")["runtimeFamily"] = "aws.lambda.runtime-family.nodejs22"
			},
		},
		{
			name: "language family", mode: "generated-starter", wantCode: "COMPAT_WORKLOAD_RUNTIME_MISMATCH",
			mutate: func(t *testing.T, document map[string]any) {
				builtInGeneratorWorkload(t, document)["languageFamily"] = "cloudmarkup.language.javascript"
			},
		},
		{
			name: "workload handler", mode: "generated-starter", wantCode: "COMPAT_WORKLOAD_RUNTIME_MISMATCH",
			mutate: func(t *testing.T, document map[string]any) {
				objectAt(t, builtInGeneratorWorkload(t, document), "implementation")["handler"] = "main.handler"
			},
		},
		{
			name: "Lambda runtime", mode: "generated-starter", wantCode: "COMPAT_WORKLOAD_RUNTIME_MISMATCH",
			mutate: func(t *testing.T, document map[string]any) {
				objectAt(t, builtInLambdaConfigurationValues(t, document), "runtime")["value"] = "nodejs22.x"
			},
		},
		{
			name: "Lambda handler", mode: "generated-starter", wantCode: "COMPAT_WORKLOAD_RUNTIME_MISMATCH",
			mutate: func(t *testing.T, document map[string]any) {
				objectAt(t, builtInLambdaConfigurationValues(t, document), "handler")["value"] = "main.handler"
			},
		},
		{
			name: "catalog digest", mode: "generated-starter", wantCode: "COMPAT_GENERATOR_CATALOG_MISMATCH",
			mutate: func(t *testing.T, document map[string]any) {
				objectAt(t, document, "catalog")["digest"] = digestOf('f')
			},
		},
		{
			name: "pattern ID", mode: "complete-supported-pattern", wantCode: "COMPAT_WORKLOAD_PATTERN_MISMATCH",
			mutate: func(t *testing.T, document map[string]any) {
				objectAt(t, objectAt(t, builtInGeneratorWorkload(t, document), "implementation"), "supportedPattern")["patternId"] = "cloudmarkup.pattern.unreviewed"
			},
		},
		{
			name: "pattern version", mode: "complete-supported-pattern", wantCode: "COMPAT_WORKLOAD_PATTERN_MISMATCH",
			mutate: func(t *testing.T, document map[string]any) {
				objectAt(t, objectAt(t, builtInGeneratorWorkload(t, document), "implementation"), "supportedPattern")["patternVersion"] = "1.0.1"
			},
		},
		{
			name: "pattern digest", mode: "complete-supported-pattern", wantCode: "COMPAT_WORKLOAD_PATTERN_MISMATCH",
			mutate: func(t *testing.T, document map[string]any) {
				objectAt(t, objectAt(t, builtInGeneratorWorkload(t, document), "implementation"), "supportedPattern")["digest"] = digestOf('f')
			},
		},
	}

	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			document := builtInGeneratorDocument(t, test.mode)
			test.mutate(t, document)
			architecture := encodeMap(t, document)
			generator := ToolReference{ID: ApplicationGeneratorID, Version: ApplicationGeneratorVersion, Digest: ApplicationGeneratorDigest}
			result := Normalize(context.Background(), Request{
				Architecture:     architecture,
				SolutionRevision: validSolutionManifest(t, architecture, &generator),
				Compatibility:    DefaultCompatibilityRegistry(),
			})
			if result.Succeeded() {
				t.Fatalf("Normalize() unexpectedly succeeded for mismatched %s", test.name)
			}
			assertDiagnostic(t, result, test.wantCode)
		})
	}
}

func builtInGeneratorDocument(t *testing.T, mode string) map[string]any {
	t.Helper()
	document := decodeMap(t, representativeDocument(t))
	document["provider"] = map[string]any{"id": "aws.cloudmarkup", "region": "us-east-1"}
	document["catalog"] = map[string]any{"id": TerraformCatalogID, "version": CurrentAwsCatalogVersion, "digest": CurrentAwsCatalogDigest}

	foundOwner := false
	for _, candidate := range arrayAt(t, document, "nodes") {
		node := candidate.(map[string]any)
		if node["id"] != "node_worker" {
			continue
		}
		semantic := objectAt(t, node, "semantic")
		semantic["serviceType"] = "aws.lambda.function"
		semantic["resourceType"] = "aws.lambda.function"
		semantic["configuration"] = map[string]any{
			"schemaId": "aws.lambda.function.configuration", "schemaVersion": "1.0.0",
			"values": map[string]any{
				"runtime": map[string]any{"kind": "string", "value": ApplicationLambdaRuntime},
				"handler": map[string]any{"kind": "string", "value": ApplicationLambdaHandler},
			},
		}
		foundOwner = true
		break
	}
	if !foundOwner {
		t.Fatal("representative fixture is missing node_worker")
	}

	workload := builtInGeneratorWorkload(t, document)
	implementation := map[string]any{
		"mode": mode, "runtimeFamily": ApplicationRuntimeFamily,
		"handler": ApplicationLambdaHandler, "sourceOwnership": "cloudmarkup",
	}
	if mode == "complete-supported-pattern" {
		implementation["supportedPattern"] = map[string]any{
			"patternId": ApplicationPatternID, "patternVersion": ApplicationPatternVersion, "digest": ApplicationPatternDigest,
		}
	}
	workload["implementation"] = implementation
	workload["languageFamily"] = ApplicationLanguageFamily
	objectAt(t, workload, "compatibility")["applicationGenerators"] = []any{map[string]any{
		"generatorId": ApplicationGeneratorID, "minimumVersion": ApplicationGeneratorVersion,
		"templateId": ApplicationTemplateID, "templateVersion": ApplicationTemplateVersion,
		"supportedModes": []any{mode},
	}}
	return document
}

func eventGeneratorDocument(t *testing.T) map[string]any {
	t.Helper()
	document := builtInGeneratorDocument(t, "complete-supported-pattern")
	document["catalog"] = map[string]any{
		"id": TerraformCatalogID, "version": CurrentAwsCatalogVersion, "digest": CurrentAwsCatalogDigest,
	}
	workload := builtInGeneratorWorkload(t, document)
	implementation := objectAt(t, workload, "implementation")
	implementation["supportedPattern"] = map[string]any{
		"patternId": EventApplicationPatternID, "patternVersion": EventApplicationPatternVersion, "digest": EventApplicationPatternDigest,
	}
	objectAt(t, workload, "compatibility")["applicationGenerators"] = []any{map[string]any{
		"generatorId": EventApplicationGeneratorID, "minimumVersion": EventApplicationGeneratorVersion,
		"templateId": EventApplicationTemplateID, "templateVersion": EventApplicationTemplateVersion,
		"supportedModes": []any{"complete-supported-pattern"},
	}}
	workload["triggerDispatch"] = map[string]any{
		"mode":                  "generated-supported",
		"dispatcherId":          EventApplicationDispatcherID,
		"dispatcherVersion":     EventApplicationDispatcherVersion,
		"dispatcherOperationId": "workload_operation_handle",
	}
	return document
}

func builtInGeneratorWorkload(t *testing.T, document map[string]any) map[string]any {
	t.Helper()
	return arrayAt(t, objectAt(t, document, "workloadBehavior"), "workloads")[0].(map[string]any)
}

func builtInGeneratorDeclaration(t *testing.T, document map[string]any) map[string]any {
	t.Helper()
	workload := builtInGeneratorWorkload(t, document)
	return arrayAt(t, objectAt(t, workload, "compatibility"), "applicationGenerators")[0].(map[string]any)
}

func builtInLambdaConfigurationValues(t *testing.T, document map[string]any) map[string]any {
	t.Helper()
	for _, candidate := range arrayAt(t, document, "nodes") {
		node := candidate.(map[string]any)
		if node["id"] == "node_worker" {
			return objectAt(t, objectAt(t, objectAt(t, node, "semantic"), "configuration"), "values")
		}
	}
	t.Fatal("built-in Lambda owner is missing")
	return nil
}

func canonicalDescriptorDigest(t *testing.T, descriptor any) string {
	t.Helper()
	encoded, err := json.MarshalIndent(descriptor, "", "  ")
	if err != nil {
		t.Fatalf("marshal canonical descriptor: %v", err)
	}
	encoded = append(encoded, '\n')
	digest := sha256.Sum256(encoded)
	return "sha256:" + hex.EncodeToString(digest[:])
}
