import { useEffect } from "react";
import "./route-loading.css";
export function RouteLoadingIndicator({
  label = "Loading project",
}: {
  readonly label?: string;
}) {
  useEffect(() => {
    document.title = label;
  }, [label]);
  return (
    <div className="route-loading-indicator" role="status" aria-live="polite">
      <div className="route-loading-indicator__message">
        <span className="route-loading-indicator__spinner" aria-hidden="true" />
        <span>{label}…</span>
      </div>
      <div className="route-loading-indicator__placeholder" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}
