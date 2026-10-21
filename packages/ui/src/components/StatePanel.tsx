import type { ComponentPropsWithoutRef, ElementType, ReactNode } from "react";
import { useId } from "react";

export type StatePanelKind =
  | "empty"
  | "error"
  | "loading"
  | "not-found"
  | "offline"
  | "permission-denied"
  | "read-only"
  | "stale"
  | "unsupported";

export interface StatePanelProps extends Omit<
  ComponentPropsWithoutRef<"section">,
  "children" | "title"
> {
  readonly actions?: ReactNode;
  readonly children?: ReactNode;
  readonly description?: ReactNode;
  readonly headingLevel?: 1 | 2 | 3 | 4 | 5 | 6;
  readonly kind: StatePanelKind;
  readonly live?: "off" | "polite" | "assertive";
  readonly title: string;
}

const stateSymbols: Readonly<Record<StatePanelKind, string>> = {
  empty: "o",
  error: "x",
  loading: "...",
  "not-found": "?",
  offline: "!",
  "permission-denied": "!",
  "read-only": "#",
  stale: "~",
  unsupported: "-",
};

/**
 * Named, durable presentation for loading, empty, failure, and access states.
 */
export function StatePanel({
  actions,
  children,
  className,
  description,
  headingLevel = 2,
  kind,
  live = "off",
  title,
  ...rest
}: StatePanelProps) {
  const headingId = useId();
  const Heading = `h${String(headingLevel)}` as ElementType;
  const classes = ["cm-state-panel", className].filter(Boolean).join(" ");

  return (
    <section
      {...rest}
      aria-busy={kind === "loading" ? "true" : undefined}
      aria-labelledby={headingId}
      aria-live={live}
      className={classes}
      data-kind={kind}
    >
      <span aria-hidden="true" className="cm-state-panel__symbol">
        {stateSymbols[kind]}
      </span>
      <div className="cm-state-panel__content">
        <Heading className="cm-state-panel__title" id={headingId}>
          {title}
        </Heading>
        {description === undefined ? null : (
          <div className="cm-state-panel__description">{description}</div>
        )}
        {children}
        {actions === undefined ? null : (
          <div className="cm-state-panel__actions">{actions}</div>
        )}
      </div>
    </section>
  );
}
