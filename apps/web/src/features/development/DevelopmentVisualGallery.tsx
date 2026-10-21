import {
  ServiceIconContainer,
  StatusBadge,
  type IconPlaceholderReason,
  type IconRegistry,
  type StatusTone,
} from "@cloudmarkup/ui";
import type { ReactNode } from "react";

import { RoutePage } from "../../shell/RoutePage.js";

import "./DevelopmentVisualGallery.css";

export interface DevelopmentGalleryCatalogService {
  readonly id: string;
  readonly displayName: string;
  readonly iconId: string;
}

export interface DevelopmentVisualGalleryProps {
  readonly iconRegistry: IconRegistry<ReactNode>;
  readonly services: readonly DevelopmentGalleryCatalogService[];
}

interface NodeStatusSample {
  readonly id: string;
  readonly label: string;
  readonly note: string;
  readonly tone: StatusTone;
}

type EdgeVisualKind =
  | "authentication"
  | "dependency"
  | "generic"
  | "iam-permission"
  | "network-route"
  | "read"
  | "read-write"
  | "synchronous-invocation"
  | "asynchronous-event"
  | "write";

interface EdgeSample {
  readonly description: string;
  readonly kind: EdgeVisualKind;
  readonly label: string;
  readonly shortLabel: string;
}

interface BoundarySample {
  readonly id: string;
  readonly label: string;
  readonly note: string;
  readonly tone: StatusTone;
}

const nodeStatusSamples: readonly NodeStatusSample[] = [
  {
    id: "normal",
    label: "Normal",
    note: "Base node treatment with no asserted status.",
    tone: "neutral",
  },
  {
    id: "incomplete",
    label: "Incomplete",
    note: "Question marker and text accompany the dotted treatment.",
    tone: "incomplete",
  },
  {
    id: "warning",
    label: "Warning",
    note: "A warning sample, not a current validation finding.",
    tone: "warning",
  },
  {
    id: "security",
    label: "Security",
    note: "A future security treatment; no finding is asserted.",
    tone: "security",
  },
  {
    id: "error",
    label: "Error sample",
    note: "No blocking policy or revision eligibility is asserted.",
    tone: "error",
  },
  {
    id: "proposal",
    label: "AI proposed",
    note: "Presentation vocabulary only; no model output exists.",
    tone: "proposal",
  },
  {
    id: "generated",
    label: "Generated",
    note: "Presentation vocabulary only; no lifecycle is inferred.",
    tone: "generated",
  },
  {
    id: "unsupported",
    label: "Unsupported",
    note: "Compatibility must eventually come from an authoritative result.",
    tone: "unsupported",
  },
  {
    id: "read-only",
    label: "Read-only",
    note: "Permission and lifecycle reasons are not invented here.",
    tone: "read-only",
  },
];

const edgeSamples: readonly EdgeSample[] = [
  {
    description:
      "Solid directed line with a filled arrow. This is a visual vocabulary sample only.",
    kind: "synchronous-invocation",
    label: "Synchronous invocation",
    shortLabel: "Invoke",
  },
  {
    description:
      "Dashed directed line with an event label. No current relationship support is claimed.",
    kind: "asynchronous-event",
    label: "Asynchronous event",
    shortLabel: "Event",
  },
  {
    description:
      "Solid directed line with a hollow arrow and a visible text label.",
    kind: "read",
    label: "Read",
    shortLabel: "Read · R",
  },
  {
    description: "Heavier solid directed line with a visible write label.",
    kind: "write",
    label: "Write",
    shortLabel: "Write · W",
  },
  {
    description:
      "Heavier solid directed line with a paired read and write label.",
    kind: "read-write",
    label: "Read and write",
    shortLabel: "Read · Write · R/W",
  },
  {
    description: "Dotted directed line with authentication named in text.",
    kind: "authentication",
    label: "Authentication",
    shortLabel: "Authenticate",
  },
  {
    description: "Dash-dot directed line with route meaning named in text.",
    kind: "network-route",
    label: "Network route",
    shortLabel: "Route",
  },
  {
    description:
      "Parallel keyline treatment with an exact permission-intent label.",
    kind: "iam-permission",
    label: "IAM or permission",
    shortLabel: "Allow",
  },
  {
    description:
      "Dashed line ending in a diamond, with dependency named in text.",
    kind: "dependency",
    label: "Dependency",
    shortLabel: "Depends on",
  },
  {
    description:
      "Neutral directed fallback for an unknown or unmapped relationship.",
    kind: "generic",
    label: "Generic relationship",
    shortLabel: "Relationship",
  },
];

