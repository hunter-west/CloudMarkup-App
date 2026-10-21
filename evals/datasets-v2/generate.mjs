import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { format } from "prettier";

import {
  frozenModelNetworkingEvaluationDatasetV2,
  modelNetworkingCatalogAuthorityV2,
} from "../../packages/model-gateway/dist/index.js";
import { modelNetworkingPlanningCatalogGroundingV2 } from "../../packages/model-gateway/dist/networking-evaluation-production-v2.js";

const outputUrl = new URL(
  "./model-evaluation-networking-v2.json",
  import.meta.url,
);
const catalogUrl = new URL(
  "../../packages/provider-aws/src/compiled/catalog-v0-10-0.json",
  import.meta.url,
);
const catalogArtifact = JSON.parse(await readFile(catalogUrl, "utf8"));
const catalog = catalogArtifact.catalog;
if (
  catalog?.id !== modelNetworkingCatalogAuthorityV2.catalogId ||
  catalog?.version !== modelNetworkingCatalogAuthorityV2.catalogVersion ||
  catalogArtifact.digest !== modelNetworkingCatalogAuthorityV2.catalogDigest
) {
  throw new Error(
    "Networking evaluation authority is not bound to the exact checked AWS 0.10.0 catalog identity, version, and digest.",
  );
}
if (
  JSON.stringify(modelNetworkingPlanningCatalogGroundingV2.catalog) !==
  JSON.stringify({
    digest: modelNetworkingCatalogAuthorityV2.catalogDigest,
    id: modelNetworkingCatalogAuthorityV2.catalogId,
    version: modelNetworkingCatalogAuthorityV2.catalogVersion,
  })
) {
  throw new Error(
    "Networking planning grounding is not bound to the frozen catalog authority.",
  );
}

function propertyTypes(jsonSchema) {
  return Object.entries(jsonSchema?.properties ?? {})
    .map(([key, property]) => [key, property.type])
    .sort(([left], [right]) => left.localeCompare(right));
}

function placementProjection(placement) {
  return {
    allowedParentTypes: (placement?.allowedParentTypes ?? [])
      .map(({ relationshipType, serviceId, serviceType }) => ({
        relationshipType,
        serviceType: serviceType ?? serviceId,
      }))
      .sort((left, right) =>
        `${left.relationshipType}/${left.serviceType}`.localeCompare(
          `${right.relationshipType}/${right.serviceType}`,
        ),
      ),
    ...(placement?.maximumDepth === undefined
      ? {}
      : { maximumDepth: placement.maximumDepth }),
    rootPlacement: placement?.rootPlacement,
  };
}

function stable(value) {
  return JSON.stringify(value);
}

const services = new Map(
  (catalogArtifact.services ?? []).map((service) => [service.id, service]),
);
const groundingNodes = new Map(
  modelNetworkingPlanningCatalogGroundingV2.nodes.map((node) => [
    node.serviceType,
    node,
  ]),
);
if (groundingNodes.size !== modelNetworkingCatalogAuthorityV2.services.length) {
  throw new Error(
    "Networking planning grounding contains services outside the frozen authority.",
  );
}
for (const authority of modelNetworkingCatalogAuthorityV2.services) {
  const catalogService = services.get(authority.serviceId);
  if (catalogService === undefined) {
    throw new Error(
      `Networking evaluation references missing catalog service ${authority.serviceId}.`,
    );
  }
  const groundingNode = groundingNodes.get(authority.serviceId);
  if (groundingNode === undefined) {
    throw new Error(
      `Networking planning grounding is missing catalog service ${authority.serviceId}.`,
    );
  }
  const catalogKeys = Object.keys(
    catalogService.configuration?.jsonSchema?.properties ?? {},
  ).sort();
  if (
    JSON.stringify(catalogKeys) !== JSON.stringify(authority.configurationKeys)
  ) {
    throw new Error(
      `Networking evaluation configuration authority drifted for ${authority.serviceId}.`,
    );
  }
  if (
    groundingNode.resourceType !== authority.serviceId ||
    groundingNode.configurationSchemaId !==
      catalogService.configuration?.schemaId ||
    groundingNode.configurationSchemaVersion !==
      catalogService.configuration?.schemaVersion ||
    stable(propertyTypes(groundingNode.configurationValidation?.jsonSchema)) !==
      stable(propertyTypes(catalogService.configuration?.jsonSchema)) ||
    stable(placementProjection(groundingNode.placement)) !==
      stable(placementProjection(catalogService.placement))
  ) {
    throw new Error(
      `Networking planning grounding drifted from catalog service ${authority.serviceId}.`,
    );
  }
}

