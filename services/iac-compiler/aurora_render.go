package compiler

import (
	"github.com/hashicorp/hcl/v2/hclwrite"
	"github.com/zclconf/go-cty/cty"
)

func (r *terraformRenderer) renderAuroraResource(n NormalizedResource) {
	block := r.resourceBlock(n)
	body := block.Body()
	switch n.ServiceType {
	case serviceAuroraParameters:
		body.SetAttributeValue("name", cty.StringVal(r.configString(n, "name")))
		body.SetAttributeValue("description", cty.StringVal(r.configString(n, "description")))
		body.SetAttributeValue("family", cty.StringVal("aurora-postgresql16"))
		parameter := hclwrite.NewBlock("parameter", nil)
		parameter.Body().SetAttributeValue("name", cty.StringVal("rds.force_ssl"))
		parameter.Body().SetAttributeValue("value", cty.StringVal("1"))
		parameter.Body().SetAttributeValue("apply_method", cty.StringVal("pending-reboot"))
		body.AppendBlock(parameter)
	case serviceAuroraCluster:
		for _, field := range [][2]string{{"cluster_identifier", "identifier"}, {"engine_version", "engineVersion"}, {"database_name", "databaseName"}, {"master_username", "masterUsername"}, {"preferred_backup_window", "backupWindow"}, {"preferred_maintenance_window", "maintenanceWindow"}} {
			body.SetAttributeValue(field[0], cty.StringVal(r.configString(n, field[1])))
		}
		for _, field := range [][2]string{{"engine", "aurora-postgresql"}, {"engine_mode", "provisioned"}, {"engine_lifecycle_support", "open-source-rds-extended-support-disabled"}, {"storage_type", ""}} {
			body.SetAttributeValue(field[0], cty.StringVal(field[1]))
		}
		body.SetAttributeValue("port", cty.NumberIntVal(5432))
		body.SetAttributeValue("backup_retention_period", cty.NumberIntVal(int64(r.configInt(n, "backupRetentionDays"))))
		for _, field := range []struct {
			name  string
			value bool
		}{{"manage_master_user_password", true}, {"storage_encrypted", true}, {"deletion_protection", true}, {"auto_minor_version_upgrade", false}, {"allow_major_version_upgrade", false}, {"apply_immediately", false}, {"iam_database_authentication_enabled", false}, {"enable_http_endpoint", false}, {"skip_final_snapshot", false}, {"copy_tags_to_snapshot", true}} {
			body.SetAttributeValue(field.name, cty.BoolVal(field.value))
		}
		body.SetAttributeValue("final_snapshot_identifier", cty.StringVal(r.configString(n, "identifier")+"-final"))
		scaling := hclwrite.NewBlock("serverlessv2_scaling_configuration", nil)
		scaling.Body().SetAttributeValue("min_capacity", cty.NumberFloatVal(auroraCapacity(r.configString(n, "minimumCapacityAcus"))))
		scaling.Body().SetAttributeValue("max_capacity", cty.NumberFloatVal(auroraCapacity(r.configString(n, "maximumCapacityAcus"))))
		body.AppendBlock(scaling)
		for _, binding := range [][2]string{{auroraSubnetBinding, "db_subnet_group_name"}, {auroraParameterBinding, "db_cluster_parameter_group_name"}} {
			group, _ := r.connectedResource(n.ID, binding[0], true)
			body.SetAttributeRaw(binding[1], r.resourceAttributeTokens(group.ID, "name"))
		}
		groups := []hclwrite.Tokens{}
		for _, group := range r.relatedResources(n.ID, auroraGroupBinding, false) {
			groups = append(groups, r.resourceAttributeTokens(group.ID, "id"))
		}
		body.SetAttributeRaw("vpc_security_group_ids", tupleTokens(groups...))
	case serviceAuroraInstance:
		cluster, _ := r.connectedResource(n.ID, auroraMemberBinding, true)
		subnetGroup, _ := r.auroraClusterSubnetGroup(cluster)
		body.SetAttributeValue("identifier", cty.StringVal(r.configString(n, "identifier")))
		body.SetAttributeValue("instance_class", cty.StringVal("db.serverless"))
		body.SetAttributeValue("engine", cty.StringVal("aurora-postgresql"))
		body.SetAttributeRaw("cluster_identifier", r.resourceAttributeTokens(cluster.ID, "identifier"))
		body.SetAttributeTraversal("engine_version", traversal("aws_rds_cluster", r.resourceNames[cluster.ID], "engine_version"))
		body.SetAttributeRaw("db_subnet_group_name", r.resourceAttributeTokens(subnetGroup.ID, "name"))
		body.SetAttributeValue("availability_zone", cty.StringVal(r.configString(n, "availabilityZone")))
		body.SetAttributeValue("promotion_tier", cty.NumberIntVal(int64(r.configInt(n, "promotionTier"))))
		body.SetAttributeValue("ca_cert_identifier", cty.StringVal(r.configString(n, "caIdentifier")))
		body.SetAttributeValue("preferred_maintenance_window", cty.StringVal(r.configString(cluster, "maintenanceWindow")))
		for _, field := range []struct {
			name  string
			value bool
		}{{"publicly_accessible", false}, {"auto_minor_version_upgrade", false}, {"apply_immediately", false}, {"performance_insights_enabled", false}} {
			body.SetAttributeValue(field.name, cty.BoolVal(field.value))
		}
		body.SetAttributeValue("monitoring_interval", cty.NumberIntVal(0))
	}
	life := hclwrite.NewBlock("lifecycle", nil)
	life.Body().SetAttributeValue("prevent_destroy", cty.BoolVal(true))
	body.AppendBlock(life)
	body.SetAttributeTraversal("tags", traversal("local", "tags"))
	appendBlock(r.file("data.tf"), block)
	r.auroraWarnings(n)
}
func (r *cloudFormationRenderer) renderAuroraResource(n NormalizedResource) {
	properties := map[string]any{"Tags": r.tagList()}
	resource := cloudFormationResource{Type: cloudFormationResourceTypeByService[n.ServiceType], Properties: properties, Metadata: r.resourceMetadata(n), DeletionPolicy: "Retain", UpdateReplacePolicy: "Retain"}
	helper := &terraformRenderer{model: r.model}
	switch n.ServiceType {
	case serviceAuroraParameters:
		properties["DBClusterParameterGroupName"] = r.configString(n, "name")
		properties["Description"] = r.configString(n, "description")
		properties["Family"] = "aurora-postgresql16"
		properties["Parameters"] = map[string]any{"rds.force_ssl": "1"}
	case serviceAuroraCluster:
		for _, field := range [][2]string{{"DBClusterIdentifier", "identifier"}, {"EngineVersion", "engineVersion"}, {"DatabaseName", "databaseName"}, {"MasterUsername", "masterUsername"}, {"PreferredBackupWindow", "backupWindow"}, {"PreferredMaintenanceWindow", "maintenanceWindow"}} {
			properties[field[0]] = r.configString(n, field[1])
		}
		properties["Engine"] = "aurora-postgresql"
		properties["EngineMode"] = "provisioned"
		properties["EngineLifecycleSupport"] = "open-source-rds-extended-support-disabled"
		properties["StorageType"] = "aurora"
		properties["Port"] = 5432
		properties["BackupRetentionPeriod"] = r.configInt(n, "backupRetentionDays")
		for key, value := range map[string]bool{"ManageMasterUserPassword": true, "StorageEncrypted": true, "DeletionProtection": true, "AutoMinorVersionUpgrade": false, "EnableIAMDatabaseAuthentication": false, "EnableHttpEndpoint": false, "CopyTagsToSnapshot": true} {
			properties[key] = value
		}
		properties["ServerlessV2ScalingConfiguration"] = map[string]any{"MinCapacity": auroraCapacity(r.configString(n, "minimumCapacityAcus")), "MaxCapacity": auroraCapacity(r.configString(n, "maximumCapacityAcus"))}
		for _, binding := range [][2]string{{auroraSubnetBinding, "DBSubnetGroupName"}, {auroraParameterBinding, "DBClusterParameterGroupName"}} {
			group, _ := helper.connectedResource(n.ID, binding[0], true)
			properties[binding[1]] = r.resourceAttribute(group.ID, "name")
		}
		groups := []any{}
		for _, group := range helper.relatedResources(n.ID, auroraGroupBinding, false) {
			groups = append(groups, r.resourceAttribute(group.ID, "id"))
		}
		properties["VpcSecurityGroupIds"] = groups
	case serviceAuroraInstance:
		cluster, _ := helper.connectedResource(n.ID, auroraMemberBinding, true)
		subnetGroup, _ := helper.auroraClusterSubnetGroup(cluster)
		properties["DBInstanceIdentifier"] = r.configString(n, "identifier")
		properties["DBInstanceClass"] = "db.serverless"
		properties["Engine"] = "aurora-postgresql"
		properties["DBClusterIdentifier"] = r.resourceAttribute(cluster.ID, "identifier")
		properties["DBSubnetGroupName"] = r.resourceAttribute(subnetGroup.ID, "name")
		properties["AvailabilityZone"] = r.configString(n, "availabilityZone")
		properties["PromotionTier"] = r.configInt(n, "promotionTier")
		properties["CACertificateIdentifier"] = r.configString(n, "caIdentifier")
		properties["PreferredMaintenanceWindow"] = r.configString(cluster, "maintenanceWindow")
		for key, value := range map[string]bool{"PubliclyAccessible": false, "AutoMinorVersionUpgrade": false, "ApplyImmediately": false, "EnablePerformanceInsights": false} {
			properties[key] = value
		}
		properties["MonitoringInterval"] = 0
	}
	r.addResource(r.logicalIDs[n.ID], resource, SourceReference{Document: DocumentArchitecture, NodeID: n.ID})
	helper.auroraWarnings(n)
	r.diagnostics = append(r.diagnostics, helper.diagnostics...)
}