const boundarySamples: readonly BoundarySample[] = [
  {
    id: "normal",
    label: "Normal",
    note: "Neutral perimeter and persistent heading.",
    tone: "neutral",
  },
  {
    id: "selected",
    label: "Selected",
    note: "Selection is separate from status.",
    tone: "info",
  },
  {
    id: "incomplete",
    label: "Incomplete",
    note: "Dotted perimeter plus explicit text.",
    tone: "incomplete",
  },
  {
    id: "proposal",
    label: "AI proposed",
    note: "Dashed treatment; no proposal exists.",
    tone: "proposal",
  },
  {
    id: "generated",
    label: "Generated",
    note: "Provenance treatment without lifecycle inference.",
    tone: "generated",
  },
  {
    id: "unsupported",
    label: "Unsupported",
    note: "Hatch plus text, independent of provider icon state.",
    tone: "unsupported",
  },
  {
    id: "read-only",
    label: "Read-only",
    note: "Legible contents with a named permission state.",
    tone: "read-only",
  },
];

const densityActions = ["Inspect sample", "Open legend"] as const;

export function DevelopmentVisualGallery({
  iconRegistry,
  services,
}: DevelopmentVisualGalleryProps) {
  return (
    <RoutePage
      description="A development-only, synthetic reference for the approved visual vocabulary. It is not an architecture editor or an export renderer."
      eyebrow="Development tooling · never production navigation"
      routeKey="development-visual-gallery"
      title="Development visual gallery"
    >
      <aside
        aria-label="Development gallery limitations"
        className="development-gallery__notice"
      >
        <StatusBadge label="Synthetic fixtures" tone="warning" />
        <p>
          No Architecture Document, provider support decision, validation
          result, permission decision, or diagram artifact is represented on
          this page. Approved provider artwork shown below identifies AWS
          services and resources only.
        </p>
      </aside>

      <GallerySection
        description="Service names and opaque icon IDs come from catalog-facing data passed at composition. Assets resolve only through the injected registry."
        id="provider-icon-registry"
        title="Provider icon registry resolution"
      >
        <p className="development-gallery__truth">
          Each sample reports whether the checked registry resolves an approved
          local icon or the neutral fallback. Artwork identifies the visible
          service or resource only; support, endorsement, availability, and
          compilation readiness are not inferred.
        </p>
        {services.length === 0 ? (
          <div className="development-gallery__empty">
            <h3>No catalog-facing icon samples supplied</h3>
            <p>
              The gallery does not manufacture provider services or icon IDs
              when the composition root supplies none.
            </p>
          </div>
        ) : (
          <ul
            aria-label="Catalog provider icon samples"
            className="development-gallery__icon-grid"
          >
            {services.map((service) => (
              <ProviderIconSample
                iconRegistry={iconRegistry}
                key={service.id}
                service={service}
              />
            ))}
          </ul>
        )}
      </GallerySection>

      <GallerySection
        description="Badges pair color with a symbol, text, and a short explanation. These synthetic examples do not report graph state."
        id="node-status-badges"
        title="Node-status badge vocabulary"
      >
        <ul
          aria-label="Synthetic node-status samples"
          className="development-gallery__status-grid"
        >
          {nodeStatusSamples.map((sample) => (
            <li className="development-gallery__sample-card" key={sample.id}>
              <StatusBadge label={sample.label} tone={sample.tone} />
              <p>{sample.note}</p>
            </li>
          ))}
        </ul>
      </GallerySection>

      <GallerySection
        description="Line pattern, marker shape, label, and direction work together. Provider adapters must eventually supply exact meanings."
        id="edge-vocabulary"
        title="Provider-neutral edge vocabulary"
      >
        <ul
          aria-label="Synthetic edge samples"
          className="development-gallery__edge-grid"
        >
          {edgeSamples.map((sample) => (
            <li key={sample.kind}>
              <EdgeVisualSample sample={sample} />
            </li>
          ))}
        </ul>
      </GallerySection>

      <GallerySection
        description="These are visual-system samples for exact provider-semantic containment treatments, not arbitrary canvas groups."
        id="boundary-treatments"
        title="Boundary treatments"
      >
        <p className="development-gallery__truth">
          The AWS catalog defines exact Region, VPC, Availability Zone, and
          subnet boundary semantics. These synthetic states demonstrate visual
          treatment only; they do not create or change architecture meaning.
        </p>
        <ul
          aria-label="Synthetic boundary treatment samples"
          className="development-gallery__boundary-grid"
        >
          {boundarySamples.map((sample) => (
            <li
              className="development-gallery__boundary"
              data-boundary-state={sample.id}
              key={sample.id}
            >
              <header>
                <div>
                  <strong>Synthetic provider boundary</strong>
                  <span>2 visual-only items</span>
                </div>
                <StatusBadge label={sample.label} tone={sample.tone} />
              </header>
              <div aria-hidden="true" className="development-gallery__nodes">
                <span />
                <span />
              </div>
              <p>{sample.note}</p>
            </li>
          ))}
        </ul>
      </GallerySection>

      <GallerySection
        description="Copy and help can adapt; spacing, controls, order, and availability remain identical."
        id="mode-assistance-comparison"
        title="Guided and Professional assistance"
      >
        <div className="development-gallery__density-grid">
          <ModeAssistanceSample mode="guided" />
          <ModeAssistanceSample mode="professional" />
        </div>
      </GallerySection>

      <GallerySection
        description="These compact legends preview approved vocabulary only. They are not generated files and carry no artifact identity or digest."
        id="export-legends"
        title="Diagram-export legend samples"
      >
        <div className="development-gallery__legend-grid">
          <LegendSample profile="presentation" />
          <LegendSample profile="technical" />
        </div>
      </GallerySection>
    </RoutePage>
  );
}

