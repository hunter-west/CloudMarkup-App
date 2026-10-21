package compiler

import (
	"fmt"
	"sort"
	"strings"

	"github.com/hashicorp/hcl/v2"
	"github.com/hashicorp/hcl/v2/hclwrite"
	"github.com/zclconf/go-cty/cty"
)

type lambdaArtifactBinding struct {
	Mode            string
	PathVariable    string
	HashVariable    string
	BucketVariable  string
	KeyVariable     string
	VersionVariable string
}

func (renderer *terraformRenderer) prepareApplicationArtifacts() {
	workloadByID := make(map[string]NormalizedWorkload, len(renderer.model.Workloads))
	for _, workload := range renderer.model.Workloads {
		workloadByID[workload.ID] = workload
	}
	for _, resource := range renderer.model.Resources {
		if resource.ServiceType != "aws.lambda.function" || renderer.isReferenceOnly(resource.ID) {
			continue
		}
		if len(resource.WorkloadIDs) != 1 {
			renderer.error("TARGET_LAMBDA_WORKLOAD_REQUIRED", "Each supported Lambda function must own exactly one Workload record.", SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
			continue
		}
		workload, exists := workloadByID[resource.WorkloadIDs[0]]
		if !exists {
			renderer.error("TARGET_LAMBDA_WORKLOAD_REQUIRED", "Lambda workload reference does not resolve.", SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
			continue
		}
		name := renderer.resourceNames[resource.ID]
		contract := ApplicationArtifactContract{
			ContractVersion: ApplicationArtifactContractVersion,
			WorkloadID:      workload.ID, ImplementationMode: workload.ImplementationMode,
			Inputs:             append([]ArtifactReference(nil), workload.ArtifactInputs...),
			GenerationCoverage: workload.GenerationCoverage, Variables: []ArtifactInputVariable{},
		}
		binding := lambdaArtifactBinding{Mode: workload.ImplementationMode}
		switch workload.ImplementationMode {
		case "generated-starter", "complete-supported-pattern":
			packagePath := safeRelativePackagePath(workload.ID)
			pathValue := cty.StringVal(packagePath)
			binding.PathVariable = name + "_artifact_path"
			renderer.addVariable(terraformVariable{
				Name: binding.PathVariable, Type: "string", Default: &pathValue,
				Description: "Stable relative package output produced by the separate Prompt 32A workload builder.", Validation: "relative-package-path",
			})
			if renderer.isCurrentCatalog() && reviewedTargetNeutralApplicationGeneratorReadiness(renderer.model.Provenance.Catalog, workload.GeneratorReadiness) {
				contract.ContractVersion = ApplicationArtifactTargetNeutralContractVersion
				contract.ExpectedArtifact = targetNeutralApplicationArtifact(workload.ID)
				contract.ArtifactReadiness = workload.TargetReadiness
			}
			contract.Delivery = "deterministic-relative-package"
			contract.RelativePackagePath = packagePath
			contract.Variables = append(contract.Variables, artifactVariable(binding.PathVariable, "string", false, false, "Relative built Lambda package path.", "relative-package-path"))
		case "infrastructure-only", "user-provided", "ai-assisted-custom":
			binding.PathVariable = name + "_artifact_path"
			binding.HashVariable = name + "_artifact_base64sha256"
			renderer.addVariable(terraformVariable{Name: binding.PathVariable, Type: "string", Required: true, Description: "Validated relative Lambda package path; absolute machine paths are forbidden by the artifact contract.", Validation: "relative-package-path"})
			renderer.exampleValues[binding.PathVariable] = cty.StringVal("../application/artifacts/" + portableArtifactSegment(workload.ID) + "/function.zip")
			renderer.addVariable(terraformVariable{Name: binding.HashVariable, Type: "string", Required: true, Description: "Base64-encoded SHA-256 of the exact Lambda package.", Validation: "base64-sha256"})
			contract.Delivery = "validated-relative-package-input"
			contract.Variables = append(contract.Variables,
				artifactVariable(binding.PathVariable, "string", false, true, "Relative built Lambda package path.", "relative-package-path"),
				artifactVariable(binding.HashVariable, "string", false, true, "Base64-encoded SHA-256 package digest.", "base64-sha256"),
			)
			contract.CodeRequired = workload.ImplementationMode == "infrastructure-only"
			if contract.CodeRequired {
				renderer.warning("APPLICATION_CODE_REQUIRED", "Infrastructure-only workload requires application code and a validated package before planning or deployment.", SourceReference{Document: DocumentWorkload, WorkloadID: workload.ID})
			}
		case "external-artifact":
			if len(workload.ArtifactInputs) != 1 || workload.ArtifactInputs[0].Kind != "external-workload-artifact" {
				renderer.error("TARGET_EXTERNAL_ARTIFACT_INVALID", "External-artifact workload must bind one exact external artifact reference.", SourceReference{Document: DocumentWorkload, WorkloadID: workload.ID})
				continue
			}
			binding.BucketVariable = name + "_artifact_s3_bucket"
			binding.KeyVariable = name + "_artifact_s3_key"
			binding.VersionVariable = name + "_artifact_s3_object_version"
			binding.HashVariable = name + "_artifact_base64sha256"
			for _, variable := range []terraformVariable{
				{Name: binding.BucketVariable, Type: "string", Required: true, Description: "S3 bucket containing the validated external Lambda package.", Validation: "non-empty"},
				{Name: binding.KeyVariable, Type: "string", Required: true, Description: "S3 object key for the validated external Lambda package.", Validation: "non-empty"},
				{Name: binding.VersionVariable, Type: "string", Required: true, Description: "Immutable S3 object version for the external Lambda package.", Validation: "non-empty"},
				{Name: binding.HashVariable, Type: "string", Required: true, Description: "Base64-encoded SHA-256 of the exact external Lambda package.", Validation: "base64-sha256"},
			} {
				renderer.addVariable(variable)
				contract.Variables = append(contract.Variables, artifactVariable(variable.Name, variable.Type, variable.Sensitive, variable.Required, variable.Description, variable.Validation))
			}
			contract.Delivery = "validated-object-artifact-input"
		default:
			renderer.error("TARGET_WORKLOAD_MODE_UNSUPPORTED", "Workload implementation mode is unsupported by Terraform generation.", SourceReference{Document: DocumentWorkload, WorkloadID: workload.ID})
			continue
		}
		renderer.artifactByNode[resource.ID] = binding
		renderer.applicationArtifacts = append(renderer.applicationArtifacts, contract)
	}
	sort.Slice(renderer.applicationArtifacts, func(left int, right int) bool {
		return compareUTF16(renderer.applicationArtifacts[left].WorkloadID, renderer.applicationArtifacts[right].WorkloadID) < 0
	})
}

func targetNeutralApplicationArtifact(workloadID string) *TargetNeutralApplicationArtifactContract {
	segment := portableArtifactSegment(workloadID)
	return &TargetNeutralApplicationArtifactContract{
		ArtifactID:        "artifact_" + segment,
		Kind:              ApplicationArtifactKind,
		MediaType:         ApplicationArtifactMediaType,
		Path:              "application/artifacts/" + segment + "/function.zip",
		ArchiveEntrypoint: ApplicationArchiveEntrypoint,
		Handler:           ApplicationLambdaHandler,
		DigestAlgorithm:   ApplicationArtifactDigestAlgorithm,
		Runtime: TargetNeutralApplicationRuntimeContract{
			ID:             ApplicationRuntimeID,
			Version:        ApplicationRuntimeVersion,
			Digest:         ApplicationRuntimeDigest,
			RuntimeFamily:  ApplicationRuntimeFamily,
			LanguageFamily: ApplicationLanguageFamily,
			Runtime:        ApplicationLambdaRuntime,
			Handler:        ApplicationLambdaHandler,
			ModuleFormat:   "esm",
		},
	}
}

func artifactVariable(name string, valueType string, sensitive bool, required bool, description string, validation string) ArtifactInputVariable {
	return ArtifactInputVariable{Name: name, ValueType: valueType, Sensitive: sensitive, Required: required, Description: description, Validation: validation}
}

func (renderer *terraformRenderer) renderLambdaArtifact(body *hclwrite.Body, nodeID string) {
	binding, exists := renderer.artifactByNode[nodeID]
	if !exists {
		renderer.error("TARGET_LAMBDA_ARTIFACT_MISSING", "Lambda function has no validated application-artifact contract.", SourceReference{Document: DocumentArchitecture, NodeID: nodeID})
		return
	}
	if binding.BucketVariable != "" {
		body.SetAttributeTraversal("s3_bucket", traversal("var", binding.BucketVariable))
		body.SetAttributeTraversal("s3_key", traversal("var", binding.KeyVariable))
		body.SetAttributeTraversal("s3_object_version", traversal("var", binding.VersionVariable))
		body.SetAttributeTraversal("source_code_hash", traversal("var", binding.HashVariable))
		return
	}
	body.SetAttributeTraversal("filename", traversal("var", binding.PathVariable))
	if binding.HashVariable != "" {
		body.SetAttributeTraversal("source_code_hash", traversal("var", binding.HashVariable))
		return
	}
	body.SetAttributeRaw("source_code_hash", hclwrite.TokensForFunctionCall(
		"filebase64sha256", hclwrite.TokensForTraversal(traversal("var", binding.PathVariable)),
	))
}

func (renderer *terraformRenderer) externalVariable(nodeID string, attribute string) string {
	name := renderer.resourceNames[nodeID] + "_external_" + terraformIdentifier(attribute)
	variable := terraformVariable{
		Name: name, Type: "string", Required: true,
		Description: fmt.Sprintf("Explicit non-created binding for %s on externally managed architecture node.", attribute),
	}
	if external, exists := renderer.externalByNode[nodeID]; exists {
		if value, ok := externalDefault(external, attribute); ok {
			defaultValue := cty.StringVal(value)
			variable.Required = false
			variable.Default = &defaultValue
		}
	}
	renderer.addVariable(variable)
	return name
}

func externalDefault(resource NormalizedExternalResource, attribute string) (string, bool) {
	kind := "provider-resource-id"
	if attribute == "arn" || attribute == "execution_arn" || attribute == "invoke_arn" {
		kind = "cloud-arn"
	}
	for _, address := range resource.Addresses {
		if address.Kind == kind && address.Value != "" {
			return address.Value, true
		}
	}
	return "", false
}

func (renderer *terraformRenderer) resourceAttributeTokens(nodeID string, attribute string) hclwrite.Tokens {
	resource, ok := renderer.resourceByID(nodeID)
	if !ok {
		renderer.error("TARGET_RESOURCE_REFERENCE_INVALID", "Terraform reference points to an unavailable resource.", SourceReference{Document: DocumentArchitecture, NodeID: nodeID})
		return hclwrite.TokensForValue(cty.StringVal("INVALID_REFERENCE"))
	}
	attribute = terraformUnqualifiedAttribute(resource.ServiceType, attribute)
	resourceType := terraformResourceTypeByService[resource.ServiceType]
	providerAttribute := terraformAttribute(resource.ServiceType, attribute)
	if (resource.ServiceType == serviceEc2Instance || resource.ServiceType == serviceInstanceProfile) && !isCurrentAwsCatalog(renderer.model.Provenance.Catalog) {
		providerAttribute = ""
	}
	// KMS attributes were unavailable in frozen 0.20 target mappings. The
	// reviewed Secrets successor adds them for explicit encryption references.
	if resource.ServiceType == serviceKmsKey && !isCurrentAwsCatalog(renderer.model.Provenance.Catalog) {
		providerAttribute = ""
	}
	if providerAttribute == "" {
		renderer.error("TARGET_RESOURCE_ATTRIBUTE_UNSUPPORTED", "Terraform mapping does not expose the requested resource attribute.", SourceReference{Document: DocumentArchitecture, NodeID: nodeID})
		return hclwrite.TokensForValue(cty.StringVal("INVALID_ATTRIBUTE"))
	}
	if resource.ServiceType == servicePublicCertificate && attribute == "arn" && isCurrentAwsCatalog(renderer.model.Provenance.Catalog) {
		return hclwrite.TokensForTraversal(traversal("aws_acm_certificate_validation", renderer.resourceNames[nodeID]+"_validation", "certificate_arn"))
	}
	if resource.ServiceType == serviceAuroraCluster && attribute == "masterUserSecretArn" && isCurrentAwsCatalog(renderer.model.Provenance.Catalog) {
		return hclwrite.TokensForTraversal(hcl.Traversal{hcl.TraverseRoot{Name: "aws_rds_cluster"}, hcl.TraverseAttr{Name: renderer.resourceNames[nodeID]}, hcl.TraverseAttr{Name: "master_user_secret"}, hcl.TraverseIndex{Key: cty.NumberIntVal(0)}, hcl.TraverseAttr{Name: "secret_arn"}})
	}
	if resource.ServiceType == serviceRdsInstance && attribute == "masterUserSecretArn" && isCurrentAwsCatalog(renderer.model.Provenance.Catalog) {
		return hclwrite.TokensForTraversal(hcl.Traversal{hcl.TraverseRoot{Name: "aws_db_instance"}, hcl.TraverseAttr{Name: renderer.resourceNames[nodeID]}, hcl.TraverseAttr{Name: "master_user_secret"}, hcl.TraverseIndex{Key: cty.NumberIntVal(0)}, hcl.TraverseAttr{Name: "secret_arn"}})
	}
	if resource.ServiceType == "aws.eventbridge.event-bus" && !renderer.isReferenceOnly(nodeID) && renderer.configString(resource, "busType") == "DEFAULT" {
		return hclwrite.TokensForTraversal(traversal("data", resourceType, renderer.resourceNames[nodeID], providerAttribute))
	}
	if renderer.isReferenceOnly(nodeID) {
		return hclwrite.TokensForTraversal(traversal("var", renderer.externalVariable(nodeID, attribute)))
	}
	return hclwrite.TokensForTraversal(traversal(resourceType, renderer.resourceNames[nodeID], providerAttribute))
}

func (renderer *terraformRenderer) resourceByID(id string) (NormalizedResource, bool) {
	for _, resource := range renderer.model.Resources {
		if resource.ID == id {
			return resource, true
		}
	}
	return NormalizedResource{}, false
}

func (renderer *terraformRenderer) isReferenceOnly(nodeID string) bool {
	external, exists := renderer.externalByNode[nodeID]
	return exists && external.OwnershipState != "managed-by-generated-iac" && external.OwnershipState != "imported-current-iac-lifecycle"
}

func (renderer *terraformRenderer) shouldRenderResource(nodeID string) bool {
	return !renderer.isReferenceOnly(nodeID)
}

func terraformAttribute(service string, attribute string) string {
	attribute = terraformUnqualifiedAttribute(service, attribute)
	if isFsxService(service) && (attribute == "id" || attribute == "arn") {
		return attribute
	}
	attributes := map[string]map[string]string{
		serviceEbsVolume: {"id": "id"},
		serviceAlb:       {"arn": "arn", "dnsName": "dns_name", "hostedZoneId": "zone_id"}, serviceAlbTarget: {"arn": "arn"}, serviceAlbListener: {"arn": "arn"},
		serviceCloudfrontDistribution: {"id": "id", "arn": "arn", "domainName": "domain_name", "hostedZoneId": "hosted_zone_id"}, serviceCloudfrontCache: {"id": "id"},
		servicePublicZone: {"zoneId": "zone_id", "nameServers": "name_servers"}, servicePublicCertificate: {"arn": "arn"},
		serviceAuroraCluster: {"identifier": "id", "arn": "arn", "address": "endpoint", "readerAddress": "reader_endpoint", "port": "port", "masterUserSecretArn": "master_user_secret"}, serviceAuroraInstance: {"identifier": "identifier", "arn": "arn", "address": "endpoint", "port": "port"}, serviceAuroraParameters: {"name": "name"},
		serviceRdsInstance: {"identifier": "identifier", "arn": "arn", "address": "address", "port": "port", "masterUserSecretArn": "master_user_secret"}, serviceRdsSubnetGroup: {"name": "name", "arn": "arn"}, serviceRdsParameterGroup: {"name": "name", "arn": "arn"},
		serviceEcrRepository: {"name": "name", "arn": "arn", "repositoryUrl": "repository_url"}, serviceEcsCluster: {"name": "name", "arn": "arn"}, serviceEcsTask: {"arn": "arn"}, serviceEcsService: {"name": "name", "arn": "arn"},
		serviceEc2Instance:                    {"id": "id", "privateIp": "private_ip", "privateDns": "private_dns"},
		serviceInstanceProfile:                {"name": "name", "arn": "arn"},
		serviceKmsKey:                         {"id": "id", "arn": "arn"},
		serviceSecret:                         {"id": "id", "arn": "arn", "name": "name"},
		"aws.apigateway.http-api":             {"id": "id", "arn": "arn", "executionArn": "execution_arn", "execution_arn": "execution_arn", "endpoint": "api_endpoint"},
		"aws.cloudwatch.log-group":            {"id": "id", "arn": "arn", "name": "name"},
		"aws.cloudwatch.metric-alarm":         {"id": "id", "arn": "arn", "name": "alarm_name"},
		"aws.cognito.user-pool":               {"id": "id", "arn": "arn", "endpoint": "endpoint"},
		"aws.cognito.user-pool-client":        {"id": "id"},
		"aws.dynamodb.table":                  {"id": "id", "arn": "arn", "name": "name"},
		"aws.iam.role":                        {"id": "id", "arn": "arn", "name": "name"},
		"aws.lambda.function":                 {"id": "id", "arn": "arn", "invokeArn": "invoke_arn", "invoke_arn": "invoke_arn", "name": "function_name"},
		"aws.ec2.vpc":                         {"id": "id", "arn": "arn", "cidrBlock": "cidr_block", "defaultSecurityGroupId": "default_security_group_id", "defaultRouteTableId": "default_route_table_id"},
		"aws.ec2.subnet":                      {"id": "id", "arn": "arn", "cidrBlock": "cidr_block", "availabilityZone": "availability_zone"},
		"aws.s3.bucket":                       {"id": "id", "arn": "arn", "name": "bucket"},
		"aws.sqs.queue":                       {"id": "id", "arn": "arn", "name": "name", "url": "url"},
		"aws.sns.topic":                       {"id": "id", "arn": "arn", "name": "name"},
		"aws.eventbridge.event-bus":           {"id": "id", "arn": "arn", "name": "name"},
		"aws.eventbridge.rule":                {"id": "id", "arn": "arn", "name": "name"},
		"aws.stepfunctions.state-machine":     {"id": "id", "arn": "arn", "name": "name"},
		"aws.ec2.route-table":                 {"id": "id", "arn": "arn"},
		"aws.ec2.route":                       {"id": "id"},
		"aws.ec2.route-table-association":     {"id": "id"},
		"aws.ec2.internet-gateway":            {"id": "id", "arn": "arn"},
		"aws.ec2.nat-gateway":                 {"id": "id", "publicIp": "public_ip", "privateIp": "private_ip"},
		"aws.ec2.gateway-vpc-endpoint":        {"id": "id", "arn": "arn", "prefixListId": "prefix_list_id"},
		"aws.ec2.security-group":              {"id": "id", "arn": "arn", "name": "name"},
		"aws.ec2.security-group-ingress-rule": {"id": "id", "arn": "arn"},
		"aws.ec2.security-group-egress-rule":  {"id": "id", "arn": "arn"},
	}
	return attributes[service][attribute]
}

func terraformUnqualifiedAttribute(service string, attribute string) string {
	prefix := service + "."
	if strings.HasPrefix(attribute, prefix) {
		return strings.TrimPrefix(attribute, prefix)
	}
	return attribute
}

func tupleTokens(values ...hclwrite.Tokens) hclwrite.Tokens {
	return hclwrite.TokensForTuple(values)
}
