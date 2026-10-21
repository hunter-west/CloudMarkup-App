import { Annotations, type IAspect, aws_s3 as s3 } from "aws-cdk-lib";
import type { IConstruct } from "constructs";

/**
 * Focused synth-time guard for controls that must never depend on a reviewer
 * remembering a stack convention. CDK assertions and the assembly IAM scanner
 * cover the remaining platform policy. There are intentionally no suppressions.
 */
export class PlatformSecurityAspect implements IAspect {
  public visit(node: IConstruct): void {
    if (!(node instanceof s3.CfnBucket)) return;

    const publicAccess = node.publicAccessBlockConfiguration as
      s3.CfnBucket.PublicAccessBlockConfigurationProperty | undefined;
    if (
      publicAccess?.blockPublicAcls !== true ||
      publicAccess.blockPublicPolicy !== true ||
      publicAccess.ignorePublicAcls !== true ||
      publicAccess.restrictPublicBuckets !== true
    ) {
      Annotations.of(node).addError(
        "CloudMarkup platform buckets must block every form of public access.",
      );
    }
    if (node.bucketEncryption === undefined) {
      Annotations.of(node).addError(
        "CloudMarkup platform buckets must configure encryption at rest.",
      );
    }
  }
}
