package compiler

import (
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strings"

	"github.com/hashicorp/hcl/v2/hclwrite"
	"github.com/zclconf/go-cty/cty"
)

var terraformEventServices = map[string]struct{}{
	"aws.s3.bucket": {}, "aws.s3.bucket-lifecycle-configuration": {},
	"aws.s3.bucket-cors-configuration": {}, "aws.s3.bucket-notification-configuration": {},
	"aws.sqs.queue": {}, "aws.sqs.redrive-configuration": {},
	"aws.sns.topic": {}, "aws.sns.subscription": {},
	"aws.eventbridge.event-bus": {}, "aws.eventbridge.rule": {}, "aws.eventbridge.target": {},
	"aws.stepfunctions.state-machine": {},
}

var terraformEventRelationships = map[string]struct{}{
	"aws.s3.notifies-lambda": {}, "aws.s3.sends-events-to-eventbridge": {},
	"aws.lambda.sends-message-to-sqs": {}, "aws.sqs.triggers-lambda": {},
	"aws.sqs.uses-dead-letter-queue": {}, "aws.lambda.publishes-to-sns": {},
	"aws.sns.topic-owns-subscription": {}, "aws.sns.subscription-invokes-lambda": {},
	"aws.sns.subscription-sends-to-sqs": {}, "aws.lambda.puts-events-on-eventbridge": {},
	"aws.eventbridge.event-bus-associates-rule": {}, "aws.eventbridge.rule-owns-target": {},
	"aws.eventbridge.target-invokes-lambda": {}, "aws.eventbridge.target-sends-to-sqs": {},
	"aws.eventbridge.target-publishes-to-sns": {}, "aws.eventbridge.target-starts-state-machine": {},
	"aws.eventbridge.target-uses-dead-letter-queue":  {},
	"aws.lambda.starts-step-functions-state-machine": {},
	"aws.stepfunctions.state-machine-invokes-lambda": {},
	"aws.iam.role-assumed-by-step-functions":         {}, "aws.iam.role-assumed-by-eventbridge-target": {},
	"aws.lambda.uses-sqs-dead-letter-queue":      {},
	"aws.s3.bucket-owns-lifecycle-configuration": {}, "aws.s3.bucket-owns-cors-configuration": {},
	"aws.s3.bucket-owns-notification-configuration": {}, "aws.sqs.queue-owns-redrive-configuration": {},
	"aws.s3.bucket-owns-resource-policy": {}, "aws.sqs.queue-owns-resource-policy": {},
	"aws.sns.topic-owns-resource-policy": {}, "aws.eventbridge.event-bus-owns-resource-policy": {},
	"aws.iam.authorizes-s3-bucket": {}, "aws.iam.authorizes-sqs-queue": {},
	"aws.iam.authorizes-sns-topic": {}, "aws.iam.authorizes-eventbridge-bus": {},
	"aws.iam.authorizes-step-functions-state-machine": {},
}

func isEventService(service string) bool {
	_, ok := terraformEventServices[service]
	return ok
}

func isEventRelationship(relationship string) bool {
	_, ok := terraformEventRelationships[relationship]
	return ok
}

