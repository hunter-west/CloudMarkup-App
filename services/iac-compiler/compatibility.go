package compiler

import (
	"fmt"
	"strconv"
	"strings"
)

func validateCompatibility(request Request, decoded *decodedRequest, collector *diagnosticCollector) {
	architecture := decoded.architecture
	if architecture.CompilerCompatibility.InputContractVersion != CompilerInputContractVersion {
		collector.addError(
			"COMPAT_INPUT_CONTRACT_UNSUPPORTED",
			fmt.Sprintf("Compiler supports input contract version %d.", CompilerInputContractVersion),
			SourceReference{Document: DocumentArchitecture, Path: "$.compilerCompatibility.inputContractVersion"},
		)
	}
	if !versionInRange(CompilerVersion, architecture.CompilerCompatibility.MinimumCompilerVersion, architecture.CompilerCompatibility.MaximumCompilerVersionExclusive) {
		collector.addError(
			"COMPAT_COMPILER_VERSION_UNSUPPORTED",
			"Architecture Document compiler compatibility does not include this compiler version.",
			SourceReference{Document: DocumentArchitecture, Path: "$.compilerCompatibility"},
		)
	}

	registry := request.Compatibility
	if len(registry.Catalogs) == 0 && len(registry.ApplicationGenerators) == 0 {
		registry = DefaultCompatibilityRegistry()
	}
	matches := make([]CatalogCompatibility, 0, 1)
	for _, catalog := range registry.Catalogs {
		if catalog.ID == architecture.Catalog.ID && catalog.Version == architecture.Catalog.Version && catalog.Digest == architecture.Catalog.Digest {
			matches = append(matches, catalog)
		}
	}
	if len(matches) != 1 {
		collector.addError(
			"COMPAT_CATALOG_UNAVAILABLE",
			"Exact provider catalog ID, version, and digest are not available to this compiler.",
			SourceReference{Document: DocumentArchitecture, Path: "$.catalog"},
		)
	} else if !containsInt(matches[0].ArchitectureSchemaVersions, architecture.SchemaVersion) {
		collector.addError(
			"COMPAT_CATALOG_SCHEMA_UNSUPPORTED",
			"Exact provider catalog does not declare compatibility with this Architecture Document schema version.",
			SourceReference{Document: DocumentArchitecture, Path: "$.catalog"},
		)
	}

	if _, ok := targetFor(request.Target); !ok {
		collector.addError("COMPAT_TARGET_UNSUPPORTED", "Requested target is unsupported.", SourceReference{Document: DocumentArchitecture})
	}

	if decoded.solution == nil {
		return
	}
	solution := decoded.solution
	if solution.Versions.Catalog != architecture.Catalog {
		collector.addError(
			"COMPAT_SOLUTION_CATALOG_MISMATCH",
			"Solution Revision catalog binding does not match the Architecture Document.",
			SourceReference{Document: DocumentSolutionRevision, Path: "$.versions.catalog"},
		)
	}
	if solution.Versions.Compiler.State == "pinned" {
		tool := solution.Versions.Compiler.Tool
		if tool.ID != CompilerID || tool.Version != CompilerVersion {
			collector.addError(
				"COMPAT_SOLUTION_COMPILER_MISMATCH",
				"Solution Revision pins a different compiler identity or version.",
				SourceReference{Document: DocumentSolutionRevision, Path: "$.versions.compiler.tool"},
			)
		}
	}
	validateGeneratorCompatibility(registry, decoded, collector)
}

type reviewedApplicationGeneratorTuple struct {
	GeneratorID       string
	GeneratorVersion  string
	GeneratorDigest   string
	Catalog           CatalogReference
	TemplateID        string
	TemplateVersion   string
	TemplateDigest    string
	PatternID         string
	PatternVersion    string
	PatternDigest     string
	DispatcherID      string
	DispatcherVersion string
	DispatcherDigest  string
}

