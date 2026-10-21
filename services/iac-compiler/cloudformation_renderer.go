package compiler

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
)

var cloudFormationResourceTypeByService = map[string]string{
	"aws.apigateway.http-api":             "AWS::ApiGatewayV2::Api",
	"aws.cloudwatch.log-group":            "AWS::Logs::LogGroup",
	"aws.cloudwatch.metric-alarm":         "AWS::CloudWatch::Alarm",
	"aws.cognito.user-pool":               "AWS::Cognito::UserPool",
	"aws.cognito.user-pool-client":        "AWS::Cognito::UserPoolClient",
	"aws.dynamodb.table":                  "AWS::DynamoDB::Table",
	"aws.iam.role":                        "AWS::IAM::Role",
	"aws.lambda.function":                 "AWS::Lambda::Function",
	"aws.ec2.vpc":                         "AWS::EC2::VPC",
	"aws.ec2.subnet":                      "AWS::EC2::Subnet",
	"aws.ec2.route-table":                 "AWS::EC2::RouteTable",
	"aws.ec2.route":                       "AWS::EC2::Route",
	"aws.ec2.route-table-association":     "AWS::EC2::SubnetRouteTableAssociation",
	"aws.ec2.internet-gateway":            "AWS::EC2::InternetGateway",
	"aws.ec2.nat-gateway":                 "AWS::EC2::NatGateway",
	"aws.ec2.gateway-vpc-endpoint":        "AWS::EC2::VPCEndpoint",
	"aws.ec2.security-group":              "AWS::EC2::SecurityGroup",
	"aws.ec2.security-group-ingress-rule": "AWS::EC2::SecurityGroupIngress",
	"aws.ec2.security-group-egress-rule":  "AWS::EC2::SecurityGroupEgress",
	"aws.s3.bucket":                       "AWS::S3::Bucket",
	"aws.sqs.queue":                       "AWS::SQS::Queue",
	"aws.sns.topic":                       "AWS::SNS::Topic",
	"aws.eventbridge.event-bus":           "AWS::Events::EventBus",
	"aws.eventbridge.rule":                "AWS::Events::Rule",
	"aws.stepfunctions.state-machine":     "AWS::StepFunctions::StateMachine",
}

var cloudFormationInternalService = map[string]struct{}{
	"aws.iam.managed-policy-attachment":        {},
	"aws.iam.policy-condition":                 {},
	"aws.iam.policy-document":                  {},
	"aws.iam.policy-statement":                 {},
	"aws.region.boundary":                      {},
	"aws.ec2.availability-zone":                {},
	"aws.lambda.vpc-access-configuration":      {},
	"aws.s3.bucket-lifecycle-configuration":    {},
	"aws.s3.bucket-cors-configuration":         {},
	"aws.s3.bucket-notification-configuration": {},
	"aws.sqs.redrive-configuration":            {},
	"aws.sns.subscription":                     {},
	"aws.eventbridge.target":                   {},
}

type cloudFormationLambdaArtifactBinding struct {
	Workload  NormalizedWorkload
	Bucket    string
	Key       string
	Version   string
	Digest    string
	LocalPath string
}

type cloudFormationRenderer struct {
	ctx                  context.Context
	model                *NormalizedSolution
	limits               Limits
	diagnostics          []Diagnostic
	logicalIDs           map[string]string
	usedLogicalIDs       map[string]string
	parameterIDs         map[string]string
	parameters           map[string]cloudFormationParameter
	parameterExamples    map[string]any
	variableParameters   map[string]string
	resources            map[string]cloudFormationResource
	outputs              map[string]cloudFormationOutput
	artifactByNode       map[string]cloudFormationLambdaArtifactBinding
	applicationArtifacts []ApplicationArtifactContract
	policyArtifacts      []PolicyArtifactContract
	policyDocuments      []terraformPolicyDocument
	externalByNode       map[string]NormalizedExternalResource
}

