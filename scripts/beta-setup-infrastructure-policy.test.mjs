import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { parse } from "yaml";
import "./beta-sandbox-billing-bootstrap-policy.test.mjs";

const applicationAccountId = "000000000000";
const dnsAccountId = "000000000001";
const hostedZoneId = "ZSYNTHETIC123456";
const applicationRoleArn = `arn:aws:iam::${applicationAccountId}:role/CloudMarkup-Beta-GitHub`;
const dnsRoleArn = `arn:aws:iam::${dnsAccountId}:role/CloudMarkup-Beta-DNS`;
const dnsRecordsStackArn =
  "arn:${AWS::Partition}:cloudformation:us-east-1:${AWS::AccountId}:stack/cloudmarkup-beta-dns-records/*";
const hostedZoneArn =
  "arn:${AWS::Partition}:route53:::hostedzone/${HostedZoneId}";
const betaStackArns = [
  "arn:${AWS::Partition}:cloudformation:${AWS::Region}:${AWS::AccountId}:stack/cloudmarkup-beta-observability/*",
  "arn:${AWS::Partition}:cloudformation:${AWS::Region}:${AWS::AccountId}:stack/cloudmarkup-beta-stateful/*",
  "arn:${AWS::Partition}:cloudformation:${AWS::Region}:${AWS::AccountId}:stack/cloudmarkup-beta-application/*",
  "arn:${AWS::Partition}:cloudformation:${AWS::Region}:${AWS::AccountId}:stack/cloudmarkup-beta-edge/*",
];
const betaChangeSetNames = [
  "cdk-deploy-change-set",
  "arn:${AWS::Partition}:cloudformation:${AWS::Region}:${AWS::AccountId}:changeSet/cdk-deploy-change-set/*",
];
const cloudFormationTags = ["!GetAtt", "!Ref", "!Sub"].map((tag) => ({
  tag,
  resolve: (value) => value,
}));

async function template(path) {
  return parse(await readFile(path, "utf8"), {
    customTags: cloudFormationTags,
    logLevel: "silent",
  });
}

const certificate = await template(
  "infra/application-account/cloudmarkup-beta-certificate.yml",
);
const githubDnsAccess = await template(
  "infra/application-account/cloudmarkup-beta-github-dns-access.yml",
);
const dnsBootstrap = await template(
  "infra/dns-account/cloudmarkup-beta-dns-bootstrap.yml",
);
const dnsRecords = await template(
  "infra/dns-account/cloudmarkup-beta-dns-records.yml",
);

function asArray(value) {
  return Array.isArray(value) ? value : [value];
}

function statements(resource) {
  return resource.Properties.Policies[0].PolicyDocument.Statement;
}

function statementBySid(resource, sid) {
  const statement = statements(resource).find(
    (candidate) => candidate.Sid === sid,
  );
  assert.ok(statement, `missing policy statement ${sid}`);
  return statement;
}

function policyDocuments(resource) {
  const documents = [];
  const policyDocument = resource.Properties?.PolicyDocument;
  if (policyDocument !== undefined) documents.push(policyDocument);
  for (const policy of resource.Properties?.Policies ?? []) {
    documents.push(policy.PolicyDocument);
  }
  return documents;
}

function actionsOf(resources) {
  function actionsIn(statement) {
    if (Object.hasOwn(statement, "Fn::If")) {
      return statement["Fn::If"].slice(1).flatMap(actionsIn);
    }
    if (statement.Ref === "AWS::NoValue") return [];
    assert.ok(Object.hasOwn(statement, "Action"), "expected an IAM action");
    return asArray(statement.Action);
  }
  return new Set(
    resources.flatMap((resource) =>
      policyDocuments(resource).flatMap((document) =>
        document.Statement.flatMap(actionsIn),
      ),
    ),
  );
}

function retained(resource) {
  assert.equal(resource.DeletionPolicy, "RetainExceptOnCreate");
  assert.equal(resource.UpdateReplacePolicy, "Retain");
}

test("application-account certificate is a retained DNS-validation CloudFormation resource", () => {
  assert.deepEqual(Object.keys(certificate.Resources), ["BetaCertificate"]);
  const resource = certificate.Resources.BetaCertificate;
  retained(resource);
  assert.equal(resource.Type, "AWS::CertificateManager::Certificate");
  assert.deepEqual(resource.Properties, {
    DomainName: "beta.example.invalid",
    KeyAlgorithm: "EC_prime256v1",
    Tags: [
      { Key: "Environment", Value: "beta" },
      { Key: "ManagedBy", Value: "CloudFormation" },
      { Key: "Project", Value: "CloudMarkup" },
    ],
    ValidationMethod: "DNS",
  });
  assert.equal(certificate.Outputs.CertificateArn.Value, "BetaCertificate");
  assert.ok(!Object.hasOwn(resource.Properties, "HostedZoneId"));
});

test("application-account bootstrap owns the exact beta GitHub role", () => {
  const role = githubDnsAccess.Resources.CloudMarkupBetaGitHubRole;
  retained(role);
  assert.equal(role.Type, "AWS::IAM::Role");
  assert.equal(role.Properties.RoleName, "CloudMarkup-Beta-GitHub");
  assert.equal(role.Properties.MaxSessionDuration, 3600);
  assert.deepEqual(role.Properties.AssumeRolePolicyDocument.Statement, [
    {
      Sid: "TrustExactCloudMarkupGitHubDevelopment",
      Effect: "Allow",
      Principal: {
        Federated:
          "arn:aws:iam::000000000000:oidc-provider/token.actions.githubusercontent.com",
      },
      Action: "sts:AssumeRoleWithWebIdentity",
      Condition: {
        StringEquals: {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
          "token.actions.githubusercontent.com:sub":
            "repo:sample-owner@135792469/CloudMarkup-Operations@246813580:environment:Development",
        },
      },
    },
  ]);
  assert.deepEqual(role.Properties.Policies, [
    {
      PolicyName: "CloudMarkupBetaCdkDeployment",
      PolicyDocument: {
        Version: "2012-10-17",
        Statement: [
          {
            Sid: "AssumeExactCloudMarkupBetaCdkRoles",
            Effect: "Allow",
            Action: "sts:AssumeRole",
            Resource: [
              "arn:aws:iam::000000000000:role/CloudMarkup-Beta-CDK-Deploy",
              "arn:aws:iam::000000000000:role/CloudMarkup-Beta-CDK-File-Publishing",
              "arn:aws:iam::000000000000:role/CloudMarkup-Beta-CDK-Lookup",
            ],
          },
        ],
      },
    },
    {
      PolicyName: "CloudMarkupBetaApiGatewayPreflight",
      PolicyDocument: {
        Version: "2012-10-17",
        Statement: [
          {
            Sid: "ReadExactApiGatewayAccount",
            Effect: "Allow",
            Action: "apigateway:GET",
            Resource: "arn:aws:apigateway:us-east-1::/account",
          },
        ],
      },
    },
  ]);

  const dnsAccess = githubDnsAccess.Resources.CloudMarkupAssumeBetaDns;
  retained(dnsAccess);
  assert.equal(dnsAccess.Type, "AWS::IAM::ManagedPolicy");
  assert.equal(
    dnsAccess.Properties.ManagedPolicyName,
    "CloudMarkupAssumeBetaDns",
  );
  assert.deepEqual(dnsAccess.Properties.Roles, ["CloudMarkupBetaGitHubRole"]);
  assert.deepEqual(dnsAccess.Properties.PolicyDocument.Statement, [
    {
      Sid: "AssumeExactCloudMarkupBetaDnsRole",
      Effect: "Allow",
      Action: ["sts:AssumeRole", "sts:TagSession"],
      Resource: dnsRoleArn,
    },
  ]);
  assert.equal(
    githubDnsAccess.Outputs.GitHubDeploymentRoleArn.Value,
    "CloudMarkupBetaGitHubRole.Arn",
  );
  assert.ok(!JSON.stringify(role).includes("hnb659fds"));
});

