export const SERVICE_CATALOG_DRAG_MIME =
  "application/x-cloudmarkup-catalog-service-v1" as const;

const SERVICE_ID_PATTERN = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/u;

export interface CatalogDragDataWriter {
  effectAllowed: DataTransfer["effectAllowed"];
  setData(format: string, data: string): void;
}

export interface CatalogDragDataReader {
  getData(format: string): string;
}

export function writeServiceCatalogDragPayload(
  dataTransfer: CatalogDragDataWriter,
  serviceId: string,
): void {
  if (!SERVICE_ID_PATTERN.test(serviceId)) {
    throw new TypeError("Catalog drag payload requires one stable service ID.");
  }
  dataTransfer.effectAllowed = "copy";
  dataTransfer.setData(SERVICE_CATALOG_DRAG_MIME, serviceId);
}

export function readServiceCatalogDragPayload(
  dataTransfer: CatalogDragDataReader,
): string | null {
  const serviceId = dataTransfer.getData(SERVICE_CATALOG_DRAG_MIME);
  return SERVICE_ID_PATTERN.test(serviceId) ? serviceId : null;
}
