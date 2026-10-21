import type { ReactNode } from "react";

import { ServiceIconContainer } from "../components/ContentPrimitives.js";
import type { IconRegistry } from "./icon-registry.js";

export interface ProviderIconProps<TIconId extends string = string> {
  readonly className?: string;
  readonly decorative?: boolean;
  readonly iconId: TIconId;
  readonly registry: IconRegistry<ReactNode, TIconId>;
  readonly serviceName: string;
}

/**
 * Provider-neutral presentation for a registry result. Adjacent visible
 * service text should remain the primary identification.
 */
export function ProviderIcon<TIconId extends string = string>({
  className,
  decorative = true,
  iconId,
  registry,
  serviceName,
}: ProviderIconProps<TIconId>) {
  const resolution = registry.resolve(iconId);
  const status =
    resolution.kind === "approved"
      ? "approved"
      : resolution.reason === "missing"
        ? "missing"
        : "placeholder";

  return (
    <ServiceIconContainer
      aria-hidden={decorative ? true : undefined}
      className={["cm-provider-icon", className].filter(Boolean).join(" ")}
      data-icon-resolution={resolution.kind}
      data-placeholder-reason={
        resolution.kind === "placeholder" ? resolution.reason : undefined
      }
      label={serviceName}
      status={status}
    >
      {resolution.asset}
    </ServiceIconContainer>
  );
}
