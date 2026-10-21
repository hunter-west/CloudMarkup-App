package compiler

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"path"
	"sort"
	"strings"
	"unicode"

	"github.com/hashicorp/hcl/v2"
	"github.com/hashicorp/hcl/v2/hclsyntax"
	"github.com/hashicorp/hcl/v2/hclwrite"
	"github.com/zclconf/go-cty/cty"
)

var terraformFileOrder = []string{
	"infrastructure/versions.tf",
	"infrastructure/providers.tf",
	"infrastructure/variables.tf",
	"infrastructure/locals.tf",
	"infrastructure/identity.tf",
	"infrastructure/compute.tf",
	"infrastructure/data.tf",
	"infrastructure/security.tf",
	"infrastructure/observability.tf",
	"infrastructure/outputs.tf",
	"infrastructure/terraform.tfvars.example",
	"infrastructure/README.md",
}

var terraformResourceTypeByService = map[string]string{
	"aws.apigateway.http-api":             "aws_apigatewayv2_api",
	"aws.cloudwatch.log-group":            "aws_cloudwatch_log_group",
	"aws.cloudwatch.metric-alarm":         "aws_cloudwatch_metric_alarm",
	"aws.cognito.user-pool":               "aws_cognito_user_pool",
	"aws.cognito.user-pool-client":        "aws_cognito_user_pool_client",
	"aws.dynamodb.table":                  "aws_dynamodb_table",
	"aws.iam.role":                        "aws_iam_role",
	"aws.lambda.function":                 "aws_lambda_function",
	"aws.s3.bucket":                       "aws_s3_bucket",
	"aws.sqs.queue":                       "aws_sqs_queue",
	"aws.sns.topic":                       "aws_sns_topic",
	"aws.eventbridge.event-bus":           "aws_cloudwatch_event_bus",
	"aws.eventbridge.rule":                "aws_cloudwatch_event_rule",
	"aws.stepfunctions.state-machine":     "aws_sfn_state_machine",
	"aws.ec2.vpc":                         "aws_vpc",
	"aws.ec2.subnet":                      "aws_subnet",
	"aws.ec2.route-table":                 "aws_route_table",
	"aws.ec2.route":                       "aws_route",
	"aws.ec2.route-table-association":     "aws_route_table_association",
	"aws.ec2.internet-gateway":            "aws_internet_gateway",
	"aws.ec2.nat-gateway":                 "aws_nat_gateway",
	"aws.ec2.gateway-vpc-endpoint":        "aws_vpc_endpoint",
	"aws.ec2.security-group":              "aws_security_group",
	"aws.ec2.security-group-ingress-rule": "aws_vpc_security_group_ingress_rule",
	"aws.ec2.security-group-egress-rule":  "aws_vpc_security_group_egress_rule",
}

