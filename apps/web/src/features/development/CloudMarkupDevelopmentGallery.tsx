import { awsCatalogV1 } from "@cloudmarkup/provider-aws/catalog";

import { awsIconRegistry } from "../../provider-icons/aws-icon-registry.js";
import {
  DevelopmentVisualGallery,
  type DevelopmentGalleryCatalogService,
} from "./DevelopmentVisualGallery.js";

const catalogServices: readonly DevelopmentGalleryCatalogService[] =
  Object.freeze(
    awsCatalogV1.listServices().flatMap((service) =>
      service.iconId === null
        ? []
        : [
            Object.freeze({
              id: String(service.id),
              displayName: service.displayName,
              iconId: service.iconId,
            }),
          ],
    ),
  );

/**
 * Development composition over public catalog and icon-registry seams.
 *
 * The application route must remain gated by `import.meta.env.DEV`; this
 * module does not authorize production navigation or bundle exposure.
 */
export function CloudMarkupDevelopmentGallery() {
  return (
    <DevelopmentVisualGallery
      iconRegistry={awsIconRegistry}
      services={catalogServices}
    />
  );
}

export default CloudMarkupDevelopmentGallery;