test("application-account bootstrap owns dedicated retained beta CDK assets, lookup, and runtime boundary", () => {
  for (const logicalId of [
    "CloudMarkupBetaRuntimeBoundary",
    "CloudMarkupBetaCdkAssets",
    "CloudMarkupBetaCdkAssetsPolicy",
    "CloudMarkupBetaCdkBootstrapVersion",
    "CloudMarkupBetaCdkFilePublishingRole",
    "CloudMarkupBetaCdkLookupRole",
  ]) {
    const resource = githubDnsAccess.Resources[logicalId];
    assert.ok(resource, `missing ${logicalId}`);
    retained(resource);
  }

  const boundary = githubDnsAccess.Resources.CloudMarkupBetaRuntimeBoundary;
  assert.equal(boundary.Type, "AWS::IAM::ManagedPolicy");
  assert.equal(
    boundary.Properties.ManagedPolicyName,
    "CloudMarkup-Beta-Runtime-Boundary",
  );
  const boundaryStatements = boundary.Properties.PolicyDocument.Statement;
  assert.equal(
    boundaryStatements.some(({ Action, Resource }) => {
      const actions = Array.isArray(Action) ? Action : [Action];
      return (
        Resource === "*" && actions.some((action) => action.startsWith("logs:"))
      );
    }),
    false,
  );

  const apiGatewayLoggingBoundary =
    githubDnsAccess.Resources.CloudMarkupBetaApiGatewayLoggingBoundary;
  assert.equal(apiGatewayLoggingBoundary.Type, "AWS::IAM::ManagedPolicy");
  retained(apiGatewayLoggingBoundary);
  assert.equal(
    apiGatewayLoggingBoundary.Properties.ManagedPolicyName,
    "CloudMarkup-Beta-ApiGateway-Logging-Boundary",
  );
  assert.deepEqual(
    apiGatewayLoggingBoundary.Properties.PolicyDocument.Statement,
    [
      {
        Sid: "AllowApiGatewayLogDelivery",
        Effect: "Allow",
        Action: [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:DescribeLogGroups",
          "logs:DescribeLogStreams",
          "logs:FilterLogEvents",
          "logs:GetLogEvents",
          "logs:PutLogEvents",
        ],
        Resource: "*",
      },
    ],
  );

  const bucket = githubDnsAccess.Resources.CloudMarkupBetaCdkAssets;
  assert.equal(bucket.Type, "AWS::S3::Bucket");
  assert.equal(
    bucket.Properties.BucketName,
    "cloudmarkup-beta-cdk-assets-${AWS::AccountId}-${AWS::Region}",
  );
  assert.deepEqual(bucket.Properties.VersioningConfiguration, {
    Status: "Enabled",
  });
  assert.deepEqual(bucket.Properties.PublicAccessBlockConfiguration, {
    BlockPublicAcls: true,
    BlockPublicPolicy: true,
    IgnorePublicAcls: true,
    RestrictPublicBuckets: true,
  });

  const version = githubDnsAccess.Resources.CloudMarkupBetaCdkBootstrapVersion;
  assert.equal(version.Type, "AWS::SSM::Parameter");
  assert.equal(
    version.Properties.Name,
    "/cloudmarkup/beta/cdk-bootstrap/version",
  );
  assert.equal(version.Properties.Value, "8");

  assert.equal(
    githubDnsAccess.Resources.CloudMarkupBetaCdkFilePublishingRole.Properties
      .RoleName,
    "CloudMarkup-Beta-CDK-File-Publishing",
  );
  assert.equal(
    githubDnsAccess.Resources.CloudMarkupBetaCdkLookupRole.Properties.RoleName,
    "CloudMarkup-Beta-CDK-Lookup",
  );
});

test("GitHub connections are owner-gated, default off, and read only two current secrets in the API role", () => {
  assert.deepEqual(
    githubDnsAccess.Parameters.EnableGitHubConnections.AllowedValues,
    ["false", "true"],
  );
  assert.equal(
    githubDnsAccess.Parameters.EnableGitHubConnections.Default,
    "false",
  );
  assert.deepEqual(githubDnsAccess.Conditions.GitHubConnectionsEnabled, {
    "Fn::Equals": [{ Ref: "EnableGitHubConnections" }, "true"],
  });
  const expected = {
    Sid: "ReadExactGitHubConnectionSecrets",
    Effect: "Allow",
    Action: "secretsmanager:GetSecretValue",
    Resource: [
      "arn:aws:secretsmanager:us-east-1:000000000000:secret:cloudmarkup/beta/github/app-private-key-EX0002",
      "arn:aws:secretsmanager:us-east-1:000000000000:secret:Github-App-Client-Secret-EX0001",
    ],
    Condition: {
      StringEquals: { "secretsmanager:VersionStage": "AWSCURRENT" },
    },
  };
  const conditional = {
    "Fn::If": ["GitHubConnectionsEnabled", expected, { Ref: "AWS::NoValue" }],
  };
  const boundary =
    githubDnsAccess.Resources.CloudMarkupBetaRuntimeBoundary.Properties
      .PolicyDocument.Statement;
  const api = statements(
    githubDnsAccess.Resources.CloudMarkupBetaApiRuntimeRole,
  );
  for (const policies of [boundary, api]) {
    assert.deepEqual(
      policies.filter((statement) =>
        JSON.stringify(statement).includes("ReadExactGitHubConnectionSecrets"),
      ),
      [conditional],
    );
    const disabled = policies.filter(
      (statement) => !Object.hasOwn(statement, "Fn::If"),
    );
    for (const arn of expected.Resource)
      assert.ok(!JSON.stringify(disabled).includes(arn));
  }
  for (const [id, resource] of Object.entries(githubDnsAccess.Resources)) {
    if (
      [
        "CloudMarkupBetaRuntimeBoundary",
        "CloudMarkupBetaApiRuntimeRole",
      ].includes(id)
    )
      continue;
    for (const arn of expected.Resource)
      assert.ok(
        !JSON.stringify(resource).includes(arn),
        `${id} must not receive connection-secret access`,
      );
  }
});

