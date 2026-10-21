import {
  awsWafServicePresentations,
  extendWafPresentation,
} from "./regional-waf-presentation.js";
import { wafBindings } from "./services/regional-waf.js";
import {
  awsEbsServicePresentations,
  extendEbsPresentation,
} from "./ebs-presentation.js";
import { ebsBindings } from "./services/ebs.js";
import {
  awsElbServicePresentations,
  extendElbPresentation,
} from "./elb-presentation.js";
import { elbBindings } from "./services/elb.js";
import {
  awsCloudfrontServicePresentations,
  extendCloudfrontPresentation,
} from "./cloudfront-presentation.js";
import { cloudfrontBindings } from "./services/cloudfront.js";
import { awsDnsServicePresentations } from "./dns-acm-presentation.js";
import { dnsBindings } from "./services/dns-acm.js";
import {
  awsAuroraServicePresentations,
  extendAuroraPresentation,
} from "./aurora-presentation.js";
import { auroraBindings } from "./services/aurora-postgres.js";
import {
  awsRdsServicePresentations,
  extendRdsPresentation,
} from "./rds-presentation.js";
import { rdsBindings } from "./services/rds-postgres.js";
import {
  awsEcsServicePresentations,
  extendEcsPresentation,
} from "./ecs-presentation.js";
import { ecsBindings } from "./services/ecs-fargate.js";
import {
  awsEc2ServicePresentations,
  extendEc2Presentation,
} from "./ec2-presentation.js";
import { ec2Bindings } from "./connections/ec2-connections.js";
import {
  awsSecretServicePresentation,
  extendSecretPresentation,
} from "./secrets-presentation.js";
import {
  awsKmsServicePresentation,
  extendKmsPresentation,
} from "./kms-presentation.js";
import {
  awsFsxServicePresentations,
  awsFsxRelationshipLabels,
  extendFsxPresentation,
} from "./fsx-presentation.js";
import {
  defineProviderConnectionPresentationSourceV1,
  type ProviderCatalogArtifactV1,
  type ProviderConnectionPresentationSourceV1,
  type ProviderServiceConnectionPresentationV1Input,
} from "@cloudmarkup/provider-sdk";
import {
  awsEventDrivenRelationshipLabelsV1,
  awsEventDrivenServiceConnectionPresentationsV1,
} from "./event-driven-connection-presentation.js";

import {
  awsNetworkingRelationshipLabelsV1,
  awsNetworkingServiceConnectionPresentationsV1,
} from "./networking-connection-presentation.js";

type PresentationDock =
  ProviderServiceConnectionPresentationV1Input["docks"][number];

function dock(definition: PresentationDock): PresentationDock {
  return definition;
}

/**
 * Builds the presentation source against one exact semantic catalog artifact.
 * The returned dock IDs are editor-only and never enter Architecture Documents,
 * Graph Commands, mapping declarations, or compiler input.
 */
