import { defineProviderValidationRuleDescriptorV1 } from "@cloudmarkup/provider-sdk";

const awsPublisher = "Amazon Web Services";

export const apiRouteAuthenticationValidationRuleDescriptor =
  defineProviderValidationRuleDescriptorV1({
    id: "aws.cloudmarkup.validation.api-route-authentication",
    interfaceVersion: 1,
    ruleVersion: "1.0.0",
    implementationId:
      "aws.cloudmarkup.validation.evaluate-api-route-authentication",
    serviceIds: [
      "aws.apigateway.http-api",
      "aws.cognito.user-pool",
      "aws.cognito.user-pool-client",
      "aws.lambda.function",
    ],
    documentation: [
      {
        kind: "official",
        id: "aws.apigateway.documentation.jwt-authorizer-validation",
        title: "Control access to HTTP APIs with JWT authorizers",
        publisher: awsPublisher,
        url: "https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-jwt-authorizer.html",
      },
    ],
  });

export const iamWildcardValidationRuleDescriptor =
  defineProviderValidationRuleDescriptorV1({
    id: "aws.cloudmarkup.validation.iam-wildcards",
    interfaceVersion: 1,
    ruleVersion: "1.0.0",
    implementationId: "aws.cloudmarkup.validation.evaluate-iam-wildcards",
    serviceIds: ["aws.iam.policy-statement"],
    documentation: [
      {
        kind: "official",
        id: "aws.iam.documentation.least-privilege-validation",
        title: "Apply least-privilege permissions",
        publisher: awsPublisher,
        url: "https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html",
      },
    ],
  });

export const iamPolicySafetyValidationRuleDescriptor =
  defineProviderValidationRuleDescriptorV1({
    id: "aws.cloudmarkup.validation.iam-policy-safety",
    interfaceVersion: 1,
    ruleVersion: "1.0.0",
    implementationId: "aws.cloudmarkup.validation.evaluate-iam-policy-safety",
    serviceIds: [
      "aws.iam.managed-policy-attachment",
      "aws.iam.policy-condition",
      "aws.iam.policy-document",
      "aws.iam.policy-statement",
      "aws.iam.role",
    ],
    documentation: [
      {
        kind: "official",
        id: "aws.iam.documentation.policy-validation",
        title: "IAM JSON policy elements reference",
        publisher: awsPublisher,
        url: "https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements.html",
      },
    ],
  });

export const lambdaExecutionRoleValidationRuleDescriptor =
  defineProviderValidationRuleDescriptorV1({
    id: "aws.cloudmarkup.validation.lambda-execution-role",
    interfaceVersion: 1,
    ruleVersion: "1.0.0",
    implementationId:
      "aws.cloudmarkup.validation.evaluate-lambda-execution-role",
    serviceIds: ["aws.iam.role", "aws.lambda.function"],
    documentation: [
      {
        kind: "official",
        id: "aws.lambda.documentation.execution-role-validation",
        title: "Lambda execution role",
        publisher: awsPublisher,
        url: "https://docs.aws.amazon.com/lambda/latest/dg/lambda-intro-execution-role.html",
      },
    ],
  });

export const connectionCardinalityValidationRuleDescriptor =
  defineProviderValidationRuleDescriptorV1({
    id: "aws.cloudmarkup.validation.connection-cardinality",
    interfaceVersion: 1,
    ruleVersion: "1.0.0",
    implementationId:
      "aws.cloudmarkup.validation.evaluate-connection-cardinality",
    serviceIds: [
      "aws.apigateway.http-api",
      "aws.cloudwatch.log-group",
      "aws.cloudwatch.metric-alarm",
      "aws.cognito.user-pool",
      "aws.cognito.user-pool-client",
      "aws.dynamodb.table",
      "aws.ec2.availability-zone",
      "aws.ec2.gateway-vpc-endpoint",
      "aws.ec2.internet-gateway",
      "aws.ec2.nat-gateway",
      "aws.ec2.route",
      "aws.ec2.route-table",
      "aws.ec2.route-table-association",
      "aws.ec2.security-group",
      "aws.ec2.security-group-egress-rule",
      "aws.ec2.security-group-ingress-rule",
      "aws.ec2.subnet",
      "aws.ec2.vpc",
      "aws.iam.managed-policy-attachment",
      "aws.iam.policy-condition",
      "aws.iam.policy-document",
      "aws.iam.policy-statement",
      "aws.iam.role",
      "aws.lambda.function",
      "aws.lambda.vpc-access-configuration",
      "aws.region.boundary",
    ],
    documentation: [
      {
        kind: "cloudmarkup",
        id: "cloudmarkup.docs.provider-catalog.connection-cardinality",
        title: "Provider connection authoring",
        path: "docs/development/PROVIDER_CATALOG.md#add-a-connection-rule",
      },
    ],
  });

