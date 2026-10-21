import { CatalogServiceIcon } from "../../provider-icons/CatalogServiceIcon.js";
import { awsIconRegistry } from "../../provider-icons/aws-icon-registry.js";
import { awsEditorCatalog } from "../../provider-catalog/aws-editor-catalog.js";
import { ArrowRight } from "lucide-react";
import { Disclosure } from "@cloudmarkup/ui";
import "./templates.css";
import type { CurrentPrincipalV1 } from "@cloudmarkup/api-contract";

import { AppLink, encodeRouteSelector } from "../../routing/index.js";
import { RoutePage } from "../../shell/RoutePage.js";
import {
  EVENT_TEMPLATE_CATALOG_VERSION,
  eventApplicationHandlerPatterns,
  eventTemplateDefinitions,
  findEventApplicationHandlerPattern,
  findEventTemplate,
} from "./event-templates.js";

interface TemplateRouteContextProps {
  readonly localFixturesEnabled?: boolean;
  readonly organizationId: string;
}

function createTemplatesPath(organizationId: string): string {
  return `/organizations/${encodeRouteSelector(organizationId)}/templates`;
}

function createLocalFixtureEditorPath(organizationId: string): string {
  return `/organizations/${encodeRouteSelector(organizationId)}/projects/field-notes/editor`;
}

export function TemplatesPage({
  localFixturesEnabled = false,
  organizationId,
}: TemplateRouteContextProps) {
  const templatesPath = createTemplatesPath(organizationId);

  return (
    <RoutePage
      title="Templates"
      eyebrow="Organization templates"
      description="Choose a starting architecture, review its details, then make it your own."
      routeKey="templates"
    >
      <section aria-labelledby="event-template-title">
        <h2 className="visually-hidden" id="event-template-title">
          Starting architectures
        </h2>
        <div className="template-grid">
          {eventTemplateDefinitions.map((template) => (
            <article className="template-card" key={template.id}>
              <h3>{template.title}</h3>
              <p>{template.summary}</p>
              <ol className="template-flow" aria-label="Template flow">
                {template.eventFlow.map((step, index) => (
                  <li key={step}>
                    {index > 0 ? (
                      <ArrowRight aria-hidden="true" size={14} />
                    ) : null}
                    <span className="template-flow__service">
                      <TemplateFlowIcon
                        templateId={template.id}
                        index={index}
                      />
                      <span>{step}</span>
                    </span>
                  </li>
                ))}
              </ol>
              <AppLink
                className="button button--secondary"
                to={`${templatesPath}/${encodeRouteSelector(template.id)}`}
              >
                Review template
              </AppLink>
            </article>
          ))}
        </div>
      </section>

      <Disclosure summary="Supported application patterns">
        <section aria-labelledby="handler-support-title">
          <p className="status-label">Exact source-generation boundary</p>
          <h2 id="handler-support-title">Six reviewed handler shapes</h2>
          <p>
            Generated handlers come only from the exact Workload Document and
            event contracts included with the template; custom business behavior
            needs your implementation.
          </p>
          <p>
            A template binds only the handler shape named in its details. The
            deterministic generator also accepts these six explicit shapes; it
            never guesses one from service names or prose.
          </p>
          <ul aria-label="Source-eligible handler shapes">
            {eventApplicationHandlerPatterns.map((pattern) => (
              <li key={pattern.id}>{pattern.label}</li>
            ))}
          </ul>
        </section>
      </Disclosure>
      {localFixturesEnabled ? (
        <section
          className="feature-card"
          aria-labelledby="local-template-title"
        >
          <p className="status-label">Local learning fixture - not released</p>
          <h2 id="local-template-title">Notes API walkthrough</h2>
          <p>
            Opens the existing editor with a small, exact-catalog-bound starting
            graph. It is a local teaching fixture, not a production template or
            infrastructure recommendation.
          </p>
          <AppLink
            className="button button--primary"
            to={`${createLocalFixtureEditorPath(organizationId)}?start=template`}
          >
            Open local notes template
          </AppLink>
        </section>
      ) : null}
    </RoutePage>
  );
}

interface TemplateDetailPageProps extends TemplateRouteContextProps {
  readonly principal?: CurrentPrincipalV1;
  readonly templateId: string;
}

