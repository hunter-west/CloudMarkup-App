import { DefaultStackSynthesizer, PermissionsBoundary } from "aws-cdk-lib";

export const BETA_CDK_BOOTSTRAP = Object.freeze({
  apiGatewayLoggingRoleArn:
    "arn:aws:iam::${AWS::AccountId}:role/cloudmarkup-beta-api-gateway-logging",
  apiGatewayLoggingRoleName: "cloudmarkup-beta-api-gateway-logging",
  apiRuntimeRoleArn:
    "arn:aws:iam::${AWS::AccountId}:role/CloudMarkup-Beta-API-Runtime",
  apiRuntimeRoleName: "CloudMarkup-Beta-API-Runtime",
  billingWebhookRuntimeRoleName: "CloudMarkup-Beta-Billing-Webhook-Runtime",
  billingWorkerRuntimeRoleName: "CloudMarkup-Beta-Billing-Worker-Runtime",
  solutionExportWorkerRuntimeRoleName:
    "CloudMarkup-Beta-Solution-Export-Worker-Runtime",
  betaProposalWorkerRuntimeRoleName: "CloudMarkup-Beta-Proposal-Worker-Runtime",
  projectCleanupRuntimeRoleName: "CloudMarkup-Beta-Project-Cleanup-Runtime",
  bootstrapVersionParameter: "/cloudmarkup/beta/cdk-bootstrap/version",
  cloudFormationExecutionRoleArn:
    "arn:aws:iam::${AWS::AccountId}:role/CloudMarkup-Beta-CloudFormation-Execution",
  deployRoleArn:
    "arn:aws:iam::${AWS::AccountId}:role/CloudMarkup-Beta-CDK-Deploy",
  fileAssetPublishingRoleArn:
    "arn:aws:iam::${AWS::AccountId}:role/CloudMarkup-Beta-CDK-File-Publishing",
  fileAssetsBucketName:
    "cloudmarkup-beta-cdk-assets-${AWS::AccountId}-${AWS::Region}",
  apiSecurityHeadersPolicyIdExportName:
    "cloudmarkup-beta-bootstrap:ApiSecurityHeadersPolicyId",
  lookupRoleArn:
    "arn:aws:iam::${AWS::AccountId}:role/CloudMarkup-Beta-CDK-Lookup",
  databaseMigratorRuntimeRoleArn:
    "arn:aws:iam::${AWS::AccountId}:role/CloudMarkup-Beta-Database-Migrator-Runtime",
  databaseMigratorRuntimeRoleName: "CloudMarkup-Beta-Database-Migrator-Runtime",
  qualifier: "cmkbeta",
  runtimePermissionsBoundaryArn:
    "arn:aws:iam::${AWS::AccountId}:policy/CloudMarkup-Beta-Runtime-Boundary",
  publicAssetHeadersPolicyIdExportName:
    "cloudmarkup-beta-bootstrap:PublicAssetHeadersPolicyId",
  securityHeadersPolicyIdExportName:
    "cloudmarkup-beta-bootstrap:SecurityHeadersPolicyId",
  webOriginAccessControlIdExportName:
    "cloudmarkup-beta-bootstrap:WebOriginAccessControlId",
  webDeploymentRuntimeRoleArn:
    "arn:aws:iam::${AWS::AccountId}:role/CloudMarkup-Beta-Web-Deployment-Runtime",
  webDeploymentRuntimeRoleName: "CloudMarkup-Beta-Web-Deployment-Runtime",
});

/**
 * Bind every beta stack and file asset to the private native bootstrap.
 * Docker assets intentionally target nonexistent sentinel resources; the
 * release gate independently rejects any Docker asset before deployment.
 */
export function createBetaStackSynthesizer(): DefaultStackSynthesizer {
  return new DefaultStackSynthesizer({
    bootstrapStackVersionSsmParameter:
      BETA_CDK_BOOTSTRAP.bootstrapVersionParameter,
    bucketPrefix: "assets/",
    cloudFormationExecutionRole:
      BETA_CDK_BOOTSTRAP.cloudFormationExecutionRoleArn,
    deployRoleArn: BETA_CDK_BOOTSTRAP.deployRoleArn,
    dockerTagPrefix: "disabled-",
    fileAssetPublishingRoleArn: BETA_CDK_BOOTSTRAP.fileAssetPublishingRoleArn,
    fileAssetsBucketName: BETA_CDK_BOOTSTRAP.fileAssetsBucketName,
    generateBootstrapVersionRule: true,
    imageAssetPublishingRoleArn:
      "arn:aws:iam::${AWS::AccountId}:role/CloudMarkup-Beta-CDK-Image-Publishing-DISABLED",
    imageAssetsRepositoryName: "cloudmarkup-beta-docker-assets-disabled",
    lookupRoleArn: BETA_CDK_BOOTSTRAP.lookupRoleArn,
    qualifier: BETA_CDK_BOOTSTRAP.qualifier,
    useLookupRoleForStackOperations: true,
  });
}

export function betaRuntimePermissionsBoundary(): PermissionsBoundary {
  return PermissionsBoundary.fromArn(
    BETA_CDK_BOOTSTRAP.runtimePermissionsBoundaryArn,
  );
}
