import { useId, type SVGProps } from "react";

interface DecorativeNeutralProviderIconProps {
  readonly decorative?: true;
  readonly label?: never;
}

interface NamedNeutralProviderIconProps {
  readonly decorative: false;
  readonly label: string;
}

export type NeutralProviderIconProps = Omit<
  SVGProps<SVGSVGElement>,
  "aria-label" | "aria-labelledby" | "children" | "role"
> &
  (DecorativeNeutralProviderIconProps | NamedNeutralProviderIconProps);

/**
 * Provisional application-owned placeholder geometry. It intentionally avoids
 * provider colors, lettering, silhouettes, and trade dress.
 */
export function NeutralProviderIcon({
  decorative = true,
  label,
  ...svgProps
}: NeutralProviderIconProps) {
  const titleId = useId();

  return (
    <svg
      {...svgProps}
      aria-hidden={decorative ? true : undefined}
      aria-labelledby={decorative ? undefined : titleId}
      fill="none"
      focusable="false"
      role={decorative ? undefined : "img"}
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      {decorative ? null : <title id={titleId}>{label}</title>}
      <rect
        height="17"
        rx="3"
        stroke="currentColor"
        strokeWidth="1.5"
        width="17"
        x="3.5"
        y="3.5"
      />
      <path
        d="M8 8h8M8 12h8M8 16h5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.5"
      />
    </svg>
  );
}