export function TemplateDetailPage({
  localFixturesEnabled = false,
  organizationId,
  principal,
  templateId,
}: TemplateDetailPageProps) {
  const templatesPath = createTemplatesPath(organizationId);
  const template = findEventTemplate(templateId);
  const canCreateProject =
    principal?.organizationContexts.some(
      (context) =>
        context.organizationId === organizationId &&
        context.capabilities.includes("projects.create"),
    ) === true;
  if (template !== undefined) {
    return (
      <RoutePage
        title={template.title}
        eyebrow={`AWS event-driven template · catalog ${EVENT_TEMPLATE_CATALOG_VERSION}`}
        description={template.summary}
        routeKey={`template-${templateId}`}
      >
        <section className="feature-card" aria-labelledby="event-flow-title">
          <p className="status-label">Reviewed starting graph</p>
          <h2 id="event-flow-title">Event flow</h2>
          <ol aria-label="Template event flow">
            {template.eventFlow.map((step, index) => (
              <li key={`${step}:${String(index)}`}>{step}</li>
            ))}
          </ol>
          <h3>Delivery contract</h3>
          <p>{template.delivery}</p>
          <h3>Bound handler contract</h3>
          <p>
            {template.handlerPatterns
              .map(
                (patternId) =>
                  findEventApplicationHandlerPattern(patternId).label,
              )
              .join(", ")}
          </p>
          <h3>Target readiness</h3>
          <p>{template.readiness}</p>
          <h3>Idempotency boundary</h3>
          <p>{template.idempotencyBoundary}</p>
          <h3>Artifact readiness</h3>
          <p>{template.artifactReadiness}</p>
          {localFixturesEnabled ? (
            <AppLink
              className="button button--primary"
              to={`${createLocalFixtureEditorPath(organizationId)}?start=event-template&template=${encodeRouteSelector(template.id)}`}
            >
              Open template in editor
            </AppLink>
          ) : canCreateProject ? (
            <AppLink
              className="button button--primary"
              to={`/organizations/${encodeRouteSelector(organizationId)}/projects/new?template=${encodeRouteSelector(template.id)}`}
            >
              Create project from template
            </AppLink>
          ) : (
            <div>
              <button
                aria-describedby="template-start-unavailable"
                className="button button--primary"
                disabled
                type="button"
              >
                Create project from template
              </button>
              <p className="fine-print" id="template-start-unavailable">
                Project creation permission is required in this organization.
              </p>
            </div>
          )}
        </section>
        <AppLink className="button button--secondary" to={templatesPath}>
          Return to templates
        </AppLink>
      </RoutePage>
    );
  }

  return (
    <RoutePage
      title="Template unavailable"
      eyebrow="Templates"
      description="This template is no longer available in the current catalog."
      routeKey={`template-${templateId}`}
    >
      <section className="state-card state-card--warning" role="alert">
        <h2>Choose another starting point</h2>
        <p>
          Browse the available templates to find a starting architecture for
          your project.
        </p>
        <AppLink className="button button--secondary" to={templatesPath}>
          Return to templates
        </AppLink>
      </section>
    </RoutePage>
  );
}

const templateFlowServices: Readonly<Record<string, readonly string[]>> = {
  "image-upload-processing": [
    "aws.s3.bucket",
    "aws.lambda.function",
    "aws.dynamodb.table",
  ],
  "scheduled-workflow": [
    "aws.eventbridge.event-bus",
    "aws.stepfunctions.state-machine",
    "aws.lambda.function",
  ],
  "sns-fan-out-notification": [
    "aws.sns.topic",
    "aws.sqs.queue",
    "aws.lambda.function",
  ],
  "queue-consumer-with-dlq": [
    "aws.sqs.queue",
    "aws.lambda.function",
    "aws.sqs.queue",
  ],
};
function TemplateFlowIcon({
  templateId,
  index,
}: {
  readonly templateId: string;
  readonly index: number;
}) {
  const service = awsEditorCatalog.services.find(
    (entry) => entry.serviceType === templateFlowServices[templateId]?.[index],
  );
  return service?.iconId ? (
    <CatalogServiceIcon
      decorative
      iconId={service.iconId}
      registry={awsIconRegistry}
      serviceName={service.displayName}
    />
  ) : null;
}
