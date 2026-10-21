package compiler

import (
	_ "embed"
	"encoding/json"
	"math"
	"regexp"
	"sort"
	"strings"
)

const serviceEcrRepository = "aws.ecr.repository"
const serviceEcrImage = "aws.ecr.image-reference"
const serviceEcsCluster = "aws.ecs.cluster"
const serviceEcsTask = "aws.ecs.task-definition"
const serviceEcsContainer = "aws.ecs.container-definition"
const serviceEcsService = "aws.ecs.service"
const ecsImageOwner = "aws.ecr.repository-owns-image"
const ecsContainerOwner = "aws.ecs.task-owns-container"
const ecsImageBinding = "aws.ecs.container-uses-image"
const ecsClusterBinding = "aws.ecs.service-uses-cluster"
const ecsTaskBinding = "aws.ecs.service-uses-task"
const ecsExecutionBinding = "aws.ecs.task-uses-execution-role"
const ecsApplicationBinding = "aws.ecs.task-uses-application-role"
const ecsSubnetBinding = "aws.ecs.service-uses-subnet"
const ecsGroupBinding = "aws.ecs.service-uses-security-group"
const ecsLogsBinding = "aws.ecs.container-writes-logs"
const ecsSecretBinding = "aws.ecs.container-uses-secret"
const ecsExecutionPolicy = "aws-managed:service-role/AmazonECSTaskExecutionRolePolicy"

type ecsBinding struct {
	source, sourcePort, target, targetPort string
	sourceMax, targetMax                   int
}

var ecsContracts = map[string]ecsBinding{
	ecsImageOwner: {serviceEcrImage, "repository", serviceEcrRepository, "image", 1, 64}, ecsContainerOwner: {serviceEcsContainer, "task", serviceEcsTask, "container", 1, 1}, ecsImageBinding: {serviceEcrImage, "container", serviceEcsContainer, "image", 128, 1}, ecsClusterBinding: {serviceEcsCluster, "service", serviceEcsService, "cluster", 128, 1}, ecsTaskBinding: {serviceEcsTask, "service", serviceEcsService, "task", 128, 1}, ecsExecutionBinding: {"aws.iam.role", "assumable-role", serviceEcsTask, "execution-role", 1, 1}, ecsApplicationBinding: {"aws.iam.role", "assumable-role", serviceEcsTask, "application-role", 1, 1}, ecsSubnetBinding: {serviceEcsService, "subnet", serviceSubnet, "ecs-service", 16, 128}, ecsGroupBinding: {serviceEcsService, "security-group", serviceSecurityGroup, "ecs-service", 5, 128}, ecsLogsBinding: {serviceEcsContainer, "log-group", "aws.cloudwatch.log-group", "ecs-container", 1, 128}, ecsSecretBinding: {serviceSecret, "ecs-container", serviceEcsContainer, "secret", 128, 8},
}

// A reviewed local copy of exact source field schemas. No runtime extension or
// schema retrieval occurs. A focused test proves drift against catalog 0.23.
//
//go:embed internal/contracts/ecs-configuration-v1.json
var ecsConfigurationJSON []byte

type ecsField struct {
	Type      string   `json:"type"`
	Pattern   string   `json:"pattern"`
	Enum      []any    `json:"enum"`
	Const     *bool    `json:"const"`
	Minimum   *float64 `json:"minimum"`
	Maximum   *float64 `json:"maximum"`
	MinLength *int     `json:"minLength"`
	MaxLength *int     `json:"maxLength"`
}

var ecsSchemas = func() map[string]map[string]ecsField {
	var m map[string]map[string]ecsField
	if err := json.Unmarshal(ecsConfigurationJSON, &m); err != nil {
		panic("invalid reviewed ECS schema")
	}
	return m
}()