export function createAwsConnectionPresentationSourceV1(
  catalog: ProviderCatalogArtifactV1,
): ProviderConnectionPresentationSourceV1 {
  return defineProviderConnectionPresentationSourceV1({
    contractVersion: 1,
    catalog: {
      id: catalog.catalog.id,
      version: catalog.catalog.version,
      digest: catalog.digest,
    },
    services: [
      {
        serviceId: "aws.apigateway.http-api",
        docks: [
          dock({
            id: "aws.apigateway.http-api.dock.triggers",
            category: "triggers",
            label: "Routes",
            description: "Routes that invoke connected workloads.",
            placement: "right",
            order: 0,
            directionPolicy: "output-only",
            portIds: ["aws.apigateway.http-api.invocation"],
            cardinality: {
              minimum: 1,
              maximum: "many",
              enforcement: "provider-rule",
            },
            allowsMultipleEdges: true,
            containsExclusiveRelationships: true,
            guidedExplanation:
              "Connect an API route to the function that should handle it.",
            professionalExplanation:
              "Groups exact API invocation ports; route-key exclusivity remains rule-owned.",
          }),
          dock({
            id: "aws.apigateway.http-api.dock.identity",
            category: "identity",
            label: "Authentication",
            description: "JWT issuer and audience associations.",
            placement: "left",
            order: 0,
            directionPolicy: "input-only",
            portIds: [
              "aws.apigateway.http-api.jwt-audience",
              "aws.apigateway.http-api.jwt-issuer",
            ],
            cardinality: {
              minimum: 1,
              maximum: "many",
              enforcement: "provider-rule",
            },
            allowsMultipleEdges: true,
            containsExclusiveRelationships: true,
            guidedExplanation:
              "Connect the user directory and app client used to check access tokens.",
            professionalExplanation:
              "Groups exact JWT issuer and audience ports; each target port remains exclusive.",
          }),
        ],
      },
      {
        serviceId: "aws.cloudwatch.log-group",
        docks: [
          dock({
            id: "aws.cloudwatch.log-group.dock.observability",
            category: "observability",
            label: "Logs",
            description: "Workloads that send logs to this group.",
            placement: "left",
            order: 0,
            directionPolicy: "input-only",
            portIds: ["aws.cloudwatch.log-group.logs"],
            cardinality: {
              minimum: 1,
              maximum: 1,
              enforcement: "provider-rule",
            },
            allowsMultipleEdges: false,
            containsExclusiveRelationships: true,
            guidedExplanation:
              "Connect the workload whose application logs belong here.",
            professionalExplanation:
              "The current catalog constrains this exact log destination to one source.",
          }),
          dock({
            id: "aws.cloudwatch.log-group.dock.identity",
            category: "identity",
            label: "Permissions",
            description: "Policy statements scoped to this log group.",
            placement: "left",
            order: 1,
            directionPolicy: "input-only",
            portIds: ["aws.cloudwatch.log-group.policy-resource"],
            cardinality: {
              minimum: 0,
              maximum: "many",
              enforcement: "provider-rule",
            },
            allowsMultipleEdges: true,
            containsExclusiveRelationships: false,
            guidedExplanation:
              "Review the permissions that are limited to this log group.",
            professionalExplanation:
              "Shows exact log-group resource-scope edges for canonical policy statements.",
          }),
        ],
      },
      {
        serviceId: "aws.cloudwatch.metric-alarm",
        docks: [
          dock({
            id: "aws.cloudwatch.metric-alarm.dock.observability",
            category: "observability",
            label: "Metric",
            description: "The exact resource metric watched by this alarm.",
            placement: "left",
            order: 0,
            directionPolicy: "input-only",
            portIds: ["aws.cloudwatch.metric-alarm.metric"],
            cardinality: {
              minimum: 1,
              maximum: 1,
              enforcement: "provider-rule",
            },
            allowsMultipleEdges: false,
            containsExclusiveRelationships: true,
            guidedExplanation:
              "Connect the workload whose errors this alarm should watch.",
            professionalExplanation:
              "Binds one exact metric-source relationship to the alarm target port.",
          }),
        ],
      },
      {
        serviceId: "aws.cognito.user-pool",
        docks: [
          dock({
            id: "aws.cognito.user-pool.dock.identity",
            category: "identity",
            label: "Identity",
            description: "App-client ownership and JWT issuer relationships.",
            placement: "right",
            order: 0,
            directionPolicy: "output-only",
            portIds: [
              "aws.cognito.user-pool.app-client-parent",
              "aws.cognito.user-pool.jwt-issuer",
            ],
            cardinality: {
              minimum: 1,
              maximum: "many",
              enforcement: "provider-rule",
            },
            allowsMultipleEdges: true,
            containsExclusiveRelationships: false,
            guidedExplanation:
              "Connect apps and APIs that use this user directory.",
            professionalExplanation:
              "Groups containment and issuer capabilities while retaining their exact ports.",
          }),
        ],
      },
      {
        serviceId: "aws.cognito.user-pool-client",
        docks: [
          dock({
            id: "aws.cognito.user-pool-client.dock.user-pool",
            category: "identity",
            label: "User pool",
            description: "The user pool that owns this app registration.",
            placement: "left",
            order: 0,
            directionPolicy: "input-only",
            portIds: ["aws.cognito.user-pool-client.user-pool"],
            cardinality: {
              minimum: 1,
              maximum: 1,
              enforcement: "provider-rule",
            },
            allowsMultipleEdges: false,
            containsExclusiveRelationships: true,
            guidedExplanation:
              "Connect the user pool that owns this app registration.",
            professionalExplanation:
              "Exact required parent association with one input port and provider-rule cardinality.",
          }),
          dock({
            id: "aws.cognito.user-pool-client.dock.jwt-audience",
            category: "identity",
            label: "JWT audience",
            description:
              "Protected APIs that accept this app registration as a JWT audience.",
            placement: "right",
            order: 0,
            directionPolicy: "output-only",
            portIds: ["aws.cognito.user-pool-client.jwt-audience"],
            cardinality: {
              minimum: 1,
              maximum: "many",
              enforcement: "provider-rule",
            },
            allowsMultipleEdges: true,
            containsExclusiveRelationships: false,
            guidedExplanation:
              "Connect the protected APIs that accept tokens for this app registration.",
            professionalExplanation:
              "Exact JWT audience output retains per-target issuer and audience validation.",
          }),
        ],
      },
      {
        serviceId: "aws.dynamodb.table",
        docks: [
          dock({
            id: "aws.dynamodb.table.dock.data",
            category: "data",
            label: "Data access",
            description: "Workloads that read or write this table.",
            placement: "left",
            order: 0,
            directionPolicy: "input-only",
            portIds: ["aws.dynamodb.table.table-api"],
            cardinality: {
              minimum: 1,
              maximum: "many",
              enforcement: "provider-rule",
            },
            allowsMultipleEdges: true,
            containsExclusiveRelationships: false,
            guidedExplanation:
              "Connect the functions that need to read or change table items.",
            professionalExplanation:
              "Aggregates exact read/write relationship targets without merging their edges.",
          }),
          dock({
            id: "aws.dynamodb.table.dock.identity",
            category: "identity",
            label: "Permissions",
            description: "Policy statements scoped to this table.",
            placement: "left",
            order: 1,
            directionPolicy: "input-only",
            portIds: ["aws.dynamodb.table.policy-resource"],
            cardinality: {
              minimum: 1,
              maximum: "many",
              enforcement: "provider-rule",
            },
            allowsMultipleEdges: true,
            containsExclusiveRelationships: false,
            guidedExplanation:
              "Review the permissions that are limited to this table.",
            professionalExplanation:
              "Shows exact table-resource scope edges for canonical policy statements.",
          }),
        ],
      },
      {
        serviceId: "aws.iam.managed-policy-attachment",
        docks: [
          dock({
            id: "aws.iam.managed-policy-attachment.dock.identity",
            category: "identity",
            label: "Role attachment",
            description:
              "The role slot that owns this managed policy reference.",
            placement: "right",
            order: 0,
            directionPolicy: "output-only",
            portIds: [
              "aws.iam.managed-policy-attachment.role-managed-policy",
              "aws.iam.managed-policy-attachment.role-permissions-boundary",
            ],
            cardinality: {
              minimum: 0,
              maximum: 1,
              enforcement: "provider-rule",
            },
            allowsMultipleEdges: false,
            containsExclusiveRelationships: true,
            guidedExplanation:
              "This reference is either a role policy attachment or its one permissions boundary.",
            professionalExplanation:
              "Attachment kind selects one exact mutually exclusive semantic owner port.",
          }),
        ],
      },
      {
        serviceId: "aws.iam.policy-condition",
        docks: [
          dock({
            id: "aws.iam.policy-condition.dock.identity",
            category: "identity",
            label: "Statement",
            description: "The policy statement narrowed by this condition.",
            placement: "right",
            order: 0,
            directionPolicy: "output-only",
            portIds: ["aws.iam.policy-condition.statement-condition"],
            cardinality: {
              minimum: 1,
              maximum: 1,
              enforcement: "provider-rule",
            },
            allowsMultipleEdges: false,
            containsExclusiveRelationships: true,
            guidedExplanation:
              "This advanced condition belongs to one permission statement.",
            professionalExplanation:
              "Exact statement-condition owner binding; condition values remain typed configuration.",
          }),
        ],
      },
      {
        serviceId: "aws.iam.policy-document",
        docks: [
          dock({
            id: "aws.iam.policy-document.dock.identity",
            category: "identity",
            label: "Policy owner",
            description:
              "The role, resource, or service configuration that owns this policy.",
            placement: "right",
            order: 0,
            directionPolicy: "output-only",
            portIds: [
              "aws.iam.policy-document.event-bus-resource-policy",
              "aws.iam.policy-document.gateway-endpoint-resource-policy",
              "aws.iam.policy-document.lambda-service-grant",
              "aws.iam.policy-document.role-generated-permission",
              "aws.iam.policy-document.role-inline-policy",
              "aws.iam.policy-document.role-trust-policy",
              "aws.iam.policy-document.s3-bucket-resource-policy",
              "aws.iam.policy-document.sns-topic-resource-policy",
              "aws.iam.policy-document.sqs-queue-resource-policy",
            ],
            cardinality: {
              minimum: 1,
              maximum: 1,
              enforcement: "provider-rule",
            },
            allowsMultipleEdges: false,
            containsExclusiveRelationships: true,
            guidedExplanation:
              "This policy belongs to exactly one service or role slot.",
            professionalExplanation:
              "Policy kind and the selected exact owner port must agree; cleanup authority comes from lifecycle provenance.",
          }),
          dock({
            id: "aws.iam.policy-document.dock.statements",
            category: "identity",
            label: "Statements",
            description: "The canonical statements contained by this policy.",
            placement: "left",
            order: 0,
            directionPolicy: "input-only",
            portIds: ["aws.iam.policy-document.statement"],
            cardinality: {
              minimum: 1,
              maximum: "many",
              enforcement: "provider-rule",
            },
            allowsMultipleEdges: true,
            containsExclusiveRelationships: false,
            guidedExplanation:
              "Add one or more clear permission statements to this policy.",
            professionalExplanation:
              "Each statement keeps a stable graph ID and deterministic order inside the canonical projection.",
          }),
        ],
      },
      {
        serviceId: "aws.iam.policy-statement",
        docks: [
          dock({
            id: "aws.iam.policy-statement.dock.identity",
            category: "identity",
            label: "Policy document",
            description:
              "The canonical policy document containing this statement.",
            placement: "right",
            order: 1,
            directionPolicy: "output-only",
            portIds: ["aws.iam.policy-statement.policy-document"],
            cardinality: {
              minimum: 1,
              maximum: 1,
              enforcement: "provider-rule",
            },
            allowsMultipleEdges: false,
            containsExclusiveRelationships: true,
            guidedExplanation:
              "This statement belongs to one typed policy document.",
            professionalExplanation:
              "Exact document membership preserves stable statement identity and canonical policy projection.",
          }),
          dock({
            id: "aws.iam.policy-statement.dock.data",
            category: "data",
            label: "Resource scope",
            description: "The exact resource authorized by this statement.",
            placement: "right",
            order: 0,
            directionPolicy: "output-only",
            portIds: [
              "aws.iam.policy-statement.dynamodb-resource",
              "aws.iam.policy-statement.eventbridge-resource",
              "aws.iam.policy-statement.lambda-resource",
              "aws.iam.policy-statement.log-group-resource",
              "aws.iam.policy-statement.s3-resource",
              "aws.iam.policy-statement.sns-resource",
              "aws.iam.policy-statement.sqs-resource",
              "aws.iam.policy-statement.step-functions-resource",
            ],
            cardinality: {
              minimum: 0,
              maximum: "many",
              enforcement: "provider-rule",
            },
            allowsMultipleEdges: true,
            containsExclusiveRelationships: false,
            guidedExplanation:
              "Choose the architecture resources this statement may access.",
            professionalExplanation:
              "Exact typed scope edges and explicit advanced expressions remain separately validated.",
          }),
          dock({
            id: "aws.iam.policy-statement.dock.conditions",
            category: "identity",
            label: "Conditions",
            description: "Structured conditions that narrow this statement.",
            placement: "left",
            order: 0,
            directionPolicy: "input-only",
            portIds: ["aws.iam.policy-statement.condition"],
            cardinality: {
              minimum: 0,
              maximum: "many",
              enforcement: "provider-rule",
            },
            allowsMultipleEdges: true,
            containsExclusiveRelationships: false,
            guidedExplanation:
              "Advanced conditions can narrow when this permission applies.",
            professionalExplanation:
              "Each typed condition is an exact child configuration with a stable ID.",
          }),
        ],
      },
      {
        serviceId: "aws.iam.role",
        docks: [
          dock({
            id: "aws.iam.role.dock.policies",
            category: "identity",
            label: "Policies & permissions",
            description:
              "Trust, inline, generated, managed, and boundary policy relationships received by this role.",
            placement: "left",
            order: 0,
            directionPolicy: "input-only",
            portIds: [
              "aws.iam.role.custom-inline-policy",
              "aws.iam.role.generated-permission",
              "aws.iam.role.managed-policy",
              "aws.iam.role.permissions-boundary",
              "aws.iam.role.trust-policy",
            ],
            cardinality: {
              minimum: 1,
              maximum: "many",
              enforcement: "provider-rule",
            },
            allowsMultipleEdges: true,
            containsExclusiveRelationships: true,
            guidedExplanation:
              "Review the trust and permission policies attached to this role.",
            professionalExplanation:
              "Exact policy inputs retain independent trust, inline, generated, managed, and boundary rules.",
          }),
          dock({
            id: "aws.iam.role.dock.assumption",
            category: "identity",
            label: "Assumed by",
            description: "Workloads that assume this role.",
            placement: "right",
            order: 0,
            directionPolicy: "output-only",
            portIds: ["aws.iam.role.assumable-role"],
            cardinality: {
              minimum: 1,
              maximum: 1,
              enforcement: "provider-rule",
            },
            allowsMultipleEdges: false,
            containsExclusiveRelationships: true,
            guidedExplanation:
              "Connect the Lambda function that uses this role.",
            professionalExplanation:
              "The exact assumable-role output remains limited to one target by its port and provider rule.",
          }),
        ],
      },
      {
        serviceId: "aws.lambda.function",
        docks: [
          dock({
            id: "aws.lambda.function.dock.triggers",
            category: "triggers",
            label: "Triggers",
            description: "Synchronous request-response invocation.",
            placement: "left",
            order: 0,
            directionPolicy: "input-only",
            portIds: ["aws.lambda.function.synchronous-invocation"],
            cardinality: {
              minimum: 0,
              maximum: "many",
              enforcement: "provider-rule",
            },
            allowsMultipleEdges: true,
            containsExclusiveRelationships: false,
            guidedExplanation:
              "Connect the API routes that should run this function.",
            professionalExplanation:
              "Synchronous invocation candidates retain route and endpoint rule cardinality.",
          }),
          dock({
            id: "aws.lambda.function.dock.asynchronous-events",
            category: "triggers",
            label: "Async events",
            description: "Asynchronous event invocation sources.",
            placement: "left",
            order: 1,
            directionPolicy: "input-only",
            portIds: ["aws.lambda.function.asynchronous-invocation"],
            cardinality: {
              minimum: 0,
              maximum: "many",
              enforcement: "semantic-port",
            },
            allowsMultipleEdges: true,
            containsExclusiveRelationships: false,
            guidedExplanation:
              "Reviewed S3 notifications, SNS subscriptions, and EventBridge targets connect here for asynchronous Lambda invocation.",
            professionalExplanation:
              "Exact asynchronous invocation port for the reviewed S3, SNS, and EventBridge rules; unsupported sources are never inferred.",
          }),
          dock({
            id: "aws.lambda.function.dock.event-sources",
            category: "triggers",
            label: "Event sources",
            description:
              "Reviewed queue consumers and scheduled event workloads.",
            placement: "left",
            order: 2,
            directionPolicy: "input-only",
            portIds: [
              "aws.lambda.function.event-source",
              "aws.lambda.function.schedule",
            ],
            cardinality: {
              minimum: 0,
              maximum: "many",
              enforcement: "semantic-port",
            },
            allowsMultipleEdges: true,
            containsExclusiveRelationships: false,
            guidedExplanation:
              "SQS event-source mappings and reviewed scheduled workloads use these trigger inputs.",
            professionalExplanation:
              "Exact queue and schedule trigger ports expose only reviewed contracts; unsupported streams or sources are not synthesized.",
          }),
          dock({
            id: "aws.lambda.function.dock.data",
            category: "data",
            label: "Data & storage",
            description: "Read, write, and object-storage dependencies.",
            placement: "right",
            order: 0,
            directionPolicy: "output-only",
            portIds: [
              "aws.lambda.function.data-read",
              "aws.lambda.function.data-write",
              "aws.lambda.function.object-access",
            ],
            cardinality: {
              minimum: 0,
              maximum: "many",
              enforcement: "provider-rule",
            },
            allowsMultipleEdges: true,
            containsExclusiveRelationships: false,
            guidedExplanation:
              "Connect the data stores this function reads or changes.",
            professionalExplanation:
              "Read, write, and object capabilities share one anchor but keep exact ports and IAM effects.",
          }),
          dock({
            id: "aws.lambda.function.dock.messaging",
            category: "messaging",
            label: "Messages & events",
            description: "Message, event, and dead-letter destinations.",
            placement: "right",
            order: 1,
            directionPolicy: "output-only",
            portIds: [
              "aws.lambda.function.message-send",
              "aws.lambda.function.event-publish",
              "aws.lambda.function.dead-letter-destination",
            ],
            cardinality: {
              minimum: 0,
              maximum: "many",
              enforcement: "provider-rule",
            },
            allowsMultipleEdges: true,
            containsExclusiveRelationships: true,
            guidedExplanation:
              "Connect message and failure destinations when supported.",
            professionalExplanation:
              "The dead-letter port remains individually exclusive inside this aggregate dock.",
          }),
          dock({
            id: "aws.lambda.function.dock.invocation",
            category: "invocation",
            label: "Invokes",
            description: "Other workloads invoked by this function.",
            placement: "right",
            order: 2,
            directionPolicy: "output-only",
            portIds: ["aws.lambda.function.workload-invocation"],
            cardinality: {
              minimum: 0,
              maximum: "many",
              enforcement: "semantic-port",
            },
            allowsMultipleEdges: true,
            containsExclusiveRelationships: false,
            guidedExplanation:
              "This dot shows where reviewed calls from this function will connect.",
            professionalExplanation:
              "Exact workload-invocation capability with no unreviewed resolver.",
          }),
          dock({
            id: "aws.lambda.function.dock.configuration",
            category: "other",
            label: "Configuration",
            description: "Secret and configuration dependencies.",
            placement: "right",
            order: 3,
            directionPolicy: "output-only",
            portIds: ["aws.lambda.function.configuration-read"],
            cardinality: {
              minimum: 0,
              maximum: "many",
              enforcement: "semantic-port",
            },
            allowsMultipleEdges: true,
            containsExclusiveRelationships: false,
            guidedExplanation:
              "This dot shows where reviewed configuration and secret dependencies will connect.",
            professionalExplanation:
              "No inline secret or unreviewed connection rule is implied.",
          }),
          dock({
            id: "aws.lambda.function.dock.identity",
            category: "identity",
            label: "Identity & grants",
            description:
              "The one execution role and any service-specific invocation permissions.",
            placement: "left",
            order: 3,
            directionPolicy: "input-only",
            portIds: [
              "aws.lambda.function.execution-role",
              "aws.lambda.function.invocation-permission",
              "aws.lambda.function.policy-resource",
            ],
            cardinality: {
              minimum: 1,
              maximum: "many",
              enforcement: "provider-rule",
            },
            allowsMultipleEdges: true,
            containsExclusiveRelationships: true,
            guidedExplanation:
              "Choose the role this function uses and review grants that allow supported services to invoke it.",
            professionalExplanation:
              "Execution-role cardinality remains exactly one; service-grant relationships may fan out independently.",
          }),
          dock({
            id: "aws.lambda.function.dock.networking",
            category: "networking",
            label: "Networking",
            description: "Reviewed VPC access association.",
            placement: "left",
            order: 4,
            directionPolicy: "input-only",
            portIds: ["aws.lambda.function.vpc-access"],
            cardinality: {
              minimum: 0,
              maximum: 1,
              enforcement: "semantic-port",
            },
            allowsMultipleEdges: false,
            containsExclusiveRelationships: true,
            guidedExplanation:
              "Network placement appears here after a reviewed service rule exists.",
            professionalExplanation:
              "Optional exclusive VPC association; no networking service is added by this catalog.",
          }),
          dock({
            id: "aws.lambda.function.dock.observability",
            category: "observability",
            label: "Observability",
            description: "Logging and metric observers.",
            placement: "right",
            order: 4,
            directionPolicy: "output-only",
            portIds: [
              "aws.lambda.function.logging",
              "aws.lambda.function.telemetry",
            ],
            cardinality: {
              minimum: 1,
              maximum: "many",
              enforcement: "provider-rule",
            },
            allowsMultipleEdges: true,
            containsExclusiveRelationships: true,
            guidedExplanation:
              "Review where this function sends logs and which alarms watch it.",
            professionalExplanation:
              "Logging remains exclusive while telemetry may fan out to multiple observers.",
          }),
        ],
      },
      ...awsNetworkingServiceConnectionPresentationsV1,
      ...awsEventDrivenServiceConnectionPresentationsV1,
      ...awsFsxServicePresentations,
      awsKmsServicePresentation,
      awsSecretServicePresentation,
      ...awsEc2ServicePresentations,
      ...awsEcsServicePresentations,
      ...awsRdsServicePresentations,
      ...awsAuroraServicePresentations,
      ...awsDnsServicePresentations,
      ...awsCloudfrontServicePresentations,
      ...awsEbsServicePresentations,
      ...awsWafServicePresentations,
      ...awsElbServicePresentations,
    ]
      .map(extendFsxPresentation)
      .map(extendKmsPresentation)
      .map(extendSecretPresentation)
      .map(extendEc2Presentation)
      .map(extendEcsPresentation)
      .map(extendRdsPresentation)
      .map(extendAuroraPresentation)
      .map(extendEbsPresentation)
      .map(extendElbPresentation)
      .map(extendCloudfrontPresentation)
      .map(extendWafPresentation),
    relationshipLabels: [
      ...wafBindings.map((b) => ({ ruleId: b[0], label: b[7] })),
      ...ecsBindings.map((b) => ({ ruleId: b[0], label: b[7] })),
      ...ec2Bindings.map((b) => ({ ruleId: b[0], label: b[8] })),
      { ruleId: "aws.kms.key-encrypts-secret", label: "Encrypts secret" },
      {
        ruleId: "aws.iam.policy-statement-authorizes-secret",
        label: "Scopes secret access to",
      },
      {
        ruleId: "aws.apigateway.http-api-invokes-lambda",
        label: "Invokes",
      },
      {
        ruleId: "aws.cognito.user-pool-authorizes-http-api",
        label: "Provides authentication",
      },
      {
        ruleId: "aws.cognito.app-client-authorizes-http-api",
        label: "Provides audience",
      },
      {
        ruleId: "aws.cognito.user-pool-configures-app-client",
        label: "Registers client",
      },
      {
        ruleId: "aws.iam.role-assumed-by-lambda",
        label: "Uses role",
      },
      {
        ruleId: "aws.iam.role-owns-trust-policy",
        label: "Uses trust policy",
      },
      {
        ruleId: "aws.iam.role-owns-inline-policy",
        label: "Uses custom policy",
      },
      {
        ruleId: "aws.iam.role-owns-generated-permission",
        label: "Uses generated permission",
      },
      {
        ruleId: "aws.iam.role-owns-managed-policy-attachment",
        label: "Attaches managed policy",
      },
      {
        ruleId: "aws.iam.role-owns-permissions-boundary",
        label: "Limits with boundary",
      },
      {
        ruleId: "aws.lambda.owns-invocation-permission",
        label: "Allows invocation",
      },
      {
        ruleId: "aws.iam.policy-contains-statement",
        label: "Contains statement",
      },
      {
        ruleId: "aws.iam.statement-owns-condition",
        label: "Uses condition",
      },
      { ruleId: "aws.lambda.reads-dynamodb-table", label: "Reads from" },
      { ruleId: "aws.lambda.writes-dynamodb-table", label: "Writes to" },
      {
        ruleId: "aws.iam.policy-statement-authorizes-dynamodb-table",
        label: "Scopes access to",
      },
      {
        ruleId: "aws.iam.policy-statement-authorizes-lambda-function",
        label: "Scopes invocation to",
      },
      {
        ruleId: "aws.iam.policy-statement-authorizes-log-group",
        label: "Scopes logging to",
      },
      { ruleId: "aws.lambda.writes-log-group", label: "Sends logs to" },
      {
        ruleId: "aws.lambda.monitored-by-alarm",
        label: "Sends metrics to",
      },
      ...elbBindings.map((b) => ({ ruleId: b[0], label: b[7] })),
      ...ebsBindings.map((b) => ({ ruleId: b[0], label: b[7] })),
      ...cloudfrontBindings.map((b) => ({ ruleId: b[0], label: b[7] })),
      ...dnsBindings.map((b) => ({ ruleId: b[0], label: b[7] })),
      ...auroraBindings.map((b) => ({ ruleId: b[0], label: b[7] })),
      ...rdsBindings.map((b) => ({ ruleId: b[0], label: b[7] })),
      ...awsNetworkingRelationshipLabelsV1,
      ...awsEventDrivenRelationshipLabelsV1,
      ...awsFsxRelationshipLabels,
      { ruleId: "aws.kms.key-owns-resource-policy", label: "Owns key policy" },
      {
        ruleId: "aws.iam.policy-statement-authorizes-kms-key",
        label: "Scopes key policy to",
      },
      { ruleId: "aws.lambda.reads-s3-bucket", label: "Reads objects from" },
      { ruleId: "aws.lambda.writes-s3-bucket", label: "Writes objects to" },
    ],
  });
}
