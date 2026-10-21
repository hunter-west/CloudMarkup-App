package compiler

import (
	"github.com/hashicorp/hcl/v2/hclwrite"
	"github.com/zclconf/go-cty/cty"
	"strconv"
)

func (r *terraformRenderer) renderRdsResource(n NormalizedResource) {
	b := r.resourceBlock(n)
	body := b.Body()
	switch n.ServiceType {
	case serviceRdsSubnetGroup:
		body.SetAttributeValue("name", cty.StringVal(r.configString(n, "name")))
		body.SetAttributeValue("description", cty.StringVal(r.configString(n, "description")))
		refs := []hclwrite.Tokens{}
		for _, s := range r.relatedResources(n.ID, rdsSubnetBinding, false) {
			refs = append(refs, r.resourceAttributeTokens(s.ID, "id"))
		}
		body.SetAttributeRaw("subnet_ids", tupleTokens(refs...))
	case serviceRdsParameterGroup:
		body.SetAttributeValue("name", cty.StringVal(r.configString(n, "name")))
		body.SetAttributeValue("description", cty.StringVal(r.configString(n, "description")))
		body.SetAttributeValue("family", cty.StringVal("postgres16"))
		p := hclwrite.NewBlock("parameter", nil)
		p.Body().SetAttributeValue("name", cty.StringVal("rds.force_ssl"))
		p.Body().SetAttributeValue("value", cty.StringVal("1"))
		p.Body().SetAttributeValue("apply_method", cty.StringVal("pending-reboot"))
		body.AppendBlock(p)
	case serviceRdsInstance:
		for _, v := range [][2]string{{"identifier", "identifier"}, {"engine_version", "engineVersion"}, {"instance_class", "instanceClass"}, {"db_name", "databaseName"}, {"username", "masterUsername"}, {"backup_window", "backupWindow"}, {"maintenance_window", "maintenanceWindow"}, {"ca_cert_identifier", "caIdentifier"}} {
			body.SetAttributeValue(v[0], cty.StringVal(r.configString(n, v[1])))
		}
		for _, v := range [][2]string{{"allocated_storage", "storageGiB"}, {"backup_retention_period", "backupRetentionDays"}, {"port", "port"}, {"monitoring_interval", "monitoringInterval"}} {
			body.SetAttributeValue(v[0], cty.NumberIntVal(int64(r.configInt(n, v[1]))))
		}
		body.SetAttributeValue("multi_az", cty.BoolVal(r.configBool(n, "multiAz")))
		for _, v := range [][2]string{{"engine", "postgres"}, {"storage_type", "gp3"}, {"engine_lifecycle_support", "open-source-rds-extended-support-disabled"}} {
			body.SetAttributeValue(v[0], cty.StringVal(v[1]))
		}
		for _, v := range []struct {
			name  string
			value bool
		}{{"manage_master_user_password", true}, {"storage_encrypted", true}, {"publicly_accessible", false}, {"deletion_protection", true}, {"auto_minor_version_upgrade", false}, {"allow_major_version_upgrade", false}, {"iam_database_authentication_enabled", false}, {"performance_insights_enabled", false}, {"apply_immediately", false}, {"skip_final_snapshot", false}, {"delete_automated_backups", false}, {"copy_tags_to_snapshot", true}} {
			body.SetAttributeValue(v.name, cty.BoolVal(v.value))
		}
		body.SetAttributeValue("final_snapshot_identifier", cty.StringVal(r.configString(n, "identifier")+"-final"))
		for _, v := range [][2]string{{rdsSubnetGroupBinding, "db_subnet_group_name"}, {rdsParameterBinding, "parameter_group_name"}} {
			g, _ := r.connectedResource(n.ID, v[0], true)
			body.SetAttributeRaw(v[1], r.resourceAttributeTokens(g.ID, "name"))
		}
		refs := []hclwrite.Tokens{}
		for _, g := range r.relatedResources(n.ID, rdsGroupBinding, false) {
			refs = append(refs, r.resourceAttributeTokens(g.ID, "id"))
		}
		body.SetAttributeRaw("vpc_security_group_ids", tupleTokens(refs...))
	}
	life := hclwrite.NewBlock("lifecycle", nil)
	life.Body().SetAttributeValue("prevent_destroy", cty.BoolVal(true))
	body.AppendBlock(life)
	body.SetAttributeTraversal("tags", traversal("local", "tags"))
	appendBlock(r.file("data.tf"), b)
	r.rdsWarnings(n)
}
func (r *cloudFormationRenderer) renderRdsResource(n NormalizedResource) {
	p := map[string]any{"Tags": r.tagList()}
	res := cloudFormationResource{Type: cloudFormationResourceTypeByService[n.ServiceType], Properties: p, Metadata: r.resourceMetadata(n), DeletionPolicy: "Retain", UpdateReplacePolicy: "Retain"}
	switch n.ServiceType {
	case serviceRdsSubnetGroup:
		p["DBSubnetGroupName"] = r.configString(n, "name")
		p["DBSubnetGroupDescription"] = r.configString(n, "description")
		refs := []any{}
		for _, s := range r.relatedResources(n.ID, rdsSubnetBinding, false) {
			refs = append(refs, r.resourceAttribute(s.ID, "id"))
		}
		p["SubnetIds"] = refs
	case serviceRdsParameterGroup:
		p["DBParameterGroupName"] = r.configString(n, "name")
		p["Description"] = r.configString(n, "description")
		p["Family"] = "postgres16"
		p["Parameters"] = map[string]any{"rds.force_ssl": "1"}
	case serviceRdsInstance:
		for _, v := range [][2]string{{"DBInstanceIdentifier", "identifier"}, {"EngineVersion", "engineVersion"}, {"DBInstanceClass", "instanceClass"}, {"DBName", "databaseName"}, {"MasterUsername", "masterUsername"}, {"PreferredBackupWindow", "backupWindow"}, {"PreferredMaintenanceWindow", "maintenanceWindow"}, {"CACertificateIdentifier", "caIdentifier"}} {
			p[v[0]] = r.configString(n, v[1])
		}
		for _, v := range [][2]string{{"BackupRetentionPeriod", "backupRetentionDays"}, {"MonitoringInterval", "monitoringInterval"}} {
			p[v[0]] = r.configInt(n, v[1])
		}
		p["AllocatedStorage"] = strconv.Itoa(r.configInt(n, "storageGiB"))
		p["Port"] = strconv.Itoa(r.configInt(n, "port"))
		p["ApplyImmediately"] = false
		p["MultiAZ"] = r.configBool(n, "multiAz")
		p["Engine"] = "postgres"
		p["StorageType"] = "gp3"
		p["EngineLifecycleSupport"] = "open-source-rds-extended-support-disabled"
		for k, v := range map[string]bool{"ManageMasterUserPassword": true, "StorageEncrypted": true, "PubliclyAccessible": false, "DeletionProtection": true, "AutoMinorVersionUpgrade": false, "AllowMajorVersionUpgrade": false, "EnableIAMDatabaseAuthentication": false, "EnablePerformanceInsights": false, "CopyTagsToSnapshot": true} {
			p[k] = v
		}
		for _, v := range [][2]string{{rdsSubnetGroupBinding, "DBSubnetGroupName"}, {rdsParameterBinding, "DBParameterGroupName"}} {
			g, _ := r.connectedResource(n.ID, v[0], true)
			p[v[1]] = r.resourceAttribute(g.ID, "name")
		}
		refs := []any{}
		for _, g := range r.relatedResources(n.ID, rdsGroupBinding, false) {
			refs = append(refs, r.resourceAttribute(g.ID, "id"))
		}
		p["VPCSecurityGroups"] = refs
		res.DeletionPolicy = "Retain"
		res.UpdateReplacePolicy = "Retain"
	}
	r.addResource(r.logicalIDs[n.ID], res, SourceReference{Document: DocumentArchitecture, NodeID: n.ID})
	helper := &terraformRenderer{model: r.model}
	helper.rdsWarnings(n)
	r.diagnostics = append(r.diagnostics, helper.diagnostics...)
}
