package compiler

import (
	_ "embed"
	"encoding/json"
)

const serviceEbsVolume = "aws.ebs.volume"
const serviceEbsAttachment = "aws.ebs.volume-attachment"
const ebsZone = "aws.ebs.availability-zone-contains-volume"
const ebsOwner = "aws.ebs.volume-owns-attachment"
const ebsInstance = "aws.ebs.attachment-uses-instance"
const ebsKey = "aws.ebs.volume-uses-key"

//go:embed internal/contracts/ebs-configuration-v1.json
var ebsConfigurationJSON []byte
var ebsSchemas = func() map[string]map[string]ecsField {
	var s map[string]map[string]ecsField
	if json.Unmarshal(ebsConfigurationJSON, &s) != nil {
		panic("invalid reviewed EBS schema")
	}
	return s
}()
var ebsContracts = map[string]ecsBinding{ebsZone: {serviceEbsVolume, "availability-zone", serviceAvailabilityZone, "ebs-volume", 1, 128}, ebsOwner: {serviceEbsAttachment, "volume", serviceEbsVolume, "attachment", 1, 1}, ebsInstance: {serviceEbsAttachment, "instance", serviceEc2Instance, "data-volume", 1, 4}, ebsKey: {serviceEbsVolume, "encryption-key", serviceKmsKey, "ebs-volume", 1, 128}}