func (renderer *terraformRenderer) validateEventModel() {
	if renderer.model == nil || !renderer.isCurrentCatalog() {
		return
	}
	for _, resource := range renderer.model.Resources {
		switch resource.ServiceType {
		case "aws.s3.bucket-cors-configuration":
			for _, method := range renderer.configStringList(resource, "allowedMethods") {
				if method == "GET" || method == "HEAD" || method == "PUT" || method == "POST" {
					continue
				}
				renderer.error("TARGET_S3_CORS_METHOD_UNSUPPORTED", "S3 CORS allowedMethods must use only GET, HEAD, PUT or POST.", SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
				break
			}
		case "aws.s3.bucket-notification-configuration":
			renderer.validateOwnedS3Notification(resource)
		case "aws.sqs.redrive-configuration":
			renderer.validateOwnedSQSRedrive(resource)
		case "aws.eventbridge.event-bus":
			if renderer.configString(resource, "busType") == "DEFAULT" && renderer.configString(resource, "busName") != "default" {
				renderer.error("TARGET_EVENT_BUS_DEFAULT_NAME_INVALID", "The default EventBridge bus must use the exact name default.", SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
			}
		case "aws.eventbridge.rule":
			if len(renderer.configStringList(resource, "filterKeys")) != 0 {
				renderer.error("TARGET_EVENT_FILTER_UNSUPPORTED", "EventBridge detail-key filters lack typed values and are unsupported by deterministic Terraform generation.", SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
			}
			mode := renderer.configString(resource, "triggerMode")
			schedule := renderer.configString(resource, "scheduleExpression")
			if mode == "SCHEDULE" {
				bus, ok := renderer.connectedResource(resource.ID, "aws.eventbridge.event-bus-associates-rule", true)
				if !ok || renderer.configString(bus, "busType") != "DEFAULT" {
					renderer.error("TARGET_EVENT_SCHEDULE_DEFAULT_BUS_REQUIRED", "Scheduled EventBridge rules require an explicit default-bus association; the compiler cannot discard or replace a custom-bus association.", SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
				}
			}
			if (mode == "EVENT_PATTERN" && schedule != "NONE") || (mode == "SCHEDULE" && schedule == "NONE") || (mode != "EVENT_PATTERN" && mode != "SCHEDULE") {
				renderer.error("TARGET_EVENT_RULE_MODE_UNSUPPORTED", "EventBridge trigger mode and bounded schedule choice are inconsistent.", SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
			}
		case "aws.eventbridge.target":
			attempts := renderer.configInt(resource, "maximumRetryAttempts")
			age := renderer.configInt(resource, "maximumEventAgeSeconds")
			allowedAttempts := map[int]bool{0: true, 3: true, 10: true, 24: true, 185: true}
			allowedAges := map[int]bool{60: true, 300: true, 3600: true, 21600: true, 86400: true}
			if !allowedAttempts[attempts] || !allowedAges[age] {
				renderer.error("TARGET_EVENT_RETRY_UNBOUNDED", "EventBridge retry attempts and event age must use one bounded reviewed catalog choice.", SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
			}
		case "aws.sns.subscription":
			if renderer.configString(resource, "filterScope") != "NONE" || len(renderer.configStringList(resource, "filterKeys")) != 0 {
				renderer.error("TARGET_EVENT_FILTER_UNSUPPORTED", "SNS filter keys lack typed values and are unsupported by deterministic Terraform generation.", SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
			}
		}
	}
	for _, connection := range renderer.model.Connections {
		source, sourceOK := renderer.resourceByID(connection.Source.NodeID)
		target, targetOK := renderer.resourceByID(connection.Target.NodeID)
		if !sourceOK || !targetOK {
			continue
		}
		switch connection.RelationshipType {
		case "aws.eventbridge.target-publishes-to-sns":
			renderer.error("TARGET_EVENTBRIDGE_SNS_ENCRYPTION_UNSUPPORTED", "EventBridge delivery to SNS requires a customer-managed topic key and KMS permissions outside the current AWS-managed KMS topic contract. Choose a supported Lambda or Standard SQS target.", SourceReference{Document: DocumentArchitecture, EdgeID: connection.ID})
		case "aws.sqs.triggers-lambda":
			if source.ServiceType != "aws.sqs.queue" || target.ServiceType != "aws.lambda.function" {
				renderer.error("TARGET_SQS_DIRECTION_INVALID", "SQS event-source mappings must flow from one queue to one Lambda function.", SourceReference{Document: DocumentArchitecture, EdgeID: connection.ID})
			}
			if renderer.configString(source, "queueType") == "FIFO" && renderer.connectionInt(connection, "batchingWindowSeconds") != 0 {
				renderer.error("TARGET_SQS_FIFO_BATCHING_WINDOW_UNSUPPORTED", "FIFO SQS Lambda consumers require batchingWindowSeconds to be zero; batching windows are unsupported for FIFO queues.", SourceReference{Document: DocumentArchitecture, EdgeID: connection.ID})
			}
		case "aws.sqs.uses-dead-letter-queue":
			if source.ID == target.ID || source.ServiceType != "aws.sqs.queue" || target.ServiceType != "aws.sqs.queue" || renderer.configString(source, "queueType") != renderer.configString(target, "queueType") {
				renderer.error("TARGET_SQS_DLQ_FIFO_MISMATCH", "An SQS dead-letter edge must point to a distinct queue with the same Standard or FIFO type.", SourceReference{Document: DocumentArchitecture, EdgeID: connection.ID})
			}
		case "aws.s3.sends-events-to-eventbridge":
			if target.ServiceType != "aws.eventbridge.event-bus" || renderer.configString(target, "busType") != "DEFAULT" {
				renderer.error("TARGET_S3_EVENT_BUS_UNSUPPORTED", "S3 service events can be enabled only on the same-Region default EventBridge bus.", SourceReference{Document: DocumentArchitecture, EdgeID: connection.ID})
			}
		case "aws.stepfunctions.state-machine-invokes-lambda":
			renderer.validateStepFunctionsTaskConfiguration(connection)
		}
	}
	renderer.validateEventFlowCycles()
}

func (renderer *terraformRenderer) validateS3NotificationNames() {
	if !renderer.isCurrentCatalog() {
		return
	}
	seen := map[string]SourceReference{}
	for _, edge := range renderer.model.Connections {
		if edge.RelationshipType != "aws.s3.notifies-lambda" {
			continue
		}
		name := ""
		source := SourceReference{Document: DocumentArchitecture, EdgeID: edge.ID}
		owned := []NormalizedResource{}
		for _, child := range renderer.relatedResources(edge.Source.NodeID, "aws.s3.bucket-owns-notification-configuration", true) {
			if child.ServiceType == "aws.s3.bucket-notification-configuration" && renderer.configString(child, "destinationKind") == "LAMBDA" && sameS3NotificationSettings(child.Configuration.Values, edge.Configuration.Values) {
				owned = append(owned, child)
			}
		}
		if len(owned) == 1 {
			name = renderer.configString(owned[0], "notificationName")
			source.NodeID, source.EdgeID = owned[0].ID, ""
		} else if len(owned) == 0 {
			grants := []NormalizedResource{}
			for _, candidate := range renderer.model.Resources {
				if candidate.ServiceType == "aws.iam.policy-document" && candidate.Lifecycle.Ownership == "generated" && candidate.Lifecycle.Provenance != nil && containsString(candidate.Lifecycle.Provenance.DependentEdgeIDs, edge.ID) && renderer.configString(candidate, "policyKind") == "service-grant" {
					grants = append(grants, candidate)
				}
			}
			if len(grants) == 1 {
				statements := renderer.relatedResources(grants[0].ID, "aws.iam.policy-contains-statement", true)
				if len(statements) == 1 && statements[0].ServiceType == "aws.iam.policy-statement" {
					name = statementID(renderer.configString(statements[0], "statementId"))
				}
			}
		}
		if name == "" {
			continue
		}
		key := edge.Source.NodeID + "\x00" + name
		if _, exists := seen[key]; exists {
			renderer.error("TARGET_S3_NOTIFICATION_NAME_CONFLICT", "S3 notification identifiers must be unique within one bucket, including owned notificationName values and exact generated permission statement IDs used by edge-only notifications. Choose a distinct owned name or explicitly correct the conflicting typed grant; no ID is renamed automatically.", source)
		} else {
			seen[key] = source
		}
	}
}

func sameS3NotificationSettings(left, right map[string]ConfigurationValue) bool {
	for _, key := range []string{"eventType", "filterPrefix", "filterSuffix", "deliverySemantics"} {
		l, lok := left[key].Value.(string)
		r, rok := right[key].Value.(string)
		if left[key].Kind != "string" || right[key].Kind != "string" || !lok || !rok || l != r {
			return false
		}
	}
	return true
}

func (renderer *terraformRenderer) validateOwnedSQSRedrive(resource NormalizedResource) {
	if !renderer.validateEventConfiguration(resource, "1.0.0", []string{"maximumReceiveCount", "redrivePermission", "replayMode"}) {
		return
	}
	owners := renderer.relatedResources(resource.ID, "aws.sqs.queue-owns-redrive-configuration", false)
	matched := false
	if len(owners) == 1 && owners[0].ServiceType == "aws.sqs.queue" {
		edges := []NormalizedConnection{}
		for _, edge := range renderer.model.Connections {
			if edge.Source.NodeID == owners[0].ID && edge.RelationshipType == "aws.sqs.uses-dead-letter-queue" {
				edges = append(edges, edge)
			}
		}
		if len(edges) == 1 {
			matched = renderer.configString(resource, "redrivePermission") == "BY_QUEUE" && renderer.configInt(resource, "maximumReceiveCount") == renderer.connectionInt(edges[0], "maximumReceiveCount") && renderer.configString(resource, "replayMode") == renderer.connectionString(edges[0], "replayMode")
		}
	}
	if !matched {
		renderer.error("TARGET_SQS_OWNED_REDRIVE_UNREPRESENTED", "Owned redrive settings require one exact DLQ connection with identical maximumReceiveCount and replayMode and the BY_QUEUE allow posture. Correct conflicting or standalone settings explicitly; no representation is selected automatically.", SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
	}
}

func (renderer *terraformRenderer) validateOwnedS3Notification(resource NormalizedResource) {
	if !renderer.validateEventConfiguration(resource, "1.0.0", []string{"deliverySemantics", "destinationKind", "eventType", "filterPrefix", "filterSuffix", "notificationName"}) {
		return
	}
	owners := renderer.relatedResources(resource.ID, "aws.s3.bucket-owns-notification-configuration", false)
	matches, siblings := 0, 0
	if len(owners) == 1 && owners[0].ServiceType == "aws.s3.bucket" {
		for _, edge := range renderer.model.Connections {
			if edge.Source.NodeID == owners[0].ID && edge.RelationshipType == "aws.s3.notifies-lambda" && sameS3NotificationSettings(resource.Configuration.Values, edge.Configuration.Values) {
				matches++
			}
		}
		for _, sibling := range renderer.relatedResources(owners[0].ID, "aws.s3.bucket-owns-notification-configuration", true) {
			if sibling.ServiceType == resource.ServiceType && renderer.configString(sibling, "destinationKind") == "LAMBDA" && sameS3NotificationSettings(resource.Configuration.Values, sibling.Configuration.Values) {
				siblings++
			}
		}
	}
	if renderer.configString(resource, "destinationKind") != "LAMBDA" || len(owners) != 1 || matches != 1 || siblings != 1 {
		renderer.error("TARGET_S3_OWNED_NOTIFICATION_UNREPRESENTED", "Owned S3 notifications require one unique Lambda delivery edge with identical event, filters and delivery semantics. Standalone, conflicting, duplicate and per-object EventBridge child intent is unsupported; correct or remove it explicitly.", SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
	}
}

func (renderer *terraformRenderer) validateStepFunctionsTaskConfiguration(connection NormalizedConnection) {
	keys := []string{"maximumAttempts", "retryMode", "taskTimeoutSeconds"}
	if !renderer.validateConnectionConfiguration(connection, "aws.stepfunctions.lambda-task.connection", keys) {
		return
	}

	taskTimeoutSeconds, taskTimeoutOK := renderer.exactConnectionInteger(connection, "taskTimeoutSeconds")
	retryMode, retryModeOK := renderer.exactConnectionString(connection, "retryMode")
	maximumAttempts, maximumAttemptsOK := renderer.exactConnectionInteger(connection, "maximumAttempts")
	if !taskTimeoutOK || !retryModeOK || !maximumAttemptsOK {
		return
	}

	allowedTimeouts := map[int]struct{}{30: {}, 60: {}, 120: {}, 300: {}, 900: {}}
	allowedAttempts := map[int]struct{}{1: {}, 2: {}, 3: {}, 5: {}}
	_, timeoutAllowed := allowedTimeouts[taskTimeoutSeconds]
	_, attemptsAllowed := allowedAttempts[maximumAttempts]
	modeAllowed := retryMode == "NONE" || retryMode == "BOUNDED_EXPONENTIAL"
	if !timeoutAllowed || !attemptsAllowed || !modeAllowed {
		renderer.error("TARGET_STEP_FUNCTIONS_TASK_CONFIGURATION_UNSUPPORTED", "Step Functions Lambda task timeout, retry mode, and total attempts must use exact reviewed catalog choices.", SourceReference{Document: DocumentArchitecture, EdgeID: connection.ID})
		return
	}

	if (retryMode == "NONE" && maximumAttempts != 1) || (retryMode == "BOUNDED_EXPONENTIAL" && maximumAttempts <= 1) {
		renderer.error("TARGET_STEP_FUNCTIONS_RETRY_CONFIGURATION_INVALID", "Step Functions NONE retry mode requires exactly one total attempt and bounded exponential retry requires more than one total attempt.", SourceReference{Document: DocumentArchitecture, EdgeID: connection.ID})
	}
}

func (renderer *terraformRenderer) exactConnectionInteger(connection NormalizedConnection, key string) (int, bool) {
	value := connection.Configuration.Values[key]
	result, ok := value.Value.(float64)
	if value.Kind != "integer" || !ok || math.IsNaN(result) || math.IsInf(result, 0) || math.Trunc(result) != result {
		renderer.error("TARGET_CONNECTION_VALUE_INVALID", "Relationship configuration value has an unsupported integer type.", SourceReference{Document: DocumentArchitecture, EdgeID: connection.ID})
		return 0, false
	}
	return int(result), true
}

func (renderer *terraformRenderer) exactConnectionString(connection NormalizedConnection, key string) (string, bool) {
	value := connection.Configuration.Values[key]
	result, ok := value.Value.(string)
	if value.Kind != "string" || !ok {
		renderer.error("TARGET_CONNECTION_VALUE_INVALID", "Relationship configuration value has an unsupported string type.", SourceReference{Document: DocumentArchitecture, EdgeID: connection.ID})
		return "", false
	}
	return result, true
}

func (renderer *terraformRenderer) validateEventFlowCycles() {
	flow := map[string]struct{}{
		"aws.s3.notifies-lambda": {}, "aws.s3.sends-events-to-eventbridge": {},
		"aws.lambda.sends-message-to-sqs": {}, "aws.sqs.triggers-lambda": {},
		"aws.lambda.publishes-to-sns": {}, "aws.sns.subscription-invokes-lambda": {},
		"aws.sns.subscription-sends-to-sqs": {}, "aws.lambda.puts-events-on-eventbridge": {},
		"aws.eventbridge.target-invokes-lambda": {}, "aws.eventbridge.target-sends-to-sqs": {},
		"aws.eventbridge.target-publishes-to-sns": {}, "aws.eventbridge.target-starts-state-machine": {},
		"aws.lambda.starts-step-functions-state-machine": {}, "aws.stepfunctions.state-machine-invokes-lambda": {},
	}
	type arc struct{ target, edge string }
	adjacency := map[string][]arc{}
	for _, connection := range renderer.model.Connections {
		if _, ok := flow[connection.RelationshipType]; ok {
			adjacency[connection.Source.NodeID] = append(adjacency[connection.Source.NodeID], arc{connection.Target.NodeID, connection.ID})
		}
	}
	state := map[string]int{}
	var visit func(string) bool
	visit = func(node string) bool {
		state[node] = 1
		for _, next := range adjacency[node] {
			if state[next.target] == 1 {
				renderer.error("TARGET_EVENT_FLOW_CYCLE", "Event delivery topology contains a recursive cycle that could create unbounded delivery.", SourceReference{Document: DocumentArchitecture, EdgeID: next.edge})
				return true
			}
			if state[next.target] == 0 && visit(next.target) {
				return true
			}
		}
		state[node] = 2
		return false
	}
	keys := make([]string, 0, len(adjacency))
	for key := range adjacency {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		if state[key] == 0 && visit(key) {
			return
		}
	}
}

func (renderer *terraformRenderer) renderEventResourcesAndConnections() {
	if !renderer.isCurrentCatalog() {
		return
	}
	for _, resource := range renderer.model.Resources {
		if !renderer.shouldRenderResource(resource.ID) {
			continue
		}
		switch resource.ServiceType {
		case "aws.s3.bucket":
			renderer.renderS3Bucket(resource)
		case "aws.s3.bucket-lifecycle-configuration":
			renderer.renderS3Lifecycle(resource)
		case "aws.s3.bucket-cors-configuration":
			renderer.renderS3CORS(resource)
		case "aws.sqs.queue":
			renderer.renderSQSQueue(resource)
		case "aws.sns.topic":
			renderer.renderSNSTopic(resource)
		case "aws.eventbridge.event-bus":
			renderer.renderEventBus(resource)
		case "aws.eventbridge.rule":
			renderer.renderEventRule(resource)
		case "aws.stepfunctions.state-machine":
			renderer.renderStateMachine(resource)
		}
	}
	renderer.renderS3Notifications()
	renderer.renderSQSRedriveAllowPolicies()
	renderer.renderSNSSubscriptions()
	renderer.renderEventTargets()
	renderer.renderSQSEventSourceMappings()
}

func (renderer *terraformRenderer) validateEventConfiguration(resource NormalizedResource, version string, keys []string) bool {
	if resource.Configuration.SchemaID != resource.ServiceType+".configuration" || resource.Configuration.SchemaVersion != version || !exactConfigurationKeys(resource.Configuration, keys) {
		renderer.error("TARGET_CONFIGURATION_UNSUPPORTED", "Event resource configuration does not match the exact implemented catalog mapping.", SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
		return false
	}
	return true
}

func appendPreventDestroy(body *hclwrite.Body, enabled bool) {
	if !enabled {
		return
	}
	block := hclwrite.NewBlock("lifecycle", nil)
	block.Body().SetAttributeValue("prevent_destroy", cty.BoolVal(true))
	body.AppendBlock(block)
}

func stringListValue(values []string) cty.Value {
	if len(values) == 0 {
		return cty.ListValEmpty(cty.String)
	}
	items := make([]cty.Value, len(values))
	for index, value := range values {
		items[index] = cty.StringVal(value)
	}
	return cty.ListVal(items)
}

func (renderer *terraformRenderer) renderS3Bucket(resource NormalizedResource) {
	keys := []string{"blockPublicAccess", "bucketName", "deletionProtectionEnabled", "encryption", "objectOwnership", "versioningEnabled"}
	if !renderer.validateEventConfiguration(resource, "1.0.0", keys) {
		return
	}
	name := renderer.resourceNames[resource.ID]
	bucket := renderer.resourceBlock(resource)
	bucket.Body().SetAttributeValue("bucket", cty.StringVal(renderer.configString(resource, "bucketName")))
	appendPreventDestroy(bucket.Body(), renderer.configBool(resource, "deletionProtectionEnabled"))
	bucket.Body().SetAttributeTraversal("tags", traversal("local", "tags"))
	appendBlock(renderer.file("eventing.tf"), bucket)

	ownership := hclwrite.NewBlock("resource", []string{"aws_s3_bucket_ownership_controls", name + "_ownership"})
	ownership.Body().SetAttributeRaw("bucket", renderer.resourceAttributeTokens(resource.ID, "id"))
	rule := hclwrite.NewBlock("rule", nil)
	rule.Body().SetAttributeValue("object_ownership", cty.StringVal("BucketOwnerEnforced"))
	ownership.Body().AppendBlock(rule)
	appendBlock(renderer.file("eventing.tf"), ownership)

	public := hclwrite.NewBlock("resource", []string{"aws_s3_bucket_public_access_block", name + "_public"})
	public.Body().SetAttributeRaw("bucket", renderer.resourceAttributeTokens(resource.ID, "id"))
	for _, key := range []string{"block_public_acls", "block_public_policy", "ignore_public_acls", "restrict_public_buckets"} {
		public.Body().SetAttributeValue(key, cty.BoolVal(true))
	}
	appendBlock(renderer.file("eventing.tf"), public)

	encryption := hclwrite.NewBlock("resource", []string{"aws_s3_bucket_server_side_encryption_configuration", name + "_encryption"})
	encryption.Body().SetAttributeRaw("bucket", renderer.resourceAttributeTokens(resource.ID, "id"))
	erule := hclwrite.NewBlock("rule", nil)
	apply := hclwrite.NewBlock("apply_server_side_encryption_by_default", nil)
	apply.Body().SetAttributeValue("sse_algorithm", cty.StringVal("AES256"))
	erule.Body().AppendBlock(apply)
	encryption.Body().AppendBlock(erule)
	appendBlock(renderer.file("eventing.tf"), encryption)

	versioning := hclwrite.NewBlock("resource", []string{"aws_s3_bucket_versioning", name + "_versioning"})
	versioning.Body().SetAttributeRaw("bucket", renderer.resourceAttributeTokens(resource.ID, "id"))
	configuration := hclwrite.NewBlock("versioning_configuration", nil)
	configuration.Body().SetAttributeValue("status", cty.StringVal("Enabled"))
	versioning.Body().AppendBlock(configuration)
	appendBlock(renderer.file("eventing.tf"), versioning)
}

func (renderer *terraformRenderer) renderS3Lifecycle(resource NormalizedResource) {
	keys := []string{"expirationDays", "expireNoncurrentVersions", "ruleName", "transition"}
	if !renderer.validateEventConfiguration(resource, "1.0.0", keys) {
		return
	}
	bucket, ok := renderer.connectedResource(resource.ID, "aws.s3.bucket-owns-lifecycle-configuration", false)
	if !ok {
		renderer.error("TARGET_EVENT_OWNER_REQUIRED", "S3 lifecycle configuration requires one owning bucket.", SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
		return
	}
	block := hclwrite.NewBlock("resource", []string{"aws_s3_bucket_lifecycle_configuration", renderer.resourceNames[resource.ID]})
	block.Body().SetAttributeRaw("bucket", renderer.resourceAttributeTokens(bucket.ID, "id"))
	rule := hclwrite.NewBlock("rule", nil)
	rule.Body().SetAttributeValue("id", cty.StringVal(renderer.configString(resource, "ruleName")))
	rule.Body().SetAttributeValue("status", cty.StringVal("Enabled"))
	expiration := hclwrite.NewBlock("expiration", nil)
	expiration.Body().SetAttributeValue("days", cty.NumberIntVal(int64(renderer.configInt(resource, "expirationDays"))))
	rule.Body().AppendBlock(expiration)
	if renderer.configString(resource, "transition") == "INTELLIGENT_TIERING_AFTER_30_DAYS" {
		transition := hclwrite.NewBlock("transition", nil)
		transition.Body().SetAttributeValue("days", cty.NumberIntVal(30))
		transition.Body().SetAttributeValue("storage_class", cty.StringVal("INTELLIGENT_TIERING"))
		rule.Body().AppendBlock(transition)
	}
	if renderer.configBool(resource, "expireNoncurrentVersions") {
		noncurrent := hclwrite.NewBlock("noncurrent_version_expiration", nil)
		noncurrent.Body().SetAttributeValue("noncurrent_days", cty.NumberIntVal(int64(renderer.configInt(resource, "expirationDays"))))
		rule.Body().AppendBlock(noncurrent)
	}
	block.Body().AppendBlock(rule)
	appendBlock(renderer.file("eventing.tf"), block)
}

func (renderer *terraformRenderer) renderS3CORS(resource NormalizedResource) {
	keys := []string{"allowedHeaders", "allowedMethods", "allowedOrigins", "maxAgeSeconds"}
	if !renderer.validateEventConfiguration(resource, "1.0.0", keys) {
		return
	}
	bucket, ok := renderer.connectedResource(resource.ID, "aws.s3.bucket-owns-cors-configuration", false)
	if !ok {
		renderer.error("TARGET_EVENT_OWNER_REQUIRED", "S3 CORS configuration requires one owning bucket.", SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
		return
	}
	block := hclwrite.NewBlock("resource", []string{"aws_s3_bucket_cors_configuration", renderer.resourceNames[resource.ID]})
	block.Body().SetAttributeRaw("bucket", renderer.resourceAttributeTokens(bucket.ID, "id"))
	rule := hclwrite.NewBlock("cors_rule", nil)
	rule.Body().SetAttributeValue("allowed_headers", stringListValue(renderer.configStringList(resource, "allowedHeaders")))
	rule.Body().SetAttributeValue("allowed_methods", stringListValue(renderer.configStringList(resource, "allowedMethods")))
	rule.Body().SetAttributeValue("allowed_origins", stringListValue(renderer.configStringList(resource, "allowedOrigins")))
	rule.Body().SetAttributeValue("max_age_seconds", cty.NumberIntVal(int64(renderer.configInt(resource, "maxAgeSeconds"))))
	block.Body().AppendBlock(rule)
	appendBlock(renderer.file("eventing.tf"), block)
}

func (renderer *terraformRenderer) renderS3Notifications() {
	// CloudFormation edge-only notifications have no explicit Id to collide.
	renderer.validateS3NotificationNames()
	for _, bucket := range renderer.model.Resources {
		if bucket.ServiceType != "aws.s3.bucket" || !renderer.shouldRenderResource(bucket.ID) {
			continue
		}
		edges := []NormalizedConnection{}
		for _, connection := range renderer.model.Connections {
			if connection.Source.NodeID == bucket.ID && (connection.RelationshipType == "aws.s3.notifies-lambda" || connection.RelationshipType == "aws.s3.sends-events-to-eventbridge") {
				edges = append(edges, connection)
			}
		}
		if len(edges) == 0 {
			continue
		}
		sort.Slice(edges, func(i, j int) bool { return compareUTF16(edges[i].ID, edges[j].ID) < 0 })
		block := hclwrite.NewBlock("resource", []string{"aws_s3_bucket_notification", renderer.resourceNames[bucket.ID]})
		block.Body().SetAttributeRaw("bucket", renderer.resourceAttributeTokens(bucket.ID, "id"))
		permissionDependencies := []hclwrite.Tokens{}
		for _, connection := range edges {
			if connection.RelationshipType == "aws.s3.sends-events-to-eventbridge" {
				if isCurrentAwsCatalog(renderer.model.Provenance.Catalog) {
					block.Body().SetAttributeValue("eventbridge", cty.BoolVal(true))
				} else {
					block.Body().AppendBlock(hclwrite.NewBlock("eventbridge", nil))
				}
				continue
			}
			if !renderer.validateConnectionConfiguration(connection, "aws.s3.notification.connection", []string{"deliverySemantics", "eventType", "filterPrefix", "filterSuffix"}) {
				continue
			}
			lambda := hclwrite.NewBlock("lambda_function", nil)
			permissionName, ok := renderer.lambdaPermissionNameForEdge(connection.ID)
			if !ok {
				renderer.error("TARGET_GENERATED_POLICY_COVERAGE_MISSING", "S3 notification is missing its generated Lambda invocation permission.", SourceReference{Document: DocumentArchitecture, EdgeID: connection.ID})
				continue
			}
			lambda.Body().SetAttributeTraversal("id", traversal("aws_lambda_permission", permissionName, "statement_id"))
			for _, owned := range renderer.relatedResources(bucket.ID, "aws.s3.bucket-owns-notification-configuration", true) {
				if owned.ServiceType == "aws.s3.bucket-notification-configuration" && renderer.configString(owned, "destinationKind") == "LAMBDA" && sameS3NotificationSettings(owned.Configuration.Values, connection.Configuration.Values) {
					lambda.Body().SetAttributeValue("id", cty.StringVal(renderer.configString(owned, "notificationName")))
					permissionDependencies = append(permissionDependencies, hclwrite.TokensForTraversal(traversal("aws_lambda_permission", permissionName)))
				}
			}
			lambda.Body().SetAttributeRaw("lambda_function_arn", renderer.resourceAttributeTokens(connection.Target.NodeID, "arn"))
			event := "s3:ObjectCreated:*"
			if renderer.connectionString(connection, "eventType") == "OBJECT_REMOVED" {
				event = "s3:ObjectRemoved:*"
			}
			lambda.Body().SetAttributeValue("events", stringListValue([]string{event}))
			if prefix := renderer.connectionString(connection, "filterPrefix"); prefix != "" {
				lambda.Body().SetAttributeValue("filter_prefix", cty.StringVal(prefix))
			}
			if suffix := renderer.connectionString(connection, "filterSuffix"); suffix != "" {
				lambda.Body().SetAttributeValue("filter_suffix", cty.StringVal(suffix))
			}
			block.Body().AppendBlock(lambda)
		}
		if len(permissionDependencies) > 0 {
			block.Body().SetAttributeRaw("depends_on", tupleTokens(permissionDependencies...))
		}
		appendBlock(renderer.file("eventing.tf"), block)
	}
}

func (renderer *terraformRenderer) lambdaPermissionNameForEdge(edgeID string) (string, bool) {
	for _, resource := range renderer.model.Resources {
		if resource.ServiceType == "aws.iam.policy-document" && resource.Lifecycle.Provenance != nil && containsString(resource.Lifecycle.Provenance.DependentEdgeIDs, edgeID) && renderer.configString(resource, "policyKind") == "service-grant" {
			return renderer.resourceNames[resource.ID], true
		}
	}
	return "", false
}

func (renderer *terraformRenderer) renderSQSQueue(resource NormalizedResource) {
	keys := []string{"contentBasedDeduplication", "deletionProtectionEnabled", "encryption", "messageRetentionSeconds", "queueName", "queueType", "receiveWaitTimeSeconds", "visibilityTimeoutSeconds"}
	if !renderer.validateEventConfiguration(resource, "1.0.0", keys) {
		return
	}
	block := renderer.resourceBlock(resource)
	body := block.Body()
	name := renderer.configString(resource, "queueName")
	fifo := renderer.configString(resource, "queueType") == "FIFO"
	if fifo && !strings.HasSuffix(name, ".fifo") {
		name += ".fifo"
	}
	body.SetAttributeValue("name", cty.StringVal(name))
	body.SetAttributeValue("fifo_queue", cty.BoolVal(fifo))
	body.SetAttributeValue("content_based_deduplication", cty.BoolVal(fifo && renderer.configBool(resource, "contentBasedDeduplication")))
	body.SetAttributeValue("sqs_managed_sse_enabled", cty.BoolVal(true))
	body.SetAttributeValue("message_retention_seconds", cty.NumberIntVal(int64(renderer.configInt(resource, "messageRetentionSeconds"))))
	body.SetAttributeValue("receive_wait_time_seconds", cty.NumberIntVal(int64(renderer.configInt(resource, "receiveWaitTimeSeconds"))))
	body.SetAttributeValue("visibility_timeout_seconds", cty.NumberIntVal(int64(renderer.configInt(resource, "visibilityTimeoutSeconds"))))
	if dlq, edge, ok := renderer.connectedWithEdge(resource.ID, "aws.sqs.uses-dead-letter-queue", false); ok {
		value := hclwrite.TokensForObject([]hclwrite.ObjectAttrTokens{{Name: hclwrite.TokensForIdentifier("deadLetterTargetArn"), Value: renderer.resourceAttributeTokens(dlq.ID, "arn")}, {Name: hclwrite.TokensForIdentifier("maxReceiveCount"), Value: hclwrite.TokensForValue(cty.NumberIntVal(int64(renderer.connectionInt(edge, "maximumReceiveCount"))))}})
		body.SetAttributeRaw("redrive_policy", hclwrite.TokensForFunctionCall("jsonencode", value))
	}
	appendPreventDestroy(body, renderer.configBool(resource, "deletionProtectionEnabled"))
	body.SetAttributeTraversal("tags", traversal("local", "tags"))
	appendBlock(renderer.file("eventing.tf"), block)
}

func (renderer *terraformRenderer) renderSQSRedriveAllowPolicies() {
	for _, connection := range renderer.model.Connections {
		if connection.RelationshipType != "aws.sqs.uses-dead-letter-queue" {
			continue
		}
		block := hclwrite.NewBlock("resource", []string{"aws_sqs_queue_redrive_allow_policy", renderer.resourceNames[connection.Target.NodeID] + "_" + shortDigest(connection.ID)})
		block.Body().SetAttributeRaw("queue_url", renderer.resourceAttributeTokens(connection.Target.NodeID, "id"))
		value := hclwrite.TokensForObject([]hclwrite.ObjectAttrTokens{{Name: hclwrite.TokensForIdentifier("redrivePermission"), Value: hclwrite.TokensForValue(cty.StringVal("byQueue"))}, {Name: hclwrite.TokensForIdentifier("sourceQueueArns"), Value: tupleTokens(renderer.resourceAttributeTokens(connection.Source.NodeID, "arn"))}})
		block.Body().SetAttributeRaw("redrive_allow_policy", hclwrite.TokensForFunctionCall("jsonencode", value))
		appendBlock(renderer.file("eventing.tf"), block)
	}
}

func (renderer *terraformRenderer) renderSNSTopic(resource NormalizedResource) {
	keys := []string{"contentBasedDeduplication", "deletionProtectionEnabled", "encryption", "topicName", "topicType"}
	if !renderer.validateEventConfiguration(resource, "1.0.0", keys) {
		return
	}
	block := renderer.resourceBlock(resource)
	body := block.Body()
	name := renderer.configString(resource, "topicName")
	fifo := renderer.configString(resource, "topicType") == "FIFO"
	if fifo && !strings.HasSuffix(name, ".fifo") {
		name += ".fifo"
	}
	body.SetAttributeValue("name", cty.StringVal(name))
	body.SetAttributeValue("fifo_topic", cty.BoolVal(fifo))
	body.SetAttributeValue("content_based_deduplication", cty.BoolVal(fifo && renderer.configBool(resource, "contentBasedDeduplication")))
	body.SetAttributeValue("kms_master_key_id", cty.StringVal("alias/aws/sns"))
	appendPreventDestroy(body, renderer.configBool(resource, "deletionProtectionEnabled"))
	body.SetAttributeTraversal("tags", traversal("local", "tags"))
	appendBlock(renderer.file("eventing.tf"), block)
}

func (renderer *terraformRenderer) renderSNSSubscriptions() {
	for _, subscription := range renderer.model.Resources {
		if subscription.ServiceType != "aws.sns.subscription" {
			continue
		}
		keys := []string{"deliverySemantics", "filterKeys", "filterScope", "protocol", "rawMessageDelivery", "retryPolicy", "subscriptionName"}
		if !renderer.validateEventConfiguration(subscription, "1.0.0", keys) {
			continue
		}
		topic, ok := renderer.connectedResource(subscription.ID, "aws.sns.topic-owns-subscription", true)
		if !ok {
			renderer.error("TARGET_EVENT_OWNER_REQUIRED", "SNS subscription requires one owning topic.", SourceReference{Document: DocumentArchitecture, NodeID: subscription.ID})
			continue
		}
		var destination NormalizedResource
		relation := "aws.sns.subscription-invokes-lambda"
		expectedProtocol := "LAMBDA"
		destination, ok = renderer.connectedResource(subscription.ID, relation, false)
		if !ok {
			relation = "aws.sns.subscription-sends-to-sqs"
			expectedProtocol = "SQS"
			destination, ok = renderer.connectedResource(subscription.ID, relation, false)
		}
		if !ok || renderer.configString(subscription, "protocol") != expectedProtocol {
			renderer.error("TARGET_SNS_SUBSCRIPTION_MODE_INVALID", "SNS subscription protocol must match exactly one typed destination edge.", SourceReference{Document: DocumentArchitecture, NodeID: subscription.ID})
			continue
		}
		block := hclwrite.NewBlock("resource", []string{"aws_sns_topic_subscription", renderer.resourceNames[subscription.ID]})
		block.Body().SetAttributeRaw("topic_arn", renderer.resourceAttributeTokens(topic.ID, "arn"))
		block.Body().SetAttributeValue("protocol", cty.StringVal(strings.ToLower(expectedProtocol)))
		block.Body().SetAttributeRaw("endpoint", renderer.resourceAttributeTokens(destination.ID, "arn"))
		block.Body().SetAttributeValue("raw_message_delivery", cty.BoolVal(renderer.configBool(subscription, "rawMessageDelivery")))
		appendBlock(renderer.file("eventing.tf"), block)
	}
}

func (renderer *terraformRenderer) renderEventBus(resource NormalizedResource) {
	keys := []string{"busName", "busType", "deletionProtectionEnabled", "encryption"}
	if !renderer.validateEventConfiguration(resource, "1.0.0", keys) {
		return
	}
	if renderer.configString(resource, "busType") == "DEFAULT" {
		block := hclwrite.NewBlock("data", []string{"aws_cloudwatch_event_bus", renderer.resourceNames[resource.ID]})
		block.Body().SetAttributeValue("name", cty.StringVal("default"))
		appendBlock(renderer.file("eventing.tf"), block)
		return
	}
	block := renderer.resourceBlock(resource)
	block.Body().SetAttributeValue("name", cty.StringVal(renderer.configString(resource, "busName")))
	appendPreventDestroy(block.Body(), renderer.configBool(resource, "deletionProtectionEnabled"))
	block.Body().SetAttributeTraversal("tags", traversal("local", "tags"))
	appendBlock(renderer.file("eventing.tf"), block)
}

func (renderer *terraformRenderer) renderEventRule(resource NormalizedResource) {
	keys := []string{"detailTypes", "enabled", "filterKeys", "ruleName", "scheduleExpression", "sourceKinds", "triggerMode"}
	if !renderer.validateEventConfiguration(resource, "1.1.0", keys) {
		return
	}
	bus, ok := renderer.connectedResource(resource.ID, "aws.eventbridge.event-bus-associates-rule", true)
	if !ok {
		renderer.error("TARGET_EVENT_OWNER_REQUIRED", "EventBridge rule requires one associated bus.", SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
		return
	}
	block := renderer.resourceBlock(resource)
	body := block.Body()
	body.SetAttributeValue("name", cty.StringVal(renderer.configString(resource, "ruleName")))
	body.SetAttributeValue("state", cty.StringVal(map[bool]string{true: "ENABLED", false: "DISABLED"}[renderer.configBool(resource, "enabled")]))
	body.SetAttributeRaw("event_bus_name", renderer.resourceAttributeTokens(bus.ID, "name"))
	if renderer.configString(resource, "triggerMode") == "SCHEDULE" {
		expressions := map[string]string{"RATE_5_MINUTES": "rate(5 minutes)", "RATE_1_HOUR": "rate(1 hour)", "RATE_1_DAY": "rate(1 day)"}
		body.SetAttributeValue("schedule_expression", cty.StringVal(expressions[renderer.configString(resource, "scheduleExpression")]))
	} else {
		sources := renderer.configStringList(resource, "sourceKinds")
		details := renderer.configStringList(resource, "detailTypes")
		sort.Strings(sources)
		sort.Strings(details)
		pattern, _ := json.Marshal(map[string]any{"detail-type": details, "source": sources})
		body.SetAttributeValue("event_pattern", cty.StringVal(string(pattern)))
	}
	body.SetAttributeTraversal("tags", traversal("local", "tags"))
	appendBlock(renderer.file("eventing.tf"), block)
}

func (renderer *terraformRenderer) renderEventTargets() {
	for _, target := range renderer.model.Resources {
		if target.ServiceType != "aws.eventbridge.target" {
			continue
		}
		keys := []string{"deadLetterMode", "deliverySemantics", "inputMode", "maximumEventAgeSeconds", "maximumRetryAttempts", "targetName", "targetType"}
		if !renderer.validateEventConfiguration(target, "1.0.0", keys) {
			continue
		}
		rule, ok := renderer.connectedResource(target.ID, "aws.eventbridge.rule-owns-target", true)
		if !ok {
			renderer.error("TARGET_EVENT_OWNER_REQUIRED", "EventBridge target requires one owning rule.", SourceReference{Document: DocumentArchitecture, NodeID: target.ID})
			continue
		}
		destinationRelations := map[string]string{"LAMBDA": "aws.eventbridge.target-invokes-lambda", "SQS": "aws.eventbridge.target-sends-to-sqs", "SNS": "aws.eventbridge.target-publishes-to-sns", "STEP_FUNCTIONS": "aws.eventbridge.target-starts-state-machine"}
		relation := destinationRelations[renderer.configString(target, "targetType")]
		destination, ok := renderer.connectedResource(target.ID, relation, false)
		if !ok {
			renderer.error("TARGET_EVENT_TARGET_MODE_INVALID", "EventBridge target type must match exactly one typed destination edge.", SourceReference{Document: DocumentArchitecture, NodeID: target.ID})
			continue
		}
		block := hclwrite.NewBlock("resource", []string{"aws_cloudwatch_event_target", renderer.resourceNames[target.ID]})
		body := block.Body()
		body.SetAttributeRaw("rule", renderer.resourceAttributeTokens(rule.ID, "name"))
		if bus, ok := renderer.connectedResource(rule.ID, "aws.eventbridge.event-bus-associates-rule", true); ok {
			body.SetAttributeRaw("event_bus_name", renderer.resourceAttributeTokens(bus.ID, "name"))
		}
		body.SetAttributeValue("target_id", cty.StringVal(renderer.configString(target, "targetName")))
		body.SetAttributeRaw("arn", renderer.resourceAttributeTokens(destination.ID, "arn"))
		if renderer.configString(target, "targetType") == "STEP_FUNCTIONS" {
			role, ok := renderer.connectedResource(target.ID, "aws.iam.role-assumed-by-eventbridge-target", true)
			if !ok {
				renderer.error("TARGET_EVENT_TARGET_ROLE_REQUIRED", "Step Functions EventBridge target requires one exact execution role.", SourceReference{Document: DocumentArchitecture, NodeID: target.ID})
			} else {
				body.SetAttributeRaw("role_arn", renderer.resourceAttributeTokens(role.ID, "arn"))
			}
		}
		retry := hclwrite.NewBlock("retry_policy", nil)
		retry.Body().SetAttributeValue("maximum_event_age_in_seconds", cty.NumberIntVal(int64(renderer.configInt(target, "maximumEventAgeSeconds"))))
		retry.Body().SetAttributeValue("maximum_retry_attempts", cty.NumberIntVal(int64(renderer.configInt(target, "maximumRetryAttempts"))))
		body.AppendBlock(retry)
		if renderer.configString(target, "deadLetterMode") == "SQS" {
			dlq, ok := renderer.connectedResource(target.ID, "aws.eventbridge.target-uses-dead-letter-queue", false)
			if !ok {
				renderer.error("TARGET_EVENT_DLQ_REQUIRED", "EventBridge target configured for SQS DLQ requires one typed DLQ edge.", SourceReference{Document: DocumentArchitecture, NodeID: target.ID})
			} else {
				dead := hclwrite.NewBlock("dead_letter_config", nil)
				dead.Body().SetAttributeRaw("arn", renderer.resourceAttributeTokens(dlq.ID, "arn"))
				body.AppendBlock(dead)
			}
		}
		appendBlock(renderer.file("eventing.tf"), block)
	}
}

func (renderer *terraformRenderer) renderSQSEventSourceMappings() {
	for _, connection := range renderer.model.Connections {
		if connection.RelationshipType != "aws.sqs.triggers-lambda" {
			continue
		}
		keys := []string{"batchSize", "batchingWindowSeconds", "deliverySemantics", "maximumConcurrency", "partialBatchResponse"}
		if !renderer.validateConnectionConfiguration(connection, "aws.sqs.lambda-consumer.connection", keys) {
			continue
		}
		block := hclwrite.NewBlock("resource", []string{"aws_lambda_event_source_mapping", renderer.resourceNames[connection.Source.NodeID] + "_" + shortDigest(connection.ID)})
		body := block.Body()
		body.SetAttributeRaw("event_source_arn", renderer.resourceAttributeTokens(connection.Source.NodeID, "arn"))
		body.SetAttributeRaw("function_name", renderer.resourceAttributeTokens(connection.Target.NodeID, "arn"))
		body.SetAttributeValue("batch_size", cty.NumberIntVal(int64(renderer.connectionInt(connection, "batchSize"))))
		body.SetAttributeValue("maximum_batching_window_in_seconds", cty.NumberIntVal(int64(renderer.connectionInt(connection, "batchingWindowSeconds"))))
		body.SetAttributeValue("function_response_types", stringListValue([]string{"ReportBatchItemFailures"}))
		scaling := hclwrite.NewBlock("scaling_config", nil)
		scaling.Body().SetAttributeValue("maximum_concurrency", cty.NumberIntVal(int64(renderer.connectionInt(connection, "maximumConcurrency"))))
		body.AppendBlock(scaling)
		appendBlock(renderer.file("eventing.tf"), block)
	}
}

func (renderer *terraformRenderer) renderLambdaDeadLetterConfig(body *hclwrite.Body, resource NormalizedResource) {
	if !renderer.isCurrentCatalog() {
		return
	}
	queue, _, ok := renderer.connectedWithEdge(resource.ID, "aws.lambda.uses-sqs-dead-letter-queue", false)
	if !ok {
		return
	}
	block := hclwrite.NewBlock("dead_letter_config", nil)
	block.Body().SetAttributeRaw("target_arn", renderer.resourceAttributeTokens(queue.ID, "arn"))
	body.AppendBlock(block)
}

func (renderer *terraformRenderer) renderStateMachine(resource NormalizedResource) {
	keys := []string{"definitionMode", "deletionProtectionEnabled", "encryption", "executionTimeoutSeconds", "loggingMode", "stateMachineName", "tracingEnabled", "workflowType"}
	if !renderer.validateEventConfiguration(resource, "1.0.0", keys) {
		return
	}
	role, ok := renderer.connectedResource(resource.ID, "aws.iam.role-assumed-by-step-functions", true)
	if !ok {
		renderer.error("TARGET_STATE_MACHINE_ROLE_REQUIRED", "State machine requires one exact Step Functions execution role.", SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
		return
	}
	tasks := []NormalizedConnection{}
	for _, connection := range renderer.model.Connections {
		if connection.RelationshipType == "aws.stepfunctions.state-machine-invokes-lambda" && connection.Source.NodeID == resource.ID {
			tasks = append(tasks, connection)
		}
	}
	sort.Slice(tasks, func(i, j int) bool { return compareUTF16(tasks[i].ID, tasks[j].ID) < 0 })
	if len(tasks) == 0 {
		renderer.error("TARGET_STATE_MACHINE_TASK_REQUIRED", "State machine requires at least one reviewed Lambda task edge.", SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
		return
	}
	states := make([]hclwrite.ObjectAttrTokens, len(tasks))
	names := make([]string, len(tasks))
	for i, task := range tasks {
		names[i] = "Task_" + terraformIdentifier(task.Target.NodeID) + "_" + shortDigest(task.ID)
	}
	for i, task := range tasks {
		attrs := []hclwrite.ObjectAttrTokens{{Name: hclwrite.TokensForIdentifier("Type"), Value: hclwrite.TokensForValue(cty.StringVal("Task"))}, {Name: hclwrite.TokensForIdentifier("Resource"), Value: renderer.resourceAttributeTokens(task.Target.NodeID, "arn")}, {Name: hclwrite.TokensForIdentifier("TimeoutSeconds"), Value: hclwrite.TokensForValue(cty.NumberIntVal(int64(renderer.connectionInt(task, "taskTimeoutSeconds"))))}}
		if i == len(tasks)-1 {
			attrs = append(attrs, hclwrite.ObjectAttrTokens{Name: hclwrite.TokensForIdentifier("End"), Value: hclwrite.TokensForValue(cty.BoolVal(true))})
		} else {
			attrs = append(attrs, hclwrite.ObjectAttrTokens{Name: hclwrite.TokensForIdentifier("Next"), Value: hclwrite.TokensForValue(cty.StringVal(names[i+1]))})
		}
		if renderer.connectionString(task, "retryMode") == "BOUNDED_EXPONENTIAL" {
			// The catalog's maximumAttempts is the total number of executions. ASL
			// MaxAttempts counts retries after the initial execution.
			maxRetries := renderer.connectionInt(task, "maximumAttempts") - 1
			retry := hclwrite.TokensForObject([]hclwrite.ObjectAttrTokens{{Name: hclwrite.TokensForIdentifier("ErrorEquals"), Value: tupleTokens(hclwrite.TokensForValue(cty.StringVal("States.ALL")))}, {Name: hclwrite.TokensForIdentifier("IntervalSeconds"), Value: hclwrite.TokensForValue(cty.NumberIntVal(2))}, {Name: hclwrite.TokensForIdentifier("MaxAttempts"), Value: hclwrite.TokensForValue(cty.NumberIntVal(int64(maxRetries)))}, {Name: hclwrite.TokensForIdentifier("BackoffRate"), Value: hclwrite.TokensForValue(cty.NumberIntVal(2))}})
			attrs = append(attrs, hclwrite.ObjectAttrTokens{Name: hclwrite.TokensForIdentifier("Retry"), Value: tupleTokens(retry)})
		}
		states[i] = hclwrite.ObjectAttrTokens{Name: hclwrite.TokensForValue(cty.StringVal(names[i])), Value: hclwrite.TokensForObject(attrs)}
	}
	definition := hclwrite.TokensForObject([]hclwrite.ObjectAttrTokens{{Name: hclwrite.TokensForIdentifier("Comment"), Value: hclwrite.TokensForValue(cty.StringVal("CloudMarkup catalog-derived workflow"))}, {Name: hclwrite.TokensForIdentifier("StartAt"), Value: hclwrite.TokensForValue(cty.StringVal(names[0]))}, {Name: hclwrite.TokensForIdentifier("TimeoutSeconds"), Value: hclwrite.TokensForValue(cty.NumberIntVal(int64(renderer.configInt(resource, "executionTimeoutSeconds"))))}, {Name: hclwrite.TokensForIdentifier("States"), Value: hclwrite.TokensForObject(states)}})
	logName := renderer.resourceNames[resource.ID] + "_logs"
	logs := hclwrite.NewBlock("resource", []string{"aws_cloudwatch_log_group", logName})
	logs.Body().SetAttributeValue("name", cty.StringVal("/aws/vendedlogs/states/"+renderer.configString(resource, "stateMachineName")))
	logs.Body().SetAttributeValue("retention_in_days", cty.NumberIntVal(30))
	appendPreventDestroy(logs.Body(), true)
	logs.Body().SetAttributeTraversal("tags", traversal("local", "tags"))
	appendBlock(renderer.file("eventing.tf"), logs)
	block := renderer.resourceBlock(resource)
	body := block.Body()
	body.SetAttributeValue("name", cty.StringVal(renderer.configString(resource, "stateMachineName")))
	body.SetAttributeValue("type", cty.StringVal("STANDARD"))
	body.SetAttributeRaw("role_arn", renderer.resourceAttributeTokens(role.ID, "arn"))
	body.SetAttributeRaw("definition", hclwrite.TokensForFunctionCall("jsonencode", definition))
	logging := hclwrite.NewBlock("logging_configuration", nil)
	logging.Body().SetAttributeValue("include_execution_data", cty.BoolVal(false))
	logging.Body().SetAttributeValue("level", cty.StringVal("ERROR"))
	logging.Body().SetAttributeRaw("log_destination", formatTokens("%s:*", hclwrite.TokensForTraversal(traversal("aws_cloudwatch_log_group", logName, "arn"))))
	body.AppendBlock(logging)
	tracingBlock := hclwrite.NewBlock("tracing_configuration", nil)
	tracingBlock.Body().SetAttributeValue("enabled", cty.BoolVal(renderer.configBool(resource, "tracingEnabled")))
	body.AppendBlock(tracingBlock)
	appendPreventDestroy(body, renderer.configBool(resource, "deletionProtectionEnabled"))
	body.SetAttributeTraversal("tags", traversal("local", "tags"))
	appendBlock(renderer.file("eventing.tf"), block)
}

func (renderer *terraformRenderer) validateEventResourcePolicyDocument(document terraformPolicyDocument) bool {
	prefixes := map[string]string{
		"aws.s3.bucket": "s3:", "aws.sqs.queue": "sqs:", "aws.sns.topic": "sns:", "aws.eventbridge.event-bus": "events:",
	}
	prefix, supported := prefixes[document.Owner.ServiceType]
	if !supported {
		return false
	}
	valid := true
	for _, statement := range document.Statements {
		if len(statement.Scopes) != 1 || statement.Scopes[0].ID != document.Owner.ID || statement.PrincipalKind == "none" || len(statement.Principals) == 0 {
			valid = false
		}
		for _, action := range statement.Actions {
			valid = valid && strings.HasPrefix(action, prefix)
		}
	}
	if !valid {
		renderer.error("TARGET_EVENT_RESOURCE_POLICY_INVALID", "Event resource policy must use exact owner scope, service-matched actions, and an explicit canonical principal.", SourceReference{Document: DocumentArchitecture, NodeID: document.Resource.ID})
	}
	return valid
}

func (renderer *terraformRenderer) renderEventResourcePolicies(documents []terraformPolicyDocument) {
	if !renderer.isCurrentCatalog() {
		return
	}
	for _, document := range documents {
		if document.Kind != "resource" {
			continue
		}
		switch document.Owner.ServiceType {
		case "aws.s3.bucket", "aws.sqs.queue", "aws.sns.topic":
			resourceType := map[string]string{"aws.s3.bucket": "aws_s3_bucket_policy", "aws.sqs.queue": "aws_sqs_queue_policy", "aws.sns.topic": "aws_sns_topic_policy"}[document.Owner.ServiceType]
			block := hclwrite.NewBlock("resource", []string{resourceType, renderer.resourceNames[document.Resource.ID]})
			if isCurrentAwsCatalog(renderer.model.Provenance.Catalog) && cloudfrontGeneratedPolicy(document) {
				dnsLifecycle(block.Body(), false)
			}
			switch document.Owner.ServiceType {
			case "aws.s3.bucket":
				block.Body().SetAttributeRaw("bucket", renderer.resourceAttributeTokens(document.Owner.ID, "id"))
			case "aws.sqs.queue":
				block.Body().SetAttributeRaw("queue_url", renderer.resourceAttributeTokens(document.Owner.ID, "id"))
			case "aws.sns.topic":
				block.Body().SetAttributeRaw("arn", renderer.resourceAttributeTokens(document.Owner.ID, "arn"))
			}
			block.Body().SetAttributeTraversal("policy", traversal("data", "aws_iam_policy_document", renderer.resourceNames[document.Resource.ID], "json"))
			appendBlock(renderer.file("security.tf"), block)
		case "aws.eventbridge.event-bus":
			for index, statement := range document.Statements {
				if len(statement.Actions) != 1 || len(statement.Principals) != 1 || statement.PrincipalKind == "all-principals" || len(statement.Expressions) != 0 || len(statement.Conditions) != 0 {
					renderer.error("TARGET_EVENT_BUS_POLICY_UNSUPPORTED", "EventBridge bus policy statements require one exact action and one explicit principal.", SourceReference{Document: DocumentArchitecture, NodeID: statement.Resource.ID})
					continue
				}
				name := renderer.resourceNames[document.Resource.ID]
				if len(document.Statements) > 1 {
					name += "_" + fmt.Sprint(index+1)
				}
				block := hclwrite.NewBlock("resource", []string{"aws_cloudwatch_event_bus_policy", name})
				block.Body().SetAttributeRaw("event_bus_name", renderer.resourceAttributeTokens(document.Owner.ID, "name"))
				block.Body().SetAttributeValue("statement_id", cty.StringVal(statementID(statement.StatementID)))
				block.Body().SetAttributeValue("action", cty.StringVal(statement.Actions[0]))
				block.Body().SetAttributeValue("principal", cty.StringVal(statement.Principals[0]))
				appendBlock(renderer.file("security.tf"), block)
			}
		}
	}
}

func (renderer *terraformRenderer) connectionBool(connection NormalizedConnection, key string) bool {
	value := connection.Configuration.Values[key]
	result, ok := value.Value.(bool)
	if value.Kind != "boolean" || !ok {
		renderer.error("TARGET_CONNECTION_VALUE_INVALID", "Relationship configuration value has an unsupported boolean type.", SourceReference{Document: DocumentArchitecture, EdgeID: connection.ID})
	}
	return result
}

func (renderer *terraformRenderer) eventRoleID(nodeID, relationship string) string {
	role, ok := renderer.connectedResource(nodeID, relationship, true)
	if !ok {
		return ""
	}
	return role.ID
}

func (renderer *terraformRenderer) debugEventAddress(resource NormalizedResource) string {
	return fmt.Sprintf("%s.%s", terraformResourceTypeByService[resource.ServiceType], renderer.resourceNames[resource.ID])
}