test("project cleanup can erase only scoped project versions and cannot read or upload their bodies", () => {
  const role =
    githubDnsAccess.Resources.CloudMarkupBetaProjectCleanupRuntimeRole;
  const statements = role.Properties.Policies[0].PolicyDocument.Statement;
  const actions = statements.flatMap(({ Action }) => [Action].flat()).sort();
  assert.deepEqual(
    actions,
    [
      "logs:CreateLogStream",
      "logs:PutLogEvents",
      "rds-data:BeginTransaction",
      "rds-data:CommitTransaction",
      "rds-data:ExecuteStatement",
      "rds-data:RollbackTransaction",
      "s3:DeleteObjectVersion",
      "s3:ListBucketVersions",
      "secretsmanager:GetSecretValue",
    ].sort(),
  );
  const bucket =
    "arn:${AWS::Partition}:s3:::cloudmarkup-beta-${AWS::AccountId}-${AWS::Region}-content";
  const prefixes = ["documents", "artifacts", "evidence"].map(
    (name) => `${name}/v1/organizations/v1/organizations/*/projects/*/`,
  );
  const list = statements.find(
    ({ Sid }) => Sid === "ListProjectContentVersions",
  );
  assert.equal(list.Resource, bucket);
  assert.deepEqual(list.Condition, { StringLike: { "s3:prefix": prefixes } });
  assert.deepEqual(
    statements.find(({ Sid }) => Sid === "EraseProjectContentVersions")
      .Resource,
    prefixes.map((prefix) => `${bucket}/${prefix}*`),
  );
  assert.equal(
    statements.find(({ Sid }) => Sid === "ApplyCleanupTransactions").Resource,
    "arn:${AWS::Partition}:rds:${AWS::Region}:${AWS::AccountId}:cluster:cloudmarkup-beta-postgresql",
  );
  assert.equal(
    statements.find(({ Sid }) => Sid === "ReadCleanupDatabaseCredential")
      .Resource,
    "arn:${AWS::Partition}:secretsmanager:${AWS::Region}:${AWS::AccountId}:secret:cloudmarkup-beta/database/admin-*",
  );
  const schedule =
    githubDnsAccess.Resources.CloudMarkupBetaApplicationExecutionPolicy.Properties.PolicyDocument.Statement.find(
      ({ Sid }) => Sid === "ManageExactProjectCleanupSchedule",
    );
  assert.equal(
    schedule.Resource,
    "arn:${AWS::Partition}:events:${AWS::Region}:${AWS::AccountId}:rule/cloudmarkup-beta-project-content-cleanup",
  );
  assert.ok(
    schedule.Action.every((action) => /^events:[A-Za-z]+$/u.test(action)),
  );
});

