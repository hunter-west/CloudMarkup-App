import { prepareAwsRelatedService } from "./aws-related-service-command.js";
import { presentAwsCatalogService } from "./aws-catalog-presentation.js";
import { awsCatalogV1 } from "@cloudmarkup/provider-aws/catalog";
import { awsConnectionPresentationV1 } from "@cloudmarkup/provider-aws/connection-presentation";
import { awsServiceExtensionV1 } from "@cloudmarkup/provider-aws/service-extension";

import { adaptProviderCatalogForEditor } from "@cloudmarkup/graph-preparation/provider-catalog-adapter";
import type { EditorCatalog } from "@cloudmarkup/graph-preparation/editor-catalog";

/**
 * Application composition seam for the exact bundled AWS catalog. Feature
 * components consume only this provider-neutral projection.
 */
const catalog = adaptProviderCatalogForEditor(
  awsCatalogV1,
  awsConnectionPresentationV1,
  awsServiceExtensionV1,
);

export const awsEditorCatalog: EditorCatalog = {
  ...catalog,
  parentEdges: "catalog",
  prepareRelatedService: prepareAwsRelatedService,
  services: catalog.services.map(presentAwsCatalogService).map((service) =>
    service.serviceType === "aws.lambda.function"
      ? { ...service, defaultWorkload: "infrastructure-only" as const }
      : service.serviceType === "aws.region.boundary"
        ? {
            ...service,
            configuration: {
              ...service.configuration,
              documentRegionProperty: "regionName",
            },
            // The bundled Region boundary represents the document's one Region.
            // Unknown provider-defined placement remains unavailable in the editor.
            placement: {
              ...service.placement,
              regionConstraint: "same-region" as const,
            },
          }
        : service,
  ),
};
