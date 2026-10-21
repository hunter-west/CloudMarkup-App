import type { ArchitectureDocument } from "@cloudmarkup/domain";

import type {
  EditorCatalog,
  EditorCatalogInvalidEntry,
  EditorCatalogService,
} from "./editor-catalog.js";
import {
  resolveServiceCreationAvailability,
  type ServiceCreationAvailability,
} from "./add-service-command.js";
import { normalizeCatalogSearchQuery } from "./provider-catalog-adapter.js";

export type ServiceCatalogPresentationMode = "guided" | "professional";

export interface ServiceCatalogConnectionViewModel {
  readonly direction: "incoming" | "outgoing";
  readonly displayName: string;
  readonly otherServiceName: string;
  readonly relationshipId: string;
}

export interface ServiceCatalogItemViewModel {
  readonly searchContext: string | null;
  readonly addability: ServiceCreationAvailability;
  readonly categoryId: EditorCatalogService["category"]["id"];
  readonly connections: readonly ServiceCatalogConnectionViewModel[];
  readonly connectionSummary: string;
  readonly iconId: string;
  readonly mappingLabel: string;
  readonly mappingSummary: string;
  readonly modeExplanation: string;
  readonly portSummary: string;
  readonly primarySummary: string;
  readonly regionDetail: string;
  readonly regionLabel: string;
  readonly service: EditorCatalogService;
  readonly serviceId: string;
}

export interface ServiceCatalogCategoryViewModel {
  readonly id: EditorCatalogService["category"]["id"];
  readonly items: readonly ServiceCatalogItemViewModel[];
  readonly label: string;
}

export interface ServiceCatalogViewModel {
  readonly categories: readonly ServiceCatalogCategoryViewModel[];
  readonly invalidEntries: readonly EditorCatalogInvalidEntry[];
  readonly query: string;
  readonly recentItems: readonly ServiceCatalogItemViewModel[];
  readonly resultCount: number;
}

