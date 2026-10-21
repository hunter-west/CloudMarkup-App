import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { Template } from "aws-cdk-lib/assertions";
import { beforeAll, describe, expect, test } from "vitest";

import { BETA_CDK_BOOTSTRAP } from "../lib/beta-deployment-bootstrap.js";
import { defineEnvironmentConfig } from "../lib/config/environment-config.js";
import { createBetaEnvironmentConfig } from "../lib/config/environments/beta.js";
import { createDevEnvironmentConfig } from "../lib/config/environments/dev.js";
import { createProdEnvironmentConfig } from "../lib/config/environments/prod.js";
import { createPlatformResourceNames } from "../lib/platform-names.js";
import {
  DATABASE_MIGRATION_EXPECTED_VERSION,
  DATABASE_MIGRATION_MANIFEST_SHA256,
} from "../lib/stacks/application-stack.js";
import { BETA_DATABASE_NETWORK } from "../lib/stacks/stateful-stack.js";
import { CloudMarkupStage } from "../lib/stages/cloudmarkup-stage.js";
import { createTemplateTestApp } from "./template-test-app.js";

interface SynthResource {
  readonly DeletionPolicy?: unknown;
  readonly DependsOn?: unknown;
  readonly Properties?: unknown;
  readonly UpdateReplacePolicy?: unknown;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function resourceList(template: Template, type: string): SynthResource[] {
  return Object.values(template.findResources(type));
}

function properties(resource: SynthResource): Record<string, unknown> {
  return record(resource.Properties, "resource properties");
}

function betaRoleArn(roleName: string): Record<string, unknown> {
  return {
    "Fn::Join": [
      "",
      [
        "arn:",
        { Ref: "AWS::Partition" },
        `:iam::000000000000:role/${roleName}`,
      ],
    ],
  };
}

function devStage(id = "PlatformFixture"): CloudMarkupStage {
  return new CloudMarkupStage(createTemplateTestApp(), id, {
    config: createDevEnvironmentConfig(),
  });
}

function betaStage(id = "BetaPlatformFixture"): CloudMarkupStage {
  return new CloudMarkupStage(createTemplateTestApp(), id, {
    config: createBetaEnvironmentConfig({
      domain: {
        certificateArn:
          "arn:aws:acm:us-east-1:000000000000:certificate/11111111-2222-3333-4444-555555555555",
        createDnsRecords: false,
        domainName: "beta.example.invalid",
      },
      target: { account: "000000000000", region: "us-east-1" },
    }),
    webAssetsPath: fileURLToPath(
      new URL("fixtures/web-dist/", import.meta.url),
    ),
  });
}

test("binds the checked migration contract to exact repository bytes", () => {
  const manifest = readFileSync(
    fileURLToPath(
      new URL("../../../apps/api/migrations/manifest.json", import.meta.url),
    ),
  );
  expect(DATABASE_MIGRATION_EXPECTED_VERSION).toBe("0138");
  expect(createHash("sha256").update(manifest).digest("hex")).toBe(
    DATABASE_MIGRATION_MANIFEST_SHA256,
  );
});

function propertyObjects(
  template: Template,
  type: string,
): Record<string, unknown>[] {
  return resourceList(template, type).map(properties);
}

function restMethodsByRoute(
  template: Template,
): ReadonlyMap<string, Record<string, unknown>> {
  const resources = new Map(
    Object.entries(template.findResources("AWS::ApiGateway::Resource")).map(
      ([logicalId, resource]) => [logicalId, properties(resource)],
    ),
  );
  const paths = new Map<string, string>();
  const pathFor = (logicalId: string): string => {
    const cached = paths.get(logicalId);
    if (cached !== undefined) return cached;
    const resource = resources.get(logicalId);
    if (resource === undefined) {
      throw new TypeError(`REST resource ${logicalId} was not found.`);
    }
    const pathPart = resource["PathPart"];
    if (typeof pathPart !== "string") {
      throw new TypeError(`REST resource ${logicalId} has no path part.`);
    }
    const parent = record(resource["ParentId"], "REST parent resource");
    const parentRef = parent["Ref"];
    const parentPath =
      typeof parentRef === "string" && resources.has(parentRef)
        ? pathFor(parentRef)
        : "";
    const path = `${parentPath}/${pathPart}`;
    paths.set(logicalId, path);
    return path;
  };
  return new Map(
    Object.values(template.findResources("AWS::ApiGateway::Method")).map(
      (method) => {
        const methodProperties = properties(method);
        const resourceRef = record(
          methodProperties["ResourceId"],
          "REST method resource",
        )["Ref"];
        const httpMethod = methodProperties["HttpMethod"];
        if (typeof resourceRef !== "string" || typeof httpMethod !== "string") {
          throw new TypeError(
            "REST method must reference a resource and verb.",
          );
        }
        return [
          `${httpMethod} ${pathFor(resourceRef)}`,
          methodProperties,
        ] as const;
      },
    ),
  );
}

function policyStatementsForRole(
  template: Template,
  roleLogicalIdFragment: string,
): Record<string, unknown>[] {
  return propertyObjects(template, "AWS::IAM::Policy")
    .filter((policy) =>
      JSON.stringify(policy["Roles"]).includes(roleLogicalIdFragment),
    )
    .flatMap((policy) => {
      const document = record(policy["PolicyDocument"], "policy document");
      const statements = document["Statement"];
      if (!Array.isArray(statements)) {
        throw new TypeError("an IAM policy must contain statements.");
      }
      return statements.map((statement: unknown) =>
        record(statement, "policy statement"),
      );
    });
}

interface DevFixture {
  readonly application: Template;
  readonly edge: Template;
  readonly observability: Template;
  readonly stage: CloudMarkupStage;
  readonly stateful: Template;
}

let devFixture: DevFixture;

beforeAll(() => {
  const stage = devStage();
  devFixture = {
    application: Template.fromStack(stage.application),
    edge: Template.fromStack(stage.edge),
    observability: Template.fromStack(stage.observability),
    stage,
    stateful: Template.fromStack(stage.stateful),
  };
}, 120_000);

describe("CloudMarkup platform security and lifecycle", () => {
  test("blocks public access and encrypts every owned bucket", () => {
    const buckets = [
      ...propertyObjects(devFixture.stateful, "AWS::S3::Bucket"),
      ...propertyObjects(devFixture.edge, "AWS::S3::Bucket"),
    ];

    expect(buckets.length).toBeGreaterThanOrEqual(3);
    for (const bucket of buckets) {
      expect(bucket["BucketEncryption"]).toBeDefined();
      expect(bucket["PublicAccessBlockConfiguration"]).toEqual({
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      });
    }
  });

  test("retains documents and evidence while expiring only replaceable artifacts", () => {
    const names = createPlatformResourceNames(
      "dev",
      createDevEnvironmentConfig().target,
    );
    const contentBucket = propertyObjects(
      devFixture.stateful,
      "AWS::S3::Bucket",
    ).find((bucket) => bucket["BucketName"] === names.contentBucket);

    expect(contentBucket).toBeDefined();
    const lifecycle = record(
      contentBucket?.["LifecycleConfiguration"],
      "content lifecycle",
    );
    const rules = lifecycle["Rules"];
    expect(Array.isArray(rules)).toBe(true);
    expect(rules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ExpirationInDays: 30,
          Id: "ExpireReplaceableArtifactsOnly",
          Prefix: names.artifactPrefix,
          Status: "Enabled",
        }),
      ]),
    );
    const serializedRules = JSON.stringify(rules);
    expect(serializedRules).not.toContain(names.documentPrefix);
    expect(serializedRules).not.toContain(names.evidencePrefix);
  });

  test("uses Data API Aurora and production-safe resource and stack protection", () => {
    const target = { account: "111122223333", region: "us-east-1" };
    const config = createProdEnvironmentConfig(target);
    const stage = new CloudMarkupStage(
      createTemplateTestApp(),
      "ProductionFixture",
      { config },
    );
    const platformStacks = [
      stage.observability,
      stage.stateful,
      stage.application,
      stage.edge,
    ];
    for (const stack of platformStacks) {
      expect(stack.terminationProtection).toBe(true);
    }
    expect(devFixture.stage.stateful.terminationProtection).toBe(false);

    const template = Template.fromStack(stage.stateful);
    const clusters = resourceList(template, "AWS::RDS::DBCluster");
    expect(clusters).toHaveLength(1);
    const cluster = clusters[0];
    if (cluster === undefined) {
      throw new TypeError("the production template must contain one cluster.");
    }
    expect(properties(cluster)).toEqual(
      expect.objectContaining({
        DeletionProtection: true,
        EnableHttpEndpoint: true,
        Engine: "aurora-postgresql",
        ServerlessV2ScalingConfiguration: {
          MaxCapacity: 8,
          MinCapacity: 0.5,
        },
        StorageEncrypted: true,
      }),
    );
    expect(cluster.DeletionPolicy).toBe("RetainExceptOnCreate");
    expect(cluster.UpdateReplacePolicy).toBe("Retain");
    for (const bucket of resourceList(template, "AWS::S3::Bucket")) {
      expect(bucket.DeletionPolicy).toBe("RetainExceptOnCreate");
      expect(bucket.UpdateReplacePolicy).toBe("Retain");
    }

    const application = Template.fromStack(stage.application);
    application.hasResourceProperties("AWS::Cognito::UserPool", {
      DeletionProtection: "ACTIVE",
    });
  }, 30_000);

  test("composes a durable beta with private web deployment, invalidation, auth, DNS metadata, and safe outputs", () => {
    const stage = betaStage();
    for (const stack of [
      stage.observability,
      stage.stateful,
      stage.application,
      stage.edge,
    ]) {
      expect(stack.terminationProtection).toBe(true);
      expect(stack.synthesizer.bootstrapQualifier).toBe(
        BETA_CDK_BOOTSTRAP.qualifier,
      );
      expect(stack.synthesizer.lookupRole).toBe(
        "arn:aws:iam::000000000000:role/CloudMarkup-Beta-CDK-Lookup",
      );
      expect(stack.synthesizer.cloudFormationExecutionRole).toBe(
        "arn:aws:iam::000000000000:role/CloudMarkup-Beta-CloudFormation-Execution",
      );
    }
    expect(BETA_CDK_BOOTSTRAP).toEqual({
      betaProposalWorkerRuntimeRoleName:
        "CloudMarkup-Beta-Proposal-Worker-Runtime",
      billingWebhookRuntimeRoleName: "CloudMarkup-Beta-Billing-Webhook-Runtime",
      billingWorkerRuntimeRoleName: "CloudMarkup-Beta-Billing-Worker-Runtime",
      solutionExportWorkerRuntimeRoleName:
        "CloudMarkup-Beta-Solution-Export-Worker-Runtime",
      projectCleanupRuntimeRoleName: "CloudMarkup-Beta-Project-Cleanup-Runtime",
      apiGatewayLoggingRoleArn:
        "arn:aws:iam::${AWS::AccountId}:role/cloudmarkup-beta-api-gateway-logging",
      apiGatewayLoggingRoleName: "cloudmarkup-beta-api-gateway-logging",
      apiRuntimeRoleArn:
        "arn:aws:iam::${AWS::AccountId}:role/CloudMarkup-Beta-API-Runtime",
      apiRuntimeRoleName: "CloudMarkup-Beta-API-Runtime",
      apiSecurityHeadersPolicyIdExportName:
        "cloudmarkup-beta-bootstrap:ApiSecurityHeadersPolicyId",
      bootstrapVersionParameter: "/cloudmarkup/beta/cdk-bootstrap/version",
      cloudFormationExecutionRoleArn:
        "arn:aws:iam::${AWS::AccountId}:role/CloudMarkup-Beta-CloudFormation-Execution",
      deployRoleArn:
        "arn:aws:iam::${AWS::AccountId}:role/CloudMarkup-Beta-CDK-Deploy",
      fileAssetPublishingRoleArn:
        "arn:aws:iam::${AWS::AccountId}:role/CloudMarkup-Beta-CDK-File-Publishing",
      fileAssetsBucketName:
        "cloudmarkup-beta-cdk-assets-${AWS::AccountId}-${AWS::Region}",
      lookupRoleArn:
        "arn:aws:iam::${AWS::AccountId}:role/CloudMarkup-Beta-CDK-Lookup",
      databaseMigratorRuntimeRoleArn:
        "arn:aws:iam::${AWS::AccountId}:role/CloudMarkup-Beta-Database-Migrator-Runtime",
      databaseMigratorRuntimeRoleName:
        "CloudMarkup-Beta-Database-Migrator-Runtime",
      publicAssetHeadersPolicyIdExportName:
        "cloudmarkup-beta-bootstrap:PublicAssetHeadersPolicyId",
      qualifier: "cmkbeta",
      runtimePermissionsBoundaryArn:
        "arn:aws:iam::${AWS::AccountId}:policy/CloudMarkup-Beta-Runtime-Boundary",
      securityHeadersPolicyIdExportName:
        "cloudmarkup-beta-bootstrap:SecurityHeadersPolicyId",
      webDeploymentRuntimeRoleArn:
        "arn:aws:iam::${AWS::AccountId}:role/CloudMarkup-Beta-Web-Deployment-Runtime",
      webDeploymentRuntimeRoleName: "CloudMarkup-Beta-Web-Deployment-Runtime",
      webOriginAccessControlIdExportName:
        "cloudmarkup-beta-bootstrap:WebOriginAccessControlId",
    });

    const stateful = Template.fromStack(stage.stateful);
    const cluster = resourceList(stateful, "AWS::RDS::DBCluster")[0];
    if (cluster === undefined) {
      throw new TypeError("the beta template must contain one cluster");
    }
    expect(properties(cluster)).toEqual(
      expect.objectContaining({
        BackupRetentionPeriod: 14,
        CopyTagsToSnapshot: true,
        DeletionProtection: true,
        DeleteAutomatedBackups: false,
        EnableHttpEndpoint: true,
        MasterUsername: "cloudmarkup_admin",
        ServerlessV2ScalingConfiguration: {
          MaxCapacity: 4,
          MinCapacity: 0.5,
        },
        StorageEncrypted: true,
      }),
    );
    expect(properties(cluster)).not.toHaveProperty("PubliclyAccessible");
    expect(
      record(
        properties(cluster)["DBSubnetGroupName"],
        "database subnet group reference",
      )["Ref"],
    ).toEqual(expect.stringContaining("PostgresqlSubnetGroup"));
    expect(properties(cluster)["VpcSecurityGroupIds"]).toEqual([
      BETA_DATABASE_NETWORK.defaultSecurityGroupId,
    ]);
    expect(JSON.stringify(properties(cluster)["MasterUserPassword"])).toContain(
      "DatabaseAdmin",
    );
    expect(cluster.DeletionPolicy).toBe("RetainExceptOnCreate");
    expect(cluster.UpdateReplacePolicy).toBe("Retain");
    stateful.resourceCountIs("AWS::RDS::DBSubnetGroup", 1);
    const subnetGroup = resourceList(stateful, "AWS::RDS::DBSubnetGroup")[0];
    expect(properties(subnetGroup ?? {})).toEqual(
      expect.objectContaining({
        DBSubnetGroupName: "cloudmarkup-beta-postgresql-subnets",
        SubnetIds: [...BETA_DATABASE_NETWORK.subnetIds],
      }),
    );
    expect(subnetGroup?.DeletionPolicy).toBe("RetainExceptOnCreate");
    expect(subnetGroup?.UpdateReplacePolicy).toBe("Retain");
    stateful.resourceCountIs("AWS::EC2::VPC", 0);
    stateful.resourceCountIs("AWS::EC2::Subnet", 0);
    stateful.resourceCountIs("AWS::EC2::RouteTable", 0);
    stateful.resourceCountIs("AWS::EC2::SubnetRouteTableAssociation", 0);
    stateful.resourceCountIs("AWS::EC2::SecurityGroup", 0);
    const betaWriter = resourceList(stateful, "AWS::RDS::DBInstance")[0];
    expect(properties(betaWriter ?? {})).toEqual(
      expect.objectContaining({
        DBInstanceClass: "db.serverless",
        PubliclyAccessible: false,
      }),
    );
    stateful.resourceCountIs("AWS::SecretsManager::SecretTargetAttachment", 1);
    expect(
      resourceList(stateful, "AWS::SecretsManager::Secret").some(
        (resource) =>
          properties(resource)["Name"] === "cloudmarkup-beta/database/admin",
      ),
    ).toBe(true);
    for (const bucket of resourceList(stateful, "AWS::S3::Bucket")) {
      expect(properties(bucket)["VersioningConfiguration"]).toEqual({
        Status: "Enabled",
      });
      expect(bucket.DeletionPolicy).toBe("RetainExceptOnCreate");
      expect(bucket.UpdateReplacePolicy).toBe("Retain");
    }
    const edgeOriginSecret = resourceList(
      stateful,
      "AWS::SecretsManager::Secret",
    ).find(
      (resource) =>
        properties(resource)["Name"] ===
        "cloudmarkup-beta/edge/origin-verification",
    );
    expect(edgeOriginSecret).toBeDefined();
    if (edgeOriginSecret === undefined) {
      throw new TypeError("the beta template must contain an origin secret");
    }
    expect(properties(edgeOriginSecret)).toEqual(
      expect.objectContaining({
        GenerateSecretString: {
          ExcludePunctuation: true,
          IncludeSpace: false,
          PasswordLength: 64,
        },
      }),
    );
    expect(edgeOriginSecret.DeletionPolicy).toBe("RetainExceptOnCreate");
    expect(edgeOriginSecret.UpdateReplacePolicy).toBe("Retain");

    const application = Template.fromStack(stage.application);
    const userPool = resourceList(application, "AWS::Cognito::UserPool")[0];
    expect(properties(userPool ?? {})).toEqual(
      expect.objectContaining({ DeletionProtection: "INACTIVE" }),
    );
    expect(userPool?.DeletionPolicy).toBe("RetainExceptOnCreate");
    expect(userPool?.UpdateReplacePolicy).toBe("Retain");
    application.resourceCountIs("AWS::Cognito::UserPoolDomain", 1);
    application.hasResourceProperties("AWS::Cognito::UserPoolDomain", {
      ManagedLoginVersion: 2,
    });
    application.resourceCountIs("AWS::CodeBuild::Project", 0);
    application.resourceCountIs("AWS::EC2::VPCEndpoint", 0);
    application.resourceCountIs("AWS::SQS::Queue", 0);
    application.resourceCountIs("AWS::StepFunctions::StateMachine", 0);
    application.resourceCountIs("AWS::CloudFormation::CustomResource", 1);
    const edgeTemplate = Template.fromStack(stage.edge);
    for (const template of [stateful, application, edgeTemplate]) {
      template.resourceCountIs("AWS::IAM::Role", 0);
      template.resourceCountIs("AWS::IAM::Policy", 0);
    }
    const applicationJson = record(
      application.toJSON(),
      "beta application template",
    );
    const applicationOutputs = record(
      applicationJson["Outputs"],
      "beta application outputs",
    );
    expect(Object.keys(applicationOutputs)).toEqual(
      expect.arrayContaining([
        "CognitoCallbackUrl",
        "CognitoDomain",
        "CognitoLogoutUrl",
        "CognitoPublicClientId",
        "CognitoUserPoolId",
        "DatabaseMigrationAppliedManifestSha256",
        "DatabaseMigrationAppliedVersion",
        "DatabaseMigrationCount",
        "DatabaseMigrationExpectedVersion",
        "DatabaseMigrationManifestSha256",
        "DirectOriginProtection",
      ]),
    );
    expect(
      applicationOutputs["DatabaseMigrationExpectedVersion"],
    ).toMatchObject({
      Value: "0138",
    });
    expect(applicationOutputs["DatabaseMigrationManifestSha256"]).toMatchObject(
      {
        Value:
          "bc316cae6997880786ecf27fee40f43f997669cfd521356dc942adca9d849a16",
      },
    );
    const migrationResources = application.findResources(
      "AWS::CloudFormation::CustomResource",
    );
    const [migrationLogicalId, migrationResource] =
      Object.entries(migrationResources)[0] ?? [];
    expect(migrationLogicalId).toBeDefined();
    expect(migrationResource).toMatchObject({
      Properties: {
        ExpectedSchemaVersion: "0138",
        ManifestSha256:
          "bc316cae6997880786ecf27fee40f43f997669cfd521356dc942adca9d849a16",
      },
    });
    const functions = application.findResources("AWS::Lambda::Function");
    const apiFunction = Object.values(functions).find(
      (resource) =>
        properties(resource)["FunctionName"] === "cloudmarkup-beta-api",
    );
    const migratorFunction = Object.values(functions).find(
      (resource) =>
        properties(resource)["FunctionName"] ===
        "cloudmarkup-beta-database-migrator",
    );
    expect(apiFunction).toBeDefined();
    expect(migratorFunction).toBeDefined();
    expect(properties(apiFunction ?? {})["Role"]).toEqual(
      betaRoleArn("CloudMarkup-Beta-API-Runtime"),
    );
    expect(properties(migratorFunction ?? {})["Role"]).toEqual(
      betaRoleArn("CloudMarkup-Beta-Database-Migrator-Runtime"),
    );
    const apiGatewayAccount = resourceList(
      application,
      "AWS::ApiGateway::Account",
    )[0];
    expect(properties(apiGatewayAccount ?? {})["CloudWatchRoleArn"]).toEqual(
      betaRoleArn("cloudmarkup-beta-api-gateway-logging"),
    );
    const migratorEnvironment = record(
      record(
        properties(migratorFunction ?? {})["Environment"],
        "migrator environment",
      )["Variables"],
      "migrator environment variables",
    );
    expect(migratorEnvironment).not.toHaveProperty(
      "CLOUDMARKUP_MIGRATION_MANIFEST",
    );
    expect(apiFunction?.["DependsOn"]).toEqual(
      expect.arrayContaining([migrationLogicalId]),
    );
    expect(JSON.stringify(properties(apiFunction ?? {}))).toContain(
      "CLOUDMARKUP_PUBLIC_RUNTIME_CONFIG",
    );
    expect(JSON.stringify(properties(apiFunction ?? {}))).toContain(
      "cloudmarkup-api/access",
    );
    const methods = restMethodsByRoute(application);
    expect(methods.get("GET /runtime-config")).toMatchObject({
      AuthorizationType: "NONE",
    });
    const apiStages = propertyObjects(application, "AWS::ApiGateway::Stage");
    expect(apiStages).toHaveLength(1);
    expect(apiStages[0]).not.toHaveProperty("CacheClusterEnabled", true);
    const serializedApplication = JSON.stringify(applicationJson);
    expect(serializedApplication).toContain(
      "https://beta.example.invalid/auth/callback",
    );
    expect(serializedApplication).not.toContain("localhost");
    expect(serializedApplication).not.toContain(
      "edge-origin-verification-fixture",
    );
    expect(serializedApplication).toContain(
      "cloudmarkup-beta-regional-origin-access",
    );

    const edge = Template.fromStack(stage.edge);
    edge.resourceCountIs("Custom::CDKBucketDeployment", 1);
    edge.hasResourceProperties("Custom::CDKBucketDeployment", {
      Prune: false,
      RetainOnDelete: true,
    });
    edge.resourceCountIs("AWS::CloudFront::Distribution", 1);
    edge.resourceCountIs("AWS::CloudFront::OriginAccessControl", 0);
    edge.resourceCountIs("AWS::CloudFront::ResponseHeadersPolicy", 0);
    expect(JSON.stringify(edge.toJSON())).toContain(
      "cloudmarkup-beta-bootstrap:PublicAssetHeadersPolicyId",
    );
    edge.resourceCountIs("AWS::WAFv2::WebACL", 1);
    const edgeJson = record(edge.toJSON(), "beta edge template");
    const edgeOutputs = record(edgeJson["Outputs"], "beta edge outputs");
    for (const output of [
      "ApiUrl",
      "ApplicationUrl",
      "AwsAccountId",
      "AwsRegion",
      "CertificateArn",
      "CloudFrontDistributionDomainName",
      "CloudFrontDistributionId",
      "DeploymentEnvironment",
      "DnsCreatedAutomatically",
      "DnsRecordName",
      "DnsRecordType",
      "DnsTarget",
      "DnsTargetHostedZoneId",
      "PublicIngressType",
      "WebAssetsBucketName",
    ]) {
      expect(edgeOutputs).toHaveProperty(output);
    }
    expect(edgeOutputs["DeploymentEnvironment"]).toMatchObject({
      Value: "beta",
    });
    expect(edgeOutputs["ApplicationUrl"]).toMatchObject({
      Value: "https://beta.example.invalid",
    });
    expect(JSON.stringify(edgeJson)).toContain("/*");
    expect(JSON.stringify(edgeJson)).toContain(
      "CloudMarkup-Beta-Web-Deployment-Runtime",
    );
    for (const exportName of [
      "cloudmarkup-beta-bootstrap:WebOriginAccessControlId",
      "cloudmarkup-beta-bootstrap:SecurityHeadersPolicyId",
      "cloudmarkup-beta-bootstrap:ApiSecurityHeadersPolicyId",
    ]) {
      expect(JSON.stringify(edgeJson)).toContain(exportName);
    }
    expect(JSON.stringify(edgeJson)).not.toContain(
      "edge-origin-verification-fixture",
    );
    expect(JSON.stringify(edgeJson)).toContain(
      "cloudmarkup-beta-edge-rate-controls",
    );

    const observability = Template.fromStack(stage.observability);
    observability.resourceCountIs("AWS::IAM::Role", 0);
    observability.resourceCountIs("AWS::IAM::Policy", 0);
    observability.resourceCountIs("AWS::KMS::Key", 0);
    observability.resourceCountIs("AWS::KMS::Alias", 0);
    observability.resourceCountIs("AWS::SNS::Topic", 0);
    observability.resourceCountIs("AWS::SNS::TopicPolicy", 0);
    observability.resourceCountIs("AWS::CE::AnomalyMonitor", 0);
    observability.resourceCountIs("AWS::CE::AnomalySubscription", 0);
    observability.resourceCountIs("AWS::Budgets::Budget", 1);
    const observabilityOutputs = record(
      record(observability.toJSON(), "beta observability template")["Outputs"],
      "beta observability outputs",
    );
    expect(observabilityOutputs).toHaveProperty("AlarmTopicArn");
    expect(observabilityOutputs["LogGroupNames"]).toMatchObject({
      Value: JSON.stringify([
        "/aws/apigateway/cloudmarkup-beta-api",
        "/aws/lambda/cloudmarkup-beta-api",
        "/aws/lambda/cloudmarkup-beta-database-migrator",
        "/aws/codebuild/cloudmarkup-beta-application-build",
        "/aws/lambda/cloudmarkup-beta-billing-webhook",
        "/aws/vendedlogs/states/cloudmarkup-beta-jobs",
        "/aws/lambda/cloudmarkup-beta-job-worker",
        "/aws/codebuild/cloudmarkup-beta-terraform-validation",
        "/aws/rds/cluster/cloudmarkup-beta-postgresql/postgresql",
        "/aws/lambda/cloudmarkup-beta-project-content-cleanup",
      ]),
    });
    const serializedObservability = JSON.stringify(observability.toJSON());
    expect(serializedObservability).toContain(
      "cloudmarkup-beta-bootstrap:AlarmTopicArn",
    );
    expect(serializedObservability).toContain(
      "cloudmarkup-beta-regional-origin-access",
    );
    expect(serializedObservability).toContain(
      "cloudmarkup-beta-edge-rate-controls",
    );
    expect(serializedObservability).not.toContain(
      "cloudmarkup-dev-regional-origin-access",
    );
  }, 120_000);

  test("applies retention to every explicitly owned log group", () => {
    const template = devFixture.observability;
    const groups = propertyObjects(template, "AWS::Logs::LogGroup");

    expect(groups).toHaveLength(9);
    for (const group of groups) expect(group["RetentionInDays"]).toBe(30);
  });
  test("encrypts alarm delivery with exact CloudWatch and Budgets policies", () => {
    const template = devFixture.observability;
    template.resourceCountIs("AWS::KMS::Key", 1);
    template.resourceCountIs("AWS::SNS::Subscription", 0);
    const key = propertyObjects(template, "AWS::KMS::Key")[0];
    if (key === undefined) {
      throw new TypeError("the observability template must contain a KMS key.");
    }
    expect(key["EnableKeyRotation"]).toBe(true);
    const keyPolicy = record(key["KeyPolicy"], "KMS key policy");
    const rawKeyStatements = keyPolicy["Statement"];
    if (!Array.isArray(rawKeyStatements)) {
      throw new TypeError("the KMS key policy must contain statements.");
    }
    const keyStatements = rawKeyStatements.map((statement: unknown) =>
      record(statement, "KMS key statement"),
    );
    const expectedServiceSourceSuffixes = new Map([
      [
        "cloudwatch.amazonaws.com",
        ":cloudwatch:us-east-1:000000000000:alarm:*",
      ],
      ["budgets.amazonaws.com", ":budgets::000000000000:*"],
      ["costalerts.amazonaws.com", ":ce::000000000000:anomalysubscription/*"],
    ]);
    const partitionAwareArn = (suffix: string) => ({
      "Fn::Join": ["", ["arn:", { Ref: "AWS::Partition" }, suffix]],
    });
    for (const [service, sourceArnSuffix] of expectedServiceSourceSuffixes) {
      const statement = keyStatements.find((candidate) => {
        const principal = record(candidate["Principal"], "KMS principal");
        return principal["Service"] === service;
      });
      expect(statement).toBeDefined();
      expect(new Set(statement?.["Action"] as string[])).toEqual(
        new Set([
          "kms:Decrypt",
          "kms:GenerateDataKey",
          "kms:GenerateDataKeyWithoutPlaintext",
        ]),
      );
      expect(statement?.["Resource"]).toBe("*");
      const condition = record(statement?.["Condition"], "KMS condition");
      expect(record(condition["StringEquals"], "KMS source account")).toEqual({
        "aws:SourceAccount": "000000000000",
      });
      expect(record(condition["ArnLike"], "KMS source ARN")).toEqual({
        "aws:SourceArn": partitionAwareArn(sourceArnSuffix),
      });
    }
    expect(JSON.stringify(keyStatements)).not.toContain('"kms:*"');

    const policies = propertyObjects(template, "AWS::SNS::TopicPolicy");
    expect(policies).toHaveLength(1);
    const policy = policies[0];
    if (policy === undefined) {
      throw new TypeError(
        "the observability template must contain a topic policy.",
      );
    }
    const topics = policy["Topics"];
    if (!Array.isArray(topics) || topics.length !== 1) {
      throw new TypeError("the alarm topic policy must bind one exact topic.");
    }
    const document = record(policy["PolicyDocument"], "topic policy document");
    const rawStatements = document["Statement"];
    if (!Array.isArray(rawStatements)) {
      throw new TypeError("the topic policy must contain statements.");
    }
    const statements = rawStatements.map((statement: unknown) =>
      record(statement, "topic policy statement"),
    );
    for (const [service, sourceArnSuffix] of expectedServiceSourceSuffixes) {
      const statement = statements.find((candidate) => {
        const principal = record(candidate["Principal"], "topic principal");
        return principal["Service"] === service;
      });
      expect(statement?.["Action"]).toBe("sns:Publish");
      expect(statement?.["Resource"]).toEqual(topics[0]);
      const condition = record(statement?.["Condition"], "topic condition");
      expect(record(condition["StringEquals"], "source account")).toEqual({
        "aws:SourceAccount": "000000000000",
      });
      expect(record(condition["ArnLike"], "source ARN")).toEqual({
        "aws:SourceArn": partitionAwareArn(sourceArnSuffix),
      });
    }
    expect(JSON.stringify(template.toJSON())).not.toContain("alias/aws/sns");
  });

  test("binds billing delivery and projection signals to real metrics and alarms", () => {
    const stages = propertyObjects(
      devFixture.application,
      "AWS::ApiGateway::Stage",
    );
    expect(stages).toHaveLength(1);
    const stage = stages[0];
    if (stage === undefined) {
      throw new TypeError(
        "the application template must contain an API stage.",
      );
    }
    const accessLogs = record(stage["AccessLogSetting"], "access log settings");
    expect(stage["StageName"]).toBe("dev");
    expect(accessLogs["Format"]).toContain('"status":$context.status');
    expect(accessLogs["Format"]).toContain(
      '"routeKey":"$context.httpMethod $context.resourcePath"',
    );
    expect(accessLogs["Format"]).not.toContain("integrationError");
    expect(accessLogs["Format"]).not.toContain("integrationErrorMessage");
    expect(stage["MethodSettings"]).toEqual([
      expect.objectContaining({
        DataTraceEnabled: false,
        HttpMethod: "*",
        MetricsEnabled: true,
        ResourcePath: "/*",
        ThrottlingBurstLimit: 100,
        ThrottlingRateLimit: 50,
      }),
    ]);

    const filters = propertyObjects(
      devFixture.observability,
      "AWS::Logs::MetricFilter",
    );
    const byMetricName = new Map(
      filters.map((filter) => {
        const transformations = filter["MetricTransformations"];
        if (!Array.isArray(transformations) || transformations.length !== 1) {
          throw new TypeError(
            "each metric filter must own one transformation.",
          );
        }
        const transformation = record(
          transformations[0],
          "metric transformation",
        );
        return [transformation["MetricName"], filter] as const;
      }),
    );
    expect(byMetricName.get("Api5xx")?.["FilterPattern"]).toBe(
      "{ $.status >= 500 }",
    );
    expect(byMetricName.get("BillingWebhook5xx")?.["FilterPattern"]).toBe(
      '{ $.routeKey = "POST /webhooks/stripe" && $.status >= 500 }',
    );
    const alarms = propertyObjects(
      devFixture.observability,
      "AWS::CloudWatch::Alarm",
    );
    expect(
      alarms.some((alarm) => alarm["MetricName"] === "BillingWebhook5xx"),
    ).toBe(true);
    const serializedObservability = JSON.stringify(
      devFixture.observability.toJSON(),
    );
    for (const metricName of [
      "BillingWebhook5xx",
      "BillingWebhookSignatureFailures",
      "BillingWebhookProcessingFailures",
      "StaleBillingProjections",
      "ApproximateAgeOfOldestMessage",
      "ApproximateNumberOfMessagesVisible",
    ]) {
      expect(serializedObservability).toContain(metricName);
    }
    for (const alarmId of [
      "BillingWebhookSignatureFailureAlarm",
      "BillingWebhookProcessingFailureAlarm",
      "BillingWebhookBacklogAlarm",
      "BillingWebhookQueueAgeAlarm",
      "BillingWebhookDeadLetterAlarm",
      "StaleBillingProjectionAlarm",
    ]) {
      expect(serializedObservability).toContain(alarmId);
    }
  });

  test("covers bounded operational signals and cost anomalies without unsafe payload fields", () => {
    const template = devFixture.observability;
    const filters = propertyObjects(template, "AWS::Logs::MetricFilter");
    const metricNames = new Set(
      filters.flatMap((filter) => {
        const transformations = filter["MetricTransformations"];
        if (!Array.isArray(transformations)) return [];
        return transformations.map(
          (transformation: unknown) =>
            record(transformation, "metric transformation")["MetricName"],
        );
      }),
    );
    for (const metricName of [
      "ApiThrottledResponses",
      "AuthorizationDenials",
      "AbuseBlocks",
      "OriginVerificationDenials",
      "ModelInvocationFailures",
      "ModelCreditDenials",
      "LedgerReconciliationFailures",
      "CompilerFailures",
      "GeneratorFailures",
      "DiagramExportFailures",
      "ZipExportFailures",
      "GitHubExportFailures",
      "WorkflowGenerationFailures",
      "PlanEvidenceFailures",
      "DeploymentEvidenceFailures",
      "DriftEvidenceFailures",
      "EvidenceProcessingFailures",
      "SupportOperationDenials",
      "RetentionFailures",
      "ModelUsageRecords",
      "SupportOperations",
    ]) {
      expect(metricNames).toContain(metricName);
    }

    const serialized = JSON.stringify(template.toJSON());
    for (const eventName of [
      "security.authorization.denied",
      "security.abuse.blocked",
      "security.origin.denied",
      "model.invocation.failed",
      "ledger.reconciliation.failed",
      "compiler.operation.failed",
      "generator.operation.failed",
      "workflow.generation.failed",
      "plan.evidence.failed",
      "deployment.evidence.failed",
      "drift.evidence.failed",
      "support.operation.denied",
      "retention.operation.failed",
    ]) {
      expect(serialized).toContain(eventName);
    }
    for (const alarmId of [
      "CommercialControlFailureAlarm",
      "EvidenceControlFailureAlarm",
      "GenerationControlFailureAlarm",
      "SecurityControlDenialAlarm",
      "SupportOperationDenialAlarm",
    ]) {
      expect(serialized).toContain(alarmId);
    }
    for (const title of [
      "Security denials and throttling",
      "Model, ledger, and support controls",
      "Generation, validation, and export controls",
      "Evidence and retention controls",
    ]) {
      expect(serialized).toContain(title);
    }
    expect(serialized).toContain("cloudmarkup-dev-application-build");
    expect(serialized).toContain("cloudmarkup-dev-terraform-validation");

    template.resourceCountIs("AWS::CE::AnomalyMonitor", 1);
    template.resourceCountIs("AWS::CE::AnomalySubscription", 1);
    const monitor = propertyObjects(template, "AWS::CE::AnomalyMonitor")[0];
    expect(monitor).toEqual(
      expect.objectContaining({
        MonitorDimension: "SERVICE",
        MonitorName: "cloudmarkup-dev-service-cost-anomalies",
        MonitorType: "DIMENSIONAL",
      }),
    );
    const subscription = propertyObjects(
      template,
      "AWS::CE::AnomalySubscription",
    )[0];
    expect(subscription).toEqual(
      expect.objectContaining({
        Frequency: "IMMEDIATE",
        SubscriptionName: "cloudmarkup-dev-cost-anomaly-notifications",
      }),
    );
    expect(JSON.parse(String(subscription?.["ThresholdExpression"]))).toEqual({
      Dimensions: {
        Key: "ANOMALY_TOTAL_IMPACT_ABSOLUTE",
        MatchOptions: ["GREATER_THAN_OR_EQUAL"],
        Values: ["10"],
      },
    });
    const subscribers = subscription?.["Subscribers"];
    expect(Array.isArray(subscribers)).toBe(true);
    expect(record((subscribers as unknown[])[0], "anomaly subscriber")).toEqual(
      expect.objectContaining({ Type: "SNS" }),
    );
    expect(JSON.stringify(subscribers)).toContain("AlarmNotifications");
  });
});

