import { useEffect, useRef, type ReactNode } from "react";

interface RoutePageProps {
  readonly title: string;
  readonly eyebrow?: string;
  readonly description?: string;
  readonly children: ReactNode;
  readonly actions?: ReactNode;
  readonly immersive?: boolean;
  readonly routeKey: string;
}

export function RoutePage({
  title,
  eyebrow,
  description,
  children,
  actions,
  immersive = false,
  routeKey,
}: RoutePageProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    document.title = title;
    headingRef.current?.focus();
  }, [routeKey, title]);

  return (
    <div className={`route-page ${immersive ? "route-page--immersive" : ""}`}>
      <div
        className="visually-hidden"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        Viewing {title}
      </div>
      <header
        className={`route-page__header ${immersive ? "visually-hidden" : ""}`}
      >
        <div>
          {eyebrow === undefined ? null : (
            <p className="route-page__eyebrow">{eyebrow}</p>
          )}
          <h1 ref={headingRef} tabIndex={-1}>
            {title}
          </h1>
          {description === undefined ? null : (
            <p className="route-page__description">{description}</p>
          )}
        </div>
        {actions === undefined ? null : (
          <div className="route-page__actions">{actions}</div>
        )}
      </header>
      <div className="route-page__content">{children}</div>
    </div>
  );
}
