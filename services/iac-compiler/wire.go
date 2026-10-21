package compiler

import "encoding/json"

type architectureWire struct {
	Kind                   string                    `json:"kind"`
	SchemaVersion          int                       `json:"schemaVersion"`
	DocumentID             string                    `json:"documentId"`
	ArchitectureID         string                    `json:"architectureId"`
	Revision               revisionWire              `json:"revision"`
	Provider               providerWire              `json:"provider"`
	Catalog                CatalogReference          `json:"catalog"`
	CompilerCompatibility  compilerCompatibilityWire `json:"compilerCompatibility"`
	Nodes                  []nodeWire                `json:"nodes"`
	Edges                  []edgeWire                `json:"edges"`
	Variables              []variableWire            `json:"variables"`
	Outputs                []outputWire              `json:"outputs"`
	Assumptions            []identifiedWire          `json:"assumptions"`
	UnresolvedRequirements []identifiedWire          `json:"unresolvedRequirements"`
	WorkloadBehavior       workloadBehaviorWire      `json:"workloadBehavior"`
	ApplicationContracts   json.RawMessage           `json:"applicationContracts"`
	ExternalResources      json.RawMessage           `json:"externalResources"`
}

type revisionWire struct {
	RevisionID         string `json:"revisionId"`
	RevisionNumber     int    `json:"revisionNumber"`
	CreatedAt          string `json:"createdAt"`
	CreatedBy          string `json:"createdBy"`
	SourceDraftID      string `json:"sourceDraftId,omitempty"`
	PreviousRevisionID string `json:"previousRevisionId,omitempty"`
}

type providerWire struct {
	ID     string `json:"id"`
	Region string `json:"region"`
}

type compilerCompatibilityWire struct {
	InputContractVersion            int    `json:"inputContractVersion"`
	MinimumCompilerVersion          string `json:"minimumCompilerVersion"`
	MaximumCompilerVersionExclusive string `json:"maximumCompilerVersionExclusive,omitempty"`
}

type nodeWire struct {
	ID       string           `json:"id"`
	Semantic nodeSemanticWire `json:"semantic"`
}

type nodeSemanticWire struct {
	DeploymentKey string            `json:"deploymentKey"`
	ServiceType   string            `json:"serviceType"`
	ResourceType  string            `json:"resourceType"`
	Configuration configurationWire `json:"configuration"`
	Parent        *parentWire       `json:"parent,omitempty"`
	Lifecycle     lifecycleWire     `json:"lifecycle"`
}

type parentWire struct {
	NodeID           string `json:"nodeId"`
	RelationshipType string `json:"relationshipType"`
}

type edgeWire struct {
	ID       string           `json:"id"`
	Semantic edgeSemanticWire `json:"semantic"`
}

type edgeSemanticWire struct {
	Source           endpointWire      `json:"source"`
	Target           endpointWire      `json:"target"`
	RelationshipType string            `json:"relationshipType"`
	Configuration    configurationWire `json:"configuration"`
	Lifecycle        lifecycleWire     `json:"lifecycle"`
}

type endpointWire struct {
	NodeID string `json:"nodeId"`
	Port   string `json:"port"`
}

type configurationWire struct {
	SchemaID      string                            `json:"schemaId"`
	SchemaVersion string                            `json:"schemaVersion"`
	Values        map[string]configurationValueWire `json:"values"`
}

type configurationValueWire struct {
	Kind       string `json:"kind"`
	Value      any    `json:"value,omitempty"`
	NodeID     string `json:"nodeId,omitempty"`
	Attribute  string `json:"attribute,omitempty"`
	VariableID string `json:"variableId,omitempty"`
	Reference  string `json:"reference,omitempty"`
}

type lifecycleWire struct {
	Ownership  string                   `json:"ownership"`
	Origin     string                   `json:"origin"`
	Provenance *generatedProvenanceWire `json:"provenance,omitempty"`
	AdoptedBy  string                   `json:"adoptedBy,omitempty"`
	AdoptedAt  string                   `json:"adoptedAt,omitempty"`
}

