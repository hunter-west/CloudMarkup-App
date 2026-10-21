import {
  Duration,
  RemovalPolicy,
  Stack,
  Validations,
  type StackProps,
  aws_ec2 as ec2,
  aws_dynamodb as dynamodb,
  aws_rds as rds,
  aws_s3 as s3,
  aws_secretsmanager as secretsmanager,
} from "aws-cdk-lib";
import type { Construct } from "constructs";

import type { EnvironmentConfig } from "../config/environment-config.js";
import type { PlatformResourceNames } from "../platform-names.js";

export const BETA_DATABASE_NETWORK = Object.freeze({
  account: "000000000000",
  defaultSecurityGroupId: "sg-00000000000000001",
  region: "us-east-1",
  subnetIds: Object.freeze([
    "subnet-00000000000000001",
    "subnet-00000000000000002",
    "subnet-00000000000000003",
    "subnet-00000000000000004",
    "subnet-00000000000000005",
    "subnet-00000000000000006",
  ]),
  vpcId: "vpc-00000000000000001",
});

export interface StatefulStackProps extends StackProps {
  readonly config: EnvironmentConfig;
  readonly names: PlatformResourceNames;
}

export interface PlatformDatabaseCluster {
  readonly clusterArn: string;
  readonly secret?: secretsmanager.ISecret;
}

/**
 * Durable CloudMarkup metadata and versioned content. The content bucket uses
 * explicit purpose prefixes because the current object-store adapter owns one
 * versioned bucket. Evidence and immutable document versions never receive an
 * expiry rule; only replaceable generated artifacts do.
 */
export class StatefulStack extends Stack {
  private platformVpc?: ec2.Vpc;
  public readonly accessLogBucket: s3.Bucket;
  public readonly cluster: PlatformDatabaseCluster;
  public readonly contentBucket: s3.Bucket;
  public readonly edgeOriginVerificationSecret: secretsmanager.Secret;
  public readonly cleanupWakeTable?: dynamodb.CfnTable;

  public get vpc(): ec2.Vpc {
    const vpc = this.platformVpc;
    if (vpc === undefined) {
      throw new TypeError(
        "The beta Data API database does not expose a platform VPC.",
      );
    }
    return vpc;
  }

  public constructor(scope: Construct, id: string, props: StatefulStackProps) {
    super(scope, id, props);

    if (
      props.config.integrations.projectCleanupWake?.preparationEnabled === true
    ) {
      if (
        props.config.environment !== "beta" ||
        props.config.database.minCapacityAcu < 0.5 ||
        props.config.database.betaAutoPauseEnabled === true
      )
        throw new TypeError(
          "Cleanup wake preparation requires beta SQL recovery.",
        );
      this.cleanupWakeTable = new dynamodb.CfnTable(this, "CleanupWakeLedger", {
        tableName: "cloudmarkup-beta-cleanup-wakes",
        billingMode: "PAY_PER_REQUEST",
        attributeDefinitions: [
          { attributeName: "PK", attributeType: "S" },
          { attributeName: "SK", attributeType: "S" },
        ],
        keySchema: [
          { attributeName: "PK", keyType: "HASH" },
          { attributeName: "SK", keyType: "RANGE" },
        ],
        sseSpecification: { sseEnabled: true },
        deletionProtectionEnabled: true,
        pointInTimeRecoverySpecification: {
          pointInTimeRecoveryEnabled: true,
          recoveryPeriodInDays: 14,
        },
        streamSpecification: { streamViewType: "NEW_IMAGE" },
      });
      this.cleanupWakeTable.applyRemovalPolicy(RemovalPolicy.RETAIN);
    }

    const removalPolicy =
      props.config.lifecycle.removalPolicy === "retain"
        ? RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE
        : RemovalPolicy.DESTROY;

    this.accessLogBucket = new s3.Bucket(this, "AccessLogs", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      bucketName: props.names.accessLogBucket,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      lifecycleRules: [
        {
          expiration: Duration.days(props.config.retention.accessLogsDays),
          id: "ExpireAccessLogs",
          noncurrentVersionExpiration: Duration.days(
            props.config.retention.accessLogsDays,
          ),
        },
      ],
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_PREFERRED,
      removalPolicy,
      versioned: true,
    });

