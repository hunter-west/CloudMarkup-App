import { deepFreeze } from "./accessors.js";
import {
  providerConnectionPresentationArtifactV1Schema,
  type ProviderConnectionDockV1,
  type ProviderConnectionPresentationArtifactV1,
  type ProviderServiceConnectionPresentationV1,
} from "./connection-presentation-contract-v1.js";

export interface ProviderConnectionPresentationAccessorsV1 {
  readonly artifact: Readonly<ProviderConnectionPresentationArtifactV1>;
  getServicePresentation(
    serviceId: string,
  ): Readonly<ProviderServiceConnectionPresentationV1> | undefined;
  requireServicePresentation(
    serviceId: string,
  ): Readonly<ProviderServiceConnectionPresentationV1>;
  getDock(
    serviceId: string,
    dockId: string,
  ): Readonly<ProviderConnectionDockV1> | undefined;
  dockForPort(
    serviceId: string,
    portId: string,
  ): Readonly<ProviderConnectionDockV1> | undefined;
  relationshipLabel(ruleId: string): string | undefined;
}

export function createProviderConnectionPresentationAccessorsV1(
  artifactInput: unknown,
): ProviderConnectionPresentationAccessorsV1 {
  const artifact = deepFreeze(
    providerConnectionPresentationArtifactV1Schema.parse(artifactInput),
  );
  const servicesById = new Map(
    artifact.services.map((service) => [String(service.serviceId), service]),
  );
  const docksByServiceAndId = new Map<string, ProviderConnectionDockV1>();
  const docksByServiceAndPort = new Map<string, ProviderConnectionDockV1>();
  for (const service of artifact.services) {
    for (const dock of service.docks) {
      docksByServiceAndId.set(`${service.serviceId}\u0000${dock.id}`, dock);
      for (const portId of dock.portIds) {
        docksByServiceAndPort.set(`${service.serviceId}\u0000${portId}`, dock);
      }
    }
  }
  const labelsByRuleId = new Map(
    artifact.relationshipLabels.map((relationship) => [
      String(relationship.ruleId),
      relationship.label,
    ]),
  );

  function requireServicePresentation(
    serviceId: string,
  ): Readonly<ProviderServiceConnectionPresentationV1> {
    const presentation = servicesById.get(serviceId);
    if (presentation === undefined) {
      throw new TypeError(
        "The requested service is not present in this connection presentation.",
      );
    }
    return presentation;
  }

  return Object.freeze({
    artifact,
    getServicePresentation: (serviceId: string) => servicesById.get(serviceId),
    requireServicePresentation,
    getDock: (serviceId: string, dockId: string) =>
      docksByServiceAndId.get(`${serviceId}\u0000${dockId}`),
    dockForPort: (serviceId: string, portId: string) =>
      docksByServiceAndPort.get(`${serviceId}\u0000${portId}`),
    relationshipLabel: (ruleId: string) => labelsByRuleId.get(ruleId),
  });
}
