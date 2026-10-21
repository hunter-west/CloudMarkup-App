// Package compiler validates and deterministically compiles immutable
// CloudMarkup solution inputs. It deliberately owns no network client,
// credential, application source, command runner, or deployment capability.
package compiler

import (
	"context"
	"encoding/json"
	"io"
)

const (
	HttpNoContentGeneratorID            = "generator.aws.lambda.http-no-content.typescript"
	HttpNoContentGeneratorVersion       = "1.0.0"
	HttpNoContentGeneratorDigest        = "sha256:fb81f3fd00623d3d1b28c18694946f8f1818f615b6f586acf61cb68222322279"
	HttpNoContentTemplateID             = "template.aws.lambda.http-no-content.typescript"
	HttpNoContentTemplateVersion        = "1.0.0"
	HttpNoContentTemplateDigest         = "sha256:6d0e058ab58c0da704645d8ad4e40039ca52732aa1a06643b0dbff58881ba821"
	HttpNoContentPatternID              = "pattern.aws.lambda.authenticated-http-no-content"
	HttpNoContentPatternVersion         = "1.0.0"
	HttpNoContentPatternDigest          = "sha256:e13b99e92438caea30f2ec7a782d4d652095ab209cab44b51bdad29dc7f5c2f1"
	CompilerID                          = "cloudmarkup.iac-compiler"
	CompilerVersion                     = "1.2.1"
	CompilerDigest                      = "sha256:2c25a5610c825d171a167a38201c3090aa2278071ddd648bb957e67b7b98f203"
	CompilerInputContractVersion        = 1
	NormalizedModelContractVersion      = 1
	TerraformTargetContractVersion      = "1.0.0"
	CloudFormationTargetContractVersion = "1.0.0"
	ApplicationGeneratorID              = "cloudmarkup.application-generator"
	ApplicationGeneratorVersion         = "1.0.0"
	ApplicationGeneratorDigest          = "sha256:a102e772819d1d1657d89c422cd33d73912d62cabe4022b44e0cd3dd756af12e"
	ApplicationTemplateID               = "cloudmarkup.template.aws-lambda-notes-typescript"
	ApplicationTemplateVersion          = "1.0.0"
	ApplicationTemplateDigest           = "sha256:c7721961d935faa1e0c87b7356bc6d90112a02f3c7f716be33a648bf99740604"
	ApplicationPatternID                = "cloudmarkup.pattern.aws-lambda-authenticated-notes"
	ApplicationPatternVersion           = "1.0.0"
	ApplicationPatternDigest            = "sha256:cbe772e0adee53da524110278fe908d726a3e8f600588364bef33ba2fa900571"
	ApplicationRuntimeID                = "cloudmarkup.runtime.aws-lambda-nodejs24-typescript"
	ApplicationRuntimeVersion           = "1.0.0"
	ApplicationRuntimeDigest            = "sha256:6970ac7820ced534953ee1cda1b7fc083ab73fdb75e8c95c3c09967f4d3ff81a"
	EventApplicationGeneratorID         = "cloudmarkup.event-application-generator"
	EventApplicationGeneratorVersion    = "1.0.0"
	EventApplicationGeneratorDigest     = "sha256:7cf9b85f31f427ac5f4dbe095bb227c10435fc86c84d8318ff41c88d5540e391"
	EventApplicationTemplateID          = "cloudmarkup.template.aws-lambda-curated-events-typescript"
	EventApplicationTemplateVersion     = "1.0.0"
	EventApplicationTemplateDigest      = "sha256:a867606bd9806e1d56b948207ab544b5b50c61af642dfcc2382ca763da519111"
	EventApplicationPatternID           = "cloudmarkup.pattern.aws-lambda-curated-event-driven"
	EventApplicationPatternVersion      = "1.0.0"
	EventApplicationPatternDigest       = "sha256:b74c6d0c918d5dd3eac3485cb5004aece78e7dc9a9936f3ecbd85aa012a53686"
	EventApplicationDispatcherID        = "cloudmarkup.event-trigger-dispatcher"
	EventApplicationDispatcherVersion   = "1.0.0"
	EventApplicationDispatcherDigest    = "sha256:02bb3cb413a02cc1751ab78b7e58cb7793eac117c4b7bf2271e8bf63517e6656"
	ApplicationArchiveEntrypoint        = "index.js"
	ApplicationArtifactKind             = "aws-lambda-zip"
	ApplicationArtifactMediaType        = "application/zip"
	ApplicationArtifactDigestAlgorithm  = "sha256"
	ApplicationRuntimeFamily            = "aws.lambda.runtime-family.nodejs24"
	ApplicationLanguageFamily           = "cloudmarkup.language.typescript"
	ApplicationLambdaRuntime            = "nodejs24.x"
	ApplicationLambdaHandler            = "index.handler"
)

