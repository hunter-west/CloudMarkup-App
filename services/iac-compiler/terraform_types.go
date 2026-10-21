package compiler

const (
	CurrentAwsCatalogVersion                        = "0.30.0"
	CurrentAwsCatalogDigest                         = "sha256:8e9b1b23bbcdf723352044baddd8e79468d70ed5a719af914036992daf91fb94"
	TerraformArtifactContractVersion                = 1
	TargetArtifactContractVersion                   = TerraformArtifactContractVersion
	ApplicationArtifactContractVersion              = 1
	ApplicationArtifactTargetNeutralContractVersion = 2
	TerraformFormatVersion                          = "1.0.0"
	TerraformRequiredVersion                        = ">= 1.5.0, < 2.0.0"
	TerraformAWSProviderSource                      = "hashicorp/aws"
	TerraformAWSProviderVersion                     = ">= 6.55.0, < 7.0.0"
	TerraformCatalogID                              = "aws.cloudmarkup.notes-api-catalog"
	// Exact immutable AWS networking catalog identity accepted by this compiler.
	// Exact immutable AWS event application-generation catalog identity accepted by this compiler.
	CloudFormationFormatVersion                = "1.0.0"
	CloudFormationTemplateSpecificationVersion = "2010-09-09"
	CloudFormationTemplateFormat               = "json"
	CloudFormationCatalogID                    = TerraformCatalogID
	// Historical aliases preserve the exact application-generator contract.
)

type TerraformProviderConstraint struct {
	Source  string `json:"source"`
	Version string `json:"version"`
}

type TerraformCompilerMetadata struct {
	FormatVersion                string                        `json:"formatVersion"`
	RequiredTerraformVersion     string                        `json:"requiredTerraformVersion,omitempty"`
	Providers                    []TerraformProviderConstraint `json:"providers,omitempty"`
	TemplateSpecificationVersion string                        `json:"templateSpecificationVersion,omitempty"`
	TemplateFormat               string                        `json:"templateFormat,omitempty"`
	LocalValidation              string                        `json:"localValidation,omitempty"`
}

// TargetExtensionReference reserves the bounded Prompt 36A handoff. Prompt 29
// accepts the contract shape but rejects every non-empty extension collection.
type TargetExtensionReference struct {
	ContractVersion int        `json:"contractVersion"`
	ExtensionID     string     `json:"extensionId"`
	Target          TargetKind `json:"target"`
	Path            string     `json:"path"`
	Ownership       string     `json:"ownership"`
	Digest          string     `json:"digest"`
	EvidenceIDs     []string   `json:"evidenceIds"`
	Approved        bool       `json:"approved"`
}

type CompileRequest struct {
	Request          Request
	TargetExtensions []TargetExtensionReference
}

type CompileReaderRequest struct {
	Request          ReaderRequest
	TargetExtensions []TargetExtensionReference
}
type CompilationResult struct {
	ContractVersion int                 `json:"contractVersion"`
	Compiler        ToolReference       `json:"compiler"`
	Model           *NormalizedSolution `json:"model,omitempty"`
	Artifact        *TargetArtifact     `json:"artifact,omitempty"`
	Diagnostics     []Diagnostic        `json:"diagnostics"`
}

func (result CompilationResult) Succeeded() bool {
	if result.Artifact == nil || result.Model == nil {
		return false
	}
	for _, diagnostic := range result.Diagnostics {
		if diagnostic.Severity == SeverityError {
			return false
		}
	}
	return true
}

type TargetArtifact struct {
	ContractVersion      int                           `json:"contractVersion"`
	Target               TargetKind                    `json:"target"`
	FormatVersion        string                        `json:"formatVersion"`
	Provenance           SolutionProvenance            `json:"provenance"`
	Metadata             TerraformCompilerMetadata     `json:"metadata"`
	Files                []TargetFile                  `json:"files"`
	ApplicationArtifacts []ApplicationArtifactContract `json:"applicationArtifacts"`
	PolicyArtifacts      []PolicyArtifactContract      `json:"policyArtifacts"`
	Digest               string                        `json:"digest"`
}

