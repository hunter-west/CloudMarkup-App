package compiler

import (
	"math"
	"net/netip"
	"regexp"
	"strconv"
	"strings"

	"github.com/hashicorp/hcl/v2/hclwrite"
	"github.com/zclconf/go-cty/cty"
)

const (
	serviceFsxLustre          = "aws.fsx.lustre-file-system"
	serviceFsxWindows         = "aws.fsx.windows-file-system"
	serviceFsxOpenZFS         = "aws.fsx.openzfs-file-system"
	serviceFsxONTAP           = "aws.fsx.ontap-file-system"
	serviceFsxSVM             = "aws.fsx.ontap-storage-virtual-machine"
	serviceFsxVolume          = "aws.fsx.ontap-volume"
	fsxRepositoryRelationship = "aws.fsx.lustre-imports-s3"
	fsxSVMRelationship        = "aws.fsx.ontap-svm-uses-file-system"
	fsxVolumeRelationship     = "aws.fsx.ontap-volume-uses-svm"
)

var fsxConfigurationKeys = map[string][]string{
	serviceFsxLustre:  {"storageCapacity", "perUnitStorageThroughput", "dataCompressionType"},
	serviceFsxWindows: {"storageCapacity", "throughputCapacity", "deploymentType", "activeDirectoryId", "automaticBackupRetentionDays"},
	serviceFsxOpenZFS: {"storageCapacity", "throughputCapacity", "automaticBackupRetentionDays", "clientCidr"},
	serviceFsxONTAP:   {"storageCapacity", "throughputCapacity", "automaticBackupRetentionDays"},
	serviceFsxSVM:     {"name"},
	serviceFsxVolume:  {"name", "sizeInMegabytes", "junctionPath"},
}

func isFsxService(service string) bool { _, ok := fsxConfigurationKeys[service]; return ok }

func init() {
	for _, mode := range []string{"reads", "writes"} {
		relation := "aws.lambda." + mode + "-s3-bucket"
		port := "aws.lambda.function.data-read"
		if mode == "writes" {
			port = "aws.lambda.function.data-write"
		}
		networkingRelationshipContracts[relation] = networkContract("aws.lambda.function", port, "aws.s3.bucket", "aws.s3.bucket.object-api", 16, 64)
		terraformRelationshipSupport[relation] = struct{}{}
	}

	for service, target := range map[string]string{serviceFsxLustre: "aws_fsx_lustre_file_system", serviceFsxWindows: "aws_fsx_windows_file_system", serviceFsxOpenZFS: "aws_fsx_openzfs_file_system", serviceFsxONTAP: "aws_fsx_ontap_file_system", serviceFsxSVM: "aws_fsx_ontap_storage_virtual_machine", serviceFsxVolume: "aws_fsx_ontap_volume"} {
		terraformResourceTypeByService[service] = target
		cloudFormationResourceTypeByService[service] = "AWS::FSx::FileSystem"
	}
	cloudFormationResourceTypeByService[serviceFsxSVM] = "AWS::FSx::StorageVirtualMachine"
	cloudFormationResourceTypeByService[serviceFsxVolume] = "AWS::FSx::Volume"
	for _, service := range []string{serviceFsxLustre, serviceFsxWindows, serviceFsxOpenZFS, serviceFsxONTAP} {
		maximum := 1
		if service == serviceFsxWindows {
			maximum = 2
		}
		networkingRelationshipContracts[service+"-uses-subnet"] = networkContract(service, service+".subnets", serviceSubnet, "aws.ec2.subnet.fsx", maximum, 256)
		networkingRelationshipContracts[service+"-uses-security-group"] = networkContract(service, service+".security-groups", serviceSecurityGroup, "aws.ec2.security-group.fsx", 5, 256)
	}
	networkingRelationshipContracts[fsxRepositoryRelationship] = networkContract(serviceFsxLustre, serviceFsxLustre+".s3-repository", "aws.s3.bucket", "aws.s3.bucket.object-api", 1, 256)
	networkingRelationshipContracts[fsxSVMRelationship] = networkContract(serviceFsxSVM, serviceFsxSVM+".file-system", serviceFsxONTAP, serviceFsxONTAP+".storage-virtual-machines", 1, 256)
	networkingRelationshipContracts[fsxVolumeRelationship] = networkContract(serviceFsxVolume, serviceFsxVolume+".storage-virtual-machine", serviceFsxSVM, serviceFsxSVM+".volumes", 1, 256)
	for relationship := range networkingRelationshipContracts {
		if strings.HasPrefix(relationship, "aws.fsx.") {
			terraformRelationshipSupport[relationship] = struct{}{}
		}
	}
}

