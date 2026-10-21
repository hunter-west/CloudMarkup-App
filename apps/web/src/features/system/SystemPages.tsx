import { AppLink, useAppLocation } from "../../routing/index.js";
import { RoutePage } from "../../shell/RoutePage.js";

const safeReturnPath = "/organizations";

export function PermissionDeniedPage() {
  const { pathname } = useAppLocation();
  const routeKey = `denied-${pathname}`;

  return (
    <RoutePage
      key={routeKey}
      title="Access unavailable"
      eyebrow="Permission denied"
      description="The requested content is unavailable to this account."
      routeKey={routeKey}
    >
      <section className="state-card state-card--permission" role="alert">
        <p className="status-label">Permission required</p>
        <h2>No protected resource details are available</h2>
        <p>
          The resource may be absent or unavailable. This page intentionally
          does not identify an organization, project, revision, artifact,
          member, or policy.
        </p>
        <AppLink className="button button--secondary" to={safeReturnPath}>
          Return to organizations
        </AppLink>
      </section>
    </RoutePage>
  );
}

export function UnsupportedPage() {
  return (
    <RoutePage
      title="Version not supported"
      eyebrow="Compatibility state"
      description="Editing, validation claims, compilation, and export creation fail closed."
      routeKey="unsupported"
    >
      <section className="state-card state-card--warning" role="alert">
        <p className="status-label">Unsupported</p>
        <h2>Cloud Markup cannot safely interpret this resource</h2>
        <p>
          No migration, edit, compiler, or export behavior is simulated. The
          source would remain preserved for a compatible implementation or an
          explicitly reviewed recovery path.
        </p>
        <AppLink className="button button--secondary" to={safeReturnPath}>
          Return to organizations
        </AppLink>
      </section>
    </RoutePage>
  );
}

export function NotFoundPage() {
  const { pathname } = useAppLocation();
  const routeKey = `not-found-${pathname}`;

  return (
    <RoutePage
      key={routeKey}
      title="Page unavailable"
      eyebrow="Not found"
      description="The requested location is absent or unavailable."
      routeKey={routeKey}
    >
      <section className="state-card">
        <p className="status-label">Safe fallback</p>
        <h2>Nothing is available at this location</h2>
        <p>
          This result does not distinguish a missing tenant resource from one
          the current actor could not view.
        </p>
        <AppLink className="button button--secondary" to={safeReturnPath}>
          Return to organizations
        </AppLink>
      </section>
    </RoutePage>
  );
}
