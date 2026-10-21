package compiler

import (
	"math"
	"regexp"
	"strings"

	"github.com/hashicorp/hcl/v2/hclwrite"
	"github.com/zclconf/go-cty/cty"
)

const serviceEc2Instance = "aws.ec2.instance"
const serviceInstanceProfile = "aws.iam.instance-profile"
const ec2SubnetRelationship = "aws.ec2.instance-uses-subnet"
const ec2GroupRelationship = "aws.ec2.instance-uses-security-group"
const ec2RoleRelationship = "aws.iam.role-binds-instance-profile"
const ec2ProfileRelationship = "aws.iam.instance-profile-supplies-instance"
const ec2RootKeyRelationship = "aws.kms.encrypts-instance-root"

var ec2ImagePattern = regexp.MustCompile(`^ami-[0-9a-f]{17}$`)
var ec2ProfileNamePattern = regexp.MustCompile(`^[A-Za-z0-9+=,.@_-]{1,128}$`)
var ec2Machines = map[string]string{"t3.micro": "x86_64", "t3.small": "x86_64", "t3.medium": "x86_64", "t4g.micro": "arm64", "t4g.small": "arm64", "t4g.medium": "arm64"}
var ec2ConfigurationKeys = []string{"imageId", "imageRegion", "imageArchitecture", "imageOperatingSystem", "imageVirtualization", "imageRootDeviceType", "imageRootDeviceName", "imageRootMinimumGiB", "imageRootOnly", "instanceType", "tenancy", "cpuCreditMode", "publicIpv4", "rootSizeGiB", "rootVolumeType", "rootEncrypted", "rootIops", "rootThroughputMiBps", "rootDeleteOnTermination", "rootEncryptionMode", "metadataAuthentication", "metadataEndpoint", "metadataHopLimit", "metadataIpv6", "metadataTags", "detailedMonitoring"}