export const lambdaTriggerCompatibilityValidationRuleDescriptor =
  defineProviderValidationRuleDescriptorV1({
    id: "aws.cloudmarkup.validation.lambda-trigger-compatibility",
    interfaceVersion: 1,
    ruleVersion: "1.0.0",
    implementationId:
      "aws.cloudmarkup.validation.evaluate-lambda-trigger-compatibility",
    serviceIds: ["aws.lambda.function"],
    documentation: [
      {
        kind: "official",
        id: "aws.lambda.documentation.event-driven-invocation",
        title: "Lambda event-driven invocation",
        publisher: awsPublisher,
        url: "https://docs.aws.amazon.com/lambda/latest/dg/concepts-event-driven-architectures.html",
      },
    ],
  });

export const lambdaDynamoDbActionsValidationRuleDescriptor =
  defineProviderValidationRuleDescriptorV1({
    id: "aws.cloudmarkup.validation.lambda-dynamodb-actions",
    interfaceVersion: 1,
    ruleVersion: "1.0.0",
    implementationId:
      "aws.cloudmarkup.validation.evaluate-lambda-dynamodb-actions",
    serviceIds: [
      "aws.dynamodb.table",
      "aws.iam.policy-statement",
      "aws.iam.role",
      "aws.lambda.function",
    ],
    documentation: [
      {
        kind: "official",
        id: "aws.dynamodb.documentation.iam-actions-validation",
        title: "Identity-based policy examples for DynamoDB",
        publisher: awsPublisher,
        url: "https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/security_iam_id-based-policy-examples.html",
      },
    ],
  });

export const dynamoDbProtectionValidationRuleDescriptor =
  defineProviderValidationRuleDescriptorV1({
    id: "aws.cloudmarkup.validation.dynamodb-protection",
    interfaceVersion: 1,
    ruleVersion: "1.0.0",
    implementationId: "aws.cloudmarkup.validation.evaluate-dynamodb-protection",
    serviceIds: ["aws.dynamodb.table"],
    documentation: [
      {
        kind: "official",
        id: "aws.dynamodb.documentation.pitr-validation",
        title: "Point-in-time recovery for DynamoDB",
        publisher: awsPublisher,
        url: "https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/PointInTimeRecovery.html",
      },
      {
        kind: "official",
        id: "aws.dynamodb.documentation.encryption-validation",
        title: "DynamoDB encryption at rest",
        publisher: awsPublisher,
        url: "https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/EncryptionAtRest.html",
      },
    ],
  });

export const logRetentionValidationRuleDescriptor =
  defineProviderValidationRuleDescriptorV1({
    id: "aws.cloudmarkup.validation.log-retention",
    interfaceVersion: 1,
    ruleVersion: "1.0.0",
    implementationId: "aws.cloudmarkup.validation.evaluate-log-retention",
    serviceIds: ["aws.cloudwatch.log-group"],
    documentation: [
      {
        kind: "official",
        id: "aws.cloudwatch.documentation.retention-validation",
        title: "Change log data retention in CloudWatch Logs",
        publisher: awsPublisher,
        url: "https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/Working-with-log-groups-and-streams.html",
      },
    ],
  });

export const lambdaRuntimeBoundsValidationRuleDescriptor =
  defineProviderValidationRuleDescriptorV1({
    id: "aws.cloudmarkup.validation.lambda-runtime-bounds",
    interfaceVersion: 1,
    ruleVersion: "1.0.0",
    implementationId:
      "aws.cloudmarkup.validation.evaluate-lambda-runtime-bounds",
    serviceIds: ["aws.lambda.function"],
    documentation: [
      {
        kind: "official",
        id: "aws.lambda.documentation.configuration-validation",
        title: "Configuring Lambda function options",
        publisher: awsPublisher,
        url: "https://docs.aws.amazon.com/lambda/latest/dg/configuration-function-common.html",
      },
    ],
  });

export const connectionQuestionsValidationRuleDescriptor =
  defineProviderValidationRuleDescriptorV1({
    id: "aws.cloudmarkup.validation.connection-questions",
    interfaceVersion: 1,
    ruleVersion: "1.0.0",
    implementationId:
      "aws.cloudmarkup.validation.evaluate-connection-questions",
    serviceIds: [
      "aws.apigateway.http-api",
      "aws.dynamodb.table",
      "aws.lambda.function",
    ],
    documentation: [
      {
        kind: "cloudmarkup",
        id: "cloudmarkup.docs.provider-catalog.connection-questions",
        title: "Provider connection authoring",
        path: "docs/development/PROVIDER_CATALOG.md#add-a-connection-rule",
      },
    ],
  });