func init() {
	for s, tf := range map[string]string{serviceEcrRepository: "aws_ecr_repository", serviceEcsCluster: "aws_ecs_cluster", serviceEcsTask: "aws_ecs_task_definition", serviceEcsService: "aws_ecs_service"} {
		terraformResourceTypeByService[s] = tf
	}
	for s, cf := range map[string]string{serviceEcrRepository: "AWS::ECR::Repository", serviceEcsCluster: "AWS::ECS::Cluster", serviceEcsTask: "AWS::ECS::TaskDefinition", serviceEcsService: "AWS::ECS::Service"} {
		cloudFormationResourceTypeByService[s] = cf
	}
	cloudFormationInternalService[serviceEcrImage] = struct{}{}
	cloudFormationInternalService[serviceEcsContainer] = struct{}{}
	terraformInternalService[serviceEcrImage] = struct{}{}
	terraformInternalService[serviceEcsContainer] = struct{}{}
	for rel, c := range ecsContracts {
		contract := networkContract(c.source, c.source+"."+c.sourcePort, c.target, c.target+"."+c.targetPort, c.sourceMax, c.targetMax)
		if rel == ecsSecretBinding {
			contract.maximumPerPair = 8
		}
		networkingRelationshipContracts[rel] = contract
		terraformRelationshipSupport[rel] = struct{}{}
	}
}
func ecsUser(n NormalizedResource) bool {
	return n.Lifecycle.Ownership == "user" && n.Lifecycle.Origin == "user"
}
func (r *terraformRenderer) validateEcsFields(n NormalizedResource) bool {
	schema := ecsSchemas[n.ServiceType]
	keys := []string{}
	for k := range schema {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	if !r.validateConfiguration(n, n.ServiceType+".configuration", keys) {
		return false
	}
	ok := true
	for _, k := range keys {
		s := schema[k]
		v := n.Configuration.Values[k]
		valid := v.Kind == s.Type
		var value any
		switch s.Type {
		case "string":
			value = r.configString(n, k)
			t := r.configString(n, k)
			valid = valid && (s.Pattern == "" || regexp.MustCompile(s.Pattern).MatchString(t)) && (s.MinLength == nil || len(t) >= *s.MinLength) && (s.MaxLength == nil || len(t) <= *s.MaxLength)
		case "integer":
			f := r.configNumber(n, k)
			value = f
			valid = valid && !math.IsNaN(f) && !math.IsInf(f, 0) && f == math.Trunc(f) && (s.Minimum == nil || f >= *s.Minimum) && (s.Maximum == nil || f <= *s.Maximum)
		case "boolean":
			value = r.configBool(n, k)
			valid = valid && (s.Const == nil || value == *s.Const)
		}
		if len(s.Enum) > 0 {
			found := false
			for _, e := range s.Enum {
				if e == value {
					found = true
				}
			}
			valid = valid && found
		}
		if !valid {
			r.error("TARGET_ECS_FIELD_INVALID", "Supply every exact reviewed literal field with admitted bounds/modes; reference values and unknown properties are unsupported.", SourceReference{Document: DocumentArchitecture, NodeID: n.ID, Path: "$.semantic.configuration.values." + k})
			ok = false
		}
	}
	return ok
}
func (r *terraformRenderer) validateEcsModel() {
	reject := func(n NormalizedResource, code, msg string) {
		r.error("TARGET_ECS_"+code, msg, SourceReference{Document: DocumentArchitecture, NodeID: n.ID})
	}
	names := map[string]bool{}
	for _, n := range r.model.Resources {
		if _, ok := ecsSchemas[n.ServiceType]; !ok {
			continue
		}
		if !isCurrentAwsCatalog(r.model.Provenance.Catalog) {
			reject(n, "CATALOG_UNSUPPORTED", "ECR/ECS requires the exact reviewed successor.")
			continue
		}
		if n.ResourceType != n.ServiceType || !ecsUser(n) {
			reject(n, "OWNERSHIP_INVALID", "Exact user-origin/user-owned identities are required; imported/generated/adopted configurations need separate contracts.")
		}
		for _, e := range r.model.ExternalResources {
			for _, ref := range e.ArchitectureNodes {
				if ref.NodeID == n.ID {
					reject(n, "EXTERNAL_UNSUPPORTED", "External ownership requires a separate reviewed contract.")
				}
			}
		}
		if !r.validateEcsFields(n) {
			continue
		}
		if n.ServiceType == serviceEcrImage || n.ServiceType == serviceEcsContainer {
			rel := ecsImageOwner
			if n.ServiceType == serviceEcsContainer {
				rel = ecsContainerOwner
			}
			owners := r.relatedResources(n.ID, rel, false)
			if len(owners) != 1 || n.Parent == nil || n.Parent.NodeID != owners[0].ID || n.Parent.TargetKey != owners[0].TargetKey || n.Parent.RelationshipType != rel {
				reject(n, "OWNER_INVALID", "Canonical configuration parent and exact one owner edge must agree.")
			}
		} else if n.Parent != nil {
			reject(n, "ROOT_REQUIRED", "Native ECR/ECS resources require root identities.")
		}
		if n.ServiceType == serviceEcrRepository || n.ServiceType == serviceEcsCluster || n.ServiceType == serviceEcsTask {
			key := "name"
			if n.ServiceType == serviceEcsTask {
				key = "family"
			}
			name := n.ServiceType + ":" + r.configString(n, key)
			if names[name] {
				reject(n, "NAME_DUPLICATE", "Modeled repository/cluster/task-family names must be distinct in this Region.")
			}
			names[name] = true
		}
		switch n.ServiceType {
		case serviceEcsTask:
			cpu, mem := r.configInt(n, "cpu"), r.configInt(n, "memoryMiB")
			if !(cpu == 256 && (mem == 512 || mem == 1024 || mem == 2048) || cpu == 512 && mem >= 1024 && mem <= 4096 && mem%1024 == 0 || cpu == 1024 && mem >= 2048 && mem <= 8192 && mem%1024 == 0) {
				reject(n, "SIZE_INVALID", "Use one admitted Fargate CPU/memory pair.")
			}
			containers := r.relatedResources(n.ID, ecsContainerOwner, true)
			if len(containers) != 1 {
				reject(n, "CONTAINER_REQUIRED", "One canonical essential container is required.")
			}
			exec := r.relatedResources(n.ID, ecsExecutionBinding, true)
			task := r.relatedResources(n.ID, ecsApplicationBinding, true)
			if len(exec) != 1 || len(task) != 1 || exec[0].ID == task[0].ID {
				reject(n, "ROLES_INVALID", "Distinct explicit execution and task roles are required.")
			} else {
				for _, role := range []NormalizedResource{exec[0], task[0]} {
					if role.Parent != nil || !ecsUser(role) || role.ServiceType != "aws.iam.role" {
						reject(n, "ROLES_INVALID", "Roles must be exact user-owned root identities.")
					}
					r.validateEcsTrust(n, role)
				}
				a := r.managedAttachmentsForRole(exec[0].ID, "managed-policy-attachment")
				if len(a) != 1 || !ecsUser(a[0]) || a[0].Parent == nil || a[0].Parent.NodeID != exec[0].ID || a[0].Parent.TargetKey != exec[0].TargetKey || a[0].Parent.RelationshipType != "aws.iam.role-owns-managed-policy-attachment" || r.configString(a[0], "managedPolicyReference") != ecsExecutionPolicy {
					reject(n, "EXECUTION_POLICY_REQUIRED", "Attach the exact explicit AmazonECSTaskExecutionRolePolicy managed reference to the execution role; broad scope is not a least-privilege claim.")
				}
				if len(a) == 1 {
					count := 0
					for _, e := range r.model.Connections {
						if e.RelationshipType == "aws.iam.role-owns-managed-policy-attachment" && e.Source.NodeID == a[0].ID {
							count++
							if e.Target.NodeID != exec[0].ID || e.Source.TargetKey != a[0].TargetKey || e.Target.TargetKey != exec[0].TargetKey || e.Source.Port != "aws.iam.managed-policy-attachment.role-managed-policy" || e.Target.Port != "aws.iam.role.managed-policy" || e.Configuration.SchemaID != "aws.iam.role-managed-policy.attachment" || e.Configuration.SchemaVersion != "1.0.0" || len(e.Configuration.Values) != 0 {
								reject(n, "EXECUTION_POLICY_BINDING_INVALID", "Execution attachment requires its exact empty canonical owner binding.")
							}
						}
					}
					if count != 1 {
						reject(n, "EXECUTION_POLICY_BINDING_INVALID", "Execution attachment cannot be shared or have ambiguous ownership.")
					}
				}
			}
		case serviceEcsContainer:
			images := r.relatedResources(n.ID, ecsImageBinding, true)
			tasks := r.relatedResources(n.ID, ecsContainerOwner, false)
			if len(images) != 1 || len(tasks) != 1 || r.configString(images[0], "architecture") != r.configString(tasks[0], "architecture") {
				reject(n, "IMAGE_INVALID", "One typed immutable image identity must match the task architecture.")
			}
			logs := r.relatedResources(n.ID, ecsLogsBinding, false)
			if len(logs) != 1 || !ecsUser(logs[0]) || logs[0].Parent != nil || r.configString(logs[0], "logClass") != "STANDARD" {
				reject(n, "LOGS_INVALID", "One exact user-owned root STANDARD log group is required.")
			}
			envs := map[string]bool{}
			for _, e := range r.model.Connections {
				if e.RelationshipType != ecsSecretBinding || e.Target.NodeID != n.ID {
					continue
				}
				secret, found := r.resourceByID(e.Source.NodeID)
				env := r.connectionString(e, "environmentName")
				if !found || !ecsUser(secret) || secret.Parent != nil || r.configString(secret, "encryptionMode") != "aws-managed" || envs[env] {
					reject(n, "SECRET_INVALID", "Inject distinct allowed environment names from exact AWS-managed-encrypted secrets; CMK injection is unsupported.")
				}
				envs[env] = true
				authorized := false
				if len(tasks) == 1 {
					execs := r.relatedResources(tasks[0].ID, ecsExecutionBinding, true)
					if len(execs) == 1 {
						authorized = r.ecsSecretAuthorized(execs[0], secret)
					}
				}
				if !authorized {
					reject(n, "SECRET_READ_REQUIRED", "Execution role needs explicit canonical GetSecretValue identity scope for every injected secret; task-role permissions do not substitute.")
				}
			}
		case serviceEcsService:
			clusters := r.relatedResources(n.ID, ecsClusterBinding, true)
			tasks := r.relatedResources(n.ID, ecsTaskBinding, true)
			subnets := r.relatedResources(n.ID, ecsSubnetBinding, false)
			groups := r.relatedResources(n.ID, ecsGroupBinding, false)
			if len(clusters) != 1 || len(tasks) != 1 {
				reject(n, "DEPENDENCIES_REQUIRED", "One exact cluster and task definition are required.")
			}
			vpc := ""
			if len(subnets) > 0 {
				vpc, _ = r.networkVPCID(subnets[0])
			}
			if len(subnets) < 1 || len(subnets) > 16 || len(groups) < 1 || len(groups) > 5 || vpc == "" {
				reject(n, "NETWORK_REQUIRED", "Select 1-16 modeled subnets and 1-5 security groups in one canonical VPC.")
			}
			for _, s := range append(append([]NormalizedResource{}, subnets...), groups...) {
				id, ok := r.networkVPCID(s)
				if !ok || id != vpc {
					reject(n, "CROSS_VPC_INVALID", "Every selected subnet and security group must share one canonical regional VPC.")
				}
			}
			if len(clusters) == 1 {
				name := n.ServiceType + ":" + clusters[0].ID + ":" + r.configString(n, "name")
				if names[name] {
					reject(n, "NAME_DUPLICATE", "Service names must be distinct in the selected cluster.")
				}
				names[name] = true
			}
			if r.configInt(n, "desiredCount") > 0 && len(tasks) == 1 {
				cs := r.relatedResources(tasks[0].ID, ecsContainerOwner, true)
				if len(cs) == 1 {
					images := r.relatedResources(cs[0].ID, ecsImageBinding, true)
					if len(images) != 1 || r.configString(images[0], "publicationStatus") != "externally-confirmed" {
						reject(n, "PUBLICATION_REQUIRED", "Positive task counts require declared external publication of the exact image digest.")
					}
					for _, e := range r.model.Connections {
						if e.RelationshipType == ecsSecretBinding && e.Target.NodeID == cs[0].ID && r.connectionString(e, "populationStatus") != "externally-confirmed" {
							reject(n, "POPULATION_REQUIRED", "Positive task counts require declared external population of every injected secret.")
						}
					}
				}
			}
		}
	}
	for _, e := range r.model.Connections {
		c, ok := ecsContracts[e.RelationshipType]
		if !ok {
			continue
		}
		s, sok := r.resourceByID(e.Source.NodeID)
		t, tok := r.resourceByID(e.Target.NodeID)
		valid := isCurrentAwsCatalog(r.model.Provenance.Catalog) && sok && tok && s.ServiceType == c.source && t.ServiceType == c.target && e.Source.Port == c.source+"."+c.sourcePort && e.Target.Port == c.target+"."+c.targetPort && e.Configuration.SchemaID == e.RelationshipType+".connection" && e.Configuration.SchemaVersion == "1.0.0"
		if e.RelationshipType == ecsSecretBinding {
			env := r.connectionString(e, "environmentName")
			status := r.connectionString(e, "populationStatus")
			valid = valid && exactConfigurationKeys(e.Configuration, []string{"environmentName", "populationStatus"}) && e.Configuration.Values["environmentName"].Kind == "string" && e.Configuration.Values["populationStatus"].Kind == "string" && regexp.MustCompile(`^[A-Z][A-Z0-9_]{0,63}$`).MatchString(env) && !regexp.MustCompile(`^(AWS_|ECS_|LD_|NODE_OPTIONS$|PATH$|HOME$|SHELL$|BASH_ENV$|ENV$)`).MatchString(env) && (status == "externally-confirmed" || status == "external-population-required")
		} else {
			valid = valid && len(e.Configuration.Values) == 0
		}
		sc, tc, pairs := 0, 0, 0
		for _, o := range r.model.Connections {
			if o.RelationshipType != e.RelationshipType {
				continue
			}
			if o.Source.NodeID == e.Source.NodeID {
				sc++
			}
			if o.Target.NodeID == e.Target.NodeID {
				tc++
			}
			if o.Source.NodeID == e.Source.NodeID && o.Target.NodeID == e.Target.NodeID {
				pairs++
			}
		}
		pairMax := 1
		if e.RelationshipType == ecsSecretBinding {
			pairMax = 8
		}
		valid = valid && sc <= c.sourceMax && tc <= c.targetMax && pairs <= pairMax
		if !valid {
			r.error("TARGET_ECS_BINDING_INVALID", "Use exact admitted endpoints, versioned literal configuration and bounded cardinality.", SourceReference{Document: DocumentArchitecture, EdgeID: e.ID})
		}
	}
}
func (r *terraformRenderer) ecsSecretAuthorized(role, secret NormalizedResource) bool {
	for _, policy := range r.relatedResources(role.ID, "aws.iam.role-owns-inline-policy", true) {
		if !ecsUser(policy) || r.configString(policy, "policyKind") != "identity-inline" || policy.Parent == nil || policy.Parent.NodeID != role.ID || policy.Parent.RelationshipType != "aws.iam.role-owns-inline-policy" {
			continue
		}
		for _, s := range r.relatedResources(policy.ID, "aws.iam.policy-contains-statement", true) {
			if !ecsUser(s) || s.Parent == nil || s.Parent.NodeID != policy.ID || s.Parent.RelationshipType != "aws.iam.policy-contains-statement" || r.configString(s, "effect") != "allow" || r.configString(s, "principalKind") != "none" {
				continue
			}
			ref := s.Configuration.Values["resourceNode"]
			if ref.Kind != "node-reference" || ref.NodeID != secret.ID || ref.Attribute != serviceSecret+".arn" {
				continue
			}
			scope := r.relatedResources(s.ID, secretScopeRelationship, false)
			if len(scope) != 1 || scope[0].ID != secret.ID {
				continue
			}
			for _, a := range r.configStringList(s, "actions") {
				if a == "secretsmanager:GetSecretValue" {
					return true
				}
			}
		}
	}
	return false
}
func (r *terraformRenderer) ecsWarnings(n NormalizedResource) {
	r.warning("ECS_READINESS_EXTERNAL", "Review actual image existence/digest/platform, nonroot/read-only/health/port behavior, secrets, private egress/NAT/endpoints, capacity, role/PassRole authority and replacement externally. Zero tasks stage intent; no runnable application is generated or verified. Managed policy scope, retained image/log costs and secret restart semantics require review.", SourceReference{Document: DocumentArchitecture, NodeID: n.ID})
}

func (r *terraformRenderer) validateEcsTrust(profile, role NormalizedResource) {
	reject := func() {
		r.error("TARGET_ECS_TRUST_INVALID", "Task role requires one canonical user-owned unconditional ECS-tasks-only service trust statement; no scope, conditions, grants or borrowed role binding.", SourceReference{Document: DocumentArchitecture, NodeID: profile.ID})
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
	if s.ServiceType != "aws.iam.policy-statement" || s.Lifecycle.Ownership != "user" || s.Lifecycle.Origin != "user" || s.Parent == nil || s.Parent.NodeID != trust.ID || s.Parent.TargetKey != trust.TargetKey || s.Parent.RelationshipType != "aws.iam.policy-contains-statement" || r.configString(s, "effect") != "allow" || r.configString(s, "principalKind") != "service" || strings.Join(r.configStringList(s, "principals"), ",") != "ecs-tasks.amazonaws.com" || strings.Join(r.configStringList(s, "actions"), ",") != "sts:AssumeRole" || len(r.configStringList(s, "resourceExpressions")) != 0 {
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