test("application-account bootstrap owns fixed runtime roles and protected imported resources", () => {
  const runtimeRoles = [
    [
      "CloudMarkupBetaProjectCleanupRuntimeRole",
      "CloudMarkup-Beta-Project-Cleanup-Runtime",
      "lambda.amazonaws.com",
      "CloudMarkupBetaRuntimeBoundary",
    ],
    [
      "CloudMarkupBetaApiRuntimeRole",
      "CloudMarkup-Beta-API-Runtime",
      "lambda.amazonaws.com",
      "CloudMarkupBetaRuntimeBoundary",
    ],
    [
      "CloudMarkupBetaDatabaseMigratorRuntimeRole",
      "CloudMarkup-Beta-Database-Migrator-Runtime",
      "lambda.amazonaws.com",
      "CloudMarkupBetaRuntimeBoundary",
    ],
    [
      "CloudMarkupBetaApiGatewayLoggingRole",
      "cloudmarkup-beta-api-gateway-logging",
      "apigateway.amazonaws.com",
      "CloudMarkupBetaApiGatewayLoggingBoundary",
    ],
    [
      "CloudMarkupBetaWebDeploymentRuntimeRole",
      "CloudMarkup-Beta-Web-Deployment-Runtime",
      "lambda.amazonaws.com",
      "CloudMarkupBetaRuntimeBoundary",
    ],
  ];
  for (const [
    logicalId,
    roleName,
    service,
    permissionsBoundary,
  ] of runtimeRoles) {
    const role = githubDnsAccess.Resources[logicalId];
    assert.ok(role, `missing ${logicalId}`);
    retained(role);
    assert.equal(role.Type, "AWS::IAM::Role");
    assert.equal(role.Properties.RoleName, roleName);
    assert.equal(role.Properties.PermissionsBoundary, permissionsBoundary);
    assert.deepEqual(role.Properties.AssumeRolePolicyDocument.Statement, [
      {
        Effect: "Allow",
        Principal: { Service: service },
        Action: "sts:AssumeRole",
      },
    ]);
    assert.equal(role.Properties.Policies.length, 1);
  }

  for (const [logicalId, type] of [
    [
      "CloudMarkupBetaWebOriginAccessControl",
      "AWS::CloudFront::OriginAccessControl",
    ],
    [
      "CloudMarkupBetaSecurityHeadersPolicy",
      "AWS::CloudFront::ResponseHeadersPolicy",
    ],
    [
      "CloudMarkupBetaPublicAssetHeadersPolicy",
      "AWS::CloudFront::ResponseHeadersPolicy",
    ],
    [
      "CloudMarkupBetaApiSecurityHeadersPolicy",
      "AWS::CloudFront::ResponseHeadersPolicy",
    ],
    ["CloudMarkupBetaAlarmTopic", "AWS::SNS::Topic"],
  ]) {
    const resource = githubDnsAccess.Resources[logicalId];
    assert.ok(resource, `missing ${logicalId}`);
    retained(resource);
    assert.equal(resource.Type, type);
  }

  const apiGatewayLoggingRole =
    githubDnsAccess.Resources.CloudMarkupBetaApiGatewayLoggingRole;
  assert.equal(
    apiGatewayLoggingRole.Properties.PermissionsBoundary,
    "CloudMarkupBetaApiGatewayLoggingBoundary",
  );
  assert.deepEqual(
    statementBySid(apiGatewayLoggingRole, "DeliverApiGatewayLogs"),
    {
      Sid: "DeliverApiGatewayLogs",
      Effect: "Allow",
      Action: [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:DescribeLogGroups",
        "logs:DescribeLogStreams",
        "logs:FilterLogEvents",
        "logs:GetLogEvents",
        "logs:PutLogEvents",
      ],
      Resource: "*",
    },
  );
  assert.equal(
    githubDnsAccess.Resources.CloudMarkupBetaWebOriginAccessControl.Properties
      .OriginAccessControlConfig.Name,
    "cloudmarkup-beta-web-oac",
  );
  assert.equal(
    githubDnsAccess.Resources.CloudMarkupBetaSecurityHeadersPolicy.Properties
      .ResponseHeadersPolicyConfig.Name,
    "cloudmarkup-beta-security-headers",
  );
  assert.equal(
    githubDnsAccess.Resources.CloudMarkupBetaApiSecurityHeadersPolicy.Properties
      .ResponseHeadersPolicyConfig.Name,
    "cloudmarkup-beta-api-security-headers",
  );
  assert.equal(
    githubDnsAccess.Resources.CloudMarkupBetaAlarmTopic.Properties.TopicName,
    "cloudmarkup-beta-alarms",
  );

  assert.deepEqual(Object.keys(githubDnsAccess.Outputs), [
    "GitHubDeploymentRoleArn",
    "RuntimePermissionsBoundaryArn",
    "FileAssetsBucketName",
    "FilePublishingRoleArn",
    "LookupRoleArn",
    "DeployRoleArn",
    "CloudFormationExecutionRoleArn",
    "WebOriginAccessControlId",
    "SecurityHeadersPolicyId",
    "PublicAssetHeadersPolicyId",
    "ApiSecurityHeadersPolicyId",
    "AlarmTopicArn",
    "ManagedPolicyArn",
  ]);
  assert.equal(
    githubDnsAccess.Outputs.DeployRoleArn.Value,
    "CloudMarkupBetaCdkDeployRole.Arn",
  );
  assert.equal(
    githubDnsAccess.Outputs.CloudFormationExecutionRoleArn.Value,
    "CloudMarkupBetaCloudFormationExecutionRole.Arn",
  );
  assert.deepEqual(githubDnsAccess.Outputs.WebOriginAccessControlId, {
    Description:
      "Fixed beta S3 origin access control imported by the edge stack.",
    Value: "CloudMarkupBetaWebOriginAccessControl.Id",
    Export: { Name: "cloudmarkup-beta-bootstrap:WebOriginAccessControlId" },
  });
  assert.equal(
    githubDnsAccess.Outputs.SecurityHeadersPolicyId.Export.Name,
    "cloudmarkup-beta-bootstrap:SecurityHeadersPolicyId",
  );
  assert.equal(
    githubDnsAccess.Outputs.ApiSecurityHeadersPolicyId.Export.Name,
    "cloudmarkup-beta-bootstrap:ApiSecurityHeadersPolicyId",
  );
  assert.equal(
    githubDnsAccess.Outputs.AlarmTopicArn.Export.Name,
    "cloudmarkup-beta-bootstrap:AlarmTopicArn",
  );
});

test("public asset caching preserves all browser security headers and existing no-store defaults", () => {
  const config = (id) =>
    githubDnsAccess.Resources[id].Properties.ResponseHeadersPolicyConfig;
  const web = config("CloudMarkupBetaSecurityHeadersPolicy");
  const assets = config("CloudMarkupBetaPublicAssetHeadersPolicy");
  const api = config("CloudMarkupBetaApiSecurityHeadersPolicy");
  assert.equal(assets.Name, "cloudmarkup-beta-public-asset-headers");
  assert.deepEqual(assets.SecurityHeadersConfig, web.SecurityHeadersConfig);
  assert.deepEqual(
    assets.CustomHeadersConfig.Items.slice(1),
    web.CustomHeadersConfig.Items.slice(1),
  );
  assert.deepEqual(assets.CustomHeadersConfig.Items[0], {
    Header: "Cache-Control",
    Override: true,
    Value: "public, max-age=31536000, immutable",
  });
  assert.deepEqual(web.CustomHeadersConfig.Items[0], {
    Header: "Cache-Control",
    Override: true,
    Value: "no-store",
  });
  assert.deepEqual(api.CustomHeadersConfig.Items[0], {
    Header: "Cache-Control",
    Override: false,
    Value: "no-store",
  });
  assert.equal(
    githubDnsAccess.Outputs.PublicAssetHeadersPolicyId.Export.Name,
    "cloudmarkup-beta-bootstrap:PublicAssetHeadersPolicyId",
  );
});

