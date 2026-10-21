import type { ComponentPropsWithoutRef, ReactNode } from "react";

import type { StatePanelProps } from "./StatePanel.js";
import { StatePanel } from "./StatePanel.js";
import type { StatusBadgeProps } from "./StatusBadge.js";
import { StatusBadge } from "./StatusBadge.js";

export type BadgeProps = StatusBadgeProps;

/** Compatibility-friendly short name for the textual status badge. */
export function Badge(props: BadgeProps) {
  return <StatusBadge {...props} />;
}

export type EmptyStateProps = Omit<StatePanelProps, "kind">;

export function EmptyState(props: EmptyStateProps) {
  return <StatePanel {...props} kind="empty" />;
}

export type ErrorStateProps = Omit<StatePanelProps, "kind">;

export function ErrorState(props: ErrorStateProps) {
  return <StatePanel {...props} kind="error" />;
}

export interface LoadingStateProps extends Omit<StatePanelProps, "kind"> {
  readonly progress?: number;
  readonly progressLabel?: string;
}

export function LoadingState({
  children,
  progress,
  progressLabel = "Progress",
  ...rest
}: LoadingStateProps) {
  const normalizedProgress =
    progress === undefined
      ? undefined
      : Math.max(0, Math.min(100, Math.round(progress)));

  return (
    <StatePanel {...rest} kind="loading">
      <progress
        aria-label={progressLabel}
        className="cm-progress"
        max={100}
        value={normalizedProgress}
      />
      {normalizedProgress === undefined ? null : (
        <span className="cm-progress__value">{normalizedProgress}%</span>
      )}
      {children}
    </StatePanel>
  );
}

export interface ServiceIconContainerProps extends Omit<
  ComponentPropsWithoutRef<"span">,
  "children"
> {
  /**
   * Approved asset content. It is decorative inside this named container.
   * Omit it to render the deterministic provider-neutral placeholder.
   */
  readonly children?: ReactNode;
  readonly label: string;
  readonly size?: "small" | "medium" | "large";
  readonly status?: "approved" | "placeholder" | "missing";
}

export function ServiceIconContainer({
  children,
  className,
  label,
  size = "medium",
  status,
  ...rest
}: ServiceIconContainerProps) {
  const resolvedStatus =
    status ?? (children === undefined ? "placeholder" : "approved");
  const classes = ["cm-service-icon", className].filter(Boolean).join(" ");

  return (
    <span
      {...rest}
      aria-label={`${label} service icon${
        resolvedStatus === "approved" ? "" : " placeholder"
      }`}
      className={classes}
      data-size={size}
      data-status={resolvedStatus}
      role="img"
    >
      {children === undefined ? (
        <span aria-hidden="true" className="cm-service-icon__placeholder">
          <span>?</span>
        </span>
      ) : (
        <span aria-hidden="true" className="cm-service-icon__asset">
          {children}
        </span>
      )}
    </span>
  );
}

export interface CodeBlockProps extends Omit<
  ComponentPropsWithoutRef<"div">,
  "children"
> {
  readonly code: string;
  readonly label?: string;
  readonly language?: string;
  readonly lineNumbers?: boolean;
  readonly onCopy?: () => void;
  readonly wrap?: boolean;
}

export function CodeBlock({
  className,
  code,
  label = "Code",
  language = "text",
  lineNumbers = true,
  onCopy,
  wrap = false,
  ...rest
}: CodeBlockProps) {
  const classes = ["cm-code-block", className].filter(Boolean).join(" ");
  const lines = code.split("\n");

  return (
    <div {...rest} aria-label={label} className={classes} role="region">
      <header className="cm-code-block__header">
        <span>{language}</span>
        {onCopy === undefined ? null : (
          <button
            className="cm-code-block__copy"
            onClick={onCopy}
            type="button"
          >
            Copy code
          </button>
        )}
      </header>
      <pre className="cm-code-block__pre" data-wrap={wrap ? "true" : "false"}>
        <code>
          {lines.map((line, index) => (
            <span className="cm-code-block__line" key={String(index)}>
              {lineNumbers ? (
                <span aria-hidden="true" className="cm-code-block__line-number">
                  {index + 1}
                </span>
              ) : null}
              <span>{line.length === 0 ? "\u00a0" : line}</span>
              {index === lines.length - 1 ? null : "\n"}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}

export interface DisclosureProps extends Omit<
  ComponentPropsWithoutRef<"details">,
  "children"
> {
  readonly children: ReactNode;
  readonly summary: ReactNode;
}

/** Native disclosure that preserves its descendants while collapsed. */
export function Disclosure({
  children,
  className,
  summary,
  ...rest
}: DisclosureProps) {
  const classes = ["cm-disclosure", className].filter(Boolean).join(" ");

  return (
    <details {...rest} className={classes}>
      <summary className="cm-disclosure__summary">{summary}</summary>
      <div className="cm-disclosure__content">{children}</div>
    </details>
  );
}
