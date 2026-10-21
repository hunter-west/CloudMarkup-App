package compiler

import (
	"sort"
	"strings"
)

func (renderer *cloudFormationRenderer) validateCuratedModel() {
	shared := &terraformRenderer{
		ctx: renderer.ctx, model: renderer.model, limits: renderer.limits,
		resourceNames: make(map[string]string), externalByNode: make(map[string]NormalizedExternalResource),
		diagnostics: []Diagnostic{},
	}
	shared.validateNetworkingModel()
	shared.validateEventModel()
	shared.validateFsxModel()
	shared.validateS3Accuracy()
	shared.validateKmsModel()
	shared.validateSecretModel()
	shared.validateEc2Model()
	shared.validateEcsModel()
	shared.validateRdsModel()
	shared.validateAuroraModel()
	shared.validateDnsModel()
	shared.validateCloudfrontModel()
	shared.validateElbModel()
	shared.validateEbsModel()
	shared.validateWafModel()
	for _, diagnostic := range shared.diagnostics {
		diagnostic.Code = cloudFormationDiagnosticCode(diagnostic.Code)
		diagnostic.Message = strings.ReplaceAll(diagnostic.Message, "Terraform", "CloudFormation")
		renderer.diagnostics = append(renderer.diagnostics, diagnostic)
	}
}

func (renderer *cloudFormationRenderer) validateEventConfiguration(resource NormalizedResource, version string, keys []string) bool {
	if resource.Configuration.SchemaID != resource.ServiceType+".configuration" || resource.Configuration.SchemaVersion != version || !exactConfigurationKeys(resource.Configuration, keys) {
		renderer.error("CLOUDFORMATION_CONFIGURATION_UNSUPPORTED", "Event resource configuration does not match the exact reviewed CloudFormation mapping.", SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
		return false
	}
	return true
}

func (renderer *cloudFormationRenderer) validateEventConnectionConfiguration(
	connection NormalizedConnection,
	schemaID string,
	keys []string,
) bool {
	if connection.Configuration.SchemaID != schemaID || connection.Configuration.SchemaVersion != "1.0.0" || !exactConfigurationKeys(connection.Configuration, keys) {
		renderer.error("CLOUDFORMATION_CONNECTION_CONFIGURATION_UNSUPPORTED", "Event relationship configuration does not match the exact reviewed CloudFormation mapping.", SourceReference{Document: DocumentArchitecture, EdgeID: connection.ID})
		return false
	}
	return true
}

func cloudFormationDiagnosticCode(code string) string {
	if strings.HasPrefix(code, "TARGET_") {
		return "CLOUDFORMATION_" + strings.TrimPrefix(code, "TARGET_")
	}
	return code
}

func (renderer *cloudFormationRenderer) isCurrentCatalog() bool {
	return isCurrentAwsCatalog(renderer.model.Provenance.Catalog)
}

func (renderer *cloudFormationRenderer) relatedResources(nodeID string, relationship string, nodeIsTarget bool) []NormalizedResource {
	result := []NormalizedResource{}
	for _, connection := range renderer.model.Connections {
		if connection.RelationshipType != relationship {
			continue
		}
		otherID := ""
		if nodeIsTarget && connection.Target.NodeID == nodeID {
			otherID = connection.Source.NodeID
		} else if !nodeIsTarget && connection.Source.NodeID == nodeID {
			otherID = connection.Target.NodeID
		}
		if otherID != "" {
			if resource, ok := renderer.resourceByID(otherID); ok {
				result = append(result, resource)
			}
		}
	}
	sort.Slice(result, func(left int, right int) bool {
		return compareUTF16(result[left].TargetKey+"\x00"+result[left].ID, result[right].TargetKey+"\x00"+result[right].ID) < 0
	})
	return result
}

func (renderer *cloudFormationRenderer) parentIDOfType(resource NormalizedResource, service string) (string, bool) {
	if resource.Parent == nil {
		return "", false
	}
	parent, ok := renderer.resourceByID(resource.Parent.NodeID)
	return resource.Parent.NodeID, ok && parent.ServiceType == service
}

func (renderer *cloudFormationRenderer) networkVPCID(resource NormalizedResource) (string, bool) {
	helper := &terraformRenderer{model: renderer.model}
	return helper.networkVPCID(resource)
}

func (renderer *cloudFormationRenderer) configStringList(resource NormalizedResource, key string) []string {
	values, _ := resource.Configuration.Values[key].Value.([]any)
	result := make([]string, 0, len(values))
	for _, value := range values {
		if text, ok := value.(string); ok {
			result = append(result, text)
		}
	}
	sort.Slice(result, func(left int, right int) bool { return compareUTF16(result[left], result[right]) < 0 })
	return result
}

func (renderer *cloudFormationRenderer) connectionBool(connection NormalizedConnection, key string) bool {
	value, _ := connection.Configuration.Values[key].Value.(bool)
	return value
}

func (renderer *cloudFormationRenderer) resourcePolicyForOwner(ownerID string) (terraformPolicyDocument, bool) {
	for _, document := range renderer.policyDocuments {
		if document.Kind == "resource" && document.Owner.ID == ownerID {
			return document, true
		}
	}
	return terraformPolicyDocument{}, false
}