test("application-account bootstrap limits CloudFormation execution to four fixed policy families", () => {
  const executionPolicyIds = [
    "CloudMarkupBetaDataExecutionPolicy",
    "CloudMarkupBetaOperationsExecutionPolicy",
    "CloudMarkupBetaApplicationExecutionPolicy",
    "CloudMarkupBetaEdgeExecutionPolicy",
  ];
  for (const logicalId of executionPolicyIds) {
    const policy = githubDnsAccess.Resources[logicalId];
    assert.ok(policy, `missing ${logicalId}`);
    retained(policy);
    assert.equal(policy.Type, "AWS::IAM::ManagedPolicy");
  }

  const execution =
    githubDnsAccess.Resources.CloudMarkupBetaCloudFormationExecutionRole;
  retained(execution);
  assert.equal(execution.Type, "AWS::IAM::Role");
  assert.equal(
    execution.Properties.RoleName,
    "CloudMarkup-Beta-CloudFormation-Execution",
  );
  assert.deepEqual(execution.Properties.AssumeRolePolicyDocument.Statement, [
    {
      Sid: "TrustOnlyCloudFormation",
      Effect: "Allow",
      Principal: { Service: "cloudformation.amazonaws.com" },
      Action: "sts:AssumeRole",
    },
  ]);
  assert.deepEqual(execution.Properties.ManagedPolicyArns, executionPolicyIds);
  assert.ok(!Object.hasOwn(execution.Properties, "Policies"));

  const edgePolicy =
    githubDnsAccess.Resources.CloudMarkupBetaEdgeExecutionPolicy;
  const createDistribution =
    edgePolicy.Properties.PolicyDocument.Statement.find(
      ({ Sid }) => Sid === "CreateTaggedBetaDistribution",
    );
  assert.ok(createDistribution);
  assert.deepEqual(createDistribution.Action, [
    "cloudfront:CreateDistribution",
    "cloudfront:CreateDistributionWithTags",
    "cloudfront:TagResource",
  ]);
  const createCloudFrontFunctions =
    edgePolicy.Properties.PolicyDocument.Statement.find(
      ({ Sid }) => Sid === "CreateTaggedBetaCloudFrontFunctions",
    );
  const namedCloudFrontFunctions =
    edgePolicy.Properties.PolicyDocument.Statement.find(
      ({ Sid }) => Sid === "ManageNamedBetaCloudFrontFunctions",
    );
  assert.deepEqual(createCloudFrontFunctions, {
    Sid: "CreateTaggedBetaCloudFrontFunctions",
    Effect: "Allow",
    Action: ["cloudfront:CreateFunction", "cloudfront:TagResource"],
    Resource: "*",
    Condition: {
      StringEquals: {
        "aws:RequestTag/Environment": "beta",
        "aws:RequestTag/Project": "CloudMarkup",
      },
    },
  });
  assert.ok(
    !namedCloudFrontFunctions.Action.includes("cloudfront:CreateFunction"),
  );

  const dataPolicy =
    githubDnsAccess.Resources.CloudMarkupBetaDataExecutionPolicy;
  const namedSecrets = dataPolicy.Properties.PolicyDocument.Statement.find(
    ({ Sid }) => Sid === "ManageNamedBetaSecrets",
  );
  const secretMaterial = dataPolicy.Properties.PolicyDocument.Statement.find(
    ({ Sid }) => Sid === "GenerateBetaSecretMaterial",
  );
  assert.ok(namedSecrets);
  assert.ok(secretMaterial);
  assert.ok(!namedSecrets.Action.includes("secretsmanager:GetRandomPassword"));
  assert.deepEqual(secretMaterial, {
    Sid: "GenerateBetaSecretMaterial",
    Effect: "Allow",
    Action: "secretsmanager:GetRandomPassword",
    Resource: "*",
    Condition: {
      StringEquals: { "aws:RequestedRegion": "AWS::Region" },
    },
  });
  const namedDatabase = dataPolicy.Properties.PolicyDocument.Statement.find(
    ({ Sid }) => Sid === "ManageNamedBetaDatabase",
  );
  const createCluster = dataPolicy.Properties.PolicyDocument.Statement.find(
    ({ Sid }) => Sid === "CreateExactBetaDatabaseCluster",
  );
  const createInstance = dataPolicy.Properties.PolicyDocument.Statement.find(
    ({ Sid }) => Sid === "CreateExactBetaDatabaseInstance",
  );
  assert.ok(!namedDatabase.Action.includes("rds:CreateDBCluster"));
  assert.ok(!namedDatabase.Action.includes("rds:CreateDBInstance"));
  assert.deepEqual(createCluster.Resource, [
    "arn:${AWS::Partition}:rds:${AWS::Region}:${AWS::AccountId}:cluster:cloudmarkup-beta-postgresql",
    "arn:${AWS::Partition}:rds:${AWS::Region}:${AWS::AccountId}:cluster-pg:default.aurora-postgresql16",
    "arn:${AWS::Partition}:rds:${AWS::Region}:${AWS::AccountId}:og:default:*",
    "arn:${AWS::Partition}:rds:${AWS::Region}:${AWS::AccountId}:subgrp:cloudmarkup-beta-postgresql-subnets",
  ]);
  assert.deepEqual(createInstance.Resource, [
    "arn:${AWS::Partition}:rds:${AWS::Region}:${AWS::AccountId}:cluster:cloudmarkup-beta-postgresql",
    "arn:${AWS::Partition}:rds:${AWS::Region}:${AWS::AccountId}:db:cloudmarkup-beta-postgresql-writer",
    "arn:${AWS::Partition}:rds:${AWS::Region}:${AWS::AccountId}:og:default:*",
    "arn:${AWS::Partition}:rds:${AWS::Region}:${AWS::AccountId}:pg:default.aurora-postgresql16",
    "arn:${AWS::Partition}:rds:${AWS::Region}:${AWS::AccountId}:subgrp:cloudmarkup-beta-postgresql-subnets",
  ]);

  const operationsPolicy =
    githubDnsAccess.Resources.CloudMarkupBetaOperationsExecutionPolicy;
  const namedBudget = operationsPolicy.Properties.PolicyDocument.Statement.find(
    ({ Sid }) => Sid === "ManageNamedBetaBudget",
  );
  assert.deepEqual(namedBudget, {
    Sid: "ManageNamedBetaBudget",
    Effect: "Allow",
    Action: [
      "budgets:ListTagsForResource",
      "budgets:ModifyBudget",
      "budgets:TagResource",
      "budgets:UntagResource",
      "budgets:ViewBudget",
    ],
    Resource:
      "arn:${AWS::Partition}:budgets::${AWS::AccountId}:budget/cloudmarkup-beta-monthly-cost",
  });
  const budgetBillingAuthorization =
    operationsPolicy.Properties.PolicyDocument.Statement.find(
      ({ Sid }) => Sid === "AuthorizeExactBetaBudgetBilling",
    );
  assert.deepEqual(budgetBillingAuthorization, {
    Sid: "AuthorizeExactBetaBudgetBilling",
    Effect: "Allow",
    Action: ["aws-portal:ModifyBilling", "aws-portal:ViewBilling"],
    Resource: "*",
  });
  const bootstrapVersionRead =
    operationsPolicy.Properties.PolicyDocument.Statement.find(
      ({ Sid }) => Sid === "ReadExactBootstrapVersion",
    );
  assert.deepEqual(bootstrapVersionRead, {
    Sid: "ReadExactBootstrapVersion",
    Effect: "Allow",
    Action: ["ssm:GetParameter", "ssm:GetParameters"],
    Resource:
      "arn:${AWS::Partition}:ssm:${AWS::Region}:${AWS::AccountId}:parameter/cloudmarkup/beta/cdk-bootstrap/version",
  });
  assert.equal(
    operationsPolicy.Properties.PolicyDocument.Statement.some(
      ({ Sid }) => Sid === "CreateOnlyTheBudgetsServiceRole",
    ),
    false,
  );

  const applicationPolicy =
    githubDnsAccess.Resources.CloudMarkupBetaApplicationExecutionPolicy;
  const taggedUserPools =
    applicationPolicy.Properties.PolicyDocument.Statement.find(
      ({ Sid }) => Sid === "ManageOnlyTaggedBetaUserPools",
    );
  assert.ok(taggedUserPools);
  assert.ok(
    taggedUserPools.Action.includes("cognito-idp:UpdateUserPoolDomain"),
  );
  assert.deepEqual(
    taggedUserPools.Action.filter((action) =>
      action.includes("ManagedLoginBranding"),
    ),
    [
      "cognito-idp:CreateManagedLoginBranding",
      "cognito-idp:DeleteManagedLoginBranding",
      "cognito-idp:DescribeManagedLoginBranding",
      "cognito-idp:DescribeManagedLoginBrandingByClient",
      "cognito-idp:UpdateManagedLoginBranding",
    ],
  );
  assert.equal(
    taggedUserPools.Resource,
    "arn:${AWS::Partition}:cognito-idp:${AWS::Region}:${AWS::AccountId}:userpool/*",
  );
  assert.deepEqual(taggedUserPools.Condition, {
    StringEquals: {
      "aws:ResourceTag/Environment": "beta",
      "aws:ResourceTag/Project": "CloudMarkup",
    },
  });
  const newUserPoolTags =
    applicationPolicy.Properties.PolicyDocument.Statement.find(
      ({ Sid }) => Sid === "TagNewBetaUserPools",
    );
  assert.deepEqual(newUserPoolTags, {
    Sid: "TagNewBetaUserPools",
    Effect: "Allow",
    Action: "cognito-idp:TagResource",
    Resource:
      "arn:${AWS::Partition}:cognito-idp:${AWS::Region}:${AWS::AccountId}:userpool/*",
    Condition: {
      StringEquals: {
        "aws:RequestTag/Environment": "beta",
        "aws:RequestTag/Project": "CloudMarkup",
      },
    },
  });
  const apiGatewayTags =
    applicationPolicy.Properties.PolicyDocument.Statement.find(
      ({ Sid }) => Sid === "ManageBetaApiGatewayTags",
    );
  assert.deepEqual(apiGatewayTags.Action, [
    "apigateway:DELETE",
    "apigateway:GET",
    "apigateway:POST",
    "apigateway:PUT",
  ]);
  assert.equal(
    apiGatewayTags.Resource,
    "arn:${AWS::Partition}:apigateway:${AWS::Region}::/tags/*",
  );
  const regionalWebAcl =
    applicationPolicy.Properties.PolicyDocument.Statement.find(
      ({ Sid }) => Sid === "ManageNamedRegionalWebAcl",
    );
  const regionalWebAclRead =
    applicationPolicy.Properties.PolicyDocument.Statement.find(
      ({ Sid }) => Sid === "ReadRegionalWebAclAssociation",
    );
  assert.ok(regionalWebAcl);
  assert.ok(regionalWebAclRead);
  assert.ok(!regionalWebAcl.Action.includes("wafv2:GetWebACLForResource"));
  assert.deepEqual(regionalWebAclRead, {
    Sid: "ReadRegionalWebAclAssociation",
    Effect: "Allow",
    Action: "wafv2:GetWebACLForResource",
    Resource: [
      "arn:${AWS::Partition}:wafv2:${AWS::Region}:${AWS::AccountId}:regional/webacl/*/*",
    ],
  });
  const namedFunctions =
    applicationPolicy.Properties.PolicyDocument.Statement.find(
      ({ Sid }) => Sid === "ManageNamedBetaFunctions",
    );
  assert.ok(
    namedFunctions.Action.includes("lambda:GetFunctionRecursionConfig"),
  );
  assert.ok(namedFunctions.Action.includes("lambda:GetFunctionScalingConfig"));
  const managedLayers =
    applicationPolicy.Properties.PolicyDocument.Statement.find(
      ({ Sid }) => Sid === "ManageNamedBetaLayers",
    );
  assert.deepEqual(managedLayers.Action, [
    "lambda:DeleteLayerVersion",
    "lambda:GetLayerVersion",
  ]);
  assert.deepEqual(managedLayers.Resource, [
    "arn:${AWS::Partition}:lambda:${AWS::Region}:${AWS::AccountId}:layer:cloudmarkup-beta-*:*",
    "arn:${AWS::Partition}:lambda:${AWS::Region}:${AWS::AccountId}:layer:DeployWebAssetsAwsCliLayer*:*",
  ]);
  const listedLayers =
    applicationPolicy.Properties.PolicyDocument.Statement.find(
      ({ Action }) => Action === "lambda:ListLayerVersions",
    );
  assert.deepEqual(listedLayers, {
    Effect: "Allow",
    Action: "lambda:ListLayerVersions",
    Resource: "*",
    Condition: {
      StringEquals: { "aws:RequestedRegion": "AWS::Region" },
    },
  });
  const publishedLayers =
    applicationPolicy.Properties.PolicyDocument.Statement.find(
      ({ Action }) => Action === "lambda:PublishLayerVersion",
    );
  assert.equal(publishedLayers.Action, "lambda:PublishLayerVersion");
  assert.deepEqual(publishedLayers.Resource, [
    "arn:${AWS::Partition}:lambda:${AWS::Region}:${AWS::AccountId}:layer:cloudmarkup-beta-*",
    "arn:${AWS::Partition}:lambda:${AWS::Region}:${AWS::AccountId}:layer:DeployWebAssetsAwsCliLayer*",
  ]);
  const pass = applicationPolicy.Properties.PolicyDocument.Statement.find(
    ({ Sid }) => Sid === "PassFixedBootstrapRuntimeRoles",
  );
  assert.ok(pass);
  assert.equal(pass.Action, "iam:PassRole");
  assert.deepEqual(pass.Resource, [
    "CloudMarkupBetaApiRuntimeRole.Arn",
    "CloudMarkupBetaDatabaseMigratorRuntimeRole.Arn",
    "CloudMarkupBetaApiGatewayLoggingRole.Arn",
    "CloudMarkupBetaWebDeploymentRuntimeRole.Arn",
    "CloudMarkupBetaProjectCleanupRuntimeRole.Arn",
  ]);
  assert.deepEqual(pass.Condition, {
    StringEquals: {
      "iam:PassedToService": [
        "apigateway.amazonaws.com",
        "lambda.amazonaws.com",
      ],
    },
  });
});