export const regionAvailabilityValidationRuleDescriptor =
  defineProviderValidationRuleDescriptorV1({
    id: "aws.cloudmarkup.validation.region-availability",
    interfaceVersion: 1,
    ruleVersion: "1.0.0",
    implementationId: "aws.cloudmarkup.validation.evaluate-region-availability",
    serviceIds: [
      "aws.apigateway.http-api",
      "aws.cloudwatch.log-group",
      "aws.cloudwatch.metric-alarm",
      "aws.cognito.user-pool",
      "aws.cognito.user-pool-client",
      "aws.dynamodb.table",
      "aws.ec2.availability-zone",
      "aws.ec2.gateway-vpc-endpoint",
      "aws.ec2.internet-gateway",
      "aws.ec2.nat-gateway",
      "aws.ec2.route",
      "aws.ec2.route-table",
      "aws.ec2.route-table-association",
      "aws.ec2.security-group",
      "aws.ec2.security-group-egress-rule",
      "aws.ec2.security-group-ingress-rule",
      "aws.ec2.subnet",
      "aws.ec2.vpc",
      "aws.lambda.function",
      "aws.lambda.vpc-access-configuration",
      "aws.region.boundary",
    ],
    documentation: [
      {
        kind: "official",
        id: "aws.documentation.regional-services-validation",
        title: "AWS services by Region",
        publisher: awsPublisher,
        url: "https://aws.amazon.com/about-aws/global-infrastructure/regional-product-services/",
      },
    ],
  });

export const compilerReadinessValidationRuleDescriptor =
  defineProviderValidationRuleDescriptorV1({
    id: "aws.cloudmarkup.validation.compiler-readiness",
    interfaceVersion: 1,
    ruleVersion: "1.0.0",
    implementationId: "aws.cloudmarkup.validation.evaluate-compiler-readiness",
    serviceIds: [
      "aws.apigateway.http-api",
      "aws.cloudwatch.log-group",
      "aws.cloudwatch.metric-alarm",
      "aws.cognito.user-pool",
      "aws.cognito.user-pool-client",
      "aws.dynamodb.table",
      "aws.ec2.availability-zone",
      "aws.ec2.gateway-vpc-endpoint",
      "aws.ec2.internet-gateway",
      "aws.ec2.nat-gateway",
      "aws.ec2.route",
      "aws.ec2.route-table",
      "aws.ec2.route-table-association",
      "aws.ec2.security-group",
      "aws.ec2.security-group-egress-rule",
      "aws.ec2.security-group-ingress-rule",
      "aws.ec2.subnet",
      "aws.ec2.vpc",
      "aws.iam.managed-policy-attachment",
      "aws.iam.policy-condition",
      "aws.iam.policy-document",
      "aws.iam.policy-statement",
      "aws.iam.role",
      "aws.lambda.function",
      "aws.lambda.vpc-access-configuration",
      "aws.region.boundary",
    ],
    documentation: [
      {
        kind: "cloudmarkup",
        id: "cloudmarkup.docs.provider-catalog.compiler-mappings",
        title: "Provider compiler mapping authoring",
        path: "docs/development/PROVIDER_CATALOG.md#add-a-compiler-mapping",
      },
    ],
  });

export const awsValidationRuleDescriptorsV1 = [
  apiRouteAuthenticationValidationRuleDescriptor,
  iamWildcardValidationRuleDescriptor,
  iamPolicySafetyValidationRuleDescriptor,
  lambdaExecutionRoleValidationRuleDescriptor,
  connectionCardinalityValidationRuleDescriptor,
  lambdaTriggerCompatibilityValidationRuleDescriptor,
  lambdaDynamoDbActionsValidationRuleDescriptor,
  dynamoDbProtectionValidationRuleDescriptor,
  logRetentionValidationRuleDescriptor,
  lambdaRuntimeBoundsValidationRuleDescriptor,
  connectionQuestionsValidationRuleDescriptor,
  regionAvailabilityValidationRuleDescriptor,
  compilerReadinessValidationRuleDescriptor,
];

const awsServiceIds0_8_0 = new Set([
  "aws.apigateway.http-api",
  "aws.cloudwatch.log-group",
  "aws.cloudwatch.metric-alarm",
  "aws.cognito.user-pool",
  "aws.cognito.user-pool-client",
  "aws.dynamodb.table",
  "aws.iam.managed-policy-attachment",
  "aws.iam.policy-condition",
  "aws.iam.policy-document",
  "aws.iam.policy-statement",
  "aws.iam.role",
  "aws.lambda.function",
]);

/** Immutable validation descriptors used to reproduce the exact 0.8.0 artifact. */
export const awsValidationRuleDescriptors0_8_0 =
  awsValidationRuleDescriptorsV1.map((descriptor) =>
    defineProviderValidationRuleDescriptorV1({
      ...descriptor,
      serviceIds: descriptor.serviceIds.filter((serviceId) =>
        awsServiceIds0_8_0.has(String(serviceId)),
      ),
    }),
  );