type generatedProvenanceWire struct {
	GeneratorKind    string   `json:"generatorKind"`
	GeneratorID      string   `json:"generatorId"`
	GeneratorVersion string   `json:"generatorVersion"`
	OperationID      string   `json:"operationId"`
	DependentNodeIDs []string `json:"dependentNodeIds"`
	DependentEdgeIDs []string `json:"dependentEdgeIds"`
}

type variableWire struct {
	ID           string                  `json:"id"`
	Key          string                  `json:"key"`
	ValueType    string                  `json:"valueType"`
	Required     bool                    `json:"required"`
	DefaultValue *configurationValueWire `json:"defaultValue,omitempty"`
}

type outputWire struct {
	ID        string           `json:"id"`
	Key       string           `json:"key"`
	Sensitive bool             `json:"sensitive"`
	Source    outputSourceWire `json:"source"`
}

type outputSourceWire struct {
	Kind       string `json:"kind"`
	NodeID     string `json:"nodeId,omitempty"`
	Attribute  string `json:"attribute,omitempty"`
	VariableID string `json:"variableId,omitempty"`
}

type identifiedWire struct {
	ID string `json:"id"`
}

type workloadBehaviorWire struct {
	ContractVersion int            `json:"contractVersion"`
	Workloads       []workloadWire `json:"workloads"`
}

type workloadWire struct {
	ID                         string                                  `json:"id"`
	OwningNodeID               string                                  `json:"owningNodeId"`
	Implementation             workloadImplementationWire              `json:"implementation"`
	LanguageFamily             string                                  `json:"languageFamily,omitempty"`
	Operations                 []workloadOperationWire                 `json:"operations"`
	Triggers                   []workloadTriggerWire                   `json:"triggers"`
	DownstreamActions          []workloadDownstreamWire                `json:"downstreamActions"`
	Environment                []workloadEnvironmentWire               `json:"environment"`
	TriggerDispatch            workloadTriggerDispatchWire             `json:"triggerDispatch"`
	UnresolvedRequirementIDs   []string                                `json:"unresolvedRequirementIds"`
	Entrypoints                []workloadEntrypointWire                `json:"entrypoints"`
	HTTPRoutes                 []workloadHTTPRouteWire                 `json:"httpRoutes"`
	EventBindings              []workloadEventBindingWire              `json:"eventBindings"`
	Schedules                  []workloadScheduleWire                  `json:"schedules"`
	DataBindings               []workloadDataBindingWire               `json:"dataBindings"`
	Authorization              []workloadAuthorizationWire             `json:"authorization"`
	Idempotency                []workloadIdempotencyWire               `json:"idempotency"`
	Observability              workloadObservabilityWire               `json:"observability"`
	SourceOwnership            []sourceOwnershipWire                   `json:"sourceOwnership"`
	ExtensionPoints            []extensionPointWire                    `json:"extensionPoints"`
	Extensions                 []workloadExtensionWire                 `json:"extensions"`
	ImplementationRequirements []workloadImplementationRequirementWire `json:"implementationRequirements"`
	Compatibility              workloadCompatibilityWire               `json:"compatibility"`
}

type workloadImplementationWire struct {
	Mode             string                 `json:"mode"`
	RuntimeFamily    string                 `json:"runtimeFamily,omitempty"`
	Handler          string                 `json:"handler,omitempty"`
	SourceOwnership  string                 `json:"sourceOwnership,omitempty"`
	Artifact         *workloadArtifactWire  `json:"artifact,omitempty"`
	SupportedPattern *supportedPatternWire  `json:"supportedPattern,omitempty"`
	Extension        *workloadExtensionWire `json:"extension,omitempty"`
}

type workloadArtifactWire struct {
	ArtifactID string `json:"artifactId"`
	Digest     string `json:"digest"`
}

type supportedPatternWire struct {
	PatternID      string `json:"patternId"`
	PatternVersion string `json:"patternVersion"`
	Digest         string `json:"digest"`
}

