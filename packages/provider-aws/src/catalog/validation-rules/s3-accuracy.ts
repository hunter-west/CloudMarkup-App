import { defineProviderValidationRuleDescriptorV1 } from "@cloudmarkup/provider-sdk";

export const s3BucketNameValidationRuleDescriptor =
  defineProviderValidationRuleDescriptorV1({
    id: "aws.cloudmarkup.validation.s3-bucket-name",
    interfaceVersion: 1,
    ruleVersion: "1.0.0",
    implementationId: "aws.cloudmarkup.validation.s3-bucket-name.evaluate",
    serviceIds: ["aws.s3.bucket"],
    documentation: [
      {
        kind: "official",
        id: "aws.s3.documentation.bucket-names",
        title: "General purpose bucket naming rules",
        publisher: "Amazon Web Services",
        url: "https://docs.aws.amazon.com/AmazonS3/latest/userguide/bucketnamingrules.html",
      },
    ],
  });

export const s3NotificationFiltersValidationRuleDescriptor =
  defineProviderValidationRuleDescriptorV1({
    id: "aws.cloudmarkup.validation.s3-notification-filters",
    interfaceVersion: 1,
    ruleVersion: "1.0.0",
    implementationId:
      "aws.cloudmarkup.validation.s3-notification-filters.evaluate",
    serviceIds: ["aws.s3.bucket"],
    documentation: [
      {
        kind: "official",
        id: "aws.s3.documentation.notification-filters",
        title: "S3 notification object-key filtering",
        publisher: "Amazon Web Services",
        url: "https://docs.aws.amazon.com/AmazonS3/latest/userguide/notification-how-to-filtering.html",
      },
    ],
  });
