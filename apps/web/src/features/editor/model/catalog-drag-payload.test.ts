import { describe, expect, it } from "vitest";

import {
  readServiceCatalogDragPayload,
  SERVICE_CATALOG_DRAG_MIME,
  type CatalogDragDataReader,
} from "./catalog-drag-payload.js";

describe("service catalog drag payload", () => {
  it("rejects foreign drag data instead of interpreting another MIME type", () => {
    const requestedFormats: string[] = [];
    const foreignTransfer: CatalogDragDataReader = {
      getData(format) {
        requestedFormats.push(format);
        return format === "text/plain" ? "aws.lambda.function" : "";
      },
    };

    expect(readServiceCatalogDragPayload(foreignTransfer)).toBeNull();
    expect(requestedFormats).toEqual([SERVICE_CATALOG_DRAG_MIME]);
  });

  it.each(['{"serviceId":"aws.lambda.function"}'])(
    "rejects malformed drag service identity %j",
    (serviceId) => {
      const malformedTransfer: CatalogDragDataReader = {
        getData: () => serviceId,
      };

      expect(readServiceCatalogDragPayload(malformedTransfer)).toBeNull();
    },
  );
});
