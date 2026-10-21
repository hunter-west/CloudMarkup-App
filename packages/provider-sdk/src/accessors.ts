import type {
  ValidationPortInventory,
  ValidationPortInventoryEntry,
} from "@cloudmarkup/domain";
import type { NodeId } from "@cloudmarkup/schemas";

import {
  providerCatalogArtifactV1Schema,
  type ProviderCatalogArtifactV1,
  type ProviderConnectionRuleDescriptorV1,
  type ProviderPortDefinitionV1,
  type ProviderServiceDefinitionV1,
  type ProviderValidationRuleDescriptorV1,
} from "./catalog-contract-v1.js";
import {
  validateProviderServiceConfigurationV1,
  type ProviderConfigurationValidationResultV1,
} from "./configuration-validation.js";

export interface ProviderCatalogNodeBindingV1 {
  readonly nodeId: NodeId;
  readonly serviceId: string;
}

export interface ProviderCatalogAccessorsV1 {
  readonly artifact: Readonly<ProviderCatalogArtifactV1>;
  listServices(): readonly Readonly<ProviderServiceDefinitionV1>[];
  getService(
    serviceId: string,
  ): Readonly<ProviderServiceDefinitionV1> | undefined;
  requireService(serviceId: string): Readonly<ProviderServiceDefinitionV1>;
  getPorts(serviceId: string): readonly Readonly<ProviderPortDefinitionV1>[];
  validateConfiguration(
    serviceId: string,
    values: unknown,
  ): ProviderConfigurationValidationResultV1;
  listConnectionRules(): readonly Readonly<ProviderConnectionRuleDescriptorV1>[];
  listConnectionRulesForService(
    serviceId: string,
  ): readonly Readonly<ProviderConnectionRuleDescriptorV1>[];
  listConnectionRulesForPort(
    serviceId: string,
    portId: string,
  ): readonly Readonly<ProviderConnectionRuleDescriptorV1>[];
  getConnectionRule(
    ruleId: string,
  ): Readonly<ProviderConnectionRuleDescriptorV1> | undefined;
  listValidationRules(): readonly Readonly<ProviderValidationRuleDescriptorV1>[];
  getValidationRule(
    ruleId: string,
  ): Readonly<ProviderValidationRuleDescriptorV1> | undefined;
  createPortInventory(
    nodes: readonly ProviderCatalogNodeBindingV1[],
    coverage: "complete" | "partial",
  ): ValidationPortInventory;
}

export function deepFreeze<T>(value: T): Readonly<T> {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }

  Object.freeze(value);
  for (const nested of Object.values(value)) {
    deepFreeze(nested);
  }

  return value;
}

export function createProviderCatalogAccessorsV1(
  artifactInput: unknown,
): ProviderCatalogAccessorsV1 {
  const artifact = deepFreeze(
    providerCatalogArtifactV1Schema.parse(artifactInput),
  );
  const services = Object.freeze([...artifact.services]);
  const connectionRules = Object.freeze([...artifact.connectionRules]);
  const validationRules = Object.freeze([...artifact.validationRules]);
  const servicesById = new Map(
    services.map((service) => [String(service.id), service]),
  );
  const connectionsById = new Map(
    connectionRules.map((rule) => [String(rule.id), rule]),
  );
  const validationsById = new Map(
    validationRules.map((rule) => [String(rule.id), rule]),
  );
  const connectionRulesByServiceId = new Map<
    string,
    readonly Readonly<ProviderConnectionRuleDescriptorV1>[]
  >();
  const connectionRulesByPort = new Map<
    string,
    readonly Readonly<ProviderConnectionRuleDescriptorV1>[]
  >();
  for (const service of services) {
    connectionRulesByServiceId.set(
      service.id,
      Object.freeze(
        connectionRules.filter(
          (rule) =>
            rule.source.serviceId === service.id ||
            rule.target.serviceId === service.id,
        ),
      ),
    );
    for (const port of service.ports) {
      connectionRulesByPort.set(
        `${service.id}\u0000${port.id}`,
        Object.freeze(
          connectionRules.filter(
            (rule) =>
              (rule.source.serviceId === service.id &&
                rule.source.portId === port.id) ||
              (rule.target.serviceId === service.id &&
                rule.target.portId === port.id),
          ),
        ),
      );
    }
  }

  function requireService(
    serviceId: string,
  ): Readonly<ProviderServiceDefinitionV1> {
    const service = servicesById.get(serviceId);
    if (service === undefined) {
      throw new TypeError(
        "The requested service is not present in this catalog.",
      );
    }

    return service;
  }

  return Object.freeze({
    artifact,
    listServices: () => services,
    getService: (serviceId: string) => servicesById.get(serviceId),
    requireService,
    getPorts: (serviceId: string) => requireService(serviceId).ports,
    validateConfiguration: (serviceId: string, values: unknown) =>
      validateProviderServiceConfigurationV1(requireService(serviceId), values),
    listConnectionRules: () => connectionRules,
    listConnectionRulesForService: (serviceId: string) => {
      requireService(serviceId);
      return connectionRulesByServiceId.get(serviceId) ?? Object.freeze([]);
    },
    listConnectionRulesForPort: (serviceId: string, portId: string) => {
      const service = requireService(serviceId);
      if (!service.ports.some((port) => port.id === portId)) {
        throw new TypeError(
          "The requested port is not present on this catalog service.",
        );
      }
      return (
        connectionRulesByPort.get(`${serviceId}\u0000${portId}`) ??
        Object.freeze([])
      );
    },
    getConnectionRule: (ruleId: string) => connectionsById.get(ruleId),
    listValidationRules: () => validationRules,
    getValidationRule: (ruleId: string) => validationsById.get(ruleId),
    createPortInventory: (
      nodes: readonly ProviderCatalogNodeBindingV1[],
      coverage: "complete" | "partial",
    ): ValidationPortInventory => {
      const seenNodeIds = new Set<string>();
      const entries: ValidationPortInventoryEntry[] = nodes.map((node) => {
        if (seenNodeIds.has(node.nodeId)) {
          throw new TypeError(
            "A catalog port inventory cannot contain duplicate node IDs.",
          );
        }
        seenNodeIds.add(node.nodeId);

        const ports = requireService(node.serviceId)
          .ports.map((port) => port.id)
          .sort();
        return Object.freeze({
          nodeId: node.nodeId,
          ports: Object.freeze(ports),
        });
      });

      entries.sort((left, right) =>
        left.nodeId === right.nodeId ? 0 : left.nodeId < right.nodeId ? -1 : 1,
      );

      return Object.freeze({
        providerId: artifact.provider.id,
        catalogId: artifact.catalog.id,
        catalogVersion: artifact.catalog.version,
        coverage,
        nodes: Object.freeze(entries),
      });
    },
  });
}
