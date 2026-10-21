import { AppLink } from "../../routing/index.js";
import { RoutePage } from "../../shell/RoutePage.js";

export function ConnectionGuidancePage() {
  return (
    <RoutePage
      title="Connection guidance"
      eyebrow="Architecture relationships"
      description="Understand how the editor validates, previews, and applies typed connections."
      routeKey="connection-guidance"
    >
      <section className="state-card">
        <p className="status-label">Rule-engine workflow</p>
        <h2>Connect an output to a compatible input</h2>
        <p>
          Every line represents a catalog-defined relationship with a source,
          target, and typed ports. The deterministic connection-rule engine
          decides whether the direction and endpoints are valid; an AI model
          does not make that decision.
        </p>
        <ol>
          <li>Choose the relationship type when more than one rule matches.</li>
          <li>
            Answer required questions and review any recommended defaults.
          </li>
          <li>
            Review every affected node, edge, permission, route, notification,
            and supporting resource, including generated-resource provenance.
          </li>
          <li>
            Check the security, cost, reliability, and Region-availability
            implications before confirming.
          </li>
        </ol>
      </section>
      <section className="state-card">
        <p className="status-label">Safe application</p>
        <h2>Confirmation applies one atomic command batch</h2>
        <p>
          The editor applies the reviewed Graph Command batch only after
          confirmation. If validation or a precondition fails, the whole batch
          is rejected. Cancelling leaves the Architecture Document unchanged.
        </p>
        <p>
          Both modes use the same connection fields, technical details and
          confirmation rules. Guided provides explanatory assistance;
          Professional uses more concise technical wording.
        </p>
        <AppLink className="button button--secondary" to="/organizations">
          Return to organizations
        </AppLink>
      </section>
    </RoutePage>
  );
}
