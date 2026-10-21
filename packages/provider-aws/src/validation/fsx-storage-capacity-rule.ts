import type { ValidationFindingCandidate } from "@cloudmarkup/domain";
import { fsxStorageCapacityValidationRuleDescriptor as descriptor } from "../catalog/validation-rules/fsx-storage-capacity.js";
import {
  configurationValue,
  defineAwsValidationRuleV1,
  finding,
  nodeConfigurationLocation,
  type AwsValidationCatalogV1,
} from "./rule-helpers.js";

/** Exact capacity admission for the reviewed successor; never infers capacity, topology or cost intent. */
export function createFsxStorageCapacityRuleV1(
  catalog: AwsValidationCatalogV1,
) {
  return defineAwsValidationRuleV1({
    descriptor,
    catalog,
    evaluate(context) {
      const findings: ValidationFindingCandidate[] = [];
      context.document?.nodes.forEach((node, index) => {
        const lustre =
          node.semantic.serviceType === "aws.fsx.lustre-file-system";
        if (
          !lustre &&
          node.semantic.serviceType !== "aws.fsx.ontap-file-system"
        )
          return;
        const setting = configurationValue(
          node.semantic.configuration.values,
          "storageCapacity",
        );
        const capacity =
          setting?.kind === "integer" ? setting.value : undefined;
        const valid =
          typeof capacity === "number" &&
          Number.isSafeInteger(capacity) &&
          (lustre
            ? capacity >= 1200 &&
              capacity <= 2400000 &&
              (capacity === 1200 || capacity % 2400 === 0)
            : capacity >= 1024 && capacity <= 524288);
        if (valid) return;
        findings.push(
          finding(descriptor, {
            code: lustre
              ? "aws.validation.fsx-lustre-storage-capacity"
              : "aws.validation.fsx-ontap-storage-capacity",
            severity: "error",
            title: lustre
              ? "Choose a supported Lustre storage size"
              : "Choose a supported ONTAP storage size",
            beginnerExplanation: lustre
              ? "Choose 1,200 GiB or a multiple of 2,400 GiB for this Lustre file system. Review storage cost before changing the size."
              : "Choose between 1,024 and 524,288 GiB for this ONTAP file system. Review storage cost before changing the size.",
            technicalExplanation: lustre
              ? "The curated PERSISTENT_2 SSD mode requires integer capacity of 1,200 GiB or a multiple of 2,400 GiB, within the catalog limit of 2,400,000 GiB."
              : "The curated ONTAP mode renders one HA pair; its integer SSD capacity must be between 1,024 and 524,288 GiB. Multiple HA pairs are outside this configuration contract.",
            affected: [
              nodeConfigurationLocation(node, index, "storageCapacity"),
            ],
          }),
        );
      });
      return findings;
    },
  });
}