var reviewedApplicationGeneratorTuples = []reviewedApplicationGeneratorTuple{
	{
		GeneratorID: HttpNoContentGeneratorID, GeneratorVersion: HttpNoContentGeneratorVersion, GeneratorDigest: HttpNoContentGeneratorDigest,
		Catalog:    CatalogReference{ID: TerraformCatalogID, Version: CurrentAwsCatalogVersion, Digest: CurrentAwsCatalogDigest},
		TemplateID: HttpNoContentTemplateID, TemplateVersion: HttpNoContentTemplateVersion, TemplateDigest: HttpNoContentTemplateDigest,
		PatternID: HttpNoContentPatternID, PatternVersion: HttpNoContentPatternVersion, PatternDigest: HttpNoContentPatternDigest,
	},
	{
		GeneratorID: ApplicationGeneratorID, GeneratorVersion: ApplicationGeneratorVersion, GeneratorDigest: ApplicationGeneratorDigest,
		Catalog:    CatalogReference{ID: TerraformCatalogID, Version: CurrentAwsCatalogVersion, Digest: CurrentAwsCatalogDigest},
		TemplateID: ApplicationTemplateID, TemplateVersion: ApplicationTemplateVersion, TemplateDigest: ApplicationTemplateDigest,
		PatternID: ApplicationPatternID, PatternVersion: ApplicationPatternVersion, PatternDigest: ApplicationPatternDigest,
	},
	{
		GeneratorID: EventApplicationGeneratorID, GeneratorVersion: EventApplicationGeneratorVersion, GeneratorDigest: EventApplicationGeneratorDigest,
		Catalog:    CatalogReference{ID: TerraformCatalogID, Version: CurrentAwsCatalogVersion, Digest: CurrentAwsCatalogDigest},
		TemplateID: EventApplicationTemplateID, TemplateVersion: EventApplicationTemplateVersion, TemplateDigest: EventApplicationTemplateDigest,
		PatternID: EventApplicationPatternID, PatternVersion: EventApplicationPatternVersion, PatternDigest: EventApplicationPatternDigest, DispatcherID: EventApplicationDispatcherID, DispatcherVersion: EventApplicationDispatcherVersion, DispatcherDigest: EventApplicationDispatcherDigest,
	},
}

func reviewedGeneratorDigest(tool ToolReference) (string, bool) {
	for _, tuple := range reviewedApplicationGeneratorTuples {
		if tuple.GeneratorID == tool.ID && tuple.GeneratorVersion == tool.Version {
			return tuple.GeneratorDigest, true
		}
	}
	return "", false
}

func reviewedGeneratorTuple(tool ToolReference, catalog CatalogReference) (reviewedApplicationGeneratorTuple, bool) {
	for _, tuple := range reviewedApplicationGeneratorTuples {
		if tuple.GeneratorID == tool.ID &&
			tuple.GeneratorVersion == tool.Version &&
			tuple.GeneratorDigest == tool.Digest &&
			tuple.Catalog.ID == catalog.ID &&
			tuple.Catalog.Version == catalog.Version &&
			tuple.Catalog.Digest == catalog.Digest {
			return tuple, true
		}
	}
	return reviewedApplicationGeneratorTuple{}, false
}

func reviewedGenerator(tool ToolReference) bool {
	digest, ok := reviewedGeneratorDigest(tool)
	return ok && tool.Digest == digest
}

func validateGeneratorCompatibility(registry CompatibilityRegistry, decoded *decodedRequest, collector *diagnosticCollector) {
	if decoded.solution == nil || decoded.solution.Versions.ApplicationGenerator.State != "pinned" {
		return
	}
	pinned := decoded.solution.Versions.ApplicationGenerator.Tool
	reviewedDigest, reviewedIdentity := reviewedGeneratorDigest(pinned)
	if reviewedIdentity && pinned.Digest != reviewedDigest {
		collector.addError(
			"COMPAT_GENERATOR_UNAVAILABLE",
			"A reviewed application-generator identity cannot be rebound to a different descriptor digest.",
			SourceReference{Document: DocumentSolutionRevision, Path: "$.versions.applicationGenerator.tool"},
		)
		return
	}
	availableMatches := 0
	for _, generator := range registry.ApplicationGenerators {
		if pinned.Digest != "" && generator.ID == pinned.ID && generator.Version == pinned.Version && generator.Digest == pinned.Digest {
			availableMatches++
		}
	}
	if availableMatches != 1 {
		collector.addError(
			"COMPAT_GENERATOR_UNAVAILABLE",
			"Solution Revision must pin exactly one available application generator by ID, version, and digest.",
			SourceReference{Document: DocumentSolutionRevision, Path: "$.versions.applicationGenerator.tool"},
		)
		return
	}
	builtInGenerator := reviewedGenerator(pinned)
	catalog := decoded.architecture.Catalog
	tuple, tupleAvailable := reviewedGeneratorTuple(pinned, catalog)
	if builtInGenerator && !tupleAvailable {
		collector.addError(
			"COMPAT_GENERATOR_CATALOG_MISMATCH",
			"The reviewed application generator requires its exact catalog, template, pattern, and descriptor tuple.",
			SourceReference{Document: DocumentArchitecture, Path: "$.catalog"},
		)
	}
	for workloadIndex, workload := range decoded.workload.Workloads {
		if builtInGenerator && tupleAvailable {
			validateBuiltInApplicationMatrix(decoded.architecture, workload, workloadIndex, tuple, collector)
		}
		if workload.Implementation.Mode != "generated-starter" && workload.Implementation.Mode != "complete-supported-pattern" {
			continue
		}
		compatibleMatches := generatorCompatibilityMatches(pinned, catalog, workload)
		if compatibleMatches != 1 {
			collector.addError(
				"COMPAT_WORKLOAD_GENERATOR_MISMATCH",
				"A generated workload must declare exactly one compatible application-generator template.",
				SourceReference{Document: DocumentWorkload, Path: fmt.Sprintf("$.workloads[%d].compatibility.applicationGenerators", workloadIndex), WorkloadID: workload.ID},
			)
		}
	}
}

