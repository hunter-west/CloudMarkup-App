import { RouteLoadingIndicator } from "../shell/RouteLoadingIndicator.js";
import { Component, Suspense, type ReactNode } from "react";

import { AppShell, type AppShellIdentity } from "../shell/AppShell.js";
import { RoutePage } from "../shell/RoutePage.js";
import { DeferredRouteModuleError } from "./deferred-route-loader.js";
import "./deferred-route.css";

interface DeferredRouteBoundaryProps {
  readonly children: ReactNode;
  readonly title: string;
  readonly includeShell?: boolean;
  readonly shellIdentity?: AppShellIdentity | undefined;
}

function DeferredRouteFallback({
  failed,
  title,
  includeShell,
  shellIdentity,
}: Omit<DeferredRouteBoundaryProps, "children"> & {
  readonly failed: boolean;
}) {
  const content = !failed ? (
    <RouteLoadingIndicator label={"Loading " + title.toLowerCase()} />
  ) : (
    <div className="deferred-route">
      <RoutePage title={title + " could not load"} routeKey="route-load-failed">
        <div role="alert">
          <p>
            Check your connection, then reload this view. You can also use the
            navigation to open another page.
          </p>
          <button
            className="button button--secondary"
            onClick={() => {
              window.location.reload();
            }}
            type="button"
          >
            Reload this view
          </button>
        </div>
      </RoutePage>
    </div>
  );
  return includeShell ? (
    <AppShell
      loadingWorkspace={!failed && title === "Architecture editor"}
      {...(shellIdentity === undefined ? {} : { identity: shellIdentity })}
    >
      {content}
    </AppShell>
  ) : (
    content
  );
}

export class DeferredRouteBoundary extends Component<
  DeferredRouteBoundaryProps,
  { readonly failed: boolean }
> {
  public override state = { failed: false };

  public static getDerivedStateFromError(error: unknown): {
    readonly failed: boolean;
  } {
    if (!(error instanceof DeferredRouteModuleError)) {
      throw error;
    }
    return { failed: true };
  }

  public override render(): ReactNode {
    const { children, ...fallbackProps } = this.props;
    if (this.state.failed) {
      return <DeferredRouteFallback {...fallbackProps} failed />;
    }
    return (
      <Suspense
        fallback={<DeferredRouteFallback {...fallbackProps} failed={false} />}
      >
        {children}
      </Suspense>
    );
  }
}