type Severity string

const (
	SeverityError   Severity = "error"
	SeverityWarning Severity = "warning"
	SeverityInfo    Severity = "info"
)

type DocumentKind string

const (
	DocumentArchitecture     DocumentKind = "architecture"
	DocumentWorkload         DocumentKind = "workload"
	DocumentSolutionRevision DocumentKind = "solution-revision"
)

// SourceReference is intentionally identifier/path based. Diagnostics never
// echo raw input values, source bodies, credentials, or secret references.
type SourceReference struct {
	Document    DocumentKind `json:"document"`
	Path        string       `json:"path,omitempty"`
	NodeID      string       `json:"nodeId,omitempty"`
	EdgeID      string       `json:"edgeId,omitempty"`
	WorkloadID  string       `json:"workloadId,omitempty"`
	OperationID string       `json:"operationId,omitempty"`
}

type Diagnostic struct {
	Code     string            `json:"code"`
	Severity Severity          `json:"severity"`
	Message  string            `json:"message"`
	Source   SourceReference   `json:"source"`
	Related  []SourceReference `json:"related,omitempty"`
}

type Limits struct {
	MaxArchitectureBytes int64
	MaxWorkloadBytes     int64
	MaxSolutionBytes     int64
	MaxJSONDepth         int
	MaxNodes             int
	MaxEdges             int
	MaxWorkloads         int
	MaxOperations        int
	MaxDiagnostics       int
	MaxNormalizedBytes   int
	MaxArtifactBytes     int
	MaxArtifactFiles     int
}

func DefaultLimits() Limits {
	return Limits{
		MaxArchitectureBytes: 4 << 20,
		MaxWorkloadBytes:     4 << 20,
		MaxSolutionBytes:     4 << 20,
		MaxJSONDepth:         64,
		MaxNodes:             2_000,
		MaxEdges:             10_000,
		MaxWorkloads:         1_000,
		MaxOperations:        10_000,
		MaxDiagnostics:       256,
		MaxNormalizedBytes:   16 << 20,
		MaxArtifactBytes:     32 << 20,
		MaxArtifactFiles:     64,
	}
}

type TargetKind string

const (
	TargetTerraform      TargetKind = "terraform"
	TargetCloudFormation TargetKind = "cloudformation"
)

type CatalogCompatibility struct {
	ID                         string   `json:"id"`
	Version                    string   `json:"version"`
	Digest                     string   `json:"digest"`
	ArchitectureSchemaVersions []int    `json:"architectureSchemaVersions"`
	PolicyResourceTypes        []string `json:"policyResourceTypes"`
}

type GeneratorCompatibility struct {
	ID      string `json:"id"`
	Version string `json:"version"`
	Digest  string `json:"digest,omitempty"`
}

// CompatibilityRegistry is caller-supplied library policy. It contains exact,
// reviewed artifacts only; no value is resolved from a network or "latest".
type CompatibilityRegistry struct {
	Catalogs              []CatalogCompatibility   `json:"catalogs"`
	ApplicationGenerators []GeneratorCompatibility `json:"applicationGenerators"`
}

