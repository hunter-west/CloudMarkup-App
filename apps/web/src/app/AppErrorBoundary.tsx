import { Component, createRef, type ReactNode } from "react";

interface AppErrorBoundaryProps {
  readonly children: ReactNode;
}

interface AppErrorBoundaryState {
  readonly hasError: boolean;
}

export class AppErrorBoundary extends Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  public override state: AppErrorBoundaryState = { hasError: false };
  private readonly headingRef = createRef<HTMLHeadingElement>();

  public static getDerivedStateFromError(): AppErrorBoundaryState {
    return { hasError: true };
  }

  public override componentDidCatch(): void {
    // Raw render errors stay out of user-visible copy and telemetry is not
    // connected in this local shell.
    document.title = "Application error";
    this.headingRef.current?.focus();
  }

  public override render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <main className="public-shell" id="main-content" tabIndex={-1}>
        <section className="global-error" role="alert">
          <p className="status-label">Application error</p>
          <h1 ref={this.headingRef} tabIndex={-1}>
            This view could not be rendered
          </h1>
          <p>
            The view stopped rendering, and raw error details are hidden. This
            page cannot confirm whether an in-flight request or action
            completed. Check the current project or account state before
            retrying.
          </p>
          <a className="button button--primary" href="/sign-in">
            Return to sign in
          </a>
        </section>
      </main>
    );
  }
}