func generatorCompatibilityMatches(pinned ToolReference, catalog CatalogReference, workload workloadWire) int {
	matches := 0
	for _, declaration := range workload.Compatibility.ApplicationGenerators {
		compatible := generatorCompatibilityDeclarationMatches(pinned, catalog, workload, declaration)
		if compatible {
			matches++
		}
	}
	return matches
}

func generatorCompatibilityDeclarationMatches(pinned ToolReference, catalog CatalogReference, workload workloadWire, declaration workloadGeneratorCompatibilityWire) bool {
	compatible := declaration.GeneratorID == pinned.ID &&
		containsString(declaration.SupportedModes, workload.Implementation.Mode) &&
		versionInRange(pinned.Version, declaration.MinimumVersion, declaration.MaximumVersionExclusive)
	if !reviewedGenerator(pinned) {
		return compatible
	}
	tuple, ok := reviewedGeneratorTuple(pinned, catalog)
	return compatible &&
		ok &&
		declaration.MinimumVersion == tuple.GeneratorVersion &&
		declaration.MaximumVersionExclusive == "" &&
		declaration.TemplateID == tuple.TemplateID &&
		declaration.TemplateVersion == tuple.TemplateVersion
}

func validateBuiltInApplicationMatrix(architecture architectureWire, workload workloadWire, workloadIndex int, tuple reviewedApplicationGeneratorTuple, collector *diagnosticCollector) {
	mode := workload.Implementation.Mode
	if tuple.GeneratorID == HttpNoContentGeneratorID && mode != "complete-supported-pattern" {
		collector.addError("COMPAT_WORKLOAD_GENERATOR_MISMATCH", "The reviewed no-content generator requires explicit complete-supported-pattern mode.", SourceReference{Document: DocumentWorkload, Path: fmt.Sprintf("$.workloads[%d].implementation", workloadIndex), WorkloadID: workload.ID})
		return
	}
	if mode != "generated-starter" && mode != "complete-supported-pattern" && mode != "ai-assisted-custom" {
		return
	}

	runtimeMatches := workload.Implementation.RuntimeFamily == ApplicationRuntimeFamily &&
		workload.LanguageFamily == ApplicationLanguageFamily &&
		workload.Implementation.Handler == ApplicationLambdaHandler
	ownerMatches := false
	for _, node := range architecture.Nodes {
		if node.ID != workload.OwningNodeID {
			continue
		}
		runtime, runtimeOK := literalConfigurationString(node.Semantic.Configuration, "runtime")
		handler, handlerOK := literalConfigurationString(node.Semantic.Configuration, "handler")
		ownerMatches = node.Semantic.ServiceType == "aws.lambda.function" &&
			node.Semantic.ResourceType == "aws.lambda.function" && runtimeOK && handlerOK &&
			runtime == ApplicationLambdaRuntime && handler == ApplicationLambdaHandler
		break
	}
	if !runtimeMatches || !ownerMatches {
		collector.addError(
			"COMPAT_WORKLOAD_RUNTIME_MISMATCH",
			"The reviewed application generator requires the exact Node.js 24 TypeScript runtime, Lambda handler, and owning Lambda configuration.",
			SourceReference{Document: DocumentWorkload, Path: fmt.Sprintf("$.workloads[%d].implementation", workloadIndex), WorkloadID: workload.ID},
		)
	}

	if mode == "complete-supported-pattern" {
		pattern := workload.Implementation.SupportedPattern
		if pattern == nil || pattern.PatternID != tuple.PatternID || pattern.PatternVersion != tuple.PatternVersion || pattern.Digest != tuple.PatternDigest {
			collector.addError(
				"COMPAT_WORKLOAD_PATTERN_MISMATCH",
				"Complete generation requires the exact reviewed pattern ID, version, and digest from the selected compatibility tuple.",
				SourceReference{Document: DocumentWorkload, Path: fmt.Sprintf("$.workloads[%d].implementation.supportedPattern", workloadIndex), WorkloadID: workload.ID},
			)
		}
	}
	if tuple.DispatcherID != "" &&
		(workload.TriggerDispatch.Mode != "generated-supported" ||
			workload.TriggerDispatch.DispatcherID != tuple.DispatcherID ||
			workload.TriggerDispatch.DispatcherVersion != tuple.DispatcherVersion ||
			len(workload.Operations) != 1 ||
			workload.TriggerDispatch.DispatcherOperationID != workload.Operations[0].ID) {
		collector.addError(
			"COMPAT_WORKLOAD_DISPATCHER_MISMATCH",
			"Curated event generation requires the exact reviewed dispatcher and its explicit sole operation; implicit or guessed dispatch is forbidden.",
			SourceReference{Document: DocumentWorkload, Path: fmt.Sprintf("$.workloads[%d].triggerDispatch", workloadIndex), WorkloadID: workload.ID},
		)
	}
}