function GallerySection({
  children,
  description,
  id,
  title,
}: {
  readonly children: ReactNode;
  readonly description: string;
  readonly id: string;
  readonly title: string;
}) {
  const headingId = `${id}-heading`;

  return (
    <section
      aria-labelledby={headingId}
      className="development-gallery__section"
      id={id}
    >
      <header className="development-gallery__section-heading">
        <p className="status-label">Synthetic component reference</p>
        <h2 id={headingId}>{title}</h2>
        <p>{description}</p>
      </header>
      {children}
    </section>
  );
}

function ProviderIconSample({
  iconRegistry,
  service,
}: {
  readonly iconRegistry: IconRegistry<ReactNode>;
  readonly service: DevelopmentGalleryCatalogService;
}) {
  const resolution = iconRegistry.resolve(service.iconId);
  const isPlaceholder = resolution.kind === "placeholder";
  const status = isPlaceholder
    ? describePlaceholderStatus(resolution.reason)
    : { label: "Approved local icon", tone: "success" as const };

  return (
    <li className="development-gallery__icon-card">
      <ServiceIconContainer
        label={service.displayName}
        status={isPlaceholder ? "placeholder" : "approved"}
        size="large"
      >
        {resolution.asset}
      </ServiceIconContainer>
      <div>
        <h3>{service.displayName}</h3>
        <StatusBadge label={status.label} tone={status.tone} />
        <p>
          <code>{service.iconId}</code>
        </p>
        <p className="development-gallery__fine-print">
          {isPlaceholder
            ? describePlaceholderReason(resolution.reason)
            : "Resolved from an owner-approved, technically validated local asset set."}
          {" Catalog reference only; support is not inferred."}
        </p>
      </div>
    </li>
  );
}

function describePlaceholderStatus(reason: IconPlaceholderReason): {
  readonly label: string;
  readonly tone: StatusTone;
} {
  switch (reason) {
    case "pending-approval":
      return { label: "Icon pending approval", tone: "incomplete" };
    case "missing":
      return { label: "Icon unavailable", tone: "incomplete" };
    case "rejected":
      return { label: "Icon rejected", tone: "error" };
    case "withdrawn":
      return { label: "Icon withdrawn", tone: "neutral" };
    case "integrity-failure":
      return { label: "Icon integrity check failed", tone: "error" };
    default:
      return { label: "Icon unavailable", tone: "incomplete" };
  }
}

function describePlaceholderReason(reason: IconPlaceholderReason): string {
  switch (reason) {
    case "pending-approval":
      return "Official provider artwork is pending source and usage approval.";
    case "missing":
      return "No admitted local provider artwork is present.";
    case "rejected":
      return "The provider artwork was rejected; the safe placeholder remains.";
    case "withdrawn":
      return "The provider artwork was withdrawn; the safe placeholder remains.";
    case "integrity-failure":
      return "The provider artwork failed integrity checks; the safe placeholder remains.";
    default:
      return "The provider artwork is unavailable; the safe placeholder remains.";
  }
}

