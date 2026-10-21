import { awsKmsConnectionRules } from "./kms-connections.js";
import { awsLambdaS3ConnectionRules } from "./lambda-s3-connections.js";
import { awsFsxConnectionRules } from "./fsx-connections.js";
import { awsNotesApiConnectionRulesV1 as notesApiConnectionRules } from "./notes-api-connections.js";
import { awsEventDrivenConnectionRulesV1 } from "./event-driven-connections.js";
import { awsNetworkingConnectionRulesV1 } from "./networking-connections.js";
import { awsOwnedConfigurationConnectionRulesV1 } from "./owned-configuration-connections.js";
import { awsSecretConnectionRules } from "./secrets-connections.js";
import { awsEc2ConnectionRules } from "./ec2-connections.js";
import { awsEcsConnectionRules } from "./ecs-connections.js";
import { awsRdsConnectionRules } from "./rds-connections.js";
import { awsAuroraConnectionRules } from "./aurora-connections.js";
import { awsDnsConnectionRules } from "./dns-acm-connections.js";
import { awsCloudfrontConnectionRules } from "./cloudfront-connections.js";
import { awsElbConnectionRules } from "./elb-connections.js";
import { awsEbsConnectionRules } from "./ebs-connections.js";

export { awsNetworkingConnectionRulesV1 } from "./networking-connections.js";
export { awsEventDrivenConnectionRulesV1 } from "./event-driven-connections.js";
export { awsOwnedConfigurationConnectionRulesV1 } from "./owned-configuration-connections.js";

export const awsNotesApiConnectionRulesV1 = [
  ...notesApiConnectionRules,
  ...awsOwnedConfigurationConnectionRulesV1,
  ...awsNetworkingConnectionRulesV1,
  ...awsEventDrivenConnectionRulesV1,
  ...awsFsxConnectionRules,
  ...awsLambdaS3ConnectionRules,
  ...awsKmsConnectionRules,
  ...awsSecretConnectionRules,
  ...awsEc2ConnectionRules,
  ...awsEcsConnectionRules,
  ...awsRdsConnectionRules,
  ...awsAuroraConnectionRules,
  ...awsDnsConnectionRules,
  ...awsCloudfrontConnectionRules,
  ...awsElbConnectionRules,
  ...awsEbsConnectionRules,
];
