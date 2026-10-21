import type { ReactNode } from "react";

export type ToastTone = "info" | "success" | "warning" | "error";

export interface ToastMessage {
  readonly action?: ReactNode;
  readonly description?: ReactNode;
  readonly id: string;
  readonly title: string;
  readonly tone?: ToastTone;
}

export interface ToastViewportProps {
  readonly className?: string;
  readonly label?: string;
  readonly onDismiss: (id: string) => void;
  readonly toasts: readonly ToastMessage[];
}

const toneSymbols: Readonly<Record<ToastTone, string>> = {
  error: "x",
  info: "i",
  success: "+",
  warning: "!",
};

export interface ToastProps extends ToastMessage {
  readonly onDismiss: (id: string) => void;
}

/** One non-expiring, dismissible toast with a textual live status. */
export function Toast({
  action,
  description,
  id,
  onDismiss,
  title,
  tone = "info",
}: ToastProps) {
  return (
    <li
      aria-atomic="true"
      className="cm-toast"
      data-tone={tone}
      role={tone === "error" ? "alert" : "status"}
    >
      <span aria-hidden="true" className="cm-toast__symbol">
        {toneSymbols[tone]}
      </span>
      <div className="cm-toast__content">
        <p className="cm-toast__title">{title}</p>
        {description === undefined ? null : (
          <div className="cm-toast__description">{description}</div>
        )}
        {action === undefined ? null : (
          <div className="cm-toast__action">{action}</div>
        )}
      </div>
      <button
        aria-label={`Dismiss ${title}`}
        className="cm-toast__dismiss"
        onClick={() => {
          onDismiss(id);
        }}
        type="button"
      >
        <span aria-hidden="true">&times;</span>
      </button>
    </li>
  );
}

/**
 * Controlled, non-expiring toast viewport.
 *
 * Callers retain durable records for consequential outcomes. Each toast has an
 * explicit dismissal control and never steals focus.
 */
export function ToastViewport({
  className,
  label = "Notifications",
  onDismiss,
  toasts,
}: ToastViewportProps) {
  if (toasts.length === 0) {
    return null;
  }

  const classes = ["cm-toast-viewport", className].filter(Boolean).join(" ");

  return (
    <section aria-label={label} className={classes}>
      <ol className="cm-toast-viewport__list">
        {toasts.map((toast) => (
          <Toast {...toast} key={toast.id} onDismiss={onDismiss} />
        ))}
      </ol>
    </section>
  );
}
