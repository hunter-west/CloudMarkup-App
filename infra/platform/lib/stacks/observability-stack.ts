import {
  CfnOutput,
  Duration,
  Fn,
  RemovalPolicy,
  Stack,
  type StackProps,
  aws_budgets as budgets,
  aws_ce as ce,
  aws_cloudwatch as cloudwatch,
  aws_cloudwatch_actions as cloudwatchActions,
  aws_iam as iam,
  aws_kms as kms,
  aws_logs as logs,
  aws_sns as sns,
} from "aws-cdk-lib";
import type { Construct } from "constructs";

import type { EnvironmentConfig } from "../config/environment-config.js";
import type { PlatformResourceNames } from "../platform-names.js";

export interface ObservabilityStackProps extends StackProps {
  readonly config: EnvironmentConfig;
  readonly names: PlatformResourceNames;
}

function logRetention(days: number): logs.RetentionDays {
  const values: Readonly<Record<number, logs.RetentionDays>> = {
    1: logs.RetentionDays.ONE_DAY,
    3: logs.RetentionDays.THREE_DAYS,
    5: logs.RetentionDays.FIVE_DAYS,
    7: logs.RetentionDays.ONE_WEEK,
    14: logs.RetentionDays.TWO_WEEKS,
    30: logs.RetentionDays.ONE_MONTH,
    60: logs.RetentionDays.TWO_MONTHS,
    90: logs.RetentionDays.THREE_MONTHS,
    120: logs.RetentionDays.FOUR_MONTHS,
    150: logs.RetentionDays.FIVE_MONTHS,
    180: logs.RetentionDays.SIX_MONTHS,
    365: logs.RetentionDays.ONE_YEAR,
    400: logs.RetentionDays.THIRTEEN_MONTHS,
    545: logs.RetentionDays.EIGHTEEN_MONTHS,
    731: logs.RetentionDays.TWO_YEARS,
    1096: logs.RetentionDays.THREE_YEARS,
    1827: logs.RetentionDays.FIVE_YEARS,
    2192: logs.RetentionDays.SIX_YEARS,
    2557: logs.RetentionDays.SEVEN_YEARS,
    2922: logs.RetentionDays.EIGHT_YEARS,
    3288: logs.RetentionDays.NINE_YEARS,
    3653: logs.RetentionDays.TEN_YEARS,
  };
  const retention = values[days];
  if (retention === undefined) {
    throw new TypeError(
      `Unsupported CloudWatch log retention: ${String(days)}`,
    );
  }
  return retention;
}

function namedMetric(
  namespace: string,
  metricName: string,
  dimensionsMap: Readonly<Record<string, string>>,
  statistic = "Sum",
): cloudwatch.Metric {
  return new cloudwatch.Metric({
    dimensionsMap,
    metricName,
    namespace,
    period: Duration.minutes(5),
    statistic,
  });
}
function configuredEdgeWafMetricName(
  config: EnvironmentConfig,
  names: PlatformResourceNames,
): string | undefined {
  if (!config.features.waf) return undefined;
  const externalArn = config.domain?.wafWebAclArn;
  if (externalArn === undefined) return `${names.prefix}-edge-rate-controls`;
  const metricName = config.domain?.wafWebAclMetricName;
  if (metricName === undefined) {
    throw new TypeError(
      "Configured external Web ACL must include its CloudWatch metric name.",
    );
  }
  return metricName;
}

function safeEventMetric(
  scope: Construct,
  id: string,
  logGroup: logs.ILogGroup,
  namespace: string,
  eventName: string,
  metricName: string,
): cloudwatch.Metric {
  return new logs.MetricFilter(scope, id, {
    filterPattern: logs.FilterPattern.stringValue("$.event", "=", eventName),
    logGroup,
    metricName,
    metricNamespace: namespace,
    metricValue: "1",
  }).metric({ period: Duration.minutes(5) });
}

function summedMetric(
  label: string,
  metrics: readonly cloudwatch.IMetric[],
): cloudwatch.MathExpression {
  const entries = metrics.map(
    (metric, index) => [`m${String(index + 1)}`, metric] as const,
  );
  return new cloudwatch.MathExpression({
    expression: entries.map(([name]) => name).join(" + "),
    label,
    period: Duration.minutes(5),
    usingMetrics: Object.fromEntries(entries),
  });
}

const kmsKeyAdministratorActions = [
  "kms:CancelKeyDeletion",
  "kms:CreateAlias",
  "kms:CreateGrant",
  "kms:DeleteAlias",
  "kms:DescribeKey",
  "kms:DisableKey",
  "kms:DisableKeyRotation",
  "kms:EnableKey",
  "kms:EnableKeyRotation",
  "kms:GetKeyPolicy",
  "kms:GetKeyRotationStatus",
  "kms:ListAliases",
  "kms:ListGrants",
  "kms:ListKeyPolicies",
  "kms:ListResourceTags",
  "kms:PutKeyPolicy",
  "kms:RetireGrant",
  "kms:RevokeGrant",
  "kms:ScheduleKeyDeletion",
  "kms:TagResource",
  "kms:UntagResource",
  "kms:UpdateAlias",
  "kms:UpdateKeyDescription",
] as const;
const kmsServicePublisherActions = [
  "kms:Decrypt",
  "kms:GenerateDataKey",
  "kms:GenerateDataKeyWithoutPlaintext",
] as const;