    this.contentBucket = new s3.Bucket(this, "VersionedContent", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      bucketName: props.names.contentBucket,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      lifecycleRules: [
        {
          expiration: Duration.days(props.config.retention.artifactDays),
          id: "ExpireReplaceableArtifactsOnly",
          noncurrentVersionExpiration: Duration.days(
            props.config.retention.noncurrentObjectVersionsDays,
          ),
          prefix: props.names.artifactPrefix,
        },
      ],
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      removalPolicy,
      serverAccessLogsBucket: this.accessLogBucket,
      serverAccessLogsPrefix: "content/",
      versioned: true,
    });

    this.edgeOriginVerificationSecret = new secretsmanager.Secret(
      this,
      "EdgeOriginVerification",
      {
        description:
          "Generated CloudFront-to-API defense-in-depth value; never output or supplied by an operator",
        generateSecretString: {
          excludePunctuation: true,
          includeSpace: false,
          passwordLength: 64,
        },
        removalPolicy,
        secretName: props.names.edgeOriginVerificationSecret,
      },
    );

    if (props.config.environment === "beta") {
      if (
        props.config.target.account !== BETA_DATABASE_NETWORK.account ||
        props.config.target.region !== BETA_DATABASE_NETWORK.region
      ) {
        throw new TypeError(
          "The beta database network is bound to the reviewed application account and Region.",
        );
      }
      const betaDatabaseSecret = new secretsmanager.Secret(
        this,
        "DatabaseAdmin",
        {
          generateSecretString: {
            excludeCharacters: " '\"@/\\",
            generateStringKey: "password",
            secretStringTemplate: JSON.stringify({
              username: "cloudmarkup_admin",
            }),
          },
          removalPolicy,
          secretName: props.names.databaseSecret,
        },
      );
      const betaSubnetGroup = new rds.CfnDBSubnetGroup(
        this,
        "PostgresqlSubnetGroup",
        {
          dbSubnetGroupDescription:
            "Reviewed default-VPC subnets for the private beta Aurora cluster",
          dbSubnetGroupName: `${props.names.databaseCluster}-subnets`,
          subnetIds: [...BETA_DATABASE_NETWORK.subnetIds],
        },
      );
      betaSubnetGroup.applyRemovalPolicy(removalPolicy);
      const betaCluster = new rds.CfnDBCluster(this, "Postgresql", {
        backupRetentionPeriod: props.config.database.backupRetentionDays,
        copyTagsToSnapshot: true,
        databaseName: "cloudmarkup",
        dbClusterIdentifier: props.names.databaseCluster,
        dbSubnetGroupName: betaSubnetGroup.ref,
        deleteAutomatedBackups: false,
        deletionProtection: props.config.lifecycle.deletionProtection,
        enableCloudwatchLogsExports: ["postgresql"],
        enableHttpEndpoint: true,
        engine: "aurora-postgresql",
        engineMode: "provisioned",
        engineVersion: "16.8",
        masterUserPassword: betaDatabaseSecret
          .secretValueFromJson("password")
          .unsafeUnwrap(),
        masterUsername: "cloudmarkup_admin",
        port: 5432,
        serverlessV2ScalingConfiguration: {
          maxCapacity: props.config.database.maxCapacityAcu,
          minCapacity: props.config.database.minCapacityAcu,
          ...(props.config.database.autoPauseMinutes === undefined
            ? {}
            : {
                secondsUntilAutoPause:
                  props.config.database.autoPauseMinutes * 60,
              }),
        },
        storageEncrypted: true,
        vpcSecurityGroupIds: [BETA_DATABASE_NETWORK.defaultSecurityGroupId],
      });
      betaCluster.applyRemovalPolicy(removalPolicy);

      const betaWriter = new rds.CfnDBInstance(this, "PostgresqlWriter", {
        dbClusterIdentifier: betaCluster.ref,
        dbInstanceClass: "db.serverless",
        dbInstanceIdentifier: `${props.names.databaseCluster}-writer`,
        engine: "aurora-postgresql",
        publiclyAccessible: false,
      });
      betaWriter.addResourceDependency(betaCluster);
      betaWriter.applyRemovalPolicy(removalPolicy);
      Validations.of(betaWriter).acknowledge({
        id: "CloudFormation-Validate::W9008",
        reason:
          "Aurora instance encryption is managed by the StorageEncrypted beta cluster; AWS documents StorageEncrypted as not applicable to an Aurora DBInstance.",
      });

      new secretsmanager.CfnSecretTargetAttachment(
        this,
        "DatabaseAdminAttachment",
        {
          secretId: betaDatabaseSecret.secretArn,
          targetId: betaCluster.ref,
          targetType: "AWS::RDS::DBCluster",
        },
      );

      this.cluster = {
        clusterArn: betaCluster.attrDbClusterArn,
        secret: betaDatabaseSecret,
      };
      return;
    }

    this.platformVpc = new ec2.Vpc(this, "DatabaseNetwork", {
      ipAddresses: ec2.IpAddresses.cidr("10.40.0.0/20"),
      availabilityZones: [
        `${props.config.target.region}a`,
        `${props.config.target.region}b`,
      ],
      natGateways: 0,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: "database",
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        },
      ],
    });

    const cluster = new rds.DatabaseCluster(this, "Postgresql", {
      backup: {
        retention: Duration.days(props.config.database.backupRetentionDays),
      },
      cloudwatchLogsExports: ["postgresql"],
      clusterIdentifier: props.names.databaseCluster,
      copyTagsToSnapshot: true,
      credentials: rds.Credentials.fromGeneratedSecret("cloudmarkup_admin", {
        excludeCharacters: " '\"@/\\",
        secretName: props.names.databaseSecret,
      }),
      defaultDatabaseName: "cloudmarkup",
      deleteAutomatedBackups: props.config.environment !== "prod",
      deletionProtection: props.config.lifecycle.deletionProtection,
      enableDataApi: true,
      engine: rds.DatabaseClusterEngine.auroraPostgres({
        version: rds.AuroraPostgresEngineVersion.VER_16_8,
      }),
      removalPolicy,
      serverlessV2AutoPauseDuration:
        props.config.database.autoPauseMinutes === undefined
          ? undefined
          : Duration.minutes(props.config.database.autoPauseMinutes),
      serverlessV2MaxCapacity: props.config.database.maxCapacityAcu,
      serverlessV2MinCapacity: props.config.database.minCapacityAcu,
      storageEncrypted: true,
      vpc: this.platformVpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      writer: rds.ClusterInstance.serverlessV2("Writer", {
        publiclyAccessible: false,
      }),
    });
    cluster.secret?.applyRemovalPolicy(removalPolicy);
    this.cluster = cluster;
  }
}
