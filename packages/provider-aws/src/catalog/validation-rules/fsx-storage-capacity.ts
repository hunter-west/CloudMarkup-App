import { defineProviderValidationRuleDescriptorV1 } from "@cloudmarkup/provider-sdk";
import {
  fsxStorageCapacityDocumentation,
  fsxStorageCapacityValidationRuleId,
} from "../services/fsx-capacity.js";
export const fsxStorageCapacityValidationRuleDescriptor =
  defineProviderValidationRuleDescriptorV1({
    id: fsxStorageCapacityValidationRuleId,
    interfaceVersion: 1,
    ruleVersion: "1.0.0",
    implementationId: fsxStorageCapacityValidationRuleId + ".evaluate",
    serviceIds: ["aws.fsx.lustre-file-system", "aws.fsx.ontap-file-system"],
    documentation: fsxStorageCapacityDocumentation,
  });
