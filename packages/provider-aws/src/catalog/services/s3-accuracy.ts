import {
  defineProviderServiceV1,
  type ProviderServiceDefinitionV1,
} from "@cloudmarkup/provider-sdk";
import { configurationKeySchema } from "@cloudmarkup/schemas";
import { s3SharedBucketNamePattern } from "../../s3-accuracy-contract.js";
import {
  s3BucketNameValidationRuleDescriptor,
  s3NotificationFiltersValidationRuleDescriptor,
} from "../validation-rules/s3-accuracy.js";

export function withS3Accuracy(
  service: ProviderServiceDefinitionV1,
): ProviderServiceDefinitionV1 {
  if (service.id !== "aws.s3.bucket") return service;
  const property =
    service.configuration.jsonSchema.properties[
      configurationKeySchema.parse("bucketName")
    ];
  if (property?.type !== "string")
    throw new TypeError("S3 bucket names must remain literal strings.");
  return defineProviderServiceV1({
    ...service,
    definitionVersion: "1.3.0",
    configuration: {
      ...service.configuration,
      jsonSchema: {
        ...service.configuration.jsonSchema,
        properties: {
          ...service.configuration.jsonSchema.properties,
          bucketName: {
            ...property,
            pattern: s3SharedBucketNamePattern,
            description:
              "A shared-namespace name, 3–63 lowercase letters, numbers, dots or hyphens. Adjacent dots, IP-style names and reserved AWS prefixes/suffixes are unsupported. Availability is checked by AWS at creation.",
          },
        },
      },
      uiHints: service.configuration.uiHints.map((hint) =>
        hint.property === "bucketName"
          ? {
              ...hint,
              helpText:
                "Choose a non-sensitive, unique name with 3–63 lowercase letters, numbers, dots or hyphens. Avoid adjacent dots, IP-style names and reserved names. Renaming an existing bucket can replace it.",
            }
          : hint,
      ),
    },
    validationRuleIds: [
      ...service.validationRuleIds,
      s3BucketNameValidationRuleDescriptor.id,
      s3NotificationFiltersValidationRuleDescriptor.id,
    ],
    education: {
      ...service.education,
      considerations: service.education.considerations.map((value) =>
        value.startsWith("Operations:")
          ? "Operations: Shared-namespace bucket names are immutable after creation. Direct Lambda notifications for the same event family require non-overlapping object-key filters; empty filters match all keys."
          : value,
      ),
      documentation: [
        ...service.education.documentation,
        ...s3BucketNameValidationRuleDescriptor.documentation,
        ...s3NotificationFiltersValidationRuleDescriptor.documentation,
      ],
    },
  });
}