function EdgeVisualSample({ sample }: { readonly sample: EdgeSample }) {
  const isIam = sample.kind === "iam-permission";
  const isDependency = sample.kind === "dependency";

  return (
    <figure
      className="development-gallery__edge-sample"
      data-edge-kind={sample.kind}
    >
      <svg
        aria-label={`${sample.label} directed line sample`}
        className="development-gallery__edge-svg"
        role="img"
        viewBox="0 0 180 32"
      >
        <line
          className="development-gallery__edge-line"
          x1="8"
          x2="154"
          y1="16"
          y2="16"
        />
        {isIam ? (
          <line
            className="development-gallery__edge-keyline"
            x1="8"
            x2="154"
            y1="21"
            y2="21"
          />
        ) : null}
        {isDependency ? (
          <path
            className="development-gallery__edge-diamond"
            d="M154 16 162 10 170 16 162 22Z"
          />
        ) : (
          <path
            className="development-gallery__edge-arrow"
            d="M153 9 170 16 153 23Z"
          />
        )}
      </svg>
      <figcaption>
        <strong>{sample.label}</strong>
        <span className="development-gallery__edge-label">
          {sample.shortLabel}
        </span>
        <span>{sample.description}</span>
      </figcaption>
    </figure>
  );
}

function ModeAssistanceSample({
  mode,
}: {
  readonly mode: "guided" | "professional";
}) {
  const isGuided = mode === "guided";
  const title = isGuided ? "Guided assistance" : "Professional assistance";
  const headingId = `development-${mode}-assistance-heading`;

  return (
    <section
      aria-labelledby={headingId}
      className="development-gallery__density-sample"
      data-gallery-mode={mode}
    >
      <header>
        <div>
          <p className="status-label">
            {isGuided ? "More guidance" : "Concise"}
          </p>
          <h3 id={headingId}>{title}</h3>
        </div>
        <StatusBadge label="Same actions" tone="success" />
      </header>
      <div className="development-gallery__density-row">
        <span aria-hidden="true" className="development-gallery__density-node">
          ◇
        </span>
        <div>
          <strong>Example service</strong>
          <p>
            {isGuided
              ? "A little more explanation stays visible for people learning the workspace."
              : "Exact visual metadata stays available with concise language for experienced operators."}
          </p>
        </div>
      </div>
      <div
        aria-label={`${title} actions`}
        className="development-gallery__density-actions"
        role="group"
      >
        {densityActions.map((action) => (
          <button
            className="button button--secondary"
            key={action}
            type="button"
          >
            {action}
          </button>
        ))}
      </div>
      <p className="development-gallery__fine-print">
        Presentation fixture only. No Architecture Document or domain command
        changes.
      </p>
    </section>
  );
}

function LegendSample({
  profile,
}: {
  readonly profile: "presentation" | "technical";
}) {
  const isTechnical = profile === "technical";
  const title = isTechnical ? "Technical legend" : "Presentation legend";
  const headingId = `development-${profile}-legend-heading`;

  return (
    <section
      aria-labelledby={headingId}
      className="development-gallery__legend"
      data-legend-profile={profile}
    >
      <header>
        <p className="status-label">Not an export artifact</p>
        <h3 id={headingId}>{title}</h3>
      </header>
      <dl>
        <div>
          <dt>
            <span
              aria-hidden="true"
              className="development-gallery__legend-placeholder"
            >
              ◇
            </span>
            Resource
          </dt>
          <dd>
            Visible service name · supplementary provider icon or neutral
            fallback
          </dd>
        </div>
        <div>
          <dt>
            <span
              aria-hidden="true"
              className="development-gallery__legend-edge"
            />
            Relationship
          </dt>
          <dd>
            {isTechnical
              ? "Exact validated relationship and ports would appear here."
              : "A restrained, human-readable relationship label."}
          </dd>
        </div>
        <div>
          <dt>
            <StatusBadge label="Generated" tone="generated" />
          </dt>
          <dd>
            {isTechnical
              ? "Exact provenance would come from an immutable revision."
              : "Relevant lifecycle status remains visible."}
          </dd>
        </div>
        <div>
          <dt>
            <StatusBadge label="Read-only" tone="read-only" />
          </dt>
          <dd>Permission or lifecycle reason must remain explicit.</dd>
        </div>
      </dl>
      <p className="development-gallery__fine-print">
        No artifact, renderer result, digest, or downloadable file is created.
      </p>
    </section>
  );
}