func DefaultCompatibilityRegistry() CompatibilityRegistry {
	return CompatibilityRegistry{
		Catalogs: []CatalogCompatibility{{
			ID: TerraformCatalogID, Version: CurrentAwsCatalogVersion, Digest: CurrentAwsCatalogDigest,
			ArchitectureSchemaVersions: []int{3},
			PolicyResourceTypes:        []string{"aws.iam.managed-policy-attachment", "aws.iam.policy-condition", "aws.iam.policy-document", "aws.iam.policy-statement"},
		}, {
			ID: "example.cloud.catalog", Version: "2.0.0", Digest: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
			ArchitectureSchemaVersions: []int{3},
		}},
		ApplicationGenerators: []GeneratorCompatibility{
			{ID: HttpNoContentGeneratorID, Version: HttpNoContentGeneratorVersion, Digest: HttpNoContentGeneratorDigest},
			{ID: ApplicationGeneratorID, Version: ApplicationGeneratorVersion, Digest: ApplicationGeneratorDigest},
			{ID: EventApplicationGeneratorID, Version: EventApplicationGeneratorVersion, Digest: EventApplicationGeneratorDigest},
		},
	}
}

type Request struct {
	Architecture     []byte
	Workload         []byte
	SolutionRevision []byte
	Target           TargetKind
	Compatibility    CompatibilityRegistry
	Limits           Limits
}

type ReaderRequest struct {
	Architecture     io.Reader
	Workload         io.Reader
	SolutionRevision io.Reader
	Target           TargetKind
	Compatibility    CompatibilityRegistry
	Limits           Limits
}

type Result struct {
	ContractVersion int                 `json:"contractVersion"`
	Compiler        ToolReference       `json:"compiler"`
	Model           *NormalizedSolution `json:"model,omitempty"`
	Diagnostics     []Diagnostic        `json:"diagnostics"`
}

func (result Result) Succeeded() bool {
	for _, diagnostic := range result.Diagnostics {
		if diagnostic.Severity == SeverityError {
			return false
		}
	}
	return result.Model != nil
}

type ToolReference struct {
	ID      string `json:"id"`
	Version string `json:"version"`
	Digest  string `json:"digest,omitempty"`
}

type CatalogReference struct {
	ID      string `json:"id"`
	Version string `json:"version"`
	Digest  string `json:"digest"`
}

type SolutionProvenance struct {
	ArchitectureDocumentID   string           `json:"architectureDocumentId"`
	ArchitectureID           string           `json:"architectureId"`
	ArchitectureRevisionID   string           `json:"architectureRevisionId"`
	ArchitectureContentHash  string           `json:"architectureContentHash"`
	ArchitectureDocumentHash string           `json:"architectureDocumentHash"`
	ArchitectureVisualHash   string           `json:"architectureVisualHash"`
	WorkloadContentHash      string           `json:"workloadContentHash"`
	SolutionRevisionID       string           `json:"solutionRevisionId,omitempty"`
	ProviderID               string           `json:"providerId"`
	Region                   string           `json:"region"`
	Catalog                  CatalogReference `json:"catalog"`
}

type ConfigurationValue struct {
	Kind       string `json:"kind"`
	Value      any    `json:"value,omitempty"`
	NodeID     string `json:"nodeId,omitempty"`
	Attribute  string `json:"attribute,omitempty"`
	VariableID string `json:"variableId,omitempty"`
	Reference  string `json:"reference,omitempty"`
}

type Configuration struct {
	SchemaID      string                        `json:"schemaId"`
	SchemaVersion string                        `json:"schemaVersion"`
	Values        map[string]ConfigurationValue `json:"values"`
}

type GeneratedProvenance struct {
	GeneratorKind    string   `json:"generatorKind"`
	GeneratorID      string   `json:"generatorId"`
	GeneratorVersion string   `json:"generatorVersion"`
	OperationID      string   `json:"operationId"`
	DependentNodeIDs []string `json:"dependentNodeIds"`
	DependentEdgeIDs []string `json:"dependentEdgeIds"`
}

type Lifecycle struct {
	Ownership  string               `json:"ownership"`
	Origin     string               `json:"origin"`
	Provenance *GeneratedProvenance `json:"provenance,omitempty"`
	AdoptedBy  string               `json:"adoptedBy,omitempty"`
}

