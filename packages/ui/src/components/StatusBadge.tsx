import type { ComponentPropsWithoutRef } from "react";

export type StatusTone =
  | "neutral"
  | "info"
  | "success"
  | "incomplete"
  | "warning"
  | "cost"
  | "security"
  | "error"
  | "proposal"
  | "generated"
  | "unsupported"
  | "read-only";

export interface StatusBadgeProps extends Omit<
  ComponentPropsWithoutRef<"span">,
  "children"
> {
  readonly label: string;
  readonly tone?: StatusTone;
}

const toneSymbols: Readonly<Record<StatusTone, string>> = {
  cost: "$",
  error: "x",
  generated: "+",
  incomplete: "?",
  info: "i",
  neutral: ".",
  proposal: "~",
  "read-only": "#",
  security: "S",
  success: "+",
  unsupported: "-",
  warning: "!",
};

/**
 * Compact textual status with a supplemental non-color symbol.
 *
 * It intentionally has no live-region role. Callers decide whether a status
 * change should be announced in the owning durable status surface.
 */
export function StatusBadge({
  className,
  label,
  tone = "neutral",
  ...rest
}: StatusBadgeProps) {
  const classes = ["cm-status-badge", className].filter(Boolean).join(" ");

  return (
    <span {...rest} className={classes} data-tone={tone}>
      <span aria-hidden="true" className="cm-status-badge__symbol">
        {toneSymbols[tone]}
      </span>
      <span>{label}</span>
    </span>
  );
}