type TargetFile struct {
	Path      string `json:"path"`
	MediaType string `json:"mediaType"`
	Ownership string `json:"ownership"`
	Content   string `json:"content"`
	Digest    string `json:"digest"`
}

type PolicyArtifactContract struct {
	PolicyDocumentID string               `json:"policyDocumentId"`
	OwnerNodeID      string               `json:"ownerNodeId"`
	PolicyKind       string               `json:"policyKind"`
	Ownership        string               `json:"ownership"`
	RenderedAs       string               `json:"renderedAs"`
	Provenance       *GeneratedProvenance `json:"provenance,omitempty"`
}
type ApplicationArtifactContract struct {
	ContractVersion     int                                       `json:"contractVersion"`
	WorkloadID          string                                    `json:"workloadId"`
	ImplementationMode  string                                    `json:"implementationMode"`
	Delivery            string                                    `json:"delivery"`
	RelativePackagePath string                                    `json:"relativePackagePath,omitempty"`
	Variables           []ArtifactInputVariable                   `json:"variables"`
	ExpectedArtifact    *TargetNeutralApplicationArtifactContract `json:"expectedArtifact,omitempty"`
	ArtifactReadiness   string                                    `json:"artifactReadiness,omitempty"`
	Inputs              []ArtifactReference                       `json:"inputs"`
	GenerationCoverage  string                                    `json:"generationCoverage"`
	CodeRequired        bool                                      `json:"codeRequired"`
}

// TargetNeutralApplicationArtifactContract describes the final package without
// coupling future IaC targets to Terraform variables or HCL.
type TargetNeutralApplicationArtifactContract struct {
	ArtifactID        string                                  `json:"artifactId"`
	Kind              string                                  `json:"kind"`
	MediaType         string                                  `json:"mediaType"`
	Path              string                                  `json:"path"`
	ArchiveEntrypoint string                                  `json:"archiveEntrypoint"`
	Handler           string                                  `json:"handler"`
	DigestAlgorithm   string                                  `json:"digestAlgorithm"`
	Runtime           TargetNeutralApplicationRuntimeContract `json:"runtime"`
}

type TargetNeutralApplicationRuntimeContract struct {
	ID             string `json:"id"`
	Version        string `json:"version"`
	Digest         string `json:"digest"`
	RuntimeFamily  string `json:"runtimeFamily"`
	LanguageFamily string `json:"languageFamily"`
	Runtime        string `json:"runtime"`
	Handler        string `json:"handler"`
	ModuleFormat   string `json:"moduleFormat"`
}

type ArtifactInputVariable struct {
	Name        string `json:"name"`
	ValueType   string `json:"valueType"`
	Sensitive   bool   `json:"sensitive"`
	Required    bool   `json:"required"`
	Description string `json:"description"`
	Validation  string `json:"validation"`
}

type ExternalResourceAddress struct {
	ID    string `json:"id"`
	Kind  string `json:"kind"`
	Value string `json:"value,omitempty"`
}

type ExternalResourceBehavior struct {
	Create          string `json:"create"`
	Reference       string `json:"reference"`
	Import          string `json:"import"`
	DataSource      string `json:"dataSource"`
	ImportAddressID string `json:"importAddressId,omitempty"`
}

type ExternalResourceTarget struct {
	Target         TargetKind `json:"target"`
	Readiness      string     `json:"readiness"`
	MappingID      string     `json:"mappingId,omitempty"`
	MappingVersion string     `json:"mappingVersion,omitempty"`
}

type NormalizedExternalResource struct {
	ID                 string                    `json:"id"`
	ResourceType       string                    `json:"resourceType"`
	ArchitectureNodes  []ResourceReference       `json:"architectureNodes"`
	OwnershipState     string                    `json:"ownershipState"`
	LifecycleAuthority string                    `json:"lifecycleAuthority"`
	Behavior           ExternalResourceBehavior  `json:"behavior"`
	Targets            []ExternalResourceTarget  `json:"targets"`
	Addresses          []ExternalResourceAddress `json:"addresses"`
}