var terraformInternalService = map[string]struct{}{
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

var terraformRelationshipSupport = map[string]struct{}{
	"aws.apigateway.integrates-lambda":                {},
	"aws.cognito.contains-app-client":                 {},
	"aws.cognito.provides-jwt-audience":               {},
	"aws.cognito.provides-jwt-issuer":                 {},
	"aws.iam.authorizes-dynamodb-table":               {},
	"aws.iam.authorizes-lambda-function":              {},
	"aws.iam.authorizes-log-group":                    {},
	"aws.iam.policy-contains-statement":               {},
	"aws.iam.role-assumed-by-lambda":                  {},
	"aws.iam.role-owns-generated-permission":          {},
	"aws.iam.role-owns-inline-policy":                 {},
	"aws.iam.role-owns-managed-policy-attachment":     {},
	"aws.iam.role-owns-permissions-boundary":          {},
	"aws.iam.role-owns-trust-policy":                  {},
	"aws.iam.statement-owns-condition":                {},
	"aws.lambda.monitored-by-alarm":                   {},
	"aws.lambda.owns-invocation-permission":           {},
	"aws.lambda.reads-dynamodb-table":                 {},
	"aws.lambda.writes-dynamodb-table":                {},
	"aws.lambda.writes-log-group":                     {},
	"aws.region.contains-vpc":                         {},
	"aws.ec2.vpc-contains-availability-zone":          {},
	"aws.ec2.availability-zone-contains-subnet":       {},
	"aws.ec2.vpc-contains-route-table":                {},
	"aws.ec2.subnet-contains-nat-gateway":             {},
	"aws.ec2.vpc-contains-gateway-endpoint":           {},
	"aws.ec2.route-table-owns-route":                  {},
	"aws.ec2.route-table-owns-subnet-association":     {},
	"aws.ec2.route-table-association-targets-subnet":  {},
	"aws.ec2.vpc-attaches-internet-gateway":           {},
	"aws.ec2.route-targets-internet-gateway":          {},
	"aws.ec2.route-targets-nat-gateway":               {},
	"aws.ec2.gateway-endpoint-associates-route-table": {},
	"aws.ec2.gateway-endpoint-owns-policy":            {},
	"aws.ec2.vpc-associates-security-group":           {},
	"aws.ec2.security-group-owns-ingress-rule":        {},
	"aws.ec2.security-group-owns-egress-rule":         {},
	"aws.lambda.owns-vpc-access-configuration":        {},
	"aws.lambda.vpc-access-uses-subnet":               {},
	"aws.lambda.vpc-access-uses-security-group":       {},
	"aws.s3.notifies-lambda":                          {},
	"aws.s3.sends-events-to-eventbridge":              {},
	"aws.lambda.sends-message-to-sqs":                 {},
	"aws.sqs.triggers-lambda":                         {},
	"aws.sqs.uses-dead-letter-queue":                  {},
	"aws.lambda.publishes-to-sns":                     {},
	"aws.sns.topic-owns-subscription":                 {},
	"aws.sns.subscription-invokes-lambda":             {},
	"aws.sns.subscription-sends-to-sqs":               {},
	"aws.lambda.puts-events-on-eventbridge":           {},
	"aws.eventbridge.event-bus-associates-rule":       {},
	"aws.eventbridge.rule-owns-target":                {},
	"aws.eventbridge.target-invokes-lambda":           {},
	"aws.eventbridge.target-sends-to-sqs":             {},
	"aws.eventbridge.target-publishes-to-sns":         {},
	"aws.eventbridge.target-starts-state-machine":     {},
	"aws.eventbridge.target-uses-dead-letter-queue":   {},
	"aws.lambda.starts-step-functions-state-machine":  {},
	"aws.stepfunctions.state-machine-invokes-lambda":  {},
	"aws.iam.role-assumed-by-step-functions":          {},
	"aws.iam.role-assumed-by-eventbridge-target":      {},
	"aws.lambda.uses-sqs-dead-letter-queue":           {},
	"aws.s3.bucket-owns-lifecycle-configuration":      {},
	"aws.s3.bucket-owns-cors-configuration":           {},
	"aws.s3.bucket-owns-notification-configuration":   {},
	"aws.sqs.queue-owns-redrive-configuration":        {},
	"aws.s3.bucket-owns-resource-policy":              {},
	"aws.sqs.queue-owns-resource-policy":              {},
	"aws.sns.topic-owns-resource-policy":              {},
	"aws.eventbridge.event-bus-owns-resource-policy":  {},
	"aws.iam.authorizes-s3-bucket":                    {},
	"aws.iam.authorizes-sqs-queue":                    {},
	"aws.iam.authorizes-sns-topic":                    {},
	"aws.iam.authorizes-eventbridge-bus":              {},
	"aws.iam.authorizes-step-functions-state-machine": {},
}

type terraformVariable struct {
	Name        string
	Type        string
	Sensitive   bool
	Required    bool
	Default     *cty.Value
	Description string
	Validation  string
}

type terraformRenderer struct {
	ctx                  context.Context
	model                *NormalizedSolution
	limits               Limits
	diagnostics          []Diagnostic
	files                map[string]*hclwrite.File
	variables            map[string]terraformVariable
	exampleValues        map[string]cty.Value
	resourceNames        map[string]string
	externalByNode       map[string]NormalizedExternalResource
	artifactByNode       map[string]lambdaArtifactBinding
	applicationArtifacts []ApplicationArtifactContract
	policyArtifacts      []PolicyArtifactContract
}

func renderTerraformArtifact(ctx context.Context, model *NormalizedSolution, extensions []TargetExtensionReference, limits Limits) (*TargetArtifact, []Diagnostic) {
	limits = normalizeLimits(limits)
	renderer := &terraformRenderer{
		ctx: ctx, model: model, limits: limits, files: make(map[string]*hclwrite.File),
		variables: make(map[string]terraformVariable), exampleValues: make(map[string]cty.Value),
		resourceNames: make(map[string]string), externalByNode: make(map[string]NormalizedExternalResource),
		artifactByNode: make(map[string]lambdaArtifactBinding), applicationArtifacts: []ApplicationArtifactContract{},
		policyArtifacts: []PolicyArtifactContract{},
	}
	if model == nil {
		renderer.error("TARGET_INPUT_INVALID", "Terraform rendering requires a normalized compiler model.", SourceReference{Document: DocumentArchitecture})
		return nil, renderer.diagnostics
	}
	for index := range extensions {
		renderer.error("TARGET_EXTENSION_NOT_SUPPORTED", "Terraform target extensions are reserved until Prompt 36A validation and acceptance are implemented.", SourceReference{Document: DocumentArchitecture, Path: fmt.Sprintf("$.targetExtensions[%d]", index)})
	}
	renderer.validateModelSupport()
	renderer.validateNetworkingModel()
	renderer.validateEventModel()
	renderer.validateFsxModel()
	renderer.validateS3Accuracy()
	renderer.validateKmsModel()
	renderer.validateSecretModel()
	renderer.validateEc2Model()
	renderer.validateEcsModel()
	renderer.validateRdsModel()
	renderer.validateAuroraModel()
	renderer.validateDnsModel()
	renderer.validateCloudfrontModel()
	renderer.validateElbModel()
	renderer.validateEbsModel()
	renderer.assignResourceNames()
	renderer.indexExternalResources()
	renderer.prepareApplicationArtifacts()
	if renderer.hasErrors() {
		return nil, renderer.diagnostics
	}

	fileOrder := renderer.targetFileOrder()
	for _, filePath := range fileOrder[:len(fileOrder)-1] {
		renderer.files[filePath] = hclwrite.NewEmptyFile()
	}
	renderer.renderVersions()
	renderer.renderProviders()
	renderer.renderLocals()
	renderer.renderResources()
	renderer.renderPolicies()
	renderer.renderVariables()
	renderer.renderOutputs()
	if renderer.hasErrors() {
		return nil, renderer.diagnostics
	}

	files := make([]TargetFile, 0, len(fileOrder))
	for _, filePath := range fileOrder {
		if err := renderer.ctx.Err(); err != nil {
			renderer.error("COMPILER_CANCELED", "Terraform rendering was canceled.", SourceReference{Document: DocumentArchitecture})
			return nil, renderer.diagnostics
		}
		var contents []byte
		mediaType := "text/plain"
		if strings.HasSuffix(filePath, ".md") {
			contents = []byte(renderer.renderReadme())
			mediaType = "text/markdown"
		} else {
			file := renderer.files[filePath]
			if file == nil {
				file = hclwrite.NewEmptyFile()
			}
			contents = file.Bytes()
			if _, diagnostics := hclsyntax.ParseConfig(contents, filePath, hcl.Pos{Line: 1, Column: 1}); diagnostics.HasErrors() {
				renderer.error("TARGET_HCL_PARSE_FAILED", "Generated Terraform failed the internal HCL parser.", SourceReference{Document: DocumentArchitecture})
				return nil, renderer.diagnostics
			}
			mediaType = "application/vnd.hashicorp.terraform"
		}
		files = append(files, TargetFile{
			Path: filePath, MediaType: mediaType, Ownership: "generated",
			Content: string(contents), Digest: digestBytes(contents),
		})
	}
	if len(files) > limits.MaxArtifactFiles {
		renderer.error("LIMIT_TARGET_FILE_COUNT_EXCEEDED", "Generated target file count exceeds the configured limit.", SourceReference{Document: DocumentArchitecture})
		return nil, renderer.diagnostics
	}

	artifact := &TargetArtifact{
		ContractVersion: TerraformArtifactContractVersion,
		Target:          TargetTerraform, FormatVersion: TerraformFormatVersion,
		Provenance: model.Provenance,
		Metadata: TerraformCompilerMetadata{
			FormatVersion: TerraformFormatVersion, RequiredTerraformVersion: TerraformRequiredVersion,
			Providers: []TerraformProviderConstraint{{Source: TerraformAWSProviderSource, Version: TerraformAWSProviderVersion}},
		},
		Files: files, ApplicationArtifacts: renderer.applicationArtifacts, PolicyArtifacts: renderer.policyArtifacts,
	}
	encoded, err := json.Marshal(artifact)
	if err != nil {
		renderer.error("TARGET_MANIFEST_ENCODING_FAILED", "Terraform artifact manifest could not be encoded.", SourceReference{Document: DocumentArchitecture})
		return nil, renderer.diagnostics
	}
	if len(encoded) > limits.MaxArtifactBytes {
		renderer.error("LIMIT_TARGET_ARTIFACT_EXCEEDED", "Generated target artifact exceeds the configured output limit.", SourceReference{Document: DocumentArchitecture})
		return nil, renderer.diagnostics
	}
	artifact.Digest = digestBytes(encoded)
	return artifact, renderer.diagnostics
}

func (renderer *terraformRenderer) validateModelSupport() {
	current := renderer.isCurrentCatalog()
	if !current {
		renderer.error("TARGET_CATALOG_UNSUPPORTED", "Terraform rendering supports only exact reviewed AWS catalog bindings.", SourceReference{Document: DocumentArchitecture, Path: "$.catalog"})
	}
	for _, resource := range renderer.model.Resources {
		if !current && isEventService(resource.ServiceType) {
			renderer.error("TARGET_RESOURCE_UNSUPPORTED", "Event resources require the exact reviewed Terraform-eventing catalog.", SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
			continue
		}
		if !current && isNetworkingService(resource.ServiceType) {
			renderer.error("TARGET_RESOURCE_UNSUPPORTED", "Networking resources require the exact reviewed Terraform-networking catalog.", SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
			continue
		}
		if _, deployable := terraformResourceTypeByService[resource.ServiceType]; deployable {
			continue
		}
		if _, internal := terraformInternalService[resource.ServiceType]; internal {
			continue
		}
		renderer.error("TARGET_RESOURCE_UNSUPPORTED", "Architecture resource has no implemented Terraform mapping.", SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
	}
	for _, connection := range renderer.model.Connections {
		if !current && isEventRelationship(connection.RelationshipType) {
			renderer.error("TARGET_RELATIONSHIP_UNSUPPORTED", "Event relationships require the exact reviewed Terraform-eventing catalog.", SourceReference{Document: DocumentArchitecture, EdgeID: connection.ID})
			continue
		}
		if !current && isNetworkingRelationship(connection.RelationshipType) {
			renderer.error("TARGET_RELATIONSHIP_UNSUPPORTED", "Networking relationships require the exact reviewed Terraform-networking catalog.", SourceReference{Document: DocumentArchitecture, EdgeID: connection.ID})
			continue
		}
		if _, supported := terraformRelationshipSupport[connection.RelationshipType]; !supported {
			renderer.error("TARGET_RELATIONSHIP_UNSUPPORTED", "Architecture relationship has no implemented Terraform mapping.", SourceReference{Document: DocumentArchitecture, EdgeID: connection.ID})
		}
	}
	for _, workload := range renderer.model.Workloads {
		var specification map[string]any
		if err := json.Unmarshal(workload.Specification, &specification); err != nil {
			renderer.error("TARGET_WORKLOAD_SPECIFICATION_INVALID", "Normalized workload specification could not be read.", SourceReference{Document: DocumentWorkload, WorkloadID: workload.ID})
			continue
		}
		hasEventBehavior := len(anySlice(specification["eventBindings"])) > 0 || len(anySlice(specification["schedules"])) > 0
		artifactReady := renderer.isCurrentCatalog() && generatedApplicationArtifactReady(renderer.model.Provenance.Catalog, workload)
		if current && hasEventBehavior && !artifactReady {
			renderer.warning("APPLICATION_GENERATION_PENDING", "Event infrastructure is renderable, but the exact generated, built, tested, and scanned application artifact coverage is incomplete.", SourceReference{Document: DocumentWorkload, WorkloadID: workload.ID})
		} else if !current && hasEventBehavior {
			renderer.error("TARGET_WORKLOAD_BEHAVIOR_UNSUPPORTED", "Terraform notes-API support excludes event and schedule bindings.", SourceReference{Document: DocumentWorkload, WorkloadID: workload.ID})
		}
		if len(anySlice(specification["implementationRequirements"])) > 0 {
			if current {
				renderer.warning("APPLICATION_CUSTOMIZATION_REQUIRED", "Workload implementation requirements remain explicit; the generated artifact cannot claim complete supported-pattern coverage.", SourceReference{Document: DocumentWorkload, WorkloadID: workload.ID})
			} else {
				renderer.error("TARGET_WORKLOAD_REQUIREMENTS_UNRESOLVED", "Workload has unresolved implementation requirements.", SourceReference{Document: DocumentWorkload, WorkloadID: workload.ID})
			}
		}
	}
}

func (renderer *terraformRenderer) isCurrentCatalog() bool {
	return isCurrentAwsCatalog(renderer.model.Provenance.Catalog)
}

func generatedApplicationArtifactReady(catalog CatalogReference, workload NormalizedWorkload) bool {
	if !reviewedTargetNeutralApplicationGeneratorReadiness(catalog, workload.GeneratorReadiness) {
		return false
	}
	switch workload.ImplementationMode {
	case "complete-supported-pattern":
		return workload.GenerationCoverage == "complete-supported-pattern" &&
			workload.TargetReadiness == "application-artifact-ready"
	case "generated-starter":
		return workload.GenerationCoverage == "starter-application" &&
			workload.TargetReadiness == "application-starter-artifact-ready"
	default:
		return false
	}
}

func (renderer *terraformRenderer) targetFileOrder() []string {
	if !renderer.isCurrentCatalog() {
		return append([]string(nil), terraformFileOrder...)
	}
	result := append([]string(nil), terraformFileOrder...)
	insertAt := 4
	result = append(result, "")
	copy(result[insertAt+1:], result[insertAt:])
	result[insertAt] = "infrastructure/networking.tf"
	if renderer.isCurrentCatalog() {
		insertAt = 9
		result = append(result, "")
		copy(result[insertAt+1:], result[insertAt:])
		result[insertAt] = "infrastructure/eventing.tf"
	}
	if isCurrentAwsCatalog(renderer.model.Provenance.Catalog) {
		for _, resource := range renderer.model.Resources {
			if _, exists := dnsSchemas[resource.ServiceType]; exists {
				insertAt = len(result) - 2
				result = append(result, "")
				copy(result[insertAt+1:], result[insertAt:])
				result[insertAt] = "infrastructure/dns.tf"
				break
			}
		}
	}
	if isCurrentAwsCatalog(renderer.model.Provenance.Catalog) {
		for _, n := range renderer.model.Resources {
			if _, ok := cloudfrontSchemas[n.ServiceType]; ok {
				insertAt = len(result) - 2
				result = append(result, "")
				copy(result[insertAt+1:], result[insertAt:])
				result[insertAt] = "infrastructure/cloudfront.tf"
				break
			}
		}
	}
	if isCurrentAwsCatalog(renderer.model.Provenance.Catalog) {
		for _, n := range renderer.model.Resources {
			if _, ok := elbSchemas[n.ServiceType]; ok {
				insertAt = len(result) - 2
				result = append(result, "")
				copy(result[insertAt+1:], result[insertAt:])
				result[insertAt] = "infrastructure/elb.tf"
				break
			}
		}
	}
	if isCurrentAwsCatalog(renderer.model.Provenance.Catalog) {
		for _, n := range renderer.model.Resources {
			if _, ok := ebsSchemas[n.ServiceType]; ok {
				insertAt = len(result) - 2
				result = append(result, "")
				copy(result[insertAt+1:], result[insertAt:])
				result[insertAt] = "infrastructure/ebs.tf"
				break
			}
		}
	}
	return result
}

func (renderer *terraformRenderer) assignResourceNames() {
	groups := make(map[string][]NormalizedResource)
	for _, resource := range renderer.model.Resources {
		base := terraformIdentifier(resource.TargetKey)
		groupKey := base
		if renderer.isCurrentCatalog() {
			groupKey = terraformAddressNamespace(resource) + "\x00" + base
		}
		groups[groupKey] = append(groups[groupKey], resource)
	}
	for _, resources := range groups {
		sort.Slice(resources, func(left int, right int) bool { return compareUTF16(resources[left].ID, resources[right].ID) < 0 })
		for _, resource := range resources {
			name := terraformIdentifier(resource.TargetKey)
			if len(resources) > 1 {
				name += "_" + shortDigest(resource.ID)
			}
			renderer.resourceNames[resource.ID] = name
		}
	}
}

func terraformAddressNamespace(resource NormalizedResource) string {
	if resourceType, ok := terraformResourceTypeByService[resource.ServiceType]; ok {
		return resourceType
	}
	switch resource.ServiceType {
	case "aws.iam.policy-document":
		return "data.aws_iam_policy_document"
	case "aws.iam.managed-policy-attachment":
		return "aws_iam_role_policy_attachment"
	default:
		return "internal." + resource.ServiceType
	}
}

func (renderer *terraformRenderer) indexExternalResources() {
	for _, external := range renderer.model.ExternalResources {
		for _, node := range external.ArchitectureNodes {
			if _, exists := renderer.externalByNode[node.NodeID]; exists {
				renderer.error("TARGET_EXTERNAL_RESOURCE_AMBIGUOUS", "Architecture node is bound to more than one external-resource authority record.", SourceReference{Document: DocumentArchitecture, NodeID: node.NodeID})
				continue
			}
			renderer.externalByNode[node.NodeID] = external
		}
	}
	for nodeID, external := range renderer.externalByNode {
		target, ok := externalTarget(external, TargetTerraform)
		resource, resourceOK := renderer.resourceByID(nodeID)
		if !ok || !resourceOK || target.MappingID != resource.ServiceType+".terraform" || target.MappingVersion != TerraformFormatVersion {
			renderer.error("TARGET_EXTERNAL_RESOURCE_MAPPING_INVALID", "External resource does not bind the exact implemented Terraform mapping.", SourceReference{Document: DocumentArchitecture, NodeID: nodeID})
			continue
		}
		valid := false
		switch external.OwnershipState {
		case "managed-by-generated-iac":
			valid = external.LifecycleAuthority == "cloudmarkup-generated-iac" && external.Behavior.Create == "generated-iac-required" && external.Behavior.Reference == "allowed" && external.Behavior.Import == "not-applicable" && target.Readiness == "managed-create-ready"
		case "existing-cloud-managed-elsewhere":
			valid = external.LifecycleAuthority == "external-owner" && external.Behavior.Create == "forbidden" && external.Behavior.Reference == "required" && external.Behavior.Import == "review-optional" && target.Readiness == "reference-ready"
		case "imported-current-iac-lifecycle":
			valid = external.LifecycleAuthority == "current-customer-iac" && external.Behavior.Create == "forbidden" && external.Behavior.Reference == "required" && external.Behavior.Import == "reviewed-required" && external.Behavior.ImportAddressID != "" && target.Readiness == "import-ready"
		}
		if !valid {
			renderer.error("TARGET_EXTERNAL_RESOURCE_OWNERSHIP_UNSUPPORTED", "External resource ownership, lifecycle authority, behavior, and readiness do not form one supported Terraform binding.", SourceReference{Document: DocumentArchitecture, NodeID: nodeID})
		}
	}
}

func externalTarget(resource NormalizedExternalResource, target TargetKind) (ExternalResourceTarget, bool) {
	for _, candidate := range resource.Targets {
		if candidate.Target == target {
			return candidate, true
		}
	}
	return ExternalResourceTarget{}, false
}

func (renderer *terraformRenderer) file(name string) *hclwrite.File {
	return renderer.files["infrastructure/"+name]
}

func (renderer *terraformRenderer) error(code string, message string, source SourceReference) {
	if len(renderer.diagnostics) >= renderer.limits.MaxDiagnostics {
		return
	}
	renderer.diagnostics = append(renderer.diagnostics, Diagnostic{Code: code, Severity: SeverityError, Message: message, Source: source})
}

func (renderer *terraformRenderer) warning(code string, message string, source SourceReference) {
	if len(renderer.diagnostics) >= renderer.limits.MaxDiagnostics {
		return
	}
	renderer.diagnostics = append(renderer.diagnostics, Diagnostic{Code: code, Severity: SeverityWarning, Message: message, Source: source})
}

func (renderer *terraformRenderer) hasErrors() bool { return hasErrorDiagnostics(renderer.diagnostics) }

func terraformIdentifier(value string) string {
	var result strings.Builder
	for index, character := range strings.ToLower(value) {
		valid := unicode.IsLetter(character) || character == '_' || (index > 0 && unicode.IsDigit(character))
		if valid {
			result.WriteRune(character)
		} else {
			result.WriteByte('_')
		}
	}
	identifier := strings.Trim(result.String(), "_")
	if identifier == "" {
		identifier = "resource"
	}
	if first := rune(identifier[0]); unicode.IsDigit(first) {
		identifier = "r_" + identifier
	}
	return identifier
}

func shortDigest(value string) string {
	digest := sha256.Sum256([]byte(value))
	return hex.EncodeToString(digest[:])[:10]
}

func digestBytes(value []byte) string {
	digest := sha256.Sum256(value)
	return "sha256:" + hex.EncodeToString(digest[:])
}

func portableArtifactSegment(value string) string {
	if len(value) > 0 && len(value) <= 63 && value[0] >= 'a' && value[0] <= 'z' {
		portable := true
		for _, character := range value[1:] {
			if !((character >= 'a' && character <= 'z') || (character >= '0' && character <= '9') || character == '_') {
				portable = false
				break
			}
		}
		if portable {
			return value
		}
	}

	var readable strings.Builder
	for _, character := range value {
		if readable.Len() >= 48 {
			break
		}
		if (character >= 'A' && character <= 'Z') || (character >= 'a' && character <= 'z') ||
			(character >= '0' && character <= '9') || character == '_' || character == '-' {
			readable.WriteRune(character)
		} else {
			readable.WriteByte('_')
		}
	}
	prefix := readable.String()
	if prefix == "" {
		prefix = "id"
	}
	digest := sha256.Sum256([]byte(value))
	return prefix + "-" + hex.EncodeToString(digest[:])
}

func safeRelativePackagePath(workloadID string) string {
	return path.Join("..", "application", "artifacts", portableArtifactSegment(workloadID), "function.zip")
}