test("application-account deploy role can use only four beta stacks, fixed execution, and reviewed assets", () => {
  const deploy = githubDnsAccess.Resources.CloudMarkupBetaCdkDeployRole;
  retained(deploy);
  assert.equal(deploy.Type, "AWS::IAM::Role");
  assert.equal(deploy.Properties.RoleName, "CloudMarkup-Beta-CDK-Deploy");
  assert.deepEqual(deploy.Properties.AssumeRolePolicyDocument.Statement, [
    {
      Sid: "TrustExactCloudMarkupBetaGitHubRole",
      Effect: "Allow",
      Principal: { AWS: "CloudMarkupBetaGitHubRole.Arn" },
      Action: "sts:AssumeRole",
    },
  ]);
  assert.equal(deploy.Properties.Policies.length, 1);

  const mutate = statementBySid(deploy, "MutateOnlyFourBetaStacks");
  const changeSets = statementBySid(deploy, "ManageOnlyCdkDeployChangeSets");
  const read = statementBySid(deploy, "ReadOnlyFourBetaStacks");
  assert.deepEqual(mutate.Resource, betaStackArns);
  assert.deepEqual(changeSets.Action, [
    "cloudformation:DeleteChangeSet",
    "cloudformation:DescribeChangeSet",
    "cloudformation:ExecuteChangeSet",
  ]);
  assert.deepEqual(changeSets.Resource, betaStackArns);
  assert.deepEqual(changeSets.Condition, {
    StringLike: {
      "cloudformation:ChangeSetName": betaChangeSetNames,
    },
  });
  assert.deepEqual(read.Action, [
    "cloudformation:DescribeChangeSet",
    "cloudformation:DescribeStackEvents",
    "cloudformation:DescribeStackResource",
    "cloudformation:DescribeStackResources",
    "cloudformation:DescribeStacks",
    "cloudformation:GetTemplate",
    "cloudformation:ListChangeSets",
    "cloudformation:ListStackResources",
  ]);
  assert.deepEqual(read.Resource, betaStackArns);

  const tag = statementBySid(
    deploy,
    "TagOnlyDuringReviewedCdkChangeSetActions",
  );
  assert.deepEqual(tag.Action, [
    "cloudformation:TagResource",
    "cloudformation:UntagResource",
  ]);
  assert.deepEqual(tag.Resource, [
    ...betaStackArns,
    "arn:${AWS::Partition}:cloudformation:${AWS::Region}:${AWS::AccountId}:changeSet/cdk-deploy-change-set/*",
  ]);
  assert.deepEqual(tag.Condition, {
    StringEquals: {
      "cloudformation:CreateAction": ["CreateChangeSet", "ExecuteChangeSet"],
    },
  });

  const pass = statementBySid(deploy, "PassOnlyTheFixedExecutionRole");
  assert.equal(pass.Action, "iam:PassRole");
  assert.equal(pass.Resource, "CloudMarkupBetaCloudFormationExecutionRole.Arn");
  assert.deepEqual(pass.Condition, {
    StringEquals: {
      "iam:PassedToService": "cloudformation.amazonaws.com",
    },
  });

  const assets = statementBySid(deploy, "ReadReviewedBetaAssets");
  assert.deepEqual(assets.Resource, [
    "CloudMarkupBetaCdkAssets.Arn",
    "${CloudMarkupBetaCdkAssets.Arn}/assets/*",
  ]);
});

