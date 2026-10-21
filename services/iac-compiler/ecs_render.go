package compiler

import (
	"github.com/hashicorp/hcl/v2/hclwrite"
	"github.com/zclconf/go-cty/cty"
	"sort"
	"strconv"
)

func ecsObjectTokens(values map[string]hclwrite.Tokens) hclwrite.Tokens {
	keys := []string{}
	for k := range values {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	attrs := []hclwrite.ObjectAttrTokens{}
	for _, k := range keys {
		attrs = append(attrs, hclwrite.ObjectAttrTokens{Name: hclwrite.TokensForValue(cty.StringVal(k)), Value: values[k]})
	}
	return hclwrite.TokensForObject(attrs)
}
func ecsString(v string) hclwrite.Tokens { return hclwrite.TokensForValue(cty.StringVal(v)) }
func ecsNumber(v int) hclwrite.Tokens    { return hclwrite.TokensForValue(cty.NumberIntVal(int64(v))) }
func ecsBool(v bool) hclwrite.Tokens     { return hclwrite.TokensForValue(cty.BoolVal(v)) }
func (r *terraformRenderer) ecsContainerTokens(n NormalizedResource) hclwrite.Tokens {
	image, _ := r.connectedResource(n.ID, ecsImageBinding, true)
	repo, _ := r.connectedResource(image.ID, ecsImageOwner, false)
	logs, _ := r.connectedResource(n.ID, ecsLogsBinding, false)
	secrets := []hclwrite.Tokens{}
	for _, e := range r.model.Connections {
		if e.RelationshipType == ecsSecretBinding && e.Target.NodeID == n.ID {
			secrets = append(secrets, ecsObjectTokens(map[string]hclwrite.Tokens{"name": ecsString(r.connectionString(e, "environmentName")), "valueFrom": r.resourceAttributeTokens(e.Source.NodeID, "arn")}))
		}
	}
	health := map[string]hclwrite.Tokens{"command": tupleTokens(ecsString("CMD"), ecsString(r.configString(n, "healthExecutable"))), "interval": ecsNumber(r.configInt(n, "healthIntervalSeconds")), "timeout": ecsNumber(r.configInt(n, "healthTimeoutSeconds")), "retries": ecsNumber(r.configInt(n, "healthRetries")), "startPeriod": ecsNumber(r.configInt(n, "healthStartPeriodSeconds"))}
	options := map[string]hclwrite.Tokens{"awslogs-group": r.resourceAttributeTokens(logs.ID, "name"), "awslogs-region": ecsString(r.model.Provenance.Region), "awslogs-stream-prefix": ecsString(r.configString(n, "logStreamPrefix")), "mode": ecsString("non-blocking"), "max-buffer-size": ecsString("10m")}
	port := ecsNumber(r.configInt(n, "containerPort"))
	props := map[string]hclwrite.Tokens{"name": ecsString(r.configString(n, "name")), "image": formatTokens("%s@%s", r.resourceAttributeTokens(repo.ID, "repositoryUrl"), ecsString(r.configString(image, "digest"))), "essential": ecsBool(true), "user": ecsString(r.configString(n, "user")), "readonlyRootFilesystem": ecsBool(true), "portMappings": tupleTokens(ecsObjectTokens(map[string]hclwrite.Tokens{"containerPort": port, "hostPort": port, "protocol": ecsString("tcp")})), "healthCheck": ecsObjectTokens(health), "logConfiguration": ecsObjectTokens(map[string]hclwrite.Tokens{"logDriver": ecsString("awslogs"), "options": ecsObjectTokens(options)})}
	if len(secrets) > 0 {
		props["secrets"] = tupleTokens(secrets...)
	}
	return ecsObjectTokens(props)
}
func (r *terraformRenderer) renderEcsResource(n NormalizedResource) {
	b := r.resourceBlock(n)
	body := b.Body()
	switch n.ServiceType {
	case serviceEcrRepository:
		body.SetAttributeValue("name", cty.StringVal(r.configString(n, "name")))
		body.SetAttributeValue("image_tag_mutability", cty.StringVal("IMMUTABLE"))
		body.SetAttributeValue("force_delete", cty.BoolVal(false))
		enc := hclwrite.NewBlock("encryption_configuration", nil)
		enc.Body().SetAttributeValue("encryption_type", cty.StringVal("AES256"))
		body.AppendBlock(enc)
		scan := hclwrite.NewBlock("image_scanning_configuration", nil)
		scan.Body().SetAttributeValue("scan_on_push", cty.BoolVal(r.configBool(n, "scanOnPush")))
		body.AppendBlock(scan)
		life := hclwrite.NewBlock("lifecycle", nil)
		life.Body().SetAttributeValue("prevent_destroy", cty.BoolVal(true))
		body.AppendBlock(life)
	case serviceEcsCluster:
		body.SetAttributeValue("name", cty.StringVal(r.configString(n, "name")))
		setting := hclwrite.NewBlock("setting", nil)
		setting.Body().SetAttributeValue("name", cty.StringVal("containerInsights"))
		setting.Body().SetAttributeValue("value", cty.StringVal("disabled"))
		body.AppendBlock(setting)
	case serviceEcsTask:
		body.SetAttributeValue("family", cty.StringVal(r.configString(n, "family")))
		body.SetAttributeValue("cpu", cty.StringVal(strconv.Itoa(r.configInt(n, "cpu"))))
		body.SetAttributeValue("memory", cty.StringVal(strconv.Itoa(r.configInt(n, "memoryMiB"))))
		body.SetAttributeValue("network_mode", cty.StringVal("awsvpc"))
		body.SetAttributeValue("requires_compatibilities", cty.ListVal([]cty.Value{cty.StringVal("FARGATE")}))
		body.SetAttributeValue("track_latest", cty.BoolVal(false))
		body.SetAttributeValue("skip_destroy", cty.BoolVal(false))
		runtime := hclwrite.NewBlock("runtime_platform", nil)
		arch := "X86_64"
		if r.configString(n, "architecture") == "arm64" {
			arch = "ARM64"
		}
		runtime.Body().SetAttributeValue("cpu_architecture", cty.StringVal(arch))
		runtime.Body().SetAttributeValue("operating_system_family", cty.StringVal("LINUX"))
		body.AppendBlock(runtime)
		deps := []hclwrite.Tokens{}
		for _, entry := range [][2]string{{ecsExecutionBinding, "execution_role_arn"}, {ecsApplicationBinding, "task_role_arn"}} {
			role, _ := r.connectedResource(n.ID, entry[0], true)
			body.SetAttributeRaw(entry[1], r.resourceAttributeTokens(role.ID, "arn"))
			for _, a := range r.managedAttachmentsForRole(role.ID, "managed-policy-attachment") {
				deps = append(deps, hclwrite.TokensForTraversal(traversal("aws_iam_role_policy_attachment", r.resourceNames[a.ID])))
			}
			for _, p := range r.relatedResources(role.ID, "aws.iam.role-owns-inline-policy", true) {
				deps = append(deps, hclwrite.TokensForTraversal(traversal("aws_iam_role_policy", r.resourceNames[p.ID])))
			}
		}
		if len(deps) > 0 {
			body.SetAttributeRaw("depends_on", tupleTokens(deps...))
		}
		container, _ := r.connectedResource(n.ID, ecsContainerOwner, true)
		body.SetAttributeRaw("container_definitions", hclwrite.TokensForFunctionCall("jsonencode", tupleTokens(r.ecsContainerTokens(container))))
	case serviceEcsService:
		cluster, _ := r.connectedResource(n.ID, ecsClusterBinding, true)
		task, _ := r.connectedResource(n.ID, ecsTaskBinding, true)
		body.SetAttributeValue("name", cty.StringVal(r.configString(n, "name")))
		body.SetAttributeRaw("cluster", r.resourceAttributeTokens(cluster.ID, "arn"))
		body.SetAttributeRaw("task_definition", r.resourceAttributeTokens(task.ID, "arn"))
		body.SetAttributeValue("desired_count", cty.NumberIntVal(int64(r.configInt(n, "desiredCount"))))
		body.SetAttributeValue("launch_type", cty.StringVal("FARGATE"))
		body.SetAttributeValue("platform_version", cty.StringVal("1.4.0"))
		body.SetAttributeValue("scheduling_strategy", cty.StringVal("REPLICA"))
		body.SetAttributeValue("availability_zone_rebalancing", cty.StringVal("DISABLED"))
		body.SetAttributeValue("enable_execute_command", cty.BoolVal(false))
		body.SetAttributeValue("enable_ecs_managed_tags", cty.BoolVal(false))
		body.SetAttributeValue("deployment_minimum_healthy_percent", cty.NumberIntVal(100))
		body.SetAttributeValue("deployment_maximum_percent", cty.NumberIntVal(200))
		cb := hclwrite.NewBlock("deployment_circuit_breaker", nil)
		cb.Body().SetAttributeValue("enable", cty.BoolVal(true))
		cb.Body().SetAttributeValue("rollback", cty.BoolVal(true))
		body.AppendBlock(cb)
		dc := hclwrite.NewBlock("deployment_controller", nil)
		dc.Body().SetAttributeValue("type", cty.StringVal("ECS"))
		body.AppendBlock(dc)
		network := hclwrite.NewBlock("network_configuration", nil)
		network.Body().SetAttributeValue("assign_public_ip", cty.BoolVal(false))
		for _, entry := range [][2]string{{ecsSubnetBinding, "subnets"}, {ecsGroupBinding, "security_groups"}} {
			refs := []hclwrite.Tokens{}
			for _, s := range r.relatedResources(n.ID, entry[0], false) {
				refs = append(refs, r.resourceAttributeTokens(s.ID, "id"))
			}
			network.Body().SetAttributeRaw(entry[1], tupleTokens(refs...))
		}
		body.AppendBlock(network)
		if tg, listener, ok := r.elbServiceTarget(n.ID); ok {
			container, _ := r.connectedResource(task.ID, ecsContainerOwner, true)
			lb := hclwrite.NewBlock("load_balancer", nil)
			lb.Body().SetAttributeRaw("target_group_arn", r.resourceAttributeTokens(tg.ID, "arn"))
			lb.Body().SetAttributeValue("container_name", cty.StringVal(r.configString(container, "name")))
			lb.Body().SetAttributeValue("container_port", cty.NumberIntVal(int64(r.configInt(container, "containerPort"))))
			body.AppendBlock(lb)
			body.SetAttributeValue("health_check_grace_period_seconds", cty.NumberIntVal(int64(r.configInt(tg, "startupGraceSeconds"))))
			access := r.elbOne(tg, albAccess, true)
			body.SetAttributeRaw("depends_on", tupleTokens(hclwrite.TokensForTraversal(traversal("aws_lb_listener", r.resourceNames[listener.ID])), hclwrite.TokensForTraversal(traversal("aws_vpc_security_group_ingress_rule", r.resourceNames[access.ID]+"_ingress")), hclwrite.TokensForTraversal(traversal("aws_vpc_security_group_egress_rule", r.resourceNames[access.ID]+"_egress"))))
		}
	}
	body.SetAttributeTraversal("tags", traversal("local", "tags"))
	appendBlock(r.file("compute.tf"), b)
	r.ecsWarnings(n)
}
func (r *cloudFormationRenderer) ecsContainer(n NormalizedResource) map[string]any {
	image, _ := r.connectedResource(n.ID, ecsImageBinding, true)
	repo, _ := r.connectedResource(image.ID, ecsImageOwner, false)
	logs, _ := r.connectedResource(n.ID, ecsLogsBinding, false)
	health := map[string]any{"Command": []any{"CMD", r.configString(n, "healthExecutable")}, "Interval": r.configInt(n, "healthIntervalSeconds"), "Timeout": r.configInt(n, "healthTimeoutSeconds"), "Retries": r.configInt(n, "healthRetries"), "StartPeriod": r.configInt(n, "healthStartPeriodSeconds")}
	p := map[string]any{"Name": r.configString(n, "name"), "Image": cloudFormationJoin(r.resourceAttribute(repo.ID, "repositoryUrl"), "@", r.configString(image, "digest")), "Essential": true, "User": r.configString(n, "user"), "ReadonlyRootFilesystem": true, "PortMappings": []any{map[string]any{"ContainerPort": r.configInt(n, "containerPort"), "HostPort": r.configInt(n, "containerPort"), "Protocol": "tcp"}}, "HealthCheck": health, "LogConfiguration": map[string]any{"LogDriver": "awslogs", "Options": map[string]any{"awslogs-group": r.resourceAttribute(logs.ID, "name"), "awslogs-region": r.model.Provenance.Region, "awslogs-stream-prefix": r.configString(n, "logStreamPrefix"), "mode": "non-blocking", "max-buffer-size": "10m"}}}
	secrets := []any{}
	for _, e := range r.model.Connections {
		if e.RelationshipType == ecsSecretBinding && e.Target.NodeID == n.ID {
			secrets = append(secrets, map[string]any{"Name": r.connectionString(e, "environmentName"), "ValueFrom": r.resourceAttribute(e.Source.NodeID, "arn")})
		}
	}
	if len(secrets) > 0 {
		p["Secrets"] = secrets
	}
	return p
}
func (r *cloudFormationRenderer) renderEcsResource(n NormalizedResource) {
	p := map[string]any{"Tags": r.tagList()}
	res := cloudFormationResource{Type: cloudFormationResourceTypeByService[n.ServiceType], Properties: p, Metadata: r.resourceMetadata(n)}
	switch n.ServiceType {
	case serviceEcrRepository:
		p["RepositoryName"] = r.configString(n, "name")
		p["ImageTagMutability"] = "IMMUTABLE"
		p["EmptyOnDelete"] = false
		p["EncryptionConfiguration"] = map[string]any{"EncryptionType": "AES256"}
		p["ImageScanningConfiguration"] = map[string]any{"ScanOnPush": r.configBool(n, "scanOnPush")}
		res.DeletionPolicy = "Retain"
		res.UpdateReplacePolicy = "Retain"
	case serviceEcsCluster:
		p["ClusterName"] = r.configString(n, "name")
		p["ClusterSettings"] = []any{map[string]any{"Name": "containerInsights", "Value": "disabled"}}
	case serviceEcsTask:
		p["Family"] = r.configString(n, "family")
		p["Cpu"] = strconv.Itoa(r.configInt(n, "cpu"))
		p["Memory"] = strconv.Itoa(r.configInt(n, "memoryMiB"))
		p["NetworkMode"] = "awsvpc"
		p["RequiresCompatibilities"] = []any{"FARGATE"}
		arch := "X86_64"
		if r.configString(n, "architecture") == "arm64" {
			arch = "ARM64"
		}
		p["RuntimePlatform"] = map[string]any{"CpuArchitecture": arch, "OperatingSystemFamily": "LINUX"}
		for _, entry := range [][2]string{{ecsExecutionBinding, "ExecutionRoleArn"}, {ecsApplicationBinding, "TaskRoleArn"}} {
			role, _ := r.connectedResource(n.ID, entry[0], true)
			p[entry[1]] = r.resourceAttribute(role.ID, "arn")
		}
		container, _ := r.connectedResource(n.ID, ecsContainerOwner, true)
		p["ContainerDefinitions"] = []any{r.ecsContainer(container)}
	case serviceEcsService:
		cluster, _ := r.connectedResource(n.ID, ecsClusterBinding, true)
		task, _ := r.connectedResource(n.ID, ecsTaskBinding, true)
		p["ServiceName"] = r.configString(n, "name")
		p["Cluster"] = r.resourceAttribute(cluster.ID, "arn")
		p["TaskDefinition"] = r.resourceAttribute(task.ID, "arn")
		p["DesiredCount"] = r.configInt(n, "desiredCount")
		p["LaunchType"] = "FARGATE"
		p["PlatformVersion"] = "1.4.0"
		p["SchedulingStrategy"] = "REPLICA"
		p["AvailabilityZoneRebalancing"] = "DISABLED"
		p["EnableExecuteCommand"] = false
		p["EnableECSManagedTags"] = false
		p["DeploymentConfiguration"] = map[string]any{"MinimumHealthyPercent": 100, "MaximumPercent": 200, "DeploymentCircuitBreaker": map[string]any{"Enable": true, "Rollback": true}}
		p["DeploymentController"] = map[string]any{"Type": "ECS"}
		network := map[string]any{"AssignPublicIp": "DISABLED"}
		for _, entry := range [][2]string{{ecsSubnetBinding, "Subnets"}, {ecsGroupBinding, "SecurityGroups"}} {
			refs := []any{}
			for _, s := range r.relatedResources(n.ID, entry[0], false) {
				refs = append(refs, r.resourceAttribute(s.ID, "id"))
			}
			network[entry[1]] = refs
		}
		p["NetworkConfiguration"] = map[string]any{"AwsvpcConfiguration": network}
		helper := &terraformRenderer{model: r.model}
		if tg, listener, ok := helper.elbServiceTarget(n.ID); ok {
			container, _ := r.connectedResource(task.ID, ecsContainerOwner, true)
			p["LoadBalancers"] = []any{map[string]any{"TargetGroupArn": r.resourceAttribute(tg.ID, "arn"), "ContainerName": r.configString(container, "name"), "ContainerPort": r.configInt(container, "containerPort")}}
			p["HealthCheckGracePeriodSeconds"] = r.configInt(tg, "startupGraceSeconds")
			access := helper.elbOne(tg, albAccess, true)
			res.DependsOn = append(res.DependsOn, r.logicalIDs[listener.ID], r.logicalIDs[access.ID]+"Ingress")
		}
	}
	r.addResource(r.logicalIDs[n.ID], res, SourceReference{Document: DocumentArchitecture, NodeID: n.ID})
	helper := &terraformRenderer{model: r.model}
	helper.ecsWarnings(n)
	r.diagnostics = append(r.diagnostics, helper.diagnostics...)
}