describe("CloudMarkup application boundaries", () => {
  test("protects product routes while keeping only explicit system and webhook routes public", () => {
    const template = devFixture.application;
    template.resourceCountIs("AWS::ApiGatewayV2::Api", 0);
    template.resourceCountIs("AWS::ApiGatewayV2::Authorizer", 0);
    template.resourceCountIs("AWS::ApiGatewayV2::Integration", 0);
    template.resourceCountIs("AWS::ApiGatewayV2::Route", 0);
    template.resourceCountIs("AWS::ApiGatewayV2::Stage", 0);
    template.resourceCountIs("AWS::ApiGateway::Account", 1);
    template.resourceCountIs("AWS::ApiGateway::RestApi", 1);
    template.resourceCountIs("AWS::ApiGateway::Authorizer", 1);
    template.resourceCountIs("AWS::ApiGateway::Method", 14);
    template.resourceCountIs("AWS::ApiGateway::GatewayResponse", 2);
    template.resourceCountIs("AWS::ApiGateway::Stage", 1);
    const methods = restMethodsByRoute(template);
    expect([...methods.keys()].sort()).toEqual([
      "ANY /v1",
      "ANY /v1/{proxy+}",
      "GET /github/callback",
      "GET /github/setup",
      "GET /health",
      "GET /openapi/v1.json",
      "GET /ready",
      "GET /runtime-config",
      "POST /auth/session/v1/cancel",
      "POST /auth/session/v1/exchange",
      "POST /auth/session/v1/logout",
      "POST /auth/session/v1/restore",
      "POST /webhooks/github",
      "POST /webhooks/stripe",
    ]);
    for (const route of ["ANY /v1", "ANY /v1/{proxy+}"]) {
      expect(methods.get(route)).toEqual(
        expect.objectContaining({
          AuthorizationScopes: ["cloudmarkup-api/access"],
          AuthorizationType: "COGNITO_USER_POOLS",
          HttpMethod: "ANY",
        }),
      );
    }
    for (const route of [
      "GET /github/callback",
      "GET /github/setup",
      "GET /health",
      "GET /openapi/v1.json",
      "GET /ready",
      "GET /runtime-config",
      "POST /auth/session/v1/cancel",
      "POST /auth/session/v1/exchange",
      "POST /auth/session/v1/logout",
      "POST /auth/session/v1/restore",
      "POST /webhooks/github",
      "POST /webhooks/stripe",
    ]) {
      expect(methods.get(route)?.["AuthorizationType"]).toBe("NONE");
    }
    for (const operation of ["cancel", "exchange", "logout", "restore"]) {
      const path = "/auth/session/v1/" + operation;
      expect(methods.get("POST " + path)).toMatchObject({
        HttpMethod: "POST",
        AuthorizationType: "NONE",
        Integration: { Type: "AWS_PROXY" },
      });
      expect(
        [...methods.keys()].filter((route) => route.endsWith(" " + path)),
      ).toEqual(["POST " + path]);
    }
    const serialized = JSON.stringify(template.toJSON());
    expect(serialized).toContain("http://localhost:5173/auth/callback");
    expect(serialized).toContain("http://localhost:5173");
    expect(serialized).not.toContain("example.com");
  });

  test("returns typed versioned envelopes when API Gateway rejects Cognito authorization", () => {
    const responses = propertyObjects(
      devFixture.application,
      "AWS::ApiGateway::GatewayResponse",
    );
    expect(responses).toHaveLength(2);
    const byType = new Map(
      responses.map((response) => [response["ResponseType"], response]),
    );
    const expectedHeaders = {
      "gatewayresponse.header.Cache-Control": "'no-store'",
      "gatewayresponse.header.Content-Security-Policy":
        "'default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none''",
      "gatewayresponse.header.Content-Type":
        "'application/json; charset=UTF-8'",
      "gatewayresponse.header.Cross-Origin-Opener-Policy": "'same-origin'",
      "gatewayresponse.header.Cross-Origin-Resource-Policy": "'same-origin'",
      "gatewayresponse.header.Permissions-Policy":
        "'camera=(), display-capture=(), geolocation=(), microphone=(), payment=(), publickey-credentials-get=(), usb=()'",
      "gatewayresponse.header.Referrer-Policy": "'no-referrer'",
      "gatewayresponse.header.Strict-Transport-Security":
        "'max-age=63072000; includeSubDomains; preload'",
      "gatewayresponse.header.X-Content-Type-Options": "'nosniff'",
      "gatewayresponse.header.X-Frame-Options": "'DENY'",
    };
    for (const [type, status, code, message] of [
      [
        "UNAUTHORIZED",
        "401",
        "authentication_required",
        "Authentication is required.",
      ],
      ["ACCESS_DENIED", "403", "access_denied", "Access is denied."],
    ] as const) {
      const response = byType.get(type);
      expect(response).toBeDefined();
      expect(response?.["StatusCode"]).toBe(status);
      expect(response?.["ResponseParameters"]).toEqual(expectedHeaders);
      const serializedParameters = record(
        JSON.parse(JSON.stringify(response?.["ResponseParameters"])),
        `${type} serialized gateway response parameters`,
      );
      const cspMapping =
        serializedParameters["gatewayresponse.header.Content-Security-Policy"];
      if (typeof cspMapping !== "string") {
        throw new TypeError(`${type} CSP mapping must be a static string.`);
      }
      expect(cspMapping.startsWith("'")).toBe(true);
      expect(cspMapping.endsWith("'")).toBe(true);
      expect(cspMapping).not.toContain("\\");
      expect(Buffer.from(cspMapping.slice(1, -1), "utf8")).toEqual(
        Buffer.from(
          "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'",
          "utf8",
        ),
      );
      const templates = record(
        response?.["ResponseTemplates"],
        `${type} gateway response templates`,
      );
      expect(JSON.parse(String(templates["application/json"]))).toEqual({
        apiVersion: "v1",
        error: {
          code,
          correlationId: "$context.requestId",
          message,
        },
      });
    }
  });

  test("retains the account-wide API Gateway log role with exact access-log permissions", () => {
    const template = devFixture.application;
    const account = resourceList(template, "AWS::ApiGateway::Account")[0];
    if (account === undefined) {
      throw new TypeError("API Gateway account resource must exist.");
    }
    expect(account.DeletionPolicy).toBe("RetainExceptOnCreate");
    expect(account.UpdateReplacePolicy).toBe("Retain");

    const role = resourceList(template, "AWS::IAM::Role").find(
      (candidate) =>
        properties(candidate)["RoleName"] ===
        "cloudmarkup-dev-api-gateway-logging",
    );
    expect(role?.DeletionPolicy).toBe("RetainExceptOnCreate");
    expect(role?.UpdateReplacePolicy).toBe("Retain");
    expect(JSON.stringify(properties(account)["CloudWatchRoleArn"])).toContain(
      "ApiGatewayLogRole",
    );

    const policies = propertyObjects(template, "AWS::IAM::Policy").filter(
      (candidate) =>
        JSON.stringify(candidate["Roles"]).includes("ApiGatewayLogRole"),
    );
    expect(policies).toHaveLength(1);
    const document = record(
      policies[0]?.["PolicyDocument"],
      "API Gateway log policy",
    );
    const statements = document["Statement"];
    if (!Array.isArray(statements)) {
      throw new TypeError(
        "API Gateway log policy statements must be an array.",
      );
    }
    expect(statements).toHaveLength(2);
    const describe = statements
      .map((statement) => record(statement, "API Gateway log statement"))
      .find((statement) => statement["Action"] === "logs:DescribeLogStreams");
    expect(JSON.stringify(describe?.["Resource"])).toContain("ApiAccessLogs");
    expect(JSON.stringify(describe?.["Resource"])).not.toContain('":*"');
    const writes = statements
      .map((statement) => record(statement, "API Gateway log statement"))
      .find((statement) => Array.isArray(statement["Action"]));
    expect(writes?.["Action"]).toEqual([
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]);
    expect(JSON.stringify(writes?.["Resource"])).toContain('":*"');
  });

  test("binds the generated origin secret dynamically and reserves API concurrency", () => {
    const template = devFixture.application;
    const templateJson = record(template.toJSON(), "application template");
    const parameters = record(templateJson["Parameters"], "parameters");
    expect(
      Object.values(parameters).some(
        (parameter) => record(parameter, "parameter")["NoEcho"] === true,
      ),
    ).toBe(false);
    expect(JSON.stringify(templateJson["Outputs"] ?? {})).not.toContain(
      "resolve:secretsmanager",
    );

    const functions = propertyObjects(template, "AWS::Lambda::Function");
    const expectedConcurrency = new Map([
      ["cloudmarkup-dev-api", 10],
      ["cloudmarkup-dev-billing-webhook", 2],
      ["cloudmarkup-dev-job-worker", 5],
    ]);
    for (const [functionName, concurrency] of expectedConcurrency) {
      const fn = functions.find(
        (candidate) => candidate["FunctionName"] === functionName,
      );
      expect(fn?.["ReservedConcurrentExecutions"]).toBe(concurrency);
      expect(fn?.["Runtime"]).toBe("nodejs24.x");
      if (functionName !== "cloudmarkup-dev-job-worker") {
        const variables = record(
          record(fn?.["Environment"], "function environment")["Variables"],
          "function variables",
        );
        expect(
          JSON.stringify(variables["CLOUDMARKUP_EDGE_ORIGIN_VERIFICATION"]),
        ).toContain("resolve:secretsmanager");
      }
      if (functionName === "cloudmarkup-dev-api") {
        const variables = record(
          record(fn?.["Environment"], "API environment")["Variables"],
          "API variables",
        );
        expect(variables["COGNITO_USER_POOL_ID"]).toBeDefined();
        expect(JSON.stringify(variables["COGNITO_USER_POOL_ID"])).toContain(
          "Users",
        );
      }
    }
  });

  test("scopes API Gateway invocation to each exact application boundary", () => {
    const permissions = propertyObjects(
      devFixture.application,
      "AWS::Lambda::Permission",
    );
    const billingPermissions = permissions.filter((permission) =>
      JSON.stringify(permission["FunctionName"]).includes(
        "BillingWebhookFunction",
      ),
    );
    const apiPermissions = permissions.filter((permission) =>
      JSON.stringify(permission["FunctionName"]).includes("ApiFunction"),
    );
    expect(billingPermissions).toHaveLength(1);
    expect(apiPermissions).toHaveLength(13);

    const billingSource = JSON.stringify(billingPermissions[0]?.["SourceArn"]);
    expect(billingSource).toContain("/POST/webhooks/stripe");
    for (const forbiddenRoute of [
      "*/v1",
      "GET/github/setup",
      "GET/github/callback",
      "GET/health",
      "GET/ready",
      "GET/openapi/v1.json",
      "GET/runtime-config",
    ]) {
      expect(billingSource).not.toContain(forbiddenRoute);
    }
    const apiSources = apiPermissions.map((permission) =>
      JSON.stringify(permission["SourceArn"]),
    );
    expect(apiSources.some((source) => source.includes('"/*/v1"'))).toBe(true);
    expect(apiSources.some((source) => source.includes("/*/v1/*"))).toBe(true);
    for (const route of [
      "/GET/github/setup",
      "/GET/github/callback",
      "/GET/health",
      "/GET/ready",
      "/GET/openapi/v1.json",
      "/GET/runtime-config",
      "/POST/auth/session/v1/cancel",
      "/POST/auth/session/v1/exchange",
      "/POST/auth/session/v1/logout",
      "/POST/auth/session/v1/restore",
    ]) {
      expect(apiSources.some((source) => source.includes(route))).toBe(true);
    }
    expect(JSON.stringify(permissions)).not.toContain("*/*/*");
  });

  test("keeps disabled integration references out of runtime configuration", () => {
    const template = devFixture.application;
    const functions = propertyObjects(template, "AWS::Lambda::Function");
    const api = functions.find(
      (fn) => fn["FunctionName"] === "cloudmarkup-dev-api",
    );
    const webhook = functions.find(
      (fn) => fn["FunctionName"] === "cloudmarkup-dev-billing-webhook",
    );

    expect(api).toBeDefined();
    expect(webhook).toBeDefined();
    expect(webhook?.["Role"]).not.toEqual(api?.["Role"]);
    const webhookEnvironment = record(
      record(webhook?.["Environment"], "webhook environment")["Variables"],
      "webhook variables",
    );
    expect(webhookEnvironment).toEqual(
      expect.objectContaining({
        CLOUDMARKUP_BILLING_ENABLED: "false",
      }),
    );
    expect(webhookEnvironment).toHaveProperty(
      "CLOUDMARKUP_BILLING_WEBHOOK_QUEUE_URL",
    );
    expect(webhookEnvironment).not.toHaveProperty(
      "CLOUDMARKUP_STRIPE_ENVIRONMENT",
    );
    expect(webhookEnvironment).not.toHaveProperty(
      "CLOUDMARKUP_STRIPE_WEBHOOK_SECRET_REFERENCE",
    );
    expect(webhookEnvironment).not.toHaveProperty(
      "CLOUDMARKUP_STRIPE_PREVIOUS_WEBHOOK_SECRET_REFERENCE",
    );
    const serialized = JSON.stringify(template.toJSON());
    expect(serialized).not.toContain("cloudmarkup/dev/stripe/");
    expect(serialized).not.toContain("cloudmarkup/dev/github/app-private-key");
    expect(serialized).not.toContain("cloudmarkup/dev/github/webhook-secret");
    expect(serialized).not.toContain("STRIPE_SECRET_KEY");
    expect(serialized).not.toContain('STRIPE_WEBHOOK_SECRET"');
    expect(serialized).not.toMatch(/sk_(?:live|test)_/u);
    expect(serialized).not.toContain("whsec_");
  });

  test("uses exact application data resources and contains no unintended IAM wildcards", () => {
    const template = devFixture.application;
    const policies = propertyObjects(template, "AWS::IAM::Policy");
    expect(policies.length).toBeGreaterThan(0);

    for (const policy of policies) {
      const document = record(policy["PolicyDocument"], "policy document");
      const isSandboxPolicy =
        /(?:TerraformValidation|ApplicationBuild)ServiceRole/u.test(
          JSON.stringify(policy["Roles"]),
        );
      const statements = document["Statement"];
      expect(Array.isArray(statements)).toBe(true);
      for (const rawStatement of statements as unknown[]) {
        const statement = record(rawStatement, "policy statement");
        const rawActions = statement["Action"];
        const actions = Array.isArray(rawActions) ? rawActions : [rawActions];
        expect(actions).not.toContain("*");
        if (
          !isSandboxPolicy &&
          statement["Effect"] === "Allow" &&
          statement["Resource"] === "*"
        ) {
          expect(
            actions.every(
              (action) =>
                typeof action === "string" &&
                (action.startsWith("logs:") || action.startsWith("xray:")),
            ),
          ).toBe(true);
        }
      }
    }

    const serialized = JSON.stringify(template.toJSON());
    expect(serialized).toContain("documents/v1/organizations/");
    expect(serialized).toContain("artifacts/v1/organizations/");
    expect(serialized).toContain("evidence/v1/organizations/");
    expect(serialized).toContain("rds-data:ExecuteStatement");
    expect(serialized).not.toContain('"Action":"*"');
    expect(serialized).not.toContain("bedrock:");
    expect(serialized).not.toContain("customer-credential");
    const serializedPolicies = JSON.stringify(policies);
    expect(serializedPolicies).not.toContain("cloudmarkup/dev/stripe/");
    expect(serializedPolicies).not.toContain(
      "cloudmarkup/dev/github/app-private-key",
    );
  });

  test("grants enabled integrations only to their exact roles and resources", () => {
    const base = createDevEnvironmentConfig();
    const modelArn =
      "arn:aws:bedrock:us-east-1::foundation-model/example.model-v1:0";
    const inferenceProfileArn =
      "arn:aws:bedrock:us-east-1:000000000000:inference-profile/us.example.model-v1:0";
    const config = defineEnvironmentConfig({
      ...base,
      features: {
        ...base.features,
        aiAuthoring: true,
        billing: true,
        githubExport: true,
      },
      integrations: {
        bedrock: {
          inferenceProfileArns: [inferenceProfileArn],
          modelArns: [modelArn],
        },
        github: {
          ...base.integrations.github,
          appId: "123456",
        },
        stripe: {
          ...base.integrations.stripe,
          portalConfigurationId: "bpc_fixture",
          previousWebhookSigningSecretName:
            "cloudmarkup/dev/stripe/webhook-signing-secret-previous",
          proPriceId: "price_pro_fixture",
          proProductId: "prod_pro_fixture",
          starterPriceId: "price_starter_fixture",
          starterProductId: "prod_starter_fixture",
        },
      },
    });
    const stage = new CloudMarkupStage(
      createTemplateTestApp(),
      "EnabledIntegrationFixture",
      {
        config,
      },
    );
    const template = Template.fromStack(stage.application);
    const enabledFunctions = propertyObjects(template, "AWS::Lambda::Function");
    const enabledBillingFunction = enabledFunctions.find(
      (fn) => fn["FunctionName"] === "cloudmarkup-dev-billing-webhook",
    );
    const enabledApiFunction = enabledFunctions.find(
      (fn) => fn["FunctionName"] === "cloudmarkup-dev-api",
    );
    const enabledWorkerFunction = enabledFunctions.find(
      (fn) => fn["FunctionName"] === "cloudmarkup-dev-job-worker",
    );
    const apiEnvironment = record(
      record(enabledApiFunction?.["Environment"], "api environment")[
        "Variables"
      ],
      "api variables",
    );
    const billingEnvironment = record(
      record(enabledBillingFunction?.["Environment"], "billing environment")[
        "Variables"
      ],
      "billing variables",
    );
    const workerEnvironment = record(
      record(enabledWorkerFunction?.["Environment"], "worker environment")[
        "Variables"
      ],
      "worker variables",
    );
    expect(billingEnvironment).toEqual(
      expect.objectContaining({
        CLOUDMARKUP_BILLING_ENABLED: "true",
        CLOUDMARKUP_BILLING_PLAN_MAPPING_VERSION:
          "cloudmarkup-starter-pro-mapping-2026-08-28-v1",
        CLOUDMARKUP_BILLING_WEBHOOK_ENDPOINT_VERSION:
          "cloudmarkup-stripe-webhook-2026-08-28-v1",
        CLOUDMARKUP_STRIPE_ENVIRONMENT: "test",
        CLOUDMARKUP_STRIPE_PREVIOUS_WEBHOOK_SECRET_REFERENCE:
          "cloudmarkup/dev/stripe/webhook-signing-secret-previous",
        CLOUDMARKUP_STRIPE_WEBHOOK_SECRET_REFERENCE:
          "cloudmarkup/dev/stripe/webhook-signing-secret",
      }),
    );
    expect(billingEnvironment).not.toHaveProperty(
      "CLOUDMARKUP_STRIPE_API_KEY_SECRET_NAME",
    );
    expect(apiEnvironment).toEqual(
      expect.objectContaining({
        CLOUDMARKUP_GITHUB_APP_ID: "123456",
        CLOUDMARKUP_GITHUB_WEBHOOK_SECRET_NAME:
          "cloudmarkup/dev/github/webhook-secret",
      }),
    );
    expect(apiEnvironment).not.toHaveProperty(
      "CLOUDMARKUP_GITHUB_PRIVATE_KEY_SECRET_NAME",
    );
    expect(workerEnvironment).toEqual(
      expect.objectContaining({
        CLOUDMARKUP_GITHUB_APP_ID: "123456",
        CLOUDMARKUP_GITHUB_PRIVATE_KEY_SECRET_NAME:
          "cloudmarkup/dev/github/app-private-key",
      }),
    );
    expect(workerEnvironment).not.toHaveProperty(
      "CLOUDMARKUP_GITHUB_WEBHOOK_SECRET_NAME",
    );
    const apiPolicies = JSON.stringify(
      policyStatementsForRole(template, "ApiExecutionRole"),
    );
    const billingPolicies = JSON.stringify(
      policyStatementsForRole(template, "BillingWebhookExecutionRole"),
    );
    const workerStatements = policyStatementsForRole(
      template,
      "JobWorkerExecutionRole",
    );
    const workerPolicies = JSON.stringify(workerStatements);

    const bedrockStatement = workerStatements.find((statement) =>
      JSON.stringify(statement["Action"]).includes("bedrock:InvokeModel"),
    );
    expect(bedrockStatement).toBeDefined();
    const bedrockResources = bedrockStatement?.["Resource"];
    if (!Array.isArray(bedrockResources)) {
      throw new TypeError("Bedrock permissions must use exact resource ARNs.");
    }
    expect(new Set(bedrockResources)).toEqual(
      new Set([modelArn, inferenceProfileArn]),
    );
    expect(JSON.stringify(bedrockStatement?.["Action"])).toContain(
      "bedrock:InvokeModelWithResponseStream",
    );

    for (const stripeSecret of [
      "cloudmarkup/dev/stripe/webhook-signing-secret",
      "cloudmarkup/dev/stripe/webhook-signing-secret-previous",
    ]) {
      expect(billingPolicies).toContain(stripeSecret);
      expect(workerPolicies).not.toContain(stripeSecret);
      expect(apiPolicies).not.toContain(stripeSecret);
    }
    expect(billingPolicies).not.toContain("cloudmarkup/dev/stripe/api-key");
    expect(billingPolicies).toContain("sqs:SendMessage");
    const githubPrivateKey = "cloudmarkup/dev/github/app-private-key";
    const githubWebhookSecret = "cloudmarkup/dev/github/webhook-secret";
    expect(workerPolicies).toContain(githubPrivateKey);
    expect(apiPolicies).not.toContain(githubPrivateKey);
    expect(billingPolicies).not.toContain(githubPrivateKey);
    expect(apiPolicies).toContain(githubWebhookSecret);
    expect(workerPolicies).not.toContain(githubWebhookSecret);
    expect(billingPolicies).not.toContain(githubWebhookSecret);
    expect(billingPolicies).not.toContain("bedrock:");
    expect(apiPolicies).not.toContain("bedrock:");
  }, 30_000);

  test("creates encrypted FIFO delivery with a DLQ and fail-closed worker event source", () => {
    const template = devFixture.application;
    const queues = propertyObjects(template, "AWS::SQS::Queue");
    expect(queues).toHaveLength(4);
    for (const queue of queues) {
      expect(queue["FifoQueue"]).toBe(true);
      expect(queue["SqsManagedSseEnabled"]).toBe(true);
    }
    expect(
      queues.filter((queue) => queue["RedrivePolicy"] !== undefined),
    ).toHaveLength(2);
    expect(JSON.stringify(queues)).toContain(
      "cloudmarkup-dev-billing-webhook-dlq.fifo",
    );
    template.resourceCountIs("AWS::StepFunctions::StateMachine", 1);
    template.resourceCountIs("AWS::Lambda::EventSourceMapping", 1);
  });
});