func renderCloudFormationArtifact(ctx context.Context, model *NormalizedSolution, extensions []TargetExtensionReference, limits Limits) (*TargetArtifact, []Diagnostic) {
	limits = normalizeLimits(limits)
	renderer := &cloudFormationRenderer{
		ctx: ctx, model: model, limits: limits,
		logicalIDs: make(map[string]string), usedLogicalIDs: make(map[string]string), parameterIDs: make(map[string]string),
		parameters: make(map[string]cloudFormationParameter), parameterExamples: make(map[string]any), variableParameters: make(map[string]string),
		resources: make(map[string]cloudFormationResource), outputs: make(map[string]cloudFormationOutput),
		artifactByNode: make(map[string]cloudFormationLambdaArtifactBinding), applicationArtifacts: []ApplicationArtifactContract{},
		policyArtifacts: []PolicyArtifactContract{}, externalByNode: make(map[string]NormalizedExternalResource),
	}
	if model == nil {
		renderer.error("CLOUDFORMATION_INPUT_INVALID", "CloudFormation rendering requires a normalized compiler model.", SourceReference{Document: DocumentArchitecture})
		return nil, renderer.diagnostics
	}
	for index := range extensions {
		renderer.error("CLOUDFORMATION_EXTENSION_UNSUPPORTED", "CloudFormation target extensions are not available in the reviewed initial-family target.", SourceReference{Document: DocumentArchitecture, Path: fmt.Sprintf("$.targetExtensions[%d]", index)})
	}
	renderer.validateModelSupport()
	renderer.assignLogicalIDs()
	renderer.indexExternalResources()
	renderer.renderArchitectureParameters()
	renderer.prepareApplicationArtifacts()
	if renderer.hasErrors() {
		return nil, renderer.diagnostics
	}

	policyReader := &terraformRenderer{
		ctx: ctx, model: model, limits: limits, resourceNames: make(map[string]string),
		externalByNode: make(map[string]NormalizedExternalResource), diagnostics: []Diagnostic{},
	}
	policyReader.assignResourceNames()
	documents := policyReader.collectPolicyDocuments()
	renderer.diagnostics = append(renderer.diagnostics, policyReader.diagnostics...)
	if renderer.hasErrors() {
		return nil, renderer.diagnostics
	}
	renderer.policyDocuments = documents
	renderer.renderIAM(documents)
	renderer.renderResources()
	renderer.renderAPIConnections()
	renderer.renderEventConnections()
	renderer.renderResourcePolicies(documents)
	renderer.renderLambdaPermissions(documents)
	renderer.renderOutputs()
	if renderer.hasErrors() {
		return nil, renderer.diagnostics
	}

	template := cloudFormationTemplate{
		AWSTemplateFormatVersion: CloudFormationTemplateSpecificationVersion,
		Description:              "CloudMarkup deterministic curated serverless, networking, and event-driven application infrastructure.",
		Metadata: map[string]any{
			"CloudMarkup": map[string]any{
				"ArchitectureRevisionId": model.Provenance.ArchitectureRevisionID,
				"CatalogDigest":          model.Provenance.Catalog.Digest,
				"CatalogVersion":         model.Provenance.Catalog.Version,
				"Compiler":               CompilerID + "@" + CompilerVersion,
				"SolutionRevisionId":     model.Provenance.SolutionRevisionID,
			},
		},
		Parameters: renderer.parameters,
		Resources:  renderer.resources,
		Outputs:    renderer.outputs,
	}
	templateBytes, err := deterministicIndentedJSON(template)
	if err != nil || validateCloudFormationTemplate(templateBytes) != nil {
		renderer.error("CLOUDFORMATION_TEMPLATE_VALIDATION_FAILED", "Generated CloudFormation JSON failed internal structural validation.", SourceReference{Document: DocumentArchitecture})
		return nil, renderer.diagnostics
	}
	parameterBytes, err := deterministicIndentedJSON(map[string]any{"Parameters": renderer.parameterExamples})
	if err != nil {
		renderer.error("CLOUDFORMATION_PARAMETER_ENCODING_FAILED", "CloudFormation parameter example could not be encoded.", SourceReference{Document: DocumentArchitecture})
		return nil, renderer.diagnostics
	}
	files := []TargetFile{
		{Path: cloudFormationTemplatePath, MediaType: "application/vnd.amazon.cloudformation.template+json", Ownership: "generated", Content: string(templateBytes), Digest: digestBytes(templateBytes)},
		{Path: cloudFormationParametersPath, MediaType: "application/json", Ownership: "generated", Content: string(parameterBytes), Digest: digestBytes(parameterBytes)},
	}
	readme := []byte(renderer.renderReadme())
	files = append(files, TargetFile{Path: cloudFormationReadmePath, MediaType: "text/markdown", Ownership: "generated", Content: string(readme), Digest: digestBytes(readme)})
	if len(files) > limits.MaxArtifactFiles {
		renderer.error("LIMIT_TARGET_FILE_COUNT_EXCEEDED", "Generated CloudFormation target file count exceeds the configured limit.", SourceReference{Document: DocumentArchitecture})
		return nil, renderer.diagnostics
	}
	artifact := &TargetArtifact{
		ContractVersion: TargetArtifactContractVersion,
		Target:          TargetCloudFormation, FormatVersion: CloudFormationFormatVersion, Provenance: model.Provenance,
		Metadata: TerraformCompilerMetadata{
			FormatVersion: CloudFormationFormatVersion, TemplateSpecificationVersion: CloudFormationTemplateSpecificationVersion,
			TemplateFormat: CloudFormationTemplateFormat, LocalValidation: "cloudmarkup-structured-template-v1",
		},
		Files: files, ApplicationArtifacts: renderer.applicationArtifacts, PolicyArtifacts: renderer.policyArtifacts,
	}
	encoded, err := json.Marshal(artifact)
	if err != nil || len(encoded) > limits.MaxArtifactBytes {
		renderer.error("LIMIT_TARGET_ARTIFACT_EXCEEDED", "Generated CloudFormation target artifact exceeds the configured output limit.", SourceReference{Document: DocumentArchitecture})
		return nil, renderer.diagnostics
	}
	artifact.Digest = digestBytes(encoded)
	return artifact, renderer.diagnostics
}