/**
 * Stable logs, alarms, metrics, and notification interfaces. Metrics use the
 * same deterministic physical names as the application resources so this
 * stack never needs a reverse reference to the Application stack.
 */
export class ObservabilityStack extends Stack {
  public readonly alarmTopic: sns.ITopic;
  public readonly apiAccessLogGroup: logs.LogGroup;
  public readonly apiFunctionLogGroup: logs.LogGroup;
  public readonly applicationBuildLogGroup: logs.LogGroup;
  public readonly billingWebhookLogGroup: logs.LogGroup;
  public readonly billingWorkerLogGroup?: logs.LogGroup;
  public readonly solutionExportWorkerLogGroup?: logs.LogGroup;
  public readonly projectCleanupLogGroup?: logs.LogGroup;
  public readonly databaseMigratorLogGroup: logs.LogGroup;
  public readonly jobStateMachineLogGroup: logs.LogGroup;
  public readonly jobWorkerLogGroup: logs.LogGroup;
  public readonly terraformValidationLogGroup: logs.LogGroup;

  public constructor(
    scope: Construct,
    id: string,
    props: ObservabilityStackProps,
  ) {
    super(scope, id, props);

    const removalPolicy =
      props.config.lifecycle.removalPolicy === "retain"
        ? RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE
        : RemovalPolicy.DESTROY;
    const applicationRetention = logRetention(props.config.retention.logsDays);
    const accessRetention = logRetention(props.config.retention.accessLogsDays);
    const createLogGroup = (
      id: string,
      logGroupName: string,
      retention = applicationRetention,
    ) =>
      new logs.LogGroup(this, id, { logGroupName, removalPolicy, retention });
    if (props.config.environment === "beta") {
      this.projectCleanupLogGroup = createLogGroup(
        "ProjectCleanupLogs",
        "/aws/lambda/cloudmarkup-beta-project-content-cleanup",
      );
    }

    if (props.config.integrations.solutionExport?.enabled === true) {
      this.solutionExportWorkerLogGroup = createLogGroup(
        "SolutionExportWorkerLogs",
        "/aws/lambda/cloudmarkup-beta-solution-export-worker",
      );
    }

    this.apiAccessLogGroup = createLogGroup(
      "ApiAccessLogs",
      props.names.apiAccessLogGroup,
      accessRetention,
    );
    this.applicationBuildLogGroup = createLogGroup(
      "ApplicationBuildLogs",
      props.names.applicationBuildLogGroup,
    );
    this.apiFunctionLogGroup = createLogGroup(
      "ApiFunctionLogs",
      props.names.apiFunctionLogGroup,
    );
    this.databaseMigratorLogGroup = createLogGroup(
      "DatabaseMigratorLogs",
      props.names.databaseMigratorLogGroup,
    );
    this.billingWebhookLogGroup = createLogGroup(
      "BillingWebhookLogs",
      props.names.billingWebhookLogGroup,
    );
    if (props.config.integrations.stripe.deliveryEnabled) {
      this.billingWorkerLogGroup = createLogGroup(
        "BillingWorkerLogs",
        `/aws/lambda/${props.names.prefix}-billing-worker`,
      );
    }
    this.jobWorkerLogGroup = createLogGroup(
      "JobWorkerLogs",
      props.names.jobWorkerLogGroup,
    );
    this.jobStateMachineLogGroup = createLogGroup(
      "JobStateMachineLogs",
      props.names.jobStateMachineLogGroup,
    );
    this.terraformValidationLogGroup = createLogGroup(
      "TerraformValidationLogs",
      props.names.terraformValidationLogGroup,
    );
    const databaseLogGroupName = `/aws/rds/cluster/${props.names.databaseCluster}/postgresql`;
    createLogGroup("DatabaseLogs", databaseLogGroupName);

    const cloudWatchAlarmSourceArn = `arn:${this.partition}:cloudwatch:${this.region}:${this.account}:alarm:*`;
    const budgetSourceArn = `arn:${this.partition}:budgets::${this.account}:*`;
    const costAnomalySourceArn = `arn:${this.partition}:ce::${this.account}:anomalysubscription/*`;
    const publisherConditions = (sourceArn: string) => ({
      ArnLike: { "aws:SourceArn": sourceArn },
      StringEquals: { "aws:SourceAccount": this.account },
    });
    if (props.config.environment === "beta") {
      this.alarmTopic = sns.Topic.fromTopicArn(
        this,
        "BetaAlarmNotifications",
        Fn.importValue("cloudmarkup-beta-bootstrap:AlarmTopicArn"),
      );
    } else {
      const alarmNotificationKey = new kms.Key(this, "AlarmNotificationKey", {
        alias: `alias/${props.names.prefix}-alarm-notifications`,
        description:
          "CloudMarkup alarm notifications published only by reviewed AWS control services",
        enableKeyRotation: true,
        policy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              actions: [...kmsKeyAdministratorActions],
              principals: [new iam.AccountRootPrincipal()],
              resources: ["*"],
              sid: "AllowAccountKeyAdministration",
            }),
            new iam.PolicyStatement({
              actions: [...kmsServicePublisherActions],
              conditions: publisherConditions(cloudWatchAlarmSourceArn),
              principals: [
                new iam.ServicePrincipal("cloudwatch.amazonaws.com"),
              ],
              resources: ["*"],
              sid: "AllowCloudWatchAlarmEncryption",
            }),
            new iam.PolicyStatement({
              actions: [...kmsServicePublisherActions],
              conditions: publisherConditions(budgetSourceArn),
              principals: [new iam.ServicePrincipal("budgets.amazonaws.com")],
              resources: ["*"],
              sid: "AllowBudgetNotificationEncryption",
            }),
            new iam.PolicyStatement({
              actions: [...kmsServicePublisherActions],
              conditions: publisherConditions(costAnomalySourceArn),
              principals: [
                new iam.ServicePrincipal("costalerts.amazonaws.com"),
              ],
              resources: ["*"],
              sid: "AllowCostAnomalyNotificationEncryption",
            }),
          ],
        }),
        removalPolicy,
      });

      this.alarmTopic = new sns.Topic(this, "AlarmNotifications", {
        displayName: `CloudMarkup ${props.config.environment} alarms`,
        masterKey: alarmNotificationKey,
        topicName: props.names.alarmTopic,
      });
      this.alarmTopic.applyRemovalPolicy(removalPolicy);
      for (const [service, sourceArn, sid] of [
        [
          "cloudwatch.amazonaws.com",
          cloudWatchAlarmSourceArn,
          "AllowCloudWatchAlarmPublish",
        ],
        [
          "budgets.amazonaws.com",
          budgetSourceArn,
          "AllowBudgetNotificationPublish",
        ],
        [
          "costalerts.amazonaws.com",
          costAnomalySourceArn,
          "AllowCostAnomalyNotificationPublish",
        ],
      ] as const) {
        this.alarmTopic.addToResourcePolicy(
          new iam.PolicyStatement({
            actions: ["sns:Publish"],
            conditions: publisherConditions(sourceArn),
            principals: [new iam.ServicePrincipal(service)],
            resources: [this.alarmTopic.topicArn],
            sid,
          }),
        );
      }
    }

    const customNamespace = `CloudMarkup/${props.config.environment}`;
    const api5xxFilter = new logs.MetricFilter(this, "Api5xxMetric", {
      filterPattern: logs.FilterPattern.literal("{ $.status >= 500 }"),
      logGroup: this.apiAccessLogGroup,
      metricName: "Api5xx",
      metricNamespace: customNamespace,
      metricValue: "1",
    });
    const apiThrottledFilter = new logs.MetricFilter(
      this,
      "ApiThrottledMetric",
      {
        filterPattern: logs.FilterPattern.literal("{ $.status = 429 }"),
        logGroup: this.apiAccessLogGroup,
        metricName: "ApiThrottledResponses",
        metricNamespace: customNamespace,
        metricValue: "1",
      },
    );

    const billingRoute5xxFilter = new logs.MetricFilter(
      this,
      "BillingWebhook5xxMetric",
      {
        filterPattern: logs.FilterPattern.literal(
          '{ $.routeKey = "POST /webhooks/stripe" && $.status >= 500 }',
        ),
        logGroup: this.apiAccessLogGroup,
        metricName: "BillingWebhook5xx",
        metricNamespace: customNamespace,
        metricValue: "1",
      },
    );
    const billingSignatureFailureFilter = new logs.MetricFilter(
      this,
      "BillingWebhookSignatureFailureMetric",
      {
        filterPattern: logs.FilterPattern.literal(
          '{ $.component = "billing-webhook" && $.outcome = "signature-failure" }',
        ),
        logGroup: this.billingWebhookLogGroup,
        metricName: "BillingWebhookSignatureFailures",
        metricNamespace: customNamespace,
        metricValue: "1",
      },
    );
    const billingProcessingFailureFilter = new logs.MetricFilter(
      this,
      "BillingWebhookProcessingFailureMetric",
      {
        filterPattern: logs.FilterPattern.literal(
          '{ $.component = "billing-webhook" && $.outcome = "processing-failure" }',
        ),
        logGroup: this.billingWebhookLogGroup,
        metricName: "BillingWebhookProcessingFailures",
        metricNamespace: customNamespace,
        metricValue: "1",
      },
    );
    const staleBillingProjectionFilter = new logs.MetricFilter(
      this,
      "StaleBillingProjectionMetric",
      {
        filterPattern: logs.FilterPattern.literal(
          '{ $.component = "billing-reconciliation" && $.outcome = "stale-projection" }',
        ),
        logGroup: this.billingWebhookLogGroup,
        metricName: "StaleBillingProjections",
        metricNamespace: customNamespace,
        metricValue: "1",
      },
    );
    const artifactFailureFilter = new logs.MetricFilter(
      this,
      "ArtifactFailureMetric",
      {
        filterPattern: logs.FilterPattern.stringValue(
          "$.event",
          "=",
          "artifact.write.failed",
        ),
        logGroup: this.jobWorkerLogGroup,
        metricName: "ArtifactWriteFailures",
        metricNamespace: customNamespace,
        metricValue: "1",
      },
    );
    const evidenceFailureFilter = new logs.MetricFilter(
      this,
      "EvidenceFailureMetric",
      {
        filterPattern: logs.FilterPattern.stringValue(
          "$.event",
          "=",
          "evidence.write.failed",
        ),
        logGroup: this.jobWorkerLogGroup,
        metricName: "EvidenceWriteFailures",
        metricNamespace: customNamespace,
        metricValue: "1",
      },
    );

    const safeSignalDefinitions = [
      [
        "authorizationDenials",
        "AuthorizationDeniedMetric",
        this.apiFunctionLogGroup,
        "security.authorization.denied",
        "AuthorizationDenials",
      ],
      [
        "abuseBlocks",
        "AbuseBlockedMetric",
        this.apiFunctionLogGroup,
        "security.abuse.blocked",
        "AbuseBlocks",
      ],
      [
        "originDenials",
        "OriginDeniedMetric",
        this.apiFunctionLogGroup,
        "security.origin.denied",
        "OriginVerificationDenials",
      ],
      [
        "modelFailures",
        "ModelFailedMetric",
        this.jobWorkerLogGroup,
        "model.invocation.failed",
        "ModelInvocationFailures",
      ],
      [
        "modelCreditDenials",
        "ModelCreditDeniedMetric",
        this.jobWorkerLogGroup,
        "model.credit.denied",
        "ModelCreditDenials",
      ],
      [
        "ledgerFailures",
        "LedgerReconciliationFailedMetric",
        this.jobWorkerLogGroup,
        "ledger.reconciliation.failed",
        "LedgerReconciliationFailures",
      ],
      [
        "compilerFailures",
        "CompilerFailedMetric",
        this.jobWorkerLogGroup,
        "compiler.operation.failed",
        "CompilerFailures",
      ],
      [
        "generatorFailures",
        "GeneratorFailedMetric",
        this.jobWorkerLogGroup,
        "generator.operation.failed",
        "GeneratorFailures",
      ],
      [
        "diagramFailures",
        "DiagramExportFailedMetric",
        this.jobWorkerLogGroup,
        "diagram.export.failed",
        "DiagramExportFailures",
      ],
      [
        "zipFailures",
        "ZipExportFailedMetric",
        this.jobWorkerLogGroup,
        "zip.export.failed",
        "ZipExportFailures",
      ],
      [
        "githubFailures",
        "GitHubExportFailedMetric",
        this.jobWorkerLogGroup,
        "github.export.failed",
        "GitHubExportFailures",
      ],
      [
        "workflowFailures",
        "WorkflowGenerationFailedMetric",
        this.jobWorkerLogGroup,
        "workflow.generation.failed",
        "WorkflowGenerationFailures",
      ],
      [
        "planEvidenceFailures",
        "PlanEvidenceFailedMetric",
        this.jobWorkerLogGroup,
        "plan.evidence.failed",
        "PlanEvidenceFailures",
      ],
      [
        "deploymentEvidenceFailures",
        "DeploymentEvidenceFailedMetric",
        this.jobWorkerLogGroup,
        "deployment.evidence.failed",
        "DeploymentEvidenceFailures",
      ],
      [
        "driftEvidenceFailures",
        "DriftEvidenceFailedMetric",
        this.jobWorkerLogGroup,
        "drift.evidence.failed",
        "DriftEvidenceFailures",
      ],
      [
        "evidenceProcessingFailures",
        "EvidenceProcessingFailedMetric",
        this.jobWorkerLogGroup,
        "evidence.processing.failed",
        "EvidenceProcessingFailures",
      ],
      [
        "supportDenials",
        "SupportDeniedMetric",
        this.apiFunctionLogGroup,
        "support.operation.denied",
        "SupportOperationDenials",
      ],
      [
        "retentionFailures",
        "RetentionFailedMetric",
        this.jobWorkerLogGroup,
        "retention.operation.failed",
        "RetentionFailures",
      ],
      [
        "modelUsage",
        "ModelUsageMetric",
        this.jobWorkerLogGroup,
        "model.usage.recorded",
        "ModelUsageRecords",
      ],
      [
        "supportOperations",
        "SupportOperationMetric",
        this.apiFunctionLogGroup,
        "support.operation.completed",
        "SupportOperations",
      ],
    ] as const;
    const safeSignals = new Map(
      safeSignalDefinitions.map(
        ([key, id, logGroup, eventName, metricName]) => [
          key,
          safeEventMetric(
            this,
            id,
            logGroup,
            customNamespace,
            eventName,
            metricName,
          ),
        ],
      ),
    );
    safeEventMetric(
      this,
      "BillingOriginDeniedMetric",
      this.billingWebhookLogGroup,
      customNamespace,
      "security.origin.denied",
      "OriginVerificationDenials",
    );
    const safeSignal = (
      name: (typeof safeSignalDefinitions)[number][0],
    ): cloudwatch.Metric => {
      const metric = safeSignals.get(name);
      if (metric === undefined) {
        throw new TypeError(`Missing safe operational metric: ${name}`);
      }
      return metric;
    };
    const edgeWafMetricName = configuredEdgeWafMetricName(
      props.config,
      props.names,
    );
    const wafBlockedRequests =
      edgeWafMetricName === undefined
        ? undefined
        : namedMetric("AWS/WAFV2", "BlockedRequests", {
            Region: "Global",
            Rule: "ALL",
            WebACL: edgeWafMetricName,
          });
    const regionalOriginBlockedRequests = props.config.features.waf
      ? namedMetric("AWS/WAFV2", "BlockedRequests", {
          Region: this.region,
          Rule: "RequireCloudFrontOriginMarker",
          WebACL: `${props.names.prefix}-regional-origin-access`,
        })
      : undefined;
    const metrics = {
      api5xx: api5xxFilter.metric({ period: Duration.minutes(5) }),
      apiLambdaErrors: namedMetric("AWS/Lambda", "Errors", {
        FunctionName: props.names.apiFunction,
      }),
      apiLambdaThrottles: namedMetric("AWS/Lambda", "Throttles", {
        FunctionName: props.names.apiFunction,
      }),
      apiThrottledResponses: apiThrottledFilter.metric({
        period: Duration.minutes(5),
      }),
      artifactFailures: artifactFailureFilter.metric({
        period: Duration.minutes(5),
      }),
      billingErrors: namedMetric("AWS/Lambda", "Errors", {
        FunctionName: props.names.billingWebhookFunction,
      }),
      billingRoute5xx: billingRoute5xxFilter.metric({
        period: Duration.minutes(5),
      }),
      billingSignatureFailures: billingSignatureFailureFilter.metric({
        period: Duration.minutes(5),
      }),
      billingProcessingFailures: billingProcessingFailureFilter.metric({
        period: Duration.minutes(5),
      }),
      billingQueueAge: namedMetric(
        "AWS/SQS",
        "ApproximateAgeOfOldestMessage",
        { QueueName: `${props.names.prefix}-billing-webhook.fifo` },
        "Maximum",
      ),
      billingQueueBacklog: namedMetric(
        "AWS/SQS",
        "ApproximateNumberOfMessagesVisible",
        { QueueName: `${props.names.prefix}-billing-webhook.fifo` },
        "Maximum",
      ),
      billingDeadLetters: namedMetric(
        "AWS/SQS",
        "ApproximateNumberOfMessagesVisible",
        { QueueName: `${props.names.prefix}-billing-webhook-dlq.fifo` },
        "Maximum",
      ),
      staleBillingProjections: staleBillingProjectionFilter.metric({
        period: Duration.minutes(5),
      }),
      deadLetters: namedMetric(
        "AWS/SQS",
        "ApproximateNumberOfMessagesVisible",
        { QueueName: props.names.deadLetterQueue },
        "Maximum",
      ),
      evidenceFailures: evidenceFailureFilter.metric({
        period: Duration.minutes(5),
      }),
      jobFailures: namedMetric("AWS/States", "ExecutionsFailed", {
        StateMachineArn: `arn:${this.partition}:states:${this.region}:${this.account}:stateMachine:${props.names.jobStateMachine}`,
      }),
      jobWorkerErrors: namedMetric("AWS/Lambda", "Errors", {
        FunctionName: props.names.jobWorkerFunction,
      }),
      queueAge: namedMetric(
        "AWS/SQS",
        "ApproximateAgeOfOldestMessage",
        { QueueName: props.names.jobQueue },
        "Maximum",
      ),
      queueDepth: namedMetric(
        "AWS/SQS",
        "ApproximateNumberOfMessagesVisible",
        { QueueName: props.names.jobQueue },
        "Maximum",
      ),
      applicationBuildFailures: namedMetric("AWS/CodeBuild", "FailedBuilds", {
        ProjectName: props.names.applicationBuildProject,
      }),
      terraformValidationFailures: namedMetric(
        "AWS/CodeBuild",
        "FailedBuilds",
        { ProjectName: props.names.terraformValidationProject },
      ),
      authorizationDenials: safeSignal("authorizationDenials"),
      abuseBlocks: safeSignal("abuseBlocks"),
      originDenials: safeSignal("originDenials"),
      modelFailures: safeSignal("modelFailures"),
      modelCreditDenials: safeSignal("modelCreditDenials"),
      ledgerFailures: safeSignal("ledgerFailures"),
      compilerFailures: safeSignal("compilerFailures"),
      generatorFailures: safeSignal("generatorFailures"),
      diagramFailures: safeSignal("diagramFailures"),
      zipFailures: safeSignal("zipFailures"),
      githubFailures: safeSignal("githubFailures"),
      workflowFailures: safeSignal("workflowFailures"),
      planEvidenceFailures: safeSignal("planEvidenceFailures"),
      deploymentEvidenceFailures: safeSignal("deploymentEvidenceFailures"),
      driftEvidenceFailures: safeSignal("driftEvidenceFailures"),
      evidenceProcessingFailures: safeSignal("evidenceProcessingFailures"),
      supportDenials: safeSignal("supportDenials"),
      retentionFailures: safeSignal("retentionFailures"),
      modelUsage: safeSignal("modelUsage"),
      supportOperations: safeSignal("supportOperations"),
      regionalOriginBlockedRequests,
      wafBlockedRequests,
    } as const;
    const controlMetrics = {
      commercialFailures: summedMetric("Commercial control failures", [
        metrics.modelFailures,
        metrics.modelCreditDenials,
        metrics.ledgerFailures,
      ]),
      evidenceFailures: summedMetric("Evidence control failures", [
        metrics.planEvidenceFailures,
        metrics.deploymentEvidenceFailures,
        metrics.driftEvidenceFailures,
        metrics.evidenceProcessingFailures,
        metrics.retentionFailures,
      ]),
      generationFailures: summedMetric("Generation control failures", [
        metrics.compilerFailures,
        metrics.generatorFailures,
        metrics.applicationBuildFailures,
        metrics.terraformValidationFailures,
        metrics.diagramFailures,
        metrics.zipFailures,
        metrics.githubFailures,
        metrics.workflowFailures,
      ]),
      securityDenials: summedMetric("Security denials and throttles", [
        metrics.authorizationDenials,
        metrics.abuseBlocks,
        metrics.originDenials,
        metrics.apiLambdaThrottles,
        metrics.apiThrottledResponses,
        ...(metrics.regionalOriginBlockedRequests === undefined
          ? []
          : [metrics.regionalOriginBlockedRequests]),
        ...(metrics.wafBlockedRequests === undefined
          ? []
          : [metrics.wafBlockedRequests]),
      ]),
    } as const;

    const billingWorkerRetryMetric =
      this.billingWorkerLogGroup === undefined
        ? undefined
        : new logs.MetricFilter(this, "BillingWorkerRetryMetric", {
            logGroup: this.billingWorkerLogGroup,
            filterPattern: logs.FilterPattern.literal(
              '{ $.component = "billing-worker" && $.outcome = "batch-retry" }',
            ),
            metricNamespace: "CloudMarkup/BetaBilling",
            metricName: "DeliveryBatchRetries",
            metricValue: "1",
          }).metric({ statistic: "Sum" });
    const alarms = [
      ...(props.config.integrations.solutionExport?.enabled === true
        ? [
            this.alarm(
              "SolutionExportWorkerErrorAlarm",
              namedMetric("AWS/Lambda", "Errors", {
                FunctionName: "cloudmarkup-beta-solution-export-worker",
              }),
              1,
              "cloudmarkup-beta-solution-export-worker-errors",
            ),
            this.alarm(
              "SolutionExportDeadLetterAlarm",
              namedMetric(
                "AWS/SQS",
                "ApproximateNumberOfMessagesVisible",
                { QueueName: "cloudmarkup-beta-solution-exports-dlq.fifo" },
                "Maximum",
              ),
              1,
              "cloudmarkup-beta-solution-export-dead-letters",
            ),
            this.alarm(
              "SolutionExportQueueAgeAlarm",
              namedMetric(
                "AWS/SQS",
                "ApproximateAgeOfOldestMessage",
                { QueueName: "cloudmarkup-beta-solution-exports.fifo" },
                "Maximum",
              ),
              1800,
              "cloudmarkup-beta-solution-export-queue-age",
            ),
          ]
        : []),
      ...(billingWorkerRetryMetric === undefined
        ? []
        : [this.alarm("BillingWorkerRetryAlarm", billingWorkerRetryMetric, 1)]),
      ...(props.config.integrations.stripe.deliveryEnabled
        ? [
            this.alarm(
              "BillingWorkerErrorAlarm",
              namedMetric("AWS/Lambda", "Errors", {
                FunctionName: `${props.names.prefix}-billing-worker`,
              }),
              1,
            ),
            this.alarm(
              "BillingWorkerThrottleAlarm",
              namedMetric("AWS/Lambda", "Throttles", {
                FunctionName: `${props.names.prefix}-billing-worker`,
              }),
              1,
            ),
          ]
        : []),
      this.alarm("Api5xxAlarm", metrics.api5xx, 1),
      this.alarm("ApiLambdaErrorAlarm", metrics.apiLambdaErrors, 1),
      this.alarm("BillingWebhookErrorAlarm", metrics.billingErrors, 1),
      this.alarm("BillingWebhook5xxAlarm", metrics.billingRoute5xx, 1),
      this.alarm(
        "BillingWebhookSignatureFailureAlarm",
        metrics.billingSignatureFailures,
        1,
      ),
      this.alarm(
        "BillingWebhookProcessingFailureAlarm",
        metrics.billingProcessingFailures,
        1,
      ),
      this.alarm("BillingWebhookBacklogAlarm", metrics.billingQueueBacklog, 10),
      this.alarm("BillingWebhookQueueAgeAlarm", metrics.billingQueueAge, 300),
      this.alarm(
        "BillingWebhookDeadLetterAlarm",
        metrics.billingDeadLetters,
        1,
      ),
      this.alarm(
        "StaleBillingProjectionAlarm",
        metrics.staleBillingProjections,
        1,
      ),
      this.alarm("JobWorkerErrorAlarm", metrics.jobWorkerErrors, 1),
      this.alarm("JobDispatchFailureAlarm", metrics.jobFailures, 1),
      this.alarm("JobQueueAgeAlarm", metrics.queueAge, 300),
      this.alarm("JobQueueDepthAlarm", metrics.queueDepth, 10),
      this.alarm("DeadLetterQueueAlarm", metrics.deadLetters, 1),
      this.alarm("ArtifactWriteFailureAlarm", metrics.artifactFailures, 1),
      this.alarm("EvidenceWriteFailureAlarm", metrics.evidenceFailures, 1),
      this.alarm(
        "CommercialControlFailureAlarm",
        controlMetrics.commercialFailures,
        1,
      ),
      this.alarm(
        "EvidenceControlFailureAlarm",
        controlMetrics.evidenceFailures,
        1,
      ),
      this.alarm(
        "GenerationControlFailureAlarm",
        controlMetrics.generationFailures,
        1,
      ),
      this.alarm(
        "SecurityControlDenialAlarm",
        controlMetrics.securityDenials,
        5,
      ),
      this.alarm("SupportOperationDenialAlarm", metrics.supportDenials, 1),
    ];
    if (metrics.wafBlockedRequests !== undefined) {
      alarms.push(
        this.alarm("WafBlockedRequestAlarm", metrics.wafBlockedRequests, 1),
      );
    }
    if (metrics.regionalOriginBlockedRequests !== undefined) {
      alarms.push(
        this.alarm(
          "RegionalOriginBlockedRequestAlarm",
          metrics.regionalOriginBlockedRequests,
          1,
        ),
      );
    }
    const alarmAction = new cloudwatchActions.SnsAction(this.alarmTopic);
    alarms.forEach((alarm) => {
      alarm.addAlarmAction(alarmAction);
    });

    const dashboard = new cloudwatch.Dashboard(this, "OperationsDashboard", {
      dashboardName: `${props.names.prefix}-operations`,
    });
    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        left: [
          metrics.api5xx,
          metrics.apiLambdaErrors,
          metrics.billingErrors,
          metrics.billingRoute5xx,
          metrics.billingSignatureFailures,
          metrics.billingProcessingFailures,
          metrics.staleBillingProjections,
        ],
        title: "API and billing failures",
      }),
      new cloudwatch.GraphWidget({
        left: [
          metrics.billingQueueBacklog,
          metrics.billingQueueAge,
          metrics.billingDeadLetters,
        ],
        title: "Billing webhook delivery health",
      }),
      new cloudwatch.GraphWidget({
        left: [metrics.queueDepth, metrics.queueAge, metrics.deadLetters],
        title: "Job queue health",
      }),
      new cloudwatch.GraphWidget({
        left: [
          metrics.jobWorkerErrors,
          metrics.jobFailures,
          metrics.artifactFailures,
          metrics.evidenceFailures,
        ],
        title: "Jobs, artifacts, and evidence",
      }),
      new cloudwatch.GraphWidget({
        left: [
          metrics.apiLambdaThrottles,
          metrics.apiThrottledResponses,
          metrics.authorizationDenials,
          metrics.abuseBlocks,
          metrics.originDenials,
          ...(metrics.regionalOriginBlockedRequests === undefined
            ? []
            : [metrics.regionalOriginBlockedRequests]),
          ...(metrics.wafBlockedRequests === undefined
            ? []
            : [metrics.wafBlockedRequests]),
        ],
        title: "Security denials and throttling",
      }),
      new cloudwatch.GraphWidget({
        left: [
          metrics.modelUsage,
          metrics.modelFailures,
          metrics.modelCreditDenials,
          metrics.ledgerFailures,
          metrics.supportOperations,
          metrics.supportDenials,
        ],
        title: "Model, ledger, and support controls",
      }),
      new cloudwatch.GraphWidget({
        left: [
          metrics.compilerFailures,
          metrics.generatorFailures,
          metrics.applicationBuildFailures,
          metrics.terraformValidationFailures,
          metrics.diagramFailures,
          metrics.zipFailures,
          metrics.githubFailures,
          metrics.workflowFailures,
        ],
        title: "Generation, validation, and export controls",
      }),
      new cloudwatch.GraphWidget({
        left: [
          metrics.planEvidenceFailures,
          metrics.deploymentEvidenceFailures,
          metrics.driftEvidenceFailures,
          metrics.evidenceProcessingFailures,
          metrics.retentionFailures,
        ],
        title: "Evidence and retention controls",
      }),
    );

    if (props.config.environment !== "beta") {
      const costResourceTags = Object.entries(props.config.tags)
        .sort(([left], [right]) => (left === right ? 0 : left < right ? -1 : 1))
        .map(([key, value]) => ({ key, value }));
      const costAnomalyMonitor = new ce.CfnAnomalyMonitor(
        this,
        "ServiceCostAnomalyMonitor",
        {
          monitorDimension: "SERVICE",
          monitorName: `${props.names.prefix}-service-cost-anomalies`,
          monitorType: "DIMENSIONAL",
          resourceTags: costResourceTags,
        },
      );
      new ce.CfnAnomalySubscription(this, "CostAnomalyNotifications", {
        frequency: "IMMEDIATE",
        monitorArnList: [costAnomalyMonitor.attrMonitorArn],
        resourceTags: costResourceTags,
        subscribers: [{ address: this.alarmTopic.topicArn, type: "SNS" }],
        subscriptionName: `${props.names.prefix}-cost-anomaly-notifications`,
        thresholdExpression: JSON.stringify({
          Dimensions: {
            Key: "ANOMALY_TOTAL_IMPACT_ABSOLUTE",
            MatchOptions: ["GREATER_THAN_OR_EQUAL"],
            Values: [String(props.config.budget.anomalyThresholdUsd)],
          },
        }),
      });
    }

    new budgets.CfnBudget(this, "MonthlyCostGuardrail", {
      budget: {
        budgetLimit: {
          amount: props.config.budget.monthlyLimitUsd,
          unit: "USD",
        },
        budgetName: `${props.names.prefix}-monthly-cost`,
        budgetType: "COST",
        timeUnit: "MONTHLY",
      },
      notificationsWithSubscribers: [
        {
          notification: {
            comparisonOperator: "GREATER_THAN",
            notificationType: "ACTUAL",
            threshold: props.config.budget.alarmThresholdPercent,
            thresholdType: "PERCENTAGE",
          },
          subscribers: [
            {
              address: this.alarmTopic.topicArn,
              subscriptionType: "SNS",
            },
          ],
        },
      ],
    });

    new CfnOutput(this, "LogGroupNames", {
      description: "JSON list of platform-owned CloudWatch log-group names.",
      value: JSON.stringify([
        props.names.apiAccessLogGroup,
        props.names.apiFunctionLogGroup,
        props.names.databaseMigratorLogGroup,
        props.names.applicationBuildLogGroup,
        props.names.billingWebhookLogGroup,
        props.names.jobStateMachineLogGroup,
        props.names.jobWorkerLogGroup,
        props.names.terraformValidationLogGroup,
        databaseLogGroupName,
        ...(props.config.integrations.solutionExport?.enabled === true
          ? ["/aws/lambda/cloudmarkup-beta-solution-export-worker"]
          : []),
        ...(props.config.environment === "beta"
          ? ["/aws/lambda/cloudmarkup-beta-project-content-cleanup"]
          : []),
        ...(props.config.integrations.stripe.deliveryEnabled
          ? [`/aws/lambda/${props.names.prefix}-billing-worker`]
          : []),
      ]),
    });
    new CfnOutput(this, "AlarmTopicArn", {
      description: "Encrypted operator alarm topic ARN; not a credential.",
      value: this.alarmTopic.topicArn,
    });
  }

  private alarm(
    id: string,
    metric: cloudwatch.IMetric,
    threshold: number,
    alarmName?: string,
  ): cloudwatch.Alarm {
    return new cloudwatch.Alarm(this, id, {
      ...(alarmName === undefined ? {} : { alarmName }),
      comparisonOperator:
        cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      evaluationPeriods: 1,
      metric,
      threshold,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
  }
}