func init() {
	terraformResourceTypeByService[serviceEbsVolume] = "aws_ebs_volume"
	terraformResourceTypeByService[serviceEbsAttachment] = "aws_volume_attachment"
	cloudFormationResourceTypeByService[serviceEbsVolume] = "AWS::EC2::Volume"
	cloudFormationResourceTypeByService[serviceEbsAttachment] = "AWS::EC2::VolumeAttachment"
	for rel, b := range ebsContracts {
		networkingRelationshipContracts[rel] = networkContract(b.source, b.source+"."+b.sourcePort, b.target, b.target+"."+b.targetPort, b.sourceMax, b.targetMax)
		terraformRelationshipSupport[rel] = struct{}{}
	}
}
func (r *terraformRenderer) validateEbsModel() {
	found := false
	for _, n := range r.model.Resources {
		if _, ok := ebsSchemas[n.ServiceType]; ok {
			found = true
		}
	}
	if !found {
		return
	}
	reject := func(n NormalizedResource, code, message string) {
		r.error("TARGET_EBS_"+code, message, SourceReference{Document: DocumentArchitecture, NodeID: n.ID})
	}
	for _, n := range r.model.Resources {
		if isNetworkingService(n.ServiceType) || n.ServiceType == serviceRegionBoundary {
			if !r.elbSafe(n) {
				reject(n, "NETWORK_OWNERSHIP_INVALID", "EBS networking must be exact modeled user-owned dependencies; no external/adopted/generated networking.")
			}
		}
	}
	for _, e := range r.model.Connections {
		if b, ok := ebsContracts[e.RelationshipType]; ok {
			p := e.Lifecycle.Provenance
			user := e.Lifecycle.Ownership == "user" && (e.Lifecycle.Origin == "user" || e.Lifecycle.Origin == "template" || e.Lifecycle.Origin == "ai-accepted" || e.Lifecycle.Origin == "migration")
			generated := e.Lifecycle.Ownership == "generated" && e.Lifecycle.Origin == "connection-rule" && p != nil && p.GeneratorKind == "connection-rule" && p.GeneratorID == e.RelationshipType && p.GeneratorVersion == "1.0.0" && p.OperationID != "" && len(p.DependentNodeIDs) == 2 && containsString(p.DependentNodeIDs, e.Source.NodeID) && containsString(p.DependentNodeIDs, e.Target.NodeID) && len(p.DependentEdgeIDs) == 0
			s, sok := r.resourceByID(e.Source.NodeID)
			t, tok := r.resourceByID(e.Target.NodeID)
			if !user && !generated || !sok || !tok || s.ServiceType != b.source || s.ResourceType != b.source || t.ServiceType != b.target || t.ResourceType != b.target || e.Source.Port != b.source+"."+b.sourcePort || e.Target.Port != b.target+"."+b.targetPort || e.Configuration.SchemaID != e.RelationshipType+".connection" || e.Configuration.SchemaVersion != "1.0.0" || len(e.Configuration.Values) != 0 {
				r.error("TARGET_EBS_BINDING_INVALID", "Use exact closed binding ports/schema and authorized provenance.", SourceReference{Document: DocumentArchitecture, EdgeID: e.ID})
			}
		}
	}
	for _, n := range r.model.Resources {
		if _, ok := ebsSchemas[n.ServiceType]; !ok {
			continue
		}
		if !isCurrentAwsCatalog(r.model.Provenance.Catalog) {
			reject(n, "CATALOG_UNSUPPORTED", "Use the exact reviewed EBS catalog.")
			continue
		}
		if !r.elbSafe(n) {
			reject(n, "OWNERSHIP_INVALID", "Use exact modeled user-owned volume/attachment; no imported/adopted/external/generated resource ownership.")
		}
		if !cloudfrontCommercialRegion(r.model.Provenance.Region) {
			reject(n, "REGION_INVALID", "Use a commercial AWS Region.")
		}
		if !r.validateEbsFields(n) {
			continue
		}
		if n.ServiceType == serviceEbsVolume {
			z := r.elbParent(n, serviceAvailabilityZone, ebsZone, false)
			v := r.elbParent(z, serviceVPC, "aws.ec2.vpc-contains-availability-zone", true)
			if z.ID == "" || v.ID == "" {
				reject(n, "AZ_INVALID", "Volume requires its exact canonical user-owned modeled AZ and VPC ancestry.")
			}
			keys := r.relatedResources(n.ID, ebsKey, false)
			if r.configString(n, "encryptionMode") == "account-default" && len(keys) != 0 {
				reject(n, "KEY_INVALID", "Account-default omits native key ID and cannot select a customer key.")
			}
			if r.configString(n, "encryptionMode") == "customer-managed" && (len(keys) != 1 || !r.elbSafe(keys[0]) || keys[0].ServiceType != serviceKmsKey || keys[0].Parent != nil || !r.configBool(keys[0], "enabled")) {
				reject(n, "KEY_INVALID", "Select one enabled exact modeled regional symmetric KMS key; key/grant authority stays external.")
			}
			if len(r.relatedResources(n.ID, ebsOwner, true)) > 1 {
				reject(n, "ATTACHMENT_INVALID", "gp3 has at most one canonical single attachment.")
			}
		} else {
			volume := r.elbParent(n, serviceEbsVolume, ebsOwner, false)
			instance := r.elbOne(n, ebsInstance, false)
			z := r.elbParent(volume, serviceAvailabilityZone, ebsZone, false)
			subnet := r.elbOne(instance, ec2SubnetRelationship, false)
			iz := r.elbZone(subnet)
			if volume.ID == "" || !r.elbSafe(instance) || instance.ServiceType != serviceEc2Instance || z.ID == "" || iz.ID == "" || z.ID != iz.ID || r.configString(z, "zoneName") != r.configString(iz, "zoneName") {
				reject(n, "PLACEMENT_INVALID", "Exact volume owner and one modeled Linux EC2 instance must share the same canonical physical AZ and Region.")
			}
			xs := r.relatedResources(instance.ID, ebsInstance, true)
			names := map[string]bool{}
			for _, x := range xs {
				device := r.configString(x, "deviceName")
				if names[device] {
					reject(n, "DEVICE_INVALID", "API device names must be distinct per instance.")
				}
				names[device] = true
			}
			if len(xs) > 4 || r.configString(instance, "imageRootDeviceName") == r.configString(n, "deviceName") {
				reject(n, "DEVICE_INVALID", "Use at most four additional /dev/sdf-/dev/sdi mappings; never replace the AMI root device.")
			}
		}
	}
}
func (r *terraformRenderer) ebsWarning(n NormalizedResource) {
	r.warning("EBS_READINESS_EXTERNAL", "Verify EBS/EC2 AZ capacity, quotas, default encryption key and deployer/KMS grant authority, guest NVMe identity and filesystem/mount, backups, termination behavior and safe unmount/detach externally. Attachment does not format or mount storage. TF prevent_destroy applies while configured; attachment skip_destroy skips detach. CF retains volume/attachment. Retention is not backup.", SourceReference{Document: DocumentArchitecture, NodeID: n.ID})
}
