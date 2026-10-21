import { defineProviderCatalogSourceV1 } from "@cloudmarkup/provider-sdk";

import { awsNotesApiConnectionRulesV1 } from "./connections/index.js";
import { awsCatalogMetadataV1, awsProviderMetadataV1 } from "./provider.js";
import { awsServicesV1 } from "./services/index.js";
import { awsValidationRuleDescriptorsV1 } from "./validation-rules/index.js";

export const awsCatalogSourceV1 = defineProviderCatalogSourceV1({
  contractVersion: 1,
  provider: awsProviderMetadataV1,
  catalog: awsCatalogMetadataV1,
  services: awsServicesV1,
  connectionRules: awsNotesApiConnectionRulesV1,
  validationRules: awsValidationRuleDescriptorsV1,
  migrations: [],
});