func init() {
	terraformResourceTypeByService[serviceEc2Instance] = "aws_instance"
	terraformResourceTypeByService[serviceInstanceProfile] = "aws_iam_instance_profile"
	cloudFormationResourceTypeByService[serviceEc2Instance] = "AWS::EC2::Instance"
	cloudFormationResourceTypeByService[serviceInstanceProfile] = "AWS::IAM::InstanceProfile"
	networkingRelationshipContracts[ec2SubnetRelationship] = networkContract(serviceEc2Instance, "aws.ec2.instance.subnet", serviceSubnet, "aws.ec2.subnet.instance", 1, 128)
	networkingRelationshipContracts[ec2GroupRelationship] = networkContract(serviceEc2Instance, "aws.ec2.instance.security-group", serviceSecurityGroup, "aws.ec2.security-group.instance", 5, 128)
	networkingRelationshipContracts[ec2RoleRelationship] = networkContract("aws.iam.role", "aws.iam.role.assumable-role", serviceInstanceProfile, "aws.iam.instance-profile.role", 1, 1)
	networkingRelationshipContracts[ec2ProfileRelationship] = networkContract(serviceInstanceProfile, "aws.iam.instance-profile.instance", serviceEc2Instance, "aws.ec2.instance.instance-profile", 128, 1)
	networkingRelationshipContracts[ec2RootKeyRelationship] = networkContract(serviceKmsKey, "aws.kms.key.root-volume-encryption", serviceEc2Instance, "aws.ec2.instance.root-encryption-key", 128, 1)
	for _, rel := range []string{ec2SubnetRelationship, ec2GroupRelationship, ec2RoleRelationship, ec2ProfileRelationship, ec2RootKeyRelationship} {
		terraformRelationshipSupport[rel] = struct{}{}
	}
}
func (r *terraformRenderer) validateEc2Model() {
	names := map[string]bool{}
	for _, n := range r.model.Resources {
		if n.ServiceType != serviceEc2Instance && n.ServiceType != serviceInstanceProfile {
			continue
		}
		source := SourceReference{Document: DocumentArchitecture, NodeID: n.ID}
		reject := func(code, message string) { r.error("TARGET_EC2_"+code, message, source) }
		if !isCurrentAwsCatalog(r.model.Provenance.Catalog) {
			reject("CATALOG_UNSUPPORTED", "EC2/profile support requires the exact reviewed successor catalog.")
			continue
		}
		if n.Parent != nil || n.ResourceType != n.ServiceType || n.Lifecycle.Ownership != "user" || n.Lifecycle.Origin != "user" {
			reject("OWNERSHIP_INVALID", "EC2/profile requires exact user-owned root identities; generated/adopted/import ownership is unsupported.")
		}
		for _, external := range r.model.ExternalResources {
			for _, ref := range external.ArchitectureNodes {
				if ref.NodeID == n.ID {
					reject("EXTERNAL_UNSUPPORTED", "Reference-only and imported EC2/profile ownership need separate contracts.")
				}
			}
		}
		if n.ServiceType == serviceInstanceProfile {
			if !r.validateConfiguration(n, serviceInstanceProfile+".configuration", []string{"name", "path"}) {
				continue
			}
			if n.Configuration.Values["name"].Kind != "string" || n.Configuration.Values["path"].Kind != "string" || !ec2ProfileNamePattern.MatchString(r.configString(n, "name")) || r.configString(n, "path") != "/" {
				reject("PROFILE_CONFIGURATION_INVALID", "Use one explicit valid IAM profile name and root path.")
			}
			name := r.configString(n, "name")
			if names[name] {
				reject("PROFILE_NAME_DUPLICATE", "Modeled profile names must be distinct account-wide.")
			}
			names[name] = true
			roles := r.relatedResources(n.ID, ec2RoleRelationship, true)
			if len(roles) != 1 || roles[0].ServiceType != "aws.iam.role" || roles[0].Parent != nil || roles[0].Lifecycle.Ownership != "user" || roles[0].Lifecycle.Origin != "user" {
				reject("PROFILE_ROLE_INVALID", "Profile requires one exact user-owned IAM role.")
			} else {
				r.validateEc2Trust(n, roles[0])
			}
			continue
		}
		if !r.validateConfiguration(n, serviceEc2Instance+".configuration", ec2ConfigurationKeys) {
			continue
		}
		for _, key := range ec2ConfigurationKeys {
			kind := "string"
			switch key {
			case "imageRootMinimumGiB", "rootSizeGiB", "rootIops", "rootThroughputMiBps", "metadataHopLimit":
				kind = "integer"
			case "imageRootOnly", "publicIpv4", "rootEncrypted", "rootDeleteOnTermination", "detailedMonitoring":
				kind = "boolean"
			}
			if n.Configuration.Values[key].Kind != kind {
				reject("FIELD_KIND_INVALID", "Every EC2 launch field must use its exact reviewed literal value kind.")
			}
		}
		if !ec2ImagePattern.MatchString(r.configString(n, "imageId")) || r.configString(n, "imageRegion") != r.model.Provenance.Region {
			reject("IMAGE_INVALID", "An exact static AMI ID and declared matching Region are required; lookup/latest is unsupported.")
		}
		architecture, ok := ec2Machines[r.configString(n, "instanceType")]
		if !ok || r.configString(n, "imageArchitecture") != architecture {
			reject("IMAGE_TYPE_INVALID", "Admitted T3/x86_64 or T4g/arm64 image/type declarations must agree.")
		}
		for key, value := range map[string]string{"imageOperatingSystem": "linux", "imageVirtualization": "hvm", "imageRootDeviceType": "ebs", "tenancy": "default", "cpuCreditMode": "standard", "rootVolumeType": "gp3", "metadataAuthentication": "required", "metadataEndpoint": "enabled", "metadataIpv6": "disabled", "metadataTags": "disabled"} {
			if r.configString(n, key) != value {
				reject("MODE_UNSUPPORTED", "Only the reviewed Linux HVM EBS/private/IMDSv2/default-tenancy baseline is supported.")
			}
		}
		device := r.configString(n, "imageRootDeviceName")
		if device != "/dev/xvda" && device != "/dev/sda1" {
			reject("ROOT_DEVICE_INVALID", "Require the caller's actual supported AMI root device; do not infer it.")
		}
		minimum, size, hop := r.configNumber(n, "imageRootMinimumGiB"), r.configNumber(n, "rootSizeGiB"), r.configNumber(n, "metadataHopLimit")
		validInt := func(value, low, high float64) bool {
			return !math.IsNaN(value) && !math.IsInf(value, 0) && value == math.Trunc(value) && value >= low && value <= high
		}
		if !validInt(minimum, 1, 16384) || !validInt(size, 1, 16384) || size < minimum {
			reject("ROOT_SIZE_INVALID", "Root size must be 1-16384 whole GiB and at least the declared AMI minimum.")
		}
		if !validInt(hop, 1, 64) {
			reject("METADATA_INVALID", "Metadata token hop limit must be a whole 1-64 value.")
		}
		if !r.configBool(n, "imageRootOnly") || r.configBool(n, "publicIpv4") || !r.configBool(n, "rootEncrypted") || r.configNumber(n, "rootIops") != 3000 || r.configNumber(n, "rootThroughputMiBps") != 125 {
			reject("ROOT_OR_NETWORK_MODE_UNSUPPORTED", "Require root-only image declaration, private addressing and encrypted gp3 3000 IOPS/125 MiB/s baseline. Alternate throughput is unsupported.")
		}
		subnets := r.relatedResources(n.ID, ec2SubnetRelationship, false)
		groups := r.relatedResources(n.ID, ec2GroupRelationship, false)
		vpc := ""
		vpcOK := false
		if len(subnets) == 1 && subnets[0].ServiceType == serviceSubnet {
			vpc, vpcOK = r.networkVPCID(subnets[0])
		}
		if !vpcOK {
			reject("SUBNET_INVALID", "Connect one exact modeled subnet with canonical VPC/AZ ancestry.")
		}
		if len(groups) < 1 || len(groups) > 5 {
			reject("SECURITY_GROUPS_INVALID", "Select one to five exact modeled security groups.")
		}
		for _, g := range groups {
			groupVpc, groupOK := r.networkVPCID(g)
			if g.ServiceType != serviceSecurityGroup || !vpcOK || !groupOK || groupVpc != vpc {
				reject("CROSS_VPC_INVALID", "Every selected security group must belong to the subnet's exact VPC.")
			}
		}
		profiles := r.relatedResources(n.ID, ec2ProfileRelationship, true)
		if len(profiles) != 1 || profiles[0].ServiceType != serviceInstanceProfile {
			reject("INSTANCE_PROFILE_INVALID", "Connect one typed IAM instance profile, never a role ARN or pasted profile name.")
		}
		keys := r.relatedResources(n.ID, ec2RootKeyRelationship, true)
		mode := r.configString(n, "rootEncryptionMode")
		if mode == "default-key" {
			if len(keys) != 0 {
				reject("ROOT_KEY_INVALID", "EBS default-key mode cannot select a customer key.")
			}
		} else if mode == "customer-managed" {
			if len(keys) != 1 || keys[0].ServiceType != serviceKmsKey || keys[0].Parent != nil || !r.configBool(keys[0], "enabled") {
				reject("ROOT_KEY_INVALID", "Customer-key mode requires one enabled exact regional symmetric KMS key.")
			}
		} else {
			reject("ROOT_KEY_INVALID", "Unsupported root encryption mode.")
		}
	}
	for _, e := range r.model.Connections {
		rule := ec2RuleID(e.RelationshipType)
		if rule == "" {
			continue
		}
		if !isCurrentAwsCatalog(r.model.Provenance.Catalog) {
			r.error("TARGET_EC2_CATALOG_UNSUPPORTED", "EC2 relationships require the exact reviewed successor.", SourceReference{Document: DocumentArchitecture, EdgeID: e.ID})
		}
		if e.Configuration.SchemaID != rule+".connection" || e.Configuration.SchemaVersion != "1.0.0" || len(e.Configuration.Values) != 0 {
			r.error("TARGET_EC2_BINDING_INVALID", "EC2 binding requires its exact empty versioned configuration.", SourceReference{Document: DocumentArchitecture, EdgeID: e.ID})
		}
	}
}
func ec2RuleID(rel string) string {
	switch rel {
	case ec2SubnetRelationship, ec2GroupRelationship, ec2RoleRelationship, ec2ProfileRelationship:
		return rel
	case ec2RootKeyRelationship:
		return "aws.kms.key-encrypts-instance-root"
	}
	return ""
}
func (r *terraformRenderer) validateEc2Trust(profile, role NormalizedResource) {
	reject := func() {
		r.error("TARGET_EC2_TRUST_INVALID", "Profile role requires one canonical user-owned unconditional EC2-only service trust statement; no scope, conditions, grants or borrowed role binding.", SourceReference{Document: DocumentArchitecture, NodeID: profile.ID})
	}
	count := 0
	for _, e := range r.model.Connections {
		if e.Source.NodeID == role.ID && e.Source.Port == "aws.iam.role.assumable-role" {
			count++
		}
	}
	for _, external := range r.model.ExternalResources {
		for _, ref := range external.ArchitectureNodes {
			if ref.NodeID == role.ID {
				reject()
				return
			}
		}
	}
	trusts := r.relatedResources(role.ID, "aws.iam.role-owns-trust-policy", true)
	if count != 1 || len(trusts) != 1 {
		reject()
		return
	}
	trust := trusts[0]
	if !r.validateConfiguration(trust, "aws.iam.policy-document.configuration", []string{"policyKind", "policyName"}) {
		reject()
		return
	}
	if trust.ServiceType != "aws.iam.policy-document" || trust.Lifecycle.Ownership != "user" || trust.Lifecycle.Origin != "user" || r.configString(trust, "policyKind") != "trust" || trust.Parent == nil || trust.Parent.NodeID != role.ID || trust.Parent.TargetKey != role.TargetKey || trust.Parent.RelationshipType != "aws.iam.role-owns-trust-policy" {
		reject()
		return
	}
	statements := r.relatedResources(trust.ID, "aws.iam.policy-contains-statement", true)
	if len(statements) != 1 {
		reject()
		return
	}
	s := statements[0]
	if !r.validateConfigurationVersion(s, "aws.iam.policy-statement.configuration", "2.0.0", []string{"actions", "effect", "principalKind", "principals", "resourceExpressions", "statementId"}) {
		reject()
		return
	}
	if s.Configuration.Values["actions"].Kind != "string-list" || s.Configuration.Values["principals"].Kind != "string-list" || s.Configuration.Values["resourceExpressions"].Kind != "string-list" {
		reject()
		return
	}
	if s.ServiceType != "aws.iam.policy-statement" || s.Lifecycle.Ownership != "user" || s.Lifecycle.Origin != "user" || s.Parent == nil || s.Parent.NodeID != trust.ID || s.Parent.TargetKey != trust.TargetKey || s.Parent.RelationshipType != "aws.iam.policy-contains-statement" || r.configString(s, "effect") != "allow" || r.configString(s, "principalKind") != "service" || strings.Join(r.configStringList(s, "principals"), ",") != "ec2.amazonaws.com" || strings.Join(r.configStringList(s, "actions"), ",") != "sts:AssumeRole" || len(r.configStringList(s, "resourceExpressions")) != 0 {
		reject()
		return
	}
	if _, ok := s.Configuration.Values["resourceNode"]; ok {
		reject()
		return
	}
	for _, e := range r.model.Connections {
		if (e.RelationshipType == "aws.iam.statement-owns-condition" && e.Target.NodeID == s.ID) || (e.Source.NodeID == s.ID && strings.HasPrefix(e.RelationshipType, "aws.iam.authorizes-")) {
			reject()
			return
		}
		if e.RelationshipType == "aws.iam.role-owns-trust-policy" && e.Source.NodeID == trust.ID && (e.Source.Port != "aws.iam.policy-document.role-trust-policy" || e.Target.Port != "aws.iam.role.trust-policy" || e.Configuration.SchemaID != "aws.iam.role-trust-policy.attachment" || e.Configuration.SchemaVersion != "1.0.0" || len(e.Configuration.Values) != 0) {
			reject()
			return
		}
		if e.RelationshipType == "aws.iam.policy-contains-statement" && e.Source.NodeID == s.ID && (e.Source.Port != "aws.iam.policy-statement.policy-document" || e.Target.Port != "aws.iam.policy-document.statement" || e.Configuration.SchemaID != "aws.iam.policy-membership.connection" || e.Configuration.SchemaVersion != "1.0.0" || len(e.Configuration.Values) != 0) {
			reject()
			return
		}
	}
}
func ec2RoleDescription(model *NormalizedSolution, id string) string {
	if isCurrentAwsCatalog(model.Provenance.Catalog) {
		for _, e := range model.Connections {
			if (e.RelationshipType == ecsExecutionBinding || e.RelationshipType == ecsApplicationBinding) && e.Source.NodeID == id {
				return "CloudMarkup explicit ECS role; execution and task identities remain distinct."
			}
		}
	}
	if isCurrentAwsCatalog(model.Provenance.Catalog) {
		for _, e := range model.Connections {
			if e.RelationshipType == ec2RoleRelationship && e.Source.NodeID == id {
				return "CloudMarkup explicit EC2 instance-profile role."
			}
		}
	}
	return "CloudMarkup notes-API Lambda execution role."
}
func (r *terraformRenderer) renderEc2Resource(n NormalizedResource) {
	b := r.resourceBlock(n)
	body := b.Body()
	if n.ServiceType == serviceInstanceProfile {
		body.SetAttributeValue("name", cty.StringVal(r.configString(n, "name")))
		body.SetAttributeValue("path", cty.StringVal("/"))
		if role, ok := r.connectedResource(n.ID, ec2RoleRelationship, true); ok {
			body.SetAttributeRaw("role", r.resourceAttributeTokens(role.ID, "name"))
		}
		body.SetAttributeTraversal("tags", traversal("local", "tags"))
		appendBlock(r.file("identity.tf"), b)
		r.warning("EC2_PROFILE_AUTHORITY_EXTERNAL", "Review account-wide profile-name availability, IAM propagation and deploying-caller creation/PassRole authority externally.", SourceReference{Document: DocumentArchitecture, NodeID: n.ID})
		return
	}
	body.SetAttributeValue("ami", cty.StringVal(r.configString(n, "imageId")))
	body.SetAttributeValue("instance_type", cty.StringVal(r.configString(n, "instanceType")))
	body.SetAttributeValue("tenancy", cty.StringVal("default"))
	body.SetAttributeValue("associate_public_ip_address", cty.BoolVal(false))
	body.SetAttributeValue("monitoring", cty.BoolVal(r.configBool(n, "detailedMonitoring")))
	if subnet, ok := r.connectedResource(n.ID, ec2SubnetRelationship, false); ok {
		body.SetAttributeRaw("subnet_id", r.resourceAttributeTokens(subnet.ID, "id"))
	}
	groupTokens := []hclwrite.Tokens{}
	for _, g := range r.relatedResources(n.ID, ec2GroupRelationship, false) {
		groupTokens = append(groupTokens, r.resourceAttributeTokens(g.ID, "id"))
	}
	body.SetAttributeRaw("vpc_security_group_ids", tupleTokens(groupTokens...))
	if profile, ok := r.connectedResource(n.ID, ec2ProfileRelationship, true); ok {
		body.SetAttributeRaw("iam_instance_profile", r.resourceAttributeTokens(profile.ID, "name"))
	}
	credit := hclwrite.NewBlock("credit_specification", nil)
	credit.Body().SetAttributeValue("cpu_credits", cty.StringVal("standard"))
	body.AppendBlock(credit)
	metadata := hclwrite.NewBlock("metadata_options", nil)
	for _, pair := range [][2]string{{"http_tokens", "required"}, {"http_endpoint", "enabled"}, {"http_protocol_ipv6", "disabled"}, {"instance_metadata_tags", "disabled"}} {
		metadata.Body().SetAttributeValue(pair[0], cty.StringVal(pair[1]))
	}
	metadata.Body().SetAttributeValue("http_put_response_hop_limit", cty.NumberIntVal(int64(r.configInt(n, "metadataHopLimit"))))
	body.AppendBlock(metadata)
	root := hclwrite.NewBlock("root_block_device", nil)
	root.Body().SetAttributeValue("volume_type", cty.StringVal("gp3"))
	root.Body().SetAttributeValue("volume_size", cty.NumberIntVal(int64(r.configInt(n, "rootSizeGiB"))))
	root.Body().SetAttributeValue("encrypted", cty.BoolVal(true))
	root.Body().SetAttributeValue("iops", cty.NumberIntVal(3000))
	root.Body().SetAttributeValue("throughput", cty.NumberIntVal(125))
	root.Body().SetAttributeValue("delete_on_termination", cty.BoolVal(r.configBool(n, "rootDeleteOnTermination")))
	if key, ok := r.connectedResource(n.ID, ec2RootKeyRelationship, true); ok {
		root.Body().SetAttributeRaw("kms_key_id", r.resourceAttributeTokens(key.ID, "arn"))
	}
	body.AppendBlock(root)
	body.SetAttributeTraversal("tags", traversal("local", "tags"))
	appendBlock(r.file("compute.tf"), b)
	r.ec2Warnings(n)
}
func (r *terraformRenderer) ec2Warnings(n NormalizedResource) {
	for _, message := range []struct{ code, text string }{{"EC2_IMAGE_READINESS_EXTERNAL", "Image Region/architecture/boot/root-device/minimum/root-only declarations, launch/snapshot/key permissions and workload suitability require external evidence; export performs no image lookup."}, {"EC2_LAUNCH_READINESS_EXTERNAL", "Private addressing and a profile do not establish deployable authority, safe traffic/egress, a running application or recoverable replacement. Review caller PassRole/key rights and retained-disk cost/recovery externally; no bootstrap or grants are generated."}} {
		r.warning(message.code, message.text, SourceReference{Document: DocumentArchitecture, NodeID: n.ID})
	}
	if r.configInt(n, "metadataHopLimit") > 1 {
		r.warning("EC2_METADATA_HOP_REVIEW", "Metadata token hop limit exceeds the security baseline of 1; review the required reach.", SourceReference{Document: DocumentArchitecture, NodeID: n.ID})
	}
}
func (r *cloudFormationRenderer) renderEc2Resource(n NormalizedResource) {
	if n.ServiceType == serviceInstanceProfile {
		properties := map[string]any{"InstanceProfileName": r.configString(n, "name"), "Path": "/"}
		if role, ok := r.connectedResource(n.ID, ec2RoleRelationship, true); ok {
			properties["Roles"] = []any{r.resourceAttribute(role.ID, "name")}
		}
		r.addResource(r.logicalIDs[n.ID], cloudFormationResource{Type: "AWS::IAM::InstanceProfile", Properties: properties, Metadata: r.resourceMetadata(n)}, SourceReference{Document: DocumentArchitecture, NodeID: n.ID})
		r.warning("EC2_PROFILE_AUTHORITY_EXTERNAL", "Review account-wide profile-name availability, IAM propagation and deploying-caller creation/PassRole authority externally.", SourceReference{Document: DocumentArchitecture, NodeID: n.ID})
		return
	}
	groups := []any{}
	for _, g := range r.relatedResources(n.ID, ec2GroupRelationship, false) {
		groups = append(groups, r.resourceAttribute(g.ID, "id"))
	}
	network := map[string]any{"DeviceIndex": "0", "AssociatePublicIpAddress": false, "DeleteOnTermination": true, "GroupSet": groups}
	if subnet, ok := r.connectedResource(n.ID, ec2SubnetRelationship, false); ok {
		network["SubnetId"] = r.resourceAttribute(subnet.ID, "id")
	}
	root := map[string]any{"VolumeType": "gp3", "VolumeSize": r.configInt(n, "rootSizeGiB"), "Encrypted": true, "Iops": 3000, "DeleteOnTermination": r.configBool(n, "rootDeleteOnTermination")}
	if key, ok := r.connectedResource(n.ID, ec2RootKeyRelationship, true); ok {
		root["KmsKeyId"] = r.resourceAttribute(key.ID, "arn")
	}
	properties := map[string]any{"ImageId": r.configString(n, "imageId"), "InstanceType": r.configString(n, "instanceType"), "Tenancy": "default", "Monitoring": r.configBool(n, "detailedMonitoring"), "CreditSpecification": map[string]any{"CPUCredits": "standard"}, "NetworkInterfaces": []any{network}, "MetadataOptions": map[string]any{"HttpTokens": "required", "HttpEndpoint": "enabled", "HttpProtocolIpv6": "disabled", "InstanceMetadataTags": "disabled", "HttpPutResponseHopLimit": r.configInt(n, "metadataHopLimit")}, "BlockDeviceMappings": []any{map[string]any{"DeviceName": r.configString(n, "imageRootDeviceName"), "Ebs": root}}, "Tags": r.tagList()}
	if profile, ok := r.connectedResource(n.ID, ec2ProfileRelationship, true); ok {
		properties["IamInstanceProfile"] = r.resourceAttribute(profile.ID, "name")
	}
	r.addResource(r.logicalIDs[n.ID], cloudFormationResource{Type: "AWS::EC2::Instance", Properties: properties, Metadata: r.resourceMetadata(n)}, SourceReference{Document: DocumentArchitecture, NodeID: n.ID})
	helper := &terraformRenderer{model: r.model}
	helper.ec2Warnings(n)
	r.diagnostics = append(r.diagnostics, helper.diagnostics...)
}
