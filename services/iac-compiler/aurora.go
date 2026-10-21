package compiler

import (
	_ "embed"
	"encoding/json"
	"strconv"
	"strings"
)

const serviceAuroraCluster = "aws.aurora.postgresql-cluster"
const serviceAuroraInstance = "aws.aurora.postgresql-instance"
const serviceAuroraParameters = "aws.aurora.postgresql-cluster-parameter-group"
const auroraSubnetBinding = "aws.aurora.cluster-uses-subnet-group"
const auroraParameterBinding = "aws.aurora.cluster-uses-parameter-group"
const auroraMemberBinding = "aws.aurora.cluster-has-instance"
const auroraGroupBinding = "aws.aurora.cluster-uses-security-group"

var auroraContracts = map[string]ecsBinding{
	auroraSubnetBinding:    {serviceRdsSubnetGroup, "aurora-cluster", serviceAuroraCluster, "subnet-group", 128, 1},
	auroraParameterBinding: {serviceAuroraParameters, "cluster", serviceAuroraCluster, "parameter-group", 128, 1},
	auroraMemberBinding:    {serviceAuroraCluster, "instance", serviceAuroraInstance, "cluster", 2, 1},
	auroraGroupBinding:     {serviceAuroraCluster, "security-group", serviceSecurityGroup, "aurora-cluster", 5, 128},
}

// Reviewed literal contracts; focused tests prove exact source-schema drift.
//
//go:embed internal/contracts/aurora-configuration-v1.json
var auroraConfigurationJSON []byte
var auroraSchemas = func() map[string]map[string]ecsField {
	var schemas map[string]map[string]ecsField
	if json.Unmarshal(auroraConfigurationJSON, &schemas) != nil {
		panic("invalid reviewed Aurora schema")
	}
	return schemas
}()

