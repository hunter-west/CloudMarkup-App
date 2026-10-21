import { ProviderIcon, type IconRegistry } from "@cloudmarkup/ui";
import type { ReactNode } from "react";

export interface CatalogServiceIconProps {
  readonly className?: string;
  readonly decorative?: boolean;
  readonly iconId: string;
  readonly registry: IconRegistry<ReactNode>;
  readonly serviceName: string;
}

/**
 * Provider-neutral feature seam: callers supply the version-bound service
 * display name and opaque icon ID plus the application-composed registry.
 */
export function CatalogServiceIcon({
  className,
  decorative,
  iconId,
  registry,
  serviceName,
}: CatalogServiceIconProps) {
  return (
    <ProviderIcon
      {...(className === undefined ? {} : { className })}
      {...(decorative === undefined ? {} : { decorative })}
      iconId={iconId}
      registry={registry}
      serviceName={serviceName}
    />
  );
}
