import type { ComponentPropsWithoutRef, ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";
export type ButtonSize = "compact" | "default";

export interface ButtonProps extends ComponentPropsWithoutRef<"button"> {
  readonly loading?: boolean;
  readonly loadingLabel?: string;
  readonly size?: ButtonSize;
  readonly variant?: ButtonVariant;
}

/**
 * The shared native button treatment.
 *
 * Loading is expressed in text and disables repeat submission; it never relies
 * on animation alone.
 */
export function Button({
  children,
  className,
  disabled,
  loading = false,
  loadingLabel = "Working",
  size = "default",
  type = "button",
  variant = "secondary",
  ...rest
}: ButtonProps) {
  const classes = ["cm-button", className].filter(Boolean).join(" ");

  return (
    <button
      {...rest}
      aria-busy={loading ? "true" : undefined}
      className={classes}
      data-size={size}
      data-variant={variant}
      disabled={disabled === true || loading}
      type={type}
    >
      {loading ? (
        <>
          <span aria-hidden="true" className="cm-button__progress">
            &hellip;
          </span>
          <span>{loadingLabel}</span>
        </>
      ) : (
        children
      )}
    </button>
  );
}

export interface IconButtonProps extends Omit<
  ComponentPropsWithoutRef<"button">,
  "aria-label" | "children"
> {
  readonly icon: ReactNode;
  readonly label: string;
  readonly variant?: Exclude<ButtonVariant, "primary">;
}

/** An action-icon wrapper whose accessible name is always explicit. */
export function IconButton({
  className,
  icon,
  label,
  type = "button",
  variant = "quiet",
  ...rest
}: IconButtonProps) {
  const classes = ["cm-icon-button", className].filter(Boolean).join(" ");

  return (
    <button
      {...rest}
      aria-label={label}
      className={classes}
      data-variant={variant}
      title={label}
      type={type}
    >
      <span aria-hidden="true" className="cm-icon-button__icon">
        {icon}
      </span>
    </button>
  );
}