type workloadExtensionWire struct {
	ExtensionID           string   `json:"extensionId"`
	Digest                string   `json:"digest"`
	Ownership             string   `json:"ownership"`
	ValidationEvidenceIDs []string `json:"validationEvidenceIds"`
}

type workloadTriggerDispatchWire struct {
	Mode                  string `json:"mode"`
	DispatcherID          string `json:"dispatcherId,omitempty"`
	DispatcherVersion     string `json:"dispatcherVersion,omitempty"`
	DispatcherOperationID string `json:"dispatcherOperationId,omitempty"`
}

type workloadImplementationRequirementWire struct {
	ImplementationRequirementID string `json:"implementationRequirementId"`
	ArchitectureRequirementID   string `json:"architectureRequirementId,omitempty"`
}

type workloadOperationWire struct {
	ID             string                 `json:"id"`
	Capability     string                 `json:"capability"`
	InputContract  workloadIOContractWire `json:"inputContract"`
	OutputContract workloadIOContractWire `json:"outputContract"`
}

type workloadIOContractWire struct {
	Kind      string                 `json:"kind"`
	Reference *contractReferenceWire `json:"reference,omitempty"`
}

type contractReferenceWire struct {
	ContractID      string `json:"contractId"`
	ContractVersion string `json:"contractVersion"`
	Digest          string `json:"digest"`
	ContractKind    string `json:"contractKind,omitempty"`
}

type workloadTriggerWire struct {
	ID                string `json:"id"`
	EdgeID            string `json:"edgeId"`
	TargetOperationID string `json:"targetOperationId"`
}

type workloadDownstreamWire struct {
	ID                string `json:"id"`
	EdgeID            string `json:"edgeId"`
	SourceOperationID string `json:"sourceOperationId"`
}

type workloadEnvironmentWire struct {
	ID    string                       `json:"id"`
	Name  string                       `json:"name"`
	Value workloadEnvironmentValueWire `json:"value"`
}

type workloadEnvironmentValueWire struct {
	Kind       string `json:"kind"`
	VariableID string `json:"variableId,omitempty"`
	NodeID     string `json:"nodeId,omitempty"`
	Attribute  string `json:"attribute,omitempty"`
	Reference  string `json:"reference,omitempty"`
}

type workloadEntrypointWire struct {
	EntrypointID string `json:"entrypointId"`
	OperationID  string `json:"operationId"`
}

type workloadHTTPRouteWire struct {
	RouteID       string `json:"routeId"`
	OperationID   string `json:"operationId"`
	TriggerEdgeID string `json:"triggerEdgeId"`
}

type workloadEventBindingWire struct {
	BindingID   string `json:"bindingId"`
	OperationID string `json:"operationId"`
	EdgeID      string `json:"edgeId"`
}

type workloadScheduleWire struct {
	BindingID     string `json:"bindingId"`
	OperationID   string `json:"operationId"`
	TriggerEdgeID string `json:"triggerEdgeId,omitempty"`
}

type workloadDataBindingWire struct {
	BindingID   string `json:"bindingId"`
	OperationID string `json:"operationId"`
	EdgeID      string `json:"edgeId,omitempty"`
}

type workloadAuthorizationWire struct {
	BindingID    string   `json:"bindingId"`
	OperationIDs []string `json:"operationIds"`
}

type workloadIdempotencyWire struct {
	PolicyID     string   `json:"policyId"`
	OperationIDs []string `json:"operationIds"`
}

type workloadObservabilityWire struct {
	HealthChecks []workloadHealthCheckWire `json:"healthChecks"`
}

type workloadHealthCheckWire struct {
	HealthCheckID string `json:"healthCheckId"`
	OperationID   string `json:"operationId,omitempty"`
}