type ResourceReference struct {
	NodeID           string `json:"nodeId"`
	TargetKey        string `json:"targetKey"`
	RelationshipType string `json:"relationshipType,omitempty"`
	Port             string `json:"port,omitempty"`
	Attribute        string `json:"attribute,omitempty"`
}

type NormalizedResource struct {
	ID            string             `json:"id"`
	TargetKey     string             `json:"targetKey"`
	DeploymentKey string             `json:"deploymentKey"`
	ServiceType   string             `json:"serviceType"`
	ResourceType  string             `json:"resourceType"`
	Parent        *ResourceReference `json:"parent,omitempty"`
	Configuration Configuration      `json:"configuration"`
	Lifecycle     Lifecycle          `json:"lifecycle"`
	WorkloadIDs   []string           `json:"workloadIds"`
}

type NormalizedConnection struct {
	ID               string            `json:"id"`
	Source           ResourceReference `json:"source"`
	Target           ResourceReference `json:"target"`
	RelationshipType string            `json:"relationshipType"`
	Configuration    Configuration     `json:"configuration"`
	Lifecycle        Lifecycle         `json:"lifecycle"`
}

type PolicyAttachment struct {
	ResourceID      string               `json:"resourceId"`
	TargetKey       string               `json:"targetKey"`
	ResourceType    string               `json:"resourceType"`
	Ownership       string               `json:"ownership"`
	OwnerReferences []ResourceReference  `json:"ownerReferences"`
	Configuration   Configuration        `json:"configuration"`
	Provenance      *GeneratedProvenance `json:"provenance,omitempty"`
}

type EnvironmentBinding struct {
	ID              string             `json:"id"`
	Name            string             `json:"name"`
	Kind            string             `json:"kind"`
	VariableID      string             `json:"variableId,omitempty"`
	Resource        *ResourceReference `json:"resource,omitempty"`
	SecretReference string             `json:"secretReference,omitempty"`
}

type ContractReference struct {
	ContractID      string `json:"contractId"`
	ContractVersion string `json:"contractVersion"`
	Digest          string `json:"digest"`
	ContractKind    string `json:"contractKind,omitempty"`
}

type OperationBinding struct {
	ID             string             `json:"id"`
	Capability     string             `json:"capability"`
	InputContract  *ContractReference `json:"inputContract,omitempty"`
	OutputContract *ContractReference `json:"outputContract,omitempty"`
}

type TriggerBinding struct {
	ID          string                `json:"id"`
	Kind        string                `json:"kind"`
	EdgeID      string                `json:"edgeId,omitempty"`
	OperationID string                `json:"operationId"`
	Connection  *NormalizedConnection `json:"connection,omitempty"`
}

type SourceOwnership struct {
	DeclarationID     string `json:"declarationId"`
	Path              string `json:"path"`
	PathKind          string `json:"pathKind"`
	Ownership         string `json:"ownership"`
	OwnerID           string `json:"ownerId"`
	Regeneration      string `json:"regeneration"`
	ConflictBehavior  string `json:"conflictBehavior"`
	SemanticDiff      string `json:"semanticDiff"`
	NormalizerID      string `json:"normalizerId,omitempty"`
	NormalizerVersion string `json:"normalizerVersion,omitempty"`
	BaselineDigest    string `json:"baselineDigest,omitempty"`
	ExtensionPointID  string `json:"extensionPointId,omitempty"`
}

type ExtensionPoint struct {
	ID                 string   `json:"id"`
	Path               string   `json:"path"`
	Kind               string   `json:"kind"`
	PermittedOwnership []string `json:"permittedOwnership"`
	ConflictBehavior   string   `json:"conflictBehavior"`
}

type ArtifactReference struct {
	ArtifactID string `json:"artifactId"`
	Digest     string `json:"digest"`
	Kind       string `json:"kind"`
	Ownership  string `json:"ownership"`
	WorkloadID string `json:"workloadId"`
	MediaType  string `json:"mediaType,omitempty"`
}

