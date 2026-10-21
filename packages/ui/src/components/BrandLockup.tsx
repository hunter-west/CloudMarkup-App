import type { ComponentPropsWithoutRef } from "react";

export interface BrandLockupProps extends Omit<
  ComponentPropsWithoutRef<"span">,
  "children"
> {
  readonly size?: "small" | "medium";
  /** Reviewed local product artwork supplied by the consuming application. */
  readonly markSrc?: string;
}

/**
 * Product wordmark with application-supplied artwork or a neutral fallback.
 *
 * Artwork and the provider-neutral fallback are decorative. The visible text
 * supplies the accessible identity.
 */
export function BrandLockup({
  className,
  markSrc,
  size = "medium",
  ...rest
}: BrandLockupProps) {
  const classes = ["cm-brand-lockup", className].filter(Boolean).join(" ");

  return (
    <span {...rest} className={classes} data-size={size}>
      {markSrc === undefined ? (
        <svg
          aria-hidden="true"
          className="cm-brand-lockup__mark"
          focusable="false"
          viewBox="0 0 32 32"
        >
          <rect height="18" rx="3" width="18" x="3" y="3" />
          <rect height="18" rx="3" width="18" x="11" y="11" />
          <path d="M11 11h10v10H11z" />
        </svg>
      ) : (
        <img
          alt=""
          aria-hidden="true"
          className="cm-brand-lockup__mark"
          decoding="async"
          height={28}
          src={markSrc}
          width={28}
        />
      )}
      <span className="cm-brand-lockup__text">CloudMarkup</span>
    </span>
  );
}