type sourceOwnershipWire struct {
	DeclarationID    string `json:"declarationId"`
	Path             string `json:"path"`
	PathKind         string `json:"pathKind"`
	Ownership        string `json:"ownership"`
	OwnerID          string `json:"ownerId"`
	Regeneration     string `json:"regeneration"`
	ConflictBehavior string `json:"conflictBehavior"`
	SemanticDiff     struct {
		Strategy          string `json:"strategy"`
		NormalizerID      string `json:"normalizerId,omitempty"`
		NormalizerVersion string `json:"normalizerVersion,omitempty"`
	} `json:"semanticDiff"`
	BaselineDigest   string `json:"baselineDigest,omitempty"`
	ExtensionPointID string `json:"extensionPointId,omitempty"`
}

type extensionPointWire struct {
	ExtensionPointID   string   `json:"extensionPointId"`
	Path               string   `json:"path"`
	Kind               string   `json:"kind"`
	PermittedOwnership []string `json:"permittedOwnership"`
	ConflictBehavior   string   `json:"conflictBehavior"`
}

type workloadCompatibilityWire struct {
	ApplicationGenerators []workloadGeneratorCompatibilityWire `json:"applicationGenerators"`
}

type workloadGeneratorCompatibilityWire struct {
	GeneratorID             string   `json:"generatorId"`
	MinimumVersion          string   `json:"minimumVersion"`
	MaximumVersionExclusive string   `json:"maximumVersionExclusive,omitempty"`
	TemplateID              string   `json:"templateId"`
	TemplateVersion         string   `json:"templateVersion"`
	SupportedModes          []string `json:"supportedModes"`
}

type solutionRevisionWire struct {
	Kind               string                         `json:"kind"`
	ContractVersion    int                            `json:"contractVersion"`
	SolutionRevisionID string                         `json:"solutionRevisionId"`
	Architecture       solutionArchitectureWire       `json:"architecture"`
	Workload           solutionWorkloadWire           `json:"workload"`
	Contracts          solutionContentHashWire        `json:"contracts"`
	ExternalResources  solutionContentHashWire        `json:"externalResources"`
	GenerationCoverage solutionGenerationCoverageWire `json:"generationCoverage"`
	Versions           solutionVersionsWire           `json:"versions"`
}

type solutionArchitectureWire struct {
	ContentHash   string `json:"contentHash"`
	DocumentHash  string `json:"documentHash"`
	VisualHash    string `json:"visualHash"`
	DocumentKind  string `json:"documentKind"`
	RevisionID    string `json:"revisionId"`
	SchemaVersion int    `json:"schemaVersion"`
}

type solutionWorkloadWire struct {
	ContentHash     string `json:"contentHash"`
	ContractVersion int    `json:"contractVersion"`
}

type solutionContentHashWire struct {
	ContentHash     string `json:"contentHash"`
	ContractVersion int    `json:"contractVersion"`
}

type solutionGenerationCoverageWire struct {
	SolutionRevisionID  string                                   `json:"solutionRevisionId"`
	State               string                                   `json:"state"`
	Evidence            []solutionGenerationCoverageEvidenceWire `json:"evidence"`
	MissingRequirements []string                                 `json:"missingRequirements"`
	Workloads           []solutionWorkloadCoverageWire           `json:"workloads"`
}

type solutionWorkloadCoverageWire struct {
	WorkloadID               string                                   `json:"workloadId"`
	State                    string                                   `json:"state"`
	Evidence                 []solutionGenerationCoverageEvidenceWire `json:"evidence"`
	MissingRequirements      []string                                 `json:"missingRequirements"`
	UnresolvedRequirementIDs []string                                 `json:"unresolvedRequirementIds"`
}

type solutionGenerationCoverageEvidenceWire struct {
	EvidenceID  string `json:"evidenceId"`
	Requirement string `json:"requirement"`
}

type solutionVersionsWire struct {
	Catalog              CatalogReference `json:"catalog"`
	Compiler             optionalToolWire `json:"compiler"`
	ApplicationGenerator optionalToolWire `json:"applicationGenerator"`
}

type optionalToolWire struct {
	State string        `json:"state"`
	Tool  ToolReference `json:"tool"`
}