type GeneratorReadiness struct {
	State           string         `json:"state"`
	Generator       *ToolReference `json:"generator,omitempty"`
	TemplateID      string         `json:"templateId,omitempty"`
	TemplateVersion string         `json:"templateVersion,omitempty"`
	Reasons         []string       `json:"reasons"`
}

type NormalizedWorkload struct {
	ID                 string               `json:"id"`
	OwningResource     ResourceReference    `json:"owningResource"`
	ImplementationMode string               `json:"implementationMode"`
	RuntimeFamily      string               `json:"runtimeFamily,omitempty"`
	LanguageFamily     string               `json:"languageFamily,omitempty"`
	Handler            string               `json:"handler,omitempty"`
	SourceOwner        string               `json:"sourceOwner,omitempty"`
	Operations         []OperationBinding   `json:"operations"`
	Triggers           []TriggerBinding     `json:"triggers"`
	DownstreamActions  []TriggerBinding     `json:"downstreamActions"`
	Environment        []EnvironmentBinding `json:"environment"`
	ArtifactInputs     []ArtifactReference  `json:"artifactInputs"`
	ArtifactOutputs    []ArtifactReference  `json:"artifactOutputs"`
	SourceOwnership    []SourceOwnership    `json:"sourceOwnership"`
	ExtensionPoints    []ExtensionPoint     `json:"extensionPoints"`
	GenerationCoverage string               `json:"generationCoverage"`
	TargetReadiness    string               `json:"targetReadiness"`
	GeneratorReadiness GeneratorReadiness   `json:"generatorReadiness"`
	Specification      json.RawMessage      `json:"specification"`
}

type TargetReadiness struct {
	Target             TargetKind `json:"target"`
	ContractVersion    string     `json:"contractVersion"`
	State              string     `json:"state"`
	RenderingAvailable bool       `json:"renderingAvailable"`
	Reasons            []string   `json:"reasons"`
}

type NormalizedSolution struct {
	ContractVersion   int                          `json:"contractVersion"`
	Target            TargetReadiness              `json:"target"`
	Provenance        SolutionProvenance           `json:"provenance"`
	Resources         []NormalizedResource         `json:"resources"`
	Connections       []NormalizedConnection       `json:"connections"`
	PolicyAttachments []PolicyAttachment           `json:"policyAttachments"`
	Variables         []NormalizedVariable         `json:"variables"`
	Outputs           []NormalizedOutput           `json:"outputs"`
	Workloads         []NormalizedWorkload         `json:"workloads"`
	ExternalResources []NormalizedExternalResource `json:"externalResources"`
}

// Target is the renderer-independent extension point. Implementations consume
// only the normalized model and cannot execute tools, inspect source, or deploy.
type Target interface {
	Descriptor() TargetDescriptor
	Assess(context.Context, *NormalizedSolution) TargetReadiness
	Render(context.Context, *NormalizedSolution, []TargetExtensionReference, Limits) (*TargetArtifact, []Diagnostic)
}

type TargetDescriptor struct {
	Kind               TargetKind `json:"kind"`
	ContractVersion    string     `json:"contractVersion"`
	RenderingAvailable bool       `json:"renderingAvailable"`
}

// ApplicationGenerator is a separate source-generation boundary reserved for
// Prompt 29A. No implementation is registered by this compiler foundation.
type ApplicationGenerator interface {
	Descriptor() ApplicationGeneratorDescriptor
	Generate(context.Context, ApplicationGenerationRequest) (ApplicationGenerationResult, error)
}

type ApplicationGeneratorDescriptor struct {
	ID      string `json:"id"`
	Version string `json:"version"`
}

type ApplicationGenerationRequest struct {
	SolutionRevisionID string              `json:"solutionRevisionId"`
	Workload           NormalizedWorkload  `json:"workload"`
	Inputs             []ArtifactReference `json:"inputs"`
}

type ApplicationGenerationResult struct {
	Outputs     []ArtifactReference `json:"outputs"`
	Diagnostics []Diagnostic        `json:"diagnostics"`
}