test("application-account CI and execution policies cannot create or rewrite IAM roles", () => {
  const controlPlaneResources = [
    "CloudMarkupBetaGitHubRole",
    "CloudMarkupBetaCdkFilePublishingRole",
    "CloudMarkupBetaCdkLookupRole",
    "CloudMarkupBetaCdkDeployRole",
    "CloudMarkupBetaDataExecutionPolicy",
    "CloudMarkupBetaOperationsExecutionPolicy",
    "CloudMarkupBetaApplicationExecutionPolicy",
    "CloudMarkupBetaEdgeExecutionPolicy",
  ].map((logicalId) => githubDnsAccess.Resources[logicalId]);
  const actions = actionsOf(controlPlaneResources);
  const normalizedActions = new Set(
    [...actions].map((action) => action.toLowerCase()),
  );
  for (const action of [
    "iam:createrole",
    "iam:updateassumerolepolicy",
    "iam:putrolepolicy",
  ]) {
    assert.ok(
      !normalizedActions.has(action),
      `forbidden control-plane action ${action}`,
    );
  }
  assert.deepEqual(
    [...normalizedActions].filter((action) => action.startsWith("iam:")).sort(),
    ["iam:createservicelinkedrole", "iam:getrole", "iam:passrole"],
  );
  const loggingRoleRead = githubDnsAccess.Resources[
    "CloudMarkupBetaApplicationExecutionPolicy"
  ].Properties.PolicyDocument.Statement.find(
    ({ Sid }) => Sid === "ReadFixedApiGatewayLoggingRole",
  );
  assert.deepEqual(loggingRoleRead, {
    Action: "iam:GetRole",
    Effect: "Allow",
    Resource: "CloudMarkupBetaApiGatewayLoggingRole.Arn",
    Sid: "ReadFixedApiGatewayLoggingRole",
  });

  const authorizationProjection = Object.fromEntries(
    Object.entries(githubDnsAccess.Resources)
      .filter(([, resource]) =>
        ["AWS::IAM::ManagedPolicy", "AWS::IAM::Role"].includes(resource.Type),
      )
      .map(([logicalId, resource]) => [
        logicalId,
        {
          AssumeRolePolicyDocument:
            resource.Properties.AssumeRolePolicyDocument,
          ManagedPolicyArns: resource.Properties.ManagedPolicyArns,
          Policies: resource.Properties.Policies,
          PolicyDocument: resource.Properties.PolicyDocument,
        },
      ]),
  );
  const serialized = JSON.stringify(authorizationProjection);
  assert.ok(
    !/(?:hnb659fds|administratoraccess|poweruseraccess)/iu.test(serialized),
    "default or broad managed access must not enter beta authorization",
  );
});