func (renderer *terraformRenderer) fsxPhysicalZone(subnet NormalizedResource) (string, bool) {
	current := subnet
	zoneName := ""
	for _, step := range []struct{ child, parent, relationship string }{
		{serviceSubnet, serviceAvailabilityZone, "aws.ec2.availability-zone-contains-subnet"},
		{serviceAvailabilityZone, serviceVPC, "aws.ec2.vpc-contains-availability-zone"},
		{serviceVPC, serviceRegionBoundary, "aws.region.contains-vpc"},
	} {
		if current.ServiceType != step.child || current.Parent == nil || current.Parent.RelationshipType != step.relationship {
			return "", false
		}
		parent, ok := renderer.resourceByID(current.Parent.NodeID)
		backing := renderer.relatedResources(current.ID, step.relationship, true)
		if !ok || parent.ServiceType != step.parent || current.Parent.TargetKey != parent.TargetKey || len(backing) != 1 || backing[0].ID != parent.ID {
			return "", false
		}
		if step.parent == serviceAvailabilityZone {
			zoneName = renderer.configString(parent, "zoneName")
		}
		current = parent
	}
	region := renderer.model.Provenance.Region
	valid := current.Parent == nil && renderer.configString(current, "regionName") == region && strings.HasPrefix(zoneName, region) && len(zoneName) == len(region)+1 && zoneName[len(region)] >= 'a' && zoneName[len(region)] <= 'z'
	return zoneName, valid
}

