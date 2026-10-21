import { deepFreeze } from "./accessors.js";
import type { ProviderOwnedConfigurationSlotV1 } from "./provider-extension-contract-v1.js";
import {
  providerServiceExtensionArtifactV1Schema,
  type ProviderServiceExtensionArtifactV1,
  type ProviderServiceExtensionDefinitionV1,
} from "./provider-service-extension-contract-v1.js";

export interface ProviderServiceExtensionAccessorsV1 {
  readonly artifact: Readonly<ProviderServiceExtensionArtifactV1>;
  getServiceExtension(
    serviceId: string,
  ): Readonly<ProviderServiceExtensionDefinitionV1> | undefined;
  requireServiceExtension(
    serviceId: string,
  ): Readonly<ProviderServiceExtensionDefinitionV1>;
  getOwnedConfigurationSlots(
    serviceId: string,
  ): readonly Readonly<ProviderOwnedConfigurationSlotV1>[];
  getOwnedConfigurationSlot(
    serviceId: string,
    slotId: string,
  ): Readonly<ProviderOwnedConfigurationSlotV1> | undefined;
}

export function createProviderServiceExtensionAccessorsV1(
  artifactInput: unknown,
): ProviderServiceExtensionAccessorsV1 {
  const artifact = deepFreeze(
    providerServiceExtensionArtifactV1Schema.parse(artifactInput),
  );
  const servicesById = new Map(
    artifact.services.map((extension) => [
      String(extension.serviceId),
      extension,
    ]),
  );
  const slotsByServiceAndId = new Map<
    string,
    ProviderOwnedConfigurationSlotV1
  >();
  for (const extension of artifact.services) {
    for (const slot of extension.ownedConfigurationSlots) {
      slotsByServiceAndId.set(`${extension.serviceId}\u0000${slot.id}`, slot);
    }
  }

  function requireServiceExtension(
    serviceId: string,
  ): Readonly<ProviderServiceExtensionDefinitionV1> {
    const extension = servicesById.get(serviceId);
    if (extension === undefined) {
      throw new TypeError(
        "The requested service is not present in this provider service extension.",
      );
    }
    return extension;
  }

  return Object.freeze({
    artifact,
    getServiceExtension: (serviceId: string) => servicesById.get(serviceId),
    requireServiceExtension,
    getOwnedConfigurationSlots: (serviceId: string) =>
      requireServiceExtension(serviceId).ownedConfigurationSlots,
    getOwnedConfigurationSlot: (serviceId: string, slotId: string) =>
      slotsByServiceAndId.get(`${serviceId}\u0000${slotId}`),
  });
}