const relationships = new Map(
  (catalogArtifact.connectionRules ?? []).map((rule) => [
    rule.relationshipType,
    rule,
  ]),
);
const groundingRelationships = new Map(
  modelNetworkingPlanningCatalogGroundingV2.connectionRules.map((rule) => [
    rule.relationshipType,
    rule,
  ]),
);
if (
  groundingRelationships.size !==
  modelNetworkingCatalogAuthorityV2.relationships.length
) {
  throw new Error(
    "Networking planning grounding contains relationships outside the frozen authority.",
  );
}
const expectedPortsByService = new Map();
for (const authority of modelNetworkingCatalogAuthorityV2.relationships) {
  const catalogRelationship = relationships.get(authority.relationshipType);
  if (catalogRelationship === undefined) {
    throw new Error(
      `Networking evaluation references missing catalog relationship ${authority.relationshipType}.`,
    );
  }
  const groundingRelationship = groundingRelationships.get(
    authority.relationshipType,
  );
  if (groundingRelationship === undefined) {
    throw new Error(
      `Networking planning grounding is missing catalog relationship ${authority.relationshipType}.`,
    );
  }
  const catalogKeys = Object.keys(
    catalogRelationship.configuration?.jsonSchema?.properties ?? {},
  ).sort();
  if (
    JSON.stringify(catalogKeys) !== JSON.stringify(authority.configurationKeys)
  ) {
    throw new Error(
      `Networking evaluation relationship authority drifted for ${authority.relationshipType}.`,
    );
  }
  const source = {
    port: catalogRelationship.source.portId,
    serviceType: catalogRelationship.source.serviceId,
  };
  const target = {
    port: catalogRelationship.target.portId,
    serviceType: catalogRelationship.target.serviceId,
  };
  if (
    groundingRelationship.ruleId !== catalogRelationship.id ||
    groundingRelationship.ruleVersion !== catalogRelationship.ruleVersion ||
    groundingRelationship.configurationSchemaId !==
      catalogRelationship.configuration?.schemaId ||
    groundingRelationship.configurationSchemaVersion !==
      catalogRelationship.configuration?.schemaVersion ||
    stable(
      propertyTypes(groundingRelationship.configurationValidation?.jsonSchema),
    ) !==
      stable(propertyTypes(catalogRelationship.configuration?.jsonSchema)) ||
    stable(groundingRelationship.source) !== stable(source) ||
    stable(groundingRelationship.target) !== stable(target)
  ) {
    throw new Error(
      `Networking planning grounding drifted from catalog relationship ${authority.relationshipType}.`,
    );
  }
  for (const endpoint of [
    catalogRelationship.source,
    catalogRelationship.target,
  ]) {
    const service = services.get(endpoint.serviceId);
    const catalogPort = service?.ports?.find(
      ({ id }) => id === endpoint.portId,
    );
    if (catalogPort === undefined) {
      throw new Error(
        `Networking catalog relationship ${authority.relationshipType} references missing port ${endpoint.portId}.`,
      );
    }
    const ports = expectedPortsByService.get(endpoint.serviceId) ?? new Map();
    ports.set(endpoint.portId, catalogPort.direction);
    expectedPortsByService.set(endpoint.serviceId, ports);
  }
}

for (const authority of modelNetworkingCatalogAuthorityV2.services) {
  const groundingNode = groundingNodes.get(authority.serviceId);
  const expectedPorts = [
    ...(expectedPortsByService.get(authority.serviceId)?.entries() ?? []),
  ]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([port, direction]) => ({ direction, port }));
  if (stable(groundingNode?.ports) !== stable(expectedPorts)) {
    throw new Error(
      `Networking planning grounding ports drifted from catalog service ${authority.serviceId}.`,
    );
  }
}

const rendered = await format(
  JSON.stringify(frozenModelNetworkingEvaluationDatasetV2),
  { filepath: fileURLToPath(outputUrl) },
);

if (process.argv[2] === "--write") {
  await writeFile(outputUrl, rendered, "utf8");
} else if (process.argv[2] === "--check") {
  const current = await readFile(outputUrl, "utf8");
  if (current !== rendered) {
    throw new Error(
      "Frozen AWS networking model evaluation dataset v2 is stale relative to its canonical fixture.",
    );
  }
} else {
  throw new Error("Expected --write or --check.");
}