describe("CloudMarkup edge and synthesis boundaries", () => {
  test("uses a private origin and non-cached same-origin /api routing", () => {
    const template = devFixture.edge;
    template.resourceCountIs("AWS::CloudFront::OriginAccessControl", 1);
    template.resourceCountIs("AWS::CloudFront::Function", 2);
    const distributions = propertyObjects(
      template,
      "AWS::CloudFront::Distribution",
    );
    expect(distributions).toHaveLength(1);
    const distribution = record(
      distributions[0]?.["DistributionConfig"],
      "distribution config",
    );
    expect(distribution["Logging"]).toBeUndefined();
    const defaultBehavior = record(
      distribution["DefaultCacheBehavior"],
      "default cache behavior",
    );
    const defaultAssociations = defaultBehavior["FunctionAssociations"];
    expect(Array.isArray(defaultAssociations)).toBe(true);
    expect(JSON.stringify(defaultAssociations)).toContain("viewer-request");
    const behaviors = distribution["CacheBehaviors"];
    if (!Array.isArray(behaviors)) {
      throw new TypeError("distribution cache behaviors must be an array.");
    }
    const apiBehavior = behaviors
      .map((behavior: unknown) => record(behavior, "cache behavior"))
      .find((behavior) => behavior["PathPattern"] === "/api/*");
    expect(apiBehavior).toBeDefined();
    expect(apiBehavior?.["AllowedMethods"]).toEqual([
      "GET",
      "HEAD",
      "OPTIONS",
      "PUT",
      "PATCH",
      "POST",
      "DELETE",
    ]);
    expect(typeof apiBehavior?.["CachePolicyId"]).toBe("string");
    expect(apiBehavior?.["Compress"]).toBe(false);
    expect(apiBehavior?.["ViewerProtocolPolicy"]).toBe("redirect-to-https");
    const associations = apiBehavior?.["FunctionAssociations"];
    if (!Array.isArray(associations)) {
      throw new TypeError("function associations must be an array.");
    }
    expect(
      associations
        .map((association: unknown) =>
          record(association, "function association"),
        )
        .some((association) => association["EventType"] === "viewer-request"),
    ).toBe(true);
    const serialized = JSON.stringify(template.toJSON());
    expect(serialized).toContain("request.uri.substring(4)");
    expect(serialized).toContain("lastSegment.indexOf('.')");
    expect(serialized).not.toContain("uri + 'index.html'");
    expect(serialized).toContain("request.uri = '/index.html'");
    expect(serialized).toContain("style-src-attr 'unsafe-inline'");
    expect(serialized).not.toContain("script-src 'unsafe-inline'");
    expect(serialized).toContain("StrictTransportSecurity");
  });

  test("caches only content-hashed public bundles with the same security headers", () => {
    const template = devFixture.edge;
    const distribution = record(
      propertyObjects(template, "AWS::CloudFront::Distribution")[0]?.[
        "DistributionConfig"
      ],
      "distribution config",
    );
    const defaultBehavior = record(
      distribution["DefaultCacheBehavior"],
      "default behavior",
    );
    const behaviors = distribution["CacheBehaviors"];
    if (!Array.isArray(behaviors))
      throw new TypeError("Expected cache behaviors");
    const assets = behaviors
      .map((item) => record(item, "behavior"))
      .filter((item) => String(item["PathPattern"]).startsWith("/assets/"));
    expect(assets.map((item) => item["PathPattern"])).toEqual([
      "/assets/*-????????.js",
      "/assets/*-????????.css",
    ]);
    for (const behavior of assets) {
      expect(behavior["TargetOriginId"]).toEqual(
        defaultBehavior["TargetOriginId"],
      );
      expect(behavior["AllowedMethods"]).toEqual(["GET", "HEAD"]);
      expect(behavior["CachePolicyId"]).toBe(
        "658327ea-f89d-4fab-a63d-7e88639e58f6",
      );
      expect(behavior["Compress"]).toBe(true);
      expect(behavior["FunctionAssociations"]).toBeUndefined();
      expect(behavior["ResponseHeadersPolicyId"]).not.toEqual(
        defaultBehavior["ResponseHeadersPolicyId"],
      );
    }
    const policies = propertyObjects(
      template,
      "AWS::CloudFront::ResponseHeadersPolicy",
    ).map((item) =>
      record(item["ResponseHeadersPolicyConfig"], "policy config"),
    );
    const html = policies.find(
      (item) => item["Name"] === "cloudmarkup-dev-security-headers",
    );
    const asset = policies.find(
      (item) => item["Name"] === "cloudmarkup-dev-public-asset-headers",
    );
    expect(asset?.["SecurityHeadersConfig"]).toEqual(
      html?.["SecurityHeadersConfig"],
    );
    expect(
      record(asset?.["CustomHeadersConfig"], "asset custom headers")["Items"],
    ).toContainEqual({
      Header: "Cache-Control",
      Override: true,
      Value: "public, max-age=31536000, immutable",
    });
    const api = behaviors
      .map((item) => record(item, "behavior"))
      .find((item) => item["PathPattern"] === "/api/*");
    expect(api?.["CachePolicyId"]).toBe("4135ea2d-6df8-44a3-9df3-4b5a84be39ad");
    expect(distribution["HttpVersion"]).toBe("http2and3");
    expect(distribution["PriceClass"]).toBe("PriceClass_100");
    expect(distribution["IPV6Enabled"]).toBe(true);
  });

  test("uses strict response headers and a generated origin-verification value", () => {
    const template = devFixture.edge;
    const templateJson = record(template.toJSON(), "edge template");
    const parameters = record(templateJson["Parameters"], "parameters");
    expect(
      Object.values(parameters).some(
        (parameter) => record(parameter, "parameter")["NoEcho"] === true,
      ),
    ).toBe(false);
    expect(JSON.stringify(templateJson["Outputs"] ?? {})).not.toContain(
      "resolve:secretsmanager",
    );

    const distribution = record(
      propertyObjects(template, "AWS::CloudFront::Distribution")[0]?.[
        "DistributionConfig"
      ],
      "distribution config",
    );
    const origins = distribution["Origins"];
    if (!Array.isArray(origins)) {
      throw new TypeError("distribution origins must be an array.");
    }
    const apiOrigin = origins
      .map((origin: unknown) => record(origin, "origin"))
      .find((origin) =>
        JSON.stringify(origin["DomainName"]).includes("execute-api"),
      );
    const originHeaders = apiOrigin?.["OriginCustomHeaders"];
    expect(Array.isArray(originHeaders)).toBe(true);
    const edgeOriginHeader = (originHeaders as unknown[])
      .map((header) => record(header, "origin header"))
      .find((header) => header["HeaderName"] === "x-cloudmarkup-edge-origin");
    expect(edgeOriginHeader).toBeDefined();
    const edgeOriginHeaderValue = record(
      edgeOriginHeader?.["HeaderValue"],
      "origin header value",
    );
    expect(JSON.stringify(apiOrigin?.["OriginPath"])).toContain(
      "ExportsOutputRefRestApiDeploymentStage",
    );
    expect(Array.isArray(edgeOriginHeaderValue["Fn::Join"])).toBe(true);
    expect(JSON.stringify(originHeaders)).toContain("resolve:secretsmanager");

    const responsePolicies = propertyObjects(
      template,
      "AWS::CloudFront::ResponseHeadersPolicy",
    );
    expect(responsePolicies).toHaveLength(3);
    const responsePolicy = responsePolicies.find((policy) => {
      const config = record(
        policy["ResponseHeadersPolicyConfig"],
        "response policy config",
      );
      return config["Name"] === "cloudmarkup-dev-security-headers";
    });
    const policyConfig = record(
      responsePolicy?.["ResponseHeadersPolicyConfig"],
      "response policy config",
    );
    const customHeaders = record(
      policyConfig["CustomHeadersConfig"],
      "custom headers config",
    )["Items"];
    if (!Array.isArray(customHeaders)) {
      throw new TypeError("custom response headers must be an array.");
    }
    const byHeader = new Map(
      customHeaders.map((header: unknown) => {
        const item = record(header, "custom response header");
        return [item["Header"], item] as const;
      }),
    );
    for (const [header, value] of [
      ["Cache-Control", "no-store"],
      ["Cross-Origin-Opener-Policy", "same-origin"],
      ["Cross-Origin-Resource-Policy", "same-origin"],
      [
        "Permissions-Policy",
        "camera=(), display-capture=(), geolocation=(), microphone=(), payment=(), usb=()",
      ],
      ["X-Permitted-Cross-Domain-Policies", "none"],
    ] as const) {
      expect(byHeader.get(header)).toEqual({
        Header: header,
        Override: true,
        Value: value,
      });
    }
    const securityHeaders = record(
      policyConfig["SecurityHeadersConfig"],
      "security headers config",
    );
    const csp = record(
      securityHeaders["ContentSecurityPolicy"],
      "content security policy",
    )["ContentSecurityPolicy"];
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain(
      "connect-src 'self' https://cloudmarkup-dev-000000000000.auth.us-east-1.amazoncognito.com",
    );
    expect(csp).not.toContain("*.auth.");
    expect(csp).not.toContain("script-src 'unsafe-inline'");
    const apiResponsePolicy = responsePolicies.find((policy) => {
      const config = record(
        policy["ResponseHeadersPolicyConfig"],
        "API response policy config",
      );
      return config["Name"] === "cloudmarkup-dev-api-security-headers";
    });
    const apiPolicyConfig = record(
      apiResponsePolicy?.["ResponseHeadersPolicyConfig"],
      "API response policy config",
    );
    const apiSecurityHeaders = record(
      apiPolicyConfig["SecurityHeadersConfig"],
      "API security headers config",
    );
    expect(apiSecurityHeaders["ContentSecurityPolicy"]).toBeUndefined();
    expect(apiSecurityHeaders["ContentTypeOptions"]).toEqual({
      Override: false,
    });
    expect(apiSecurityHeaders["ReferrerPolicy"]).toEqual({
      Override: false,
      ReferrerPolicy: "strict-origin-when-cross-origin",
    });
    const apiCustomHeaders = record(
      apiPolicyConfig["CustomHeadersConfig"],
      "API custom headers config",
    )["Items"];
    if (!Array.isArray(apiCustomHeaders)) {
      throw new TypeError("API custom response headers must be an array.");
    }
    const apiCacheControl = apiCustomHeaders
      .map((header) => record(header, "API custom response header"))
      .find((header) => header["Header"] === "Cache-Control");
    expect(apiCacheControl).toEqual({
      Header: "Cache-Control",
      Override: false,
      Value: "no-store",
    });

    const resources = record(templateJson["Resources"], "edge resources");
    const apiPolicyLogicalId = Object.entries(resources).find(
      ([, resource]) => {
        const item = record(resource, "edge resource");
        if (item["Type"] !== "AWS::CloudFront::ResponseHeadersPolicy") {
          return false;
        }
        const properties = record(
          item["Properties"],
          "response policy properties",
        );
        const config = record(
          properties["ResponseHeadersPolicyConfig"],
          "response policy config",
        );
        return config["Name"] === "cloudmarkup-dev-api-security-headers";
      },
    )?.[0];
    expect(apiPolicyLogicalId).toBeDefined();
    const cacheBehaviors = distribution["CacheBehaviors"];
    if (!Array.isArray(cacheBehaviors)) {
      throw new TypeError("distribution cache behaviors must be an array.");
    }
    const apiBehavior = cacheBehaviors
      .map((behavior) => record(behavior, "cache behavior"))
      .find((behavior) => behavior["PathPattern"] === "/api/*");
    expect(apiBehavior?.["ResponseHeadersPolicyId"]).toEqual({
      Ref: apiPolicyLogicalId,
    });
    template.resourceCountIs("AWS::WAFv2::WebACL", 0);
  });

  test("synthesizes bounded owned rate controls or attaches one reviewed external Web ACL", () => {
    const base = createDevEnvironmentConfig();
    const ownedConfig = defineEnvironmentConfig({
      ...base,
      features: { ...base.features, waf: true },
    });
    const ownedStage = new CloudMarkupStage(
      createTemplateTestApp(),
      "OwnedWafFixture",
      {
        config: ownedConfig,
      },
    );
    const ownedApplication = Template.fromStack(ownedStage.application);
    ownedApplication.resourceCountIs("AWS::WAFv2::WebACL", 1);
    ownedApplication.resourceCountIs("AWS::WAFv2::WebACLAssociation", 1);
    const regionalWebAcl = propertyObjects(
      ownedApplication,
      "AWS::WAFv2::WebACL",
    )[0];
    expect(regionalWebAcl).toEqual(
      expect.objectContaining({
        DefaultAction: { Allow: {} },
        Name: "cloudmarkup-dev-regional-origin-access",
        Scope: "REGIONAL",
        VisibilityConfig: {
          CloudWatchMetricsEnabled: true,
          MetricName: "cloudmarkup-dev-regional-origin-access",
          SampledRequestsEnabled: false,
        },
      }),
    );
    const regionalRules = regionalWebAcl?.["Rules"];
    if (!Array.isArray(regionalRules) || regionalRules.length !== 1) {
      throw new TypeError("the regional origin Web ACL must own one rule.");
    }
    const regionalRule = record(regionalRules[0], "regional origin rule");
    expect(regionalRule).toEqual(
      expect.objectContaining({
        Action: { Block: {} },
        Name: "RequireCloudFrontOriginMarker",
        Priority: 0,
      }),
    );
    const notStatement = record(
      record(regionalRule["Statement"], "regional rule statement")[
        "NotStatement"
      ],
      "regional not statement",
    );
    const byteMatch = record(
      record(notStatement["Statement"], "regional nested statement")[
        "ByteMatchStatement"
      ],
      "regional byte match",
    );
    expect(byteMatch["PositionalConstraint"]).toBe("EXACTLY");
    expect(byteMatch["TextTransformations"]).toEqual([
      { Priority: 0, Type: "NONE" },
    ]);
    expect(byteMatch["FieldToMatch"]).toEqual({
      SingleHeader: { Name: "x-cloudmarkup-edge-origin" },
    });
    expect(JSON.stringify(byteMatch["SearchString"])).toContain(
      "resolve:secretsmanager",
    );
    expect(
      JSON.stringify(
        record(ownedApplication.toJSON(), "owned application template")[
          "Outputs"
        ] ?? {},
      ),
    ).not.toContain("resolve:secretsmanager");
    const association = propertyObjects(
      ownedApplication,
      "AWS::WAFv2::WebACLAssociation",
    )[0];
    expect(JSON.stringify(association?.["ResourceArn"])).toContain(
      "/restapis/",
    );
    expect(JSON.stringify(association?.["ResourceArn"])).toContain("/stages/");
    const ownedTemplate = Template.fromStack(ownedStage.edge);
    ownedTemplate.resourceCountIs("AWS::WAFv2::WebACL", 1);
    const webAcl = propertyObjects(ownedTemplate, "AWS::WAFv2::WebACL")[0];
    expect(webAcl?.["DefaultAction"]).toEqual({ Allow: {} });
    expect(webAcl?.["Scope"]).toBe("CLOUDFRONT");
    expect(webAcl?.["VisibilityConfig"]).toEqual({
      CloudWatchMetricsEnabled: true,
      MetricName: "cloudmarkup-dev-edge-rate-controls",
      SampledRequestsEnabled: false,
    });
    const rules = webAcl?.["Rules"];
    if (!Array.isArray(rules)) {
      throw new TypeError("the owned Web ACL must contain rules.");
    }
    const byName = new Map(
      rules.map((rule: unknown) => {
        const item = record(rule, "Web ACL rule");
        return [item["Name"], item] as const;
      }),
    );
    for (const [name, priority, limit, path] of [
      ["WebhookRateControl", 0, 500, "/api/webhooks/"],
      ["ApiRateControl", 1, 2_000, "/api/"],
    ] as const) {
      const rule = byName.get(name);
      expect(rule?.["Priority"]).toBe(priority);
      expect(rule?.["Action"]).toEqual({
        Block: { CustomResponse: { ResponseCode: 429 } },
      });
      expect(rule?.["VisibilityConfig"]).toEqual({
        CloudWatchMetricsEnabled: true,
        MetricName: name,
        SampledRequestsEnabled: false,
      });
      const rateStatement = record(
        record(rule?.["Statement"], "rule statement")["RateBasedStatement"],
        "rate statement",
      );
      expect(rateStatement).toEqual(
        expect.objectContaining({
          AggregateKeyType: "IP",
          EvaluationWindowSec: 300,
          Limit: limit,
        }),
      );
      const scopeDown = record(
        rateStatement["ScopeDownStatement"],
        "scope down statement",
      );
      const byteMatch = record(
        scopeDown["ByteMatchStatement"],
        "byte match statement",
      );
      expect(byteMatch["SearchString"]).toBe(path);
      expect(byteMatch["PositionalConstraint"]).toBe("STARTS_WITH");
    }
    const ownedDistribution = propertyObjects(
      ownedTemplate,
      "AWS::CloudFront::Distribution",
    )[0];
    expect(JSON.stringify(ownedDistribution?.["DistributionConfig"])).toContain(
      "EdgeRateControls",
    );
    const ownedObservability = JSON.stringify(
      Template.fromStack(ownedStage.observability).toJSON(),
    );
    expect(ownedObservability).toContain("AWS/WAFV2");
    expect(ownedObservability).toContain("BlockedRequests");
    expect(ownedObservability).toContain("cloudmarkup-dev-edge-rate-controls");
    expect(ownedObservability).toContain("WafBlockedRequestAlarm");
    expect(ownedObservability).toContain(
      "cloudmarkup-dev-regional-origin-access",
    );
    expect(ownedObservability).toContain("RequireCloudFrontOriginMarker");
    expect(ownedObservability).toContain("RegionalOriginBlockedRequestAlarm");

    const externalWafArn =
      "arn:aws:wafv2:us-east-1:000000000000:global/webacl/cloudmarkup/11111111-2222-3333-4444-555555555555";
    const externalConfig = defineEnvironmentConfig({
      ...base,
      domain: {
        certificateArn:
          "arn:aws:acm:us-east-1:000000000000:certificate/11111111-2222-3333-4444-555555555555",
        createDnsRecords: false,
        domainName: "app.example.com",
        hostedZoneId: "Z1234567890ABC",
        hostedZoneName: "example.com",
        wafWebAclArn: externalWafArn,
        wafWebAclMetricName: "CloudMarkupExternalRateControls",
      },
      features: { ...base.features, waf: true },
    });
    const externalStage = new CloudMarkupStage(
      createTemplateTestApp(),
      "ExternalWafFixture",
      { config: externalConfig },
    );
    const externalTemplate = Template.fromStack(externalStage.edge);
    externalTemplate.resourceCountIs("AWS::WAFv2::WebACL", 0);
    const externalDistribution = propertyObjects(
      externalTemplate,
      "AWS::CloudFront::Distribution",
    )[0];
    const externalDistributionConfig = record(
      externalDistribution?.["DistributionConfig"],
      "external distribution config",
    );
    expect(externalDistributionConfig["WebACLId"]).toBe(externalWafArn);
    const externalObservability = JSON.stringify(
      Template.fromStack(externalStage.observability).toJSON(),
    );
    expect(externalObservability).toContain("AWS/WAFV2");
    expect(externalObservability).toContain("BlockedRequests");
    expect(externalObservability).toContain("CloudMarkupExternalRateControls");
    expect(externalObservability).toContain("WafBlockedRequestAlarm");
  }, 120_000);

  test("synthesizes deterministically from the same reviewed configuration", () => {
    const first = devStage("DeterministicFixture");
    const second = devStage("DeterministicFixture");
    const firstTemplates = [
      first.observability,
      first.stateful,
      first.application,
      first.edge,
    ].map((stack) => Template.fromStack(stack).toJSON());
    const secondTemplates = [
      second.observability,
      second.stateful,
      second.application,
      second.edge,
    ].map((stack) => Template.fromStack(stack).toJSON());

    expect(secondTemplates).toEqual(firstTemplates);
  }, 30_000);
});