func (renderer *terraformRenderer) validateFsxModel() {
	for _, connection := range renderer.model.Connections {
		if (strings.HasPrefix(connection.RelationshipType, "aws.fsx.") || connection.RelationshipType == "aws.lambda.reads-s3-bucket" || connection.RelationshipType == "aws.lambda.writes-s3-bucket") && !isCurrentAwsCatalog(renderer.model.Provenance.Catalog) {
			renderer.error("TARGET_FSX_CATALOG_REQUIRED", "FSx relationships require the installed current AWS catalog.", SourceReference{Document: DocumentArchitecture, EdgeID: connection.ID})
		}
	}
	for _, resource := range renderer.model.Resources {
		keys, exists := fsxConfigurationKeys[resource.ServiceType]
		if !exists {
			continue
		}
		source := SourceReference{Document: DocumentArchitecture, NodeID: resource.ID}
		invalid := func(message string) { renderer.error("TARGET_FSX_CONFIGURATION_INVALID", message, source) }
		if !isCurrentAwsCatalog(renderer.model.Provenance.Catalog) {
			renderer.error("TARGET_FSX_CATALOG_REQUIRED", "FSx resources require the installed current AWS catalog.", source)
			continue
		}
		if resource.ResourceType != resource.ServiceType || !renderer.validateConfiguration(resource, resource.ServiceType+".configuration", keys) {
			continue
		}
		for _, external := range renderer.model.ExternalResources {
			for _, node := range external.ArchitectureNodes {
				if node.NodeID == resource.ID && external.OwnershipState != "managed-by-generated-iac" {
					invalid("FSx resources require explicit generated-IaC ownership in this catalog.")
				}
			}
		}
		integer := func(key string, min, max int, choices ...int) int {
			v := renderer.configNumber(resource, key)
			valid := !math.IsNaN(v) && !math.IsInf(v, 0) && math.Trunc(v) == v && v >= float64(min) && v <= float64(max)
			if len(choices) > 0 {
				found := false
				for _, c := range choices {
					if v == float64(c) {
						found = true
					}
				}
				valid = valid && found
			}
			if !valid {
				invalid("FSx numeric setting is outside the supported family bounds.")
			}
			return int(v)
		}
		if strings.HasSuffix(resource.ServiceType, "-file-system") {
			subnets := renderer.relatedResources(resource.ID, resource.ServiceType+"-uses-subnet", false)
			groups := renderer.relatedResources(resource.ID, resource.ServiceType+"-uses-security-group", false)
			expected := 1
			if resource.ServiceType == serviceFsxWindows && renderer.configString(resource, "deploymentType") == "MULTI_AZ_1" {
				expected = 2
			}
			if len(subnets) != expected || len(groups) < 1 || len(groups) > 5 {
				invalid("FSx requires the exact subnet count for its deployment mode and one to five security groups.")
			}
			vpc := ""
			for _, network := range append(subnets, groups...) {
				id, ok := renderer.networkVPCID(network)
				if !ok || (vpc != "" && vpc != id) {
					invalid("FSx subnet and security-group associations must resolve to one VPC.")
				}
				vpc = id
			}
			if expected == 2 && len(subnets) == 2 {
				a, aok := renderer.fsxPhysicalZone(subnets[0])
				b, bok := renderer.fsxPhysicalZone(subnets[1])
				if !aok || !bok || a == b {
					invalid("Multi-AZ Windows FSx requires canonical subnets in two distinct physical Availability Zones of the architecture's AWS Region.")
				}
			}
		}
		if isCurrentAwsCatalog(renderer.model.Provenance.Catalog) && (resource.ServiceType == serviceFsxLustre || resource.ServiceType == serviceFsxONTAP) {
			capacity := renderer.configNumber(resource, "storageCapacity")
			valid := !math.IsNaN(capacity) && !math.IsInf(capacity, 0) && math.Trunc(capacity) == capacity
			message := "Single-HA-pair ONTAP SSD storage capacity must be between 1024 and 524288 GiB."
			if resource.ServiceType == serviceFsxLustre {
				valid = valid && capacity >= 1200 && capacity <= 2400000 && (capacity == 1200 || math.Mod(capacity, 2400) == 0)
				message = "PERSISTENT_2 SSD Lustre storage capacity must be 1200 GiB or a multiple of 2400 GiB within the catalog limit."
			} else {
				valid = valid && capacity >= 1024 && capacity <= 524288
			}
			if !valid {
				renderer.error("TARGET_FSX_STORAGE_CAPACITY_INVALID", message, source)
			}
		}
		switch resource.ServiceType {
		case serviceFsxLustre:
			subnets := renderer.relatedResources(resource.ID, resource.ServiceType+"-uses-subnet", false)
			groups := renderer.relatedResources(resource.ID, resource.ServiceType+"-uses-security-group", false)
			if len(subnets) == 1 {
				subnet, subnetError := netip.ParsePrefix(renderer.configString(subnets[0], "cidrBlock"))
				for _, direction := range []string{"ingress", "egress"} {
					for _, port := range []int{988, 1018, 1019, 1020, 1021, 1022, 1023} {
						covered := false
						for _, group := range groups {
							for _, rule := range renderer.relatedResources(group.ID, "aws.ec2.security-group-owns-"+direction+"-rule", true) {
								cidrKey := "sourceIpv4Cidr"
								if direction == "egress" {
									cidrKey = "destinationIpv4Cidr"
								}
								allowed, err := netip.ParsePrefix(renderer.configString(rule, cidrKey))
								protocol := renderer.configString(rule, "protocol")
								if subnetError == nil && err == nil && subnet.Addr().Is4() && allowed.Addr().Is4() && allowed == allowed.Masked() && (direction == "egress" || allowed.Bits() > 0) && allowed.Bits() <= subnet.Bits() && allowed.Contains(subnet.Masked().Addr()) && (protocol == "-1" || protocol == "tcp" && renderer.configNumber(rule, "fromPort") <= float64(port) && renderer.configNumber(rule, "toPort") >= float64(port)) {
									covered = true
								}
							}
						}
						if !covered {
							invalid("Lustre requires explicit " + direction + " for TCP 988 and 1018-1023 covering its entire subnet.")
							break
						}
					}
				}
			}
			if integer("storageCapacity", 1200, 2400000)%1200 != 0 {
				invalid("Lustre persistent SSD capacity must be a multiple of 1200 GiB.")
			}
			integer("perUnitStorageThroughput", 125, 1000, 125, 250, 500, 1000)
			compression := renderer.configString(resource, "dataCompressionType")
			if compression != "NONE" && compression != "LZ4" {
				invalid("Lustre compression must be NONE or LZ4.")
			}
		case serviceFsxWindows:
			integer("storageCapacity", 32, 65536)
			integer("throughputCapacity", 8, 2048, 8, 16, 32, 64, 128, 256, 512, 1024, 2048)
			integer("automaticBackupRetentionDays", 1, 90)
			mode := renderer.configString(resource, "deploymentType")
			if mode != "SINGLE_AZ_2" && mode != "MULTI_AZ_1" {
				invalid("Windows FSx deployment mode is unsupported.")
			}
			if !regexp.MustCompile("^d-[0-9a-f]{10}$").MatchString(renderer.configString(resource, "activeDirectoryId")) {
				invalid("Windows FSx requires an existing AWS Managed Microsoft AD directory ID.")
			}
		case serviceFsxOpenZFS:
			integer("storageCapacity", 64, 524288)
			integer("throughputCapacity", 160, 10240, 160, 320, 640, 1280, 2560, 3840, 5120, 7680, 10240)
			integer("automaticBackupRetentionDays", 1, 90)
			prefix, err := netip.ParsePrefix(renderer.configString(resource, "clientCidr"))
			if err != nil || !prefix.Addr().Is4() || prefix.Bits() == 0 || prefix != prefix.Masked() {
				invalid("OpenZFS requires one explicit bounded canonical IPv4 NFS client CIDR.")
			}
		case serviceFsxONTAP:
			integer("storageCapacity", 1024, 1048576)
			throughput := renderer.configNumber(resource, "throughputCapacity")
			if throughput != 1536 && throughput != 3072 && throughput != 6144 {
				renderer.error("TARGET_FSX_ONTAP_THROUGHPUT_INVALID", "SINGLE_AZ_2 with one HA pair requires 1536, 3072 or 6144 MBps. Review cost and choose explicitly; saved 384/768 values are not upgraded automatically.", SourceReference{Document: DocumentArchitecture, NodeID: resource.ID, Path: "$.semantic.configuration.values.throughputCapacity"})
			}
			integer("automaticBackupRetentionDays", 1, 90)
		case serviceFsxSVM:
			if !regexp.MustCompile("^[A-Za-z][A-Za-z0-9_]{0,46}$").MatchString(renderer.configString(resource, "name")) {
				invalid("ONTAP virtual machine name is invalid.")
			}
			if len(renderer.relatedResources(resource.ID, fsxSVMRelationship, false)) != 1 {
				invalid("ONTAP storage virtual machine must select exactly one file system.")
			}
		case serviceFsxVolume:
			integer("sizeInMegabytes", 20, 314572800)
			if !regexp.MustCompile("^[A-Za-z][A-Za-z0-9_]{0,202}$").MatchString(renderer.configString(resource, "name")) || !regexp.MustCompile("^/[A-Za-z0-9_/-]{1,127}$").MatchString(renderer.configString(resource, "junctionPath")) {
				invalid("ONTAP volume name or junction path is invalid.")
			}
			if len(renderer.relatedResources(resource.ID, fsxVolumeRelationship, false)) != 1 {
				invalid("ONTAP volume must select exactly one storage virtual machine.")
			}
		}
	}
}