func init() {
	for service, native := range map[string]string{serviceAuroraCluster: "aws_rds_cluster", serviceAuroraInstance: "aws_rds_cluster_instance", serviceAuroraParameters: "aws_rds_cluster_parameter_group"} {
		terraformResourceTypeByService[service] = native
	}
	for service, native := range map[string]string{serviceAuroraCluster: "AWS::RDS::DBCluster", serviceAuroraInstance: "AWS::RDS::DBInstance", serviceAuroraParameters: "AWS::RDS::DBClusterParameterGroup"} {
		cloudFormationResourceTypeByService[service] = native
	}
	for rel, c := range auroraContracts {
		networkingRelationshipContracts[rel] = networkContract(c.source, c.source+"."+c.sourcePort, c.target, c.target+"."+c.targetPort, c.sourceMax, c.targetMax)
		terraformRelationshipSupport[rel] = struct{}{}
	}
}
func auroraCapacity(value string) float64 { parsed, _ := strconv.ParseFloat(value, 64); return parsed }
func (r *terraformRenderer) auroraClusterSubnetGroup(cluster NormalizedResource) (NormalizedResource, bool) {
	return r.connectedResource(cluster.ID, auroraSubnetBinding, true)
}
func (r *terraformRenderer) auroraZoneAllowed(cluster NormalizedResource, zone string) bool {
	group, ok := r.auroraClusterSubnetGroup(cluster)
	if !ok {
		return false
	}
	if _, ok = r.rdsGroupVpc(group); !ok {
		return false
	}
	for _, subnet := range r.relatedResources(group.ID, rdsSubnetBinding, false) {
		if subnet.Parent == nil {
			continue
		}
		az, exists := r.resourceByID(subnet.Parent.NodeID)
		if exists && r.configString(az, "zoneName") == zone {
			return true
		}
	}
	return false
}
func (r *terraformRenderer) validateAuroraModel() {
	reject := func(n NormalizedResource, code, message string) {
		r.error("TARGET_AURORA_"+code, message, SourceReference{Document: DocumentArchitecture, NodeID: n.ID})
	}
	names := map[string]bool{}
	for _, n := range r.model.Resources {
		if n.ServiceType == serviceRdsInstance {
			names["instance:"+r.configString(n, "identifier")] = true
		}
	}
	for _, n := range r.model.Resources {
		if _, exists := auroraSchemas[n.ServiceType]; !exists {
			continue
		}
		if !isCurrentAwsCatalog(r.model.Provenance.Catalog) {
			reject(n, "CATALOG_UNSUPPORTED", "Aurora requires the exact reviewed catalog successor.")
			continue
		}
		if n.Parent != nil || n.ResourceType != n.ServiceType || !rdsUser(n) {
			reject(n, "OWNERSHIP_INVALID", "Require exact user-owned root cluster/member/parameter resources; generated/import/adopted ownership is unsupported.")
		}
		for _, external := range r.model.ExternalResources {
			for _, ref := range external.ArchitectureNodes {
				if ref.NodeID == n.ID {
					reject(n, "EXTERNAL_UNSUPPORTED", "External cluster/member ownership requires a separate reviewed contract.")
				}
			}
		}
		if !r.validateAuroraFields(n) {
			continue
		}
		key, namespace := "identifier", n.ServiceType
		if n.ServiceType == serviceAuroraParameters {
			key = "name"
		}
		if n.ServiceType == serviceAuroraInstance {
			namespace = "instance"
		}
		name := r.configString(n, key)
		identity := namespace + ":" + name
		if names[identity] {
			reject(n, "NAME_DUPLICATE", "Names must be unique within each native resource namespace and modeled Region.")
		}
		names[identity] = true
		if n.ServiceType == serviceAuroraParameters && strings.HasPrefix(name, "default") {
			reject(n, "NAME_RESERVED", "Default native cluster parameter groups are unsupported.")
		}
		if n.ServiceType == serviceAuroraCluster {
			groups := r.relatedResources(n.ID, auroraGroupBinding, false)
			subnets := r.relatedResources(n.ID, auroraSubnetBinding, true)
			parameters := r.relatedResources(n.ID, auroraParameterBinding, true)
			network, ok := "", false
			if len(subnets) == 1 {
				network, ok = r.rdsGroupVpc(subnets[0])
			}
			if len(subnets) != 1 || len(parameters) != 1 || !ok || len(groups) < 1 || len(groups) > 5 {
				reject(n, "DEPENDENCIES_INVALID", "Require one canonical two-AZ DB subnet group, one Aurora PostgreSQL 16 cluster TLS group and 1-5 same-VPC security groups.")
			}
			seen := map[string]bool{}
			for _, group := range groups {
				vpc, valid := r.networkVPCID(group)
				if seen[group.ID] || !valid || !ok || vpc != network {
					reject(n, "CROSS_VPC_INVALID", "Distinct security groups must match the canonical DB subnet group VPC/Region.")
				}
				seen[group.ID] = true
			}
			members := r.relatedResources(n.ID, auroraMemberBinding, false)
			tiers, zones, ids := map[int]bool{}, map[string]bool{}, map[string]bool{}
			memberValid := len(members) >= 1 && len(members) <= 2
			for _, member := range members {
				tier, zone := r.configInt(member, "promotionTier"), r.configString(member, "availabilityZone")
				if tiers[tier] || zones[zone] || ids[member.ID] {
					memberValid = false
				}
				tiers[tier], zones[zone], ids[member.ID] = true, true, true
			}
			if !memberValid || !tiers[0] {
				reject(n, "MEMBERS_INVALID", "Require one or two exact members, distinct AZs/failover tiers and one tier 0; priorities do not promise initial writer identity.")
			}
			if auroraCapacity(r.configString(n, "minimumCapacityAcus")) > auroraCapacity(r.configString(n, "maximumCapacityAcus")) {
				reject(n, "CAPACITY_INVALID", "Maximum reviewed per-member ACUs must be at least the nonzero minimum; auto-pause is unsupported.")
			}
			username, db := strings.ToLower(r.configString(n, "masterUsername")), strings.ToLower(r.configString(n, "databaseName"))
			if rdsReserved[username] || rdsReserved[db] || username == "rdsadmin" || strings.HasPrefix(username, "pg_") || db == "rdsadmin" || db == "postgres" || db == "template0" || db == "template1" {
				reject(n, "NAME_RESERVED", "Use explicit non-system PostgreSQL database and master usernames.")
			}
			if !rdsWindowsValid(r.configString(n, "backupWindow"), r.configString(n, "maintenanceWindow")) {
				reject(n, "WINDOWS_INVALID", "Use same-day UTC backups and same-weekday maintenance, 30-120 minutes without overlap.")
			}
		}
		if n.ServiceType == serviceAuroraInstance {
			clusters := r.relatedResources(n.ID, auroraMemberBinding, true)
			if len(clusters) != 1 || !r.auroraZoneAllowed(clusters[0], r.configString(n, "availabilityZone")) {
				reject(n, "MEMBER_PLACEMENT_INVALID", "Bind exactly one reviewed cluster; member AZ must occur in its canonical DB subnet group. Engine/version, storage, credentials and ACU bounds belong to that cluster.")
			}
		}
	}
}
func (r *terraformRenderer) auroraWarnings(n NormalizedResource) {
	if n.ServiceType == serviceAuroraCluster {
		r.warning("AURORA_READINESS_EXTERNAL", "Export models retained private Aurora Serverless v2 with nonzero per-member compute and Aurora Standard storage. Review actual Region/version/class/CA/capacity, deployer/service-linked-role authority, managed-secret/TLS/client readiness, backups, maintenance/reboot, writer/failover state and paid-resource cleanup externally. CloudFormation cluster updates have no ApplyImmediately control. No pause savings, provisioning or application health is verified.", SourceReference{Document: DocumentArchitecture, NodeID: n.ID})
	}
}