test("DNS bootstrap creates only retained least-privilege roles for the exact zone", () => {
  assert.equal(dnsBootstrap.Parameters.HostedZoneId.Default, hostedZoneId);
  assert.deepEqual(dnsBootstrap.Parameters.HostedZoneId.AllowedValues, [
    hostedZoneId,
  ]);
  assert.deepEqual(
    dnsBootstrap.Parameters.ApplicationDeploymentRoleArn.AllowedValues,
    [applicationRoleArn],
  );
  assert.deepEqual(
    Object.values(dnsBootstrap.Resources).map(({ Type }) => Type),
    ["AWS::IAM::Role", "AWS::IAM::Role"],
  );

  const execution = dnsBootstrap.Resources.CloudMarkupBetaDnsCloudFormationRole;
  const delivery = dnsBootstrap.Resources.CloudMarkupBetaDnsRole;
  retained(execution);
  retained(delivery);
  assert.equal(
    execution.Properties.RoleName,
    "CloudMarkup-Beta-DNS-CloudFormation",
  );
  assert.equal(delivery.Properties.RoleName, "CloudMarkup-Beta-DNS");
  assert.deepEqual(
    execution.Properties.AssumeRolePolicyDocument.Statement[0].Principal,
    { Service: "cloudformation.amazonaws.com" },
  );
  assert.equal(
    execution.Properties.AssumeRolePolicyDocument.Statement[0].Action,
    "sts:AssumeRole",
  );
  assert.deepEqual(
    delivery.Properties.AssumeRolePolicyDocument.Statement[0].Principal,
    { AWS: "ApplicationDeploymentRoleArn" },
  );
  assert.deepEqual(
    delivery.Properties.AssumeRolePolicyDocument.Statement[0].Action,
    ["sts:AssumeRole", "sts:TagSession"],
  );
  assert.ok(!JSON.stringify(delivery).includes("route53:"));
  assert.ok(!JSON.stringify(dnsBootstrap).includes("AWS::Route53::HostedZone"));
  assert.ok(!JSON.stringify(dnsBootstrap).includes("AWS::Route53::RecordSet"));
});

test("delivery role can update only the exact records stack and pass only its execution role", () => {
  const delivery = dnsBootstrap.Resources.CloudMarkupBetaDnsRole;
  const update = statementBySid(delivery, "UpdateAndReadExactDnsRecordsStack");
  assert.equal(update.Resource, dnsRecordsStackArn);
  assert.deepEqual(asArray(update.Action).sort(), [
    "cloudformation:DescribeStackEvents",
    "cloudformation:DescribeStacks",
    "cloudformation:GetTemplate",
    "cloudformation:UpdateStack",
  ]);
  const pass = statementBySid(
    delivery,
    "PassExactDnsCloudFormationExecutionRole",
  );
  assert.equal(pass.Action, "iam:PassRole");
  assert.equal(pass.Resource, "CloudMarkupBetaDnsCloudFormationRole.Arn");
  assert.deepEqual(pass.Condition, {
    StringEquals: {
      "iam:PassedToService": "cloudformation.amazonaws.com",
    },
  });
});

test("CloudFormation execution role is bounded to exact beta aliases and validation CNAMEs", () => {
  const execution = dnsBootstrap.Resources.CloudMarkupBetaDnsCloudFormationRole;
  const verify = statementBySid(execution, "VerifyExactHostedZone");
  assert.deepEqual(asArray(verify.Action).sort(), [
    "route53:GetHostedZone",
    "route53:ListResourceRecordSets",
  ]);
  assert.equal(verify.Resource, hostedZoneArn);

  const aliases = statementBySid(execution, "ManageExactBetaAliases");
  const aliasCondition = aliases.Condition["ForAllValues:StringEquals"];
  assert.equal(aliases.Resource, hostedZoneArn);
  assert.deepEqual(
    aliasCondition["route53:ChangeResourceRecordSetsNormalizedRecordNames"],
    ["beta.example.invalid"],
  );
  assert.deepEqual(
    aliasCondition["route53:ChangeResourceRecordSetsRecordTypes"],
    ["A", "AAAA"],
  );

  const validation = statementBySid(
    execution,
    "ManageBetaCertificateValidationCname",
  );
  assert.equal(validation.Resource, hostedZoneArn);
  assert.deepEqual(
    validation.Condition["ForAllValues:StringLike"][
      "route53:ChangeResourceRecordSetsNormalizedRecordNames"
    ],
    ["_*.beta.example.invalid"],
  );
  assert.deepEqual(
    validation.Condition["ForAllValues:StringEquals"][
      "route53:ChangeResourceRecordSetsRecordTypes"
    ],
    ["CNAME"],
  );
  assert.ok(
    statements(execution).every(
      ({ Action, Resource }) =>
        Action !== "route53:ChangeResourceRecordSets" ||
        Resource === hostedZoneArn,
    ),
  );
});

test("records stack retains validation and output-bound CloudFront aliases", () => {
  assert.equal(dnsRecords.Parameters.HostedZoneId.Default, hostedZoneId);
  assert.deepEqual(dnsRecords.Parameters.HostedZoneId.AllowedValues, [
    hostedZoneId,
  ]);
  assert.ok(
    !Object.hasOwn(
      dnsRecords.Parameters.CertificateValidationRecordName,
      "Default",
    ),
  );
  assert.ok(
    !Object.hasOwn(
      dnsRecords.Parameters.CertificateValidationRecordValue,
      "Default",
    ),
  );
  const validationValuePattern = new RegExp(
    dnsRecords.Parameters.CertificateValidationRecordValue.AllowedPattern,
    "u",
  );
  assert.equal(
    validationValuePattern.test("_0123456789abcdef.acm-validations.aws."),
    true,
  );
  assert.equal(
    validationValuePattern.test(
      "_47d083ff21d95424e53dd4c4c7be438f.jkddzztszm.acm-validations.aws.",
    ),
    true,
  );
  assert.equal(validationValuePattern.test("example.invalid."), false);

  const validation = dnsRecords.Resources.CertificateValidationRecord;
  retained(validation);
  assert.equal(validation.Type, "AWS::Route53::RecordSet");
  assert.ok(!Object.hasOwn(validation, "Condition"));
  assert.deepEqual(validation.Properties, {
    HostedZoneId: "HostedZoneId",
    Name: "CertificateValidationRecordName",
    ResourceRecords: ["CertificateValidationRecordValue"],
    TTL: "300",
    Type: "CNAME",
  });

  for (const [logicalId, type] of [
    ["BetaAliasIpv4", "A"],
    ["BetaAliasIpv6", "AAAA"],
  ]) {
    const alias = dnsRecords.Resources[logicalId];
    retained(alias);
    assert.equal(alias.Type, "AWS::Route53::RecordSet");
    assert.equal(alias.Condition, "HasCloudFrontAliasTarget");
    assert.equal(alias.Properties.Name, "beta.example.invalid");
    assert.equal(alias.Properties.Type, type);
    assert.deepEqual(alias.Properties.AliasTarget, {
      DNSName: "CloudFrontDomainName",
      EvaluateTargetHealth: false,
      HostedZoneId: "Z2FDTNDATAQYW2",
    });
  }
  assert.equal(
    dnsRecords.Outputs.CertificateValidationRecordName.Value,
    "CertificateValidationRecordName",
  );
  assert.equal(dnsRecords.Outputs.AliasTarget.Value, "CloudFrontDomainName");
  assert.ok(!JSON.stringify(dnsRecords).includes("AWS::Route53::HostedZone"));
});
