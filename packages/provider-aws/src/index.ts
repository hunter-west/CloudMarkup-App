export {
  AWS_CATALOG_DIGEST_V1,
  awsCatalogArtifactV1,
  awsCatalogV1,
} from "./catalog-v1-accessors.js";
export {
  AWS_CONNECTION_PRESENTATION_DIGEST_V1,
  awsConnectionPresentationArtifactV1,
  awsConnectionPresentationV1,
} from "./connection-presentation-v1-accessors.js";
export {
  awsConnectionResolverV1,
  awsConnectionRuleRegistrationsV1,
} from "./connection-resolution.js";
export {
  AWS_EVENT_WORKLOAD_CONNECTION_METADATA_V1,
  AWS_EVENT_WORKLOAD_CONNECTION_METADATA_V2,
  type AwsEventWorkloadConnectionMetadataV1,
  type AwsEventWorkloadConnectionMetadataV2,
  type AwsEventWorkloadEndpointMetadataV1,
} from "./event-workload-metadata.js";
export {
  AWS_IAM_POLICY_INTERNAL_BINDINGS_V1,
  AWS_IAM_POLICY_RESOURCE_SCOPES_V1,
  projectAwsCanonicalPolicyDocumentsV1,
  type AwsCanonicalPolicyProjectionIssueCodeV1,
  type AwsCanonicalPolicyProjectionIssueV1,
  type AwsCanonicalPolicyProjectionOptionsV1,
  type AwsCanonicalPolicyProjectionResultV1,
  type AwsPolicyOwnerSlotDescriptorV1,
  type AwsPolicyResourceScopeDescriptorV1,
} from "./policy/index.js";
export {
  AWS_SERVICE_EXTENSION_DIGEST_V1,
  awsServiceExtensionArtifactV1,
  awsServiceExtensionV1,
} from "./service-extension-v1-accessors.js";
export {
  createAwsFrozenModelEvaluationRulesV1,
  awsValidationRuleRegistrationsV1,
  awsValidationRulesV1,
  createAwsValidationRuleRegistrationsV1,
  createCompilerReadinessRuleV1,
  createRegionAvailabilityRuleV1,
  type AwsValidationCatalogV1,
} from "./validation/index.js";

export { createAwsConnectionPresentationSourceV1 } from "./catalog/connection-presentation.js";
export { createAwsProviderServiceExtensionSourceV1 } from "./catalog/service-extension.js";

export {
  AWS_CURRENT_CATALOG_BINDING_V1,
  resolveAwsCurrentCatalogV1,
  type AwsCatalogBindingV1,
} from "./current-catalog.js";

export {
  AWS_FROZEN_MODEL_CATALOG_BINDING_V1,
  resolveAwsModelCatalogV1,
} from "./model-evaluation-catalog.js";