func (renderer *terraformRenderer) renderFsx(resource NormalizedResource) {
	block := renderer.resourceBlock(resource)
	body := block.Body()
	str := func(key, value string) { body.SetAttributeValue(key, cty.StringVal(value)) }
	number := func(key, property string) {
		body.SetAttributeValue(key, cty.NumberIntVal(int64(renderer.configInt(resource, property))))
	}
	if strings.HasSuffix(resource.ServiceType, "-file-system") {
		for _, association := range [][2]string{{"-uses-subnet", "subnet_ids"}, {"-uses-security-group", "security_group_ids"}} {
			relation, attribute := association[0], association[1]
			refs := []hclwrite.Tokens{}
			for _, r := range renderer.relatedResources(resource.ID, resource.ServiceType+relation, false) {
				refs = append(refs, renderer.resourceAttributeTokens(r.ID, "id"))
			}
			body.SetAttributeRaw(attribute, tupleTokens(refs...))
		}
		number("storage_capacity", "storageCapacity")
		str("storage_type", "SSD")
	}
	switch resource.ServiceType {
	case serviceFsxLustre:
		str("deployment_type", "PERSISTENT_2")
		str("file_system_type_version", "2.15")
		number("per_unit_storage_throughput", "perUnitStorageThroughput")
		str("data_compression_type", renderer.configString(resource, "dataCompressionType"))
	case serviceFsxWindows:
		str("deployment_type", renderer.configString(resource, "deploymentType"))
		str("active_directory_id", renderer.configString(resource, "activeDirectoryId"))
		number("throughput_capacity", "throughputCapacity")
		number("automatic_backup_retention_days", "automaticBackupRetentionDays")
		subnets := renderer.relatedResources(resource.ID, resource.ServiceType+"-uses-subnet", false)
		if renderer.configString(resource, "deploymentType") == "MULTI_AZ_1" && len(subnets) > 0 {
			body.SetAttributeRaw("preferred_subnet_id", renderer.resourceAttributeTokens(subnets[0].ID, "id"))
		}
	case serviceFsxOpenZFS:
		str("deployment_type", "SINGLE_AZ_2")
		number("throughput_capacity", "throughputCapacity")
		number("automatic_backup_retention_days", "automaticBackupRetentionDays")
		root := hclwrite.NewBlock("root_volume_configuration", nil)
		exports := hclwrite.NewBlock("nfs_exports", nil)
		client := hclwrite.NewBlock("client_configurations", nil)
		client.Body().SetAttributeValue("clients", cty.StringVal(renderer.configString(resource, "clientCidr")))
		client.Body().SetAttributeValue("options", stringListValue([]string{"rw", "crossmnt", "root_squash"}))
		exports.Body().AppendBlock(client)
		root.Body().AppendBlock(exports)
		body.AppendBlock(root)
	case serviceFsxONTAP:
		str("deployment_type", "SINGLE_AZ_2")
		if isCurrentAwsCatalog(renderer.model.Provenance.Catalog) {
			subnets := renderer.relatedResources(resource.ID, resource.ServiceType+"-uses-subnet", false)
			if len(subnets) == 1 {
				body.SetAttributeRaw("preferred_subnet_id", renderer.resourceAttributeTokens(subnets[0].ID, "id"))
			}
		}
		number("throughput_capacity_per_ha_pair", "throughputCapacity")
		body.SetAttributeValue("ha_pairs", cty.NumberIntVal(1))
		number("automatic_backup_retention_days", "automaticBackupRetentionDays")
	case serviceFsxSVM:
		owner, _ := renderer.connectedResource(resource.ID, fsxSVMRelationship, false)
		body.SetAttributeRaw("file_system_id", renderer.resourceAttributeTokens(owner.ID, "id"))
		str("name", renderer.configString(resource, "name"))
		str("root_volume_security_style", "UNIX")
	case serviceFsxVolume:
		owner, _ := renderer.connectedResource(resource.ID, fsxVolumeRelationship, false)
		body.SetAttributeRaw("storage_virtual_machine_id", renderer.resourceAttributeTokens(owner.ID, "id"))
		str("name", renderer.configString(resource, "name"))
		str("junction_path", renderer.configString(resource, "junctionPath"))
		number("size_in_megabytes", "sizeInMegabytes")
		str("security_style", "UNIX")
		str("ontap_volume_type", "RW")
		str("volume_style", "FLEXVOL")
		body.SetAttributeValue("storage_efficiency_enabled", cty.BoolVal(true))
	}
	body.SetAttributeTraversal("tags", traversal("local", "tags"))
	appendPreventDestroy(body, true)
	appendBlock(renderer.file("data.tf"), block)
	if resource.ServiceType == serviceFsxLustre {
		for _, bucket := range renderer.relatedResources(resource.ID, fsxRepositoryRelationship, false) {
			dra := hclwrite.NewBlock("resource", []string{"aws_fsx_data_repository_association", renderer.resourceNames[resource.ID] + "_s3"})
			b := dra.Body()
			b.SetAttributeRaw("file_system_id", renderer.resourceAttributeTokens(resource.ID, "id"))
			b.SetAttributeValue("file_system_path", cty.StringVal("/"))
			b.SetAttributeRaw("data_repository_path", formatTokens("s3://%s", renderer.resourceAttributeTokens(bucket.ID, "id")))
			b.SetAttributeValue("batch_import_meta_data_on_create", cty.BoolVal(true))
			s3 := hclwrite.NewBlock("s3", nil)
			policy := hclwrite.NewBlock("auto_import_policy", nil)
			policy.Body().SetAttributeValue("events", stringListValue([]string{"NEW", "CHANGED"}))
			s3.Body().AppendBlock(policy)
			b.AppendBlock(s3)
			appendBlock(renderer.file("data.tf"), dra)
		}
	}
}

