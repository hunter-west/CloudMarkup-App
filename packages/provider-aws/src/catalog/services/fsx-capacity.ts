import {
  defineProviderServiceV1,
  type ProviderServiceDefinitionV1,
} from "@cloudmarkup/provider-sdk";

import { configurationKeySchema } from "@cloudmarkup/schemas";

export const fsxStorageCapacityValidationRuleId =
  "aws.cloudmarkup.validation.fsx-storage-capacity";
export const fsxStorageCapacityDocumentation = [
  {
    kind: "official" as const,
    id: "aws.fsx.documentation.storage-capacity",
    title: "FSx storage capacity by deployment type and HA pairs",
    publisher: "Amazon Web Services",
    url: "https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-fsx-filesystem.html#cfn-fsx-filesystem-storagecapacity",
  },
];
/** A successor catalog tightens admission without changing the typed configuration envelope or choosing a capacity. */
export function withFsxCapacityAccuracy(
  service: ProviderServiceDefinitionV1,
): ProviderServiceDefinitionV1 {
  const lustre = service.id === "aws.fsx.lustre-file-system";
  if (!lustre && service.id !== "aws.fsx.ontap-file-system") return service;
  const property =
    service.configuration.jsonSchema.properties[
      configurationKeySchema.parse("storageCapacity")
    ];
  if (property?.type !== "integer")
    throw new TypeError("FSx storage capacity must remain an integer field.");
  const help = lustre
    ? "PERSISTENT_2 SSD accepts 1,200 GiB or a multiple of 2,400 GiB, up to this catalog's 2,400,000 GiB limit. Capacity changes affect cost and require review."
    : "The modeled single HA pair accepts 1,024 to 524,288 GiB of SSD storage. Capacity changes affect cost and require review.";
  return defineProviderServiceV1({
    ...service,
    definitionVersion: "1.1.0",
    configuration: {
      ...service.configuration,
      jsonSchema: {
        ...service.configuration.jsonSchema,
        properties: {
          ...service.configuration.jsonSchema.properties,
          storageCapacity: {
            ...property,
            maximum: lustre ? 2400000 : 524288,
            description: help,
          },
        },
      },
      uiHints: service.configuration.uiHints.map((hint) =>
        hint.property === "storageCapacity"
          ? { ...hint, helpText: help }
          : hint,
      ),
    },
    validationRuleIds: [
      ...service.validationRuleIds,
      fsxStorageCapacityValidationRuleId,
    ],
    education: {
      ...service.education,
      considerations: service.education.considerations.map((consideration) =>
        consideration.startsWith("Operations:")
          ? lustre
            ? "Operations: PERSISTENT_2 SSD uses 1,200 GiB or multiples of 2,400 GiB. Select explicit repository associations for S3 data and review capacity and throughput changes."
            : "Operations: This mode has one HA pair and accepts 1,024 to 524,288 GiB. Add a storage virtual machine and volume, and review capacity and throughput changes."
          : consideration,
      ),
      documentation: [
        ...service.education.documentation,
        ...fsxStorageCapacityDocumentation,
      ],
    },
  });
}