func literalConfigurationString(configuration configurationWire, key string) (string, bool) {
	value, exists := configuration.Values[key]
	if !exists || value.Kind != "string" {
		return "", false
	}
	literal, ok := value.Value.(string)
	return literal, ok
}

type semanticVersion struct {
	major      int
	minor      int
	patch      int
	prerelease []string
}

func parseSemanticVersion(value string) (semanticVersion, bool) {
	withoutBuild := strings.SplitN(value, "+", 2)[0]
	parts := strings.SplitN(withoutBuild, "-", 2)
	core := strings.Split(parts[0], ".")
	if len(core) != 3 {
		return semanticVersion{}, false
	}
	numbers := make([]int, 3)
	for index, part := range core {
		parsed, err := strconv.Atoi(part)
		if err != nil || parsed < 0 {
			return semanticVersion{}, false
		}
		numbers[index] = parsed
	}
	version := semanticVersion{major: numbers[0], minor: numbers[1], patch: numbers[2]}
	if len(parts) == 2 {
		version.prerelease = strings.Split(parts[1], ".")
	}
	return version, true
}

func versionInRange(value string, minimum string, maximumExclusive string) bool {
	parsedValue, valueOK := parseSemanticVersion(value)
	parsedMinimum, minimumOK := parseSemanticVersion(minimum)
	if !valueOK || !minimumOK || compareSemanticVersion(parsedValue, parsedMinimum) < 0 {
		return false
	}
	if maximumExclusive == "" {
		return true
	}
	parsedMaximum, maximumOK := parseSemanticVersion(maximumExclusive)
	return maximumOK && compareSemanticVersion(parsedValue, parsedMaximum) < 0
}

func compareSemanticVersion(left semanticVersion, right semanticVersion) int {
	leftCore := []int{left.major, left.minor, left.patch}
	rightCore := []int{right.major, right.minor, right.patch}
	for index := range leftCore {
		if leftCore[index] < rightCore[index] {
			return -1
		}
		if leftCore[index] > rightCore[index] {
			return 1
		}
	}
	if len(left.prerelease) == 0 && len(right.prerelease) == 0 {
		return 0
	}
	if len(left.prerelease) == 0 {
		return 1
	}
	if len(right.prerelease) == 0 {
		return -1
	}
	length := len(left.prerelease)
	if len(right.prerelease) < length {
		length = len(right.prerelease)
	}
	for index := 0; index < length; index++ {
		leftIdentifier := left.prerelease[index]
		rightIdentifier := right.prerelease[index]
		leftNumber, leftNumeric := numericIdentifier(leftIdentifier)
		rightNumber, rightNumeric := numericIdentifier(rightIdentifier)
		if leftNumeric && rightNumeric {
			if leftNumber < rightNumber {
				return -1
			}
			if leftNumber > rightNumber {
				return 1
			}
			continue
		}
		if leftNumeric != rightNumeric {
			if leftNumeric {
				return -1
			}
			return 1
		}
		if leftIdentifier < rightIdentifier {
			return -1
		}
		if leftIdentifier > rightIdentifier {
			return 1
		}
	}
	if len(left.prerelease) < len(right.prerelease) {
		return -1
	}
	if len(left.prerelease) > len(right.prerelease) {
		return 1
	}
	return 0
}

func numericIdentifier(value string) (int, bool) {
	parsed, err := strconv.Atoi(value)
	return parsed, err == nil
}

func containsInt(values []int, expected int) bool {
	for _, value := range values {
		if value == expected {
			return true
		}
	}
	return false
}

func containsString(values []string, expected string) bool {
	for _, value := range values {
		if value == expected {
			return true
		}
	}
	return false
}

func isCurrentAwsCatalog(c CatalogReference) bool {
	return c.ID == TerraformCatalogID && c.Version == CurrentAwsCatalogVersion && c.Digest == CurrentAwsCatalogDigest
}