func (renderer *cloudFormationRenderer) validateModelSupport() {
	catalog := renderer.model.Provenance.Catalog
	current := renderer.isCurrentCatalog()
	if !current {
		renderer.error("CLOUDFORMATION_CATALOG_UNSUPPORTED", "CloudFormation rendering requires the installed current AWS catalog. Create a new project for an older catalog.", SourceReference{Document: DocumentArchitecture, Path: "$.catalog"})
	}
	for _, resource := range renderer.model.Resources {
		if _, supported := cloudFormationResourceTypeByService[resource.ServiceType]; supported {
			continue
		}
		if _, internal := cloudFormationInternalService[resource.ServiceType]; internal {
			continue
		}
		renderer.error("CLOUDFORMATION_RESOURCE_UNSUPPORTED", "Architecture resource is outside the reviewed curated CloudFormation family.", SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
	}
	for _, connection := range renderer.model.Connections {
		_, curatedSupported := terraformRelationshipSupport[connection.RelationshipType]
		if current && !curatedSupported {
			renderer.error("CLOUDFORMATION_RELATIONSHIP_UNSUPPORTED", "Architecture relationship is outside the exact reviewed CloudFormation catalog surface.", SourceReference{Document: DocumentArchitecture, EdgeID: connection.ID})
		}
	}
	for _, workload := range renderer.model.Workloads {
		var specification map[string]any
		if err := json.Unmarshal(workload.Specification, &specification); err != nil {
			renderer.error("CLOUDFORMATION_WORKLOAD_INVALID", "Normalized workload specification could not be read.", SourceReference{Document: DocumentWorkload, WorkloadID: workload.ID})
			continue
		}
		hasEventBehavior := len(anySlice(specification["eventBindings"])) > 0 || len(anySlice(specification["schedules"])) > 0
		if current && hasEventBehavior && !generatedApplicationArtifactReady(catalog, workload) {
			renderer.warning("APPLICATION_GENERATION_PENDING", "Event infrastructure is renderable, but exact generated, built, tested, and scanned application artifact coverage is incomplete.", SourceReference{Document: DocumentWorkload, WorkloadID: workload.ID})
		}
		if len(anySlice(specification["implementationRequirements"])) > 0 {
			if current {
				renderer.warning("APPLICATION_CUSTOMIZATION_REQUIRED", "Workload implementation requirements remain explicit; the generated artifact cannot claim complete supported-pattern coverage.", SourceReference{Document: DocumentWorkload, WorkloadID: workload.ID})
			} else {
				renderer.error("CLOUDFORMATION_WORKLOAD_REQUIREMENTS_UNRESOLVED", "Workload has unresolved implementation requirements.", SourceReference{Document: DocumentWorkload, WorkloadID: workload.ID})
			}
		}
	}
	if current {
		renderer.validateCuratedModel()
	}
}

func (renderer *cloudFormationRenderer) assignLogicalIDs() {
	resources := append([]NormalizedResource(nil), renderer.model.Resources...)
	sort.Slice(resources, func(left int, right int) bool {
		return compareUTF16(resources[left].TargetKey+"\x00"+resources[left].ID, resources[right].TargetKey+"\x00"+resources[right].ID) < 0
	})
	for _, resource := range resources {
		base := cloudFormationIdentifier(resource.DeploymentKey)
		logicalID := base
		if owner, exists := renderer.usedLogicalIDs[logicalID]; exists && owner != resource.ID {
			logicalID = base + strings.ToUpper(shortDigest(resource.ID))
		}
		for owner, exists := renderer.usedLogicalIDs[logicalID]; exists && owner != resource.ID; owner, exists = renderer.usedLogicalIDs[logicalID] {
			logicalID += "X"
		}
		renderer.usedLogicalIDs[logicalID] = resource.ID
		renderer.logicalIDs[resource.ID] = logicalID
	}
}

func (renderer *cloudFormationRenderer) derivedLogicalID(seed string) string {
	base := cloudFormationIdentifier(seed)
	logicalID := base
	if owner, exists := renderer.usedLogicalIDs[logicalID]; exists && owner != seed {
		logicalID = base + strings.ToUpper(shortDigest(seed))
	}
	for owner, exists := renderer.usedLogicalIDs[logicalID]; exists && owner != seed; owner, exists = renderer.usedLogicalIDs[logicalID] {
		logicalID += "X"
	}
	renderer.usedLogicalIDs[logicalID] = seed
	return logicalID
}

func (renderer *cloudFormationRenderer) indexExternalResources() {
	for _, external := range renderer.model.ExternalResources {
		for _, reference := range external.ArchitectureNodes {
			if _, exists := renderer.externalByNode[reference.NodeID]; exists {
				renderer.error("CLOUDFORMATION_EXTERNAL_RESOURCE_AMBIGUOUS", "Architecture node has more than one external-resource lifecycle record.", SourceReference{Document: DocumentArchitecture, NodeID: reference.NodeID})
				continue
			}
			renderer.externalByNode[reference.NodeID] = external
			if external.OwnershipState != "managed-by-generated-iac" && external.OwnershipState != "imported-current-iac-lifecycle" {
				renderer.error("CLOUDFORMATION_EXTERNAL_REFERENCE_UNSUPPORTED", "The initial CloudFormation target does not create or infer externally managed resource references.", SourceReference{Document: DocumentArchitecture, NodeID: reference.NodeID})
			}
		}
	}
}

func (renderer *cloudFormationRenderer) renderArchitectureParameters() {
	for _, variable := range renderer.model.Variables {
		parameterType := map[string]string{"string": "String", "integer": "Number", "number": "Number", "boolean": "String", "string-list": "CommaDelimitedList"}[variable.ValueType]
		if parameterType == "" {
			renderer.error("CLOUDFORMATION_PARAMETER_TYPE_UNSUPPORTED", "Architecture variable type is unsupported by CloudFormation generation.", SourceReference{Document: DocumentArchitecture, Path: "$.variables", NodeID: variable.ID})
			continue
		}
		name := renderer.derivedLogicalID(variable.Key + " input")
		parameter := cloudFormationParameter{Type: parameterType, Description: "Architecture variable " + variable.Key + "."}
		if variable.DefaultValue != nil {
			parameter.Default = variable.DefaultValue.Value
		}
		renderer.parameters[name] = parameter
		renderer.variableParameters[variable.ID] = name
		if variable.DefaultValue != nil {
			renderer.parameterExamples[name] = variable.DefaultValue.Value
		} else {
			renderer.parameterExamples[name] = cloudFormationPlaceholder(parameterType, false)
		}
	}
}

func cloudFormationPlaceholder(parameterType string, sensitive bool) any {
	if sensitive {
		return "REPLACE_WITH_SECURE_VALUE"
	}
	switch parameterType {
	case "Number":
		return 0
	case "CommaDelimitedList":
		return "REPLACE_ME"
	default:
		return "REPLACE_ME"
	}
}

func (renderer *cloudFormationRenderer) addParameter(seed string, binding cloudFormationParameterBinding) string {
	if existing, ok := renderer.parameterIDs[seed]; ok {
		return existing
	}
	name := renderer.derivedLogicalID(seed + " parameter")
	parameter := cloudFormationParameter{Type: "String", Description: binding.Description, NoEcho: binding.Sensitive, AllowedPattern: cloudFormationParameterPattern(binding.Validation)}
	if binding.Validation == "non-empty" || binding.Validation == "s3-bucket" {
		parameter.MinLength = 1
	}
	renderer.parameters[name] = parameter
	example := binding.Example
	if example == nil {
		example = cloudFormationPlaceholder(parameter.Type, binding.Sensitive)
	}
	renderer.parameterExamples[name] = example
	renderer.parameterIDs[seed] = name
	return name
}

func (renderer *cloudFormationRenderer) prepareApplicationArtifacts() {
	workloads := make(map[string]NormalizedWorkload, len(renderer.model.Workloads))
	for _, workload := range renderer.model.Workloads {
		workloads[workload.ID] = workload
	}
	for _, resource := range renderer.model.Resources {
		if resource.ServiceType != "aws.lambda.function" {
			continue
		}
		if len(resource.WorkloadIDs) != 1 {
			renderer.error("CLOUDFORMATION_LAMBDA_WORKLOAD_REQUIRED", "Each supported Lambda function must own exactly one Workload record.", SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
			continue
		}
		workload, exists := workloads[resource.WorkloadIDs[0]]
		if !exists {
			renderer.error("CLOUDFORMATION_LAMBDA_WORKLOAD_REQUIRED", "Lambda workload reference does not resolve.", SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
			continue
		}
		logicalID := renderer.logicalIDs[resource.ID]
		segment := portableArtifactSegment(workload.ID)
		path := "application/artifacts/" + segment + "/function.zip"
		bucket := renderer.addParameter(logicalID+" artifact bucket", cloudFormationParameterBinding{Description: "S3 bucket containing the exact reviewed Lambda package.", Validation: "s3-bucket"})
		key := renderer.addParameter(logicalID+" artifact key", cloudFormationParameterBinding{Description: "S3 object key containing the exact reviewed Lambda package.", Validation: "non-empty"})
		version := renderer.addParameter(logicalID+" artifact version", cloudFormationParameterBinding{Description: "Immutable S3 object version for the exact reviewed Lambda package.", Validation: "non-empty"})
		digest := renderer.addParameter(logicalID+" artifact digest", cloudFormationParameterBinding{Description: "Base64-encoded SHA-256 of the exact reviewed Lambda package.", Validation: "base64-sha256"})
		contract := ApplicationArtifactContract{
			ContractVersion: ApplicationArtifactContractVersion, WorkloadID: workload.ID, ImplementationMode: workload.ImplementationMode,
			Inputs: append([]ArtifactReference(nil), workload.ArtifactInputs...), GenerationCoverage: workload.GenerationCoverage,
			Variables: []ArtifactInputVariable{
				artifactVariable(bucket, "string", false, true, "Artifact S3 bucket.", "s3-bucket"),
				artifactVariable(key, "string", false, true, "Artifact S3 key.", "non-empty"),
				artifactVariable(version, "string", false, true, "Artifact S3 object version.", "non-empty"),
				artifactVariable(digest, "string", false, true, "Artifact base64 SHA-256.", "base64-sha256"),
			},
		}
		switch workload.ImplementationMode {
		case "generated-starter", "complete-supported-pattern":
			contract.Delivery = "deterministic-package-upload-input"
			contract.RelativePackagePath = "../" + path
			if reviewedTargetNeutralApplicationGeneratorReadiness(renderer.model.Provenance.Catalog, workload.GeneratorReadiness) {
				contract.ContractVersion = ApplicationArtifactTargetNeutralContractVersion
				contract.ExpectedArtifact = targetNeutralApplicationArtifact(workload.ID)
				contract.ArtifactReadiness = workload.TargetReadiness
			}
		case "infrastructure-only", "user-provided", "ai-assisted-custom":
			contract.Delivery = "validated-package-upload-input"
			contract.CodeRequired = workload.ImplementationMode == "infrastructure-only"
			if contract.CodeRequired {
				renderer.warning("APPLICATION_CODE_REQUIRED", "Infrastructure-only workload requires application code and a validated package before customer deployment.", SourceReference{Document: DocumentWorkload, WorkloadID: workload.ID})
			}
		case "external-artifact":
			if len(workload.ArtifactInputs) != 1 || workload.ArtifactInputs[0].Kind != "external-workload-artifact" {
				renderer.error("CLOUDFORMATION_EXTERNAL_ARTIFACT_INVALID", "External-artifact workload must bind one exact external artifact reference.", SourceReference{Document: DocumentWorkload, WorkloadID: workload.ID})
				continue
			}
			contract.Delivery = "validated-object-artifact-input"
		default:
			renderer.error("CLOUDFORMATION_WORKLOAD_MODE_UNSUPPORTED", "Workload implementation mode is unsupported by CloudFormation generation.", SourceReference{Document: DocumentWorkload, WorkloadID: workload.ID})
			continue
		}
		renderer.artifactByNode[resource.ID] = cloudFormationLambdaArtifactBinding{Workload: workload, Bucket: bucket, Key: key, Version: version, Digest: digest, LocalPath: path}
		renderer.applicationArtifacts = append(renderer.applicationArtifacts, contract)
	}
	sort.Slice(renderer.applicationArtifacts, func(left int, right int) bool {
		return compareUTF16(renderer.applicationArtifacts[left].WorkloadID, renderer.applicationArtifacts[right].WorkloadID) < 0
	})
}

func (renderer *cloudFormationRenderer) addResource(logicalID string, resource cloudFormationResource, source SourceReference) {
	if _, exists := renderer.resources[logicalID]; exists {
		renderer.error("CLOUDFORMATION_LOGICAL_ID_COLLISION", "Two generated resources require the same CloudFormation logical ID.", source)
		return
	}
	renderer.resources[logicalID] = resource
}

func (renderer *cloudFormationRenderer) resourceByID(id string) (NormalizedResource, bool) {
	for _, resource := range renderer.model.Resources {
		if resource.ID == id {
			return resource, true
		}
	}
	return NormalizedResource{}, false
}

func (renderer *cloudFormationRenderer) connectedWithEdge(nodeID string, relationship string, nodeIsTarget bool) (NormalizedResource, NormalizedConnection, bool) {
	matches := []NormalizedConnection{}
	resources := []NormalizedResource{}
	for _, connection := range renderer.model.Connections {
		matchesNode := connection.Source.NodeID == nodeID
		otherID := connection.Target.NodeID
		if nodeIsTarget {
			matchesNode = connection.Target.NodeID == nodeID
			otherID = connection.Source.NodeID
		}
		if matchesNode && connection.RelationshipType == relationship {
			if resource, ok := renderer.resourceByID(otherID); ok {
				matches = append(matches, connection)
				resources = append(resources, resource)
			}
		}
	}
	if len(matches) == 1 {
		return resources[0], matches[0], true
	}
	return NormalizedResource{}, NormalizedConnection{}, false
}

func (renderer *cloudFormationRenderer) connectedResource(nodeID string, relationship string, nodeIsTarget bool) (NormalizedResource, bool) {
	resource, _, ok := renderer.connectedWithEdge(nodeID, relationship, nodeIsTarget)
	return resource, ok
}

func (renderer *cloudFormationRenderer) validateConfiguration(resource NormalizedResource, schemaID string, keys []string) bool {
	if resource.Configuration.SchemaID != schemaID || !exactConfigurationKeys(resource.Configuration, keys) {
		renderer.error("CLOUDFORMATION_CONFIGURATION_UNSUPPORTED", "Resource configuration does not match the reviewed CloudFormation mapping contract.", SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
		return false
	}
	return true
}

func (renderer *cloudFormationRenderer) validateConnectionConfiguration(connection NormalizedConnection, schemaID string, keys []string) bool {
	if connection.Configuration.SchemaID != schemaID || !exactConfigurationKeys(connection.Configuration, keys) {
		renderer.error("CLOUDFORMATION_CONNECTION_CONFIGURATION_UNSUPPORTED", "Connection configuration does not match the reviewed CloudFormation mapping contract.", SourceReference{Document: DocumentArchitecture, EdgeID: connection.ID})
		return false
	}
	return true
}

func (renderer *cloudFormationRenderer) configString(resource NormalizedResource, key string) string {
	value, _ := resource.Configuration.Values[key].Value.(string)
	return value
}

func (renderer *cloudFormationRenderer) configBool(resource NormalizedResource, key string) bool {
	value, _ := resource.Configuration.Values[key].Value.(bool)
	return value
}

func (renderer *cloudFormationRenderer) configInt(resource NormalizedResource, key string) int {
	value, _ := resource.Configuration.Values[key].Value.(float64)
	return int(value)
}

func (renderer *cloudFormationRenderer) configNumber(resource NormalizedResource, key string) float64 {
	value, _ := resource.Configuration.Values[key].Value.(float64)
	return value
}

func (renderer *cloudFormationRenderer) connectionString(connection NormalizedConnection, key string) string {
	value, _ := connection.Configuration.Values[key].Value.(string)
	return value
}

func (renderer *cloudFormationRenderer) connectionInt(connection NormalizedConnection, key string) int {
	value, _ := connection.Configuration.Values[key].Value.(float64)
	return int(value)
}

func (renderer *cloudFormationRenderer) error(code string, message string, source SourceReference) {
	if len(renderer.diagnostics) < renderer.limits.MaxDiagnostics {
		renderer.diagnostics = append(renderer.diagnostics, Diagnostic{Code: code, Severity: SeverityError, Message: message, Source: source})
	}
}

func (renderer *cloudFormationRenderer) warning(code string, message string, source SourceReference) {
	if len(renderer.diagnostics) < renderer.limits.MaxDiagnostics {
		renderer.diagnostics = append(renderer.diagnostics, Diagnostic{Code: code, Severity: SeverityWarning, Message: message, Source: source})
	}
}

func (renderer *cloudFormationRenderer) hasErrors() bool {
	return hasErrorDiagnostics(renderer.diagnostics)
}

func (renderer *cloudFormationRenderer) renderReadme() string {
	var result strings.Builder
	result.WriteString("# Cloud Markup deterministic CloudFormation\n\n")
	result.WriteString("This directory was generated from immutable Architecture and Workload contracts. It references application artifacts but does not generate source, upload packages, call AWS, create a change set, or deploy.\n\n")
	result.WriteString("## Compatibility\n\n")
	fmt.Fprintf(&result, "- Compiler: `%s@%s`\n", CompilerID, CompilerVersion)
	fmt.Fprintf(&result, "- Catalog: `%s@%s` (`%s`)\n", renderer.model.Provenance.Catalog.ID, renderer.model.Provenance.Catalog.Version, renderer.model.Provenance.Catalog.Digest)
	fmt.Fprintf(&result, "- Target format: `%s`\n", CloudFormationFormatVersion)
	fmt.Fprintf(&result, "- CloudFormation template specification: `%s`\n", CloudFormationTemplateSpecificationVersion)
	fmt.Fprintf(&result, "- Architecture revision: `%s`\n", renderer.model.Provenance.ArchitectureRevisionID)
	if renderer.model.Provenance.SolutionRevisionID != "" {
		fmt.Fprintf(&result, "- Solution Revision: `%s`\n", renderer.model.Provenance.SolutionRevisionID)
	}
	result.WriteString("\n## Application artifacts\n\n")
	for _, artifact := range renderer.applicationArtifacts {
		fmt.Fprintf(&result, "- `%s` (%s): %s", artifact.WorkloadID, artifact.ImplementationMode, artifact.Delivery)
		if artifact.ExpectedArtifact != nil {
			fmt.Fprintf(&result, " from `%s`", artifact.ExpectedArtifact.Path)
		}
		result.WriteString(".\n")
	}
	result.WriteString("\n## Legitimate target differences\n\n")
	result.WriteString("- CloudFormation embeds S3 lifecycle, CORS, notification, EventBridge target, Lambda VPC, and SQS redrive configuration in owning resources where the target has no equivalent standalone resource.\n")
	result.WriteString("- The default EventBridge bus is referenced but not created; custom buses are explicit resources.\n")
	result.WriteString("- CloudFormation deployment-time artifact bucket/key/version parameters replace Terraform's local-package path, while both retain the same immutable ZIP checksum contract.\n")
	result.WriteString("- Intrinsic references provide normal ordering. Explicit DependsOn appears only for S3 notification permissions and internet-gateway attachment ordering that CloudFormation cannot infer.\n")
	result.WriteString("- Template parameters, outputs, and list-shaped tags preserve the same architecture variables, outputs, and tag values without copying Terraform file layout or syntax.\n")
	result.WriteString("- Local validation proves only this structured target contract; it is not AWS acceptance, change-set, or deployment Evidence.\n")

	result.WriteString("\nSupply `parameters.example.json` values through a separately protected customer-owned deployment channel. Upload each exact Prompt 32A ZIP without changing its bytes, bind its bucket/key/version/checksum parameters, review the complete template and IAM diff, and perform any validation or deployment only in customer-owned CI/CD. Never commit credentials or secret values.\n")
	return result.String()
}