func (renderer *cloudFormationRenderer) renderFsx(resource NormalizedResource) {
	props := map[string]any{"Tags": renderer.tagList()}
	specific := map[string]any{}
	if strings.HasSuffix(resource.ServiceType, "-file-system") {
		props["StorageCapacity"] = renderer.configInt(resource, "storageCapacity")
		props["StorageType"] = "SSD"
		for relation, attribute := range map[string]string{"-uses-subnet": "SubnetIds", "-uses-security-group": "SecurityGroupIds"} {
			refs := []any{}
			for _, r := range renderer.relatedResources(resource.ID, resource.ServiceType+relation, false) {
				refs = append(refs, renderer.resourceAttribute(r.ID, "id"))
			}
			props[attribute] = refs
		}
	}
	switch resource.ServiceType {
	case serviceFsxLustre:
		props["FileSystemType"] = "LUSTRE"
		props["FileSystemTypeVersion"] = "2.15"
		props["LustreConfiguration"] = map[string]any{"DeploymentType": "PERSISTENT_2", "PerUnitStorageThroughput": renderer.configInt(resource, "perUnitStorageThroughput"), "DataCompressionType": renderer.configString(resource, "dataCompressionType")}
	case serviceFsxWindows:
		props["FileSystemType"] = "WINDOWS"
		specific = map[string]any{"DeploymentType": renderer.configString(resource, "deploymentType"), "ThroughputCapacity": renderer.configInt(resource, "throughputCapacity"), "ActiveDirectoryId": renderer.configString(resource, "activeDirectoryId"), "AutomaticBackupRetentionDays": renderer.configInt(resource, "automaticBackupRetentionDays")}
		subnets := renderer.relatedResources(resource.ID, resource.ServiceType+"-uses-subnet", false)
		if renderer.configString(resource, "deploymentType") == "MULTI_AZ_1" && len(subnets) > 0 {
			specific["PreferredSubnetId"] = renderer.resourceAttribute(subnets[0].ID, "id")
		}
		props["WindowsConfiguration"] = specific
	case serviceFsxOpenZFS:
		props["FileSystemType"] = "OPENZFS"
		props["OpenZFSConfiguration"] = map[string]any{"DeploymentType": "SINGLE_AZ_2", "ThroughputCapacity": renderer.configInt(resource, "throughputCapacity"), "AutomaticBackupRetentionDays": renderer.configInt(resource, "automaticBackupRetentionDays"), "RootVolumeConfiguration": map[string]any{"NfsExports": []any{map[string]any{"ClientConfigurations": []any{map[string]any{"Clients": renderer.configString(resource, "clientCidr"), "Options": []string{"rw", "crossmnt", "root_squash"}}}}}}}
	case serviceFsxONTAP:
		props["FileSystemType"] = "ONTAP"
		props["OntapConfiguration"] = map[string]any{"DeploymentType": "SINGLE_AZ_2", "HAPairs": 1, "ThroughputCapacityPerHAPair": renderer.configInt(resource, "throughputCapacity"), "AutomaticBackupRetentionDays": renderer.configInt(resource, "automaticBackupRetentionDays")}
	case serviceFsxSVM:
		owner, _ := renderer.connectedResource(resource.ID, fsxSVMRelationship, false)
		props["FileSystemId"] = renderer.resourceAttribute(owner.ID, "id")
		props["Name"] = renderer.configString(resource, "name")
		props["RootVolumeSecurityStyle"] = "UNIX"
	case serviceFsxVolume:
		owner, _ := renderer.connectedResource(resource.ID, fsxVolumeRelationship, false)
		props["VolumeType"] = "ONTAP"
		props["Name"] = renderer.configString(resource, "name")
		props["OntapConfiguration"] = map[string]any{"StorageVirtualMachineId": renderer.resourceAttribute(owner.ID, "id"), "JunctionPath": renderer.configString(resource, "junctionPath"), "SizeInMegabytes": strconv.Itoa(renderer.configInt(resource, "sizeInMegabytes")), "SecurityStyle": "UNIX", "OntapVolumeType": "RW", "StorageEfficiencyEnabled": "true", "VolumeStyle": "FLEXVOL"}
	}
	renderer.addResource(renderer.logicalIDs[resource.ID], cloudFormationResource{Type: cloudFormationResourceTypeByService[resource.ServiceType], Properties: props, Metadata: renderer.resourceMetadata(resource), DeletionPolicy: "Retain", UpdateReplacePolicy: "Retain"}, SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
	if resource.ServiceType == serviceFsxLustre {
		for _, bucket := range renderer.relatedResources(resource.ID, fsxRepositoryRelationship, false) {
			renderer.addResource(renderer.derivedLogicalID(renderer.logicalIDs[resource.ID]+" S3 repository"), cloudFormationResource{Type: "AWS::FSx::DataRepositoryAssociation", Properties: map[string]any{"FileSystemId": renderer.resourceAttribute(resource.ID, "id"), "FileSystemPath": "/", "DataRepositoryPath": cloudFormationJoin("s3://", renderer.resourceAttribute(bucket.ID, "id")), "BatchImportMetaDataOnCreate": true, "S3": map[string]any{"AutoImportPolicy": map[string]any{"Events": []string{"NEW", "CHANGED"}}}}, Metadata: renderer.resourceMetadata(resource)}, SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
		}
	}
}
