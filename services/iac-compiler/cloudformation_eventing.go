package compiler

import (
	"sort"
	"strings"
)

func (renderer *cloudFormationRenderer) renderS3Bucket(resource NormalizedResource) {
	keys := []string{"blockPublicAccess", "bucketName", "deletionProtectionEnabled", "encryption", "objectOwnership", "versioningEnabled"}
	if !renderer.validateEventConfiguration(resource, "1.0.0", keys) {
		return
	}
	properties := map[string]any{
		"BucketEncryption": map[string]any{"ServerSideEncryptionConfiguration": []any{map[string]any{"ServerSideEncryptionByDefault": map[string]any{"SSEAlgorithm": "AES256"}}}},
		"BucketName":       renderer.configString(resource, "bucketName"),
		"OwnershipControls": map[string]any{"Rules": []any{map[string]any{
			"ObjectOwnership": "BucketOwnerEnforced",
		}}},
		"PublicAccessBlockConfiguration": map[string]any{
			"BlockPublicAcls": true, "BlockPublicPolicy": true, "IgnorePublicAcls": true, "RestrictPublicBuckets": true,
		},
		"Tags": renderer.tagList(), "VersioningConfiguration": map[string]any{"Status": "Enabled"},
	}
	metadata := renderer.resourceMetadata(resource)
	embedded := []any{}
	if lifecycle := renderer.relatedResources(resource.ID, "aws.s3.bucket-owns-lifecycle-configuration", true); len(lifecycle) == 1 {
		configuration := lifecycle[0]
		if !renderer.validateEventConfiguration(configuration, "1.0.0", []string{"expirationDays", "expireNoncurrentVersions", "ruleName", "transition"}) {
			return
		}
		rule := map[string]any{
			"ExpirationInDays": renderer.configInt(configuration, "expirationDays"), "Id": renderer.configString(configuration, "ruleName"), "Status": "Enabled",
		}
		if renderer.configString(configuration, "transition") == "INTELLIGENT_TIERING_AFTER_30_DAYS" {
			rule["Transitions"] = []any{map[string]any{"StorageClass": "INTELLIGENT_TIERING", "TransitionInDays": 30}}
		}
		if renderer.configBool(configuration, "expireNoncurrentVersions") {
			rule["NoncurrentVersionExpiration"] = map[string]any{"NoncurrentDays": renderer.configInt(configuration, "expirationDays")}
		}
		properties["LifecycleConfiguration"] = map[string]any{"Rules": []any{rule}}
		embedded = append(embedded, configuration.ID)
	}
	if cors := renderer.relatedResources(resource.ID, "aws.s3.bucket-owns-cors-configuration", true); len(cors) == 1 {
		configuration := cors[0]
		if !renderer.validateEventConfiguration(configuration, "1.0.0", []string{"allowedHeaders", "allowedMethods", "allowedOrigins", "maxAgeSeconds"}) {
			return
		}
		properties["CorsConfiguration"] = map[string]any{"CorsRules": []any{map[string]any{
			"AllowedHeaders": renderer.configStringList(configuration, "allowedHeaders"), "AllowedMethods": renderer.configStringList(configuration, "allowedMethods"),
			"AllowedOrigins": renderer.configStringList(configuration, "allowedOrigins"), "MaxAge": renderer.configInt(configuration, "maxAgeSeconds"),
		}}}
		embedded = append(embedded, configuration.ID)
	}
	for _, configuration := range renderer.relatedResources(resource.ID, "aws.s3.bucket-owns-notification-configuration", true) {
		if !renderer.validateEventConfiguration(configuration, "1.0.0", []string{"deliverySemantics", "destinationKind", "eventType", "filterPrefix", "filterSuffix", "notificationName"}) {
			return
		}
		renderer.error("CLOUDFORMATION_S3_OWNED_NOTIFICATION_NAME_UNSUPPORTED", "CloudFormation LambdaConfiguration cannot represent the required owned notificationName. Export this named child with Terraform, or explicitly remove the owned child and retain the reviewed delivery edge if its name is not required.", SourceReference{Document: DocumentArchitecture, NodeID: configuration.ID})
		return
	}

	notifications := []any{}
	eventBridgeEnabled := false
	dependsOn := []string{}
	for _, connection := range renderer.model.Connections {
		if connection.Source.NodeID != resource.ID {
			continue
		}
		switch connection.RelationshipType {
		case "aws.s3.sends-events-to-eventbridge":
			eventBridgeEnabled = true
		case "aws.s3.notifies-lambda":
			if !renderer.validateEventConnectionConfiguration(connection, "aws.s3.notification.connection", []string{"deliverySemantics", "eventType", "filterPrefix", "filterSuffix"}) {
				continue
			}
			permission, ok := renderer.lambdaPermissionLogicalIDForEdge(connection.ID)
			if !ok {
				renderer.error("CLOUDFORMATION_GENERATED_POLICY_COVERAGE_MISSING", "S3 notification is missing its generated Lambda invocation permission.", SourceReference{Document: DocumentArchitecture, EdgeID: connection.ID})
				continue
			}
			dependsOn = append(dependsOn, permission)
			event := "s3:ObjectCreated:*"
			if renderer.connectionString(connection, "eventType") == "OBJECT_REMOVED" {
				event = "s3:ObjectRemoved:*"
			}
			entry := map[string]any{"Event": event, "Function": renderer.resourceAttribute(connection.Target.NodeID, "arn")}
			filters := []any{}
			if prefix := renderer.connectionString(connection, "filterPrefix"); prefix != "" {
				filters = append(filters, map[string]any{"Name": "prefix", "Value": prefix})
			}
			if suffix := renderer.connectionString(connection, "filterSuffix"); suffix != "" {
				filters = append(filters, map[string]any{"Name": "suffix", "Value": suffix})
			}
			if len(filters) > 0 {
				entry["Filter"] = map[string]any{"S3Key": map[string]any{"Rules": filters}}
			}
			notifications = append(notifications, entry)
		}
	}
	if len(notifications) > 0 || eventBridgeEnabled {
		configuration := map[string]any{}
		if len(notifications) > 0 {
			configuration["LambdaConfigurations"] = notifications
		}
		if eventBridgeEnabled {
			configuration["EventBridgeConfiguration"] = map[string]any{"EventBridgeEnabled": true}
		}
		properties["NotificationConfiguration"] = configuration
	}
	if len(embedded) > 0 {
		metadata["CloudMarkup"].(map[string]any)["EmbeddedConfigurationIds"] = embedded
	}
	sort.Strings(dependsOn)
	entry := cloudFormationResource{Type: "AWS::S3::Bucket", Properties: properties, Metadata: metadata, DependsOn: dependsOn}
	if renderer.configBool(resource, "deletionProtectionEnabled") {
		entry.DeletionPolicy, entry.UpdateReplacePolicy = "Retain", "Retain"
	}
	renderer.addResource(renderer.logicalIDs[resource.ID], entry, SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
}

func (renderer *cloudFormationRenderer) lambdaPermissionLogicalIDForEdge(edgeID string) (string, bool) {
	for _, document := range renderer.policyDocuments {
		if document.Kind == "service-grant" && document.Resource.Lifecycle.Provenance != nil && containsString(document.Resource.Lifecycle.Provenance.DependentEdgeIDs, edgeID) {
			return renderer.logicalIDs[document.Resource.ID], true
		}
	}
	return "", false
}

func (renderer *cloudFormationRenderer) renderSQSQueue(resource NormalizedResource) {
	keys := []string{"contentBasedDeduplication", "deletionProtectionEnabled", "encryption", "messageRetentionSeconds", "queueName", "queueType", "receiveWaitTimeSeconds", "visibilityTimeoutSeconds"}
	if !renderer.validateEventConfiguration(resource, "1.0.0", keys) {
		return
	}
	name := renderer.sqsQueueName(resource)
	fifo := renderer.configString(resource, "queueType") == "FIFO"
	properties := map[string]any{
		"ContentBasedDeduplication": fifo && renderer.configBool(resource, "contentBasedDeduplication"), "FifoQueue": fifo,
		"MessageRetentionPeriod": renderer.configInt(resource, "messageRetentionSeconds"), "QueueName": name,
		"ReceiveMessageWaitTimeSeconds": renderer.configInt(resource, "receiveWaitTimeSeconds"), "SqsManagedSseEnabled": true,
		"Tags": renderer.tagList(), "VisibilityTimeout": renderer.configInt(resource, "visibilityTimeoutSeconds"),
	}
	for _, configuration := range renderer.relatedResources(resource.ID, "aws.sqs.queue-owns-redrive-configuration", true) {
		if !renderer.validateEventConfiguration(configuration, "1.0.0", []string{"maximumReceiveCount", "redrivePermission", "replayMode"}) {
			return
		}
	}
	if dlq, edge, ok := renderer.connectedWithEdge(resource.ID, "aws.sqs.uses-dead-letter-queue", false); ok {
		if !renderer.validateEventConnectionConfiguration(edge, "aws.sqs.redrive.connection", []string{"maximumReceiveCount", "replayMode"}) {
			return
		}
		properties["RedrivePolicy"] = map[string]any{"deadLetterTargetArn": renderer.resourceAttribute(dlq.ID, "arn"), "maxReceiveCount": renderer.connectionInt(edge, "maximumReceiveCount")}
	}
	sources := renderer.relatedResources(resource.ID, "aws.sqs.uses-dead-letter-queue", true)
	if len(sources) > 10 {
		renderer.error("CLOUDFORMATION_SQS_REDRIVE_SOURCE_LIMIT", "A dead-letter queue supports at most ten explicitly connected source queues.", SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
		return
	}
	if len(sources) > 0 {
		arns := make([]any, 0, len(sources))
		for _, source := range sources {
			// Referencing the source resource here would create a reciprocal
			// dependency with its RedrivePolicy. Both queues have explicit names.
			arns = append(arns, cloudFormationJoin("arn:", cloudFormationRef("AWS::Partition"), ":sqs:", cloudFormationRef("AWS::Region"), ":", cloudFormationRef("AWS::AccountId"), ":", renderer.sqsQueueName(source)))
		}
		properties["RedriveAllowPolicy"] = map[string]any{"redrivePermission": "byQueue", "sourceQueueArns": arns}
	}
	entry := cloudFormationResource{Type: "AWS::SQS::Queue", Properties: properties, Metadata: renderer.resourceMetadata(resource)}
	if renderer.configBool(resource, "deletionProtectionEnabled") {
		entry.DeletionPolicy, entry.UpdateReplacePolicy = "Retain", "Retain"
	}
	renderer.addResource(renderer.logicalIDs[resource.ID], entry, SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
}

func (renderer *cloudFormationRenderer) sqsQueueName(resource NormalizedResource) string {
	value := resource.Configuration.Values["queueName"]
	name, literal := value.Value.(string)
	if value.Kind != "string" || !literal || strings.TrimSpace(name) == "" {
		renderer.error("CLOUDFORMATION_SQS_QUEUE_NAME_UNSUPPORTED", "SQS queue names must be explicit nonempty literal strings.", SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
		return ""
	}
	if renderer.configString(resource, "queueType") == "FIFO" && !strings.HasSuffix(name, ".fifo") {
		name += ".fifo"
	}
	return name
}

func (renderer *cloudFormationRenderer) renderSNSTopic(resource NormalizedResource) {
	keys := []string{"contentBasedDeduplication", "deletionProtectionEnabled", "encryption", "topicName", "topicType"}
	if !renderer.validateEventConfiguration(resource, "1.0.0", keys) {
		return
	}
	name := renderer.configString(resource, "topicName")
	fifo := renderer.configString(resource, "topicType") == "FIFO"
	if fifo && !strings.HasSuffix(name, ".fifo") {
		name += ".fifo"
	}
	entry := cloudFormationResource{Type: "AWS::SNS::Topic", Properties: map[string]any{
		"ContentBasedDeduplication": fifo && renderer.configBool(resource, "contentBasedDeduplication"), "FifoTopic": fifo,
		"KmsMasterKeyId": "alias/aws/sns", "Tags": renderer.tagList(), "TopicName": name,
	}, Metadata: renderer.resourceMetadata(resource)}
	if renderer.configBool(resource, "deletionProtectionEnabled") {
		entry.DeletionPolicy, entry.UpdateReplacePolicy = "Retain", "Retain"
	}
	renderer.addResource(renderer.logicalIDs[resource.ID], entry, SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
}

func (renderer *cloudFormationRenderer) renderEventBus(resource NormalizedResource) {
	if !renderer.validateEventConfiguration(resource, "1.0.0", []string{"busName", "busType", "deletionProtectionEnabled", "encryption"}) {
		return
	}
	if renderer.configString(resource, "busType") == "DEFAULT" {
		return
	}
	entry := cloudFormationResource{Type: "AWS::Events::EventBus", Properties: map[string]any{
		"Name": renderer.configString(resource, "busName"), "Tags": renderer.tagList(),
	}, Metadata: renderer.resourceMetadata(resource)}
	if renderer.configBool(resource, "deletionProtectionEnabled") {
		entry.DeletionPolicy, entry.UpdateReplacePolicy = "Retain", "Retain"
	}
	renderer.addResource(renderer.logicalIDs[resource.ID], entry, SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
}

func (renderer *cloudFormationRenderer) renderEventRule(resource NormalizedResource) {
	if !renderer.validateEventConfiguration(resource, "1.1.0", []string{"detailTypes", "enabled", "filterKeys", "ruleName", "scheduleExpression", "sourceKinds", "triggerMode"}) {
		return
	}
	bus, _ := renderer.connectedResource(resource.ID, "aws.eventbridge.event-bus-associates-rule", true)
	properties := map[string]any{
		"Name": renderer.configString(resource, "ruleName"), "State": map[bool]string{true: "ENABLED", false: "DISABLED"}[renderer.configBool(resource, "enabled")],
		"Tags": renderer.tagList(),
	}
	if renderer.configString(resource, "triggerMode") == "SCHEDULE" {
		expressions := map[string]string{"RATE_5_MINUTES": "rate(5 minutes)", "RATE_1_HOUR": "rate(1 hour)", "RATE_1_DAY": "rate(1 day)"}
		properties["ScheduleExpression"] = expressions[renderer.configString(resource, "scheduleExpression")]
	} else {
		properties["EventPattern"] = map[string]any{"detail-type": renderer.configStringList(resource, "detailTypes"), "source": renderer.configStringList(resource, "sourceKinds")}
		properties["EventBusName"] = renderer.resourceAttribute(bus.ID, "name")
	}
	targets := []any{}
	for _, target := range renderer.relatedResources(resource.ID, "aws.eventbridge.rule-owns-target", true) {
		if !renderer.validateEventConfiguration(target, "1.0.0", []string{"deadLetterMode", "deliverySemantics", "inputMode", "maximumEventAgeSeconds", "maximumRetryAttempts", "targetName", "targetType"}) {
			continue
		}
		destinationRelations := map[string]string{"LAMBDA": "aws.eventbridge.target-invokes-lambda", "SQS": "aws.eventbridge.target-sends-to-sqs", "SNS": "aws.eventbridge.target-publishes-to-sns", "STEP_FUNCTIONS": "aws.eventbridge.target-starts-state-machine"}
		destination, ok := renderer.connectedResource(target.ID, destinationRelations[renderer.configString(target, "targetType")], false)
		if !ok {
			renderer.error("CLOUDFORMATION_EVENT_TARGET_MODE_INVALID", "EventBridge target type must match exactly one typed destination edge.", SourceReference{Document: DocumentArchitecture, NodeID: target.ID})
			continue
		}
		entry := map[string]any{
			"Arn": renderer.resourceAttribute(destination.ID, "arn"), "Id": renderer.configString(target, "targetName"),
			"RetryPolicy": map[string]any{"MaximumEventAgeInSeconds": renderer.configInt(target, "maximumEventAgeSeconds"), "MaximumRetryAttempts": renderer.configInt(target, "maximumRetryAttempts")},
		}
		if renderer.configString(target, "targetType") == "STEP_FUNCTIONS" {
			if role, found := renderer.connectedResource(target.ID, "aws.iam.role-assumed-by-eventbridge-target", true); found {
				entry["RoleArn"] = renderer.resourceAttribute(role.ID, "arn")
			}
		}
		if renderer.configString(target, "deadLetterMode") == "SQS" {
			if dlq, found := renderer.connectedResource(target.ID, "aws.eventbridge.target-uses-dead-letter-queue", false); found {
				entry["DeadLetterConfig"] = map[string]any{"Arn": renderer.resourceAttribute(dlq.ID, "arn")}
			}
		}
		targets = append(targets, entry)
	}
	if len(targets) > 0 {
		properties["Targets"] = targets
	}
	renderer.addResource(renderer.logicalIDs[resource.ID], cloudFormationResource{Type: "AWS::Events::Rule", Properties: properties, Metadata: renderer.resourceMetadata(resource)}, SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
}

func (renderer *cloudFormationRenderer) renderStateMachine(resource NormalizedResource) {
	if !renderer.validateEventConfiguration(resource, "1.0.0", []string{"definitionMode", "deletionProtectionEnabled", "encryption", "executionTimeoutSeconds", "loggingMode", "stateMachineName", "tracingEnabled", "workflowType"}) {
		return
	}
	role, ok := renderer.connectedResource(resource.ID, "aws.iam.role-assumed-by-step-functions", true)
	if !ok {
		renderer.error("CLOUDFORMATION_STATE_MACHINE_ROLE_REQUIRED", "State machine requires one exact Step Functions execution role.", SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
		return
	}
	tasks := []NormalizedConnection{}
	for _, connection := range renderer.model.Connections {
		if connection.RelationshipType == "aws.stepfunctions.state-machine-invokes-lambda" && connection.Source.NodeID == resource.ID {
			if !renderer.validateEventConnectionConfiguration(connection, "aws.stepfunctions.lambda-task.connection", []string{"maximumAttempts", "retryMode", "taskTimeoutSeconds"}) {
				continue
			}
			tasks = append(tasks, connection)
		}
	}
	sort.Slice(tasks, func(left int, right int) bool { return compareUTF16(tasks[left].ID, tasks[right].ID) < 0 })
	if len(tasks) == 0 {
		renderer.error("CLOUDFORMATION_STATE_MACHINE_TASK_REQUIRED", "State machine requires at least one reviewed Lambda task edge.", SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
		return
	}
	states := map[string]any{}
	names := make([]string, len(tasks))
	for index, task := range tasks {
		names[index] = "Task" + cloudFormationIdentifier(task.Target.NodeID) + strings.ToUpper(shortDigest(task.ID))
	}
	for index, task := range tasks {
		state := map[string]any{"Resource": renderer.resourceAttribute(task.Target.NodeID, "arn"), "TimeoutSeconds": renderer.connectionInt(task, "taskTimeoutSeconds"), "Type": "Task"}
		if index == len(tasks)-1 {
			state["End"] = true
		} else {
			state["Next"] = names[index+1]
		}
		if renderer.connectionString(task, "retryMode") == "BOUNDED_EXPONENTIAL" {
			state["Retry"] = []any{map[string]any{"BackoffRate": 2, "ErrorEquals": []any{"States.ALL"}, "IntervalSeconds": 2, "MaxAttempts": renderer.connectionInt(task, "maximumAttempts") - 1}}
		}
		states[names[index]] = state
	}
	logID := renderer.derivedLogicalID(resource.DeploymentKey + " state machine logs")
	renderer.addResource(logID, cloudFormationResource{Type: "AWS::Logs::LogGroup", Properties: map[string]any{
		"LogGroupName": "/aws/vendedlogs/states/" + renderer.configString(resource, "stateMachineName"), "RetentionInDays": 30, "Tags": renderer.tagList(),
	}, DeletionPolicy: "Retain", UpdateReplacePolicy: "Retain"}, SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
	entry := cloudFormationResource{Type: "AWS::StepFunctions::StateMachine", Properties: map[string]any{
		"Definition":           map[string]any{"Comment": "CloudMarkup catalog-derived workflow", "StartAt": names[0], "States": states, "TimeoutSeconds": renderer.configInt(resource, "executionTimeoutSeconds")},
		"LoggingConfiguration": map[string]any{"Destinations": []any{map[string]any{"CloudWatchLogsLogGroup": map[string]any{"LogGroupArn": cloudFormationJoin(cloudFormationGetAtt(logID, "Arn"), ":*")}}}, "IncludeExecutionData": false, "Level": "ERROR"},
		"RoleArn":              renderer.resourceAttribute(role.ID, "arn"), "StateMachineName": renderer.configString(resource, "stateMachineName"), "StateMachineType": "STANDARD",
		"Tags": renderer.tagList(), "TracingConfiguration": map[string]any{"Enabled": renderer.configBool(resource, "tracingEnabled")},
	}, Metadata: renderer.resourceMetadata(resource)}
	if renderer.configBool(resource, "deletionProtectionEnabled") {
		entry.DeletionPolicy, entry.UpdateReplacePolicy = "Retain", "Retain"
	}
	renderer.addResource(renderer.logicalIDs[resource.ID], entry, SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
}

func (renderer *cloudFormationRenderer) renderEventConnections() {
	if !renderer.isCurrentCatalog() {
		return
	}
	for _, subscription := range renderer.model.Resources {
		if subscription.ServiceType != "aws.sns.subscription" {
			continue
		}
		if !renderer.validateEventConfiguration(subscription, "1.0.0", []string{"deliverySemantics", "filterKeys", "filterScope", "protocol", "rawMessageDelivery", "retryPolicy", "subscriptionName"}) {
			continue
		}
		topic, topicOK := renderer.connectedResource(subscription.ID, "aws.sns.topic-owns-subscription", true)
		destination, destinationOK := renderer.connectedResource(subscription.ID, "aws.sns.subscription-invokes-lambda", false)
		protocol := "lambda"
		expectedProtocol := "LAMBDA"
		if !destinationOK {
			destination, destinationOK = renderer.connectedResource(subscription.ID, "aws.sns.subscription-sends-to-sqs", false)
			protocol = "sqs"
			expectedProtocol = "SQS"
		}
		if !topicOK || !destinationOK || renderer.configString(subscription, "protocol") != expectedProtocol {
			renderer.error("CLOUDFORMATION_SNS_SUBSCRIPTION_MODE_INVALID", "SNS subscription protocol must match exactly one typed owner and destination edge.", SourceReference{Document: DocumentArchitecture, NodeID: subscription.ID})
			continue
		}
		renderer.addResource(renderer.logicalIDs[subscription.ID], cloudFormationResource{Type: "AWS::SNS::Subscription", Properties: map[string]any{
			"Endpoint": renderer.resourceAttribute(destination.ID, "arn"), "Protocol": protocol, "RawMessageDelivery": renderer.configBool(subscription, "rawMessageDelivery"), "TopicArn": renderer.resourceAttribute(topic.ID, "arn"),
		}, Metadata: renderer.resourceMetadata(subscription)}, SourceReference{Document: DocumentArchitecture, NodeID: subscription.ID})
	}
	for _, connection := range renderer.model.Connections {
		if connection.RelationshipType != "aws.sqs.triggers-lambda" {
			continue
		}
		if !renderer.validateEventConnectionConfiguration(connection, "aws.sqs.lambda-consumer.connection", []string{"batchSize", "batchingWindowSeconds", "deliverySemantics", "maximumConcurrency", "partialBatchResponse"}) {
			continue
		}
		properties := map[string]any{
			"BatchSize": renderer.connectionInt(connection, "batchSize"), "Enabled": true, "EventSourceArn": renderer.resourceAttribute(connection.Source.NodeID, "arn"),
			"FunctionName":                   renderer.resourceAttribute(connection.Target.NodeID, "arn"),
			"MaximumBatchingWindowInSeconds": renderer.connectionInt(connection, "batchingWindowSeconds"), "ScalingConfig": map[string]any{"MaximumConcurrency": renderer.connectionInt(connection, "maximumConcurrency")},
		}
		if renderer.connectionBool(connection, "partialBatchResponse") {
			properties["FunctionResponseTypes"] = []any{"ReportBatchItemFailures"}
		}
		logicalID := renderer.derivedLogicalID(connection.Source.TargetKey + " " + connection.ID + " event source")
		renderer.addResource(logicalID, cloudFormationResource{Type: "AWS::Lambda::EventSourceMapping", Properties: properties, Metadata: map[string]any{"CloudMarkup": map[string]any{
			"GraphEdgeId": connection.ID, "PartialBatchResponse": renderer.connectionBool(connection, "partialBatchResponse"),
		}}}, SourceReference{Document: DocumentArchitecture, EdgeID: connection.ID})
	}
}

func (renderer *cloudFormationRenderer) renderLambdaDeadLetterConfiguration(properties map[string]any, resource NormalizedResource) {
	if !renderer.isCurrentCatalog() {
		return
	}
	if queue, _, ok := renderer.connectedWithEdge(resource.ID, "aws.lambda.uses-sqs-dead-letter-queue", false); ok {
		properties["DeadLetterConfig"] = map[string]any{"TargetArn": renderer.resourceAttribute(queue.ID, "arn")}
	}
}

func (renderer *cloudFormationRenderer) renderResourcePolicies(documents []terraformPolicyDocument) {
	for _, document := range documents {
		if document.Kind != "resource" || document.Owner.ServiceType == serviceGatewayVPCEndpoint {
			continue
		}
		metadata := renderer.resourceMetadata(document.Resource)
		switch document.Owner.ServiceType {
		case "aws.s3.bucket":
			policy := cloudFormationResource{Type: "AWS::S3::BucketPolicy", Properties: map[string]any{"Bucket": renderer.resourceAttribute(document.Owner.ID, "id"), "PolicyDocument": renderer.policyDocument(document)}, Metadata: metadata}
			if isCurrentAwsCatalog(renderer.model.Provenance.Catalog) && cloudfrontGeneratedPolicy(document) {
				policy.DeletionPolicy = "Retain"
				policy.UpdateReplacePolicy = "Retain"
			}
			renderer.addResource(renderer.logicalIDs[document.Resource.ID], policy, SourceReference{Document: DocumentArchitecture, NodeID: document.Resource.ID})
		case "aws.sqs.queue":
			renderer.addResource(renderer.logicalIDs[document.Resource.ID], cloudFormationResource{Type: "AWS::SQS::QueuePolicy", Properties: map[string]any{"PolicyDocument": renderer.policyDocument(document), "Queues": []any{renderer.resourceAttribute(document.Owner.ID, "url")}}, Metadata: metadata}, SourceReference{Document: DocumentArchitecture, NodeID: document.Resource.ID})
		case "aws.sns.topic":
			renderer.addResource(renderer.logicalIDs[document.Resource.ID], cloudFormationResource{Type: "AWS::SNS::TopicPolicy", Properties: map[string]any{"PolicyDocument": renderer.policyDocument(document), "Topics": []any{renderer.resourceAttribute(document.Owner.ID, "arn")}}, Metadata: metadata}, SourceReference{Document: DocumentArchitecture, NodeID: document.Resource.ID})
		case "aws.eventbridge.event-bus":
			for _, statement := range document.Statements {
				logicalID := renderer.logicalIDs[document.Resource.ID]
				if len(document.Statements) > 1 {
					logicalID = renderer.derivedLogicalID(document.Resource.DeploymentKey + " statement " + statement.StatementID)
				}
				renderer.addResource(logicalID, cloudFormationResource{Type: "AWS::Events::EventBusPolicy", Properties: map[string]any{
					"Action": statement.Actions[0], "EventBusName": renderer.resourceAttribute(document.Owner.ID, "name"), "Principal": statement.Principals[0], "StatementId": statementID(statement.StatementID),
				}, Metadata: metadata}, SourceReference{Document: DocumentArchitecture, NodeID: document.Resource.ID})
			}
		}
	}
}