function compareText(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function matchesQuery(service: EditorCatalogService, query: string): boolean {
  if (query === "") {
    return true;
  }
  return query
    .split(" ")
    .filter(Boolean)
    .every((token) => service.searchText.includes(token));
}

function mappingSummary(service: EditorCatalogService): string {
  if (service.mappings.length === 0) {
    return "No IaC target mapping declared";
  }
  return service.mappings
    .map(
      (mapping) =>
        `${mapping.target}: ${
          mapping.implementationStatus === "metadata-only"
            ? "metadata only"
            : "implemented mapping"
        }`,
    )
    .join(" · ");
}

function mappingLabel(service: EditorCatalogService): string {
  if (service.mappings.length === 0) {
    return "IaC: no target mapping";
  }

  const statuses = new Set(
    service.mappings.map((mapping) => mapping.implementationStatus),
  );
  const status =
    statuses.size > 1
      ? "mixed readiness"
      : statuses.has("implemented")
        ? "implemented"
        : "metadata only";
  const targets = service.mappings
    .map((mapping) => mapping.target)
    .sort(compareText)
    .join(", ");

  return `IaC: ${status} · ${targets}`;
}

function portSummary(service: EditorCatalogService): string {
  if (service.ports.length === 0) {
    return "No typed ports";
  }
  const inputs = service.ports.filter(
    (port) => port.direction === "input",
  ).length;
  const outputs = service.ports.length - inputs;
  return `${String(inputs)} input · ${String(outputs)} output`;
}

function connectionViewModels(
  service: EditorCatalogService,
  catalog: EditorCatalog,
): readonly ServiceCatalogConnectionViewModel[] {
  const serviceNames = new Map(
    catalog.services.map((candidate) => [
      candidate.serviceType,
      candidate.displayName,
    ]),
  );

  return (catalog.relationships ?? [])
    .flatMap((relationship): readonly ServiceCatalogConnectionViewModel[] => {
      if (relationship.sourceServiceType === service.serviceType) {
        return [
          {
            direction: "outgoing",
            displayName: relationship.displayName,
            otherServiceName:
              serviceNames.get(relationship.targetServiceType) ??
              relationship.targetServiceType,
            relationshipId: relationship.descriptorId,
          },
        ];
      }
      if (relationship.targetServiceType === service.serviceType) {
        return [
          {
            direction: "incoming",
            displayName: relationship.displayName,
            otherServiceName:
              serviceNames.get(relationship.sourceServiceType) ??
              relationship.sourceServiceType,
            relationshipId: relationship.descriptorId,
          },
        ];
      }
      return [];
    })
    .sort(
      (left, right) =>
        compareText(left.displayName, right.displayName) ||
        compareText(left.otherServiceName, right.otherServiceName) ||
        compareText(left.direction, right.direction) ||
        compareText(left.relationshipId, right.relationshipId),
    );
}

function connectionSummary(
  connections: readonly ServiceCatalogConnectionViewModel[],
): string {
  if (connections.length === 0) {
    return "No catalog-declared connection types";
  }
  return connections.length === 1
    ? "1 catalog-declared connection type"
    : `${String(connections.length)} catalog-declared connection types`;
}

function regionStatus(
  service: EditorCatalogService,
  region: string,
): { readonly detail: string; readonly label: string } {
  if (service.regionAvailability.state === "unknown") {
    return {
      detail: service.regionAvailability.reason,
      label: "Availability not reviewed for this Region",
    };
  }
  const match = service.regionAvailability.regions.find(
    (candidate) => candidate.region === region,
  );
  if (match?.availability === "available") {
    return {
      detail: `The bound catalog lists ${region} as available.`,
      label: `Available in ${region}`,
    };
  }
  if (match?.availability === "unavailable") {
    return {
      detail: `The bound catalog lists ${region} as unavailable.`,
      label: `Unavailable in ${region}`,
    };
  }
  return {
    detail:
      service.regionAvailability.coverage === "partial"
        ? `The catalog has partial Region coverage and does not list ${region}.`
        : `The catalog does not contain a record for ${region}.`,
    label: "Availability not reviewed for this Region",
  };
}

function itemViewModel(
  service: EditorCatalogService & { readonly iconId: string },
  document: ArchitectureDocument,
  catalog: EditorCatalog,
  mode: ServiceCatalogPresentationMode,
): ServiceCatalogItemViewModel {
  const region = regionStatus(service, document.provider.region);
  const connections = connectionViewModels(service, catalog);
  const availability = resolveServiceCreationAvailability(
    document,
    catalog,
    service.serviceType,
  );
  const allowedParents = service.placement.allowedParents;
  const missingParentBeforeConfiguration =
    !availability.enabled &&
    availability.code === "configuration-unavailable" &&
    service.placement.rootPlacement === "forbidden" &&
    allowedParents.length > 0 &&
    !document.nodes.some((node) =>
      allowedParents.some(
        (parent) => parent.serviceType === node.semantic.serviceType,
      ),
    );
  const addability: ServiceCreationAvailability =
    missingParentBeforeConfiguration
      ? {
          code: "parent-unavailable",
          enabled: false,
          reason: `Add a parent first: ${[
            ...new Set(
              allowedParents.map(
                (parent) =>
                  catalog.services.find(
                    (candidate) => candidate.serviceType === parent.serviceType,
                  )?.displayName ?? "Compatible resource",
              ),
            ),
          ]
            .sort(compareText)
            .join(", ")}.`,
        }
      : availability;
  return {
    searchContext: null,
    addability,
    categoryId: service.category.id,
    connections,
    connectionSummary: connectionSummary(connections),
    iconId: service.iconId,
    mappingLabel: mappingLabel(service),
    mappingSummary: mappingSummary(service),
    modeExplanation:
      mode === "guided"
        ? service.education.guidedExplanation
        : service.education.professionalExplanation,
    portSummary: portSummary(service),
    primarySummary: service.education.summary,
    regionDetail: region.detail,
    regionLabel: region.label,
    service,
    serviceId: service.serviceType,
  };
}

function productSearchText(
  service: EditorCatalogService,
  catalog: EditorCatalog,
): string {
  const included = new Set([service.serviceType]);
  if (service.catalogGroup)
    for (const candidate of catalog.services)
      if (candidate.catalogGroup?.id === service.catalogGroup.id)
        included.add(candidate.serviceType);
  for (const id of included) {
    const owner = catalog.services.find(
      (candidate) => candidate.serviceType === id,
    );
    for (const related of owner?.relatedServiceTypes ?? [])
      included.add(related);
    for (const slot of owner?.ownedConfigurationSlots ?? [])
      included.add(slot.graphBinding.configurationServiceType);
  }
  const services = catalog.services.filter((candidate) =>
    included.has(candidate.serviceType),
  );
  return normalizeCatalogSearchQuery(
    services
      .flatMap((candidate) => [
        candidate.searchText,
        ...(candidate.ownedConfigurationSlots ?? []).map(
          (slot) => slot.displayName,
        ),
      ])
      .join(" "),
  );
}

function ownerSearchContext(
  service: EditorCatalogService,
  catalog: EditorCatalog,
  query: string,
): string | null {
  if (query === "") return null;
  const matches = (text: string) =>
    query
      .split(" ")
      .every((token) => normalizeCatalogSearchQuery(text).includes(token));
  const owners = catalog.services.filter(
    (candidate) =>
      candidate.serviceType === service.serviceType ||
      (service.catalogGroup !== undefined &&
        candidate.catalogGroup?.id === service.catalogGroup.id),
  );
  for (const owner of owners) {
    for (const slot of owner.ownedConfigurationSlots ?? []) {
      const child = catalog.services.find(
        (candidate) =>
          candidate.serviceType === slot.graphBinding.configurationServiceType,
      );
      if (matches(`${slot.displayName} ${child?.displayName ?? ""}`))
        return `Configure → ${slot.displayName}`;
    }
    for (const id of owner.relatedServiceTypes ?? []) {
      const child = catalog.services.find(
        (candidate) => candidate.serviceType === id,
      );
      if (child && matches(child.displayName))
        return `Configure → ${child.displayName}`;
    }
    if (owner.serviceType !== service.serviceType && matches(owner.displayName))
      return `Set up → ${owner.catalogGroup?.variantLabel ?? owner.displayName}`;
  }
  return null;
}

export function createServiceCatalogViewModel({
  catalog,
  document,
  mode,
  query,
  recentServiceIds,
}: {
  readonly catalog: EditorCatalog;
  readonly document: ArchitectureDocument;
  readonly mode: ServiceCatalogPresentationMode;
  readonly query: string;
  readonly recentServiceIds: readonly string[];
}): ServiceCatalogViewModel {
  const normalizedQuery = normalizeCatalogSearchQuery(query);
  const allItems = catalog.services
    .filter(
      (
        service,
      ): service is EditorCatalogService & { readonly iconId: string } =>
        service.deployable &&
        service.iconId !== null &&
        service.catalogVisibility !== "configuration" &&
        (service.catalogGroup === undefined ||
          service.catalogGroup.primaryServiceType === service.serviceType),
    )
    .map((service) =>
      itemViewModel(
        {
          ...service,
          searchText: productSearchText(service, catalog),
          ...(service.catalogGroup === undefined
            ? {}
            : {
                displayName: service.catalogGroup.displayName,
                education: {
                  ...service.education,
                  summary: service.catalogGroup.summary,
                },
              }),
        },
        document,
        catalog,
        mode,
      ),
    )
    .sort(
      (left, right) =>
        compareText(left.service.displayName, right.service.displayName) ||
        compareText(left.serviceId, right.serviceId),
    );
  const filteredItems = allItems
    .filter((item) => matchesQuery(item.service, normalizedQuery))
    .map((item) => ({
      ...item,
      searchContext: ownerSearchContext(item.service, catalog, normalizedQuery),
    }));
  const categoryOrder: readonly EditorCatalogService["category"]["id"][] = [
    "root-placeable",
    "parent-required",
  ];
  const categories = categoryOrder
    .map((categoryId) => {
      const items = filteredItems.filter(
        (item) => item.categoryId === categoryId,
      );
      const source = items[0]?.service.category;
      return {
        id: categoryId,
        items,
        label:
          source === undefined
            ? categoryId
            : mode === "guided"
              ? source.guidedLabel
              : source.professionalLabel,
      };
    })
    .filter((category) => category.items.length > 0);
  const itemById = new Map(allItems.map((item) => [item.serviceId, item]));
  const recentItems =
    normalizedQuery === ""
      ? recentServiceIds
          .map((serviceId) =>
            itemById.get(
              catalog.services.find(
                (service) => service.serviceType === serviceId,
              )?.catalogGroup?.primaryServiceType ?? serviceId,
            ),
          )
          .filter(
            (item): item is ServiceCatalogItemViewModel => item !== undefined,
          )
          .filter(
            (item, index, items) =>
              items.findIndex(
                (candidate) => candidate.serviceId === item.serviceId,
              ) === index,
          )
      : [];
  const invalidEntries = catalog.invalidEntries.filter(
    (entry) =>
      normalizedQuery === "" ||
      normalizeCatalogSearchQuery(`${entry.title} ${entry.reason}`).includes(
        normalizedQuery,
      ),
  );

  return {
    categories,
    invalidEntries,
    query: normalizedQuery,
    recentItems,
    resultCount: filteredItems.length + invalidEntries.length,
  };
}
