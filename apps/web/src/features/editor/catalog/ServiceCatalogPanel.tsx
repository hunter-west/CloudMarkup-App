import {
  Button,
  Dialog,
  Disclosure,
  EmptyState,
  FormField,
  Popover,
  SearchInput,
} from "@cloudmarkup/ui";
import { AlertTriangle, GripVertical, Info } from "lucide-react";
import {
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

import { CatalogServiceIcon } from "../../../provider-icons/CatalogServiceIcon.js";
import { useModePreference } from "../../../preferences/index.js";
import { useViewportPosture } from "../../../shell/viewport.js";
import {
  createServiceCatalogViewModel,
  writeServiceCatalogDragPayload,
  type ServiceCatalogCategoryViewModel,
  type ServiceCatalogItemViewModel,
} from "../model/index.js";
import {
  useEditorDocumentSession,
  useEditorSessionState,
  useEditorSessionStoreApi,
} from "../session/index.js";
import "./service-catalog.css";
import { listServiceCreationParents } from "../model/placement-rules.js";
import { ServiceSetupDialog } from "./ServiceSetupDialog.js";

const SERVICE_PREVIEW_ID = "service-catalog-preview";

function detailsButtonId(serviceId: string): string {
  return `service-catalog-details-${serviceId}`;
}

function addService(
  item: ServiceCatalogItemViewModel,
  session: Extract<
    ReturnType<typeof useEditorDocumentSession>,
    { status: "ready" }
  >,
  store: ReturnType<typeof useEditorSessionStoreApi>,
): void {
  if (!item.addability.enabled) {
    store.getState().announce(item.addability.reason);
    return;
  }
  session.addService(item.serviceId);
}

function CatalogServiceCard({
  allowDrag,
  detailsOpen,
  item,
  onPreviewChange,
}: {
  readonly allowDrag: boolean;
  readonly detailsOpen: boolean;
  readonly item: ServiceCatalogItemViewModel;
  readonly onPreviewChange: (
    serviceId: string | null,
    trigger: HTMLButtonElement,
  ) => void;
}) {
  const session = useEditorDocumentSession();
  const store = useEditorSessionStoreApi();
  const [setupOpen, setSetupOpen] = useState(false);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  if (session.status !== "ready") {
    return null;
  }
  const readySession = session;
  const enabled = item.addability.enabled;
  const setupAvailable =
    (item.service.catalogGroup !== undefined && enabled) ||
    (!enabled &&
      (item.addability.code === "configuration-unavailable" ||
        item.addability.code === "parent-ambiguous") &&
      listServiceCreationParents(
        session.document,
        session.catalog,
        item.service,
      ).length > 0);
  const needsParent = !enabled && item.addability.code === "parent-unavailable";
  const setupReason =
    item.service.catalogGroup !== undefined && enabled
      ? "Choose a service variant before adding it to the canvas."
      : !enabled && setupAvailable
        ? item.addability.reason
        : null;

  function handleDragStart(event: DragEvent<HTMLElement>): void {
    if (!enabled) {
      event.preventDefault();
      store.getState().announce(item.addability.reason);
      return;
    }
    writeServiceCatalogDragPayload(event.dataTransfer, item.serviceId);
    store
      .getState()
      .announce(`${item.service.displayName} ready to drop on the canvas.`);
  }

  return (
    <article
      className="service-catalog-card"
      data-add-enabled={enabled || setupAvailable ? "true" : "false"}
      data-service-id={item.serviceId}
    >
      <header className="service-catalog-card__header">
        <CatalogServiceIcon
          iconId={item.iconId}
          registry={readySession.iconRegistry}
          serviceName={item.service.displayName}
        />
        <div className="service-catalog-card__identity">
          <h3>{item.service.displayName}</h3>
          <span>{item.primarySummary}</span>
        </div>
        <ServiceInformation item={item} />
      </header>
      {item.searchContext === null ? null : (
        <p className="service-catalog-card__search-context">
          {item.searchContext}
        </p>
      )}

      {setupReason !== null ? (
        <p className="service-catalog-card__hint">{setupReason}</p>
      ) : enabled && !allowDrag ? (
        <p className="service-catalog-card__hint">
          Use Add for automatic placement. Drag placement requires a tablet or
          desktop canvas.
        </p>
      ) : enabled || setupAvailable ? null : (
        <p className="service-catalog-card__disabled">
          <AlertTriangle aria-hidden="true" size={14} />{" "}
          {item.addability.reason}
        </p>
      )}

      <div className="service-catalog-card__actions">
        {enabled && allowDrag && item.service.catalogGroup === undefined ? (
          <button
            aria-label={`Drag or add ${item.service.displayName} to canvas`}
            className="service-catalog-card__drag"
            draggable
            onClick={() => {
              addService(item, readySession, store);
            }}
            onDragStart={handleDragStart}
            type="button"
          >
            <GripVertical aria-hidden="true" size={18} />
          </button>
        ) : null}
        <Button
          aria-label={
            setupAvailable
              ? `Set up ${item.service.displayName}`
              : needsParent
                ? `Add a parent before ${item.service.displayName}`
                : `Add ${item.service.displayName} to canvas`
          }
          disabled={!enabled && !setupAvailable}
          onClick={(event) => {
            addButtonRef.current = event.currentTarget;
            if (setupAvailable) setSetupOpen(true);
            else addService(item, readySession, store);
          }}
          size="compact"
          variant="primary"
        >
          {setupAvailable ? "Set up" : needsParent ? "Needs parent" : "Add"}
        </Button>
        <Button
          aria-controls={detailsOpen ? SERVICE_PREVIEW_ID : undefined}
          aria-expanded={detailsOpen}
          aria-label={`${detailsOpen ? "Hide" : "Show"} details for ${item.service.displayName}`}
          id={detailsButtonId(item.serviceId)}
          onClick={(event) => {
            onPreviewChange(
              detailsOpen ? null : item.serviceId,
              event.currentTarget,
            );
          }}
          size="compact"
          variant="secondary"
        >
          Details
        </Button>
      </div>
      {setupOpen ? (
        <ServiceSetupDialog
          service={item.service}
          onClose={() => {
            setSetupOpen(false);
          }}
          returnFocusRef={addButtonRef}
        />
      ) : null}
    </article>
  );
}

function ServiceInformation({
  item,
}: {
  readonly item: ServiceCatalogItemViewModel;
}) {
  return (
    <Popover
      className="service-catalog-information"
      label={`${item.service.displayName} service information`}
      openOnHoverOrFocus
      renderContent={(content) => createPortal(content, document.body)}
      trigger={<Info aria-hidden="true" size={16} />}
      triggerLabel={`More information about ${item.service.displayName}`}
    >
      <dl className="service-catalog-information__list">
        <div>
          <dt>Availability</dt>
          <dd>
            {item.regionLabel}: {item.regionDetail}
          </dd>
        </div>
        <div>
          <dt>Infrastructure as Code support</dt>
          <dd>{item.mappingSummary}</dd>
        </div>
        <div>
          <dt>Connections</dt>
          <dd>
            {item.connectionSummary}. {item.portSummary}.
          </dd>
        </div>
        <div>
          <dt>Catalog maturity</dt>
          <dd>{item.service.supportLabel}</dd>
        </div>
        <div>
          <dt>Technical identifier</dt>
          <dd>
            <code>{item.serviceId}</code>
          </dd>
        </div>
      </dl>
    </Popover>
  );
}

function RecentServices({
  items,
  onPreviewChange,
  previewServiceId,
}: {
  readonly items: readonly ServiceCatalogItemViewModel[];
  readonly onPreviewChange: (
    serviceId: string | null,
    trigger: HTMLButtonElement,
  ) => void;
  readonly previewServiceId: string | null;
}) {
  if (items.length === 0) {
    return null;
  }

  return (
    <section
      aria-labelledby="recent-services-heading"
      className="service-catalog-recent"
    >
      <h3 id="recent-services-heading">Recently used</h3>
      <ul>
        {items.map((item) => (
          <li key={item.serviceId}>
            <button
              aria-controls={
                previewServiceId === item.serviceId
                  ? SERVICE_PREVIEW_ID
                  : undefined
              }
              aria-expanded={previewServiceId === item.serviceId}
              aria-label={`${previewServiceId === item.serviceId ? "Hide" : "Show"} details for recently used ${item.service.displayName}`}
              onClick={(event) => {
                onPreviewChange(
                  previewServiceId === item.serviceId ? null : item.serviceId,
                  event.currentTarget,
                );
              }}
              type="button"
            >
              {item.service.displayName}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function DocumentationLink({
  reference,
}: {
  readonly reference: ServiceCatalogItemViewModel["service"]["education"]["documentation"][number];
}) {
  if (reference.kind === "official") {
    return (
      <a href={reference.href} rel="noreferrer" target="_blank">
        {reference.title}
      </a>
    );
  }

  return (
    <span>
      {reference.title}: <code>{reference.path}</code>
    </span>
  );
}

function configurationReadiness(item: ServiceCatalogItemViewModel): string {
  const fields = item.service.configuration.fields;
  const requiredFields = fields.filter((field) => field.required);
  const fieldSummary =
    fields.length === 1
      ? "1 catalog-defined setting"
      : `${String(fields.length)} catalog-defined settings`;
  const requiredSummary =
    requiredFields.length === 1
      ? "1 required"
      : `${String(requiredFields.length)} required`;

  return item.service.configuration.defaults.kind === "ready"
    ? `${fieldSummary}, ${requiredSummary}. Validated catalog defaults are available.`
    : `${fieldSummary}, ${requiredSummary}. ${item.service.configuration.defaults.reason}`;
}

function ServiceDetailsDialog({
  item,
  onClose,
  open,
  returnFocusRef,
}: {
  readonly item: ServiceCatalogItemViewModel | undefined;
  readonly onClose: () => void;
  readonly open: boolean;
  readonly returnFocusRef: RefObject<HTMLButtonElement | null>;
}) {
  const session = useEditorDocumentSession();
  if (session.status !== "ready" || item === undefined) {
    return null;
  }
  const documentation = item.service.education.documentation[0];

  return (
    <Dialog
      className="service-catalog-details-dialog"
      closeLabel={`Close details for ${item.service.displayName}`}
      description={item.modeExplanation}
      onClose={onClose}
      open={open}
      returnFocusRef={returnFocusRef}
      title={`${item.service.displayName} details`}
    >
      <div
        className="service-catalog-details"
        data-service-preview-id={item.serviceId}
        id={SERVICE_PREVIEW_ID}
      >
        <div className="service-catalog-details__identity">
          <CatalogServiceIcon
            iconId={item.iconId}
            registry={session.iconRegistry}
            serviceName={item.service.displayName}
          />
          <div>
            <strong>{item.service.displayName}</strong>
            <span>{item.service.supportLabel}</span>
          </div>
        </div>

        <section>
          <h3>What it does</h3>
          <p>{item.modeExplanation}</p>
        </section>

        <section>
          <h3>Common uses</h3>
          <p>{item.primarySummary}</p>
        </section>

        <section>
          <h3>Configuration readiness</h3>
          <p>{configurationReadiness(item)}</p>
          {item.service.configuration.hasSecuritySensitiveFields ? (
            <p>Includes security-sensitive settings.</p>
          ) : null}
          {item.service.configuration.hasCostSensitiveFields ? (
            <p>Includes cost-sensitive settings.</p>
          ) : null}
        </section>

        <section>
          <h3>Available connections</h3>
          {item.connections.length === 0 ? (
            <p>No exact catalog relationship references this service.</p>
          ) : (
            <ul>
              {item.connections.map((connection) => (
                <li
                  key={`${connection.relationshipId}:${connection.direction}`}
                >
                  <strong>{connection.displayName}</strong>
                  <span>
                    {connection.direction === "outgoing" ? "To" : "From"}{" "}
                    {connection.otherServiceName}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h3>IaC support</h3>
          <p>{item.mappingSummary}</p>
          <p>
            <code>{item.serviceId}</code> · {item.portSummary}
          </p>
        </section>

        <section>
          <h3>Known limitations</h3>
          <ul>
            {!item.addability.enabled ? (
              <li>{item.addability.reason}</li>
            ) : null}
            <li>
              {item.regionLabel}: {item.regionDetail}
            </li>
            <li>{item.service.supportDetail}</li>
            {item.service.unsupportedCapabilities.map((capability) => (
              <li key={capability.id}>
                <strong>{capability.title}</strong>
                <span>{capability.explanation}</span>
              </li>
            ))}
          </ul>
        </section>

        {documentation === undefined ? null : (
          <p className="service-catalog-details__learn">
            <strong>Learn more:</strong>{" "}
            <DocumentationLink reference={documentation} />
          </p>
        )}
      </div>
    </Dialog>
  );
}

function CatalogGroup({
  children,
  count,
  groupId,
  initiallyOpen,
  label,
}: {
  readonly children: ReactNode;
  readonly count: number;
  readonly groupId: string;
  readonly initiallyOpen: boolean;
  readonly label: string;
}) {
  const [open, setOpen] = useState(initiallyOpen);

  return (
    <details
      className="service-catalog-category"
      data-catalog-group={groupId}
      onToggle={(event) => {
        setOpen(event.currentTarget.open);
      }}
      open={open}
    >
      <summary>
        <span className="service-catalog-category__summary-content">
          <span>{label}</span>
          <span className="service-catalog-category__count">
            {String(count)}
          </span>
        </span>
      </summary>
      {children}
    </details>
  );
}

function ServiceCategory({
  allowDrag,
  category,
  initiallyOpen,
  onPreviewChange,
  previewServiceId,
}: {
  readonly allowDrag: boolean;
  readonly category: ServiceCatalogCategoryViewModel;
  readonly initiallyOpen: boolean;
  readonly onPreviewChange: (
    serviceId: string | null,
    trigger: HTMLButtonElement,
  ) => void;
  readonly previewServiceId: string | null;
}) {
  return (
    <CatalogGroup
      count={category.items.length}
      groupId={category.id}
      initiallyOpen={initiallyOpen}
      label={category.label}
    >
      <ul>
        {category.items.map((item) => (
          <li key={item.serviceId}>
            <CatalogServiceCard
              allowDrag={allowDrag}
              detailsOpen={previewServiceId === item.serviceId}
              item={item}
              onPreviewChange={onPreviewChange}
            />
          </li>
        ))}
      </ul>
    </CatalogGroup>
  );
}

export function ServiceCatalogPanel({
  notice,
}: { readonly notice?: ReactNode } = {}) {
  const session = useEditorDocumentSession();
  const store = useEditorSessionStoreApi();
  const previewReturnFocusRef = useRef<HTMLButtonElement | null>(null);
  const [retainedPreview, setRetainedPreview] =
    useState<ServiceCatalogItemViewModel>();
  const searchQuery = useEditorSessionState(
    (state) => state.catalogSearchQuery,
  );
  const previewServiceId = useEditorSessionState(
    (state) => state.catalogPreviewServiceId,
  );
  const recentServiceIds = useEditorSessionState(
    (state) => state.recentServiceIds,
  );
  const { mode } = useModePreference();
  const posture = useViewportPosture();

  const viewModel = useMemo(
    () =>
      session.status === "ready"
        ? createServiceCatalogViewModel({
            catalog: session.catalog,
            document: session.document,
            mode,
            query: searchQuery,
            recentServiceIds,
          })
        : null,
    [mode, recentServiceIds, searchQuery, session],
  );
  const preview = viewModel?.categories
    .flatMap((category) => category.items)
    .find((item) => item.serviceId === previewServiceId);

  function setPreview(
    serviceId: string | null,
    trigger: HTMLButtonElement,
  ): void {
    previewReturnFocusRef.current = serviceId === null ? null : trigger;
    if (serviceId !== null) {
      const nextPreview = viewModel?.categories
        .flatMap((category) => category.items)
        .find((item) => item.serviceId === serviceId);
      if (nextPreview !== undefined) {
        setRetainedPreview(nextPreview);
      }
    }
    store.getState().setCatalogPreviewServiceId(serviceId);
  }

  function closePreview(): void {
    store.getState().setCatalogPreviewServiceId(null);
  }

  if (session.status !== "ready" || viewModel === null) {
    return (
      <div className="panel-content service-catalog-panel">
        <header className="panel-heading">
          <p className="status-label">Service catalog</p>
          <h2>Catalog unavailable</h2>
        </header>
        <p>No catalog entries are interpreted for an invalid document.</p>
      </div>
    );
  }

  const serviceLoadFailed = session.catalog.serviceListState.kind === "failed";
  const catalogIsEmpty =
    !serviceLoadFailed &&
    session.catalog.services.length === 0 &&
    session.catalog.invalidEntries.length === 0;

  return (
    <div
      className="panel-content service-catalog-panel"
      data-catalog-mode={mode}
    >
      <div className="service-catalog-panel__controls">
        <header className="panel-heading service-catalog-panel__heading">
          <h2>{session.catalog.providerName}</h2>
          <Popover
            label="Catalog help"
            renderContent={(content) => createPortal(content, document.body)}
            trigger={<Info aria-hidden="true" size={16} />}
            triggerLabel="Catalog help"
          >
            <p className="service-catalog-panel__introduction">
              Choose a service by name or purpose. Details and limitations come
              from the exact bundled catalog. Use Add for automatic placement or
              drag an available service onto the canvas.
            </p>
            <p className="service-catalog-panel__introduction">
              Owner settings live in Configure. Choose FSx file systems and
              CloudWatch variants through Set up. Related services are available
              from their owner in Configure.
            </p>
          </Popover>
        </header>

        <FormField
          className="service-catalog-search-field"
          htmlFor="service-catalog-search"
          label="Search services"
        >
          <SearchInput
            autoComplete="off"
            id="service-catalog-search"
            onChange={(event) => {
              store.getState().setCatalogSearchQuery(event.currentTarget.value);
            }}
            placeholder="Search by name or purpose"
            value={searchQuery}
          />
        </FormField>

        <p
          aria-atomic="true"
          aria-live="polite"
          className="service-catalog-result-count"
          id="service-catalog-result-count"
        >
          {viewModel.resultCount === 1
            ? "1 catalog result"
            : `${String(viewModel.resultCount)} catalog results`}
          {searchQuery === ""
            ? " · services and variants in Set up / Configure"
            : null}
        </p>
        {searchQuery === "" ? null : (
          <Button
            size="compact"
            variant="quiet"
            onClick={() => {
              store.getState().setCatalogSearchQuery("");
              document.getElementById("service-catalog-search")?.focus();
            }}
          >
            Show all catalog entries
          </Button>
        )}
      </div>

      <div
        aria-describedby="service-catalog-result-count"
        aria-label="Catalog service results"
        className="service-catalog-results"
        data-catalog-scroll-region=""
        id="service-catalog-results"
        role="region"
      >
        {notice}
        <RecentServices
          items={viewModel.recentItems}
          onPreviewChange={setPreview}
          previewServiceId={previewServiceId}
        />

        {serviceLoadFailed ? (
          <EmptyState
            description={session.catalog.serviceListState.reason}
            headingLevel={3}
            title="Catalog services could not be loaded"
          />
        ) : catalogIsEmpty ? (
          <EmptyState
            description="The exact bundled catalog contains no service definitions."
            headingLevel={3}
            title="This catalog has no services"
          />
        ) : viewModel.resultCount === 0 ? (
          <EmptyState
            actions={
              <Button
                onClick={() => {
                  const searchInput = document.getElementById(
                    "service-catalog-search",
                  );
                  if (searchInput instanceof HTMLInputElement) {
                    searchInput.focus();
                  }
                  store.getState().setCatalogSearchQuery("");
                }}
              >
                Clear search
              </Button>
            }
            description="Try an exact service name or words already used in the catalog education."
            headingLevel={3}
            title="No services match this search"
          />
        ) : (
          <>
            {viewModel.categories.map((category) => (
              <ServiceCategory
                allowDrag={posture !== "phone"}
                category={category}
                initiallyOpen
                key={`${category.id}:${viewModel.query}`}
                onPreviewChange={setPreview}
                previewServiceId={previewServiceId}
              />
            ))}

            {viewModel.invalidEntries.length === 0 ? null : (
              <CatalogGroup
                count={viewModel.invalidEntries.length}
                groupId="invalid-catalog-entries"
                initiallyOpen={viewModel.query !== ""}
                key={`invalid-catalog-entries:${viewModel.query}`}
                label="Unavailable entries"
              >
                <ul>
                  {viewModel.invalidEntries.map((entry) => (
                    <li key={entry.id}>
                      <article
                        className="service-catalog-card"
                        data-add-enabled="false"
                      >
                        <strong>{entry.title}</strong>
                        <p className="service-catalog-card__disabled">
                          <AlertTriangle aria-hidden="true" size={14} />{" "}
                          {entry.reason}
                        </p>
                        <Button
                          aria-label={`Add ${entry.title} to canvas`}
                          disabled
                          size="compact"
                        >
                          Add
                        </Button>
                      </article>
                    </li>
                  ))}
                </ul>
              </CatalogGroup>
            )}
          </>
        )}
      </div>

      <div className="service-catalog-secondary">
        <Disclosure
          className="service-catalog-diagnostics"
          summary="Developer diagnostics"
        >
          <dl>
            <div>
              <dt>Catalog ID</dt>
              <dd>{session.catalog.identity.id}</dd>
            </div>
            <div>
              <dt>Catalog version</dt>
              <dd>{session.catalog.identity.version}</dd>
            </div>
            <div>
              <dt>Catalog digest</dt>
              <dd>{session.catalog.identity.digest}</dd>
            </div>
            <div>
              <dt>Catalog maturity</dt>
              <dd>{session.catalog.catalogMaturity}</dd>
            </div>
            <div>
              <dt>Icon asset set</dt>
              <dd>
                {session.iconRegistry.assetSet.id} ·{" "}
                {session.iconRegistry.assetSet.version}
              </dd>
            </div>
          </dl>
        </Disclosure>
      </div>
      <ServiceDetailsDialog
        item={preview ?? retainedPreview}
        onClose={closePreview}
        open={preview !== undefined}
        returnFocusRef={previewReturnFocusRef}
      />
    </div>
  );
}
