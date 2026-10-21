import { modelRoutingConfigurationV1Schema } from "@cloudmarkup/model-gateway";
import type {
  ModelCapabilityRegistryV1,
  ModelRouteRegistryV1,
} from "@cloudmarkup/schemas";
/** Exact no-fallback routing identity shared by private live request hosts. */
export function projectModelLiveRoutingConfiguration(configured: {
  readonly capabilityRegistry: ModelCapabilityRegistryV1;
  readonly routeRegistry: ModelRouteRegistryV1;
}) {
  return modelRoutingConfigurationV1Schema.parse({
    allowFallback: false,
    configurationId: configured.routeRegistry.routeRegistryId,
    configurationVersion: configured.routeRegistry.routeRegistryVersion,
    routes: configured.capabilityRegistry.capabilities.flatMap((capability) =>
      capability.roles.map((role) => ({
        role,
        candidates: [
          {
            providerId: capability.providerId,
            modelId: capability.modelId,
            inferenceProfileId: capability.inferenceProfileId,
            priority: 0,
          },
        ],
      })),
    ),
  });
}
